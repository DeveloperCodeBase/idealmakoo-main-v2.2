import {dragSelection,pointerIntent,suppressPointerActivation} from './carousel';

interface GestureConfig {enabled:boolean;index:number;count:number;scale:number;rtl:boolean;reduced:boolean;}
interface GestureOptions {
 getConfig:()=>GestureConfig;
 onStart:()=>void;
 onDrag:(offset:number)=>void;
 onReset:()=>void;
 onSelect:(index:number)=>void;
}
export interface CarouselGestureBinding {cancel:()=>void;destroy:()=>void;isTracking:()=>boolean;}
interface Gesture {
 id:number;type:string;x:number;y:number;lastX:number;lastY:number;lastTime:number;velocity:number;
 intent:'pending'|'horizontal'|'vertical';config:GestureConfig;
}

/** One lifecycle for mouse, pen and touch. Only horizontal intent claims capture;
 * taps keep their original button, while page scrolling and pinch stay native. */
export function bindCarouselGesture(stage:HTMLElement,options:GestureOptions):CarouselGestureBinding {
 const doc=stage.ownerDocument,view=doc.defaultView!;
 let gesture:Gesture|null=null,frame:number|null=null,ignoreClickUntil=0,destroyed=false;
 const suppressClick=()=>{ignoreClickUntil=view.performance.now()+650;};
 const untrack=()=>{
  doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);
  doc.removeEventListener('pointercancel',cancelPointer,true);doc.removeEventListener('pointerdown',additionalPointer,true);
  doc.removeEventListener('visibilitychange',visibility);view.removeEventListener('blur',cancel);
 };
 const reset=()=>{
  const previous=gesture;gesture=null;untrack();
  if(frame!==null){view.cancelAnimationFrame(frame);frame=null;}
  // Clear state before release: the matching lostpointercapture can fire immediately.
  if(previous){
   try{if(stage.hasPointerCapture(previous.id))stage.releasePointerCapture(previous.id);}catch{/* Detached/ended pointer. */}
   options.onReset();
  }
 };
 function cancel(){if(gesture)suppressClick();reset();}
 function visibility(){if(doc.hidden)cancel();}
 function cancelPointer(event:PointerEvent){if(event.pointerId===gesture?.id)cancel();}
 function additionalPointer(event:PointerEvent){
  if(gesture&&event.pointerId!==gesture.id&&event.pointerType==='touch')cancel();
 }
 function lostCapture(event:PointerEvent){
  // Touch starts with implicit capture on a button/span. Its *bubbled* loss when
  // capture transfers to stage is not loss of the stage's own capture.
  if(event.target===stage&&event.pointerId===gesture?.id)cancel();
 }
 function down(event:PointerEvent){
  const config=options.getConfig();
  if(destroyed||gesture||event.defaultPrevented||event.button!==0||!event.isPrimary||!config.enabled||config.count<2)return;
  if(!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;
  ignoreClickUntil=0;
  gesture={id:event.pointerId,type:event.pointerType,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,lastTime:event.timeStamp,velocity:0,intent:'pending',config};
  options.onStart();
  // A pending mouse gesture may cross the stage boundary before capture starts.
  doc.addEventListener('pointermove',move,{capture:true,passive:false});doc.addEventListener('pointerup',up,true);
  doc.addEventListener('pointercancel',cancelPointer,true);doc.addEventListener('pointerdown',additionalPointer,true);
  doc.addEventListener('visibilitychange',visibility);view.addEventListener('blur',cancel);
 }
 function move(event:PointerEvent){
  const value=gesture;if(!value||value.id!==event.pointerId)return;
  if(!options.getConfig().enabled){cancel();return;}
  // Release outside the browser may omit pointerup. Settle at the last known
  // pressed position instead of dragging a stuck card on the next hover.
  if(value.type==='mouse'&&(event.buttons&1)===0){finish(value.lastX,value.lastY,event.timeStamp);return;}
  const dx=event.clientX-value.x,dy=event.clientY-value.y;
  if(!Number.isFinite(dx)||!Number.isFinite(dy)){cancel();return;}
  if(value.intent==='pending')value.intent=pointerIntent(dx,dy);
  if(value.intent!=='horizontal')return;
  if(!stage.hasPointerCapture(value.id)){
   try{stage.setPointerCapture(value.id);}catch{/* Document tracking still completes this gesture. */}
   if(gesture!==value)return;
  }
  if(event.cancelable)event.preventDefault();
  const elapsed=Math.max(1,event.timeStamp-value.lastTime);
  value.velocity=value.velocity*.35+(event.clientX-value.lastX)/elapsed*.65;
  value.lastX=event.clientX;value.lastY=event.clientY;value.lastTime=event.timeStamp;
  if(frame===null)frame=view.requestAnimationFrame(()=>{
   frame=null;if(gesture?.intent==='horizontal')options.onDrag(gesture.lastX-gesture.x);
  });
 }
 function finish(x:number,y:number,time:number){
  const value=gesture;if(!value)return;
  const dx=x-value.x,dy=y-value.y;
  // Fast gestures may deliver their first meaningful displacement with pointerup.
  // Keep an already chosen vertical intent, but do not discard a coalesced swipe.
  if(value.intent==='pending')value.intent=pointerIntent(dx,dy);
  if(suppressPointerActivation(dx,dy,value.intent!=='pending'))suppressClick();
  const {index,count,scale,rtl,reduced}=value.config;
  const next=value.intent==='horizontal'?dragSelection(index,count,dx,time-value.lastTime>90?0:value.velocity,scale,rtl,reduced):null;
  reset();if(next!==null&&options.getConfig().enabled)options.onSelect(next);
 }
 function up(event:PointerEvent){if(event.pointerId===gesture?.id)finish(event.clientX,event.clientY,event.timeStamp);}
 function click(event:MouseEvent){
  // Keyboard/assistive activation (detail === 0) remains available after a drag.
  if(event.detail>0&&(gesture?.intent==='horizontal'||view.performance.now()<ignoreClickUntil)){
   event.preventDefault();event.stopPropagation();
  }
 }
 function nativeDrag(event:DragEvent){event.preventDefault();}
 stage.addEventListener('pointerdown',down);stage.addEventListener('lostpointercapture',lostCapture);
 stage.addEventListener('click',click,true);stage.addEventListener('dragstart',nativeDrag);
 return {cancel,isTracking:()=>gesture!==null,destroy:()=>{
  if(destroyed)return;destroyed=true;reset();
  stage.removeEventListener('pointerdown',down);stage.removeEventListener('lostpointercapture',lostCapture);
  stage.removeEventListener('click',click,true);stage.removeEventListener('dragstart',nativeDrag);
 }};
}
