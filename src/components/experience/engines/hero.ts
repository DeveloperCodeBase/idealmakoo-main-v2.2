import * as THREE from 'three';
import { createTooth } from './tooth';
import { createLiquidWater } from './liquid-water';
import { createCoastalBackdrop, createCoastalEnvironment } from './environment';
import { balanceReady, beginBalanceDisturbance, createAssistedReturn, createBalanceSchedule, equilibriumHeight, fixedStepBudget, makeFluidBody, PHYSICS_STEP, postponeBalance, resolveCrownContact, sampleAssistedReturn, stepBalanceDisturbance, stepFluidBody, type AssistedReturnPlan, type BalanceDisturbance, type FluidBody } from './dynamics';
import { smootherstep } from './ocean-math';
import type { ToothMorphology } from './anatomy';
import type { MolarMeshData } from './molar-mesh';
import { heroCameraFraming, sceneDirection, type HeroFramingOptions, type SceneEnvelope } from './framing';
import { compileSceneVariants } from './scene-preparation';
import type {HeroAgentElement, HeroPlatform, HeroSurface} from './hero-platform';

export interface HeroOptions extends HeroFramingOptions {
  theme?: 'light' | 'dark'; reducedMotion?: boolean; quality?: 'standard' | 'high';
  autoDemonstrate?: boolean; agentElement?: HeroAgentElement | null;
  geometryData?: readonly MolarMeshData[];
  platform?: HeroPlatform;
}
type ToothModel = ReturnType<typeof createTooth>;
interface HeroBody extends FluidBody {
  id: number; tooth: ToothModel; group: THREE.Group; mesh: THREE.Mesh; scale: number;
  home: THREE.Vector3; homeQuaternion: THREE.Quaternion; gripLocal: THREE.Vector3;
  owner: 'physics' | 'user' | 'agent'; needsReturn: boolean; releasedAt: number; returnKind: 'return' | 'balance';
  impactCount: number; hover: number; neutral: THREE.Color;
}
interface ToothDrag {
  id: number; body: HeroBody; plane: THREE.Plane; localGrab: THREE.Vector3; point: THREE.Vector3;
  startQuaternion: THREE.Quaternion; lastPosition: THREE.Vector3; lastEventTime: number;
  lastX: number; lastY: number; tiltX: number; tiltZ: number; velocity: THREE.Vector3;
}
interface OrbitDrag { id: number; x: number; y: number; yaw: number; pitch: number }
interface AgentState {
  phase: 'idle' | 'approach' | 'grip' | 'lift' | 'carry' | 'lower' | 'release' | 'depart';
  body: HeroBody | null; position: THREE.Vector3; from: THREE.Vector3; start: number;
  duration: number; alpha: number; plan: AssistedReturnPlan | null;
}
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const smooth = (a: number, b: number, speed: number, dt: number) => a + (b - a) * (1 - Math.exp(-speed * dt));
const UP = V(0, 1, 0);

/**
 * The supplied tooth/water interaction rebuilt with one fluid coordinate system.
 * A grabbed object, a released rigid body and an assisted return share the same
 * pose references. No phase change replaces the pose with a preset transform.
 */
export function initHero(canvas: HeroSurface, options: HeroOptions = {}) {
  let disposed = false, visible = true, reduced = Boolean(options.reducedMotion), light = options.theme === 'light';
  let preparationTask: Promise<void> | null = null;
  let elapsed = 0, physicsTime = 0, accumulator = 0, bounds = canvas.getBoundingClientRect();
  let width = 1, height = 1, radius = 8.5, yaw = -.12, pitch = .30, targetYaw = -.12, targetPitch = .30;
  let framingOptions: HeroFramingOptions = { composition: options.composition || 'centered', locale: options.locale, direction: options.direction || sceneDirection(options.locale), region: options.region };
  let framingReady = false, projectionDirty = true, targetRadius = radius;
  const frameCenter = { x: .5, y: .5 }, targetFrameCenter = { x: .5, y: .5 };
  let orbit: OrbitDrag | null = null, drag: ToothDrag | null = null, hovered: HeroBody | null = null;
  let selected = 0, orbitResumeAt = 2.8, lastStrokeAt = -10, aiEnabled = true, lastInteractionAt = -10;
  const balanceSchedule = createBalanceSchedule();
  let balanceEpisode: BalanceDisturbance | null = null;
  const autonomous = options.autoDemonstrate !== false;
  const compact = canvas.getBoundingClientRect().width < 720;
  const quality = options.quality || (compact ? 'standard' : 'high');
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  const oceanPlane = new THREE.Plane(UP, 0), lastStroke = V();
  const agentElement = options.agentElement || null;
  const events: { type: string; time: number; body: number | null; [key: string]: unknown }[] = [];
  const listeners: (() => void)[] = [];
  // The scene clears to alpha 1 and paints an opaque sky. In Three r180 this
  // constructor flag controls renderer clear semantics; its internally created
  // WebGL context still has alpha:true. It does not disable canvas compositing.
  // The worker adapter delegates context, buffer size and context events to its
  // real OffscreenCanvas; Three uses the same surface operations in both cases.
  const renderer = new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, alpha: false, antialias: true, powerPreference: 'high-performance' });
  renderer.debug.onShaderError = () => { throw new Error('The dental scene shader could not be initialized.'); };
  renderer.setClearColor(0x102229, 1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = light ? .98 : .91;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, .12, 190);
  const lookAt = V(0, .95, 0);
  const backdrop = createCoastalBackdrop(scene, light ? 'light' : 'dark');
  const hemisphere = new THREE.HemisphereLight(0xdfe9ec, 0x29312b, light ? .48 : .32); scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xfff3df, light ? 1.85 : 2.05);
  key.position.set(-4.6, 7.2, 4.5); key.castShadow = true;
  key.shadow.mapSize.set(compact ? 1024 : 1536, compact ? 1024 : 1536); Object.assign(key.shadow.camera, { left: -7.2, right: 7.2, top: 7.2, bottom: -7.2, near: .2, far: 24 });
  key.shadow.bias = -.000045; key.shadow.normalBias = .018; key.shadow.radius = 2.8; scene.add(key);
  const fill = new THREE.DirectionalLight(0xd3e2e7, light ? .34 : .38); fill.position.set(5, 3, 3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xc4d5cf, light ? .46 : .62); rim.position.set(2, 3, -5); scene.add(rim);
  const accent = new THREE.Color(0x9bb8b1), targetAccent = accent.clone();
  const water = createLiquidWater(renderer, scene, { resolution: compact ? 128 : 176 });
  water.setTheme(light ? 'light' : 'dark'); water.setReducedMotion(reduced);
  const environment = createCoastalEnvironment(renderer, (texture) => {
    if (disposed) return;
    scene.environment = texture;
    water.setSkyTexture(environment.sourceTexture);
    backdrop.setSkyTexture(environment.sourceTexture);
    water.setSunDirection(environment.sunDirection);
    key.position.copy(environment.sunDirection).multiplyScalar(12);
    fill.position.set(-4.5, 3.3, 4.5);
  });
  scene.environment = environment.texture; scene.environmentIntensity = light ? .78 : .61;

  const bodies: HeroBody[] = [0, 1].map((id) => {
    const morphology: ToothMorphology = id ? 'mandibular' : 'maxillary';
    const tooth = createTooth({ quality, morphology, geometryData: options.geometryData?.find(item => item.morphology === morphology), animate: false, material: {
      color: id ? 0xfffdf7 : 0xfffbf1, roughness: id ? .205 : .218, transmission: .13,
      clearcoat: .84, clearcoatRoughness: .105, envMapIntensity: .96,
    } });
    const group = tooth.group as THREE.Group, scale = id ? 1.03 : 1.06;
    group.scale.setScalar(scale); group.name = id ? 'Two-root mandibular enamel molar' : 'Three-root maxillary enamel molar';
    const homeQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(id ? -.055 : .10, id ? .42 : -.40, id ? .07 : -.10));
    group.quaternion.copy(homeQuaternion);
    const fluid = makeFluidBody(group.position, group.quaternion, morphology, scale);
    const home = V(id ? 1.40 : -1.42, equilibriumHeight(fluid), id ? -.18 : .18);
    group.position.copy(home); if (!reduced) group.position.y += id ? .065 : .09;
    const body: HeroBody = Object.assign(fluid, {
      id, tooth, group, mesh: tooth.mesh, scale, home, homeQuaternion, gripLocal: V(id ? -.34 : .34, .57, .50),
      owner: 'physics' as const, needsReturn: false, releasedAt: -10, returnKind: 'return' as const, impactCount: 0, hover: 0,
      neutral: (tooth.mesh.material as THREE.MeshPhysicalMaterial).color.clone(),
    });
    body.mesh.userData.body = body; scene.add(group); return body;
  });
  if (reduced) for (const body of bodies) body.settledFor = 1;
  // Measure the actual neutral enamel surface once. Roots beneath opaque open
  // water do not shrink the visible pair; reserve air above it for the AI hand.
  const framingEnvelope: SceneEnvelope = { radial: 0, minY: -.35 - lookAt.y, maxY: 0 };
  const envelopePoint = V();
  for (const body of bodies) {
    body.group.updateWorldMatrix(true, true);
    const positions = body.mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      envelopePoint.fromBufferAttribute(positions, i).applyMatrix4(body.mesh.matrixWorld);
      if (envelopePoint.y < -.35) continue;
      envelopePoint.sub(lookAt);
      framingEnvelope.radial = Math.max(framingEnvelope.radial, Math.hypot(envelopePoint.x, envelopePoint.z));
      framingEnvelope.maxY = Math.max(framingEnvelope.maxY, envelopePoint.y);
    }
  }
  framingEnvelope.radial += .12; framingEnvelope.maxY += .58;
  const agent: AgentState = { phase: 'idle', body: null, position: V(-3.4, 3.5, 1.8), from: V(), start: 0, duration: 0, alpha: 0, plan: null };
  const worldGrip = (body: HeroBody) => body.gripLocal.clone().multiplyScalar(body.scale).applyQuaternion(body.quaternion).add(body.position);
  const record = (type: string, body: HeroBody | null, details: Record<string, unknown> = {}) => {
    events.push({ type, time: elapsed, body: body?.id ?? null, ...details }); if (events.length > 80) events.shift();
  };
  function listen(target: EventTarget, type: string, listener: EventListener, settings?: AddEventListenerOptions) {
    target.addEventListener(type, listener, settings); listeners.push(() => target.removeEventListener(type, listener, settings));
  }
  function updateRay(clientX: number, clientY: number) {
    bounds = canvas.getBoundingClientRect();
    pointer.set((clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1, 1 - (clientY - bounds.top) / Math.max(1, bounds.height) * 2);
    raycaster.setFromCamera(pointer, camera);
  }
  function pick(event: PointerEvent) {
    updateRay(event.clientX, event.clientY); scene.updateMatrixWorld(true);
    return raycaster.intersectObjects(bodies.map(body => body.mesh), false)[0] || null;
  }
  function waterStroke(event: PointerEvent, strength = .32) {
    if (elapsed - lastStrokeAt < .08) return;
    updateRay(event.clientX, event.clientY);
    const point = raycaster.ray.intersectPlane(oceanPlane, V());
    if (!point || Math.abs(point.x) > 11 || Math.abs(point.z) > 10 || point.distanceToSquared(lastStroke) < .018) return;
    water.ripple(point.x, point.z, strength, .22, 'pointer'); lastStroke.copy(point); lastStrokeAt = elapsed;
  }
  function depart() {
    if (agent.phase === 'idle') return;
    agent.phase = 'depart'; agent.start = elapsed; agent.duration = reduced ? .55 : .85;
    agent.from.copy(agent.position); agent.body = null; agent.plan = null;
  }
  function interruptAgent(body?: HeroBody) {
    if (agent.body && (!body || agent.body === body)) {
      const current = agent.body;
      if (current.owner === 'agent') { current.owner = 'physics'; current.velocity.set(0, 0, 0); current.angularVelocity.set(0, 0, 0); }
      current.needsReturn = false;
      record('agent-interrupted', current); depart();
    }
    if (body) body.needsReturn = false;
    else for (const pending of bodies) pending.needsReturn = false;
  }
  function scheduleReturn(body: HeroBody, immediate = false, kind: 'return' | 'balance' = 'return') {
    body.needsReturn = true; body.releasedAt = immediate ? elapsed - 4 : elapsed; body.returnKind = kind;
  }
  function noteInteraction() {
    lastInteractionAt = elapsed; postponeBalance(balanceSchedule, elapsed);
    if (balanceEpisode) { record('wave-tip-interrupted', bodies[balanceEpisode.bodyId]); balanceEpisode = null; }
  }
  function updateBalance() {
    if (balanceEpisode && elapsed - balanceEpisode.startedAt >= balanceEpisode.duration) {
      record('wave-tip-complete', bodies[balanceEpisode.bodyId]); balanceEpisode = null;
    }
    const available = bodies.every(body => body.owner === 'physics' && !body.needsReturn && body.velocity.length() < .42 && body.angularVelocity.length() < .48);
    if (!balanceEpisode && balanceReady(balanceSchedule, elapsed, {
      visible, reducedMotion: reduced, enabled: autonomous && aiEnabled,
      interacting: Boolean(drag || orbit), assisting: agent.phase !== 'idle', available, lastInteractionAt,
    })) {
      const body = bodies[balanceSchedule.cycle % bodies.length];
      balanceEpisode = beginBalanceDisturbance(balanceSchedule, body.id, body.position, elapsed);
      water.ripple(balanceEpisode.waveOrigin.x, balanceEpisode.waveOrigin.z, 2.5, .44, 'passing-wave');
      scheduleReturn(body, false, 'balance');
      record('wave-tip-begin', body, { position: body.position.toArray(), quaternion: body.quaternion.toArray() });
    }
  }
  function release(body: HeroBody, velocity: THREE.Vector3, source = 'pointer') {
    body.owner = 'physics'; body.velocity.copy(velocity); body.settledFor = 0;
    scheduleReturn(body); record('release', body, { source, position: body.position.toArray(), velocity: body.velocity.toArray() });
  }
  function capturePointer(id: number) { try { canvas.setPointerCapture(id); } catch { /* Pointer may have ended before capture. */ } }
  function releaseCapture(id: number) { try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch { /* Unmounted or cancelled pointer. */ } }
  function beginPointer(event: PointerEvent) {
    if (disposed || !visible || !event.isPrimary || drag || orbit || (event.button !== 0 && event.button !== 2)) return;
    event.preventDefault(); canvas.focus({ preventScroll: true }); orbitResumeAt = elapsed + 3; noteInteraction();
    const hit = event.button === 0 ? pick(event) : null;
    if (!hit) {
      orbit = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: targetYaw, pitch: targetPitch };
      capturePointer(event.pointerId); canvas.style.cursor = 'grabbing'; waterStroke(event, 1.1); return;
    }
    const body = hit.object.userData.body as HeroBody;
    interruptAgent(body); body.owner = 'user'; body.velocity.set(0, 0, 0); body.angularVelocity.set(0, 0, 0); selected = body.id;
    drag = {
      id: event.pointerId, body, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(V()), hit.point),
      localGrab: body.group.worldToLocal(hit.point.clone()), point: hit.point.clone(), startQuaternion: body.quaternion.clone(),
      lastPosition: body.position.clone(), lastEventTime: event.timeStamp, lastX: event.clientX, lastY: event.clientY,
      tiltX: 0, tiltZ: 0, velocity: V(),
    };
    capturePointer(event.pointerId); canvas.style.cursor = 'grabbing'; record('grab', body, { position: body.position.toArray() });
  }
  function applyDrag(current: ToothDrag, dt: number) {
    const body = current.body;
    if (dt > 0) {
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(current.tiltX, 0, current.tiltZ));
      body.quaternion.slerp(current.startQuaternion.clone().multiply(tilt), 1 - Math.exp(-16 * dt)).normalize();
    }
    const offset = current.localGrab.clone().multiplyScalar(body.scale).applyQuaternion(body.quaternion);
    body.position.copy(current.point).sub(offset);
    // The full canvas is the drag field; only the grab point is kept inside it.
    // Underwater movement stays possible and is resolved by buoyancy on release.
    body.position.y = Math.max(-.28, body.position.y);
  }
  function movePointer(event: PointerEvent) {
    if (!event.isPrimary || !visible) return;
    if (orbit) {
      if (event.pointerId !== orbit.id) return;
      event.preventDefault(); targetYaw = orbit.yaw - (event.clientX - orbit.x) * .0048;
      targetPitch = clamp(orbit.pitch + (event.clientY - orbit.y) * .003, .12, .78);
      waterStroke(event, .25); return;
    }
    if (drag) {
      if (event.pointerId !== drag.id) return;
      event.preventDefault(); updateRay(event.clientX, event.clientY);
      pointer.x = clamp(pointer.x, -.94, .94); pointer.y = clamp(pointer.y, -.82, .87); raycaster.setFromCamera(pointer, camera);
      const point = raycaster.ray.intersectPlane(drag.plane, V()); if (point) drag.point.copy(point);
      const eventDelta = clamp((event.timeStamp - drag.lastEventTime) / 1000, .008, .12);
      drag.tiltX = clamp(drag.tiltX + (event.clientY - drag.lastY) * .0035, -.48, .48);
      drag.tiltZ = clamp(drag.tiltZ - (event.clientX - drag.lastX) * .004, -.56, .56);
      applyDrag(drag, eventDelta);
      const velocity = drag.body.position.clone().sub(drag.lastPosition).multiplyScalar(1 / eventDelta);
      if (velocity.length() > 7) velocity.setLength(7);
      drag.velocity.lerp(velocity, .38); drag.lastPosition.copy(drag.body.position);
      drag.lastEventTime = event.timeStamp; drag.lastX = event.clientX; drag.lastY = event.clientY; return;
    }
    const hit = pick(event); hovered = hit ? hit.object.userData.body as HeroBody : null;
    canvas.style.cursor = hovered ? 'grab' : 'crosshair'; waterStroke(event);
  }
  function endPointer(event?: PointerEvent, cancelled = false) {
    if (orbit && (!event || event.pointerId === orbit.id)) {
      const id = orbit.id; orbit = null; noteInteraction(); orbitResumeAt = elapsed + 2.5; releaseCapture(id); canvas.style.cursor = 'grab'; return;
    }
    if (!drag || (event && drag.id !== event.pointerId)) return;
    const current = drag; drag = null; noteInteraction();
    const idle = Math.max(0, ((event?.timeStamp ?? current.lastEventTime) - current.lastEventTime) / 1000);
    const velocity = cancelled ? V() : current.velocity.clone().multiplyScalar(.72 * Math.exp(-idle * 12));
    velocity.y = clamp(velocity.y, -4.5, 3.8);
    current.body.angularVelocity.set(cancelled ? 0 : current.tiltX * 1.3, cancelled ? 0 : velocity.x * .08, cancelled ? 0 : current.tiltZ * 1.3);
    release(current.body, velocity, cancelled ? 'cancel' : 'pointer'); releaseCapture(current.id);
    orbitResumeAt = elapsed + 2.6; canvas.style.cursor = 'grab';
  }
  function onKey(event: KeyboardEvent) {
    const body = bodies[selected];
    if (['1', '2', 'Escape', 'Home', 'Enter', 'r', 'R', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) noteInteraction();
    if (event.key === '1' || event.key === '2') { selected = Number(event.key) - 1; event.preventDefault(); return; }
    if (event.key === 'Escape') { endPointer(undefined, true); interruptAgent(); return; }
    if (event.key.toLowerCase() === 'r' || event.key === 'Home' || event.key === 'Enter') {
      event.preventDefault(); endPointer(undefined, true); for (const item of bodies) scheduleReturn(item, true); return;
    }
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault(); orbitResumeAt = elapsed + 3;
    if (event.shiftKey) {
      targetYaw += event.key === 'ArrowLeft' ? .12 : event.key === 'ArrowRight' ? -.12 : 0;
      targetPitch = clamp(targetPitch + (event.key === 'ArrowUp' ? .065 : event.key === 'ArrowDown' ? -.065 : 0), .12, .78); return;
    }
    endPointer(undefined, true); interruptAgent(body); body.owner = 'physics';
    body.velocity.x += event.key === 'ArrowLeft' ? -.9 : event.key === 'ArrowRight' ? .9 : 0;
    body.velocity.y = event.key === 'ArrowUp' ? 3.9 : event.key === 'ArrowDown' ? -1.9 : body.velocity.y;
    body.angularVelocity.z += event.key === 'ArrowLeft' ? .20 : event.key === 'ArrowRight' ? -.20 : 0;
    scheduleReturn(body);
  }
  function beginAgent(body: HeroBody) {
    // Pick the visible crown surface for the hand, even after camera orbit or a
    // tumble. The hand then remains attached to that local surface point.
    scene.updateMatrixWorld(true);
    const crown = V(0, .60, 0).multiplyScalar(body.scale).applyQuaternion(body.quaternion).add(body.position);
    const gripRay = new THREE.Raycaster(camera.position, crown.clone().sub(camera.position).normalize());
    const hit = gripRay.intersectObject(body.mesh, false)[0];
    if (hit) body.gripLocal.copy(body.group.worldToLocal(hit.point.clone()));
    agent.body = body; agent.phase = 'approach'; agent.start = elapsed;
    agent.duration = body.returnKind === 'balance' ? .78 : reduced ? .85 : 1.1;
    agent.from.copy(agent.position); agent.plan = null;
    record('agent-approach', body);
  }
  function updateAgent(dt: number) {
    if (!aiEnabled && agent.phase !== 'idle' && agent.phase !== 'depart') interruptAgent();
    if (agent.phase === 'idle' && aiEnabled && !drag && !orbit) {
      const body = bodies.find(item => item.needsReturn && item.owner === 'physics' && elapsed - item.releasedAt > (item.returnKind === 'balance' ? 1.30 : 2.0) && (item.returnKind === 'balance' || item.settledFor > .35 || elapsed - item.releasedAt > 3.6));
      if (body) beginAgent(body);
    }
    const active = agent.phase !== 'idle' && agent.phase !== 'depart';
    agent.alpha = smooth(agent.alpha, active ? 1 : 0, agent.phase === 'depart' ? 4 : 8, dt);
    const body = agent.body;
    if (agent.phase === 'approach' && body) {
      // The tooth keeps floating while the pointer approaches its current grip.
      const s = smootherstep((elapsed - agent.start) / agent.duration);
      agent.position.copy(agent.from).lerp(worldGrip(body), s);
      if (s >= 1) {
        body.owner = 'agent'; body.velocity.set(0, 0, 0); body.angularVelocity.set(0, 0, 0);
        agent.position.copy(worldGrip(body)); agent.phase = 'grip'; agent.start = elapsed;
        record('agent-grip', body, { position: body.position.toArray() });
      }
    } else if (agent.phase === 'grip' && body) {
      agent.position.copy(worldGrip(body));
      if (elapsed - agent.start > .20) {
        const destination = body.home.clone(); destination.y += water.sample(destination.x, destination.z, elapsed).height;
        agent.plan = createAssistedReturn(body.position, destination, body.quaternion, body.homeQuaternion, reduced, body.returnKind);
        agent.phase = 'lift'; agent.start = elapsed; agent.duration = body.returnKind === 'balance' ? 3.8 : reduced ? 3.5 : 4.35;
      }
    } else if (['lift', 'carry', 'lower'].includes(agent.phase) && body && agent.plan) {
      const progress = clamp((elapsed - agent.start) / agent.duration, 0, 1), pose = sampleAssistedReturn(agent.plan, progress);
      body.position.copy(pose.position); body.quaternion.copy(pose.quaternion); agent.phase = pose.phase; agent.position.copy(worldGrip(body));
      if (progress >= 1) { agent.phase = 'release'; agent.start = elapsed; record('agent-lowered', body, { position: body.position.toArray() }); }
    } else if (agent.phase === 'release' && body) {
      agent.position.copy(worldGrip(body));
      if (elapsed - agent.start > .18) {
        body.owner = 'physics'; body.velocity.set(0, 0, 0); body.angularVelocity.set(0, 0, 0); body.needsReturn = false; body.settledFor = 0;
        postponeBalance(balanceSchedule, elapsed);
        record('agent-release', body, { position: body.position.toArray() }); depart();
      }
    } else if (agent.phase === 'depart') {
      const s = smootherstep((elapsed - agent.start) / agent.duration);
      agent.position.copy(agent.from).add(V((agent.from.x > 0 ? .65 : -.65) * s, .65 * s, .35 * s));
      if (s >= 1 && agent.alpha < .025) { agent.phase = 'idle'; agent.alpha = 0; }
    }
    if (agentElement) {
      const point = agent.position.clone().project(camera);
      const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
      const onScreen = point.z > -1 && point.z < 1 && x > -80 && x < width + 80 && y > -40 && y < height + 40;
      agentElement.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
      agentElement.style.opacity = String(onScreen ? agent.alpha : 0);
      agentElement.dataset.mode = ['grip', 'lift', 'carry', 'lower'].includes(agent.phase) ? 'hand' : 'arrow';
      agentElement.dataset.phase = agent.phase;
    }
  }
  function cameraUpdate(dt: number) {
    if (!reduced && !drag && !orbit && elapsed > orbitResumeAt && agent.phase === 'idle') targetYaw += dt * .048;
    // Orbit continues from the released angle; there is no snap to a preset view.
    yaw = smooth(yaw, targetYaw, 7.5, dt); pitch = smooth(pitch, targetPitch, 7.5, dt);
    radius = smooth(radius, targetRadius, 7.5, dt);
    const nextX = smooth(frameCenter.x, targetFrameCenter.x, 7.5, dt), nextY = smooth(frameCenter.y, targetFrameCenter.y, 7.5, dt);
    if (Math.abs(nextX - frameCenter.x) + Math.abs(nextY - frameCenter.y) > 1e-8) projectionDirty = true;
    frameCenter.x = nextX; frameCenter.y = nextY;
    if (projectionDirty) {
      camera.aspect = width / height;
      if (framingOptions.composition === 'landing') {
        // setViewOffset pans the frustum, not the physical orbit target. Its
        // negative X/Y offsets place the pair right/down in the full canvas.
        camera.setViewOffset(width, height, (.5 - frameCenter.x) * width, (.5 - frameCenter.y) * height, width, height);
      } else camera.clearViewOffset();
      projectionDirty = false;
    }
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * radius, lookAt.y + Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius);
    camera.lookAt(lookAt); camera.updateMatrixWorld(true);
  }
  function refreshFraming() {
    const frame = heroCameraFraming(width, height, framingOptions, framingEnvelope);
    targetRadius = frame.radius; targetFrameCenter.x = frame.centerX; targetFrameCenter.y = frame.centerY;
    if (!framingReady || reduced || !visible || framingOptions.composition !== 'landing') {
      radius = targetRadius; Object.assign(frameCenter, targetFrameCenter);
    }
    framingReady = true; projectionDirty = true;
  }
  function setFraming(value: HeroFramingOptions) {
    if (disposed) return;
    framingOptions = { ...value, composition: value.composition || 'centered', direction: value.direction || sceneDirection(value.locale) };
    refreshFraming(); cameraUpdate(0);
  }
  function resize() {
    if (disposed) return;
    bounds = canvas.getBoundingClientRect(); width = Math.max(1, Math.round(bounds.width)); height = Math.max(1, Math.round(bounds.height));
    const pixelBudget = framingOptions.composition === 'landing' ? Math.sqrt(3_000_000 / (width * height)) : Infinity;
    renderer.setPixelRatio(Math.min((options.platform ? options.platform.pixelRatio() : window.devicePixelRatio) || 1, width < 680 ? 1.5 : 1.65, pixelBudget)); renderer.setSize(width, height, false);
    refreshFraming(); water.resize(width, height);
    // A layout measurement must not advance auto-orbit or snap a user's angle.
    cameraUpdate(0); record('resize', null, { width, height });
  }
  function update(_time: number, delta: number) {
    if (disposed || !visible) return;
    const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, .15); elapsed += dt;
    cameraUpdate(dt); backdrop.update(camera, dt); if (drag) applyDrag(drag, dt);
    updateBalance(); water.update(elapsed, dt);
    const budget = fixedStepBudget(accumulator, dt); accumulator = budget.remainder;
    for (let step = 0; step < budget.steps; step++) {
      physicsTime += PHYSICS_STEP;
      for (const body of bodies) {
        if (body.owner !== 'physics') continue;
        // Reduced motion freezes a settled decorative scene, but explicit user
        // releases retain gravity and fluid response until the interaction ends.
        if (reduced && !body.needsReturn && body.settledFor > .35) continue;
        if (balanceEpisode?.bodyId === body.id) stepBalanceDisturbance(body, balanceEpisode, physicsTime, PHYSICS_STEP);
        const impact = stepFluidBody(body, PHYSICS_STEP, physicsTime, water.sample);
        if (impact) { body.impactCount++; water.ripple(impact.x, impact.z, clamp(impact.speed * .36, .6, 3.1), .35, 'impact'); record('water-impact', body, { speed: impact.speed }); }
        // Gentle horizontal drag bounds keep released sculptures in the stage.
        for (const axis of ['x', 'z'] as const) {
          if (Math.abs(body.position[axis]) > 5.3) body.velocity[axis] -= Math.sign(body.position[axis]) * (Math.abs(body.position[axis]) - 5.3) * 8 * PHYSICS_STEP;
        }
        const projection = body.position.clone().add(V(0, .30, 0)).project(camera);
        if (Math.abs(projection.x) > .78) {
          const right = V(1, 0, 0).applyQuaternion(camera.quaternion);
          body.velocity.addScaledVector(right, -(projection.x - Math.sign(projection.x) * .78) * radius * 2.2 * PHYSICS_STEP);
        }
      }
      if (bodies.every(body => body.owner === 'physics')) resolveCrownContact(bodies[0], bodies[1], bodies[0].scale, bodies[1].scale);
    }
    updateAgent(dt); accent.lerp(targetAccent, 1 - Math.exp(-3 * dt));
    for (const body of bodies) {
      body.hover = smooth(body.hover, hovered === body || body.owner === 'user' ? 1 : 0, 9, dt);
      const material = body.mesh.material as THREE.MeshPhysicalMaterial;
      material.emissive.copy(accent); material.emissiveIntensity = body.hover * (light ? .010 : .018);
    }
    renderer.render(scene, camera);
  }
  function setTheme(value: string) {
    light = value === 'light'; renderer.toneMappingExposure = light ? .98 : .91; scene.environmentIntensity = light ? .78 : .61;
    hemisphere.intensity = light ? .48 : .32; key.intensity = light ? 1.85 : 2.05; fill.intensity = light ? .34 : .38; rim.intensity = light ? .46 : .62;
    water.setTheme(value); backdrop.setTheme(value);
  }
  function setVisible(value: boolean) {
    if (visible === value) return;
    visible = value; accumulator = 0;
    if (!visible) { endPointer(undefined, true); if (agentElement) agentElement.style.opacity = '0'; }
  }
  function dispose() {
    if (disposed) return;
    endPointer(undefined, true); disposed = true; observer.disconnect(); for (const remove of listeners) remove();
    if (agentElement) { agentElement.style.opacity = '0'; agentElement.dataset.phase = 'idle'; }
    const releaseGpu = () => {
      for (const body of bodies) { scene.remove(body.group); body.tooth.dispose(); }
      water.dispose(); backdrop.dispose(); environment.dispose(); key.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss();
    };
    // compileAsync polls material properties until completion. Stop interaction
    // immediately, then release those properties after the pending poll settles.
    if (preparationTask) void preparationTask.then(releaseGpu, releaseGpu);
    else releaseGpu();
  }
  listen(canvas, 'pointerdown', beginPointer as EventListener);
  listen(canvas, 'pointermove', movePointer as EventListener);
  listen(canvas, 'pointerup', ((event: PointerEvent) => endPointer(event)) as EventListener);
  listen(canvas, 'pointercancel', ((event: PointerEvent) => endPointer(event, true)) as EventListener);
  listen(canvas, 'lostpointercapture', ((event: PointerEvent) => endPointer(event, true)) as EventListener);
  listen(canvas, 'pointerleave', (() => { if (!drag && !orbit) { hovered = null; canvas.style.cursor = 'grab'; } }) as EventListener);
  listen(canvas, 'contextmenu', ((event: Event) => event.preventDefault()) as EventListener);
  listen(canvas, 'keydown', onKey as EventListener);
  const observer = options.platform?.observeResize(resize) || (() => { const observer = new ResizeObserver(resize); observer.observe(canvas as HTMLCanvasElement); return observer; })(); resize();
  canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab';
  return {
    prepare() {
      if (disposed) return Promise.resolve();
      preparationTask ||= compileSceneVariants(renderer, scene, camera, water.mesh.getRenderTarget(), {excludeFromTarget: [water.mesh], cancelled: () => disposed});
      return preparationTask;
    },
    update, resize, dispose, setTheme, setVisible, setFraming,
    setReducedMotion(value: boolean) { reduced = value; balanceEpisode = null; postponeBalance(balanceSchedule, elapsed); water.setReducedMotion(value); accumulator = 0; orbitResumeAt = elapsed + 2; if (value) { refreshFraming(); cameraUpdate(0); } },
    setAI(value: boolean) { aiEnabled = value; if (!value) { balanceEpisode = null; interruptAgent(); } },
    reset() { noteInteraction(); endPointer(undefined, true); for (const body of bodies) scheduleReturn(body, true); },
    cancelDrag() { endPointer(undefined, true); },
    setAccent(value: THREE.ColorRepresentation) { targetAccent.set(value); },
    pulse() { water.ripple(0, .6, 1.4, .42, 'keyboard'); },
    getState: () => ({ elapsed, physicsTime, visible, reducedMotion: reduced, hdrLoaded: environment.loaded, quality, framing: { ...framingOptions, center: { ...frameCenter }, targetCenter: { ...targetFrameCenter }, targetRadius }, balance: { nextAt: balanceSchedule.nextAt, cycle: balanceSchedule.cycle, activeBody: balanceEpisode?.bodyId ?? null }, agent: { phase: agent.phase, body: agent.body?.id ?? null, label: 'Ai Agent', alpha: agent.alpha }, orbit: { yaw, pitch, radius, dragging: Boolean(orbit) }, water: water.getState(), bodies: bodies.map(body => ({ id: body.id, owner: body.owner, position: body.position.toArray(), quaternion: body.quaternion.toArray(), velocity: body.velocity.toArray(), submerged: body.submergedFraction, needsReturn: body.needsReturn, impactCount: body.impactCount, triangles: body.tooth.triangleCount })), events: events.slice() }),
  };
}
