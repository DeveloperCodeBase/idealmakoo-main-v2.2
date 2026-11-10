import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chmod,readFile,stat,symlink,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,fixtureHttpSession} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {hash,encrypt,newTotpSecret} from '../src/server/crypto.ts';
import {createOrganization} from '../src/server/organizations.ts';
import {captureRestoreAccess,applyRestoreSecurity,parseRestoreAccessSnapshot} from '../scripts/restore-security-lib.ts';

const none={contact:false,financial:false,baseCost:false,assign:false,intake:false};
async function account(label,role='business',options={}){
 const actor=fixtureActor(label+'-'+randomUUID(),role,{qualityScope:false,allowedLocales:['en']});await insertActor(actor,{mfa:true,grants:options.grants||{}});
 const verifier='isolated non-login verifier '+randomUUID(),secret=encrypt(newTotpSecret());
 await query("UPDATE users SET password_hash=$2,mfa_secret=$3,recovery_hashes=$4::jsonb,mfa_pending_secret=$3,mfa_pending_expires_at=now()+interval '5 minutes',active=$5 WHERE id=$1",[actor.id,verifier,secret,JSON.stringify([hash(randomUUID()),hash(randomUUID())]),options.active!==false]);
 return{actor,verifier,secret};
}
async function row(id){return(await query('SELECT * FROM users WHERE id=$1',[id])).rows[0];}
async function pendingChallenges(userId){for(const purpose of['mfa','password_reset','email_verify'])await query('INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')',[hash(randomUUID()),userId,purpose]);}
const code=expected=>error=>error?.code===expected;

test('Owner restore security invalidates restored bearer proofs without modifying password hashes or enrolled MFA',{timeout:180000},async()=>withCrmRecoveryDatabase('restore_fresh',async()=>{
 const owner=await account('restore-owner','superAdmin'),customer=await account('restore-customer','customer');
 const session=await fixtureHttpSession(owner.actor);await pendingChallenges(owner.actor.id);await pendingChallenges(customer.actor.id);
 const invitation=randomUUID();await query("INSERT INTO staff_invitations(id,email,role,allowed_locales,quality_scope,crm_scope,crm_permissions,team_ids,territory_ids,locale,token_hash,invited_by,expires_at) VALUES($1,'pending-staff@example.invalid','business','[\"en\"]',false,'assigned','{}','[]','[]','en',$2,$3,now()+interval '1 day')",[invitation,hash(randomUUID()),owner.actor.id]);
 const organization=(await createOrganization(customer.actor,{name:'Isolated organization'})).items[0].id;
 await query("INSERT INTO organization_invitations(id,organization_id,email,role,token_hash,invited_by,expires_at) VALUES($1,$2,'pending-member@example.invalid','member',$3,$4,now()+interval '1 day')",[randomUUID(),organization,hash(randomUUID()),customer.actor.id]);
 const messages=[];for(const prefix of['password-reset','email-verify','staff-invitation','organization-invitation','ordinary-notification']){const id=randomUUID();messages.push([prefix,id]);await query("INSERT INTO outbox(id,kind,payload,dedupe_key) VALUES($1,'email','{}',$2)",[id,prefix+':'+id]);}
 const future=Math.floor(Date.now()/30000)+3;await query('UPDATE users SET mfa_last_counter=$2 WHERE id=$1',[customer.actor.id,future]);
 const beforeOwner=await row(owner.actor.id),beforeCustomer=await row(customer.actor.id),result=await applyRestoreSecurity();
 assert.equal(result.ready,true);assert.equal(result.accessReconciled,false);assert.equal(result.sessionsRevoked,1);assert.equal(result.challengesConsumed,6);assert.equal(result.recoveryCodesCleared,4);assert.equal(result.staffInvitationsRevoked,1);assert.equal(result.organizationInvitationsRevoked,1);assert.equal(result.authMessagesCancelled,4);
 for(const before of[beforeOwner,beforeCustomer]){const after=await row(before.id);assert.equal(after.password_hash,before.password_hash);assert.equal(after.mfa_secret,before.mfa_secret);assert.equal(after.mfa_enabled,before.mfa_enabled);assert.equal(after.mfa_pending_secret,null);assert.equal(after.mfa_pending_expires_at,null);assert.deepEqual(after.recovery_hashes,[]);assert.ok(Number(after.mfa_last_counter)>=Math.floor(Date.now()/30000));}
 assert.equal(Number((await row(customer.actor.id)).mfa_last_counter),future,'A higher last-used authenticator counter is never lowered');
 assert.equal((await session.request('/me/security')).status,401);assert.equal((await query('SELECT 1 FROM auth_challenges WHERE consumed_at IS NULL')).rowCount,0);
 assert.ok((await query('SELECT revoked_at FROM staff_invitations WHERE id=$1',[invitation])).rows[0].revoked_at);
 for(const [prefix,id] of messages)assert.equal((await query('SELECT state FROM outbox WHERE id=$1',[id])).rows[0].state,prefix==='ordinary-notification'?'pending':'cancelled');
 assert.equal((await query("SELECT 1 FROM audit_events WHERE action='ops.restore.security_applied' AND actor_id IS NULL")).rowCount,1);
}));

test('Same-host restore retains current role restrictions, disabled staff and group grants, and rejects stale credentials',{timeout:180000},async()=>withCrmRecoveryDatabase('restore_access',async()=>{
 const owner=await account('access-owner','superAdmin'),disabled=await account('access-disabled','support',{active:false}),limited=await account('access-limited','business',{grants:{contact:true}}),demoted=await account('access-demoted','customer'),inactiveBackup=await account('access-inactive-backup'),rotated=await account('access-rotated'),reenrolled=await account('access-reenrolled'),identity=await account('access-identity'),missing=await account('access-new');
 const team='team-'+randomUUID(),retired='team-'+randomUUID(),territory='territory-'+randomUUID();
 for(const [id,active]of[[team,true],[retired,false]])await query('INSERT INTO crm_teams(id,name,active,created_by) VALUES($1,$1,$2,$3)',[id,active,owner.actor.id]);
 await query('INSERT INTO crm_territories(id,name,created_by) VALUES($1,$1,$2)',[territory,owner.actor.id]);
 await query('INSERT INTO crm_team_memberships(team_id,user_id,granted_by,active) VALUES($1,$2,$3,true),($1,$4,$3,false)',[team,limited.actor.id,owner.actor.id,disabled.actor.id]);
 await query('INSERT INTO crm_territory_memberships(territory_id,user_id,granted_by,active) VALUES($1,$2,$3,true)',[territory,limited.actor.id,owner.actor.id]);
 const acceptedFutureCounter=Math.floor(Date.now()/30000)+4;await query('UPDATE users SET mfa_last_counter=$2 WHERE id=$1',[owner.actor.id,acceptedFutureCounter]);
 const snapshot=await captureRestoreAccess(),serialized=JSON.stringify(snapshot);
 for(const f of[owner,disabled,limited,demoted,rotated])for(const value of[f.verifier,f.secret,f.actor.email])assert.equal(serialized.includes(value),false,'The access file contains neither credentials nor clear account emails');
 // Simulate the older restored database after the protected current capture.
 await query('UPDATE users SET active=true WHERE id=$1',[disabled.actor.id]);
 await query("UPDATE users SET role='superAdmin',allowed_locales='[\"fa\",\"en\",\"tr\",\"ar\",\"ru\"]',quality_scope=true,crm_scope='all',crm_permissions=$2::jsonb WHERE id=ANY($1::text[])",[[limited.actor.id,demoted.actor.id],JSON.stringify({contact:true,financial:true,baseCost:true,assign:true,intake:true})]);
 await query('UPDATE users SET active=false WHERE id=$1',[inactiveBackup.actor.id]);
 await query('UPDATE users SET password_hash=$2 WHERE id=$1',[rotated.actor.id,'obsolete password verifier']);await query('UPDATE users SET mfa_secret=$2 WHERE id=$1',[reenrolled.actor.id,encrypt(newTotpSecret())]);await query('UPDATE users SET email=$2 WHERE id=$1',[identity.actor.id,'historical-identity@example.invalid']);
 await query('DELETE FROM users WHERE id=$1',[missing.actor.id]);const historical=await account('access-historical','admin');
 await query('UPDATE crm_teams SET active=true WHERE id=$1',[retired]);await query('UPDATE crm_team_memberships SET active=true');
 await query('UPDATE crm_territory_memberships SET active=false');
 await query("UPDATE users SET mfa_last_counter=0,recovery_hashes='[]' WHERE id=$1",[owner.actor.id]);
 const result=await applyRestoreSecurity(snapshot);assert.equal(result.ready,true);assert.equal(result.credentialMismatches,2);assert.equal(result.identityMismatches,1);assert.equal(result.missingCurrentAccounts,1);assert.equal(result.groupsDisabled,1);assert.equal(result.membershipsRestored,2);
 assert.equal((await row(owner.actor.id)).active,true,'Ordinary TOTP use/recovery-code consumption do not change the stable credential fingerprint');
 assert.equal(Number((await row(owner.actor.id)).mfa_last_counter),acceptedFutureCounter,'An accepted current authenticator counter cannot move backwards when an older snapshot is restored');
 for(const f of[disabled,inactiveBackup,rotated,reenrolled,identity,historical])assert.equal((await row(f.actor.id)).active,false,f.actor.id);
 const currentLimited=await row(limited.actor.id);assert.equal(currentLimited.role,'business');assert.deepEqual(currentLimited.allowed_locales,['en']);assert.equal(currentLimited.quality_scope,false);assert.equal(currentLimited.crm_scope,'assigned');assert.deepEqual(currentLimited.crm_permissions,{...none,contact:true});
 const currentDemoted=await row(demoted.actor.id);assert.equal(currentDemoted.role,'customer');assert.equal(currentDemoted.quality_scope,false);assert.deepEqual(currentDemoted.crm_permissions,none);
 assert.equal((await query('SELECT active FROM crm_teams WHERE id=$1',[retired])).rows[0].active,false);assert.equal((await query('SELECT active FROM crm_team_memberships WHERE team_id=$1 AND user_id=$2',[team,disabled.actor.id])).rows[0].active,false);assert.equal((await query('SELECT active FROM crm_territory_memberships WHERE territory_id=$1 AND user_id=$2',[territory,limited.actor.id])).rows[0].active,true);
 assert.equal((await row(rotated.actor.id)).password_hash,'obsolete password verifier','Hardening disables mismatched credentials; it does not silently reset a password');
 await query("UPDATE users SET role='support',crm_permissions='{}' WHERE id=$1",[limited.actor.id]);const replay=await applyRestoreSecurity(snapshot);assert.equal(replay.alreadyApplied,true);assert.equal((await row(limited.actor.id)).role,'support','Replaying an already applied capture cannot overwrite a later permission decision');
}));

test('Restore policy validates its version, origin, schema and grant references before any mutation',{timeout:180000},async()=>withCrmRecoveryDatabase('restore_validate',async()=>{
 const owner=await account('validate-owner','superAdmin'),session=await fixtureHttpSession(owner.actor),snapshot=await captureRestoreAccess();
 for(const forged of[{...snapshot,version:2},{...snapshot,users:[...snapshot.users,snapshot.users[0]]},{...snapshot,users:snapshot.users.map(user=>({...user,unknownSecret:'forged'}))},{...snapshot,teamMemberships:[{groupId:'missing',userId:owner.actor.id,grantedBy:owner.actor.id}]}])assert.throws(()=>parseRestoreAccessSnapshot(forged));
 await assert.rejects(applyRestoreSecurity({...snapshot,originFingerprint:'1'.repeat(64)}),code('RESTORE_ORIGIN'));await assert.rejects(applyRestoreSecurity({...snapshot,schemaFingerprint:'2'.repeat(64)}),code('RESTORE_SCHEMA'));
 assert.equal((await query('SELECT revoked_at FROM sessions WHERE id=$1',[session.id])).rows[0].revoked_at,null);assert.equal((await query("SELECT 1 FROM audit_events WHERE action='ops.restore.security_applied'")).rowCount,0);
}));

test('Losing the last current administrator commits safe revocation but keeps readiness closed until explicit owner recovery',{timeout:180000},async()=>withCrmRecoveryDatabase('restore_closed',async()=>{
 const owner=await account('closed-owner','superAdmin'),session=await fixtureHttpSession(owner.actor),snapshot=await captureRestoreAccess();await query('UPDATE users SET password_hash=$2 WHERE id=$1',[owner.actor.id,'old restored verifier']);
 const result=await applyRestoreSecurity(snapshot);assert.equal(result.ready,false);assert.equal(result.credentialMismatches,1);assert.equal((await row(owner.actor.id)).active,false);assert.ok((await query('SELECT revoked_at FROM sessions WHERE id=$1',[session.id])).rows[0].revoked_at);
 await query('UPDATE users SET active=true,password_hash=$2 WHERE id=$1',[owner.actor.id,owner.verifier]);assert.equal((await applyRestoreSecurity(snapshot)).ready,true,'Only a later explicit owner decision can reopen readiness');
}));

test('Owner CLI writes private bounded files, rejects symlinks and incompatible overrides, and refuses runtime credentials',{timeout:180000},async()=>withCrmRecoveryDatabase('restore_cli',async({scoped,storage,control,schema})=>{
 const owner=await account('cli-owner','superAdmin');
 async function cli(args,patch={}){const environment={...process.env,MIGRATION_DATABASE_URL:scoped.toString(),...patch};return new Promise((resolve,reject)=>{let stdout='',stderr='';const child=spawn(process.execPath,['--import','tsx','scripts/restore-security.ts',...args],{env:environment,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('exit',exitCode=>resolve({exitCode,stdout,stderr}));});}
 const path=join(storage,'access.json'),capture=await cli(['capture','--output='+path]);assert.equal(capture.exitCode,0,capture.stderr);assert.equal((await stat(path)).mode&0o777,0o600);const snapshot=JSON.parse(await readFile(path,'utf8'));assert.equal(snapshot.users[0].id,owner.actor.id);assert.equal(capture.stdout.includes(owner.verifier),false);assert.equal(capture.stdout.includes('credentialFingerprint'),false);
 assert.equal((await cli(['capture','--output='+path])).exitCode,1,'Capture never overwrites a prior authority file');
 await chmod(path,0o644);const publicFile=await cli(['apply','--access='+path]);assert.equal(publicFile.exitCode,1);assert.match(publicFile.stderr,/private regular file/);await chmod(path,0o600);
 const link=join(storage,'linked-access.json');await symlink(path,link);assert.equal((await cli(['apply','--access='+link])).exitCode,1);await unlink(link);
 const override=await cli(['apply'],{PRIVACY_RESTORE_DATABASE:'not_an_isolated_drill'});assert.equal(override.exitCode,1);assert.match(override.stderr,/Only isolated drill/);
 const restricted=new URL(scoped),provided=process.env.TEST_RUNTIME_DATABASE_URL?new URL(process.env.TEST_RUNTIME_DATABASE_URL):undefined;
 let runtime,created=false;
 if(provided){
  assert.equal(provided.hostname,scoped.hostname,'The restricted test connection must use the same isolated PostgreSQL host');assert.equal(provided.port,scoped.port);assert.equal(provided.pathname,scoped.pathname);
  restricted.username=provided.username;restricted.password=provided.password;runtime=decodeURIComponent(provided.username);
 }else{
  const canCreate=(await control.query('SELECT rolsuper OR rolcreaterole AS allowed FROM pg_roles WHERE rolname=current_user')).rows[0].allowed;
  assert.ok(canCreate,'Provide TEST_RUNTIME_DATABASE_URL for the same test database when its schema owner cannot create a temporary runtime role.');
  runtime='restore_runtime_'+randomUUID().replaceAll('-','');const runtimePassword=randomUUID()+randomUUID();await control.query(`CREATE ROLE ${runtime} LOGIN PASSWORD '${runtimePassword}'`);created=true;restricted.username=runtime;restricted.password=runtimePassword;
 }
 const role='"'+runtime.replaceAll('"','""')+'"';
 try{await control.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);await control.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);const refusal=await cli(['capture','--output='+join(storage,'runtime.json')],{MIGRATION_DATABASE_URL:restricted.toString()});assert.equal(refusal.exitCode,1);assert.match(refusal.stderr,/RESTORE_OWNER_REQUIRED/);}finally{await control.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`);await control.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${schema} FROM ${role}`);if(created)await control.query(`DROP ROLE ${role}`);}
 const applied=await cli(['apply','--access='+path]);assert.equal(applied.exitCode,0,applied.stderr);assert.equal(JSON.parse(applied.stdout.trim()).ready,true);assert.deepEqual((await row(owner.actor.id)).recovery_hashes,[]);
}));
