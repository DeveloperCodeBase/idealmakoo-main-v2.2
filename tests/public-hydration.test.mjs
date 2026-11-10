import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url);
const {HttpClient,ApiError,setCsrfToken,clearCsrfToken}=await loadTs('src/lib/api.ts');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const source=file=>ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const compile=(code,jsx=false)=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,...jsx?{jsx:ts.JsxEmit.ReactJSX}:{}}}).outputText;
function selectEffect(file,needle){const sf=source(file),matches=[];const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(sf)==='useEffect'&&node.arguments[0].getText(sf).includes(needle))matches.push(node);ts.forEachChild(node,visit);};visit(sf);assert.equal(matches.length,1,`Use the actual ${file} effect`);return compile(`({effect:${matches[0].arguments[0].getText(sf)},dependencies:${matches[0].arguments[1].getText(sf)}})`);}
function hookHost(code,context,derive=()=>{}){let dependencies,cleanup;return{render(patch={}){Object.assign(context,patch);derive(context);const current=runInNewContext(code,{...context});if(!dependencies||dependencies.length!==current.dependencies.length||current.dependencies.some((item,index)=>!Object.is(item,dependencies[index]))){cleanup?.();dependencies=current.dependencies;cleanup=current.effect();}},close(){cleanup?.();}};}
function transport(){
 const originalFetch=globalThis.fetch,requests=[],events=new EventTarget(),timers=new Map();let id=0;
 globalThis.fetch=(url,options)=>new Promise(resolve=>requests.push({url,signal:options.signal,resolve:value=>resolve(Response.json(value))}));
 const window={addEventListener:(...args)=>events.addEventListener(...args),removeEventListener:(...args)=>events.removeEventListener(...args),dispatchEvent:event=>events.dispatchEvent(event),setTimeout:callback=>{timers.set(++id,callback);return id;},setInterval:()=>++id};
 return{requests,window,client:new HttpClient('/api/v1'),clearTimeout:key=>timers.delete(key),clearInterval:()=>{},flush(){const pending=[...timers.values()];timers.clear();for(const callback of pending)callback();},close(){globalThis.fetch=originalFetch;clearCsrfToken();}};
}

test('public resource, certificate and tender readers mount only after the current session is established',()=>{
 for(const [file,child]of[['src/components/resources/ControlledResources.tsx','Directory'],['src/components/company/CompanyCertificates.tsx','PublishedCertificates'],['src/components/tenders/TenderCenter.tsx','TenderCenterBody']]){
  const sf=source(file),fn=sf.statements.find(node=>ts.isFunctionDeclaration(node)&&node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.DefaultKeyword));assert.ok(fn);
  const helperNames=child==='Directory'?['DirectoryShell','DirectoryLoadingState']:[];
  const helpers=sf.statements.filter(node=>ts.isFunctionDeclaration(node)&&helperNames.includes(node.name?.text));assert.equal(helpers.length,helperNames.length,'Use the actual pending presentation helpers');
  let app={locale:'en',sessionReady:false,session:null},readerCalls=0;const exports={},body=()=>{readerCalls++;return null;};
  const presentation=helperNames.length?{styles:new Proxy({},{get:(_target,key)=>String(key)}),text:(_locale,values)=>values[1],RefreshCw:()=>null}:{};
  runInNewContext(compile(`${helpers.map(node=>node.getText(sf)).join('\n')}\nexport const probe=${fn.getText(sf).replace(/^export default /,'')}`,true),{exports,require,useApp:()=>app,[child]:body,controlledAccountKey:(session,locale)=>JSON.stringify([locale,session?.id,session?.role]),c:(_locale,key)=>key,tr:(_locale,key)=>key,...presentation});
  const waitingHtml=renderToStaticMarkup(exports.probe({}));assert.equal(readerCalls,0,`${file} does not render a reader while bootstrap can still change HttpClient generation`);assert.match(waitingHtml,/role="status"/,'The real pending presentation exposes its loading status');
  app={...app,sessionReady:true};const guest=exports.probe({});assert.equal(guest.type,body,'An established guest session can read public data');renderToStaticMarkup(guest);assert.equal(readerCalls,1,'The established guest renders the reader');
  app={...app,session:{id:'account-a',role:'customer'}};const first=exports.probe({});assert.equal(first.type,body);assert.notEqual(first.key,guest.key);
  app={...app,session:{id:'account-b',role:'customer'}};assert.notEqual(exports.probe({}).key,first.key,'A later account uses a new reader and its existing cleanup');
 }
});

test('an early-opened public resource search waits for bootstrap and discards the previous account response',async()=>{
 const io=transport(),state={value:null},file='src/lib/public-resource-search.ts';const context={query:'catalog',open:true,locale:'en',sessionReady:false,actorId:null,demoMode:false,AbortController,URLSearchParams,apiClient:io.client,networkError:error=>error.message,window:io.window,document:{visibilityState:'visible'},clearTimeout:io.clearTimeout,clearInterval:io.clearInterval,setState:value=>{state.value=value;}};
 const sf=source(file);let key;const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(sf)==='key')key=node.initializer.getText(sf);ts.forEachChild(node,visit);};visit(sf);assert.ok(key);
 const host=hookHost(selectEffect(file,'/public/resource-search'),context,value=>{value.key=runInNewContext(compile(`(${key})`),{...value});});clearCsrfToken();
 try{
  host.render();io.flush();assert.equal(io.requests.length,0);
  setCsrfToken('public-hydration-fixture-a');host.render({sessionReady:true,actorId:'account-a'});io.flush();assert.equal(io.requests.length,1);
  const stale=io.requests[0];setCsrfToken('public-hydration-fixture-b');host.render({actorId:'account-b'});io.flush();assert.equal(stale.signal.aborted,true);assert.equal(io.requests.length,2);
  io.requests[1].resolve({items:[{id:'current-public-document'}],truncated:false});await settle();await settle();
  stale.resolve({items:[{id:'old-reader-document'}],truncated:false});await settle();await settle();
  assert.equal(state.value.items[0]?.id,'current-public-document');assert.equal(state.value.error,'');assert.equal(state.value.loading,false);
  host.close();assert.equal(io.requests[1].signal.aborted,true);
 }finally{host.close();io.close();}
});

test('an early-opened assistant reads actual capabilities after bootstrap and cannot adopt a prior account capability',async()=>{
 const io=transport(),state={configured:null,capability:null},context={open:true,sessionReady:false,session:null,locale:'en',AbortController,apiClient:io.client,setConfigured:value=>{state.configured=value;},setCapability:value=>{state.capability=value;}};
 const host=hookHost(selectEffect('src/components/site/Assistant.tsx',"'/ai/status'"),context);clearCsrfToken();
 try{
  host.render();assert.equal(io.requests.length,0);setCsrfToken('assistant-hydration-fixture-a');host.render({sessionReady:true,session:{id:'account-a'}});assert.equal(io.requests.length,1);
  const stale=io.requests[0];setCsrfToken('assistant-hydration-fixture-b');host.render({session:{id:'account-b'}});assert.equal(stale.signal.aborted,true);assert.equal(io.requests.length,2);
  io.requests[1].resolve({configured:false,provider:'openrouter'});await settle();await settle();
  stale.resolve({configured:true,publicChat:true});await settle();await settle();assert.equal(state.configured,false);assert.equal(state.capability.provider,'openrouter');
  host.render({open:false});assert.equal(state.configured,null);assert.equal(state.capability,null);assert.equal(io.requests[1].signal.aborted,true);
 }finally{host.close();io.close();}
});

test('the public snapshot refresh preserves SSR data, retries only a discarded old-identity GET and stays off capability pages',async()=>{
 const io=transport(),runtime={};runInNewContext(compile(readFileSync(new URL('../src/lib/server-runtime.ts',import.meta.url),'utf8')),{exports:runtime,require:name=>{assert.equal(name,'@/lib/api');return{apiClient:io.client,demoMode:false};},window:io.window,Event});
 const initial={publications:[],forms:[],preferences:{},content:{},version:1};runtime.seedServerSite(initial);const notices=[];
 const context={demoMode:false,publicTokenPage:false,sessionReady:false,session:null,authGeneration:0,locale:'en',ApiError,refreshServerSite:runtime.refreshServerSite,notify:value=>notices.push(value),networkError:error=>error.message,window:io.window};const host=hookHost(selectEffect('src/components/providers/AppProvider.tsx','refreshServerSite()'),context);clearCsrfToken();
 try{
  host.render();assert.equal(io.requests.length,0);assert.equal(runtime.readServerSite().version,1);
  setCsrfToken('snapshot-hydration-fixture-a');host.render({sessionReady:true,session:{id:'account-a'}});assert.equal(io.requests.length,1);
  setCsrfToken('snapshot-hydration-fixture-b');host.render({session:{id:'account-b'}});assert.equal(io.requests.length,1,'The actual adapter shares its already-pending GET');
  io.requests[0].resolve({...initial,version:99});await settle();await settle();assert.equal(runtime.readServerSite().version,1,'A rejected old-identity response cannot replace the server render');assert.equal(io.requests.length,2,'The current effect repeats only the discarded GET');
  io.requests[1].resolve({...initial,version:2});await settle();await settle();assert.equal(runtime.readServerSite().version,2);assert.deepEqual(notices,[]);
  host.render({publicTokenPage:true});io.window.dispatchEvent(new Event('focus'));await settle();assert.equal(io.requests.length,2,'Capability pages neither read /site nor start account bootstrap');
  assert.ok(io.requests.every(item=>item.url==='/api/v1/site'));
 }finally{host.close();io.close();}
});

test('provider seeding preserves publication snapshot identity while a fresh same-version response still removes expired content',async()=>{
 const {parsePublications}=await loadTs('src/lib/publications.ts');
 const sf=source('src/lib/publications.ts');
 const variableNames=['empty','cachedServer','cachedText','cached','initialPublicationCache'];
 const functionNames=['snapshot','initialPublications','usePublications'];
 const declarations=sf.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>variableNames.includes(value.name.getText(sf))));
 const functions=sf.statements.filter(node=>ts.isFunctionDeclaration(node)&&functionNames.includes(node.name?.text));
 assert.equal(declarations.length,variableNames.length);assert.equal(functions.length,functionNames.length);
 const code=declarations.map(node=>node.getText(sf)).join('\n')+'\n'+functions.map(node=>node.getText(sf)).join('\n');
 const initial={version:7,publications:[{id:'initial-public-article',slug:'news/source',kind:'news',locale:'en',title:'Reviewed source',body:'A current published introduction.',blocks:[]}]};
 let server=null,serverRead,clientRead;
 const exports={};runInNewContext(compile(code),{exports,parsePublications,window:{},demoMode:false,readServerSite:()=>server,useInitialServerSite:()=>initial,useMemo:callback=>callback(),useSyncExternalStore:(_subscribe,getSnapshot,getServerSnapshot)=>{serverRead=getServerSnapshot();clientRead=getSnapshot();return clientRead;},subscribe:()=>()=>{}});
 const ssr=exports.usePublications();assert.equal(ssr.length,1);assert.equal(serverRead,clientRead);
 server=initial;
 assert.equal(exports.usePublications(),ssr,'Mounting the exact immutable SSR snapshot does not reparse into a new external-store value.');
 assert.equal(serverRead,clientRead,'The initial browser and hydration snapshots remain referentially identical.');
 server={...initial,publications:[]};
 const expired=exports.usePublications();assert.equal(expired.length,0);assert.notEqual(expired,ssr,'A fresh response can expire content even when the workspace version stays the same.');
 assert.equal(exports.usePublications(),expired,'Repeated reads of the same fresh object are stable.');
 server={...initial,publications:[{...initial.publications[0],title:'Reviewed replacement'}]};
 assert.equal(exports.usePublications()[0].title,'Reviewed replacement','Later same-version public snapshots are never suppressed by a version-only optimization.');
});

test('navigation, footer and shell share the SSR preference object through hydration and observe later edits',async()=>{
 const {parseSitePreferences,createDefaultSitePreferences}=await loadTs('src/lib/site-preferences.ts');
 const sf=source('src/lib/site-preferences.ts');
 const variableNames=['defaults','initialPreferenceCache','cachedServer','cachedText','cached'];
 const functionNames=['snapshot','initialPreferences','useSitePreferences'];
 const declarations=sf.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>variableNames.includes(value.name.getText(sf))));
 const functions=sf.statements.filter(node=>ts.isFunctionDeclaration(node)&&functionNames.includes(node.name?.text));
 assert.equal(declarations.length,variableNames.length);assert.equal(functions.length,functionNames.length);
 const code=declarations.map(node=>node.getText(sf)).join('\n')+'\n'+functions.map(node=>node.getText(sf)).join('\n');
 let initial={version:7,publications:[],forms:[],content:{},preferences:createDefaultSitePreferences()};
 let server=null,serverRead,clientRead,parseCount=0;
 const exports={};runInNewContext(compile(code),{exports,createDefaultSitePreferences,parseSitePreferences:value=>{parseCount++;return parseSitePreferences(value);},window:{},demoMode:false,readServerSite:()=>server,useInitialServerSite:()=>initial,useMemo:callback=>callback(),useSyncExternalStore:(_subscribe,getSnapshot,getServerSnapshot)=>{serverRead=getServerSnapshot();clientRead=getSnapshot();return clientRead;},subscribe:()=>()=>{}});
 const shell=exports.useSitePreferences(),navigation=exports.useSitePreferences(),footer=exports.useSitePreferences();
 assert.equal(shell,navigation);assert.equal(shell,footer);assert.equal(parseCount,1,'Multiple consumers parse one immutable SSR snapshot only once.');
 server=initial;
 assert.equal(exports.useSitePreferences(),shell,'Seeding the browser store must not trigger a false synchronous preference change.');
 assert.equal(serverRead,clientRead);assert.equal(parseCount,1);
 server={...initial,preferences:{...initial.preferences,contact:{...initial.preferences.contact,email:'updated@example.test'}}};
 const updated=exports.useSitePreferences();assert.notEqual(updated,shell);assert.equal(updated.contact.email,'updated@example.test');assert.equal(parseCount,2);
 assert.equal(exports.useSitePreferences(),updated);assert.equal(parseCount,2,'Repeated reads of a new immutable response remain stable.');
 server=null;initial={...initial,preferences:{...initial.preferences,contact:{...initial.preferences.contact,email:'other-request@example.test'}}};
 const separateRequest=exports.useSitePreferences();assert.notEqual(separateRequest,shell);assert.notEqual(separateRequest,updated);assert.equal(separateRequest.contact.email,'other-request@example.test','A different server snapshot cannot reuse another request’s preferences.');
});
