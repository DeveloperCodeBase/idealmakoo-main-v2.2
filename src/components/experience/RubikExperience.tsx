"use client";

import { useEffect, useRef, useState } from "react";
import type { ExperienceTheme } from "./ToothExperience";
import styles from "./experience.module.css";
import {DISPLAY_PREFERENCES_EVENT,isReducedMotion} from "@/lib/display-preferences";
import { createSceneClock } from "./engines/scene-clock";

export interface RubikExperienceProps {
  className?: string;
  theme?: ExperienceTheme;
  locale?: string;
}

interface RubikScene {
  prepare?: () => Promise<void>;
  update?: (now: number, delta: number) => void;
  resize: () => void;
  dispose: () => void;
  setReducedMotion: (value: boolean) => void;
  setFinish: (value: string) => void;
  setVisible: (value: boolean) => void;
}

/** The supplied exact-lattice Rubik model, with its original tooth mount. */
export default function RubikExperience({ className = "", theme = "dark", locale = "fa" }: RubikExperienceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<RubikScene | null>(null);
  const themeRef = useRef(theme);
  const useMainThread = useRef(false);
  const [canvasGeneration, setCanvasGeneration] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "fallback">("loading");
  const language = locale.startsWith("fa") ? "fa" : locale.startsWith("ar") ? "ar" : locale.startsWith("tr") ? "tr" : locale.startsWith("ru") ? "ru" : "en";
  const labels = {
    fa: { hint: "با کشیدن وجه‌ها، لایه‌ها را بچرخانید؛ با کشیدن دندان، زاویه دید را تغییر دهید.", aria: "مکعب شیشه‌ای تعاملی ایده‌آل ماکو با دندان سه‌بعدی. با ماوس یا کلیدهای جهت تعامل کنید.", fallback: "نمای مفهومی طراحی و دقت" },
    en: { hint: "Drag a face to turn a layer. Drag the tooth to orbit.", aria: "Interactive Ideal Makoo glass cube with a three-dimensional tooth. Use your pointer or arrow keys.", fallback: "Design and precision illustration" },
    ar: { hint: "اسحب الوجه لتدوير الطبقة؛ واسحب السن لتغيير زاوية الرؤية.", aria: "مكعب إيديال ماكو الزجاجي التفاعلي مع سن ثلاثي الأبعاد. تفاعل بالمؤشر أو مفاتيح الأسهم.", fallback: "رسم توضيحي للتصميم والدقة" },
    tr: { hint: "Katmanı döndürmek için bir yüzü sürükleyin. Görüşü döndürmek için dişi sürükleyin.", aria: "Üç boyutlu dişle etkileşimli Ideal Makoo cam küpü. İşaretçiyi veya ok tuşlarını kullanın.", fallback: "Tasarım ve hassasiyet görseli" },
    ru: { hint: "Перетащите грань, чтобы повернуть слой. Перетащите зуб, чтобы изменить ракурс.", aria: "Интерактивный стеклянный куб Ideal Makoo с трёхмерным зубом. Используйте указатель или стрелки.", fallback: "Иллюстрация дизайна и точности" },
  }[language];

  useEffect(() => {
    themeRef.current = theme;
    controllerRef.current?.setFinish(theme === "light" ? "Glass" : "Neon");
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let disposed = false, failed = false, loading = false, inViewport = false, frameId = 0;
    let scene: RubikScene | null = null;
    let hostModule: Promise<typeof import("./engines/rubik-worker-host")> | null = null;
    const preload = () => hostModule ||= import("./engines/rubik-worker-host");
    const preparation = new AbortController();
    const clock = createSceneClock();
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const cleanups: (() => void)[] = [];
    setState("loading");
    const restartCanvas = (mainThread: boolean) => {
      if (disposed || failed) return;
      failed = true; preparation.abort(); cancelAnimationFrame(frameId); frameId = 0;
      try { scene?.dispose(); } catch { /* A failed owned renderer still needs a fresh canvas. */ }
      useMainThread.current ||= mainThread;
      setState("loading"); setCanvasGeneration(value => value + 1);
    };
    const fail = () => {
      if (disposed) return;
      failed = true; cancelAnimationFrame(frameId); frameId = 0;
      preparation.abort();
      try { scene?.setVisible(false); scene?.dispose(); } catch { /* Preserve the accessible fallback. */ }
      setState("fallback");
    };
    const frame = (now: number) => {
      frameId = 0;
      if (disposed || failed || !inViewport || document.hidden || !scene?.update) return;
      const next = clock.frame(now, isReducedMotion(motion.matches));
      if (next) try { scene.update(next.time, next.delta); } catch { fail(); return; }
      frameId = requestAnimationFrame(frame);
    };
    const updateVisibility = () => {
      const visible = !disposed && !failed && inViewport && !document.hidden;
      clock.setVisible(visible); scene?.setVisible(visible);
      if (!visible) { cancelAnimationFrame(frameId); frameId = 0; }
      else if (scene?.update && !frameId) frameId = requestAnimationFrame(frame);
      else if (!scene && !loading) void initialise();
    };
    const initialise = async () => {
      if (loading || disposed || failed || !inViewport || document.hidden) return;
      loading = true;
      try {
        const {createRubikWorker, supportsRubikWorker, wasRubikCanvasTransferred} = await preload();
        if (disposed || failed) return;
        // Loading a module in the preload band does not initialize an offscreen scene.
        if (!inViewport || document.hidden) { loading = false; return; }
        if (wasRubikCanvasTransferred(canvas)) { restartCanvas(useMainThread.current); return; }
        if (!useMainThread.current && supportsRubikWorker()) {
          try {
            scene = createRubikWorker(canvas, {
              finish: themeRef.current === "light" ? "Glass" : "Neon", reducedMotion: isReducedMotion(motion.matches),
              signal: preparation.signal, onError: () => restartCanvas(true),
            });
          } catch { if (!disposed) restartCanvas(true); return; }
        } else {
          const {initRubik} = await import("./engines/rubik");
          if (disposed || failed) return;
          if (!inViewport || document.hidden) { loading = false; return; }
          scene = initRubik(canvas, {
            controlsRoot: container, bindControls: false, maxPixelRatio: 1.5, toothQuality: "high", autoRotate: true,
            reducedMotion: isReducedMotion(motion.matches), finish: themeRef.current === "light" ? "Glass" : "Neon",
          }) as unknown as RubikScene;
        }
        if (disposed || failed) { scene?.dispose(); return; }
        scene.setFinish(themeRef.current === "light" ? "Glass" : "Neon");
        scene.setReducedMotion(isReducedMotion(motion.matches));
        controllerRef.current = scene; updateVisibility();
        // The controller must be retained before awaiting readiness: scroll,
        // tab visibility, preference changes and cleanup can arrive meanwhile.
        if (scene.prepare) {
          try { await scene.prepare(); }
          catch { if (!disposed) restartCanvas(true); return; }
        }
        if (disposed || failed) { scene.dispose(); return; }
        setState("ready"); updateVisibility();
      } catch { fail(); }
    };
    const onMotion = () => scene?.setReducedMotion(isReducedMotion(motion.matches));
    const onResize = () => scene?.resize();
    const onContextLost = (event: Event) => { event.preventDefault(); if (useMainThread.current) fail(); else restartCanvas(true); };
    const listen = (target: EventTarget, type: string, listener: EventListener) => {
      target.addEventListener(type, listener); cleanups.push(() => target.removeEventListener(type, listener));
    };
    const cleanup = () => {
      if (disposed) return;
      disposed = true; preparation.abort(); cancelAnimationFrame(frameId);
      for (const remove of cleanups.splice(0)) try { remove(); } catch { /* Continue owned cleanup. */ }
      try { scene?.dispose(); } catch { /* Finish cleanup even after a lost context. */ }
      if (controllerRef.current === scene) controllerRef.current = null;
    };
    // Register every cleanup before observe can throw or trigger initialization.
    // Abort also protects imports that finish after an observer setup failure.
    try {
      if (typeof ResizeObserver === "function") {
        const resize = new ResizeObserver(onResize); cleanups.push(() => resize.disconnect()); resize.observe(container);
      }
      listen(window, "resize", onResize);
      listen(document, "visibilitychange", updateVisibility);
      listen(motion, "change", onMotion);
      listen(window, DISPLAY_PREFERENCES_EVENT, onMotion);
      listen(canvas, "webglcontextlost", onContextLost);
      if (typeof IntersectionObserver === "function") {
        const preloadObserver = new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting) void preload().catch(() => { /* The visible initializer owns failure. */ });
        }, {rootMargin: "160px"});
        cleanups.push(() => preloadObserver.disconnect()); preloadObserver.observe(container);
        const intersection = new IntersectionObserver(([entry]) => {
          inViewport = entry.isIntersecting;
          if (inViewport) void initialise(); updateVisibility();
        }, {rootMargin: "0px"});
        cleanups.push(() => intersection.disconnect()); intersection.observe(container);
      } else { inViewport = true; void initialise(); }
    } catch { cleanup(); setState("fallback"); }
    return cleanup;
  }, [canvasGeneration]);

  return (
    <div ref={containerRef} className={`${styles.experience} ${styles.cube} ${className}`} data-theme={theme} data-scene-state={state} data-variant="rubik">
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.halo} aria-hidden="true" />
      <canvas key={canvasGeneration} ref={canvasRef} className={styles.canvas} role="img" aria-label={labels.aria} tabIndex={state === "ready" ? 0 : -1} aria-hidden={state !== "ready"} />
      {state !== "ready" && (
        <div className={styles.fallback} role="img" aria-label={labels.fallback}>
          <div className={styles.cubeFallback} aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div>
        </div>
      )}
      <span className={styles.hint}><span className={styles.hintDot} aria-hidden="true" />{state === "fallback" ? labels.fallback : labels.hint}</span>
    </div>
  );
}
