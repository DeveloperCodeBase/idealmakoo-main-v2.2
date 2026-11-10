import type {ContentLocale} from '@/data/catalog';
export const routableRequestKinds=['rfq','sample_request','distribution_partnership','supplier_registration','outsourcing_bid','investment_interest','research_proposal','support_ticket','quality_complaint','factory_visit','cms_form','contact','event_registration'] as const;
export type RoutableRequestKind=typeof routableRequestKinds[number];
export interface CalendarInterval {startMinute:number;endMinute:number}
export interface CalendarDefinition {name:string;active:boolean;timeZone:string;weekdays:number[];intervals:CalendarInterval[];holidays:string[];assignmentMinutes:number;firstResponseMinutes:number;resolutionMinutes:number}
export interface BusinessCalendar extends CalendarDefinition {id:string;version:number;isDefault:boolean;updatedAt:string}
export interface CrmRoutingRuleDefinition {name:string;active:boolean;priority:number;teamId:string;territoryId:string|null;calendarId:string;kinds:RoutableRequestKind[];locales:ContentLocale[];countries:string[]}
export interface CrmRoutingRule extends CrmRoutingRuleDefinition {id:string;version:number;configuredById:string;updatedAt:string;lastAssigneeId:string|null}
export interface CrmRoutingDecision {id:string;requestId:string;ruleId:string|null;ruleVersion:number|null;assigneeId:string|null;teamId:string|null;territoryId:string|null;calendarId:string;calendarVersion:number;status:string;reason:string;decidedAt:string}
export interface CrmRequestSla {assignmentDueAt?:string;firstResponseDueAt?:string;resolutionDueAt?:string;assignedAt?:string;lastAssignedAt?:string;pausedAt?:string;firstRespondedAt?:string;calendarId?:string;calendarVersion?:number}
export interface CrmRoutingConfiguration {calendars:BusinessCalendar[];rules:CrmRoutingRule[]}
