import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url),configUrl=new URL('../next.config.ts',import.meta.url);
const configRequire=createRequire(configUrl),exports={};
const uploadPolicy=await loadTs('src/lib/upload-policy.ts');
runInNewContext(ts.transpileModule(readFileSync(configUrl,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:name=>name==='./src/lib/upload-policy'?uploadPolicy:configRequire(name)});
const configured=exports.default.experimental.proxyClientMaxBodySize;
const {getCloneableBody}=require('next/dist/server/body-streams.js');

test('the deployed Proxy buffer uses the same finite hard request ceiling as the application and Caddy',()=>{
  assert.equal(configured,uploadPolicy.HARD_MAX_UPLOAD_BYTES+uploadPolicy.MULTIPART_OVERHEAD_BYTES);
  assert.equal(configured,83951616);
  const caddy=readFileSync(new URL('../deploy/caddy/Caddyfile',import.meta.url),'utf8');
  assert.match(caddy,/max_size\s+83951616\b/);
});

test('the installed Next request clone preserves a 12 MiB multipart file for the underlying route',async()=>{
  const file=Buffer.alloc(12*1024*1024,32);file.write('%PDF-1.7\n');
  const form=new FormData();form.set('file',new Blob([file],{type:'application/pdf'}),'owned-large.pdf');form.set('visibility','private');
  const original=new Request('http://localhost/api/v1/attachments',{method:'POST',body:form});
  const wire=Buffer.from(await original.arrayBuffer());
  function* chunks(){for(let offset=0;offset<wire.length;offset+=64*1024)yield wire.subarray(offset,offset+64*1024);}
  // An HTTP request stays available while its body is replaced; do not let a
  // generic fixture Readable destroy itself as soon as its original bytes end.
  const incoming=Readable.from(chunks(),{objectMode:false,autoDestroy:false});incoming.url='/api/v1/attachments';
  const clone=getCloneableBody(incoming,configured),proxyStream=clone.cloneBodyStream();
  proxyStream.resume();await clone.finalize();
  const downstream=new Request(original.url,{method:'POST',headers:original.headers,body:Readable.toWeb(incoming),duplex:'half'});
  const decoded=await downstream.formData(),saved=decoded.get('file');
  assert.ok(saved instanceof File);assert.equal(saved.size,file.length);assert.equal(decoded.get('visibility'),'private');
  assert.equal(createHash('sha256').update(Buffer.from(await saved.arrayBuffer())).digest('hex'),createHash('sha256').update(file).digest('hex'));
});
