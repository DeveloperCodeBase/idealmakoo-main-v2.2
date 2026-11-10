// @ts-nocheck
// Adapted from the user-supplied landingpage source. Public React boundaries are strictly typed.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createTooth } from './tooth';
import { createCoastalEnvironment } from './environment';
import { createGpuFrameGate } from './gpu-frame-gate';
import type {RubikPlatform} from './rubik-platform';

const HALF_PI = Math.PI / 2;
const SPACING = 1.014;
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const AXIS_NAMES = ['x', 'y', 'z'];
const clamp = THREE.MathUtils.clamp;
const FACE_DEFS = [
  { name: 'R', axis: 'x', sign: 1, direction: AXES.x.clone(), color: 0xf34a52 },
  { name: 'L', axis: 'x', sign: -1, direction: AXES.x.clone().negate(), color: 0xffa143 },
  { name: 'U', axis: 'y', sign: 1, direction: AXES.y.clone(), color: 0xf0f4ef },
  { name: 'D', axis: 'y', sign: -1, direction: AXES.y.clone().negate(), color: 0xffd845 },
  { name: 'F', axis: 'z', sign: 1, direction: AXES.z.clone(), color: 0x25c991 },
  { name: 'B', axis: 'z', sign: -1, direction: AXES.z.clone().negate(), color: 0x4b80f5 },
];
const MOVES = {
  R: { axis: 'x', layer: 1, turns: -1 }, L: { axis: 'x', layer: -1, turns: 1 },
  U: { axis: 'y', layer: 1, turns: -1 }, D: { axis: 'y', layer: -1, turns: 1 },
  F: { axis: 'z', layer: 1, turns: -1 }, B: { axis: 'z', layer: -1, turns: 1 },
  M: { axis: 'x', layer: 0, turns: 1 }, E: { axis: 'y', layer: 0, turns: 1 }, S: { axis: 'z', layer: 0, turns: -1 },
};

export function normalizedTurns(turns) {
  let n = Math.round(turns) % 4;
  if (n > 2) n -= 4;
  if (n < -2) n += 4;
  return Object.is(n, -0) ? 0 : n;
}

function notationFor(axis, layer, turns) {
  const name = Object.keys(MOVES).find(key => MOVES[key].axis === axis && MOVES[key].layer === layer);
  const n = normalizedTurns(turns);
  if (!name || n === 0) return '';
  if (Math.abs(n) === 2) return `${name}2`;
  return name + (n === MOVES[name].turns ? '' : "'");
}

export function parseMove(input) {
  const match = String(input).trim().replace(/[’′]/g, "'").match(/^([RLUDFBMES])([2']?)$/i);
  if (!match) return null;
  const base = MOVES[match[1].toUpperCase()];
  const turns = base.turns * (match[2] === "'" ? -1 : match[2] === '2' ? 2 : 1);
  return { ...base, turns, notation: notationFor(base.axis, base.layer, turns) };
}

export function inverseMove(move) {
  return { axis: move.axis, layer: move.layer, turns: -move.turns, notation: notationFor(move.axis, move.layer, -move.turns) };
}

function ease(t) {
  return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function canonicalQuaternion(q) {
  const matrix = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const e = matrix.elements;
  for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10]) e[index] = Math.round(e[index]);
  return q.setFromRotationMatrix(matrix).normalize();
}

/**
 * The DOM-free state engine and the renderer share one exact lattice. An active
 * layer is only a presentation transform; integer positions and orientations
 * are committed together at the end of a snap. Commands are serialized, and
 * undo/solve are resolved against history when their turn reaches the queue.
 * `update` is intentionally external so the host owns the animation loop.
 */
export function initRubik(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('initRubik requires a canvas surface');
  const platform: RubikPlatform = options.platform || {
    pixelRatio: () => window.devicePixelRatio || 1,
    motionQuery: () => window.matchMedia('(prefers-reduced-motion: reduce)'),
    windowEvents: window, controlsRoot: document,
  };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  const frameGate = createGpuFrameGate(renderer.getContext());
  renderer.debug.onShaderError = () => { throw new Error('The glass cube shader could not be initialized.'); };
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(platform.pixelRatio() || 1, options.maxPixelRatio || 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, .1, 80);
  camera.position.set(6.70, 4.55, 8.85);
  camera.lookAt(0, .19, 0);
  const viewGroup = new THREE.Group();
  viewGroup.name = 'Damped orbit presentation';
  scene.add(viewGroup);
  const cubeRoot = new THREE.Group();
  cubeRoot.name = 'Exact integer cube lattice';
  cubeRoot.position.y = -.69;
  viewGroup.add(cubeRoot);

  // A dark photographic studio keeps black surfaces black. A uniformly bright
  // room makes every face reflect the same gray and erases the enamel's form.
  const environment = new THREE.Scene();
  environment.background = new THREE.Color(0x050a0e);
  const studioObjects = [];
  function softbox(w, h, position, intensity, tint = 0xffffff) {
    const geometry = new THREE.PlaneGeometry(w, h);
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(intensity), side: THREE.DoubleSide });
    const panel = new THREE.Mesh(geometry, material);
    panel.position.set(...position);
    panel.lookAt(0, 0, 0);
    environment.add(panel);
    studioObjects.push({ geometry, material });
  }
  softbox(4.0, 6.4, [-4.8, 6.4, -5.6], 2.8, 0xf4f7ff);
  softbox(.85, 8.0, [7.0, -.8, -5.5], 3.7, 0xddeeff);
  softbox(2.8, 6.0, [-6.0, -1.6, 6.0], 1.9, 0xfff7e9);
  softbox(1.6, 4.2, [-4.5, 3.2, 4.0], 2.3, 0xffffff);
  softbox(5.0, .8, [2.8, 7.4, 5.0], 2.2, 0xe7fcff);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, .035);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = .94;
  for (const item of studioObjects) { item.geometry.dispose(); item.material.dispose(); }
  pmrem.dispose();

  const keyLight = new THREE.DirectionalLight(0xfff8ec, 2.05);
  keyLight.position.set(-3.2, 7.4, 5.1);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -4;
  keyLight.shadow.camera.right = 4;
  keyLight.shadow.camera.top = 5;
  keyLight.shadow.camera.bottom = -4;
  keyLight.shadow.camera.near = .5;
  keyLight.shadow.camera.far = 20;
  keyLight.shadow.normalBias = .025;
  keyLight.shadow.bias = -.00015;
  keyLight.shadow.radius = 4;
  scene.add(keyLight);
  scene.add(new THREE.HemisphereLight(0xe6f3ff, 0x17222d, .22));
  const rimLight = new THREE.DirectionalLight(0xc6faff, 1.1);
  rimLight.position.set(4.2, 2.6, -3.8);
  scene.add(rimLight);
  const cyanLight = new THREE.PointLight(0x79e0e8, .52, 12, 2);
  cyanLight.position.set(-3.5, 1.4, 1.3);
  scene.add(cyanLight);
  const whiteFill = new THREE.PointLight(0xe4eaff, 1.6, 16, 2);
  whiteFill.position.set(3.6, 4.4, 5.4);
  scene.add(whiteFill);

  const bodyGeometry = new RoundedBoxGeometry(.964, .964, .964, 3, .055);
  const rimGeometry = new RoundedBoxGeometry(.856, .856, .028, 2, .030);
  const panelGeometry = new RoundedBoxGeometry(.824, .824, .031, 2, .024);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({ color: 0x16323d, metalness: .11, roughness: .11, transmission: .34, thickness: .29, ior: 1.47, attenuationColor: new THREE.Color(0x124553), attenuationDistance: 1.75, clearcoat: 1, clearcoatRoughness: .075, envMapIntensity: 1.25 });
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x677c83, metalness: .91, roughness: .16, envMapIntensity: 1.32 });
  const panelMaterials = {};
  for (const face of FACE_DEFS) {
    panelMaterials[face.name] = new THREE.MeshPhysicalMaterial({ color: 0x0d2530, metalness: .13, roughness: .12, transmission: .26, thickness: .12, ior: 1.48, attenuationColor: new THREE.Color(0x193f4b), attenuationDistance: 1.6, clearcoat: 1, clearcoatRoughness: .085, envMapIntensity: 1.30 });
  }

  const cubies = [], pickTargets = [];
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (!x && !y && !z) continue;
        const group = new THREE.Group();
        const cubie = { id: `cubie-${x + 1}${y + 1}${z + 1}`, home: { x, y, z }, grid: { x, y, z }, group, faces: [] };
        group.name = cubie.id;
        group.position.set(x * SPACING, y * SPACING, z * SPACING);
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.name = `${cubie.id} body`;
        body.castShadow = true;
        body.receiveShadow = true;
        body.userData.cubie = cubie;
        group.add(body);
        pickTargets.push(body);
        cubie.body = body;
        for (const face of FACE_DEFS) {
          if (cubie.home[face.axis] !== face.sign) continue;
          const bezel = new THREE.Mesh(rimGeometry, rimMaterial);
          const panel = new THREE.Mesh(panelGeometry, panelMaterials[face.name]);
          const q = new THREE.Quaternion().setFromUnitVectors(zAxis, face.direction);
          bezel.quaternion.copy(q);
          panel.quaternion.copy(q);
          bezel.position.copy(face.direction).multiplyScalar(.478);
          panel.position.copy(face.direction).multiplyScalar(.495);
          bezel.receiveShadow = true;
          panel.receiveShadow = true;
          group.add(bezel, panel);
          cubie.faces.push(face);
        }
        cubeRoot.add(group);
        cubies.push(cubie);
      }
    }
  }

  const coreGeometry = new THREE.BoxGeometry(1.72, 1.72, 1.72);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x081018, metalness: .32, roughness: .30 });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  cubeRoot.add(core);

  const hoverMaterial = new THREE.MeshBasicMaterial({ color: 0xbcecf2, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const hoverOverlay = new THREE.Mesh(bodyGeometry, hoverMaterial);
  hoverOverlay.name = 'Soft pointer selection';
  hoverOverlay.scale.setScalar(1.012);
  hoverOverlay.renderOrder = 3;

  const tooth = createTooth({ quality: options.toothQuality || 'high', animate: false, material: { roughness: .165, envMapIntensity: 1.14 } });
  const toothCarrier = cubies.find(cubie => cubie.home.x === 0 && cubie.home.y === 1 && cubie.home.z === 0);
  const toothScale = .54;
  tooth.group.scale.setScalar(toothScale);
  tooth.group.rotation.y = -.13;
  tooth.group.position.set(0, .554 - tooth.bounds.min[1] * toothScale, 0);
  toothCarrier.group.add(tooth.group);
  const mountGeometry = new THREE.CylinderGeometry(.49, .52, .065, 64, 1, false);
  const mountMaterial = new THREE.MeshPhysicalMaterial({ color: 0xc2e7ed, metalness: .0, roughness: .075, transmission: .76, thickness: .075, ior: 1.46, clearcoat: 1, clearcoatRoughness: .065, envMapIntensity: 1.1 });
  const mount = new THREE.Mesh(mountGeometry, mountMaterial);
  mount.position.y = .52;
  mount.receiveShadow = true;
  toothCarrier.group.add(mount);
  const haloGeometry = new THREE.TorusGeometry(.495, .005, 6, 72);
  const haloMaterial = new THREE.MeshBasicMaterial({ color: 0xafebf0, transparent: true, opacity: .26, depthWrite: false, toneMapped: false });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.rotation.x = -HALF_PI;
  halo.position.set(0, .550, 0);
  toothCarrier.group.add(halo);

  const floorGeometry = new THREE.PlaneGeometry(10, 10);
  const floorMaterial = new THREE.ShadowMaterial({ color: 0x09202a, opacity: .25, transparent: true, depthWrite: false });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -HALF_PI;
  floor.position.y = -2.22;
  floor.receiveShadow = true;
  // The plinth receives actual cubie/root shadows as the user turns a layer.
  scene.add(floor);

  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const viewTarget = new THREE.Quaternion();
  const viewEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const listeners = [];
  const controls = options.controlsRoot === undefined ? platform.controlsRoot : options.controlsRoot;
  const byId = id => controls?.querySelector(`#${id}`) || null;
  const statusLabel = byId('rubik-status-label');
  const moveCountLabel = byId('rubik-move-count') || byId('move-count');
  const undoButton = byId('rubik-undo-btn');
  const solveButton = byId('rubik-solve-btn');
  const toothButton = byId('rubik-tooth-btn');
  const spinButton = byId('rubik-spin-btn');
  const finishButton = byId('rubik-finish-btn');
  const motionQuery = platform.motionQuery();
  let reducedMotion = options.reducedMotion ?? motionQuery.matches;
  let disposed = false, visible = true, width = 1, height = 1;
  const coast = createCoastalEnvironment(renderer, texture => { if (!disposed) { scene.environment = texture; keyLight.position.copy(coast.sunDirection).multiplyScalar(11); } }, environmentTarget.texture);
  let orbitYaw = 0, orbitPitch = 0, hoverX = 0, hoverY = 0;
  let pointerInside = false, pointer = null, hovered = null;
  let active = null;
  const queue = [], history = [];
  let historyId = 0, completedMoves = 0;
  let finish = 'Glass', toothVisible = options.tooth !== false, autoRotate = options.autoRotate !== false;
  let autoOrbitBlend = 0, orbitResumeAt = 0;
  let lastStatus = '', lastMoveCount = -1;
  let feedback = '', feedbackUntil = 0;
  let lastNow = 0;
  let finishTransition = null;
  tooth.group.visible = toothVisible;
  halo.visible = toothVisible;
  mount.visible = toothVisible;

  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  canvas.tabIndex = canvas.hasAttribute('tabindex') ? canvas.tabIndex : 0;
  if (!canvas.hasAttribute('aria-label')) canvas.setAttribute('aria-label', 'Interactive glass Rubik cube with a mounted enamel tooth. Drag a cube face to turn a layer. Drag the tooth, empty space, or use the right mouse button to orbit. Click turns a face; Shift reverses.');
  if (statusLabel) {
    statusLabel.setAttribute('aria-live', 'polite');
    statusLabel.setAttribute('aria-atomic', 'true');
  }

  function listen(target, type, listener, settings) {
    if (!target) return;
    target.addEventListener(type, listener, settings);
    listeners.push(() => target.removeEventListener(type, listener, settings));
  }

  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || canvas.clientWidth || 550));
    const h = Math.max(1, Math.round(rect.height || canvas.clientHeight || 560));
    const pixelRatio = Math.min(platform.pixelRatio() || 1, options.maxPixelRatio || 2);
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    if (w !== width || h !== height) {
      width = w; height = h;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.zoom = Math.min(1, camera.aspect / .77);
      camera.updateProjectionMatrix();
    }
  }

  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointerNDC.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointerNDC, camera);
    const hit = raycaster.intersectObjects(pickTargets, false)[0];
    if (!hit) return null;
    // The mounted tooth is an orbit handle. Do not select a cube face hidden
    // behind the tooth or its transparent plinth when the user grabs it.
    const toothHit = toothVisible ? raycaster.intersectObjects([tooth.mesh, mount], false)[0] : null;
    if (toothHit && toothHit.distance < hit.distance) return null;
    const cubie = hit.object.userData.cubie;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const inverseRoot = cubeRoot.getWorldQuaternion(new THREE.Quaternion()).invert();
    normal.applyQuaternion(inverseRoot);
    const axis = AXIS_NAMES.reduce((a, b) => Math.abs(normal[a]) > Math.abs(normal[b]) ? a : b);
    const sign = normal[axis] >= 0 ? 1 : -1;
    return { cubie, axis, sign, localPoint: cubeRoot.worldToLocal(hit.point.clone()), worldPoint: hit.point.clone() };
  }

  function hoverCubie(cubie) {
    if (hovered === cubie) return;
    hovered = cubie;
    if (cubie) cubie.group.add(hoverOverlay);
    else hoverOverlay.removeFromParent();
    canvas.style.cursor = pointer ? 'grabbing' : cubie ? 'grab' : 'grab';
  }

  function updatePointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    hoverX = clamp(((event.clientX - rect.left) / (rect.width || 1) - .5) * 2, -1, 1);
    hoverY = clamp(((event.clientY - rect.top) / (rect.height || 1) - .5) * 2, -1, 1);
  }

  function freezeView() {
    viewEuler.setFromQuaternion(viewGroup.quaternion, 'YXZ');
    orbitYaw = viewEuler.y;
    orbitPitch = viewEuler.x;
    hoverX = hoverY = 0;
    autoOrbitBlend = 0;
    orbitResumeAt = lastNow + 1900;
  }

  function beginLayer(move, phase = 'animate') {
    const pivot = new THREE.Group();
    pivot.name = 'Continuous active layer preview';
    const selection = cubies.filter(cubie => cubie.grid[move.axis] === move.layer);
    cubeRoot.add(pivot);
    for (const cubie of selection) pivot.add(cubie.group);
    active = {
      ...move, pivot, selection, phase, angle: 0, targetAngle: phase === 'drag' ? 0 : move.turns * HALF_PI,
      startAngle: 0, elapsed: 0, startTime: lastNow,
      duration: reducedMotion ? .09 : move.source === 'solve' || move.source === 'reset' ? .235 : move.source === 'scramble' ? .27 : .37,
      historyMode: move.historyMode || 'record',
    };
  }

  function finishLayer() {
    const finishing = active;
    if (!finishing) return;
    const turns = normalizedTurns(finishing.turns || 0);
    const q = new THREE.Quaternion().setFromAxisAngle(AXES[finishing.axis], turns * HALF_PI);
    for (const cubie of finishing.selection) {
      cubeRoot.add(cubie.group);
      if (turns) {
        const grid = new THREE.Vector3(cubie.grid.x, cubie.grid.y, cubie.grid.z).applyQuaternion(q);
        cubie.grid = { x: Math.round(grid.x), y: Math.round(grid.y), z: Math.round(grid.z) };
        canonicalQuaternion(cubie.group.quaternion.premultiply(q));
      }
      cubie.group.position.set(cubie.grid.x * SPACING, cubie.grid.y * SPACING, cubie.grid.z * SPACING);
    }
    cubeRoot.remove(finishing.pivot);
    if (turns) {
      completedMoves++;
      if (finishing.historyMode === 'undo') {
        // The queue owns history mutations. The ID check makes accidental
        // stale inverse commands harmless even if a host calls APIs rapidly.
        if (history.at(-1)?.id === finishing.expectedHistoryId) history.pop();
      } else if (finishing.historyMode === 'record') {
        history.push({ id: ++historyId, axis: finishing.axis, layer: finishing.layer, turns, notation: notationFor(finishing.axis, finishing.layer, turns) });
      }
    }
    active = null;
    if (!pointer) hoverCubie(null);
    options.onMove?.({ notation: notationFor(finishing.axis, finishing.layer, turns), source: finishing.source || 'user', moveCount: history.length, turns });
  }

  function pumpQueue() {
    if (disposed || active || pointer?.mode === 'face-pending' || pointer?.mode === 'face-drag') return;
    while (queue.length && !active) {
      const command = queue.shift();
      if (command.kind === 'undo') {
        const last = history.at(-1);
        if (last) beginLayer({ ...inverseMove(last), source: 'undo', historyMode: 'undo', expectedHistoryId: last.id });
      } else if (command.kind === 'solve' || command.kind === 'reset') {
        const reverse = history.slice().reverse().map(item => ({ kind: 'move', ...inverseMove(item), source: command.kind, historyMode: 'undo', expectedHistoryId: item.id }));
        queue.unshift(...reverse);
        if (!reverse.length) {
          feedback = command.kind === 'reset' ? 'Reset · ready to play' : 'Already solved';
          feedbackUntil = lastNow + 1200;
        }
      } else if (command.kind === 'move') {
        if (command.historyMode === 'undo' && history.at(-1)?.id !== command.expectedHistoryId) continue;
        beginLayer(command);
      }
    }
  }

  function move(notation) {
    if (disposed) return false;
    const inputs = String(notation).trim().split(/\s+/).filter(Boolean);
    const parsed = inputs.map(parseMove);
    if (!parsed.length || parsed.some(item => !item)) return false;
    queue.push(...parsed.map(item => ({ kind: 'move', ...item, source: 'user' })));
    feedbackUntil = 0;
    return true;
  }

  function scramble(count = 18) {
    if (disposed) return [];
    const sequence = [], faces = ['U', 'D', 'R', 'L', 'F', 'B'];
    let previousAxis = null;
    for (let i = 0; i < clamp(Math.round(Number(count) || 18), 1, 40); i++) {
      const candidates = faces.filter(face => MOVES[face].axis !== previousAxis);
      const face = candidates[Math.floor(Math.random() * candidates.length)];
      const suffix = Math.random() < .47 ? "'" : Math.random() < .24 ? '2' : '';
      const parsed = parseMove(face + suffix);
      queue.push({ kind: 'move', ...parsed, source: 'scramble' });
      sequence.push(parsed.notation);
      previousAxis = parsed.axis;
    }
    feedbackUntil = 0;
    return sequence;
  }

  function undo() {
    if (disposed) return;
    queue.push({ kind: 'undo' });
    feedbackUntil = 0;
  }

  function solve() {
    if (disposed) return;
    queue.push({ kind: 'solve' });
    feedbackUntil = 0;
  }

  function releaseCapture(pointerId) {
    try { if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId); } catch { /* Surface may have been detached. */ }
  }

  function snapDrag(turns, cancelled = false) {
    if (!active || active.phase !== 'drag') return;
    active.turns = normalizedTurns(turns);
    active.notation = notationFor(active.axis, active.layer, active.turns);
    active.startAngle = active.angle;
    // Keep equivalent whole revolutions during the animation; commit only the
    // canonical quarter turn. This prevents a long drag from snapping backward.
    active.targetAngle = cancelled ? 0 : Math.round(turns) * HALF_PI;
    active.elapsed = 0;
    active.startTime = lastNow;
    active.duration = reducedMotion ? .09 : .16 + Math.min(Math.abs(active.targetAngle - active.startAngle) / HALF_PI * .18, .22);
    active.phase = 'animate';
    active.historyMode = cancelled || !active.turns ? 'none' : 'record';
  }

  function cancelPointer() {
    if (!pointer) return;
    const id = pointer.id;
    if (pointer.mode === 'face-drag') snapDrag(0, true);
    pointer = null;
    orbitResumeAt = lastNow + 1900;
    releaseCapture(id);
    hoverCubie(null);
    canvas.style.cursor = 'grab';
  }

  function reset() {
    if (disposed) return;
    // Finish a committed animation, or smoothly roll a live preview back, then
    // reverse what has actually completed. Queued future moves are discarded.
    queue.length = 0;
    cancelPointer();
    queue.push({ kind: 'reset' });
    orbitYaw = 0;
    orbitPitch = 0;
    hoverX = hoverY = 0;
    orbitResumeAt = lastNow + 1900;
    feedbackUntil = 0;
    updateControlState();
  }

  function toScreen(localPoint) {
    const world = cubeRoot.localToWorld(localPoint.clone());
    world.project(camera);
    return new THREE.Vector2((world.x + 1) * .5 * width, (1 - world.y) * .5 * height);
  }

  function chooseDragAxis(currentPointer, dx, dy) {
    const movement = new THREE.Vector2(dx, dy);
    const point = currentPointer.hit.localPoint;
    const origin = toScreen(point);
    let best = null;
    for (const axis of AXIS_NAMES) {
      if (axis === currentPointer.hit.axis) continue;
      const derivative = AXES[axis].clone().cross(point);
      const screenDerivative = toScreen(point.clone().addScaledVector(derivative, .045)).sub(origin).multiplyScalar(1 / .045);
      const pixelsPerRadian = screenDerivative.length();
      if (pixelsPerRadian < 12) continue;
      const tangent = screenDerivative.normalize();
      const score = Math.abs(movement.dot(tangent)) / movement.length();
      if (!best || score > best.score) best = { axis, layer: currentPointer.hit.cubie.grid[axis], tangent, pixelsPerRadian: clamp(pixelsPerRadian, 62, 170), score };
    }
    return best;
  }

  function onPointerDown(event) {
    if (!visible) return;
    if (disposed || pointer || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2)) return;
    event.preventDefault();
    canvas.classList.add('scene-pointer-focus');
    canvas.focus({ preventScroll: true });
    const forceOrbit = event.button === 2 || event.altKey;
    const hit = !forceOrbit && !active && !queue.length ? pick(event.clientX, event.clientY) : null;
    freezeView();
    pointerInside = true;
    pointer = {
      id: event.pointerId, mode: hit ? 'face-pending' : 'orbit', hit,
      startX: event.clientX, startY: event.clientY,
      lastX: event.clientX, lastY: event.clientY,
      startYaw: orbitYaw, startPitch: orbitPitch,
      shiftKey: event.shiftKey,
    };
    hoverCubie(hit?.cubie || null);
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Pointer capture is best effort on detached canvases. */ }
    canvas.style.cursor = 'grabbing';
  }

  function onPointerMove(event) {
    if (disposed) return;
    updatePointerPosition(event);
    orbitResumeAt = lastNow + 1900;
    if (!pointer) {
      pointerInside = true;
      if (!active && !queue.length) hoverCubie(pick(event.clientX, event.clientY)?.cubie || null);
      return;
    }
    if (pointer.id !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - pointer.startX, dy = event.clientY - pointer.startY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    if (pointer.mode === 'orbit') {
      orbitYaw = pointer.startYaw + dx * .0065;
      orbitPitch = clamp(pointer.startPitch + dy * .0051, -1.13, 1.13);
      return;
    }
    if (pointer.mode === 'face-pending' && Math.hypot(dx, dy) >= 6) {
      const drag = chooseDragAxis(pointer, dx, dy);
      if (!drag) return;
      pointer.mode = 'face-drag';
      pointer.drag = drag;
      beginLayer({ axis: drag.axis, layer: drag.layer, turns: 0, notation: '', source: 'drag' }, 'drag');
    }
    if (pointer.mode === 'face-drag' && active?.phase === 'drag') {
      const drag = pointer.drag;
      active.targetAngle = clamp((dx * drag.tangent.x + dy * drag.tangent.y) / drag.pixelsPerRadian, -Math.PI * 2, Math.PI * 2);
    }
  }

  function onPointerUp(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    event.preventDefault();
    // Pointerup can contain a final sample the browser did not dispatch as a
    // pointermove (especially on touch). Include it before choosing the snap.
    onPointerMove(event);
    const ending = pointer;
    if (ending.mode === 'face-pending') {
      const face = FACE_DEFS.find(item => item.axis === ending.hit.axis && item.sign === ending.hit.sign);
      if (face) move(face.name + ((event.shiftKey || ending.shiftKey) ? "'" : ''));
    } else if (ending.mode === 'face-drag' && active?.phase === 'drag') {
      snapDrag(Math.round(active.targetAngle / HALF_PI));
    }
    pointer = null;
    orbitResumeAt = lastNow + 1900;
    releaseCapture(ending.id);
    updatePointerPosition(event);
    const rect = canvas.getBoundingClientRect();
    pointerInside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    canvas.style.cursor = 'grab';
  }

  function onPointerCancel(event) {
    if (pointer?.id === event.pointerId) cancelPointer();
  }

  function onKeyDown(event) {
    canvas.classList.remove('scene-pointer-focus');
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toUpperCase();
    if (pointer && event.key !== 'Escape') return;
    orbitResumeAt = lastNow + 1900;
    if (/^[RLUDFB]$/.test(key)) {
      event.preventDefault();
      move(key + (event.shiftKey ? "'" : ''));
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      if (event.key === 'ArrowLeft') orbitYaw -= .18;
      if (event.key === 'ArrowRight') orbitYaw += .18;
      if (event.key === 'ArrowUp') orbitPitch = clamp(orbitPitch - .14, -1.13, 1.13);
      if (event.key === 'ArrowDown') orbitPitch = clamp(orbitPitch + .14, -1.13, 1.13);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelPointer();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      undo();
    } else if (event.key === 'Home') {
      event.preventDefault();
      reset();
    } else if (event.key === ' ') {
      event.preventDefault();
      setAutoRotate(!autoRotate);
    }
  }

  function setFinish(name) {
    const requested = ['Glass', 'Obsidian', 'Neon', 'Classic'].find(item => item.toLowerCase() === String(name).toLowerCase());
    if (!requested || disposed) return false;
    finish = requested;
    const classic = finish === 'Classic', neon = finish === 'Neon', glass = finish === 'Glass';
    scene.environmentIntensity = glass ? .90 : .62;
    renderer.toneMappingExposure = glass ? 1.08 : .98;
    floorMaterial.opacity = glass ? .28 : .20;
    finishTransition = {
      body: new THREE.Color(glass ? 0x16323d : neon ? 0x071218 : 0x080a0d),
      rim: new THREE.Color(glass ? 0x677c83 : neon ? 0x2f7771 : classic ? 0x20272d : 0x20252b),
      rimEmissive: new THREE.Color(neon ? 0x54e5c9 : 0x000000),
      faces: Object.fromEntries(FACE_DEFS.map(face => [face.name, new THREE.Color(glass ? 0x0d2530 : classic ? face.color : neon ? ({ R: 0x14262f, L: 0x21182d, U: 0x122720, D: 0x232617, F: 0x102522, B: 0x172135 })[face.name] : 0x080b0e)])),
      metalness: glass ? .13 : classic ? .16 : .85,
      bodyMetalness: glass ? .11 : .85,
      roughness: glass ? .12 : classic ? .30 : .20,
      transmission: glass ? .26 : .001,
      bodyTransmission: glass ? .34 : .001,
    };
    if (finishButton) {
      const label = finishButton.querySelector('[data-finish-label]');
      if (label) label.textContent = finish;
      else if (finishButton.childElementCount === 0) finishButton.textContent = finish;
      finishButton.setAttribute('aria-label', `Finish: ${finish}. Change finish`);
      finishButton.dataset.finish = finish;
    }
    options.onFinish?.(finish);
    return true;
  }

  function toggleTooth() {
    toothVisible = !toothVisible;
    tooth.group.visible = toothVisible;
    halo.visible = toothVisible;
    mount.visible = toothVisible;
    updateControlState();
    return toothVisible;
  }

  function setAutoRotate(value) {
    autoRotate = Boolean(value);
    autoOrbitBlend = 0;
    orbitResumeAt = lastNow + (autoRotate ? 450 : 0);
    updateControlState();
    return autoRotate;
  }

  function setReducedMotion(value) {
    reducedMotion = Boolean(value);
    autoOrbitBlend = 0;
    return reducedMotion;
  }

  function isSolved() {
    return cubies.every(cubie => (
      cubie.grid.x === cubie.home.x && cubie.grid.y === cubie.home.y && cubie.grid.z === cubie.home.z &&
      Math.abs(cubie.group.quaternion.x) < 1e-6 && Math.abs(cubie.group.quaternion.y) < 1e-6 && Math.abs(cubie.group.quaternion.z) < 1e-6
    ));
  }

  function updateControlState() {
    if (toothButton) {
      toothButton.setAttribute('aria-pressed', String(toothVisible));
      toothButton.classList.toggle('is-active', toothVisible);
      const label = toothButton.querySelector('[data-toggle-label]') || (toothButton.childElementCount === 0 ? toothButton : null);
      const value = `Tooth: ${toothVisible ? 'On' : 'Off'}`;
      if (label && label.textContent !== value) label.textContent = value;
    }
    if (spinButton) {
      spinButton.setAttribute('aria-pressed', String(autoRotate));
      spinButton.classList.toggle('is-active', autoRotate);
      const label = spinButton.querySelector('[data-toggle-label]') || (spinButton.childElementCount === 0 ? spinButton : null);
      const value = `Auto orbit: ${autoRotate ? 'On' : 'Off'}`;
      if (label && label.textContent !== value) label.textContent = value;
    }
    const nothingToUndo = !history.length && !active && !queue.length;
    if (undoButton) undoButton.disabled = nothingToUndo;
    if (solveButton) solveButton.disabled = nothingToUndo;
  }

  function updateStatus(now) {
    let text;
    if (active?.phase === 'drag') text = 'Drag to turn · release to snap';
    else if (active?.source === 'scramble') text = `Scrambling · ${queue.filter(item => item.source === 'scramble').length + 1} turns left`;
    else if (active?.source === 'solve' || active?.source === 'reset') text = `Restoring · ${history.length} ${history.length === 1 ? 'move' : 'moves'} left`;
    else if (active) text = active.turns ? `Turning ${active.notation || notationFor(active.axis, active.layer, active.turns)}` : 'Settling into place';
    else if (pointer?.mode === 'orbit') text = 'Orbiting · move freely';
    else if (feedbackUntil > now) text = feedback;
    else if (!history.length && isSolved()) text = pointerInside ? 'Move with your mouse' : 'A different perspective';
    else text = 'Keep exploring';
    if (text !== lastStatus) {
      lastStatus = text;
      if (statusLabel) statusLabel.textContent = text;
      options.onStatus?.(text);
    }
    if (history.length !== lastMoveCount) {
      lastMoveCount = history.length;
      if (moveCountLabel) moveCountLabel.textContent = String(history.length).padStart(2, '0');
    }
    updateControlState();
  }

  function update(now, deltaTime = 1 / 60) {
    if (disposed || !visible) return;
    lastNow = now;
    const dt = clamp(Number.isFinite(deltaTime) ? deltaTime : 1 / 60, 0, .05);
    const time = now / 1000;
    pumpQueue();
    if (active) {
      if (active.phase === 'drag') {
        active.angle += (active.targetAngle - active.angle) * (1 - Math.exp(-34 * dt));
      } else {
        // The host supplies a scene clock that stops while the scene is hidden.
        // Snap duration follows that clock, so a slower GPU does not stretch a
        // quarter turn into seconds by counting capped simulation steps.
        active.elapsed = Math.max(0, (now - active.startTime) / 1000);
        const progress = Math.min(1, active.elapsed / active.duration);
        active.angle = active.startAngle + (active.targetAngle - active.startAngle) * ease(progress);
      }
      active.pivot.quaternion.setFromAxisAngle(AXES[active.axis], active.angle);
      if (active.phase !== 'drag' && active.elapsed >= active.duration) finishLayer();
    }

    if (pointer?.mode !== 'face-pending' && pointer?.mode !== 'face-drag') {
      const autoAllowed = autoRotate && !pointer && !pointerInside && !active && !queue.length && !reducedMotion && now >= orbitResumeAt;
      autoOrbitBlend += ((autoAllowed ? 1 : 0) - autoOrbitBlend) * (1 - Math.exp(-2.5 * dt));
      if (autoAllowed) orbitYaw += dt * .10 * autoOrbitBlend;
      const hoverAllowed = pointerInside && !pointer && !reducedMotion;
      viewEuler.set(orbitPitch + (hoverAllowed ? hoverY * .078 : 0), orbitYaw + (hoverAllowed ? hoverX * .148 : 0), 0, 'YXZ');
      viewTarget.setFromEuler(viewEuler);
      viewGroup.quaternion.slerp(viewTarget, 1 - Math.exp(-(pointer ? 19 : 6.8) * dt));
    }

    const hoverTarget = hovered ? pointer?.mode === 'face-drag' ? .063 : .028 : 0;
    hoverMaterial.opacity += (hoverTarget - hoverMaterial.opacity) * (1 - Math.exp(-18 * dt));
    // The enamel is a rigid sculpture attached to a real cubie. It has no
    // independent bobbing that could disconnect its roots from the plinth.
    tooth.update(time, reducedMotion);
    haloMaterial.opacity = .24;

    if (finishTransition) {
      const lerp = 1 - Math.exp(-8 * dt);
      bodyMaterial.color.lerp(finishTransition.body, lerp);
      bodyMaterial.metalness += (finishTransition.bodyMetalness - bodyMaterial.metalness) * lerp;
      bodyMaterial.transmission += (finishTransition.bodyTransmission - bodyMaterial.transmission) * lerp;
      rimMaterial.color.lerp(finishTransition.rim, lerp);
      rimMaterial.emissive.lerp(finishTransition.rimEmissive, lerp);
      rimMaterial.emissiveIntensity = .46;
      for (const face of FACE_DEFS) {
        const material = panelMaterials[face.name];
        material.color.lerp(finishTransition.faces[face.name], lerp);
        material.metalness += (finishTransition.metalness - material.metalness) * lerp;
        material.roughness += (finishTransition.roughness - material.roughness) * lerp;
        material.transmission += (finishTransition.transmission - material.transmission) * lerp;
      }
    }
    updateStatus(now);
    if (frameGate.canDraw()) {
      renderer.render(scene, camera);
      frameGate.didDraw();
    }
  }

  function getState() {
    const toothProjection = tooth.group.localToWorld(new THREE.Vector3(0, .40, 0)).project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      ready: !disposed,
      sceneTime: lastNow,
      busy: Boolean(active || queue.length || pointer?.mode === 'face-drag'),
      finish,
      autoRotate,
      autoOrbitActive: autoRotate && !pointer && !pointerInside && !active && !queue.length && !reducedMotion && lastNow >= orbitResumeAt,
      autoOrbitBlend,
      orbitResumeAt,
      pointerInside,
      toothVisible,
      solved: !active && isSolved(),
      isSolved: !active && isSolved(),
      moveCount: history.length,
      completedMoves,
      history: history.map(item => item.notation),
      historyDetails: history.map(item => ({ ...item })),
      queue: queue.map(item => ({ kind: item.kind, notation: item.notation || null, source: item.source || null })),
      activeMove: active ? { axis: active.axis, layer: active.layer, turns: active.turns, angle: active.angle, targetAngle: active.targetAngle, phase: active.phase, notation: active.notation || '', source: active.source } : null,
      pointerMode: pointer?.mode || null,
      viewQuaternion: viewGroup.quaternion.toArray(),
      cubies: cubies.map(cubie => ({ id: cubie.id, home: [cubie.home.x, cubie.home.y, cubie.home.z], position: [cubie.grid.x, cubie.grid.y, cubie.grid.z], quaternion: cubie.group.quaternion.toArray() })),
      renderer: { width, height, pixelRatio: renderer.getPixelRatio(), triangles: renderer.info.render.triangles },
      toothTriangles: tooth.triangleCount,
      toothMount: { carrier: toothCarrier.id, parent: tooth.group.parent.name, carrierQuaternion: toothCarrier.group.quaternion.toArray(), localPosition: tooth.group.position.toArray(), scale: toothScale, bounds: tooth.bounds, worldPosition: tooth.group.getWorldPosition(new THREE.Vector3()).toArray(), worldQuaternion: tooth.group.getWorldQuaternion(new THREE.Quaternion()).toArray(), screen: { x: rect.left + (toothProjection.x + 1) * .5 * rect.width, y: rect.top + (1 - toothProjection.y) * .5 * rect.height } },
    };
  }

  function getProjectedCubies() {
    if (disposed) return [];
    scene.updateMatrixWorld(true);
    const rect = canvas.getBoundingClientRect();
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
    return cubies.map(cubie => {
      const center = cubie.group.getWorldPosition(new THREE.Vector3()).project(camera);
      const faces = [];
      for (const face of cubie.faces) {
        const worldPoint = cubie.group.localToWorld(face.direction.clone().multiplyScalar(.498));
        const normal = face.direction.clone().transformDirection(cubie.group.matrixWorld);
        if (normal.dot(cameraPosition.clone().sub(worldPoint)) <= 0) continue;
        projected.copy(worldPoint).project(camera);
        if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) continue;
        raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
        const first = raycaster.intersectObjects(pickTargets, false)[0];
        if (first?.object.userData.cubie !== cubie) continue;
        const toothHit = toothVisible ? raycaster.intersectObjects([tooth.mesh, mount], false)[0] : null;
        if (toothHit && toothHit.distance < first.distance) continue;
        const localNormal = normal.clone().applyQuaternion(cubeRoot.getWorldQuaternion(new THREE.Quaternion()).invert());
        const axis = AXIS_NAMES.reduce((a, b) => Math.abs(localNormal[a]) > Math.abs(localNormal[b]) ? a : b);
        const canvasX = (projected.x + 1) * .5 * rect.width;
        const canvasY = (1 - projected.y) * .5 * rect.height;
        faces.push({ face: face.name, axis, sign: localNormal[axis] >= 0 ? 1 : -1, x: rect.left + canvasX, y: rect.top + canvasY, canvasX, canvasY });
      }
      return { id: cubie.id, position: [cubie.grid.x, cubie.grid.y, cubie.grid.z], x: rect.left + (center.x + 1) * .5 * rect.width, y: rect.top + (1 - center.y) * .5 * rect.height, canvasX: (center.x + 1) * .5 * rect.width, canvasY: (1 - center.y) * .5 * rect.height, visible: faces.length > 0, faces };
    });
  }

  function dispose() {
    if (disposed) return;
    cancelPointer();
    disposed = true;
    for (const remove of listeners) remove();
    queue.length = 0;
    tooth.dispose();
    for (const geometry of [bodyGeometry, rimGeometry, panelGeometry, coreGeometry, haloGeometry, mountGeometry, floorGeometry]) geometry.dispose();
    for (const material of [bodyMaterial, rimMaterial, coreMaterial, hoverMaterial, haloMaterial, mountMaterial, floorMaterial, ...Object.values(panelMaterials)]) material.dispose();
    coast.dispose(); environmentTarget.dispose();
    keyLight.shadow.dispose();
    scene.clear();
    try { frameGate.dispose(); }
    finally { renderer.dispose(); renderer.forceContextLoss(); }
  }

  listen(canvas, 'pointerdown', onPointerDown);
  listen(canvas, 'blur', () => canvas.classList.remove('scene-pointer-focus'));
  listen(canvas, 'pointermove', onPointerMove);
  listen(canvas, 'pointerup', onPointerUp);
  listen(canvas, 'pointercancel', onPointerCancel);
  listen(canvas, 'lostpointercapture', event => { if (pointer?.id === event.pointerId) cancelPointer(); });
  listen(canvas, 'pointerenter', event => { pointerInside = true; orbitResumeAt = lastNow + 1900; updatePointerPosition(event); });
  listen(canvas, 'pointerleave', () => { pointerInside = false; orbitResumeAt = lastNow + 1900; if (!pointer) { hoverX = hoverY = 0; hoverCubie(null); } });
  listen(canvas, 'contextmenu', event => event.preventDefault());
  listen(canvas, 'keydown', onKeyDown);
  listen(platform.windowEvents, 'blur', cancelPointer);
  // A host that supplies reducedMotion owns preference updates (including personal settings).
  if (options.reducedMotion === undefined) listen(motionQuery, 'change', event => setReducedMotion(event.matches));
  if (options.bindControls !== false && controls) {
    for (const button of controls.querySelectorAll('.rubik-move-btn[data-rubik-move]')) listen(button, 'click', event => {
      const parsed = parseMove(button.dataset.rubikMove);
      if (parsed) move(event.shiftKey ? inverseMove(parsed).notation : parsed.notation);
    });
    listen(byId('rubik-scramble-btn'), 'click', () => scramble());
    listen(byId('rubik-reset-btn'), 'click', reset);
    listen(undoButton, 'click', undo);
    listen(solveButton, 'click', solve);
    listen(toothButton, 'click', toggleTooth);
    listen(spinButton, 'click', () => setAutoRotate(!autoRotate));
    listen(finishButton, 'click', () => setFinish(['Glass', 'Obsidian', 'Neon', 'Classic'][(['Glass', 'Obsidian', 'Neon', 'Classic'].indexOf(finish) + 1) % 4]));
  }
  setFinish(options.finish || 'Glass');
  resize();
  updateControlState();
  updateStatus(0);

  return { update, resize, dispose, cancelPointer, scramble, solve, reset, undo, move, setFinish, toggleTooth, setAutoRotate, setReducedMotion, getState, getProjectedCubies,
    setVisible(value) { visible = Boolean(value); if (!visible) { cancelPointer(); pointerInside = false; hoverX = hoverY = 0; } },
  };
}

export default initRubik;
