import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,fixtureHttpSession,languages} from './helpers/crm-recovery-environment.mjs';
import {holdDerivations} from './helpers/native-kdf-barrier.mjs';
import {query,pool} from '../src/server/db.ts';
import {passwordHash,passwordMatches,hash,encrypt,newTotpSecret} from '../src/server/crypto.ts';
import {userDto,login,forgotPassword} from '../src/server/auth.ts';
import {createUser,getManagedUser,listUsers,updateUser,resetManagedUserPassword} from '../src/server/account.ts';
import {staffProvisioningMode} from '../src/server/staff-provisioning-mode.ts';
import {provisionStaffAccounts} from '../src/server/staff-provisioning.ts';
import {listStaffInvitations} from '../src/server/staff-lifecycle.ts';
import {getWorkspace} from '../src/server/workspace.ts';

const password=()=>randomBytes(24).toString('base64url');
const problem=(status,code)=>error=>error?.status===status&&error?.code===code;
const result=promise=>promise.then(value=>({value}),error=>({error}));
const row=async id=>(await query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
const activeSessions=async id=>(await query('SELECT id FROM sessions WHERE user_id=$1 AND revoked_at IS NULL',[id])).rows;
const remainingProofs=async id=>(await query('SELECT token_hash FROM auth_challenges WHERE user_id=$1 AND consumed_at IS NULL',[id])).rows;
async function context(actor){const http=await fixtureHttpSession(actor);return {...http,context:{actor,user:userDto(await row(actor.id)),sessionId:http.id,csrfToken:'unused-direct-fixture'}};}
async function proofs(id){for(const purpose of ['mfa','password_reset','email_verify'])await query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(randomUUID()),id,purpose]);}

test('Hybrid administrator user management: persistent panel edits, scoped privileges and current credentials',{timeout:180000},async t=>withCrmRecoveryDatabase('user_management',async()=>{
 const previous=process.env.STAFF_PROVISIONING_MODE;process.env.STAFF_PROVISIONING_MODE='hybrid';
 try{
  const owner=fixtureActor('management-owner','superAdmin'),admin=fixtureActor('management-admin','admin'),staff=fixtureActor('management-editor','contentEditor'),customer=fixtureActor('management-customer','customer',{qualityScope:false});
  for(const actor of [owner,admin,staff,customer])await insertActor(actor);
  await getWorkspace(owner);
  const ownerHttp=await context(owner),adminHttp=await context(admin),customerPassword=password();
  await query('UPDATE users SET password_hash=$2 WHERE id=$1',[customer.id,await passwordHash(customerPassword)]);

  await t.test('Production defaults to hybrid and invalid configuration fails explicitly',async()=>{
   const env=process.env.NODE_ENV;delete process.env.STAFF_PROVISIONING_MODE;process.env.NODE_ENV='production';
   try{assert.equal(staffProvisioningMode(),'hybrid');process.env.STAFF_PROVISIONING_MODE='invalid';assert.throws(()=>staffProvisioningMode(),problem(503,'STAFF_CONFIG'));}
   finally{process.env.NODE_ENV=env;process.env.STAFF_PROVISIONING_MODE='hybrid';}
  });
  await t.test('The directory and detail expose target-specific capabilities, safe profile fields and no stored secrets',async()=>{
   const secret='never-display-'+password();await query('UPDATE users SET mfa_secret=$2,mfa_pending_secret=$2,recovery_hashes=$3::jsonb WHERE id=$1',[staff.id,secret,JSON.stringify([secret])]);
   const senior=await listUsers(owner),ordinary=await listUsers(admin),detail=await getManagedUser(owner,staff.id);
   assert.equal(senior.provisioningMode,'hybrid');assert.equal(senior.canCreate,true);assert.equal(senior.canManageGrants,true);
   assert.equal(senior.items.find(item=>item.id===owner.id).capabilities.canManageGrants,false);
   assert.equal(senior.items.find(item=>item.id===staff.id).capabilities.canResetPassword,true);
   assert.equal(ordinary.items.find(item=>item.id===staff.id).capabilities.canResetPassword,false);
   assert.equal(ordinary.items.find(item=>item.id===customer.id).capabilities.canResetPassword,true);
   assert.equal(ordinary.items.find(item=>item.id===owner.id).capabilities.canEdit,false);
   assert.deepEqual(Object.keys(detail.profile).sort(),['phone','contactEmail','organization','profession','bio','website','country','city','address'].sort());
   assert.equal(detail.profileRevision,0);assert.equal(JSON.stringify({senior,ordinary,detail}).includes(secret),false);
   await assert.rejects(getManagedUser(admin,owner.id),problem(403,'ROLE_ESCALATION'));
   assert.equal((await ownerHttp.request('/users/'+staff.id)).status,200);
   assert.equal((await listStaffInvitations(owner)).canInvite,true);
  });
  await t.test('Senior administrators create staff with MFA enrollment while ordinary administrators create customers only',async()=>{
   const response=await ownerHttp.request('/users',{method:'POST',body:{name:'New panel staff',email:'panel-staff@example.invalid',password:password(),role:'support',allowedLocales:['en'],profile:{organization:'Example company'}}});
   assert.equal(response.status,201);const made=await response.json();assert.equal(made.role,'support');assert.equal(made.mfaEnrollmentRequired,true);assert.equal(made.emailVerified,false);assert.equal(made.profile.organization,'Example company');
   const denied=await adminHttp.request('/users',{method:'POST',body:{name:'Role attempt',email:'denied@example.invalid',password:password(),role:'admin'}});assert.equal(denied.status,403);
   const customerResponse=await adminHttp.request('/users',{method:'POST',body:{name:'New panel customer',email:'panel-customer@example.invalid',password:password(),profile:{phone:'+98 912 123 4567',country:'ایران'}}});
   assert.equal(customerResponse.status,201);const account=await customerResponse.json();assert.equal(account.role,'customer');assert.equal(account.emailVerified,false);assert.equal(account.profile.country,'ایران');
   await assert.rejects(createUser(owner,{name:'Invalid fields',email:'extra@example.invalid',password:password(),profile:{role:'superAdmin'}}),problem(422,'VALIDATION'));
  });
  await t.test('The panel creates every staff role with an initial password without requiring an email provider',async()=>{
   for(const role of ['superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support']){
    const initialPassword=password(),response=await ownerHttp.request('/users',{method:'POST',body:{name:'Role '+role,email:'panel-role-'+role.toLowerCase()+'@example.invalid',password:initialPassword,role,allowedLocales:role==='translator'?['en','tr','ar','ru']:languages}});
    assert.equal(response.status,201);const made=await response.json();assert.equal(made.role,role);assert.equal(made.mfaEnrollmentRequired,true);assert.equal(made.emailVerified,false);
    assert.equal(await passwordMatches(initialPassword,(await row(made.id)).password_hash),true);
    assert.equal((await query('SELECT 1 FROM outbox WHERE account_id=$1',[made.id])).rowCount,0);
    // Keep the last-administrator fixtures at the end of this group isolated.
    if(role==='superAdmin')await updateUser(owner,made.id,{active:false});
   }
  });
  await t.test('Profile edits use separate revision and account timestamps, normalize text and reject stale or overposted input',async()=>{
   const before=await getManagedUser(owner,customer.id);
   await assert.rejects(updateUser(owner,customer.id,{profile:{city:'تهران'}}),problem(428,'PRECONDITION_REQUIRED'));
   await assert.rejects(updateUser(owner,customer.id,{profileRevision:before.profileRevision}),problem(422,'EMPTY_PATCH'));
   await assert.rejects(updateUser(owner,customer.id,{profile:{website:'javascript:alert(1)'},profileRevision:0}),problem(422,'VALIDATION'));
   const updated=await updateUser(admin,customer.id,{name:'Customer corrected',profile:{phone:'+98 912 123 4567',contactEmail:'contact@example.com',organization:'  Organization  ',profession:'Buyer',bio:'Line one\nLine two',website:'https://example.com/',country:'ایران',city:'تهران',address:'Address'},profileRevision:before.profileRevision,expectedUpdatedAt:before.updatedAt});
   assert.equal(updated.name,'Customer corrected');assert.equal(updated.profileRevision,1);assert.equal(updated.profile.organization,'Organization');assert.equal(updated.profile.city,'تهران');
   await assert.rejects(updateUser(owner,customer.id,{profile:{city:'Stale city'},profileRevision:before.profileRevision}),problem(409,'PROFILE_CONFLICT'));
   await assert.rejects(updateUser(owner,customer.id,{name:'Stale name',expectedUpdatedAt:before.updatedAt}),problem(409,'USER_CONFLICT'));
   assert.equal((await getManagedUser(owner,customer.id)).name,'Customer corrected');
  });
  await t.test('Duplicate login addresses return a conflict and roll back accompanying profile changes',async()=>{
   const before=await getManagedUser(owner,customer.id);
   await assert.rejects(updateUser(owner,customer.id,{email:owner.email,name:'Must roll back',profile:{city:'Must roll back'},profileRevision:before.profileRevision}),problem(409,'EMAIL_EXISTS'));
   assert.deepEqual(await getManagedUser(owner,customer.id),before);
  });
  await t.test('Email correction invalidates verification, all sessions and every outstanding authentication proof',async()=>{
   await fixtureHttpSession(customer);await fixtureHttpSession(customer);await proofs(customer.id);
   const corrected=await adminHttp.request('/users/'+customer.id,{method:'PATCH',body:{email:'customer-corrected@example.invalid'}});assert.equal(corrected.status,200);const body=await corrected.json();
   assert.equal(body.email,'customer-corrected@example.invalid');assert.equal(body.emailVerified,false);assert.equal(body.requiresReauthentication,false);
   assert.equal((await activeSessions(customer.id)).length,0);assert.equal((await remainingProofs(customer.id)).length,0);
   assert.equal((await getManagedUser(owner,customer.id)).profile.contactEmail,'contact@example.com');
   const request=new Request('http://localhost:3000/api/v1/auth/login');
   await assert.rejects(login(request,{email:customer.email,password:customerPassword}),problem(401,'INVALID_CREDENTIALS'));
   assert.equal((await login(request,{email:body.email,password:customerPassword})).status,200);
  });
  await t.test('A recovery request cannot issue a fresh password token to an email corrected after its first lookup',async()=>{
   const target=fixtureActor('email-recovery-race','customer',{qualityScope:false});await insertActor(target);
   const database=pool(),originalQuery=database.query;let intercepted=false;
   database.query=function(sql,values,...rest){
    const actual=originalQuery.call(this,sql,values,...rest);
    if(sql==='SELECT * FROM users WHERE email=$1 AND active'&&values?.[0]===target.email)return actual.then(async value=>{
     assert.equal(intercepted,false);intercepted=true;await updateUser(owner,target.id,{email:'recovery-corrected@example.invalid'});return value;
    });
    return actual;
   };
   try{
    assert.equal((await forgotPassword(new Request('http://localhost:3000/api/v1/auth/forgot-password'),{email:target.email,locale:'en'})).ok,true);
    assert.equal(intercepted,true);assert.equal((await remainingProofs(target.id)).length,0);assert.equal((await query('SELECT 1 FROM outbox WHERE account_id=$1',[target.id])).rowCount,0);
   }finally{database.query=originalQuery;}
  });
  await t.test('An ordinary administrator cannot change staff credentials or grants; self grants are forbidden',async()=>{
   await assert.rejects(updateUser(admin,staff.id,{email:'cannot-change@example.invalid'}),problem(403,'ROLE_ESCALATION'));
   await assert.rejects(updateUser(admin,staff.id,{role:'admin'}),problem(403,'ROLE_ESCALATION'));
   await assert.rejects(updateUser(owner,owner.id,{qualityScope:false}),problem(403,'SELF_PERMISSION_CHANGE'));
   await assert.rejects(updateUser(owner,owner.id,{role:'admin'}),problem(403,'SELF_ROLE_CHANGE'));
   const corrected=await updateUser(admin,staff.id,{name:'Allowed staff display correction'});assert.equal(corrected.name,'Allowed staff display correction');
   await assert.rejects(updateUser(owner,customer.id,{qualityScope:true}),problem(422,'CUSTOMER_PERMISSIONS'));
  });
  await t.test('Role and access changes invalidate current sessions and challenges and enforce locale boundaries',async()=>{
   await fixtureHttpSession(staff);await proofs(staff.id);
   const changed=await updateUser(owner,staff.id,{role:'translator',allowedLocales:['en','tr'],qualityScope:false,crmScope:'assigned',crmPermissions:{contact:false}});
   assert.equal(changed.role,'translator');assert.deepEqual(changed.allowedLocales,['en','tr']);assert.equal((await activeSessions(staff.id)).length,0);assert.equal((await remainingProofs(staff.id)).length,0);
   await assert.rejects(updateUser(owner,staff.id,{allowedLocales:['fa']}),problem(422,'STAFF_LOCALES'));
  });
  await t.test('Administrative password reset is scoped, current-MFA protected and separate from self-service password change',async()=>{
   assert.equal((await adminHttp.request('/users/'+staff.id+'/password',{method:'POST',body:{password:password()}})).status,403);
   assert.equal((await ownerHttp.request('/users/'+owner.id+'/password',{method:'POST',body:{password:password()}})).status,403);
   const noMfa=await fixtureHttpSession(owner,{mfa:false});assert.equal((await noMfa.request('/users/'+customer.id+'/password',{method:'POST',body:{password:password()}})).status,403);
   const revoked=await fixtureHttpSession(owner);await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[revoked.id]);assert.equal((await revoked.request('/users')).status,401);const rejected=await revoked.request('/users/'+customer.id+'/password',{method:'POST',body:{password:password()}});assert.equal(rejected.status,403);assert.equal((await rejected.json()).error.code,'CSRF');
   assert.equal((await ownerHttp.request('/users/'+customer.id+'/password',{method:'POST',body:{password:password()},headers:{'x-csrf-token':'invalid'}})).status,403);
   assert.equal((await ownerHttp.request('/users/'+customer.id+'/password',{method:'POST',body:{password:'short'}})).status,422);
   assert.equal((await ownerHttp.request('/users/'+customer.id+'/password',{method:'POST',body:{password:password(),expectedUpdatedAt:'not-an-ISO-timestamp'}})).status,422);
  });
  await t.test('A stale conditional password reset returns an HTTP conflict without advancing the account or revoking proofs',async()=>{
   const target=fixtureActor('reset-stale-http','customer',{qualityScope:false});await insertActor(target);
   await query("UPDATE users SET updated_at=now()-interval '1 second' WHERE id=$1",[target.id]);
   const captured=await getManagedUser(owner,target.id);
   const changed=await updateUser(owner,target.id,{name:'A more recent correction',expectedUpdatedAt:captured.updatedAt});
   assert.notEqual(changed.updatedAt,captured.updatedAt);
   await fixtureHttpSession(target);await proofs(target.id);
   const before=await row(target.id),sessions=await activeSessions(target.id),challenges=await remainingProofs(target.id);
   const response=await ownerHttp.request('/users/'+target.id+'/password',{method:'POST',body:{password:password(),expectedUpdatedAt:captured.updatedAt}});
   assert.equal(response.status,409);assert.equal((await response.json()).error.code,'USER_CONFLICT');
   assert.deepEqual(await row(target.id),before);assert.deepEqual(await activeSessions(target.id),sessions);assert.deepEqual(await remainingProofs(target.id),challenges);
   assert.equal((await query("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='staff.password_reset'",[target.id])).rowCount,0);
  });
  for(const change of ['name','email','grants'])await t.test('A '+change+' edit during password hashing cannot be skipped by advancing a stale editor version',async()=>{
   const target=fixtureActor('reset-version-'+change,'contentEditor');await insertActor(target);
   const before=await row(target.id),replacement=password(),barrier=holdDerivations(replacement);
   const pending=result(resetManagedUserPassword(ownerHttp.context,target.id,{password:replacement,expectedUpdatedAt:before.updated_at.toISOString()}));
   try{
    await barrier.wait();
    const patch=change==='name'?{name:'Concurrent name correction'}:change==='email'?{email:'reset-version-corrected@example.invalid'}:{allowedLocales:['en'],qualityScope:false,crmScope:'team',crmPermissions:{contact:true}};
    await updateUser(owner,target.id,patch);
    // Email/grant changes revoke their previous proofs legitimately. A reset
    // based on the older editor must not mutate this newer account or revoke
    // the fresh proofs created after that completed correction.
    await fixtureHttpSession(target);await proofs(target.id);
    const corrected=await row(target.id),sessions=await activeSessions(target.id),challenges=await remainingProofs(target.id);
    assert.notEqual(corrected.updated_at.toISOString(),before.updated_at.toISOString());
    barrier.release();const denied=await pending;
    assert.equal(denied.error?.status,409);assert.equal(denied.error?.code,'USER_CONFLICT');
    assert.deepEqual(await row(target.id),corrected);assert.deepEqual(await activeSessions(target.id),sessions);assert.deepEqual(await remainingProofs(target.id),challenges);
    assert.equal((await query("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='staff.password_reset'",[target.id])).rowCount,0);
   }finally{barrier.restore();await pending;}
  });
  await t.test('Reset replaces the password, clears lockout, preserves enrolled MFA and never returns or audits credentials',async()=>{
   const secret=newTotpSecret(),recovery=hash(randomUUID()),replacement=password(),oldPassword=password();
   await query("UPDATE users SET password_hash=$2,mfa_secret=$3,mfa_enabled=true,recovery_hashes=$4::jsonb,mfa_pending_secret=$3,mfa_pending_expires_at=now()+interval '5 minutes',failed_logins=8,locked_until=now()+interval '20 minutes' WHERE id=$1",[staff.id,await passwordHash(oldPassword),encrypt(secret),JSON.stringify([recovery])]);
   await fixtureHttpSession(staff);await proofs(staff.id);
   const captured=await getManagedUser(owner,staff.id);
   const response=await ownerHttp.request('/users/'+staff.id+'/password',{method:'POST',body:{password:replacement,expectedUpdatedAt:captured.updatedAt}});assert.equal(response.status,200);const value=await response.json();
   assert.equal(value.ok,true);assert.equal(value.sessionsRevoked,true);assert.equal(value.userId,staff.id);assert.match(value.updatedAt,/Z$/);
   const after=await row(staff.id);assert.equal(await passwordMatches(replacement,after.password_hash),true);assert.equal(await passwordMatches(oldPassword,after.password_hash),false);assert.equal(after.mfa_enabled,true);assert.deepEqual(after.recovery_hashes,[recovery]);assert.equal(after.mfa_pending_secret,null);assert.equal(after.locked_until,null);assert.equal(after.failed_logins,0);
   assert.equal(value.updatedAt,after.updated_at.toISOString());assert.notEqual(value.updatedAt,captured.updatedAt);
   const saved=await updateUser(owner,staff.id,{name:'Saved after the conditional password reset',expectedUpdatedAt:value.updatedAt});assert.equal(saved.name,'Saved after the conditional password reset');
   assert.equal((await activeSessions(staff.id)).length,0);assert.equal((await remainingProofs(staff.id)).length,0);
   const audit=JSON.stringify((await query("SELECT * FROM audit_events WHERE action='staff.password_reset'")).rows);
   for(const forbidden of [replacement,oldPassword,after.password_hash,secret,recovery]){assert.equal(JSON.stringify(value).includes(forbidden),false);assert.equal(audit.includes(forbidden),false);}
   const responseLogin=await login(new Request('http://localhost:3000/api/v1/auth/login'),{email:after.email,password:replacement});assert.equal((await responseLogin.json()).mfaRequired,true);
   const customerReset=await adminHttp.request('/users/'+customer.id+'/password',{method:'POST',body:{password:password()}});assert.equal(customerReset.status,200);
  });
  await t.test('Session, administrator-role and target-role changes during password hashing reject stale reset authority',async()=>{
   for(const change of ['session','role','target-role']){
    const resetter=fixtureActor('resetter-'+randomUUID(),'admin'),target=fixtureActor('reset-target-'+randomUUID(),'customer',{qualityScope:false});await insertActor(resetter);await insertActor(target);
    const current=await context(resetter),replacement=password(),before=await row(target.id),barrier=holdDerivations(replacement),pending=result(resetManagedUserPassword(current.context,target.id,{password:replacement,expectedUpdatedAt:before.updated_at.toISOString()}));
    try{
     await barrier.wait();
     if(change==='session')await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[current.id]);
     if(change==='role')await query("UPDATE users SET role='support' WHERE id=$1",[resetter.id]);
     if(change==='target-role')await query("UPDATE users SET role='contentEditor' WHERE id=$1",[target.id]);
     barrier.release();const denied=await pending;assert.equal(denied.error?.status,403);assert.equal((await row(target.id)).password_hash,before.password_hash);
     assert.equal((await query("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='staff.password_reset'",[target.id])).rowCount,0);
    }finally{barrier.restore();await pending;}
   }
  });
  await t.test('Environment-seeded identity remains bound to user ID after panel email, role, profile, password and status changes',async()=>{
   const entry={key:'hybrid-persistence',name:'Original environment staff',email:'original-env@example.invalid',role:'contentEditor',allowedLocales:[...languages],password:password()},env={STAFF_ACCOUNTS_JSON:JSON.stringify([entry])};
   assert.equal((await provisionStaffAccounts({env})).created,1);const original=(await query('SELECT * FROM users WHERE email=$1',[entry.email])).rows[0],replacement=password();
   const initial=await getManagedUser(owner,original.id);
   await updateUser(owner,original.id,{name:'Panel name persists',email:'corrected-env@example.invalid',profile:{organization:'Panel organization'},profileRevision:initial.profileRevision});
   await resetManagedUserPassword(ownerHttp.context,original.id,{password:replacement});
   await updateUser(owner,original.id,{role:'customer',qualityScope:false,crmScope:'assigned',crmPermissions:{},allowedLocales:['en'],active:false});
   // A different account may now own the original login address. Reseeding
   // must never take it over or attach the immutable key to that account.
   const occupant=fixtureActor('old-address-customer','customer',{email:entry.email,qualityScope:false});await insertActor(occupant);
   const rerun=await provisionStaffAccounts({env});assert.equal(rerun.created,0);assert.equal(rerun.grantsPending,1);assert.equal(rerun.passwordsRotated,0);
   const after=await getManagedUser(owner,original.id);assert.equal(after.name,'Panel name persists');assert.equal(after.email,'corrected-env@example.invalid');assert.equal(after.role,'customer');assert.equal(after.active,false);assert.deepEqual(after.allowedLocales,['en']);assert.equal(after.profile.organization,'Panel organization');assert.equal(await passwordMatches(replacement,(await row(original.id)).password_hash),true);assert.equal((await row(occupant.id)).role,'customer');
   assert.equal((await query('SELECT user_id FROM staff_provisioned_accounts WHERE provision_key=$1',[entry.key])).rows[0].user_id,original.id);
   await assert.rejects(provisionStaffAccounts({env:{STAFF_ACCOUNTS_JSON:JSON.stringify([{...entry,email:'key-reassignment@example.invalid'}])}}),problem(409,'PROVISION_IDENTITY_CHANGED'));
  });
  await t.test('Explicit env mode still locks staff credentials and grant management while customer corrections remain usable',async()=>{
   process.env.STAFF_PROVISIONING_MODE='env';
   try{
    const detail=await getManagedUser(owner,staff.id);assert.equal(detail.capabilities.canChangeEmail,false);assert.equal(detail.capabilities.canResetPassword,false);assert.equal(detail.capabilities.canManageGrants,false);
    await assert.rejects(updateUser(owner,staff.id,{email:'locked@example.invalid'}),problem(403,'STAFF_ENV_MANAGED'));
    await assert.rejects(resetManagedUserPassword(ownerHttp.context,staff.id,{password:password()}),problem(403,'STAFF_ENV_MANAGED'));
    assert.equal((await updateUser(admin,customer.id,{name:'Customer remains manageable'})).name,'Customer remains manageable');
   }finally{process.env.STAFF_PROVISIONING_MODE='hybrid';}
  });
  await t.test('An administrator changing their own login email must sign in again, while enrolled MFA remains intact',async()=>{
   const second=fixtureActor('email-owner','superAdmin');await insertActor(second);const current=await context(second);await proofs(second.id);
   const response=await current.request('/users/'+second.id,{method:'PATCH',body:{email:'owner-corrected@example.invalid'}});assert.equal(response.status,200);assert.equal((await response.json()).requiresReauthentication,true);
   assert.equal((await row(second.id)).email_verified,false);assert.equal((await row(second.id)).mfa_enabled,true);assert.equal((await activeSessions(second.id)).length,0);assert.equal((await remainingProofs(second.id)).length,0);
   assert.equal((await current.request('/users')).status,401);await updateUser(owner,second.id,{active:false});
  });
  await t.test('Last-super-admin and concurrent cross-deactivation guards preserve an active administrator',async()=>{
   await assert.rejects(updateUser(owner,owner.id,{active:false}),problem(409,'LAST_ADMIN'));
   const second=fixtureActor('concurrent-owner','superAdmin');await insertActor(second);
   const outcomes=await Promise.allSettled([updateUser(owner,second.id,{active:false}),updateUser(second,owner.id,{active:false})]);
   assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);assert.equal(outcomes.filter(value=>value.status==='rejected').length,1);
   assert.equal((await query("SELECT count(*)::int AS n FROM users WHERE active AND role='superAdmin'")).rows[0].n,1);
  });
 }finally{if(previous===undefined)delete process.env.STAFF_PROVISIONING_MODE;else process.env.STAFF_PROVISIONING_MODE=previous;}
}));
