import type {ContentLocale} from '@/data/catalog';
export interface CrmTimelineEntry {id:string;recordId:string;version:number;kind:'call'|'meeting'|'note';body:string;occurredAt:string;recordedAt:string;authorId:string;updatedAt:string;archived:boolean}
export interface CrmTaskDefinition {
 recordId:string;assigneeUserId:string;title:string;body:string;
 due:{kind:'instant';at:string}|{kind:'date';date:string;timezone:string};
 recurrence:{frequency:'daily'|'weekly'|'monthly';interval:number;count:number}|null;
 reminderMinutes:number;
}
export interface CrmTaskOccurrence {id:string;generation:number;ordinal:number;version:number;dueAt:string;dueDate:string|null;reminderAt:string;status:'open'|'completed'|'cancelled';completedAt:string|null;remindedAt:string|null;reminderStatus:'pending'|'queued'|'delivered'|'cancelled'|'failed'|'uncertain';reminderError:string|null}
export interface CrmTaskSeries {id:string;version:number;generation:number;active:boolean;definition:CrmTaskDefinition;createdBy:string;createdAt:string;updatedAt:string;occurrences:CrmTaskOccurrence[]}
export interface CrmForecastFilters {createdFrom?:string;createdUntil?:string;pipelineId?:string}
export interface CrmForecastGroup {currency:string;stageId:string;pipelineId:string|null;stageKind:string;count:number;knownAmountDecimal:string;knownWeightedAmountDecimal:string;weightedAmountDecimal:string|null;unknownAmountCount:number;unknownProbabilityCount:number;tomanEquivalentDecimal:string|null}
export interface CrmForecast {schemaVersion:1;calculationPolicyVersion:string;capturedAt:string;workspaceVersion:number;filters:CrmForecastFilters;opportunityCount:number;groups:CrmForecastGroup[]}
export interface CrmReportSnapshot {id:string;createdAt:string;createdBy:string;checksum:string;report:CrmForecast}
export interface CrmSuccessDefinition {recordId:string;title:string;notes:string;nextContactOn:string|null;factors:{id:string;title:string;weight:number;score:number|null;evidence:string}[]}
export interface CrmSuccessPlan {id:string;version:number;state:'active'|'closed'|'archived';definition:CrmSuccessDefinition;health:{scoreDecimal:string|null;coveragePercentDecimal:string;knownFactors:number;unknownFactors:number};createdAt:string;updatedAt:string}
export interface CrmSurveyInvitation {id:string;requestId:string;kind:'csat'|'nps';locale:ContentLocale;question:string;expiresAt:string;createdAt:string;revokedAt:string|null;respondedAt:string|null;score:number|null;comment:string|null}
