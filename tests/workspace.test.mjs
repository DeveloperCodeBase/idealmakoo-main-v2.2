import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const data = await loadTs('src/data/workspace-seed.ts');
const workspace = await loadTs('src/components/workspace/store.ts');
const i18n = await loadTs('src/components/workspace/i18n.ts');
const seed = data.createWorkspaceSeed();

test('workspace seeds exactly 17 official products and 13 source research articles', () => {
  assert.equal(seed.records.filter(r => r.collection === 'products' && !r.demo).length, 17);
  assert.equal(seed.records.filter(r => r.collection === 'research' && !r.demo).length, 13);
});

test('ten page drafts have independent identities in all five locales', () => {
  for (const locale of i18n.workspaceLocales) assert.equal(seed.pages.filter(p => p.locale === locale).length, 10);
  assert.equal(new Set(seed.pages.map(page => page.id)).size, 50);
});

test('all 28 distinct CMS blocks have complete five-language names', () => {
  assert.equal(i18n.blockTypes.length, 28);
  assert.equal(new Set(i18n.blockTypes.map(block => block[0])).size, 28);
  for (const [, labels] of i18n.blockTypes) for (const locale of i18n.workspaceLocales) assert.ok(labels[locale]?.trim());
});

test('twelve required roles are seeded and customer operations are denied', () => {
  assert.equal(seed.records.filter(r => r.collection === 'staff').length, 12);
  for (const section of ['pages', 'products', 'leads', 'quotes', 'tickets', 'settings']) assert.equal(workspace.canEdit('customer', section), false);
});

test('unknown proposal amounts remain null and are never fabricated as zero', () => {
  for (const record of seed.records.filter(r => ['quotes', 'opportunities'].includes(r.collection))) assert.equal(record.amount, null);
});

const request = {
  id: 'request-test-1', kind: 'rfq', name: 'Demo laboratory', email: 'lab@example.invalid',
  organization: 'DEMO', message: 'Technical inquiry', productIds: ['apple'], status: 'received',
  createdAt: '2026-10-17T11:00:00Z', messages: [
    { id: 'public-1', body: 'Customer follow-up', visibility: 'public', sender: 'customer', createdAt: '2026-10-17T12:00:00Z' },
    { id: 'private-1', body: 'Internal excluded', visibility: 'internal', sender: 'admin', createdAt: '2026-10-17T12:00:00Z' },
  ],
};

test('website RFQ creates one attributable new lead with preserved customer identity', () => {
  const merged = workspace.mergeWorkspaceRequests(seed, [request]);
  const lead = merged.records.find(record => record.id === request.id);
  assert.equal(lead.collection, 'leads');
  assert.equal(lead.status, 'new');
  assert.equal(lead.requestId, request.id);
  assert.equal(lead.email, request.email);
  assert.equal(lead.product, 'apple');
  assert.equal(lead.demo, false);
});

test('public conversation import excludes internal messages and is idempotent', () => {
  const merged = workspace.mergeWorkspaceRequests(seed, [request]);
  const lead = merged.records.find(record => record.id === request.id);
  assert.ok(lead.history.some(message => message.id === 'public-1'));
  assert.ok(!lead.history.some(message => message.id === 'private-1'));
  assert.equal(workspace.mergeWorkspaceRequests(merged, [request]), merged);
});

test('jobs, callback, event registration and privacy requests never become sales leads', () => {
  const requests = ['job_application', 'callback', 'event_registration', 'data_deletion'].map((kind, i) => ({ ...request, id: `non-lead-${i}`, kind }));
  const merged = workspace.mergeWorkspaceRequests(seed, requests);
  for (const item of requests) assert.notEqual(merged.records.find(record => record.id === item.id).collection, 'leads');
  assert.equal(merged.records.find(record => record.id === 'non-lead-0').collection, 'hr');
});

test('quality complaints become restricted high-priority service records', () => {
  const quality = workspace.mergeWorkspaceRequests(seed, [{ ...request, id: 'quality', kind: 'quality_complaint' }]).records.find(record => record.id === 'quality');
  assert.equal(quality.collection, 'tickets');
  assert.equal(quality.priority, 'high');
  assert.ok(quality.tags.includes('quality'));
});

test('a subsequent public reply reaches the existing case only once', () => {
  const first = workspace.mergeWorkspaceRequests(seed, [request]);
  const replied = { ...request, messages: [...request.messages, { id: 'reply-2', body: 'Additional specifications', visibility: 'public', sender: 'customer', createdAt: '2026-10-17T13:00:00Z' }] };
  const second = workspace.mergeWorkspaceRequests(first, [replied]);
  assert.equal(second.records.find(record => record.id === request.id).history.filter(message => message.id === 'reply-2').length, 1);
  assert.equal(workspace.mergeWorkspaceRequests(second, [replied]), second);
});

test('customer quote interest reaches sales without changing the opportunity stage', () => {
  const merged = workspace.mergeWorkspaceRequests(seed, [request]);
  const quote = { ...seed.records.find(record => record.collection === 'quotes'), id: 'quote-response', requestId: request.id, status: 'proposal' };
  const response = { ...request, sharedQuotes: [{ id: quote.id, status: 'accepted_interest', customerResponse: 'Please follow up', respondedAt: '2026-10-17T13:00:00Z' }] };
  const after = workspace.mergeWorkspaceRequests({ ...merged, records: [quote, ...merged.records] }, [response]);
  const acknowledged = after.records.find(record => record.id === quote.id);
  assert.equal(acknowledged.quoteResponse.status, 'accepted_interest');
  assert.equal(acknowledged.status, 'proposal');
  assert.ok(acknowledged.history.some(event => event.actor === 'customer' && event.text.en.includes('interest')));
  assert.equal(workspace.mergeWorkspaceRequests(after, [response]), after);
});

test('editor preview rejects script and protocol-relative URLs', () => {
  assert.equal(workspace.safeUrl('javascript:alert(1)'), false);
  assert.equal(workspace.safeUrl('//invalid.example'), false);
  assert.equal(workspace.safeUrl('https://idealmakoo.com/pages/6/apple'), true);
  assert.equal(workspace.safeUrl('/media/official/product.jpg'), true);
});


test('published custom form answers appear once in the form response collection and shared inbox', () => {
  const input = {...request,id:'CMS-REQ-1',kind:'cms_form',formId:'technical-inquiry',formVersion:2,formValues:{message:'Factory form answer'}};
  const first = workspace.mergeWorkspaceRequests(seed,[input]);
  assert.equal(first.records.find(record=>record.id===input.id).collection,'inbox');
  const form = first.forms.find(form=>form.id==='technical-inquiry');
  assert.equal(form.responses.length,1);
  assert.equal(form.responses[0].values.message,'Factory form answer');
  assert.equal(workspace.mergeWorkspaceRequests(first,[input]),first);
});
