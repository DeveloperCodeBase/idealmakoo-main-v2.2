import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {withCrmRecoveryDatabase,fixtureActor,insertActor} from './helpers/crm-recovery-environment.mjs';
import {createAiJob,generateAi,processAiJob,pollVideoJobs} from '../src/server/ai.ts';
import {query} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';

const actor=fixtureActor('media-authority-editor','contentEditor',{allowedLocales:['en']});
const denied=error=>error instanceof HttpError&&[401,403].includes(error.status);
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const currentJob=async id=>(await query('SELECT * FROM ai_jobs WHERE id=$1',[id])).rows[0];
const usage=async id=>(await query('SELECT * FROM ai_usage WHERE id=$1',[id])).rows[0];
async function restoreGrants(){await query("UPDATE users SET active=true,role='contentEditor',mfa_enabled=true,allowed_locales='[\"en\"]'::jsonb WHERE id=$1",[actor.id]);await query('DELETE FROM rate_limits');}
async function inventory(storage){return{assets:(await query('SELECT id,storage_key FROM assets ORDER BY id')).rows,files:await readdir(join(storage,'private')).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error)),scans:(await query("SELECT id FROM outbox WHERE kind='scan' ORDER BY id")).rows,generated:(await query("SELECT id FROM audit_events WHERE action='asset.generated' ORDER BY id")).rows};}
async function videoJob(){await restoreGrants();const job=await createAiJob(actor,{mode:'video',prompt:'Controlled fixture',locale:'en',duration:2});await processAiJob(job.id,async url=>{assert.equal(url,'https://openrouter.ai/api/v1/videos');return json({id:'fixture_'+randomUUID().replaceAll('-','')});});await query("UPDATE ai_jobs SET updated_at=now()-interval '60 seconds' WHERE id=$1",[job.id]);return currentJob(job.id);}

test('AI media uses current authority and atomically commits assets and jobs on real PostgreSQL',{timeout:180000},async t=>withCrmRecoveryDatabase('ai_media',async({storage})=>{
 const settings={AI_PROVIDER:'openrouter',OPENROUTER_API_KEY:'isolated-media-provider-key',OPENROUTER_IMAGE_MODEL:'test/image',OPENROUTER_VIDEO_MODEL:'test/video',OPENROUTER_AUDIO_MODEL:'test/audio',AI_DAILY_BUDGET_USD:'500',AI_MONTHLY_BUDGET_USD:'500',AI_REQUEST_RESERVE_USD:'0.01',AI_VIDEO_RESERVE_USD:'0.01',AI_AUDIO_RESERVE_USD:'0.01',RAG_ENABLED:'false'},old=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));
 Object.assign(process.env,settings);
 try{
  await insertActor(actor);
  const png=await sharp({create:{width:8,height:8,channels:3,background:{r:20,g:80,b:100}}}).png().toBuffer(),audio=await readFile(new URL('./fixtures/resource-upload/audio.mp3',import.meta.url)),video=await readFile(new URL('./fixtures/resource-upload/video.mp4',import.meta.url));
  await t.test('A stale actor cannot reserve money or queue media after its staff role is removed',async()=>{
   const before=(await query('SELECT count(*)::int AS n FROM ai_usage')).rows[0].n;
   await query("UPDATE users SET role='customer' WHERE id=$1",[actor.id]);
   await assert.rejects(createAiJob(actor,{mode:'audio',prompt:'Fixture',locale:'en'}),denied);
   assert.equal((await query('SELECT count(*)::int AS n FROM ai_jobs')).rows[0].n,0);assert.equal((await query('SELECT count(*)::int AS n FROM ai_usage')).rows[0].n,before);await restoreGrants();
  });
  await t.test('Image results cannot persist after role, MFA, locale or account revocation during the provider wait',async()=>{
   for(const mutation of["role='customer'","mfa_enabled=false","allowed_locales='[\"fa\"]'::jsonb","active=false"]){
    await restoreGrants();const before=await inventory(storage);
    await assert.rejects(generateAi(actor,'',{mode:'image',prompt:'A controlled test image',locale:'en'},false,undefined,async(url,options)=>{
     assert.equal(url,'https://openrouter.ai/api/v1/images');assert.equal(options.redirect,'error');await query('UPDATE users SET '+mutation+' WHERE id=$1',[actor.id]);return json({data:[{b64_json:png.toString('base64'),media_type:'image/png'}]});
    }),denied);
    assert.deepEqual(await inventory(storage),before);assert.equal((await query("SELECT count(*)::int AS n FROM storage_reservations WHERE state='reserved'")).rows[0].n,0);
   }
   await restoreGrants();
  });
  await t.test('An authorized generated image is sanitized, private and charged to the owner storage quota',async()=>{
   const result=await generateAi(actor,'',{mode:'image',prompt:'A controlled test image',locale:'en'},false,undefined,async()=>json({data:[{b64_json:png.toString('base64'),media_type:'image/png'}]}));
   const id=result.image.url.split('/').at(-1),row=(await query('SELECT * FROM assets WHERE id=$1',[id])).rows[0];assert.equal(row.owner_id,actor.id);assert.equal(row.visibility,'private');assert.equal(row.scan_status,'clean');assert.equal(row.mime_type,'image/webp');assert.equal(row.metadata.locale,'en');assert.equal(row.quota_subject,'user:'+actor.id);assert.equal((await usage(result.id)).state,'complete');assert.ok((await readFile(join(storage,row.storage_key))).length>0);
  });
  await t.test('A queued job loses permission before submission without contacting the provider or retaining a budget reservation',async()=>{
   await restoreGrants();const job=await createAiJob(actor,{mode:'audio',prompt:'Fixture',locale:'en'});await query('UPDATE users SET mfa_enabled=false WHERE id=$1',[actor.id]);let calls=0;await processAiJob(job.id,async()=>{calls++;throw new Error('Must not contact provider');});const row=await currentJob(job.id);assert.equal(calls,0);assert.equal(row.status,'failed');assert.equal((await usage(row.input.usageId)).state,'failed');await restoreGrants();
  });
  await t.test('Audio permission is checked after the provider returns and leaves no file, scan, audit or completed job on refusal',async()=>{
   await restoreGrants();const job=await createAiJob(actor,{mode:'audio',prompt:'Fixture',locale:'en'}),before=await inventory(storage);
   await assert.rejects(processAiJob(job.id,async url=>{assert.equal(url,'https://openrouter.ai/api/v1/audio/speech');await query("UPDATE users SET allowed_locales='[\"tr\"]'::jsonb WHERE id=$1",[actor.id]);return new Response(audio,{headers:{'content-type':'audio/mpeg'}});}),denied);
   const row=await currentJob(job.id);assert.equal(row.status,'failed');assert.equal(row.output,null);assert.equal((await usage(row.input.usageId)).state,'uncertain');assert.deepEqual(await inventory(storage),before);await restoreGrants();
  });
  await t.test('Successful audio commits one private quarantined asset, job output, usage and completion audit together',async()=>{
   await restoreGrants();const job=await createAiJob(actor,{mode:'audio',prompt:'Fixture',locale:'en'});let calls=0;const provider=async()=>{calls++;return new Response(audio,{headers:{'content-type':'audio/mpeg'}});};await processAiJob(job.id,provider);await processAiJob(job.id,provider);
   const row=await currentJob(job.id),id=row.output.media.url.split('/').at(-1),asset=(await query('SELECT * FROM assets WHERE id=$1',[id])).rows[0];assert.equal(calls,1);assert.equal(row.status,'completed');assert.equal(asset.scan_status,'pending');assert.equal(asset.visibility,'private');assert.equal(asset.metadata.provider,'openrouter');assert.equal((await usage(row.input.usageId)).state,'complete');assert.equal((await query("SELECT count(*)::int AS n FROM outbox WHERE kind='scan' AND payload->>'assetId'=$1",[id])).rows[0].n,1);assert.equal((await query("SELECT count(*)::int AS n FROM audit_events WHERE action='ai.job.completed' AND entity_id=$1",[job.id])).rows[0].n,1);
  });
  await t.test('Video polling checks revoked access before any status or content fetch',async()=>{
   const job=await videoJob(),before=await inventory(storage);await query("UPDATE users SET role='customer' WHERE id=$1",[actor.id]);let calls=0;await pollVideoJobs(async()=>{calls++;throw new Error('No delivery after revocation');});const row=await currentJob(job.id);assert.equal(calls,0);assert.equal(row.status,'failed');assert.equal(row.output,null);assert.equal((await usage(row.input.usageId)).state,'uncertain');assert.deepEqual(await inventory(storage),before);await restoreGrants();
  });
  await t.test('Video permission is checked again after a successful download and no discarded result is persisted',async()=>{
   const job=await videoJob(),before=await inventory(storage);let calls=0;await pollVideoJobs(async url=>{calls++;if(!url.endsWith('/content'))return json({status:'completed'});await query('UPDATE users SET mfa_enabled=false WHERE id=$1',[actor.id]);return new Response(video,{headers:{'content-type':'video/mp4'}});});assert.equal(calls,2);assert.equal((await currentJob(job.id)).status,'failed');assert.deepEqual(await inventory(storage),before);await restoreGrants();
  });
  await t.test('Video delivery commits once with bounded nonnegative provider cost and never overwrites a completed job',async()=>{
   const job=await videoJob();let calls=0;const provider=async url=>{calls++;return url.endsWith('/content')?new Response(video,{headers:{'content-type':'video/mp4'}}):json({status:'completed',usage:{cost:-2}});};await pollVideoJobs(provider);await pollVideoJobs(provider);
   const row=await currentJob(job.id);assert.equal(calls,2);assert.equal(row.status,'completed');assert.equal(row.output.media.scanStatus,'pending');assert.equal((await usage(row.input.usageId)).actual_usd,null);assert.equal((await query("SELECT count(*)::int AS n FROM audit_events WHERE action='ai.job.completed' AND entity_id=$1",[job.id])).rows[0].n,1);
  });
  await t.test('A competing worker result cannot create an orphan or overwrite an already completed job',async()=>{
   const job=await videoJob(),before=await inventory(storage),output={text:'Previously committed competing result'};
   await pollVideoJobs(async url=>{if(!url.endsWith('/content'))return json({status:'completed'});await query("UPDATE ai_jobs SET status='completed',output=$2::jsonb WHERE id=$1",[job.id,JSON.stringify(output)]);return new Response(video,{headers:{'content-type':'video/mp4'}});});assert.deepEqual((await currentJob(job.id)).output,output);assert.deepEqual(await inventory(storage),before);assert.equal((await query("SELECT count(*)::int AS n FROM storage_reservations WHERE state='reserved'")).rows[0].n,0);
  });
 }finally{for(const key of Object.keys(settings))if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
}));
