'use client';

import { useMemo, useRef, useState } from 'react';
import {demoMode} from '@/lib/api';
import CommercialEditor from './CommercialEditor';
import Link from 'next/link';
import { canWorkspace } from '@/lib/auth';
import { ArrowLeftRight, ArrowRight, Check, CheckCircle2, ClipboardCheck, Download, FileSpreadsheet, GitMerge, GitPullRequestArrow, Layers3, Plus, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { products as canonicalProducts, type Product } from '@/data/catalog';
import { workspaceProducts } from '@/lib/custom-products';
import { catalogFromPublications, getPublishedProductInventory, usePublications } from '@/lib/publications';
import type { WorkspaceRecord } from '@/data/workspace-seed';
import { canEdit, downloadFile, now, uid, type WorkspaceStore } from './store';
import { L, localized, workspaceLocales, workspaceRoles, wt, type WorkspaceText } from './i18n';
import { Field, Modal, Pager, safeDate } from './ui';
import { ct } from './crm-tools-copy';
import { applyCrmImport, calculateCommercial, currencies, getMergeOperations, guessImportMapping, importFields, mergeCrmRecords, mergeFields, normalizeDecimal, prepareCrmImport, readImportCsv, unmergeCrmRecords, type CommercialDraft, type CommercialLine, type Currency, type ImportMapping, type ImportTable, type MergeField } from './crm-tools-logic';
import './crm-tools.css';

interface Props { collection: string; store: WorkspaceStore }
const operationalCollections = ['accounts', 'contacts', 'leads', 'activities', 'opportunities', 'quotes', 'pricebooks', 'samples', 'handoffs', 'partners', 'tickets', 'segments', 'campaigns', 'inbox', 'automations', 'success'];
const textFor = (key: string): WorkspaceText => Object.fromEntries(workspaceLocales.map(locale => [locale, ct(key, locale)])) as WorkspaceText;
const fieldLabel = (field: string, locale: string) => field === 'externalId' ? ct(field, locale) : wt(({ summary: 'description', product: 'products' } as Record<string, string>)[field] || field, locale);

const productLabel = (product: Product, locale: string) => product.name[locale as typeof workspaceLocales[number]]?.trim() || workspaceLocales.map(language => product.name[language]?.trim()).find(Boolean) || product.brand || product.id;
function useCurrentProducts(store: WorkspaceStore): Product[] {
  const publications = usePublications();
  return useMemo(() => [...new Map([
    ...workspaceProducts(store.state.records),
    ...getPublishedProductInventory(),
    ...catalogFromPublications(publications, store.locale).filter(product => product.localPublication),
  ].map(product => [product.id, product])).values()], [store.state.records, store.locale, publications]);
}

/** Add alongside RecordsDesk. Each tool commits one structured local state transition. */
export function CrmTools({ collection, store }: Props) {
  const [tool, setTool] = useState<'merge' | 'import' | 'commercial' | null>(null);
  if (!operationalCollections.includes(collection)||!canWorkspace(store.role,'view',collection)) return null;
  const mergeable = ['accounts', 'contacts', 'leads'].includes(collection);
  const commercial = ['quotes', 'pricebooks'].includes(collection)&&(demoMode||store.actor.crmAccess?.permissions.financial===true);
  const allowed = canEdit(store.role, collection);
  return <section className="crm-tools" aria-label={ct('tools', store.locale)}>
    <div className="crm-tools-title"><Layers3 size={17}/><strong>{ct('tools', store.locale)}</strong><span>{ct('toolsHint', store.locale)}</span></div>
    <div className="crm-tools-launchers">
      {mergeable && <button className="crm-tool-launcher" disabled={!canWorkspace(store.role,'merge',collection)} onClick={() => setTool('merge')}><span className="crm-tool-symbol"><GitMerge size={23}/></span><span><strong>{ct('merge', store.locale)}</strong><small>{ct('mergeHint', store.locale)}</small></span><ArrowRight size={18}/></button>}
      {demoMode?<button className="crm-tool-launcher" disabled={!canWorkspace(store.role,'import',collection)} onClick={() => setTool('import')}><span className="crm-tool-symbol crm-tool-violet"><FileSpreadsheet size={23}/></span><span><strong>{ct('import', store.locale)}</strong><small>{ct('importHint', store.locale)}</small></span><ArrowRight size={18}/></button>:<Link className="crm-tool-launcher" href={`/${store.locale}/admin/crm/data/`}><span className="crm-tool-symbol crm-tool-violet"><FileSpreadsheet size={23}/></span><span><strong>{ct('import',store.locale)}</strong><small>{ct('importHint',store.locale)}</small></span><ArrowRight size={18}/></Link>}
      {commercial && <button className="crm-tool-launcher" disabled={!allowed} onClick={() => setTool('commercial')}><span className="crm-tool-symbol"><ClipboardCheck size={23}/></span><span><strong>{ct('commercial', store.locale)}</strong><small>{ct('commercialHint', store.locale)}</small></span><ArrowRight size={18}/></button>}
    </div>
    {tool === 'merge' && <MergeTool collection={collection} store={store} onClose={() => setTool(null)}/>}
    {tool === 'import' && <ImportTool collection={collection} store={store} onClose={() => setTool(null)}/>}
    {tool === 'commercial' && (demoMode?<CommercialTool collection={collection} store={store} onClose={() => setTool(null)}/>:<CommercialEditor collection={collection==='pricebooks'?'pricebooks':'quotes'} store={store} onClose={() => setTool(null)}/>)}
  </section>;
}

function MergeTool({ collection, store, onClose }: Props & { onClose: () => void }) {
  const { locale, state } = store;
  const records = state.records.filter(record => record.collection === collection && record.status !== 'archived' && !record.details?.crmMergeAlias);
  const [targetId, setTargetId] = useState(records[0]?.id || '');
  const [sourceId, setSourceId] = useState('');
  const [choices, setChoices] = useState<Partial<Record<MergeField, 'target' | 'source'>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const target = records.find(record => record.id === targetId);
  const source = records.find(record => record.id === sourceId);
  const history = state.records.filter(record => record.collection === collection).flatMap(record => getMergeOperations(record).map(operation => ({ record, operation })));
  const value = (record: WorkspaceRecord, field: MergeField) => field === 'title' || field === 'summary' ? localized(record[field], locale) : String(record[field] || '—');
  const select = (side: 'target' | 'source', id: string) => { if (side === 'target') setTargetId(id); else setSourceId(id); setChoices({}); setConfirmed(false); };
  const merge = async () => {
    if (!confirmed) return;
    const input = { targetId, sourceId, choices, id: uid('MERGE'), at: now(), actor: store.role, message: textFor('mergeDone') };
    const result = mergeCrmRecords(state.records, input);
    if (!result.ok) return store.notify(ct(result.error, locale));
    const event = store.log(textFor('mergeDone'));
    if(!await store.update(previous => { const current = mergeCrmRecords(previous.records, input); return current.ok ? { ...previous, records: current.value.records, audit: [event, ...previous.audit] } : previous; }, ct('mergeDone', locale)))return;
    setSourceId(''); setConfirmed(false);
  };
  const undo = async (recordId: string, operationId: string) => {
    const meta = { at: now(), actor: store.role, message: textFor('unmergeDone') };
    const result = unmergeCrmRecords(state.records, recordId, operationId, meta);
    if (!result.ok) return store.notify(ct(result.error, locale));
    const event = store.log(textFor('unmergeDone'));
    if(!await store.update(previous => { const current = unmergeCrmRecords(previous.records, recordId, operationId, meta); return current.ok ? { ...previous, records: current.value.records, audit: [event, ...previous.audit] } : previous; }, ct('unmergeDone', locale)))return;
  };
  return <Modal title={ct('merge', locale)} onClose={onClose} wide><div className="crm-tool-body">
    <div className="crm-tool-notice"><ShieldCheck size={23}/><p>{ct('mergeRules', locale)}</p></div>
    <div className="crm-merge-selectors">{(['target', 'source'] as const).map(side => <div className={`crm-merge-card crm-merge-${side}`} key={side}><span className="crm-mini-label">{ct(side, locale)}</span><select className="input" aria-label={ct(side, locale)} value={side === 'target' ? targetId : sourceId} onChange={event => select(side, event.target.value)}><option value="">{ct('select', locale)}</option>{records.map(record => <option key={record.id} value={record.id} disabled={side === 'target' ? record.id === sourceId : record.id === targetId}>{localized(record.title, locale)} · {record.id}</option>)}</select><small>{(side === 'target' ? target : source)?.organization || '—'}</small></div>)}</div>
    {target && source && target.id !== source.id ? <><div className="crm-table-scroll"><table className="crm-compare-table"><thead><tr><th>{wt('type', locale)}</th><th>{ct('target', locale)}</th><th>{ct('source', locale)}</th></tr></thead><tbody>{mergeFields.map(field => <tr key={field}><th scope="row">{fieldLabel(field, locale)}</th>{(['target', 'source'] as const).map(side => <td key={side}><label className={`crm-field-choice ${(choices[field] || 'target') === side ? 'is-selected' : ''}`}><input type="radio" name={`merge-${field}`} checked={(choices[field] || 'target') === side} onChange={() => { setChoices(previous => ({ ...previous, [field]: side })); setConfirmed(false); }}/><span dir="auto">{value(side === 'target' ? target : source, field)}</span></label></td>)}</tr>)}</tbody></table></div><label className="crm-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>{ct('mergeConfirm', locale)}</span></label><div className="crm-tool-actions"><button className="btn btn-primary" disabled={!confirmed} onClick={merge}><GitMerge size={17}/>{ct('merge', locale)}</button></div></> : <div className="crm-inline-empty"><ArrowLeftRight size={28}/><p>{ct('selectTwo', locale)}</p></div>}
    <section className="crm-operation-history"><div className="crm-section-heading"><h3>{ct('mergeHistory', locale)}</h3><span className="badge">{history.length}</span></div><p className="ws-muted">{ct('unmergeRules', locale)}</p>{history.length ? history.toReversed().map(({ record, operation }) => {
      const latest = getMergeOperations(record).filter(item => item.state === 'merged').at(-1)?.id === operation.id;
      return <div className="crm-operation" key={operation.id}><GitPullRequestArrow size={22}/><div><strong>{localized(record.title, locale)}</strong><small><bdi>{operation.sourceId} → {operation.targetId}</bdi></small><small>{safeDate(operation.at, locale)} · <bdi>{operation.actor}</bdi></small></div>{operation.state === 'undone' ? <span className="badge"><Check size={13}/>{ct('undone', locale)}</span> : <button className="btn ws-small-btn" disabled={!latest || !!record.details?.crmMergeAlias} onClick={() => undo(record.id, operation.id)}>{ct('unmerge', locale)}</button>}</div>;
    }) : <p className="ws-muted">{wt('empty', locale)}</p>}</section>
  </div></Modal>;
}

function ImportTool({ collection, store, onClose }: Props & { onClose: () => void }) {
  const { locale, state } = store;
  const products = useCurrentProducts(store);
  const [step, setStep] = useState(0);
  const [raw, setRaw] = useState('');
  const [table, setTable] = useState<ImportTable | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [batchId] = useState(() => uid('CSV'));
  const [at] = useState(now);
  const fileRef = useRef<HTMLInputElement>(null);
  const context = useMemo(() => ({ collection, locale, actor: store.role, batchId, at, products, roles: workspaceRoles }), [collection, locale, store.role, batchId, at, products]);
  const preview = useMemo(() => table ? prepareCrmImport(table, mapping, state.records, context) : [], [table, mapping, state.records, context]);
  const invalid = preview.filter(row => row.errors.length).length;
  const warnings = preview.filter(row => row.warnings.length).length;
  const example = () => {
    const title1 = localized(L('درخواست نمونه دندان APPLE — نمونه آموزشی','APPLE teeth sample inquiry — demo','APPLE diş numunesi talebi — örnek','طلب عينة أسنان APPLE — تجريبي','Запрос образцов APPLE — пример'), locale);
    const title2 = localized(L('بررسی کاتالوگ DENTEX — نمونه آموزشی','DENTEX catalog review — demo','DENTEX katalog incelemesi — örnek','مراجعة كتالوج DENTEX — تجريبي','Изучение каталога DENTEX — пример'), locale);
    const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
    const status = ['quotes', 'pricebooks'].includes(collection) ? 'draft' : 'new';
    setRaw(['title,organization,email,product,status,amount,currency,externalId', [title1, 'Ideal Makoo demo laboratory', 'lab-demo@example.invalid', 'apple', status, '', 'IRR', `${collection}-DEMO-001`].map(quote).join(','), [title2, 'Ideal Makoo demo clinic', 'clinic-demo@example.invalid', products.find(product => product.family === 'materials')?.id || 'apple', status, '', 'IRR', `${collection}-DEMO-002`].map(quote).join(',')].join('\n')); setError('');
  };
  const parse = () => { const result = readImportCsv(raw); if (!result.ok) return setError(result.error); setTable(result.value); setMapping(guessImportMapping(result.value.headers)); setStep(1); setError(''); setPage(0); };
  const upload = async (file?: File) => { if (!file) return; if (file.size > 1_000_000) return setError('csvSize'); try { setRaw(await file.text()); setError(''); } catch { setError('csvQuotes'); } };
  const commit = async () => {
    const result = applyCrmImport(state.records, preview);
    if (!result.ok) return setError(result.error);
    const event = store.log(textFor('imported'));
    if(!await store.update(previous => { const current = applyCrmImport(previous.records, preview); return current.ok ? { ...previous, records: current.value, audit: [event, ...previous.audit] } : previous; }, ct('imported', locale)))return;
    onClose();
  };
  return <Modal title={ct('import', locale)} onClose={onClose} wide><div className="crm-tool-body">
    <div className="crm-wizard-steps">{['fileStep', 'mapStep', 'reviewStep'].map((key, index) => <span className={step === index ? 'active' : step > index ? 'complete' : ''} key={key}>{step > index ? <CheckCircle2 size={17}/> : <span>{index + 1}</span>}{ct(key, locale)}</span>)}</div>
    {step === 0 && <><p className="ws-muted">{ct('fileHint', locale)}</p><div className="crm-tool-actions crm-actions-start"><button className="btn" onClick={() => fileRef.current?.click()}><Upload size={16}/>{ct('chooseFile', locale)}</button><button className="btn" onClick={example}><FileSpreadsheet size={16}/>{ct('example', locale)}</button><input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/></div><Field label={ct('pasteCsv', locale)}><textarea className="input crm-csv-input" dir="ltr" value={raw} onChange={event => setRaw(event.target.value)} maxLength={1_000_000} rows={10} spellCheck={false} placeholder="title,organization,email,product,status"/></Field></>}
    {step === 1 && table && <><p className="ws-muted">{ct('mappingHint', locale)}</p><div className="crm-mapping-grid">{importFields.map(field => <Field label={`${fieldLabel(field, locale)}${field === 'title' ? ' *' : ''}`} key={field}><select className="input" value={mapping[field] ?? ''} onChange={event => { setMapping(previous => ({ ...previous, [field]: event.target.value === '' ? undefined : Number(event.target.value) })); setError(''); }}><option value="">{ct('skipColumn', locale)}</option>{table.headers.map((header, index) => <option value={index} key={index}>{index + 1}. {header || '—'}</option>)}</select><small className="crm-mapping-sample" dir="auto">{mapping[field] === undefined ? '—' : table.rows[0]?.[mapping[field]!] || '—'}</small></Field>)}</div></>}
    {step === 2 && <><div className="crm-import-counts"><div><strong>{preview.length - invalid}</strong><span>{ct('validRows', locale)}</span></div><div className={invalid ? 'has-errors' : ''}><strong>{invalid}</strong><span>{ct('errors', locale)}</span></div><div><strong>{warnings}</strong><span>{ct('warnings', locale)}</span></div></div><div className="crm-table-scroll"><table className="crm-import-table"><thead><tr><th>{ct('row', locale)}</th><th>{wt('title', locale)}</th><th>{wt('organization', locale)}</th><th>{wt('status', locale)}</th></tr></thead><tbody>{preview.slice(page * 12, (page + 1) * 12).map(row => <tr key={row.line} className={row.errors.length ? 'crm-row-error' : ''}><td><bdi>{row.line}</bdi></td><td>{row.title || '—'}</td><td>{row.record?.organization || '—'}</td><td>{row.errors.length ? row.errors.map(issue => <span className="crm-row-message crm-error-text" key={issue}>{ct(issue, locale)}</span>) : <><span className="crm-row-ready"><CheckCircle2 size={15}/>{wt('ready', locale)}</span>{row.warnings.map(issue => <small className="crm-row-message" key={issue}>{ct(issue, locale)}</small>)}</>}</td></tr>)}</tbody></table></div><Pager page={page} total={preview.length} size={12} onChange={setPage} locale={locale}/><div className="crm-tool-notice"><ShieldCheck size={22}/><p>{ct('atomicHint', locale)}</p></div></>}
    {error && <p className="crm-inline-error" role="alert">{ct(error, locale)}</p>}
    <div className="crm-tool-actions">{step > 0 && <button className="btn" onClick={() => { setStep(step - 1); setError(''); }}>{wt('previous', locale)}</button>}{step === 0 && <button className="btn btn-primary" disabled={!raw.trim()} onClick={parse}>{wt('next', locale)}<ArrowRight size={16}/></button>}{step === 1 && <button className="btn btn-primary" disabled={mapping.title === undefined} onClick={() => { setStep(2); setPage(0); }}>{wt('preview', locale)}<ArrowRight size={16}/></button>}{step === 2 && <button className="btn btn-primary" disabled={invalid > 0 || !preview.length} onClick={commit}><Check size={17}/>{ct('atomicImport', locale)} · <bdi>{preview.length}</bdi></button>}</div>
  </div></Modal>;
}

const commercialTitle = (collection: string, locale: string) => localized(collection === 'pricebooks' ? L('دفتر قیمت داخلی ایده‌آل ماکو','Ideal Makoo internal pricebook','Ideal Makoo dahili fiyat listesi','دفتر أسعار إيديال ماكو الداخلي','Внутренний прайс-лист Ideal Makoo') : L('پیشنهاد فنی محصولات ایده‌آل ماکو','Ideal Makoo technical product proposal','Ideal Makoo teknik ürün teklifi','عرض منتجات إيديال ماكو الفني','Техническое предложение Ideal Makoo'), locale);
const newLine = (currency: Currency, locale: string, catalog: Product[] = canonicalProducts): CommercialLine => ({ id: uid('LINE'), productId: (catalog[0] || canonicalProducts[0]).id, titleSnapshot: productLabel(catalog[0] || canonicalProducts[0], locale), unit: 'pack', quantityDecimal: '1', unitPriceDecimal: null, discountPercentDecimal: '0', currency });
function CommercialTool({ collection, store, onClose }: Props & { onClose: () => void }) {
  const { state, locale } = store;
  const products = useCurrentProducts(store);
  const documents = state.records.filter(record => record.collection === collection && record.status !== 'archived');
  const [recordId, setRecordId] = useState('');
  const [title, setTitle] = useState(commercialTitle(collection, locale));
  const [organization, setOrganization] = useState('');
  const [requestId, setRequestId] = useState('');
  const [currency, setCurrency] = useState<Currency>('IRR');
  const [lines, setLines] = useState<CommercialLine[]>(() => [newLine('IRR', locale, products)]);
  const [summary, setSummary] = useState('');
  const calculation = useMemo(() => calculateCommercial(lines, currency), [lines, currency]);
  const knownProducts = lines.every(line => products.some(product => product.id === line.productId));
  const valid = calculation.ok && !!title.trim() && knownProducts;
  const source = documents.find(record => record.id === recordId);
  const changeLine = (id: string, patch: Partial<CommercialLine>) => setLines(previous => previous.map(line => line.id === id ? { ...line, ...patch } : line));
  const selectDocument = (id: string) => {
    setRecordId(id);
    const record = documents.find(item => item.id === id);
    if (!record) { setTitle(commercialTitle(collection, locale)); setOrganization(''); setRequestId(''); setCurrency('IRR'); setLines([newLine('IRR', locale, products)]); setSummary(''); return; }
    setTitle(localized(record.title, locale)); setOrganization(record.organization || ''); setRequestId(record.requestId || ''); setSummary(localized(record.summary, locale));
    const stored = record.details?.commercialDraft as CommercialDraft | undefined;
    const selectedCurrency = currencies.includes(stored?.currency as Currency) ? stored!.currency : currencies.includes(record.currency as Currency) ? record.currency as Currency : 'IRR';
    setCurrency(selectedCurrency);
    if (stored?.schemaVersion === 1 && Array.isArray(stored.lines) && stored.lines.length > 0 && stored.lines.length <= 100 && stored.lines.every(line => line && typeof line.id === 'string' && typeof line.productId === 'string' && typeof line.quantityDecimal === 'string' && typeof line.discountPercentDecimal === 'string' && typeof line.unit === 'string' && (line.unitPriceDecimal === null || typeof line.unitPriceDecimal === 'string'))) setLines(structuredClone(stored.lines));
    else setLines([{ ...newLine(selectedCurrency, locale, products), ...(record.product && products.some(product => product.id === record.product) ? { productId: record.product, titleSnapshot: productLabel(products.find(product => product.id === record.product)!, locale) } : {}) }]);
  };
  const changeCurrency = (value: Currency) => { if (value === currency) return; const hadPrices = lines.some(line => line.unitPriceDecimal !== null); setCurrency(value); setLines(previous => previous.map(line => ({ ...line, currency: value, unitPriceDecimal: null }))); if (hadPrices) store.notify(ct('currencyReset', locale)); };
  const payload = (): CommercialDraft | null => calculation.ok ? ({ schemaVersion: 1, kind: collection === 'pricebooks' ? 'pricebook' : 'quote', locale, currency, lines: lines.map(line => ({ ...line, quantityDecimal: normalizeDecimal(line.quantityDecimal), unitPriceDecimal: line.unitPriceDecimal?.trim() ? normalizeDecimal(line.unitPriceDecimal) : null, discountPercentDecimal: normalizeDecimal(line.discountPercentDecimal) })), estimate: calculation.value, calculationPolicyVersion: 'local-line-half-up-v1', serverRecalculationRequired: true, updatedAt: now() }) : null;
  const save = async () => {
    const commercialDraft = payload();
    if (!commercialDraft || !title.trim() || !knownProducts) return;
    const titles = { ...(source?.title || L('', '', '', '', '')), [locale]: title.trim() };
    const summaries = { ...(source?.summary || L('', '', '', '', '')), [locale]: summary };
    const id = source?.id || uid(collection === 'quotes' ? 'QUOTE' : 'PRICEBOOK');
    const event = store.log(textFor('commercialSaved'));
    const record: WorkspaceRecord = {
      ...(source || {}), id, collection, title: titles, summary: summaries, status: 'draft', owner: source?.owner || store.role,
      organization, requestId: requestId || undefined, product: lines[0].productId, amount: commercialDraft.estimate.grandTotalDecimal,
      currency, createdAt: source?.createdAt || now(), updatedAt: now(), tags: [...new Set([...(source?.tags || []), 'structured-commercial'])],
      demo: source?.demo ?? true, author: store.role, authorId:store.actorId, approvedBy: undefined, approvedById:undefined, history: [...(source?.history || []), event],
      details: { ...source?.details, commercialDraft },
    };
    if(await store.update(previous => ({ ...previous, records: [record, ...previous.records.filter(item => item.id !== id)], audit: [event, ...previous.audit] }), ct('commercialSaved', locale)))onClose();
  };
  const total = calculation.ok ? calculation.value : null;
  const displayAmount = (amount: string | null | undefined) => amount === null || amount === undefined ? ct('unknown', locale) : amount;
  const requests = state.records.filter(record => record.requestId === record.id);
  return <Modal title={ct('commercial', locale)} onClose={onClose} wide><div className="crm-tool-body crm-commercial-body">
    <div className="crm-tool-notice"><ShieldCheck size={24}/><p>{ct('serverEstimate', locale)}</p></div>
    <div className="crm-commercial-metadata"><Field label={ct('editCommercial', locale)}><select className="input" value={recordId} onChange={event => selectDocument(event.target.value)}><option value="">＋ {ct('newCommercial', locale)}</option>{documents.map(record => <option key={record.id} value={record.id}>{localized(record.title, locale)} · {record.id}</option>)}</select></Field><Field label={wt('currency', locale)}><select className="input" dir="ltr" value={currency} onChange={event => changeCurrency(event.target.value as Currency)}>{currencies.map(code => <option key={code}>{code}</option>)}</select></Field><Field label={wt('title', locale)}><input className="input" value={title} maxLength={250} required onChange={event => setTitle(event.target.value)}/></Field><Field label={wt('organization', locale)}><input className="input" value={organization} maxLength={250} onChange={event => setOrganization(event.target.value)}/></Field>{collection === 'quotes' && <Field label={ct('linkedRequest', locale)}><select className="input" value={requestId} onChange={event => setRequestId(event.target.value)}><option value="">—</option>{requests.map(record => <option key={record.id} value={record.id}>{localized(record.title, locale)} · {record.id}</option>)}</select></Field>}</div>
    <div className="crm-section-heading"><h3>{ct('lines', locale)} <span className="badge">{lines.length}</span></h3><button className="btn ws-small-btn" disabled={lines.length >= 100} onClick={() => setLines(previous => [...previous, newLine(currency, locale, products)])}><Plus size={16}/>{ct('addLine', locale)}</button></div>
    <div className="crm-table-scroll"><table className="crm-commercial-table"><thead><tr><th>{wt('products', locale)}</th><th>{ct('unit', locale)}</th><th>{ct('quantity', locale)}</th><th>{ct('unitPrice', locale)} · <bdi>{currency}</bdi></th><th>{ct('discount', locale)}</th><th>{ct('net', locale)}</th><th><span className="sr-only">{wt('delete', locale)}</span></th></tr></thead><tbody>{lines.map((line, index) => <tr key={line.id}><td><div className="crm-line-product"><img src={products.find(product => product.id === line.productId)?.image || '/media/brand/product-placeholder.svg'} alt=""/><select className="input" aria-label={`${wt('products', locale)} ${index + 1}`} value={line.productId} onChange={event => { const product = products.find(item => item.id === event.target.value); if (product) changeLine(line.id, { productId: product.id, titleSnapshot: productLabel(product, locale), unitPriceDecimal: null }); }}>{!products.some(product=>product.id===line.productId)&&<option value={line.productId}>{line.titleSnapshot} · {ct('unknown',locale)}</option>}{products.map(product => <option value={product.id} key={product.id}>{productLabel(product, locale)}</option>)}</select></div></td><td><select className="input" aria-label={`${ct('unit', locale)} ${index + 1}`} value={line.unit} onChange={event => changeLine(line.id, { unit: event.target.value })}>{['pack', 'kit', 'piece', 'g', 'ml'].map(unit => <option key={unit} value={unit}>{unit === 'pack' ? ct('unitPack', locale) : unit === 'kit' ? ct('unitKit', locale) : unit === 'piece' ? ct('unitPiece', locale) : unit}</option>)}</select></td><td><input className="input" dir="ltr" inputMode="decimal" aria-label={`${ct('quantity', locale)} ${index + 1}`} maxLength={32} value={line.quantityDecimal} onChange={event => changeLine(line.id, { quantityDecimal: event.target.value })}/></td><td><input className="input" dir="ltr" inputMode="decimal" aria-label={`${ct('unitPrice', locale)} ${index + 1}`} maxLength={32} placeholder="—" value={line.unitPriceDecimal ?? ''} onChange={event => changeLine(line.id, { unitPriceDecimal: event.target.value || null })}/></td><td><input className="input" dir="ltr" inputMode="decimal" aria-label={`${ct('discount', locale)} ${index + 1}`} maxLength={12} value={line.discountPercentDecimal} onChange={event => changeLine(line.id, { discountPercentDecimal: event.target.value })}/></td><td><bdi className="crm-line-total">{displayAmount(total?.lines[index]?.netDecimal)}</bdi></td><td><button className="ws-icon-button" aria-label={`${wt('delete', locale)} ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(previous => previous.filter(item => item.id !== line.id))}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>
    {!calculation.ok && <p className="crm-inline-error" role="alert">{ct(calculation.error, locale)}</p>}{!knownProducts && <p className="crm-inline-error" role="alert">{ct('importProduct', locale)}</p>}
    <div className="crm-commercial-footer"><Field label={wt('description', locale)}><textarea className="input" rows={4} value={summary} maxLength={6000} onChange={event => setSummary(event.target.value)}/><small className="ws-muted">{ct('unknownHint', locale)}</small></Field><dl className="crm-estimate"><div><dt>{ct('subtotal', locale)}</dt><dd><bdi>{displayAmount(total?.subtotalDecimal)}</bdi></dd></div><div><dt>{ct('discountTotal', locale)}</dt><dd><bdi>{displayAmount(total?.discountDecimal)}</bdi></dd></div><div className="crm-estimate-grand"><dt>{ct('estimateTotal', locale)}<small><bdi>{currency}</bdi></small></dt><dd><bdi>{displayAmount(total?.grandTotalDecimal)}</bdi></dd></div></dl></div>
    <div className="crm-tool-actions"><button className="btn" disabled={!valid} onClick={() => { const data = payload(); if (data) downloadFile(JSON.stringify({ title, organization, summary, requestId: requestId || null, commercialDraft: data }, null, 2), `idealmakoo-${collection}-${currency}.json`); }}><Download size={16}/>{ct('exportPayload', locale)}</button><button className="btn btn-primary" disabled={!valid} onClick={save}><Check size={17}/>{ct('saveCommercial', locale)}</button></div>
  </div></Modal>;
}

export default CrmTools;
