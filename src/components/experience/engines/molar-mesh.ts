import { ANATOMY_BOUNDS, toothField, smoothstep, occlusalCrease, type ToothMorphology } from './anatomy';

export type MolarQuality = 'standard' | 'high';
export interface MolarMeshData {
  quality: MolarQuality;
  morphology: ToothMorphology;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  surface: Float32Array;
  indices: Uint16Array | Uint32Array;
  description: string;
}

/** The original anatomical field and tetrahedra, with one yield per grid row.
 * A worker drains the iterator directly; fallback hosts yield to input/paint.
 * Both execution paths therefore produce byte-identical authored geometry. */
export function* createMolarMeshTask(quality: MolarQuality = 'standard', morphology: ToothMorphology = 'maxillary'): Generator<void, MolarMeshData> {
  const molarField = (x: number, y: number, z: number) => toothField(x, y, z, morphology);
  const bounds = ANATOMY_BOUNDS;
  const nx = quality === 'high' ? 65 : 47;
  const ny = quality === 'high' ? 97 : 71;
  const nz = quality === 'high' ? 57 : 41;
  const sx = (bounds.max[0] - bounds.min[0]) / (nx - 1);
  const sy = (bounds.max[1] - bounds.min[1]) / (ny - 1);
  const sz = (bounds.max[2] - bounds.min[2]) / (nz - 1);
  const values = new Float32Array(nx * ny * nz);
  const gridIndex = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        values[gridIndex(x, y, z)] = molarField(bounds.min[0] + x * sx, bounds.min[1] + y * sy, bounds.min[2] + z * sz);
      }
      yield;
    }
  }

  const positions: number[] = [], normals: number[] = [], colors: number[] = [], surfaceData: number[] = [], indices: number[] = [];
  const edgeCache = new Map<string, number>();
  const offset = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const tetrahedra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
  const cornerIds = new Array<number>(8);
  const cornerPos = new Array<number[]>(8);
  const gradientStep = .0024;

  function vertex(a: number, b: number) {
    const idA = cornerIds[a], idB = cornerIds[b];
    const key = idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
    const cached = edgeCache.get(key);
    if (cached !== undefined) return cached;
    const va = values[idA], vb = values[idB];
    const t = Math.abs(va - vb) > 1e-9 ? va / (va - vb) : .5;
    const pa = cornerPos[a], pb = cornerPos[b];
    const x = pa[0] + (pb[0] - pa[0]) * t;
    const y = pa[1] + (pb[1] - pa[1]) * t;
    const z = pa[2] + (pb[2] - pa[2]) * t;
    const e = gradientStep;
    let gx = molarField(x + e, y, z) - molarField(x - e, y, z);
    let gy = molarField(x, y + e, z) - molarField(x, y - e, z);
    let gz = molarField(x, y, z + e) - molarField(x, y, z - e);
    const length = Math.hypot(gx, gy, gz) || 1;
    gx /= length; gy /= length; gz /= length;
    const index = positions.length / 3;
    positions.push(x, y, z);
    normals.push(gx, gy, gz);

    const enamel = smoothstep(y, -.245, .16);
    const variation = (Math.sin(x * 13 + z * 9) * Math.sin(y * 16 + z * 3) + Math.sin(x * 7 - z * 11 + y * 5) * .5) * .003;
    const cervicalWarmth = Math.exp(-Math.pow((y + .12) / .13, 2)) * .014;
    const fissure = y > .55 && gy > .28 ? occlusalCrease(x, z, morphology) / .065 : 0;
    // Opaque ivory dentine under pearly enamel; roots are subtly warmer, not
    // neon tinted or painted brown. The real grooves carry only gentle tone.
    colors.push(.842 + enamel * .112 + variation - fissure * .012,
      .774 + enamel * .170 + variation - cervicalWarmth - fissure * .016,
      .651 + enamel * .267 + variation - cervicalWarmth - fissure * .020);
    surfaceData.push(enamel, smoothstep(y, .30, 1.06), Math.min(1, fissure));
    edgeCache.set(key, index);
    return index;
  }

  function triangle(a: number, b: number, c: number) {
    if (a === b || a === c || b === c) return;
    const ax = positions[b * 3] - positions[a * 3];
    const ay = positions[b * 3 + 1] - positions[a * 3 + 1];
    const az = positions[b * 3 + 2] - positions[a * 3 + 2];
    const bx = positions[c * 3] - positions[a * 3];
    const by = positions[c * 3 + 1] - positions[a * 3 + 1];
    const bz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    // Small tetrahedral triangles close the cusp seams and root tips. Dropping
    // them at a display-scale epsilon leaves holes in an otherwise closed field.
    if (cx * cx + cy * cy + cz * cz === 0) return;
    const nx = normals[a * 3] + normals[b * 3] + normals[c * 3];
    const ny = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
    const nz = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
    if (cx * nx + cy * ny + cz * nz < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  }

  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        let negative = 0;
        for (let c = 0; c < 8; c++) {
          const o = offset[c];
          cornerIds[c] = gridIndex(x + o[0], y + o[1], z + o[2]);
          cornerPos[c] = [bounds.min[0] + (x + o[0]) * sx, bounds.min[1] + (y + o[1]) * sy, bounds.min[2] + (z + o[2]) * sz];
          if (values[cornerIds[c]] < 0) negative++;
        }
        if (negative === 0 || negative === 8) continue;
        for (const tet of tetrahedra) {
          const inside: number[] = [], outside: number[] = [];
          for (const c of tet) (values[cornerIds[c]] < 0 ? inside : outside).push(c);
          if (inside.length === 1) {
            triangle(vertex(inside[0], outside[0]), vertex(inside[0], outside[1]), vertex(inside[0], outside[2]));
          } else if (inside.length === 3) {
            triangle(vertex(outside[0], inside[0]), vertex(outside[0], inside[2]), vertex(outside[0], inside[1]));
          } else if (inside.length === 2) {
            const ac = vertex(inside[0], outside[0]), ad = vertex(inside[0], outside[1]);
            const bc = vertex(inside[1], outside[0]), bd = vertex(inside[1], outside[1]);
            triangle(ac, ad, bd);
            triangle(ac, bd, bc);
          }
        }
      }
      yield;
    }
  }

  return {
    quality, morphology,
    positions: new Float32Array(positions), normals: new Float32Array(normals),
    colors: new Float32Array(colors), surface: new Float32Array(surfaceData),
    indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    description: morphology === 'mandibular' ? 'Constructed mandibular molar: five unequal cusps, branching fissures and two curved flattened roots' : 'Constructed maxillary molar: four unequal cusps, oblique ridge, central fossa and three divergent curved roots',
  };
}

export function buildMolarMeshData(quality: MolarQuality = 'standard', morphology: ToothMorphology = 'maxillary'): MolarMeshData {
  const task = createMolarMeshTask(quality, morphology);
  let next = task.next();
  while (!next.done) next = task.next();
  return next.value;
}

export function molarTransferables(meshes: readonly MolarMeshData[]): ArrayBuffer[] {
  return meshes.flatMap(mesh => [mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer, mesh.surface.buffer, mesh.indices.buffer] as ArrayBuffer[]);
}
