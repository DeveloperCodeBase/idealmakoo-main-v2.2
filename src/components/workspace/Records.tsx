'use client';
import PublicImage from '@/components/ui/PublicImage';
import RichTextEditor from './RichTextEditor';
import {taxonomyCopy,splitTaxonomyTags,validTaxonomy} from './TaxonomyFields';
import EditorialSeoFields from './EditorialSeoFields';
import EditorialSeoFacts from '@/components/content/EditorialSeoFacts';
import {parseEditorialSeoByLocale,type EditorialSeoByLocale} from '@/lib/editorial-seo';
import CrmDomainPanel from './CrmDomainPanel';
import {CrmActivityPanel} from './CrmOperations';
import CrmAssist from './CrmAssist';
import RecordAssignment from './RecordAssignment';
import {RequestRoutingFacts} from './CrmRouting';
import ContentCollaboration,{type LeaseState} from './ContentCollaboration';
import {parseGlossaryDefinition,glossaryLocales} from '@/lib/glossary';
import {glossaryCopy} from '@/components/content/glossary-copy';
import PublicationSchedule from './PublicationSchedule';
import AiMarkdown from '@/components/ui/AiMarkdown';
import RevisionHistory from './RevisionHistory';
import {apiClient,demoMode,networkError} from '@/lib/api';

import { useEffect, useMemo, useRef, useState } from 'react';
import { canWorkspace, type WorkspaceAction } from '@/lib/auth';
import { canReadRecord, canRecordAction } from './permissions';
import { ArrowUpRight, Check, CheckCircle2, Copy, Download, Edit3, ExternalLink, FileText, Filter, Grid2X2, List, Mail, Plus, Save, Send, ShieldCheck, Trash2, Users, ArchiveRestore, ArrowRightLeft, CalendarDays, Printer, Clock, X } from 'lucide-react';
import { articles } from '@/data/catalog';
import {customProductCopy} from './custom-product-copy';
import {workspaceProducts,parseCustomProduct,productPath} from '@/lib/custom-products';
import {getPublishedProductInventory,usePublications} from '@/lib/publications';
import { WorkspaceRecord, recordText } from '@/data/workspace-seed';
import { WorkspaceStore, canEdit, exportRecords, fullText, now, safeUrl, uid } from './store';
import { L, localized, roleNames, workspaceLocales, workspaceRoles, wt } from './i18n';
import { Empty, Field, Modal, Pager, SearchInput, Status, safeDate } from './ui';
import QuoteLines from '@/components/ui/QuoteLines';
import { commercialQuoteLines, parseFrontRequests } from '@/lib/frontend-state';
import { calculateCommercial, type CommercialDraft } from './crm-tools-logic';
import { createProductRelease, parseProductRelease } from '@/lib/product-release';
import ProductReleaseSection from '@/components/site/ProductRelease';
import { readProductDraft } from './product-editor-data';

// CMS definitions stay canonical for review; public custom IDs remain usable by
// CRM roles whose permitted record projection intentionally excludes CMS drafts.
function useRecordProducts(records: WorkspaceRecord[]) {
  const publications = usePublications();
  return useMemo(() => {
    const inventory = new Map(workspaceProducts(records).map(product => [product.id, product]));
    for (const product of getPublishedProductInventory()) if (!inventory.has(product.id)) inventory.set(product.id, product);
    return [...inventory.values()];
  }, [records, publications]);
}

export const contentCollections = ['pages', 'products', 'research', 'knowledge', 'glossary', 'news', 'events', 'resources', 'menus', 'hr', 'communications'];
export const statusChoices = (collection: string) => {
  if (contentCollections.includes(collection)) return ['draft', 'review', 'approved', 'published', 'scheduled'];
  if (collection === 'leads') return ['new', 'working', 'qualified', 'waiting', 'converted', 'lost'];
  if (collection === 'opportunities') return ['new', 'working', 'qualified', 'proposal', 'won', 'lost'];
  if (collection === 'samples') return ['requested', 'working', 'shipped', 'delivered', 'evaluated'];
  if (collection === 'tickets') return ['new', 'working', 'waiting', 'resolved'];
  if (collection === 'pricebooks') return ['draft','review','approved','inactive'];
  if (collection === 'quotes') return ['draft', 'review', 'approved', 'proposal', 'lost'];
  if (['accounts', 'contacts', 'staff', 'partners', 'automations', 'segments', 'pricebooks'].includes(collection)) return ['draft', 'active', 'inactive', 'review'];
  return ['new', 'draft', 'working', 'review', 'ready', 'resolved'];
};

function copiedEditorialDetails(details:WorkspaceRecord['details']){
 if(!details)return undefined;
 const clean={...details};for(const key of ['qualityQuarantined','publicRequestStatus','lastIssuedQuoteId','lastIssuedQuoteHash','mergeOperations','mergeAliases','aliases','mergedInto','mergeHistory'])delete clean[key];return clean;
}

export function RecordsDesk({ collection, store, initialQuery = '' }: { collection: string; store: WorkspaceStore; initialQuery?: string }) {
  const { state, locale, role, notify } = store;
  const products=useRecordProducts(state.records);
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [view, setView] = useState(['products', 'research', 'resources'].includes(collection) ? 'grid' : 'list');
  const [editing, setEditing] = useState<WorkspaceRecord | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get('record');if(id&&store.loaded&&store.state.records.some(record=>record.id===id&&record.collection===collection))setDetail(id);},[store.loaded,collection]);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy,setBulkBusy]=useState(false),bulkPending=useRef(false),deskActive=useRef(true);
  useEffect(()=>{deskActive.current=true;return()=>{deskActive.current=false;};},[]);
  const editable = canEdit(role, collection);
  const records = state.records.filter(record => record.collection === collection && canReadRecord(role,record));
  const filtered = useMemo(() => records.filter(record => (filter === 'all' ? record.status !== 'archived' : record.status === filter) && `${localized(record.title, locale)} ${localized(record.summary, locale)} ${record.id} ${record.organization || ''} ${record.email || ''} ${record.tags.join(' ')}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale))), [records, filter, query, locale]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 8) - 1));
  const rows = filtered.slice(currentPage * 8, (currentPage + 1) * 8);
  const statuses = [...new Set([...statusChoices(collection), ...records.map(record => record.status)])];
  const current = state.records.find(record => record.id === detail);
  const changeQuery = (value: string) => { setQuery(value); setPage(0); };
  const archive = async (record: WorkspaceRecord) => await store.patchRecord(record.id, record.status === 'archived' ? { status: record.archivedFrom || 'draft', archivedFrom: undefined } : { status: 'archived', archivedFrom: record.status });
  const archiveSelected=async()=>{if(bulkPending.current||!editable)return;bulkPending.current=true;setBulkBusy(true);try{for(const id of [...selected]){if(!deskActive.current)break;const record=store.getState().records.find(item=>item.id===id&&item.collection===collection);if(!record)continue;if(!await archive(record))break;if(deskActive.current)setSelected(previous=>previous.filter(value=>value!==id));}}finally{bulkPending.current=false;if(deskActive.current)setBulkBusy(false);}};
  const duplicate = async (record: WorkspaceRecord) => await store.addRecord({ ...record, id: uid(collection), title: Object.fromEntries(workspaceLocales.map(lang => [lang, record.title[lang].trim() ? `${record.title[lang]} (${wt('draft', lang)})` : ''])) as WorkspaceRecord['title'], status: 'draft', author: role, authorId:store.actorId, approvedBy: undefined, approvedById:undefined, details:copiedEditorialDetails(record.details), linkedId:undefined, scheduledAt:undefined, publishedLocales: [], sourceUrl: record.sourceUrl, createdAt: now(), updatedAt: now(), history: [], requestId: undefined, demo: demoMode });
  return <div className="ws-records">
    <div className="ws-toolbar"><SearchInput value={query} onChange={changeQuery} locale={locale}/><div className="ws-toolbar-end"><button className="btn ws-small-btn" disabled={!canWorkspace(role,'export',collection)} onClick={() => {if(store.permit('export',collection))exportRecords(selected.length ? filtered.filter(r => selected.includes(r.id)) : filtered, locale, `idealmakoo-${collection}`);}}><Download size={16}/>{wt('export', locale)}</button><div className="ws-segmented"><button aria-label={wt('list', locale)} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={17}/></button><button aria-label={wt('grid', locale)} aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={17}/></button></div>{collection!=='products'&&canWorkspace(role,'create',collection) && <button className="btn btn-primary ws-small-btn" onClick={() => setEditing('new')}><Plus size={17}/>{wt('create', locale)}</button>}</div></div>
    <div className="ws-filter-row"><Filter size={15}/>{['all', ...statuses].map(status => <button key={status} className={filter === status ? 'active' : ''} onClick={() => { setFilter(status); setPage(0); }}>{wt(status, locale)}<span>{status === 'all' ? records.filter(r => r.status !== 'archived').length : records.filter(r => r.status === status).length}</span></button>)}</div>
    {selected.length > 0 && <div className="ws-bulk" aria-busy={bulkBusy}><span><bdi>{selected.length}</bdi> {wt('records', locale)}</span><button className="btn ws-small-btn" onClick={()=>void archiveSelected()} disabled={!editable||bulkBusy||store.pending}><Trash2 size={15}/>{wt('delete', locale)}</button><button className="ws-icon-button" disabled={bulkBusy} onClick={() => setSelected([])} aria-label={wt('clear', locale)}><X size={16}/></button></div>}
    {!filtered.length ? <Empty locale={locale} action={<button className="btn" onClick={() => { setFilter('all'); setQuery(''); }}>{wt('clear', locale)}</button>}/> : view === 'grid' ? <div className="ws-record-grid">{rows.map(record => <article className="ws-card ws-record-card" key={record.id}>
      <button className="ws-record-art" onClick={() => setDetail(record.id)} aria-label={`${localized(record.title, locale)} ${parseCustomProduct(record.details?.customProduct)?customProductCopy.authored[locale]:wt(record.demo ? 'sample' : 'verified', locale)}`}>{record.image ? <PublicImage src={record.image} alt={localized(record.title, locale)} sizes="(max-width: 740px) 50vw, (max-width: 900px) 34vw, (max-width: 1170px) 50vw, 34vw" loading="lazy"/> : <FileText size={44}/>}<span className="ws-record-source">{parseCustomProduct(record.details?.customProduct)?customProductCopy.authored[locale]:wt(record.demo ? 'sample' : 'verified', locale)}</span></button>
      <div className="ws-record-card-copy"><div className="ws-flex-between"><Status status={record.status} locale={locale}/><span className="ws-micro"><bdi>{record.id.slice(-10)}</bdi></span></div><button className="ws-title-button" onClick={() => setDetail(record.id)}>{localized(record.title, locale)}</button><p>{localized(record.summary, locale)}</p><div className="ws-record-card-footer"><span>{safeDate(record.updatedAt, locale)}</span><div>{editable && <><button className="ws-icon-button" aria-label={wt('edit', locale)} onClick={() => setEditing(record)}><Edit3 size={15}/></button><button className="ws-icon-button" aria-label={wt(record.status === 'archived' ? 'restore' : 'delete', locale)} onClick={() => archive(record)}>{record.status === 'archived' ? <ArchiveRestore size={15}/> : <Trash2 size={15}/>}</button></>}<button className="ws-icon-button" aria-label={wt('details', locale)} onClick={() => setDetail(record.id)}><ArrowUpRight size={17}/></button></div></div></div>
    </article>)}</div> : <div className="ws-table-wrap ws-card"><table className="ws-table"><thead><tr><th><input type="checkbox" aria-label={wt('all', locale)} checked={rows.length > 0 && rows.every(r => selected.includes(r.id))} onChange={event => setSelected(event.target.checked ? rows.map(r => r.id) : [])}/></th><th>{wt('title', locale)}</th><th>{wt('status', locale)}</th><th>{wt(contentCollections.includes(collection) ? 'owner' : 'organization', locale)}</th><th>{wt('updated', locale)}</th><th>{wt('actions', locale)}</th></tr></thead><tbody>{rows.map(record => <tr key={record.id}><td><input type="checkbox" checked={selected.includes(record.id)} aria-label={`${wt('details', locale)} ${localized(record.title, locale)}`} onChange={event => setSelected(previous => event.target.checked ? [...previous, record.id] : previous.filter(id => id !== record.id))}/></td><td><div className="ws-table-identity">{record.image ? <img src={record.image} alt=""/> : <span className="ws-table-icon">{collection === 'staff' || collection === 'contacts' ? <Users size={20}/> : <FileText size={20}/>}</span>}<div><button className="ws-row-title" onClick={() => setDetail(record.id)}>{localized(record.title, locale)}</button><small><bdi>{record.id}</bdi><span> · {parseCustomProduct(record.details?.customProduct)?customProductCopy.authored[locale]:wt(record.demo ? 'sample' : 'verified', locale)}</span></small></div></div></td><td><Status status={record.status} locale={locale}/></td><td>{contentCollections.includes(collection) ? localized(roleNames[record.owner] || record.owner, locale) : <bdi>{record.organization || '—'}</bdi>}</td><td><span className="ws-muted">{safeDate(record.updatedAt, locale)}</span></td><td><div className="ws-row-actions"><button className="ws-icon-button" onClick={() => setDetail(record.id)} aria-label={wt('details', locale)}><ArrowUpRight size={16}/></button>{editable && <><button className="ws-icon-button" onClick={() => setEditing(record)} aria-label={wt('edit', locale)}><Edit3 size={15}/></button><button className="ws-icon-button" onClick={() => duplicate(record)} aria-label={wt('duplicate', locale)}><Copy size={15}/></button><button className="ws-icon-button" onClick={() => archive(record)} aria-label={wt(record.status === 'archived' ? 'restore' : 'delete', locale)}>{record.status === 'archived' ? <ArchiveRestore size={15}/> : <Trash2 size={15}/>}</button></>}</div></td></tr>)}</tbody></table></div>}
    <Pager page={currentPage} total={filtered.length} size={8} onChange={setPage} locale={locale}/>
    {['campaigns', 'communications', 'inbox'].includes(collection) && <p className="ws-inline-note"><Mail size={16}/>{localized(L('پیام‌ها در مرحله تدوین هستند؛ ارسال بیرونی پس از اتصال سرویس بک‌اند انجام می‌شود.','Messages remain drafts; external delivery connects through the backend service.','Mesajlar taslak olarak kalır; dış gönderim arka uç hizmetine bağlanır.','تبقى الرسائل مسودات؛ يتم الإرسال الخارجي عبر خدمة الخادم.','Сообщения остаются черновиками; отправка подключается через сервер.'), locale)}</p>}
    {collection === 'automations' && <div className="ws-inline-note"><Clock size={17}/><span>{wt('blockedAuto', locale)}</span><button className="btn ws-small-btn" onClick={() => { const candidates = state.records.filter(r => r.collection === 'leads' && r.status === 'new'); notify(`${candidates.length} ${wt('records', locale)} · ${wt('tasksToday', locale)}`); setQuery(''); }}>{wt('dryRun', locale)}</button></div>}
    {editing && <RecordEditor record={editing === 'new' ? undefined : editing} collection={collection} store={store} onClose={() => setEditing(null)}/>}
    {current && <RecordDetail record={current} store={store} onClose={() => setDetail(null)} onEdit={() => { setDetail(null); setEditing(current); }}/>} 
  </div>;
}

export function RecordEditor({ record, collection, store, onClose }: { record?: WorkspaceRecord; collection: string; store: WorkspaceStore; onClose: () => void }) {
  const { locale, role } = store;
  const products=useRecordProducts(store.state.records);
  const [contentLocale,setContentLocale]=useState(store.actor.allowedLocales?.includes(locale)?locale:(store.actor.allowedLocales?.[0] as typeof locale)||locale);
  const [sourceStamp]=useState(record?.updatedAt||'');
  const [dirty,setDirty]=useState(false);
  const [leaseState,setLeaseState]=useState<LeaseState>('loading');
  const glossarySource=parseGlossaryDefinition(record?.details?.glossary);
  const [aliasText,setAliasText]=useState(()=>Object.fromEntries(glossaryLocales.map(lang=>[lang,glossarySource?.aliases[lang]?.join('\n')||''])) as Record<typeof locale,string>);
  const [titles, setTitles] = useState(record?.title || L('', '', '', '', ''));
  const [summaries, setSummaries] = useState(record?.summary || L('', '', '', '', ''));
  const [status, setStatus] = useState(record?.status || statusChoices(collection)[0]);
  const [owner, setOwner] = useState(record?.owner || role);
  const [organization, setOrganization] = useState(record?.organization || '');
  const [email, setEmail] = useState(record?.email || '');
  const [product, setProduct] = useState(record?.product || '');
  const [tags, setTags] = useState(record?.tags.join(', ') || '');
  const [category,setCategory]=useState(typeof record?.details?.category==='string'?record.details.category:'');
  const [amount, setAmount] = useState(record?.amount || '');
  const [currency, setCurrency] = useState(record?.currency || 'IRR');
  const [due, setDue] = useState(record?.due || '');
  const [priority, setPriority] = useState(record?.priority || 'normal');
  const [sourceUrl, setSourceUrl] = useState(record?.sourceUrl || '');
  const [requestId, setRequestId] = useState(record?.requestId || '');
  const editorial=record?.details?.editorialContent as {schemaVersion?:number;body?:ReturnType<typeof L>;mediaId?:string;mediaUrl?:string;mediaType?:string;mediaTitle?:string;seo?:EditorialSeoByLocale}|undefined;
  const [longBody,setLongBody]=useState<ReturnType<typeof L>>(editorial?.body&&typeof editorial.body==='object'?{...L('','','','',''),...editorial.body}:L('','','','',''));
  const [mediaId,setMediaId]=useState(editorial?.mediaId||'');
  const [seo,setSeo]=useState<EditorialSeoByLocale>(parseEditorialSeoByLocale(editorial?.seo||{})||{});
  const localDateInput = (value?: string) => { if (!value) return ''; const date = new Date(value); if (!Number.isFinite(date.getTime())) return ''; return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const [eventStart, setEventStart] = useState(localDateInput(record?.eventStart));
  const [eventEnd, setEventEnd] = useState(localDateInput(record?.eventEnd));
  const [eventLocation, setEventLocation] = useState(record?.location || '');
  const isContent = contentCollections.includes(collection);
  const savedSource=record&&store.state.records.find(item=>item.id===record.id);
  const stale=!!record&&!!savedSource&&savedSource.updatedAt!==sourceStamp;
  const localeAllowed=demoMode||!store.actor.allowedLocales||store.actor.allowedLocales.includes(contentLocale);
  const roleAllowed=canWorkspace(role,record?'edit':'create',collection,{...store.actor,locale:contentLocale});
  const allowed=roleAllowed&&localeAllowed&&!stale&&(demoMode||!record||!isContent||leaseState==='held');
  const contactVisible=isContent||demoMode||['admin','superAdmin'].includes(role)||store.actor.crmAccess?.permissions.contact===true;
  const financialVisible=isContent||demoMode||['admin','superAdmin'].includes(role)||store.actor.crmAccess?.permissions.financial===true;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if(!allowed)return;
    if(isContent&&!validTaxonomy({category,tags:splitTaxonomyTags(tags)}))return store.notify(localized(taxonomyCopy.invalid,locale));
    if(!store.permit(record?'edit':'create',collection,contentLocale))return store.notify(wt('denied',locale));
    if (!titles[contentLocale].trim() || !summaries[contentLocale].trim()) return store.notify(wt('required', locale));
    if (collection === 'events' && eventEnd && (!eventStart || new Date(eventEnd) <= new Date(eventStart))) return store.notify(localized(L('پایان رویداد باید پس از زمان شروع باشد.','Event end must be after its start.','Etkinlik bitişi başlangıçtan sonra olmalıdır.','يجب أن تكون نهاية الحدث بعد بدايته.','Окончание события должно быть позже начала.'), locale));
    const safeStatus = (isContent || ['quotes','pricebooks'].includes(collection)) && ['published', 'approved', 'scheduled', 'proposal'].includes(status) ? 'draft' : status;
    const selectedMedia=store.state.media.find(item=>item.id===mediaId);
    const glossary=collection==='glossary'?parseGlossaryDefinition({schemaVersion:1,aliases:Object.fromEntries(glossaryLocales.filter(lang=>!!aliasText[lang].trim()||Object.hasOwn(glossarySource?.aliases||{},lang)).map(lang=>[lang,aliasText[lang].split('\n').map(value=>value.trim()).filter(Boolean)]))}):undefined;
    if(collection==='glossary'&&!glossary)return store.notify(localized(glossaryCopy.invalid,locale));
    const parsedSeo=parseEditorialSeoByLocale(seo);if(!parsedSeo)return store.notify(wt('required',locale));
    const mediaFields=selectedMedia?{mediaId:selectedMedia.id,mediaUrl:selectedMedia.url,mediaType:selectedMedia.type,mediaTitle:selectedMedia.title}:mediaId&&mediaId===editorial?.mediaId?{mediaId:editorial.mediaId,mediaUrl:editorial.mediaUrl,mediaType:editorial.mediaType,mediaTitle:editorial.mediaTitle}:{};
    const contentDetails=isContent?{details:{...record?.details,category:category.trim(),...(glossary?{glossary}:{}),editorialContent:{...editorial,schemaVersion:1,body:longBody,seo:Object.keys(parsedSeo).length?parsedSeo:undefined,mediaId:undefined,mediaUrl:undefined,mediaType:undefined,mediaTitle:undefined,...mediaFields}}}:{};
    const patch = { ...contentDetails,title: titles, summary: summaries, status: safeStatus, owner, ...(contactVisible?{organization,email}:{}), product, tags: splitTaxonomyTags(tags), ...(financialVisible?{amount:amount||null,currency}:{}), due, priority, sourceUrl, requestId: requestId || undefined, author: role, approvedBy: undefined, ...(collection === 'events' ? { eventStart: eventStart ? new Date(eventStart).toISOString() : undefined, eventEnd: eventEnd ? new Date(eventEnd).toISOString() : undefined, location: eventLocation.trim() || undefined } : {}) };
    if (record) {if(!await store.patchRecord(record.id, patch))return;}
    else if(!await store.addRecord({ id: uid(collection), collection, ...patch, demo: demoMode, history: [], createdAt: now(), updatedAt: now(), image: products.find(p => p.id === product)?.image }))return;
    onClose();
  };
  return <Modal title={`${wt(record ? 'edit' : 'create', locale)} · ${wt(collection, locale)}`} onClose={onClose} wide><form className="ws-edit-form" onSubmit={submit} onChange={()=>setDirty(true)}>
    {!demoMode&&record&&isContent&&<ContentCollaboration store={store} bucket="records" id={record.id} sourceUpdatedAt={sourceStamp} dirty={dirty} canEdit={roleAllowed} locale={contentLocale} onLeaseState={setLeaseState}/>}
    {stale&&<p role="alert">{wt('revisionConflict',locale)}</p>}
    <fieldset disabled={!allowed||store.pending} style={{border:0,padding:0,minWidth:0}}>
    <div className="ws-locale-tabs" role="tablist" aria-label={wt('language', locale)}>{workspaceLocales.map(lang => <button disabled={!demoMode&&!!store.actor.allowedLocales&&!store.actor.allowedLocales.includes(lang)} key={lang} type="button" role="tab" aria-selected={contentLocale === lang} onClick={() => setContentLocale(lang)}>{({ fa: 'فارسی', en: 'English', tr: 'Türkçe', ar: 'العربية', ru: 'Русский' })[lang]}{titles[lang] && <Check size={13}/>}</button>)}</div>
    <Field label={wt('title', locale)}><input className="input" dir={['fa', 'ar'].includes(contentLocale) ? 'rtl' : 'ltr'} required value={titles[contentLocale]} onChange={e => setTitles(fullText(e.target.value, contentLocale, titles))}/></Field>
    <Field label={wt('description', locale)}><textarea className="input ws-editor-textarea" dir={['fa', 'ar'].includes(contentLocale) ? 'rtl' : 'ltr'} required rows={6} value={summaries[contentLocale]} onChange={e => setSummaries(fullText(e.target.value, contentLocale, summaries))}/></Field>
    {isContent&&<><RichTextEditor label={localized(L('متن کامل مطلب','Full article text','Tam makale metni','نص المقال الكامل','Полный текст материала'),locale)} locale={contentLocale} uiLocale={locale} value={longBody[contentLocale]} disabled={!allowed||store.pending} onChange={value=>{setDirty(true);setLongBody(previous=>({...previous,[contentLocale]:value}));}}/><Field label={wt('media',locale)}><select className="input" value={mediaId} onChange={event=>setMediaId(event.target.value)}><option value="">—</option>{mediaId&&!store.state.media.some(item=>item.id===mediaId)&&<option value={mediaId}>{editorial?.mediaTitle||mediaId}</option>}{store.state.media.filter(item=>item.rights).map(item=><option value={item.id} key={item.id}>{item.title} · {wt(item.type,locale)}</option>)}</select></Field></>}
    {isContent&&<EditorialSeoFields value={seo[contentLocale]} locale={contentLocale} collection={collection} media={store.state.media} disabled={!allowed||store.pending} onChange={value=>{setDirty(true);setSeo(previous=>{const next={...previous};if(value)next[contentLocale]=value;else delete next[contentLocale];return next;});}}/>}
    {collection==='glossary'&&<Field label={localized(glossaryCopy.aliases,locale)}><textarea className="input" rows={5} value={aliasText[contentLocale]} onChange={event=>setAliasText(previous=>({...previous,[contentLocale]:event.target.value}))}/><small>{localized(glossaryCopy.aliasesHint,locale)}</small></Field>}
    <div className="ws-form-grid"><Field label={wt('status', locale)}><select className="input" value={status} onChange={e => setStatus(e.target.value)}>{statusChoices(collection).filter(s => !['published', 'approved', 'scheduled'].includes(s) || record?.status === s).map(s => <option key={s} value={s}>{wt(s, locale)}</option>)}</select></Field><Field label={wt('owner', locale)}><select className="input" value={owner} onChange={e => setOwner(e.target.value)}>{workspaceRoles.filter(r => r !== 'customer').map(r => <option key={r} value={r}>{localized(roleNames[r], locale)}</option>)}</select></Field>
    {!isContent&&contactVisible && <><Field label={wt('organization', locale)}><input className="input" value={organization} onChange={e => setOrganization(e.target.value)}/></Field><Field label={wt('email', locale)}><input className="input" dir="ltr" type="email" value={email} onChange={e => setEmail(e.target.value)}/></Field></>}
    <Field label={wt('product', locale)}><select className="input" value={product} onChange={e => setProduct(e.target.value)}><option value="">{wt('unknown', locale)}</option>{products.map(p => <option value={p.id} key={p.id}>{(localized(p.name, locale) || Object.values(p.name).find(value => value.trim()) || p.id)}</option>)}</select></Field>{isContent&&<Field label={localized(taxonomyCopy.category,locale)}><input className="input" maxLength={120} value={category} onChange={event=>setCategory(event.target.value)}/></Field>}<Field label={wt('tags', locale)}><input className="input" maxLength={1800} value={tags} onChange={e => setTags(e.target.value)}/>{isContent&&<small>{localized(taxonomyCopy.hint,locale)}</small>}</Field>
    {financialVisible&&['quotes', 'opportunities', 'pricebooks'].includes(collection) && <><Field label={wt('amount', locale)}><input className="input" dir="ltr" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" value={amount} onChange={e => setAmount(e.target.value)} placeholder={wt('unknown', locale)}/></Field><Field label={wt('currency', locale)}><select className="input" value={currency} onChange={e => setCurrency(e.target.value)}>{['IRR', 'USD', 'EUR', 'TRY', 'RUB'].map(c => <option key={c}>{c}</option>)}</select></Field></>}
    {collection === 'quotes' && <Field label={localized(L('استعلام مرتبط برای اشتراک با مشتری','Linked inquiry for customer sharing','Müşteri paylaşımı için bağlantılı talep','الاستفسار المرتبط للمشاركة مع العميل','Связанный запрос для передачи клиенту'), locale)}><select className="input" value={requestId} onChange={e => setRequestId(e.target.value)}><option value="">{wt('unknown', locale)}</option>{store.state.records.filter(r => r.requestId && ['leads', 'samples', 'partners'].includes(r.collection)).map(r => <option key={r.id} value={r.requestId}>{localized(r.title, locale)} · {r.requestId}</option>)}</select></Field>}
    {collection === 'events' && <><Field label={localized(L('زمان شروع رویداد','Event start','Etkinlik başlangıcı','بداية الحدث','Начало события'), locale)}><input className="input" type="datetime-local" value={eventStart} onChange={e => setEventStart(e.target.value)}/></Field><Field label={localized(L('زمان پایان رویداد','Event end','Etkinlik bitişi','نهاية الحدث','Окончание события'), locale)}><input className="input" type="datetime-local" value={eventEnd} min={eventStart || undefined} onChange={e => setEventEnd(e.target.value)}/></Field><Field label={localized(L('محل برگزاری / پیوند رویداد','Venue / event link','Mekân / etkinlik bağlantısı','المكان / رابط الحدث','Место / ссылка события'), locale)}><input className="input" value={eventLocation} onChange={e => setEventLocation(e.target.value)}/></Field></>}
    <Field label={wt('due', locale)}><input className="input" type="date" value={due} onChange={e => setDue(e.target.value)}/></Field><Field label={wt('priority', locale)}><select className="input" value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>{['high', 'normal', 'low'].map(p => <option key={p} value={p}>{wt(p, locale)}</option>)}</select></Field>
    {isContent && <Field label={wt('source', locale)}><input className="input" dir="ltr" type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}/></Field>}</div>
    </fieldset><div className="ws-dialog-actions"><button type="button" className="btn" onClick={onClose}>{wt('cancel', locale)}</button><button className="btn btn-primary" disabled={!allowed||store.pending} type="submit"><Save size={16}/>{wt('save', locale)}</button></div>
  </form></Modal>;
}

export function RecordDetail({ record, store, onClose, onEdit }: { record: WorkspaceRecord; store: WorkspaceStore; onClose: () => void; onEdit?: () => void }) {
  const { locale, role, state } = store;
  const products=useRecordProducts(state.records);
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<'internal' | 'public'>('internal');
  const [scheduled, setScheduled] = useState('');
  const [publicationLocale, setPublicationLocale] = useState((record.details?.commercialDraft as CommercialDraft|undefined)?.locale||locale);
  const [issuing, setIssuing] = useState(false);
  const editable = canEdit(role, record.collection);
  const can=(action:WorkspaceAction)=>canRecordAction(store.actor,action,record);
  const relatedProduct = products.find(p => p.id === record.product);
  const productRelease = record.collection === 'products' && relatedProduct ? parseProductRelease(record.details?.productReviewDraft,relatedProduct) : null;
  const submitReview = async () => {
    if(!store.permit('submit',record.collection))return store.notify(wt('denied',locale));
    let details = record.details;
    if (record.collection === 'products' && relatedProduct && record.details?.productDraft) {
      try {
        const draft = readProductDraft(record.details.productDraft,relatedProduct);
        for (const language of workspaceLocales) { draft.localized[language].title = record.title[language]; draft.localized[language].shortDescription = record.summary[language]; }
        details = {...details,productReviewDraft:createProductRelease(draft,relatedProduct)};
      } catch { return store.notify(wt('required',locale)); }
    }
    await store.patchRecord(record.id,{status:'review',author:role,approvedBy:undefined,details});
  };
  const convert = async () => {
    if(!store.permit('convert',record.collection))return store.notify(wt('denied',locale));
    if (record.status === 'converted' || state.records.some(r => r.linkedId === record.id && r.collection === 'opportunities')) return;
    const id = uid('OPP');
    const event = store.log(L('سرنخ به فرصت مرتبط تبدیل شد.','Lead converted into a linked opportunity.','Aday bağlantılı fırsata dönüştürüldü.','تم تحويل العميل المحتمل إلى فرصة مرتبطة.','Лид преобразован в связанную возможность.'));
    await store.update(previous => ({ ...previous, records: [{ ...record, id, collection: 'opportunities', details:copiedEditorialDetails(record.details), approvedBy:undefined,approvedById:undefined,publishedLocales:[],scheduledAt:undefined,status: 'new', linkedId: record.id, requestId: undefined, createdAt: now(), updatedAt: now(), history: [event] }, ...previous.records.map(r => r.id === record.id ? { ...r, status: 'converted', linkedId: id, history: [...r.history, event] } : r)], audit: [event, ...previous.audit] }), wt('convertedNotice', locale));
  };
  const approve = async () => {
    if (!can('review')||!store.permit('review',record.collection)) return store.notify(wt('noSelfReview', locale));
    await store.review('records',record.id,publicationLocale);
  };
  const publish = async () => {
    if(!store.permit('publish',record.collection))return store.notify(wt('denied',locale));
    if (!['approved','published'].includes(record.status)) return store.notify(wt('onlyApproved', locale));
    const relatedArticle = articles.find(article => article.id === record.id);
    const kind = record.collection === 'products' ? 'product' : record.collection === 'pages' ? 'page' : record.collection;
    if (!record.title[publicationLocale]?.trim() || !record.summary[publicationLocale]?.trim()) return store.notify(wt('required', locale));
    if (record.collection === 'products' && record.details?.productDraft && !productRelease) return store.notify(wt('reviewRequired',locale));
    const slug = record.collection === 'products' ? relatedProduct?.slug || record.id : record.collection === 'research' ? relatedArticle?.slug || record.id : record.collection === 'pages' ? record.tags[0] || record.id.toLowerCase() : record.id.toLowerCase();
    const published=await store.publish({ id: record.id, slug, kind, locale: publicationLocale, title: record.title[publicationLocale], summary: record.summary[publicationLocale], body: record.summary[publicationLocale], blocks: [], publishedAt: now(), version: (record.history.length || 0) + 1, ...(record.collection === 'events' ? { eventStart: record.eventStart, eventEnd: record.eventEnd, location: record.location } : {}), ...(productRelease ? {productRelease} : {}), ...(parseCustomProduct(record.details?.customProduct)?{customProduct:parseCustomProduct(record.details?.customProduct)!}:{}) });
    if(published&&demoMode)await store.patchRecord(record.id, { status: 'published', publishedLocales: [...new Set([...(record.publishedLocales || []), publicationLocale])] }, '');
  };
  const issueQuote = async () => {
    if(!store.permit('issue','quotes'))return store.notify(wt('denied',locale));
    if (record.collection !== 'quotes' || !['approved','published'].includes(record.status) || !record.requestId || !record.amount || !record.approvedBy || (record.authorId&&record.approvedById?record.approvedById===record.authorId:record.approvedBy===record.author)) return store.notify(localized(L('پیشنهاد باید با مبلغ مشخص توسط نقش دیگری تأیید و به استعلام مشتری متصل شود.','The proposal needs a known amount, approval by a different role and a linked customer inquiry.','Teklif için bilinen tutar, farklı rol onayı ve bağlı müşteri talebi gereklidir.','يتطلب العرض مبلغاً محدداً واعتماد دور آخر واستفسار عميل مرتبطاً.','Для предложения нужны сумма, согласование другой ролью и связанный запрос клиента.'), locale));
    setIssuing(true);
    try {
      if(!demoMode){await apiClient.request(`/requests/${encodeURIComponent(record.requestId)}/quotes`,{method:'POST',body:JSON.stringify({recordId:record.id})});await store.refresh();window.dispatchEvent(new Event('idealmakoo:requests'));store.notify(wt('saved',locale));return;}
      let commercialDraft = record.details?.commercialDraft as CommercialDraft | undefined;
      if (commercialDraft) {
        const calculated = calculateCommercial(commercialDraft.lines, commercialDraft.currency);
        if (commercialDraft.schemaVersion !== 1 || commercialDraft.kind !== 'quote' || commercialDraft.currency !== record.currency || !commercialDraft.lines.every(line => products.some(product => product.id === line.productId)) || !calculated.ok || !calculated.value.complete || record.amount !== calculated.value.grandTotalDecimal) {
          store.notify(localized(L('ردیف‌ها و مبلغ پیشنهاد سازگار نیستند؛ آن را در ویرایشگر چندردیفی ذخیره و دوباره تأیید کنید.','Quote lines and total do not match. Save it in the multiline editor and review it again.','Teklif satırları ve toplam uyuşmuyor. Çok satırlı düzenleyicide kaydedip yeniden onaylayın.','سطور العرض والمجموع غير متطابقة. احفظه في المحرر متعدد السطور وأعد المراجعة.','Строки и итог предложения не совпадают. Сохраните его в редакторе строк и согласуйте снова.'),locale));
          return;
        }
        commercialDraft = {...commercialDraft,estimate:calculated.value};
      }
      const requests = parseFrontRequests(JSON.parse(localStorage.getItem('idealmakoo.requests.v1') || '[]'),getPublishedProductInventory());
      const request = requests.find(r => r.id === record.requestId);
      if (!request||request.kind!=='rfq'||['withdrawn','closed','resolved'].includes(request.status)) throw new Error('missing');
      const snapshot = JSON.stringify({ id: record.id, organization: record.organization, amount: record.amount, currency: record.currency, product: record.product, title: record.title, terms: record.summary, approvedBy: record.approvedBy, requestId: record.requestId, validUntil: record.due || null, commercialDraft: commercialDraft || null });
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
      const snapshotHash = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      const quote = { id: record.id, number: record.id, title: record.title[locale], amount: record.amount, currency: record.currency || 'IRR', status: 'issued', issuedAt: now(), validUntil: record.due ? new Date(record.due + 'T23:59:59Z').toISOString() : undefined, snapshotHash, lines:commercialQuoteLines(commercialDraft),terms:record.summary[locale] };
      if(!store.permit('issue','quotes'))return;
      const latestRequests = parseFrontRequests(JSON.parse(localStorage.getItem('idealmakoo.requests.v1') || '[]'),getPublishedProductInventory());
      const latestRequest=latestRequests.find(item=>item.id===request.id);
      if (!latestRequest||latestRequest.kind!=='rfq'||['withdrawn','closed','resolved'].includes(latestRequest.status)) throw new Error('missing');
      const persisted=JSON.parse(localStorage.getItem('idealmakoo.workspace.v1')||'null');
      const latestRecord=Array.isArray(persisted?.records)?persisted.records.find((item:WorkspaceRecord)=>item.id===record.id):undefined;
      if(!latestRecord||latestRecord.status!=='approved'||latestRecord.updatedAt!==record.updatedAt||latestRecord.approvedBy!==record.approvedBy||latestRecord.approvedById!==record.approvedById||JSON.stringify(latestRecord.details?.commercialDraft)!==JSON.stringify(record.details?.commercialDraft)){store.notify(wt('revisionConflict',locale));return;}
      localStorage.setItem('idealmakoo.requests.v1', JSON.stringify(latestRequests.map(r => r.id === request.id ? { ...r, version:(r.version || 1)+1, sharedQuotes: [...(r.sharedQuotes || []).filter(q => q.id !== quote.id), quote] } : r)));
      window.dispatchEvent(new CustomEvent('idealmakoo:requests'));
      await store.patchRecord(record.id, { status: 'proposal' });
    } catch { store.notify(localized(L('استعلام معتبر یا قابلیت ثبت نسخه در دسترس نیست.','A valid inquiry or snapshot capability is unavailable.','Geçerli talep veya sürüm kaydı kullanılamıyor.','لا يتوفر استفسار صالح أو إمكانية تسجيل الإصدار.','Нет действительного запроса или возможности сохранить версию.'), locale)); }
    finally { setIssuing(false); }
  };
  if(!canReadRecord(role,record))return null;
  return <Modal title={wt('details', locale)} onClose={onClose} wide><div className="ws-detail-body ws-print-document"><div className="ws-flex-between"><div className="ws-detail-id"><bdi>{record.id}</bdi><span>{parseCustomProduct(record.details?.customProduct)?customProductCopy.authored[locale]:wt(record.demo ? 'sample' : 'verified', locale)}</span></div><Status status={record.status} locale={locale}/></div><h2 className="ws-detail-title">{localized(record.title, publicationLocale)}</h2><p className="ws-detail-summary">{localized(record.summary, publicationLocale)}</p>{!!record.details?.editorialContent&&(()=>{const content=record.details.editorialContent as {body?:Record<string,string>;mediaUrl?:string;mediaType?:string;mediaTitle?:string;seo?:EditorialSeoByLocale};return <section lang={publicationLocale} dir={['fa','ar'].includes(publicationLocale)?'rtl':'ltr'}><EditorialSeoFacts seo={content.seo?.[publicationLocale]} locale={publicationLocale}/>{content.body?.[publicationLocale]&&<AiMarkdown text={content.body[publicationLocale]} locale={publicationLocale} content/>}{content.mediaUrl&&safeUrl(content.mediaUrl)&&(content.mediaType==='image'?<img className="ws-detail-image" src={content.mediaUrl} alt={content.mediaTitle||''}/>:content.mediaType==='video'?<video controls src={content.mediaUrl} style={{maxWidth:'100%'}}/>:content.mediaType==='audio'?<audio controls src={content.mediaUrl}/>:<a className="btn" href={content.mediaUrl} download>{content.mediaTitle||wt('download',locale)}</a>)}</section>;})()}
    {record.image && <img className="ws-detail-image" src={record.image} alt={localized(record.title, locale)}/>}
    {productRelease && relatedProduct && <ProductReleaseSection release={productRelease} product={relatedProduct} mode={record.status==='published'?'published':'review'}/>}
    {['quotes','pricebooks'].includes(record.collection) && <QuoteLines lines={commercialQuoteLines(record.details?.commercialDraft)}/>}
    <div className="ws-detail-grid">{[[wt('owner', locale), localized(roleNames[record.owner] || record.owner, locale)], [wt('organization', locale), record.organization], [wt('email', locale), record.email], [wt('product', locale), relatedProduct ? localized(relatedProduct.name, locale) : record.product], [wt('updated', locale), safeDate(record.updatedAt, locale)], [wt('priority', locale), wt(record.priority || 'normal', locale)]].map(([label, value]) => <div key={label}><small>{label}</small><strong><bdi>{value || '—'}</bdi></strong></div>)}</div>
    {safeUrl(record.sourceUrl) && <a className="ws-source-link" href={record.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>{wt('source', locale)}<bdi>{new URL(record.sourceUrl!, 'https://idealmakoo.com').hostname}</bdi></a>}
    {record.collection === 'quotes' && <div className="ws-proposal-box"><FileText size={26}/><div><h3>{record.amount ? <bdi>{record.amount} {record.currency}</bdi> : wt('unknown', locale)}</h3><p>{wt('proposalNote', locale)}</p></div></div>}
    {!demoMode&&!contentCollections.includes(record.collection)&&<><RecordAssignment record={record} store={store}/>{record.requestId&&<RequestRoutingFacts requestId={record.requestId} store={store}/>}<CrmDomainPanel record={record} store={store}/><CrmActivityPanel recordId={record.id} store={store}/><CrmAssist record={record} store={store}/></>}
    <div className="ws-detail-actions ws-no-print">{record.collection === 'quotes' && record.status === 'approved' && can('issue') && <button className="btn btn-primary" onClick={issueQuote} disabled={issuing}><Send size={16}/>{localized(L('اشتراک نسخه مصوب در پورتال مشتری','Share approved version in customer portal','Onaylı sürümü müşteri portalında paylaş','مشاركة الإصدار المعتمد في بوابة العميل','Передать согласованную версию в портал клиента'), locale)}</button>}{editable && onEdit && (demoMode||!record.details?.crmDomain) && <button className="btn" onClick={onEdit}><Edit3 size={16}/>{wt('edit', locale)}</button>}{demoMode&&record.collection === 'leads' && can('convert') && record.status !== 'converted' && <button className="btn btn-primary" onClick={convert}><ArrowRightLeft size={16}/>{wt('convert', locale)}</button>}{record.collection === 'quotes' && <button className="btn" onClick={() => window.print()}><Printer size={16}/>{wt('print', locale)}</button>}{can('submit') && ['draft', 'working'].includes(record.status) && (contentCollections.includes(record.collection) || ['quotes','pricebooks'].includes(record.collection)) && <button className="btn" onClick={submitReview}><Send size={16}/>{wt('sendReview', locale)}</button>}{['review','approved','published'].includes(record.status) && can('review') && <button className="btn btn-primary" onClick={approve}><ShieldCheck size={16}/>{wt('approve', locale)}</button>}{['approved','published'].includes(record.status) && contentCollections.includes(record.collection) && can('publish') && <button className="btn btn-primary" onClick={publish}><CheckCircle2 size={16}/>{wt('publish', locale)}</button>}</div>
    {contentCollections.includes(record.collection) && <div className="ws-publication-links ws-no-print"><Field label={wt('language', locale)}><select className="input" value={publicationLocale} onChange={e => setPublicationLocale(e.target.value as typeof publicationLocale)}>{workspaceLocales.map(lang => <option key={lang} value={lang}>{({ fa:'فارسی',en:'English',tr:'Türkçe',ar:'العربية',ru:'Русский' })[lang]}</option>)}</select></Field>{record.status === 'published' && <a className="btn ws-small-btn" href={relatedProduct ? `/${publicationLocale}/${productPath(relatedProduct)}` : articles.find(a => a.id === record.id) ? `/${publicationLocale}/research/${articles.find(a => a.id === record.id)!.slug}` : `/${publicationLocale}/page/?id=${encodeURIComponent(record.id)}`} target="_blank" rel="noreferrer"><ExternalLink size={15}/>{wt('openSite', locale)}</a>}</div>}
    {demoMode&&['approved','published'].includes(record.status) && contentCollections.includes(record.collection) && can('publish') && <div className="ws-schedule-row ws-no-print"><Field label={wt('date', locale)}><input className="input" type="datetime-local" value={scheduled} min={new Date().toISOString().slice(0, 16)} onChange={e => setScheduled(e.target.value)}/></Field><button className="btn" disabled={!scheduled} onClick={async () => await store.patchRecord(record.id, { status: 'scheduled', scheduledAt: new Date(scheduled).toISOString() })}><CalendarDays size={16}/>{wt('schedule', locale)}</button></div>}
    {demoMode&&record.scheduledAt && <p className="ws-inline-note">{safeDate(record.scheduledAt, locale, { dateStyle: 'medium', timeStyle: 'short' })} · {wt('scheduledHint', locale)}</p>}
    {contentCollections.includes(record.collection)&&<PublicationSchedule store={store} bucket="records" id={record.id} locale={publicationLocale} status={record.status}/>}
    {contentCollections.includes(record.collection)&&<RevisionHistory store={store} bucket="records" id={record.id} locale={publicationLocale} canRestore={editable}/>}
    <section className="ws-timeline-section"><h3>{wt('timeline', locale)}</h3><div className="ws-timeline">{record.history.slice().reverse().map((event, i) => <div className="ws-timeline-entry" key={`${event.id}-${i}`}><span className="ws-timeline-dot"/><div><p>{localized(event.text, locale)}</p><small>{safeDate(event.at, locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {localized(roleNames[event.actor] || event.actor, locale)} · {wt(event.visibility === 'internal' ? 'internal' : 'publicReply', locale)}</small></div></div>)}</div></section>
    {can('note') && <form className="ws-note-form ws-no-print" onSubmit={async event => { event.preventDefault(); if (note.trim()) { if(await store.addNote(record.id, note.trim(), visibility))setNote(''); } }}><Field label={wt('note', locale)}><textarea className="input" rows={3} required value={note} onChange={e => setNote(e.target.value)}/></Field><div className="ws-flex-between"><select className="input" value={visibility} onChange={e => setVisibility(e.target.value as typeof visibility)}><option value="internal">{wt('internal', locale)}</option>{can('reply')&&<option value="public">{wt('publicReply', locale)}</option>}</select><button className="btn btn-primary" type="submit"><Send size={16}/>{wt('addNote', locale)}</button></div></form>}
  </div></Modal>;
}
