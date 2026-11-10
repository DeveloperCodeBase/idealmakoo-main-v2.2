import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createElement,useEffect,useMemo,useRef,useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url);
const {products}=await loadTs('src/data/catalog.ts');
const {translate}=await loadTs('src/lib/i18n.ts');
const {localizedPath}=await loadTs('src/lib/locale-routing.ts');
const {normalizeComparisonIds}=await loadTs('src/lib/catalog-logic.ts');
const {isCustomProductId,productPath}=await loadTs('src/lib/custom-products.ts');
const {createDefaultSitePreferences}=await loadTs('src/lib/site-preferences.ts');
const {kindNames}=await loadTs('src/components/site/request-form-copy.ts');
const locales=['fa','en','tr','ar','ru'];
const nothing=()=>null;
const Link=props=>createElement('a',props);
const icons=Object.fromEntries(['ArrowUpRight','Bookmark','Check','GitCompareArrows','Plus','X','Grid2X2','Layers3','List','Search','SlidersHorizontal','CheckCircle2','ClipboardList','Copy','Download','FileText','ShieldCheck','Upload','Factory','Mail','MapPin','Phone'].map(name=>[name,nothing]));
function actualFunction(file,name,context,variables=[]){
 const source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn,`Use the real exported ${name}`);
 const declarations=source.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>variables.includes(value.name.getText(source))));assert.equal(declarations.length,variables.length);
 const code=declarations.map(node=>node.getText(source)).join('\n')+'\nexport const probe='+fn.getText(source).replace(/^export\s+/,'');
 const exports={};runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require,Link,...icons,useEffect,useMemo,useRef,useState,...context});return exports.probe;
}
const app=locale=>({locale,t:key=>translate(locale,key),href:path=>localizedPath(locale,path),catalog:products,inquiries:[],saved:['apple'],compare:['apple'],session:null,addInquiry:nothing,setInquiries:nothing,setCompare:nothing,toggleSaved:nothing,notify:nothing,createRequest:nothing});

test('lightweight public entry graphs exclude detail archives and unrelated request pages',async()=>{
 const result=await build({entryPoints:['src/components/site/Home.tsx','src/components/site/ProductCard.tsx','src/components/site/ProductCatalog.tsx','src/components/site/RequestForm.tsx','src/components/site/ContactPage.tsx','src/components/site/PublicationRenderer.tsx'],bundle:true,write:false,metafile:true,splitting:true,format:'esm',platform:'browser',outdir:'/tmp/idealmakoo-public-import-probe',logLevel:'silent',loader:{'.css':'empty'},external:['next','next/*','react','react/*','react-dom','react-dom/*']});
 const inputs=Object.keys(result.metafile.inputs).map(path=>path.replaceAll('\\','/'));
 for(const forbidden of ['src/components/site/Products.tsx','src/components/site/Requests.tsx','src/data/official-source-pages.ts','src/data/reference-documents.ts','src/components/tenders/TenderCenter.tsx'])assert.ok(!inputs.some(path=>path.endsWith(forbidden)),`The initial light entry graph must not regain ${forbidden}`);
 assert.ok(inputs.some(path=>path.endsWith('src/components/site/RequestForm.tsx')));
 assert.ok(inputs.some(path=>path.endsWith('src/components/site/ProductCard.tsx')));
});

test('the extracted product card retains localized links, media dimensions and saved/comparison state',()=>{
 for(const locale of locales){
  const Component=actualFunction('src/components/site/ProductCard.tsx','ProductCard',{useApp:()=>app(locale),usePublishedProduct:product=>product,normalizeComparisonIds,isCustomProductId,productPath,PublicImage:props=>createElement('img',props)},['L','labels']);
  const html=renderToStaticMarkup(createElement(Component,{product:products.find(product=>product.id==='apple')}));
  assert.ok(html.includes(`href="/${locale}/products/apple/"`));
  assert.match(html,/class="product-card glass "/);assert.match(html,/width="440" height="340"/);
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length,2,'Saved and comparison controls retain their active state.');
  assert.ok(html.includes(renderToStaticMarkup(createElement('h3',null,products.find(product=>product.id==='apple').name[locale]))));
 }
});

test('the extracted catalog keeps its family selection and original controls independently of product-detail code',()=>{
 for(const category of [undefined,'teeth','materials']){
  const Component=actualFunction('src/components/site/ProductCatalog.tsx','ProductCatalog',{useApp:()=>app('en'),useCatalogProducts:()=>products,ProductCard:({product})=>createElement('article',{'data-product-id':product.id}),CompareBar:nothing,EmptyState:nothing},['L','labels']);
  const html=renderToStaticMarkup(createElement(Component,{category}));
  const expected=products.filter(product=>!category||product.family===category);
  assert.equal((html.match(/data-product-id=/g)||[]).length,expected.length);
  for(const product of expected)assert.ok(html.includes(`data-product-id="${product.id}"`));
  assert.match(html,/class="catalog-filters glass"/);assert.match(html,/type="search"/);assert.match(html,/class="view-switch"/);
 }
});

test('the extracted request form preserves consent, request fields, upload capability and booking selection',()=>{
 for(const locale of locales)for(const canUploadAttachment of [false,true]){
  const Component=actualFunction('src/components/site/RequestForm.tsx','RequestForm',{useApp:()=>app(locale),useUploadPolicy:()=>({policy:{canUploadAttachment},error:''}),useExistingProductDisplay:catalog=>catalog,kindNames,demoMode:false,liveText:()=>'',mediaUploadAccept:'.pdf,.png',UploadPolicyHint:nothing,BookingReceipt:nothing,EventSlotPicker:({kind})=>createElement('div',{'data-booking-kind':kind}),eventText:key=>key});
  const html=renderToStaticMarkup(createElement(Component,{kind:'callback'}));
  assert.match(html,/type="checkbox" required=""/);assert.ok(html.includes(`href="/${locale}/privacy/"`));
  const email=html.match(/<input [^>]*name="email"[^>]*>/)?.[0];assert.ok(email);assert.match(email,/required=""/);assert.match(email,/type="email"/);
  assert.match(html,/minLength="10" maxLength="6000" required=""/);
  const upload=html.match(/<input type="file"[^>]*>/)?.[0];assert.ok(upload);assert.equal(upload.includes('disabled=""'),!canUploadAttachment);
  assert.doesNotMatch(html,/data-booking-kind=/);
  assert.match(renderToStaticMarkup(createElement(Component,{kind:'factory_visit'})),/data-booking-kind="factory_visit"/);
 }
});

test('the separate contact entry keeps the original template, support kind and current-locale managed hero',()=>{
 const preferences=createDefaultSitePreferences();
 for(const locale of locales){
  let publications=[];
  const Component=actualFunction('src/components/site/ContactPage.tsx','ContactPage',{useApp:()=>app(locale),useSitePreferences:()=>preferences,usePublicSiteSnapshot:()=>null,usePublications:()=>publications,isPublicPathVisible:()=>true,kindNames,PublicationBlocks:nothing,RequestForm:({kind})=>createElement('section',{'data-request-kind':kind})});
  const initial=renderToStaticMarkup(createElement(Component));
  assert.match(initial,/class="contact-layout"/);assert.match(initial,/class="contact-card contact-map"/);assert.match(initial,/data-request-kind="callback"/);
  assert.match(renderToStaticMarkup(createElement(Component,{support:true})),/data-request-kind="support_ticket"/);
  publications=[{kind:'page',locale,slug:'contact',blocks:[{id:'contact-hero',title:'Reviewed heading '+locale,body:'Reviewed introduction '+locale}]}];
  const edited=renderToStaticMarkup(createElement(Component));assert.ok(edited.includes(`<h1>Reviewed heading ${locale}</h1>`));assert.match(edited,/class="contact-layout"/);
 }
});
