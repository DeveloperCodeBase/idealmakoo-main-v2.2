/** One byte convention for API, uploader and proxy. All sizes are bytes/MiB,
 * never decimal MB. The safety ceiling bounds multipart buffering and decoding. */
export const HARD_MAX_UPLOAD_BYTES=80*1024*1024;
export const MULTIPART_OVERHEAD_BYTES=64*1024;
export const UPLOAD_MIME_TYPES=[
  'image/png','image/jpeg','image/webp','application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'video/mp4','audio/mpeg','audio/wav',
] as const;
export type UploadKind='image'|'document'|'video'|'audio';
export interface UploadPolicyLimits {
  maxFileBytes:number;
  byType:Record<UploadKind,number>;
  totalBytes:number;
  userBytes:number;
  guestBytes:number;
}
export interface PublicUploadPolicy {
  version:number;
  maxFileBytes:number;
  byType:Record<UploadKind,number>;
  maxRequestBytes:number;
  allowedMimeTypes:readonly string[];
  canUploadLibrary:boolean;
  canUploadAttachment:boolean;
}
export interface ManagedStoragePolicy {
  version:number;
  limits:UploadPolicyLimits;
  source:'environment'|'database';
  updatedAt:string;
  usage:{storedBytes:string;reservedBytes:string;quotaBytes:string};
  hardMaxFileBytes:number;
  canEdit:boolean;
}
export const uploadKind=(mime:string):UploadKind=>mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'document';
export function effectiveFileLimit(policy:Pick<PublicUploadPolicy,'maxFileBytes'|'byType'>,mime:string) {
  return Math.min(policy.maxFileBytes,policy.byType[uploadKind(mime)]);
}
