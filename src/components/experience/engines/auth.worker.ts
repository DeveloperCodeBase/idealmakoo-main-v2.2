import {createToothScene} from './auth';
import {validAuthControl,validAuthSettings,type AuthHostMessage,type AuthWorkerMessage,type AuthWorkerSettings} from './auth-worker-protocol';

const scope=self as unknown as {onmessage:((event:MessageEvent<AuthHostMessage>)=>void)|null;postMessage(message:AuthWorkerMessage):void};
interface AuthScene {
  supported:boolean;destroy():void;resize():void;setVisible(value:boolean):void;
  setTheme(value:'dark'|'light'):void;setMode(value:'login'|'signup'):void;setPrivacy(value:boolean):void;setReducedMotion(value:boolean):void;
  setPointer(x:number,y:number):void;setOrbit(yaw:number,pitch:number):void;resetOrbit():void;celebrate():void;
}
let generation=0,disposed=false,ready=false,initializing=false,settingsSequence=0,controlsSequence=0;
let canvas:OffscreenCanvas,settings:AuthWorkerSettings,scene:AuthScene|null=null,readyTimer:ReturnType<typeof setTimeout>|null=null;
type Outgoing<T>=T extends unknown?Omit<T,'generation'>:never;
function post(message:Outgoing<AuthWorkerMessage>){if(!disposed)scope.postMessage({...message,generation} as AuthWorkerMessage);}
function dispose(){if(disposed)return;disposed=true;ready=false;if(readyTimer!==null)clearTimeout(readyTimer);readyTimer=null;scene?.destroy();scene=null;}
function fail(){if(disposed)return;post({type:'error'});dispose();}
class AuthSurface extends EventTarget {
  style={cursor:'grab',touchAction:'none'};
  get width(){return canvas.width;} set width(value:number){canvas.width=value;}
  get height(){return canvas.height;} set height(value:number){canvas.height=value;}
  getContext(kind:string,attributes?:WebGLContextAttributes){return kind==='webgl2'?canvas.getContext('webgl2',attributes):null;}
  getBoundingClientRect(){return settings.rectangle;}
  addEventListener(type:string,listener:EventListenerOrEventListenerObject|null,options?:boolean|AddEventListenerOptions){if(listener)canvas.addEventListener(type,listener,options);}
  removeEventListener(type:string,listener:EventListenerOrEventListenerObject|null,options?:boolean|EventListenerOptions){if(listener)canvas.removeEventListener(type,listener,options);}
}
function supported(){
  if(typeof OffscreenCanvas!=='function'||typeof requestAnimationFrame!=='function'||typeof cancelAnimationFrame!=='function')return false;
  try{
    const frame=requestAnimationFrame(()=>{});cancelAnimationFrame(frame);
    if(!new OffscreenCanvas(1,1).getContext('2d'))return false;
    const probe=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:true,alpha:true,premultipliedAlpha:true,powerPreference:'high-performance'});
    if(!probe)return false;probe.getExtension('WEBGL_lose_context')?.loseContext();return true;
  }catch{return false;}
}
function applySettings(next:AuthWorkerSettings){
  if(!validAuthSettings(next))throw new Error('Invalid auth scene settings.');
  const previous=settings;settings=next;if(!scene)return;
  if(previous.theme!==next.theme)scene.setTheme(next.theme);
  if(previous.mode!==next.mode)scene.setMode(next.mode);
  if(previous.privacy!==next.privacy)scene.setPrivacy(next.privacy);
  if(previous.reducedMotion!==next.reducedMotion)scene.setReducedMotion(next.reducedMotion);
  if(previous.rectangle.width!==next.rectangle.width||previous.rectangle.height!==next.rectangle.height||previous.pixelRatio!==next.pixelRatio)scene.resize();
  scene.setVisible(ready&&next.visible);
}
scope.onmessage=({data})=>{
  if(disposed||!data||!Number.isSafeInteger(data.generation)||data.generation<=0)return;
  try{
    if(data.type==='probe'&&!generation){generation=data.generation;post({type:'capabilities',supported:supported()});return;}
    if(data.generation!==generation)return;
    if(data.type==='dispose'){dispose();return;}
    if(data.type==='init'){
      if(initializing||scene||!(data.canvas instanceof OffscreenCanvas)||!validAuthSettings(data.settings))throw new Error('Invalid auth scene initialization.');
      initializing=true;canvas=data.canvas;settings=data.settings;
      canvas.addEventListener('webglcontextcreationerror',fail);
      scene=createToothScene(new AuthSurface(),{
        theme:settings.theme,reducedMotion:settings.reducedMotion,onError:fail,
        platform:{pixelRatio:()=>settings.pixelRatio,hidden:()=>false,createCanvas2D:()=>new OffscreenCanvas(1,1),observeResize:()=>({disconnect(){}})},
        onFirstFrame:()=>{
          if(disposed)return;scene?.setVisible(false);
          // This later task follows the actual worker RAF's native canvas
          // resource dispatch. Readiness is never just shader compilation.
          readyTimer=setTimeout(()=>{readyTimer=null;if(disposed)return;ready=true;post({type:'ready'});applySettings(settings);},0);
        },
      }) as unknown as AuthScene;
      if(disposed){scene.destroy();scene=null;return;}
      if(!scene.supported){fail();return;}
      // Apply initial non-sensitive state before the engine's first RAF.
      scene.setPrivacy(settings.privacy);scene.setMode(settings.mode);return;
    }
    if(!ready||!scene)return;
    if(data.type==='settings'){
      if(!Number.isSafeInteger(data.sequence)||data.sequence<=0)throw new Error('Invalid settings sequence.');
      if(data.sequence<=settingsSequence)return;settingsSequence=data.sequence;applySettings(data.settings);post({type:'settings-ack',sequence:data.sequence});
    }else if(data.type==='controls'){
      if(!Number.isSafeInteger(data.sequence)||data.sequence<=0)throw new Error('Invalid control sequence.');
      if(data.sequence<=controlsSequence)return;
      if(typeof data.reset!=='boolean'||!Array.isArray(data.controls)||data.controls.length>32||!data.controls.every(validAuthControl))throw new Error('Invalid auth controls.');
      controlsSequence=data.sequence;if(data.reset)scene.resetOrbit();
      if(settings.visible)for(const control of data.controls){
        if(control.type==='pointer')for(let i=0;i<control.count;i++)scene.setPointer(control.x,control.y);
        else if(control.type==='orbit')for(let i=0;i<control.count;i++)scene.setOrbit(control.yaw,control.pitch);
        else if(control.type==='resetOrbit')scene.resetOrbit();
        else if(control.type==='celebrate')scene.celebrate();
      }
      post({type:'controls-ack',sequence:data.sequence});
    }
  }catch{fail();}
};
