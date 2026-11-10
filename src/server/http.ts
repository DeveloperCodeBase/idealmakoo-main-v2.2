import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import { config } from './config';
import { query } from './db';
import { hash, equal, verifyGuest } from './crypto';
import { HttpError, assert } from './types';
import type { SessionContext } from './auth';

export function cookies(request: Request): Record<string, string> {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(part => {
    const index = part.indexOf('='); if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(([key]) => /^[a-zA-Z0-9_-]+$/.test(key)));
}
export function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config().secureCookies ? '; Secure' : ''}`;
}
export function json(value: unknown, status = 200, headers?: HeadersInit) {
  const output = new Headers(headers); if(!output.has('Content-Type'))output.set('Content-Type', 'application/json; charset=utf-8');
  if(!output.has('Cache-Control'))output.set('Cache-Control', 'private, no-store'); output.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(value), { status, headers: output });
}
export function failure(error: unknown, requestId = randomUUID()) {
  const known = error instanceof HttpError;
  const status = known ? error.status : 500;
  if (!known) console.error(JSON.stringify({ level: 'error', event: 'request_failed', requestId, code: (error as {code?:string})?.code || 'INTERNAL_ERROR' }));
  const body = { type: 'https://idealmako.ir/problems/' + (known ? error.code.toLowerCase() : 'internal-error'),
    title: known ? error.code : 'INTERNAL_ERROR', status, code: known ? error.code : 'INTERNAL_ERROR',
    detail: known ? error.message : 'The request could not be completed. Please retry.', requestId,
    error: { code: known ? error.code : 'INTERNAL_ERROR' }, ...(known && error.details ? { errors: error.details } : {}) };
  return json(body, status, { 'Content-Type': 'application/problem+json', 'X-Request-ID': requestId, ...(status === 429 ? {'Retry-After':'60'} : {}) });
}
export async function readJson(request: Request, maxBytes = 1024 * 1024): Promise<unknown> {
  assert(request.headers.get('content-type')?.split(';')[0] === 'application/json', 415, 'CONTENT_TYPE', 'Use application/json.');
  const length = Number(request.headers.get('content-length') || 0);
  assert(length <= maxBytes, 413, 'BODY_TOO_LARGE', 'The request body is too large.');
  assert(request.body, 400, 'JSON_REQUIRED', 'A JSON body is required.');
  const reader = request.body.getReader(); const buffers: Uint8Array[] = []; let size = 0;
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, 'BODY_TOO_LARGE', 'The request body is too large.'); } buffers.push(chunk.value); }
  let result: unknown; try { result = JSON.parse(Buffer.concat(buffers).toString('utf8')); } catch { throw new HttpError(400, 'INVALID_JSON', 'The JSON body is invalid.'); }
  rejectUnsafeKeys(result); return result;
}
export function rejectUnsafeKeys(value: unknown, depth = 0): void {
  assert(depth <= 32, 422, 'JSON_DEPTH', 'Nested data is too deep.');
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    assert(!['__proto__', 'constructor', 'prototype'].includes(key), 422, 'INVALID_FIELD', 'Unsafe field name.'); rejectUnsafeKeys(item, depth + 1);
  }
}
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value); if (!result.success) throw new HttpError(422, 'VALIDATION', 'Check the submitted fields.', result.error.issues.map(issue => ({path:issue.path.join('.'),message:issue.message})));
  return result.data;
}
export function csrf(request: Request, session: SessionContext | null) {
  assert(request.headers.get('origin') === config().siteUrl, 403, 'ORIGIN', 'The request origin is not permitted.');
  assert(request.headers.get('sec-fetch-site') !== 'cross-site', 403, 'CSRF', 'Cross-site requests are not permitted.');
  const supplied = request.headers.get('x-csrf-token') || '';
  if (session) assert(equal(supplied, session.csrfToken), 403, 'CSRF', 'Refresh this page before trying again.');
  else { const saved = cookies(request).im_guest_csrf; assert(verifyGuest(saved) && equal(supplied, saved), 403, 'CSRF', 'Refresh this page before trying again.'); }
}
export function visitorKey(request: Request) {
  const value = config().trustProxy ? (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim() : 'direct';
  return hash(config().sessionSecret + ':ip:' + value);
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const result = await query<{count:number}>(`INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,now()+($2*interval '1 second'))
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<=now() THEN 1 ELSE rate_limits.count+1 END,
    reset_at=CASE WHEN rate_limits.reset_at<=now() THEN now()+($2*interval '1 second') ELSE rate_limits.reset_at END RETURNING count`, [hash(key), seconds]);
  assert(result.rows[0].count <= limit, 429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
}
export function expectedVersion(request: Request, body?: {expectedVersion?: unknown}) {
  const raw = request.headers.get('if-match')?.replace(/^"|"$/g, '') ?? body?.expectedVersion;
  assert(raw !== undefined && raw !== null && raw !== '', 428, 'PRECONDITION_REQUIRED', 'Send the current revision in If-Match.');
  const version = Number(raw); assert(Number.isSafeInteger(version) && version >= 0, 422, 'VERSION', 'Invalid revision.'); return version;
}
