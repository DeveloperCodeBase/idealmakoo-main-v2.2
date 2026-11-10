import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { loadTs } from './helpers/load-ts.mjs';

const anatomy = await loadTs('src/components/experience/engines/anatomy.ts');
const teeth = await loadTs('src/components/experience/engines/tooth.ts');
const ocean = await loadTs('src/components/experience/engines/ocean-math.ts');
const dynamics = await loadTs('src/components/experience/engines/dynamics.ts');
const { createSceneClock } = await loadTs('src/components/experience/engines/scene-clock.ts');
const rubik = await loadTs('src/components/experience/engines/rubik.ts');
const framing = await loadTs('src/components/experience/engines/framing.ts');
const calm = () => ({ height: 0, dx: 0, dz: 0, verticalVelocity: 0 });
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const bodyAt = (height = 4, kind = 'maxillary') => dynamics.makeFluidBody(new Vector3(0, height, 0), new Quaternion(), kind);

test('centered scenes keep their original optical center and radius while landing direction follows all five locales', () => {
  for (const [width, height] of [[320, 460], [720, 500], [1440, 690], [3440, 900]]) {
    const result = framing.heroCameraFraming(width, height);
    assert.deepEqual(result.region, { x: 0, y: 0, width: 1, height: 1 });
    close(result.centerX, .5); close(result.centerY, .5);
    close(result.radius, Math.max(8.5, 7.6 / Math.max(.52, width / height)));
  }
  for (const locale of ['fa', 'en', 'tr', 'ar', 'ru']) {
    const rtl = ['fa', 'ar'].includes(locale), result = framing.heroCameraFraming(1440, 900, { composition: 'landing', locale });
    assert.equal(framing.sceneDirection(locale), rtl ? 'rtl' : 'ltr');
    assert.ok(rtl ? result.centerX < .44 && result.offsetX > 0 : result.centerX > .56 && result.offsetX < 0);
  }
  assert.equal(framing.sceneDirection('fa-IR'), 'rtl');
  assert.equal(framing.sceneDirection('en-US'), 'ltr');
});

test('measured scene framing cancels page offsets and follows a taller translated mobile copy region', () => {
  const canvas = { left: 15, top: 1200, width: 390, height: 980 };
  const area = { left: 35, top: 1710, width: 350, height: 280 };
  const normalized = framing.normalizeSceneRegion(canvas, area);
  close(normalized.x, 20 / 390); close(normalized.y, 510 / 980);
  close(normalized.width, 350 / 390); close(normalized.height, 280 / 980);
  assert.deepEqual(framing.normalizeSceneRegion({ ...canvas, top: -500 }, { ...area, top: 10 }), normalized);
  const taller = framing.normalizeSceneRegion({ ...canvas, height: 1120 }, { ...area, top: 1850 });
  const frame = framing.heroCameraFraming(390, 1120, { composition: 'landing', locale: 'fa', region: taller });
  close(frame.centerY * 1120, 790);
  assert.equal(framing.normalizeSceneRegion(canvas, { ...area, width: 0 }), null);
  assert.equal(framing.normalizeSceneRegion({ ...canvas, width: NaN }, area), null);
  assert.deepEqual(framing.validSceneRegion({ x: -.1, y: .2, width: .6, height: 2 }), { x: 0, y: .2, width: .5, height: .8 });
});

test('off-axis landing projection places the physical orbit target in its DOM region and the picking ray still meets it', () => {
  const target = new Vector3(0, .95, 0);
  for (const [width, height, locale, region] of [
    [1440, 900, 'en', { x: .44, y: .08, width: .54, height: .76 }],
    [1440, 900, 'fa', { x: .02, y: .08, width: .54, height: .76 }],
    [390, 1060, 'ru', { x: .035, y: .55, width: .93, height: .28 }],
  ]) {
    const frame = framing.heroCameraFraming(width, height, { composition: 'landing', locale, region });
    const camera = new PerspectiveCamera(34, width / height, .12, 190);
    camera.position.set(Math.sin(-.12) * Math.cos(.3) * frame.radius, target.y + Math.sin(.3) * frame.radius, Math.cos(-.12) * Math.cos(.3) * frame.radius);
    camera.lookAt(target); camera.setViewOffset(width, height, frame.offsetX, frame.offsetY, width, height); camera.updateMatrixWorld(true);
    const projected = target.clone().project(camera);
    close((projected.x + 1) / 2, frame.centerX); close((1 - projected.y) / 2, frame.centerY);
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(frame.centerX * 2 - 1, 1 - frame.centerY * 2), camera);
    close(ray.ray.distanceToPoint(target), 0, 1e-6);
  }
});

test('fitted enamel and AI clearance stay inside desktop and mobile visual regions throughout horizontal orbit', () => {
  const envelope = { radial: 2.8, minY: -1.3, maxY: 2.1 }, target = new Vector3(0, .95, 0);
  for (const [width, height, region] of [
    [1440, 900, { x: .455, y: .06, width: .52, height: .76 }],
    [1440, 900, { x: .025, y: .06, width: .52, height: .76 }],
    [390, 980, { x: .035, y: .54, width: .93, height: .29 }],
  ]) {
    const frame = framing.heroCameraFraming(width, height, { composition: 'landing', region }, envelope);
    const camera = new PerspectiveCamera(34, width / height, .12, 190);
    camera.setViewOffset(width, height, frame.offsetX, frame.offsetY, width, height);
    for (let orbit = 0; orbit < 16; orbit++) {
      const yaw = orbit * Math.PI / 8;
      camera.position.set(Math.sin(yaw) * Math.cos(.3) * frame.radius, target.y + Math.sin(.3) * frame.radius, Math.cos(yaw) * Math.cos(.3) * frame.radius);
      camera.lookAt(target); camera.updateMatrixWorld(true);
      for (let sample = 0; sample < 48; sample++) for (const y of [envelope.minY, envelope.maxY]) {
        const angle = sample * Math.PI / 24;
        const p = new Vector3(Math.sin(angle) * envelope.radial, target.y + y, Math.cos(angle) * envelope.radial).project(camera);
        const x = (p.x + 1) / 2, screenY = (1 - p.y) / 2;
        assert.ok(x >= region.x + region.width * .05 && x <= region.x + region.width * .95, 'enamel remains inside horizontal breathing room');
        assert.ok(screenY >= region.y + region.height * .07 && screenY <= region.y + region.height * .93, 'enamel/AI clearance remains inside vertical breathing room');
      }
    }
  }
});

for (const morphology of ['maxillary', 'mandibular']) {
  test(`${morphology} high-detail enamel mesh is closed, bounded and has finite unit normals`, () => {
    const geometry = teeth.buildMolarGeometry('high', morphology);
    const edges = new Map(), positions = geometry.attributes.position, normals = geometry.attributes.normal, indices = geometry.index.array;
    assert.ok(positions.count > 10000);
    for (let i = 0; i < positions.count; i++) {
      const p = [positions.getX(i), positions.getY(i), positions.getZ(i)];
      assert.ok(p.every(Number.isFinite));
      close(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)), 1, 2e-6);
      for (let axis = 0; axis < 3; axis++) assert.ok(p[axis] > anatomy.ANATOMY_BOUNDS.min[axis] && p[axis] < anatomy.ANATOMY_BOUNDS.max[axis]);
    }
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
      assert.ok(a !== b && b !== c && c !== a);
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        const edge = x < y ? `${x}:${y}` : `${y}:${x}`;
        edges.set(edge, (edges.get(edge) || 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(count => count === 2), 'every anatomical surface edge must join exactly two triangles');
    assert.equal(positions.count - edges.size + indices.length / 3, 2, 'the crown, root trunk and roots must form one closed genus-zero surface');
    assert.ok(geometry.boundingBox.min.y < -1.8, 'long roots must remain present');
    assert.ok(geometry.boundingBox.max.y > 1, 'the cusp surface must remain present');
    geometry.dispose();
  });
}

test('upper and lower molars have distinct closed root fields and a recessed central fossa', () => {
  assert.equal(anatomy.ROOT_PROFILES.maxillary.length, 3);
  assert.equal(anatomy.ROOT_PROFILES.mandibular.length, 2);
  for (const morphology of ['maxillary', 'mandibular']) {
    for (const root of anatomy.ROOT_PROFILES[morphology]) {
      const point = [(root.start[0] + root.end[0]) / 2 + root.bend[0], (root.start[1] + root.end[1]) / 2, (root.start[2] + root.end[2]) / 2 + root.bend[1]];
      assert.ok(anatomy.toothField(...point, morphology) < 0, 'each divergent root must connect to a filled interior');
      assert.ok(anatomy.toothField(root.end[0], root.end[1] - .1, root.end[2], morphology) > 0, 'each root tip must close');
    }
    assert.ok(anatomy.occlusalHeight(-.35, -.25, morphology) > anatomy.occlusalHeight(0, 0, morphology) + .25);
    assert.ok(anatomy.toothField(0, -1.7, 0, morphology) > 0, 'space between the roots must remain open');
  }
  assert.notEqual(anatomy.toothField(.78, .3, 0, 'maxillary'), anatomy.toothField(.78, .3, 0, 'mandibular'));
});

test('shared dental geometry is released only after its last owning instance, with independent materials', () => {
  const first = teeth.createTooth({ quality: 'standard' }), second = teeth.createTooth({ quality: 'standard' });
  assert.equal(first.mesh.geometry, second.mesh.geometry);
  assert.notEqual(first.mesh.material, second.mesh.material);
  let released = 0;
  first.mesh.geometry.addEventListener('dispose', () => released++);
  first.dispose(); first.dispose(); assert.equal(released, 0);
  second.mesh.material.color.set(0xff0000);
  assert.notEqual(first.mesh.material.color.getHex(), second.mesh.material.color.getHex());
  second.dispose(); second.dispose(); assert.equal(released, 1);
});

test('ocean analytic slopes and water velocity agree with sampled displacement', () => {
  const impulses = [{ x: -.4, z: .6, startedAt: .3, amplitude: .13, radius: .32 }], e = 1e-5;
  for (const [x, z, time] of [[.3, -.2, 1.1], [-1.2, 2.1, .9], [.4, .3, .33], [5, -2, 3]]) {
    const value = ocean.sampleOcean(x, z, time, impulses);
    close(value.dx, (ocean.sampleOcean(x + e, z, time, impulses).height - ocean.sampleOcean(x - e, z, time, impulses).height) / (2 * e), 2e-5);
    close(value.dz, (ocean.sampleOcean(x, z + e, time, impulses).height - ocean.sampleOcean(x, z - e, time, impulses).height) / (2 * e), 2e-5);
    close(value.verticalVelocity, (ocean.sampleOcean(x, z, time + e, impulses).height - ocean.sampleOcean(x, z, time - e, impulses).height) / (2 * e), 2e-5);
  }
});

test('impact packets start without a jump, travel outward and decay after their finite lifetime', () => {
  const impulse = { x: 0, z: 0, startedAt: 2, amplitude: .12, radius: .3 };
  assert.deepEqual(ocean.sampleOcean(0, 0, 1.9, [impulse], 0), calm());
  assert.deepEqual(ocean.sampleOcean(0, 0, 2, [impulse], 0), calm());
  const first = Math.abs(ocean.sampleOcean(1.85 * .6, 0, 2.6, [impulse], 0).height);
  const later = Math.abs(ocean.sampleOcean(1.85 * 2, 0, 4, [impulse], 0).height);
  assert.ok(first > .01 && later > .001 && later < first);
  assert.ok(Math.abs(ocean.sampleOcean(0, 0, 4, [impulse], 0).height) < later * .1);
  assert.deepEqual(ocean.sampleOcean(1, 1, 9.1, [impulse], 0), calm());
});

test('fast pointer strokes cannot accumulate unbounded impulse arrays or invalid wave energy', () => {
  let impulses = [];
  for (let index = 0; index < 40; index++) impulses = ocean.addOceanImpulse(impulses, { x: index * .03, z: 0, startedAt: index * .02, amplitude: 20, radius: 0 }, index * .02);
  assert.equal(impulses.length, ocean.MAX_OCEAN_IMPULSES);
  assert.ok(impulses.every(item => item.amplitude <= .19 && item.radius >= .14));
  assert.deepEqual(ocean.addOceanImpulse(impulses, { x: NaN, z: 0, startedAt: 1, amplitude: 1, radius: .3 }, 1), impulses);
  const expired = ocean.addOceanImpulse(impulses, { x: 0, z: 0, startedAt: 9, amplitude: .1, radius: .3 }, 9);
  assert.equal(expired.length, 1);
});

test('reduced-motion ocean is exactly still until a user creates an impact', () => {
  assert.deepEqual(ocean.sampleOcean(1.2, 2.3, 100, [], 0), calm());
  const impact = { x: 1, z: 2, startedAt: 100, amplitude: .12, radius: .3 };
  assert.notEqual(ocean.sampleOcean(1.3, 2, 100.2, [impact], 0).height, 0);
});

test('spherical-cap displacement is bounded, monotonic and symmetric across the waterline', () => {
  let previous = -1;
  for (let i = -20; i <= 20; i++) {
    const depth = i / 10, fraction = dynamics.submergedFraction(depth, 1);
    assert.ok(fraction >= previous && fraction >= 0 && fraction <= 1); previous = fraction;
    close(fraction + dynamics.submergedFraction(-depth, 1), 1);
  }
  close(dynamics.submergedFraction(0, 1), .5);
  assert.equal(dynamics.submergedFraction(0, 0), 0);
});

test('a released body accelerates downward in air and its rotation stays normalized', () => {
  const body = bodyAt(8); body.angularVelocity.set(.8, .5, -.3);
  for (let step = 1; step <= 60; step++) dynamics.stepFluidBody(body, dynamics.PHYSICS_STEP, step * dynamics.PHYSICS_STEP, calm);
  assert.ok(body.velocity.y < -4.5 && body.velocity.y > -5.0);
  assert.equal(body.submergedFraction, 0);
  assert.ok(body.quaternion.angleTo(new Quaternion()) > .3);
  close(body.quaternion.length(), 1);
});

for (const morphology of ['maxillary', 'mandibular']) {
  test(`${morphology} drop produces an impact, floats at volume equilibrium and dissipates motion`, () => {
    const body = bodyAt(4, morphology); let impacts = 0;
    for (let step = 1; step <= 1200; step++) if (dynamics.stepFluidBody(body, dynamics.PHYSICS_STEP, step * dynamics.PHYSICS_STEP, calm)) impacts++;
    assert.equal(impacts, 1, 'the first entry should produce one impact rather than a floor-bounce loop');
    assert.ok(body.position.toArray().every(Number.isFinite));
    assert.ok(body.position.y > .7 && body.position.y < 1.6);
    assert.ok(body.velocity.length() < .01 && body.angularVelocity.length() < .01);
    const volume = body.probes.reduce((sum, probe) => sum + probe.volume, 0);
    close(body.submergedFraction * volume, body.mass, .00005);
    close(body.position.y, dynamics.equilibriumHeight(body), .003);
    close(body.quaternion.length(), 1);
  });
}

test('fixed-step physics yields the same released-body trajectory at 60, 30 and reduced 10 Hz renders', () => {
  const trajectories = [60, 30, 10].map(rate => {
    const body = bodyAt(5); body.angularVelocity.set(.2, .1, .3); let accumulator = 0, time = 0, count = 0;
    for (let frame = 0; frame < rate * 2; frame++) {
      const budget = dynamics.fixedStepBudget(accumulator, 1 / rate); accumulator = budget.remainder;
      for (let step = 0; step < budget.steps; step++) { time += dynamics.PHYSICS_STEP; count++; dynamics.stepFluidBody(body, dynamics.PHYSICS_STEP, time, calm); }
    }
    assert.equal(count, 240); return body;
  });
  for (const body of trajectories.slice(1)) {
    assert.ok(body.position.distanceTo(trajectories[0].position) < 1e-10);
    assert.ok(body.quaternion.angleTo(trajectories[0].quaternion) < 1e-7);
  }
  assert.equal(dynamics.fixedStepBudget(0, 500).steps, 18, 'a long stall must not schedule seconds of catch-up simulation');
});

test('released crown contacts separate bodies and conserve linear momentum without adding energy', () => {
  const left = bodyAt(), right = bodyAt(); left.position.x = -.6; right.position.x = .6;
  left.velocity.x = 2; right.velocity.x = -2;
  const momentum = left.velocity.x * left.mass + right.velocity.x * right.mass;
  const before = left.velocity.lengthSq() * left.mass + right.velocity.lengthSq() * right.mass;
  assert.equal(dynamics.resolveCrownContact(left, right), true);
  assert.ok(left.position.x < -.6 && right.position.x > .6);
  close(left.velocity.x * left.mass + right.velocity.x * right.mass, momentum);
  assert.ok(left.velocity.lengthSq() * left.mass + right.velocity.lengthSq() * right.mass < before);
  right.position.x = 4; assert.equal(dynamics.resolveCrownContact(left, right), false);
});

test('assisted return begins at the actual pose, follows continuous lift/carry/lower boundaries and ends without a snap', () => {
  const from = new Vector3(2.7, .95, -1.2), to = new Vector3(-1.4, 1.1, .2);
  const fromQ = new Quaternion().setFromAxisAngle(new Vector3(.5, 1, .2).normalize(), 1.8), toQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -.4);
  const plan = dynamics.createAssistedReturn(from, to, fromQ, toQ);
  const start = dynamics.sampleAssistedReturn(plan, 0), end = dynamics.sampleAssistedReturn(plan, 1);
  assert.ok(start.position.distanceTo(from) < 1e-12 && end.position.distanceTo(to) < 1e-12);
  assert.ok(start.quaternion.angleTo(fromQ) < 1e-7 && end.quaternion.angleTo(toQ) < 1e-7);
  for (const boundary of [.24, .77]) {
    const before = dynamics.sampleAssistedReturn(plan, boundary - 1e-5), after = dynamics.sampleAssistedReturn(plan, boundary + 1e-5);
    assert.ok(before.position.distanceTo(after.position) < 1e-6);
    assert.ok(before.quaternion.angleTo(after.quaternion) < .0002);
  }
  const justBefore = dynamics.sampleAssistedReturn(plan, 1 - 1e-4);
  assert.ok(justBefore.position.distanceTo(to) < 1e-8, 'lowering must end with negligible speed');
  assert.ok(dynamics.sampleAssistedReturn(plan, .5).position.y > Math.max(from.y, to.y) + .8);
  assert.deepEqual(from.toArray(), [2.7, .95, -1.2]);
  assert.ok(plan.from !== from && plan.to !== to);
});

test('scene clocks discard hidden time and resume at the same pose without a large delta', () => {
  const clock = createSceneClock(); clock.setVisible(true);
  assert.deepEqual(clock.frame(1000), { time: 0, delta: 0 });
  close(clock.frame(1016).delta, .016); clock.setVisible(false);
  assert.equal(clock.frame(60000), null); clock.setVisible(true);
  assert.deepEqual(clock.frame(90000), { time: 16, delta: 0 });
  close(clock.frame(90016).delta, .016);
});

test('reduced-motion render throttling accumulates elapsed deltas instead of slowing explicit physics', () => {
  const clock = createSceneClock(); clock.setVisible(true); clock.frame(0, true);
  let simulated = 0, renders = 0;
  for (let frame = 1; frame <= 60; frame++) { const next = clock.frame(frame * 1000 / 60, true); if (next) { simulated += next.delta; renders++; } }
  assert.equal(renders, 10); close(simulated, 1);
});

test('Rubik move parsing preserves real face inverses and rejects unsupported commands', () => {
  const axes = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
  for (const name of ['R', 'L', 'U', 'D', 'F', 'B', 'M', 'E', 'S']) {
    const move = rubik.parseMove(name), inverse = rubik.inverseMove(move);
    assert.equal(inverse.axis, move.axis); assert.equal(inverse.layer, move.layer);
    const q = new Quaternion().setFromAxisAngle(axes[move.axis], move.turns * Math.PI / 2);
    q.multiply(new Quaternion().setFromAxisAngle(axes[inverse.axis], inverse.turns * Math.PI / 2));
    close(q.angleTo(new Quaternion()), 0);
    assert.deepEqual(rubik.parseMove(inverse.notation), inverse);
  }
  for (const invalid of ['RR', 'R3', 'Q', 'R;alert(1)', '', null]) assert.equal(rubik.parseMove(invalid), null);
});

test('Rubik canonical quarter turns retain an exact orthogonal lattice through repeated rotations', () => {
  const q = new Quaternion(), rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  for (let i = 0; i < 400; i++) {
    rubik.canonicalQuaternion(q.premultiply(rotation));
    const matrix = new Matrix4().makeRotationFromQuaternion(q).elements;
    for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10]) close(matrix[index], Math.round(matrix[index]));
    close(q.length(), 1);
  }
  assert.ok(q.angleTo(new Quaternion()) < 1e-7);
  assert.equal(rubik.normalizedTurns(-4), 0);
});


test('solid crown proportions and unequal cusp facets remain distinct from the filled cervical trunk', () => {
  for (const [morphology, expected] of [['maxillary', 4], ['mandibular', 5]]) {
    const cusps = anatomy.CUSP_PROFILES[morphology];
    assert.equal(cusps.length, expected);
    assert.ok(Math.max(...cusps.map(cusp => cusp.height)) - Math.min(...cusps.map(cusp => cusp.height)) > .12);
    assert.ok(anatomy.toothField(0, .4, 0, morphology) < -.2, 'a solid dentine volume fills the crown');
    assert.ok(anatomy.toothField(0, -.37, 0, morphology) < -.1, 'the filled root trunk connects to the cervical crown');
    assert.ok(anatomy.toothField(0, -1.6, 0, morphology) > 0, 'the root furcation stays open below the trunk');
    const table = anatomy.occlusalHeight(0, 0, morphology);
    assert.ok(cusps.every(cusp => anatomy.occlusalHeight(cusp.x, cusp.z, morphology) > table + .12));
  }
});

test('autonomous balance episodes require visible, quiet, enabled motion and respect a completed gesture cooldown', () => {
  const schedule = dynamics.createBalanceSchedule();
  const context = { visible: true, reducedMotion: false, enabled: true, interacting: false, assisting: false, available: true, lastInteractionAt: -10 };
  assert.equal(dynamics.balanceReady(schedule, 12.49, context), false);
  assert.equal(dynamics.balanceReady(schedule, 12.5, context), true);
  for (const change of [{ visible: false }, { reducedMotion: true }, { enabled: false }, { interacting: true }, { assisting: true }, { available: false }, { lastInteractionAt: 8 }]) {
    assert.equal(dynamics.balanceReady(schedule, 13, { ...context, ...change }), false);
  }
  dynamics.postponeBalance(schedule, 20);
  assert.equal(dynamics.balanceReady(schedule, 35.99, { ...context, lastInteractionAt: 20 }), false);
  assert.equal(dynamics.balanceReady(schedule, 36, { ...context, lastInteractionAt: 20 }), true);
  const origin = new Vector3(-1.4, 1.1, .2), episode = dynamics.beginBalanceDisturbance(schedule, 0, origin, 36);
  assert.equal(schedule.cycle, 1);
  assert.ok(schedule.nextAt >= 66 && schedule.nextAt <= 74);
  assert.deepEqual(origin.toArray(), [-1.4, 1.1, .2]);
  assert.ok(episode.waveOrigin.distanceTo(origin) > 1.5);
});

test('wave tipping is a smooth bounded force and never teleports or rotates a body directly', () => {
  const body = bodyAt(1.1), position = body.position.clone(), quaternion = body.quaternion.clone();
  const episode = dynamics.beginBalanceDisturbance(dynamics.createBalanceSchedule(), 0, body.position, 10);
  for (const time of [9, 10, 10 + episode.duration, 20]) close(dynamics.balanceAcceleration(episode, time), 0);
  assert.ok(dynamics.balanceAcceleration(episode, 10.00001) < 1e-8);
  assert.ok(dynamics.balanceAcceleration(episode, 10 + episode.duration - .00001) < 1e-8);
  close(dynamics.balanceAcceleration(episode, 10 + episode.duration / 2), episode.peakAcceleration);
  assert.equal(dynamics.stepBalanceDisturbance(body, episode, 10 + episode.duration / 2, dynamics.PHYSICS_STEP), true);
  assert.ok(body.position.distanceTo(position) === 0);
  assert.ok(body.quaternion.equals(quaternion));
  assert.ok(body.angularVelocity.length() > 0 && body.angularVelocity.length() < .03);
  const velocity = body.angularVelocity.clone();
  assert.equal(dynamics.stepBalanceDisturbance(body, episode, 10.5, NaN), false);
  assert.ok(body.angularVelocity.equals(velocity));
});

for (const [bodyId, morphology] of ['maxillary', 'mandibular'].entries()) {
  test(`${morphology} wave tip produces a visible lean and can be recovered from the actual fluid pose without a jump`, () => {
    const body = bodyAt(0, morphology); body.position.y = dynamics.equilibriumHeight(body);
    const destination = body.position.clone(), schedule = dynamics.createBalanceSchedule();
    const episode = dynamics.beginBalanceDisturbance(schedule, bodyId, body.position, 0);
    const impulse = { x: episode.waveOrigin.x, z: episode.waveOrigin.z, startedAt: 0, amplitude: .14, radius: .44 };
    const sampler = (x, z, time) => ocean.sampleOcean(x, z, time, [impulse]);
    let peak = 0;
    for (let step = 1; step <= 252; step++) {
      const time = step * dynamics.PHYSICS_STEP, previous = body.position.clone();
      dynamics.stepBalanceDisturbance(body, episode, time, dynamics.PHYSICS_STEP);
      dynamics.stepFluidBody(body, dynamics.PHYSICS_STEP, time, sampler);
      assert.ok(body.position.distanceTo(previous) < .035, 'a passing wave must not reset the transform');
      peak = Math.max(peak, body.quaternion.angleTo(new Quaternion()));
    }
    assert.ok(peak > .35 && peak < .95, `the bounded wave should tip, not flip, the tooth: ${peak}`);
    const actualPosition = body.position.clone(), actualQuaternion = body.quaternion.clone();
    const plan = dynamics.createAssistedReturn(actualPosition, destination, actualQuaternion, new Quaternion(), false, 'balance');
    const start = dynamics.sampleAssistedReturn(plan, 0);
    assert.ok(start.position.distanceTo(actualPosition) < 1e-12);
    assert.ok(start.quaternion.angleTo(actualQuaternion) < 1e-7);
    let previous = start;
    for (let step = 1; step <= 228; step++) {
      const pose = dynamics.sampleAssistedReturn(plan, step / 228);
      assert.ok(pose.position.distanceTo(previous.position) < .04);
      assert.ok(pose.quaternion.angleTo(previous.quaternion) < .035);
      close(pose.quaternion.length(), 1);
      previous = pose;
    }
    assert.ok(previous.position.distanceTo(destination) < 1e-12);
    assert.ok(previous.quaternion.angleTo(new Quaternion()) < 1e-7);
    // User takeover adopts the current frame. With no subsequent agent sample,
    // the next movement is a normal fluid step, not a saved reset transform.
    const interrupted = dynamics.sampleAssistedReturn(plan, .52);
    body.position.copy(interrupted.position); body.quaternion.copy(interrupted.quaternion);
    body.velocity.set(0, 0, 0); body.angularVelocity.set(0, 0, 0);
    dynamics.stepFluidBody(body, dynamics.PHYSICS_STEP, 4, calm);
    assert.ok(body.position.distanceTo(interrupted.position) < .003);
  });
}

test('assisted straightening crosses the quaternion +/-180-degree boundary by the shortest continuous arc', () => {
  const from = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI - .07);
  const to = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI + .06);
  const plan = dynamics.createAssistedReturn(new Vector3(1, 1, 0), new Vector3(1, 1, 0), from, to, false, 'balance');
  let previous = dynamics.sampleAssistedReturn(plan, 0).quaternion, totalAngle = 0;
  for (let step = 1; step <= 500; step++) {
    const current = dynamics.sampleAssistedReturn(plan, step / 500).quaternion;
    assert.ok(previous.dot(current) > .9999, 'quaternion component sign must not flip at the final sample');
    totalAngle += previous.angleTo(current); previous = current;
  }
  close(totalAngle, .13, 1e-6);
  assert.ok(previous.angleTo(to) < 1e-7);
  const antipodal = new Quaternion(-from.x, -from.y, -from.z, -from.w);
  const samePose = dynamics.createAssistedReturn(new Vector3(), new Vector3(), from, antipodal, false, 'balance');
  assert.ok(dynamics.sampleAssistedReturn(samePose, .5).quaternion.angleTo(from) < 1e-7);
});
