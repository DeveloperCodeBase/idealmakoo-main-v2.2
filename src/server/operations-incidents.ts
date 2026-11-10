import type {PgRow} from './recovered-db-rows';
import type {MonitoringCapabilities} from '../types/monitoring';
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { incidentServices, monitoringViews, incidentStates } from "../types/monitoring";
import { loadCrmAccess } from "./workspace-scopes";
import { assert } from "./types";
import { parse } from "./http";
import { transaction, audit } from "./db";
import { hash, decrypt, encrypt } from "./crypto";
import { randomUUID } from "node:crypto";
const uuid = z.string().uuid(), key = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), reason = z.string().trim().min(8).max(2e3);
const createSchema = z.object({ title: z.string().trim().min(3).max(160), description: reason, service: z.enum(incidentServices), severity: z.enum(["sev1", "sev2", "sev3", "sev4"]), idempotencyKey: key, sloObservationId: uuid.optional() }).strict();
const transitionSchema = z.object({ state: z.enum(["ack", "investigating", "resolved"]), reason, idempotencyKey: key }).strict();
const nextState = { new: "ack", ack: "investigating", investigating: "resolved", resolved: null };
function monitoringCapabilities(actor: Actor): MonitoringCapabilities { const admin = ["superAdmin", "admin"].includes(actor.role); return { allowedViews: admin ? [...monitoringViews] : ["overview", "availability", "performance", "business", "content"], manageIncidents: admin, manageSlos: admin }; }
async function monitoringActor(actor: Actor, client?: PoolClient, manage = false) { const current = await (loadCrmAccess)(actor, client); (assert)(current.mfaVerified && ["superAdmin", "admin", ...manage ? [] : ["analyst"]].includes(current.role), 403, "FORBIDDEN", "Current staff role and MFA are required for operational monitoring."); return current; }
async function dto(client: PoolClient, row: PgRow<'ops_incidents'>) { const rows = (await client.query<PgRow<'ops_incident_transitions'>>("SELECT * FROM ops_incident_transitions WHERE incident_id=$1 ORDER BY version", [row.id])).rows; return { id: row.id, title: row.title, description: row.description, service: row.service, severity: row.severity, state: row.state, version: row.version, createdBy: row.created_by, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), resolvedAt: row.resolved_at?.toISOString() || null, sloObservationId: row.slo_observation_id, transitions: rows.map(value => ({ id: value.id, from: value.from_state, to: value.to_state, version: value.version, reason: value.reason, actorId: value.actor_id, createdAt: value.created_at.toISOString() })), nextState: nextState[row.state] }; }
async function find(client: PoolClient, id: string, lock = false) : Promise<PgRow<'ops_incidents'>> { const row = (await client.query("SELECT * FROM ops_incidents WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Incident not found."); return row; }
async function createOperationalIncident(actor: Actor, body: unknown) {
    const input = (parse)(createSchema, body);
    return (transaction)(async (client) => {
        actor = await monitoringActor(actor, client, true);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["ops-incident:" + actor.id + ":" + input.idempotencyKey]);
        const requestHash = (hash)(JSON.stringify(input)), existing = (await client.query<PgRow<'ops_incidents'>>("SELECT * FROM ops_incidents WHERE created_by=$1 AND idempotency_key=$2", [actor.id, input.idempotencyKey])).rows[0];
        if (existing) {
            (assert)(existing.request_hash === requestHash, 409, "IDEMPOTENCY_CONFLICT", "This command key was used with different incident details.");
            return { incident: await dto(client, existing), duplicate: true };
        }
        if (input.sloObservationId)
            (assert)((await client.query("SELECT id FROM ops_slo_observations WHERE id=$1", [input.sloObservationId])).rowCount, 404, "NOT_FOUND", "SLO observation not found.");
        const id = (randomUUID)(), row = (await client.query<PgRow<'ops_incidents'>>(`INSERT INTO ops_incidents(id,title,description,service,severity,created_by,slo_observation_id,idempotency_key,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [id, input.title, input.description, input.service, input.severity, actor.id, input.sloObservationId || null, input.idempotencyKey, requestHash])).rows[0];
        await client.query("INSERT INTO ops_incident_transitions(id,incident_id,from_state,to_state,version,reason,actor_id,idempotency_key,request_hash) VALUES($1,$2,NULL,'new',1,$3,$4,$5,$6)", [(randomUUID)(), id, input.description, actor.id, input.idempotencyKey, requestHash]);
        await (audit)(actor.id, "operations.incident.created", "incident", id, { service: input.service, severity: input.severity, version: 1, sloObservationId: input.sloObservationId || null }, client);
        return { incident: await dto(client, row), duplicate: false };
    });
}
async function getOperationalIncident(actor: Actor, id: string) { (parse)(uuid, id); return (transaction)(async (client) => { await monitoringActor(actor, client, true); return dto(client, await find(client, id)); }); }
async function transitionOperationalIncident(actor: Actor, id: string, body: unknown, expectedVersion: number) {
    (parse)(uuid, id);
    const input = (parse)(transitionSchema, body);
    (assert)(Number.isSafeInteger(expectedVersion) && expectedVersion > 0, 422, "VERSION", "Use the current incident version.");
    return (transaction)(async (client) => {
        actor = await monitoringActor(actor, client, true);
        const row = await find(client, id, true), requestHash = (hash)(JSON.stringify(input));
        const previous = (await client.query<PgRow<'ops_incident_transitions'>>("SELECT * FROM ops_incident_transitions WHERE incident_id=$1 AND idempotency_key=$2", [id, input.idempotencyKey])).rows[0];
        if (previous) {
            (assert)(previous.request_hash === requestHash, 409, "IDEMPOTENCY_CONFLICT", "This command key was used for another transition.");
            return { incident: await dto(client, row), duplicate: true, transitionId: previous.id };
        }
        (assert)(row.version === expectedVersion, 409, "CONFLICT", "This incident changed. Refresh and review its latest transition.");
        (assert)(nextState[row.state] === input.state, 409, "INCIDENT_TRANSITION", "Follow new, acknowledgement, investigation and resolution in order.");
        const version = row.version + 1, transitionId = (randomUUID)();
        const updated = (await client.query<PgRow<'ops_incidents'>>("UPDATE ops_incidents SET state=$2,version=$3,updated_at=now(),resolved_at=CASE WHEN $2='resolved' THEN now() ELSE NULL END WHERE id=$1 RETURNING *", [id, input.state, version])).rows[0];
        await client.query("INSERT INTO ops_incident_transitions(id,incident_id,from_state,to_state,version,reason,actor_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [transitionId, id, row.state, input.state, version, input.reason, actor.id, input.idempotencyKey, requestHash]);
        await (audit)(actor.id, "operations.incident.transition", "incident", id, { from: row.state, to: input.state, version, transitionId }, client);
        return { incident: await dto(client, updated), duplicate: false, transitionId };
    });
}
const listSchema = z.object({ state: z.enum(incidentStates).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(3e3).optional() }).strict();
async function listOperationalIncidents(actor: Actor, options = {}) {
    const input = (parse)(listSchema, options);
    return (transaction)(async (client) => {
        actor = await monitoringActor(actor, client, true);
        let before = null;
        if (input.cursor) {
            try {
                const value = JSON.parse((decrypt)(input.cursor));
                (assert)(value.actor === actor.id && value.state === (input.state || null) && Number.isFinite(value.expires) && value.expires > Date.now() && typeof value.at === "string" && Number.isFinite(Date.parse(value.at)) && uuid.safeParse(value.id).success, 422, "INVALID_CURSOR", "Refresh the incident list.");
                before = { at: value.at, id: value.id };
            }
            catch {
                (assert)(false, 422, "INVALID_CURSOR", "Refresh the incident list.");
            }
        }
        const rows = (await client.query(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM ops_incidents WHERE ($1::text IS NULL OR state=$1) AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`, [input.state || null, before?.at || null, before?.id || null, input.limit + 1])).rows;
        const page = rows.slice(0, input.limit), last = page.at(-1);
        return { items: await Promise.all(page.map(row => dto(client, row))), nextCursor: rows.length > input.limit && last ? (encrypt)(JSON.stringify({ actor: actor.id, state: input.state || null, at: last.cursor_at, id: last.id, expires: Date.now() + 36e5 })) : null, capabilities: monitoringCapabilities(actor) };
    });
}
export { createOperationalIncident, getOperationalIncident, listOperationalIncidents, monitoringActor, monitoringCapabilities, transitionOperationalIncident };
