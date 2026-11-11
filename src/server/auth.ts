import {bindNotificationTemplate} from './notification-templates';
import { consumeMfaChannel, issueMfaChannel, type MfaChannelMethod } from './mfa-channel';
import { randomInt, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { RoleKey } from '../types/domain';
import type { FrontSession } from '../lib/auth';
import { config } from './config';
import { audit, query, transaction } from './db';
import { decrypt, encrypt, equal, hash, newTotpSecret, passwordHash, passwordMatches, passwordNeedsUpgrade, signGuest, token, validTotpCounter, validatePassword, verifyGuest } from './crypto';
import { cookie, cookies, json, parse, rateLimit, visitorKey } from './http';
import { assert, HttpError, actorSession, type Actor } from './types';
import { loadCrmAccess, effectiveCrmAccess } from './workspace-scopes';
import type { CrmScope, CrmPermissions } from '../types/crm';

export interface UserRow {
  id: string; name: string; email: string; role: RoleKey; password_hash: string;
  active: boolean; email_verified: boolean; quality_scope: boolean; allowed_locales: string[];
  mfa_enabled: boolean; mfa_secret: string | null; mfa_pending_secret: string | null;
  mfa_pending_expires_at: Date | null; mfa_last_counter: string; recovery_hashes: string[];
  mfa_method: 'totp' | 'email' | 'sms'; mfa_pending_method: 'totp' | 'email' | 'sms' | null;
  locked_until: Date | null; created_at: Date;
  crm_scope: CrmScope; crm_permissions: Partial<CrmPermissions>;
  phone_number?: string | null; phone_verified_at?: Date | null; email_placeholder?: boolean;
}
export interface SessionContext {
  actor: Actor; user: FrontSession; sessionId: string; csrfToken: string;
}
// Credential mutations read their password proof without holding DB locks, then
// re-read under a user-first lock. All paths use user -> session/challenge order.
// A lock wait can cross a proof's deadline. PostgreSQL now() remains fixed at
// transaction start, so final authorization uses the actual clock instead.
export async function currentSessionUser(session: SessionContext, client?: PoolClient, mfaRequired = false): Promise<UserRow> {
  const run = <T extends import('pg').QueryResultRow>(sql: string, values: unknown[]) => client ? client.query<T>(sql, values) : query<T>(sql, values);
  const user = (await run<UserRow>('SELECT * FROM users WHERE id=$1 AND active' + (client ? ' FOR UPDATE' : ''), [session.actor.id])).rows[0];
  const saved = user ? (await run<{mfa_verified:boolean}>(`SELECT mfa_verified FROM sessions WHERE id=$1 AND user_id=$2
    AND revoked_at IS NULL AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-($3*interval '1 minute')` + (client ? ' FOR UPDATE' : ''), [session.sessionId, user.id, config().idleMinutes])).rows[0] : undefined;
  assert(user && saved, mfaRequired ? 403 : 401, mfaRequired ? 'MFA_REQUIRED' : 'SESSION_REQUIRED', mfaRequired ? 'A current two-factor authenticated session is required.' : 'Please sign in again.');
  if (mfaRequired) assert(user.mfa_enabled && saved.mfa_verified, 403, 'MFA_REQUIRED', 'A current two-factor authenticated session is required.');
  return user;
}
function samePasswordProof(current: UserRow, observed: UserRow) {
  assert(current.password_hash === observed.password_hash, 401, 'INVALID_CREDENTIALS', 'The current password is incorrect.');
}
async function consumePasswordProofs(client: PoolClient, userId: string) {
  await client.query("UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('mfa','password_reset') AND consumed_at IS NULL", [userId]);
}
export function userDto(user: UserRow): FrontSession {
  return { id: user.id, name: user.name, email: user.email_placeholder ? '' : user.email, role: user.role, demo: false,
    ...(user.phone_number ? {phone:user.phone_number,phoneVerified:!!user.phone_verified_at} : {}),
    mfaEnabled: user.mfa_enabled, emailVerified: user.email_verified, mfaEnrollmentRequired: user.role !== 'customer' && !user.mfa_enabled,
    qualityScope: user.quality_scope, allowedLocales: user.allowed_locales,
    crmAccess: effectiveCrmAccess(user.role,user.crm_scope,user.crm_permissions) };
}
function actorDto(user: UserRow, mfaVerified: boolean): Actor {
  return { id: user.id, name: user.name, email: user.email, role: user.role,
    qualityScope: user.quality_scope, allowedLocales: user.allowed_locales, mfaVerified };
}
export function mfaDeliveryHint(user:UserRow,method:'totp'|'email'|'sms'){if(method==='sms')return user.phone_number?`***${user.phone_number.slice(-4)}`:'';if(method==='email'){const [local,domain='']=user.email.split('@');return local?`${local.slice(0,1)}***@${domain}`:'';}return '';}
export async function sessionFor(request: Request): Promise<SessionContext | null> {
  const raw = cookies(request).im_session; if (!raw || raw.length > 100) return null;
  const result = await query<UserRow & {session_id:string;csrf_token:string;mfa_verified:boolean}>(`SELECT u.*,s.id AS session_id,s.csrf_token,s.mfa_verified
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
    AND s.last_seen_at>now()-($2*interval '1 minute') AND u.active`, [hash(raw), config().idleMinutes]);
  const row = result.rows[0]; if (!row) return null;
  await query('UPDATE sessions SET last_seen_at=now() WHERE id=$1 AND last_seen_at<now()-interval \'60 seconds\'', [row.session_id]);
  const actor=await loadCrmAccess({...actorDto(row,row.mfa_verified&&row.mfa_enabled),
    [actorSession]:Object.freeze({id:row.session_id,userId:row.id})});
  return { actor, user:{...userDto(row),crmAccess:actor.crmAccess}, sessionId: row.session_id, csrfToken: row.csrf_token };
}
export function requireActor(session: SessionContext | null, allowEnrollment = false): Actor {
  assert(session, 401, 'SESSION_REQUIRED', 'Please sign in to continue.');
  if (!allowEnrollment && session.actor.role !== 'customer') assert(session.actor.mfaVerified, 403, 'MFA_REQUIRED', 'Set up two-factor authentication before opening the workspace.');
  return session.actor;
}
export async function sessionResponse(request: Request, session: SessionContext | null) {
  if (session) return json({ user: session.user, csrfToken: session.csrfToken });
  const existing = cookies(request).im_guest_csrf;
  const guest = verifyGuest(existing) ? existing : signGuest(token());
  return json({ user: null, csrfToken: guest }, 200, { 'Set-Cookie': cookie('im_guest_csrf', guest, 86400 * 30) });
}
// Call only while this transaction owns the current user row (or its insert).
export async function newSession(user: UserRow, request: Request, mfaVerified: boolean, client: PoolClient) {
  const raw = token(); const csrfToken = token(); const id = randomUUID();
  const sql = `INSERT INTO sessions(id,token_hash,user_id,csrf_token,mfa_verified,user_agent,ip_hash,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8*interval '1 hour'))`;
  const values = [id, hash(raw), user.id, csrfToken, mfaVerified, (request.headers.get('user-agent') || '').slice(0, 300), visitorKey(request), config().sessionHours];
  await client.query(sql, values);
  const actor=await loadCrmAccess(actorDto(user,mfaVerified),client);
  return { raw, csrfToken, user:{...userDto(user),crmAccess:actor.crmAccess}, mfaEnrollmentRequired: user.role !== 'customer' && !user.mfa_enabled };
}
export function signedInResponse(result: Awaited<ReturnType<typeof newSession>>, status = 200) {
  const { raw, ...body } = result;
  return json(body, status, { 'Set-Cookie': cookie('im_session', raw, config().sessionHours * 3600) });
}
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(12).max(128);
export async function login(request: Request, body: unknown) {
  const input = parse(z.object({ email: emailSchema, password: z.string().min(1).max(128), totp: z.string().max(30).optional() }).strict(), body);
  await rateLimit('login:ip:' + visitorKey(request), 30, 900);
  await rateLimit('login:email:' + hash(input.email), 12, 900);
  const observed = (await query<UserRow>('SELECT * FROM users WHERE email=$1', [input.email])).rows[0];
  // Empty/unknown verifiers take the current dummy-work path in passwordMatches.
  const valid = await passwordMatches(input.password, observed?.password_hash || '');
  const upgraded = valid && observed?.active && !(observed.locked_until && observed.locked_until.getTime() > Date.now()) && passwordNeedsUpgrade(observed.password_hash)
    ? await passwordHash(input.password) : null;
  const result = await transaction(async client => {
    let user = observed ? (await client.query<UserRow>('SELECT * FROM users WHERE id=$1 FOR UPDATE', [observed.id])).rows[0] : undefined;
    const unchanged = !!user && user.email === input.email && user.password_hash === observed?.password_hash;
    if (!unchanged || !valid || !user?.active || (user.locked_until && user.locked_until.getTime() > Date.now())) {
      // A proof for an older credential must not clear OR increment the newer
      // credential's lockout state. Denial commits before the generic 401 below.
      if (unchanged && user) await client.query(`UPDATE users SET failed_logins=failed_logins+1, locked_until=CASE WHEN failed_logins>=9 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1`, [user.id]);
      await audit(user?.id || null, 'auth.login.denied', 'auth', 'login', { emailHash: hash(input.email) }, client);
      return { kind: 'denied' as const };
    }
    if (upgraded) {
      const updated = (await client.query<UserRow>('UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1 AND password_hash=$3 RETURNING *', [user.id, upgraded, observed!.password_hash])).rows[0];
      if (!updated) { await audit(user.id, 'auth.login.denied', 'auth', 'login', { emailHash: hash(input.email) }, client); return { kind: 'denied' as const }; }
      user = updated;
      // Rehash is representation maintenance, not a password change: existing
      // sessions, reset links and MFA login proofs keep their ordinary lifetime.
      await audit(user.id, 'auth.password.rehashed', 'user', user.id, { from: 'scrypt-32768-8-1', to: 'scrypt-32768-8-3' }, client);
    }
    await client.query('UPDATE users SET failed_logins=0,locked_until=NULL WHERE id=$1', [user.id]);
    if (user.mfa_enabled) {
      const challengeToken = token();
      await client.query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'mfa',now()+interval '5 minutes')", [hash(challengeToken), user.id]);
      if (user.mfa_method === 'email' || user.mfa_method === 'sms') await issueMfaChannel(client, user, user.mfa_method, 'login', challengeToken);
      const method=user.mfa_method || 'totp'; return { kind: 'mfa' as const, challengeToken, method, destination:mfaDeliveryHint(user,method) };
    }
    await audit(user.id, 'auth.login', 'user', user.id, {}, client);
    return { kind: 'session' as const, session: await newSession(user, request, false, client) };
  });
  assert(result.kind !== 'denied', 401, 'INVALID_CREDENTIALS', 'The email, password, or account status is invalid.');
  return result.kind === 'mfa' ? json({ mfaRequired: true, challengeToken: result.challengeToken, mfaMethod: result.method, mfaDestination: result.destination }) : signedInResponse(result.session);
}
export async function verifyMfa(request: Request, body: unknown) {
  const input = parse(z.object({ challengeToken: z.string().min(20).max(100), code: z.string().min(6).max(40) }).strict(), body);
  await rateLimit('mfa:' + visitorKey(request), 20, 900);
  const result = await transaction(async client => {
    const candidate = (await client.query("SELECT user_id FROM auth_challenges WHERE token_hash=$1 AND purpose='mfa' AND consumed_at IS NULL AND expires_at>now()", [hash(input.challengeToken)])).rows[0];
    if (!candidate) return null;
    const user = (await client.query<UserRow>('SELECT * FROM users WHERE id=$1 FOR UPDATE', [candidate.user_id])).rows[0];
    const challenge = await client.query(`SELECT * FROM auth_challenges WHERE token_hash=$1 AND user_id=$2 AND purpose='mfa' AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [hash(input.challengeToken), candidate.user_id]);
    const entry = challenge.rows[0]; if (!entry || entry.attempts >= 5) return null;
    await client.query('UPDATE auth_challenges SET attempts=attempts+1 WHERE token_hash=$1', [hash(input.challengeToken)]);
    if (!user?.active || !user.mfa_enabled) return null;
    const code = input.code.trim(); const method = user.mfa_method || 'totp';
    let recovery = false;
    if (method === 'totp') {
      if (!user.mfa_secret) return null;
      const counter = validTotpCounter(decrypt(user.mfa_secret), code, Number(user.mfa_last_counter));
      const recoveryHash = hash(code.toLowerCase().replace(/\s/g, '')); recovery = user.recovery_hashes.includes(recoveryHash);
      if (counter === null && !recovery) return null;
      await client.query('UPDATE users SET mfa_last_counter=$2,recovery_hashes=$3::jsonb WHERE id=$1', [user.id, counter ?? Number(user.mfa_last_counter), JSON.stringify(recovery ? user.recovery_hashes.filter(item => item !== recoveryHash) : user.recovery_hashes)]);
    } else if (!/^\d{6}$/.test(code) || !await consumeMfaChannel(client, user.id, method, 'login', input.challengeToken, code)) return null;
    await client.query('UPDATE auth_challenges SET consumed_at=now() WHERE token_hash=$1', [hash(input.challengeToken)]);
    await audit(user.id, 'auth.mfa.login', 'user', user.id, { recovery, method }, client);
    return newSession(user, request, true, client);
  });
  assert(result, 401, 'MFA_INVALID', 'The verification code or challenge is invalid or expired.'); return signedInResponse(result);
}
export async function register(request: Request, body: unknown) {
  const input = parse(z.object({ name: z.string().trim().min(2).max(100), email: emailSchema, password: passwordSchema }).strict(), body);
  await rateLimit('register:' + visitorKey(request), 10, 3600);
  const encoded = await passwordHash(input.password); const id = randomUUID();
  try {
    const result = await transaction(async client => {
      const inserted = await client.query<UserRow>("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,'customer') RETURNING *", [id, input.email, input.name, encoded]);
      await client.query('INSERT INTO user_settings(user_id) VALUES($1)', [id]);
      await audit(id, 'auth.register', 'user', id, {}, client);
      return newSession(inserted.rows[0], request, false, client);
    });
    return signedInResponse(result, 201);
  } catch (error) { if ((error as {code?:string}).code === '23505') throw new HttpError(409, 'ACCOUNT_UNAVAILABLE', 'Registration is unavailable for this email address.'); throw error; }
}
export async function logout(session: SessionContext | null) {
  if (session) { await query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [session.sessionId]); await audit(session.actor.id, 'auth.logout', 'session', session.sessionId); }
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('im_session', '', 0) });
}
export async function enrollMfa(session: SessionContext, body: unknown) {
  const input = parse(z.object({ password: z.string().min(1).max(128), method: z.enum(['totp','email','sms']).default('totp') }).strict(), body);
  await rateLimit('enroll:' + session.actor.id, 10, 900);
  const observed = await currentSessionUser(session);
  assert(await passwordMatches(input.password, observed.password_hash), 401, 'INVALID_CREDENTIALS', 'The current password is incorrect.');
  const secret = input.method === 'totp' ? newTotpSecret() : token();
  const user = await transaction(async client => {
    const current = await currentSessionUser(session, client);
    samePasswordProof(current, observed);
    assert(!current.mfa_enabled || session.actor.mfaVerified, 403, 'MFA_REQUIRED', 'Complete the current two-factor check before changing its method.');
    await client.query("UPDATE users SET mfa_pending_secret=$2,mfa_pending_method=$3,mfa_pending_expires_at=now()+interval '5 minutes' WHERE id=$1", [current.id, encrypt(secret), input.method]);
    if (input.method === 'email' || input.method === 'sms') await issueMfaChannel(client, current, input.method, 'enroll', secret);
    await audit(current.id, 'auth.mfa.enrollment_started', 'user', current.id, { method: input.method }, client);
    return current;
  });
  if (input.method !== 'totp') return { method: input.method, expiresIn: 300, delivery: 'queued' as const };
  const otpauthUrl = `otpauth://totp/${encodeURIComponent('Ideal Makoo:' + user.email)}?secret=${secret}&issuer=Ideal%20Makoo&algorithm=SHA1&digits=6&period=30`;
  return { method: 'totp' as const, secret, otpauthUrl, qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', width: 260 }) };
}
export async function confirmMfa(session: SessionContext, body: unknown) {
  const input = parse(z.object({ code: z.string().regex(/^\d{6}$/) }).strict(), body);
  await rateLimit('enroll-confirm:' + session.actor.id, 10, 900);
  return transaction(async client => {
    const row = await currentSessionUser(session, client);
    assert(row.mfa_pending_secret && row.mfa_pending_expires_at && row.mfa_pending_expires_at.getTime() > Date.now(), 409, 'ENROLLMENT_EXPIRED', 'Begin two-factor setup again.');
    const method = row.mfa_pending_method || 'totp';
    const pending = decrypt(row.mfa_pending_secret);
    const counter = method === 'totp' ? validTotpCounter(pending, input.code) : null;
    const valid = method === 'totp' ? counter !== null : await consumeMfaChannel(client, row.id, method as MfaChannelMethod, 'enroll', pending, input.code);
    assert(valid, 422, 'MFA_INVALID', 'The verification code is invalid.');
    const recoveryCodes = method === 'totp' ? Array.from({length:10}, () => token(12).toLowerCase()) : [];
    await client.query("UPDATE users SET mfa_enabled=true,mfa_method=$2,mfa_secret=CASE WHEN $2='totp' THEN mfa_pending_secret ELSE NULL END,mfa_pending_secret=NULL,mfa_pending_method=NULL,mfa_pending_expires_at=NULL,mfa_last_counter=$3,recovery_hashes=$4::jsonb WHERE id=$1", [row.id,method,counter ?? -1,JSON.stringify(recoveryCodes.map(code=>hash(code)))]);
    await client.query('UPDATE sessions SET mfa_verified=true WHERE id=$1', [session.sessionId]);
    await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL', [row.id,session.sessionId]);
    await client.query("UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose='mfa' AND consumed_at IS NULL", [row.id]);
    await audit(row.id, 'auth.mfa.enrolled', 'user', row.id, { method }, client);
    return { recoveryCodes, mfaEnabled: true, mfaMethod: method };
  });
}
export async function disableMfa(session: SessionContext, body: unknown) {
  const input = parse(z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }).strict(), body);
  assert(session.actor.role === 'customer', 403, 'STAFF_MFA_REQUIRED', 'Staff accounts must keep two-factor authentication enabled.');
  await rateLimit('mfa-disable:' + session.actor.id, 5, 900);
  const observed = await currentSessionUser(session);
  assert(await passwordMatches(input.password, observed.password_hash), 401, 'INVALID_CREDENTIALS', 'The current password is incorrect.');
  return transaction(async client => {
    const user = await currentSessionUser(session, client);
    samePasswordProof(user, observed);
    assert(user.role === 'customer', 403, 'STAFF_MFA_REQUIRED', 'Staff accounts must keep two-factor authentication enabled.');
    assert(user.mfa_method === 'totp', 409, 'MFA_METHOD_CHANGE', 'Switch this MFA method to an authenticator before disabling it.');
    assert(user.mfa_enabled && user.mfa_secret && validTotpCounter(decrypt(user.mfa_secret), input.code, Number(user.mfa_last_counter)) !== null, 422, 'MFA_INVALID', 'The verification code is invalid.');
    await client.query("UPDATE users SET mfa_enabled=false,mfa_method='totp',mfa_secret=NULL,mfa_pending_secret=NULL,mfa_pending_method=NULL,mfa_pending_expires_at=NULL,mfa_last_counter=-1,recovery_hashes='[]' WHERE id=$1", [user.id]);
    await client.query('UPDATE sessions SET mfa_verified=false WHERE id=$1', [session.sessionId]);
    await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2', [user.id,session.sessionId]);
    await client.query("UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose='mfa' AND consumed_at IS NULL", [user.id]);
    await audit(user.id, 'auth.mfa.disabled', 'user', user.id, {}, client); return { mfaEnabled: false };
  });
}
export async function regenerateRecoveryCodes(session: SessionContext, body: unknown) {
  const input=parse(z.object({password:z.string().min(1).max(128),code:z.string().regex(/^\d{6}$/)}).strict(),body);
  assert(session.actor.mfaVerified,403,'MFA_REQUIRED','Complete two-factor sign-in before replacing recovery codes.');
  await rateLimit('mfa-recovery-codes:'+session.actor.id,5,900);
  const observed=await currentSessionUser(session,undefined,true);
  assert(await passwordMatches(input.password,observed.password_hash),401,'INVALID_CREDENTIALS','The current password is incorrect.');
  return transaction(async client=>{
    await client.query('SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE');
    const user=await currentSessionUser(session,client,true);
    assert(user.mfa_method === 'totp' && user.mfa_secret,403,'MFA_REQUIRED','Recovery codes are available only for authenticator-app MFA.');
    samePasswordProof(user,observed);
    const counter=validTotpCounter(decrypt(user.mfa_secret),input.code,Number(user.mfa_last_counter));
    assert(counter!==null,422,'MFA_INVALID','Use a fresh authenticator code that has not already been used.');
    const recoveryCodes=Array.from({length:10},()=>token(12).toLowerCase());
    await client.query("UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose='mfa' AND consumed_at IS NULL",[user.id]);
    await client.query('UPDATE users SET recovery_hashes=$2::jsonb,mfa_last_counter=$3,updated_at=now() WHERE id=$1',[user.id,JSON.stringify(recoveryCodes.map(code=>hash(code))),counter]);
    await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL',[user.id,session.sessionId]);
    await audit(user.id,'auth.mfa.recovery_codes.regenerated','user',user.id,{count:recoveryCodes.length},client);
    return{recoveryCodes};
  });
}
export async function security(session: SessionContext) {
  const user = await currentSessionUser(session);
  const sessions = (await query('SELECT id,user_agent,created_at,last_seen_at,expires_at FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC', [session.actor.id])).rows;
  return { mfaEnabled: user.mfa_enabled, mfaMethod: user.mfa_method, emailVerified: user.email_verified===true, methods:{totp:{available:true},email:{available:!user.email_placeholder&&user.email_verified},sms:{available:!!user.phone_number&&!!user.phone_verified_at}}, sessions: sessions.map(row=>({id:row.id,userAgent:row.user_agent,createdAt:row.created_at,lastSeenAt:row.last_seen_at,expiresAt:row.expires_at,current:row.id===session.sessionId})) };
}
function normalizePhone(value:string){const phone=value.trim().replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[\s().-]/g,'');const normalized=/^09\d{9}$/.test(phone)?'+98'+phone.slice(1):/^989\d{9}$/.test(phone)?'+'+phone:phone.startsWith('00')?'+'+phone.slice(2):phone;assert(/^\+[1-9]\d{9,14}$/.test(normalized),422,'PHONE_INVALID','Enter a valid mobile number.');return normalized;}
const phoneVerificationDigest=(challenge:string,code:string)=>hash('phone-verification-v1:'+challenge+':'+code);
export async function requestPhoneVerification(session:SessionContext,body:unknown){
  const input=parse(z.object({phone:z.string().min(6).max(40),locale:z.enum(['fa','en','tr','ar','ru']).default('fa')}).strict(),body);const phone=normalizePhone(input.phone);
  await rateLimit('phone-verify-user:'+session.actor.id,5,900);
  const raw=token(),challengeHash=hash(raw),code=String(randomInt(0,1_000_000)).padStart(6,'0');
  return transaction(async client=>{const user=await currentSessionUser(session,client);const existing=(await client.query('SELECT id FROM users WHERE phone_number=$1 AND id<>$2',[phone,user.id])).rows[0];assert(!existing,409,'PHONE_IN_USE','This mobile number is already associated with another account.');await client.query('UPDATE phone_verification_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL',[user.id]);await client.query("INSERT INTO phone_verification_challenges(challenge_hash,user_id,phone_encrypted,code_hash,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '5 minutes')",[challengeHash,user.id,encrypt(phone),phoneVerificationDigest(challengeHash,code)]);const payload={to:phone,locale:input.locale,title:'Ideal Makoo',body:code,purpose:'phone-verification',phoneVerification:challengeHash,otp:true,code};await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id) VALUES($1,'sms',$2::jsonb,$3,$4)",[randomUUID(),JSON.stringify({encrypted:encrypt(JSON.stringify(payload))}),'phone-verification:'+challengeHash,user.id]);await audit(user.id,'auth.phone.verification_requested','user',user.id,{},client);return{challengeToken:raw,expiresIn:300,delivery:'queued'};});
}
export async function confirmPhoneVerification(session:SessionContext,body:unknown){const input=parse(z.object({challengeToken:z.string().min(20).max(100),code:z.string().regex(/^\d{6}$/)}).strict(),body);await rateLimit('phone-verify-confirm:'+session.actor.id,10,900);return transaction(async client=>{const user=await currentSessionUser(session,client);const challengeHash=hash(input.challengeToken);const row=(await client.query('SELECT * FROM phone_verification_challenges WHERE challenge_hash=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE',[challengeHash,user.id])).rows[0];assert(row&&row.attempts<5,422,'PHONE_CODE_INVALID','The verification code is invalid or expired.');await client.query('UPDATE phone_verification_challenges SET attempts=attempts+1 WHERE challenge_hash=$1',[challengeHash]);assert(equal(row.code_hash,phoneVerificationDigest(challengeHash,input.code)),422,'PHONE_CODE_INVALID','The verification code is invalid or expired.');const phone=decrypt(row.phone_encrypted);const existing=(await client.query('SELECT id FROM users WHERE phone_number=$1 AND id<>$2',[phone,user.id])).rows[0];assert(!existing,409,'PHONE_IN_USE','This mobile number is already associated with another account.');await client.query('UPDATE phone_verification_challenges SET consumed_at=clock_timestamp() WHERE challenge_hash=$1',[challengeHash]);await client.query('UPDATE users SET phone_number=$2,phone_verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1',[user.id,phone]);await audit(user.id,'auth.phone.verified','user',user.id,{},client);return{ok:true,phone};});}
export async function canDeliverPhoneVerification(client:PoolClient,payload:Record<string,unknown>,channel:string){if(channel!=='sms'||typeof payload.phoneVerification!=='string'||typeof payload.code!=='string')return false;const row=(await client.query('SELECT phone_encrypted,code_hash FROM phone_verification_challenges WHERE challenge_hash=$1 AND consumed_at IS NULL AND attempts<5 AND expires_at>clock_timestamp()',[payload.phoneVerification])).rows[0];return!!row&&decrypt(row.phone_encrypted)===payload.to&&equal(row.code_hash,phoneVerificationDigest(String(payload.phoneVerification),String(payload.code)));}
export async function revokeSession(session: SessionContext, id: string) {
  const result = await query('UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 RETURNING id', [id,session.actor.id]);
  assert(result.rowCount, 404, 'NOT_FOUND', 'Session not found.'); await audit(session.actor.id,'auth.session.revoked','session',id); return {ok:true};
}
export async function changePassword(session: SessionContext, body: unknown) {
  const input = parse(z.object({currentPassword:z.string().min(1).max(128),password:passwordSchema}).strict(),body);
  await rateLimit('password-change:'+session.actor.id,5,900);
  const observed=await currentSessionUser(session);
  assert(await passwordMatches(input.currentPassword,observed.password_hash),401,'INVALID_CREDENTIALS','The current password is incorrect.');
  const encoded=await passwordHash(input.password);
  await transaction(async client=>{
    const user=await currentSessionUser(session,client);
    samePasswordProof(user,observed);
    await client.query('UPDATE users SET password_hash=$2,mfa_pending_secret=NULL,mfa_pending_method=NULL,mfa_pending_expires_at=NULL,updated_at=now() WHERE id=$1',[user.id,encoded]);
    await consumePasswordProofs(client,user.id);
    await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2',[user.id,session.sessionId]);
    await audit(user.id,'auth.password.changed','user',user.id,{},client);
  });
  return {ok:true};
}
export async function forgotPassword(request: Request, body: unknown) {
  const input=parse(z.object({email:emailSchema,locale:z.enum(['fa','en','tr','ar','ru']).default('fa')}).strict(),body);await rateLimit('reset-ip:'+visitorKey(request),10,3600);await rateLimit('reset-email:'+hash(input.email),3,3600);
  const user=(await query<UserRow>('SELECT * FROM users WHERE email=$1 AND active',[input.email])).rows[0];
  if(user){const raw=token();await transaction(async client=>{
    const locked=(await client.query('SELECT id,email FROM users WHERE id=$1 AND active FOR UPDATE',[user.id])).rows[0];
    // A login-address correction may commit after the initial lookup. Never
    // issue a fresh credential proof to the former address from that snapshot.
    if(!locked||locked.email!==input.email)return;
    await client.query("UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose='password_reset' AND consumed_at IS NULL",[user.id]);
    await client.query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'password_reset',now()+interval '30 minutes')",[hash(raw),user.id]);
    const payload=encrypt(JSON.stringify({to:user.email,subject:'Ideal Makoo — password reset',text:`${config().siteUrl}/${input.locale}/auth/recover/?token=${encodeURIComponent(raw)}`}));
    const outboxId=randomUUID();
    await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id) VALUES($1,'email',$2::jsonb,$3,$4)",[outboxId,JSON.stringify({encrypted:payload}),'password-reset:'+hash(raw),user.id]);
    await bindNotificationTemplate(client,outboxId,{key:'password_reset',locale:input.locale,values:{actionUrl:`${config().siteUrl}/${input.locale}/auth/recover/?token=${encodeURIComponent(raw)}`}});
    await audit(user.id,'auth.password.reset_requested','user',user.id,{},client);
  });}
  return {ok:true,message:'If an active account exists, recovery instructions will be sent through the configured email service.'};
}
export async function resetPassword(body: unknown) {
  const input=parse(z.object({token:z.string().min(20).max(100),password:passwordSchema}).strict(),body);validatePassword(input.password);
  const candidate=(await query("SELECT user_id FROM auth_challenges WHERE token_hash=$1 AND purpose='password_reset' AND consumed_at IS NULL AND expires_at>now()",[hash(input.token)])).rows[0];assert(candidate,422,'RESET_EXPIRED','The recovery link is invalid or expired.');
  // Invalid tokens are rejected before expensive work; validity is checked again
  // under the user lock after hashing, never trusted from this initial read.
  const encoded=await passwordHash(input.password);
  return transaction(async client=>{
    const user=(await client.query('SELECT id FROM users WHERE id=$1 AND active FOR UPDATE',[candidate.user_id])).rows[0];assert(user,422,'RESET_EXPIRED','The recovery link is invalid or expired.');
    const challenge=(await client.query("SELECT * FROM auth_challenges WHERE token_hash=$1 AND user_id=$2 AND purpose='password_reset' AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE",[hash(input.token),candidate.user_id])).rows[0];
    assert(challenge,422,'RESET_EXPIRED','The recovery link is invalid or expired.');
    await client.query('UPDATE users SET password_hash=$2,failed_logins=0,locked_until=NULL,mfa_pending_secret=NULL,mfa_pending_method=NULL,mfa_pending_expires_at=NULL,updated_at=now() WHERE id=$1',[challenge.user_id,encoded]);
    await consumePasswordProofs(client,challenge.user_id);
    await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[challenge.user_id]);
    await audit(challenge.user_id,'auth.password.reset','user',challenge.user_id,{},client);return {ok:true};
  });
}

export async function requestEmailVerification(session:SessionContext,body:unknown){
  const input=parse(z.object({locale:z.enum(['fa','en','tr','ar','ru']).default('fa')}).strict(),body);await rateLimit('email-verify:'+session.actor.id,3,3600);
  return transaction(async client=>{const user=await currentSessionUser(session,client);assert(!user.email_placeholder,409,'EMAIL_REQUIRED','This mobile account needs a real account email before email verification can begin.');if(user.email_verified)return{ok:true,emailVerified:true};
    const raw=token();const digest=hash(raw+'\0'+user.email);await client.query("UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose='email_verify' AND consumed_at IS NULL",[user.id]);
    await client.query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'email_verify',now()+interval '24 hours')",[digest,user.id]);
    const payload=encrypt(JSON.stringify({to:user.email,subject:'Ideal Makoo — verify your email',text:`Open this link while signed in to your account and confirm your email: ${config().siteUrl}/${input.locale}/account/security/?verify=${encodeURIComponent(raw)}`}));
    const outboxId=randomUUID();
    await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id) VALUES($1,'email',$2::jsonb,$3,$4)",[outboxId,JSON.stringify({encrypted:payload}),'email-verify:'+digest,user.id]);
    await bindNotificationTemplate(client,outboxId,{key:'email_verification',locale:input.locale,values:{actionUrl:`${config().siteUrl}/${input.locale}/account/security/?verify=${encodeURIComponent(raw)}`}});
    await audit(user.id,'auth.email.verification_requested','user',user.id,{},client);return{ok:true,emailVerified:false,status:'pending',message:'Verification instructions were queued for the configured email service.'};
  });
}
export async function confirmEmailVerification(session:SessionContext,body:unknown){
  const input=parse(z.object({token:z.string().min(20).max(100)}).strict(),body);await rateLimit('email-verify-confirm:'+session.actor.id,10,900);
  return transaction(async client=>{const user=await currentSessionUser(session,client);
    const digest=hash(input.token+'\0'+user.email);const challenge=(await client.query("SELECT token_hash FROM auth_challenges WHERE token_hash=$1 AND user_id=$2 AND purpose='email_verify' AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE",[digest,user.id])).rows[0];assert(challenge,422,'VERIFY_EXPIRED','The verification link is invalid, expired, or belongs to another account.');
    await client.query('UPDATE users SET email_verified=true,updated_at=now() WHERE id=$1',[user.id]);await client.query("UPDATE auth_challenges SET consumed_at=now() WHERE user_id=$1 AND purpose='email_verify' AND consumed_at IS NULL",[user.id]);await audit(user.id,'auth.email.verified','user',user.id,{},client);return{ok:true,emailVerified:true};
  });
}
