import type {WorkspaceForm,WorkspaceState} from '@/data/workspace-seed';
import type {Locale} from '@/lib/i18n';

export type EditorRevisionBucket='records'|'pages'|'forms';
export interface EditorRevision {
 id:string;document_id:string;locale:Locale;revision_number:number;checksum:string;created_by:string;created_at:string;approved_by?:string|null;approved_at?:string|null;
}
export interface EditorRevisionDetail {revision:EditorRevision;bucket:EditorRevisionBucket;snapshot:Record<string,unknown>;version:number}
export interface FormUsage {id:string;title:string;locale:Locale}
export interface ManagedWorkspaceForm {
 form:WorkspaceForm;status:'active'|'archived'|'deleted';
 capabilities:{edit:boolean;archive:boolean;delete:boolean;restore:boolean;history:boolean};
 usage:{drafts:FormUsage[];published:FormUsage[];scheduled:FormUsage[];blocked:boolean};
}
export interface FormDirectory {items:ManagedWorkspaceForm[];version:number;canCreate:boolean;nextCursor:string|null}
export interface EditorWorkspaceResult {state:WorkspaceState;version:number}
export type FormLifecycleAction='archive'|'delete'|'restore';
export interface TranslationRevisionSource {documentId:string;locale:Locale;revisionId:string;revisionNumber:number;checksum:string;title:string;updatedAt:string}
export interface TranslationAcknowledgement {id:string;sourceRevisionId:string;targetRevisionId:string;acknowledgedAt:string;acknowledgedBy:string}
export interface TranslationStatus {
 status:'unknown'|'current'|'stale'|'unconfirmed'|'missing_source'|'missing_translation';
 source:TranslationRevisionSource|null;target:TranslationRevisionSource|null;
 acknowledgement:TranslationAcknowledgement|null;canAcknowledge:boolean;version:number;
}
