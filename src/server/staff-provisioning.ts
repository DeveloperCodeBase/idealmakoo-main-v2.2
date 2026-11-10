import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {UserRow} from './auth';
import {transaction,audit} from './db';
import {hash,passwordHash,passwordMatches} from './crypto';
import {assert,HttpError} from './types';
import {crmPermissionSchema,noCrmPermissions} from './workspace-scopes';
import {assertStaffDeactivationReady} from './staff-lifecycle';
import {staffProvisioningMode} from './staff-provisioning-mode';

const staffRole=z.enum(['superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support']);
const languages=z.enum(['fa','en','tr','ar','ru']);
const staffAccountSchema=z.object({
  key:z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  email:z.string().trim().toLowerCase().email().max(254),
  name:z.string().trim().min(2).max(100),
  role:staffRole,
  allowedLocales:z.array(languages).min(1).max(5).refine(value=>new Set(value).size===value.length),
  qualityScope:z.boolean().default(false),
  crmScope:z.enum(['assigned','team','all']).default('assigned'),
  crmPermissions:crmPermissionSchema.default({}),
  password:z.string().min(12).max(128).optional(),
}).strict().refine(value=>value.role!=='translator'||!value.allowedLocales.includes('fa'));
export type ProvisionedStaffAccount=z.infer<typeof staffAccountSchema>;
type Env=Record<string,string|undefined>;
type GrantSnapshot={role:string;allowedLocales:string[];qualityScope:boolean;crmScope:string;crmPermissions:Record<string,boolean>};

/** Never include schema input or its values in diagnostics: the JSON contains
 * credentials. The stable key also prevents a renamed env entry taking over an
 * existing email, registered customer, or independently administered account. */
export function parseStaffAccounts(env:Env=process.env):ProvisionedStaffAccount[]{
  let value:unknown;
  try{value=JSON.parse(env.STAFF_ACCOUNTS_JSON||'[]');}catch{throw new Error('STAFF_ACCOUNTS_JSON must be a valid JSON array. No configuration values were logged.');}
  const result=z.array(staffAccountSchema).max(200).safeParse(value);
  if(!result.success)throw new Error('STAFF_ACCOUNTS_JSON has invalid fields. Use a unique key, email, name, staff role, allowedLocales and a 12–128 character creation password. Translators require target languages other than fa.');
  const rows=result.data;
  if(new Set(rows.map(row=>row.key)).size!==rows.length||new Set(rows.map(row=>row.email)).size!==rows.length||rows.some(row=>row.key==='bootstrap-admin'))throw new Error('Staff keys and emails must be unique; bootstrap-admin is reserved for the initial administrator.');
  return rows;
}
const grants=(entry:ProvisionedStaffAccount):GrantSnapshot=>({role:entry.role,allowedLocales:[...entry.allowedLocales].sort(),qualityScope:entry.qualityScope,crmScope:entry.crmScope,crmPermissions:{...noCrmPermissions(),...entry.crmPermissions}});
const userGrants=(user:UserRow):GrantSnapshot=>({role:user.role,allowedLocales:[...user.allowed_locales].sort(),qualityScope:user.quality_scope,crmScope:user.crm_scope,crmPermissions:{...noCrmPermissions(),...user.crm_permissions}});
const digest=(value:GrantSnapshot)=>hash(JSON.stringify(value));
function reduced(previous:GrantSnapshot,next:GrantSnapshot){
  return previous.role!==next.role||previous.qualityScope&&!next.qualityScope||previous.allowedLocales.some(value=>!next.allowedLocales.includes(value))||['assigned','team','all'].indexOf(next.crmScope)<['assigned','team','all'].indexOf(previous.crmScope)||Object.entries(previous.crmPermissions).some(([key,value])=>value&&!next.crmPermissions[key]);
}
async function bindAccount(client:PoolClient,entry:ProvisionedStaffAccount,userId:string){
  await client.query('INSERT INTO staff_provisioned_accounts(provision_key,user_id,configured_email,applied_grants_sha256) VALUES($1,$2,$3,$4)',[entry.key,userId,entry.email,digest(grants(entry))]);
}
function bootstrapEntry(env:Env):ProvisionedStaffAccount|null{
  if(!env.BOOTSTRAP_ADMIN_EMAIL&&!env.BOOTSTRAP_ADMIN_PASSWORD)return null;
  const value={key:'bootstrap-admin',email:env.BOOTSTRAP_ADMIN_EMAIL,name:env.BOOTSTRAP_ADMIN_NAME||'مدیر سامانه',password:env.BOOTSTRAP_ADMIN_PASSWORD||undefined,role:'superAdmin',allowedLocales:['fa','en','tr','ar','ru'],qualityScope:env.BOOTSTRAP_ADMIN_QUALITY_SCOPE==='true',crmScope:'all',crmPermissions:{}};
  if(env.BOOTSTRAP_ADMIN_QUALITY_SCOPE&&!['true','false'].includes(env.BOOTSTRAP_ADMIN_QUALITY_SCOPE))throw new Error('BOOTSTRAP_ADMIN_QUALITY_SCOPE must be true or false.');
  const parsed=staffAccountSchema.safeParse(value);
  if(!parsed.success)throw new Error('Initial administrator configuration requires a valid email, name and a 12–128 character password.');
  return parsed.data;
}
export interface ProvisionStaffOptions {includeBootstrap?:boolean;syncGrants?:boolean;rotatePasswords?:boolean;reactivateKeys?:string[];resetMfaKeys?:string[];env?:Env}
export async function provisionStaffAccounts(options:ProvisionStaffOptions={}){
  staffProvisioningMode();
  const env=options.env||process.env,entries=parseStaffAccounts(env),bootstrap=options.includeBootstrap?bootstrapEntry(env):null;
  const reactivateKeys=new Set(options.reactivateKeys||[]);
  assert(reactivateKeys.size===(options.reactivateKeys||[]).length&&[...reactivateKeys].every(key=>/^[a-z][a-z0-9_-]{1,63}$/.test(key)),422,'PROVISION_REACTIVATE_KEY','Reactivation requires unique, valid provisioned identity keys.');
  const resetMfaKeys=new Set(options.resetMfaKeys||[]);
  assert(resetMfaKeys.size===(options.resetMfaKeys||[]).length&&[...resetMfaKeys].every(key=>/^[a-z][a-z0-9_-]{1,63}$/.test(key)),422,'PROVISION_MFA_KEY','MFA recovery requires unique, valid provisioned identity keys.');
  assert(!resetMfaKeys.size||options.rotatePasswords,422,'PROVISION_MFA_PASSWORD_ROTATION','An explicit MFA reset also requires --rotate-passwords and a new protected environment password for each selected identity.');
  if(bootstrap&&entries.some(row=>row.email===bootstrap.email))throw new Error('A roster email duplicates the bootstrap administrator; configure that initial account using BOOTSTRAP_ADMIN_* fields.');
  return transaction(async client=>{
    const owner=(await client.query("SELECT (r.rolsuper OR pg_has_role(current_user,c.relowner,'USAGE')) AND has_table_privilege(current_user,c.oid,'INSERT') AS allowed FROM pg_class c JOIN pg_roles r ON r.rolname=current_user WHERE c.oid='staff_provisioned_accounts'::regclass")).rows[0];
    assert(owner?.allowed,403,'PROVISION_OWNER_REQUIRED','Staff provisioning requires the migration owner connection, not the runtime application role.');
    // Same order as authenticated staff mutations; serialize first installation.
    await client.query('SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE');
    await client.query('SELECT pg_advisory_xact_lock(917264831)');
    const result={created:0,unchanged:0,grantsPending:0,grantsSynchronized:0,passwordsRotated:0,reactivated:0,mfaResets:0,bootstrapCreated:false,unlistedManagedAccounts:0};
    const planned=[...entries];
    if(bootstrap){
      const mapped=(await client.query('SELECT user_id FROM staff_provisioned_accounts WHERE provision_key=$1',[bootstrap.key])).rows[0];
      const senior=(await client.query("SELECT id FROM users WHERE role='superAdmin' AND active LIMIT 1")).rows[0];
      if(mapped||!senior)planned.unshift(bootstrap);
      else{
        // Adopt only the exact account whose append-only bootstrap audit proves
        // origin. Merely matching an email can never elevate a customer.
        const legacy=(await client.query<UserRow>("SELECT u.* FROM users u WHERE u.email=$1 AND u.role='superAdmin' AND EXISTS(SELECT 1 FROM audit_events a WHERE a.actor_id=u.id AND a.entity_id=u.id AND a.action='system.bootstrap')",[bootstrap.email])).rows[0];
        if(legacy&&!(await client.query('SELECT 1 FROM staff_provisioned_accounts WHERE user_id=$1',[legacy.id])).rowCount){await bindAccount(client,{...bootstrap,qualityScope:legacy.quality_scope,allowedLocales:legacy.allowed_locales as ProvisionedStaffAccount['allowedLocales'],crmScope:legacy.crm_scope,crmPermissions:legacy.crm_permissions},legacy.id);planned.unshift(bootstrap);}
      }
    }
    for(const key of reactivateKeys){
      assert(planned.some(entry=>entry.key===key)&&(await client.query('SELECT 1 FROM staff_provisioned_accounts WHERE provision_key=$1',[key])).rowCount,422,'PROVISION_REACTIVATE_UNKNOWN','Reactivation requires an existing, explicitly listed environment identity.');
    }
    for(const key of resetMfaKeys){
      assert(planned.some(entry=>entry.key===key)&&(await client.query('SELECT 1 FROM staff_provisioned_accounts WHERE provision_key=$1',[key])).rowCount,422,'PROVISION_MFA_UNKNOWN','MFA recovery requires an existing, explicitly listed environment staff identity.');
    }
    for(const entry of planned){
      const binding=(await client.query<{user_id:string;configured_email:string}>('SELECT user_id,configured_email FROM staff_provisioned_accounts WHERE provision_key=$1 FOR UPDATE',[entry.key])).rows[0];
      if(!binding){
        assert(!(await client.query('SELECT 1 FROM users WHERE email=$1',[entry.email])).rowCount,409,'PROVISION_EMAIL_OCCUPIED','A configured email already belongs to an account outside this provisioned identity. No account was promoted or replaced.');
        assert(entry.password,422,'PROVISION_PASSWORD_REQUIRED','Every newly provisioned staff account requires a password in the protected environment.');
        const id=randomUUID(),encoded=await passwordHash(entry.password),snapshot=grants(entry);
        await client.query("INSERT INTO users(id,name,email,password_hash,role,email_verified,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,true,$6,$7::jsonb,$8,$9::jsonb)",[id,entry.name,entry.email,encoded,entry.role,entry.qualityScope,JSON.stringify(entry.allowedLocales),entry.crmScope,JSON.stringify(snapshot.crmPermissions)]);
        await client.query('INSERT INTO user_settings(user_id) VALUES($1)',[id]);
        await bindAccount(client,entry,id);
        await audit(id,entry.key==='bootstrap-admin'?'system.bootstrap':'staff.env.created','user',id,{provisionKey:entry.key,role:entry.role,allowedLocales:entry.allowedLocales,qualityScope:entry.qualityScope,crmScope:entry.crmScope},client);
        result.created++;if(entry.key==='bootstrap-admin')result.bootstrapCreated=true;
        continue;
      }
      assert(binding.configured_email===entry.email,409,'PROVISION_IDENTITY_CHANGED','A provisioned key cannot be reassigned to another email. Use a new reviewed identity instead.');
      const user=(await client.query<UserRow>('SELECT * FROM users WHERE id=$1 FOR UPDATE',[binding.user_id])).rows[0];
      // The immutable key is bound to the user ID, not to a mutable login
      // address or role. Ordinary deployment must preserve panel corrections,
      // including a staff member being demoted to a customer. Retain the
      // original configured email above to prevent reassignment of this key.
      assert(user,409,'PROVISION_IDENTITY_CHANGED','The provisioned account no longer exists.');
      const previous=userGrants(user),next=grants(entry),changed=digest(previous)!==digest(next);
      const reactivate=!user.active&&reactivateKeys.has(entry.key);
      const resetMfa=resetMfaKeys.has(entry.key);
      assert(!reactivate||!changed||options.syncGrants,409,'PROVISION_GRANTS_PENDING','Review and explicitly synchronize pending environment grants before reactivating this identity.');
      assert(!resetMfa||user.active||reactivate,409,'PROVISION_MFA_REACTIVATE_REQUIRED','Recovering MFA for a disabled identity also requires its explicit --reactivate=key decision.');
      assert(!resetMfa||!changed||options.syncGrants,409,'PROVISION_GRANTS_PENDING','Review and explicitly synchronize pending environment grants before recovering this identity.');
      const rotate=!!(options.rotatePasswords&&entry.password&&!await passwordMatches(entry.password,user.password_hash));
      assert(!resetMfa||rotate,422,'PROVISION_MFA_PASSWORD_ROTATION','MFA recovery requires a different, explicitly configured environment password. Ordinary reruns never reset an enrolled authenticator.');
      if(changed&&!options.syncGrants)result.grantsPending++;
      if(changed&&options.syncGrants){
        if(reduced(previous,next))await assertStaffDeactivationReady(client,user.id);
        await client.query('UPDATE users SET role=$2,allowed_locales=$3::jsonb,quality_scope=$4,crm_scope=$5,crm_permissions=$6::jsonb,updated_at=now() WHERE id=$1',[user.id,entry.role,JSON.stringify(entry.allowedLocales),entry.qualityScope,entry.crmScope,JSON.stringify(next.crmPermissions)]);
        await client.query('UPDATE staff_provisioned_accounts SET applied_grants_sha256=$2,synchronized_at=now() WHERE user_id=$1',[user.id,digest(next)]);
        await audit(user.id,'staff.env.grants_synchronized','user',user.id,{provisionKey:entry.key,previous,next},client);result.grantsSynchronized++;
      }
      if(rotate){
        await client.query('UPDATE users SET password_hash=$2,failed_logins=0,locked_until=NULL,mfa_pending_secret=NULL,mfa_pending_expires_at=NULL,updated_at=now() WHERE id=$1',[user.id,await passwordHash(entry.password!)]);
        await audit(user.id,'staff.env.password_rotated','user',user.id,{provisionKey:entry.key},client);result.passwordsRotated++;
      }
      if(reactivate){
        await client.query('UPDATE users SET active=true,failed_logins=0,locked_until=NULL,mfa_pending_secret=NULL,mfa_pending_expires_at=NULL,updated_at=now() WHERE id=$1',[user.id]);
        await audit(user.id,'staff.env.reactivated','user',user.id,{provisionKey:entry.key},client);result.reactivated++;
      }
      if(resetMfa){
        await client.query("UPDATE users SET mfa_enabled=false,mfa_secret=NULL,mfa_pending_secret=NULL,mfa_pending_expires_at=NULL,mfa_last_counter=-1,recovery_hashes='[]'::jsonb,updated_at=now() WHERE id=$1",[user.id]);
        await audit(null,'staff.env.mfa_reset','user',user.id,{provisionKey:entry.key,reason:'explicit-owner-recovery',requiresEnrollment:true},client);result.mfaResets++;
      }
      if(changed&&options.syncGrants||rotate||reactivate||resetMfa){
        await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[user.id]);
        await client.query('UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[user.id]);
      }else result.unchanged++;
    }
    assert((await client.query("SELECT 1 FROM users WHERE active AND role='superAdmin' LIMIT 1")).rowCount,409,'LAST_ADMIN','At least one active senior administrator must remain. Configure the initial administrator or a senior staff entry.');
    result.unlistedManagedAccounts=Number((await client.query('SELECT count(*)::int AS n FROM staff_provisioned_accounts WHERE NOT(provision_key=ANY($1::text[]))',[planned.map(row=>row.key)])).rows[0].n);
    // Removing a line from env never silently deletes or reactivates a person.
    return result;
  });
}
