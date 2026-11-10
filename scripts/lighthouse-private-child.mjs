import fs from 'node:fs/promises';
import path from 'node:path';
import {navigation} from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/lr-desktop-config.js';
import {launch} from 'chrome-launcher';
import puppeteer from 'puppeteer-core';
import {setTimeout as delay} from 'node:timers/promises';
import {auditDatabase,privateWorkloadIdentity,totp,decrypt} from './lib/private-audit-runtime.mjs';
import {privateFixtureActor,privateAuditJobs,auditRoles} from './lib/private-audit-policy.mjs';
import {privateSessionPreflight} from './lib/private-audit-session.mjs';
import {releasePrivateEditor,observePrivateEditorNetwork,recordEditorCleanupFailure,PRIVATE_EDITOR_CLEANUP_POLICY} from './lib/private-audit-editor-cleanup.mjs';
import {createHash} from 'node:crypto';
import {sitePaths} from '../src/lib/routes.ts';
import {authorize} from '../src/lib/auth.ts';

const input=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
if(input.teardownPolicy!==PRIVATE_EDITOR_CLEANUP_POLICY||input.teardownFingerprint!==createHash('sha256').update(await fs.readFile(new URL('./lib/private-audit-editor-cleanup.mjs',import.meta.url))).digest('hex'))throw new Error('Private editor cleanup policy differs from the frozen manifest.');
const {pool,context}=await auditDatabase(process.env,input.baseUrl);
const actor=privateFixtureActor(input.runId,input.role,process.env.MFA_ENCRYPTION_KEY);
const permitted=new Map(privateAuditJobs(sitePaths,context.baseUrl,input.requestId,{device:input.jobs[0]?.job.device,authorize}).map(job=>[job.id,job]));
for(const item of input.jobs)if(JSON.stringify(permitted.get(item.job.id))!==JSON.stringify(item.job)||item.job.role!==actor.role||path.dirname(item.prefix)!==input.output||!Number.isSafeInteger(item.attempt)||item.attempt<1||path.basename(item.prefix)!==`${item.job.id}.attempt-${item.attempt}`)throw new Error('Private child input is not an exact registered, authorized owned target.');
let chrome,browser,page,interrupted=false,current;
let editorNetwork;
const send=value=>{if(process.connected)process.send(value);};
async function reportDone(value){
 if(!process.connected)return;
 await new Promise((resolve,reject)=>{
  const receive=message=>{if(message?.event==='continue'&&message.id===value.id&&message.attempt===value.attempt){clearTimeout(timer);process.off('message',receive);resolve();}};
  const timer=setTimeout(()=>{process.off('message',receive);reject(new Error('Private audit supervisor did not acknowledge the saved result.'));},30000);
  process.on('message',receive);send(value);
 });
}
const atomic=async(file,value)=>{const temporary=file+`.${process.pid}.tmp`;await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600});await fs.rename(temporary,file);};
const errorCode=error=>/^AUDIT_[A-Z0-9_]+$/.test(error?.code||'')?error.code:error?.name==='TimeoutError'?'AUDIT_BROWSER_TIMEOUT':'AUDIT_OPERATION_FAILED';
const abortOutcome=signal=>!signal.aborted?null:signal.reason==='AUDIT_INTERRUPTED'?{status:'error',errorCode:'AUDIT_INTERRUPTED'}:signal.reason==='AUDIT_DEADLINE_EXCEEDED'?{status:'timeout',errorCode:'AUDIT_DEADLINE_EXCEEDED'}:{status:'error',errorCode:'AUDIT_OPERATION_FAILED'};
const stop=()=>{interrupted=true;current?.abort('AUDIT_INTERRUPTED');void chrome?.kill();};
process.once('SIGTERM',stop);process.once('SIGINT',stop);

async function api(endpoint,body){
 return page.evaluate(async({endpoint,body})=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
   let csrfToken;const mutating=body!==undefined;
   if(mutating){const session=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!session.ok)return{status:session.status,data:null};csrfToken=(await session.json()).csrfToken;}
   const response=await fetch('/api/v1'+endpoint,{method:mutating?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:mutating?{'Content-Type':'application/json','X-CSRF-Token':csrfToken}:{},body:mutating?JSON.stringify(body):undefined,signal:controller.signal});
   return{status:response.status,data:await response.json().catch(()=>null)};
  }finally{clearTimeout(timer);}
 },{endpoint,body});
}
function success(response,code){if(response.status!==200){const error=new Error('An authenticated audit prerequisite failed.');error.code=code+'_'+response.status;throw error;}return response.data;}

async function signIn(){
 await page.goto(context.baseUrl+'/en/auth/login/',{waitUntil:'domcontentloaded',timeout:45000});
 const login=success(await api('/auth/login',{email:actor.email,password:actor.password}),'AUDIT_LOGIN');
 if(login.mfaRequired){
  const row=(await pool.query('SELECT email,role,mfa_enabled,mfa_secret,mfa_last_counter FROM users WHERE id=$1',[actor.id])).rows[0];
  if(row?.email!==actor.email||row.role!==actor.role||!row.mfa_enabled||!row.mfa_secret)throw new Error('The owned MFA fixture no longer matches its role.');
  // A resumed profile authenticates with a new real TOTP counter; it never
  // resets replay protection, consumes recovery codes, or forges a session.
  const counter=Math.floor(Date.now()/30000),last=Number(row.mfa_last_counter);if(counter<=last)await delay(Math.min(60000,(last+1)*30000-Date.now()+150));
  const secret=decrypt(row.mfa_secret);success(await api('/auth/mfa/verify',{challengeToken:login.challengeToken,code:totp(secret,Math.floor(Date.now()/30000))}),'AUDIT_MFA_VERIFY');
 }else if(actor.role!=='customer'){
  const enrollment=success(await api('/auth/mfa/enroll',{password:actor.password}),'AUDIT_MFA_ENROLL');
  if(typeof enrollment?.secret!=='string')throw new Error('MFA enrollment did not return a secret.');
  success(await api('/auth/mfa/confirm',{code:totp(enrollment.secret,Math.floor(Date.now()/30000))}),'AUDIT_MFA_CONFIRM');
 }
 const session=success(await api('/auth/session'),'AUDIT_SESSION');
 if(session?.user?.id!==actor.id||session.user.role!==actor.role)throw new Error('The live application does not match the guarded fixture database.');
 if(actor.role!=='customer'){if(!session.user.mfaEnabled)throw new Error('The staff audit did not complete MFA.');success(await api('/workspace'),'AUDIT_STAFF_ACCESS');}
 // Keep this real origin document for the first preflight. The measured page
 // is visited only after proof and a cold content-cache reset in the loop.
}

async function preflight(){
 const sessionResponse=await api('/auth/session'),user=sessionResponse.data?.user;
 const matching=sessionResponse.status===200&&user?.id===actor.id&&user?.role===actor.role;
 const workspaceResponse=matching&&actor.role!=='customer'?await api('/workspace'):null;
 const securityResponse=matching&&(actor.role==='customer'||workspaceResponse?.status===200)?await api('/me/security'):null;
 return privateSessionPreflight({actor,sessionResponse,workspaceResponse,securityResponse,renewalMarginMs:(input.deadlineSeconds+120)*1000});
}
function acceptPreflight(value,result){
 result.preflight=value.preflight;Object.assign(result.checks,value.checks);
 if(value.action==='fail'){const error=new Error('The current authenticated preflight failed.');error.code=value.errorCode;throw error;}
}

try{
 await fs.mkdir(input.profile,{recursive:true,mode:0o700});
 chrome=await launch({chromePath:input.chromePath,userDataDir:input.profile,chromeFlags:input.chromeFlags,handleSIGINT:false,logLevel:'silent'});
 browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${chrome.port}`,protocolTimeout:90000});
 page=await browser.newPage();editorNetwork=observePrivateEditorNetwork(page);await page.setViewport({width:1350,height:940});await signIn();send({event:'ready',role:actor.role});
 let count=0;
 for(const item of input.jobs){
  if(interrupted)break;
  if(count%5===0){const build=(await fs.readFile(input.buildFile,'utf8')).trim();if(build!==input.buildId||(await privateWorkloadIdentity(pool)).hash!==input.workloadHash){const error=new Error('Private audit workload or build changed.');error.code='AUDIT_WORKLOAD_CHANGED';throw error;}}
  const {job,attempt,prefix}=item,started=Date.now();send({event:'start',id:job.id,attempt,startedAt:new Date(started).toISOString()});
  const result={...job,attempt,startedAt:new Date(started).toISOString(),status:'error',scores:{},metrics:{},authVerified:false,checks:{preSessionRoleVerified:false,preStaffMfaVerified:false,preSessionFreshnessVerified:false}};
  let httpStatus=null,robotsHeader='',workspaceLoaded=false;const apiFailures=[],pageErrors=[];
  const responseListener=response=>{try{const parsed=new URL(response.url());if(parsed.origin!==context.baseUrl)return;if(response.request().isNavigationRequest()&&response.frame()===page.mainFrame()){httpStatus=response.status();robotsHeader=response.headers()['x-robots-tag']||'';}if(parsed.pathname==='/api/v1/workspace'&&response.request().method()==='GET'&&response.status()===200)workspaceLoaded=true;if(parsed.pathname.startsWith('/api/v1/')&&response.status()>=400)apiFailures.push({status:response.status(),path:parsed.pathname});}catch{}};
  const errorListener=()=>pageErrors.push(true);
  current=new AbortController();const deadline=setTimeout(()=>current?.abort('AUDIT_DEADLINE_EXCEEDED'),input.deadlineSeconds*1000-2000);
  try{
   // These API-only reads happen on the previous/login document. No target
   // page is loaded before Lighthouse, and their responses are not exported.
   let proof=await preflight();acceptPreflight(proof,result);
   if(proof.action==='renew'){
    result.renewal={reason:'absolute-expiry-approaching',startedAt:new Date().toISOString(),previousExpiresAt:proof.preflight.expiresAt,success:false};
    try{
     success(await api('/auth/logout',{}),'AUDIT_PLANNED_LOGOUT');await signIn();
     proof=await preflight();acceptPreflight(proof,result);
     if(proof.action!=='measure'){const error=new Error('The genuine renewed session is not long enough for the bounded audit.');error.code='AUDIT_RENEWAL_NOT_FRESH';throw error;}
     result.renewal.expiresAt=proof.preflight.expiresAt;result.renewal.success=true;
    }finally{result.renewal.finishedAt=new Date().toISOString();}
   }
   await page.goto('about:blank');
   // Auth probes on the previous document must not satisfy the measured
   // page's workspace-loaded proof or contaminate its API/error counters.
   page.on('response',responseListener);page.on('pageerror',errorListener);
   const cdp=await page.createCDPSession();
   try{await cdp.send('Network.clearBrowserCache');await cdp.send('Storage.clearDataForOrigin',{origin:context.baseUrl,storageTypes:'file_systems,indexeddb,local_storage,shader_cache,service_workers,cache_storage'});}finally{await cdp.detach();}
   const measured=await navigation(page,job.url,{config:job.device==='desktop'?desktopConfig:undefined,flags:{logLevel:'error',onlyCategories:['performance','accessibility','best-practices','seo'],output:'json',maxWaitForLoad:45000,disableStorageReset:false,disableFullPageScreenshot:input.disableFullPageScreenshot===true},signal:current.signal});
   if(!measured?.lhr)throw new Error('Lighthouse returned no private report.');
   const lhr=measured.lhr;await atomic(prefix+'.lhr.json',lhr);
   Object.assign(result,{report:path.basename(prefix+'.lhr.json'),lighthouseVersion:lhr.lighthouseVersion,fetchTime:lhr.fetchTime,configSettings:lhr.configSettings,environment:lhr.environment,runtimeError:lhr.runtimeError,runWarnings:lhr.runWarnings,scores:Object.fromEntries(Object.entries(lhr.categories).map(([key,value])=>[key,value.score===null?null:Math.round(value.score*100)])),metrics:Object.fromEntries(['first-contentful-paint','largest-contentful-paint','speed-index','total-blocking-time','cumulative-layout-shift','interactive'].filter(key=>lhr.audits[key]).map(key=>[key,lhr.audits[key].numericValue]))});
   // Verification runs after the measured trace. Never prewarm the target or
   // remove private noindex just to raise the SEO category score.
   await page.waitForFunction(({role})=>{
    if(role==='customer'){
     const content=document.querySelector('[data-page-shell="account"] section[aria-labelledby~="portal-section-title"]');
     return !!content&&content.children.length>1&&!content.querySelector('[data-account-body-state="loading"], [data-account-body-state="error"]');
    }
    return !!document.querySelector(`.ws-root[data-role="${role}"] .ws-page-content`)&&!document.querySelector('.ws-page-content > .ws-card[role="status"]');
   },{timeout:15000},{role:actor.role}).catch(()=>{});
   // The post-navigation authorization probe is separate evidence. It must not
   // turn a missing application workspace request into a successful page load.
   page.off('response',responseListener);page.off('pageerror',errorListener);
   const sessionResponse=await api('/auth/session'),session=sessionResponse.data?.user;
   const staffResponse=actor.role==='customer'?null:await api('/workspace');
   const dom=await page.evaluate(({role,locale,expected,requestId,message})=>{
    const shell=role==='customer'?document.querySelector('[data-page-shell="account"]'):document.querySelector(`.ws-root[data-role="${role}"]`),content=role==='customer'?shell?.querySelector('section[aria-labelledby~="portal-section-title"]'):shell?.querySelector('.ws-page-content');
    return{shellPresent:!!shell,contentReady:!!content&&(role==='customer'?content.children.length>1&&!content.querySelector('[data-account-body-state="loading"], [data-account-body-state="error"]'):content.children.length>0&&!content.querySelector(':scope > .ws-card[role="status"]')),documentLanguage:document.documentElement.lang===locale,finalPathMatches:location.pathname+location.search===expected,noindex:[...document.querySelectorAll('meta[name="robots"]')].some(node=>/\bnoindex\b/i.test(node.getAttribute('content')||'')),ownedRequestVisible:!requestId||!!shell?.textContent?.includes(requestId)&&!!shell?.textContent?.includes(message)};
   },{role:actor.role,locale:job.locale,expected:new URL(job.url).pathname+new URL(job.url).search,requestId:job.kind==='owned-request-detail'?input.requestId:null,message:'Disposable Lighthouse owned-request fixture '+input.runId});
   let ownedRequestVerified=true;if(job.kind==='owned-request-detail'){const response=await api('/requests/'+encodeURIComponent(input.requestId));ownedRequestVerified=response.status===200&&response.data?.id===input.requestId&&response.data?.ownerId===actor.id;}
   const checks={...result.checks,...dom,sessionRole:auditRoles.includes(session?.role)?session.role:null,sessionRoleVerified:sessionResponse.status===200&&session?.id===actor.id&&session?.role===actor.role,staffMfaVerified:actor.role==='customer'?true:session?.mfaEnabled===true&&staffResponse?.status===200,workspaceLoaded:actor.role==='customer'?true:workspaceLoaded,httpStatus,httpStatusVerified:httpStatus===200,noindex:dom.noindex||/\bnoindex\b/i.test(robotsHeader),ownedRequestVerified,apiErrorFree:apiFailures.length===0,runtimeErrorFree:pageErrors.length===0};
   const {sessionRole:observedRole,httpStatus:observedStatus,...verified}=checks;
   Object.assign(result,{httpStatus,checks,authVerified:checks.preSessionRoleVerified&&checks.preStaffMfaVerified&&checks.preSessionFreshnessVerified&&checks.sessionRoleVerified&&checks.staffMfaVerified,apiFailureCount:apiFailures.length,pageErrorCount:pageErrors.length,apiFailures,status:!lhr.runtimeError&&Object.values(verified).every(value=>value===true)?'completed':'error'});
   if(result.status==='error')result.errorCode=lhr.runtimeError?'AUDIT_LIGHTHOUSE_RUNTIME_ERROR':'AUDIT_PROTECTED_PAGE_CHECK_FAILED';
  }catch(error){Object.assign(result,abortOutcome(current.signal)||{status:'error',errorCode:errorCode(error)});}
  finally{
   // Finish measured listeners before ordinary authenticated navigation. The
   // teardown belongs to this same attempt; it never changes its LHR or metrics.
   page.off('response',responseListener);page.off('pageerror',errorListener);
   try{
    const cleanupBudget=Math.min(15000,input.deadlineSeconds*1000-2000-(Date.now()-started));
    if(cleanupBudget<500)throw Object.assign(new Error('Editor cleanup has no remaining page budget.'),{code:'AUDIT_EDITOR_CLEANUP_TIMEOUT'});
    result.editorCleanup=await releasePrivateEditor({page,network:editorNetwork,pool,actorId:actor.id,baseUrl:context.baseUrl,expectedUrl:job.url,role:actor.role,timeoutMs:cleanupBudget});
   }catch(error){
    // Keep an earlier measurement/auth/deadline cause instead of relabelling it.
    recordEditorCleanupFailure(result,error);
   }
   clearTimeout(deadline);if(result.status==='completed')Object.assign(result,abortOutcome(current.signal)||{});current=null;
   result.apiFailureCount=apiFailures.length;result.pageErrorCount=pageErrors.length;result.apiFailures=apiFailures;result.durationMs=Date.now()-started;result.finishedAt=new Date().toISOString();
   await atomic(prefix+'.result.json',result);await reportDone({event:'done',id:job.id,attempt,status:result.status,durationMs:result.durationMs,scores:result.scores});count++;
  }
  if(result.cleanupError){const error=new Error('The editor did not complete authenticated release.');error.code='AUDIT_EDITOR_CLEANUP_FAILED';throw error;}
  if(result.status==='timeout'||!result.authVerified){const error=new Error('This browser cannot safely continue authenticated scoring.');error.code='AUDIT_AUTH_OR_BROWSER_LOST';throw error;}
 }
}catch(error){send({event:'fatal',role:actor.role,errorCode:errorCode(error)});process.exitCode=2;}
finally{
 // If an earlier cleanup failed, this best-effort navigation/log-out does not
 // overwrite its failed receipt or permit another measured target.
 try{if(page){if(page.url()!==context.baseUrl+'/robots.txt')await page.goto(context.baseUrl+'/robots.txt',{waitUntil:'domcontentloaded',timeout:5000});await api('/auth/logout',{});}}catch{}
 editorNetwork?.dispose();try{await browser?.disconnect();}catch{}try{await chrome?.kill();}catch{}
 await fs.rm(input.profile,{recursive:true,force:true}).catch(()=>{});await pool.end();
}
