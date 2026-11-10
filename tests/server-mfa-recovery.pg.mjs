import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,fixtureHttpSession} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {passwordHash,newTotpSecret,encrypt,hash,totp} from '../src/server/crypto.ts';
import {regenerateRecoveryCodes,verifyMfa} from '../src/server/auth.ts';
import {HttpError} from '../src/server/types.ts';

const password='Isolated recovery fixture '+randomUUID();
const request=new Request('http://localhost:3000/api/v1/auth/mfa/verify',{headers:{origin:'http://localhost:3000'}});
const status=(expected)=>error=>error instanceof HttpError&&error.status===expected;

test('Recovery-code replacement proves current password and fresh TOTP, with one-use codes and atomic revocation',{timeout:180000},async t=>withCrmRecoveryDatabase('mfa_recovery',async()=>{
 const encoded=await passwordHash(password);
 async function fixture(role='admin'){
  const actor=fixtureActor('recovery-'+randomUUID(),role,{qualityScope:false}),secret=newTotpSecret(),oldCode=randomUUID().replaceAll('-','');
  await insertActor(actor,{mfa:true});await query("UPDATE users SET password_hash=$2,mfa_secret=$3,mfa_last_counter=-1,recovery_hashes=$4::jsonb WHERE id=$1",[actor.id,encoded,encrypt(secret),JSON.stringify([hash(oldCode)])]);
  const session=await fixtureHttpSession(actor,{mfa:true}),other=await fixtureHttpSession(actor,{mfa:true});
  const challenge=randomUUID()+randomUUID();await query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'mfa',now()+interval '5 minutes')",[hash(challenge),actor.id]);
  return{actor,secret,oldCode,session,other,challenge,code:()=>totp(secret,Math.floor(Date.now()/30000))};
 }
 await t.test('CSRF, current MFA, strict inputs, wrong password and wrong TOTP all leave saved credentials unchanged',async()=>{
  const f=await fixture(),path='/auth/mfa/recovery-codes',valid={password,code:f.code()};
  assert.equal((await f.session.request(path,{method:'POST',body:valid,headers:{'x-csrf-token':'wrong'}})).status,403);
  const unverified=await fixtureHttpSession(f.actor,{mfa:false});assert.equal((await unverified.request(path,{method:'POST',body:valid})).status,403);
  assert.equal((await f.session.request(path,{method:'POST',body:{...valid,userId:'someone-else'}})).status,422);
  assert.equal((await f.session.request(path,{method:'POST',body:{...valid,password:'Wrong '+password}})).status,401);
  const codes=new Set([-1,0,1].map(offset=>totp(f.secret,Math.floor(Date.now()/30000)+offset)));const invalid=['000000','111111','222222','333333'].find(code=>!codes.has(code));
  assert.equal((await f.session.request(path,{method:'POST',body:{password,code:invalid}})).status,422);
  assert.deepEqual((await query('SELECT recovery_hashes FROM users WHERE id=$1',[f.actor.id])).rows[0].recovery_hashes,[hash(f.oldCode)]);
  assert.equal((await query('SELECT consumed_at FROM auth_challenges WHERE token_hash=$1',[hash(f.challenge)])).rows[0].consumed_at,null);
  assert.equal((await query('SELECT revoked_at FROM sessions WHERE id=$1',[f.other.id])).rows[0].revoked_at,null);
 });
 await t.test('Staff and customer MFA accounts receive ten functional one-use codes shown only in the fresh response',async()=>{
  for(const role of['admin','support','customer']){
   const f=await fixture(role),before=(await query('SELECT password_hash,mfa_secret FROM users WHERE id=$1',[f.actor.id])).rows[0];
   const response=await f.session.request('/auth/mfa/recovery-codes',{method:'POST',body:{password,code:f.code()}});assert.equal(response.status,200,role);assert.match(response.headers.get('Cache-Control'),/no-store/);
   const result=await response.json();assert.deepEqual(Object.keys(result),['recoveryCodes']);assert.equal(result.recoveryCodes.length,10);assert.equal(new Set(result.recoveryCodes).size,10);
   const after=(await query('SELECT password_hash,mfa_secret,mfa_enabled,recovery_hashes FROM users WHERE id=$1',[f.actor.id])).rows[0];assert.equal(after.password_hash,before.password_hash);assert.equal(after.mfa_secret,before.mfa_secret);assert.equal(after.mfa_enabled,true);assert.deepEqual(after.recovery_hashes,result.recoveryCodes.map(hash));
   assert.ok((await query('SELECT revoked_at FROM sessions WHERE id=$1',[f.other.id])).rows[0].revoked_at);assert.equal((await query('SELECT revoked_at FROM sessions WHERE id=$1',[f.session.id])).rows[0].revoked_at,null);
   assert.ok((await query('SELECT consumed_at FROM auth_challenges WHERE token_hash=$1',[hash(f.challenge)])).rows[0].consumed_at);
   const history=JSON.stringify((await query("SELECT details FROM audit_events WHERE actor_id=$1 AND action='auth.mfa.recovery_codes.regenerated'",[f.actor.id])).rows);for(const code of result.recoveryCodes)assert.equal(history.includes(code),false);
   assert.equal(JSON.stringify(await(await f.session.request('/me/security')).json()).includes(result.recoveryCodes[0]),false);
   async function challenge(){const token=randomUUID()+randomUUID();await query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'mfa',now()+interval '5 minutes')",[hash(token),f.actor.id]);return token;}
   await assert.rejects(verifyMfa(request,{challengeToken:await challenge(),code:f.oldCode}),status(401));
   assert.equal((await verifyMfa(request,{challengeToken:await challenge(),code:result.recoveryCodes[0]})).status,200);
   await assert.rejects(verifyMfa(request,{challengeToken:await challenge(),code:result.recoveryCodes[0]}),status(401));
  }
 });
 await t.test('Concurrent replacement with the same authenticator code commits exactly one set',async()=>{
  const f=await fixture(),body={password,code:f.code()};const responses=await Promise.all([f.session.request('/auth/mfa/recovery-codes',{method:'POST',body}),f.session.request('/auth/mfa/recovery-codes',{method:'POST',body})]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,422]);const winning=await responses.find(response=>response.status===200).json();
  assert.deepEqual((await query('SELECT recovery_hashes FROM users WHERE id=$1',[f.actor.id])).rows[0].recovery_hashes,winning.recoveryCodes.map(hash));
  assert.equal((await query("SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='auth.mfa.recovery_codes.regenerated'",[f.actor.id])).rowCount,1);
 });
 await t.test('Revoked sessions, disabled MFA and inactive accounts cannot use an earlier MFA actor snapshot',async()=>{
  for(const change of['session','mfa','account']){
   const f=await fixture(),stale={actor:{...f.actor,mfaVerified:true},user:{},sessionId:f.session.id,csrfToken:'test'};
   if(change==='session')await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[f.session.id]);
   else await query(`UPDATE users SET ${change==='mfa'?'mfa_enabled':'active'}=false WHERE id=$1`,[f.actor.id]);
   await assert.rejects(regenerateRecoveryCodes(stale,{password,code:f.code()}),status(403));
   assert.deepEqual((await query('SELECT recovery_hashes FROM users WHERE id=$1',[f.actor.id])).rows[0].recovery_hashes,[hash(f.oldCode)]);
  }
 });
 await t.test('An audit failure rolls back code replacement, TOTP consumption, session and challenge revocation',async()=>{
  const f=await fixture();await query("CREATE FUNCTION reject_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='auth.mfa.recovery_codes.regenerated' THEN RAISE EXCEPTION 'isolated recovery audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_recovery_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_recovery_audit()");
  try{
   const response=await f.session.request('/auth/mfa/recovery-codes',{method:'POST',body:{password,code:f.code()}});assert.equal(response.status,500);
   const current=(await query('SELECT recovery_hashes,mfa_last_counter FROM users WHERE id=$1',[f.actor.id])).rows[0];assert.deepEqual(current.recovery_hashes,[hash(f.oldCode)]);assert.equal(Number(current.mfa_last_counter),-1);
   assert.equal((await query('SELECT revoked_at FROM sessions WHERE id=$1',[f.other.id])).rows[0].revoked_at,null);assert.equal((await query('SELECT consumed_at FROM auth_challenges WHERE token_hash=$1',[hash(f.challenge)])).rows[0].consumed_at,null);
  }finally{await query('DROP TRIGGER reject_recovery_audit ON audit_events; DROP FUNCTION reject_recovery_audit()');}
 });
}));
