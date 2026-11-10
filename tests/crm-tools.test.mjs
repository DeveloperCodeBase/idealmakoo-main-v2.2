import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const logic = await loadTs('src/components/workspace/crm-tools-logic.ts');
const { products } = await loadTs('src/data/catalog.ts');
const { workspaceRoles } = await loadTs('src/components/workspace/i18n.ts');
const text = value => ({ fa: value, en: value, tr: value, ar: value, ru: value });
const at = '2026-10-17T10:00:00.000Z';
const event = (id, body = id) => ({ id, text: text(body), actor: 'business', visibility: 'internal', at });
const record = (id, values = {}) => ({ id, collection: 'contacts', title: text(id), summary: text(`Ideal Makoo ${id}`), status: 'active', owner: 'business', updatedAt: at, createdAt: at, tags: [id], demo: true, history: [event(`${id}-before`)], email: `${id}@example.invalid`, ...values });
const mergeInput = { targetId: 'a', sourceId: 'b', choices: { email: 'source', summary: 'source' }, id: 'merge-1', at, actor: 'admin', message: text('Merged operational contacts') };

test('field-choice merge preserves source alias, target request ownership and separate identity/consent metadata', () => {
  const a = record('a', { requestId: 'request-a', details: { consent: { email: false }, userId: 'user-a' } });
  const b = record('b', { requestId: 'request-b', details: { consent: { email: true }, userId: 'user-b', privateSourceOnly: 'never copy' } });
  const input = [a, b]; const before = structuredClone(input);
  const result = logic.mergeCrmRecords(input, mergeInput);
  assert.equal(result.ok, true);
  const [target, source] = result.value.records;
  assert.equal(target.email, b.email);
  assert.equal(target.requestId, 'request-a');
  assert.deepEqual(target.details.consent, { email: false });
  assert.equal(target.details.userId, 'user-a');
  assert.equal(JSON.stringify(target.details).includes('privateSourceOnly'), false);
  assert.equal(source.requestId, 'request-b');
  assert.equal(source.status, 'archived');
  assert.equal(source.details.crmMergeAlias.targetId, 'a');
  assert.deepEqual(source.details.consent, { email: true });
  assert.deepEqual(input, before, 'Inputs remain untouched');
});

test('unmerge restores chosen values, removes inherited old activities, and preserves every post-merge activity and edit', () => {
  const merged = logic.mergeCrmRecords([record('a'), record('b')], mergeInput).value.records;
  const later = merged.map(item => item.id === 'a' ? { ...item, title: text('New target title'), history: [...item.history, event('a-after')] } : { ...item, history: [...item.history, event('b-after')] });
  const result = logic.unmergeCrmRecords(later, 'a', 'merge-1', { at, actor: 'admin', message: text('Unmerged') });
  assert.equal(result.ok, true);
  const [target, source] = result.value.records;
  assert.equal(target.title.en, 'New target title');
  assert.equal(target.email, 'a@example.invalid');
  assert.deepEqual(result.value.retainedFields, ['title']);
  assert.equal(target.history.some(item => item.id === 'a-after'), true);
  assert.equal(target.history.some(item => item.id === 'b-before'), false);
  assert.equal(source.history.some(item => item.id === 'b-after'), true);
  assert.equal(source.history.some(item => item.id === 'b-before'), true);
  assert.equal(source.status, 'active');
  assert.equal(source.details.crmMergeAlias, undefined);
  assert.equal(logic.getMergeOperations(target)[0].state, 'undone');
});

test('merge forbids user collections, incompatible types, self merges and undoing out of order', () => {
  assert.equal(logic.mergeCrmRecords([record('a', { collection: 'users' }), record('b', { collection: 'users' })], mergeInput).ok, false);
  assert.equal(logic.mergeCrmRecords([record('a'), record('b', { collection: 'leads' })], mergeInput).ok, false);
  assert.equal(logic.mergeCrmRecords([record('a')], { ...mergeInput, sourceId: 'a' }).ok, false);
  const one = logic.mergeCrmRecords([record('a'), record('b'), record('c')], mergeInput).value.records;
  const two = logic.mergeCrmRecords(one, { ...mergeInput, id: 'merge-2', sourceId: 'c' }).value.records;
  assert.equal(logic.unmergeCrmRecords(two, 'a', 'merge-1', { at, actor: 'admin', message: text('Undo') }).error, 'mergeOrder');
  assert.equal(logic.unmergeCrmRecords(two, 'a', 'merge-2', { at, actor: 'admin', message: text('Undo') }).ok, true);
});

const line = (id, price, quantity = '1', discount = '0', currency = 'USD') => ({ id, productId: 'apple', titleSnapshot: 'APPLE', unit: 'pack', quantityDecimal: quantity, unitPriceDecimal: price, discountPercentDecimal: discount, currency });
test('exact decimal arithmetic avoids binary floating point and rounds half-up per line', () => {
  const result = logic.calculateCommercial([line('1', '0.1', '3'), line('2', '0.005')], 'USD');
  assert.equal(result.ok, true);
  assert.equal(result.value.grandTotalDecimal, '0.31');
  assert.equal(result.value.lines[1].netDecimal, '0.01');
  assert.equal(logic.calculateCommercial([line('3', '0.05', '1', '10')], 'USD').value.grandTotalDecimal, '0.04');
  assert.equal(logic.calculateCommercial([line('4', '999999999999999.99', '2')], 'USD').value.grandTotalDecimal, '1999999999999999.98');
});

test('unknown prices remain null and are distinguishable from zero; currencies never mix', () => {
  const unknown = logic.calculateCommercial([line('1', '10'), line('2', null)], 'USD').value;
  assert.equal(unknown.complete, false); assert.equal(unknown.grandTotalDecimal, null);
  assert.equal(unknown.knownTotalDecimal, '10.00'); assert.equal(unknown.unknownLines, 1);
  assert.equal(logic.calculateCommercial([line('1', '0')], 'USD').value.grandTotalDecimal, '0.00');
  assert.equal(logic.calculateCommercial([line('1', '2'), line('2', '3', '1', '0', 'EUR')], 'USD').error, 'mixedCurrency');
});

test('decimal rules support Persian/Arabic digits, currency precision and 100 percent discount, rejecting malformed values', () => {
  assert.equal(logic.calculateCommercial([line('1', '۱۲٫۵', '۲', '۰', 'IRR')], 'IRR').value.grandTotalDecimal, '25');
  assert.equal(logic.calculateCommercial([line('1', '7.99', '3', '100')], 'USD').value.grandTotalDecimal, '0.00');
  assert.equal(logic.calculateCommercial([line('1', '2', '0')], 'USD').error, 'invalidQuantity');
  assert.equal(logic.calculateCommercial([line('1', '2', '1', '101')], 'USD').error, 'invalidDiscount');
  for (const price of ['-1', '1e3', '0.0000001', 'NaN', '1,000']) assert.equal(logic.calculateCommercial([line('1', price)], 'USD').ok, false, price);
  for (const malformed of [null, {}, [null], [{ ...line('1', '1'), unitPriceDecimal: 12 }], [{ ...line('1', '1'), quantityDecimal: null }]]) assert.equal(logic.calculateCommercial(malformed, 'USD').ok, false);
});

const context = { collection: 'contacts', locale: 'fa', actor: 'business', batchId: 'IMPORT-A', at, products, roles: workspaceRoles };
test('CSV parser handles UTF-8 BOM, quoted commas, multiline cells and escaped quotes; broken files are rejected', () => {
  const parsed = logic.readImportCsv('\uFEFFtitle,summary\r\n"لابراتوار، نمونه","APPLE, DENTEX\n""verified source"""');
  assert.equal(parsed.ok, true); assert.equal(parsed.value.rows[0][1], 'APPLE, DENTEX\n"verified source"');
  assert.equal(logic.readImportCsv('title\n"unfinished').error, 'csvQuotes');
  assert.equal(logic.readImportCsv('title\n"ok"junk').error, 'csvQuotes');
  assert.equal(logic.readImportCsv('title\n').error, 'csvRows');
});

test('CSV mapping accepts shared email without merging people and preserves unknown amounts', () => {
  const table = logic.readImportCsv('organization,title,email,product,amount,currency\nDemo lab,Person A,shared@example.invalid,apple,,IRR\nDemo lab,Person B,shared@example.invalid,apple,0,IRR').value;
  const existing = [record('old', { email: 'shared@example.invalid' })];
  const rows = logic.prepareCrmImport(table, logic.guessImportMapping(table.headers), existing, context);
  assert.equal(rows.every(row => !row.errors.length), true);
  assert.equal(rows.every(row => row.warnings.includes('sharedEmail')), true);
  const result = logic.applyCrmImport(existing, rows);
  assert.equal(result.ok, true); assert.equal(result.value.length, 3);
  assert.equal(result.value[0].amount, null); assert.equal(result.value[1].amount, '0');
});

test('import validates row errors and commits all or none, including dates, product IDs and privilege status', () => {
  const table = logic.readImportCsv('title,email,product,due\nDemo A,valid@example.invalid,apple,2026-10-17\nDemo B,broken,missing,2026-02-30').value;
  const input = [record('existing')]; const before = structuredClone(input);
  const rows = logic.prepareCrmImport(table, logic.guessImportMapping(table.headers), input, context);
  assert.deepEqual(rows[1].errors, ['importEmail', 'importProduct', 'importDate']);
  assert.equal(logic.applyCrmImport(input, rows).error, 'importBlocked');
  assert.deepEqual(input, before);
  const quotes = logic.readImportCsv('title,status\nUnauthorized proposal,approved').value;
  assert.equal(logic.prepareCrmImport(quotes, logic.guessImportMapping(quotes.headers), [], { ...context, collection: 'quotes' })[0].errors.includes('importStatus'), true);
});

test('import detects repeated rows/external IDs and rechecks concurrent imports at atomic commit', () => {
  const table = logic.readImportCsv('title,externalId\nDemo A,EXT-A\nDemo B,EXT-A').value;
  const rows = logic.prepareCrmImport(table, logic.guessImportMapping(table.headers), [], context);
  assert.equal(rows[1].errors.includes('importDuplicate'), true);
  const valid = rows.slice(0, 1);
  const first = logic.applyCrmImport([], valid).value;
  assert.equal(logic.applyCrmImport(first, valid).error, 'importDuplicate');
  const changed = logic.readImportCsv('title,externalId\nRevised text,EXT-A').value;
  const newPreview = logic.prepareCrmImport(changed, logic.guessImportMapping(changed.headers), [], { ...context, batchId: 'IMPORT-B' });
  assert.equal(logic.applyCrmImport(first, newPreview).error, 'importDuplicate');
});
