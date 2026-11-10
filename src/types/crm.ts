import type {RoleKey} from '@/types/domain';
export type CrmScope='assigned'|'team'|'all';
export interface CrmPermissions {contact:boolean;financial:boolean;baseCost:boolean;assign:boolean;intake:boolean}
export interface CrmAccess {scope:'assigned'|'team'|'all';permissions:CrmPermissions;teamIds:string[];territoryIds:string[]}
export interface CrmGroup {id:string;name:string;active:boolean;version:number;members:{userId:string;name:string;role:RoleKey}[]}
export interface CrmAssignee {id:string;name:string;role:RoleKey;qualityScope:boolean;allowedLocales?:string[];teamIds:string[];territoryIds:string[]}
export interface CrmScopeDirectory {access:CrmAccess;teams:CrmGroup[];territories:CrmGroup[];assignees:CrmAssignee[]}
