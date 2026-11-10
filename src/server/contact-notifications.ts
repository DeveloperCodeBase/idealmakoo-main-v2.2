import {bindNotificationTemplate} from './notification-templates';
import type { PgRow } from './recovered-db-rows';
import type { Locale } from '../lib/i18n';
import type { NotificationPayload, NotificationDecision, PolicyOutboxRow, PreparedNotification } from './notification-policy';
export type MarketingTopic=typeof topics[number];
export type ContactPreferences=z.infer<typeof contactPreferencesSchema>;
export type ContactEndpoint=PgRow<'crm_contact_endpoints'> & {locale:Locale};
export interface ContactEndpointReference {channel:'email';endpointId:string;endpointVersion:number;valueHash:string}
type ContactPreferencesRow=PgRow<'crm_endpoint_preferences',{preferences:ContactPreferences}>;
type ContactDelivery=Awaited<ReturnType<typeof resolveContactDelivery>>;
type ContactNotificationInput=ContactDelivery & {title:string;body:string;href?:string;campaignDeliveryId?:string};
type PreferenceScope='preferences'|'unsubscribe';
import type { PoolClient } from 'pg';
import type { Actor } from './types';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { validTimezone, quietHoursEnd, nextDigestAt } from "./notification-policy";
import { createHmac, randomUUID, randomBytes } from "node:crypto";
import { config } from "./config";
import { decrypt, hash, encrypt, equal } from "./crypto";
import { assert, HttpError } from "./types";
import { parse, rateLimit, visitorKey, json } from "./http";
import { transaction, audit } from "./db";
import { domainContext, domainRecord, domainPermission, requireContact } from "./workspace-domain-core";
const preferenceCopy = { fa: { title: "\u0627\u06CC\u062F\u0647\u200C\u0622\u0644 \u0645\u0627\u06A9\u0648 \u2014 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0627\u0631\u062A\u0628\u0627\u0637", manage: "\u0645\u0648\u0636\u0648\u0639\u200C\u0647\u0627\u060C \u062A\u0646\u0627\u0648\u0628 \u0648 \u0633\u0627\u0639\u062A \u0633\u06A9\u0648\u062A \u0627\u06CC\u0646 \u0645\u0642\u0635\u062F \u0631\u0627 \u0645\u062F\u06CC\u0631\u06CC\u062A \u06A9\u0646\u06CC\u062F:", stop: "\u062A\u0648\u0642\u0641 \u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u0628\u0627\u0632\u0627\u0631\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0646 \u0645\u0642\u0635\u062F", done: "\u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u0628\u0627\u0632\u0627\u0631\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0646 \u0645\u0642\u0635\u062F \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0634\u062F\u0646\u062F.", button: "\u0644\u063A\u0648 \u0627\u0634\u062A\u0631\u0627\u06A9" }, en: { title: "Ideal Makoo \u2014 communication preferences", manage: "Manage this destination\u2019s topics, frequency and quiet hours:", stop: "Stop marketing messages for this destination", done: "Marketing messages are disabled for this destination.", button: "Unsubscribe" }, tr: { title: "Ideal Makoo \u2014 ileti\u015Fim tercihleri", manage: "Bu hedefin konular\u0131n\u0131, s\u0131kl\u0131\u011F\u0131n\u0131 ve sessiz saatlerini y\xF6netin:", stop: "Bu hedef i\xE7in pazarlama mesajlar\u0131n\u0131 durdur", done: "Bu hedef i\xE7in pazarlama mesajlar\u0131 kapat\u0131ld\u0131.", button: "Abonelikten \xE7\u0131k" }, ar: { title: "\u0625\u064A\u062F\u0622\u0644 \u0645\u0627\u0643\u0648 \u2014 \u062A\u0641\u0636\u064A\u0644\u0627\u062A \u0627\u0644\u062A\u0648\u0627\u0635\u0644", manage: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0648\u0627\u0636\u064A\u0639 \u0648\u0627\u0644\u062A\u0643\u0631\u0627\u0631 \u0648\u0633\u0627\u0639\u0627\u062A \u0627\u0644\u0647\u062F\u0648\u0621 \u0644\u0647\u0630\u0647 \u0627\u0644\u0648\u062C\u0647\u0629:", stop: "\u0625\u064A\u0642\u0627\u0641 \u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u062A\u0633\u0648\u064A\u0642 \u0644\u0647\u0630\u0647 \u0627\u0644\u0648\u062C\u0647\u0629", done: "\u062A\u0645 \u0625\u064A\u0642\u0627\u0641 \u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u062A\u0633\u0648\u064A\u0642 \u0644\u0647\u0630\u0647 \u0627\u0644\u0648\u062C\u0647\u0629.", button: "\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643" }, ru: { title: "Ideal Makoo \u2014 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439", manage: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u0442\u0435 \u0442\u0435\u043C\u044B, \u0447\u0430\u0441\u0442\u043E\u0442\u0443 \u0438 \u0442\u0438\u0445\u0438\u0435 \u0447\u0430\u0441\u044B \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u0430\u0434\u0440\u0435\u0441\u0430\u0442\u0430:", stop: "\u041E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0440\u0435\u043A\u043B\u0430\u043C\u043D\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u0430\u0434\u0440\u0435\u0441\u0430\u0442\u0430", done: "\u0420\u0435\u043A\u043B\u0430\u043C\u043D\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u0430\u0434\u0440\u0435\u0441\u0430\u0442\u0430 \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u044B.", button: "\u041E\u0442\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F" } };
const topics = ["products", "research", "events"] as const;
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const policy = z.object({ enabled: z.boolean(), frequency: z.enum(["instant", "daily", "weekly"]), quietStart: z.string().regex(clock).nullable(), quietEnd: z.string().regex(clock).nullable() }).strict().refine(value => value.quietStart === null && value.quietEnd === null || value.quietStart !== null && value.quietEnd !== null && value.quietStart !== value.quietEnd, "Set two different quiet times, or disable both.");
const contactPreferencesSchema = z.object({ schemaVersion: z.literal(1), timezone: z.string().min(1).max(80).refine(validTimezone), topics: z.object({ products: policy, research: policy, events: policy }).strict() }).strict();
const rawToken = z.string().regex(/^[a-f0-9]{64}$/);
const defaults = () : ContactPreferences => ({ schemaVersion: 1, timezone: "Asia/Tehran", topics: Object.fromEntries(topics.map(topic => [topic, { enabled: false, frequency: "instant", quietStart: null, quietEnd: null }])) as ContactPreferences["topics"] });
const tokenCsrf = (raw: string) => (createHmac)("sha256", (config)().sessionSecret).update("communication-preference-csrf-v1:" + raw).digest("hex");
const safeHeaders = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };
const mask = (email: string) => { const at = email.lastIndexOf("@"); return at > 0 ? email.slice(0, 1) + "***" + email.slice(at) : "***"; };
function decode(payload: NotificationPayload) : NotificationPayload { return typeof payload.encrypted === "string" ? JSON.parse((decrypt)(payload.encrypted)) : payload; }
async function endpointFor(client: PoolClient, id: string, lock = false) : Promise<ContactEndpoint | null> {
    return (await client.query(`SELECT e.*,p.locale FROM crm_contact_endpoints e JOIN communication_recipients r ON r.id=e.recipient_id AND r.contact_id=e.contact_id AND r.subject_type='crm-contact' AND r.active
    JOIN crm_contact_profiles p ON p.record_id=e.contact_id JOIN workspace_entities w ON w.bucket='records' AND w.id=e.contact_id AND w.deleted_at IS NULL AND w.status<>'archived'
    WHERE e.id=$1 AND e.active AND e.channel='email' AND e.verified_at IS NOT NULL${lock ? " FOR UPDATE OF e" : ""}`, [id])).rows[0] || null;
}
async function ensureContactPreferences(client: PoolClient, endpoint: Pick<ContactEndpoint,'id'|'version'>) : Promise<ContactPreferencesRow> {
    const consentDefaults = async () => {
        const value = defaults(), consents = (await client.query("SELECT DISTINCT ON(topic) topic,accepted,endpoint_version FROM crm_endpoint_consent_events WHERE endpoint_id=$1 ORDER BY topic,id DESC", [endpoint.id])).rows;
        for (const consent of consents)
            if (topics.includes(consent.topic as MarketingTopic))
                value.topics[consent.topic as MarketingTopic].enabled = consent.accepted && consent.endpoint_version === endpoint.version;
        return value;
    };
    let row = (await client.query<ContactPreferencesRow>("SELECT * FROM crm_endpoint_preferences WHERE endpoint_id=$1 FOR UPDATE", [endpoint.id])).rows[0];
    if (!row) {
        const value = await consentDefaults();
        await client.query("INSERT INTO crm_endpoint_preferences(endpoint_id,endpoint_version,timezone,preferences) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(endpoint_id) DO NOTHING", [endpoint.id, endpoint.version, value.timezone, JSON.stringify(value)]);
        row = (await client.query<ContactPreferencesRow>("SELECT * FROM crm_endpoint_preferences WHERE endpoint_id=$1 FOR UPDATE", [endpoint.id])).rows[0];
    }
    if (row.endpoint_version !== endpoint.version) {
        const value = await consentDefaults();
        row = (await client.query<ContactPreferencesRow>("UPDATE crm_endpoint_preferences SET endpoint_version=$2,timezone=$3,preferences=$4::jsonb,version=version+1,updated_at=now() WHERE endpoint_id=$1 RETURNING *", [endpoint.id, endpoint.version, value.timezone, JSON.stringify(value)])).rows[0];
    }
    (assert)(contactPreferencesSchema.safeParse(row.preferences).success, 503, "NOTIFICATION_POLICY_INVALID", "Contact communication preferences require operator repair.");
    return row;
}
async function applyVerifiedContactTopics(client: PoolClient, endpoint: Pick<ContactEndpoint,'id'|'version'>, accepted: readonly MarketingTopic[]) {
    const before = await ensureContactPreferences(client, endpoint), value = structuredClone(before.preferences);
    for (const topic of topics)
        value.topics[topic].enabled = accepted.includes(topic);
    if (JSON.stringify(value) !== JSON.stringify(before.preferences))
        await client.query("UPDATE crm_endpoint_preferences SET preferences=$2::jsonb,version=version+1,updated_at=now() WHERE endpoint_id=$1", [endpoint.id, JSON.stringify(value)]);
}
async function topicAllowed(client: PoolClient, endpoint: Pick<ContactEndpoint,'id'|'version'>, topic: MarketingTopic) { const event = (await client.query("SELECT accepted,endpoint_version FROM crm_endpoint_consent_events WHERE endpoint_id=$1 AND topic=$2 ORDER BY id DESC LIMIT 1", [endpoint.id, topic])).rows[0]; return event?.accepted === true && event.endpoint_version === endpoint.version; }
async function captureContactEndpoints(client: PoolClient, recipientId: string, channels: readonly string[], topic: MarketingTopic) : Promise<ContactEndpointReference[]> {
    if (!channels.includes("email"))
        return [];
    const rows = (await client.query("SELECT id FROM crm_contact_endpoints WHERE recipient_id=$1 AND channel='email' AND active AND verified_at IS NOT NULL ORDER BY created_at,id LIMIT 101", [recipientId])).rows;
    (assert)(rows.length <= 100, 503, "RECIPIENT_ENDPOINT_LIMIT", "This recipient requires an operator-reviewed endpoint selection.");
    for (const row of rows) {
        const endpoint = await endpointFor(client, row.id);
        if (!endpoint || !await topicAllowed(client, endpoint, topic))
            continue;
        const preferences = (await ensureContactPreferences(client, endpoint)).preferences;
        if (preferences.topics[topic].enabled)
            return [{ channel: "email", endpointId: endpoint.id, endpointVersion: endpoint.version, valueHash: (hash)(endpoint.normalized_value) }];
    }
    return [];
}
async function resolveContactDelivery(client: PoolClient, recipientId: string, reference: ContactEndpointReference, topic: MarketingTopic) { (assert)(reference.channel === "email", 422, "RECIPIENT_CHANNEL_UNAVAILABLE", "This contact endpoint does not support the requested channel."); const endpoint = await endpointFor(client, reference.endpointId); (assert)(endpoint && endpoint.recipient_id === recipientId && endpoint.version === reference.endpointVersion && (hash)(endpoint.normalized_value) === reference.valueHash, 409, "RECIPIENT_UNVERIFIED", "The verified contact endpoint changed or became unavailable."); (assert)(await topicAllowed(client, endpoint, topic), 409, "CONSENT_REVOKED", "The recipient has not enabled this topic for this endpoint version."); const preferences = (await ensureContactPreferences(client, endpoint)).preferences; (assert)(preferences.topics[topic].enabled, 409, "CONSENT_REVOKED", "The recipient has disabled this topic."); return { recipientId, contactId: endpoint.contact_id, endpointId: endpoint.id, endpointVersion: endpoint.version, valueHash: reference.valueHash, to: endpoint.normalized_value, locale: endpoint.locale, topic }; }
async function enqueueContactNotification(client: PoolClient, input: ContactNotificationInput, dedupeKey: string) { const id = (randomUUID)(), payload = { recipientId: input.recipientId, contactId: input.contactId, contactEndpoint: { channel: "email", endpointId: input.endpointId, endpointVersion: input.endpointVersion, valueHash: input.valueHash }, to: input.to, locale: input.locale, topic: input.topic, purpose: "marketing", title: input.title, subject: input.title, body: input.body, text: input.body, href: input.href, campaignDeliveryId: input.campaignDeliveryId }; const inserted = await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,crm_contact_id) VALUES($1,'email',$2::jsonb,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id", [id, JSON.stringify({ encrypted: (encrypt)(JSON.stringify(payload)) }), dedupeKey, input.contactId]); return inserted.rows[0]?.id || null; }
function referenceFrom(payload: NotificationPayload) { return (parse)(z.object({ channel: z.literal("email"), endpointId: z.string().uuid(), endpointVersion: z.number().int().positive(), valueHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), payload.contactEndpoint); }
async function currentDelivery(client: PoolClient, payload: NotificationPayload) { (assert)(typeof payload.recipientId === "string" && typeof payload.contactId === "string" && topics.includes(payload.topic as MarketingTopic), 409, "RECIPIENT_MISMATCH", "A typed contact delivery is required."); const value = await resolveContactDelivery(client, payload.recipientId, referenceFrom(payload), payload.topic as MarketingTopic); (assert)(value.contactId === payload.contactId && value.to === payload.to && value.locale === payload.locale, 409, "RECIPIENT_MISMATCH", "The saved contact destination changed."); return value; }
async function decide(client: PoolClient, outboxId: string, payload: NotificationPayload, at: Date, created: Date, digest = false) : Promise<NotificationDecision> {
    try {
        const delivery = await currentDelivery(client, payload), { campaignDeliveryPermitted } = await import("./crm-campaigns");
        if (!await campaignDeliveryPermitted(client, outboxId, "email", payload))
            return { action: "cancel", code: "RECIPIENT_SCOPE_REVOKED" };
        const preferences = (await ensureContactPreferences(client, { id: delivery.endpointId, version: delivery.endpointVersion })).preferences, selected = preferences.topics[delivery.topic];
        if (selected.frequency !== "instant") {
            const until2 = (quietHoursEnd)((nextDigestAt)(created, selected.frequency, preferences.timezone), selected, preferences.timezone);
            if (!digest)
                return { action: "batch", until: until2, frequency: selected.frequency };
            if (until2 > at)
                return { action: "defer", until: until2, code: "DIGEST_SCHEDULE" };
        }
        const until = (quietHoursEnd)(at, selected, preferences.timezone);
        if (until > at)
            return { action: "defer", until, code: "QUIET_HOURS" };
        return { action: "send", payload, marketing: true };
    }
    catch (error) {
        if (error instanceof HttpError && [401, 403, 404, 409, 422].includes(error.status))
            return { action: "cancel", code: error.code };
        throw error;
    }
}
async function handleDecision(client: PoolClient, row: PolicyOutboxRow, decision: Exclude<NotificationDecision,{action:'send'}>, payload: NotificationPayload) {
    if (decision.action === "cancel") {
        const changed = await client.query("UPDATE outbox SET state='cancelled',last_error=$3,completed_at=now(),lock_token=NULL WHERE id=$1 AND lock_token=$2 AND state='running' RETURNING id", [row.id, row.lock_token, decision.code]);
        if (changed.rowCount)
            await client.query("INSERT INTO delivery_events(outbox_id,provider,status,detail) VALUES($1,$2,$3,$4)", [row.id, "policy", "suppressed", decision.code]);
    }
    else if (decision.action === "defer")
        await client.query("UPDATE outbox SET state='pending',available_at=$3,attempts=GREATEST(attempts-1,0),lock_token=NULL,last_error=$4 WHERE id=$1 AND lock_token=$2 AND state='running'", [row.id, row.lock_token, decision.until, decision.code]);
    else {
        const ref = referenceFrom(payload);
        await client.query(`INSERT INTO notification_digest_items(outbox_id,user_id,recipient_id,endpoint_id,endpoint_version,channel,topic,frequency,due_at) VALUES($1,NULL,$2,$3,$4,'email',$5,$6,$7) ON CONFLICT(outbox_id) DO NOTHING`, [row.id, payload.recipientId, ref.endpointId, ref.endpointVersion, payload.topic, decision.frequency, decision.until]);
        await client.query("UPDATE outbox SET state='batched',attempts=GREATEST(attempts-1,0),lock_token=NULL,last_error=NULL WHERE id=$1 AND lock_token=$2 AND state='running'", [row.id, row.lock_token]);
        await client.query("INSERT INTO delivery_events(outbox_id,provider,status) VALUES($1,$2,$3)", [row.id, "digest", "queued"]);
    }
}
async function prepareContactNotification(client: PoolClient, row: PolicyOutboxRow, payload: NotificationPayload, at: Date, created: Date) : Promise<PreparedNotification> {
    const decision = await decide(client, row.id, payload, at, created);
    if (decision.action === "send")
        return decision;
    await handleDecision(client, row, decision, payload);
    return { action: "handled" };
}
async function prepareContactDigest(client: PoolClient, row: PolicyOutboxRow, payload: NotificationPayload, at: Date) : Promise<PreparedNotification> {
    const members = (await client.query(`SELECT d.outbox_id,o.payload,o.created_at FROM notification_digest_items d JOIN outbox o ON o.id=d.outbox_id WHERE d.digest_outbox_id=$1 AND d.state='batched' AND o.state='batched' AND d.user_id IS NULL ORDER BY d.created_at,d.outbox_id FOR UPDATE OF d,o`, [row.id])).rows;
    const ready = [];
    for (const member of members) {
        const source = decode(member.payload);
        const same = source.recipientId === payload.recipientId && referenceFrom(source).endpointId === payload.endpointId && referenceFrom(source).endpointVersion === payload.endpointVersion;
        const decision: NotificationDecision = same ? await decide(client, member.outbox_id, source, at, member.created_at, true) : { action: "cancel", code: "RECIPIENT_MISMATCH" };
        if (decision.action === "cancel") {
            await client.query("UPDATE notification_digest_items SET state='cancelled',completed_at=now() WHERE outbox_id=$1", [member.outbox_id]);
            const changed = await client.query("UPDATE outbox SET state='cancelled',last_error=$2,completed_at=now() WHERE id=$1 AND state='batched' RETURNING id", [member.outbox_id, decision.code]);
            if (changed.rowCount)
                await client.query("INSERT INTO delivery_events(outbox_id,provider,status,detail) VALUES($1,$2,$3,$4)", [member.outbox_id, "policy", "suppressed", decision.code]);
        }
        else if (decision.action === "defer")
            await client.query("UPDATE notification_digest_items SET state='pending',digest_outbox_id=NULL,due_at=$2 WHERE outbox_id=$1", [member.outbox_id, decision.until]);
        else if (decision.action === "send")
            ready.push(decision.payload);
    }
    if (!ready.length) {
        await handleDecision(client, row, { action: "cancel", code: "DIGEST_EMPTY" }, payload);
        return { action: "handled" };
    }
    const first = ready[0], locale = first.locale as Locale, subject = { fa: "\u062E\u0644\u0627\u0635\u0647\u0654 \u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u0627\u0646\u062A\u062E\u0627\u0628\u200C\u0634\u062F\u0647\u0654 \u0634\u0645\u0627", en: "Your selected communication digest", tr: "Se\xE7ti\u011Finiz ileti\u015Fim \xF6zeti", ar: "\u0645\u0644\u062E\u0635 \u0631\u0633\u0627\u0626\u0644\u0643 \u0627\u0644\u0645\u062E\u062A\u0627\u0631\u0629", ru: "\u0421\u0432\u043E\u0434\u043A\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0445 \u0432\u0430\u043C\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439" }[locale], text = ready.map((entry, index) => `${index + 1}. ${String(entry.title)}
${String(entry.body)}
${(config)().siteUrl}${String(entry.href)}`).join("\n\n");
    return { action: "send", marketing: true, payload: { recipientId: first.recipientId, contactId: first.contactId, contactEndpoint: first.contactEndpoint, to: first.to, locale, subject, title: subject, text, body: text, topic: first.topic, purpose: "marketing", contactDigest: true } };
}
async function validToken(client: PoolClient, raw: string, scope?: PreferenceScope, lock = false) { (parse)(rawToken, raw); const row = (await client.query("SELECT * FROM communication_preference_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()" + (lock ? " FOR UPDATE" : ""), [(hash)(raw)])).rows[0]; (assert)(row && (!scope || row.scope === scope), 404, "COMMUNICATION_LINK", "This link is invalid, expired or revoked."); const endpoint = await endpointFor(client, row.endpoint_id, lock); (assert)(endpoint && endpoint.recipient_id === row.recipient_id && endpoint.version === row.endpoint_version && (hash)(endpoint.normalized_value) === row.value_hash && endpoint.locale === row.locale, 404, "COMMUNICATION_LINK", "This destination changed. Request a new link."); return { row, endpoint }; }
async function tokenFor(client: PoolClient, endpoint: ContactEndpoint, scope: PreferenceScope, outboxId: string | null) { const raw = (randomBytes)(32).toString("hex"), days = scope === "preferences" ? 7 : 30; await client.query(`INSERT INTO communication_preference_tokens(token_hash,recipient_id,endpoint_id,endpoint_version,value_hash,scope,locale,outbox_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+($9*interval '1 day'))`, [(hash)(raw), endpoint.recipient_id, endpoint.id, endpoint.version, (hash)(endpoint.normalized_value), scope, endpoint.locale, outboxId, days]); return raw; }
async function requestContactPreferences(actor: Actor, contactId: string, endpointId: string) { await (rateLimit)("contact-preferences:" + actor.id + ":" + endpointId, 3, 3600); return (transaction)(async (client) => { actor = (await (domainContext)(client, actor)).actor; const record = await (domainRecord)(client, actor, contactId, "contacts"); (domainPermission)(actor, record); (requireContact)(actor); const endpoint = await endpointFor(client, endpointId, true); (assert)(endpoint?.contact_id === contactId && actor.allowedLocales.includes(endpoint.locale), 404, "CRM_RECIPIENT_UNAVAILABLE", "An authorized, verified endpoint is required."); const copy = preferenceCopy[endpoint.locale], raw = await tokenFor(client, endpoint, "preferences", null), id = (randomUUID)(), payload = { to: endpoint.normalized_value, subject: copy.title, text: `${copy.manage} ${(config)().siteUrl}/${endpoint.locale}/communication-preferences/${raw}/`, contactPreferenceNotice: { tokenHash: (hash)(raw), endpointId: endpoint.id, endpointVersion: endpoint.version, valueHash: (hash)(endpoint.normalized_value) } }; await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,crm_contact_id) VALUES($1,'email',$2::jsonb,$3,$4)", [id, JSON.stringify({ encrypted: (encrypt)(JSON.stringify(payload)) }), "contact-preference:" + (hash)(raw), contactId]); await bindNotificationTemplate(client,id,{key:'contact_preferences',locale:endpoint.locale,values:{actionUrl:`${config().siteUrl}/${endpoint.locale}/communication-preferences/${raw}/`}}); await (audit)(actor.id, "crm.endpoint.preferences_requested", "crm-contact", contactId, { endpointId }, client); return { ok: true, status: "pending" }; }); }
async function canDeliverContactPreferences(client: PoolClient, payload: NotificationPayload) {
    const notice = z.object({ tokenHash: z.string().regex(/^[a-f0-9]{64}$/), endpointId: z.string().uuid(), endpointVersion: z.number().int().positive(), valueHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(payload.contactPreferenceNotice);
    if (!notice.success)
        return false;
    const value = notice.data, row = (await client.query("SELECT * FROM communication_preference_tokens WHERE token_hash=$1 AND scope='preferences' AND revoked_at IS NULL AND expires_at>now()", [value.tokenHash])).rows[0], endpoint = await endpointFor(client, value.endpointId);
    return !!row && !!endpoint && row.endpoint_id === endpoint.id && row.endpoint_version === endpoint.version && row.value_hash === value.valueHash && row.locale === endpoint.locale && row.recipient_id === endpoint.recipient_id && endpoint.version === value.endpointVersion && (hash)(endpoint.normalized_value) === value.valueHash && endpoint.normalized_value === payload.to;
}
async function resolveContactPreferenceCapability(client: PoolClient, raw: string) { const { endpoint } = await validToken(client, raw, "preferences"); return { recipientId: endpoint.recipient_id, endpointId: endpoint.id, endpointVersion: endpoint.version, valueHash: (hash)(endpoint.normalized_value) }; }
async function isBindingToken(raw: string) { (parse)(rawToken, raw); return (transaction)(async (client) => !!(await client.query("SELECT 1 FROM communication_preference_tokens WHERE token_hash=$1 AND binding_id IS NOT NULL", [(hash)(raw)])).rowCount); }
async function getContactPreferenceView(raw: string) {
    if (await isBindingToken(raw))
        return (await import("./communication-channels")).getBindingPreferenceView(raw);
    return (transaction)(async (client) => { const { row, endpoint } = await validToken(client, raw), preferences = await ensureContactPreferences(client, endpoint); return { locale: row.locale, channel: "email", maskedDestination: mask(endpoint.normalized_value), version: preferences.version, preferences: preferences.preferences, expiresAt: row.expires_at.toISOString(), csrfToken: tokenCsrf(raw), scope: row.scope }; });
}
async function patchContactPreferenceView(raw: string, body: unknown) {
    if (await isBindingToken(raw))
        return (await import("./communication-channels")).patchBindingPreferenceView(raw, body);
    const input = (parse)(z.object({ expectedVersion: z.number().int().positive(), preferences: contactPreferencesSchema }).strict(), body);
    return (transaction)(async (client) => {
        const { endpoint } = await validToken(client, raw, "preferences", true), old = await ensureContactPreferences(client, endpoint);
        (assert)(old.version === input.expectedVersion, 409, "CONFLICT", "These preferences changed. Reload before saving.");
        for (const topic of topics)
            if (old.preferences.topics[topic].enabled !== input.preferences.topics[topic].enabled)
                await client.query("INSERT INTO crm_endpoint_consent_events(endpoint_id,endpoint_version,topic,accepted,source,policy_version) VALUES($1,$2,$3,$4,'verified-recipient','crm-contact-policy-v2')", [endpoint.id, endpoint.version, topic, input.preferences.topics[topic].enabled]);
        await client.query("UPDATE crm_endpoint_preferences SET preferences=$2::jsonb,timezone=$3,version=version+1,updated_at=now() WHERE endpoint_id=$1", [endpoint.id, JSON.stringify(input.preferences), input.preferences.timezone]);
        await client.query("UPDATE notification_digest_items SET due_at=LEAST(due_at,now()) WHERE endpoint_id=$1 AND state='pending'", [endpoint.id]);
        await (audit)(null, "crm.endpoint.preferences_updated", "crm-contact", endpoint.contact_id, { endpointId: endpoint.id, endpointVersion: endpoint.version, version: old.version + 1 }, client);
    });
}
async function unsubscribeContact(raw: string) {
    if (await isBindingToken(raw))
        return (await import("./communication-channels")).unsubscribeBinding(raw);
    return (transaction)(async (client) => {
        const { row, endpoint } = await validToken(client, raw, "unsubscribe", true);
        if (row.consumed_at)
            return true;
        const old = await ensureContactPreferences(client, endpoint), value = structuredClone(old.preferences);
        for (const topic of topics) {
            value.topics[topic].enabled = false;
            await client.query("INSERT INTO crm_endpoint_consent_events(endpoint_id,endpoint_version,topic,accepted,source,policy_version) VALUES($1,$2,$3,false,'recipient-unsubscribe','crm-contact-policy-v2')", [endpoint.id, endpoint.version, topic]);
        }
        await client.query("UPDATE crm_endpoint_preferences SET preferences=$2::jsonb,version=version+1,updated_at=now() WHERE endpoint_id=$1", [endpoint.id, JSON.stringify(value)]);
        await client.query("UPDATE communication_preference_tokens SET consumed_at=now() WHERE token_hash=$1", [row.token_hash]);
        await (audit)(null, "crm.endpoint.unsubscribed", "crm-contact", endpoint.contact_id, { endpointId: endpoint.id, scope: "marketing-email" }, client);
        return true;
    });
}
async function contactMarketingUnsubscribe(outboxId: string, payload: NotificationPayload) { return (transaction)(async (client) => { const delivery = await currentDelivery(client, payload), endpoint = await endpointFor(client, delivery.endpointId); (assert)(endpoint, 409, "RECIPIENT_UNVERIFIED", "The endpoint is unavailable."); (assert)(new URL((config)().siteUrl).protocol === "https:", 503, "UNSUBSCRIBE_HTTPS_REQUIRED", "Marketing email requires HTTPS."); const raw = await tokenFor(client, endpoint, "unsubscribe", outboxId), url = `${(config)().siteUrl}/api/v1/communication-unsubscribe/${raw}`; return { url, label: { fa: "\u0644\u063A\u0648 \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u0628\u0627\u0632\u0627\u0631\u06CC\u0627\u0628\u06CC", en: "Unsubscribe from marketing email", tr: "Pazarlama e-postas\u0131ndan \xE7\u0131k", ar: "\u0625\u0644\u063A\u0627\u0621 \u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u062A\u0633\u0648\u064A\u0642", ru: "\u041E\u0442\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u043E\u0442 \u0440\u0435\u043A\u043B\u0430\u043C\u043D\u044B\u0445 \u043F\u0438\u0441\u0435\u043C" }[delivery.locale], headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }; }); }
async function contactPreferencesResponse(request: Request, raw: string) {
    await (rateLimit)("contact-preference-view:" + (visitorKey)(request), 120, 900);
    if (request.method === "GET")
        return (json)(await getContactPreferenceView(raw), 200, safeHeaders);
    (assert)(request.method === "PATCH", 405, "METHOD", "Use GET or PATCH.");
    (assert)(request.headers.get("origin") === (config)().siteUrl && request.headers.get("sec-fetch-site") !== "cross-site" && (equal)(request.headers.get("x-communication-csrf") || "", tokenCsrf(raw)), 403, "CSRF", "Reload this preference link before saving.");
    const { readJson } = await import("./http");
    await patchContactPreferenceView(raw, await readJson(request, 32768));
    return (json)(await getContactPreferenceView(raw), 200, safeHeaders);
}
async function unsubscribeFormBody(request: Request) {
    const maximum = 1024, declared = request.headers.get("content-length");
    (assert)(!declared || /^\d+$/.test(declared) && Number(declared) <= maximum, 413, "BODY_TOO_LARGE", "The unsubscribe form is too large.");
    (assert)(request.body, 422, "UNSUBSCRIBE", "Confirm the unsubscribe action.");
    const reader = request.body.getReader(), chunks = [];
    let bytes = 0;
    while (true) {
        const part = await reader.read();
        if (part.done)
            break;
        bytes += part.value.byteLength;
        if (bytes > maximum) {
            await reader.cancel();
            throw new HttpError(413, "BODY_TOO_LARGE", "The unsubscribe form is too large.");
        }
        chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
}
async function contactUnsubscribeResponse(request: Request, raw: string) {
    await (rateLimit)("contact-unsubscribe:" + (visitorKey)(request), 120, 900);
    (parse)(rawToken, raw);
    (assert)(request.method === "GET" || request.method === "POST", 405, "METHOD", "Use GET or POST.");
    const view = await getContactPreferenceView(raw);
    (assert)(view.scope === "unsubscribe", 404, "COMMUNICATION_LINK", "This unsubscribe link is unavailable.");
    let done = false;
    if (request.method === "POST") {
        const contentType = request.headers.get("content-type")?.split(";")[0];
        (assert)(contentType === "application/x-www-form-urlencoded", 415, "CONTENT_TYPE", "Use the unsubscribe form.");
        const body = await unsubscribeFormBody(request);
        (assert)(new URLSearchParams(body).get("List-Unsubscribe") === "One-Click", 422, "UNSUBSCRIBE", "Confirm the one-click unsubscribe action.");
        done = await unsubscribeContact(raw);
    }
    const copy = preferenceCopy[view.locale as Locale], html = `<!doctype html><html lang="${view.locale}" dir="${["fa", "ar"].includes(view.locale) ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${copy.title}</title></head><body><main><h1>${done ? copy.done : copy.stop}</h1>${done ? "" : `<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button>${copy.button}</button></form>`}</main></body></html>`;
    return new Response(html, { status: 200, headers: { ...safeHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}
export { applyVerifiedContactTopics, canDeliverContactPreferences, captureContactEndpoints, contactMarketingUnsubscribe, contactPreferencesResponse, contactPreferencesSchema, contactUnsubscribeResponse, enqueueContactNotification, ensureContactPreferences, getContactPreferenceView, patchContactPreferenceView, prepareContactDigest, prepareContactNotification, requestContactPreferences, resolveContactDelivery, resolveContactPreferenceCapability, unsubscribeContact };
