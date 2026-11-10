import type {PgRow} from './recovered-db-rows';
import type {WorkspaceRecord} from '../data/workspace-seed';
import type {WorkspaceAction} from '../lib/auth';
import type {Locale} from '../lib/i18n';
export type CrmAudienceFact = 'subjectType'|'accountId'|'locale'|'requestKind'|'requestStatus'|'tag';
export interface CrmAudienceAccount {id:string;recipientId:string;subjectType:'user'|'crm-contact';subjectId:string;userId?:string;name:string;email:string;emailVerified:boolean;locale:Locale;requestIds:string[];facts:Record<CrmAudienceFact,string[]>}
type AudienceRequestRow = Pick<PgRow<'requests'>,'id'|'owner_id'|'kind'|'quality_quarantined'|'assignee_id'|'team_id'|'territory_id'> & {status:string|null;tags:unknown};
type AudienceUserRow = Pick<PgRow<'users'>,'id'|'name'|'email'|'email_verified'> & {recipient_id:string;language:string|null};
type AudienceContactRow = Pick<PgRow<'crm_contact_profiles'>,'record_id'|'locale'|'display_name'> & {data:WorkspaceRecord;email:string|null;email_verified:boolean};
type ManualInput = {userId?:unknown;recipientId?:unknown;requestId?:unknown;topic?:unknown;channel?:unknown;purpose?:unknown};
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { assert, locales, HttpError } from "./types";
import { canAccessCrmRequest, loadCrmAccess } from "./workspace-scopes";
import { canWorkspace } from "../lib/auth";
import { readableRecord } from "./workspace-policy";
const audienceLimit = 1e4;
const isCrmManager = (actor: Actor) => ["superAdmin", "admin"].includes(actor.role);
async function projectCrmAudience(client: PoolClient, actor: Actor, userIds: string[], frozenActor?: Actor): Promise<CrmAudienceAccount[]> {
    (assert)(userIds.length <= 1e3, 422, "AUDIENCE_BATCH", "Audience batches must contain at most 1,000 accounts.");
    if (!userIds.length || !actor.mfaVerified || !actor.crmAccess?.permissions.contact)
        return [];
    const users = (await client.query<AudienceUserRow>("SELECT u.id,r.id AS recipient_id,u.name,u.email,u.email_verified,s.preferences->>'language' AS language FROM users u JOIN communication_recipients r ON r.subject_type='user' AND r.user_id=u.id AND r.active LEFT JOIN user_settings s ON s.user_id=u.id WHERE u.id=ANY($1::text[]) AND u.active AND u.role='customer' ORDER BY u.id", [userIds])).rows;
    const requests = (await client.query<AudienceRequestRow>(`SELECT r.id,r.owner_id,r.kind,r.data->>'status' AS status,r.quality_quarantined,r.assignee_id,r.team_id,r.territory_id,e.data->'tags' AS tags
    FROM requests r LEFT JOIN workspace_entities e ON e.bucket='records' AND e.id=r.id AND e.data->>'requestId'=r.id AND e.deleted_at IS NULL
    WHERE r.owner_id=ANY($1::text[]) ORDER BY r.owner_id,r.id LIMIT 20001`, [users.map(user => user.id)])).rows;
    (assert)(requests.length <= 2e4, 503, "AUDIENCE_REVIEW_LIMIT", "This audience exceeds the bounded online relationship review; narrow the account directory before retrying.");
    const access = (as: Actor, row: AudienceRequestRow) => (canAccessCrmRequest)(as, { id: row.id, kind: row.kind, qualityQuarantined: row.quality_quarantined, assigneeId: row.assignee_id, teamId: row.team_id, territoryId: row.territory_id });
    const authorized = new Map<string|null,AudienceRequestRow[]>;
    for (const row of requests)
        if (access(actor, row) && (!frozenActor || access(frozenActor, row)))
            authorized.set(row.owner_id, [...authorized.get(row.owner_id) || [], row]);
    const result: CrmAudienceAccount[] = [];
    for (const user of users) {
        const language: Locale = (locales as readonly unknown[]).includes(user.language) ? user.language as Locale : "fa", owned = authorized.get(user.id) || [];
        if (!actor.allowedLocales.includes(language) || frozenActor && !frozenActor.allowedLocales.includes(language) || (!isCrmManager(actor) || frozenActor && !isCrmManager(frozenActor)) && !owned.length)
            continue;
        result.push({ id: user.id, recipientId: user.recipient_id, subjectType: "user", subjectId: user.id, userId: user.id, name: user.name, email: user.email, emailVerified: user.email_verified, locale: language, requestIds: owned.map(row => row.id), facts: { subjectType: ["user"], accountId: [], locale: [language], requestKind: [...new Set(owned.map(row => row.kind))], requestStatus: [...new Set(owned.map(row => row.status).filter((status): status is string => !!status))], tag: [...new Set(owned.flatMap(row => Array.isArray(row.tags) ? row.tags.filter(tag => typeof tag === "string" && tag.length <= 100) : []))] } });
    }
    return result;
}
async function currentCrmSender(actor: Actor, client: PoolClient, section = "campaigns", action: WorkspaceAction = "view") { actor = await (loadCrmAccess)(actor, client); (assert)(actor.mfaVerified && (canWorkspace)(actor.role, action, section) && actor.crmAccess?.permissions.contact, 403, "CAMPAIGN_PERMISSION", "Current staff access, MFA and contact permission are required."); return actor; }
async function projectCrmRecipientAudience(client: PoolClient, actor: Actor, recipientIds: string[], frozenActor?: Actor): Promise<CrmAudienceAccount[]> {
    (assert)(recipientIds.length <= 1e3, 422, "AUDIENCE_BATCH", "Audience batches must contain at most 1,000 recipients.");
    if (!recipientIds.length || !actor.mfaVerified || !actor.crmAccess?.permissions.contact)
        return [];
    const identities = (await client.query<PgRow<'communication_recipients'>>("SELECT id,subject_type,subject_id,user_id,contact_id FROM communication_recipients WHERE id=ANY($1::uuid[]) AND active ORDER BY id", [recipientIds])).rows;
    const result = await projectCrmAudience(client, actor, identities.flatMap(row => row.user_id ? [row.user_id] : []), frozenActor);
    const contactIds = identities.flatMap(row => row.contact_id ? [row.contact_id] : []);
    if (!contactIds.length)
        return result;
    const contacts = (await client.query<AudienceContactRow>(`SELECT p.record_id,p.locale,p.display_name,w.data,
    (SELECT e.value FROM crm_contact_endpoints e WHERE e.contact_id=p.record_id AND e.channel='email' AND e.active ORDER BY (e.verified_at IS NOT NULL) DESC,e.created_at,e.id LIMIT 1) AS email,
    EXISTS(SELECT 1 FROM crm_contact_endpoints e WHERE e.contact_id=p.record_id AND e.channel='email' AND e.active AND e.verified_at IS NOT NULL) AS email_verified
    FROM crm_contact_profiles p JOIN workspace_entities w ON w.bucket='records' AND w.id=p.record_id
    WHERE p.record_id=ANY($1::text[]) AND w.deleted_at IS NULL AND w.status<>'archived'`, [contactIds])).rows;
    for (const contact of contacts) {
        if (!(readableRecord)(actor, contact.data) || !actor.allowedLocales.includes(contact.locale) || frozenActor && (!frozenActor.crmAccess?.permissions.contact || !(readableRecord)(frozenActor, contact.data) || !frozenActor.allowedLocales.includes(contact.locale)))
            continue;
        const identity = identities.find(row => row.contact_id === contact.record_id)!;
        const affiliations = (await client.query<{account_id:string;data:WorkspaceRecord}>(`SELECT DISTINCT a.account_id,w.data FROM crm_contact_affiliations a JOIN workspace_entities w ON w.bucket='records' AND w.id=a.account_id AND w.deleted_at IS NULL AND w.status<>'archived'
      WHERE a.contact_id=$1 AND a.valid_from<=CURRENT_DATE AND (a.valid_to IS NULL OR a.valid_to>=CURRENT_DATE) LIMIT 101`, [contact.record_id])).rows;
        (assert)(affiliations.length <= 100, 503, "AUDIENCE_REVIEW_LIMIT", "A contact has too many affiliations for online segment inspection.");
        const accounts = affiliations.filter(row => (readableRecord)(actor, row.data) && (!frozenActor || (readableRecord)(frozenActor, row.data))).map(row => row.account_id);
        result.push({ id: contact.record_id, recipientId: identity.id, subjectType: "crm-contact", subjectId: contact.record_id, name: contact.display_name, email: contact.email || "", emailVerified: contact.email_verified, locale: contact.locale, requestIds: [], facts: { subjectType: ["crm-contact"], accountId: accounts, locale: [contact.locale], requestKind: [], requestStatus: [], tag: (contact.data.tags || []).filter(tag => typeof tag === "string" && tag.length <= 100) } });
    }
    return result;
}
async function isRecipientCampaignSuppressed(client: PoolClient, senderId: string, recipientId: string, topic: unknown, channel: unknown) { return !!(await client.query("SELECT 1 FROM crm_campaign_suppressions WHERE recipient_id=$1 AND (sender_id IS NULL OR sender_id=$2) AND topic IN ('all',$3) AND channel IN ('all',$4) AND revoked_at IS NULL LIMIT 1", [recipientId, senderId, topic, channel])).rowCount; }
async function storedCrmSender(client: PoolClient, id: string, section = "campaigns") {
    try {
        return await currentCrmSender({ id, name: "", email: "", role: "customer", qualityScope: false, allowedLocales: [], mfaVerified: true }, client, section, "create");
    }
    catch (error) {
        if (error instanceof HttpError && [401, 403].includes(error.status))
            return null;
        throw error;
    }
}
function audienceSample(account: CrmAudienceAccount) { const at = account.email.indexOf("@"); return { recipientId: account.recipientId, subjectType: account.subjectType, subjectId: account.subjectId, ...account.userId ? { userId: account.userId } : {}, name: account.name, emailMasked: account.email ? account.email.slice(0, 1) + "***" + (at >= 0 ? account.email.slice(at) : "") : "", locale: account.locale, emailVerified: account.emailVerified }; }
async function isCampaignSuppressed(client: PoolClient, senderId: string, userId: string, topic: unknown, channel: unknown) { return !!(await client.query("SELECT 1 FROM crm_campaign_suppressions WHERE user_id=$1 AND (sender_id IS NULL OR sender_id=$2) AND topic IN ('all',$3) AND channel IN ('all',$4) AND revoked_at IS NULL LIMIT 1", [userId, senderId, topic, channel])).rowCount; }
async function authorizeManualNotification(client: PoolClient, actor: Actor, input: ManualInput) {
    actor = await currentCrmSender(actor, client, "communications", "create");
    (assert)(["superAdmin", "admin", "business", "support"].includes(actor.role), 403, "FORBIDDEN", "This role cannot create manual notifications.");
    (assert)(typeof input.userId === "string", 422, "CONSENT_REQUIRED", "Select an account recipient.");
    const account = (await projectCrmAudience(client, actor, [input.userId]))[0];
    (assert)(account, 404, "RECIPIENT_NOT_FOUND", "The recipient is unavailable in your current CRM scope.");
    if (input.requestId)
        (assert)(typeof input.requestId === "string" && account.requestIds.includes(input.requestId), 404, "RECIPIENT_NOT_FOUND", "The request is unavailable in your current CRM scope.");
    const senderRequestId = typeof input.requestId === "string" ? input.requestId : account.requestIds[0] || null;
    if (input.purpose === "marketing" && ["products", "research", "events", "content"].includes(String(input.topic)) && ["email", "in-app"].includes(String(input.channel)))
        (assert)(!await isCampaignSuppressed(client, actor.id, account.id, input.topic, input.channel), 409, "CAMPAIGN_SUPPRESSED", "This account is on the applicable marketing suppression list.");
    return { actor, senderId: actor.id, senderRequestId, senderLocale: account.locale };
}
async function manualNotificationPermitted(client: PoolClient, payload: Record<string,unknown>, channel: string) {
    if (typeof payload.senderId !== "string" || typeof payload.userId !== "string")
        return false;
    const actor = await storedCrmSender(client, payload.senderId, "communications");
    if (!actor || !["superAdmin", "admin", "business", "support"].includes(actor.role))
        return false;
    const account = (await projectCrmAudience(client, actor, [payload.userId]))[0];
    if (!account || payload.senderLocale !== account.locale || payload.senderRequestId && !account.requestIds.includes(String(payload.senderRequestId)))
        return false;
    if (payload.purpose === "marketing" && ["products", "research", "events", "content"].includes(String(payload.topic)) && ["email", "in-app"].includes(channel) && await isCampaignSuppressed(client, actor.id, account.id, payload.topic, channel))
        return false;
    return true;
}
async function authorizeManualBoundNotification(client: PoolClient, actor: Actor, input: ManualInput) {
    actor = await currentCrmSender(actor, client, "communications", "create");
    (assert)(["superAdmin", "admin", "business", "support"].includes(actor.role), 403, "FORBIDDEN", "This role cannot create manual notifications.");
    (assert)(typeof input.recipientId === "string" !== (typeof input.userId === "string"), 422, "RECIPIENT", "Select exactly one typed recipient or account.");
    let recipientId = typeof input.recipientId === "string" ? input.recipientId : void 0;
    if (!recipientId)
        recipientId = (await client.query("SELECT id FROM communication_recipients WHERE subject_type='user' AND user_id=$1 AND active", [input.userId])).rows[0]?.id;
    (assert)(recipientId, 404, "RECIPIENT_NOT_FOUND", "The recipient is unavailable in your current CRM scope.");
    const account = (await projectCrmRecipientAudience(client, actor, [recipientId]))[0];
    (assert)(account, 404, "RECIPIENT_NOT_FOUND", "The recipient is unavailable in your current CRM scope.");
    if (input.requestId)
        (assert)(typeof input.requestId === "string" && account.requestIds.includes(input.requestId), 404, "RECIPIENT_NOT_FOUND", "The request is unavailable in your current CRM scope.");
    if (input.purpose === "marketing")
        (assert)(!await isRecipientCampaignSuppressed(client, actor.id, account.recipientId, input.topic, input.channel), 409, "CAMPAIGN_SUPPRESSED", "This recipient is on the applicable marketing suppression list.");
    return { actor, account, senderId: actor.id, senderRequestId: typeof input.requestId === "string" ? input.requestId : account.requestIds[0], senderLocale: account.locale };
}
async function manualBoundDeliveryPermitted(client: PoolClient, payload: Record<string,unknown>, channel: string) {
    if (typeof payload.senderId !== "string" || typeof payload.recipientId !== "string" || !["sms", "telegram", "push"].includes(channel))
        return false;
    const actor = await storedCrmSender(client, payload.senderId, "communications");
    if (!actor || !["superAdmin", "admin", "business", "support"].includes(actor.role))
        return false;
    const account = (await projectCrmRecipientAudience(client, actor, [payload.recipientId]))[0];
    if (!account || account.locale !== payload.senderLocale || account.locale !== payload.locale || payload.senderRequestId && !account.requestIds.includes(String(payload.senderRequestId)))
        return false;
    if (account.subjectType === "user" ? payload.userId !== account.subjectId || payload.contactId !== void 0 : payload.contactId !== account.subjectId || payload.userId !== void 0)
        return false;
    if (payload.purpose === "marketing" && await isRecipientCampaignSuppressed(client, actor.id, account.recipientId, payload.topic, channel))
        return false;
    return true;
}
export { audienceLimit, audienceSample, authorizeManualBoundNotification, authorizeManualNotification, currentCrmSender, isCampaignSuppressed, isCrmManager, isRecipientCampaignSuppressed, manualBoundDeliveryPermitted, manualNotificationPermitted, projectCrmAudience, projectCrmRecipientAudience, storedCrmSender };
