"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import styles from "./experience.module.css";
import {DISPLAY_PREFERENCES_EVENT,isReducedMotion} from "@/lib/display-preferences";
import { createSceneClock } from "./engines/scene-clock";
import { createScenePreparationGate } from "./engines/scene-preparation";
import { heroSceneRegion, normalizeSceneRegion, sceneDirection, type HeroComposition, type HeroFramingOptions } from "./engines/framing";

export type ExperienceTheme = "dark" | "light";
export type ExperienceState = "loading" | "ready" | "fallback";

export interface ToothExperienceProps {
  variant?: "hero" | "auth";
  theme?: ExperienceTheme;
  className?: string;
  locale?: string;
  composition?: HeroComposition;
  /** An unobstructed DOM region over the same full-size canvas; never captures input. */
  framingRegionRef?: RefObject<HTMLElement | null>;
  /** The landing host renders ToothExperienceFallback in its server-rendered framing region. */
  externalFallback?: boolean;
  onSceneStateChange?: (state: ExperienceState) => void;
  /** Raise the mascot's hands while a password field is active. */
  privacy?: boolean;
  authMode?: "login" | "signup";
  showHint?: boolean;
  ariaLabel?: string;
}

interface SceneController {
  supported?: boolean;
  prepare?: () => Promise<void>;
  update?: (time: number, delta: number) => void;
  resize: () => void;
  dispose?: () => void;
  destroy?: () => void;
  setTheme?: (value: ExperienceTheme) => void;
  setReducedMotion: (value: boolean) => void;
  setVisible?: (value: boolean) => void;
  setPointer?: (x: number, y: number) => void;
  setOrbit?: (yaw: number, pitch: number) => void;
  resetOrbit?: () => void;
  setPrivacy?: (value: boolean) => void;
  setMode?: (mode: "login" | "signup") => void;
  celebrate?: () => void;
  setFraming?: (value: HeroFramingOptions) => void;
}

const copy = {
  fa: {
    hero: "دندان را بگیرید، بالا ببرید و رها کنید. برای چرخش دید، فضای خالی را بکشید یا از دکمهٔ راست ماوس استفاده کنید.",
    keys: "صفحه‌کلید: ۱ / ۲ انتخاب دندان؛ جهت بالا برای پرتاب؛ چپ / راست برای جابه‌جایی؛ Shift + جهت‌ها برای چرخش دید؛ R بازگشت آرام؛ Esc رهاکردن. گاهی موج دندان را کج می‌کند و دستیار هوشمند کمکش می‌کند؛ با گرفتن دندان، کنترل دوباره دست شماست.",
    agent: "دستیار هوشمند",
    keyboard: "راهنمای صفحه‌کلید",
    auth: "یک همراه کوچک برای شروع همکاری‌های بزرگ",
    label: "دندان‌های سه‌بعدی تعاملی ایده‌آل ماکو؛ با ماوس یا کلیدهای جهت تعامل کنید.",
    authLabel: "دندان سه‌بعدی ایده‌آل ماکو با چشم‌هایی که نشانگر را دنبال می‌کنند.",
    fallback: "نمای ثابت محصول",
    loading: "در حال آماده‌سازی نمای سه‌بعدی",
  },
  en: {
    hero: "Grab a tooth, lift and release. Drag empty space or use the right mouse button to orbit.",
    keys: "Keyboard: 1 / 2 selects a tooth; Up lifts; Left / Right nudges; Shift + arrows orbits; R returns gently; Esc releases. An occasional wave tips a tooth and the AI assistant steadies it; grab the tooth to take over.",
    agent: "AI assistant",
    keyboard: "Keyboard guide",
    auth: "A little companion for a great partnership.",
    label: "Interactive Ideal Makoo 3D teeth. Drag with the pointer or use the arrow keys.",
    authLabel: "Ideal Makoo 3D tooth mascot with eyes that follow your pointer.",
    fallback: "Product illustration",
    loading: "Preparing the 3D experience",
  },
  ar: {
    hero: "أمسك السن وارفعه ثم أفلته. اسحب المساحة الفارغة أو استخدم زر الفأرة الأيمن لتدوير الرؤية.",
    keys: "لوحة المفاتيح: 1 / 2 لاختيار السن؛ أعلى للرفع؛ يسار / يمين للتحريك؛ Shift + الأسهم لتدوير الرؤية؛ R للعودة برفق؛ Esc للإفلات. قد تميل السن مع موجة عابرة ويعيدها المساعد الذكي برفق؛ أمسكها لاستعادة التحكم.",
    agent: "المساعد الذكي",
    keyboard: "دليل لوحة المفاتيح",
    auth: "رفيق صغير لبداية شراكة كبيرة",
    label: "أسنان إيديال ماكو ثلاثية الأبعاد؛ تفاعل بالمؤشر أو مفاتيح الأسهم.",
    authLabel: "شخصية سن إيديال ماكو ثلاثية الأبعاد بعيون تتبع المؤشر.",
    fallback: "صورة توضيحية للمنتج",
    loading: "جارٍ تحضير التجربة ثلاثية الأبعاد",
  },
  tr: {
    hero: "Dişi tutun, kaldırın ve bırakın. Görüşü döndürmek için boş alanı sürükleyin veya sağ fare düğmesini kullanın.",
    keys: "Klavye: 1 / 2 dişi seçer; Yukarı kaldırır; Sol / Sağ hareket ettirir; Shift + oklar görüşü döndürür; R nazikçe geri getirir; Esc bırakır. Ara sıra bir dalga dişi yatırır ve akıllı yardımcı onu düzeltir; kontrolü almak için dişi tutun.",
    agent: "Akıllı yardımcı",
    keyboard: "Klavye rehberi",
    auth: "Büyük bir ortaklık için küçük bir yol arkadaşı.",
    label: "Etkileşimli Ideal Makoo üç boyutlu dişleri. İşaretçiyle sürükleyin veya ok tuşlarını kullanın.",
    authLabel: "Gözleri işaretçinizi izleyen Ideal Makoo üç boyutlu diş karakteri.",
    fallback: "Ürün görseli",
    loading: "Üç boyutlu deneyim hazırlanıyor",
  },
  ru: {
    hero: "Возьмите зуб, поднимите и отпустите. Для вращения вида тяните пустую область или используйте правую кнопку мыши.",
    keys: "Клавиатура: 1 / 2 — выбор зуба; Вверх — подъём; Влево / Вправо — сдвиг; Shift + стрелки — вращение вида; R — плавное возвращение; Esc — отпустить. Иногда волна наклоняет зуб, а ИИ-помощник выпрямляет его; возьмите зуб, чтобы перехватить управление.",
    agent: "ИИ-помощник",
    keyboard: "Управление клавиатурой",
    auth: "Маленький спутник для большого сотрудничества.",
    label: "Интерактивные трёхмерные зубы Ideal Makoo. Перетаскивайте указателем или используйте стрелки.",
    authLabel: "Трёхмерный персонаж Ideal Makoo, взгляд которого следует за указателем.",
    fallback: "Изображение продукта",
    loading: "Подготовка трёхмерной сцены",
  },
};

/**
 * Direct integration of the supplied enamel/water and Luma mascot sources.
 * Three is downloaded only when this component approaches the viewport.
 * Every instance owns its renderer, observers, listeners and animation clock.
 */
export default function ToothExperience({
  variant = "hero",
  theme = "dark",
  className = "",
  locale = "fa",
  composition = "centered",
  framingRegionRef,
  externalFallback = false,
  onSceneStateChange,
  privacy = false,
  authMode = "login",
  showHint = true,
  ariaLabel,
}: ToothExperienceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const preferences = useRef({ theme, privacy, authMode });
  const framing = useRef<HeroFramingOptions>({ composition, locale, direction: sceneDirection(locale) });
  const [state, setState] = useState<ExperienceState>("loading");
  const [canvasGeneration, setCanvasGeneration] = useState(0);
  const useMainThreadHero = useRef(false);
  const useMainThreadAuth = useRef(false);
  const componentId = useId().replace(/:/g, "");
  const language = locale.startsWith("fa") ? "fa" : locale.startsWith("ar") ? "ar" : locale.startsWith("tr") ? "tr" : locale.startsWith("ru") ? "ru" : "en";
  const text = copy[language];

  useEffect(() => { onSceneStateChange?.(state); }, [state, onSceneStateChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || variant !== "hero") return;
    let target: HTMLElement | null = null;
    const measure = () => {
      const nextTarget = framingRegionRef?.current || null;
      if (nextTarget !== target) {
        if (target) observer.unobserve(target);
        target = nextTarget;
        if (target) observer.observe(target);
      }
      const rect = container.getBoundingClientRect();
      framing.current = { composition, locale, direction: sceneDirection(locale), region: normalizeSceneRegion(rect, target?.getBoundingClientRect()) };
      const region = heroSceneRegion(rect.width, framing.current);
      for (const key of ["x", "y", "width", "height"] as const) container.style.setProperty(`--scene-frame-${key}`, `${region[key] * 100}%`);
      controllerRef.current?.setFraming?.(framing.current);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container); measure();
    window.addEventListener("resize", measure, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [composition, locale, framingRegionRef, variant]);

  useEffect(() => {
    preferences.current = { theme, privacy, authMode };
    const scene = controllerRef.current;
    scene?.setTheme?.(theme);
    scene?.setPrivacy?.(privacy);
    scene?.setMode?.(authMode);
  }, [theme, privacy, authMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let disposed = false;
    let failed = false;
    let loading = false;
    let inViewport = false;
    let frameId = 0;
    let startupFrameId = 0;
    const preparation = new AbortController();
    const scenePreparation = createScenePreparationGate();
    const clock = createSceneClock();
    let scene: SceneController | null = null;
    let drag: { id: number; x: number; y: number } | null = null;
    let keyboardYaw = 0;
    let keyboardPitch = 0;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    setState("loading");

    const restartSceneCanvas = (mainThread: boolean) => {
      if (disposed || failed) return;
      failed = true;
      scenePreparation.cancel();
      preparation.abort();
      cancelAnimationFrame(frameId);
      scene?.dispose?.();
      if (variant === "auth") useMainThreadAuth.current ||= mainThread;
      else useMainThreadHero.current ||= mainThread;
      setState("loading");
      // A transferred canvas is permanently consumed. Let React replace its
      // node/ref/accessibility attributes, including on effect replay/retry.
      setCanvasGeneration(value => value + 1);
    };

    const showFallback = () => {
      if (disposed) return;
      failed = true;
      scenePreparation.fail();
      cancelAnimationFrame(frameId);
      frameId = 0;
      scene?.setVisible?.(false);
      setState("fallback");
    };

    const draw = (now: number) => {
      frameId = 0;
      if (disposed || failed || !scenePreparation.canDraw(inViewport, document.hidden) || !scene?.update) return;
      const frame = clock.frame(now, isReducedMotion(motion.matches));
      if (frame) {
        try {
          scene.update(frame.time, frame.delta);
        } catch {
          showFallback();
          return;
        }
      }
      frameId = requestAnimationFrame(draw);
    };

    const releaseAuthDrag = () => {
      const pointerId = drag?.id;
      drag = null;
      scene?.resetOrbit?.();
      if (pointerId !== undefined) try { if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId); } catch { /* The DOM canvas may be detached. */ }
      canvas.style.cursor = "grab";
    };

    const updateVisibility = () => {
      const visible = !disposed && !failed && scenePreparation.canDraw(inViewport, document.hidden);
      scene?.setVisible?.(visible);
      clock.setVisible(visible);
      if (!visible) {
        if (variant === "auth") releaseAuthDrag();
        cancelAnimationFrame(frameId);
        frameId = 0;
      } else if (scene?.update && !frameId) {
        frameId = requestAnimationFrame(draw);
      }
    };

    const initialise = async () => {
      if (loading || disposed || failed) return;
      loading = true;
      try {
        // Keep server-rendered text, links and form fields paintable before any
        // WebGL allocation. This is normal lifecycle scheduling for every user.
        await new Promise<void>(resolve => {
          startupFrameId = requestAnimationFrame(() => {
            startupFrameId = requestAnimationFrame(() => { startupFrameId = 0; resolve(); });
          });
          preparation.signal.addEventListener('abort', () => resolve(), {once: true});
        });
        if (disposed) return;
        if (variant === "auth") {
          const {createAuthWorker, supportsAuthWorker, wasAuthCanvasTransferred} = await import("./engines/auth-worker-host");
          if (disposed) return;
          if (wasAuthCanvasTransferred(canvas)) { restartSceneCanvas(useMainThreadAuth.current); return; }
          if (!useMainThreadAuth.current && supportsAuthWorker()) {
            try {
              scene = await createAuthWorker(canvas, {
                theme: preferences.current.theme, privacy: preferences.current.privacy, mode: preferences.current.authMode,
                reducedMotion: isReducedMotion(motion.matches), signal: preparation.signal,
                onError: () => restartSceneCanvas(true),
              });
            } catch { if (!disposed) restartSceneCanvas(true); return; }
          } else {
            const {createToothScene} = await import("./engines/auth");
            if (disposed) return;
            scene = createToothScene(canvas, {
              theme: preferences.current.theme, reducedMotion: isReducedMotion(motion.matches), onError: showFallback,
            }) as unknown as SceneController;
          }
          if (scene.supported === false) { showFallback(); return; }
          // Replay current props after worker download/first-frame preparation.
          scene.setTheme?.(preferences.current.theme);
          scene.setReducedMotion(isReducedMotion(motion.matches));
          scene.setPrivacy?.(preferences.current.privacy);
          scene.setMode?.(preferences.current.authMode);
        } else {
          const {createHeroWorker, supportsHeroWorker, wasHeroCanvasTransferred} = await import("./engines/hero-worker-host");
          if (disposed) return;
          if (wasHeroCanvasTransferred(canvas)) { restartSceneCanvas(useMainThreadHero.current); return; }
          if (!useMainThreadHero.current && supportsHeroWorker()) {
            try {
              scene = await createHeroWorker(canvas, {
                ...framing.current, theme: preferences.current.theme, reducedMotion: isReducedMotion(motion.matches),
                autoDemonstrate: true, agentElement: agentRef.current, signal: preparation.signal,
                onError: () => restartSceneCanvas(true),
              });
              // Props can change while the worker downloads or compiles.
              scene.setTheme?.(preferences.current.theme);
              scene.setReducedMotion(isReducedMotion(motion.matches));
              scene.setFraming?.(framing.current);
            } catch {
              if (!disposed) restartSceneCanvas(true);
              return;
            }
          } else {
            const [{ initHero }, {prepareMolarMeshes}] = await Promise.all([import("./engines/hero"), import("./engines/prepare-molar")]);
            if (disposed) return;
            const quality = canvas.getBoundingClientRect().width < 720 ? 'standard' : 'high';
            const geometryData = await prepareMolarMeshes(quality, ['maxillary', 'mandibular'], {signal: preparation.signal});
            if (disposed) return;
            scene = initHero(canvas, {
              ...framing.current, quality, geometryData, theme: preferences.current.theme,
              reducedMotion: isReducedMotion(motion.matches), autoDemonstrate: true, agentElement: agentRef.current,
            });
          }
        }
        const prepared = await scenePreparation.prepare(() => scene?.prepare?.() || Promise.resolve());
        if (disposed) {
          scene.destroy?.();
          scene.dispose?.();
          return;
        }
        if (!prepared || failed) return;
        controllerRef.current = scene;
        if (!failed) setState("ready");
        updateVisibility();
      } catch {
        showFallback();
      }
    };

    const onMotionChange = () => scene?.setReducedMotion(isReducedMotion(motion.matches));
    const onContextLost = (event: Event) => {
      event.preventDefault();
      showFallback();
    };

    const trackPointer = (event: PointerEvent) => {
      if (variant !== "auth" || !scene || !scenePreparation.canDraw(inViewport, document.hidden) || failed) return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) / Math.max(1, rect.width / 2);
      const y = -(event.clientY - rect.top - rect.height / 2) / Math.max(1, rect.height / 2);
      scene.setPointer?.(x, y);
      if (drag?.id === event.pointerId) {
        scene.setOrbit?.((event.clientX - drag.x) * 0.004, (event.clientY - drag.y) * 0.003);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (variant !== "auth" || !scene || !scenePreparation.canDraw(inViewport, document.hidden) || failed || event.button !== 0 || !event.isPrimary) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.focus({preventScroll: true});
      try { canvas.setPointerCapture(event.pointerId); } catch { /* An ended pointer cannot be captured. */ }
      canvas.style.cursor = "grabbing";
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      releaseAuthDrag();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (variant !== "auth" || !scene || !scenePreparation.canDraw(inViewport, document.hidden) || failed) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        keyboardYaw += event.key === "ArrowRight" ? 0.1 : event.key === "ArrowLeft" ? -0.1 : 0;
        keyboardPitch += event.key === "ArrowDown" ? 0.06 : event.key === "ArrowUp" ? -0.06 : 0;
        scene?.setOrbit?.(keyboardYaw, keyboardPitch);
      } else if (event.key === "Escape" || event.key === "Home") {
        keyboardYaw = keyboardPitch = 0;
        scene?.resetOrbit?.();
      }
    };

    let observer: IntersectionObserver | null = null;
    // Setup can invoke initialization before an observer/listener throws.
    // Declare cleanup first so late frames/imports cannot allocate a scene.
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      scenePreparation.cancel();
      preparation.abort();
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(startupFrameId);
      observer?.disconnect();
      motion.removeEventListener("change", onMotionChange);
      window.removeEventListener(DISPLAY_PREFERENCES_EVENT, onMotionChange);
      document.removeEventListener("visibilitychange", updateVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("blur", releaseAuthDrag);
      if (variant === "auth") releaseAuthDrag();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("lostpointercapture", onPointerUp);
      canvas.removeEventListener("keydown", onKeyDown);
      scene?.destroy?.();
      scene?.dispose?.();
      if (controllerRef.current === scene) controllerRef.current = null;
    };
    try {
      if (typeof IntersectionObserver === "function") {
        observer = new IntersectionObserver(
          ([entry]) => {
            inViewport = entry.isIntersecting;
            if (inViewport) void initialise();
            updateVisibility();
          },
          { rootMargin: "160px" },
        );
        observer.observe(container);
      } else { inViewport = true; void initialise(); }
      motion.addEventListener("change", onMotionChange);
      window.addEventListener(DISPLAY_PREFERENCES_EVENT, onMotionChange);
      document.addEventListener("visibilitychange", updateVisibility);
      canvas.addEventListener("webglcontextlost", onContextLost);
      if (variant === "auth") {
        window.addEventListener("pointermove", trackPointer, { passive: true });
        window.addEventListener("blur", releaseAuthDrag);
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("lostpointercapture", onPointerUp);
        canvas.addEventListener("keydown", onKeyDown);
      }
    } catch { cleanup(); setState("fallback"); }
    return cleanup;
  }, [variant, canvasGeneration]);

  return (
    <div
      ref={containerRef}
      className={`${styles.experience} ${className}`}
      data-variant={variant}
      data-composition={composition}
      data-theme={theme}
      data-scene-state={state}
      lang={locale}
      dir={sceneDirection(locale)}
    >
      <div className={styles.glow} aria-hidden="true" />
      {variant === "auth" && <><div className={styles.halo} aria-hidden="true" /><div className={styles.haloOuter} aria-hidden="true" /></>}
      <canvas
        key={`${variant}-${canvasGeneration}`}
        ref={canvasRef}
        className={styles.canvas}
        tabIndex={state === "ready" ? 0 : -1}
        role="img"
        aria-label={ariaLabel || (variant === "auth" ? text.authLabel : text.label)}
        aria-describedby={`${componentId}-hint${variant === "hero" ? ` ${componentId}-keys` : ""}`}
        aria-hidden={state !== "ready"}
      />
      {variant === "hero" && <div ref={agentRef} className={styles.agent} data-mode="arrow" data-phase="idle" aria-hidden="true">
        <svg viewBox="0 0 32 36" className={styles.agentIcon} fill="none">
          <g className={styles.agentArrow}><path d="M3 2L26 20L15 21L10 31L3 2Z" fill="white" stroke="#163132" strokeWidth="1.5" strokeLinejoin="round"/><path d="M15 21L21 31" stroke="#163132" strokeWidth="3" strokeLinecap="round"/></g>
          <g className={styles.agentHand}><path d="M12 18V5C12 1 17 1 17 5V14C18 10 22 11 22 15C24 12 27 14 27 18C30 17 31 20 30 24L28 30C27 33 25 34 22 34H15C12 34 10 32 8 29L2 21C0 17 4 15 7 18L12 22V18Z" fill="white" stroke="#163132" strokeWidth="1.5" strokeLinejoin="round"/></g>
        </svg>
        <span dir={sceneDirection(locale)}>{text.agent}</span>
      </div>}
      {!(externalFallback && variant === "hero" && composition === "landing" && framingRegionRef) &&
        <ToothExperienceFallback id={componentId} variant={variant} theme={theme} locale={locale} state={state}/>}
      <span id={`${componentId}-hint`} className={showHint ? `${styles.hint} ${variant === "hero" ? styles.heroHint : ""}` : styles.screenReader}>
          <span className={styles.hintDot} aria-hidden="true" />
          {state === "fallback" ? text.fallback : variant === "auth" ? text.auth : text.hero}
      </span>
      {variant === "hero" && (showHint ? <details className={styles.keyboardHelp}><summary>{text.keyboard}</summary><p id={`${componentId}-keys`}>{text.keys}</p></details> : <span id={`${componentId}-keys`} className={styles.screenReader}>{text.keys}</span>)}
    </div>
  );
}

/** Shared loading/static artwork. A landing host can place it in the actual
 * CSS grid cell from SSR, without first painting a guessed canvas percentage. */
export function ToothExperienceFallback({id,variant="hero",theme="dark",locale="fa",state}: {
  id?: string;
  variant?: "hero" | "auth";
  theme?: ExperienceTheme;
  locale?: string;
  state: ExperienceState;
}) {
  const generatedId = useId().replace(/:/g, "");
  const language = locale.startsWith("fa") ? "fa" : locale.startsWith("ar") ? "ar" : locale.startsWith("tr") ? "tr" : locale.startsWith("ru") ? "ru" : "en";
  const text = copy[language];
  if (state === "ready") return null;
  return <div className={styles.fallback} data-fallback-variant={variant} data-theme={theme} aria-label={state === "loading" ? text.loading : text.fallback} role="img">
    {(variant === "auth" || state === "fallback") && <ToothFallback id={id || generatedId} pair={variant === "hero"}/>}
    {state === "loading" && <span className={styles.loadingDot} aria-hidden="true"/>}
  </div>;
}

function ToothFallback({ id, pair }: { id: string; pair: boolean }) {
  return (
    <div className={`${styles.fallbackPair} ${pair ? "" : styles.fallbackSingle}`}>
      {(pair ? [0, 1] : [0]).map((index) => (
        <svg key={index} viewBox="0 0 180 220" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-enamel-${index}`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#fff" />
              <stop offset=".35" stopColor="#f2fcff" />
              <stop offset=".66" stopColor="#b5d3e7" />
              <stop offset=".82" stopColor="#e9f8ff" />
              <stop offset="1" stopColor="#9abacf" />
            </linearGradient>
          </defs>
          <path d="M89 29C71 7 42 10 29 30C12 55 20 82 30 108C39 131 36 156 43 185C48 210 61 212 67 186L78 139C81 126 90 123 95 141L108 188C114 210 127 205 133 181C140 156 139 132 150 106C163 75 168 46 151 29C137 14 110 10 89 29Z" fill={`url(#${id}-enamel-${index})`} stroke="#e7faff" strokeWidth="1.2" />
          <path d="M32 41C46 21 67 25 81 39M98 37C118 23 138 26 146 43" fill="none" stroke="white" strokeWidth="6" strokeLinecap="round" opacity=".85" />
          <path d="M89 31C81 45 85 61 93 72" fill="none" stroke="#a7c8d8" strokeWidth="2.5" opacity=".55" />
          {!pair && <g>
            <ellipse cx="59" cy="79" rx="17" ry="21" fill="#fff" />
            <ellipse cx="120" cy="79" rx="17" ry="21" fill="#fff" />
            <ellipse cx="60" cy="81" rx="10" ry="13" fill="#37b4cb" />
            <ellipse cx="119" cy="81" rx="10" ry="13" fill="#37b4cb" />
            <ellipse cx="61" cy="82" rx="5" ry="8" fill="#08233b" />
            <ellipse cx="118" cy="82" rx="5" ry="8" fill="#08233b" />
            <circle cx="57" cy="75" r="3.2" fill="#fff" />
            <circle cx="115" cy="75" r="3.2" fill="#fff" />
            <path d="M78 111Q89 122 102 110" fill="none" stroke="#234a64" strokeWidth="2.7" strokeLinecap="round" />
          </g>}
        </svg>
      ))}
    </div>
  );
}
