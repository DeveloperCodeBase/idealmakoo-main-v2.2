import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const {HttpClient,HttpRequestRepository,ApiError,setCsrfToken,clearCsrfToken}=await loadTs('src/lib/api.ts');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

// The actual HttpClient reads a real streamed Response. Only the network edge
// is substituted, so header arrival and body completion can be ordered around
// a real CSRF/auth-generation transition without a browser or live account.
function streamedTransport(t,{status=200,contentType='application/json'}={}){
 const priorFetch=globalThis.fetch,priorWindow=globalThis.window,events=new EventTarget();
 const calls=[];let controller,closed=false;
 const stream=new ReadableStream({start(value){controller=value;}});
 const response=new Response(stream,{status,headers:{'Content-Type':contentType}});
 globalThis.window=events;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return response;};
 clearCsrfToken();setCsrfToken('provider-race-current-fixture');
 t.after(()=>{if(!closed){controller.close();closed=true;}globalThis.fetch=priorFetch;if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;clearCsrfToken();});
 return{client:new HttpClient('/api/v1'),events,calls,finish(value){assert.equal(closed,false);controller.enqueue(new TextEncoder().encode(value));controller.close();closed=true;}};
}
const accountChanged=error=>error instanceof ApiError&&error.status===409&&error.problem.title==='Account changed';

test('HttpClient rejects a private JSON body that finishes after the account changes',async t=>{
 const io=streamedTransport(t),pending=io.client.request('/requests');
 await settle();assert.equal(io.calls.length,1);
 setCsrfToken('provider-race-next-fixture');
 io.finish(JSON.stringify([{id:'previous-account-request',message:'Previous account content'}]));
 await assert.rejects(pending,accountChanged);
});

test('HttpClient rejects a private attachment body that finishes after the account changes',async t=>{
 const io=streamedTransport(t,{contentType:'application/octet-stream'}),pending=io.client.blob('/attachments/fixture-private');
 await settle();setCsrfToken('provider-race-next-fixture');
 io.finish('Previous account attachment bytes');
 await assert.rejects(pending,accountChanged);
});

test('a late decoded401 cannot expire the newly accepted account',async t=>{
 const io=streamedTransport(t,{status:401});let expirations=0;
 io.events.addEventListener('idealmakoo:session-expired',()=>{expirations++;});
 const pending=io.client.request('/me/settings');
 await settle();setCsrfToken('provider-race-next-fixture');
 io.finish(JSON.stringify({code:'SESSION_REQUIRED',title:'Unauthorized',status:401}));
 await assert.rejects(pending,accountChanged);assert.equal(expirations,0);
});

test('returning to a previous token value does not revive an earlier response generation',async t=>{
 const io=streamedTransport(t),pending=io.client.request('/me/collection');
 await settle();setCsrfToken('provider-race-other-fixture');setCsrfToken('provider-race-current-fixture');
 io.finish(JSON.stringify({saved:['old-private-selection'],savedVersion:1}));
 await assert.rejects(pending,accountChanged);
});

test('a discarded body decode failure reports an account transition instead of an old response error',async t=>{
 const io=streamedTransport(t),pending=io.client.request('/auth/session');
 await settle();clearCsrfToken();io.finish('{not-valid-json');
 await assert.rejects(pending,accountChanged);
});

test('the current generation retains normal JSON and genuine session-expiry semantics',async t=>{
 const io=streamedTransport(t),pending=io.client.request('/requests');
 await settle();setCsrfToken('provider-race-current-fixture');
 io.finish(JSON.stringify([{id:'current-request'}]));
 assert.deepEqual(await pending,[{id:'current-request'}]);
 let expirations=0;io.events.addEventListener('idealmakoo:session-expired',()=>{expirations++;});
 globalThis.fetch=async()=>Response.json({code:'SESSION_REQUIRED',title:'Unauthorized'},{status:401});
 await assert.rejects(io.client.request('/me/settings'),error=>error instanceof ApiError&&error.status===401&&error.problem.code==='SESSION_REQUIRED');
 assert.equal(expirations,1);
 globalThis.fetch=async()=>new Response(null,{status:204});
 assert.equal(await io.client.request('/auth/logout'),undefined);
});

const [storage,userSettings,auth,routing,frontState,portalData,capabilities,guestStorage]=await Promise.all([
 loadTs('src/lib/storage.ts'),loadTs('src/lib/user-settings.ts'),loadTs('src/lib/auth.ts'),
 loadTs('src/lib/locale-routing.ts'),loadTs('src/lib/frontend-state.ts'),loadTs('src/components/account/portal-data.ts'),
 loadTs('src/lib/private-capabilities.ts'),loadTs('src/lib/guest-inquiry.ts')
]);

// Extract the actual provider declarations, ownership expressions, callbacks
// and their real effect dependency arrays. The host below replaces only React's
// state/effect scheduling and browser I/O; it does not implement the provider's
// business logic. Rendering separately from committing effects makes the first
// render of an account/role/locale transition observable.
const providerPath='src/components/providers/AppProvider.tsx';
const providerSource=ts.createSourceFile(providerPath,readFileSync(new URL('../'+providerPath,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const providerFunction=providerSource.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='AppProviderRuntime');
assert.ok(providerFunction?.body);
const declarationNames=new Set([
 'locale','publicTokenPage','publicTokenRef','session','serverSessionReady','authGeneration','authGenerationRef',
 'requestContextKey','requestContextRef','contextCurrent','requestSequence','settingsSequence','sessionError','sessionReady',
 'settingsState','settingsError','identityRef','settingsOwner','settingsContext','userSettings','settingsReady',
 'inquiries','compare','saved','requests','requestResolution','currentRequestResolution','requestsReady','requestsError','visibleRequests','reloadRequests',
 'collectionMeta','collectionOwner','collectionReady','visibleCollections','visibleCollectionMeta','metaRef','guestMerge','mergeBusy','merging',
 'requestRef','collectionRef','collectionQueue','acceptCollection','advanceAuth','attemptGuestMerge','acceptSession',
 'saveSettings','saveProfile','savePreferences','saveCollection','setInquiries','setCompare','setSaved',
 'href','signIn','profileName','isDefaultDemoName','displayName','displaySession','signOut','createRequest','updateRequest'
]);
const refAssignments=new Set(['publicTokenRef.current','requestContextRef.current','identityRef.current','metaRef.current','requestRef.current','collectionRef.current']);
function boundNames(node){if(ts.isIdentifier(node))return[node.text];return node.elements.flatMap(element=>ts.isBindingElement(element)?boundNames(element.name):[]);}
const selected=[];let selectedEffects=0;
for(const statement of providerFunction.body.statements){
 if(ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(node=>boundNames(node.name).some(name=>declarationNames.has(name))))selected.push(statement.getText(providerSource));
 else if(ts.isExpressionStatement(statement)){
  const expression=statement.expression;
  if(ts.isBinaryExpression(expression)&&refAssignments.has(expression.left.getText(providerSource)))selected.push(statement.getText(providerSource));
  if(ts.isCallExpression(expression)&&expression.expression.getText(providerSource)==='useEffect'){
   const body=expression.arguments[0].getText(providerSource);
   if(body.includes("'/auth/session'")||body.includes('const loadRequests=')||body.includes("const refresh=()=>setRequests(readAppStore")){selected.push(statement.getText(providerSource));selectedEffects++;}
  }
 }
}
assert.equal(selectedEffects,3,'The real bootstrap, private-data and demo request effects must all be exercised.');
for(const name of declarationNames)assert.ok(selected.some(text=>new RegExp('\\b'+name+'\\b').test(text)),`Actual provider declaration ${name} is present`);
const persistedHelpers=providerSource.statements.filter(node=>ts.isFunctionDeclaration(node)&&['readAppStore','usePersisted'].includes(node.name?.text)).map(node=>node.getText(providerSource)).join('\n');
assert.equal(providerSource.statements.filter(node=>ts.isFunctionDeclaration(node)&&['readAppStore','usePersisted'].includes(node.name?.text)).length,2);
const exposed=[...declarationNames].filter(name=>!['locale','publicTokenPage'].includes(name));
const providerScript=new Script(ts.transpileModule(`${persistedHelpers}\nfunction Probe({pathname,layoutLocale}){\n${selected.join('\n')}\nreturn {${exposed.join(',')},locale,publicTokenPage};\n}\nProbe;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{filename:providerPath+'.actual-callback-probe.js'});

const copy=value=>JSON.parse(JSON.stringify(value));
const account=(id='account-a',role='customer')=>({id,role,name:`Fixture ${id}`,email:`${id}@example.test`,demo:false});
const requestRow=(id='request-a',version=1,ownerId='account-a')=>({id,version,ownerId,kind:'contact',locale:'en',name:'Fixture requester',email:`${ownerId}@example.test`,message:`Fixture ${id}`,productIds:[],status:'new',createdAt:'2026-10-20T10:00:00.000Z'});
const collection=(label='a',version=1)=>({inquiries:[{productId:`product-${label}`,quantity:1}],compare:[`compare-${label}`],saved:[`saved-${label}`],collectionVersion:version,savedVersion:version,defaultWishlistId:`wishlist-${label}`});
function memoryStorage(){const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,String(value));},removeItem:key=>{values.delete(key);},clear:()=>values.clear()};}
function providerHost(t,{demo=false,pathname='/en/account/requests'}={}){
 const previous=new Map(['fetch','window','localStorage','sessionStorage'].map(key=>[key,globalThis[key]]));
 const calls=[],notices=[],navigations=[],browser=new EventTarget(),local=memoryStorage(),temporary=memoryStorage();
 Object.assign(browser,{localStorage:local,sessionStorage:temporary,location:{pathname,search:'',hash:''},matchMedia:()=>({matches:true})});
 globalThis.window=browser;globalThis.localStorage=local;globalThis.sessionStorage=temporary;
 globalThis.fetch=(url,options={})=>new Promise((resolve,reject)=>{
  const entry={url:String(url),path:String(url).replace(/^\/api\/v1/,''),method:options.method||'GET',headers:new Headers(options.headers),body:options.body?JSON.parse(options.body):undefined,settled:false,
   resolve(value,status=200){assert.equal(entry.settled,false);entry.settled=true;resolve(status===204?new Response(null,{status}):Response.json(value,{status}));},
   reject(error){assert.equal(entry.settled,false);entry.settled=true;reject(error);}
  };calls.push(entry);
 });
 clearCsrfToken();
 const hooks=[];let cursor=0,pending=[],dirty=false,view,closed=false,props={pathname,layoutLocale:'en'};
 const changed=(before,after)=>!before||before.length!==after.length||after.some((value,index)=>!Object.is(value,before[index]));
 const slot=(kind,create)=>{const index=cursor++;if(!hooks[index])hooks[index]={kind,...create()};assert.equal(hooks[index].kind,kind,'Actual hook order remains stable');return hooks[index];};
 const useState=initial=>{const hook=slot('state',()=>({value:typeof initial==='function'?initial():initial}));hook.set??=(action)=>{const next=typeof action==='function'?action(hook.value):action;if(!Object.is(next,hook.value)){hook.value=next;dirty=true;}};return[hook.value,hook.set];};
 const useRef=initial=>slot('ref',()=>({ref:{current:initial}})).ref;
 const useMemo=(callback,dependencies)=>{const hook=slot('memo',()=>({}));if(changed(hook.dependencies,dependencies)){hook.value=callback();hook.dependencies=dependencies;}return hook.value;};
 const useCallback=(callback,dependencies)=>useMemo(()=>callback,dependencies);
 const useEffect=(callback,dependencies)=>{const hook=slot('effect',()=>({}));if(changed(hook.dependencies,dependencies)){hook.dependencies=dependencies;pending.push({hook,callback});}};
 const client=new HttpClient('/api/v1');
 const runtime=providerScript.runInNewContext({useState,useRef,useMemo,useCallback,useEffect,demoMode:demo,dataMode:demo?'local':'api',
  ...storage,...userSettings,...auth,...routing,...frontState,...portalData,...capabilities,...guestStorage,
  apiClient:client,apiRequests:new HttpRequestRepository(client),ApiError,setCsrfToken,clearCsrfToken,
  networkError:error=>error.message,window:browser,localStorage:local,sessionStorage:temporary,Event,CustomEvent,
  crypto:globalThis.crypto,Date,Promise,JSON,Array,Object,Error,Number,String,
  getPublishedProductInventory:()=>[],notify:value=>notices.push(value),t:key=>key,accountText:(_locale,key)=>key,
  applyDisplayPreferences:()=> 'dark',router:{push:path=>navigations.push(path)}
 });
 function render(patch={}){assert.equal(pending.length,0,'Commit the previous render before starting another render');props={...props,...patch};browser.location.pathname=props.pathname;cursor=0;dirty=false;view=runtime(props);return view;}
 function commit(){let iterations=0;while(pending.length||dirty){assert.ok(++iterations<=20,'Provider effects settle without a render loop');const work=pending;pending=[];for(const {hook,callback}of work){hook.cleanup?.();hook.cleanup=callback();}if(dirty)render();}return view;}
 async function flush(){for(let index=0;index<4;index++){commit();await settle();}commit();return view;}
 const host={calls,notices,navigations,browser,local,temporary,render,commit,flush,get view(){return view;},
  pending(path,method='GET'){return calls.filter(call=>call.path===path&&call.method===method&&!call.settled);},
  next(path,method='GET'){const match=this.pending(path,method)[0];assert.ok(match,`Expected pending ${method} ${path}; observed ${calls.map(item=>item.method+' '+item.path+(item.settled?' done':' pending')).join(', ')}`);return match;},
  async bootstrap(user=account()){this.next('/auth/session').resolve({user,csrfToken:'provider-server-fixture'});await flush();return view;},
  async ready(user=account(),rows=[requestRow()],items=collection()){
   await this.bootstrap(user);this.next('/requests').resolve(rows);
   if(user){this.next('/me/settings').resolve({...userSettings.defaultUserSettings(user,'en'),revision:1});this.next('/me/collection').resolve(items);}
   await flush();return view;
  },
  close(){if(closed)return;closed=true;for(const hook of hooks)if(hook.kind==='effect')hook.cleanup?.();for(const [key,value]of previous){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}clearCsrfToken();}
 };
 t.after(()=>host.close());render();commit();return host;
}

test('a late bootstrap success cannot adopt an earlier account after an explicit accepted session',async t=>{
 const host=providerHost(t),old=host.next('/auth/session');
 host.view.acceptSession(account('account-b'),'provider-server-fixture');host.commit();await host.flush();
 old.resolve({user:account('account-a'),csrfToken:'obsolete-fixture-token'});await host.flush();
 assert.equal(host.view.session.id,'account-b');assert.equal(host.view.sessionError,'');assert.equal(host.view.sessionReady,true);
 assert.equal(host.calls.filter(call=>call.path==='/auth/session').length,1);
});

test('a delayed bootstrap transport error cannot clear an accepted session or its current data',async t=>{
 const host=providerHost(t),old=host.next('/auth/session');
 host.view.acceptSession(account('account-b'),'provider-server-fixture');host.commit();await host.flush();
 host.next('/requests').resolve([requestRow('request-b',1,'account-b')]);host.next('/me/collection').resolve(collection('b',7));host.next('/me/settings').resolve({...userSettings.defaultUserSettings(account('account-b'),'en'),revision:1});await host.flush();
 old.reject(new Error('Old bootstrap transport failure'));await host.flush();
 assert.equal(host.view.session.id,'account-b');assert.equal(host.view.visibleRequests[0].id,'request-b');assert.equal(host.view.visibleCollections.saved[0],'saved-b');assert.equal(host.view.sessionError,'');
});

test('request loading and failure stay distinct from a successfully loaded empty list, and retry is live',async t=>{
 const host=providerHost(t);await host.bootstrap();
 assert.equal(host.view.requestsReady,false);assert.equal(host.view.requestsError,'');assert.equal(host.view.visibleRequests.length,0);
 host.next('/requests').reject(new Error('Fixture list unavailable'));await host.flush();
 assert.equal(host.view.requestsReady,false);assert.equal(host.view.requestsError,'Fixture list unavailable');assert.equal(host.view.visibleRequests.length,0);
 host.view.reloadRequests();assert.equal(host.pending('/requests').length,1);await host.flush();assert.equal(host.view.requestsError,'');
 host.next('/requests').resolve([]);await host.flush();assert.equal(host.view.requestsReady,true);assert.equal(host.view.requestsError,'');assert.equal(host.view.visibleRequests.length,0);
});

test('out-of-order request refreshes cannot replace the newest list or its failure state',async t=>{
 const host=providerHost(t);await host.ready();host.browser.dispatchEvent(new Event('focus'));const old=host.next('/requests');host.view.reloadRequests();const latest=host.pending('/requests')[1];
 latest.resolve([requestRow('newest',4)]);await host.flush();old.resolve([requestRow('stale',2)]);await host.flush();assert.equal(host.view.visibleRequests[0].id,'newest');
 host.view.reloadRequests();const stale=host.next('/requests');host.view.reloadRequests();const failed=host.pending('/requests')[1];
 failed.reject(new Error('Newest refresh failed'));await host.flush();stale.resolve([requestRow('obsolete-success',5)]);await host.flush();
 assert.equal(host.view.requestsReady,false);assert.equal(host.view.requestsError,'Newest refresh failed');assert.equal(host.view.visibleRequests.length,0);
});

test('the very first role and locale render masks request, collection, metadata and settings ownership',async t=>{
 const host=providerHost(t);await host.ready();assert.equal(host.view.visibleCollectionMeta.savedVersion,1);
 host.render({pathname:'/tr/account/requests'});
 assert.equal(host.view.visibleRequests.length,0);assert.equal(host.view.visibleCollections.saved.length,0);assert.equal(host.view.visibleCollectionMeta.savedVersion,0);assert.equal(host.view.userSettings,null);assert.equal(host.view.settingsReady,false);
 host.commit();await host.flush();host.next('/requests').resolve([requestRow('turkish-current',2)]);host.next('/me/collection').resolve(collection('tr',2));host.next('/me/settings').resolve({...userSettings.defaultUserSettings(account(),'tr'),revision:2});await host.flush();
 host.view.acceptSession(account('account-a','contentEditor'),'provider-server-fixture');
 assert.equal(host.view.requestRef.current.length,0,'The accepted transition clears imperative references before rendering.');assert.equal(host.view.metaRef.current.savedVersion,0);
 host.render();assert.equal(host.view.visibleRequests.length,0);assert.equal(host.view.visibleCollections.saved.length,0);assert.equal(host.view.userSettings,null);host.commit();
});

test('returning to the same account after another session cannot revive its old response',async t=>{
 const host=providerHost(t);await host.ready();host.view.reloadRequests();const old=host.next('/requests');
 host.view.acceptSession(account('account-b'),'provider-server-fixture');host.commit();await host.flush();
 host.view.acceptSession(account('account-a'),'provider-server-fixture');host.commit();await host.flush();
 const current=host.pending('/requests').at(-1);current.resolve([requestRow('account-a-current',8)]);await host.flush();old.resolve([requestRow('account-a-obsolete',2)]);await host.flush();
 assert.equal(host.view.visibleRequests[0].id,'account-a-current');assert.equal(host.view.session.id,'account-a');
});

test('a request mutation invalidates an older GET and a conflict refresh uses the same list owner',async t=>{
 const host=providerHost(t);await host.ready();host.view.reloadRequests();const oldRead=host.next('/requests');
 const mutation=host.view.updateRequest('request-a',{status:'withdrawn'});await host.flush();host.next('/requests/request-a','PATCH').resolve({...requestRow('request-a',2),status:'withdrawn'});assert.equal(await mutation,true);await host.flush();
 oldRead.resolve([requestRow('request-a',1)]);await host.flush();assert.equal(host.view.visibleRequests[0].version,2);
 const current=host.next('/requests');current.resolve([{...requestRow('request-a',2),status:'withdrawn'}]);await host.flush();
 const conflict=host.view.updateRequest('request-a',{message:'Concurrent edit'});await host.flush();host.next('/requests/request-a','PATCH').resolve({title:'Version conflict',detail:'Review newer request',code:'VERSION_CONFLICT'},412);assert.equal(await conflict,false);await host.flush();
 assert.equal(host.pending('/requests').length,1);host.next('/requests').resolve([requestRow('request-a',3)]);await host.flush();assert.equal(host.view.visibleRequests[0].version,3);
});

test('a lower-version mutation response cannot overwrite a later version of the same request',async t=>{
 const host=providerHost(t);await host.ready();const first=host.view.updateRequest('request-a',{message:'First edit'}),second=host.view.updateRequest('request-a',{message:'Second edit'});await host.flush();
 const [a,b]=host.pending('/requests/request-a','PATCH');b.resolve({...requestRow('request-a',3),message:'Newer committed response'});assert.equal(await second,true);await host.flush();a.resolve({...requestRow('request-a',2),message:'Older committed response'});assert.equal(await first,true);await host.flush();
 assert.equal(host.view.visibleRequests[0].version,3);assert.equal(host.view.visibleRequests[0].message,'Newer committed response');
});

test('late request create rejects its caller after a locale transition and cannot expose an old idempotent record',async t=>{
 const host=providerHost(t);await host.ready();const oldCreate=host.view.createRequest;
 const created=oldCreate({kind:'callback',name:'Fixture',email:'a@example.test',message:'Create fixture',productIds:[],status:'new',idempotencyKey:'stable-fixture-create'});const rejected=assert.rejects(created,accountChanged);await host.flush();
 const write=host.next('/requests','POST');assert.equal(write.body.kind,'contact');assert.equal(write.headers.get('Idempotency-Key'),'stable-fixture-create');
 host.render({pathname:'/tr/account/requests'});host.commit();await host.flush();write.resolve({...requestRow('created-for-old-locale',1),idempotencyKey:'stable-fixture-create'});await rejected;await host.flush();
 assert.equal(host.view.visibleRequests.length,0);const before=host.calls.length;await assert.rejects(oldCreate({idempotencyKey:'stable-fixture-create'}),accountChanged);assert.equal(host.calls.length,before);
});

test('late request updates and stale logout callbacks do not mutate or revoke the replacement account',async t=>{
 const host=providerHost(t);await host.ready();const oldLogout=host.view.signOut,pending=host.view.updateRequest('request-a',{status:'withdrawn'});await host.flush();const write=host.next('/requests/request-a','PATCH');
 host.view.acceptSession(account('account-b'),'provider-server-fixture');host.commit();await host.flush();
 host.next('/requests').resolve([requestRow('request-b',1,'account-b')]);host.next('/me/collection').resolve(collection('b',5));host.next('/me/settings').resolve({...userSettings.defaultUserSettings(account('account-b'),'en'),revision:1});await host.flush();
 write.resolve({...requestRow('request-a',2),status:'withdrawn'});assert.equal(await pending,false);await host.flush();
 const before=host.calls.length;await oldLogout();assert.equal(host.calls.length,before,'The old logout callback must not send the new cookie to the logout endpoint.');assert.equal(host.view.session.id,'account-b');assert.equal(host.view.visibleRequests[0].id,'request-b');
});

test('collection reads and writes are serialized and each queued action uses the preceding committed metadata',async t=>{
 const host=providerHost(t);await host.bootstrap();const initial=host.next('/me/collection');
 const first=host.view.saveCollection('saved',items=>[...items,'first-added']);host.browser.dispatchEvent(new Event('idealmakoo:wishlists'));
 const second=host.view.saveCollection('saved',items=>[...items,'second-added']);await host.flush();assert.equal(host.calls.filter(call=>call.path==='/me/collection').length,1,'Queued writes and refreshes wait for the initial full DTO.');
 initial.resolve(collection('a',4));await host.flush();const firstWrite=host.next('/me/collection','PATCH');assert.equal(firstWrite.body.savedVersion,4);assert.deepEqual(firstWrite.body.saved,['saved-a','first-added']);
 firstWrite.resolve({...collection('a',5),saved:['saved-a','first-added']});assert.equal(await first,true);await host.flush();const refresh=host.next('/me/collection');assert.equal(host.pending('/me/collection','PATCH').length,0);
 refresh.resolve({...collection('a',5),saved:['saved-a','first-added']});await host.flush();const secondWrite=host.next('/me/collection','PATCH');assert.equal(secondWrite.body.savedVersion,5);assert.deepEqual(secondWrite.body.saved,['saved-a','first-added','second-added']);
 secondWrite.resolve({...collection('a',6),saved:secondWrite.body.saved});assert.equal(await second,true);await host.flush();assert.deepEqual(copy(host.view.visibleCollections.saved),['saved-a','first-added','second-added']);assert.equal(host.view.visibleCollectionMeta.savedVersion,6);
});

test('a collection conflict refetch finishes inside its queue before the next write can read its CAS version',async t=>{
 const host=providerHost(t);await host.ready();const first=host.view.saveCollection('inquiries',[]),second=host.view.saveCollection('inquiries',items=>[...items,{productId:'new-product',quantity:2}]);await host.flush();
 host.next('/me/collection','PATCH').resolve({title:'Version conflict',detail:'Fixture conflict'},409);await host.flush();assert.equal(host.pending('/me/collection','PATCH').length,0);host.next('/me/collection').resolve(collection('concurrent',9));assert.equal(await first,false);await host.flush();
 const next=host.next('/me/collection','PATCH');assert.equal(next.body.collectionVersion,9);assert.equal(next.body.inquiries[0].productId,'product-concurrent');next.resolve({...collection('concurrent',10),inquiries:next.body.inquiries});assert.equal(await second,true);await host.flush();assert.equal(host.view.visibleCollectionMeta.collectionVersion,10);
});

test('changing accounts detaches the blocked collection queue without adopting or sending the old queued action',async t=>{
 const host=providerHost(t);await host.bootstrap();const oldRead=host.next('/me/collection'),queued=host.view.saveCollection('saved',['must-not-send']);
 host.view.acceptSession(account('account-b'),'provider-server-fixture');host.commit();await host.flush();const newRead=host.pending('/me/collection').at(-1);assert.notEqual(newRead,oldRead,'The new account does not wait for the old transport.');
 newRead.resolve(collection('b',8));await host.flush();oldRead.resolve(collection('a',99));assert.equal(await queued,false);await host.flush();
 assert.equal(host.calls.filter(call=>call.path==='/me/collection'&&call.method==='PATCH').length,0);assert.equal(host.view.visibleCollections.saved[0],'saved-b');assert.equal(host.view.visibleCollectionMeta.savedVersion,8);
});

test('guest inquiry merge shares the collection queue and is never transferred to another account',async t=>{
 const host=providerHost(t),source={schemaVersion:1,id:crypto.randomUUID(),locale:'en',items:[{productId:'guest-product',quantity:3}],createdAt:new Date().toISOString()};
 assert.equal(guestStorage.writeGuestInquiry(source),true);await host.bootstrap();host.next('/me/collection').resolve(collection('a',1));await host.flush();const merge=host.next('/me/collection/merge','POST');assert.equal(guestStorage.readGuestInquiry().userId,'account-a');
 const queued=host.view.saveCollection('saved',items=>[...items,'after-merge']);await host.flush();assert.equal(host.pending('/me/collection','PATCH').length,0);merge.resolve({collection:{...collection('a',2),saved:['merged-saved']},duplicate:false});await host.flush();
 const write=host.next('/me/collection','PATCH');assert.equal(write.body.savedVersion,2);assert.deepEqual(write.body.saved,['merged-saved','after-merge']);write.resolve({...collection('a',3),saved:write.body.saved});assert.equal(await queued,true);await host.flush();assert.equal(guestStorage.readGuestInquiry(),null);
 guestStorage.writeGuestInquiry({...source,userId:'account-a'});host.view.acceptSession(account('account-b'),'provider-server-fixture');host.commit();await host.flush();host.next('/me/collection').resolve(collection('b',1));await host.flush();
 assert.equal(host.calls.filter(call=>call.path==='/me/collection/merge').length,1,'Account-bound guest data is never merged into another account.');
});

test('a successful settings write rejects an older initial read and later settings responses cannot cross a context',async t=>{
 const host=providerHost(t);await host.bootstrap();const old=host.next('/me/settings'),base=userSettings.defaultUserSettings(account(),'en');
 const save=host.view.saveSettings('profile',{name:'Updated fixture'},0);await host.flush();host.next('/me/profile','PATCH').resolve({...base,revision:2,profile:{...base.profile,name:'Updated fixture'}});assert.equal((await save).ok,true);await host.flush();
 old.resolve({...base,revision:1});await host.flush();assert.equal(host.view.userSettings.revision,2);assert.equal(host.view.userSettings.profile.name,'Updated fixture');
 const delayed=host.view.saveSettings('preferences',{language:'tr'},2);await host.flush();const patch=host.next('/me/preferences','PATCH');host.render({pathname:'/tr/account/requests'});host.commit();await host.flush();patch.resolve({...base,revision:3});assert.equal((await delayed).reason,'session');await host.flush();assert.equal(host.view.userSettings,null);
});

test('public capability pages start no private I/O and old private actions are rejected before send',async t=>{
 const host=providerHost(t,{pathname:'/en/saved-share/fixture-capability'});await host.flush();assert.equal(host.calls.length,0);assert.equal(host.view.visibleRequests.length,0);assert.equal(host.view.visibleCollections.saved.length,0);
 const write=host.view.saveCollection('saved',['private']);assert.equal(await write,false);await assert.rejects(host.view.createRequest({kind:'contact'}),accountChanged);await host.view.signOut();assert.equal(host.calls.length,0);
 host.render({pathname:'/en/account/requests'});host.commit();await host.ready();const previous=host.view,readCount=host.calls.length;
 host.render({pathname:'/en/feedback/fixture-capability'});assert.equal(host.view.visibleRequests.length,0);assert.equal(host.view.visibleCollections.saved.length,0);assert.equal(host.view.displaySession,null);host.commit();
 host.browser.dispatchEvent(new Event('focus'));previous.reloadRequests();assert.equal(await previous.saveCollection('saved',[]),false);await previous.signOut();await host.flush();assert.equal(host.calls.length,readCount);
});

test('normal logout clears visible account data and ignores requests that finish after logout',async t=>{
 const host=providerHost(t);await host.ready();host.view.reloadRequests();const old=host.next('/requests'),logout=host.view.signOut();await host.flush();host.next('/auth/logout','POST').resolve(null,204);await logout;await host.flush();
 assert.equal(host.view.session,null);assert.equal(host.view.visibleRequests.length,0);assert.equal(host.view.visibleCollections.saved.length,0);old.resolve([requestRow('obsolete-private-request',99)]);await host.flush();assert.equal(host.view.visibleRequests.length,0);assert.deepEqual(host.navigations,['/en/']);
});

test('leaving a capability page cannot reveal prior account data before fresh cookie authentication',async t=>{
 const host=providerHost(t);await host.ready();const oldLogout=host.view.signOut;host.render({pathname:'/en/saved-share/fixture-capability'});host.commit();await host.flush();
 const count=host.calls.length;assert.equal(host.view.visibleRequests.length,0);assert.equal(host.view.visibleCollections.saved.length,0);
 host.render({pathname:'/en/account/requests'});
 assert.equal(host.view.visibleRequests.length,0,'The first return render must not reveal the previous request owner before /auth/session can read the current cookie.');
 assert.equal(host.view.visibleCollections.saved.length,0);assert.equal(host.view.visibleCollectionMeta.savedVersion,0);assert.equal(host.view.sessionReady,false);assert.equal(host.view.displaySession,null);
 host.commit();assert.equal(host.calls.length,count+1);assert.equal(host.next('/auth/session').path,'/auth/session');
 await oldLogout();assert.equal(host.calls.length,count+1,'The prior logout callback cannot revoke a cookie while fresh bootstrap is pending.');
 host.next('/auth/session').resolve({user:account('account-b'),csrfToken:'current-cookie-after-capability-fixture'});await host.flush();assert.equal(host.view.session.id,'account-b');assert.equal(host.view.visibleRequests.length,0);
 host.next('/requests').resolve([requestRow('after-capability-request-b',1,'account-b')]);host.next('/me/collection').resolve(collection('b',3));host.next('/me/settings').resolve({...userSettings.defaultUserSettings(account('account-b'),'en'),revision:1});await host.flush();
 assert.equal(host.view.visibleRequests[0].id,'after-capability-request-b');assert.equal(host.view.visibleCollections.saved[0],'saved-b');
});

test('opt-in demo still uses actual local persistence and production cannot select a demo identity',async t=>{
 const host=providerHost(t,{demo:true});await host.flush();assert.equal(host.calls.length,0);const signed=host.view.signIn('customer');assert.equal(signed.role,'customer');host.commit();await host.flush();
 assert.equal(host.view.session.demo,true);assert.equal(JSON.parse(host.local.getItem('idealmakoo.session.v1')).id,signed.id);assert.equal(await host.view.saveCollection('saved',['demo-selection']),true);await host.flush();assert.deepEqual(JSON.parse(host.local.getItem('idealmakoo.saved.v1')),['demo-selection']);
 const record=await host.view.createRequest({kind:'contact',name:'Demo fixture',email:signed.email,message:'Local demo request',productIds:[],status:'new'});await host.flush();assert.equal(record.ownerId,signed.id);assert.ok(host.view.visibleRequests.some(row=>row.id===record.id));assert.equal(host.calls.length,0);
 await host.view.signOut();await host.flush();assert.equal(host.view.session,null);assert.equal(host.view.visibleCollections.saved.length,0);host.close();
 const production=providerHost(t);assert.equal(production.view.signIn('superAdmin'),null);assert.equal(production.view.session,null);assert.equal(production.local.getItem('idealmakoo.session.v1'),null);
});
