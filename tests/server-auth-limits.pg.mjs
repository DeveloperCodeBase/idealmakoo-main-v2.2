import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withCrmRecoveryDatabase,fixtureActor,insertActor} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {hash,passwordHash} from '../src/server/crypto.ts';
import {visitorKey} from '../src/server/http.ts';
import {login,verifyMfa} from '../src/server/auth.ts';
import {HttpError} from '../src/server/types.ts';

const problem=(status,code)=>error=>error instanceof HttpError&&error.status===status&&error.code===code;
test('Production login and MFA rate limits remain enforced at the exact IP and account boundaries',{timeout:180000},async t=>withCrmRecoveryDatabase('auth_limits',async()=>{
 const actor=fixtureActor('auth-boundary-'+randomUUID(),'admin'),password='Bounded-auth-fixture-'+randomUUID();
 await insertActor(actor,{mfa:true});await query('UPDATE users SET password_hash=$2 WHERE id=$1',[actor.id,await passwordHash(password)]);
 const request=new Request('http://localhost:3000/api/v1/auth/login',{headers:{origin:'http://localhost:3000','x-forwarded-for':'127.0.0.1'}});
 const visitor=visitorKey(request),ipKey=hash('login:ip:'+visitor),accountKey=hash('login:email:'+hash(actor.email)),mfaKey=hash('mfa:'+visitor),otherKey=hash('unrelated-fixture:'+randomUUID());
 const set=async(key,count,expired=false)=>query("INSERT INTO rate_limits(key,count,reset_at) VALUES($1,$2,now()+($3*interval '1 second')) ON CONFLICT(key) DO UPDATE SET count=EXCLUDED.count,reset_at=EXCLUDED.reset_at",[key,count,expired?-1:900]);
 await set(otherKey,7);
 await t.test('the thirtieth valid login reaches the real MFA challenge, while the thirty-first is denied',async()=>{
  await set(ipKey,29);const response=await login(request,{email:actor.email,password});assert.equal(response.status,200);assert.equal((await response.json()).mfaRequired,true);
  await assert.rejects(login(request,{email:actor.email,password}),problem(429,'RATE_LIMITED'));
  assert.equal((await query('SELECT count FROM rate_limits WHERE key=$1',[ipKey])).rows[0].count,31);
  assert.equal((await query('SELECT count FROM rate_limits WHERE key=$1',[accountKey])).rows[0].count,1,'IP denial must occur before another account attempt.');
 });
 await t.test('a fresh IP budget cannot bypass the independent twelve-attempt account limit',async()=>{
  await set(ipKey,0);await set(accountKey,12);await assert.rejects(login(request,{email:actor.email,password}),problem(429,'RATE_LIMITED'));
  assert.equal((await query('SELECT count FROM rate_limits WHERE key=$1',[accountKey])).rows[0].count,13);
 });
 await t.test('MFA allows its twentieth proof check, denies the twenty-first and resets only after expiry',async()=>{
  const value={challengeToken:randomUUID()+randomUUID(),code:'000000'};await set(mfaKey,19);
  await assert.rejects(verifyMfa(request,value),problem(401,'MFA_INVALID'));
  await assert.rejects(verifyMfa(request,value),problem(429,'RATE_LIMITED'));
  await set(mfaKey,21,true);await assert.rejects(verifyMfa(request,value),problem(401,'MFA_INVALID'));
  assert.equal((await query('SELECT count FROM rate_limits WHERE key=$1',[mfaKey])).rows[0].count,1);
  assert.equal((await query('SELECT count FROM rate_limits WHERE key=$1',[accountKey])).rows[0].count,13);
  assert.equal((await query('SELECT count FROM rate_limits WHERE key=$1',[otherKey])).rows[0].count,7);
 });
}));
