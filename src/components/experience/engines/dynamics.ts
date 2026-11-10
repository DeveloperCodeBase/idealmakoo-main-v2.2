import { Quaternion, Vector3 } from 'three';
import { SCENE_GRAVITY, smootherstep, type OceanSample } from './ocean-math';
import { toothField, type ToothMorphology } from './anatomy';

export const PHYSICS_STEP = 1 / 120;
export interface BuoyancyProbe { local: Vector3; radius: number; volume: number }
export interface FluidBody {
  position: Vector3; quaternion: Quaternion; velocity: Vector3; angularVelocity: Vector3;
  centerOfMass: Vector3; probes: BuoyancyProbe[]; mass: number; inertia: number;
  submergedFraction: number; lastImpact: number; settledFor: number;
}
export type OceanSampler = (x: number, z: number, time: number) => OceanSample;
export interface WaterImpact { x: number; z: number; speed: number }

/** Voxel samples are inside the same anatomical field as the rendered mesh. */
export function createBuoyancyProbes(morphology: ToothMorphology, scale = 1): BuoyancyProbe[] {
  const probes: BuoyancyProbe[] = [], spacing = .19;
  for (let y = -1.97; y <= 1.04; y += spacing) for (let x = -.79; x <= .80; x += spacing) for (let z = -.66; z <= .69; z += spacing) {
    if (toothField(x, y, z, morphology) < -.035) probes.push({ local: new Vector3(x, y, z).multiplyScalar(scale), radius: spacing * .57 * scale, volume: spacing ** 3 * scale ** 3 });
  }
  return probes;
}

/** Smooth spherical-cap volume fraction: dry below -r, submerged above +r. */
export function submergedFraction(depth: number, radius: number) {
  if (!Number.isFinite(depth) || !Number.isFinite(radius) || radius <= 0) return 0;
  const t = Math.max(0, Math.min(1, (depth + radius) / (2 * radius)));
  return t * t * (3 - 2 * t);
}

export function makeFluidBody(position: Vector3, quaternion: Quaternion, morphology: ToothMorphology, scale = 1): FluidBody {
  const probes = createBuoyancyProbes(morphology, scale);
  const volume = probes.reduce((sum, probe) => sum + probe.volume, 0);
  // The mesh is a filled anatomical volume. Effective mass and a low centre
  // of gravity are art-directed for this floating display, not biological density.
  const mass = volume * .022;
  return { position, quaternion, velocity: new Vector3(), angularVelocity: new Vector3(), centerOfMass: new Vector3(0, -1.58 * scale, 0), probes, mass, inertia: mass * 1.24 * scale * scale, submergedFraction: 0, lastImpact: -10, settledFor: 0 };
}

export function equilibriumHeight(body: FluidBody, orientation = body.quaternion) {
  let low = -2.5, high = 3.2;
  const point = new Vector3();
  for (let iteration = 0; iteration < 42; iteration++) {
    const y = (low + high) / 2;
    let displaced = 0;
    for (const probe of body.probes) { point.copy(probe.local).applyQuaternion(orientation); displaced += probe.volume * submergedFraction(-(y + point.y), probe.radius); }
    if (displaced > body.mass) low = y; else high = y;
  }
  return (low + high) / 2;
}

/** Fixed-step semi-implicit rigid-body integration with distributed buoyancy. */
export function stepFluidBody(body: FluidBody, delta: number, time: number, ocean: OceanSampler): WaterImpact | null {
  const dt = Math.max(0, Math.min(PHYSICS_STEP, delta));
  if (dt === 0) return null;
  const oldVerticalSpeed = body.velocity.y;
  const force = new Vector3(0, -SCENE_GRAVITY * body.mass, 0), torque = new Vector3();
  const local = new Vector3(), world = new Vector3(), arm = new Vector3(), pointVelocity = new Vector3(), buoyancy = new Vector3();
  const centerOffset = body.centerOfMass.clone().applyQuaternion(body.quaternion);
  const centerWorld = body.position.clone().add(centerOffset);
  let volume = 0, submergedVolume = 0;
  for (const probe of body.probes) {
    local.copy(probe.local).applyQuaternion(body.quaternion);
    world.copy(body.position).add(local);
    const surface = ocean(world.x, world.z, time);
    const fraction = submergedFraction(surface.height - world.y, probe.radius);
    volume += probe.volume;
    if (fraction <= 0) continue;
    const displacement = fraction * probe.volume;
    submergedVolume += displacement;
    arm.copy(world).sub(centerWorld);
    pointVelocity.crossVectors(body.angularVelocity, arm).add(body.velocity);
    const lift = SCENE_GRAVITY * displacement;
    buoyancy.set(-surface.dx * lift * .14, lift, -surface.dz * lift * .14);
    buoyancy.x -= pointVelocity.x * displacement * 7.2;
    buoyancy.y -= (pointVelocity.y - surface.verticalVelocity) * displacement * 8.4;
    buoyancy.z -= pointVelocity.z * displacement * 7.2;
    force.add(buoyancy);
    torque.add(arm.cross(buoyancy));
  }
  const ratio = submergedVolume / Math.max(volume, .00001);
  let impact: WaterImpact | null = null;
  if (ratio > .002 && body.submergedFraction <= .002 && oldVerticalSpeed < -.55 && time - body.lastImpact > .32) {
    impact = { x: body.position.x, z: body.position.z, speed: -oldVerticalSpeed };
    body.lastImpact = time;
  }
  body.submergedFraction = ratio;
  body.velocity.addScaledVector(force, dt / body.mass);
  body.angularVelocity.addScaledVector(torque, dt / body.inertia);
  body.velocity.multiplyScalar(Math.exp(-(.065 + Math.min(ratio * 1.4, .7)) * dt));
  body.angularVelocity.multiplyScalar(Math.exp(-(.12 + Math.min(ratio * 20, 4.5)) * dt));
  if (body.velocity.lengthSq() > 180) body.velocity.setLength(Math.sqrt(180));
  if (body.angularVelocity.lengthSq() > 36) body.angularVelocity.setLength(6);
  centerWorld.addScaledVector(body.velocity, dt);
  const angularSpeed = body.angularVelocity.length();
  if (angularSpeed > .000001) body.quaternion.premultiply(new Quaternion().setFromAxisAngle(body.angularVelocity.clone().multiplyScalar(1 / angularSpeed), angularSpeed * dt)).normalize();
  body.position.copy(centerWorld).sub(centerOffset.copy(body.centerOfMass).applyQuaternion(body.quaternion));
  const waveVelocity = ocean(body.position.x, body.position.z, time).verticalVelocity;
  const quiet = ratio > .001 && Math.abs(body.velocity.y - waveVelocity) < .20 && Math.hypot(body.velocity.x, body.velocity.z) < .16 && body.angularVelocity.length() < .25;
  body.settledFor = quiet ? body.settledFor + dt : 0;
  return impact;
}

export interface AssistedReturnPlan { from: Vector3; to: Vector3; fromQuaternion: Quaternion; toQuaternion: Quaternion; clearance: number; mode: 'return' | 'balance' }
export type AssistedReturnPhase = 'lift' | 'carry' | 'lower';
export function createAssistedReturn(from: Vector3, to: Vector3, fromQuaternion: Quaternion, toQuaternion: Quaternion, gentle = false, mode: 'return' | 'balance' = 'return'): AssistedReturnPlan {
  const source = fromQuaternion.clone().normalize(), destination = toQuaternion.clone().normalize();
  // q and -q describe the same pose. Keep one hemisphere across every sample,
  // including t=1, so a turn crossing +/-180 degrees never takes the long arc.
  if (source.dot(destination) < 0) destination.set(-destination.x, -destination.y, -destination.z, -destination.w);
  const lift = mode === 'balance' ? (gentle ? .20 : .34) : (gentle ? .40 : .78);
  return { from: from.clone(), to: to.clone(), fromQuaternion: source, toQuaternion: destination, clearance: Math.max(from.y, to.y) + lift, mode };
}
/** Each segment has zero endpoint velocity/acceleration; segment poses agree. */
export function sampleAssistedReturn(plan: AssistedReturnPlan, progress: number): { position: Vector3; quaternion: Quaternion; phase: AssistedReturnPhase } {
  const t = Math.max(0, Math.min(1, progress));
  const position = plan.from.clone();
  let phase: AssistedReturnPhase;
  if (t < .24) {
    phase = 'lift'; position.y += (plan.clearance - plan.from.y) * smootherstep(t / .24);
  } else if (t < .77) {
    phase = 'carry'; const s = smootherstep((t - .24) / .53); position.lerp(plan.to, s); position.y = plan.clearance + Math.sin(Math.PI * s) ** 2 * (plan.mode === 'balance' ? .04 : .14);
  } else {
    phase = 'lower'; const s = smootherstep((t - .77) / .23); position.copy(plan.to); position.y = plan.clearance + (plan.to.y - plan.clearance) * s;
  }
  const quaternion = plan.fromQuaternion.clone().slerp(plan.toQuaternion, smootherstep(Math.max(0, Math.min(1, (t - .1) / .77)))).normalize();
  return { position, quaternion, phase };
}

export function fixedStepBudget(accumulator: number, delta: number, maxSteps = 18) {
  const available = Math.max(0, Math.min(.15, Number.isFinite(delta) ? delta : 0)) + Math.max(0, accumulator);
  const steps = Math.min(maxSteps, Math.floor((available + 1e-10) / PHYSICS_STEP));
  return { steps, remainder: Math.max(0, Math.min(PHYSICS_STEP * maxSteps, available - steps * PHYSICS_STEP)) };
}

/** Broad crown contact keeps released teeth from passing through one another. */
export function resolveCrownContact(a: FluidBody, b: FluidBody, scaleA = 1, scaleB = 1) {
  const centerA = new Vector3(0, .24 * scaleA, 0).applyQuaternion(a.quaternion).add(a.position);
  const centerB = new Vector3(0, .24 * scaleB, 0).applyQuaternion(b.quaternion).add(b.position);
  const direction = centerB.sub(centerA), distance = direction.length(), minimum = .72 * (scaleA + scaleB);
  if (distance >= minimum) return false;
  if (distance < .00001) direction.set(1, 0, 0); else direction.multiplyScalar(1 / distance);
  const invA = 1 / a.mass, invB = 1 / b.mass, inverseMass = invA + invB;
  const correction = Math.min(.045, (minimum - distance) * .24);
  a.position.addScaledVector(direction, -correction * invA / inverseMass);
  b.position.addScaledVector(direction, correction * invB / inverseMass);
  const incoming = b.velocity.clone().sub(a.velocity).dot(direction);
  if (incoming < 0) {
    const impulse = -incoming * 1.12 / inverseMass;
    a.velocity.addScaledVector(direction, -impulse * invA); b.velocity.addScaledVector(direction, impulse * invB);
  }
  return true;
}


export interface BalanceSchedule { nextAt: number; cycle: number }
export interface BalanceContext {
  visible: boolean; reducedMotion: boolean; enabled: boolean; interacting: boolean;
  assisting: boolean; available: boolean; lastInteractionAt: number;
}
export interface BalanceDisturbance {
  bodyId: number; startedAt: number; duration: number; axis: Vector3;
  direction: Vector3; waveOrigin: Vector3; peakAcceleration: number;
}

/** The visible scene clock is the only clock; hidden time never counts down. */
export function createBalanceSchedule(now = 0): BalanceSchedule { return { nextAt: now + 12.5, cycle: 0 }; }
export function balanceReady(schedule: BalanceSchedule, now: number, context: BalanceContext) {
  return Number.isFinite(now) && now >= schedule.nextAt && context.visible && !context.reducedMotion
    && context.enabled && !context.interacting && !context.assisting && context.available
    && now - context.lastInteractionAt >= 7;
}
export function postponeBalance(schedule: BalanceSchedule, now: number) {
  if (Number.isFinite(now)) schedule.nextAt = Math.max(schedule.nextAt, now + 16);
}
export function beginBalanceDisturbance(schedule: BalanceSchedule, bodyId: number, position: Vector3, now: number): BalanceDisturbance {
  const direction = new Vector3(bodyId === 0 ? -.947 : .947, 0, bodyId === 0 ? .321 : -.321).normalize();
  const episode: BalanceDisturbance = {
    bodyId, startedAt: now, duration: 1.9, direction,
    axis: new Vector3(direction.z, 0, -direction.x).normalize(),
    waveOrigin: position.clone().addScaledVector(direction, -1.55).setY(0),
    peakAcceleration: 2.70 + (schedule.cycle % 2) * .12,
  };
  schedule.cycle++;
  schedule.nextAt = now + 30 + (schedule.cycle % 3) * 4;
  return episode;
}

/** A compact wave-force envelope changes velocity only, never the actual pose. */
export function balanceAcceleration(episode: BalanceDisturbance, time: number) {
  const t = (time - episode.startedAt) / episode.duration;
  if (!Number.isFinite(t) || t <= 0 || t >= 1) return 0;
  return episode.peakAcceleration * 16 * t * t * (1 - t) * (1 - t);
}
export function stepBalanceDisturbance(body: FluidBody, episode: BalanceDisturbance, time: number, delta: number) {
  const acceleration = balanceAcceleration(episode, time), dt = Math.max(0, Math.min(PHYSICS_STEP, Number.isFinite(delta) ? delta : 0));
  if (!acceleration || !dt) return false;
  body.angularVelocity.addScaledVector(episode.axis, acceleration * dt);
  if (body.angularVelocity.lengthSq() > 6.25) body.angularVelocity.setLength(2.5);
  body.velocity.addScaledVector(episode.direction, acceleration * dt * .018);
  body.settledFor = 0;
  return true;
}
