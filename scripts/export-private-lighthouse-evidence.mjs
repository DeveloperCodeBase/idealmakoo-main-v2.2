import fs, {constants} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isPrivateEditorCleanupPolicy,safeEditorCleanupReceipt,editorCleanupProved} from './lib/private-audit-editor-cleanup.mjs';

// This exporter deliberately does not share the public exporter's recursive
// text copying. An authenticated LHR can contain private text in almost any
// string field, including errors, selectors, headings and resource URLs.
export const FORMAT='private-lighthouse-evidence-v1';
export const MAXIMUM_PART_BYTES=32*1024*1024;
const MAXIMUM_RAW_BYTES=128*1024*1024,MAXIMUM_JSON_BYTES=32*1024*1024;
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e15;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const boolean=value=>typeof value==='boolean';
const hashValue=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const categoryIds=new Set(['performance','accessibility','best-practices','seo','pwa','agentic-browsing']);
const metricIds=new Set(['first-contentful-paint','largest-contentful-paint','speed-index','total-blocking-time','cumulative-layout-shift','interactive']);
const roles=new Set(['customer','superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support']);
const locales=new Set(['fa','en','tr','ar','ru']);
const kinds=new Set(['workspace','account','representative-role','owned-request-detail']);
const statuses=new Set(['completed','error','timeout']);
const proofBooleans=['preSessionRoleVerified','preStaffMfaVerified','preSessionFreshnessVerified','sessionRoleVerified','httpStatusVerified','staffMfaVerified','shellPresent','contentReady','noindex','finalPathMatches','documentLanguage','workspaceLoaded','ownedRequestVisible','ownedRequestVerified','apiErrorFree','runtimeErrorFree'];
const scoreModes=new Set(['binary','numeric','metricSavings','informative','manual','notApplicable','error']);
const numericUnits=new Set(['millisecond','milliseconds','ms','second','seconds','byte','bytes','unitless','percent','element','elements']);
const imageAudits=new Set(['full-page-screenshot','screenshot-thumbnails','final-screenshot']);
const detailsTypes=new Set(['table','opportunity','list','debugdata','node','source-location','criticalrequestchain','treemap-data','network-tree','cards']);
const detailContainers=new Set(['items','subItems','headings','summary','node','source','location','children','details','table','boundingRect']);
const detailNumbers=new Set(['numericValue','totalBytes','wastedBytes','wastedMs','totalMs','overallSavingsMs','overallSavingsBytes','transferSize','resourceSize','startTime','endTime','duration','durationMs','requestStartTime','responseReceivedTime','networkEndTime','networkRequestTime','width','height','left','top','right','bottom','x','y','fontSize','fontWeight','contrastRatio','expectedContrastRatio','percentUsed','usedBytes','unusedBytes','scriptDuration','styleLayoutDuration','parseCompileDuration','line','column','lineNumber','columnNumber','numTasks','numTasksOver10ms','numTasksOver25ms','numTasksOver50ms','numTasksOver100ms','numTasksOver500ms','numRequests','totalTaskTime','maxRtt','maxServerLatency','rtt','throughput','mainDocumentTransferSize']);
const detailBooleans=new Set(['isLinkPreload','isHttp2','isHttp3','isRoot','renderBlocking']);
const headingTypes=new Set(['node','url','bytes','ms','timespanMs','numeric','text','code','thumbnail','source-location']);
const knownFlags=new Set(['--headless','--headless=new','--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--disable-extensions','--disable-background-networking','--hide-scrollbars','--mute-audio','--no-first-run','--no-default-browser-check']);
const htmlTags=new Set('html head body main header footer nav aside section article div span p a button input textarea select option optgroup label form fieldset legend h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table caption thead tbody tfoot tr th td col colgroup img picture source video audio track canvas iframe svg g path rect circle ellipse line polyline polygon text tspan defs symbol use clipPath mask foreignObject figure figcaption details summary dialog menu progress meter output small strong em b i u s sub sup mark time code pre blockquote br hr noscript template slot'.toLowerCase().split(' '));

export const OMISSIONS={
  rawLighthouseReports:true,screenshotsAndBinaryPayloads:true,rawUrlsAndQueryIdentifiers:true,
  cookiesHeadersCredentialsAndSessionIdentifiers:true,domTextLabelsSnippetsAndAttributes:true,
  arbitraryTitlesDescriptionsDisplayValuesAndErrorText:true,networkResourceIdentifiers:true,
  safeSelectorPolicy:'Standard element names, combinators and positional pseudo-classes only; IDs, classes and attributes removed.',
  auditOutcomes:'Every audit outcome is retained. Unknown audit IDs receive an opaque alias. Image audits retain outcome metadata only.',
  errors:'Known Lighthouse or runner error codes and presence/counts are retained. Free-form error and warning text is omitted explicitly.',
  details:'Only allowlisted numeric measurements, structural containers and simplified selectors are retained.',
  authentication:'Before/after proof retains only known roles, HTTP status codes, booleans and UTC observation/expiry times. Planned real renewal retains its fixed reason, times and success; identities and credentials are omitted.',
  detailMaximumArrayItems:20,detailMaximumDepth:8,detailMaximumNodesPerAudit:2000,
  note:'A privacy-filtered derivative, not a raw Lighthouse report. Consult the separately protected raw report by its SHA-256 for omitted private details.',
};

function iso(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))return undefined;return value;}
function version(value){if(typeof value!=='string')return undefined;return value.match(/\b\d{1,4}\.\d{1,6}\.\d{1,6}(?:\.\d{1,6})?\b/)?.[0];}
function numberFields(value,allowed){if(!object(value))return{};return Object.fromEntries([...allowed].filter(key=>finite(value[key])||value[key]===null).map(key=>[key,value[key]]));}
function boolFields(value,allowed){if(!object(value))return{};return Object.fromEntries(allowed.filter(key=>boolean(value[key])).map(key=>[key,value[key]]));}

// No app modules or Lighthouse browser modules are executed to obtain these
// vocabularies. Literal route/audit/error identifiers come from locked source.
export async function loadVocabulary(root=ROOT){
  const source=await fs.readFile(path.join(root,'src/lib/routes.ts'),'utf8');
  const section=/export\s+const\s+adminSections\s*=\s*\[([\s\S]*?)\];/.exec(source)?.[1];
  fail(section!==undefined,'REGISTERED_ROUTES_UNREADABLE');
  fail(section.replace(/'[^']*'/g,'').replace(/[\s,]/g,'')==='','REGISTERED_ROUTES_NOT_LITERAL');
  const routes=new Set([...section.matchAll(/'([A-Za-z0-9/-]*)'/g)].map(match=>'admin'+(match[1]?'/'+match[1]:'')));
  for(const match of source.matchAll(/'(account(?:\/[A-Za-z0-9/-]+)?)'/g))routes.add(match[1]);
  fail(routes.has('admin')&&routes.has('account/security')&&routes.has('account/requests'),'REGISTERED_PRIVATE_ROUTES_MISSING');
  const require=createRequire(path.join(root,'package.json'));
  const packageFile=require.resolve('lighthouse/package.json'),packageRoot=path.dirname(packageFile);
  const packageMetadata=JSON.parse(await fs.readFile(packageFile,'utf8'));
  const auditIds=new Set(imageAudits),pending=[path.join(packageRoot,'core/audits')];
  while(pending.length){const directory=pending.pop();for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const filename=path.join(directory,entry.name);if(entry.isDirectory())pending.push(filename);
    else if(entry.isFile()&&entry.name.endsWith('.js')){const text=await fs.readFile(filename,'utf8');for(const match of text.matchAll(/\bid:\s*['"]([a-z][a-z0-9-]{0,100})['"]/g))auditIds.add(match[1]);}
  }}
  const configText=await fs.readFile(path.join(packageRoot,'core/config/default-config.js'),'utf8');
  for(const match of configText.matchAll(/\bid:\s*['"]([a-z][a-z0-9-]{0,100})['"]/g))auditIds.add(match[1]);
  const errorText=await fs.readFile(path.join(packageRoot,'core/lib/lh-error.js'),'utf8');
  const errorCodes=new Set([...errorText.matchAll(/\bcode:\s*['"]([A-Z][A-Z0-9_]{1,100})['"]/g)].map(match=>match[1]));
  for(const code of ['PROTOCOL_TIMEOUT','NO_FCP','NO_LCP','ERRORED_DOCUMENT_REQUEST','FAILED_DOCUMENT_REQUEST','PAGE_HUNG','TARGET_CRASHED','ECONNREFUSED','ECONNRESET','ENOTFOUND','ETIMEDOUT','ABORT_ERR','AUTH_VERIFICATION_FAILED','AUDIT_TIMEOUT'])errorCodes.add(code);
  const runnerTexts=await Promise.all(['scripts/lighthouse-private-child.mjs','scripts/audit-private-lighthouse.mjs','scripts/lib/private-audit-session.mjs','scripts/lib/private-audit-editor-cleanup.mjs'].map(filename=>fs.readFile(path.join(root,filename),'utf8')));
  const runnerPrefixes=new Set(runnerTexts.flatMap(source=>[...source.matchAll(/['"](AUDIT_[A-Z0-9_]{1,100})['"]/g)].map(match=>match[1])));
  for(const code of runnerPrefixes)errorCodes.add(code);
  fail(auditIds.has('color-contrast')&&auditIds.has('largest-contentful-paint'),'LIGHTHOUSE_VOCABULARY_UNREADABLE');
  return{routes,auditIds,errorCodes,runnerPrefixes,lighthouseVersion:packageMetadata.version,routesSourceSha256:sha(source),privateRunnerSourceSha256:sha(JSON.stringify(runnerTexts))};
}

export function safeSelector(value){
  if(typeof value!=='string'||value.length>4000)return null;
  // Unsupported escapes/functions are omitted, never interpreted as private
  // labels. An attribute containing an unusual ']' leaves an invalid compound
  // and consequently fails closed below.
  const stripped=value.replace(/\[[^\]]*\]/g,'');
  const tokens=stripped.trim().split(/(\s+|[>+~])/).filter(Boolean);if(!tokens.length||tokens.length>100)return null;
  const output=[];
  for(const token of tokens){
    if(/^\s+$/.test(token)){if(output.length&&output.at(-1)!==' ')output.push(' ');continue;}
    if(/^[>+~]$/.test(token)){output.push(token);continue;}
    const compound=/^(\*|[A-Za-z][A-Za-z0-9-]*)?((?:[.#][A-Za-z_0-9-]+|:nth-(?:child|of-type)\([1-9][0-9]{0,3}\)|:(?:first|last|only)-(?:child|of-type))*)$/.exec(token);
    if(!compound||!compound[0])return null;const tag=(compound[1]||'*').toLowerCase();if(tag!=='*'&&!htmlTags.has(tag))return null;
    const positions=[...compound[2].matchAll(/:nth-(?:child|of-type)\([1-9][0-9]{0,3}\)|:(?:first|last|only)-(?:child|of-type)/g)].map(match=>match[0]).join('');
    output.push(tag+positions);
  }
  const result=output.join('').replace(/\s*([>+~])\s*/g,' $1 ').replace(/\s+/g,' ').trim();
  return result&&result.length<=1000?result:null;
}
function sanitizeDetails(value,budget={nodes:0},depth=0){
  if(depth>8||++budget.nodes>2000)return{omitted:'detail-bound'};
  if(Array.isArray(value))return{items:value.slice(0,20).map(item=>sanitizeDetails(item,budget,depth+1)),omittedItems:Math.max(0,value.length-20)};
  if(!object(value))return{omitted:'private-or-untyped-value'};
  if(['screenshot','filmstrip'].includes(value.type))return{omitted:'image-artifact'};
  const result={privateFieldsOmitted:true};
  if(detailsTypes.has(value.type))result.type=value.type;
  if(value.type==='node'||typeof value.selector==='string'){
    const selector=safeSelector(value.selector);if(selector)result.selector=selector;else result.selectorOmitted=true;
  }
  let omitted=0;
  for(const[key,child]of Object.entries(value)){
    if(key==='type'||key==='selector')continue;
    if(detailNumbers.has(key)&&finite(child)){result[key]=child;continue;}
    if(detailBooleans.has(key)&&boolean(child)){result[key]=child;continue;}
    if(key==='key'&&(detailNumbers.has(child)||detailContainers.has(child)||child==='url')){result.key=child;continue;}
    if(key==='valueType'&&headingTypes.has(child)){result.valueType=child;continue;}
    if(detailContainers.has(key)){result[key]=sanitizeDetails(child,budget,depth+1);continue;}
    omitted++;
  }
  result.omittedFields=omitted;return result;
}
function safeError(value,vocabulary){
  if(value===undefined||value===null||value===false||value==='')return undefined;
  const code=object(value)?value.code:undefined;
  const dynamic=typeof code==='string'?/^(AUDIT_[A-Z0-9_]+)_([1-5][0-9]{2})$/.exec(code):null;
  const allowed=vocabulary.errorCodes.has(code)||dynamic&&vocabulary.runnerPrefixes?.has(dynamic[1]);
  return{present:true,code:allowed?code:'UNCLASSIFIED',textOmitted:true};
}
function warnings(value){return{count:Array.isArray(value)?value.length:value?1:0,textOmitted:true};}
function auditAlias(id,vocabulary){return vocabulary.auditIds.has(id)?id:'private-audit-'+sha(String(id)).slice(0,16);}
export function sanitizeAudit(id,audit,vocabulary){
  fail(object(audit),'INVALID_AUDIT_OBJECT');
  const result={id:auditAlias(id,vocabulary),originalIdOmitted:!vocabulary.auditIds.has(id),textFieldsOmitted:true};
  if(audit.score===null||finite(audit.score)&&audit.score>=0&&audit.score<=1)result.score=audit.score;
  if(scoreModes.has(audit.scoreDisplayMode))result.scoreDisplayMode=audit.scoreDisplayMode;
  if(finite(audit.numericValue))result.numericValue=audit.numericValue;
  if(numericUnits.has(audit.numericUnit))result.numericUnit=audit.numericUnit;
  result.error=safeError(audit.errorMessage||audit.scoreDisplayMode==='error'&&{code:audit.errorCode},vocabulary);
  result.warnings=warnings(audit.warnings);
  if(audit.details)result.details=imageAudits.has(id)?{omitted:'image-artifact'}:sanitizeDetails(audit.details);
  return result;
}
function categories(report,vocabulary){
  if(!object(report.categories))return{};
  return Object.fromEntries([...categoryIds].filter(id=>object(report.categories[id])).map(id=>{
    const original=report.categories[id],value={id};if(original.score===null||finite(original.score)&&original.score>=0&&original.score<=1)value.score=original.score;
    value.auditRefs=Array.isArray(original.auditRefs)?original.auditRefs.slice(0,2000).filter(object).map(ref=>({id:auditAlias(ref.id,vocabulary),...(finite(ref.weight)?{weight:ref.weight}:{})})):[];
    if(Array.isArray(original.auditRefs)&&original.auditRefs.length>2000)value.omittedAuditReferences=original.auditRefs.length-2000;
    return[id,value];
  }));
}
function settings(original){
  if(!object(original))return{};const safe={};
  if(['mobile','desktop'].includes(original.formFactor))safe.formFactor=original.formFactor;
  if(['simulate','devtools','provided'].includes(original.throttlingMethod))safe.throttlingMethod=original.throttlingMethod;
  Object.assign(safe,boolFields(original,['disableStorageReset','disableFullPageScreenshot','usePassiveGathering','enableErrorReporting']));
  Object.assign(safe,numberFields(original,new Set(['maxWaitForFcp','maxWaitForLoad','pauseAfterFcpMs','pauseAfterLoadMs','networkQuietThresholdMs','cpuQuietThresholdMs'])));
  if(object(original.throttling))safe.throttling=numberFields(original.throttling,new Set(['rttMs','throughputKbps','requestLatencyMs','downloadThroughputKbps','uploadThroughputKbps','cpuSlowdownMultiplier']));
  if(object(original.screenEmulation))safe.screenEmulation={...numberFields(original.screenEmulation,new Set(['width','height','deviceScaleFactor'])),...boolFields(original.screenEmulation,['mobile','disabled'])};
  if(Array.isArray(original.onlyCategories))safe.onlyCategories=original.onlyCategories.filter(id=>categoryIds.has(id));
  safe.otherSettingsOmitted=true;return safe;
}
function configuration(config,vocabulary){
  fail(object(config)&&hashValue(config.inventoryHash||'0'.repeat(64)),'INVALID_MANIFEST_CONFIG');
  const base=new URL(config.baseUrl);fail(['http:','https:'].includes(base.protocol)&&!base.username&&!base.password&&base.pathname==='/'&&!base.search&&!base.hash,'INVALID_MANIFEST_ORIGIN');
  fail(typeof config.buildId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(config.buildId),'INVALID_BUILD_ID');
  const flags=Array.isArray(config.chromeFlags)?config.chromeFlags:[];
  const safe={schemaVersion:integer(config.schemaVersion)?config.schemaVersion:undefined,baseOrigin:base.origin,buildId:config.buildId,applicationVersion:version(config.applicationVersion),lighthouseVersion:version(config.lighthouseVersion),chromeVersion:version(config.chromeVersion),chromeLauncherVersion:version(config.chromeLauncherVersion),devices:Array.isArray(config.devices)?config.devices.filter(item=>['mobile','desktop'].includes(item)):['mobile','desktop'].includes(config.device)?[config.device]:[],categories:Array.isArray(config.categories)?config.categories.filter(item=>categoryIds.has(item)):[],chromeFlags:flags.filter(flag=>knownFlags.has(flag)||typeof flag==='string'&&/^--window-size=[0-9]{1,5},[0-9]{1,5}$/.test(flag)),omittedChromeFlags:flags.filter(flag=>!knownFlags.has(flag)&&!(typeof flag==='string'&&/^--window-size=[0-9]{1,5},[0-9]{1,5}$/.test(flag))).length,chromeFlagsSha256:sha(JSON.stringify(flags)),...numberFields(config,new Set(['deadlineSeconds','maxWaitForLoad'])),routesSourceSha256:vocabulary.routesSourceSha256,otherConfigFieldsOmitted:true};
  safe.privateRunnerSourceSha256=vocabulary.privateRunnerSourceSha256;
  Object.assign(safe,boolFields(config,['disableFullPageScreenshot']));
  if(config.targetPath!==undefined){
    const match=typeof config.targetPath==='string'&&/^\/(fa|en|tr|ar|ru)\/((?:admin|account)(?:\/[A-Za-z0-9_-]+)*)\/$/.exec(config.targetPath);
    fail(match&&vocabulary.routes.has(match[2]),'INVALID_PRIVATE_TARGET_SELECTOR');safe.targetPath=config.targetPath;
  }
  if(config.teardownPolicy!==undefined){
    fail(isPrivateEditorCleanupPolicy(config.teardownPolicy)&&hashValue(config.teardownFingerprint),'INVALID_EDITOR_CLEANUP_POLICY');
    safe.teardownPolicy=config.teardownPolicy;safe.teardownFingerprint=config.teardownFingerprint;
  }
  if(['browser-default','webgl-software-fallback','swiftshader-driver'].includes(config.graphicsMode))safe.graphicsMode=config.graphicsMode;
  for(const name of ['inventoryHash','publicSnapshotHash','assetsHash','workloadHash'])if(hashValue(config[name]))safe[name]=config[name];
  if(object(config.configSettings))safe.configSettings=settings(config.configSettings);
  fail(safe.lighthouseVersion===vocabulary.lighthouseVersion,'LIGHTHOUSE_VERSION_MISMATCH');
  return{safe,base};
}
function safeJob(job,base,vocabulary){
  fail(object(job)&&typeof job.id==='string'&&/^[a-f0-9]{16}$/.test(job.id)&&roles.has(job.role)&&locales.has(job.locale)&&kinds.has(job.kind)&&['mobile','desktop'].includes(job.device),'INVALID_PRIVATE_JOB');
  const url=new URL(job.url);fail(url.origin===base.origin&&!url.username&&!url.password,'PRIVATE_JOB_ORIGIN_MISMATCH');
  const match=/^\/(fa|en|tr|ar|ru)\/(.*?)(?:\/)?$/.exec(url.pathname);fail(match&&match[1]===job.locale,'PRIVATE_JOB_LOCALE_MISMATCH');
  let route=match[2];if(job.kind==='owned-request-detail'&&!vocabulary.routes.has(route)&&/^account\/requests\//.test(route))route='account/requests/detail';
  fail(vocabulary.routes.has(route),'UNREGISTERED_PRIVATE_ROUTE');
  fail(job.expectedStatus===200&&job.indexed===false,'PRIVATE_JOB_CONTRACT');
  return{id:job.id,route:'/'+job.locale+'/'+route+'/',locale:job.locale,role:job.role,kind:job.kind,device:job.device,expectedStatus:200,indexed:false,...job.kind==='owned-request-detail'?{ownedRequestIdentifierOmitted:true}:{},queryAndFragmentOmitted:!!(url.search||url.hash)};
}
const httpCode=value=>integer(value)&&value>=100&&value<=599?value:null;
function preflightProof(value){
  if(!object(value))return undefined;
  return{sessionRole:roles.has(value.sessionRole)?value.sessionRole:null,httpStatus:httpCode(value.httpStatus),workspaceStatus:httpCode(value.workspaceStatus),securityStatus:httpCode(value.securityStatus),expiresAt:iso(value.expiresAt)||null,observedAt:iso(value.observedAt)||null,otherFieldsOmitted:true};
}
function renewalProof(value){
  if(!object(value))return undefined;
  return{reason:value.reason==='absolute-expiry-approaching'?value.reason:undefined,startedAt:iso(value.startedAt),finishedAt:iso(value.finishedAt),previousExpiresAt:iso(value.previousExpiresAt),expiresAt:iso(value.expiresAt),success:boolean(value.success)?value.success:undefined,otherFieldsOmitted:true};
}
function requireCompletedProof(result,job,checks,preflight,renewal){
  fail(result.authVerified===true&&checks.sessionRole===job.role&&checks.httpStatus===200&&proofBooleans.every(name=>checks[name]===true),'COMPLETED_PRIVATE_AUDIT_WITHOUT_AUTH_PROOF');
  fail(preflight?.sessionRole===job.role&&preflight.httpStatus===200&&preflight.securityStatus===200&&preflight.workspaceStatus===(job.role==='customer'?null:200)&&preflight.observedAt&&preflight.expiresAt&&Date.parse(preflight.expiresAt)>Date.parse(preflight.observedAt),'COMPLETED_PRIVATE_AUDIT_WITHOUT_PREFLIGHT_PROOF');
  const finishedAt=iso(result.finishedAt),fetchTime=iso(result.fetchTime);
  fail((!finishedAt||Date.parse(preflight.expiresAt)>Date.parse(finishedAt))&&(!fetchTime||Date.parse(preflight.observedAt)<=Date.parse(fetchTime)),'COMPLETED_PRIVATE_AUDIT_WITHOUT_PREFLIGHT_PROOF');
  if(result.renewal!==undefined){
    fail(renewal?.reason==='absolute-expiry-approaching'&&renewal.success===true&&renewal.startedAt&&renewal.finishedAt&&renewal.previousExpiresAt&&renewal.expiresAt&&Date.parse(renewal.finishedAt)>=Date.parse(renewal.startedAt)&&Date.parse(renewal.previousExpiresAt)>Date.parse(renewal.startedAt)&&Date.parse(renewal.expiresAt)>Date.parse(renewal.finishedAt)&&Date.parse(renewal.expiresAt)===Date.parse(preflight.expiresAt),'COMPLETED_PRIVATE_AUDIT_WITH_INVALID_RENEWAL_PROOF');
  }
}
function safeAttempt(result,job,vocabulary,teardownPolicy){
  fail(object(result)&&result.id===job.id&&integer(result.attempt)&&result.attempt>0&&result.attempt<=10000&&statuses.has(result.status),'INVALID_PRIVATE_ATTEMPT');
  for(const name of ['role','locale','kind','device'])fail(result[name]===undefined||result[name]===job[name],'PRIVATE_ATTEMPT_JOB_MISMATCH');
  const checkSource=object(result.checks)?result.checks:{};
  const checks={...boolFields(checkSource,proofBooleans),...(roles.has(checkSource.sessionRole)?{sessionRole:checkSource.sessionRole}:{}),...(integer(checkSource.httpStatus)&&checkSource.httpStatus<=599?{httpStatus:checkSource.httpStatus}:{})};
  const preflight=preflightProof(result.preflight),renewal=renewalProof(result.renewal);
  if(result.editorCleanup!==undefined)fail(isPrivateEditorCleanupPolicy(teardownPolicy)&&result.editorCleanup?.policy===teardownPolicy,'EDITOR_CLEANUP_POLICY_MISMATCH');
  if(result.status==='completed'){
    requireCompletedProof(result,job,checks,preflight,renewal);
    if(teardownPolicy!==undefined)fail(!result.cleanupError&&editorCleanupProved(result.editorCleanup),'COMPLETED_PRIVATE_AUDIT_WITHOUT_EDITOR_CLEANUP');
  }
  return{...job,attempt:result.attempt,status:result.status,scores:numberFields(result.scores,categoryIds),metrics:numberFields(result.metrics,metricIds),durationMs:finite(result.durationMs)?result.durationMs:undefined,startedAt:iso(result.startedAt),finishedAt:iso(result.finishedAt),fetchTime:iso(result.fetchTime),authVerified:result.authVerified===true,authenticationProofVersion:2,checks,preflight,renewal,editorCleanup:safeEditorCleanupReceipt(result.editorCleanup),httpStatus:integer(result.httpStatus)&&result.httpStatus<=599?result.httpStatus:undefined,apiFailureCount:integer(result.apiFailureCount)?result.apiFailureCount:undefined,pageErrorCount:integer(result.pageErrorCount)?result.pageErrorCount:undefined,expectedHttpVerified:boolean(result.expectedHttpVerified)?result.expectedHttpVerified:undefined,runtimeError:safeError(result.runtimeError,vocabulary),runnerError:safeError(result.error||result.errorCode?{code:result.errorCode}:undefined,vocabulary),httpError:safeError(result.httpError,vocabulary),cleanupError:safeError(result.cleanupError,vocabulary),runWarnings:warnings(result.runWarnings),arbitraryResultFieldsOmitted:true};
}

async function readBounded(input,name,maximum){
  fail(typeof name==='string'&&path.basename(name)===name&&!name.includes('\0'),'UNSAFE_EVIDENCE_FILENAME');
  const handle=await fs.open(path.join(input,name),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=await handle.stat();fail(info.isFile()&&info.size<=maximum,'EVIDENCE_FILE_BOUND');const bytes=await handle.readFile();fail(bytes.length<=maximum,'EVIDENCE_FILE_BOUND');return bytes;}finally{await handle.close();}
}
function parseJson(bytes){try{return JSON.parse(bytes.toString('utf8'));}catch{throw Object.assign(new Error('INVALID_EVIDENCE_JSON'),{code:'INVALID_EVIDENCE_JSON'});}}
async function readJson(input,name,maximum=MAXIMUM_JSON_BYTES){return parseJson(await readBounded(input,name,maximum));}
const saveJson=(directory,name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
function csv(records){
  const columns=['id','route','role','locale','device','kind','attempt','status','authVerified','preSessionRoleVerified','preStaffMfaVerified','preSessionFreshnessVerified','renewalAttempted','renewalSucceeded','httpStatus','performance','accessibility','best-practices','seo','largest-contentful-paint','total-blocking-time','cumulative-layout-shift','durationMs','apiFailureCount','pageErrorCount','errorPresent','runtimeErrorCode','runnerErrorCode','warningCount'];
  const cell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  return[columns,...records.map(record=>columns.map(key=>key==='errorPresent'?!!(record.runtimeError||record.runnerError||record.httpError||record.cleanupError):key==='runtimeErrorCode'?record.runtimeError?.code:key==='runnerErrorCode'?record.runnerError?.code:key==='warningCount'?record.runWarnings?.count:key==='renewalAttempted'?!!record.renewal:key==='renewalSucceeded'?record.renewal?.success:record[key]??record.checks?.[key]??record.scores?.[key]??record.metrics?.[key]))].map(row=>row.map(cell).join(',')).join('\n')+'\n';
}

export async function exportPrivateEvidence({run,output,maximumPartBytes=MAXIMUM_PART_BYTES,vocabulary}){
  fail(typeof run==='string'&&typeof output==='string','RUN_AND_OUTPUT_REQUIRED');
  fail(integer(maximumPartBytes)&&maximumPartBytes>=1024&&maximumPartBytes<=MAXIMUM_PART_BYTES,'INVALID_PART_BOUND');
  const input=path.resolve(run),destination=path.resolve(output);
  fail(input!==destination&&!destination.startsWith(input+path.sep)&&!input.startsWith(destination+path.sep),'OVERLAPPING_EVIDENCE_DIRECTORIES');
  fail(await fs.realpath(input)===input&&(await fs.lstat(input)).isDirectory(),'RAW_RUN_DIRECTORY_POLICY');
  const parent=path.dirname(destination);fail(await fs.realpath(parent)===parent,'OUTPUT_PARENT_POLICY');
  try{await fs.lstat(destination);fail(false,'OUTPUT_ALREADY_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  vocabulary ||= await loadVocabulary();
  const manifestBytes=await readBounded(input,'manifest.json',MAXIMUM_JSON_BYTES),summaryBytes=await readBounded(input,'summary.json',MAXIMUM_JSON_BYTES),inventoryBytes=await readBounded(input,'inventory.json',MAXIMUM_JSON_BYTES);
  const manifest=parseJson(manifestBytes),summary=parseJson(summaryBytes),inventory=parseJson(inventoryBytes);
  fail(manifest.scope==='authenticated'&&hashValue(manifest.configurationHash),'AUTHENTICATED_RUN_REQUIRED');
  const{safe:config,base}=configuration(manifest.config,vocabulary);
  fail(Array.isArray(inventory.jobs)&&inventory.jobs.length<=20000,'INVALID_PRIVATE_INVENTORY');
  const jobs=inventory.jobs.map(job=>safeJob({...job,device:job.device??(config.devices.length===1?config.devices[0]:undefined)},base,vocabulary)),jobMap=new Map(jobs.map(job=>[job.id,job]));
  fail(jobMap.size===jobs.length&&manifest.expected===jobs.length&&summary.expected===jobs.length,'INVENTORY_COUNT_MISMATCH');
  if(config.targetPath!==undefined){
    const selected=jobs[0],rawUrl=inventory.jobs.length===1?new URL(inventory.jobs[0].url):null;
    fail(manifest.coverageScope==='selected-principal-role-route'&&jobs.length===1&&selected.route===config.targetPath&&['workspace','account'].includes(selected.kind)&&selected.role===(selected.kind==='workspace'?'superAdmin':'customer')&&!rawUrl.search&&!rawUrl.hash,'PRIVATE_TARGET_SELECTION_MISMATCH');
  }else fail(manifest.coverageScope!=='selected-principal-role-route','PRIVATE_TARGET_SELECTION_MISMATCH');
  const representativeScope=manifest.coverageScope==='twenty-four-representative-pages-across-twelve-roles';
  if(representativeScope)fail(config.targetPath===undefined&&jobs.length===24
    &&[...roles].every(role=>jobs.filter(job=>job.role===role).length===2
      &&['fa','en'].every(locale=>jobs.some(job=>job.role===role&&job.locale===locale)))
    &&jobs.filter(job=>job.kind==='owned-request-detail').length===1,'PRIVATE_REPRESENTATIVE_SCOPE_MISMATCH');
  fail(Array.isArray(summary.attempts)&&summary.attempts.length<=100000&&Array.isArray(summary.records),'INVALID_PRIVATE_SUMMARY');
  const temporary=await fs.mkdtemp(path.join(parent,'.private-lighthouse-export-'));await fs.chmod(temporary,0o700);
  try{
    const parts=[],attempts=[],byAttempt=new Map(),latest=new Map();let entries=[],entryBytes=0,totalBytes=0;
    const header=number=>JSON.stringify({format:FORMAT+'-part',part:number}).slice(0,-1)+',"attempts":[';
    async function flush(){if(!entries.length)return;const number=parts.length+1,filename='audit-part-'+String(number).padStart(4,'0')+'.json',serialized=header(number)+entries.join(',')+']}\n',bytes=Buffer.byteLength(serialized);fail(bytes<=maximumPartBytes,'AUDIT_PART_EXCEEDED_BOUND');await fs.writeFile(path.join(temporary,filename),serialized,{flag:'wx',mode:0o600});parts.push({filename,attempts:entries.length,bytes,sha256:sha(serialized)});totalBytes+=bytes;entries=[];entryBytes=0;}
    for(const item of summary.attempts){
      fail(object(item)&&jobMap.has(item.id)&&integer(item.attempt)&&item.attempt>0&&item.attempt<=10000,'ATTEMPT_NOT_IN_INVENTORY');
      const key=item.id+'.attempt-'+item.attempt,resultName=key+'.result.json';fail(!byAttempt.has(key)&&(item.result===undefined||item.result===resultName),'UNSAFE_OR_DUPLICATE_RESULT_REFERENCE');
      const result=await readJson(input,resultName);fail(item.status===result.status,'ATTEMPT_STATUS_MISMATCH');
      const clean=safeAttempt(result,jobMap.get(item.id),vocabulary,config.teardownPolicy);fail(clean.attempt===item.attempt,'ATTEMPT_IDENTITY_MISMATCH');
      let report,rawReportSha256,rawReportMissing=false,rawReportInvalid=false;const reportReference=result.report||result.partialReport;
      if(reportReference)fail(reportReference===key+'.lhr.json','UNSAFE_REPORT_REFERENCE');
      // A supervisor can finish a timeout result after the child saved its raw
      // report but before its result reference. Inspect only this exact derived
      // filename so interrupted evidence survives without arbitrary file reads.
      const reportName=key+'.lhr.json';
      {
        try{const raw=await readBounded(input,reportName,MAXIMUM_RAW_BYTES);rawReportSha256=sha(raw);try{report=parseJson(raw);fail(object(report),'INVALID_RAW_REPORT_OBJECT');}catch(error){if(clean.status==='completed')throw error;report=undefined;rawReportInvalid=true;}}
        catch(error){if(error.code!=='ENOENT'||clean.status==='completed')throw error;rawReportMissing=true;}
      }
      fail(clean.status!=='completed'||object(report),'COMPLETED_RAW_REPORT_REQUIRED');
      const compact={...clean,rawReportSha256,rawReportMissing,rawReportInvalid,omissions:OMISSIONS};
      if(report){
        fail(object(report)&&version(report.lighthouseVersion)===vocabulary.lighthouseVersion,'RAW_LIGHTHOUSE_VERSION_MISMATCH');
        fail(clean.status!=='completed'||!report.runtimeError,'COMPLETED_REPORT_HAS_RUNTIME_ERROR');
        compact.lighthouseVersion=version(report.lighthouseVersion);compact.fetchTime=iso(report.fetchTime)||compact.fetchTime;
        compact.runtimeError=safeError(report.runtimeError,vocabulary)||compact.runtimeError;compact.runWarnings=warnings(report.runWarnings??result.runWarnings);
        compact.configSettings=settings(report.configSettings);compact.environment=numberFields(report.environment,new Set(['benchmarkIndex']));compact.categories=categories(report,vocabulary);
        fail(object(report.audits)&&Object.keys(report.audits).length<=2000,'RAW_AUDIT_COUNT_BOUND');
        compact.audits=Object.fromEntries(Object.entries(report.audits).map(([id,audit])=>[auditAlias(id,vocabulary),sanitizeAudit(id,audit,vocabulary)]));
        compact.auditCount=Object.keys(report.audits).length;
      }
      const serialized=JSON.stringify(compact),bytes=Buffer.byteLength(serialized),overhead=Buffer.byteLength(header(parts.length+1))+3;
      fail(bytes+overhead<=maximumPartBytes,'SINGLE_ATTEMPT_EXCEEDS_PART_BOUND');
      if(entries.length&&entryBytes+bytes+entries.length+overhead>maximumPartBytes)await flush();
      const evidence={filename:'audit-part-'+String(parts.length+1).padStart(4,'0')+'.json',index:entries.length,rawReportSha256};entries.push(serialized);entryBytes+=bytes;
      const record={...clean,runtimeError:compact.runtimeError,runWarnings:compact.runWarnings,evidence};byAttempt.set(key,record);attempts.push({id:clean.id,attempt:clean.attempt,status:clean.status,evidence});
      if(!latest.has(clean.id)||latest.get(clean.id).attempt<clean.attempt)latest.set(clean.id,record);
    }
    await flush();
    const records=jobs.flatMap(job=>latest.has(job.id)?[latest.get(job.id)]:[]),counts={expected:jobs.length,attempted:records.length,completed:records.filter(row=>row.status==='completed').length,errors:records.filter(row=>row.status==='error').length,timeouts:records.filter(row=>row.status==='timeout').length,pending:jobs.length-records.length};
    for(const[name,count]of Object.entries(counts))fail(summary[name]===count,'SUMMARY_COUNTER_MISMATCH');
    fail(summary.coverageComplete===(counts.pending===0)&&summary.records.length===records.length,'SUMMARY_COVERAGE_MISMATCH');
    for(const record of summary.records){const expected=latest.get(record.id);fail(expected&&record.attempt===expected.attempt&&record.status===expected.status,'SUMMARY_LATEST_ATTEMPT_MISMATCH');}
    fail(new Set(summary.records.map(row=>row.id)).size===records.length,'SUMMARY_DUPLICATE_LATEST_RECORD');
    const scenarioCoverage={measurement:'Authenticated navigation, Lighthouse audits and recorded shell/content/authentication checks for the listed jobs.',...config.targetPath!==undefined?{selectionScope:'selected-principal-role-route',selectedOnly:true}:{},...representativeScope?{selectionScope:'twenty-four-representative-pages-across-twelve-roles',representativeOnly:true}:{},roles:[...new Set(jobs.map(job=>job.role))].sort(),locales:[...new Set(jobs.map(job=>job.locale))].sort(),devices:[...new Set(jobs.map(job=>job.device))].sort(),jobKinds:Object.fromEntries([...kinds].map(kind=>[kind,jobs.filter(job=>job.kind===kind).length])),registeredPrivatePaths:vocabulary.routes.size,registeredLocalePathsInventoried:new Set(jobs.map(job=>job.route)).size,expectedJobs:jobs.length,attemptedJobs:counts.attempted,successfulJobs:counts.completed,allInventoriedNavigationsSucceeded:counts.completed===counts.expected,allRoleRouteCombinationsTested:false,workflowActionsMeasured:false,limitation:'Only the inventoried role/locale/device/data scenarios are covered. Navigation measurements do not assert exhaustive CRUD, permission-matrix or business-workflow coverage. Owned-request identities are omitted.'};
    const safeManifest={format:FORMAT,scope:'authenticated',createdAt:iso(manifest.createdAt),configurationHash:manifest.configurationHash,config,expected:jobs.length,scenarioCoverage,host:{...numberFields(manifest.host,new Set(['availableCpus','memoryBytes'])),...(object(manifest.host)&&['linux','darwin','win32'].includes(manifest.host.platform)?{platform:manifest.host.platform}:{}),...(object(manifest.host)&&['x64','arm64','arm','ia32'].includes(manifest.host.architecture)?{architecture:manifest.host.architecture}:{}),otherHostFieldsOmitted:true},omissions:OMISSIONS};
    const safeSummary={format:FORMAT,scope:'authenticated',updatedAt:iso(summary.updatedAt),...counts,coverageComplete:counts.pending===0,interrupted:summary.interrupted===true,scenarioCoverage,omissions:OMISSIONS,parts,records,attempts};
    await Promise.all([saveJson(temporary,'manifest.json',safeManifest),saveJson(temporary,'inventory.json',{format:FORMAT,scope:'authenticated',jobs,omissions:OMISSIONS}),saveJson(temporary,'summary.json',safeSummary),fs.writeFile(path.join(temporary,'summary.csv'),csv(records),{flag:'wx',mode:0o600})]);
    await saveJson(temporary,'EXPORT.json',{format:FORMAT,exportedAt:new Date().toISOString(),buildId:config.buildId,configurationHash:manifest.configurationHash,expected:jobs.length,attempts:attempts.length,coverageComplete:counts.pending===0,scenarioCoverage,maximumPartBytes,maximumRawReportBytes:MAXIMUM_RAW_BYTES,parts,compactAuditBytes:totalBytes,inputManifestSha256:sha(manifestBytes),inputInventorySha256:sha(inventoryBytes),inputSummarySha256:sha(summaryBytes),omissions:OMISSIONS});
    // A moving summary must not be published as a coherent frozen export.
    for(const[name,bytes]of [['manifest.json',manifestBytes],['inventory.json',inventoryBytes],['summary.json',summaryBytes]])fail(sha(await readBounded(input,name,MAXIMUM_JSON_BYTES))===sha(bytes),'RUN_CHANGED_DURING_EXPORT');
    try{await fs.lstat(destination);fail(false,'OUTPUT_ALREADY_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.rename(temporary,destination);
    return{format:FORMAT,attempts:attempts.length,parts:parts.length,compactAuditBytes:totalBytes,coverageComplete:counts.pending===0,...counts};
  }catch(error){await fs.rm(temporary,{recursive:true,force:true});throw error;}
}

async function main(){
  const options={};for(let index=2;index<process.argv.length;index+=2){const key=process.argv[index],value=process.argv[index+1];fail(['--run','--output'].includes(key)&&value!==undefined&&!Object.hasOwn(options,key.slice(2)),'USAGE_PRIVATE_EXPORT_RUN_OUTPUT');options[key.slice(2)]=value;}
  const result=await exportPrivateEvidence(options);process.stdout.write(JSON.stringify({event:'private-export',...result})+'\n');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{await main();}catch(error){process.stderr.write(JSON.stringify({ok:false,code:/^[A-Z0-9_]{2,100}$/.test(String(error?.code||''))?error.code:'PRIVATE_EXPORT_FAILED'})+'\n');process.exitCode=1;}}
