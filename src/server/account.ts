/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */


import type { UserSettings, UserProfile, UserPreferences } from '../lib/user-settings';
import type { Actor } from './types';
import type { UserRow, SessionContext } from './auth';
import type { PoolClient } from 'pg';
import type { Locale } from '../lib/i18n';
import type { UserDirectoryResponse, ManagedUser, ManagedUserDetail, ManagedUserProfile, ManagedUserPasswordResetInput, ManagedUserPasswordResetResult, ManagedUserMfaResetInput, ManagedUserMfaResetResult } from '../types/user-management';
import { defaultUserSettings, validateUserSettingsPatch, parseUserSettings, USER_PROFILE_LIMITS } from "../lib/user-settings";
import { query, transaction, audit } from "./db";
import { object, assert, HttpError } from "./types";
import sharp from "sharp";
import { z } from "zod";
import { inquiryLineSchema, readInquiryCollection } from "./inquiry-collection";
import { parse, rateLimit } from "./http";
import { replaceWishlistSaved } from "./wishlists";
import { applyLegacyNotificationPreferences, enqueueAccountNotification } from "./notification-policy";
import { crmPermissionSchema, noCrmPermissions, loadCrmAccess } from "./workspace-scopes";
import { userDto, currentSessionUser } from "./auth";
import { randomUUID } from "node:crypto";
import { passwordHash, passwordMatches, decrypt, validTotpCounter } from "./crypto";
import { assertStaffDeactivationReady } from "./staff-lifecycle";
import {staffProvisioningMode,assertPanelStaffProvisioning} from './staff-provisioning-mode';
function defaults(actor: Actor) { return defaultUserSettings({...actor,email:actor.email.endsWith('@identity.invalid')?'':actor.email,demo:false}, 'fa'); }
async function getSettings(actor: Actor): Promise<UserSettings> {
  actor=await loadCrmAccess(actor);
  await query('INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING',[actor.id]);
  const row=(await query('SELECT * FROM user_settings WHERE user_id=$1',[actor.id])).rows[0];const fallback=defaults(actor);
  return {version:1,ownerId:actor.id,profile:{...fallback.profile,...row.profile,name:actor.name},preferences:{...fallback.preferences,...row.preferences},revision:row.version,updatedAt:row.updated_at.toISOString()};
}
async function patchSettings(actor: Actor, section:'profile'|'preferences', value:unknown, expected:number):Promise<UserSettings> {
  const patch=object(value);
  const issues=validateUserSettingsPatch(section,patch);assert(!issues.length,422,'VALIDATION','Check the profile or preference fields.');
  if(section==='profile' && typeof patch.avatar==='string') {
    assert(/^data:image\/(png|jpeg|webp);base64,/.test(patch.avatar),422,'AVATAR_FORMAT','A PNG, JPEG or WebP avatar is required.');
    const data=Buffer.from(patch.avatar.split(',')[1], 'base64');assert(data.length<=8*1024*1024,413,'AVATAR_SIZE','The avatar is too large.');
    try {const bytes=await sharp(data,{limitInputPixels:32_000_000}).rotate().resize(512,512,{fit:'cover'}).jpeg({quality:85}).toBuffer();patch.avatar='data:image/jpeg;base64,'+bytes.toString('base64');}
    catch {throw new HttpError(422,'AVATAR_FORMAT','The avatar could not be decoded.');}
  }
  await transaction(async client=>{
    const current=(await client.query('SELECT id FROM users WHERE id=$1 AND active FOR UPDATE',[actor.id])).rows[0];
    assert(current,401,'SESSION_REQUIRED','Please sign in again.');
    actor=await loadCrmAccess(actor,client);
    await client.query('INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING',[actor.id]);
    const row=(await client.query('SELECT * FROM user_settings WHERE user_id=$1 FOR UPDATE',[actor.id])).rows[0];
    assert(row.version===expected,409,'CONFLICT','Your settings changed in another session. Refresh and retry.');
    const merged={...row[section],...patch};
    // The selected column is an internal enum, never a caller-controlled identifier.
    await client.query(`UPDATE user_settings SET ${section}=$2::jsonb,version=version+1,updated_at=now() WHERE user_id=$1`,[actor.id,JSON.stringify(merged)]);
    if(section==='profile'&&typeof patch.name==='string') await client.query('UPDATE users SET name=$2,updated_at=now() WHERE id=$1',[actor.id,patch.name.trim()]);
    await audit(actor.id,'account.'+section+'.updated','user',actor.id,{fields:Object.keys(patch)},client);
  });
  return getSettings({...actor,name:section==='profile'&&typeof patch.name==='string'?patch.name.trim():actor.name});
}
const collectionSchema = z.object({ inquiries: z.array(inquiryLineSchema).max(500).optional(), compare: z.array(z.string().max(100)).max(4).optional(), collectionVersion: z.number().int().min(1).optional(), saved: z.array(z.string().max(240)).max(500).optional(), savedVersion: z.number().int().min(1).optional(), savedLocale: z.enum(['fa','en','tr','ar','ru']).optional() }).strict();
async function getCollection(actor:Actor){ await getSettings(actor); return (transaction)(client => (readInquiryCollection)(client, actor)); }
async function patchCollection(actor:Actor,body:unknown){
    const { saved, savedVersion, savedLocale, collectionVersion, ...patch } = parse(collectionSchema,body);
    await getSettings(actor);
    (assert)(saved !== void 0 || savedVersion === void 0 && savedLocale === void 0, 422, "VALIDATION", "Saved-list metadata requires a saved-list update.");
    if (saved !== void 0)
        (assert)(savedVersion !== void 0 && savedLocale !== void 0, 428, "PRECONDITION_REQUIRED", "Send the current savedVersion and savedLocale from your collection.");
    if (Object.keys(patch).length)
        (assert)(collectionVersion !== void 0, 428, "PRECONDITION_REQUIRED", "Send the current collectionVersion for inquiry or comparison changes.");
    else
        (assert)(collectionVersion === void 0, 422, "VALIDATION", "Collection metadata requires an inquiry or comparison update.");
    return (transaction)(async (client) => {
        const current = await (readInquiryCollection)(client, actor);
        if (Object.keys(patch).length)
            (assert)(collectionVersion === current.collectionVersion, 409, "COLLECTION_CONFLICT", "Your inquiry or comparison list changed. Reload and review your edit.");
        if (saved !== void 0)
            await (replaceWishlistSaved)(client, actor, saved, savedVersion, savedLocale);
        if (Object.keys(patch).length)
            await client.query("UPDATE user_settings SET collection=collection||$2::jsonb,collection_version=collection_version+1 WHERE user_id=$1", [actor.id, JSON.stringify(patch)]);
        return (readInquiryCollection)(client, actor);
    });
}
const memberSchema=z.object({id:z.string().max(100),email:z.string().email().max(254),name:z.string().max(100).optional(),role:z.enum(['owner','admin','member','viewer']).optional(),status:z.enum(['active','pending','invited']).optional()}).strict();
const portalSchema=z.object({organizations:z.array(z.object({id:z.string().max(100),name:z.string().min(1).max(200),city:z.string().max(100).optional(),country:z.string().max(100).optional(),members:z.array(memberSchema).max(100).default([]),sharedRequestIds:z.array(z.string().max(100)).max(200).default([])}).strict()).max(50).optional(),notificationPreferences:z.object({inApp:z.boolean().optional(),email:z.boolean().optional(),requests:z.boolean().optional(),products:z.boolean().optional(),research:z.boolean().optional(),events:z.boolean().optional(),content:z.boolean().optional(),frequency:z.enum(['instant','daily','weekly']).optional(),quietStart:z.string().regex(/^\d{2}:\d{2}$/).optional(),quietEnd:z.string().regex(/^\d{2}:\d{2}$/).optional()}).strict().optional(),notificationsRead:z.array(z.string().max(100)).max(1000).optional()}).strict();
async function getPortal(actor:Actor){await getSettings(actor);return(await query('SELECT portal FROM user_settings WHERE user_id=$1',[actor.id])).rows[0].portal;}
async function patchPortal(actor:Actor,body:unknown){const patch=parse(portalSchema,body);await getSettings(actor);
  if(patch.organizations){const ids=[...new Set(patch.organizations.flatMap(org=>org.sharedRequestIds))];if(ids.length){const rows=await query('SELECT id FROM requests WHERE owner_id=$1 AND id=ANY($2::text[])',[actor.id,ids]);assert(rows.rowCount===ids.length,403,'OWNERSHIP','Only your own requests may be associated with an organization.');}}
  // These are this user's address-book contacts. They do not grant login, organization membership, or record access.
  return transaction(async client=>{actor=await loadCrmAccess(actor,client);if(patch.notificationPreferences)await applyLegacyNotificationPreferences(client,actor,patch.notificationPreferences);const result=await client.query('UPDATE user_settings SET portal=portal||$2::jsonb WHERE user_id=$1 RETURNING portal',[actor.id,JSON.stringify(patch)]);await audit(actor.id,'account.portal.updated','user',actor.id,{fields:Object.keys(patch)},client);return result.rows[0].portal;});
}
const roleSchema=z.enum(['customer','superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support']);
const userFields = { name: z.string().trim().min(2).max(100), role: roleSchema, active: z.boolean(), allowedLocales: z.array(z.enum(['fa','en','tr','ar','ru'])).min(1).max(5), qualityScope: z.boolean(), crmScope: z.enum(["assigned", "team", "all"]), crmPermissions: crmPermissionSchema };
function assertUserAdmin(actor:Actor){
  assert(['superAdmin','admin'].includes(actor.role),403,'FORBIDDEN','Staff management is restricted to administrators.');
  // Creating or changing another identity is a high-impact action. Keep the
  // role check separate so an eligible administrator gets an actionable
  // response when their existing session has not completed its second factor.
  assert(actor.mfaVerified,403,'MFA_REQUIRED','Complete two-factor verification before managing user accounts.');
}
const staffDto = (user: UserRow) => ({ ...(userDto)(user), active: user.active, crmScope: user.crm_scope, crmPermissions: { ...(noCrmPermissions)(), ...user.crm_permissions } });
type ManagedUserRow = UserRow & {updated_at:Date};
const profileKeys = ['phone','contactEmail','organization','profession','bio','website','country','city','address'] as const;
const managedProfileSchema = z.object({
  phone:z.string().max(USER_PROFILE_LIMITS.phone),contactEmail:z.string().max(USER_PROFILE_LIMITS.contactEmail),
  organization:z.string().max(USER_PROFILE_LIMITS.organization),profession:z.string().max(USER_PROFILE_LIMITS.profession),
  bio:z.string().max(USER_PROFILE_LIMITS.bio),website:z.string().max(USER_PROFILE_LIMITS.website),
  country:z.string().max(USER_PROFILE_LIMITS.country),city:z.string().max(USER_PROFILE_LIMITS.city),address:z.string().max(USER_PROFILE_LIMITS.address),
}).partial().strict().superRefine((value,ctx)=>{
  for(const issue of validateUserSettingsPatch('profile',value))ctx.addIssue({code:'custom',path:issue.split('.').slice(1),message:'Check this profile field.'});
}).transform(value=>Object.fromEntries(Object.entries(value).map(([key,text])=>[key,text.normalize('NFC').replace(
  key==='bio'||key==='address'?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g:/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim()])) as Partial<ManagedUserProfile>);
const emailSchema=z.string().trim().toLowerCase().email().max(254);
const grantFields=['role','allowedLocales','qualityScope','crmScope','crmPermissions'] as const;
function userCapabilities(actor:Actor,user:UserRow):NonNullable<ManagedUser['capabilities']>{
  const senior=actor.role==='superAdmin',panel=staffProvisioningMode()!=='env',self=actor.id===user.id;
  const canEdit=senior||!['superAdmin','admin'].includes(user.role);
  const canChangeEmail=canEdit&&(user.role==='customer'||senior&&panel);
  return {canEdit,canChangeEmail,canManageGrants:senior&&panel&&!self,
    canResetPassword:canChangeEmail&&!self,canResetMfa:senior&&panel&&!self&&user.active&&user.role!=='customer'&&user.mfa_enabled,canDeactivate:canEdit&&!self&&user.active,
    canReactivate:canEdit&&!user.active&&(user.role==='customer'||panel)};
}
function managedDto(actor:Actor,user:ManagedUserRow):ManagedUser{
  return {...staffDto(user),allowedLocales:user.allowed_locales as Locale[],qualityScope:user.quality_scope,
    mfaEnabled:user.mfa_enabled,emailVerified:user.email_verified,createdAt:user.created_at.toISOString(),
    updatedAt:user.updated_at.toISOString(),capabilities:userCapabilities(actor,user)};
}
async function managedAdministrator(actor:Actor,client?:PoolClient,session?:SessionContext):Promise<Actor>{
  // Reject callers outside the administrator roles before asking for MFA.
  // This early rejection grants no authority: the live session, MFA and role
  // are still revalidated below, including under the mutation's user lock.
  assert(['superAdmin','admin'].includes(actor.role),403,'FORBIDDEN','Staff management is restricted to administrators.');
  if(session){
    assert(session.actor.id===actor.id,403,'FORBIDDEN','The current administrator session is required.');
    await currentSessionUser(session,client,true);
  }
  actor=await loadCrmAccess(actor,client);assertUserAdmin(actor);return actor;
}
async function managedDetail(actor:Actor,user:ManagedUserRow,client?:PoolClient):Promise<ManagedUserDetail>{
  const rows=client?await client.query('SELECT profile,version,updated_at FROM user_settings WHERE user_id=$1',[user.id]):await query('SELECT profile,version,updated_at FROM user_settings WHERE user_id=$1',[user.id]);
  const settings=rows.rows[0],parsed=parseUserSettings({version:1,ownerId:user.id,profile:settings?.profile||{},revision:settings?.version??0,updatedAt:settings?.updated_at?.toISOString()||''},userDto(user),'fa');
  const profile=Object.fromEntries(profileKeys.map(key=>[key,parsed.profile[key]])) as ManagedUserProfile;
  return {...managedDto(actor,user),profile,profileRevision:settings?.version??0};
}
async function getManagedUser(actor:Actor,id:string,session?:SessionContext):Promise<ManagedUserDetail>{
  actor=await managedAdministrator(actor,undefined,session);
  const user=(await query<ManagedUserRow>('SELECT * FROM users WHERE id=$1',[id])).rows[0];
  assert(user,404,'NOT_FOUND','User not found.');
  assert(userCapabilities(actor,user).canEdit,403,'ROLE_ESCALATION','This administrator cannot view a privileged account profile.');
  return managedDetail(actor,user);
}
async function revokeUserProofs(client:PoolClient,id:string){
  await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[id]);
  await client.query('UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[id]);
}
const directoryKind = z.enum(['all','staff','customer']);
const directoryActive = z.enum(['all','true','false']);
const directorySearch = z.string().trim().max(100).refine(value=>!value.includes('\0'),'A search cannot contain a null character.');
const directoryQuery = z.object({
  kind:directoryKind.default('all'),q:directorySearch.default(''),role:roleSchema.optional(),
  active:directoryActive.default('all'),
  limit:z.union([z.number().int().min(1).max(100),z.string().regex(/^(?:[1-9]\d?|100)$/).transform(Number)]).default(50),
  cursor:z.string().min(1).max(2048).optional(),
}).strict();
const directoryFilters = z.object({kind:directoryKind,q:directorySearch,role:roleSchema.nullable(),active:directoryActive}).strict();
// Preserve all six PostgreSQL fractional digits in the traversal boundary.
// Only the presentation timestamps below pass through JavaScript Date.
const directoryInstant = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/).refine(value=>{
  const milliseconds=value.slice(0,23)+'Z',parsed=Date.parse(milliseconds);
  return Number(value.slice(0,4))>0&&Number.isFinite(parsed)&&new Date(parsed).toISOString()===milliseconds;
});
const directoryCursor = z.object({v:z.literal(1),createdAt:directoryInstant,id:z.string().min(1).max(100).refine(value=>!value.includes('\0')),filters:directoryFilters}).strict();
type DirectoryFilters = z.infer<typeof directoryFilters>;
function readDirectoryCursor(value:string,filters:DirectoryFilters){
  const invalid=()=>new HttpError(422,'USER_DIRECTORY_CURSOR','The user directory changed filters or has an invalid cursor. Start again from the first page.');
  if(!/^[A-Za-z0-9_-]+$/.test(value))throw invalid();
  const bytes=Buffer.from(value,'base64url'),decoded=bytes.toString('utf8');
  if(bytes.toString('base64url')!==value||!Buffer.from(decoded,'utf8').equals(bytes))throw invalid();
  let input:unknown;try{input=JSON.parse(decoded);}catch{throw invalid();}
  const parsed=directoryCursor.safeParse(input);if(!parsed.success)throw invalid();
  const current=parsed.data.filters;
  if(current.kind!==filters.kind||current.q!==filters.q||current.role!==filters.role||current.active!==filters.active)throw invalid();
  return parsed.data;
}
async function listUsers(actor:Actor,body:unknown={}):Promise<UserDirectoryResponse>{
  actor=await loadCrmAccess(actor);assertUserAdmin(actor);
  // Keep repeated URL parameters visible to validation instead of silently
  // accepting whichever value Object.fromEntries happens to retain.
  if(body instanceof URLSearchParams){
    const entries=[...body.entries()];
    assert(new Set(entries.map(([key])=>key)).size===entries.length,422,'VALIDATION','Send each user-directory query field once.');
    body=Object.fromEntries(entries);
  }
  const input=parse(directoryQuery,body);
  assert(!(input.kind==='staff'&&input.role==='customer'||input.kind==='customer'&&input.role&&input.role!=='customer'),422,'VALIDATION','The selected role conflicts with the user-directory kind.');
  const filters:DirectoryFilters={kind:input.kind,q:input.q,role:input.role??null,active:input.active};
  const cursor=input.cursor?readDirectoryCursor(input.cursor,filters):null;
  const values:unknown[]=[],where:string[]=[];
  const bind=(value:unknown)=>{values.push(value);return '$'+values.length;};
  if(input.kind==='staff')where.push("u.role <> 'customer'");
  if(input.kind==='customer')where.push("u.role = 'customer'");
  if(input.role)where.push('u.role = '+bind(input.role));
  if(input.active!=='all')where.push('u.active = '+bind(input.active==='true'));
  if(input.q){
    const term=bind('%'+input.q.replace(/[\\%_]/g,'\\$&')+'%');
    let phone=input.q.replace(/[۰-۹]/g,value=>String(value.charCodeAt(0)-0x6f0)).replace(/[٠-٩]/g,value=>String(value.charCodeAt(0)-0x660)).replace(/[\s()-]/g,'');
    if(/^09\d{9}$/.test(phone))phone='+98'+phone.slice(1);
    else if(/^0098\d{10}$/.test(phone))phone='+'+phone.slice(2);
    else if(/^98\d{10}$/.test(phone))phone='+'+phone;
    const phoneTerm=bind('%'+(phone||input.q).replace(/[\\%_]/g,'\\$&')+'%');
    where.push(`(u.name ILIKE ${term} ESCAPE E'\\\\' OR (NOT u.email_placeholder AND u.email ILIKE ${term} ESCAPE E'\\\\') OR u.phone_number ILIKE ${phoneTerm} ESCAPE E'\\\\')`);
  }
  if(cursor)where.push(`(u.created_at,u.id) < (${bind(cursor.createdAt)}::timestamptz,${bind(cursor.id)}::text)`);
  const rows=(await query<UserRow & {updated_at:Date;directory_created_at:string}>(`SELECT
    u.id,u.name,u.email,u.role,u.active,u.email_verified,u.email_placeholder,u.phone_number,u.phone_verified_at,u.quality_scope,u.allowed_locales,
    u.mfa_enabled,u.crm_scope,u.crm_permissions,u.created_at,u.updated_at,
    to_char(u.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS directory_created_at
    FROM users u ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY u.created_at DESC,u.id DESC LIMIT ${bind(input.limit+1)}`,values)).rows;
  const page=rows.slice(0,input.limit),last=page.at(-1),provisioningMode=staffProvisioningMode();
  return {provisioningMode,canCreate:provisioningMode!=='env',canManageGrants:provisioningMode!=='env'&&actor.role==='superAdmin',
    items:page.map(user=>managedDto(actor,user)),
    nextCursor:rows.length>input.limit&&last?Buffer.from(JSON.stringify({v:1,createdAt:last.directory_created_at,id:last.id,filters})).toString('base64url'):null};
}
async function createUser(actor:Actor,body:unknown,session?:SessionContext){
  actor=await managedAdministrator(actor,undefined,session);
  const input=parse(z.object({...userFields,role:roleSchema.default('customer'),active:z.boolean().default(true),
    allowedLocales:userFields.allowedLocales.optional(),qualityScope:z.boolean().default(false),
    crmScope:userFields.crmScope.default('assigned'),crmPermissions:crmPermissionSchema.default({}),
    email:emailSchema,password:z.string().min(12).max(128),profile:managedProfileSchema.optional(),
  }).strict(),body);
  if(input.role!=='customer')assertPanelStaffProvisioning();
  assert(input.role!=='customer'||!input.qualityScope&&input.crmScope==='assigned'&&!Object.values(input.crmPermissions).some(Boolean),422,'CUSTOMER_PERMISSIONS','Customer accounts cannot hold staff quality or CRM permissions.');
  assert(input.role!=='translator'||!input.allowedLocales?.includes('fa'),422,'STAFF_LOCALES','Translator access is limited to target languages other than Persian.');
  const authorize=()=>assert(actor.role==='superAdmin'||input.role==='customer'&&!input.qualityScope&&input.crmScope==='assigned'&&!Object.values(input.crmPermissions).some(Boolean),403,'ROLE_ESCALATION','Only the senior administrator may assign staff roles or CRM permissions.');
  authorize();
  const id=randomUUID(),encoded=await passwordHash(input.password);
  try{return await transaction(async client=>{
    await client.query('SELECT * FROM workspace_meta WHERE singleton=true FOR UPDATE');
    await client.query('SELECT pg_advisory_xact_lock(917264831)');
    actor=await managedAdministrator(actor,client,session);authorize();
    const user=(await client.query<ManagedUserRow>(`INSERT INTO users(id,name,email,password_hash,role,active,allowed_locales,quality_scope,crm_scope,crm_permissions)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb) RETURNING *`,[id,input.name,input.email,encoded,input.role,input.active,
      JSON.stringify(input.allowedLocales||(input.role==='translator'?['en','tr','ar','ru']:['fa','en','tr','ar','ru'])),input.qualityScope,
      input.role==='customer'?'assigned':input.crmScope,JSON.stringify(input.role==='customer'?{}:input.crmPermissions)])).rows[0];
    await client.query('INSERT INTO user_settings(user_id,profile) VALUES($1,$2::jsonb)',[id,JSON.stringify({...input.profile,name:input.name})]);
    await audit(actor.id,'staff.created','user',id,{role:input.role,qualityScope:input.qualityScope,crmScope:user.crm_scope,crmPermissions:user.crm_permissions,profileFields:Object.keys(input.profile||{})},client);
    return managedDetail(actor,user,client);
  });}catch(error){
    if((error as NodeJS.ErrnoException).code==='23505')throw new HttpError(409,'EMAIL_EXISTS','This email address is already registered.');
    throw error;
  }
}
async function updateUser(actor:Actor,id:string,body:unknown,session?:SessionContext){
  assertUserAdmin(actor);
  const input=parse(z.object({...userFields,email:z.union([emailSchema,z.literal('')]),profile:managedProfileSchema,
    profileRevision:z.number().int().min(0),expectedUpdatedAt:z.string().datetime(),
  }).partial().strict(),body);
  const {profileRevision,expectedUpdatedAt,...patch}=input;
  assert(Object.keys(patch).length,422,'EMPTY_PATCH','No changes were supplied.');
  assert(patch.profile!==undefined||profileRevision===undefined,422,'VALIDATION','A profile revision requires profile changes.');
  if(patch.profile!==undefined)assert(profileRevision!==undefined,428,'PRECONDITION_REQUIRED','Send the current profileRevision with profile changes.');
  if(grantFields.some(key=>key in patch))assertPanelStaffProvisioning();
  try{return await transaction(async client=>{
    await client.query('SELECT * FROM workspace_meta WHERE singleton=true FOR UPDATE');
    await client.query('SELECT pg_advisory_xact_lock(917264831)');
    actor=await managedAdministrator(actor,client,session);
    const user=(await client.query<ManagedUserRow>('SELECT * FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];
    assert(user,404,'NOT_FOUND','User not found.');
    const capabilities=userCapabilities(actor,user);
    assert(capabilities.canEdit,403,'ROLE_ESCALATION','This administrator cannot modify a privileged account.');
    if(expectedUpdatedAt!==undefined)assert(user.updated_at.toISOString()===expectedUpdatedAt,409,'USER_CONFLICT','This account changed in another session. Reload it and review the new values.');
    if(grantFields.some(key=>key in patch)){
      assert(actor.role==='superAdmin',403,'ROLE_ESCALATION','Only the senior administrator may change permissions.');
      if(id===actor.id)assert(!grantFields.some(key=>key in patch),403,patch.role&&patch.role!==user.role?'SELF_ROLE_CHANGE':'SELF_PERMISSION_CHANGE','You cannot change your own administrative permissions. Another senior administrator must review the change.');
    }
    assert(patch.email!==''||user.email_placeholder,422,'EMAIL_REQUIRED','A real email address is required for this account.');
    const email=patch.email===''?user.email:patch.email??user.email,emailChanged=email!==user.email;
    assert((patch.role??user.role)==='customer'||!user.email_placeholder||emailChanged,422,'STAFF_EMAIL_REQUIRED','Set a real staff email before assigning a staff role.');
    if(emailChanged){
      if(user.role!=='customer'&&staffProvisioningMode()==='env')assertPanelStaffProvisioning();
      assert(capabilities.canChangeEmail,403,'ROLE_ESCALATION','Only the senior administrator may change staff login addresses.');
    }
    const role=patch.role??user.role,active=patch.active??user.active;
    if(user.active&&user.role==='superAdmin'&&(!active||role!=='superAdmin')){
      const count=(await client.query("SELECT count(*)::int AS n FROM users WHERE active AND role='superAdmin'")).rows[0].n;
      assert(count>1,409,'LAST_ADMIN','The last active senior administrator cannot be removed.');
    }
    assert(!(id===actor.id&&!active),403,'SELF_DEACTIVATION','You cannot deactivate your own administrator account.');
    if(staffProvisioningMode()==='env'&&user.role!=='customer'&&active&&!user.active)assertPanelStaffProvisioning();
    const allowedLocales=patch.allowedLocales??user.allowed_locales,qualityScope=role==='customer'?false:patch.qualityScope??user.quality_scope;
    const crmScope=role==='customer'?'assigned':patch.crmScope??user.crm_scope,crmPermissions=role==='customer'?{}:{...user.crm_permissions,...patch.crmPermissions};
    assert(role!=='translator'||!allowedLocales.includes('fa'),422,'STAFF_LOCALES','Translator access is limited to target languages other than Persian.');
    assert(role!=='customer'||!patch.qualityScope&&!Object.values(patch.crmPermissions||{}).some(Boolean)&&(!patch.crmScope||patch.crmScope==='assigned'),422,'CUSTOMER_PERMISSIONS','Customer accounts cannot hold staff quality or CRM permissions.');
    const permissionsChanged=role!==user.role||JSON.stringify([...allowedLocales].sort())!==JSON.stringify([...user.allowed_locales].sort())||qualityScope!==user.quality_scope||crmScope!==user.crm_scope||Object.keys(noCrmPermissions()).some(key=>!!crmPermissions[key as keyof typeof crmPermissions]!==!!user.crm_permissions[key as keyof typeof user.crm_permissions]);
    // Retiring a staff identity requires an explicit handover. Removing a field
    // grant or narrowing its scope must take effect immediately, even while the
    // employee owns work; current access checks and proof revocation below
    // enforce that reduction without demanding unrelated work transfers.
    if(user.role!=='customer'&&(!active||role==='customer'))await assertStaffDeactivationReady(client,id);
    if(patch.profile!==undefined||patch.name!==undefined){
      await client.query('INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
      const settings=(await client.query('SELECT profile,version FROM user_settings WHERE user_id=$1 FOR UPDATE',[id])).rows[0];
      if(patch.profile!==undefined)assert(settings.version===profileRevision,409,'PROFILE_CONFLICT','This profile changed in another session. Reload it and review the new values.');
      await client.query('UPDATE user_settings SET profile=profile||$2::jsonb,version=version+1,updated_at=now() WHERE user_id=$1',[id,JSON.stringify({...patch.profile,...patch.name!==undefined?{name:patch.name}:{}})]);
    }
    const updated=(await client.query<ManagedUserRow>(`UPDATE users SET name=$2,email=$3,role=$4,active=$5,allowed_locales=$6::jsonb,quality_scope=$7,
      crm_scope=$8,crm_permissions=$9::jsonb,email_placeholder=CASE WHEN $10 THEN false ELSE email_placeholder END,email_verified=CASE WHEN $10 THEN false ELSE email_verified END,
      mfa_pending_secret=CASE WHEN $10 THEN NULL ELSE mfa_pending_secret END,
      mfa_pending_expires_at=CASE WHEN $10 THEN NULL ELSE mfa_pending_expires_at END,updated_at=now() WHERE id=$1 RETURNING *`,
      [id,patch.name??user.name,email,role,active,JSON.stringify(allowedLocales),qualityScope,crmScope,JSON.stringify(crmPermissions),emailChanged])).rows[0];
    if(emailChanged||permissionsChanged||active!==user.active)await revokeUserProofs(client,id);
    await audit(actor.id,'staff.updated','user',id,{fields:Object.keys(patch),profileFields:Object.keys(patch.profile||{}),role:updated.role,
      qualityScope:updated.quality_scope,crmScope:updated.crm_scope,crmPermissions:updated.crm_permissions,
      emailChanged,sessionsRevoked:emailChanged||permissionsChanged||active!==user.active},client);
    return {...await managedDetail(actor,updated,client),requiresReauthentication:id===actor.id&&emailChanged};
  });}catch(error){
    if((error as NodeJS.ErrnoException).code==='23505')throw new HttpError(409,'EMAIL_EXISTS','This email address is already registered.');
    throw error;
  }
}
async function resetManagedUserPassword(session:SessionContext,id:string,body:unknown):Promise<ManagedUserPasswordResetResult>{
  const input:ManagedUserPasswordResetInput=parse(z.object({password:z.string().min(12).max(128),expectedUpdatedAt:z.string().datetime().optional()}).strict(),body);
  let actor=await managedAdministrator(session.actor,undefined,session);
  assert(actor.id!==id,403,'SELF_PASSWORD_RESET','Use your account security page to change your own password with its current password.');
  const checkTarget=(user:ManagedUserRow|undefined)=>{
    assert(user,404,'NOT_FOUND','User not found.');
    if(user.role!=='customer'&&staffProvisioningMode()==='env')assertPanelStaffProvisioning();
    assert(userCapabilities(actor,user).canResetPassword,403,'ROLE_ESCALATION','Only the senior administrator may reset staff credentials.');
    // Advancing an open editor's timestamp is safe only when this reset starts
    // from that same account snapshot. Check again under the final target lock
    // so an intervening edit during password hashing cannot be skipped.
    if(input.expectedUpdatedAt!==undefined)assert(user.updated_at.toISOString()===input.expectedUpdatedAt,409,'USER_CONFLICT','This account changed in another session. Reload it and review the new values.');
  };
  checkTarget((await query<ManagedUserRow>('SELECT * FROM users WHERE id=$1',[id])).rows[0]);
  await rateLimit('admin-password-reset:actor:'+actor.id,20,3600);
  await rateLimit('admin-password-reset:target:'+id,5,3600);
  const encoded=await passwordHash(input.password);
  return transaction<ManagedUserPasswordResetResult>(async client=>{
    await client.query('SELECT * FROM workspace_meta WHERE singleton=true FOR UPDATE');
    await client.query('SELECT pg_advisory_xact_lock(917264831)');
    // Password hashing can outlast a session or a role change. Recheck both
    // administrator and target under the same lock order as credential flows.
    actor=await managedAdministrator(actor,client,session);
    const user=(await client.query<ManagedUserRow>('SELECT * FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];checkTarget(user);
    const updated=(await client.query<{updated_at:Date}>(`UPDATE users SET password_hash=$2,failed_logins=0,locked_until=NULL,
      mfa_pending_secret=NULL,mfa_pending_expires_at=NULL,updated_at=now() WHERE id=$1 RETURNING updated_at`,[id,encoded])).rows[0];
    await revokeUserProofs(client,id);
    // Do not include plaintext, verifiers, email or profile content in audit.
    await audit(actor.id,'staff.password_reset','user',id,{sessionsRevoked:true,mfaPreserved:user.mfa_enabled},client);
    return {ok:true,userId:id,sessionsRevoked:true,updatedAt:updated.updated_at.toISOString()};
  });
}
const staffMfaRecoveryNotice:Record<Locale,{title:string;body:string}>={
  fa:{title:'ایده‌آل ماکو — بازیابی ورود همکار',body:'مدیر ارشد، رمز عبور و احراز هویت دومرحله‌ای حساب همکاری شما را بازنشانی کرد. نشست‌ها، کدهای بازیابی و پیوندهای ورود یا دعوت در انتظار، بی‌اعتبار شدند. اگر این درخواست از شما نبوده است، از راهی مطمئن با سازمان خود تماس بگیرید. رمز عبور جدید را از مدیر احرازشدهٔ خود از راهی امن دریافت کنید و پیش از استفاده از فضای کاری، برنامهٔ احراز هویت را دوباره ثبت کنید.'},
  en:{title:'Ideal Makoo — staff sign-in recovery',body:'A senior administrator reset your staff password and authenticator. Previous sessions, recovery codes and pending sign-in or invitation links were invalidated. Contact your organization through a trusted channel if you did not request this. Obtain the new password through your verified administrator and enroll an authenticator before using the workspace.'},
  tr:{title:'Ideal Makoo — personel giriş erişimi kurtarma',body:'Kıdemli yönetici, personel hesabınızın parolasını ve doğrulayıcısını sıfırladı. Önceki oturumlar, kurtarma kodları ve bekleyen giriş veya davet bağlantıları geçersiz kılındı. Bunu siz istemediyseniz kuruluşunuzla güvenilir bir kanaldan iletişime geçin. Yeni parolayı kimliğini doğruladığınız yöneticinizden güvenli bir yolla alın ve çalışma alanını kullanmadan önce doğrulayıcıyı yeniden kaydedin.'},
  ar:{title:'إيدئال ماكو — استعادة دخول الموظف',body:'أعاد المسؤول الأعلى تعيين كلمة مرور حساب الموظف وأداة المصادقة الخاصة بك. أُبطلت الجلسات السابقة ورموز الاسترداد وروابط الدخول أو الدعوات المعلّقة. إذا لم تطلب ذلك، فتواصل مع مؤسستك عبر قناة موثوقة. احصل على كلمة المرور الجديدة بأمان من مسؤول تحققت من هويته، وسجّل أداة المصادقة من جديد قبل استخدام مساحة العمل.'},
  ru:{title:'Ideal Makoo — восстановление входа сотрудника',body:'Старший администратор сбросил пароль вашей учетной записи сотрудника и аутентификатор. Предыдущие сеансы, коды восстановления и ожидающие ссылки для входа или приглашения аннулированы. Если вы не запрашивали это действие, свяжитесь с организацией по доверенному каналу. Получите новый пароль безопасным способом у администратора, чья личность проверена, и заново подключите аутентификатор перед использованием рабочего пространства.'}
};
async function resetManagedUserMfa(session:SessionContext,id:string,body:unknown):Promise<ManagedUserMfaResetResult>{
  const input:ManagedUserMfaResetInput=parse(z.object({actorPassword:z.string().min(1).max(128),actorCode:z.string().regex(/^\d{6}$/),
    password:z.string().min(12).max(128),expectedUpdatedAt:z.string().datetime(),profileRevision:z.number().int().min(0)}).strict(),body);
  let actor=await managedAdministrator(session.actor,undefined,session);
  const authorize=()=>{
    assert(actor.role==='superAdmin',403,'ROLE_ESCALATION','Only the senior administrator may recover a staff authenticator.');
    assert(actor.id!==id,403,'SELF_MFA_RESET','Use the protected owner recovery procedure for your own authenticator.');
    assertPanelStaffProvisioning();
  };
  authorize();
  const checkTarget=(user:ManagedUserRow|undefined)=>{
    assert(user,404,'NOT_FOUND','Staff account not found.');
    assert(user.role!=='customer',403,'STAFF_MFA_TARGET','This recovery action is only for a staff account.');
    assert(user.active,409,'STAFF_INACTIVE','Review and reactivate this staff account separately before recovering its authenticator.');
    assert(user.mfa_enabled,409,'MFA_NOT_ENABLED','This account already requires authenticator enrollment.');
    assert(user.updated_at.toISOString()===input.expectedUpdatedAt,409,'USER_CONFLICT','This account changed. Reload its current profile before recovering it.');
  };
  const observedTarget=(await query<ManagedUserRow>('SELECT * FROM users WHERE id=$1',[id])).rows[0];checkTarget(observedTarget);
  await rateLimit('admin-mfa-reset:actor:'+actor.id,5,900);
  await rateLimit('admin-mfa-reset:target:'+id,5,3600);
  const observedActor=await currentSessionUser(session,undefined,true);
  assert(observedActor.role==='superAdmin',403,'ROLE_ESCALATION','Only the senior administrator may recover a staff authenticator.');
  assert(await passwordMatches(input.actorPassword,observedActor.password_hash),401,'INVALID_CREDENTIALS','The current administrator password is incorrect.');
  assert(!await passwordMatches(input.password,observedTarget.password_hash),422,'PASSWORD_REUSE','Choose a different password for the recovered account.');
  const encoded=await passwordHash(input.password);
  return transaction<ManagedUserMfaResetResult>(async client=>{
    // Match the existing credential/staff lock order; authority and both
    // optimistic target versions must still be current after password work.
    await client.query('SELECT * FROM workspace_meta WHERE singleton=true FOR UPDATE');
    await client.query('SELECT pg_advisory_xact_lock(917264831)');
    actor=await managedAdministrator(actor,client,session);authorize();
    const currentActor=await currentSessionUser(session,client,true);
    assert(currentActor.password_hash===observedActor.password_hash,401,'INVALID_CREDENTIALS','The administrator password changed. Authenticate again.');
    const user=(await client.query<ManagedUserRow>('SELECT * FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];checkTarget(user);
    assert(user.password_hash===observedTarget.password_hash,409,'USER_CONFLICT','The target credentials changed. Reload its current profile.');
    await client.query('INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
    const settings=(await client.query<{version:number;preferences:Record<string,unknown>|null}>('SELECT version,preferences FROM user_settings WHERE user_id=$1 FOR UPDATE',[id])).rows[0];
    assert(settings.version===input.profileRevision,409,'PROFILE_CONFLICT','This profile changed. Reload its current version.');
    const counter=currentActor.mfa_secret?validTotpCounter(decrypt(currentActor.mfa_secret),input.actorCode,Number(currentActor.mfa_last_counter)):null;
    assert(counter!==null,422,'MFA_INVALID','Use a fresh administrator authenticator code that has not already been used.');
    // A recovery code or an old MFA session is not a substitute for this TOTP.
    // The acting senior remains enabled; roles, grants and identity bindings
    // are never changed by this recovery operation.
    await client.query('UPDATE users SET mfa_last_counter=$2 WHERE id=$1',[actor.id,counter]);
    const updated=(await client.query<{updated_at:Date}>(`UPDATE users SET password_hash=$2,failed_logins=0,locked_until=NULL,
      mfa_enabled=false,mfa_secret=NULL,mfa_pending_secret=NULL,mfa_pending_expires_at=NULL,mfa_last_counter=-1,
      recovery_hashes='[]'::jsonb,updated_at=now() WHERE id=$1 RETURNING updated_at`,[id,encoded])).rows[0];
    const profile=(await client.query<{version:number}>('UPDATE user_settings SET version=version+1,updated_at=now() WHERE user_id=$1 RETURNING version',[id])).rows[0];
    await revokeUserProofs(client,id);
    const staffInvitations=await client.query(`UPDATE staff_invitations SET revoked_at=now(),revoked_by=$2,version=version+1
      WHERE accepted_at IS NULL AND revoked_at IS NULL AND (target_user_id=$1 OR invited_by=$1 OR email=$3)`,[id,actor.id,user.email]);
    const organizationInvitations=await client.query<{organization_id:string}>(`UPDATE organization_invitations SET revoked_at=now()
      WHERE accepted_at IS NULL AND revoked_at IS NULL AND (invited_by=$1 OR email=$2) RETURNING organization_id`,[id,user.email]);
    const organizations=[...new Set(organizationInvitations.rows.map(row=>row.organization_id))];
    if(organizations.length)await client.query('UPDATE customer_organizations SET version=version+1,updated_at=now() WHERE id=ANY($1::uuid[])',[organizations]);
    // Queue only a security notice in this transaction; SMTP delivery is a
    // separate worker/policy decision. No credential or recovery token belongs
    // in the notice, audit, response or an administrator's notification.
    const language=String(settings.preferences?.language||'fa');
    const noticeCopy=staffMfaRecoveryNotice[Object.hasOwn(staffMfaRecoveryNotice,language)?language as Locale:'fa'];
    const notice=await enqueueAccountNotification(client,{userId:id,channel:'email',purpose:'transactional',topic:'requests',...noticeCopy},'staff-mfa-reset:'+id+':'+profile.version);
    assert(notice,500,'SECURITY_NOTICE_QUEUE','The recovery notice could not be queued. Retry the recovery action.');
    await audit(actor.id,'staff.mfa_reset','user',id,{sessionsRevoked:true,challengesRevoked:true,requiresEnrollment:true,
      staffInvitationsRevoked:staffInvitations.rowCount||0,organizationInvitationsRevoked:organizationInvitations.rowCount||0,profileRevision:profile.version,securityNoticeQueued:true},client);
    return {ok:true,userId:id,sessionsRevoked:true,mfaEnrollmentRequired:true,updatedAt:updated.updated_at.toISOString(),profileRevision:profile.version};
  });
}
async function notifications(actor:Actor){return{items:(await query('SELECT id,title,body,href,read_at AS "readAt",created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[actor.id])).rows};}
async function readNotification(actor:Actor,id:string){const result=await query('UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2 RETURNING id',[id,actor.id]);assert(result.rowCount,404,'NOT_FOUND','Notification not found.');return{ok:true};}
export { createUser, getCollection, getPortal, getSettings, getManagedUser, listUsers, notifications, patchCollection, patchPortal, patchSettings, readNotification, updateUser, resetManagedUserPassword, resetManagedUserMfa };
