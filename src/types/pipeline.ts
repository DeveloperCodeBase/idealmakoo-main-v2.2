import type {Localized} from '@/data/catalog';
export interface PipelineChecklistItem {id:string;title:Localized;required:boolean}
export interface PipelineStage {id:string;title:Localized;kind:'open'|'won'|'lost';probabilityPercentDecimal:string;entryChecklist:PipelineChecklistItem[]}
export interface PipelineDefinition {schemaVersion:1;title:Localized;active:boolean;stages:PipelineStage[]}
export interface PipelineRevision {id:string;pipelineId:string;revisionNumber:number;definition:PipelineDefinition;checksum:string;makerId:string|null;approvedById:string|null;approvedAt:string;source:'system-default'|'reviewed'}
export interface PipelineView {id:string;version:number;isDefault:boolean;draft:PipelineDefinition|null;draftMakerId:string|null;activeRevision:PipelineRevision|null;approvalValid:boolean;mayApprove:boolean;openStageCounts:Record<string,number>;unboundOpportunityCount:number}
export interface OpportunityPipelineState {schemaVersion:1;pipelineId:string;stageId:string;completedChecklistIds:string[];revisionId?:string;probabilityPercentDecimal?:string}
export type OpportunityPipeline=OpportunityPipelineState;
