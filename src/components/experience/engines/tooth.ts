// @ts-nocheck
// Adapted from the user-supplied landingpage source. Public React boundaries are strictly typed.
import * as THREE from 'three';

import { buildMolarMeshData } from './molar-mesh';

// Continuous anatomical field meshing from the supplied landing experience.
// The hero now uses separate upper/lower molars, including distinct root systems.
export function molarGeometryFromData(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('toothSurface', new THREE.BufferAttribute(data.surface, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.description = data.description;
  geometry.userData.morphology = data.morphology;
  return geometry;
}

export function buildMolarGeometry(quality = 'standard', morphology = 'maxillary') {
  return molarGeometryFromData(buildMolarMeshData(quality, morphology));
}

const geometryCache = new Map();

export function createTooth(options = {}) {
  const group = new THREE.Group();
  group.name = 'Anatomical enamel molar';
  const quality = options.quality === 'high' ? 'high' : 'standard';
  const morphology = options.morphology === 'mandibular' ? 'mandibular' : 'maxillary';
  const cacheKey = quality + ':' + morphology;
  let cached = geometryCache.get(cacheKey);
  if (!cached) {
    const prepared = options.geometryData;
    if (prepared && (prepared.quality !== quality || prepared.morphology !== morphology)) throw new Error('The prepared tooth geometry does not match the requested sculpture.');
    cached = { geometry: prepared ? molarGeometryFromData(prepared) : buildMolarGeometry(quality, morphology), references: 0 };
    geometryCache.set(cacheKey, cached);
  }
  cached.references++;
  const geometry = cached.geometry;
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xfffef9,
    vertexColors: true,
    metalness: 0,
    roughness: .22,
    clearcoat: .86,
    clearcoatRoughness: .105,
    ior: 1.54,
    transmission: .12,
    thickness: .34,
    attenuationColor: new THREE.Color(0xfff0d8),
    attenuationDistance: .72,
    envMapIntensity: 1.02,
    specularIntensity: 1.0,
    ...options.material,
  });
  // The solid crown is dominantly diffuse. Limited volume transmission varies
  // with enamel and viewing thickness, so edges glow without becoming glass.
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 toothSurface;
      varying vec3 vToothLocalPosition, vToothSurface;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vToothLocalPosition = position; vToothSurface = toothSurface;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vToothLocalPosition, vToothSurface;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float crownEnamel = vToothSurface.x;
      float enamelVariation = sin(vToothLocalPosition.x*31.0+vToothLocalPosition.z*17.0+sin(vToothLocalPosition.y*9.0))
        * sin(vToothLocalPosition.y*23.0-vToothLocalPosition.z*13.0);
      roughnessFactor = clamp(roughnessFactor + (1.0-crownEnamel)*0.18 + enamelVariation*0.015 + vToothSurface.z*0.026, 0.15, 0.50);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Perikymata follow the curved neck. Sparse irregular relief prevents
      // striped plastic highlights, while anatomical cusp facets stay dominant.
      float cervicalArc = vToothLocalPosition.y + 0.018*sin(atan(vToothLocalPosition.z,vToothLocalPosition.x)*2.0);
      float perikymata = sin(cervicalArc*154.0 + sin(vToothLocalPosition.x*9.0+vToothLocalPosition.z*5.0)*0.7);
      float fineGrain = sin(dot(vToothLocalPosition,vec3(117.0,39.0,87.0))) * sin(dot(vToothLocalPosition,vec3(-61.0,133.0,51.0)));
      float rootStriae = sin(vToothLocalPosition.x*91.0+vToothLocalPosition.z*67.0+sin(vToothLocalPosition.y*12.0));
      float toothGrain = (perikymata*0.000070*(1.0-vToothSurface.y*0.65) + fineGrain*0.000024)*crownEnamel
        + rootStriae*0.00014*(1.0-crownEnamel);
      vec3 toothSigmaX = dFdx(-vViewPosition), toothSigmaY = dFdy(-vViewPosition);
      vec3 toothR1 = cross(toothSigmaY,normal), toothR2 = cross(normal,toothSigmaX);
      float toothDet = dot(toothSigmaX,toothR1);
      normal = normalize(abs(toothDet)*normal-sign(toothDet)*(dFdx(toothGrain)*toothR1+dFdy(toothGrain)*toothR2));
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
        material.clearcoat *= mix(0.14,1.0,crownEnamel);
        material.clearcoatRoughness = mix(0.29,material.clearcoatRoughness,crownEnamel);
      #endif
    `);
    // Expand the installed Three chunk so modulation occurs before refraction,
    // while retaining its actual IOR, attenuation and opaque dentine mixture.
    const transmissionChunk = THREE.ShaderChunk.transmission_fragment
      .replace('material.transmission = transmission;', `
        float enamelEdge = pow(1.0-abs(dot(normal,normalize(vViewPosition))),2.0)*vToothSurface.y;
        material.transmission = transmission*crownEnamel*(0.12+0.88*enamelEdge);`)
      .replace('material.thickness = thickness;', 'material.thickness = thickness*mix(1.75,0.30,enamelEdge);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_fragment>', transmissionChunk);
  };
  material.customProgramCacheKey = () => 'anatomical-solid-enamel-v5';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Continuous crown and root enamel surface';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const rotation = Array.isArray(options.rotation) ? options.rotation : [0, 0, 0];
  mesh.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
  if (typeof options.scale === 'number') group.scale.setScalar(options.scale);
  group.add(mesh);
  let disposed = false;

  return {
    group,
    mesh,
    triangleCount: geometry.index.count / 3,
    bounds: { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() },
    update(time, reducedMotion = false) {
      if (options.animate === true && !reducedMotion) {
        mesh.rotation.z = (rotation[2] || 0) + Math.sin(time * .42) * .008;
        mesh.rotation.y = (rotation[1] || 0) + Math.sin(time * .26) * .024;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cached.references--;
      if (cached.references === 0) { geometry.dispose(); geometryCache.delete(cacheKey); }
      material.dispose();
    },
  };
}

export default createTooth;
