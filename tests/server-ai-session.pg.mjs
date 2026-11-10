import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {withCrmRecoveryDatabase,fixtureActor,insertActor} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {hash} from '../src/server/crypto.ts';
import {sessionFor,logout} from '../src/server/auth.ts';
import {handleRequest} from '../src/server/router.ts';
import {createAiJob,cancelAiJob,getAiJobs,generateAi,processAiJob} from '../src/server/ai.ts';

const origin='http://localhost:3000';
const refused=error=>error?.status===401&&error?.code==='SESSION_REQUIRED';
const waitFor=async predicate=>{
 const deadline=Date.now()+10000;
 while(!await predicate()){
  assert.ok(Date.now()<deadline,'The delayed request did not reach its synchronization point.');
  await new Promise(resolve=>setTimeout(resolve,10));
 }
};
async function current(){
 const actor=fixtureActor('ai-session-'+randomUUID(),'contentEditor',{allowedLocales:['en']});
 await insertActor(actor);
 const id=randomUUID(),raw=randomUUID()+randomUUID(),csrf=randomUUID()+randomUUID();
 await query("INSERT INTO sessions(id,token_hash,user_id,csrf_token,mfa_verified,expires_at) VALUES($1,$2,$3,$4,true,now()+interval '1 hour')",[id,hash(raw),actor.id,csrf]);
 const headers={cookie:'im_session='+raw,origin,'sec-fetch-site':'same-origin','x-csrf-token':csrf};
 const context=await sessionFor(new Request(origin+'/api/v1/auth/session',{headers}));
 assert.ok(context);return{id,context,headers};
}
async function noQueuedWork(actorId){
 for(const table of ['ai_jobs','ai_usage'])assert.equal((await query(`SELECT 1 FROM ${table} WHERE actor_id=$1`,[actorId])).rowCount,0);
 assert.equal((await query("SELECT 1 FROM outbox WHERE kind='ai-media' AND account_id=$1",[actorId])).rowCount,0);
 assert.equal((await query("SELECT 1 FROM audit_events WHERE action='ai.job.created' AND actor_id=$1",[actorId])).rowCount,0);
}

test('AI requests cannot reserve budget, queue, cancel or retain images using a revoked originating session',{timeout:90000},async t=>withCrmRecoveryDatabase('ai_session',async({storage})=>{
 const settings={AI_PROVIDER:'openrouter',OPENROUTER_API_KEY:'isolated-test-ai-session-key',OPENROUTER_IMAGE_MODEL:'test/image',OPENROUTER_AUDIO_MODEL:'test/audio',OPENROUTER_VIDEO_MODEL:'test/video',AI_DAILY_BUDGET_USD:'500',AI_MONTHLY_BUDGET_USD:'500',AI_REQUEST_RESERVE_USD:'0.01',AI_AUDIO_RESERVE_USD:'0.01',AI_VIDEO_RESERVE_USD:'0.01',RAG_ENABLED:'false'};
 const previous=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));Object.assign(process.env,settings);
 try{
  for(const reason of ['logout','absolute expiry','idle expiry'])await t.test(reason+' prevents media job creation and budget reservation',async()=>{
   const f=await current();
   if(reason==='logout')await logout(f.context);
   else if(reason==='absolute expiry')await query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[f.id]);
   else await query("UPDATE sessions SET last_seen_at=now()-interval '2 days' WHERE id=$1",[f.id]);
   await assert.rejects(createAiJob(f.context.actor,{mode:'audio',prompt:'Isolated session fixture',locale:'en'}),refused);
   await noQueuedWork(f.context.actor.id);
  });
  await t.test('Removing only the session MFA proof prevents a media job despite active account MFA',async()=>{
   const f=await current();await query('UPDATE sessions SET mfa_verified=false WHERE id=$1',[f.id]);
   await assert.rejects(createAiJob(f.context.actor,{mode:'audio',prompt:'Isolated fixture',locale:'en'}),error=>error?.status===403);
   await noQueuedWork(f.context.actor.id);
  });
  await t.test('An HTTP job request paused while reading its JSON cannot commit after logout',async()=>{
   const f=await current(),bytes=new TextEncoder().encode(JSON.stringify({mode:'audio',prompt:'Delayed HTTP fixture',locale:'en'}));
   let entered=false,release;const gate=new Promise(resolve=>{release=resolve;});
   const body=new ReadableStream({async pull(controller){entered=true;await gate;controller.enqueue(bytes);controller.close();}},{highWaterMark:0});
   const request=new Request(origin+'/api/v1/ai/jobs',{method:'POST',headers:{...f.headers,'content-type':'application/json'},body,duplex:'half'});
   const pending=handleRequest(request,['ai','jobs']);
   try{
    await waitFor(()=>entered);await logout(f.context);release();
    const response=await pending;assert.equal(response.status,401);assert.equal((await response.json()).code,'SESSION_REQUIRED');await noQueuedWork(f.context.actor.id);
   }finally{release();await pending;}
  });
  await t.test('A revoked session cannot cancel or read a previously accepted owned job',async()=>{
   const f=await current(),job=await createAiJob(f.context.actor,{mode:'audio',prompt:'Accepted fixture',locale:'en'});
   const before=(await query('SELECT * FROM ai_jobs WHERE id=$1',[job.id])).rows[0];
   await logout(f.context);
   await assert.rejects(cancelAiJob(f.context.actor,job.id),refused);await assert.rejects(getAiJobs(f.context.actor,job.id),refused);
   assert.deepEqual((await query('SELECT * FROM ai_jobs WHERE id=$1',[job.id])).rows[0],before);
   assert.equal((await query('SELECT state FROM ai_usage WHERE id=$1',[before.input.usageId])).rows[0].state,'reserved');
   assert.equal((await query('SELECT state FROM outbox WHERE dedupe_key=$1',['ai-media:'+job.id])).rows[0].state,'pending');
  });
  await t.test('Logout during synchronous image generation leaves no asset, retained bytes or generated audit',async()=>{
   const f=await current(),png=await sharp({create:{width:8,height:8,channels:3,background:{r:20,g:80,b:100}}}).png().toBuffer();
   const filesBefore=await readdir(join(storage,'private')).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error));let calls=0;
   await assert.rejects(generateAi(f.context.actor,'',{mode:'image',prompt:'Private generated fixture',locale:'en'},false,undefined,async(url)=>{
    calls++;assert.equal(url,'https://openrouter.ai/api/v1/images');await logout(f.context);
    return new Response(JSON.stringify({data:[{b64_json:png.toString('base64'),media_type:'image/png'}]}),{headers:{'content-type':'application/json'}});
   }),refused);
   assert.equal(calls,1);assert.equal((await query('SELECT 1 FROM assets WHERE owner_id=$1',[f.context.actor.id])).rowCount,0);
   assert.equal((await query("SELECT 1 FROM storage_reservations WHERE subject_key=$1 AND state='reserved'",['user:'+f.context.actor.id])).rowCount,0);
   assert.equal((await query("SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='asset.generated'",[f.context.actor.id])).rowCount,0);
   assert.deepEqual(await readdir(join(storage,'private')).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error)),filesBefore);
   assert.equal((await query('SELECT state FROM ai_usage WHERE actor_id=$1',[f.context.actor.id])).rows[0].state,'uncertain');
  });
  await t.test('A legitimately queued worker continues after ordinary logout while rechecking current account permissions',async()=>{
   const f=await current(),job=await createAiJob(f.context.actor,{mode:'audio',prompt:'Accepted worker fixture',locale:'en'});
   await logout(f.context);const audio=await readFile(new URL('./fixtures/resource-upload/audio.mp3',import.meta.url));let calls=0;
   await processAiJob(job.id,async()=>{calls++;return new Response(audio,{headers:{'content-type':'audio/mpeg'}});});
   const row=(await query('SELECT * FROM ai_jobs WHERE id=$1',[job.id])).rows[0];assert.equal(calls,1);assert.equal(row.status,'completed');assert.equal(row.output.media.scanStatus,'pending');
  });
 }finally{for(const key of Object.keys(settings))if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
}));
