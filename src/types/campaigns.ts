import type{Locale}from'@/lib/i18n';
export type SegmentField='locale'|'requestKind'|'requestStatus'|'tag'|'subjectType'|'accountId';
export type SegmentFilter={field:SegmentField;op:'in';values:string[]}|{all:SegmentFilter[]}|{any:SegmentFilter[]};
export type SegmentAudience='users'|'contacts'|'all';
export interface SegmentInput{name:string;filter:SegmentFilter;active:boolean;audience:SegmentAudience}
export interface CrmSegment extends SegmentInput{id:string;version:number;createdBy:string;createdAt:string;updatedAt:string}
export interface CampaignRecipient{recipientId:string;subjectType:'user'|'crm-contact';subjectId:string;userId?:string;name:string;emailMasked:string;locale:Locale;emailVerified:boolean}
export interface SegmentPreview{segmentId:string;version:number;definitionHash:string;matched:number;sample:CampaignRecipient[];sampleLimit:number;countsReflectCurrentAccess:true}
export interface SegmentSnapshot{id:string;segmentId:string;segmentVersion:number;createdBy:string;createdAt:string;definitionHash:string;visibleMembers:number}
export type CampaignChannel='in-app'|'email'|'sms'|'telegram'|'push';
export type CampaignTopic='products'|'research'|'events';
export interface CampaignStep{delayMinutes:number;content:Record<Locale,{title:string;body:string;href:string}>}
export interface CampaignDraft{name:string;segmentId:string;snapshotId:string|null;topic:CampaignTopic;channels:CampaignChannel[];steps:CampaignStep[]}
export interface CampaignCapabilities{enabled:boolean;channels:{inApp:boolean;email:boolean;sms:boolean;telegram:boolean;push:boolean};allowedLocales:Locale[];limits:{recipients:number;steps:number;filterDepth:number;filterPredicates:number;previewSamples:number}}
export interface SegmentDirectory{items:CrmSegment[];snapshots:SegmentSnapshot[];capabilities:CampaignCapabilities}
export interface CampaignSummary{id:string;name:string;status:'draft'|'scheduled'|'running'|'completed'|'cancelled'|'failed';version:number;createdBy:string;createdAt:string;updatedAt:string;startAt:string|null;revisionId:string|null;revisionHash:string|null;enrollmentComplete:boolean;stopCode:string|null}
export type EnrollmentState='pending'|'waiting'|'completed'|'suppressed'|'failed'|'uncertain'|'cancelled';
export type DeliveryState='pending'|'running'|'batched'|'delivered'|'cancelled'|'failed'|'uncertain';
export interface CrmCampaign extends CampaignSummary{draft:CampaignDraft;revision:{id:string;audience:SegmentAudience;version:number;hash:string;senderId:string;segmentVersion:number;filter:SegmentFilter;draft:CampaignDraft;createdAt:string}|null;counts:Record<EnrollmentState,number>;recent:{id:string;recipientId:string;subjectType:'user'|'crm-contact';subjectId:string;userId?:string;name:string;locale:Locale;state:EnrollmentState;stepIndex:number;nextAt:string|null;stopCode:string|null}[];deliveryCounts:Record<DeliveryState,number>;deliveries:{id:string;outboxId:string;enrollmentId:string;recipientId:string;subjectType:'user'|'crm-contact';subjectId:string;userId?:string;stepIndex:number;channel:CampaignChannel;locale:Locale;state:DeliveryState;lastError:string|null;createdAt:string;completedAt:string|null}[];countsReflectCurrentAccess:true}
export interface CampaignDirectory{items:CampaignSummary[];capabilities:CampaignCapabilities}
export interface CrmSuppression{id:string;recipientId:string;subjectType:'user'|'crm-contact';subjectId:string;userId?:string;scope:'sender'|'global';senderId:string|null;topic:CampaignTopic|'all';channel:CampaignChannel|'all';reason:string;version:number;active:boolean;createdBy:string;createdAt:string;revokedAt:string|null}
