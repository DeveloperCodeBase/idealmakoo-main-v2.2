import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,symlink,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setImmediate as immediate,setTimeout as delay} from 'node:timers/promises';
import {storedMediaResponse} from '../src/server/asset-content.ts';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const request=(headers={},method='GET',signal)=>new Request('http://localhost/media',{method,headers,signal});
async function fixture(run){
  const directory=await mkdtemp(join(tmpdir(),'idealmakoo-media-response-'));
  try{
    await mkdir(join(directory,'public'));await mkdir(join(directory,'private'));
    const bytes=Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'),id=randomUUID(),row={storage_key:'public/'+id+'.mp4',name:'ویدیو.mp4',mime_type:'video/mp4',bytes:String(bytes.length),sha256:sha(bytes),visibility:'public',scan_status:'clean'};
    await writeFile(join(directory,row.storage_key),bytes);
    await run({directory,row,bytes,path:join(directory,row.storage_key)});
  }finally{await immediate();await rm(directory,{recursive:true,force:true});}
}
test('Verified media streams exact bytes, preserves private headers and validates public conditional requests',async()=>fixture(async({directory,row,bytes})=>{
  const full=await storedMediaResponse(row,request(),directory),etag=full.headers.get('etag');
  assert.equal(full.status,200);assert.equal(full.headers.get('content-length'),String(bytes.length));assert.deepEqual(Buffer.from(await full.arrayBuffer()),bytes);
  assert.match(etag,/^"sha256-[a-f0-9]{64}"$/);assert.equal(full.headers.get('content-disposition').startsWith('inline;'),true);assert.match(full.headers.get('content-disposition'),/filename\*=UTF-8''/);
  const cached=await storedMediaResponse(row,request({'If-None-Match':'W/'+etag}),directory);
  assert.equal(cached.status,304);assert.equal(await cached.text(),'');assert.equal(cached.headers.get('etag'),etag);
  assert.equal(cached.headers.get('content-security-policy'),"default-src 'none'; sandbox");
  const privateResponse=await storedMediaResponse({...row,visibility:'private'},request({'If-None-Match':etag}),directory);
  assert.equal(privateResponse.status,200);assert.equal(privateResponse.headers.get('cache-control'),'private, no-store');assert.match(privateResponse.headers.get('content-disposition'),/^attachment;/);
  assert.deepEqual(Buffer.from(await privateResponse.arrayBuffer()),bytes);
  const head=await storedMediaResponse(row,request({Range:'bytes=2-5'},'HEAD'),directory);
  assert.equal(head.status,200);assert.equal(head.body,null);assert.equal(head.headers.get('content-length'),String(bytes.length));
}));
test('Verified media supports open and suffix ranges, fails unsatisfiable requests and honors strong If-Range',async()=>fixture(async({directory,row,bytes})=>{
  for(const [range,start,end] of [['bytes=2-5',2,5],['bytes=10-',10,35],['bytes=-4',32,35],['bytes=-999',0,35],['bytes=0-999',0,35]]){
    const response=await storedMediaResponse(row,request({Range:range}),directory);
    assert.equal(response.status,206,range);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${bytes.length}`);assert.equal(response.headers.get('content-length'),String(end-start+1));assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(start,end+1));
  }
  for(const range of ['bytes=-0','bytes=-','bytes=36-','bytes=5-1','bytes=0-1,4-5','bytes=999999999999999999999999999999-','bytes=0-NaN','invalid']){
    const response=await storedMediaResponse(row,request({Range:range}),directory);
    assert.equal(response.status,416,range);assert.equal(response.headers.get('content-range'),'bytes */36');assert.equal(response.body,null);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  }
  const etag='"sha256-'+row.sha256+'"';
  const matched=await storedMediaResponse(row,request({Range:'bytes=3-5','If-Range':etag}),directory);assert.equal(matched.status,206);assert.equal(await matched.text(),'345');
  for(const value of ['"previous-revision"','W/'+etag,'Sun, 01 Jan 2023 00:00:00 GMT']){
    const response=await storedMediaResponse(row,request({Range:'bytes=3-5','If-Range':value}),directory);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  }
}));
test('Cached integrity never accepts corruption, replacement, symlinks, quarantined files or mismatched metadata',async()=>fixture(async({directory,row,path,bytes})=>{
  await (await storedMediaResponse(row,request(),directory)).arrayBuffer();
  const etag='"sha256-'+row.sha256+'"';
  await writeFile(path,Buffer.alloc(bytes.length,65));
  await assert.rejects(storedMediaResponse(row,request({'If-None-Match':etag}),directory),error=>error.code==='FILE_INTEGRITY');
  await writeFile(path,bytes);
  await (await storedMediaResponse(row,request(),directory)).arrayBuffer();
  const replacement=path+'.replacement';await writeFile(replacement,Buffer.alloc(bytes.length,66));await rename(replacement,path);
  await assert.rejects(storedMediaResponse(row,request(),directory),error=>error.code==='FILE_INTEGRITY');
  await assert.rejects(storedMediaResponse({...row,scan_status:'pending'},request(),directory),error=>error.code==='QUARANTINED');
  await writeFile(path,bytes);
  await assert.rejects(storedMediaResponse({...row,bytes:'999'},request(),directory),error=>error.code==='FILE_INTEGRITY');
  await assert.rejects(storedMediaResponse({...row,storage_key:'../../etc/passwd'},request(),directory),error=>error.code==='STORAGE_KEY');
  await rename(path,replacement);await symlink(replacement,path);
  await assert.rejects(storedMediaResponse(row,request(),directory),error=>error.code==='FILE_MISSING');
}));
test('Large delivery stays in bounded chunks and cancelled response bodies release download admission',async()=>fixture(async({directory,row,path})=>{
  const bytes=Buffer.alloc(5*1024*1024,71);await writeFile(path,bytes);
  row={...row,bytes:String(bytes.length),sha256:sha(bytes)};
  const response=await storedMediaResponse(row,request(),directory),reader=response.body.getReader();
  let received=0;const digest=createHash('sha256');
  for(;;){const result=await reader.read();if(result.done)break;assert.ok(result.value.length<=64*1024);received+=result.value.length;digest.update(result.value);}
  assert.equal(received,bytes.length);assert.equal(digest.digest('hex'),row.sha256);
  await immediate();
  const holding=[];
  try{
    for(let index=0;index<64;index++)holding.push(await storedMediaResponse(row,request(),directory));
    await assert.rejects(storedMediaResponse(row,request(),directory),error=>error.status===503&&error.code==='MEDIA_BUSY');
  }finally{await Promise.all(holding.map(response=>response.body.cancel()));await immediate();}
  // Node's WebStream cancellation resolves before its asynchronous fd close.
  // Admission must recover promptly after those pending closes settle.
  let resumed;for(let attempt=0;attempt<100&&!resumed;attempt++){try{resumed=await storedMediaResponse(row,request({Range:'bytes=0-2'}),directory);}catch(error){if(error.code!=='MEDIA_BUSY')throw error;await delay(10);}}
  assert.ok(resumed,'Cancelled streams must release their open-file slots.');assert.equal(await resumed.text(),'GGG');
}));
