import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withCrmRecoveryDatabase,fixtureActor,insertActor} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';
import {getWorkspace,saveWorkspace,reviewWorkspaceContent,publishWorkspace,scheduleWorkspaceContent,runScheduledWorkspacePublications,unpublishWorkspace,getWorkspaceRevisions,restoreWorkspaceRevision,getSitePreferences,saveSitePreferences} from '../src/server/workspace.ts';
import {getWorkspacePage,changeWorkspacePageLifecycle} from '../src/server/page-lifecycle.ts';
import {acquireContentLease} from '../src/server/content-collaboration.ts';

const failure=(status,code)=>error=>error instanceof HttpError&&error.status===status&&(!code||error.code===code);
const admin=fixtureActor('policy-owner','superAdmin'),reviewer=fixtureActor('policy-reviewer','admin'),editor=fixtureActor('policy-editor','contentEditor'),publisher=fixtureActor('policy-publisher','publisher');
const current=(actor=admin)=>getWorkspace(actor);
async function patch(actor,id,change){const snapshot=await current(actor);return saveWorkspace(actor,{state:{...snapshot.state,pages:snapshot.state.pages.map(page=>page.id===id?{...page,...change}:page)},locale:'fa',expectedVersion:snapshot.version});}
async function lifecycle(actor,id,operation){const view=await getWorkspacePage(actor,id);return changeWorkspacePageLifecycle(actor,id,{operation,reason:'Explicit isolated policy regression action',expectedVersion:view.version,expectedPageVersion:view.item.page.version,expectedUpdatedAt:view.item.page.updatedAt});}

test('Public site policy: protected legal pages and administrator-only descriptive copy/SEO',{timeout:180000},async t=>withCrmRecoveryDatabase('site_policy',async()=>{
 for(const actor of[admin,reviewer,editor,publisher])await insertActor(actor);const seed=await current();
 const legal=seed.state.pages.find(page=>page.slug==='privacy'&&page.locale==='fa'),ordinary=seed.state.pages.find(page=>page.slug==='about'&&page.locale==='fa');assert.ok(legal);assert.ok(ordinary);
 await t.test('Editors cannot create, rewrite or rename into or away from privacy/terms; ordinary content remains editable',async()=>{
  const snapshot=await current(editor);
  await assert.rejects(patch(editor,legal.id,{title:'Unauthorized policy wording'}),failure(403,'PAGE_ADMIN_REQUIRED'));
  await assert.rejects(patch(editor,legal.id,{slug:'renamed-policy'}),failure(403,'PAGE_ADMIN_REQUIRED'));
  await assert.rejects(patch(editor,ordinary.id,{slug:'terms'}),failure(403,'PAGE_ADMIN_REQUIRED'));
  await assert.rejects(saveWorkspace(editor,{state:{...snapshot.state,pages:[...snapshot.state.pages,{...legal,id:'new-protected-'+randomUUID(),slug:'terms'}]},locale:'fa',expectedVersion:snapshot.version}),failure(403,'PAGE_ADMIN_REQUIRED'));
  await patch(editor,ordinary.id,{summary:'ویرایش مجاز محتوای عمومی در آزمون مستقل.'});assert.equal((await getWorkspacePage(editor,ordinary.id)).item.page.summary,'ویرایش مجاز محتوای عمومی در آزمون مستقل.');
  const view=await getWorkspacePage(editor,legal.id);assert.equal(view.item.capabilities.edit,false);assert.equal(view.item.capabilities.archive,false);assert.equal(view.item.capabilities.delete,false);
  await assert.rejects(acquireContentLease(editor,{bucket:'pages',id:legal.id,clientId:randomUUID(),expectedUpdatedAt:view.item.page.updatedAt}),failure(403));
 });
 await t.test('Only current administrators can review, publish, withdraw, archive and restore protected source pages',async()=>{
  await patch(admin,legal.id,{title:'سیاست حریم خصوصی — آزمون مستقل',summary:'متن نمونه آزمون در پایگاه‌داده موقت.',blocks:[{id:'privacy-regression-body',type:'rich-text',title:'اطلاع‌رسانی آزمون',body:'این متن فقط در آزمون مستقل ذخیره می‌شود.'}],status:'review'});
  await assert.rejects(reviewWorkspaceContent(publisher,{bucket:'pages',id:legal.id,locale:'fa',expectedVersion:(await current()).version}),failure(403));
  await reviewWorkspaceContent(reviewer,{bucket:'pages',id:legal.id,locale:'fa',expectedVersion:(await current()).version});
  await assert.rejects(publishWorkspace(publisher,{publication:{id:legal.id,kind:'page',locale:'fa'},expectedVersion:(await current()).version}),failure(403,'PAGE_ADMIN_REQUIRED'));
  await assert.rejects(scheduleWorkspaceContent(publisher,{bucket:'pages',id:legal.id,locale:'fa',scheduledAt:new Date(Date.now()+600000).toISOString(),expectedVersion:(await current()).version}),failure(403,'PAGE_ADMIN_REQUIRED'));
  await publishWorkspace(admin,{publication:{id:legal.id,kind:'page',locale:'fa'},expectedVersion:(await current()).version});
  await assert.rejects(unpublishWorkspace(publisher,{slug:'privacy',locale:'fa',kind:'page',expectedVersion:(await current()).version}),failure(403,'PAGE_ADMIN_REQUIRED'));
  await assert.rejects(lifecycle(editor,legal.id,'archive'),failure(403,'PAGE_ADMIN_REQUIRED'));
  const revisions=await getWorkspaceRevisions(admin,{bucket:'pages',id:legal.id,locale:'fa'}),revision=revisions.revisions.at(-1);
  await assert.rejects(restoreWorkspaceRevision(editor,{revisionId:revision.id,expectedVersion:(await current()).version,expectedUpdatedAt:(await getWorkspacePage(admin,legal.id)).item.page.updatedAt}),failure(403,'PAGE_ADMIN_REQUIRED'));
  await lifecycle(admin,legal.id,'archive');await assert.rejects(lifecycle(editor,legal.id,'restore'),failure(403,'PAGE_ADMIN_REQUIRED'));await lifecycle(admin,legal.id,'restore');
  assert.equal((await getWorkspacePage(admin,legal.id)).item.page.status,'draft');
 });
 await t.test('A scheduled protected release fails closed after the scheduling administrator loses settings authority',async()=>{
  await patch(admin,legal.id,{status:'review'});await reviewWorkspaceContent(reviewer,{bucket:'pages',id:legal.id,locale:'fa',expectedVersion:(await current()).version});
  await scheduleWorkspaceContent(admin,{bucket:'pages',id:legal.id,locale:'fa',scheduledAt:new Date(Date.now()+600000).toISOString(),expectedVersion:(await current()).version});
  await query("UPDATE workspace_publish_jobs SET due_at=now()-interval '1 minute' WHERE document_id=$1 AND status='pending'",[legal.id]);
  await query("UPDATE users SET role='publisher' WHERE id=$1",[admin.id]);
  try{const result=await runScheduledWorkspacePublications();assert.equal(result.published,0);const job=(await query("SELECT status,error FROM workspace_publish_jobs WHERE document_id=$1 ORDER BY due_at DESC LIMIT 1",[legal.id])).rows[0];assert.equal(job.status,'failed');assert.match(job.error,/administrative settings/);}finally{await query("UPDATE users SET role='superAdmin' WHERE id=$1",[admin.id]);}
  assert.equal((await query('SELECT 1 FROM locale_releases WHERE document_id=$1 AND unpublished_at IS NULL',[legal.id])).rowCount,0);
 });
 await t.test('Only valid administrator copy and SEO overrides are stored; menus and old clients preserve current settings',async()=>{
  const before=await getSitePreferences(admin),value={...before.published,uiText:{fa:{heroTitle:'عنوان کنترل‌شده وب‌سایت'}},seo:{products:{fa:{title:'فهرست محصولات',description:'توضیح قابل ویرایش برای فهرست محصولات.',noindex:false}}}};
  const saved=await saveSitePreferences(admin,{value,mode:'settings',publish:true,expectedVersion:before.version});assert.deepEqual(saved.published.uiText,value.uiText);assert.deepEqual(saved.published.seo,value.seo);
  await assert.rejects(saveSitePreferences(editor,{value,mode:'settings',publish:true,expectedVersion:saved.version}),failure(403));
  const injected={...value,uiText:{fa:{heroTitle:'Injected by menu-only account'}},seo:{products:{fa:{title:'Injected',description:'Injected',noindex:true}}}};
  const menus=await saveSitePreferences(editor,{value:injected,mode:'menus',publish:true,expectedVersion:saved.version});assert.deepEqual(menus.published.uiText,value.uiText);assert.deepEqual(menus.published.seo,value.seo);
  for(const forged of [{...value,uiText:{fa:{privacy:'Unauthorized legal override'}}},{...value,uiText:{fa:{authLogin:'Unauthorized action override'}}},{...value,seo:{'auth/login':{fa:{title:'Login',description:'Login',noindex:false}}}},{...value,uiText:{de:{heroTitle:'Unsupported language'}}}])await assert.rejects(saveSitePreferences(admin,{value:forged,mode:'settings',publish:true,expectedVersion:menus.version}),failure(422));
  const {uiText,seo,...legacy}=value;const kept=await saveSitePreferences(admin,{value:legacy,mode:'settings',publish:true,expectedVersion:menus.version});assert.deepEqual(kept.published.uiText,uiText);assert.deepEqual(kept.published.seo,seo);
  await query("UPDATE users SET allowed_locales='[\"fa\"]'::jsonb WHERE id=$1",[reviewer.id]);await assert.rejects(saveSitePreferences(reviewer,{value,mode:'settings',publish:true,expectedVersion:kept.version}),failure(403));
 });
}));
