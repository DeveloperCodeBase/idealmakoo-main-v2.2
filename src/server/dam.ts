import type {PgRow} from './recovered-db-rows';
import type {AssetRow} from './media';
import type {WorkspaceChange} from './workspace-policy';
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { loadCrmAccess } from "./workspace-scopes";
import { assert, HttpError } from "./types";
import { canWorkspace } from "../lib/auth";
import { parse, rateLimit } from "./http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";
import { createHash } from "node:crypto";
import { transaction, audit } from "./db";
import { lockWorkspace } from "./workspace";
import sharp from "sharp";
import { readDamUsage } from "./dam-usage";
import { assetUsageAllowed } from "./asset-usage";
import { storeAssetBatch } from "./storage";
const uuid = z.string().uuid();
const recipeSchema = z.object({ crop: z.object({ left: z.number().int().min(0).max(32e6), top: z.number().int().min(0).max(32e6), width: z.number().int().min(1).max(32e6), height: z.number().int().min(1).max(32e6) }).strict(), outputWidth: z.number().int().min(1).max(4096), outputHeight: z.number().int().min(1).max(4096), fit: z.enum(["inside", "cover"]), quality: z.number().int().min(40).max(95) }).strict();
const policySchema = z.object({ rightsConfirmed: z.boolean(), rightsExpiresAt: z.string().datetime({ offset: true }).nullable(), licenseNote: z.string().trim().max(2e3) }).strict();
async function mediaActor(actor: Actor, client: PoolClient) { actor = await (loadCrmAccess)(actor, client); (assert)(actor.mfaVerified && (canWorkspace)(actor.role, "view", "media"), 403, "FORBIDDEN", "Media management requires current staff permission and MFA."); return actor; }
async function mediaAsset(client: PoolClient, actor: Actor, id: string) { (parse)(uuid, id); const row = (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL AND storage_purged_at IS NULL FOR SHARE", [id])).rows[0]; (assert)(row && row.metadata.damRole !== "original" && (row.visibility === "public" || row.owner_id === actor.id), 404, "NOT_FOUND", "Media asset not found."); return row; }
function policyDto(row: PgRow<'asset_usage_policies'> | undefined, asset: AssetRow) { return { version: Number(row?.version || 0), rightsConfirmed: row?.rights_confirmed ?? (asset.visibility === "private" || asset.metadata.rights === true), rightsExpiresAt: row?.rights_expires_at?.toISOString() || null, licenseNote: row?.license_note || "" }; }
async function policyFor(client: PoolClient, asset: AssetRow) { return policyDto((await client.query<PgRow<'asset_usage_policies'>>("SELECT * FROM asset_usage_policies WHERE asset_id=$1", [asset.id])).rows[0], asset); }
async function validateDamMediaChanges(client: PoolClient, changes: readonly WorkspaceChange[]) {
    for (const change of changes) {
        if (change.bucket !== "media" || !change.after)
            continue;
        const medium = change.after;
        const asset = (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1", [change.id])).rows[0];
        if (!asset)
            continue;
        (assert)(asset.metadata.damRole !== "original", 422, "PRIVATE_ORIGINAL", "Raw source originals cannot be added to the ordinary media library.");
        (assert)(medium.rights === (await policyFor(client, asset)).rightsConfirmed, 422, "MEDIA_RIGHTS_COMMAND", "Change distribution rights through the versioned media rights control.");
    }
}
async function imageSource(client: PoolClient, asset: AssetRow) { const derivative = (await client.query("SELECT source_asset_id FROM asset_image_derivatives WHERE asset_id=$1", [asset.id])).rows[0]; const sourceId = derivative?.source_asset_id || asset.id; const row = (await client.query("SELECT * FROM asset_image_sources WHERE asset_id=$1", [sourceId])).rows[0]; return { sourceId, row }; }
async function sourceBytes(asset: AssetRow) {
    (assert)(/^(public|private)\/[a-f0-9-]+\.[a-z0-9]+$/.test(asset.storage_key), 500, "STORAGE_KEY", "The stored image path is invalid.");
    let bytes;
    try {
        bytes = await (readFile)((join)((config)().storageDir, asset.storage_key));
    }
    catch {
        throw new HttpError(404, "FILE_MISSING", "The source image is unavailable.");
    }
    (assert)((createHash)("sha256").update(bytes).digest("hex") === asset.sha256, 500, "FILE_INTEGRITY", "The source file checksum does not match.");
    return bytes;
}
async function getDamAsset(actor: Actor, id: string) {
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await mediaActor(actor, client);
        const asset = await mediaAsset(client, actor, id), source = await imageSource(client, asset);
        const original = source.row ? (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL AND storage_purged_at IS NULL", [source.row.original_asset_id])).rows[0] : void 0;
        let width = 0, height = 0;
        if (asset.mime_type.startsWith("image/")) {
            if (source.row && original?.owner_id === actor.id) {
                width = source.row.width;
                height = source.row.height;
            }
            else {
                const base = source.sourceId === asset.id ? asset : await mediaAsset(client, actor, source.sourceId);
                const metadata = await (sharp)(await sourceBytes(base), { limitInputPixels: 32e6, failOn: "error" }).metadata();
                width = metadata.width || 0;
                height = metadata.height || 0;
            }
        }
        const derivatives = (await client.query("SELECT a.id,a.visibility,a.name,a.bytes,d.recipe,d.created_at,a.deleted_at FROM asset_image_derivatives d JOIN assets a ON a.id=d.asset_id WHERE d.source_asset_id=$1 AND (a.visibility='public' OR a.owner_id=$2) ORDER BY d.created_at DESC,a.id LIMIT 101", [source.sourceId, actor.id])).rows;
        const usages = await (readDamUsage)(client, actor, id);
        return { id, sourceAssetId: source.sourceId, sourceWidth: width, sourceHeight: height, originalAvailable: !!original, originalUrl: original?.owner_id === actor.id ? `/api/v1/attachments/${original.id}` : null, policy: await policyFor(client, asset), effectiveRights: await (assetUsageAllowed)(id, client), canManage: (canWorkspace)(actor.role, "edit", "media"), derivatives: derivatives.slice(0, 100).map(row => ({ id: row.id, url: row.visibility === "public" ? `/api/v1/media/${row.id}/content` : `/api/v1/attachments/${row.id}`, filename: row.name, bytes: Number(row.bytes), recipe: row.recipe, createdAt: row.created_at.toISOString(), archived: !!row.deleted_at })), ...usages, usageTruncated: usages.usageTruncated || derivatives.length > 100 };
    });
}
async function updateDamPolicy(actor: Actor, id: string, body: unknown, expectedVersion: number) {
    (parse)(uuid, id);
    const input = (parse)(policySchema, body);
    if (input.rightsConfirmed && input.rightsExpiresAt)
        (assert)(Date.parse(input.rightsExpiresAt) > Date.now(), 422, "RIGHTS_EXPIRED", "A renewed distribution right must expire in the future.");
    return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await mediaActor(actor, client); (assert)((canWorkspace)(actor.role, "edit", "media"), 403, "FORBIDDEN", "Media editing is not permitted."); const asset = await mediaAsset(client, actor, id), previous = await policyFor(client, asset); (assert)(previous.version === expectedVersion, 409, "CONFLICT", "The media rights changed. Refresh before saving."); const row = (await client.query<PgRow<'asset_usage_policies'>>(`INSERT INTO asset_usage_policies(asset_id,rights_confirmed,rights_expires_at,license_note,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(asset_id) DO UPDATE SET rights_confirmed=excluded.rights_confirmed,rights_expires_at=excluded.rights_expires_at,license_note=excluded.license_note,updated_by=excluded.updated_by,updated_at=now(),version=asset_usage_policies.version+1 RETURNING *`, [id, input.rightsConfirmed, input.rightsExpiresAt, input.licenseNote, actor.id])).rows[0]; await client.query("UPDATE assets SET metadata=jsonb_set(metadata,'{rights}',to_jsonb($2::boolean)) WHERE id=$1", [id, input.rightsConfirmed]); await client.query("UPDATE workspace_entities SET data=jsonb_set(data,'{rights}',to_jsonb($2::boolean)),updated_by=$3,updated_at=now(),revision_number=revision_number+1 WHERE bucket='media' AND id=$1", [id, input.rightsConfirmed, actor.id]); await client.query("UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton"); await (audit)(actor.id, "asset.rights.updated", "asset", id, { rightsConfirmed: input.rightsConfirmed, rightsExpiresAt: input.rightsExpiresAt, version: Number(row.version) }, client); return { policy: policyDto(row, asset), effectiveRights: await (assetUsageAllowed)(id, client) }; });
}
async function createImageDerivative(actor: Actor, id: string, body: unknown) {
    (parse)(uuid, id);
    const input = (parse)(z.object({ recipe: recipeSchema, name: z.string().trim().min(1).max(170), rightsConfirmed: z.literal(true) }).strict(), body);
    await (rateLimit)("image-derivative:" + actor.id, 30, 3600);
    const captured = await (transaction)(async (client) => { await (lockWorkspace)(client); actor = await mediaActor(actor, client); (assert)((canWorkspace)(actor.role, "create", "media") && (canWorkspace)(actor.role, "edit", "media"), 403, "FORBIDDEN", "Creating an image derivative is not permitted."); const source = await mediaAsset(client, actor, id); (assert)(source.mime_type.startsWith("image/") && source.scan_status === "clean" && !source.request_id, 422, "IMAGE_SOURCE", "Select an available, unbound image from the media library."); (assert)(await (assetUsageAllowed)(id, client), 410, "RIGHTS_EXPIRED", "The source image has no current distribution rights."); (assert)(!(await client.query("SELECT 1 FROM asset_image_derivatives WHERE asset_id=$1", [id])).rowCount, 422, "IMAGE_ROOT", "Create another crop from the retained source image."); (assert)(!(await client.query("SELECT 1 FROM resource_versions WHERE asset_id=$1 UNION ALL SELECT 1 FROM crm_domain_asset_refs WHERE asset_id=$1 UNION ALL SELECT 1 FROM tender_asset_refs WHERE asset_id=$1", [id])).rowCount, 409, "ASSET_IN_USE", "Controlled documents and CRM evidence cannot become ordinary image derivatives."); (assert)(Number((await client.query("SELECT count(*) AS n FROM asset_image_derivatives WHERE source_asset_id=$1", [id])).rows[0].n) < 100, 409, "IMAGE_VARIANT_LIMIT", "This source already retains 100 derivatives. Preserve it and upload a new source."); const family = (await client.query("SELECT * FROM asset_image_sources WHERE asset_id=$1", [id])).rows[0]; const original = family ? (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL AND storage_purged_at IS NULL AND visibility='private'", [family.original_asset_id])).rows[0] : source; (assert)(original, 404, "FILE_MISSING", "The source original is unavailable."); const inputAsset = original.owner_id === actor.id ? original : source; (assert)(inputAsset.scan_status === "clean", 409, "QUARANTINED", "The retained source is unavailable until its security scan succeeds."); return { source, inputAsset, bytes: await sourceBytes(inputAsset) }; });
    let bytes, width, height;
    try {
        const normalized = await (sharp)(captured.bytes, { limitInputPixels: 32e6, failOn: "error" }).rotate().toBuffer({ resolveWithObject: true });
        width = normalized.info.width;
        height = normalized.info.height;
        const crop = input.recipe.crop;
        (assert)(crop.left + crop.width <= width && crop.top + crop.height <= height, 422, "IMAGE_CROP", "The crop must fit inside the source image.");
        bytes = await (sharp)(normalized.data, { limitInputPixels: 32e6 }).extract(crop).resize({ width: input.recipe.outputWidth, height: input.recipe.outputHeight, fit: input.recipe.fit, withoutEnlargement: true }).webp({ quality: input.recipe.quality }).toBuffer();
    }
    catch (error) {
        if (error instanceof HttpError)
            throw error;
        throw new HttpError(422, "IMAGE_INVALID", "The image could not be decoded or transformed safely.");
    }
    const name = input.name.replace(/\.(?:png|jpe?g|webp)$/i, "") + ".webp";
    const created = (await (storeAssetBatch)([{ ownerId: actor.id, name, bytes, mimeType: "image/webp", extension: "webp", visibility: captured.source.visibility, scanStatus: "clean", metadata: { rights: true, damRole: "derivative", sourceAssetId: id } }], async (client, rows) => { await (lockWorkspace)(client); actor = await mediaActor(actor, client); (assert)((canWorkspace)(actor.role, "create", "media") && (canWorkspace)(actor.role, "edit", "media"), 403, "FORBIDDEN", "Media creation permission changed."); const current = await mediaAsset(client, actor, id); (assert)(current.sha256 === captured.source.sha256 && !current.request_id && await (assetUsageAllowed)(id, client), 409, "IMAGE_SOURCE_CHANGED", "The source file or distribution right changed. Refresh before creating a derivative."); (assert)(Number((await client.query("SELECT count(*) AS n FROM asset_image_derivatives WHERE source_asset_id=$1", [id])).rows[0].n) < 100, 409, "IMAGE_VARIANT_LIMIT", "The source reached its derivative limit."); (assert)(!(await client.query("SELECT 1 FROM resource_versions WHERE asset_id=$1 UNION ALL SELECT 1 FROM crm_domain_asset_refs WHERE asset_id=$1 UNION ALL SELECT 1 FROM tender_asset_refs WHERE asset_id=$1 LIMIT 1", [id])).rowCount, 409, "ASSET_IN_USE", "The source became retained evidence or a controlled document."); const currentInput = (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL AND storage_purged_at IS NULL FOR SHARE", [captured.inputAsset.id])).rows[0]; (assert)(currentInput?.scan_status === "clean" && currentInput.sha256 === captured.inputAsset.sha256, 409, "IMAGE_SOURCE_CHANGED", "The retained input file changed or its security scan was withdrawn."); await client.query("INSERT INTO asset_image_derivatives(asset_id,source_asset_id,recipe,source_sha256,created_by) VALUES($1,$2,$3::jsonb,$4,$5)", [rows[0].id, id, JSON.stringify(input.recipe), captured.inputAsset.sha256, actor.id]); await (audit)(actor.id, "asset.derivative.created", "asset", rows[0].id, { sourceAssetId: id, recipe: input.recipe }, client); }))[0];
    return { id: created.id, url: created.visibility === "public" ? `/api/v1/media/${created.id}/content` : `/api/v1/attachments/${created.id}`, filename: created.name, size: Number(created.bytes), mimeType: created.mime_type, scanStatus: created.scan_status };
}
export { assetUsageAllowed } from "./asset-usage";
export { createImageDerivative, getDamAsset, updateDamPolicy, validateDamMediaChanges };
