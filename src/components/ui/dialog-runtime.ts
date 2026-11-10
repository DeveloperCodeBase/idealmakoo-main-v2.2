'use client';

import {useEffect, useRef, useState, type RefObject} from 'react';

export interface DialogViewport {
  width: number;
  height: number;
  offsetLeft?: number;
  offsetTop?: number;
}

const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

/** Physical viewport coordinates are deliberately independent of document scroll and text direction. */
export function dialogViewportFrame(viewport: DialogViewport) {
  const width = positive(viewport.width, 320);
  const height = positive(viewport.height, 480);
  const left = Number.isFinite(viewport.offsetLeft) ? viewport.offsetLeft! : 0;
  const top = Number.isFinite(viewport.offsetTop) ? viewport.offsetTop! : 0;
  const gutter = Math.min(24, Math.max(12, width * .035), width / 8, height / 8);
  return {
    left: left + gutter,
    top: top + gutter,
    width: width - gutter * 2,
    height: height - gutter * 2,
    centerX: left + width / 2,
    centerY: top + height / 2,
    viewportWidth: width,
    viewportHeight: height,
    offsetLeft: left,
    offsetTop: top,
    gutter,
  };
}

/** A stable centred shell: opening and closing never interpolate physical page coordinates. */
export function centeredDialogBounds(viewport: DialogViewport, preferredWidth = 780, preferredHeight = 760) {
  const frame = dialogViewportFrame(viewport);
  const width = Math.min(frame.width, positive(preferredWidth, 780));
  const height = Math.min(frame.height, positive(preferredHeight, 760));
  return {...frame, width, height, left: frame.centerX - width / 2, top: frame.centerY - height / 2};
}

type ScrollLock = {count: number; restore: () => void};
const scrollLocks = new WeakMap<Document, ScrollLock>();

/** Shared and reference counted so an inner popup cannot unlock a still-open parent dialog. */
export function lockDocumentScroll(doc: Document): () => void {
  const existing = scrollLocks.get(doc);
  if (existing) existing.count += 1;
  else {
    const body = doc.body;
    const html = doc.documentElement;
    const view = doc.defaultView;
    const openingHref = view?.location?.href;
    const x = view?.scrollX || 0;
    const y = view?.scrollY || 0;
    const properties = ['position', 'top', 'left', 'right', 'width', 'overflow', 'paddingRight'] as const;
    const previous = Object.fromEntries(properties.map(key => [key, body.style[key]]));
    const htmlOverflow = html.style.overflow;
    const scrollbar = Math.max(0, (view?.innerWidth || html.clientWidth) - html.clientWidth);
    const hasStableGutter = (view?.getComputedStyle(html).scrollbarGutter || '').split(/\s+/).includes('stable');
    const paddingRight = Number.parseFloat(view?.getComputedStyle(body).paddingRight || '0') || 0;
    Object.assign(body.style, {position: 'fixed', top: `${-y}px`, left: `${-x}px`, right: '0', width: 'auto', overflow: 'hidden'});
    if (scrollbar && !hasStableGutter) body.style.paddingRight = `${paddingRight + scrollbar}px`;
    html.style.overflow = 'hidden';
    scrollLocks.set(doc, {count: 1, restore: () => {
      for (const key of properties) body.style[key] = previous[key] || '';
      html.style.overflow = htmlOverflow;
      const scrollBehavior = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      // A menu link can navigate while the body is locked. Restoring its old Y
      // on the next route can send the home page directly to its footer.
      if (view?.location?.href === openingHref) view?.scrollTo({left: x, top: y, behavior: 'instant'});
      html.style.scrollBehavior = scrollBehavior;
    }});
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const lock = scrollLocks.get(doc);
    if (!lock) return;
    lock.count -= 1;
    if (lock.count === 0) {
      scrollLocks.delete(doc);
      lock.restore();
    }
  };
}

/** Keep native dialogs inside the active fullscreen element when one exists. */
export function useDialogPortalTarget() {
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    const update = () => setTarget(document.fullscreenElement || document.body);
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  return target;
}

interface DialogOptions {
  initialFocus?: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
  restoreFocusTarget?: RefObject<HTMLElement | null>;
  width?: number;
  height?: number;
}

/** Native top-layer focus/inertness plus visualViewport sizing, cleanup and scroll restoration. */
export function useViewportDialog(
  ref: RefObject<HTMLDialogElement | null>,
  active: boolean,
  portalTarget: Element | null,
  onDismiss: () => void,
  options: DialogOptions = {},
) {
  const dismissRef = useRef(onDismiss);
  const optionsRef = useRef(options);
  dismissRef.current = onDismiss;
  optionsRef.current = options;
  useEffect(() => {
    const panel = ref.current;
    if (!active || !portalTarget || !panel) return;
    const doc = panel.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;
    const previousFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const openingHref = view.location.href;
    const releaseScroll = lockDocumentScroll(doc);
    let frame = 0;
    let cleaning = false;
    const measure = () => {
      frame = 0;
      const viewport = view.visualViewport;
      const input = {
        width: viewport?.width || view.innerWidth,
        height: viewport?.height || view.innerHeight,
        offsetLeft: viewport?.offsetLeft || 0,
        offsetTop: viewport?.offsetTop || 0,
      };
      const bounds = dialogViewportFrame(input);
      const shell = centeredDialogBounds(input, optionsRef.current.width || bounds.width, optionsRef.current.height || bounds.height);
      const values = {
        '--dialog-center-x': bounds.centerX,
        '--dialog-center-y': bounds.centerY,
        '--dialog-available-width': bounds.width,
        '--dialog-available-height': bounds.height,
        '--dialog-viewport-width': bounds.viewportWidth,
        '--dialog-viewport-height': bounds.viewportHeight,
        '--dialog-viewport-left': bounds.offsetLeft,
        '--dialog-viewport-top': bounds.offsetTop,
        '--dialog-width': shell.width,
        '--dialog-height': shell.height,
      };
      for (const [key, value] of Object.entries(values)) panel.style.setProperty(key, `${value}px`);
    };
    const schedule = () => { if (!frame) frame = view.requestAnimationFrame(measure); };
    const cancel = (event: Event) => { event.preventDefault(); dismissRef.current(); };
    const nativeClose = () => { if (!cleaning) dismissRef.current(); };
    measure();
    if (!panel.open) panel.showModal();
    const nativeInitialFocus = doc.activeElement;
    panel.addEventListener('cancel', cancel);
    panel.addEventListener('close', nativeClose);
    view.addEventListener('resize', schedule);
    view.addEventListener('orientationchange', schedule);
    view.visualViewport?.addEventListener('resize', schedule);
    view.visualViewport?.addEventListener('scroll', schedule);
    const focusFrame = view.requestAnimationFrame(() => {
      // A user may already be editing a field before this deferred callback.
      const focused = doc.activeElement;
      if (focused && focused !== nativeInitialFocus && focused !== panel && panel.contains(focused)) return;
      const target = optionsRef.current.initialFocus?.current || panel.querySelector<HTMLElement>('[autofocus],button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
      (target || panel).focus({preventScroll: true});
    });
    return () => {
      cleaning = true;
      panel.removeEventListener('cancel', cancel);
      panel.removeEventListener('close', nativeClose);
      view.removeEventListener('resize', schedule);
      view.removeEventListener('orientationchange', schedule);
      view.visualViewport?.removeEventListener('resize', schedule);
      view.visualViewport?.removeEventListener('scroll', schedule);
      if (frame) view.cancelAnimationFrame(frame);
      view.cancelAnimationFrame(focusFrame);
      if (panel.open) panel.close();
      releaseScroll();
      const stillOpen = Array.from(doc.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(-1);
      const restoreTarget = optionsRef.current.restoreFocusTarget?.current || previousFocus;
      if (view.location.href === openingHref && optionsRef.current.restoreFocus !== false && restoreTarget?.isConnected && (!stillOpen || stillOpen.contains(restoreTarget))) {
        restoreTarget.focus({preventScroll: true});
      }
    };
  }, [active, portalTarget, ref]);
}
