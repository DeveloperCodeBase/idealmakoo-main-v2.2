import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {auditBrowserConfiguration} from '../scripts/lib/audit-browser-flags.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),execute=promisify(execFile);
test('default browser configuration retains the existing software fallback and sandbox',()=>{
 assert.deepEqual(auditBrowserConfiguration(),{graphicsMode:'webgl-software-fallback',chromeFlags:['--headless=new','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 assert.equal(auditBrowserConfiguration({'allow-root-chrome':true}).chromeFlags.includes('--no-sandbox'),true);
});
test('explicit GPU driver mode is separate from browser-default and cannot be combined with disabling SwiftShader',()=>{
 const driver=auditBrowserConfiguration({'swiftshader-driver':true});
 assert.equal(driver.graphicsMode,'swiftshader-driver');
 assert.deepEqual(driver.chromeFlags.slice(-2),['--use-gl=angle','--use-angle=swiftshader']);
 assert.deepEqual(auditBrowserConfiguration({'no-swiftshader':true}),{graphicsMode:'browser-default',chromeFlags:['--headless=new','--disable-dev-shm-usage']});
 assert.throws(()=>auditBrowserConfiguration({'no-swiftshader':true,'swiftshader-driver':true}),/mutually exclusive/);
});

// Execute the shipped public CLI with an HTTP fixture. Only unrelated inventory
// imports and external package metadata are fixtures. process.execPath supplies
// --version; inventory-only never launches a browser and creates no LH scores.
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'idealmakoo-audit-browser-flags-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 async function write(relative,contents){const target=path.join(directory,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,contents);}
 for(const relative of ['scripts/audit-lighthouse.mjs','scripts/lib/audit-browser-flags.mjs','scripts/lib/lighthouse-attempts.mjs'])await write(relative,await fs.readFile(path.join(root,relative)));
 await write('scripts/lib/public-audit-inventory.mjs',`export function publicAuditUrl(value,base){return new URL(value,base).href;}export function buildPublicAuditInventory(){throw new Error('All-public inventory is outside this flag fixture.');}`);
 await write('package.json',JSON.stringify({type:'module',version:'fixture-no-browser'}));
 for(const name of ['lighthouse','chrome-launcher'])await write(`node_modules/${name}/package.json`,JSON.stringify({name,type:'module',version:'fixture-no-browser',exports:{'.':'./index.js','./package.json':'./package.json'}}));
 await write('node_modules/chrome-launcher/index.js','export function getChromePath(){return process.execPath;}');
 await write('.next/BUILD_ID','fixture-flags-build');await write('urls.json',JSON.stringify(['/en/contact/']));
 const hits=[],server=createServer((request,response)=>{
  hits.push(request.url);
  if(request.url==='/api/v1/site'){response.setHeader('content-type','application/json');response.end(JSON.stringify({publications:[],forms:[],version:1,observedAt:'fixture'}));}
  else if(request.url==='/fa/'){response.setHeader('content-type','text/html');response.end('<html><script src="/_next/static/fixture.js"></script></html>');}
  else{response.statusCode=404;response.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>{server.closeIdleConnections();server.close(resolve);}));
 const base=`http://127.0.0.1:${server.address().port}`,output=path.join(directory,'output');
 async function invoke(flags=[]){
  const args=[path.join(directory,'scripts/audit-lighthouse.mjs'),'--base-url',base,'--urls',path.join(directory,'urls.json'),'--output',output,'--inventory-only','--chrome',process.execPath,...flags];
  try{const child=await execute(process.execPath,args,{timeout:10000,maxBuffer:1024*1024});return{code:0,...child};}
  catch(error){if(!Number.isInteger(error.code))throw error;return{code:error.code,stdout:error.stdout,stderr:error.stderr};}
 }
 return{directory,output,hits,invoke,manifest:()=>fs.readFile(path.join(output,'manifest.json'),'utf8').then(JSON.parse)};
}
for(const [flags,mode]of [[[],'webgl-software-fallback'],[['--no-swiftshader'],'browser-default'],[['--swiftshader-driver','--allow-root-chrome'],'swiftshader-driver']])test(`real inventory CLI records ${mode} without browser scoring`,async t=>{
 const f=await fixture(t),result=await f.invoke(flags);assert.equal(result.code,0,result.stderr);
 const manifest=await f.manifest();assert.equal(manifest.config.graphicsMode,mode);
 assert.equal(manifest.config.chromeFlags.includes('--use-angle=swiftshader'),mode==='swiftshader-driver');
 assert.equal(manifest.config.chromeFlags.includes('--use-gl=angle'),mode==='swiftshader-driver');
 assert.equal(manifest.config.chromeFlags.includes('--enable-unsafe-swiftshader'),mode!=='browser-default');
 assert.equal(manifest.config.chromeFlags.includes('--no-sandbox'),flags.includes('--allow-root-chrome'));
 const summary=JSON.parse(await fs.readFile(path.join(f.output,'summary.json'),'utf8'));
 assert.equal(summary.attempted,0);assert.equal(summary.expected,1);assert.equal(summary.coverageComplete,false);
 assert.deepEqual(summary.records,[]);
});
test('real inventory CLI rejects conflicting graphics flags before HTTP or output writes',async t=>{
 const f=await fixture(t),result=await f.invoke(['--no-swiftshader','--swiftshader-driver']);
 assert.notEqual(result.code,0);assert.match(result.stderr,/mutually exclusive/);assert.deepEqual(f.hits,[]);
 await assert.rejects(fs.access(f.output),error=>error.code==='ENOENT');
});
test('real inventory CLI preserves identical resumes and refuses to mix driver-mode evidence',async t=>{
 const f=await fixture(t);assert.equal((await f.invoke()).code,0);const original=await f.manifest();
 assert.equal((await f.invoke()).code,0);assert.deepEqual(await f.manifest(),original);
 const different=await f.invoke(['--swiftshader-driver']);assert.notEqual(different.code,0);assert.match(different.stderr,/Cannot resume/);
 assert.deepEqual(await f.manifest(),original,'The previous evidence identity must remain intact.');
});
test('the optional full-page report image policy is pinned and cannot change during resume',async t=>{
 const f=await fixture(t);assert.equal((await f.invoke(['--no-full-page-screenshot'])).code,0);
 const original=await f.manifest();assert.equal(original.config.disableFullPageScreenshot,true);
 assert.equal((await f.invoke(['--no-full-page-screenshot'])).code,0);
 const changed=await f.invoke();assert.notEqual(changed.code,0);assert.match(changed.stderr,/Cannot resume/);
 assert.deepEqual(await f.manifest(),original);
});
test('installed Lighthouse keeps every audit, category, trace and score setting when only its report image is omitted',async()=>{
 const {initializeConfig}=await import('lighthouse/core/config/config.js');
 const {default:desktop}=await import('lighthouse/core/config/lr-desktop-config.js');
 const flags={onlyCategories:['performance','accessibility','best-practices','seo'],maxWaitForLoad:45000,disableStorageReset:false};
 for(const config of [undefined,desktop]){
  const {resolvedConfig:full}=await initializeConfig('navigation',config,{...flags,disableFullPageScreenshot:false});
  const {resolvedConfig:compact}=await initializeConfig('navigation',config,{...flags,disableFullPageScreenshot:true});
  assert.deepEqual(compact.audits.map(audit=>audit.implementation.meta.id),full.audits.map(audit=>audit.implementation.meta.id));
  assert.deepEqual(compact.categories,full.categories);
  assert.deepEqual(compact.artifacts.map(artifact=>artifact.id),full.artifacts.filter(artifact=>artifact.id!=='FullPageScreenshot').map(artifact=>artifact.id));
  assert.ok(compact.artifacts.some(artifact=>artifact.id==='Trace'),'Trace filmstrip for SpeedIndex stays enabled.');
  assert.ok(compact.audits.some(audit=>audit.implementation.meta.id==='screenshot-thumbnails'));
  assert.ok(compact.audits.some(audit=>audit.implementation.meta.id==='speed-index'));
  for(const audit of compact.audits)assert.ok(!audit.implementation.meta.requiredArtifacts.includes('FullPageScreenshot'));
  const {disableFullPageScreenshot:fullImage,...fullSettings}=full.settings;
  const {disableFullPageScreenshot:compactImage,...compactSettings}=compact.settings;
  assert.equal(fullImage,false);assert.equal(compactImage,true);assert.deepEqual(compactSettings,fullSettings);
 }
});
