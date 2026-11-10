/**
 * Closed anatomical sculpture fields, built from the supplied field mesher.
 * Crown and root are one filled volume. These are authored molar forms, not
 * scans, clinical dimensions or a factory product's manufacturing geometry.
 */
export type ToothMorphology = 'maxillary' | 'mandibular';
export type Point3 = readonly [number, number, number];
export interface RootProfile { start: Point3; end: Point3; bend: readonly [number, number]; radius: number; aspect: number; twist: number }
export interface CuspProfile { x: number; z: number; height: number; width: number; depth: number; angle: number; roundness: number }

export const ANATOMY_BOUNDS = { min: [-1.08, -2.24, -.98] as Point3, max: [1.08, 1.19, .96] as Point3 };
export const ROOT_PROFILES: Record<ToothMorphology, readonly RootProfile[]> = {
  maxillary: [
    { start: [-.29, -.42, .24], end: [-.59, -1.98, .38], bend: [-.020, .052], radius: .245, aspect: .94, twist: -.19 },
    { start: [.275, -.43, .19], end: [.495, -1.83, .30], bend: [.060, -.024], radius: .222, aspect: .87, twist: .24 },
    { start: [-.025, -.43, -.29], end: [-.15, -2.075, -.605], bend: [.115, -.032], radius: .278, aspect: 1.02, twist: .09 },
  ],
  mandibular: [
    { start: [-.355, -.40, -.015], end: [-.615, -2.055, .06], bend: [-.028, .078], radius: .268, aspect: 1.34, twist: -.23 },
    { start: [.35, -.42, -.022], end: [.535, -1.93, -.12], bend: [.068, -.072], radius: .237, aspect: 1.29, twist: .19 },
  ],
};

/** Unequal positions, slopes and rounded tips prevent a four-bubble silhouette. */
export const CUSP_PROFILES: Record<ToothMorphology, readonly CuspProfile[]> = {
  maxillary: [
    { x: -.355, z: -.29, height: 1.075, width: .405, depth: .368, angle: -.22, roundness: .115 },
    { x: .315, z: -.26, height: .992, width: .355, depth: .334, angle: .18, roundness: .145 },
    { x: -.385, z: .285, height: 1.012, width: .382, depth: .331, angle: .13, roundness: .13 },
    { x: .32, z: .26, height: .939, width: .327, depth: .312, angle: -.23, roundness: .155 },
  ],
  mandibular: [
    { x: -.375, z: -.27, height: 1.069, width: .387, depth: .334, angle: -.09, roundness: .11 },
    { x: .365, z: -.245, height: 1.034, width: .354, depth: .316, angle: .19, roundness: .12 },
    { x: -.465, z: .27, height: .984, width: .306, depth: .325, angle: .10, roundness: .14 },
    { x: -.015, z: .31, height: .947, width: .289, depth: .295, angle: -.12, roundness: .16 },
    { x: .455, z: .22, height: .902, width: .271, depth: .274, angle: -.21, roundness: .17 },
  ],
};

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function smoothstep(value: number, low: number, high: number) { const t = clamp((value - low) / (high - low), 0, 1); return t * t * (3 - 2 * t); }
export function smoothUnion(a: number, b: number, radius: number) {
  const h = clamp(.5 + .5 * (b - a) / radius, 0, 1);
  return b + (a - b) * h - radius * h * (1 - h);
}
const intersection = (a: number, b: number, radius: number) => -smoothUnion(-a, -b, radius);
function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 1e-8 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
const gaussian = (x: number, z: number, cx: number, cz: number, sx: number, sz: number, height: number) => height * Math.exp(-Math.pow((x - cx) / sx, 2) - Math.pow((z - cz) / sz, 2));

export function rootField(x: number, y: number, z: number, root: RootProfile) {
  const t = clamp((root.start[1] - y) / (root.start[1] - root.end[1]), 0, 1);
  const curve = Math.sin(Math.PI * t), apicalCurve = Math.sin(Math.PI * t) * t * t;
  const cx = root.start[0] + (root.end[0] - root.start[0]) * t + root.bend[0] * curve + root.twist * apicalCurve * .14;
  const cz = root.start[2] + (root.end[2] - root.start[2]) * t + root.bend[1] * curve;
  const radius = .011 + (root.radius - .011) * Math.pow(1 - t, .79) * (1 + .10 * Math.sin(Math.PI * t));
  const angle = root.twist * t, px = x - cx, pz = z - cz;
  const dx = px * Math.cos(angle) - pz * Math.sin(angle);
  const dz = (px * Math.sin(angle) + pz * Math.cos(angle)) / (root.aspect - .10 * t);
  // A filled, gently flattened section and longitudinal root concavity.
  const flute = .023 * Math.exp(-Math.pow((dx + .016 * curve) / .066, 2)) * Math.sin(t * Math.PI);
  const radial = Math.hypot(dx, dz) - radius + flute;
  return intersection(radial, Math.max(y - root.start[1], root.end[1] - y), .018);
}

/** Shallow irregular developmental grooves, shared by geometry and enamel tint. */
export function occlusalCrease(x: number, z: number, morphology: ToothMorphology) {
  const lower = morphology === 'mandibular';
  const central = z + .005 + Math.sin(x * 5.4 + .2) * .032;
  const cross = x - (lower ? .115 : -.04) - Math.sin(z * 7.3) * .046;
  let depth = .036 * Math.exp(-Math.pow(central / .027, 2)) * Math.exp(-Math.pow(x / .55, 6));
  depth += .027 * Math.exp(-Math.pow(cross / .025, 2)) * Math.exp(-Math.pow(z / .43, 6));
  if (lower) depth += .023 * Math.exp(-Math.pow((x + .24 + z * .29) / .03, 2)) * smoothstep(z, .025, .16) * (1 - smoothstep(z, .35, .5));
  else depth *= 1 - .55 * Math.exp(-Math.pow((z - .74 * x + .018) / .065, 2));
  return depth;
}

export function occlusalHeight(x: number, z: number, morphology: ToothMorphology) {
  const lower = morphology === 'mandibular';
  // Rounded sloping cusp facets intersect into ridges and saddles. Unlike summed
  // Gaussian bumps, each cusp has a broad asymmetric shoulder and a small tip.
  let top = .565;
  for (const cusp of CUSP_PROFILES[morphology]) {
    const px = x - cusp.x, pz = z - cusp.z;
    const dx = (px * Math.cos(cusp.angle) - pz * Math.sin(cusp.angle)) / cusp.width;
    const dz = (px * Math.sin(cusp.angle) + pz * Math.cos(cusp.angle)) / cusp.depth;
    const planar = (Math.abs(dx) ** 1.72 + Math.abs(dz) ** 1.72) ** (1 / 1.72);
    const facet = cusp.height - .305 * (Math.sqrt(planar * planar + cusp.roundness * cusp.roundness) - cusp.roundness);
    top = intersection(top, facet, .052);
  }
  const marginal = Math.exp(-Math.pow((Math.abs(x + .01) - (lower ? .685 : .62)) / .07, 2));
  top += marginal * .031 * Math.exp(-Math.pow(z / .40, 4));
  if (!lower) top += .044 * Math.exp(-Math.pow((z - .74 * x + .018) / .095, 2)) * Math.exp(-Math.pow(x / .39, 4));
  top -= gaussian(x, z, -.035, -.008, .145, .136, .042);
  top -= gaussian(x, z, -.45, .009, .064, .058, .022);
  top -= gaussian(x, z, .40, -.018, .060, .052, .021);
  return top - occlusalCrease(x, z, morphology);
}

export function toothField(x: number, y: number, z: number, morphology: ToothMorphology = 'maxillary') {
  const lower = morphology === 'mandibular', theta = Math.atan2(z, x);
  const cervicalY = -.17 + .027 * Math.cos(theta * 2 + .35) + .009 * Math.sin(theta * 3);
  const cervical = 1 - smoothstep(y, -.29, .20);
  const shoulder = Math.exp(-Math.pow((y - .28) / .29, 2));
  const occlusalTaper = smoothstep(y, .52, 1.10);
  const seam = .008 * Math.exp(-Math.pow((y - cervicalY) / .025, 2));
  let rx = (lower ? .846 : .777) + .028 * shoulder - .17 * cervical - .105 * occlusalTaper - seam;
  let rz = (lower ? .633 : .697) + .020 * shoulder - .156 * cervical - .105 * occlusalTaper - seam;
  // The upper crown has a rhomboidal table; the lower crown is longer with a
  // smaller distal end. Buccal and lingual surfaces have different convexity.
  const distalTaper = smoothstep(x, -.28, .73);
  rz *= 1 - (lower ? .07 : .085) * distalTaper;
  const skewX = x + (lower ? .035 : .13) * z - .012 * smoothstep(y, .0, .85);
  const skewZ = z - .018 * Math.cos(theta - .4) - .016 * smoothstep(y, .25, .95);
  const cheekWindow = smoothstep(z, .17, .54) * smoothstep(y, -.01, .28) * (1 - smoothstep(y, .78, 1.08));
  let buccalGroove = Math.exp(-Math.pow((x - .015 + .035 * y) / .062, 2));
  if (lower) buccalGroove = Math.exp(-Math.pow((x + .24 + .04 * y) / .051, 2)) + .75 * Math.exp(-Math.pow((x - .29 + .02 * y) / .046, 2));
  rz -= .027 * buccalGroove * cheekWindow;
  rx *= 1 + .019 * Math.sin(theta + .65) + .008 * Math.cos(theta * 3 - .3);
  const exponent = lower ? 2.75 : 2.52;
  const radial = (Math.abs(skewX / rx) ** exponent + Math.abs(skewZ / rz) ** exponent) ** (1 / exponent);
  let crown = (radial - 1) * Math.min(rx, rz);
  crown = intersection(crown, y - occlusalHeight(x, z, morphology), .038);
  crown = intersection(crown, -.285 - y, .075);
  // A real filled root trunk precedes the furcation, instead of roots meeting
  // at a razor-thin shell. The neck remains narrower than the enamel shoulder.
  let field = smoothUnion(crown, ellipsoid(x + .015, y + .335, z, lower ? .583 : .538, .29, lower ? .433 : .478), .063);
  for (const root of ROOT_PROFILES[morphology]) field = smoothUnion(field, rootField(x, y, z, root), .065);
  return field;
}
