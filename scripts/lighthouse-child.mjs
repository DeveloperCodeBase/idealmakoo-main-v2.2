import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/lr-desktop-config.js';
import {launch} from 'chrome-launcher';
import {lighthouseIdentityErrors} from './lib/public-audit-identity.mjs';

// One owned browser and a fresh profile per URL. The parent controls the total
// deadline, including browser launch, tracing, screenshots and report assembly.
const input=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const started=Date.now();let chrome,profile=input.profile,stopping=false;
const output={...input.job,attempt:input.attempt,id:input.id,startedAt:new Date().toISOString(),status:'error',scores:{},metrics:{}};
async function atomic(file,value){const temporary=file+`.${process.pid}.tmp`;await fs.writeFile(temporary,JSON.stringify(value));await fs.rename(temporary,file);}
async function saveChromeLog(){if(!profile)return;const stderr=await fs.readFile(path.join(profile,'chrome-err.log'),'utf8').catch(()=>null);if(stderr)await fs.writeFile(input.chromeLog,stderr);}
async function stop(code){if(stopping)return;stopping=true;try{await saveChromeLog();await chrome?.kill();}finally{process.exit(code);}}
process.once('SIGTERM',()=>void stop(143));process.once('SIGINT',()=>void stop(130));
try{
 profile ||= await fs.mkdtemp(path.join(os.tmpdir(),'idealmakoo-lighthouse-'));
 chrome=await launch({chromePath:input.chromePath||undefined,userDataDir:profile,chromeFlags:input.chromeFlags,handleSIGINT:false,logLevel:'silent'});
 const result=await lighthouse(input.job.url,{port:chrome.port,logLevel:'error',onlyCategories:input.categories,output:'json',maxWaitForLoad:input.maxWaitForLoad,disableFullPageScreenshot:input.disableFullPageScreenshot===true},input.job.device==='desktop'?desktopConfig:undefined);
 if(!result)throw new Error('Lighthouse returned no result.');
 const lhr=result.lhr;await atomic(input.reportFile,lhr);
 Object.assign(output,{
  status:lhr.runtimeError?'error':'completed',
  lighthouseVersion:lhr.lighthouseVersion,fetchTime:lhr.fetchTime,finalDisplayedUrl:lhr.finalDisplayedUrl,
  userAgent:lhr.userAgent,environment:lhr.environment,configSettings:lhr.configSettings,
  scores:Object.fromEntries(Object.entries(lhr.categories).map(([name,value])=>[name,value.score===null?null:Math.round(value.score*100)])),
  metrics:Object.fromEntries(['first-contentful-paint','largest-contentful-paint','speed-index','total-blocking-time','cumulative-layout-shift','interactive'].filter(key=>lhr.audits[key]).map(key=>[key,lhr.audits[key].numericValue])),
  runtimeError:lhr.runtimeError,runWarnings:lhr.runWarnings,
  // Detailed audit evidence, DOM snippets and trace-derived data remain in the
  // complete LHR. The summary stores a concise, actionable failure index.
  failedAudits:Object.values(lhr.audits).filter(audit=>audit.score!==null&&audit.score<1).map(audit=>({id:audit.id,title:audit.title,score:audit.score,displayValue:audit.displayValue})),
  report:path.basename(input.reportFile),
 });
}catch(error){output.error=String(error?.message||error);output.errorCode=error?.code;}
finally{
 try{await saveChromeLog();}catch{}
 try{await chrome?.kill();}catch(error){output.cleanupError=String(error?.message||error);}
 if(profile)await fs.rm(profile,{recursive:true,force:true}).catch(()=>{});
 // Check HTTP after Lighthouse, so this probe does not warm the target route
 // before its measured cold-browser navigation. It is independent evidence.
 try{
  const response=await fetch(input.job.url,{redirect:'follow',signal:AbortSignal.timeout(30000)});
  output.httpStatus=response.status;output.httpUrl=response.url;
  await response.body?.cancel();
  output.expectedHttpVerified=response.status===input.job.expectedStatus;
  if(!output.expectedHttpVerified){output.status='error';output.error=`HTTP ${response.status}; expected ${input.job.expectedStatus}.`;}
 }catch(error){output.status='error';output.httpError=String(error?.message||error);output.error ||= output.httpError;}
 output.identityErrors=lighthouseIdentityErrors(input.job.url,output);
 output.urlIdentityVerified=output.identityErrors.length===0;
 if(!output.urlIdentityVerified){output.status='error';output.error ||= output.identityErrors.join(' ');}
 // Lighthouse refuses to score an error document. Count only the requested
 // missing page, with matching measured and independently fetched identities.
 else if(output.expectedHttpVerified&&input.job.kind==='expected-404'&&input.job.expectedStatus===404&&output.runtimeError?.code==='ERRORED_DOCUMENT_REQUEST')output.status='expected-http-response';
 output.durationMs=Date.now()-started;output.finishedAt=new Date().toISOString();
 await atomic(input.resultFile,output);
}
