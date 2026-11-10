import {bindNotificationTemplate} from './notification-templates';
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { parse, rateLimit, visitorKey } from "./http";
import { domainId, domainLocale } from "./workspace-domain-schema";
import { transaction, audit } from "./db";
import { domainContext, domainRecord, domainPermission, requireContact } from "./workspace-domain-core";
import { assert } from "./types";
import { token, hash, encrypt } from "./crypto";
import { config } from "./config";
import { randomUUID } from "node:crypto";
import { lockWorkspace } from "./workspace";
import { loadCrmAccess } from "./workspace-scopes";
const topics = ["products", "research", "events"] as const;
const rawToken = z.string().min(32).max(100).regex(/^[A-Za-z0-9_-]+$/);
async function requestCrmEndpointVerification(actor: Actor, contactId: string, endpointId: string, body: unknown) { (parse)(domainId, contactId); (parse)(z.string().uuid(), endpointId); const input = (parse)(z.object({ locale: domainLocale }).strict(), body); await (rateLimit)("crm-endpoint-verification:" + actor.id + ":" + endpointId, 3, 3600); return (transaction)(async (client) => { actor = (await (domainContext)(client, actor)).actor; const record = await (domainRecord)(client, actor, contactId, "contacts"); (domainPermission)(actor, record); (requireContact)(actor); (assert)(actor.allowedLocales.includes(input.locale), 403, "LOCALE_SCOPE", "Select an assigned verification language."); const endpoint = (await client.query("SELECT e.* FROM crm_contact_endpoints e JOIN communication_recipients r ON r.id=e.recipient_id AND r.contact_id=e.contact_id AND r.active WHERE e.id=$1 AND e.contact_id=$2 AND e.active FOR UPDATE OF e", [endpointId, contactId])).rows[0]; (assert)(endpoint, 404, "NOT_FOUND", "Active contact endpoint not found."); (assert)(endpoint.channel === "email", 422, "CRM_VERIFICATION_CHANNEL", "Telephone verification requires a configured verified-channel provider."); const raw = (token)(), digest = (hash)(raw), valueHash = (hash)(endpoint.normalized_value); await client.query("UPDATE crm_endpoint_challenges SET consumed_at=now() WHERE endpoint_id=$1 AND consumed_at IS NULL", [endpointId]); await client.query("INSERT INTO crm_endpoint_challenges(token_hash,endpoint_id,endpoint_version,value_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours')", [digest, endpointId, endpoint.version, valueHash]); const payload = (encrypt)(JSON.stringify({ to: endpoint.value, subject: "Ideal Makoo \u2014 verify your contact email", text: `Confirm control of this email address. Marketing preferences are optional and initially disabled: ${(config)().siteUrl}/${input.locale}/auth/login/?contactVerification=${encodeURIComponent(raw)}`, crmEndpointVerification: { endpointId, endpointVersion: endpoint.version, valueHash, challengeHash: digest } })); const outboxId=randomUUID(); await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,crm_contact_id) VALUES($1,'email',$2::jsonb,$3,$4)", [outboxId, JSON.stringify({ encrypted: payload }), "crm-endpoint-verify:" + digest, contactId]); await bindNotificationTemplate(client,outboxId,{key:'contact_verification',locale:input.locale,values:{actionUrl:`${config().siteUrl}/${input.locale}/auth/login/?contactVerification=${encodeURIComponent(raw)}`}}); await (audit)(actor.id, "crm.endpoint.verification_requested", "crm-contact", contactId, { endpointId, endpointVersion: endpoint.version }, client); return { ok: true, status: "pending" }; }); }
async function confirmCrmContactEndpoint(request: Request, body: unknown) {
    const input = (parse)(z.object({ token: rawToken, topics: z.array(z.enum(topics)).max(3).refine(value => new Set(value).size === value.length).default([]) }).strict(), body);
    await (rateLimit)("crm-endpoint-confirm:" + (visitorKey)(request), 20, 900);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        const digest = (hash)(input.token);
        const challenge = (await client.query("SELECT endpoint_id,endpoint_version,value_hash FROM crm_endpoint_challenges WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE", [digest])).rows[0];
        (assert)(challenge, 422, "CRM_VERIFY_EXPIRED", "This verification link is invalid, expired or already used.");
        const endpoint = (await client.query("SELECT e.* FROM crm_contact_endpoints e JOIN communication_recipients r ON r.id=e.recipient_id AND r.contact_id=e.contact_id AND r.active JOIN workspace_entities w ON w.bucket='records' AND w.id=e.contact_id AND w.deleted_at IS NULL AND w.status<>'archived' WHERE e.id=$1 AND e.active FOR UPDATE OF e", [challenge.endpoint_id])).rows[0];
        (assert)(endpoint && endpoint.channel === "email" && endpoint.version === challenge.endpoint_version && (hash)(endpoint.normalized_value) === challenge.value_hash, 422, "CRM_VERIFY_EXPIRED", "The endpoint changed. Request a new verification link.");
        await client.query("UPDATE crm_contact_endpoints SET verified_at=now(),updated_at=now() WHERE id=$1", [endpoint.id]);
        await client.query("UPDATE crm_endpoint_challenges SET consumed_at=now() WHERE endpoint_id=$1 AND consumed_at IS NULL", [endpoint.id]);
        for (const topic of topics)
            await client.query("INSERT INTO crm_endpoint_consent_events(endpoint_id,endpoint_version,topic,accepted,source,policy_version) VALUES($1,$2,$3,$4,'verified-recipient','crm-contact-consent-v1')", [endpoint.id, endpoint.version, topic, input.topics.includes(topic)]);
        const { applyVerifiedContactTopics } = await import("./contact-notifications");
        await applyVerifiedContactTopics(client, endpoint, input.topics);
        await client.query("UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton=true");
        await (audit)(null, "crm.endpoint.verified", "crm-contact", endpoint.contact_id, { endpointId: endpoint.id, endpointVersion: endpoint.version, topics: input.topics }, client);
        return { ok: true, verified: true, acceptedTopics: input.topics };
    });
}
async function canDeliverCrmEndpointVerification(client: PoolClient, payload:Record<string,unknown>) {
    const value = z.object({ endpointId: z.string().uuid(), endpointVersion: z.number().int().positive(), valueHash: z.string().regex(/^[a-f0-9]{64}$/), challengeHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(payload.crmEndpointVerification);
    if (!value.success || typeof payload.to !== "string")
        return false;
    const input = value.data;
    const row = (await client.query("SELECT e.normalized_value FROM crm_contact_endpoints e JOIN communication_recipients r ON r.id=e.recipient_id AND r.contact_id=e.contact_id AND r.active JOIN workspace_entities w ON w.bucket='records' AND w.id=e.contact_id AND w.deleted_at IS NULL AND w.status<>'archived' JOIN crm_endpoint_challenges c ON c.endpoint_id=e.id AND c.token_hash=$4 AND c.consumed_at IS NULL AND c.expires_at>now() WHERE e.id=$1 AND e.version=$2 AND e.active AND e.channel='email' AND c.endpoint_version=e.version AND c.value_hash=$3", [input.endpointId, input.endpointVersion, input.valueHash, input.challengeHash])).rows[0];
    return !!row && (hash)(row.normalized_value) === input.valueHash && payload.to.trim().toLowerCase() === row.normalized_value;
}
async function resolveCrmContactRecipient(client: PoolClient, actor: Actor, recipientId:string, endpointId: string, topic:typeof topics[number]) { (parse)(z.string().uuid(), recipientId); (parse)(z.string().uuid(), endpointId); (parse)(z.enum(topics), topic); actor = await (loadCrmAccess)(actor, client); (requireContact)(actor); const row = (await client.query("SELECT e.*,c.locale FROM communication_recipients r JOIN crm_contact_endpoints e ON e.recipient_id=r.id AND e.contact_id=r.contact_id JOIN crm_contact_profiles c ON c.record_id=e.contact_id WHERE r.id=$1 AND e.id=$2 AND r.subject_type='crm-contact' AND r.active AND e.active AND e.channel='email' AND e.verified_at IS NOT NULL", [recipientId, endpointId])).rows[0]; (assert)(row, 404, "CRM_RECIPIENT_UNAVAILABLE", "Verified contact endpoint not found."); await (domainRecord)(client, actor, row.contact_id, "contacts"); (assert)(actor.allowedLocales.includes(row.locale), 403, "LOCALE_SCOPE", "Recipient language is outside your assigned scope."); const consent = (await client.query("SELECT accepted,endpoint_version FROM crm_endpoint_consent_events WHERE endpoint_id=$1 AND topic=$2 ORDER BY id DESC LIMIT 1", [row.id, topic])).rows[0]; return { recipientId, subjectType: "crm-contact", subjectId: row.contact_id, locale: row.locale, endpointId: row.id, endpointVersion: row.version, to: row.value, channel: "email", verifiedAt: row.verified_at.toISOString(), topicConsented: consent?.accepted === true && consent.endpoint_version === row.version }; }
export { canDeliverCrmEndpointVerification, confirmCrmContactEndpoint, requestCrmEndpointVerification, resolveCrmContactRecipient };
