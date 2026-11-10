import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const protocol=await loadTs('src/components/experience/engines/auth-worker-protocol.ts');
const {createAuthControlMailbox,validAuthControl,validAuthSettings}=protocol;
const {createAuthWorker,wasAuthCanvasTransferred}=await loadTs('src/components/experience/engines/auth-worker-host.ts');
const {createSceneClock}=await loadTs('src/components/experience/engines/scene-clock.ts');
const {createScenePreparationGate}=await loadTs('src/components/experience/engines/scene-preparation.ts');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const rectangle={left:10,top:20,width:390,height:500};
const settings={rectangle,pixelRatio:2,theme:'dark',mode:'signup',privacy:true,reducedMotion:false,visible:false};

test('auth coalescing preserves accumulated sparkle contributions and reset/celebrate order',()=>{
 const batches=[],box=createAuthControlMailbox((sequence,controls,reset)=>batches.push({sequence,controls,reset}));
 box.enqueue({type:'pointer',x:0,y:0,count:1});
 for(let i=0;i<80;i++)box.enqueue({type:'pointer',x:i/100,y:-.2,count:1});
 box.enqueue({type:'resetOrbit'});box.enqueue({type:'orbit',yaw:.1,pitch:.1,count:1});box.enqueue({type:'orbit',yaw:.2,pitch:-.1,count:1});box.enqueue({type:'celebrate'});
 assert.equal(batches.length,1);box.acknowledge(999);assert.equal(batches.length,1);box.acknowledge(1);
 assert.deepEqual(batches[1].controls,[{type:'pointer',x:.79,y:-.2,count:25},{type:'resetOrbit'},{type:'orbit',yaw:.2,pitch:-.1,count:2},{type:'celebrate'}]);
 assert.equal(batches[1].reset,false);
});
test('auth queue is bounded and an overflow explicitly releases the orbit before retained commands',()=>{
 const batches=[],box=createAuthControlMailbox((sequence,controls,reset)=>batches.push({sequence,controls,reset}),4);
 box.enqueue({type:'celebrate'});for(let i=0;i<100;i++)box.enqueue({type:i%2?'resetOrbit':'celebrate'});
 assert.ok(box.getState().pending<=4);assert.equal(box.getState().reset,true);box.acknowledge(1);assert.equal(batches[1].reset,true);
 box.dispose();box.enqueue({type:'celebrate'});box.acknowledge(2);box.resume();assert.equal(batches.length,2);
});
test('auth controls pause across pending visibility/settings without dropping a queued release',()=>{
 const batches=[],box=createAuthControlMailbox((sequence,controls,reset)=>batches.push({sequence,controls,reset}));
 box.pause();box.enqueue({type:'orbit',yaw:.3,pitch:.1,count:1});box.enqueue({type:'resetOrbit'});assert.equal(batches.length,0);
 box.resume();assert.deepEqual(batches[0].controls.map(c=>c.type),['orbit','resetOrbit']);
 box.pause();box.enqueue({type:'celebrate'});box.acknowledge(1);assert.equal(batches.length,1);box.resume();assert.equal(batches.length,2);
});
test('auth protocol rejects form values, DOM event payloads and non-finite or out-of-range controls',()=>{
 assert.equal(validAuthSettings(settings),true);
 for(const value of [{...settings,password:'never-send'},{...settings,privacy:'secret'},{...settings,mode:'email'},{...settings,pixelRatio:Infinity},{...settings,rectangle:{...rectangle,target:{}}}])assert.equal(validAuthSettings(value),false);
 for(const value of [{type:'pointer',x:NaN,y:0,count:1},{type:'pointer',x:2,y:0,count:1},{type:'orbit',yaw:0,pitch:0,count:26},{type:'celebrate',email:'never-send'},{type:'keydown',key:'text'}])assert.equal(validAuthControl(value),false);
});

class Canvas extends EventTarget{
 style={};transfers=0;
 getBoundingClientRect(){return rectangle;}
 transferControlToOffscreen(){if(this.transfers)throw Error('already transferred');this.transfers++;return {ownedOffscreen:true};}
}
class Worker extends EventTarget{
 messages=[];terminations=0;autoCapabilities=true;autoReady=true;throwInit=false;
 postMessage(message){this.messages.push(structuredClone(message));if(message.type==='probe'&&this.autoCapabilities)queueMicrotask(()=>this.reply({type:'capabilities',supported:true}));if(message.type==='init'){if(this.throwInit)throw Error('post failed');if(this.autoReady)queueMicrotask(()=>this.reply({type:'ready'}));}}
 terminate(){this.terminations++;}
 reply(value){const event=new Event('message');Object.defineProperty(event,'data',{value:{generation:this.messages[0].generation,...value}});this.dispatchEvent(event);}
}
function fixture(t,configure=()=>{}){
 const original=new Map(),observers=[];
 const set=(key,value)=>{if(!original.has(key))original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
 const windowTarget=Object.assign(new EventTarget(),{devicePixelRatio:2});set('window',windowTarget);set('HTMLCanvasElement',Canvas);
 set('ResizeObserver',class{disconnected=false;constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}});
 const canvas=new Canvas(),worker=new Worker();let controller,errors=0;configure(worker);
 const start=(extra={})=>createAuthWorker(canvas,{theme:'dark',mode:'signup',privacy:true,reducedMotion:false,onError:()=>errors++,workerFactory:()=>worker,timeoutMs:1000,...extra}).then(value=>(controller=value));
 t.after(()=>{controller?.dispose();for(const[key,value]of original)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];});
 return {canvas,worker,observers,start,set,window:windowTarget,get errors(){return errors;}};
}
test('auth worker probes capabilities before one transfer and receives only initial non-sensitive state',async t=>{
 const f=fixture(t,w=>{w.autoCapabilities=false;}),pending=f.start();assert.equal(f.canvas.transfers,0);
 f.worker.reply({type:'capabilities',supported:true});const scene=await pending;
 assert.equal(f.canvas.transfers,1);assert.equal(wasAuthCanvasTransferred(f.canvas),true);assert.equal(scene.update,undefined);
 const init=f.worker.messages.find(m=>m.type==='init');assert.deepEqual(init.settings,settings);
 assert.deepEqual(Object.keys(init.settings).sort(),['mode','pixelRatio','privacy','rectangle','reducedMotion','theme','visible']);
 f.worker.reply({type:'capabilities',supported:true});assert.equal(f.canvas.transfers,1);
});
test('unsupported auth worker never consumes the HTML canvas',async t=>{
 const f=fixture(t,w=>{w.autoCapabilities=false;}),pending=f.start();f.worker.reply({type:'capabilities',supported:false});
 await assert.rejects(pending,/could not be initialized/);assert.equal(f.canvas.transfers,0);assert.equal(f.worker.terminations,1);
});
test('auth preparation abort before transfer disposes once and rejects late messages',async t=>{
 const f=fixture(t,w=>{w.autoCapabilities=false;}),abort=new AbortController(),pending=f.start({signal:abort.signal});
 abort.abort();await assert.rejects(pending,{name:'AbortError'});f.worker.reply({type:'capabilities',supported:true});assert.equal(f.canvas.transfers,0);assert.equal(f.worker.terminations,1);
});
test('auth abort after transfer permanently marks the old node for React remount',async t=>{
 const f=fixture(t,w=>{w.autoReady=false;}),abort=new AbortController(),pending=f.start({signal:abort.signal});await turn();
 abort.abort();await assert.rejects(pending,{name:'AbortError'});f.worker.reply({type:'ready'});assert.equal(f.worker.terminations,1);assert.equal(f.canvas.transfers,1);
 let allocations=0;await assert.rejects(createAuthWorker(f.canvas,{...settings,onError(){},workerFactory:()=>{allocations++;return new Worker();}}),/fresh React canvas/);assert.equal(allocations,0);
});
test('auth failed transfer post and startup timeout terminate without a runtime callback',async t=>{
 const f=fixture(t,w=>{w.throwInit=true;});await assert.rejects(f.start(),/could not be initialized/);assert.equal(f.worker.terminations,1);assert.equal(f.errors,0);assert.equal(wasAuthCanvasTransferred(f.canvas),true);
});
test('auth startup timeout does not accept a late ready or error',async t=>{
 const f=fixture(t,w=>{w.autoReady=false;});await assert.rejects(f.start({timeoutMs:5}),/could not be initialized/);f.worker.reply({type:'ready'});f.worker.reply({type:'error'});assert.equal(f.worker.terminations,1);assert.equal(f.errors,0);
});
test('auth settings remain latest-only and controls await the final visible settings acknowledgement',async t=>{
 const f=fixture(t),scene=await f.start();scene.setTheme('light');scene.setPrivacy(false);scene.setVisible(true);scene.setOrbit(.2,.1);scene.resetOrbit();
 let sent=f.worker.messages.filter(m=>m.type==='settings');assert.equal(sent.length,1);assert.equal(f.worker.messages.filter(m=>m.type==='controls').length,0);
 f.worker.reply({type:'settings-ack',sequence:sent[0].sequence});sent=f.worker.messages.filter(m=>m.type==='settings');assert.equal(sent.length,2);assert.equal(sent[1].settings.privacy,false);assert.equal(sent[1].settings.visible,true);assert.equal(f.worker.messages.filter(m=>m.type==='controls').length,0);
 f.worker.reply({type:'settings-ack',sequence:sent[1].sequence});assert.deepEqual(f.worker.messages.find(m=>m.type==='controls').controls.map(c=>c.type),['orbit','resetOrbit']);
});
test('auth works without ResizeObserver and cleans window resize listeners on dispose',async t=>{
 const f=fixture(t);f.set('ResizeObserver',undefined);const scene=await f.start();f.window.dispatchEvent(new Event('resize'));assert.equal(f.worker.messages.filter(m=>m.type==='settings').length,1);
 scene.dispose();const count=f.worker.messages.length;f.window.dispatchEvent(new Event('resize'));assert.equal(f.worker.messages.length,count);assert.equal(f.worker.terminations,1);
});
test('auth observer observe failure cannot leak a ready transferred worker',async t=>{
 const f=fixture(t);let disconnected=0;f.set('ResizeObserver',class{observe(){throw Error('observe failed');}disconnect(){disconnected++;}});
 await assert.rejects(f.start(),/observe failed/);assert.equal(disconnected,1);assert.equal(f.worker.terminations,1);assert.equal(f.errors,0);
});
test('auth post-ready failure calls the fresh-canvas recovery once and removes owned observers',async t=>{
 const f=fixture(t),scene=await f.start();f.worker.reply({type:'error'});f.worker.reply({type:'error'});scene.dispose();
 assert.equal(f.errors,1);assert.equal(f.worker.terminations,1);assert.equal(f.observers[0].disconnected,true);
});
test('actual auth worker applies initial privacy/mode before readiness and waits for the post-frame task',()=>{
 const source=readFileSync(new URL('../src/components/experience/engines/auth.worker.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 const messages=[],timers=new Map(),calls=[];let firstFrame,id=0;
 class Offscreen extends EventTarget{getContext(type){return type==='2d'?{}:{getExtension:()=>({loseContext(){}})};}}
 const self={postMessage:message=>messages.push(structuredClone(message))};
 const scene={supported:true,destroy(){calls.push('destroy');},resize(){},setVisible(v){calls.push(['visible',v]);},setTheme(){},setMode(v){calls.push(['mode',v]);},setPrivacy(v){calls.push(['privacy',v]);},setReducedMotion(){},setPointer(){},setOrbit(){},resetOrbit(){},celebrate(){}};
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{self,Event,EventTarget,OffscreenCanvas:Offscreen,validAuthSettings,validAuthControl,createToothScene:(_canvas,options)=>{firstFrame=options.onFirstFrame;return scene;},requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:fn=>{const key=++id;timers.set(key,fn);return key;},clearTimeout:key=>timers.delete(key)});
 self.onmessage({data:{type:'probe',generation:1}});self.onmessage({data:{type:'init',generation:1,canvas:new Offscreen(),settings}});
 assert.deepEqual(calls,[['privacy',true],['mode','signup']]);assert.equal(messages.some(m=>m.type==='ready'),false);
 firstFrame();assert.equal(messages.some(m=>m.type==='ready'),false);assert.deepEqual(calls.at(-1),['visible',false]);
 for(const fn of timers.values())fn();assert.equal(messages.filter(m=>m.type==='ready').length,1);
 self.onmessage({data:{type:'dispose',generation:1}});assert.equal(calls.at(-1),'destroy');
});
test('actual auth disposal before or after its first frame cancels the deferred ready announcement',()=>{
 const source=readFileSync(new URL('../src/components/experience/engines/auth.worker.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 for(const afterFrame of [false,true]){
  const messages=[],timers=new Map();let firstFrame,destroyed=0,id=0;
  class Offscreen extends EventTarget{getContext(type){return type==='2d'?{}:{getExtension:()=>({loseContext(){}})};}}
  const self={postMessage:m=>messages.push(m)};
  const scene={supported:true,destroy(){destroyed++;},resize(){},setVisible(){},setTheme(){},setMode(){},setPrivacy(){},setReducedMotion(){},setPointer(){},setOrbit(){},resetOrbit(){},celebrate(){}};
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{self,Event,EventTarget,OffscreenCanvas:Offscreen,validAuthSettings,validAuthControl,createToothScene:(_canvas,options)=>{firstFrame=options.onFirstFrame;return scene;},requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:fn=>{const key=++id;timers.set(key,fn);return key;},clearTimeout:key=>timers.delete(key)});
  self.onmessage({data:{type:'probe',generation:1}});self.onmessage({data:{type:'init',generation:1,canvas:new Offscreen(),settings}});
  if(afterFrame)firstFrame();const timer=timers.values().next().value;
  self.onmessage({data:{type:'dispose',generation:1}});firstFrame();timer?.();
  assert.equal(destroyed,1);assert.equal(timers.size,0);assert.equal(messages.some(m=>m.type==='ready'),false);
 }
});


// Execute the actual React effect with an injected loader and controlled
// scheduling. These lifecycle checks make no browser rendering claim.
const componentSource=ts.createSourceFile('ToothExperience.tsx',readFileSync(new URL('../src/components/experience/ToothExperience.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let authEffectSource;
function findAuthEffect(node){if(ts.isCallExpression(node)&&node.expression.getText(componentSource)==='useEffect'&&node.arguments[0]?.getText(componentSource).includes('createAuthWorker'))authEffectSource=node.arguments[0].getText(componentSource);ts.forEachChild(node,findAuthEffect);}findAuthEffect(componentSource);assert.ok(authEffectSource);
function authComponentFixture(observerFactory){
 const states=[],generations=[],frames=new Map();let frameId=0,resolveHost,imports=0,allocations=0,disposals=0,onError;
 const pending=new Promise(resolve=>resolveHost=resolve),canvas=new Canvas(),motion=Object.assign(new EventTarget(),{matches:false});
 const scene={supported:true,resize(){},dispose(){disposals++;},setTheme(){},setReducedMotion(){},setPrivacy(){},setMode(){},setVisible(){},resetOrbit(){}};
 const bindings={canvasRef:{current:canvas},containerRef:{current:{}},controllerRef:{current:null},preferences:{current:{theme:'dark',privacy:true,authMode:'login'}},variant:'auth',useMainThreadAuth:{current:false},useMainThreadHero:{current:false},setState:value=>states.push(value),setCanvasGeneration:value=>generations.push(value),AbortController,createSceneClock,createScenePreparationGate,isReducedMotion:()=>false,window:Object.assign(new EventTarget(),{matchMedia:()=>motion}),document:Object.assign(new EventTarget(),{hidden:false}),DISPLAY_PREFERENCES_EVENT:'preferences',IntersectionObserver:observerFactory,requestAnimationFrame:fn=>{const id=++frameId;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),loadAuthHost:()=>{imports++;return pending;}};
 const text=authEffectSource.replace('await import("./engines/auth-worker-host")','await loadAuthHost()');assert.notEqual(text,authEffectSource);
 const effect=runInNewContext(ts.transpileModule('('+text+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,bindings);
 return {effect,states,generations,frames,bindings,frame(){const entry=frames.entries().next().value;assert.ok(entry);frames.delete(entry[0]);entry[1](16);},resolve(){resolveHost({supportsAuthWorker:()=>true,wasAuthCanvasTransferred:()=>false,createAuthWorker:async(_canvas,options)=>{allocations++;onError=options.onError;return scene;}});},lateError(){onError?.();},get imports(){return imports;},get allocations(){return allocations;},get disposals(){return disposals;}};
}
test('actual auth React observer failure cancels pending frames before a late import can allocate a worker',async()=>{
 let disconnected=0;
 const f=authComponentFixture(class{constructor(callback){this.callback=callback;}observe(){this.callback([{isIntersecting:true}]);throw Error('observe failed');}disconnect(){disconnected++;}});
 const cleanup=f.effect();assert.equal(f.states.at(-1),'fallback');assert.equal(disconnected,1);assert.equal(f.frames.size,0);
 await turn();f.resolve();await turn();assert.equal(f.imports,0);assert.equal(f.allocations,0);cleanup();assert.equal(disconnected,1);
});
test('actual auth React effect supports absent IntersectionObserver and ignores post-unmount worker errors',async()=>{
 const f=authComponentFixture(undefined),cleanup=f.effect();
 f.frame();f.frame();await turn();assert.equal(f.imports,1);f.resolve();await turn();
 assert.equal(f.allocations,1);assert.equal(f.states.at(-1),'ready');assert.equal(f.bindings.controllerRef.current?.supported,true);
 cleanup();const stateCount=f.states.length;f.lateError();cleanup();
 assert.equal(f.disposals,1);assert.equal(f.bindings.controllerRef.current,null);assert.equal(f.states.length,stateCount);assert.equal(f.generations.length,0);assert.equal(f.frames.size,0);
});
