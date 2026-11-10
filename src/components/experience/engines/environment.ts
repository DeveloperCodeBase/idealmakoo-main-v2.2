import * as THREE from 'three';
import { CoastalHDRLoader, COASTAL_HDR_URL } from './coastal-hdr';
import { COASTAL_SKY_GLSL, SKY_GLSL } from './ocean-math';

/** Immediate local sky, upgraded asynchronously to the bundled CC0 coastal HDRI. */
export function createCoastalEnvironment(renderer: THREE.WebGLRenderer, onReady?: (texture: THREE.Texture) => void, suppliedFallback?: THREE.Texture) {
  let disposed = false, loaded = false;
  const generator = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(22, 32, 16);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, toneMapped: false,
    vertexShader: 'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vDirection;${SKY_GLSL}\nvoid main(){gl_FragColor=vec4(skyRadiance(normalize(vDirection),1.0),1.0);}`,
  });
  skyScene.add(new THREE.Mesh(geometry, skyMaterial));
  const fallback = suppliedFallback ? null : generator.fromScene(skyScene, .025, .1, 45);
  geometry.dispose(); skyMaterial.dispose();
  let target: THREE.WebGLRenderTarget | null = null;
  let source: THREE.DataTexture | null = null;
  const sunDirection = new THREE.Vector3(-.46, .72, .45).normalize();
  generator.compileEquirectangularShader();
  new CoastalHDRLoader().load(COASTAL_HDR_URL, (texture) => {
    if (disposed) { texture.dispose(); return; }
    try {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const result = generator.fromEquirectangular(texture);
      if (disposed) { result.dispose(); texture.dispose(); return; }
      source = texture; target = result; loaded = true;
      // Align the cast-shadow light and water glint with the HDR's actual sun.
      const { data, width, height } = texture.image;
      let peak = 0, peakX = 0, peakY = 0;
      for (let y = 0; y < height / 2; y++) for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const channel = (offset: number) => texture.type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(data[index + offset]) : data[index + offset];
        const luminance = channel(0) * .2126 + channel(1) * .7152 + channel(2) * .0722;
        if (luminance > peak) { peak = luminance; peakX = x; peakY = y; }
      }
      if (peak > 0) {
        const longitude = ((peakX + .5) / width - .5) * Math.PI * 2, latitude = (.5 - (peakY + .5) / height) * Math.PI;
        sunDirection.set(Math.cos(longitude) * Math.cos(latitude), Math.sin(latitude), Math.sin(longitude) * Math.cos(latitude)).normalize();
      }
      onReady?.(result.texture);
    } catch { texture.dispose(); }
  }, undefined, () => { /* The procedural reflection remains usable offline. */ });
  return {
    get texture() { return target?.texture || suppliedFallback || fallback!.texture; },
    get sourceTexture() { return source; },
    get loaded() { return loaded; },
    get sunDirection() { return sunDirection; },
    dispose() { if (disposed) return; disposed = true; target?.dispose(); source?.dispose(); fallback?.dispose(); generator.dispose(); },
  };
}

/** The same actual sky surrounds the open-water stage in both theme modes. */
export function createCoastalBackdrop(scene: THREE.Scene, theme: 'light' | 'dark') {
  const geometry = new THREE.SphereGeometry(135, 40, 24);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uLight: { value: theme === 'light' ? 1 : 0 }, uSkyTexture: { value: null }, uHasSky: { value: 0 } },
    vertexShader: `varying vec3 vSkyDirection;
      void main(){vSkyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vSkyDirection;uniform float uLight;
      ${SKY_GLSL}
      ${COASTAL_SKY_GLSL}
      void main(){
        gl_FragColor=vec4(coastalRadiance(normalize(vSkyDirection),uLight),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'Coastal sky above open water'; mesh.renderOrder = -1000;
  mesh.frustumCulled = false; scene.add(mesh);
  let light = material.uniforms.uLight.value as number, targetLight = light, disposed = false;
  return {
    update(camera: THREE.Camera, delta: number) {
      if (disposed) return;
      mesh.position.copy(camera.position);
      light += (targetLight - light) * (1 - Math.exp(-4 * Math.min(delta, .15)));
      material.uniforms.uLight.value = light;
    },
    setTheme(value: string) { targetLight = value === 'light' ? 1 : 0; },
    setSkyTexture(texture: THREE.Texture | null) { material.uniforms.uSkyTexture.value = texture; material.uniforms.uHasSky.value = texture ? 1 : 0; },
    dispose() { if (disposed) return; disposed = true; scene.remove(mesh); geometry.dispose(); material.dispose(); },
  };
}
