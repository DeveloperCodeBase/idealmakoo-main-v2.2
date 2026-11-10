import type {ContentLocale} from '@/data/catalog';
import type {VideoProfile} from './media-processing';

export type MediaScanStatus='pending'|'clean'|'blocked'|'error';
export interface ServerMediaAsset {
 id:string;url:string;filename:string;name:string;size:number;bytes:number;mimeType:string;
 visibility:'public'|'private';scanStatus:MediaScanStatus;createdAt:string;
}
export interface ImageRecipe {crop:{left:number;top:number;width:number;height:number};outputWidth:number;outputHeight:number;fit:'inside'|'cover';quality:number}
export interface MediaRightsPolicy {version:number;rightsConfirmed:boolean;rightsExpiresAt:string|null;licenseNote:string}
export interface DamAssetDetails {
 id:string;sourceAssetId:string;sourceWidth:number;sourceHeight:number;originalAvailable:boolean;originalUrl:string|null;
 policy:MediaRightsPolicy;effectiveRights:boolean;canManage:boolean;
 derivatives:{id:string;url:string;filename:string;bytes:number;recipe:ImageRecipe;createdAt:string;archived:boolean}[];
 usage:{id:string;bucket:string;locale:ContentLocale|null;title:string;state:'draft'|'historical'|'published'|'scheduled'}[];usageTruncated:boolean;
}
export type MediaProcessingState='pending'|'running'|'scanning'|'ready'|'failed'|'cancelled';
export interface LocalMediaProbe {width:number;height:number;durationSeconds:number;framesPerSecond:number;videoCodec:string;audioCodec:string|null}
export interface MediaProcessingJob {
 id:string;sourceAssetId:string;kind:'video'|'subtitle';profile:VideoProfile|null;locale:ContentLocale|null;name:string;
 state:MediaProcessingState;version:number;attempts:number;createdBy:string;createdAt:string;updatedAt:string;completedAt:string|null;
 lastError:string|null;sourceSha256:string;sourcePolicyVersion:number;probe:LocalMediaProbe|null;
 output:{assetId:string;url:string;filename:string;bytes:number;mimeType:string;sha256:string;scanStatus:MediaScanStatus;visibility:'public'|'private';available:boolean}|null;
 canCancel:boolean;canRetry:boolean;history:{state:MediaProcessingState;version:number;code:string|null;at:string}[];
}
export interface MediaProcessingList {
 items:MediaProcessingJob[];truncated:boolean;
 source:null|{assetId:string;scanStatus:MediaScanStatus;visibility:'public'|'private';eligible:boolean;reason:string|null};
 capabilities:{enabled:boolean;engineAvailable:boolean;profiles:VideoProfile[];canCreate:boolean;limits:{inputBytes:number;outputBytes:number;durationSeconds:number;maximumWidth:number;maximumHeight:number;framesPerSecond:number;subtitleBytes:number;subtitleCues:number;timeoutSeconds:number}};
}
