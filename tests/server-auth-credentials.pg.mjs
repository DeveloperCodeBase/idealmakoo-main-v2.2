import test from 'node:test';
import assert from 'node:assert/strict';
import crypto,{randomUUID,randomBytes} from 'node:crypto';
import {promisify} from 'node:util';
import pg from 'pg';
import {holdDerivations} from './helpers/native-kdf-barrier.mjs';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,fixtureHttpSession} from './helpers/crm-recovery-environment.mjs';
import {query,pool} from '../src/server/db.ts';
import {visitorKey} from '../src/server/http.ts';
import {passwordHash,passwordMatches,hash,encrypt,newTotpSecret,totp} from '../src/server/crypto.ts';
import {login,verifyMfa,register,changePassword,resetPassword,enrollMfa,confirmMfa,disableMfa,regenerateRecoveryCodes,requestEmailVerification,confirmEmailVerification,userDto} from '../src/server/auth.ts';
import {provisionStaffAccounts} from '../src/server/staff-provisioning.ts';
import {captureRestoreAccess,applyRestoreSecurity} from '../scripts/restore-security-lib.ts';

const request=new Request('http://localhost:3000/api/v1/auth/login',{headers:{origin:'http://localhost:3000'}});
const problem=(status,code)=>error=>error?.status===status&&error?.code===code;
const result=promise=>promise.then(value=>({value}),error=>({error}));
const password='Credential-race-fixture-'+randomUUID(),replacement='New-credential-fixture-'+randomUUID();
const row=async id=>(await query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
const liveSessions=async id=>(await query('SELECT id FROM sessions WHERE user_id=$1 AND revoked_at IS NULL',[id])).rows;
async function bounded(promise,message,milliseconds=20000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]);}finally{clearTimeout(timer);}}
async function waitForDatabase(read,message){const deadline=Date.now()+20000;for(;;){const value=await read();if(value)return value;assert.ok(Date.now()<deadline,message);await new Promise(resolve=>setTimeout(resolve,25));}}

async function challenge(userId,purpose='mfa'){
 const value=randomUUID()+randomUUID();await query('INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')',[hash(value),userId,purpose]);return value;
}
async function session(f,{mfa=f.mfa}={}){
 const http=await fixtureHttpSession(f.actor,{mfa});return{...http,context:{actor:{...f.actor,mfaVerified:mfa},user:userDto(await row(f.actor.id)),sessionId:http.id,csrfToken:'unused-direct-function-fixture'}};
}

test('Credential finalization survives real concurrent password and MFA changes',{timeout:240000},async t=>withCrmRecoveryDatabase('auth_credentials',async({scoped})=>{
 const encoded=await passwordHash(password),salt=randomBytes(16),legacyKey=await promisify(crypto.scrypt)(password,salt,64,{N:32768,r:8,p:1,maxmem:128*1024*1024});
 const legacy=`scrypt$32768$8$1$${salt.toString('hex')}$${legacyKey.toString('hex')}`;
 async function fixture({role='customer',mfa=false,verifier=encoded}={}){
  const actor=fixtureActor('credential-'+randomUUID(),role,{mfaVerified:mfa,qualityScope:false}),secret=newTotpSecret();await insertActor(actor,{mfa});
  await query('UPDATE users SET password_hash=$2,mfa_secret=$3,mfa_last_counter=-1 WHERE id=$1',[actor.id,verifier,mfa?encrypt(secret):null]);return{actor,mfa,secret,code:()=>totp(secret,Math.floor(Date.now()/30000))};
 }

 await t.test('a login verified before a real password reset cannot mint a later session or change the new lockout state',async()=>{
  const f=await fixture(),reset=await challenge(f.actor.id,'password_reset'),barrier=holdDerivations(password);
  const pending=result(login(request,{email:f.actor.email,password}));
  try{
   await barrier.wait();assert.deepEqual(await resetPassword({token:reset,password:replacement}),{ok:true});
   await query("UPDATE users SET failed_logins=4,locked_until=now()+interval '2 minutes' WHERE id=$1",[f.actor.id]);const changed=await row(f.actor.id);
   barrier.release();const denied=await bounded(pending,'The stale login did not complete.');assert.ok(problem(401,'INVALID_CREDENTIALS')(denied.error));
   const after=await row(f.actor.id);assert.equal(after.password_hash,changed.password_hash);assert.equal(after.failed_logins,4);assert.equal(after.locked_until.toISOString(),changed.locked_until.toISOString());assert.equal((await liveSessions(f.actor.id)).length,0);
   assert.equal((await query("SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='auth.login.denied'",[f.actor.id])).rowCount,1);
  }finally{barrier.restore();await pending;}
 });

 await t.test('a stale wrong-password attempt cannot increment the replacement credential failure counter',async()=>{
  const f=await fixture(),reset=await challenge(f.actor.id,'password_reset'),wrong='Wrong-'+password,barrier=holdDerivations(wrong),pending=result(login(request,{email:f.actor.email,password:wrong}));
  try{await barrier.wait();await resetPassword({token:reset,password:replacement});await query('UPDATE users SET failed_logins=7 WHERE id=$1',[f.actor.id]);barrier.release();assert.ok(problem(401,'INVALID_CREDENTIALS')((await pending).error));assert.equal((await row(f.actor.id)).failed_logins,7);}
  finally{barrier.restore();await pending;}
 });

 await t.test('a real authenticated password change keeps only its current session and rejects the pending old-password login',async()=>{
  const f=await fixture(),current=await session(f),other=await session(f),barrier=holdDerivations(password),pending=result(login(request,{email:f.actor.email,password}));
  try{await barrier.wait();await changePassword(current.context,{currentPassword:password,password:replacement});barrier.release();assert.ok(problem(401,'INVALID_CREDENTIALS')((await pending).error));assert.deepEqual((await liveSessions(f.actor.id)).map(value=>value.id),[current.id]);assert.ok((await query('SELECT revoked_at FROM sessions WHERE id=$1',[other.id])).rows[0].revoked_at);assert.equal(await passwordMatches(replacement,(await row(f.actor.id)).password_hash),true);}
  finally{barrier.restore();await pending;}
 });

 await t.test('explicit owner rotation cannot be followed by a session or MFA proof from the earlier env password',async()=>{
  // Provisioning correctly requires a real active senior administrator.
  await fixture({role:'superAdmin'});
  const entry={key:'credential-owner-'+randomUUID(),name:'Credential owner fixture',email:randomUUID()+'@example.invalid',role:'contentEditor',allowedLocales:['en'],password};
  await provisionStaffAccounts({env:{STAFF_ACCOUNTS_JSON:JSON.stringify([entry])}});const user=(await query('SELECT * FROM users WHERE email=$1',[entry.email])).rows[0];
  const barrier=holdDerivations(password),pending=result(login(request,{email:entry.email,password}));
  try{await barrier.wait();const rotated=await provisionStaffAccounts({env:{STAFF_ACCOUNTS_JSON:JSON.stringify([{...entry,password:replacement}])},rotatePasswords:true});assert.equal(rotated.passwordsRotated,1);barrier.release();assert.ok(problem(401,'INVALID_CREDENTIALS')((await pending).error));assert.equal((await liveSessions(user.id)).length,0);assert.equal((await query('SELECT 1 FROM auth_challenges WHERE user_id=$1 AND consumed_at IS NULL',[user.id])).rowCount,0);}
  finally{barrier.restore();await pending;}
 });

 await t.test('current account state and current staff/MFA requirements govern finalization after password work',async()=>{
  for(const change of['disabled','staff-enrollment','staff-mfa']){
   const f=await fixture(),barrier=holdDerivations(password),pending=result(login(request,{email:f.actor.email,password}));
   try{
    await barrier.wait();
    if(change==='disabled')await query('UPDATE users SET active=false WHERE id=$1',[f.actor.id]);
    else await query("UPDATE users SET role='contentEditor',allowed_locales='[\"en\"]',mfa_enabled=$2,mfa_secret=$3 WHERE id=$1",[f.actor.id,change==='staff-mfa',change==='staff-mfa'?encrypt(f.secret):null]);
    barrier.release();const response=await pending;
    if(change==='disabled'){assert.ok(problem(401,'INVALID_CREDENTIALS')(response.error));assert.equal((await liveSessions(f.actor.id)).length,0);}
    else{assert.equal(response.value.status,200);const body=await response.value.json();if(change==='staff-mfa'){assert.equal(body.mfaRequired,true);assert.equal((await liveSessions(f.actor.id)).length,0);}else{assert.equal(body.user.role,'contentEditor');assert.equal(body.mfaEnrollmentRequired,true);assert.deepEqual(body.user.allowedLocales,['en']);}}
   }finally{barrier.restore();await pending;}
  }
 });

 await t.test('ordinary denied attempts commit their failure counter and audit before returning generic401',async()=>{
  const f=await fixture();await query('UPDATE users SET failed_logins=9 WHERE id=$1',[f.actor.id]);await assert.rejects(login(request,{email:f.actor.email,password:'Incorrect-'+password}),problem(401,'INVALID_CREDENTIALS'));
  const after=await row(f.actor.id);assert.equal(after.failed_logins,10);assert.ok(after.locked_until.getTime()>Date.now());assert.equal((await liveSessions(f.actor.id)).length,0);assert.equal((await query("SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='auth.login.denied'",[f.actor.id])).rowCount,1);
 });

 await t.test('real KDF saturation returns AUTH_BUSY without changing credentials, lockout state or credential audit',async()=>{
  const f=await fixture();await query("UPDATE users SET failed_logins=6,locked_until=now()+interval '10 minutes' WHERE id=$1",[f.actor.id]);
  const before=await row(f.actor.id),audits=(await query('SELECT count(*)::int AS count FROM audit_events WHERE actor_id=$1',[f.actor.id])).rows[0].count;
  const barrier=holdDerivations(password,{count:2}),jobs=[result(passwordMatches(password,encoded)),result(passwordMatches(password,encoded))],database=pool(),originalQuery=database.query;let filled=false;
  try{
   await barrier.wait();
   database.query=function(sql,values,...rest){
    const actual=originalQuery.call(this,sql,values,...rest);
    if(sql==='SELECT * FROM users WHERE email=$1'&&values?.[0]===f.actor.email){return actual.then(value=>{
     assert.equal(filled,false);filled=true;
     // Fill only after the real SELECT completes. Admission follows immediately
     // on the next microtask, without network/DB latency inside the 2s budget.
     for(let i=0;i<16;i++)jobs.push(result(passwordMatches(password,'')));
     return value;
    });}
    return actual;
   };
   await assert.rejects(login(request,{email:f.actor.email,password}),problem(503,'AUTH_BUSY'));assert.equal(filled,true);
   assert.deepEqual(await row(f.actor.id),before);assert.equal((await query('SELECT count(*)::int AS count FROM audit_events WHERE actor_id=$1',[f.actor.id])).rows[0].count,audits);assert.equal((await liveSessions(f.actor.id)).length,0);
  }finally{database.query=originalQuery;barrier.restore();await Promise.all(jobs);}
 });

 await t.test('transparent legacy rehash preserves existing sessions and pending proofs and audits only profile names',async()=>{
  const f=await fixture({verifier:legacy}),current=await session(f),mfa=await challenge(f.actor.id),reset=await challenge(f.actor.id,'password_reset');
  assert.equal((await login(request,{email:f.actor.email,password})).status,200);const after=await row(f.actor.id);assert.match(after.password_hash,/^scrypt\$32768\$8\$3\$/);assert.equal(await passwordMatches(password,after.password_hash),true);
  assert.equal((await query('SELECT revoked_at FROM sessions WHERE id=$1',[current.id])).rows[0].revoked_at,null);
  assert.equal((await query('SELECT 1 FROM auth_challenges WHERE token_hash=ANY($1::text[]) AND consumed_at IS NULL',[[hash(mfa),hash(reset)]])).rowCount,2);
  const events=(await query("SELECT action,details FROM audit_events WHERE actor_id=$1 AND action IN ('auth.password.rehashed','auth.password.changed')",[f.actor.id])).rows;assert.deepEqual(events,[{action:'auth.password.rehashed',details:{from:'scrypt-32768-8-1',to:'scrypt-32768-8-3'}}]);for(const value of[password,legacy,after.password_hash])assert.equal(JSON.stringify(events).includes(value),false);
 });

 await t.test('two verified legacy logins cannot overwrite each other; the conservative loser retries safely',async()=>{
  const f=await fixture({verifier:legacy}),barrier=holdDerivations(password,{count:2,p:1}),first=result(login(request,{email:f.actor.email,password})),second=result(login(request,{email:f.actor.email,password}));
  try{
   await barrier.wait();barrier.release(0);const winning=await bounded(Promise.race([first.then(value=>({index:0,value})),second.then(value=>({index:1,value}))]),'The first released legacy login did not complete.');assert.equal(winning.value.value?.status,200);const committed=(await row(f.actor.id)).password_hash;
   barrier.release(1);const loser=await bounded(winning.index===0?second:first,'The competing legacy login did not complete.');assert.ok(problem(401,'INVALID_CREDENTIALS')(loser.error));assert.equal((await row(f.actor.id)).password_hash,committed);assert.equal((await row(f.actor.id)).failed_logins,0);assert.equal((await liveSessions(f.actor.id)).length,1);assert.equal((await query("SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='auth.password.rehashed'",[f.actor.id])).rowCount,1);
   assert.equal((await login(request,{email:f.actor.email,password})).status,200);assert.equal((await row(f.actor.id)).password_hash,committed);
  }finally{barrier.restore();await Promise.all([first,second]);}
 });

 await t.test('MFA verification waits behind credential change without taking a challenge lock first or reviving old proof',async()=>{
  const f=await fixture({mfa:true}),mfa=(await(await login(request,{email:f.actor.email,password})).json()).challengeToken,reset=await challenge(f.actor.id,'password_reset');
  const key=1+randomBytes(4).readUInt32BE()%2000000000,blocker=new pg.Client({connectionString:scoped.toString()});await blocker.connect();let locked=false,pendingReset,pendingMfa;
  assert.match(f.actor.id,/^credential-[a-f0-9-]+$/);
  await query(`CREATE FUNCTION block_credential_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${f.actor.id}' AND NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN PERFORM pg_advisory_xact_lock(${key}::bigint); END IF; RETURN NEW; END $$; CREATE TRIGGER block_credential_write BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION block_credential_write()`);
  try{
   await blocker.query('SELECT pg_advisory_lock($1::bigint)',[key]);locked=true;pendingReset=result(resetPassword({token:reset,password:replacement}));
   const resetPid=await waitForDatabase(async()=>(await query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=$1::oid AND NOT granted",[key])).rows[0]?.pid,'Password reset did not reach the real locked update.');
   pendingMfa=result(verifyMfa(request,{challengeToken:mfa,code:f.code()}));
   const mfaPid=await waitForDatabase(async()=>(await query("SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'",[resetPid])).rows[0]?.pid,'MFA verification did not wait on the same user row.');
   assert.equal((await query("SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='auth_challenges'::regclass AND mode IN ('RowShareLock','RowExclusiveLock')",[mfaPid])).rowCount,0,'MFA must not lock/update the challenge while waiting for its user.');
   await blocker.query('SELECT pg_advisory_unlock($1::bigint)',[key]);locked=false;
   const [changed,denied]=await bounded(Promise.all([pendingReset,pendingMfa]),'Credential/MFA operations did not complete without a lock cycle.');assert.deepEqual(changed.value,{ok:true});assert.ok(problem(401,'MFA_INVALID')(denied.error));assert.equal((await liveSessions(f.actor.id)).length,0);
  }finally{if(locked)await blocker.query('SELECT pg_advisory_unlock($1::bigint)',[key]);await Promise.allSettled([pendingReset,pendingMfa].filter(Boolean));await query('DROP TRIGGER block_credential_write ON users; DROP FUNCTION block_credential_write()');await blocker.end();}
 });

 await t.test('real password change and reset consume earlier MFA proof and pending enrollment, while fresh MFA still works',async()=>{
  for(const action of['change','reset']){
   const f=await fixture({mfa:true}),current=await session(f),response=await login(request,{email:f.actor.email,password}),old=(await response.json()).challengeToken;
   await query("UPDATE users SET mfa_pending_secret=$2,mfa_pending_expires_at=now()+interval '10 minutes' WHERE id=$1",[f.actor.id,encrypt(newTotpSecret())]);
   if(action==='change')await changePassword(current.context,{currentPassword:password,password:replacement});else await resetPassword({token:await challenge(f.actor.id,'password_reset'),password:replacement});
   assert.ok((await query('SELECT consumed_at FROM auth_challenges WHERE token_hash=$1',[hash(old)])).rows[0].consumed_at);const changed=await row(f.actor.id);assert.equal(changed.mfa_pending_secret,null);assert.equal(changed.mfa_pending_expires_at,null);assert.equal(changed.mfa_enabled,true);
   await assert.rejects(verifyMfa(request,{challengeToken:old,code:f.code()}),problem(401,'MFA_INVALID'));
   const fresh=await(await login(request,{email:f.actor.email,password:replacement})).json();assert.equal(fresh.mfaRequired,true);assert.equal((await verifyMfa(request,{challengeToken:fresh.challengeToken,code:f.code()})).status,200);
  }
 });

 await t.test('MFA enrollment cannot commit an old password or a revoked current session',async()=>{
  for(const change of['password','session']){
   const f=await fixture(),current=await session(f),barrier=holdDerivations(password),pending=result(enrollMfa(current.context,{password}));
   try{await barrier.wait();if(change==='password')await resetPassword({token:await challenge(f.actor.id,'password_reset'),password:replacement});else await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[current.id]);barrier.release();assert.equal((await pending).error?.status,401);const after=await row(f.actor.id);assert.equal(after.mfa_pending_secret,null);assert.equal(after.mfa_enabled,false);}
   finally{barrier.restore();await pending;}
  }
 });

 await t.test('confirmation rejects revoked or inactive session snapshots and preserves ordinary staff enrollment',async()=>{
  for(const change of['session','account']){
   const f=await fixture(),current=await session(f),setup=await enrollMfa(current.context,{password});if(change==='session')await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[current.id]);else await query('UPDATE users SET active=false WHERE id=$1',[f.actor.id]);
   await assert.rejects(confirmMfa(current.context,{code:totp(setup.secret,Math.floor(Date.now()/30000))}),problem(401,'SESSION_REQUIRED'));assert.equal((await row(f.actor.id)).mfa_enabled,false);
  }
  const changed=await fixture(),oldSession=await session(changed),oldSetup=await enrollMfa(oldSession.context,{password});await changePassword(oldSession.context,{currentPassword:password,password:replacement});
  await assert.rejects(confirmMfa(oldSession.context,{code:totp(oldSetup.secret,Math.floor(Date.now()/30000))}),problem(409,'ENROLLMENT_EXPIRED'));assert.equal((await row(changed.actor.id)).mfa_enabled,false);
  const f=await fixture({role:'contentEditor'}),current=await session(f),setup=await enrollMfa(current.context,{password}),confirmed=await confirmMfa(current.context,{code:totp(setup.secret,Math.floor(Date.now()/30000))});assert.equal(confirmed.mfaEnabled,true);assert.equal(confirmed.recoveryCodes.length,10);assert.equal((await query('SELECT mfa_verified FROM sessions WHERE id=$1',[current.id])).rows[0].mfa_verified,true);
 });

 await t.test('MFA disable and recovery replacement recheck current role, session and password after expensive proof',async()=>{
  for(const action of['disable-role','disable-session','recovery-password']){
   const f=await fixture({mfa:true}),current=await session(f),barrier=holdDerivations(password),pending=result(action==='recovery-password'?regenerateRecoveryCodes(current.context,{password,code:f.code()}):disableMfa(current.context,{password,code:f.code()}));
   try{await barrier.wait();if(action==='disable-role')await query("UPDATE users SET role='contentEditor' WHERE id=$1",[f.actor.id]);else if(action==='disable-session')await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[current.id]);else await resetPassword({token:await challenge(f.actor.id,'password_reset'),password:replacement});barrier.release();const denied=await pending;assert.ok(denied.error);assert.equal(denied.error.status,action==='disable-session'?401:403);assert.equal((await row(f.actor.id)).mfa_enabled,true);}
   finally{barrier.restore();await pending;}
  }
 });

 await t.test('Email verification rejects captured revoked, expired, idle and disabled session contexts without changing challenges or deliveries',async()=>{
  for(const invalidation of['revoked','expired','idle','disabled']){
   const f=await fixture();await query('UPDATE users SET email_verified=false WHERE id=$1',[f.actor.id]);const current=await session(f),raw=randomUUID()+randomUUID(),digest=hash(raw+'\0'+f.actor.email);
   await query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'email_verify',now()+interval '1 hour')",[digest,f.actor.id]);
   const challenges=async()=>(await query("SELECT token_hash,consumed_at FROM auth_challenges WHERE user_id=$1 AND purpose='email_verify' ORDER BY token_hash",[f.actor.id])).rows,before=await challenges();
   if(invalidation==='revoked')await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[current.id]);
   else if(invalidation==='expired')await query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[current.id]);
   else if(invalidation==='idle')await query("UPDATE sessions SET last_seen_at=now()-interval '1 year' WHERE id=$1",[current.id]);
   else await query('UPDATE users SET active=false WHERE id=$1',[f.actor.id]);
   await assert.rejects(requestEmailVerification(current.context,{locale:'en'}),problem(401,'SESSION_REQUIRED'));
   await assert.rejects(confirmEmailVerification(current.context,{token:raw}),problem(401,'SESSION_REQUIRED'));
   assert.equal((await row(f.actor.id)).email_verified,false);assert.deepEqual(await challenges(),before);
   assert.equal((await query('SELECT count(*)::integer AS count FROM outbox WHERE account_id=$1',[f.actor.id])).rows[0].count,0);
  }
 });

 await t.test('A live session can queue email verification and consume a valid email-bound challenge',async()=>{
  const f=await fixture();await query('UPDATE users SET email_verified=false WHERE id=$1',[f.actor.id]);const current=await session(f);
  const queued=await requestEmailVerification(current.context,{locale:'en'});assert.equal(queued.ok,true);assert.equal(queued.emailVerified,false);assert.equal(queued.status,'pending');
  assert.equal((await query("SELECT count(*)::integer AS count FROM auth_challenges WHERE user_id=$1 AND purpose='email_verify' AND consumed_at IS NULL",[f.actor.id])).rows[0].count,1);
  assert.equal((await query('SELECT count(*)::integer AS count FROM outbox WHERE account_id=$1',[f.actor.id])).rows[0].count,1);
  const raw=randomUUID()+randomUUID();await query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'email_verify',now()+interval '1 hour')",[hash(raw+'\0'+f.actor.email),f.actor.id]);
  assert.deepEqual(await confirmEmailVerification(current.context,{token:raw}),{ok:true,emailVerified:true});assert.equal((await row(f.actor.id)).email_verified,true);
  assert.equal((await query("SELECT count(*)::integer AS count FROM auth_challenges WHERE user_id=$1 AND purpose='email_verify' AND consumed_at IS NULL",[f.actor.id])).rows[0].count,0);
 });

 await t.test('failed session insertion rolls registration back with its settings and audit, without changing duplicate-email behavior',async()=>{
  const countSql="SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM user_settings) AS settings,(SELECT count(*)::int FROM audit_events WHERE action='auth.register') AS registrations",before=(await query(countSql)).rows[0],rateKey=hash('register:'+visitorKey(request)),beforeRate=(await query('SELECT count FROM rate_limits WHERE key=$1',[rateKey])).rows[0]?.count||0;
  await query("CREATE FUNCTION reject_credential_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated session insert failure'; END $$; CREATE TRIGGER reject_credential_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION reject_credential_session()");
  const email=randomUUID()+'@example.invalid';
  try{await assert.rejects(register(request,{name:'Atomic registration fixture',email,password}),/isolated session insert failure/);assert.equal((await query('SELECT 1 FROM users WHERE email=$1',[email])).rowCount,0);assert.deepEqual((await query(countSql)).rows[0],before);assert.equal((await query('SELECT count FROM rate_limits WHERE key=$1',[rateKey])).rows[0].count,beforeRate+1);}
  finally{await query('DROP TRIGGER reject_credential_session ON sessions; DROP FUNCTION reject_credential_session()');}
  const registered=await register(request,{name:'Atomic registration fixture',email,password});assert.equal(registered.status,201);const body=await registered.json();assert.equal(body.user.role,'customer');assert.equal(body.mfaEnrollmentRequired,false);assert.equal((await liveSessions(body.user.id)).length,1);
  await assert.rejects(register(request,{name:'Duplicate registration fixture',email,password}),problem(409,'ACCOUNT_UNAVAILABLE'));
  assert.equal((await query('SELECT count FROM rate_limits WHERE key=$1',[rateKey])).rows[0].count,beforeRate+3);
 });

 await t.test('audit failure rolls back transparent rehash, failure-counter reset and session creation',async()=>{
  const f=await fixture({verifier:legacy});await query('UPDATE users SET failed_logins=3 WHERE id=$1',[f.actor.id]);
  await query("CREATE FUNCTION reject_credential_login_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='auth.login' THEN RAISE EXCEPTION 'isolated login audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_credential_login_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_credential_login_audit()");
  try{await assert.rejects(login(request,{email:f.actor.email,password}),/isolated login audit failure/);const after=await row(f.actor.id);assert.equal(after.password_hash,legacy);assert.equal(after.failed_logins,3);assert.equal((await liveSessions(f.actor.id)).length,0);assert.equal((await query("SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='auth.password.rehashed'",[f.actor.id])).rowCount,0);}
  finally{await query('DROP TRIGGER reject_credential_login_audit ON audit_events; DROP FUNCTION reject_credential_login_audit()');}
 });

 await t.test('a transparent rehash never weakens restore reconciliation against an older stored verifier',async()=>{
  const owner=await fixture({role:'superAdmin'}),f=await fixture({verifier:legacy});assert.equal((await login(request,{email:f.actor.email,password})).status,200);
  const current=await captureRestoreAccess();await query('UPDATE users SET password_hash=$2 WHERE id=$1',[f.actor.id,legacy]);const restored=await applyRestoreSecurity(current);
  assert.equal(restored.ready,true);assert.equal(restored.credentialMismatches,1);assert.equal((await row(f.actor.id)).active,false);assert.equal((await row(f.actor.id)).password_hash,legacy);assert.equal((await row(owner.actor.id)).active,true);
 });
}));
