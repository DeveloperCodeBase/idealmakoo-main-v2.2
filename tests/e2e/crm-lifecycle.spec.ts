import {test, expect, type APIRequestContext, type APIResponse, type BrowserContext, type Page} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import sharp from 'sharp';
import {passwordHash, totp} from '../../src/server/crypto';
import {products, type ContentLocale, type Localized} from '../../src/data/catalog';
import type {WorkspaceRecord, WorkspaceState} from '../../src/data/workspace-seed';
import {calculateCommercial, type CommercialDraft, type CommercialLine} from '../../src/components/workspace/crm-tools-logic';
import type {CrmAccountDefinition, CrmContactDefinition, CrmDomainDefinition, CrmDomainView, CrmLeadConversionInput, CrmSampleTransitionInput} from '../../src/types/crm-domain';
import type {PipelineDefinition, PipelineView} from '../../src/types/pipeline';
import type {PricebookVersion} from '../../src/types/commercial';
import type {FrontRequest, SharedQuote} from '../../src/types/frontend';
import type {CrmForecast, CrmReportSnapshot} from '../../src/types/crm-operations';

// P08 / CRM-032 acceptance witness. Run against the deployment's DISPOSABLE
// acceptance database, after the other browser scenarios. SQL creates/revokes
// explicitly identified login fixtures only. Every organization, lead, account,
// contact, opportunity, pricebook, quotation, document, sample and quality ticket
// below is created through the deployed HTTP service, with its normal guards.
// This is one desktop Chromium witness, not an all-role/device certification.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.SITE_URL || 'http://127.0.0.1:3000';
const runId = randomUUID().replaceAll('-', '').slice(0, 14);
const password = `E2e-only-${randomUUID()}-A9`;
const locales: ContentLocale[] = ['fa', 'en', 'tr', 'ar', 'ru'];
const fixtureIds: string[] = [];
const csrfTokens = new WeakMap<APIRequestContext, string>();
let pool: pg.Pool;

interface Identity {id: string; email: string; name: string; role: 'customer' | 'business' | 'admin'}
interface Session {csrfToken: string; user: {id: string; role: string} | null}
interface Workspace {state: WorkspaceState; version: number}
interface Organization {id: string; name: string; version: number; sharedRequestIds: string[]; crmLink: {reference: string; state: 'pending' | 'linked'}}
interface ManagedOrganization {id: string; version: number; linkState: 'pending' | 'linked'; account: {id: string; version: number; recordVersion: number}}
interface AccountCandidate {id: string; version: number; recordVersion: number}
interface Conversion {accountId: string; contactId: string; opportunityId: string}
interface IssuedWitness {request: FrontRequest; quote: SharedQuote; pdfHash: string; byteCount: number}

const text = (value: string): Localized => ({fa: value, en: value, tr: value, ar: value, ru: value});
const now = () => new Date().toISOString();
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

async function json<T>(response: APIResponse, expectedStatus = 200): Promise<T> {
  if (response.status() !== expectedStatus) {
    throw new Error(`${new URL(response.url()).pathname}: expected ${expectedStatus}, received ${response.status()}: ${(await response.text()).slice(0, 1800)}`);
  }
  return response.json() as Promise<T>;
}
async function get<T>(api: APIRequestContext, path: string): Promise<T> {
  return json<T>(await api.get(`/api/v1${path}`));
}
async function mutate(api: APIRequestContext, path: string, data: unknown, method = 'POST', headers: Record<string, string> = {}): Promise<APIResponse> {
  let csrfToken = csrfTokens.get(api);
  if (!csrfToken) {
    csrfToken = (await get<Session>(api, '/auth/session')).csrfToken;
    csrfTokens.set(api, csrfToken);
  }
  const response = await api.fetch(`/api/v1${path}`, {method, data, headers: {
    Origin: baseURL, 'X-CSRF-Token': csrfToken,
    ...(method === 'POST' ? {'Idempotency-Key': randomUUID()} : {}), ...headers,
  }});
  // Like the real apiClient, reuse only the current cookie-bound CSRF value;
  // authentication/MFA changes always force a new server-issued value.
  if (path.startsWith('/auth/')) csrfTokens.delete(api);
  return response;
}
async function command<T>(api: APIRequestContext, path: string, data: unknown, method = 'POST', status = 200): Promise<T> {
  return json<T>(await mutate(api, path, data, method), status);
}
async function fixture(role: Identity['role'], label: string, qualityScope = false): Promise<Identity> {
  const id = randomUUID(), email = `crm-${runId}-${id.slice(0, 8)}@example.test`, name = `Acceptance ${label} ${runId}`;
  // Account/MFA fixtures are the sole permitted direct database preparation.
  // email_verified substitutes for a provider round-trip for these nonexistent
  // addresses; it is not evidence of real email delivery or marketing consent.
  await pool.query('INSERT INTO users(id,email,name,password_hash,role,email_verified,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,true,$6,$7::jsonb,$8,$9::jsonb)', [
    id, email, name, await passwordHash(password), role, qualityScope, JSON.stringify(locales), role === 'customer' ? 'assigned' : 'all',
    JSON.stringify(role === 'customer' ? {} : {contact: true, financial: true, baseCost: true, assign: true, intake: true}),
  ]);
  fixtureIds.push(id);
  await pool.query('INSERT INTO user_settings(user_id) VALUES($1)', [id]);
  return {id, email, name, role};
}
async function authenticate(api: APIRequestContext, identity: Identity) {
  await command(api, '/auth/login', {email: identity.email, password});
  if (identity.role !== 'customer') {
    expect((await api.get('/api/v1/workspace')).status()).toBe(403);
    const enrollment = await command<{secret: string}>(api, '/auth/mfa/enroll', {password});
    await command(api, '/auth/mfa/confirm', {code: totp(enrollment.secret, Math.floor(Date.now() / 30000))});
    expect((await api.get('/api/v1/workspace')).status()).toBe(200);
  }
  expect((await get<Session>(api, '/auth/session')).user?.id).toBe(identity.id);
}
async function workspace(api: APIRequestContext): Promise<Workspace> {return get<Workspace>(api, '/workspace');}
async function editRecords(api: APIRequestContext, edit: (rows: WorkspaceRecord[]) => WorkspaceRecord[], locale: ContentLocale = 'en'): Promise<Workspace> {
  const current = await workspace(api);
  return command<Workspace>(api, '/workspace', {state: {...current.state, records: edit(current.state.records)}, expectedVersion: current.version, locale}, 'PUT');
}
async function record(api: APIRequestContext, id: string): Promise<WorkspaceRecord> {
  const found = (await workspace(api)).state.records.find(row => row.id === id);
  if (!found) throw new Error(`The current scoped workspace did not return record ${id}.`);
  return found;
}
async function saveDomain(api: APIRequestContext, id: string, value: CrmDomainDefinition) {
  return command<Workspace>(api, `/crm/records/${id}/domain`, {value, expectedVersion: (await workspace(api)).version}, 'PUT');
}
async function domain(api: APIRequestContext, id: string) {return get<CrmDomainView>(api, `/crm/records/${id}/domain`);}
async function review(api: APIRequestContext, id: string, locale: ContentLocale) {
  return command<Workspace>(api, '/workspace/review', {bucket: 'records', id, locale, expectedVersion: (await workspace(api)).version});
}
function accountDefinition(name: string): CrmAccountDefinition {
  return {schemaVersion: 1, kind: 'account', displayName: name, legalName: name, activity: 'laboratory', lifecycle: 'active', registrations: [], branches: [], addresses: [{kind: 'billing', address: {line1: 'Controlled acceptance address', line2: '', city: 'Fixture city', region: '', postalCode: '', countryCode: 'TR'}}]};
}
function contactDefinition(owner: Identity): CrmContactDefinition {
  return {schemaVersion: 1, kind: 'contact', givenName: 'Acceptance', familyName: owner.name, displayName: owner.name, locale: 'en', affiliations: [], endpoints: [{channel: 'email', value: owner.email, label: 'Purchasing contact', active: true}]};
}
async function qualifyAndConvert(api: APIRequestContext, request: FrontRequest, owner: Identity, organization: Organization, pipelineId: string, existing?: Conversion): Promise<Conversion> {
  const lead = await record(api, request.id);
  expect(lead.collection).toBe('leads');
  expect(lead.requestId).toBe(request.id);
  expect(lead.email).toBe(owner.email);
  expect(lead.tags).toEqual(expect.arrayContaining(['website', 'rfq']));
  await saveDomain(api, lead.id, {schemaVersion: 1, kind: 'lead', needConfirmed: true, contactConfirmed: true, authorityConfirmed: true, timeframeConfirmed: true, notes: 'Isolated acceptance fixture: the named customer confirms this laboratory requirement, authority, contact and timeframe.'});
  const input: CrmLeadConversionInput = {
    expectedVersion: (await workspace(api)).version,
    account: existing ? {id: existing.accountId} : {create: accountDefinition(organization.name)},
    contact: existing ? {id: existing.contactId} : {create: contactDefinition(owner)},
    opportunity: existing ? {mode: 'link', id: existing.opportunityId} : {mode: 'create', title: `Laboratory requirement ${organization.name}`, needKey: `acceptance-${runId}-${owner.id}`, pipelineId},
  };
  await command<Workspace>(api, `/crm/leads/${lead.id}/convert`, input);
  const saved = (await domain(api, lead.id)).conversion;
  if (!saved?.opportunityId) throw new Error('The approved conversion did not produce its normalized account, contact and opportunity.');
  const result = {accountId: saved.accountId, contactId: saved.contactId, opportunityId: saved.opportunityId};
  if (existing) expect(result).toEqual(existing);
  expect((await record(api, lead.id)).status).toBe('converted');
  return result;
}
async function linkOrganization(api: APIRequestContext, organization: Organization, accountId: string) {
  const current = await get<ManagedOrganization>(api, `/crm/portal-organizations/${organization.id}`);
  const candidates = await get<{items: AccountCandidate[]}>(api, `/crm/portal-organizations/${organization.id}/accounts?search=${encodeURIComponent(accountId)}`);
  const candidate = candidates.items.find(item => item.id === accountId);
  if (!candidate) throw new Error('The explicitly selected CRM account is absent from current eligible mapping candidates.');
  const linked = await command<ManagedOrganization>(api, `/crm/portal-organizations/${organization.id}/account`, {
    accountId, expectedOrganizationVersion: current.version, expectedAccountVersion: candidate.version, expectedAccountRecordVersion: candidate.recordVersion,
    reason: 'Acceptance fixture: staff independently checked the portal owner and explicitly linked the matching normalized account.',
  }, 'PUT');
  expect(linked.account.id).toBe(accountId);
  expect(linked.linkState).toBe('linked');
}
async function createRequest(api: APIRequestContext, owner: Identity, organization: Organization, locale: ContentLocale, productId: string, quantity: number, kind: 'rfq' | 'sample_request' = 'rfq'): Promise<FrontRequest> {
  const request = await command<FrontRequest>(api, '/requests', {kind, locale, name: owner.name, email: owner.email, organization: organization.name, phone: '+905551234567', country: 'Turkey', message: `Acceptance ${kind} ${runId}: please assess this laboratory requirement in ${locale}.`, productIds: [productId], items: [{productId, quantity, unit: 'set', note: 'Controlled acceptance requirement'}], attachmentIds: [], consent: {purpose: 'request_processing', acceptedAt: now()}}, 'POST', 201);
  expect(request.ownerId).toBe(owner.id);
  expect(request.locale).toBe(locale);
  expect(request.status).toBe('received');
  return request;
}
function commercialRecord(id: string, kind: CommercialDraft['kind'], currency: 'USD' | 'EUR', locale: ContentLocale, productId: string, price: string, quantity: string, request?: FrontRequest, pricebookRevisionId?: string): WorkspaceRecord {
  const product = products.find(item => item.id === productId);
  if (!product) throw new Error('A real sourced product is required.');
  const lines: CommercialLine[] = [{id: `line-${id}`, productId, titleSnapshot: product.name[locale], unit: 'set', quantityDecimal: quantity, unitPriceDecimal: price, discountPercentDecimal: '0', currency}];
  const estimate = calculateCommercial(lines, currency);
  if (!estimate.ok || !estimate.value.complete || estimate.value.grandTotalDecimal === null) throw new Error('The acceptance quotation must contain a complete exact-decimal calculation.');
  const draft: CommercialDraft = {schemaVersion: 1, kind, locale, currency, lines, estimate: estimate.value, calculationPolicyVersion: 'local-line-half-up-v1', serverRecalculationRequired: true, updatedAt: now(), ...(pricebookRevisionId ? {pricebookRevisionId} : {})};
  const title: Localized = {fa: `پیش‌فاکتور آزمایش پذیرش ${runId}`, en: `Acceptance quotation ${runId}`, tr: `Kabul testi teklifi ${runId}`, ar: `عرض اختبار القبول ${runId}`, ru: `Предложение приёмочного теста ${runId}`};
  const terms: Localized = {fa: 'این سند فقط دادهٔ آزمایش پذیرش است. تأیید مشتری، اعلام تمایل برای پیگیری است.', en: 'Controlled acceptance fixture only. Customer acceptance records interest for follow-up.', tr: 'Yalnızca kontrollü kabul testi verisidir. Müşteri kabulü takip için ilgiyi kaydeder.', ar: 'بيانات اختبار قبول مضبوط فقط. يسجّل قبول العميل اهتمامه للمتابعة.', ru: 'Только данные контролируемого приёмочного теста. Ответ клиента фиксирует интерес для обсуждения.'};
  return {id, collection: kind === 'quote' ? 'quotes' : 'pricebooks', title: kind === 'quote' ? title : text(`Acceptance ${currency} pricebook ${runId}`), summary: terms, status: 'review', owner: 'business', createdAt: now(), updatedAt: now(), history: [], tags: ['acceptance-fixture'], demo: false, amount: estimate.value.grandTotalDecimal, currency,
    ...(request ? {requestId: request.id, due: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)} : {}),
    details: {...(kind === 'pricebook' ? {pricebookPolicy: {schemaVersion: 1, market: 'global'}} : {billingAddress: 'Controlled acceptance billing address'}), commercialDraft: draft},
  };
}
async function assertPdf(api: APIRequestContext, request: FrontRequest, quote: SharedQuote): Promise<{pdfHash: string; byteCount: number}> {
  const response = await api.get(`/api/v1/requests/${request.id}/quotes/${quote.id}/pdf`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect(response.headers()['cache-control']).toContain('no-store');
  const bytes = await response.body(), hash = sha256(bytes);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(1000);
  expect(quote.fileOrigin).toBe('issued');
  expect(quote.fileSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(hash).toBe(quote.fileSha256);
  expect(response.headers()['x-content-sha256']).toBe(hash);
  expect(bytes.length).toBe(quote.fileByteCount);
  return {pdfHash: hash, byteCount: bytes.length};
}
async function respondInPortal(page: Page, request: FrontRequest, quote: SharedQuote, customerMessage: string) {
  await page.locator('main').getByRole('link', {name: request.id, exact: true}).click();
  await expect(page).toHaveURL(new RegExp(`/en/account/requests/?\\?id=${encodeURIComponent(request.id)}$`));
  const card = page.locator('article').filter({has: page.getByText(quote.number, {exact: true})});
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(`${quote.amount} ${quote.currency}`);
  await card.getByText('Immutable document identifiers', {exact: true}).click();
  await expect(card.getByText(quote.fileSha256!, {exact: true})).toBeVisible();
  const downloading = page.waitForEvent('download');
  await card.getByRole('link', {name: /^PDF ·/}).click();
  const download = await downloading, file = await download.path();
  expect(await download.failure()).toBeNull();
  if (!file) throw new Error('The actual portal PDF download did not produce a local artifact.');
  const downloadedBytes = await readFile(file);
  expect(sha256(downloadedBytes)).toBe(quote.fileSha256);
  expect(downloadedBytes.length).toBe(quote.fileByteCount);
  await card.locator('textarea').fill(customerMessage);
  const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname.replace(/\/$/, '') === `/api/v1/requests/${request.id}`);
  await card.getByRole('button', {name: 'Express interest', exact: true}).click();
  expect((await saved).status()).toBe(200);
  await expect(card.getByRole('status')).toHaveText('Your interest is recorded for follow-up.');
  await expect(card.getByRole('button', {name: 'Express interest', exact: true})).toHaveCount(0);
}

test.beforeAll(async () => {
  const database = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!database) throw new Error('CRM lifecycle acceptance requires the deployment disposable database and its explicit account-fixture connection.');
  if (process.env.NOTIFICATIONS_MODE !== 'disabled') throw new Error('CRM lifecycle acceptance runs with NOTIFICATIONS_MODE=disabled; it must never send real external messages.');
  pool = new pg.Pool({connectionString: database, max: 2});
  await pool.query('SELECT 1');
});
test.afterAll(async () => {
  if (!pool) return;
  if (fixtureIds.length) {
    await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])', [fixtureIds]);
    await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])', [fixtureIds]);
  }
  await pool.end();
});

test('P08 CRM-032: two organizations complete the inquiry, approved multilingual PDF, portal interest, forecast and isolated sample-quality lifecycle', async ({browser}, testInfo) => {
  test.setTimeout(420000);
  const contexts: BrowserContext[] = [], pageErrors: string[] = [];
  const ownerA = await fixture('customer', 'Organization A buyer'), ownerB = await fixture('customer', 'Organization B buyer');
  const seller = await fixture('business', 'Commercial maker'), policyMaker = await fixture('admin', 'Policy maker'), approver = await fixture('admin', 'Independent reviewer', true);
  const identities = [ownerA, ownerB, seller, policyMaker, approver];
  try {
    for (const identity of identities) {
      const context = await browser.newContext({baseURL, serviceWorkers: 'block', reducedMotion: 'reduce'});
      contexts.push(context);
      await authenticate(context.request, identity);
    }
    const [customerA, customerB, sales, author, reviewer] = contexts;
    const apiA = customerA.request, apiB = customerB.request, maker = sales.request, approvedBy = reviewer.request;
    const selectedProduct = products.find(item => item.id === 'president');
    if (!selectedProduct) throw new Error('The sourced President catalogue product is missing.');
    const productId = selectedProduct.id;
    let organizationA!: Organization, organizationB!: Organization, pipeline!: PipelineView;
    let convertedA!: Conversion, convertedB!: Conversion;
    const requestsA: FrontRequest[] = [], issued: IssuedWitness[] = [];
    let requestB!: FrontRequest, sampleRequest!: FrontRequest, qualityId = '', reportSnapshot!: CrmReportSnapshot;

    await test.step('Create two independent portal organizations and independently approve a dedicated pipeline', async () => {
      const nameA = `Acceptance laboratory A ${runId}`, nameB = `Acceptance laboratory B ${runId}`;
      organizationA = (await command<{items: Organization[]}>(apiA, '/me/organizations', {name: nameA, city: 'Fixture A', country: 'Turkey'}, 'POST', 201)).items.find(item => item.name === nameA)!;
      organizationB = (await command<{items: Organization[]}>(apiB, '/me/organizations', {name: nameB, city: 'Fixture B', country: 'Turkey'}, 'POST', 201)).items.find(item => item.name === nameB)!;
      expect(organizationA.id).not.toBe(organizationB.id);
      expect((await get<{items: Organization[]}>(apiA, '/me/organizations')).items.map(item => item.id)).toEqual([organizationA.id]);
      expect((await get<{items: Organization[]}>(apiB, '/me/organizations')).items.map(item => item.id)).toEqual([organizationB.id]);
      const definition: PipelineDefinition = {schemaVersion: 1, title: text(`Acceptance lifecycle ${runId}`), active: true, stages: [
        {id: 'new', title: text('New need'), kind: 'open', probabilityPercentDecimal: '0', entryChecklist: []},
        {id: 'qualified', title: text('Qualified need'), kind: 'open', probabilityPercentDecimal: '50', entryChecklist: [{id: 'need_confirmed', title: text('Customer need has been confirmed'), required: true}]},
        {id: 'won', title: text('Won'), kind: 'won', probabilityPercentDecimal: '100', entryChecklist: []},
        {id: 'lost', title: text('Lost'), kind: 'lost', probabilityPercentDecimal: '0', entryChecklist: []},
      ]};
      const draft = await command<PipelineView>(author.request, '/crm/pipelines', {definition}, 'POST', 201);
      const approval = {expectedVersion: draft.version, expectedWorkspaceVersion: (await workspace(author.request)).version, stageMapping: {}};
      expect((await mutate(author.request, `/crm/pipelines/${draft.id}/approve`, approval)).status()).toBe(403);
      pipeline = (await command<{pipeline: PipelineView}>(approvedBy, `/crm/pipelines/${draft.id}/approve`, {...approval, expectedWorkspaceVersion: (await workspace(approvedBy)).version})).pipeline;
      expect(pipeline.activeRevision?.makerId).toBe(policyMaker.id);
      expect(pipeline.activeRevision?.approvedById).toBe(approver.id);
      expect(pipeline.activeRevision?.checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    await test.step('Submit real five-language RFQs, qualify their automatic leads and convert into distinct normalized accounts and opportunities', async () => {
      // Quote locale is bound to its source request. Five source RFQs are linked
      // to ONE A opportunity, so multilingual paperwork never multiplies sales.
      for (const locale of locales) {
        const request = await createRequest(apiA, ownerA, organizationA, locale, productId, 2);
        requestsA.push(request);
        convertedA = await qualifyAndConvert(maker, request, ownerA, organizationA, pipeline.id, convertedA);
        await command(apiA, `/me/organizations/${organizationA.id}/requests/${request.id}`, {permission: 'view'}, 'PUT');
        expect((await apiB.get(`/api/v1/requests/${request.id}`)).status()).toBe(404);
      }
      requestB = await createRequest(apiB, ownerB, organizationB, 'en', productId, 1);
      convertedB = await qualifyAndConvert(maker, requestB, ownerB, organizationB, pipeline.id);
      await command(apiB, `/me/organizations/${organizationB.id}/requests/${requestB.id}`, {permission: 'view'}, 'PUT');
      expect(convertedB.accountId).not.toBe(convertedA.accountId);
      expect(convertedB.contactId).not.toBe(convertedA.contactId);
      expect(convertedB.opportunityId).not.toBe(convertedA.opportunityId);
      expect((await apiA.get(`/api/v1/requests/${requestB.id}`)).status()).toBe(404);
      await linkOrganization(maker, organizationA, convertedA.accountId);
      await linkOrganization(maker, organizationB, convertedB.accountId);
      for (const [conversion, linkedRequests, currency, amount, quantity] of [
        [convertedA, requestsA, 'USD', '200.00', '2'], [convertedB, [requestB], 'EUR', '350.00', '1'],
      ] as const) {
        await saveDomain(maker, conversion.opportunityId, {schemaVersion: 1, kind: 'opportunity', locale: 'en', accountId: conversion.accountId, contactIds: [conversion.contactId], requestIds: linkedRequests.map(item => item.id), items: [{productId, variantId: null, unit: 'set', quantityDecimal: quantity, note: 'One distinct laboratory requirement with reviewed product identity.'}]});
        const configured = await domain(maker, conversion.opportunityId);
        expect(configured.definition?.kind).toBe('opportunity');
        if (configured.definition?.kind !== 'opportunity') throw new Error('Expected a saved opportunity definition.');
        expect(configured.definition.requestIds.sort()).toEqual(linkedRequests.map(item => item.id).sort());
        expect(configured.items).toHaveLength(1);
        expect(configured.items[0].productSnapshot.productId).toBe(productId);
        expect(configured.items[0].productSnapshot.sourceHash).toMatch(/^[a-f0-9]{64}$/);
        await editRecords(maker, rows => rows.map(row => row.id === conversion.opportunityId ? {...row, status: 'qualified', amount, currency, details: {...row.details, pipeline: {...row.details?.pipeline as Record<string, unknown>, stageId: 'qualified', completedChecklistIds: ['need_confirmed']}}} : row));
        const position = (await record(maker, conversion.opportunityId)).details?.pipeline as Record<string, unknown>;
        expect(position.revisionId).toBe(pipeline.activeRevision?.id);
        expect(position.probabilityPercentDecimal).toBe('50');
      }
    });

    await test.step('Approve immutable currency-specific pricebooks and six independently reviewed quotation PDFs, including all five locales', async () => {
      const books = new Map<'USD' | 'EUR', PricebookVersion>();
      for (const [currency, price] of [['USD', '100'], ['EUR', '350']] as const) {
        const source = commercialRecord(`pb-${runId}-${currency}`, 'pricebook', currency, 'en', productId, price, '1');
        await editRecords(maker, rows => [...rows, source]);
        await review(approvedBy, source.id, 'en');
        const version = (await get<{items: PricebookVersion[]}>(maker, '/crm/pricebooks/versions')).items.find(item => item.pricebookId === source.id);
        if (!version) throw new Error('Independent review did not expose an approved pricebook revision.');
        expect(version.approvedById).toBe(approver.id);
        expect(version.currency).toBe(currency);
        expect(version.entries[0].unitPriceDecimal).toBe(price);
        books.set(currency, version);
      }
      for (const sourceRequest of [...requestsA, requestB]) {
        const currency = sourceRequest.ownerId === ownerA.id ? 'USD' : 'EUR', locale = sourceRequest.locale!;
        const book = books.get(currency)!;
        const source = commercialRecord(`quote-${runId}-${locale}-${currency}`, 'quote', currency, locale, productId, currency === 'USD' ? '100' : '350', currency === 'USD' ? '2' : '1', sourceRequest, book.id);
        await editRecords(maker, rows => [...rows, source], locale);
        // An author cannot issue merely by setting status=review or by claiming
        // a client approval. No state is inserted through the database here.
        expect((await mutate(maker, `/requests/${sourceRequest.id}/quotes`, {recordId: source.id})).status()).toBe(409);
        await review(approvedBy, source.id, locale);
        const reviewed = await record(maker, source.id);
        expect(reviewed.authorId).toBe(seller.id);
        expect(reviewed.approvedById).toBe(approver.id);
        expect(reviewed.approvedById).not.toBe(reviewed.authorId);
        const quote = await command<SharedQuote>(maker, `/requests/${sourceRequest.id}/quotes`, {recordId: source.id}, 'POST', 201);
        const ownerApi = currency === 'USD' ? apiA : apiB, otherApi = currency === 'USD' ? apiB : apiA;
        expect(quote.locale).toBe(locale);
        expect(quote.requestId).toBe(sourceRequest.id);
        expect(quote.recordId).toBe(source.id);
        expect(quote.status).toBe('issued');
        expect(quote.customerSnapshot?.email).toBe(sourceRequest.email);
        expect(quote.customerSnapshot?.organization).toBe(sourceRequest.organization);
        expect(quote.sellerSnapshot?.name).toBeTruthy();
        expect(quote.pricebookSnapshot?.id).toBe(book.id);
        expect(quote.pricebookSnapshot?.checksum).toBe(book.checksum);
        expect(quote.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
        expect(quote.calculationPolicyVersion).toBe('local-line-half-up-v1');
        expect(JSON.stringify(quote)).not.toContain('baseCost');
        const bytes = await assertPdf(ownerApi, sourceRequest, quote);
        expect((await otherApi.get(`/api/v1/requests/${sourceRequest.id}/quotes/${quote.id}/pdf`)).status()).toBe(404);
        const current = await get<FrontRequest>(ownerApi, `/requests/${sourceRequest.id}`);
        expect(current.quoteEnvelopes).toEqual(expect.arrayContaining([expect.objectContaining({recordId: source.id, currentRevisionId: quote.id, requestId: sourceRequest.id})]));
        const retry = await command<SharedQuote>(maker, `/requests/${sourceRequest.id}/quotes`, {recordId: source.id}, 'POST', 201);
        expect(retry.id).toBe(quote.id);
        expect(retry.fileSha256).toBe(quote.fileSha256);
        issued.push({request: sourceRequest, quote, ...bytes});
      }
      expect(issued.filter(item => item.request.ownerId === ownerA.id).map(item => item.quote.locale).sort()).toEqual([...locales].sort());
      expect(new Set(issued.map(item => item.quote.id)).size).toBe(6);
      expect(new Set(issued.map(item => item.pdfHash)).size).toBe(6);
    });

    await test.step('Both customers inspect their actual organizational portal, express interest in the browser, and retain the same PDF bytes', async () => {
      for (const [context, ownOrganization, otherOrganization, owner] of [[customerA, organizationA, organizationB, ownerA], [customerB, organizationB, organizationA, ownerB]] as const) {
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto('/en/account/organizations');
        await expect(page.locator('main').getByRole('button', {name: new RegExp(ownOrganization.name)})).toBeVisible();
        await expect(page.locator('main').getByText('Reviewed mapping', {exact: true})).toBeVisible();
        await expect(page.locator('main')).not.toContainText(otherOrganization.name);
        const witness = issued.find(item => item.request.ownerId === owner.id && item.request.locale === 'en')!;
        await expect(page.locator('main').getByRole('link', {name: witness.request.id, exact: true})).toBeVisible();
        await respondInPortal(page, witness.request, witness.quote, `Please follow up on this acceptance requirement ${runId}.`);
        const response = await get<FrontRequest>(context.request, `/requests/${witness.request.id}`);
        const accepted = response.sharedQuotes?.find(item => item.id === witness.quote.id);
        expect(accepted?.status).toBe('accepted_interest');
        expect(accepted?.customerResponse).toContain(runId);
        expect(accepted?.customerSnapshot).toEqual(witness.quote.customerSnapshot);
        expect(accepted?.pricebookSnapshot).toEqual(witness.quote.pricebookSnapshot);
        expect(accepted?.snapshotHash).toBe(witness.quote.snapshotHash);
        expect(accepted?.fileSha256).toBe(witness.pdfHash);
        expect(await assertPdf(context.request, witness.request, accepted!)).toEqual({pdfHash: witness.pdfHash, byteCount: witness.byteCount});
      }
      // Commercial interest is not an ERP order or a silently won opportunity.
      expect((await record(maker, convertedA.opportunityId)).status).toBe('qualified');
      expect((await record(maker, convertedB.opportunityId)).status).toBe('qualified');
    });

    await test.step('Render a current-scope forecast and immutable report with currency-separated amounts and approved probabilities', async () => {
      const page = await sales.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto('/en/admin/crm/reports');
      const panel = page.locator('[data-crm-reports]');
      await expect(panel).toBeVisible();
      await panel.getByRole('combobox', {name: 'Pipeline', exact: true}).selectOption(pipeline.id);
      const calculated = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.replace(/\/$/, '') === '/api/v1/crm/reports/forecast');
      await panel.getByRole('button', {name: 'Calculate current scope', exact: true}).click();
      const calculation = await calculated;
      expect(calculation.status()).toBe(200);
      const forecast = await calculation.json() as CrmForecast;
      expect(forecast.filters.pipelineId).toBe(pipeline.id);
      expect(forecast.opportunityCount).toBe(2);
      expect(forecast.groups).toHaveLength(2);
      for (const [currency, amount, weighted] of [['USD', '200.00', '100.00'], ['EUR', '350.00', '175.00']] as const) {
        expect(forecast.groups.find(group => group.currency === currency)).toMatchObject({pipelineId: pipeline.id, stageId: 'qualified', stageKind: 'open', count: 1, knownAmountDecimal: amount, knownWeightedAmountDecimal: weighted, weightedAmountDecimal: weighted, unknownAmountCount: 0, unknownProbabilityCount: 0});
        const row = panel.locator('tbody tr').filter({has: page.getByText(currency, {exact: true})});
        await expect(row).toHaveCount(1);
        await expect(row.locator('td').nth(3)).toHaveText(amount);
        await expect(row.locator('td').nth(5)).toHaveText(weighted);
      }
      const capture = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.replace(/\/$/, '') === '/api/v1/crm/reports/snapshots');
      await panel.getByRole('button', {name: 'Capture immutable report', exact: true}).click();
      const captured = await capture;
      expect(captured.status()).toBe(201);
      reportSnapshot = await captured.json() as CrmReportSnapshot;
      expect(reportSnapshot.report.groups).toEqual(forecast.groups);
      expect(reportSnapshot.checksum).toMatch(/^[a-f0-9]{64}$/);
      await expect(panel.getByText(`SHA-256 ${reportSnapshot.checksum}`, {exact: true})).toBeVisible();
      expect((await apiA.get(`/api/v1/crm/reports/snapshots/${reportSnapshot.id}`)).status()).toBe(403);
    });

    await test.step('Progress an evidenced sample into a quarantined quality ticket without cross-organization, commercial-role or private-file leakage', async () => {
      sampleRequest = await createRequest(apiA, ownerA, organizationA, 'en', productId, 1, 'sample_request');
      const sample = await record(maker, sampleRequest.id);
      expect(sample.collection).toBe('samples');
      await saveDomain(maker, sample.id, {schemaVersion: 1, kind: 'sample', opportunityId: convertedA.opportunityId, requestId: sampleRequest.id});
      const transition = async (value: Omit<CrmSampleTransitionInput, 'expectedVersion'>) => command<Workspace>(maker, `/crm/samples/${sample.id}/transition`, {...value, expectedVersion: (await workspace(maker)).version});
      await transition({to: 'reviewed'});
      const pixels = await sharp({create: {width: 16, height: 16, channels: 3, background: '#1d5275'}}).png().toBuffer();
      const currentSession = await get<Session>(maker, '/auth/session');
      const uploaded = await maker.post('/api/v1/attachments', {headers: {Origin: baseURL, 'X-CSRF-Token': currentSession.csrfToken, 'Idempotency-Key': randomUUID()}, multipart: {file: {name: `carrier-fixture-${runId}.png`, mimeType: 'image/png', buffer: pixels}, visibility: 'private', rights: 'true'}});
      const evidence = await json<{id: string; visibility: string; scanStatus: string; mimeType: string}>(uploaded, 201);
      expect(evidence.visibility).toBe('private');
      expect(evidence.scanStatus).toBe('clean');
      expect(evidence.mimeType).toBe('image/webp');
      // Real normalized pixels; there is no forged clean-scan database update.
      const shippedAt = new Date(Date.now() - 120000).toISOString(), receivedAt = new Date(Date.now() - 60000).toISOString();
      await transition({to: 'shipped', carrierEvidence: {carrier: 'Acceptance carrier fixture', trackingReference: `TRACK-${runId}`, shippedAt, evidenceAssetId: evidence.id}});
      await transition({to: 'received', receivedAt});
      await transition({to: 'evaluated', evaluation: {outcome: 'quality_concern', feedback: `Controlled sample-quality concern ${runId}; scientific follow-up required.`, evaluatedAt: now(), batch: `BATCH-${runId}`}});
      const commercialView = await domain(maker, sample.id), qualityView = await domain(approvedBy, sample.id);
      expect(commercialView.sample?.status).toBe('evaluated');
      expect(commercialView.sample?.qualityRequestId).toBeNull();
      qualityId = qualityView.sample?.qualityRequestId || '';
      expect(qualityId).toMatch(/^IM-REQ-/);
      const quality = await get<FrontRequest>(approvedBy, `/requests/${qualityId}`);
      expect(quality.kind).toBe('quality_complaint');
      expect(quality.ownerId).toBe(ownerA.id);
      expect(quality.batch).toBe(`BATCH-${runId}`);
      expect((await maker.get(`/api/v1/requests/${qualityId}`)).status()).toBe(404);
      expect((await apiB.get(`/api/v1/requests/${qualityId}`)).status()).toBe(404);
      expect((await apiB.get(`/api/v1/requests/${sampleRequest.id}`)).status()).toBe(404);
      expect((await maker.get(`/api/v1/crm/records/${sample.id}/evidence/${evidence.id}`)).status()).toBe(200);
      expect((await apiB.get(`/api/v1/attachments/${evidence.id}`)).status()).toBe(404);
      // An unrelated customer's inaccessible CRM record is intentionally 404;
      // the evidence route must not disclose the retained record's existence.
      expect((await apiB.get(`/api/v1/crm/records/${sample.id}/evidence/${evidence.id}`)).status()).toBe(404);
      const note = `Private scientific assessment ${runId}`;
      await json(await mutate(approvedBy, `/requests/${qualityId}`, {messages: [...quality.messages || [], {id: randomUUID(), body: note, visibility: 'internal', createdAt: now(), sender: approver.name}]}, 'PATCH', {'If-Match': String(quality.version)}));
      const customerQuality = await get<FrontRequest>(apiA, `/requests/${qualityId}`);
      expect(customerQuality.kind).toBe('quality_complaint');
      expect(customerQuality.status).not.toBe('closed');
      expect(customerQuality.messages?.some(message => message.visibility === 'internal')).toBe(false);
      expect(JSON.stringify(customerQuality)).not.toContain(note);
      expect((await workspace(maker)).state.records.some(row => row.id === qualityId)).toBe(false);
      const customerPage = await customerA.newPage();
      customerPage.on('pageerror', error => pageErrors.push(error.message));
      await customerPage.goto(`/en/account/requests?id=${encodeURIComponent(qualityId)}`);
      await expect(customerPage.locator('main')).toContainText(qualityId);
      await expect(customerPage.locator('main')).not.toContainText(note);
      const retainedReport = await get<CrmReportSnapshot>(maker, `/crm/reports/snapshots/${reportSnapshot.id}`);
      expect(retainedReport.checksum).toBe(reportSnapshot.checksum);
      expect(retainedReport.report).toEqual(reportSnapshot.report);
    });

    expect(pageErrors).toEqual([]);
    await testInfo.attach('crm-lifecycle-witness.json', {contentType: 'application/json', body: Buffer.from(JSON.stringify({
      scope: 'P08 / CRM-032; one desktop Chromium plus deployed HTTP witness; isolated acceptance identities only',
      runId, organizations: [organizationA.id, organizationB.id], pipeline: {id: pipeline.id, revisionId: pipeline.activeRevision?.id, makerId: policyMaker.id, reviewerId: approver.id},
      conversions: [convertedA, convertedB], rfqIds: [...requestsA.map(item => item.id), requestB.id],
      quotes: issued.map(item => ({id: item.quote.id, recordId: item.quote.recordId, requestId: item.request.id, locale: item.quote.locale, currency: item.quote.currency, amount: item.quote.amount, snapshotHash: item.quote.snapshotHash, fileSha256: item.pdfHash, fileByteCount: item.byteCount, pricebookRevisionId: item.quote.pricebookSnapshot?.id})),
      report: {id: reportSnapshot.id, checksum: reportSnapshot.checksum, groups: reportSnapshot.report.groups}, sampleRequestId: sampleRequest.id, qualityRequestId: qualityId,
      boundaries: {directDatabasePreparation: 'user accounts and user_settings only; real HTTP MFA enrollment', externalProviders: 'off', commercialData: 'HTTP commands only', multilingualDocuments: 'five independently approved locale snapshots and byte-verified HTTP PDF downloads', customerInterest: 'actual English browser portal and PDF downloads, both organization owners', exhaustiveRolesDevices: false},
    }, null, 2))});
  } finally {
    for (const context of contexts) await context.close();
  }
});
