import type {PgRow} from './recovered-db-rows';
import type { PoolClient } from 'pg';
import type { Actor } from './types';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { operationalRoutes } from "../types/monitoring";
import { parse } from "./http";
import { transaction, audit } from "./db";
import { monitoringActor, monitoringCapabilities } from "./operations-incidents";
import { hash } from "./crypto";
import { assert } from "./types";
import { randomUUID } from "node:crypto";
const definition = z.object({ name: z.string().trim().min(3).max(120), kind: z.enum(["http_availability", "http_latency_p95", "worker_freshness"]), route: z.enum(["all", ...operationalRoutes]), target: z.number().finite().positive().max(6e5), windowMinutes: z.union([z.literal(5), z.literal(60), z.literal(1440), z.literal(10080)]), minimumSamples: z.number().int().min(1).max(1e4), enabled: z.boolean() }).strict().superRefine((value, context) => {
    if (value.kind === "http_availability" && value.target > 100)
        context.addIssue({ code: "custom", path: ["target"], message: "Availability is a percentage at most100." });
    if (value.kind === "worker_freshness" && (value.target > 86400 || value.route !== "all" || value.minimumSamples !== 1))
        context.addIssue({ code: "custom", message: "Worker freshness uses seconds, all routes and one heartbeat sample." });
});
const uuid = z.string().uuid(), reason = z.string().trim().min(8).max(500), commandKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const createSchema = z.object({ value: definition, reason, idempotencyKey: commandKey }).strict();
const patchSchema = z.object({ value: definition, reason }).strict();
const observed = (row: PgRow<'ops_slo_observations'>) => ({ id: row.id, sloId: row.slo_id, definitionVersion: row.definition_version, sampledAt: row.observed_at.toISOString(), windowStart: row.window_start.toISOString(), windowEnd: row.window_end.toISOString(), state: row.state, observed: row.observed === null ? null : Number(row.observed), target: Number(row.target), sampleCount: row.sample_count, reason: row.reason });
const valueOf = (row: PgRow<'ops_slos'>) => ({ name: row.name, kind: row.kind, route: row.route_key, target: Number(row.target), windowMinutes: row.window_minutes, minimumSamples: row.minimum_samples, enabled: row.enabled });
async function dto(client: PoolClient, row: PgRow<'ops_slos'>) { const latest = (await client.query<PgRow<'ops_slo_observations'>>("SELECT * FROM ops_slo_observations WHERE slo_id=$1 AND definition_version=$2 ORDER BY observed_at DESC,id DESC LIMIT 1", [row.id, row.version])).rows[0]; return { ...valueOf(row), id: row.id, version: row.version, createdBy: row.created_by, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), latest: latest ? observed(latest) : null }; }
async function revision(client: PoolClient, row: PgRow<'ops_slos'>, actor: Actor, reason2: string) { await client.query("INSERT INTO ops_slo_revisions(slo_id,version,definition,changed_by,reason) VALUES($1,$2,$3::jsonb,$4,$5)", [row.id, row.version, JSON.stringify(valueOf(row)), actor.id, reason2]); }
async function createOperationalSlo(actor: Actor, body: unknown) {
    const input = (parse)(createSchema, body);
    return (transaction)(async (client) => {
        actor = await (monitoringActor)(actor, client, true);
        await client.query("SELECT pg_advisory_xact_lock(9280028)");
        const requestHash = (hash)(JSON.stringify(input)), existing = (await client.query<PgRow<'ops_slos'>>("SELECT * FROM ops_slos WHERE created_by=$1 AND idempotency_key=$2", [actor.id, input.idempotencyKey])).rows[0];
        if (existing) {
            (assert)(existing.request_hash === requestHash, 409, "IDEMPOTENCY_CONFLICT", "This key belongs to a different SLO command.");
            return { item: await dto(client, existing), duplicate: true };
        }
        const counts = (await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE enabled)::int AS enabled FROM ops_slos")).rows[0];
        (assert)(counts.total < 200 && (!input.value.enabled || counts.enabled < 50), 409, "SLO_LIMIT", "At most200 definitions and50 enabled SLOs are supported.");
        const value = input.value, row = (await client.query<PgRow<'ops_slos'>>("INSERT INTO ops_slos(id,name,kind,route_key,target,window_minutes,minimum_samples,enabled,created_by,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *", [(randomUUID)(), value.name, value.kind, value.route, value.target, value.windowMinutes, value.minimumSamples, value.enabled, actor.id, input.idempotencyKey, requestHash])).rows[0];
        await revision(client, row, actor, input.reason);
        await (audit)(actor.id, "operations.slo.created", "slo", row.id, { version: row.version, kind: row.kind, route: row.route_key }, client);
        return { item: await dto(client, row), duplicate: false };
    });
}
async function updateOperationalSlo(actor: Actor, id: string, body: unknown, expectedVersion: number) {
    (parse)(uuid, id);
    const input = (parse)(patchSchema, body);
    (assert)(Number.isSafeInteger(expectedVersion) && expectedVersion > 0, 422, "VERSION", "Use the current SLO version.");
    return (transaction)(async (client) => {
        actor = await (monitoringActor)(actor, client, true);
        await client.query("SELECT pg_advisory_xact_lock(9280028)");
        const row = (await client.query<PgRow<'ops_slos'>>("SELECT * FROM ops_slos WHERE id=$1 FOR UPDATE", [id])).rows[0];
        (assert)(row, 404, "NOT_FOUND", "SLO not found.");
        (assert)(row.version === expectedVersion, 409, "CONFLICT", "The SLO changed. Refresh and review the new target.");
        (assert)(row.kind === input.value.kind && row.route_key === input.value.route, 409, "SLO_IDENTITY", "Create a separate SLO to change its measurement kind or route.");
        if (input.value.enabled && !row.enabled)
            (assert)((await client.query("SELECT count(*)::int AS n FROM ops_slos WHERE enabled")).rows[0].n < 50, 409, "SLO_LIMIT", "At most50 enabled SLOs are supported.");
        const value = input.value, updated = (await client.query<PgRow<'ops_slos'>>("UPDATE ops_slos SET name=$2,target=$3,window_minutes=$4,minimum_samples=$5,enabled=$6,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, value.name, value.target, value.windowMinutes, value.minimumSamples, value.enabled])).rows[0];
        await revision(client, updated, actor, input.reason);
        await (audit)(actor.id, "operations.slo.updated", "slo", id, { version: updated.version, enabled: value.enabled }, client);
        return dto(client, updated);
    });
}
async function listOperationalSlos(actor: Actor) { return (transaction)(async (client) => { actor = await (monitoringActor)(actor, client, true); const rows = (await client.query<PgRow<'ops_slos'>>("SELECT * FROM ops_slos ORDER BY created_at DESC,id LIMIT 200")).rows; return { items: await Promise.all(rows.map(row => dto(client, row))), capabilities: (monitoringCapabilities)(actor) }; }); }
async function readHttpWindow(client: PoolClient, minutes: number, route = "all", end = new Date) {
    const start = new Date(end.getTime() - minutes * 6e4);
    const row = (await client.query(`WITH sample AS(SELECT status_code,duration_ms,observed_at FROM ops_http_samples WHERE observed_at>=$1 AND observed_at<=$2 AND ($3='all' OR route_key=$3) ORDER BY observed_at DESC,id DESC LIMIT 20001)
    SELECT count(*)::int AS n,count(*) FILTER(WHERE status_code>=500)::int AS failed,percentile_cont(0.5) WITHIN GROUP(ORDER BY duration_ms) AS p50,percentile_cont(0.95) WITHIN GROUP(ORDER BY duration_ms) AS p95,percentile_cont(0.99) WITHIN GROUP(ORDER BY duration_ms) AS p99,max(observed_at) AS latest FROM sample`, [start, end, route])).rows[0];
    const from = new Date(Math.ceil(start.getTime() / 6e4) * 6e4), to = new Date(Math.floor(end.getTime() / 6e4) * 6e4);
    const gap = (await client.query(`SELECT
    coalesce((SELECT sum(requests) FROM ops_http_totals WHERE minute>=$1 AND minute<$2 AND ($3='all' OR route_key=$3)),0)>
    (SELECT count(*) FROM ops_http_samples WHERE observed_at>=$1 AND observed_at<$2 AND ($3='all' OR route_key=$3)) AS missing`, [from, to, route])).rows[0].missing;
    return { count: row.n, truncated: row.n > 2e4 || gap, failed: row.failed, p50: row.p50 === null ? null : Number(row.p50), p95: row.p95 === null ? null : Number(row.p95), p99: row.p99 === null ? null : Number(row.p99), latestAt: row.latest?.toISOString() || null };
}
async function evaluateOperationalSlos(limit = 50) {
    (assert)(Number.isInteger(limit) && limit >= 1 && limit <= 50, 422, "LIMIT", "Use a bounded SLO batch.");
    return (transaction)(async (client) => {
        const definitions = (await client.query<PgRow<'ops_slos'>>("SELECT * FROM ops_slos WHERE enabled ORDER BY id FOR SHARE LIMIT $1", [limit])).rows;
        const results = [];
        for (const row of definitions) {
            const end = new Date, start = new Date(end.getTime() - row.window_minutes * 6e4);
            let value = null, samples = 0, reason2 = null;
            if (row.kind === "worker_freshness") {
                const heartbeat = (await client.query("SELECT heartbeat_at FROM worker_heartbeats WHERE name='main'")).rows[0];
                if (heartbeat) {
                    samples = 1;
                    value = Math.max(0, (end.getTime() - heartbeat.heartbeat_at.getTime()) / 1e3);
                }
                else
                    reason2 = "NO_HEARTBEAT";
            }
            else {
                const sample = await readHttpWindow(client, row.window_minutes, row.route_key, end);
                samples = sample.count;
                if (sample.truncated)
                    reason2 = "SAMPLE_LIMIT";
                else if (samples < row.minimum_samples)
                    reason2 = "INSUFFICIENT_SAMPLES";
                else if (!sample.latestAt || end.getTime() - Date.parse(sample.latestAt) > Math.min(row.window_minutes * 6e4, 3e5))
                    reason2 = "NO_RECENT_SAMPLES";
                else
                    value = row.kind === "http_availability" ? 100 * (samples - sample.failed) / samples : sample.p95;
            }
            const state = value === null ? "unknown" : row.kind === "http_availability" ? value >= Number(row.target) ? "passing" : "breaching" : value <= Number(row.target) ? "passing" : "breaching";
            const result = (await client.query<PgRow<'ops_slo_observations'>>("INSERT INTO ops_slo_observations(id,slo_id,definition_version,window_start,window_end,state,observed,target,sample_count,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *", [(randomUUID)(), row.id, row.version, start, end, state, value, row.target, samples, reason2])).rows[0];
            results.push(observed(result));
        }
        return results;
    });
}
export { createOperationalSlo, evaluateOperationalSlos, listOperationalSlos, readHttpWindow, updateOperationalSlo };
