import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// The optional source root lets the same behavioral tests demonstrate failures
// against an unchanged older checkout. It never replaces runner implementation.
const sourceRoot=process.env.PUBLIC_AUDIT_TEST_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const runFile=promisify(execFile),sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const buildId='synthetic-public-audit-build',publicContent={fixture:'public-audit-identity',locales:['fa','en']};
async function invoke(script,args=[],env={}){
 try{const result=await runFile(process.execPath,[script,...args],{timeout:15000,maxBuffer:1024*1024,env:{...process.env,...env}});return{code:0,...result};}
 catch(error){if(!Number.isInteger(error.code))throw error;return{code:error.code,stdout:error.stdout,stderr:error.stderr};}
}
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'idealmakoo-public-audit-identity-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 for(const relative of ['scripts/audit-public-metadata.mjs','scripts/lighthouse-child.mjs','scripts/lib/audit-streamed-html.mjs','scripts/lib/public-audit-identity.mjs','scripts/lib/metadata-editorial-review.mjs']){
  const bytes=await fs.readFile(path.join(sourceRoot,relative)).catch(error=>{if(error.code==='ENOENT'&&['/public-audit-identity.mjs','/metadata-editorial-review.mjs'].some(name=>relative.endsWith(name)))return null;throw error;});
  if(bytes!==null){await fs.mkdir(path.dirname(path.join(directory,relative)),{recursive:true});await fs.writeFile(path.join(directory,relative),bytes);}
 }
 await fs.mkdir(path.join(directory,'.next'));await fs.writeFile(path.join(directory,'.next/BUILD_ID'),buildId);
 const routes=new Map(),hits=[],siteSnapshots=[publicContent];
 const server=createServer((request,response)=>{
  hits.push(request.url);
  if(request.url==='/api/v1/site'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({...siteSnapshots.shift()||publicContent,version:1,observedAt:'synthetic'}));return;}
  const route=routes.get(request.url);
  if(!route){response.writeHead(404,{'content-type':'text/plain'});response.end('Fixture route missing');return;}
  response.writeHead(route.status??200,{'content-type':'text/html; charset=utf-8',...route.headers});response.end(route.body||'');
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise((resolve,reject)=>{server.closeIdleConnections();server.close(error=>error?reject(error):resolve());}));
 return{directory,routes,hits,siteSnapshots,baseUrl:`http://127.0.0.1:${server.address().port}`,sequence:0};
}
function page(fixture,pathname,options={}){
 const locale=pathname.split('/')[1],url=fixture.baseUrl+pathname,status=options.status??200,indexed=options.indexed??true;
 const canonical=options.canonical??url,alternates=options.alternates??{[locale]:canonical};
 const links=[...(canonical?[`<link rel="canonical" href="${canonical}">`]:[]),...Object.entries(alternates).map(([language,href])=>`<link rel="alternate" hreflang="${language}" href="${href}">`)];
 fixture.routes.set(pathname,{status,body:`<!doctype html><html lang="${locale}" dir="${['fa','ar'].includes(locale)?'rtl':'ltr'}"><head><title>Synthetic audit fixture</title><meta name="description" content="A fixture for the real audit CLI.">${options.noindex?'<meta name="robots" content="noindex">':''}${links.join('')}</head><body><main><h1>Synthetic fixture</h1></main></body></html>`});
 return{url,indexed,kind:options.kind??'public',expectedStatus:status,device:'mobile'};
}
async function metadata(fixture,jobs,args=[],redirects=[]){
 const directory=path.join(fixture.directory,`metadata-${++fixture.sequence}`),output=path.join(directory,'output');
 await fs.mkdir(directory);await fs.writeFile(path.join(directory,'inventory.json'),JSON.stringify({jobs,redirects}));
 await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({config:{baseUrl:fixture.baseUrl,buildId,publicContentHash:sha(publicContent),inventoryHash:sha(jobs)}}));
 const result=await invoke(path.join(fixture.directory,'scripts/audit-public-metadata.mjs'),['--run',directory,'--output',output,'--concurrency','2',...args]);
 const summary=await fs.readFile(path.join(output,'summary.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 return{...result,summary,output};
}
function metadataFailed(result,pattern){
 assert.equal(result.code,2,`The actual metadata CLI must reject this fixture. ${JSON.stringify({code:result.code,summary:result.summary,stderr:result.stderr})}`);
 assert.ok(result.summary.errors>0);
 if(pattern)assert.ok(result.summary.records.some(record=>record.errors.some(error=>pattern.test(error))),JSON.stringify(result.summary.records));
}

test('metadata rejects a mutually reciprocal canonical cluster on the wrong origin',async t=>{
 const f=await fixture(t),origin='https://wrong.example',alternates={fa:origin+'/fa/about/',en:origin+'/en/about/','x-default':origin+'/fa/about/'};
 const jobs=['fa','en'].map(locale=>page(f,`/${locale}/about/`,{canonical:origin+`/${locale}/about/`,alternates}));
 metadataFailed(await metadata(f,jobs),/Canonical does not match/);
});
test('metadata rejects the wrong canonical route even when self hreflang agrees with it',async t=>{
 const f=await fixture(t),wrong=f.baseUrl+'/en/unrelated/';
 metadataFailed(await metadata(f,[page(f,'/en/about/',{canonical:wrong,alternates:{en:wrong}})]),/Canonical does not match/);
});
test('an inventoried double-slash pathname cannot change the expected canonical origin',async t=>{
 const f=await fixture(t),wrong='http://wrong.example/en/about/';
 metadataFailed(await metadata(f,[page(f,'//wrong.example/en/about/',{canonical:wrong,alternates:{en:wrong}})]),/Canonical does not match/);
});
test('metadata accepts an explicit production canonical origin while probing a local production instance',async t=>{
 const f=await fixture(t),origin='https://production.example',alternates={fa:origin+'/fa/about/',en:origin+'/en/about/','x-default':origin+'/fa/about/'};
 const jobs=['fa','en'].map(locale=>page(f,`/${locale}/about/`,{canonical:origin+`/${locale}/about/`,alternates}));
 const result=await metadata(f,jobs,['--canonical-origin',origin]);
 assert.equal(result.code,0,result.stderr);assert.equal(result.summary.errors,0);assert.equal(result.summary.expectedCanonicalOrigin,origin);
 assert.ok(result.summary.records.every(record=>record.url.startsWith(f.baseUrl)));
});
test('metadata defaults its expected canonical origin to the inventory probe origin',async t=>{
 const f=await fixture(t),result=await metadata(f,[page(f,'/en/about/')]);
 assert.equal(result.code,0,result.stderr);assert.equal(result.summary.errors,0);assert.equal(result.summary.expectedCanonicalOrigin,f.baseUrl);
});
test('metadata permits normal origin serialization in canonical and reciprocal URLs',async t=>{
 const f=await fixture(t),fa='https://PRODUCTION.example:443/fa/about/',en='https://production.example/en/about/';
 const jobs=[page(f,'/fa/about/',{canonical:fa,alternates:{fa,en}}),page(f,'/en/about/',{canonical:en,alternates:{fa:'https://production.example/fa/about/',en}})];
 const result=await metadata(f,jobs,['--canonical-origin','HTTPS://Production.Example:443/']);
 assert.equal(result.code,0,result.stderr);assert.equal(result.summary.errors,0);assert.equal(result.summary.expectedCanonicalOrigin,'https://production.example');
});
test('metadata rejects canonical-origin paths, credentials, query and fragments before any request',async t=>{
 const f=await fixture(t),jobs=[page(f,'/en/about/')];
 for(const origin of ['https://example.test/path','https://name:password@example.test','https://@example.test','https://example.test?','https://example.test#','https://example.test/?q=1','https://example.test/#section','ftp://example.test','/relative']){
  const result=await metadata(f,jobs,['--canonical-origin',origin]);
  assert.notEqual(result.code,0,origin);assert.equal(result.summary,null,origin);assert.equal(f.hits.length,0,origin);
 }
});
test('metadata rejects self hreflang that points to a different inventoried page of the same language',async t=>{
 const f=await fixture(t),a=f.baseUrl+'/en/about/',b=f.baseUrl+'/en/contact/';
 metadataFailed(await metadata(f,[page(f,'/en/about/',{alternates:{en:b}}),page(f,'/en/contact/',{alternates:{en:a}})]),/Self hreflang/);
});
test('metadata requires the hreflang label to match the target locale',async t=>{
 const f=await fixture(t),url=f.baseUrl+'/en/about/';
 metadataFailed(await metadata(f,[page(f,'/en/about/',{alternates:{en:url,tr:url}})]),/does not match the target locale/);
});
test('metadata resolves hreflang targets by their complete expected URL',async t=>{
 const f=await fixture(t),fa=f.baseUrl+'/fa/about/',en=f.baseUrl+'/en/about/';
 const result=await metadata(f,[page(f,'/fa/about/',{alternates:{fa,en}}),page(f,'/en/about/',{alternates:{en,fa:'https://wrong.example/fa/about/'}})]);
 metadataFailed(result,/not an audited indexable 200 page/);
 assert.ok(result.summary.records.find(record=>record.locale==='en').errors.some(error=>/Hreflang target fa/.test(error)));
});
test('missing reciprocity is retained identically in final page records and the summary',async t=>{
 const f=await fixture(t),fa=f.baseUrl+'/fa/about/',en=f.baseUrl+'/en/about/';
 const result=await metadata(f,[page(f,'/fa/about/',{alternates:{fa,en}}),page(f,'/en/about/',{alternates:{en}})]);
 metadataFailed(result,/not reciprocal/);
 for(const record of result.summary.records){
  const saved=JSON.parse(await fs.readFile(path.join(result.output,sha(record.url).slice(0,16)+'.json'),'utf8'));
  assert.deepEqual(saved,record,'The page artifact must include final cross-page reciprocity failures.');
 }
});
test('metadata keeps inspected page evidence when the final content identity check rejects the crawl',async t=>{
 const f=await fixture(t),job=page(f,'/en/about/');f.siteSnapshots.push({...publicContent,fixture:'changed-content'});
 const result=await metadata(f,[job]);
 assert.notEqual(result.code,0);assert.match(result.stderr,/Build or published content no longer matches/);assert.equal(result.summary,null);
 const inspected=JSON.parse(await fs.readFile(path.join(result.output,sha(job.url).slice(0,16)+'.json'),'utf8'));
 assert.equal(inspected.url,job.url);assert.equal(inspected.httpStatus,200);assert.deepEqual(inspected.errors,[]);
});
test('metadata rejects an incorrect reciprocal page without requiring unavailable translations',async t=>{
 const f=await fixture(t),fa=f.baseUrl+'/fa/about/',other=f.baseUrl+'/fa/contact/',en=f.baseUrl+'/en/about/';
 const jobs=[page(f,'/fa/about/',{alternates:{fa,en}}),page(f,'/fa/contact/',{alternates:{fa:other}}),page(f,'/en/about/',{alternates:{fa:other,en}})];
 metadataFailed(await metadata(f,jobs),/not reciprocal/);
 const only=await metadata(f,[page(f,'/en/only-source/')]);assert.equal(only.code,0,only.stderr);assert.equal(only.summary.errors,0);
});
test('metadata keeps authentication and missing-page noindex behavior outside indexed canonical checks',async t=>{
 const f=await fixture(t),jobs=[
  page(f,'/en/auth/login/',{kind:'public-auth',indexed:false,noindex:true,canonical:'https://production.example/en/',alternates:{}}),
  page(f,'/en/intentionally-missing/',{kind:'expected-404',status:404,indexed:false,noindex:true,canonical:'',alternates:{}}),
 ];
 const good=await metadata(f,jobs);assert.equal(good.code,0,good.stderr);assert.equal(good.summary.errors,0);
 const bad=await metadata(f,[page(f,'/en/auth/login/',{kind:'public-auth',indexed:false,noindex:false,canonical:'',alternates:{}})]);
 metadataFailed(bad,/Authentication document must be noindex/);
});
test('metadata verifies canonical aliases as explicit HTTP redirects without counting them as browser measurements',async t=>{
 const f=await fixture(t),target=page(f,'/en/reviewed-page/');
 f.routes.set('/en/original-page/',{status:308,headers:{location:'/en/reviewed-page/'}});
 const alias={url:f.baseUrl+'/en/original-page/',kind:'public-redirect',indexed:false,expectedStatus:308,expectedLocation:target.url};
 const good=await metadata(f,[target],[],[alias]);
 assert.equal(good.code,0,good.stderr);assert.equal(good.summary.expected,2);assert.equal(good.summary.passed,2);
 assert.equal(good.summary.records.find(record=>record.kind==='public-redirect').expectedLocation,target.url);
 f.routes.set('/en/original-page/',{status:308,headers:{location:'/en/unrelated/'}});
 metadataFailed(await metadata(f,[target],[],[alias]),/redirect does not match/);
 f.routes.set('/en/original-page/',{status:302,headers:{location:target.url}});
 metadataFailed(await metadata(f,[target],[],[alias]),/HTTP 302; expected 308/);
});
test('metadata requires deliberately excluded released public pages to remain noindex',async t=>{
 const f=await fixture(t),job=page(f,'/en/noindex-page/',{indexed:false});job.expectedNoindex=true;
 metadataFailed(await metadata(f,[job]),/SEO settings require noindex/);
 page(f,'/en/noindex-page/',{indexed:false,noindex:true});
 const good=await metadata(f,[job]);assert.equal(good.code,0,good.stderr);assert.equal(good.summary.errors,0);
});

test('metadata CLI retains duplicate-title and description review warnings beside successful technical checks',async t=>{
 const f=await fixture(t),jobs=[page(f,'/en/one/'),page(f,'/en/two/'),page(f,'/tr/one/'),page(f,'/en/auth/login/',{kind:'public-auth',indexed:false,noindex:true,alternates:{}})];
 const result=await metadata(f,jobs);
 assert.equal(result.code,0,result.stderr);assert.equal(result.summary.errors,0);assert.equal(result.summary.warnings,2);
 assert.equal(result.summary.editorialReview.titleGroups,1);assert.equal(result.summary.editorialReview.descriptionGroups,1);
 for(const record of result.summary.records){
  const stored=JSON.parse(await fs.readFile(path.join(result.output,sha(record.url).slice(0,16)+'.json'),'utf8'));
  assert.deepEqual(stored.warnings,record.warnings);
  assert.equal(record.warnings.some(warning=>warning.includes('Duplicate title')),record.locale==='en'&&record.indexed);
 }
});

// These module fixtures replace only external measurement/browser dependencies.
// The actual shipped child performs result classification, HTTP fetching, raw
// report persistence and cleanup. No Chrome starts and these are not LH scores.
const moduleFixtures=String.raw`import fs from 'node:fs/promises';
import {registerHooks} from 'node:module';
const modules={
 'lighthouse':"import fs from 'node:fs/promises';export default async function(){return{lhr:JSON.parse(await fs.readFile(process.env.PUBLIC_AUDIT_SYNTHETIC_LHR,'utf8'))};}",
 'lighthouse/core/config/lr-desktop-config.js':'export default {};',
 'chrome-launcher':"import fs from 'node:fs/promises';export async function launch(){await fs.appendFile(process.env.PUBLIC_AUDIT_SYNTHETIC_BROWSER,'synthetic launch\\n');return{port:0,async kill(){await fs.appendFile(process.env.PUBLIC_AUDIT_SYNTHETIC_BROWSER,'synthetic kill\\n');}};}"
};
registerHooks({resolve(specifier,context,nextResolve){return Object.hasOwn(modules,specifier)?{url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true}:nextResolve(specifier,context);}});
`;
async function lighthouseChild(fixture,{pathname='/en/about/',finalDisplayedUrl=fixture.baseUrl+pathname,expectedStatus=200,kind='public',runtimeError}={}){
 const directory=path.join(fixture.directory,`child-${++fixture.sequence}`);await fs.mkdir(directory);
 const lhr={lighthouseVersion:'synthetic-test-only',fetchTime:'2026-01-01T00:00:00.000Z',finalDisplayedUrl,
  categories:{performance:{score:0.53},accessibility:{score:0.94},'best-practices':{score:0.81},seo:{score:0.90}},
  audits:{'first-contentful-paint':{id:'first-contentful-paint',title:'Synthetic test metric',score:0.5,numericValue:1234}},
  runtimeError,runWarnings:['Synthetic fixture; not a performance measurement.']};
 const input={id:'synthetic-job',attempt:1,job:{url:fixture.baseUrl+pathname,device:'mobile',kind,expectedStatus},categories:['performance','accessibility','best-practices','seo'],maxWaitForLoad:1000,chromeFlags:[],chromePath:'/no-browser-in-this-test',profile:path.join(directory,'profile'),chromeLog:path.join(directory,'chrome.log'),reportFile:path.join(directory,'report.json'),resultFile:path.join(directory,'result.json')};
 const inputFile=path.join(directory,'input.json'),fixtureFile=path.join(directory,'synthetic-lhr.json'),preload=path.join(directory,'synthetic-modules.mjs'),browserLog=path.join(directory,'synthetic-browser.log');
 await fs.writeFile(inputFile,JSON.stringify(input));await fs.writeFile(fixtureFile,JSON.stringify(lhr));await fs.writeFile(preload,moduleFixtures);
 const child=await invoke('--import',[preload,path.join(fixture.directory,'scripts/lighthouse-child.mjs'),inputFile],{PUBLIC_AUDIT_SYNTHETIC_LHR:fixtureFile,PUBLIC_AUDIT_SYNTHETIC_BROWSER:browserLog});
 assert.equal(child.code,0,child.stderr);
 const result=JSON.parse(await fs.readFile(input.resultFile,'utf8'));
 assert.deepEqual(JSON.parse(await fs.readFile(input.reportFile,'utf8')),JSON.parse(JSON.stringify(lhr)),'The real child must retain the unmodified synthetic raw report.');
 assert.deepEqual(result.scores,{performance:53,accessibility:94,'best-practices':81,seo:90});
 assert.deepEqual(result.runWarnings,lhr.runWarnings);assert.deepEqual(result.runtimeError,runtimeError);
 assert.equal(await fs.readFile(browserLog,'utf8'),'synthetic launch\nsynthetic kill\n');
 return result;
}
test('Lighthouse child accepts matching page identities with ordinary URL serialization',async t=>{
 const f=await fixture(t);page(f,'/en/about/');
 const result=await lighthouseChild(f,{finalDisplayedUrl:f.baseUrl+'/en/./about/'});
 assert.equal(result.status,'completed');assert.equal(result.expectedHttpVerified,true);
});
test('Lighthouse child rejects a different measured 200 page despite a matching independent HTTP response',async t=>{
 const f=await fixture(t);page(f,'/en/about/');page(f,'/en/contact/');
 const result=await lighthouseChild(f,{finalDisplayedUrl:f.baseUrl+'/en/contact/'});
 assert.equal(result.status,'error','A different measured route must not count as complete.');
 assert.equal(result.urlIdentityVerified,false);assert.match(result.identityErrors.join(' '),/finalDisplayedUrl/);
});
test('Lighthouse child rejects an independent HTTP redirect to another 200 even when measured URL matches',async t=>{
 const f=await fixture(t);page(f,'/en/contact/');f.routes.set('/en/about/',{status:302,headers:{location:'/en/contact/'}});
 const result=await lighthouseChild(f);
 assert.equal(result.httpStatus,200);assert.equal(result.httpUrl,f.baseUrl+'/en/contact/');
 assert.equal(result.status,'error','A 200 after a redirect to a different page must not count as complete.');
 assert.match(result.identityErrors.join(' '),/Independent HTTP URL/);
});
test('Lighthouse child rejects a redirect to another 200 observed by both measurements',async t=>{
 const f=await fixture(t);page(f,'/en/contact/');f.routes.set('/en/about/',{status:302,headers:{location:'/en/contact/'}});
 const result=await lighthouseChild(f,{finalDisplayedUrl:f.baseUrl+'/en/contact/'});
 assert.equal(result.status,'error');assert.equal(result.identityErrors.length,2);
});
for(const [name,finalUrl]of [
 ['missing',()=>null],['malformed',()=>'not-a-url'],['wrong origin',()=> 'https://wrong.example/en/about/'],
 ['query',f=>f.baseUrl+'/en/about/?x=1'],['empty query',f=>f.baseUrl+'/en/about/?'],
 ['fragment',f=>f.baseUrl+'/en/about/#section'],['empty fragment',f=>f.baseUrl+'/en/about/#'],
])test(`Lighthouse child rejects a ${name} measured final URL without dropping evidence`,async t=>{
 const f=await fixture(t);page(f,'/en/about/');
 const result=await lighthouseChild(f,{finalDisplayedUrl:finalUrl(f)});
 assert.equal(result.status,'error',`The ${name} final URL must not count as complete.`);assert.equal(result.urlIdentityVerified,false);
});
test('Lighthouse child records an expected 404 only for the matching measured and fetched missing page',async t=>{
 const f=await fixture(t);page(f,'/en/missing/',{status:404,indexed:false,noindex:true});
 const runtimeError={code:'ERRORED_DOCUMENT_REQUEST',message:'Synthetic 404 fixture'};
 const result=await lighthouseChild(f,{pathname:'/en/missing/',expectedStatus:404,kind:'expected-404',runtimeError});
 assert.equal(result.status,'expected-http-response');assert.equal(result.expectedHttpVerified,true);assert.equal(result.httpStatus,404);
});
test('Lighthouse child rejects a redirected 404 even if its runtime error is the expected document error',async t=>{
 const f=await fixture(t);page(f,'/en/other-missing/',{status:404,indexed:false,noindex:true});f.routes.set('/en/missing/',{status:302,headers:{location:'/en/other-missing/'}});
 const result=await lighthouseChild(f,{pathname:'/en/missing/',finalDisplayedUrl:f.baseUrl+'/en/other-missing/',expectedStatus:404,kind:'expected-404',runtimeError:{code:'ERRORED_DOCUMENT_REQUEST',message:'Synthetic 404 fixture'}});
 assert.equal(result.status,'error','A different 404 page must not satisfy the requested expected-404 job.');assert.equal(result.identityErrors.length,2);
});
test('Lighthouse child does not relabel a redirect to 200 as an expected 404',async t=>{
 const f=await fixture(t);page(f,'/en/contact/');f.routes.set('/en/missing/',{status:302,headers:{location:'/en/contact/'}});
 const result=await lighthouseChild(f,{pathname:'/en/missing/',finalDisplayedUrl:f.baseUrl+'/en/contact/',expectedStatus:404,kind:'expected-404',runtimeError:{code:'ERRORED_DOCUMENT_REQUEST',message:'Synthetic 404 fixture'}});
 assert.equal(result.status,'error');assert.equal(result.expectedHttpVerified,false);assert.match(result.error,/HTTP 200; expected 404/);
});
test('Lighthouse child preserves a different runtime failure when both page identities match',async t=>{
 const f=await fixture(t);page(f,'/en/about/');
 const result=await lighthouseChild(f,{runtimeError:{code:'PROTOCOL_TIMEOUT',message:'Synthetic incomplete run'}});
 assert.equal(result.status,'error');assert.equal(result.expectedHttpVerified,true);
});
