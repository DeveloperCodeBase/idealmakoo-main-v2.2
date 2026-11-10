import type {PageDraft} from '@/data/workspace-seed';
import type {Locale} from '@/lib/i18n';

export type PageLifecycleStatus='active'|'archived'|'deleted';
export type PageLifecycleAction='archive'|'delete'|'restore';
export interface ManagedWorkspacePage {
 page:PageDraft;
 status:PageLifecycleStatus;
 capabilities:{edit:boolean;archive:boolean;delete:boolean;restore:boolean;history:boolean};
 publication:{liveLocales:Locale[];scheduledLocales:Locale[];requiresPublisher:boolean};
}
export interface PageDirectory {
 items:ManagedWorkspacePage[];
 version:number;
 nextCursor:string|null;
}
export interface PageLifecycleCommand {
 operation:PageLifecycleAction;
 reason:string;
 expectedVersion:number;
 expectedPageVersion:number;
 expectedUpdatedAt:string;
}
