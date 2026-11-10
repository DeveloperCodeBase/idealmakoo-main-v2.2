import type { PgRow } from './recovered-db-rows';
import type { NotificationPayload } from './notification-policy';
export type BindingChannel = typeof bindingChannels[number];
export type CommunicationTopic = typeof communicationTopics[number];
export type BindingPreferences = z.infer<typeof bindingPreferencesSchema>;
export interface CommunicationRecipient { id:string;subjectType:'user'|'crm-contact';subjectId:string;userId:string|null;contactId:string|null;locale:Locale;phone:string|null }
export type BindingRow = PgRow<'communication_bindings',{preferences:BindingPreferences}>;
export interface BindingContext {row:BindingRow;recipient:CommunicationRecipient;available:boolean;to:string|null}
export interface BindingReference {channel:BindingChannel;bindingId:string;endpointVersion:number;valueHash:string}
type AuthoritySource={id:string;version:number|null;valueHash:string|null};
type BoundPreferenceToken=PgRow<'communication_preference_tokens',{binding_id:string}>;
type PreferenceScope='preferences'|'unsubscribe';
import type { Locale } from '../lib/i18n';
import type { PoolClient } from 'pg';
import type { Actor } from './types';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { validTimezone } from "./notification-policy";
import { createHmac, randomUUID, randomBytes, randomInt } from "node:crypto";
import { config } from "./config";
import { parse, rateLimit, visitorKey, json, readJson, expectedVersion } from "./http";
import { assert, HttpError } from "./types";
import { equal, hash, decrypt, encrypt } from "./crypto";
import { najvaCspConfiguration } from "../lib/security-headers";
import { configuredNajvaWorker } from "./najva-worker";
import { domainContext, domainRecord, requireContact, domainPermission } from "./workspace-domain-core";
import { transaction, audit } from "./db";
const bindingChannels = ["sms", "telegram", "push"] as const;
const communicationTopics = ["requests", "products", "research", "events", "content"] as const;
const clocks = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const policy = z.object({ enabled: z.boolean(), frequency: z.enum(["instant", "daily", "weekly"]), quietStart: z.string().regex(clocks).nullable(), quietEnd: z.string().regex(clocks).nullable() }).strict().refine(value => value.quietStart === null && value.quietEnd === null || value.quietStart !== null && value.quietEnd !== null && value.quietStart !== value.quietEnd);
const bindingPreferencesSchema = z.object({ schemaVersion: z.literal(1), timezone: z.string().min(1).max(80).refine(validTimezone), topics: z.object({ requests: policy, products: policy, research: policy, events: policy, content: policy.default({enabled:false,frequency:"instant",quietStart:null,quietEnd:null}) }).strict() }).strict();
const idSchema = z.string().uuid(), tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };
const defaults = () => ({ schemaVersion: 1, timezone: "Asia/Tehran", topics: Object.fromEntries(communicationTopics.map(topic => [topic, { enabled: false, frequency: "instant", quietStart: null, quietEnd: null }])) });
const communicationCsrf = (raw: string) => (createHmac)("sha256", (config)().sessionSecret).update("communication-preference-csrf-v1:" + raw).digest("hex");
function assertCommunicationCsrf(request: Request, raw: string) { (parse)(tokenSchema, raw); (assert)(request.headers.get("origin") === (config)().siteUrl && request.headers.get("sec-fetch-site") !== "cross-site" && (equal)(request.headers.get("x-communication-csrf") || "", communicationCsrf(raw)), 403, "CSRF", "Reload the current communication link before continuing."); }
const otpHash = (tokenHash: string, code: string) => (createHmac)("sha256", (config)().sessionSecret).update("communication-otp-v1:" + tokenHash + ":" + code).digest("hex");
const language = (value: unknown) : Locale => ["fa", "en", "tr", "ar", "ru"].includes(String(value)) ? value as Locale : "fa";
function normalizeCommunicationPhone(value: unknown) {
    if (typeof value !== "string")
        return null;
    const ascii = value.replace(/[۰-۹]/g, char => String(char.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - 1632)).replace(/[\s().-]/g, "").replace(/^00/, "+");
    return /^\+[1-9]\d{9,14}$/.test(ascii) ? ascii : null;
}
const mask = (channel: string, to: string | null) => !to ? "\u2014" : channel === "sms" ? to.slice(0, 3) + "\u2022\u2022\u2022\u2022" + to.slice(-4) : channel === "telegram" ? "\u2022\u2022\u2022\u2022" + to.slice(-4) : "device \xB7 " + (hash)(to).slice(0, 8);
const notice = (locale: Locale, key: 'verified' | 'verify') => ({ fa: { verified: "\u0645\u0642\u0635\u062F \u062A\u0623\u06CC\u06CC\u062F \u0634\u062F. \u0645\u0648\u0636\u0648\u0639\u200C\u0647\u0627\u06CC \u0628\u0627\u0632\u0627\u0631\u06CC\u0627\u0628\u06CC \u062A\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u0634\u0645\u0627 \u062E\u0627\u0645\u0648\u0634\u200C\u0627\u0646\u062F.", verify: "\u0628\u0631\u0627\u06CC \u062A\u0623\u06CC\u06CC\u062F \u062F\u0631\u06CC\u0627\u0641\u062A \u0627\u0639\u0644\u0627\u0646 \u0627\u06CC\u0646 \u062F\u0633\u062A\u06AF\u0627\u0647\u060C \u067E\u06CC\u0648\u0646\u062F \u0631\u0627 \u0628\u0627\u0632 \u06A9\u0646\u06CC\u062F \u0648 \u062A\u0623\u06CC\u06CC\u062F \u06A9\u0646\u06CC\u062F." }, en: { verified: "Destination verified. Marketing remains disabled until you choose it.", verify: "Open this link and confirm to verify notifications on this device." }, tr: { verified: "Hedef do\u011Fruland\u0131. Siz se\xE7ene kadar pazarlama kapal\u0131d\u0131r.", verify: "Bu cihaz\u0131n bildirimlerini do\u011Frulamak i\xE7in ba\u011Flant\u0131y\u0131 a\xE7\u0131p onaylay\u0131n." }, ar: { verified: "\u062A\u0645 \u062A\u0648\u062B\u064A\u0642 \u0627\u0644\u0648\u062C\u0647\u0629. \u064A\u0628\u0642\u0649 \u0627\u0644\u062A\u0633\u0648\u064A\u0642 \u0645\u0639\u0637\u0644\u0627\u064B \u062D\u062A\u0649 \u062A\u062E\u062A\u0627\u0631\u0647.", verify: "\u0627\u0641\u062A\u062D \u0627\u0644\u0631\u0627\u0628\u0637 \u0648\u0623\u0643\u062F \u0644\u062A\u0648\u062B\u064A\u0642 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632." }, ru: { verified: "\u0410\u0434\u0440\u0435\u0441 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D. \u0420\u0435\u043A\u043B\u0430\u043C\u0430 \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u0430, \u043F\u043E\u043A\u0430 \u0432\u044B \u0435\u0451 \u043D\u0435 \u0432\u044B\u0431\u0435\u0440\u0435\u0442\u0435.", verify: "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0441\u0441\u044B\u043B\u043A\u0443 \u0438 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u0435 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0439 \u043D\u0430 \u044D\u0442\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435." } })[locale][key];
function communicationCapabilities() {
    const live = process.env.NOTIFICATIONS_MODE === "live", smsKey = !!process.env.KAVENEGAR_API_KEY, telegram = !!process.env.TELEGRAM_BOT_TOKEN;
    let sdk = null;
    try {
        const url = new URL(process.env.NAJVA_SDK_URL || "");
        if (url.protocol === "https:" && /(^|\.)najva\.com$/.test(url.hostname) && !url.username && !url.password && !url.hash)
            sdk = url.href;
    }
    catch { }
    const push = live && !!process.env.NAJVA_API_KEY && !/[\r\n]/.test(process.env.NAJVA_API_KEY) && /^[1-9]\d{0,14}$/.test(process.env.NAJVA_WEBSITE_ID || "") && (!process.env.NAJVA_API_URL || process.env.NAJVA_API_URL === "https://push.najva.com/v1/send/token/");
    const csp = (najvaCspConfiguration)(process.env), sdkAllowed = !!sdk && csp.valid && csp.scriptOrigins.includes(new URL(sdk).origin) && csp.connectOrigins.length > 0;
    return { sms: { configured: live && smsKey && !!process.env.KAVENEGAR_SENDER, verification: live && smsKey && /^[A-Za-z0-9_-]{1,100}$/.test(process.env.KAVENEGAR_OTP_TEMPLATE || "") }, telegram: { configured: live && telegram, verification: live && telegram && /^[A-Za-z0-9_]{5,32}$/.test(process.env.TELEGRAM_BOT_USERNAME || "") && /^[A-Za-z0-9_-]{32,256}$/.test(process.env.TELEGRAM_WEBHOOK_SECRET || "") }, push: { configured: push, verification: push && sdkAllowed && !!(configuredNajvaWorker)() }, pushSdkUrl: sdk };
}
async function communicationRecipient(client: PoolClient, id: string) : Promise<CommunicationRecipient | null> {
    const row = (await client.query(`SELECT r.*,u.active AS user_active,s.preferences AS settings,s.profile,p.locale AS contact_locale,w.deleted_at,w.status FROM communication_recipients r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN user_settings s ON s.user_id=u.id LEFT JOIN crm_contact_profiles p ON p.record_id=r.contact_id LEFT JOIN workspace_entities w ON w.bucket='records' AND w.id=r.contact_id WHERE r.id=$1 AND r.active`, [id])).rows[0];
    if (!row || row.subject_type === "user" && !row.user_active || row.subject_type === "crm-contact" && (!row.contact_locale || row.deleted_at || !row.status || row.status === "archived"))
        return null;
    return { id: row.id, subjectType: row.subject_type, subjectId: row.subject_id, userId: row.user_id, contactId: row.contact_id, locale: row.subject_type === "user" ? language(row.settings?.language) : row.contact_locale, phone: row.subject_type === "user" ? normalizeCommunicationPhone(row.profile?.phone) : null };
}
async function ownedRecipient(client: PoolClient, actor: Actor) { const id = (await client.query("SELECT r.id FROM communication_recipients r JOIN users u ON u.id=r.user_id AND u.active WHERE r.subject_type='user' AND r.user_id=$1 AND r.active", [actor.id])).rows[0]?.id; (assert)(id, 401, "SESSION_REQUIRED", "Sign in to an active account."); const recipient = await communicationRecipient(client, id); (assert)(recipient, 401, "SESSION_REQUIRED", "Sign in to an active account."); return recipient; }
async function contactRecipient(client: PoolClient, actor: Actor, id: string, write = false) {
    actor = (await (domainContext)(client, actor)).actor;
    const record = await (domainRecord)(client, actor, id, "contacts");
    (requireContact)(actor);
    if (write)
        (domainPermission)(actor, record);
    const row = (await client.query("SELECT id FROM communication_recipients WHERE subject_type='crm-contact' AND contact_id=$1 AND active", [id])).rows[0];
    (assert)(row, 404, "NOT_FOUND", "Contact recipient not found.");
    const recipient = await communicationRecipient(client, row.id);
    (assert)(recipient && actor.allowedLocales.includes(recipient.locale), 404, "NOT_FOUND", "Contact recipient not found.");
    return { recipient, actor };
}
async function bindingContext(client: PoolClient, id: string, lock = false) : Promise<BindingContext | null> {
    const row = (await client.query("SELECT * FROM communication_bindings WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [id])).rows[0];
    if (!row)
        return null;
    const recipient = await communicationRecipient(client, row.recipient_id);
    if (!recipient)
        return null;
    let available = row.active, to = row.endpoint_encrypted ? (decrypt)(row.endpoint_encrypted) : null;
    if (to && (hash)(to) !== row.endpoint_hash)
        throw new HttpError(503, "COMMUNICATION_STORAGE", "Stored channel destination requires operator repair.");
    if (row.source_endpoint_id) {
        const source = (await client.query<PgRow<'crm_contact_endpoints'>>("SELECT * FROM crm_contact_endpoints WHERE id=$1 AND recipient_id=$2", [row.source_endpoint_id, row.recipient_id])).rows[0];
        available = available && !!source?.active && source.version === row.source_endpoint_version && (hash)(source.normalized_value) === row.source_value_hash && (row.channel === "sms" ? source.channel === "phone" && (!row.verified_at || !!source.verified_at) : !!source.verified_at);
    }
    else if (recipient.subjectType === "crm-contact")
        available = false;
    if (recipient.userId && row.channel === "sms")
        available = available && !!recipient.phone && (hash)(recipient.phone) === row.endpoint_hash;
    const checked=bindingPreferencesSchema.safeParse(row.preferences);(assert)(checked.success, 503, "NOTIFICATION_POLICY_INVALID", "Channel preferences require operator repair.");row.preferences=checked.data;
    return { row, recipient, available, to };
}
function bindingDto(context: BindingContext) { const { row, to, available } = context; return { id: row.id, channel: row.channel, provider: row.provider, maskedDestination: mask(row.channel, to), verified: !!row.verified_at, active: row.active, available, version: row.version, endpointVersion: row.endpoint_version, verifiedAt: row.verified_at?.toISOString() || null, createdAt: row.created_at.toISOString(), preferences: row.preferences }; }
async function directory(client: PoolClient, recipient: CommunicationRecipient) {
    const rows = (await client.query("SELECT id FROM communication_bindings WHERE recipient_id=$1 ORDER BY created_at DESC,id LIMIT 101", [recipient.id])).rows;
    (assert)(rows.length <= 100, 409, "CHANNEL_HISTORY_LIMIT", "This recipient requires operator review before adding more channel history.");
    const items = [];
    for (const item of rows) {
        const context = await bindingContext(client, item.id);
        if (context)
            items.push(bindingDto(context));
    }
    const phoneEndpoints = recipient.contactId ? (await client.query("SELECT id,normalized_value FROM crm_contact_endpoints WHERE contact_id=$1 AND recipient_id=$2 AND active AND channel='phone' ORDER BY created_at,id LIMIT 20", [recipient.contactId, recipient.id])).rows.map(endpoint => ({ id: endpoint.id, maskedDestination: mask("sms", normalizeCommunicationPhone(endpoint.normalized_value)) })) : void 0;
    return { items, capabilities: communicationCapabilities(), locale: recipient.locale, phoneAvailable: !!recipient.phone || !!phoneEndpoints?.length, ...phoneEndpoints ? { phoneEndpoints } : {} };
}
async function getCommunicationChannels(actor: Actor) { return (transaction)(async (client) => directory(client, await ownedRecipient(client, actor))); }
async function getContactChannels(actor: Actor, contactId: string) { return (transaction)(async (client) => directory(client, (await contactRecipient(client, actor, contactId)).recipient)); }
async function sourcePhone(client: PoolClient, recipient: CommunicationRecipient, endpointId?: string) {
    if (recipient.userId) {
        (assert)(recipient.phone, 422, "PHONE_PROFILE", "Save a valid international telephone number in your profile first.");
        return { to: recipient.phone, source: void 0 };
    }
    (assert)(endpointId && idSchema.safeParse(endpointId).success, 422, "PHONE_ENDPOINT", "Select the saved contact telephone endpoint.");
    const endpoint = (await client.query<PgRow<'crm_contact_endpoints'>>("SELECT * FROM crm_contact_endpoints WHERE id=$1 AND recipient_id=$2 AND active AND channel='phone' FOR UPDATE", [endpointId, recipient.id])).rows[0], phone = normalizeCommunicationPhone(endpoint?.normalized_value);
    (assert)(endpoint && phone, 422, "PHONE_ENDPOINT", "A saved international telephone endpoint is required.");
    return { to: phone, source: { id: endpoint.id, version: endpoint.version, valueHash: (hash)(endpoint.normalized_value) } };
}
const connectionSchema = z.object({ channel: z.enum(bindingChannels), endpointId: idSchema.optional(), pushToken: z.string().uuid().optional() }).strict();
async function connect(client: PoolClient, recipient: CommunicationRecipient, input: z.infer<typeof connectionSchema>, authoritySource?: AuthoritySource) {
    const capabilities = communicationCapabilities();
    (assert)(capabilities[input.channel].verification, 503, input.channel === "sms" ? "SMS_NOT_CONFIGURED" : input.channel === "telegram" ? "TELEGRAM_NOT_CONFIGURED" : "PUSH_NOT_CONFIGURED", "Configure the verified-channel provider before requesting proof.");
    (assert)(input.channel === "push" ? !!input.pushToken : input.pushToken === void 0, 422, "CHANNEL_FIELDS", "Use the fields for this channel only.");
    (assert)(input.channel === "sms" || input.endpointId === void 0, 422, "CHANNEL_FIELDS", "A telephone endpoint is only used for SMS.");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["communication-binding:" + recipient.id]);
    if (input.channel === "sms")
        await channelRate(client, recipient);
    const counts = (await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE active)::int AS active FROM communication_bindings WHERE recipient_id=$1", [recipient.id])).rows[0];
    (assert)(counts.total < 100 && counts.active < 20, 409, "CHANNEL_LIMIT", "Disconnect an unused channel before creating another.");
    let to = null, source = authoritySource;
    if (input.channel === "sms") {
        const phone = await sourcePhone(client, recipient, input.endpointId);
        to = phone.to;
        source = phone.source;
    }
    else if (input.channel === "push")
        to = input.pushToken!.toLowerCase();
    if (recipient.contactId)
        (assert)(source, 403, "RECIPIENT_PROOF", "A current verified recipient capability is required to connect this channel.");
    if (to) {
        const old = (await client.query("SELECT id FROM communication_bindings WHERE recipient_id=$1 AND channel=$2 AND endpoint_hash=$3 AND active", [recipient.id, input.channel, (hash)(to)])).rows[0];
        (assert)(!old, 409, "CHANNEL_EXISTS", "This destination already has an active connection. Review or disconnect it first.");
    }
    const id = (randomUUID)(), provider = input.channel === "sms" ? "kavenegar" : input.channel === "push" ? "najva" : "telegram";
    await client.query("INSERT INTO communication_bindings(id,recipient_id,channel,provider,endpoint_encrypted,endpoint_hash,source_endpoint_id,source_endpoint_version,source_value_hash,preferences) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)", [id, recipient.id, input.channel, provider, to ? (encrypt)(to) : null, to ? (hash)(to) : null, source?.id || null, source?.version || null, source?.valueHash || null, JSON.stringify(defaults())]);
    const raw = (randomBytes)(32).toString("hex"), digest = (hash)(raw), code = input.channel === "sms" ? String((randomInt)(0, 1e6)).padStart(6, "0") : null;
    const challenge = (await client.query<PgRow<'communication_binding_challenges'>>("INSERT INTO communication_binding_challenges(token_hash,binding_id,endpoint_version,channel,code_hash,locale,expires_at) VALUES($1,$2,1,$3,$4,$5,now()+interval '10 minutes') RETURNING *", [digest, id, input.channel, code ? otpHash(digest, code) : null, recipient.locale])).rows[0];
    const verificationUrl = `${(config)().siteUrl}/${recipient.locale}/communication-verification/${raw}/`;
    if (input.channel !== "telegram") {
        const payload = { to, locale: recipient.locale, purpose: "channel-verification", title: "Ideal Makoo", body: input.channel === "sms" ? code : notice(recipient.locale, "verify"), href: input.channel === "push" ? verificationUrl : void 0, otp: input.channel === "sms", code: code || void 0, communicationProof: { challengeHash: digest, bindingId: id, endpointVersion: 1, channel: input.channel } };
        await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id,crm_contact_id) VALUES($1,$2,$3::jsonb,$4,$5,$6)", [(randomUUID)(), input.channel, JSON.stringify({ encrypted: (encrypt)(JSON.stringify(payload)) }), "channel-proof:" + digest, recipient.userId, recipient.contactId]);
    }
    const context = await bindingContext(client, id);
    (assert)(context, 503, "COMMUNICATION_STORAGE", "Channel creation could not be read.");
    return { binding: bindingDto(context), status: "pending", expiresAt: challenge.expires_at.toISOString(), ...input.channel === "sms" ? { verificationUrl } : input.channel === "telegram" ? { telegramUrl: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${raw}` } : {} };
}
async function connectCommunicationChannel(actor: Actor, body: unknown) {
    const input = (parse)(connectionSchema, body);
    await (rateLimit)("channel-connect:" + actor.id, 10, 3600);
    return (transaction)(async (client) => {
        const recipient = await ownedRecipient(client, actor);
        if (input.channel === "sms")
            await channelRate(client, recipient);
        const result = await connect(client, recipient, input);
        await (audit)(actor.id, "communication.channel.proof_requested", "communication_binding", result.binding.id, { channel: input.channel }, client);
        return result;
    });
}
async function channelRate(client: PoolClient, recipient: CommunicationRecipient) { const count = (await client.query("SELECT count(*)::int AS count FROM communication_binding_challenges c JOIN communication_bindings b ON b.id=c.binding_id WHERE b.recipient_id=$1 AND c.channel='sms' AND c.created_at>now()-interval '1 hour'", [recipient.id])).rows[0].count; (assert)(count < 3, 429, "RATE_LIMITED", "Wait before requesting another SMS code."); }
async function requestContactChannel(actor: Actor, contactId: string, body: unknown) { const input = (parse)(z.object({ channel: z.literal("sms"), endpointId: idSchema }).strict(), body); await (rateLimit)("contact-channel:" + actor.id + ":" + contactId, 6, 3600); return (transaction)(async (client) => { const current = await contactRecipient(client, actor, contactId, true); await channelRate(client, current.recipient); const result = await connect(client, current.recipient, input); await (audit)(current.actor.id, "crm.channel.proof_requested", "communication_binding", result.binding.id, { channel: "sms" }, client); return result; }); }
async function ownedBinding(client: PoolClient, recipientId: string, id: string, lock = true) { (parse)(idSchema, id); const context = await bindingContext(client, id, lock); (assert)(context && context.row.recipient_id === recipientId, 404, "NOT_FOUND", "Communication channel not found."); return context; }
async function saveBindingPreferences(client: PoolClient, context: BindingContext, preferences: BindingPreferences, expected: number, source = "recipient-preferences") {
    const { row } = context;
    (assert)(row.version === expected, 409, "CONFLICT", "Channel settings changed. Reload before saving.");
    (assert)(context.available && row.verified_at, 409, "RECIPIENT_UNVERIFIED", "Verify the current destination before changing its delivery preferences.");
    for (const topic of communicationTopics)
        if (row.preferences.topics[topic].enabled !== preferences.topics[topic].enabled)
            await client.query("INSERT INTO communication_binding_consents(binding_id,recipient_id,endpoint_version,topic,accepted,source,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7)", [row.id, row.recipient_id, row.endpoint_version, topic, preferences.topics[topic].enabled, source, "communication-policy-v1"]);
    const updated = (await client.query<BindingRow>("UPDATE communication_bindings SET preferences=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [row.id, JSON.stringify(preferences)])).rows[0];
    await client.query("UPDATE notification_digest_items SET due_at=LEAST(due_at,now()) WHERE binding_id=$1 AND state='pending'", [row.id]);
    await (audit)(null, "communication.preferences.updated", "communication_binding", row.id, { version: updated.version }, client);
    return bindingDto({ ...context, row: updated });
}
async function updateCommunicationChannel(actor: Actor, id: string, body: unknown, version: number) { const input = (parse)(z.object({ preferences: bindingPreferencesSchema }).strict(), body); return (transaction)(async (client) => { const recipient = await ownedRecipient(client, actor); return saveBindingPreferences(client, await ownedBinding(client, recipient.id, id), input.preferences, version); }); }
async function revoke(client: PoolClient, context: BindingContext, version: number) {
    const { row } = context;
    (assert)(row.version === version, 409, "CONFLICT", "Channel settings changed. Reload before disconnecting.");
    if (!row.active)
        return bindingDto(context);
    for (const topic of communicationTopics)
        if (row.preferences.topics[topic].enabled)
            await client.query("INSERT INTO communication_binding_consents(binding_id,recipient_id,endpoint_version,topic,accepted,source,policy_version) VALUES($1,$2,$3,$4,false,'recipient-revoked','communication-policy-v1')", [row.id, row.recipient_id, row.endpoint_version, topic]);
    const updated = (await client.query<BindingRow>("UPDATE communication_bindings SET active=false,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [row.id])).rows[0];
    await client.query("UPDATE communication_binding_challenges SET revoked_at=now() WHERE binding_id=$1 AND revoked_at IS NULL", [row.id]);
    await client.query("UPDATE communication_preference_tokens SET revoked_at=now() WHERE binding_id=$1 AND revoked_at IS NULL", [row.id]);
    await (audit)(null, "communication.channel.revoked", "communication_binding", row.id, {}, client);
    return bindingDto({ ...context, row: updated, available: false });
}
async function revokeCommunicationChannel(actor: Actor, id: string, version: number) { return (transaction)(async (client) => { const recipient = await ownedRecipient(client, actor); return revoke(client, await ownedBinding(client, recipient.id, id), version); }); }
async function challengeFor(client: PoolClient, raw: string, lock = false) { (parse)(tokenSchema, raw); const challenge = (await client.query("SELECT * FROM communication_binding_challenges WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()" + (lock ? " FOR UPDATE" : ""), [(hash)(raw)])).rows[0]; (assert)(challenge, 404, "COMMUNICATION_LINK", "This verification link is invalid, expired or revoked."); const context = await bindingContext(client, challenge.binding_id, lock); (assert)(context?.available && context.row.channel === challenge.channel && context.row.endpoint_version === challenge.endpoint_version && context.recipient.locale === challenge.locale, 404, "COMMUNICATION_LINK", "The destination changed. Request a new verification link."); return { challenge, context }; }
async function bindingPreferenceToken(client: PoolClient, context: BindingContext, scope: PreferenceScope = "preferences", outboxId: string | null = null) { (assert)(context.available && context.row.verified_at && context.row.endpoint_hash, 409, "RECIPIENT_UNVERIFIED", "The current verified destination is required."); const raw = (randomBytes)(32).toString("hex"); await client.query("INSERT INTO communication_preference_tokens(token_hash,recipient_id,binding_id,endpoint_version,value_hash,scope,locale,outbox_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+($9*interval '1 day'))", [(hash)(raw), context.recipient.id, context.row.id, context.row.endpoint_version, context.row.endpoint_hash, scope, context.recipient.locale, outboxId, scope === "preferences" ? 7 : 30]); return raw; }
async function finishProof(client: PoolClient, challenge: PgRow<'communication_binding_challenges'>, context: BindingContext, to?: string) {
    (assert)(!challenge.consumed_at && !context.row.verified_at, 409, "PROOF_USED", "This proof has already been confirmed.");
    const destination = to || context.to;
    (assert)(destination, 422, "RECIPIENT", "The channel destination is unavailable.");
    if (context.recipient.contactId && context.row.channel === "sms" && context.row.source_endpoint_id)
        await client.query("UPDATE crm_contact_endpoints SET verified_at=now(),updated_at=now() WHERE id=$1 AND recipient_id=$2 AND version=$3", [context.row.source_endpoint_id, context.recipient.id, context.row.source_endpoint_version]);
    const updated = (await client.query<BindingRow>("UPDATE communication_bindings SET endpoint_encrypted=COALESCE(endpoint_encrypted,$2),endpoint_hash=COALESCE(endpoint_hash,$3),verified_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [context.row.id, (encrypt)(destination), (hash)(destination)])).rows[0];
    await client.query("UPDATE communication_binding_challenges SET consumed_at=now() WHERE token_hash=$1", [challenge.token_hash]);
    await (audit)(null, "communication.channel.verified", "communication_binding", context.row.id, { channel: context.row.channel, endpointVersion: context.row.endpoint_version }, client);
    return { ...context, row: updated, to: destination };
}
async function communicationVerificationResponse(request: Request, raw: string) {
    await (rateLimit)("communication-proof:" + (visitorKey)(request), 80, 900);
    if (request.method === "GET")
        return (transaction)(async (client) => { const { challenge, context } = await challengeFor(client, raw); const view = { locale: challenge.locale, channel: challenge.channel, maskedDestination: mask(challenge.channel, context.to), expiresAt: challenge.expires_at.toISOString(), csrfToken: communicationCsrf(raw), status: challenge.consumed_at ? "verified" : "pending" }; return (json)(view, 200, headers); });
    (assert)(request.method === "PATCH", 405, "METHOD", "Use GET or PATCH.");
    assertCommunicationCsrf(request, raw);
    const input = (parse)(z.object({ code: z.string().regex(/^\d{6}$/).optional(), confirm: z.literal(true) }).strict(), await (readJson)(request, 4096));
    await (rateLimit)("communication-proof-attempt:" + (hash)(raw), 10, 600);
    const outcome = await (transaction)(async (client) => {
        const { challenge, context } = await challengeFor(client, raw, true);
        (assert)(challenge.channel !== "telegram", 422, "TELEGRAM_PROOF", "Confirm the private conversation through the configured Telegram bot.");
        (assert)(!challenge.consumed_at && challenge.attempts < 5, 409, "PROOF_USED", "This proof has expired or has already been confirmed.");
        if (challenge.channel === "sms" && (!input.code || !(equal)(challenge.code_hash || "", otpHash(challenge.token_hash, input.code)))) {
            await client.query("UPDATE communication_binding_challenges SET attempts=attempts+1 WHERE token_hash=$1", [challenge.token_hash]);
            return { wrong: true };
        }
        const verified = await finishProof(client, challenge, context), token = await bindingPreferenceToken(client, verified);
        return { wrong: false, preferenceUrl: `${(config)().siteUrl}/${verified.recipient.locale}/communication-preferences/${token}/`, status: "verified" };
    });
    (assert)(!outcome.wrong, 422, "VERIFICATION_CODE", "The code is incorrect.");
    return (json)({ status: outcome.status, preferenceUrl: outcome.preferenceUrl }, 200, headers);
}
async function telegramVerificationWebhook(request: Request) {
    (assert)(request.method === "POST", 405, "METHOD", "Use POST.");
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
    (assert)(/^[A-Za-z0-9_-]{32,256}$/.test(secret) && (equal)(secret, request.headers.get("x-telegram-bot-api-secret-token") || ""), 403, "TELEGRAM_WEBHOOK", "Invalid Telegram webhook authentication.");
    await (rateLimit)("telegram-webhook:" + (visitorKey)(request), 1e3, 60);
    const payload = await (readJson)(request, 65536);
    const parsed = z.object({ update_id: z.number().int().nonnegative(), message: z.object({ message_id: z.number().int(), text: z.string().max(4096).optional(), chat: z.object({ id: z.number().int().safe(), type: z.string() }), from: z.object({ id: z.number().int().safe(), is_bot: z.boolean() }).optional() }).optional() }).passthrough().safeParse(payload);
    (assert)(parsed.success, 422, "TELEGRAM_UPDATE", "Invalid Telegram update.");
    const message = parsed.data.message, raw = message?.text?.match(/^\/start(?:@[A-Za-z0-9_]+)? ([a-f0-9]{64})$/)?.[1];
    if (!raw || message?.chat.type !== "private" || !message.from || message.from.is_bot || message.from.id !== message.chat.id || message.chat.id <= 0)
        return (json)({ ok: true });
    await (transaction)(async (client) => {
        let proof;
        try {
            proof = await challengeFor(client, raw, true);
        }
        catch (error) {
            if (error instanceof HttpError && error.status === 404)
                return;
            throw error;
        }
        const { challenge, context } = proof;
        if (challenge.channel !== "telegram" || challenge.consumed_at)
            return;
        const to = String(message.chat.id), existing = await client.query("SELECT 1 FROM communication_bindings WHERE recipient_id=$1 AND channel='telegram' AND endpoint_hash=$2 AND active AND id<>$3", [context.recipient.id, (hash)(to), context.row.id]);
        if (existing.rowCount) {
            await client.query("UPDATE communication_binding_challenges SET revoked_at=now() WHERE token_hash=$1", [challenge.token_hash]);
            return;
        }
        const verified = await finishProof(client, challenge, context, to), token = await bindingPreferenceToken(client, verified), body = notice(verified.recipient.locale, "verified") + "\n" + (config)().siteUrl + "/" + verified.recipient.locale + "/communication-preferences/" + token + "/";
        const noticePayload = { to, body, purpose: "channel-verification", locale: verified.recipient.locale, communicationConfirmed: { bindingId: verified.row.id, endpointVersion: verified.row.endpoint_version, valueHash: verified.row.endpoint_hash, tokenHash: (hash)(token) } };
        await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id,crm_contact_id) VALUES($1,'telegram',$2::jsonb,$3,$4,$5) ON CONFLICT(dedupe_key) DO NOTHING", [(randomUUID)(), JSON.stringify({ encrypted: (encrypt)(JSON.stringify(noticePayload)) }), "telegram-verified:" + challenge.token_hash, verified.recipient.userId, verified.recipient.contactId]);
    });
    return (json)({ ok: true });
}
async function canDeliverCommunicationProof(client: PoolClient, payload: NotificationPayload, channel: string) {
    const proof = z.object({ challengeHash: tokenSchema, bindingId: idSchema, endpointVersion: z.number().int().positive(), channel: z.enum(bindingChannels) }).strict().safeParse(payload.communicationProof);
    if (!proof.success || channel !== proof.data.channel)
        return false;
    const value = proof.data, challenge = (await client.query<PgRow<'communication_binding_challenges'>>("SELECT * FROM communication_binding_challenges WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() AND attempts<5", [value.challengeHash])).rows[0], context = await bindingContext(client, value.bindingId);
    return !!challenge && !!context?.available && !context.row.verified_at && challenge.binding_id === context.row.id && challenge.endpoint_version === value.endpointVersion && context.row.endpoint_version === value.endpointVersion && context.row.channel === channel && context.recipient.locale === challenge.locale && context.to === payload.to && context.recipient.locale === payload.locale && (channel !== "sms" || typeof payload.code === "string" && (equal)(challenge.code_hash || "", otpHash(challenge.token_hash, payload.code)));
}
async function canDeliverCommunicationConfirmation(client: PoolClient, payload: NotificationPayload, channel: string) {
    const notice2 = z.object({ bindingId: idSchema, endpointVersion: z.number().int().positive(), valueHash: tokenSchema, tokenHash: tokenSchema }).strict().safeParse(payload.communicationConfirmed);
    if (!notice2.success)
        return false;
    const context = await bindingContext(client, notice2.data.bindingId);
    return !!context?.available && !!context.row.verified_at && context.row.channel === channel && context.row.endpoint_version === notice2.data.endpointVersion && context.row.endpoint_hash === notice2.data.valueHash && context.to === payload.to && !!(await client.query("SELECT 1 FROM communication_preference_tokens WHERE token_hash=$1 AND binding_id=$2 AND recipient_id=$3 AND revoked_at IS NULL AND expires_at>now()", [notice2.data.tokenHash, context.row.id, context.recipient.id])).rowCount;
}
async function resolveBindingPreferenceCapability(client: PoolClient, raw: string, scope: PreferenceScope | undefined = void 0, lock = false) { (parse)(tokenSchema, raw); const token = (await client.query("SELECT * FROM communication_preference_tokens WHERE token_hash=$1 AND binding_id IS NOT NULL AND revoked_at IS NULL AND expires_at>now()" + (lock ? " FOR UPDATE" : ""), [(hash)(raw)])).rows[0]; (assert)(token && (!scope || token.scope === scope), 404, "COMMUNICATION_LINK", "This link is invalid, expired or revoked."); const context = await bindingContext(client, token.binding_id, lock); (assert)(context?.available && context.row.verified_at && context.row.recipient_id === token.recipient_id && context.row.endpoint_version === token.endpoint_version && context.row.endpoint_hash === token.value_hash && context.recipient.locale === token.locale, 404, "COMMUNICATION_LINK", "The verified destination changed. Request a new link."); return { token, context }; }
async function preferenceMessages(client: PoolClient, token: BoundPreferenceToken, context: BindingContext) {
    if (!token.outbox_id || context.row.channel !== "push")
        return void 0;
    const rows = (await client.query(`SELECT o.payload FROM outbox o WHERE o.state='delivered' AND (o.id=$1 OR EXISTS(SELECT 1 FROM notification_digest_items d WHERE d.digest_outbox_id=$1 AND d.outbox_id=o.id AND d.state='delivered' AND d.binding_id=$2 AND d.recipient_id=$3)) AND (o.account_id=$4 OR o.crm_contact_id=$5) ORDER BY o.created_at,o.id LIMIT 20`, [token.outbox_id, context.row.id, context.recipient.id, context.recipient.userId, context.recipient.contactId])).rows;
    return rows.flatMap(row => {
        const payload = typeof row.payload.encrypted === "string" ? JSON.parse((decrypt)(row.payload.encrypted)) : row.payload, ref = payload.channelBinding;
        if (payload.recipientId !== context.recipient.id || ref?.bindingId !== context.row.id || ref?.endpointVersion !== context.row.endpoint_version || typeof payload.title !== "string" || typeof payload.body !== "string" || typeof payload.href !== "string" || !payload.href.startsWith("/" + context.recipient.locale + "/") || /[\\\x00-\x20\x7f]/.test(payload.href))
            return [];
        return [{ title: payload.title.slice(0, 200), body: payload.body.slice(0, 1e4), href: payload.href }];
    });
}
async function getBindingPreferenceView(raw: string) { return (transaction)(async (client) => { const { token, context } = await resolveBindingPreferenceCapability(client, raw), messages = await preferenceMessages(client, token, context); return { locale: token.locale, channel: context.row.channel, bindingId: context.row.id, maskedDestination: mask(context.row.channel, context.to), version: context.row.version, preferences: context.row.preferences, expiresAt: token.expires_at.toISOString(), csrfToken: communicationCsrf(raw), scope: token.scope, ...messages?.length ? { messages } : {} }; }); }
async function patchBindingPreferenceView(raw: string, body: unknown) { const input = (parse)(z.object({ expectedVersion: z.number().int().positive(), preferences: bindingPreferencesSchema }).strict(), body); return (transaction)(async (client) => { const { context } = await resolveBindingPreferenceCapability(client, raw, "preferences", true); await saveBindingPreferences(client, context, input.preferences, input.expectedVersion); }); }
async function unsubscribeBinding(raw: string) {
    return (transaction)(async (client) => {
        const { token, context } = await resolveBindingPreferenceCapability(client, raw, "unsubscribe", true);
        if (token.consumed_at)
            return true;
        const value = structuredClone(context.row.preferences);
        for (const topic of ["products", "research", "events", "content"] as const)
            value.topics[topic].enabled = false;
        await saveBindingPreferences(client, context, value, context.row.version, "recipient-unsubscribe");
        await client.query("UPDATE communication_preference_tokens SET consumed_at=now() WHERE token_hash=$1", [token.token_hash]);
        return true;
    });
}
async function capabilityRecipient(client: PoolClient, raw: string) {
    const row = (await client.query("SELECT binding_id FROM communication_preference_tokens WHERE token_hash=$1 AND scope='preferences' AND revoked_at IS NULL AND expires_at>now()", [(hash)(raw)])).rows[0];
    (assert)(row, 404, "COMMUNICATION_LINK", "This link is invalid, expired or revoked.");
    if (row.binding_id) {
        const { context } = await resolveBindingPreferenceCapability(client, raw, "preferences");
        return { recipient: context.recipient, source: context.row.source_endpoint_id ? { id: context.row.source_endpoint_id, version: context.row.source_endpoint_version, valueHash: context.row.source_value_hash } : void 0 };
    }
    const { resolveContactPreferenceCapability } = await import("./contact-notifications"), proof = await resolveContactPreferenceCapability(client, raw);
    const recipient = await communicationRecipient(client, proof.recipientId);
    (assert)(recipient, 404, "COMMUNICATION_LINK", "Recipient unavailable.");
    return { recipient, source: { id: proof.endpointId, version: proof.endpointVersion, valueHash: proof.valueHash } };
}
async function communicationPreferenceChannelsResponse(request: Request, raw: string, id?: string) {
    (parse)(tokenSchema, raw);
    await (rateLimit)("communication-capability-channels:" + (visitorKey)(request), 120, 900);
    if (request.method !== "GET")
        assertCommunicationCsrf(request, raw);
    const body = request.method === "POST" || request.method === "PATCH" ? await (readJson)(request, 32768) : void 0;
    const result = await (transaction)(async (client) => {
        const proof = await capabilityRecipient(client, raw);
        if (request.method === "GET" && !id)
            return directory(client, proof.recipient);
        if (request.method === "POST" && !id) {
            const input2 = (parse)(connectionSchema, body);
            if (input2.channel === "sms")
                await channelRate(client, proof.recipient);
            return connect(client, proof.recipient, input2, proof.source);
        }
        (assert)(id, 404, "NOT_FOUND", "Communication channel not found.");
        const context = await ownedBinding(client, proof.recipient.id, id);
        if (request.method === "DELETE")
            return revoke(client, context, (expectedVersion)(request));
        (assert)(request.method === "PATCH", 405, "METHOD", "Use GET, POST, PATCH or DELETE.");
        const input = (parse)(z.object({ preferences: bindingPreferencesSchema }).strict(), body);
        return saveBindingPreferences(client, context, input.preferences, (expectedVersion)(request));
    });
    return (json)(result, request.method === "POST" ? 202 : 200, headers);
}
async function captureBoundEndpoints(client: PoolClient, recipientId: string, channels: readonly string[], topic: CommunicationTopic) : Promise<BindingReference[]> {
    const rows = (await client.query("SELECT id FROM communication_bindings WHERE recipient_id=$1 AND active AND verified_at IS NOT NULL AND channel=ANY($2::text[]) ORDER BY created_at,id LIMIT 21", [recipientId, channels.filter(channel => bindingChannels.includes(channel as BindingChannel))])).rows;
    (assert)(rows.length <= 20, 503, "RECIPIENT_ENDPOINT_LIMIT", "The recipient channel directory requires operator review.");
    const result: BindingReference[] = [];
    for (const row of rows) {
        const context = await bindingContext(client, row.id);
        if (!context?.available || !context.row.endpoint_hash || result.some(ref => ref.channel === context.row.channel))
            continue;
        try {
            await bindingConsent(client, context, topic);
            result.push({ channel: context.row.channel, bindingId: context.row.id, endpointVersion: context.row.endpoint_version, valueHash: context.row.endpoint_hash });
        }
        catch (error) {
            if (!(error instanceof HttpError && error.status === 409))
                throw error;
        }
    }
    return result;
}
async function bindingConsent(client: PoolClient, context: BindingContext, topic: CommunicationTopic) { (assert)(context.available && context.row.verified_at && context.to, 409, "RECIPIENT_UNVERIFIED", "The current verified channel is required."); (assert)(context.row.preferences.topics[topic]?.enabled, 409, "CONSENT_REVOKED", "The recipient disabled this topic for this channel."); const consent = (await client.query("SELECT accepted,endpoint_version FROM communication_binding_consents WHERE binding_id=$1 AND topic=$2 ORDER BY id DESC LIMIT 1", [context.row.id, topic])).rows[0]; (assert)(consent?.accepted && consent.endpoint_version === context.row.endpoint_version, 409, "CONSENT_REVOKED", "This endpoint version does not have current topic consent."); }
async function resolveBoundDelivery(client: PoolClient, recipientId: string, reference: BindingReference, topic: CommunicationTopic) { const context = await bindingContext(client, reference.bindingId); (assert)(context && context.row.recipient_id === recipientId && context.row.channel === reference.channel && context.row.endpoint_version === reference.endpointVersion && context.row.endpoint_hash === reference.valueHash, 409, "RECIPIENT_MISMATCH", "The saved channel destination changed."); await bindingConsent(client, context, topic); return context; }
export { assertCommunicationCsrf, bindingChannels, bindingConsent, bindingContext, bindingPreferenceToken, bindingPreferencesSchema, canDeliverCommunicationConfirmation, canDeliverCommunicationProof, captureBoundEndpoints, communicationCapabilities, communicationCsrf, communicationPreferenceChannelsResponse, communicationRecipient, communicationTopics, communicationVerificationResponse, connectCommunicationChannel, getBindingPreferenceView, getCommunicationChannels, getContactChannels, normalizeCommunicationPhone, patchBindingPreferenceView, requestContactChannel, resolveBindingPreferenceCapability, resolveBoundDelivery, revokeCommunicationChannel, telegramVerificationWebhook, unsubscribeBinding, updateCommunicationChannel };
