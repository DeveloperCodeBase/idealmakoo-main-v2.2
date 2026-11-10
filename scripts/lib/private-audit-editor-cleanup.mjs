// Audit-only teardown. The application remains the sole owner of lease writes.
// A committed release audit row and zero active owned leases prove normal
// pagehide release even when the old document loses its keepalive response.
export const LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY='authenticated-robots-committed-lease-release-v1';
export const PRIVATE_EDITOR_CLEANUP_POLICY='authenticated-robots-settled-committed-lease-release-v2';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const BIGINT=/^(?:0|[1-9][0-9]{0,19})$/;
const MAX_LEASES=64,MAX_HTTP=128,MAX_MS=15000,QUIET_MS=500,MAX_PENDING_REQUESTS=512;
const numericFields=['beforeCount','trackedCount','remainingCount','releasedCount','observedReleaseRequests','observedReleaseResponses','observedReleaseFailures','observedRequestFailures','durationMs','budgetMs','settledForMs'];
const settlementNumbers=['settlementDurationMs','settlementQuietForMs','pendingRequestsAtNavigation','collaborationPanelCount','formsPanelCount'];
const settlementBooleans=['settlementSucceeded','documentReady','contentReady','nestedEditorsReady','collaborationReady'];
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const fail=code=>Object.assign(new Error(code),{code});
export const isPrivateEditorCleanupPolicy=value=>value===PRIVATE_EDITOR_CLEANUP_POLICY||value===LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY;

// Attach to the owned, still-blank page before its first navigation. Puppeteer's
// waitForNetworkIdle also decrements at response headers; an acquisition body
// can still be pending then. This bounded observer waits for actual terminal
// request events and never drops a pending request merely because a frame moved.
const networkObservers=new WeakMap();
export function observePrivateEditorNetwork(page){
 if(!page||page.url()!=='about:blank')throw fail('AUDIT_EDITOR_CLEANUP_OBSERVER_ARGUMENT');
 const pending=new Set();let activityVersion=0,documentVersion=0,closed=false,disposed=false,boundExceeded=false;
 const changed=()=>{if(activityVersion<1e9)activityVersion++;else boundExceeded=true;};
 const onRequest=request=>{if(disposed)return;changed();if(pending.size>=MAX_PENDING_REQUESTS&&!pending.has(request))boundExceeded=true;else pending.add(request);};
 const onTerminal=request=>{if(disposed)return;pending.delete(request);changed();};
 const onNavigation=frame=>{if(frame===page.mainFrame()){documentVersion++;changed();}};
 const onClose=()=>{closed=true;changed();pending.clear();};
 const snapshot=()=>({pendingCount:pending.size,activityVersion,documentVersion,closed,disposed,boundExceeded});
 const observer=Object.freeze({snapshot,dispose(){if(disposed)return;disposed=true;pending.clear();page.off('request',onRequest);page.off('requestfinished',onTerminal);page.off('requestfailed',onTerminal);page.off('framenavigated',onNavigation);page.off('close',onClose);}});
 networkObservers.set(observer,{page,snapshot});
 page.on('request',onRequest);page.on('requestfinished',onTerminal);page.on('requestfailed',onTerminal);page.on('framenavigated',onNavigation);page.on('close',onClose);
 return observer;
}
function readNetwork(observer,page){
 const owned=networkObservers.get(observer);
 if(!owned||owned.page!==page)throw fail('AUDIT_EDITOR_CLEANUP_OBSERVER_ARGUMENT');
 const state=owned.snapshot();
 if(state.closed||state.disposed)throw fail('AUDIT_EDITOR_CLEANUP_OBSERVER_CLOSED');
 if(state.boundExceeded)throw fail('AUDIT_EDITOR_CLEANUP_BOUND');
 return state;
}

// Evaluated read-only in the current document. The outer workspace can be
// ready while the forms directory/detail has not mounted its collaboration
// panel. Both registered forms aliases therefore require that nested body.
function editorDocumentState({role,expectedUrl,expectsForms}){
 const account=role==='customer';
 const shell=document.querySelector(account?'[data-page-shell="account"]':`.ws-root[data-role="${role}"]`);
 const content=shell?.querySelector(account?'section[aria-labelledby~="portal-section-title"]':'.ws-page-content');
 const documentReady=document.readyState==='complete'&&location.href===expectedUrl;
 const contentReady=!!content&&(account?content.children.length>1&&!content.querySelector('[data-account-body-state="loading"], [data-account-body-state="error"]'):content.children.length>0&&content.getAttribute('aria-busy')!=='true'&&!content.querySelector(':scope > .ws-card[role="status"]'));
 const forms=[...(content?.querySelectorAll('[data-production-form-builder]')||[])];
 const nestedEditorsReady=(!expectsForms||forms.length===1)&&forms.every(form=>{
  const picker=form.querySelector('.ws-form-picker');
  return !!picker&&!picker.disabled&&!form.querySelector(':scope > p[role="status"], :scope > p[role="alert"], :scope > .ws-card[role="status"], :scope > .ws-card[role="alert"]')&&(!picker.value||!!form.querySelector('[data-form-editor]'));
 });
 const panels=[...(content?.querySelectorAll('[data-editor-collaboration]')||[])];
 const collaborationReady=panels.every(panel=>['held','locked','expired','unavailable','readonly'].includes(panel.getAttribute('data-lease-state')));
 return {documentReady,contentReady,nestedEditorsReady,collaborationReady,formsPanelCount:forms.length,collaborationPanelCount:panels.length};
}

/** Explicit allowlist: never export actor/lease IDs, audit IDs, URLs or tokens. */
export function safeEditorCleanupReceipt(value){
 if(!value||typeof value!=='object'||!isPrivateEditorCleanupPolicy(value.policy))return undefined;
 const safe={policy:value.policy},current=value.policy===PRIVATE_EDITOR_CLEANUP_POLICY;
 for(const name of [...numericFields,...(current?settlementNumbers:[])])if(integer(value[name])&&value[name]<=1e9)safe[name]=value[name];
 for(const name of ['success','destinationVerified',...(current?settlementBooleans:[])])if(typeof value[name]==='boolean')safe[name]=value[name];
 if(integer(value.navigationStatus)&&value.navigationStatus>=100&&value.navigationStatus<=599)safe.navigationStatus=value.navigationStatus;
 if(Array.isArray(value.releaseStatuses)&&value.releaseStatuses.length<=MAX_HTTP&&value.releaseStatuses.every(status=>integer(status)&&status>=100&&status<=599))safe.releaseStatuses=[...value.releaseStatuses];
 return safe;
}
export function editorCleanupProved(value){
 const receipt=safeEditorCleanupReceipt(value);
 const committed=!!receipt&&numericFields.every(name=>integer(receipt[name]))&&receipt.success===true&&receipt.destinationVerified===true&&receipt.navigationStatus===200
  &&receipt.beforeCount<=receipt.trackedCount&&receipt.trackedCount<=MAX_LEASES&&receipt.remainingCount===0&&receipt.releasedCount===receipt.trackedCount
  &&receipt.observedReleaseRequests<=MAX_HTTP&&receipt.observedReleaseResponses<=MAX_HTTP&&receipt.observedReleaseFailures===0&&receipt.observedRequestFailures===0
  &&receipt.releaseStatuses?.length===receipt.observedReleaseResponses&&receipt.releaseStatuses.every(status=>status>=200&&status<300)
  &&receipt.budgetMs>0&&receipt.budgetMs<=MAX_MS&&receipt.durationMs<=receipt.budgetMs&&receipt.settledForMs>=QUIET_MS;
 // The historical v1 proof remains exactly its original contract. It never
 // acquires a v2 settlement claim merely by being re-exported later.
 return committed&&(receipt.policy===LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY||settlementNumbers.every(name=>integer(receipt[name]))&&settlementBooleans.every(name=>receipt[name]===true)
  &&receipt.settlementQuietForMs>=QUIET_MS&&receipt.settlementDurationMs>=receipt.settlementQuietForMs&&receipt.settlementDurationMs<=receipt.durationMs
  &&receipt.pendingRequestsAtNavigation===0&&receipt.collaborationPanelCount<=MAX_LEASES&&receipt.formsPanelCount<=MAX_LEASES);
}
export function recordEditorCleanupFailure(result,error){
 const receipt=safeEditorCleanupReceipt(error?.receipt);if(receipt)result.editorCleanup=receipt;
 result.cleanupError={code:/^AUDIT_EDITOR_CLEANUP_[A-Z_]+$/.test(error?.code||'')?error.code:'AUDIT_EDITOR_CLEANUP_OPERATION'};
 if(result.status==='completed'){result.status='error';result.errorCode='AUDIT_EDITOR_CLEANUP_FAILED';}
}

export async function releasePrivateEditor({page,network,pool,actorId,baseUrl,expectedUrl,role,timeoutMs=MAX_MS,clock={now:()=>performance.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))}}){
 const base=new URL(baseUrl),expected=new URL(expectedUrl);
 const target=/^\/(fa|en|tr|ar|ru)\/(admin|account)(?:\/[A-Za-z0-9_-]+)*\/$/.exec(expected.pathname);
 if(!UUID.test(actorId)||base.origin!==baseUrl||!['http:','https:'].includes(base.protocol)||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||!Number.isInteger(timeoutMs)||timeoutMs<QUIET_MS||timeoutMs>MAX_MS||expected.origin!==baseUrl||expected.username||expected.password||expected.hash||!target||!['customer','superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support'].includes(role)||(role==='customer')!==(target[2]==='account'))throw fail('AUDIT_EDITOR_CLEANUP_ARGUMENT');
 readNetwork(network,page);
 const started=clock.now(),deadline=started+timeoutMs,destination=baseUrl+'/robots.txt';
 const receipt={policy:PRIVATE_EDITOR_CLEANUP_POLICY,success:false,destinationVerified:false,beforeCount:0,trackedCount:0,remainingCount:0,releasedCount:0,observedReleaseRequests:0,observedReleaseResponses:0,observedReleaseFailures:0,observedRequestFailures:0,releaseStatuses:[],durationMs:0,budgetMs:timeoutMs,settledForMs:0,settlementSucceeded:false,settlementDurationMs:0,settlementQuietForMs:0,pendingRequestsAtNavigation:0,documentReady:false,contentReady:false,nestedEditorsReady:false,collaborationReady:false,formsPanelCount:0,collaborationPanelCount:0};
 const tracked=new Set(),released=new Set();let client,releasedClient=false,watermark,lateConnection=false,stopped=false,hardTimer,httpOverflow=false,lastChange=started;
 const remaining=()=>{const time=Math.floor(deadline-clock.now());if(stopped||time<=0)throw fail('AUDIT_EDITOR_CLEANUP_TIMEOUT');return time;};
 const destroyClient=()=>{if(client&&!releasedClient){releasedClient=true;client.release(true);}};
 const matches=request=>{try{const url=new URL(request.url());return request.method()==='DELETE'&&url.origin===baseUrl&&!url.search&&!url.hash&&/^\/api\/v1\/content\/leases\/[a-f0-9-]{36}$/i.test(url.pathname)&&UUID.test(url.pathname.split('/').at(-1));}catch{return false;}};
 const onRequest=request=>{if(matches(request)){receipt.observedReleaseRequests++;lastChange=clock.now();if(receipt.observedReleaseRequests>MAX_HTTP)httpOverflow=true;}};
 const onResponse=response=>{if(matches(response.request())){receipt.observedReleaseResponses++;lastChange=clock.now();const status=response.status();if(receipt.observedReleaseResponses<=MAX_HTTP)receipt.releaseStatuses.push(status);else httpOverflow=true;if(status<200||status>=300)receipt.observedReleaseFailures++;}};
 const onFailure=request=>{if(matches(request)){receipt.observedRequestFailures++;lastChange=clock.now();if(receipt.observedRequestFailures>MAX_HTTP)httpOverflow=true;}};
 page.on('request',onRequest);page.on('response',onResponse);page.on('requestfailed',onFailure);
 const query=async(text,values=[])=>{
  const result=await client.query({text,values,query_timeout:Math.min(2000,remaining())});remaining();return result;
 };
 const active=async()=>{
  const rows=(await query('SELECT id::text AS id,user_id::text AS user_id FROM content_edit_leases WHERE user_id=$1 AND lease_until>clock_timestamp() ORDER BY id LIMIT 65',[actorId])).rows;
  if(!Array.isArray(rows)||rows.length>MAX_LEASES)throw fail('AUDIT_EDITOR_CLEANUP_BOUND');
  const found=new Set();for(const row of rows){if(row.user_id!==actorId||!UUID.test(row.id)||found.has(row.id))throw fail('AUDIT_EDITOR_CLEANUP_PROOF_INVALID');found.add(row.id);if(!tracked.has(row.id)){tracked.add(row.id);lastChange=clock.now();}}
  if(tracked.size>MAX_LEASES)throw fail('AUDIT_EDITOR_CLEANUP_BOUND');
  if(receipt.remainingCount!==rows.length)lastChange=clock.now();
  receipt.remainingCount=rows.length;receipt.trackedCount=tracked.size;return rows.length;
 };
 const observeReleases=async()=>{
  if(!tracked.size)return;
  const rows=(await query("SELECT id::text AS id,actor_id::text AS actor_id,details->>'leaseId' AS lease_id FROM audit_events WHERE actor_id=$1 AND action='content.lease.released' AND id>$2::bigint AND details->>'leaseId'=ANY($3::text[]) ORDER BY id LIMIT 65",[actorId,watermark,[...tracked]])).rows;
  if(!Array.isArray(rows)||rows.length>MAX_LEASES)throw fail('AUDIT_EDITOR_CLEANUP_BOUND');
  for(const row of rows){if(row.actor_id!==actorId||!BIGINT.test(row.id)||BigInt(row.id)<=BigInt(watermark)||!tracked.has(row.lease_id))throw fail('AUDIT_EDITOR_CLEANUP_PROOF_INVALID');if(!released.has(row.lease_id)){released.add(row.lease_id);lastChange=clock.now();}}
  receipt.releasedCount=released.size;
 };
 const settle=async()=>{
  let stableSince=null,previous='';
  for(;;){
   remaining();const before=readNetwork(network,page);
   await active();await observeReleases();
   if(httpOverflow)throw fail('AUDIT_EDITOR_CLEANUP_BOUND');
   if(receipt.observedReleaseFailures||receipt.observedRequestFailures)throw fail('AUDIT_EDITOR_CLEANUP_HTTP_FAILED');
   const pending=readNetwork(network,page);receipt.pendingRequestsAtNavigation=pending.pendingCount;
   // Do not evaluate a departing/half-loaded document while its requests are
   // unresolved. Terminal network events, not response headers, open this gate.
   if(before.pendingCount||pending.pendingCount){
    stableSince=null;previous='';receipt.settlementQuietForMs=0;receipt.settlementDurationMs=Math.ceil(clock.now()-started);
    await clock.sleep(Math.min(100,remaining()));continue;
   }
   const dom=await page.evaluate(editorDocumentState,{role,expectedUrl:expected.href,expectsForms:/^\/(?:fa|en|tr|ar|ru)\/admin\/(?:cms\/)?forms\/$/.test(expected.pathname)});remaining();
   const after=readNetwork(network,page);
   if(!dom||settlementBooleans.slice(1).some(name=>typeof dom[name]!=='boolean')||!integer(dom.formsPanelCount)||!integer(dom.collaborationPanelCount)||dom.formsPanelCount>MAX_LEASES||dom.collaborationPanelCount>MAX_LEASES)throw fail('AUDIT_EDITOR_CLEANUP_PROOF_INVALID');
   for(const name of [...settlementBooleans.slice(1),'formsPanelCount','collaborationPanelCount'])receipt[name]=dom[name];
   receipt.pendingRequestsAtNavigation=after.pendingCount;
   const current=readNetwork(network,page),signature=JSON.stringify([current.activityVersion,current.documentVersion,...settlementBooleans.slice(1).map(name=>dom[name]),dom.formsPanelCount,dom.collaborationPanelCount]);
   const ready=before.activityVersion===after.activityVersion&&after.activityVersion===current.activityVersion&&current.pendingCount===0&&settlementBooleans.slice(1).every(name=>dom[name]);
   if(!ready){stableSince=null;previous='';receipt.settlementQuietForMs=0;}
   else{
    if(stableSince===null||signature!==previous){stableSince=clock.now();previous=signature;}
    receipt.settlementQuietForMs=Math.max(0,Math.floor(clock.now()-stableSince));
    if(receipt.settlementQuietForMs>=QUIET_MS){
     // Fresh ownership sample immediately before navigation; any new request
     // during this read restarts settlement within the original total budget.
     await active();await observeReleases();
     const final=readNetwork(network,page);
     if(final.activityVersion===current.activityVersion&&final.pendingCount===0){receipt.pendingRequestsAtNavigation=0;receipt.settlementSucceeded=true;receipt.settlementDurationMs=Math.ceil(clock.now()-started);return;}
     stableSince=null;previous='';receipt.settlementQuietForMs=0;
    }
   }
   receipt.settlementDurationMs=Math.ceil(clock.now()-started);
   await clock.sleep(Math.min(100,remaining()));
  }
 };
 try{
  const work=(async()=>{
   const connection=pool.connect().then(value=>{if(lateConnection){value.release(true);throw fail('AUDIT_EDITOR_CLEANUP_TIMEOUT');}return value;});
   client=await connection;remaining();
   // A dedicated read-only transaction enforces both non-mutation and a real
   // server-side 2s statement bound. Destroying this owned client rolls it back;
   // no connection with changed session settings returns to the shared pool.
   await query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');await query("SET LOCAL statement_timeout='2s'");
   const rows=(await query('SELECT COALESCE(MAX(id),0)::text AS watermark FROM audit_events')).rows;
   if(rows.length!==1||!BIGINT.test(rows[0].watermark))throw fail('AUDIT_EDITOR_CLEANUP_PROOF_INVALID');
   watermark=rows[0].watermark;receipt.beforeCount=await active();
   await settle();remaining();
   const navigation=await page.goto(destination,{waitUntil:'domcontentloaded',timeout:Math.min(5000,remaining())});remaining();
   receipt.navigationStatus=navigation?.status();
   receipt.destinationVerified=receipt.navigationStatus===200&&page.url()===destination&&navigation.url()===destination&&navigation.request().redirectChain().length===0;
   if(!receipt.destinationVerified)throw fail('AUDIT_EDITOR_CLEANUP_NAVIGATION');
   lastChange=clock.now();
   for(;;){
    await active();await observeReleases();
    if(httpOverflow)throw fail('AUDIT_EDITOR_CLEANUP_BOUND');
    if(receipt.observedReleaseFailures||receipt.observedRequestFailures)throw fail('AUDIT_EDITOR_CLEANUP_HTTP_FAILED');
    receipt.settledForMs=Math.max(0,Math.floor(clock.now()-lastChange));
    if(receipt.remainingCount===0&&released.size===tracked.size&&receipt.settledForMs>=QUIET_MS){receipt.success=true;break;}
    await clock.sleep(Math.min(100,remaining()));
   }
  })();
  await Promise.race([work,new Promise((_,reject)=>{hardTimer=setTimeout(()=>{stopped=true;lateConnection=true;destroyClient();reject(fail('AUDIT_EDITOR_CLEANUP_TIMEOUT'));},timeoutMs);})]);
  receipt.durationMs=Math.ceil(clock.now()-started);
  if(!editorCleanupProved(receipt))throw fail('AUDIT_EDITOR_CLEANUP_PROOF_INVALID');
  return receipt;
 }catch(error){
  receipt.success=false;receipt.durationMs=Math.max(0,Math.ceil(clock.now()-started));
  const code=/^AUDIT_EDITOR_CLEANUP_[A-Z_]+$/.test(error?.code||'')?error.code:'AUDIT_EDITOR_CLEANUP_OPERATION';
  throw Object.assign(fail(code),{receipt:safeEditorCleanupReceipt(receipt)});
 }finally{
  clearTimeout(hardTimer);stopped=true;lateConnection=true;destroyClient();
  page.off('request',onRequest);page.off('response',onResponse);page.off('requestfailed',onFailure);
 }
}
