import type {CertificateSourceCandidate} from '../types/company-certificates';
import type { PgRow } from './recovered-db-rows';
import type { Localized } from '../lib/i18n';
export type ResourceRow = PgRow<'resources', {title: Localized; summary: Localized}>;
export type ResourceVersionRow = PgRow<'resource_versions', {metadata_snapshot: ReturnType<typeof snapshot>}> & {reviewed?: boolean};
type DataRoomRow = PgRow<'data_rooms', {title: Localized; summary: Localized}>;
type ResourcePermission = {view: boolean; download: boolean};
import type { Actor } from './types';
import type { Locale } from '../lib/i18n';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { assert, HttpError } from "./types";
import { loadCrmAccess, canAccessCrmRequest } from "./workspace-scopes";
import { createHash, randomUUID } from "node:crypto";
import { canWorkspace } from "../lib/auth";
import { parse, rateLimit, visitorKey } from "./http";
import { transaction, audit, query } from "./db";
import { lockWorkspace,getPublicSite } from "./workspace";
import {isPublicPathVisible} from '../lib/public-visibility';
import {getSourcePublicVisibility} from './workspace-public-visibility';
import type {PublicResourceSearchResult,ResourceDto} from '../types/resources';
import { resources } from "../data/catalog";
import { referenceDocuments } from "../data/reference-documents";
import { assetUsageAllowed } from "./asset-usage";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";
import { strToU8, zipSync } from "fflate";
const localeSchema = z.enum(["fa", "en", "tr", "ar", "ru"]);
const resourceLocales = localeSchema.options;
function requireLocale(actor: Actor, locale: Locale) { (assert)(actor.allowedLocales.includes(locale), 403, "CONTENT_LOCALE", "This document language is outside your current permissions."); }
function localizedChanges(actor: Actor, before: Localized | undefined, after: Localized | undefined) {
    if (after) {
        for (const locale of resourceLocales)
            if (after[locale] !== before?.[locale])
                requireLocale(actor, locale);
    }
}
function allLocales(actor: Actor) { return resourceLocales.every(locale => actor.allowedLocales.includes(locale)); }
async function currentActor(client: PoolClient, actor: Actor) { const current = await (loadCrmAccess)(actor, client); (assert)(current.mfaVerified && current.role !== "customer", 403, "FORBIDDEN", "Document administration requires current staff permission and MFA."); return current; }
const titleSchema = z.object({ fa: z.string().trim().min(1).max(240), en: z.string().trim().min(1).max(240), tr: z.string().trim().min(1).max(240), ar: z.string().trim().min(1).max(240), ru: z.string().trim().min(1).max(240) }).strict();
const summarySchema = z.object({ fa: z.string().max(5e3), en: z.string().max(5e3), tr: z.string().max(5e3), ar: z.string().max(5e3), ru: z.string().max(5e3) }).strict();
const emptySummary = { fa: "", en: "", tr: "", ar: "", ru: "" };
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(120);
const kindSchema = z.enum(["catalog", "brochure", "ifu", "sds", "shade", "mould", "research", "other"]);
const visibilitySchema = z.enum(["public", "authenticated", "restricted"]);
const uuid = (id: string) => (assert)(z.string().uuid().safeParse(id).success, 404, "NOT_FOUND", "Document not found.");
const digest = (value: unknown) => (createHash)("sha256").update(JSON.stringify(value)).digest("hex");
function snapshot(row: ResourceRow) { return { slug: row.slug, title: row.title, summary: row.summary, type: row.type, visibility: row.visibility, roomId: row.room_id }; }
function roomManager(actor: Actor | null) { return !!actor?.mfaVerified && (["admin", "superAdmin"].includes(actor.role) || actor.role === "business" && actor.crmAccess?.permissions.financial === true); }
function capabilities(actor: Actor | null, row: Pick<ResourceRow,'visibility'>) { const restricted = row.visibility === "restricted"; return { edit: !!actor?.mfaVerified && (restricted ? roomManager(actor) : (canWorkspace)(actor.role, "edit", "resources")), review: !!actor?.mfaVerified && (restricted ? roomManager(actor) : (canWorkspace)(actor.role, "review", "resources")), publish: !!actor?.mfaVerified && (restricted ? roomManager(actor) : (canWorkspace)(actor.role, "publish", "resources")), manageGrants: roomManager(actor) }; }
function managerRead(actor: Actor | null, row: Pick<ResourceRow,'visibility'>) { return !!actor?.mfaVerified && (row.visibility === "restricted" ? roomManager(actor) : (canWorkspace)(actor.role, "view", "resources")); }
function resourceUsageVisible(actor: Actor, row: Pick<ResourceRow,'visibility'>, locale: Locale) { return actor.allowedLocales.includes(locale) && managerRead(actor, row); }
function requireCapability(actor: Actor, row: Pick<ResourceRow,'visibility'>, action: 'edit' | 'review' | 'publish' | 'manageGrants') { (assert)(capabilities(actor, row)[action], 403, "FORBIDDEN", "Your current role cannot perform this document operation."); }
async function loadResource(client: PoolClient, id: string, exclusive = false) { uuid(id); const row = (await client.query<ResourceRow>(`SELECT * FROM resources WHERE id=$1 FOR ${exclusive ? "UPDATE" : "SHARE"}`, [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Document not found."); return row; }
async function requireCurrentVersionLocale(client: PoolClient, actor: Actor, row: ResourceRow) {
    if (row.status === "published" && row.current_version_id) {
        const current = (await client.query("SELECT locale FROM resource_versions WHERE id=$1 AND resource_id=$2", [row.current_version_id, row.id])).rows[0];
        (assert)(current, 409, "VERSION_MISSING", "The current published document version is unavailable.");
        requireLocale(actor, current.locale);
    }
}
async function loadRoom(client: PoolClient, id: string, exclusive = false) { uuid(id); const row = (await client.query<DataRoomRow>(`SELECT * FROM data_rooms WHERE id=$1 FOR ${exclusive ? "UPDATE" : "SHARE"}`, [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Data room not found."); return row; }
async function requireDocumentAssetBinding(client: PoolClient, assetId: string, resourceId: string) {
    const retained = (await client.query(`SELECT 1 FROM crm_domain_asset_refs WHERE asset_id=$1
    UNION ALL SELECT 1 FROM shared_block_asset_refs WHERE asset_id=$1
    UNION ALL SELECT 1 FROM asset_image_sources WHERE asset_id=$1 OR original_asset_id=$1
    UNION ALL SELECT 1 FROM asset_image_derivatives WHERE asset_id=$1 OR source_asset_id=$1
    UNION ALL SELECT 1 FROM asset_media_derivatives WHERE asset_id=$1 OR source_asset_id=$1
    UNION ALL SELECT 1 FROM media_processing_jobs WHERE source_asset_id=$1
    UNION ALL SELECT 1 FROM tender_asset_refs WHERE asset_id=$1
    UNION ALL SELECT 1 FROM resource_versions WHERE asset_id=$1 AND resource_id<>$2
    LIMIT 1`, [assetId, resourceId])).rowCount;
    (assert)(!retained, 409, "ASSET_IN_USE", "This file is already retained by another document, private evidence or media source. Select a separate unbound document upload.");
}
async function versions(client: PoolClient, id: string, manage: boolean) : Promise<ResourceVersionRow[]> { return (await client.query(`SELECT v.*,coalesce((SELECT decision='approved' FROM resource_reviews rr WHERE rr.version_id=v.id ORDER BY rr.created_at DESC,rr.id DESC LIMIT 1),false) AS reviewed FROM resource_versions v WHERE v.resource_id=$1 ${manage ? "" : "AND EXISTS(SELECT 1 FROM resource_publications p WHERE p.resource_id=v.resource_id AND p.version_id=v.id)"} ORDER BY v.number DESC`, [id])).rows; }
function versionDto(row: ResourceVersionRow, manage = false) { return { id: row.id, number: row.number, label: row.label, locale: row.locale, filename: row.filename, mimeType: row.mime_type, bytes: Number(row.bytes), sha256: row.sha256, rightsExpiresAt: row.rights_expires_at?.toISOString() || null, reviewed: row.reviewed, createdAt: row.created_at.toISOString(), ...manage ? { createdBy: row.created_by } : {} }; }
async function grantPermission(client: PoolClient, actor: Actor | null, resourceId: string | null, roomId: string | null) {
    if (!actor)
        return { view: false, download: false };
    const user = (await client.query("SELECT active,email_verified FROM users WHERE id=$1 FOR SHARE", [actor.id])).rows[0];
    if (!user?.active || !user.email_verified)
        return { view: false, download: false };
    const organizations = (await client.query("SELECT m.organization_id FROM organization_memberships m JOIN customer_organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND m.active AND o.archived_at IS NULL FOR SHARE OF m,o", [actor.id])).rows.map(row => row.organization_id);
    const rows = (await client.query<PgRow<'access_grants'>>("SELECT * FROM access_grants WHERE revoked_at IS NULL AND expires_at>now() AND (user_id=$1 OR organization_id=ANY($2::uuid[])) AND (($3::uuid IS NOT NULL AND resource_id=$3) OR ($4::uuid IS NOT NULL AND room_id=$4)) FOR SHARE", [actor.id, organizations, resourceId, roomId])).rows;
    return { view: rows.some(row => row.can_view), download: rows.some(row => row.can_download) };
}
async function publicPermission(client: PoolClient, actor: Actor | null, row: ResourceRow) {
    if (row.status !== "published")
        return { view: false, download: false };
    if (row.room_id && (await loadRoom(client, row.room_id)).status !== "published")
        return { view: false, download: false };
    if (row.visibility === "public")
        return { view: true, download: true };
    if (row.visibility === "authenticated") {
        const user = actor && (await client.query("SELECT 1 FROM users WHERE id=$1 AND active AND email_verified FOR SHARE", [actor.id])).rowCount;
        return { view: !!user, download: !!user };
    }
    return grantPermission(client, actor, row.id, row.room_id);
}
async function resourceDto(client: PoolClient, row: ResourceRow, actor: Actor | null, locale: Locale, manage = false, history = false) { const all = (await versions(client, row.id, manage)).filter(version => !manage || actor?.allowedLocales.includes(version.locale)); const current = all.find(version => version.id === row.current_version_id); const permission = manage ? { view: true, download: true } : await publicPermission(client, actor, row); return { id: row.id, slug: row.slug, title: manage ? row.title : row.title[locale], summary: manage ? row.summary : row.summary[locale], type: row.type, visibility: row.visibility, roomId: row.room_id, status: row.status, version: row.version, currentVersion: current ? versionDto(current, manage) : null, permissions: permission, ...history || manage ? { versions: all.map(version => versionDto(version, manage)) } : {}, ...manage ? { capabilities: capabilities(actor, row) } : {} }; }
async function listResources(actor: Actor | null, options: {locale?: string; roomId?: string; manage?: boolean} = {}) {
    const locale = (parse)(localeSchema, options.locale || "fa");
    if (options.roomId)
        uuid(options.roomId);
    return (transaction)(async (client) => {
        if (actor) {
            await (lockWorkspace)(client);
            actor = await (loadCrmAccess)(actor, client);
        }
        if (options.manage)
            (assert)(actor?.mfaVerified && (roomManager(actor) || (canWorkspace)(actor.role, "view", "resources")), 403, "FORBIDDEN", "You cannot manage documents.");
        const rows = (await client.query<ResourceRow>(`SELECT * FROM resources WHERE ($1::uuid IS NULL OR room_id=$1) ${options.manage ? "" : "AND status='published'"} ORDER BY updated_at DESC,id LIMIT 1000`, [options.roomId || null])).rows;
        const items = [];
        for (const row of rows) {
            if (options.manage ? !managerRead(actor, row) : !(await publicPermission(client, actor, row)).view)
                continue;
            items.push(await resourceDto(client, row, actor, locale, !!options.manage, !!options.manage));
        }
        return { items, ...options.manage ? { capabilities: { create: !!actor?.mfaVerified && allLocales(actor) && (roomManager(actor) || (canWorkspace)(actor.role, "create", "resources")), manageRooms: roomManager(actor) } } : {} };
    });
}
async function getResource(actor: Actor | null, idOrSlug: string, localeInput = "fa") {
    const locale = (parse)(localeSchema, localeInput);
    (assert)(idOrSlug.length <= 160, 404, "NOT_FOUND", "Document not found.");
    return (transaction)(async (client) => {
        if (actor) {
            await (lockWorkspace)(client);
            actor = await (loadCrmAccess)(actor, client);
        }
        const row = (await client.query<ResourceRow>("SELECT * FROM resources WHERE id::text=$1 OR slug=$1", [idOrSlug])).rows[0];
        (assert)(row && (await publicPermission(client, actor, row)).view, 404, "NOT_FOUND", "Document not found.");
        return resourceDto(client, row, actor, locale, false, true);
    });
}
/** A page may expose only the current reviewed document metadata. This read has
 * no management override, download side effect or private version projection. */
async function getResourcePage(actor: Actor | null, idOrSlug: string, localeInput = "fa", connection?:PoolClient): Promise<Pick<ResourceDto, 'slug' | 'title' | 'summary' | 'visibility'> & {locales:Locale[]}> {
    const locale = parse(localeSchema, localeInput);
    assert(idOrSlug.length > 0 && idOrSlug.length <= 160, 404, "NOT_FOUND", "Document not found.");
    const read=async (client:PoolClient) => {
        // Internal callers may already hold the public workspace read lock.
        // Reuse that transaction instead of waiting on its lock in a new one.
        if(!connection)await lockWorkspace(client);
        if (actor) actor = await loadCrmAccess(actor, client);
        const row = (await client.query<ResourceRow>("SELECT * FROM resources WHERE id::text=$1 OR slug=$1 FOR SHARE", [idOrSlug])).rows[0];
        assert(row && (await publicPermission(client, actor, row)).view, 404, "NOT_FOUND", "Document not found.");
        const version = (await versions(client, row.id, false)).find(item => item.id === row.current_version_id);
        assert(version?.reviewed, 404, "NOT_FOUND", "Document not found.");
        const review = (await client.query<{decision: string; reviewer_id: string}>("SELECT decision,reviewer_id FROM resource_reviews WHERE version_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [version.id])).rows[0];
        assert(review?.decision === "approved" && review.reviewer_id !== version.created_by, 404, "NOT_FOUND", "Document not found.");
        assert(version.metadata_hash === digest(snapshot(row)), 404, "NOT_FOUND", "Document not found.");
        await availableBytes(client, version, false);
        return {slug: row.slug, title: row.title[locale], summary: row.summary[locale], visibility: parse(visibilitySchema, row.visibility), locales:row.visibility==='public'?resourceLocales.filter(value=>typeof row.title[value]==='string'&&row.title[value].trim()):[]};
    };
    return connection?read(connection):transaction(read);
}
async function wishlistResourceCandidates(client: PoolClient, actor: Actor | null, locale: Locale) {
    const rows = (await client.query<ResourceRow>("SELECT * FROM resources WHERE status='published' AND current_version_id IS NOT NULL ORDER BY id")).rows;
    const result = [];
    for (const row of rows) {
        if (!(await publicPermission(client, actor, row)).view)
            continue;
        const version = (await versions(client, row.id, false)).find(item => item.id === row.current_version_id && item.locale === locale && item.reviewed);
        if (!version)
            continue;
        try {
            await availableBytes(client, version, false);
        }
        catch (error) {
            if (error instanceof HttpError && [403, 404, 409, 410, 422].includes(error.status))
                continue;
            throw error;
        }
        result.push({ id: row.id, slug: row.slug, title: row.title[locale], summary: row.summary[locale], public: row.visibility === "public" });
    }
    return result;
}
/** Public search deliberately has no actor argument: even a signed-in staff
 * member receives only currently public, approved and usable documents. */
export async function searchPublicResources(input:unknown):Promise<PublicResourceSearchResult> {
    const options=parse(z.object({locale:localeSchema.default('fa'),q:z.string().trim().max(120).default(''),limit:z.coerce.number().int().min(1).max(30).default(12)}).strict(),input);
    return transaction(async client=>{
        // Use the same workspace-first ordering as publication and rights writes.
        const site=await getPublicSite(client);
        const needle='%'+options.q.replace(/[\\%_]/g,'\\$&')+'%';
        const rows=(await client.query<ResourceRow>(`SELECT r.* FROM resources r
          WHERE r.status='published' AND r.visibility='public' AND r.current_version_id IS NOT NULL
          AND ($2::text='' OR r.title->>$1 ILIKE $3 ESCAPE '\\' OR r.slug ILIKE $3 ESCAPE '\\' OR r.summary->>$1 ILIKE $3 ESCAPE '\\')
          ORDER BY (lower(r.slug)=lower($2)) DESC,(lower(r.title->>$1)=lower($2)) DESC,r.updated_at DESC,r.id
          LIMIT 121 FOR SHARE OF r`,[options.locale,options.q,needle])).rows;
        const items:PublicResourceSearchResult['items']=[];
        let truncated=rows.length>120;
        for(const row of rows.slice(0,120)){
            if(!isPublicPathVisible(site,options.locale,`resources/${row.slug}`)||!(await publicPermission(client,null,row)).view)continue;
            const version=(await versions(client,row.id,false)).find(value=>value.id===row.current_version_id&&value.reviewed);
            if(!version||version.metadata_hash!==digest(snapshot(row)))continue;
            const review=(await client.query<{reviewer_id:string;decision:string}>('SELECT reviewer_id,decision FROM resource_reviews WHERE version_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[version.id])).rows[0];
            if(!review||review.decision!=='approved'||review.reviewer_id===version.created_by)continue;
            try{await availableBytes(client,version,false);}catch(error){if(error instanceof HttpError&&([403,404,409,410,422].includes(error.status)||error.code==='FILE_INTEGRITY'))continue;throw error;}
            if(items.length===options.limit){truncated=true;break;}
            items.push({id:row.id,slug:row.slug,title:row.title[options.locale],summary:row.summary[options.locale].slice(0,600),type:row.type,versionId:version.id,version:version.number,label:version.label,documentLocale:version.locale});
        }
        return{items,truncated};
    });
}
/** Public certificate evidence uses the controlled resource ACL; no raw asset URL escapes. */
async function certificateResourceSources(client:PoolClient,locale:Locale,selection?:{resourceId:string;versionId:string}):Promise<CertificateSourceCandidate[]> {
    const rows=(await client.query<ResourceRow>("SELECT * FROM resources WHERE visibility='public' AND status='published' AND current_version_id IS NOT NULL"+(selection?" AND id=$1 AND current_version_id=$2":"")+" ORDER BY updated_at DESC,id LIMIT 200 FOR SHARE",selection?[selection.resourceId,selection.versionId]:[])).rows;
    const result:CertificateSourceCandidate[]=[];
    for(const row of rows){
        if(!(await publicPermission(client,null,row)).view)continue;
        const version=(await versions(client,row.id,false)).find(value=>value.id===row.current_version_id&&value.reviewed);
        if(!version)continue;
        const review=(await client.query<{decision:string;reviewer_id:string}>("SELECT decision,reviewer_id FROM resource_reviews WHERE version_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[version.id])).rows[0];
        if(!review||review.decision!=='approved'||review.reviewer_id===version.created_by)continue;
        try{await availableBytes(client,version,false);}catch(error){if(error instanceof HttpError&&[403,404,409,410,422].includes(error.status))continue;throw error;}
        result.push({resourceId:row.id,versionId:version.id,locale:version.locale,title:row.title[locale],label:version.label,sha256:version.sha256,href:`/api/v1/resources/${row.id}/versions/${version.id}/content?action=view`});
    }
    return result;
}
async function createResource(actor: Actor, body: unknown) {
    const input = (parse)(z.object({ slug: slugSchema, title: titleSchema, summary: summarySchema.default(emptySummary), type: kindSchema, visibility: visibilitySchema.default("public"), roomId: z.string().uuid().nullable().optional() }).strict(), body);
    (assert)(actor.mfaVerified && (input.visibility === "restricted" ? roomManager(actor) : (canWorkspace)(actor.role, "create", "resources")), 403, "FORBIDDEN", "You cannot create this document.");
    (assert)(!input.roomId || input.visibility === "restricted", 422, "ROOM_VISIBILITY", "Data room documents must remain restricted.");
    (assert)(![...resources, ...referenceDocuments].some(row => row.slug === input.slug) && input.slug !== "official-site-archive", 409, "SLUG_CONFLICT", "This address belongs to an existing source document. Choose a new document address.");
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor);
        (assert)(input.visibility === "restricted" ? roomManager(actor) : (canWorkspace)(actor.role, "create", "resources"), 403, "FORBIDDEN", "You cannot create this document.");
        localizedChanges(actor, void 0, input.title);
        localizedChanges(actor, void 0, input.summary);
        if (input.roomId)
            await loadRoom(client, input.roomId);
        (assert)(!(await client.query("SELECT 1 FROM resources WHERE slug=$1", [input.slug])).rowCount, 409, "SLUG_CONFLICT", "This document address is already in use.");
        const row = (await client.query<ResourceRow>("INSERT INTO resources(id,slug,title,summary,type,visibility,room_id,created_by,updated_by) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$8) RETURNING *", [(randomUUID)(), input.slug, JSON.stringify(input.title), JSON.stringify(input.summary), input.type, input.visibility, input.roomId || null, actor.id])).rows[0];
        await (audit)(actor.id, "resource.created", "resource", row.id, { visibility: row.visibility }, client);
        return resourceDto(client, row, actor, "fa", true, true);
    });
}
async function updateResource(actor: Actor, id: string, body: unknown, expected: number) {
    const input = (parse)(z.object({ title: titleSchema.optional(), summary: summarySchema.optional(), type: kindSchema.optional(), visibility: visibilitySchema.optional(), status: z.enum(["draft", "archived"]).optional() }).strict(), body);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor);
        const row = await loadResource(client, id, true);
        requireCapability(actor, row, "edit");
        localizedChanges(actor, row.title, input.title);
        localizedChanges(actor, row.summary, input.summary);
        (assert)(row.version === expected, 409, "CONFLICT", "The document changed. Refresh and retry.");
        if (input.visibility && input.visibility !== row.visibility) {
            requireCapability(actor, row, "publish");
            (assert)(roomManager(actor), 403, "FORBIDDEN", "Only authorized data administrators can change document audience.");
        }
        if (input.status && input.status !== row.status || input.visibility && input.visibility !== row.visibility || input.type && input.type !== row.type)
            (assert)(allLocales(actor), 403, "CONTENT_LOCALE", "Changing shared document state, audience or type requires permission for every language.");
        await requireCurrentVersionLocale(client, actor, row);
        (assert)(!row.room_id || !input.visibility || input.visibility === "restricted", 422, "ROOM_VISIBILITY", "Data room documents must remain restricted.");
        const next = (await client.query<ResourceRow>("UPDATE resources SET title=$2::jsonb,summary=$3::jsonb,type=$4,visibility=$5,status=$6,version=version+1,updated_by=$7,updated_at=now() WHERE id=$1 RETURNING *", [id, JSON.stringify(input.title ?? row.title), JSON.stringify(input.summary ?? row.summary), input.type ?? row.type, input.visibility ?? row.visibility, input.status ?? "draft", actor.id])).rows[0];
        await (audit)(actor.id, "resource.updated", "resource", id, { fields: Object.keys(input), version: next.version }, client);
        return resourceDto(client, next, actor, "fa", true, true);
    });
}
async function addResourceVersion(actor: Actor, id: string, body: unknown, expected: number) {
    const input = (parse)(z.object({ assetId: z.string().uuid(), label: z.string().trim().min(1).max(160), locale: localeSchema, rightsConfirmed: z.literal(true), rightsExpiresAt: z.string().datetime({ offset: true }).nullable().optional() }).strict(), body);
    if (input.rightsExpiresAt)
        (assert)(Date.parse(input.rightsExpiresAt) > Date.now(), 422, "RIGHTS_EXPIRED", "The distribution right must not already be expired.");
    return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor); requireLocale(actor, input.locale); const row = await loadResource(client, id, true); requireCapability(actor, row, "edit"); (assert)(row.version === expected, 409, "CONFLICT", "The document changed. Refresh and retry."); (assert)(row.status !== "archived", 409, "ARCHIVED", "Restore this document to draft before adding a version."); const asset = (await client.query("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL FOR SHARE", [input.assetId])).rows[0]; (assert)(asset && asset.owner_id === actor.id && !asset.request_id, 404, "NOT_FOUND", "Select your own unbound document upload."); (assert)(asset.visibility === "private", 422, "PRIVATE_ASSET_REQUIRED", "Upload this controlled document as private."); await requireDocumentAssetBinding(client, asset.id, id); (assert)(asset.scan_status === "clean", 409, "QUARANTINED", "Wait for a successful file security scan."); (assert)(await (assetUsageAllowed)(asset.id, client), 410, "RIGHTS_EXPIRED", "This asset has no current distribution rights."); const nextNumber = Number((await client.query("SELECT coalesce(max(number),0)+1 AS next FROM resource_versions WHERE resource_id=$1", [id])).rows[0].next); const metadata = snapshot(row); await client.query("INSERT INTO resource_versions(id,resource_id,number,label,locale,asset_id,filename,mime_type,bytes,sha256,metadata_snapshot,metadata_hash,rights_confirmed,rights_expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,true,$13,$14)", [(randomUUID)(), id, nextNumber, input.label, input.locale, input.assetId, asset.name, asset.mime_type, asset.bytes, asset.sha256, JSON.stringify(metadata), digest(metadata), input.rightsExpiresAt || null, actor.id]); const next = (await client.query<ResourceRow>("UPDATE resources SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1 RETURNING *", [id, actor.id])).rows[0]; await (audit)(actor.id, "resource.version.created", "resource", id, { number: nextNumber, assetId: asset.id, sha256: asset.sha256 }, client); return resourceDto(client, next, actor, "fa", true, true); });
}
async function reviewResourceVersion(actor: Actor, id: string, versionId: string, body: unknown) {
    uuid(versionId);
    const input = (parse)(z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().min(1).max(2e3) }).strict(), body);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor);
        const row = await loadResource(client, id, true);
        requireCapability(actor, row, "review");
        const version = (await versions(client, id, true)).find(item => item.id === versionId);
        (assert)(version, 404, "NOT_FOUND", "Document version not found.");
        requireLocale(actor, version.locale);
        (assert)(version.created_by !== actor.id, 403, "SELF_REVIEW", "A different authorized reviewer must review this document version.");
        if (input.decision === "approved")
            await availableBytes(client, version, false);
        (assert)(!version.rights_expires_at || version.rights_expires_at.getTime() > Date.now(), 409, "RIGHTS_EXPIRED", "The distribution right has expired.");
        await client.query("INSERT INTO resource_reviews(id,version_id,reviewer_id,decision,note) VALUES($1,$2,$3,$4,$5)", [(randomUUID)(), versionId, actor.id, input.decision, input.note]);
        const next = (await client.query<ResourceRow>("UPDATE resources SET status=CASE WHEN current_version_id=$2 AND $3='rejected' THEN 'draft' ELSE status END,version=version+1,updated_by=$4,updated_at=now() WHERE id=$1 RETURNING *", [id, versionId, input.decision, actor.id])).rows[0];
        await (audit)(actor.id, "resource.version.reviewed", "resource", id, { versionId, decision: input.decision }, client);
        return resourceDto(client, next, actor, "fa", true, true);
    });
}
async function publishResource(actor: Actor, id: string, body: unknown, expected: number) {
    const input = (parse)(z.object({ versionId: z.string().uuid() }).strict(), body);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor);
        const row = await loadResource(client, id, true);
        requireCapability(actor, row, "publish");
        (assert)(row.version === expected, 409, "CONFLICT", "The document changed. Refresh and retry.");
        const version = (await versions(client, id, true)).find(item => item.id === input.versionId);
        (assert)(version, 404, "NOT_FOUND", "Document version not found.");
        requireLocale(actor, version.locale);
        (assert)(version.reviewed, 409, "REVIEW_REQUIRED", "This version requires independent approval.");
        (assert)(version.metadata_hash === digest(snapshot(row)), 409, "STALE_METADATA", "The document metadata changed. Add and review a version with the current metadata.");
        if (row.current_version_id !== version.id)
            await requireCurrentVersionLocale(client, actor, row);
        await availableBytes(client, version, false);
        const next = (await client.query<ResourceRow>("UPDATE resources SET current_version_id=$2,status='published',version=version+1,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING *", [id, version.id, actor.id])).rows[0];
        await client.query("INSERT INTO resource_publications(id,resource_id,version_id,published_by) VALUES($1,$2,$3,$4) ON CONFLICT(resource_id,version_id) DO NOTHING", [(randomUUID)(), id, version.id, actor.id]);
        if (next.visibility === 'public') {
            const publication = (await client.query<{id:string}>('SELECT id FROM resource_publications WHERE resource_id=$1 AND version_id=$2', [id,version.id])).rows[0];
            await (await import('./notification-resources')).enqueueResourceNotificationEvent(client,publication.id,version.locale);
        }
        await (audit)(actor.id, "resource.published", "resource", id, { versionId: version.id, sha256: version.sha256 }, client);
        return resourceDto(client, next, actor, "fa", true, true);
    });
}
async function availableBytes(client: PoolClient, version: ResourceVersionRow, read = true) {
    (assert)(!version.rights_expires_at || version.rights_expires_at.getTime() > Date.now(), 410, "RIGHTS_EXPIRED", "This document distribution right has expired.");
    const asset = (await client.query("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL FOR SHARE", [version.asset_id])).rows[0];
    (assert)(asset && asset.visibility === "private" && !asset.request_id, 404, "NOT_FOUND", "Document file not found.");
    (assert)(asset.scan_status === "clean", 409, "QUARANTINED", "This document is unavailable until its security scan succeeds.");
    (assert)(asset.sha256 === version.sha256 && asset.bytes === version.bytes, 500, "FILE_INTEGRITY", "The stored file does not match the approved version.");
    await requireDocumentAssetBinding(client, asset.id, version.resource_id);
    (assert)(await (assetUsageAllowed)(asset.id, client), 410, "RIGHTS_EXPIRED", "This asset distribution right has expired or been withdrawn.");
    if (!read)
        return Buffer.alloc(0);
    (assert)(/^private\/[a-f0-9-]+\.[a-z0-9]+$/.test(asset.storage_key), 500, "STORAGE_KEY", "The stored file path is invalid.");
    let bytes;
    try {
        bytes = await (readFile)((join)((config)().storageDir, asset.storage_key));
    }
    catch {
        throw new HttpError(404, "FILE_MISSING", "The stored document is unavailable.");
    }
    (assert)(bytes.length === Number(version.bytes) && (createHash)("sha256").update(bytes).digest("hex") === version.sha256, 500, "FILE_INTEGRITY", "The stored file does not match the approved version.");
    return bytes;
}
/** A broadcast can only describe the current, independently approved public
 * document. Re-evaluate the same file/rights gates at fanout and dispatch; never
 * project restricted metadata or expose the private asset URL in a message. */
export async function resourcePublicationNotice(client:PoolClient,publicationId:string,locale:Locale):Promise<{resourceId:string;title:string;summary:string;href:string}|null> {
    const publication=(await client.query<{resource_id:string;version_id:string;role:Actor['role'];active:boolean;mfa_enabled:boolean;allowed_locales:Locale[]}>(`SELECT p.resource_id,p.version_id,u.role,u.active,u.mfa_enabled,u.allowed_locales
      FROM resource_publications p JOIN users u ON u.id=p.published_by WHERE p.id=$1`,[publicationId])).rows[0];
    if(!publication?.active||!publication.mfa_enabled||!publication.allowed_locales.includes(locale)||!canWorkspace(publication.role,'publish','resources'))return null;
    const row=(await client.query<ResourceRow>("SELECT * FROM resources WHERE id=$1 AND status='published' AND visibility='public' AND current_version_id=$2",[publication.resource_id,publication.version_id])).rows[0];
    if(!row||row.room_id||!row.title[locale]?.trim())return null;
    const version=(await client.query<ResourceVersionRow>('SELECT * FROM resource_versions WHERE id=$1 AND resource_id=$2',[publication.version_id,row.id])).rows[0];
    if(!version||version.locale!==locale||!version.rights_confirmed||version.metadata_hash!==digest(snapshot(row)))return null;
    const review=(await client.query<{reviewer_id:string;decision:string;active:boolean;mfa_enabled:boolean;role:Actor['role'];allowed_locales:Locale[]}>(`SELECT rr.reviewer_id,rr.decision,u.active,u.mfa_enabled,u.role,u.allowed_locales
      FROM resource_reviews rr JOIN users u ON u.id=rr.reviewer_id WHERE rr.version_id=$1 ORDER BY rr.created_at DESC,rr.id DESC LIMIT 1`,[version.id])).rows[0];
    if(!review||review.decision!=='approved'||review.reviewer_id===version.created_by||!review.active||!review.mfa_enabled||!review.allowed_locales.includes(locale)||!canWorkspace(review.role,'review','resources'))return null;
    if(!isPublicPathVisible(await getSourcePublicVisibility(client),locale,'resources/'+row.slug))return null;
    try{await availableBytes(client,version,false);}catch(error){if(error instanceof HttpError&&([403,404,409,410,422].includes(error.status)||error.code==='FILE_INTEGRITY'))return null;throw error;}
    return {resourceId:row.id,title:row.title[locale],summary:row.summary[locale]||row.title[locale],href:`/${locale}/resources/${row.slug}/`};
}
async function authorizedVersion(client: PoolClient, actor: Actor | null, id: string, versionId: string, action: 'view' | 'download') {
    uuid(versionId);
    const row = await loadResource(client, id);
    const canManage = managerRead(actor, row);
    const version = (await versions(client, id, canManage)).find(item => item.id === versionId);
    (assert)(version, 404, "NOT_FOUND", "Document version not found.");
    const manage = canManage && !!actor?.allowedLocales.includes(version.locale);
    const permission = manage ? { view: true, download: true } : await publicPermission(client, actor, row);
    (assert)(permission[action], 404, "NOT_FOUND", "Document not found.");
    if (!manage)
        (assert)(version.reviewed && (await client.query("SELECT 1 FROM resource_publications WHERE resource_id=$1 AND version_id=$2", [id, versionId])).rowCount, 404, "NOT_FOUND", "Document version not found.");
    return { row, version };
}
function fileResponse(bytes: Buffer, version: ResourceVersionRow, request: Request, action: 'view' | 'download') {
    const safe = version.filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
    const inline = action === "view" && (version.mime_type === "application/pdf" || /^(image|video|audio)\//.test(version.mime_type));
    const headers = new Headers({ "Content-Type": version.mime_type, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(version.filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Accept-Ranges": "bytes", "ETag": `"${version.sha256}"` });
    const range = request.headers.get("range");
    if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        let start = 0, end = bytes.length - 1;
        if (!match || !match[1] && !match[2])
            return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}`, "Cache-Control": "private, no-store" } });
        if (!match[1])
            start = Math.max(0, bytes.length - Number(match[2]));
        else {
            start = Number(match[1]);
            if (match[2])
                end = Math.min(Number(match[2]), end);
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length || !match[1] && Number(match[2]) === 0)
            return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}`, "Cache-Control": "private, no-store" } });
        headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
        headers.set("Content-Length", String(end - start + 1));
        return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers });
    }
    headers.set("Content-Length", String(bytes.length));
    return new Response(new Uint8Array(bytes), { headers });
}
async function resourceContent(actor: Actor | null, id: string, versionId: string, request: Request) {
    const action = (parse)(z.enum(["view", "download"]), new URL(request.url).searchParams.get("action") || "download");
    await (rateLimit)("resource-content:" + (actor?.id || (visitorKey)(request)), 240, 60);
    return (transaction)(async (client) => {
        if (actor) {
            await (lockWorkspace)(client);
            actor = await (loadCrmAccess)(actor, client);
        }
        const { version } = await authorizedVersion(client, actor, id, versionId, action);
        const bytes = await availableBytes(client, version);
        await (audit)(actor?.id || null, "resource." + action, "resource", id, { versionId, sha256: version.sha256 }, client);
        return fileResponse(bytes, version, request, action);
    });
}
async function resourceBundle(actor: Actor | null, body: unknown, visitor: string) {
    const input = (parse)(z.object({ items: z.array(z.object({ resourceId: z.string().uuid(), versionId: z.string().uuid() }).strict()).min(1).max(20), locale: localeSchema.default("fa") }).strict(), body);
    await (rateLimit)("resource-bundle:" + (actor?.id || visitor), 10, 300);
    return (transaction)(async (client) => {
        if (actor) {
            await (lockWorkspace)(client);
            actor = await (loadCrmAccess)(actor, client);
        }
        const selected = [];
        const keys = new Set;
        let total = 0;
        for (const item of [...input.items].sort((a, b) => a.resourceId.localeCompare(b.resourceId) || a.versionId.localeCompare(b.versionId))) {
            (assert)(!keys.has(item.versionId), 422, "DUPLICATE_VERSION", "Select each document version once.");
            keys.add(item.versionId);
            const document = await authorizedVersion(client, actor, item.resourceId, item.versionId, "download");
            total += Number(document.version.bytes);
            (assert)(total <= 50 * 1024 * 1024, 413, "BUNDLE_SIZE", "A bundle must be at most 50 MiB before compression.");
            selected.push(document);
        }
        const files: Record<string,Uint8Array> = {};
        const entries = [];
        for (const { row, version } of selected) {
            const ext = version.filename.includes(".") ? "." + version.filename.split(".").at(-1)!.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) : "";
            const filename = `${row.slug}-v${version.number}-${version.locale}${ext}`;
            (assert)(!Object.hasOwn(files, filename), 409, "BUNDLE_NAME", "Two selected document versions have the same bundle filename.");
            files[filename] = new Uint8Array(await availableBytes(client, version));
            entries.push({ resourceId: row.id, versionId: version.id, version: version.number, label: version.label, locale: version.locale, filename, bytes: Number(version.bytes), sha256: version.sha256, rightsExpiresAt: version.rights_expires_at?.toISOString() || null });
        }
        files["manifest.json"] = (strToU8)(JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), locale: input.locale, documents: entries }, null, 2) + "\n");
        const bytes = (zipSync)(files, { level: 6 });
        await (audit)(actor?.id || null, "resource.bundle.downloaded", "resource_bundle", (randomUUID)(), { versions: entries.map(row => row.versionId), bytes: bytes.length }, client);
        return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="idealmakoo-documents.zip"', "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    });
}
function roomDto(row: DataRoomRow, locale: Locale, manage: boolean, permission: ResourcePermission) { return { id: row.id, slug: row.slug, title: manage ? row.title : row.title[locale], summary: manage ? row.summary : row.summary[locale], status: row.status, version: row.version, permissions: permission }; }
async function listDataRooms(actor: Actor, localeInput = "fa", manage = false) {
    const locale = (parse)(localeSchema, localeInput);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await (loadCrmAccess)(actor, client);
        if (manage)
            (assert)(roomManager(actor), 403, "FORBIDDEN", "You cannot manage data rooms.");
        const rows = (await client.query<DataRoomRow>(`SELECT * FROM data_rooms ${manage ? "" : "WHERE status='published'"} ORDER BY updated_at DESC,id LIMIT 500`)).rows;
        const items = [];
        for (const row of rows) {
            const permission = manage ? { view: true, download: true } : await grantPermission(client, actor, null, row.id);
            if (permission.view)
                items.push(roomDto(row, locale, manage, permission));
        }
        return { items };
    });
}
async function createDataRoom(actor: Actor, body: unknown) { (assert)(roomManager(actor), 403, "FORBIDDEN", "You cannot manage data rooms."); const input = (parse)(z.object({ slug: slugSchema, title: titleSchema, summary: summarySchema.default(emptySummary), status: z.enum(["draft", "published"]).default("draft") }).strict(), body); return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor); (assert)(roomManager(actor), 403, "FORBIDDEN", "You cannot manage data rooms."); localizedChanges(actor, void 0, input.title); localizedChanges(actor, void 0, input.summary); (assert)(!(await client.query("SELECT 1 FROM data_rooms WHERE slug=$1", [input.slug])).rowCount, 409, "SLUG_CONFLICT", "This data room address is already in use."); const row = (await client.query<DataRoomRow>("INSERT INTO data_rooms(id,slug,title,summary,status,created_by,updated_by) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,$6) RETURNING *", [(randomUUID)(), input.slug, JSON.stringify(input.title), JSON.stringify(input.summary), input.status, actor.id])).rows[0]; await (audit)(actor.id, "data_room.created", "data_room", row.id, {}, client); return roomDto(row, "fa", true, { view: true, download: true }); }); }
async function updateDataRoom(actor: Actor, id: string, body: unknown, expected: number) {
    (assert)(roomManager(actor), 403, "FORBIDDEN", "You cannot manage data rooms.");
    const input = (parse)(z.object({ title: titleSchema.optional(), summary: summarySchema.optional(), status: z.enum(["draft", "published", "archived"]).optional() }).strict(), body);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor);
        (assert)(roomManager(actor), 403, "FORBIDDEN", "You cannot manage data rooms.");
        const row = await loadRoom(client, id, true);
        localizedChanges(actor, row.title, input.title);
        localizedChanges(actor, row.summary, input.summary);
        if (input.status && input.status !== row.status)
            (assert)(allLocales(actor), 403, "CONTENT_LOCALE", "Changing a shared data room state requires permission for every language.");
        (assert)(row.version === expected, 409, "CONFLICT", "The data room changed. Refresh and retry.");
        const next = (await client.query<DataRoomRow>("UPDATE data_rooms SET title=$2::jsonb,summary=$3::jsonb,status=$4,version=version+1,updated_by=$5,updated_at=now() WHERE id=$1 RETURNING *", [id, JSON.stringify(input.title ?? row.title), JSON.stringify(input.summary ?? row.summary), input.status ?? row.status, actor.id])).rows[0];
        await (audit)(actor.id, "data_room.updated", "data_room", id, { fields: Object.keys(input) }, client);
        return roomDto(next, "fa", true, { view: true, download: true });
    });
}
function grantDto(row: PgRow<'access_grants'>) { return { id: row.id, resourceId: row.resource_id, roomId: row.room_id, userId: row.user_id, organizationId: row.organization_id, canView: row.can_view, canDownload: row.can_download, expiresAt: row.expires_at.toISOString(), reason: row.reason, revokedAt: row.revoked_at?.toISOString() || null, version: row.version, createdAt: row.created_at.toISOString() }; }
async function listAccessGrants(actor: Actor, options: {resourceId?: string; roomId?: string}) {
    (assert)(!!options.resourceId !== !!options.roomId, 422, "GRANT_SCOPE", "Select exactly one document or data room.");
    if (options.resourceId)
        uuid(options.resourceId);
    if (options.roomId)
        uuid(options.roomId);
    return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor); (assert)(roomManager(actor), 403, "FORBIDDEN", "You cannot manage document grants."); return { items: (await client.query<PgRow<'access_grants'>>("SELECT * FROM access_grants WHERE resource_id=$1 OR room_id=$2 ORDER BY created_at DESC,id LIMIT 1000", [options.resourceId || null, options.roomId || null])).rows.map(grantDto) }; });
}
async function createAccessGrant(actor: Actor, body: unknown) {
    (assert)(roomManager(actor), 403, "FORBIDDEN", "You cannot manage document grants.");
    const input = (parse)(z.object({ resourceId: z.string().uuid().optional(), roomId: z.string().uuid().optional(), userId: z.string().min(1).max(160).optional(), organizationId: z.string().uuid().optional(), canView: z.literal(true), canDownload: z.boolean(), expiresAt: z.string().datetime({ offset: true }), reason: z.string().trim().min(1).max(2e3) }).strict(), body);
    (assert)(!!input.resourceId !== !!input.roomId, 422, "GRANT_SCOPE", "Select exactly one document or data room.");
    (assert)(!!input.userId !== !!input.organizationId, 422, "GRANT_SUBJECT", "Select exactly one user or organization.");
    (assert)(Date.parse(input.expiresAt) > Date.now() && Date.parse(input.expiresAt) <= Date.now() + 366 * 864e5, 422, "GRANT_EXPIRY", "Access must expire in the future, within one year.");
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor);
        (assert)(roomManager(actor), 403, "FORBIDDEN", "You cannot manage document grants.");
        if (input.resourceId) {
            const resource = await loadResource(client, input.resourceId);
            (assert)(resource.visibility === "restricted", 422, "GRANT_SCOPE", "Individual grants are for restricted documents.");
        }
        if (input.roomId)
            await loadRoom(client, input.roomId);
        if (input.userId)
            (assert)((await client.query("SELECT 1 FROM users WHERE id=$1 AND active AND email_verified FOR SHARE", [input.userId])).rowCount, 422, "GRANT_SUBJECT", "Select an active user with verified email.");
        if (input.organizationId)
            (assert)((await client.query("SELECT 1 FROM customer_organizations WHERE id=$1 AND archived_at IS NULL FOR SHARE", [input.organizationId])).rowCount, 422, "GRANT_SUBJECT", "Select an active organization.");
        const row = (await client.query<PgRow<'access_grants'>>("INSERT INTO access_grants(id,resource_id,room_id,user_id,organization_id,can_view,can_download,expires_at,reason,granted_by) VALUES($1,$2,$3,$4,$5,true,$6,$7,$8,$9) RETURNING *", [(randomUUID)(), input.resourceId || null, input.roomId || null, input.userId || null, input.organizationId || null, input.canDownload, input.expiresAt, input.reason, actor.id])).rows[0];
        await (audit)(actor.id, "access_grant.created", "access_grant", row.id, { resourceId: row.resource_id, roomId: row.room_id, userId: row.user_id, organizationId: row.organization_id, canDownload: row.can_download, expiresAt: row.expires_at.toISOString() }, client);
        return grantDto(row);
    });
}
async function revokeAccessGrant(actor: Actor, id: string, expected: number) { (assert)(roomManager(actor), 403, "FORBIDDEN", "You cannot manage document grants."); uuid(id); return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await currentActor(client, actor); (assert)(roomManager(actor), 403, "FORBIDDEN", "You cannot manage document grants."); const row = (await client.query<PgRow<'access_grants'>>("SELECT * FROM access_grants WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Grant not found."); (assert)(row.version === expected, 409, "CONFLICT", "The grant changed. Refresh and retry."); const next = (await client.query<PgRow<'access_grants'>>("UPDATE access_grants SET revoked_at=coalesce(revoked_at,now()),revoked_by=$2,version=version+1 WHERE id=$1 RETURNING *", [id, actor.id])).rows[0]; await (audit)(actor.id, "access_grant.revoked", "access_grant", id, {}, client); return grantDto(next); }); }
async function searchAccessGrantSubjects(actor: Actor, queryInput: string) {
    (assert)(roomManager(actor) && actor.crmAccess?.permissions.contact, 403, "FORBIDDEN", "Recipient search requires contact access.");
    const input = (parse)(z.string().trim().min(2).max(100), queryInput);
    await (rateLimit)("document-recipients:" + actor.id, 60, 60);
    const needle = "%" + input.replace(/[\\%_]/g, "\\$&") + "%";
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await currentActor(client, actor);
        (assert)(roomManager(actor) && actor.crmAccess?.permissions.contact, 403, "FORBIDDEN", "Recipient search requires current contact access.");
        if (["admin", "superAdmin"].includes(actor.role))
            return { users: (await client.query("SELECT id,name,email FROM users WHERE active AND email_verified AND (name ILIKE $1 OR email ILIKE $1) ORDER BY name,id LIMIT 30", [needle])).rows, organizations: (await client.query("SELECT id,name FROM customer_organizations WHERE archived_at IS NULL AND name ILIKE $1 ORDER BY name,id LIMIT 30", [needle])).rows };
        const rows = (await client.query(`SELECT r.*,u.name AS user_name,u.email AS user_email FROM requests r JOIN users u ON u.id=r.owner_id AND u.active AND u.email_verified WHERE (u.name ILIKE $1 OR u.email ILIKE $1) ORDER BY r.created_at DESC LIMIT 500`, [needle])).rows;
        const users = new Map;
        for (const row of rows)
            if (row.owner_id && (canAccessCrmRequest)(actor, { id: row.id, kind: row.kind, qualityQuarantined: row.quality_quarantined, assigneeId: row.assignee_id, teamId: row.team_id, territoryId: row.territory_id }))
                users.set(row.owner_id, { id: row.owner_id, name: row.user_name, email: row.user_email });
        const shared = (await client.query(`SELECT r.*,o.id AS organization_id,o.name AS organization_name FROM customer_organizations o JOIN request_shares s ON s.organization_id=o.id AND s.revoked_at IS NULL JOIN requests r ON r.id=s.request_id WHERE o.archived_at IS NULL AND o.name ILIKE $1 ORDER BY r.created_at DESC LIMIT 500`, [needle])).rows;
        const organizations = new Map;
        for (const row of shared)
            if ((canAccessCrmRequest)(actor, { id: row.id, kind: row.kind, qualityQuarantined: row.quality_quarantined, assigneeId: row.assignee_id, teamId: row.team_id, territoryId: row.territory_id }))
                organizations.set(row.organization_id, { id: row.organization_id, name: row.organization_name });
        return { users: [...users.values()].slice(0, 30), organizations: [...organizations.values()].slice(0, 30) };
    });
}
/** Sitemap candidates obey the public landing page's current publication,
 * independent-review, metadata and asset rules. Draft/private/withdrawn files
 * and stale approvals never become discoverable through the sitemap. */
export async function publicResourceDiscovery():Promise<{id:string;slug:string;title:Localized;summary:Localized;type:string;updatedAt:string;locales:Locale[]}[]> {
 return transaction(async client=>{
  await lockWorkspace(client);
  const rows=(await client.query<ResourceRow>("SELECT * FROM resources WHERE status='published' AND visibility='public' AND current_version_id IS NOT NULL ORDER BY slug,id FOR SHARE")).rows;
  const result:{id:string;slug:string;title:Localized;summary:Localized;type:string;updatedAt:string;locales:Locale[]}[]=[];
  for(const row of rows){
   if(!(await publicPermission(client,null,row)).view)continue;
   const version=(await versions(client,row.id,false)).find(value=>value.id===row.current_version_id&&value.reviewed);
   if(!version||version.metadata_hash!==digest(snapshot(row)))continue;
   const review=(await client.query<{reviewer_id:string;decision:string}>('SELECT reviewer_id,decision FROM resource_reviews WHERE version_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[version.id])).rows[0];
   if(!review||review.decision!=='approved'||review.reviewer_id===version.created_by)continue;
   try{await availableBytes(client,version,false);}catch(error){if(error instanceof HttpError&&([403,404,409,410,422].includes(error.status)||error.code==='FILE_INTEGRITY'))continue;throw error;}
   const availableLocales=resourceLocales.filter(locale=>typeof row.title[locale]==='string'&&row.title[locale].trim());
   if(availableLocales.length)result.push({id:row.id,slug:row.slug,title:row.title,summary:row.summary,type:row.type,updatedAt:row.updated_at.toISOString(),locales:availableLocales});
  }
  return result;
 });
}

async function publicResourceRoutes():Promise<{slug:string;updatedAt:string;locales:Locale[]}[]> {
 return(await publicResourceDiscovery()).map(({slug,updatedAt,locales})=>({slug,updatedAt,locales}));
}

export { certificateResourceSources, addResourceVersion, createAccessGrant, createDataRoom, createResource, getResource, getResourcePage, listAccessGrants, listDataRooms, listResources, publicResourceRoutes, publishResource, resourceBundle, resourceContent, resourceUsageVisible, reviewResourceVersion, revokeAccessGrant, searchAccessGrantSubjects, updateDataRoom, updateResource, wishlistResourceCandidates };
