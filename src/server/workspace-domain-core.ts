import type {PgRow} from './recovered-db-rows';
import type {WorkspaceRecord} from '../data/workspace-seed';
import type {WorkspaceAction} from '../lib/auth';
import type {FrontRequest} from '../types/frontend';
import type {PublishedContent} from '../lib/publications';
import type {CrmAccountDefinition,CrmContactDefinition,CrmDomainDefinition,CrmDomainView,CrmOpportunityDefinition,CrmProductSnapshot,CrmSampleCase,CrmHandoffCase,CrmSampleState,CrmHandoffState} from '../types/crm-domain';
type AffiliationRow = PgRow<'crm_contact_affiliations',{valid_from:string;valid_to:string|null}>;
type AccountRow = PgRow<'crm_account_profiles',{registrations:CrmAccountDefinition['registrations'];addresses:CrmAccountDefinition['addresses']}>;
type BranchRow = PgRow<'crm_account_branches',{address:CrmAccountDefinition['branches'][number]['address'];registrations:CrmAccountDefinition['registrations']}>;
type SampleRow = PgRow<'crm_sample_cases',{carrier_evidence:CrmSampleCase['carrierEvidence'];evaluation:CrmSampleCase['evaluation']}>;
type OpportunityItemRow = PgRow<'crm_opportunity_items',{snapshot:CrmProductSnapshot}>;
import type { Actor } from './types';
import type { PoolClient } from 'pg';
import type { Locale } from '../lib/i18n';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { assert, HttpError } from "./types";
import { canWorkspace } from "../lib/auth";
import { lockWorkspace, applyCrmDomainRecords } from "./workspace";
import { loadCrmAccess, canAccessCrmRequest } from "./workspace-scopes";
import { readableRecord, equal, checksum } from "./workspace-policy";
import { randomUUID } from "node:crypto";
import { recordText } from "../data/workspace-seed";
import { audit, transaction } from "./db";
import { products } from "../data/catalog";
import { parseCustomProduct } from "../lib/custom-products";
import { parseProductRelease } from "../lib/product-release";
import { parse } from "./http";
import { domainId, accountDefinitionSchema, contactDefinitionSchema, domainDefinitionSchema } from "./workspace-domain-schema";
import { z } from "zod";
const domainCollections = { account: "accounts", contact: "contacts", lead: "leads", opportunity: "opportunities", sample: "samples", handoff: "handoffs", partner: "partners" } as const;
const financialVisible = (actor: Actor) => actor.crmAccess?.permissions.financial === true;
const contactVisible = (actor: Actor) => actor.crmAccess?.permissions.contact === true;
function domainPermission(actor: Actor, record: WorkspaceRecord, action: WorkspaceAction = "edit") { (assert)(actor.mfaVerified && (canWorkspace)(actor.role, action, record.collection), 403, "FORBIDDEN", "This CRM action is unavailable for your current role."); }
function requireContact(actor: Actor) { (assert)(contactVisible(actor), 403, "CRM_CONTACT_REQUIRED", "Current contact-field permission is required."); }
async function domainContext(client: PoolClient, actor: Actor, expectedVersion?: number) {
    const meta = await (lockWorkspace)(client);
    actor = await (loadCrmAccess)(actor, client);
    if (expectedVersion !== void 0)
        (assert)(expectedVersion === Number(meta.version), 409, "CONFLICT", "The workspace changed. Refresh before applying this command.");
    return { actor, version: Number(meta.version) };
}
async function domainRecord(client: PoolClient, actor: Actor, id: string, collection?: string) { const row = (await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL", [id])).rows[0]?.data; (assert)(row && (readableRecord)(actor, row) && (!collection || row.collection === collection), 404, "NOT_FOUND", "CRM record not found."); (assert)(row.status !== "archived", 409, "CRM_ARCHIVED", "Restore the archived CRM record before changing its domain data."); return row; }
async function visibleLinkedRecord(client: PoolClient, actor: Actor, id: string, collection?: string) { const row = (await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL", [id])).rows[0]?.data; return row && row.status !== "archived" && (readableRecord)(actor, row) && (!collection || row.collection === collection) ? row : null; }
async function domainRequest(client: PoolClient, actor: Actor, id: string) { const row = (await client.query<PgRow<'requests',{data:FrontRequest}>>("SELECT id,kind,locale,owner_id,guest_token_hash,data,quality_quarantined,assignee_id,team_id,territory_id FROM requests WHERE id=$1", [id])).rows[0]; return row && (canAccessCrmRequest)(actor, { id: row.id, kind: row.kind, qualityQuarantined: row.quality_quarantined, assigneeId: row.assignee_id, teamId: row.team_id, territoryId: row.territory_id }) ? row : null; }
function domainMarker(record: WorkspaceRecord, kind: CrmDomainDefinition['kind'], patch: Partial<WorkspaceRecord> = {}): WorkspaceRecord { const previous = record.details?.crmDomain as {revision?:number}|undefined; return { ...record, ...patch, details: { ...record.details, ...patch.details, crmDomain: { schemaVersion: 1, kind, revision: (previous?.revision || 0) + 1 } } }; }
function newDomainRecord(actor: Actor, collection: string, name: string, patch: Partial<WorkspaceRecord> = {}): WorkspaceRecord { const now = new Date().toISOString(); return { id: (randomUUID)(), collection, title: (recordText)(name), summary: (recordText)(""), status: "new", owner: actor.role, createdAt: now, updatedAt: now, tags: [], history: [], demo: false, ...patch }; }
async function domainEvent(client: PoolClient, actor: Actor, recordId: string, action: string, metadata: Record<string,unknown> = {}) { await client.query("INSERT INTO crm_domain_events(id,record_id,action,actor_id,metadata) VALUES($1,$2,$3,$4,$5::jsonb)", [(randomUUID)(), recordId, action, actor.id, JSON.stringify(metadata)]); await (audit)(actor.id, action, "crm-domain", recordId, metadata, client); }
function domainSqlError(error: unknown): never {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "23P01")
        throw new HttpError(409, "CRM_INTERVAL_OVERLAP", "An active affiliation or exclusive agreement already occupies this interval.");
    if (code === "23505")
        throw new HttpError(409, "CRM_DUPLICATE", "A CRM identifier, endpoint or distinct need already exists.");
    if (code === "23503")
        throw new HttpError(409, "CRM_REFERENCE", "A referenced CRM entity is unavailable or still in use.");
    if (code === "23514")
        throw new HttpError(422, "CRM_INVARIANT", "The change violates a CRM domain invariant.");
    throw error;
}
async function requiredProfile(client: PoolClient, actor: Actor, id: string, kind: "account"|"contact") { await domainRecord(client, actor, id, domainCollections[kind]); const table = kind === "account" ? "crm_account_profiles" : "crm_contact_profiles"; (assert)((await client.query(`SELECT record_id FROM ${table} WHERE record_id=$1`, [id])).rowCount, 409, "CRM_PROFILE_REQUIRED", "Complete the structured profile before linking this entity."); }
const unique = (values: readonly unknown[], code = "CRM_DUPLICATE_ID") => (assert)(new Set(values).size === values.length, 422, code, "Identifiers within the command must be unique.");
async function prepareAccount(client: PoolClient, actor: Actor, id: string, value: CrmAccountDefinition) {
    requireContact(actor);
    if (value.parentAccountId === void 0) {
        const previous2 = (await client.query<AccountRow>("SELECT parent_account_id FROM crm_account_profiles WHERE record_id=$1", [id])).rows[0];
        value = { ...value, parentAccountId: previous2?.parent_account_id || null };
    }
    else if (value.parentAccountId) {
        (assert)(value.parentAccountId !== id, 422, "CRM_ACCOUNT_CYCLE", "An account cannot be its own parent.");
        await requiredProfile(client, actor, value.parentAccountId, "account");
        const cycle = (await client.query("WITH RECURSIVE parent AS(SELECT record_id,parent_account_id FROM crm_account_profiles WHERE record_id=$1 UNION SELECT a.record_id,a.parent_account_id FROM crm_account_profiles a JOIN parent p ON a.record_id=p.parent_account_id) SELECT 1 FROM parent WHERE record_id=$2", [value.parentAccountId, id])).rowCount;
        (assert)(!cycle, 422, "CRM_ACCOUNT_CYCLE", "Account hierarchies cannot contain cycles.");
    }
    const previous = (await client.query<BranchRow>("SELECT * FROM crm_account_branches WHERE account_id=$1", [id])).rows;
    const branches = value.branches.map(branch => ({ ...branch, id: branch.id || (randomUUID)() }));
    unique(branches.map(branch => branch.id));
    for (const branch of branches)
        if (!previous.some(row => row.id === branch.id))
            (assert)(!(await client.query<BranchRow>("SELECT id FROM crm_account_branches WHERE id=$1", [branch.id])).rowCount, 409, "CRM_BRANCH_ID", "A branch identifier already belongs to another account.");
    for (const before of previous)
        if (!branches.some(branch => branch.id === before.id && branch.active) && before.active)
            (assert)(!(await client.query<AffiliationRow>("SELECT id FROM crm_contact_affiliations WHERE branch_id=$1 AND (valid_to IS NULL OR valid_to>=current_date)", [before.id])).rowCount, 409, "CRM_BRANCH_IN_USE", "Close current affiliations before retiring their branch.");
    return { ...value, branches: [...branches, ...previous.filter(row => !branches.some(branch => branch.id === row.id)).map(row => ({ id: row.id, name: row.name, address: row.address, registrations: row.registrations, active: false }))] };
}
async function persistAccount(client: PoolClient, id: string, value: CrmAccountDefinition) {
    await client.query("INSERT INTO crm_account_profiles(record_id,display_name,legal_name,activity,lifecycle,parent_account_id,registrations,addresses) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) ON CONFLICT(record_id) DO UPDATE SET display_name=excluded.display_name,legal_name=excluded.legal_name,activity=excluded.activity,lifecycle=excluded.lifecycle,parent_account_id=excluded.parent_account_id,registrations=excluded.registrations,addresses=excluded.addresses,version=crm_account_profiles.version+1,updated_at=now()", [id, value.displayName, value.legalName, value.activity, value.lifecycle, value.parentAccountId, JSON.stringify(value.registrations), JSON.stringify(value.addresses)]);
    for (const branch of value.branches)
        await client.query("INSERT INTO crm_account_branches(id,account_id,name,address,registrations,active) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,registrations=excluded.registrations,active=excluded.active,version=crm_account_branches.version+1,updated_at=now()", [branch.id, id, branch.name, JSON.stringify(branch.address), JSON.stringify(branch.registrations), branch.active]);
}
const affiliationDto = (row: AffiliationRow) => ({ id: row.id, accountId: row.account_id, branchId: row.branch_id, role: row.role, validFrom: row.valid_from, validTo: row.valid_to });
const normalizeEndpoint = (channel: "email"|"phone", value: string) => channel === "email" ? value.trim().toLowerCase() : value.trim();
async function prepareContact(client: PoolClient, actor: Actor, id: string, value: CrmContactDefinition, pendingAccounts: Set<string> = new Set) {
    requireContact(actor);
    (assert)(actor.allowedLocales.includes(value.locale), 403, "LOCALE_SCOPE", "This contact language is outside your assigned scope.");
    const old = (await client.query<AffiliationRow>("SELECT *,valid_from::text,valid_to::text FROM crm_contact_affiliations WHERE contact_id=$1", [id])).rows;
    const affiliations = value.affiliations.map(affiliation => ({ ...affiliation, id: affiliation.id || (randomUUID)() }));
    unique(affiliations.map(row => row.id));
    for (const item of affiliations) {
        const previous = old.find(row => row.id === item.id);
        if (!pendingAccounts.has(item.accountId))
            await requiredProfile(client, actor, item.accountId, "account");
        if (item.branchId)
            (assert)((await client.query<BranchRow>("SELECT id FROM crm_account_branches WHERE id=$1 AND account_id=$2 AND active", [item.branchId, item.accountId])).rowCount, 422, "CRM_BRANCH_ACCOUNT", "Select an active branch belonging to the selected account.");
        if (previous) {
            (assert)((equal)({ ...affiliationDto(previous), validTo: void 0 }, { ...item, validTo: void 0 }), 409, "CRM_AFFILIATION_HISTORY", "Close an existing affiliation and add a new interval to change its role or organization.");
            (assert)(previous.valid_to === null || previous.valid_to === item.validTo, 409, "CRM_AFFILIATION_HISTORY", "Closed affiliation history is immutable.");
        }
        else
            (assert)(!(await client.query<AffiliationRow>("SELECT id FROM crm_contact_affiliations WHERE id=$1", [item.id])).rowCount, 409, "CRM_AFFILIATION_ID", "The affiliation identifier belongs to another contact.");
    }
    for (const previous of old)
        if (!affiliations.some(row => row.id === previous.id)) {
            if (await visibleLinkedRecord(client, actor, previous.account_id, "accounts"))
                (assert)(false, 409, "CRM_AFFILIATION_HISTORY", "Keep historical affiliations and close them with an end date.");
            affiliations.push(affiliationDto(previous));
        }
    const endpoints = value.endpoints.map(endpoint => ({ ...endpoint, id: endpoint.id || (randomUUID)(), value: normalizeEndpoint(endpoint.channel, endpoint.value) }));
    unique(endpoints.map(row => row.id));
    unique(endpoints.map(row => row.channel + "\0" + row.value), "CRM_ENDPOINT_DUPLICATE");
    const previousEndpoints = (await client.query<PgRow<'crm_contact_endpoints'>>("SELECT * FROM crm_contact_endpoints WHERE contact_id=$1", [id])).rows;
    for (const endpoint of endpoints) {
        const previous = previousEndpoints.find(row => row.id === endpoint.id);
        if (previous)
            (assert)(previous.channel === endpoint.channel, 422, "CRM_ENDPOINT_CHANNEL", "Create a new endpoint to change the communication channel.");
        else
            (assert)(!(await client.query<PgRow<'crm_contact_endpoints'>>("SELECT id FROM crm_contact_endpoints WHERE id=$1", [endpoint.id])).rowCount, 409, "CRM_ENDPOINT_ID", "The endpoint identifier belongs to another contact.");
    }
    return { ...value, affiliations, endpoints };
}
async function persistContact(client: PoolClient, id: string, value: CrmContactDefinition) {
    await client.query("INSERT INTO crm_contact_profiles(record_id,given_name,family_name,display_name,locale) VALUES($1,$2,$3,$4,$5) ON CONFLICT(record_id) DO UPDATE SET given_name=excluded.given_name,family_name=excluded.family_name,display_name=excluded.display_name,locale=excluded.locale,version=crm_contact_profiles.version+1,updated_at=now()", [id, value.givenName, value.familyName, value.displayName, value.locale]);
    const recipient = (await client.query("INSERT INTO communication_recipients(id,subject_type,subject_id,contact_id) VALUES($1,'crm-contact',$2,$2) ON CONFLICT(subject_type,subject_id) DO UPDATE SET active=true RETURNING id", [(randomUUID)(), id])).rows[0].id;
    for (const item of value.affiliations)
        await client.query("INSERT INTO crm_contact_affiliations(id,contact_id,account_id,branch_id,role,valid_from,valid_to) VALUES($1,$2,$3,$4,$5,$6::date,$7::date) ON CONFLICT(id) DO UPDATE SET valid_to=excluded.valid_to,updated_at=now()", [item.id, id, item.accountId, item.branchId, item.role, item.validFrom, item.validTo]);
    const before = (await client.query<PgRow<'crm_contact_endpoints'>>("SELECT * FROM crm_contact_endpoints WHERE contact_id=$1", [id])).rows;
    const endpoints = [...value.endpoints, ...before.filter(row => !value.endpoints.some(endpoint => endpoint.id === row.id)).map(row => ({ id: row.id, channel: row.channel, value: row.value, label: row.label, active: false }))];
    for (const endpoint of endpoints) {
        const previous = before.find(row => row.id === endpoint.id), changed = !!previous && (previous.normalized_value !== endpoint.value || previous.active !== endpoint.active);
        await client.query("INSERT INTO crm_contact_endpoints(id,contact_id,recipient_id,channel,value,normalized_value,label,active) VALUES($1,$2,$3,$4,$5,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET value=excluded.value,normalized_value=excluded.normalized_value,label=excluded.label,active=excluded.active,version=crm_contact_endpoints.version+CASE WHEN $8 THEN 1 ELSE 0 END,verified_at=CASE WHEN $8 THEN NULL ELSE crm_contact_endpoints.verified_at END,updated_at=now()", [endpoint.id, id, recipient, endpoint.channel, endpoint.value, endpoint.label, endpoint.active, changed]);
        if (changed) {
            await client.query("UPDATE crm_endpoint_challenges SET consumed_at=now() WHERE endpoint_id=$1 AND consumed_at IS NULL", [endpoint.id]);
            for (const topic of ["products", "research", "events"])
                await client.query("INSERT INTO crm_endpoint_consent_events(endpoint_id,endpoint_version,topic,accepted,source,policy_version) VALUES($1,$2,$3,false,'endpoint-changed','crm-contact-consent-v1')", [endpoint.id, previous.version + 1, topic]);
        }
    }
}
async function productItemSnapshot(client: PoolClient, productId: string, variantId: string|null, unit: string, locale: Locale): Promise<CrmProductSnapshot> { const sources = (await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("SELECT id,data,deleted_at,status FROM workspace_entities WHERE bucket='records' AND collection='products' AND (id=$1 OR data->>'product'=$1 OR data#>>'{details,customProduct,id}'=$1)", [productId])).rows; (assert)(!sources.some(row => row.deleted_at || row.status === "archived"), 422, "CRM_PRODUCT_UNAVAILABLE", "The selected product is archived or withdrawn."); const releases = (await client.query<PgRow<'locale_releases',{publication:PublishedContent}>>("SELECT active_revision_id,publication,unpublished_at FROM locale_releases WHERE document_bucket='records' AND document_id=ANY($1::text[]) AND locale=$2 AND kind IN ('product','products') ORDER BY published_at DESC", [sources.map(row => row.id), locale])).rows; const release = releases.find(row => !row.unpublished_at); (assert)(!releases.length || release, 422, "CRM_PRODUCT_UNAVAILABLE", "The product is withdrawn in the selected language."); const source = products.find(product => product.id === productId) || (parseCustomProduct)(release?.publication.customProduct); (assert)(source, 422, "CRM_PRODUCT_UNAVAILABLE", "Select an available source or reviewed product."); const published = release?.publication.productRelease ? (parseProductRelease)(release.publication.productRelease, source) : null; (assert)(!release?.publication.productRelease || published, 409, "CRM_PRODUCT_SNAPSHOT", "The reviewed product snapshot is invalid."); const variant = variantId ? published?.variants.find(row => row.id === variantId) : null; (assert)(!variantId || variant, 422, "CRM_PRODUCT_VARIANT", "Select a variant present in the reviewed release."); (assert)(!variant || variant.unit === unit, 422, "CRM_PRODUCT_UNIT", "Use the unit from the selected reviewed variant."); return { schemaVersion: 1, productId: source.id, locale, title: published?.localized[locale].title || source.name[locale], slug: published?.slug || source.slug, family: published?.family || source.family, source: release ? "reviewed-release" : "factory-source", releaseRevisionId: release?.active_revision_id || null, sourceHash: (checksum)(published || source), variant: variant ? { id: variant.id, sku: variant.sku, shade: variant.shade, mould: variant.mould, arch: variant.arch, position: variant.position, unitsPerPack: variant.unitsPerPack } : null, unit, unitSource: variant ? "reviewed-variant" : "requested" }; }
async function prepareOpportunity(client: PoolClient, actor: Actor, id: string, value: CrmOpportunityDefinition, pendingAccounts: Set<string> = new Set, pendingContacts: Set<string> = new Set) {
    (assert)(actor.allowedLocales.includes(value.locale), 403, "LOCALE_SCOPE", "This opportunity language is outside your assigned scope.");
    const old = (await client.query<PgRow<'crm_opportunity_details'>>("SELECT * FROM crm_opportunity_details WHERE opportunity_id=$1", [id])).rows[0];
    let accountId = value.accountId === void 0 ? old?.account_id || null : value.accountId;
    const contactIds = [...value.contactIds || []], requestIds = [...value.requestIds];
    if (!contactVisible(actor)) {
        (assert)(value.accountId === void 0 && value.contactIds === void 0, 403, "CRM_CONTACT_REQUIRED", "Omit protected contact links.");
        accountId = old?.account_id || null;
    }
    else if (value.accountId !== void 0 && accountId && !pendingAccounts.has(accountId))
        await requiredProfile(client, actor, accountId, "account");
    const oldContacts = (await client.query("SELECT contact_id FROM crm_opportunity_contacts WHERE opportunity_id=$1", [id])).rows;
    for (const contactId of contactIds)
        if (!pendingContacts.has(contactId))
            await requiredProfile(client, actor, contactId, "contact");
    for (const previous of oldContacts)
        if (value.contactIds === void 0 || !contactVisible(actor) || !await visibleLinkedRecord(client, actor, previous.contact_id, "contacts")) {
            if (!contactIds.includes(previous.contact_id))
                contactIds.push(previous.contact_id);
        }
    for (const requestId of requestIds)
        (assert)(await domainRequest(client, actor, requestId), 404, "CRM_REQUEST_SCOPE", "The selected request is unavailable in your current staff scope.");
    for (const previous of (await client.query("SELECT request_id FROM crm_opportunity_requests WHERE opportunity_id=$1", [id])).rows)
        if (!await domainRequest(client, actor, previous.request_id) && !requestIds.includes(previous.request_id))
            requestIds.push(previous.request_id);
    const oldItems = (await client.query<OpportunityItemRow>("SELECT *,quantity::text FROM crm_opportunity_items WHERE opportunity_id=$1", [id])).rows, items = [];
    for (const item of value.items) {
        const itemId = item.id || (randomUUID)(), previous = oldItems.find(row => row.id === itemId);
        if (previous) {
            (assert)(previous.active, 409, "CRM_ITEM_RETIRED", "Create a new item instead of reusing a retired item identifier.");
            (assert)(previous.product_id === item.productId && previous.variant_id === item.variantId && previous.unit === item.unit && previous.snapshot.locale === value.locale, 409, "CRM_ITEM_SNAPSHOT", "Keep the saved product identity or replace this item with a new identifier.");
        }
        else
            (assert)(!(await client.query<OpportunityItemRow>("SELECT id FROM crm_opportunity_items WHERE id=$1", [itemId])).rowCount, 409, "CRM_ITEM_ID", "The item identifier belongs to another opportunity.");
        items.push({ ...item, id: itemId, productSnapshot: previous?.snapshot || await productItemSnapshot(client, item.productId, item.variantId, item.unit, value.locale) });
    }
    unique(items.map(item => item.id));
    return { value: { ...value, accountId, contactIds, requestIds }, items };
}
async function persistOpportunity(client: PoolClient, actor: Actor, id: string, prepared: Awaited<ReturnType<typeof prepareOpportunity>>, needKey?: string) {
    const value = prepared.value;
    await client.query("INSERT INTO crm_opportunity_details(opportunity_id,account_id,locale,need_key) VALUES($1,$2,$3,$4) ON CONFLICT(opportunity_id) DO UPDATE SET account_id=excluded.account_id,locale=excluded.locale,need_key=coalesce(excluded.need_key,crm_opportunity_details.need_key),updated_at=now()", [id, value.accountId, value.locale, needKey || null]);
    await client.query("DELETE FROM crm_opportunity_contacts WHERE opportunity_id=$1 AND NOT(contact_id=ANY($2::text[]))", [id, value.contactIds]);
    for (const contactId of value.contactIds)
        await client.query("INSERT INTO crm_opportunity_contacts(opportunity_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, contactId]);
    await client.query("DELETE FROM crm_opportunity_requests WHERE opportunity_id=$1 AND NOT(request_id=ANY($2::text[]))", [id, value.requestIds]);
    for (const requestId of value.requestIds)
        await client.query("INSERT INTO crm_opportunity_requests(opportunity_id,request_id,linked_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [id, requestId, actor.id]);
    await client.query("UPDATE crm_opportunity_items SET active=false,updated_at=now() WHERE opportunity_id=$1 AND NOT(id=ANY($2::uuid[]))", [id, prepared.items.map(item => item.id)]);
    for (const item of prepared.items)
        await client.query("INSERT INTO crm_opportunity_items(id,opportunity_id,product_id,variant_id,unit,quantity,note,snapshot) VALUES($1,$2,$3,$4,$5,$6::numeric,$7,$8::jsonb) ON CONFLICT(id) DO UPDATE SET quantity=excluded.quantity,note=excluded.note,updated_at=now()", [item.id, id, item.productId, item.variantId, item.unit, item.quantityDecimal, item.note, JSON.stringify(item.productSnapshot)]);
}
async function domainEvidence(client: PoolClient, actor: Actor, id: string, requestId: string | undefined, recordId?: string) {
    const asset = (await client.query<PgRow<'assets',{metadata:Record<string,unknown>}>>("SELECT owner_id,request_id,scan_status,visibility,metadata FROM assets WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
    (assert)(asset && asset.visibility === "private" && asset.scan_status === "clean" && asset.metadata.damRole !== "original", 422, "CRM_EVIDENCE", "Select an available scanned private evidence file.");
    (assert)(asset.owner_id === actor.id || !!asset.request_id && (!requestId || asset.request_id === requestId) && !!await domainRequest(client, actor, asset.request_id), 404, "CRM_EVIDENCE_SCOPE", "The evidence file is outside your current scope.");
    (assert)(!(await client.query("SELECT id FROM resource_versions WHERE asset_id=$1", [id])).rowCount, 422, "CRM_EVIDENCE_RESOURCE", "Controlled data-room documents cannot be reused as ordinary CRM evidence.");
    (assert)(!(await client.query("SELECT 1 FROM tender_asset_refs WHERE asset_id=$1 UNION ALL SELECT 1 FROM asset_media_derivatives WHERE asset_id=$1 OR source_asset_id=$1 UNION ALL SELECT 1 FROM media_processing_jobs WHERE source_asset_id=$1 LIMIT 1", [id])).rowCount, 422, "CRM_EVIDENCE_RETAINED", "Confidential tender files and retained media sources cannot be rebound as CRM evidence.");
    (assert)(!(await client.query("SELECT 1 FROM crm_domain_asset_refs WHERE asset_id=$1 AND record_id IS DISTINCT FROM $2", [id, recordId || null])).rowCount, 422, "CRM_EVIDENCE_RETAINED", "This file is retained by another CRM record.");
    if ((await client.query("SELECT to_regclass('shared_block_asset_refs') AS name")).rows[0]?.name)
        (assert)(!(await client.query("SELECT 1 FROM shared_block_asset_refs WHERE asset_id=$1", [id])).rowCount, 422, "CRM_EVIDENCE_RETAINED", "Shared-library assets cannot be rebound as private CRM evidence.");
    return asset;
}
async function retainDomainEvidence(client: PoolClient, recordId: string, assetId: string) { await client.query("INSERT INTO crm_domain_asset_refs(record_bucket,record_id,asset_id) VALUES('records',$1,$2) ON CONFLICT DO NOTHING", [recordId, assetId]); }
async function assertCrmDomainEvidenceAccess(client: PoolClient, actor: Actor, recordId: string, assetId: string) {
    (parse)(domainId, recordId);
    (parse)(z.string().uuid(), assetId);
    actor = await (loadCrmAccess)(actor, client);
    const record = await domainRecord(client, actor, recordId);
    requireContact(actor);
    (assert)(["samples", "handoffs", "partners"].includes(record.collection), 404, "NOT_FOUND", "Retained evidence not found.");
    if (record.collection === "handoffs")
        (assert)(financialVisible(actor), 403, "CRM_FINANCIAL_REQUIRED", "Handoff evidence requires current commercial field permission.");
    (assert)((await client.query("SELECT 1 FROM crm_domain_asset_refs r JOIN assets a ON a.id=r.asset_id AND a.deleted_at IS NULL AND a.visibility='private' AND a.scan_status='clean' WHERE r.record_bucket='records' AND r.record_id=$1 AND r.asset_id=$2", [recordId, assetId])).rowCount, 404, "NOT_FOUND", "Retained evidence not found.");
    if (record.collection === "samples") {
        const sample = (await client.query<SampleRow>("SELECT request_id,opportunity_id FROM crm_sample_cases WHERE sample_id=$1", [recordId])).rows[0];
        (assert)(sample && await visibleLinkedRecord(client, actor, sample.opportunity_id, "opportunities") && await domainRequest(client, actor, sample.request_id), 404, "NOT_FOUND", "Retained evidence not found.");
    }
    if (record.collection === "handoffs") {
        const handoff = (await client.query<PgRow<'crm_order_handoffs'>>("SELECT opportunity_id,quote_id FROM crm_order_handoffs WHERE handoff_id=$1", [recordId])).rows[0];
        (assert)(handoff && await visibleLinkedRecord(client, actor, handoff.opportunity_id, "opportunities"), 404, "NOT_FOUND", "Retained evidence not found.");
        if (handoff.quote_id) {
            const quote = (await client.query("SELECT request_id FROM quote_snapshots WHERE id=$1", [handoff.quote_id])).rows[0];
            (assert)(quote && await domainRequest(client, actor, quote.request_id), 404, "NOT_FOUND", "Retained evidence not found.");
        }
    }
    if (record.collection === "partners") {
        const partner = (await client.query<PgRow<'crm_partner_agreements',{valid_from:string;valid_to:string|null}>>("SELECT account_id FROM crm_partner_agreements WHERE partner_id=$1", [recordId])).rows[0];
        (assert)(partner && await visibleLinkedRecord(client, actor, partner.account_id, "accounts"), 404, "NOT_FOUND", "Retained evidence not found.");
    }
    return actor;
}
async function canReadCrmDomainEvidence(client: PoolClient, actor: Actor, recordId: string, assetId: string) {
    try {
        await assertCrmDomainEvidenceAccess(client, actor, recordId, assetId);
        return true;
    }
    catch (error) {
        if (error instanceof HttpError && [401, 403, 404, 422].includes(error.status))
            return false;
        throw error;
    }
}
async function authorizeCrmDomainEvidence(client: PoolClient, actor: Actor, recordId: string, assetId: string) { actor = await assertCrmDomainEvidenceAccess(client, actor, recordId, assetId); await (audit)(actor.id, "crm.evidence.downloaded", "crm-domain", recordId, { assetId }, client); return true; }
const sampleDto = (row: SampleRow): CrmSampleCase => ({ status: row.status, carrierEvidence: row.carrier_evidence, receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : null, evaluation: row.evaluation, qualityRequestId: typeof row.quality_request_id === "string" ? row.quality_request_id : null });
const handoffDto = (row: PgRow<'crm_order_handoffs'>): CrmHandoffCase => ({ status: row.status, externalStatus: row.external_status, externalReference: row.external_reference, lastEvidenceAssetId: row.last_evidence_asset_id, attempt: Number(row.attempt), lastNote: String(row.last_note || "") });
const sampleNext: Record<CrmSampleState,CrmSampleState[]> = { requested: ["reviewed"], reviewed: ["shipped"], shipped: ["received"], received: ["evaluated"], evaluated: [] };
const handoffNext: Record<CrmHandoffState,CrmHandoffState[]> = { draft: ["ready"], ready: ["draft", "submitted"], submitted: ["acknowledged", "failed", "uncertain"], acknowledged: [], failed: ["ready"], uncertain: ["ready", "acknowledged"] };
async function readCrmDomain(client: PoolClient, actor: Actor, record: WorkspaceRecord, version: number): Promise<CrmDomainView> {
    const contact = contactVisible(actor), financial = financialVisible(actor), editable = (canWorkspace)(actor.role, "edit", record.collection) && (!["accounts", "contacts", "partners"].includes(record.collection) || contact);
    const result: CrmDomainView = { recordId: record.id, collection: record.collection, version, definition: null, endpoints: [], items: [], sample: null, handoff: null, conversion: null, capabilities: { canEdit: editable, canConvert: record.collection === "leads" && contact && (canWorkspace)(actor.role, "convert", "leads") && record.status !== "converted", canVerifyEndpoints: record.collection === "contacts" && editable && contact, contactVisible: contact, financialVisible: financial, sampleTransitions: [], handoffTransitions: [] } };
    if (record.collection === "accounts" && contact) {
        const row = (await client.query<AccountRow>("SELECT * FROM crm_account_profiles WHERE record_id=$1", [record.id])).rows[0];
        if (row) {
            const branches = (await client.query<BranchRow>("SELECT * FROM crm_account_branches WHERE account_id=$1 ORDER BY id", [record.id])).rows;
            result.definition = { schemaVersion: 1, kind: "account", displayName: row.display_name, legalName: row.legal_name, activity: row.activity, lifecycle: row.lifecycle, ...!row.parent_account_id || await visibleLinkedRecord(client, actor, row.parent_account_id, "accounts") ? { parentAccountId: row.parent_account_id } : {}, registrations: row.registrations, addresses: row.addresses, branches: branches.map(branch => ({ id: branch.id, name: branch.name, address: branch.address, registrations: branch.registrations, active: branch.active })) };
        }
    }
    if (record.collection === "contacts" && contact) {
        const row = (await client.query<PgRow<'crm_contact_profiles'>>("SELECT * FROM crm_contact_profiles WHERE record_id=$1", [record.id])).rows[0];
        if (row) {
            const affiliations = [];
            for (const item of (await client.query<AffiliationRow>("SELECT *,valid_from::text,valid_to::text FROM crm_contact_affiliations WHERE contact_id=$1 ORDER BY crm_contact_affiliations.valid_from,crm_contact_affiliations.id", [record.id])).rows)
                if (await visibleLinkedRecord(client, actor, item.account_id, "accounts"))
                    affiliations.push(affiliationDto(item));
            const endpoints = (await client.query<PgRow<'crm_contact_endpoints'>>("SELECT * FROM crm_contact_endpoints WHERE contact_id=$1 ORDER BY CASE WHEN channel='email' AND normalized_value=$2 THEN 0 ELSE 1 END,id", [record.id, record.email || ""])).rows;
            result.endpoints = endpoints.map(endpoint => ({ id: endpoint.id, recipientId: endpoint.recipient_id, channel: endpoint.channel, value: endpoint.value, label: endpoint.label, active: endpoint.active, version: endpoint.version, verifiedAt: endpoint.verified_at?.toISOString() || null }));
            result.definition = { schemaVersion: 1, kind: "contact", givenName: row.given_name, familyName: row.family_name, displayName: row.display_name, locale: row.locale, affiliations, endpoints: result.endpoints.map(({ id, channel, value, label, active }) => ({ id, channel, value, label, active })) };
        }
    }
    if (record.collection === "leads") {
        const row = (await client.query("SELECT * FROM crm_lead_qualifications WHERE lead_id=$1", [record.id])).rows[0];
        if (row)
            result.definition = { schemaVersion: 1, kind: "lead", needConfirmed: row.need_confirmed, contactConfirmed: row.contact_confirmed, authorityConfirmed: row.authority_confirmed, timeframeConfirmed: row.timeframe_confirmed, notes: row.notes };
        if (contact) {
            const conversion = (await client.query("SELECT * FROM crm_lead_conversions WHERE lead_id=$1", [record.id])).rows[0];
            if (conversion?.account_id && conversion.contact_id && await visibleLinkedRecord(client, actor, conversion.account_id, "accounts") && await visibleLinkedRecord(client, actor, conversion.contact_id, "contacts"))
                result.conversion = { accountId: conversion.account_id, contactId: conversion.contact_id, opportunityId: conversion.opportunity_id && await visibleLinkedRecord(client, actor, conversion.opportunity_id, "opportunities") ? conversion.opportunity_id : null, reason: conversion.no_opportunity_reason, convertedAt: conversion.created_at.toISOString() };
        }
    }
    if (record.collection === "opportunities") {
        const row = (await client.query<PgRow<'crm_opportunity_details'>>("SELECT * FROM crm_opportunity_details WHERE opportunity_id=$1", [record.id])).rows[0];
        if (row) {
            const contacts = [], requests = [];
            if (contact) {
                for (const entry of (await client.query("SELECT contact_id FROM crm_opportunity_contacts WHERE opportunity_id=$1", [record.id])).rows)
                    if (await visibleLinkedRecord(client, actor, entry.contact_id, "contacts"))
                        contacts.push(entry.contact_id);
            }
            for (const entry of (await client.query("SELECT request_id FROM crm_opportunity_requests WHERE opportunity_id=$1", [record.id])).rows)
                if (await domainRequest(client, actor, entry.request_id))
                    requests.push(entry.request_id);
            result.items = (await client.query<OpportunityItemRow>("SELECT *,quantity::text FROM crm_opportunity_items WHERE opportunity_id=$1 AND active ORDER BY created_at,id", [record.id])).rows.map(item => ({ id: item.id, productId: item.product_id, variantId: item.variant_id, unit: item.unit, quantityDecimal: item.quantity, note: item.note, productSnapshot: item.snapshot }));
            result.definition = { schemaVersion: 1, kind: "opportunity", locale: row.locale, ...contact ? { contactIds: contacts } : {}, ...contact && (!row.account_id || await visibleLinkedRecord(client, actor, row.account_id, "accounts")) ? { accountId: row.account_id } : {}, requestIds: requests, items: result.items.map(({ productSnapshot: _snapshot, ...item }) => item) };
        }
    }
    if (record.collection === "samples") {
        const row = (await client.query<SampleRow>("SELECT * FROM crm_sample_cases WHERE sample_id=$1", [record.id])).rows[0];
        if (row) {
            if (await visibleLinkedRecord(client, actor, row.opportunity_id, "opportunities") && await domainRequest(client, actor, row.request_id))
                result.definition = { schemaVersion: 1, kind: "sample", opportunityId: row.opportunity_id, requestId: row.request_id };
            result.sample = sampleDto(row);
            if (row.quality_request_id && !await domainRequest(client, actor, row.quality_request_id))
                result.sample.qualityRequestId = null;
            result.capabilities.canEdit = editable && row.status === "requested" && !!result.definition;
            result.capabilities.sampleTransitions = (canWorkspace)(actor.role, "stage", "samples") && result.definition ? sampleNext[result.sample.status] : [];
        }
    }
    if (record.collection === "handoffs") {
        const row = (await client.query<PgRow<'crm_order_handoffs'>>("SELECT * FROM crm_order_handoffs WHERE handoff_id=$1", [record.id])).rows[0];
        if (row) {
            if (await visibleLinkedRecord(client, actor, row.opportunity_id, "opportunities"))
                result.definition = { schemaVersion: 1, kind: "handoff", opportunityId: row.opportunity_id, ...financial ? { quoteId: row.quote_id } : {}, mode: "manual" };
            result.handoff = handoffDto(row);
            result.capabilities.canEdit = editable && row.status === "draft" && !!result.definition;
            result.capabilities.handoffTransitions = (canWorkspace)(actor.role, "stage", "handoffs") && result.definition ? handoffNext[result.handoff.status] : [];
        }
    }
    if (record.collection === "partners" && contact) {
        const row = (await client.query<PgRow<'crm_partner_agreements',{valid_from:string;valid_to:string|null}>>("SELECT *,valid_from::text,valid_to::text FROM crm_partner_agreements WHERE partner_id=$1", [record.id])).rows[0];
        if (row && await visibleLinkedRecord(client, actor, row.account_id, "accounts"))
            result.definition = { schemaVersion: 1, kind: "partner", accountId: row.account_id, territoryId: row.territory_id, productIds: row.product_ids, validFrom: row.valid_from, validTo: row.valid_to, exclusive: row.exclusive, active: row.active, reference: row.reference, documentAssetId: row.document_asset_id };
    }
    return result;
}
async function getCrmDomain(actor: Actor, id: string) { (parse)(domainId, id); return (transaction)(async (client) => { const current = await domainContext(client, actor); const record = await domainRecord(client, current.actor, id); return readCrmDomain(client, current.actor, record, current.version); }); }
async function syncCrmMergedProfile(client: PoolClient, actor: Actor, before: WorkspaceRecord, after: WorkspaceRecord) {
    if (!before.details?.crmDomain || !["accounts", "contacts"].includes(after.collection) || (equal)(before.title, after.title) && before.email === after.email && before.organization === after.organization)
        return;
    requireContact(actor);
    const lang = actor.allowedLocales.find((value2): value2 is Locale => ["fa", "en", "tr", "ar", "ru"].includes(value2));
    (assert)(lang, 403, "LOCALE_SCOPE", "An assigned language is required.");
    const view = await readCrmDomain(client, actor, after, 0);
    let value = view.definition;
    if (value?.kind === "account") {
        value = (parse)(accountDefinitionSchema, { ...value, displayName: after.title[lang], legalName: after.organization || value.legalName });
        await persistAccount(client, after.id, await prepareAccount(client, actor, after.id, value));
    }
    else if (value?.kind === "contact") {
        const endpoints = [...value.endpoints];
        if (before.email !== after.email) {
            if (after.email) {
                const normalized = normalizeEndpoint("email", after.email), existing = endpoints.find(endpoint => endpoint.channel === "email" && normalizeEndpoint("email", endpoint.value) === normalized);
                if (existing)
                    existing.active = true;
                else
                    endpoints.unshift({ channel: "email", value: normalized, label: "Selected during contact merge", active: true });
            }
            else
                for (const endpoint of endpoints)
                    if (endpoint.channel === "email")
                        endpoint.active = false;
        }
        value = (parse)(contactDefinitionSchema, { ...value, displayName: after.title[lang], endpoints });
        await persistContact(client, after.id, await prepareContact(client, actor, after.id, value));
    }
    await domainEvent(client, actor, after.id, "crm.profile.merge_synchronized", { profileHash: (checksum)(value) });
}
async function saveCrmDomain(actor: Actor, id: string, body: unknown) {
    (parse)(domainId, id);
    const input = (parse)(z.object({ expectedVersion: z.number().int().min(0), value: domainDefinitionSchema }).strict(), body);
    try {
        return await (transaction)(async (client) => {
            actor = (await domainContext(client, actor, input.expectedVersion)).actor;
            const record = await domainRecord(client, actor, id, domainCollections[input.value.kind]);
            domainPermission(actor, record);
            let value = input.value, next = domainMarker(record, value.kind), preparedOpportunity: Awaited<ReturnType<typeof prepareOpportunity>> | undefined;
            if (value.kind === "account") {
                value = await prepareAccount(client, actor, id, value);
                next = domainMarker(record, "account", { title: (recordText)(value.displayName), organization: value.legalName, details: { ...record.details, parentId: value.parentAccountId || void 0 } });
            }
            if (value.kind === "contact") {
                value = await prepareContact(client, actor, id, value);
                next = domainMarker(record, "contact", { title: (recordText)(value.displayName), email: value.endpoints.find(endpoint => endpoint.channel === "email" && endpoint.active)?.value || "" });
            }
            if (value.kind === "lead")
                (assert)(record.status !== "converted" && record.archivedFrom !== "converted", 409, "CRM_ALREADY_CONVERTED", "A converted lead keeps its original qualification evidence.");
            if (value.kind === "opportunity") {
                preparedOpportunity = await prepareOpportunity(client, actor, id, value);
                value = preparedOpportunity.value;
            }
            if (value.kind === "sample") {
                const old = (await client.query<SampleRow>("SELECT status FROM crm_sample_cases WHERE sample_id=$1", [id])).rows[0];
                (assert)(!old || old.status === "requested", 409, "CRM_SAMPLE_STARTED", "A dispatched sample keeps its original opportunity and request.");
                await domainRecord(client, actor, value.opportunityId, "opportunities");
                (assert)((await client.query<PgRow<'crm_opportunity_details'>>("SELECT opportunity_id FROM crm_opportunity_details WHERE opportunity_id=$1", [value.opportunityId])).rowCount, 409, "CRM_OPPORTUNITY_REQUIRED", "Configure the opportunity items before a sample.");
                const request = await domainRequest(client, actor, value.requestId);
                (assert)(request && request.kind === "sample_request", 404, "CRM_REQUEST_SCOPE", "Select an accessible product sample request.");
                (assert)(!record.requestId || record.requestId === value.requestId, 422, "CRM_SAMPLE_ORIGIN", "A website sample keeps its original request.");
                next = domainMarker(record, "sample", { status: "requested" });
            }
            if (value.kind === "handoff") {
                const old = (await client.query<PgRow<'crm_order_handoffs'>>("SELECT status,quote_id,opportunity_id FROM crm_order_handoffs WHERE handoff_id=$1", [id])).rows[0];
                (assert)(!old || old.status === "draft", 409, "CRM_HANDOFF_STARTED", "A submitted handoff keeps its approved linkage.");
                await domainRecord(client, actor, value.opportunityId, "opportunities");
                (assert)((await client.query<PgRow<'crm_opportunity_details'>>("SELECT opportunity_id FROM crm_opportunity_details WHERE opportunity_id=$1", [value.opportunityId])).rowCount, 409, "CRM_OPPORTUNITY_REQUIRED", "Configure the opportunity before handoff.");
                if (!financialVisible(actor))
                    (assert)(value.quoteId === void 0 && (!old?.quote_id || old.opportunity_id === value.opportunityId), 403, "CRM_FINANCIAL_REQUIRED", "Omit protected quote linkage and preserve its opportunity.");
                if (value.quoteId === void 0)
                    value = { ...value, quoteId: old?.quote_id || null };
                if (value.quoteId && financialVisible(actor)) {
                    const quote = (await client.query("SELECT request_id FROM quote_snapshots WHERE id=$1", [value.quoteId])).rows[0];
                    (assert)(quote && await domainRequest(client, actor, quote.request_id), 404, "CRM_QUOTE_SCOPE", "Select an issued quote on an accessible request.");
                    (assert)((await client.query("SELECT request_id FROM crm_opportunity_requests WHERE opportunity_id=$1 AND request_id=$2", [value.opportunityId, quote.request_id])).rowCount, 422, "CRM_QUOTE_RELATION", "The quote request must already be linked to this opportunity.");
                }
                next = domainMarker(record, "handoff", { status: "draft" });
            }
            if (value.kind === "partner") {
                requireContact(actor);
                await requiredProfile(client, actor, value.accountId, "account");
                const territory = (await client.query("SELECT id FROM crm_territories WHERE id=$1 AND active", [value.territoryId])).rows[0];
                (assert)(territory && (actor.crmAccess?.scope === "all" || actor.crmAccess?.territoryIds.includes(value.territoryId)), 404, "CRM_TERRITORY_SCOPE", "Select an active permitted territory.");
                for (const productId of value.productIds)
                    await productItemSnapshot(client, productId, null, "requested", actor.allowedLocales[0] as Locale);
                if (value.documentAssetId)
                    await domainEvidence(client, actor, value.documentAssetId, void 0, id);
            }
            return (applyCrmDomainRecords)(client, actor, [next], `crm.${value.kind}.configured`, async (connection) => {
                if (value.kind === "account")
                    await persistAccount(connection, id, value);
                if (value.kind === "contact")
                    await persistContact(connection, id, value);
                if (value.kind === "lead")
                    await connection.query("INSERT INTO crm_lead_qualifications(lead_id,need_confirmed,contact_confirmed,authority_confirmed,timeframe_confirmed,notes,confirmed_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(lead_id) DO UPDATE SET need_confirmed=excluded.need_confirmed,contact_confirmed=excluded.contact_confirmed,authority_confirmed=excluded.authority_confirmed,timeframe_confirmed=excluded.timeframe_confirmed,notes=excluded.notes,confirmed_by=excluded.confirmed_by,confirmed_at=now()", [id, value.needConfirmed, value.contactConfirmed, value.authorityConfirmed, value.timeframeConfirmed, value.notes, actor.id]);
                if (value.kind === "opportunity")
                    await persistOpportunity(connection, actor, id, preparedOpportunity!);
                if (value.kind === "sample")
                    await connection.query("INSERT INTO crm_sample_cases(sample_id,opportunity_id,request_id) VALUES($1,$2,$3) ON CONFLICT(sample_id) DO UPDATE SET opportunity_id=excluded.opportunity_id,request_id=excluded.request_id,updated_at=now()", [id, value.opportunityId, value.requestId]);
                if (value.kind === "handoff")
                    await connection.query("INSERT INTO crm_order_handoffs(handoff_id,opportunity_id,quote_id,mode) VALUES($1,$2,$3,'manual') ON CONFLICT(handoff_id) DO UPDATE SET opportunity_id=excluded.opportunity_id,quote_id=excluded.quote_id,updated_at=now()", [id, value.opportunityId, value.quoteId]);
                if (value.kind === "partner")
                    await connection.query("INSERT INTO crm_partner_agreements(partner_id,account_id,territory_id,product_ids,valid_from,valid_to,exclusive,active,reference,document_asset_id) VALUES($1,$2,$3,$4::text[],$5::date,$6::date,$7,$8,$9,$10) ON CONFLICT(partner_id) DO UPDATE SET account_id=excluded.account_id,territory_id=excluded.territory_id,product_ids=excluded.product_ids,valid_from=excluded.valid_from,valid_to=excluded.valid_to,exclusive=excluded.exclusive,active=excluded.active,reference=excluded.reference,document_asset_id=excluded.document_asset_id,updated_at=now()", [id, value.accountId, value.territoryId, value.productIds, value.validFrom, value.validTo, value.exclusive, value.active, value.reference, value.documentAssetId]);
                if (value.kind === "partner" && value.documentAssetId)
                    await retainDomainEvidence(connection, id, value.documentAssetId);
                await domainEvent(connection, actor, id, `crm.${value.kind}.configured`, { definitionHash: (checksum)(value) });
            });
        });
    }
    catch (error) {
        domainSqlError(error);
    }
}
export { authorizeCrmDomainEvidence, canReadCrmDomainEvidence, contactVisible, domainCollections, domainContext, domainEvent, domainEvidence, domainMarker, domainPermission, domainRecord, domainRequest, domainSqlError, financialVisible, getCrmDomain, handoffNext, newDomainRecord, normalizeEndpoint, persistAccount, persistContact, persistOpportunity, prepareAccount, prepareContact, prepareOpportunity, productItemSnapshot, readCrmDomain, requireContact, requiredProfile, retainDomainEvidence, sampleNext, saveCrmDomain, syncCrmMergedProfile, visibleLinkedRecord };
