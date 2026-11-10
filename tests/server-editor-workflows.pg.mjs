import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,localized,fixtureHttpSession} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';
import {getWorkspace,saveWorkspace,restoreWorkspaceRevision} from '../src/server/workspace.ts';
import {acquireContentLease,getContentLease} from '../src/server/content-collaboration.ts';
import {changeWorkspacePageLifecycle} from '../src/server/page-lifecycle.ts';
import {listWorkspaceForms,getWorkspaceForm,saveWorkspaceForm,changeWorkspaceFormLifecycle,getFormRevisions,getEditorRevisionDetail,restoreWorkspaceFormRevision,getTranslationStatus,acknowledgeTranslation} from '../src/server/editor-workflows.ts';

const failure=(status,code)=>error=>error instanceof HttpError&&error.status===status&&(!code||error.code===code);
const blank=()=>({title:localized('Controlled form'),fields:[{id:'name',label:localized('Name'),type:'text',required:true},{id:'email',label:localized('Email'),type:'email',required:true}]});
const a=fixtureActor('editor-workflows-a','admin'),b=fixtureActor('editor-workflows-b','admin'),restricted=fixtureActor('editor-workflows-en','contentEditor',{allowedLocales:['en']}),outsider=fixtureActor('editor-workflows-customer','customer');
async function current(actor=a){return getWorkspace(actor);}
async function create(id,value=blank(),actor=a){return saveWorkspaceForm(actor,null,{id,value,expectedVersion:(await current(actor)).version});}
async function save(id,value,expectedFormVersion,actor=a,tokens=[]){return saveWorkspaceForm(actor,id,{value,expectedFormVersion,expectedVersion:(await current(actor)).version},tokens);}
async function form(id,actor=a){return(await getWorkspaceForm(actor,id)).item.form;}
async function lifecycle(id,operation,actor=a,tokens=[]){return changeWorkspaceFormLifecycle(actor,id,{operation,reason:'Reviewed explicit lifecycle operation',expectedFormVersion:(await form(id,actor)).version,expectedVersion:(await current(actor)).version},tokens);}
async function record(id,change,actor=a){const before=await current(actor);return saveWorkspace(actor,{state:{...before.state,records:before.state.records.map(row=>row.id===id?change(structuredClone(row)):row)},expectedVersion:before.version,locale:'en'});}
const translation=id=>({bucket:'records',id,locale:'en',sourceLocale:'fa'});
async function ack(input,status,actor=a,tokens=[]){return acknowledgeTranslation(actor,{...input,sourceRevisionId:status.source.revisionId,targetRevisionId:status.target.revisionId,expectedUpdatedAt:status.target.updatedAt,expectedVersion:(await current(actor)).version},tokens);}

test('Versioned form workflows, immutable scoped revision diff and explicit translation baselines use real PostgreSQL',{timeout:180000},async t=>withCrmRecoveryDatabase('editor_workflows',async()=>{
 for(const actor of[a,b,restricted,outsider])await insertActor(actor);
 await current();
 await t.test('Form creation persists actual schema revisions without answers and requires current permission',async()=>{
  const created=await create('FORM-WORKFLOW-A');assert.equal(created.state.forms.find(row=>row.id==='FORM-WORKFLOW-A').version,1);assert.equal((await form('FORM-WORKFLOW-A')).status,'active');
  const directory=await listWorkspaceForms(a,{limit:100});assert.ok(directory.canCreate);assert.ok(directory.items.find(row=>row.form.id==='FORM-WORKFLOW-A').capabilities.edit);
  const revisions=await getFormRevisions(a,'FORM-WORKFLOW-A','en');assert.equal(revisions.revisions.length,1);const detail=await getEditorRevisionDetail(a,revisions.revisions[0].id);assert.equal(detail.snapshot.title.en,'Controlled form');assert.equal('fa'in detail.snapshot.title,false);assert.equal('responses'in detail.snapshot,false);
  await assert.rejects(listWorkspaceForms(outsider,{}),failure(403));await assert.rejects(create('FORM-NO-GRANT',blank(),restricted),failure(403,'FORM_LOCALE_SCOPE'));assert.equal((await listWorkspaceForms(restricted,{})).canCreate,false);
 });
 await t.test('A captured form version remains stale after a fresh global workspace read',async()=>{
  const source=await form('FORM-WORKFLOW-A'),edited={...blank(),title:localized('Other editor schema')};await save(source.id,edited,source.version,b);
  await assert.rejects(save(source.id,{...blank(),title:localized('Stale overwrite')},source.version),failure(409,'SOURCE_CHANGED'));
  assert.equal((await form(source.id)).title.en,'Other editor schema');
 });
 await t.test('A real form lease excludes another editor and rejects stale reacquisition',async()=>{
  const source=await form('FORM-WORKFLOW-A'),lease=await acquireContentLease(a,{bucket:'forms',id:source.id,clientId:randomUUID(),expectedUpdatedAt:source.updatedAt});
  assert.equal((await getContentLease(b,{bucket:'forms',id:source.id})).lease.id,lease.id);
  await assert.rejects(save(source.id,blank(),source.version,b),failure(423,'CONTENT_LOCKED'));
  const saved=await save(source.id,{...blank(),title:localized('Lease holder changed schema')},source.version,a,[lease.token]);assert.equal(saved.state.forms.find(row=>row.id===source.id).title.en,'Lease holder changed schema');
  await query("UPDATE content_edit_leases SET lease_until=now()-interval '1 minute' WHERE id=$1",[lease.id]);
  await assert.rejects(acquireContentLease(b,{bucket:'forms',id:source.id,clientId:randomUUID(),expectedUpdatedAt:source.updatedAt}),failure(409,'SOURCE_CHANGED'));
 });
 await t.test('Legacy workspace writes cannot forge a form lifecycle, advance a stale version or delete the retained row',async()=>{
  const before=await current(),target=before.state.forms.find(row=>row.id==='FORM-WORKFLOW-A');
  for(const patch of[{version:target.version-1,title:localized('Stale generic draft')},{status:'archived'}])await assert.rejects(saveWorkspace(a,{state:{...before.state,forms:before.state.forms.map(row=>row.id===target.id?{...row,...patch}:row)},expectedVersion:before.version}),failure(patch.status?403:409));
  await assert.rejects(saveWorkspace(a,{state:{...before.state,forms:before.state.forms.filter(row=>row.id!==target.id)},expectedVersion:before.version}),failure(403));
 });
 await t.test('Assigned-locale label edits work and structural or foreign-language edits remain denied',async()=>{
  const source=await form('FORM-WORKFLOW-A',restricted),value={title:{...source.title,en:'English label edit'},fields:source.fields};await save(source.id,value,source.version,restricted);
  const next=await form(source.id,restricted);await assert.rejects(save(source.id,{...value,title:{...value.title,fa:'تغییر نامجاز'}},next.version,restricted),failure(403,'FORM_LOCALE_SCOPE'));
  await assert.rejects(save(source.id,{...value,fields:[...value.fields,{id:'new-field',label:localized('New shared field'),type:'text',required:false}]},next.version,restricted),failure(403,'FORM_LOCALE_SCOPE'));
 });
 await t.test('Saved draft usages block lifecycle changes and usage identities respect locale scope',async()=>{
  const schema=await form('FORM-WORKFLOW-A');const before=await current();const page={id:'FORM-USING-FA',slug:'form-using',locale:'fa',title:'صفحه فرم',summary:'فرم موجود',status:'draft',version:1,author:a.role,authorId:a.id,updatedAt:new Date().toISOString(),blocks:[{id:'block-form',type:'form',title:'',body:'',formId:schema.id,formSchema:{id:schema.id,title:schema.title,fields:schema.fields,version:schema.version}}]};
  await saveWorkspace(a,{state:{...before.state,pages:[...before.state.pages,page]},expectedVersion:before.version,locale:'fa'});
  await assert.rejects(lifecycle(schema.id,'archive'),failure(409,'FORM_IN_USE'));const restrictedView=await getWorkspaceForm(restricted,schema.id);assert.equal(restrictedView.item.usage.blocked,true);assert.deepEqual(restrictedView.item.usage.drafts,[]);
  const latest=await current(),saved=latest.state.pages.find(row=>row.id===page.id);await changeWorkspacePageLifecycle(a,page.id,{operation:'delete',reason:'Remove the isolated form usage page',expectedVersion:latest.version,expectedPageVersion:saved.version,expectedUpdatedAt:saved.updatedAt});
 });
 await t.test('An archived form cannot be referenced again and a page can pin only an actual retained form schema',async()=>{
  await create('FORM-REFERENCE-CHECK');const initial=await form('FORM-REFERENCE-CHECK'),at=new Date().toISOString();const page={id:'FORM-REFERENCE-PAGE',slug:'form-reference-page',locale:'en',title:'Reference check',summary:'Actual saved schema',status:'draft',version:1,author:a.role,authorId:a.id,updatedAt:at,blocks:[{id:'form',type:'form',title:'',body:'',formId:initial.id,formSchema:{id:initial.id,title:initial.title,fields:initial.fields,version:initial.version}}]};
  await lifecycle(initial.id,'archive');let w=await current();await assert.rejects(saveWorkspace(a,{state:{...w.state,pages:[...w.state.pages,page]},expectedVersion:w.version,locale:'en'}),failure(409,'FORM_UNAVAILABLE'));
  await lifecycle(initial.id,'restore');const active=await form(initial.id);page.blocks[0].formSchema={id:active.id,title:localized('Forged reviewed schema'),fields:active.fields,version:active.version};w=await current();await assert.rejects(saveWorkspace(a,{state:{...w.state,pages:[...w.state.pages,page]},expectedVersion:w.version,locale:'en'}),failure(409,'FORM_REVISION_REQUIRED'));
  page.blocks[0].formSchema.title=active.title;await saveWorkspace(a,{state:{...w.state,pages:[...w.state.pages,page]},expectedVersion:w.version,locale:'en'});await save(active.id,{...blank(),title:localized('New authoring schema')},active.version);w=await current();const pinned=w.state.pages.find(row=>row.id===page.id).blocks[0].formSchema;
  await saveWorkspace(a,{state:{...w.state,pages:w.state.pages.map(row=>row.id===page.id?{...row,summary:'Unrelated page edit retains the original form schema'}:row)},expectedVersion:w.version,locale:'en'});assert.deepEqual((await current()).state.pages.find(row=>row.id===page.id).blocks[0].formSchema,pinned);
 });
 await t.test('Archive, recycle and explicit restore retain answers and never create a public release',async()=>{
  const secret={id:'retained-answer',at:new Date().toISOString(),values:{name:'Private fixture name',email:'private-fixture@example.invalid'}};await query("UPDATE workspace_entities SET data=jsonb_set(data,'{responses}',$2::jsonb) WHERE bucket='forms' AND id=$1",['FORM-WORKFLOW-A',JSON.stringify([secret])]);
  await assert.rejects(lifecycle('FORM-WORKFLOW-A','delete'),failure(409,'FORM_STATE'));await lifecycle('FORM-WORKFLOW-A','archive');assert.equal((await getWorkspaceForm(a,'FORM-WORKFLOW-A')).item.capabilities.delete,true);
  await lifecycle('FORM-WORKFLOW-A','delete');assert.equal((await current()).state.forms.some(row=>row.id==='FORM-WORKFLOW-A'),false);assert.equal((await listWorkspaceForms(a,{status:'deleted'})).items.find(row=>row.form.id==='FORM-WORKFLOW-A').status,'deleted');
  await assert.rejects(create('FORM-WORKFLOW-A'),failure(409,'FORM_IDENTITY'));await lifecycle('FORM-WORKFLOW-A','restore');assert.equal((await form('FORM-WORKFLOW-A')).status,'active');
  const stored=(await query("SELECT data FROM workspace_entities WHERE bucket='forms' AND id='FORM-WORKFLOW-A'")).rows[0].data;assert.deepEqual(stored.responses,[secret]);assert.equal((await query("SELECT count(*)::int AS n FROM locale_releases WHERE document_id='FORM-WORKFLOW-A'")).rows[0].n,0);
  for(const revision of(await getFormRevisions(a,'FORM-WORKFLOW-A','en')).revisions){const detail=await getEditorRevisionDetail(a,revision.id);assert.equal(JSON.stringify(detail).includes(secret.values.email),false);}
 });
 await t.test('Restoring selected form history creates a new schema revision and preserves retained answers',async()=>{
  const history=await getFormRevisions(a,'FORM-WORKFLOW-A','en'),oldest=history.revisions.at(-1),before=await form('FORM-WORKFLOW-A');
  await restoreWorkspaceFormRevision(a,before.id,{revisionId:oldest.id,expectedFormVersion:before.version,expectedVersion:(await current()).version});assert.equal((await form(before.id)).title.en,'Controlled form');assert.ok((await form(before.id)).version>before.version);
  await assert.rejects(restoreWorkspaceFormRevision(a,before.id,{revisionId:oldest.id,expectedFormVersion:before.version,expectedVersion:(await current()).version}),failure(409,'SOURCE_CHANGED'));
 });
 await t.test('Two concurrent form writes cannot both commit from the same captured versions',async()=>{
  const source=await form('FORM-WORKFLOW-A'),version=(await current()).version;const writes=await Promise.allSettled([a,b].map((actor,index)=>saveWorkspaceForm(actor,source.id,{value:{...blank(),title:localized('Concurrent winner '+index)},expectedFormVersion:source.version,expectedVersion:version})));
  assert.equal(writes.filter(row=>row.status==='fulfilled').length,1);assert.equal(writes.filter(row=>row.status==='rejected'&&failure(409)(row.reason)).length,1);
 });
 const recordId='EDITOR-TRANSLATION';
 await t.test('Translation status is unknown until an explicit real revision acknowledgement and GET does not create it',async()=>{
  const w=await current(),at=new Date().toISOString(),source={id:recordId,collection:'news',title:localized('Saved editorial title'),summary:localized('Saved source wording'),status:'draft',owner:a.role,author:a.role,authorId:a.id,updatedAt:at,createdAt:at,tags:[],demo:false,history:[],details:{editorialContent:{schemaVersion:1,body:{fa:'متن اصلی',en:'Translated body',tr:'Kaynak',ar:'النص',ru:'Текст'}}}};
  await saveWorkspace(a,{state:{...w.state,records:[...w.state.records,source]},expectedVersion:w.version,locale:'en'});const status=await getTranslationStatus(a,translation(recordId));assert.equal(status.status,'unknown');assert.ok(status.source&&status.target);assert.equal((await query('SELECT count(*)::int AS n FROM content_translation_acknowledgements')).rows[0].n,0);
  await ack(translation(recordId),status);assert.equal((await getTranslationStatus(a,translation(recordId))).status,'current');
 });
 await t.test('Only relevant source or target content changes affect stale status, and revision acknowledgements are immutable',async()=>{
  await record(recordId,row=>({...row,title:{...row.title,tr:'An unrelated locale changed'}}));assert.equal((await getTranslationStatus(a,translation(recordId))).status,'current');
  await record(recordId,row=>({...row,summary:{...row.summary,fa:'متن مبدأ تغییر کرد'}}));const stale=await getTranslationStatus(a,translation(recordId));assert.equal(stale.status,'stale');await ack(translation(recordId),stale);
  await record(recordId,row=>({...row,summary:{...row.summary,en:'Changed target needs a fresh explicit check'}}));assert.equal((await getTranslationStatus(a,translation(recordId))).status,'unconfirmed');
  const binding=(await query('SELECT id FROM content_translation_acknowledgements LIMIT 1')).rows[0];await assert.rejects(query("UPDATE content_translation_acknowledgements SET target_checksum=$2 WHERE id=$1",[binding.id,'0'.repeat(64)]),error=>error.code==='23514');await assert.rejects(query('DELETE FROM content_translation_acknowledgements WHERE id=$1',[binding.id]),error=>error.code==='23514');
 });
 await t.test('Stale source references, target stamp changes and revoked target grants cannot be acknowledged',async()=>{
  const before=await getTranslationStatus(a,translation(recordId));await record(recordId,row=>({...row,summary:{...row.summary,fa:'تغییر بعد از بازکردن مقایسه'}}));await assert.rejects(ack(translation(recordId),before),failure(409,'SOURCE_CHANGED'));
  const next=await getTranslationStatus(restricted,translation(recordId));await query("UPDATE users SET allowed_locales='[\"tr\"]'::jsonb WHERE id=$1",[restricted.id]);await assert.rejects(ack(translation(recordId),next,restricted),failure(403,'TRANSLATION_PERMISSION'));await query("UPDATE users SET allowed_locales='[\"en\"]'::jsonb WHERE id=$1",[restricted.id]);
 });
 await t.test('A selected content restore retains its captured source timestamp after the global clock advances',async()=>{
  const compared=await getTranslationStatus(a,translation(recordId)),revisionId=compared.target.revisionId,expectedUpdatedAt=compared.target.updatedAt;
  await record(recordId,row=>({...row,summary:{...row.summary,en:'Source changed while confirmation was open'}}));let w=await current();await assert.rejects(restoreWorkspaceRevision(a,{revisionId,expectedUpdatedAt,expectedVersion:w.version}),failure(409,'SOURCE_CHANGED'));
  const newest=w.state.records.find(row=>row.id===recordId);const restored=await restoreWorkspaceRevision(a,{revisionId,expectedUpdatedAt:newest.updatedAt,expectedVersion:w.version});assert.equal(restored.state.records.find(row=>row.id===recordId).summary.en,'Changed target needs a fresh explicit check');
  const history=await getFormRevisions(a,'FORM-WORKFLOW-A','en');w=await current();await assert.rejects(restoreWorkspaceRevision(a,{revisionId:history.revisions[0].id,expectedUpdatedAt:(await form('FORM-WORKFLOW-A')).updatedAt,expectedVersion:w.version}),failure(404));
 });
 await t.test('Historical detail checks current account access and filters foreign locale content',async()=>{
  const status=await getTranslationStatus(a,translation(recordId)),detail=await getEditorRevisionDetail(a,status.target.revisionId);assert.ok(detail.snapshot.title.en);assert.equal(detail.snapshot.title.fa,undefined);assert.equal(JSON.stringify(detail.snapshot).includes('تغییر بعد از بازکردن مقایسه'),false);
  await assert.rejects(getEditorRevisionDetail(outsider,status.target.revisionId),failure(403));await query('UPDATE users SET active=false WHERE id=$1',[b.id]);await assert.rejects(getEditorRevisionDetail(b,status.target.revisionId));
 });
 await t.test('HTTP form and immutable revision routes require cookie identity and mutation CSRF',async()=>{
  const http=await fixtureHttpSession(a);const list=await http.request('/workspace/forms');assert.equal(list.status,200);const payload=await list.json();assert.ok(payload.items.some(row=>row.form.id==='FORM-WORKFLOW-A'));
  const target=await form('FORM-WORKFLOW-A'),before=await current();const result=await http.request('/workspace/forms/'+target.id,{method:'PUT',body:{value:blank(),expectedFormVersion:target.version,expectedVersion:before.version},headers:{'x-csrf-token':'forged'}});assert.equal(result.status,403);assert.equal((await form(target.id)).version,target.version);
  const history=await getFormRevisions(a,target.id,'en');assert.equal((await http.request('/workspace/revisions/'+history.revisions[0].id)).status,200);
 });
}));
