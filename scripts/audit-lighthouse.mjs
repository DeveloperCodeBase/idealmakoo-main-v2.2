import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {getChromePath} from 'chrome-launcher';
import {reserveAuditAttempt} from './lib/lighthouse-attempts.mjs';
import {buildPublicAuditInventory,publicAuditUrl} from './lib/public-audit-inventory.mjs';
import {auditBrowserConfiguration} from './lib/audit-browser-flags.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const executeFile=promisify(execFile);
const help=`Usage: npm run audit:lighthouse -- --base-url https://example.com --all-public --device mobile --output reports/lighthouse

Options:
  --base-url URL        Required application origin, without a path or credentials.
  --output DIRECTORY   Required report directory; an identical run resumes automatically.
  --device MODE        mobile (default), desktop, or both.
  --all-public         Sitemap + every public source route in all five languages.
  --urls FILE          Explicit JSON array of same-origin URLs for representative runs.
  --inventory-only     Save manifest/inventory without running Chrome.
  --limit N            Run at most N pending audits during this invocation; coverage remains incomplete.
  --deadline-seconds N Total deadline per URL, default 300 (60–900).
  --retry-errors       Keep prior attempts and retry their explicit errors.
  --chrome PATH        Chrome/Chromium executable; CHROME_PATH is also supported.
  --allow-root-chrome  Add --no-sandbox for an isolated root-owned test container.
  --no-swiftshader    Do not enable Chrome's software WebGL fallback.
  --swiftshader-driver Use ANGLE SwiftShader as the explicit GL driver instead;
                       mutually exclusive with --no-swiftshader.
  --no-full-page-screenshot Skip only the optional full-page report image;
                       trace screenshots, metrics and all scored audits remain.
  --help               Show this help.

Default Chrome runs are sequential, with fresh browser profiles and Lighthouse's
simulated mobile/desktop presets. Animations, images and 3D scenes remain enabled.
The script stops when BUILD_ID, served static assets, public content or inventory
changes. Use a new output directory after a deployment. No authenticated dashboard
is claimed to pass through an anonymous login page. Public auth pages and expected
404 pages are labelled separately. Expected 404 navigation errors are preserved.
`;
const flags=new Set(['all-public','inventory-only','retry-errors','allow-root-chrome','no-swiftshader','swiftshader-driver','no-full-page-screenshot','help']),options={};
for(let index=2;index<process.argv.length;index++){
 const name=process.argv[index];if(!name.startsWith('--'))throw new Error(`Unexpected argument ${name}`);
 const key=name.slice(2);if(flags.has(key))options[key]=true;else{const value=process.argv[++index];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${name}`);options[key]=value;}
}
if(options.help){console.log(help);process.exit(0);}
const accepted=new Set([...flags,'base-url','output','device','urls','limit','deadline-seconds','chrome']);
for(const key of Object.keys(options))if(!accepted.has(key))throw new Error(`Unknown option --${key}`);
if(!options['base-url']||!options.output)throw new Error(help);
const base=new URL(options['base-url']);
if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('--base-url must be an HTTP(S) origin without credentials or a path.');
const baseUrl=base.origin,output=path.resolve(options.output),mode=options.device||'mobile';
if(!['mobile','desktop','both'].includes(mode))throw new Error('Invalid device.');
if(options.urls&&options['all-public'])throw new Error('Choose --urls or --all-public.');
const deadlineSeconds=Number(options['deadline-seconds']||300),limit=options.limit?Number(options.limit):Infinity;
if(!Number.isInteger(deadlineSeconds)||deadlineSeconds<60||deadlineSeconds>900)throw new Error('Deadline must be an integer from60 to900 seconds.');
if(limit!==Infinity&&(!Number.isInteger(limit)||limit<1))throw new Error('Limit must be a positive integer.');
const devices=mode==='both'?['mobile','desktop']:[mode],categories=['performance','accessibility','best-practices','seo'];
const {chromeFlags,graphicsMode}=auditBrowserConfiguration(options);
const disableFullPageScreenshot=!!options['no-full-page-screenshot'];
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const readJson=async file=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
async function atomic(file,value){const temporary=file+`.${process.pid}.tmp`;await fs.writeFile(temporary,typeof value==='string'?value:JSON.stringify(value,null,2));await fs.rename(temporary,file);}
async function request(url){const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(45000)});if(!response.ok)throw new Error(`Inventory request failed: HTTP ${response.status} ${new URL(url).pathname}`);return response;}
const decode=value=>value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&apos;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
async function sitemapUrls(){
 const pending=[baseUrl+'/sitemap.xml'],seen=new Set(),urls=[];
 while(pending.length){const url=pending.shift();if(seen.has(url))continue;if(seen.size>=100)throw new Error('Sitemap index exceeds the audit safety bound of100 files.');seen.add(url);
  const xml=await (await request(url)).text(),locations=[...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(match=>decode(match[1].trim()));
  for(const location of locations){const source=new URL(location,baseUrl),target=new URL(source.pathname+source.search,baseUrl).href;if(/<sitemapindex(?:\s|>)/.test(xml))pending.push(target);else urls.push(target);}
 }
 if(!urls.length)throw new Error('The sitemap did not contain public URLs.');return [...new Set(urls)];
}
async function publicIdentity(){
 const [document,snapshotResponse]=await Promise.all([request(baseUrl+'/fa/'),request(baseUrl+'/api/v1/site')]);
 const html=await document.text(),snapshot=await snapshotResponse.json();
 if(!Array.isArray(snapshot.publications)||!Array.isArray(snapshot.forms))throw new Error('Invalid public site snapshot.');
 const staticAssets=[...new Set([...html.matchAll(/(?:src|href)="([^"<>]*\/_next\/static\/[^"<>]+)"/g)].map(match=>decode(match[1])))].sort();
 if(!staticAssets.length)throw new Error('No built Next.js static assets were found in the served home page.');
 const {observedAt,version,...publicContent}=snapshot;
 const buildId=(await fs.readFile(path.join(root,'.next/BUILD_ID'),'utf8').catch(()=>process.env.AUDIT_BUILD_ID||'')).trim();
 if(!buildId)throw new Error('A .next/BUILD_ID or explicit AUDIT_BUILD_ID is required to identify the deployed build.');
 return{buildId,servedAssetsHash:hash(staticAssets),staticAssets,publicContentHash:hash(publicContent)};
}
async function inventory(){
 if(!options.urls){const [urls,snapshot]=await Promise.all([sitemapUrls(),request(baseUrl+'/api/v1/site').then(response=>response.json())]);return buildPublicAuditInventory({baseUrl,site:snapshot,sitemapUrls:urls,devices});}
 const entries=new Map(),excluded=[];
 const add=(value,kind,indexed=false,expectedStatus=200)=>{const url=publicAuditUrl(value,baseUrl),current=entries.get(url);entries.set(url,{url,kind:current?.kind||kind,indexed:current?.indexed||indexed,expectedStatus});};
 const input=await readJson(path.resolve(options.urls)),values=Array.isArray(input)?input:input?.urls;if(!Array.isArray(values)||!values.length)throw new Error('The URLs file must contain a nonempty array.');for(const value of values){if(typeof value==='string')add(value,'representative');else add(value.url,value.kind||'representative',value.indexed===true,value.expectedStatus||200);}
 const jobs=[...entries.values()].sort((a,b)=>a.url.localeCompare(b.url,'en')).flatMap(entry=>devices.map(device=>({...entry,device})));
 return{jobs,excluded,sourceUrls:entries.size};
}
await fs.mkdir(output,{recursive:true});
const lockPath=path.join(output,'audit.lock');let lock;
try{lock=await fs.open(lockPath,'wx',0o600);}catch(error){
 if(error.code!=='EEXIST')throw error;const previous=await readJson(lockPath);let alive=false;try{process.kill(previous?.pid,0);alive=true;}catch(reason){if(reason.code!=='ESRCH')throw new Error('Cannot safely determine ownership of the audit lock.');}
 if(alive)throw new Error(`Audit directory is in use by PID ${previous.pid}; do not run simultaneous scoring sessions.`);
 await fs.unlink(lockPath);lock=await fs.open(lockPath,'wx',0o600);
}
await lock.writeFile(JSON.stringify({pid:process.pid,host:os.hostname(),startedAt:new Date().toISOString()}));
let active=null,interrupted=false;
const interrupt=()=>{interrupted=true;active?.terminate();};
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
try{
 const [identity,list]=await Promise.all([publicIdentity(),inventory()]);
 const chromePath=options.chrome||process.env.CHROME_PATH||getChromePath();
 const chromeVersion=(await executeFile(chromePath,['--version'],{timeout:10000,maxBuffer:16384})).stdout.trim();
 const config={schemaVersion:3,baseUrl,devices,categories,chromeFlags,graphicsMode,chromePath,chromeVersion,deadlineSeconds,maxWaitForLoad:45000,disableFullPageScreenshot,lighthouseVersion:require('lighthouse/package.json').version,chromeLauncherVersion:require('chrome-launcher/package.json').version,applicationVersion:require('../package.json').version,...identity,inventoryHash:hash({jobs:list.jobs,redirects:list.redirects||[]})};
 const configurationHash=hash(config),manifestPath=path.join(output,'manifest.json'),previous=await readJson(manifestPath);
 if(previous&&previous.configurationHash!==configurationHash)throw new Error('Cannot resume: deployed build, public content, inventory, browser or audit configuration changed. Keep this evidence and choose a new output directory.');
 const manifest=previous||{createdAt:new Date().toISOString(),configurationHash,config,expected:list.jobs.length,sourceUrls:list.sourceUrls,scope:options.urls?'representative':'all-public',host:{platform:os.platform(),release:os.release(),architecture:os.arch(),node:process.version,cpu:os.cpus()[0]?.model,availableCpus:os.availableParallelism(),memoryBytes:os.totalmem(),cpuQuota:await fs.readFile('/sys/fs/cgroup/cpu.max','utf8').then(value=>value.trim()).catch(()=>null),memoryLimit:await fs.readFile('/sys/fs/cgroup/memory.max','utf8').then(value=>value.trim()).catch(()=>null)}};
 await atomic(manifestPath,manifest);await atomic(path.join(output,'inventory.json'),list);
 const results=[];for(const file of await fs.readdir(output))if(/^[a-f0-9]{16}\.attempt-\d+\.result\.json$/.test(file)){const result=await readJson(path.join(output,file));if(result)results.push(result);}
 const idFor=job=>hash(job.url+'|'+job.device).slice(0,16);
 const latest=()=>new Map(results.sort((a,b)=>a.attempt-b.attempt).map(result=>[result.id,result]));
 async function summarize(){
  const current=latest(),records=list.jobs.flatMap(job=>{const result=current.get(idFor(job));return result?[result]:[];}),pending=list.jobs.length-records.length;
  const summary={manifest:'manifest.json',updatedAt:new Date().toISOString(),expected:list.jobs.length,attempted:records.length,completed:records.filter(record=>record.status==='completed').length,expectedHttpResponses:records.filter(record=>record.status==='expected-http-response').length,errors:records.filter(record=>record.status==='error').length,timeouts:records.filter(record=>record.status==='timeout').length,pending,coverageComplete:pending===0,interrupted,records,attempts:results.map(result=>({id:result.id,attempt:result.attempt,status:result.status,result:result.resultFile||`${result.id}.attempt-${result.attempt}.result.json`}))};
  await atomic(path.join(output,'summary.json'),summary);
  const columns=['url','device','kind','indexed','expectedStatus','httpStatus','status','performance','accessibility','best-practices','seo','largest-contentful-paint','total-blocking-time','cumulative-layout-shift','durationMs','error'];
  const cell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  await atomic(path.join(output,'summary.csv'),[columns,...records.map(record=>columns.map(key=>record[key]??record.scores?.[key]??record.metrics?.[key]))].map(row=>row.map(cell).join(',')).join('\n')+'\n');
  return summary;
 }
 await summarize();
 console.log(JSON.stringify({event:'inventory',scope:manifest.scope,sourceUrls:list.sourceUrls,expected:list.jobs.length,buildId:identity.buildId,resume:!!previous,output}));
 if(!options['inventory-only']){
  let count=0;for(const job of list.jobs){
   if(interrupted||count>=limit)break;const id=idFor(job),last=latest().get(id);if(last&&(['completed','expected-http-response'].includes(last.status)||!options['retry-errors']))continue;
   // Read only between browser audits; this never consumes CPU during scoring.
   if(count%5===0){const current=await publicIdentity();if(hash(current)!==hash(identity))throw new Error('The deployed build or public content changed during the sweep. Reports are retained; use a new directory for the new release.');}
   const {attempt,prefix}=await reserveAuditAttempt(output,id),resultFile=prefix+'.result.json';
   const profile=await fs.mkdtemp(path.join(os.tmpdir(),'idealmakoo-lighthouse-'));
   const input={job,id,attempt,chromePath,chromeFlags,categories,maxWaitForLoad:45000,disableFullPageScreenshot,profile,reportFile:prefix+'.lhr.json',resultFile,chromeLog:prefix+'.chrome.log'};
   const inputFile=prefix+'.input.json';await fs.writeFile(inputFile,JSON.stringify(input,null,2),{flag:'wx',mode:0o600});const log=await fs.open(prefix+'.runner.log','wx',0o600),started=Date.now();let timedOut=false;
   const child=spawn(process.execPath,[fileURLToPath(new URL('./lighthouse-child.mjs',import.meta.url)),inputFile],{cwd:root,stdio:['ignore',log.fd,log.fd],detached:true,env:process.env});
   const signalChild=signal=>{try{process.kill(-child.pid,signal);}catch{child.kill(signal);}};
   let hardKill;const terminate=()=>{signalChild('SIGTERM');hardKill ||= setTimeout(()=>signalChild('SIGKILL'),5000);};
   active={terminate};const timer=setTimeout(()=>{timedOut=true;terminate();},deadlineSeconds*1000);
   // Parent signals request graceful owned-browser disposal; a second bound
   // handles a browser that cannot respond during a blocked protocol command.
   let exit;try{exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});}finally{
    clearTimeout(timer);clearTimeout(hardKill);active=null;await log.close();
    // chrome-launcher gives Chrome its own process group. If a worker was hard
    // stopped, kill only the Chrome whose command line proves this owned profile.
    const browserPid=Number(await fs.readFile(path.join(profile,'chrome.pid'),'utf8').catch(()=>''));
    if(Number.isInteger(browserPid)&&browserPid>1&&process.platform==='linux'){
     const command=await fs.readFile(`/proc/${browserPid}/cmdline`,'utf8').catch(()=>'');
     if(command.split('\0').includes(`--user-data-dir=${profile}`))try{process.kill(-browserPid,'SIGKILL');}catch{}
    }
    const chromeLog=await fs.readFile(path.join(profile,'chrome-err.log'),'utf8').catch(()=>null);if(chromeLog)await fs.writeFile(input.chromeLog,chromeLog);
    await fs.rm(profile,{recursive:true,force:true}).catch(()=>{});
   }
   const stored=await readJson(resultFile);let record=stored;
   if(!record||timedOut||interrupted){const partialReport=stored?.report||await fs.access(input.reportFile).then(()=>path.basename(input.reportFile)).catch(()=>undefined);record={...job,id,attempt,startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),durationMs:Date.now()-started,status:timedOut?'timeout':'error',scores:{},metrics:{},error:timedOut?`Total audit deadline exceeded (${deadlineSeconds}s).`:interrupted?'Audit interrupted; this attempt is retained.':`Audit process exited without a report: ${JSON.stringify(exit)}`,partialReport};await atomic(resultFile,record);}
   record.resultFile=path.basename(resultFile);results.push(record);count++;const state=await summarize();
   console.log(JSON.stringify({event:'audit',url:job.url,device:job.device,kind:job.kind,status:record.status,durationMs:record.durationMs,scores:record.scores,metrics:record.metrics,runtimeError:record.runtimeError,error:record.error,attempted:state.attempted,expected:state.expected,pending:state.pending}));
  }
 }
 const summary=await summarize();console.log(JSON.stringify({event:'summary',output,coverageComplete:summary.coverageComplete,expected:summary.expected,completed:summary.completed,expectedHttpResponses:summary.expectedHttpResponses,errors:summary.errors,timeouts:summary.timeouts,pending:summary.pending}));
 if(!options['inventory-only']&&(summary.pending||summary.errors||summary.timeouts))process.exitCode=2;
}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);await lock.close();await fs.unlink(lockPath).catch(()=>{});}
