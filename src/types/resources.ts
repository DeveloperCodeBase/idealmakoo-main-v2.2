import type {ContentLocale,Localized} from '@/data/catalog';
export type ResourceKind='catalog'|'brochure'|'ifu'|'sds'|'shade'|'mould'|'research'|'other';
export type ResourceVisibility='public'|'authenticated'|'restricted';
export type ResourceState='draft'|'published'|'archived';
export interface ResourcePermissions {view:boolean;download:boolean}
export interface ResourceVersion {id:string;number:number;label:string;locale:ContentLocale;filename:string;mimeType:string;bytes:number;sha256:string;rightsExpiresAt:string|null;reviewed:boolean;createdAt:string;assetId?:string;createdBy?:string;reviewedBy?:string;reviewedAt?:string;reviewNote?:string;status?:'draft'|'approved'|'rejected'|'published'}
export interface ResourceCapabilities {edit:boolean;review:boolean;publish:boolean;manageGrants:boolean}
export interface ResourceDto {id:string;slug:string;title:string;summary:string;type:ResourceKind;visibility:ResourceVisibility;roomId:string|null;status:ResourceState;version:number;currentVersion:ResourceVersion|null;permissions:ResourcePermissions;versions?:ResourceVersion[]}
export interface ManagedResource extends Omit<ResourceDto,'title'|'summary'|'versions'> {title:Localized;summary:Localized;versions:ResourceVersion[];capabilities:ResourceCapabilities}
export interface ManagedResources {items:ManagedResource[];capabilities:{create:boolean;manageRooms:boolean}}
export interface DataRoomDto {id:string;slug:string;title:string;summary:string;status:ResourceState;version:number;permissions:ResourcePermissions}
export interface ManagedDataRoom extends Omit<DataRoomDto,'title'|'summary'> {title:Localized;summary:Localized}
export interface DocumentGrant {id:string;resourceId:string|null;roomId:string|null;userId:string|null;organizationId:string|null;canView:boolean;canDownload:boolean;expiresAt:string;reason:string;revokedAt:string|null;version:number;createdAt:string}
export type ResourceDTO=ResourceDto;
export type VersionDTO=ResourceVersion;
export type DataRoomDTO=DataRoomDto;
export interface PublicResourceSearchHit {id:string;slug:string;title:string;summary:string;type:string;versionId:string;version:number;label:string;documentLocale:'fa'|'en'|'tr'|'ar'|'ru'}
export interface PublicResourceSearchResult {items:PublicResourceSearchHit[];truncated:boolean}
