import type {RoleKey} from '@/types/domain';
import type {ContentLocale} from '@/data/catalog';
import type {CrmScope,CrmPermissions} from '@/types/crm';
export interface StaffInvitationInput {email:string;role:Exclude<RoleKey,'customer'>;allowedLocales:ContentLocale[];qualityScope:boolean;crmScope:CrmScope;crmPermissions:CrmPermissions;teamIds:string[];territoryIds:string[];locale:ContentLocale;expiresInHours:number}
export interface StaffInvitation extends StaffInvitationInput {id:string;version:number;invitedBy:string;createdAt:string;expiresAt:string;status:'pending'|'accepted'|'revoked'|'expired';acceptedBy:string|null;acceptedAt:string|null;revokedAt:string|null}
export interface StaffPerson {id:string;name:string;role:RoleKey;qualityScope:boolean;active:boolean}
export interface StaffHandoverItem {kind:'record'|'request'|'task';id:string;recordId?:string;title:string;collection:string;responsibilities:('owner'|'assignee')[];version:number;eligibleUserIds:string[]}
export interface StaffHandoverPlan {user:StaffPerson;workspaceVersion:number;planHash:string;items:StaffHandoverItem[];recipients:StaffPerson[];blockedCount:number;canOffboard:boolean}
export interface StaffOffboardInput {expectedWorkspaceVersion:number;planHash:string;reason:string;assignments:{kind:'record'|'request'|'task';id:string;toUserId:string}[]}
