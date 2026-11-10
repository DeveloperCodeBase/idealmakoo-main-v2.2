import {enqueueStaffAlerts} from './staff-alerts';
import type {PgRow} from './recovered-db-rows';
type ConnectorRow = PgRow<'crm_inbox_connectors'>;
type InboxRow = PgRow<'crm_inbox_items',{payload:{encrypted:string}}> & {request_kind:string|null;request_quality:boolean|null;request_assignee:string|null;request_team:string|null;request_territory:string|null};
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { assert, HttpError } from "./types";
import { loadCrmAccess, canAccessCrmRequest, canAccessCrmRecord, crmRequestCollection } from "./workspace-scopes";
import { canWorkspace } from "../lib/auth";
import { decrypt, encrypt, hash } from "./crypto";
import { query, transaction, audit } from "./db";
import { parse, rateLimit } from "./http";
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
const plain = (min: number, max: number) => z.string().trim().min(min).max(max).regex(/^[^\x00-\x1f\x7f]*$/);
const idSchema = z.string().uuid(), identity = z.string().min(1).max(160), reason = plain(8, 500);
const connectorSchema = z.object({ name: plain(1, 160), providerLabel: plain(1, 120), channel: z.enum(["email", "sms", "telegram", "push", "other"]), teamId: identity.nullable(), territoryId: identity.nullable(), qualityQuarantined: z.boolean(), active: z.boolean() }).strict();
const eventSchema = z.object({ providerEventId: plain(1, 160), occurredAt: z.string().datetime({ offset: true }), sender: z.object({ name: plain(0, 160), address: plain(1, 254) }).strict(), subject: plain(0, 200), body: z.string().trim().min(1).max(2e4).regex(/^[^\x00-\x08\x0b-\x1f\x7f]+$/) }).strict();
const selectInbox = `SELECT i.*,r.kind AS request_kind,r.quality_quarantined AS request_quality,r.assignee_id AS request_assignee,r.team_id AS request_team,r.territory_id AS request_territory FROM crm_inbox_items i LEFT JOIN requests r ON r.id=i.request_id`;
const manager = (actor: Actor) => actor.mfaVerified && ["superAdmin", "admin"].includes(actor.role);
const conflict = (version: number, current: number) => (assert)(Number.isSafeInteger(version) && version === current, 409, "CONFLICT", "This inbox record changed. Refresh and review its current version.");
const requireId = (id: string) => (assert)(idSchema.safeParse(id).success, 404, "NOT_FOUND", "The inbox resource was not found.");
async function inboxActor(actor: Actor, client?: PoolClient) { actor = await (loadCrmAccess)(actor, client); (assert)(actor.mfaVerified && actor.crmAccess?.permissions.contact && (canWorkspace)(actor.role, "view", "inbox"), 403, "INBOX_PERMISSION", "Current inbox access, MFA and contact permission are required."); return actor; }
async function connectorActor(actor: Actor, client?: PoolClient) { actor = await (loadCrmAccess)(actor, client); (assert)(manager(actor), 403, "CONNECTOR_ADMIN", "Only an administrator with current MFA can manage connector credentials."); return actor; }
const connectorDto = (row: ConnectorRow) => ({ id: row.id, name: row.name, providerLabel: row.provider_label, channel: row.channel, teamId: row.team_id, territoryId: row.territory_id, qualityQuarantined: row.quality_quarantined, active: row.active, version: row.version, credentialVersion: row.credential_version, protocol: "idealmakoo-hmac-v1", webhookPath: "/api/v1/connectors/" + row.id + "/events/", createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
async function validateRouting(client: PoolClient, input: z.infer<typeof connectorSchema>) {
    for (const [field, table] of [["teamId", "crm_teams"], ["territoryId", "crm_territories"]] as const)
        if (input[field])
            (assert)((await client.query("SELECT 1 FROM " + table + " WHERE id=$1 AND active", [input[field]])).rowCount, 422, "CONNECTOR_SCOPE", "Choose an active routing group.");
}
function readableInbox(actor: Actor, row: InboxRow) {
    if (row.quality_quarantined && !actor.qualityScope)
        return false;
    if (row.request_id)
        return !!row.request_kind && (canAccessCrmRequest)(actor, { id: row.request_id, kind: row.request_kind, qualityQuarantined: !!row.request_quality, assigneeId: row.request_assignee, teamId: row.request_team, territoryId: row.request_territory });
    return (canAccessCrmRecord)(actor, { collection: "inbox", requestId: row.id, teamId: row.team_id || void 0, territoryId: row.territory_id || void 0 });
}
function inboxDto(actor: Actor, row: InboxRow) { const payload = eventSchema.parse(JSON.parse((decrypt)(row.payload.encrypted))); return { ...payload, id: row.id, connectorId: row.connector_id, connectorName: row.connector_name, providerLabel: row.provider_label, channel: row.channel, version: row.version, state: row.state, receivedAt: row.received_at.toISOString(), requestId: row.request_id, requestMessageId: row.request_message_id, qualityQuarantined: row.quality_quarantined, senderVerified: false, capabilities: { associate: row.state === "pending" && (canWorkspace)(actor.role, "reply", "inbox"), archive: (canWorkspace)(actor.role, "edit", "inbox") } }; }
async function inboxFor(client: PoolClient, actor: Actor, id: string, lock = false) { requireId(id); const row = (await client.query<InboxRow>(selectInbox + " WHERE i.id=$1" + (lock ? " FOR UPDATE OF i" : ""), [id])).rows[0]; (assert)(row && readableInbox(actor, row), 404, "NOT_FOUND", "Inbox item not found in your current scope."); return row; }
async function listCrmConnectors(actor: Actor) { actor = await connectorActor(actor); return { items: (await (query)<ConnectorRow>("SELECT * FROM crm_inbox_connectors ORDER BY created_at DESC,id LIMIT 100")).rows.map(connectorDto), capabilities: { manage: true, protocol: "idealmakoo-hmac-v1", maximumBodyBytes: 262144 } }; }
async function createCrmConnector(actor: Actor, body: unknown) { const input = (parse)(connectorSchema, body); await (rateLimit)("crm-connector-create:" + actor.id, 20, 3600); return (transaction)(async (client) => { actor = await connectorActor(actor, client); await validateRouting(client, input); const secret = (randomBytes)(32).toString("base64url"), row = (await client.query<ConnectorRow>("INSERT INTO crm_inbox_connectors(id,name,provider_label,channel,secret_encrypted,active,team_id,territory_id,quality_quarantined,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *", [(randomUUID)(), input.name, input.providerLabel, input.channel, (encrypt)(secret), input.active, input.teamId, input.territoryId, input.qualityQuarantined, actor.id])).rows[0]; await (audit)(actor.id, "crm.connector.created", "crm_connector", row.id, { channel: row.channel, active: row.active }, client); return { connector: connectorDto(row), signingSecret: secret }; }); }
async function updateCrmConnector(actor: Actor, id: string, body: unknown, version: number) { requireId(id); const input = (parse)(connectorSchema, body); return (transaction)(async (client) => { actor = await connectorActor(actor, client); const old = (await client.query<ConnectorRow>("SELECT * FROM crm_inbox_connectors WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(old, 404, "NOT_FOUND", "Connector not found."); conflict(version, old.version); await validateRouting(client, input); const row = (await client.query<ConnectorRow>("UPDATE crm_inbox_connectors SET name=$2,provider_label=$3,channel=$4,active=$5,team_id=$6,territory_id=$7,quality_quarantined=$8,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, input.name, input.providerLabel, input.channel, input.active, input.teamId, input.territoryId, input.qualityQuarantined])).rows[0]; await (audit)(actor.id, "crm.connector.updated", "crm_connector", id, { active: row.active, version: row.version }, client); return connectorDto(row); }); }
async function rotateCrmConnectorSecret(actor: Actor, id: string, body: unknown, version: number) { requireId(id); const input = (parse)(z.object({ reason }).strict(), body); await (rateLimit)("crm-connector-rotate:" + actor.id, 20, 3600); return (transaction)(async (client) => { actor = await connectorActor(actor, client); const old = (await client.query<ConnectorRow>("SELECT * FROM crm_inbox_connectors WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(old, 404, "NOT_FOUND", "Connector not found."); conflict(version, old.version); const secret = (randomBytes)(32).toString("base64url"), row = (await client.query<ConnectorRow>("UPDATE crm_inbox_connectors SET secret_encrypted=$2,credential_version=credential_version+1,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, (encrypt)(secret)])).rows[0]; await (audit)(actor.id, "crm.connector.credential.rotated", "crm_connector", id, { reason: input.reason, credentialVersion: row.credential_version }, client); return { connector: connectorDto(row), signingSecret: secret }; }); }
async function rawBody(request: Request) {
    const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    (assert)(type === "application/json", 415, "CONTENT_TYPE", "Send an application/json event.");
    (assert)(Number(request.headers.get("content-length") || 0) <= 262144, 413, "BODY_TOO_LARGE", "Connector events are limited to 256 KiB.");
    (assert)(request.body, 400, "BODY_REQUIRED", "Provide the signed event body.");
    const reader = request.body.getReader(), parts = [];
    let size = 0;
    for (;;) {
        const item = await reader.read();
        if (item.done)
            break;
        size += item.value.byteLength;
        if (size > 262144) {
            await reader.cancel();
            throw new HttpError(413, "BODY_TOO_LARGE", "Connector events are limited to 256 KiB.");
        }
        parts.push(item.value);
    }
    return Buffer.concat(parts);
}
async function receiveCrmConnectorEvent(request: Request, id: string) {
    requireId(id);
    (assert)(request.method === "POST", 405, "METHOD", "Use POST for signed events.");
    const stamp = request.headers.get("x-idealmakoo-timestamp") || "", signature = request.headers.get("x-idealmakoo-signature") || "";
    (assert)(/^\d{10}$/.test(stamp) && Math.abs(Date.now() / 1e3 - Number(stamp)) <= 300 && /^v1=[a-f0-9]{64}$/i.test(signature), 401, "CONNECTOR_SIGNATURE", "The connector signature is invalid or expired.");
    const connector = (await (query)<ConnectorRow>("SELECT * FROM crm_inbox_connectors WHERE id=$1 AND active", [id])).rows[0];
    (assert)(connector, 401, "CONNECTOR_SIGNATURE", "The connector signature is invalid or expired.");
    const bytes = await rawBody(request), secret = (decrypt)(connector.secret_encrypted), expected = (createHmac)("sha256", Buffer.from(secret, "base64url")).update(stamp + ".").update(bytes).digest(), provided = Buffer.from(signature.slice(3), "hex");
    (assert)(provided.length === expected.length && (timingSafeEqual)(provided, expected), 401, "CONNECTOR_SIGNATURE", "The connector signature is invalid or expired.");
    await (rateLimit)("crm-connector-events:" + id, 120, 60);
    let body;
    try {
        body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }
    catch {
        throw new HttpError(400, "JSON", "Provide a valid UTF-8 JSON event.");
    }
    const input = (parse)(eventSchema, body);
    (assert)(Date.parse(input.occurredAt) <= Date.now() + 3e5 && Date.parse(input.occurredAt) >= Date.now() - 2 * 366 * 864e5, 422, "EVENT_TIME", "Use an occurrence time from the last two years, no more than five minutes ahead.");
    if (connector.channel === "email")
        (assert)(z.string().email().safeParse(input.sender.address).success, 422, "SENDER_ADDRESS", "The adapter must provide a syntactically valid sender email; this does not verify its identity.");
    return (transaction)(async (client) => {
        const current = (await client.query<ConnectorRow>("SELECT * FROM crm_inbox_connectors WHERE id=$1 AND active FOR SHARE", [id])).rows[0];
        (assert)(current && current.credential_version === connector.credential_version, 401, "CONNECTOR_SIGNATURE", "The connector signature is invalid or expired.");
        if (current.channel === "email")
            (assert)(z.string().email().safeParse(input.sender.address).success, 422, "SENDER_ADDRESS", "The adapter must provide a syntactically valid sender email.");
        const itemId = (randomUUID)(), bodyHash = (hash)(bytes), inserted = await client.query<InboxRow>("INSERT INTO crm_inbox_items(id,connector_id,provider_event_id,body_hash,payload,connector_name,provider_label,channel,team_id,territory_id,quality_quarantined) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11) ON CONFLICT(connector_id,provider_event_id) DO NOTHING RETURNING id", [itemId, id, input.providerEventId, bodyHash, JSON.stringify({ encrypted: (encrypt)(JSON.stringify(input)) }), current.name, current.provider_label, current.channel, current.team_id, current.territory_id, current.quality_quarantined]);
        if (!inserted.rowCount) {
            const previous = (await client.query<InboxRow>("SELECT body_hash FROM crm_inbox_items WHERE connector_id=$1 AND provider_event_id=$2", [id, input.providerEventId])).rows[0];
            (assert)(previous?.body_hash === bodyHash, 409, "PROVIDER_EVENT_CONFLICT", "This provider event identity already refers to different raw bytes.");
            return { received: true, duplicate: true };
        }
        await enqueueStaffAlerts(client,itemId,"inbox");
        await (audit)(null, "crm.inbox.received", "crm_inbox", itemId, { connectorId: id, channel: current.channel }, client);
        return { received: true, duplicate: false };
    });
}
function decodeCursor(value: string, actor: Actor, state: string) {
    try {
        (assert)(value.length <= 2e3, 422, "CURSOR", "Invalid inbox cursor.");
        const input = (parse)(z.object({ actorId: identity, state: z.string(), at: z.string().datetime(), id: idSchema }).strict(), JSON.parse((decrypt)(value)));
        (assert)(input.actorId === actor.id && input.state === state, 422, "CURSOR", "This cursor belongs to another inbox query.");
        return input;
    }
    catch {
        throw new HttpError(422, "CURSOR", "Invalid inbox cursor.");
    }
}
async function listCrmInbox(actor: Actor, options: {state?:string;limit?:number;cursor?:string} = {}) {
    return (transaction)(async (client) => {
        actor = await inboxActor(actor, client);
        const state = options.state || "pending", limit = options.limit ?? 50;
        (assert)(["pending", "associated", "archived", "all"].includes(state) && Number.isInteger(limit) && limit >= 1 && limit <= 100, 422, "INBOX_QUERY", "Choose a valid inbox state and a page size from one to one hundred.");
        let cursor = options.cursor ? decodeCursor(options.cursor, actor, state) : null, scanned = 0, hasMore = false, last: InboxRow | undefined;
        const found: InboxRow[] = [];
        while (scanned < 2e3 && found.length <= limit) {
            const args = [];
            let where = " WHERE ";
            if (state !== "all") {
                args.push(state);
                where += "i.state=$" + args.length + " AND ";
            }
            if (cursor) {
                args.push(cursor.at, cursor.id);
                where += "(i.received_at,i.id)<($" + (args.length - 1) + "::timestamptz,$" + args.length + "::uuid) AND ";
            }
            where += "true";
            const rows = (await client.query<InboxRow>(selectInbox + where + " ORDER BY i.received_at DESC,i.id DESC LIMIT 200", args)).rows;
            hasMore = rows.length === 200;
            if (!rows.length)
                break;
            for (const row of rows) {
                scanned++;
                last = row;
                if (readableInbox(actor, row))
                    found.push(row);
                if (found.length > limit)
                    break;
            }
            if (found.length > limit) {
                hasMore = true;
                last = found[limit - 1];
                break;
            }
            last = rows.at(-1)!;
            cursor = { actorId: actor.id, state, at: last.received_at.toISOString(), id: last.id };
            if (!hasMore)
                break;
        }
        return { items: found.slice(0, limit).map(row => inboxDto(actor, row)), nextCursor: hasMore && last ? (encrypt)(JSON.stringify({ actorId: actor.id, state, at: last.received_at.toISOString(), id: last.id })) : null, capabilities: { manageConnectors: manager(actor), associate: (canWorkspace)(actor.role, "reply", "inbox") }, limit };
    });
}
async function getCrmInboxItem(actor: Actor, id: string) { return (transaction)(async (client) => { actor = await inboxActor(actor, client); return inboxDto(actor, await inboxFor(client, actor, id)); }); }
async function associateCrmInboxItem(actor: Actor, id: string, body: unknown, version: number) {
    const input = (parse)(z.object({ requestId: identity, reason }).strict(), body);
    return (transaction)(async (client) => {
        actor = await inboxActor(actor, client);
        (assert)((canWorkspace)(actor.role, "reply", "inbox"), 403, "INBOX_ASSOCIATION", "This role cannot associate incoming messages.");
        const old = await inboxFor(client, actor, id, true);
        conflict(version, old.version);
        if (old.request_id) {
            (assert)(old.request_id === input.requestId, 409, "INBOX_ASSOCIATION_IMMUTABLE", "The original association is retained. A different case requires a reviewed correction; it cannot silently move the message.");
            return inboxDto(actor, old);
        }
        (assert)(old.state === "pending", 409, "INBOX_ARCHIVED", "Restore the pending item before associating it.");
        const target = (await client.query("SELECT id,kind,quality_quarantined,assignee_id,team_id,territory_id FROM requests WHERE id=$1 FOR UPDATE", [input.requestId])).rows[0];
        (assert)(target && (canAccessCrmRequest)(actor, { id: target.id, kind: target.kind, qualityQuarantined: target.quality_quarantined, assigneeId: target.assignee_id, teamId: target.team_id, territoryId: target.territory_id }) && (canWorkspace)(actor.role, "reply", (crmRequestCollection)(target.kind)), 404, "NOT_FOUND", "The request is unavailable for reply in your current scope.");
        (assert)(!old.quality_quarantined || target.quality_quarantined, 422, "QUALITY_SCOPE", "A quarantined incoming item cannot be copied into an unquarantined request.");
        const event = inboxDto(actor, old), messageId = (randomUUID)(), heading = `Inbound message \u2014 external sender is unverified
Adapter: ${old.connector_name} (${old.channel})
Sender: ${event.sender.address}
Subject: ${event.subject}

`, footer = `

Full original is retained in private inbox item ${old.id}.`, text = heading + event.body.slice(0, Math.max(0, 4e3 - heading.length - footer.length)) + footer;
        await client.query("INSERT INTO request_messages(id,request_id,body,visibility,actor_id) VALUES($1,$2,$3,'internal',$4)", [messageId, target.id, text, actor.id]);
        await client.query<InboxRow>("UPDATE crm_inbox_items SET state='associated',request_id=$2,request_message_id=$3,associated_by=$4,associated_at=now(),updated_by=$4,version=version+1,updated_at=now() WHERE id=$1", [old.id, target.id, messageId, actor.id]);
        await (audit)(actor.id, "crm.inbox.associated", "crm_inbox", id, { requestId: target.id, requestMessageId: messageId, reason: input.reason, externalSenderVerified: false }, client);
        return inboxDto(actor, await inboxFor(client, actor, id));
    });
}
async function archiveCrmInboxItem(actor: Actor, id: string, body: unknown, version: number) {
    const input = (parse)(z.object({ archived: z.boolean(), reason }).strict(), body);
    return (transaction)(async (client) => {
        actor = await inboxActor(actor, client);
        (assert)((canWorkspace)(actor.role, "edit", "inbox"), 403, "INBOX_ARCHIVE", "This role cannot archive inbox items.");
        const old = await inboxFor(client, actor, id, true);
        conflict(version, old.version);
        const state = input.archived ? "archived" : old.request_id ? "associated" : "pending";
        if (old.state === state)
            return inboxDto(actor, old);
        await client.query<InboxRow>("UPDATE crm_inbox_items SET state=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1", [id, state, actor.id]);
        await (audit)(actor.id, input.archived ? "crm.inbox.archived" : "crm.inbox.restored", "crm_inbox", id, { reason: input.reason }, client);
        return inboxDto(actor, await inboxFor(client, actor, id));
    });
}
export { archiveCrmInboxItem, associateCrmInboxItem, createCrmConnector, getCrmInboxItem, listCrmConnectors, listCrmInbox, receiveCrmConnectorEvent, rotateCrmConnectorSecret, updateCrmConnector };
