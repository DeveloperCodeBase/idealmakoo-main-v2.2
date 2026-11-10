import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {audit,transaction} from '../src/server/db';
import {config} from '../src/server/config';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const roles=['customer','superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support'] as const;
const locales=['fa','en','tr','ar','ru'] as const;
const identifier=z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/);
const fingerprint=z.string().regex(/^[a-f0-9]{64}$/);
const counter=z.string().regex(/^(?:-1|0|[1-9][0-9]{0,18})$/).pipe(z.string().refine(value=>BigInt(value)<=9223372036854775807n));
const grants=z.object({contact:z.boolean(),financial:z.boolean(),baseCost:z.boolean(),assign:z.boolean(),intake:z.boolean()}).strict();
const emptyGrants=()=>({contact:false,financial:false,baseCost:false,assign:false,intake:false});
const userSchema=z.object({id:identifier,emailFingerprint:fingerprint,credentialFingerprint:fingerprint,mfaLastCounter:counter,role:z.enum(roles),active:z.boolean(),allowedLocales:z.array(z.enum(locales)).min(1).max(5).refine(values=>new Set(values).size===values.length),qualityScope:z.boolean(),crmScope:z.enum(['assigned','team','all']),crmPermissions:grants}).strict();
const groupSchema=z.object({id:identifier,active:z.boolean()}).strict();
const membershipSchema=z.object({groupId:identifier,userId:identifier,grantedBy:identifier}).strict();
const accessSchema=z.object({format:z.literal('idealmakoo.restore-access'),version:z.literal(1),captureId:z.string().uuid(),capturedAt:z.string().datetime(),originFingerprint:fingerprint,schemaFingerprint:fingerprint,users:z.array(userSchema).max(100000),teams:z.array(groupSchema).max(100000),territories:z.array(groupSchema).max(100000),teamMemberships:z.array(membershipSchema).max(250000),territoryMemberships:z.array(membershipSchema).max(250000)}).strict();
export type RestoreAccessSnapshot=z.infer<typeof accessSchema>;
type AccountRow={id:string;email:string;password_hash:string;mfa_enabled:boolean;mfa_secret:string|null;mfa_last_counter:string;role:typeof roles[number];active:boolean;allowed_locales:typeof locales[number][];quality_scope:boolean;crm_scope:'assigned'|'team'|'all';crm_permissions:Partial<z.infer<typeof grants>>};

export class RestoreSecurityError extends Error{
  constructor(public readonly code:string,message:string){super(message);this.name='RestoreSecurityError';}
}
function guard(condition:unknown,code:string,message:string):asserts condition{if(!condition)throw new RestoreSecurityError(code,message);}
export function parseRestoreAccessSnapshot(input:unknown):RestoreAccessSnapshot{
  const result=accessSchema.safeParse(input);guard(result.success,'RESTORE_ACCESS_FORMAT','The restore access snapshot is invalid or uses an unsupported format.');
  const snapshot=result.data;
  for(const rows of[snapshot.users,snapshot.teams,snapshot.territories])guard(new Set(rows.map(row=>row.id)).size===rows.length,'RESTORE_ACCESS_DUPLICATE','The restore access snapshot contains duplicate identities.');
  const users=new Set(snapshot.users.map(user=>user.id));
  for(const [members,groups] of[[snapshot.teamMemberships,snapshot.teams],[snapshot.territoryMemberships,snapshot.territories]] as const){
    guard(new Set(members.map(row=>row.groupId+'\0'+row.userId)).size===members.length,'RESTORE_ACCESS_DUPLICATE','The restore access snapshot contains duplicate group grants.');
    const known=new Set(groups.filter(group=>group.active).map(group=>group.id));
    for(const member of members)guard(known.has(member.groupId)&&users.has(member.userId)&&users.has(member.grantedBy),'RESTORE_ACCESS_REFERENCE','A captured group grant has no matching current identity or active group.');
  }
  for(const user of snapshot.users){
    guard(user.role!=='translator'||!user.allowedLocales.includes('fa'),'RESTORE_ACCESS_LOCALE','A captured translator has an unsupported source-language grant.');
    guard(user.role!=='customer'||!user.qualityScope&&user.crmScope==='assigned'&&!Object.values(user.crmPermissions).some(Boolean),'RESTORE_ACCESS_CUSTOMER','A customer cannot receive staff capabilities during restore.');
  }
  guard(Date.parse(snapshot.capturedAt)<=Date.now()+60000,'RESTORE_ACCESS_TIME','The access snapshot was captured in the future; verify the host clock.');
  return snapshot;
}

// Validate the exact columns used by this version without rejecting unrelated
// additive migrations. No passwords, encrypted secrets or tokens enter metadata.
const contract:Record<string,Record<string,string>>={
  users:{id:'text',email:'text',password_hash:'text',role:'text',active:'bool',allowed_locales:'jsonb',quality_scope:'bool',crm_scope:'text',crm_permissions:'jsonb',mfa_enabled:'bool',mfa_secret:'text',mfa_pending_secret:'text',mfa_pending_expires_at:'timestamptz',mfa_last_counter:'int8',recovery_hashes:'jsonb'},
  sessions:{user_id:'text',revoked_at:'timestamptz'},auth_challenges:{user_id:'text',purpose:'text',consumed_at:'timestamptz'},
  staff_invitations:{invited_by:'text',accepted_at:'timestamptz',revoked_at:'timestamptz',revoked_by:'text',version:'int4'},
  organization_invitations:{accepted_at:'timestamptz',revoked_at:'timestamptz'},
  crm_teams:{id:'text',active:'bool',version:'int4'},crm_territories:{id:'text',active:'bool',version:'int4'},
  crm_team_memberships:{team_id:'text',user_id:'text',granted_by:'text',active:'bool'},crm_territory_memberships:{territory_id:'text',user_id:'text',granted_by:'text',active:'bool'},
  outbox:{dedupe_key:'text',state:'text',lock_token:'text',locked_at:'timestamptz',completed_at:'timestamptz',last_error:'text'},
};
async function ownerMetadata(client:PoolClient){
  const permitted=(await client.query<{allowed:boolean}>("SELECT r.rolsuper OR pg_has_role(current_user,c.relowner,'USAGE') AS allowed FROM pg_class c JOIN pg_roles r ON r.rolname=current_user WHERE c.oid='users'::regclass")).rows[0];
  guard(permitted?.allowed,'RESTORE_OWNER_REQUIRED','Restore security requires the migration owner connection, never the application role.');
  const rows=(await client.query<{table_name:string;column_name:string;udt_name:string}>('SELECT table_name,column_name,udt_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=ANY($1::text[])',[Object.keys(contract)])).rows;
  const actual=new Map(rows.map(row=>[row.table_name+'.'+row.column_name,row.udt_name]));
  for(const [table,columns] of Object.entries(contract))for(const [column,type] of Object.entries(columns))guard(actual.get(table+'.'+column)===type,'RESTORE_SCHEMA','The restored database is missing a required security column or has an incompatible type. Apply the reviewed migrations first.');
  return{schemaFingerprint:digest(JSON.stringify(contract)),originFingerprint:digest(new URL(config().siteUrl).origin)};
}
function credentialFingerprint(user:AccountRow){return digest(JSON.stringify([user.password_hash,user.mfa_enabled,user.mfa_secret]));}
function accessUser(user:AccountRow):RestoreAccessSnapshot['users'][number]{
  return{id:user.id,emailFingerprint:digest(user.email),credentialFingerprint:credentialFingerprint(user),mfaLastCounter:user.mfa_last_counter,role:user.role,active:user.active,allowedLocales:[...user.allowed_locales],qualityScope:user.role==='customer'?false:user.quality_scope,crmScope:user.role==='customer'?'assigned':user.crm_scope,crmPermissions:user.role==='customer'?emptyGrants():{...emptyGrants(),...user.crm_permissions}};
}
export async function captureRestoreAccess():Promise<RestoreAccessSnapshot>{
  return transaction(async client=>{
    const metadata=await ownerMetadata(client);await client.query('SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE');await client.query('SELECT pg_advisory_xact_lock(917264831)');
    const users=(await client.query<AccountRow>('SELECT id,email,password_hash,mfa_enabled,mfa_secret,mfa_last_counter,role,active,allowed_locales,quality_scope,crm_scope,crm_permissions FROM users ORDER BY id')).rows.map(accessUser);
    const teams=(await client.query<{id:string;active:boolean}>('SELECT id,active FROM crm_teams ORDER BY id')).rows;
    const territories=(await client.query<{id:string;active:boolean}>('SELECT id,active FROM crm_territories ORDER BY id')).rows;
    const teamMemberships=(await client.query<RestoreAccessSnapshot['teamMemberships'][number]>('SELECT m.team_id AS "groupId",m.user_id AS "userId",m.granted_by AS "grantedBy" FROM crm_team_memberships m JOIN crm_teams g ON g.id=m.team_id AND g.active WHERE m.active ORDER BY m.team_id,m.user_id')).rows;
    const territoryMemberships=(await client.query<RestoreAccessSnapshot['territoryMemberships'][number]>('SELECT m.territory_id AS "groupId",m.user_id AS "userId",m.granted_by AS "grantedBy" FROM crm_territory_memberships m JOIN crm_territories g ON g.id=m.territory_id AND g.active WHERE m.active ORDER BY m.territory_id,m.user_id')).rows;
    return parseRestoreAccessSnapshot({format:'idealmakoo.restore-access',version:1,captureId:randomUUID(),capturedAt:new Date().toISOString(),...metadata,users,teams,territories,teamMemberships,territoryMemberships});
  });
}

export async function applyRestoreSecurity(input?:unknown){
  const snapshot=input===undefined?undefined:parseRestoreAccessSnapshot(input);
  return transaction(async client=>{
    const metadata=await ownerMetadata(client);await client.query('SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE');await client.query('SELECT pg_advisory_xact_lock(917264831)');
    if(snapshot){
      guard(snapshot.schemaFingerprint===metadata.schemaFingerprint,'RESTORE_SCHEMA','The security schema fingerprint does not match the captured access policy.');
      guard(snapshot.originFingerprint===metadata.originFingerprint,'RESTORE_ORIGIN','The captured access policy belongs to a different configured site origin.');
      const earlier=(await client.query<{details:{result:Record<string,unknown>}}>("SELECT details FROM audit_events WHERE action='ops.restore.security_applied' AND details->>'captureId'=$1 ORDER BY id DESC LIMIT 1",[snapshot.captureId])).rows[0];
      if(earlier){const ready=!!(await client.query("SELECT 1 FROM users WHERE active AND role='superAdmin' LIMIT 1")).rowCount;return{...earlier.details.result,alreadyApplied:true,ready};}
    }
    const result={alreadyApplied:false,accessReconciled:!!snapshot,accountsMatched:0,accountsDisabled:0,identityMismatches:0,credentialMismatches:0,missingCurrentAccounts:0,groupsDisabled:0,membershipsRestored:0,membershipsUnavailable:0,sessionsRevoked:0,challengesConsumed:0,enrollmentsCleared:0,recoveryCodesCleared:0,staffInvitationsRevoked:0,organizationInvitationsRevoked:0,authMessagesCancelled:0,ready:false};
    if(snapshot){
      const captured=new Map(snapshot.users.map(user=>[user.id,user]));
      const restored=(await client.query<AccountRow>('SELECT id,email,password_hash,mfa_enabled,mfa_secret,mfa_last_counter,role,active,allowed_locales,quality_scope,crm_scope,crm_permissions FROM users ORDER BY id FOR UPDATE')).rows;
      const restoredIds=new Set(restored.map(user=>user.id)),activeStaff=new Set<string>();
      result.missingCurrentAccounts=snapshot.users.filter(user=>!restoredIds.has(user.id)).length;
      for(const user of restored){
        const current=captured.get(user.id),sameIdentity=!!current&&current.emailFingerprint===digest(user.email),sameCredentials=!!current&&current.credentialFingerprint===credentialFingerprint(user);
        const active=user.active&&!!current?.active&&sameIdentity&&sameCredentials;
        if(user.active&&!active)result.accountsDisabled++;
        if(current&&!sameIdentity)result.identityMismatches++;
        if(current&&sameIdentity&&!sameCredentials)result.credentialMismatches++;
        if(!current||!sameIdentity){await client.query('UPDATE users SET active=false,updated_at=now() WHERE id=$1',[user.id]);continue;}
        result.accountsMatched++;
        await client.query('UPDATE users SET active=$2,role=$3,allowed_locales=$4::jsonb,quality_scope=$5,crm_scope=$6,crm_permissions=$7::jsonb,mfa_last_counter=GREATEST(mfa_last_counter,$8::bigint),updated_at=now() WHERE id=$1',[user.id,active,current.role,JSON.stringify(current.allowedLocales),current.qualityScope,current.crmScope,JSON.stringify(current.crmPermissions),current.mfaLastCounter]);
        if(active&&current.role!=='customer')activeStaff.add(user.id);
      }
      for(const [groupTable,membershipTable,column,groups,members] of [
        ['crm_teams','crm_team_memberships','team_id',snapshot.teams,snapshot.teamMemberships],
        ['crm_territories','crm_territory_memberships','territory_id',snapshot.territories,snapshot.territoryMemberships],
      ] as const){
        const capturedGroups=new Map(groups.map(group=>[group.id,group]));
        const restoredGroups=(await client.query<{id:string;active:boolean}>(`SELECT id,active FROM ${groupTable} FOR UPDATE`)).rows,activeGroups=new Set<string>();
        for(const group of restoredGroups){
          const active=group.active&&capturedGroups.get(group.id)?.active===true;
          if(active)activeGroups.add(group.id);
          if(group.active&&!active){await client.query(`UPDATE ${groupTable} SET active=false,version=version+1,updated_at=now() WHERE id=$1`,[group.id]);result.groupsDisabled++;}
        }
        await client.query(`UPDATE ${membershipTable} SET active=false,updated_at=now() WHERE active`);
        for(const member of members){
          if(!activeGroups.has(member.groupId)||!activeStaff.has(member.userId)||!restoredIds.has(member.grantedBy)){result.membershipsUnavailable++;continue;}
          await client.query(`INSERT INTO ${membershipTable}(${column},user_id,granted_by,active) VALUES($1,$2,$3,true) ON CONFLICT(${column},user_id) DO UPDATE SET active=true,granted_by=EXCLUDED.granted_by,updated_at=now()`,[member.groupId,member.userId,member.grantedBy]);result.membershipsRestored++;
        }
      }
    }
    result.sessionsRevoked=(await client.query('UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL')).rowCount||0;
    result.challengesConsumed=(await client.query('UPDATE auth_challenges SET consumed_at=now() WHERE consumed_at IS NULL')).rowCount||0;
    result.enrollmentsCleared=(await client.query('UPDATE users SET mfa_pending_secret=NULL,mfa_pending_expires_at=NULL WHERE mfa_pending_secret IS NOT NULL OR mfa_pending_expires_at IS NOT NULL')).rowCount||0;
    result.recoveryCodesCleared=Number((await client.query("SELECT COALESCE(sum(jsonb_array_length(recovery_hashes)),0)::text AS n FROM users")).rows[0].n);
    await client.query("UPDATE users SET recovery_hashes='[]'::jsonb,mfa_last_counter=CASE WHEN mfa_enabled THEN GREATEST(mfa_last_counter,floor(extract(epoch FROM now())/30)::bigint) ELSE mfa_last_counter END");
    // The actual historical inviter remains the FK subject; the separate audit
    // records that this bulk revocation was an owner restore operation.
    result.staffInvitationsRevoked=(await client.query('UPDATE staff_invitations SET revoked_at=now(),revoked_by=invited_by,version=version+1 WHERE accepted_at IS NULL AND revoked_at IS NULL')).rowCount||0;
    result.organizationInvitationsRevoked=(await client.query('UPDATE organization_invitations SET revoked_at=now() WHERE accepted_at IS NULL AND revoked_at IS NULL')).rowCount||0;
    result.authMessagesCancelled=(await client.query("UPDATE outbox SET state='cancelled',last_error='RESTORE_AUTH_REVOKED',completed_at=now(),locked_at=NULL,lock_token=NULL WHERE state IN ('pending','running','batched','uncertain') AND dedupe_key ~ '^(password-reset|email-verify|staff-invitation|organization-invitation):'")).rowCount||0;
    await client.query('UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton=true');
    result.ready=!!(await client.query("SELECT 1 FROM users WHERE active AND role='superAdmin' LIMIT 1")).rowCount;
    await audit(null,'ops.restore.security_applied','restore',snapshot?.captureId||randomUUID(),{captureId:snapshot?.captureId||null,accessSnapshotFingerprint:snapshot?digest(JSON.stringify(snapshot)):null,policyVersion:1,result},client);
    return result;
  });
}
