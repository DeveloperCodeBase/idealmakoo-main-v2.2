import {bindNotificationTemplate,templateDeliveryPayload} from './notification-templates';
import type { PgRow } from './recovered-db-rows';
import type { Locale } from '../lib/i18n';
import type { BindingReference, CommunicationTopic } from './communication-channels';
import type { NotificationPayload, NotificationDecision, PolicyOutboxRow, PreparedNotification } from './notification-policy';
export interface BoundNotificationInput {staffAlert?:boolean;staffAlertReference?:string;staffAlertKind?:string;imageUrl?:string;topic:CommunicationTopic;purpose:'transactional'|'marketing';title:string;body:string;href?:string;campaignDeliveryId?:string;publicationEventId?:string;resourcePublicationEventId?:string;senderId?:string;senderRequestId?:string;senderLocale?:Locale;crmRecordId?:string;requestId?:string}

import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { parse } from "./http";
import { decrypt, encrypt } from "./crypto";
import { resolveBoundDelivery, communicationTopics } from "./communication-channels";
import { randomUUID } from "node:crypto";
import { assert, HttpError } from "./types";
import { quietHoursEnd, nextDigestAt } from "./notification-policy";
import { config } from "./config";
const referenceSchema = z.object({ channel: z.enum(["sms", "telegram", "push"]), bindingId: z.string().uuid(), endpointVersion: z.number().int().positive(), valueHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const boundReference = (value: unknown) => (parse)(referenceSchema, value);
const decode = (value: NotificationPayload) : NotificationPayload => typeof value.encrypted === "string" ? JSON.parse((decrypt)(value.encrypted)) : value;
async function enqueueBoundNotification(client: PoolClient, recipientId: string, reference: BindingReference, input: BoundNotificationInput, dedupeKey: string) { const context = await (resolveBoundDelivery)(client, recipientId, reference, input.topic), id = (randomUUID)(); (assert)(context.to, 409, "RECIPIENT_UNVERIFIED", "The verified destination is unavailable."); const payload = { ...input, recipientId, ...context.recipient.userId ? { userId: context.recipient.userId } : {}, ...context.recipient.contactId ? { contactId: context.recipient.contactId } : {}, channelBinding: reference, to: context.to, locale: context.recipient.locale, subject: input.title, text: input.body }; const result = await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id,crm_contact_id) VALUES($1,$2,$3::jsonb,$4,$5,$6) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id", [id, reference.channel, JSON.stringify({ encrypted: (encrypt)(JSON.stringify(payload)) }), dedupeKey, context.recipient.userId, context.recipient.contactId]); if(result.rows[0]?.id&&input.purpose==='transactional')await bindNotificationTemplate(client,id,{key:'transactional_message',locale:context.recipient.locale}); return result.rows[0]?.id || null; }
async function decide(client: PoolClient, outboxId: string, channel: string, payload: NotificationPayload, at: Date, created: Date, digest = false) : Promise<NotificationDecision> {
    try {
        const reference = boundReference(payload.channelBinding);
        (assert)(reference.channel === channel && typeof payload.recipientId === "string" && communicationTopics.includes(payload.topic as CommunicationTopic), 409, "RECIPIENT_MISMATCH", "A typed verified channel delivery is required.");
        const context = await (resolveBoundDelivery)(client, payload.recipientId, reference, payload.topic as CommunicationTopic);
        (assert)(context.to === payload.to && context.recipient.locale === payload.locale && (context.recipient.userId ? payload.userId === context.recipient.userId && payload.contactId === void 0 : payload.contactId === context.recipient.contactId && payload.userId === void 0), 409, "RECIPIENT_MISMATCH", "The saved recipient identity changed.");
        let allowed = false;
        if(payload.staffAlert){allowed=await (await import('./staff-alerts')).canDeliverStaffAlert(client,payload);}
        else if (payload.campaignDeliveryId) {
            const { campaignDeliveryPermitted } = await import("./crm-campaigns");
            allowed = await campaignDeliveryPermitted(client, outboxId, channel, payload);
        }
        else if (payload.publicationEventId) {
            const { publicationBoundDeliveryPermitted } = await import("./notification-publications");
            allowed = await publicationBoundDeliveryPermitted(client, payload, channel);
        }
        else if(payload.resourcePublicationEventId){
            allowed=await (await import('./notification-resources')).resourceBoundDeliveryPermitted(client,payload,channel);
        }
        else if (payload.senderId) {
            const { manualBoundDeliveryPermitted } = await import("./crm-audience");
            allowed = await manualBoundDeliveryPermitted(client, payload, channel);
        }
        (assert)(allowed, 409, "RECIPIENT_SCOPE_REVOKED", "The current sender no longer has permission for this recipient.");
        const selected = context.row.preferences.topics[payload.topic as CommunicationTopic];
        if (selected.frequency !== "instant") {
            const until2 = (quietHoursEnd)((nextDigestAt)(created, selected.frequency, context.row.preferences.timezone), selected, context.row.preferences.timezone);
            if (!digest)
                return { action: "batch", until: until2, frequency: selected.frequency };
            if (until2 > at)
                return { action: "defer", until: until2, code: "DIGEST_SCHEDULE" };
        }
        const until = (quietHoursEnd)(at, selected, context.row.preferences.timezone);
        if (until > at)
            return { action: "defer", until, code: "QUIET_HOURS" };
        return { action: "send", payload, marketing: payload.purpose === "marketing" };
    }
    catch (error) {
        if (error instanceof HttpError && [401, 403, 404, 409, 422].includes(error.status))
            return { action: "cancel", code: error.code };
        throw error;
    }
}
async function handle(client: PoolClient, row: PolicyOutboxRow, decision: Exclude<NotificationDecision,{action:'send'}>, payload: NotificationPayload) {
    if (decision.action === "cancel") {
        const changed = await client.query("UPDATE outbox SET state='cancelled',completed_at=now(),last_error=$3,lock_token=NULL WHERE id=$1 AND lock_token=$2 AND state='running' RETURNING id", [row.id, row.lock_token, decision.code]);
        if (changed.rowCount)
            await client.query("INSERT INTO delivery_events(outbox_id,provider,status,detail) VALUES($1,$2,$3,$4)", [row.id, "policy", "suppressed", decision.code]);
    }
    else if (decision.action === "defer")
        await client.query("UPDATE outbox SET state='pending',available_at=$3,attempts=GREATEST(attempts-1,0),lock_token=NULL,last_error=$4 WHERE id=$1 AND lock_token=$2 AND state='running'", [row.id, row.lock_token, decision.until, decision.code]);
    else {
        const reference = boundReference(payload.channelBinding);
        await client.query("INSERT INTO notification_digest_items(outbox_id,user_id,recipient_id,binding_id,endpoint_version,channel,topic,frequency,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(outbox_id) DO NOTHING", [row.id, payload.userId || null, payload.recipientId, reference.bindingId, reference.endpointVersion, reference.channel, payload.topic, decision.frequency, decision.until]);
        await client.query("UPDATE outbox SET state='batched',attempts=GREATEST(attempts-1,0),lock_token=NULL,last_error=NULL WHERE id=$1 AND lock_token=$2 AND state='running'", [row.id, row.lock_token]);
        await client.query("INSERT INTO delivery_events(outbox_id,provider,status) VALUES($1,$2,$3)", [row.id, "digest", "queued"]);
    }
}
async function prepareBoundNotification(client: PoolClient, row: PolicyOutboxRow, payload: NotificationPayload, at: Date, created: Date) : Promise<PreparedNotification> {
    const decision = await decide(client, row.id, row.kind, payload, at, created);
    if (decision.action === "send")
        return decision;
    await handle(client, row, decision, payload);
    return { action: "handled" };
}
function messageText(source: NotificationPayload, channel: string, index: number) {
    return `${index + 1}. ${String(source.title || "")}
${String(source.body || "")}` + (channel === "push" ? "" : `
${(config)().siteUrl}${String(source.href || "/")}`);
}
async function partitionBoundDigest(client: PoolClient, items: PgRow<'notification_digest_items'>[]) {
    const rows = (await client.query("SELECT id,payload FROM outbox WHERE id=ANY($1::text[])", [items.map(item => item.outbox_id)])).rows, map = new Map(rows.map(row => [row.id, decode(row.payload)])), limit = items[0]?.channel === "sms" ? 1300 : items[0]?.channel === "telegram" ? 3300 : 900, chunks = [];
    let current = [], length = 0;
    for (const item of items) {
        const size = [...messageText(await templateDeliveryPayload(client,map.get(item.outbox_id) || {},item.outbox_id,item.channel), item.channel, current.length)].length + 2;
        if (current.length && (current.length >= 20 || length + size > limit)) {
            chunks.push(current);
            current = [];
            length = 0;
        }
        current.push(item);
        length += size;
    }
    if (current.length)
        chunks.push(current);
    return chunks;
}
async function prepareBoundDigest(client: PoolClient, row: PolicyOutboxRow, payload: NotificationPayload, at: Date) : Promise<PreparedNotification> {
    const members = (await client.query(`SELECT d.outbox_id,o.payload,o.created_at FROM notification_digest_items d JOIN outbox o ON o.id=d.outbox_id WHERE d.digest_outbox_id=$1 AND d.state='batched' AND o.state='batched' AND d.binding_id=$2 AND d.recipient_id=$3 AND d.endpoint_version=$4 ORDER BY d.created_at,d.outbox_id FOR UPDATE OF d,o`, [row.id, payload.bindingId, payload.recipientId, payload.endpointVersion])).rows, ready = [];
    for (const member of members) {
        const source = decode(member.payload), reference = boundReference(source.channelBinding), same = source.recipientId === payload.recipientId && reference.bindingId === payload.bindingId && reference.endpointVersion === payload.endpointVersion && reference.channel === row.kind, decision: NotificationDecision = same ? await decide(client, member.outbox_id, row.kind, source, at, member.created_at, true) : { action: "cancel", code: "RECIPIENT_MISMATCH" };
        if (decision.action === "cancel") {
            await client.query("UPDATE notification_digest_items SET state='cancelled',completed_at=now() WHERE outbox_id=$1", [member.outbox_id]);
            await client.query("UPDATE outbox SET state='cancelled',last_error=$2,completed_at=now() WHERE id=$1 AND state='batched'", [member.outbox_id, decision.code]);
            await client.query("INSERT INTO delivery_events(outbox_id,provider,status,detail) VALUES($1,$2,$3,$4)", [member.outbox_id, "policy", "suppressed", decision.code]);
        }
        else if (decision.action === "defer")
            await client.query("UPDATE notification_digest_items SET state='pending',digest_outbox_id=NULL,due_at=$2 WHERE outbox_id=$1", [member.outbox_id, decision.until]);
        else if (decision.action === "send")
            ready.push(await templateDeliveryPayload(client,decision.payload,member.outbox_id,row.kind));
    }
    if (!ready.length) {
        await handle(client, row, { action: "cancel", code: "DIGEST_EMPTY" }, payload);
        return { action: "handled" };
    }
    const first = ready[0], locale = String(first.locale) as Locale, title = { fa: "\u062E\u0644\u0627\u0635\u0647 \u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u0627\u0646\u062A\u062E\u0627\u0628\u06CC", en: "Your selected message digest", tr: "Se\xE7ti\u011Finiz mesaj \xF6zeti", ar: "\u0645\u0644\u062E\u0635 \u0627\u0644\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0645\u062E\u062A\u0627\u0631\u0629", ru: "\u0421\u0432\u043E\u0434\u043A\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0445 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439" }[locale] || "Message digest", body = ready.map((source, index) => messageText(source, row.kind, index)).join("\n\n");
    return { action: "send", marketing: ready.some(source => source.purpose === "marketing"), payload: { ...first, purpose: "digest", title, subject: title, body, text: body, href: void 0, boundDigest: true, campaignDeliveryId: void 0 } };
}
export { boundReference, enqueueBoundNotification, partitionBoundDigest, prepareBoundDigest, prepareBoundNotification };
