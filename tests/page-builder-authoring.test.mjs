import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createElement,useState,useRef,useEffect} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url);
const {localizedPath}=await loadTs('src/lib/locale-routing.ts');
const {direction,translate}=await loadTs('src/lib/i18n.ts');
const {carouselUrl}=await loadTs('src/lib/carousel.ts');
const {L,localized,workspaceLocales,wt,blockTypes}=await loadTs('src/components/workspace/i18n.ts');
const {canWorkspace}=await loadTs('src/lib/auth.ts');
const {canManageSitePage}=await loadTs('src/lib/page-authority.ts');
const {captureEditorSource,editorSourceMatches,assertEditorSource}=await loadTs('src/lib/editor-source.ts');
const {validTaxonomy,taxonomyCopy,splitTaxonomyTags}=await loadTs('src/lib/content-taxonomy.ts');
const empty=()=>null;
const icons=Object.fromEntries(['ArrowDown','ArrowUp','Check','ChevronDown','ChevronLeft','ChevronRight','Copy','Eye','FileText','GripVertical','ImageIcon','LayoutTemplate','Link2','Monitor','Plus','Save','Search','Send','ShieldCheck','Smartphone','Trash2','X'].map(name=>[name,empty]));

// Compile the actual component function, keeping React's actual hook and render
// behavior. Only unrelated descendants and external data feeds are isolated.
function actualComponent(name,context,variables=[],file='src/components/workspace/CMS.tsx'){
 const source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn);
 const declarations=source.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>variables.includes(value.name.getText(source))));
 const code=declarations.map(node=>node.getText(source)).join('\n')+'\nexport const probe='+fn.getText(source).replace(/^export\s+(?:default\s+)?/,'');
 const exports={};runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require,structuredClone,useState,useRef,useEffect,...icons,...context});return exports.probe;
}
const TaxonomyFields=actualComponent('TaxonomyFields',{Field:({label,children})=>createElement('label',null,createElement('span',null,label),children),localized,wt,taxonomyCopy,splitTaxonomyTags,validTaxonomy},[],'src/components/workspace/TaxonomyFields.tsx');
const Preview=actualComponent('BlockPreview',{officialProducts:[],resources:[],usePublications:()=>[],safeUrl:value=>!!carouselUrl(value,true),carouselUrl,localizedPath,localized,wt,translate,AiMarkdown:({text})=>createElement('p',null,text)});
const base={id:'authored-action',type:'hero',title:'Authored introduction',body:'This is the selected language.',link:'/fa/contact/'};
const render=(block,locale='en')=>renderToStaticMarkup(createElement(Preview,{block,locale}));

function actualAction(name,context){
 const file='src/components/workspace/CMS.tsx',source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let initializer;
 const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name)initializer=node.initializer?.getText(source);ts.forEachChild(node,visit);};visit(source);assert.ok(initializer);
 return runInNewContext(ts.transpileModule(`(${initializer})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
}
function editor(){
 const source={id:'PAGE-pending',slug:'pending-acceptance',locale:'en',title:'Saved title',summary:'Saved summary',version:2,status:'draft',author:'admin',authorId:'editor',updatedAt:'2026-10-25T00:00:00.000Z',blocks:[base]};
 const c={validTaxonomy,taxonomyCopy,localized,draft:{...structuredClone(source),title:'My submitted title'},selected:source,changes:true,pageActive:true,editable:true,structuralEditable:true,canReview:true,canPublish:true,role:'admin',locale:'en',demoMode:false,pending:{current:false},mounted:{current:true},editorEpoch:{current:1},capturedSource:{current:captureEditorSource(source)},assertEditorSource,captureEditorSource,structuredClone,now:()=>new Date().toISOString(),wt:key=>key,L,networkError:error=>error.message};
 c.state={pages:[source],audit:[],forms:[]};c.writes=[];c.messages=[];
 c.setDraft=value=>{c.draft=typeof value==='function'?value(c.draft):value;};c.setChanges=value=>{c.changes=value;};c.setBusy=value=>{c.busy=value;};
 c.store={pending:false,actorId:'editor',permit:()=>true,notify:value=>c.messages.push(value),log:()=>({id:'event'}),getState:()=>c.state,update:async fn=>{const next=fn(c.state);c.writes.push(next);await c.delay?.();c.state=next;return true;}};
 c.adoptCommitted=actualAction('adoptCommitted',c);return c;
}

test('a slow page save locks reentrant saves and input before its response can erase newer typing',async()=>{
 const c=editor();let release;c.delay=()=>new Promise(resolve=>{release=resolve;});
 const save=actualAction('save',c),change=actualAction('change',c),pending=save();
 assert.equal(c.pending.current,true);assert.equal(c.busy,true);change({title:'Keystroke while the submitted snapshot is pending'});
 assert.equal(c.draft.title,'My submitted title','The pending request must disable mutation, including an already dispatched input handler.');
 await save();assert.equal(c.writes.length,1,'A second click does not enqueue a second revision.');release();await pending;
 assert.equal(c.pending.current,false);assert.equal(c.busy,false);assert.equal(c.changes,false);assert.equal(c.draft.version,3);assert.equal(c.draft.title,'My submitted title');assert.deepEqual(c.capturedSource.current,captureEditorSource(c.state.pages[0]));
 change({title:'My next edit after the acknowledgement'});assert.equal(c.draft.title,'My next edit after the acknowledgement');assert.equal(c.changes,true);
});

test('an unsuccessful page save preserves dirty content and releases its local pending guard',async()=>{
 for(const failure of ['rejected','lost response']){
  const c=editor(),preserved=structuredClone(c.draft);c.store.update=async()=>{if(failure==='lost response')throw new Error('No acknowledgement');return false;};
  await actualAction('save',c)();assert.deepEqual(c.draft,preserved);assert.equal(c.changes,true);assert.equal(c.pending.current,false);assert.equal(c.busy,false);assert.equal(c.capturedSource.current.version,2);
 }
});

test('a late save response cannot replace another page or an unmounted editor',async()=>{
 const c=editor();let release;c.delay=()=>new Promise(resolve=>{release=resolve;});const pending=actualAction('save',c)();
 c.editorEpoch.current++;c.mounted.current=false;c.draft={...c.draft,id:'NEXT-page',title:'Next editor'};release();await pending;
 assert.equal(c.draft.id,'NEXT-page');assert.equal(c.draft.title,'Next editor');assert.equal(c.changes,true);assert.equal(c.capturedSource.current.version,2);
});

test('review and publication acknowledge the committed source identity, allowing the next workflow step',async()=>{
 for(const operation of ['review','publish']){
  const c=editor();c.changes=false;c.draft.status=operation==='review'?'review':'approved';c.draft.approvedBy='admin';c.draft.approvedById='reviewer';
  const committed={...c.draft,version:3,status:operation==='review'?'approved':'published',updatedAt:'2026-10-25T01:00:00.000Z'};
  c.store[operation]=async()=>{c.state.pages=[committed];return true;};
  if(operation==='review')await actualAction('save',c)('approved','admin');else await actualAction('publish',c)();
  assert.equal(c.draft.status,committed.status);assert.equal(c.changes,false);assert.deepEqual(c.capturedSource.current,captureEditorSource(committed));assert.equal(c.pending.current,false);assert.equal(c.busy,false);
 }
});

test('the actual preview renders authored primary and secondary actions for all action block templates',()=>{
 for(const type of ['hero','split','cta','notice','contact','map','features','statistics','certificates','team','testimonials','partners','timeline','text','rich-text']){
  const result=render({...base,type,options:{ctaLabel:'Ask the factory',secondaryLabel:'Read the catalogue',secondaryLink:'/fa/resources/'}});
  assert.match(result,/href="\/en\/contact\/" class="btn btn-primary">Ask the factory<\/a>/,type);
  assert.match(result,/href="\/en\/resources\/" class="btn">Read the catalogue<\/a>/,type);
 }
});

test('preview action fallbacks follow the content language and preserve an explicitly blank authored label',()=>{
 for(const locale of workspaceLocales){
  const result=render(base,locale);assert.ok(result.includes(translate(locale,'learnMore')),locale);assert.ok(result.includes(`href="/${locale}/contact/"`));
 }
 const blank=render({...base,options:{ctaLabel:''}});assert.doesNotMatch(blank,new RegExp(translate('en','learnMore')));
});

test('download previews localize page links, preserve real file URLs and display both authored buttons',()=>{
 const definition={...base,type:'downloads',options:{ctaLabel:'Read safety data',secondaryLabel:'Contact',secondaryLink:'/fa/contact/'}};
 for(const link of ['/media/documents/safety.pdf','https://example.test/safety.pdf?edition=3#page=2'])assert.ok(render({...definition,link}).includes(`href="${link}"`));
 const result=render({...definition,link:'/fa/resources/'});assert.match(result,/href="\/en\/resources\/"[^>]*>Read safety data<\/a>/);assert.match(result,/href="\/en\/contact\/" class="btn">Contact<\/a>/);
});

test('preview rejects unsafe authored primary, secondary and download links just as the public renderer does',()=>{
 for(const unsafe of ['javascript:alert(1)','//evil.test/','/\\evil.test/','https://user:secret@example.test/','https://example.test/unsafe path']){
  for(const type of ['hero','cta','downloads'])assert.equal((render({...base,type,link:unsafe,options:{secondaryLink:unsafe,secondaryLabel:'Unsafe'}}).match(/<a /g)||[]).length,0,`${type}: ${unsafe}`);
 }
});

test('a newly created action block exposes label and secondary-link inputs without pre-existing options',()=>{
 const Editor=actualComponent('PageBuilder',{TaxonomyFields,validTaxonomy,taxonomyCopy,workspaceProducts:()=>[],captureEditorSource,editorSourceMatches,canManageSitePage,canWorkspace,demoMode:true,direction,localized,workspaceLocales,wt,blockTypes,L,Field:({label,children})=>createElement('label',null,createElement('span',null,label),children),Status:empty,PageLifecycle:empty,PageNavigationGuard:empty,SharedBlockLibrary:empty,ContentCollaboration:empty,TranslationStatusPanel:empty,AiContentTranslation:empty,PublicationSchedule:empty,RevisionHistory:empty,BlockPreview:empty},['nativeNames']);
 for(const locale of ['en','ar']){
  const page={id:'PAGE-action',slug:'custom-authoring',locale,title:'New title',summary:'New summary',version:1,status:'draft',author:'admin',authorId:'actor',updatedAt:'2026-10-25T00:00:00.000Z',blocks:[base]};
  const state={records:[],pages:[page],forms:[],media:[]},actor={id:'actor',role:'admin',locale:'en',allowedLocales:workspaceLocales};
  const store={state,locale:'en',role:'admin',actorId:'actor',actor,loaded:true,pending:0,getState:()=>state};
  const result=renderToStaticMarkup(createElement(Editor,{store}));
  assert.match(result,/Primary button label/);assert.match(result,/Secondary button label/);assert.match(result,/Secondary button link/);
  assert.ok(result.includes(`dir="${direction(locale)}" lang="${locale}"`),'The content controls carry the edited language, independent of the English panel.');
 }
});
