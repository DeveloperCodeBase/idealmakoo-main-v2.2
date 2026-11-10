import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {BoxGeometry, DirectionalLight, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PerspectiveCamera, Scene, WebGLRenderTarget} from 'three';
import {loadTs} from './helpers/load-ts.mjs';

const {compileSceneVariants, createScenePreparationGate} = await loadTs('src/components/experience/engines/scene-preparation.ts');
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function fixture() {
  const scene = new Scene(), camera = new PerspectiveCamera(34, 1, .12, 190);
  const water = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  const sky = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  const group = new Group();
  const left = new Mesh(new BoxGeometry(), new MeshPhysicalMaterial({transmission: .13, roughness: .218}));
  const right = new Mesh(left.geometry, left.material.clone());
  group.add(left, right); scene.add(sky, new DirectionalLight(), water, group);
  const target = new WebGLRenderTarget(32, 16), originalTarget = new WebGLRenderTarget(16, 8);
  const calls = [], submissions = [];
  let activeTarget = originalTarget, activeFace = 4, activeLevel = 2;
  const renderer = {
    getRenderTarget: () => activeTarget,
    getActiveCubeFace: () => activeFace,
    getActiveMipmapLevel: () => activeLevel,
    setRenderTarget(value, face = 0, level = 0) { activeTarget = value; activeFace = face; activeLevel = level; },
    compileAsync(object, selectedCamera, selectedScene) {
      const pending = deferred(); submissions.push(pending);
      calls.push({object, camera: selectedCamera, scene: selectedScene, target: activeTarget, face: activeFace, level: activeLevel});
      return pending.promise;
    },
  };
  const restored = () => {
    assert.equal(renderer.getRenderTarget(), originalTarget);
    assert.equal(renderer.getActiveCubeFace(), 4);
    assert.equal(renderer.getActiveMipmapLevel(), 2);
  };
  return {scene, camera, water, sky, left, right, target, renderer, calls, submissions, restored};
}

test('canvas and actual reflection/transmission meshes compile sequentially with state restored before every await', async () => {
  const f = fixture(), before = JSON.stringify(f.scene.toJSON()), cameraBefore = JSON.stringify(f.camera.toJSON());
  const pending = compileSceneVariants(f.renderer, f.scene, f.camera, f.target, {excludeFromTarget: [f.water]});
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].object, f.scene); assert.equal(f.calls[0].target, null); f.restored();
  // Keeping a submission unresolved prevents any later variant from replacing
  // the material.currentProgram which Three's asynchronous poll is watching.
  await turn(); assert.equal(f.calls.length, 1);
  for (let i = 0; i < 4; i++) {
    assert.equal(f.calls.length, i + 1);
    f.restored();
    f.submissions[i].resolve();
    await turn();
  }
  await pending;
  assert.deepEqual(f.calls.slice(1).map(call => call.object), [f.sky, f.left, f.right]);
  for (const call of f.calls) {
    assert.equal(call.scene, f.scene); assert.equal(call.camera, f.camera);
    if (call.object !== f.scene) assert.equal(call.target, f.target);
  }
  assert.equal(JSON.stringify(f.scene.toJSON()), before, 'preparation preserves scene membership, geometry, materials and light values');
  assert.equal(JSON.stringify(f.camera.toJSON()), cameraBefore);
  f.restored();
});

test('a synchronous canvas compile failure restores its previous binding and does not submit target programs', async () => {
  const f = fixture(), error = new Error('shader submission failed');
  let calls = 0;
  f.renderer.compileAsync = () => { calls++; throw error; };
  await assert.rejects(compileSceneVariants(f.renderer, f.scene, f.camera, f.target), value => value === error);
  assert.equal(calls, 1); f.restored();
});

test('a synchronous target compile failure preserves the original binding and stops following meshes', async () => {
  const f = fixture(), error = new Error('target shader submission failed');
  const pending = compileSceneVariants(f.renderer, f.scene, f.camera, f.target, {excludeFromTarget: [f.water]});
  let targetCalls = 0;
  f.renderer.compileAsync = () => { targetCalls++; throw error; };
  const rejected = assert.rejects(pending, value => value === error);
  f.submissions[0].resolve();
  await rejected;
  assert.equal(targetCalls, 1); f.restored();
});

test('a rejected target compilation is surfaced after state restoration and stops later work', async () => {
  const f = fixture(), error = new Error('target shader rejected');
  const pending = compileSceneVariants(f.renderer, f.scene, f.camera, f.target, {excludeFromTarget: [f.water]});
  const rejected = assert.rejects(pending, value => value === error);
  f.submissions[0].resolve(); await turn();
  assert.equal(f.calls.length, 2); f.restored();
  f.submissions[1].reject(error); await rejected; await turn();
  assert.equal(f.calls.length, 2); f.restored();
});

test('cancellation during one program wait prevents further target variants without disturbing the renderer', async () => {
  const f = fixture(); let cancelled = false;
  const pending = compileSceneVariants(f.renderer, f.scene, f.camera, f.target, {cancelled: () => cancelled});
  cancelled = true; f.submissions[0].resolve();
  await pending; assert.equal(f.calls.length, 1); f.restored();
  await compileSceneVariants(f.renderer, f.scene, f.camera, f.target, {cancelled: () => true});
  assert.equal(f.calls.length, 1); f.restored();
});

function sourceNode(file, kind, name) {
  const source = ts.createSourceFile(file, readFileSync(new URL('../' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  function visit(node) {
    if (kind === 'variable' && ts.isVariableDeclaration(node) && node.name.getText(source) === name) found.push(node.initializer.getText(source));
    if (kind === 'function' && ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source); assert.equal(found.length, 1, 'one actual ' + name + ' implementation');
  return found[0];
}
const component = 'src/components/experience/ToothExperience.tsx';
const drawSource = sourceNode(component, 'variable', 'draw');
const visibilitySource = sourceNode(component, 'variable', 'updateVisibility');
const authReleaseSource = sourceNode(component, 'variable', 'releaseAuthDrag');
function componentCallbacks(scenePreparation, variant = 'hero') {
  const records = {frames: [], cancelled: [], updates: [], visibility: [], fallback: 0, orbitResets: 0};
  const captures = new Set([7]);
  const canvas = {style: {}, hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id)};
  const document = {hidden: false};
  const code = `(() => {
    let frameId = 0, disposed = false, failed = false, inViewport = true, drag = {id: 7, x: 0, y: 0};
    const releaseAuthDrag = ${authReleaseSource};
    const draw = ${drawSource};
    const updateVisibility = ${visibilitySource};
    return {draw, updateVisibility, setViewport(value) {inViewport=value;}, setDisposed() {disposed=true;}, get frameId() {return frameId;}};
  })()`;
  const callbacks = runInNewContext(ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText, {
    scenePreparation, document, variant, canvas,
    scene: {update: (...args) => records.updates.push(args), setVisible: value => records.visibility.push(value), resetOrbit: () => records.orbitResets++},
    clock: {frame: now => ({time: now, delta: .016}), setVisible() {}},
    motion: {matches: false}, isReducedMotion: () => false,
    requestAnimationFrame: fn => {records.frames.push(fn); return records.frames.length;},
    cancelAnimationFrame: id => records.cancelled.push(id),
    showFallback: () => records.fallback++,
  });
  return {...callbacks, callbacks, document, records, captures, canvas};
}

test('the actual draw and visibility callbacks never render or schedule before preparation, then retain visibility checks', async () => {
  const gate = createScenePreparationGate(), waiting = deferred(), f = componentCallbacks(gate);
  const pending = gate.prepare(() => waiting.promise);
  f.updateVisibility(); f.draw(1); f.updateVisibility();
  assert.equal(f.records.updates.length, 0); assert.equal(f.records.frames.length, 0);
  assert.deepEqual(f.records.visibility, [false, false]);
  waiting.resolve(); assert.equal(await pending, true);
  f.updateVisibility(); assert.equal(f.records.frames.length, 1);
  f.draw(16); assert.equal(f.records.updates.length, 1);
  f.document.hidden = true; f.updateVisibility(); f.draw(32);
  f.document.hidden = false; f.setViewport(false); f.updateVisibility(); f.draw(48);
  assert.equal(f.records.updates.length, 1);
  f.setViewport(true); f.updateVisibility(); assert.equal(f.records.visibility.at(-1), true);
  f.setDisposed(); f.updateVisibility(); f.draw(64);
  assert.equal(f.records.updates.length, 1); assert.equal(f.records.visibility.at(-1), false);
});

test('the actual auth visibility callback releases native capture and resets the orbit when hidden', async () => {
  const gate = createScenePreparationGate(), f = componentCallbacks(gate, 'auth');
  await gate.prepare(() => Promise.resolve());
  f.updateVisibility(); assert.equal(f.captures.has(7), true); assert.equal(f.records.orbitResets, 0);
  f.document.hidden = true; f.updateVisibility(); f.draw(32);
  assert.equal(f.captures.size, 0); assert.equal(f.records.orbitResets, 1);
  assert.equal(f.canvas.style.cursor, 'grab'); assert.equal(f.records.updates.length, 0);
  assert.equal(f.records.visibility.at(-1), false);
});

test('a failed preparation never allows the real visibility callback to start an animation', async () => {
  const gate = createScenePreparationGate(), f = componentCallbacks(gate), error = new Error('compile failed');
  await assert.rejects(gate.prepare(() => Promise.reject(error)), value => value === error);
  f.updateVisibility(); f.draw(16);
  assert.equal(f.records.frames.length, 0); assert.equal(f.records.updates.length, 0);
  assert.equal(gate.canDraw(true, false), false);
});

test('late completion after cancellation or fallback cannot make a scene drawable and duplicate callers share preparation', async () => {
  for (const stop of ['cancel', 'fail']) {
    const gate = createScenePreparationGate(), waiting = deferred(); let calls = 0;
    const pending = gate.prepare(() => {calls++; return waiting.promise;});
    assert.equal(gate.prepare(() => {calls++; return Promise.resolve();}), pending);
    gate[stop](); waiting.resolve();
    assert.equal(await pending, false); assert.equal(calls, 1); assert.equal(gate.canDraw(true, false), false);
  }
  const gate = createScenePreparationGate(); gate.cancel();
  assert.equal(await gate.prepare(() => {throw new Error('cancelled preparation must not run');}), false);
});

const disposeSource = sourceNode('src/components/experience/engines/hero.ts', 'function', 'dispose');
for (const outcome of ['resolve', 'reject']) {
  test('actual hero disposal cancels listeners immediately and waits for pending shader polling to ' + outcome + ' before one GPU cleanup', async () => {
    const pending = deferred(), records = {interaction: 0, listeners: 0, gpu: []};
    const gpu = name => () => records.gpu.push(name);
    const dispose = runInNewContext(ts.transpileModule(`(() => {
      let disposed = false; const preparationTask = pending.promise;
      ${disposeSource}
      return dispose;
    })()`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText, {
      pending, endPointer: () => records.interaction++, observer: {disconnect: () => records.listeners++},
      listeners: [() => records.listeners++], agentElement: null,
      bodies: [{group: {}, tooth: {dispose: gpu('tooth')}}], scene: {remove: gpu('remove')},
      water: {dispose: gpu('water')}, backdrop: {dispose: gpu('backdrop')}, environment: {dispose: gpu('environment')},
      key: {shadow: {dispose: gpu('shadow')}}, renderer: {dispose: gpu('renderer'), forceContextLoss: gpu('context')},
    });
    dispose(); dispose();
    assert.equal(records.interaction, 1); assert.equal(records.listeners, 2); assert.deepEqual(records.gpu, []);
    pending[outcome](outcome === 'reject' ? new Error('shader failed') : undefined); await turn();
    assert.deepEqual(records.gpu, ['remove', 'tooth', 'water', 'backdrop', 'environment', 'shadow', 'renderer', 'context']);
    dispose(); await turn(); assert.equal(records.gpu.length, 8);
  });
}
