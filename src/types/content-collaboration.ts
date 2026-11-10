import type {ContentLocale} from '@/data/catalog';
export type ContentBucket='records'|'pages'|'forms';
export interface ContentLease {id:string;bucket:ContentBucket;documentId:string;leaseUntil:string;holder:{id:string;name:string};owned:boolean;token?:string}
export interface ContentLeaseStatus {lease:ContentLease|null;canEdit:boolean;sourceUpdatedAt:string}
export interface ContentPreview {id:string;bucket:ContentBucket;documentId:string;locale:ContentLocale;revisionId:string;canRevoke:boolean;createdAt:string;expiresAt:string;revokedAt:string|null;url?:string}
