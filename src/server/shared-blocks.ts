import type {PgRow} from './recovered-db-rows';
import type {PageBlock,PageDraft} from '../data/workspace-seed';
import type {WorkspaceChange} from './workspace-policy';
import type {SharedBlockPayload} from '../types/shared-blocks';
type RevisionRow = PgRow<'shared_block_revisions',{payload:SharedBlockPayload}>;
type SummaryRow = Omit<RevisionRow,'payload'> & {title:string;type:string};
type ImpactRow = {stage:'draft'|'scheduled'|'published';page_id:string;title:string;locale:Locale;source_status:PageDraft['status'];instance_id:string;pinned_revision_id:string;source_updated_at:string;scheduled_at:Date|null;draft_count:string;scheduled_count:string;published_count:string};
import type { Actor } from './types';
import type { Locale } from '../lib/i18n';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { LOCALES, safeJson, assertObject, keys, validateBlocks } from "./workspace-validation";
import { assert } from "./types";
import { hasWorkspacePermission, assertWorkspaceActor, serverActivity, checksum, equal } from "./workspace-policy";
import { lockWorkspace, applySharedBlockPages } from "./workspace";
import { loadCrmAccess } from "./workspace-scopes";
import { assertContentLeaseWrites } from "./content-collaboration";
import { assetReferences } from "../lib/asset-references";
import { assetUsageAllowed } from "./asset-usage";
import { parse } from "./http";
import { transaction, audit } from "./db";
import { randomUUID } from "node:crypto";
const uuid = z.string().uuid(), identity = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/), version = z.number().int().min(0), language = z.enum(LOCALES);
const summaryColumns = "id,block_id,locale,revision_number,checksum,created_by,created_at,base_revision_id,payload->>'title' AS title,payload->>'type' AS type";
const summary = (row: RevisionRow | SummaryRow) => ({ id: row.id, blockId: row.block_id, locale: row.locale, number: row.revision_number, checksum: row.checksum, title: "payload" in row ? row.payload.title : row.title, type: "payload" in row ? row.payload.type : row.type, createdBy: row.created_by, createdAt: row.created_at.toISOString(), baseRevisionId: row.base_revision_id });
const revisionDto = (row: RevisionRow) => ({ ...summary(row), payload: row.payload });
const conflict = (expected: number, current: number) => (assert)(expected === current, 409, "SHARED_BLOCK_CONFLICT", "The saved content or library version changed. Reload before continuing.");
const libraryWrite = (actor: Actor, locale?: Locale) => (hasWorkspacePermission)(actor, "edit", "pages", locale);
async function context(client: PoolClient, actor: Actor, expected?: number) {
    const meta = await (lockWorkspace)(client);
    actor = await (loadCrmAccess)(actor, client);
    (assertWorkspaceActor)(actor);
    (assert)((hasWorkspacePermission)(actor, "view", "pages"), 403, "FORBIDDEN", "Page-content permission is required.");
    if (expected !== void 0)
        conflict(expected, Number(meta.version));
    return { actor, version: Number(meta.version) };
}
async function library(client: PoolClient, id: string, lock = false) { const row = (await client.query<PgRow<'shared_blocks'>>("SELECT * FROM shared_blocks WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Shared block not found."); return row; }
async function revision(client: PoolClient, id: string, blockId?: string) { const row = (await client.query<RevisionRow>("SELECT * FROM shared_block_revisions WHERE id=$1" + (blockId ? " AND block_id=$2" : ""), blockId ? [id, blockId] : [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Shared block revision not found."); return row; }
function editablePage(actor: Actor, page2: PageDraft) { return libraryWrite(actor, page2.locale); }
async function page(client: PoolClient, actor: Actor, id: string, edit = false) {
    const row = (await client.query<PgRow<'workspace_entities',{data:PageDraft}>>("SELECT data FROM workspace_entities WHERE bucket='pages' AND id=$1 AND deleted_at IS NULL", [id])).rows[0];
    (assert)(row && (hasWorkspacePermission)(actor, "view", "pages", row.data.locale), 404, "NOT_FOUND", "Page not found.");
    if (edit) {
        (assert)(editablePage(actor, row.data), 403, "FORBIDDEN", "This page cannot be edited by the current account.");
        (assert)(row.data.status === "draft", 409, "SHARED_DRAFT_REQUIRED", "Save an editable draft before changing a shared block.");
    }
    return row.data;
}
async function heldLease(client: PoolClient, actor: Actor, source: PageDraft, tokens: string[]) { const held = await client.query("SELECT 1 FROM content_edit_leases WHERE document_bucket='pages' AND document_id=$1 AND lease_until>now()", [source.id]); (assert)(held.rowCount, 423, "CONTENT_LEASE_REQUIRED", "Acquire the page editing lease before changing a shared block."); await (assertContentLeaseWrites)(client, actor, [{ bucket: "pages", id: source.id, before: source, after: source, action: "edit", activity: (serverActivity)(actor, "content.shared.lease-check", source.id) }], tokens); }
function validateSharedPayload(value: unknown): SharedBlockPayload { (safeJson)(value, "sharedPayload"); (assertObject)(value, "sharedPayload"); (keys)(value, ["type", "title", "body", "mediaUrl", "link", "formId", "formSchema", "hidden", "options"], "sharedPayload"); (assert)(Buffer.byteLength(JSON.stringify(value), "utf8") <= 18e4, 422, "SHARED_BLOCK_SIZE", "A shared block exceeds its 180 KB limit."); (validateBlocks)([{ ...value, id: "shared-payload" }]); return structuredClone(value) as SharedBlockPayload; }
function expandedSharedPayload(block: PageBlock): SharedBlockPayload { const { id: _id, shared: _shared, ...payload } = block; return payload; }
function sharedAssetIds(payload: unknown) { return [...new Set((assetReferences)(payload).map(reference => reference.id))]; }
async function retainAssets(client: PoolClient, actor: Actor, revisionId: string, payload: SharedBlockPayload) {
    for (const id of sharedAssetIds(payload)) {
        const row = (await client.query("SELECT owner_id,request_id,visibility,scan_status,metadata FROM assets WHERE id=$1 AND deleted_at IS NULL AND storage_purged_at IS NULL FOR SHARE", [id])).rows[0];
        (assert)(row && row.scan_status === "clean" && !row.request_id && row.metadata.damRole !== "original" && (row.visibility === "public" && row.metadata.rights === true || row.owner_id === actor.id) && await (assetUsageAllowed)(id, client), 422, "SHARED_ASSET_UNAVAILABLE", "A shared block can retain only available, scanned public or own editorial assets with current rights.");
        const confidential = await client.query("SELECT 1 FROM resource_versions WHERE asset_id=$1 UNION ALL SELECT 1 FROM crm_domain_asset_refs WHERE asset_id=$1 UNION ALL SELECT 1 FROM tender_asset_refs WHERE asset_id=$1 LIMIT 1", [id]);
        (assert)(!confidential.rowCount, 422, "SHARED_ASSET_UNAVAILABLE", "Controlled documents and CRM evidence cannot become ordinary shared content.");
        await client.query("INSERT INTO shared_block_asset_refs(revision_id,asset_id) VALUES($1,$2)", [revisionId, id]);
    }
}
async function entries(client: PoolClient, actor: Actor, rows: PgRow<'shared_blocks'>[]) { const latest = rows.length ? (await client.query<SummaryRow>("SELECT DISTINCT ON(block_id,locale) " + summaryColumns + " FROM shared_block_revisions WHERE block_id=ANY($1::uuid[]) AND locale=ANY($2::text[]) ORDER BY block_id,locale,revision_number DESC", [rows.map(row => row.id), actor.allowedLocales])).rows : []; return rows.map(row => ({ id: row.id, name: row.name, active: row.active, version: row.version, createdBy: row.created_by, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), latest: Object.fromEntries(latest.filter(item => item.block_id === row.id).map(item => [item.locale, summary(item)])), capabilities: { edit: libraryWrite(actor), createRevision: row.active && libraryWrite(actor), archive: libraryWrite(actor) } })); }
async function listSharedBlocks(actor: Actor, input = {}) { const options = (parse)(z.object({ cursor: uuid.optional() }).strict(), input); return (transaction)(async (client) => { actor = (await context(client, actor)).actor; const rows = (await client.query<PgRow<'shared_blocks'>>("SELECT * FROM shared_blocks WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 51", [options.cursor || null])).rows; const selected = rows.slice(0, 50); return { items: await entries(client, actor, selected), nextCursor: rows.length > 50 ? selected.at(-1)!.id : null, capabilities: { create: libraryWrite(actor) }, allowedLocales: LOCALES.filter(locale => actor.allowedLocales.includes(locale)) }; }); }
async function getSharedBlock(actor: Actor, id: string) { (parse)(uuid, id); return (transaction)(async (client) => { actor = (await context(client, actor)).actor; return (await entries(client, actor, [await library(client, id)]))[0]; }); }
async function getSharedBlockHistory(actor: Actor, id: string, input = {}) {
    (parse)(uuid, id);
    const options = (parse)(z.object({ cursor: uuid.optional(), locale: language.optional() }).strict(), input);
    return (transaction)(async (client) => {
        actor = (await context(client, actor)).actor;
        await library(client, id);
        if (options.locale)
            (assert)(actor.allowedLocales.includes(options.locale), 404, "NOT_FOUND", "Revision history not found.");
        const cursor = options.cursor ? await revision(client, options.cursor, id) : null;
        if (cursor)
            (assert)(actor.allowedLocales.includes(cursor.locale), 404, "NOT_FOUND", "Revision history not found.");
        const rows = (await client.query<SummaryRow>("SELECT " + summaryColumns + " FROM shared_block_revisions WHERE block_id=$1 AND locale=ANY($2::text[]) AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT 21", [id, options.locale ? [options.locale] : actor.allowedLocales, cursor?.created_at || null, cursor?.id || null])).rows;
        return { items: rows.slice(0, 20).map(summary), nextCursor: rows.length > 20 ? rows[19].id : null };
    });
}
async function getSharedBlockRevision(actor: Actor, id: string, revisionId: string) { (parse)(uuid, id); (parse)(uuid, revisionId); return (transaction)(async (client) => { actor = (await context(client, actor)).actor; const value = await revision(client, revisionId, id); (assert)(actor.allowedLocales.includes(value.locale), 404, "NOT_FOUND", "Shared block revision not found."); return revisionDto(value); }); }
async function appendRevision(client: PoolClient, actor: Actor, blockId: string, locale: Locale, payload: SharedBlockPayload, baseId: string | null) { const number = Number((await client.query("SELECT coalesce(max(revision_number),0)+1 AS value FROM shared_block_revisions WHERE block_id=$1 AND locale=$2", [blockId, locale])).rows[0].value); const row = (await client.query<RevisionRow>("INSERT INTO shared_block_revisions(id,block_id,locale,revision_number,base_revision_id,payload,checksum,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *", [(randomUUID)(), blockId, locale, number, baseId, JSON.stringify(payload), (checksum)(payload), actor.id])).rows[0]; await retainAssets(client, actor, row.id, payload); return row; }
async function createSharedBlock(actor: Actor, input: unknown) { const data = (parse)(z.object({ name: z.string().trim().min(1).max(160), pageId: identity, instanceId: identity, expectedVersion: version }).strict(), input); return (transaction)(async (client) => { actor = (await context(client, actor, data.expectedVersion)).actor; const source = await page(client, actor, data.pageId); (assert)(libraryWrite(actor, source.locale), 403, "FORBIDDEN", "Content editing permission is required."); const instance = source.blocks.find(block => block.id === data.instanceId); (assert)(instance && !instance.shared, 422, "SHARED_SOURCE_REQUIRED", "Choose an independent block from a saved page. Nested shared blocks are not allowed."); const payload = validateSharedPayload(expandedSharedPayload(instance)), id = (randomUUID)(); const row = (await client.query<PgRow<'shared_blocks'>>("INSERT INTO shared_blocks(id,name,created_by) VALUES($1,$2,$3) RETURNING *", [id, data.name, actor.id])).rows[0]; const created = await appendRevision(client, actor, id, source.locale, payload, null); await (audit)(actor.id, "content.shared.created", "shared-block", id, { revisionId: created.id, pageId: source.id, instanceId: instance.id, checksum: created.checksum }, client); return { block: (await entries(client, actor, [row]))[0], revision: revisionDto(created) }; }); }
async function updateSharedBlock(actor: Actor, id: string, input: unknown) { (parse)(uuid, id); const data = (parse)(z.object({ expectedVersion: version, name: z.string().trim().min(1).max(160).optional(), active: z.boolean().optional() }).strict().refine(value => value.name !== void 0 || value.active !== void 0), input); return (transaction)(async (client) => { actor = (await context(client, actor)).actor; (assert)(libraryWrite(actor), 403, "FORBIDDEN", "Content editing permission is required."); const before = await library(client, id, true); conflict(data.expectedVersion, before.version); const row = (await client.query<PgRow<'shared_blocks'>>("UPDATE shared_blocks SET name=coalesce($2,name),active=coalesce($3,active),version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, data.name ?? null, data.active ?? null])).rows[0]; await (audit)(actor.id, "content.shared.metadata", "shared-block", id, { active: row.active, version: row.version }, client); return (await entries(client, actor, [row]))[0]; }); }
async function createSharedBlockRevision(actor: Actor, id: string, input: unknown) {
    (parse)(uuid, id);
    const data = (parse)(z.object({ expectedVersion: version, locale: language, payload: z.unknown(), baseRevisionId: uuid.optional() }).strict(), input), payload = validateSharedPayload(data.payload);
    return (transaction)(async (client) => {
        actor = (await context(client, actor)).actor;
        (assert)(libraryWrite(actor, data.locale), 403, "FORBIDDEN", "This block language cannot be edited by the current account.");
        const block = await library(client, id, true);
        conflict(data.expectedVersion, block.version);
        (assert)(block.active, 409, "SHARED_BLOCK_ARCHIVED", "Restore the library block before creating a revision.");
        const base = data.baseRevisionId ? await revision(client, data.baseRevisionId, id) : null;
        if (base)
            (assert)(actor.allowedLocales.includes(base.locale), 404, "NOT_FOUND", "Base revision not found.");
        const created = await appendRevision(client, actor, id, data.locale, payload, base?.id || null);
        const row = (await client.query<PgRow<'shared_blocks'>>("UPDATE shared_blocks SET version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id])).rows[0];
        await (audit)(actor.id, "content.shared.revision.created", "shared-block", id, { revisionId: created.id, locale: data.locale, checksum: created.checksum }, client);
        return { block: (await entries(client, actor, [row]))[0], revision: revisionDto(created) };
    });
}
async function validateSharedBlockChanges(client: PoolClient, actor: Actor, changes: WorkspaceChange[], allowReferenceChanges = false) {
    for (const change of changes) {
        if (change.bucket !== "pages")
            continue;
        const before = change.before, after = change.after;
        if (!allowReferenceChanges) {
            for (const prior of before?.blocks || []) {
                if (!prior.shared)
                    continue;
                const next = after?.blocks.find(block => block.id === prior.id);
                (assert)(next && (equal)(prior.shared, next.shared) && (equal)(expandedSharedPayload(prior), expandedSharedPayload(next)), 403, "SHARED_REFERENCE_COMMAND", "Detach or apply a saved shared revision explicitly before changing a pinned block.");
            }
            for (const next of after?.blocks || [])
                if (next.shared) {
                    const prior = before?.blocks.find(block => block.id === next.id);
                    (assert)(prior?.shared && (equal)(prior.shared, next.shared), 403, "SHARED_REFERENCE_COMMAND", "Shared references can only be attached by a saved-revision command.");
                }
        }
        if (after)
            await validateSharedPagePublication(client, actor, after);
    }
}
async function validateSharedPagePublication(client: PoolClient, _actor: Actor, source: PageDraft) {
    for (const block of source.blocks) {
        if (!block.shared)
            continue;
        const row = await revision(client, block.shared.revisionId, block.shared.blockId);
        (assert)(row.locale === source.locale, 422, "SHARED_LOCALE_MISMATCH", "The pinned shared revision must match the page language.");
        const payload = validateSharedPayload(row.payload);
        (assert)((checksum)(payload) === row.checksum && (equal)(expandedSharedPayload(block), payload), 422, "SHARED_SNAPSHOT_MISMATCH", "The pinned block must exactly match its immutable saved revision.");
    }
}
function changedPage(source: PageDraft, blocks: PageBlock[], actor: Actor): PageDraft { return { ...source, blocks, status: "draft", author: actor.role, authorId: actor.id, approvedBy: void 0, approvedById: void 0, scheduledAt: void 0, updatedAt: new Date().toISOString(), version: source.version + 1, previous: { title: source.title, summary: source.summary, blocks: source.blocks, version: source.version } }; }
async function selectedRevision(client: PoolClient, actor: Actor, id: string, revisionId: string) { const source = await library(client, id); (assert)(source.active, 409, "SHARED_BLOCK_ARCHIVED", "Archived blocks cannot be attached or applied."); const value = await revision(client, revisionId, id); (assert)(libraryWrite(actor, value.locale), 403, "FORBIDDEN", "Content editing permission for this language is required."); validateSharedPayload(value.payload); return value; }
async function attachSharedBlock(actor: Actor, id: string, input: unknown, leaseTokens: string[] = []) {
    (parse)(uuid, id);
    const data = (parse)(z.object({ revisionId: uuid, pageId: identity, replaceInstanceId: identity.optional(), insertAfterId: identity.optional(), expectedVersion: version }).strict().refine(value => !(value.replaceInstanceId && value.insertAfterId)), input);
    return (transaction)(async (client) => {
        actor = (await context(client, actor, data.expectedVersion)).actor;
        const source = await page(client, actor, data.pageId, true), saved = await selectedRevision(client, actor, id, data.revisionId);
        (assert)(source.locale === saved.locale, 422, "SHARED_LOCALE_MISMATCH", "Select a revision in the page language.");
        await heldLease(client, actor, source, leaseTokens);
        const blocks = structuredClone(source.blocks), replaceIndex = data.replaceInstanceId ? blocks.findIndex(block => block.id === data.replaceInstanceId) : -1, insertIndex = data.insertAfterId ? blocks.findIndex(block => block.id === data.insertAfterId) : -1;
        (assert)(!data.replaceInstanceId || replaceIndex >= 0, 404, "NOT_FOUND", "Block instance not found.");
        (assert)(!data.insertAfterId || insertIndex >= 0, 404, "NOT_FOUND", "Insertion point not found.");
        const instance = { ...saved.payload, id: data.replaceInstanceId || "shared-" + (randomUUID)(), shared: { blockId: id, revisionId: saved.id } };
        if (replaceIndex >= 0)
            blocks[replaceIndex] = instance;
        else
            blocks.splice(data.insertAfterId ? insertIndex + 1 : blocks.length, 0, instance);
        (validateBlocks)(blocks);
        const result = await (applySharedBlockPages)(client, actor, [changedPage(source, blocks, actor)], leaseTokens);
        await (audit)(actor.id, "content.shared.attached", "shared-block", id, { pageId: source.id, instanceId: instance.id, revisionId: saved.id }, client);
        return result;
    });
}
async function detachSharedBlock(actor: Actor, input: unknown, leaseTokens: string[] = []) {
    const data = (parse)(z.object({ pageId: identity, instanceId: identity, expectedVersion: version }).strict(), input);
    return (transaction)(async (client) => {
        actor = (await context(client, actor, data.expectedVersion)).actor;
        const source = await page(client, actor, data.pageId, true);
        await heldLease(client, actor, source, leaseTokens);
        const instance = source.blocks.find(block => block.id === data.instanceId);
        (assert)(instance?.shared, 404, "NOT_FOUND", "Pinned shared block not found.");
        const blocks = source.blocks.map(block => {
            if (block.id !== data.instanceId)
                return block;
            const { shared: _shared, ...independent } = block;
            return independent;
        });
        const result = await (applySharedBlockPages)(client, actor, [changedPage(source, blocks, actor)], leaseTokens);
        await (audit)(actor.id, "content.shared.detached", "shared-block", instance.shared.blockId, { pageId: source.id, instanceId: instance.id, revisionId: instance.shared.revisionId }, client);
        return result;
    });
}
async function applySharedBlockRevision(actor: Actor, id: string, input: unknown, leaseTokens: string[] = []) {
    (parse)(uuid, id);
    const data = (parse)(z.object({ revisionId: uuid, pageIds: z.array(identity).min(1).max(20).refine(values => new Set(values).size === values.length), expectedVersion: version }).strict(), input);
    return (transaction)(async (client) => {
        actor = (await context(client, actor, data.expectedVersion)).actor;
        const saved = await selectedRevision(client, actor, id, data.revisionId), pages = [];
        for (const pageId of data.pageIds) {
            const source = await page(client, actor, pageId, true);
            (assert)(source.locale === saved.locale, 422, "SHARED_LOCALE_MISMATCH", "All selected pages must match the revision language.");
            (assert)(source.blocks.some(block => block.shared?.blockId === id), 422, "SHARED_REFERENCE_MISSING", "A selected page no longer uses this shared block.");
            await heldLease(client, actor, source, leaseTokens);
            const blocks = source.blocks.map(block => block.shared?.blockId === id ? { ...saved.payload, id: block.id, shared: { blockId: id, revisionId: saved.id } } : block);
            pages.push(changedPage(source, blocks, actor));
        }
        const result = await (applySharedBlockPages)(client, actor, pages, leaseTokens);
        await (audit)(actor.id, "content.shared.applied", "shared-block", id, { pageIds: data.pageIds, revisionId: saved.id }, client);
        return result;
    });
}
async function getSharedBlockImpact(actor: Actor, id: string) {
    (parse)(uuid, id);
    return (transaction)(async (client) => {
        const current = await context(client, actor);
        actor = current.actor;
        await library(client, id);
        const rows = (await client.query<ImpactRow>(`WITH usages AS (
    SELECT 'draft' AS stage,e.id AS page_id,e.data->>'title' AS title,e.locale,e.status AS source_status,b->>'id' AS instance_id,b#>>'{shared,revisionId}' AS pinned_revision_id,e.data->>'updatedAt' AS source_updated_at,NULL::timestamptz AS scheduled_at
    FROM workspace_entities e CROSS JOIN LATERAL jsonb_array_elements(e.data->'blocks') b
    WHERE e.bucket='pages' AND e.deleted_at IS NULL AND e.locale=ANY($2::text[]) AND b#>>'{shared,blockId}'=$1
    UNION ALL
    SELECT 'published',e.id,l.publication->>'title',l.locale,e.status,b->>'id',b#>>'{shared,revisionId}',e.data->>'updatedAt',NULL::timestamptz
    FROM locale_releases l JOIN workspace_entities e ON e.bucket='pages' AND e.id=l.document_id CROSS JOIN LATERAL jsonb_array_elements(l.publication->'blocks') b
    WHERE l.document_bucket='pages' AND l.unpublished_at IS NULL AND e.deleted_at IS NULL AND l.locale=ANY($2::text[]) AND b#>>'{shared,blockId}'=$1
    UNION ALL
    SELECT 'scheduled',e.id,r.snapshot->>'title',j.locale,e.status,b->>'id',b#>>'{shared,revisionId}',e.data->>'updatedAt',j.due_at
    FROM workspace_publish_jobs j JOIN content_revisions r ON r.id=j.revision_id JOIN workspace_entities e ON e.bucket='pages' AND e.id=j.document_id CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'blocks') b
    WHERE j.document_bucket='pages' AND j.status='pending' AND e.deleted_at IS NULL AND j.locale=ANY($2::text[]) AND b#>>'{shared,blockId}'=$1
  ) SELECT *,count(*) FILTER(WHERE stage='draft') OVER()::text AS draft_count,count(*) FILTER(WHERE stage='scheduled') OVER()::text AS scheduled_count,count(*) FILTER(WHERE stage='published') OVER()::text AS published_count FROM usages ORDER BY stage,page_id,instance_id LIMIT 501`, [id, actor.allowedLocales])).rows;
        const counts = { draft: Number(rows[0]?.draft_count || 0), scheduled: Number(rows[0]?.scheduled_count || 0), published: Number(rows[0]?.published_count || 0) };
        return { items: rows.slice(0, 500).map(row => ({ stage: row.stage, pageId: row.page_id, title: row.title, locale: row.locale, sourceStatus: row.source_status, instanceId: row.instance_id, pinnedRevisionId: row.pinned_revision_id, sourceUpdatedAt: row.source_updated_at, scheduledAt: row.scheduled_at?.toISOString() || null, canApply: row.stage === "draft" && row.source_status === "draft" && libraryWrite(actor, row.locale) })), counts, truncated: rows.length > 500, workspaceVersion: current.version };
    });
}
export { applySharedBlockRevision, attachSharedBlock, createSharedBlock, createSharedBlockRevision, detachSharedBlock, expandedSharedPayload, getSharedBlock, getSharedBlockHistory, getSharedBlockImpact, getSharedBlockRevision, listSharedBlocks, sharedAssetIds, updateSharedBlock, validateSharedBlockChanges, validateSharedPagePublication, validateSharedPayload };
