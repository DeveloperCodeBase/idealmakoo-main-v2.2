import {publicNoticeForPublication,publicNoticePublicationVisible,assertPublicNoticeRemoval} from './workspace-public-notices';
import {createSourceGlossaryDrafts} from '../data/glossary-import';
import {glossaryForPublication} from './workspace-glossary';
import type {PgRow} from './recovered-db-rows';
import type {Locale} from '../lib/i18n';
import type {EditorialSeoByLocale} from '../lib/editorial-seo';
type DomainWrite = {afterPersist:(client:PoolClient,records:WorkspaceRecord[])=>Promise<void>};
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
interface Meta {version:string|number;settings:WorkspaceState['settings'];preferences_draft:SitePreferences|null;preferences_published:SitePreferences|null;initialized_at:string|null}

interface Revision {id:string;checksum:string;revision_number:string|number;created_by:string;snapshot:WorkspaceRecord|PageDraft}

import type { PoolClient } from 'pg';
import type { WorkspaceState, WorkspaceRecord, WorkspaceForm, PageDraft, LocalPublication, WorkspaceActivity, PageBlock } from '@/data/workspace-seed';
import type { PublicFormSchema } from '@/lib/form-schema';
import type { FrontRequest } from '@/types/frontend';
import type { SitePreferences, SitePreferenceMode } from '@/lib/site-preferences';
import type { Actor } from './types';
import type { Bucket, WorkspaceRow, WorkspaceChange } from './workspace-policy';
import { LOCALES, integer, validateRecord, assertObject, keys, locale, id, string, validateBlocks, safeJson } from "./workspace-validation";
import { HttpError } from "./types";
import { createWorkspaceSeed, recordText } from "@/data/workspace-seed";
import { isContent, serverActivity, checksum, recordReviewSnapshot, editableSnapshot, canReviewSource, hasWorkspacePermission, assertWorkspaceActor, projectForActor, planWorkspaceMutation, readableRecord, equal } from "./workspace-policy";
import { editablePublicTargets, createSiteDraft } from "@/lib/site-content";
import { defaultSitePreferences, validateServerPreferences,withPreferenceExtensions } from "./workspace-preferences";
import { audit, transaction, query } from "./db";
import { randomUUID } from "node:crypto";
import { assertContentLeaseWrites } from "./content-collaboration";
import { validateSharedBlockChanges, validateSharedPagePublication } from "./shared-blocks";
import { validateDamMediaChanges, assetUsageAllowed } from "./dam";
import { assertCrmDomainChanges } from "./workspace-domain-policy";
import { validateCrmChanges } from "./workspace-crm";
import { normalizeOpportunityChanges, persistOpportunityPosition } from "./workspace-pipelines";
import { validateCrmAutomationRecord, enqueueCrmAutomationEvent } from "./automation";
import { validateCommercialMetadata, approvePricebook, approveCommercialQuote } from "./workspace-commercial";
import { isOfficialSource, sourceVisibilityAction, getSourcePublicVisibility } from "./workspace-public-visibility";
import { loadCrmAccess, redactCrmRecord, isScopedCrmRecord, canAccessCrmRequest, crmRequestCollection } from "./workspace-scopes";
import { parseFormSchema } from "@/lib/form-schema";
import { parseCustomProduct } from "@/lib/custom-products";
import { products, articles } from "@/data/catalog";
import { parseProductRelease } from "@/lib/product-release";
import { parseEditorialSeoByLocale, editorialSeoIssues } from "../lib/editorial-seo";
import { enqueuePublicationNotificationEvent } from "./notification-publications";
import { canWorkspace } from "@/lib/auth";
import {assertSitePageMutation} from './page-authority';
import { routeNewWorkspaceRequest, resumeRequestBusinessSla } from "./workspace-routing";
import { enqueueAccountNotification } from "./notification-policy";
const seedActor:Actor={id:'system-source-import',role:'superAdmin',name:'Official source import',email:'',qualityScope:true,allowedLocales:[...LOCALES],mfaVerified:true};
const now=()=>new Date().toISOString();
const conflict=():never=>{throw new HttpError(409,'conflict','The workspace changed. Reload the latest version before saving.');};
function expected(value:unknown,version:number) {integer(value,'expectedVersion',0);if(value!==version)conflict();}
const rowCollection=(bucket:Bucket,row:WorkspaceRow)=>bucket==='records'?(row as WorkspaceRecord).collection:bucket;
const rowStatus=(row:WorkspaceRow)=>'status' in row?String(row.status):'active';
function createProductionWorkspaceSeed():WorkspaceState {
  const initial=createWorkspaceSeed();
  if(process.env.DEMO_MODE==='true') {
    if(process.env.NODE_ENV==='production')throw new Error('DEMO_MODE is forbidden in production');
    return {...initial,records:initial.records.filter(record=>record.collection!=='staff').map(record=>({...record,status:isContent(record)?'draft':record.status,author:'system',authorId:seedActor.id,approvedBy:undefined,approvedById:undefined,publishedLocales:[],history:[]})),pages:initial.pages.map(page=>({...page,author:'system',authorId:seedActor.id})),audit:[]};
  }
  return {...initial,records:[...initial.records.filter(record=>!record.demo&&record.collection!=='staff').map(record=>({...record,status:isContent(record)?'draft':record.status,author:'system',authorId:seedActor.id,approvedBy:undefined,approvedById:undefined,publishedLocales:[],history:[],createdAt:now(),updatedAt:now()})),...createSourceGlossaryDrafts(now())],pages:editablePublicTargets.flatMap(target=>LOCALES.map(lang=>createSiteDraft(target.slug,lang,'system',seedActor.id))),aiJobs:[],audit:[],forms:initial.forms.map(form=>({...form,responses:[]}))};
}
async function lockWorkspace(client:PoolClient):Promise<Meta> {
  const {rows}=await client.query<Meta>('SELECT * FROM workspace_meta WHERE singleton=true FOR UPDATE');
  const meta=rows[0];if(!meta)throw new Error('Workspace migration is not installed');
  if(meta.initialized_at)return meta;
  const state=createProductionWorkspaceSeed();
  for(const bucket of ['records','pages','media','forms','aiJobs'] as const)for(const row of state[bucket])await writeEntity(client,bucket,row,seedActor);
  const preferences=defaultSitePreferences();
  await client.query('UPDATE workspace_meta SET settings=$1::jsonb,preferences_published=$2::jsonb,initialized_at=now(),version=1,updated_at=now() WHERE singleton=true',[JSON.stringify(state.settings),JSON.stringify(preferences)]);
  return {...meta,version:1,settings:state.settings,preferences_published:preferences,initialized_at:now()};
}
/** Idempotent upgrade intake: do not overwrite edited, archived, deleted or already reviewed terms. */
async function installSourceGlossaryDrafts(){
    return transaction(async client=>{
        await lockWorkspace(client);
        let inserted=0;
        for(const row of createSourceGlossaryDrafts(now())){
            const exists=await client.query("SELECT 1 FROM workspace_entities WHERE bucket='records' AND id=$1",[row.id]);
            if(exists.rowCount)continue;
            await writeEntity(client,'records',row,seedActor);
            await appendAudit(client,seedActor,'glossary.source-intake','records',row.id,undefined,{definitionStatus:'imported-unreviewed',approvalStatus:'unreviewed'});
            inserted++;
        }
        if(inserted)await bumpVersion(client);
        return{inserted};
    });
}
/** Explicit seed/upgrade intake only. Never called by a public request or app startup. */
async function installSourcePageDrafts(){
    return transaction(async client=>{
        await lockWorkspace(client);
        const existing=(await client.query<{id:string;locale:Locale;status:string;data:PageDraft;revision_number:string|number;created_by:string;updated_by:string;created_at:Date;updated_at:Date;deleted_at:Date|null}>("SELECT id,locale,status,data,revision_number,created_by,updated_by,created_at,updated_at,deleted_at FROM workspace_entities WHERE bucket='pages' FOR UPDATE")).rows;
        const protectedIds=new Set((await client.query<{document_id:string}>(`
            SELECT document_id FROM content_revisions WHERE document_bucket='pages'
            UNION SELECT document_id FROM locale_releases WHERE document_bucket='pages'
            UNION SELECT entity_id AS document_id FROM workspace_audit WHERE bucket='pages'
            UNION SELECT document_id FROM content_edit_leases WHERE document_bucket='pages' AND lease_until>now()
        `)).rows.map(row=>row.document_id));
        const releasedRoutes=new Set((await client.query<{slug:string;locale:string}>("SELECT slug,locale FROM locale_releases WHERE document_bucket='pages'")).rows.map(row=>row.locale+'\0'+row.slug));
        let inserted=0,repaired=0;
        for(const target of editablePublicTargets)for(const lang of LOCALES){
            const source=createSiteDraft(target.slug,lang,'system',seedActor.id);
            const row=existing.find(item=>item.id===source.id);
            // A deleted identity or custom page at the same route remains reserved.
            if(protectedIds.has(source.id)||releasedRoutes.has(lang+'\0'+source.slug)||existing.some(item=>item.id!==source.id&&item.data.slug===source.slug&&item.locale===lang))continue;
            if(!row){
                await writeEntity(client,'pages',source,seedActor);
                await appendAudit(client,seedActor,'pages.source-intake','pages',source.id,undefined,{locale:lang,status:'imported-unreviewed'});
                inserted++;
                continue;
            }
            if(row.deleted_at||row.status!=='draft'||row.locale!==lang||Number(row.revision_number)!==1||row.created_by!==seedActor.id||row.updated_by!==seedActor.id||row.created_at.getTime()!==row.updated_at.getTime())continue;
            // Match the exact empty factory shape from the older source release.
            // Even a changed title, extra field, reordered block, or empty authored
            // revision is enough to preserve the operator's existing content.
            const {updatedAt,...candidate}=row.data;
            if(typeof updatedAt!=='string'||!Number.isFinite(Date.parse(updatedAt)))continue;
            const blank:Omit<PageDraft,'updatedAt'>={id:source.id,slug:source.slug,locale:lang,title:target.title[lang],summary:'',status:'draft',version:1,author:'system',authorId:seedActor.id,blocks:[{id:`${source.slug}-hero`,type:'hero',title:target.title[lang],body:''},{id:`${source.slug}-body`,type:'rich-text',title:'',body:''}]};
            if(!equal(candidate,blank))continue;
            await writeEntity(client,'pages',{...source,version:2},seedActor);
            await appendAudit(client,seedActor,'pages.blank-source-repaired','pages',source.id,undefined,{locale:lang,status:'imported-unreviewed',previous:'untouched-empty-factory-draft'});
            repaired++;
        }
        if(inserted||repaired)await bumpVersion(client);
        return{inserted,repaired};
    });
}
async function readMeta(client:PoolClient):Promise<Meta> {
  const initial=await client.query<Meta>('SELECT * FROM workspace_meta WHERE singleton=true');
  if(!initial.rows[0]?.initialized_at)return lockWorkspace(client);
  return (await client.query<Meta>('SELECT * FROM workspace_meta WHERE singleton=true FOR SHARE')).rows[0];
}
async function readWorkspace(client:PoolClient,meta:Meta):Promise<WorkspaceState> {
  const state:WorkspaceState={version:1,records:[],pages:[],media:[],forms:[],aiJobs:[],audit:[],settings:meta.settings};
  const {rows}=await client.query<{bucket:Bucket;data:WorkspaceRow}>('SELECT bucket,data FROM workspace_entities WHERE deleted_at IS NULL ORDER BY created_at,id');
  for(const row of rows)(state[row.bucket] as WorkspaceRow[]).push(row.data);
  const ledger=await client.query<{activity:WorkspaceActivity}>('SELECT activity FROM workspace_audit ORDER BY id DESC LIMIT 300');state.audit=ledger.rows.map(row=>row.activity);
  return state;
}
async function writeEntity(client:PoolClient,bucket:Bucket,row:WorkspaceRow,actor:Actor) {
  if(bucket==='forms'){
    const previous=(await client.query<{data:WorkspaceForm;updated_at:Date}>("SELECT data,updated_at FROM workspace_entities WHERE bucket='forms' AND id=$1",[row.id])).rows[0];
    if(previous){const {ensureFormRevision}=await import('./editor-workflows');await ensureFormRevision(client,{...previous.data,updatedAt:previous.data.updatedAt||previous.updated_at.toISOString()},actor.id);}
    const form:WorkspaceForm=row as WorkspaceForm;
    row={...form,status:form.status||'active',updatedAt:form.updatedAt||now()};
  }
  await client.query(`INSERT INTO workspace_entities(bucket,id,collection,locale,status,owner_id,data,created_by,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8)
    ON CONFLICT(bucket,id) DO UPDATE SET collection=excluded.collection,locale=excluded.locale,status=excluded.status,owner_id=excluded.owner_id,data=excluded.data,revision_number=workspace_entities.revision_number+1,updated_by=excluded.updated_by,updated_at=now(),deleted_at=NULL`,
    [bucket,row.id,rowCollection(bucket,row),'locale' in row?row.locale:null,rowStatus(row),'owner' in row?row.owner:null,JSON.stringify(row),actor.id]);
  if(bucket==='forms'){const {ensureFormRevision}=await import('./editor-workflows');await ensureFormRevision(client,row as WorkspaceForm,actor.id);}
}
async function appendAudit(client:PoolClient,actor:Actor,action:string,bucket:string,entityId:string,activity?:WorkspaceActivity,details:Record<string,unknown>={}) {
  const entry=activity||serverActivity(actor,action,entityId);
  await client.query('INSERT INTO workspace_audit(activity_id,actor_id,actor_role,action,bucket,entity_id,activity,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)',[entry.id,actor.id,actor.role,action,bucket,entityId,JSON.stringify(entry),JSON.stringify(details)]);
  await audit(actor.id,`workspace.${action}`,bucket,entityId,details,client);
  return entry;
}
async function bumpVersion(client:PoolClient,settings?:WorkspaceState['settings']) {
  const {rows}=await client.query<{version:string}>('UPDATE workspace_meta SET version=version+1,updated_at=now(),settings=COALESCE($1::jsonb,settings) WHERE singleton=true RETURNING version',[settings?JSON.stringify(settings):null]);return Number(rows[0].version);
}
function sourceChecksum(bucket:string,source:WorkspaceRecord|PageDraft) {return checksum(bucket==='records'?recordReviewSnapshot(source as WorkspaceRecord):editableSnapshot(source));}
async function ensureRevision(client:PoolClient,bucket:'records'|'pages',source:WorkspaceRecord|PageDraft,lang:string):Promise<Revision> {
  const previous=await client.query<Revision>('SELECT * FROM content_revisions WHERE document_bucket=$1 AND document_id=$2 AND locale=$3 ORDER BY revision_number DESC LIMIT 1',[bucket,source.id,lang]);
  const digest=sourceChecksum(bucket,source);if(previous.rows[0]?.checksum===digest&&previous.rows[0]?.created_by===(source.authorId||seedActor.id))return previous.rows[0];
  const value:Revision={id:randomUUID(),checksum:digest,revision_number:Number(previous.rows[0]?.revision_number||0)+1,created_by:source.authorId||seedActor.id,snapshot:source};
  await client.query('INSERT INTO content_revisions(id,document_bucket,document_id,locale,revision_number,base_revision_id,snapshot,checksum,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',[value.id,bucket,source.id,lang,value.revision_number,previous.rows[0]?.id||null,JSON.stringify(source),digest,value.created_by]);return value;
}
async function approvedRevision(client:PoolClient,bucket:'records'|'pages',source:WorkspaceRecord|PageDraft,lang:string) {
  const result=await client.query<Revision&{approved_by:string;approved_role:string}>(`SELECT r.*,a.approved_by,a.approved_role FROM content_revisions r JOIN content_approvals a ON a.revision_id=r.id WHERE r.document_bucket=$1 AND r.document_id=$2 AND r.locale=$3 AND r.checksum=$4 AND r.created_by=$5 ORDER BY r.revision_number DESC LIMIT 1`,[bucket,source.id,lang,sourceChecksum(bucket,source),source.authorId||seedActor.id]);
  const revision=result.rows[0];
  if(!revision||revision.created_by===revision.approved_by)throw new HttpError(409,'approval_required','This exact content revision needs independent approval');
  return revision;
}
async function assertWorkspaceRecordApproved(client:PoolClient,record:WorkspaceRecord,lang:string='fa') {return approvedRevision(client,'records',record,lang);}
function mediaReferences(state:WorkspaceState, url:string, id2?:string) {
    const references:string[]=[];
    for (const record of state.records)
        if (record.status !== "archived" && (record.image === url || JSON.stringify(record.details||{}).includes(url)))
            references.push(record.id);
    for (const page of state.pages)
        if (page.blocks.some(block=>block.mediaUrl===url||block.link===url))
            references.push(page.id);
    return [...new Set(references.filter(reference => reference !== id2))];
}
async function protectDeletions(client:PoolClient,state:WorkspaceState,changes:WorkspaceChange[]) {
    const active=await client.query<{publication:LocalPublication}>('SELECT publication FROM locale_releases WHERE unpublished_at IS NULL');
    for (const change of changes)
        if (change.before && change.after && rowStatus(change.after) === "archived" && rowStatus(change.before) !== "archived" && active.rows.some(row=>row.publication.id===change.id))
            throw new HttpError(409, "published_content", "Unpublish every locale before archiving this content");
    for (const change of changes)
        if (change.before && !change.after) {
            if (change.bucket === "records" && change.before.collection === "pricebooks" && (await client.query("SELECT 1 FROM crm_pricebook_revisions WHERE pricebook_id=$1 LIMIT 1", [change.id])).rowCount)
                throw new HttpError(409, "pricebook_history", "An approved pricebook retains commercial history; archive it instead of deleting it");
            if (change.bucket === "media") {
                const medium=change.before as WorkspaceState['media'][number];
                const usages=mediaReferences(state,medium.url,medium.id);
                if (usages.length || active.rows.some(row=>JSON.stringify(row.publication).includes(medium.url)))
                    throw new HttpError(409, "asset_in_use", "Remove the media from all drafts and published releases before deleting it");
            }
            if (change.bucket === "forms" && (state.pages.some(page=>page.blocks.some(block=>block.formId===change.id)) || active.rows.some(row=>row.publication.blocks.some(block=>block.formId===change.id))))
                throw new HttpError(409, "form_in_use", "Remove the form from all drafts and published releases first");
            if (['records','pages'].includes(change.bucket) && active.rows.some(row=>row.publication.id===change.id))
                throw new HttpError(409, "published_content", "Unpublish every locale before deleting this content");
            if (change.bucket === "records" && state.records.some(record=>record.linkedId===change.id))
                throw new HttpError(409, "record_in_use", "A linked record must be detached or archived before deleting this record");
        }
}
async function persistPlan(client:PoolClient, actor:Actor, plan:ReturnType<typeof planWorkspaceMutation>, commandLocale?:string, leaseTokens: string[] = [], domainCommand?: DomainWrite, sharedBlockCommand = false) {
    await (assertContentLeaseWrites)(client, actor, plan.changes, leaseTokens);
    await (validateSharedBlockChanges)(client, actor, plan.changes, sharedBlockCommand);
    await (validateDamMediaChanges)(client, plan.changes);
    await (assertCrmDomainChanges)(client, plan.changes, !!domainCommand);
    await protectDeletions(client,plan.state,plan.changes);
    for(const change of plan.changes)if(change.bucket==='pages'&&change.after)await (await import('./editor-workflows')).assertPageFormReferences(client,change.after,change.before,plan.state.forms);
    const crm=validateCrmChanges(plan.original,plan.state,actor);
    await (normalizeOpportunityChanges)(client, actor, plan);
    for (const operation of crm.merges) {
        const stamped={...operation,actor:actor.id,at:now()};
        for (const record of plan.state.records) {
            const entries=record.details?.crmMergeOperations as typeof crm.merges|undefined;
            if (record.id === operation.targetId && entries)
                record.details = { ...record.details, crmMergeOperations: entries.map(item=>item.id===operation.id?stamped:item) };
            if (record.id === operation.sourceId)
                record.details = { ...record.details, crmMergeAlias: { operationId: operation.id, targetId: operation.targetId, at: stamped.at } };
        }
        await client.query('INSERT INTO crm_merge_operations(id,target_id,source_id,collection,snapshot,actor_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[operation.id,operation.targetId,operation.sourceId,operation.collection,JSON.stringify({operation:stamped,beforeTarget:plan.original.records.find(row=>row.id===operation.targetId),beforeSource:plan.original.records.find(row=>row.id===operation.sourceId)}),actor.id]);
    }
    for (const operation of crm.unmerges) {
        const result=await client.query('UPDATE crm_merge_operations SET undone_at=now() WHERE id=$1 AND target_id=$2 AND source_id=$3 AND undone_at IS NULL RETURNING id',[operation.id,operation.targetId,operation.sourceId]);
        if (!result.rowCount)
            throw new HttpError(409, "merge_conflict", "The merge operation was already undone or changed");
    }
    for (const change of plan.changes) {
        if(change.bucket==='records'&&change.before?.details?.publicNotice!==undefined&&(!change.after||change.after.status==='archived'))assertPublicNoticeRemoval(change.before,actor);
        if (change.after) {
            if (change.bucket === "records") {
                validateCrmAutomationRecord(change.after as WorkspaceRecord,actor);
                (validateCommercialMetadata)(change.after);
            }
            const tombstone=await client.query('SELECT 1 FROM workspace_entities WHERE bucket=$1 AND id=$2 AND deleted_at IS NOT NULL',[change.bucket,change.id]);
            if (tombstone.rowCount && !change.before)
                throw new HttpError(409, "deleted_identity", "Deleted identifiers cannot be reused; create a new record");
            await writeEntity(client,change.bucket,change.after,actor);
            if (change.bucket === "records")
                await (persistOpportunityPosition)(client, actor, change.after);
            if (change.bucket === "pages" || change.bucket === "records" && (isContent(change.after as WorkspaceRecord) || ["quotes", "pricebooks"].includes(change.after.collection))) {
                const source=change.after as WorkspaceRecord|PageDraft, bucket=change.bucket as 'records'|'pages';
                const languages='collection' in source?[...LOCALES]:[source.locale];
                const approving=source.status==='approved'&&(!change.before||rowStatus(change.before)!=='approved');
                if (approving && "collection" in source && (!commandLocale || !canReviewSource(actor,source,commandLocale)))
                    throw new HttpError(422, "review_locale", "Select a locale that this independent reviewer is assigned to review");
                for (const lang of languages) {
                    const revision=await ensureRevision(client,bucket,source,lang);
                    if (approving && (!("collection" in source) || lang === commandLocale) && canReviewSource(actor,source,lang)) {
                        if('collection' in source)publicNoticeForPublication(source,lang);
                        await client.query('INSERT INTO content_approvals(revision_id,approved_by,approved_role) VALUES($1,$2,$3) ON CONFLICT(revision_id) DO NOTHING',[revision.id,actor.id,actor.role]);
                        if ("collection" in source && source.collection === "pricebooks")
                            await (approvePricebook)(client, actor, source, revision);
                        if ("collection" in source && source.collection === "quotes")
                            await (approveCommercialQuote)(client, actor, source, revision, lang);
                    }
                    if (source.status === "scheduled" && (!change.before || rowStatus(change.before) !== "scheduled")) {
                        if ("collection" in source && !commandLocale)
                            throw new HttpError(422, "schedule_locale", "Select the content language for the scheduled release");
                        if ("collection" in source && lang !== commandLocale)
                            continue;
                        if (!hasWorkspacePermission(actor,'publish',bucket==='pages'?'pages':(source as WorkspaceRecord).collection,lang))
                            throw new HttpError(403, "forbidden", "Scheduling this content locale is not allowed");
                        const approved=await approvedRevision(client,bucket,source,lang);
                        const publication=publicationForSource(source,lang);
                        await client.query("UPDATE workspace_publish_jobs SET status='cancelled',finished_at=now() WHERE document_bucket=$1 AND document_id=$2 AND locale=$3 AND status='pending'",[bucket,source.id,lang]);
                        await client.query('INSERT INTO workspace_publish_jobs(id,document_bucket,document_id,locale,revision_id,publication,requested_by,requested_role,due_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[randomUUID(),bucket,source.id,lang,approved.id,JSON.stringify(publication),actor.id,actor.role,source.scheduledAt]);
                    }
                }
                if (!['scheduled','approved','published'].includes(source.status))
                    await client.query("UPDATE workspace_publish_jobs SET status='cancelled',finished_at=now() WHERE document_bucket=$1 AND document_id=$2 AND status='pending'",[bucket,source.id]);
            }
            if (change.bucket === "records") {
                const record=change.after as WorkspaceRecord, previous=change.before as WorkspaceRecord|undefined;
                const editorial=record.details?.editorialContent as {mediaId?:string;mediaUrl?:string;mediaType?:string}|undefined;
                if (editorial?.mediaId) {
                    const medium=plan.state.media.find(item=>item.id===editorial.mediaId);
                    if (!medium || medium.url !== editorial.mediaUrl || medium.type !== editorial.mediaType)
                        throw new HttpError(422, "media_reference", "Editorial media must reference the selected media library asset");
                }
                if (!domainCommand && record.collection === "leads" && record.status === "converted" && previous?.status !== "converted") {
                    const conversion=await client.query<{opportunity_id:string}>('SELECT opportunity_id FROM crm_lead_conversions WHERE lead_id=$1',[record.id]);
                    if (conversion.rowCount && conversion.rows[0].opportunity_id !== record.linkedId)
                        throw new HttpError(409, "already_converted", "This lead already has a durable opportunity conversion");
                    const linked=plan.state.records.find(item=>item.id===record.linkedId&&item.collection==='opportunities'&&item.linkedId===record.id);
                    if (!linked)
                        throw new HttpError(422, "conversion_incomplete", "Lead conversion must create or link its opportunity atomically");
                    if (!conversion.rowCount)
                        await client.query('INSERT INTO crm_lead_conversions(lead_id,opportunity_id,actor_id) VALUES($1,$2,$3)',[record.id,linked.id,actor.id]);
                }
                if (record.requestId && record.collection !== "quotes")
                    await syncWorkspaceRequest(client,record,previous,actor);
                await enqueueCrmAutomationEvent(client,actor,previous,record);
            }
        }
        else {
            await client.query('UPDATE workspace_entities SET deleted_at=now(),updated_by=$3,updated_at=now(),revision_number=revision_number+1 WHERE bucket=$1 AND id=$2',[change.bucket,change.id,actor.id]);
            await client.query("UPDATE workspace_publish_jobs SET status='cancelled',finished_at=now() WHERE document_bucket=$1 AND document_id=$2 AND status='pending'",[change.bucket,change.id]);
        }
        await appendAudit(client,actor,change.action,change.bucket,change.id,change.activity,{before:change.before?checksum(change.before):null,after:change.after?checksum(change.after):null});
        if (change.before && (isOfficialSource)(change.bucket, change.before) && (!change.after || rowStatus(change.after) === "archived" && rowStatus(change.before) !== "archived"))
            await appendAudit(client, actor, sourceVisibilityAction, change.bucket, change.id);
    }
    for (const targetId of new Set([...crm.merges, ...crm.unmerges].map(operation => operation.targetId))) {
        const before = plan.original.records.find(row => row.id === targetId), after = plan.state.records.find(row => row.id === targetId);
        if (before && after) {
            const { syncCrmMergedProfile } = await import("./workspace-domain-core");
            await syncCrmMergedProfile(client, actor, before, after);
        }
    }
    if (domainCommand)
        await domainCommand.afterPersist(client, plan.state.records);
    return bumpVersion(client,plan.settingsChanged?plan.state.settings:undefined);
}
async function applyCrmDomainRecords(client: PoolClient, actor: Actor, records: WorkspaceRecord[], action: string, afterPersist: DomainWrite['afterPersist']) {
    const meta = await lockWorkspace(client);
    actor = await (loadCrmAccess)(actor, client);
    (assertWorkspaceActor)(actor);
    const original = await readWorkspace(client, meta), proposed = structuredClone((projectForActor)(original, actor));
    for (const record of records) {
        const next = (redactCrmRecord)(actor, record), index = proposed.records.findIndex(row => row.id === record.id);
        if (index >= 0)
            proposed.records[index] = next;
        else
            proposed.records.push(next);
    }
    const plan = (planWorkspaceMutation)(original, proposed, actor), version = await persistPlan(client, actor, plan, void 0, [], { afterPersist });
    await (audit)(actor.id, action, "crm-domain", records[0]?.id || "workspace", { recordIds: records.map(record => record.id) }, client);
    return { state: (projectForActor)(await readWorkspace(client, { ...meta, settings: plan.state.settings }), actor), version };
}
async function applySharedBlockPages(client: PoolClient, actor: Actor, pages: PageDraft[], leaseTokens: string[] = []) {
    const meta = await lockWorkspace(client);
    actor = await (loadCrmAccess)(actor, client);
    (assertWorkspaceActor)(actor);
    const original = await readWorkspace(client, meta), proposed = structuredClone((projectForActor)(original, actor));
    for (const page of pages) {
        const index = proposed.pages.findIndex(row => row.id === page.id);
        if (index >= 0)
            proposed.pages[index] = page;
        else
            proposed.pages.push(page);
    }
    const plan = (planWorkspaceMutation)(original, proposed, actor), version = await persistPlan(client, actor, plan, void 0, leaseTokens, void 0, true);
    return { state: (projectForActor)(await readWorkspace(client, { ...meta, settings: plan.state.settings }), actor), version };
}
/** Editorial commands share the ordinary write policy, leases, revision
 * history and publication guards. This helper grants no structural bypass. */
export async function applyEditorialDraft(client:PoolClient,actor:Actor,bucket:'records'|'pages',draft:WorkspaceRecord|PageDraft,lang:Locale,leaseTokens:string[]=[]){
    const meta=await lockWorkspace(client);
    actor=await loadCrmAccess(actor,client);assertWorkspaceActor(actor);
    if(draft.status!=='draft'||(bucket==='records'? !('collection'in draft&&isContent(draft)): 'collection'in draft||draft.locale!==lang))throw new HttpError(422,'EDITORIAL_DRAFT','This command accepts an editorial draft in the selected language only.');
    const original=await readWorkspace(client,meta),proposed=structuredClone(projectForActor(original,actor));
    if(bucket==='records'){
        const index=proposed.records.findIndex(row=>row.id===draft.id);
        if(index<0)throw new HttpError(404,'NOT_FOUND','The editable content was not found.');
        proposed.records[index]=draft as WorkspaceRecord;
    }else{
        const index=proposed.pages.findIndex(row=>row.id===draft.id);
        if(index<0)throw new HttpError(404,'NOT_FOUND','The editable content was not found.');
        proposed.pages[index]=draft as PageDraft;
    }
    const plan=planWorkspaceMutation(original,proposed,actor),version=await persistPlan(client,actor,plan,lang,leaseTokens);
    return{state:projectForActor(await readWorkspace(client,{...meta,settings:plan.state.settings}),actor),version};
}
async function importCrmWorkspaceRecord(client: PoolClient, actor: Actor, record: WorkspaceRecord) {
    const meta = await lockWorkspace(client);
    actor = await (loadCrmAccess)(actor, client);
    (assertWorkspaceActor)(actor);
    (validateRecord)(record);
    if (!["leads", "contacts"].includes(record.collection) || !["new", "draft"].includes(record.status))
        throw new HttpError(422, "CRM_IMPORT_KIND", "Imports create initial leads or contacts only.");
    if (record.details?.crmDomain !== void 0 || record.details?.crmConversion !== void 0)
        throw new HttpError(403, "CRM_DOMAIN_COMMAND", "Imported records cannot claim a configured profile or conversion.");
    if ((await client.query("SELECT 1 FROM workspace_entities WHERE bucket='records' AND id=$1", [record.id])).rowCount)
        throw new HttpError(409, "CRM_IMPORT_EXISTS", "This import identifier already exists or was deleted.");
    const original = await readWorkspace(client, meta), proposed = structuredClone((projectForActor)(original, actor));
    proposed.records.push(record);
    const checked = (planWorkspaceMutation)(original, proposed, actor), accepted = checked.state.records.find(row => row.id === record.id)!;
    let next = accepted;
    let persistProfile: ((client:PoolClient)=>Promise<void>) | undefined;
    if (record.collection === "contacts") {
        const { prepareContact, persistContact, domainMarker } = await import("./workspace-domain-core");
        if (actor.crmAccess?.permissions.contact !== true)
            throw new HttpError(403, "CRM_CONTACT_REQUIRED", "Contact import requires the explicit contact-field permission.");
        const lang = actor.allowedLocales.find((item): item is Locale => (LOCALES as readonly string[]).includes(item));
        if (!lang)
            throw new HttpError(403, "LOCALE_SCOPE", "A current assigned language is required.");
        const { contactDefinitionSchema } = await import("./workspace-domain-schema");
        const parsed = contactDefinitionSchema.safeParse({ schemaVersion: 1, kind: "contact", givenName: "", familyName: "", displayName: accepted.title[lang], locale: lang, affiliations: [], endpoints: [...accepted.email ? [{ channel: "email", value: accepted.email, label: "Imported email", active: true }] : [], ...accepted.details?.phone ? [{ channel: "phone", value: accepted.details.phone, label: "Imported phone", active: true }] : []] });
        if (!parsed.success)
            throw new HttpError(422, "CRM_IMPORT_PROFILE", "The imported contact needs a valid display name and email endpoint.");
        const value = await prepareContact(client, actor, record.id, parsed.data);
        next = domainMarker(accepted, "contact");
        persistProfile = connection => persistContact(connection, record.id, value);
    }
    const result = await applyCrmDomainRecords(client, actor, [next], "crm.import.created", async (connection) => {
        if (persistProfile)
            await persistProfile(connection);
        if (record.collection === "leads")
            await connection.query("INSERT INTO crm_lead_origins(origin_type,origin_id,lead_id) VALUES('manual-import',$1,$1)", [record.id]);
    });
    return result.state.records.find(row => row.id === record.id)!;
}
async function getWorkspace(actor:Actor) {
  assertWorkspaceActor(actor);return transaction(async client=>{const meta=await readMeta(client);actor=await loadCrmAccess(actor,client);assertWorkspaceActor(actor);const state=await readWorkspace(client,meta);return {state:projectForActor(state,actor),version:Number(meta.version)};});
}
async function saveWorkspace(actor:Actor, input:unknown, leaseTokens: string[] = []) {
    assertWorkspaceActor(actor);
    assertObject(input,'body');
    keys(input,['state','expectedVersion','locale'],'body');
    if (input.locale !== void 0)
        locale(input.locale);
    const commandLocale=input.locale as string|undefined;
    return (transaction)(async (client) => {
        const meta=await lockWorkspace(client);
        actor = await loadCrmAccess(actor,client);
        assertWorkspaceActor(actor);
        expected(input.expectedVersion,Number(meta.version));
        const original=await readWorkspace(client,meta);
        const plan=planWorkspaceMutation(original,input.state,actor);
        if (!plan.changes.length && !plan.settingsChanged)
            return { state: projectForActor(original,actor), version: Number(meta.version) };
        const version = await persistPlan(client, actor, plan, commandLocale, leaseTokens);
        return { state: projectForActor(await readWorkspace(client,{...meta,settings:plan.state.settings}),actor), version };
    });
}
async function getWorkspaceRecordForActor(actor:Actor,recordId:string,client?:PoolClient):Promise<WorkspaceRecord> {
  assertWorkspaceActor(actor);id(recordId);
  if(!client)return transaction(async connection=>{await readMeta(connection);return getWorkspaceRecordForActor(actor,recordId,connection);});
  actor=await loadCrmAccess(actor,client);assertWorkspaceActor(actor);
  const result=client?await client.query<{data:WorkspaceRecord}>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL",[recordId]):await query<{data:WorkspaceRecord}>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL",[recordId]);
  if(!result.rows[0]||!readableRecord(actor,result.rows[0].data))throw new HttpError(404,'not_found','Record not found');
  const data=result.rows[0].data;
  if(actor.role==='scientificReviewer'&&data.collection==='tickets') {const minimal:WorkspaceState={version:1,records:[data],pages:[],forms:[],media:[],aiJobs:[],audit:[],settings:{name:'Ideal Makoo',apiUrl:'',defaultLocale:'fa',compact:false,email:''}};return projectForActor(minimal,actor).records[0];}
  return redactCrmRecord(actor,data);
}
async function assignWorkspaceRecord(actor:Actor,input:unknown) {
    assertWorkspaceActor(actor);
    assertObject(input,'assignment');
    keys(input,['id','ownerId','assigneeId','teamId','territoryId','expectedVersion'],'assignment');
    id(input.id);
    const fields=['ownerId','assigneeId','teamId','territoryId'] as const;
    if (!fields.some(field=>Object.hasOwn(input,field)))
        throw new HttpError(422, "validation", "Select an assignment change");
    for (const field of fields)
        if (input[field] !== void 0 && input[field] !== null)
            id(input[field],field);
    return (transaction)(async (client) => {
        const meta=await lockWorkspace(client);
        actor = await loadCrmAccess(actor,client);
        assertWorkspaceActor(actor);
        expected(input.expectedVersion,Number(meta.version));
        const original=(await client.query<{data:WorkspaceRecord}>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL FOR UPDATE",[input.id])).rows[0]?.data;
        if (!original || !readableRecord(actor,original))
            throw new HttpError(404, "not_found", "Record not found");
        if (!isScopedCrmRecord(original) || !hasWorkspacePermission(actor,'assign',original.collection) || !actor.crmAccess?.permissions.assign)
            throw new HttpError(403, "CRM_ASSIGNMENT_FORBIDDEN", "Assignment is not permitted for this account");
        const updated={...original};
        for (const field of fields)
            if (Object.hasOwn(input,field)) {
                if (input[field])
                    updated[field] = input[field] as string;
                else
                    delete updated[field];
            }
        if (Object.hasOwn(input,'assigneeId') && (!original.requestId || original.id !== original.requestId))
            throw new HttpError(422, "CRM_REQUEST_ASSIGNEE", "Only the originating request record has a request handler");
        for (const [field,table,allowed] of [["teamId", "crm_teams", actor.crmAccess.teamIds], ["territoryId", "crm_territories", actor.crmAccess.territoryIds]] as const) {
            if (updated[field]) {
                const group=await client.query(`SELECT id FROM ${table} WHERE id=$1 AND active FOR SHARE`,[updated[field]]);
                if (!group.rowCount)
                    throw new HttpError(422, "CRM_GROUP_INACTIVE", "Select an active scope group");
                if (actor.crmAccess.scope !== "all" && !allowed.includes(updated[field]!))
                    throw new HttpError(403, "CRM_SCOPE_FORBIDDEN", "The selected scope is outside your membership");
            }
            else if (original[field] && actor.crmAccess.scope !== "all")
                throw new HttpError(403, "CRM_SCOPE_FORBIDDEN", "Only an account with global scope may remove an existing boundary");
        }
        for (const field of ["ownerId", "assigneeId"] as const)
            if (updated[field]) {
                const user=(await client.query<{id:string;name:string;email:string;role:Actor['role'];quality_scope:boolean;allowed_locales:string[]}>('SELECT id,name,email,role,quality_scope,allowed_locales FROM users WHERE id=$1 AND active AND mfa_enabled',[updated[field]])).rows[0];
                if (!user || user.role === "customer")
                    throw new HttpError(422, "CRM_STAFF_REQUIRED", "Assignments require active staff with MFA");
                const target=await loadCrmAccess({id:user.id,name:user.name,email:user.email,role:user.role,qualityScope:user.quality_scope,allowedLocales:user.allowed_locales,mfaVerified:true},client);
                if (field === "ownerId" || !updated.ownerId && field === "assigneeId")
                    updated.owner = target.role;
                if (!readableRecord(target,updated))
                    throw new HttpError(422, "CRM_ASSIGNEE_SCOPE", "The selected staff member cannot access this record within its scope");
            }
        if (!updated.ownerId && !updated.assigneeId && !updated.requestId && actor.crmAccess.scope !== "all")
            throw new HttpError(422, "CRM_OWNER_REQUIRED", "An operator-created record needs an owner");
        if (fields.every(field=>original[field]===updated[field]))
            return { state: projectForActor(await readWorkspace(client,meta),actor), version: Number(meta.version) };
        const event=serverActivity(actor,'assigned',updated.id);
        updated.history = [...updated.history, event];
        updated.updatedAt = now();
        await writeEntity(client,'records',updated,actor);
        if (original.requestId && original.id === original.requestId && ['assigneeId','teamId','territoryId'].some(field=>Object.hasOwn(input,field)))
            await client.query("UPDATE requests SET assignee_id=$2,team_id=$3,territory_id=$4,version=version+1,data=jsonb_set(data,'{version}',to_jsonb(version+1)),sla=sla||jsonb_build_object('assignedAt',COALESCE(sla->>'assignedAt',CASE WHEN $2::text IS NOT NULL THEN $5::text END),'lastAssignedAt',CASE WHEN $2::text IS DISTINCT FROM assignee_id THEN CASE WHEN $2::text IS NOT NULL THEN $5::text END ELSE sla->>'lastAssignedAt' END),updated_at=now() WHERE id=$1", [original.requestId, updated.assigneeId || null, updated.teamId || null, updated.territoryId || null, now()]);
        await appendAudit(client,actor,'assigned','records',updated.id,event,{before:Object.fromEntries(fields.map(field=>[field,original[field]||null])),after:Object.fromEntries(fields.map(field=>[field,updated[field]||null]))});
        await enqueueCrmAutomationEvent(client,actor,original,updated);
        const version=await bumpVersion(client);
        return { state: projectForActor(await readWorkspace(client,meta),actor), version };
    });
}
async function transferStaffWorkspaceRecord(client: PoolClient, actor: Actor, recordId: string, sourceUserId: string, target: Actor) {
    actor = await (loadCrmAccess)(actor, client);
    target = await (loadCrmAccess)(target, client);
    if (!actor.mfaVerified || !["admin", "superAdmin"].includes(actor.role) || !actor.crmAccess?.permissions.assign)
        throw new HttpError(403, "FORBIDDEN", "Staff handover requires administrative assignment permission");
    const original = (await client.query("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL FOR UPDATE", [recordId])).rows[0]?.data;
    if (!original || !(readableRecord)(actor, original))
        throw new HttpError(404, "not_found", "Record not found");
    if (original.ownerId !== sourceUserId && original.assigneeId !== sourceUserId)
        throw new HttpError(409, "HANDOVER_CHANGED", "This responsibility changed after the handover was prepared");
    const updated = { ...original };
    if (updated.ownerId === sourceUserId) {
        updated.ownerId = target.id;
        updated.owner = target.role;
    }
    if (updated.assigneeId === sourceUserId) {
        updated.assigneeId = target.id;
        if (!updated.ownerId)
            updated.owner = target.role;
    }
    if (!target.mfaVerified || target.role === "customer" || !(readableRecord)(target, updated))
        throw new HttpError(422, "HANDOVER_RECIPIENT_SCOPE", "The recipient cannot access the resulting record");
    if (updated.assigneeId === target.id && updated.requestId === updated.id) {
        const request = (await client.query("SELECT kind,quality_quarantined,assignee_id,team_id,territory_id FROM requests WHERE id=$1 FOR UPDATE", [updated.id])).rows[0];
        if (!request || request.assignee_id !== sourceUserId)
            throw new HttpError(409, "HANDOVER_CHANGED", "The authoritative request handler changed");
        if (!(canAccessCrmRequest)(target, { id: updated.id, kind: request.kind, qualityQuarantined: request.quality_quarantined, assigneeId: target.id, teamId: request.team_id, territoryId: request.territory_id }))
            throw new HttpError(422, "HANDOVER_RECIPIENT_SCOPE", "The recipient cannot handle this request");
        await client.query("UPDATE requests SET assignee_id=$2,version=version+1,data=jsonb_set(data,'{version}',to_jsonb(version+1)),sla=sla||jsonb_build_object('lastAssignedAt',$3::text),updated_at=now() WHERE id=$1", [updated.id, target.id, now()]);
    }
    const activity = (serverActivity)(actor, "staff_handover", updated.id);
    updated.history = [...updated.history, activity];
    updated.updatedAt = now();
    await writeEntity(client, "records", updated, actor);
    await appendAudit(client, actor, "staff_handover", "records", updated.id, activity, { sourceUserId, targetUserId: target.id, ownerTransferred: original.ownerId === sourceUserId, assigneeTransferred: original.assigneeId === sourceUserId });
    await (enqueueCrmAutomationEvent)(client, actor, original, updated);
}
async function reviewWorkspaceContent(actor:Actor,input:unknown) {
    assertWorkspaceActor(actor);
    assertObject(input,'body');
    keys(input,['bucket','id','locale','expectedVersion'],'body');
    id(input.id);
    locale(input.locale);
    if (!['records','pages'].includes(String(input.bucket)))
        throw new HttpError(422, "validation", "Invalid content bucket");
    const bucket=input.bucket as 'records'|'pages', lang=input.locale;
    return (transaction)(async (client) => {
        const meta=await lockWorkspace(client);
        actor = await loadCrmAccess(actor,client);
        assertWorkspaceActor(actor);
        expected(input.expectedVersion,Number(meta.version));
        const result=await client.query<{data:WorkspaceRecord|PageDraft}>('SELECT data FROM workspace_entities WHERE bucket=$1 AND id=$2 AND deleted_at IS NULL',[bucket,input.id]);
        const source=result.rows[0]?.data;
        if (!source || "collection" in source && !readableRecord(actor,source))
            throw new HttpError(404, "not_found", "Content not found");
        if (!['review','approved','published','scheduled'].includes(source.status) || !canReviewSource(actor,source,lang) || !("collection" in source) && source.locale !== lang)
            throw new HttpError(403, "forbidden", "An independent authorized reviewer must review the selected locale");
        if (!("collection" in source))
            { await (validateSharedPagePublication)(client, actor, source); await (await import('./editor-workflows')).assertPageFormReferences(client,source,undefined,undefined,true); }
        if('collection' in source)publicNoticeForPublication(source,lang);
        const revision=await ensureRevision(client,bucket,source,lang);
        await client.query('INSERT INTO content_approvals(revision_id,approved_by,approved_role) VALUES($1,$2,$3) ON CONFLICT(revision_id) DO NOTHING',[revision.id,actor.id,actor.role]);
        if ("collection" in source && source.collection === "pricebooks")
            await (approvePricebook)(client, actor, source, revision);
        if ("collection" in source && source.collection === "quotes")
            await (approveCommercialQuote)(client, actor, source, revision, lang);
        const updated={...source,status:['published','scheduled'].includes(source.status)?source.status:'approved',approvedBy:actor.role,approvedById:actor.id,updatedAt:now()};
        await writeEntity(client,bucket,updated as WorkspaceRow,actor);
        await appendAudit(client,actor,'locale_approved',bucket,source.id,undefined,{locale:lang,revisionId:revision.id,checksum:revision.checksum});
        const version=await bumpVersion(client);
        return { state: projectForActor(await readWorkspace(client,meta),actor), version };
    });
}
async function scheduleWorkspaceContent(actor:Actor,input:unknown) {
    assertWorkspaceActor(actor);
    assertObject(input,'body');
    keys(input,['bucket','id','locale','scheduledAt','expectedVersion'],'body');
    id(input.id);
    locale(input.locale);
    string(input.scheduledAt,'scheduledAt',50,1);
    if (!['records','pages'].includes(String(input.bucket)) || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.scheduledAt) || !Number.isFinite(Date.parse(input.scheduledAt)) || Date.parse(input.scheduledAt) <= Date.now())
        throw new HttpError(422, "schedule_validation", "Select a content bucket and a future ISO timestamp");
    const bucket=input.bucket as 'records'|'pages', lang=input.locale, scheduledAt=new Date(input.scheduledAt).toISOString();
    return (transaction)(async (client) => {
        const meta=await lockWorkspace(client);
        actor = await loadCrmAccess(actor,client);
        assertWorkspaceActor(actor);
        expected(input.expectedVersion,Number(meta.version));
        const state=await readWorkspace(client,meta);
        const source=(state[bucket] as (WorkspaceRecord|PageDraft)[]).find(row=>row.id===input.id);
        if (!source || "collection" in source && !readableRecord(actor,source) || !("collection" in source) && source.locale !== lang)
            throw new HttpError(404, "not_found", "Content not found");
        const module2 = "collection" in source ? source.collection : "pages";
        if(!('collection'in source))assertSitePageMutation(actor,source);
        if (!(hasWorkspacePermission)(actor, "publish", module2, lang))
            throw new HttpError(403, "forbidden", "Scheduling this content locale is not allowed");
        if (!['approved','published','scheduled'].includes(source.status))
            throw new HttpError(409, "approval_required", "Approve this revision before scheduling");
        if (!("collection" in source))
            { await (validateSharedPagePublication)(client, actor, source); await (await import('./editor-workflows')).assertPageFormReferences(client,source,undefined,undefined,true); }
        const revision=await approvedRevision(client,bucket,source,lang), publication=publicationForSource(source,lang);
        if (!publication.title.trim() || !publication.summary.trim())
            throw new HttpError(422, "validation", "Title and summary are required in the scheduled language");
        await client.query("UPDATE workspace_publish_jobs SET status='cancelled',finished_at=now() WHERE document_bucket=$1 AND document_id=$2 AND locale=$3 AND status='pending'",[bucket,source.id,lang]);
        await client.query('INSERT INTO workspace_publish_jobs(id,document_bucket,document_id,locale,revision_id,publication,requested_by,requested_role,due_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[randomUUID(),bucket,source.id,lang,revision.id,JSON.stringify(publication),actor.id,actor.role,scheduledAt]);
        await writeEntity(client,bucket,{...source,status:'scheduled',scheduledAt,updatedAt:now()},actor);
        await appendAudit(client,actor,'scheduled',bucket,source.id,undefined,{locale:lang,revisionId:revision.id,scheduledAt});
        const version=await bumpVersion(client);
        return { state: projectForActor(await readWorkspace(client,meta),actor), version };
    });
}
async function cancelWorkspaceSchedule(actor:Actor,input:unknown) {
  assertWorkspaceActor(actor);assertObject(input,'body');keys(input,['bucket','id','locale','expectedVersion'],'body');id(input.id);locale(input.locale);if(!['records','pages'].includes(String(input.bucket)))throw new HttpError(422,'validation','Invalid content bucket');
  const bucket=input.bucket as 'records'|'pages',lang=input.locale;
  return transaction(async client=>{
    const meta=await lockWorkspace(client);actor=await loadCrmAccess(actor,client);assertWorkspaceActor(actor);expected(input.expectedVersion,Number(meta.version));const state=await readWorkspace(client,meta);const source=(state[bucket] as (WorkspaceRecord|PageDraft)[]).find(row=>row.id===input.id);
    if(!source||'collection'in source&&!readableRecord(actor,source)||!('collection'in source)&&source.locale!==lang)throw new HttpError(404,'not_found','Content not found');
    if(!('collection'in source))assertSitePageMutation(actor,source);
    if(!hasWorkspacePermission(actor,'publish','collection'in source?source.collection:'pages',lang))throw new HttpError(403,'forbidden','Cancelling this locale schedule is not allowed');
    const cancelled=await client.query("UPDATE workspace_publish_jobs SET status='cancelled',finished_at=now() WHERE document_bucket=$1 AND document_id=$2 AND locale=$3 AND status='pending' RETURNING id",[bucket,source.id,lang]);
    if(!cancelled.rowCount)return {state:projectForActor(state,actor),version:Number(meta.version)};
    if(source.status==='scheduled') {
      const pending=await client.query<{due_at:Date}>("SELECT due_at FROM workspace_publish_jobs WHERE document_bucket=$1 AND document_id=$2 AND status='pending' ORDER BY due_at LIMIT 1",[bucket,source.id]);
      const active=await client.query('SELECT locale FROM locale_releases WHERE document_bucket=$1 AND document_id=$2 AND unpublished_at IS NULL',[bucket,source.id]);
      await writeEntity(client,bucket,{...source,status:pending.rowCount?'scheduled':active.rowCount?'published':'approved',scheduledAt:pending.rows[0]?.due_at.toISOString(),updatedAt:now()},actor);
    }
    await appendAudit(client,actor,'schedule_cancelled',bucket,source.id,undefined,{locale:lang});const version=await bumpVersion(client);return {state:projectForActor(await readWorkspace(client,meta),actor),version};
  });
}
async function listWorkspaceSchedules(actor:Actor) {
  assertWorkspaceActor(actor);
  return transaction(async client=>{
    const meta=await readMeta(client);actor=await loadCrmAccess(actor,client);const state=projectForActor(await readWorkspace(client,meta),actor);
    const visible=new Set([...state.records.filter(isContent).map(row=>`records:${row.id}`),...state.pages.map(row=>`pages:${row.id}`)]);
    const rows=await client.query<{id:string;document_bucket:'records'|'pages';document_id:string;locale:string;due_at:Date;status:string;error:string|null;finished_at:Date|null}>("SELECT id,document_bucket,document_id,locale,due_at,status,error,finished_at FROM workspace_publish_jobs ORDER BY created_at DESC,id DESC LIMIT 1000");
    return {items:rows.rows.filter(row=>visible.has(`${row.document_bucket}:${row.document_id}`)&&actor.allowedLocales.includes(row.locale)).map(row=>({id:row.id,bucket:row.document_bucket,documentId:row.document_id,locale:row.locale,scheduledAt:row.due_at.toISOString(),status:row.status,error:row.error,finishedAt:row.finished_at?.toISOString()||null})),version:Number(meta.version)};
  });
}
function publicationForSource(source:WorkspaceRecord|PageDraft,lang:string):LocalPublication {
    locale(lang);
    if (!("collection" in source)) {
        if (source.locale !== lang)
            throw new HttpError(422, "validation", "Page locale does not match");
        validateBlocks(source.blocks);
        if (source.blocks.some(block=>block.formId&&!parseFormSchema(block.formSchema)))
            throw new HttpError(409, "form_review_required", "Embedded forms must be included in the reviewed revision");
        return { id: source.id, slug: source.slug, kind: "page", locale: lang, title: source.title, summary: source.summary, body: source.blocks.filter(block=>!block.hidden).map(block=>`${block.title}\n${block.body}`).join('\n\n'), blocks: source.blocks, taxonomy:{category:source.taxonomy?.category?.trim()||'page',tags:[...(source.taxonomy?.tags||[])]}, publishedAt: now(), version: source.version };
    }
    if (!isContent(source))
        throw new HttpError(403, "forbidden", "Private operational records cannot be published");
    const customProduct=parseCustomProduct(source.details?.customProduct);
    const product=customProduct||products.find(item=>item.id===(source.product||source.id));
    const article=articles.find(item=>item.id===source.id);
    const productRelease=source.collection==='products'&&product?parseProductRelease(source.details?.productReviewDraft,product):null;
    if (source.collection === "products" && (!product || source.details?.customProduct !== void 0 && !customProduct))
        throw new HttpError(409, "product_schema_required", "A product needs a valid catalog identity and typed product schema");
    if (source.collection === "products" && (source.details?.productDraft || customProduct) && !productRelease)
        throw new HttpError(409, "product_review_required", "The product needs a valid reviewed technical snapshot");
    const slug=source.collection==='products'?productRelease?.slug||product?.slug||source.id:source.collection==='research'?article?.slug||source.id:source.collection==='pages'?source.tags[0]||source.id.toLowerCase():source.id.toLowerCase();
    const publication:LocalPublication={id:source.id,slug,kind:source.collection==='products'?'product':source.collection==='pages'?'page':source.collection,locale:lang,title:source.title[lang],summary:source.summary[lang],body:source.summary[lang],blocks:[],publishedAt:now(),version:1};
    publication.taxonomy={category:typeof source.details?.category==='string'&&source.details.category.trim()?source.details.category.trim().slice(0,120):product?.family||source.collection,tags:(source.tags||[]).filter(tag=>typeof tag==='string').slice(0,20).map(tag=>tag.slice(0,80))};
    const editorial=source.details?.editorialContent as {body?:Record<string,string>;seo?:EditorialSeoByLocale;mediaId?:string;mediaUrl?:string;mediaType?:string;mediaTitle?:string}|undefined;
    if (editorial) {
        const body=editorial.body?.[lang]||source.summary[lang];
        publication.body = body;
        if (body !== source.summary[lang] && body.trim())
            publication.blocks.push({id:`${source.id}-body`,type:'rich-text',title:'',body});
        if (editorial.mediaUrl && editorial.mediaType)
            publication.blocks.push({id:`${source.id}-media`,type:editorial.mediaType==='document'?'downloads':editorial.mediaType,title:editorial.mediaTitle||source.title[lang],body:'',...(editorial.mediaType==='document'?{link:editorial.mediaUrl}:{mediaUrl:editorial.mediaUrl})});
        validateBlocks(publication.blocks);
        if (editorial.seo !== void 0) {
            const metadata = (parseEditorialSeoByLocale)(editorial.seo)?.[lang];
            if (!metadata && editorial.seo[lang])
                throw new HttpError(422, "editorial_metadata", "Invalid editorial metadata");
            if (metadata) {
                const issues = (editorialSeoIssues)(metadata, { collection: source.collection, mediaType: editorial.mediaType, mediaUrl: editorial.mediaUrl, eventStart: source.eventStart, eventEnd: source.eventEnd, location: source.location });
                if (issues.length)
                    throw new HttpError(422, "editorial_metadata", issues.join("; "));
                publication.seo = metadata;
            }
        }
    }
    const publicNotice=publicNoticeForPublication(source,lang);
    if(publicNotice)publication.publicNotice=publicNotice;
    const glossary=glossaryForPublication(source,lang);
    if(glossary)publication.glossary=glossary;
    if (source.collection === "events")
        Object.assign(publication,{eventStart:source.eventStart,eventEnd:source.eventEnd,location:source.location});
    if (productRelease)
        publication.productRelease = productRelease;
    if (customProduct)
        publication.customProduct = customProduct;
    return publication;
}
async function validatePublicationAssets(client:PoolClient,publication:unknown) {
    const { assetReferences } = await import("../lib/asset-references");
    const references = assetReferences(publication);
    if (references.some(reference => reference.private))
        throw new HttpError(409, "private_asset", "Private request attachments cannot be included in a public release");
    const assetIds = new Set(references.map(reference => reference.id));
    if (!assetIds.size)
        return;
    const assets=await client.query<{id:string;visibility:string;scan_status:string;deleted_at:Date|null;metadata:{rights?:boolean}}>('SELECT id,visibility,scan_status,deleted_at,metadata FROM assets WHERE id=ANY($1::text[]) FOR SHARE',[[...assetIds]]);
    for (const assetId of assetIds) {
        const asset=assets.rows.find(row=>row.id===assetId);
        if (!asset || asset.deleted_at || asset.visibility !== "public" || asset.scan_status !== "clean" || asset.metadata.rights !== true || !await (assetUsageAllowed)(assetId, client))
            throw new HttpError(409, "asset_not_publishable", "Every uploaded public asset needs a successful scan and current declared publication rights.");
    }
}
async function release(client:PoolClient,bucket:'records'|'pages',source:WorkspaceRecord|PageDraft,lang:string,actor:Actor,revision:Revision) {
    if(!('collection'in source))assertSitePageMutation(actor,source);
    if (!("collection" in source))
        { await (validateSharedPagePublication)(client, actor, source); await (await import('./editor-workflows')).assertPageFormReferences(client,source,undefined,undefined,true); }
    const publication=publicationForSource(source,lang);
    await validatePublicationAssets(client,publication);
    if (!publication.title.trim() || !publication.summary.trim())
        throw new HttpError(422, "validation", "Title and summary are required in the published language");
    const previous=await client.query<{release_number:string}>('SELECT release_number FROM locale_releases WHERE document_bucket=$1 AND document_id=$2 AND locale=$3 FOR UPDATE',[bucket,source.id,lang]);
    publication.version = Number(previous.rows[0]?.release_number||0) + 1;
    publication.publishedAt = now();
    await client.query(`INSERT INTO locale_releases(document_bucket,document_id,locale,kind,slug,active_revision_id,publication,published_by,release_number) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
    ON CONFLICT(document_bucket,document_id,locale) DO UPDATE SET kind=excluded.kind,slug=excluded.slug,active_revision_id=excluded.active_revision_id,publication=excluded.publication,published_by=excluded.published_by,published_at=now(),release_number=excluded.release_number,lock_version=locale_releases.lock_version+1,unpublished_at=NULL`,[bucket,source.id,lang,publication.kind,publication.slug,revision.id,JSON.stringify(publication),actor.id,publication.version]);
    const updated='collection' in source?{...source,status:'published',publishedLocales:[...new Set([...(source.publishedLocales||[]),lang as typeof LOCALES[number]])],updatedAt:now()}:{...source,status:'published' as const,updatedAt:now()};
    await writeEntity(client,bucket,updated,actor);
    await (enqueuePublicationNotificationEvent)(client, publication, revision.id, bucket);
    await appendAudit(client,actor,'published',bucket,source.id,undefined,{locale:lang,revisionId:revision.id,checksum:revision.checksum,releaseNumber:publication.version});
    return publication;
}
async function publishWorkspace(actor:Actor,input:unknown) {
    assertWorkspaceActor(actor);
    assertObject(input,'body');
    keys(input,['publication','expectedVersion'],'body');
    safeJson(input.publication);
    assertObject(input.publication,'publication');
    const requested=input.publication;
    id(requested.id);
    locale(requested.locale);
    string(requested.kind,'kind',30);
    const lang=requested.locale;
    return (transaction)(async (client) => {
        const meta=await lockWorkspace(client);
        actor = await loadCrmAccess(actor,client);
        assertWorkspaceActor(actor);
        expected(input.expectedVersion,Number(meta.version));
        const state=await readWorkspace(client,meta);
        const page=requested.kind==='page'?state.pages.find(item=>item.id===requested.id&&item.locale===lang):undefined;
        const source=page||state.records.find(item=>item.id===requested.id);
        if (!source)
            throw new HttpError(404, "not_found", "Content not found");
        const bucket=page?'pages':'records';
        const section=page?'pages':(source as WorkspaceRecord).collection;
        if(!('collection'in source))assertSitePageMutation(actor,source);
        if (!hasWorkspacePermission(actor,'publish',section,lang) || "collection" in source && !readableRecord(actor,source))
            throw new HttpError(403, "forbidden", "Publication is not allowed");
        if (!['approved','published'].includes(source.status))
            throw new HttpError(409, "approval_required", "Approve this revision before publishing");
        const canonical=publicationForSource(source,lang);
        for (const field of ["id", "slug", "kind", "locale", "title", "summary", "body", "blocks", "productRelease", "customProduct", "eventStart", "eventEnd", "location", "seo", "glossary", "publicNotice"] as const)
            if (Object.hasOwn(requested,field) && !equal(requested[field],canonical[field]))
                throw new HttpError(409, "revision_conflict", "The publication preview differs from the approved server revision");
        const revision=await approvedRevision(client,bucket,source,lang);
        await release(client,bucket,source,lang,actor,revision);
        const version=await bumpVersion(client);
        return { state: projectForActor(await readWorkspace(client,meta),actor), version };
    });
}
async function unpublishWorkspace(actor:Actor,input:unknown) {
    assertWorkspaceActor(actor);
    assertObject(input,'body');
    keys(input,['slug','locale','kind','expectedVersion'],'body');
    string(input.slug,'slug',240,1);
    locale(input.locale);
    string(input.kind,'kind',30,1);
    const lang=input.locale;
    return (transaction)(async (client) => {
        const meta=await lockWorkspace(client);
        actor = await loadCrmAccess(actor,client);
        assertWorkspaceActor(actor);
        expected(input.expectedVersion,Number(meta.version));
        const result=await client.query<{document_bucket:'records'|'pages';document_id:string}>('SELECT document_bucket,document_id FROM locale_releases WHERE slug=$1 AND locale=$2 AND kind=$3 AND unpublished_at IS NULL FOR UPDATE',[input.slug,input.locale,input.kind]);
        if (!result.rows[0])
            return { state: projectForActor(await readWorkspace(client,meta),actor), version: Number(meta.version) };
        const row=result.rows[0];
        const sourceResult=await client.query<{data:WorkspaceRecord|PageDraft}>('SELECT data FROM workspace_entities WHERE bucket=$1 AND id=$2',[row.document_bucket,row.document_id]);
        const source=sourceResult.rows[0].data;
        const section='collection' in source?source.collection:'pages';
        if(!('collection'in source))assertSitePageMutation(actor,source);
        if (!hasWorkspacePermission(actor,'publish',section,lang))
            throw new HttpError(403, "forbidden", "Publication is not allowed");
        await client.query('UPDATE locale_releases SET unpublished_at=now(),lock_version=lock_version+1 WHERE document_bucket=$1 AND document_id=$2 AND locale=$3',[row.document_bucket,row.document_id,input.locale]);
        await client.query("UPDATE workspace_publish_jobs SET status='cancelled',finished_at=now() WHERE document_bucket=$1 AND document_id=$2 AND locale=$3 AND status='pending'",[row.document_bucket,row.document_id,input.locale]);
        const updated: WorkspaceRecord | PageDraft = "collection" in source ? { ...source, publishedLocales: source.publishedLocales?.filter(lang2 => lang2 !== input.locale), status: source.publishedLocales?.filter(lang2 => lang2 !== input.locale).length ? "published" : "approved" } : { ...source, status: "approved" };
        await writeEntity(client,row.document_bucket,updated,actor);
        await appendAudit(client,actor,'unpublished',row.document_bucket,row.document_id,undefined,{locale:input.locale});
        const version=await bumpVersion(client);
        return { state: projectForActor(await readWorkspace(client,meta),actor), version };
    });
}
async function getPublicSite(connection?: PoolClient) {
    const read = async (client: PoolClient) => {
        const meta=await readMeta(client);
        const releases = await client.query<{publication:LocalPublication}>("SELECT r.publication FROM locale_releases r JOIN workspace_entities e ON e.bucket=r.document_bucket AND e.id=r.document_id WHERE r.unpublished_at IS NULL AND e.deleted_at IS NULL AND e.status<>'archived' ORDER BY r.published_at DESC,r.document_id,r.locale");
        const observedAt=Date.now();
        const publications=releases.rows.map(row=>row.publication).filter(publication=>publicNoticePublicationVisible(publication,observedAt)), forms=new Map<string,PublicFormSchema>();
        for (const publication of publications)
            for (const block of publication.blocks) {
                const form=parseFormSchema(block.formSchema);
                if (form && !block.hidden && !forms.has(`${form.id}:${form.version}`))
                    forms.set(`${form.id}:${form.version}`,form);
            }
        const hidden=await client.query<{id:string;product:string|null}>("SELECT id,data->>'product' AS product FROM workspace_entities WHERE bucket='records' AND collection='products' AND (deleted_at IS NOT NULL OR status='archived')");
        const hiddenProducts=[...new Set(hidden.rows.flatMap(row=>[row.id,...(row.product?[row.product]:[])]))];
        const withdrawn=await client.query<{id:string;product:string|null;locale:string}>("SELECT e.id,e.data->>'product' AS product,r.locale FROM locale_releases r JOIN workspace_entities e ON e.bucket=r.document_bucket AND e.id=r.document_id WHERE r.kind='product' AND r.unpublished_at IS NOT NULL");
        const hiddenProductLocales:Record<string,string[]>=Object.create(null);
        for (const row of withdrawn.rows)
            for (const productId of new Set([row.id, ...row.product ? [row.product] : []]))
                (hiddenProductLocales[productId]??=[]).push(row.locale);
        const { hiddenProductLocales: sourceHiddenProducts, ...visibility } = await (getSourcePublicVisibility)(client);
        for (const [id2, locales] of Object.entries(sourceHiddenProducts))
            hiddenProductLocales[id2] = [...new Set([...hiddenProductLocales[id2] || [], ...locales])];
        return { observedAt:new Date(observedAt).toISOString(),publications, forms: [...forms.values()], preferences: meta.preferences_published || defaultSitePreferences(), content: publications, hiddenProducts, hiddenProductLocales: { ...hiddenProductLocales }, ...visibility, version: Number(meta.version) };
    };
    return connection ? read(connection) : (transaction)(read);
}
async function getPublishedWorkspaceForm(formId:string,version?:number,client?:PoolClient,lang?:string):Promise<PublicFormSchema|null> {
  if(!client)return transaction(async connection=>{await readMeta(connection);return getPublishedWorkspaceForm(formId,version,connection,lang);});
  const publications=await client.query<{publication:LocalPublication}>('SELECT publication FROM locale_releases WHERE unpublished_at IS NULL AND ($1::text IS NULL OR locale=$1) ORDER BY published_at DESC,document_id,locale',[lang||null]);
  for(const {publication}of publications.rows)for(const block of publication.blocks){const form=parseFormSchema(block.formSchema);if(form&&!block.hidden&&form.id===formId&&(version===undefined||form.version===version))return form;}
  return null;
}
async function getSitePreferences(actor:Actor) {
    assertWorkspaceActor(actor);
    if (!canWorkspace(actor.role,'view','menus') && !canWorkspace(actor.role,'view','settings'))
        throw new HttpError(403, "forbidden", "Preferences are not allowed");
    return (transaction)(async (client) => {
        const meta=await readMeta(client);
        actor = await (loadCrmAccess)(actor, client);
        assertWorkspaceActor(actor);
        if (!canWorkspace(actor.role,'view','menus') && !canWorkspace(actor.role,'view','settings'))
            throw new HttpError(403, "forbidden", "Preferences are not allowed");
        return { draft: meta.preferences_draft, published: meta.preferences_published || defaultSitePreferences(), version: Number(meta.version) };
    });
}
async function saveSitePreferences(actor:Actor,input:unknown) {
    assertWorkspaceActor(actor);
    assertObject(input,'body');
    keys(input,['value','mode','publish','expectedVersion'],'body');
    if (!['menus','settings','all'].includes(String(input.mode)) || typeof input.publish !== "boolean")
        throw new HttpError(422, "validation", "Invalid preference command");
    const mode=input.mode as SitePreferenceMode;
    const allowedMenus=hasWorkspacePermission(actor,input.publish?'publish':'edit','menus'), allowedSettings=hasWorkspacePermission(actor,'manage','settings');
    if (mode === "menus" && !allowedMenus || mode === "settings" && !allowedSettings || mode === "all" && (!allowedMenus || !allowedSettings))
        throw new HttpError(403, "forbidden", "This preference section is not allowed");
    return (transaction)(async (client) => {
        const meta=await lockWorkspace(client);
        actor = await loadCrmAccess(actor,client);
        assertWorkspaceActor(actor);
        const currentMenus = hasWorkspacePermission(actor,input.publish?'publish':'edit','menus'), currentSettings = hasWorkspacePermission(actor,'manage','settings');
        if (mode === "menus" && !currentMenus || mode === "settings" && !currentSettings || mode === "all" && (!currentMenus || !currentSettings))
            throw new HttpError(403, "forbidden", "This preference section is not allowed");
        if(LOCALES.some(locale=>!actor.allowedLocales.includes(locale)))throw new HttpError(403,'forbidden','Site identity, addresses and menu structure require authority for all site languages');
        expected(input.expectedVersion,Number(meta.version));
        const dynamic=await client.query<{slug:string}>("SELECT DISTINCT slug FROM locale_releases WHERE kind='page' AND unpublished_at IS NULL");
        validateServerPreferences(input.value,new Set(dynamic.rows.map(row=>row.slug==='home'?'':row.slug)));
        const current=withPreferenceExtensions(meta.preferences_published||defaultSitePreferences());
        const draftBase=meta.preferences_draft?withPreferenceExtensions(meta.preferences_draft,current):current;
        const base=input.publish?current:draftBase;
        const value=withPreferenceExtensions(input.value,base);
        const next={...(mode==='menus'?{...base,navigation:value.navigation,footer:value.footer}:mode==='settings'?{...base,brand:value.brand,contact:value.contact,footerDetails:value.footerDetails,uiText:value.uiText,seo:value.seo}:value),updatedAt:now()};
        if (input.publish)
            await validatePublicationAssets(client,next);
        await client.query(input.publish?'UPDATE workspace_meta SET preferences_published=$1::jsonb,preferences_draft=$1::jsonb WHERE singleton=true':'UPDATE workspace_meta SET preferences_draft=$1::jsonb WHERE singleton=true',[JSON.stringify(next)]);
        await appendAudit(client,actor,input.publish?'preferences_published':'preferences_saved','preferences',mode,undefined,{before:checksum(base),after:checksum(next)});
        const version=await bumpVersion(client);
        return { draft: next, published: input.publish ? next : current, version };
    });
}
async function getWorkspaceRevisions(actor:Actor,input:{bucket:'records'|'pages';id:string;locale:string}) {
  assertWorkspaceActor(actor);id(input.id);locale(input.locale);if(!['records','pages'].includes(input.bucket))throw new HttpError(422,'validation','Invalid content bucket');
  if(input.bucket==='pages')return (await import('./page-lifecycle')).getWorkspacePageRevisions(actor,input.id,input.locale);
  return transaction(async client=>{const meta=await lockWorkspace(client);actor=await loadCrmAccess(actor,client);assertWorkspaceActor(actor);const state=await readWorkspace(client,meta);const source=(state[input.bucket] as (WorkspaceRecord|PageDraft)[]).find(row=>row.id===input.id);if(!source||'collection' in source&&!readableRecord(actor,source)||!('collection' in source)&&!canWorkspace(actor.role,'view','pages'))throw new HttpError(404,'not_found','Content not found');const result=await client.query('SELECT r.id,r.document_id,r.locale,r.revision_number,r.checksum,r.created_by,r.created_at,a.approved_by,a.approved_at FROM content_revisions r LEFT JOIN content_approvals a ON a.revision_id=r.id WHERE document_bucket=$1 AND document_id=$2 AND locale=$3 ORDER BY revision_number DESC LIMIT 100',[input.bucket,input.id,input.locale]);return {revisions:result.rows,version:Number(meta.version)};});
}
async function restoreWorkspaceRevision(actor:Actor, input:unknown, leaseTokens: string[] = []) {
    assertWorkspaceActor(actor);
    assertObject(input,'body');
    keys(input,['revisionId','expectedVersion','expectedUpdatedAt'],'body');
    string(input.expectedUpdatedAt,'expectedUpdatedAt',50,1);
    if(!Number.isFinite(Date.parse(input.expectedUpdatedAt)))throw new HttpError(422,'validation','Invalid captured source timestamp');
    string(input.revisionId,'revisionId',36,36);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.revisionId))
        throw new HttpError(422, "validation", "Invalid revision identifier");
    return (transaction)(async (client) => {
        const meta=await lockWorkspace(client);
        actor = await loadCrmAccess(actor,client);
        assertWorkspaceActor(actor);
        expected(input.expectedVersion,Number(meta.version));
        const row=await client.query<Revision&{document_bucket:'records'|'pages';document_id:string;locale:string}>('SELECT * FROM content_revisions WHERE id=$1',[input.revisionId]);
        const revision=row.rows[0];
        if (!revision || !['records','pages'].includes(revision.document_bucket))
            throw new HttpError(404, "not_found", "Revision not found");
        const state=await readWorkspace(client,meta), view=structuredClone(projectForActor(state,actor));
        const restored={...revision.snapshot,status:'draft',author:actor.role,authorId:actor.id,approvedBy:undefined,approvedById:undefined,scheduledAt:undefined};
        const current=(view[revision.document_bucket] as (WorkspaceRecord|PageDraft)[]).find(item=>item.id===revision.document_id);
        if (!current)
            throw new HttpError(404, "not_found", "Content not found");
        if(current.updatedAt!==input.expectedUpdatedAt)throw new HttpError(409,"SOURCE_CHANGED","The source changed after the restore was selected; reload and review it before restoring.");
        if ("collection" in restored && "collection" in current) {
            if (!(equal)((redactCrmRecord)(actor, restored), restored))
                throw new HttpError(403, "CRM_FIELD_FORBIDDEN", "Restoring this revision requires access to every protected field in it.");
            Object.assign(restored, { history: current.history, publishedLocales: current.publishedLocales, createdAt: current.createdAt, quoteResponse: current.quoteResponse, owner: current.owner, ownerId: current.ownerId, assigneeId: current.assigneeId, teamId: current.teamId, territoryId: current.territoryId });
        }
        (view[revision.document_bucket] as (WorkspaceRecord|PageDraft)[]).splice((view[revision.document_bucket] as (WorkspaceRecord|PageDraft)[]).indexOf(current),1,restored as WorkspaceRecord|PageDraft);
        const plan=planWorkspaceMutation(state,view,actor);
        const version = await persistPlan(client, actor, plan, void 0, leaseTokens, void 0, true);
        await appendAudit(client,actor,'revision_restored',revision.document_bucket,revision.document_id,undefined,{revisionId:revision.id});
        return { state: projectForActor(await readWorkspace(client,meta),actor), version };
    });
}
async function upsertRequestInWorkspace(client:PoolClient, request:FrontRequest&{qualityQuarantined?:boolean}, options: {bumpVersion?:boolean} = {}) {
    await lockWorkspace(client);
    const existing=await client.query<{data:WorkspaceRecord}>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL",[request.id]);
    const old=existing.rows[0]?.data;
    if (!old)
        await (routeNewWorkspaceRequest)(client, request);
    const assignment=(await client.query<{assignee_id:string|null;team_id:string|null;territory_id:string|null}>('SELECT assignee_id,team_id,territory_id FROM requests WHERE id=$1',[request.id])).rows[0];
    const collection=/sample/i.test(request.kind)?'samples':/support|ticket|quality|complaint/i.test(request.kind)?'tickets':/career|job|talent|^hr$/i.test(request.kind)?'hr':/partner|cooperat|distribut|invest|outsourc|suppl/i.test(request.kind)?'partners':/rfq|inquiry/i.test(request.kind)?'leads':'inbox';
    const activity:WorkspaceActivity={id:`request-${request.id}`,actor:'customer',at:request.createdAt,visibility:'public',text:recordText(request.message)};
    const history=[...(old?.history||[activity])];
    for (const message of request.messages || [])
        if (!history.some(event=>event.id===message.id))
            history.push({id:message.id,at:message.createdAt,actor:message.sender,visibility:message.visibility,text:recordText(message.body)});
    const publicStatuses:Record<string,string>={received:'new',in_review:'working',waiting_customer:'waiting',responded:'responded',resolved:'resolved',closed:'closed',withdrawn:'withdrawn'};
    const protectedStage=old&&['converted','won','lost','archived'].includes(old.status);
    const stage=old&&request.status===old.details?.publicRequestStatus||protectedStage?old!.status:publicStatuses[request.status]||request.status;
    const sampleStage = collection === "samples" ? (await client.query("SELECT status FROM crm_sample_cases WHERE sample_id=$1", [request.id])).rows[0]?.status : void 0;
    const record:WorkspaceRecord={...(old||{}),id:request.id,collection,title:old?.title||recordText(request.name||request.organization||request.id),summary:old?.summary||recordText(request.message||''),status:request.status==='withdrawn'?'withdrawn':stage,owner:old?.owner||(collection==='tickets'?'support':collection==='hr'?'hr':'business'),createdAt:request.createdAt,updatedAt:now(),tags:[...new Set([...(old?.tags||[]),'website',request.kind,...(request.qualityQuarantined||/quality/i.test(request.kind)?['quality']:[])])],demo:false,organization:old?.organization??request.organization,email:old?.email??request.email,product:old?.product??request.productIds[0],requestId:request.id,history,priority:old?.priority||(request.qualityQuarantined?'high':'normal'),details:{...old?.details,qualityQuarantined:request.qualityQuarantined===true,publicRequestStatus:request.status}};
    if (sampleStage && old?.status !== "archived")
        record.status = sampleStage;
    if (assignment) {
        for (const [field,column] of [["assigneeId", "assignee_id"], ["teamId", "team_id"], ["territoryId", "territory_id"]] as const) {
            if (assignment[column])
                record[field] = assignment[column];
            else
                delete record[field];
        }
    }
    await writeEntity(client,'records',record,seedActor);
    if (collection === "leads")
        await client.query("INSERT INTO crm_lead_origins(origin_type,origin_id,lead_id) VALUES('request',$1,$1) ON CONFLICT(origin_type,origin_id) DO NOTHING", [request.id]);
    if (request.formId && request.formValues) {
        const result=await client.query<{data:WorkspaceState['forms'][number]}>("SELECT data FROM workspace_entities WHERE bucket='forms' AND id=$1 AND deleted_at IS NULL",[request.formId]);
        const form=result.rows[0]?.data;
        if (form && !form.responses.some(response=>response.id===request.id)) {
            form.responses.push({id:request.id,at:request.createdAt,values:request.formValues});
            await writeEntity(client,'forms',form,seedActor);
        }
    }
    const quotes=await client.query<{id:string;record_id:string;status:string;snapshot_hash:string;response:string|null;responded_at:Date|null}>('SELECT DISTINCT ON (record_id) id,record_id,status,snapshot_hash,response,responded_at FROM quote_snapshots WHERE request_id=$1 ORDER BY record_id,created_at DESC',[request.id]);
    for (const quote of quotes.rows) {
        const existing2 = await client.query<{data:WorkspaceRecord}>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND collection='quotes' AND deleted_at IS NULL",[quote.record_id]);
        const source = existing2.rows[0]?.data;
        if (!source)
            continue;
        const issued=source.details?.lastIssuedQuoteId!==quote.id;
        const updated={...source,status:issued&&source.status==='approved'?'proposal':source.status,details:{...source.details,lastIssuedQuoteId:quote.id,lastIssuedQuoteHash:quote.snapshot_hash},...(quote.responded_at?{quoteResponse:{status:quote.status,response:quote.response||'',at:quote.responded_at.toISOString()}}:{}),updatedAt:now()};
        await writeEntity(client,'records',updated,seedActor);
    }
    const eventActor:Actor={id:request.ownerId||'guest',name:request.name,email:request.email,role:'customer',qualityScope:false,allowedLocales:[request.locale||'fa'],mfaVerified:false};
    await enqueueCrmAutomationEvent(client,eventActor,old,record);
    if (options.bumpVersion !== false)
        await bumpVersion(client);
}
async function syncWorkspaceRequest(client:PoolClient,record:WorkspaceRecord,before:WorkspaceRecord|undefined,actor:Actor) {
    if (!record.requestId)
        return;
    const existing = await client.query("SELECT data,owner_id,assignee_id,team_id,territory_id,kind,quality_quarantined,version,sla FROM requests WHERE id=$1 FOR UPDATE", [record.requestId]);
    if (!existing.rows[0])
        return;
    const row=existing.rows[0], request=row.data;
    const importedIds=new Set(((record.details?.crmMergeOperations||[]) as {importedActivityIds:string[]}[]).flatMap(operation=>operation.importedActivityIds||[]));
    const messages=(record.history||[]).filter(event=>event.visibility==='public'&&!before?.history.some(previous=>previous.id===event.id)&&!importedIds.has(event.id));
    const statuses:Record<string,string>={new:'received',working:'in_review',in_review:'in_review',waiting:'waiting_customer',waiting_customer:'waiting_customer',responded:'responded',resolved:'resolved',closed:'closed'};
    const status=statuses[record.status]||request.status;
    if (row.kind === "outsourcing_bid") {
        const { assertTenderRequestStatusChange } = await import("./tenders");
        await assertTenderRequestStatusChange(client, record.requestId, status, request.status);
    }
    if (messages.length || status !== request.status) {
        const allowed = (canAccessCrmRequest)(actor, { id: record.requestId, kind: row.kind, qualityQuarantined: row.quality_quarantined, assigneeId: row.assignee_id, teamId: row.team_id, territoryId: row.territory_id });
        if (!allowed || !(["edit", "reply"] as const).some(action => (canWorkspace)(actor.role, action, (crmRequestCollection)(row.kind))))
            throw new HttpError(403, "CRM_REQUEST_SCOPE", "Updating the linked request requires its current handler scope. Opportunity ownership does not grant request access.");
    }
    for (const message of messages) {
        const body=message.text[(request.locale||'fa') as typeof LOCALES[number]]||message.text.fa;
        if (!body.trim() || body.length > 4e3)
            throw new HttpError(422, "message_length", "Public replies must contain 1 to 4000 characters");
        await client.query('INSERT INTO request_messages(id,request_id,body,visibility,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',[message.id,record.requestId,body,'public',actor.id,message.at]);
    }
    const updated={...request,status,version:row.version+1};
    let sla={...row.sla};
    if (status === "waiting_customer" && request.status !== "waiting_customer")
        sla.pausedAt = now();
    if (request.status === "waiting_customer" && status !== "waiting_customer")
        sla = await (resumeRequestBusinessSla)(client, sla);
    if (messages.length && !sla.firstRespondedAt)
        sla.firstRespondedAt = now();
    if (status !== request.status || messages.length) {
        await client.query("UPDATE requests SET data=$2::jsonb,version=version+1,updated_at=now(),sla=$3::jsonb WHERE id=$1",[record.requestId,JSON.stringify(updated),JSON.stringify(sla)]);
        if (row.owner_id)
            await (enqueueAccountNotification)(client, { userId: row.owner_id, topic: "requests", channel: "in-app", purpose: "transactional", title: "\u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u062F\u0631\u062E\u0648\u0627\u0633\u062A / Request updated", body: record.requestId, href: `/${request.locale || "fa"}/account/requests/?id=${record.requestId}`, requestId: record.requestId }, `request-updated:${record.requestId}:${updated.version}`);
    }
    record.details = { ...record.details, publicRequestStatus: status };
    await client.query("UPDATE workspace_entities SET data=jsonb_set(data,'{details,publicRequestStatus}',to_jsonb($2::text)) WHERE bucket='records' AND id=$1",[record.id,status]);
}
async function runScheduledWorkspacePublications(limit=20) {
    return (transaction)(async (client) => {
        await lockWorkspace(client);
        const jobs=await client.query<{id:string;document_bucket:'records'|'pages';document_id:string;locale:string;revision_id:string;requested_by:string;requested_role:Actor['role']}>("SELECT * FROM workspace_publish_jobs WHERE status='pending' AND due_at<=now() ORDER BY due_at,id FOR UPDATE SKIP LOCKED LIMIT $1",[Math.max(1,Math.min(100,limit))]);
        let published=0;
        for (const job of jobs.rows) {
            await client.query('SAVEPOINT publish_job');
            try {
                const account=await client.query<{id:string;name:string;email:string;role:Actor['role'];active:boolean;quality_scope:boolean;allowed_locales:string[];mfa_enabled:boolean}>('SELECT id,name,email,role,active,quality_scope,allowed_locales,mfa_enabled FROM users WHERE id=$1',[job.requested_by]);
                const user=account.rows[0];
                if (!user?.active || !user.mfa_enabled)
                    throw new Error("Publisher account or MFA is inactive");
                const actor:Actor={id:user.id,name:user.name,email:user.email,role:user.role,qualityScope:user.quality_scope,allowedLocales:user.allowed_locales,mfaVerified:true};
                const result=await client.query<{data:WorkspaceRecord|PageDraft}>('SELECT data FROM workspace_entities WHERE bucket=$1 AND id=$2 AND deleted_at IS NULL',[job.document_bucket,job.document_id]);
                const source=result.rows[0]?.data;
                if (!source || !['scheduled','published'].includes(source.status))
                    throw new Error("Scheduled source is no longer eligible");
                const module2 = "collection" in source ? source.collection : "pages";
                if (!(hasWorkspacePermission)(actor, "publish", module2, job.locale))
                    throw new Error("Publisher permission has been revoked");
                const revision=await approvedRevision(client,job.document_bucket,source,job.locale);
                if (revision.id !== job.revision_id)
                    throw new Error("Scheduled revision changed");
                await release(client,job.document_bucket,source,job.locale,actor,revision);
                await client.query("UPDATE workspace_publish_jobs SET status='published',finished_at=now() WHERE id=$1",[job.id]);
                published++;
                await client.query('RELEASE SAVEPOINT publish_job');
            }
            catch (error) {
                await client.query('ROLLBACK TO SAVEPOINT publish_job');
                await client.query("UPDATE workspace_publish_jobs SET status='failed',error=$2,finished_at=now() WHERE id=$1",[job.id,error instanceof Error?(error as NodeJS.ErrnoException).message.slice(0,500):'Publication failed']);
            }
        }
        if (published)
            await bumpVersion(client);
        return { processed: jobs.rowCount || 0, published };
    });
}
export { readWorkspace, writeEntity, bumpVersion, appendAudit, installSourceGlossaryDrafts, installSourcePageDrafts, applyCrmDomainRecords, applySharedBlockPages, assertWorkspaceRecordApproved, assignWorkspaceRecord, cancelWorkspaceSchedule, createProductionWorkspaceSeed, ensureRevision, getPublicSite, getPublishedWorkspaceForm, getSitePreferences, getWorkspace, getWorkspaceRecordForActor, getWorkspaceRevisions, importCrmWorkspaceRecord, listWorkspaceSchedules, lockWorkspace, publicationForSource, publishWorkspace, restoreWorkspaceRevision, reviewWorkspaceContent, runScheduledWorkspacePublications, saveSitePreferences, saveWorkspace, scheduleWorkspaceContent, syncWorkspaceRequest, transferStaffWorkspaceRecord, unpublishWorkspace, upsertRequestInWorkspace };
