// @ts-nocheck
// Original procedural Luma tooth scene from the user-supplied login archive.
// Typed lifecycle, interaction and privacy boundary lives in ToothExperience.tsx.
import * as THREE from 'three';

/**
 * An entirely procedural 3D enamel mascot. No model, image or network request is
 * needed: the crown, roots, eyes, studio environment and glints are built here.
 * Pointer coordinates are -1..1, with positive Y pointing up. setOrbit accepts
 * yaw/pitch in radians; resetOrbit eases back to the presentation angle.
 */
export function createToothScene(canvas, options = {}) {
  const platform = options.platform;
  const createCanvas2D = () => platform ? platform.createCanvas2D() : document.createElement('canvas');
  const pageHidden = () => platform ? platform.hidden() : document.hidden;
  const noop = () => {};
  const unavailable = {
    supported: false,
    setPointer: noop, setMode: noop, setPrivacy: noop, celebrate: noop,
    setReducedMotion: noop, setTheme: noop, setOrbit: noop, resetOrbit: noop,
    resize: noop, destroy: noop,
  };
  let renderer;
  const reportError = (error) => {
    if (typeof options.onError === 'function') options.onError(error);
  };

  try {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new TypeError('A canvas element is required for the tooth scene.');
    }
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
  } catch (error) {
    reportError(error);
    return unavailable;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = options.theme === 'light' ? 0.96 : 1.045;
  const resources = new Set();
  const own = (resource) => { resources.add(resource); return resource; };
  const mesh = (geometry, material, parent = scene) => {
    const object = new THREE.Mesh(own(geometry), own(material));
    parent.add(object);
    return object;
  };
  let environmentTarget = null;

  try {
    const environment = own(makeStudioEnvironment(createCanvas2D));
    const generator = new THREE.PMREMGenerator(renderer);
    environmentTarget = generator.fromEquirectangular(environment);
    scene.environment = environmentTarget.texture;
    generator.dispose();
    environment.dispose();
    resources.delete(environment);
  } catch (_) {
    // Direct studio lighting still produces a complete scene on constrained GPUs.
  }

  const hemisphere = new THREE.HemisphereLight(0xf6f8ff, 0x5e7189, 1.2);
  scene.add(hemisphere);
  const studioLight = (color, intensity, x, y, z) => {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(x, y, z);
    scene.add(light);
    return light;
  };
  const keyLight = studioLight(0xfff7e9, 2.9, -3.5, 5.5, 5);
  const fillLight = studioLight(0xd8edff, 0.85, 4, 1.8, 5);
  const cyanRim = studioLight(0x7eeaf1, 2.05, -4, 1.6, -3.5);
  const violetRim = studioLight(0xb7a6f4, 1.75, 4, 2, -3);
  const bounceLight = studioLight(0xf9f7f1, 0.3, 0, -2, 4);

  const mascot = new THREE.Group();
  scene.add(mascot);
  const enamel = own(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.205,
    clearcoat: 0.87, clearcoatRoughness: 0.115, ior: 1.52,
    reflectivity: 0.59, envMapIntensity: 0.88,
    sheen: 0.075, sheenColor: new THREE.Color(0xecf0ff), sheenRoughness: 0.5,
  }));
  addEnamelMicrostructure(enamel);
  // A single watertight, smoothly shaded surface joins the four cusps and roots.
  const tooth = mesh(makeToothGeometry(), enamel, mascot);
  tooth.name = 'Continuous enamel molar';

  const porcelain = own(enamel.clone());
  porcelain.vertexColors = false;
  porcelain.color.set(0xfffcf7);
  porcelain.roughness = 0.245;
  const eyeWhite = own(new THREE.MeshPhysicalMaterial({
    color: 0xfbfcff, roughness: 0.19, metalness: 0,
    clearcoat: 0.92, clearcoatRoughness: 0.075, envMapIntensity: 0.66,
  }));
  const irisTexture = own(makeIrisTexture(createCanvas2D));
  const irisMaterial = own(new THREE.MeshPhysicalMaterial({
    map: irisTexture, color: 0xffffff, roughness: 0.22,
    clearcoat: 1, clearcoatRoughness: 0.065, envMapIntensity: 0.48,
  }));
  const pupilMaterial = own(new THREE.MeshPhysicalMaterial({
    color: 0x010914, roughness: 0.125, clearcoat: 1,
    clearcoatRoughness: 0.065, envMapIntensity: 0.48,
  }));
  const ink = own(new THREE.MeshStandardMaterial({
    color: 0x263b4f, roughness: 0.56, envMapIntensity: 0.2,
  }));
  const highlight = own(new THREE.MeshBasicMaterial({color: 0xffffff, toneMapped: false}));
  const sphere = own(new THREE.SphereGeometry(1, 48, 32));
  const littleSphere = own(new THREE.SphereGeometry(1, 20, 14));
  const eyes = [];

  for (const side of [-1, 1]) {
    const holder = new THREE.Group();
    const eyeX = side * 0.385;
    holder.name = side < 0 ? 'Left eye' : 'Right eye';
    holder.position.set(eyeX, 0.69, frontSurface(eyeX, 0.69) - 0.029);
    holder.rotation.y = side * 0.07;
    mascot.add(holder);
    const openPart = new THREE.Group();
    holder.add(openPart);
    const white = mesh(sphere, eyeWhite, openPart);
    white.name = 'Porcelain sclera';
    white.scale.set(0.263, 0.301, 0.198);
    const gaze = new THREE.Group();
    openPart.add(gaze);
    const iris = mesh(makeLensGeometry(0.149, 0.033), irisMaterial, gaze);
    iris.name = 'Convex radial iris';
    iris.position.z = 0.175;
    const pupil = mesh(makeLensGeometry(0.067, 0.009), pupilMaterial, gaze);
    pupil.name = 'Deep pupil';
    pupil.position.z = 0.204;
    const glint = mesh(littleSphere, highlight, gaze);
    glint.name = 'Softbox catchlight';
    glint.scale.set(0.021, 0.034, 0.006);
    glint.rotation.z = -0.34;
    glint.position.set(-0.036, 0.044, 0.215);
    const secondaryGlint = mesh(littleSphere, highlight, gaze);
    secondaryGlint.scale.set(0.009, 0.012, 0.004);
    secondaryGlint.position.set(0.051, -0.026, 0.214);
    const lidCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.202, 0.018, 0.174),
      new THREE.Vector3(-0.105, -0.023, 0.197),
      new THREE.Vector3(0, -0.04, 0.211),
      new THREE.Vector3(0.105, -0.023, 0.197),
      new THREE.Vector3(0.202, 0.018, 0.174),
    ]);
    const lid = mesh(new THREE.TubeGeometry(lidCurve, 24, 0.013, 7, false), ink, holder);
    lid.visible = false;
    eyes.push({holder, openPart, gaze, lid});
  }

  const smilePoints = [-1, -0.5, 0, 0.5, 1].map((t) => {
    const x = t * 0.137;
    const y = 0.22 + t * t * 0.054;
    return new THREE.Vector3(x, y, frontSurface(x, y) + 0.017);
  });
  const smile = mesh(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(smilePoints), 30, 0.014, 8, false,
  ), ink, mascot);

  const blushMaterial = own(new THREE.MeshPhysicalMaterial({
    color: 0xe4b5e8, roughness: 0.6, transparent: true,
    opacity: 0.12, depthWrite: false, envMapIntensity: 0.15,
  }));
  for (const side of [-1, 1]) {
    const cheek = mesh(littleSphere, blushMaterial, mascot);
    cheek.scale.set(0.098, 0.046, 0.011);
    cheek.position.set(side * 0.70, 0.39, frontSurface(side * 0.70, 0.39) + 0.012);
    cheek.rotation.y = side * 0.56;
  }

  const arms = [];
  const armCylinder = own(new THREE.CylinderGeometry(1, 1, 1, 14));
  const fingerGeometry = own(new THREE.CapsuleGeometry(0.061, 0.057, 5, 14));
  for (const side of [-1, 1]) {
    const upper = mesh(armCylinder, porcelain, mascot);
    const lower = mesh(armCylinder, porcelain, mascot);
    const elbowMesh = mesh(littleSphere, porcelain, mascot);
    elbowMesh.scale.setScalar(0.073);
    const hand = new THREE.Group();
    hand.name = side < 0 ? 'Left privacy hand' : 'Right privacy hand';
    mascot.add(hand);
    const palm = mesh(sphere, porcelain, hand);
    palm.scale.set(0.204, 0.199, 0.106);
    for (let i = -1; i <= 1; i++) {
      const finger = mesh(fingerGeometry, porcelain, hand);
      finger.position.set(i * 0.103, 0.163 - Math.abs(i) * 0.022, 0.008);
      finger.rotation.z = -i * 0.11;
    }
    const thumb = mesh(littleSphere, porcelain, hand);
    thumb.scale.set(0.082, 0.112, 0.078);
    thumb.position.set(-side * 0.168, -0.006, 0.018);
    thumb.rotation.z = side * 0.4;
    arms.push({
      side, upper, lower, elbowMesh, hand,
      shoulder: new THREE.Vector3(side * 0.865, 0.17, 0.01),
      elbow: new THREE.Vector3(), wrist: new THREE.Vector3(),
    });
  }

  const ground = new THREE.Group();
  ground.position.set(0, -1.995, -0.38);
  ground.scale.setScalar(0.88);
  scene.add(ground);
  const shadowTexture = own(makeGlowTexture('shadow', createCanvas2D));
  const shadowMaterial = own(new THREE.MeshBasicMaterial({
    map: shadowTexture, transparent: true, opacity: 0.56,
    depthWrite: false, toneMapped: false,
  }));
  const shadow = mesh(new THREE.PlaneGeometry(4, 4), shadowMaterial, ground);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.015;
  const ringMaterial = own(new THREE.MeshBasicMaterial({
    color: 0x6ce8ed, transparent: true, opacity: 0.7,
    toneMapped: false, depthWrite: false,
  }));
  const ring = mesh(new THREE.TorusGeometry(1.38, 0.010, 8, 128), ringMaterial, ground);
  ring.rotation.x = Math.PI / 2;
  const outerRingMaterial = own(new THREE.MeshBasicMaterial({
    color: 0xb69cff, transparent: true, opacity: 0.28,
    toneMapped: false, depthWrite: false,
  }));
  const outerRing = mesh(new THREE.TorusGeometry(1.52, 0.0055, 6, 128), outerRingMaterial, ground);
  outerRing.rotation.x = Math.PI / 2;
  const ringAccent = mesh(new THREE.TorusGeometry(1.395, 0.019, 8, 42, Math.PI * 0.27),
    own(new THREE.MeshBasicMaterial({color: 0xc8ffff, toneMapped: false})), ground);
  ringAccent.rotation.x = Math.PI / 2;
  ringAccent.position.y = 0.006;

  const sparkleTexture = own(makeGlowTexture('sparkle', createCanvas2D));
  const sparkles = [];
  const sparklePositions = [
    [-1.31, 1.12, 0.0, 0.15], [1.28, 1.38, -0.3, 0.12],
    [1.34, -0.48, 0.1, 0.11], [-1.15, -1.24, 0.1, 0.09],
    [0.9, -1.55, 0.35, 0.08],
  ];
  for (let i = 0; i < sparklePositions.length; i++) {
    const [x, y, z, size] = sparklePositions[i];
    const material = own(new THREE.SpriteMaterial({
      map: sparkleTexture, color: i % 2 ? 0xc8b6ff : 0xb8ffff,
      transparent: true, opacity: 0.75, depthWrite: false,
      toneMapped: false, blending: THREE.AdditiveBlending,
    }));
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(size);
    scene.add(sprite);
    sparkles.push({sprite, material, size, y});
  }

  const burstGeometry = own(new THREE.BufferGeometry());
  const burstPositions = new Float32Array(27 * 3);
  burstGeometry.setAttribute('position', new THREE.BufferAttribute(burstPositions, 3));
  const burstMaterial = own(new THREE.PointsMaterial({
    size: 0.095, map: sparkleTexture, color: 0xa9fff9,
    transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  const burst = new THREE.Points(burstGeometry, burstMaterial);
  burst.frustumCulled = false;
  burst.visible = false;
  scene.add(burst);

  let disposed = false;
  let contextLost = false;
  let reducedMotion = Boolean(options.reducedMotion);
  let viewVisible = true;
  let visible = !pageHidden();
  let firstFrame = true;
  let frameId = 0;
  let lastNow = 0;
  let elapsed = 0;
  let privacyTarget = 0;
  let privacy = 0;
  let modeTarget = 0;
  let modeAmount = 0;
  let celebrationAge = 5;
  let blinkAge = 1;
  let nextBlink = 2.4;
  let sparkleEnergy = 0;
  let themeTarget = options.theme === 'light' ? 1 : 0;
  let themeAmount = themeTarget;
  const pointerTarget = new THREE.Vector2();
  const pointer = new THREE.Vector2();
  const orbitTarget = new THREE.Vector2();
  const orbit = new THREE.Vector2();
  const armDirection = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const colorCyan = new THREE.Color(0x6ce8ed);
  const colorLilac = new THREE.Color(0xb7a0ff);
  const lightRingColor = new THREE.Color(0x168e9d);
  const lightOuterColor = new THREE.Color(0x8570b3);

  function positionLimb(limb, a, b, radius) {
    armDirection.subVectors(b, a);
    const length = armDirection.length();
    limb.position.copy(a).add(b).multiplyScalar(0.5);
    limb.scale.set(radius, length, radius);
    limb.quaternion.setFromUnitVectors(up, armDirection.multiplyScalar(1 / Math.max(length, 0.001)));
  }

  function draw(now = performance.now()) {
    frameId = 0;
    if (disposed || !visible || contextLost) return;
    const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.05) : 1 / 60;
    lastNow = now;
    if (!reducedMotion) elapsed += dt;
    const follow = reducedMotion ? 1 : 1 - Math.exp(-dt * 7.2);
    const handFollow = reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
    pointer.lerp(pointerTarget, follow);
    orbit.lerp(orbitTarget, follow);
    privacy += (privacyTarget - privacy) * handFollow;
    modeAmount += (modeTarget - modeAmount) * follow;
    themeAmount += (themeTarget - themeAmount) * follow;
    sparkleEnergy *= Math.exp(-dt * 1.5);
    celebrationAge += dt;
    const happy = !reducedMotion && celebrationAge < 1.7
      ? Math.sin(Math.min(celebrationAge / 1.7, 1) * Math.PI) : 0;

    mascot.position.y = reducedMotion ? 0 : Math.sin(elapsed * 1.25) * 0.045 + happy * 0.095;
    mascot.rotation.y = THREE.MathUtils.clamp(-0.10 + orbit.x
      + pointer.x * 0.12 * (1 - privacy * 0.48), -0.65, 0.61);
    mascot.rotation.x = orbit.y - pointer.y * 0.065 + 0.10
      + (happy ? Math.sin(celebrationAge * 13) * happy * 0.1 : 0);
    mascot.rotation.z = (modeAmount - 0.5) * 0.035
      + (reducedMotion ? 0 : Math.sin(elapsed * 0.75) * 0.011)
      - pointer.x * 0.012;

    if (!reducedMotion && privacy < 0.1) {
      nextBlink -= dt;
      if (nextBlink <= 0) {
        blinkAge = 0;
        nextBlink = 3.1 + Math.random() * 2.8;
      }
    }
    blinkAge += dt;
    const blink = !reducedMotion && blinkAge < 0.19
      ? Math.sin((blinkAge / 0.19) * Math.PI) ** 1.4 : 0;
    const eyeOpening = Math.max(0.025, (1 - blink) * (1 - privacy));
    for (const eye of eyes) {
      eye.openPart.scale.y = eyeOpening;
      eye.openPart.visible = eyeOpening > 0.055;
      eye.lid.visible = eyeOpening < 0.15;
      // The sclera and its corneal caps share the optical rotation. This keeps
      // every iris edge above the eye surface even at the maximum gaze angle.
      eye.openPart.rotation.y = (pointer.x * 0.265 - orbit.x * 0.16) * (1 - privacy);
      eye.openPart.rotation.x = (-pointer.y * 0.225 - orbit.y * 0.12) * (1 - privacy);
    }

    for (const arm of arms) {
      const s = arm.side;
      arm.elbow.set(s * (1.09 - privacy * 0.17), -0.105 + privacy * 0.42, 0.08 + privacy * 0.48);
      arm.wrist.set(s * (1.035 - privacy * 0.65), -0.305 + privacy * 0.92, 0.345 + privacy * 0.67);
      if (!reducedMotion) arm.wrist.y += Math.sin(elapsed * 1.5 + s * 0.3) * 0.014 * (1 - privacy);
      positionLimb(arm.upper, arm.shoulder, arm.elbow, 0.065);
      positionLimb(arm.lower, arm.elbow, arm.wrist, 0.072);
      arm.elbowMesh.position.copy(arm.elbow);
      arm.hand.position.copy(arm.wrist);
      arm.hand.rotation.set(-0.12 * (1 - privacy), -s * 0.1 * privacy, s * (0.18 - privacy * 0.26));
      arm.hand.scale.setScalar(0.83 + privacy * 0.30);
    }
    smile.scale.x = 1 + happy * 0.15 + modeAmount * 0.06;
    // Neutral daylight creates definition on a pearl canvas; colored edge light
    // and a brighter environment keep the same white enamel luminous at night.
    renderer.toneMappingExposure = 1.045 - themeAmount * 0.085;
    scene.environmentIntensity = 0.91 - themeAmount * 0.15;
    scene.environmentRotation.y = -0.04 + themeAmount * 0.13;
    hemisphere.intensity = 1.20 - themeAmount * 0.24;
    keyLight.intensity = 2.90 - themeAmount * 0.34;
    fillLight.intensity = 0.85 - themeAmount * 0.24;
    cyanRim.intensity = 2.05 - themeAmount * 1.36;
    violetRim.intensity = 1.75 - themeAmount * 1.17;
    bounceLight.intensity = 0.30 + themeAmount * 0.055;
    enamel.roughness = 0.205 + themeAmount * 0.018;
    ringMaterial.color.copy(colorCyan).lerp(colorLilac, modeAmount * 0.55)
      .lerp(lightRingColor, themeAmount * 0.93);
    ringMaterial.opacity = 0.58 + themeAmount * 0.05
      + (reducedMotion ? 0 : Math.sin(elapsed * 1.6) * 0.055) + happy * 0.14;
    outerRingMaterial.color.copy(colorLilac).lerp(lightOuterColor, themeAmount);
    outerRingMaterial.opacity = 0.23 + themeAmount * 0.055;
    ringAccent.material.color.set(0xc8ffff).lerp(lightRingColor, themeAmount * 0.95);
    ringAccent.rotation.z = reducedMotion ? 0.2 : elapsed * 0.13;
    shadowMaterial.opacity = 0.50 + themeAmount * 0.065 - (mascot.position.y + 0.045) * 0.3;
    for (let i = 0; i < sparkles.length; i++) {
      const item = sparkles[i];
      const pulse = reducedMotion ? 0.8 : 0.74 + Math.sin(elapsed * 1.55 + i * 1.9) * 0.24;
      item.sprite.scale.setScalar(item.size * (pulse + sparkleEnergy * 0.23 + happy * 0.5));
      item.material.opacity = 0.34 + pulse * 0.27 + happy * 0.2 - themeAmount * 0.12;
      item.material.blending = themeAmount > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending;
      item.material.color.set(i % 2 ? 0xc8b6ff : 0xb8ffff)
        .lerp(i % 2 ? lightOuterColor : lightRingColor, themeAmount * 0.82);
      item.sprite.position.y = item.y + (reducedMotion ? 0 : Math.sin(elapsed * 0.6 + i) * 0.06);
    }

    const burstProgress = celebrationAge / 1.65;
    burst.visible = !reducedMotion && burstProgress >= 0 && burstProgress < 1;
    if (burst.visible) {
      burstMaterial.opacity = Math.sin(burstProgress * Math.PI) * 0.85;
      for (let i = 0; i < 27; i++) {
        const angle = i * 2.399963;
        const radius = 0.6 + burstProgress * (1.15 + (i % 5) * 0.15);
        burstPositions[i * 3] = Math.cos(angle) * radius;
        burstPositions[i * 3 + 1] = 0.25 + Math.sin(angle) * radius * 0.88
          + burstProgress * 0.45 - burstProgress * burstProgress * 0.5;
        burstPositions[i * 3 + 2] = Math.sin(i * 4.27) * 0.7 + 0.45;
      }
      burstGeometry.attributes.position.needsUpdate = true;
    }
    renderer.render(scene, camera);
    if (firstFrame) { firstFrame = false; options.onFirstFrame?.(); }
    if (!reducedMotion) requestFrame();
  }

  function requestFrame() {
    if (!frameId && !disposed && visible && !contextLost) frameId = requestAnimationFrame(draw);
  }

  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || canvas.parentElement?.clientWidth || 480);
    const height = Math.max(1, rect.height || canvas.parentElement?.clientHeight || 410);
    renderer.setPixelRatio(Math.min((platform ? platform.pixelRatio() : window.devicePixelRatio) || 1, 1.7));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.set(0, 0.91, 6.86 * Math.max(1, 0.80 / camera.aspect));
    camera.lookAt(0, -0.23, 0);
    camera.updateProjectionMatrix();
    requestFrame();
  }

  function onVisibilityChange() {
    visible = viewVisible && !pageHidden();
    lastNow = 0;
    if (!visible) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    } else requestFrame();
  }
  function onContextLost(event) {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(frameId);
    frameId = 0;
    reportError(new Error('The WebGL context was interrupted.'));
  }
  function onContextRestored() {
    contextLost = false;
    lastNow = 0;
    resize();
  }
  const observer = platform ? platform.observeResize(resize) : (typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null);
  observer?.observe?.(canvas);
  if (!platform) {
    window.addEventListener('resize', resize, {passive: true});
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  resize();

  return {
    supported: true,
    setVisible(value) {viewVisible=Boolean(value);onVisibilityChange();},
    setPointer(x, y) {
      if (disposed) return;
      pointerTarget.set(THREE.MathUtils.clamp(Number(x) || 0, -1, 1),
        THREE.MathUtils.clamp(Number(y) || 0, -1, 1));
      sparkleEnergy = Math.min(1, sparkleEnergy + 0.04);
      requestFrame();
    },
    setMode(mode) { modeTarget = mode === 'signup' ? 1 : 0; requestFrame(); },
    setTheme(theme) {
      if (disposed) return;
      themeTarget = theme === 'light' ? 1 : 0;
      requestFrame();
    },
    setOrbit(yaw, pitch) {
      if (disposed) return;
      orbitTarget.set(THREE.MathUtils.clamp(Number(yaw) || 0, -0.55, 0.55),
        THREE.MathUtils.clamp(Number(pitch) || 0, -0.22, 0.22));
      sparkleEnergy = Math.min(1, sparkleEnergy + 0.08);
      requestFrame();
    },
    resetOrbit() { orbitTarget.set(0, 0); requestFrame(); },
    setPrivacy(value) { privacyTarget = value ? 1 : 0; requestFrame(); },
    celebrate() { celebrationAge = 0; sparkleEnergy = 1; requestFrame(); },
    setReducedMotion(value) {
      reducedMotion = Boolean(value);
      blinkAge = 1;
      lastNow = 0;
      requestFrame();
    },
    resize,
    destroy() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      if (!platform) {
        window.removeEventListener('resize', resize);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      scene.clear();
      scene.environment = null;
      for (const resource of resources) resource.dispose?.();
      resources.clear();
      environmentTarget?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

// Smooth signed distances give the crown and curved roots one continuous skin.
function smoothUnion(a, b, amount) {
  const h = Math.max(amount - Math.abs(a - b), 0) / amount;
  return Math.min(a, b) - h * h * amount * 0.25;
}

function ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  x -= cx; y -= cy; z -= cz;
  const xx = x / rx, yy = y / ry, zz = z / rz;
  const k0 = Math.sqrt(xx * xx + yy * yy + zz * zz);
  const k1 = Math.sqrt((xx / rx) ** 2 + (yy / ry) ** 2 + (zz / rz) ** 2);
  return k1 > 0.000001 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}

const ROOTS = [
  [[-0.34, -0.29, 0.018], [-0.42, -0.88, 0.025], [-0.83, -1.41, 0.14], [-0.70, -1.77, 0.19]],
  [[0.33, -0.31, -0.04], [0.43, -0.86, -0.06], [0.72, -1.48, -0.015], [0.58, -1.85, 0.055]],
].map((control, index) => {
  const points = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, u = 1 - t;
    const p = [0, 1, 2].map((axis) => u ** 3 * control[0][axis]
      + 3 * u * u * t * control[1][axis] + 3 * u * t * t * control[2][axis]
      + t ** 3 * control[3][axis]);
    p.push((index ? 0.257 : 0.274) * u * (0.88 + 0.12 * u) + 0.052);
    points.push(p);
  }
  return points;
});

function rootDistance(x, y, z, points) {
  let result = 10;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = (b[2] - a[2]) * 1.11;
    const px = x - a[0], py = y - a[1], pz = (z - a[2]) * 1.11;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz)));
    const distance = Math.sqrt((px - dx * t) ** 2 + (py - dy * t) ** 2 + (pz - dz * t) ** 2)
      - (a[3] + (b[3] - a[3]) * t);
    result = Math.min(result, distance);
  }
  return result;
}

function toothField(x, y, z) {
  // A tapered rounded-square crown gives a molar its broad chewing table and
  // flatter buccal surface. Four unequal cusps grow smoothly from this body.
  let taper = Math.max(0, Math.min(1, (0.50 - y) / 0.85));
  taper = taper * taper * (3 - 2 * taper);
  const qx = Math.abs(x / (1 - taper * 0.18)) - 0.69;
  const qy = Math.abs(y - 0.54) - 0.43;
  const facialConvexity = 1 - 0.17 * Math.min(1.6, (x / 0.98) ** 2)
    - 0.055 * Math.min(1.8, ((y - 0.59) / 0.73) ** 2);
  const qz = Math.abs(z / ((1 - taper * 0.10) * facialConvexity)) - 0.395;
  let field = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2 + Math.max(qz, 0) ** 2)
    + Math.min(Math.max(qx, qy, qz), 0) - 0.28;
  field = smoothUnion(field, ellipsoid(x, y, z, -0.405, 1.18, 0.278, 0.505, 0.405, 0.419), 0.155);
  field = smoothUnion(field, ellipsoid(x, y, z, 0.42, 1.145, 0.26, 0.485, 0.39, 0.403), 0.15);
  field = smoothUnion(field, ellipsoid(x, y, z, -0.385, 1.16, -0.286, 0.46, 0.385, 0.405), 0.15);
  field = smoothUnion(field, ellipsoid(x, y, z, 0.395, 1.13, -0.29, 0.478, 0.398, 0.425), 0.15);
  field = smoothUnion(field, ellipsoid(x, y, z, 0, -0.18, -0.01, 0.665, 0.46, 0.52), 0.225);
  field = smoothUnion(field, rootDistance(x, y, z, ROOTS[0]), 0.195);
  field = smoothUnion(field, rootDistance(x, y, z, ROOTS[1]), 0.195);
  // Gently curved central and transverse fissures stop before the crown edges.
  if (y > 1.16) {
    const top = Math.min(1, (y - 1.16) / 0.23);
    const grooveX = x - 0.028 * Math.sin(z * 7.0);
    const grooveZ = z + 0.023 + 0.022 * Math.sin(x * 6.0);
    field += top * 0.047 * Math.exp(-grooveX * grooveX / 0.0049) * Math.exp(-((z / 0.63) ** 6));
    field += top * 0.043 * Math.exp(-grooveZ * grooveZ / 0.0045) * Math.exp(-((x / 0.74) ** 6));
  }
  return field;
}

function frontSurface(x, y) {
  let lower = 0, upper = 1.15;
  for (let i = 0; i < 20; i++) {
    const middle = (lower + upper) * 0.5;
    if (toothField(x, y, middle) < 0) lower = middle;
    else upper = middle;
  }
  return (lower + upper) * 0.5;
}

function makeToothGeometry() {
  const nx = 57, ny = 83, nz = 45;
  const minX = -1.3, minY = -2.035, minZ = -0.98;
  const stepX = 2.6 / (nx - 1), stepY = 3.82 / (ny - 1), stepZ = 1.96 / (nz - 1);
  const count = nx * ny * nz, plane = nx * ny;
  const field = new Float32Array(count);
  const gradients = new Float32Array(count * 3);
  const coordinates = new Float32Array(count * 3);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = x + y * nx + z * plane;
    const px = minX + x * stepX, py = minY + y * stepY, pz = minZ + z * stepZ;
    field[i] = toothField(px, py, pz);
    coordinates[i * 3] = px; coordinates[i * 3 + 1] = py; coordinates[i * 3 + 2] = pz;
  }
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = x + y * nx + z * plane;
    gradients[i * 3] = (field[i + (x < nx - 1 ? 1 : 0)] - field[i - (x > 0 ? 1 : 0)]) / stepX;
    gradients[i * 3 + 1] = (field[i + (y < ny - 1 ? nx : 0)] - field[i - (y > 0 ? nx : 0)]) / stepY;
    gradients[i * 3 + 2] = (field[i + (z < nz - 1 ? plane : 0)] - field[i - (z > 0 ? plane : 0)]) / stepZ;
  }
  const positions = [], normals = [], indices = [], colors = [];
  const cache = new Map();
  const warm = new THREE.Color(0xf1e7d8), white = new THREE.Color(0xfffdf6), vertexColor = new THREE.Color();
  function edgeVertex(a, b) {
    const key = Math.min(a, b) * count + Math.max(a, b);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const t = field[a] / (field[a] - field[b]);
    const index = positions.length / 3;
    for (let axis = 0; axis < 3; axis++) {
      positions.push(coordinates[a * 3 + axis] + (coordinates[b * 3 + axis] - coordinates[a * 3 + axis]) * t);
    }
    const gx = gradients[a * 3] + (gradients[b * 3] - gradients[a * 3]) * t;
    const gy = gradients[a * 3 + 1] + (gradients[b * 3 + 1] - gradients[a * 3 + 1]) * t;
    const gz = gradients[a * 3 + 2] + (gradients[b * 3 + 2] - gradients[a * 3 + 2]) * t;
    const length = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    normals.push(gx / length, gy / length, gz / length);
    const crownAmount = THREE.MathUtils.smoothstep(positions[index * 3 + 1], -1.4, 0.4);
    vertexColor.copy(warm).lerp(white, crownAmount);
    colors.push(vertexColor.r, vertexColor.g, vertexColor.b);
    cache.set(key, index);
    return index;
  }
  function triangle(a, b, c) {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const dot = cx * normals[a * 3] + cy * normals[a * 3 + 1] + cz * normals[a * 3 + 2];
    if (dot < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  }
  const tetrahedra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
  const cube = new Array(8), inside = [], outside = [];
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const i = x + y * nx + z * plane;
    cube[0] = i; cube[1] = i + 1; cube[2] = i + 1 + nx; cube[3] = i + nx;
    cube[4] = i + plane; cube[5] = i + plane + 1; cube[6] = i + plane + nx + 1; cube[7] = i + plane + nx;
    let negative = 0;
    for (let c = 0; c < 8; c++) if (field[cube[c]] < 0) negative++;
    if (!negative || negative === 8) continue;
    for (const tetra of tetrahedra) {
      inside.length = 0; outside.length = 0;
      for (const c of tetra) (field[cube[c]] < 0 ? inside : outside).push(cube[c]);
      if (inside.length === 1 || inside.length === 3) {
        const single = inside.length === 1 ? inside : outside;
        const other = inside.length === 1 ? outside : inside;
        triangle(edgeVertex(single[0], other[0]), edgeVertex(single[0], other[1]), edgeVertex(single[0], other[2]));
      } else if (inside.length === 2) {
        const a = edgeVertex(inside[0], outside[0]), b = edgeVertex(inside[0], outside[1]);
        const c = edgeVertex(inside[1], outside[0]), d = edgeVertex(inside[1], outside[1]);
        triangle(a, b, c); triangle(b, d, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

function makeLensGeometry(radius, sag) {
  const geometry = new THREE.BufferGeometry();
  // One central vertex prevents the degenerate triangles and pinched normals
  // produced by a polar grid with a repeated zero-radius ring.
  const positions = [0, 0, sag], normals = [0, 0, 1], uvs = [0.5, 0.5], indices = [];
  const rings = 10, segments = 64;
  for (let ring = 1; ring <= rings; ring++) {
    const r = radius * ring / rings;
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
      positions.push(x, y, sag * (1 - (r / radius) ** 2));
      const nx = 2 * sag * x / (radius * radius), ny = 2 * sag * y / (radius * radius);
      const length = Math.sqrt(nx * nx + ny * ny + 1);
      normals.push(nx / length, ny / length, 1 / length);
      uvs.push(x / (radius * 2) + 0.5, y / (radius * 2) + 0.5);
      const current = 1 + (ring - 1) * segments + i;
      const next = 1 + (ring - 1) * segments + (i + 1) % segments;
      if (ring === 1) indices.push(0, current, next);
      else {
        const inner = current - segments, nextInner = next - segments;
        indices.push(inner, current, nextInner, current, next, nextInner);
      }
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function addEnamelMicrostructure(material) {
  // Object-space micro-roughness avoids UV seams on the implicit molar. It only
  // broadens the studio highlights slightly; the surface stays clean and smooth.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEnamelPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEnamelPosition = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying vec3 vEnamelPosition;
      float enamelHash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float enamelNoise(vec3 p) {
        vec3 cell = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = mix(enamelHash(cell), enamelHash(cell + vec3(1,0,0)), f.x);
        float b = mix(enamelHash(cell + vec3(0,1,0)), enamelHash(cell + vec3(1,1,0)), f.x);
        float c = mix(enamelHash(cell + vec3(0,0,1)), enamelHash(cell + vec3(1,0,1)), f.x);
        float d = mix(enamelHash(cell + vec3(0,1,1)), enamelHash(cell + vec3(1,1,1)), f.x);
        return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
      }
    `).replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      float enamelGrain = enamelNoise(vEnamelPosition * 46.0);
      float enamelBody = enamelNoise(vEnamelPosition * 4.5);
      float rootSoftness = 1.0 - smoothstep(-1.55, -0.15, vEnamelPosition.y);
      roughnessFactor = clamp(roughnessFactor + (enamelGrain - 0.5) * 0.024
        + (enamelBody - 0.5) * 0.018 + rootSoftness * 0.052, 0.12, 0.48);
    `);
  };
  material.customProgramCacheKey = () => 'luma-enamel-microstructure-v2';
}

function makeIrisTexture(createCanvas2D) {
  const canvas = createCanvas2D();
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  gradient.addColorStop(0, '#102132');
  gradient.addColorStop(0.36, '#1b425a');
  gradient.addColorStop(0.47, '#347c90');
  gradient.addColorStop(0.67, '#62bcc6');
  gradient.addColorStop(0.84, '#438ba0');
  gradient.addColorStop(0.98, '#17374c');
  gradient.addColorStop(1, '#102335');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  let seed = 23;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 260; i++) {
    const angle = i / 260 * Math.PI * 2;
    const start = 51 + random() * 17, end = 103 + random() * 18;
    ctx.strokeStyle = i % 3 ? `rgba(10, 54, 79, ${0.14 + random() * 0.32})` : 'rgba(172, 246, 245, 0.45)';
    ctx.lineWidth = 0.5 + random() * 1.25;
    ctx.beginPath();
    ctx.moveTo(128 + Math.cos(angle) * start, 128 + Math.sin(angle) * start);
    ctx.quadraticCurveTo(128 + Math.cos(angle + 0.012) * 84, 128 + Math.sin(angle + 0.012) * 84,
      128 + Math.cos(angle + 0.008) * end, 128 + Math.sin(angle + 0.008) * end);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeStudioEnvironment(createCanvas2D) {
  const canvas = createCanvas2D();
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const background = ctx.createLinearGradient(0, 0, 0, 512);
  background.addColorStop(0, '#9298a6');
  background.addColorStop(0.4, '#687383');
  background.addColorStop(0.65, '#475465');
  background.addColorStop(1, '#222e41');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1024, 512);
  function panel(x, y, w, h, color) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 22; ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  panel(58, 79, 131, 182, '#fffaf1');
  panel(208, 104, 17, 142, '#e7effa');
  panel(544, 46, 236, 86, '#fcfcff');
  panel(327, 134, 27, 218, '#cceaf3');
  panel(892, 102, 32, 221, '#d4cced');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

function makeGlowTexture(kind, createCanvas2D) {
  const canvas = createCanvas2D();
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (kind === 'shadow') {
    gradient.addColorStop(0, 'rgba(2, 8, 24, 0.85)');
    gradient.addColorStop(0.34, 'rgba(2, 8, 24, 0.48)');
    gradient.addColorStop(1, 'rgba(2, 8, 24, 0)');
  } else {
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.1, 'rgba(225, 255, 255, 0.8)');
    gradient.addColorStop(0.35, 'rgba(187, 245, 255, 0.12)');
    gradient.addColorStop(1, 'rgba(187, 245, 255, 0)');
  }
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  if (kind !== 'shadow') {
    ctx.fillStyle = 'rgba(245, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.moveTo(64, 8); ctx.quadraticCurveTo(66, 59, 120, 64);
    ctx.quadraticCurveTo(67, 67, 64, 120); ctx.quadraticCurveTo(60, 68, 8, 64);
    ctx.quadraticCurveTo(60, 61, 64, 8); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
