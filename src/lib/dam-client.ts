import type {WorkspaceMedia} from '@/data/workspace-seed';
import type {MediaProcessingJob,ServerMediaAsset} from '@/types/dam';
import {HARD_MAX_UPLOAD_BYTES,UPLOAD_MIME_TYPES,effectiveFileLimit,type PublicUploadPolicy} from '@/lib/upload-policy';

/** Absolute bootstrap ceiling only. Production callers must pass current policy. */
export const MAX_MEDIA_UPLOAD_BYTES=HARD_MAX_UPLOAD_BYTES;
export const mediaUploadAccept='.png,.jpg,.jpeg,.webp,.pdf,.docx,.mp4,.mp3,.wav,image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/mp4,audio/mpeg,audio/wav,audio/x-wav';
const mimeTypes=new Set<string>(UPLOAD_MIME_TYPES);
export function mediaUploadMime(file:{type:string;name:string}):string {
 if(file.type)return file.type==='audio/x-wav'?'audio/wav':file.type;
 const extension=file.name.split('.').pop()?.toLowerCase()||'';
 return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',mp4:'video/mp4',mp3:'audio/mpeg',wav:'audio/wav'} as Record<string,string>)[extension]||'';
}
export const isStoredMediaId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export function acceptsMediaUpload(file:{size:number;type:string;name:string},policy?:PublicUploadPolicy){
 const mime=mediaUploadMime(file),allowed=policy?policy.allowedMimeTypes.includes(mime):mimeTypes.has(mime);
 const limit=policy?effectiveFileLimit(policy,mime):MAX_MEDIA_UPLOAD_BYTES;
 return Number.isSafeInteger(file.size)&&file.size>0&&file.size<=limit&&allowed;
}
/** Only a current DTO's exact asset endpoint may be used for private blob transport. */
export function mediaAssetApiPath(id:string,url:string):string|null {
 if(!isStoredMediaId(id))return null;
 if(url===`/api/v1/media/${id}/content`)return `/media/${id}/content`;
 if(url===`/api/v1/attachments/${id}`)return `/attachments/${id}`;
 return null;
}
export function originalMediaApiPath(url:string):string|null {
 const match=/^\/api\/v1\/attachments\/([a-f0-9-]+)$/i.exec(url);
 return match&&isStoredMediaId(match[1])?`/attachments/${match[1]}`:null;
}
export function mediaKind(mime:string):WorkspaceMedia['type'] {
 return mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'document';
}
export function workspaceMediaFromServer(asset:Pick<ServerMediaAsset,'id'|'url'|'filename'|'size'|'mimeType'>,rights:boolean,title=asset.filename):WorkspaceMedia {
 if(!mediaAssetApiPath(asset.id,asset.url)||!Number.isSafeInteger(asset.size)||asset.size<=0)throw new Error('Invalid server media metadata');
 return {id:asset.id,title,filename:asset.filename,type:mediaKind(asset.mimeType),url:asset.url,size:asset.size,usage:[],rights,focalX:50,focalY:50};
}
export function readyMediaOutput(job:MediaProcessingJob){
 return job.state==='ready'&&job.output?.scanStatus==='clean'&&job.output.available&&!!mediaAssetApiPath(job.output.assetId,job.output.url)?job.output:null;
}
export function initialImageRecipe(width:number,height:number){
 return {crop:{left:0,top:0,width,height},outputWidth:Math.min(width,1280),outputHeight:Math.min(height,1280),fit:'inside' as const,quality:90};
}
