import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import pg from 'pg';
import {query} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';
import {hash,signGuest} from '../src/server/crypto.ts';
import {handleRequest} from '../src/server/router.ts';
import {upload} from '../src/server/media.ts';
import {storeAsset,storageUsage} from '../src/server/storage.ts';
import {currentStoragePolicy,initializeStoragePolicy,getManagedStoragePolicy,saveManagedStoragePolicy} from '../src/server/storage-policy.ts';
import {HARD_MAX_UPLOAD_BYTES} from '../src/lib/upload-policy.ts';
import {getWorkspace} from '../src/server/workspace.ts';
import {fixtureActor,insertActor,permissions,withCrmRecoveryDatabase} from './helpers/crm-recovery-environment.mjs';

const origin='http://localhost:3000',failure=(status,code)=>error=>error instanceof HttpError&&error.status===status&&error.code===code;
const pdfBytes=size=>Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(size-9,32)]);
const storedInput=(ownerId,size,metadata={})=>({ownerId,name:'isolated.pdf',bytes:pdfBytes(size),extension:'pdf',mimeType:'application/pdf',visibility:'private',scanStatus:'pending',metadata});
const setLimits=(maxFileBytes,other={})=>({maxFileBytes,byType:{image:maxFileBytes,document:maxFileBytes,video:maxFileBytes,audio:maxFileBytes},totalBytes:1024**3,userBytes:1024**2,guestBytes:1024**2,...other});
async function client(actor=null){
 const raw=randomUUID()+randomUUID(),csrf=actor?randomUUID()+randomUUID():signGuest(randomUUID()+randomUUID());
 if(actor)await query("INSERT INTO sessions(id,token_hash,user_id,csrf_token,mfa_verified,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[randomUUID(),hash(raw),actor.id,csrf,actor.mfaVerified]);
 return{async request(path,{method='GET',body,headers={}}={}){
  const multipart=body instanceof FormData,url=new URL('/api/v1'+path,origin);
  return handleRequest(new Request(url,{method,headers:{origin,'sec-fetch-site':'same-origin',cookie:actor?'im_session='+raw:'im_guest_csrf='+csrf,'x-csrf-token':csrf,...body!==undefined&&!multipart?{'content-type':'application/json'}:{},...headers},...body!==undefined?{body:multipart?body:JSON.stringify(body)}:{}}),url.pathname.slice('/api/v1/'.length).split('/'));
 }};
}
async function json(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
function form(bytes,name='isolated.pdf',mime='application/pdf'){const body=new FormData();body.set('file',new Blob([bytes],{type:mime}),name);body.set('visibility','private');return body;}

test('Administrator upload limits: real HTTP, current permissions, atomic quotas and policy changes during storage',{timeout:180000},async t=>withCrmRecoveryDatabase('storage_policy',async({scoped,storage})=>{
 const admin=fixtureActor('storage-admin','superAdmin'),editor=fixtureActor('storage-editor','contentEditor'),customer=fixtureActor('storage-customer','customer'),customer2=fixtureActor('storage-customer-two','customer');
 for(const actor of[admin,editor,customer,customer2])await insertActor(actor,{scope:'all',grants:permissions});await getWorkspace(admin);
 const adminHttp=await client(admin),editorHttp=await client(editor),customerHttp=await client(customer),guest=await client();
 async function policy(limits){const current=await currentStoragePolicy();return saveManagedStoragePolicy(admin,{expectedVersion:current.version,limits});}
 await t.test('Environment limits initialize once and subsequent environment changes do not override administrator policy',async()=>{
  const before=await currentStoragePolicy();assert.equal(before.source,'environment');await initializeStoragePolicy();
  const previous=process.env.UPLOAD_MAX_FILE_BYTES;process.env.UPLOAD_MAX_FILE_BYTES='1';try{const after=await currentStoragePolicy();assert.equal(after.source,'database');assert.deepEqual(after.limits,before.limits);}finally{if(previous===undefined)delete process.env.UPLOAD_MAX_FILE_BYTES;else process.env.UPLOAD_MAX_FILE_BYTES=previous;}
 });
 await t.test('Only current MFA administrators can manage policy; guest DTO contains no aggregate storage or identity data',async()=>{
  const current=await json(await adminHttp.request('/admin/storage-policy'));assert.equal(current.canEdit,true);assert.equal(current.hardMaxFileBytes,HARD_MAX_UPLOAD_BYTES);
  for(const http of[editorHttp,customerHttp])assert.equal((await http.request('/admin/storage-policy')).status,403);
  assert.equal((await guest.request('/admin/storage-policy')).status,401);
  const response=await guest.request('/media/policy'),publicPolicy=await json(response);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(publicPolicy.canUploadLibrary,false);assert.equal(publicPolicy.canUploadAttachment,true);
  assert.deepEqual(Object.keys(publicPolicy).sort(),['allowedMimeTypes','byType','canUploadAttachment','canUploadLibrary','maxFileBytes','maxRequestBytes','version'].sort());
  assert.equal(JSON.stringify(publicPolicy).includes('totalBytes'),false);assert.equal(JSON.stringify(publicPolicy).includes(admin.id),false);
 });
 await t.test('Version conflicts and invalid caps are rejected and every accepted policy change is audited',async()=>{
  const current=await getManagedStoragePolicy(admin),changed=await json(await adminHttp.request('/admin/storage-policy',{method:'PUT',body:{expectedVersion:current.version,limits:setLimits(4096)}}));assert.equal(changed.version,current.version+1);
  const conflict=await json(await adminHttp.request('/admin/storage-policy',{method:'PUT',body:{expectedVersion:current.version,limits:setLimits(4096)}}),409);assert.equal(conflict.error.code,'STORAGE_POLICY_CONFLICT');
  for(const limits of [setLimits(HARD_MAX_UPLOAD_BYTES+1),setLimits(4096,{userBytes:-1}),setLimits(4096,{guestBytes:2048,totalBytes:1024,userBytes:1024}),setLimits(4096,{byType:{image:4097,document:4096,video:4096,audio:4096}})])await assert.rejects(saveManagedStoragePolicy(admin,{expectedVersion:changed.version,limits}),failure(422,'VALIDATION'));
  assert.equal((await query("SELECT count(*)::int AS n FROM audit_events WHERE action='storage.policy.updated'")).rows[0].n,1);
 });
 await t.test('Private attachment intake requires staff MFA and rechecks account activity before committing bytes',async()=>{
  const incomplete={...editor,mfaVerified:false},incompleteHttp=await client(incomplete);
  assert.equal((await json(await incompleteHttp.request('/media/policy'))).canUploadAttachment,false);
  await assert.rejects(upload(new Request(origin+'/api/v1/attachments',{method:'POST',body:form(pdfBytes(100))}),incomplete,true),failure(403,'MFA_REQUIRED'));
  const encoded=new Request(origin+'/api/v1/attachments',{method:'POST',body:form(pdfBytes(100))}),bytes=new Uint8Array(await encoded.arrayBuffer());
  let release,entered=false;const gate=new Promise(resolve=>{release=resolve;});
  const stream=new ReadableStream({async pull(controller){entered=true;await gate;controller.enqueue(bytes);controller.close();}},{highWaterMark:0});
  const attempt=upload(new Request(origin+'/api/v1/attachments',{method:'POST',headers:encoded.headers,body:stream,duplex:'half'}),customer2,true).then(result=>({result}),error=>({error}));
  try{
   const deadline=Date.now()+10000;while(!entered){assert.ok(Date.now()<deadline,'Attachment intake did not start');await new Promise(resolve=>setTimeout(resolve,20));}
   await query('UPDATE users SET active=false WHERE id=$1',[customer2.id]);release();const outcome=await attempt;assert.ok(failure(401,'SESSION_REQUIRED')(outcome.error));
   assert.equal((await query('SELECT 1 FROM assets WHERE owner_id=$1',[customer2.id])).rowCount,0);assert.equal((await query("SELECT 1 FROM storage_reservations WHERE subject_key=$1 AND state='reserved'",['user:'+customer2.id])).rowCount,0);
  }finally{release();await attempt;await query('UPDATE users SET active=true WHERE id=$1',[customer2.id]);}
 });
 await t.test('Concurrent uploads reserve capacity atomically and cannot exceed an account quota',async()=>{
  await policy(setLimits(1000,{userBytes:1000,guestBytes:1000}));
  const results=await Promise.allSettled([storeAsset(storedInput(customer.id,600)),storeAsset(storedInput(customer.id,600))]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected'&&failure(507,'STORAGE_USER_QUOTA')(row.reason)).length,1);
  const usage=await storageUsage(customer.id);assert.equal(usage.storedBytes,'600');assert.equal(usage.reservedBytes,'0');assert.equal(usage.quotaBytes,'1000');
  assert.equal((await query("SELECT count(*)::int AS n FROM assets WHERE owner_id=$1",[customer.id])).rows[0].n,1);
 });
 await t.test('Guest uploads use their own quota and signed guest identity rather than an authenticated user budget',async()=>{
  assert.equal((await guest.request('/attachments',{method:'POST',body:form(pdfBytes(600))})).status,201);
  const rejected=await json(await guest.request('/attachments',{method:'POST',body:form(pdfBytes(600))}),507);assert.equal(rejected.error.code,'STORAGE_USER_QUOTA');
  const own=await storageUsage(customer.id);assert.equal(own.storedBytes,'600');
  assert.equal((await query("SELECT count(*)::int AS n FROM assets WHERE owner_id IS NULL AND quota_subject LIKE 'guest:%'")).rows[0].n,1);
 });
 await t.test('The actual detected type determines the limit, regardless of claimed MIME or misleading filename',async()=>{
  await policy(setLimits(4096,{byType:{image:4096,document:1024,video:4096,audio:4096}}));
  const response=await json(await adminHttp.request('/attachments',{method:'POST',body:form(pdfBytes(1400),'fake-image.png','image/png')}),413);assert.equal(response.error.code,'UPLOAD_SIZE');
  await policy(setLimits(4096,{byType:{image:4096,document:2048,video:4096,audio:4096}}));const asset=await json(await adminHttp.request('/attachments',{method:'POST',body:form(pdfBytes(1400),'valid.pdf')}),201);assert.equal(asset.size,1400);assert.equal(asset.mimeType,'application/pdf');assert.equal(asset.scanStatus,'pending');
  assert.equal((await adminHttp.request('/attachments/'+asset.id)).status,409);
 });
 await t.test('Multiple files and oversized chunked envelopes are rejected before any storage reservation',async()=>{
  const body=form(pdfBytes(100));body.append('file',new Blob([pdfBytes(100)]),'second.pdf');const multi=await json(await adminHttp.request('/attachments',{method:'POST',body}),422);assert.equal(multi.error.code,'UPLOAD_FIELDS');
  await policy(setLimits(1024));let cancelled=false;const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(70000));},cancel(){cancelled=true;}});
  const request=new Request(origin+'/api/v1/attachments',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=isolated'},body:stream,duplex:'half'});
  const before=(await query("SELECT count(*)::int AS n FROM storage_reservations WHERE state='reserved'")).rows[0].n;
  await assert.rejects(upload(request,customer2,true),failure(413,'UPLOAD_SIZE'));assert.equal(cancelled,true);assert.equal((await query("SELECT count(*)::int AS n FROM storage_reservations WHERE state='reserved'")).rows[0].n,before);
 });
 await t.test('Malformed and truncated multipart bodies return a named client error without reserving or storing a file',async()=>{
  await policy(setLimits(4096));
  const before=(await query('SELECT (SELECT count(*)::int FROM assets) AS assets,(SELECT count(*)::int FROM storage_reservations) AS reservations')).rows[0];
  for(const [contentType,body] of [
   ['multipart/form-data; boundary=isolated','--isolated\r\nContent-Disposition: form-data; name="file"; filename="incomplete.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\ntruncated'],
   ['multipart/form-data; charset=utf-8','missing-boundary'],
  ]){
   const request=new Request(origin+'/api/v1/attachments',{method:'POST',headers:{'content-type':contentType},body});
   await assert.rejects(upload(request,customer2,true),failure(400,'MULTIPART_INVALID'));
  }
  assert.deepEqual((await query('SELECT (SELECT count(*)::int FROM assets) AS assets,(SELECT count(*)::int FROM storage_reservations) AS reservations')).rows[0],before);
 });
 await t.test('A policy tightened while a file is on disk prevents commit and removes the uncommitted bytes',async()=>{
  await policy(setLimits(1024**2,{userBytes:4*1024**2}));const control=new pg.Client({connectionString:scoped.toString()});await control.connect();await control.query('BEGIN');await control.query('SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE');
  let attempt;
  try{
   attempt=storeAsset(storedInput(customer2.id,128*1024));const deadline=Date.now()+10000;
   while(!(await query("SELECT 1 FROM storage_reservations WHERE subject_key=$1 AND state='reserved'",['user:'+customer2.id])).rowCount){assert.ok(Date.now()<deadline,'Upload did not reserve space');await new Promise(resolve=>setTimeout(resolve,20));}
   const limits=setLimits(1024);await control.query('SELECT pg_advisory_xact_lock(917264834)');await control.query('UPDATE storage_policy SET limits=$1::jsonb,version=version+1,updated_at=now() WHERE singleton=true',[JSON.stringify(limits)]);await control.query('COMMIT');
   await assert.rejects(attempt,failure(413,'UPLOAD_SIZE'));assert.equal((await query('SELECT 1 FROM assets WHERE owner_id=$1',[customer2.id])).rowCount,0);assert.equal((await query("SELECT 1 FROM storage_reservations WHERE subject_key=$1 AND state='reserved'",['user:'+customer2.id])).rowCount,0);
   const keys=new Set((await query('SELECT storage_key FROM assets')).rows.map(row=>row.storage_key.split('/')[1]));const files=await readdir(storage+'/private');assert.ok(files.every(file=>keys.has(file)),'A rejected upload left untracked bytes');
  }finally{await control.query('ROLLBACK');await control.end();if(attempt)await attempt.catch(()=>{});}
 });
 await t.test('Concurrent multipart intake is bounded and a completed upload always releases its processing slot',async()=>{
  await policy(setLimits(4096));const previous=process.env.UPLOAD_CONCURRENT_REQUESTS;process.env.UPLOAD_CONCURRENT_REQUESTS='2';
  let entered=0,release;const gate=new Promise(resolve=>{release=resolve;});
  async function heldRequest(){
   const encoded=new Request(origin+'/api/v1/attachments',{method:'POST',body:form(pdfBytes(100))}),bytes=new Uint8Array(await encoded.arrayBuffer()),headers=encoded.headers;
   const stream=new ReadableStream({async pull(controller){entered++;await gate;controller.enqueue(bytes);controller.close();}},{highWaterMark:0});
   return new Request(origin+'/api/v1/attachments',{method:'POST',headers,body:stream,duplex:'half'});
  }
  const first=await heldRequest(),second=await heldRequest();const attempts=[upload(first,customer2,true),upload(second,customer2,true)].map(value=>value.then(result=>({result}),error=>({error})));
  try{
   const deadline=Date.now()+10000;while(entered<2){assert.ok(Date.now()<deadline,'Both multipart readers must be active');await new Promise(resolve=>setTimeout(resolve,20));}
   await assert.rejects(upload(new Request(origin+'/api/v1/attachments',{method:'POST',body:form(pdfBytes(100))}),customer2,true),failure(429,'UPLOAD_BUSY'));
   release();const results=await Promise.all(attempts);assert.ok(results.every(row=>row.result?.id),JSON.stringify(results.map(row=>row.error?.code)));
   const after=await upload(new Request(origin+'/api/v1/attachments',{method:'POST',body:form(pdfBytes(100))}),customer2,true);assert.ok(after.id);
  }finally{release();await Promise.all(attempts);if(previous===undefined)delete process.env.UPLOAD_CONCURRENT_REQUESTS;else process.env.UPLOAD_CONCURRENT_REQUESTS=previous;}
 });
 await t.test('Twenty-one MiB documents work after an administrator raises the cap and remain quarantined',async()=>{
  await policy(setLimits(24*1024**2,{totalBytes:128*1024**2,userBytes:64*1024**2,guestBytes:1024**2}));
  const size=21*1024**2,asset=await json(await adminHttp.request('/attachments',{method:'POST',body:form(pdfBytes(size),'large-document.pdf')}),201);assert.equal(asset.size,size);assert.equal(asset.scanStatus,'pending');
  const limits=await json(await adminHttp.request('/media/policy'));assert.equal(limits.maxFileBytes,24*1024**2);
  const own=await storageUsage(admin.id);assert.equal(own.quotaBytes,String(64*1024**2));assert.ok(BigInt(own.storedBytes)>=BigInt(size));
  const monitor=await json(await adminHttp.request('/monitoring/storage'));assert.ok(monitor.metrics.some(row=>row.key==='storage_quota_bytes'&&row.value===128*1024**2));
 });
}));
