import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { handleRequest } from '../src/server/router';
import { closeDb, query } from '../src/server/db';
import { decrypt, encrypt, hash, newTotpSecret, passwordHash, totp } from '../src/server/crypto';
import type { RoleKey } from '../src/types/domain';
import type { FrontRequest, SharedQuote } from '../src/types/frontend';
import type { WorkspaceState, WorkspaceRecord } from '../src/data/workspace-seed';
import { recordText } from '../src/data/workspace-seed';
import { products } from '../src/data/catalog';
import { calculateCommercial, type CommercialLine } from '../src/components/workspace/crm-tools-logic';
import { deliverOutbox } from '../src/server/notifications';
import { initializePrivacyLedger } from '../src/server/privacy';

const origin = 'https://api-integration.idealmakoo.invalid';
const password = 'Integration-only-password#2026';
type JsonObject = Record<string, unknown>;
interface ApiResult<T = JsonObject> { response: Response; data: T }

/** In-process HTTP client with an isolated cookie jar; no real external service is contacted. */
class ApiClient {
  readonly cookies = new Map<string, string>();
  csrfToken = '';
  userId = '';

  async call<T = JsonObject>(path: string, method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ApiResult<T>> {
    const headers = new Headers({ origin, 'sec-fetch-site': 'same-origin', 'user-agent': 'IdealMakoo integration test' });
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    if (!['GET', 'HEAD'].includes(method)) headers.set('x-csrf-token', this.csrfToken);
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers.set('content-type', 'application/json'); payload = JSON.stringify(body); }
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    const request = new Request(`${origin}/api/v1/${path}`, { method, headers, body: payload });
    const parts = new URL(request.url).pathname.slice('/api/v1/'.length).split('/').filter(Boolean);
    const response = await handleRequest(request, parts);
    for (const entry of response.headers.getSetCookie()) {
      const pair = entry.split(';', 1)[0], position = pair.indexOf('='), name = pair.slice(0, position), value = pair.slice(position + 1);
      if (/Max-Age=0(?:;|$)/i.test(entry)) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    const data = response.headers.get('content-type')?.includes('json') ? await response.clone().json() as JsonObject : {};
    if (typeof data.csrfToken === 'string') this.csrfToken = data.csrfToken;
    if (data.user && typeof data.user === 'object' && typeof (data.user as JsonObject).id === 'string') this.userId = String((data.user as JsonObject).id);
    return { response, data: data as T };
  }

  async ready() { await this.call('auth/session'); return this; }
}

function success<T>(result: ApiResult<T>, status = 200): T {
  expect(result.response.status, JSON.stringify(result.data)).toBe(status);
  return result.data;
}
function problem(result: ApiResult, status: number, code?: string) {
  expect(result.response.status, JSON.stringify(result.data)).toBe(status);
  expect(result.response.headers.get('content-type')).toContain('application/problem+json');
  expect(result.data.status).toBe(status);
  if (code) expect(result.data.code).toBe(code);
  expect(result.response.headers.get('x-request-id')).toBeTruthy();
}
const formInput = (overrides: JsonObject = {}) => ({ kind: 'rfq', name: 'Test customer', email: 'customer@example.invalid', organization: 'Test laboratory', message: 'Please send an approved commercial quotation.', productIds: [products[0].id], locale: 'en', consent: { purpose: 'request_processing', acceptedAt: new Date().toISOString() }, ...overrides });
const workspace = async (client: ApiClient) => success(await client.call<{state: WorkspaceState; version: number}>('workspace'));

describe('Production HTTP contract against isolated PostgreSQL', () => {
  let control: pg.Client | undefined, schema = '', storage = '', ledger = '', encodedPassword = '';
  const savedEnv = new Map<string, string | undefined>();
  let alice: ApiClient, bob: ApiClient, business: ApiClient, admin: ApiClient, scientist: ApiClient, scopedScientist: ApiClient;
  let requestId = '', issuedQuoteId = '', sharedAssetId = '', sharedAssetRequestId = '', organizationId = '';

  beforeAll(async () => {
    const database = process.env.TEST_ADMIN_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;
    if (!database) throw new Error('PostgreSQL integration tests require TEST_ADMIN_DATABASE_URL (schema-create rights), MIGRATION_DATABASE_URL, or TEST_DATABASE_URL. This suite never reports skipped security checks as successful verification.');
    for (const name of ['DATABASE_URL', 'SITE_URL', 'SESSION_SECRET', 'MFA_ENCRYPTION_KEY', 'STORAGE_DIR', 'PRIVACY_LEDGER_DIR', 'TRUST_PROXY', 'DEMO_MODE', 'NEXT_PUBLIC_DEMO_MODE', 'OPENROUTER_API_KEY', 'SMTP_HOST', 'MAIL_HOST', 'NOTIFICATIONS_MODE', 'STAFF_PROVISIONING_MODE']) savedEnv.set(name, process.env[name]);
    storage = await mkdtemp(join(tmpdir(), 'idealmakoo-api-test-'));
    ledger = await mkdtemp(join(tmpdir(), 'idealmakoo-api-ledger-'));
    process.env.PRIVACY_LEDGER_DIR = ledger;
    process.env.SITE_URL = origin; process.env.SESSION_SECRET = randomBytes(48).toString('hex'); process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('hex'); process.env.STORAGE_DIR = storage; process.env.TRUST_PROXY = 'false';
    delete process.env.DEMO_MODE; delete process.env.NEXT_PUBLIC_DEMO_MODE; delete process.env.OPENROUTER_API_KEY; delete process.env.SMTP_HOST; delete process.env.MAIL_HOST;
    process.env.NOTIFICATIONS_MODE = 'disabled';
    // This suite exercises panel-role rejection; env-managed grants have dedicated PostgreSQL regressions.
    process.env.STAFF_PROVISIONING_MODE = 'panel';
    schema = `api_test_${randomUUID().replaceAll('-', '')}`;
    control = new pg.Client({ connectionString: database }); await control.connect(); await control.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(database); scoped.searchParams.set('options', `-c search_path=${schema}`); await closeDb(); process.env.DATABASE_URL = scoped.toString();
    const migration = new pg.Client({ connectionString: scoped.toString() });
    await migration.connect();
    try { for (const file of (await readdir(new URL('../db/migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await migration.query(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8')); }
    finally { await migration.end(); }
    await initializePrivacyLedger();
    encodedPassword = await passwordHash(password);
    alice = await new ApiClient().ready(); bob = await new ApiClient().ready();
    success(await alice.call('auth/register', 'POST', { name: 'Alice Customer', email: 'alice@example.invalid', password }), 201);
    success(await bob.call('auth/register', 'POST', { name: 'Bob Customer', email: 'bob@example.invalid', password }), 201);
    business = await staff('business', 'api-business'); admin = await staff('admin', 'api-admin'); scientist = await staff('scientificReviewer', 'api-scientist', true); scopedScientist = await staff('scientificReviewer', 'api-scientist-unscoped');
  });

  afterAll(async () => {
    await closeDb();
    if (control) { try { if (schema) await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await control.end(); } }
    if (storage) await rm(storage, { recursive: true, force: true });
    if (ledger) await rm(ledger, { recursive: true, force: true });
    for (const [name, value] of savedEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });

  async function staff(role: RoleKey, id: string, quality = false) {
    const secret = newTotpSecret();
    // Grant this test operator its explicitly required CRM scope. A role label
    // alone intentionally confers no access to unassigned customer records.
    await query("INSERT INTO users(id,name,email,password_hash,role,mfa_enabled,mfa_secret,quality_scope,crm_scope,crm_permissions) VALUES($1,$1,$2,$3,$4,true,$5,$6,'all',$7::jsonb)", [id, `${id}@example.invalid`, encodedPassword, role, encrypt(secret), quality, JSON.stringify({contact:true,financial:true,baseCost:false,assign:true,intake:true})]);
    const client = await new ApiClient().ready();
    const challenge = success(await client.call<{mfaRequired: boolean; challengeToken: string}>('auth/login', 'POST', { email: `${id}@example.invalid`, password })); expect(challenge.mfaRequired).toBe(true); expect(client.cookies.has('im_session')).toBe(false);
    success(await client.call('auth/mfa/verify', 'POST', { challengeToken: challenge.challengeToken, code: totp(secret, Math.floor(Date.now() / 30_000)) }));
    return client;
  }

  test('session cookies are secure and only token digests are persisted', async () => {
    const client = await new ApiClient().ready();
    const result = await client.call('auth/login', 'POST', { email: 'alice@example.invalid', password }); success(result);
    const cookie = result.response.headers.get('set-cookie')!; expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax'); expect(cookie).toContain('Secure');
    const raw = client.cookies.get('im_session')!;
    const stored = (await query<{token_hash: string}>('SELECT token_hash FROM sessions WHERE user_id=$1 AND token_hash=$2', [alice.userId, hash(raw)])).rows[0]; expect(stored.token_hash).not.toBe(raw); expect(stored.token_hash).toHaveLength(64);
    const session = success(await client.call<{user: JsonObject}>('auth/session')); expect(session.user.role).toBe('customer'); expect(JSON.stringify(session)).not.toContain('password_hash');
    success(await client.call('auth/logout', 'POST', {})); client.cookies.set('im_session', raw); problem(await client.call('me/settings'), 401, 'SESSION_REQUIRED');
  });

  test('CSRF, exact Origin and Fetch Metadata gates reject requests before mutation', async () => {
    problem(await alice.call('me/profile', 'PATCH', { name: 'Rejected name' }, { 'if-match': '0', 'x-csrf-token': '' }), 403, 'CSRF');
    problem(await alice.call('me/profile', 'PATCH', { name: 'Rejected name' }, { 'if-match': '0', origin: 'https://attacker.invalid' }), 403, 'ORIGIN');
    problem(await alice.call('me/profile', 'PATCH', { name: 'Rejected name' }, { 'if-match': '0', 'sec-fetch-site': 'cross-site' }), 403, 'CSRF');
    const unsigned = new ApiClient(); unsigned.csrfToken = 'forged'; unsigned.cookies.set('im_guest_csrf', 'forged'); problem(await unsigned.call('auth/register', 'POST', { name: 'Forged User', email: 'forged@example.invalid', password }), 403, 'CSRF');
    expect((await query('SELECT id FROM users WHERE email=$1', ['forged@example.invalid'])).rowCount).toBe(0);
  });

  test('registration and profile mass assignment cannot create staff privileges', async () => {
    const visitor = await new ApiClient().ready(); problem(await visitor.call('auth/register', 'POST', { name: 'Role Injection', email: 'injected@example.invalid', password, role: 'superAdmin' }), 422, 'VALIDATION');
    problem(await alice.call('me/profile', 'PATCH', { role: 'superAdmin' }, { 'if-match': '0' }), 422, 'VALIDATION');
    problem(await alice.call('users', 'POST', { name: 'Injected Staff', email: 'staff-injected@example.invalid', role: 'superAdmin', password }), 403, 'FORBIDDEN');
    problem(await admin.call(`users/${alice.userId}`, 'PATCH', { role: 'superAdmin' }), 403, 'ROLE_ESCALATION');
    problem(await admin.call('users', 'POST', { name: 'Privileged Staff', email: 'privileged@example.invalid', role: 'business', password }), 403, 'ROLE_ESCALATION');
    expect((await query<{role: string}>('SELECT role FROM users WHERE id=$1', [alice.userId])).rows[0].role).toBe('customer');
  });

  test('staff must complete MFA enrollment and reused OTP challenges are rejected', async () => {
    const id = 'api-first-login'; await query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$1,$2,$3,$4)', [id, `${id}@example.invalid`, encodedPassword, 'contentEditor']);
    const client = await new ApiClient().ready(); const login = success(await client.call<{mfaEnrollmentRequired: boolean}>('auth/login', 'POST', { email: `${id}@example.invalid`, password })); expect(login.mfaEnrollmentRequired).toBe(true);
    problem(await client.call('workspace'), 403, 'MFA_REQUIRED');
    const enrollment = success(await client.call<{secret: string}>('auth/mfa/enroll', 'POST', { password }));
    const confirmed = success(await client.call<{recoveryCodes: string[]}>('auth/mfa/confirm', 'POST', { code: totp(enrollment.secret, Math.floor(Date.now() / 30_000)) })); expect(confirmed.recoveryCodes).toHaveLength(10);
    success(await client.call('workspace')); problem(await client.call('auth/mfa/disable', 'POST', { password, code: '000000' }), 403, 'STAFF_MFA_REQUIRED');
    success(await client.call('auth/logout', 'POST', {})); await client.ready();
    const challenge = success(await client.call<{challengeToken: string}>('auth/login', 'POST', { email: `${id}@example.invalid`, password }));
    success(await client.call('auth/mfa/verify', 'POST', { challengeToken: challenge.challengeToken, code: confirmed.recoveryCodes[0] }));
    problem(await client.call('auth/mfa/verify', 'POST', { challengeToken: challenge.challengeToken, code: confirmed.recoveryCodes[0] }), 401, 'MFA_INVALID');
    expect((await query<{recovery_hashes: string[]}>('SELECT recovery_hashes FROM users WHERE id=$1', [id])).rows[0].recovery_hashes).toHaveLength(9);
  });

  test('staff role restrictions and last-administrator protection survive API bypasses', async () => {
    const senior = await staff('superAdmin', 'api-senior', true);
    problem(await senior.call('users/api-senior', 'DELETE'), 409, 'LAST_ADMIN');
    problem(await business.call('users'), 403, 'FORBIDDEN'); problem(await alice.call('workspace'), 403);
    const settings = success(await alice.call<{revision: number}>('me/settings')); problem(await alice.call('me/profile', 'PATCH', { name: 'No precondition' }), 428, 'PRECONDITION_REQUIRED');
    success(await alice.call('me/profile', 'PATCH', { name: 'Alice Updated' }, { 'if-match': String(settings.revision) })); problem(await alice.call('me/profile', 'PATCH', { name: 'Stale change' }, { 'if-match': String(settings.revision) }), 409, 'CONFLICT');
  });

  test('request idempotency is atomic under retry and conflicting bodies are rejected', async () => {
    const payload = formInput(), key = `request-${randomUUID()}`;
    const [first, replay] = await Promise.all([alice.call<FrontRequest>('requests', 'POST', payload, { 'idempotency-key': key }), alice.call<FrontRequest>('requests', 'POST', payload, { 'idempotency-key': key })]);
    const created = success(first, 201), repeated = success(replay, 201); requestId = created.id; expect(repeated.id).toBe(requestId); expect(created.ownerId).toBe(alice.userId);
    expect((await query('SELECT id FROM requests WHERE id=$1', [requestId])).rowCount).toBe(1);
    problem(await alice.call('requests', 'POST', { ...payload, message: 'Conflicting body' }, { 'idempotency-key': key }), 409, 'IDEMPOTENCY_CONFLICT');
    problem(await alice.call('requests', 'POST', payload), 422, 'IDEMPOTENCY_KEY');
    const consent = (await query<{accepted: boolean}>('SELECT accepted FROM consent_events WHERE request_id=$1', [requestId])).rows; expect(consent).toHaveLength(1); expect(consent[0].accepted).toBe(true);
  });

  test('one customer cannot read, edit, associate or discover another customer request', async () => {
    success(await alice.call(`requests/${requestId}`)); problem(await bob.call(`requests/${requestId}`), 404, 'NOT_FOUND');
    problem(await bob.call(`requests/${requestId}`, 'PATCH', { status: 'withdrawn' }, { 'if-match': '1' }), 404, 'NOT_FOUND');
    expect(success(await bob.call<FrontRequest[]>('requests')).some(row => row.id === requestId)).toBe(false);
    problem(await bob.call('me/portal', 'PATCH', { organizations: [{ id: 'stolen-organization', name: 'Stolen association', members: [], sharedRequestIds: [requestId] }] }), 403, 'OWNERSHIP');
    problem(await alice.call(`requests/${requestId}`, 'PATCH', { ownerId: bob.userId }, { 'if-match': '1' }), 422, 'REQUEST_ACTION');
    const stranger = await new ApiClient().ready(); problem(await stranger.call(`requests/${requestId}`), 404, 'NOT_FOUND');
  });

  test('request messages are append-only, scoped by visibility and versioned', async () => {
    const before = success(await alice.call<FrontRequest>(`requests/${requestId}`));
    problem(await alice.call(`requests/${requestId}`, 'PATCH', { status: 'withdrawn' }), 428, 'PRECONDITION_REQUIRED');
    const message = { id: 'client-reply', body: 'Additional customer requirement', visibility: 'public', createdAt: new Date().toISOString(), sender: 'Forged staff sender' };
    const updated = success(await alice.call<FrontRequest>(`requests/${requestId}`, 'PATCH', { messages: [...(before.messages || []), message] }, { 'if-match': String(before.version) }));
    expect(updated.messages?.at(-1)?.sender).toBe('Alice Updated'); expect(updated.messages?.at(-1)?.id).not.toBe(message.id);
    problem(await alice.call(`requests/${requestId}`, 'PATCH', { status: 'withdrawn' }, { 'if-match': String(before.version) }), 409, 'CONFLICT');
    problem(await alice.call(`requests/${requestId}`, 'PATCH', { messages: [] }, { 'if-match': String(updated.version) }), 422, 'REQUEST_ACTION');
    const staffView = success(await business.call<FrontRequest>(`requests/${requestId}`));
    success(await business.call(`requests/${requestId}`, 'PATCH', { messages: [...(staffView.messages || []), { id: 'private-note', body: 'Internal-only commercial review', visibility: 'internal', createdAt: new Date().toISOString(), sender: 'Spoofed' }] }, { 'if-match': String(staffView.version) }));
    const customerView = success(await alice.call<FrontRequest>(`requests/${requestId}`)); expect(JSON.stringify(customerView)).not.toContain('Internal-only commercial review'); expect(success(await business.call<FrontRequest>(`requests/${requestId}`)).messages?.some(row => row.visibility === 'internal')).toBe(true);
  });

  test('quality cases require explicit scope and scientific review receives a redacted DTO', async () => {
    const created = success(await alice.call<FrontRequest>('requests', 'POST', formInput({ kind: 'quality_complaint', batch: 'QUALITY-TEST-2026', phone: '+9800000000' }), { 'idempotency-key': `quality-${randomUUID()}` }), 201);
    problem(await business.call(`requests/${created.id}`), 404, 'NOT_FOUND'); problem(await scopedScientist.call(`requests/${created.id}`), 404, 'NOT_FOUND');
    const reviewed = success(await scientist.call<FrontRequest>(`requests/${created.id}`)); expect(reviewed.email).toBe(''); expect(reviewed.phone).toBe(''); expect(reviewed.organization).toBe(''); expect(reviewed.ownerId).toBe('redacted');
    problem(await scientist.call(`requests/${requestId}`), 404, 'NOT_FOUND');
    expect((await workspace(scopedScientist)).state.records.some(row => row.id === created.id)).toBe(false);
  });

  test('attachment ownership is enforced and pending scans fail closed', async () => {
    const form = new FormData(); form.set('file', new File(['%PDF-1.7\nIntegration quarantine fixture\n%%EOF'], 'private-document.pdf', { type: 'application/pdf' })); form.set('visibility', 'public');
    const asset = success(await alice.call<{id: string; visibility: string; scanStatus: string}>('attachments', 'POST', form), 201); expect(asset.visibility).toBe('private'); expect(asset.scanStatus).toBe('pending');
    problem(await alice.call(`attachments/${asset.id}`), 409, 'QUARANTINED'); problem(await bob.call(`attachments/${asset.id}`), 404, 'NOT_FOUND');
    problem(await admin.call(`media/${asset.id}`, 'DELETE'), 404, 'NOT_FOUND');
    expect((await query('SELECT id FROM assets WHERE id=$1 AND deleted_at IS NULL AND owner_id=$2', [asset.id, alice.userId])).rowCount).toBe(1);
    const count = Number((await query<{n: string}>('SELECT count(*) AS n FROM requests')).rows[0].n);
    problem(await bob.call('requests', 'POST', formInput({ attachmentIds: [asset.id] }), { 'idempotency-key': `stolen-asset-${randomUUID()}` }), 403, 'ATTACHMENT_OWNERSHIP');
    expect(Number((await query<{n: string}>('SELECT count(*) AS n FROM requests')).rows[0].n)).toBe(count);
    const attached = success(await alice.call<FrontRequest>('requests', 'POST', formInput({ attachmentIds: [asset.id] }), { 'idempotency-key': `own-asset-${randomUUID()}` }), 201); expect(attached.attachmentIds).toContain(asset.id);
    await query("UPDATE assets SET scan_status='blocked' WHERE id=$1", [asset.id]); problem(await alice.call(`attachments/${asset.id}`), 409, 'QUARANTINED');
    expect((await query("SELECT id FROM outbox WHERE kind='scan' AND payload->>'assetId'=$1", [asset.id])).rowCount).toBe(1);
  });

  test('uploaded images are decoded, converted and served with guarded range responses', async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#009cba' } }).png().toBuffer();
    const form = new FormData(); form.set('file', new File([new Uint8Array(bytes)], 'picture.png', { type: 'image/png' }));
    const asset = success(await alice.call<{id: string; scanStatus: string; mimeType: string}>('attachments', 'POST', form), 201); expect(asset.scanStatus).toBe('clean'); expect(asset.mimeType).toBe('image/webp');
    sharedAssetId = asset.id;
    sharedAssetRequestId = success(await alice.call<FrontRequest>('requests', 'POST', formInput({ attachmentIds: [asset.id] }), { 'idempotency-key': `shareable-image-${randomUUID()}` }), 201).id;
    const download = await alice.call(`attachments/${asset.id}`, 'GET', undefined, { range: 'bytes=0-11' }); expect(download.response.status).toBe(206); expect(download.response.headers.get('content-type')).toBe('image/webp'); expect(download.response.headers.get('content-security-policy')).toContain('sandbox'); expect((await download.response.arrayBuffer()).byteLength).toBe(12);
    expect((await alice.call(`attachments/${asset.id}`, 'GET', undefined, { range: 'bytes=999999-' })).response.status).toBe(416);
    const svg = new FormData(); svg.set('file', new File(['<svg onload="alert(1)"></svg>'], 'fake.png', { type: 'image/png' })); problem(await alice.call('attachments', 'POST', svg), 422, 'FILE_TYPE');
  });

  test('quotes require independent approval, remain immutable and are visible only to their customer', async () => {
    const lines: CommercialLine[] = [{ id: 'quote-line-1', productId: products[0].id, titleSnapshot: products[0].name.en, unit: 'set', quantityDecimal: '3', unitPriceDecimal: '0.10', discountPercentDecimal: '0', currency: 'USD' }];
    const calculation = calculateCommercial(lines, 'USD'); if (!calculation.ok) throw new Error(calculation.error);
    let w = await workspace(business); const stamp = new Date().toISOString();
    const unitLines = lines.map(line => ({ ...line, quantityDecimal: '1' }));
    const unitCalculation = calculateCommercial(unitLines, 'USD'); if (!unitCalculation.ok) throw new Error(unitCalculation.error);
    const pricebook: WorkspaceRecord = { id: 'api-pricebook', collection: 'pricebooks', title: recordText('Approved API pricebook'), summary: recordText('Explicit test commercial terms.'), status: 'review', owner: 'business', createdAt: stamp, updatedAt: stamp, demo: false, tags: [], history: [], amount: '0.10', currency: 'USD', details: { pricebookPolicy: { schemaVersion: 1, market: 'global' }, commercialDraft: { schemaVersion: 1, kind: 'pricebook', locale: 'en', currency: 'USD', lines: unitLines, estimate: unitCalculation.value, calculationPolicyVersion: 'local-line-half-up-v1', serverRecalculationRequired: true, updatedAt: stamp } } };
    success(await business.call('workspace', 'PUT', { state: { ...w.state, records: [...w.state.records, pricebook] }, expectedVersion: w.version, locale: 'en' }));
    w = await workspace(admin); success(await admin.call('workspace/review', 'POST', { bucket: 'records', id: pricebook.id, locale: 'en', expectedVersion: w.version }));
    const revision = success(await business.call<{items: {id: string; pricebookId: string}[]}>('crm/pricebooks/versions')).items.find(row => row.pricebookId === pricebook.id)!;
    expect(revision).toBeTruthy();
    w = await workspace(business);
    const quote: WorkspaceRecord = { id: 'api-quote', collection: 'quotes', title: recordText('Reviewed commercial quotation'), summary: recordText('Subject to final contract and approved availability.'), status: 'review', owner: 'business', requestId, due: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10), createdAt: stamp, updatedAt: stamp, demo: false, tags: [], history: [], amount: '0.30', currency: 'USD', details: { billingAddress: 'Explicit API test billing address', commercialDraft: { schemaVersion: 1, kind: 'quote', locale: 'en', currency: 'USD', pricebookRevisionId: revision.id, lines, estimate: calculation.value, calculationPolicyVersion: 'local-line-half-up-v1', serverRecalculationRequired: true, updatedAt: stamp } } };
    success(await business.call('workspace', 'PUT', { state: { ...w.state, records: [...w.state.records, quote] }, expectedVersion: w.version, locale: 'en' }));
    problem(await business.call(`requests/${requestId}/quotes`, 'POST', { recordId: quote.id }), 409, 'QUOTE_APPROVAL');
    w = await workspace(admin); success(await admin.call('workspace/review', 'POST', { bucket: 'records', id: quote.id, locale: 'en', expectedVersion: w.version }));
    const issued = success(await business.call<SharedQuote>(`requests/${requestId}/quotes`, 'POST', { recordId: quote.id }), 201); issuedQuoteId = issued.id; expect(issued.amount).toBe('0.30'); expect(issued.snapshotHash).toHaveLength(64);
    const retried = success(await business.call<SharedQuote>(`requests/${requestId}/quotes`, 'POST', { recordId: quote.id }), 201); expect(retried.id).toBe(issued.id); expect((await query('SELECT id FROM quote_snapshots WHERE record_id=$1', [quote.id])).rowCount).toBe(1);
    problem(await bob.call(`requests/${requestId}/quotes/${issued.id}/pdf`), 404, 'NOT_FOUND');
    const pdf = await alice.call(`requests/${requestId}/quotes/${issued.id}/pdf`); expect(pdf.response.status).toBe(200); expect(pdf.response.headers.get('content-type')).toBe('application/pdf'); expect(Buffer.from(await pdf.response.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const current = success(await alice.call<FrontRequest>(`requests/${requestId}`)); const tampered = current.sharedQuotes!.map(row => row.id === issued.id ? { ...row, amount: '0.01', status: 'accepted_interest', customerResponse: 'Interested' } : row);
    problem(await alice.call(`requests/${requestId}`, 'PATCH', { sharedQuotes: tampered }, { 'if-match': String(current.version) }), 422, 'REQUEST_ACTION');
    success(await alice.call(`requests/${requestId}`, 'PATCH', { sharedQuotes: current.sharedQuotes!.map(row => row.id === issued.id ? { ...row, status: 'accepted_interest', customerResponse: 'Interested; subject to final purchase order.' } : row) }, { 'if-match': String(current.version) }));
    const stored = (await query<{status: string; snapshot: SharedQuote}>('SELECT status,snapshot FROM quote_snapshots WHERE id=$1', [issued.id])).rows[0]; expect(stored.status).toBe('accepted_interest'); expect(stored.snapshot.amount).toBe('0.30'); expect(stored.snapshot.status).toBe('issued');
    await expect(query("UPDATE quote_snapshots SET snapshot=jsonb_set(snapshot,'{amount}','\"0.01\"') WHERE id=$1", [issued.id])).rejects.toThrow();
  });

  async function invitationToken(email: string) {
    const row = (await query<{payload: {encrypted: string}}>("SELECT o.payload FROM outbox o JOIN organization_invitations i ON o.dedupe_key='organization-invitation:'||i.id WHERE i.organization_id=$1 AND i.email=$2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL ORDER BY i.created_at DESC LIMIT 1", [organizationId, email])).rows[0];
    // Inspect the queued test invitation; delivery workers are never run and recipients use .invalid.
    const message = JSON.parse(decrypt(row.payload.encrypted)) as {body: string};
    const link = message.body.split('\n').find(line => line.startsWith(origin))!;
    const raw = new URL(link).searchParams.get('invite')!;
    expect((await query('SELECT id FROM organization_invitations WHERE token_hash=$1 AND token_hash<>$2', [hash(raw), raw])).rowCount).toBe(1);
    return raw;
  }

  test('organization membership requires an email-bound invitation and explicit request sharing', async () => {
    const created = success(await alice.call<{items: {id: string}[]}>('me/organizations', 'POST', { name: 'Alice Laboratory', city: 'Maku', country: 'Iran' }), 201); organizationId = created.items[0].id;
    const unrelated = success(await bob.call<{items: {id: string}[]}>('me/organizations', 'POST', { name: 'Independent organization' }), 201).items[0].id;
    problem(await bob.call(`me/organizations/${organizationId}`, 'PATCH', { name: 'Impersonated owner' }, { 'if-match': '1' }), 404, 'NOT_FOUND');
    problem(await bob.call(`me/organizations/${unrelated}/requests/${requestId}`, 'PUT', { permission: 'reply' }), 403, 'REQUEST_OWNER');
    problem(await bob.call(`requests/${requestId}`), 404, 'NOT_FOUND');
    success(await alice.call(`me/organizations/${organizationId}/invitations`, 'POST', { email: 'bob@example.invalid', role: 'member', locale: 'en' }), 202);
    const raw = await invitationToken('bob@example.invalid');
    problem(await business.call('me/organization-invitations/accept', 'POST', { token: raw }), 404, 'INVITATION');
    success(await bob.call('me/organization-invitations/accept', 'POST', { token: raw })); problem(await bob.call('me/organization-invitations/accept', 'POST', { token: raw }), 404, 'INVITATION');
    problem(await bob.call(`requests/${requestId}`), 404, 'NOT_FOUND');
    for (const id of [requestId, sharedAssetRequestId]) success(await alice.call(`me/organizations/${organizationId}/requests/${id}`, 'PUT', { permission: 'reply' }));
    const shared = success(await bob.call<FrontRequest>(`requests/${requestId}`)); expect(shared.access).toBe('shared_reply'); expect(JSON.stringify(shared)).not.toContain('Internal-only commercial review');
    expect(success(await bob.call<FrontRequest[]>('requests')).some(row => row.id === requestId)).toBe(true);
    problem(await bob.call(`requests/${requestId}`, 'PATCH', { status: 'withdrawn' }, { 'if-match': String(shared.version) }), 403, 'SHARED_READ_ONLY');
    problem(await bob.call(`requests/${requestId}`, 'PATCH', { sharedQuotes: shared.sharedQuotes }, { 'if-match': String(shared.version) }), 403, 'SHARED_READ_ONLY');
    success(await bob.call(`requests/${requestId}`, 'PATCH', { messages: [...(shared.messages || []), { id: 'shared-customer-reply', body: 'Authorized organization reply', visibility: 'public', sender: 'Forged', createdAt: new Date().toISOString() }] }, { 'if-match': String(shared.version) }));
    expect((await bob.call(`attachments/${sharedAssetId}`)).response.status).toBe(200);
    expect((await bob.call(`requests/${requestId}/quotes/${issuedQuoteId}/pdf`)).response.status).toBe(200);
  });

  test('membership revocation immediately removes request, attachment and quote PDF access', async () => {
    success(await alice.call(`me/organizations/${organizationId}/members/${bob.userId}`, 'DELETE'));
    problem(await bob.call(`requests/${requestId}`), 404, 'NOT_FOUND'); problem(await bob.call(`attachments/${sharedAssetId}`), 404, 'NOT_FOUND'); problem(await bob.call(`requests/${requestId}/quotes/${issuedQuoteId}/pdf`), 404, 'NOT_FOUND');
    expect(success(await bob.call<FrontRequest[]>('requests')).some(row => row.id === requestId)).toBe(false);
    success(await alice.call(`me/organizations/${organizationId}/invitations`, 'POST', { email: 'bob@example.invalid', role: 'viewer', locale: 'en' }), 202);
    success(await bob.call('me/organization-invitations/accept', 'POST', { token: await invitationToken('bob@example.invalid') }));
    const shared = success(await bob.call<FrontRequest>(`requests/${requestId}`)); expect(shared.access).toBe('shared_view');
    problem(await bob.call(`requests/${requestId}`, 'PATCH', { messages: [...(shared.messages || []), { id: 'viewer-reply', body: 'A viewer cannot reply', visibility: 'public', sender: 'Bob', createdAt: new Date().toISOString() }] }, { 'if-match': String(shared.version) }), 403, 'SHARED_READ_ONLY');
    success(await alice.call(`me/organizations/${organizationId}/requests/${requestId}`, 'DELETE')); problem(await bob.call(`requests/${requestId}`), 404, 'NOT_FOUND'); problem(await bob.call(`requests/${requestId}/quotes/${issuedQuoteId}/pdf`), 404, 'NOT_FOUND');
    const latest = success(await alice.call<{items: {id: string; version: number}[]}>('me/organizations')).items.find(row => row.id === organizationId)!;
    success(await alice.call(`me/organizations/${organizationId}`, 'DELETE', undefined, { 'if-match': String(latest.version) })); problem(await bob.call(`attachments/${sharedAssetId}`), 404, 'NOT_FOUND');
  });

  test('workspace conflicts cannot clobber a competing server revision or expose CRM publicly', async () => {
    const a = await workspace(business), b = await workspace(business); const target = a.state.records.find(row => row.id === requestId)!;
    success(await business.call('workspace', 'PUT', { state: { ...a.state, records: a.state.records.map(row => row.id === target.id ? { ...row, priority: 'high' } : row) }, expectedVersion: a.version, locale: 'en' }));
    problem(await business.call('workspace', 'PUT', { state: { ...b.state, records: b.state.records.map(row => row.id === target.id ? { ...row, priority: 'low' } : row) }, expectedVersion: b.version, locale: 'en' }), 409, 'conflict');
    const site = await new ApiClient().call('site'); success(site); const encoded = JSON.stringify(site.data); expect(encoded).not.toContain('alice@example.invalid'); expect(encoded).not.toContain('bob@example.invalid'); expect(encoded).not.toContain('Internal-only commercial review'); expect(site.response.headers.get('etag')).toMatch(/^"site-\d+"$/);
    const sessions = (await query<{token_hash: string}>('SELECT token_hash FROM sessions LIMIT 1')).rows; expect(encoded).not.toContain(sessions[0].token_hash);
  });

  test('product withdrawal and request admission are serialized, while quality history and idempotent replay remain available', async () => {
    const productId = products.at(-1)!.id;
    const payload = formInput({ productIds: [productId] }), key = `before-archive-${randomUUID()}`;
    const original = success(await alice.call<FrontRequest>('requests', 'POST', payload, { 'idempotency-key': key }), 201);
    const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
    let pending: Promise<ApiResult> | undefined;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT * FROM workspace_meta WHERE singleton=true FOR UPDATE');
      const blockerPid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      pending = alice.call('requests', 'POST', formInput({ productIds: [productId] }), { 'idempotency-key': `during-archive-${randomUUID()}` });
      let waiting = false;
      for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
        waiting = (await query<{waiting: boolean}>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND query='SELECT * FROM workspace_meta WHERE singleton=true FOR UPDATE') AS waiting", [blockerPid])).rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(waiting, 'The request must wait for the publication transaction before validating product availability.').toBe(true);
      expect((await blocker.query("UPDATE workspace_entities SET status='archived',data=jsonb_set(data,'{status}','\"archived\"'),revision_number=revision_number+1 WHERE bucket='records' AND collection='products' AND (id=$1 OR data->>'product'=$1)", [productId])).rowCount).toBeGreaterThan(0);
      await blocker.query('UPDATE workspace_meta SET version=version+1 WHERE singleton=true'); await blocker.query('COMMIT');
      problem(await pending, 422, 'PRODUCT');
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); if (pending) await pending; }
    problem(await alice.call('requests', 'POST', formInput({ kind: 'sample_request', productIds: [productId] }), { 'idempotency-key': `archived-sample-${randomUUID()}` }), 422, 'PRODUCT');
    const quality = success(await alice.call<FrontRequest>('requests', 'POST', formInput({ kind: 'quality_complaint', productIds: [productId], batch: 'HISTORICAL-BATCH' }), { 'idempotency-key': `historical-quality-${randomUUID()}` }), 201); expect(quality.productIds).toContain(productId);
    expect(success(await alice.call<FrontRequest>('requests', 'POST', payload, { 'idempotency-key': key }), 201).id).toBe(original.id);
  });

  async function queuedChallenge(userId: string, purpose: 'password_reset' | 'email_verify') {
    const prefix = purpose === 'email_verify' ? 'email-verify:' : 'password-reset:';
    const rows = (await query<{token_hash: string; consumed_at: Date | null; payload: {encrypted: string}}>('SELECT c.token_hash,c.consumed_at,o.payload FROM auth_challenges c JOIN outbox o ON o.dedupe_key=$3||c.token_hash WHERE c.user_id=$1 AND c.purpose=$2 ORDER BY c.created_at DESC,c.token_hash', [userId, purpose, prefix])).rows;
    return rows.map(row => {
      const message = JSON.parse(decrypt(row.payload.encrypted)) as {text: string};
      const address = message.text.match(/https:\/\/[^\s]+/)![0];
      return { ...row, token: new URL(address).searchParams.get(purpose === 'email_verify' ? 'verify' : 'token')! };
    });
  }

  test('email verification is account-bound, expires and consumes its token exactly once', async () => {
    const client = await new ApiClient().ready(), email = 'verification@example.invalid';
    success(await client.call('auth/register', 'POST', { name: 'Verification Customer', email, password }), 201);
    expect(success(await client.call<{user: {emailVerified: boolean}}>('auth/session')).user.emailVerified).toBe(false);
    success(await client.call('auth/email/request', 'POST', { locale: 'en' }), 202);
    const first = (await queuedChallenge(client.userId, 'email_verify'))[0]; expect(first.token_hash).toBe(hash(first.token + '\0' + email)); expect(first.token_hash).not.toBe(first.token);
    problem(await bob.call('auth/email/confirm', 'POST', { token: first.token }), 422, 'VERIFY_EXPIRED');
    await query("UPDATE auth_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [first.token_hash]);
    problem(await client.call('auth/email/confirm', 'POST', { token: first.token }), 422, 'VERIFY_EXPIRED');
    success(await client.call('auth/email/request', 'POST', { locale: 'en' }), 202);
    const second = (await queuedChallenge(client.userId, 'email_verify')).find(row => !row.consumed_at)!;
    await query('UPDATE users SET email=$2 WHERE id=$1', [client.userId, 'changed-verification@example.invalid']);
    problem(await client.call('auth/email/confirm', 'POST', { token: second.token }), 422, 'VERIFY_EXPIRED');
    await query('UPDATE users SET email=$2 WHERE id=$1', [client.userId, email]);
    expect(success(await client.call<{emailVerified: boolean}>('auth/email/confirm', 'POST', { token: second.token })).emailVerified).toBe(true);
    problem(await client.call('auth/email/confirm', 'POST', { token: second.token }), 422, 'VERIFY_EXPIRED');
    expect(success(await client.call<{user: {emailVerified: boolean}}>('auth/session')).user.emailVerified).toBe(true);
    expect((await query("SELECT token_hash FROM auth_challenges WHERE user_id=$1 AND purpose='email_verify' AND consumed_at IS NULL", [client.userId])).rowCount).toBe(0);
  });

  test('concurrent password recovery and password changes revoke older links and serialize the current password check', async () => {
    const client = await new ApiClient().ready(), email = 'recovery@example.invalid';
    success(await client.call('auth/register', 'POST', { name: 'Recovery Customer', email, password }), 201);
    const started = await Promise.all([client.call('auth/password/forgot', 'POST', { email }), client.call('auth/password/forgot', 'POST', { email })]); started.forEach(result => success(result));
    const links = await queuedChallenge(client.userId, 'password_reset'); expect(links).toHaveLength(2); expect(links.filter(row => !row.consumed_at)).toHaveLength(1);
    const active = links.find(row => !row.consumed_at)!, old = links.find(row => row.consumed_at)!;
    problem(await client.call('auth/password/reset', 'POST', { token: old.token, password: 'Never-accepted-password#2026' }), 422, 'RESET_EXPIRED');
    const nextPassword = 'Reset-accepted-password#2026'; success(await client.call('auth/password/reset', 'POST', { token: active.token, password: nextPassword }));
    problem(await client.call('me/settings'), 401, 'SESSION_REQUIRED');
    const fresh = await new ApiClient().ready();
    problem(await fresh.call('auth/password/reset', 'POST', { token: active.token, password: 'Replay-password#2026' }), 422, 'RESET_EXPIRED');
    success(await fresh.call('auth/login', 'POST', { email, password: nextPassword }));
    success(await fresh.call('auth/password/forgot', 'POST', { email })); const obsolete = (await queuedChallenge(client.userId, 'password_reset')).find(row => !row.consumed_at)!;
    const changedPassword = 'Changed-during-recovery#2026'; success(await fresh.call('auth/password/change', 'POST', { currentPassword: nextPassword, password: changedPassword }));
    problem(await fresh.call('auth/password/reset', 'POST', { token: obsolete.token, password: 'Obsolete-link-password#2026' }), 422, 'RESET_EXPIRED');
    const proposed = ['Concurrent-password-A#2026', 'Concurrent-password-B#2026'];
    const changes = await Promise.all(proposed.map(value => fresh.call('auth/password/change', 'POST', { currentPassword: changedPassword, password: value })));
    expect(changes.map(result => result.response.status).sort()).toEqual([200, 401]);
    problem(changes.find(result => result.response.status === 401)!, 401, 'INVALID_CREDENTIALS');
    const winner = changes.findIndex(result => result.response.status === 200), login = await new ApiClient().ready();
    success(await login.call('auth/login', 'POST', { email, password: proposed[winner] }));
    expect((await query("SELECT token_hash FROM auth_challenges WHERE user_id=$1 AND purpose='password_reset' AND consumed_at IS NULL", [client.userId])).rowCount).toBe(0);
  }, 45000);

  async function deliverTestJob(id: string) {
    const lock = randomUUID();
    const job = (await query<{id: string; kind: string; payload: Record<string, unknown>; attempts: number; lock_token: string}>("UPDATE outbox SET state='running',attempts=1,lock_token=$2,locked_at=now() WHERE id=$1 AND state='pending' RETURNING id,kind,payload,attempts,lock_token", [id, lock])).rows[0];
    expect(job).toBeTruthy();
    // Only the selected test job is dispatched. External delivery is disabled,
    // and consent failures must occur before any network provider is contacted.
    await deliverOutbox(job);
    return (await query<{state: string; last_error: string | null}>('SELECT state,last_error FROM outbox WHERE id=$1', [id])).rows[0];
  }

  test('marketing binds the verified account endpoint and requires consent for the selected channel', async () => {
    const base = { channel: 'email', purpose: 'marketing', to: 'alice@example.invalid', userId: alice.userId, title: 'Test notice', body: 'Only an authorized test recipient may receive this notice.' };
    success(await bob.call('me/portal', 'PATCH', { notificationPreferences: { email: true, inApp: false } }));
    problem(await business.call('notifications', 'POST', { ...base, userId: bob.userId, to: 'bob@example.invalid' }), 404, 'RECIPIENT_NOT_FOUND');
    success(await bob.call('requests', 'POST', formInput({ email: 'bob@example.invalid' }), { 'idempotency-key': `marketing-scope-${randomUUID()}` }), 201);
    problem(await business.call('notifications', 'POST', { ...base, userId: bob.userId, to: 'bob@example.invalid' }), 409, 'RECIPIENT_UNVERIFIED');
    await query('UPDATE users SET email_verified=true WHERE id=$1', [alice.userId]);
    success(await alice.call('me/portal', 'PATCH', { notificationPreferences: { email: true, inApp: false } }));
    problem(await alice.call('notifications', 'POST', base), 403, 'FORBIDDEN');
    problem(await business.call('notifications', 'POST', { ...base, to: 'bob@example.invalid' }), 422, 'RECIPIENT_MISMATCH');
    // Bound channels require a verified saved identity, never an arbitrary
    // client-supplied destination. Their positive paths have dedicated PG tests.
    for (const channel of ['sms', 'telegram', 'push']) problem(await business.call('notifications', 'POST', { ...base, channel }), 422, 'RECIPIENT');
    problem(await business.call('notifications', 'POST', { ...base, channel: 'in-app', to: alice.userId }), 409, 'CONSENT_REVOKED');
    const queued = success(await business.call<{id: string}>('notifications', 'POST', { ...base, to: ' ALICE@EXAMPLE.INVALID ' }), 202);
    const payload = (await query<{payload: {encrypted: string}}>('SELECT payload FROM outbox WHERE id=$1', [queued.id])).rows[0].payload;
    expect(JSON.parse(decrypt(payload.encrypted)).to).toBe('alice@example.invalid');
    success(await alice.call('me/portal', 'PATCH', { notificationPreferences: { email: false, inApp: true } }));
    expect(await deliverTestJob(queued.id)).toEqual({ state: 'cancelled', last_error: 'CONSENT_REVOKED' });
    const inbox = success(await business.call<{id: string}>('notifications', 'POST', { ...base, channel: 'in-app', to: alice.userId }), 202);
    expect(await deliverTestJob(inbox.id)).toEqual({ state: 'delivered', last_error: null });
    expect((await query('SELECT id FROM notifications WHERE user_id=$1 AND dedupe_key=$2', [alice.userId, 'outbox:' + inbox.id])).rowCount).toBe(1);
  });

  test('delivery rechecks destination changes and inbox consent revocation before sending', async () => {
    success(await alice.call('me/portal', 'PATCH', { notificationPreferences: { email: true, inApp: true } }));
    const base = { purpose: 'marketing', userId: alice.userId, title: 'Dispatch recheck', body: 'This queued message must be cancelled when its authorization changes.' };
    const email = success(await business.call<{id: string}>('notifications', 'POST', { ...base, channel: 'email', to: 'alice@example.invalid' }), 202);
    await query('UPDATE users SET email=$2 WHERE id=$1', [alice.userId, 'replacement-alice@example.invalid']);
    expect(await deliverTestJob(email.id)).toEqual({ state: 'cancelled', last_error: 'RECIPIENT_MISMATCH' });
    await query('UPDATE users SET email=$2 WHERE id=$1', [alice.userId, 'alice@example.invalid']);
    const inbox = success(await business.call<{id: string}>('notifications', 'POST', { ...base, channel: 'in-app', to: alice.userId }), 202);
    success(await alice.call('me/portal', 'PATCH', { notificationPreferences: { email: true, inApp: false } }));
    expect(await deliverTestJob(inbox.id)).toEqual({ state: 'cancelled', last_error: 'CONSENT_REVOKED' });
    expect((await query('SELECT id FROM notifications WHERE dedupe_key=$1', ['outbox:' + inbox.id])).rowCount).toBe(0);
  });
});
