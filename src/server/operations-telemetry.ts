/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { publicMetricRoutes } from "../types/monitoring";
import { assert } from "./types";
import { parse, rateLimit, visitorKey } from "./http";
import { transaction } from "./db";
import { operationalRoute } from "../lib/operational-routes";
const TELEMETRY_RETENTION_DAYS = 7;
function browserMeasurementConfig() { return { enabled: process.env.MONITORING_BROWSER_METRICS_ENABLED === "true", consentVersion: "analytics-v1", retentionDays: TELEMETRY_RETENTION_DAYS }; }
const browserBase = { eventId: z.string().uuid(), consent: z.literal(true), consentVersion: z.literal("analytics-v1"), route: z.enum(publicMetricRoutes), locale: z.enum(["fa", "en", "tr", "ar", "ru"]) };
const browserSchema = z.discriminatedUnion("event", [z.object({ ...browserBase, event: z.literal("product_view"), value: z.literal(1) }).strict(), z.object({ ...browserBase, event: z.literal("LCP"), value: z.number().finite().min(0).max(12e4) }).strict(), z.object({ ...browserBase, event: z.literal("INP"), value: z.number().finite().min(0).max(12e4) }).strict(), z.object({ ...browserBase, event: z.literal("CLS"), value: z.number().finite().min(0).max(100) }).strict()]);
async function recordBrowserMeasurement(request: Request, body: unknown) {
    (assert)(browserMeasurementConfig().enabled, 503, "METRICS_DISABLED", "Optional browser measurements are disabled.");
    const input = (parse)(browserSchema, body);
    (assert)(input.event !== "product_view" || input.route === "product", 422, "METRIC_ROUTE", "A product view belongs to the public product route.");
    await (rateLimit)("browser-metric:" + (visitorKey)(request), 60, 60);
    await (rateLimit)("browser-metric-global", 1200, 60);
    return (transaction)(async (client) => {
        const existing = (await client.query("SELECT event,route_key,locale,value,consent_version FROM ops_browser_samples WHERE event_id=$1", [input.eventId])).rows[0];
        if (existing) {
            (assert)(existing.event === input.event && existing.route_key === input.route && existing.locale === input.locale && Number(existing.value) === input.value && existing.consent_version === input.consentVersion, 409, "IDEMPOTENCY_CONFLICT", "This measurement identifier was already used.");
            return { accepted: true, duplicate: true };
        }
        const capacity = await client.query("UPDATE ops_telemetry_capacity SET browser_rows=browser_rows+1 WHERE singleton AND browser_rows<50000 RETURNING singleton");
        (assert)(capacity.rowCount, 503, "METRICS_CAPACITY", "The bounded measurement buffer is full.");
        const duplicate = (await client.query("SELECT event,route_key,locale,value,consent_version FROM ops_browser_samples WHERE event_id=$1", [input.eventId])).rows[0];
        if (duplicate) {
            await client.query("UPDATE ops_telemetry_capacity SET browser_rows=browser_rows-1 WHERE singleton");
            (assert)(duplicate.event === input.event && duplicate.route_key === input.route && duplicate.locale === input.locale && Number(duplicate.value) === input.value && duplicate.consent_version === input.consentVersion, 409, "IDEMPOTENCY_CONFLICT", "This measurement identifier was already used.");
            return { accepted: true, duplicate: true };
        }
        await client.query("INSERT INTO ops_browser_samples(event_id,event,route_key,locale,value,consent_version) VALUES($1,$2,$3,$4,$5,$6)", [input.eventId, input.event, input.route, input.locale, input.value, input.consentVersion]);
        return { accepted: true, duplicate: false };
    });
}
async function recordOperationalRequest(input: { path: string; requestId: string; method: string; statusCode: number; durationMs: number }) {
    const route = (operationalRoute)(input.path);
    if (!route || !z.string().uuid().safeParse(input.requestId).success || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(input.method) || !Number.isInteger(input.statusCode) || input.statusCode < 100 || input.statusCode > 599 || !Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 6e5)
        return false;
    try {
        return await (transaction)(async (client) => {
            await client.query("SELECT singleton FROM ops_telemetry_capacity WHERE singleton FOR UPDATE");
            if ((await client.query("SELECT id FROM ops_http_samples WHERE id=$1", [input.requestId])).rowCount)
                return false;
            await client.query(`INSERT INTO ops_http_totals(minute,route_key,requests,failures) VALUES(date_trunc('minute',now()),$1,1,$2)
      ON CONFLICT(minute,route_key) DO UPDATE SET requests=ops_http_totals.requests+1,failures=ops_http_totals.failures+excluded.failures`, [route, input.statusCode >= 500 ? 1 : 0]);
            const capacity = await client.query("UPDATE ops_telemetry_capacity SET http_rows=http_rows+1 WHERE singleton AND http_rows<200000 RETURNING singleton");
            if (!capacity.rowCount)
                return false;
            const inserted = await client.query("INSERT INTO ops_http_samples(id,method,route_key,status_code,duration_ms) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id", [input.requestId, input.method, route, input.statusCode, Math.round(input.durationMs * 1e3) / 1e3]);
            if (!inserted.rowCount)
                await client.query("UPDATE ops_telemetry_capacity SET http_rows=http_rows-1 WHERE singleton");
            return !!inserted.rowCount;
        });
    }
    catch {
        return false;
    }
}
async function pruneOperationalMeasurements() {
    return (transaction)(async (client) => {
        await client.query("SELECT singleton FROM ops_telemetry_capacity WHERE singleton FOR UPDATE");
        let removed = 0;
        for (const [table, key, target] of [["ops_http_samples", "id", 19e4], ["ops_browser_samples", "event_id", 45e3]]) {
            const result = await client.query(`DELETE FROM ${table} WHERE ${key} IN(SELECT ${key} FROM ${table} WHERE observed_at<now()-interval '7 days' ORDER BY observed_at,${key} LIMIT 50000)`);
            removed += result.rowCount || 0;
            const excess = await client.query(`DELETE FROM ${table} WHERE ${key} IN(SELECT ${key} FROM ${table} ORDER BY observed_at DESC,${key} DESC OFFSET $1)`, [target]);
            removed += excess.rowCount || 0;
        }
        await client.query("UPDATE ops_telemetry_capacity SET http_rows=(SELECT count(*) FROM ops_http_samples),browser_rows=(SELECT count(*) FROM ops_browser_samples) WHERE singleton");
        await client.query("DELETE FROM ops_http_totals WHERE minute<now()-interval '7 days'");
        await client.query("DELETE FROM ops_probe_samples WHERE observed_at<now()-interval '30 days'");
        await client.query("DELETE FROM ops_slo_observations s WHERE observed_at<now()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM ops_incidents i WHERE i.slo_observation_id=s.id)");
        return { removed };
    });
}
export { TELEMETRY_RETENTION_DAYS, browserMeasurementConfig, pruneOperationalMeasurements, recordBrowserMeasurement, recordOperationalRequest };
