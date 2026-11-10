import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {products}=await loadTs('src/data/catalog.ts');
const {createProductDraft}=await loadTs('src/components/workspace/product-editor-data.ts');
const {createProductRelease,parseProductRelease}=await loadTs('src/lib/product-release.ts');
const {productFromRelease,releaseSpecificationRows}=await loadTs('src/lib/product-release-catalog.ts');
const {parsePublications,applyPublishedProduct,catalogFromPublications,publishedProductLanguages,getPublishedProductInventory}=await loadTs('src/lib/publications.ts');
const {createCustomProduct,productPath,localizedPath}=await loadTs('src/lib/custom-products.ts');
const locales=['fa','en','tr','ar','ru'];
const local=value=>Object.fromEntries(locales.map(locale=>[locale,value]));
const source=products[0];
const publication=(product,release,patch={})=>({id:product.id,slug:product.slug,kind:'product',locale:'fa',title:release?.localized.fa.title||product.name.fa,summary:release?.localized.fa.shortDescription||'',body:'',blocks:[],publishedAt:'2026-10-17T13:00:00Z',version:2,...(release?{productRelease:release}:{}),...patch});
function customFixture(){const definition=createCustomProduct({id:'custom-editor-test',slug:'editor-test',brand:'EDITOR TEST',family:'teeth',title:'محصول آزمایشی پنل',locale:'fa'});const draft=createProductDraft(definition);draft.localized.fa.shortDescription='خلاصه تألیف‌شده';return {definition,draft,release:createProductRelease(draft,definition)};}

test('reviewed publication drives actual brand, family, material, image, gallery, features, specifications and downloads while preserving the canonical source',()=>{
 const draft=createProductDraft(source),before=structuredClone(source);draft.brand='REVIEW TEST';draft.slug='reviewed-editorial-name';draft.productCode='REVIEW-001';draft.family='materials';draft.material=local('Reviewed material');draft.localized.fa.title='عنوان بازبینی‌شده';draft.localized.fa.shortDescription='خلاصه بازبینی‌شده';draft.localized.fa.benefits='ویژگی اول\nویژگی دوم';draft.gallery=[{id:'review-image',url:products[1].image,alt:local('Reviewed image'),sourceUrl:source.sourceUrl}];draft.specifications=[{id:'review-spec',key:'review-spec',label:local('Reviewed specification'),type:'text',value:local('Reviewed value'),numberValue:'',unit:'',sourceUrl:source.sourceUrl}];draft.downloads=[{id:'review-file',url:products[1].image,label:local('Reviewed file'),sourceUrl:source.sourceUrl,format:'JPG',language:'fa'}];
 const release=createProductRelease(draft,source),entry=parsePublications([publication(source,release)])[0],visible=applyPublishedProduct(source,[entry],'fa');
 assert.equal(visible.brand,draft.brand);assert.equal(visible.slug,draft.slug);assert.equal(visible.family,'materials');assert.equal(visible.name.fa,draft.localized.fa.title);assert.equal(visible.description.fa,draft.localized.fa.shortDescription);assert.equal(visible.material.fa,'Reviewed material');assert.equal(visible.image,products[1].image);assert.deepEqual(visible.gallery,[products[1].image]);assert.deepEqual(visible.features.map(row=>row.fa),['ویژگی اول','ویژگی دوم']);assert.equal(visible.specs[0].value.fa,'Reviewed value');assert.equal(visible.downloads[0].url,products[1].image);
 assert.equal(visible.sourceProduct,source);assert.equal(visible.sourceUrl,source.sourceUrl);assert.equal(visible.sourceName,source.name);assert.equal(visible.sourceDescription,source.description);assert.equal(visible.name.en,source.name.en);assert.deepEqual(source,before);
 assert.equal(productPath(visible),`products/${source.slug}`);assert.equal(applyPublishedProduct(visible,[],'fa'),source);assert.deepEqual(applyPublishedProduct(visible,[entry],'fa').specs,visible.specs);
});

test('intentional empty reviewed lists remove visible source data and use a neutral image placeholder without erasing the source archive',()=>{
 const draft=createProductDraft(source);draft.gallery=[];draft.downloads=[];draft.specifications=[];for(const locale of locales)draft.localized[locale].benefits='';draft.localized.fa.shortDescription='';const release=createProductRelease(draft,source),entry=parsePublications([publication(source,release)])[0],visible=applyPublishedProduct(source,[entry],'fa');
 assert.deepEqual(visible.gallery,[]);assert.deepEqual(visible.downloads,[]);assert.deepEqual(visible.specs,[]);assert.deepEqual(visible.features,[]);assert.equal(visible.description.fa,'');assert.equal(visible.image,'/media/brand/product-placeholder.svg');assert.equal(visible.sourceProduct.gallery,source.gallery);assert.equal(visible.sourceProduct.downloads,source.downloads);
});

test('reviewed typed specifications retain zero, unknown numbers and localized labels without inventing variants',()=>{
 const draft=createProductDraft(source);draft.technical.layerCount='۴';draft.technical.arch=['upper'];draft.specifications=[{id:'zero',key:'zero',label:local('Zero value'),type:'number',value:local('ignored'),numberValue:'۰',unit:'mm',sourceUrl:''},{id:'unknown',key:'unknown',label:local('Unknown value'),type:'number',value:local('ignored'),numberValue:'',unit:'mm',sourceUrl:''}];const release=createProductRelease(draft,source),rows=releaseSpecificationRows(release);
 assert.equal(rows.find(row=>row.label.en==='Arch').value.ar,'علوي');assert.equal(rows.find(row=>row.label.en==='Zero value').value.en,'0 mm');assert.equal(rows.find(row=>row.label.en==='Unknown value').value.en,'');assert.deepEqual(release.variants,[]);
 for(const locale of locales)assert.ok(rows.every(row=>row.label[locale].trim()));
});

test('review snapshots survive authorized record IDs distinct from the product when the stable product slug matches',()=>{
 const release=createProductRelease(createProductDraft(source),source);const [valid]=parsePublications([publication(source,release,{id:'workspace-product-record'})]);assert.equal(valid.id,'workspace-product-record');assert.equal(valid.productRelease.productId,source.id);assert.ok(applyPublishedProduct(source,[valid],'fa').localPublication);
 const [invalid]=parsePublications([publication(source,release,{id:'unrelated-record',slug:products[1].slug})]);assert.equal(invalid.productRelease,undefined);
 const [wrongKind]=parsePublications([publication(source,release,{kind:'news'})]);assert.equal(wrongKind.productRelease,undefined);
});

test('older reviewed snapshots remain compatible while new identifying fields are strictly validated',()=>{
 const release=createProductRelease(createProductDraft(source),source),legacy={...release};for(const key of ['brand','slug','productCode','authoredSourceUrl'])delete legacy[key];const parsed=parseProductRelease(legacy,source);assert.equal(parsed.brand,source.brand);assert.equal(parsed.slug,source.slug);assert.equal(parsed.productCode,source.id);assert.equal(parsed.authoredSourceUrl,source.sourceUrl);
 for(const patch of [{brand:''},{brand:[]},{slug:'../wrong'},{productCode:{}},{authoredSourceUrl:'javascript:alert(1)'}])assert.equal(parseProductRelease({...release,...patch},source),null);
});

test('a manually created definition appears only after a matching valid reviewed publication in that locale',()=>{
 const {definition,release}=customFixture();assert.equal(definition.sourceUrl,'');assert.equal(release.originalSourceUrl,'');assert.equal(release.authoredSourceUrl,'');
 assert.equal(catalogFromPublications([], 'fa').length,17);assert.equal(catalogFromPublications(parsePublications([publication(definition,undefined,{customProduct:definition})]),'fa').length,17);
 const all=parsePublications([publication(definition,release,{id:'workspace-manual-record',customProduct:definition})]);const catalog=catalogFromPublications(all,'fa'),visible=catalog.find(product=>product.id===definition.id);assert.equal(catalog.length,18);assert.equal(visible.origin,'editor');assert.equal(visible.sourceUrl,'');assert.equal(visible.name.fa,release.localized.fa.title);assert.equal(catalogFromPublications(all,'en').length,17);assert.equal(products.some(product=>product.id===definition.id),false);
 assert.equal(localizedPath('fa',productPath(visible)),`/fa/products/detail/?id=${definition.id}`);
});

test('malformed custom definitions, mismatched identities and invalid releases never add a public product',()=>{
 const {definition,release}=customFixture();const candidates=[publication(definition,release,{customProduct:{...definition,family:['teeth']}}),publication(definition,release,{customProduct:{...definition,image:'javascript:alert(1)'}}),publication(definition,{...release,productId:source.id},{customProduct:definition}),publication(definition,release,{id:'unrelated-record',slug:'unrelated-slug',customProduct:definition}),publication(definition,{...release,gallery:[{id:'bad',url:'javascript:alert(1)',alt:local('bad'),sourceUrl:''}]},{customProduct:definition})];
 for(const entry of candidates)assert.equal(catalogFromPublications(parsePublications([entry]),'fa').length,17);
});

test('duplicate publications select one newest reviewed custom definition and do not accept a later snapshot-free replacement',()=>{
 const {definition,release}=customFixture();const first=publication(definition,release,{customProduct:definition,version:1,publishedAt:'2026-10-17T12:00:00Z'}),second=publication(definition,{...release,revision:2},{id:'record-second',customProduct:definition,title:'آخرین نسخه',version:2}),unreviewed=publication(definition,undefined,{customProduct:definition,title:'Unreviewed replacement',publishedAt:'2026-10-17T15:00:00Z',version:3});
 const catalog=catalogFromPublications(parsePublications([first,second,unreviewed]),'fa');assert.equal(catalog.length,18);assert.equal(catalog.find(product=>product.id===definition.id).name.fa,'آخرین نسخه');assert.equal(new Set(catalog.map(product=>product.id)).size,catalog.length);
});

test('cross-locale inventory retains valid manual products and the newest reviewed canonical values after localStorage reload',()=>{
 const {definition,release}=customFixture();const canonicalDraft=createProductDraft(source);canonicalDraft.brand='LATEST INVENTORY';const canonicalRelease=createProductRelease(canonicalDraft,source);const entries=[publication(definition,release,{customProduct:definition}),publication(source,canonicalRelease,{locale:'en',title:canonicalRelease.localized.en.title,summary:canonicalRelease.localized.en.shortDescription,publishedAt:'2026-10-17T14:00:00Z'})];
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 try{Object.defineProperty(globalThis,'window',{configurable:true,value:{}});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify(entries)}});const inventory=getPublishedProductInventory();assert.equal(inventory.length,18);assert.ok(inventory.some(product=>product.id===definition.id));assert.equal(inventory.find(product=>product.id===source.id).brand,'LATEST INVENTORY');assert.equal(new Set(inventory.map(product=>product.id)).size,18);}
 finally{if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete globalThis.window;if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete globalThis.localStorage;}
});

test('corrupt releases leave the visible source product unchanged',()=>{assert.equal(productFromRelease(source,{schemaVersion:1,productId:source.id},'fa'),source);});

test('a missing custom-product translation offers only published language choices without changing its active-locale URL',()=>{
 const {definition,release}=customFixture();
 const all=parsePublications([publication(definition,release,{customProduct:definition}),publication(definition,undefined,{customProduct:definition,locale:'en',title:'Unreviewed English'})]);
 const before=structuredClone(all),choices=publishedProductLanguages(definition.id,all);
 assert.deepEqual(choices.map(choice=>choice.locale),['fa']);
 assert.equal(choices[0].product.name.fa,release.localized.fa.title);
 for(const locale of locales){assert.equal(localizedPath(locale,productPath(choices[0].product)),`/${locale}/products/detail/?id=${definition.id}`);if(locale!=='fa')assert.equal(catalogFromPublications(all,locale).some(product=>product.id===definition.id),false);}
 assert.deepEqual(publishedProductLanguages('custom-does-not-exist',all),[]);
 assert.deepEqual(publishedProductLanguages(source.id,all).map(choice=>choice.locale),locales);
 assert.deepEqual(all,before);
});

test('reviewed product identity survives a changed published slug and a distinct CMS record ID',()=>{
 const draft=createProductDraft(source);draft.slug='reviewed-product-canonical-path';draft.localized.en.title='Reviewed product path';draft.localized.en.shortDescription='Approved canonical product slug.';
 const release=createProductRelease(draft,source),entry=parsePublications([publication(source,release,{id:'CMS-product-document',slug:release.slug,locale:'en',title:draft.localized.en.title,summary:draft.localized.en.shortDescription})])[0];
 assert.equal(entry.productRelease?.productId,source.id);
 const visible=catalogFromPublications([entry],'en').find(item=>item.id===source.id);
 assert.equal(visible.slug,release.slug);assert.equal(visible.localPublication.id,'CMS-product-document');assert.equal(visible.name.en,'Reviewed product path');
 const prior=process.env.NODE_ENV;
 try{process.env.NODE_ENV='production';assert.equal(productPath(visible),'products/reviewed-product-canonical-path');const {definition}=customFixture();assert.equal(productPath(definition),'products/editor-test');}
 finally{if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;}
});
