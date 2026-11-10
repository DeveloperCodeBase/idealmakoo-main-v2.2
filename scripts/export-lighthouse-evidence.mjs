import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const options={};
for(let index=2;index<process.argv.length;index+=2){const key=process.argv[index],value=process.argv[index+1];if(!['--run','--output'].includes(key)||!value)throw new Error('Usage: node scripts/export-lighthouse-evidence.mjs --run RAW_RUN_DIRECTORY --output COMPACT_DIRECTORY');options[key.slice(2)]=value;}
if(!options.run||!options.output)throw new Error('--run and --output are required.');
const input=path.resolve(options.run),output=path.resolve(options.output);
if(input===output)throw new Error('The compact export must not overwrite raw evidence.');
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=async name=>{if(path.basename(name)!==name)throw new Error('Unsafe evidence path.');return JSON.parse(await fs.readFile(path.join(input,name),'utf8'));};
const save=async(name,value)=>fs.writeFile(path.join(output,name),JSON.stringify(value,null,2));
const [manifest,inventory,summary]=await Promise.all(['manifest.json','inventory.json','summary.json'].map(read));
await fs.mkdir(output,{recursive:true});
const omittedAudits=['full-page-screenshot','screenshot-thumbnails','final-screenshot'];
const omissions={rawLighthouseReports:true,allBrowserScreenshots:true,base64ImageData:true,omittedAuditIds:omittedAudits,detailArrayMaximumItems:20,detailMaximumStringCharacters:16000,note:'This is a compact derivative, not a raw Lighthouse report. Scores, metrics, statuses, runtime errors, warnings and every non-screenshot audit result are retained. Failed/error audit details are retained with explicit array/string bounds; raw reports are identified by SHA-256. Screenshot artifacts and their embedded image bytes are deliberately excluded.'};
function safe(value,key='',depth=0){
 if(depth>16)return{omitted:'Nested detail exceeded export depth16.'};
 if(typeof value==='string'){
  if(/^data:image\//i.test(value)||/^[A-Za-z0-9+/]{1000,}={0,2}$/.test(value))return'[binary/image payload omitted]';
  return value.length>16000?{text:value.slice(0,16000),omittedCharacters:value.length-16000}:value;
 }
 if(Array.isArray(value)){const items=value.slice(0,20).map(item=>safe(item,key,depth+1));return value.length>20?{items,omittedItems:value.length-20}:items;}
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).filter(([name])=>!['screenshot','screenshots','screenshotData','imageData'].includes(name)).map(([name,child])=>[name,safe(child,name,depth+1)]));
}
function auditSummary(audit){
 const fields=['id','title','description','score','scoreDisplayMode','displayValue','numericValue','numericUnit','errorMessage','warnings'];
 const result=Object.fromEntries(fields.filter(key=>audit[key]!==undefined).map(key=>[key,safe(audit[key])]));
 if(audit.details&&(audit.errorMessage||(typeof audit.score==='number'&&audit.score<1)))result.details=safe(audit.details);
 return result;
}
// Group attempts before ZIP compression, so repeated audit descriptions share
// a compression stream. The index below preserves direct per-attempt lookup.
const maximumPartBytes=32*1024*1024,parts=[],exportsByAttempt=new Map();let totalBytes=0,entries=[],entryBytes=0;
const partHeader=number=>JSON.stringify({format:'compact-lighthouse-evidence-part-v2',part:number}).slice(0,-1)+',"attempts":[';
async function flushPart(){
 if(!entries.length)return;
 const number=parts.length+1,filename=`audit-part-${String(number).padStart(4,'0')}.json`,serialized=partHeader(number)+entries.join(',')+']}\n',bytes=Buffer.byteLength(serialized);
 if(bytes>maximumPartBytes)throw new Error('Compact audit part exceeded its explicit 32 MiB bound.');
 await fs.writeFile(path.join(output,filename),serialized);parts.push({filename,attempts:entries.length,bytes,sha256:sha(serialized)});totalBytes+=bytes;entries=[];entryBytes=0;
}
for(const attempt of summary.attempts||[]){
 const key=`${attempt.id}.attempt-${attempt.attempt}`,result=await read(attempt.result||key+'.result.json');
 const reportName=result.report||result.partialReport;let report,rawHash;
 if(reportName){
  if(path.basename(reportName)!==reportName)throw new Error('Unsafe raw report path in result.');
  const raw=await fs.readFile(path.join(input,reportName));rawHash=sha(raw);report=JSON.parse(raw);
 }
 const {report:discardReport,partialReport:discardPartial,resultFile:discardResult,...retained}=result;
 const compact={...retained,rawReportSha256:rawHash,omissions:report?omissions:undefined,...report?{
  lighthouseVersion:report.lighthouseVersion,fetchTime:report.fetchTime,requestedUrl:report.requestedUrl,finalDisplayedUrl:report.finalDisplayedUrl,
  runtimeError:report.runtimeError,runWarnings:report.runWarnings,
  categories:Object.fromEntries(Object.entries(report.categories||{}).map(([id,category])=>[id,{id:category.id,title:category.title,score:category.score,auditRefs:category.auditRefs}])),
  audits:Object.fromEntries(Object.entries(report.audits||{}).filter(([id])=>!omittedAudits.includes(id)).map(([id,audit])=>[id,auditSummary(audit)])),
 }: {}};
 const serialized=JSON.stringify(compact),bytes=Buffer.byteLength(serialized);
 if(/data:image\/|"(?:full-page-screenshot|screenshot-thumbnails|final-screenshot)"\s*:/.test(serialized))throw new Error('An image-bearing artifact survived compact export.');
 const overhead=Buffer.byteLength(partHeader(parts.length+1))+3;
 if(bytes+overhead>maximumPartBytes)throw new Error('A single bounded audit exceeds 32 MiB; export stopped without dropping audit outcomes.');
 if(entries.length&&entryBytes+bytes+entries.length+overhead>maximumPartBytes)await flushPart();
 const filename=`audit-part-${String(parts.length+1).padStart(4,'0')}.json`,index=entries.length;entries.push(serialized);entryBytes+=bytes;
 exportsByAttempt.set(key,{filename,index,rawReportSha256:rawHash});
}
await flushPart();
const compactRecord=record=>{const{report,partialReport,resultFile,...rest}=record;return{...rest,evidence:exportsByAttempt.get(`${record.id}.attempt-${record.attempt}`)};};
const compactSummary={...summary,format:'compact-lighthouse-evidence-v2',omissions,parts,records:summary.records.map(compactRecord),attempts:(summary.attempts||[]).map(attempt=>{const{result,...retained}=attempt;return{...retained,evidence:exportsByAttempt.get(`${attempt.id}.attempt-${attempt.attempt}`)};})};
await Promise.all([save('manifest.json',manifest),save('inventory.json',inventory),save('summary.json',compactSummary),fs.copyFile(path.join(input,'summary.csv'),path.join(output,'summary.csv'))]);
await save('EXPORT.json',{exportedAt:new Date().toISOString(),format:'compact-lighthouse-evidence-v2',buildId:manifest.config.buildId,configurationHash:manifest.configurationHash,expected:summary.expected,attempts:exportsByAttempt.size,coverageComplete:summary.coverageComplete,maximumPartBytes,parts,compactAuditBytes:totalBytes,omissions});
console.log(JSON.stringify({event:'export',output,attempts:exportsByAttempt.size,parts:parts.length,compactAuditBytes:totalBytes,coverageComplete:summary.coverageComplete}));
