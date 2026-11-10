import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {releasePrivateEditor,observePrivateEditorNetwork,recordEditorCleanupFailure,safeEditorCleanupReceipt,editorCleanupProved,PRIVATE_EDITOR_CLEANUP_POLICY,LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY} from '../scripts/lib/private-audit-editor-cleanup.mjs';

const actor='21e8aac0-01b2-4e6b-90c1-724f72fd716d',foreign='31e8aac0-01b2-4e6b-90c1-724f72fd716d';
const lease='41e8aac0-01b2-4e6b-90c1-724f72fd716d',lateLease='51e8aac0-01b2-4e6b-90c1-724f72fd716d';
const baseUrl='http://127.0.0.1:3094',watermark='9007199254740993';
function harness(options={}){
 let time=0,currentUrl='about:blank',destroyed=0,navigated=false;
 const expectedUrl=options.expectedUrl||baseUrl+'/fa/admin/page-builder/home/',role=options.role||'superAdmin';
 const state={live:options.empty?[]:[{id:lease,user_id:actor}],events:[],queries:[],navigated:false,navigationAt:null,activeReads:0,document:{documentReady:true,contentReady:true,nestedEditorsReady:true,collaborationReady:true,formsPanelCount:0,collaborationPanelCount:0,...options.document}};
 const page=new EventEmitter(),frame={};page.url=()=>currentUrl;page.mainFrame=()=>frame;
 const network=observePrivateEditorNetwork(page);currentUrl=expectedUrl;page.emit('framenavigated',frame);
 page.evaluate=async(fn,args)=>{assert.equal(args.role,role);assert.equal(args.expectedUrl,expectedUrl);return options.evaluate?options.evaluate(fn,args,state,time):{...state.document};};
 const request={url:()=>baseUrl+'/api/v1/content/leases/'+lease,method:()=> 'DELETE',redirectChain:()=>[]};
 page.goto=async(url,settings)=>{
  assert.equal(url,baseUrl+'/robots.txt');assert.equal(settings.waitUntil,'domcontentloaded');assert(settings.timeout<=5000);
  navigated=true;state.navigated=true;state.navigationAt=time;currentUrl=url;page.emit('framenavigated',frame);
  if(options.navigate)options.navigate(state,page,request);else{state.live=[];if(!options.empty)state.events=[{id:'9007199254740994',actor_id:actor,lease_id:lease}];}
  return{status:()=>options.navigationStatus??200,url:()=>currentUrl,request:()=>({redirectChain:()=>options.redirect?[request]:[]})};
 };
 const client={query:async config=>{
  assert(config.query_timeout>0&&config.query_timeout<=2000);state.queries.push(config);
  if(options.queryFailure&&navigated)throw new Error('PRIVATE_DB_ERROR_MUST_NOT_ESCAPE');
  if(config.text.startsWith('BEGIN')){assert.equal(config.text,'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');return{rows:[]};}
  if(config.text.startsWith('SET LOCAL')){assert.equal(config.text,"SET LOCAL statement_timeout='2s'");return{rows:[]};}
  if(config.text.includes('MAX(id)'))return{rows:[{watermark}]};
  if(config.text.includes('FROM content_edit_leases')){state.activeReads++;options.active?.(state,time,page);assert.deepEqual(config.values,[actor]);assert.match(config.text,/WHERE user_id=\$1 AND lease_until>clock_timestamp\(\)/);return{rows:state.live};}
  assert.match(config.text,/WHERE actor_id=\$1 AND action='content\.lease\.released' AND id>\$2::bigint/);assert.equal(config.values[0],actor);assert.equal(config.values[1],watermark);
  return{rows:state.events};
 },release:destroy=>{assert.equal(destroy,true);destroyed++;}};
 const pool={connect:async()=>client};
 const clock={now:()=>time,sleep:async ms=>{time+=ms;options.tick?.(state,time,page);}};
 const release=()=>releasePrivateEditor({page,network,pool,clock,actorId:actor,baseUrl,expectedUrl,role,timeoutMs:options.timeoutMs??2000});
 return{page,network,pool,clock,state,release,run:()=>release().finally(()=>network.dispose()),closed:()=>destroyed};
}
test('exact committed release plus zero owned leases passes even without old-document HTTP response events',async()=>{
 const h=harness(),receipt=await h.run();assert(editorCleanupProved(receipt));assert.equal(receipt.policy,PRIVATE_EDITOR_CLEANUP_POLICY);
 assert.equal(receipt.beforeCount,1);assert.equal(receipt.releasedCount,1);assert.equal(receipt.observedReleaseResponses,0);assert.deepEqual(receipt.releaseStatuses,[]);
 assert.equal(h.closed(),1);assert.equal(h.page.eventNames().length,0);
 const text=JSON.stringify(receipt);for(const secret of [actor,lease,watermark,'PRIVATE_DB_ERROR'])assert(!text.includes(secret));
});
test('a page with no editor still performs ordinary navigation and a bounded quiet observation',async()=>{
 const h=harness({empty:true}),receipt=await h.run();assert(editorCleanupProved(receipt));assert.equal(receipt.trackedCount,0);assert(receipt.settledForMs>=500);assert.equal(h.closed(),1);
});
test('a late owned acquisition must also have its exact committed release before success',async()=>{
 const h=harness({navigate(state){state.live=[{id:lateLease,user_id:actor}];state.events=[{id:'9007199254740994',actor_id:actor,lease_id:lease}];},tick(state,time){if(state.navigated&&time>=state.navigationAt+100){state.live=[];state.events=[{id:'9007199254740994',actor_id:actor,lease_id:lease},{id:'9007199254740995',actor_id:actor,lease_id:lateLease}];}}});
 const receipt=await h.run();assert(editorCleanupProved(receipt));assert.equal(receipt.beforeCount,1);assert.equal(receipt.trackedCount,2);assert.equal(receipt.releasedCount,2);
});
test('expiry or disappearance without a committed exact-ID release cannot pass',async()=>{
 const h=harness({navigate(state){state.live=[];state.events=[];}});
 await assert.rejects(h.run(),error=>error.code==='AUDIT_EDITOR_CLEANUP_TIMEOUT'&&error.receipt.remainingCount===0&&error.receipt.releasedCount===0);
 assert.equal(h.closed(),1);assert.equal(h.page.eventNames().length,0);
});
for(const [label,event] of [
 ['foreign actor',{id:'9007199254740994',actor_id:foreign,lease_id:lease}],
 ['pre-watermark event',{id:watermark,actor_id:actor,lease_id:lease}],
 ['different lease',{id:'9007199254740994',actor_id:actor,lease_id:lateLease}],
])test(`${label} cannot satisfy the exact release proof`,async()=>{
 const h=harness({navigate(state){state.live=[];state.events=[event];}});await assert.rejects(h.run(),{code:'AUDIT_EDITOR_CLEANUP_PROOF_INVALID'});assert.equal(h.closed(),1);
});
test('foreign or excessive active rows fail closed without publishing their identities',async()=>{
 for(const live of [[{id:lease,user_id:foreign}],Array.from({length:65},()=>({id:lease,user_id:actor}))]){
  const h=harness();h.state.live=live;await assert.rejects(h.run(),error=>['AUDIT_EDITOR_CLEANUP_PROOF_INVALID','AUDIT_EDITOR_CLEANUP_BOUND'].includes(error.code)&&!JSON.stringify(error.receipt).includes(foreign));assert.equal(h.closed(),1);
 }
});
test('observed failed DELETE or request failure cannot be overruled by a successful database receipt',async()=>{
 for(const kind of ['response','requestfailed']){
  const h=harness({navigate(state,page,request){state.live=[];state.events=[{id:'9007199254740994',actor_id:actor,lease_id:lease}];page.emit('request',request);page.emit(kind,kind==='response'?{request:()=>request,status:()=>403}:request);}});
  await assert.rejects(h.run(),{code:'AUDIT_EDITOR_CLEANUP_HTTP_FAILED'});assert.equal(h.closed(),1);
 }
});
test('redirects, navigation failure and query failure remain cleanup failures with owned teardown',async()=>{
 for(const options of [{redirect:true},{navigationStatus:404},{queryFailure:true}]){
  const h=harness(options);await assert.rejects(h.run(),error=>error.code.startsWith('AUDIT_EDITOR_CLEANUP_')&&!error.message.includes('PRIVATE_DB_ERROR'));assert.equal(h.closed(),1);assert.equal(h.page.eventNames().length,0);
 }
});
test('connection timeout destroys a late owned connection and never launches navigation',async()=>{
 let resolveConnection,releases=0,navigations=0;const page=new EventEmitter();page.goto=()=>{navigations++;};
 page.url=()=> 'about:blank';const network=observePrivateEditorNetwork(page);
 const pool={connect:()=>new Promise(resolve=>{resolveConnection=resolve;})};
 await assert.rejects(releasePrivateEditor({page,network,pool,actorId:actor,baseUrl,expectedUrl:baseUrl+'/en/admin/',role:'superAdmin',timeoutMs:500}),{code:'AUDIT_EDITOR_CLEANUP_TIMEOUT'});
 resolveConnection({release:destroy=>{assert.equal(destroy,true);releases++;}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(releases,1);assert.equal(navigations,0);network.dispose();assert.equal(page.eventNames().length,0);
});
test('cleanup failure retains an earlier outcome and measured scores while completed pages become errors',()=>{
 for(const earlier of [{status:'error',errorCode:'AUDIT_LIGHTHOUSE_RUNTIME_ERROR'},{status:'timeout',errorCode:'AUDIT_DEADLINE_EXCEEDED'},{status:'error',errorCode:'AUDIT_INTERRUPTED'},{status:'completed'}]){
  const result={...earlier,scores:{performance:83},metrics:{'largest-contentful-paint':3456}};
  recordEditorCleanupFailure(result,Object.assign(new Error('PRIVATE_ERROR'),{code:'AUDIT_EDITOR_CLEANUP_TIMEOUT'}));
  assert.equal(result.status,earlier.status==='completed'?'error':earlier.status);assert.equal(result.errorCode,earlier.errorCode??'AUDIT_EDITOR_CLEANUP_FAILED');
  assert.deepEqual(result.scores,{performance:83});assert.equal(result.cleanupError.code,'AUDIT_EDITOR_CLEANUP_TIMEOUT');assert(!JSON.stringify(result).includes('PRIVATE_ERROR'));
 }
});
test('safe receipts reject type coercion and omit all arbitrary identity fields',async()=>{
 const receipt=await harness().run(),dirty={...receipt,actorId:actor,leaseId:lease,watermark,token:'SECRET',cookie:'SECRET'};
 assert.deepEqual(safeEditorCleanupReceipt(dirty),receipt);
 for(const changes of [{success:'true'},{remainingCount:'0'},{releasedCount:0},{trackedCount:0},{observedReleaseFailures:1},{releaseStatuses:[403]},{settledForMs:0},{settlementSucceeded:false},{settlementQuietForMs:499},{pendingRequestsAtNavigation:1},{documentReady:false},{nestedEditorsReady:false},{policy:'old-unverified-policy'}])assert.equal(editorCleanupProved({...receipt,...changes}),false);
});

test('headers received before the acquisition body do not count as network completion',async()=>{
 const acquisition={url:()=>baseUrl+'/api/v1/content/leases',method:()=> 'POST'};
 const h=harness({evaluate(fn,args,state,time){assert(time>=700,'Do not evaluate the document before its pending response body finishes.');return {...state.document};},tick(state,time,page){if(time===700){assert.equal(state.navigated,false);page.emit('requestfinished',acquisition);}else if(time<700)assert.equal(state.navigated,false);}});
 h.page.emit('request',acquisition);h.page.emit('response',{request:()=>acquisition,status:()=>201});
 assert.equal(h.network.snapshot().pendingCount,1);
 const receipt=await h.run();assert(editorCleanupProved(receipt));assert.equal(h.state.navigationAt,1200);assert.equal(receipt.pendingRequestsAtNavigation,0);assert.equal(receipt.settlementQuietForMs,500);
});

test('an absent nested form and then a pending acquisition both prevent early navigation',async()=>{
 const detail={url:()=>baseUrl+'/api/v1/workspace/forms/owned-form',method:()=> 'GET'};
 const acquisition={url:()=>baseUrl+'/api/v1/content/leases',method:()=> 'POST'};
 const h=harness({empty:true,expectedUrl:baseUrl+'/tr/admin/forms/',timeoutMs:2500,document:{nestedEditorsReady:false},
  tick(state,time,page){
   if(time===700){page.emit('requestfinished',detail);Object.assign(state.document,{formsPanelCount:1,collaborationPanelCount:1,nestedEditorsReady:true,collaborationReady:false});page.emit('request',acquisition);state.live=[{id:lateLease,user_id:actor}];page.emit('response',{request:()=>acquisition,status:()=>201});}
   if(time===1000){assert.equal(state.navigated,false);page.emit('requestfinished',acquisition);state.document.collaborationReady=true;}
  },navigate(state){state.live=[];state.events=[{id:'9007199254740994',actor_id:actor,lease_id:lateLease}];}});
 h.page.emit('request',detail);h.page.emit('response',{request:()=>detail,status:()=>200});
 const receipt=await h.run();assert(editorCleanupProved(receipt));assert.equal(receipt.beforeCount,0);assert.equal(receipt.trackedCount,1);assert.equal(receipt.releasedCount,1);assert.equal(h.state.navigationAt,1500);assert.equal(receipt.formsPanelCount,1);
});

test('actual document, expected body and nested editor readiness are all required even with zero requests',async()=>{
 for(const flag of ['documentReady','contentReady','nestedEditorsReady','collaborationReady']){
  const h=harness({document:{[flag]:false},tick(state,time){if(time===600)state.document[flag]=true;else if(time<600)assert.equal(state.navigated,false);}});
  const receipt=await h.run();assert(editorCleanupProved(receipt));assert.equal(h.state.navigationAt,1100);
 }
});

test('a request started during the fresh pre-navigation ownership sample restarts the quiet period',async()=>{
 const acquisition={url:()=>baseUrl+'/api/v1/content/leases',method:()=> 'POST'};let readsAt500=0,started=false;
 const h=harness({timeoutMs:2500,active(state,time,page){if(time===500&&++readsAt500===2){started=true;page.emit('request',acquisition);}},tick(state,time,page){if(time===800&&started)page.emit('requestfinished',acquisition);}});
 const receipt=await h.run();assert(started);assert(editorCleanupProved(receipt));assert.equal(h.state.navigationAt,1300);
});

test('both pre-navigation settlement and post-navigation proof consume the same original fifteen seconds',async()=>{
 for(const readyAt of [14600,14300]){
  const h=harness({timeoutMs:15000,document:{contentReady:false},tick(state,time){if(time===readyAt)state.document.contentReady=true;}});
  await assert.rejects(h.run(),error=>error.code==='AUDIT_EDITOR_CLEANUP_TIMEOUT'&&error.receipt.budgetMs===15000&&error.receipt.durationMs===15000&&error.receipt.success===false);
  assert.equal(h.state.navigationAt,readyAt===14600?null:14800);assert.equal(h.closed(),1);
 }
});

test('requestfailed is terminal for network settlement',async()=>{
 const request={url:()=>baseUrl+'/api/v1/non-mutating-probe',method:()=> 'GET'};
 const h=harness({tick(state,time,page){if(time===400)page.emit('requestfailed',request);}});h.page.emit('request',request);
 const receipt=await h.run();assert(editorCleanupProved(receipt));assert.equal(h.state.navigationAt,900);
});

test('navigation never discards pending requests; redirects and request failures drain their exact request objects',()=>{
 const page=new EventEmitter(),frame={};page.url=()=> 'about:blank';page.mainFrame=()=>frame;
 const network=observePrivateEditorNetwork(page),first={},second={};
 page.emit('request',first);page.emit('framenavigated',frame);assert.equal(network.snapshot().pendingCount,1);
 page.emit('requestfinished',first);page.emit('request',second);assert.equal(network.snapshot().pendingCount,1);
 page.emit('response',{request:()=>second});assert.equal(network.snapshot().pendingCount,1);page.emit('requestfailed',second);assert.equal(network.snapshot().pendingCount,0);
 assert.equal(network.snapshot().documentVersion,1);network.dispose();network.dispose();assert.equal(page.eventNames().length,0);assert.equal(network.snapshot().disposed,true);
});

test('the observer is page-bound, requires early construction, bounds pending state, and rejects closed or disposed reuse',async()=>{
 const bad=new EventEmitter();bad.url=()=>baseUrl+'/en/admin/';assert.throws(()=>observePrivateEditorNetwork(bad),{code:'AUDIT_EDITOR_CLEANUP_OBSERVER_ARGUMENT'});
 for(const mode of ['bound','closed','disposed']){
  const h=harness();
  if(mode==='bound')for(let index=0;index<513;index++)h.page.emit('request',{});
  if(mode==='closed')h.page.emit('close');if(mode==='disposed')h.network.dispose();
  await assert.rejects(h.run(),{code:mode==='bound'?'AUDIT_EDITOR_CLEANUP_BOUND':'AUDIT_EDITOR_CLEANUP_OBSERVER_CLOSED'});
  assert.equal(h.state.navigated,false);assert.equal(h.page.eventNames().length,0);
 }
 const h=harness(),other=harness();await assert.rejects(releasePrivateEditor({page:h.page,network:other.network,pool:h.pool,actorId:actor,baseUrl,expectedUrl:baseUrl+'/en/admin/',role:'superAdmin'}),{code:'AUDIT_EDITOR_CLEANUP_OBSERVER_ARGUMENT'});h.network.dispose();other.network.dispose();
});

test('per-attempt teardown leaves the lifecycle observer active until the owning child disposes it',async()=>{
 const h=harness(),receipt=await h.release();assert(editorCleanupProved(receipt));assert.equal(h.network.snapshot().disposed,false);
 assert.equal(h.page.listenerCount('response'),0);assert.equal(h.page.listenerCount('request'),1);assert.equal(h.page.listenerCount('requestfinished'),1);assert.equal(h.page.listenerCount('requestfailed'),1);
 h.network.dispose();assert.equal(h.page.eventNames().length,0);
});

test('legacy v1 proof keeps its original requirements and never gains v2 settlement claims',async()=>{
 const current=await harness().run(),legacy={...current,policy:LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY,durationMs:650};
 for(const key of ['settlementDurationMs','settlementQuietForMs','pendingRequestsAtNavigation','collaborationPanelCount','formsPanelCount','settlementSucceeded','documentReady','contentReady','nestedEditorsReady','collaborationReady'])delete legacy[key];
 assert(editorCleanupProved(legacy));assert.deepEqual(safeEditorCleanupReceipt({...legacy,settlementSucceeded:true}),legacy);assert.equal(editorCleanupProved({...legacy,policy:PRIVATE_EDITOR_CLEANUP_POLICY}),false);
 for(const changes of [{releasedCount:0},{remainingCount:1},{settledForMs:499},{durationMs:15001},{success:false},{observedRequestFailures:1}])assert.equal(editorCleanupProved({...legacy,...changes}),false);
});
