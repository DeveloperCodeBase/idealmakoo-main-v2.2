import type {HeroFramingOptions} from './framing';
import type {HeroRectangle} from './hero-platform';
import {createHeroInputMailbox, heroInputKeys, type HeroHostMessage, type HeroInput, type HeroWorkerMessage, type HeroWorkerSettings} from './hero-worker-protocol';

type SceneWorker = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'>;
interface WorkerHeroOptions extends HeroFramingOptions {
  theme?: 'light' | 'dark';
  reducedMotion?: boolean;
  autoDemonstrate?: boolean;
  agentElement?: HTMLElement | null;
  signal?: AbortSignal;
  onError(): void;
  /** A dependency boundary for lifecycle tests, never an audit/runtime switch. */
  workerFactory?: () => SceneWorker;
  timeoutMs?: number;
}
const transferred = new WeakSet<HTMLCanvasElement>();
let nextGeneration = 0;
export function wasHeroCanvasTransferred(canvas: HTMLCanvasElement) { return transferred.has(canvas); }
export function supportsHeroWorker() { return typeof Worker === 'function' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'; }
const cancelled = () => new DOMException('Scene preparation was cancelled.', 'AbortError');
const failed = () => new Error('The scene worker could not be initialized.');
function rectangle(canvas: HTMLCanvasElement): HeroRectangle {
  const bounds = canvas.getBoundingClientRect();
  return {left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height};
}

/** Owns one worker and one one-shot transferred canvas. React owns replacement
 * canvases on failure; this controller never replaces or reparents a DOM node. */
export async function createHeroWorker(canvas: HTMLCanvasElement, options: WorkerHeroOptions) {
  if (options.signal?.aborted) throw cancelled();
  if (wasHeroCanvasTransferred(canvas)) throw new Error('A transferred canvas requires a fresh React canvas.');
  const worker = options.workerFactory ? options.workerFactory() : new Worker(new URL('./hero.worker.ts', import.meta.url), {type: 'module', name: 'idealmakoo-hero'});
  const generation = ++nextGeneration;
  let disposed = false, ready = false, settled = false, initialized = false;
  let settingsSequence = 0, settingsInFlight = 0, settingsDirty = false, presentationSequence = 0;
  let resolveReady: () => void, rejectReady: (error: Error) => void;
  const prepared = new Promise<void>((resolve, reject) => {resolveReady = resolve; rejectReady = reject;});
  const settings: HeroWorkerSettings = {
    rectangle: rectangle(canvas), pixelRatio: window.devicePixelRatio || 1,
    theme: options.theme || 'dark', reducedMotion: Boolean(options.reducedMotion), visible: false,
    framing: {composition: options.composition, locale: options.locale, direction: options.direction, region: options.region},
  };
  const cleanups: (() => void)[] = [];
  const captures = new Set<number>();
  const send = (message: HeroHostMessage, transfer: Transferable[] = []) => {
    if (disposed) return;
    try { worker.postMessage(message, transfer); } catch { fail(); }
  };
  const inputs = createHeroInputMailbox((sequence, events, cancel) => send({type: 'input', generation, sequence, rectangle: rectangle(canvas), events, cancel}));
  const flushSettings = () => {
    if (disposed || !ready || settingsInFlight || !settingsDirty) return;
    settingsDirty = false; settingsInFlight = ++settingsSequence;
    send({type: 'settings', generation, sequence: settingsInFlight, settings: {...settings, rectangle: {...settings.rectangle}, framing: {...settings.framing}}});
  };
  const changed = () => { settingsDirty = true; flushSettings(); };
  const releaseCapture = (id: number) => { captures.delete(id); try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch { /* The canvas may have left the DOM. */ } };
  const listen = (target: EventTarget, type: string, listener: EventListener, config?: AddEventListenerOptions) => {
    target.addEventListener(type, listener, config); cleanups.push(() => target.removeEventListener(type, listener, config));
  };
  function dispose() {
    if (disposed) return;
    disposed = true; ready = false; clearTimeout(timeout);
    inputs.dispose(); cleanups.splice(0).forEach(remove => remove());
    for (const id of captures) releaseCapture(id);
    options.signal?.removeEventListener('abort', onAbort);
    worker.removeEventListener('message', onMessage); worker.removeEventListener('error', onWorkerError); worker.removeEventListener('messageerror', onWorkerError);
    // Terminating an owned worker also releases its native WebGL context, even
    // if the renderer is inside a driver call or an asynchronous shader poll.
    try { worker.postMessage({type: 'dispose', generation} satisfies HeroHostMessage); } catch { /* Termination remains available. */ }
    worker.terminate();
    if (options.agentElement) { options.agentElement.style.opacity = '0'; options.agentElement.dataset.phase = 'idle'; }
    if (!settled) { settled = true; rejectReady(cancelled()); }
  }
  function fail() {
    if (disposed) return;
    const wasReady = ready;
    if (!settled) { settled = true; rejectReady(failed()); }
    dispose();
    if (wasReady) options.onError();
  }
  function onAbort() { dispose(); }
  function onWorkerError(event?: Event) { event?.preventDefault(); fail(); }
  function onMessage(event: Event) {
    const message = (event as MessageEvent<HeroWorkerMessage>).data;
    if (disposed || !message || message.generation !== generation) return;
    if (message.type === 'capabilities') {
      if (initialized || ready) return;
      if (!message.supported || options.signal?.aborted) { fail(); return; }
      initialized = true;
      try {
        const offscreen = canvas.transferControlToOffscreen(); transferred.add(canvas);
        send({type: 'init', generation, canvas: offscreen, settings: {...settings}, autoDemonstrate: options.autoDemonstrate !== false}, [offscreen]);
      } catch { fail(); }
    } else if (message.type === 'ready') {
      if (!initialized || settled) return;
      ready = true; settled = true; clearTimeout(timeout); resolveReady();
    } else if (message.type === 'error') fail();
    else if (message.type === 'settings-ack' && message.sequence === settingsInFlight) { settingsInFlight = 0; flushSettings(); }
    else if (message.type === 'input-ack') inputs.acknowledge(message.sequence);
    else if (message.type === 'presentation' && Number.isSafeInteger(message.sequence) && message.sequence > presentationSequence) {
      presentationSequence = message.sequence;
      const value = message.presentation;
      if (ready && settings.visible && value) {
        if (['grab', 'grabbing', 'crosshair'].includes(value.cursor)) canvas.style.cursor = value.cursor;
        if (options.agentElement && typeof value.transform === 'string' && value.transform.length < 160 && /^(?:|translate3d\([-\d.]+px,[-\d.]+px,0\))$/.test(value.transform) && ['arrow', 'hand'].includes(value.mode) && ['idle', 'approach', 'grip', 'lift', 'carry', 'lower', 'release', 'depart'].includes(value.phase)) {
          const opacity = Number(value.opacity);
          if (Number.isFinite(opacity) && opacity >= 0 && opacity <= 1) {
            options.agentElement.style.transform = value.transform; options.agentElement.style.opacity = value.opacity;
            options.agentElement.dataset.mode = value.mode; options.agentElement.dataset.phase = value.phase;
          }
        }
      }
      send({type: 'presentation-ack', generation, sequence: message.sequence});
    }
  }
  const timeout = setTimeout(fail, options.timeoutMs ?? 45000);
  worker.addEventListener('message', onMessage); worker.addEventListener('error', onWorkerError); worker.addEventListener('messageerror', onWorkerError);
  options.signal?.addEventListener('abort', onAbort, {once: true});
  send({type: 'probe', generation});
  try { await prepared; } catch (error) { dispose(); throw error; }
  if (disposed || options.signal?.aborted) { dispose(); throw cancelled(); }

  const onPointer = (event: PointerEvent) => {
    const ending = ['pointerup', 'pointercancel', 'lostpointercapture'].includes(event.type);
    if (!ready || !settings.visible || (!event.isPrimary && !(ending && captures.has(event.pointerId)))) return;
    if (event.type === 'pointerdown') {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault(); canvas.focus({preventScroll: true});
      try { canvas.setPointerCapture(event.pointerId); captures.add(event.pointerId); } catch { /* An already-ended pointer cannot be captured. */ }
      canvas.style.cursor = 'grabbing';
    }
    inputs.enqueue({type: event.type as HeroInput['type'], timeStamp: event.timeStamp, isPrimary: event.isPrimary, pointerId: event.pointerId, button: event.button, clientX: event.clientX, clientY: event.clientY, rectangle: rectangle(canvas)});
    if (event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'lostpointercapture') { releaseCapture(event.pointerId); canvas.style.cursor = 'grab'; }
  };
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave']) listen(canvas, type, onPointer as EventListener);
  listen(canvas, 'contextmenu', event => event.preventDefault());
  listen(canvas, 'keydown', ((event: KeyboardEvent) => {
    if (!ready || !settings.visible || !heroInputKeys.has(event.key)) return;
    if (event.key !== 'Escape') event.preventDefault();
    inputs.enqueue({type: 'keydown', timeStamp: event.timeStamp, key: event.key, shiftKey: event.shiftKey});
  }) as EventListener);
  const resize = () => { if (disposed) return; settings.rectangle = rectangle(canvas); settings.pixelRatio = window.devicePixelRatio || 1; changed(); };
  const observer = new ResizeObserver(resize); observer.observe(canvas); cleanups.push(() => observer.disconnect());
  listen(window, 'resize', resize, {passive: true}); listen(window, 'scroll', resize, {passive: true, capture: true});
  canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab';
  return {
    prepare: () => Promise.resolve(),
    resize,
    dispose,
    setTheme(value: 'dark' | 'light') { settings.theme = value; changed(); },
    setReducedMotion(value: boolean) { settings.reducedMotion = value; changed(); },
    setFraming(value: HeroFramingOptions) { settings.framing = {...value}; changed(); },
    setVisible(value: boolean) {
      if (disposed) return;
      settings.visible = value;
      if (!value) {
        inputs.cancel(); for (const id of captures) releaseCapture(id); canvas.style.cursor = 'grab';
        if (options.agentElement) options.agentElement.style.opacity = '0';
      }
      changed();
    },
  };
}
