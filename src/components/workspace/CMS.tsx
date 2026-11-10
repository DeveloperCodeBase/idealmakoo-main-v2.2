'use client';
import RichTextEditor from './RichTextEditor';
import TaxonomyFields,{taxonomyCopy,validTaxonomy} from './TaxonomyFields';
import ContentCollaboration,{type LeaseState} from './ContentCollaboration';
import SharedBlockLibrary from './SharedBlockLibrary';
import PublicationSchedule from './PublicationSchedule';
import PageLifecycle,{type PageLifecycleView} from './PageLifecycle';
import PageNavigationGuard from './PageNavigationGuard';
import AiMarkdown from '@/components/ui/AiMarkdown';
import RevisionHistory from './RevisionHistory';
import RevisionDiff from './RevisionDiff';
import TranslationStatusPanel from './TranslationStatusPanel';
import AiContentTranslation from './AiContentTranslation';
import {canManageSitePage} from '@/lib/page-authority';
import {assertEditorSource,captureEditorSource,editorSourceMatches} from '@/lib/editor-source';
import {apiClient,demoMode,networkError} from '@/lib/api';
import type {ManagedWorkspacePage,PageLifecycleStatus} from '@/types/page-lifecycle';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Eye, FileText, GripVertical, Image as ImageIcon, LayoutTemplate, Link2, Monitor, Plus, Save, Search, Send, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import { products as officialProducts, resources, type Product } from '@/data/catalog';
import { localizedPath, productPath, workspaceProducts } from '@/lib/custom-products';
import { usePublications } from '@/lib/publications';
import {GalleryPreview} from './GalleryPreview';
import { canWorkspace } from '@/lib/auth';
import { direction, translate } from '@/lib/i18n';
import { carouselUrl } from '@/lib/carousel';
import { createSiteDraft, upgradeHomeBlocks } from '@/lib/site-content';
import {createPageTranslationDraft} from '@/lib/page-translation';
import { parseFormSchema, validateFormValues, type PublicFormSchema } from '@/lib/form-schema';
import { PageBlock, PageDraft } from '@/data/workspace-seed';
import { WorkspaceStore, WORKSPACE_KEY, fullText, now, safeUrl, uid } from './store';
import { L, WorkspaceLocale, blockTypes, localized, workspaceLocales, wt } from './i18n';
import { Field, Modal, Status } from './ui';

const nativeNames = { fa: 'فارسی', en: 'English', tr: 'Türkçe', ar: 'العربية', ru: 'Русский' };

export function PageBuilder({ store, translationOnly = false }: { store: WorkspaceStore; translationOnly?: boolean }) {
  const { state, locale, role } = store;
  const products=workspaceProducts(state.records);
  const defaultLocale = translationOnly && locale === 'fa' ? 'en' : locale;
  const first = state.pages.find(p => p.locale === defaultLocale) || state.pages[0] || createSiteDraft('home', defaultLocale, role, store.actorId);
  const [pageId, setPageId] = useState(first?.id || '');
  const selected = state.pages.find(p => p.id === pageId) || first;
  const [draft, setDraft] = useState<PageDraft>(() => structuredClone(first));
  const [activeBlock, setActiveBlock] = useState(first?.blocks[0]?.id || '');
  const [blockQuery, setBlockQuery] = useState('');
  const [preview, setPreview] = useState(false);
  const [viewport, setViewport] = useState('desktop');
  const [drag, setDrag] = useState<string | null>(null);
  const [newPage, setNewPage] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [changes, setChanges] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const capturedSource=useRef(captureEditorSource(store.getState().pages.find(page=>page.id===first.id))),editorEpoch=useRef(0);
  const pending=useRef(false),mounted=useRef(true);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;editorEpoch.current++;};},[]);
  useEffect(()=>{if(!changes&&!busy)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[changes,busy]);
  const block = draft?.blocks.find(item => item.id === activeBlock);
  const [leaseState,setLeaseState]=useState<LeaseState>('loading');
  const [lifecycle,setLifecycle]=useState<{id:string;status:PageLifecycleView}>({id:first.id,status:'checking'});
  const persisted=state.pages.find(page=>page.id===draft.id);
  const sourceChanged=!editorSourceMatches(capturedSource.current,persisted);
  const pageActive=draft.status!=='archived'&&(demoMode||lifecycle.id===draft.id&&['active','missing'].includes(lifecycle.status));
  const pageAuthority=canManageSitePage(role,draft.slug)&&(!persisted||canManageSitePage(role,persisted.slug));
  const structuralAllowed=pageAuthority&&canWorkspace(role,'edit','pages',{...store.actor,locale:draft.locale});
  const editingAllowed=pageAuthority&&(structuralAllowed||(translationOnly&&canWorkspace(role,'translate','pages',{...store.actor,locale:draft.locale})));
  const leaseEditable=demoMode||!persisted||leaseState==='held';
  const structuralEditable=pageActive&&structuralAllowed&&leaseEditable&&!sourceChanged&&!busy&&!store.pending;
  const editable=pageActive&&editingAllowed&&leaseEditable&&!sourceChanged&&!busy&&!store.pending;
  const blockEditable=editable&&!block?.shared;
  useEffect(()=>{if(!changes&&persisted&&persisted.updatedAt!==draft.updatedAt){capturedSource.current=captureEditorSource(persisted);setDraft(structuredClone(persisted));setActiveBlock(previous=>persisted.blocks.some(item=>item.id===previous)?previous:persisted.blocks[0]?.id||'');}},[persisted,changes,draft.updatedAt]);
  const canReview = pageActive && pageAuthority && !busy && !store.pending && !sourceChanged && canWorkspace(role, 'review', 'pages', {...store.actor,locale:draft.locale,authorId:draft.authorId,authorRole:draft.author,actorId:store.actorId});
  const canPublish = pageActive && pageAuthority && !busy && !store.pending && !sourceChanged && canWorkspace(role, 'publish', 'pages',{...store.actor,locale:draft.locale});
  const choose = (page: PageDraft) => {
    if(pending.current)return;
    editorEpoch.current++;capturedSource.current=captureEditorSource(store.getState().pages.find(item=>item.id===page.id));
    const upgraded = page.status!=='archived' && page.slug === 'home' && canWorkspace(role,'edit','pages',{...store.actor,locale:page.locale}) ? upgradeHomeBlocks(page.blocks,page.locale) : {blocks:page.blocks,upgraded:false};
    const next = upgraded.upgraded ? {...page,blocks:upgraded.blocks,status:'draft' as const,approvedBy:undefined,approvedById:undefined,author:role,authorId:store.actorId} : page;
    if(page.id!==draft.id||draft.status==='archived')setLeaseState('loading');setPageId(page.id); setDraft(structuredClone(next)); setActiveBlock(next.blocks[0]?.id || ''); setChanges(upgraded.upgraded);
  };
  const adoptCommitted=(page:PageDraft,epoch:number)=>{if(!mounted.current||epoch!==editorEpoch.current)return;capturedSource.current=captureEditorSource(page);setDraft(structuredClone(page));setChanges(false);};
  const adoptLifecycle=(page:PageDraft,status:PageLifecycleStatus)=>{editorEpoch.current++;capturedSource.current=captureEditorSource(store.getState().pages.find(item=>item.id===page.id));if(page.id!==draft.id||draft.status==='archived')setLeaseState('loading');setPageId(page.id);setDraft(structuredClone(page));setActiveBlock(page.blocks[0]?.id||'');setChanges(false);setLifecycle({id:page.id,status});};
  useEffect(() => {
    if(!store.loaded)return;
    const query=new URLSearchParams(window.location.search),requested=query.get('id')||query.get('record'),page=state.pages.find(item=>item.id===requested);
    if(page||!requested||demoMode){choose(page||first);return;}
    const controller=new AbortController(),epoch=editorEpoch.current;
    void apiClient.request<{item:ManagedWorkspacePage}>(`/workspace/pages/${encodeURIComponent(requested)}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted&&epoch===editorEpoch.current&&result.item.page.id===requested)adoptLifecycle(result.item.page,result.item.status);}).catch(error=>{if(!controller.signal.aborted&&epoch===editorEpoch.current)store.notify(networkError(error,locale));});
    return()=>controller.abort();
  }, [store.loaded]);
  const change = (patch: Partial<PageDraft>) => { if(!editable||pending.current)return; setDraft(previous => ({ ...previous, ...patch, status: 'draft', approvedBy: undefined, approvedById: undefined })); setChanges(true); };
  const updateBlock = (patch: Partial<PageBlock>) => {if(!blockEditable)return;change({ blocks: draft.blocks.map(item => item.id === activeBlock ? { ...item, ...patch } : item) });};
  const add = (type: string) => { if(!structuralEditable)return; const id = uid('block'); const label = blockTypes.find(([key]) => key === type)?.[1]; change({ blocks: [...draft.blocks, { id, type, title: label ? localized(label, draft.locale) : '', body: '', mediaUrl: ['hero', 'image', 'split', 'gallery'].includes(type) ? products[0]?.image : undefined }] }); setActiveBlock(id); };
  const reorder = (id: string, offset: number) => { if(!structuralEditable)return; const blocks = [...draft.blocks]; const index = blocks.findIndex(item => item.id === id); const target = index + offset; if (target < 0 || target >= blocks.length) return; [blocks[index], blocks[target]] = [blocks[target], blocks[index]]; change({ blocks }); };
  const drop = (target: string) => { if (!structuralEditable || !drag || drag === target) return; const blocks = [...draft.blocks]; const index = blocks.findIndex(item => item.id === drag); const targetIndex = blocks.findIndex(item => item.id === target); if (index < 0 || targetIndex < 0) return; const [item] = blocks.splice(index, 1); blocks.splice(targetIndex, 0, item); change({ blocks }); setDrag(null); };
  const save = async (status: PageDraft['status'] = 'draft', approvedBy?: string) => {
    if(!pageActive||pending.current||store.pending)return;
    if(!validTaxonomy(draft.taxonomy))return store.notify(localized(taxonomyCopy.invalid,locale));
    const origin=capturedSource.current,epoch=editorEpoch.current;
    const action = status === 'approved' ? 'review' : status === 'published' ? 'publish' : status === 'review' ? 'submit' : structuralEditable ? 'edit' : 'translate';
    if(!['approved','published'].includes(status)&&!editable)return;
    if(!store.permit(action,'pages',draft.locale))return;
    if(status==='approved'&&(!canReview||changes))return store.notify(wt('noSelfReview',locale));
    if (!draft.title.trim() || !draft.slug.trim() || (status!=='draft'&&(!draft.summary.trim()||!draft.blocks.some(block=>!block.hidden&&(block.body.trim()||block.mediaUrl||block.type.includes('carousel')||block.formId))))) { store.notify(wt('required', locale)); return; }
    const blocks = ['draft','review'].includes(status) && structuralEditable ? draft.blocks.map(block => block.type === 'form' && block.formId ? {...block, formSchema: parseFormSchema(state.forms.find(form => form.id === block.formId && form.status!=='archived')) || undefined} : block) : draft.blocks;
    if (status!=='draft'&&blocks.some(block => block.formId && !block.formSchema)) { store.notify(wt('required', locale)); return; }
    if(demoMode)try { const persisted = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || '{}'); const current = persisted.pages?.find((p: PageDraft) => p.id === draft.id); if (current && current.version > draft.version) { store.notify(wt('revisionConflict', locale)); return; } } catch { /* First local revision. */ }
    pending.current=true;setBusy(true);
    try{
    if(status==='approved'&&!demoMode){if(!await store.review('pages',draft.id,draft.locale))return;const approved=store.getState().pages.find(page=>page.id===draft.id);if(approved)adoptCommitted(approved,epoch);return approved;}
    const preserved = ['approved','published'].includes(status);
    const saved: PageDraft = { ...draft, blocks, status, version: draft.version + 1, updatedAt: now(), author: preserved ? draft.author : role, authorId:preserved?draft.authorId:store.actorId, approvedBy, approvedById:status==='approved'?store.actorId:status==='published'?draft.approvedById:undefined, previous: { title: selected?.title || draft.title, summary: selected?.summary || draft.summary, blocks: selected?.blocks || draft.blocks, version: selected?.version || draft.version } };
    if(!await store.update(previous => {if(!demoMode)assertEditorSource(origin,previous.pages.find(page=>page.id===saved.id));return { ...previous, pages: [...previous.pages.filter(p => p.id !== saved.id), saved], audit: [store.log(L('نسخه جدید صفحه ذخیره شد.','A new page revision was saved.','Yeni sayfa sürümü kaydedildi.','تم حفظ إصدار جديد للصفحة.','Сохранена новая версия страницы.')), ...previous.audit] };}, wt('saved', locale))||epoch!==editorEpoch.current)return;
    const committed=store.getState().pages.find(page=>page.id===saved.id)||saved;adoptCommitted(committed,epoch);return committed;
    }catch(error){if(mounted.current&&epoch===editorEpoch.current)store.notify(networkError(error,locale));}
    finally{pending.current=false;if(mounted.current&&epoch===editorEpoch.current)setBusy(false);}
  };
  const review = () => { if (editable) save('review'); };
  const approve = () => { if (!canReview) return store.notify(wt('noSelfReview', locale)); save('approved', role); };
  const publish = async () => {
    if(pending.current||store.pending)return;
    if (!canPublish || draft.status !== 'approved' || changes) return store.notify(wt('reviewRequired', locale));
    if (draft.blocks.some(block => block.formId && !block.formSchema)) return store.notify(wt('required', locale));
    const epoch=editorEpoch.current;pending.current=true;setBusy(true);let accepted=false;
    try{accepted=await store.publish({id:draft.id,slug:draft.slug,kind:'page',locale:draft.locale,title:draft.title,summary:draft.summary,body:draft.blocks.filter(block=>!block.hidden).map(item=>item.title+'\n'+item.body).join('\n\n'),blocks:draft.blocks,taxonomy:draft.taxonomy,publishedAt:now(),version:draft.version+1});if(accepted&&!demoMode){const published=store.getState().pages.find(page=>page.id===draft.id);if(published)adoptCommitted(published,epoch);}}
    catch(error){if(mounted.current&&epoch===editorEpoch.current)store.notify(networkError(error,locale));}
    finally{pending.current=false;if(mounted.current&&epoch===editorEpoch.current)setBusy(false);}
    if(accepted&&demoMode&&mounted.current&&epoch===editorEpoch.current)await save('published',draft.approvedBy);
  };
  const createPage = async (event: React.FormEvent) => {
    event.preventDefault();if(pending.current||store.pending||changes||!store.permit('create','pages'))return;
    const page:PageDraft={id:uid('PAGE'),slug,locale,title:name,summary:'',version:1,status:'draft',author:role,authorId:store.actorId,updatedAt:now(),blocks:[]},epoch=editorEpoch.current;
    pending.current=true;setBusy(true);
    try{if(!await store.update(previous=>({...previous,pages:[...previous.pages,page]}))||!mounted.current||epoch!==editorEpoch.current)return;pending.current=false;choose(store.getState().pages.find(item=>item.id===page.id)||page);setNewPage(false);setName('');setSlug('');}
    catch(error){if(mounted.current&&epoch===editorEpoch.current)store.notify(networkError(error,locale));}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  };
  const changeLanguage = async (lang:WorkspaceLocale) => {
    if(pending.current||store.pending||changes)return;const version=state.pages.find(page=>page.slug===draft.slug&&page.locale===lang);if(version){choose(version);return;}
    if(!pageActive||!store.permit(structuralEditable?'create':'translate','pages',lang))return;
    const next=createPageTranslationDraft(draft,{id:uid('PAGE'),locale:lang,author:role,authorId:store.actorId,updatedAt:now()}),epoch=editorEpoch.current;pending.current=true;setBusy(true);
    try{if(await store.update(previous=>({...previous,pages:[...previous.pages,next]}))&&mounted.current&&epoch===editorEpoch.current){pending.current=false;choose(store.getState().pages.find(page=>page.id===next.id)||next);}}
    catch(error){if(mounted.current&&epoch===editorEpoch.current)store.notify(networkError(error,locale));}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  };
  if (!draft) return null;
  return <div className="ws-builder" data-page-editor data-page-id={draft.id} data-page-dirty={changes} data-page-busy={busy||store.pending}>
    <PageNavigationGuard dirty={changes} busy={busy||store.pending} isPending={()=>pending.current||store.pending} locale={locale}/>
    <div className="ws-builder-top"><div className="ws-builder-selector"><LayoutTemplate size={19}/><select className="input" aria-label={wt('pages', locale)} disabled={changes||busy||store.pending} value={pageId} onChange={event => { const page = state.pages.find(p => p.id === event.target.value); if (page) choose(page); }}>{!state.pages.some(page=>page.id===pageId)&&<option value={pageId}>{draft.title}</option>}{state.pages.filter(p => p.locale === draft.locale).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>{canWorkspace(role,'create','pages',{...store.actor,locale}) && <button className="ws-icon-button" aria-label={wt('create', locale)} disabled={changes||busy||store.pending} onClick={() => setNewPage(true)}><Plus size={18}/></button>}</div><div className="ws-builder-actions"><select className="input" aria-label={wt('language', locale)} disabled={changes||busy||store.pending} value={draft.locale} onChange={event => changeLanguage(event.target.value as WorkspaceLocale)}>{workspaceLocales.map(lang => <option value={lang} key={lang}>{nativeNames[lang]}</option>)}</select><button className={`btn ws-small-btn ${preview ? 'is-active' : ''}`} onClick={() => setPreview(!preview)}><Eye size={16}/>{wt('preview', locale)}</button>{editable && <button className="btn btn-primary ws-small-btn" onClick={() => save()}><Save size={16}/>{wt('saveDraft', locale)}</button>}</div></div>
    <div className="ws-builder-meta"><Status status={draft.status} locale={locale}/><span>{wt('revision', locale)} <bdi>{draft.version}</bdi>{changes ? ' •' : ''}</span><span>{wt('creator', locale)}: <bdi>{draft.author}</bdi></span>{draft.status === 'published' && <a className="ws-text-link" href={`/${draft.locale}/page/?id=${encodeURIComponent(draft.id)}`} target="_blank" rel="noreferrer"><Eye size={14}/>{wt('openSite', locale)}</a>}<a className="ws-text-link" href={`/${locale}/published/`} target="_blank" rel="noreferrer">{wt('publications', locale)}</a><button className="ws-text-link" onClick={() => setShowDiff(true)}>{localized(L('مقایسه نسخه','Compare revision','Sürüm karşılaştır','مقارنة الإصدار','Сравнить версии'), locale)}</button></div>
    <PageLifecycle store={store} page={draft} dirty={changes||busy} onAdopt={adoptLifecycle} onSelect={adoptLifecycle} onStatus={status=>setLifecycle({id:draft.id,status})}/>
    {!demoMode&&persisted&&draft.status!=='archived'&&<ContentCollaboration key={`${draft.id}:${store.actorId}`} store={store} bucket="pages" id={draft.id} sourceUpdatedAt={draft.updatedAt} dirty={changes||busy} canEdit={editingAllowed} locale={draft.locale} onLeaseState={setLeaseState}/>}
    {sourceChanged&&<p role="alert" className="ws-error">{localized(L('نسخه ذخیره‌شده تغییر کرده است؛ برای ادامه نسخه جدید را بارگذاری کنید.','The saved source changed. Reload it before continuing.','Kayıtlı kaynak değişti. Devam etmeden yeniden yükleyin.','تغير المصدر المحفوظ؛ أعد تحميله للمتابعة.','Сохранённый источник изменился. Перезагрузите его для продолжения.'),locale)} <button className="btn" disabled={busy||store.pending} onClick={()=>persisted&&choose(persisted)}>{wt('refresh',locale)}</button></p>}
    <SharedBlockLibrary store={store} page={draft} selectedBlockId={activeBlock} dirty={changes||busy} editable={structuralEditable} onChanged={()=>{const value=store.getState().pages.find(page=>page.id===draft.id);if(value)choose(value);}}/>
    <div className={`ws-builder-layout ${preview ? 'ws-preview-mode' : ''}`}>
      {!preview && <aside className="ws-card ws-block-palette" aria-label={wt('palette', locale)}><div className="ws-card-head"><h3>{wt('palette', locale)}</h3><span className="ws-count">28</span></div><label className="ws-search ws-block-search"><Search size={15}/><input aria-label={wt('search', locale)} value={blockQuery} onChange={e => setBlockQuery(e.target.value)} placeholder={wt('search', locale)}/></label><div className="ws-palette-items" tabIndex={0} role="region" aria-label={wt('palette',locale)}>{blockTypes.filter(([, label]) => localized(label, locale).toLowerCase().includes(blockQuery.toLowerCase())).map(([type, label]) => <button disabled={!structuralEditable} key={type} onClick={() => add(type)}><span className="ws-block-mini"><LayoutTemplate size={18}/></span><span>{localized(label, locale)}</span><Plus size={13}/></button>)}</div></aside>}
      <section className="ws-builder-center"><div className="ws-canvas-toolbar"><span>{wt('preview', locale)}</span><div className="ws-segmented"><button aria-label={wt('desktop', locale)} aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}><Monitor size={16}/></button><button aria-label={wt('mobile', locale)} aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}><Smartphone size={16}/></button></div></div><div className={`ws-page-canvas ${viewport === 'mobile' ? 'ws-canvas-mobile' : ''}`} dir={['fa', 'ar'].includes(draft.locale) ? 'rtl' : 'ltr'}><div className="ws-preview-nav"><b>IDEAL MAKOO</b><span>{wt('products', draft.locale)} · {wt('research', draft.locale)}</span></div>{!draft.blocks.length && <div className="ws-empty"><LayoutTemplate size={40}/><h3>{wt('addBlock', locale)}</h3><p>{wt('blockHelp', locale)}</p></div>}{draft.blocks.filter(item=>!preview||!item.hidden).map((item, index) => <div key={item.id} className={`ws-editable-block ${!preview && activeBlock === item.id ? 'ws-block-selected' : ''}`} draggable={!preview && structuralEditable} onDragStart={() => setDrag(item.id)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); drop(item.id); }} onDragEnd={() => setDrag(null)} onClick={() => { if (!preview) setActiveBlock(item.id); }}>
        {!preview && <div className="ws-block-toolbar"><span><GripVertical size={13}/>{index + 1} · {localized(blockTypes.find(([key]) => key === item.type)?.[1], locale)}</span><div><button disabled={!structuralEditable || index === 0} className="ws-icon-button" aria-label={wt('moveUp', locale)} onClick={e => { e.stopPropagation(); reorder(item.id, -1); }}><ArrowUp size={13}/></button><button disabled={!structuralEditable || index === draft.blocks.length - 1} className="ws-icon-button" aria-label={wt('moveDown', locale)} onClick={e => { e.stopPropagation(); reorder(item.id, 1); }}><ArrowDown size={13}/></button><button disabled={!structuralEditable||!!item.shared} className="ws-icon-button" aria-label={wt('duplicate', locale)} onClick={e => { e.stopPropagation(); const blocks = [...draft.blocks]; blocks.splice(index + 1, 0, { ...item, id: uid('block') }); change({ blocks }); }}><Copy size={13}/></button><button disabled={!structuralEditable||!!item.shared} className="ws-icon-button" aria-label={wt('delete', locale)} onClick={e => { e.stopPropagation(); change({ blocks: draft.blocks.filter(b => b.id !== item.id) }); }}><Trash2 size={13}/></button></div></div>}
        <BlockPreview block={item} galleryScope={draft.id} locale={draft.locale} catalog={products} formSchema={item.formSchema || (item.formId ? parseFormSchema(state.forms.find(form => form.id === item.formId)) || undefined : undefined)}/>
      </div>)}</div></section>
      {!preview && <aside className="ws-card ws-block-inspector" aria-label={wt('edit', locale)}><div className="ws-card-head"><h3>{wt('edit', locale)}</h3><FileText size={17}/></div><Field label={wt('title', locale)}><input className="input" dir={direction(draft.locale)} lang={draft.locale} disabled={!editable} value={draft.title} onChange={e => change({ title: e.target.value })}/></Field><Field label={wt('slug', locale)}><div className="ws-input-icon"><Link2 size={14}/><input className="input" disabled={!structuralEditable} dir="ltr" value={draft.slug} onChange={e => change({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9/-]/g, '') })}/></div></Field><Field label={wt('description', locale)}><textarea className="input" dir={direction(draft.locale)} lang={draft.locale} disabled={!editable} rows={3} value={draft.summary} onChange={e => change({ summary: e.target.value })}/></Field><TaxonomyFields key={draft.id} resetKey={draft.id+draft.updatedAt} value={draft.taxonomy} locale={locale} disabled={!editable} onChange={taxonomy=>change({taxonomy})}/><hr/>{block ? <><span className="ws-eyebrow">{localized(blockTypes.find(([key]) => key === block.type)?.[1], locale)}</span><Field label={wt('title', locale)}><input className="input" dir={direction(draft.locale)} lang={draft.locale} disabled={!blockEditable} value={block.title} onChange={e => updateBlock({ title: e.target.value })}/></Field>{['rich-text','text'].includes(block.type)?<RichTextEditor label={wt('description',locale)} value={block.body} onChange={value=>updateBlock({body:value})} locale={draft.locale} uiLocale={locale} disabled={!blockEditable||store.pending}/>:<Field label={wt('description', locale)}><textarea className="input" dir={direction(draft.locale)} lang={draft.locale} disabled={!blockEditable} rows={6} value={block.body} onChange={e => updateBlock({ body: e.target.value })}/></Field>}{(block.options||structuralAllowed&&['hero','split','cta','notice','contact','map','downloads','features','statistics','certificates','team','testimonials','partners','timeline','text','rich-text'].includes(block.type)) && <><Field label={localized(L('عنوان دکمه اصلی','Primary button label','Ana düğme etiketi','عنوان الزر الرئيسي','Подпись основной кнопки'),locale)}><input className="input" dir={direction(draft.locale)} lang={draft.locale} maxLength={180} disabled={!blockEditable} value={block.options?.ctaLabel||''} onChange={event=>updateBlock({options:{...block.options,ctaLabel:event.target.value}})}/></Field><Field label={localized(L('عنوان دکمه دوم','Secondary button label','İkinci düğme etiketi','عنوان الزر الثاني','Подпись второй кнопки'),locale)}><input className="input" dir={direction(draft.locale)} lang={draft.locale} maxLength={180} disabled={!blockEditable} value={block.options?.secondaryLabel||''} onChange={event=>updateBlock({options:{...block.options,secondaryLabel:event.target.value}})}/></Field><Field label={localized(L('پیوند دکمه دوم','Secondary button link','İkinci düğme bağlantısı','رابط الزر الثاني','Ссылка второй кнопки'),locale)}><input className="input" dir="ltr" disabled={!structuralEditable||!!block.shared} value={block.options?.secondaryLink||''} onChange={event=>updateBlock({options:{...block.options,secondaryLink:event.target.value}})}/></Field></>}<>{block.type === 'form' && <Field label={wt('forms', locale)}><select className="input" disabled={!structuralEditable||!!block.shared} value={block.formId || ''} onChange={e => updateBlock({formId: e.target.value || undefined, formSchema: undefined})}><option value="">{localized(L('فرم تماس استاندارد','Standard contact form','Standart iletişim formu','نموذج التواصل القياسي','Стандартная контактная форма'), locale)}</option>{state.forms.filter(form=>form.status!=='archived').map(form => <option key={form.id} value={form.id}>{localized(form.title, locale)} · v{form.version}</option>)}</select></Field>}</><Field label={wt('mediaUrl', locale)}><input className="input" disabled={!structuralEditable||!!block.shared} dir="ltr" value={block.mediaUrl || ''} onChange={e => updateBlock({ mediaUrl: e.target.value })}/></Field><Field label={wt('link', locale)}><input className="input" disabled={!structuralEditable||!!block.shared} dir="ltr" value={block.link || ''} onChange={e => updateBlock({ link: e.target.value })}/></Field></> : <p className="ws-muted">{wt('addBlock', locale)}</p>}</aside>}
    </div>
    {persisted&&<TranslationStatusPanel store={store} bucket="pages" id={draft.id} locale={draft.locale} capturedUpdatedAt={capturedSource.current?.updatedAt||draft.updatedAt} dirty={changes||sourceChanged||busy} editable={editable}/> }
    {persisted&&<AiContentTranslation store={store} bucket="pages" id={draft.id} locale={draft.locale} capturedUpdatedAt={capturedSource.current?.updatedAt||draft.updatedAt} dirty={changes||sourceChanged||busy} editable={editable}/>}
    {pageAuthority&&<PublicationSchedule store={store} bucket="pages" id={draft.id} locale={draft.locale} status={draft.status} dirty={changes||busy||sourceChanged} onChanged={()=>{const committed=store.getState().pages.find(page=>page.id===draft.id);if(committed)choose(committed);}}/>}
    <RevisionHistory store={store} bucket="pages" id={draft.id} locale={draft.locale} canRestore={structuralEditable&&!changes} onRestored={()=>{const restored=store.getState().pages.find(page=>page.id===draft.id);if(restored)choose(restored);}}/>
    <div className="ws-builder-footer"><p>{wt('blockHelp', locale)}</p><div>{editable && ['draft', 'published'].includes(draft.status) && <button className="btn ws-small-btn" onClick={review}><Send size={15}/>{wt('sendReview', locale)}</button>}{draft.status === 'review' && canReview && !changes && <button className="btn ws-small-btn" onClick={approve}><ShieldCheck size={16}/>{wt('approve', locale)}</button>}{draft.status === 'approved' && canPublish && <button className="btn btn-primary ws-small-btn" onClick={publish}><Check size={16}/>{wt('publish', locale)}</button>}</div></div>
    {newPage && <Modal title={wt('create', locale)} onClose={() => {if(!pending.current)setNewPage(false);}}><form className="ws-edit-form" onSubmit={createPage}><Field label={wt('title', locale)}><input className="input" disabled={busy||store.pending} required value={name} onChange={e => setName(e.target.value)}/></Field><Field label={wt('slug', locale)}><input className="input" disabled={busy||store.pending} dir="ltr" required pattern="[a-z0-9-]+" value={slug} onChange={e => setSlug(e.target.value.toLowerCase())}/></Field><button className="btn btn-primary" type="submit" disabled={busy||store.pending}><Plus size={16}/>{wt('create', locale)}</button></form></Modal>}
    {showDiff && <Modal title={localized(L('مقایسه نسخه‌ها','Compare revisions','Sürümleri karşılaştır','مقارنة الإصدارات','Сравнить версии'), locale)} onClose={() => setShowDiff(false)} wide>{persisted&&!demoMode&&<RevisionHistory store={store} bucket="pages" id={draft.id} locale={draft.locale} canRestore={false} expanded/>}{changes&&<><h3>{localized(L('نسخهٔ ذخیره‌شده و پیش‌نویس من','Saved version and my draft','Kayıtlı sürüm ve taslağım','الإصدار المحفوظ ومسودتي','Сохранённая версия и мой черновик'),locale)}</h3><RevisionDiff before={persisted?{title:persisted.title,summary:persisted.summary,blocks:persisted.blocks}:null} after={{title:draft.title,summary:draft.summary,blocks:draft.blocks}} locale={locale}/></>}</Modal>}
  </div>;
}

export function BlockPreview({ block, locale, formSchema, catalog=officialProducts, galleryScope='' }: { block: PageBlock; locale: WorkspaceLocale; formSchema?: PublicFormSchema; catalog?:Product[]; galleryScope?:string }) {
  const list = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(0);
  const [formValues, setFormValues] = useState<Record<string,string>>({});
  const [formSent, setFormSent] = useState(false);
  const publications = usePublications();
  const products=catalog;
  const carouselItems: { id: string; title: string; image?: string; href: string; meta: string }[] = block.type === 'catalog-carousel' ? resources.slice(0, 8).map(resource => ({ id: resource.id, title: localized(resource.title, locale), href: resource.url, meta: resource.format })) : block.type === 'news-carousel' ? publications.filter(publication => publication.kind === 'news' && publication.locale === locale).map(publication => ({ id: publication.id, title: publication.title, href: `/${locale}/page/?id=${encodeURIComponent(publication.id)}`, meta: wt('published', locale) })) : (block.options?.productIds!==undefined?block.options.productIds.flatMap(id=>{const match=products.find(product=>product.id===id);return match?[match]:[];}):products.slice(0,5)).map(product => ({ id: product.id, title: localized(product.name, locale), image: product.image, href: localizedPath(locale,productPath(product)), meta: product.brand }));
  const lines = block.body.split('\n').filter(Boolean);
  const title = block.title.trim() ? <h3>{block.title}</h3> : <div className="ws-block-empty-title" aria-hidden="true"/>;
  const body = ['rich-text','text'].includes(block.type)?<AiMarkdown text={block.body} locale={locale} content/>:<p>{block.body}</p>;
  const img = safeUrl(block.mediaUrl) ? <img src={block.mediaUrl} alt={block.title}/> : <div className="ws-image-placeholder"><ImageIcon size={34}/></div>;
  const primary=carouselUrl(block.link)?<a href={localizedPath(locale,block.link!)} className="btn btn-primary">{block.options?.ctaLabel??translate(locale,'learnMore')}<ArrowUp size={14}/></a>:null;
  const secondary=carouselUrl(block.options?.secondaryLink)?<a href={localizedPath(locale,block.options!.secondaryLink!)} className="btn">{block.options?.secondaryLabel??translate(locale,'learnMore')}</a>:null;
  const actions=<>{primary}{secondary}</>;
  if (block.type === 'divider') return <div className="ws-block-preview ws-block-divider"><hr/></div>;
  if (block.type === 'hero') return <div className="ws-block-preview ws-preview-hero"><div><span>IDEAL MAKOO</span>{title}{body}{actions}</div>{img}</div>;
  if (['product-carousel', 'product-grid', 'catalog-carousel', 'news-carousel'].includes(block.type)) return <div className="ws-block-preview"><div className="ws-flex-between">{title}<div className="ws-row-actions"><button disabled={carouselItems.length < 2} className="ws-icon-button" aria-label={wt('previous', locale)} onClick={() => list.current?.scrollBy({ left: -250, behavior: 'smooth' })}><ChevronLeft size={16}/></button><button disabled={carouselItems.length < 2} className="ws-icon-button" aria-label={wt('next', locale)} onClick={() => list.current?.scrollBy({ left: 250, behavior: 'smooth' })}><ChevronRight size={16}/></button></div></div>{body}<div className="ws-preview-products" ref={list}>{carouselItems.map(item => <a href={item.href} key={item.id}>{item.image ? <img src={item.image} alt={item.title}/> : <div className="ws-preview-document-icon"><FileText size={35}/></div>}<strong>{item.title}</strong><small>{item.meta}</small></a>)}</div>{!carouselItems.length && <p className="ws-muted">{wt('empty', locale)}</p>}</div>;
  if (block.type === 'split') return <div className="ws-block-preview ws-preview-split"><div>{title}{body}{actions}</div>{img}</div>;
  if (block.type === 'image') return <figure className="ws-block-preview ws-preview-image">{img}<figcaption>{block.title}</figcaption></figure>;
  if (block.type === 'gallery') return <div className="ws-block-preview">{title}<GalleryPreview key={JSON.stringify([galleryScope,block.id])} block={block}/></div>;
  if (block.type === 'video' || block.type === 'audio') return <div className="ws-block-preview">{title}{safeUrl(block.mediaUrl) ? block.type === 'video' ? <video controls preload="metadata" src={block.mediaUrl}/> : <audio controls preload="metadata" src={block.mediaUrl}/> : <div className="ws-media-preview-empty"><ImageIcon size={28}/><span>{wt('mediaUrl', locale)}</span></div>}{body}</div>;
  if(block.type==='faq'&&block.id.startsWith('faq-question-'))return <div className="ws-block-preview"><details><summary>{block.title}</summary><p>{block.body}</p></details></div>;
  if (block.type === 'faq') return <div className="ws-block-preview">{title}{(lines.length ? lines : [block.title]).map((line, i) => <details key={i}><summary>{line.split('|')[0]}</summary><p>{line.split('|')[1] || block.body || wt('description', locale)}</p></details>)}</div>;
  if (block.type === 'specifications') return <div className="ws-block-preview">{title}<table className="ws-preview-spec"><tbody>{(lines.length ? lines : [wt('title', locale) + '|' + wt('description', locale)]).map((line, i) => <tr key={i}><th>{line.split('|')[0]}</th><td>{line.split('|')[1] || '—'}</td></tr>)}</tbody></table></div>;
  if (block.type === 'cta' || block.type === 'notice') return <div className={`ws-block-preview ws-preview-callout ${block.type === 'notice' ? 'ws-preview-notice' : ''}`}>{title}{body}{actions}</div>;
  if (block.type === 'tabs') return <div className="ws-block-preview">{title}<div className="ws-locale-tabs" role="tablist">{(lines.length ? lines : [wt('description', locale), wt('product', locale)]).map((line, i) => <button role="tab" key={i} aria-selected={tab === i} onClick={() => setTab(i)}>{line.split('|')[0]}</button>)}</div><p>{lines[tab]?.split('|')[1] || block.body}</p></div>;
  if (block.type === 'form' && formSchema) return <div className="ws-block-preview">{title}{body}<form className="ws-preview-form" onSubmit={event => {event.preventDefault(); if (!validateFormValues(formSchema,formValues).errors.length) setFormSent(true);}}><h4>{formSchema.title[locale]} · v{formSchema.version}</h4>{formSchema.fields.filter(field => field.id in validateFormValues(formSchema,formValues).values).map(field => <Field key={field.id} label={field.label[locale] + (field.required ? ' *' : '')}>{field.type === 'textarea' ? <textarea className="input" required={field.required} value={formValues[field.id] || ''} onChange={event => setFormValues(previous => ({...previous,[field.id]:event.target.value}))}/> : field.type === 'select' ? <select className="input" required={field.required} value={formValues[field.id] || ''} onChange={event => setFormValues(previous => ({...previous,[field.id]:event.target.value}))}><option value="">—</option>{field.options?.map(option => <option key={option}>{option}</option>)}</select> : <input className="input" type={field.type} required={field.required} value={formValues[field.id] || ''} onChange={event => setFormValues(previous => ({...previous,[field.id]:event.target.value}))}/>}</Field>)}<button className="btn btn-primary">{wt('preview',locale)}</button><output aria-live="polite">{formSent ? localized(L('ورودی پیش‌نمایش معتبر است؛ در سایت منتشرشده، درخواست قابل پیگیری ثبت می‌شود.','Preview input is valid. The published page records a trackable request.','Önizleme girdisi geçerli. Yayınlanan sayfa izlenebilir bir talep kaydeder.','مدخلات المعاينة صالحة. تسجل الصفحة المنشورة طلباً قابلاً للتتبع.','Данные предпросмотра корректны. Опубликованная страница создаёт отслеживаемый запрос.'),locale) : ''}</output></form></div>;
  if (block.type === 'form') return <div className="ws-block-preview">{title}{body}<form className="ws-preview-form" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const value = Object.fromEntries(new FormData(form)); if(demoMode)localStorage.setItem(`idealmakoo.form-preview.${block.id}`, JSON.stringify(value)); const output = form.querySelector('output'); if (output) output.textContent = localized(L('ورودی پیش‌نمایش معتبر است؛ در این پیش‌نمایش درخواستی ارسال نمی‌شود.','Preview input is valid; this preview does not send a request.','Önizleme girdisi geçerli; bu önizleme talep göndermez.','مدخلات المعاينة صالحة؛ هذه المعاينة لا ترسل طلبًا.','Данные предпросмотра корректны; предпросмотр не отправляет запрос.'),locale); }}><input className="input" name="name" required aria-label={wt('title', locale)} placeholder={wt('title', locale)}/><input className="input" name="email" type="email" required aria-label={wt('email', locale)} placeholder={wt('email', locale)}/><textarea className="input" name="message" required aria-label={wt('description', locale)} placeholder={wt('description', locale)}/><button className="btn btn-primary">{wt('submit', locale)}</button><output/></form></div>;
  if (block.type === 'downloads') return <div className="ws-block-preview">{title}{body}{carouselUrl(block.link || block.mediaUrl) && <a className="btn" href={localizedPath(locale,(block.link || block.mediaUrl)!)} target="_blank" rel="noreferrer"><FileText size={16}/>{block.options?.ctaLabel??translate(locale,'download')}</a>}{secondary}</div>;
  if (['features', 'statistics', 'certificates', 'team', 'testimonials', 'partners', 'timeline'].includes(block.type)) return <div className="ws-block-preview">{title}<div className={`ws-preview-feature-list ${block.type === 'timeline' ? 'ws-preview-timeline' : ''}`}>{(lines.length ? lines : [block.title]).map((line, i) => <article key={i}><span>{String(i + 1).padStart(2, '0')}</span><h4>{line.split('|')[0]}</h4><p>{line.split('|')[1] || ''}</p></article>)}</div>{actions}</div>;
  if (block.type === 'contact' || block.type === 'map') return <div className="ws-block-preview ws-preview-contact">{title}{body}{actions}</div>;
  return <div className="ws-block-preview">{title}{body}{actions}</div>;
}
