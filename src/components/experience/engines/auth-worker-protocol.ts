import type {HeroRectangle} from './hero-platform';

export interface AuthWorkerSettings {
  rectangle: HeroRectangle;
  pixelRatio: number;
  theme: 'dark' | 'light';
  mode: 'login' | 'signup';
  privacy: boolean;
  reducedMotion: boolean;
  visible: boolean;
}
/** Form values and DOM events never cross this boundary. */
export type AuthControl =
  | {type: 'pointer'; x: number; y: number; count: number}
  | {type: 'orbit'; yaw: number; pitch: number; count: number}
  | {type: 'resetOrbit' | 'celebrate'};
export type AuthHostMessage =
  | {type: 'probe'; generation: number}
  | {type: 'init'; generation: number; canvas: OffscreenCanvas; settings: AuthWorkerSettings}
  | {type: 'settings'; generation: number; sequence: number; settings: AuthWorkerSettings}
  | {type: 'controls'; generation: number; sequence: number; controls: AuthControl[]; reset: boolean}
  | {type: 'dispose'; generation: number};
export type AuthWorkerMessage =
  | {type: 'capabilities'; generation: number; supported: boolean}
  | {type: 'ready' | 'error'; generation: number}
  | {type: 'settings-ack' | 'controls-ack'; generation: number; sequence: number};

export function validAuthSettings(value: unknown): value is AuthWorkerSettings {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['rectangle','pixelRatio','theme','mode','privacy','reducedMotion','visible'].includes(key))) return false;
  const s = value as AuthWorkerSettings, r = s.rectangle;
  return !!r && Object.keys(r).every(key => ['left','top','width','height'].includes(key)) && [r.left,r.top,r.width,r.height].every(n => Number.isFinite(n) && Math.abs(n) <= 1e7) && r.width >= 0 && r.height >= 0 &&
    Number.isFinite(s.pixelRatio) && s.pixelRatio > 0 && s.pixelRatio <= 64 && (s.theme === 'dark' || s.theme === 'light') &&
    (s.mode === 'login' || s.mode === 'signup') && typeof s.privacy === 'boolean' && typeof s.visible === 'boolean' && typeof s.reducedMotion === 'boolean';
}
export function validAuthControl(value: unknown): value is AuthControl {
  if (!value || typeof value !== 'object') return false;
  const c = value as AuthControl;
  if (c.type === 'resetOrbit' || c.type === 'celebrate') return Object.keys(c).length === 1;
  if (!('count' in c) || !Number.isInteger(c.count) || c.count < 1 || c.count > 25) return false;
  if (c.type === 'pointer') return Object.keys(c).every(k => ['type','x','y','count'].includes(k)) && Number.isFinite(c.x) && Number.isFinite(c.y) && Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1;
  return c.type === 'orbit' && Object.keys(c).every(k => ['type','yaw','pitch','count'].includes(k)) && Number.isFinite(c.yaw) && Number.isFinite(c.pitch) && Math.abs(c.yaw) <= .55 && Math.abs(c.pitch) <= .22;
}

/** Consecutive coordinates coalesce without losing the original engine's
 * additive sparkle energy (.04/.08 per call, saturating at1). Commands retain
 * their order and one acknowledged bounded batch is in flight at a time. */
export function createAuthControlMailbox(send: (sequence: number, controls: AuthControl[], reset: boolean) => void, limit = 32) {
  if (!Number.isInteger(limit) || limit < 2 || limit > 128) throw new RangeError('Invalid control queue limit.');
  let pending: AuthControl[] = [], reset = false, sequence = 0, inFlight = 0, stopped = false, paused = false;
  const flush = () => {
    if (stopped || paused || inFlight || (!pending.length && !reset)) return;
    const controls = pending, clear = reset; pending = []; reset = false; inFlight = ++sequence;
    send(inFlight, controls, clear);
  };
  return {
    enqueue(control: AuthControl) {
      if (stopped || !validAuthControl(control)) return;
      const previous = pending.at(-1);
      if ((control.type === 'pointer' || control.type === 'orbit') && previous?.type === control.type && 'count' in previous) {
        pending[pending.length - 1] = {...control, count: Math.min(25, previous.count + control.count)};
      } else {
        if (pending.length >= limit) { pending = []; reset = true; }
        pending.push(control);
      }
      flush();
    },
    acknowledge(value: number) { if (!inFlight || value !== inFlight) return; inFlight = 0; flush(); },
    pause() { paused = true; },
    resume() { if (stopped) return; paused = false; flush(); },
    clear() { if (stopped) return; pending = []; reset = true; flush(); },
    dispose() { stopped = true; pending = []; reset = false; inFlight = 0; },
    getState: () => ({pending: pending.length, inFlight, sequence, reset, stopped, paused}),
  };
}
