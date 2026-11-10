import type { Actor } from './types';
import type { PgRow } from './recovered-db-rows';
import type { FrontRequest } from '../types/frontend';
import type { PoolClient } from 'pg';
import type { Locale } from '../lib/i18n';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { assert, HttpError } from "./types";
import { canWorkspace } from "../lib/auth";
import { loadCrmAccess, canAccessCrmRequest } from "./workspace-scopes";
import { checksum } from "./workspace-policy";
import { parse, rateLimit } from "./http";
import { transaction, audit } from "./db";
import { lockWorkspace, upsertRequestInWorkspace } from "./workspace";
import { randomUUID } from "node:crypto";
import { decrypt, encrypt } from "./crypto";
import { assetUsageAllowed } from "./asset-usage";
import { createTenderRequestInTransaction } from "./requests";
const locales = ["fa", "en", "tr", "ar", "ru"] as const;
const localeSchema = z.enum(locales);
const uuidSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(10).max(2e3);
const dateSchema = z.string().datetime({ offset: true });
const timezoneSchema = z.string().min(1).max(100).refine(value => {
    try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
    }
    catch {
        return false;
    }
}, "Use an IANA time zone.");
const titleSchema = z.object({ fa: z.string().trim().min(1).max(240), en: z.string().trim().min(1).max(240), tr: z.string().trim().min(1).max(240), ar: z.string().trim().min(1).max(240), ru: z.string().trim().min(1).max(240) }).strict();
const textSchema = z.object({ fa: z.string().max(1e4), en: z.string().max(1e4), tr: z.string().max(1e4), ar: z.string().max(1e4), ru: z.string().max(1e4) }).strict();
const definitionSchema = z.object({ title: titleSchema, summary: textSchema, opensAt: dateSchema, deadlineAt: dateSchema, timezone: timezoneSchema }).strict().superRefine((value, context) => {
    const opens = Date.parse(value.opensAt), deadline = Date.parse(value.deadlineAt);
    if (deadline <= opens || deadline - opens > 366 * 864e5)
        context.addIssue({ code: "custom", message: "The submission window must be positive and at most 366 days." });
});
const envelopeSchema = z.object({ body: z.string().trim().min(20).max(5e4), assetIds: z.array(uuidSchema).min(1).max(5) }).strict();
const financialSchema = envelopeSchema.extend({ amountDecimal: z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/), currency: z.enum(["IRR", "USD", "EUR", "TRY", "RUB"]) }).strict().superRefine((value, context) => {
    if (!/[1-9]/.test(value.amountDecimal) || value.currency === "IRR" && value.amountDecimal.includes("."))
        context.addIssue({ code: "custom", message: "Use a positive amount, with no fraction for IRR." });
});
const bidSchema = z.object({ callRevisionId: uuidSchema, locale: localeSchema, organization: z.string().trim().max(200), phone: z.string().trim().max(40), country: z.string().trim().max(100), technical: envelopeSchema, financial: financialSchema, consent: z.object({ purpose: z.literal("request_processing"), acceptedAt: dateSchema }).strict() }).strict();
const selectorSchema = z.object({ search: z.string().trim().max(120).default(""), limit: z.coerce.number().int().min(1).max(50).default(30), cursor: z.string().max(2048).optional() }).strict();
type CallDefinition = z.infer<typeof definitionSchema>;
type BidInput = z.infer<typeof bidSchema>;
export type {CallDefinition as TenderDefinition,BidInput as TenderBidSubmission};
type EnvelopeKind = 'technical'|'financial';
type CallRow = PgRow<'tender_calls'> & {definition:CallDefinition;revision_number:number;revision_author:string;definition_hash:string;opens_at:Date;deadline_at:Date};
type BidRow = PgRow<'tender_bids'>;
type BidRevisionRow = PgRow<'tender_bid_revisions'>;
type RequestRow = PgRow<'requests',{data:FrontRequest}>;
interface TenderFile {id:string;name:string;mimeType:string;bytes:number;sha256:string}
interface ContactSnapshot {bidId:string;revisionId:string;name:string;email:string;organization:string;phone:string;country:string}
interface EnvelopeSnapshot {bidId:string;revisionId:string;kind:EnvelopeKind;body:string;files:TenderFile[];amountDecimal?:string;currency?:string}
const validId = (id: string) => (assert)(uuidSchema.safeParse(id).success, 404, "NOT_FOUND", "Tender not found.");
const allLocales = (actor: Actor) => locales.every(locale => actor.allowedLocales.includes(locale));
const staffRole = (actor: Actor) => actor.role !== "customer" && actor.mfaVerified && (canWorkspace)(actor.role, "view", "partners");
const callSelect = `SELECT c.*,r.definition,r.number AS revision_number,r.created_by AS revision_author,r.definition_hash,r.opens_at,r.deadline_at FROM tender_calls c JOIN tender_call_revisions r ON r.id=c.current_revision_id AND r.call_id=c.id`;
async function currentActor(client: PoolClient, actor: Actor, staff = false) {
    actor = await (loadCrmAccess)(actor, client);
    (assert)(actor.role === "customer" || actor.mfaVerified, 403, "MFA_REQUIRED", "Staff must complete MFA before accessing confidential proposals.");
    if (staff)
        (assert)(staffRole(actor), 403, "TENDER_ROLE", "Your current role cannot manage tenders.");
    return actor;
}
function managesCall(actor: Actor, row: CallRow) { return staffRole(actor) && (canWorkspace)(actor.role, "edit", "partners") && (row.created_by === actor.id || ["admin", "superAdmin"].includes(actor.role)); }
async function callRow(client: PoolClient, id: string) { validId(id); const row = (await client.query<CallRow>(callSelect + " WHERE c.id=$1 FOR UPDATE OF c", [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Tender not found."); (assert)((checksum)(row.definition) === row.definition_hash, 500, "TENDER_INTEGRITY", "The published tender definition is inconsistent."); return row; }
function requireManagement(actor: Actor, row: CallRow) { (assert)(managesCall(actor, row), 404, "NOT_FOUND", "Tender not found in your current management scope."); }
async function grants(client: PoolClient, actor: Actor, callId: string) { const rows = (await client.query<PgRow<'tender_reviewer_grants'>>("SELECT kind FROM tender_reviewer_grants WHERE call_id=$1 AND user_id=$2 AND active", [callId, actor.id])).rows; return { technical: rows.some(row => row.kind === "technical"), financial: rows.some(row => row.kind === "financial") }; }
async function reviewRow(client: PoolClient, revisionId: string) { return (await client.query<PgRow<'tender_call_reviews'>>("SELECT decision,reviewer_id,reason,created_at FROM tender_call_reviews WHERE revision_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [revisionId])).rows[0]; }
function publicDto(row: CallRow, locale: Locale) { (assert)(row.published_revision_id && row.status !== "draft", 404, "NOT_FOUND", "Published tender not found."); return { id: row.id, revisionId: row.published_revision_id, title: row.definition.title[locale], summary: row.definition.summary[locale], locale, status: row.status, opensAt: row.opens_at.toISOString(), deadlineAt: row.deadline_at.toISOString(), timezone: row.definition.timezone, canSubmit: row.status === "open" && row.opens_at.getTime() <= Date.now() && row.deadline_at.getTime() > Date.now() }; }
async function managedDto(client: PoolClient, actor: Actor, row: CallRow) { const review = await reviewRow(client, row.current_revision_id), manager = managesCall(actor, row); return { id: row.id, revisionId: row.current_revision_id, revisionNumber: row.revision_number, version: row.version, definition: row.definition, status: row.status, createdBy: row.created_by, createdAt: row.created_at.toISOString(), review: review ? { decision: review.decision, reviewerId: review.reviewer_id, reason: review.reason, at: review.created_at.toISOString() } : null, capabilities: { edit: manager && row.status === "draft", review: manager && row.status === "draft" && allLocales(actor) && (canWorkspace)(actor.role, "review", "partners") && row.revision_author !== actor.id, publish: manager && row.status === "draft" && allLocales(actor) && (canWorkspace)(actor.role, "publish", "partners"), close: manager && ["open", "closed"].includes(row.status) && allLocales(actor), manageReviewers: manager && actor.crmAccess?.permissions.assign === true && (canWorkspace)(actor.role, "assign", "partners") } }; }
async function insertCallRevision(client: PoolClient, actor: Actor, callId: string, revisionId: string, number: number, value: CallDefinition) { await client.query("INSERT INTO tender_call_revisions(id,call_id,number,definition,definition_hash,opens_at,deadline_at,created_by) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)", [revisionId, callId, number, JSON.stringify(value), (checksum)(value), value.opensAt, value.deadlineAt, actor.id]); }
async function listPublicTenders(localeInput = "fa") { const locale = (parse)(localeSchema, localeInput); return (transaction)(async (client) => { await (lockWorkspace)(client); const rows = (await client.query<CallRow>(callSelect + " WHERE c.status IN ('open','closed') AND c.published_revision_id IS NOT NULL ORDER BY c.created_at DESC,c.id LIMIT 100")).rows; return { items: rows.map(row => publicDto(row, locale)) }; }); }
async function getPublicTender(id: string, localeInput = "fa") { const locale = (parse)(localeSchema, localeInput); return (transaction)(async (client) => { await (lockWorkspace)(client); return publicDto(await callRow(client, id), locale); }); }
async function listManagedTenders(actor: Actor) {
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor, true);
        const rows = (await client.query<CallRow>(callSelect + " WHERE (c.created_by=$1 OR $2::boolean OR EXISTS(SELECT 1 FROM tender_reviewer_grants g WHERE g.call_id=c.id AND g.user_id=$1 AND g.active)) ORDER BY c.created_at DESC,c.id LIMIT 200", [actor.id, ["admin", "superAdmin"].includes(actor.role)])).rows;
        const items = [];
        for (const row of rows)
            items.push(await managedDto(client, actor, row));
        return { items, canCreate: allLocales(actor) && (canWorkspace)(actor.role, "create", "partners") };
    });
}
async function createTender(actor: Actor, body: unknown) { const value = (parse)(definitionSchema, body); await (rateLimit)("tender-create:" + actor.id, 30, 3600); return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor, true); (assert)(allLocales(actor) && (canWorkspace)(actor.role, "create", "partners"), 403, "CONTENT_LOCALE", "Creating a multilingual tender requires all five content languages."); (assert)(Date.parse(value.deadlineAt) > Date.now(), 422, "TENDER_DEADLINE", "The tender deadline must be in the future."); const id = (randomUUID)(), revisionId = (randomUUID)(); await client.query("INSERT INTO tender_calls(id,current_revision_id,created_by) VALUES($1,$2,$3)", [id, revisionId, actor.id]); await insertCallRevision(client, actor, id, revisionId, 1, value); await (audit)(actor.id, "tender.created", "tender", id, { revisionId }, client); return managedDto(client, actor, await callRow(client, id)); }); }
async function getManagedTender(actor: Actor, id: string) { return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor, true); const row = await callRow(client, id), access = await grants(client, actor, id); (assert)(managesCall(actor, row) || access.technical || access.financial, 404, "NOT_FOUND", "Tender not found."); return managedDto(client, actor, row); }); }
async function updateTender(actor: Actor, id: string, body: unknown) {
    const input = (parse)(z.object({ expectedVersion: z.number().int().positive(), value: definitionSchema }).strict(), body);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor, true);
        const row = await callRow(client, id);
        requireManagement(actor, row);
        (assert)(row.version === input.expectedVersion, 409, "CONFLICT", "The tender changed. Reload its current version.");
        (assert)(row.status === "draft" && !row.published_revision_id, 409, "TENDER_FROZEN", "A published call cannot change the conditions of submitted proposals. Close it and create a new reviewed call.");
        for (const locale of locales)
            if (input.value.title[locale] !== row.definition.title[locale] || input.value.summary[locale] !== row.definition.summary[locale])
                (assert)(actor.allowedLocales.includes(locale), 403, "CONTENT_LOCALE", "A changed tender language is outside your current grant.");
        if ((["opensAt", "deadlineAt", "timezone"] as const).some(key => input.value[key] !== row.definition[key]))
            (assert)(allLocales(actor), 403, "CONTENT_LOCALE", "Shared tender conditions require all five languages.");
        (assert)(Date.parse(input.value.deadlineAt) > Date.now(), 422, "TENDER_DEADLINE", "The tender deadline must be in the future.");
        const revisionId = (randomUUID)();
        await insertCallRevision(client, actor, id, revisionId, row.revision_number + 1, input.value);
        await client.query("UPDATE tender_calls SET current_revision_id=$2,version=version+1,updated_at=now() WHERE id=$1", [id, revisionId]);
        await (audit)(actor.id, "tender.revised", "tender", id, { revisionId }, client);
        return managedDto(client, actor, await callRow(client, id));
    });
}
async function reviewTender(actor: Actor, id: string, body: unknown) { const input = (parse)(z.object({ expectedVersion: z.number().int().positive(), decision: z.enum(["approved", "rejected"]), reason: reasonSchema }).strict(), body); return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor, true); const row = await callRow(client, id); requireManagement(actor, row); (assert)(row.version === input.expectedVersion, 409, "CONFLICT", "The tender changed."); (assert)(row.status === "draft" && allLocales(actor) && (canWorkspace)(actor.role, "review", "partners"), 403, "TENDER_REVIEW", "You cannot review this call in all of its languages."); (assert)(row.revision_author !== actor.id, 403, "SELF_REVIEW", "The call author cannot review their own revision."); await client.query<PgRow<'tender_call_reviews'>>("INSERT INTO tender_call_reviews(id,call_id,revision_id,decision,reason,reviewer_id) VALUES($1,$2,$3,$4,$5,$6)", [(randomUUID)(), id, row.current_revision_id, input.decision, input.reason, actor.id]); await client.query("UPDATE tender_calls SET version=version+1,updated_at=now() WHERE id=$1", [id]); await (audit)(actor.id, "tender.reviewed", "tender", id, { revisionId: row.current_revision_id, decision: input.decision }, client); return managedDto(client, actor, await callRow(client, id)); }); }
async function priorReviewer(client: PoolClient, userId: string) {
    try {
        return await (loadCrmAccess)({ id: userId, name: "", email: "", role: "customer", qualityScope: false, allowedLocales: [], mfaVerified: true }, client);
    }
    catch (error) {
        if (error instanceof HttpError)
            return null;
        throw error;
    }
}
async function changeTenderState(actor: Actor, id: string, body: unknown) {
    const input = (parse)(z.object({ expectedVersion: z.number().int().positive(), status: z.enum(["open", "closed", "cancelled"]) }).strict(), body);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor, true);
        const row = await callRow(client, id);
        requireManagement(actor, row);
        (assert)(row.version === input.expectedVersion, 409, "CONFLICT", "The tender changed.");
        (assert)(allLocales(actor), 403, "CONTENT_LOCALE", "Changing shared tender availability requires all five languages.");
        if (input.status === "open") {
            (assert)(row.status === "draft" && (canWorkspace)(actor.role, "publish", "partners"), 403, "TENDER_PUBLISH", "This call cannot be opened by your current role.");
            (assert)(row.deadline_at.getTime() > Date.now(), 422, "TENDER_DEADLINE", "The reviewed deadline has already passed.");
            const review = await reviewRow(client, row.current_revision_id), reviewer = review && await priorReviewer(client, review.reviewer_id);
            (assert)(review?.decision === "approved" && reviewer && reviewer.mfaVerified && allLocales(reviewer) && (canWorkspace)(reviewer.role, "review", "partners") && reviewer.id !== row.revision_author, 409, "TENDER_REVIEW_REQUIRED", "The current call needs an independent reviewer with current permissions.");
            const selected = (await client.query<PgRow<'tender_reviewer_grants'>>("SELECT user_id,kind FROM tender_reviewer_grants WHERE call_id=$1 AND active", [id])).rows, reviewers: {actor:Actor;kind:EnvelopeKind}[] = [];
            for (const entry of selected) {
                const person = await priorReviewer(client, entry.user_id);
                if (person && eligibleReviewer(person, entry.kind === "financial"))
                    reviewers.push({ actor: person, kind: entry.kind });
            }
            (assert)(locales.every(locale => reviewers.some(technical => technical.kind === "technical" && technical.actor.allowedLocales.includes(locale) && reviewers.some(financial => financial.kind === "financial" && financial.actor.id !== technical.actor.id && financial.actor.allowedLocales.includes(locale)))), 409, "TENDER_REVIEWERS", "Every published language needs current, distinct technical and financial reviewers before opening the call.");
        }
        else
            (assert)(row.status === "open" || row.status === "closed" && input.status === "cancelled" || row.status === "draft" && input.status === "cancelled", 409, "TENDER_TRANSITION", "This tender state transition is not permitted.");
        await client.query("UPDATE tender_calls SET status=$2,published_revision_id=CASE WHEN $2='open' THEN current_revision_id ELSE published_revision_id END,version=version+1,updated_at=now() WHERE id=$1", [id, input.status]);
        await (audit)(actor.id, "tender." + input.status, "tender", id, { revisionId: row.current_revision_id }, client);
        return managedDto(client, actor, await callRow(client, id));
    });
}
function eligibleReviewer(actor: Actor, financial = false) { return staffRole(actor) && (canWorkspace)(actor.role, "note", "partners") && actor.crmAccess?.permissions.contact === true && (!financial || actor.crmAccess.permissions.financial === true); }
async function reviewerDirectory(client: PoolClient, actor: Actor, row: CallRow) {
    (assert)(managesCall(actor, row) && actor.crmAccess?.permissions.assign && (canWorkspace)(actor.role, "assign", "partners"), 403, "TENDER_REVIEWER_MANAGEMENT", "Reviewer assignment requires current assignment permission.");
    const assigned = (await client.query<PgRow<'tender_reviewer_grants'>>("SELECT user_id,kind FROM tender_reviewer_grants WHERE call_id=$1 AND active", [row.id])).rows;
    const users = (await client.query<Pick<PgRow<'users'>,'id'|'email_verified'>>("SELECT id FROM users WHERE active AND mfa_enabled AND role IN ('business','admin','superAdmin') ORDER BY name,id LIMIT 300")).rows, candidates = [];
    for (const user of users) {
        const person = await priorReviewer(client, user.id);
        if (person && eligibleReviewer(person))
            candidates.push({ id: person.id, name: person.name, role: person.role, allowedLocales: locales.filter(locale => person.allowedLocales.includes(locale)), financial: person.crmAccess?.permissions.financial === true });
    }
    return { version: row.version, technicalUserIds: assigned.filter(value => value.kind === "technical").map(value => value.user_id), financialUserIds: assigned.filter(value => value.kind === "financial").map(value => value.user_id), candidates };
}
async function getTenderReviewers(actor: Actor, id: string) { return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor, true); return reviewerDirectory(client, actor, await callRow(client, id)); }); }
async function setTenderReviewers(actor: Actor, id: string, body: unknown) {
    const userIds = z.array(z.string().min(1).max(160)).max(25);
    const input = (parse)(z.object({ expectedVersion: z.number().int().positive(), technicalUserIds: userIds, financialUserIds: userIds }).strict(), body);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor, true);
        const row = await callRow(client, id);
        requireManagement(actor, row);
        (assert)(actor.crmAccess?.permissions.assign && (canWorkspace)(actor.role, "assign", "partners"), 403, "TENDER_REVIEWER_MANAGEMENT", "Reviewer assignment requires current assignment permission.");
        (assert)(row.version === input.expectedVersion, 409, "CONFLICT", "The tender or reviewer assignments changed.");
        (assert)(row.status !== "cancelled", 409, "TENDER_CANCELLED", "Cancelled calls cannot receive new reviewers.");
        for (const [kind, ids] of [["technical", input.technicalUserIds], ["financial", input.financialUserIds]] as const) {
            (assert)(new Set(ids).size === ids.length, 422, "TENDER_REVIEWERS", "Reviewer IDs must be unique.");
            for (const userId of ids) {
                const user = await priorReviewer(client, userId);
                (assert)(user && eligibleReviewer(user, kind === "financial") && user.allowedLocales.some(locale => (locales as readonly string[]).includes(locale)), 422, "TENDER_REVIEWERS", "A reviewer must currently have staff MFA, the partner role, contact access and the required financial permission.");
            }
            await client.query<PgRow<'tender_reviewer_grants'>>("UPDATE tender_reviewer_grants SET active=false,revoked_at=now() WHERE call_id=$1 AND kind=$2 AND active AND NOT(user_id=ANY($3::text[]))", [id, kind, ids]);
            for (const userId of ids)
                await client.query<PgRow<'tender_reviewer_grants'>>("INSERT INTO tender_reviewer_grants(call_id,user_id,kind,granted_by) VALUES($1,$2,$3,$4) ON CONFLICT(call_id,user_id,kind) DO UPDATE SET active=true,revoked_at=NULL,granted_by=excluded.granted_by,granted_at=now()", [id, userId, kind, actor.id]);
        }
        await client.query("UPDATE tender_calls SET version=version+1,updated_at=now() WHERE id=$1", [id]);
        await (audit)(actor.id, "tender.reviewers.changed", "tender", id, { technicalUserIds: input.technicalUserIds, financialUserIds: input.financialUserIds }, client);
        return reviewerDirectory(client, actor, await callRow(client, id));
    });
}
async function bidRow(client: PoolClient, id: string) { validId(id); const row = (await client.query<BidRow>("SELECT * FROM tender_bids WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Proposal not found."); return row; }
async function bidRevision(client: PoolClient, bid: BidRow, revisionId = bid.current_revision_id) { validId(revisionId); const revision = (await client.query<BidRevisionRow>("SELECT * FROM tender_bid_revisions WHERE id=$1 AND bid_id=$2", [revisionId, bid.id])).rows[0]; (assert)(revision, 404, "NOT_FOUND", "Proposal revision not found."); return revision; }
async function bidRequest(client: PoolClient, bid: BidRow) { const row = (await client.query<RequestRow>("SELECT * FROM requests WHERE id=$1", [bid.request_id])).rows[0]; (assert)(row && row.kind === "outsourcing_bid" && row.owner_id === bid.owner_id, 500, "TENDER_INTEGRITY", "The proposal receipt is inconsistent."); return row; }
function inRequestScope(actor: Actor, row: RequestRow) { return (canAccessCrmRequest)(actor, { id: row.id, kind: row.kind, qualityQuarantined: row.quality_quarantined, assigneeId: row.assignee_id, teamId: row.team_id, territoryId: row.territory_id }); }
async function bidAccess(client: PoolClient, actor: Actor, bid: BidRow, call: CallRow, revisionId = bid.current_revision_id) { const owner = actor.id === bid.owner_id, request = await bidRequest(client, bid), assigned = await grants(client, actor, call.id), scoped = staffRole(actor) && actor.allowedLocales.includes(bid.locale) && inRequestScope(actor, request); (assert)(owner || scoped && (managesCall(actor, call) || assigned.technical || assigned.financial), 404, "NOT_FOUND", "Proposal not found in your current scope."); const current = revisionId === bid.current_revision_id, available = current && call.status !== "cancelled" && bid.status !== "withdrawn" && call.deadline_at.getTime() <= Date.now(), contact = owner || scoped && actor.crmAccess?.permissions.contact === true; const technical = scoped && assigned.technical && eligibleReviewer(actor), financial = scoped && assigned.financial && eligibleReviewer(actor, true); const editable = owner && actor.role === "customer" && call.status === "open" && call.opens_at.getTime() <= Date.now() && call.deadline_at.getTime() > Date.now() && bid.status === "submitted"; return { owner, contact, request, capabilities: { replace: editable && current, withdraw: editable && current, readTechnical: owner || available && technical, readFinancial: owner || available && financial && bid.status === "financial_open", reviewTechnical: !owner && available && technical && ["submitted", "technical_accepted", "technical_rejected"].includes(bid.status), openFinance: !owner && available && financial && bid.status === "technical_accepted" && bid.technical_reviewed_by !== actor.id } }; }
function protectedSnapshot<T>(encrypted: string, expectedHash: string): T {
    let value: T;
    try {
        value = JSON.parse((decrypt)(encrypted));
    }
    catch {
        throw new HttpError(500, "TENDER_INTEGRITY", "The encrypted proposal snapshot could not be read.");
    }
    (assert)((checksum)(value) === expectedHash, 500, "TENDER_INTEGRITY", "The immutable proposal snapshot checksum differs.");
    return value;
}
function contactSnapshot(revision: BidRevisionRow) { const value = protectedSnapshot<ContactSnapshot>(revision.contact_encrypted, revision.contact_hash); (assert)(value.bidId === revision.bid_id && value.revisionId === revision.id, 500, "TENDER_INTEGRITY", "The contact snapshot belongs to a different proposal revision."); return value; }
async function summaryDto(client: PoolClient, actor: Actor, bid: BidRow, call: CallRow, revision?: BidRevisionRow) { revision ??= await bidRevision(client, bid); const access = await bidAccess(client, actor, bid, call, revision.id), contact = access.contact ? contactSnapshot(revision) : null; return { id: bid.id, callId: bid.call_id, requestId: bid.request_id, locale: bid.locale, title: call.definition.title[bid.locale], status: bid.status, version: bid.version, revisionId: revision.id, revisionNumber: revision.number, submittedAt: revision.submitted_at.toISOString(), deadlineAt: call.deadline_at.toISOString(), participant: contact ? { name: contact.name, organization: contact.organization } : null, capabilities: access.capabilities }; }
async function envelopeDto(client: PoolClient, bid: BidRow, revisionId: string, kind: EnvelopeKind) { const stored = (await client.query<PgRow<'tender_envelopes'>>("SELECT payload_encrypted,payload_hash FROM tender_envelopes WHERE bid_id=$1 AND revision_id=$2 AND kind=$3", [bid.id, revisionId, kind])).rows[0]; (assert)(stored, 500, "TENDER_INTEGRITY", "A submitted envelope is missing."); const value = protectedSnapshot<EnvelopeSnapshot>(stored.payload_encrypted, stored.payload_hash); (assert)(value.bidId === bid.id && value.revisionId === revisionId && value.kind === kind, 500, "TENDER_INTEGRITY", "The encrypted envelope belongs to a different revision."); const retained = (await client.query<PgRow<'tender_asset_refs'>>("SELECT asset_id FROM tender_asset_refs WHERE bid_id=$1 AND revision_id=$2 AND kind=$3 ORDER BY asset_id", [bid.id, revisionId, kind])).rows.map(row => row.asset_id); (assert)((checksum)(retained) === (checksum)(value.files.map(file => file.id).sort()), 500, "TENDER_INTEGRITY", "The submitted envelope file references are inconsistent."); return { kind, body: value.body, files: value.files, sha256: stored.payload_hash, ...kind === "financial" ? { amountDecimal: value.amountDecimal, currency: value.currency } : {} }; }
async function viewDto(client: PoolClient, actor: Actor, bid: BidRow, revisionId?: string) {
    const call = await callRow(client, bid.call_id), revision = await bidRevision(client, bid, revisionId), access = await bidAccess(client, actor, bid, call, revision.id), summary = await summaryDto(client, actor, bid, call, revision), contact = access.contact ? contactSnapshot(revision) : null;
    if (revision.id !== bid.current_revision_id)
        (assert)(access.owner, 404, "NOT_FOUND", "Superseded private envelopes are visible only to their submitting account.");
    const revisions = (await client.query<BidRevisionRow>("SELECT id,number,submitted_at FROM tender_bid_revisions WHERE bid_id=$1 ORDER BY number DESC LIMIT 100", [bid.id])).rows;
    const events = (await client.query<PgRow<'tender_bid_events'>>("SELECT id,action,created_at,reason FROM tender_bid_events WHERE bid_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100", [bid.id])).rows;
    return { ...summary, call: publicDto(call, bid.locale), contact: contact ? { name: contact.name, email: contact.email, organization: contact.organization, phone: contact.phone, country: contact.country } : null, technical: access.capabilities.readTechnical ? await envelopeDto(client, bid, revision.id, "technical") : null, financial: access.capabilities.readFinancial ? await envelopeDto(client, bid, revision.id, "financial") : null, revisions: revisions.map(value => ({ id: value.id, number: value.number, submittedAt: value.submitted_at.toISOString(), current: value.id === bid.current_revision_id, readable: access.owner || value.id === bid.current_revision_id })), events: events.map(value => ({ id: value.id, action: value.action, at: value.created_at.toISOString(), reason: access.owner || (value.action === "finance_opened" ? access.capabilities.readFinancial : access.capabilities.readTechnical) ? value.reason : "" })) };
}
async function getTenderBid(actor: Actor, bidId: string, revisionId?: string) { return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor); return viewDto(client, actor, await bidRow(client, bidId), revisionId); }); }
function cursor(value: string|undefined, actor: Actor, purpose: string, filterHash: string): string|null {
    if (!value)
        return null;
    try {
        const row = JSON.parse((decrypt)(value));
        (assert)(row.purpose === purpose && row.actorId === actor.id && row.filterHash === filterHash && typeof row.id === "string" && uuidSchema.safeParse(row.id).success && row.expiresAt > Date.now(), 422, "INVALID_CURSOR", "This cursor belongs to another tender search or has expired.");
        return row.id;
    }
    catch {
        throw new HttpError(422, "INVALID_CURSOR", "Invalid or expired tender cursor.");
    }
}
const nextCursor = (actor: Actor, purpose: string, filterHash: string, id: string) => (encrypt)(JSON.stringify({ actorId: actor.id, purpose, filterHash, id, expiresAt: Date.now() + 36e5 }));
async function listOwnTenderBids(actor: Actor, query = {}) {
    const input = (parse)(selectorSchema, query);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor);
        const filter = (checksum)({ search: input.search, limit: input.limit }), after = cursor(input.cursor, actor, "own-tender-bids", filter), rows = (await client.query<BidRow>("SELECT * FROM tender_bids WHERE owner_id=$1" + (after ? " AND id>$2::uuid" : "") + " ORDER BY id LIMIT 501", after ? [actor.id, after] : [actor.id])).rows;
        const items = [];
        let last = null, visited = 0;
        for (const row of rows.slice(0, 500)) {
            last = row.id;
            visited++;
            const call = await callRow(client, row.call_id), item = await summaryDto(client, actor, row, call);
            if (input.search && !JSON.stringify([item.id, item.requestId, item.title, item.participant]).toLocaleLowerCase().includes(input.search.toLocaleLowerCase()))
                continue;
            items.push(item);
            if (items.length === input.limit)
                break;
        }
        return { items, nextCursor: last && rows.length > visited ? nextCursor(actor, "own-tender-bids", filter, last) : null };
    });
}
async function listTenderBids(actor: Actor, callId: string, query = {}) {
    const input = (parse)(selectorSchema, query);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor, true);
        const call = await callRow(client, callId), assigned = await grants(client, actor, callId);
        (assert)(managesCall(actor, call) || assigned.technical || assigned.financial, 404, "NOT_FOUND", "Tender not found.");
        const filter = (checksum)({ callId, search: input.search, limit: input.limit }), after = cursor(input.cursor, actor, "staff-tender-bids", filter), rows = (await client.query<BidRow>("SELECT * FROM tender_bids WHERE call_id=$1" + (after ? " AND id>$2::uuid" : "") + " ORDER BY id LIMIT 501", after ? [callId, after] : [callId])).rows;
        const items = [];
        let last = null, visited = 0;
        for (const row of rows.slice(0, 500)) {
            last = row.id;
            visited++;
            try {
                const item = await summaryDto(client, actor, row, call);
                if (input.search && !JSON.stringify([item.id, item.requestId, item.title, item.participant]).toLocaleLowerCase().includes(input.search.toLocaleLowerCase()))
                    continue;
                items.push(item);
                if (items.length === input.limit)
                    break;
            }
            catch (error) {
                if (!(error instanceof HttpError) || error.status !== 404)
                    throw error;
            }
        }
        return { items, nextCursor: last && rows.length > visited ? nextCursor(actor, "staff-tender-bids", filter, last) : null };
    });
}
async function verifiedBidder(client: PoolClient, actor: Actor) { actor = await currentActor(client, actor); (assert)(actor.role === "customer", 403, "TENDER_BIDDER", "Submit a tender using a verified customer account."); const user = (await client.query<Pick<PgRow<'users'>,'id'|'email_verified'>>("SELECT email_verified FROM users WHERE id=$1 AND active FOR SHARE", [actor.id])).rows[0]; (assert)(user?.email_verified, 403, "EMAIL_VERIFICATION_REQUIRED", "Verify the email of this account before submitting a confidential proposal."); return actor; }
function submissionWindow(call: CallRow, input: BidInput) { (assert)(call.status === "open" && call.published_revision_id === input.callRevisionId && call.current_revision_id === input.callRevisionId, 409, "TENDER_CHANGED", "The call is no longer accepting proposals for this reviewed version."); (assert)(call.opens_at.getTime() <= Date.now() && call.deadline_at.getTime() > Date.now(), 409, "TENDER_DEADLINE", "The submission window is closed."); const all = [...input.technical.assetIds, ...input.financial.assetIds]; (assert)(new Set(all).size === all.length, 422, "TENDER_ASSET_CATEGORY", "Each file must belong to exactly one of the two envelopes."); }
async function selectedDocuments(client: PoolClient, actor: Actor, bidId: string, kind: EnvelopeKind, ids: string[]): Promise<TenderFile[]> {
    const files = [];
    for (const id of ids) {
        const asset = (await client.query<PgRow<'assets',{metadata:Record<string,unknown>}>>("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL AND storage_purged_at IS NULL FOR UPDATE", [id])).rows[0];
        (assert)(asset && asset.owner_id === actor.id && asset.visibility === "private" && !asset.request_id && ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(asset.mime_type) && !["original"].includes(String(asset.metadata.damRole)), 404, "TENDER_ASSET", "Select your own, unbound private PDF or DOCX document.");
        (assert)(asset.scan_status === "clean", 409, "QUARANTINED", "Every envelope document must pass its security scan before submission.");
        (assert)(await (assetUsageAllowed)(id, client), 410, "RIGHTS_EXPIRED", "A selected document is unavailable under its current usage policy.");
        const retention = (await client.query(`SELECT 1 FROM resource_versions WHERE asset_id=$1 UNION ALL SELECT 1 FROM crm_domain_asset_refs WHERE asset_id=$1 UNION ALL SELECT 1 FROM shared_block_asset_refs WHERE asset_id=$1 UNION ALL SELECT 1 FROM asset_image_sources WHERE asset_id=$1 OR original_asset_id=$1 UNION ALL SELECT 1 FROM asset_image_derivatives WHERE asset_id=$1 OR source_asset_id=$1 LIMIT 1`, [id])).rowCount;
        (assert)(!retention, 409, "ASSET_IN_USE", "The selected file is already retained by another private or published workflow.");
        const binding = (await client.query<PgRow<'tender_asset_bindings'>>("SELECT bid_id,kind FROM tender_asset_bindings WHERE asset_id=$1", [id])).rows[0];
        (assert)(!binding || binding.bid_id === bidId && binding.kind === kind, 409, "ASSET_IN_USE", "The selected file belongs to another bid or confidentiality category.");
        files.push({ id, name: asset.name, mimeType: asset.mime_type, bytes: Number(asset.bytes), sha256: asset.sha256 });
    }
    return files;
}
async function persistBidRevision(client: PoolClient, actor: Actor, bid: BidRow, call: CallRow, input: BidInput, revisionId: string, number: number) {
    const technical = await selectedDocuments(client, actor, bid.id, "technical", input.technical.assetIds), financial = await selectedDocuments(client, actor, bid.id, "financial", input.financial.assetIds), at = new Date().toISOString();
    const contact = { bidId: bid.id, revisionId, name: actor.name, email: actor.email, organization: input.organization, phone: input.phone, country: input.country };
    await client.query<BidRevisionRow>("INSERT INTO tender_bid_revisions(id,bid_id,call_id,call_revision_id,number,contact_encrypted,contact_hash,consent_snapshot,submitted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)", [revisionId, bid.id, call.id, input.callRevisionId, number, (encrypt)(JSON.stringify(contact)), (checksum)(contact), JSON.stringify({ purpose: "request_processing", policyVersion: "tender-envelopes-2026-10-19", acceptedAt: at, clientAcceptedAt: input.consent.acceptedAt }), actor.id]);
    for (const [kind, files] of [["technical", technical], ["financial", financial]] as const) {
        const payload = { bidId: bid.id, revisionId, kind, body: input[kind].body, files, ...kind === "financial" ? { amountDecimal: input.financial.amountDecimal, currency: input.financial.currency } : {} };
        await client.query<PgRow<'tender_envelopes'>>("INSERT INTO tender_envelopes(bid_id,revision_id,kind,payload_encrypted,payload_hash) VALUES($1,$2,$3,$4,$5)", [bid.id, revisionId, kind, (encrypt)(JSON.stringify(payload)), (checksum)(payload)]);
        for (const file of files) {
            await client.query<PgRow<'tender_asset_bindings'>>("INSERT INTO tender_asset_bindings(asset_id,bid_id,kind) VALUES($1,$2,$3) ON CONFLICT(asset_id) DO NOTHING", [file.id, bid.id, kind]);
            await client.query<PgRow<'tender_asset_refs'>>("INSERT INTO tender_asset_refs(bid_id,revision_id,kind,asset_id) VALUES($1,$2,$3,$4)", [bid.id, revisionId, kind, file.id]);
        }
    }
}
async function bidEvent(client: PoolClient, actor: Actor, bid: BidRow, action: PgRow<'tender_bid_events'>['action'], reason: string) { await client.query<PgRow<'tender_bid_events'>>("INSERT INTO tender_bid_events(id,bid_id,revision_id,action,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)", [(randomUUID)(), bid.id, bid.current_revision_id, action, actor.id, reason]); await (audit)(actor.id, "tender.bid." + action, "tender-bid", bid.id, { callId: bid.call_id, requestId: bid.request_id, revisionId: bid.current_revision_id }, client); }
async function replay(client: PoolClient, actor: Actor, key: string, purpose: string, inputHash: string) {
    (assert)(/^[A-Za-z0-9_.:-]{8,128}$/.test(key), 422, "IDEMPOTENCY_KEY", "Send a valid Idempotency-Key header.");
    const scope = purpose + ":" + actor.id;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [scope + ":" + key]);
    const row = (await client.query<PgRow<'idempotency_keys',{response:{bidId:string}}>>("SELECT request_hash,response FROM idempotency_keys WHERE scope=$1 AND key=$2", [scope, key])).rows[0];
    if (row) {
        (assert)(row.request_hash === inputHash, 409, "IDEMPOTENCY_CONFLICT", "This submission key was already used for different envelopes.");
        const bid = await bidRow(client, row.response.bidId);
        (assert)(bid.owner_id === actor.id, 404, "NOT_FOUND", "Proposal not found.");
        return bid;
    }
    return null;
}
async function remember(client: PoolClient, actor: Actor, key: string, purpose: string, inputHash: string, bidId: string) { await client.query<PgRow<'idempotency_keys',{response:{bidId:string}}>>("INSERT INTO idempotency_keys(scope,key,request_hash,response) VALUES($1,$2,$3,$4::jsonb)", [purpose + ":" + actor.id, key, inputHash, JSON.stringify({ bidId })]); }
async function submitTenderBid(request: Request, actor: Actor, callId: string, body: unknown, idempotencyKey: string) {
    validId(callId);
    const input = (parse)(bidSchema, body);
    await (rateLimit)("tender-submit:" + actor.id, 30, 3600);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await verifiedBidder(client, actor);
        const inputHash = (checksum)({ callId, input }), previous = await replay(client, actor, idempotencyKey, "tender-submit", inputHash);
        if (previous)
            return viewDto(client, actor, previous);
        const call = await callRow(client, callId);
        submissionWindow(call, input);
        (assert)(!(await client.query<BidRow>("SELECT 1 FROM tender_bids WHERE call_id=$1 AND owner_id=$2", [callId, actor.id])).rowCount, 409, "TENDER_BID_EXISTS", "This account has already submitted a bid for the call. Revise its existing bid before the deadline.");
        const bidId = (randomUUID)(), revisionId = (randomUUID)();
        const receipt = await (createTenderRequestInTransaction)(client, request, actor, { kind: "outsourcing_bid", name: actor.name, email: actor.email, organization: input.organization, phone: input.phone, country: input.country, locale: input.locale, message: "Confidential tender proposal submitted: " + call.definition.title[input.locale] + ". Use the dedicated tender workflow to review its separate envelopes.", productIds: [], attachmentIds: [], consent: input.consent }, idempotencyKey);
        await client.query<BidRow>("INSERT INTO tender_bids(id,call_id,request_id,owner_id,locale,current_revision_id) VALUES($1,$2,$3,$4,$5,$6)", [bidId, callId, receipt.id, actor.id, input.locale, revisionId]);
        const bid = await bidRow(client, bidId);
        await persistBidRevision(client, actor, bid, call, input, revisionId, 1);
        await bidEvent(client, actor, bid, "submitted", "Both confidential envelopes submitted with explicit processing consent.");
        await remember(client, actor, idempotencyKey, "tender-submit", inputHash, bid.id);
        return viewDto(client, actor, bid);
    });
}
async function replaceTenderBid(request: Request, actor: Actor, bidId: string, body: unknown, idempotencyKey: string) {
    void request;
    const input = (parse)(bidSchema.extend({ expectedVersion: z.number().int().positive() }).strict(), body);
    await (rateLimit)("tender-replace:" + actor.id, 30, 3600);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await verifiedBidder(client, actor);
        const inputHash = (checksum)({ bidId, input }), previous = await replay(client, actor, idempotencyKey, "tender-replace", inputHash);
        if (previous)
            return viewDto(client, actor, previous);
        const bid = await bidRow(client, bidId), call = await callRow(client, bid.call_id);
        (assert)(bid.owner_id === actor.id, 404, "NOT_FOUND", "Proposal not found.");
        (assert)(bid.version === input.expectedVersion, 409, "CONFLICT", "The proposal changed. Reload the saved revision.");
        submissionWindow(call, input);
        (assert)(bid.status === "submitted" && input.locale === bid.locale, 409, "TENDER_FROZEN", "A withdrawn or reviewed proposal, or its language, cannot be replaced.");
        const prior = await bidRevision(client, bid);
        (assert)(prior.number < 100, 422, "TENDER_REVISION_LIMIT", "This proposal reached the bounded revision history limit.");
        const revisionId = (randomUUID)();
        await persistBidRevision(client, actor, bid, call, input, revisionId, prior.number + 1);
        await client.query<BidRow>("UPDATE tender_bids SET current_revision_id=$2,version=version+1,updated_at=now() WHERE id=$1", [bid.id, revisionId]);
        const updated = await bidRow(client, bid.id);
        await bidEvent(client, actor, updated, "revised", "The submitting account replaced both envelopes before the published deadline.");
        await remember(client, actor, idempotencyKey, "tender-replace", inputHash, bid.id);
        return viewDto(client, actor, updated);
    });
}
async function assertTenderRequestStatusChange(client: PoolClient, requestId: string, status: string|undefined, currentStatus: string) {
    if (status !== currentStatus)
        (assert)(!(await client.query<BidRow>("SELECT 1 FROM tender_bids WHERE request_id=$1", [requestId])).rowCount, 409, "TENDER_COMMAND_REQUIRED", "Change a confidential bid through its dedicated tender workflow.");
}
async function syncReceipt(client: PoolClient, bid: BidRow, status: string) { const row = await bidRequest(client, bid), data = { ...row.data, status, version: row.version + 1 }; await client.query<RequestRow>("UPDATE requests SET data=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1", [row.id, JSON.stringify(data)]); await (upsertRequestInWorkspace)(client, { ...data, ownerId: row.owner_id || "guest", qualityQuarantined: row.quality_quarantined }); }
async function withdrawTenderBid(actor: Actor, bidId: string, body: unknown) { const input = (parse)(z.object({ expectedVersion: z.number().int().positive(), reason: reasonSchema }).strict(), body); return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await verifiedBidder(client, actor); const bid = await bidRow(client, bidId), call = await callRow(client, bid.call_id); (assert)(actor.id === bid.owner_id, 404, "NOT_FOUND", "Proposal not found."); (assert)(bid.version === input.expectedVersion, 409, "CONFLICT", "The proposal changed."); const access = await bidAccess(client, actor, bid, call); (assert)(access.capabilities.withdraw, 409, "TENDER_DEADLINE", "Only the current unreviewed proposal can be withdrawn before the deadline."); await client.query<BidRow>("UPDATE tender_bids SET status='withdrawn',version=version+1,updated_at=now() WHERE id=$1", [bidId]); const updated = await bidRow(client, bidId); await syncReceipt(client, updated, "withdrawn"); await bidEvent(client, actor, updated, "withdrawn", input.reason); return viewDto(client, actor, updated); }); }
async function reviewTenderTechnical(actor: Actor, bidId: string, body: unknown) { const input = (parse)(z.object({ expectedVersion: z.number().int().positive(), decision: z.enum(["accepted", "rejected"]), reason: reasonSchema }).strict(), body); return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor, true); const bid = await bidRow(client, bidId), call = await callRow(client, bid.call_id), access = await bidAccess(client, actor, bid, call); (assert)(bid.version === input.expectedVersion, 409, "CONFLICT", "The proposal or its review changed."); (assert)(access.capabilities.reviewTechnical, 403, "TENDER_TECHNICAL_REVIEW", "A current technical reviewer can review only after the deadline."); const status = input.decision === "accepted" ? "technical_accepted" : "technical_rejected"; await client.query<BidRow>("UPDATE tender_bids SET status=$2,technical_reviewed_by=$3,technical_reviewed_at=now(),version=version+1,updated_at=now() WHERE id=$1", [bidId, status, actor.id]); const updated = await bidRow(client, bidId); await syncReceipt(client, updated, input.decision === "accepted" ? "in_review" : "closed"); await bidEvent(client, actor, updated, status, input.reason); return viewDto(client, actor, updated); }); }
async function openTenderFinance(actor: Actor, bidId: string, body: unknown) { const input = (parse)(z.object({ expectedVersion: z.number().int().positive(), reason: reasonSchema }).strict(), body); return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor, true); const bid = await bidRow(client, bidId), call = await callRow(client, bid.call_id), access = await bidAccess(client, actor, bid, call); (assert)(bid.version === input.expectedVersion, 409, "CONFLICT", "The proposal or its review changed."); (assert)(access.capabilities.openFinance, 403, "TENDER_FINANCE_OPEN", "A separate current financial reviewer may open an accepted technical proposal only after the deadline."); const reviewer = bid.technical_reviewed_by ? await priorReviewer(client, bid.technical_reviewed_by) : null, request = await bidRequest(client, bid), priorGrants = reviewer ? await grants(client, reviewer, call.id) : null; (assert)(reviewer && eligibleReviewer(reviewer) && reviewer.allowedLocales.includes(bid.locale) && inRequestScope(reviewer, request) && priorGrants?.technical, 409, "TENDER_REVIEW_STALE", "The technical approval no longer has an authorized reviewer. Have the technical envelope reviewed again."); await client.query<BidRow>("UPDATE tender_bids SET status='financial_open',finance_opened_by=$2,finance_opened_at=now(),version=version+1,updated_at=now() WHERE id=$1", [bidId, actor.id]); const updated = await bidRow(client, bidId); await syncReceipt(client, updated, "in_review"); await bidEvent(client, actor, updated, "finance_opened", input.reason); return viewDto(client, actor, updated); }); }
async function authorizeTenderEnvelopeAsset(client: PoolClient, actor: Actor, bidId: string, revisionId: string, kind: string, assetId: string) { (parse)(z.enum(["technical", "financial"]), kind); validId(assetId); actor = await currentActor(client, actor); const bid = await bidRow(client, bidId), call = await callRow(client, bid.call_id); await bidRevision(client, bid, revisionId); const access = await bidAccess(client, actor, bid, call, revisionId); (assert)(kind === "technical" ? access.capabilities.readTechnical : access.capabilities.readFinancial, 404, "NOT_FOUND", "This confidential envelope is not available to the current account."); const value = await envelopeDto(client, bid, revisionId, kind as EnvelopeKind); const file = value.files.find(item => item.id === assetId); (assert)(file, 404, "NOT_FOUND", "The file does not belong to this immutable envelope."); const asset = (await client.query<PgRow<'assets',{metadata:Record<string,unknown>}>>("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL AND storage_purged_at IS NULL AND visibility='private' FOR SHARE", [assetId])).rows[0]; (assert)(asset && asset.owner_id === bid.owner_id && !asset.request_id && asset.sha256 === file.sha256 && Number(asset.bytes) === file.bytes, 409, "TENDER_ASSET_CHANGED", "The retained envelope file no longer matches its submitted snapshot."); (assert)(asset.scan_status === "clean", 409, "QUARANTINED", "The retained file is currently quarantined."); (assert)(await (assetUsageAllowed)(assetId, client), 410, "RIGHTS_EXPIRED", "This document is unavailable under its current usage policy."); await (audit)(actor.id, "tender.envelope.download", "tender-bid", bid.id, { revisionId, kind, assetId }, client); }
export { assertTenderRequestStatusChange, authorizeTenderEnvelopeAsset, changeTenderState, createTender, getManagedTender, getPublicTender, getTenderBid, getTenderReviewers, listManagedTenders, listOwnTenderBids, listPublicTenders, listTenderBids, openTenderFinance, replaceTenderBid, reviewTender, reviewTenderTechnical, setTenderReviewers, submitTenderBid, updateTender, withdrawTenderBid };
