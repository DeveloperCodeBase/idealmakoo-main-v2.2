import type {WorkspaceRecord,PageDraft} from '../data/workspace-seed';
export interface DamUsage {id:string;bucket:string;locale:Locale|null;title:string;state:'draft'|'historical'|'published'|'scheduled'}
import type { Actor } from './types';
import type { Locale } from '../lib/i18n';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { readableRecord, hasWorkspacePermission } from "./workspace-policy";
import { resourceUsageVisible } from "./resources";
import { redactCrmRecord } from "./workspace-scopes";
import { referencesAsset } from "../lib/asset-references";
const limit = 1e3;
function title(actor: Actor, data: WorkspaceRecord | PageDraft, locale?: Locale) {
    if (typeof data.title === "string")
        return data.title;
    const language = locale || actor.allowedLocales[0] as Locale | undefined;
    return language ? data.title[language] || data.id : data.id;
}
function visible(actor: Actor, bucket: string, data: WorkspaceRecord | PageDraft, locale?: Locale) { return (!locale || actor.allowedLocales.includes(locale)) && (bucket === "records" ? (readableRecord)(actor, data as WorkspaceRecord) : (hasWorkspacePermission)(actor, "view", "pages", locale || ("locale" in data ? data.locale : undefined))); }
async function readDamUsage(client: PoolClient, actor: Actor, assetId: string) {
    const usage: DamUsage[] = [];
    let bounded = false;
    const add = (item: DamUsage) => {
        if (usage.length < 201)
            usage.push(item);
    };
    const resources = (await client.query(`SELECT v.id,v.resource_id,v.number,v.locale,r.title,r.visibility,r.status,r.current_version_id,
   EXISTS(SELECT 1 FROM resource_publications p WHERE p.version_id=v.id) AS published
   FROM resource_versions v JOIN resources r ON r.id=v.resource_id WHERE v.asset_id=$1 AND v.locale=ANY($2::text[]) ORDER BY r.id,v.number DESC LIMIT $3`, [assetId, actor.allowedLocales, limit + 1])).rows;
    bounded ||= resources.length > limit;
    for (const row of resources.slice(0, limit))
        if ((resourceUsageVisible)(actor, row, row.locale))
            add({ id: row.id, bucket: "resource_versions", locale: row.locale, title: (row.title[row.locale] || row.resource_id) + " \xB7 " + row.number, state: row.status === "published" && row.current_version_id === row.id ? "published" : row.published || row.status === "archived" ? "historical" : "draft" });
    if ((hasWorkspacePermission)(actor, "view", "pages")) {
        const shared = (await client.query(`SELECT r.id,b.name,b.active,r.locale,r.revision_number,(SELECT max(latest.revision_number) FROM shared_block_revisions latest WHERE latest.block_id=r.block_id AND latest.locale=r.locale) AS latest
    FROM shared_block_asset_refs a JOIN shared_block_revisions r ON r.id=a.revision_id JOIN shared_blocks b ON b.id=r.block_id
    WHERE a.asset_id=$1 AND r.locale=ANY($2::text[]) ORDER BY b.id,r.locale,r.revision_number DESC LIMIT $3`, [assetId, actor.allowedLocales, limit + 1])).rows;
        bounded ||= shared.length > limit;
        for (const row of shared.slice(0, limit))
            if ((hasWorkspacePermission)(actor, "view", "pages", row.locale))
                add({ id: row.id, bucket: "shared_blocks", locale: row.locale, title: row.name + " \xB7 " + row.revision_number, state: row.active && row.revision_number === row.latest ? "draft" : "historical" });
    }
    const evidence = (await client.query(`SELECT e.id,e.data FROM crm_domain_asset_refs r JOIN workspace_entities e ON e.bucket=r.record_bucket AND e.id=r.record_id
   WHERE r.asset_id=$1 AND e.deleted_at IS NULL AND e.status<>'archived' ORDER BY e.id LIMIT $2`, [assetId, limit + 1])).rows;
    bounded ||= evidence.length > limit;
    if (evidence.length) {
        const { canReadCrmDomainEvidence } = await import("./workspace-domain-core");
        for (const row of evidence.slice(0, limit))
            if ((readableRecord)(actor, row.data) && await canReadCrmDomainEvidence(client, actor, row.id, assetId))
                add({ id: row.id, bucket: "crm_evidence", locale: null, title: title(actor, (redactCrmRecord)(actor, row.data)), state: "historical" });
    }
    const candidates = (await client.query(`SELECT e.id,e.bucket,e.data FROM workspace_entities e WHERE e.deleted_at IS NULL AND e.bucket IN ('records','pages')
   AND (strpos(lower(e.data::text),$1)>0 OR strpos(e.data::text,'%')>0)
   AND NOT EXISTS(SELECT 1 FROM crm_domain_asset_refs r WHERE r.asset_id=$1 AND r.record_bucket=e.bucket AND r.record_id=e.id)
   ORDER BY e.bucket,e.id LIMIT $2`, [assetId, limit + 1])).rows;
    bounded ||= candidates.length > limit;
    for (const row of candidates.slice(0, limit)) {
        if (!visible(actor, row.bucket, row.data))
            continue;
        const data = row.bucket === "records" ? (redactCrmRecord)(actor, row.data) : row.data;
        if ((referencesAsset)(data, assetId))
            add({ id: row.id, bucket: row.bucket, locale: "locale" in data ? data.locale : null, title: title(actor, data), state: "draft" });
    }
    const releases = (await client.query(`SELECT r.document_id,r.document_bucket,r.locale,r.publication,r.unpublished_at,w.data FROM locale_releases r
   JOIN workspace_entities w ON w.bucket=r.document_bucket AND w.id=r.document_id AND w.deleted_at IS NULL
   WHERE r.locale=ANY($2::text[]) AND (strpos(lower(r.publication::text),$1)>0 OR strpos(r.publication::text,'%')>0)
   ORDER BY r.document_bucket,r.document_id,r.locale LIMIT $3`, [assetId, actor.allowedLocales, limit + 1])).rows;
    bounded ||= releases.length > limit;
    for (const row of releases.slice(0, limit))
        if (visible(actor, row.document_bucket, row.data, row.locale) && (referencesAsset)(row.publication, assetId))
            add({ id: row.document_id, bucket: row.document_bucket, locale: row.locale, title: row.publication.title, state: row.unpublished_at ? "historical" : "published" });
    const scheduled = (await client.query(`SELECT r.document_id,r.document_bucket,r.locale,r.publication,w.data FROM workspace_publish_jobs r
   JOIN workspace_entities w ON w.bucket=r.document_bucket AND w.id=r.document_id AND w.deleted_at IS NULL
   WHERE r.status='pending' AND r.locale=ANY($2::text[]) AND (strpos(lower(r.publication::text),$1)>0 OR strpos(r.publication::text,'%')>0)
   ORDER BY r.due_at,r.id LIMIT $3`, [assetId, actor.allowedLocales, limit + 1])).rows;
    bounded ||= scheduled.length > limit;
    for (const row of scheduled.slice(0, limit))
        if (visible(actor, row.document_bucket, row.data, row.locale) && (referencesAsset)(row.publication, assetId))
            add({ id: row.document_id, bucket: row.document_bucket, locale: row.locale, title: row.publication.title, state: "scheduled" });
    return { usage: usage.slice(0, 200), usageTruncated: bounded || usage.length > 200 };
}
export { readDamUsage };
