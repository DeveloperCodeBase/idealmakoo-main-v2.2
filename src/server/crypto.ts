import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { config } from './config';
import { assert, HttpError } from './types';

const scrypt = (password:string,salt:Buffer,length:number,options:{N:number;r:number;p:number;maxmem:number}) => new Promise<Buffer>((resolve,reject)=>scryptCallback(password,salt,length,options,(error,key)=>error?reject(error):resolve(key)));
// Two jobs leave capacity in Node's default shared worker pool for unrelated
// filesystem/crypto work. Admission is bounded; a busy service must not queue an
// unbounded number of attacker-controlled passwords or lower the KDF cost.
const passwordWorkLimit = 2;
const passwordWorkQueueLimit = 16;
const passwordWorkWaitMs = 2000;
let activePasswordWork = 0;
type PasswordWaiter = { resolve: (release: () => void) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const passwordWaiters: PasswordWaiter[] = [];
const passwordBusy = () => new HttpError(503, 'AUTH_BUSY', 'Authentication is busy. Please try again shortly.');
function releasePasswordWork() {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = passwordWaiters.shift();
    if (next) { clearTimeout(next.timer); next.resolve(releasePasswordWork()); }
    else activePasswordWork--;
  };
}
function acquirePasswordWork(): Promise<() => void> {
  if (activePasswordWork < passwordWorkLimit) { activePasswordWork++; return Promise.resolve(releasePasswordWork()); }
  if (passwordWaiters.length >= passwordWorkQueueLimit) return Promise.reject(passwordBusy());
  return new Promise((resolve, reject) => {
    const waiter: PasswordWaiter = { resolve, reject, timer: setTimeout(() => {
      const index = passwordWaiters.indexOf(waiter);
      if (index >= 0) { passwordWaiters.splice(index, 1); reject(passwordBusy()); }
    }, passwordWorkWaitMs) };
    passwordWaiters.push(waiter);
  });
}
async function passwordWork<T>(run: () => Promise<T>): Promise<T> {
  const release = await acquirePasswordWork();
  try { return await run(); } finally { release(); }
}
const passwordSaltBytes = 16;
const passwordKeyBytes = 64;
const dummyPasswordSalt = Buffer.alloc(passwordSaltBytes);
const dummyPasswordKey = Buffer.alloc(passwordKeyBytes);
function derivePassword(password: string, salt: Buffer, p: 1 | 2 | 3) {
  return scrypt(password, salt, passwordKeyBytes, { N: 32768, r: 8, p, maxmem: 128 * 1024 * 1024 });
}
function parsePasswordHash(encoded: string) {
  // Only formats this application has actually written are accepted. The exact
  // length also excludes trailing-newline matches allowed by RegExp's `$`.
  if (typeof encoded !== 'string' || encoded.length !== 178) return null;
  const match = /^scrypt\$32768\$8\$(1|3)\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(encoded);
  return match ? { p: Number(match[1]) as 1 | 3, salt: Buffer.from(match[2], 'hex'), key: Buffer.from(match[3], 'hex') } : null;
}
export function passwordNeedsUpgrade(encoded: string) { return parsePasswordHash(encoded)?.p === 1; }
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function equal(a: string, b: string) { const first = Buffer.from(a); const second = Buffer.from(b); return first.length === second.length && timingSafeEqual(first, second); }
export function validatePassword(value: unknown): asserts value is string {
  assert(typeof value === 'string' && value.length >= 12 && value.length <= 128, 422, 'PASSWORD_POLICY', 'Use a password containing 12 to 128 characters.');
}
export async function passwordHash(password: string) {
  validatePassword(password); const salt = randomBytes(16);
  const key = await passwordWork(() => derivePassword(password, salt, 3));
  return `scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function passwordMatches(password: string, encoded: string) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const parsed = parsePasswordHash(encoded);
  return passwordWork(async () => {
    const key = await derivePassword(password, parsed?.salt || dummyPasswordSalt, parsed?.p || 3);
    // Match the current profile's total work for legacy failed-password checks.
    // This removes the obvious p1/p3 split; it is not a constant-time guarantee.
    if (parsed?.p === 1) await derivePassword(password, dummyPasswordSalt, 2);
    const matches = timingSafeEqual(key, parsed?.key || dummyPasswordKey);
    return !!parsed && matches;
  });
}
export function encrypt(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', config().encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function decrypt(value: string) {
  const [iv, tag, encrypted] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', config().encryptionKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}
export function signGuest(value: string) { return value + '.' + createHmac('sha256', config().sessionSecret).update('csrf:' + value).digest('base64url'); }
export function verifyGuest(value?: string) {
  if (!value || value.length > 200) return false;
  const [random] = value.split('.'); return random.length >= 24 && equal(signGuest(random), value);
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  const bytes = randomBytes(20); let bits = ''; for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g)!.map(chunk => alphabet[parseInt(chunk.padEnd(5, '0'), 2)]).join('');
}
function decodeBase32(value: string) {
  const bits = [...value.toUpperCase().replace(/=+$/, '')].map(char => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) || []).map(chunk => parseInt(chunk, 2)));
}
export function totp(secret: string, counter: number) {
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest(); const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function validTotpCounter(secret: string, code: string, last = -1, time = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const counter = Math.floor(time / 30000);
  for (const delta of [0, -1, 1]) { const candidate = counter + delta; if (candidate > last && equal(totp(secret, candidate), code)) return candidate; }
  return null;
}

