import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sitePaths} from '../src/lib/routes.ts';
import {authorize} from '../src/lib/auth.ts';
import {auditDatabase,prepareFixtureActors,closeFixtureActors,ensureOwnedAuditRequest,privateWorkloadIdentity} from './lib/private-audit-runtime.mjs';
import {privateAuditJobs,privateAuditTargetPath,auditHash,auditRoles} from './lib/private-audit-policy.mjs';
import {reserveAuditAttempt} from './lib/lighthouse-attempts.mjs';
import {auditBrowserConfiguration} from './lib/audit-browser-flags.mjs';
import {PRIVATE_EDITOR_CLEANUP_POLICY} from './lib/private-audit-editor-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),executeFile=promisify(execFile);
const help=`Usage: LIGHTHOUSE_DISPOSABLE_AUTH_AUDIT=true node --env-file=/absolute/disposable-test.env --import tsx scripts/audit-private-lighthouse.mjs --base-url http://127.0.0.1:3080 --output /private/scratch/audit --chrome /path/to/chrome

This separate tool requires explicit matching TEST_DATABASE_URL/DATABASE_URL,
a named loopback disposable test database, production server mode, matching
SITE_URL, authentication keys and disabled external notification providers.
It creates owned test actors and one real customer request. It never resets
rate limits or exports cookies, passwords, MFA seeds or Authorization headers.
Raw private reports stay in a mode0700 scratch directory; use the separate
strict private exporter for deliverable evidence.

Options: --pilot (3 pages), --representative (24 pages, two per role),
 --device mobile|desktop, --limit N,
 --target-path /ar/admin/users/ (one exact registered principal-role page only),
 --prepare-fixtures-only (prepare owned actors/request without freezing manifests),
 --inventory-only (verify prepared fixtures and freeze inventory without scoring),
 --retry-errors, --deadline-seconds 60..900 (default300), --allow-root-chrome,
 --swiftshader-driver (explicit CPU software driver through ANGLE; not a physical GPU),
 --no-full-page-screenshot (omit only the report image, retain trace/screenshots and all audits).
By default every registered protected route is measured in all five languages with its
principal role, plus five owned details and20 other-role representatives.
The explicit --representative scope measures two pages per role in Persian and
English, including one owned customer detail; it does not claim full coverage.
Lighthouse keeps real navigation, design/effects, private noindex and role
authorization. The browser profile persists only for one role; content caches
are cleared before each measured URL. Resume requires identical build/workload.
`;
const flagKeys=new Set(['pilot','representative','prepare-fixtures-only','inventory-only','retry-errors','allow-root-chrome','swiftshader-driver','no-full-page-screenshot','help']),options={};
for(let index=2;index<process.argv.length;index++){const option=process.argv[index];if(!option.startsWith('--'))throw new Error('Expected a named audit option.');const key=option.slice(2);if(flagKeys.has(key))options[key]=true;else{const value=process.argv[++index];if(!value||value.startsWith('--'))throw new Error('Missing audit option value.');options[key]=value;}}
if(options.help){console.log(help);process.exit(0);}
for(const key of Object.keys(options))if(!new Set([...flagKeys,'base-url','output','chrome','device','deadline-seconds','limit','target-path']).has(key))throw new Error('Unknown private audit option.');
if(!options['base-url']||!options.output||!(options.chrome||process.env.CHROME_PATH))throw new Error(help);
if(options['prepare-fixtures-only']&&(options['inventory-only']||options['retry-errors']||options.limit))throw new Error('Fixture-only preparation cannot be combined with inventory/scoring options.');
const targetPath=privateAuditTargetPath(sitePaths,options['target-path']);
if(targetPath!==undefined&&(options.pilot||options.limit))throw new Error('A private target selector cannot be combined with pilot/limit.');
if(options.representative&&(options.pilot||targetPath!==undefined))throw new Error('The representative private scope cannot be combined with pilot/target.');
const output=path.resolve(options.output),device=options.device||'mobile',deadlineSeconds=Number(options['deadline-seconds']||300),limit=options.limit?Number(options.limit):Infinity,chromePath=options.chrome||process.env.CHROME_PATH;
const disableFullPageScreenshot=!!options['no-full-page-screenshot'];
if(!['mobile','desktop'].includes(device)||!Number.isInteger(deadlineSeconds)||deadlineSeconds<60||deadlineSeconds>900||limit!==Infinity&&(!Number.isInteger(limit)||limit<1))throw new Error('Invalid private audit device/deadline/limit.');
const {pool,context}=await auditDatabase(process.env,options['base-url']);
const readJson=async file=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const atomic=async(file,value)=>{const temporary=file+`.${process.pid}.tmp`;await fs.writeFile(temporary,typeof value==='string'?value:JSON.stringify(value,null,2),{mode:0o600});await fs.rename(temporary,file);};
await fs.mkdir(output,{recursive:true,mode:0o700});await fs.chmod(output,0o700);
const lockPath=path.join(output,'audit.lock');let lock;
try{lock=await fs.open(lockPath,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;const stale=await readJson(lockPath);if(!Number.isSafeInteger(stale?.pid)||stale.pid<2)throw new Error('Private audit lock ownership is invalid.');let alive=false;try{process.kill(stale.pid,0);alive=true;}catch(reason){if(reason.code!=='ESRCH')throw new Error('Cannot verify private audit lock ownership.');}if(alive)throw new Error('Private audit directory already has an active supervisor.');await fs.unlink(lockPath);lock=await fs.open(lockPath,'wx',0o600);}
await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
let run,roles=[],interrupted=false,active;const interrupt=()=>{interrupted=true;active?.terminate();};process.once('SIGTERM',interrupt);process.once('SIGINT',interrupt);
try{auditRun:{
 if(options['prepare-fixtures-only']&&await readJson(path.join(output,'manifest.json')))throw new Error('Prepare all device fixtures before any private manifest is frozen.');
 const runPath=path.join(output,'run-context.json');run=await readJson(runPath);
 if(run&&(run.databaseIdentity!==context.databaseIdentity||run.baseUrl!==context.baseUrl||run.pilot!==!!options.pilot||!!run.representative!==!!options.representative||run.targetPath!==targetPath))throw new Error('This private audit directory belongs to another disposable database/origin/scope.');
 run||={runId:randomUUID(),createdAt:new Date().toISOString(),databaseIdentity:context.databaseIdentity,baseUrl:context.baseUrl,pilot:!!options.pilot,representative:!!options.representative,...targetPath!==undefined?{targetPath}:{}};await atomic(runPath,run);
 roles=options.pilot?['superAdmin','customer']:auditRoles;
 await prepareFixtureActors(pool,run.runId,roles,process.env.MFA_ENCRYPTION_KEY);
 const requestId=await ensureOwnedAuditRequest(pool,run,context.baseUrl,process.env.MFA_ENCRYPTION_KEY);
 if(options['prepare-fixtures-only']){
  const receipt={event:'fixtures-prepared',preparedAt:new Date().toISOString(),runContextHash:auditHash(run),roleCount:roles.length,ownedRequestPrepared:true,manifestFrozen:false};
  const file=`fixture-preparation.${randomUUID()}.json`;await fs.writeFile(path.join(output,file),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({...receipt,receipt:file}));break auditRun;
 }
 const jobs=privateAuditJobs(sitePaths,context.baseUrl,requestId,{pilot:!!options.pilot,representative:!!options.representative,device,authorize,targetPath});
 const buildId=(await fs.readFile(path.join(root,'.next/BUILD_ID'),'utf8')).trim();if(!buildId)throw new Error('A completed production build is required.');
 const chromeVersion=(await executeFile(chromePath,['--version'],{timeout:10000,maxBuffer:16384})).stdout.trim(),workload=await privateWorkloadIdentity(pool);
 const {chromeFlags,graphicsMode}=auditBrowserConfiguration(options);
 const teardownFingerprint=auditHash(await fs.readFile(new URL('./lib/private-audit-editor-cleanup.mjs',import.meta.url),'utf8'));
 const config={schemaVersion:2,teardownPolicy:PRIVATE_EDITOR_CLEANUP_POLICY,teardownFingerprint,...targetPath!==undefined?{targetPath}:{},baseUrl:context.baseUrl,buildId,applicationVersion:require('../package.json').version,lighthouseVersion:require('lighthouse/package.json').version,chromeVersion,chromeFlags,graphicsMode,chromePath,devices:[device],categories:['performance','accessibility','best-practices','seo'],deadlineSeconds,maxWaitForLoad:45000,disableFullPageScreenshot,inventoryHash:auditHash(jobs),workloadHash:workload.hash,databaseIdentity:context.databaseIdentity,profilePolicy:'one-owned-role-profile;cold-http-and-content-caches-per-url;real-authentication;no-storage-cookie-export',fixturePolicy:'owned-example.test-actors;production-locale-grants;translator-target-languages-only;principal-role-coverage;twenty-representative-other-role-views'};
 const configurationHash=auditHash(config),manifestPath=path.join(output,'manifest.json'),previous=await readJson(manifestPath);
 if(previous&&previous.configurationHash!==configurationHash)throw new Error('Private audit build, workload, browser or inventory changed. Preserve the old evidence and use a new directory.');
 const manifest=previous||{createdAt:new Date().toISOString(),configurationHash,config,expected:jobs.length,sourceUrls:jobs.length,scope:'authenticated',coverageScope:targetPath!==undefined?'selected-principal-role-route':options.pilot?'three-page-private-pilot':options.representative?'twenty-four-representative-pages-across-twelve-roles':'all-registered-principal-roles-plus-owned-details-and-representative-other-roles',host:{platform:os.platform(),node:process.version,cpu:os.cpus()[0]?.model,cpuQuota:await fs.readFile('/sys/fs/cgroup/cpu.max','utf8').then(value=>value.trim()).catch(()=>null),memoryLimit:await fs.readFile('/sys/fs/cgroup/memory.max','utf8').then(value=>value.trim()).catch(()=>null)}};
 await atomic(manifestPath,manifest);await atomic(path.join(output,'inventory.json'),{jobs,registeredPaths:sitePaths.filter(route=>/^(?:admin|account)(?:\/|$)/.test(route)),roleCoverage:targetPath!==undefined?'Only the selected registered page in its principal role is measured; this is not full private-route coverage.':options.representative?'Two representative pages per role in Persian and English, including one owned customer detail. This is not full private-route or all-language coverage.':'All registered routes use their principal role. The other ten staff roles have two explicitly representative views each; this is not every role-route combination.'});
 const results=[];const knownIds=new Set(jobs.map(job=>job.id));
 for(const file of await fs.readdir(output))if(/^[a-f0-9]{16}\.attempt-\d+\.result\.json$/.test(file)){const result=await readJson(path.join(output,file));if(!knownIds.has(result?.id))throw new Error('Result identity does not belong to this frozen private inventory.');results.push(result);}
 const latest=()=>new Map(results.slice().sort((a,b)=>a.attempt-b.attempt).map(result=>[result.id,result]));
 async function summarize(){
  const current=latest(),records=jobs.flatMap(job=>current.has(job.id)?[current.get(job.id)]:[]),pending=jobs.length-records.length;
  const summary={manifest:'manifest.json',updatedAt:new Date().toISOString(),scope:'authenticated',expected:jobs.length,attempted:records.length,completed:records.filter(record=>record.status==='completed').length,errors:records.filter(record=>record.status==='error').length,timeouts:records.filter(record=>record.status==='timeout').length,pending,coverageComplete:pending===0,interrupted,records,attempts:results.map(result=>({id:result.id,attempt:result.attempt,status:result.status,result:`${result.id}.attempt-${result.attempt}.result.json`}))};
  await atomic(path.join(output,'summary.json'),summary);
  const fields=['id','route','locale','role','device','kind','status','performance','accessibility','best-practices','seo','largest-contentful-paint','total-blocking-time','cumulative-layout-shift','durationMs','authVerified','errorCode'];
  const cell=value=>'"'+String(value??'').replaceAll('"','""')+'"';await atomic(path.join(output,'summary.csv'),[fields,...records.map(record=>fields.map(field=>record[field]??record.scores?.[field]??record.metrics?.[field]))].map(row=>row.map(cell).join(',')).join('\n')+'\n');return summary;
 }
 await summarize();console.log(JSON.stringify({event:'inventory',scope:'authenticated',expected:jobs.length,buildId,output,resume:!!previous}));
 let attemptedNow=0;
 if(!options['inventory-only'])for(const role of roles){
  if(interrupted||attemptedNow>=limit)break;
  const current=latest(),pending=jobs.filter(job=>job.role===role&&(!current.has(job.id)||options['retry-errors']&&current.get(job.id).status!=='completed')).slice(0,limit-attemptedNow);if(!pending.length)continue;
  const items=[];
  for(const job of pending){const {attempt,prefix}=await reserveAuditAttempt(output,job.id);items.push({job,attempt,prefix});}
  const roleRun=randomUUID().slice(0,8),profile=await fs.mkdtemp(path.join(os.tmpdir(),'idealmakoo-private-lighthouse-'));
  const input={output,role,teardownPolicy:PRIVATE_EDITOR_CLEANUP_POLICY,teardownFingerprint,runId:run.runId,requestId,baseUrl:context.baseUrl,profile,chromePath,chromeFlags,deadlineSeconds,disableFullPageScreenshot,buildId,buildFile:path.join(root,'.next/BUILD_ID'),workloadHash:workload.hash,jobs:items};
  const inputFile=path.join(output,`${role}.${roleRun}.input.json`);await fs.writeFile(inputFile,JSON.stringify(input,null,2),{flag:'wx',mode:0o600});const log=await fs.open(path.join(output,`${role}.${roleRun}.runner.log`),'wx',0o600);
  const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('./lighthouse-private-child.mjs',import.meta.url)),inputFile],{cwd:root,env:process.env,detached:true,stdio:['ignore',log.fd,log.fd,'ipc']});
  let activeItem=null,activeStartedAt=null,timedOut=false,timer,hardKill,fatalCode;
  const signal=kind=>{try{process.kill(-child.pid,kind);}catch{child.kill(kind);}};
  const terminate=()=>{signal('SIGTERM');hardKill||=setTimeout(()=>signal('SIGKILL'),5000);};active={terminate};
  const arm=milliseconds=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;terminate();},milliseconds);};arm(150000);
  child.on('message',message=>{
   if(message?.event==='ready'){arm(45000);console.log(JSON.stringify({event:'authenticated',role}));}
   if(message?.event==='start'){activeItem=items.find(item=>item.job.id===message.id&&item.attempt===message.attempt)||null;activeStartedAt=Date.now();arm(deadlineSeconds*1000);console.log(JSON.stringify({event:'audit-start',id:message.id,role,attempt:message.attempt}));}
   if(message?.event==='done'){arm(45000);activeItem=null;console.log(JSON.stringify({event:'audit',id:message.id,role,attempt:message.attempt,status:message.status,durationMs:message.durationMs,scores:message.scores}));}
   if(message?.event==='fatal'){fatalCode=message.errorCode;console.log(JSON.stringify({event:'role-error',role,errorCode:fatalCode}));}
  });
  // Keep summary/status current during a long role batch. Reads happen after a
  // child result is atomically saved, and contain no authentication material.
  let updating=Promise.resolve();const refresh=()=>{updating=updating.then(async()=>{for(const item of items){if(results.some(value=>value.id===item.job.id&&value.attempt===item.attempt))continue;const record=await readJson(item.prefix+'.result.json');if(record)results.push(record);}await summarize();}).catch(error=>{fatalCode='AUDIT_RESULT_PERSISTENCE_FAILED';terminate();});return updating;};
  child.on('message',message=>{if(message?.event==='done')void refresh().then(()=>{if(child.connected&&!fatalCode)child.send({event:'continue',id:message.id,attempt:message.attempt});});});
  let exit;try{exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});}finally{
   clearTimeout(timer);clearTimeout(hardKill);active=null;await log.close();
   const pid=Number(await fs.readFile(path.join(profile,'chrome.pid'),'utf8').catch(()=>''));if(Number.isSafeInteger(pid)&&pid>1&&process.platform==='linux'){const command=await fs.readFile(`/proc/${pid}/cmdline`,'utf8').catch(()=>'');if(command.split('\0').includes(`--user-data-dir=${profile}`))try{process.kill(-pid,'SIGKILL');}catch{}}
   await fs.rm(profile,{recursive:true,force:true}).catch(()=>{});
  }
  await updating;refresh();await updating;
  if(activeItem&&!results.some(value=>value.id===activeItem.job.id&&value.attempt===activeItem.attempt)){
   const partialReport=await fs.access(activeItem.prefix+'.lhr.json').then(()=>path.basename(activeItem.prefix+'.lhr.json')).catch(()=>undefined);
   const result={...activeItem.job,attempt:activeItem.attempt,status:timedOut?'timeout':'error',scores:{},metrics:{},authVerified:false,errorCode:timedOut?'AUDIT_DEADLINE_EXCEEDED':interrupted?'AUDIT_INTERRUPTED':'AUDIT_CHILD_EXIT',startedAt:new Date(activeStartedAt).toISOString(),durationMs:Date.now()-activeStartedAt,finishedAt:new Date().toISOString(),partialReport};await atomic(activeItem.prefix+'.result.json',result);results.push(result);
  }
  const completedItems=items.filter(item=>results.some(value=>value.id===item.job.id&&value.attempt===item.attempt));attemptedNow+=completedItems.length;
  await atomic(path.join(output,`${role}.${roleRun}.status.json`),{role,childPid:child.pid,finishedAt:new Date().toISOString(),exit,timedOut,interrupted,errorCode:fatalCode,expected:items.length,attempted:completedItems.length});await summarize();
  // An interrupted/auth-failed role retains pending targets for an explicit
  // resume. Never turn an anonymous fallback page into an authenticated pass.
  if(exit?.code!==0||fatalCode||timedOut){process.exitCode=2;if(!completedItems.length||fatalCode==='AUDIT_WORKLOAD_CHANGED'||fatalCode==='AUDIT_EDITOR_CLEANUP_FAILED')break;}
 }
 const summary=await summarize();console.log(JSON.stringify({event:'summary',output,expected:summary.expected,completed:summary.completed,errors:summary.errors,timeouts:summary.timeouts,pending:summary.pending,coverageComplete:summary.coverageComplete}));
 if(!options['inventory-only']&&(summary.pending||summary.errors||summary.timeouts))process.exitCode=2;
}}catch(error){console.error(JSON.stringify({event:'fatal',errorCode:'AUDIT_SUPERVISOR_FAILED',message:String(error.message||'Private audit supervisor failed.').replace(/(?:postgres(?:ql)?:\/\/)[^\s"']+/g,'[database URL omitted]')}));process.exitCode=2;}
finally{
 if(run)await closeFixtureActors(pool,run.runId,roles,process.env.MFA_ENCRYPTION_KEY).catch(()=>{process.exitCode=2;});
 process.removeListener('SIGTERM',interrupt);process.removeListener('SIGINT',interrupt);await pool.end();await lock.close();await fs.unlink(lockPath).catch(()=>{});
}
