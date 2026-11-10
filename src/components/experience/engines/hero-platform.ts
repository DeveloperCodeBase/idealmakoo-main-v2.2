/** The hero uses this small surface contract in both browser execution contexts.
 * DOM focus, capture and accessibility remain owned by the HTML canvas host. */
export interface HeroRectangle {left: number; top: number; width: number; height: number}
export interface HeroSurface extends EventTarget {
  width: number;
  height: number;
  style: {cursor: string; touchAction: string};
  getBoundingClientRect(): HeroRectangle;
  focus(options?: FocusOptions): void;
  setPointerCapture(id: number): void;
  hasPointerCapture(id: number): boolean;
  releasePointerCapture(id: number): void;
}
export interface HeroAgentElement {
  style: {transform: string; opacity: string};
  dataset: {mode?: string; phase?: string};
}
export interface HeroPlatform {
  pixelRatio(): number;
  observeResize(callback: () => void): {disconnect(): void};
}
