export type HeroComposition = 'centered' | 'landing';
export type SceneDirection = 'ltr' | 'rtl';

/** Physical left/top coordinates, regardless of the surrounding text direction. */
export interface SceneRegion { x: number; y: number; width: number; height: number }
export interface SceneRectangle { left: number; top: number; width: number; height: number }
export interface HeroFramingOptions {
  composition?: HeroComposition;
  locale?: string;
  direction?: SceneDirection;
  region?: SceneRegion | null;
}
export interface SceneEnvelope { radial: number; minY: number; maxY: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const positive = (value: number) => Number.isFinite(value) && value > 0 ? value : 1;
const fullRegion: SceneRegion = { x: 0, y: 0, width: 1, height: 1 };

export function sceneDirection(locale = 'en'): SceneDirection {
  return /^(fa|ar)(?:[-_]|$)/i.test(locale) ? 'rtl' : 'ltr';
}

export function validSceneRegion(region?: SceneRegion | null): SceneRegion | null {
  if (!region || !Object.values(region).every(Number.isFinite) || region.width <= 0 || region.height <= 0) return null;
  const x = clamp(region.x, 0, 1), y = clamp(region.y, 0, 1);
  const width = clamp(region.x + region.width, 0, 1) - x;
  const height = clamp(region.y + region.height, 0, 1) - y;
  return width >= .025 && height >= .025 ? { x, y, width, height } : null;
}

/** Measuring both rectangles cancels page scroll and translated layout offsets. */
export function normalizeSceneRegion(canvas: SceneRectangle, target?: SceneRectangle | null): SceneRegion | null {
  if (!target || ![canvas.left, canvas.top, canvas.width, canvas.height, target.left, target.top, target.width, target.height].every(Number.isFinite) || canvas.width <= 0 || canvas.height <= 0) return null;
  return validSceneRegion({
    x: (target.left - canvas.left) / canvas.width,
    y: (target.top - canvas.top) / canvas.height,
    width: target.width / canvas.width,
    height: target.height / canvas.height,
  });
}

export function heroSceneRegion(width: number, options: HeroFramingOptions = {}): SceneRegion {
  if (options.composition !== 'landing') return { ...fullRegion };
  const supplied = validSceneRegion(options.region);
  if (supplied) return supplied;
  if (width < 960) return { x: .035, y: .46, width: .93, height: .48 };
  const direction = options.direction || sceneDirection(options.locale);
  return { x: direction === 'rtl' ? .025 : .455, y: .08, width: .52, height: .82 };
}

/**
 * Fit the complete visible enamel envelope for every horizontal orbit angle.
 * The cylinder bounds avoid camera zoom pumping as the automatic orbit turns.
 * Coordinates are relative to the unchanged physical orbit target.
 */
export function fitLandingRadius(width: number, height: number, region: SceneRegion, envelope: SceneEnvelope, fov = 34, pitch = .30) {
  const aspect = positive(width) / positive(height), halfFov = Math.tan(fov * Math.PI / 360);
  const tx = Math.max(.001, halfFov * aspect * region.width * .90);
  const ty = Math.max(.001, halfFov * region.height * .86);
  const radial = Math.max(.1, envelope.radial), sin = Math.sin(pitch), cos = Math.cos(pitch);
  const horizontal = radial * Math.hypot(cos, 1 / tx) + envelope.maxY * sin;
  const upper = radial * Math.abs(cos - sin / ty) + envelope.maxY * (sin + cos / ty);
  const lower = radial * Math.abs(cos + sin / ty) + envelope.minY * (sin - cos / ty);
  return Math.max(8.5, horizontal, upper, lower) + .12;
}

/** Negative view offsets move the optical axis right/down in canvas pixels. */
export function heroCameraFraming(width: number, height: number, options: HeroFramingOptions = {}, envelope: SceneEnvelope = { radial: 2.8, minY: -1.3, maxY: 2.1 }) {
  width = positive(width); height = positive(height);
  const region = heroSceneRegion(width, options);
  const centerX = region.x + region.width / 2, centerY = region.y + region.height / 2;
  return {
    region, centerX, centerY,
    offsetX: (.5 - centerX) * width,
    offsetY: (.5 - centerY) * height,
    radius: options.composition === 'landing' ? fitLandingRadius(width, height, region, envelope) : Math.max(8.5, 7.6 / Math.max(.52, width / height)),
  };
}
