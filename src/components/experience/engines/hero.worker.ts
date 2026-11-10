import {initHero} from './hero';
import {createSceneClock} from './scene-clock';
import type {HeroAgentElement, HeroRectangle, HeroSurface} from './hero-platform';
import {validHeroInput, validHeroRectangle, type HeroHostMessage, type HeroPresentation, type HeroWorkerMessage, type HeroWorkerSettings} from './hero-worker-protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HeroHostMessage>) => void) | null;
  postMessage(value: HeroWorkerMessage): void;
};
let generation = 0, disposed = false, ready = false;
let canvas: OffscreenCanvas, surface: WorkerSurface, scene: ReturnType<typeof initHero> | null = null;
let settings: HeroWorkerSettings, frameId = 0, publishTimer: ReturnType<typeof setTimeout> | null = null;
let presentationSequence = 0, presentationInFlight = 0, stagedPresentation: HeroPresentation | null = null;
let inputSequence = 0, settingsSequence = 0;
const clock = createSceneClock();
const agent: HeroAgentElement = {style: {transform: '', opacity: '0'}, dataset: {mode: 'arrow', phase: 'idle'}};
type OutgoingMessage<T> = T extends unknown ? Omit<T, 'generation'> : never;
function post(message: OutgoingMessage<HeroWorkerMessage>) { if (!disposed) scope.postMessage({...message, generation} as HeroWorkerMessage); }
function fail() {
  if (disposed) return;
  post({type: 'error'}); dispose();
}
function dispose() {
  if (disposed) return;
  disposed = true; ready = false; clock.setVisible(false);
  cancelAnimationFrame(frameId); frameId = 0;
  if (publishTimer !== null) clearTimeout(publishTimer);
  publishTimer = null; stagedPresentation = null;
  scene?.dispose(); scene = null;
}
class WorkerSurface extends EventTarget implements HeroSurface {
  style = {cursor: 'grab', touchAction: 'none'};
  rectangle: HeroRectangle;
  constructor(rectangle: HeroRectangle) { super(); this.rectangle = rectangle; }
  get width() { return canvas.width; } set width(value: number) { canvas.width = value; }
  get height() { return canvas.height; } set height(value: number) { canvas.height = value; }
  getContext(kind: string, attributes?: WebGLContextAttributes) { return kind === 'webgl2' ? canvas.getContext('webgl2', attributes) : null; }
  getBoundingClientRect() { return this.rectangle; }
  // Browser activation and capture are performed synchronously by the host.
  focus() {}
  setPointerCapture() {}
  hasPointerCapture() { return true; }
  releasePointerCapture() {}
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (!listener) return;
    if (type.startsWith('webgl')) canvas.addEventListener(type, listener, options);
    else super.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    if (!listener) return;
    if (type.startsWith('webgl')) canvas.removeEventListener(type, listener, options);
    else super.removeEventListener(type, listener, options);
  }
}
function validSettings(value: HeroWorkerSettings) {
  return value && validHeroRectangle(value.rectangle) && Number.isFinite(value.pixelRatio) && value.pixelRatio > 0 && value.pixelRatio <= 64 &&
    (value.theme === 'dark' || value.theme === 'light') && typeof value.visible === 'boolean' && typeof value.reducedMotion === 'boolean' && value.framing &&
    ['centered', 'landing'].includes(value.framing.composition || 'centered');
}
function publish() {
  publishTimer = null;
  if (disposed || presentationInFlight || !stagedPresentation) return;
  const presentation = stagedPresentation; stagedPresentation = null;
  presentationInFlight = ++presentationSequence;
  post({type: 'presentation', sequence: presentationInFlight, presentation});
}
function stagePresentation() {
  stagedPresentation = {transform: agent.style.transform, opacity: agent.style.opacity, mode: agent.dataset.mode || 'arrow', phase: agent.dataset.phase || 'idle', cursor: surface.style.cursor};
  // A separate worker task lets the current OffscreenCanvas rendering update
  // produce its placeholder resource before its companion DOM hand is sent.
  if (publishTimer === null && !presentationInFlight) publishTimer = setTimeout(publish, 0);
}
function draw(now: number) {
  frameId = 0;
  if (disposed || !ready || !settings.visible || !scene) return;
  try {
    const frame = clock.frame(now, settings.reducedMotion);
    if (frame) { scene.update(frame.time, frame.delta); stagePresentation(); }
    frameId = requestAnimationFrame(draw);
  } catch { fail(); }
}
function applySettings(next: HeroWorkerSettings) {
  if (!validSettings(next)) throw new Error('Invalid scene settings.');
  const previous = settings; settings = next;
  if (!surface || !scene) return;
  surface.rectangle = next.rectangle;
  if (previous.theme !== next.theme) scene.setTheme(next.theme);
  if (previous.reducedMotion !== next.reducedMotion) scene.setReducedMotion(next.reducedMotion);
  if (JSON.stringify(previous.framing) !== JSON.stringify(next.framing)) scene.setFraming(next.framing);
  if (previous.rectangle.width !== next.rectangle.width || previous.rectangle.height !== next.rectangle.height || previous.pixelRatio !== next.pixelRatio) scene.resize();
  const visible = ready && next.visible;
  scene.setVisible(visible); clock.setVisible(visible);
  if (!visible) { cancelAnimationFrame(frameId); frameId = 0; }
  else if (!frameId) frameId = requestAnimationFrame(draw);
}
function supported() {
  if (typeof OffscreenCanvas !== 'function' || typeof requestAnimationFrame !== 'function' || typeof cancelAnimationFrame !== 'function') return false;
  try {
    const frame = requestAnimationFrame(() => {}); cancelAnimationFrame(frame);
    const probe = new OffscreenCanvas(1, 1).getContext('webgl2', {antialias: true, powerPreference: 'high-performance'});
    if (!probe) return false;
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}
scope.onmessage = async ({data}) => {
  if (disposed || !data || !Number.isSafeInteger(data.generation) || data.generation <= 0) return;
  try {
    if (data.type === 'probe' && !generation) {
      generation = data.generation; post({type: 'capabilities', supported: supported()}); return;
    }
    if (data.generation !== generation) return;
    if (data.type === 'dispose') { dispose(); return; }
    if (data.type === 'init') {
      if (scene || !validSettings(data.settings) || !(data.canvas instanceof OffscreenCanvas)) throw new Error('Invalid scene initialization.');
      canvas = data.canvas; settings = data.settings; surface = new WorkerSurface(settings.rectangle);
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(); });
      canvas.addEventListener('webglcontextcreationerror', fail);
      scene = initHero(surface, {
        ...settings.framing, theme: settings.theme, reducedMotion: settings.reducedMotion,
        quality: settings.rectangle.width < 720 ? 'standard' : 'high', autoDemonstrate: data.autoDemonstrate,
        agentElement: agent,
        platform: {pixelRatio: () => settings.pixelRatio, observeResize: () => ({disconnect() {}})},
      });
      scene.setVisible(false);
      await scene.prepare();
      if (disposed) return;
      // Compiled programs do not yet provide a visible placeholder image.
      // Draw the unchanged initial pose in a real worker frame, then announce
      // readiness in a separate task after its native frame resource is made.
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        if (disposed || !scene) return;
        try {
          scene.setVisible(true); scene.update(0, 0); scene.setVisible(false);
          publishTimer = setTimeout(() => {
            publishTimer = null;
            if (disposed) return;
            ready = true; post({type: 'ready'}); applySettings(settings);
          }, 0);
        } catch { fail(); }
      });
      return;
    }
    if (!ready || !scene) return;
    if (data.type === 'settings') {
      if (!Number.isSafeInteger(data.sequence) || data.sequence <= settingsSequence) return;
      settingsSequence = data.sequence; applySettings(data.settings);
      post({type: 'settings-ack', sequence: data.sequence});
    } else if (data.type === 'input') {
      if (!Number.isSafeInteger(data.sequence) || data.sequence <= inputSequence || !validHeroRectangle(data.rectangle) || !Array.isArray(data.events) || data.events.length > 64 || !data.events.every(validHeroInput)) throw new Error('Invalid scene input.');
      inputSequence = data.sequence; surface.rectangle = data.rectangle;
      if (data.cancel || !settings.visible) scene.cancelDrag();
      if (settings.visible) for (const input of data.events) {
        surface.rectangle = input.rectangle || data.rectangle;
        const event = new Event(input.type, {cancelable: true});
        for (const [key, value] of Object.entries(input)) if (key !== 'type' && key !== 'rectangle') Object.defineProperty(event, key, {value});
        surface.dispatchEvent(event);
      }
      post({type: 'input-ack', sequence: data.sequence});
    } else if (data.type === 'presentation-ack' && data.sequence === presentationInFlight) {
      presentationInFlight = 0;
      if (stagedPresentation && publishTimer === null) publishTimer = setTimeout(publish, 0);
    }
  } catch { fail(); }
};
