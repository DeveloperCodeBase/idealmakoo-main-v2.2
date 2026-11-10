import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,fixtureHttpSession,localized} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';
import {getWorkspace,saveWorkspace,reviewWorkspaceContent,publishWorkspace,scheduleWorkspaceContent,getPublicSite,getWorkspaceRevisions,restoreWorkspaceRevision} from '../src/server/workspace.ts';
import {listWorkspacePages,getWorkspacePage,changeWorkspacePageLifecycle,getWorkspacePageRevisions} from '../src/server/page-lifecycle.ts';
import {acquireContentLease,createContentPreview,contentPreviewResponse} from '../src/server/content-collaboration.ts';
import {getEditorRevisionDetail,saveWorkspaceForm} from '../src/server/editor-workflows.ts';
import {createSharedBlock,attachSharedBlock} from '../src/server/shared-blocks.ts';
import {storeAsset} from '../src/server/storage.ts';
import {deleteMedia} from '../src/server/media.ts';

const a=fixtureActor('page-lifecycle-author','admin'),b=fixtureActor('page-lifecycle-reviewer','admin'),editor=fixtureActor('page-lifecycle-en','contentEditor',{allowedLocales:['en']}),publisher=fixtureActor('page-lifecycle-publisher','publisher'),customer=fixtureActor('page-lifecycle-customer','customer');
const failure=(status,code)=>error=>error instanceof HttpError&&error.status===status&&(!code||error.code===code);
const current=(actor=a)=>getWorkspace(actor);
const page=async(id,actor=a)=>(await getWorkspacePage(actor,id)).item.page;
async function create(id,{locale='en',slug=id,status='draft',blocks=[{id:'body',type:'rich-text',title:'Saved content',body:'Actual page lifecycle integration content.'}]}={},actor=a){
 const w=await current(actor),source={id,slug,locale,status,title:'Page '+id,summary:'Reviewed page lifecycle acceptance',blocks,version:1,author:actor.role,authorId:actor.id,updatedAt:new Date().toISOString()};
 await saveWorkspace(actor,{state:{...w.state,pages:[...w.state.pages,source]},locale,expectedVersion:w.version});return page(id,actor);
}
async function patch(id,change,actor=a,tokens=[]){const w=await current(actor),prior=w.state.pages.find(row=>row.id===id);return saveWorkspace(actor,{state:{...w.state,pages:w.state.pages.map(row=>row.id===id?{...row,...change}:row)},locale:prior.locale,expectedVersion:w.version},tokens);}
async function ready(id,{publish=true,schedule=false}={}){
 let source=await page(id);if(source.status==='draft')await patch(id,{status:'review'});
 await reviewWorkspaceContent(b,{bucket:'pages',id,locale:source.locale,expectedVersion:(await current(b)).version});
 if(publish)await publishWorkspace(a,{publication:{id,kind:'page',locale:source.locale},expectedVersion:(await current()).version});
 if(schedule)await scheduleWorkspaceContent(a,{bucket:'pages',id,locale:source.locale,scheduledAt:new Date(Date.now()+600000).toISOString(),expectedVersion:(await current()).version});
 return page(id);
}
async function input(id,operation,actor=a){const source=await page(id,actor);return{operation,reason:'Reviewed explicit page lifecycle operation',expectedVersion:(await current(actor)).version,expectedPageVersion:source.version,expectedUpdatedAt:source.updatedAt};}
async function lifecycle(id,operation,actor=a,tokens=[]){return changeWorkspacePageLifecycle(actor,id,await input(id,operation,actor),tokens);}
async function preview(id){const source=await page(id);return createContentPreview(a,{bucket:'pages',id,locale:source.locale,expiresInMinutes:60});}
const previewRequest=url=>new Request(url,{headers:{'x-forwarded-for':'127.0.0.1'}});
async function live(id){return(await getPublicSite()).publications.find(row=>row.id===id);}
async function stateEvidence(id){return{entity:(await query("SELECT data,deleted_at,revision_number FROM workspace_entities WHERE bucket='pages' AND id=$1",[id])).rows[0],releases:(await query("SELECT * FROM locale_releases WHERE document_bucket='pages' AND document_id=$1 ORDER BY locale",[id])).rows,jobs:(await query("SELECT * FROM workspace_publish_jobs WHERE document_bucket='pages' AND document_id=$1 ORDER BY id",[id])).rows,previews:(await query("SELECT * FROM content_previews WHERE document_bucket='pages' AND document_id=$1 ORDER BY id",[id])).rows,version:(await current()).version};}

test('Page lifecycle uses current grants, atomic withdrawal, immutable retention and explicit draft restoration',{timeout:180000},async t=>withCrmRecoveryDatabase('page_lifecycle',async({storage})=>{
 for(const actor of[a,b,editor,publisher,customer])await insertActor(actor);await current();

 await t.test('Directory and retained detail use current language grants with bounded pagination',async()=>{
  await create('LIFE-DIRECTORY-EN');await create('LIFE-DIRECTORY-FA',{locale:'fa'});
  const first=await listWorkspacePages(editor,{locale:'en',limit:1});assert.equal(first.items.length,1);assert.ok(first.nextCursor);assert.ok(first.items.every(item=>item.page.locale==='en'));
  const next=await listWorkspacePages(editor,{locale:'en',limit:1,cursor:first.nextCursor});assert.notEqual(next.items[0].page.id,first.items[0].page.id);
  await assert.rejects(getWorkspacePage(editor,'LIFE-DIRECTORY-FA'),failure(404));await assert.rejects(listWorkspacePages(editor,{locale:'fa'}),failure(403,'LOCALE_SCOPE'));await assert.rejects(listWorkspacePages(a,{limit:101}),failure(422));await assert.rejects(listWorkspacePages(customer),failure(403));
  const stale=await input('LIFE-DIRECTORY-EN','archive',editor);await query("UPDATE users SET allowed_locales='[\"tr\"]'::jsonb WHERE id=$1",[editor.id]);await assert.rejects(changeWorkspacePageLifecycle(editor,'LIFE-DIRECTORY-EN',stale),failure(404));await query("UPDATE users SET allowed_locales='[\"en\"]'::jsonb WHERE id=$1",[editor.id]);
 });
 await t.test('Generic snapshot writes cannot create an archived page, archive or delete an existing page',async()=>{
  const w=await current(),source=w.state.pages.find(row=>row.id==='LIFE-DIRECTORY-EN');
  for(const pages of[w.state.pages.map(row=>row.id===source.id?{...row,status:'archived'}:row),w.state.pages.filter(row=>row.id!==source.id),[...w.state.pages,{...source,id:'LIFE-FORGED-ARCHIVE',slug:'life-forged-archive',status:'archived'}]])await assert.rejects(saveWorkspace(a,{state:{...w.state,pages},locale:'en',expectedVersion:w.version}),failure(403));
  assert.equal((await page(source.id)).status,'draft');
 });
 await t.test('Ordinary draft edits preserve the exact live release until an explicit lifecycle command',async()=>{
  await create('LIFE-LIVE-DRAFT');await ready('LIFE-LIVE-DRAFT');const released=await live('LIFE-LIVE-DRAFT');
  await patch('LIFE-LIVE-DRAFT',{title:'Unsanctioned draft wording',status:'draft',approvedBy:undefined,approvedById:undefined});assert.deepEqual(await live('LIFE-LIVE-DRAFT'),released);
  await lifecycle('LIFE-LIVE-DRAFT','archive');assert.equal(await live('LIFE-LIVE-DRAFT'),undefined);
 });
 await t.test('Archive atomically withdraws live and scheduled locale releases and revokes capability previews',async()=>{
  await create('LIFE-ATOMIC-EN',{slug:'life-atomic'});await create('LIFE-ATOMIC-FA',{slug:'life-atomic',locale:'fa'});await ready('LIFE-ATOMIC-FA');await ready('LIFE-ATOMIC-EN',{schedule:true});
  const capability=await preview('LIFE-ATOMIC-EN'),token=capability.url.split('/').at(-1);assert.equal((await contentPreviewResponse(previewRequest(capability.url),token)).status,200);
  await lifecycle('LIFE-ATOMIC-EN','archive');const evidence=await stateEvidence('LIFE-ATOMIC-EN');assert.equal(evidence.entity.data.status,'archived');assert.ok(evidence.releases.every(row=>row.unpublished_at));assert.ok(evidence.jobs.every(row=>row.status==='cancelled'&&row.finished_at));assert.ok(evidence.previews.every(row=>row.revoked_at));
  assert.equal(await live('LIFE-ATOMIC-EN'),undefined);assert.ok(await live('LIFE-ATOMIC-FA'));await assert.rejects(contentPreviewResponse(previewRequest(capability.url),token),failure(404));
  await assert.rejects(createContentPreview(a,{bucket:'pages',id:'LIFE-ATOMIC-EN',locale:'en',expiresInMinutes:60}),failure(403));
 });
 await t.test('Publication withdrawal permission is independently required for every live or scheduled locale',async()=>{
  await create('LIFE-PUBLISH-PERM');await ready('LIFE-PUBLISH-PERM',{schedule:true});const view=await getWorkspacePage(editor,'LIFE-PUBLISH-PERM');assert.equal(view.item.capabilities.archive,false);assert.equal(view.item.publication.requiresPublisher,true);
  await assert.rejects(lifecycle('LIFE-PUBLISH-PERM','delete',editor),failure(403,'PAGE_WITHDRAW_PERMISSION'));assert.ok(await live('LIFE-PUBLISH-PERM'));
  await assert.rejects(lifecycle('LIFE-PUBLISH-PERM','archive',publisher),failure(403,'FORBIDDEN'));
  await create('LIFE-EDITOR-DRAFT',{},editor);await lifecycle('LIFE-EDITOR-DRAFT','archive',editor);assert.equal((await page('LIFE-EDITOR-DRAFT')).status,'archived');
 });
 await t.test('Active lease ownership cannot be bypassed with a stolen token; deleted sources cannot acquire a new lease',async()=>{
  const source=await create('LIFE-LEASE'),lease=await acquireContentLease(a,{bucket:'pages',id:source.id,clientId:randomUUID(),expectedUpdatedAt:source.updatedAt});
  await assert.rejects(lifecycle(source.id,'delete'),failure(423,'CONTENT_LOCKED'));await assert.rejects(lifecycle(source.id,'delete',b,[lease.token]),failure(423,'CONTENT_LOCKED'));await assert.rejects(lifecycle(source.id,'delete',a,['0'.repeat(64)]),failure(423,'CONTENT_LOCKED'));
  await lifecycle(source.id,'delete',a,[lease.token]);assert.equal((await query("SELECT count(*)::int AS n FROM content_edit_leases WHERE document_bucket='pages' AND document_id=$1",[source.id])).rows[0].n,0);
  await assert.rejects(acquireContentLease(a,{bucket:'pages',id:source.id,clientId:randomUUID(),expectedUpdatedAt:source.updatedAt}),failure(404));
  const captured=await input(source.id,'restore');await lifecycle(source.id,'restore');await lifecycle(source.id,'archive');await assert.rejects(changeWorkspacePageLifecycle(a,source.id,{...captured,expectedVersion:(await current()).version}),failure(409,'SOURCE_CHANGED'));
  const archived=await page(source.id);await assert.rejects(acquireContentLease(a,{bucket:'pages',id:source.id,clientId:randomUUID(),expectedUpdatedAt:archived.updatedAt}),failure(403));
 });
 await t.test('Both captured page version and timestamp remain authoritative after the global clock is refreshed',async()=>{
  const source=await create('LIFE-CAS'),captured=await input(source.id,'archive');await patch(source.id,{title:'Other editor saved this version'},b);const currentSource=await page(source.id);
  await assert.rejects(changeWorkspacePageLifecycle(a,source.id,{...captured,expectedVersion:(await current()).version}),failure(409,'SOURCE_CHANGED'));
  await assert.rejects(changeWorkspacePageLifecycle(a,source.id,{...captured,expectedVersion:(await current()).version,expectedPageVersion:currentSource.version}),failure(409,'SOURCE_CHANGED'));
  assert.equal((await page(source.id)).title,'Other editor saved this version');
 });
 await t.test('Concurrent lifecycle commands admit exactly one current-version writer',async()=>{
  await create('LIFE-CONCURRENT');const captured=await input('LIFE-CONCURRENT','archive');const results=await Promise.allSettled([a,b].map(actor=>changeWorkspacePageLifecycle(actor,'LIFE-CONCURRENT',captured)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected'&&failure(409,'SOURCE_CHANGED')(result.reason)).length,1);
 });
 await t.test('Audit failure rolls back the source, publication, jobs, previews and global clock together',async()=>{
  await create('LIFE-ROLLBACK');await ready('LIFE-ROLLBACK',{schedule:true});await preview('LIFE-ROLLBACK');const before=await stateEvidence('LIFE-ROLLBACK');
  await query("CREATE FUNCTION reject_page_lifecycle_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='page.delete' THEN RAISE EXCEPTION 'isolated audit write rejected'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_page_lifecycle_audit BEFORE INSERT ON workspace_audit FOR EACH ROW EXECUTE FUNCTION reject_page_lifecycle_audit()");
  try{await assert.rejects(lifecycle('LIFE-ROLLBACK','delete'),/isolated audit write rejected/);assert.deepEqual(await stateEvidence('LIFE-ROLLBACK'),before);}finally{await query('DROP TRIGGER reject_page_lifecycle_audit ON workspace_audit; DROP FUNCTION reject_page_lifecycle_audit()');}
 });
 await t.test('Recycling a published scheduled page keeps immutable revisions and restores a fresh unapproved draft',async()=>{
  await create('LIFE-RESTORE');await ready('LIFE-RESTORE',{schedule:true});const capability=await preview('LIFE-RESTORE');const previous=(await query("SELECT r.*,a.approved_by FROM content_revisions r LEFT JOIN content_approvals a ON a.revision_id=r.id WHERE document_bucket='pages' AND document_id='LIFE-RESTORE' ORDER BY revision_number DESC LIMIT 1")).rows[0];assert.ok(previous.approved_by);
  await lifecycle('LIFE-RESTORE','delete');assert.equal((await current()).state.pages.some(row=>row.id==='LIFE-RESTORE'),false);assert.equal((await getWorkspacePage(a,'LIFE-RESTORE')).item.status,'deleted');
  const retained=await page('LIFE-RESTORE');const w=await current();await assert.rejects(saveWorkspace(a,{state:{...w.state,pages:[...w.state.pages,{...retained,status:'draft'}]},locale:'en',expectedVersion:w.version}),failure(409,'deleted_identity'));
  assert.ok((await getWorkspaceRevisions(a,{bucket:'pages',id:retained.id,locale:'en'})).revisions.some(row=>row.id===previous.id));assert.equal((await getEditorRevisionDetail(a,previous.id)).snapshot.title,previous.snapshot.title);
  await assert.rejects(getEditorRevisionDetail(publisher,previous.id),failure(404));
  await lifecycle('LIFE-RESTORE','restore');const restored=await page('LIFE-RESTORE');assert.equal(restored.status,'draft');assert.equal(restored.approvedById,undefined);assert.equal(restored.approvedBy,undefined);assert.equal(restored.scheduledAt,undefined);assert.deepEqual(restored.blocks,previous.snapshot.blocks);
  const next=(await getWorkspacePageRevisions(a,restored.id,'en')).revisions[0];assert.notEqual(next.id,previous.id);assert.equal(next.checksum,previous.checksum);assert.equal(next.approved_by,null);assert.deepEqual((await query('SELECT snapshot FROM content_revisions WHERE id=$1',[previous.id])).rows[0].snapshot,previous.snapshot);
  await assert.rejects(publishWorkspace(a,{publication:{id:restored.id,kind:'page',locale:'en'},expectedVersion:(await current()).version}),failure(409,'approval_required'));await assert.rejects(contentPreviewResponse(previewRequest(capability.url),capability.url.split('/').at(-1)),failure(404));assert.equal(await live(restored.id),undefined);
  await patch(restored.id,{status:'review'});await assert.rejects(reviewWorkspaceContent(a,{bucket:'pages',id:restored.id,locale:'en',expectedVersion:(await current()).version}),failure(403));await ready(restored.id);assert.ok(await live(restored.id));assert.ok((await getWorkspacePageRevisions(a,restored.id,'en')).revisions[0].approved_by);
 });
 await t.test('An archived source cannot be revived or rolled back through generic content writes',async()=>{
  const id='LIFE-GENERIC-RESTORE';await create(id);const revision=(await getWorkspacePageRevisions(a,id,'en')).revisions[0];await lifecycle(id,'archive');const source=await page(id),w=await current();
  await assert.rejects(saveWorkspace(a,{state:{...w.state,pages:w.state.pages.map(row=>row.id===id?{...row,status:'draft'}:row)},locale:'en',expectedVersion:w.version}),failure(403));
  await assert.rejects(restoreWorkspaceRevision(a,{revisionId:revision.id,expectedUpdatedAt:source.updatedAt,expectedVersion:w.version}),failure(403));assert.equal((await page(id)).status,'archived');
 });
 await t.test('Never-published official page withdrawal survives archive and restore-to-draft in one language',async()=>{
  const id='site-about-en';await lifecycle(id,'archive');await lifecycle(id,'restore');let site=await getPublicSite();assert.ok(site.hiddenPageLocales.about.includes('en'));assert.equal(site.hiddenPageLocales.about.includes('fa'),false);
  await patch(id,{title:'Explicitly reviewed restored company page',summary:'Restored source reviewed for English',blocks:[{id:'body',type:'rich-text',title:'Company source',body:'This isolated acceptance content is now explicitly reviewed.'}],status:'review'});await ready(id);site=await getPublicSite();assert.equal(site.hiddenPageLocales.about?.includes('en')||false,false);
 });
 await t.test('Retained assets and pinned shared references survive recycle, draft restore and media deletion attempts',async()=>{
  const bytes=await sharp({create:{width:16,height:16,channels:3,background:'#23799c'}}).png().toBuffer();
  const asset=await storeAsset({ownerId:a.id,name:'retained-page-fixture.png',bytes,extension:'png',mimeType:'image/png',visibility:'public',scanStatus:'clean',metadata:{rights:true}}),url='/api/v1/media/'+asset.id+'/content';
  await create('LIFE-RETAINED-ASSET',{blocks:[{id:'image',type:'image',title:'Retained actual image',body:'Immutable page reference',mediaUrl:url}]});await ready('LIFE-RETAINED-ASSET');await lifecycle('LIFE-RETAINED-ASSET','delete');
  const http=await fixtureHttpSession(a),denied=await http.request('/media/'+asset.id,{method:'DELETE'});assert.equal(denied.status,409);const problem=await denied.json();assert.equal(problem.error.code,'ASSET_IN_USE');assert.equal(JSON.stringify(problem).includes('LIFE-RETAINED-ASSET'),false);
  assert.equal(createHash('sha256').update(await readFile(join(storage,asset.storage_key))).digest('hex'),asset.sha256);assert.equal((await query('SELECT deleted_at FROM assets WHERE id=$1',[asset.id])).rows[0].deleted_at,null);
  await lifecycle('LIFE-RETAINED-ASSET','restore');assert.equal((await page('LIFE-RETAINED-ASSET')).blocks[0].mediaUrl,url);await assert.rejects(deleteMedia(a,asset.id),failure(409,'ASSET_IN_USE'));
  const saved=await page('LIFE-RETAINED-ASSET'),shared=await createSharedBlock(a,{name:'Retained page image library',pageId:saved.id,instanceId:'image',expectedVersion:(await current()).version}),lease=await acquireContentLease(a,{bucket:'pages',id:saved.id,clientId:randomUUID(),expectedUpdatedAt:saved.updatedAt});
  await attachSharedBlock(a,shared.block.id,{revisionId:shared.revision.id,pageId:saved.id,replaceInstanceId:'image',expectedVersion:(await current()).version},[lease.token]);const pinned=(await page(saved.id)).blocks[0];assert.ok(pinned.shared);await lifecycle(saved.id,'delete',a,[lease.token]);await lifecycle(saved.id,'restore');assert.deepEqual((await page(saved.id)).blocks[0],pinned);assert.equal((await query('SELECT asset_id FROM shared_block_asset_refs WHERE revision_id=$1',[shared.revision.id])).rows[0].asset_id,asset.id);
  const unreferenced=await storeAsset({ownerId:a.id,name:'unreferenced-control.png',bytes,extension:'png',mimeType:'image/png',visibility:'public',scanStatus:'clean',metadata:{rights:true}});assert.equal((await deleteMedia(a,unreferenced.id)).ok,true);
 });
 await t.test('Page lifecycle never deletes collected form answers or the retained page form schema',async()=>{
  const formId='FORM-PAGE-RETENTION';await saveWorkspaceForm(a,null,{id:formId,value:{title:localized('Retained answers form'),fields:[{id:'name',type:'text',required:true,label:localized('Name')}]},expectedVersion:(await current()).version});const form=(await current()).state.forms.find(row=>row.id===formId);
  // An isolated historical response fixture, not a claimed public submission flow.
  const responses=[{id:'retained-response',at:new Date().toISOString(),values:{name:'Non-personal test response'}}];await query("UPDATE workspace_entities SET data=jsonb_set(data,'{responses}',$2::jsonb) WHERE bucket='forms' AND id=$1",[formId,JSON.stringify(responses)]);
  const schema={id:form.id,title:form.title,fields:form.fields,version:form.version};await create('LIFE-RETAINED-FORM',{blocks:[{id:'form',type:'form',title:'Retained form schema',body:'Saved form',formId,formSchema:schema}]});await lifecycle('LIFE-RETAINED-FORM','delete');await lifecycle('LIFE-RETAINED-FORM','restore');assert.deepEqual((await page('LIFE-RETAINED-FORM')).blocks[0].formSchema,schema);assert.deepEqual((await query("SELECT data->'responses' AS responses FROM workspace_entities WHERE bucket='forms' AND id=$1",[formId])).rows[0].responses,responses);
 });
 await t.test('Restore refuses a conflicting retained path and current account revocation takes effect immediately',async()=>{
  await create('LIFE-PATH-A',{slug:'life-shared-path'});await lifecycle('LIFE-PATH-A','delete');await create('LIFE-PATH-B',{slug:'life-shared-path'});await assert.rejects(lifecycle('LIFE-PATH-A','restore'),failure(409,'PAGE_SLUG_IN_USE'));assert.equal((await getWorkspacePage(a,'LIFE-PATH-A')).item.status,'deleted');
  const captured=await input('LIFE-PATH-B','archive',b);await query("UPDATE users SET role='customer' WHERE id=$1",[b.id]);try{await assert.rejects(changeWorkspacePageLifecycle(b,'LIFE-PATH-B',captured),failure(403));}finally{await query("UPDATE users SET role='admin' WHERE id=$1",[b.id]);}
 });
 await t.test('HTTP lifecycle, recycle directory and revision detail preserve CSRF and MFA boundaries',async()=>{
  const id='LIFE-HTTP';await create(id);const http=await fixtureHttpSession(a),body=await input(id,'delete');const denied=await http.request('/workspace/pages/'+id+'/lifecycle',{method:'POST',body,headers:{'x-csrf-token':'wrong','idempotency-key':randomUUID()}});assert.equal(denied.status,403);assert.equal((await page(id)).status,'draft');
  const result=await http.request('/workspace/pages/'+id+'/lifecycle',{method:'POST',body,headers:{'idempotency-key':randomUUID()}});assert.equal(result.status,200);assert.equal((await result.json()).state.pages.some(row=>row.id===id),false);
  const directory=await http.request('/workspace/pages?status=deleted&locale=en&limit=100');assert.equal(directory.status,200);assert.ok((await directory.json()).items.some(item=>item.page.id===id&&item.status==='deleted'));
  const revisions=await http.request('/workspace/pages/'+id+'/revisions?locale=en');assert.equal(revisions.status,200);const revision=(await revisions.json()).revisions[0];assert.equal((await http.request('/workspace/revisions/'+revision.id)).status,200);
  const noMfa=await fixtureHttpSession(a,{mfa:false});assert.equal((await noMfa.request('/workspace/pages/'+id)).status,403);
 });
}));
