import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const {createHeroInputMailbox, validHeroInput, validHeroRectangle} = await loadTs('src/components/experience/engines/hero-worker-protocol.ts');
const {createHeroWorker, wasHeroCanvasTransferred} = await loadTs('src/components/experience/engines/hero-worker-host.ts');
const turn = () => new Promise(resolve => setImmediate(resolve));
const pointer = (type, timeStamp, extra = {}) => ({type,timeStamp,pointerId:1,button:0,isPrimary:true,clientX:100,clientY:200,...extra});

test('scene input preserves pointer boundaries and original timestamps while coalescing pending movement', () => {
  const batches = [], mailbox = createHeroInputMailbox((sequence,events,cancel) => batches.push({sequence,events,cancel}));
  mailbox.enqueue(pointer('pointerdown',10.25));
  for(let i=0;i<1000;i++)mailbox.enqueue(pointer('pointermove',20+i,{clientX:i}));
  mailbox.enqueue(pointer('pointerup',1021.75));
  assert.equal(batches.length,1);assert.equal(mailbox.getState().pending,2);
  mailbox.acknowledge(9000);assert.equal(batches.length,1,'unrelated acknowledgements cannot release the queue');
  mailbox.acknowledge(1);assert.equal(batches.length,2);
  assert.deepEqual(batches[1].events,[pointer('pointermove',1019,{clientX:999}),pointer('pointerup',1021.75)]);
  assert.equal(batches[0].events[0].timeStamp,10.25);
});

test('input flood remains bounded and explicitly cancels a grab rather than stranding it', () => {
  const batches=[],mailbox=createHeroInputMailbox((sequence,events,cancel)=>batches.push({sequence,events,cancel}),8);
  mailbox.enqueue(pointer('pointerdown',1));
  for(let i=0;i<20;i++)mailbox.enqueue({type:'keydown',key:'ArrowUp',shiftKey:false,timeStamp:i+2});
  assert.ok(mailbox.getState().pending<=8);assert.equal(mailbox.getState().cancelled,true);
  mailbox.acknowledge(1);assert.equal(batches[1].cancel,true);assert.ok(batches[1].events.length<=8);
  mailbox.dispose();mailbox.enqueue(pointer('pointerup',30));mailbox.acknowledge(2);assert.equal(batches.length,2);
});

test('malformed scene coordinates, timestamps, keys and input kinds are rejected', () => {
  assert.equal(validHeroRectangle({left:0,top:20,width:390,height:838}),true);
  for(const value of [null,{}, {left:0,top:0,width:-1,height:20},{left:Infinity,top:0,width:20,height:20}])assert.equal(validHeroRectangle(value),false);
  assert.equal(validHeroInput(pointer('pointerdown',10)),true);
  for(const value of [pointer('pointerdown',NaN),pointer('pointerdown',1,{clientX:Infinity}),pointer('eval',1),{type:'keydown',timeStamp:1,key:'x',shiftKey:false},{type:'keydown',timeStamp:1,key:'ArrowUp',shiftKey:'yes'}])assert.equal(validHeroInput(value),false);
});

class FakeCanvas extends EventTarget {
  style={};captures=new Set();transfers=0;focusCalls=0;
  getBoundingClientRect(){return {left:10,top:20,width:390,height:838};}
  transferControlToOffscreen(){if(this.transfers)throw Error('Canvas transferred twice');this.transfers++;return {testOffscreenCanvas:true};}
  focus(){this.focusCalls++;}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
}
class FakeWorker extends EventTarget {
  messages=[];terminations=0;autoCapabilities=true;autoReady=true;throwInit=false;
  postMessage(message){
    this.messages.push(structuredClone(message));
    if(message.type==='probe'&&this.autoCapabilities)queueMicrotask(()=>this.reply({type:'capabilities',supported:true}));
    if(message.type==='init'){
      if(this.throwInit)throw Error('Cannot post transferred canvas');
      if(this.autoReady)queueMicrotask(()=>this.reply({type:'ready'}));
    }
  }
  terminate(){this.terminations++;}
  reply(value){const event=new Event('message');Object.defineProperty(event,'data',{value:{generation:this.messages[0].generation,...value}});this.dispatchEvent(event);}
}
function fixture(t,configure=()=>{}){
  const originals=new Map();
  const set=(key,value)=>{originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
  const windowTarget=Object.assign(new EventTarget(),{devicePixelRatio:2});
  const observers=[];
  set('window',windowTarget);set('HTMLCanvasElement',FakeCanvas);
  set('ResizeObserver',class{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}});
  const canvas=new FakeCanvas(),worker=new FakeWorker(),agent={style:{opacity:'0',transform:''},dataset:{phase:'idle',mode:'arrow'}};
  let errors=0,controller;
  configure(worker);
  const start=(extra={})=>createHeroWorker(canvas,{theme:'dark',locale:'fa',composition:'landing',agentElement:agent,workerFactory:()=>worker,onError:()=>errors++,timeoutMs:1000,...extra}).then(value=>(controller=value));
  t.after(()=>{controller?.dispose();for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  return {canvas,worker,agent,start,observers,window:windowTarget,get errors(){return errors;}};
}
function dispatch(canvas,input){const event=new Event(input.type,{cancelable:true});for(const[key,value]of Object.entries(input))if(key!=='type')Object.defineProperty(event,key,{value});canvas.dispatchEvent(event);return event;}

test('capabilities are checked before transfer; the native canvas is transferred exactly once',async t=>{
  const f=fixture(t,worker=>{worker.autoCapabilities=false;});const pending=f.start();
  assert.equal(f.canvas.transfers,0);assert.equal(f.worker.messages[0].type,'probe');
  f.worker.reply({type:'capabilities',supported:true});const controller=await pending;
  assert.equal(f.canvas.transfers,1);assert.equal(wasHeroCanvasTransferred(f.canvas),true);
  f.worker.reply({type:'capabilities',supported:true});assert.equal(f.canvas.transfers,1);
  assert.equal(typeof controller.update,'undefined','the worker owns its frame clock; host RAF cannot enqueue renders');
});

test('unsupported workers leave the canvas untouched and terminate their owned worker',async t=>{
  const f=fixture(t,worker=>{worker.autoCapabilities=false;});const pending=f.start();
  f.worker.reply({type:'capabilities',supported:false});await assert.rejects(pending,/could not be initialized/);
  assert.equal(f.canvas.transfers,0);assert.equal(f.worker.terminations,1);assert.equal(f.errors,0);
});

test('abort before transfer rejects initialization and late capability replies cannot consume the canvas',async t=>{
  const f=fixture(t,worker=>{worker.autoCapabilities=false;}),abort=new AbortController(),pending=f.start({signal:abort.signal});
  abort.abort();await assert.rejects(pending,{name:'AbortError'});f.worker.reply({type:'capabilities',supported:true});
  assert.equal(f.canvas.transfers,0);assert.equal(f.worker.terminations,1);
});

test('abort after transfer requires a fresh canvas and prevents late ready callbacks',async t=>{
  const f=fixture(t,worker=>{worker.autoReady=false;}),abort=new AbortController(),pending=f.start({signal:abort.signal});
  await turn();assert.equal(f.canvas.transfers,1);abort.abort();await assert.rejects(pending,{name:'AbortError'});
  f.worker.reply({type:'ready'});assert.equal(f.worker.terminations,1);
  let allocations=0;
  await assert.rejects(createHeroWorker(f.canvas,{workerFactory:()=>{allocations++;return new FakeWorker();},onError(){}}),/fresh React canvas/);
  assert.equal(allocations,0,'effect replay cannot initialize the previously transferred DOM canvas');
});

test('post-transfer message failure terminates the worker and marks the consumed canvas for React replacement',async t=>{
  const f=fixture(t,worker=>{worker.throwInit=true;});await assert.rejects(f.start(),/could not be initialized/);
  assert.equal(f.canvas.transfers,1);assert.equal(wasHeroCanvasTransferred(f.canvas),true);assert.equal(f.worker.terminations,1);
});

test('startup timeout closes the worker; late ready and error events cannot restart it',async t=>{
  const f=fixture(t,worker=>{worker.autoReady=false;});await assert.rejects(f.start({timeoutMs:10}),/could not be initialized/);
  f.worker.reply({type:'ready'});f.worker.reply({type:'error'});assert.equal(f.worker.terminations,1);assert.equal(f.errors,0);
});

test('pointer focus, capture and default prevention stay synchronous and preserve release timestamps',async t=>{
  const f=fixture(t),controller=await f.start();controller.setVisible(true);
  const down=dispatch(f.canvas,pointer('pointerdown',18.125));
  assert.equal(down.defaultPrevented,true);assert.equal(f.canvas.focusCalls,1);assert.equal(f.canvas.hasPointerCapture(1),true);
  dispatch(f.canvas,pointer('pointermove',33.25,{clientX:140}));dispatch(f.canvas,pointer('pointerup',44.875,{clientX:145}));
  assert.equal(f.canvas.hasPointerCapture(1),false);
  const first=f.worker.messages.find(value=>value.type==='input');assert.equal(first.events[0].timeStamp,18.125);
  f.worker.reply({type:'input-ack',sequence:first.sequence});
  const next=f.worker.messages.filter(value=>value.type==='input').at(-1);
  assert.deepEqual(next.events.map(value=>value.type),['pointermove','pointerup']);assert.equal(next.events.at(-1).timeStamp,44.875);
  assert.deepEqual(next.rectangle,{left:10,top:20,width:390,height:838});
});

test('keyboard behavior preserves native Escape and forwards the original supported action only',async t=>{
  const f=fixture(t),controller=await f.start();controller.setVisible(true);
  const escape=dispatch(f.canvas,{type:'keydown',key:'Escape',shiftKey:false,timeStamp:10});assert.equal(escape.defaultPrevented,false);
  const up=dispatch(f.canvas,{type:'keydown',key:'ArrowUp',shiftKey:true,timeStamp:11});assert.equal(up.defaultPrevented,true);
  const unrelated=dispatch(f.canvas,{type:'keydown',key:'a',shiftKey:false,timeStamp:12});assert.equal(unrelated.defaultPrevented,false);
  const first=f.worker.messages.find(value=>value.type==='input');f.worker.reply({type:'input-ack',sequence:first.sequence});
  assert.deepEqual(f.worker.messages.filter(value=>value.type==='input').flatMap(value=>value.events.map(event=>event.key)),['Escape','ArrowUp']);
});

test('pending pointer input keeps the rectangle from its original dispatch even if the page scrolls before delivery',async t=>{
  const f=fixture(t),controller=await f.start();controller.setVisible(true);
  dispatch(f.canvas,pointer('pointerdown',10));
  f.canvas.getBoundingClientRect=()=>({left:10,top:-120,width:390,height:838});
  dispatch(f.canvas,pointer('pointermove',20,{clientY:180}));
  f.canvas.getBoundingClientRect=()=>({left:10,top:-420,width:390,height:838});
  dispatch(f.canvas,pointer('pointerup',30,{clientY:170}));
  const first=f.worker.messages.find(value=>value.type==='input');f.worker.reply({type:'input-ack',sequence:first.sequence});
  const next=f.worker.messages.filter(value=>value.type==='input').at(-1);
  assert.deepEqual(next.events.map(event=>event.rectangle.top),[-120,-420]);
  assert.equal(next.rectangle.top,-420,'packet metadata may be current while individual events retain their own bounds');
});

test('a captured pointer cancellation releases ownership even when the browser no longer marks it primary',async t=>{
  const f=fixture(t),controller=await f.start();controller.setVisible(true);
  dispatch(f.canvas,pointer('pointerdown',10));dispatch(f.canvas,pointer('pointercancel',20,{isPrimary:false}));
  assert.equal(f.canvas.hasPointerCapture(1),false);
  const first=f.worker.messages.find(value=>value.type==='input');f.worker.reply({type:'input-ack',sequence:first.sequence});
  assert.equal(f.worker.messages.filter(value=>value.type==='input').at(-1).events.at(-1).type,'pointercancel');
});

test('theme, framing, resize and visibility updates remain latest-only while the worker is busy',async t=>{
  const f=fixture(t),controller=await f.start();controller.setVisible(true);
  for(let i=0;i<100;i++){controller.setTheme(i%2?'light':'dark');controller.setFraming({composition:'landing',locale:i%2?'en':'fa'});controller.resize();}
  assert.equal(f.worker.messages.filter(value=>value.type==='settings').length,1);
  const first=f.worker.messages.find(value=>value.type==='settings');f.worker.reply({type:'settings-ack',sequence:first.sequence});
  const next=f.worker.messages.filter(value=>value.type==='settings').at(-1);assert.equal(next.settings.theme,'light');assert.equal(next.settings.framing.locale,'en');assert.equal(next.settings.visible,true);
  assert.equal(f.worker.messages.filter(value=>value.type==='settings').length,2);
});

test('late or hidden presentations cannot resurrect the hand and still release worker backpressure',async t=>{
  const f=fixture(t),controller=await f.start();controller.setVisible(true);
  const presentation={transform:'translate3d(107.36px,507.52px,0)',opacity:'1',mode:'hand',phase:'lower',cursor:'grab'};
  f.worker.reply({type:'presentation',sequence:1,presentation});assert.equal(f.agent.style.opacity,'1');assert.equal(f.agent.dataset.phase,'lower');
  controller.setVisible(false);assert.equal(f.agent.style.opacity,'0');
  f.worker.reply({type:'presentation',sequence:2,presentation});assert.equal(f.agent.style.opacity,'0');
  f.worker.reply({type:'presentation',sequence:3,presentation,generation:999999});assert.equal(f.agent.style.opacity,'0');
  assert.deepEqual(f.worker.messages.filter(value=>value.type==='presentation-ack').map(value=>value.sequence),[1,2]);
});

test('runtime failure closes listeners, captures and worker exactly once before requesting a fresh React canvas',async t=>{
  const f=fixture(t),controller=await f.start();controller.setVisible(true);dispatch(f.canvas,pointer('pointerdown',10));
  f.worker.reply({type:'error'});assert.equal(f.errors,1);assert.equal(f.worker.terminations,1);assert.equal(f.canvas.captures.size,0);assert.equal(f.observers[0].disconnected,true);
  f.worker.reply({type:'error'});controller.dispose();assert.equal(f.errors,1);assert.equal(f.worker.terminations,1);
  const count=f.worker.messages.length;dispatch(f.canvas,pointer('pointerdown',20));assert.equal(f.worker.messages.length,count);
});
