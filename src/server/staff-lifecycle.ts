import {bindNotificationTemplate} from './notification-templates';
import type {PgRow} from './recovered-db-rows';
import type {WorkspaceRecord} from '../data/workspace-seed';
import type {CrmPermissions} from '../types/crm';
import type {FrontRequest} from '../types/frontend';
import type {Locale} from '../lib/i18n';
type UserRow = PgRow<'users',{allowed_locales:string[];crm_permissions:CrmPermissions}>;
type InvitationRow = PgRow<'staff_invitations',{allowed_locales:Locale[];crm_permissions:CrmPermissions;team_ids:string[];territory_ids:string[]}>;
type InvitationGrants = Pick<z.infer<typeof invitationSchema>,'role'|'allowedLocales'|'qualityScope'|'crmScope'|'crmPermissions'|'teamIds'|'territoryIds'>;
type RequestRow = PgRow<'requests',{data:FrontRequest}>;
type TaskRow = PgRow<'crm_task_series',{definition:{title:string;assigneeUserId:string}}> & {open_signature:string};
type Obligation = {id:string;version:number;responsibilities:string[]} & ({kind:'record';record:WorkspaceRecord;request?:RequestRow;task?:never}|{kind:'request';request:RequestRow;record?:never;task?:never}|{kind:'task';task:TaskRow;record?:WorkspaceRecord;request?:never});
import type { PoolClient } from 'pg';
import type { Actor } from './types';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { crmPermissionSchema, noCrmPermissions, loadCrmAccess, canAccessCrmRequest, isScopedCrmRecord, effectiveCrmAccess, redactCrmRecord, crmRequestCollection } from "./workspace-scopes";
import { assert, HttpError } from "./types";
import { transaction, audit } from "./db";
import { lockWorkspace, transferStaffWorkspaceRecord } from "./workspace";
import { parse, rateLimit } from "./http";
import { randomUUID, randomBytes } from "node:crypto";
import { hash, encrypt } from "./crypto";
import { config } from "./config";
import { readableRecord, checksum } from "./workspace-policy";
import { canWorkspace } from "../lib/auth";
import {assertPanelStaffProvisioning,staffProvisioningMode} from './staff-provisioning-mode';
const identity = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const uuid = z.string().uuid();
const locale = z.enum(["fa", "en", "tr", "ar", "ru"]);
const role = z.enum(["superAdmin", "admin", "contentEditor", "productManager", "scientificReviewer", "translator", "publisher", "hr", "business", "analyst", "support"]);
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const groups = z.array(identity).max(50).refine(unique, "Duplicate scope groups are not permitted.");
const invitationSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), role, allowedLocales: z.array(locale).min(1).max(5).refine(unique), qualityScope: z.boolean().default(false), crmScope: z.enum(["assigned", "team", "all"]).default("assigned"), crmPermissions: crmPermissionSchema.default({}), teamIds: groups.default([]), territoryIds: groups.default([]), locale: locale.default("fa"), expiresInHours: z.number().int().min(1).max(168).default(72) }).strict();
const offboardSchema = z.object({ expectedWorkspaceVersion: z.number().int().nonnegative(), planHash: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(10).max(2e3), assignments: z.array(z.object({ kind: z.enum(["record", "request", "task"]), id: identity, toUserId: identity }).strict()).max(5e3) }).strict();
const terminal = ["archived", "closed", "resolved", "withdrawn", "cancelled", "won", "lost", "converted"];
const instant = (value: Date | string | number) => new Date(value).toISOString();
const person = (row: UserRow) => ({ id: row.id, name: row.name, role: row.role, qualityScope: row.quality_scope, active: row.active });
const actorOf = (row: UserRow): Actor => ({ id: row.id, name: row.name, email: row.email, role: row.role, qualityScope: row.quality_scope, allowedLocales: row.allowed_locales, mfaVerified: row.mfa_enabled });
function invitationDto(row: InvitationRow) { return { id: row.id, version: row.version, email: row.email, role: row.role, allowedLocales: row.allowed_locales, qualityScope: row.quality_scope, crmScope: row.crm_scope, crmPermissions: { ...(noCrmPermissions)(), ...row.crm_permissions }, teamIds: row.team_ids, territoryIds: row.territory_ids, locale: row.locale, expiresInHours: Math.round((row.expires_at.getTime() - row.created_at.getTime()) / 36e5), invitedBy: row.invited_by, createdAt: instant(row.created_at), expiresAt: instant(row.expires_at), status: row.accepted_at ? "accepted" : row.revoked_at ? "revoked" : row.expires_at.getTime() <= Date.now() ? "expired" : "pending", acceptedBy: row.accepted_by, acceptedAt: row.accepted_at ? instant(row.accepted_at) : null, revokedAt: row.revoked_at ? instant(row.revoked_at) : null }; }
async function administrator(client: PoolClient, actor: Actor) { actor = await (loadCrmAccess)(actor, client); (assert)(actor.mfaVerified && ["superAdmin", "admin"].includes(actor.role), 403, "FORBIDDEN", "Staff lifecycle operations require current administrative access and MFA."); return actor; }
async function invitedGrants(client: PoolClient, actor: Actor, input: InvitationGrants) {
    assertPanelStaffProvisioning();
    (assert)(actor.role === "superAdmin" && actor.mfaVerified, 403, "ROLE_ESCALATION", "Only the senior administrator may invite staff or grant staff permissions.");
    (assert)(input.allowedLocales.every(value => actor.allowedLocales.includes(value)), 403, "INVITATION_SCOPE", "The invitation cannot grant a language outside the inviter\u2019s current scope.");
    (assert)(!input.qualityScope || actor.qualityScope, 403, "INVITATION_SCOPE", "The inviter cannot grant confidential quality access they do not hold.");
    (assert)(input.role !== "translator" || !input.allowedLocales.includes("fa"), 422, "INVITATION_LOCALES", "Translator invitations must select target languages other than Persian.");
    const access = actor.crmAccess;
    (assert)(access, 403, "INVITATION_SCOPE", "Current CRM grants are required.");
    for (const [key, value] of Object.entries(input.crmPermissions))
        (assert)(!value || access.permissions[key as keyof CrmPermissions], 403, "INVITATION_SCOPE", "The invitation cannot grant a CRM permission outside the inviter\u2019s current authority.");
    (assert)(input.crmScope !== "all" || access.scope === "all", 403, "INVITATION_SCOPE", "Global CRM access cannot be delegated from a narrower scope.");
    for (const [table, values, allowed] of [["crm_teams", input.teamIds, access.teamIds], ["crm_territories", input.territoryIds, access.territoryIds]] as const) {
        if (!values.length)
            continue;
        const rows = await client.query(`SELECT id FROM ${table} WHERE id=ANY($1::text[]) AND active FOR SHARE`, [values]);
        (assert)(rows.rowCount === values.length, 422, "INVITATION_GROUP", "Every invited scope group must remain active.");
        (assert)(access.scope === "all" || values.every(value => allowed.includes(value)), 403, "INVITATION_SCOPE", "The selected group is outside the inviter\u2019s scope.");
    }
}
const grantsOf = (row: InvitationRow): InvitationGrants => ({ role: row.role, allowedLocales: row.allowed_locales, qualityScope: row.quality_scope, crmScope: row.crm_scope, crmPermissions: row.crm_permissions, teamIds: row.team_ids, territoryIds: row.territory_ids });
async function liveInvitation(client: PoolClient, row: InvitationRow | undefined) {
    (assert)(row && !row.accepted_at && !row.revoked_at && row.expires_at.getTime() > Date.now(), 422, "INVITATION_EXPIRED", "This invitation is invalid, expired, revoked or already accepted.");
    const inviter = (await client.query<UserRow>("SELECT * FROM users WHERE id=$1 AND active AND mfa_enabled", [row.invited_by])).rows[0];
    (assert)(inviter, 422, "INVITATION_EXPIRED", "The inviter no longer has current staff authority.");
    try {
        await invitedGrants(client, await (loadCrmAccess)(actorOf(inviter), client), grantsOf(row));
    }
    catch (error) {
        if (error instanceof HttpError && error.status < 500)
            throw new HttpError(422, "INVITATION_EXPIRED", "The invitation\u2019s authorizations are no longer current.");
        throw error;
    }
    return row;
}
async function listStaffInvitations(actor: Actor) { return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await administrator(client, actor); const rows = (await client.query<InvitationRow>("SELECT * FROM staff_invitations" + (actor.role === "superAdmin" ? "" : " WHERE invited_by=$1") + " ORDER BY created_at DESC,id LIMIT 200", actor.role === "superAdmin" ? [] : [actor.id])).rows; return { items: rows.map(invitationDto), provisioningMode:staffProvisioningMode(),canInvite: staffProvisioningMode()!=='env'&&actor.role === "superAdmin" }; }); }
async function createStaffInvitation(actor: Actor, body: unknown) {
    const parsed = (parse)(invitationSchema, body), input = { ...parsed, crmPermissions: { ...(noCrmPermissions)(), ...parsed.crmPermissions } };
    await (rateLimit)("staff-invitation:" + actor.id, 30, 3600);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await administrator(client, actor);
        await invitedGrants(client, actor, input);
        const existing = (await client.query<UserRow>("SELECT * FROM users WHERE email=$1 FOR UPDATE", [input.email])).rows[0];
        (assert)(!existing || existing.active && existing.role === "customer", 409, "INVITATION_ACCOUNT", "Invite an unregistered recipient or an active customer account; existing staff permissions use staff management.");
        await client.query<InvitationRow>("UPDATE staff_invitations SET revoked_at=now(),revoked_by=$2,version=version+1 WHERE email=$1 AND accepted_at IS NULL AND revoked_at IS NULL", [input.email, actor.id]);
        const id = (randomUUID)(), raw = (randomBytes)(32).toString("hex"), expires = new Date(Date.now() + input.expiresInHours * 36e5);
        const row = (await client.query<InvitationRow>("INSERT INTO staff_invitations(id,email,target_user_id,role,allowed_locales,quality_scope,crm_scope,crm_permissions,team_ids,territory_ids,locale,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14) RETURNING *", [id, input.email, existing?.id || null, input.role, JSON.stringify(input.allowedLocales), input.qualityScope, input.crmScope, JSON.stringify(input.crmPermissions), JSON.stringify(input.teamIds), JSON.stringify(input.territoryIds), input.locale, (hash)(raw), actor.id, expires])).rows[0];
        const labels = { fa: ["\u062F\u0639\u0648\u062A \u0647\u0645\u06A9\u0627\u0631\u06CC \u062F\u0631 \u0627\u06CC\u062F\u0647\u200C\u0622\u0644 \u0645\u0627\u06A9\u0648", "\u0628\u0627 \u062D\u0633\u0627\u0628 \u0647\u0645\u06CC\u0646 \u0627\u06CC\u0645\u06CC\u0644 \u0648\u0627\u0631\u062F \u0634\u0648\u06CC\u062F\u060C \u0627\u06CC\u0645\u06CC\u0644 \u0631\u0627 \u062A\u0623\u06CC\u06CC\u062F \u06A9\u0646\u06CC\u062F \u0648 \u06A9\u062F \u062F\u0639\u0648\u062A \u0631\u0627 \u062F\u0631 \u0628\u062E\u0634 \u0627\u0645\u0646\u06CC\u062A \u062D\u0633\u0627\u0628 \u0648\u0627\u0631\u062F \u06A9\u0646\u06CC\u062F.", "\u06A9\u062F \u062F\u0639\u0648\u062A"], en: ["Ideal Makoo staff invitation", "Sign in with this exact email, verify it, then enter this invitation code in account security.", "Invitation code"], tr: ["Ideal Makoo personel daveti", "Bu e-posta hesab\u0131yla giri\u015F yap\u0131n, adresi do\u011Frulay\u0131n ve davet kodunu hesap g\xFCvenli\u011Fine girin.", "Davet kodu"], ar: ["\u062F\u0639\u0648\u0629 \u0645\u0648\u0638\u0641 \u0625\u0644\u0649 \u0625\u064A\u062F\u064A\u0627\u0644 \u0645\u0627\u0643\u0648", "\u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0647\u0630\u0627 \u0627\u0644\u0628\u0631\u064A\u062F \u0648\u062A\u062D\u0642\u0642 \u0645\u0646\u0647 \u062B\u0645 \u0623\u062F\u062E\u0644 \u0631\u0645\u0632 \u0627\u0644\u062F\u0639\u0648\u0629 \u0641\u064A \u0623\u0645\u0627\u0646 \u0627\u0644\u062D\u0633\u0627\u0628.", "\u0631\u0645\u0632 \u0627\u0644\u062F\u0639\u0648\u0629"], ru: ["\u041F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430 Ideal Makoo", "\u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0441 \u044D\u0442\u0438\u043C \u0430\u0434\u0440\u0435\u0441\u043E\u043C, \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u043F\u043E\u0447\u0442\u0443 \u0438 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u043A\u043E\u0434 \u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u0435 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430.", "\u041A\u043E\u0434 \u043F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u044F"] }[input.locale];
        const payload = { to: input.email, subject: labels[0], body: `${labels[1]}
${(config)().siteUrl}/${input.locale}/account/security/
${labels[2]}: ${raw}
${expires.toISOString()}`, purpose: "transactional", staffInvitationId: id };
        const outboxId=randomUUID();
        await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id) VALUES($1,'email',$2::jsonb,$3,$4)", [outboxId, JSON.stringify({ encrypted: (encrypt)(JSON.stringify(payload)) }), "staff-invitation:" + id, existing?.id || null]);
        await bindNotificationTemplate(client,outboxId,{key:'staff_invitation',locale:input.locale,values:{actionUrl:config().siteUrl+'/'+input.locale+'/account/security/',code:raw,expiresAt:expires.toISOString()}});
        await (audit)(actor.id, "staff.invitation.created", "staff_invitation", id, { role: input.role, allowedLocales: input.allowedLocales, qualityScope: input.qualityScope, crmScope: input.crmScope, teamCount: input.teamIds.length, territoryCount: input.territoryIds.length, recipientHash: (hash)(input.email), expiresAt: expires.toISOString() }, client);
        return invitationDto(row);
    });
}
async function revokeStaffInvitation(actor: Actor, id: string, body: unknown) { (parse)(uuid, id); const input = (parse)(z.object({ expectedVersion: z.number().int().positive() }).strict(), body); return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await administrator(client, actor); const row = (await client.query<InvitationRow>("SELECT * FROM staff_invitations WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(row && (actor.role === "superAdmin" || row.invited_by === actor.id), 404, "NOT_FOUND", "Invitation not found."); (assert)(row.version === input.expectedVersion, 409, "CONFLICT", "This invitation changed; load its current version."); (assert)(!row.accepted_at && !row.revoked_at, 409, "INVITATION_CLOSED", "This invitation has already been completed."); const updated = (await client.query<InvitationRow>("UPDATE staff_invitations SET revoked_at=now(),revoked_by=$2,version=version+1 WHERE id=$1 RETURNING *", [id, actor.id])).rows[0]; await (audit)(actor.id, "staff.invitation.revoked", "staff_invitation", id, {}, client); return invitationDto(updated); }); }
async function acceptStaffInvitation(actor: Actor, body: unknown) {
    assertPanelStaffProvisioning();
    const input = (parse)(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), body);
    await (rateLimit)("staff-invitation-accept:" + actor.id, 12, 3600);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await (loadCrmAccess)(actor, client);
        const user = (await client.query<UserRow>("SELECT * FROM users WHERE id=$1 FOR UPDATE", [actor.id])).rows[0];
        (assert)(user?.active && user.role === "customer" && user.email_verified, 403, "INVITATION_ACCOUNT", "Accept from the active customer account with its email verified.");
        const invitation = await liveInvitation(client, (await client.query<InvitationRow>("SELECT * FROM staff_invitations WHERE token_hash=$1 FOR UPDATE", [(hash)(input.token)])).rows[0]);
        (assert)(user.email === invitation.email && (!invitation.target_user_id || invitation.target_user_id === user.id), 422, "INVITATION_EXPIRED", "This invitation does not belong to this verified account.");
        await client.query<UserRow>("UPDATE users SET role=$2,allowed_locales=$3::jsonb,quality_scope=$4,crm_scope=$5,crm_permissions=$6::jsonb,updated_at=now() WHERE id=$1", [user.id, invitation.role, JSON.stringify(invitation.allowed_locales), invitation.quality_scope, invitation.crm_scope, JSON.stringify(invitation.crm_permissions)]);
        await client.query("UPDATE crm_team_memberships SET active=false,updated_at=now() WHERE user_id=$1 AND active", [user.id]);
        await client.query("UPDATE crm_territory_memberships SET active=false,updated_at=now() WHERE user_id=$1 AND active", [user.id]);
        for (const [table, column, values] of [["crm_team_memberships", "team_id", invitation.team_ids], ["crm_territory_memberships", "territory_id", invitation.territory_ids]] as const)
            for (const group of values)
                await client.query(`INSERT INTO ${table}(${column},user_id,granted_by) VALUES($1,$2,$3) ON CONFLICT(${column},user_id) DO UPDATE SET active=true,granted_by=excluded.granted_by,updated_at=now()`, [group, user.id, invitation.invited_by]);
        await client.query<InvitationRow>("UPDATE staff_invitations SET accepted_at=now(),accepted_by=$2,version=version+1 WHERE id=$1", [invitation.id, user.id]);
        await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [user.id]);
        await client.query("UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL", [user.id]);
        await client.query("UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton=true");
        await (audit)(user.id, "staff.invitation.accepted", "staff_invitation", invitation.id, { role: invitation.role, invitedBy: invitation.invited_by }, client);
        return { accepted: true, signInRequired: true, mfaEnrollmentRequired: !user.mfa_enabled };
    });
}
async function canDeliverStaffInvitation(client: PoolClient, payload: Record<string,unknown>) {
    if (!payload.staffInvitationId)
        return true;
    if (!uuid.safeParse(payload.staffInvitationId).success)
        return false;
    try {
        const row = await liveInvitation(client, (await client.query<InvitationRow>("SELECT * FROM staff_invitations WHERE id=$1", [payload.staffInvitationId])).rows[0]);
        if (payload.to !== row.email)
            return false;
        const user = (await client.query<UserRow>("SELECT * FROM users WHERE email=$1", [row.email])).rows[0];
        return (!row.target_user_id || user?.id === row.target_user_id) && (!user || user.active && user.role === "customer");
    }
    catch (error) {
        if (error instanceof HttpError && error.status < 500)
            return false;
        throw error;
    }
}
function requestAccess(actor: Actor, row: RequestRow, assignee = row.assignee_id) { return (canAccessCrmRequest)(actor, { id: row.id, kind: row.kind, qualityQuarantined: row.quality_quarantined, assigneeId: assignee, teamId: row.team_id, territoryId: row.territory_id }); }
async function openObligations(client: PoolClient, userId: string) {
    const requests = (await client.query<RequestRow>("SELECT id,kind,version,quality_quarantined,assignee_id,team_id,territory_id,data FROM requests WHERE assignee_id=$1 AND NOT (COALESCE(data->>'status','received')=ANY($2::text[])) ORDER BY id LIMIT 5001", [userId, terminal])).rows;
    const tasks = (await client.query<TaskRow>("SELECT s.id,s.record_id,s.version,s.definition,s.assignee_user_id,string_agg(o.id::text||':'||o.version::text,',' ORDER BY o.id) AS open_signature FROM crm_task_series s JOIN crm_task_occurrences o ON o.series_id=s.id AND o.status='open' WHERE s.active AND s.assignee_user_id=$1 GROUP BY s.id ORDER BY s.id LIMIT 5001", [userId])).rows;
    const records = (await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("SELECT id,revision_number,data FROM workspace_entities WHERE bucket='records' AND deleted_at IS NULL AND (owner_user_id=$1 OR assignee_id=$1) AND (NOT(status=ANY($2::text[])) OR id=ANY($3::text[]) OR id=ANY($4::text[])) ORDER BY id LIMIT 5001", [userId, terminal, requests.map(row => row.id), tasks.map(row => row.record_id)])).rows.filter(row => (isScopedCrmRecord)(row.data) || !!row.data.requestId);
    (assert)(requests.length <= 5e3 && tasks.length <= 5e3 && records.length <= 5e3, 413, "HANDOVER_LIMIT", "Reduce the open workload before preparing a handover of more than 5000 obligations.");
    const obligations = records.map<Obligation>(row => ({ kind: "record", id: row.id, version: Number(row.revision_number), record: row.data, request: requests.find(request => request.id === row.id), responsibilities: [...row.data.ownerId === userId ? ["owner"] : [], ...row.data.assigneeId === userId ? ["assignee"] : []] }));
    for (const row of requests)
        if (!records.some(record => record.id === row.id && record.data.assigneeId === userId))
            obligations.push({ kind: "request", id: row.id, version: row.version, request: row, responsibilities: ["assignee"] });
    const taskRecords = new Map(records.map(row => [row.id, row.data]));
    const missing = [...new Set(tasks.map(row => row.record_id).filter(id => !taskRecords.has(id)))];
    if (missing.length)
        for (const row of (await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("SELECT id,data FROM workspace_entities WHERE bucket='records' AND id=ANY($1::text[]) AND deleted_at IS NULL", [missing])).rows)
            taskRecords.set(row.id, row.data);
    for (const row of tasks)
        obligations.push({ kind: "task", id: row.id, version: row.version, record: taskRecords.get(row.record_id), task: row, responsibilities: ["assignee"] });
    (assert)(obligations.length <= 5e3, 413, "HANDOVER_LIMIT", "A single atomic staff handover supports at most 5000 open responsibilities.");
    return obligations;
}
async function assertStaffDeactivationReady(client: PoolClient, userId: string) { const work = await openObligations(client, userId); (assert)(!work.length, 409, "STAFF_HANDOVER_REQUIRED", "Transfer every open owned or assigned CRM record, request and task before deactivating or downgrading this staff account."); }
async function targetUser(client: PoolClient, actor: Actor, userId: string) { (parse)(identity, userId); const target = (await client.query<UserRow>("SELECT * FROM users WHERE id=$1 FOR UPDATE", [userId])).rows[0]; (assert)(target && target.role !== "customer", 404, "NOT_FOUND", "Staff account not found."); (assert)(actor.role === "superAdmin" || !["admin", "superAdmin"].includes(target.role), 403, "ROLE_ESCALATION", "This administrator cannot offboard a privileged account."); return target; }
function canReadObligation(actor: Actor, item: Obligation) { return (!item.record || (readableRecord)(actor, item.record)) && (!item.request || requestAccess(actor, item.request)) && (item.kind !== "task" || !!item.record && (canWorkspace)(actor.role, "view", "activities")); }
function resultingRecord(record: WorkspaceRecord, source: string, target: Actor): WorkspaceRecord { return { ...record, ...record.ownerId === source ? { ownerId: target.id, owner: target.role } : {}, ...record.assigneeId === source ? { assigneeId: target.id } : {} }; }
function recipientEligible(candidate: Actor, item: Obligation, source: string) {
    if (!candidate.mfaVerified || candidate.role === "customer" || candidate.id === source)
        return false;
    const record = item.record ? resultingRecord(item.record, source, candidate) : void 0;
    return (!record || (readableRecord)(candidate, record)) && (!item.request || requestAccess(candidate, item.request, candidate.id)) && (item.kind !== "task" || !!record && (canWorkspace)(candidate.role, "view", "activities"));
}
async function prepareHandover(client: PoolClient, actor: Actor, userId: string) {
    const meta = await (lockWorkspace)(client);
    actor = await administrator(client, actor);
    const target = await targetUser(client, actor, userId);
    const work = await openObligations(client, userId);
    const rows = (await client.query<UserRow>("SELECT * FROM users WHERE active AND mfa_enabled AND role<>'customer' AND id<>$1 ORDER BY name,id LIMIT 1001", [userId])).rows;
    (assert)(rows.length <= 1e3, 413, "STAFF_DIRECTORY_LIMIT", "The staff handover directory supports at most 1000 active MFA staff.");
    const memberships = (await client.query("SELECT 'team' AS kind,m.user_id,m.team_id AS id FROM crm_team_memberships m JOIN crm_teams g ON g.id=m.team_id AND g.active WHERE m.active AND m.user_id=ANY($1::text[]) UNION ALL SELECT 'territory',m.user_id,m.territory_id FROM crm_territory_memberships m JOIN crm_territories g ON g.id=m.territory_id AND g.active WHERE m.active AND m.user_id=ANY($1::text[])", [rows.map(row => row.id)])).rows;
    const candidates = new Map<string,Actor>;
    for (const row of rows)
        candidates.set(row.id, { ...actorOf(row), crmAccess: (effectiveCrmAccess)(row.role, row.crm_scope, row.crm_permissions, memberships.filter(item => item.user_id === row.id && item.kind === "team").map(item => item.id), memberships.filter(item => item.user_id === row.id && item.kind === "territory").map(item => item.id)) });
    let blockedCount = 0;
    const used = new Set;
    const items = [];
    for (const item of work) {
        if (!canReadObligation(actor, item)) {
            blockedCount++;
            continue;
        }
        const eligible = [...candidates.values()].filter(candidate => recipientEligible(candidate, item, userId)).map(candidate => candidate.id);
        eligible.forEach(id => used.add(id));
        if (!eligible.length)
            blockedCount++;
        const projected = item.record ? (redactCrmRecord)(actor, item.record) : void 0;
        const title = projected ? projected.title.en || projected.title.fa || item.id : item.kind === "task" ? item.task.definition.title : actor.crmAccess?.permissions.contact ? String(item.request?.data.name || item.id) : "Request " + item.id;
        items.push({ kind: item.kind, id: item.id, ...item.task ? { recordId: item.task.record_id } : {}, title, collection: projected?.collection || (item.request ? (crmRequestCollection)(item.request.kind) : "activities"), responsibilities: item.responsibilities, version: item.version, eligibleUserIds: eligible });
    }
    const planHash = (checksum)({ target: { id: target.id, active: target.active, role: target.role, updatedAt: instant(target.updated_at), email: target.email, qualityScope: target.quality_scope, locales: target.allowed_locales, scope: target.crm_scope, permissions: target.crm_permissions }, work: work.map(item => ({ kind: item.kind, id: item.id, version: item.version, responsibilities: item.responsibilities, record: item.record ? (checksum)(item.record) : null, request: item.request ? (checksum)(item.request) : null, task: item.task ? (checksum)(item.task) : null })) });
    const seniors = target.role === "superAdmin" ? (await client.query("SELECT count(*)::int AS n FROM users WHERE active AND role='superAdmin'")).rows[0].n : 2;
    return { plan: { user: person(target), workspaceVersion: Number(meta.version), planHash, items, recipients: rows.filter(row => used.has(row.id)).map(person), blockedCount, canOffboard: target.active && actor.id !== userId && seniors > 1 && blockedCount === 0 }, work, target, candidates };
}
async function previewStaffHandover(actor: Actor, userId: string) { return (transaction)(async (client) => (await prepareHandover(client, actor, userId)).plan); }
async function offboardStaff(actor: Actor, userId: string, body: unknown) {
    const input = (parse)(offboardSchema, body);
    (assert)(unique(input.assignments.map(item => item.kind + ":" + item.id)), 422, "HANDOVER_DUPLICATE", "A responsibility may appear only once in the handover.");
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        await client.query("SELECT pg_advisory_xact_lock(917264831)");
        actor = await administrator(client, actor);
        const { plan, work, target, candidates } = await prepareHandover(client, actor, userId);
        (assert)(target.active, 409, "STAFF_INACTIVE", "This account is already inactive.");
        (assert)(actor.id !== userId, 403, "SELF_OFFBOARD", "Another authorized administrator must complete your handover.");
        if (target.role === "superAdmin") {
            const count = (await client.query("SELECT count(*)::int AS n FROM users WHERE active AND role='superAdmin'")).rows[0].n;
            (assert)(count > 1, 409, "LAST_ADMIN", "The last active senior administrator cannot be removed.");
        }
        (assert)(plan.workspaceVersion === input.expectedWorkspaceVersion && plan.planHash === input.planHash, 409, "HANDOVER_CHANGED", "The account or workload changed; prepare a fresh handover.");
        (assert)(plan.blockedCount === 0, 403, "HANDOVER_SCOPE", "An open responsibility is outside your authority or lacks an authorized recipient.");
        const assignments = new Map(input.assignments.map(item => [item.kind + ":" + item.id, item]));
        (assert)(assignments.size === work.length && work.every(item => assignments.has(item.kind + ":" + item.id)), 422, "HANDOVER_INCOMPLETE", "Every current open responsibility must have exactly one recipient.");
        for (const item of work) {
            const selected = assignments.get(item.kind + ":" + item.id)!;
            const candidate = candidates.get(selected.toUserId);
            (assert)(candidate && recipientEligible(candidate, item, userId), 422, "HANDOVER_RECIPIENT_SCOPE", "A selected recipient no longer has the required role, quality, team or territory access.");
        }
        const transferred = { records: 0, requests: 0, tasks: 0 };
        for (const item of work.filter(item2 => item2.kind === "record")) {
            const to = candidates.get(assignments.get("record:" + item.id)!.toUserId)!;
            await (transferStaffWorkspaceRecord)(client, actor, item.id, userId, to);
            transferred.records++;
            if (item.request && item.record?.assigneeId === userId)
                transferred.requests++;
        }
        for (const item of work.filter(item2 => item2.kind === "request")) {
            const to = candidates.get(assignments.get("request:" + item.id)!.toUserId)!;
            const request = item.request;
            await client.query<RequestRow>("UPDATE requests SET assignee_id=$2,version=version+1,data=jsonb_set(data,'{version}',to_jsonb(version+1)),sla=sla||jsonb_build_object('lastAssignedAt',$3::text),updated_at=now() WHERE id=$1", [request.id, to.id, new Date().toISOString()]);
            await (audit)(actor.id, "staff.request.handover", "request", request.id, { sourceUserId: userId, targetUserId: to.id }, client);
            transferred.requests++;
        }
        for (const item of work.filter(item2 => item2.kind === "task")) {
            const to = candidates.get(assignments.get("task:" + item.id)!.toUserId)!;
            const current = (await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL", [item.task.record_id])).rows[0]?.data;
            (assert)(current && (readableRecord)(to, current) && (canWorkspace)(to.role, "view", "activities"), 422, "HANDOVER_TASK_SCOPE", "The task recipient must retain access after all record assignments are applied.");
            await client.query<TaskRow>("UPDATE crm_task_series SET assignee_user_id=$2,definition=jsonb_set(definition,'{assigneeUserId}',to_jsonb($2::text)),version=version+1,updated_at=now() WHERE id=$1", [item.id, to.id]);
            await (audit)(actor.id, "staff.task.handover", "crm_task", item.id, { sourceUserId: userId, targetUserId: to.id }, client);
            transferred.tasks++;
        }
        await assertStaffDeactivationReady(client, userId);
        const revoked = await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
        await client.query("UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL", [userId]);
        await client.query("UPDATE crm_team_memberships SET active=false,updated_at=now() WHERE user_id=$1 AND active", [userId]);
        await client.query("UPDATE crm_territory_memberships SET active=false,updated_at=now() WHERE user_id=$1 AND active", [userId]);
        await client.query<InvitationRow>("UPDATE staff_invitations SET revoked_at=now(),revoked_by=$2,version=version+1 WHERE invited_by=$1 AND accepted_at IS NULL AND revoked_at IS NULL", [userId, actor.id]);
        await client.query<UserRow>("UPDATE users SET active=false,mfa_pending_secret=NULL,mfa_pending_expires_at=NULL,updated_at=now() WHERE id=$1", [userId]);
        const version = Number((await client.query("UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton=true RETURNING version")).rows[0].version), handoverId = (randomUUID)();
        await client.query("INSERT INTO staff_handover_events(id,source_user_id,performed_by,reason,plan_hash,workspace_version_before,workspace_version_after,assignments,revoked_sessions) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)", [handoverId, userId, actor.id, input.reason, plan.planHash, plan.workspaceVersion, version, JSON.stringify(input.assignments), revoked.rowCount || 0]);
        await (audit)(actor.id, "staff.offboarded", "user", userId, { handoverId, planHash: plan.planHash, transferred, revokedSessions: revoked.rowCount || 0, reasonHash: (hash)(input.reason) }, client);
        return { userId, active: false, handoverId, workspaceVersion: version, transferred, revokedSessions: revoked.rowCount || 0 };
    });
}
export { acceptStaffInvitation, assertStaffDeactivationReady, canDeliverStaffInvitation, createStaffInvitation, listStaffInvitations, offboardStaff, previewStaffHandover, revokeStaffInvitation };
