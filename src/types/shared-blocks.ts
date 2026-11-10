import type {ContentLocale} from '@/data/catalog';
import type {PageBlock} from '@/data/workspace-seed';
export interface SharedBlockReference {blockId:string;revisionId:string}
export type SharedBlockPayload=Omit<PageBlock,'id'|'shared'>;
export interface SharedBlockRevisionSummary {id:string;blockId:string;locale:ContentLocale;number:number;checksum:string;title:string;type:string;createdBy:string;createdAt:string;baseRevisionId:string|null}
export interface SharedBlockRevision extends SharedBlockRevisionSummary {payload:SharedBlockPayload}
export interface SharedBlock {id:string;name:string;active:boolean;version:number;createdBy:string;createdAt:string;updatedAt:string;latest:Partial<Record<ContentLocale,SharedBlockRevisionSummary>>;capabilities:{edit:boolean;createRevision:boolean;archive:boolean}}
export interface SharedBlockDirectory {items:SharedBlock[];nextCursor:string|null;capabilities:{create:boolean};allowedLocales:ContentLocale[]}
export interface SharedBlockImpactItem {stage:'draft'|'scheduled'|'published';pageId:string;title:string;locale:ContentLocale;sourceStatus:string;instanceId:string;pinnedRevisionId:string;sourceUpdatedAt:string;scheduledAt:string|null;canApply:boolean}
export interface SharedBlockImpact {items:SharedBlockImpactItem[];counts:Record<'draft'|'scheduled'|'published',number>;truncated:boolean;workspaceVersion:number}
