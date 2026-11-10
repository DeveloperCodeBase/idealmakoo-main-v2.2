import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Script,createContext} from 'node:vm';
import {classicServiceWorkerSource,buildServiceWorker} from '../scripts/build-service-worker.mjs';

const [policy,worker]=await Promise.all([readFile(new URL('../public/sw-policy.js',import.meta.url),'utf8'),readFile(new URL('../public/service-worker.js',import.meta.url),'utf8')]);
function envelope({fetch=async()=>new Response('online'),caches={}}={}){
 const handlers=new Map(),self={location:{origin:'https://factory.example'},clients:{claim:async()=>{}},skipWaiting:()=>{},addEventListener:(kind,handler)=>handlers.set(kind,handler)};
 const context=createContext({self,URL,Request,Response,fetch,caches});new Script(classicServiceWorkerSource(policy,worker)).runInContext(context);
 return {handlers,context};
}
test('classic worker preserves private-capability, authorization, range and offline-cache boundaries',async()=>{
 const {handlers,context}=envelope();assert.deepEqual([...handlers.keys()],['install','activate','fetch']);
 assert.equal('PUBLIC_CACHE' in context,false,'provider globals are not polluted');
 for(const path of ['/fa/account/requests/','/api/v1/media/id/content','/fa/saved-share/'+'a'.repeat(64)+'/','/fa/feedback/'+'b'.repeat(64)+'/','/media/official/photo.jpg?token=private','https://other.example/media/official/photo.jpg']){
  let claimed=false;handlers.get('fetch')({request:new Request(new URL(path,'https://factory.example')),respondWith:()=>{claimed=true;}});assert.equal(claimed,false,path);
 }
 for(const headers of [{Authorization:'Bearer fixture'},{Range:'bytes=0-1'}]){
  let claimed=false;handlers.get('fetch')({request:new Request('https://factory.example/media/official/photo.jpg',{headers}),respondWith:()=>{claimed=true;}});assert.equal(claimed,false);
 }
});
test('offline public navigation returns only the static message and never stores a live document',async()=>{
 const writes=[],reads=[];
 const {handlers}=envelope({fetch:async()=>{throw new TypeError('offline');},caches:{match:async(url,options)=>{reads.push([url,options.cacheName]);return new Response('static offline message');},open:async()=>({put:async()=>writes.push('unexpected private write')})}});
 let result;
 handlers.get('fetch')({request:{url:'https://factory.example/tr/products/',method:'GET',mode:'navigate',headers:new Headers()},respondWith:promise=>{result=promise;}});
 assert.equal(await(await result).text(),'static offline message');
 assert.deepEqual(reads,[['https://factory.example/offline/tr.html','idealmakoo-offline-pages-v2']]);assert.deepEqual(writes,[]);
 for(const path of ['/en/account/','/fa/resources/granted-file/','/ar/saved-share/token/','/ru/?token=secret']){
  let claimed=false;handlers.get('fetch')({request:{url:'https://factory.example'+path,method:'GET',mode:'navigate',headers:new Headers()},respondWith:()=>{claimed=true;}});assert.equal(claimed,false,path);
 }
});
test('HTTP errors stay visible online and are not replaced by a successful offline page',async()=>{
 const {handlers}=envelope({fetch:async()=>new Response('unavailable',{status:503}),caches:{match:()=>assert.fail('HTTP errors are not a network exception')}});
 let result;handlers.get('fetch')({request:{url:'https://factory.example/en/about/',method:'GET',mode:'navigate',headers:new Headers()},respondWith:promise=>{result=promise;}});
 assert.equal((await result).status,503);
});
test('installation preloads five public messages and the bundled icon without credentials or live pages',async()=>{
 const requests=[],stored=[],iconUrl='https://factory.example/media/official/idealmakoo-favicon-48.png';
 const icon=await readFile(new URL('../public/media/official/idealmakoo-favicon-48.png',import.meta.url));
 const {handlers}=envelope({fetch:async request=>{requests.push(request);const isIcon=request.url===iconUrl;return new Response(isIcon?icon:'offline',{headers:{'Content-Type':isIcon?'image/png':'text/html; charset=utf-8','X-Public-Cache':'1','Cache-Control':'public, max-age=3600'}});},caches:{open:async name=>({put:async url=>stored.push([name,url])})}});
 let complete;handlers.get('install')({waitUntil:promise=>{complete=promise;}});await complete;
 assert.equal(requests.length,6);assert.equal(stored.length,6);
 for(const request of requests){assert.equal(request.credentials,'omit');assert.equal(request.cache,'reload');assert.ok(request.url===iconUrl||/^https:\/\/factory\.example\/offline\/(fa|en|tr|ar|ru)\.html$/.test(request.url));}
 const messages=stored.filter(([cache])=>cache==='idealmakoo-offline-pages-v2');assert.equal(messages.length,5);
 assert.deepEqual(stored.filter(([cache])=>cache==='idealmakoo-public-assets-v1'),[['idealmakoo-public-assets-v1',iconUrl]]);
 for(const locale of ['fa','en','tr','ar','ru']){
  const html=await readFile(new URL(`../public/offline/${locale}.html`,import.meta.url),'utf8');
  assert.ok(html.includes(`<html lang="${locale}" dir="${['fa','ar'].includes(locale)?'rtl':'ltr'}">`));
  assert.doesNotMatch(html,/<script\b|https?:\/\/|localStorage|sessionStorage/);assert.match(html,/noindex,nofollow,noarchive/);
  assert.ok(html.includes('<link rel="icon" href="/media/official/idealmakoo-favicon-48.png" type="image/png" sizes="48x48">'));
 }
});
test('composed cache stores only explicit public responses and never masks an online private response',async()=>{
 const changes=[],cache={put:async(request)=>changes.push(['put',request.url]),delete:async(request)=>changes.push(['delete',request.url])};
 for(const permitted of [true,false]){
  const {handlers}=envelope({fetch:async()=>new Response('online',{headers:{'X-Public-Cache':'1','Cache-Control':permitted?'public, max-age=60':'private, no-store'}}),caches:{open:async()=>cache}});
  let response;handlers.get('fetch')({request:new Request('https://factory.example/media/official/photo.jpg'),respondWith:promise=>{response=promise;}});assert.equal(await(await response).text(),'online');
 }
 assert.deepEqual(changes.map(item=>item[0]),['put','delete']);
});
test('classic build is deterministic, checks its generated artifact and rejects changed module contracts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'idealmakoo-classic-test-'));
 try{
  await mkdir(join(root,'public'));await Promise.all([writeFile(join(root,'public/sw-policy.js'),policy),writeFile(join(root,'public/service-worker.js'),worker)]);
  const first=await buildServiceWorker(root);assert.equal(first.checked,false);const written=await readFile(join(root,'public/service-worker-classic.js'),'utf8');
  await buildServiceWorker(root);assert.equal(await readFile(join(root,'public/service-worker-classic.js'),'utf8'),written);assert.equal((await buildServiceWorker(root,{check:true})).checked,true);
  await writeFile(join(root,'public/service-worker-classic.js'),'stale');await assert.rejects(buildServiceWorker(root,{check:true}),/stale/);
  assert.throws(()=>classicServiceWorkerSource(policy,worker.replace('./sw-policy.js','./unexpected.js')),/dependency changed/);
  assert.throws(()=>classicServiceWorkerSource(policy+'\nexport const unexpected = 1;\n',worker),SyntaxError);
 }finally{await rm(root,{recursive:true,force:true});}
});
