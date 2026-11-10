'use client';

import {useEffect} from 'react';
import {DISPLAY_PREFERENCES_EVENT,isReducedMotion,surfaceEffectsEnabled} from '@/lib/display-preferences';

/** A single pointer observer moves optical highlights on the surfaces under it.
 * No per-card listeners, persistent animation loop, layout transforms or app data.
 * The actual content remains usable without JavaScript and with reduced motion.
 */
export default function LiquidEffects() {
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const selector = '.glass,.gn-bar,.ws-card,.ws-sidebar,.ws-shell,.btn,.icon-btn,[data-liquid-surface]';
    let frame = 0;
    let pending: {x:number;y:number;target:Element}|null = null;
    let active: HTMLElement[] = [];

    const clear = () => {
      pending = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      active.forEach(node => node.removeAttribute('data-liquid-active'));
      active = [];
    };
    const paint = () => {
      frame = 0;
      const sample = pending;
      pending = null;
      if (!sample || isReducedMotion(motion.matches) || !surfaceEffectsEnabled() || !finePointer.matches) return;
      const next: HTMLElement[] = [];
      let target: Element|null = sample.target;
      while (target && next.length < 3) {
        const surface: Element|null = target.closest(selector);
        if (!(surface instanceof HTMLElement)) break;
        const rect = surface.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          surface.style.setProperty('--liquid-x', `${Math.max(0, Math.min(100, (sample.x - rect.left) / rect.width * 100)).toFixed(2)}%`);
          surface.style.setProperty('--liquid-y', `${Math.max(0, Math.min(100, (sample.y - rect.top) / rect.height * 100)).toFixed(2)}%`);
          surface.setAttribute('data-liquid-active', 'true');
          next.push(surface);
        }
        target = surface.parentElement;
      }
      active.forEach(node => { if (!next.includes(node)) node.removeAttribute('data-liquid-active'); });
      active = next;
    };
    const move = (event: PointerEvent) => {
      if (isReducedMotion(motion.matches) || !surfaceEffectsEnabled() || !finePointer.matches || event.pointerType === 'touch' || !(event.target instanceof Element)) return;
      pending = {x:event.clientX,y:event.clientY,target:event.target};
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const visibility = () => { if (document.hidden) clear(); };
    document.addEventListener('pointermove', move, {passive:true});
    document.documentElement.addEventListener('pointerleave', clear);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', clear);
    window.addEventListener(DISPLAY_PREFERENCES_EVENT, clear);
    finePointer.addEventListener('change', clear);
    return () => {
      clear();
      document.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', clear);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', clear);
      window.removeEventListener(DISPLAY_PREFERENCES_EVENT, clear);
      finePointer.removeEventListener('change', clear);
    };
  }, []);
  return null;
}
