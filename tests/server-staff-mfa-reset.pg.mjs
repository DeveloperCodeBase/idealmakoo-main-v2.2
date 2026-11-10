import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {query} from '../src/server/db.ts';
import {provisionStaffAccounts} from '../src/server/staff-provisioning.ts';
import {hash,passwordMatches,newTotpSecret,encrypt,decrypt,totp} from '../src/server/crypto.ts';
import {login} from '../src/server/auth.ts';
import {handleRequest} from '../src/server/router.ts';
import {HttpError} from '../src/server/types.ts';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,fixtureHttpSession} from './helpers/crm-recovery-environment.mjs';

const password=()=>randomBytes(24).toString('base64url');
const failure=(status,code)=>error=>error instanceof HttpError&&error.status===status&&error.code===code;
const request=new Request('http://localhost:3000/api/v1/auth/login',{headers:{origin:'http://localhost:3000'}});

test('Explicit owner MFA recovery rotates credentials, retains permissions and requires a completely new enrollment',{timeout:180000},async t=>withCrmRecoveryDatabase('staff_mfa_reset',async({scoped,control,schema})=>{
 const root=fixtureActor('recovery-root','superAdmin');await insertActor(root);
 const entry={key:'recovery-staff',email:'recovery-staff@example.invalid',name:'Recovery staff',role:'contentEditor',allowedLocales:['en'],qualityScope:false,crmScope:'assigned',crmPermissions:{},password:password()};
 const environment=record=>({STAFF_ACCOUNTS_JSON:JSON.stringify([record])});
 await provisionStaffAccounts({env:environment(entry)});
 const user=(await query('SELECT * FROM users WHERE email=$1',[entry.email])).rows[0];
 const secret=encrypt(newTotpSecret());
 await query("UPDATE users SET mfa_enabled=true,mfa_secret=$2,mfa_pending_secret=$2,mfa_pending_expires_at=now()+interval '5 minutes',mfa_last_counter=123,recovery_hashes=$3::jsonb WHERE id=$1",[user.id,secret,JSON.stringify([hash('old-recovery-code')])]);
 const actor=fixtureActor(user.id,entry.role,{email:entry.email,allowedLocales:entry.allowedLocales,qualityScope:false}),session=await fixtureHttpSession(actor);
 for(const purpose of['mfa','email_verify','password_reset'])await query('INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval \'1 hour\')',[hash(randomUUID()),user.id,purpose]);
 const initial=(await query('SELECT * FROM users WHERE id=$1',[user.id])).rows[0];
 const replacement={...entry,password:password()};

 await t.test('Reset requires an existing listed identity, a different env password and an explicit recovery decision',async()=>{
  const reset={env:environment(replacement),resetMfaKeys:[entry.key]};
  await assert.rejects(provisionStaffAccounts(reset),failure(422,'PROVISION_MFA_PASSWORD_ROTATION'));
  await assert.rejects(provisionStaffAccounts({...reset,rotatePasswords:true,env:environment(entry)}),failure(422,'PROVISION_MFA_PASSWORD_ROTATION'));
  const {password:discard,...withoutPassword}=entry;await assert.rejects(provisionStaffAccounts({...reset,rotatePasswords:true,env:environment(withoutPassword)}),failure(422,'PROVISION_MFA_PASSWORD_ROTATION'));
  await assert.rejects(provisionStaffAccounts({...reset,rotatePasswords:true,resetMfaKeys:['not-listed']}),failure(422,'PROVISION_MFA_UNKNOWN'));
  await assert.rejects(provisionStaffAccounts({...reset,rotatePasswords:true,env:{STAFF_ACCOUNTS_JSON:'[]'}}),failure(422,'PROVISION_MFA_UNKNOWN'));
  await assert.rejects(provisionStaffAccounts({...reset,rotatePasswords:true,resetMfaKeys:[entry.key,entry.key]}),failure(422,'PROVISION_MFA_KEY'));
  assert.deepEqual((await query('SELECT * FROM users WHERE id=$1',[user.id])).rows[0],initial);
  assert.equal((await query('SELECT revoked_at FROM sessions WHERE id=$1',[session.id])).rows[0].revoked_at,null);
 });

 await t.test('An audit failure rolls back the new password, MFA removal and revocation atomically',async()=>{
  await query("CREATE FUNCTION reject_owner_mfa_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='staff.env.mfa_reset' THEN RAISE EXCEPTION 'isolated owner MFA audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_owner_mfa_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_owner_mfa_audit()");
  try{await assert.rejects(provisionStaffAccounts({env:environment(replacement),rotatePasswords:true,resetMfaKeys:[entry.key]}),/isolated owner MFA audit failure/);assert.deepEqual((await query('SELECT * FROM users WHERE id=$1',[user.id])).rows[0],initial);assert.equal((await query('SELECT consumed_at FROM auth_challenges WHERE user_id=$1 AND consumed_at IS NOT NULL',[user.id])).rowCount,0);assert.equal((await query('SELECT revoked_at FROM sessions WHERE id=$1',[session.id])).rows[0].revoked_at,null);}
  finally{await query('DROP TRIGGER reject_owner_mfa_audit ON audit_events; DROP FUNCTION reject_owner_mfa_audit()');}
 });

 await t.test('Inactive staff require explicit reactivation and pending grants require a reviewed sync',async()=>{
  await query('UPDATE users SET active=false WHERE id=$1',[user.id]);
  const reset={env:environment(replacement),rotatePasswords:true,resetMfaKeys:[entry.key]};
  await assert.rejects(provisionStaffAccounts(reset),failure(409,'PROVISION_MFA_REACTIVATE_REQUIRED'));
  await assert.rejects(provisionStaffAccounts({...reset,reactivateKeys:[entry.key],env:environment({...replacement,allowedLocales:['en','tr']})}),failure(409,'PROVISION_GRANTS_PENDING'));
  assert.equal((await query('SELECT active FROM users WHERE id=$1',[user.id])).rows[0].active,false);
  const result=await provisionStaffAccounts({...reset,reactivateKeys:[entry.key]});assert.equal(result.mfaResets,1);assert.equal(result.passwordsRotated,1);assert.equal(result.reactivated,1);
  const after=(await query('SELECT * FROM users WHERE id=$1',[user.id])).rows[0];assert.equal(after.role,entry.role);assert.deepEqual(after.allowed_locales,entry.allowedLocales);assert.equal(after.quality_scope,false);assert.equal(after.mfa_enabled,false);assert.equal(after.mfa_secret,null);assert.equal(after.mfa_pending_secret,null);assert.equal(after.mfa_pending_expires_at,null);assert.equal(Number(after.mfa_last_counter),-1);assert.deepEqual(after.recovery_hashes,[]);assert.equal(await passwordMatches(entry.password,after.password_hash),false);assert.equal(await passwordMatches(replacement.password,after.password_hash),true);
  assert.ok((await query('SELECT revoked_at FROM sessions WHERE id=$1',[session.id])).rows[0].revoked_at);assert.equal((await query('SELECT 1 FROM auth_challenges WHERE user_id=$1 AND consumed_at IS NULL',[user.id])).rowCount,0);
  const audits=(await query("SELECT actor_id,details FROM audit_events WHERE action='staff.env.mfa_reset' AND entity_id=$1",[user.id])).rows;assert.equal(audits.length,1);assert.equal(audits[0].actor_id,null);assert.deepEqual(audits[0].details,{provisionKey:entry.key,reason:'explicit-owner-recovery',requiresEnrollment:true});for(const value of[entry.password,replacement.password,secret])assert.equal(JSON.stringify(audits).includes(value),false);
 });

 await t.test('The new password gives only the enrollment session; no administrative access until fresh TOTP confirmation',async()=>{
  await assert.rejects(login(request,{email:entry.email,password:entry.password}),failure(401,'INVALID_CREDENTIALS'));
  const signed=await login(request,{email:entry.email,password:replacement.password}),body=await signed.json();assert.equal(body.mfaEnrollmentRequired,true);assert.equal(body.mfaRequired,undefined);
  const cookie=signed.headers.get('set-cookie').split(';')[0],csrf=body.csrfToken;
  async function http(path,body,method=body?'POST':'GET'){const url=new URL('/api/v1'+path,'http://localhost:3000');return handleRequest(new Request(url,{method,headers:{cookie,origin:'http://localhost:3000','x-csrf-token':csrf,...body?{'content-type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}}),path.slice(1).split('/'));}
  assert.equal((await http('/workspace')).status,403);assert.equal((await http('/admin/storage-policy')).status,403);assert.equal((await http('/users/'+user.id,{active:true},'PATCH')).status,403);
  assert.equal((await(await http('/me/security')).json()).mfaEnabled,false);
  const enrollment=await http('/auth/mfa/enroll',{password:replacement.password});assert.equal(enrollment.status,200);const setup=await enrollment.json();assert.ok(setup.secret);assert.notEqual(setup.secret,decrypt(secret));
  const confirmed=await http('/auth/mfa/confirm',{code:totp(setup.secret,Math.floor(Date.now()/30000))});assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).recoveryCodes.length,10);
  assert.equal((await http('/workspace')).status,200);
  const enrolled=(await query('SELECT mfa_enabled,mfa_secret,recovery_hashes FROM users WHERE id=$1',[user.id])).rows[0];assert.equal(enrolled.mfa_enabled,true);assert.notEqual(enrolled.mfa_secret,secret);
  assert.equal((await provisionStaffAccounts({env:environment(replacement)})).mfaResets,0);await assert.rejects(provisionStaffAccounts({env:environment(replacement),rotatePasswords:true,resetMfaKeys:[entry.key]}),failure(422,'PROVISION_MFA_PASSWORD_ROTATION'));assert.deepEqual((await query('SELECT mfa_enabled,mfa_secret,recovery_hashes FROM users WHERE id=$1',[user.id])).rows[0],enrolled);
 });

 await t.test('The owner CLI rejects limited runtime credentials even if that role has INSERT on the binding table',async()=>{
  const provided=process.env.TEST_RUNTIME_DATABASE_URL?new URL(process.env.TEST_RUNTIME_DATABASE_URL):undefined,restricted=new URL(scoped);let role,created=false;
  if(provided){assert.equal(provided.hostname,scoped.hostname);assert.equal(provided.port,scoped.port);assert.equal(provided.pathname,scoped.pathname);restricted.username=provided.username;restricted.password=provided.password;role=decodeURIComponent(provided.username);}
  else{const allowed=(await control.query('SELECT rolsuper OR rolcreaterole AS allowed FROM pg_roles WHERE rolname=current_user')).rows[0].allowed;assert.ok(allowed,'Provide TEST_RUNTIME_DATABASE_URL when the isolated schema owner cannot CREATE ROLE');role='staff_mfa_runtime_'+randomUUID().replaceAll('-','');const credential=password();await control.query(`CREATE ROLE ${role} LOGIN PASSWORD '${credential}'`);created=true;restricted.username=role;restricted.password=credential;}
  const identifier='"'+role.replaceAll('"','""')+'"';
  try{
   await control.query(`GRANT USAGE ON SCHEMA ${schema} TO ${identifier}`);await control.query(`GRANT SELECT,INSERT ON ${schema}.staff_provisioned_accounts TO ${identifier}`);
   const env={...process.env,...environment({...replacement,password:password()}),MIGRATION_DATABASE_URL:restricted.toString()};for(const key of['BOOTSTRAP_ADMIN_EMAIL','BOOTSTRAP_ADMIN_PASSWORD','BOOTSTRAP_ADMIN_NAME'])delete env[key];
   const result=await new Promise((resolve,reject)=>{let stdout='',stderr='';const child=spawn(process.execPath,['--import','tsx','scripts/provision-staff.ts','--rotate-passwords','--reset-mfa='+entry.key],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('exit',exitCode=>resolve({exitCode,stdout,stderr}));});
   assert.equal(result.exitCode,1);assert.match(result.stderr,/migration owner connection/);assert.equal(result.stdout,'');assert.equal((await query('SELECT mfa_enabled FROM users WHERE id=$1',[user.id])).rows[0].mfa_enabled,true);
  }finally{await control.query(`REVOKE ALL PRIVILEGES ON ${schema}.staff_provisioned_accounts FROM ${identifier}`);await control.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${schema} FROM ${identifier}`);if(created)await control.query(`DROP ROLE ${identifier}`);}
 });
}));
