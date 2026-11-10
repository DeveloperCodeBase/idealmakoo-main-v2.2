import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const {createRubikWorker,wasRubikCanvasTransferred}=await loadTs('src/components/experience/engines/rubik-worker-host.ts');
const {validRubikInput,validRubikSettings}=await loadTs('src/components/experience/engines/rubik-worker-protocol.ts');
const {createSceneClock}=await loadTs('src/components/experience/engines/scene-clock.ts');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const rectangle={left:10,top:20,width:390,height:500};
const pointer=(type,extra={})=>({type,timeStamp:10,pointerId:1,pointerType:'mouse',button:0,isPrimary:true,clientX:130,clientY:200,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,...extra});
class Canvas extends EventTarget{
 style={};transfers=0;captures=new Set();focused=0;classes=new Set();
 classList={add:value=>this.classes.add(value),remove:value=>this.classes.delete(value)};
 getBoundingClientRect(){return rectangle;}
 transferControlToOffscreen(){if(this.transfers)throw Error('already consumed');this.transfers++;return {ownedOffscreen:true};}
 focus(){this.focused++;}setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);}
}
class Worker extends EventTarget{
 messages=[];terminations=0;autoCapabilities=true;autoReady=true;throwInit=false;
 postMessage(message){this.messages.push(structuredClone(message));if(message.type==='probe'&&this.autoCapabilities)queueMicrotask(()=>this.reply({type:'capabilities',supported:true}));if(message.type==='init'){if(this.throwInit)throw Error('transfer failed');if(this.autoReady)queueMicrotask(()=>this.reply({type:'ready'}));}}
 terminate(){this.terminations++;}
 reply(value){const event=new Event('message');Object.defineProperty(event,'data',{value:{generation:this.messages[0].generation,...value}});this.dispatchEvent(event);}
}
function fixture(t,configure=()=>{}){
 const original=new Map(),observers=[];const set=(key,value)=>{if(!original.has(key))original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
 const windowTarget=Object.assign(new EventTarget(),{devicePixelRatio:2});set('window',windowTarget);set('HTMLCanvasElement',Canvas);
 set('ResizeObserver',class{disconnected=false;constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}});
 const canvas=new Canvas(),worker=new Worker();configure(worker);let controller,errors=0;
 const begin=(extra={})=>(controller=createRubikWorker(canvas,{finish:'Neon',reducedMotion:false,onError:()=>errors++,workerFactory:()=>worker,timeoutMs:1000,...extra}));
 const start=async(extra={})=>{const value=begin(extra);await value.prepare();return value;};
 t.after(()=>{controller?.dispose();for(const[key,value]of original)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];});
 return {canvas,worker,window:windowTarget,observers,start,begin,set,get errors(){return errors;}};
}
function dispatch(canvas,input){const event=new Event(input.type,{cancelable:true});for(const[key,value]of Object.entries(input))if(key!=='type')Object.defineProperty(event,key,{value});canvas.dispatchEvent(event);return event;}
function acknowledgeSettings(f){let last=0;for(let i=0;i<10;i++){const message=f.worker.messages.filter(m=>m.type==='settings').at(-1);if(!message||message.sequence===last)return;last=message.sequence;f.worker.reply({type:'settings-ack',sequence:last});}throw Error('Unbounded settings loop');}

test('cube capability probe precedes a one-shot transfer and host never owns a render loop',async t=>{
 const f=fixture(t,w=>{w.autoCapabilities=false;}),pending=f.start();assert.equal(f.canvas.transfers,0);f.worker.reply({type:'capabilities',supported:true});const scene=await pending;
 assert.equal(f.canvas.transfers,1);assert.equal(wasRubikCanvasTransferred(f.canvas),true);assert.equal(scene.update,undefined);f.worker.reply({type:'capabilities',supported:true});assert.equal(f.canvas.transfers,1);
 const init=f.worker.messages.find(m=>m.type==='init');assert.equal(init.settings.finish,'Neon');assert.equal(init.settings.visible,false);
});
test('unsupported cube workers leave the canvas unconsumed',async t=>{
 const f=fixture(t,w=>{w.autoCapabilities=false;}),pending=f.start();f.worker.reply({type:'capabilities',supported:false});await assert.rejects(pending,/could not be initialized/);assert.equal(f.canvas.transfers,0);assert.equal(f.worker.terminations,1);
});
test('cube abort before transfer ignores late capabilities and closes only its own worker',async t=>{
 const f=fixture(t,w=>{w.autoCapabilities=false;}),abort=new AbortController(),pending=f.start({signal:abort.signal});abort.abort();await assert.rejects(pending,{name:'AbortError'});f.worker.reply({type:'capabilities',supported:true});assert.equal(f.canvas.transfers,0);assert.equal(f.worker.terminations,1);
});
test('cube abort after transfer enforces fresh React canvas ownership on effect replay',async t=>{
 const f=fixture(t,w=>{w.autoReady=false;}),abort=new AbortController(),pending=f.start({signal:abort.signal});await turn();abort.abort();await assert.rejects(pending,{name:'AbortError'});f.worker.reply({type:'ready'});
 let allocations=0;assert.throws(()=>createRubikWorker(f.canvas,{finish:'Glass',reducedMotion:false,onError(){},workerFactory:()=>{allocations++;return new Worker();}}),/fresh React canvas/);assert.equal(allocations,0);assert.equal(f.worker.terminations,1);
});
test('cube transfer-post failure disposes the consumed node once',async t=>{
 const f=fixture(t,w=>{w.throwInit=true;});await assert.rejects(f.start(),/could not be initialized/);assert.equal(wasRubikCanvasTransferred(f.canvas),true);assert.equal(f.worker.terminations,1);assert.equal(f.errors,0);
});
test('cube startup timeout rejects late ready without a runtime recovery callback',async t=>{
 const f=fixture(t,w=>{w.autoReady=false;}),scene=f.begin({timeoutMs:5});scene.setVisible(true);await assert.rejects(scene.prepare(),/could not be initialized/);f.worker.reply({type:'ready'});f.worker.reply({type:'error'});assert.equal(f.worker.terminations,1);assert.equal(f.errors,0);
});
test('cube down cannot overtake the last pending visible settings ACK',async t=>{
 const f=fixture(t),scene=await f.start();scene.setFinish('Glass');scene.setReducedMotion(true);scene.setVisible(true);
 const down=dispatch(f.canvas,pointer('pointerdown'));dispatch(f.canvas,pointer('pointerup',{timeStamp:20,clientX:148,shiftKey:true}));
 assert.equal(down.defaultPrevented,true);assert.equal(f.canvas.focused,1);assert.equal(f.canvas.captures.size,0);assert.equal(f.worker.messages.filter(m=>m.type==='input').length,0);
 let settings=f.worker.messages.filter(m=>m.type==='settings');assert.equal(settings.length,1);f.worker.reply({type:'settings-ack',sequence:settings[0].sequence});
 settings=f.worker.messages.filter(m=>m.type==='settings');assert.equal(settings.length,2);assert.equal(settings[1].settings.visible,true);assert.equal(f.worker.messages.filter(m=>m.type==='input').length,0);
 f.worker.reply({type:'settings-ack',sequence:settings[1].sequence});const input=f.worker.messages.find(m=>m.type==='input');assert.deepEqual(input.events.map(e=>e.type),['pointerdown','pointerup']);assert.equal(input.events[1].shiftKey,true);assert.equal(input.events[1].clientX,148);
});
test('cube preserves native right-button orbit and immediate pointer focus/capture',async t=>{
 const f=fixture(t),scene=await f.start();scene.setVisible(true);acknowledgeSettings(f);
 const down=dispatch(f.canvas,pointer('pointerdown',{button:2,altKey:true,shiftKey:true,timeStamp:12.125}));
 assert.equal(down.defaultPrevented,true);assert.equal(f.canvas.captures.has(1),true);assert.equal(f.canvas.classes.has('scene-pointer-focus'),true);
 const event=f.worker.messages.find(m=>m.type==='input').events[0];assert.equal(event.button,2);assert.equal(event.altKey,true);assert.equal(event.shiftKey,true);assert.equal(event.timeStamp,12.125);
});
test('cube pending release keeps its dispatch rectangle and final pointer sample after a scroll',async t=>{
 const f=fixture(t),scene=await f.start();scene.setVisible(true);acknowledgeSettings(f);dispatch(f.canvas,pointer('pointerdown'));
 f.canvas.getBoundingClientRect=()=>({...rectangle,top:-200});dispatch(f.canvas,pointer('pointermove',{clientX:136,clientY:210,timeStamp:22}));
 f.canvas.getBoundingClientRect=()=>({...rectangle,top:-400});dispatch(f.canvas,pointer('pointerup',{clientX:150,clientY:230,timeStamp:33,shiftKey:true}));
 const first=f.worker.messages.find(m=>m.type==='input');f.worker.reply({type:'input-ack',sequence:first.sequence});const next=f.worker.messages.filter(m=>m.type==='input').at(-1);
 assert.deepEqual(next.events.map(e=>e.rectangle.top),[-200,-400]);assert.equal(next.events.at(-1).clientY,230);assert.equal(next.events.at(-1).shiftKey,true);assert.equal(f.canvas.captures.size,0);
});
test('cube captured cancellation is delivered even if the browser no longer marks it primary',async t=>{
 const f=fixture(t),scene=await f.start();scene.setVisible(true);acknowledgeSettings(f);dispatch(f.canvas,pointer('pointerdown'));dispatch(f.canvas,pointer('pointercancel',{isPrimary:false,timeStamp:20}));
 assert.equal(f.canvas.captures.size,0);const first=f.worker.messages.find(m=>m.type==='input');f.worker.reply({type:'input-ack',sequence:first.sequence});assert.equal(f.worker.messages.filter(m=>m.type==='input').at(-1).events.at(-1).type,'pointercancel');
});
test('cube keyboard whitelist preserves modifier bypass and Escape releases capture synchronously',async t=>{
 const f=fixture(t),scene=await f.start();scene.setVisible(true);acknowledgeSettings(f);
 for(const key of ['q','password']){const e=dispatch(f.canvas,{type:'keydown',key,shiftKey:false,timeStamp:10});assert.equal(e.defaultPrevented,false);}
 const modified=dispatch(f.canvas,{type:'keydown',key:'R',ctrlKey:true,shiftKey:false,timeStamp:11});assert.equal(modified.defaultPrevented,false);
 const key=dispatch(f.canvas,{type:'keydown',key:'R',shiftKey:true,timeStamp:12});assert.equal(key.defaultPrevented,true);
 const first=f.worker.messages.find(m=>m.type==='input');assert.deepEqual(first.events,[{type:'keydown',timeStamp:12,key:'R',shiftKey:true,altKey:false,ctrlKey:false,metaKey:false}]);f.worker.reply({type:'input-ack',sequence:first.sequence});
 dispatch(f.canvas,pointer('pointerdown'));const escape=dispatch(f.canvas,{type:'keydown',key:'Escape',shiftKey:false,timeStamp:20});assert.equal(escape.defaultPrevented,true);assert.equal(f.canvas.captures.size,0);
});
test('cube visibility loss and window blur cancel grabs without retaining native capture',async t=>{
 const f=fixture(t),scene=await f.start();scene.setVisible(true);acknowledgeSettings(f);dispatch(f.canvas,pointer('pointerdown'));scene.setVisible(false);
 assert.equal(f.canvas.captures.size,0);const old=f.worker.messages.find(m=>m.type==='input');f.worker.reply({type:'input-ack',sequence:old.sequence});assert.equal(f.worker.messages.filter(m=>m.type==='input').length,1);
 acknowledgeSettings(f);scene.setVisible(true);acknowledgeSettings(f);const reset=f.worker.messages.filter(m=>m.type==='input').at(-1);assert.equal(reset.cancel,true);f.worker.reply({type:'input-ack',sequence:reset.sequence});
 dispatch(f.canvas,pointer('pointerdown',{timeStamp:30}));f.window.dispatchEvent(new Event('blur'));assert.equal(f.canvas.captures.size,0);
});
test('cube can observe window resizing when ResizeObserver is unavailable',async t=>{
 const f=fixture(t);f.set('ResizeObserver',undefined);const scene=await f.start();f.window.dispatchEvent(new Event('resize'));assert.equal(f.worker.messages.filter(m=>m.type==='settings').length,1);scene.dispose();const count=f.worker.messages.length;f.window.dispatchEvent(new Event('resize'));assert.equal(f.worker.messages.length,count);
});
test('cube pre-probe observer setup failure disposes all owned state exactly once',async t=>{
 const f=fixture(t);let disconnected=0;f.set('ResizeObserver',class{observe(){throw Error('observe failed');}disconnect(){disconnected++;}});
 await assert.rejects(f.start(),/observe failed/);assert.equal(disconnected,1);assert.equal(f.worker.terminations,1);assert.equal(f.errors,0);
});
test('cube runtime failure and stale generation messages cannot restart disposed worker state',async t=>{
 const f=fixture(t),scene=await f.start();scene.setVisible(true);acknowledgeSettings(f);dispatch(f.canvas,pointer('pointerdown'));
 f.worker.reply({type:'error',generation:999999});assert.equal(f.errors,0);f.worker.reply({type:'error'});scene.dispose();f.worker.reply({type:'ready'});f.worker.reply({type:'error'});
 assert.equal(f.errors,1);assert.equal(f.worker.terminations,1);assert.equal(f.canvas.captures.size,0);assert.equal(f.observers[0].disconnected,true);
});

function workerFixture(visible=false){
 const source=readFileSync(new URL('../src/components/experience/engines/rubik.worker.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 const messages=[],calls=[],frames=new Map(),timers=new Map();let id=0;
 class Offscreen extends EventTarget{width=1;height=1;getContext(){return {getExtension:()=>({loseContext(){}})};}}
 const self={postMessage:message=>messages.push(structuredClone(message))};let surface;
 const scene={dispose(){calls.push('dispose');},setVisible:v=>calls.push(['visible',v]),update:(...args)=>calls.push(['update',...args]),setFinish(){},setReducedMotion(){},resize(){},cancelPointer(){calls.push('cancel');}};
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{self,Event,EventTarget,OffscreenCanvas:Offscreen,validRubikSettings,validRubikInput,createSceneClock,initRubik:(value,options)=>{surface=value;assert.equal(options.maxPixelRatio,1.5);assert.equal(options.toothQuality,'high');assert.equal(options.bindControls,false);return scene;},requestAnimationFrame:fn=>{const key=++id;frames.set(key,fn);return key;},cancelAnimationFrame:key=>frames.delete(key),setTimeout:fn=>{const key=++id;timers.set(key,fn);return key;},clearTimeout:key=>timers.delete(key)});
 self.onmessage({data:{type:'probe',generation:1}});self.onmessage({data:{type:'init',generation:1,canvas:new Offscreen(),settings:{rectangle,pixelRatio:2,finish:'Neon',reducedMotion:false,visible}}});
 return {self,messages,calls,frames,timers,get surface(){return surface;}};
}
test('actual cube worker draws only after visible settings, then announces ready in a separate task',()=>{
 const f=workerFixture();assert.equal(f.frames.size,0);assert.equal(f.messages.some(m=>m.type==='ready'),false);
 f.self.onmessage({data:{type:'settings',generation:1,sequence:1,settings:{rectangle,pixelRatio:2,finish:'Glass',reducedMotion:true,visible:true}}});
 assert.equal(f.messages.filter(m=>m.type==='settings-ack').length,1);
 const frame=f.frames.values().next().value;f.frames.clear();frame(100);
 assert.deepEqual(f.calls.find(v=>Array.isArray(v)&&v[0]==='update'),['update',0,0]);assert.equal(f.messages.some(m=>m.type==='ready'),false);
 const timer=f.timers.values().next().value;f.timers.clear();timer();assert.equal(f.messages.filter(m=>m.type==='ready').length,1);
 const r=f.surface.getBoundingClientRect();assert.equal(r.right,400);assert.equal(r.bottom,520);
});
test('actual cube worker hide before initial frame cancels drawing without losing later readiness',()=>{
 const f=workerFixture(true),frame=f.frames.values().next().value;
 f.self.onmessage({data:{type:'settings',generation:1,sequence:1,settings:{rectangle,pixelRatio:2,finish:'Neon',reducedMotion:false,visible:false}}});
 frame(100);assert.equal(f.frames.size,0);assert.equal(f.calls.some(v=>Array.isArray(v)&&v[0]==='update'),false);
 f.self.onmessage({data:{type:'settings',generation:1,sequence:2,settings:{rectangle,pixelRatio:2,finish:'Neon',reducedMotion:false,visible:true}}});
 const next=f.frames.values().next().value;f.frames.clear();next(1000);f.timers.values().next().value();
 assert.equal(f.messages.filter(m=>m.type==='ready').length,1);
});
test('actual cube worker acknowledges and drops pre-ready controls, then accepts a normal later input',()=>{
 const f=workerFixture(true),received=[];f.surface.addEventListener('pointerdown',e=>received.push(e.clientX));
 f.self.onmessage({data:{type:'input',generation:1,sequence:1,cancel:true,events:[{...pointer('pointerdown'),rectangle}]}});
 assert.equal(received.length,0);assert.equal(f.messages.filter(m=>m.type==='input-ack').at(-1).sequence,1);assert.ok(f.calls.includes('cancel'));
 const frame=f.frames.values().next().value;f.frames.clear();frame(1);f.timers.values().next().value();
 f.self.onmessage({data:{type:'input',generation:1,sequence:2,cancel:false,events:[{...pointer('pointerdown',{clientX:160}),rectangle:{...rectangle,left:70}}]}});
 assert.deepEqual(received,[160]);assert.equal(f.messages.filter(m=>m.type==='input-ack').at(-1).sequence,2);assert.equal(f.surface.getBoundingClientRect().left,10);
});
test('actual cube worker publishes changed cursor only with one outstanding presentation ACK',()=>{
 const f=workerFixture();f.surface.style.cursor='grabbing';f.surface.style.cursor='grabbing';f.surface.style.cursor='grab';
 let sent=f.messages.filter(m=>m.type==='presentation');assert.equal(sent.length,1);assert.equal(sent[0].presentation.cursor,'grabbing');
 f.self.onmessage({data:{type:'presentation-ack',generation:1,sequence:999}});assert.equal(f.messages.filter(m=>m.type==='presentation').length,1);
 f.self.onmessage({data:{type:'presentation-ack',generation:1,sequence:sent[0].sequence}});
 sent=f.messages.filter(m=>m.type==='presentation');assert.equal(sent.length,2);assert.equal(sent[1].presentation.cursor,'grab');
 f.self.onmessage({data:{type:'presentation-ack',generation:1,sequence:sent[1].sequence}});assert.equal(f.messages.filter(m=>m.type==='presentation').length,2);
});
test('actual cube worker disposal before the first frame or post-frame task prevents late readiness',()=>{
 for(const afterFrame of [false,true]){
  const f=workerFixture(true),frame=f.frames.values().next().value;if(afterFrame){f.frames.clear();frame(100);}
  const timer=f.timers.values().next().value;f.self.onmessage({data:{type:'dispose',generation:1}});frame(200);timer?.();
  assert.equal(f.messages.some(m=>m.type==='ready'),false);assert.equal(f.calls.filter(v=>v==='dispose').length,1);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
 }
});

const componentSource=ts.createSourceFile('RubikExperience.tsx',readFileSync(new URL('../src/components/experience/RubikExperience.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let effectSource;
function findEffect(node){if(ts.isCallExpression(node)&&node.expression.getText(componentSource)==='useEffect'&&node.arguments[0]?.getText(componentSource).includes('createRubikWorker'))effectSource=node.arguments[0].getText(componentSource);ts.forEachChild(node,findEffect);}findEffect(componentSource);assert.ok(effectSource);
function componentFixture(observerFactory){
 let resolveImport,imports=0,allocations=0;const pending=new Promise(resolve=>resolveImport=resolve),states=[],observers=[];
 const canvas=new Canvas(),container={},motion=Object.assign(new EventTarget(),{matches:false});
 const bindings={canvasRef:{current:canvas},containerRef:{current:container},themeRef:{current:'dark'},useMainThread:{current:false},controllerRef:{current:null},setState:value=>states.push(value),setCanvasGeneration(){},AbortController,createSceneClock,matchMedia:()=>motion,isReducedMotion:()=>false,window:new EventTarget(),document:Object.assign(new EventTarget(),{hidden:false}),DISPLAY_PREFERENCES_EVENT:'preferences',requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{constructor(){observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},IntersectionObserver:observerFactory,loadHost:()=>{imports++;return pending;}};
 const text=effectSource.replace('hostModule ||= import("./engines/rubik-worker-host")','hostModule ||= loadHost()');assert.notEqual(text,effectSource);
 const effect=runInNewContext(ts.transpileModule('('+text+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,bindings);
 return {effect,states,observers,bindings,resolve(create){resolveImport({supportsRubikWorker:()=>true,wasRubikCanvasTransferred:()=>false,createRubikWorker:()=>{allocations++;if(create)return create();throw Error('must not allocate after cleanup');}});},get imports(){return imports;},get allocations(){return allocations;}};
}
test('actual cube React observer failure aborts an in-progress import before it can create a worker',async()=>{
 let disconnected=0;const f=componentFixture(class{constructor(callback){this.callback=callback;}observe(){this.callback([{isIntersecting:true}]);throw Error('observe failed');}disconnect(){disconnected++;}});
 const cleanup=f.effect();assert.equal(f.imports,1);assert.equal(f.states.at(-1),'fallback');assert.equal(disconnected,1);assert.equal(f.observers[0].disconnected,true);
 f.resolve();await turn();assert.equal(f.allocations,0);cleanup();assert.equal(disconnected,1);
});

test('cube synchronous controller carries initial visibility and settings before preparation completes',async t=>{
 const f=fixture(t,w=>{w.autoReady=false;}),scene=f.begin();assert.equal(typeof scene.prepare,'function');
 scene.setFinish('Glass');scene.setVisible(true);await turn();
 const init=f.worker.messages.find(m=>m.type==='init');assert.equal(init.settings.visible,true);assert.equal(init.settings.finish,'Glass');
 scene.setVisible(false);const pending=f.worker.messages.filter(m=>m.type==='settings').at(-1);assert.equal(pending.settings.visible,false);
 f.worker.reply({type:'settings-ack',sequence:pending.sequence});f.window.dispatchEvent(new Event('blur'));
 assert.equal(f.worker.messages.filter(m=>m.type==='input').length,0);
 f.worker.reply({type:'ready'});await scene.prepare();scene.setVisible(true);acknowledgeSettings(f);
 dispatch(f.canvas,pointer('pointerdown',{ctrlKey:true,metaKey:true}));
 const input=f.worker.messages.find(m=>m.type==='input');assert.equal(input.events[0].ctrlKey,true);assert.equal(input.events[0].metaKey,true);
});
test('cube startup timeout counts visible time and retains its remaining budget across hiding',async t=>{
 const f=fixture(t,w=>{w.autoReady=false;});let now=0,id=0;const timers=new Map();
 f.set('performance',{now:()=>now});f.set('setTimeout',(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;});f.set('clearTimeout',key=>timers.delete(key));
 const advance=delta=>{now+=delta;for(const[key,timer]of [...timers])if(timer.at<=now){timers.delete(key);timer.fn();}};
 const scene=f.begin({timeoutMs:45});assert.equal(timers.size,0);scene.setVisible(true);await turn();
 advance(30);scene.setVisible(false);assert.equal(timers.size,0);advance(1000);assert.equal(f.worker.terminations,0);
 scene.setVisible(true);advance(14);assert.equal(f.worker.terminations,0);advance(1);
 await assert.rejects(scene.prepare(),/could not be initialized/);assert.equal(f.worker.terminations,1);
});
test('cube synchronous probe send failure leaves no registered observers or late controls',async t=>{
 const f=fixture(t,w=>{w.postMessage=function(message){this.messages.push(structuredClone(message));if(message.type==='probe')throw Error('send failed');};});
 const scene=f.begin();await assert.rejects(scene.prepare(),/could not be initialized/);
 assert.equal(f.worker.terminations,1);assert.equal(f.observers[0].disconnected,true);
 const count=f.worker.messages.length;f.window.dispatchEvent(new Event('resize'));dispatch(f.canvas,pointer('pointerdown'));assert.equal(f.worker.messages.length,count);
});
test('cube cursor presentation is generation-checked, allowlisted and acknowledged',async t=>{
 const f=fixture(t),scene=await f.start();scene.setVisible(true);acknowledgeSettings(f);f.worker.reply({type:'presentation',sequence:1,presentation:{cursor:'grabbing'}});
 assert.equal(f.canvas.style.cursor,'grabbing');assert.equal(f.worker.messages.filter(m=>m.type==='presentation-ack').length,1);
 f.worker.reply({type:'presentation',sequence:1,presentation:{cursor:'grab'}});
 f.worker.reply({type:'presentation',sequence:2,presentation:{cursor:'text'},generation:99999});
 assert.equal(f.canvas.style.cursor,'grabbing');assert.equal(f.worker.messages.filter(m=>m.type==='presentation-ack').length,1);scene.dispose();
});
test('cube hidden visibility ignores a late grabbing cursor while acknowledging presentation backpressure',async t=>{
 const f=fixture(t),scene=await f.start();scene.setVisible(true);acknowledgeSettings(f);
 f.worker.reply({type:'presentation',sequence:1,presentation:{cursor:'grabbing'}});assert.equal(f.canvas.style.cursor,'grabbing');
 scene.setVisible(false);assert.equal(f.canvas.style.cursor,'grab');
 f.worker.reply({type:'presentation',sequence:2,presentation:{cursor:'grabbing'}});
 assert.equal(f.canvas.style.cursor,'grab');assert.deepEqual(f.worker.messages.filter(m=>m.type==='presentation-ack').map(m=>m.sequence),[1,2]);
 acknowledgeSettings(f);scene.setVisible(true);acknowledgeSettings(f);
 f.worker.reply({type:'presentation',sequence:3,presentation:{cursor:'grabbing'}});assert.equal(f.canvas.style.cursor,'grabbing');
 assert.deepEqual(f.worker.messages.filter(m=>m.type==='presentation-ack').map(m=>m.sequence),[1,2,3]);
});
test('actual cube React preloads its module in the160px band without initializing a hidden worker',async()=>{
 const observers=[];const f=componentFixture(class{constructor(callback,options){this.callback=callback;this.options=options;observers.push(this);}observe(){}disconnect(){}});
 const cleanup=f.effect();assert.deepEqual(observers.map(x=>x.options.rootMargin),['160px','0px']);
 observers[0].callback([{isIntersecting:true}]);assert.equal(f.imports,1);f.resolve();await turn();assert.equal(f.allocations,0);
 observers[1].callback([{isIntersecting:false}]);assert.equal(f.allocations,0);cleanup();
});
test('actual cube React retains its pending controller before await and forwards hide during initialization',async()=>{
 const observers=[],visible=[];let resolvePreparation,disposed=false;
 const pending=new Promise(resolve=>resolvePreparation=resolve);
 const controller={prepare:()=>pending,setVisible:value=>visible.push(value),setFinish(){},setReducedMotion(){},resize(){},dispose(){disposed=true;}};
 const f=componentFixture(class{constructor(callback,options){this.callback=callback;this.options=options;observers.push(this);}observe(){}disconnect(){}});
 const cleanup=f.effect();observers[1].callback([{isIntersecting:true}]);f.resolve(()=>controller);await turn();
 assert.equal(f.bindings.controllerRef.current,controller);assert.equal(visible.at(-1),true);assert.notEqual(f.states.at(-1),'ready');
 observers[1].callback([{isIntersecting:false}]);assert.equal(visible.at(-1),false);
 cleanup();resolvePreparation();await turn();assert.equal(disposed,true);assert.notEqual(f.states.at(-1),'ready');
});
