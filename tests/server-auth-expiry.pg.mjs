import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {query} from '../src/server/db.ts';
import {config} from '../src/server/config.ts';
import {hash,encrypt,newTotpSecret,passwordHash,totp} from '../src/server/crypto.ts';
import {sessionFor,requestEmailVerification,confirmEmailVerification,verifyMfa,resetPassword} from '../src/server/auth.ts';
import {fixtureActor,insertActor,withCrmRecoveryDatabase} from './helpers/crm-recovery-environment.mjs';

const settle=promise=>promise.then(value=>({value}),error=>({error}));
async function waitFor(read,message){
  const deadline=Date.now()+10000;
  for(;;){
    const value=await read();if(value)return value;
    assert.ok(Date.now()<deadline,message);
    await new Promise(resolve=>setTimeout(resolve,10));
  }
}

// Hold the same user row as a concurrent credential mutation. Move the proof's
// deadline between the waiting transaction's start and the actual lock release.
// PostgreSQL and the production operation are real: neither clock nor SQL calls
// are mocked, and no long sleep or password-derivation race is required.
async function afterUserWait(scoped,userId,operation,expire){
  const blocker=new pg.Client({connectionString:scoped.toString()});
  await blocker.connect();let locked=false,pending;
  try{
    await blocker.query('BEGIN');locked=true;
    await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    pending=settle(operation());
    const pid=await waitFor(async()=>(await query(
      "SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock' AND xact_start IS NOT NULL",
      [blocker.processID])).rows[0]?.pid,'The credential operation did not wait for the real user lock.');
    await expire(pid);
    await blocker.query('COMMIT');locked=false;
    return await pending;
  }finally{
    if(locked)await blocker.query('ROLLBACK');
    if(pending)await pending;
    await blocker.end();
  }
}

test('Credential proofs use the actual time after waiting for a user lock',{timeout:60000},async t=>withCrmRecoveryDatabase('auth_expiry',async({scoped})=>{
  const password='Expiry-fixture-'+randomUUID(),encoded=await passwordHash(password);
  async function fixture({mfa=false}={}){
    const actor=fixtureActor('expiry-'+randomUUID(),'customer',{qualityScope:false,mfaVerified:mfa});
    await insertActor(actor,{mfa,verified:false});
    const secret=newTotpSecret();
    await query('UPDATE users SET password_hash=$2,mfa_secret=$3,mfa_last_counter=-1 WHERE id=$1',[actor.id,encoded,mfa?encrypt(secret):null]);
    const id=randomUUID(),raw=randomUUID()+randomUUID();
    await query("INSERT INTO sessions(id,token_hash,user_id,csrf_token,mfa_verified,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[id,hash(raw),actor.id,randomUUID(),mfa]);
    const context=await sessionFor(new Request('http://localhost:3000/api/v1/auth/session',{headers:{cookie:'im_session='+raw}}));
    assert.ok(context);return{actor,id,context,secret};
  }
  for(const kind of ['absolute','idle'])await t.test(kind+' session expiry during the wait prevents a new email-verification proof',async()=>{
    const f=await fixture();
    const result=await afterUserWait(scoped,f.actor.id,()=>requestEmailVerification(f.context,{}),async pid=>{
      const sql=kind==='absolute'
        ? "UPDATE sessions s SET expires_at=a.xact_start+interval '1 millisecond' FROM pg_stat_activity a WHERE s.id=$1 AND a.pid=$2"
        : "UPDATE sessions s SET last_seen_at=a.xact_start-($3*interval '1 minute')+interval '1 millisecond' FROM pg_stat_activity a WHERE s.id=$1 AND a.pid=$2";
      await query(sql,kind==='absolute'?[f.id,pid]:[f.id,pid,config().idleMinutes]);
      await waitFor(async()=>(await query(kind==='absolute'
        ? 'SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE id=$1'
        : "SELECT last_seen_at<=clock_timestamp()-($2*interval '1 minute') AS expired FROM sessions WHERE id=$1",
        kind==='absolute'?[f.id]:[f.id,config().idleMinutes])).rows[0].expired,'The fixture session deadline was not crossed.');
    });
    assert.equal(result.error?.status,401);assert.equal(result.error?.code,'SESSION_REQUIRED');
    assert.equal((await query('SELECT 1 FROM auth_challenges WHERE user_id=$1',[f.actor.id])).rowCount,0);
    assert.equal((await query('SELECT 1 FROM outbox WHERE account_id=$1',[f.actor.id])).rowCount,0);
    assert.equal((await query("SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='auth.email.verification_requested'",[f.actor.id])).rowCount,0);
  });
  for(const purpose of ['mfa','password_reset','email_verify'])await t.test(purpose+' challenge expiring during the wait cannot be consumed',async()=>{
    const f=await fixture({mfa:purpose==='mfa'}),raw=randomUUID()+randomUUID();
    const digest=hash(purpose==='email_verify'?raw+'\0'+f.actor.email:raw);
    await query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest,f.actor.id,purpose]);
    const operation=purpose==='mfa'
      ? ()=>verifyMfa(new Request('http://localhost:3000/api/v1/auth/mfa/verify'),{challengeToken:raw,code:totp(f.secret,Math.floor(Date.now()/30000))})
      : purpose==='password_reset'
        ? ()=>resetPassword({token:raw,password:'Replacement-'+randomUUID()})
        : ()=>confirmEmailVerification(f.context,{token:raw});
    const result=await afterUserWait(scoped,f.actor.id,operation,async pid=>{
      await query("UPDATE auth_challenges c SET expires_at=a.xact_start+interval '1 millisecond' FROM pg_stat_activity a WHERE c.token_hash=$1 AND a.pid=$2",[digest,pid]);
      await waitFor(async()=>(await query('SELECT expires_at<=clock_timestamp() AS expired FROM auth_challenges WHERE token_hash=$1',[digest])).rows[0].expired,'The fixture challenge deadline was not crossed.');
    });
    const expected=purpose==='mfa'?[401,'MFA_INVALID']:purpose==='password_reset'?[422,'RESET_EXPIRED']:[422,'VERIFY_EXPIRED'];
    assert.equal(result.error?.status,expected[0]);assert.equal(result.error?.code,expected[1]);
    const challenge=(await query('SELECT consumed_at,attempts FROM auth_challenges WHERE token_hash=$1',[digest])).rows[0];
    assert.equal(challenge.consumed_at,null);assert.equal(challenge.attempts,0);
    const user=(await query('SELECT password_hash,email_verified,mfa_last_counter FROM users WHERE id=$1',[f.actor.id])).rows[0];
    assert.equal(user.password_hash,encoded);assert.equal(user.email_verified,false);assert.equal(user.mfa_last_counter,'-1');
    const sessions=(await query('SELECT id,revoked_at FROM sessions WHERE user_id=$1',[f.actor.id])).rows;
    assert.deepEqual(sessions,[{id:f.id,revoked_at:null}]);
  });
}));
