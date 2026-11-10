import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url);
const {sourceFaqQuestions}=await loadTs('src/data/faq-content.ts');
const {createSiteDraft}=await loadTs('src/lib/site-content.ts');
const {localizedPath}=await loadTs('src/lib/locale-routing.ts');
const {translate}=await loadTs('src/lib/i18n.ts');
const {carouselUrl}=await loadTs('src/lib/carousel.ts');
const {company,companyPages,products}=await loadTs('src/data/catalog.ts');
const {companySourceDraft,sourceBlockRows}=await loadTs('src/lib/company-source-drafts.ts');
const {companyPageCopy}=await loadTs('src/data/company-page-copy.ts');
const emptyIcon=()=>null;
function actualFunction(file,name,context,variables=[]){
 const source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn,`Render the actual ${file}:${name}`);
 const declarations=source.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>variables.includes(value.name.getText(source))));assert.equal(declarations.length,variables.length);
 const code=declarations.map(node=>node.getText(source)).join('\n')+'\nexport const probe='+fn.getText(source).replace(/^export\s+/,'');
 const exports={};runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require,...context});return exports.probe;
}
function faq(publications,locale='en'){
 const Component=actualFunction('src/components/site/Tools.tsx','FaqPage',{useApp:()=>({locale,t:key=>translate(locale,key),href:path=>localizedPath(locale,path)}),usePublications:()=>publications,sourceFaqQuestions,carouselUrl,Link:props=>createElement('a',props),ChevronDown:emptyIcon,ArrowUpRight:emptyIcon,PublicationBlocks:({blocks})=>createElement('section',{'data-custom-block':blocks[0].id},blocks[0].body)});
 return renderToStaticMarkup(createElement(Component));
}
function blocks(blocks,locale='en'){
 const Component=actualFunction('src/components/site/PublicationRenderer.tsx','PublicationBlocks',{useApp:()=>({locale,t:key=>translate(locale,key),href:path=>localizedPath(locale,path)}),useCatalogProducts:()=>[],usePublications:()=>[],carouselUrl,ArrowUpRight:emptyIcon,Download:emptyIcon},['safeLink','safeMedia']);
 return renderToStaticMarkup(createElement(Component,{blocks}));
}

test('publishing the original FAQ draft preserves exactly the original FAQ DOM in every language',()=>{
 for(const locale of ['fa','en','tr','ar','ru']){const source=createSiteDraft('faq',locale,'source');assert.equal(faq([{...source,kind:'page'}],locale),faq([],locale));}
});
test('the real FAQ renderer honors edited hero text, hidden and removed hero, and keeps question visibility independent',()=>{
 const source={...createSiteDraft('faq','en','source'),kind:'page'};source.blocks[0]={...source.blocks[0],title:'Edited FAQ heading',body:'Edited English introduction.'};source.blocks[2].hidden=true;
 const rendered=faq([source,{...source,id:'foreign',locale:'fa',blocks:[{id:'faq-hero',type:'hero',title:'متن فارسی',body:'نباید وارد شود'}]}]);
 assert.match(rendered,/<h1>Edited FAQ heading<\/h1>/);assert.match(rendered,/<p>Edited English introduction\.<\/p>/);assert.doesNotMatch(rendered,/متن فارسی|نباید وارد شود/);assert.equal((rendered.match(/<details>/g)||[]).length,3);
 source.blocks[0].hidden=true;assert.doesNotMatch(faq([source]),/page-intro|Edited FAQ heading|Edited English introduction/);assert.equal((faq([source]).match(/<details>/g)||[]).length,3);
 source.blocks=source.blocks.slice(1);assert.doesNotMatch(faq([source]),/page-intro|<h1>/);
});
test('generic authored CTA labels and secondary links appear in the current language without changing default link styles',()=>{
 const base={id:'cta',type:'cta',title:'Content',body:'A reviewed introduction.',link:'/fa/contact/'};
 const fallback=blocks([base]);assert.match(fallback,/class="btn btn-primary" href="\/en\/contact\/"/);assert.match(fallback,new RegExp(translate('en','learnMore')));assert.equal((fallback.match(/<a /g)||[]).length,1);
 const edited=blocks([{...base,options:{ctaLabel:'Ask the factory',secondaryLabel:'Read source',secondaryLink:'https://example.test/reference.pdf?version=2#page=1'}}]);
 assert.match(edited,/>Ask the factory<\/a>/);assert.match(edited,/class="btn" href="https:\/\/example.test\/reference.pdf\?version=2#page=1">Read source<\/a>/);
 const empty=blocks([{...base,options:{ctaLabel:''}}]);assert.doesNotMatch(empty,new RegExp(translate('en','learnMore')),'An explicitly blank authored value must not silently become another label.');
 for(const unsafe of ['javascript:alert(1)','//evil.test/','/\\evil.test/','https://user:secret@example.test/'])assert.equal((blocks([{...base,link:unsafe,options:{secondaryLink:unsafe,secondaryLabel:'Unsafe'}}]).match(/<a /g)||[]).length,0,unsafe);
});
test('generic downloads localize page links while preserving actual document URLs and exposing the saved action label',()=>{
 const base={id:'download',type:'downloads',title:'Download',body:'',link:'/fa/resources/',options:{ctaLabel:'Open documents'}};
 assert.match(blocks([base]),/href="\/en\/resources\/" class="btn" target="_blank" rel="noreferrer">Open documents<\/a>/);
 for(const link of ['/media/documents/source.pdf','https://example.test/original.pdf?edition=2#page=4'])assert.ok(blocks([{...base,link}]).includes(`href="${link}"`));
 assert.match(blocks([{...base,options:{...base.options,secondaryLink:'/fa/contact/',secondaryLabel:'Contact'}}]),/href="\/en\/contact\/">Contact<\/a>/);
});

test('quality cards follow the actual optional group heading without changing their content or typography',()=>{
 const icons=Object.fromEntries(['ArrowUpRight','BookOpen','Building2','CheckCircle2','FileCheck2','FlaskConical','Globe2','Layers3','Leaf','MapPin','MessageSquare','Microscope','Move3D'].map(name=>[name,emptyIcon]));
 for(const locale of ['fa','en','tr','ar','ru']){
  let publications=[];
  const Component=actualFunction('src/components/content/CompanyContent.tsx','CompanyContent',{...icons,Fragment,company,companyPages,products,companySourceDraft,sourceBlockRows,carouselUrl,labels:companyPageCopy,useApp:()=>({locale,theme:'dark',t:key=>translate(locale,key),href:path=>localizedPath(locale,path)}),useSitePreferences:()=>({contact:{factoryAddress:{fa:'',en:'',tr:'',ar:'',ru:''}}}),usePublications:()=>publications,Link:props=>createElement('a',props),Paragraphs:({body})=>createElement('p',null,body),ContentIntro:({title,description})=>createElement('header',null,createElement('h1',null,title),createElement('p',null,description)),CompanyCertificates:emptyIcon,SourceLink:emptyIcon});
  const initial=renderToStaticMarkup(createElement(Component,{section:'quality'}));
  const draft=companySourceDraft('quality',locale),principles=draft.blocks.find(block=>block.id==='quality-principles');assert.ok(principles);assert.equal(principles.title,'');
  const cardTitles=sourceBlockRows(principles.body).map(row=>row[0]);assert.equal(cardTitles.length,3);
  for(const title of cardTitles)assert.ok(initial.includes(renderToStaticMarkup(createElement('h2',null,title))),`${locale}: a card directly below h1 is a level-two heading.`);
  assert.doesNotMatch(initial,/<h3>/);
  publications=[{...draft,kind:'page',locale,slug:'quality',blocks:draft.blocks.map(block=>block.id===principles.id?{...block,title:'Reviewed group heading'}:block)}];
  const grouped=renderToStaticMarkup(createElement(Component,{section:'quality'}));assert.match(grouped,/<h2>Reviewed group heading<\/h2>/);
  for(const title of cardTitles)assert.ok(grouped.includes(renderToStaticMarkup(createElement('h3',null,title))),`${locale}: an authored group heading correctly nests the same cards at level three.`);
  assert.equal((initial.match(/class="glass content-principle"/g)||[]).length,(grouped.match(/class="glass content-principle"/g)||[]).length,'The same card template remains intact.');
 }
 const css=readFileSync(new URL('../src/components/content/content.css',import.meta.url),'utf8');
 assert.match(css,/\.content-principle h2,\.content-principle h3\{font-size:1\.05rem;margin-block:0 12px\}/,'Both semantic levels retain the original explicit card font size and spacing.');
});
