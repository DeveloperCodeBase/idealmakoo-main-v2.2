import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,localized} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {decrypt,encrypt} from '../src/server/crypto.ts';
import {getWorkspace,saveWorkspace} from '../src/server/workspace.ts';
import {proposeContentTranslation,applyContentTranslation} from '../src/server/content-ai.ts';

async function waitFor(predicate,message){
 const deadline=Date.now()+10000;
 while(!await predicate()){assert.ok(Date.now()<deadline,message);await new Promise(resolve=>setTimeout(resolve,10));}
}

test('A translation proposal that expires while waiting for the real workspace lock cannot change its target',{timeout:90000},async()=>withCrmRecoveryDatabase('translation_expiry',async({scoped})=>{
 const settings={AI_PROVIDER:'openrouter',OPENROUTER_API_KEY:'isolated-test-expiry-key',OPENROUTER_TEXT_MODEL:'test/translation',AI_DAILY_BUDGET_USD:'500',AI_MONTHLY_BUDGET_USD:'500',AI_REQUEST_RESERVE_USD:'0.01'};
 const previous=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));Object.assign(process.env,settings);
 try{
  const owner=fixtureActor('translation-expiry-owner','admin'),translator=fixtureActor('translation-expiry-editor','translator',{allowedLocales:['en']});
  await insertActor(owner);await insertActor(translator);
  const initial=await getWorkspace(owner),at=new Date().toISOString(),article={id:'TRANSLATION-EXPIRY',collection:'news',title:{...localized(''),fa:'عنوان مبدأ',en:'Existing title'},summary:{...localized(''),fa:'خلاصه مبدأ',en:'Existing summary'},status:'draft',owner:owner.role,author:owner.role,authorId:owner.id,createdAt:at,updatedAt:at,tags:[],history:[],demo:false,details:{}};
  await saveWorkspace(owner,{state:{...initial.state,records:[...initial.state.records,article]},expectedVersion:initial.version,locale:'fa'});
  const saved=(await getWorkspace(owner)).state.records.find(row=>row.id===article.id);
  const proposal=await proposeContentTranslation(translator,{bucket:'records',id:saved.id,sourceLocale:'fa',locale:'en',expectedUpdatedAt:saved.updatedAt},undefined,async(url,options)=>{
   const body=JSON.parse(options.body),source=JSON.parse(body.messages.at(-1).content),values=Object.fromEntries(Object.keys(source).map(key=>[key,'Translated text']));
   return new Response(JSON.stringify({id:randomUUID(),choices:[{message:{content:JSON.stringify(values)}}],usage:{total_tokens:10,cost:0.001}}),{headers:{'content-type':'application/json'}});
  });
  const before=(await query("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1",[article.id])).rows[0].data;
  const version=(await getWorkspace(translator)).version,values=Object.fromEntries(proposal.fields.map(field=>[field.key,field.value]));
  const blocker=new pg.Client({connectionString:scoped.toString()});await blocker.connect();let locked=false,pending;
  try{
   await blocker.query('BEGIN');locked=true;await blocker.query('SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE');
   const payload=JSON.parse(decrypt(proposal.token));payload.expiresAt=Date.now()+1500;payload.createdAt=payload.expiresAt-20*60*1000;
   pending=applyContentTranslation(translator,{token:encrypt(JSON.stringify(payload)),values,expectedVersion:version}).then(value=>({value}),error=>({error}));
   await waitFor(async()=>(await query("SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'",[blocker.processID])).rowCount>0,'The proposal did not wait for the real workspace lock before expiring.');
   await waitFor(()=>Date.now()>=payload.expiresAt,'The proposal deadline did not elapse.');
   await blocker.query('COMMIT');locked=false;
   const result=await pending;assert.equal(result.error?.status,409);assert.equal(result.error?.code,'TRANSLATION_EXPIRED');
   assert.deepEqual((await query("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1",[article.id])).rows[0].data,before);
   assert.equal((await query("SELECT 1 FROM audit_events WHERE action='content.translation.applied' AND details->>'proposalId'=$1",[proposal.id])).rowCount,0);
  }finally{if(locked)await blocker.query('ROLLBACK');if(pending)await pending;await blocker.end();}
 }finally{for(const key of Object.keys(settings))if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
}));
