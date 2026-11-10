import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const {ApiError}=await loadTs('src/lib/api.ts');
const {captureEditorSource,assertEditorSource}=await loadTs('src/lib/editor-source.ts');
const {validTaxonomy,taxonomyCopy}=await loadTs('src/lib/content-taxonomy.ts');
const {localized}=await loadTs('src/components/workspace/i18n.ts');
const {createDefaultSitePreferences,scopeSitePreferences,validateSitePreferences,parseSitePreferences}=await loadTs('src/lib/site-preferences.ts');

// Execute the actual editor callbacks and preference transport. Only React
// setters, the workspace queue and HTTP boundary are substituted; no browser
// rendering or live database acceptance is implied by this regression suite.
function action(file,name,context){
 const source=ts.createSourceFile(file,readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let body;
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name)body=node.initializer?.getText(source);if(ts.isFunctionDeclaration(node)&&node.name?.text===name)body=node.getText(source).replace(/^export\s+/,'');ts.forEachChild(node,visit);}visit(source);
 assert.ok(body,`Missing real action ${file}:${name}`);
 return runInNewContext(ts.transpileModule(`(${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
}
const pageFile='src/components/workspace/SiteControlCenter.tsx',preferencesFile='src/components/workspace/SiteSettings.tsx',transportFile='src/lib/site-preferences.ts';
const original=()=>({id:'site-home-en',slug:'home',locale:'en',version:2,updatedAt:'2026-10-19T10:00:00.000Z',status:'draft',author:'admin',authorId:'editor-a',title:'Original title',summary:'Original summary',blocks:[{id:'body',type:'rich-text',title:'Body',body:'Original content'}]});
function pageContext(saved=original()){
 const context={validTaxonomy,taxonomyCopy,localized,current:structuredClone(saved),draft:{...structuredClone(saved),title:'My preserved edit'},sourceStamp:captureEditorSource(saved),target:'home',language:'en',locale:'en',role:'admin',actor:{id:'editor-a'},state:{forms:[]},editable:true,canReview:false,canPublish:false,dirty:true,demoMode:false,pending:{current:false},editorEpoch:{current:1},mounted:{current:true},setBusy:()=>{},networkError:error=>error.message,assertEditorSource,now:()=> '2026-10-19T11:00:00.000Z',wt:key=>key,text:key=>key,L:(...values)=>values,parseFormSchema:()=>null,adopt:page=>{context.adopted=structuredClone(page);context.sourceStamp=captureEditorSource(page);},setLeaseState:()=>{},setLeaseGeneration:()=>{},createSiteDraft:()=>original()};
 context.live={pages:[structuredClone(saved)],forms:[],audit:[]};context.writes=[];context.notices=[];
 context.store={pending:false,getState:()=>context.live,notify:message=>context.notices.push(message),log:()=>({id:'audit-1'}),refresh:async()=>{},update:async update=>{try{await context.beforeQueue?.();const next=update(context.live);context.writes.push(structuredClone(next));context.live={...next,pages:next.pages.map(page=>({...page,version:page.version+1,updatedAt:'2026-10-19T11:01:00.000Z'}))};return true;}catch(error){context.notices.push(error);return false;}}};
 return context;
}
test('a page draft survives a workspace conflict and retry cannot overwrite the refreshed source',async()=>{
 const c=pageContext(),other={...original(),version:3,updatedAt:'2026-10-19T10:10:00.000Z',title:'Other editor title'},preserved=structuredClone(c.draft);let requests=0;
 c.store.update=async update=>{update(c.live);requests++;c.live={...c.live,pages:[other]};return false;};
 const save=action(pageFile,'save',c);assert.equal(await save(),false);assert.deepEqual(c.draft,preserved);assert.equal(c.adopted,undefined);
 // This is the same still-open editor after the store's 409 handler has loaded
 // the newer workspace clock. A second press must make no second HTTP write.
 assert.equal(await save(),false);assert.equal(requests,1);assert.equal(c.live.pages[0].title,'Other editor title');assert.deepEqual(c.draft,preserved);
});
test('a queued page write rechecks the source after an earlier command changes it',async()=>{
 const c=pageContext(),preserved=structuredClone(c.draft);
 c.beforeQueue=async()=>{c.live={...c.live,pages:[{...original(),version:3,updatedAt:'2026-10-19T10:15:00.000Z',summary:'Concurrent source edit'}]};};
 assert.equal(await action(pageFile,'save',c)(),false);assert.equal(c.writes.length,0);assert.deepEqual(c.draft,preserved);assert.equal(c.notices.at(-1).problem.code,'SOURCE_CHANGED');
});
test('an unrelated workspace update does not discard a page draft or cause a false source conflict',async()=>{
 const c=pageContext();c.beforeQueue=async()=>{c.live={...c.live,audit:[{id:'unrelated-event'}],forms:[{id:'unrelated-form'}]};};
 assert.equal(await action(pageFile,'save',c)(),true);assert.equal(c.writes.length,1);assert.equal(c.adopted.title,'My preserved edit');assert.equal(c.live.forms[0].id,'unrelated-form');assert.equal(c.adopted.blocks[0].body,'Original content');
});
test('absent and deleted pages are also versioned sources, and explicit reload restores editability',async()=>{
 const c=pageContext();c.sourceStamp=null;
 assert.equal(await action(pageFile,'save',c)(),false);assert.equal(c.writes.length,0,'A page created by someone else cannot be replaced by an old unsaved template');
 c.sourceStamp=captureEditorSource(original());c.live.pages=[];
 assert.equal(await action(pageFile,'save',c)(),false);assert.equal(c.writes.length,0,'Deleting a page cannot make an old editor recreate it implicitly');
 const other={...original(),version:4,updatedAt:'2026-10-19T10:30:00.000Z',title:'Current source',summary:'Keep this newer summary'};c.live.pages=[other];
 await action(pageFile,'reload',c)();assert.equal(c.writes.length,0,'Reload is read-only');assert.deepEqual(c.adopted,other);
 c.draft={...c.adopted,title:'Edit after reviewing current source'};
 assert.equal(await action(pageFile,'save',c)(),true);assert.equal(c.live.pages[0].summary,'Keep this newer summary');
});

function preferenceTransport(){
 const initial=createDefaultSitePreferences(),context={demoMode:false,serverDraft:null,parseSitePreferences,validateSitePreferences,ApiError,structuredClone};
 let server={draft:structuredClone(initial),published:structuredClone(initial),version:30};const calls=[];
 context.apiClient={request:async(path,options={})=>{assert.equal(path,'/site-preferences');if(!options.method)return structuredClone(server);const input=JSON.parse(options.body);calls.push(input);if(input.expectedVersion!==server.version)throw new ApiError({type:'about:blank',title:'Conflict',detail:'Review the saved version',status:409,code:'CONFLICT'});server={draft:structuredClone(input.value),published:input.publish?structuredClone(input.value):server.published,version:server.version+1};return structuredClone(server);}};
 context.preferenceRevision=action(transportFile,'preferenceRevision',context);
 const load=action(transportFile,'loadSitePreferencesRevision',context),write=action(transportFile,'writeSitePreferencesRevision',context);
 return {load,write,calls,get server(){return server;},otherEdit:()=>{server={...server,draft:{...server.draft,contact:{...server.draft.contact,email:'new-owner@example.test'}},version:server.version+1};}};
}
test('loading another preference revision cannot rebase an older editor write or publish',async()=>{
 const t=preferenceTransport(),captured=await t.load(),draft=structuredClone(captured.draft);draft.brand.name.en='My old draft';
 t.otherEdit();await t.load();
 await assert.rejects(t.write(draft,'settings',false,captured.version),error=>error.status===409);
 await assert.rejects(t.write(draft,'settings',true,captured.version),error=>error.status===409);
 assert.deepEqual(t.calls.map(call=>call.expectedVersion),[30,30]);assert.equal(t.server.draft.contact.email,'new-owner@example.test');assert.notEqual(t.server.published.brand.name.en,'My old draft');
 await assert.rejects(t.write(draft,'settings',false),error=>error.status===428);assert.equal(t.calls.length,2,'Missing capture cannot fall back to a mutable module-global clock');
});
test('the preference editor preserves a conflicting draft and requires explicit reload before another save',async()=>{
 const transport=preferenceTransport(),revision=await transport.load();
 const c={captured:{current:revision},draft:structuredClone(revision.draft),allowed:true,pending:{current:false},mounted:{current:true},epoch:{current:1},mode:'settings',permissionModule:'settings',permissionAction:'manage',locale:'en',demoMode:false,ApiError,createDefaultSitePreferences,scopeSitePreferences,validateSitePreferences,writeSitePreferencesRevision:transport.write,loadSitePreferencesRevision:transport.load,refreshServerSite:async()=>{},setBusy:()=>{},setIssues:()=>{},setError:()=>{},notify:()=>{},text:key=>key,networkError:error=>error.message,store:{permit:()=>true,refresh:async()=>{}},setConflict:value=>{c.conflict=value;c.allowed=!value;},adoptRevision:value=>{c.captured.current=value;c.draft=structuredClone(value.draft||value.published);c.allowed=true;c.conflict=false;}};
 c.draft.brand.tagline.en='My draft remains available for export';const preserved=structuredClone(c.draft);transport.otherEdit();
 assert.equal(await action(preferencesFile,'persist',c)(false),false);assert.equal(c.conflict,true);assert.deepEqual(c.draft,preserved);assert.equal(c.captured.current.version,30);
 assert.equal(await action(preferencesFile,'persist',c)(false),false);assert.equal(transport.calls.length,1,'A second click while conflicted sends no new request');
 await action(preferencesFile,'reload',c)();assert.equal(c.captured.current.version,31);assert.equal(c.draft.contact.email,'new-owner@example.test');assert.equal(transport.calls.length,1,'Explicit reload only reads');
 c.draft.brand.tagline.en='Reviewed against the new source';assert.equal(await action(preferencesFile,'persist',c)(false),true);assert.equal(transport.server.draft.contact.email,'new-owner@example.test');assert.equal(c.captured.current.version,32);
});
test('a late preference save response cannot replace the next actor or editor draft',async()=>{
 const transport=preferenceTransport(),revision=await transport.load();let release;const response=new Promise(resolve=>{release=resolve;});
 const c={captured:{current:revision},draft:structuredClone(revision.draft),allowed:true,pending:{current:false},mounted:{current:true},epoch:{current:1},mode:'menus',permissionModule:'menus',permissionAction:'edit',locale:'en',demoMode:false,ApiError,createDefaultSitePreferences,scopeSitePreferences,validateSitePreferences,writeSitePreferencesRevision:()=>response,setBusy:()=>{},setIssues:()=>{},setError:()=>{},notify:()=>assert.fail('Old actor received a toast'),text:key=>key,networkError:error=>error.message,store:{permit:()=>true,refresh:async()=>assert.fail('Old actor refreshed workspace')},setConflict:()=>assert.fail('Old actor changed conflict state'),adoptRevision:()=>assert.fail('Old response replaced current draft')};
 const pending=action(preferencesFile,'persist',c)(false);c.epoch.current++;release({...revision,version:31});assert.equal(await pending,false);
});
