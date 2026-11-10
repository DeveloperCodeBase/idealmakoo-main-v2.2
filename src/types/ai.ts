import type {AiStatus} from '@/lib/ai-client';
import type {Locale} from '@/lib/i18n';

export interface RenderedMediaJob {
 id:string;mode:'video'|'audio';status:'pending'|'running'|'in_progress'|'completed'|'failed'|'uncertain'|'cancelled';
 createdAt:string;updatedAt:string;error:string|null;
 output?:{text?:string;media?:{url:string;mimeType:string;bytes:number;scanStatus:'pending'|'clean'|'blocked'|'error'}}|null;
}
export interface IndexedKnowledgeSource {
 id:string;sourceId:string;title:string;url:string;kind:string;sourceHash:string;model:string;dimensions:number;
 state:'pending'|'indexing'|'ready'|'stale'|'withdrawn'|'failed'|'uncertain';version:number;chunks:number;indexedChunks:number;updatedAt:string;
 job?:{id:string;state:'pending'|'running'|'complete'|'failed'|'uncertain'|'cancelled';version:number;errorCode:string|null};
}
export interface KnowledgeIndexView {
 locale:Locale;capability:AiStatus['knowledge'];availableSources:number;sourceLimit:number;items:IndexedKnowledgeSource[];
 indexedSources:number;pendingSources:number;staleSources:number;
}
export interface KnowledgeQueueResult {queued:number;unchanged:number;alreadyPending:number;needsReview:number;}
