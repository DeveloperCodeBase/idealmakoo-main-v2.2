import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTs} from './helpers/load-ts.mjs';

const {products,articles,companyPages,resources}=await loadTs('src/data/catalog.ts');
const {normalizeComparisonIds,buildComparisonRows,comparisonRowDiffers}=await loadTs('src/lib/catalog-logic.ts');
const {parsePublications,applyPublishedProduct,applyPublishedArticle}=await loadTs('src/lib/publications.ts');
const root=fileURLToPath(new URL('../',import.meta.url));
const locales=['fa','en','tr','ar','ru'];
const teeth=products.filter(p=>p.family==='teeth');
const materials=products.filter(p=>p.family==='materials');
const publication=(patch={})=>({id:teeth[0].id,slug:teeth[0].slug,kind:'product',locale:'fa',title:'عنوان محلی محصول',summary:'خلاصه محلی برای پیش‌نمایش',body:'Local editorial body',blocks:[],publishedAt:'2026-10-17T10:00:00.000Z',version:1,...patch});

test('the required official archive contains 17 products, 13 research entries and 10 company pages',()=>{
 assert.equal(products.length,17);assert.equal(teeth.length,13);assert.equal(materials.length,4);
 assert.equal(articles.length,13);assert.equal(companyPages.length,10);
 for(const collection of [products,articles,companyPages,resources]){
  assert.equal(new Set(collection.map(item=>item.id)).size,collection.length);
  assert.equal(new Set(collection.map(item=>item.slug)).size,collection.length);
  for(const item of collection)assert.equal(new URL(item.sourceUrl).hostname,'idealmakoo.com');
 }
});

test('factory product labels and source specifications are populated in all five locales',()=>{
 for(const product of products)for(const locale of locales){
  for(const value of [product.name,product.description,product.material,...product.features,...product.specs.flatMap(s=>[s.label,s.value])])assert.ok(value[locale]?.trim(),`${product.id}: missing ${locale}`);
 }
 for(const item of [...articles,...companyPages])for(const locale of locales)assert.ok(item.title[locale]?.trim());
});

test('download assets are genuine local image files with an official source, not renamed PDF placeholders',()=>{
 assert.equal(resources.length,30);
 const assets=new Set([...products.flatMap(p=>[p.image,...p.gallery,...p.downloads.map(d=>d.url)]),...articles.map(a=>a.image).filter(Boolean),...resources.map(r=>r.url)]);
 for(const resource of resources){assert.equal(resource.format,'JPG');assert.match(resource.url,/\.jpg$/i);}
 for(const asset of assets){
  assert.match(asset,/^\/media\/official\/[^/]+\.(jpe?g|png)$/i);
  const file=resolve(root,'public',asset.slice(1));assert.ok(existsSync(file),`Missing ${asset}`);
  const bytes=readFileSync(file);const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  assert.ok(jpeg||png,`Invalid image header: ${asset}`);
 }
});

test('comparison ignores malformed, unknown, duplicate and mixed-family IDs while preserving selection order',()=>{
 assert.deepEqual(normalizeComparisonIds(null),[]);assert.deepEqual(normalizeComparisonIds({ids:[teeth[0].id]}),[]);
 const input=['unknown',teeth[0].id,teeth[0].id,null,materials[0].id,...teeth.slice(1).map(p=>p.id)];
 const before=structuredClone(input);
 assert.deepEqual(normalizeComparisonIds(input),teeth.slice(0,4).map(p=>p.id));
 assert.deepEqual(input,before);
 assert.deepEqual(normalizeComparisonIds([materials[0].id,teeth[0].id,materials[1].id]),[materials[0].id,materials[1].id]);
});

test('comparison includes the complete union of documented specifications and identifies equal rows in every locale',()=>{
 for(const locale of locales){
  const selected=teeth.slice(0,4);const rows=buildComparisonRows(selected,locale);
  const expectedLabels=new Set(selected.flatMap(p=>p.specs.map(s=>s.label.en.trim().toLowerCase())).filter(label=>label!=='material'));
  assert.equal(rows.filter(row=>row.key.startsWith('spec:')).length,expectedLabels.size);
  assert.ok(rows.every(row=>row.values.length===selected.length&&row.label));
  assert.equal(rows.find(row=>row.key==='family').values.length,4);
  assert.equal(comparisonRowDiffers(rows.find(row=>row.key==='family')),false);
  const identical=buildComparisonRows([teeth[0],{...teeth[0],id:'same-specifications'}],locale);
  assert.deepEqual(identical.filter(comparisonRowDiffers),[]);
 }
 const allMaterialRows=buildComparisonRows(materials,'en');
 assert.ok(allMaterialRows.some(comparisonRowDiffers));
 assert.ok(allMaterialRows.some(row=>row.values.includes('Not published in the source')),'Missing specifications must be explicit, never inferred');
});

test('publication parsing rejects non-arrays, wrong locales and non-string identities without trusting unknown fields',()=>{
 for(const value of [null,{},'text',42])assert.deepEqual(parsePublications(value),[]);
 const valid=publication({specs:[{value:'fabricated'}],blocks:[null,{}, {type:'text',id:'one',title:'Title',body:'Body',link:'https://idealmakoo.com/'}, {type:1}],version:2.8});
 const parsed=parsePublications([null,publication({locale:'xx'}),publication({title:{html:'unsafe'}}),valid]);
 assert.equal(parsed.length,1);assert.equal(parsed[0].version,2);assert.equal(parsed[0].blocks.length,1);
 assert.equal(parsed[0].blocks[0].body,'Body');assert.equal('specs' in parsed[0],false);
});

test('legacy title-and-summary publications keep technical source data until a reviewed product release exists',()=>{
 const source=teeth[0];const before=structuredClone(source);const entry=publication();
 const result=applyPublishedProduct(source,[entry],'fa');
 assert.equal(result.name.fa,entry.title);assert.equal(result.description.fa,entry.summary);
 assert.equal(result.name.en,source.name.en);assert.equal(result.description.en,source.description.en);
 for(const field of ['specs','features','material','image','gallery','sourceUrl','downloads'])assert.equal(result[field],source[field],`Unexpected technical override: ${field}`);
 assert.equal(result.sourceName,source.name);assert.equal(result.sourceDescription,source.description);assert.equal(result.localPublication,entry);
 assert.deepEqual(source,before);
 assert.equal(applyPublishedProduct(source,[entry],'en'),source);
 assert.equal(applyPublishedProduct(source,[publication({id:'unknown',slug:'unknown'})],'fa'),source);
});

test('stable slugs, current versions and repeat overlays preserve the original source labels',()=>{
 const source=teeth[0];const old=publication({id:'cms-record',slug:`product/${source.slug}`,title:'Old title',version:1,publishedAt:'2026-10-16T10:00:00Z'});
 const latest=publication({id:'cms-record',slug:source.slug,title:'Latest title',version:3});
 const result=applyPublishedProduct(source,[old,latest],'fa');
 assert.equal(result.name.fa,'Latest title');
 const twice=applyPublishedProduct(result,[latest],'fa');assert.equal(twice.sourceName.fa,source.name.fa);assert.equal(twice.name.fa,'Latest title');
 const reverted=applyPublishedProduct(result,[],'fa');assert.equal(reverted,source);
 const blank=applyPublishedProduct(source,[publication({title:'  ',summary:'  '})],'fa');assert.equal(blank.name.fa,source.name.fa);assert.equal(blank.description.fa,source.description.fa);
});

test('research overlays keep the original Persian body, citation title, date and document image',()=>{
 const source=articles[0];const entry=publication({id:source.id,slug:source.slug,kind:'research',locale:'en',title:'Local research title',summary:'Local research summary',body:'Unverified replacement body'});
 const result=applyPublishedArticle(source,[entry],'en');
 assert.equal(result.title.en,entry.title);assert.equal(result.excerpt.en,entry.summary);
 assert.equal(result.sourceTitle,source.title);assert.equal(result.sourceExcerpt,source.excerpt);
 for(const field of ['body','image','sourceUrl','language','publishedAt','topic'])assert.equal(result[field],source[field]);
 assert.equal(result.title.fa,source.title.fa);assert.equal(applyPublishedArticle(source,[entry],'fa'),source);
});
