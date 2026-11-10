import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {handleAi,parseAiInput,normalizeQuery,retrieveKnowledge,aiSystemPrompt}=await loadTs('worker/ai-handler.ts');
const {createKnowledge}=await loadTs('worker/knowledge.ts');
const {products}=await loadTs('src/data/catalog.ts');
const knowledge=createKnowledge();
const env={GOOGLE_AI_API_KEY:'test-secret-never-returned',GOOGLE_AI_TEXT_MODEL:'gemini-3.5-flash-lite',GOOGLE_AI_IMAGE_MODEL:'gemini-nano-banana-2.1'};
const request=(body={},extra={})=>new Request('https://ideal.test/api/ai/'+(body.mode==='chat'?'chat':'generate'),{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://ideal.test','oai-authenticated-user-id':crypto.randomUUID(),...extra},body:JSON.stringify({locale:'fa',prompt:'محصولات اپل و کاتالوگ',...body})});
const response=parts=>new Response(JSON.stringify({candidates:[{content:{parts},finishReason:'STOP'}],usageMetadata:{totalTokenCount:19}}),{headers:{'Content-Type':'application/json'}});

test('all five locales accept supported AI actions and reject malformed, over-budget or executable media inputs',()=>{
 for(const locale of ['fa','en','tr','ar','ru'])for(const mode of ['chat','text','rewrite','translation','document','image','audio','video'])assert.ok(parseAiInput({locale,mode,prompt:'hello'}));
 for(const body of [null,[],{}, {locale:'de',prompt:'x'},{locale:'fa',prompt:' '},{locale:'fa',prompt:'x'.repeat(10001)},{locale:'fa',mode:'run-shell',prompt:'x'},{locale:'fa',prompt:'x',history:[{role:'system',text:'x'}]},{locale:'fa',prompt:'x',history:Array.from({length:17},()=>({role:'user',text:'x'}))},{locale:'fa',prompt:'x',history:Array.from({length:5},()=>({role:'user',text:'x'.repeat(7500)}))},{locale:'fa',prompt:'x',imageData:{mimeType:'image/svg+xml',data:'AAAA'}},{locale:'fa',prompt:'x',imageData:{mimeType:'image/png',data:'not_base64!'}}])assert.equal(parseAiInput(body),null);
 for(const referenceImage of ['https://elsewhere.test/a.png','//evil.test/a.png','/media/../private/a.png','/media/a.svg','/api/secret.png'])assert.equal(parseAiInput({locale:'fa',prompt:'x',referenceImage}),null);
 assert.ok(parseAiInput({locale:'fa',prompt:'x',referenceImage:'/media/official/a.jpg'}));
});
test('knowledge includes all official pages, product families, PDF sections and navigation without invented PDF cells',()=>{
 assert.equal(knowledge.filter(k=>k.kind==='product').length,17);assert.equal(knowledge.filter(k=>k.kind==='research').length,13);
 assert.equal(knowledge.filter(k=>k.kind.startsWith('official-')).length,43);assert.equal(knowledge.filter(k=>k.kind==='pdf').length,2);assert.equal(knowledge.filter(k=>k.kind==='pdf-section').length,40);
 assert.ok(knowledge.some(k=>k.id==='site-navigation'&&k.text.includes('/resources/')));
 const result=retrieveKnowledge('APPLE اپل',knowledge);assert.ok(result.some(k=>k.id==='product-apple'));
 assert.equal(normalizeQuery('ايده‌آل ماكو'),normalizeQuery('ایده آل ماکو'));
});
test('generic product questions in all five languages prioritize the complete product index over PDF mould sections',()=>{
 const index=knowledge.find(entry=>entry.id==='product-index');assert.ok(index);assert.equal(products.length,17);
 for(const product of products){
  assert.ok(index.text.includes(`/products/${product.slug}/`),`Product index includes the canonical route for ${product.id}`);
  for(const locale of ['fa','en','tr','ar','ru'])assert.ok(index.text.includes(product.name[locale]),`Product index includes ${product.id} in ${locale}`);
 }
 for(const query of [
  'دو نمونه از محصولات ایده‌آل ماکو را معرفی کن و کاتالوگ آن‌ها را بده',
  'Give two examples of Ideal Makoo products and their catalogs',
  'Ideal Makoo ürünlerinden iki örnek ve kataloglarını göster',
  'اذكر مثالين من منتجات إيديال ماكو مع الكتالوجات',
  'Назовите два продукта Ideal Makoo и их каталоги',
 ]){
  const result=retrieveKnowledge(query,knowledge);assert.equal(result.length,12);assert.equal(result[0].id,'product-index');
  assert.equal(result.filter(entry=>entry.id==='product-index').length,1);
 }
});
test('source instructions distinguish company evidence from general answers and forbid invented stock/measurements',()=>{
 const prompt=aiSystemPrompt(parseAiInput({locale:'ru',mode:'video',prompt:'a film'}),knowledge.slice(0,2));assert.match(prompt,/general questions/);assert.match(prompt,/Never invent company prices/);assert.match(prompt,/video storyboard\/script, not a rendered video/);assert.match(prompt,/untrusted data/);assert.match(prompt,/Answer in ru/);
});
test('status exposes configuration state, never the API key and never calls Google',async()=>{
 const result=await handleAi(new Request('https://ideal.test/api/ai/status'),env,knowledge,()=>assert.fail('no upstream status call'));
 const body=await result.text();assert.equal(result.status,200);assert.equal(JSON.parse(body).configured,true);assert.equal(body.includes(env.GOOGLE_AI_API_KEY),false);
 assert.equal((await handleAi(new Request('https://ideal.test/fa/'),env,knowledge)),null);
});
test('same-origin gateway rejects cross-origin, non-JSON and wrong-method requests before the upstream call',async()=>{
 const blocked=()=>assert.fail('upstream must not run');
 assert.equal((await handleAi(request({}, {Origin:'https://evil.test'}),env,knowledge,blocked)).status,403);
 assert.equal((await handleAi(request({}, {'Sec-Fetch-Site':'cross-site'}),env,knowledge,blocked)).status,403);
 assert.equal((await handleAi(request({}, {'Content-Type':'text/plain'}),env,knowledge,blocked)).status,415);
 assert.equal((await handleAi(new Request('https://ideal.test/api/ai/chat'),env,knowledge,blocked)).status,405);
 assert.equal((await handleAi(request(),{},knowledge,blocked)).status,503);
});
test('actual gateway sends the key only in the official provider header and passes multilingual history and source context',async()=>{
 let upstream;const output=await handleAi(request({mode:'chat',locale:'tr',prompt:'APPLE nedir?',history:[{role:'user',text:'Hello'},{role:'model',text:'Welcome'}]}),env,knowledge,async(url,init)=>{upstream={url,init,body:JSON.parse(init.body)};return response([{text:'Ürün açıklaması [1]'}]);});
 const data=await output.json();assert.equal(output.status,200);assert.equal(data.provider,'Google AI');assert.equal(data.text,'Ürün açıklaması [1]');assert.equal(data.tokens,19);assert.ok(data.sources.length>0);
 assert.equal(new URL(upstream.url).hostname,'generativelanguage.googleapis.com');assert.equal(upstream.init.redirect,'manual');assert.equal(upstream.init.headers['x-goog-api-key'],env.GOOGLE_AI_API_KEY);assert.equal(upstream.url.includes(env.GOOGLE_AI_API_KEY),false);assert.equal(JSON.stringify(upstream.body).includes(env.GOOGLE_AI_API_KEY),false);assert.equal(JSON.stringify(data).includes(env.GOOGLE_AI_API_KEY),false);
 assert.equal(upstream.body.contents.length,3);assert.equal(upstream.body.contents[1].role,'model');assert.match(upstream.body.systemInstruction.parts[0].text,/Answer in tr/);
});
test('default upstream adapter preserves the global fetch receiver without an injected fetcher',{concurrency:false},async()=>{
 const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async function(url,init){
  if(this!==globalThis)throw new TypeError('Incorrect fetch receiver');
  calls++;assert.equal(new URL(url).hostname,'generativelanguage.googleapis.com');assert.equal(init.method,'POST');
  return response([{text:'Receiver-safe provider response [1]'}]);
 };
 try{
  const result=await handleAi(request({mode:'chat'}),env,knowledge);
  assert.equal(result.status,200);assert.equal(calls,1);
  const body=await result.json();assert.equal(body.text,'Receiver-safe provider response [1]');assert.equal(body.provider,'Google AI');
 }finally{globalThis.fetch=originalFetch;}
});
test('upstream auth, quota, model and invalid request bodies are redacted into actionable error codes',async()=>{
 for(const [status,code]of [[403,'PROVIDER_AUTH'],[429,'QUOTA'],[404,'MODEL_UNAVAILABLE'],[400,'INVALID_PROVIDER_REQUEST'],[500,'PROVIDER_UNAVAILABLE']]){
  const result=await handleAi(request(),env,knowledge,async()=>new Response(JSON.stringify({message:env.GOOGLE_AI_API_KEY}),{status}));const body=await result.text();assert.equal(JSON.parse(body).error.code,code);assert.equal(body.includes(env.GOOGLE_AI_API_KEY),false);assert.equal(result.headers.get('Cache-Control'),'no-store');
 }
});
test('provider redirect is rejected after one manual request and never follows an unrelated location',async()=>{
 const calls=[];
 const result=await handleAi(request({mode:'chat'}),env,knowledge,async(url,init)=>{
  calls.push({url,redirect:init.redirect});
  return new Response(null,{status:302,headers:{Location:'https://other.test/collect'}});
 });
 assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).hostname,'generativelanguage.googleapis.com');assert.equal(calls[0].redirect,'manual');assert.equal(result.status,502);
 assert.equal(result.headers.get('Location'),null);
 assert.deepEqual(await result.json(),{error:{code:'PROVIDER_UNAVAILABLE'}});
});
test('image edit uses validated reference bytes and stores only the real provider image with owner scope',async()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=';let stored,parts;const actor='image-test-owner';
 const imageEnv={...env,ASSETS:{fetch:async req=>{assert.equal(new URL(req.url).pathname,'/media/official/reference.png');return new Response(Buffer.from(png,'base64'),{headers:{'Content-Type':'image/png'}});}},BUCKET:{put:async(key,bytes,options)=>{stored={key,bytes,options};},get:async()=>({body:new Blob([stored.bytes]).stream(),...stored.options})}};
 const result=await handleAi(request({mode:'image',referenceImage:'/media/official/reference.png'},{'oai-authenticated-user-id':actor}),imageEnv,knowledge,async(_,init)=>{const body=JSON.parse(init.body);parts=body.contents.at(-1).parts;assert.deepEqual(body.generationConfig.responseModalities,['TEXT','IMAGE']);return response([{text:'Done'},{inlineData:{mimeType:'image/png',data:png}}]);});
 const data=await result.json();assert.equal(result.status,200);assert.equal(parts[1].inlineData.data,png);assert.match(data.image.url,/^\/api\/ai\/media\//);assert.equal(data.image.bytes,Buffer.from(png,'base64').length);assert.equal(stored.options.customMetadata.owner,actor);
 const own=await handleAi(new Request('https://ideal.test'+data.image.url,{headers:{'oai-authenticated-user-id':actor}}),imageEnv,knowledge);assert.equal(own.status,200);assert.deepEqual(Buffer.from(await own.arrayBuffer()),Buffer.from(png,'base64'));
 const other=await handleAi(new Request('https://ideal.test'+data.image.url,{headers:{'oai-authenticated-user-id':'other-owner'}}),imageEnv,knowledge);assert.equal(other.status,403);
});
test('blocked, empty and text-only image responses never become a fabricated successful image',async()=>{
 const text=await handleAi(request({mode:'image'}),env,knowledge,async()=>response([{text:'I cannot produce this image.'}]));assert.equal((await text.json()).error.code,'NO_IMAGE');
 const empty=await handleAi(request(),env,knowledge,async()=>response([]));assert.equal((await empty.json()).error.code,'EMPTY_RESPONSE');
 const blocked=await handleAi(request(),env,knowledge,async()=>new Response(JSON.stringify({promptFeedback:{blockReason:'SAFETY'}})));assert.equal((await blocked.json()).error.code,'BLOCKED');
});
test('two in-flight requests cap concurrency and incoming abort releases the actor slot',{timeout:5000},async()=>{
 const actor='limited-owner';const holds=[];const pending=(_,init)=>new Promise((resolve,reject)=>{holds.push(resolve);init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
 const controller=new AbortController();const first=request({}, {'oai-authenticated-user-id':actor});const one=handleAi(new Request(first,{signal:controller.signal}),env,knowledge,pending);const two=handleAi(request({}, {'oai-authenticated-user-id':actor}),env,knowledge,pending);
 await new Promise(resolve=>setTimeout(resolve,10));const third=await handleAi(request({}, {'oai-authenticated-user-id':actor}),env,knowledge,pending);assert.equal(third.status,429);assert.equal(third.headers.get('Retry-After'),'20');
 controller.abort();assert.equal((await one).status,504);holds.forEach(resolve=>resolve(response([{text:'ok'}])));assert.equal((await two).status,200);
 const again=await handleAi(request({}, {'oai-authenticated-user-id':actor}),env,knowledge,async()=>response([{text:'ok'}]));assert.equal(again.status,200);
});
