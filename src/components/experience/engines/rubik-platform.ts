import type {HeroRectangle, HeroSurface} from './hero-platform';

export type RubikRectangle = HeroRectangle;

/** The original Rubik engine uses the same scene and input logic in either
 * execution context. Native focus/capture and all visible controls stay in DOM. */
export interface RubikSurface extends HeroSurface {
  classList: Pick<DOMTokenList, 'add' | 'remove'>;
  tabIndex: number;
  clientWidth: number;
  clientHeight: number;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): HeroRectangle & {right: number; bottom: number};
}
export interface RubikPlatform {
  pixelRatio(): number;
  motionQuery(): {matches: boolean} & EventTarget;
  windowEvents: EventTarget;
  controlsRoot: Document | HTMLElement | null;
}
