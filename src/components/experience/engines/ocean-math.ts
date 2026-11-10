/** One wave definition is shared by the CPU buoyancy sampler and GPU surface. */
export const SCENE_GRAVITY = 9.81;
export const MAX_OCEAN_IMPULSES = 12;
export interface OceanWave { x: number; z: number; amplitude: number; wavelength: number; phase: number; crest: number }
export interface OceanImpulse { x: number; z: number; startedAt: number; amplitude: number; radius: number }
export interface OceanSample { height: number; dx: number; dz: number; verticalVelocity: number }
export const OCEAN_WAVES: readonly OceanWave[] = [
  { x: .948683, z: -.316228, amplitude: .094, wavelength: 8.6, phase: .3, crest: .19 },
  { x: .393919, z: .919145, amplitude: .047, wavelength: 4.35, phase: 1.7, crest: .16 },
  { x: -.857493, z: .514496, amplitude: .027, wavelength: 2.62, phase: 3.9, crest: .13 },
  { x: .894427, z: .447214, amplitude: .013, wavelength: 1.48, phase: 5.2, crest: .10 },
  { x: -.242536, z: -.970143, amplitude: .0062, wavelength: .79, phase: .8, crest: .07 },
  { x: .707107, z: -.707107, amplitude: .0031, wavelength: .41, phase: 2.5, crest: .04 },
];

export function smootherstep(t: number) { const value = Math.min(1, Math.max(0, t)); return value * value * value * (value * (value * 6 - 15) + 10); }

function impulseSample(x: number, z: number, time: number, impulse: OceanImpulse): OceanSample {
  const age = time - impulse.startedAt;
  if (age < 0 || age > 7) return { height: 0, dx: 0, dz: 0, verticalVelocity: 0 };
  const px = x - impulse.x, pz = z - impulse.z, radius = Math.sqrt(px * px + pz * pz + .00001);
  const width = impulse.radius + age * .065;
  const q = (radius - age * 1.85) / width;
  const onset = smootherstep(age / .075);
  const envelope = Math.exp(-q * q * .5 - age * .88) / (1 + radius * .18);
  const carrier = Math.cos(q * 2.8), sine = Math.sin(q * 2.8);
  const height = impulse.amplitude * onset * envelope * carrier;
  const radialSlope = impulse.amplitude * onset * envelope * ((-q / width - .18 / (1 + radius * .18)) * carrier - 2.8 / width * sine);
  const qVelocity = (-1.85 * width - (radius - age * 1.85) * .065) / (width * width);
  const onsetDerivative = age < .075 ? 30 * (age / .075) ** 2 * (age / .075 - 1) ** 2 / .075 : 0;
  const verticalVelocity = impulse.amplitude * envelope * (onset * ((-q * qVelocity - .88) * carrier - 2.8 * qVelocity * sine) + onsetDerivative * carrier);
  return { height, dx: radialSlope * px / radius, dz: radialSlope * pz / radius, verticalVelocity };
}

export function sampleOcean(x: number, z: number, time: number, impulses: readonly OceanImpulse[] = [], swell = 1): OceanSample {
  const result: OceanSample = { height: 0, dx: 0, dz: 0, verticalVelocity: 0 };
  for (const wave of OCEAN_WAVES) {
    const k = Math.PI * 2 / wave.wavelength, omega = Math.sqrt(SCENE_GRAVITY * k);
    const phase = k * (wave.x * x + wave.z * z) - omega * time + wave.phase;
    const amplitude = wave.amplitude * swell;
    const displacement = Math.sin(phase) - wave.crest * Math.cos(phase * 2);
    const derivative = Math.cos(phase) + 2 * wave.crest * Math.sin(phase * 2);
    result.height += amplitude * displacement;
    result.dx += amplitude * k * wave.x * derivative;
    result.dz += amplitude * k * wave.z * derivative;
    result.verticalVelocity -= amplitude * omega * derivative;
  }
  for (const impulse of impulses) {
    const value = impulseSample(x, z, time, impulse);
    result.height += value.height; result.dx += value.dx; result.dz += value.dz; result.verticalVelocity += value.verticalVelocity;
  }
  return result;
}

/** Bounded impulses prevent a fast pointer from accumulating unbounded wave energy. */
export function addOceanImpulse(previous: readonly OceanImpulse[], input: OceanImpulse, now: number): OceanImpulse[] {
  if (![input.x, input.z, input.startedAt, input.amplitude, input.radius, now].every(Number.isFinite)) return [...previous];
  const next = { ...input, amplitude: Math.max(-.19, Math.min(.19, input.amplitude)), radius: Math.max(.14, Math.min(1.2, input.radius)) };
  return [...previous.filter(impulse => now - impulse.startedAt < 7 && now >= impulse.startedAt), next].slice(-MAX_OCEAN_IMPULSES);
}

const gl = (value: number) => value.toFixed(9);
export const OCEAN_GLSL = `
uniform float uOceanTime, uSwell;
uniform vec4 uImpulse[${MAX_OCEAN_IMPULSES}];
uniform vec2 uImpulseShape[${MAX_OCEAN_IMPULSES}];
vec3 oceanSurface(vec2 p) {
  vec3 result = vec3(0.0);
  ${OCEAN_WAVES.map(wave => {
    const k = Math.PI * 2 / wave.wavelength, omega = Math.sqrt(SCENE_GRAVITY * k);
    return `{ float phase = ${gl(k)} * dot(p, vec2(${gl(wave.x)},${gl(wave.z)})) - ${gl(omega)} * uOceanTime + ${gl(wave.phase)};
      float a = ${gl(wave.amplitude)} * uSwell;
      float height = sin(phase)-${gl(wave.crest)}*cos(2.0*phase);
      float slope = cos(phase)+${gl(wave.crest * 2)}*sin(2.0*phase);
      result += vec3(a*height, a*${gl(k * wave.x)}*slope, a*${gl(k * wave.z)}*slope); }`;
  }).join('\n')}
  for (int i = 0; i < ${MAX_OCEAN_IMPULSES}; i++) {
    float age = uOceanTime - uImpulse[i].z;
    if (age >= 0.0 && age < 7.0 && abs(uImpulse[i].w) > 0.00001) {
      vec2 relative = p - uImpulse[i].xy;
      float r = sqrt(dot(relative,relative) + 0.00001);
      float width = uImpulseShape[i].x + age * 0.065;
      float q = (r - age * 1.85) / width;
      float t = clamp(age / 0.075,0.0,1.0);
      float onset = t*t*t*(t*(t*6.0-15.0)+10.0);
      float envelope = exp(-q*q*0.5-age*0.88) / (1.0+r*0.18);
      float a = uImpulse[i].w * onset * envelope;
      float carrier = cos(q*2.8);
      float slope = a * ((-q / width - 0.18 / (1.0+r*0.18))*carrier - 2.8/width*sin(q*2.8));
      result += vec3(a * carrier, slope * relative / r);
    }
  }
  return result;
}
`;

/** Shared atmospheric lighting: broad cloud banks reflected in enamel and water. */
export const SKY_GLSL = `
float skyHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float skyNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(skyHash(i),skyHash(i+vec2(1.0,0.0)),f.x),mix(skyHash(i+vec2(0.0,1.0)),skyHash(i+vec2(1.0,1.0)),f.x),f.y);}
float skyFbm(vec2 p){float f=0.0,a=0.5;for(int i=0;i<4;i++){f+=a*skyNoise(p);p=mat2(1.62,1.17,-1.17,1.62)*p+7.3;a*=0.5;}return f;}
vec3 skyRadiance(vec3 direction,float lightMode){
  vec3 d=normalize(direction);
  float elevation=clamp(d.y,0.0,1.0);
  vec3 horizon=mix(vec3(0.17,0.23,0.29),vec3(0.68,0.75,0.78),lightMode);
  vec3 zenith=mix(vec3(0.038,0.065,0.105),vec3(0.21,0.37,0.50),lightMode);
  vec3 sky=mix(horizon,zenith,pow(elevation,0.55));
  vec2 projected=d.xz / (0.34+max(d.y,0.0));
  float clouds=smoothstep(0.40,0.77,skyFbm(projected*1.15+vec2(4.2,9.1)));
  clouds*=smoothstep(-0.04,0.19,d.y);
  sky=mix(sky,mix(vec3(0.54,0.59,0.65),vec3(1.55,1.55,1.49),lightMode),clouds*0.72);
  vec3 sun=normalize(vec3(-0.46,0.72,0.45));
  float sunDot=max(dot(d,sun),0.0);
  sky+=vec3(1.0,0.90,0.76)*pow(sunDot,100.0)*mix(1.8,3.4,lightMode);
  sky+=vec3(0.18,0.21,0.24)*pow(max(dot(d,normalize(vec3(0.65,0.17,-0.73))),0.0),30.0)*0.10;
  return sky;
}
`;

/** Upper-hemisphere HDR sampling avoids introducing a photographed shoreline. */
export const COASTAL_SKY_GLSL = `
uniform sampler2D uSkyTexture;
uniform float uHasSky;
vec3 coastalRadiance(vec3 direction,float lightMode) {
  vec3 d=normalize(direction);
  // Use sky just above the coastal horizon; the scene itself is open water.
  vec3 skyDirection=normalize(vec3(d.x,max(d.y,0.048),d.z));
  if(uHasSky>0.5){
    vec3 radiance;
    vec2 uv=vec2(atan(skyDirection.z,skyDirection.x)*0.159154943+0.5,
      asin(clamp(skyDirection.y,-1.0,1.0))*0.318309886+0.5);
    radiance=texture2D(uSkyTexture,uv).rgb*mix(0.48,0.86,lightMode);
    float luminance=dot(radiance,vec3(0.2126,0.7152,0.0722));
    return mix(vec3(luminance),radiance,0.88);
  }
  return skyRadiance(skyDirection,lightMode);
}
`;
