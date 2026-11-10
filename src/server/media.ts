import type {StoredAssetInput} from './storage';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
export interface AssetRow {id:string;owner_id:string|null;request_id:string|null;name:string;storage_key:string;mime_type:string;bytes:string;visibility:'public'|'private';scan_status:'pending'|'clean'|'blocked'|'error';metadata:Record<string,unknown>;created_at:Date;deleted_at:Date|null;sha256:string;storage_purged_at:Date|null;quota_subject:string}

import type { Actor } from './types';
import { assert, HttpError } from "./types";
import { canWorkspace } from "../lib/auth";
import { guestHash, getRequestRow, canAccessRequest } from "./requests";
import { rateLimit, visitorKey } from "./http";
import sharp from "sharp";
import { storeAssetBatch, storeAsset } from "./storage";
import { lockWorkspace } from "./workspace";
import { loadCrmAccess } from "./workspace-scopes";
import { createHash } from "node:crypto";
import { query, transaction, audit } from "./db";
import { assetUsageAllowed } from "./asset-usage";
import { config } from "./config";
import {storedMediaResponse} from './asset-content';
import { referencesAsset } from "../lib/asset-references";
import {currentStoragePolicy,assertFilePolicy} from './storage-policy';
import {MULTIPART_OVERHEAD_BYTES} from '../lib/upload-policy';
async function multipart(request:Request,maxBytes:number) {
  assert(request.headers.get('content-type')?.startsWith('multipart/form-data;'),415,'CONTENT_TYPE','Use multipart/form-data.');
  const length=request.headers.get('content-length');
  assert(length===null||/^\d+$/.test(length)&&Number.isSafeInteger(Number(length)),400,'CONTENT_LENGTH','Content-Length must be a valid non-negative integer.');
  assert(Number(length||0)<=maxBytes+MULTIPART_OVERHEAD_BYTES,413,'UPLOAD_SIZE','The upload exceeds the current administrator-defined limit.');
  assert(request.body,400,'FILE_REQUIRED','Select a file.');let size=0;const buffers:Uint8Array[]=[];const reader=request.body.getReader();
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes+MULTIPART_OVERHEAD_BYTES){await reader.cancel();throw new HttpError(413,'UPLOAD_SIZE','The upload exceeds the current administrator-defined limit.');}buffers.push(part.value);}
  try{
    return await new Request('http://multipart.local',{method:'POST',headers:{'content-type':request.headers.get('content-type')!},body:Buffer.concat(buffers)}).formData();
  }catch{
    // A malformed envelope or a body truncated upstream is a client error.
    // It must not become a 500 or reach storage reservation/asset creation.
    throw new HttpError(400,'MULTIPART_INVALID','The upload form is incomplete or invalid. Retry with a complete supported file.');
  }
}
function identify(bytes:Buffer,name:string):{mime:string;ext:string;image:boolean} {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return{mime:'image/png',ext:'png',image:true};
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return{mime:'image/jpeg',ext:'jpg',image:true};
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return{mime:'image/webp',ext:'webp',image:true};
  if(bytes.subarray(0,5).toString()==='%PDF-')return{mime:'application/pdf',ext:'pdf',image:false};
  if(bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]))&&/\.docx$/i.test(name))return{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ext:'docx',image:false};
  if(bytes.subarray(4,8).toString()==='ftyp')return{mime:'video/mp4',ext:'mp4',image:false};
  if(bytes.subarray(0,3).toString()==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224))return{mime:'audio/mpeg',ext:'mp3',image:false};
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE')return{mime:'audio/wav',ext:'wav',image:false};
  throw new HttpError(422,'FILE_TYPE','Supported files: PNG, JPEG, WebP, PDF, DOCX, MP4, MP3 and WAV.');
}
function assetDto(row:AssetRow) {return{id:row.id,url:row.visibility==='public'?`/api/v1/media/${row.id}/content`:`/api/v1/attachments/${row.id}`,filename:row.name,name:row.name,size:Number(row.bytes),bytes:Number(row.bytes),mimeType:row.mime_type,visibility:row.visibility,scanStatus:row.scan_status,createdAt:row.created_at};}
let activeUploads=0;
async function upload(request:Request,actor:Actor|null,privateAttachment=false) {
    if (!privateAttachment)
        assert(actor&&actor.mfaVerified&&canWorkspace(actor.role,'create','media'),403,'FORBIDDEN','You cannot upload to the media library.');
    const guest=guestHash(request);
    assert(actor||guest,401,'SESSION_REQUIRED','Refresh the page before uploading.');
    if(actor)actor=await loadCrmAccess(actor);
    assert(!actor||actor.role==='customer'||actor.mfaVerified,403,'MFA_REQUIRED','Staff uploads require a current two-factor authenticated session.');
    if(!privateAttachment)assert(actor&&actor.mfaVerified&&canWorkspace(actor.role,'create','media'),403,'FORBIDDEN','Your current role cannot upload to the media library.');
    await rateLimit('uploads:'+visitorKey(request),40,3600);
    const capacity=process.env.UPLOAD_CONCURRENT_REQUESTS||'2';
    assert(/^[1-8]$/.test(capacity),503,'STORAGE_CONFIG','UPLOAD_CONCURRENT_REQUESTS must be between one and eight.');
    assert(activeUploads<Number(capacity),429,'UPLOAD_BUSY','Uploads are busy. Retry shortly; no file has been stored.');
    activeUploads++;
    try{return await uploadAccepted(request,actor,privateAttachment,guest);}finally{activeUploads--;}
}
async function uploadAccepted(request:Request,actor:Actor|null,privateAttachment:boolean,guest:string|null){
    const {limits}=await currentStoragePolicy(),maxBytes=Math.min(limits.maxFileBytes,actor?limits.userBytes:limits.guestBytes);
    const fields=await multipart(request,maxBytes);
    const file=fields.get('file');
    assert(fields.getAll('file').length===1&&[...fields.keys()].every(key=>['file','visibility','rights'].includes(key)),422,'UPLOAD_FIELDS','Supply exactly one file and supported upload fields.');
    assert(file instanceof File&&file.size>0,422,'FILE_REQUIRED','Select a non-empty supported file.');
    assert(file.size<=maxBytes,413,'UPLOAD_SIZE','The file exceeds the current administrator-defined limit.');
    const name=file.name.normalize('NFC').replace(/[\x00-\x1f\x7f<>"\\/]/g,'_').slice(0,180)||'upload';
    let bytes=Buffer.from(await file.arrayBuffer());
    let format=identify(bytes,name);
    assertFilePolicy(limits,file.size,format.mime,actor?.id||null);
    const originalBytes = bytes, originalFormat = { ...format };
    let originalWidth = 0, originalHeight = 0;
    const visibility=privateAttachment?'private':fields.get('visibility')==='public'?'public':'private';
    if (visibility === "public")
        assert(fields.get('rights')==='true',422,'RIGHTS_REQUIRED','Confirm that the factory has permission to publish this file.');
    const metadata:Record<string,unknown>={rights:visibility==='public',...(actor?{}:{guestHash:guest})};
    if (format.image) {
        try {
            const image=sharp(bytes,{limitInputPixels:32_000_000,failOn:'error'}).rotate();
            const dimensions=await image.metadata();
            const rotated = [5, 6, 7, 8].includes(dimensions.orientation || 1);
            originalWidth = (rotated ? dimensions.height : dimensions.width) || 0;
            originalHeight = (rotated ? dimensions.width : dimensions.height) || 0;
            const rendered = await image.resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer({ resolveWithObject: true });
            bytes = rendered.data;
            format = { mime: "image/webp", ext: "webp", image: true };
            metadata.width = rendered.info.width;
            metadata.height = rendered.info.height;
        }
        catch {
            throw new HttpError(422, "IMAGE_INVALID", "This image could not be decoded safely.");
        }
    }
    if (format.image && !privateAttachment && actor) {
        const saved = await (storeAssetBatch)([{ ownerId: actor.id, name, bytes: originalBytes, mimeType: originalFormat.mime, extension: originalFormat.ext, visibility: "private", scanStatus: "clean", metadata: { ...metadata, rights: false, damRole: "original" } }, { ownerId: actor.id, name: name.replace(/\.(?:png|jpe?g|webp)$/i, "") + ".webp", bytes, mimeType: format.mime, extension: format.ext, visibility, scanStatus: "clean", metadata: { ...metadata, damRole: "source" } }], async (client, rows) => { await (lockWorkspace)(client); const current = await (loadCrmAccess)(actor, client); (assert)(current.mfaVerified && (canWorkspace)(current.role, "create", "media"), 403, "FORBIDDEN", "Your media upload permission changed."); await client.query("INSERT INTO asset_image_sources(asset_id,original_asset_id,width,height,original_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6)", [rows[1].id, rows[0].id, originalWidth, originalHeight, createHash('sha256').update(originalBytes).digest("hex"), current.id]); });
        return assetDto(saved[1]);
    }
    const input: StoredAssetInput = { ownerId: actor?.id || null, name, bytes, mimeType: format.mime, extension: format.ext, visibility, scanStatus: format.image ? "clean" : "pending", metadata };
    const result = actor ? (await (storeAssetBatch)([input], async (client) => { await (lockWorkspace)(client); const current = await (loadCrmAccess)(actor, client); assert(current.role==='customer'||current.mfaVerified,403,'MFA_REQUIRED','Staff uploads require a current two-factor authenticated session.'); if(!privateAttachment)(assert)(current.mfaVerified && (canWorkspace)(current.role, "create", "media"), 403, "FORBIDDEN", "Your media upload permission changed."); }))[0] : await (storeAsset)(input);
    return assetDto(result);
}
async function listMedia(actor:Actor){ assert(canWorkspace(actor.role,'view','media'),403,'FORBIDDEN','You cannot read the media library.'); return { items: (await (query)<AssetRow>("SELECT * FROM assets WHERE deleted_at IS NULL AND coalesce(metadata->>'damRole','')<>'original' AND (visibility='public' OR owner_id=$1) ORDER BY created_at DESC LIMIT 1000", [actor.id])).rows.map(assetDto) }; }
async function listOwnAttachments(actor: Actor) { return { items: (await (query)<AssetRow>("SELECT * FROM assets WHERE owner_id=$1 AND visibility='private' AND deleted_at IS NULL AND coalesce(metadata->>'damRole','')<>'original' ORDER BY created_at DESC,id LIMIT 1000", [actor.id])).rows.map(assetDto) }; }
async function assetResponse(id:string,actor:Actor|null,guest:string|null,request:Request,attachment=false) {
    assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id),404,'NOT_FOUND','File not found.');
    const row=(await query<AssetRow>('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];
    assert(row,404,'NOT_FOUND','File not found.');
    let permitted=row.visibility==='public';
    if (!permitted)
        return (transaction)(async (client) => {
            await (lockWorkspace)(client);
            if (actor) {
                actor = await (loadCrmAccess)(actor, client);
                (assert)(actor.role === "customer" || actor.mfaVerified, 403, "MFA_REQUIRED", "Staff private files require a current two-factor authenticated session.");
            }
            const current = (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL AND storage_purged_at IS NULL AND visibility='private' FOR SHARE", [id])).rows[0];
            (assert)(current, 404, "NOT_FOUND", "File not found.");
            if (current.metadata.damRole === "original")
                (assert)(actor?.mfaVerified && canWorkspace(actor.role,'view','media') && current.owner_id === actor.id, 404, "NOT_FOUND", "File not found.");
            let own = !!actor && current.owner_id === actor.id || !actor && !!guest && current.metadata.guestHash === guest;
            if (current.request_id) {
                const linked = await (getRequestRow)(current.request_id, client);
                own = own || await (canAccessRequest)(actor, linked, guest, client);
            }
            (assert)(own, 404, "NOT_FOUND", "File not found.");
            if (["video-derivative", "subtitle"].includes(String(current.metadata.damRole)))
                (assert)(await (assetUsageAllowed)(current.id, client), 410, "RIGHTS_EXPIRED", "This derived media is not ready or its source rights were withdrawn.");
            return storedAssetResponse(current, request, attachment);
        });
    assert(permitted,404,'NOT_FOUND','File not found.');
    if (row.visibility === "public") {
        assert(row.scan_status==='clean',409,'QUARANTINED','This file is unavailable until its security scan succeeds.');
        (assert)(await (assetUsageAllowed)(row.id), 410, "RIGHTS_EXPIRED", "This media or its retained source no longer has current permission for distribution.");
    }
    return await storedAssetResponse(row, request, attachment);
}
async function storedAssetResponse(row: AssetRow, request: Request, attachment = false) {
    return storedMediaResponse(row,request,config().storageDir,attachment);
}
async function crmEvidenceResponse(actor: Actor, recordId: string, assetId: string, request: Request) { return (transaction)(async (client) => { await (lockWorkspace)(client); const { authorizeCrmDomainEvidence } = await import("./workspace-domain-core"); await authorizeCrmDomainEvidence(client, actor, recordId, assetId); const row = (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL AND visibility='private' FOR SHARE", [assetId])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Retained evidence not found."); return await storedAssetResponse(row, request, true); }); }
async function tenderEnvelopeResponse(actor: Actor, bidId: string, revisionId: string, kind: "technical" | "financial", assetId: string, request: Request) { return (transaction)(async (client) => { await (lockWorkspace)(client); const { authorizeTenderEnvelopeAsset } = await import("./tenders"); await authorizeTenderEnvelopeAsset(client, actor, bidId, revisionId, kind, assetId); const row = (await client.query<AssetRow>("SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL AND storage_purged_at IS NULL AND visibility='private' FOR SHARE", [assetId])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Envelope file not found."); return await storedAssetResponse(row, request, true); }); }
async function deleteMedia(actor:Actor,id:string){ assert(actor.mfaVerified&&canWorkspace(actor.role,'archive','media'),403,'FORBIDDEN','You cannot delete media.'); assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id),404,'NOT_FOUND','File not found.'); return (transaction)(async (client) => { await lockWorkspace(client); actor = await (loadCrmAccess)(actor, client); (assert)(actor.mfaVerified && canWorkspace(actor.role,'archive','media'), 403, "FORBIDDEN", "Your media archive permission changed."); const row=(await client.query<AssetRow>('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0]; assert(row&&(row.visibility==='public'||row.owner_id===actor.id),404,'NOT_FOUND','File not found.'); assert(!row.request_id,409,'ASSET_IN_USE','Request attachments must be retained with their case.'); (assert)(!(await client.query("SELECT 1 FROM resource_versions WHERE asset_id=$1 LIMIT 1", [id])).rowCount, 409, "ASSET_IN_USE", "Published and historical document versions retain this file."); (assert)(!(await client.query("SELECT 1 FROM crm_domain_asset_refs WHERE asset_id=$1 LIMIT 1", [id])).rowCount, 409, "ASSET_IN_USE", "CRM evidence and its revision history retain this file."); (assert)(!(await client.query("SELECT 1 FROM tender_asset_refs WHERE asset_id=$1 LIMIT 1", [id])).rowCount, 409, "ASSET_IN_USE", "Confidential tender envelope revisions retain this file."); (assert)(!(await client.query("SELECT 1 FROM shared_block_asset_refs WHERE asset_id=$1 LIMIT 1", [id])).rowCount, 409, "ASSET_IN_USE", "Shared content block revisions retain this file."); (assert)(!(await client.query("SELECT 1 FROM media_processing_jobs WHERE (source_asset_id=$1 OR result_asset_id=$1) AND state IN ('pending','running','scanning') UNION ALL SELECT 1 FROM asset_media_derivatives d JOIN assets a ON a.id=d.asset_id AND a.deleted_at IS NULL WHERE d.source_asset_id=$1 LIMIT 1", [id])).rowCount, 409, "ASSET_IN_USE", "An active processing job or active media derivative depends on this file."); (assert)(!(await client.query("SELECT 1 FROM asset_image_sources WHERE original_asset_id=$1 UNION ALL SELECT 1 FROM asset_image_derivatives d JOIN assets a ON a.id=d.asset_id AND a.deleted_at IS NULL WHERE d.source_asset_id=$1 LIMIT 1", [id])).rowCount, 409, "ASSET_IN_USE", "Retained image originals and active derivatives depend on this file."); const usage = await client.query("SELECT data FROM workspace_entities WHERE deleted_at IS NULL AND NOT(bucket='media' AND id=$1)", [id]); const published = await client.query("SELECT publication FROM locale_releases WHERE unpublished_at IS NULL UNION ALL SELECT publication FROM workspace_publish_jobs WHERE status='pending'"); (assert)(!usage.rows.some(item => (referencesAsset)(item.data, id)) && !published.rows.some(item => (referencesAsset)(item.publication, id)), 409, "ASSET_IN_USE", "Remove active or scheduled content references before deleting this media."); const retainedPages=await client.query<{data:unknown}>("SELECT snapshot AS data FROM content_revisions WHERE document_bucket='pages' UNION ALL SELECT data FROM workspace_entities WHERE bucket='pages' AND deleted_at IS NOT NULL"); assert(!retainedPages.rows.some(item=>referencesAsset(item.data,id)),409,'ASSET_IN_USE','Retained page history still references this file.'); await client.query('UPDATE assets SET deleted_at=now() WHERE id=$1',[id]); await client.query("UPDATE workspace_entities SET deleted_at=now() WHERE bucket='media' AND id=$1",[id]); await client.query('UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton'); await audit(actor.id,'asset.deleted','asset',id,{},client); return { ok: true }; }); }
export { assetDto, assetResponse, crmEvidenceResponse, deleteMedia, listMedia, listOwnAttachments, tenderEnvelopeResponse, upload };
