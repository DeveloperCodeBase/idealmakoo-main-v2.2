import type {Locale} from '../lib/i18n';

export const notificationTemplateKeys = ['transactional_message','request_received','request_updated','task_reminder','activity_reminder','certificate_expiring','certificate_expired','password_reset','email_verification','staff_invitation','organization_invitation','contact_verification','contact_preferences','survey_invitation'] as const;
export type NotificationTemplateKey = typeof notificationTemplateKeys[number];
export const notificationTemplateChannels = ['email','in-app','sms','telegram','push'] as const;
export type NotificationTemplateChannel = typeof notificationTemplateChannels[number];
export interface NotificationTemplateDefinition {subject:string;body:string}
export interface NotificationTemplateCatalogEntry {
  key:NotificationTemplateKey;channels:NotificationTemplateChannel[];security:boolean;
  variables:string[];requiredBody:string[];subjectForbidden:string[];
  title:Record<Locale,string>;
}
export interface NotificationTemplateCapabilities {edit:boolean;submit:boolean;review:boolean;activate:boolean;archive:boolean;deliveries:boolean}
export interface NotificationTemplateRevision {id:string;number:number;definition:NotificationTemplateDefinition;checksum:string;createdAt:string;authorId:string}
export interface NotificationTemplateReview {id:string;revisionId:string;decision:'approved'|'rejected';reason:string;reviewerId:string;createdAt:string}
export interface NotificationTemplateView {
  id:string;key:NotificationTemplateKey;channel:NotificationTemplateChannel;locale:Locale;version:number;
  state:'draft'|'review'|'approved'|'archived';currentRevision:NotificationTemplateRevision;
  activeRelease:{id:string;revisionId:string;activatedAt:string}|null;
  history:NotificationTemplateRevision[];reviews:NotificationTemplateReview[];
  capabilities:NotificationTemplateCapabilities;updatedAt:string;
}
export interface NotificationTemplateList {
  items:NotificationTemplateView[];
  catalog:Array<NotificationTemplateCatalogEntry & {defaults:Partial<Record<NotificationTemplateChannel,NotificationTemplateDefinition>>;capabilities:NotificationTemplateCapabilities}>;
  capabilities:NotificationTemplateCapabilities;
}
export interface NotificationTemplatePreview {subject:string;body:string;locale:Locale;channel:NotificationTemplateChannel;sample:true;limits:{subject:number;body:number}}
export interface NotificationDeliverySummary {
  id:string;channel:NotificationTemplateChannel;state:string;createdAt:string;completedAt:string|null;
  template:{key:NotificationTemplateKey;locale:Locale;releaseId:string|null;renderHash:string;decision:string}|null;
  receipt:{provider:string;status:string;detail:string|null;at:string}|null;
}
