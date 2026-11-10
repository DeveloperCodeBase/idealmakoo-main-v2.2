import type {PgRow} from './recovered-db-rows';
import type {CrmAudienceAccount} from './crm-audience';
export type SegmentFilter = z.infer<typeof leafSchema> | {all:SegmentFilter[]} | {any:SegmentFilter[]};
export type CampaignDraft = z.infer<typeof draftSchema>;
type SegmentRow = PgRow<'crm_segments',{filter:SegmentFilter}>;
type CampaignRow = PgRow<'crm_campaigns',{draft:CampaignDraft}>;
type CampaignRevisionRow = PgRow<'crm_campaign_revisions',{draft:CampaignDraft;filter:SegmentFilter;sender_scope:Pick<Actor,'role'|'qualityScope'|'allowedLocales'|'crmAccess'>}>;
type CampaignEndpointRef = {channel:'email'|'in-app';userId:string;valueHash:string} | {channel:'email';endpointId:string;endpointVersion:number;valueHash:string} | {channel:'sms'|'telegram'|'push';bindingId:string;endpointVersion:number;valueHash:string};
type EnrollmentRow = PgRow<'crm_campaign_enrollments',{endpoint_refs:CampaignEndpointRef[]}>;
type DeliveryRow = PgRow<'crm_campaign_deliveries'> & {recipient_id:string;user_id:string|null;endpoint_refs:CampaignEndpointRef[];state:PgRow<'outbox'>['state'];last_error:string|null;completed_at:Date|null};
import type { Actor } from './types';
import type { PoolClient } from 'pg';
import type { Locale } from '../lib/i18n';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { parse } from "./http";
import { assert, locales, HttpError } from "./types";
import { hash } from "./crypto";
import { isCrmManager, audienceLimit, projectCrmRecipientAudience, currentCrmSender, audienceSample, projectCrmAudience, storedCrmSender, isRecipientCampaignSuppressed } from "./crm-audience";
import { communicationCapabilities, resolveBoundDelivery, captureBoundEndpoints } from "./communication-channels";
import { transaction, audit } from "./db";
import { randomUUID } from "node:crypto";
import { resolveContactDelivery, captureContactEndpoints, enqueueContactNotification } from "./contact-notifications";
import { resolveNotificationRecipient, enqueueAccountNotification } from "./notification-policy";
import { enqueueBoundNotification } from "./binding-notifications";
const nameSchema = z.string().trim().min(1).max(160).regex(/^[^\x00-\x1f\x7f]+$/);
const reasonSchema = z.string().trim().min(8).max(500);
const leafSchema = z.object({ field: z.enum(["locale", "requestKind", "requestStatus", "tag", "subjectType", "accountId"]), op: z.literal("in"), values: z.array(z.string().trim().min(1).max(100).regex(/^[^\x00-\x1f\x7f]+$/)).min(1).max(20) }).strict();
const localHref = (value: string) => /^\/(?!\/)/.test(value) && !/[\\\x00-\x20\x7f]/.test(value) && !/%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(value);
const textSchema = z.object({ title: z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/), body: z.string().trim().min(1).max(1e4).regex(/^[^\x00-\x08\x0b-\x1f\x7f]+$/), href: z.string().min(1).max(300).refine(localHref, "Use a safe local path, without backslashes or controls.") }).strict();
const contentSchema = z.object({ fa: textSchema, en: textSchema, tr: textSchema, ar: textSchema, ru: textSchema }).strict();
const draftSchema = z.object({ name: nameSchema, segmentId: z.string().uuid(), snapshotId: z.string().uuid().nullable(), topic: z.enum(["products", "research", "events"]), channels: z.array(z.enum(["in-app", "email", "sms", "telegram", "push"])).min(1).max(5).refine(value => new Set(value).size === value.length, "Choose each channel once."), steps: z.array(z.object({ delayMinutes: z.number().int().min(0).max(43200), content: contentSchema }).strict()).min(1).max(5) }).strict().refine(value => value.steps[0].delayMinutes === 0 && value.steps.slice(1).every(step => step.delayMinutes >= 1), "The first delay is zero; later steps wait at least one elapsed minute after prior acceptance.");
const parseCampaignDraft = (body: unknown) => {
    const value = (parse)(draftSchema, body);
    for (const channel of value.channels)
        if (["sms", "telegram", "push"].includes(channel)) {
            const limits = channel === "sms" ? [120, 400] : channel === "telegram" ? [200, 2200] : [100, 300];
            for (const step of value.steps)
                for (const content of Object.values(step.content))
                    (assert)([...content.title].length <= limits[0] && [...content.body].length <= limits[1], 422, "CAMPAIGN_CHANNEL_LENGTH", `Use at most ${limits[0]} title and ${limits[1]} message characters for ${channel}.`);
        }
    return value;
};
function parseSegmentFilter(value: unknown): SegmentFilter {
    const stack = [{ value, depth: 1 }];
    let leaves = 0, nodes = 0;
    while (stack.length) {
        const node = stack.pop()!;
        (assert)(++nodes <= 60 && node.depth <= 3, 422, "SEGMENT_COMPLEXITY", "Use a filter with depth at most three and at most twenty predicates.");
        (assert)(node.value && typeof node.value === "object" && !Array.isArray(node.value), 422, "SEGMENT_FILTER", "Each filter node must be an object.");
        const item = node.value as Record<string,unknown>, keys = Object.keys(item), branch = Object.hasOwn(item, "all") ? "all" : Object.hasOwn(item, "any") ? "any" : null;
        if (branch) {
            (assert)(keys.length === 1 && Array.isArray(item[branch]) && item[branch].length >= 1 && item[branch].length <= 20, 422, "SEGMENT_FILTER", "An all/any node contains one to twenty child nodes.");
            for (const child of item[branch])
                stack.push({ value: child, depth: node.depth + 1 });
        }
        else {
            (assert)(++leaves <= 20, 422, "SEGMENT_COMPLEXITY", "Use at most twenty predicates.");
            (parse)(leafSchema, item);
        }
    }
    const normalize = (node: unknown): SegmentFilter => {
        const item = node as Record<string,unknown>;
        if (Array.isArray(item.all))
            return { all: item.all.map(normalize) };
        if (Array.isArray(item.any))
            return { any: item.any.map(normalize) };
        const leaf = (parse)(leafSchema, node);
        if (leaf.field === "locale")
            (assert)(leaf.values.every(value2 => (locales as readonly string[]).includes(value2)), 422, "SEGMENT_LOCALE", "Use supported locale codes.");
        return { ...leaf, values: [...new Set(leaf.values)] };
    };
    return normalize(value);
}
function matchesSegment(filter: SegmentFilter, account: CrmAudienceAccount): boolean { return "all" in filter ? filter.all.every(item => matchesSegment(item, account)) : "any" in filter ? filter.any.some(item => matchesSegment(item, account)) : filter.values.some(value => (account.facts[filter.field] || []).includes(value)); }
function segmentInput(body: unknown) { const input = (parse)(z.object({ name: nameSchema, filter: z.unknown(), active: z.boolean(), audience: z.enum(["users", "contacts", "all"]).default("users") }).strict(), body); return { ...input, filter: parseSegmentFilter(input.filter) }; }
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string,unknown>)[key])])) : value;
const digest = (value: unknown) => (hash)(JSON.stringify(canonical(value)));
const requireId = (id: string) => (assert)(z.string().uuid().safeParse(id).success, 404, "NOT_FOUND", "The CRM resource was not found.");
const expected = (provided: unknown, version: number) => (assert)(Number.isSafeInteger(provided) && provided === version, 409, "CONFLICT", "This record changed. Refresh its current version before retrying.");
const own = (actor: Actor, id: string) => (assert)((isCrmManager)(actor) || actor.id === id, 404, "NOT_FOUND", "The CRM resource was not found.");
const enabled = () => process.env.CRM_CAMPAIGNS_ENABLED === "true";
function campaignCapabilities(actor: Actor) { const dkim = process.env.SMTP_DKIM_MODE === "gateway" || process.env.SMTP_DKIM_MODE === "application" && !!process.env.SMTP_DKIM_DOMAIN && !!process.env.SMTP_DKIM_SELECTOR && !!process.env.SMTP_DKIM_PRIVATE_KEY_B64; return { enabled: enabled(), channels: { inApp: true, sms: (communicationCapabilities)().sms.configured, telegram: (communicationCapabilities)().telegram.configured, push: (communicationCapabilities)().push.configured, email: process.env.NOTIFICATIONS_MODE === "live" && !!process.env.SMTP_HOST && !!process.env.SMTP_FROM && !!dkim && /^https:\/\//.test(process.env.SITE_URL || "") }, allowedLocales: locales.filter(locale => actor.allowedLocales.includes(locale)), limits: { recipients: 1e4, steps: 5, filterDepth: 3, filterPredicates: 20, previewSamples: 25 } }; }
const segmentDto = (row: SegmentRow) => ({ id: row.id, name: row.name, audience: row.audience, filter: row.filter, active: row.active, version: row.version, createdBy: row.created_by, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const revisionDto = (row: CampaignRevisionRow) => ({ id: row.id, audience: row.audience, version: row.version, hash: row.revision_hash, senderId: row.sender_id, segmentVersion: row.segment_version, filter: row.filter, draft: row.draft, createdAt: row.created_at.toISOString() });
const campaignSummary = (row: CampaignRow, revision: CampaignRevisionRow|null) => ({ id: row.id, name: row.name, status: row.status, version: row.version, createdBy: row.created_by, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), startAt: row.start_at?.toISOString() || null, revisionId: row.current_revision_id, revisionHash: revision?.revision_hash || null, enrollmentComplete: row.enrollment_complete, stopCode: row.stop_code });
const identityDto = (account: CrmAudienceAccount) => ({ recipientId: account.recipientId, subjectType: account.subjectType, subjectId: account.subjectId, ...account.userId ? { userId: account.userId } : {} });
const suppressionDto = (row: PgRow<'crm_campaign_suppressions'>, account: CrmAudienceAccount) => ({ id: row.id, ...identityDto(account), scope: row.sender_id ? "sender" : "global", senderId: row.sender_id, topic: row.topic, channel: row.channel, reason: row.reason, version: row.version, active: !row.revoked_at, createdBy: row.created_by, createdAt: row.created_at.toISOString(), revokedAt: row.revoked_at?.toISOString() || null });
const segmentHash = (row: Pick<SegmentRow,'filter'|'audience'>) => digest({ filter: row.filter, audience: row.audience || "users" });
async function segmentFor(client: PoolClient, actor: Actor, id: string, lock = false) { requireId(id); const row = (await client.query<SegmentRow>("SELECT * FROM crm_segments WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Segment not found."); own(actor, row.created_by); return row; }
async function campaignFor(client: PoolClient, actor: Actor, id: string, lock = false) { requireId(id); const row = (await client.query<CampaignRow>("SELECT * FROM crm_campaigns WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Campaign not found."); own(actor, row.created_by); return row; }
async function currentRevision(client: PoolClient, row: CampaignRow) { return row.current_revision_id ? (await client.query<CampaignRevisionRow>("SELECT * FROM crm_campaign_revisions WHERE id=$1", [row.current_revision_id])).rows[0] || null : null; }
async function allAudience(client: PoolClient, actor: Actor, filter?: SegmentFilter, memberIds?: string[], audience: PgRow<'crm_segments'>['audience'] = "all") {
    const ids = memberIds || (await client.query("SELECT id FROM communication_recipients WHERE active AND ($1='all' OR subject_type=CASE WHEN $1='users' THEN 'user' ELSE 'crm-contact' END) ORDER BY id LIMIT 10001", [audience])).rows.map(row => row.id);
    (assert)(ids.length <= audienceLimit, 503, "AUDIENCE_REVIEW_LIMIT", "The recipient directory exceeds this bounded online workflow.");
    const result = [];
    for (let offset = 0; offset < ids.length; offset += 500)
        for (const account of await (projectCrmRecipientAudience)(client, actor, ids.slice(offset, offset + 500)))
            if (!filter || matchesSegment(filter, account))
                result.push(account);
    return result;
}
async function detail(client: PoolClient, actor: Actor, row: CampaignRow) {
    const revision = await currentRevision(client, row), counts = { pending: 0, waiting: 0, completed: 0, suppressed: 0, failed: 0, uncertain: 0, cancelled: 0 }, recent = [], visible = new Map<string,CrmAudienceAccount>, deliveryCounts: Record<PgRow<'outbox'>['state'],number> = { pending: 0, running: 0, batched: 0, delivered: 0, cancelled: 0, failed: 0, uncertain: 0 }, deliveries = [];
    if (revision) {
        const rows = (await client.query<EnrollmentRow>("SELECT * FROM crm_campaign_enrollments WHERE revision_id=$1 ORDER BY created_at DESC,id LIMIT 10001", [revision.id])).rows;
        (assert)(rows.length <= audienceLimit, 503, "AUDIENCE_REVIEW_LIMIT", "The campaign history exceeds this bounded online workflow.");
        for (let offset = 0; offset < rows.length; offset += 500) {
            const chunk = rows.slice(offset, offset + 500), permitted = new Map((await (projectCrmRecipientAudience)(client, actor, chunk.map(item => item.recipient_id))).map(account => [account.recipientId, account]));
            for (const enrollment of chunk) {
                const account = permitted.get(enrollment.recipient_id);
                if (!account)
                    continue;
                visible.set(account.recipientId, account);
                counts[enrollment.state]++;
                if (recent.length < 25)
                    recent.push({ id: enrollment.id, ...identityDto(account), name: account.name, locale: enrollment.locale, state: enrollment.state, stepIndex: enrollment.step_index, nextAt: enrollment.next_at?.toISOString() || null, stopCode: enrollment.stop_code });
            }
        }
        if (visible.size) {
            const visibleIds = [...visible.keys()], aggregate = (await client.query<{state:PgRow<'outbox'>['state'];count:string}>(`SELECT o.state,count(*) FROM crm_campaign_deliveries d JOIN crm_campaign_enrollments e ON e.id=d.enrollment_id JOIN outbox o ON o.id=d.outbox_id WHERE d.revision_id=$1 AND e.recipient_id=ANY($2::uuid[]) GROUP BY o.state`, [revision.id, visibleIds])).rows;
            for (const item of aggregate)
                deliveryCounts[item.state] = Number(item.count);
            const latest = (await client.query<DeliveryRow>(`SELECT d.id,d.outbox_id,d.enrollment_id,e.recipient_id,d.step_index,d.channel,d.locale,o.state,o.last_error,d.created_at,o.completed_at FROM crm_campaign_deliveries d JOIN crm_campaign_enrollments e ON e.id=d.enrollment_id JOIN outbox o ON o.id=d.outbox_id WHERE d.revision_id=$1 AND e.recipient_id=ANY($2::uuid[]) ORDER BY d.created_at DESC,d.id LIMIT 50`, [revision.id, visibleIds])).rows;
            for (const item of latest)
                deliveries.push({ id: item.id, outboxId: item.outbox_id, enrollmentId: item.enrollment_id, ...identityDto(visible.get(item.recipient_id)!), stepIndex: item.step_index, channel: item.channel, locale: item.locale, state: item.state, lastError: item.last_error, createdAt: item.created_at.toISOString(), completedAt: item.completed_at?.toISOString() || null });
        }
    }
    return { ...campaignSummary(row, revision), draft: row.draft, revision: revision ? revisionDto(revision) : null, counts, recent, deliveryCounts, deliveries, countsReflectCurrentAccess: true };
}
async function writeSegmentRevision(client: PoolClient, actor: Actor, row: SegmentRow) { await client.query<PgRow<'crm_segment_revisions',{definition:ReturnType<typeof segmentInput>}>>("INSERT INTO crm_segment_revisions(segment_id,version,definition,definition_hash,created_by) VALUES($1,$2,$3::jsonb,$4,$5)", [row.id, row.version, JSON.stringify({ name: row.name, filter: row.filter, active: row.active, audience: row.audience }), segmentHash(row), actor.id]); }
async function listCrmSegments(actor: Actor) { return (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client, "segments"); const rows = (await client.query<SegmentRow>("SELECT * FROM crm_segments" + ((isCrmManager)(actor) ? "" : " WHERE created_by=$1") + " ORDER BY updated_at DESC,id LIMIT 100", (isCrmManager)(actor) ? [] : [actor.id])).rows; const snapshots = (await client.query<PgRow<'crm_segment_snapshots'>>("SELECT * FROM crm_segment_snapshots WHERE segment_id=ANY($1::uuid[])" + ((isCrmManager)(actor) ? "" : " AND created_by=$2") + " ORDER BY created_at DESC,id LIMIT 100", (isCrmManager)(actor) ? [rows.map(row => row.id)] : [rows.map(row => row.id), actor.id])).rows; const memberIds = snapshots.length ? (await client.query("SELECT DISTINCT recipient_id FROM crm_segment_snapshot_members WHERE snapshot_id=ANY($1::uuid[]) LIMIT 10001", [snapshots.map(row => row.id)])).rows.map(row => row.recipient_id) : [], visibleIds = (await allAudience(client, actor, void 0, memberIds)).map(account => account.recipientId), counts = new Map((await client.query("SELECT snapshot_id,count(*) FROM crm_segment_snapshot_members WHERE snapshot_id=ANY($1::uuid[]) AND recipient_id=ANY($2::uuid[]) GROUP BY snapshot_id", [snapshots.map(row => row.id), visibleIds])).rows.map(row => [row.snapshot_id, Number(row.count)])); const projected = snapshots.map(row => ({ id: row.id, segmentId: row.segment_id, segmentVersion: row.segment_version, createdBy: row.created_by, createdAt: row.created_at.toISOString(), definitionHash: row.definition_hash, visibleMembers: counts.get(row.id) || 0 })); return { items: rows.map(segmentDto), snapshots: projected, capabilities: campaignCapabilities(actor) }; }); }
async function getCrmSegment(actor: Actor, id: string) { return (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client, "segments"); return segmentDto(await segmentFor(client, actor, id)); }); }
async function createCrmSegment(actor: Actor, body: unknown) { const input = segmentInput(body); return (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client, "segments", "create"); const row = (await client.query<SegmentRow>("INSERT INTO crm_segments(id,name,filter,active,created_by,audience) VALUES($1,$2,$3::jsonb,$4,$5,$6) RETURNING *", [(randomUUID)(), input.name, JSON.stringify(input.filter), input.active, actor.id, input.audience || "users"])).rows[0]; await writeSegmentRevision(client, actor, row); await (audit)(actor.id, "crm.segment.created", "crm_segment", row.id, { version: row.version, definitionHash: segmentHash(row) }, client); return segmentDto(row); }); }
async function updateCrmSegment(actor: Actor, id: string, body: unknown, version: number) { const input = segmentInput(body); return (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client, "segments", "edit"); const old = await segmentFor(client, actor, id, true); expected(version, old.version); const row = (await client.query<SegmentRow>("UPDATE crm_segments SET name=$2,filter=$3::jsonb,active=$4,audience=$5,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, input.name, JSON.stringify(input.filter), input.active, input.audience || "users"])).rows[0]; await writeSegmentRevision(client, actor, row); await (audit)(actor.id, "crm.segment.updated", "crm_segment", id, { version: row.version, definitionHash: segmentHash(row), active: row.active }, client); return segmentDto(row); }); }
async function previewCrmSegment(actor: Actor, id: string, version: number) { return (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client, "segments"); const row = await segmentFor(client, actor, id); expected(version, row.version); const accounts = await allAudience(client, actor, row.filter, void 0, row.audience); return { segmentId: id, version: row.version, definitionHash: segmentHash(row), matched: accounts.length, sample: accounts.slice(0, 25).map(audienceSample), sampleLimit: 25, countsReflectCurrentAccess: true }; }); }
async function snapshotCrmSegment(actor: Actor, id: string, version: number) {
    return (transaction)(async (client) => {
        actor = await (currentCrmSender)(actor, client, "segments", "create");
        const row = await segmentFor(client, actor, id, true);
        expected(version, row.version);
        (assert)(row.active, 409, "SEGMENT_INACTIVE", "Activate the segment before taking a snapshot.");
        const accounts = await allAudience(client, actor, row.filter, void 0, row.audience), snapshot = (await client.query<PgRow<'crm_segment_snapshots'>>("INSERT INTO crm_segment_snapshots(id,segment_id,segment_version,definition_hash,membership_hash,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [(randomUUID)(), id, row.version, segmentHash(row), digest(accounts.map(account => account.recipientId).sort()), actor.id])).rows[0];
        if (accounts.length)
            await client.query("INSERT INTO crm_segment_snapshot_members(snapshot_id,recipient_id) SELECT $1,unnest($2::uuid[])", [snapshot.id, accounts.map(account => account.recipientId)]);
        await (audit)(actor.id, "crm.segment.snapshot", "crm_segment", id, { snapshotId: snapshot.id, version: row.version }, client);
        return { id: snapshot.id, segmentId: id, segmentVersion: row.version, createdBy: actor.id, createdAt: snapshot.created_at.toISOString(), definitionHash: snapshot.definition_hash, visibleMembers: accounts.length };
    });
}
async function draftReference(client: PoolClient, actor: Actor, draft: CampaignDraft) {
    const segment = await segmentFor(client, actor, draft.segmentId);
    if (!draft.snapshotId)
        return { segment, version: segment.version, filter: segment.filter, audience: segment.audience };
    const snapshot = (await client.query<PgRow<'crm_segment_snapshots'>>("SELECT * FROM crm_segment_snapshots WHERE id=$1 AND segment_id=$2", [draft.snapshotId, segment.id])).rows[0];
    (assert)(snapshot, 404, "NOT_FOUND", "Segment snapshot not found.");
    own(actor, snapshot.created_by);
    const revision = (await client.query<PgRow<'crm_segment_revisions',{definition:ReturnType<typeof segmentInput>}>>("SELECT definition FROM crm_segment_revisions WHERE segment_id=$1 AND version=$2", [segment.id, snapshot.segment_version])).rows[0];
    (assert)(revision, 503, "SEGMENT_REVISION", "The immutable segment revision is unavailable.");
    return { segment, version: snapshot.segment_version, filter: revision.definition.filter, audience: revision.definition.audience || "users" };
}
async function listCrmCampaigns(actor: Actor) {
    return (transaction)(async (client) => {
        actor = await (currentCrmSender)(actor, client);
        const rows = (await client.query<CampaignRow>("SELECT * FROM crm_campaigns" + ((isCrmManager)(actor) ? "" : " WHERE created_by=$1") + " ORDER BY updated_at DESC,id LIMIT 100", (isCrmManager)(actor) ? [] : [actor.id])).rows, items = [];
        for (const row of rows)
            items.push(campaignSummary(row, await currentRevision(client, row)));
        return { items, capabilities: campaignCapabilities(actor) };
    });
}
async function getCrmCampaign(actor: Actor, id: string) { return (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client); return detail(client, actor, await campaignFor(client, actor, id)); }); }
async function createCrmCampaign(actor: Actor, body: unknown) { const draft = parseCampaignDraft(body); return (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client, "campaigns", "create"); await draftReference(client, actor, draft); const row = (await client.query<CampaignRow>("INSERT INTO crm_campaigns(id,name,draft,created_by) VALUES($1,$2,$3::jsonb,$4) RETURNING *", [(randomUUID)(), draft.name, JSON.stringify(draft), actor.id])).rows[0]; await (audit)(actor.id, "crm.campaign.created", "crm_campaign", row.id, {}, client); return detail(client, actor, row); }); }
async function updateCrmCampaign(actor: Actor, id: string, body: unknown, version: number) { const draft = parseCampaignDraft(body); return (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client, "campaigns", "edit"); const old = await campaignFor(client, actor, id, true); expected(version, old.version); (assert)(old.status === "draft", 409, "CAMPAIGN_FROZEN", "Scheduled content is immutable. Create a new campaign for a different revision."); await draftReference(client, actor, draft); const row = (await client.query<CampaignRow>("UPDATE crm_campaigns SET name=$2,draft=$3::jsonb,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, draft.name, JSON.stringify(draft)])).rows[0]; await (audit)(actor.id, "crm.campaign.updated", "crm_campaign", id, { version: row.version }, client); return detail(client, actor, row); }); }
async function scheduleCrmCampaign(actor: Actor, id: string, body: unknown, version: number) {
    const input = (parse)(z.object({ startAt: z.string().datetime({ offset: true }) }).strict(), body);
    const requested = Date.parse(input.startAt);
    (assert)(requested >= Date.now() - 6e4 && requested <= Date.now() + 366 * 864e5, 422, "CAMPAIGN_START", "Choose a start within the next year (or the current minute).");
    return (transaction)(async (client) => {
        actor = await (currentCrmSender)(actor, client, "campaigns", "create");
        (assert)(enabled(), 409, "CAMPAIGNS_DISABLED", "Campaign scheduling is disabled by the operator.");
        const old = await campaignFor(client, actor, id, true);
        expected(version, old.version);
        (assert)(old.status === "draft", 409, "CAMPAIGN_FROZEN", "This campaign has already been scheduled or closed.");
        const draft = parseCampaignDraft(old.draft), reference = await draftReference(client, actor, draft);
        (assert)(reference.segment.active, 409, "SEGMENT_INACTIVE", "Activate the segment before scheduling.");
        (assert)(!draft.channels.includes("email") || campaignCapabilities(actor).channels.email, 409, "CAMPAIGN_EMAIL_DISABLED", "Configure live, verified, DKIM-signed email delivery before scheduling email.");
        for (const channel of draft.channels)
            if (channel === "sms" || channel === "telegram" || channel === "push")
                (assert)((communicationCapabilities)()[channel].configured, 409, "CAMPAIGN_CHANNEL_DISABLED", "Configure the selected verified-channel provider before scheduling.");
        (assert)(actor.allowedLocales.length, 403, "CAMPAIGN_LOCALES", "The sender has no permitted locale.");
        const revisionId = (randomUUID)(), startAt = new Date(Math.max(requested, Date.now())), senderScope = { role: actor.role, qualityScope: actor.qualityScope, allowedLocales: actor.allowedLocales, crmAccess: actor.crmAccess }, revisionHash = digest({ draft, audience: reference.audience, filter: reference.filter, segmentVersion: reference.version, senderId: actor.id, senderScope, startAt: startAt.toISOString() });
        await client.query<CampaignRevisionRow>("INSERT INTO crm_campaign_revisions(id,campaign_id,version,draft,segment_id,segment_version,filter,snapshot_id,sender_id,sender_scope,start_at,revision_hash,audience) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13)", [revisionId, id, old.version + 1, JSON.stringify(draft), draft.segmentId, reference.version, JSON.stringify(reference.filter), draft.snapshotId, actor.id, JSON.stringify(senderScope), startAt, revisionHash, reference.audience]);
        const row = (await client.query<CampaignRow>("UPDATE crm_campaigns SET status='scheduled',current_revision_id=$2,start_at=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, revisionId, startAt])).rows[0];
        await (audit)(actor.id, "crm.campaign.scheduled", "crm_campaign", id, { revisionId, revisionHash, startAt: startAt.toISOString(), channels: draft.channels }, client);
        return detail(client, actor, row);
    });
}
async function cancelQueuedDeliveries(client: PoolClient, revisionId: string, code: string, enrollmentId?: string) {
    const args = [revisionId, code];
    if (enrollmentId)
        args.push(enrollmentId);
    const rows = (await client.query(`UPDATE outbox o SET state='cancelled',last_error=$2,completed_at=now(),lock_token=NULL FROM crm_campaign_deliveries d WHERE d.outbox_id=o.id AND d.revision_id=$1 ${enrollmentId ? "AND d.enrollment_id=$3" : ""} AND o.state IN ('pending','batched') RETURNING o.id`, args)).rows;
    if (rows.length) {
        await client.query("UPDATE notification_digest_items SET state='cancelled',completed_at=now() WHERE outbox_id=ANY($1::text[]) AND state IN ('pending','batched')", [rows.map(row => row.id)]);
        for (const row of rows)
            await client.query("INSERT INTO delivery_events(outbox_id,provider,status,detail) VALUES($1,$2,$3,$4)", [row.id, "campaign", "suppressed", code]);
    }
}
async function cancelCrmCampaign(actor: Actor, id: string, body: unknown, version: number) {
    const input = (parse)(z.object({ reason: reasonSchema }).strict(), body);
    return (transaction)(async (client) => {
        actor = await (currentCrmSender)(actor, client, "campaigns", "edit");
        const old = await campaignFor(client, actor, id, true);
        expected(version, old.version);
        if (old.status === "cancelled")
            return detail(client, actor, old);
        (assert)(["draft", "scheduled", "running"].includes(old.status), 409, "CAMPAIGN_CLOSED", "This campaign has already finished; inspect its actual delivery results.");
        if (old.current_revision_id) {
            await cancelQueuedDeliveries(client, old.current_revision_id, "CAMPAIGN_CANCELLED");
            await client.query<EnrollmentRow>("UPDATE crm_campaign_enrollments SET state='cancelled',stop_code='CAMPAIGN_CANCELLED',next_at=NULL,updated_at=now() WHERE revision_id=$1 AND state IN ('pending','waiting')", [old.current_revision_id]);
        }
        const row = (await client.query<CampaignRow>("UPDATE crm_campaigns SET status='cancelled',stop_code='CAMPAIGN_CANCELLED',version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id])).rows[0];
        await (audit)(actor.id, "crm.campaign.cancelled", "crm_campaign", id, { reason: input.reason }, client);
        return detail(client, actor, row);
    });
}
async function listCrmSuppressions(actor: Actor) { return (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client); const rows = (await client.query<PgRow<'crm_campaign_suppressions'>>("SELECT * FROM crm_campaign_suppressions" + ((isCrmManager)(actor) ? "" : " WHERE sender_id=$1 OR sender_id IS NULL") + " ORDER BY created_at DESC,id LIMIT 500", (isCrmManager)(actor) ? [] : [actor.id])).rows; const visible = new Map((await allAudience(client, actor, void 0, [...new Set(rows.map(row => row.recipient_id))])).map(account => [account.recipientId, account])); return { items: rows.filter(row => visible.has(row.recipient_id)).map(row => suppressionDto(row, visible.get(row.recipient_id)!)) }; }); }
async function createCrmSuppression(actor: Actor, body: unknown) {
    const input = (parse)(z.object({ recipientId: z.string().uuid().optional(), userId: z.string().min(1).max(100).optional(), scope: z.enum(["sender", "global"]), topic: z.enum(["products", "research", "events", "all"]), channel: z.enum(["in-app", "email", "sms", "telegram", "push", "all"]), reason: reasonSchema }).strict().refine(value => !!value.recipientId !== !!value.userId, "Choose exactly one typed recipient."), body);
    try {
        return await (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client, "campaigns", "create"); (assert)(input.scope !== "global" || (isCrmManager)(actor), 403, "GLOBAL_SUPPRESSION", "Only current administrators can set a global marketing suppression."); const account = (input.recipientId ? await (projectCrmRecipientAudience)(client, actor, [input.recipientId]) : await (projectCrmAudience)(client, actor, [input.userId!]))[0]; (assert)(account, 404, "RECIPIENT_NOT_FOUND", "Recipient not found in your current CRM scope."); const row = (await client.query<PgRow<'crm_campaign_suppressions'>>("INSERT INTO crm_campaign_suppressions(id,recipient_id,user_id,sender_id,topic,channel,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [(randomUUID)(), account.recipientId, account.userId || null, input.scope === "global" ? null : actor.id, input.topic, input.channel, input.reason, actor.id])).rows[0]; await (audit)(actor.id, "crm.campaign.suppressed", "crm_suppression", row.id, { scope: input.scope, topic: input.topic, channel: input.channel }, client); return suppressionDto(row, account); });
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "23505")
            throw new HttpError(409, "SUPPRESSION_EXISTS", "An active suppression already covers this exact sender, topic and channel.");
        throw error;
    }
}
async function revokeCrmSuppression(actor: Actor, id: string, body: unknown, version: number) {
    requireId(id);
    const input = (parse)(z.object({ reason: reasonSchema }).strict(), body);
    return (transaction)(async (client) => {
        actor = await (currentCrmSender)(actor, client, "campaigns", "edit");
        const old = (await client.query<PgRow<'crm_campaign_suppressions'>>("SELECT * FROM crm_campaign_suppressions WHERE id=$1 FOR UPDATE", [id])).rows[0];
        (assert)(old, 404, "NOT_FOUND", "Suppression not found.");
        (assert)((isCrmManager)(actor) || old.sender_id === actor.id, 404, "NOT_FOUND", "Suppression not found.");
        const account = (await (projectCrmRecipientAudience)(client, actor, [old.recipient_id]))[0];
        (assert)(account, 404, "RECIPIENT_NOT_FOUND", "Recipient not found in your current CRM scope.");
        expected(version, old.version);
        if (old.revoked_at)
            return suppressionDto(old, account);
        const row = (await client.query<PgRow<'crm_campaign_suppressions'>>("UPDATE crm_campaign_suppressions SET revoked_at=now(),revoked_by=$2,release_reason=$3,version=version+1 WHERE id=$1 RETURNING *", [id, actor.id, input.reason])).rows[0];
        await (audit)(actor.id, "crm.campaign.suppression.revoked", "crm_suppression", id, { reason: input.reason }, client);
        return suppressionDto(row, account);
    });
}
async function searchCrmCampaignRecipients(actor: Actor, input: unknown) { const value = (parse)(z.object({ search: z.string().trim().min(2).max(120), audience: z.enum(["users", "contacts", "all"]).default("all") }).strict(), input); return (transaction)(async (client) => { actor = await (currentCrmSender)(actor, client); const needle = value.search.toLocaleLowerCase("en"), items = (await allAudience(client, actor, void 0, void 0, value.audience)).filter(account => [account.name, account.id].some(text => text.toLocaleLowerCase("en").includes(needle))).slice(0, 50).map(audienceSample); return { items }; }); }
function frozenSender(current: Actor, revision: CampaignRevisionRow): Actor { return { ...current, ...revision.sender_scope, id: revision.sender_id, mfaVerified: true }; }
async function campaignSender(client: PoolClient, revision: CampaignRevisionRow) {
    const sender = await (storedCrmSender)(client, revision.sender_id);
    if (!sender)
        return null;
    const segment = (await client.query<SegmentRow>("SELECT active FROM crm_segments WHERE id=$1", [revision.segment_id])).rows[0];
    if (!segment?.active)
        return null;
    return sender;
}
async function eligibleAccount(client: PoolClient, revision: CampaignRevisionRow, recipientId: string, locale?: Locale) {
    const sender = await campaignSender(client, revision);
    if (!sender)
        return null;
    const account = (await (projectCrmRecipientAudience)(client, sender, [recipientId], frozenSender(sender, revision)))[0];
    if (!account || locale && account.locale !== locale || !revision.snapshot_id && !matchesSegment(revision.filter, account))
        return null;
    if (revision.audience !== "all" && account.subjectType !== (revision.audience === "contacts" ? "crm-contact" : "user"))
        return null;
    if (revision.snapshot_id && !(await client.query("SELECT 1 FROM crm_segment_snapshot_members WHERE snapshot_id=$1 AND recipient_id=$2", [revision.snapshot_id, recipientId])).rowCount)
        return null;
    return { sender, account };
}
async function campaignDeliveryPermitted(client: PoolClient, outboxId: string, channel: string, payload: Record<string,unknown>) {
    if (!enabled() || typeof payload.campaignDeliveryId !== "string")
        return false;
    const delivery = (await client.query<DeliveryRow>(`SELECT d.*,e.recipient_id,e.user_id,e.endpoint_refs FROM crm_campaign_deliveries d JOIN crm_campaign_enrollments e ON e.id=d.enrollment_id JOIN crm_campaigns c ON c.current_revision_id=d.revision_id WHERE d.id=$1 AND d.outbox_id=$2 AND c.status='running' AND c.enrollment_complete AND e.state='waiting' AND e.step_index=d.step_index`, [payload.campaignDeliveryId, outboxId])).rows[0];
    if (!delivery || delivery.channel !== channel || delivery.endpoint_hash !== (hash)(String(payload.to || "")))
        return false;
    if (delivery.user_id ? payload.userId !== delivery.user_id : payload.userId !== void 0 || payload.recipientId !== delivery.recipient_id)
        return false;
    const revision = (await client.query<CampaignRevisionRow>("SELECT * FROM crm_campaign_revisions WHERE id=$1", [delivery.revision_id])).rows[0];
    if (!revision)
        return false;
    const eligible = await eligibleAccount(client, revision, delivery.recipient_id, delivery.locale);
    if (!eligible)
        return false;
    const content = revision.draft.steps[delivery.step_index]?.content[eligible.account.locale];
    if (!content || payload.purpose !== "marketing" || payload.topic !== revision.draft.topic || payload.title !== content.title || payload.subject !== content.title || payload.body !== content.body || payload.text !== content.body || payload.href !== content.href)
        return false;
    const reference = delivery.endpoint_refs.find(ref => ref.channel === channel);
    if (channel === "sms" || channel === "telegram" || channel === "push") {
        if (!reference || !("bindingId" in reference) || JSON.stringify(canonical(reference)) !== JSON.stringify(canonical(payload.channelBinding)))
            return false;
        try {
            const current = await (resolveBoundDelivery)(client, delivery.recipient_id, reference, revision.draft.topic);
            if (current.to !== payload.to || current.recipient.userId !== (payload.userId || null) || current.recipient.contactId !== (payload.contactId || null))
                return false;
        }
        catch (error) {
            if (error instanceof HttpError && [403, 404, 409, 422].includes(error.status))
                return false;
            throw error;
        }
    }
    else if (!delivery.user_id) {
        if (!reference || !("endpointId" in reference) || JSON.stringify(canonical(reference)) !== JSON.stringify(canonical(payload.contactEndpoint)))
            return false;
        try {
            const current = await (resolveContactDelivery)(client, delivery.recipient_id, reference, revision.draft.topic);
            if (current.to !== payload.to || current.contactId !== payload.contactId)
                return false;
        }
        catch (error) {
            if (error instanceof HttpError && [403, 404, 409, 422].includes(error.status))
                return false;
            throw error;
        }
    }
    else if (reference && "userId" in reference && (reference.userId !== delivery.user_id || reference.valueHash !== delivery.endpoint_hash))
        return false;
    return !await (isRecipientCampaignSuppressed)(client, revision.sender_id, delivery.recipient_id, revision.draft.topic, delivery.channel);
}
async function stopCampaign(client: PoolClient, row: CampaignRow, code: string) {
    if (row.current_revision_id) {
        await cancelQueuedDeliveries(client, row.current_revision_id, code);
        await client.query<EnrollmentRow>("UPDATE crm_campaign_enrollments SET state='cancelled',stop_code=$2,next_at=NULL,updated_at=now() WHERE revision_id=$1 AND state IN ('pending','waiting')", [row.current_revision_id, code]);
    }
    await client.query<CampaignRow>("UPDATE crm_campaigns SET status='failed',stop_code=$2,version=version+1,updated_at=now() WHERE id=$1", [row.id, code]);
    await (audit)(null, "crm.campaign.stopped", "crm_campaign", row.id, { code }, client);
}
async function enrollBatch(client: PoolClient, row: CampaignRow, revision: CampaignRevisionRow, size: number, at: Date) {
    const sender = await campaignSender(client, revision);
    if (!sender) {
        await stopCampaign(client, row, "SENDER_OR_SEGMENT_REVOKED");
        return 0;
    }
    const ids = (await client.query(revision.snapshot_id ? "SELECT recipient_id AS id FROM crm_segment_snapshot_members WHERE snapshot_id=$1 AND recipient_id::text>$2 ORDER BY recipient_id LIMIT $3" : "SELECT r.id FROM communication_recipients r LEFT JOIN users u ON u.id=r.user_id WHERE r.active AND (CASE WHEN r.subject_type='user' THEN u.created_at ELSE r.created_at END)<=$1 AND r.id::text>$2 AND ($4='all' OR r.subject_type=CASE WHEN $4='contacts' THEN 'crm-contact' ELSE 'user' END) ORDER BY r.id LIMIT $3", revision.snapshot_id ? [revision.snapshot_id, row.enrollment_cursor, size + 1] : [revision.start_at, row.enrollment_cursor, size + 1, revision.audience])).rows;
    const batch = ids.slice(0, size);
    if (row.enrollment_scanned + batch.length > audienceLimit) {
        await stopCampaign(client, row, "AUDIENCE_REVIEW_LIMIT");
        return 0;
    }
    const accounts = (await (projectCrmRecipientAudience)(client, sender, batch.map(item => item.id), frozenSender(sender, revision))).filter(account => revision.snapshot_id || matchesSegment(revision.filter, account));
    for (const account of accounts) {
        const refs: CampaignEndpointRef[] = account.subjectType === "crm-contact" ? await (captureContactEndpoints)(client, account.recipientId, revision.draft.channels, revision.draft.topic) : revision.draft.channels.filter(channel => channel === "email" || channel === "in-app").map(channel => ({ channel, userId: account.userId!, valueHash: (hash)(channel === "email" ? account.email : account.userId!) }));
        refs.push(...await (captureBoundEndpoints)(client, account.recipientId, revision.draft.channels, revision.draft.topic));
        await client.query<EnrollmentRow>("INSERT INTO crm_campaign_enrollments(id,revision_id,recipient_id,user_id,locale,next_at,endpoint_refs) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(revision_id,recipient_id) DO NOTHING", [(randomUUID)(), revision.id, account.recipientId, account.userId || null, account.locale, at, JSON.stringify(refs)]);
    }
    await client.query<CampaignRow>("UPDATE crm_campaigns SET enrollment_cursor=$2,enrollment_scanned=enrollment_scanned+$3,enrollment_complete=$4,status='running',version=version+CASE WHEN status='scheduled' THEN 1 ELSE 0 END,updated_at=now() WHERE id=$1", [row.id, batch.at(-1)?.id || row.enrollment_cursor, batch.length, ids.length <= size]);
    return accounts.length;
}
async function terminateEnrollment(client: PoolClient, row: EnrollmentRow, state: EnrollmentRow['state'], code: string) { await cancelQueuedDeliveries(client, row.revision_id, code, row.id); await client.query<EnrollmentRow>("UPDATE crm_campaign_enrollments SET state=$2,stop_code=$3,next_at=NULL,updated_at=now() WHERE id=$1", [row.id, state, code]); }
async function processEnrollment(client: PoolClient, row: EnrollmentRow, revision: CampaignRevisionRow, at: Date) {
    const eligible = await eligibleAccount(client, revision, row.recipient_id, row.locale);
    if (!eligible) {
        await terminateEnrollment(client, row, "suppressed", "RECIPIENT_OR_SENDER_REVOKED");
        return;
    }
    if (row.state === "waiting") {
        const deliveries = (await client.query<DeliveryRow>(`SELECT o.state,o.completed_at FROM crm_campaign_deliveries d JOIN outbox o ON o.id=d.outbox_id WHERE d.enrollment_id=$1 AND d.step_index=$2`, [row.id, row.step_index])).rows;
        if (deliveries.some(item => item.state === "uncertain")) {
            await terminateEnrollment(client, row, "uncertain", "DELIVERY_UNCERTAIN");
            return;
        }
        if (deliveries.some(item => item.state === "failed")) {
            await terminateEnrollment(client, row, "failed", "DELIVERY_FAILED");
            return;
        }
        if (deliveries.some(item => ["pending", "running", "batched"].includes(item.state))) {
            await client.query<EnrollmentRow>("UPDATE crm_campaign_enrollments SET next_at=$2 WHERE id=$1", [row.id, new Date(at.getTime() + 3e4)]);
            return;
        }
        const accepted = deliveries.filter(item => item.state === "delivered" && item.completed_at);
        if (!accepted.length) {
            await terminateEnrollment(client, row, "suppressed", "NO_ACCEPTED_DELIVERY");
            return;
        }
        if (row.step_index + 1 >= revision.draft.steps.length) {
            await client.query<EnrollmentRow>("UPDATE crm_campaign_enrollments SET state='completed',next_at=NULL,updated_at=now() WHERE id=$1", [row.id]);
            return;
        }
        const nextAt = new Date(Math.max(...accepted.map(item => item.completed_at!.getTime())) + revision.draft.steps[row.step_index + 1].delayMinutes * 6e4);
        await client.query<EnrollmentRow>("UPDATE crm_campaign_enrollments SET state='pending',step_index=step_index+1,next_at=$2,updated_at=now() WHERE id=$1", [row.id, nextAt]);
        return;
    }
    const content = revision.draft.steps[row.step_index].content[row.locale];
    let queued = 0;
    for (const channel of revision.draft.channels) {
        if (await (isRecipientCampaignSuppressed)(client, revision.sender_id, row.recipient_id, revision.draft.topic, channel))
            continue;
        const reference = row.endpoint_refs.find(item => item.channel === channel), bound = reference && "bindingId" in reference ? reference : void 0, contact = reference && "endpointId" in reference ? reference : void 0, accountRef = reference && "userId" in reference ? reference : void 0;
        if ((channel === "sms" || channel === "telegram" || channel === "push") && !bound || !row.user_id && !bound && !contact)
            continue;
        let to;
        try {
            if (bound) {
                const resolved = await (resolveBoundDelivery)(client, row.recipient_id, bound, revision.draft.topic);
                (assert)(resolved.to, 409, "RECIPIENT_UNVERIFIED", "Verified destination unavailable.");
                to = resolved.to;
            }
            else if (row.user_id) {
                to = (await (resolveNotificationRecipient)(channel, { userId: row.user_id, topic: revision.draft.topic, purpose: "marketing" }, client)).to;
                if (accountRef && (hash)(to) !== accountRef.valueHash)
                    continue;
            }
            else
                to = (await (resolveContactDelivery)(client, row.recipient_id, contact!, revision.draft.topic)).to;
        }
        catch (error) {
            if (error instanceof HttpError && [403, 404, 409, 422].includes(error.status))
                continue;
            throw error;
        }
        const endpointHash = (hash)(to);
        if ((await client.query<DeliveryRow>("SELECT 1 FROM crm_campaign_deliveries WHERE revision_id=$1 AND step_index=$2 AND channel=$3 AND endpoint_hash=$4 AND locale=$5", [revision.id, row.step_index, channel, endpointHash, row.locale])).rowCount)
            continue;
        const deliveryId = (randomUUID)(), key = "campaign:" + revision.id + ":" + row.step_index + ":" + channel + ":" + row.locale + ":" + endpointHash;
        const outboxId = bound ? await (enqueueBoundNotification)(client, row.recipient_id, bound, { topic: revision.draft.topic, purpose: "marketing", title: content.title, body: content.body, href: content.href, campaignDeliveryId: deliveryId }, key) : row.user_id ? await (enqueueAccountNotification)(client, { userId: row.user_id, topic: revision.draft.topic, purpose: "marketing", channel: channel as "email"|"in-app", title: content.title, body: content.body, href: content.href, campaignDeliveryId: deliveryId }, key) : await (enqueueContactNotification)(client, { ...await (resolveContactDelivery)(client, row.recipient_id, contact!, revision.draft.topic), title: content.title, body: content.body, href: content.href, campaignDeliveryId: deliveryId }, key);
        (assert)(outboxId, 409, "CAMPAIGN_DELIVERY_CONFLICT", "A campaign delivery could not be attached atomically.");
        await client.query<DeliveryRow>("INSERT INTO crm_campaign_deliveries(id,enrollment_id,revision_id,step_index,channel,locale,endpoint_hash,outbox_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [deliveryId, row.id, revision.id, row.step_index, channel, row.locale, endpointHash, outboxId]);
        queued++;
    }
    if (queued)
        await client.query<EnrollmentRow>("UPDATE crm_campaign_enrollments SET state='waiting',next_at=$2,updated_at=now() WHERE id=$1", [row.id, new Date(at.getTime() + 3e4)]);
    else
        await terminateEnrollment(client, row, "suppressed", "NO_CONSENT_OR_SUPPRESSED_ENDPOINT");
}
async function runCrmCampaigns(limit = 100, at = new Date) {
    (assert)(Number.isInteger(limit) && limit >= 1 && limit <= 100, 422, "CAMPAIGN_BATCH", "Use a campaign batch size from one to one hundred.");
    if (!enabled())
        return { enabled: false, enrolled: 0, processed: 0 };
    let enrolled = 0, processed = 0;
    await (transaction)(async (client) => {
        const row = (await client.query<CampaignRow>("SELECT * FROM crm_campaigns WHERE status IN ('scheduled','running') AND start_at<=$1 AND NOT enrollment_complete ORDER BY start_at,id FOR UPDATE SKIP LOCKED LIMIT 1", [at])).rows[0];
        if (!row)
            return;
        const revision = await currentRevision(client, row);
        if (!revision) {
            await stopCampaign(client, row, "CAMPAIGN_REVISION_MISSING");
            return;
        }
        enrolled = await enrollBatch(client, row, revision, Math.min(1e3, limit * 10), at);
    });
    for (let index = 0; index < limit; index++) {
        const worked = await (transaction)(async (client) => {
            const campaign = (await client.query<CampaignRow>(`SELECT c.* FROM crm_campaigns c WHERE c.status='running' AND c.enrollment_complete AND EXISTS(SELECT 1 FROM crm_campaign_enrollments e WHERE e.revision_id=c.current_revision_id AND e.state IN ('pending','waiting') AND e.next_at<=$1) ORDER BY c.start_at,c.id FOR UPDATE OF c SKIP LOCKED LIMIT 1`, [at])).rows[0];
            if (!campaign)
                return false;
            const row = (await client.query<EnrollmentRow>("SELECT * FROM crm_campaign_enrollments WHERE revision_id=$1 AND state IN ('pending','waiting') AND next_at<=$2 ORDER BY next_at,id FOR UPDATE SKIP LOCKED LIMIT 1", [campaign.current_revision_id, at])).rows[0];
            if (!row)
                return false;
            const revision = await currentRevision(client, campaign);
            if (!revision) {
                await stopCampaign(client, campaign, "CAMPAIGN_REVISION_MISSING");
                return true;
            }
            await processEnrollment(client, row, revision, at);
            return true;
        });
        if (!worked)
            break;
        processed++;
    }
    await (transaction)(async (client) => {
        const rows = (await client.query<CampaignRow>(`SELECT c.* FROM crm_campaigns c WHERE c.status='running' AND c.enrollment_complete AND NOT EXISTS(SELECT 1 FROM crm_campaign_enrollments e WHERE e.revision_id=c.current_revision_id AND e.state IN ('pending','waiting')) ORDER BY c.start_at,c.id FOR UPDATE SKIP LOCKED LIMIT 20`)).rows;
        for (const row of rows) {
            const attention = !!(await client.query<EnrollmentRow>("SELECT 1 FROM crm_campaign_enrollments WHERE revision_id=$1 AND state IN ('failed','uncertain') LIMIT 1", [row.current_revision_id])).rowCount;
            await client.query<CampaignRow>("UPDATE crm_campaigns SET status=$2,stop_code=$3,version=version+1,updated_at=now() WHERE id=$1", [row.id, attention ? "failed" : "completed", attention ? "DELIVERY_REQUIRES_REVIEW" : null]);
            await (audit)(null, "crm.campaign.finished", "crm_campaign", row.id, { status: attention ? "failed" : "completed" }, client);
        }
    });
    return { enabled: true, enrolled, processed };
}
export { campaignCapabilities, campaignDeliveryPermitted, cancelCrmCampaign, createCrmCampaign, createCrmSegment, createCrmSuppression, getCrmCampaign, getCrmSegment, listCrmCampaigns, listCrmSegments, listCrmSuppressions, matchesSegment, parseCampaignDraft, parseSegmentFilter, previewCrmSegment, revokeCrmSuppression, runCrmCampaigns, scheduleCrmCampaign, searchCrmCampaignRecipients, snapshotCrmSegment, updateCrmCampaign, updateCrmSegment };
