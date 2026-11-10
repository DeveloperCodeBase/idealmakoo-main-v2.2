import {initRubik} from './rubik';
import {createSceneClock} from './scene-clock';
import type {RubikSurface,RubikRectangle} from './rubik-platform';
import {validRubikInput,validRubikSettings,type RubikHostMessage,type RubikWorkerMessage,type RubikWorkerSettings} from './rubik-worker-protocol';

const scope=self as unknown as {onmessage:((event:MessageEvent<RubikHostMessage>)=>void)|null;postMessage(message:RubikWorkerMessage):void};
let generation=0,disposed=false,ready=false,initializing=false,firstFrame=false,inputSequence=0,settingsSequence=0,frameId=0;
let cursor:'grab'|'grabbing'='grab',sentCursor:'grab'|'grabbing'='grab',presentationSequence=0,presentationInFlight=0;
let canvas:OffscreenCanvas,surface:WorkerSurface,settings:RubikWorkerSettings,scene:ReturnType<typeof initRubik>|null=null;
let readyTimer:ReturnType<typeof setTimeout>|null=null;
const clock=createSceneClock();
type Outgoing<T>=T extends unknown?Omit<T,'generation'>:never;
function post(message:Outgoing<RubikWorkerMessage>){if(!disposed)scope.postMessage({...message,generation} as RubikWorkerMessage);}
function flushPresentation(){
  if(disposed||!generation||presentationInFlight||cursor===sentCursor)return;
  sentCursor=cursor;presentationInFlight=++presentationSequence;
  post({type:'presentation',sequence:presentationInFlight,presentation:{cursor}});
}
function dispose(){
  if(disposed)return;disposed=true;ready=false;clock.setVisible(false);cancelAnimationFrame(frameId);frameId=0;
  if(readyTimer!==null)clearTimeout(readyTimer);readyTimer=null;presentationInFlight=0;
  canvas?.removeEventListener('webglcontextlost',onContextLost);canvas?.removeEventListener('webglcontextcreationerror',onContextCreationError);
  try{scene?.dispose();}finally{scene=null;}
}
function fail(){if(disposed)return;post({type:'error'});dispose();}
function onContextLost(event:Event){event.preventDefault();fail();}
function onContextCreationError(){fail();}
class WorkerSurface extends EventTarget implements RubikSurface {
  style={touchAction:'none',get cursor(){return cursor;},set cursor(value:string){const next=value==='grabbing'?'grabbing':'grab';if(next!==cursor){cursor=next;flushPresentation();}}};
  classList={add(){},remove(){}};
  tabIndex=0;
  rectangle:RubikRectangle;
  constructor(rectangle:RubikRectangle){super();this.rectangle=rectangle;}
  get width(){return canvas.width;} set width(value:number){canvas.width=value;}
  get height(){return canvas.height;} set height(value:number){canvas.height=value;}
  get clientWidth(){return this.rectangle.width;}
  get clientHeight(){return this.rectangle.height;}
  getContext(kind:string,attributes?:WebGLContextAttributes){return kind==='webgl2'?canvas.getContext('webgl2',attributes):null;}
  getBoundingClientRect(){const r=this.rectangle;return {...r,right:r.left+r.width,bottom:r.top+r.height};}
  // Native focus, accessibility and capture remain synchronous in the host.
  hasAttribute(){return true;} setAttribute(){} focus(){} setPointerCapture(){} hasPointerCapture(){return true;} releasePointerCapture(){}
  addEventListener(type:string,listener:EventListenerOrEventListenerObject|null,options?:boolean|AddEventListenerOptions){if(!listener)return;if(type.startsWith('webgl'))canvas.addEventListener(type,listener,options);else super.addEventListener(type,listener,options);}
  removeEventListener(type:string,listener:EventListenerOrEventListenerObject|null,options?:boolean|EventListenerOptions){if(!listener)return;if(type.startsWith('webgl'))canvas.removeEventListener(type,listener,options);else super.removeEventListener(type,listener,options);}
}
function supported(){
  if(typeof OffscreenCanvas!=='function'||typeof requestAnimationFrame!=='function'||typeof cancelAnimationFrame!=='function')return false;
  try{const frame=requestAnimationFrame(()=>{});cancelAnimationFrame(frame);const probe=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:true,alpha:true,powerPreference:'high-performance'});if(!probe)return false;probe.getExtension('WEBGL_lose_context')?.loseContext();return true;}catch{return false;}
}
function draw(now:number){
  frameId=0;if(disposed||!settings.visible||!scene)return;
  try{
    const next=clock.frame(now,settings.reducedMotion);
    if(next){
      scene.update(next.time,next.delta);
      if(!firstFrame){
        firstFrame=true;
        // Ready follows an actual visible frame through a separate task; no
        // hidden warm-up frame or lower quality path is substituted.
        readyTimer=setTimeout(()=>{readyTimer=null;if(disposed)return;ready=true;post({type:'ready'});},0);
      }
    }
    frameId=requestAnimationFrame(draw);
  }catch{fail();}
}
function applySettings(next:RubikWorkerSettings){
  if(!validRubikSettings(next))throw new Error('Invalid cube settings.');
  const previous=settings;settings=next;if(!surface||!scene)return;
  surface.rectangle=next.rectangle;
  if(previous.finish!==next.finish)scene.setFinish(next.finish);
  if(previous.reducedMotion!==next.reducedMotion)scene.setReducedMotion(next.reducedMotion);
  if(previous.rectangle.width!==next.rectangle.width||previous.rectangle.height!==next.rectangle.height||previous.pixelRatio!==next.pixelRatio)scene.resize();
  const visible=next.visible;scene.setVisible(visible);clock.setVisible(visible);
  if(!visible){cancelAnimationFrame(frameId);frameId=0;}else if(!frameId)frameId=requestAnimationFrame(draw);
}
scope.onmessage=({data})=>{
  if(disposed||!data||!Number.isSafeInteger(data.generation)||data.generation<=0)return;
  try{
    if(data.type==='probe'&&!generation){generation=data.generation;post({type:'capabilities',supported:supported()});return;}
    if(data.generation!==generation)return;
    if(data.type==='dispose'){dispose();return;}
    if(data.type==='presentation-ack'){
      if(presentationInFlight&&data.sequence===presentationInFlight){presentationInFlight=0;flushPresentation();}return;
    }
    if(data.type==='init'){
      if(initializing||scene||!(data.canvas instanceof OffscreenCanvas)||!validRubikSettings(data.settings))throw new Error('Invalid cube initialization.');
      initializing=true;canvas=data.canvas;settings=data.settings;surface=new WorkerSurface(settings.rectangle);
      canvas.addEventListener('webglcontextlost',onContextLost);canvas.addEventListener('webglcontextcreationerror',onContextCreationError);
      const motionQuery=Object.assign(new EventTarget(),{matches:settings.reducedMotion});
      scene=initRubik(surface,{
        controlsRoot:null,bindControls:false,maxPixelRatio:1.5,toothQuality:'high',autoRotate:true,reducedMotion:settings.reducedMotion,finish:settings.finish,
        platform:{pixelRatio:()=>settings.pixelRatio,motionQuery:()=>motionQuery,windowEvents:new EventTarget(),controlsRoot:null},
      });
      if(disposed){scene.dispose();scene=null;return;}
      // Synchronous scene/environment preparation may already have begun when
      // hide arrives, but ongoing frames obey the latest host visibility.
      applySettings(settings);return;
    }
    if(!scene)return;
    if(data.type==='settings'){
      if(!Number.isSafeInteger(data.sequence)||data.sequence<=0)throw new Error('Invalid cube settings sequence.');
      if(data.sequence<=settingsSequence)return;settingsSequence=data.sequence;applySettings(data.settings);post({type:'settings-ack',sequence:data.sequence});
    }else if(data.type==='input'){
      if(!Number.isSafeInteger(data.sequence)||data.sequence<=0)throw new Error('Invalid cube input sequence.');
      if(data.sequence<=inputSequence)return;
      if(typeof data.cancel!=='boolean'||!Array.isArray(data.events)||data.events.length>64||!data.events.every(validRubikInput))throw new Error('Invalid cube input.');
      inputSequence=data.sequence;if(data.cancel||!ready||!settings.visible)scene.cancelPointer();
      if(ready&&settings.visible)for(const input of data.events){
        if(input.rectangle)surface.rectangle=input.rectangle;
        const event=new Event(input.type,{cancelable:true});
        for(const [key,value] of Object.entries(input))if(key!=='type'&&key!=='rectangle')Object.defineProperty(event,key,{value});
        surface.dispatchEvent(event);
      }
      // Input geometry is from dispatch time; later resize always uses the
      // latest host bounds rather than retaining an old scrolled rectangle.
      surface.rectangle=settings.rectangle;post({type:'input-ack',sequence:data.sequence});
    }
  }catch{fail();}
};
