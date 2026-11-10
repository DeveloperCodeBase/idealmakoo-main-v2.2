import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withCrmRecoveryDatabase,fixtureActor,insertActor} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {getWorkspace,saveWorkspace} from '../src/server/workspace.ts';
import {createPageTranslationDraft,isPageTranslationStructure} from '../src/lib/page-translation.ts';
import {HttpError} from '../src/server/types.ts';

const denied=error=>error instanceof HttpError&&error.status===403;

test('A translator creates an independent empty locale draft from existing structure without inheriting source text or authority',{timeout:180000},async t=>withCrmRecoveryDatabase('page_translation',async()=>{
 const author=fixtureActor('translation-page-author','contentEditor'),translator=fixtureActor('translation-page-target','translator',{allowedLocales:['en'],qualityScope:false});
 for(const actor of[author,translator])await insertActor(actor);
 let current=await getWorkspace(author);
 const original={...structuredClone(current.state.pages.find(page=>page.slug==='about'&&page.locale==='fa')),id:'translation-source-'+randomUUID(),slug:'translation-page-'+randomUUID(),author:author.role,authorId:author.id,status:'draft'};
 current=await saveWorkspace(author,{state:{...current.state,pages:[...current.state.pages,original]},locale:'fa',expectedVersion:current.version});
 const source=current.state.pages.find(page=>page.id===original.id);
 const make=(locale='en')=>createPageTranslationDraft(source,{id:'translation-target-'+randomUUID(),locale,author:translator.role,authorId:translator.id,updatedAt:new Date().toISOString()});
 async function add(target){const before=await getWorkspace(translator);return saveWorkspace(translator,{state:{...before.state,pages:[...before.state.pages,target]},locale:target.locale,expectedVersion:before.version});}

 await t.test('Out-of-scope language, changed routing, block identities, links and direct review creation are rejected without mutation',async()=>{
  const before=await getWorkspace(author);
  for(const change of[
   target=>({...target,locale:'tr'}),target=>({...target,slug:'new-route-'+randomUUID()}),target=>({...target,status:'review'}),
   target=>({...target,blocks:target.blocks.map((block,index)=>index?block:{...block,id:'different-template-block'})}),
   target=>({...target,blocks:target.blocks.map((block,index)=>index?block:{...block,link:'/products/'})}),
   target=>({...target,blocks:target.blocks.map((block,index)=>index?block:{...block,formId:'another-form'})}),
  ])await assert.rejects(add(change(make())),denied);
  const after=await getWorkspace(author);assert.equal(after.version,before.version);assert.deepEqual(after.state.pages,before.state.pages);
 });

 let targetId;
 await t.test('A valid target retains template identity but starts with blank local text and no source review, schedule or shared capability',async()=>{
  const draft=make();targetId=draft.id;assert.equal(isPageTranslationStructure(source,draft),true);assert.equal(draft.title,'');assert.equal(draft.summary,'');
  for(const block of draft.blocks){assert.equal(block.title,'');assert.equal(block.body,'');assert.equal(block.shared,undefined);assert.equal(block.options?.ctaLabel,undefined);assert.equal(block.options?.secondaryLabel,undefined);}
  const saved=await add(draft),target=saved.state.pages.find(page=>page.id===draft.id);assert.equal(target.locale,'en');assert.equal(target.status,'draft');assert.equal(target.authorId,translator.id);assert.equal(target.approvedById,undefined);assert.equal(target.scheduledAt,undefined);assert.equal(target.previous,undefined);assert.equal(target.title,'');assert.equal(target.summary,'');assert.deepEqual(target.blocks,draft.blocks);
  assert.deepEqual((await getWorkspace(author)).state.pages.find(page=>page.id===source.id),source,'Reading a Persian source does not grant permission to change it');
 });

 await t.test('The target can receive only localized text while source language and structure remain protected',async()=>{
  const before=await getWorkspace(translator),draft=before.state.pages.find(page=>page.id===targetId);
  const localized={...draft,title:'Independent English draft',summary:'Human-authored English summary',blocks:draft.blocks.map(block=>({...block,title:'English section',body:'Independent English content'}))};
  const saved=await saveWorkspace(translator,{state:{...before.state,pages:before.state.pages.map(page=>page.id===targetId?localized:page)},locale:'en',expectedVersion:before.version});assert.equal(saved.state.pages.find(page=>page.id===targetId).title,localized.title);
  const current=await getWorkspace(translator),changed={...current.state,pages:current.state.pages.map(page=>page.id===targetId?{...page,blocks:page.blocks.map((block,index)=>index?block:{...block,link:'/requests/contact/'})}:page)};
  await assert.rejects(saveWorkspace(translator,{state:changed,locale:'en',expectedVersion:current.version}),denied);
  const sourceEdit={...current.state,pages:current.state.pages.map(page=>page.id===source.id?{...page,title:'Source language overwrite'}:page)};
  await assert.rejects(saveWorkspace(translator,{state:sourceEdit,locale:'fa',expectedVersion:current.version}),denied);
  assert.deepEqual((await getWorkspace(author)).state.pages.find(page=>page.id===source.id),source);
 });

 await t.test('The structural translation helper cannot grant legal-page authority',async()=>{
  const current=await getWorkspace(author),legal=current.state.pages.find(page=>page.slug==='privacy'&&page.locale==='fa');
  // Make the locale genuinely absent in this isolated fixture. The separate
  // legal-authority suite covers retained published/archived locale variants.
  await query("DELETE FROM workspace_entities WHERE bucket='pages' AND id=$1",[current.state.pages.find(page=>page.slug==='privacy'&&page.locale==='en').id]);
  const target=createPageTranslationDraft(legal,{id:'legal-target-'+randomUUID(),locale:'en',author:translator.role,authorId:translator.id,updatedAt:new Date().toISOString()});
  await assert.rejects(add(target),error=>denied(error)&&error.code==='PAGE_ADMIN_REQUIRED');
 });
}));
