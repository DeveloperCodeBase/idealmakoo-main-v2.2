import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {query} from '../src/server/db.ts';
import {hash,passwordHash,passwordMatches} from '../src/server/crypto.ts';
import {HttpError} from '../src/server/types.ts';
import {parseStaffAccounts,provisionStaffAccounts} from '../src/server/staff-provisioning.ts';
import {staffProvisioningMode} from '../src/server/staff-provisioning-mode.ts';
import {register} from '../src/server/auth.ts';
import {createUser,updateUser,listUsers} from '../src/server/account.ts';
import {createStaffInvitation,acceptStaffInvitation} from '../src/server/staff-lifecycle.ts';
import {getWorkspace} from '../src/server/workspace.ts';
import {fixtureActor,insertActor,fixtureHttpSession,permissions,withCrmRecoveryDatabase,languages} from './helpers/crm-recovery-environment.mjs';

const roles=['superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support'];
const failure=(status,code)=>error=>error instanceof HttpError&&error.status===status&&error.code===code;
const password=()=>randomBytes(24).toString('base64url');
const item=(role,index)=>({key:'team-'+index,email:'staff-'+index+'@example.invalid',name:'Environment staff '+index,role,allowedLocales:role==='translator'?['en','tr','ar','ru']:[...languages],qualityScope:role==='scientificReviewer',crmScope:'assigned',crmPermissions:{},password:password()});

test('Environment staff provisioning: immutable identity, idempotent startup, explicit grants and password rotation',{timeout:180000},async t=>withCrmRecoveryDatabase('staff_provision',async()=>{
 const originalMode=process.env.STAFF_PROVISIONING_MODE;process.env.STAFF_PROVISIONING_MODE='env';
 try{
 const roster=roles.map(item),env={BOOTSTRAP_ADMIN_EMAIL:'bootstrap@example.invalid',BOOTSTRAP_ADMIN_PASSWORD:password(),STAFF_ACCOUNTS_JSON:JSON.stringify(roster)};
 await t.test('The complete configuration is validated without echoing credential values',async()=>{
  assert.equal(parseStaffAccounts(env).length,roles.length);
  const sentinel='private-value-'+password();
  for(const value of ['not-json',JSON.stringify([{...roster[0],password:sentinel,role:'customer'}]),JSON.stringify([{...roster[5],allowedLocales:['fa']}]),JSON.stringify([roster[0],roster[0]]),JSON.stringify([{...roster[0],key:'bootstrap-admin'}]),JSON.stringify([{...roster[0],qualityScope:'true'}])]){
   assert.throws(()=>parseStaffAccounts({STAFF_ACCOUNTS_JSON:value}),error=>error instanceof Error&&!error.message.includes(sentinel));
  }
  const previous=process.env.NODE_ENV;delete process.env.STAFF_PROVISIONING_MODE;process.env.NODE_ENV='production';assert.equal(staffProvisioningMode(),'hybrid');process.env.NODE_ENV=previous;process.env.STAFF_PROVISIONING_MODE='env';
 });
 await t.test('First seed creates every supported staff role, independent hashes, MFA enrollment and no customers',async()=>{
  const result=await provisionStaffAccounts({includeBootstrap:true,env});assert.equal(result.created,12);assert.equal(result.bootstrapCreated,true);
  const users=(await query('SELECT * FROM users')).rows;assert.equal(users.length,12);assert.equal(users.filter(user=>user.role==='customer').length,0);assert.equal(new Set(users.map(user=>user.password_hash)).size,12);
  for(const row of roster){const user=users.find(user=>user.email===row.email);assert.ok(user);assert.equal(user.role,row.role);assert.equal(await passwordMatches(row.password,user.password_hash),true);assert.equal(user.mfa_enabled,false);assert.equal(user.email_verified,true);assert.deepEqual(user.allowed_locales,row.allowedLocales);}
  const audit=JSON.stringify((await query('SELECT * FROM audit_events')).rows);assert.ok(!roster.some(row=>audit.includes(row.password)));assert.ok(!audit.includes(env.BOOTSTRAP_ADMIN_PASSWORD));
 });
 await t.test('Rerunning seed never resets edited credentials, MFA, deactivation or language grants',async()=>{
  const target=(await query('SELECT * FROM users WHERE email=$1',[roster[2].email])).rows[0],edited=password();
  await query("UPDATE users SET name='Edited profile name',password_hash=$2,mfa_enabled=true,active=false,allowed_locales='[\"en\"]'::jsonb WHERE id=$1",[target.id,await passwordHash(edited)]);
  const result=await provisionStaffAccounts({includeBootstrap:true,env});assert.equal(result.created,0);assert.equal(result.grantsPending,1);assert.equal(result.passwordsRotated,0);
  const user=(await query('SELECT * FROM users WHERE id=$1',[target.id])).rows[0];assert.equal(await passwordMatches(edited,user.password_hash),true);assert.equal(user.name,'Edited profile name');assert.equal(user.mfa_enabled,true);assert.equal(user.active,false);assert.deepEqual(user.allowed_locales,['en']);
  await query('UPDATE users SET active=true WHERE id=$1',[target.id]);
 });
 await t.test('Explicit grant synchronization revokes sessions/challenges and preserves the password and profile',async()=>{
  const user=(await query('SELECT * FROM users WHERE email=$1',[roster[2].email])).rows[0],actor=fixtureActor(user.id,user.role,{email:user.email});
  const session=await fixtureHttpSession(actor);await query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'password_reset',now()+interval '1 hour')",[hash(randomUUID()),user.id]);
  const result=await provisionStaffAccounts({includeBootstrap:true,syncGrants:true,env});assert.equal(result.grantsSynchronized,1);assert.equal(result.passwordsRotated,0);
  const after=(await query('SELECT * FROM users WHERE id=$1',[user.id])).rows[0];assert.deepEqual(after.allowed_locales,languages);assert.equal(after.name,'Edited profile name');assert.equal(after.password_hash,user.password_hash);assert.equal(after.mfa_enabled,true);
  assert.ok((await query('SELECT revoked_at FROM sessions WHERE id=$1',[session.id])).rows[0].revoked_at);assert.equal((await query('SELECT 1 FROM auth_challenges WHERE user_id=$1 AND consumed_at IS NULL',[user.id])).rowCount,0);
 });
 await t.test('Password rotation requires the explicit command and never emits a password in audit',async()=>{
  const result=await provisionStaffAccounts({includeBootstrap:true,rotatePasswords:true,env});assert.equal(result.passwordsRotated,1);
  const user=(await query('SELECT * FROM users WHERE email=$1',[roster[2].email])).rows[0];assert.equal(await passwordMatches(roster[2].password,user.password_hash),true);assert.equal(user.mfa_enabled,true);
  const audit=JSON.stringify((await query("SELECT details FROM audit_events WHERE action='staff.env.password_rotated'")).rows);assert.equal(audit.includes(roster[2].password),false);
  const again=await provisionStaffAccounts({includeBootstrap:true,rotatePasswords:true,env});assert.equal(again.passwordsRotated,0);
 });
 await t.test('A conflicting email or changed identity key aborts the complete transaction, never promotes a customer',async()=>{
  const customer=fixtureActor('existing-customer','customer');await insertActor(customer,{mfa:false,grants:{}});
  const fresh={...item('support',50)},collision={...item('admin',51),email:customer.email};const before=(await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  await assert.rejects(provisionStaffAccounts({env:{STAFF_ACCOUNTS_JSON:JSON.stringify([fresh,collision])}}),failure(409,'PROVISION_EMAIL_OCCUPIED'));assert.equal((await query('SELECT count(*)::int AS n FROM users')).rows[0].n,before);assert.equal((await query('SELECT role FROM users WHERE id=$1',[customer.id])).rows[0].role,'customer');
  await assert.rejects(provisionStaffAccounts({env:{STAFF_ACCOUNTS_JSON:JSON.stringify([{...roster[0],email:'renamed@example.invalid'}])}}),failure(409,'PROVISION_IDENTITY_CHANGED'));
  await assert.rejects(query("UPDATE staff_provisioned_accounts SET configured_email='changed@example.invalid' WHERE provision_key=$1",[roster[0].key]));
 });
 await t.test('Environment management disables all authenticated staff creation/escalation/invitation routes',async()=>{
  const seniorRow=(await query('SELECT * FROM users WHERE email=$1',[env.BOOTSTRAP_ADMIN_EMAIL])).rows[0];await query('UPDATE users SET mfa_enabled=true WHERE id=$1',[seniorRow.id]);const senior=fixtureActor(seniorRow.id,'superAdmin',{email:seniorRow.email});await getWorkspace(senior);
  const listing=await listUsers(senior);assert.equal(listing.provisioningMode,'env');assert.equal(listing.canCreate,false);assert.equal(listing.canManageGrants,false);assert.equal(JSON.stringify(listing).includes('password_hash'),false);
  await assert.rejects(createUser(senior,{name:'Escalation attempt',email:'bad@example.invalid',password:password(),role:'admin'}),failure(403,'STAFF_ENV_MANAGED'));
  await assert.rejects(updateUser(senior,'existing-customer',{role:'superAdmin'}),failure(403,'STAFF_ENV_MANAGED'));
  await assert.rejects(createStaffInvitation(senior,{email:'invite@example.invalid',role:'business',allowedLocales:['en']}),failure(403,'STAFF_ENV_MANAGED'));
  await assert.rejects(acceptStaffInvitation(fixtureActor('existing-customer','customer'),{token:'a'.repeat(64)}),failure(403,'STAFF_ENV_MANAGED'));
  const http=await fixtureHttpSession(senior);const response=await http.request('/users/existing-customer',{method:'PATCH',body:{role:'superAdmin'}});assert.equal(response.status,403);assert.equal((await response.json()).error.code,'STAFF_ENV_MANAGED');
 });
 await t.test('Public registration still creates only customers and rejects overposted privileges',async()=>{
  const request=new Request('http://localhost:3000/api/v1/auth/register',{method:'POST'}),body={name:'Public customer',email:'signup@example.invalid',password:password()};
  for(const extra of [{role:'superAdmin'},{qualityScope:true},{allowedLocales:['fa']},{crmPermissions:{financial:true}}])await assert.rejects(register(request,{...body,...extra}),failure(422,'VALIDATION'));
  const response=await register(request,body);assert.equal(response.status,201);const value=await response.json();assert.equal(value.user.role,'customer');assert.equal(value.user.mfaEnrollmentRequired,false);
  const user=(await query('SELECT * FROM users WHERE email=$1',[body.email])).rows[0];assert.equal(user.role,'customer');assert.equal(user.quality_scope,false);assert.equal(user.email_verified,false);
 });
 await t.test('Unlisted staff remain retained and deactivated accounts never reactivate on a provisioning rerun',async()=>{
  const user=(await query('SELECT id FROM users WHERE email=$1',[roster.at(-1).email])).rows[0];await query('UPDATE users SET active=false WHERE id=$1',[user.id]);
  const result=await provisionStaffAccounts({includeBootstrap:true,env:{...env,STAFF_ACCOUNTS_JSON:JSON.stringify(roster.slice(0,-1))}});assert.equal(result.unlistedManagedAccounts,1);assert.equal((await query('SELECT active FROM users WHERE id=$1',[user.id])).rows[0].active,false);
 });
 await t.test('Creation passwords can be removed from env after provisioning without breaking a later seed',async()=>{
  const withoutPasswords=roster.map(({password,...row})=>row);
  const result=await provisionStaffAccounts({includeBootstrap:true,env:{...env,BOOTSTRAP_ADMIN_PASSWORD:'',STAFF_ACCOUNTS_JSON:JSON.stringify(withoutPasswords)}});assert.equal(result.created,0);assert.equal(result.passwordsRotated,0);
 });
 await t.test('Reactivation is an explicit owner action for a listed immutable key and preserves established MFA',async()=>{
  const entry=roster.at(-1),user=(await query('SELECT * FROM users WHERE email=$1',[entry.email])).rows[0];
  await query('UPDATE users SET active=false,mfa_enabled=true WHERE id=$1',[user.id]);const session=await fixtureHttpSession(fixtureActor(user.id,user.role,{email:user.email}));
  await assert.rejects(provisionStaffAccounts({env,reactivateKeys:['unknown-staff']}),failure(422,'PROVISION_REACTIVATE_UNKNOWN'));
  await assert.rejects(provisionStaffAccounts({env:{...env,STAFF_ACCOUNTS_JSON:'[]'},reactivateKeys:[entry.key]}),failure(422,'PROVISION_REACTIVATE_UNKNOWN'));
  await query('UPDATE users SET allowed_locales=$2::jsonb WHERE id=$1',[user.id,JSON.stringify(['en'])]);
  await assert.rejects(provisionStaffAccounts({env,reactivateKeys:[entry.key]}),failure(409,'PROVISION_GRANTS_PENDING'));
  assert.equal((await query('SELECT active FROM users WHERE id=$1',[user.id])).rows[0].active,false);
  const result=await provisionStaffAccounts({env,syncGrants:true,reactivateKeys:[entry.key]});assert.equal(result.reactivated,1);
  const after=(await query('SELECT * FROM users WHERE id=$1',[user.id])).rows[0];assert.equal(after.active,true);assert.equal(after.mfa_enabled,true);assert.equal(after.password_hash,user.password_hash);assert.deepEqual(after.allowed_locales,entry.allowedLocales);assert.ok((await query('SELECT revoked_at FROM sessions WHERE id=$1',[session.id])).rows[0].revoked_at);
  assert.equal((await provisionStaffAccounts({env,reactivateKeys:[entry.key]})).reactivated,0);
 });
 }finally{if(originalMode===undefined)delete process.env.STAFF_PROVISIONING_MODE;else process.env.STAFF_PROVISIONING_MODE=originalMode;}
}));
