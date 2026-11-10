import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {loadTs} from './helpers/load-ts.mjs';

const {CoastalHDRLoader,COASTAL_HDR_URL,COASTAL_HDR_BYTES}=await loadTs('src/components/experience/engines/coastal-hdr.ts');
const source=readFileSync(new URL('../public/media/environment/blue-lagoon-1k.hdr',import.meta.url));
const packed=readFileSync(new URL(`../public${COASTAL_HDR_URL}`,import.meta.url));
const arrayBuffer=bytes=>Uint8Array.from(bytes).buffer;

test('compressed coastal HDR preserves every original radiance byte and texture value',()=>{
  assert.equal(source.length,COASTAL_HDR_BYTES);
  assert.deepEqual(gunzipSync(packed),source);
  assert.ok(packed.length<source.length*.8,'transport removes at least 20% without changing image data');
  const original=new HDRLoader().parse(arrayBuffer(source));
  const decoded=new CoastalHDRLoader().parse(arrayBuffer(packed));
  for(const key of ['width','height','header','gamma','exposure','type'])assert.equal(decoded[key],original[key],key);
  assert.equal(decoded.data.constructor,original.data.constructor);
  assert.deepEqual(decoded.data,original.data);
});

test('coastal transport rejects non-gzip, truncated and oversized output declarations before HDR parsing',()=>{
  const loader=new CoastalHDRLoader();
  assert.throws(()=>loader.parse(arrayBuffer(source)),/Invalid bundled coastal HDR transport/);
  assert.throws(()=>loader.parse(new ArrayBuffer(0)),/Invalid bundled coastal HDR transport/);
  assert.throws(()=>loader.parse(arrayBuffer(packed.subarray(0,100))),/Invalid bundled coastal HDR transport/);
  const damaged=Uint8Array.from(packed);
  new DataView(damaged.buffer).setUint32(damaged.length-4,0xffffffff,true);
  assert.throws(()=>loader.parse(damaged.buffer),/Invalid bundled coastal HDR transport/);
});
