import type { PoolClient } from 'pg';
import type { AssetRow } from './media';

export interface StoredAssetInput { ownerId: string | null; name: string; bytes: Buffer; extension: string; mimeType: string; visibility: 'public' | 'private'; scanStatus: AssetRow['scan_status']; metadata: Record<string, unknown> }
type ReservedAsset = {input: StoredAssetInput; id: string; storageKey: string; subject: string; checksum: string};

/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { assert, HttpError } from "./types";
import { open, unlink, mkdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";
import { transaction, audit, query } from "./db";
import { randomUUID, createHash } from "node:crypto";
import {currentStoragePolicy,assertFilePolicy} from './storage-policy';
import {HARD_MAX_UPLOAD_BYTES} from '../lib/upload-policy';
const quotaSubject = (ownerId: string | null, metadata: Record<string, unknown>) => ownerId ? "user:" + ownerId : "guest:" + String(metadata.guestHash || "legacy-unattributed");
async function storageLimits(client?:PoolClient) { const {limits}=await currentStoragePolicy(client);return{totalBytes:BigInt(limits.totalBytes),userBytes:BigInt(limits.userBytes),guestBytes:BigInt(limits.guestBytes)}; }
async function syncDirectory(path: string) {
    const directory = await (open)(path, "r");
    try {
        await directory.sync();
    }
    finally {
        await directory.close();
    }
}
async function removeFile(key: string) {
    (assert)(/^(public|private)\/[a-f0-9-]+\.[a-z0-9]+$/.test(key), 500, "STORAGE_KEY", "The stored file path is invalid.");
    try {
        await (unlink)((join)((config)().storageDir, key));
        await syncDirectory((join)((config)().storageDir, key.split("/")[0]));
        return true;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return true;
        return false;
    }
}
async function assertStorageCapacity(client:PoolClient,items:ReservedAsset[],addReservations:boolean){
        const {limits}=await currentStoragePolicy(client),quota={totalBytes:BigInt(limits.totalBytes),userBytes:BigInt(limits.userBytes),guestBytes:BigInt(limits.guestBytes)};
        for(const item of items)assertFilePolicy(limits,item.input.bytes.length,item.input.mimeType,item.input.ownerId);
        const occupied = (await client.query(`WITH occupied AS (
    SELECT bytes,quota_subject AS subject FROM assets WHERE storage_purged_at IS NULL
    UNION ALL SELECT bytes,subject_key FROM storage_reservations WHERE state='reserved'
  ) SELECT subject,coalesce(sum(bytes),0)::text AS bytes FROM occupied GROUP BY subject`)).rows;
        const current = new Map(occupied.map(row => [row.subject, BigInt(row.bytes)]));
        const added = new Map<string, bigint>();
        for (const item of addReservations?items:[])
            added.set(item.subject, (added.get(item.subject) || 0n) + BigInt(item.input.bytes.length));
        const total = occupied.reduce((sum, row) => sum + BigInt(row.bytes), 0n) + (addReservations?items.reduce((sum, row) => sum + BigInt(row.input.bytes.length), 0n):0n);
        (assert)(total <= quota.totalBytes, 507, "STORAGE_QUOTA", "The server storage quota has been reached. Ask an administrator to release space or increase the configured quota.");
        for (const subject of new Set(items.map(item=>item.subject)))
            (assert)((current.get(subject) || 0n) + (added.get(subject)||0n) <= (subject.startsWith('guest:')?quota.guestBytes:quota.userBytes), 507, "STORAGE_USER_QUOTA", "Your upload quota has been reached. Ask an administrator to review retained files.");
}
async function reserveAssets(items: ReservedAsset[]) {
    await mkdir(config().storageDir,{recursive:true,mode:0o700});
    return (transaction)(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(917264834)");
        await assertStorageCapacity(client,items,true);
        const filesystem=await statfs(config().storageDir,{bigint:true});
        const pending=BigInt((await client.query("SELECT coalesce(sum(bytes),0)::text AS bytes FROM storage_reservations WHERE state='reserved'")).rows[0].bytes),newBytes=items.reduce((sum,item)=>sum+BigInt(item.input.bytes.length),0n);
        assert(filesystem.bavail*filesystem.bsize>pending+newBytes+64n*1024n*1024n,507,'STORAGE_DISK_FULL','The upload volume has insufficient free space. Ask an administrator to free space or extend the volume.');
        for (const item of items)
            await client.query("INSERT INTO storage_reservations(id,storage_key,subject_key,bytes,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes')", [item.id, item.storageKey, item.subject, item.input.bytes.length]);
    });
}
async function storeAssetBatch(inputs: StoredAssetInput[], onCommit?: (client: PoolClient, rows: AssetRow[]) => Promise<unknown>): Promise<AssetRow[]> {
    (assert)(inputs.length > 0 && inputs.length <= 8, 422, "STORAGE_BATCH", "Store between one and eight files in one batch.");
    const items = inputs.map(input => { (assert)(input.bytes.length > 0 && input.bytes.length <= HARD_MAX_UPLOAD_BYTES, 413, "UPLOAD_SIZE", "The file is empty or exceeds the storage limit."); (assert)(/^[a-z0-9]{1,12}$/.test(input.extension), 500, "STORAGE_EXTENSION", "Invalid server file extension."); const id = (randomUUID)(); return { input, id, storageKey: `${input.visibility}/${id}.${input.extension}`, subject: quotaSubject(input.ownerId, input.metadata), checksum: (createHash)("sha256").update(input.bytes).digest("hex") }; });
    await reserveAssets(items);
    try {
        for (const { input, storageKey } of items) {
            await (mkdir)((join)((config)().storageDir, input.visibility), { recursive: true, mode: 448 });
            const file = await (open)((join)((config)().storageDir, storageKey), "wx", 384);
            try {
                await file.writeFile(input.bytes);
                await file.sync();
            }
            finally {
                await file.close();
            }
            await syncDirectory((join)((config)().storageDir, input.visibility));
        }
        return await (transaction)(async (client) => {
            // Recheck a policy tightened while bytes were being written. Acquire
            // workspace before quota lock, matching admin policy mutations.
            await client.query('SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE');
            await client.query('SELECT pg_advisory_xact_lock(917264834)');
            await assertStorageCapacity(client,items,false);
            const rows: AssetRow[] = [];
            for (const { input, id, storageKey, subject, checksum } of items) {
                const reservation = (await client.query("SELECT * FROM storage_reservations WHERE id=$1 AND state='reserved' AND expires_at>now() FOR UPDATE", [id])).rows[0];
                (assert)(reservation, 409, "UPLOAD_EXPIRED", "This upload reservation expired. Please upload again.");
                if (input.ownerId)
                    (assert)((await client.query("SELECT 1 FROM users WHERE id=$1 AND active FOR KEY SHARE", [input.ownerId])).rowCount, 401, "SESSION_REQUIRED", "The uploading account is no longer active.");
                const row = (await client.query<AssetRow>("INSERT INTO assets(id,owner_id,name,storage_key,mime_type,bytes,sha256,visibility,scan_status,metadata,quota_subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *", [id, input.ownerId, input.name, storageKey, input.mimeType, input.bytes.length, checksum, input.visibility, input.scanStatus, JSON.stringify(input.metadata), subject])).rows[0];
                if (input.scanStatus !== "clean")
                    await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id) VALUES($1,'scan',$2::jsonb,$3,$4)", [(randomUUID)(), JSON.stringify({ assetId: id }), "scan:" + id, input.ownerId]);
                await client.query("UPDATE storage_reservations SET state='committed',completed_at=now() WHERE id=$1", [id]);
                await (audit)(input.ownerId, input.metadata.origin === "generated" ? "asset.generated" : "asset.uploaded", "asset", id, { mime: input.mimeType, bytes: input.bytes.length, visibility: input.visibility, sha256: checksum }, client);
                rows.push(row);
            }
            if (onCommit)
                await onCommit(client, rows);
            return rows;
        });
    }
    catch (error) {
        let committed: AssetRow[];
        try {
            committed = (await (query)<AssetRow>("SELECT * FROM assets WHERE id=ANY($1::text[])", [items.map(item => item.id)])).rows;
            if (committed.some(row => row.sha256 !== items.find(item => item.id === row.id)?.checksum))
                throw new Error("Asset reconciliation checksum mismatch");
        }
        catch {
            throw new HttpError(503, "STORAGE_UNCERTAIN", "The upload result could not be confirmed. Its reservations remain for reconciliation.");
        }
        if (committed.length === items.length)
            return items.map(item => committed.find(row => row.id === item.id)!);
        if (committed.length)
            throw new HttpError(503, "STORAGE_UNCERTAIN", "A batch consistency check failed. Retained bytes require operator reconciliation.");
        for (const { id, storageKey } of items) {
            const removed = await removeFile(storageKey);
            await (query)("UPDATE storage_reservations SET state=CASE WHEN $2 THEN 'released' ELSE 'reserved' END,completed_at=CASE WHEN $2 THEN now() ELSE NULL END,expires_at=now(),last_error=$3 WHERE id=$1 AND state='reserved'", [id, removed, removed ? "Upload did not commit." : "Could not remove an uncommitted file."]);
        }
        if (error instanceof HttpError)
            throw error;
        throw new HttpError(503, "STORAGE_WRITE", "The upload could not be stored safely. Please retry.");
    }
}
async function storeAsset(input: StoredAssetInput): Promise<AssetRow> { return (await storeAssetBatch([input]))[0]; }
async function cleanupStorageReservations() {
    return (transaction)(async (client) => {
        const rows = (await client.query("SELECT * FROM storage_reservations WHERE state='reserved' AND expires_at<=now() ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 25")).rows;
        let released = 0;
        for (const row of rows) {
            const asset = (await client.query("SELECT storage_key FROM assets WHERE id=$1", [row.id])).rows[0];
            if (asset) {
                await client.query("UPDATE storage_reservations SET state='committed',completed_at=now(),last_error=NULL WHERE id=$1", [row.id]);
                continue;
            }
            if (await removeFile(row.storage_key)) {
                await client.query("UPDATE storage_reservations SET state='released',completed_at=now(),last_error=NULL WHERE id=$1", [row.id]);
                released++;
            }
            else
                await client.query("UPDATE storage_reservations SET last_error='Uncommitted file cleanup failed.',expires_at=now()+interval '5 minutes' WHERE id=$1", [row.id]);
        }
        await client.query("DELETE FROM storage_reservations WHERE state<>'reserved' AND completed_at<now()-interval '7 days'");
        return { released };
    });
}
async function storageUsage(ownerId?: string | null) { const quota = await storageLimits(); const subject = ownerId ? "user:" + ownerId : null; const row = (await (query)("SELECT (SELECT coalesce(sum(bytes),0)::text FROM assets WHERE storage_purged_at IS NULL AND ($1::text IS NULL OR quota_subject=$1)) AS stored,(SELECT coalesce(sum(bytes),0)::text FROM storage_reservations WHERE state='reserved' AND ($1::text IS NULL OR subject_key=$1)) AS reserved", [subject])).rows[0]; return { storedBytes: row.stored, reservedBytes: row.reserved, quotaBytes: String(ownerId ? quota.userBytes : quota.totalBytes) }; }
export { cleanupStorageReservations, storageLimits, storageUsage, storeAsset, storeAssetBatch };
