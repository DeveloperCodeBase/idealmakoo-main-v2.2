import type {HeroFramingOptions} from './framing';
import type {HeroRectangle} from './hero-platform';

export interface HeroWorkerSettings {
  rectangle: HeroRectangle;
  pixelRatio: number;
  theme: 'dark' | 'light';
  reducedMotion: boolean;
  visible: boolean;
  framing: HeroFramingOptions;
}
export interface HeroInput {
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'pointerleave' | 'keydown';
  timeStamp: number;
  isPrimary?: boolean;
  pointerId?: number;
  button?: number;
  clientX?: number;
  clientY?: number;
  key?: string;
  shiftKey?: boolean;
  rectangle?: HeroRectangle;
}
export interface HeroPresentation {
  transform: string;
  opacity: string;
  mode: string;
  phase: string;
  cursor: string;
}
export type HeroHostMessage =
  | {type: 'probe'; generation: number}
  | {type: 'init'; generation: number; canvas: OffscreenCanvas; settings: HeroWorkerSettings; autoDemonstrate: boolean}
  | {type: 'settings'; generation: number; sequence: number; settings: HeroWorkerSettings}
  | {type: 'input'; generation: number; sequence: number; rectangle: HeroRectangle; events: HeroInput[]; cancel: boolean}
  | {type: 'presentation-ack'; generation: number; sequence: number}
  | {type: 'dispose'; generation: number};
export type HeroWorkerMessage =
  | {type: 'capabilities'; generation: number; supported: boolean}
  | {type: 'ready'; generation: number}
  | {type: 'settings-ack' | 'input-ack'; generation: number; sequence: number}
  | {type: 'presentation'; generation: number; sequence: number; presentation: HeroPresentation}
  | {type: 'error'; generation: number};

const keys = new Set(['1', '2', 'Escape', 'Home', 'Enter', 'r', 'R', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
export const heroInputKeys = keys;
const pointerTypes = new Set(['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave']);
export function validHeroRectangle(value: unknown): value is HeroRectangle {
  if (!value || typeof value !== 'object') return false;
  const rectangle = value as HeroRectangle;
  return [rectangle.left, rectangle.top, rectangle.width, rectangle.height].every(value => Number.isFinite(value) && Math.abs(value) <= 1e7) && rectangle.width >= 0 && rectangle.height >= 0;
}
export function validHeroInput(value: unknown): value is HeroInput {
  if (!value || typeof value !== 'object') return false;
  const event = value as HeroInput;
  if (!Number.isFinite(event.timeStamp) || event.timeStamp < 0 || event.timeStamp > 1e15) return false;
  if (event.rectangle !== undefined && !validHeroRectangle(event.rectangle)) return false;
  if (event.type === 'keydown') return typeof event.key === 'string' && keys.has(event.key) && typeof event.shiftKey === 'boolean';
  return pointerTypes.has(event.type) && Number.isInteger(event.pointerId) && Number.isFinite(event.button) && typeof event.isPrimary === 'boolean' && [event.clientX, event.clientY].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e7);
}

/** One acknowledged input batch at a time. Motion is coalesced only between
 * interaction boundaries. A pathological flood cancels a grab instead of
 * retaining an unbounded queue or leaving a tooth stuck to a lost pointer. */
export function createHeroInputMailbox(send: (sequence: number, events: HeroInput[], cancel: boolean) => void, limit = 64) {
  let pending: HeroInput[] = [], cancelled = false, sequence = 0, inFlight = 0, stopped = false;
  const flush = () => {
    if (stopped || inFlight || (!pending.length && !cancelled)) return;
    const events = pending; pending = []; const cancel = cancelled; cancelled = false;
    inFlight = ++sequence; send(inFlight, events, cancel);
  };
  return {
    enqueue(event: HeroInput) {
      if (stopped || !validHeroInput(event)) return;
      const last = pending.at(-1);
      if (event.type === 'pointermove' && last?.type === 'pointermove' && last.pointerId === event.pointerId) pending[pending.length - 1] = event;
      else {
        if (pending.length >= limit) { pending = []; cancelled = true; }
        pending.push(event);
      }
      flush();
    },
    acknowledge(value: number) { if (value !== inFlight || !inFlight) return; inFlight = 0; flush(); },
    cancel() { pending = []; cancelled = true; flush(); },
    dispose() { stopped = true; pending = []; cancelled = false; inFlight = 0; },
    getState: () => ({pending: pending.length, inFlight, sequence, cancelled, stopped}),
  };
}
