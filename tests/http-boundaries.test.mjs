import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const nodeRequire=createRequire(import.meta.url),next=nodeRequire('next/server');
const policies=await loadTs('src/lib/security-headers.ts');
const capabilities=await loadTs('src/lib/private-capabilities.ts');
const i18n=await loadTs('src/lib/i18n.ts');
const preflightCalls=[];
let missingPreflight=false;
const preflight={publicNotFoundPreflight:async(request,path)=>{preflightCalls.push({method:request.method,path});return missingPreflight;}};
const {withApiSecurityHeaders,DEFAULT_API_CONTENT_SECURITY_POLICY}=await loadTs('src/lib/api-security-headers.ts');
const output=ts.transpileModule(readFileSync(new URL('../src/proxy.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={},environment={NODE_ENV:'production'};
runInNewContext(output,{exports,URL,Headers,process:{env:environment},require:name=>name==='next/server'?next:name==='node:crypto'?nodeRequire('node:crypto'):name==='./lib/security-headers'?policies:name==='./lib/private-capabilities'?capabilities:name==='./lib/i18n'?i18n:name==='./server/public-not-found-preflight'?preflight:assert.fail('Unexpected proxy dependency '+name)});
const request=(path,options)=>new next.NextRequest('https://factory.example'+path,options);

test('API pass-through never supplies a document CSP that could weaken the route sandbox',async()=>{
  for(const path of ['/api/v1/content-previews/'+'a'.repeat(64),'/api/v1/resources/doc/versions/v1/content','/api/v1/media/asset','/api/ai/text','/api/v1/health/ready']){
    const response=await exports.proxy(request(path));
    assert.equal(response.headers.get('Content-Security-Policy'),null,path);
    assert.equal(response.headers.get('x-middleware-next'),'1',path);
  }
});

const directive=(policy,name)=>policy.split('; ').find(value=>value.startsWith(name+' '));

test('each rendered document gets matching fresh server nonces and incoming policy headers cannot authorize scripts',async()=>{
  const seen=new Set();
  for(const path of ['/fa/','/en/auth/','/ar/admin/settings/','/ru/account/','/tr/communication-verification/device/']){
    const response=await exports.proxy(request(path,{headers:{'x-nonce':'attacker-reused-nonce','Content-Security-Policy':"script-src * 'unsafe-inline' 'unsafe-eval'"}}));
    const nonce=response.headers.get('x-middleware-request-x-nonce'),policy=response.headers.get('Content-Security-Policy');
    assert.match(nonce,/^[A-Za-z0-9+/]{32}$/);
    assert.equal(seen.has(nonce),false);seen.add(nonce);
    assert.equal(response.headers.get('x-middleware-request-content-security-policy'),policy);
    assert.equal(directive(policy,'script-src'),`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    assert.equal(directive(policy,'script-src-attr'),"script-src-attr 'none'");
    assert.equal(directive(policy,'worker-src'),"worker-src 'self'");
    assert.doesNotMatch(directive(policy,'script-src'),/unsafe-inline|unsafe-eval|attacker/);
    assert.equal(directive(policy,'style-src'),"style-src 'self' 'unsafe-inline'",'Existing visual styles remain usable');
  }
  const repeated=(await exports.proxy(request('/fa/'))).headers.get('x-middleware-request-x-nonce');
  assert.equal(seen.has(repeated),false);
});

test('API and worker pass-through remove client nonce/CSP and retain distinct closed script policies',async()=>{
  for(const path of ['/api/v1/health/ready','/api/v1/media/id/content','/najva-messaging-sw.js']){
    const response=await exports.proxy(request(path,{headers:{'x-nonce':'attacker','Content-Security-Policy':"script-src *"}}));
    assert.equal(response.headers.get('Content-Security-Policy'),null);
    assert.equal(response.headers.get('x-middleware-request-x-nonce'),null);
    assert.equal(response.headers.get('x-middleware-request-content-security-policy'),null);
  }
  for(const path of ['/service-worker.js','/service-worker-classic.js','/sw-policy.js']){
    const response=await exports.proxy(request(path));
    const policy=response.headers.get('Content-Security-Policy');
    assert.equal(directive(policy,'script-src'),"script-src 'self'",'Same-origin worker imports do not inherit a document nonce');
    assert.equal(directive(policy,'connect-src'),"connect-src 'self'");
    assert.doesNotMatch(policy,/nonce-|unsafe-inline|unsafe-eval|strict-dynamic|blob:/);
  }
});

test('Najva origins expand only the explicit permission page and worker import policy; malformed origins fail closed',async()=>{
  environment.NAJVA_SCRIPT_ORIGINS='https://sdk.najva.com';
  environment.NAJVA_CONNECT_ORIGINS='https://api.najva.com';
  try{
    for(const path of ['/fa/','/en/admin/','/fa/communication-verification/device-extra/']){
      assert.doesNotMatch((await exports.proxy(request(path))).headers.get('Content-Security-Policy'),/najva\.com/);
    }
    const policy=(await exports.proxy(request('/fa/communication-verification/device/'))).headers.get('Content-Security-Policy');
    assert.match(directive(policy,'script-src'),/https:\/\/sdk\.najva\.com/);
    assert.equal(directive(policy,'connect-src'),"connect-src 'self' https://api.najva.com");
    const worker=policies.workerContentSecurityPolicy(environment,true);
    assert.equal(directive(worker,'script-src'),"script-src 'self' https://sdk.najva.com");
    assert.doesNotMatch(worker,/nonce-|unsafe-inline|unsafe-eval|strict-dynamic/);
    for(const origin of ['https://najva.com.attacker.invalid','https://sdk.najva.com/unsafe','http://sdk.najva.com',"https://sdk.najva.com; script-src *"]){
      assert.doesNotMatch(policies.contentSecurityPolicy({...environment,NAJVA_SCRIPT_ORIGINS:origin},true,'A'.repeat(32)),/najva\.com|attacker\.invalid/);
    }
    assert.throws(()=>policies.contentSecurityPolicy({},false,"bad'; script-src *"),/Invalid document security nonce/);
    assert.match(directive(policies.contentSecurityPolicy({NODE_ENV:'development'},false,'A'.repeat(32)),'script-src'),/unsafe-eval/);
    for(const mode of ['production','test',undefined])assert.doesNotMatch(directive(policies.contentSecurityPolicy({NODE_ENV:mode},false,'A'.repeat(32)),'script-src'),/unsafe-eval/);
  }finally{delete environment.NAJVA_SCRIPT_ORIGINS;delete environment.NAJVA_CONNECT_ORIGINS;}
});

test('a preview policy, privacy headers, cookies and body survive the final API response boundary',async()=>{
  const policy="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'none'; sandbox";
  const headers=new Headers({'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':policy,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});
  headers.append('Set-Cookie','first=one; HttpOnly; SameSite=Strict');headers.append('Set-Cookie','second=two; HttpOnly; SameSite=Strict');
  const response=withApiSecurityHeaders(new Response('<p>Read-only preview</p>',{headers}));
  assert.equal(response.headers.get('Content-Security-Policy'),policy);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.deepEqual(response.headers.getSetCookie(),headers.getSetCookie());
  assert.equal(await response.text(),'<p>Read-only preview</p>');
});

test('unadorned API responses receive a closed policy without changing status or JSON',async()=>{
  const response=withApiSecurityHeaders(Response.json({code:'CONFLICT'},{status:409}));
  assert.equal(response.status,409);assert.equal(response.headers.get('Content-Security-Policy'),DEFAULT_API_CONTENT_SECURITY_POLICY);
  assert.deepEqual(await response.json(),{code:'CONFLICT'});
  const empty=withApiSecurityHeaders(new Response(null,{status:204}));assert.equal(empty.status,204);assert.equal(await empty.text(),'');
});

test('literal percent titles use a static fallback while keeping their authoritative original path',async()=>{
  const path='/pages/30/'+encodeURIComponent('اسید-اچ-37')+'%-'+encodeURIComponent('دنتکس');
  const response=await exports.proxy(request(path+'?ref=recorded'));
  assert.equal(response.status,200);assert.equal(response.headers.get('Location'),null);
  const rewrite=new URL(response.headers.get('x-middleware-rewrite'));
  assert.equal(rewrite.pathname,'/pages');assert.equal(rewrite.search,'?ref=recorded');
  assert.equal(response.headers.get('x-middleware-request-x-idealmakoo-path'),path);
  assert.equal((await exports.proxy(request(path.replace('%-','%25-')))).headers.get('x-middleware-rewrite'),null,'Already encoded titles retain their normal dynamic route');
  const forged=await exports.proxy(request('/pages',{headers:{'x-idealmakoo-path':path}}));
  assert.equal(forged.headers.get('x-middleware-request-x-idealmakoo-path'),'/pages');
});

test('malformed UTF-8 and encoded path separators fail before dynamic routing',async()=>{
  for(const path of ['/pages/30/%E0%A4%A','/en/%','/en/%FF/','/pages/30/a%2Fb','/pages/30/a%5Cb','/en/a%00b']){
    const response=await exports.proxy(request(path));assert.equal(response.status,404,path);assert.equal(response.headers.get('x-middleware-rewrite'),null,path);
  }
});

test('canonicalization preserves queries and private mutations remain unredirected with an authoritative path header',async()=>{
  const canonical=await exports.proxy(request('/en/products?view=list'));
  assert.equal(canonical.status,308);assert.equal(new URL(canonical.headers.get('Location'),'https://factory.example').href,'https://factory.example/en/products/?view=list');
  const path='/api/v1/surveys/forms/'+'a'.repeat(64),response=await exports.proxy(request(path,{method:'POST',headers:{'x-idealmakoo-path':'/en/'}}));
  assert.equal(response.headers.get('Location'),null);assert.equal(response.headers.get('x-middleware-request-x-idealmakoo-path'),path);
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.match(response.headers.get('Cache-Control'),/no-store/);
  assert.match(response.headers.get('X-Robots-Tag'),/noindex/);
});

test('controlled document pages and their canonical redirects cannot cache or disclose a referring document path',async()=>{
  for(const locale of ['fa','en','tr','ar','ru'])for(const suffix of ['', '/']){
    const response=await exports.proxy(request(`/${locale}/resources/independently-reviewed${suffix}`));
    assert.equal(response.status,suffix?200:308);
    assert.match(response.headers.get('Cache-Control'),/private, no-store/);
    assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
    assert.equal(response.headers.get('X-Robots-Tag'),null,'The authorized metadata resolver decides public indexing; the path alone grants no access.');
  }
});


test('early missing pages keep the original authority and trusted path while enforcing private error headers',async()=>{
  missingPreflight=true;preflightCalls.length=0;
  // Next's compiler emits this runtime setting for skipProxyUrlNormalize:true.
  // Direct NextRequest construction does not load next.config on its own.
  const priorNormalization=process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
  process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE='1';
  try{
    for(const origin of ['https://factory.example','http://127.0.0.1:3094']){
      const path='/en/absent/';
      const response=await exports.proxy(new next.NextRequest(origin+path,{headers:{'x-idealmakoo-path':'/fa/','x-nonce':'forged','Content-Security-Policy':"script-src *"}}));
      const rewritten=new URL(response.headers.get('x-middleware-rewrite'));
      assert.equal(rewritten.origin,origin);assert.equal(rewritten.pathname,'/_not-found');
      assert.equal(response.headers.get('x-middleware-request-x-idealmakoo-path'),path);
      assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
      assert.match(response.headers.get('Cache-Control'),/private, no-store/);
      assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow, noarchive');
      assert.doesNotMatch(response.headers.get('Content-Security-Policy'),/forged|script-src \*/);
      assert.equal(response.headers.get('Content-Security-Policy'),response.headers.get('x-middleware-request-content-security-policy'));
    }
    assert.equal(preflightCalls.length,2);
    await exports.proxy(request('/en/absent/',{method:'POST'}));
    await exports.proxy(request('/api/v1/health/ready'));
    await exports.proxy(request('/pages/30/historical-title/'));
    assert.equal(preflightCalls.length,2,'Mutations, API routes and historical redirects cannot enter the public page preflight');
  }finally{
    missingPreflight=false;preflightCalls.length=0;
    if(priorNormalization===undefined)delete process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
    else process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE=priorNormalization;
  }
});
