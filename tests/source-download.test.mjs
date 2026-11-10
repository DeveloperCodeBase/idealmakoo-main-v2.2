import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {handleSourceArchive}=await loadTs('worker/download.ts');
const descriptor={bytes:12,sha256:'abc123',parts:[{url:'/downloads/one.bin',bytes:5},{url:'/downloads/two.bin',bytes:4},{url:'/downloads/three.bin',bytes:3}]};
const chunks={'/downloads/one.bin':'abcde','/downloads/two.bin':'fghi','/downloads/three.bin':'jkl'};
const assets={fetch:async request=>new Response(chunks[new URL(request.url).pathname])};
const get=(range,method='GET')=>new Request('https://ideal.test/downloads/idealmakoo-source.zip',{method,headers:range?{Range:range}:{}});
test('download reassembles one byte-identical ZIP with filename, size and stable digest',async()=>{
 const result=await handleSourceArchive(get(),assets,descriptor);assert.equal(result.status,200);assert.equal(await result.text(),'abcdefghijkl');assert.equal(result.headers.get('Content-Length'),'12');assert.match(result.headers.get('Content-Disposition'),/idealmakoo-source.zip/);assert.equal(result.headers.get('ETag'),'"abc123"');
 assert.equal(await handleSourceArchive(new Request('https://ideal.test/fa/'),assets,descriptor),null);
});
test('range downloads cross asset boundaries and support suffix and resume without adding or losing bytes',async()=>{
 for(const [range,expected,contentRange]of [['bytes=3-10','defghijk','bytes 3-10/12'],['bytes=5-','fghijkl','bytes 5-11/12'],['bytes=-3','jkl','bytes 9-11/12'],['bytes=0-500','abcdefghijkl','bytes 0-11/12']]){const result=await handleSourceArchive(get(range),assets,descriptor);assert.equal(result.status,206);assert.equal(await result.text(),expected);assert.equal(result.headers.get('Content-Range'),contentRange);assert.equal(Number(result.headers.get('Content-Length')),expected.length);}
});
test('invalid ranges are rejected and HEAD has no body',async()=>{
 for(const range of ['bytes=50-60','bytes=9-2','bytes=-0','bytes=-','bytes=0-2,5-9'])assert.equal((await handleSourceArchive(get(range),assets,descriptor)).status,416);
 const head=await handleSourceArchive(get(null,'HEAD'),assets,descriptor);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('Content-Length'),'12');
});
