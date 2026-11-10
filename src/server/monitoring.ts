import {applicationVersion} from './release';
import type {MonitoringMetric, MonitoringObservation, MonitoringResponse, ObservationState} from '../types/monitoring';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */


import type { Actor } from './types';
import { readHttpWindow } from "./operations-slo";
import { canAccessCrmRequest } from "./workspace-scopes";
import { parse } from "./http";
import { z } from "zod";
import { monitoringViews } from "../types/monitoring";
import { transaction } from "./db";
import { monitoringActor, monitoringCapabilities } from "./operations-incidents";
import { assert } from "./types";
function metric(key: string, value: number | null, unit: string = "count", samples: number = 0, note?: string, state?: ObservationState) : MonitoringMetric { return { key, value, unit, samples, state: state || (value === null ? "unknown" : "observed"), ...note ? { note } : {} }; }
const n = (value: unknown) => Number(value) || 0;
const one = async (client: PoolClient, sql: string, args: unknown[] = []) : Promise<Record<string, unknown>> => (await client.query(sql, args)).rows[0] || {};
async function latestProbes(client: PoolClient, keys: string[]) : Promise<MonitoringObservation[]> {
    const rows = (await client.query("SELECT DISTINCT ON(probe_key) * FROM ops_probe_samples WHERE probe_key=ANY($1::text[]) ORDER BY probe_key,observed_at DESC,id DESC", [keys])).rows;
    return keys.map(key => {
        const row = rows.find(item => item.probe_key === key);
        if (!row)
            return { id: key, key, state: "unknown", sampledAt: null, metrics: [], note: "NO_PROBE_OBSERVATION" };
        const state = Date.now() - row.observed_at.getTime() > 18e4 ? "stale" : key === "process" && row.state === "passing" ? "observed" : row.state;
        const metrics = [];
        if (row.duration_ms !== null)
            metrics.push(metric("probe_duration_ms", Number(row.duration_ms), "ms", 1));
        if (row.status_code !== null)
            metrics.push(metric("http_status", row.status_code, "count", 1));
        if (row.value !== null)
            metrics.push(metric(key === "worker" ? "worker_heartbeat_age_seconds" : "tls_expiry_seconds", Number(row.value) * (key === "public_tls" ? 86400 : 1), "seconds", 1));
        if (key === "process")
            for (const [name, unit] of [["rssBytes", "bytes"], ["heapUsedBytes", "bytes"], ["filesystemAvailableBytes", "bytes"], ["filesystemTotalBytes", "bytes"], ["uptimeSeconds", "seconds"]]) {
                const value = row.details[name];
                metrics.push(metric(name, typeof value === "number" && Number.isFinite(value) ? value : null, unit, typeof value === "number" ? 1 : 0, "WORKER_PROCESS_ONLY"));
            }
        return { id: row.id, key, state, sampledAt: row.observed_at.toISOString(), metrics, ...typeof row.details.reason === "string" ? { note: row.details.reason } : key === "process" ? { note: "WORKER_PROCESS_ONLY" } : {} };
    });
}
async function httpMetrics(client: PoolClient, minutes: number) { const sample = await (readHttpWindow)(client, minutes); const unavailable = sample.truncated || !sample.count; return { sample, metrics: [metric("http_samples", sample.count, "count", sample.count, sample.truncated ? "INCOMPLETE_SAMPLE_BUFFER" : void 0), metric("http_failures", sample.failed, "count", sample.count), metric("http_availability", unavailable ? null : 100 * (sample.count - sample.failed) / sample.count, "percent", sample.count), ...(["p50", "p95", "p99"] as const).map(key => metric("http_" + key, unavailable ? null : sample[key], "ms", sample.count, sample.truncated ? "INCOMPLETE_SAMPLE_BUFFER" : void 0))] }; }
async function businessMetrics(client: PoolClient, actor: Actor, from: Date, to: Date) { const candidates = (await client.query(`SELECT id,kind,locale,quality_quarantined,assignee_id,team_id,territory_id,data->>'status' AS status FROM requests WHERE created_at>=$1 AND created_at<=$2 ORDER BY created_at DESC,id DESC LIMIT 10001`, [from, to])).rows; const current = candidates.slice(0, 1e4).filter(row => actor.allowedLocales.includes(row.locale) && (canAccessCrmRequest)(actor, { id: row.id, kind: row.kind, qualityQuarantined: row.quality_quarantined, assigneeId: row.assignee_id, teamId: row.team_id, territoryId: row.territory_id })); const views = await one(client, "SELECT count(*)::int AS n FROM ops_browser_samples WHERE event='product_view' AND observed_at>=$1 AND observed_at<=$2", [from, to]); const downloads = await one(client, "SELECT count(*)::int AS n FROM audit_events WHERE action IN ('resource.download','resource.bundle.downloaded') AND created_at>=$1 AND created_at<=$2 AND ($3 OR actor_id=$4)", [from, to, ["superAdmin", "admin"].includes(actor.role), actor.id]); return { samples: current.length, truncated: candidates.length > 1e4, metrics: [metric("product_views", n(views.n), "count", n(views.n), "CONSENTED_ANONYMOUS_EVENTS"), metric("authorized_requests", current.length, "count", current.length, "CURRENT_CRM_SCOPE"), metric("authorized_rfq", current.filter(row => row.kind === "rfq").length, "count", current.length, "CURRENT_CRM_SCOPE"), metric("authorized_completed_requests", current.filter(row => ["closed", "resolved", "completed"].includes(row.status || "")).length, "count", current.length, "CURRENT_CRM_SCOPE"), metric("authorized_document_downloads", n(downloads.n), "count", n(downloads.n), "CURRENT_OPERATIONAL_SCOPE"), metric("product_to_inquiry_conversion", null, "percent", 0, "NO_CROSS_USER_ATTRIBUTION")] }; }
async function monitoring(actor:Actor, view = "overview", minutes = 60) : Promise<MonitoringResponse> {
    const selected = (parse)(z.enum(monitoringViews), view), windowMinutes = (parse)(z.coerce.number().int().min(5).max(10080), minutes);
    return (transaction)(async (client) => {
        actor = await (monitoringActor)(actor, client);
        const capabilities = (monitoringCapabilities)(actor);
        (assert)(capabilities.allowedViews.includes(selected), 403, "FORBIDDEN", "This monitoring view is outside your current role.");
        const now = new Date, from = new Date(now.getTime() - windowMinutes * 6e4);
        const result: MonitoringResponse = { view: selected, sampledAt: now.toISOString(), window: { minutes: windowMinutes, from: from.toISOString(), to: now.toISOString() }, coverage: { source: "current-database-aggregates", samples: 0, truncated: false }, metrics: [], observations: [], capabilities, release: { id: process.env.RELEASE_ID || applicationVersion, commitSha: /^[a-f0-9]{40}$/i.test(process.env.RELEASE_SHA || "") ? process.env.RELEASE_SHA! : null }, openIncidents: capabilities.manageIncidents ? n((await one(client, "SELECT count(*)::int AS n FROM ops_incidents WHERE state<>'resolved'")).n) : null };
        if (selected === "overview" || selected === "performance") {
            const http = await httpMetrics(client, windowMinutes);
            result.metrics = http.metrics;
            result.coverage = { source: "bounded-http-response-samples", samples: http.sample.count, truncated: http.sample.truncated };
            if (selected === "overview")
                result.observations = await latestProbes(client, ["app_live", "app_ready", "worker", "database"]);
            else {
                const rows = (await client.query(`SELECT event,count(*)::int AS n,percentile_cont(0.75) WITHIN GROUP(ORDER BY value) AS p75 FROM ops_browser_samples WHERE event IN ('LCP','INP','CLS') AND observed_at>=$1 AND observed_at<=$2 GROUP BY event`, [from, now])).rows;
                for (const key of ["LCP", "INP", "CLS"]) {
                    const row = rows.find(item => item.event === key);
                    result.metrics.push(metric(key + "_p75", row?.p75 === void 0 ? null : Number(row.p75), key === "CLS" ? "count" : "ms", row?.n || 0, "CONSENTED_ANONYMOUS_EVENTS"));
                }
            }
        }
        else if (selected === "availability") {
            result.coverage.source = "fixed-worker-probes";
            result.observations = await latestProbes(client, ["app_live", "app_ready", "published_site", "public_tls", "worker", "database"]);
            result.coverage.samples = result.observations.filter(item => item.sampledAt).length;
            const row = await one(client, "SELECT count(*)::int AS n,count(*) FILTER(WHERE state='breaching')::int AS failed FROM ops_probe_samples WHERE observed_at>=$1 AND observed_at<=$2 AND state<>'unknown'", [from, now]);
            result.metrics = [metric("measured_probes", n(row.n), "count", n(row.n)), metric("failed_probes", n(row.failed), "count", n(row.n))];
        }
        else if (selected === "business") {
            const data = await businessMetrics(client, actor, from, now);
            result.metrics = data.metrics;
            result.coverage = { source: "current-authorized-crm-and-consented-public-counts", samples: data.samples, truncated: data.truncated };
        }
        else if (selected === "content") {
            const locales = actor.allowedLocales;
            const revisions = await one(client, `WITH latest AS(SELECT DISTINCT ON(document_bucket,document_id,locale) id FROM content_revisions WHERE locale=ANY($1::text[]) ORDER BY document_bucket,document_id,locale,revision_number DESC) SELECT count(*)::int AS total,count(*) FILTER(WHERE a.revision_id IS NULL)::int AS unapproved FROM latest l LEFT JOIN content_approvals a ON a.revision_id=l.id`, [locales]);
            const releases = await one(client, `SELECT count(*)::int AS live,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM content_revisions c WHERE c.document_bucket=r.document_bucket AND c.document_id=r.document_id AND c.locale=r.locale AND c.revision_number>(SELECT revision_number FROM content_revisions WHERE id=r.active_revision_id)))::int AS newer FROM locale_releases r WHERE r.unpublished_at IS NULL AND r.locale=ANY($1::text[])`, [locales]);
            const scheduled = await one(client, "SELECT count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='failed')::int AS failed FROM workspace_publish_jobs WHERE locale=ANY($1::text[])", [locales]);
            const rights = await one(client, "SELECT count(*) FILTER(WHERE rights_expires_at>now() AND rights_expires_at<=now()+interval '30 days')::int AS soon,count(*) FILTER(WHERE rights_expires_at<=now())::int AS expired FROM resource_versions WHERE locale=ANY($1::text[])", [locales]);
            result.metrics = [metric("review_queue", n(revisions.unapproved), "count", n(revisions.total), "LATEST_REVISION_PER_ASSIGNED_LOCALE"), metric("live_locale_releases", n(releases.live), "count", n(releases.live)), metric("unpublished_locale_changes", n(releases.newer), "count", n(releases.live)), metric("scheduled_releases", n(scheduled.pending)), metric("failed_releases", n(scheduled.failed)), metric("document_rights_expiring", n(rights.soon)), metric("document_rights_expired", n(rights.expired)), metric("stale_translations", null, "count", 0, "NO_TRANSLATION_STALENESS_MEASUREMENT"), metric("broken_links", null, "count", 0, "NO_LINK_CRAWL_EVIDENCE")];
            result.coverage.samples = n(revisions.total);
        }
        else if (selected === "security") {
            const events = await one(client, `SELECT count(*)::int AS total,count(*) FILTER(WHERE action='auth.login.denied')::int AS denied,count(*) FILTER(WHERE action LIKE '%role%' OR action LIKE 'staff.%')::int AS access_changes,count(*) FILTER(WHERE action IN ('resource.download','resource.view','resource.bundle.downloaded'))::int AS document_access FROM audit_events WHERE created_at>=$1 AND created_at<=$2`, [from, now]);
            const users = await one(client, "SELECT count(*) FILTER(WHERE role<>'customer' AND active)::int AS staff,count(*) FILTER(WHERE role<>'customer' AND active AND mfa_enabled)::int AS mfa FROM users"), assets = await one(client, "SELECT count(*)::int AS n FROM assets WHERE scan_status='blocked' AND storage_purged_at IS NULL");
            result.metrics = [metric("denied_logins", n(events.denied), "count", n(events.total)), metric("access_changes", n(events.access_changes), "count", n(events.total)), metric("recorded_document_access", n(events.document_access), "count", n(events.total)), metric("active_staff", n(users.staff)), metric("staff_mfa_enrolled", n(users.mfa)), metric("staff_mfa_coverage", n(users.staff) ? 100 * n(users.mfa) / n(users.staff) : null, "percent", n(users.staff)), metric("blocked_assets", n(assets.n))];
            result.coverage.samples = n(events.total);
        }
        else if (selected === "jobs") {
            const queue = await one(client, `SELECT count(*)::int AS total,count(*) FILTER(WHERE state IN ('pending','batched'))::int AS pending,count(*) FILTER(WHERE state='running')::int AS running,count(*) FILTER(WHERE state='failed')::int AS failed,count(*) FILTER(WHERE state='uncertain')::int AS uncertain,count(*) FILTER(WHERE state='running' AND locked_at<now()-interval '10 minutes')::int AS expired,extract(epoch FROM now()-min(created_at) FILTER(WHERE state='pending')) AS oldest FROM outbox`);
            result.metrics = [...["pending", "running", "failed", "uncertain"].map(key => metric("outbox_" + key, n(queue[key]))), metric("expired_outbox_leases", n(queue.expired)), metric("oldest_pending_seconds", queue.oldest === null ? null : n(queue.oldest), "seconds", n(queue.pending)), metric("dead_letter_items", n(queue.failed), "count", n(queue.total), "FAILED_ITEMS_REQUIRE_EXPLICIT_REVIEW")];
            for (const [table, column, label] of [["crm_automation_runs", "status", "automation"], ["crm_transfer_jobs", "state", "transfer"], ["knowledge_ingestion_jobs", "state", "knowledge"], ["ai_jobs", "status", "ai"]]) {
                const rows = (await client.query(`SELECT ${column} AS state,count(*)::int AS n FROM ${table} GROUP BY ${column}`)).rows;
                for (const row of rows)
                    result.metrics.push(metric(label + "_" + row.state, n(row.n)));
            }
            result.coverage.samples = n(queue.total);
        }
        else if (selected === "notifications") {
            result.coverage.source = "durable-outbox-and-provider-acceptance-events";
            const channels = ["in-app", "email", "sms", "push", "telegram"];
            const events = (await client.query(`SELECT o.kind,e.status,count(DISTINCT e.outbox_id)::int AS n FROM delivery_events e JOIN outbox o ON o.id=e.outbox_id WHERE e.created_at>=$1 AND e.created_at<=$2 AND o.kind=ANY($3::text[]) GROUP BY o.kind,e.status`, [from, now, channels])).rows;
            const queued = (await client.query("SELECT kind,state,count(*)::int AS n FROM outbox WHERE kind=ANY($1::text[]) GROUP BY kind,state", [channels])).rows;
            for (const channel of channels) {
                const count = (status: string) => n(events.find(row => row.kind === channel && row.status === status)?.n), states = (...values: string[]) => queued.filter(row => row.kind === channel && values.includes(row.state)).reduce((sum, row) => sum + n(row.n), 0), accepted = count("accepted");
                result.observations.push({ id: channel, key: channel, state: events.some(row => row.kind === channel) ? "observed" : "unknown", sampledAt: now.toISOString(), metrics: [metric("queued", states("pending", "running", "batched")), metric("accepted", accepted, "count", accepted, "PROVIDER_ACCEPTANCE_ONLY"), metric("delivered", channel === "in-app" ? accepted : count("delivered") || null, "count", channel === "in-app" ? accepted : count("delivered"), "RECIPIENT_DELIVERY_REQUIRES_RECEIPT"), metric("bounced", count("bounced") || null, "count", count("bounced"), "NO_RECEIPT_IS_UNKNOWN"), metric("complained", count("complained") || null, "count", count("complained"), "NO_RECEIPT_IS_UNKNOWN"), metric("suppressed", states("cancelled")), metric("uncertain", states("uncertain"))], note: channel === "in-app" ? "IN_APP_PERSISTENCE_OBSERVED" : "PROVIDER_ACCEPTANCE_IS_NOT_RECIPIENT_DELIVERY" });
            }
            result.coverage.samples = events.reduce((sum, row) => sum + n(row.n), 0);
            result.metrics = [metric("external_delivery_enabled", process.env.NOTIFICATIONS_MODE === "live" ? 1 : 0, "count", 0, "CONFIGURATION_ONLY")];
        }
        else if (selected === "ai") {
            const row = await one(client, `SELECT count(*)::int AS n,count(*) FILTER(WHERE state='reserved')::int AS reserved,count(*) FILTER(WHERE state='uncertain')::int AS uncertain,count(*) FILTER(WHERE state='complete' AND actual_usd IS NULL)::int AS unpriced,coalesce(sum(reserved_usd) FILTER(WHERE state IN ('reserved','uncertain') OR state='complete' AND actual_usd IS NULL),0)::text AS reservation,coalesce(sum(actual_usd) FILTER(WHERE state='complete'),0)::text AS actual,percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM completed_at-created_at)*1000) FILTER(WHERE completed_at IS NOT NULL) AS latency,count(completed_at)::int AS timed FROM ai_usage WHERE created_at>=$1 AND created_at<=$2`, [from, now]);
            result.metrics = [metric("ai_requests", n(row.n)), metric("ai_reservations", n(row.reserved)), metric("ai_uncertain", n(row.uncertain)), metric("ai_unpriced_completions", n(row.unpriced)), metric("ai_reserved_usd", n(row.reservation), "usd", n(row.n)), metric("ai_actual_usd", n(row.actual), "usd", n(row.n), "REPORTED_COST_ONLY"), metric("ai_latency_p95", row.latency === null ? null : n(row.latency), "ms", n(row.timed)), metric("grounded_answer_rate", null, "percent", 0, "NO_GROUNDING_EVALUATION"), metric("chat_abstentions", null, "count", 0, "NO_ABSTENTION_MEASUREMENT")];
            const states = (await client.query("SELECT state,count(*)::int AS n FROM knowledge_sources GROUP BY state")).rows;
            for (const state of ["pending", "indexing", "ready", "failed", "uncertain", "withdrawn"])
                result.metrics.push(metric("knowledge_" + state, n(states.find(row2 => row2.state === state)?.n)));
            result.coverage.samples = n(row.n);
        }
        else if (selected === "storage") {
            const row = await one(client, `SELECT count(*)::int AS n,coalesce(sum(bytes),0)::text AS bytes,coalesce(sum(bytes) FILTER(WHERE visibility='private'),0)::text AS private,coalesce(sum(bytes) FILTER(WHERE EXISTS(SELECT 1 FROM asset_image_sources s WHERE s.original_asset_id=a.id)),0)::text AS originals,coalesce(sum(bytes) FILTER(WHERE EXISTS(SELECT 1 FROM asset_image_derivatives d WHERE d.asset_id=a.id)),0)::text AS derivatives,count(*) FILTER(WHERE scan_status IN ('pending','error'))::int AS quarantine FROM assets a WHERE storage_purged_at IS NULL`);
            const reserved = await one(client, "SELECT coalesce(sum(bytes),0)::text AS bytes,count(*)::int AS n,count(*) FILTER(WHERE expires_at<now())::int AS expired,count(*) FILTER(WHERE last_error IS NOT NULL)::int AS errors FROM storage_reservations WHERE state='reserved'");
            const quota = (await (await import('./storage-policy')).currentStoragePolicy(client)).limits.totalBytes;
            result.metrics = [metric("stored_assets", n(row.n)), metric("stored_bytes", n(row.bytes), "bytes", n(row.n)), metric("private_bytes", n(row.private), "bytes", n(row.n)), metric("image_original_bytes", n(row.originals), "bytes", n(row.n)), metric("image_derivative_bytes", n(row.derivatives), "bytes", n(row.n)), metric("reserved_storage_bytes", n(reserved.bytes), "bytes", n(reserved.n)), metric("storage_quota_bytes", quota, "bytes", 0, "CONFIGURATION_ONLY"), metric("storage_quota_percent", 100 * (n(row.bytes) + n(reserved.bytes)) / quota, "percent", n(row.n)), metric("quarantined_assets", n(row.quarantine)), metric("expired_storage_reservations", n(reserved.expired)), metric("storage_cleanup_errors", n(reserved.errors)), metric("storage_reconciliation", null, "count", 0, "NO_FULL_FILESYSTEM_RECONCILIATION_EVIDENCE")];
            result.coverage.samples = n(row.n);
        }
        else if (selected === "infrastructure") {
            result.observations = await latestProbes(client, ["database", "worker", "process", "public_tls"]);
            result.metrics = [metric("host_coexistence_health", null, "count", 0, "CONTAINER_HAS_NO_HOST_INVENTORY"), metric("deployment_commit_verified", result.release.commitSha ? 1 : null, "count", 0, result.release.commitSha ? "RELEASE_METADATA_ONLY" : "COMMIT_SHA_NOT_CONFIGURED")];
            result.coverage = { source: "observed-worker-process-and-configured-host-probes", samples: result.observations.filter(item => item.sampledAt).length, truncated: false };
        }
        else if (selected === "recovery") {
            const rows = (await client.query("SELECT DISTINCT ON(operation) id,operation,success,finished_at,archive_bytes,migration_count,table_count,privacy_replay,release_id,failure_code FROM ops_recovery_evidence ORDER BY operation,finished_at DESC,id DESC")).rows;
            for (const operation of ["backup", "verify-only", "restore-drill", "restore-replace"]) {
                const row = rows.find(item => item.operation === operation);
                if (!row) {
                    result.observations.push({ id: operation, key: operation, state: "unknown", sampledAt: null, metrics: [], note: "NO_RECOVERY_RUN_EVIDENCE" });
                    continue;
                }
                const age = (now.getTime() - row.finished_at.getTime()) / 1e3, threshold = operation === "backup" ? 30 * 3600 : 30 * 86400;
                result.observations.push({ id: row.id, key: operation, state: !row.success ? "breaching" : age > threshold ? "stale" : "passing", sampledAt: row.finished_at.toISOString(), metrics: [metric("recovery_age_seconds", age, "seconds", 1), metric("archive_bytes", n(row.archive_bytes), "bytes", 1), metric("migration_count", row.migration_count), metric("table_count", row.table_count), metric("privacy_replay_confirmed", row.privacy_replay ? 1 : 0)], note: row.failure_code || "RECORDED_COMPLETED_OPERATOR_RUN" });
            }
            result.metrics = [metric("rollback_release_readiness", null, "count", 0, "A_PRIOR_ARCHIVE_IS_NOT_A_VERIFIED_COMPATIBLE_ROLLBACK")];
            result.coverage = { source: "append-only-completed-recovery-run-evidence", samples: rows.length, truncated: false };
        }
        return result;
    });
}
export { monitoring };
