import {createRubikInputMailbox,rubikInputKeys,type RubikHostMessage,type RubikInput,type RubikWorkerMessage,type RubikWorkerSettings} from './rubik-worker-protocol';

type SceneWorker=Pick<Worker,'postMessage'|'terminate'|'addEventListener'|'removeEventListener'>;
interface RubikWorkerOptions {
  finish:'Glass'|'Neon';reducedMotion:boolean;signal?:AbortSignal;onError():void;
  workerFactory?:()=>SceneWorker;timeoutMs?:number;
}
const transferred=new WeakSet<HTMLCanvasElement>();let nextGeneration=0;
export function wasRubikCanvasTransferred(canvas:HTMLCanvasElement){return transferred.has(canvas);}
export function supportsRubikWorker(){return typeof Worker==='function'&&typeof HTMLCanvasElement!=='undefined'&&typeof HTMLCanvasElement.prototype.transferControlToOffscreen==='function';}
const cancelled=()=>new DOMException('Scene preparation was cancelled.','AbortError');
const failed=()=>new Error('The cube worker could not be initialized.');
const bounds=(canvas:HTMLCanvasElement)=>{const r=canvas.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};

/** Return ownership immediately, so visibility, resize and cancellation remain
 * available during preparation. The worker exclusively owns its render loop. */
export function createRubikWorker(canvas:HTMLCanvasElement,options:RubikWorkerOptions){
  if(options.signal?.aborted)throw cancelled();
  if(wasRubikCanvasTransferred(canvas))throw new Error('A transferred canvas requires a fresh React canvas.');
  const worker=options.workerFactory?options.workerFactory():new Worker(new URL('./rubik.worker.ts',import.meta.url),{type:'module',name:'idealmakoo-rubik'});
  const generation=++nextGeneration;
  let disposed=false,ready=false,settled=false,initialized=false,settingsSequence=0,settingsInFlight=0,settingsDirty=false,presentationSequence=0;
  let resolveReady!:()=>void,rejectReady!:(error:Error)=>void;
  const prepared=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  // A synchronous abort can precede the caller's prepare() attachment.
  void prepared.catch(()=>{});
  const settings:RubikWorkerSettings={rectangle:bounds(canvas),pixelRatio:window.devicePixelRatio||1,finish:options.finish,reducedMotion:options.reducedMotion,visible:false};
  const cleanups:(()=>void)[]=[],captures=new Set<number>();
  let timeout:ReturnType<typeof setTimeout>|null=null,budgetStarted:number|null=null,remaining=options.timeoutMs??45000;
  const pauseBudget=()=>{
    if(timeout!==null){clearTimeout(timeout);timeout=null;}
    if(budgetStarted!==null){remaining=Math.max(0,remaining-(performance.now()-budgetStarted));budgetStarted=null;}
  };
  const updateBudget=()=>{
    if(disposed||ready||!settings.visible){pauseBudget();return;}
    if(timeout!==null)return;
    budgetStarted=performance.now();
    timeout=setTimeout(()=>{timeout=null;budgetStarted=null;remaining=0;fail();},Math.max(1,remaining));
  };
  const send=(message:RubikHostMessage,transfer:Transferable[]=[])=>{if(!disposed)try{worker.postMessage(message,transfer);}catch{fail();}};
  const inputs=createRubikInputMailbox((sequence,events,cancel)=>send({type:'input',generation,sequence,events,cancel}));inputs.pause();
  const resumeInputs=()=>{if(ready&&settings.visible&&!settingsInFlight&&!settingsDirty)inputs.resume();};
  const flushSettings=()=>{
    if(disposed||!initialized||settingsInFlight||!settingsDirty)return;
    settingsDirty=false;settingsInFlight=++settingsSequence;send({type:'settings',generation,sequence:settingsInFlight,settings:{...settings,rectangle:{...settings.rectangle}}});
  };
  // A down accepted by the DOM must not overtake pending visible/geometry state.
  const changed=()=>{if(disposed)return;inputs.pause();settingsDirty=true;flushSettings();};
  const releaseCapture=(id:number)=>{captures.delete(id);try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}catch{/* Canvas can be detached. */}};
  const releaseAll=()=>{for(const id of captures)releaseCapture(id);canvas.style.cursor='grab';canvas.classList.remove('scene-pointer-focus');};
  const listen=(target:EventTarget,type:string,listener:EventListener,config?:AddEventListenerOptions)=>{target.addEventListener(type,listener,config);cleanups.push(()=>target.removeEventListener(type,listener,config));};
  function dispose(){
    if(disposed)return;disposed=true;ready=false;pauseBudget();inputs.dispose();
    for(const remove of cleanups.splice(0))try{remove();}catch{/* Finish owned cleanup. */}
    releaseAll();options.signal?.removeEventListener('abort',onAbort);
    worker.removeEventListener('message',onMessage);worker.removeEventListener('error',onWorkerError);worker.removeEventListener('messageerror',onWorkerError);
    try{worker.postMessage({type:'dispose',generation} satisfies RubikHostMessage);}catch{/* Termination still closes the owned context. */}
    worker.terminate();if(!settled){settled=true;rejectReady(cancelled());}
  }
  function fail(){if(disposed)return;const wasReady=ready;if(!settled){settled=true;rejectReady(failed());}dispose();if(wasReady)options.onError();}
  function onAbort(){dispose();}
  function onWorkerError(event?:Event){event?.preventDefault();fail();}
  function onMessage(event:Event){
    const message=(event as MessageEvent<RubikWorkerMessage>).data;
    if(disposed||!message||message.generation!==generation)return;
    if(message.type==='capabilities'){
      if(initialized||ready)return;if(!message.supported||options.signal?.aborted){fail();return;}initialized=true;
      // All pre-probe changes are already in this initial snapshot.
      settingsDirty=false;
      try{const offscreen=canvas.transferControlToOffscreen();transferred.add(canvas);send({type:'init',generation,canvas:offscreen,settings:{...settings,rectangle:{...settings.rectangle}}},[offscreen]);}catch{fail();}
    }else if(message.type==='ready'){
      if(!initialized||settled)return;ready=true;settled=true;pauseBudget();flushSettings();resumeInputs();resolveReady();
    }else if(message.type==='error')fail();
    else if(message.type==='settings-ack'&&settingsInFlight&&message.sequence===settingsInFlight){settingsInFlight=0;flushSettings();resumeInputs();}
    else if(message.type==='input-ack')inputs.acknowledge(message.sequence);
    else if(message.type==='presentation'&&Number.isSafeInteger(message.sequence)&&message.sequence>presentationSequence&&
      (message.presentation?.cursor==='grab'||message.presentation?.cursor==='grabbing')){
      presentationSequence=message.sequence;canvas.style.cursor=settings.visible?message.presentation.cursor:'grab';
      send({type:'presentation-ack',generation,sequence:message.sequence});
    }
  }
  const onPointer=(event:PointerEvent)=>{
    const ending=['pointerup','pointercancel','lostpointercapture'].includes(event.type);
    if(!ready||!settings.visible||(!event.isPrimary&&!(ending&&captures.has(event.pointerId))))return;
    if(event.type==='pointerdown'){
      if(captures.size||(event.pointerType==='mouse'&&event.button!==0&&event.button!==2))return;
      event.preventDefault();canvas.classList.add('scene-pointer-focus');canvas.focus({preventScroll:true});
      try{canvas.setPointerCapture(event.pointerId);captures.add(event.pointerId);}catch{/* An ended pointer cannot be captured. */}
      canvas.style.cursor='grabbing';
    }else if(captures.has(event.pointerId)&&(event.type==='pointermove'||event.type==='pointerup'))event.preventDefault();
    inputs.enqueue({type:event.type as RubikInput['type'],timeStamp:event.timeStamp,pointerId:event.pointerId,pointerType:['mouse','pen','touch'].includes(event.pointerType)?event.pointerType as 'mouse'|'pen'|'touch':'mouse',button:event.button,isPrimary:event.isPrimary,clientX:event.clientX,clientY:event.clientY,shiftKey:Boolean(event.shiftKey),altKey:Boolean(event.altKey),ctrlKey:Boolean(event.ctrlKey),metaKey:Boolean(event.metaKey),rectangle:bounds(canvas)});
    if(ending){releaseCapture(event.pointerId);canvas.style.cursor='grab';}
  };
  const resize=()=>{if(disposed)return;settings.rectangle=bounds(canvas);settings.pixelRatio=window.devicePixelRatio||1;changed();};
  try{
    worker.addEventListener('message',onMessage);worker.addEventListener('error',onWorkerError);worker.addEventListener('messageerror',onWorkerError);options.signal?.addEventListener('abort',onAbort,{once:true});
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','pointerenter','pointerleave'])listen(canvas,type,onPointer as EventListener);
    listen(canvas,'contextmenu',event=>event.preventDefault());
    listen(canvas,'blur',()=>canvas.classList.remove('scene-pointer-focus'));
    listen(canvas,'keydown',((event:KeyboardEvent)=>{
      if(!ready||!settings.visible)return;canvas.classList.remove('scene-pointer-focus');
      if(event.ctrlKey||event.metaKey||event.altKey||!rubikInputKeys.has(event.key)||(captures.size&&event.key!=='Escape'))return;
      event.preventDefault();inputs.enqueue({type:'keydown',timeStamp:event.timeStamp,key:event.key,shiftKey:Boolean(event.shiftKey),altKey:Boolean(event.altKey),ctrlKey:Boolean(event.ctrlKey),metaKey:Boolean(event.metaKey)});if(event.key==='Escape')releaseAll();
    }) as EventListener);
    listen(window,'blur',()=>{if(ready)inputs.cancel();releaseAll();});
    if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(resize);cleanups.push(()=>observer.disconnect());observer.observe(canvas);}
    listen(window,'resize',resize,{passive:true});listen(window,'scroll',resize,{passive:true,capture:true});
    canvas.style.touchAction='none';canvas.style.cursor='grab';
    // Probe last: a synchronous send failure cannot leave subsequently attached resources.
    if(options.signal?.aborted)onAbort();else send({type:'probe',generation});
  }catch(error){dispose();throw error;}
  return {
    prepare:()=>prepared,resize,dispose,
    setFinish(value:string){if(!disposed&&(value==='Glass'||value==='Neon')&&settings.finish!==value){settings.finish=value;changed();}},
    setReducedMotion(value:boolean){if(!disposed&&settings.reducedMotion!==Boolean(value)){settings.reducedMotion=Boolean(value);changed();}},
    setVisible(value:boolean){
      if(disposed)return;const visible=Boolean(value);if(settings.visible===visible)return;settings.visible=visible;
      inputs.pause();if(!visible){if(ready)inputs.cancel();releaseAll();}
      updateBudget();changed();
    },
  };
}
