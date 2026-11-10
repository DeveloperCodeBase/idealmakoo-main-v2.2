import type {PrivacySubject, PrivacyLedger, PrivacyHead, PrivacyEntry} from './privacy-ledger';
import type {WorkspaceRecord} from '../data/workspace-seed';
export interface PrivacyBlocker {code:string;description:string;count:number}
interface PrivacySubjectRow {subject_type:PrivacySubject['type'];subject_id:string}
interface PrivacyLedgerState {fingerprint:string|null;applied_sequence:string|number;applied_hash:string}
interface PrivacySubjectData {user?:{id:string;email:string;name:string;role:string;active:boolean}|null;contact?:WorkspaceRecord;needles:string[]}
interface PrivacyRequestRow extends PrivacySubjectRow {id:string;action:'erase'|'export';status:'requested'|'approved'|'blocked'|'rejected'|'completed';reason:string;version:number;requested_by:string;approved_by:string|null;decision_reason:string|null;created_at:Date;updated_at:Date;completed_at:Date|null;blockers:PrivacyBlocker[];result:Record<string,unknown>|null}
interface PrivacyHoldRow extends PrivacySubjectRow {id:string;reason:string;expires_at:Date;revoked_at:Date|null;release_reason:string|null;version:number;created_at:Date}
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { assert, HttpError } from "./types";
import { assertLedgerContains, EMPTY_LEDGER_HASH, privacySubjectSchema, readPrivacyLedger, initializePrivacyLedgerFiles, appendPrivacyErasure } from "./privacy-ledger";
import { loadCrmAccess, redactCrmRecord } from "./workspace-scopes";
import { readableRecord } from "./workspace-policy";
import { privacyDependencyBlockers, privacyCopiedTextBlockers } from "./privacy-dependencies";
import { decrypt } from "./crypto";
import { transaction, audit, query } from "./db";
import { parse, rateLimit } from "./http";
import { randomUUID } from "node:crypto";
const reasonSchema = z.string().trim().min(3).max(2e3).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Control characters are forbidden");
const subjectOf = (row: PrivacySubjectRow) : PrivacySubject => ({ type: row.subject_type, id: row.subject_id });
const manager = (actor: Actor) => actor.mfaVerified && ["admin", "superAdmin"].includes(actor.role);
const requireManager = (actor: Actor) => (assert)(manager(actor), 403, "PRIVACY_ADMIN", "Current administrator access with MFA is required.");
const quoteIdent = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const positiveVersion = (expected: number, actual: number) => (assert)(Number.isSafeInteger(expected) && expected === actual, 409, "CONFLICT", "This privacy record changed. Refresh and review it again.");
const hasNeedle = (value: unknown, needles: string[]) => { const serialized = (typeof value === "string" ? value : JSON.stringify(value) || "").toLowerCase(); return needles.some(needle => serialized.includes(needle)); };
async function lockPrivacy(client: PoolClient) { await client.query("SELECT pg_advisory_xact_lock(72019012)"); await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE"); }
async function stateFor(client: PoolClient, lock = false) : Promise<PrivacyLedgerState> { const row = (await client.query("SELECT fingerprint,applied_sequence,applied_hash FROM privacy_ledger_state WHERE singleton=true" + (lock ? " FOR UPDATE" : ""))).rows[0]; (assert)(row, 503, "PRIVACY_MIGRATION", "The privacy migration is missing."); return row; }
function validateState(ledger: PrivacyLedger, state: PrivacyLedgerState) {
    if (state.fingerprint)
        (assertLedgerContains)(ledger, { format: 1, fingerprint: state.fingerprint, sequence: Number(state.applied_sequence), hash: state.applied_hash });
    else
        (assert)(Number(state.applied_sequence) === 0 && state.applied_hash === EMPTY_LEDGER_HASH, 503, "PRIVACY_LEDGER_STATE", "The database erasure state is inconsistent.");
}
async function subjectData(client: PoolClient, subject: PrivacySubject, lock = false) : Promise<PrivacySubjectData> {
    if (subject.type === "user") {
        const user = (await client.query("SELECT id,email,name,role,active,phone_number FROM users WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [subject.id])).rows[0];
        const profile2 = user ? (await client.query("SELECT profile FROM user_settings WHERE user_id=$1", [subject.id])).rows[0]?.profile : {};
        return { user, needles: [user?.email, user?.name,user?.phone_number, profile2?.phone, profile2?.contactEmail, profile2?.address].filter(value => typeof value === "string" && value.length >= 3).map(value => value.toLowerCase()) };
    }
    const contact = (await client.query("SELECT data FROM workspace_entities WHERE bucket='records' AND collection='contacts' AND id=$1" + (lock ? " FOR UPDATE" : ""), [subject.id])).rows[0]?.data;
    const profile = contact ? (await client.query("SELECT given_name,family_name,display_name FROM crm_contact_profiles WHERE record_id=$1", [subject.id])).rows[0] : void 0;
    const endpoints = contact ? (await client.query("SELECT value FROM crm_contact_endpoints WHERE contact_id=$1 LIMIT 1000", [subject.id])).rows : [];
    return { contact, needles: [contact?.email, contact?.details?.phone, ...Object.values(contact?.title || {}), ...Object.values(contact?.summary || {}), ...Object.values(profile || {}), ...endpoints.map(endpoint => endpoint.value)].filter(value => typeof value === "string" && value.length >= 3).map(value => value.toLowerCase()) };
}
async function authorizeSubject(client: PoolClient, actor: Actor, subject: PrivacySubject, allowMissing = false) {
    actor = await (loadCrmAccess)(actor, client);
    const data = await subjectData(client, subject);
    if (subject.type === "user")
        (assert)((actor.id === subject.id || manager(actor)) && (!!data.user || allowMissing && manager(actor)), 404, "NOT_FOUND", "Privacy subject not found.");
    else
        (assert)(actor.role !== "customer" && actor.mfaVerified && (!!data.contact && (readableRecord)(actor, data.contact) && actor.crmAccess?.permissions.contact || allowMissing && manager(actor)), 404, "NOT_FOUND", "Privacy subject not found.");
    return { actor, data };
}
function safeReason(reason: string, data: Pick<PrivacySubjectData, "needles">) { (assert)(!hasNeedle(reason, data.needles), 422, "PRIVACY_REASON", "Use a purpose or case reference without copying the subject\u2019s name, email, phone or private text into the privacy record."); }
function requestDto(row: PrivacyRequestRow, actor: Actor) { return { id: row.id, subject: subjectOf(row), action: row.action, status: row.status, reason: row.reason, version: row.version, requestedBy: row.requested_by, approvedBy: row.approved_by, decisionReason: row.decision_reason, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), completedAt: row.completed_at?.toISOString() || null, blockers: row.blockers, result: row.result, capabilities: { approve: manager(actor) && actor.id !== row.requested_by && row.action === "erase" && !row.approved_by && ["requested", "blocked"].includes(row.status), execute: manager(actor) && row.action === "erase" && !!row.approved_by && ["approved", "blocked"].includes(row.status) && !!process.env.PRIVACY_LEDGER_DIR, export: row.action === "export" && row.status !== "rejected" } }; }
const holdDto = (row: PrivacyHoldRow) => ({ id: row.id, subject: subjectOf(row), reason: row.reason, expiresAt: row.expires_at.toISOString(), revokedAt: row.revoked_at?.toISOString() || null, releaseReason: row.release_reason, version: row.version, active: !row.revoked_at && row.expires_at.getTime() > Date.now(), createdAt: row.created_at.toISOString() });
async function requestFor(client: PoolClient, actor: Actor, id: string, lock = false) { (assert)(z.string().uuid().safeParse(id).success, 404, "NOT_FOUND", "Privacy request not found."); const row = (await client.query("SELECT * FROM privacy_requests WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Privacy request not found."); const permitted = await authorizeSubject(client, actor, subjectOf(row), row.status === "completed"); return { row, actor: permitted.actor, data: permitted.data }; }
async function assessPrivacyErasure(client: PoolClient, subject: PrivacySubject) : Promise<PrivacyBlocker[]> {
    const data = await subjectData(client, subject, true);
    if (!data.user && !data.contact)
        return [];
    const blockers: PrivacyBlocker[] = [];
    const count = async (code: string, description: string, sql: string, args: unknown[]) => {
        const result = await client.query(sql, args);
        const value = Number(result.rows[0]?.count || 0);
        if (value)
            blockers.push({ code, description, count: value });
    };
    await count("LEGAL_HOLD", "An active retention hold blocks erasure. Release or let it expire through its audited workflow.", "SELECT count(*) FROM privacy_holds WHERE subject_type=$1 AND subject_id=$2 AND revoked_at IS NULL AND expires_at>now()", [subject.type, subject.id]);
    if (data.user && data.user.role !== "customer")
        blockers.push({ code: "STAFF_IDENTITY", description: "Staff identities carry operational accountability. This automatic erasure path is restricted to customer accounts.", count: 1 });
    blockers.push(...await (privacyDependencyBlockers)(client, subject));
    const identifiers = [subject.id.toLowerCase(), ...data.needles], personal = data.needles;
    const textMatch = (expression: string, index = 1) => `EXISTS(SELECT 1 FROM unnest($${index}::text[]) needle WHERE position(needle IN lower(${expression}))>0)`;
    await count("RELATED_WORKSPACE", "Other workspace records contain a subject reference or copied personal content; review their relationships before erasure.", `SELECT count(*) FROM workspace_entities WHERE NOT(bucket='records' AND id=$2 AND $3='crm-contact') AND ${textMatch("data::text")}`, [identifiers, subject.id, subject.type]);
    await count("RELATED_REQUESTS", "Customer requests and their processing/financial history require an explicit retention disposition.", `SELECT count(*) FROM requests WHERE owner_id=$2 OR ${textMatch("data::text")}`, [identifiers, subject.id]);
    await count("IMMUTABLE_QUOTES", "Issued commercial snapshots cannot be rewritten by the privacy workflow.", `SELECT count(*) FROM quote_snapshots WHERE record_id=$2 OR ${textMatch("snapshot::text")}`, [identifiers, subject.id]);
    await count("IMMUTABLE_REVISIONS", "Published/reviewed source revisions retain subject content and cannot be silently changed.", `SELECT count(*) FROM content_revisions WHERE document_id=$2 OR created_by=$2 OR ${textMatch("snapshot::text")}`, [identifiers, subject.id]);
    await count("MERGE_HISTORY", "Merge history still holds subject snapshots and requires an explicit disposition.", `SELECT count(*) FROM crm_merge_operations WHERE target_id=$2 OR source_id=$2 OR ${textMatch("snapshot::text")}`, [identifiers, subject.id]);
    await count("IMMUTABLE_AUDIT_PERSONAL_DATA", "Append-only audit details contain copied personal values. A separate retention decision is required.", `SELECT count(*) FROM (SELECT details::text AS value FROM audit_events UNION ALL SELECT activity::text||details::text FROM workspace_audit UNION ALL SELECT facts::text FROM crm_automation_events) evidence WHERE ${textMatch("value")}`, [personal]);
    await count("REPLAY_RESPONSE", "An idempotent response still contains subject data; its retention must be resolved first.", `SELECT count(*) FROM idempotency_keys WHERE ${textMatch("response::text")}`, [identifiers]);
    await count("SHARED_PERSONAL_DATA", "Another account\u2019s saved portal/profile contains copied subject data; automatic deletion would alter a different account.", `SELECT count(*) FROM user_settings WHERE user_id<>$2 AND ${textMatch("profile::text||portal::text||collection::text")}`, [identifiers, subject.id]);
    await count("INVITATION_HISTORY", "Organization invitation history references the subject.", `SELECT count(*) FROM organization_invitations WHERE ${textMatch("email")}`, [data.user ? [data.user.email] : personal]);
    await count("RETAINED_ASSET", "Stored media or metadata references the subject. Shared and immutable assets are not removed by this path.", `SELECT count(*) FROM assets WHERE owner_id=$2 OR ${textMatch("name||metadata::text")}`, [personal, subject.id]);
    await count("AI_CONTENT", "Stored AI input/output references the subject and requires explicit retention disposition.", `SELECT count(*) FROM ai_jobs WHERE actor_id=$2 OR ${textMatch("input::text||coalesce(output::text,'')")}`, [identifiers, subject.id]);
    const jobs = (await client.query("SELECT payload,account_id FROM outbox ORDER BY created_at,id LIMIT 10001")).rows;
    if (jobs.length > 1e4)
        blockers.push({ code: "OUTBOX_REVIEW_LIMIT", description: "The encrypted outbox exceeds the bounded online review. Use a separately reviewed retention operation before erasure.", count: jobs.length });
    else {
        let matching = 0, unreadable = 0;
        for (const job of jobs) {
            try {
                const payload = typeof job.payload.encrypted === "string" ? JSON.parse((decrypt)(job.payload.encrypted)) : job.payload;
                if (job.account_id === subject.id || hasNeedle(payload, identifiers))
                    matching++;
            }
            catch {
                unreadable++;
            }
        }
        if (matching)
            blockers.push({ code: "RETAINED_OUTBOX", description: "Queued or historical encrypted deliveries contain subject data. Resolve their retention and possible provider acceptance before erasure.", count: matching });
        if (unreadable)
            blockers.push({ code: "OUTBOX_UNREADABLE", description: "Encrypted delivery data cannot be verified with the current key; erasure cannot safely prove its scope.", count: unreadable });
    }
    for (const table of ["crm_inbox_items", "crm_transfer_rows"]) {
        const rows = (await client.query("SELECT payload FROM " + quoteIdent(table) + " LIMIT 10001")).rows;
        if (rows.length > 1e4) {
            blockers.push({ code: table.toUpperCase() + "_REVIEW_LIMIT", description: "This encrypted CRM evidence exceeds the bounded online review. An operator-reviewed retention operation is required.", count: rows.length });
            continue;
        }
        let matching = 0, unreadable = 0;
        for (const row of rows) {
            try {
                const payload = typeof row.payload.encrypted === "string" ? JSON.parse((decrypt)(row.payload.encrypted)) : row.payload;
                if (hasNeedle(payload, identifiers))
                    matching++;
            }
            catch {
                unreadable++;
            }
        }
        if (matching)
            blockers.push({ code: "RETAINED_" + table.toUpperCase(), description: "Encrypted " + table + " evidence contains subject data. Resolve its retained copies before erasure.", count: matching });
        if (unreadable)
            blockers.push({ code: table.toUpperCase() + "_UNREADABLE", description: "Encrypted " + table + " evidence cannot be inspected with the current key; erasure fails closed.", count: unreadable });
    }
    blockers.push(...await (privacyCopiedTextBlockers)(client, subject, data.needles));
    return blockers;
}
async function listPrivacyRequests(actor: Actor) {
    actor = await (loadCrmAccess)(actor);
    if (actor.role !== "customer")
        (assert)(actor.mfaVerified, 403, "MFA_REQUIRED", "Complete MFA first.");
    return (transaction)(async (client) => {
        const rows = (await client.query("SELECT * FROM privacy_requests" + (manager(actor) ? "" : actor.role === "customer" ? " WHERE subject_type='user' AND subject_id=$1" : " WHERE requested_by=$1") + " ORDER BY created_at DESC,id LIMIT 200", manager(actor) ? [] : [actor.id])).rows, items = [];
        for (const row of rows) {
            try {
                await authorizeSubject(client, actor, subjectOf(row), row.status === "completed");
                items.push(requestDto(row, actor));
            }
            catch (error) {
                if (!(error instanceof HttpError && error.status === 404))
                    throw error;
            }
        }
        return { items, capabilities: { manageHolds: manager(actor), selectSubject: manager(actor) || actor.role !== "customer", ledgerConfigured: !!process.env.PRIVACY_LEDGER_DIR } };
    });
}
async function getPrivacyRequest(actor: Actor, id: string) { return (transaction)(async (client) => { const item = await requestFor(client, actor, id); return requestDto(item.row, item.actor); }); }
async function createPrivacyRequest(actor: Actor, body: unknown) {
    const input = (parse)(z.object({ subject: privacySubjectSchema, action: z.enum(["export", "erase"]), reason: reasonSchema }).strict(), body);
    await (rateLimit)("privacy-create:" + actor.id, 12, 3600);
    return (transaction)(async (client) => {
        await lockPrivacy(client);
        const current = await authorizeSubject(client, actor, input.subject);
        safeReason(input.reason, current.data);
        const duplicate = await client.query<PrivacyRequestRow>("SELECT * FROM privacy_requests WHERE subject_type=$1 AND subject_id=$2 AND action=$3 AND requested_by=$4 AND status IN ('requested','approved','blocked') ORDER BY created_at DESC LIMIT 1", [input.subject.type, input.subject.id, input.action, current.actor.id]);
        if (duplicate.rows[0])
            return requestDto(duplicate.rows[0], current.actor);
        const row = (await client.query<PrivacyRequestRow>("INSERT INTO privacy_requests(id,subject_type,subject_id,action,reason,requested_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [(randomUUID)(), input.subject.type, input.subject.id, input.action, input.reason, current.actor.id])).rows[0];
        await (audit)(current.actor.id, "privacy.request.created", "privacy_request", row.id, { action: input.action, subjectType: input.subject.type }, client);
        return requestDto(row, current.actor);
    });
}
async function decidePrivacyRequest(actor: Actor, id: string, body: unknown, expected: number) { const input = (parse)(z.object({ decision: z.enum(["approved", "rejected"]), reason: reasonSchema }).strict(), body); return (transaction)(async (client) => { await lockPrivacy(client); const current = await requestFor(client, actor, id, true), row = current.row; requireManager(current.actor); positiveVersion(expected, row.version); (assert)(row.action === "erase" && row.requested_by !== actor.id && !row.approved_by && ["requested", "blocked"].includes(row.status), 409, "INDEPENDENT_APPROVAL", "A different current administrator must approve an undecided erasure request."); safeReason(input.reason, current.data); const blockers = input.decision === "approved" ? await assessPrivacyErasure(client, subjectOf(row)) : []; const updated = (await client.query<PrivacyRequestRow>("UPDATE privacy_requests SET status=$2,approved_by=$3,decision_reason=$4,blockers=$5::jsonb,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, input.decision === "approved" ? blockers.length ? "blocked" : "approved" : "rejected", input.decision === "approved" ? actor.id : null, input.reason, JSON.stringify(blockers)])).rows[0]; await (audit)(actor.id, "privacy.request." + input.decision, "privacy_request", id, { blockerCodes: blockers.map(item => item.code) }, client); return requestDto(updated, current.actor); }); }
async function listPrivacyHolds(actor: Actor) { actor = await (loadCrmAccess)(actor); requireManager(actor); return { items: (await (query)<PrivacyHoldRow>("SELECT * FROM privacy_holds ORDER BY created_at DESC,id LIMIT 500")).rows.map(holdDto) }; }
function futureHold(value: string) { (assert)(Date.parse(value) > Date.now() && Date.parse(value) <= Date.now() + 10 * 366 * 864e5, 422, "HOLD_EXPIRY", "A hold must expire in the future, within ten years; review it before extending."); }
async function createPrivacyHold(actor: Actor, body: unknown) { const input = (parse)(z.object({ subject: privacySubjectSchema, reason: reasonSchema, expiresAt: z.string().datetime({ offset: true }) }).strict(), body); futureHold(input.expiresAt); return (transaction)(async (client) => { await lockPrivacy(client); const current = await authorizeSubject(client, actor, input.subject); requireManager(current.actor); safeReason(input.reason, current.data); const row = (await client.query<PrivacyHoldRow>("INSERT INTO privacy_holds(id,subject_type,subject_id,reason,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [(randomUUID)(), input.subject.type, input.subject.id, input.reason, input.expiresAt, current.actor.id])).rows[0]; await (audit)(actor.id, "privacy.hold.created", "privacy_hold", row.id, { subjectType: input.subject.type, expiresAt: input.expiresAt }, client); return holdDto(row); }); }
async function updatePrivacyHold(actor: Actor, id: string, body: unknown, expected: number, revoke = false) {
    (assert)(z.string().uuid().safeParse(id).success, 404, "NOT_FOUND", "Retention hold not found.");
    const input = (parse)(z.object({ reason: reasonSchema, expiresAt: z.string().datetime({ offset: true }).optional() }).strict(), body);
    if (!revoke) {
        (assert)(input.expiresAt, 422, "HOLD_EXPIRY", "Supply the hold expiry.");
        futureHold(input.expiresAt);
    }
    return (transaction)(async (client) => { await lockPrivacy(client); actor = await (loadCrmAccess)(actor, client); requireManager(actor); const row = (await client.query<PrivacyHoldRow>("SELECT * FROM privacy_holds WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Retention hold not found."); positiveVersion(expected, row.version); (assert)(!row.revoked_at, 409, "HOLD_REVOKED", "A revoked hold cannot be changed; create a new hold."); safeReason(input.reason, await subjectData(client, subjectOf(row))); const updated = (await client.query(revoke ? "UPDATE privacy_holds SET revoked_at=now(),revoked_by=$2,release_reason=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *" : "UPDATE privacy_holds SET reason=$3,expires_at=$4,version=version+1,updated_at=now() WHERE id=$1 AND $2::text IS NOT NULL RETURNING *", revoke ? [id, actor.id, input.reason] : [id, actor.id, input.reason, input.expiresAt])).rows[0]; await (audit)(actor.id, revoke ? "privacy.hold.released" : "privacy.hold.updated", "privacy_hold", id, { expiresAt: updated.expires_at.toISOString() }, client); return holdDto(updated); });
}
async function applyErasure(client: PoolClient, entry: PrivacyEntry) {
    const existing = (await client.query("SELECT ledger_hash FROM privacy_tombstones WHERE subject_type=$1 AND subject_id=$2", [entry.subject.type, entry.subject.id])).rows[0];
    (assert)(!existing || existing.ledger_hash === entry.hash, 503, "PRIVACY_TOMBSTONE_CONFLICT", "The restored subject conflicts with the external tombstone.");
    const blockers = await assessPrivacyErasure(client, entry.subject);
    if (blockers.length)
        throw new HttpError(409, "PRIVACY_ERASURE_BLOCKED", "The subject still has retained dependencies; writers must remain stopped until a reviewed disposition is completed.", blockers.map(item => ({ path: item.code, message: item.description + " (" + item.count + ")" })));
    await client.query("INSERT INTO privacy_tombstones(subject_type,subject_id,request_id,ledger_sequence,ledger_hash,erased_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(subject_type,subject_id) DO NOTHING", [entry.subject.type, entry.subject.id, entry.requestId, entry.sequence, entry.hash, entry.at]);
    if (entry.subject.type === "user") {
        for (const table of ["notifications", "notification_preferences", "consent_events"])
            await client.query("DELETE FROM " + quoteIdent(table) + " WHERE user_id=$1", [entry.subject.id]);
        await client.query("DELETE FROM users WHERE id=$1", [entry.subject.id]);
    }
    else {
        await client.query("DELETE FROM workspace_entities WHERE bucket='records' AND collection='contacts' AND id=$1", [entry.subject.id]);
        await client.query("UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton=true");
    }
    const result = { method: "physical-structured-subject-deletion", ledgerSequence: entry.sequence, ledgerHash: entry.hash, erasedAt: entry.at, retainedMetadata: ["Pseudonymous audit identifiers and hashes", "Privacy purpose/decision references", "Signed anti-resurrection tombstone"], scope: entry.subject.type === "user" ? "Customer identity, owned settings, sessions, challenges, inbox, notification preferences, recipient identity, standalone consent rows, personal wishlists, their items and share links" : "The isolated CRM contact record, normalized profile, recipient identity, current endpoints and endpoint challenges" };
    await client.query("UPDATE privacy_requests SET status='completed',blockers='[]'::jsonb,result=$3::jsonb,version=version+1,updated_at=now(),completed_at=coalesce(completed_at,$4) WHERE subject_type=$1 AND subject_id=$2 AND action='erase' AND status<>'completed'", [entry.subject.type, entry.subject.id, JSON.stringify(result), entry.at]);
    await client.query("UPDATE privacy_ledger_state SET fingerprint=$1,applied_sequence=$2,applied_hash=$3,updated_at=now() WHERE singleton=true", [null, entry.sequence, entry.hash]);
    return result;
}
async function initializePrivacyLedger(adoptExisting = false) {
    return (transaction)(async (client) => {
        await lockPrivacy(client);
        const state = await stateFor(client, true);
        let ledger;
        if (state.fingerprint) {
            ledger = await (readPrivacyLedger)();
            validateState(ledger, state);
            return ledger.head;
        }
        (assert)(Number(state.applied_sequence) === 0 && !(await client.query("SELECT 1 FROM privacy_tombstones LIMIT 1")).rowCount, 503, "PRIVACY_LEDGER_RECOVERY", "A missing identity cannot be replaced after an erasure.");
        (assert)(adoptExisting || !(await client.query("SELECT 1 FROM users LIMIT 1")).rowCount, 409, "PRIVACY_INITIALIZATION_REVIEW", "Existing account data needs the explicit --adopt-existing initialization after its independent backup has been reviewed.");
        ledger = await (initializePrivacyLedgerFiles)();
        (assert)(ledger.head.sequence === 0 || adoptExisting, 503, "PRIVACY_LEDGER_RECOVERY", "A nonempty ledger requires recovery replay, not new installation.");
        await client.query("UPDATE privacy_ledger_state SET fingerprint=$1 WHERE singleton=true", [ledger.head.fingerprint]);
        return ledger.head;
    });
}
async function reconcilePrivacyLedger(anchor?: PrivacyHead) {
    return (transaction)(async (client) => {
        await lockPrivacy(client);
        const ledger = await (readPrivacyLedger)(), state = await stateFor(client, true);
        validateState(ledger, state);
        if (anchor)
            (assertLedgerContains)(ledger, anchor);
        for (const entry of ledger.entries)
            await applyErasure(client, entry);
        await client.query("UPDATE privacy_ledger_state SET fingerprint=$1,applied_sequence=$2,applied_hash=$3,updated_at=now() WHERE singleton=true", [ledger.head.fingerprint, ledger.head.sequence, ledger.head.hash]);
        return { ...ledger.head, replayed: ledger.entries.length };
    });
}
async function privacyLedgerStatus() { const ledger = await (readPrivacyLedger)(); return (transaction)(async (client) => { const state = await stateFor(client); validateState(ledger, state); const revived = await client.query("SELECT t.subject_type FROM privacy_tombstones t JOIN users u ON t.subject_type='user' AND u.id=t.subject_id UNION ALL SELECT t.subject_type FROM privacy_tombstones t JOIN workspace_entities e ON t.subject_type='crm-contact' AND e.bucket='records' AND e.id=t.subject_id LIMIT 1"); return { ...ledger.head, appliedSequence: Number(state.applied_sequence), ready: state.fingerprint === ledger.head.fingerprint && Number(state.applied_sequence) === ledger.head.sequence && state.applied_hash === ledger.head.hash && !revived.rowCount }; }); }
async function assertPrivacyReady() {
    if (!process.env.PRIVACY_LEDGER_DIR && process.env.NODE_ENV !== "production")
        return;
    const status = await privacyLedgerStatus();
    (assert)(status.ready, 503, "PRIVACY_RECONCILIATION_REQUIRED", "The current external erasure ledger must be reconciled before application data is served.");
}
async function executePrivacyErasure(actor: Actor, id: string, body: unknown, expected: number) {
    const input = (parse)(z.object({ confirmSubjectId: z.string().min(1).max(160) }).strict(), body);
    await (rateLimit)("privacy-erase:" + actor.id, 10, 3600);
    return (transaction)(async (client) => {
        await lockPrivacy(client);
        const current = await requestFor(client, actor, id, true), row = current.row;
        requireManager(current.actor);
        (assert)(input.confirmSubjectId === row.subject_id, 422, "PRIVACY_CONFIRMATION", "Enter the exact subject identifier to confirm erasure.");
        if (row.status === "completed") {
            (assert)(row.action === "erase", 409, "PRIVACY_ACTION", "This is not an erasure request.");
            return requestDto(row, current.actor);
        }
        positiveVersion(expected, row.version);
        (assert)(row.action === "erase" && row.approved_by && ["approved", "blocked"].includes(row.status), 409, "PRIVACY_APPROVAL_REQUIRED", "Independent approval is required before erasure.");
        const approver = (await client.query("SELECT role,active,mfa_enabled FROM users WHERE id=$1 FOR SHARE", [row.approved_by])).rows[0];
        (assert)(approver?.active && approver.mfa_enabled && ["admin", "superAdmin"].includes(approver.role), 409, "PRIVACY_APPROVAL_REVOKED", "The approving administrator no longer has the required active access.");
        const ledger = await (readPrivacyLedger)(), state = await stateFor(client, true);
        validateState(ledger, state);
        (assert)(state.fingerprint === ledger.head.fingerprint && Number(state.applied_sequence) === ledger.head.sequence, 503, "PRIVACY_RECONCILIATION_REQUIRED", "Replay outstanding external tombstones before executing another erasure.");
        const blockers = await assessPrivacyErasure(client, subjectOf(row));
        if (blockers.length) {
            const blocked = (await client.query<PrivacyRequestRow>("UPDATE privacy_requests SET status='blocked',blockers=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, JSON.stringify(blockers)])).rows[0];
            await (audit)(actor.id, "privacy.erasure.blocked", "privacy_request", id, { blockerCodes: blockers.map(item => item.code) }, client);
            return requestDto(blocked, current.actor);
        }
        const entry = await (appendPrivacyErasure)(ledger, { subject: subjectOf(row), requestId: id, actorId: actor.id, approverId: row.approved_by });
        await applyErasure(client, entry);
        await client.query("UPDATE privacy_ledger_state SET fingerprint=$1 WHERE singleton=true", [ledger.head.fingerprint]);
        await (audit)(actor.id, "privacy.erasure.completed", "privacy_request", id, { ledgerSequence: entry.sequence, scope: entry.scope }, client);
        return requestDto((await client.query<PrivacyRequestRow>("SELECT * FROM privacy_requests WHERE id=$1", [id])).rows[0], current.actor);
    });
}
async function exportPrivacyRequest(actor: Actor, id: string) {
    await (rateLimit)("privacy-export:" + actor.id, 10, 3600);
    const serialized = await (transaction)(async (client) => {
        const current = await requestFor(client, actor, id, true);
        (assert)(current.row.action === "export" && current.row.status !== "rejected", 409, "PRIVACY_EXPORT", "Create an export request for this subject first.");
        const subject = subjectOf(current.row);
        async function bounded(sql: string) { const rows = (await client.query(sql + " LIMIT 5001", [subject.id])).rows; (assert)(rows.length <= 5e3, 409, "PRIVACY_EXPORT_LIMIT", "This account requires an operator-reviewed large export."); return rows; }
        let result: Record<string,unknown>;
        if (subject.type === "user") {
            const user = (await client.query('SELECT id,email,name,role,active,email_verified AS "emailVerified",created_at AS "createdAt",updated_at AS "updatedAt" FROM users WHERE id=$1', [subject.id])).rows[0];
            (assert)(user, 404, "NOT_FOUND", "Account not found.");
            const requests = await bounded("SELECT * FROM requests WHERE owner_id=$1 ORDER BY created_at,id");
            const { requestDto: publicRequestDto } = await import("./requests");
            // The export subject is an independently authorized owner projection,
            // not another identity attached to the requesting administrator's session.
            const owner: Actor = { id: subject.id, role: "customer", name: user.name, email: user.email, qualityScope: false, allowedLocales: [], mfaVerified: false };
            const requestData = [];
            for (const request of requests)
                requestData.push(await publicRequestDto(request, owner, client));
            const settings = (await client.query('SELECT profile,preferences,collection,portal,updated_at AS "updatedAt" FROM user_settings WHERE user_id=$1', [subject.id])).rows[0] || {};
            result = { scope: "Structured account data, owned request DTOs and the listed account activity metadata. Asset bytes and AI content are accessed through their separately authorized endpoints. Hidden staff discussions, unrelated organizational records, credentials and provider secrets are excluded.", account: user, settings, requests: requestData, inquiryMerges: await bounded('SELECT id,summary,created_at AS "createdAt" FROM inquiry_merge_receipts WHERE user_id=$1 ORDER BY created_at,id'), wishlists: await bounded('SELECT id,name,description,purpose,is_default AS "isDefault",version,created_at AS "createdAt",updated_at AS "updatedAt" FROM wishlists WHERE user_id=$1 ORDER BY created_at,id'), wishlistItems: await bounded('SELECT i.id,i.wishlist_id AS "wishlistId",i.reference,i.note,i.position,i.created_at AS "createdAt" FROM wishlist_items i JOIN wishlists w ON w.id=i.wishlist_id WHERE w.user_id=$1 ORDER BY w.created_at,w.id,i.position,i.id'), wishlistShares: await bounded('SELECT s.id,s.wishlist_id AS "wishlistId",s.title,s.locale,s.source_version AS "sourceVersion",s.item_references AS "references",s.expires_at AS "expiresAt",s.created_at AS "createdAt",s.revoked_at AS "revokedAt",s.version FROM wishlist_shares s JOIN wishlists w ON w.id=s.wishlist_id WHERE w.user_id=$1 ORDER BY s.created_at,s.id'), notifications: await bounded('SELECT title,body,href,read_at AS "readAt",created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at,id'), consents: await bounded('SELECT purpose,accepted,policy_version AS "policyVersion",created_at AS "createdAt" FROM consent_events WHERE user_id=$1 ORDER BY created_at,id'), notificationPreferences: (await client.query("SELECT preferences,version FROM notification_preferences WHERE user_id=$1", [subject.id])).rows[0] || null, sessions: await bounded('SELECT user_agent AS "userAgent",created_at AS "createdAt",last_seen_at AS "lastSeenAt",expires_at AS "expiresAt",revoked_at AS "revokedAt" FROM sessions WHERE user_id=$1 ORDER BY created_at,id'), assets: await bounded('SELECT id,request_id AS "requestId",name,mime_type AS "mimeType",bytes,visibility,scan_status AS "scanStatus",created_at AS "createdAt",deleted_at AS "deletedAt" FROM assets WHERE owner_id=$1 ORDER BY created_at,id'), aiJobs: await bounded('SELECT id,mode,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM ai_jobs WHERE actor_id=$1 ORDER BY created_at,id'), organizationMemberships: await bounded('SELECT organization_id AS "organizationId",role,active,joined_at AS "joinedAt",revoked_at AS "revokedAt" FROM organization_memberships WHERE user_id=$1 ORDER BY joined_at,organization_id'), eventRegistrations: await bounded('SELECT id,session_id AS "sessionId",request_id AS "requestId",seats,locale,status,created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt" FROM event_registrations WHERE user_id=$1 ORDER BY created_at,id'), surveys: await bounded('SELECT i.kind,i.locale,i.question,i.created_at AS "createdAt",i.expires_at AS "expiresAt",i.revoked_at AS "revokedAt",r.score,r.comment,r.submitted_at AS "submittedAt" FROM crm_survey_invitations i LEFT JOIN crm_survey_responses r ON r.invitation_id=i.id WHERE i.user_id=$1 ORDER BY i.created_at,i.id'), accessGrants: await bounded('SELECT resource_id AS "resourceId",room_id AS "roomId",can_view AS "canView",can_download AS "canDownload",expires_at AS "expiresAt",created_at AS "createdAt",revoked_at AS "revokedAt" FROM access_grants WHERE user_id=$1 ORDER BY created_at,id') };
        }
        else {
            (assert)(current.data.contact, 404, "NOT_FOUND", "CRM contact not found.");
            result = { contact: (redactCrmRecord)(current.actor, current.data.contact), profile: (await client.query('SELECT given_name AS "givenName",family_name AS "familyName",display_name AS "displayName",locale,version,updated_at AS "updatedAt" FROM crm_contact_profiles WHERE record_id=$1', [subject.id])).rows[0] || null, endpoints: await bounded('SELECT id,channel,value,label,active,version,verified_at AS "verifiedAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM crm_contact_endpoints WHERE contact_id=$1 ORDER BY created_at,id'), endpointConsents: await bounded('SELECT c.topic,c.accepted,c.source,c.policy_version AS "policyVersion",c.recorded_at AS "recordedAt" FROM crm_endpoint_consent_events c JOIN crm_contact_endpoints e ON e.id=c.endpoint_id WHERE e.contact_id=$1 ORDER BY c.id'), scope: "Current structured CRM contact, normalized profile, endpoints and recorded consent. Affiliation/commercial counterpart records remain subject to their separate current access rules; credentials and challenge tokens are excluded." };
        }
        const ownRecipient = subject.type === "user" ? "r.subject_type='user' AND r.user_id=$1" : "r.subject_type='crm-contact' AND r.contact_id=$1";
        result.communication = { channels: await bounded('SELECT b.id,b.channel,b.provider,b.endpoint_version AS "endpointVersion",b.source_endpoint_id AS "sourceEndpointId",b.active,b.verified_at AS "verifiedAt",b.version,b.preferences,b.created_at AS "createdAt",b.updated_at AS "updatedAt" FROM communication_bindings b JOIN communication_recipients r ON r.id=b.recipient_id WHERE ' + ownRecipient + " ORDER BY b.created_at,b.id"), channelConsents: await bounded('SELECT c.binding_id AS "bindingId",c.endpoint_version AS "endpointVersion",c.topic,c.accepted,c.source,c.policy_version AS "policyVersion",c.recorded_at AS "recordedAt" FROM communication_binding_consents c JOIN communication_recipients r ON r.id=c.recipient_id WHERE ' + ownRecipient + " ORDER BY c.id"), campaignEnrollments: await bounded('SELECT e.id,e.revision_id AS "revisionId",e.locale,e.state,e.step_index AS "stepIndex",e.created_at AS "createdAt",e.updated_at AS "updatedAt",e.stop_code AS "stopCode" FROM crm_campaign_enrollments e JOIN communication_recipients r ON r.id=e.recipient_id WHERE ' + ownRecipient + " ORDER BY e.created_at,e.id"), marketingSuppressions: await bounded('SELECT s.id,s.topic,s.channel,s.version,s.created_at AS "createdAt",s.revoked_at AS "revokedAt" FROM crm_campaign_suppressions s JOIN communication_recipients r ON r.id=s.recipient_id WHERE ' + ownRecipient + " ORDER BY s.created_at,s.id"), ...subject.type === "crm-contact" ? { endpointPreferences: await bounded('SELECT p.endpoint_id AS "endpointId",p.endpoint_version AS "endpointVersion",p.preferences,p.version,p.updated_at AS "updatedAt" FROM crm_endpoint_preferences p JOIN crm_contact_endpoints e ON e.id=p.endpoint_id WHERE e.contact_id=$1 ORDER BY p.endpoint_id') } : {}, scope: "Own destination policy and consent history. Raw device tokens, challenge codes, capability links, provider secrets and private staff suppression notes are excluded. Retained campaign, delivery and consent records are evaluated as explicit erasure blockers." };
        const output = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), subject, ...result }, null, 2);
        (assert)(Buffer.byteLength(output) <= 64 * 1024 * 1024, 409, "PRIVACY_EXPORT_LIMIT", "This account requires an operator-reviewed large export.");
        await (audit)(actor.id, "privacy.export.created", "privacy_request", id, { subjectType: subject.type }, client);
        if (current.row.status !== "completed")
            await client.query("UPDATE privacy_requests SET status='completed',completed_at=now(),updated_at=now(),version=version+1,result=$2::jsonb WHERE id=$1", [id, JSON.stringify({ method: "scoped-json-export" })]);
        return output;
    });
    return new Response(serialized, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="privacy-export-' + id + '.json"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export { assertPrivacyReady, assessPrivacyErasure, createPrivacyHold, createPrivacyRequest, decidePrivacyRequest, executePrivacyErasure, exportPrivacyRequest, getPrivacyRequest, initializePrivacyLedger, listPrivacyHolds, listPrivacyRequests, privacyLedgerStatus, reconcilePrivacyLedger, updatePrivacyHold };
