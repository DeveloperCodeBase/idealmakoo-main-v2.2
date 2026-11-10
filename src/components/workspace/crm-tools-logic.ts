import type { WorkspaceActivity, WorkspaceRecord } from '@/data/workspace-seed';
import type { WorkspaceLocale, WorkspaceText } from './i18n';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const mergeFields = ['title', 'summary', 'organization', 'email', 'product', 'owner', 'priority', 'due'] as const;
export type MergeField = typeof mergeFields[number];
type MergeSnapshot = Pick<WorkspaceRecord, MergeField | 'status' | 'tags'>;
export interface MergeOperation {
  id: string; targetId: string; sourceId: string; collection: string; at: string; actor: string;
  state: 'merged' | 'undone'; undoneAt?: string;
  beforeTarget: MergeSnapshot; afterTarget: MergeSnapshot;
  beforeSourceStatus: string; beforeSourceArchivedFrom?: string;
  importedActivityIds: string[]; retainedFields?: string[];
}
const clone = <T>(value: T): T => structuredClone(value);
const snapshot = (record: WorkspaceRecord): MergeSnapshot => ({
  title: clone(record.title), summary: clone(record.summary), organization: record.organization,
  email: record.email, product: record.product, owner: record.owner, priority: record.priority,
  due: record.due, status: record.status, tags: [...record.tags],
});
export function getMergeOperations(record: WorkspaceRecord): MergeOperation[] {
  const value = record.details?.crmMergeOperations;
  return Array.isArray(value) ? value.filter((item): item is MergeOperation => !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.sourceId === 'string' && !!item.beforeTarget && !!item.afterTarget && Array.isArray(item.importedActivityIds)) : [];
}
const uniqueActivities = (events: WorkspaceActivity[]) => events.filter((event, index) => events.findIndex(item => item.id === event.id) === index);

/** Operational records only. Login identities, memberships, consent and source details are never copied. */
export function mergeCrmRecords(records: WorkspaceRecord[], input: {
  targetId: string; sourceId: string; choices: Partial<Record<MergeField, 'target' | 'source'>>;
  id: string; at: string; actor: string; message: WorkspaceText;
}): Result<{ records: WorkspaceRecord[]; operation: MergeOperation }> {
  const target = records.find(record => record.id === input.targetId);
  const source = records.find(record => record.id === input.sourceId);
  if (!target || !source || target.id === source.id) return { ok: false, error: 'selectTwo' };
  if (target.collection !== source.collection || !['accounts', 'contacts', 'leads'].includes(target.collection)) return { ok: false, error: 'mergeCollection' };
  if ([source.status, target.status].includes('archived') || source.details?.crmMergeAlias || target.details?.crmMergeAlias) return { ok: false, error: 'mergeArchived' };
  if (records.some(record => getMergeOperations(record).some(operation => operation.id === input.id))) return { ok: false, error: 'duplicateOperation' };
  const chosen = clone(target);
  for (const field of mergeFields) {
    if (input.choices[field] === 'source') Object.assign(chosen, { [field]: clone(source[field]) });
  }
  chosen.tags = [...new Set([...target.tags, ...source.tags])];
  const importedActivityIds = source.history.filter(event => !target.history.some(existing => existing.id === event.id)).map(event => event.id);
  const operation: MergeOperation = {
    id: input.id, targetId: target.id, sourceId: source.id, collection: target.collection,
    at: input.at, actor: input.actor, state: 'merged', beforeTarget: snapshot(target),
    afterTarget: snapshot(chosen), beforeSourceStatus: source.status,
    beforeSourceArchivedFrom: source.archivedFrom, importedActivityIds,
  };
  const activity: WorkspaceActivity = { id: `${input.id}-merge`, at: input.at, actor: input.actor, text: input.message, visibility: 'internal' };
  chosen.history = [...uniqueActivities([...target.history, ...source.history]), activity];
  chosen.updatedAt = input.at;
  chosen.details = { ...target.details, crmMergeOperations: [...getMergeOperations(target), operation] };
  const alias: WorkspaceRecord = {
    ...source, status: 'archived', archivedFrom: source.status, updatedAt: input.at,
    history: [...source.history, activity],
    details: { ...source.details, crmMergeAlias: { operationId: input.id, targetId: target.id, at: input.at } },
  };
  return { ok: true, value: { records: records.map(record => record.id === target.id ? chosen : record.id === source.id ? alias : record), operation } };
}

/** Unmerge in reverse operation order; later field edits and all newly recorded activities survive. */
export function unmergeCrmRecords(records: WorkspaceRecord[], targetId: string, operationId: string, meta: {
  at: string; actor: string; message: WorkspaceText;
}): Result<{ records: WorkspaceRecord[]; retainedFields: string[] }> {
  const target = records.find(record => record.id === targetId);
  if (!target || target.details?.crmMergeAlias) return { ok: false, error: 'mergeOrder' };
  const operations = getMergeOperations(target);
  const operation = operations.find(item => item.id === operationId && item.state === 'merged');
  if (!operation || operations.filter(item => item.state === 'merged').at(-1)?.id !== operationId) return { ok: false, error: 'mergeOrder' };
  const source = records.find(record => record.id === operation.sourceId);
  const alias = source?.details?.crmMergeAlias as { operationId?: string } | undefined;
  if (!source || alias?.operationId !== operationId) return { ok: false, error: 'mergeChanged' };
  const restored = clone(target);
  const retainedFields: string[] = [];
  for (const field of mergeFields) {
    if (JSON.stringify(target[field]) === JSON.stringify(operation.afterTarget[field])) Object.assign(restored, { [field]: clone(operation.beforeTarget[field]) });
    else retainedFields.push(field);
  }
  restored.tags = [...new Set([...operation.beforeTarget.tags, ...target.tags.filter(tag => !operation.afterTarget.tags.includes(tag))])];
  const activity: WorkspaceActivity = { id: `${operationId}-undo`, at: meta.at, actor: meta.actor, text: meta.message, visibility: 'internal' };
  restored.history = [...target.history.filter(event => !operation.importedActivityIds.includes(event.id)), activity];
  restored.updatedAt = meta.at;
  restored.details = { ...target.details, crmMergeOperations: operations.map(item => item.id === operationId ? { ...item, state: 'undone', undoneAt: meta.at, retainedFields } : item) };
  const sourceDetails = { ...source.details };
  delete sourceDetails.crmMergeAlias;
  const restoredSource = {
    ...source, status: source.status === 'archived' ? operation.beforeSourceStatus : source.status,
    archivedFrom: operation.beforeSourceArchivedFrom, details: sourceDetails,
    updatedAt: meta.at, history: [...source.history, activity],
  };
  return { ok: true, value: { records: records.map(record => record.id === targetId ? restored : record.id === source.id ? restoredSource : record), retainedFields } };
}

export const currencies = ['IRR', 'USD', 'EUR', 'TRY', 'RUB'] as const;
export type Currency = typeof currencies[number];
export const currencyScale: Record<Currency, number> = { IRR: 0, USD: 2, EUR: 2, TRY: 2, RUB: 2 };
export interface CommercialLine {
  id: string; productId: string; titleSnapshot: string; unit: string; quantityDecimal: string;
  unitPriceDecimal: string | null; discountPercentDecimal: string; currency: Currency;
}
export interface LineEstimate {
  lineId: string; grossDecimal: string | null; discountDecimal: string | null; netDecimal: string | null;
}
export interface CommercialEstimate {
  currency: Currency; complete: boolean; subtotalDecimal: string | null; discountDecimal: string | null;
  grandTotalDecimal: string | null; knownTotalDecimal: string; unknownLines: number; lines: LineEstimate[];
}
export interface CommercialDraft {
  pricebookRevisionId?: string;
  schemaVersion: 1; kind: 'quote' | 'pricebook'; locale: WorkspaceLocale; currency: Currency;
  lines: CommercialLine[]; estimate: CommercialEstimate; calculationPolicyVersion: 'local-line-half-up-v1';
  serverRecalculationRequired: true; updatedAt: string;
}
export function normalizeDecimal(value: string) {
  return value.trim().replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/٫/g, '.');
}
function decimal(value: string): { coefficient: bigint; scale: number } | null {
  const normalized = normalizeDecimal(value);
  if (normalized.length > 32 || !/^\d+(?:\.\d{1,6})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return { coefficient: BigInt(whole + fraction), scale: fraction.length };
}
const pow10 = (scale: number) => 10n ** BigInt(scale);
const roundHalfUp = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (2n * denominator);
const fixed = (minor: bigint, scale: number) => {
  const text = minor.toString().padStart(scale + 1, '0');
  return scale ? `${text.slice(0, -scale)}.${text.slice(-scale)}` : text;
};
/** Every number remains an integer ratio until currency rounding. No floating point or FX conversion. */
export function calculateCommercial(lines: CommercialLine[], currency: Currency): Result<CommercialEstimate> {
  if (!currencies.includes(currency) || !Array.isArray(lines) || !lines.length || lines.length > 100) return { ok: false, error: 'commercialLines' };
  const scale = currencyScale[currency];
  let gross = 0n, discount = 0n, knownTotal = 0n, unknownLines = 0;
  const estimates: LineEstimate[] = [];
  const ids = new Set<string>();
  for (const line of lines) {
    if (!line || typeof line !== 'object' || ![line.id, line.productId, line.titleSnapshot, line.unit].every(value => typeof value === 'string' && value.trim()) || ids.has(line.id)) return { ok: false, error: 'commercialLines' };
    ids.add(line.id);
    if (line.currency !== currency) return { ok: false, error: 'mixedCurrency' };
    if (typeof line.quantityDecimal !== 'string') return { ok: false, error: 'invalidQuantity' };
    if (typeof line.discountPercentDecimal !== 'string') return { ok: false, error: 'invalidDiscount' };
    if (line.unitPriceDecimal !== null && typeof line.unitPriceDecimal !== 'string') return { ok: false, error: 'invalidPrice' };
    const quantity = decimal(line.quantityDecimal), percent = decimal(line.discountPercentDecimal);
    if (!quantity || quantity.coefficient <= 0n) return { ok: false, error: 'invalidQuantity' };
    if (!percent || percent.coefficient > 100n * pow10(percent.scale)) return { ok: false, error: 'invalidDiscount' };
    if (line.unitPriceDecimal === null || line.unitPriceDecimal.trim() === '') {
      unknownLines++; estimates.push({ lineId: line.id, grossDecimal: null, discountDecimal: null, netDecimal: null }); continue;
    }
    const price = decimal(line.unitPriceDecimal);
    if (!price) return { ok: false, error: 'invalidPrice' };
    const lineGross = roundHalfUp(quantity.coefficient * price.coefficient * pow10(scale), pow10(quantity.scale + price.scale));
    const lineDiscount = roundHalfUp(lineGross * percent.coefficient, 100n * pow10(percent.scale));
    const net = lineGross - lineDiscount;
    gross += lineGross; discount += lineDiscount; knownTotal += net;
    estimates.push({ lineId: line.id, grossDecimal: fixed(lineGross, scale), discountDecimal: fixed(lineDiscount, scale), netDecimal: fixed(net, scale) });
  }
  return { ok: true, value: {
    currency, complete: unknownLines === 0, subtotalDecimal: unknownLines ? null : fixed(gross, scale),
    discountDecimal: unknownLines ? null : fixed(discount, scale), grandTotalDecimal: unknownLines ? null : fixed(knownTotal, scale),
    knownTotalDecimal: fixed(knownTotal, scale), unknownLines, lines: estimates,
  } };
}

export const importFields = ['title', 'summary', 'organization', 'email', 'product', 'owner', 'status', 'amount', 'currency', 'due', 'priority', 'tags', 'externalId'] as const;
export type ImportField = typeof importFields[number];
export type ImportMapping = Partial<Record<ImportField, number>>;
export interface ImportTable { headers: string[]; rows: string[][] }
export interface ImportPreviewRow { line: number; title: string; record?: WorkspaceRecord; errors: string[]; warnings: string[] }
export interface ImportContext {
  collection: string; locale: WorkspaceLocale; actor: string; batchId: string; at: string;
  products: { id: string; slug: string; brand: string; name: Record<string, string> }[]; roles: readonly string[];
}
export function readImportCsv(text: string): Result<ImportTable> {
  if (text.length > 1_000_000) return { ok: false, error: 'csvSize' };
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"') {
      if (cell.length || closed) return { ok: false, error: 'csvQuotes' };
      quoted = true;
    } else if (char === ',') { row.push(cell.trim()); cell = ''; closed = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; closed = false;
    } else if (closed && char.trim()) return { ok: false, error: 'csvQuotes' };
    else if (!closed) cell += char;
  }
  if (quoted) return { ok: false, error: 'csvQuotes' };
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2 || rows.length > 501 || rows[0].length > 30) return { ok: false, error: 'csvRows' };
  return { ok: true, value: { headers: rows[0], rows: rows.slice(1) } };
}
export function guessImportMapping(headers: string[]): ImportMapping {
  const aliases: Record<ImportField, string[]> = {
    title: ['title', 'name', 'نام', 'عنوان', 'ad', 'اسم', 'название'], summary: ['summary', 'description', 'شرح', 'توضیحات'],
    organization: ['organization', 'company', 'سازمان', 'شرکت'], email: ['email', 'ایمیل', 'e-mail'], product: ['product', 'productid', 'محصول'],
    owner: ['owner', 'مسئول'], status: ['status', 'وضعیت'], amount: ['amount', 'مبلغ'], currency: ['currency', 'ارز'],
    due: ['due', 'date', 'موعد'], priority: ['priority', 'اولویت'], tags: ['tags', 'برچسب'], externalId: ['externalid', 'external_id', 'شناسه خارجی'],
  };
  return Object.fromEntries(importFields.map(field => [field, headers.findIndex(header => aliases[field].includes(header.trim().toLowerCase()))]).filter(([, index]) => Number(index) >= 0)) as ImportMapping;
}
const stableFingerprint = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
};
const texts = (value: string): WorkspaceText => ({ fa: value, en: value, tr: value, ar: value, ru: value });
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
export function prepareCrmImport(table: ImportTable, mapping: ImportMapping, existing: WorkspaceRecord[], context: ImportContext): ImportPreviewRow[] {
  const seen = new Set<string>();
  return table.rows.map((row, index) => {
    const get = (field: ImportField) => mapping[field] === undefined ? '' : (row[mapping[field]!] || '').trim();
    const title = get('title'); const errors: string[] = [], warnings: string[] = [];
    if (!title || title.length > 250) errors.push('importTitle');
    if (row.length !== table.headers.length) errors.push('csvColumns');
    if (row.some(cell => cell.length > 6000)) errors.push('csvCell');
    const email = get('email');
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.push('importEmail');
    const productValue = get('product').toLocaleLowerCase();
    const product = productValue ? context.products.find(item => [item.id, item.slug, item.brand, ...Object.values(item.name)].some(value => value.toLocaleLowerCase() === productValue)) : undefined;
    if (productValue && !product) errors.push('importProduct');
    const owner = get('owner') || context.actor;
    if (!context.roles.includes(owner)) errors.push('importOwner');
    const amount = get('amount') ? normalizeDecimal(get('amount')) : null;
    if (amount !== null && !decimal(amount)) errors.push('invalidPrice');
    const currency = (get('currency') || 'IRR').toUpperCase();
    if (!currencies.includes(currency as Currency)) errors.push('importCurrency');
    const due = get('due'); if (due && !validDate(due)) errors.push('importDate');
    const priority = get('priority') || 'normal'; if (!['normal', 'high', 'low'].includes(priority)) errors.push('importPriority');
    const status = get('status') || (['quotes', 'pricebooks'].includes(context.collection) ? 'draft' : 'new');
    const allowed = ['quotes', 'pricebooks'].includes(context.collection) ? ['draft'] : ['new', 'working', 'active', 'inactive', 'nurture', 'qualified', 'disqualified', 'open', 'closed'];
    if (!allowed.includes(status)) errors.push('importStatus');
    const canonical = JSON.stringify(importFields.map(field => [field, get(field)]));
    const fingerprint = `${context.collection}:${stableFingerprint(canonical)}`;
    const externalId = get('externalId');
    const duplicateKey = externalId ? `${context.collection}:external:${externalId}` : fingerprint;
    if (seen.has(duplicateKey) || existing.some(record => record.collection === context.collection && (record.details?.importFingerprint === fingerprint || (externalId && (record.details?.importOrigin as { externalId?: string } | undefined)?.externalId === externalId)))) errors.push('importDuplicate');
    seen.add(duplicateKey);
    if (email && existing.some(record => record.collection === context.collection && record.email?.toLowerCase() === email.toLowerCase())) warnings.push('sharedEmail');
    const record: WorkspaceRecord = {
      id: `${context.batchId}-${index + 1}`, collection: context.collection, title: texts(title), summary: texts(get('summary')),
      organization: get('organization'), email, product: product?.id, owner, status, amount, currency, due: due || undefined,
      priority: priority as WorkspaceRecord['priority'], tags: [...new Set(['imported', ...get('tags').split(/[;|]/).map(tag => tag.trim()).filter(Boolean)])],
      createdAt: context.at, updatedAt: context.at, author: context.actor, demo: true, history: [],
      details: { importFingerprint: fingerprint, importOrigin: { batchId: context.batchId, row: index + 2, externalId: externalId || undefined, source: 'user-selected-csv' } },
    };
    return { line: index + 2, title, errors, warnings, ...(errors.length ? {} : { record }) };
  });
}
/** All-or-nothing import. Recheck against current state immediately before committing. */
export function applyCrmImport(existing: WorkspaceRecord[], preview: ImportPreviewRow[]): Result<WorkspaceRecord[]> {
  if (!preview.length || preview.some(row => row.errors.length || !row.record)) return { ok: false, error: 'importBlocked' };
  const incoming = preview.map(row => row.record!);
  const keys = new Set(existing.map(record => record.id));
  const fingerprints = new Set(existing.map(record => record.details?.importFingerprint).filter(Boolean));
  const externalKeys = new Set(existing.flatMap(record => { const externalId = (record.details?.importOrigin as { externalId?: string } | undefined)?.externalId; return externalId ? [`${record.collection}:${externalId}`] : []; }));
  for (const record of incoming) {
    const externalId = (record.details?.importOrigin as { externalId?: string } | undefined)?.externalId;
    const externalKey = externalId ? `${record.collection}:${externalId}` : undefined;
    if (keys.has(record.id) || fingerprints.has(record.details?.importFingerprint) || (externalKey && externalKeys.has(externalKey))) return { ok: false, error: 'importDuplicate' };
    keys.add(record.id); if (record.details?.importFingerprint) fingerprints.add(record.details.importFingerprint);
    if (externalKey) externalKeys.add(externalKey);
  }
  return { ok: true, value: [...incoming, ...existing] };
}
