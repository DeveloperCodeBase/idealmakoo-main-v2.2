import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {exportPrivateEvidence,loadVocabulary,safeSelector,sanitizeAudit,FORMAT,MAXIMUM_PART_BYTES} from '../scripts/export-private-lighthouse-evidence.mjs';
import {PRIVATE_EDITOR_CLEANUP_POLICY,LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY} from '../scripts/lib/private-audit-editor-cleanup.mjs';
import {privateAuditJobs} from '../scripts/lib/private-audit-policy.mjs';

const vocabulary=await loadVocabulary(),temporary=[];
const SECRET='PRIVATE_CUSTOMER_SENTINEL_7d09b1',TOKEN='private-session-cookie-18e529a4',BASE='http://127.0.0.1:4173';
const sha=value=>createHash('sha256').update(value).digest('hex');
const write=(directory,name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value,null,2),{mode:0o600});
const read=(directory,name)=>fs.readFile(path.join(directory,name),'utf8').then(JSON.parse);
after(async()=>{for(const directory of temporary)await fs.rm(directory,{recursive:true,force:true});});

function job(index){return{id:sha('private-job-'+index).slice(0,16),url:index%2?BASE+'/fa/account/requests/?id='+SECRET+'&token='+TOKEN:BASE+'/en/admin/crm/accounts/?session='+TOKEN,route:SECRET,locale:index%2?'fa':'en',role:index%2?'customer':'superAdmin',kind:index%2?'owned-request-detail':'workspace',device:'mobile',expectedStatus:200,indexed:false,privateUnknownField:SECRET};}
function result(entry,attempt=1,status='completed'){
  return{...entry,attempt,status,scores:status==='completed'?{performance:73,accessibility:82,'best-practices':96,seo:66}:{},metrics:{'largest-contentful-paint':2345,'total-blocking-time':90,'cumulative-layout-shift':0.03,privateMetric:SECRET},durationMs:4321,startedAt:'2026-10-20T00:00:00.000Z',finishedAt:'2026-10-20T00:00:04.321Z',authVerified:status==='completed',httpStatus:200,apiFailureCount:0,pageErrorCount:0,checks:{preSessionRoleVerified:true,preStaffMfaVerified:true,preSessionFreshnessVerified:true,sessionRole:entry.role,httpStatus:200,sessionRoleVerified:true,httpStatusVerified:true,staffMfaVerified:true,shellPresent:true,contentReady:true,noindex:true,finalPathMatches:true,documentLanguage:true,workspaceLoaded:true,ownedRequestVisible:true,ownedRequestVerified:true,apiErrorFree:true,runtimeErrorFree:true,userId:SECRET,sessionId:TOKEN},preflight:{sessionRole:entry.role,httpStatus:200,workspaceStatus:entry.role==='customer'?null:200,securityStatus:200,expiresAt:'2026-10-21T00:00:00.000Z',observedAt:'2026-10-20T00:00:00.500Z',sessionId:TOKEN,email:SECRET},headers:{Authorization:TOKEN,Cookie:TOKEN},cookie:TOKEN,errorDetails:SECRET,cleanupError:SECRET,runWarnings:[SECRET],report:entry.id+'.attempt-'+attempt+'.lhr.json'};
}
function report(detailed=true){
  return{lighthouseVersion:vocabulary.lighthouseVersion,fetchTime:'2026-10-20T00:00:03.000Z',requestedUrl:BASE+'/?token='+TOKEN,finalDisplayedUrl:BASE+'/'+SECRET,headers:{cookie:TOKEN},cookies:[TOKEN],sessionId:TOKEN,privateDocument:{name:SECRET},runWarnings:[SECRET],environment:{benchmarkIndex:777,hostname:SECRET},configSettings:{formFactor:'mobile',disableStorageReset:true,throttlingMethod:'simulate',throttling:{cpuSlowdownMultiplier:4,authorization:TOKEN},screenEmulation:{width:412,height:823,mobile:true,deviceScaleFactor:1.75,deviceName:SECRET},extraHeaders:{cookie:TOKEN}},categories:{performance:{id:'performance',title:SECRET,description:SECRET,score:0.73,auditRefs:[{id:'largest-contentful-paint',weight:25,group:SECRET}]},accessibility:{id:'accessibility',score:0.82,auditRefs:[{id:'color-contrast',weight:3}]}},audits:{
    'largest-contentful-paint':{id:'largest-contentful-paint',score:0.73,scoreDisplayMode:'numeric',numericValue:2345,numericUnit:'millisecond',title:SECRET,description:SECRET,displayValue:SECRET},
    'color-contrast':{id:'color-contrast',score:0,scoreDisplayMode:'binary',title:SECRET,warnings:[SECRET],details:{type:'table',headings:[{key:'node',valueType:'node',label:SECRET}],items:detailed?Array.from({length:40},()=>({node:{type:'node',selector:'body > main#'+SECRET+' > div.'+SECRET+' > input[data-secret="'+SECRET+'"]:nth-child(2)',snippet:'<input value="'+SECRET+'" />',nodeLabel:SECRET,lhId:TOKEN,path:SECRET},contrastRatio:2.3,expectedContrastRatio:4.5,totalBytes:123,url:BASE+'/?token='+TOKEN,accountBalance:987654321,privateKey:SECRET})):[]}},
    'final-screenshot':{id:'final-screenshot',score:null,scoreDisplayMode:'informative',details:{type:'screenshot',data:'data:image/png;base64,'+'A'.repeat(5000),screenshot:TOKEN}},
    [SECRET]:{id:SECRET,title:SECRET,score:0.5,scoreDisplayMode:'binary',errorMessage:SECRET,details:{items:[{url:BASE+'/'+SECRET,authorization:TOKEN}]}}
  }};
}
async function fixture(count=1,{detailed=true}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'idealmakoo-private-lh-'));temporary.push(directory);const run=path.join(directory,'raw'),output=path.join(directory,'safe');await fs.mkdir(run,{mode:0o700});
  const jobs=Array.from({length:count},(_,index)=>job(index)),results=jobs.map(entry=>result(entry));
  const manifest={scope:'authenticated',expected:count,configurationHash:'a'.repeat(64),createdAt:'2026-10-20T00:00:00.000Z',privateField:SECRET,config:{schemaVersion:2,baseUrl:BASE,buildId:'private-lh-build-2_1',applicationVersion:'2.1.0',lighthouseVersion:vocabulary.lighthouseVersion,chromeVersion:'Google Chrome for Testing 156.0.8078.4',devices:['mobile'],categories:['performance','accessibility','best-practices','seo'],inventoryHash:sha(JSON.stringify(jobs)),chromeFlags:['--headless=new','--window-size=412,823','--user-data-dir=/tmp/'+SECRET,'--extra-headers=Cookie:'+TOKEN],chromePath:'/home/'+SECRET+'/chrome',privateConfig:TOKEN},host:{platform:'linux',architecture:'x64',availableCpus:4,memoryBytes:1073741824,hostname:SECRET,cpu:SECRET}};
  const summary={expected:count,attempted:count,completed:count,errors:0,timeouts:0,pending:0,coverageComplete:true,updatedAt:'2026-10-20T00:00:05.000Z',records:results,attempts:results.map(row=>({id:row.id,attempt:row.attempt,status:row.status,result:row.id+'.attempt-'+row.attempt+'.result.json'})),privateExtra:SECRET};
  await write(run,'manifest.json',manifest);await write(run,'inventory.json',{jobs,excluded:[SECRET],session:TOKEN});await write(run,'summary.json',summary);await fs.writeFile(path.join(run,'summary.csv'),'url,error\n"'+SECRET+'","=HYPERLINK(\"'+TOKEN+'\")"\n');
  for(const row of results){await write(run,row.id+'.attempt-1.result.json',row);await write(run,row.report,report(detailed));}
  return{directory,run,output,jobs,results,manifest,summary};
}
async function compactAttempts(directory){const summary=await read(directory,'summary.json'),parts=new Map();for(const item of summary.parts)parts.set(item.filename,await read(directory,item.filename));return{summary,parts,attempts:summary.attempts.map(item=>parts.get(item.evidence.filename).attempts[item.evidence.index])};}
const rejectCode=(promise,code)=>assert.rejects(promise,error=>error.code===code);

const cleanupProof=()=>({policy:PRIVATE_EDITOR_CLEANUP_POLICY,success:true,destinationVerified:true,navigationStatus:200,beforeCount:1,trackedCount:1,remainingCount:0,releasedCount:1,observedReleaseRequests:1,observedReleaseResponses:0,observedReleaseFailures:0,observedRequestFailures:0,releaseStatuses:[],durationMs:1200,budgetMs:15000,settledForMs:500,settlementSucceeded:true,settlementDurationMs:600,settlementQuietForMs:500,pendingRequestsAtNavigation:0,documentReady:true,contentReady:true,nestedEditorsReady:true,collaborationReady:true,formsPanelCount:1,collaborationPanelCount:1});
test('current cleanup policy exports typed server-release proof without inventing an HTTP response or leaking IDs',async()=>{
  const data=await fixture(1,{detailed:false});data.manifest.config.teardownPolicy=PRIVATE_EDITOR_CLEANUP_POLICY;data.manifest.config.teardownFingerprint='b'.repeat(64);
  delete data.results[0].cleanupError;data.results[0].editorCleanup={...cleanupProof(),actorId:SECRET,leaseId:SECRET,watermark:TOKEN,headers:{Cookie:TOKEN}};
  await write(data.run,'manifest.json',data.manifest);await write(data.run,data.results[0].id+'.attempt-1.result.json',data.results[0]);
  await exportPrivateEvidence({...data,vocabulary});const {attempts}=await compactAttempts(data.output);
  assert.deepEqual(attempts[0].editorCleanup,cleanupProof());assert.equal(attempts[0].editorCleanup.observedReleaseResponses,0);
  const manifest=await read(data.output,'manifest.json');assert.equal(manifest.config.teardownPolicy,PRIVATE_EDITOR_CLEANUP_POLICY);assert.equal(manifest.config.teardownFingerprint,'b'.repeat(64));
  for(const name of await fs.readdir(data.output)){const text=await fs.readFile(path.join(data.output,name),'utf8');assert(!text.includes(SECRET));assert(!text.includes(TOKEN));}
});
test('current completed attempts require exact numeric cleanup proof; historical policy absence remains distinct',async()=>{
  for(const invalid of [undefined,{...cleanupProof(),releasedCount:0},{...cleanupProof(),remainingCount:'0'},{...cleanupProof(),success:'true'},{...cleanupProof(),observedReleaseFailures:1},{...cleanupProof(),settlementSucceeded:false},{...cleanupProof(),settlementQuietForMs:499},{...cleanupProof(),pendingRequestsAtNavigation:1}]){
    const data=await fixture(1,{detailed:false});data.manifest.config.teardownPolicy=PRIVATE_EDITOR_CLEANUP_POLICY;data.manifest.config.teardownFingerprint='b'.repeat(64);
    delete data.results[0].cleanupError;data.results[0].editorCleanup=invalid;
    await write(data.run,'manifest.json',data.manifest);await write(data.run,data.results[0].id+'.attempt-1.result.json',data.results[0]);
    await rejectCode(exportPrivateEvidence({...data,vocabulary}),'COMPLETED_PRIVATE_AUDIT_WITHOUT_EDITOR_CLEANUP');
  }
  const legacy=await fixture(1,{detailed:false});await exportPrivateEvidence({...legacy,vocabulary});assert.equal((await read(legacy.output,'manifest.json')).config.teardownPolicy,undefined);
});

function legacyCleanupProof(){
 const proof={...cleanupProof(),policy:LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY,durationMs:650};
 for(const key of ['settlementDurationMs','settlementQuietForMs','pendingRequestsAtNavigation','collaborationPanelCount','formsPanelCount','settlementSucceeded','documentReady','contentReady','nestedEditorsReady','collaborationReady'])delete proof[key];
 return proof;
}
test('historical v1 exports require the original proof without fabricating v2 settlement',async()=>{
 for(const valid of [true,false]){
  const data=await fixture(1,{detailed:false});Object.assign(data.manifest.config,{teardownPolicy:LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY,teardownFingerprint:'c'.repeat(64)});
  delete data.results[0].cleanupError;data.results[0].editorCleanup={...legacyCleanupProof(),...valid?{}:{releasedCount:0}};
  await write(data.run,'manifest.json',data.manifest);await write(data.run,data.results[0].id+'.attempt-1.result.json',data.results[0]);
  if(!valid){await rejectCode(exportPrivateEvidence({...data,vocabulary}),'COMPLETED_PRIVATE_AUDIT_WITHOUT_EDITOR_CLEANUP');continue;}
  await exportPrivateEvidence({...data,vocabulary});const {attempts}=await compactAttempts(data.output);
  assert.deepEqual(attempts[0].editorCleanup,legacyCleanupProof());assert.equal(attempts[0].editorCleanup.settlementSucceeded,undefined);
 }
});
test('manifest and receipt policy must agree for successes and failures, while unknown policy rejects',async()=>{
 for(const status of ['completed','error'])for(const policies of [[PRIVATE_EDITOR_CLEANUP_POLICY,LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY],[LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY,PRIVATE_EDITOR_CLEANUP_POLICY]]){
  const data=await fixture(1,{detailed:false});Object.assign(data.manifest.config,{teardownPolicy:policies[0],teardownFingerprint:'d'.repeat(64)});
  data.results[0].status=status;delete data.results[0].cleanupError;data.results[0].editorCleanup={...cleanupProof(),policy:policies[1]};
  data.summary.attempts[0].status=status;data.summary.completed=status==='completed'?1:0;data.summary.errors=status==='error'?1:0;await write(data.run,'summary.json',data.summary);
  await write(data.run,'manifest.json',data.manifest);await write(data.run,data.results[0].id+'.attempt-1.result.json',data.results[0]);
  await rejectCode(exportPrivateEvidence({...data,vocabulary}),'EDITOR_CLEANUP_POLICY_MISMATCH');
 }
 const data=await fixture(1,{detailed:false});Object.assign(data.manifest.config,{teardownPolicy:'unknown-policy',teardownFingerprint:'d'.repeat(64)});await write(data.run,'manifest.json',data.manifest);await rejectCode(exportPrivateEvidence({...data,vocabulary}),'INVALID_EDITOR_CLEANUP_POLICY');
});
test('a retained v1 cleanup failure remains a failed attempt with its measured scores and original report hash',async()=>{
 const data=await fixture(1,{detailed:false});Object.assign(data.manifest.config,{teardownPolicy:LEGACY_PRIVATE_EDITOR_CLEANUP_POLICY,teardownFingerprint:'e'.repeat(64)});
 const row=data.results[0];Object.assign(row,{status:'error',errorCode:'AUDIT_EDITOR_CLEANUP_FAILED',cleanupError:{code:'AUDIT_EDITOR_CLEANUP_TIMEOUT'},editorCleanup:{...legacyCleanupProof(),success:false,beforeCount:0,trackedCount:1,remainingCount:1,releasedCount:0,durationMs:15000,settledForMs:0}});
 data.summary.completed=0;data.summary.errors=1;data.summary.attempts[0].status='error';
 await write(data.run,'manifest.json',data.manifest);await write(data.run,'summary.json',data.summary);await write(data.run,row.id+'.attempt-1.result.json',row);
 await exportPrivateEvidence({...data,vocabulary});const {summary,attempts}=await compactAttempts(data.output);
 assert.equal(summary.completed,0);assert.equal(summary.errors,1);assert.equal(attempts[0].status,'error');assert.equal(attempts[0].scores.performance,73);assert.equal(attempts[0].editorCleanup.success,false);assert.equal(attempts[0].editorCleanup.settlementSucceeded,undefined);assert.equal(attempts[0].rawReportSha256,sha(await fs.readFile(path.join(data.run,row.report))));
});

test('selected private exports retain an explicit one-page scope and reject a mismatched path, role, query or full-coverage label',async()=>{
 async function selectedFixture(){
  const data=await fixture(1,{detailed:false}),entry={...data.jobs[0],url:BASE+'/ar/admin/users/',route:'admin/users',locale:'ar'};
  data.jobs=[entry];data.results=[result(entry)];data.summary.records=data.results;
  data.manifest.config.targetPath='/ar/admin/users/';data.manifest.coverageScope='selected-principal-role-route';
  await write(data.run,'manifest.json',data.manifest);await write(data.run,'inventory.json',{jobs:data.jobs});await write(data.run,'summary.json',data.summary);await write(data.run,entry.id+'.attempt-1.result.json',data.results[0]);
  return data;
 }
 const good=await selectedFixture();await exportPrivateEvidence({...good,vocabulary});const exported=await read(good.output,'summary.json');
 assert.equal(exported.expected,1);assert.equal(exported.scenarioCoverage.selectedOnly,true);assert.equal(exported.scenarioCoverage.selectionScope,'selected-principal-role-route');
 assert.equal((await read(good.output,'manifest.json')).config.targetPath,'/ar/admin/users/');
 for(const change of [data=>{data.manifest.config.targetPath='/ar/admin/settings/';},data=>{data.manifest.coverageScope='all-registered-principal-roles-plus-owned-details-and-representative-other-roles';},data=>{data.jobs[0].role='admin';},data=>{data.jobs[0].url+='?token=private';}]){
  const data=await selectedFixture();change(data);await write(data.run,'manifest.json',data.manifest);await write(data.run,'inventory.json',{jobs:data.jobs});
  await rejectCode(exportPrivateEvidence({...data,vocabulary}),'PRIVATE_TARGET_SELECTION_MISMATCH');
 }
});

test('source-derived vocabulary includes all101 protected routes and locked Lighthouse IDs',()=>{
  assert.equal(vocabulary.routes.size,101);assert(vocabulary.routes.has('admin/Migration'));assert(vocabulary.routes.has('account/security'));assert(vocabulary.auditIds.has('color-contrast'));assert(vocabulary.errorCodes.has('NO_FCP'));
  assert([...vocabulary.errorCodes].some(code=>code.startsWith('AUDIT_PRE_')),'Before-view session helper codes are obtained from its saved source.');
});

test('representative exports explicitly label the 24-page scope and reject incomplete role coverage',async()=>{
 const data=await fixture(0,{detailed:false});
 const jobs=privateAuditJobs([...vocabulary.routes],BASE,'IM-REQ-e32a66fd-1381-4cdb-966b-07edc4c067ce',{representative:true});
 data.manifest.expected=jobs.length;data.manifest.coverageScope='twenty-four-representative-pages-across-twelve-roles';
 data.manifest.config.inventoryHash=sha(JSON.stringify(jobs));
 Object.assign(data.summary,{expected:jobs.length,pending:jobs.length,coverageComplete:false});
 await write(data.run,'manifest.json',data.manifest);await write(data.run,'inventory.json',{jobs});await write(data.run,'summary.json',data.summary);
 await exportPrivateEvidence({...data,vocabulary});
 const exported=await read(data.output,'summary.json');
 assert.equal(exported.expected,24);assert.equal(exported.scenarioCoverage.representativeOnly,true);
 assert.equal(exported.scenarioCoverage.selectionScope,'twenty-four-representative-pages-across-twelve-roles');
 assert.equal(exported.scenarioCoverage.roles.length,12);assert.equal(exported.coverageComplete,false);
 const incomplete=await fixture(1,{detailed:false});incomplete.manifest.coverageScope=data.manifest.coverageScope;
 await write(incomplete.run,'manifest.json',incomplete.manifest);
 await rejectCode(exportPrivateEvidence({...incomplete,vocabulary}),'PRIVATE_REPRESENTATIVE_SCOPE_MISMATCH');
});
test('selectors retain useful structure while removing identity/class/attribute text',()=>{
  assert.equal(safeSelector('body > main#secret > .private-user > button[data-user="secret"]:nth-child(2)'),'body > main > * > button:nth-child(2)');
  assert.equal(safeSelector('input.private-class:first-of-type'),'input:first-of-type');
  for(const input of ['private-customer-secret > button','div:not([id="secret"])','div\\secret > a','[data-user="x]PRIVATE"] > button','x'.repeat(5000)])assert.equal(safeSelector(input),null);
});
test('normal and failed-score audits omit execution errors while genuine audit errors survive export',async()=>{
  const data=await fixture(1,{detailed:false}),raw=report(false);
  raw.audits['bootup-time']={id:'bootup-time',score:null,scoreDisplayMode:'error',errorCode:'NO_FCP'};
  await write(data.run,data.results[0].report,raw);
  await exportPrivateEvidence({...data,vocabulary});
  const {attempts}=await compactAttempts(data.output),audits=attempts[0].audits;
  for(const id of ['largest-contentful-paint','color-contrast','final-screenshot']){
    assert.equal(Object.hasOwn(audits[id],'error'),false,'A normal audit result, including a failing score, is not an execution error.');
    assert.equal(audits[id].score,raw.audits[id].score);
  }
  assert.deepEqual(audits['bootup-time'].error,{present:true,code:'NO_FCP',textOmitted:true});
  const unknown=Object.values(audits).find(audit=>audit.originalIdOmitted);
  assert.deepEqual(unknown.error,{present:true,code:'UNCLASSIFIED',textOmitted:true});
  assert.equal(attempts[0].rawReportSha256,sha(await fs.readFile(path.join(data.run,data.results[0].report))));
  const body=JSON.stringify(attempts);assert(!body.includes(SECRET));assert(!body.includes(TOKEN));
});
test('the installed Lighthouse metricSavings outcome survives private export while arbitrary modes remain omitted',async()=>{
  const installed=await fs.readFile(new URL('../node_modules/lighthouse/core/audits/audit.js',import.meta.url),'utf8');
  assert.match(installed,/METRIC_SAVINGS:\s*'metricSavings'/,'Use the actual installed Lighthouse display-mode vocabulary.');
  const data=await fixture(1,{detailed:false}),raw=report(false);
  raw.audits['largest-contentful-paint'].scoreDisplayMode='metricSavings';
  raw.audits[SECRET].scoreDisplayMode=SECRET;
  await write(data.run,data.results[0].report,raw);const rawHash=sha(await fs.readFile(path.join(data.run,data.results[0].report)));
  await exportPrivateEvidence({...data,vocabulary});const exported=await compactAttempts(data.output),attempt=exported.attempts[0];
  assert.equal(attempt.audits['largest-contentful-paint'].scoreDisplayMode,'metricSavings');assert.equal(attempt.audits['largest-contentful-paint'].numericValue,2345);assert.equal(attempt.rawReportSha256,rawHash);
  const unknown=Object.values(attempt.audits).find(audit=>audit.originalIdOmitted);assert.equal(unknown.scoreDisplayMode,undefined);
  for(const name of await fs.readdir(data.output)){const text=await fs.readFile(path.join(data.output,name),'utf8');assert(!text.includes(SECRET));assert(!text.includes(TOKEN));}
});
test('delivered JSON and regenerated CSV exclude all planted private text and credentials',async()=>{
  const fixtureData=await fixture(2),rawHash=sha(await fs.readFile(path.join(fixtureData.run,fixtureData.results[0].report)));
  // Rendering-mode evidence must survive the same filter that removes private
  // profile paths and headers. Otherwise a software-driver run could be
  // mistaken for the default browser pipeline after export.
  fixtureData.manifest.config.chromeFlags.splice(2,0,'--use-gl=angle','--use-angle=swiftshader');
  fixtureData.manifest.config.graphicsMode='swiftshader-driver';
  await write(fixtureData.run,'manifest.json',fixtureData.manifest);
  const result=await exportPrivateEvidence({...fixtureData,vocabulary});assert.equal(result.completed,2);assert.equal(result.coverageComplete,true);
  for(const name of await fs.readdir(fixtureData.output)){
    const text=await fs.readFile(path.join(fixtureData.output,name),'utf8');for(const secret of [SECRET,TOKEN,'data:image/','<input','accountBalance','987654321','extraHeaders','HYPERLINK'])assert(!text.includes(secret),name+' leaked a planted private value');
  }
  const exported=await compactAttempts(fixtureData.output),first=exported.attempts[0];
  assert.equal(first.rawReportSha256,rawHash);assert.equal(first.scores.performance,73);assert.equal(first.metrics['largest-contentful-paint'],2345);
  assert.equal(first.auditCount,4);assert.equal(Object.keys(first.audits).length,4);assert.equal(first.audits['color-contrast'].score,0);
  assert.equal(first.audits['color-contrast'].details.items.omittedItems,20);assert.equal(first.audits['color-contrast'].details.items.items[0].node.selector,'body > main > div > input:nth-child(2)');
  assert.equal(first.audits['color-contrast'].details.items.items[0].contrastRatio,2.3);assert.equal(first.audits['final-screenshot'].score,null);assert.deepEqual(first.audits['final-screenshot'].details,{omitted:'image-artifact'});
  assert(Object.keys(first.audits).some(key=>key.startsWith('private-audit-')));assert.equal(first.configSettings.disableStorageReset,true);
  assert.equal(exported.summary.records[1].ownedRequestIdentifierOmitted,true);assert.equal(exported.summary.records[1].route,'/fa/account/requests/');
  const manifest=await read(fixtureData.output,'manifest.json');assert.deepEqual(manifest.config.chromeFlags,['--headless=new','--window-size=412,823','--use-gl=angle','--use-angle=swiftshader']);assert.equal(manifest.config.omittedChromeFlags,2);
  assert.equal(manifest.config.chromeFlagsSha256,sha(JSON.stringify(fixtureData.manifest.config.chromeFlags)));
  assert.equal(manifest.config.graphicsMode,'swiftshader-driver');
  assert.equal(manifest.scenarioCoverage.allRoleRouteCombinationsTested,false);assert.equal(manifest.scenarioCoverage.workflowActionsMeasured,false);
  assert.equal(sha(await fs.readFile(path.join(fixtureData.run,fixtureData.results[0].report))),rawHash,'Raw evidence must be unchanged');
  assert.equal((await read(fixtureData.output,'EXPORT.json')).maximumPartBytes,MAXIMUM_PART_BYTES);
});
test('optional full-page report image policy survives the private manifest and measured settings export',async()=>{
 for(const disabled of [false,true]){
  const data=await fixture(1,{detailed:false});data.manifest.config.disableFullPageScreenshot=disabled;
  await write(data.run,'manifest.json',data.manifest);
  const report=await read(data.run,data.results[0].report);report.configSettings={...report.configSettings,disableFullPageScreenshot:disabled};
  await write(data.run,data.results[0].report,report);
  await exportPrivateEvidence({...data,vocabulary});
  assert.equal((await read(data.output,'manifest.json')).config.disableFullPageScreenshot,disabled);
  const exported=await compactAttempts(data.output);assert.equal(exported.attempts[0].configSettings.disableFullPageScreenshot,disabled);
 }
});
test('parts enforce their byte limit and every attempt index resolves with its raw hash',async()=>{
  const fixtureData=await fixture(8,{detailed:false});const result=await exportPrivateEvidence({...fixtureData,vocabulary,maximumPartBytes:10000});assert(result.parts>1);
  const exported=await compactAttempts(fixtureData.output);assert.equal(exported.attempts.length,8);
  for(const part of exported.summary.parts){const bytes=await fs.readFile(path.join(fixtureData.output,part.filename));assert(bytes.length<=10000);assert.equal(bytes.length,part.bytes);assert.equal(sha(bytes),part.sha256);assert.equal(JSON.parse(bytes).format,FORMAT+'-part');}
  for(const entry of exported.summary.attempts){const source=await fs.readFile(path.join(fixtureData.run,entry.id+'.attempt-'+entry.attempt+'.lhr.json'));assert.equal(entry.evidence.rawReportSha256,sha(source));}
});
test('earlier timeouts, current runtime errors and pending coverage survive export',async()=>{
  const data=await fixture(3,{detailed:false}),earlier=result(data.jobs[0],1,'timeout'),latest=result(data.jobs[0],2),failed=result(data.jobs[1],1,'error');delete earlier.report;earlier.error=SECRET;failed.runtimeError={code:'NO_FCP',message:SECRET};
  const failedReport=report(false);failedReport.runtimeError={code:'NO_FCP',message:SECRET};
  await write(data.run,earlier.id+'.attempt-1.result.json',earlier);await write(data.run,latest.id+'.attempt-2.result.json',latest);await write(data.run,latest.report,report(false));await write(data.run,failed.id+'.attempt-1.result.json',failed);await write(data.run,failed.report,failedReport);
  data.summary={...data.summary,attempted:2,completed:1,errors:1,timeouts:0,pending:1,coverageComplete:false,records:[latest,failed],attempts:[earlier,latest,failed].map(row=>({id:row.id,attempt:row.attempt,status:row.status,result:row.id+'.attempt-'+row.attempt+'.result.json'}))};await write(data.run,'summary.json',data.summary);
  const exportedResult=await exportPrivateEvidence({...data,vocabulary});assert.equal(exportedResult.coverageComplete,false);assert.equal(exportedResult.pending,1);assert.equal(exportedResult.errors,1);
  const exported=await compactAttempts(data.output);assert.equal(exported.attempts.length,3);assert.equal(exported.attempts[0].status,'timeout');assert.equal(exported.summary.records[0].attempt,2);assert.equal(exported.summary.records[1].runtimeError.code,'NO_FCP');assert.equal(exported.summary.records[1].runtimeError.textOmitted,true);
  assert.equal(exported.summary.scenarioCoverage.allInventoriedNavigationsSucceeded,false);
});
test('malformed partial LHR is retained as an explicit failed-report hash',async()=>{
  const data=await fixture(1,{detailed:false});const failed=result(data.jobs[0],1,'error');await write(data.run,failed.id+'.attempt-1.result.json',failed);const raw='{incomplete '+SECRET;await fs.writeFile(path.join(data.run,failed.report),raw);data.summary={...data.summary,completed:0,errors:1,records:[failed],attempts:[{id:failed.id,attempt:1,status:'error',result:failed.id+'.attempt-1.result.json'}]};await write(data.run,'summary.json',data.summary);
  await exportPrivateEvidence({...data,vocabulary});const exported=await compactAttempts(data.output);assert.equal(exported.attempts[0].rawReportInvalid,true);assert.equal(exported.attempts[0].rawReportSha256,sha(raw));assert.equal(exported.attempts[0].audits,undefined);
});
test('a supervisor timeout preserves an already-written report without a child reference',async()=>{
  const data=await fixture(1,{detailed:false}),failed=result(data.jobs[0],1,'timeout');delete failed.report;failed.errorCode='AUDIT_DEADLINE_EXCEEDED';
  await write(data.run,failed.id+'.attempt-1.result.json',failed);data.summary={...data.summary,completed:0,timeouts:1,records:[failed],attempts:[{id:failed.id,attempt:1,status:'timeout',result:failed.id+'.attempt-1.result.json'}]};await write(data.run,'summary.json',data.summary);
  const rawHash=sha(await fs.readFile(path.join(data.run,data.results[0].report)));await exportPrivateEvidence({...data,vocabulary});const exported=await compactAttempts(data.output);
  assert.equal(exported.attempts[0].rawReportSha256,rawHash);assert.equal(exported.attempts[0].auditCount,4);assert.equal(exported.attempts[0].runnerError.code,'AUDIT_DEADLINE_EXCEEDED');assert.equal(exported.attempts[0].status,'timeout');assert.equal(exported.summary.completed,0);
});
test('completed protected measurements require actual role/MFA/shell/content/HTTP evidence',async()=>{
  for(const mutation of [row=>row.authVerified=false,row=>row.checks.staffMfaVerified=false,row=>row.checks.sessionRole='customer',row=>row.checks.shellPresent=false,row=>row.checks.contentReady=false,row=>row.checks.finalPathMatches=false,row=>row.checks.httpStatus=302,row=>row.checks.documentLanguage=false,row=>row.checks.ownedRequestVerified=false,row=>row.checks.apiErrorFree=false,row=>row.checks.runtimeErrorFree=false,row=>row.checks.noindex=false,row=>row.checks.sessionRoleVerified=false,row=>row.checks.preSessionRoleVerified=false,row=>row.checks.preStaffMfaVerified=false,row=>delete row.checks.preSessionFreshnessVerified]){
    const data=await fixture(1,{detailed:false});mutation(data.results[0]);await write(data.run,data.jobs[0].id+'.attempt-1.result.json',data.results[0]);await rejectCode(exportPrivateEvidence({...data,vocabulary}),'COMPLETED_PRIVATE_AUDIT_WITHOUT_AUTH_PROOF');await assert.rejects(fs.access(data.output));
  }
});
test('completed attempts require an observed before-view session proof with a valid expiry',async()=>{
  for(const mutation of [
    row=>delete row.preflight,row=>row.preflight.sessionRole='customer',row=>row.preflight.httpStatus=401,
    row=>row.preflight.workspaceStatus=403,row=>row.preflight.workspaceStatus=null,row=>row.preflight.securityStatus=null,
    row=>row.preflight.expiresAt=row.preflight.observedAt,row=>row.preflight.expiresAt='2026-10-20T00:00:03.000Z',
    row=>row.preflight.observedAt=SECRET,row=>{row.fetchTime='2026-10-20T00:00:00.100Z';},
  ]){
    const data=await fixture(1,{detailed:false});mutation(data.results[0]);
    await write(data.run,data.jobs[0].id+'.attempt-1.result.json',data.results[0]);
    await rejectCode(exportPrivateEvidence({...data,vocabulary}),'COMPLETED_PRIVATE_AUDIT_WITHOUT_PREFLIGHT_PROOF');await assert.rejects(fs.access(data.output));
  }
});
function plannedRenewal(){return{reason:'absolute-expiry-approaching',startedAt:'2026-10-20T00:00:00.050Z',finishedAt:'2026-10-20T00:00:00.400Z',previousExpiresAt:'2026-10-20T00:07:00.000Z',expiresAt:'2026-10-21T00:00:00.000Z',success:true};}
test('a planned real renewal preserves only typed timing proof and keeps customer MFA explicitly conditional',async()=>{
  const data=await fixture(2,{detailed:false});
  data.results[0].renewal={...plannedRenewal(),cookie:TOKEN,password:SECRET,userAgent:SECRET,sessionId:TOKEN};
  await write(data.run,data.jobs[0].id+'.attempt-1.result.json',data.results[0]);
  await exportPrivateEvidence({...data,vocabulary});const exported=await compactAttempts(data.output);
  const first=exported.attempts[0];assert.equal(first.authenticationProofVersion,2);assert.equal(first.checks.preSessionRoleVerified,true);assert.equal(first.checks.preStaffMfaVerified,true);assert.equal(first.checks.preSessionFreshnessVerified,true);
  assert.deepEqual(first.renewal,{...plannedRenewal(),otherFieldsOmitted:true});
  assert.equal(first.preflight.sessionRole,'superAdmin');assert.equal(first.preflight.securityStatus,200);assert.equal(first.preflight.workspaceStatus,200);
  assert.equal(exported.attempts[1].preflight.sessionRole,'customer');assert.equal(exported.attempts[1].preflight.workspaceStatus,null);
  assert.equal(exported.attempts[1].renewal,undefined);
  for(const name of await fs.readdir(data.output)){const text=await fs.readFile(path.join(data.output,name),'utf8');assert(!text.includes(SECRET));assert(!text.includes(TOKEN));}
});
test('failed incomplete or inconsistent renewal proof cannot accompany a completed attempt',async()=>{
  for(const mutation of [
    row=>row.renewal.success=false,row=>row.renewal.reason=SECRET,row=>delete row.renewal.finishedAt,
    row=>row.renewal.startedAt=TOKEN,row=>row.renewal.finishedAt='2026-10-19T23:59:59.000Z',
    row=>row.renewal.previousExpiresAt='2026-10-19T23:59:59.000Z',
    row=>row.renewal.expiresAt='2026-10-21T01:00:00.000Z',row=>row.renewal=null,
  ]){
    const data=await fixture(1,{detailed:false});data.results[0].renewal=plannedRenewal();mutation(data.results[0]);
    await write(data.run,data.jobs[0].id+'.attempt-1.result.json',data.results[0]);
    await rejectCode(exportPrivateEvidence({...data,vocabulary}),'COMPLETED_PRIVATE_AUDIT_WITH_INVALID_RENEWAL_PROOF');await assert.rejects(fs.access(data.output));
  }
});
test('partial pre-navigation failures and unsuccessful renewals retain safe evidence without becoming success',async()=>{
  const data=await fixture(3,{detailed:false}),known=[...vocabulary.errorCodes].find(code=>code.startsWith('AUDIT_PRE_'));assert.ok(known);
  const failed=data.jobs.map(entry=>({...result(entry,1,'error'),errorCode:known}));
  for(const row of failed){row.checks.preSessionRoleVerified=false;row.checks.preStaffMfaVerified=false;row.checks.preSessionFreshnessVerified=false;}
  failed[0].preflight={sessionRole:null,httpStatus:401,workspaceStatus:null,securityStatus:null,expiresAt:null,observedAt:'2026-10-20T00:00:00.500Z',responseBody:SECRET,headers:{Cookie:TOKEN}};
  delete failed[1].preflight;failed[1].renewal={...plannedRenewal(),success:false,cookie:TOKEN};delete failed[1].renewal.finishedAt;delete failed[1].renewal.expiresAt;
  failed[2].preflight={sessionRole:SECRET,httpStatus:999,workspaceStatus:TOKEN,securityStatus:0,expiresAt:SECRET,observedAt:TOKEN};
  failed[2].renewal={reason:SECRET,startedAt:TOKEN,success:false,password:SECRET};
  for(const row of failed)await write(data.run,row.id+'.attempt-1.result.json',row);
  data.summary={...data.summary,completed:0,errors:3,records:failed,attempts:failed.map(row=>({id:row.id,attempt:1,status:'error',result:row.id+'.attempt-1.result.json'}))};await write(data.run,'summary.json',data.summary);
  await exportPrivateEvidence({...data,vocabulary});const exported=await compactAttempts(data.output);assert.equal(exported.summary.completed,0);assert.equal(exported.summary.errors,3);
  assert.equal(exported.attempts[0].preflight.httpStatus,401);assert.equal(exported.attempts[0].preflight.sessionRole,null);
  assert.equal(exported.attempts[1].preflight,undefined);assert.equal(exported.attempts[1].renewal.success,false);assert.equal(exported.attempts[1].renewal.finishedAt,undefined);
  assert.equal(exported.attempts[2].preflight.httpStatus,null);assert.equal(exported.attempts[2].preflight.observedAt,null);assert.equal(exported.attempts[2].renewal.reason,undefined);
  for(const row of exported.attempts){assert.equal(row.runnerError.code,known);assert.equal(row.checks.preSessionFreshnessVerified,false);}
  for(const name of await fs.readdir(data.output)){const text=await fs.readFile(path.join(data.output,name),'utf8');assert(!text.includes(SECRET));assert(!text.includes(TOKEN));}
});
test('code-only runner failures retain known codes without exposing arbitrary error values',async()=>{
  const data=await fixture(3,{detailed:false}),codes=['AUDIT_PROTECTED_PAGE_CHECK_FAILED','AUDIT_LOGIN_429',SECRET];
  const failed=data.jobs.map((entry,index)=>({...result(entry,1,'error'),errorCode:codes[index],apiFailureCount:1,pageErrorCount:2}));
  for(const row of failed)await write(data.run,row.id+'.attempt-1.result.json',row);
  data.summary={...data.summary,completed:0,errors:3,records:failed,attempts:failed.map(row=>({id:row.id,attempt:1,status:'error',result:row.id+'.attempt-1.result.json'}))};await write(data.run,'summary.json',data.summary);
  await exportPrivateEvidence({...data,vocabulary});const exported=await compactAttempts(data.output);
  assert.deepEqual(exported.attempts.map(row=>row.runnerError.code),[codes[0],codes[1],'UNCLASSIFIED']);
  for(const row of exported.attempts){assert.equal(row.apiFailureCount,1);assert.equal(row.pageErrorCount,2);assert.equal(row.runnerError.textOmitted,true);}
  const text=await fs.readFile(path.join(data.output,'summary.csv'),'utf8');assert(text.includes('AUDIT_PROTECTED_PAGE_CHECK_FAILED'));assert(!text.includes(SECRET));
});
test('a result from another role cannot be relabelled as its inventoried job',async()=>{
  const data=await fixture(1,{detailed:false});data.results[0].role='customer';await write(data.run,data.jobs[0].id+'.attempt-1.result.json',data.results[0]);await rejectCode(exportPrivateEvidence({...data,vocabulary}),'PRIVATE_ATTEMPT_JOB_MISMATCH');await assert.rejects(fs.access(data.output));
});
test('a completed summary cannot conceal a raw Lighthouse runtime failure',async()=>{
  const data=await fixture(1,{detailed:false}),raw=report(false);raw.runtimeError={code:'NO_FCP',message:SECRET};await write(data.run,data.results[0].report,raw);await rejectCode(exportPrivateEvidence({...data,vocabulary}),'COMPLETED_REPORT_HAS_RUNTIME_ERROR');await assert.rejects(fs.access(data.output));
});
test('public runs, foreign origins and unregistered private paths fail closed',async()=>{
  for(const[mutation,code]of [[data=>data.manifest.scope='all-public','AUTHENTICATED_RUN_REQUIRED'],[data=>data.jobs[0].url='https://external.invalid/en/admin/','PRIVATE_JOB_ORIGIN_MISMATCH'],[data=>data.jobs[0].url=BASE+'/en/admin/'+SECRET+'/','UNREGISTERED_PRIVATE_ROUTE']]){
    const data=await fixture(1,{detailed:false});mutation(data);await write(data.run,'manifest.json',data.manifest);await write(data.run,'inventory.json',{jobs:data.jobs});await rejectCode(exportPrivateEvidence({...data,vocabulary}),code);await assert.rejects(fs.access(data.output));
  }
});
test('unsafe report references and symlinks cannot read other private files',async()=>{
  const traversal=await fixture(1,{detailed:false});traversal.results[0].report='../outside.json';await write(traversal.run,traversal.jobs[0].id+'.attempt-1.result.json',traversal.results[0]);await rejectCode(exportPrivateEvidence({...traversal,vocabulary}),'UNSAFE_REPORT_REFERENCE');
  const linked=await fixture(1,{detailed:false}),target=path.join(linked.directory,'private.json'),filename=path.join(linked.run,linked.results[0].report);await fs.writeFile(target,SECRET);await fs.unlink(filename);await fs.symlink(target,filename);await rejectCode(exportPrivateEvidence({...linked,vocabulary}),'ELOOP');assert.equal(await fs.readFile(target,'utf8'),SECRET);await assert.rejects(fs.access(linked.output));
});
test('summary count drift, omitted latest results and duplicate attempts are rejected',async()=>{
  for(const[mutation,code]of [[data=>data.summary.completed++,'SUMMARY_COUNTER_MISMATCH'],[data=>data.summary.records=[],'SUMMARY_COVERAGE_MISMATCH'],[data=>data.summary.attempts.push(data.summary.attempts[0]),'UNSAFE_OR_DUPLICATE_RESULT_REFERENCE']]){
    const data=await fixture(1,{detailed:false});mutation(data);await write(data.run,'summary.json',data.summary);await rejectCode(exportPrivateEvidence({...data,vocabulary}),code);await assert.rejects(fs.access(data.output));
  }
});
test('existing destinations and unsafe size requests are refused without overwriting',async()=>{
  const data=await fixture(1,{detailed:false});await fs.mkdir(data.output);await fs.writeFile(path.join(data.output,'keep.txt'),'keep');await rejectCode(exportPrivateEvidence({...data,vocabulary}),'OUTPUT_ALREADY_EXISTS');assert.equal(await fs.readFile(path.join(data.output,'keep.txt'),'utf8'),'keep');
  const oversized=await fixture(1,{detailed:false});await rejectCode(exportPrivateEvidence({...oversized,vocabulary,maximumPartBytes:MAXIMUM_PART_BYTES+1}),'INVALID_PART_BOUND');await assert.rejects(fs.access(oversized.output));
  const tooSmall=await fixture(1,{detailed:false});await rejectCode(exportPrivateEvidence({...tooSmall,vocabulary,maximumPartBytes:1024}),'SINGLE_ATTEMPT_EXCEEDS_PART_BOUND');await assert.rejects(fs.access(tooSmall.output));
});
test('deep private details are bounded and arbitrary object keys are never retained',()=>{
  let details={type:'node',selector:'div#'+SECRET,nodeLabel:SECRET};for(let i=0;i<20;i++)details={items:[details]};
  const audit=sanitizeAudit('color-contrast',{score:0,scoreDisplayMode:'binary',details},vocabulary),serialized=JSON.stringify(audit);assert(serialized.includes('detail-bound'));assert(!serialized.includes(SECRET));
  const poisoned=JSON.parse('{"score":0,"scoreDisplayMode":"binary","details":{"__proto__":{"polluted":true},"constructor":{"password":"'+SECRET+'"}}}');const cleaned=JSON.stringify(sanitizeAudit('color-contrast',poisoned,vocabulary));assert(!cleaned.includes(SECRET));assert(!cleaned.includes('polluted'));assert.equal(Object.prototype.polluted,undefined);
});
