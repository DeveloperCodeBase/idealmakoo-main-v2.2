/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { connect } from "node:tls";
import { performance } from "node:perf_hooks";
import { config } from "./config";
import { query, transaction } from "./db";
import { statfs } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { evaluateOperationalSlos } from "./operations-slo";
import { pruneOperationalMeasurements } from "./operations-telemetry";
import { z } from "zod";
import { parse } from "./http";
import { assert } from "./types";
import { hash } from "./crypto";
export interface TlsObservation { validUntil: string; authorized: boolean }
export interface ProbeDependencies { fetch?: typeof fetch; tls?: (url: URL) => Promise<TlsObservation> }
export interface OperationalProbe {
    key: string; state: 'unknown' | 'passing' | 'breaching';
    durationMs?: number; statusCode?: number; value?: number;
    details: Record<string, unknown>;
}
function probeOrigin() {
    const configured = process.env.MONITORING_INTERNAL_PROBE_URL;
    if (!configured)
        return null;
    try {
        const url = new URL(configured);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url : null;
    }
    catch {
        return null;
    }
}
function publicTls(url: URL): Promise<TlsObservation> {
    return new Promise<TlsObservation>((resolve, reject) => {
        const socket = (connect)({ host: url.hostname, port: Number(url.port) || 443, servername: url.hostname, rejectUnauthorized: true });
        const finish = (error?: Error) => {
            socket.destroy();
            if (error)
                reject(error);
        };
        socket.setTimeout(5e3, () => finish(new Error("TLS_TIMEOUT")));
        socket.once("error", () => finish(new Error("TLS_CONNECTION")));
        socket.once("secureConnect", () => {
            const certificate = socket.getPeerCertificate();
            const validUntil = certificate.valid_to;
            const authorized = socket.authorized;
            socket.destroy();
            if (!validUntil || !Number.isFinite(Date.parse(validUntil)))
                reject(new Error("TLS_CERTIFICATE"));
            else
                resolve({ validUntil: new Date(validUntil).toISOString(), authorized });
        });
    });
}
async function collectOperationalProbes(dependencies: ProbeDependencies = {}): Promise<OperationalProbe[]> {
    const origin = probeOrigin(), fetcher = dependencies.fetch || fetch, probes: OperationalProbe[] = [];
    for (const [key, path] of [["app_live", "/api/v1/health/live"], ["app_ready", "/api/v1/health/ready"], ["published_site", "/api/v1/site"]]) {
        if (!origin) {
            probes.push({ key, state: "unknown", details: { reason: "INTERNAL_PROBE_NOT_CONFIGURED" } });
            continue;
        }
        const start = performance.now();
        try {
            const response = await fetcher(new URL(path, origin), { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(5e3), headers: { "User-Agent": "Idealmakoo-Operational-Probe/1" } });
            await response.body?.cancel();
            probes.push({ key, state: response.ok ? "passing" : "breaching", statusCode: response.status, durationMs: performance.now() - start, details: { scope: "internal-http-status" } });
        }
        catch {
            probes.push({ key, state: "breaching", durationMs: Math.min(6e5, performance.now() - start), details: { reason: "INTERNAL_PROBE_FAILED" } });
        }
    }
    const site = new URL((config)().siteUrl);
    if (process.env.MONITORING_EXTERNAL_PROBES_ENABLED !== "true" || site.protocol !== "https:")
        probes.push({ key: "public_tls", state: "unknown", details: { reason: site.protocol === "https:" ? "EXTERNAL_PROBE_DISABLED" : "HTTPS_NOT_CONFIGURED" } });
    else {
        const start = performance.now();
        try {
            const result = await (dependencies.tls || publicTls)(site), days = (Date.parse(result.validUntil) - Date.now()) / 864e5;
            probes.push({ key: "public_tls", state: result.authorized && days > 7 ? "passing" : "breaching", durationMs: performance.now() - start, value: Math.max(-1e5, Math.min(1e5, days)), details: { validUntil: result.validUntil, authorized: result.authorized, scope: "configured-public-host" } });
        }
        catch {
            probes.push({ key: "public_tls", state: "breaching", durationMs: Math.min(6e5, performance.now() - start), details: { reason: "PUBLIC_TLS_PROBE_FAILED" } });
        }
    }
    const ping = performance.now();
    await (query)("SELECT 1");
    probes.push({ key: "database", state: "passing", durationMs: performance.now() - ping, details: { scope: "worker-connection" } });
    const heartbeat = (await (query)("SELECT heartbeat_at FROM worker_heartbeats WHERE name='main'")).rows[0];
    const age = heartbeat ? Math.max(0, (Date.now() - heartbeat.heartbeat_at.getTime()) / 1e3) : null;
    probes.push({ key: "worker", state: age === null ? "unknown" : age <= 60 ? "passing" : "breaching", ...age === null ? {} : { value: age }, details: { heartbeatAt: heartbeat?.heartbeat_at.toISOString() || null, scope: "main-worker-heartbeat" } });
    const memory = process.memoryUsage(), cpu = process.cpuUsage();
    const details: Record<string, unknown> = { scope: "monitoring-worker-process", rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, uptimeSeconds: process.uptime(), cpuUserMicroseconds: cpu.user, cpuSystemMicroseconds: cpu.system };
    try {
        const disk = await (statfs)((config)().storageDir, { bigint: true });
        details.filesystemAvailableBytes = Number(disk.bavail * disk.bsize);
        details.filesystemTotalBytes = Number(disk.blocks * disk.bsize);
    }
    catch {
        details.filesystemReason = "STORAGE_FILESYSTEM_UNAVAILABLE";
    }
    probes.push({ key: "process", state: "passing", details });
    return probes;
}
async function runOperationalMonitoring(dependencies: ProbeDependencies = {}) {
    const token = (randomUUID)();
    const claimed = await (query)(`UPDATE ops_monitoring_lease SET lock_token=$1,locked_until=now()+interval '90 seconds'
    WHERE singleton AND next_at<=now() AND (locked_until IS NULL OR locked_until<now()) RETURNING singleton`, [token]);
    if (!claimed.rowCount)
        return { ran: false, probes: 0 };
    try {
        const probes = await collectOperationalProbes(dependencies);
        const persisted = await (transaction)(async (client) => {
            const lease = await client.query("SELECT singleton FROM ops_monitoring_lease WHERE singleton AND lock_token=$1 AND locked_until>now() FOR UPDATE", [token]);
            if (!lease.rowCount)
                return false;
            for (const item of probes)
                await client.query("INSERT INTO ops_probe_samples(id,probe_key,state,duration_ms,status_code,value,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)", [(randomUUID)(), item.key, item.state, item.durationMs === void 0 ? null : Math.round(item.durationMs * 1e3) / 1e3, item.statusCode ?? null, item.value ?? null, JSON.stringify(item.details)]);
            return true;
        });
        if (!persisted)
            return { ran: false, probes: 0 };
        await (evaluateOperationalSlos)();
        await (pruneOperationalMeasurements)();
        await (query)("UPDATE ops_monitoring_lease SET lock_token=NULL,locked_until=NULL,next_at=now()+interval '60 seconds',last_completed_at=now(),last_error=NULL WHERE singleton AND lock_token=$1", [token]);
        return { ran: true, probes: probes.length };
    }
    catch {
        await (query)("UPDATE ops_monitoring_lease SET lock_token=NULL,locked_until=NULL,next_at=now()+interval '60 seconds',last_error='MONITORING_CYCLE_FAILED' WHERE singleton AND lock_token=$1", [token]);
        return { ran: true, probes: 0, error: "MONITORING_CYCLE_FAILED" };
    }
}
const evidenceSchema = z.object({ operation: z.enum(["backup", "verify-only", "restore-drill", "restore-replace"]), runId: z.string().regex(/^[A-Za-z0-9_.:-]{8,160}$/), success: z.boolean(), startedAt: z.string().datetime({ offset: true }), finishedAt: z.string().datetime({ offset: true }), releaseId: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/), archiveSha256: z.string().regex(/^[a-f0-9]{64}$/), archiveBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), migrationCount: z.number().int().min(0).max(1e4), tableCount: z.number().int().min(0).max(1e4).nullable(), privacyReplay: z.boolean(), source: z.enum(["backup-script", "restore-script", "native-drill"]), failureCode: z.string().regex(/^[A-Z0-9_]{3,80}$/).optional() }).strict();
async function recordRecoveryEvidence(body: unknown) {
    const input = (parse)(evidenceSchema, body);
    (assert)(Date.parse(input.finishedAt) >= Date.parse(input.startedAt) && Date.parse(input.finishedAt) <= Date.now() + 3e5, 422, "RECOVERY_TIME", "Evidence timestamps must describe a completed run.");
    (assert)(!input.success || input.archiveBytes > 0 && input.migrationCount > 0 && !input.failureCode, 422, "RECOVERY_EVIDENCE", "Successful evidence needs an actual nonempty archive and schema inventory.");
    (assert)(!input.success || !input.operation.startsWith("restore-") || input.privacyReplay, 422, "RECOVERY_PRIVACY", "A restored database is not ready until the independent privacy ledger was replayed.");
    (assert)(input.success || !!input.failureCode, 422, "RECOVERY_EVIDENCE", "Failed runs require a bounded failure code.");
    const requestHash = (hash)(JSON.stringify(input));
    return (transaction)(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["recovery-evidence:" + input.operation + ":" + input.runId]);
        const prior = (await client.query("SELECT id,request_hash FROM ops_recovery_evidence WHERE operation=$1 AND run_id=$2", [input.operation, input.runId])).rows[0];
        if (prior) {
            (assert)(prior.request_hash === requestHash, 409, "IDEMPOTENCY_CONFLICT", "A different recovery result already uses this run identifier.");
            return { id: prior.id, duplicate: true };
        }
        const id = (randomUUID)();
        await client.query(`INSERT INTO ops_recovery_evidence(id,operation,run_id,success,started_at,finished_at,release_id,archive_sha256,archive_bytes,migration_count,table_count,privacy_replay,source,failure_code,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [id, input.operation, input.runId, input.success, input.startedAt, input.finishedAt, input.releaseId, input.archiveSha256, input.archiveBytes, input.migrationCount, input.tableCount, input.privacyReplay, input.source, input.failureCode || null, requestHash]);
        return { id, duplicate: false };
    });
}
export { collectOperationalProbes, recordRecoveryEvidence, runOperationalMonitoring };
