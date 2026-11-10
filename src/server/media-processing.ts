import type {PgRow} from './recovered-db-rows';
import type {AssetRow} from './media';
import type {MediaProbe} from './media-engine';
type MediaJobRow=PgRow<'media_processing_jobs',{result:{probe?:MediaProbe}}>;
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { videoProfiles } from "../types/media-processing";
import { MEDIA_LIMITS, mediaEngineAvailable, processingTimeout, sanitizeWebVtt, probeLocalVideo, transcodeLocalVideo } from "./media-engine";
import { loadCrmAccess } from "./workspace-scopes";
import { assert, HttpError } from "./types";
import { canWorkspace } from "../lib/auth";
import { assetUsageAllowed } from "./asset-usage";
import { join } from "node:path";
import { config } from "./config";
import { lstat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { parse, rateLimit } from "./http";
import { transaction, audit, query } from "./db";
import { hash } from "./crypto";
import { lockWorkspace } from "./workspace";
import { storeAssetBatch } from "./storage";
const uuid = z.string().uuid(), reason = z.string().trim().min(8).max(500), key = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const base = { name: z.string().trim().min(1).max(170).regex(/^[^\x00-\x1f\x7f<>"\\/]+$/), rightsConfirmed: z.literal(true), idempotencyKey: key };
const createSchema = z.discriminatedUnion("kind", [z.object({ ...base, kind: z.literal("video"), profile: z.enum(videoProfiles) }).strict(), z.object({ ...base, kind: z.literal("subtitle"), locale: z.enum(["fa", "en", "tr", "ar", "ru"]), vtt: z.string().max(MEDIA_LIMITS.subtitleBytes) }).strict()]);
async function mediaActor(actor: Actor, client: PoolClient, write = false) { actor = await (loadCrmAccess)(actor, client); (assert)(actor.mfaVerified && (canWorkspace)(actor.role, "view", "media") && (!write || (canWorkspace)(actor.role, "create", "media") && (canWorkspace)(actor.role, "edit", "media")), 403, "FORBIDDEN", "Current media permission and staff MFA are required."); return actor; }
async function capturedActor(client: PoolClient, id: string) { const user = (await client.query("SELECT id,name,email,role,quality_scope,allowed_locales FROM users WHERE id=$1 AND active", [id])).rows[0]; (assert)(user, 403, "MEDIA_AUTHORIZATION_REVOKED", "The job creator is no longer active."); return mediaActor({ id: user.id, name: user.name, email: user.email, role: user.role, qualityScope: user.quality_scope, allowedLocales: user.allowed_locales, mfaVerified: true }, client, true); }
async function sourceAsset(client: PoolClient, actor: Actor, id: string, active = true) { const row = (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1 AND ($2=false OR deleted_at IS NULL AND storage_purged_at IS NULL) FOR SHARE", [id, active])).rows[0]; (assert)(row && row.metadata.damRole !== "original" && (row.visibility === "public" || row.owner_id === actor.id), 404, "NOT_FOUND", "Media source not found."); return row; }
async function policyVersion(client: PoolClient, id: string) { return Number((await client.query("SELECT version FROM asset_usage_policies WHERE asset_id=$1", [id])).rows[0]?.version || 0); }
async function validateSource(client: PoolClient, actor: Actor, id: string) { const row = await sourceAsset(client, actor, id); (assert)(row.mime_type === "video/mp4" && !row.request_id, 422, "MEDIA_SOURCE", "Select an unbound MP4 source from the media library."); (assert)(row.scan_status === "clean", 409, "QUARANTINED", "The source must pass its actual antivirus scan before processing."); (assert)(Number(row.bytes) > 0 && Number(row.bytes) <= MEDIA_LIMITS.inputBytes, 413, "MEDIA_INPUT_LIMIT", "The source exceeds80MiB."); (assert)(await (assetUsageAllowed)(id, client), 410, "RIGHTS_EXPIRED", "The source no longer has current distribution permission."); (assert)(!(await client.query("SELECT 1 FROM asset_media_derivatives WHERE asset_id=$1", [id])).rowCount, 422, "MEDIA_ROOT", "Create a new version from the retained source video."); (assert)(!(await client.query("SELECT 1 FROM resource_versions WHERE asset_id=$1 UNION ALL SELECT 1 FROM crm_domain_asset_refs WHERE asset_id=$1 UNION ALL SELECT 1 FROM tender_asset_refs WHERE asset_id=$1 LIMIT 1", [id])).rowCount, 409, "ASSET_IN_USE", "Controlled documents, confidential tender files or retained CRM evidence cannot be reprocessed as library media."); return row; }
async function safeSourcePath(row: AssetRow) {
    (assert)(/^(public|private)\/[a-f0-9-]+\.mp4$/.test(row.storage_key), 500, "STORAGE_KEY", "The media source path is invalid.");
    const path = (join)((config)().storageDir, row.storage_key);
    let info;
    try {
        info = await (lstat)(path);
    }
    catch {
        throw new HttpError(404, "FILE_MISSING", "The retained source file is unavailable.");
    }
    (assert)(info.isFile() && !info.isSymbolicLink() && info.size === Number(row.bytes) && info.size <= MEDIA_LIMITS.inputBytes, 422, "MEDIA_INPUT_LIMIT", "The retained source has an invalid size or file type.");
    const digest = (createHash)("sha256");
    for await (const chunk of (createReadStream)(path))
        digest.update(chunk);
    (assert)(digest.digest("hex") === row.sha256, 500, "FILE_INTEGRITY", "The retained source checksum does not match.");
    return path;
}
async function event(client: PoolClient, row: MediaJobRow, actorId: string | null, code: string | null = null) { await client.query("INSERT INTO media_processing_events(id,job_id,version,state,actor_id,code) VALUES($1,$2,$3,$4,$5,$6)", [(randomUUID)(), row.id, row.version, row.state, actorId, code]); }
function mayChange(actor: Actor, row: MediaJobRow) { return row.created_by === actor.id || ["superAdmin", "admin"].includes(actor.role); }
async function dto(client: PoolClient, actor: Actor, row: MediaJobRow) { const output = row.result_asset_id ? (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1", [row.result_asset_id])).rows[0] : void 0; const history = (await client.query("SELECT state,version,code,created_at FROM media_processing_events WHERE job_id=$1 ORDER BY version LIMIT 30", [row.id])).rows; const canManage = mayChange(actor, row) && (canWorkspace)(actor.role, "create", "media") && (canWorkspace)(actor.role, "edit", "media"); return { id: row.id, sourceAssetId: row.source_asset_id, kind: row.kind, profile: row.profile, locale: row.locale, name: row.name, state: row.state, version: row.version, attempts: row.attempts, createdBy: row.created_by, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), completedAt: row.completed_at?.toISOString() || null, lastError: row.last_error, sourceSha256: row.source_sha256, sourcePolicyVersion: Number(row.source_policy_version), probe: row.result.probe || null, output: output ? { assetId: output.id, url: output.visibility === "public" ? "/api/v1/media/" + output.id + "/content" : "/api/v1/attachments/" + output.id, filename: output.name, bytes: Number(output.bytes), mimeType: output.mime_type, sha256: output.sha256, scanStatus: output.scan_status, visibility: output.visibility, available: await (assetUsageAllowed)(output.id, client) } : null, canCancel: canManage && ["pending", "running", "scanning", "failed"].includes(row.state), canRetry: canManage && row.state === "failed" && !row.result_asset_id && row.attempts < 3, history: history.map(item => ({ state: item.state, version: item.version, code: item.code, at: item.created_at.toISOString() })) }; }
async function capabilities(actor: Actor) { return { enabled: process.env.MEDIA_PROCESSING_ENABLED === "true", engineAvailable: await (mediaEngineAvailable)(), profiles: [...videoProfiles], canCreate: (canWorkspace)(actor.role, "create", "media") && (canWorkspace)(actor.role, "edit", "media"), limits: { ...MEDIA_LIMITS, timeoutSeconds: (processingTimeout)() } }; }
async function listMediaProcessing(actor: Actor, options = {}) {
    const input = (parse)(z.object({ sourceAssetId: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict(), options);
    return (transaction)(async (client) => {
        actor = await mediaActor(actor, client);
        let source = null;
        if (input.sourceAssetId) {
            const asset = await sourceAsset(client, actor, input.sourceAssetId, false);
            let blocked = null;
            try {
                await validateSource(client, actor, input.sourceAssetId);
            }
            catch (error) {
                if (!(error instanceof HttpError))
                    throw error;
                blocked = error.code;
            }
            source = { assetId: asset.id, scanStatus: asset.scan_status, visibility: asset.visibility, eligible: blocked === null, reason: blocked };
        }
        const rows = (await client.query<MediaJobRow>(`SELECT j.* FROM media_processing_jobs j JOIN assets a ON a.id=j.source_asset_id WHERE (a.visibility='public' OR a.owner_id=$1) AND ($2::text IS NULL OR j.source_asset_id=$2) ORDER BY j.created_at DESC,j.id DESC LIMIT $3`, [actor.id, input.sourceAssetId || null, input.limit + 1])).rows;
        return { items: await Promise.all(rows.slice(0, input.limit).map(row => dto(client, actor, row))), capabilities: await capabilities(actor), truncated: rows.length > input.limit, source };
    });
}
async function getMediaProcessing(actor: Actor, id: string) { (parse)(uuid, id); return (transaction)(async (client) => { actor = await mediaActor(actor, client); const row = (await client.query<MediaJobRow>("SELECT * FROM media_processing_jobs WHERE id=$1", [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Media processing job not found."); await sourceAsset(client, actor, row.source_asset_id, false); return dto(client, actor, row); }); }
async function createMediaProcessing(actor: Actor, id: string, body: unknown) {
    (parse)(uuid, id);
    const input = (parse)(createSchema, body);
    (assert)(process.env.MEDIA_PROCESSING_ENABLED === "true", 503, "MEDIA_PROCESSING_DISABLED", "Local media processing is disabled.");
    (assert)(await (mediaEngineAvailable)(), 503, "MEDIA_ENGINE_UNAVAILABLE", "Install the configured local FFmpeg tools before creating a job.");
    (processingTimeout)();
    await (rateLimit)("media-processing:" + actor.id, 30, 3600);
    const vtt = input.kind === "subtitle" ? (sanitizeWebVtt)(input.vtt).text : null, requestHash = (hash)(JSON.stringify({ ...input, ...input.kind === "subtitle" ? { vtt } : {} }));
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await mediaActor(actor, client, true);
        const prior = (await client.query<MediaJobRow>("SELECT * FROM media_processing_jobs WHERE created_by=$1 AND idempotency_key=$2", [actor.id, input.idempotencyKey])).rows[0];
        if (prior) {
            (assert)(prior.request_hash === requestHash && prior.source_asset_id === id, 409, "IDEMPOTENCY_CONFLICT", "This command key was already used for another media transformation.");
            await sourceAsset(client, actor, id);
            return { job: await dto(client, actor, prior), duplicate: true };
        }
        const source = await validateSource(client, actor, id);
        const counts = (await client.query(`SELECT count(*) FILTER(WHERE source_asset_id=$1)::int AS source,count(*) FILTER(WHERE state IN ('pending','running','scanning'))::int AS active,count(*) FILTER(WHERE created_by=$2 AND state IN ('pending','running','scanning'))::int AS mine FROM media_processing_jobs`, [id, actor.id])).rows[0];
        (assert)(counts.source < 100 && counts.active < 100 && counts.mine < 20, 409, "MEDIA_JOB_LIMIT", "This source or processing queue reached its bounded capacity.");
        const row = (await client.query<MediaJobRow>(`INSERT INTO media_processing_jobs(id,source_asset_id,created_by,kind,profile,locale,name,subtitle_vtt,source_sha256,source_policy_version,idempotency_key,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [(randomUUID)(), id, actor.id, input.kind, input.kind === "video" ? input.profile : null, input.kind === "subtitle" ? input.locale : null, input.name, vtt, source.sha256, await policyVersion(client, id), input.idempotencyKey, requestHash])).rows[0];
        await event(client, row, actor.id);
        await (audit)(actor.id, "media.processing.created", "media_job", row.id, { sourceAssetId: id, kind: row.kind, profile: row.profile, locale: row.locale }, client);
        return { job: await dto(client, actor, row), duplicate: false };
    });
}
async function commandMediaProcessing(actor: Actor, id: string, body: unknown, expectedVersion: number) {
    (parse)(uuid, id);
    const input = (parse)(z.object({ action: z.enum(["cancel", "retry"]), reason }).strict(), body);
    (assert)(Number.isSafeInteger(expectedVersion) && expectedVersion > 0, 422, "VERSION", "Use the current media job version.");
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await mediaActor(actor, client, true);
        const row = (await client.query<MediaJobRow>("SELECT * FROM media_processing_jobs WHERE id=$1 FOR UPDATE", [id])).rows[0];
        (assert)(row, 404, "NOT_FOUND", "Media job not found.");
        await sourceAsset(client, actor, row.source_asset_id);
        (assert)(mayChange(actor, row), 403, "FORBIDDEN", "Only the creator or a current administrator can command this job.");
        (assert)(row.version === expectedVersion, 409, "CONFLICT", "The job changed. Load its current state before another command.");
        if (input.action === "retry") {
            (assert)(row.state === "failed" && !row.result_asset_id && row.attempts < 3, 409, "MEDIA_JOB_STATE", "Only an uncommitted failed job with fewer than3 attempts can be retried.");
            (assert)(process.env.MEDIA_PROCESSING_ENABLED === "true", 503, "MEDIA_PROCESSING_DISABLED", "Local processing is disabled.");
            const source = await validateSource(client, actor, row.source_asset_id);
            (assert)(source.sha256 === row.source_sha256 && await policyVersion(client, source.id) === Number(row.source_policy_version), 409, "MEDIA_SOURCE_CHANGED", "The source or rights changed. Review a new job instead.");
        }
        else
            (assert)(["pending", "running", "scanning", "failed"].includes(row.state), 409, "MEDIA_JOB_STATE", "This completed or cancelled job cannot be cancelled.");
        const updated = (await client.query<MediaJobRow>("UPDATE media_processing_jobs SET state=$2,version=version+1,lock_token=NULL,locked_until=NULL,last_error=$3,updated_at=now(),completed_at=CASE WHEN $2='cancelled' THEN now() ELSE NULL END WHERE id=$1 RETURNING *", [id, input.action === "cancel" ? "cancelled" : "pending", input.action === "cancel" ? "OPERATOR_CANCELLED" : null])).rows[0];
        await event(client, updated, actor.id, input.action === "cancel" ? "OPERATOR_CANCELLED" : "OPERATOR_RETRY");
        await (audit)(actor.id, "media.processing." + input.action, "media_job", id, { version: updated.version, reason: input.reason }, client);
        return dto(client, actor, updated);
    });
}
async function failRunning(id: string, token: string, code: string) {
    return (transaction)(async (client) => {
        const row = (await client.query<MediaJobRow>("UPDATE media_processing_jobs SET state='failed',version=version+1,lock_token=NULL,locked_until=NULL,last_error=$3,updated_at=now(),completed_at=now() WHERE id=$1 AND lock_token=$2 AND state='running' RETURNING *", [id, token, code])).rows[0];
        if (row) {
            await event(client, row, null, code);
            await (audit)(null, "media.processing.failed", "media_job", id, { code, attempts: row.attempts }, client);
        }
    });
}
async function reconcileMediaProcessing() {
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        const rows = (await client.query<MediaJobRow>("SELECT * FROM media_processing_jobs WHERE state='scanning' ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT 20")).rows;
        let changed = 0;
        for (const row of rows) {
            const asset = (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1", [row.result_asset_id])).rows[0];
            let code = null;
            try {
                const actor = await capturedActor(client, row.created_by), source = await validateSource(client, actor, row.source_asset_id);
                (assert)(source.sha256 === row.source_sha256 && await policyVersion(client, source.id) === Number(row.source_policy_version), 409, "MEDIA_SOURCE_CHANGED", "The source or rights changed.");
            }
            catch (error) {
                code = error instanceof HttpError && /^[A-Z0-9_]{3,80}$/.test(error.code) ? error.code : "MEDIA_AUTHORIZATION_REVOKED";
            }
            if (!asset || asset.deleted_at || asset.storage_purged_at)
                code = "MEDIA_OUTPUT_MISSING";
            else if (["blocked", "error"].includes(asset.scan_status))
                code = "MEDIA_SECURITY_SCAN_FAILED";
            if (!code && asset?.scan_status !== "clean")
                continue;
            const updated = (await client.query<MediaJobRow>("UPDATE media_processing_jobs SET state=$2,version=version+1,last_error=$3,updated_at=now(),completed_at=now() WHERE id=$1 RETURNING *", [row.id, code ? "failed" : "ready", code])).rows[0];
            await event(client, updated, null, code);
            await (audit)(null, code ? "media.processing.failed" : "media.processing.ready", "media_job", row.id, { code, assetId: row.result_asset_id }, client);
            changed++;
        }
        return { changed };
    });
}
async function runMediaProcessing() {
    const reconciled = await reconcileMediaProcessing();
    if (process.env.MEDIA_PROCESSING_ENABLED !== "true")
        return { processed: 0, reconciled: reconciled.changed };
    (processingTimeout)();
    const token = (randomUUID)(), job = await (transaction)(async (client) => {
        const lease = (await client.query("SELECT locked_until FROM media_processing_lease WHERE singleton FOR UPDATE")).rows[0];
        if (lease.locked_until && lease.locked_until.getTime() > Date.now())
            return null;
        const expired = (await client.query<MediaJobRow>("UPDATE media_processing_jobs SET state='failed',version=version+1,lock_token=NULL,locked_until=NULL,last_error='MEDIA_LEASE_EXPIRED',updated_at=now(),completed_at=now() WHERE state='running' AND locked_until<now() RETURNING *")).rows;
        for (const old of expired)
            await event(client, old, null, "MEDIA_LEASE_EXPIRED");
        const row = (await client.query<MediaJobRow>("SELECT * FROM media_processing_jobs WHERE state='pending' AND attempts<3 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
        if (!row)
            return null;
        const claimed = (await client.query<MediaJobRow>("UPDATE media_processing_jobs SET state='running',version=version+1,attempts=attempts+1,lock_token=$2,locked_until=now()+interval '600 seconds',updated_at=now(),last_error=NULL WHERE id=$1 RETURNING *", [row.id, token])).rows[0];
        await client.query("UPDATE media_processing_lease SET job_id=$1,lock_token=$2,locked_until=now()+interval '600 seconds' WHERE singleton", [row.id, token]);
        await event(client, claimed, null);
        return claimed;
    });
    if (!job)
        return { processed: 0, reconciled: reconciled.changed };
    const controller = new AbortController;
    let renewing = false;
    const heartbeat = setInterval(() => {
        if (renewing)
            return;
        renewing = true;
        void (transaction)(async (client) => {
            const lease = await client.query("SELECT singleton FROM media_processing_lease WHERE singleton AND lock_token=$1 FOR UPDATE", [token]);
            if (!lease.rowCount) {
                controller.abort();
                return;
            }
            const renewed = await client.query("UPDATE media_processing_jobs SET locked_until=now()+interval '600 seconds' WHERE id=$1 AND state='running' AND lock_token=$2 RETURNING id", [job.id, token]);
            if (!renewed.rowCount) {
                controller.abort();
                return;
            }
            await client.query("UPDATE media_processing_lease SET locked_until=now()+interval '600 seconds' WHERE singleton AND lock_token=$1", [token]);
        }).catch(() => controller.abort()).finally(() => { renewing = false; });
    }, 15e3);
    heartbeat.unref();
    try {
        const captured = await (transaction)(async (client) => { await (lockWorkspace)(client); const actor = await capturedActor(client, job.created_by), source = await validateSource(client, actor, job.source_asset_id); (assert)(source.sha256 === job.source_sha256 && await policyVersion(client, source.id) === Number(job.source_policy_version), 409, "MEDIA_SOURCE_CHANGED", "The source file or distribution right changed."); return { actor, source }; });
        const sourcePath = await safeSourcePath(captured.source), sourceProbe = await (probeLocalVideo)(sourcePath, controller.signal);
        let bytes, probe = sourceProbe;
        if (job.kind === "video") {
            const rendered = await (transcodeLocalVideo)(sourcePath, job.profile!, sourceProbe, controller.signal);
            bytes = rendered.bytes;
            probe = rendered.probe;
        }
        else {
            (sanitizeWebVtt)(job.subtitle_vtt, sourceProbe.durationSeconds);
            bytes = Buffer.from(job.subtitle_vtt!, "utf8");
        }
        (assert)(!controller.signal.aborted, 409, "MEDIA_JOB_CANCELLED", "The job was cancelled.");
        const extension = job.kind === "video" ? "mp4" : "vtt", name = job.name.replace(/\.(mp4|vtt)$/i, "") + "." + extension;
        await (storeAssetBatch)([{ ownerId: job.created_by, name, bytes, mimeType: job.kind === "video" ? "video/mp4" : "text/vtt", extension, visibility: captured.source.visibility, scanStatus: "pending", metadata: { rights: true, damRole: job.kind === "video" ? "video-derivative" : "subtitle", sourceAssetId: job.source_asset_id, processingJobId: job.id, ...job.locale ? { locale: job.locale } : {} } }], async (client, outputs) => { await (lockWorkspace)(client); const actor = await capturedActor(client, job.created_by), source = await validateSource(client, actor, job.source_asset_id); (assert)(source.sha256 === job.source_sha256 && source.visibility === captured.source.visibility && await policyVersion(client, source.id) === Number(job.source_policy_version), 409, "MEDIA_SOURCE_CHANGED", "The source or distribution rights changed before commit."); const owned = await client.query("SELECT id FROM media_processing_jobs WHERE id=$1 AND state='running' AND lock_token=$2 AND locked_until>now() FOR UPDATE", [job.id, token]); (assert)(owned.rowCount, 409, "MEDIA_JOB_CANCELLED", "The processing lease was revoked before commit."); await client.query("INSERT INTO asset_media_derivatives(asset_id,source_asset_id,job_id,kind,profile,locale,source_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [outputs[0].id, job.source_asset_id, job.id, job.kind, job.profile, job.locale, job.source_sha256, job.created_by]); const updated = (await client.query<MediaJobRow>("UPDATE media_processing_jobs SET state='scanning',version=version+1,lock_token=NULL,locked_until=NULL,result_asset_id=$3,result=$4::jsonb,updated_at=now() WHERE id=$1 AND lock_token=$2 RETURNING *", [job.id, token, outputs[0].id, JSON.stringify({ probe })])).rows[0]; await event(client, updated, null); await (audit)(job.created_by, "media.processing.encoded", "media_job", job.id, { assetId: outputs[0].id, sha256: outputs[0].sha256, kind: job.kind }, client); });
        return { processed: 1, reconciled: reconciled.changed };
    }
    catch (error) {
        const code = error instanceof HttpError && /^[A-Z0-9_]{3,80}$/.test(error.code) ? error.code : "MEDIA_PROCESSING_FAILED";
        await failRunning(job.id, token, code);
        return { processed: 1, reconciled: reconciled.changed, error: code };
    }
    finally {
        clearInterval(heartbeat);
        controller.abort();
        await (query)("UPDATE media_processing_lease SET job_id=NULL,lock_token=NULL,locked_until=NULL WHERE singleton AND lock_token=$1", [token]);
    }
}
export { commandMediaProcessing, createMediaProcessing, getMediaProcessing, listMediaProcessing, reconcileMediaProcessing, runMediaProcessing };
