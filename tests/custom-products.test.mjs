import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {products}=await loadTs('src/data/catalog.ts');
const {createCustomProduct,parseCustomProduct,workspaceProducts,productPath,localizedPath,isCustomProductId}=await loadTs('src/lib/custom-products.ts');
const {createProductDraft,validateProductDraft,exportProductEntity,materialClasses}=await loadTs('src/components/workspace/product-editor-data.ts');
const {parseInquiryLines,parseFrontRequests}=await loadTs('src/lib/frontend-state.ts');
const {mergeInquiryLines}=await loadTs('src/components/account/portal-data.ts');
const definition=()=>createCustomProduct({id:'custom-product-one',slug:'new-factory-product',brand:'Entered brand',family:'teeth',title:'محصول واردشده',locale:'fa'});

test('manually created products preserve entered content without inventing translations or source claims',()=>{
 const product=definition();
 assert.equal(product.origin,'editor');
 assert.equal(product.name.fa,'محصول واردشده');
 assert.equal(product.name.en,'');
 assert.equal(product.sourceUrl,'');
 assert.deepEqual(product.specs,[]);
 assert.deepEqual(product.features,[]);
 assert.equal(products.length,17);
});

test('custom definition parsing rejects source impersonation, malformed families and active URLs',()=>{
 const source=definition();
 for(const patch of [{id:products[0].id},{origin:'official'},{family:['teeth']},{family:'unknown'},{image:'javascript:alert(1)'},{sourceUrl:'https:\\example.test/x'},{image:'/media/../private.png'},{sourceUrl:'https://user:password@example.test'},{name:{fa:'Only one key'}},{slug:'bad/slug'}]) {
  assert.equal(parseCustomProduct({...source,...patch}),null,JSON.stringify(patch));
 }
 assert.equal(isCustomProductId('custom-valid-id'),true);
 assert.equal(isCustomProductId('unregistered'),false);
 const parsed=parseCustomProduct({...source,secretToken:'do not carry',price:123});
 assert.equal('secretToken' in parsed,false);
 assert.equal('price' in parsed,false);
 parsed.name.fa='Changed';
 assert.notEqual(source.name.fa,parsed.name.fa);
});

test('workspace product inventory includes one valid manual definition without modifying the official catalogue',()=>{
 const product=definition();
 const result=workspaceProducts([{collection:'products',details:{customProduct:product}},{collection:'products',details:{customProduct:product}},{collection:'leads',details:{customProduct:{...product,id:'custom-ignored'}}}]);
 assert.equal(result.length,18);
 assert.equal(result.at(-1).id,product.id);
 assert.equal(products.length,17);
});

test('manual product editor permits an unknown source while retaining taxonomy gates for entity export',()=>{
 const draft=createProductDraft(definition());
 assert.equal(validateProductDraft(draft).filter(issue=>issue.severity==='error').length,0);
 assert.throws(()=>exportProductEntity(draft),/required/);
 draft.lifecycleStatus='active';draft.technical.materialClass=materialClasses[0];
 const result=exportProductEntity(draft);
 assert.equal(result.entity.legacyId,null);
 assert.equal(result.provenance.originalSourceUrl,'');
 assert.equal(result.entity.id,'custom-product-one');
 assert.equal(result.provenance.verification,'unreviewed');
});

test('custom inquiry lines survive reload only when the caller supplies a validated published inventory',()=>{
 const product=definition(),rows=[{productId:product.id,quantity:3,shade:'A2',mould:'N6',note:undefined}];
 assert.deepEqual(parseInquiryLines(rows),[]);
 assert.deepEqual(parseInquiryLines(rows,[...products,product]),rows);
 const request={id:'R1',kind:'rfq',name:'A',email:'a@example.test',createdAt:'2026-01-01',items:rows};
 assert.deepEqual(parseFrontRequests([request],[...products,product])[0].items,rows);
 assert.deepEqual(parseInquiryLines([{...rows[0],productId:'custom-not-published'}],[...products,product]),[]);
});

test('canonical product paths stay stable and custom query IDs are never changed by locale formatting',()=>{
 const original=products[0],manual=definition();
 assert.equal(productPath({...original,slug:'edited-slug'}),`products/${original.slug}`);
 assert.equal(localizedPath('fa',productPath(manual)),'/fa/products/detail/?id=custom-product-one');
 assert.equal(localizedPath('en','page/?id=PAGE-1#block-2'),'/en/page/?id=PAGE-1#block-2');
 assert.equal(localizedPath('ar','products'),'/ar/products/');
 assert.equal(localizedPath('tr',''),'/tr/');
});

test('authored SKU and unit identity prevents two requested variants from merging',()=>{
 const first={productId:'custom-product-one',quantity:2,shade:'A2',mould:'N6',variantId:'variant-pack',sku:'SKU-PACK',unit:'pack'};
 const second={...first,quantity:3,variantId:'variant-piece',sku:'SKU-PIECE',unit:'piece'};
 const lines=mergeInquiryLines([first],[second,{...first,quantity:4}]);
 assert.equal(lines.length,2);
 assert.equal(lines[0].quantity,6);
 assert.equal(lines[1].quantity,3);
 const restored=parseInquiryLines(lines,[definition()]);
 assert.equal(restored[0].variantId,'variant-pack');
 assert.equal(restored[1].sku,'SKU-PIECE');
 assert.equal(restored[1].unit,'piece');
});
