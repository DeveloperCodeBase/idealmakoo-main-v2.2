import type {RubikRectangle} from './rubik-platform';

export interface RubikWorkerSettings {
  rectangle: RubikRectangle;
  pixelRatio: number;
  finish: 'Glass' | 'Neon';
  reducedMotion: boolean;
  visible: boolean;
}
export interface RubikInput {
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'pointerenter' | 'pointerleave' | 'keydown';
  timeStamp: number;
  pointerId?: number;
  pointerType?: 'mouse' | 'pen' | 'touch';
  button?: number;
  isPrimary?: boolean;
  clientX?: number;
  clientY?: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  key?: string;
  rectangle?: RubikRectangle;
}
export interface RubikPresentation {cursor: 'grab' | 'grabbing'}
export type RubikHostMessage =
  | {type: 'probe'; generation: number}
  | {type: 'init'; generation: number; canvas: OffscreenCanvas; settings: RubikWorkerSettings}
  | {type: 'settings'; generation: number; sequence: number; settings: RubikWorkerSettings}
  | {type: 'input'; generation: number; sequence: number; events: RubikInput[]; cancel: boolean}
  | {type: 'presentation-ack'; generation: number; sequence: number}
  | {type: 'dispose'; generation: number};
export type RubikWorkerMessage =
  | {type: 'capabilities'; generation: number; supported: boolean}
  | {type: 'ready' | 'error'; generation: number}
  | {type: 'settings-ack' | 'input-ack'; generation: number; sequence: number}
  | {type: 'presentation'; generation: number; sequence: number; presentation: RubikPresentation};

export const rubikInputKeys = new Set(['R','r','L','l','U','u','D','d','F','f','B','b','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape','Backspace','Home',' ']);
const pointerTypes = new Set(['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','pointerenter','pointerleave']);
const pointerFields = new Set(['type','timeStamp','pointerId','pointerType','button','isPrimary','clientX','clientY','shiftKey','altKey','ctrlKey','metaKey','rectangle']);
const keyboardFields = new Set(['type','timeStamp','key','shiftKey','altKey','ctrlKey','metaKey']);
export function validRubikRectangle(value: unknown): value is RubikRectangle {
  if (!value || typeof value !== 'object') return false;
  const r = value as RubikRectangle;
  return Object.keys(r).every(key => ['left','top','width','height'].includes(key)) && [r.left,r.top,r.width,r.height].every(n => Number.isFinite(n) && Math.abs(n) <= 1e7) && r.width >= 0 && r.height >= 0;
}
export function validRubikSettings(value: unknown): value is RubikWorkerSettings {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['rectangle','pixelRatio','finish','reducedMotion','visible'].includes(key))) return false;
  const s = value as RubikWorkerSettings;
  return validRubikRectangle(s.rectangle) && Number.isFinite(s.pixelRatio) && s.pixelRatio > 0 && s.pixelRatio <= 64 &&
    (s.finish === 'Glass' || s.finish === 'Neon') && typeof s.reducedMotion === 'boolean' && typeof s.visible === 'boolean';
}
export function validRubikInput(value: unknown): value is RubikInput {
  if (!value || typeof value !== 'object') return false;
  const e = value as RubikInput;
  const fields = e.type === 'keydown' ? keyboardFields : pointerFields;
  if (Object.keys(value).some(key => !fields.has(key))) return false;
  if (!Number.isFinite(e.timeStamp) || e.timeStamp < 0 || e.timeStamp > 1e15 ||
    ![e.shiftKey,e.altKey,e.ctrlKey,e.metaKey].every(value => typeof value === 'boolean')) return false;
  if (e.type === 'keydown') return typeof e.key === 'string' && rubikInputKeys.has(e.key);
  return pointerTypes.has(e.type) && Number.isSafeInteger(e.pointerId) && Number.isInteger(e.button) && typeof e.isPrimary === 'boolean' &&
    ['mouse','pen','touch'].includes(e.pointerType || '') && typeof e.altKey === 'boolean' && validRubikRectangle(e.rectangle) &&
    [e.clientX,e.clientY].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7);
}

/** Preserve every active drag sample, including the first direction decision.
 * Only consecutive hover moves may coalesce. Overflow explicitly cancels the
 * old gesture; at most one bounded batch may be in flight. */
export function createRubikInputMailbox(send: (sequence: number, events: RubikInput[], cancel: boolean) => void, limit = 64) {
  if (!Number.isInteger(limit) || limit < 2 || limit > 64) throw new RangeError('Invalid input queue limit.');
  let pending: RubikInput[] = [], cancelled = false, sequence = 0, inFlight = 0, stopped = false, paused = false;
  let pointer: number | null = null;
  const flush = () => {
    if (stopped || paused || inFlight || (!pending.length && !cancelled)) return;
    const events = pending, cancel = cancelled;
    pending = []; cancelled = false; inFlight = ++sequence;
    send(inFlight, events, cancel);
  };
  return {
    enqueue(event: RubikInput) {
      if (stopped || !validRubikInput(event)) return;
      const last = pending.at(-1);
      const replace = pointer === null && event.type === 'pointermove' && last?.type === 'pointermove' && last.pointerId === event.pointerId;
      if (!replace && pending.length >= limit) {
        pending = []; cancelled = true; pointer = null;
      }
      // Overflow resets the old grab BEFORE registering a retained new down.
      if (event.type === 'pointerdown' && pointer === null) pointer = event.pointerId!;
      if ((['pointerup','pointercancel','lostpointercapture'].includes(event.type) && pointer === event.pointerId) || (event.type === 'keydown' && event.key === 'Escape')) pointer = null;
      if (replace) pending[pending.length - 1] = event;
      else pending.push(event);
      flush();
    },
    acknowledge(value: number) { if (!inFlight || value !== inFlight) return; inFlight = 0; flush(); },
    pause() { paused = true; },
    resume() { if (stopped) return; paused = false; flush(); },
    cancel() { if (stopped) return; pending = []; pointer = null; cancelled = true; flush(); },
    dispose() { stopped = true; pending = []; pointer = null; cancelled = false; inFlight = 0; },
    getState: () => ({pending: pending.length, inFlight, sequence, cancelled, stopped, paused}),
  };
}
