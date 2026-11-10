import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {PageDraft} from '../data/workspace-seed';
import type {Locale} from '../lib/i18n';
import type {EditorRevision} from '../types/editor-workflows';
import type {ManagedWorkspacePage,PageDirectory} from '../types/page-lifecycle';
import {transaction} from './db';
import {parse} from './http';
import {assert,type Actor} from './types';
import {id as validateId,validatePage} from './workspace-validation';
import {assertWorkspaceActor,checksum,editableSnapshot,hasWorkspacePermission,projectForActor,serverActivity} from './workspace-policy';
import {loadCrmAccess} from './workspace-scopes';
import {appendAudit,bumpVersion,ensureRevision,lockWorkspace,readWorkspace,writeEntity} from './workspace';
import {assertContentLeaseWrites} from './content-collaboration';
import {isOfficialSource,sourceVisibilityAction} from './workspace-public-visibility';
import {assertSitePageMutation} from './page-authority';
import {canManageSitePage} from '../lib/page-authority';

const locale=z.enum(['fa','en','tr','ar','ru']);
const positive=z.number().int().positive();
const lifecycle=z.object({operation:z.enum(['archive','delete','restore']),reason:z.string().trim().min(8).max(500),expectedVersion:positive,expectedPageVersion:positive,expectedUpdatedAt:z.string().datetime({offset:true})}).strict();
interface PageRow {data:PageDraft;deleted_at:Date|null}
interface RevisionRow {id:string;document_id:string;locale:Locale;revision_number:string|number;checksum:string;created_by:string;created_at:Date;approved_by:string|null;approved_at:Date|null}

async function currentActor(client:PoolClient,actor:Actor){const current=await loadCrmAccess(actor,client);assertWorkspaceActor(current);return current;}
function readable(actor:Actor,row:PageRow){return hasWorkspacePermission(actor,'view','pages',row.data.locale)&&(!row.deleted_at||hasWorkspacePermission(actor,'archive','pages',row.data.locale));}
async function pageRow(client:PoolClient,actor:Actor,id:string){
 const row=(await client.query<PageRow>("SELECT data,deleted_at FROM workspace_entities WHERE bucket='pages' AND id=$1",[id])).rows[0];
 assert(row&&readable(actor,row),404,'NOT_FOUND','Page not found.');return row;
}
async function pageDto(client:PoolClient,actor:Actor,row:PageRow):Promise<ManagedWorkspacePage>{
 const page=row.data,status=row.deleted_at?'deleted':page.status==='archived'?'archived':'active';
 const live=(await client.query<{locale:Locale}>("SELECT locale FROM locale_releases WHERE document_bucket='pages' AND document_id=$1 AND unpublished_at IS NULL ORDER BY locale",[page.id])).rows.map(item=>item.locale);
 const scheduled=(await client.query<{locale:Locale}>("SELECT locale FROM workspace_publish_jobs WHERE document_bucket='pages' AND document_id=$1 AND status='pending' ORDER BY locale",[page.id])).rows.map(item=>item.locale);
 const policyAllowed=canManageSitePage(actor.role,page.slug);
 const archive=policyAllowed&&hasWorkspacePermission(actor,'archive','pages',page.locale),edit=policyAllowed&&hasWorkspacePermission(actor,'edit','pages',page.locale);
 const withdrawalAllowed=policyAllowed&&[...new Set([...live,...scheduled])].every(lang=>hasWorkspacePermission(actor,'publish','pages',lang));
 return{page,status,capabilities:{edit:status==='active'&&edit,archive:status==='active'&&archive&&withdrawalAllowed,delete:status!=='deleted'&&archive&&withdrawalAllowed,restore:status!=='active'&&archive&&edit,history:true},publication:{liveLocales:live,scheduledLocales:scheduled,requiresPublisher:!withdrawalAllowed}};
}
export async function listWorkspacePages(actor:Actor,input:unknown={}):Promise<PageDirectory>{
 const params=parse(z.object({locale:locale.optional(),status:z.enum(['all','active','archived','deleted']).default('all'),cursor:z.string().min(1).max(160).optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict(),input);
 if(params.cursor)validateId(params.cursor);
 return transaction(async client=>{
  const meta=await lockWorkspace(client);actor=await currentActor(client,actor);
  assert(hasWorkspacePermission(actor,'view','pages'),403,'FORBIDDEN','You cannot view pages.');
  if(params.locale)assert(actor.allowedLocales.includes(params.locale),403,'LOCALE_SCOPE','This language is outside your content scope.');
  const rows=(await client.query<PageRow>(`SELECT data,deleted_at FROM workspace_entities WHERE bucket='pages' AND id>coalesce($1,'') AND locale=ANY($2::text[]) AND ($3::text IS NULL OR locale=$3)
   AND ($4='all' OR $4='deleted' AND deleted_at IS NOT NULL OR $4='archived' AND deleted_at IS NULL AND status='archived' OR $4='active' AND deleted_at IS NULL AND status<>'archived')
   AND (deleted_at IS NULL OR $5) ORDER BY id LIMIT $6`,[params.cursor||null,actor.allowedLocales,params.locale||null,params.status,hasWorkspacePermission(actor,'archive','pages'),params.limit+1])).rows;
  const items:ManagedWorkspacePage[]=[];for(const row of rows.slice(0,params.limit))items.push(await pageDto(client,actor,row));
  return{items,version:Number(meta.version),nextCursor:rows.length>params.limit?rows[params.limit-1].data.id:null};
 });
}
export async function getWorkspacePage(actor:Actor,id:string){validateId(id);return transaction(async client=>{const meta=await lockWorkspace(client);actor=await currentActor(client,actor);return{item:await pageDto(client,actor,await pageRow(client,actor,id)),version:Number(meta.version)};});}

/** A retained source is restored to a fresh, unapproved revision. Former
 * approvals and released snapshots remain immutable historical evidence. */
async function restoredRevision(client:PoolClient,page:PageDraft,actor:Actor){
 const previous=(await client.query<{id:string;revision_number:string|number}>("SELECT id,revision_number FROM content_revisions WHERE document_bucket='pages' AND document_id=$1 AND locale=$2 ORDER BY revision_number DESC LIMIT 1",[page.id,page.locale])).rows[0];
 await client.query("INSERT INTO content_revisions(id,document_bucket,document_id,locale,revision_number,base_revision_id,snapshot,checksum,created_by) VALUES($1,'pages',$2,$3,$4,$5,$6::jsonb,$7,$8)",[randomUUID(),page.id,page.locale,Number(previous?.revision_number||0)+1,previous?.id||null,JSON.stringify(page),checksum(editableSnapshot(page)),actor.id]);
}
export async function changeWorkspacePageLifecycle(actor:Actor,id:string,body:unknown,leaseTokens:string[]=[]){
 validateId(id);const input=parse(lifecycle,body);
 return transaction(async client=>{
  const meta=await lockWorkspace(client);actor=await currentActor(client,actor);
  assert(Number(meta.version)===input.expectedVersion,409,'SOURCE_CHANGED','The workspace changed. Reload the current page before confirming this action.');
  const row=await pageRow(client,actor,id),before=row.data;
  assertSitePageMutation(actor,before);
  assert(before.version===input.expectedPageVersion&&before.updatedAt===input.expectedUpdatedAt,409,'SOURCE_CHANGED','The page changed after this action was selected. Preserve your edits and explicitly reload it.');
  const view=await pageDto(client,actor,row);
  assert(hasWorkspacePermission(actor,'archive','pages',before.locale),403,'FORBIDDEN','Changing a page lifecycle requires the archive permission for its language.');
  if(input.operation==='restore'){
   assert(view.status!=='active',409,'PAGE_STATE','This page is already active.');
   assert(hasWorkspacePermission(actor,'edit','pages',before.locale),403,'FORBIDDEN','Restoring a page requires edit permission for its language.');
   const occupied=await client.query("SELECT 1 FROM workspace_entities WHERE bucket='pages' AND id<>$1 AND deleted_at IS NULL AND locale=$2 AND data->>'slug'=$3 UNION ALL SELECT 1 FROM locale_releases WHERE document_bucket='pages' AND document_id<>$1 AND locale=$2 AND slug=$3 LIMIT 1",[id,before.locale,before.slug]);
   assert(!occupied.rowCount,409,'PAGE_SLUG_IN_USE','A different retained page uses this language and path. Resolve that identity before restoring this page.');
  }else{
   assert(view.status!=='deleted'&&(input.operation!=='archive'||view.status==='active'),409,'PAGE_STATE','This page is already archived or deleted.');
   assert(!view.publication.requiresPublisher,403,'PAGE_WITHDRAW_PERMISSION','Withdrawing live or scheduled content requires publication permission for every affected language.');
  }
  const after:PageDraft={...before,status:input.operation==='restore'?'draft':'archived',version:before.version+1,updatedAt:new Date().toISOString(),approvedBy:undefined,approvedById:undefined,scheduledAt:undefined,...(input.operation==='restore'?{author:actor.role,authorId:actor.id}:{})};
  validatePage(after);
  await assertContentLeaseWrites(client,actor,[{bucket:'pages',id,before,after,action:'page.'+input.operation,activity:serverActivity(actor,'page.'+input.operation,id)}],leaseTokens);
  await ensureRevision(client,'pages',before,before.locale);
  if(input.operation!=='restore'){
   const withdrawn=await client.query<{locale:Locale}>("UPDATE locale_releases SET unpublished_at=now(),lock_version=lock_version+1 WHERE document_bucket='pages' AND document_id=$1 AND unpublished_at IS NULL RETURNING locale",[id]);
   await client.query("UPDATE workspace_publish_jobs SET status='cancelled',finished_at=now() WHERE document_bucket='pages' AND document_id=$1 AND status='pending'",[id]);
   for(const release of withdrawn.rows)await appendAudit(client,actor,'unpublished','pages',id,undefined,{locale:release.locale,reason:input.reason,operation:input.operation});
   if(isOfficialSource('pages',before))await appendAudit(client,actor,sourceVisibilityAction,'pages',id,undefined,{locale:before.locale,reason:input.reason,operation:input.operation});
  }
  // Neither a restored draft nor a retained historical source reactivates a
  // bearer preview. Its creator must explicitly issue a new preview later.
  await client.query("UPDATE content_previews SET revoked_at=now() WHERE document_bucket='pages' AND document_id=$1 AND revoked_at IS NULL",[id]);
  await writeEntity(client,'pages',after,actor);
  if(input.operation==='delete')await client.query("UPDATE workspace_entities SET deleted_at=now() WHERE bucket='pages' AND id=$1",[id]);
  if(input.operation==='restore')await restoredRevision(client,after,actor);
  await client.query("DELETE FROM content_edit_leases WHERE document_bucket='pages' AND document_id=$1",[id]);
  await appendAudit(client,actor,'page.'+input.operation,'pages',id,undefined,{reason:input.reason,locale:before.locale,fromVersion:before.version,toVersion:after.version,fromStatus:view.status,toStatus:input.operation==='restore'?'active':input.operation==='delete'?'deleted':'archived',withdrawnLocales:view.publication.liveLocales,cancelledLocales:view.publication.scheduledLocales});
  const version=await bumpVersion(client);return{state:projectForActor(await readWorkspace(client,meta),actor),version};
 });
}
export async function getWorkspacePageRevisions(actor:Actor,id:string,lang:string){
 validateId(id);const requested=parse(locale,lang);
 return transaction(async client=>{
  const meta=await lockWorkspace(client);actor=await currentActor(client,actor);const row=await pageRow(client,actor,id);
  assert(row.data.locale===requested,404,'NOT_FOUND','Page revision not found.');
  const rows=(await client.query<RevisionRow>("SELECT r.*,a.approved_by,a.approved_at FROM content_revisions r LEFT JOIN content_approvals a ON a.revision_id=r.id WHERE r.document_bucket='pages' AND r.document_id=$1 AND r.locale=$2 ORDER BY r.revision_number DESC LIMIT 100",[id,requested])).rows;
  const revisions:EditorRevision[]=rows.map(item=>({id:item.id,document_id:item.document_id,locale:item.locale,revision_number:Number(item.revision_number),checksum:item.checksum,created_by:item.created_by,created_at:item.created_at.toISOString(),approved_by:item.approved_by,approved_at:item.approved_at?.toISOString()||null}));
  return{revisions,version:Number(meta.version)};
 });
}
