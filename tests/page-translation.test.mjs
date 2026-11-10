import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {createPageTranslationDraft,isPageTranslationStructure}=await loadTs('src/lib/page-translation.ts');
const {createSiteDraft}=await loadTs('src/lib/site-content.ts');
const original=createSiteDraft('home','fa','publisher','first-author');
const translate=source=>createPageTranslationDraft(source,{id:'target-en',locale:'en',author:'translator',authorId:'translation-author',updatedAt:'2026-10-20T00:00:00Z'});

test('a new locale retains the exact template structure with empty pending text and no inherited release state',()=>{
 const source={...original,status:'published',approvedBy:'publisher',approvedById:'reviewer',scheduledAt:'2030-01-01T00:00:00Z',previous:{title:original.title,summary:original.summary,blocks:original.blocks,version:1}};
 const before=structuredClone(source),target=translate(source);
 assert.deepEqual(source,before);assert.equal(target.locale,'en');assert.equal(target.title,'');assert.equal(target.summary,'');assert.equal(target.status,'draft');assert.equal(target.version,1);
 for(const key of ['approvedBy','approvedById','scheduledAt','previous'])assert.equal(target[key],undefined,key);
 assert.equal(isPageTranslationStructure(source,target),true);
 for(const [index,block]of target.blocks.entries()){
  assert.equal(block.id,source.blocks[index].id);assert.equal(block.title,'');assert.equal(block.body,'');assert.equal(block.link,source.blocks[index].link);assert.equal(block.mediaUrl,source.blocks[index].mediaUrl);
  assert.equal(block.options?.ctaLabel,undefined);assert.equal(block.options?.secondaryLabel,undefined);
 }
 target.blocks[0].options.visual='image';assert.equal(source.blocks[0].options.visual,'scene');
});

test('translation creation cannot smuggle layout, media, links, product selection or shared capabilities',()=>{
 for(const mutate of [page=>page.blocks.reverse(),page=>page.blocks[0].id='other-template',page=>page.blocks[0].type='form',page=>page.blocks[0].link='/en/admin/',page=>page.blocks[0].mediaUrl='/api/private',page=>page.blocks[0].options.productIds=['private-product'],page=>page.blocks[0].formId='private-form',page=>page.blocks[0].shared={id:'forged'},page=>page.slug='private-replacement']){
  const target=translate(original);mutate(target);assert.equal(isPageTranslationStructure(original,target),false);
 }
 const target=translate(original);target.title='Human translation';target.summary='Reviewed separately';target.blocks[0].title='English heading';target.blocks[0].body='English content';target.blocks[0].options.ctaLabel='Explore';assert.equal(isPageTranslationStructure(original,target),true);
});

test('translation detaches shared source bindings and cannot reuse the source page identity or locale',()=>{
 const source=structuredClone(original);source.blocks[0].shared={blockId:'source-shared',revisionId:'revision'};
 const target=translate(source);assert.equal(target.blocks[0].shared,undefined);assert.equal(isPageTranslationStructure(source,target),true);
 assert.throws(()=>createPageTranslationDraft(original,{id:original.id,locale:'en',author:'translator',updatedAt:original.updatedAt}));
 assert.throws(()=>createPageTranslationDraft(original,{id:'new',locale:'fa',author:'translator',updatedAt:original.updatedAt}));
});
