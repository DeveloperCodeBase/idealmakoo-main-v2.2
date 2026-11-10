import type {PgRow} from './recovered-db-rows';
export type PartnerPublicDefinition=z.infer<typeof partnerPublicDefinitionSchema>;
type PartnerProfileRow=PgRow<'partner_public_profiles'>;
type PartnerRevisionRow=PgRow<'partner_public_revisions',{value:PartnerPublicDefinition}> & {binding_current:boolean;reviewer_id:string|null;approved_at:Date|null};
type PartnerAgreementRow=PgRow<'crm_partner_agreements',{valid_from:string;valid_to:string|null}>;
type PublicPartnerRow={id:string;locale:Locale;slug:string;revision_number:number;published_at:Date;value:PartnerPublicDefinition};
import type { PoolClient } from 'pg';
import type { Actor } from './types';
import type { Locale } from '../lib/i18n';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { assert, HttpError } from "./types";
import { domainContext, requireContact, domainRecord, domainPermission, requiredProfile } from "./workspace-domain-core";
import { canWorkspace } from "../lib/auth";
import { hash } from "./crypto";
import { getPublicSite } from "./workspace";
import { products } from "../data/catalog";
import { randomUUID } from "node:crypto";
import { parse, rateLimit } from "./http";
import { transaction, audit } from "./db";
import { loadCrmAccess } from "./workspace-scopes";
import { readableRecord } from "./workspace-policy";
import { createRequest } from "./requests";
const localeSchema = z.enum(["fa", "en", "tr", "ar", "ru"]), slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const text = (max: number, min = 0) => z.string().trim().min(min).max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Control characters are forbidden.");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Use a valid calendar date.");
const partnerPublicDefinitionSchema = z.object({ name: text(200, 2), summary: text(3e3, 10), country: text(100, 1), province: text(100), city: text(100, 1), address: text(1e3, 1), email: z.union([z.literal(""), z.string().email().max(254)]), phone: z.union([z.literal(""), z.string().regex(/^\+?[0-9 ()-]{6,40}$/)]), website: z.union([z.literal(""), z.string().max(1e3).url().refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }, "Use a public HTTPS website.")]), coordinates: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict().nullable(), families: z.array(z.enum(["teeth", "materials"])).min(1).max(2).refine(values => new Set(values).size === values.length), license: z.object({ number: text(200, 1), issuer: text(200, 1), validFrom: date, validTo: date, state: z.enum(["verified", "suspended"]), verificationNote: text(2e3, 10) }).strict().refine(value => value.validTo >= value.validFrom, "Licence dates are reversed.") }).strict();
const matchVersion = (expected: number, actual: number) => (assert)(Number.isSafeInteger(expected) && expected === actual, 409, "PROFILE_CONFLICT", "The directory profile changed. Reload and review your changes.");
async function context(client: PoolClient, actor: Actor, partnerId: string, locale: Locale, edit = false) {
    actor = (await (domainContext)(client, actor)).actor;
    (assert)(actor.mfaVerified && (canWorkspace)(actor.role, "view", "partners"), 403, "FORBIDDEN", "Current staff partner access is required.");
    (requireContact)(actor);
    (assert)(actor.allowedLocales.includes(locale), 403, "LOCALE_SCOPE", "This profile language is outside your scope.");
    const record = await (domainRecord)(client, actor, partnerId, "partners");
    if (edit)
        (domainPermission)(actor, record);
    const agreement = (await client.query("SELECT *,valid_from::text,valid_to::text FROM crm_partner_agreements WHERE partner_id=$1", [partnerId])).rows[0];
    (assert)(agreement, 409, "PARTNER_AGREEMENT_REQUIRED", "Configure the structured partner agreement first.");
    await (requiredProfile)(client, actor, agreement.account_id, "account");
    return { actor, record, agreement };
}
async function profileRow(client: PoolClient, id: string) { (assert)(z.string().uuid().safeParse(id).success, 404, "NOT_FOUND", "Directory profile not found."); const row = (await client.query<PartnerProfileRow>("SELECT * FROM partner_public_profiles WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Directory profile not found."); return row; }
const revisionSql = `SELECT r.*,r.agreement_stamp=a.updated_at AS binding_current,v.reviewer_id,v.approved_at FROM partner_public_revisions r JOIN partner_public_profiles p ON p.id=r.profile_id JOIN crm_partner_agreements a ON a.partner_id=p.partner_id LEFT JOIN partner_public_approvals v ON v.revision_id=r.id`;
async function revisionRow(client: PoolClient, id: string) : Promise<PartnerRevisionRow> { const row = (await client.query(revisionSql + " WHERE r.id=$1", [id])).rows[0]; (assert)(row && (hash)(JSON.stringify(row.value)) === row.checksum, 503, "PROFILE_INTEGRITY", "The stored profile revision requires operator recovery."); return row; }
const revisionDto = (row: PartnerRevisionRow) => ({ id: row.id, number: row.revision_number, value: row.value, checksum: row.checksum, createdBy: row.created_by, createdAt: row.created_at.toISOString(), bindingCurrent: row.binding_current, approvedBy: row.reviewer_id, approvedAt: row.approved_at?.toISOString() || null });
const publicBase = `FROM partner_public_profiles p JOIN partner_public_revisions r ON r.id=p.published_revision_id JOIN crm_partner_agreements a ON a.partner_id=p.partner_id JOIN workspace_entities e ON e.bucket='records' AND e.id=a.partner_id JOIN workspace_entities acc ON acc.bucket='records' AND acc.id=a.account_id WHERE p.published_revision_id IS NOT NULL AND p.state<>'archived' AND r.agreement_stamp=a.updated_at AND a.active AND a.valid_from<=current_date AND (a.valid_to IS NULL OR a.valid_to>=current_date) AND e.deleted_at IS NULL AND e.status<>'archived' AND acc.deleted_at IS NULL AND acc.status<>'archived'`;
async function view(client: PoolClient, actor: Actor, row: PartnerProfileRow) { const current = await revisionRow(client, row.current_revision_id!), edit = (canWorkspace)(actor.role, "edit", "partners"), approve = (canWorkspace)(actor.role, "review", "partners") && current.created_by !== actor.id; return { id: row.id, partnerId: row.partner_id, locale: row.locale, slug: row.slug, state: row.state, version: row.version, current: revisionDto(current), publishedRevisionId: row.published_revision_id, publicAvailable: !!(await client.query("SELECT p.id " + publicBase + " AND p.id=$1", [row.id])).rowCount, capabilities: { edit, submit: edit && row.state === "draft", approve: approve && row.state === "review" && !current.reviewer_id && current.binding_current, publish: (canWorkspace)(actor.role, "publish", "partners") && row.state === "approved" && !!current.reviewer_id && current.binding_current && row.published_revision_id !== current.id, unpublish: edit && !!row.published_revision_id, archive: edit && row.state !== "archived", restore: edit && row.state === "archived" } }; }
async function validateCoverage(client: PoolClient, value: PartnerPublicDefinition, agreement: PartnerAgreementRow) {
    if (!agreement.product_ids.length)
        return;
    const site = await (getPublicSite)(client), families = new Set(agreement.product_ids.map(id => products.find(product => product.id === id)?.family || site.publications.find(publication => publication.productRelease?.productId === id || publication.customProduct?.id === id)?.productRelease?.family));
    (assert)(value.families.every(family => families.has(family)), 422, "PROFILE_COVERAGE", "Public product families must be covered by the current internal agreement.");
}
async function addRevision(client: PoolClient, actor: Actor, row: PartnerProfileRow, value: PartnerPublicDefinition) { const id = (randomUUID)(), number = Number((await client.query("SELECT coalesce(max(revision_number),0)+1 AS number FROM partner_public_revisions WHERE profile_id=$1", [row.id])).rows[0].number); (assert)(number <= 500, 409, "PROFILE_REVISION_LIMIT", "This profile reached its retained revision limit."); const canonical = JSON.parse(JSON.stringify(value)); const stored = (await client.query("SELECT $1::jsonb AS value", [JSON.stringify(canonical)])).rows[0].value; await client.query("INSERT INTO partner_public_revisions(id,profile_id,revision_number,value,checksum,agreement_stamp,created_by) SELECT $1,$2,$3,$4::jsonb,$5,a.updated_at,$6 FROM crm_partner_agreements a WHERE a.partner_id=$7", [id, row.id, number, JSON.stringify(stored), (hash)(JSON.stringify(stored)), actor.id, row.partner_id]); return id; }
async function getPartnerPublicProfile(actor: Actor, partnerId: string, localeInput: unknown) { const locale = (parse)(localeSchema, localeInput); return (transaction)(async (client) => { actor = (await context(client, actor, partnerId, locale)).actor; const row = (await client.query<PartnerProfileRow>("SELECT * FROM partner_public_profiles WHERE partner_id=$1 AND locale=$2", [partnerId, locale])).rows[0]; return row ? view(client, actor, row) : null; }); }
async function savePartnerPublicProfile(actor: Actor, partnerId: string, body: unknown) {
    const input = (parse)(z.object({ locale: localeSchema, slug: slugSchema, expectedVersion: z.number().int().min(0), value: partnerPublicDefinitionSchema }).strict(), body);
    await (rateLimit)("partner-profile:" + actor.id, 120, 3600);
    try {
        return await (transaction)(async (client) => {
            const state = await context(client, actor, partnerId, input.locale, true);
            actor = state.actor;
            await validateCoverage(client, input.value, state.agreement);
            let row = (await client.query<PartnerProfileRow>("SELECT * FROM partner_public_profiles WHERE partner_id=$1 AND locale=$2 FOR UPDATE", [partnerId, input.locale])).rows[0];
            matchVersion(input.expectedVersion, row?.version || 0);
            if (row) {
                (assert)(row.slug === input.slug, 422, "PROFILE_SLUG_IMMUTABLE", "A directory URL remains stable after creation.");
                (assert)(row.state !== "archived", 409, "PROFILE_ARCHIVED", "Restore the profile before editing.");
            }
            else
                row = (await client.query<PartnerProfileRow>("INSERT INTO partner_public_profiles(id,partner_id,locale,slug,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5) RETURNING *", [(randomUUID)(), partnerId, input.locale, input.slug, actor.id])).rows[0];
            const revision = await addRevision(client, actor, row, input.value);
            row = (await client.query<PartnerProfileRow>("UPDATE partner_public_profiles SET current_revision_id=$2,state='draft',version=version+$4,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING *", [row.id, revision, actor.id, input.expectedVersion === 0 ? 0 : 1])).rows[0];
            await (audit)(actor.id, "partner.public.draft_saved", "partner_profile", row.id, { revisionId: revision, locale: input.locale }, client);
            return view(client, actor, row);
        });
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "23505")
            throw new HttpError(409, "PROFILE_DUPLICATE", "This public profile or directory URL already exists.");
        throw error;
    }
}
async function commandPartnerPublicProfile(actor: Actor, id: string, body: unknown, expected: number) {
    const input = (parse)(z.object({ action: z.enum(["submit", "approve", "publish", "unpublish", "archive", "restore", "restore-revision"]), reason: text(2e3, 10), revisionId: z.string().uuid().optional() }).strict(), body);
    return (transaction)(async (client) => {
        await (domainContext)(client, actor);
        let row = await profileRow(client, id);
        const state = await context(client, actor, row.partner_id, row.locale, input.action !== "approve" && input.action !== "publish");
        actor = state.actor;
        matchVersion(expected, row.version);
        const revision = await revisionRow(client, row.current_revision_id!);
        let nextState = row.state, current = row.current_revision_id, published = row.published_revision_id;
        if (input.action === "submit") {
            (assert)(row.state === "draft" && revision.binding_current, 409, "PROFILE_REVIEW_REQUIRED", "Save a draft bound to the current agreement before submission.");
            nextState = "review";
        }
        if (input.action === "approve") {
            (assert)((canWorkspace)(actor.role, "review", "partners"), 403, "FORBIDDEN", "Current review permission is required.");
            (assert)(row.state === "review" && revision.binding_current && revision.created_by !== actor.id && !revision.reviewer_id, 409, "PROFILE_INDEPENDENT_REVIEW", "An independent reviewer must approve this exact current revision.");
            await validateCoverage(client, revision.value, state.agreement);
            await client.query("INSERT INTO partner_public_approvals(revision_id,reviewer_id,reviewer_role,reason) VALUES($1,$2,$3,$4)", [revision.id, actor.id, actor.role, input.reason]);
            nextState = "approved";
        }
        if (input.action === "publish") {
            (assert)((canWorkspace)(actor.role, "publish", "partners"), 403, "FORBIDDEN", "Current publication permission is required.");
            (assert)(row.state === "approved" && revision.binding_current && revision.reviewer_id, 409, "PROFILE_REVIEW_REQUIRED", "Approve the exact revision and current agreement before publication.");
            (assert)(row.published_revision_id !== revision.id, 409, "PROFILE_ALREADY_PUBLISHED", "This exact revision is already published.");
            // Evaluate the prior reviewer's current grants independently; the
            // publisher's HTTP session belongs only to the publishing actor.
            const reviewer = await (loadCrmAccess)({ id: revision.reviewer_id, name: "", email: "", role: "customer", qualityScope: false, allowedLocales: [], mfaVerified: true }, client);
            (assert)(reviewer.mfaVerified && (canWorkspace)(reviewer.role, "review", "partners") && reviewer.allowedLocales.includes(row.locale) && reviewer.crmAccess?.permissions.contact && (readableRecord)(reviewer, state.record), 409, "PROFILE_REVIEWER_CHANGED", "The reviewer no longer holds the required current permission.");
            await (requiredProfile)(client, reviewer, state.agreement.account_id, "account");
            const today = new Date().toISOString().slice(0, 10);
            (assert)(state.agreement.active && state.agreement.valid_from <= today && (!state.agreement.valid_to || state.agreement.valid_to >= today), 409, "PROFILE_AGREEMENT_INACTIVE", "The current internal agreement is not active for publication.");
            published = revision.id;
        }
        if (input.action === "unpublish") {
            (assert)(published, 409, "PROFILE_NOT_PUBLISHED", "This profile is not published.");
            published = null;
        }
        if (input.action === "archive") {
            (assert)(row.state !== "archived", 409, "PROFILE_ARCHIVED", "This profile is already archived.");
            nextState = "archived";
            published = null;
        }
        if (input.action === "restore" || input.action === "restore-revision") {
            if (input.action === "restore")
                (assert)(row.state === "archived", 409, "PROFILE_NOT_ARCHIVED", "This profile is not archived.");
            const source = input.action === "restore-revision" && input.revisionId ? await revisionRow(client, input.revisionId) : revision;
            (assert)(source.profile_id === row.id, 404, "NOT_FOUND", "Profile revision not found.");
            if (input.action === "restore-revision")
                (assert)(input.revisionId, 422, "PROFILE_REVISION", "Select the revision to restore.");
            await validateCoverage(client, source.value, state.agreement);
            current = await addRevision(client, actor, row, source.value);
            nextState = "draft";
        }
        row = (await client.query<PartnerProfileRow>("UPDATE partner_public_profiles SET state=$2,current_revision_id=$3,published_revision_id=$4,published_at=CASE WHEN $4::uuid IS NULL THEN NULL WHEN $6 THEN now() ELSE published_at END,version=version+1,updated_by=$5,updated_at=now() WHERE id=$1 RETURNING *", [id, nextState, current, published, actor.id, input.action === "publish"])).rows[0];
        await (audit)(actor.id, "partner.public." + input.action, "partner_profile", id, { revisionId: current, reason: input.reason }, client);
        return view(client, actor, row);
    });
}
async function partnerProfileHistory(actor: Actor, id: string, beforeInput: unknown) { const before = (parse)(z.coerce.number().int().min(1).max(501).default(501), beforeInput ?? void 0); return (transaction)(async (client) => { await (domainContext)(client, actor); const row = await profileRow(client, id); actor = (await context(client, actor, row.partner_id, row.locale)).actor; const rows = (await client.query(revisionSql + " WHERE r.profile_id=$1 AND r.revision_number<$2 ORDER BY r.revision_number DESC LIMIT 51", [id, before])).rows; return { items: rows.slice(0, 50).map(revisionDto), nextCursor: rows.length > 50 ? rows[49].revision_number : null }; }); }
function publicDto(row: PublicPartnerRow) { const v = row.value, license = v.license, today = new Date().toISOString().slice(0, 10), days = (Date.parse(license.validTo + "T23:59:59Z") - Date.now()) / 864e5, state = license.state === "suspended" ? "suspended" : license.validFrom > today ? "not-yet-valid" : license.validTo < today ? "expired" : days <= 30 ? "expiring" : "current"; return { id: row.id, locale: row.locale, slug: row.slug, revision: row.revision_number, publishedAt: row.published_at.toISOString(), name: v.name, summary: v.summary, country: v.country, province: v.province, city: v.city, address: v.address, email: v.email, phone: v.phone, website: v.website, coordinates: v.coordinates, families: v.families, license: { number: license.number, issuer: license.issuer, validFrom: license.validFrom, validTo: license.validTo, state } }; }
async function listPublicRepresentatives(queryInput: unknown) { const input = (parse)(z.object({ locale: localeSchema.default("fa"), search: text(120).default(""), country: text(100).default(""), province: text(100).default(""), city: text(100).default(""), family: z.enum(["", "teeth", "materials"]).default(""), cursor: slugSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict(), queryInput); const pattern = (value: string) => "%" + value.replace(/[\\%_]/g, "\\$&") + "%"; return (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton FOR SHARE"); const rows = (await client.query("SELECT p.id,p.locale,p.slug,r.value,r.revision_number,p.published_at " + publicBase + ` AND p.locale=$1 AND ($2='' OR p.slug>$2) AND ((r.value->>'name')||' '||(r.value->>'summary')) ILIKE $3 AND (r.value->>'country') ILIKE $4 AND (r.value->>'province') ILIKE $5 AND (r.value->>'city') ILIKE $6 AND ($7='' OR (r.value->'families') ? $7) ORDER BY p.slug LIMIT $8`, [input.locale, input.cursor || "", pattern(input.search), pattern(input.country), pattern(input.province), pattern(input.city), input.family, input.limit + 1])).rows; return { items: rows.slice(0, input.limit).map(publicDto), nextCursor: rows.length > input.limit ? rows[input.limit - 1].slug : null, sampledAt: new Date().toISOString() }; }); }
async function getPublicRepresentative(slugInput: unknown, localeInput: unknown) { const slug = (parse)(slugSchema, slugInput), locale = (parse)(localeSchema, localeInput); return (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton FOR SHARE"); const row = (await client.query("SELECT p.id,p.locale,p.slug,r.value,r.revision_number,p.published_at " + publicBase + " AND p.slug=$1 AND p.locale=$2", [slug, locale])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Published representative not found."); return publicDto(row); }); }
async function createRepresentativeCorrection(request: Request, actor: Actor | null, slug: string, body: unknown, idempotencyKey: string) {
    const input = (parse)(z.object({ locale: localeSchema, name: text(160, 2), email: z.string().email().max(254), message: text(4e3, 10), consent: z.literal(true), submittedAt: z.string().datetime() }).strict(), body);
    const profile = await getPublicRepresentative(slug, input.locale);
    return (createRequest)(request, actor, { kind: "contact", name: input.name, email: input.email, organization: "", message: `Directory correction /${input.locale}/distributors/${profile.slug}/
${input.message}`, locale: input.locale, productIds: [], consent: { purpose: "request_processing", acceptedAt: input.submittedAt } }, idempotencyKey);
}
async function publicRepresentativeRoutes() { return (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton FOR SHARE"); const rows = (await client.query("SELECT p.locale,p.slug,p.published_at " + publicBase + " ORDER BY p.locale,p.slug LIMIT 10001")).rows; (assert)(rows.length <= 1e4, 503, "DIRECTORY_SITEMAP_LIMIT", "The directory sitemap needs pagination before exceeding 10,000 profiles."); return rows; }); }
export { commandPartnerPublicProfile, createRepresentativeCorrection, getPartnerPublicProfile, getPublicRepresentative, listPublicRepresentatives, partnerProfileHistory, partnerPublicDefinitionSchema, publicRepresentativeRoutes, savePartnerPublicProfile };
