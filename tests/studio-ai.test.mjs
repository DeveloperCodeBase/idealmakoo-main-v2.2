import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const studio=await loadTs('src/components/workspace/studio-ai.ts');
const {products}=await loadTs('src/data/catalog.ts');
const product=products[0];
const locales=['fa','en','tr','ar','ru'];
const storedImage={url:'/api/ai/media/01234567-89ab-4cde-8fab-0123456789ab.png',mimeType:'image/png',bytes:4096};
const base={id:'AI-test',mode:'text',locale:'fa',productId:product.id,prompt:'معرفی محصول برای لابراتوار',createdAt:'2026-10-17T12:00:00.000Z',authorId:'editor-1'};
const response={id:'provider-response',text:'پیش‌نویس محصول برای بازبینی [1]',provider:'Google AI',model:'gemini-test',tokens:81,sources:[{id:'source-1',number:1,title:'Ideal Makoo product',url:'/fa/products/',kind:'product',sourceUrl:'https://idealmakoo.com/'}]};

test('all seven studio modes build real server payloads in all five output languages',()=>{
 for(const locale of locales)for(const mode of studio.studioModes){
  const request=studio.buildStudioRequest({mode,locale,brief:'  Product introduction  ',product,audience:'Laboratory',tone:'Educational',sourceText:'Exact source paragraph'});
  assert.equal(request.mode,mode);assert.equal(request.locale,locale);
  assert.ok(request.prompt.startsWith('Product introduction\n'));
  assert.ok(request.prompt.includes(`Output language: ${locale}`));
  assert.ok(request.context.includes('Exact source paragraph'));assert.ok(request.context.includes(product.id));assert.ok(request.context.includes(product.sourceUrl));
  assert.equal(request.history,undefined);
  if(mode==='video')assert.ok(request.prompt.includes('storyboard/script'));
  if(mode==='audio')assert.ok(request.prompt.includes('narration script'));
 }
});

test('editorial source and product context remain bounded below gateway limits',()=>{
 const request=studio.buildStudioRequest({mode:'rewrite',locale:'ru',brief:'x'.repeat(20000),sourceText:'s'.repeat(30000),product:{...product,description:{...product.description,fa:'d'.repeat(30000)}},audience:'Laboratory',tone:'Professional'});
 assert.ok(request.prompt.length<10000);assert.ok(request.context.length<18000);
 assert.equal(request.prompt.match(/^x+/)[0].length,8000);
 assert.equal(request.context.match(/s{100,}/)[0].length,8000);
});

test('image requests prefer uploaded references; non-image modes never include an image payload',()=>{
 const imageData={mimeType:'image/png',data:'iVBORw0KGgo='};
 const options={mode:'image',locale:'en',brief:'Edit the background',product,audience:'Distributor',tone:'Professional',referenceImage:'/media/products/reference.png',imageData};
 assert.deepEqual(studio.buildStudioRequest(options).imageData,imageData);
 assert.equal(studio.buildStudioRequest(options).referenceImage,undefined);
 assert.equal(studio.buildStudioRequest({...options,imageData:undefined}).referenceImage,options.referenceImage);
 assert.equal(studio.buildStudioRequest({...options,imageData:undefined,referenceImage:'https://example.com/image.png'}).referenceImage,undefined);
 for(const mode of studio.studioModes.filter(mode=>mode!=='image')){
  const request=studio.buildStudioRequest({...options,mode});assert.equal(request.imageData,undefined);assert.equal(request.referenceImage,undefined);
 }
});

test('product references allow only supported local media paths without traversal',()=>{
 for(const path of ['/media/a.png','/media/products/model-2.JPEG','/media/products/teeth.webp'])assert.equal(studio.productReferenceImage(path),path);
 for(const path of ['//example.com/a.png','https://idealmakoo.com/a.png','/media/../secret.png','/media/%2e%2e/secret.png','/media/a.svg','/media/a.png?token=x','/media/a\\b.png','/other/a.png',null])assert.equal(studio.productReferenceImage(path),undefined);
});

test('reference upload validation checks MIME, magic bytes and exact size bounds',()=>{
 const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
 const jpeg=new Uint8Array([255,216,255,224,0,0,0,0,0,0,0,0]);
 const webp=new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80]);
 for(const [mime,head] of [['image/png',png],['image/jpeg',jpeg],['image/webp',webp]]){
  assert.equal(studio.validStudioReference(mime,12,head),true);
  assert.equal(studio.validStudioReference(mime,studio.REFERENCE_LIMIT,head),true);
  for(const size of [0,11,12.5,studio.REFERENCE_LIMIT+1,NaN,Infinity])assert.equal(studio.validStudioReference(mime,size,head),false);
 }
 assert.equal(studio.validStudioReference('image/png',100,jpeg),false);
 assert.equal(studio.validStudioReference('image/svg+xml',100,png),false);
 assert.equal(studio.validStudioReference('image/png',100,new Uint8Array()),false);
});

test('reference data rejects malformed base64, unsupported types and oversized payloads',()=>{
 assert.deepEqual(studio.studioImageData('data:image/png;base64,iVBORw0KGgo='),{mimeType:'image/png',data:'iVBORw0KGgo='});
 assert.ok(studio.studioImageData('data:image/webp;base64,AAAA\nAAAA'));
 for(const value of ['data:image/png;base64,====','data:image/png;base64,A=AA','data:image/png;base64,AAA','data:image/png;base64,\n\r','data:image/png;base64,','data:image/svg+xml;base64,AAAA','https://example.com/a.png','data:image/png;base64,'+'A'.repeat(5600004),null])assert.equal(studio.studioImageData(value),undefined);
});

test('generated previews accept actual server assets and reject source photos or conflicting metadata',()=>{
 assert.deepEqual(studio.generatedStudioImage(storedImage),storedImage);
 const privateId='01234567-89ab-4cde-8fab-0123456789ab';
 for(const url of [`/api/v1/attachments/${privateId}`,`/api/v1/attachments/${privateId}/`,`/api/v1/media/${privateId}/content`]){
  const privateImage={url,mimeType:'image/webp',bytes:4096};assert.deepEqual(studio.generatedStudioImage(privateImage),privateImage);
 }
 for(const url of [`/api/v1/media/${privateId}`,`/api/v1/attachments/${privateId}/content`,`/api/v1/attachments/${'-'.repeat(36)}`,`/api/v1/attachments/${privateId}?redirect=evil`,`/api/v1/attachments/%2e%2e/${privateId}`])assert.equal(studio.generatedStudioImage({...storedImage,url}),undefined);
 const inline={url:'data:image/png;base64,iVBORw0KGgo=',mimeType:'image/png',bytes:8};
 assert.deepEqual(studio.generatedStudioImage(inline),inline);
 for(const image of [
  {...storedImage,url:product.image},{...storedImage,url:'https://example.com/generated.png'},
  {...storedImage,url:storedImage.url+'?redirect=evil'}, {...storedImage,mimeType:'image/jpeg'},
  {...storedImage,bytes:0},{...storedImage,bytes:1.5},{...storedImage,bytes:12000001},
  {...inline,url:'data:image/png;base64,===='},{...inline,mimeType:'image/webp'},
 ])assert.equal(studio.generatedStudioImage(image),undefined);
});

test('actual provider metadata, actor and references are retained without claiming legacy output was generated',()=>{
 const job=studio.resultStudioJob(response,base);
 assert.equal(job.provider,response.provider);assert.equal(job.model,response.model);assert.equal(job.responseId,response.id);
 assert.equal(job.output,response.text);assert.equal(job.authorId,base.authorId);assert.equal(job.tokens,81);assert.equal(job.status,'ready');assert.deepEqual(job.sources,response.sources);
 const legacy=studio.normalizeStudioJob({...base,mode:'image',output:'Old local storyboard',status:'ready',image:{...storedImage,url:product.image}});
 assert.ok(legacy);assert.equal(legacy.provider,undefined);assert.equal(legacy.image,undefined);
});

test('missing provider results, fake image fallbacks and malformed persisted enum values fail closed',()=>{
 for(const result of [null,{...response,id:' '},{...response,provider:''},{...response,model:' '},{...response,text:''}])assert.equal(studio.resultStudioJob(result,base),null);
 assert.equal(studio.resultStudioJob({...response,text:'Quota reached'},{...base,mode:'image'}),null);
 assert.equal(studio.resultStudioJob({...response,image:{...storedImage,url:product.image}},{...base,mode:'image'}),null);
 const imageJob=studio.resultStudioJob({...response,text:'',image:storedImage},{...base,mode:'image'});
 assert.ok(imageJob);assert.equal(imageJob.output,'');assert.deepEqual(imageJob.image,storedImage);
 for(const patch of [{locale:['fa']},{status:['ready']},{mode:['text']},{locale:'de'},{status:'published'}])assert.equal(studio.normalizeStudioJob({...base,output:'Draft',status:'ready',...patch}),null);
});

test('persisted source links discard executable URLs and unsafe attribution links',()=>{
 const safe={...response.sources[0],sourceUrl:'javascript:alert(1)'};
 const job=studio.normalizeStudioJob({...base,output:'Text',status:'draft',sources:[safe,{...safe,url:'javascript:alert(1)'},{...safe,url:'//example.com'},{...safe,url:'https://name:password@example.com'},{...safe,number:1.5}],tokens:-3});
 assert.equal(job.sources.length,1);assert.equal(job.sources[0].sourceUrl,undefined);assert.equal(job.tokens,null);
 for(const url of ['javascript:alert(1)','data:text/html,hello','/\\example.com','https://','https://example.com/\nnext'])assert.equal(studio.studioLink(url),undefined);
 assert.equal(studio.studioLink('/fa/research/'),'/fa/research/');
});

test('request replacement, stop and unmount cancellation prevent late responses from committing',async()=>{
 const gate=new studio.StudioRequestGate();
 let resolveLate;const delayed=new Promise(resolve=>{resolveLate=resolve;});
 const first=gate.start('editor-1:contentEditor:fa');
 const commit=delayed.then(()=>gate.current(first,'editor-1:contentEditor:fa',true));
 const second=gate.start('editor-1:contentEditor:fa');
 assert.equal(first.controller.signal.aborted,true);assert.equal(gate.current(second,second.actor,true),true);
 gate.finish(first);assert.equal(gate.current(second,second.actor,true),true,'old completion cannot clear the replacement');
 resolveLate();assert.equal(await commit,false);
 gate.cancel();assert.equal(second.controller.signal.aborted,true);assert.equal(gate.current(second,second.actor,true),false);
 const third=gate.start('editor-1:contentEditor:fa');gate.finish(third);assert.equal(gate.current(third,third.actor,true),false);
 gate.cancel();gate.cancel();
});

test('active results cannot cross actor, role, locale or current permission boundaries',()=>{
 const gate=new studio.StudioRequestGate(),ticket=gate.start('editor-1:contentEditor:fa');
 assert.equal(gate.current(ticket,ticket.actor,true),true);
 for(const actor of ['editor-2:contentEditor:fa','editor-1:translator:fa','editor-1:contentEditor:en',''])assert.equal(gate.current(ticket,actor,true),false);
 assert.equal(gate.current(ticket,ticket.actor,false),false);
 ticket.controller.abort();assert.equal(gate.current(ticket,ticket.actor,true),false);
});
