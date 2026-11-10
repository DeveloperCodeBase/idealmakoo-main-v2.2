import { gunzipSync } from 'fflate';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export const COASTAL_HDR_URL = '/media/environment/blue-lagoon-1k.hdr.gz';
export const COASTAL_HDR_BYTES = 1_559_027;

/** Lossless transport compression of the bundled HDR. Decoding runs alongside
 * the scene in its rendering worker; the radiance values and HDRLoader's
 * texture configuration remain identical to the original .hdr asset. */
export class CoastalHDRLoader extends HDRLoader {
  parse(buffer: ArrayBuffer) {
    const packed = new Uint8Array(buffer);
    if (packed.length < 18 || packed.length > COASTAL_HDR_BYTES || packed[0] !== 0x1f || packed[1] !== 0x8b
      || new DataView(buffer).getUint32(buffer.byteLength - 4, true) !== COASTAL_HDR_BYTES) {
      throw new Error('Invalid bundled coastal HDR transport');
    }
    // The known size also caps allocation if a damaged response changes ISIZE.
    const decoded = gunzipSync(packed, { out: new Uint8Array(COASTAL_HDR_BYTES) });
    return super.parse(decoded.buffer);
  }
}
