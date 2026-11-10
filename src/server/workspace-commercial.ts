import type {PgRow} from './recovered-db-rows';
import type {WorkspaceRecord} from '../data/workspace-seed';
import type {CommercialDraft} from '../components/workspace/crm-tools-logic';
import type {Localized} from '../lib/i18n';
import type {CommercialPolicy} from '../types/commercial';
import type {FrontRequest} from '../types/frontend';
type PolicyRow = PgRow<'crm_commercial_policies',{discount_ceilings:CommercialPolicy['discountCeilings']}>;
type PricebookRow = PgRow<'crm_pricebook_revisions',{title:Localized}> & {source:WorkspaceRecord;deleted_at:Date|null;source_status:string;head_revision_id:string|null};
type CommercialRevision = {id:string;checksum:string};
import type { Actor } from './types';
import type { PoolClient } from 'pg';
import type { Locale } from '../lib/i18n';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { assert } from "./types";
import { roles, canWorkspace } from "../lib/auth";
import { query, transaction, audit } from "./db";
import { loadCrmAccess, canAccessCrmRequest } from "./workspace-scopes";
import { parse } from "./http";
import { readableRecord, canReviewSource, checksum } from "./workspace-policy";
import { calculateCommercial } from "../components/workspace/crm-tools-logic";
import { randomUUID } from "node:crypto";
import { defaultSitePreferences } from "./workspace-preferences";
const calculationPolicyVersion = "local-line-half-up-v1";
const uuid = z.string().uuid();
const decimalPattern = /^\d{1,24}(?:\.\d{1,6})?$/;
const units = (value: string) => { (assert)(decimalPattern.test(value), 422, "COMMERCIAL_DECIMAL", "Use an exact non-negative decimal string."); const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0")); };
const formatUnits = (scaled: bigint) => { const whole = scaled / 1000000n, fraction = (scaled % 1000000n).toString().padStart(6, "0").replace(/0+$/, ""); return whole.toString() + (fraction ? "." + fraction : ""); };
const decimal = (value: string) => formatUnits(units(value));
const percentage = z.string().regex(/^\d{1,3}(?:\.\d{1,6})?$/).refine(value => units(value) <= 100000000n, "Discount ceilings cannot exceed 100 percent.");
const policySchema = z.object({ expectedVersion: z.number().int().min(1), discountCeilings: z.partialRecord(z.enum(roles), percentage) }).strict();
const pricebookPolicySchema = z.object({ schemaVersion: z.literal(1), market: z.string().trim().min(1).max(80), validFrom: z.string().datetime().optional(), validUntil: z.string().datetime().optional() }).strict();
const financial = (actor: Actor) => (assert)(actor.mfaVerified && actor.crmAccess?.permissions.financial === true, 403, "CRM_FINANCIAL_REQUIRED", "This operation requires current financial permission.");
async function policy(client?: PoolClient) { const result = client ? await client.query<PolicyRow>("SELECT * FROM crm_commercial_policies ORDER BY version DESC LIMIT 1") : await (query)<PolicyRow>("SELECT * FROM crm_commercial_policies ORDER BY version DESC LIMIT 1"); const row = result.rows[0]; (assert)(row, 503, "COMMERCIAL_POLICY_MISSING", "The commercial policy migration is required."); return { version: Number(row.version), discountCeilings: row.discount_ceilings, createdAt: row.created_at.toISOString() }; }
async function getCommercialPolicy(actor: Actor) { actor = await (loadCrmAccess)(actor); financial(actor); (assert)((canWorkspace)(actor.role, "view", "quotes") || (canWorkspace)(actor.role, "view", "pricebooks"), 403, "FORBIDDEN", "Commercial access is required."); return policy(); }
async function saveCommercialPolicy(actor: Actor, body: unknown) { const input = (parse)(policySchema, body); (assert)(Object.keys(input.discountCeilings).length > 0, 422, "EMPTY_PATCH", "Supply at least one role ceiling."); return (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE"); actor = await (loadCrmAccess)(actor, client); (assert)(actor.role === "superAdmin" && actor.mfaVerified, 403, "FORBIDDEN", "Only the senior administrator may change discount policy."); const current = await policy(client); (assert)(current.version === input.expectedVersion, 409, "CONFLICT", "The commercial policy changed. Refresh and retry."); const ceilings = { ...current.discountCeilings, ...Object.fromEntries(Object.entries(input.discountCeilings).map(([role, limit]) => [role, decimal(limit)])) }; await client.query("INSERT INTO crm_commercial_policies(discount_ceilings,created_by) VALUES($1::jsonb,$2)", [JSON.stringify(ceilings), actor.id]); const next = await policy(client); await (audit)(actor.id, "crm.commercial_policy.updated", "commercial_policy", String(next.version), { roles: Object.keys(input.discountCeilings), previousVersion: current.version }, client); return next; }); }
function validateCommercialMetadata(record: WorkspaceRecord) {
    const draft = record.details?.commercialDraft as CommercialDraft | undefined;
    if (draft?.pricebookRevisionId !== void 0)
        (parse)(uuid, draft.pricebookRevisionId);
    if (record.details?.pricebookPolicy !== void 0) {
        (assert)(record.collection === "pricebooks", 422, "PRICEBOOK_POLICY", "Pricebook policy belongs to a pricebook record.");
        (parse)(pricebookPolicySchema, record.details.pricebookPolicy);
    }
}
async function currentReviewer(client: PoolClient, id: string) { const user = (await client.query<PgRow<'users',{allowed_locales: string[]}>>("SELECT id,name,email,role,quality_scope,allowed_locales,mfa_enabled,active FROM users WHERE id=$1", [id])).rows[0]; return user?.active && user.mfa_enabled ? (loadCrmAccess)({ id: user.id, name: user.name, email: user.email, role: user.role, qualityScope: user.quality_scope, allowedLocales: user.allowed_locales, mfaVerified: true }, client) : null; }
async function versionDto(client: PoolClient, row: PricebookRow) { const entries = (await client.query<PgRow<'crm_price_entries'>>("SELECT line_id,product_id,title_snapshot,unit,unit_price::text FROM crm_price_entries WHERE revision_id=$1 ORDER BY line_id", [row.id])).rows; return { id: row.id, pricebookId: row.pricebook_id, version: row.version, title: row.title, market: row.market, currency: row.currency, validFrom: row.valid_from.toISOString(), ...row.valid_until ? { validUntil: row.valid_until.toISOString() } : {}, checksum: row.snapshot_hash, approvedById: row.approved_by, approvedAt: row.approved_at.toISOString(), entries: entries.map(entry => ({ id: entry.line_id, productId: entry.product_id, titleSnapshot: entry.title_snapshot, unit: entry.unit, unitPriceDecimal: decimal(entry.unit_price), currency: row.currency })) }; }
const pricebookSelect = `SELECT r.*,e.data AS source,e.deleted_at,e.status AS source_status,h.revision_id AS head_revision_id FROM crm_pricebook_revisions r JOIN workspace_entities e ON e.bucket='records' AND e.id=r.pricebook_id LEFT JOIN crm_pricebook_heads h ON h.pricebook_id=r.pricebook_id`;
async function validPricebook(client: PoolClient, actor: Actor, id: string, enforceCurrent: boolean) {
    (parse)(uuid, id);
    const row = (await client.query<PricebookRow>(pricebookSelect + " WHERE r.id=$1", [id])).rows[0];
    (assert)(row && !row.deleted_at && (readableRecord)(actor, row.source), 404, "PRICEBOOK_NOT_FOUND", "The pricebook revision is unavailable in your scope.");
    if (enforceCurrent) {
        (assert)(row.head_revision_id === row.id && !["inactive", "archived"].includes(row.source_status), 409, "PRICEBOOK_SUPERSEDED", "Select the current approved pricebook revision.");
        (assert)(row.valid_from.getTime() <= Date.now() && (!row.valid_until || row.valid_until.getTime() > Date.now()), 409, "PRICEBOOK_EXPIRED", "The pricebook revision is outside its validity period.");
        const reviewer = await currentReviewer(client, row.approved_by);
        (assert)(reviewer && (readableRecord)(reviewer, row.source) && (canReviewSource)(reviewer, { ...row.source, authorId: row.maker_id }), 409, "PRICEBOOK_APPROVER_REVOKED", "The pricebook needs a current authorized independent reviewer.");
    }
    return { row, version: await versionDto(client, row) };
}
async function listPricebookVersions(actor: Actor) {
    return (transaction)(async (client) => {
        await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR SHARE");
        actor = await (loadCrmAccess)(actor, client);
        financial(actor);
        (assert)((canWorkspace)(actor.role, "view", "pricebooks"), 403, "FORBIDDEN", "Pricebook access is required.");
        const rows = (await client.query<PricebookRow>(pricebookSelect + " WHERE h.revision_id=r.id AND e.deleted_at IS NULL AND e.status NOT IN ('inactive','archived') AND r.valid_from<=now() AND (r.valid_until IS NULL OR r.valid_until>now()) ORDER BY r.market,r.currency,r.pricebook_id")).rows;
        const items = [];
        for (const row of rows)
            if ((readableRecord)(actor, row.source)) {
                const reviewer = await currentReviewer(client, row.approved_by);
                if (reviewer && (readableRecord)(reviewer, row.source) && (canReviewSource)(reviewer, { ...row.source, authorId: row.maker_id }))
                    items.push(await versionDto(client, row));
            }
        return { items };
    });
}
async function approvePricebook(client: PoolClient, actor: Actor, source: WorkspaceRecord, revision: CommercialRevision) {
    financial(actor);
    (assert)(source.collection === "pricebooks" && (canReviewSource)(actor, source), 403, "FORBIDDEN", "An independent commercial reviewer is required.");
    const draft = source.details?.commercialDraft as CommercialDraft | undefined;
    (assert)(draft?.kind === "pricebook" && draft.schemaVersion === 1 && draft.currency === source.currency, 422, "PRICEBOOK_LINES", "Complete the typed pricebook before approval.");
    const calculation = (calculateCommercial)(draft.lines, draft.currency);
    (assert)(calculation.ok && calculation.value.complete, 422, "PRICEBOOK_LINES", "Every pricebook entry requires a known price in the selected currency.");
    const definition: z.infer<typeof pricebookPolicySchema> = source.details?.pricebookPolicy ? (parse)(pricebookPolicySchema, source.details.pricebookPolicy) : { schemaVersion: 1, market: "global" };
    const validFrom = new Date(definition.validFrom || source.createdAt), validUntil = definition.validUntil ? new Date(definition.validUntil) : null;
    (assert)(Number.isFinite(validFrom.getTime()) && (!validUntil || validUntil > validFrom), 422, "PRICEBOOK_VALIDITY", "The validity interval is invalid.");
    const keys = new Set, entries = [];
    for (const line of draft.lines) {
        (assert)(units(line.quantityDecimal) === 1000000n && units(line.discountPercentDecimal) === 0n, 422, "PRICEBOOK_UNIT_PRICE", "Pricebook entries specify one unit with no quotation discount.");
        (assert)(line.id.length <= 160 && line.productId.length <= 160 && line.titleSnapshot.length <= 1e3 && line.unit.length <= 100, 422, "PRICEBOOK_ENTRY", "A pricebook entry exceeds its limits.");
        const key = line.productId + "\0" + line.unit;
        (assert)(!keys.has(key), 422, "PRICEBOOK_DUPLICATE", "A product and unit pair occurs more than once.");
        keys.add(key);
        entries.push({ id: line.id, productId: line.productId, titleSnapshot: line.titleSnapshot, unit: line.unit, unitPriceDecimal: decimal(line.unitPriceDecimal as string), currency: draft.currency });
    }
    const existing = (await client.query("SELECT id FROM crm_pricebook_revisions WHERE pricebook_id=$1 AND content_revision_id=$2 AND approved_by=$3", [source.id, revision.id, actor.id])).rows[0];
    if (existing) {
        await client.query("INSERT INTO crm_pricebook_heads(pricebook_id,revision_id) VALUES($1,$2) ON CONFLICT(pricebook_id) DO UPDATE SET revision_id=excluded.revision_id,updated_at=now()", [source.id, existing.id]);
        return existing.id;
    }
    const id = (randomUUID)(), version = (await client.query("SELECT coalesce(max(version),0)+1 AS next FROM crm_pricebook_revisions WHERE pricebook_id=$1", [source.id])).rows[0].next;
    const snapshot = { title: source.title, market: definition.market, currency: draft.currency, validFrom: validFrom.toISOString(), validUntil: validUntil?.toISOString() || null, entries };
    await client.query("INSERT INTO crm_pricebook_revisions(id,pricebook_id,content_revision_id,version,title,market,currency,valid_from,valid_until,source_checksum,snapshot_hash,maker_id,approved_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)", [id, source.id, revision.id, version, JSON.stringify(source.title), definition.market, draft.currency, validFrom, validUntil, revision.checksum, (checksum)(snapshot), source.authorId, actor.id]);
    for (const entry of entries)
        await client.query("INSERT INTO crm_price_entries(revision_id,line_id,product_id,title_snapshot,unit,unit_price) VALUES($1,$2,$3,$4,$5,$6::numeric)", [id, entry.id, entry.productId, entry.titleSnapshot, entry.unit, entry.unitPriceDecimal]);
    await client.query("INSERT INTO crm_pricebook_heads(pricebook_id,revision_id) VALUES($1,$2) ON CONFLICT(pricebook_id) DO UPDATE SET revision_id=excluded.revision_id,updated_at=now()", [source.id, id]);
    await (audit)(actor.id, "crm.pricebook.approved", "pricebook", source.id, { revisionId: id, version, contentRevisionId: revision.id }, client);
    return id;
}
async function prepareQuoteCommercial(client: PoolClient, actor: Actor, source: WorkspaceRecord, enforceCurrent: boolean) {
    financial(actor);
    (assert)(actor.crmAccess?.permissions.contact === true, 403, "CRM_CONTACT_REQUIRED", "Preparing or issuing an immutable quotation requires access to its customer identity.");
    const record = (await client.query<{data:WorkspaceRecord}>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL", [source.id])).rows[0]?.data;
    (assert)(record && record.collection === "quotes" && (readableRecord)(actor, record), 404, "NOT_FOUND", "Quotation not found.");
    const request = (await client.query<PgRow<'requests',{data:FrontRequest}>>("SELECT id,owner_id,kind,locale,quality_quarantined,assignee_id,team_id,territory_id,data FROM requests WHERE id=$1", [record.requestId || ""])).rows[0];
    (assert)(request && request.kind === "rfq" && (canAccessCrmRequest)(actor, { id: request.id, kind: request.kind, qualityQuarantined: request.quality_quarantined, assigneeId: request.assignee_id, teamId: request.team_id, territoryId: request.territory_id }), 404, "NOT_FOUND", "The linked RFQ is unavailable in your scope.");
    (assert)(actor.allowedLocales.includes(request.locale), 403, "LOCALE_SCOPE", "The RFQ language is outside this account\u2019s scope.");
    const draft = record.details?.commercialDraft as CommercialDraft | undefined;
    (assert)(draft?.kind === "quote" && draft.schemaVersion === 1 && draft.currency === record.currency, 422, "QUOTE_LINES", "Complete the typed quotation.");
    (assert)(draft.pricebookRevisionId, 422, "PRICEBOOK_REQUIRED", "Select an approved pricebook revision.");
    const pricebook = await validPricebook(client, actor, draft.pricebookRevisionId, enforceCurrent);
    (assert)(pricebook.version.currency === draft.currency, 422, "MIXED_CURRENCY", "The quote and pricebook currencies must match.");
    const calculated = (calculateCommercial)(draft.lines, draft.currency);
    (assert)(calculated.ok && calculated.value.complete, 422, "QUOTE_VALUES", "Every quotation line requires a valid known price.");
    (assert)(record.amount === calculated.value.grandTotalDecimal, 409, "QUOTE_CHANGED", "The stored quote total differs from the server calculation.");
    let maxDiscount = 0n;
    for (const line of draft.lines) {
        const entry = pricebook.version.entries.find(entry2 => entry2.productId === line.productId && entry2.unit === line.unit);
        (assert)(entry && line.unitPriceDecimal !== null && units(entry.unitPriceDecimal) === units(line.unitPriceDecimal), 422, "PRICEBOOK_PRICE_MISMATCH", "A quoted unit price must match its approved pricebook entry; use the explicit discount field.");
        const discount = units(line.discountPercentDecimal);
        if (discount > maxDiscount)
            maxDiscount = discount;
    }
    (assert)(record.due && /^\d{4}-\d{2}-\d{2}$/.test(record.due), 422, "QUOTE_VALIDITY_REQUIRED", "A quotation requires an explicit validity date.");
    const validDate = new Date(record.due + "T23:59:59Z");
    (assert)(Number.isFinite(validDate.getTime()) && validDate.toISOString().slice(0, 10) === record.due, 422, "QUOTE_VALIDITY_REQUIRED", "The quotation validity date is not a valid calendar date.");
    const validUntil = validDate.toISOString();
    if (enforceCurrent)
        (assert)(Date.parse(validUntil) > Date.now(), 422, "QUOTE_EXPIRED", "The quotation validity date has passed.");
    const locale = request.locale;
    (assert)(record.details?.billingAddress === void 0 || typeof record.details.billingAddress === "string" && record.details.billingAddress.length <= 2e3, 422, "QUOTE_ADDRESS", "Use a plain billing address of at most 2000 characters.");
    const customerSnapshot = { name: request.data.name, organization: record.organization?.trim() || request.data.organization, email: request.data.email, phone: request.data.phone || "", country: request.data.country || "", address: typeof record.details?.billingAddress === "string" ? record.details.billingAddress : "" };
    const preferences = (await client.query<{preferences_published:ReturnType<typeof defaultSitePreferences>|null}>("SELECT preferences_published FROM workspace_meta WHERE singleton=true")).rows[0].preferences_published || (defaultSitePreferences)();
    const sellerSnapshot = { name: preferences.brand.name[locale], address: preferences.contact.address[locale], email: preferences.contact.email, phone: preferences.contact.phone };
    const pricebookSnapshot = { id: pricebook.version.id, pricebookId: pricebook.version.pricebookId, version: pricebook.version.version, market: pricebook.version.market, currency: pricebook.version.currency, checksum: pricebook.version.checksum };
    const commercial = { recordId: record.id, requestId: request.id, locale, title: record.title[locale], amount: calculated.value.grandTotalDecimal!, currency: draft.currency, terms: record.summary[locale], lines: draft.lines.map(line => ({ id: line.id, productId: line.productId, titleSnapshot: line.titleSnapshot, unit: line.unit, quantityDecimal: line.quantityDecimal, unitPriceDecimal: line.unitPriceDecimal, discountPercentDecimal: line.discountPercentDecimal, currency: line.currency, netDecimal: calculated.value.lines.find(value => value.lineId === line.id)?.netDecimal })), validUntil, customerSnapshot, sellerSnapshot, pricebookSnapshot, calculationPolicyVersion };
    return { record, request, pricebook, commercial, hash: (checksum)({ ...commercial, requestOwnerId: request.owner_id }), maxDiscount };
}
async function approveCommercialQuote(client: PoolClient, actor: Actor, source: WorkspaceRecord, revision: CommercialRevision, locale: Locale) { (assert)((canReviewSource)(actor, source, locale), 403, "FORBIDDEN", "An independent commercial reviewer is required."); const prepared = await prepareQuoteCommercial(client, actor, source, true); (assert)(prepared.request.locale === locale, 422, "QUOTE_LOCALE", "Review the RFQ language."); const current = await policy(client), ceiling = units(current.discountCeilings[actor.role] || "0"); (assert)(prepared.maxDiscount <= ceiling, 403, "DISCOUNT_APPROVAL_REQUIRED", "The requested discount exceeds this reviewer role ceiling."); await client.query("INSERT INTO crm_quote_approvals(id,quote_id,content_revision_id,locale,commercial_hash,pricebook_revision_id,calculation_policy_version,policy_version,max_discount_percent,maker_id,approved_by,approved_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11,$12) ON CONFLICT(content_revision_id,commercial_hash,approved_by) DO NOTHING", [(randomUUID)(), source.id, revision.id, locale, prepared.hash, prepared.pricebook.version.id, calculationPolicyVersion, current.version, formatUnits(prepared.maxDiscount), source.authorId, actor.id, actor.role]); await (audit)(actor.id, "crm.quote.approved", "quote", source.id, { commercialHash: prepared.hash, contentRevisionId: revision.id, pricebookRevisionId: prepared.pricebook.version.id, policyVersion: current.version }, client); }
async function assertCommercialQuoteApproved(client: PoolClient, prepared: Awaited<ReturnType<typeof prepareQuoteCommercial>>, contentRevisionId: string) { const approval = (await client.query("SELECT approved_by,maker_id,policy_version,max_discount_percent::text FROM crm_quote_approvals WHERE quote_id=$1 AND content_revision_id=$2 AND locale=$3 AND commercial_hash=$4 AND approved_by=$5 ORDER BY approved_at DESC LIMIT 1", [prepared.record.id, contentRevisionId, prepared.request.locale, prepared.hash, prepared.record.approvedById || ""])).rows[0]; (assert)(approval && approval.maker_id === prepared.record.authorId && approval.maker_id !== approval.approved_by, 409, "QUOTE_COMMERCIAL_APPROVAL", "The exact parties, pricebook, prices, discounts, terms and validity require independent commercial approval."); const reviewer = await currentReviewer(client, approval.approved_by); (assert)(reviewer && (readableRecord)(reviewer, prepared.record) && (canReviewSource)(reviewer, prepared.record, prepared.request.locale), 409, "QUOTE_APPROVER_REVOKED", "The quote reviewer no longer has the required scope."); const current = await policy(client); (assert)(prepared.maxDiscount <= units(current.discountCeilings[reviewer.role] || "0"), 409, "DISCOUNT_POLICY_CHANGED", "The current reviewer role ceiling no longer covers this quotation."); await validPricebook(client, reviewer, prepared.pricebook.version.id, true); (assert)(Date.parse(prepared.commercial.validUntil) > Date.now(), 422, "QUOTE_EXPIRED", "The quotation validity date has passed."); }
export { approveCommercialQuote, approvePricebook, assertCommercialQuoteApproved, calculationPolicyVersion, getCommercialPolicy, listPricebookVersions, prepareQuoteCommercial, saveCommercialPolicy, validateCommercialMetadata };
