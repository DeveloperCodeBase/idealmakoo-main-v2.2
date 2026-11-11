import { randomInt, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { encrypt, decrypt, equal, hash } from './crypto';
import { assert } from './types';

export type MfaChannelMethod = 'email' | 'sms';
type User = { id: string; email: string; email_verified: boolean; email_placeholder?: boolean; phone_number?: string | null; phone_verified_at?: Date | null };
const minutes = 5;
const codeDigest = (challengeHash: string, code: string) => hash('mfa-channel-v1:' + challengeHash + ':' + code);
function destination(user: User, method: MfaChannelMethod) {
  if (method === 'email') { assert(!user.email_placeholder && user.email_verified, 409, 'MFA_EMAIL_UNVERIFIED', 'Verify the account email before selecting email MFA.'); return user.email; }
  const phone = user.phone_number;
  assert(typeof phone === 'string' && !!user.phone_verified_at, 409, 'MFA_PHONE_UNVERIFIED', 'Verify a mobile number before selecting SMS MFA.'); return phone;
}
export async function issueMfaChannel(client: PoolClient, user: User, method: MfaChannelMethod, purpose: 'enroll' | 'login', rawChallenge: string) {
  const to = destination(user, method), challengeHash = hash(rawChallenge), code = String(randomInt(0, 1000000)).padStart(6, '0');
  await client.query("UPDATE mfa_channel_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL", [user.id, purpose]);
  await client.query("INSERT INTO mfa_channel_challenges(challenge_hash,user_id,method,purpose,destination_encrypted,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')", [challengeHash, user.id, method, purpose, encrypt(to), codeDigest(challengeHash, code)]);
  const payload = method === 'email' ? { to, subject: 'Ideal Makoo — verification code', text: `Your Ideal Makoo verification code is ${code}. It expires in ${minutes} minutes.`, mfaOtp: challengeHash, code, method } : { to, locale: 'fa', title: 'Ideal Makoo', body: code, purpose: 'mfa-otp', mfaOtp: challengeHash, otp: true, code, method };
  await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id) VALUES($1,$2,$3::jsonb,$4,$5)", [randomUUID(), method === 'email' ? 'email' : 'sms', JSON.stringify({ encrypted: encrypt(JSON.stringify(payload)) }), 'mfa:' + purpose + ':' + challengeHash, user.id]);
  return { expiresIn: minutes * 60, delivery: 'queued' as const };
}
export async function consumeMfaChannel(client: PoolClient, userId: string, method: MfaChannelMethod, purpose: 'enroll' | 'login', rawChallenge: string, code: string) {
  const challengeHash = hash(rawChallenge);
  const row = (await client.query("SELECT * FROM mfa_channel_challenges WHERE challenge_hash=$1 AND user_id=$2 AND method=$3 AND purpose=$4 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE", [challengeHash, userId, method, purpose])).rows[0];
  if (!row || row.attempts >= 5) return false;
  await client.query('UPDATE mfa_channel_challenges SET attempts=attempts+1 WHERE challenge_hash=$1', [challengeHash]);
  if (!equal(row.code_hash, codeDigest(challengeHash, code))) return false;
  await client.query('UPDATE mfa_channel_challenges SET consumed_at=clock_timestamp() WHERE challenge_hash=$1', [challengeHash]);
  return true;
}
export async function canDeliverMfaOtp(client: PoolClient, payload: Record<string, unknown>, channel: string) {
  if ((channel !== 'sms' && channel !== 'email') || typeof payload.mfaOtp !== 'string' || typeof payload.code !== 'string' || payload.method !== channel) return false;
  const row = (await client.query("SELECT destination_encrypted,code_hash FROM mfa_channel_challenges WHERE challenge_hash=$1 AND method=$2 AND consumed_at IS NULL AND attempts<5 AND expires_at>clock_timestamp()", [payload.mfaOtp, channel])).rows[0];
  return !!row && decrypt(row.destination_encrypted) === payload.to && equal(row.code_hash, codeDigest(String(payload.mfaOtp), String(payload.code)));
}
