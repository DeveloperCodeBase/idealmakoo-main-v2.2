import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { query } from "./db";
async function assetUsageAllowed(assetId: string, client?: PoolClient) {
    const sql = `WITH RECURSIVE derivative_edges AS (
    SELECT asset_id,source_asset_id FROM asset_image_derivatives
    UNION ALL SELECT asset_id,source_asset_id FROM asset_media_derivatives
  ), lineage AS (
    SELECT a.id,a.visibility,a.metadata,a.deleted_at,a.storage_purged_at,a.scan_status,ARRAY[a.id] AS seen,0 AS depth
    FROM assets a WHERE a.id=$1
    UNION ALL
    SELECT parent.id,parent.visibility,parent.metadata,parent.deleted_at,parent.storage_purged_at,parent.scan_status,l.seen||parent.id,l.depth+1
    FROM lineage l JOIN derivative_edges d ON d.asset_id=l.id JOIN assets parent ON parent.id=d.source_asset_id
    WHERE l.depth<8 AND NOT parent.id=ANY(l.seen)
  ) SELECT l.id,l.deleted_at,l.storage_purged_at,l.scan_status,l.metadata->>'damRole' AS role,
    coalesce(p.rights_confirmed,CASE WHEN l.visibility='public' THEN l.metadata->>'rights'='true' ELSE true END,false) AS permitted,
    p.rights_expires_at IS NULL OR p.rights_expires_at>now() AS unexpired,
    EXISTS(SELECT 1 FROM derivative_edges d WHERE d.asset_id=l.id AND (l.depth=8 OR d.source_asset_id=ANY(l.seen))) AS invalid_lineage,
    NOT EXISTS(SELECT 1 FROM asset_media_derivatives d JOIN media_processing_jobs j ON j.id=d.job_id WHERE d.asset_id=l.id AND j.state<>'ready') AS processing_ready
    FROM lineage l LEFT JOIN asset_usage_policies p ON p.asset_id=l.id`;
    const result = client ? await client.query(sql, [assetId]) : await (query)(sql, [assetId]);
    return result.rows.length > 0 && result.rows.every(row => !row.deleted_at && !row.storage_purged_at && row.scan_status === "clean" && row.role !== "original" && row.permitted && row.unexpired && !row.invalid_lineage && row.processing_ready);
}
export { assetUsageAllowed };
