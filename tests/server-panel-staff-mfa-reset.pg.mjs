import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {holdDerivations} from './helpers/native-kdf-barrier.mjs';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,recordFixture,fixtureHttpSession} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {passwordHash,passwordMatches,hash,encrypt,decrypt,newTotpSecret,totp} from '../src/server/crypto.ts';
import {login,sessionFor} from '../src/server/auth.ts';
import {getManagedUser,resetManagedUserMfa} from '../src/server/account.ts';
import {handleRequest} from '../src/server/router.ts';

const password=()=>randomBytes(24).toString('base64url');
const problem=(status,code)=>error=>error?.status===status&&error?.code===code;
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
const row=async id=>(await query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
const code=secret=>totp(secret,Math.floor(Date.now()/30000));
const wrongCode=secret=>{
 const valid=new Set([-1,0,1].map(delta=>totp(secret,Math.floor(Date.now()/30000)+delta)));
 return ['000000','111111','222222','333333'].find(value=>!valid.has(value));
};
async function person(role='superAdmin'){
 const actor=fixtureActor('panel-mfa-'+randomUUID(),role,{qualityScope:false}),secret=newTotpSecret(),currentPassword=password(),recovery=password().toLowerCase();
 await insertActor(actor,{mfa:role!=='customer'});
 await query("UPDATE users SET password_hash=$2,mfa_secret=$3,mfa_last_counter=-1,recovery_hashes=$4::jsonb WHERE id=$1",[actor.id,await passwordHash(currentPassword),encrypt(secret),JSON.stringify([hash(recovery)])]);
 await query("INSERT INTO user_settings(user_id,profile) VALUES($1,$2::jsonb)",[actor.id,JSON.stringify({city:'Maku',bio:'Preserved profile'})]);
 const http=await fixtureHttpSession(actor);
 return{actor,secret,password:currentPassword,recovery,http,session:{actor,user:{},sessionId:http.id,csrfToken:'unused-direct-fixture'}};
}
async function fixture(){return{owner:await person(),target:await person('support'),replacement:password()};}
async function input(f,overrides={}){
 const detail=await getManagedUser(f.owner.actor,f.target.actor.id,f.owner.session);
 return{actorPassword:f.owner.password,actorCode:code(f.owner.secret),password:f.replacement,expectedUpdatedAt:detail.updatedAt,profileRevision:detail.profileRevision,...overrides};
}
async function fingerprint(id){
 const users=(await query('SELECT * FROM users WHERE id=$1',[id])).rows;
 const settings=(await query('SELECT * FROM user_settings WHERE user_id=$1',[id])).rows;
 const sessions=(await query('SELECT * FROM sessions WHERE user_id=$1 ORDER BY id',[id])).rows;
 const challenges=(await query('SELECT * FROM auth_challenges WHERE user_id=$1 ORDER BY token_hash',[id])).rows;
 // Failures compare a digest, never print credentials or recovery material.
 return hash(JSON.stringify({users,settings,sessions,challenges}));
}
async function addProofs(id){
 const tokens={};
 for(const purpose of ['mfa','password_reset','email_verify']){
  tokens[purpose]=randomUUID()+randomUUID();
  await query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(tokens[purpose]),id,purpose]);
 }
 return tokens;
}
async function invitationFixtures(f){
 const other=await person('customer'),staff=[];
 for(const kind of ['recipient','issuer','unrelated','accepted']){
  const id=randomUUID(),recipient=kind==='recipient'?f.target:other,inviter=kind==='issuer'?f.target:f.owner;
  const email=kind==='recipient'?recipient.actor.email:kind+'-'+randomUUID()+'@example.invalid';
  await query(`INSERT INTO staff_invitations(id,email,target_user_id,role,allowed_locales,quality_scope,crm_scope,crm_permissions,team_ids,territory_ids,locale,token_hash,invited_by,expires_at,accepted_at,accepted_by)
   VALUES($1,$2,$3,'support','["en"]',false,'assigned','{}','[]','[]','en',$4,$5,now()+interval '1 hour',CASE WHEN $6 THEN now() ELSE NULL END,CASE WHEN $6 THEN $3 ELSE NULL END)`,
   [id,email,recipient.actor.id,hash(randomUUID()),inviter.actor.id,kind==='accepted']);
  staff.push({id,kind});
 }
 const organizationId=randomUUID(),organizationName='Recovery fixture organization';
 const organizationAccount=await recordFixture(f.owner.actor,{collection:'accounts',status:'new',title:organizationName,details:{crmDomain:{schemaVersion:1,kind:'account',revision:1}}});
 await query("INSERT INTO crm_account_profiles(record_id,display_name,legal_name,activity,lifecycle,registrations,addresses) VALUES($1,$2,$2,'other','prospect','[]'::jsonb,'[]'::jsonb)",[organizationAccount.id,organizationName]);
 await query('INSERT INTO customer_organizations(id,name,owner_id,crm_account_id) VALUES($1,$2,$3,$4)',[organizationId,organizationName,f.owner.actor.id,organizationAccount.id]);
 const organizations=[];
 for(const kind of ['recipient','issuer','unrelated','accepted']){
  const id=randomUUID(),email=kind==='recipient'?f.target.actor.email:kind+'-'+randomUUID()+'@example.invalid',inviter=kind==='issuer'?f.target:f.owner;
  await query(`INSERT INTO organization_invitations(id,organization_id,email,role,token_hash,invited_by,expires_at,accepted_at,accepted_by)
   VALUES($1,$2,$3,'member',$4,$5,now()+interval '1 hour',CASE WHEN $6 THEN now() ELSE NULL END,CASE WHEN $6 THEN $7 ELSE NULL END)`,
   [id,organizationId,email,hash(randomUUID()),inviter.actor.id,kind==='accepted',other.actor.id]);
  organizations.push({id,kind});
 }
 return{staff,organizations,organizationId};
}
async function actualLogin(email,currentPassword){
 const request=new Request('http://localhost:3000/api/v1/auth/login',{headers:{origin:'http://localhost:3000'}});
 const response=await login(request,{email,password:currentPassword});assert.equal(response.status,200);
 const payload=await response.json(),cookie=response.headers.get('set-cookie')?.split(';',1)[0];assert.ok(cookie);
 const session=await sessionFor(new Request('http://localhost:3000/api/v1/auth/session',{headers:{cookie}}));assert.ok(session);
 return{payload,session,async request(path,{method='GET',body}={}){
  const req=new Request('http://localhost:3000/api/v1'+path,{method,headers:{cookie,origin:'http://localhost:3000','sec-fetch-site':'same-origin','x-csrf-token':session.csrfToken,...body?{'content-type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});
  return handleRequest(req,path.slice(1).split('/'));
 }};
}

test('Panel staff MFA recovery requires current senior authority and atomic fresh step-up',{timeout:240000},async t=>withCrmRecoveryDatabase('panel_staff_mfa',async()=>{
 const environmentKeys=['STAFF_PROVISIONING_MODE','SMTP_HOST','SMTP_FROM'];
 const previous=Object.fromEntries(environmentKeys.map(key=>[key,process.env[key]]));
 process.env.STAFF_PROVISIONING_MODE='hybrid';delete process.env.SMTP_HOST;delete process.env.SMTP_FROM;
 try{
  await t.test('Recovery capabilities distinguish senior, ordinary administrator, self, inactive and unenrolled staff',async()=>{
   const f=await fixture(),admin=await person('admin');
   assert.equal((await getManagedUser(f.owner.actor,f.target.actor.id)).capabilities.canResetMfa,true);
   assert.equal((await getManagedUser(admin.actor,f.target.actor.id)).capabilities.canResetMfa,false);
   assert.equal((await getManagedUser(f.owner.actor,f.owner.actor.id)).capabilities.canResetMfa,false);
   await query('UPDATE users SET active=false WHERE id=$1',[f.target.actor.id]);
   assert.equal((await getManagedUser(f.owner.actor,f.target.actor.id)).capabilities.canResetMfa,false);
   await query('UPDATE users SET active=true,mfa_enabled=false WHERE id=$1',[f.target.actor.id]);
   assert.equal((await getManagedUser(f.owner.actor,f.target.actor.id)).capabilities.canResetMfa,false);
   process.env.STAFF_PROVISIONING_MODE='env';try{assert.equal((await getManagedUser(f.owner.actor,f.target.actor.id)).capabilities.canResetMfa,false);}finally{process.env.STAFF_PROVISIONING_MODE='hybrid';}
  });
  await t.test('HTTP rejects missing CSRF, ordinary roles, self recovery and sessions without current MFA',async()=>{
   const f=await fixture(),body=await input(f),before=await fingerprint(f.target.actor.id),path='/users/'+f.target.actor.id+'/mfa-reset';
   assert.equal((await f.owner.http.request(path,{method:'POST',body,headers:{'x-csrf-token':'wrong'}})).status,403);
   for(const role of ['admin','support','customer']){const outsider=await person(role);assert.equal((await outsider.http.request(path,{method:'POST',body})).status,403);}
   assert.equal((await f.owner.http.request('/users/'+f.owner.actor.id+'/mfa-reset',{method:'POST',body})).status,403);
   const partial=await fixtureHttpSession(f.owner.actor,{mfa:false});assert.equal((await partial.request(path,{method:'POST',body})).status,403);
   await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[f.owner.http.id]);
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,body),problem(403,'MFA_REQUIRED'));
   assert.equal(await fingerprint(f.target.actor.id),before);
  });
  await t.test('Env mode, disabled targets, customer targets and already unenrolled targets cannot use this flow',async()=>{
   const f=await fixture(),body=await input(f),before=await fingerprint(f.target.actor.id);
   process.env.STAFF_PROVISIONING_MODE='env';try{await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,body),problem(403,'STAFF_ENV_MANAGED'));}finally{process.env.STAFF_PROVISIONING_MODE='hybrid';}
   assert.equal(await fingerprint(f.target.actor.id),before);
   await query('UPDATE users SET active=false WHERE id=$1',[f.target.actor.id]);
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,body),problem(409,'STAFF_INACTIVE'));
   await query("UPDATE users SET active=true,role='customer' WHERE id=$1",[f.target.actor.id]);
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,body),problem(403,'STAFF_MFA_TARGET'));
   await query("UPDATE users SET role='support',mfa_enabled=false WHERE id=$1",[f.target.actor.id]);
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,body),problem(409,'MFA_NOT_ENABLED'));
  });
  await t.test('Fresh password and unused authenticator code are mandatory; recovery codes do not authorize reset',async()=>{
   const f=await fixture(),body=await input(f),before=await fingerprint(f.target.actor.id);
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,{...body,actorPassword:password()}),problem(401,'INVALID_CREDENTIALS'));
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,{...body,actorCode:wrongCode(f.owner.secret)}),problem(422,'MFA_INVALID'));
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,{...body,actorCode:f.owner.recovery}),problem(422,'VALIDATION'));
   const used=Math.floor(Date.now()/30000);await query('UPDATE users SET mfa_last_counter=$2 WHERE id=$1',[f.owner.actor.id,used]);
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,{...body,actorCode:totp(f.owner.secret,used)}),problem(422,'MFA_INVALID'));
   assert.equal(await fingerprint(f.target.actor.id),before);
  });
  await t.test('Strict required versions, stale snapshots and password reuse fail without changing target state',async()=>{
   const f=await fixture(),body=await input(f),before=await fingerprint(f.target.actor.id);
   for(const key of ['expectedUpdatedAt','profileRevision']){const absent={...body};delete absent[key];await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,absent),problem(422,'VALIDATION'));}
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,{...body,role:'superAdmin'}),problem(422,'VALIDATION'));
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,{...body,password:'short'}),problem(422,'VALIDATION'));
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,{...body,expectedUpdatedAt:'2000-01-01T00:00:00.000Z'}),problem(409,'USER_CONFLICT'));
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,{...body,profileRevision:body.profileRevision+1}),problem(409,'PROFILE_CONFLICT'));
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,{...body,password:f.target.password}),problem(422,'PASSWORD_REUSE'));
   assert.equal(await fingerprint(f.target.actor.id),before);
  });
  await t.test('Atomic recovery clears target MFA and all live proofs while preserving identity, profile, grants and owner bindings',async()=>{
   const expectedTitles={fa:'ایده‌آل ماکو — بازیابی ورود همکار',en:'Ideal Makoo — staff sign-in recovery',tr:'Ideal Makoo — personel giriş erişimi kurtarma',ar:'إيدئال ماكو — استعادة دخول الموظف',ru:'Ideal Makoo — восстановление входа сотрудника'};
   for(const language of ['fa','en','tr','ar','ru','unsupported']){
   const f=await fixture(),tokens=await addProofs(f.target.actor.id),invitations=await invitationFixtures(f);
   await query('UPDATE user_settings SET preferences=$2::jsonb WHERE user_id=$1',[f.target.actor.id,JSON.stringify({language})]);
   await fixtureHttpSession(f.target.actor);
   await query("UPDATE users SET failed_logins=8,locked_until=now()+interval '10 minutes',mfa_pending_secret=mfa_secret,mfa_pending_expires_at=now()+interval '10 minutes' WHERE id=$1",[f.target.actor.id]);
   const bindingKey='bound-'+randomUUID();await query('INSERT INTO staff_provisioned_accounts(provision_key,user_id,configured_email,applied_grants_sha256) VALUES($1,$2,$3,$4)',[bindingKey,f.target.actor.id,f.target.actor.email,hash('unchanged grants')]);
   const bindingBefore=hash(JSON.stringify((await query('SELECT * FROM staff_provisioned_accounts WHERE user_id=$1',[f.target.actor.id])).rows));
   const before=await row(f.target.actor.id),profileBefore=(await query('SELECT profile,version FROM user_settings WHERE user_id=$1',[f.target.actor.id])).rows[0],body=await input(f),outboxBefore=(await query('SELECT count(*)::int AS n FROM outbox')).rows[0].n;
   const response=await f.owner.http.request('/users/'+f.target.actor.id+'/mfa-reset',{method:'POST',body});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const value=await response.json();
   assert.deepEqual(Object.keys(value).sort(),['ok','userId','sessionsRevoked','mfaEnrollmentRequired','updatedAt','profileRevision'].sort());
   assert.equal(value.ok,true);assert.equal(value.sessionsRevoked,true);assert.equal(value.mfaEnrollmentRequired,true);assert.equal(value.profileRevision,profileBefore.version+1);
   const after=await row(f.target.actor.id);assert.equal(await passwordMatches(f.replacement,after.password_hash),true);assert.equal(await passwordMatches(f.target.password,after.password_hash),false);
   for(const field of ['id','email','name','role','active','allowed_locales','quality_scope','crm_scope','crm_permissions','email_verified'])assert.deepEqual(after[field],before[field]);
   assert.equal(after.mfa_enabled,false);assert.equal(after.mfa_secret,null);assert.equal(after.mfa_pending_secret,null);assert.equal(after.mfa_pending_expires_at,null);assert.equal(Number(after.mfa_last_counter),-1);assert.deepEqual(after.recovery_hashes,[]);assert.equal(after.failed_logins,0);assert.equal(after.locked_until,null);
   assert.equal(value.updatedAt,after.updated_at.toISOString());assert.deepEqual((await query('SELECT profile FROM user_settings WHERE user_id=$1',[f.target.actor.id])).rows[0].profile,profileBefore.profile);
   assert.equal((await query('SELECT 1 FROM sessions WHERE user_id=$1 AND revoked_at IS NULL',[f.target.actor.id])).rowCount,0);
   assert.equal((await query('SELECT 1 FROM auth_challenges WHERE user_id=$1 AND consumed_at IS NULL',[f.target.actor.id])).rowCount,0);
   for(const {id,kind} of invitations.staff){const invite=(await query('SELECT revoked_at,version FROM staff_invitations WHERE id=$1',[id])).rows[0];assert.equal(!!invite.revoked_at,['recipient','issuer'].includes(kind));assert.equal(invite.version,['recipient','issuer'].includes(kind)?2:1);}
   for(const {id,kind} of invitations.organizations)assert.equal(!!(await query('SELECT revoked_at FROM organization_invitations WHERE id=$1',[id])).rows[0].revoked_at,['recipient','issuer'].includes(kind));
   assert.equal((await query('SELECT version FROM customer_organizations WHERE id=$1',[invitations.organizationId])).rows[0].version,2);
   assert.equal(hash(JSON.stringify((await query('SELECT * FROM staff_provisioned_accounts WHERE user_id=$1',[f.target.actor.id])).rows)),bindingBefore);
   assert.equal((await query('SELECT count(*)::int AS n FROM outbox')).rows[0].n,outboxBefore+1);
   assert.equal(process.env.SMTP_HOST,undefined);assert.equal(process.env.SMTP_FROM,undefined);
   const notice=(await query("SELECT id,kind,payload,state,account_id FROM outbox WHERE dedupe_key=$1",['staff-mfa-reset:'+f.target.actor.id+':'+value.profileRevision])).rows[0];
   assert.equal(notice.kind,'email');assert.equal(notice.state,'pending');assert.equal(notice.account_id,f.target.actor.id);assert.deepEqual(Object.keys(notice.payload),['encrypted']);
   const noticePayload=JSON.parse(decrypt(notice.payload.encrypted));assert.equal(noticePayload.userId,f.target.actor.id);assert.equal(noticePayload.to,f.target.actor.email);assert.equal(noticePayload.purpose,'transactional');
   const expectedLocale=language==='unsupported'?'fa':language;
   assert.equal(noticePayload.locale,expectedLocale);assert.equal(noticePayload.subject,expectedTitles[expectedLocale]);
   assert.equal(noticePayload.messageTemplate.key,'transactional_message');assert.equal(noticePayload.messageTemplate.locale,expectedLocale);
   assert.equal(noticePayload.messageTemplate.rendered.subject,noticePayload.subject);assert.equal(noticePayload.messageTemplate.rendered.body,noticePayload.text);
   const uses=(await query('SELECT template_key,locale FROM notification_template_uses WHERE outbox_id=$1',[notice.id])).rows;
   assert.deepEqual(uses,[{template_key:'transactional_message',locale:expectedLocale}]);
   const noticeContent=JSON.stringify({subject:noticePayload.subject,text:noticePayload.text,rendered:noticePayload.messageTemplate.rendered});
   for(const secret of [f.owner.password,f.target.password,f.replacement,body.actorCode,f.owner.secret,f.target.secret,f.owner.recovery,f.target.recovery,...Object.values(tokens)])assert.equal(noticeContent.includes(secret),false);
   for(const key of ['password','actorPassword','actorCode','secret','recoveryCodes'])assert.equal(Object.hasOwn(noticePayload,key),false);
   const details=(await query("SELECT details FROM audit_events WHERE actor_id=$1 AND entity_id=$2 AND action='staff.mfa_reset'",[f.owner.actor.id,f.target.actor.id])).rows;assert.equal(details.length,1);assert.equal(details[0].details.staffInvitationsRevoked,2);assert.equal(details[0].details.organizationInvitationsRevoked,2);
   assert.deepEqual(Object.keys(details[0].details).sort(),['sessionsRevoked','challengesRevoked','requiresEnrollment','staffInvitationsRevoked','organizationInvitationsRevoked','profileRevision','securityNoticeQueued'].sort());
   assert.equal(details[0].details.securityNoticeQueued,true);
   const visible=JSON.stringify({value,details});for(const secret of [f.owner.password,f.target.password,f.replacement,f.owner.secret,f.target.secret,f.target.recovery,after.password_hash,...Object.values(tokens)])assert.equal(visible.includes(secret),false);
   assert.equal((await query("SELECT 1 FROM users WHERE id=$1 AND active AND role='superAdmin' AND mfa_enabled",[f.owner.actor.id])).rowCount,1);
   }
  });
  await t.test('A panel-created identity must sign in with its new password and enroll again before workspace access',async()=>{
   const owner=await person(),currentPassword=password(),email='panel-created-mfa-'+randomUUID()+'@example.invalid';
   const created=await owner.http.request('/users',{method:'POST',body:{name:'Panel-created MFA fixture',email,password:currentPassword,role:'support',allowedLocales:['en']}});assert.equal(created.status,201);const entry=await created.json();
   const original=await actualLogin(email,currentPassword);assert.equal(original.payload.mfaEnrollmentRequired,true);
   const initialEnrollment=await original.request('/auth/mfa/enroll',{method:'POST',body:{password:currentPassword}});assert.equal(initialEnrollment.status,200);const initialFactor=await initialEnrollment.json();
   assert.equal((await original.request('/auth/mfa/confirm',{method:'POST',body:{code:code(initialFactor.secret)}})).status,200);
   const f={owner,target:{actor:fixtureActor(entry.id,'support',{email}),password:currentPassword,secret:initialFactor.secret,http:original},replacement:password()};
   assert.equal((await query('SELECT 1 FROM staff_provisioned_accounts WHERE user_id=$1',[f.target.actor.id])).rowCount,0);
   await resetManagedUserMfa(f.owner.session,f.target.actor.id,await input(f));
   assert.equal((await f.target.http.request('/workspace')).status,401);
   await assert.rejects(login(new Request('http://localhost:3000/api/v1/auth/login'),{email:f.target.actor.email,password:f.target.password}),problem(401,'INVALID_CREDENTIALS'));
   const signed=await actualLogin(f.target.actor.email,f.replacement);assert.equal(signed.payload.mfaEnrollmentRequired,true);assert.equal(signed.payload.user.mfaEnabled,false);
   assert.equal((await signed.request('/workspace')).status,403);
   const begun=await signed.request('/auth/mfa/enroll',{method:'POST',body:{password:f.replacement}});assert.equal(begun.status,200);const enrollment=await begun.json();assert.equal(enrollment.secret!==f.target.secret,true);
   const confirmed=await signed.request('/auth/mfa/confirm',{method:'POST',body:{code:code(enrollment.secret)}});assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).recoveryCodes.length,10);
   assert.equal((await signed.request('/workspace')).status,200);
   assert.equal((await query('SELECT 1 FROM staff_provisioned_accounts WHERE user_id=$1',[f.target.actor.id])).rowCount,0);
  });
  await t.test('Concurrent reset actions cannot reuse one fresh actor TOTP for two targets',async()=>{
   const f=await fixture(),second={owner:f.owner,target:await person('support'),replacement:password()},body=await input(f),other=await input(second,{actorCode:body.actorCode});
   const results=await Promise.all([outcome(resetManagedUserMfa(f.owner.session,f.target.actor.id,body)),outcome(resetManagedUserMfa(second.owner.session,second.target.actor.id,other))]);
   assert.equal(results.filter(item=>item.value).length,1);const rejected=results.find(item=>item.error).error;assert.equal(rejected.status,422);assert.equal(rejected.code,'MFA_INVALID');
   assert.equal((await query("SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='staff.mfa_reset'",[f.owner.actor.id])).rowCount,1);
  });
  await t.test('Session, role, account, MFA and password changes during native KDF work reject stale actor authority',async()=>{
   for(const change of ['session','role','account','mfa','password']){
    const f=await fixture(),body=await input(f),before=await fingerprint(f.target.actor.id),barrier=holdDerivations(f.replacement),pending=outcome(resetManagedUserMfa(f.owner.session,f.target.actor.id,body));
    try{
     await barrier.wait();
     if(change==='session')await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[f.owner.http.id]);
     else if(change==='password')await query('UPDATE users SET password_hash=$2 WHERE id=$1',[f.owner.actor.id,await passwordHash(password())]);
     else await query(`UPDATE users SET ${change==='role'?"role='admin'":change==='account'?'active=false':'mfa_enabled=false'} WHERE id=$1`,[f.owner.actor.id]);
     barrier.restore();const result=await pending;assert.ok(result.error);assert.equal(result.error.status,change==='password'?401:403);assert.equal(result.error.code,change==='password'?'INVALID_CREDENTIALS':change==='role'?'ROLE_ESCALATION':'MFA_REQUIRED');assert.equal(await fingerprint(f.target.actor.id),before);
    }finally{barrier.restore();await pending;}
   }
  });
  await t.test('Concurrent target credential and profile changes are rechecked after native KDF work',async()=>{
   for(const change of ['profile','timestamp','password','inactive']){
    const f=await fixture(),body=await input(f),barrier=holdDerivations(f.replacement),pending=outcome(resetManagedUserMfa(f.owner.session,f.target.actor.id,body));
    try{
     await barrier.wait();
     if(change==='profile')await query('UPDATE user_settings SET version=version+1 WHERE user_id=$1',[f.target.actor.id]);
     else if(change==='timestamp')await query("UPDATE users SET updated_at=updated_at+interval '1 second' WHERE id=$1",[f.target.actor.id]);
     else if(change==='password')await query('UPDATE users SET password_hash=$2 WHERE id=$1',[f.target.actor.id,await passwordHash(password())]);
     else await query('UPDATE users SET active=false WHERE id=$1',[f.target.actor.id]);
     const afterConcurrentChange=await fingerprint(f.target.actor.id);barrier.restore();const result=await pending;assert.ok(result.error);assert.equal(result.error.status,409);assert.equal(result.error.code,change==='profile'?'PROFILE_CONFLICT':change==='inactive'?'STAFF_INACTIVE':'USER_CONFLICT');assert.equal(await fingerprint(f.target.actor.id),afterConcurrentChange);
    }finally{barrier.restore();await pending;}
   }
  });
  await t.test('The existing bounded limiter rejects repeated failed actor proofs without target changes',async()=>{
   const f=await fixture(),body=await input(f,{actorPassword:password()}),before=await fingerprint(f.target.actor.id);
   for(let i=0;i<5;i++)await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,body),problem(401,'INVALID_CREDENTIALS'));
   await assert.rejects(resetManagedUserMfa(f.owner.session,f.target.actor.id,body),problem(429,'RATE_LIMITED'));
   assert.equal(await fingerprint(f.target.actor.id),before);
  });
  await t.test('Audit or notice enqueue failure rolls back credentials, proofs, invitations and actor TOTP consumption',async()=>{
   for(const failure of ['audit','notice']){
    const f=await fixture();await addProofs(f.target.actor.id);const invitations=await invitationFixtures(f),body=await input(f),before=await fingerprint(f.target.actor.id),counter=(await row(f.owner.actor.id)).mfa_last_counter;
    const outboxBefore=(await query('SELECT count(*)::int AS n FROM outbox')).rows[0].n;
    const table=failure==='audit'?'audit_events':'outbox',condition=failure==='audit'?"NEW.action='staff.mfa_reset'":"NEW.dedupe_key LIKE 'staff-mfa-reset:%'";
    await query(`CREATE FUNCTION reject_panel_mfa_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'isolated panel MFA required-write failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_panel_mfa_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_panel_mfa_write()`);
    try{
     const response=await f.owner.http.request('/users/'+f.target.actor.id+'/mfa-reset',{method:'POST',body});assert.equal(response.status,500);
     assert.equal(await fingerprint(f.target.actor.id),before);assert.equal((await row(f.owner.actor.id)).mfa_last_counter,counter);
     for(const {id} of invitations.staff)assert.equal((await query('SELECT revoked_at FROM staff_invitations WHERE id=$1',[id])).rows[0].revoked_at,null);
     for(const {id} of invitations.organizations)assert.equal((await query('SELECT revoked_at FROM organization_invitations WHERE id=$1',[id])).rows[0].revoked_at,null);
     assert.equal((await query('SELECT version FROM customer_organizations WHERE id=$1',[invitations.organizationId])).rows[0].version,1);
     assert.equal((await query('SELECT count(*)::int AS n FROM outbox')).rows[0].n,outboxBefore);
    }finally{await query(`DROP TRIGGER reject_panel_mfa_write ON ${table}; DROP FUNCTION reject_panel_mfa_write()`);}
   }
  });
 }finally{for(const key of environmentKeys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
}));
