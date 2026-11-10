import {products,articles} from '../data/catalog';
import type {LocalPublication} from '../data/workspace-seed';
import type {PgRow} from './recovered-db-rows';
import type {Actor} from './types';
import type {Locale} from '../lib/i18n';
import type {NotificationPayload} from './notification-policy';
type PublicationEvent=PgRow<'notification_publication_events'>;
type CurrentPublicationEvent=PublicationEvent & {publication:LocalPublication;role:Actor['role'];allowed_locales:Locale[];active:boolean;mfa_enabled:boolean};
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { publicationPath } from "../lib/publication-path";
import { canWorkspace } from "../lib/auth";
import { isRecipientCampaignSuppressed } from "./crm-audience";
import { hash, encrypt } from "./crypto";
import { assert } from "./types";
import { transaction, audit } from "./db";
import { enqueueAccountNotification } from "./notification-policy";
import { captureBoundEndpoints } from "./communication-channels";
import { enqueueBoundNotification } from "./binding-notifications";
import { randomUUID } from "node:crypto";
import {publicNoticePublicationVisible} from './workspace-public-notices';
import {parsePublishedPublicNotice} from '../lib/public-notices';
const topicFor = (kind: string) : 'products'|'research'|'events'|'content'|null => ["product", "products"].includes(kind) ? "products" : ["event", "events"].includes(kind) ? "events" : ["research","article","articles"].includes(kind) ? "research" : ["news","page","resources","resource","hr","knowledge","glossary"].includes(kind)?"content":null;
function channelConfiguration() { const to = process.env.TELEGRAM_CHANNEL_ID || "", locales = (process.env.TELEGRAM_CHANNEL_LOCALES || "fa").split(",").map(value => value.trim()); return process.env.NOTIFICATIONS_MODE === "live" && !!process.env.TELEGRAM_BOT_TOKEN && /^-[1-9]\d{0,18}$/.test(to) && locales.length <= 5 && locales.every(value => ["fa", "en", "tr", "ar", "ru"].includes(value)) ? { to, locales } : null; }
const excerpt = (value: string, size: number) => { const chars = [...value]; return chars.length > size ? chars.slice(0, size - 1).join("") + "\u2026" : value; };
function publicationImage(publication:LocalPublication){return publication.blocks.find(block=>!block.hidden&&['image','hero'].includes(block.type)&&block.mediaUrl)?.mediaUrl||publication.productRelease?.gallery[0]?.url||publication.customProduct?.image||products.find(row=>row.id===(publication.productRelease?.productId||publication.id))?.image||articles.find(row=>row.id===publication.id)?.image;}
function publicMessage(publication: LocalPublication, event: Pick<PublicationEvent,'locale'>) { const path=publicationPath(publication);return { title: excerpt(publication.title, 100), body: excerpt(publication.summary || publication.title, 300), href: '/' + event.locale + '/' + path + (path?'/':''),imageUrl:publicationImage(publication) }; }
async function currentPublicEvent(client: PoolClient, id: string) : Promise<CurrentPublicationEvent | null> {
    const row = (await client.query(`SELECT e.*,r.publication,u.role,u.allowed_locales,u.active,u.mfa_enabled FROM notification_publication_events e JOIN locale_releases r ON r.document_bucket=e.document_bucket AND r.document_id=e.document_id AND r.locale=e.locale AND r.active_revision_id=e.revision_id AND r.unpublished_at IS NULL JOIN users u ON u.id=r.published_by WHERE e.id=$1`, [id])).rows[0];
    if (!row || !row.active || !row.mfa_enabled || !row.allowed_locales.includes(row.locale) || !publicNoticePublicationVisible(row.publication) || !(canWorkspace)(row.role, "publish", row.publication.kind==="product"?"products":row.publication.kind==="page"?"pages":row.publication.kind))
        return null;
    return row;
}
async function publicationNotificationPermitted(client: PoolClient, payload: NotificationPayload, bound = false) {
    if (typeof payload.publicationEventId !== "string")
        return false;
    const event = await currentPublicEvent(client, payload.publicationEventId);
    if (!event || payload.locale !== event.locale)
        return false;
    const message = bound ? publicMessage(event.publication, event) : { title: event.publication.title.slice(0, 200), body: event.publication.summary.slice(0, 1e4) || event.publication.title, href: publicMessage(event.publication,event).href,imageUrl:publicationImage(event.publication) };
    return payload.purpose === "marketing" && payload.topic === event.topic && payload.title === message.title && payload.body === message.body && payload.href === message.href && payload.imageUrl === message.imageUrl;
}
async function publicationBoundDeliveryPermitted(client: PoolClient, payload: NotificationPayload, channel: string) {
    if (!await publicationNotificationPermitted(client, payload, true) || typeof payload.userId !== "string" || typeof payload.recipientId !== "string" || payload.contactId !== void 0)
        return false;
    const row = (await client.query(`SELECT r.id FROM communication_recipients r JOIN users u ON u.id=r.user_id AND u.active JOIN notification_publication_events e ON e.id=$3 WHERE r.id=$1 AND r.subject_type='user' AND r.user_id=$2 AND r.active AND u.created_at<=e.created_at`, [payload.recipientId, payload.userId, payload.publicationEventId])).rows[0];
    return !!row && !await (isRecipientCampaignSuppressed)(client, "", payload.recipientId, payload.topic, channel);
}
async function publicationTelegramChannelPermitted(client: PoolClient, payload: NotificationPayload) { const configured = channelConfiguration(); return !!configured && payload.publicTelegramChannel === true && payload.to === configured.to && typeof payload.locale === "string" && configured.locales.includes(payload.locale) && payload.userId === void 0 && payload.contactId === void 0 && payload.channelBinding === void 0 && await publicationNotificationPermitted(client, payload, true); }
async function enqueuePublicationNotificationEvent(client: PoolClient, publication: LocalPublication, revisionId: string, bucket = "records") {
    const topic = topicFor(publication.kind);
    if (!topic)
        return null;
    if(!publicNoticePublicationVisible(publication)){
        const notice=parsePublishedPublicNotice(publication.publicNotice);
        // A valid future notice keeps a durable event, but cannot fan out until
        // its public window opens. Disabled/expired/malformed notices have none.
        if(publication.kind!=='news'||!notice?.enabled||!notice.startsAt||Date.parse(notice.startsAt)<=Date.now())return null;
    }
    const id = "publication-" + (hash)(JSON.stringify([bucket, publication.id, publication.locale, revisionId]));
    const result = await client.query(`INSERT INTO notification_publication_events(id,document_bucket,document_id,locale,revision_id,topic)
    SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS(SELECT 1 FROM locale_releases WHERE document_bucket=$2 AND document_id=$3 AND locale=$4 AND active_revision_id=$5::uuid AND unpublished_at IS NULL)
    ON CONFLICT(document_bucket,document_id,locale,revision_id) DO NOTHING RETURNING id`, [id, bucket, publication.id, publication.locale, revisionId, topic]);
    return result.rows[0]?.id || null;
}
async function runPublicationNotificationFanout(batchSize = 100) {
    (assert)(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 500, 422, "FANOUT_LIMIT", "Use a fanout chunk from 1 to 500 accounts.");
    return (transaction)(async (client) => {
        // Approved notice instants are canonical UTC with zero or three decimal
        // places. Normalize the zero-decimal form before comparing text; avoid
        // unsafe casts and allow other ready events past a future notice.
        const event = (await client.query<PublicationEvent>(`SELECT e.* FROM notification_publication_events e WHERE e.state='pending' AND NOT EXISTS(
          SELECT 1 FROM locale_releases r WHERE r.document_bucket=e.document_bucket AND r.document_id=e.document_id AND r.locale=e.locale
          AND r.active_revision_id=e.revision_id AND r.unpublished_at IS NULL AND r.publication#>>'{publicNotice,enabled}'='true'
          AND CASE WHEN length(r.publication#>>'{publicNotice,startsAt}')=20 THEN left(r.publication#>>'{publicNotice,startsAt}',19)||'.000Z'
            ELSE r.publication#>>'{publicNotice,startsAt}' END > $1::text
        ) ORDER BY e.created_at,e.id FOR UPDATE OF e SKIP LOCKED LIMIT 1`,[new Date().toISOString()])).rows[0];
        if (!event)
            return { processed: 0, queued: 0, completed: false };
        const release = await currentPublicEvent(client, event.id);
        if (!release) {
            await client.query("UPDATE notification_publication_events SET state='cancelled',completed_at=now() WHERE id=$1", [event.id]);
            return { processed: 0, queued: 0, completed: true };
        }
        const users = (await client.query(`SELECT u.id,r.id AS recipient_id,u.email_verified,
      CASE WHEN p.user_id IS NOT NULL THEN coalesce(p.preferences#>>ARRAY['topics',$3,'email','enabled'],'false')='true'
        ELSE coalesce(s.portal#>>'{notificationPreferences,email}','false')='true' AND coalesce(s.portal#>>ARRAY['notificationPreferences',$3],CASE WHEN $3='content' THEN 'false' ELSE 'true' END)<>'false' END AS email_enabled,
      CASE WHEN p.user_id IS NOT NULL THEN coalesce(p.preferences#>>ARRAY['topics',$3,'inApp','enabled'],'false')='true'
        ELSE coalesce(s.portal#>>'{notificationPreferences,inApp}','false')='true' AND coalesce(s.portal#>>ARRAY['notificationPreferences',$3],CASE WHEN $3='content' THEN 'false' ELSE 'true' END)<>'false' END AS in_app_enabled
      FROM users u JOIN communication_recipients r ON r.user_id=u.id AND r.subject_type='user' AND r.active LEFT JOIN user_settings s ON s.user_id=u.id LEFT JOIN notification_preferences p ON p.user_id=u.id
      WHERE u.active AND u.id>$1 AND u.created_at<=$2 AND coalesce(s.preferences->>'language','fa')=$4
      ORDER BY u.id LIMIT $5`, [event.cursor_user_id, event.created_at, event.topic, event.locale, batchSize + 1])).rows;
        const chunk = users.slice(0, batchSize), publication = release.publication;
        let queued = 0;
        for (const user of chunk) {
            for (const channel2 of ["email", "in-app"] as const) {
                if (channel2 === "email" ? !(user.email_enabled && user.email_verified) : !user.in_app_enabled)
                    continue;
                const id = await (enqueueAccountNotification)(client, { userId: user.id, topic: event.topic, channel: channel2, purpose: "marketing", title: publication.title.slice(0, 200), body: publication.summary.slice(0, 1e4) || publication.title, href: publicMessage(publication,event).href,imageUrl:publicationImage(publication), publicationEventId: event.id }, `${event.id}:${user.id}:${channel2}`);
                if (id)
                    queued++;
            }
            const references = await (captureBoundEndpoints)(client, user.recipient_id, ["sms", "telegram", "push"], event.topic);
            for (const reference of references) {
                const id = await (enqueueBoundNotification)(client, user.recipient_id, reference, { ...publicMessage(publication, event), topic: event.topic, purpose: "marketing", publicationEventId: event.id }, `${event.id}:${user.id}:${reference.channel}`);
                if (id)
                    queued++;
            }
        }
        const channel = channelConfiguration();
        if (channel && channel.locales.includes(event.locale)) {
            const id = (randomUUID)(), payload = { ...publicMessage(publication, event), to: channel.to, locale: event.locale, purpose: "marketing", topic: event.topic, publicationEventId: event.id, publicTelegramChannel: true };
            const result = await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key) VALUES($1,'telegram',$2::jsonb,$3) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id", [id, JSON.stringify({ encrypted: (encrypt)(JSON.stringify(payload)) }), `${event.id}:official-telegram:${(hash)(channel.to)}`]);
            if (result.rowCount)
                queued++;
        }
        const completed = users.length <= batchSize;
        await client.query("UPDATE notification_publication_events SET cursor_user_id=$2,processed_count=processed_count+$3,queued_count=queued_count+$4,state=$5,completed_at=CASE WHEN $5='completed' THEN now() ELSE NULL END WHERE id=$1", [event.id, chunk.at(-1)?.id || event.cursor_user_id, chunk.length, queued, completed ? "completed" : "pending"]);
        if (completed)
            await (audit)(null, "notification.publication.expanded", "publication", event.document_id, { eventId: event.id, locale: event.locale }, client);
        return { processed: chunk.length, queued, completed };
    });
}
export { channelConfiguration as publicationChannelConfiguration, enqueuePublicationNotificationEvent, publicationBoundDeliveryPermitted, publicationNotificationPermitted, publicationTelegramChannelPermitted, runPublicationNotificationFanout };
