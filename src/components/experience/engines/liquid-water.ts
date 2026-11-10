import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { addOceanImpulse, COASTAL_SKY_GLSL, MAX_OCEAN_IMPULSES, OCEAN_GLSL, sampleOcean, SKY_GLSL, type OceanImpulse } from './ocean-math';

/** The supplied Reflector pipeline with shared, asymmetric open-water swells. */
export function createLiquidWater(renderer: THREE.WebGLRenderer, scene: THREE.Scene, { size = 160, resolution = 168 } = {}) {
  const shader = {
    name: 'IdealMakooOpenOcean',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {
      color: { value: new THREE.Color(0x102d36) }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() },
      uOceanTime: { value: 0 }, uSwell: { value: 1 }, uLight: { value: 0 },
      uImpulse: { value: Array.from({ length: MAX_OCEAN_IMPULSES }, () => new THREE.Vector4(0, 0, -100, 0)) },
      uImpulseShape: { value: Array.from({ length: MAX_OCEAN_IMPULSES }, () => new THREE.Vector2(.32, 0)) },
      uReflectionTexel: { value: new THREE.Vector2(1 / 1024, 1 / 640) },
      uSkyTexture: { value: null }, uHasSky: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(-.46, .72, .45).normalize() },
    }]),
    vertexShader: `
      #include <common>
      #include <shadowmap_pars_vertex>
      uniform mat4 textureMatrix;
      varying vec4 vReflection;
      varying vec3 vOceanWorld;
      ${OCEAN_GLSL}
      void main() {
        vec4 flatWorld = modelMatrix * vec4(position,1.0);
        vec3 surface = oceanSurface(flatWorld.xz);
        vec3 displaced = position;
        displaced.z += surface.x;
        vec4 worldPosition = modelMatrix * vec4(displaced,1.0);
        vOceanWorld = worldPosition.xyz;
        vReflection = textureMatrix * vec4(displaced,1.0);
        vec3 transformedNormal = mat3(viewMatrix) * normalize(vec3(-surface.y,1.0,-surface.z));
        #include <shadowmap_vertex>
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      #include <common>
      #include <packing>
      #include <shadowmap_pars_fragment>
      uniform bool receiveShadow;
      #include <shadowmask_pars_fragment>
      uniform sampler2D tDiffuse;
      uniform float uLight;
      uniform vec2 uReflectionTexel;
      uniform vec3 uSunDirection;
      varying vec4 vReflection;
      varying vec3 vOceanWorld;
      ${OCEAN_GLSL}
      ${SKY_GLSL}
      ${COASTAL_SKY_GLSL}
      void main() {
        vec2 p = vOceanWorld.xz;
        vec3 surface = oceanSurface(p);
        // Directional capillary normals are band-limited in screen space. They
        // provide moving glints nearby without shimmering at the horizon.
        float footprint = max(length(dFdx(p)),length(dFdy(p)));
        float detail = (1.0-smoothstep(0.025,0.13,footprint))*uSwell;
        vec2 wind = vec2(dot(p,vec2(0.948683,-0.316228)),dot(p,vec2(0.316228,0.948683)));
        float phaseA=wind.x*38.0+wind.y*9.0-uOceanTime*19.3;
        float phaseB=wind.x*69.0-wind.y*23.0-uOceanTime*26.9;
        float phaseC=wind.x*113.0+wind.y*41.0-uOceanTime*35.0;
        vec2 windSlope=vec2(cos(phaseA)*0.033+cos(phaseB)*0.018+cos(phaseC)*0.008,
          cos(phaseA)*0.0078-cos(phaseB)*0.0060+cos(phaseC)*0.0029);
        vec2 capillary=vec2(0.948683*windSlope.x+0.316228*windSlope.y,-0.316228*windSlope.x+0.948683*windSlope.y)*detail;
        vec3 n = normalize(vec3(-surface.y-capillary.x,1.0,-surface.z-capillary.y));
        vec3 view = normalize(cameraPosition-vOceanWorld);
        float cosine = clamp(dot(n,view),0.001,1.0);
        vec3 sky = coastalRadiance(reflect(-view,n),uLight);
        vec2 screen = vReflection.xy/max(vReflection.w,0.0001);
        vec2 reflectionUv = clamp(screen+vec2(n.x,-n.z)*(0.019/(0.35+cosine)),vec2(0.001),vec2(0.999));
        vec2 blur=uReflectionTexel*vec2(0.85,0.55)*(1.0+footprint*5.0);
        vec4 mirror = texture2D(tDiffuse,reflectionUv)*0.70;
        mirror += texture2D(tDiffuse,clamp(reflectionUv+blur,vec2(0.001),vec2(0.999)))*0.15;
        mirror += texture2D(tDiffuse,clamp(reflectionUv-blur,vec2(0.001),vec2(0.999)))*0.15;
        float inFrame = smoothstep(0.0,0.025,screen.x)*smoothstep(0.0,0.025,screen.y)*smoothstep(0.0,0.025,1.0-screen.x)*smoothstep(0.0,0.025,1.0-screen.y);
        vec3 reflection = mix(sky,mirror.rgb,clamp(mirror.a*inFrame,0.0,1.0));
        // Open-water optical path: no imaginary shallow seabed or cyan tint.
        float fresnel = 0.02037 + 0.97963*pow(1.0-cosine,5.0);
        float distanceToEye=length(cameraPosition-vOceanWorld);
        float depth=(1.05+min(distanceToEye*0.043,2.3))/max(cosine,0.17);
        vec3 extinction=exp(-vec3(0.51,0.095,0.061)*depth);
        vec3 deep=mix(vec3(0.004,0.020,0.026),vec3(0.009,0.052,0.068),uLight);
        vec3 bodyScatter=mix(vec3(0.010,0.043,0.044),vec3(0.019,0.094,0.089),uLight);
        vec3 transmitted=deep*(1.0-extinction)+bodyScatter*extinction;
        float shadow = getShadowMask();
        transmitted *= mix(0.36,1.0,shadow);
        vec3 light = normalize(uSunDirection);
        vec3 halfVector = normalize(light+view);
        float normalLight=max(dot(n,light),0.0), normalHalf=max(dot(n,halfVector),0.0);
        float roughness=0.105+smoothstep(0.035,0.22,footprint)*0.17;
        float alpha2=pow(roughness,4.0);
        float denominator=normalHalf*normalHalf*(alpha2-1.0)+1.0;
        float distribution=alpha2/(3.14159265*denominator*denominator);
        float k=pow(roughness+1.0,2.0)*0.125;
        float geometry=(cosine/(cosine*(1.0-k)+k))*(normalLight/(normalLight*(1.0-k)+k));
        float sunSpecular=distribution*geometry*0.02037/max(4.0*cosine,0.08);
        vec3 color = mix(transmitted,reflection,fresnel);
        color += vec3(1.0,0.965,0.88)*min(sunSpecular,8.0)*mix(0.72,1.05,uLight)*shadow;
        // Sparse, broken crest flecks and short-lived impact foam. Foam advects
        // with a packet; it is not a stationary ring or a permanent white grid.
        vec2 flow=p-vec2(0.23,-0.077)*uOceanTime;
        float flecks=smoothstep(0.67,0.87,skyNoise(flow*26.0+skyNoise(flow*3.0)));
        float breaking=smoothstep(0.115,0.175,surface.x)*smoothstep(0.055,0.15,length(surface.yz));
        float foam=breaking*flecks*0.21*uSwell;
        for(int i=0;i<${MAX_OCEAN_IMPULSES};i++){
          float age=uOceanTime-uImpulse[i].z;
          if(age>0.04 && age<1.9 && abs(uImpulse[i].w)>0.055){
            float r=length(p-uImpulse[i].xy);
            float front=exp(-pow((r-age*1.85)/(0.11+age*0.045),2.0));
            float lifetime=smoothstep(0.04,0.15,age)*(1.0-smoothstep(0.65,1.9,age));
            foam+=front*lifetime*flecks*abs(uImpulse[i].w)*1.5;
          }
        }
        color=mix(color,mix(vec3(0.30,0.33,0.33),vec3(0.62,0.65,0.62),uLight),clamp(foam,0.0,0.34));
        float haze=1.0-exp(-pow(distanceToEye/74.0,2.0));
        color=mix(color,coastalRadiance(vec3(-view.x,0.048,-view.z),uLight)*0.88,haze);
        float opacity=mix(0.84,0.99,clamp(fresnel+haze,0.0,1.0));
        gl_FragColor = vec4(color,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
  // Concentrate finite geometry where teeth and hands disturb the surface;
  // distant open water reaches the horizon without a visible square edge.
  const geometry = new THREE.PlaneGeometry(size, size, resolution, resolution);
  const positions = geometry.attributes.position;
  const expand = (coordinate: number) => Math.sign(coordinate) * (Math.expm1(Math.abs(coordinate) / (size / 2) * 3.3) / Math.expm1(3.3)) * size / 2;
  for (let i = 0; i < positions.count; i++) { positions.setX(i, expand(positions.getX(i))); positions.setY(i, expand(positions.getY(i))); }
  geometry.computeBoundingSphere();
  const water = new Reflector(geometry, { textureWidth: 1024, textureHeight: 640, clipBias: .003, multisample: 0, shader });
  water.rotation.x = -Math.PI / 2; water.name = 'Deep open ocean with directional chop and enamel reflections'; water.receiveShadow = true;
  const material = water.material as THREE.ShaderMaterial;
  material.transparent = true; material.depthWrite = false; material.lights = true;
  scene.add(water);
  const reflect = water.onBeforeRender;
  let capture = false, reflectionDue = true, lastReflection = -1;
  water.onBeforeRender = function (activeRenderer, ...args) {
    if (capture || activeRenderer.getRenderTarget() !== null || !reflectionDue) return;
    capture = true;
    try { reflect.call(this, activeRenderer, ...args); reflectionDue = false; }
    finally { capture = false; }
  };
  let time = 0, reduced = false, light = 0, targetLight = 0, disposed = false, waveCount = 0;
  let impulses: OceanImpulse[] = [];
  let lastImpulse: { x: number; z: number; source: string; time: number } | null = null;
  function ripple(x: number, z: number, strength = 1, radius = .32, source = 'pointer') {
    if (disposed || Math.abs(x) > 15 || Math.abs(z) > 15) return;
    impulses = addOceanImpulse(impulses, { x, z, startedAt: time, amplitude: strength * .056, radius }, time);
    waveCount++; lastImpulse = { x, z, source, time };
  }
  function update(now: number, dt: number, _objects?: readonly THREE.Vector3[], _accent?: THREE.Color) {
    if (disposed) return;
    time = now; impulses = impulses.filter(impulse => time - impulse.startedAt < 7);
    light += (targetLight - light) * (1 - Math.exp(-4 * Math.min(dt, .15)));
    material.uniforms.uLight.value = light; material.uniforms.uOceanTime.value = time; material.uniforms.uSwell.value = reduced ? 0 : 1;
    for (let i = 0; i < MAX_OCEAN_IMPULSES; i++) {
      const impulse = impulses[i];
      (material.uniforms.uImpulse.value[i] as THREE.Vector4).set(impulse?.x || 0, impulse?.z || 0, impulse?.startedAt ?? -100, impulse?.amplitude || 0);
      (material.uniforms.uImpulseShape.value[i] as THREE.Vector2).set(impulse?.radius || .32, 0);
    }
    if (now - lastReflection > (reduced ? .095 : 1 / 40)) { reflectionDue = true; lastReflection = now; }
  }
  function resize(width: number, height: number) {
    const w = Math.max(128, Math.min(1280, Math.round(width * .80))), h = Math.max(128, Math.min(800, Math.round(height * .86)));
    water.getRenderTarget().setSize(w, h); material.uniforms.uReflectionTexel.value.set(1 / w, 1 / h); reflectionDue = true;
  }
  function dispose() { if (disposed) return; disposed = true; scene.remove(water); water.dispose(); geometry.dispose(); impulses = []; }
  return {
    mesh: water, ripple, update, resize, dispose,
    sample: (x: number, z: number, at = time) => sampleOcean(x, z, at, impulses, reduced ? 0 : 1),
    setTheme(value: string) { targetLight = value === 'light' ? 1 : 0; if (time === 0) light = targetLight; reflectionDue = true; },
    setReducedMotion(value: boolean) { reduced = value; reflectionDue = true; },
    setSkyTexture(texture: THREE.Texture | null) { material.uniforms.uSkyTexture.value = texture; material.uniforms.uHasSky.value = texture ? 1 : 0; reflectionDue = true; },
    setSunDirection(direction: THREE.Vector3) { material.uniforms.uSunDirection.value.copy(direction).normalize(); reflectionDue = true; },
    getState: () => ({ waveCount, lastImpulse, pending: impulses.length, resolution, size, simulation: 'shared-asymmetric-gravity-spectrum-with-bounded-impact-foam', reducedMotion: reduced }),
  };
}
