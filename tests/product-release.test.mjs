import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {products}=await loadTs('src/data/catalog.ts');
const {createProductDraft}=await loadTs('src/components/workspace/product-editor-data.ts');
const {createProductRelease,parseProductRelease,exportProductRelease}=await loadTs('src/lib/product-release.ts');
const product=products[0];

test('release copies only authored public fields and is independent of subsequent autosave edits',()=>{
 const draft=createProductDraft(product);draft.localized.fa.fullDescription='متن تألیف‌شده';draft.author='private-author';draft.price=900;draft.availability='InStock';draft.variants.push({id:'authored-test',sku:'AUTHOR-TEST',shade:'A1',mould:'N2',unit:'set',unitsPerPack:'۱۲',arch:'upper',position:'anterior',sourceUrl:product.sourceUrl,price:99,supplyStatus:'active'});
 const sourceBefore=structuredClone(product);const release=createProductRelease(draft,product);draft.localized.fa.fullDescription='later unsent text';draft.variants[0].sku='later-unsent-code';
 assert.equal(release.localized.fa.fullDescription,'متن تألیف‌شده');assert.equal(release.variants[0].sku,'AUTHOR-TEST');assert.equal(release.variants[0].unitsPerPack,'۱۲');assert.equal('author'in release,false);assert.equal('lifecycleStatus'in release,false);assert.equal('price'in release,false);assert.equal('availability'in release,false);assert.equal('price'in release.variants[0],false);assert.equal('supplyStatus'in release.variants[0],false);assert.equal('seoTitle'in release.localized.fa,false);assert.deepEqual(product,sourceBefore);
});

test('all 17 source products yield snapshots with five languages without inventing variants or typed classifications',()=>{
 for(const p of products){const release=createProductRelease(createProductDraft(p),p);assert.deepEqual(release.variants,[]);assert.equal(release.technical.materialClass,'');assert.equal(release.technical.category,'');for(const locale of ['fa','en','tr','ar','ru'])assert.equal(release.localized[locale].title,p.name[locale]);assert.deepEqual(parseProductRelease(release,p),release);}
});

test('product mismatches, partial malformed snapshots and unsafe media fail closed',()=>{
 const draft=createProductDraft(product),valid=createProductRelease(draft,product);assert.throws(()=>createProductRelease(draft,products[1]),/productId/);assert.equal(parseProductRelease(valid,products[1]),null);
 for(const bad of [null,[],{...valid,revision:NaN},{...valid,localized:{fa:{title:'partial'}}},{...valid,variants:[null]},{...valid,gallery:[{...valid.gallery[0],url:'javascript:alert(1)'}]},{...valid,technical:{...valid.technical,materialClass:'invented'}},{...valid,downloads:[{...valid.downloads[0],url:'//elsewhere.test/file.pdf'}]}])assert.equal(parseProductRelease(bad,product),null);
 const tampered={...valid,originalSourceUrl:'https://malicious.test'};assert.equal(parseProductRelease(tampered,product).originalSourceUrl,product.sourceUrl);
});

test('review submission rejects invalid editor IDs, ambiguous numeric specs and duplicate variant tuples',()=>{
 const draft=createProductDraft(product);draft.specifications.push({id:'invalid-number',key:'invalid-number',label:{...product.name},type:'number',value:{...product.name},numberValue:'3 seconds',unit:'s',sourceUrl:''});assert.throws(()=>createProductRelease(draft,product),/invalid_number/);draft.specifications.pop();
 const variant={id:'one',sku:'one',shade:'A1',mould:'N2',unit:'set',unitsPerPack:'',arch:'',position:'',sourceUrl:''};draft.variants=[variant,{...variant,id:'two',sku:'two',shade:' a۱ ',mould:'n۲'}];assert.throws(()=>createProductRelease(draft,product),/duplicate_variant/);draft.variants=[];draft.sourceUrl='javascript:alert(1)';assert.throws(()=>createProductRelease(draft,product),/invalid_url/);
});

test('export contains canonical provenance and strips injected commerce, markup objects and mutable workspace state',()=>{
 const release=createProductRelease(createProductDraft(product),product);release.offers={price:12};release.reviewedBy='not-a-verifier';release.localized.en.fullDescription='<img src=x onerror=alert(1)>';
 const exported=JSON.parse(exportProductRelease(release,product));assert.equal(exported.provenance.scope,'local_reviewed_content');assert.equal(exported.provenance.factoryVerified,false);assert.equal(exported.provenance.publicOfficialSourceChanged,false);assert.equal('offers'in exported.productRelease,false);assert.equal('reviewedBy'in exported.productRelease,false);assert.equal(exported.productRelease.localized.en.fullDescription,'<img src=x onerror=alert(1)>');assert.throws(()=>exportProductRelease({},product),/Invalid product release/);
});
