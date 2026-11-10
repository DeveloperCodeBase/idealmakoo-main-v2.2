import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const {sourceRouteMetadata,publicationMetadataDescription,resourceMetadataTitle}=await loadTs('src/lib/source-route-metadata.ts');
const {translate}=await loadTs('src/lib/i18n.ts');
const {createSiteDraft}=await loadTs('src/lib/site-content.ts');
const {resources,articles}=await loadTs('src/data/catalog.ts');
const locales=['fa','en','tr','ar','ru'];
const purposes=['compare','cooperation','cooperation/distribution','cooperation/suppliers','cooperation/outsourcing','cooperation/investment','cooperation/research','distributors','careers/apply','factory-visit','inquiry-list','install','quality-report','sample-request','support','technical-selection','resources/official-site-archive','for/dentist','for/lab','for/dealer','for/research','products','products/category/teeth','products/category/materials','blog','knowledge','videos','media'];

for(const locale of locales){
 test(`${locale}: distinct public operations have meaningful, unique descriptions without the contact default`,()=>{
  const descriptions=purposes.map(path=>{
   const value=sourceRouteMetadata(path,locale);
   assert.ok(value.title.trim(),path);
   assert.ok(value.description.length>35,path);
   assert.notEqual(value.description,translate(locale,'ctaText'),path);
   if(!['fa','ar'].includes(locale))assert.doesNotMatch(value.title+value.description,/[\u0600-\u06ff]/u,path);
   return value.description;
  });
  assert.equal(new Set(descriptions).size,purposes.length);
 });
 test(`${locale}: cooperation, journal and media metadata distinguish independent destinations`,()=>{
  const paths=['cooperation','cooperation/distribution','cooperation/suppliers','cooperation/outsourcing','cooperation/investment','cooperation/research','blog','knowledge','videos','media'];
  assert.equal(new Set(paths.map(path=>sourceRouteMetadata(path,locale).title)).size,paths.length);
 });
 test(`${locale}: only the original unedited audience summary receives a purposeful metadata fallback`,()=>{
  for(const path of ['for/dentist','for/lab','for/dealer','for/research']){
   const page={...createSiteDraft(path,locale,'source'),kind:'page'};
   assert.equal(page.summary,translate(locale,'ctaText'),'fixture is the actual retained source default');
   assert.equal(publicationMetadataDescription(page,path,locale),sourceRouteMetadata(path,locale).description);
   for(const customized of [
    {...page,summary:'The editor’s own reviewed description'},
    {...page,id:'independently-authored-page'},
    {...page,kind:'article'},
    {...page,locale:locale==='en'?'fa':'en'},
   ])assert.equal(publicationMetadataDescription(customized,path,locale),customized.summary);
   assert.equal(publicationMetadataDescription(page,'different-page',locale),page.summary);
  }
  assert.equal(publicationMetadataDescription(undefined,'for/dentist',locale),undefined);
 });
 test(`${locale}: research source images identify their format and never duplicate article titles`,()=>{
  const images=resources.filter(resource=>resource.type==='research'&&resource.format==='JPG');
  assert.ok(images.length>0);
  const articleTitles=new Set(articles.map(article=>article.title[locale]));
  for(const resource of images){
   const title=resourceMetadataTitle(resource,locale);
   assert.ok(title.includes(resource.title[locale]));
   assert.notEqual(title,resource.title[locale]);
   assert.equal(articleTitles.has(title),false);
  }
  for(const resource of resources.filter(resource=>resource.type!=='research'||resource.format!=='JPG'))assert.equal(resourceMetadataTitle(resource,locale),resource.title[locale]);
 });
}
