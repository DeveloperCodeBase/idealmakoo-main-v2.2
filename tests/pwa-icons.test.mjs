import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pngDimensions,pngMatchesDeclaredSize} from '../scripts/lib/png-dimensions.mjs';

test('each localized PWA declares real 192px and 512px PNGs with matching language and launch URL',()=>{
 for(const locale of ['fa','en','tr','ar','ru']){
  const manifest=JSON.parse(readFileSync(new URL(`../public/manifests/${locale}.webmanifest`,import.meta.url),'utf8'));
  assert.equal(manifest.lang,locale);assert.equal(manifest.dir,['fa','ar'].includes(locale)?'rtl':'ltr');
  assert.equal(manifest.start_url,`/${locale}/`);assert.equal(manifest.scope,'/');
  for(const size of [192,512]){
   const icon=manifest.icons.find(icon=>icon.sizes===`${size}x${size}`);
   assert.ok(icon,`${locale}: required ${size}px icon`);
   assert.equal(icon.type,'image/png');assert.match(icon.src,/^\/icons\/[a-zA-Z0-9-]+\.png$/);
   const png=readFileSync(new URL('../public'+icon.src,import.meta.url));
   assert.deepEqual(pngDimensions(png),{width:size,height:size},`${locale}: actual image size`);
   assert.equal(pngMatchesDeclaredSize(png,icon.sizes),true);
  }
 }
});

test('PNG validation rejects misdeclared dimensions, disguised bytes and damaged IHDR headers',()=>{
 const png=readFileSync(new URL('../public/icons/idealmakoo-192.png',import.meta.url));
 assert.equal(pngMatchesDeclaredSize(png,'226x226'),false);
 assert.equal(pngMatchesDeclaredSize(png,'192x1920'),false);
 assert.equal(pngMatchesDeclaredSize(png,'any'),false);
 assert.equal(pngMatchesDeclaredSize(png,undefined),false);
 assert.equal(pngDimensions(Buffer.from('not a PNG')),null);
 assert.equal(pngDimensions(png.subarray(0,24)),null);
 const zeroWidth=Buffer.from(png);zeroWidth.writeUInt32BE(0,16);assert.equal(pngDimensions(zeroWidth),null);
 const badChunk=Buffer.from(png);badChunk.write('DATA',12,'ascii');assert.equal(pngDimensions(badChunk),null);
});
