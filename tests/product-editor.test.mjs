import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {products}=await loadTs('src/data/catalog.ts');
const {createProductDraft,readProductDraft,validateProductDraft,exportProductEntity,editorNumber,safeEditorUrl}=await loadTs('src/components/workspace/product-editor-data.ts');
const teeth=products.find(p=>p.family==='teeth');const material=products.find(p=>p.family==='materials');
const variant=(patch={})=>({id:'variant-one',sku:'TEST-SKU-1',shade:'A1',mould:'N2',unit:'set',unitsPerPack:'',arch:'',position:'',sourceUrl:'',...patch});
const readyTeeth=()=>{const draft=createProductDraft(teeth);draft.lifecycleStatus='active';draft.technical.materialClass='Nano_Composite';return draft;};

test('all 17 source drafts start with no inferred variants, taxonomy or lifecycle and retain the five source languages',()=>{
 for(const product of products){const before=structuredClone(product),draft=createProductDraft(product);assert.deepEqual(draft.variants,[]);assert.equal(draft.lifecycleStatus,'');assert.equal(draft.technical.materialClass,'');assert.equal(draft.technical.curingMethod,'');for(const locale of ['fa','en','tr','ar','ru']){assert.equal(draft.localized[locale].title,product.name[locale]);assert.equal(draft.material[locale],product.material[locale]);}assert.deepEqual(product,before);}
});

test('numbers preserve unknown as null and zero as zero while rejecting nonfinite or ambiguous input',()=>{
 assert.deepEqual(editorNumber(''),{value:null,valid:true});assert.deepEqual(editorNumber('0'),{value:0,valid:true});assert.deepEqual(editorNumber(' ۱۲٫۵ '),{value:12.5,valid:true});assert.deepEqual(editorNumber('-٢'),{value:-2,valid:true});
 for(const invalid of ['NaN','Infinity','0x10','1,234','3 seconds','1e309'])assert.equal(editorNumber(invalid).valid,false);
});

test('duplicate SKU and shade–mould–unit tuples are detected across case, whitespace and Persian digits',()=>{
 const draft=readyTeeth();draft.variants=[variant(),variant({id:'variant-two',sku:'other',shade:' a۱ ',mould:'n۲',unit:' SET '})];assert.ok(validateProductDraft(draft).some(i=>i.code==='duplicate_variant'));
 draft.variants[1]={...draft.variants[1],shade:'A3',sku:' test-sku-1 '};assert.ok(validateProductDraft(draft).some(i=>i.code==='duplicate_sku'));
 draft.variants[1]={...draft.variants[1],sku:'other',shade:'A1',mould:'N2',unit:'pack'};assert.equal(validateProductDraft(draft).some(i=>i.code.startsWith('duplicate')),false);
});

test('fractional or negative pack quantities, invalid technical numbers and tooth fields on materials are rejected',()=>{
 const draft=readyTeeth();for(const value of ['0','-1','1.5','unknown']){draft.variants=[variant({unitsPerPack:value})];assert.ok(validateProductDraft(draft).some(i=>i.code==='positive_integer'));}
 draft.variants=[variant({unitsPerPack:'۲۴'})];assert.equal(validateProductDraft(draft).some(i=>i.code==='positive_integer'),false);draft.family='materials';assert.ok(validateProductDraft(draft).some(i=>i.code==='family_variant'));
 draft.family='teeth';draft.technical.layerCount='2.5';assert.ok(validateProductDraft(draft).some(i=>i.path==='technical.layerCount'));
});

test('a complete ProductEntity needs explicit taxonomy choices while an incomplete local draft remains representable',()=>{
 const draft=createProductDraft(teeth);assert.equal(validateProductDraft(draft).filter(i=>i.severity==='error').length,0);assert.throws(()=>exportProductEntity(draft),/lifecycleStatus/);draft.lifecycleStatus='active';assert.throws(()=>exportProductEntity(draft),/materialClass/);
});

test('teeth mapping preserves raw source material, typed rows, authored material translations and unreviewed variant provenance',()=>{
 const original=structuredClone(teeth);const draft=readyTeeth();draft.material.fa='شرح تألیف‌شده';draft.variants=[variant({unitsPerPack:'۱۲'})];draft.technical.layerCount='۴';draft.technical.availableShades='A1, A2';draft.technical.mouldCodes='N2\nN3';draft.specifications.push({id:'numeric-one',key:'measurement',label:{fa:'اندازه',en:'Measure',tr:'Ölçü',ar:'قياس',ru:'Размер'},type:'number',value:{fa:'',en:'',tr:'',ar:'',ru:''},numberValue:'',unit:'mm',sourceUrl:''});
 const output=exportProductEntity(draft);assert.equal(output.entity.family,'artificial_teeth');assert.equal(output.entity.specs.layerCount,4);assert.equal(output.entity.specs.rawLegacyMaterialNote,teeth.material.en);assert.deepEqual(output.entity.specs.availableShades,['A1','A2']);assert.deepEqual(output.entity.specs.mouldCodes,['N2','N3']);assert.equal(output.specificationRows.at(-1).value,null);assert.equal(output.materialDescription.fa,'شرح تألیف‌شده');assert.equal(output.entity.variants[0].supplyStatus,'paused');assert.equal(output.variantDetails[0].unitsPerPack,12);assert.equal(output.variantDetails[0].verification,'unreviewed');assert.equal(output.provenance.publicTechnicalDataChanged,false);assert.equal(output.entity.localized.fa.isPublished,false);assert.deepEqual(teeth,original);
});

test('materials mapping uses the material branch, preserves unknown times and exports linked gallery/resources separately',()=>{
 const draft=createProductDraft(material);draft.lifecycleStatus='paused';Object.assign(draft.technical,{category:'acid_etch',curingMethod:'non_curing_gel',deliveryForm:'syringe',quantityUnit:'g'});const output=exportProductEntity(draft);
 assert.equal(output.entity.specs.family,'dental_materials');assert.equal(output.entity.specs.curingTimeSeconds,null);assert.equal(output.entity.specs.etchingTimeSeconds,null);assert.equal('toothPosition' in output.entity.specs,false);assert.equal(output.gallery[0].isPrimary,true);assert.deepEqual(output.entity.resourceIds,draft.downloads.map(d=>d.id));assert.equal(output.resources[0].sourceUrl,material.downloads[0].sourceUrl);
});

test('malformed persisted shapes and unsafe media URLs cannot break draft hydration or export',()=>{
 for(const value of [null,[],{schemaVersion:1,productId:'unknown'}])assert.equal(readProductDraft(value,teeth).productId,teeth.id);
 const parsed=readProductDraft({...createProductDraft(teeth),localized:{fa:{title:42}},variants:[null,{id:'one',sku:5}],gallery:'bad'},teeth);assert.equal(typeof parsed.localized.fa.title,'string');assert.equal(parsed.variants[0].sku,'');assert.ok(Array.isArray(parsed.gallery));
 assert.equal(safeEditorUrl('javascript:alert(1)',true),false);assert.equal(safeEditorUrl('//untrusted.test/image.jpg',true),false);assert.equal(safeEditorUrl('/media/official/logo.png',true),true);assert.equal(safeEditorUrl('https://idealmakoo.com/pages/3/products'),true);
 const draft=readyTeeth();draft.gallery[0].url='javascript:alert(1)';assert.throws(()=>exportProductEntity(draft),/invalid_url/);
});
