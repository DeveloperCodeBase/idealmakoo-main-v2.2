import { buildMolarMeshData, molarTransferables, type MolarQuality } from './molar-mesh';
import type { ToothMorphology } from './anatomy';

// Dedicated, same-origin module worker. It accepts only the two authored
// geometries and returns typed arrays, never markup, URLs or executable code.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{quality: MolarQuality; morphologies: ToothMorphology[]}>) => void) | null;
  postMessage: (value: unknown, transfer: ArrayBuffer[]) => void;
};
scope.onmessage = ({data}) => {
  if (!['standard', 'high'].includes(data?.quality) || !Array.isArray(data.morphologies) || data.morphologies.length < 1 || data.morphologies.length > 2 || data.morphologies.some(value => !['maxillary', 'mandibular'].includes(value))) {
    scope.postMessage({error: 'Invalid anatomical geometry request.'}, []);
    return;
  }
  try {
    const meshes = data.morphologies.map(morphology => buildMolarMeshData(data.quality, morphology));
    scope.postMessage({meshes}, molarTransferables(meshes));
  } catch {
    scope.postMessage({error: 'The anatomical geometry could not be prepared.'}, []);
  }
};
