import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url);
const client=await loadTs('src/lib/content-lease-client.ts');
const source=ts.transpileModule(readFileSync(new URL('../src/components/workspace/ContentCollaboration.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText+'\nexports.actualPanel=CollaborationPanel;';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function harness({request,claim,canEdit=true}={}){
 client.clearContentLeases();
 const exports={},hooks=[],calls=[],listeners=new Map(),intervals=new Map(),changes=[];let cursor=0,scheduled=[],nextInterval=0,tree,identityReleases=0,sequence=0;
 const clientId=randomUUID(),props={store:{actorId:'actor-one',role:'admin',locale:'en'},bucket:'pages',id:'page-one',sourceUpdatedAt:'2026-10-20T12:00:00.000Z',dirty:false,canEdit};
 const react={
  useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return[hooks[index].value,value=>{hooks[index].value=typeof value==='function'?value(hooks[index].value):value;changes.push(index);}];},
  useRef(initial){const index=cursor++;if(!hooks[index])hooks[index]={current:initial};return hooks[index];},
  useEffect(effect,deps){const index=cursor++,prior=hooks[index];if(!prior||!deps||deps.some((value,index)=>!Object.is(value,prior.deps?.[index]))){scheduled.push({index,effect,prior});hooks[index]={deps};}},
 };
 const window={setInterval(callback){const id=++nextInterval;intervals.set(id,callback);return id;},addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(callback);},removeEventListener(type,callback){listeners.get(type)?.delete(callback);}};
 const lease=()=>({id:'lease-'+(++sequence),token:String(sequence).repeat(64),leaseUntil:new Date(Date.now()+120000).toISOString(),holder:{name:'Test editor'},bucket:'pages',documentId:'page-one'});
 const apiClient={async request(path,options={}){calls.push({path,options});const custom=request?.(path,options);if(custom!==undefined)return custom;if(path==='/content/leases'&&options.method==='POST')return lease();if(path.startsWith('/content/leases?'))return{canEdit:true,lease:null};if(path.startsWith('/content/previews?'))return{items:[]};return{};}};
 const imports={react,'lucide-react':new Proxy({}, {get:()=>()=>null}),'@/lib/api':{apiClient,demoMode:false,networkError:error=>error.message},'@/lib/content-lease-client':client,'@/lib/content-editor-identity':{acquireContentEditorIdentity:actor=>claim?claim(actor):Promise.resolve({clientId,persistence:'tab',release:()=>{identityReleases++;}})},'./i18n':{L:(...values)=>Object.fromEntries(['fa','en','tr','ar','ru'].map((locale,index)=>[locale,values[index]])),localized:(value,locale)=>typeof value==='string'?value:value[locale],wt:key=>key}};
 runInNewContext(source,{exports,require:name=>name==='react/jsx-runtime'?require(name):imports[name]??assert.fail('Unexpected runtime dependency '+name),window,clearInterval:id=>intervals.delete(id),AbortController,Date,JSON,encodeURIComponent,navigator:{clipboard:{writeText:async()=>{}}}});
 function render(patch={}){Object.assign(props,patch);cursor=0;scheduled=[];tree=exports.actualPanel(props);for(const entry of scheduled)entry.prior?.cleanup?.();for(const entry of scheduled)hooks[entry.index].cleanup=entry.effect();return tree;}
 function unmount(){for(const hook of hooks)hook?.cleanup?.();}
 return{props,calls,hooks,changes,lease,render,unmount,wrapper:patch=>exports.default({...props,...patch}),get releases(){return identityReleases;},get state(){return hooks[0]?.value;},get tree(){return tree;},get intervalCount(){return intervals.size;},emit(type,event={}){for(const callback of [...listeners.get(type)||[]])callback(event);},async renew(){for(const callback of [...intervals.values()])await callback();}};
}
const requests=(runtime,method)=>runtime.calls.filter(call=>call.options.method===method);
function findElement(node,predicate){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const found=findElement(child,predicate);if(found)return found;}return null;}if(predicate(node))return node;return findElement(node.props?.children,predicate);}
const elementText=node=>Array.isArray(node)?node.map(elementText).join(''):typeof node==='string'?node:node?.props?elementText(node.props.children):'';

test('pagehide removes mutation headers, releases only the exact held token, and BFCache restoration reacquires',async()=>{
 const runtime=harness();runtime.render();await settle();assert.equal(runtime.state,'held');assert.equal(Object.keys(client.contentLeaseHeaders()).length,1);
 const initial=requests(runtime,'POST')[0],firstToken=client.contentLeaseHeaders()['X-Content-Leases'];runtime.emit('pagehide');
 assert.deepEqual(client.contentLeaseHeaders(),{});assert.equal(runtime.intervalCount,0);await settle();
 const release=requests(runtime,'DELETE')[0];assert.equal(release.path,'/content/leases/lease-1');assert.equal(JSON.parse(release.options.body).token,firstToken);assert.equal(release.options.keepalive,true);assert.equal('signal' in release.options,false);
 runtime.emit('pageshow',{persisted:true});runtime.render();await settle();assert.equal(runtime.state,'held');assert.equal(requests(runtime,'POST').length,2);
 assert.equal(JSON.parse(requests(runtime,'POST')[1].options.body).clientId,JSON.parse(initial.options.body).clientId);
 assert.notEqual(client.contentLeaseHeaders()['X-Content-Leases'],firstToken);runtime.unmount();await settle();assert.deepEqual(client.contentLeaseHeaders(),{});
});

test('a committed acquisition after unmount is cleaned with its returned token before the tab identity is released',async()=>{
 const acquisition=deferred(),deletion=deferred();
 const runtime=harness({request:(path,options)=>path==='/content/leases'&&options.method==='POST'?acquisition.promise:options.method==='DELETE'?deletion.promise:undefined});
 runtime.render();await settle();assert.equal(requests(runtime,'POST').length,1);assert.equal('signal' in requests(runtime,'POST')[0].options,false);
 runtime.unmount();assert.equal(runtime.releases,0);const committed=runtime.lease();acquisition.resolve(committed);await settle();
 assert.deepEqual(client.contentLeaseHeaders(),{});assert.equal(runtime.releases,0);assert.equal(JSON.parse(requests(runtime,'DELETE')[0].options.body).token,committed.token);
 deletion.resolve({});await settle();assert.equal(runtime.releases,1);assert.notEqual(runtime.state,'held');
});

test('a renewal that completes after pagehide cannot reinstall an expired editor’s mutation header',async()=>{
 const renewal=deferred(),runtime=harness({request:(_path,options)=>options.method==='PUT'?renewal.promise:undefined});
 runtime.render();await settle();const pending=runtime.renew();assert.equal(requests(runtime,'PUT').length,1);
 runtime.emit('pagehide');assert.deepEqual(client.contentLeaseHeaders(),{});renewal.resolve(runtime.lease());await pending;await settle();
 assert.deepEqual(client.contentLeaseHeaders(),{});assert.equal(runtime.releases,1);runtime.unmount();
});

test('permission withdrawal immediately drops the held header and never acquires a replacement lease',async()=>{
 const runtime=harness();runtime.render();await settle();assert.equal(runtime.state,'held');
 runtime.render({canEdit:false});assert.deepEqual(client.contentLeaseHeaders(),{});assert.equal(runtime.state,'readonly');await settle();
 assert.equal(requests(runtime,'POST').length,1);assert.equal(requests(runtime,'DELETE').length,1);runtime.unmount();
});

test('unmount while tab coordination is pending never starts a server acquisition and still releases the late claim',async()=>{
 const claim=deferred();let releases=0;
 const runtime=harness({claim:()=>claim.promise});runtime.render();runtime.unmount();claim.resolve({clientId:randomUUID(),persistence:'tab',release:()=>{releases++;}});await settle();
 assert.equal(requests(runtime,'POST').length,0);assert.equal(releases,1);assert.deepEqual(client.contentLeaseHeaders(),{});
});

test('preview state is remounted for each account, role, document and locale, and old preview callbacks remain inactive',async()=>{
 const preview=deferred(),runtime=harness({request:(path,options)=>path==='/content/previews'&&options.method==='POST'?preview.promise:undefined});
 const original=runtime.wrapper({});
 for(const patch of [{id:'page-two'},{bucket:'records'},{locale:'fa'},{store:{...runtime.props.store,actorId:'actor-two'}},{store:{...runtime.props.store,role:'editor'}},{store:{...runtime.props.store,locale:'fa'}}])assert.notEqual(runtime.wrapper(patch).key,original.key);
 assert.equal(runtime.wrapper({dirty:true}).key,original.key,'Typing must preserve the active editor rather than remount it.');
 runtime.render();await settle();runtime.render();
 const create=findElement(runtime.tree,node=>node.type==='button'&&elementText(node).includes('Create preview link'));assert.ok(create);create.props.onClick();await settle();
 runtime.unmount();await settle();const writes=runtime.changes.length;preview.resolve({id:'test-preview',url:'https://example.test/read-only-preview',locale:'en',expiresAt:new Date(Date.now()+3600000).toISOString()});await settle();
 assert.equal(runtime.changes.length,writes,'An old preview result must not display its URL or modify the next editor context.');
});
