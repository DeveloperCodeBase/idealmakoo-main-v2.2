import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {bindCarouselGesture}=await loadTs('src/lib/carousel-gesture.ts');
const {cardPose}=await loadTs('src/lib/carousel.ts');

// Exercise the actual DOM binding and callbacks with native EventTarget dispatch.
// Capture transfer/bubbling is delivered explicitly; this is not browser layout QA.
class Scope extends EventTarget {
 listeners=new Map();
 addEventListener(type,fn,options){super.addEventListener(type,fn,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
 removeEventListener(type,fn,options){super.removeEventListener(type,fn,options);this.listeners.get(type)?.delete(fn);}
 listenerCount(){return [...this.listeners.values()].reduce((sum,entries)=>sum+entries.size,0);}
}
function dispatch(scope,type,values={}){
 const event=new Event(type,{bubbles:true,cancelable:true});
 const defaults={pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:240,clientY:100,timeStamp:0,detail:1,target:scope};
 for(const [key,value] of Object.entries({...defaults,...values}))Object.defineProperty(event,key,{value,configurable:true});
 scope.dispatchEvent(event);return event;
}
function fixture(overrides={}){
 const doc=new Scope(),view=new Scope(),stage=new Scope(),card=new Scope(),poster=new Scope();
 const config={enabled:true,index:2,count:7,scale:1,rtl:false,reduced:false,...overrides};
 let now=0,frameId=0,playing=true,opened=0,resets=0,captureFailure=false,implicitTarget=null;
 const frames=new Map(),captures=new Set(),offsets=[],selections=[],captureCalls=[];
 doc.defaultView=view;doc.hidden=false;stage.ownerDocument=doc;
 view.performance={now:()=>now};view.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId;};view.cancelAnimationFrame=id=>frames.delete(id);
 stage.hasPointerCapture=id=>captures.has(id);
 stage.setPointerCapture=id=>{
  captureCalls.push(id);if(captureFailure)throw new Error('Pointer capture not available');captures.add(id);
  if(implicitTarget){const target=implicitTarget;implicitTarget=null;dispatch(stage,'lostpointercapture',{target,pointerId:id});}
 };
 stage.releasePointerCapture=id=>{captures.delete(id);dispatch(stage,'lostpointercapture',{pointerId:id});};
 const binding=bindCarouselGesture(stage,{getConfig:()=>config,onStart:()=>{playing=false;},onDrag:offset=>offsets.push(offset),onReset:()=>{resets++;},onSelect:index=>{config.index=index;selections.push(index);}});
 const activate=(index,detail=1)=>{const event=dispatch(stage,'click',{target:card,detail});if(!event.defaultPrevented){if(index===config.index)opened++;else config.index=index;}return event;};
 return {doc,view,stage,card,poster,config,binding,offsets,selections,frames,captures,captureCalls,activate,
  get playing(){return playing;},get opened(){return opened;},get resets(){return resets;},
  implicit:target=>{implicitTarget=target;},failCapture:()=>{captureFailure=true;},
  tick:time=>{now=time;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));},
  down:(values={})=>dispatch(stage,'pointerdown',{target:card,...values}),
  move:(values={})=>dispatch(doc,'pointermove',values),up:(values={})=>dispatch(doc,'pointerup',values),
  assertClean:()=>{assert.equal(binding.isTracking(),false);assert.equal(frames.size,0);assert.equal(doc.listenerCount(),0);assert.equal(view.listenerCount(),0);assert.equal(captures.size,0);},
 };
}

test('mouse drag from a card follows every frame and completes on document release outside the stage',()=>{
 const f=fixture();f.down({target:f.poster});assert.equal(f.playing,false);assert.equal(f.captureCalls.length,0,'a tap is not retargeted');
 assert.equal(f.move({clientX:222,timeStamp:30}).defaultPrevented,true);f.tick(32);assert.deepEqual(f.offsets,[-18]);
 dispatch(f.stage,'pointerleave',{clientX:140,timeStamp:100});
 f.move({clientX:135,timeStamp:150});f.tick(152);assert.deepEqual(f.offsets,[-18,-105]);
 f.up({clientX:135,timeStamp:280,target:f.doc});assert.deepEqual(f.selections,[3]);f.assertClean();
 assert.equal(f.activate(3).defaultPrevented,true);assert.equal(f.opened,0,'drag cannot open details');
 assert.equal(f.activate(3,0).defaultPrevented,false);assert.equal(f.opened,1,'keyboard activation stays available');f.binding.destroy();
});

test('touch capture transfer ignores the old button or nested span losing implicit capture',()=>{
 for(const nested of ['card','poster']){
  const f=fixture();f.implicit(f[nested]);f.down({target:f[nested],pointerType:'touch'});
  f.move({clientX:180,pointerType:'touch',timeStamp:60});assert.equal(f.binding.isTracking(),true,'bubbled descendant loss does not cancel stage');f.tick(64);
  f.move({clientX:110,pointerType:'touch',timeStamp:180});f.tick(184);assert.deepEqual(f.offsets,[-60,-130]);
  f.up({clientX:110,pointerType:'touch',timeStamp:300});assert.deepEqual(f.selections,[3]);assert.equal(f.resets,1,'own capture release cannot reset twice');f.assertClean();
  assert.equal(f.activate(3).defaultPrevented,true);f.binding.destroy();
 }
});

test('fast swipes whose final displacement arrives only on release still select a card in both directions',()=>{
 for(const pointerType of ['mouse','pen','touch'])for(const rtl of [false,true])for(const offset of [-95,95]){
  const f=fixture({rtl});f.down({pointerType});
  f.move({pointerType,clientX:243,clientY:102,timeStamp:8});
  f.up({pointerType,clientX:240+offset,clientY:103,timeStamp:24});
  const expected=2-Math.sign(offset)*(rtl?-1:1);
  assert.deepEqual(f.selections,[expected]);assert.equal(f.activate(expected).defaultPrevented,true);
  assert.equal(f.opened,0);f.assertClean();f.binding.destroy();
 }
});

test('release-only vertical motion keeps native scrolling and never becomes a selection or tap',()=>{
 const f=fixture();f.down({pointerType:'touch'});
 const release=f.up({pointerType:'touch',clientX:243,clientY:190,timeStamp:30});
 assert.equal(release.defaultPrevented,false);assert.deepEqual(f.selections,[]);
 assert.equal(f.captureCalls.length,0);assert.equal(f.activate(2).defaultPrevented,true);f.assertClean();f.binding.destroy();
});

test('short mouse, pen and touch taps retain side selection followed by centre details',()=>{
 for(const pointerType of ['mouse','pen','touch']){
  const f=fixture();assert.equal(f.down({pointerType}).defaultPrevented,false);
  f.move({pointerType,clientX:243,clientY:103,timeStamp:25});f.up({pointerType,clientX:243,clientY:103,timeStamp:50});
  assert.equal(f.activate(4).defaultPrevented,false);assert.equal(f.config.index,4);assert.equal(f.opened,0);
  f.down({pointerType});f.up({pointerType,timeStamp:80});f.activate(4);assert.equal(f.opened,1);
  assert.equal(f.captureCalls.length,0);assert.deepEqual(f.selections,[]);f.assertClean();f.binding.destroy();
 }
});

test('vertical touch intent stays vertical and does not prevent page scrolling or turn into a modal',()=>{
 const f=fixture();f.down({pointerType:'touch'});
 assert.equal(f.move({pointerType:'touch',clientX:247,clientY:145,timeStamp:30}).defaultPrevented,false);
 assert.equal(f.move({pointerType:'touch',clientX:380,clientY:150,timeStamp:70}).defaultPrevented,false);
 f.tick(72);assert.deepEqual(f.offsets,[]);assert.equal(f.captureCalls.length,0);
 f.up({pointerType:'touch',clientX:380,clientY:150,timeStamp:100});assert.deepEqual(f.selections,[]);assert.equal(f.activate(2).defaultPrevented,true);f.assertClean();f.binding.destroy();
});

test('a second touch releases the first gesture without consuming the native pinch stream',()=>{
 const f=fixture();f.down({pointerType:'touch'});f.move({pointerType:'touch',clientX:200,timeStamp:40});f.tick(44);
 const second=dispatch(f.doc,'pointerdown',{pointerType:'touch',pointerId:2,isPrimary:false});
 assert.equal(second.defaultPrevented,false);f.assertClean();f.up({pointerType:'touch',clientX:120,timeStamp:100});
 assert.deepEqual(f.selections,[]);assert.equal(f.activate(2).defaultPrevented,true);f.binding.destroy();
});

test('genuine stage capture loss and pointercancel clear frames, capture and listeners without selecting',()=>{
 for(const reason of ['pointercancel','lostpointercapture']){
  const f=fixture();f.down();f.move({clientX:150,timeStamp:70});assert.equal(f.frames.size,1);
  dispatch(f.stage,'lostpointercapture',{pointerId:99});assert.equal(f.binding.isTracking(),true,'another pointer is unrelated');
  dispatch(reason==='pointercancel'?f.doc:f.stage,reason);f.assertClean();f.tick(80);
  assert.deepEqual(f.offsets,[]);assert.deepEqual(f.selections,[]);assert.equal(f.activate(2).defaultPrevented,true);f.binding.destroy();
 }
});

test('capture failures keep document tracking and only the active pointer can move or end the fan',()=>{
 const f=fixture();f.failCapture();f.down();f.move({clientX:155,timeStamp:100});
 f.move({clientX:500,pointerId:9,timeStamp:110});f.up({clientX:500,pointerId:9,timeStamp:115});f.tick(120);
 assert.deepEqual(f.offsets,[-85]);assert.equal(f.binding.isTracking(),true);
 f.up({clientX:155,timeStamp:230});assert.deepEqual(f.selections,[3]);f.assertClean();f.binding.destroy();
});

test('mouse button release outside the browser settles at its last pressed position and cannot leave stale drag',()=>{
 const f=fixture();f.down();f.move({clientX:135,timeStamp:100});f.tick(105);
 f.move({clientX:800,buttons:0,timeStamp:500});assert.deepEqual(f.selections,[3]);f.assertClean();
 f.move({clientX:20,buttons:0,timeStamp:530});assert.deepEqual(f.offsets,[-105]);f.binding.destroy();
});

test('window blur, page hiding, disabled scene and unmount cancel only this gesture and remove listeners',()=>{
 for(const reason of ['blur','hidden','disabled','destroy']){
  const f=fixture();f.down();f.move({clientX:140,timeStamp:80});
  if(reason==='blur')dispatch(f.view,'blur');
  if(reason==='hidden'){f.doc.hidden=true;dispatch(f.doc,'visibilitychange');}
  if(reason==='disabled'){f.config.enabled=false;f.move({clientX:100,timeStamp:90});}
  if(reason==='destroy')f.binding.destroy();
  f.assertClean();f.tick(100);assert.deepEqual(f.selections,[]);assert.deepEqual(f.offsets,[]);
  f.binding.destroy();assert.equal(f.stage.listenerCount(),0);f.binding.destroy();
 }
});

test('a deliberate new tap immediately after dragging works; stale delayed click remains suppressed',()=>{
 const f=fixture();f.down();f.move({clientX:145,timeStamp:100});f.up({clientX:145,timeStamp:220});
 assert.equal(f.activate(3).defaultPrevented,true);
 f.down({pointerType:'touch',timeStamp:230});f.up({pointerType:'touch',timeStamp:250});
 assert.equal(f.activate(3).defaultPrevented,false);assert.equal(f.opened,1);f.assertClean();f.binding.destroy();
});

test('explicit navigation can cancel a tracked drag so its eventual release cannot undo the new selection',()=>{
 const f=fixture();f.down();f.move({clientX:150,timeStamp:70});
 f.binding.cancel();f.config.index=5;
 f.up({clientX:90,timeStamp:200});f.tick(210);
 assert.equal(f.config.index,5);assert.deepEqual(f.selections,[]);assert.deepEqual(f.offsets,[]);f.assertClean();
 assert.equal(f.activate(5,0).defaultPrevented,false);assert.equal(f.opened,1);f.binding.destroy();
});

test('horizontal gestures and final selection mirror in RTL, remain bounded and pause autoplay on press',()=>{
 for(const rtl of [false,true])for(const initial of [0,2,6]){
  const f=fixture({rtl,index:initial,reduced:true});f.down({pointerType:'touch'});assert.equal(f.playing,false);
  f.move({pointerType:'touch',clientX:130,timeStamp:100});f.tick(110);f.up({pointerType:'touch',clientX:130,timeStamp:220});
  assert.deepEqual(f.selections,[Math.max(0,Math.min(6,initial+(rtl?-1:1)))]);assert.deepEqual(f.offsets,[-110]);f.assertClean();f.binding.destroy();
 }
});

test('disabled, single-card, non-primary and non-left presses leave controls alone; native image dragging is blocked',()=>{
 for(const [config,press] of [[{enabled:false},{}],[{count:1},{}],[{}, {isPrimary:false}],[{}, {button:2}]]){
  const f=fixture(config);f.down(press);assert.equal(f.playing,true);f.assertClean();f.binding.destroy();
 }
 const f=fixture();assert.equal(dispatch(f.stage,'dragstart',{target:f.poster}).defaultPrevented,true);f.binding.destroy();
});

test('interpolated fan positions carry a neighbour smoothly into the centre without altering the resting poses',()=>{
 for(const spread of [1,1.5])for(const rtl of [false,true]){
  const direction=rtl?-1:1,scale=1.2;
  const start=cardPose(direction,scale,false,spread),middle=cardPose(.5*direction,scale,false,spread),end=cardPose(0,scale,false,spread);
  assert.equal(middle.x,(start.x+end.x)/2);assert.equal(middle.z,(start.z+end.z)/2);
  assert.equal(middle.scale,(start.scale+end.scale)/2);assert.equal(middle.opacity,(start.opacity+end.opacity)/2);
  assert.equal(end.x,0);assert.equal(end.scale,1);assert.ok(Math.abs(cardPose(.001*direction,scale,false,spread).x)<.3);
 }
});
