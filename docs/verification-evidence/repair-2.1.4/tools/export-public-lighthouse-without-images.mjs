/**
 * Documentation-only public evidence utility. It does not run Lighthouse,
 * change the application, or publish a report. Use the matching released
 * project and its existing tsx dependency/public URL policy.
 *
 * This strips screenshot/image payloads, not arbitrary secrets. Only an
 * anonymous public run belongs here. Authenticated reports require the
 * separate strict scripts/export-private-lighthouse-evidence.mjs utility.
 * Original reports are read without modification; output must be new.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const usage='From the supplied project root: node --import tsx docs/verification-evidence/repair-2.1.4/tools/export-public-lighthouse-without-images.mjs --project . --run /absolute/raw-public-run --output /absolute/new-evidence-directory';
if(process.argv.length===3&&process.argv[2]==='--help'){console.log(usage);process.exit(0);}
const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i],value=process.argv[i+1];if(!['--project','--run','--output'].includes(key)||!value||value.startsWith('--')||options[key.slice(2)])throw new Error(usage);options[key.slice(2)]=value;}
if(!options.project||!options.run||!options.output)throw new Error(usage);
const input=path.resolve(options.run),output=path.resolve(options.output),sha=value=>createHash('sha256').update(value).digest('hex');
if(input===output||output.startsWith(input+path.sep)||input.startsWith(output+path.sep))throw new Error('Evidence directories must not overlap.');
try{await fs.access(path.join(input,'audit.lock'));throw new Error('The audit supervisor must be closed before export.');}catch(error){if(error.code!=='ENOENT')throw error;}
try{await fs.lstat(output);throw new Error('Output already exists; never overwrite prior evidence.');}catch(error){if(error.code!=='ENOENT')throw error;}
const names=['manifest.json','inventory.json','summary.json'];
const sourceBytes=Object.fromEntries(await Promise.all(names.map(async name=>[name,await fs.readFile(path.join(input,name))])));
const [manifest,inventory,summary]=names.map(name=>JSON.parse(sourceBytes[name]));
if(!['all-public','representative'].includes(manifest.scope)||summary.scope==='authenticated')throw new Error('Public anonymous runs only; private reports require the strict private exporter.');
const root=path.resolve(options.project);
const {publicAuditUrl}=await import(pathToFileURL(path.join(root,'scripts/lib/public-audit-inventory.mjs')).href);
const jobs=new Map(inventory.jobs.map(job=>{publicAuditUrl(job.url,manifest.config.baseUrl);return[sha(job.url+'|'+job.device).slice(0,16),job];}));
if(jobs.size!==inventory.jobs.length||summary.expected!==jobs.size||manifest.expected!==jobs.size)throw new Error('Public inventory identity/count mismatch.');
const imageAudits=new Set(['full-page-screenshot','screenshot-thumbnails','final-screenshot']);
const pointer=value=>String(value).replaceAll('~','~0').replaceAll('/','~1');
function sanitizeReport(report){
 const removed=[];
 function walk(value,parts=[]){
  if(typeof value==='string'){
   if(/data:image\//i.test(value)||/^[A-Za-z0-9+/]{1000,}={0,2}$/.test(value)){removed.push({path:'/'+parts.map(pointer).join('/'),reason:'inline-image-or-binary-payload'});return'[image or binary payload omitted]';}
   return value;
  }
  if(Array.isArray(value))return value.map((item,index)=>walk(item,[...parts,String(index)]));
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const [key,child] of Object.entries(value)){
   const next=[...parts,key],location='/'+next.map(pointer).join('/');
   const imageDetails=parts.length===2&&parts[0]==='audits'&&imageAudits.has(parts[1])&&key==='details';
   if(imageDetails||['fullPageScreenshot','screenshot','screenshots','screenshotData','imageData'].includes(key)){
    removed.push({path:location,reason:imageDetails?'screenshot-audit-payload':'screenshot-or-image-field'});continue;
   }
   result[key]=walk(child,next);
  }
  return result;
 }
 const sanitized=walk(report);
 // No scored result, numeric metric or nonimage audit may disappear. The only
 // content omission is the exact image fields/strings listed above.
 for(const [id,audit]of Object.entries(report.audits||{})){
  const after=sanitized.audits?.[id];if(!after)throw new Error('An audit outcome disappeared.');
  for(const field of ['score','scoreDisplayMode','numericValue','numericUnit','errorMessage'])if(JSON.stringify(after[field])!==JSON.stringify(audit[field]))throw new Error('A numeric or failure outcome changed during sanitization.');
 }
 if(JSON.stringify(sanitized.categories)!==JSON.stringify(report.categories)||JSON.stringify(sanitized.audits?.metrics)!==JSON.stringify(report.audits?.metrics))throw new Error('Scores, category references or metrics changed.');
 if(/data:image\/|"(?:screenshotData|imageData|fullPageScreenshot)"\s*:/i.test(JSON.stringify(sanitized)))throw new Error('Image payload survived export.');
 return{sanitized,removed};
}
// A public request can fail by navigating somewhere private. Check the actual
// document targets before retaining any nonimage report content or error text.
// Quarantine emits only public inventory identity, hashes and fixed reason codes.
function documentTargetReasons(value,job,source){
 const reasons=[];
 const check=(field,{required=false,bindRequest=false}={})=>{
  if(!Object.prototype.hasOwnProperty.call(value,field)){
   if(required)reasons.push(source+'_'+field.toUpperCase()+'_MISSING');return;
  }
  const target=value[field];
  if(typeof target!=='string'||!target||/[\u0000-\u0020\u007f]/.test(target)){
   reasons.push(source+'_'+field.toUpperCase()+'_INVALID');return;
  }
  let normalized;
  try{normalized=publicAuditUrl(target,manifest.config.baseUrl);}catch{
   reasons.push(source+'_'+field.toUpperCase()+'_NOT_PUBLIC');return;
  }
  if(bindRequest&&normalized!==job.url)reasons.push(source+'_'+field.toUpperCase()+'_REQUEST_MISMATCH');
 };
 if(source==='RESULT'){
  check('url',{required:true,bindRequest:true});
  check('requestedUrl',{bindRequest:true});
 }else check('requestedUrl',{required:true,bindRequest:true});
 for(const field of ['finalUrl','finalDisplayedUrl','mainDocumentUrl','httpUrl'])check(field);
 return reasons;
}
await fs.mkdir(path.dirname(output),{recursive:true});const temporary=await fs.mkdtemp(path.join(path.dirname(output),'.public-lh-without-images-'));
const format='sanitized-public-lighthouse-evidence-v1',note='Explicitly sanitized derivative, not a raw Lighthouse report. Original raw reports remain in scratch and are identified by SHA256. Screenshot/image payloads are omitted at the exact JSON pointers recorded; scores, metrics, nonimage audit results and failed attempts are retained. Browser logs, input files, cookies and private raw reports are not included.';
const results=new Map(),reports=[],attemptIndex=[],quarantinedAttempts=[];let reportBytes=0;
const save=async(name,value)=>{const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');await fs.writeFile(path.join(temporary,name),bytes,{flag:'wx'});return{bytes:bytes.length,sha256:sha(bytes)};};
try{
 for(const attempt of summary.attempts||[]){
  if(!jobs.has(attempt.id)||!Number.isInteger(attempt.attempt)||attempt.attempt<1)throw new Error('Attempt is outside the public inventory.');
  const stem=attempt.id+'.attempt-'+attempt.attempt,resultName=stem+'.result.json';
  if(attempt.result&&attempt.result!==resultName||results.has(stem))throw new Error('Unsafe or duplicate attempt reference.');
  const rawResult=await fs.readFile(path.join(input,resultName)),result=JSON.parse(rawResult),job=jobs.get(attempt.id);
  if(result.id!==attempt.id||result.attempt!==attempt.attempt||result.status!==attempt.status)throw new Error('Result identity differs from its recorded public attempt.');
  const reasons=documentTargetReasons(result,job,'RESULT');
  const reference=result.report||result.partialReport;
  let rawReport,rawReportSha256,report;
  if(reference){
   if(reference!==stem+'.lhr.json')throw new Error('Unsafe raw report reference.');
   rawReport=await fs.readFile(path.join(input,reference));rawReportSha256=sha(rawReport);report=JSON.parse(rawReport);
   reasons.push(...documentTargetReasons(report,job,'REPORT'));
  }
  let derivative;
  if(reasons.length){
   const quarantine={id:attempt.id,attempt:attempt.attempt,sourceStatus:['completed','expected-http-response','error','timeout'].includes(result.status)?result.status:'invalid-status',status:'error',errorStage:'evidence-export-document-identity-validation',errorCode:'PUBLIC_DOCUMENT_TARGET_REJECTED',reasonCodes:[...new Set(reasons)],rawResultSha256:sha(rawResult),...rawReportSha256?{rawReportSha256}:{}};
   quarantinedAttempts.push(quarantine);
   derivative={url:job.url,device:job.device,kind:job.kind,indexed:job.indexed===true,expectedStatus:job.expectedStatus,...quarantine,format,scores:{},metrics:{},error:'Public evidence quarantined: document target failed the public request identity policy.',evidenceQuarantined:true,rawEvidenceRetained:true,rawReportDelivered:false,...Number.isFinite(result.durationMs)&&result.durationMs>=0?{durationMs:result.durationMs}:{}};
  }else{
   derivative={...result,format};
   if(report){
    const {sanitized,removed}=sanitizeReport(report),filename=stem+'.sanitized-lhr.json';
    sanitized._evidence={format,rawReportSha256,removedImagePaths:removed,note};
    const written=await save(filename,sanitized);reportBytes+=written.bytes;
    reports.push({id:attempt.id,attempt:attempt.attempt,filename,rawReportSha256,rawBytes:rawReport.length,...written,removedImagePaths:removed});
    if(result.report)derivative.report=filename;if(result.partialReport)derivative.partialReport=filename;
    derivative.rawReportSha256=rawReportSha256;derivative.reportIsSanitized=true;
   }
  }
  await save(resultName,derivative);results.set(stem,derivative);attemptIndex.push({...attempt,status:derivative.status,...derivative.evidenceQuarantined?{sourceStatus:derivative.sourceStatus,evidenceQuarantined:true,errorStage:'evidence-export-document-identity-validation'}:{},result:resultName});
 }
 const records=summary.records.map(record=>{const result=results.get(record.id+'.attempt-'+record.attempt);if(!result||result.status!==record.status&&!(result.evidenceQuarantined&&result.sourceStatus===record.status))throw new Error('Latest result mismatch.');return{...result,resultFile:record.id+'.attempt-'+record.attempt+'.result.json'};});
 const quarantineCounts=quarantinedAttempts.length?{attempted:records.length,completed:records.filter(row=>row.status==='completed').length,expectedHttpResponses:records.filter(row=>row.status==='expected-http-response').length,errors:records.filter(row=>row.status==='error').length,timeouts:records.filter(row=>row.status==='timeout').length,pending:jobs.size-records.length,coverageComplete:records.length===jobs.size,quarantined:records.filter(row=>row.evidenceQuarantined).length,quarantinedAttempts:quarantinedAttempts.length,exportValidation:{stage:'document-identity',refusedAttempts:quarantinedAttempts.length,latestRefusals:records.filter(row=>row.evidenceQuarantined).length,countsAreNotAdditionalLighthouseRuns:true},sourceOutcomeCounts:Object.fromEntries(['attempted','completed','expectedHttpResponses','errors','timeouts','pending'].map(key=>[key,summary[key]??0]))}:{};
 await save('manifest.json',{...manifest,format,evidencePolicy:note});await save('inventory.json',inventory);await save('summary.json',{...summary,...quarantineCounts,format,evidencePolicy:note,records,attempts:attemptIndex});
 if(quarantinedAttempts.length){
  const columns=['url','device','kind','indexed','expectedStatus','httpStatus','status','performance','accessibility','best-practices','seo','largest-contentful-paint','total-blocking-time','cumulative-layout-shift','durationMs','error'];
  const cell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  const csv=[columns,...records.map(row=>columns.map(key=>row[key]??row.scores?.[key]??row.metrics?.[key]))].map(row=>row.map(cell).join(',')).join('\n')+'\n';
  await fs.writeFile(path.join(temporary,'summary.csv'),csv,{flag:'wx'});
 }else await fs.copyFile(path.join(input,'summary.csv'),path.join(temporary,'summary.csv'));
 await save('EXPORT.json',{format,exportedAt:new Date().toISOString(),buildId:manifest.config.buildId,configurationHash:manifest.configurationHash,expected:summary.expected,attempts:attemptIndex.length,coverageComplete:summary.coverageComplete,originalReportsRetainedInScratch:true,rawReportsDelivered:false,browserScreenshotsDelivered:false,reportBytes,sourceHashes:Object.fromEntries(names.map(name=>[name,sha(sourceBytes[name])])),reports,...quarantinedAttempts.length?{quarantinedAttempts,noteOnQuarantine:'Rejected actual document targets are retained only in the original private scratch evidence. This derivative records a counted export-validation refusal, the original safe-enum sourceStatus, fixed reason codes and hashes. It is not a new Lighthouse process failure and exports no rejected scores, report, raw error or unsafe target.'}:{},note});
 for(const name of names)if(sha(await fs.readFile(path.join(input,name)))!==sha(sourceBytes[name]))throw new Error('Run changed during export.');
 await fs.rename(temporary,output);
 console.log(JSON.stringify({format,output,attempts:attemptIndex.length,reports:reports.length,reportBytes,removedImagePaths:reports.reduce((sum,report)=>sum+report.removedImagePaths.length,0),coverageComplete:summary.coverageComplete,...quarantinedAttempts.length?{quarantinedAttempts:quarantinedAttempts.length,errorCode:'PUBLIC_DOCUMENT_TARGET_REJECTED'}:{}}));
 if(quarantinedAttempts.length)process.exitCode=2;
}catch(error){await fs.rm(temporary,{recursive:true,force:true});throw error;}
