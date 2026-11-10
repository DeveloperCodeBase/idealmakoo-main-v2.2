import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {access} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {query, transaction} from '../src/server/db.ts';
import {hash} from '../src/server/crypto.ts';
import {sessionFor, logout, resetPassword} from '../src/server/auth.ts';
import {loadCrmAccess} from '../src/server/workspace-scopes.ts';
import {handleRequest} from '../src/server/router.ts';
import {getWorkspace} from '../src/server/workspace.ts';
import {getSettings, patchSettings, patchPortal} from '../src/server/account.ts';
import {createWishlist} from '../src/server/wishlists.ts';
import {createRequest} from '../src/server/requests.ts';
import {createPrivacyRequest, exportPrivacyRequest} from '../src/server/privacy.ts';
import {savePartnerPublicProfile, commandPartnerPublicProfile} from '../src/server/partner-directory.ts';
import {products} from '../src/data/catalog.ts';
import {fixtureActor, insertActor, recordFixture, permissions, withCrmRecoveryDatabase} from './helpers/crm-recovery-environment.mjs';

const origin='http://localhost:3000';
const revoked=error=>error?.status===401&&error?.code==='SESSION_REQUIRED';
const waitFor=async predicate=>{
  const until=Date.now()+10000;
  while(!await predicate()){
    assert.ok(Date.now()<until,'The isolated request did not reach its synchronization point.');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
};
async function httpSession(role='customer'){
  const actor=fixtureActor('session-proof-'+randomUUID(),role);
  await insertActor(actor,{scope:'all',grants:permissions});
  const id=randomUUID(),raw=randomUUID()+randomUUID(),csrf=randomUUID()+randomUUID();
  await query("INSERT INTO sessions(id,token_hash,user_id,csrf_token,mfa_verified,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[id,hash(raw),actor.id,csrf,actor.mfaVerified]);
  const headers={cookie:'im_session='+raw,origin,'sec-fetch-site':'same-origin','x-csrf-token':csrf};
  const context=await sessionFor(new Request(origin+'/api/v1/auth/session',{headers}));
  assert.ok(context);
  return{id,context,headers};
}

test('HTTP-derived authority remains bound to its live originating session throughout delayed work',{timeout:180000},async t=>withCrmRecoveryDatabase('session_revalidation',async({scoped,storage})=>{
  const owner=fixtureActor('session-test-owner','superAdmin');
  await insertActor(owner,{scope:'all',grants:permissions});
  await getWorkspace(owner);

  for(const invalidation of['revoked','expired','idle'])await t.test('Captured and spread actors reject a '+invalidation+' originating session',async()=>{
    const current=await httpSession('contentEditor');
    const snapshot={...await loadCrmAccess(current.context.actor)};
    if(invalidation==='revoked')await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[current.id]);
    if(invalidation==='expired')await query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[current.id]);
    if(invalidation==='idle')await query("UPDATE sessions SET last_seen_at=now()-interval '2 days' WHERE id=$1",[current.id]);
    await assert.rejects(loadCrmAccess(snapshot),revoked);
    await assert.rejects(transaction(client=>loadCrmAccess(snapshot,client)),revoked);
  });

  await t.test('A live session does not retain a removed MFA proof and internal session provenance is not JSON data',async()=>{
    const current=await httpSession('contentEditor');
    assert.equal(current.context.actor.mfaVerified,true);
    const serialized=JSON.stringify(current.context.actor);
    assert.equal(serialized.includes(current.id),false);
    assert.equal(serialized.includes(current.headers.cookie),false);
    await query('UPDATE sessions SET mfa_verified=false WHERE id=$1',[current.id]);
    assert.equal((await loadCrmAccess({...current.context.actor})).mfaVerified,false);
  });

  await t.test('A captured HTTP actor cannot acquire authority by substituting another account identity',async()=>{
    const current=await httpSession();
    await assert.rejects(loadCrmAccess({...current.context.actor,id:owner.id}),revoked);
  });

  for(const invalidation of['logout','password-reset'])await t.test('A multipart upload paused after authentication cannot commit after '+invalidation,async()=>{
    const current=await httpSession(),form=new FormData();
    form.set('file',new Blob([Buffer.from('%PDF-1.7\nIsolated session revalidation fixture.\n')],{type:'application/pdf'}),'session-fixture.pdf');
    const encoded=new Request(origin+'/api/v1/attachments',{method:'POST',body:form});
    const bytes=new Uint8Array(await encoded.arrayBuffer());
    let entered=false,release;
    const gate=new Promise(resolve=>{release=resolve;});
    const stream=new ReadableStream({async pull(controller){entered=true;await gate;controller.enqueue(bytes);controller.close();}},{highWaterMark:0});
    const request=new Request(origin+'/api/v1/attachments',{method:'POST',headers:{...current.headers,'content-type':encoded.headers.get('content-type')},body:stream,duplex:'half'});
    const attempt=handleRequest(request,['attachments']);
    try{
      await waitFor(()=>entered);
      if(invalidation==='logout')await logout(current.context);
      else{
        const token=randomUUID()+randomUUID();
        await query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'password_reset',now()+interval '5 minutes')",[hash(token),current.context.actor.id]);
        await resetPassword({token,password:'Isolated-reset-'+randomUUID()});
      }
      release();
      const response=await attempt,body=await response.json();
      assert.equal(response.status,401);
      assert.equal(body.error?.code,'SESSION_REQUIRED');
      assert.equal((await query('SELECT 1 FROM assets WHERE owner_id=$1',[current.context.actor.id])).rowCount,0);
      assert.equal((await query("SELECT 1 FROM storage_reservations WHERE subject_key=$1 AND state='reserved'",['user:'+current.context.actor.id])).rowCount,0);
      assert.equal((await query("SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='asset.uploaded'",[current.context.actor.id])).rowCount,0);
      for(const row of(await query('SELECT storage_key FROM storage_reservations WHERE subject_key=$1',['user:'+current.context.actor.id])).rows)
        await assert.rejects(access(join(storage,row.storage_key)),error=>error?.code==='ENOENT');
    }finally{release();await attempt;}
  });

  await t.test('An account profile mutation cannot use a session captured before logout',async()=>{
    const current=await httpSession(),settings=await getSettings(current.context.actor);
    await logout(current.context);
    await assert.rejects(patchSettings(current.context.actor,'profile',{name:'Invalid stale-session name'},settings.revision),revoked);
    assert.notEqual((await query('SELECT name FROM users WHERE id=$1',[current.context.actor.id])).rows[0].name,'Invalid stale-session name');
  });

  await t.test('Account portal and saved-list mutations cannot use a captured revoked session',async()=>{
    const current=await httpSession();await getSettings(current.context.actor);await logout(current.context);
    await assert.rejects(patchPortal(current.context.actor,{notificationsRead:['revoked-proof']}),revoked);
    await assert.rejects(createWishlist(current.context.actor,{name:'Revoked fixture list'}),revoked);
    assert.equal((await query('SELECT 1 FROM wishlists WHERE user_id=$1',[current.context.actor.id])).rowCount,0);
    assert.equal((await query('SELECT portal FROM user_settings WHERE user_id=$1',[current.context.actor.id])).rows[0].portal.notificationsRead?.includes('revoked-proof')??false,false);
  });

  await t.test('Transaction authorization holds user then session locks until the mutation completes',async()=>{
    const current=await httpSession('contentEditor'),control=new pg.Client({connectionString:scoped.toString()});
    await control.connect();
    let entered=false,release,revocation,revocationDone=false;
    const gate=new Promise(resolve=>{release=resolve;});
    const mutation=transaction(async client=>{await loadCrmAccess(current.context.actor,client);entered=true;await gate;await client.query('UPDATE users SET name=$2 WHERE id=$1',[current.context.actor.id,'Accepted before revocation']);});
    try{
      await waitFor(()=>entered);
      const backend=(await control.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      revocation=control.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[current.id]).then(()=>{revocationDone=true;});
      await waitFor(async()=>revocationDone||(await query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",[backend])).rowCount>0);
      assert.equal(revocationDone,false,'Session revocation must serialize with the authorized transaction.');
      release();await mutation;await revocation;
      await assert.rejects(loadCrmAccess(current.context.actor),revoked);
    }finally{release();await mutation;await revocation;await control.end();}
  });

  await t.test('Independent worker actors still load current account authority without an HTTP session',async()=>{
    const worker=fixtureActor('independent-worker-actor','publisher');
    await insertActor(worker,{scope:'all',grants:permissions});
    assert.equal((await transaction(client=>loadCrmAccess(worker,client))).role,'publisher');
    await query('UPDATE users SET active=false WHERE id=$1',[worker.id]);
    await assert.rejects(loadCrmAccess(worker),revoked);
  });

  await t.test('An authorized privacy export evaluates the subject separately from the administrator session',async()=>{
    const admin=await httpSession('superAdmin'),customer=await httpSession();
    const actor=customer.context.actor;
    const request=await createRequest(new Request(origin+'/api/v1/requests'),actor,{kind:'rfq',productIds:[products[0].id],name:actor.name,email:actor.email,message:'A disposable request for independent privacy subject authorization.',consent:{purpose:'request_processing',acceptedAt:new Date().toISOString()}},'privacy-session-proof-'+randomUUID());
    await query("INSERT INTO request_messages(id,request_id,body,visibility,actor_id) VALUES($1,$2,'Do not export internal fixture text','internal',$3)",[randomUUID(),request.id,admin.context.actor.id]);
    await logout(customer.context);
    const exported=await createPrivacyRequest(admin.context.actor,{subject:{type:'user',id:actor.id},action:'export',reason:'Authorized export of an independent disposable customer subject.'});
    const response=await exportPrivacyRequest(admin.context.actor,exported.id),body=await response.text();
    assert.equal(response.status,200);assert.ok(body.includes(actor.email));assert.ok(body.includes(request.id));
    assert.equal(body.includes('Do not export internal fixture text'),false);
  });

  await t.test('Publishing an approved profile checks independent reviewer authority without borrowing the publisher session',async()=>{
    const publisher=await httpSession('superAdmin'),reviewer=await httpSession('superAdmin'),actor=publisher.context.actor;
    const account=await recordFixture(actor,{collection:'accounts'}),partner=await recordFixture(actor,{collection:'partners'}),territory=randomUUID();
    await query("INSERT INTO crm_account_profiles(record_id,display_name,legal_name,activity,lifecycle,registrations,addresses) VALUES($1,'Disposable account','Disposable account','distributor','active','[]','[]')",[account.id]);
    await query("INSERT INTO crm_territories(id,name,created_by) VALUES($1,$2,$3)",[territory,'Disposable territory '+territory,actor.id]);
    await query("INSERT INTO crm_partner_agreements(partner_id,account_id,territory_id,product_ids,valid_from,exclusive,active,reference) VALUES($1,$2,$3,'{}',current_date-1,false,true,'Disposable independent-review fixture')",[partner.id,account.id,territory]);
    let profile=await savePartnerPublicProfile(actor,partner.id,{locale:'en',slug:'session-review-'+randomUUID(),expectedVersion:0,value:{name:'Disposable representative',summary:'An isolated reviewer authorization fixture.',country:'Iran',province:'Tehran',city:'Tehran',address:'Disposable test address',email:'representative@example.invalid',phone:'',website:'',coordinates:null,families:['teeth'],license:{number:'TEST',issuer:'Disposable test issuer',validFrom:'2020-01-01',validTo:'2099-01-01',state:'verified',verificationNote:'Independently verified disposable fixture.'}}});
    profile=await commandPartnerPublicProfile(actor,profile.id,{action:'submit',reason:'Submit isolated fixture for independent review.'},profile.version);
    profile=await commandPartnerPublicProfile(reviewer.context.actor,profile.id,{action:'approve',reason:'Independently approve the exact fixture revision.'},profile.version);
    await logout(reviewer.context);
    profile=await commandPartnerPublicProfile(actor,profile.id,{action:'publish',reason:'Publish approved fixture using independent reviewer authority.'},profile.version);
    assert.equal(profile.publicAvailable,true);assert.equal(profile.current.approvedBy,reviewer.context.actor.id);
  });
}));
