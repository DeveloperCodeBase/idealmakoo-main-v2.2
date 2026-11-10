import {createAuthControlMailbox, type AuthHostMessage, type AuthWorkerMessage, type AuthWorkerSettings} from './auth-worker-protocol';

type SceneWorker = Pick<Worker,'postMessage'|'terminate'|'addEventListener'|'removeEventListener'>;
interface AuthWorkerOptions {
  theme: 'dark' | 'light';
  mode: 'login' | 'signup';
  privacy: boolean;
  reducedMotion: boolean;
  signal?: AbortSignal;
  onError(): void;
  workerFactory?: () => SceneWorker;
  timeoutMs?: number;
}
const transferred = new WeakSet<HTMLCanvasElement>();
let nextGeneration = 0;
export function wasAuthCanvasTransferred(canvas: HTMLCanvasElement) { return transferred.has(canvas); }
export function supportsAuthWorker() { return typeof Worker === 'function' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'; }
const cancelled = () => new DOMException('Scene preparation was cancelled.', 'AbortError');
const failed = () => new Error('The auth scene worker could not be initialized.');
const bounds = (canvas: HTMLCanvasElement) => { const r = canvas.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; };

/** React keeps ownership of the canvas and creates a new node after a failed
 * transfer. A worker never receives form text or runs a second host RAF loop. */
export async function createAuthWorker(canvas: HTMLCanvasElement, options: AuthWorkerOptions) {
  if (options.signal?.aborted) throw cancelled();
  if (wasAuthCanvasTransferred(canvas)) throw new Error('A transferred canvas requires a fresh React canvas.');
  const worker = options.workerFactory ? options.workerFactory() : new Worker(new URL('./auth.worker.ts', import.meta.url), {type:'module',name:'idealmakoo-auth'});
  const generation = ++nextGeneration;
  let disposed=false,ready=false,settled=false,initialized=false,settingsSequence=0,settingsInFlight=0,settingsDirty=false;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const prepared = new Promise<void>((resolve,reject) => {resolveReady=resolve;rejectReady=reject;});
  const settings: AuthWorkerSettings = {rectangle:bounds(canvas),pixelRatio:window.devicePixelRatio||1,theme:options.theme,mode:options.mode,privacy:options.privacy,reducedMotion:options.reducedMotion,visible:false};
  const cleanups: (()=>void)[] = [];
  const send = (message: AuthHostMessage, transfer: Transferable[] = []) => { if (!disposed) try {worker.postMessage(message,transfer);} catch {fail();} };
  const controls = createAuthControlMailbox((sequence,batch,reset) => send({type:'controls',generation,sequence,controls:batch,reset}));
  controls.pause();
  const flushSettings = () => {
    if (disposed || !ready || settingsInFlight || !settingsDirty) return;
    settingsDirty=false;settingsInFlight=++settingsSequence;
    send({type:'settings',generation,sequence:settingsInFlight,settings:{...settings,rectangle:{...settings.rectangle}}});
  };
  const changed = () => { if (disposed) return; controls.pause();settingsDirty=true;flushSettings(); };
  const listen = (target: EventTarget,type: string,listener: EventListener,config?: AddEventListenerOptions) => {
    target.addEventListener(type,listener,config);cleanups.push(()=>target.removeEventListener(type,listener,config));
  };
  function dispose() {
    if (disposed) return;
    disposed=true;ready=false;clearTimeout(timeout);controls.dispose();
    for (const remove of cleanups.splice(0)) try {remove();} catch { /* Complete owned cleanup. */ }
    options.signal?.removeEventListener('abort',onAbort);
    worker.removeEventListener('message',onMessage);worker.removeEventListener('error',onWorkerError);worker.removeEventListener('messageerror',onWorkerError);
    try {worker.postMessage({type:'dispose',generation} satisfies AuthHostMessage);} catch { /* Terminate still releases the owned context. */ }
    worker.terminate();
    if (!settled) {settled=true;rejectReady(cancelled());}
  }
  function fail() {
    if (disposed) return;
    const wasReady=ready;
    if (!settled) {settled=true;rejectReady(failed());}
    dispose();if(wasReady)options.onError();
  }
  function onAbort() {dispose();}
  function onWorkerError(event?: Event) {event?.preventDefault();fail();}
  function onMessage(event: Event) {
    const message=(event as MessageEvent<AuthWorkerMessage>).data;
    if(disposed||!message||message.generation!==generation)return;
    if(message.type==='capabilities') {
      if(initialized||ready)return;
      if(!message.supported||options.signal?.aborted){fail();return;}
      initialized=true;
      try {const offscreen=canvas.transferControlToOffscreen();transferred.add(canvas);send({type:'init',generation,canvas:offscreen,settings:{...settings,rectangle:{...settings.rectangle}}},[offscreen]);}catch{fail();}
    }else if(message.type==='ready') {
      if(!initialized||settled)return;
      ready=true;settled=true;clearTimeout(timeout);resolveReady();
    }else if(message.type==='error')fail();
    else if(message.type==='settings-ack'&&settingsInFlight&&message.sequence===settingsInFlight){settingsInFlight=0;flushSettings();if(!settingsInFlight&&!settingsDirty&&settings.visible)controls.resume();}
    else if(message.type==='controls-ack')controls.acknowledge(message.sequence);
  }
  const timeout=setTimeout(fail,options.timeoutMs??45000);
  worker.addEventListener('message',onMessage);worker.addEventListener('error',onWorkerError);worker.addEventListener('messageerror',onWorkerError);
  options.signal?.addEventListener('abort',onAbort,{once:true});send({type:'probe',generation});
  try{await prepared;}catch(error){dispose();throw error;}
  if(disposed||options.signal?.aborted){dispose();throw cancelled();}
  const resize=()=>{if(disposed)return;settings.rectangle=bounds(canvas);settings.pixelRatio=window.devicePixelRatio||1;changed();};
  try {
    if(typeof ResizeObserver==='function') {const observer=new ResizeObserver(resize);cleanups.push(()=>observer.disconnect());observer.observe(canvas);}
    listen(window,'resize',resize,{passive:true});
  }catch(error){dispose();throw error;}
  return {
    supported:true,prepare:()=>Promise.resolve(),resize,dispose,destroy:dispose,
    setTheme(value:'dark'|'light'){settings.theme=value;changed();},
    setMode(value:'login'|'signup'){settings.mode=value;changed();},
    setPrivacy(value:boolean){settings.privacy=Boolean(value);changed();},
    setReducedMotion(value:boolean){settings.reducedMotion=Boolean(value);changed();},
    setVisible(value:boolean){if(disposed)return;settings.visible=Boolean(value);controls.pause();if(!value)controls.clear();changed();},
    setPointer(x:number,y:number){if(!ready||!settings.visible||!Number.isFinite(x)||!Number.isFinite(y))return;controls.enqueue({type:'pointer',x:Math.max(-1,Math.min(1,x)),y:Math.max(-1,Math.min(1,y)),count:1});},
    setOrbit(yaw:number,pitch:number){if(!ready||!settings.visible||!Number.isFinite(yaw)||!Number.isFinite(pitch))return;controls.enqueue({type:'orbit',yaw:Math.max(-.55,Math.min(.55,yaw)),pitch:Math.max(-.22,Math.min(.22,pitch)),count:1});},
    resetOrbit(){controls.enqueue({type:'resetOrbit'});},
    celebrate(){controls.enqueue({type:'celebrate'});},
  };
}
