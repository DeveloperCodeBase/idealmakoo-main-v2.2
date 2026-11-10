import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url);
const {articles}=await loadTs('src/data/catalog.ts');
const {officialSourcePages}=await loadTs('src/data/official-source-pages.ts');
const {referenceDocuments,referencePageUrl}=await loadTs('src/data/reference-documents.ts');
const {sourceContextForLocale}=await loadTs('src/lib/source-context.ts');
const {researchBodyForLocale}=await loadTs('src/lib/research-locale.ts');
const {researchBodyTranslations}=await loadTs('src/data/research-body-translations.ts');
const {localizedPath}=await loadTs('src/lib/locale-routing.ts');
const {translate}=await loadTs('src/lib/i18n.ts');
const {products}=await loadTs('src/data/catalog.ts');
const locales=['fa','en','tr','ar','ru'];
const blank=()=>null;
const L=(fa,en,tr,ar,ru)=>({fa,en,tr,ar,ru});
const textOnly=html=>html.replace(/<[^>]+>/g,'');
const escapeText=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#x27;');

function actualFunction(file,name,context,variables=[]){
 const source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn,`Render the actual ${file}:${name}`);
 const declarations=source.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>variables.includes(value.name.getText(source))));assert.equal(declarations.length,variables.length);
 const code=declarations.map(node=>node.getText(source)).join('\n')+'\nexport const probe='+fn.getText(source).replace(/^export\s+/,'');
 const exports={};runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require,...context});return exports.probe;
}
function context(locale){
 const app={locale,dir:['fa','ar'].includes(locale)?'rtl':'ltr',t:key=>translate(locale,key),href:path=>localizedPath(locale,path),notify:blank};
 const icons=Object.fromEntries(['Archive','ArrowUpRight','BookOpen','ChevronDown','ChevronLeft','ChevronRight','Copy','Download','ExternalLink','FileText','FlaskConical','Info','Languages','Layers3','Search','Share2','ZoomIn','ZoomOut'].map(key=>[key,blank]));
 return {...icons,L,useApp:()=>app,useContentText:()=>value=>value[locale],useMemo:fn=>fn(),useEffect:blank,useState:value=>[value,blank],Link:props=>createElement('a',props),ContentIntro:({title,description,children})=>createElement('header',null,createElement('h1',null,title),createElement('p',null,description),children),BackLink:blank,ContentSearch:blank,ContentEmpty:blank,ContentIntroUnused:blank,OfficialSourceArchiveLink:blank,ReferenceDocumentCards:blank,Carousel:blank,ImageFallback:props=>createElement('img',props),SourceLink:({url,children})=>createElement('a',{href:url},children),contentLabels:new Proxy({},{get:(_target,key)=>L(String(key),String(key),String(key),String(key),String(key))}),topicLabels:{wear:L('سایش','Wear','Aşınma','التآكل','Износ'),bond:L('اتصال','Bond','Bağ','الترابط','Соединение'),materials:L('مواد','Materials','Malzeme','المواد','Материалы')}};
}
function disclosure(locale){return actualFunction('src/components/content/OfficialSourceArchive.tsx','OfficialSourceDisclosure',{...context(locale),officialSourcePages,sourceContextForLocale},['labels']);}

test('all 43 original transcripts remain exact in Persian while four other locales receive labelled localized context and an explicit Persian source link',()=>{
 assert.equal(officialSourcePages.length,43);
 for(const locale of locales){const Component=disclosure(locale);for(const page of officialSourcePages){
  const rendered=renderToStaticMarkup(createElement(Component,{source:page,archive:true}));
  const localized=sourceContextForLocale(page,locale);assert.ok(localized.title&&localized.paragraphs.length,`${page.id}:${locale} has real context`);
  assert.match(rendered,/class="glass official-source-disclosure"/);assert.ok(rendered.includes(`id="${page.id}"`));assert.ok(rendered.includes(`href="${escapeText(page.url)}"`));
  if(locale==='fa')assert.ok(rendered.includes(escapeText(page.contentText||page.text)),page.id);
  else {assert.ok(rendered.includes(`href="/fa/resources/official-site-archive/#${page.id}"`));assert.ok(rendered.includes('hrefLang="fa"'));assert.ok(rendered.includes(escapeText(localized.paragraphs[0])));assert.ok(!rendered.includes(escapeText(page.contentText||page.text)),page.id);}
  if(['en','tr','ru'].includes(locale))assert.doesNotMatch(textOnly(rendered),/[\u0600-\u06ff]/,`${page.id}:${locale} has no Persian prose or labels`);
 }}
 const unknown={...officialSourcePages[0],id:'unknown-source',title:'عنوان فارسی',contentText:'متن اصلی فارسی',productId:undefined,articleId:undefined,companyPageId:undefined};
 for(const locale of locales.filter(value=>value!=='fa'))assert.deepEqual(sourceContextForLocale(unknown,locale).paragraphs,[],'Unknown target text never falls back to Persian.');
});

test('all thirteen actual research detail views render two faithful target-language body paragraphs, preserving the original Persian source separately',()=>{
 assert.deepEqual(Object.keys(researchBodyTranslations).sort(),articles.map(article=>article.id).sort());
 for(const article of articles){assert.deepEqual(researchBodyForLocale(article,'fa'),article.body);for(const locale of locales.filter(value=>value!=='fa')){
  const body=researchBodyForLocale(article,locale);assert.equal(body.length,article.body.length,`${article.id}:${locale}`);assert.ok(body.every(paragraph=>paragraph.length>35));assert.notDeepEqual(body,article.body);
 }}
 for(const locale of locales){
  const Component=actualFunction('src/components/content/ResearchCenter.tsx','ResearchCenter',{...context(locale),useCatalogArticles:()=>articles,usePublications:()=>[],researchBodyForLocale,OfficialSourceDisclosure:disclosure(locale)},['labels']);
  for(const article of articles){const rendered=renderToStaticMarkup(createElement(Component,{slug:article.slug}));for(const paragraph of researchBodyForLocale(article,locale))assert.ok(rendered.includes(`<p>${escapeText(paragraph)}</p>`));
   assert.ok(rendered.includes(`lang="${locale}"`));if(['en','tr','ru'].includes(locale))assert.doesNotMatch(textOnly(rendered),/[\u0600-\u06ff]/,`${article.id}:${locale}`);
  }
 }
 assert.deepEqual(researchBodyForLocale({id:'untranslated',body:['متن فارسی']},'en'),[]);
});

test('all 40 reference-document sections keep their original images and notes available without injecting Persian notes into translated readers',()=>{
 assert.equal(referenceDocuments.reduce((sum,document)=>sum+document.sections.length,0),40);
 for(const locale of locales)for(const document of referenceDocuments)for(const section of document.sections){
  let state=0;const Component=actualFunction('src/components/content/ReferenceDocuments.tsx','ReferenceDocumentReader',{...context(locale),products,referencePageUrl,useState:value=>[state++===0?section.pageStart:value,blank]},['labels','mb']);
  const rendered=renderToStaticMarkup(createElement(Component,{document}));assert.ok(rendered.includes(`src="${section.image}"`));assert.ok(rendered.includes(escapeText(section.summary[locale])));
  if(locale==='fa')assert.ok(rendered.includes(escapeText(section.text)));
  else {assert.ok(!rendered.includes(escapeText(section.text)));assert.ok(rendered.includes(`/fa/resources/${document.slug}/?page=${section.pageStart}#${section.id}`));}
  if(['en','tr','ru'].includes(locale))assert.doesNotMatch(textOnly(rendered),/[\u0600-\u06ff]/,`${document.id}:${section.id}:${locale}`);
 }
});
