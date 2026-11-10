import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {PageDraft,WorkspaceForm,WorkspaceRecord,WorkspaceState} from '../data/workspace-seed';
import type {Locale} from '../lib/i18n';
import type {EditorRevision,EditorRevisionBucket,EditorRevisionDetail,FormDirectory,FormUsage,ManagedWorkspaceForm,TranslationStatus,TranslationRevisionSource} from '../types/editor-workflows';
import {parseFormSchema} from '../lib/form-schema';
import {canWorkspace} from '../lib/auth';
import {transaction,audit} from './db';
import {assert,HttpError,type Actor} from './types';
import {parse} from './http';
import {LOCALES,validateForm} from './workspace-validation';
import {assertWorkspaceActor,checksum,equal,editableSnapshot,hasWorkspacePermission,isContent,projectForActor,readableRecord,recordReviewSnapshot,serverActivity} from './workspace-policy';
import {loadCrmAccess,redactCrmRecord} from './workspace-scopes';
import {lockWorkspace,readWorkspace,writeEntity,bumpVersion,appendAudit} from './workspace';
import {assertContentLeaseWrites} from './content-collaboration';

const entityId=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),revisionId=z.string().uuid(),locale=z.enum(['fa','en','tr','ar','ru']);
const contentTarget=z.object({bucket:z.enum(['records','pages']),id:z.string().min(1).max(160),locale,sourceLocale:locale});
const labels=z.object({fa:z.string().max(300),en:z.string().max(300),tr:z.string().max(300),ar:z.string().max(300),ru:z.string().max(300)}).strict();
const field=z.object({id:entityId,label:labels,type:z.enum(['text','email','textarea','select','date']),required:z.boolean(),options:z.array(z.string().min(1).max(300)).max(100).optional(),condition:entityId.optional()}).strict();
const formValue=z.object({title:labels,fields:z.array(field).max(50)}).strict();
const expected=z.number().int().positive();
type Source=WorkspaceRecord|PageDraft|WorkspaceForm;
interface Entity {data:Source;deleted_at:Date|null;updated_at:Date;created_by:string;updated_by:string}
interface RevisionRow {id:string;document_bucket:EditorRevisionBucket;document_id:string;locale:Locale;revision_number:string|number;checksum:string;created_by:string;created_at:Date;approved_by?:string|null;approved_at?:Date|null;snapshot:Source}
interface BindingRow {id:string;source_revision_id:string;target_revision_id:string;source_checksum:string;target_checksum:string;acknowledged_at:Date;acknowledged_by:string}
const iso=(date:Date|string)=>date instanceof Date?date.toISOString():date;
const checkVersion=(actual:number,value:number)=>assert(actual===value,409,'SOURCE_CHANGED','The saved source changed. Preserve your edits and explicitly reload the current version.');
async function actorNow(client:PoolClient,actor:Actor){const current=await loadCrmAccess(actor,client);assertWorkspaceActor(current);return current;}
function formData(row:Entity):WorkspaceForm {const form=row.data as WorkspaceForm;return{...form,status:form.status||'active',updatedAt:form.updatedAt||iso(row.updated_at)};}
function mayRead(actor:Actor,bucket:EditorRevisionBucket,source:Source){return bucket==='forms'?hasWorkspacePermission(actor,'view','forms'):bucket==='pages'?hasWorkspacePermission(actor,'view','pages',(source as PageDraft).locale):readableRecord(actor,source as WorkspaceRecord);}
async function sourceRow(client:PoolClient,actor:Actor,bucket:EditorRevisionBucket,id:string,deleted=false){
 const row=(await client.query<Entity>('SELECT data,deleted_at,updated_at,created_by,updated_by FROM workspace_entities WHERE bucket=$1 AND id=$2',[bucket,id])).rows[0];
 assert(row&&(!row.deleted_at||deleted&&(bucket==='forms'&&hasWorkspacePermission(actor,'archive','forms')||bucket==='pages'&&hasWorkspacePermission(actor,'archive','pages',(row.data as PageDraft).locale)))&&mayRead(actor,bucket,row.data),404,'NOT_FOUND','Content not found.');return row;
}
/** Schema revisions never contain collected answers, contact identities or a
 * guessed review. The current form version is captured only after real writes. */
export function formRevisionSnapshot(form:WorkspaceForm){const schema=parseFormSchema(form);assert(schema,422,'FORM_SCHEMA','Invalid form schema.');return{id:schema.id,title:schema.title,fields:schema.fields};}
/** A new page reference must name an active form and use an actual saved
 * schema. Existing pinned schemas and immutable saved history remain valid;
 * changing the authoring form never silently rewrites a reviewed page. */
export async function assertPageFormReferences(client:PoolClient,page:PageDraft,before?:PageDraft,forms?:WorkspaceForm[],persisted=false){
 for(const block of page.blocks){
  if(!block.formId)continue;
  const current=forms?forms.find(form=>form.id===block.formId):(await client.query<{data:WorkspaceForm}>("SELECT data FROM workspace_entities WHERE bucket='forms' AND id=$1 AND deleted_at IS NULL",[block.formId])).rows[0]?.data;
  assert(current&&current.status!=='archived',409,'FORM_UNAVAILABLE','Select an active form before saving or publishing this page.');
  if(!block.formSchema)continue;
  const schema=parseFormSchema(block.formSchema);assert(schema&&schema.id===block.formId,422,'FORM_SCHEMA','Invalid embedded form schema.');
  if(persisted||equal(schema,parseFormSchema(current))||before?.blocks.some(item=>item.formId===block.formId&&equal(parseFormSchema(item.formSchema),schema)))continue;
  const retained=await client.query("SELECT 1 FROM content_revisions r WHERE (r.document_bucket='forms' AND r.document_id=$1 AND r.snapshot->>'version'=$2 AND r.snapshot->'title'=$3::jsonb AND r.snapshot->'fields'=$4::jsonb) OR (r.document_bucket='pages' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(r.snapshot->'blocks','[]'::jsonb)) b WHERE b->'formSchema'=$5::jsonb)) LIMIT 1",[block.formId,String(schema.version),JSON.stringify(schema.title),JSON.stringify(schema.fields),JSON.stringify(schema)]);
  assert(retained.rowCount,409,'FORM_REVISION_REQUIRED','Use a saved form schema. A fabricated form revision cannot be attached to a page.');
 }
}
export async function ensureFormRevision(client:PoolClient,form:WorkspaceForm,actorId:string){
 const snapshot=formRevisionSnapshot(form),digest=checksum(snapshot);
 for(const lang of LOCALES){
  const last=(await client.query<{id:string;revision_number:string|number;checksum:string}>('SELECT id,revision_number,checksum FROM content_revisions WHERE document_bucket=$1 AND document_id=$2 AND locale=$3 ORDER BY revision_number DESC LIMIT 1',['forms',form.id,lang])).rows[0];
  if(last?.checksum===digest)continue;
  await client.query('INSERT INTO content_revisions(id,document_bucket,document_id,locale,revision_number,base_revision_id,snapshot,checksum,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',[randomUUID(),'forms',form.id,lang,Number(last?.revision_number||0)+1,last?.id||null,JSON.stringify({...snapshot,version:form.version,updatedAt:form.updatedAt,status:form.status||'active'}),digest,actorId]);
 }
}
/** Label-only edits may change assigned locales. Shared field structure changes
 * every language and therefore require the complete form-language grant. */
export function assertFormLanguageChanges(actor:Actor,before:WorkspaceForm|undefined,after:WorkspaceForm){
 const structural=(form:WorkspaceForm|undefined)=>(form?.fields||[]).map(({label:_label,...item})=>item);
 if(!equal(structural(before),structural(after)))assert(LOCALES.every(lang=>actor.allowedLocales.includes(lang)),403,'FORM_LOCALE_SCOPE','Changing shared form fields requires access to all five form languages.');
 for(const lang of LOCALES){const changed=(before?.title[lang]||'')!==after.title[lang]||after.fields.some(item=>(before?.fields.find(old=>old.id===item.id)?.label[lang]||'')!==item.label[lang]);if(changed)assert(actor.allowedLocales.includes(lang),403,'FORM_LOCALE_SCOPE','A form label is outside your assigned languages.');}
}
async function usages(client:PoolClient,actor:Actor,id:string):Promise<ManagedWorkspaceForm['usage']>{
 const pages=(await client.query<{data:PageDraft}>("SELECT data FROM workspace_entities WHERE bucket='pages' AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(data->'blocks') b WHERE b->>'formId'=$1 OR b->'formSchema'->>'id'=$1)",[id])).rows;
 const live=(await client.query<{publication:{id:string;title:string;locale:Locale}}>("SELECT publication FROM locale_releases WHERE unpublished_at IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(publication->'blocks','[]'::jsonb)) b WHERE b->>'formId'=$1 OR b->'formSchema'->>'id'=$1)",[id])).rows;
 const pending=(await client.query<{publication:{id:string;title:string;locale:Locale}}>("SELECT publication FROM workspace_publish_jobs WHERE status='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(publication->'blocks','[]'::jsonb)) b WHERE b->>'formId'=$1 OR b->'formSchema'->>'id'=$1)",[id])).rows;
 const allowed=(item:FormUsage)=>hasWorkspacePermission(actor,'view','pages',item.locale),unique=(items:FormUsage[])=>[...new Map(items.filter(allowed).map(item=>[item.id+':'+item.locale,item])).values()];
 return{drafts:unique(pages.map(({data})=>({id:data.id,title:data.title,locale:data.locale}))),published:unique(live.map(({publication})=>publication)),scheduled:unique(pending.map(({publication})=>publication)),blocked:!!(pages.length||live.length||pending.length)};
}
async function managedForm(client:PoolClient,actor:Actor,row:Entity):Promise<ManagedWorkspaceForm>{
 const form={...formData(row),responses:[]},status=row.deleted_at?'deleted':form.status||'active',usage=await usages(client,actor,form.id),archive=hasWorkspacePermission(actor,'archive','forms')&&LOCALES.every(lang=>actor.allowedLocales.includes(lang));
 return{form,status,capabilities:{edit:status==='active'&&hasWorkspacePermission(actor,'edit','forms'),archive:status==='active'&&archive&&!usage.blocked,delete:status==='archived'&&archive&&!usage.blocked,restore:status!=='active'&&archive,history:true},usage};
}
export async function listWorkspaceForms(actor:Actor,input:unknown={}):Promise<FormDirectory>{
 const params=parse(z.object({cursor:entityId.optional(),status:z.enum(['all','active','archived','deleted']).default('all'),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict(),input);
 return transaction(async client=>{const meta=await lockWorkspace(client);actor=await actorNow(client,actor);assert(hasWorkspacePermission(actor,'view','forms'),403,'FORBIDDEN','You cannot view forms.');
  const rows=(await client.query<Entity>("SELECT data,deleted_at,updated_at,created_by,updated_by FROM workspace_entities WHERE bucket='forms' AND id>coalesce($1,'') AND ($2='all' OR $2='deleted' AND deleted_at IS NOT NULL OR $2='active' AND deleted_at IS NULL AND status<>'archived' OR $2='archived' AND deleted_at IS NULL AND status='archived') AND (deleted_at IS NULL OR $3) ORDER BY id LIMIT $4",[params.cursor||null,params.status,hasWorkspacePermission(actor,'archive','forms'),params.limit+1])).rows;
  const items:ManagedWorkspaceForm[]=[];for(const row of rows.slice(0,params.limit))items.push(await managedForm(client,actor,row));
  return{items,version:Number(meta.version),canCreate:hasWorkspacePermission(actor,'create','forms')&&LOCALES.every(lang=>actor.allowedLocales.includes(lang)),nextCursor:rows.length>params.limit?rows[params.limit-1].data.id:null};
 });
}
export async function getWorkspaceForm(actor:Actor,id:string){parse(entityId,id);return transaction(async client=>{const meta=await lockWorkspace(client);actor=await actorNow(client,actor);return{item:await managedForm(client,actor,await sourceRow(client,actor,'forms',id,true)),version:Number(meta.version)};});}
export async function saveWorkspaceForm(actor:Actor,id:string|null,body:unknown,leaseTokens:string[]=[]){
 const input=parse(z.object({value:formValue,expectedVersion:expected,expectedFormVersion:expected.optional(),id:entityId.optional()}).strict(),body);const target=id?parse(entityId,id):input.id||'FORM-'+randomUUID();
 return transaction(async client=>{const meta=await lockWorkspace(client);actor=await actorNow(client,actor);checkVersion(Number(meta.version),input.expectedVersion);
  const row=id?await sourceRow(client,actor,'forms',target):undefined,before=row?formData(row):undefined;
  assert(hasWorkspacePermission(actor,before?'edit':'create','forms'),403,'FORBIDDEN','You cannot save this form.');
  if(before){assert(before.status==='active',409,'FORM_ARCHIVED','Restore the form before editing it.');assert(input.expectedFormVersion!==undefined,428,'FORM_VERSION_REQUIRED','Load this form before saving.');checkVersion(before.version,input.expectedFormVersion);}
  else assert(!(await client.query("SELECT 1 FROM workspace_entities WHERE bucket='forms' AND id=$1",[target])).rowCount,409,'FORM_IDENTITY','This form identifier already exists, including retained deleted forms.');
  const form:WorkspaceForm={id:target,...input.value,responses:before?.responses||[],version:(before?.version||0)+1,status:'active',updatedAt:new Date().toISOString()};validateForm(form);assertFormLanguageChanges(actor,before,form);
  if(before)await assertContentLeaseWrites(client,actor,[{bucket:'forms',id:target,before,after:form,action:'updated',activity:serverActivity(actor,'form.saved',target)}],leaseTokens);
  await writeEntity(client,'forms',form,actor);await appendAudit(client,actor,before?'form.saved':'form.created','forms',target,undefined,{fromVersion:before?.version||null,toVersion:form.version});const version=await bumpVersion(client);return{state:projectForActor(await readWorkspace(client,meta),actor),version};
 });
}
export async function changeWorkspaceFormLifecycle(actor:Actor,id:string,body:unknown,leaseTokens:string[]=[]){
 parse(entityId,id);const input=parse(z.object({operation:z.enum(['archive','delete','restore']),expectedVersion:expected,expectedFormVersion:expected,reason:z.string().trim().min(8).max(500)}).strict(),body);
 return transaction(async client=>{const meta=await lockWorkspace(client);actor=await actorNow(client,actor);checkVersion(Number(meta.version),input.expectedVersion);const row=await sourceRow(client,actor,'forms',id,true),before=formData(row);
  assert(hasWorkspacePermission(actor,'archive','forms')&&LOCALES.every(lang=>actor.allowedLocales.includes(lang)),403,'FORBIDDEN','Changing a shared form lifecycle requires the archive permission and all five language grants.');checkVersion(before.version,input.expectedFormVersion);
  if(input.operation==='restore')assert(row.deleted_at||before.status==='archived',409,'FORM_STATE','This form is already active.');
  else{assert(!row.deleted_at,409,'FORM_STATE','This form is already deleted.');assert(input.operation==='archive'?before.status==='active':before.status==='archived',409,'FORM_STATE','Archive a form before moving it to the recycle bin.');assert(!(await usages(client,actor,id)).blocked,409,'FORM_IN_USE','Detach this form from saved pages and withdraw or cancel releases that still use it.');}
  const after:WorkspaceForm={...before,status:input.operation==='restore'?'active':'archived',version:before.version+1,updatedAt:new Date().toISOString()};
  await assertContentLeaseWrites(client,actor,[{bucket:'forms',id,before,after,action:input.operation,activity:serverActivity(actor,'form.'+input.operation,id)}],leaseTokens);
  await writeEntity(client,'forms',after,actor);if(input.operation==='delete')await client.query("UPDATE workspace_entities SET deleted_at=now() WHERE bucket='forms' AND id=$1",[id]);
  await client.query("DELETE FROM content_edit_leases WHERE document_bucket='forms' AND document_id=$1",[id]);
  await appendAudit(client,actor,'form.'+input.operation,'forms',id,undefined,{reason:input.reason,fromVersion:before.version,toVersion:after.version});const version=await bumpVersion(client);return{state:projectForActor(await readWorkspace(client,meta),actor),version};
 });
}
function onlyLocale(value:unknown,lang:Locale):unknown {
 if(Array.isArray(value))return value.map(item=>onlyLocale(item,lang));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key,entry])=>entry!==undefined&&(!(LOCALES as readonly string[]).includes(key)||key===lang)).map(([key,entry])=>[key,onlyLocale(entry,lang)]));
 return value;
}
function editorialSnapshot(bucket:EditorRevisionBucket,source:Source,lang:Locale,actor?:Actor):Record<string,unknown>{
 const value=bucket==='forms'?formRevisionSnapshot(source as WorkspaceForm):bucket==='pages'?editableSnapshot(source as PageDraft):recordReviewSnapshot(actor?redactCrmRecord(actor,source as WorkspaceRecord):source as WorkspaceRecord);
 return onlyLocale(value,lang) as Record<string,unknown>;
}
const revisionDto=(row:RevisionRow):EditorRevision=>({id:row.id,document_id:row.document_id,locale:row.locale,revision_number:Number(row.revision_number),checksum:row.checksum,created_by:row.created_by,created_at:iso(row.created_at),approved_by:row.approved_by||null,approved_at:row.approved_at?iso(row.approved_at):null});
export async function getEditorRevisionDetail(actor:Actor,id:string):Promise<EditorRevisionDetail>{
 parse(revisionId,id);return transaction(async client=>{const meta=await lockWorkspace(client);actor=await actorNow(client,actor);const row=(await client.query<RevisionRow>('SELECT r.*,a.approved_by,a.approved_at FROM content_revisions r LEFT JOIN content_approvals a ON a.revision_id=r.id WHERE r.id=$1',[id])).rows[0];
  assert(row&&['records','pages','forms'].includes(row.document_bucket),404,'NOT_FOUND','Revision not found.');await sourceRow(client,actor,row.document_bucket,row.document_id,true);
  assert(mayRead(actor,row.document_bucket,row.snapshot),404,'NOT_FOUND','Revision not found.');assert(row.snapshot.id===row.document_id,409,'REVISION_IDENTITY','The saved document identity is invalid.');if(row.document_bucket==='pages')assert((row.snapshot as PageDraft).locale===row.locale,409,'REVISION_IDENTITY','The saved locale identity is invalid.');
  return{revision:revisionDto(row),bucket:row.document_bucket,snapshot:editorialSnapshot(row.document_bucket,row.snapshot,row.locale,actor),version:Number(meta.version)};
 });
}
export async function getFormRevisions(actor:Actor,id:string,lang:string){parse(entityId,id);parse(locale,lang);return transaction(async client=>{const meta=await lockWorkspace(client);actor=await actorNow(client,actor);await sourceRow(client,actor,'forms',id,true);const rows=(await client.query<RevisionRow>("SELECT r.* FROM content_revisions r WHERE document_bucket='forms' AND document_id=$1 AND locale=$2 ORDER BY revision_number DESC LIMIT 100",[id,lang])).rows;return{revisions:rows.map(revisionDto),version:Number(meta.version)};});}
export async function restoreWorkspaceFormRevision(actor:Actor,id:string,body:unknown,leaseTokens:string[]=[]){
 parse(entityId,id);const input=parse(z.object({revisionId,expectedVersion:expected,expectedFormVersion:expected}).strict(),body);
 return transaction(async client=>{const meta=await lockWorkspace(client);actor=await actorNow(client,actor);checkVersion(Number(meta.version),input.expectedVersion);const row=await sourceRow(client,actor,'forms',id),before=formData(row);checkVersion(before.version,input.expectedFormVersion);
  assert(before.status==='active'&&hasWorkspacePermission(actor,'edit','forms'),403,'FORBIDDEN','Restore an active editable form only.');const revision=(await client.query<RevisionRow>("SELECT * FROM content_revisions WHERE id=$1 AND document_bucket='forms' AND document_id=$2",[input.revisionId,id])).rows[0];assert(revision,404,'NOT_FOUND','Form revision not found.');
  const snapshot=revision.snapshot as WorkspaceForm,after:WorkspaceForm={...before,title:snapshot.title,fields:snapshot.fields,version:before.version+1,updatedAt:new Date().toISOString()};validateForm(after);assertFormLanguageChanges(actor,before,after);await assertContentLeaseWrites(client,actor,[{bucket:'forms',id,before,after,action:'restored',activity:serverActivity(actor,'form.revision-restored',id)}],leaseTokens);
  await writeEntity(client,'forms',after,actor);await appendAudit(client,actor,'form.revision-restored','forms',id,undefined,{revisionId:revision.id,fromVersion:before.version,toVersion:after.version});const version=await bumpVersion(client);return{state:projectForActor(await readWorkspace(client,meta),actor),version};
 });
}
async function revisionSource(client:PoolClient,bucket:'pages'|'records',source:WorkspaceRecord|PageDraft,lang:Locale):Promise<TranslationRevisionSource|null>{
 const latest=(await client.query<RevisionRow>('SELECT * FROM content_revisions WHERE document_bucket=$1 AND document_id=$2 AND locale=$3 ORDER BY revision_number DESC LIMIT 1',[bucket,source.id,lang])).rows[0];
 if(!latest||!equal(editorialSnapshot(bucket,latest.snapshot,lang),editorialSnapshot(bucket,source,lang)))return null;
 return{documentId:source.id,locale:lang,revisionId:latest.id,revisionNumber:Number(latest.revision_number),checksum:checksum(editorialSnapshot(bucket,source,lang)),title:'collection'in source?source.title[lang]:source.title,updatedAt:source.updatedAt};
}
async function translationStatus(client:PoolClient,actor:Actor,input:z.infer<typeof contentTarget>,version:number):Promise<TranslationStatus>{
 assert(input.locale!==input.sourceLocale,422,'TRANSLATION_LOCALE','Choose distinct source and target languages.');const row=await sourceRow(client,actor,input.bucket,input.id),target=row.data as WorkspaceRecord|PageDraft;
 assert(input.bucket==='records'?isContent(target as WorkspaceRecord):(target as PageDraft).locale===input.locale,404,'NOT_FOUND','Translation source not found.');
 const sourceRowData=input.bucket==='records'?target:(await client.query<{data:PageDraft}>("SELECT data FROM workspace_entities WHERE bucket='pages' AND deleted_at IS NULL AND data->>'slug'=$1 AND locale=$2",[(target as PageDraft).slug,input.sourceLocale])).rows[0]?.data;
 const available=sourceRowData&&mayRead(actor,input.bucket,sourceRowData)&&(!('status'in sourceRowData)||sourceRowData.status!=='archived'),source=available?await revisionSource(client,input.bucket,sourceRowData,input.sourceLocale):null,currentTarget=await revisionSource(client,input.bucket,target,input.locale);
 const binding=(await client.query<BindingRow>('SELECT * FROM content_translation_acknowledgements WHERE document_bucket=$1 AND target_document_id=$2 AND target_locale=$3 AND source_locale=$4 ORDER BY acknowledged_at DESC,id DESC LIMIT 1',[input.bucket,input.id,input.locale,input.sourceLocale])).rows[0];
 const targetTitle='collection'in target?target.title[input.locale]:target.title,sourceTitle=sourceRowData&&('collection'in sourceRowData?sourceRowData.title[input.sourceLocale]:sourceRowData.title),module=input.bucket==='pages'?'pages':(target as WorkspaceRecord).collection;
 let status:TranslationStatus['status']=!available||!sourceTitle?.trim()?'missing_source':!targetTitle?.trim()?'missing_translation':!source||!currentTarget||!binding?'unknown':source.checksum!==binding.source_checksum?'stale':currentTarget.checksum!==binding.target_checksum?'unconfirmed':'current';
 return{status,source,target:currentTarget,acknowledgement:binding?{id:binding.id,sourceRevisionId:binding.source_revision_id,targetRevisionId:binding.target_revision_id,acknowledgedAt:iso(binding.acknowledged_at),acknowledgedBy:binding.acknowledged_by}:null,canAcknowledge:!!source&&!!currentTarget&&!!targetTitle.trim()&&!!sourceTitle?.trim()&&actor.allowedLocales.includes(input.locale)&&(hasWorkspacePermission(actor,'translate',module,input.locale)||hasWorkspacePermission(actor,'edit',module,input.locale)),version};
}
export async function getTranslationStatus(actor:Actor,body:unknown){const input=parse(contentTarget.strict(),body);return transaction(async client=>{const meta=await lockWorkspace(client);actor=await actorNow(client,actor);return translationStatus(client,actor,input,Number(meta.version));});}
export async function acknowledgeTranslation(actor:Actor,body:unknown,leaseTokens:string[]=[]){
 const input=parse(contentTarget.extend({sourceRevisionId:revisionId,targetRevisionId:revisionId,expectedUpdatedAt:z.string().datetime({offset:true}),expectedVersion:expected}).strict(),body);
 return transaction(async client=>{const meta=await lockWorkspace(client);actor=await actorNow(client,actor);checkVersion(Number(meta.version),input.expectedVersion);const current=await translationStatus(client,actor,input,Number(meta.version));assert(current.canAcknowledge&&current.source&&current.target,403,'TRANSLATION_PERMISSION','Save the source and target revisions and obtain the target language permission before acknowledging a translation.');
  assert(current.source.revisionId===input.sourceRevisionId&&current.target.revisionId===input.targetRevisionId&&current.target.updatedAt===input.expectedUpdatedAt,409,'SOURCE_CHANGED','The source or translation changed after comparison. Reload both saved revisions before acknowledging.');
  const row=await sourceRow(client,actor,input.bucket,input.id),source=row.data;
  if(input.bucket==='pages')await assertContentLeaseWrites(client,actor,[{bucket:'pages',id:input.id,before:source as PageDraft,after:source as PageDraft,action:'translation.acknowledged',activity:serverActivity(actor,'translation.acknowledged',input.id)}],leaseTokens);
  else await assertContentLeaseWrites(client,actor,[{bucket:'records',id:input.id,before:source as WorkspaceRecord,after:source as WorkspaceRecord,action:'translation.acknowledged',activity:serverActivity(actor,'translation.acknowledged',input.id)}],leaseTokens);
  const added=await client.query('INSERT INTO content_translation_acknowledgements(id,document_bucket,target_document_id,target_locale,source_document_id,source_locale,source_revision_id,target_revision_id,source_checksum,target_checksum,acknowledged_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(document_bucket,target_document_id,target_locale,source_locale,source_revision_id,target_revision_id) DO NOTHING RETURNING id',[randomUUID(),input.bucket,input.id,input.locale,current.source.documentId,input.sourceLocale,current.source.revisionId,current.target.revisionId,current.source.checksum,current.target.checksum,actor.id]);
  let version=Number(meta.version);if(added.rowCount){await audit(actor.id,'content.translation.acknowledged',input.bucket,input.id,{sourceRevisionId:current.source.revisionId,targetRevisionId:current.target.revisionId,sourceLocale:input.sourceLocale,targetLocale:input.locale},client);version=await bumpVersion(client);}
  return{state:projectForActor(await readWorkspace(client,meta),actor),version};
 });
}
