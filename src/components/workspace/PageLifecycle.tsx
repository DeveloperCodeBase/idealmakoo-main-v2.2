'use client';
import {useEffect,useRef,useState} from 'react';
import {Archive,ArchiveRestore,Download,FolderOpen,RotateCcw,Trash2} from 'lucide-react';
import type {PageDraft} from '@/data/workspace-seed';
import type {ManagedWorkspacePage,PageDirectory,PageLifecycleAction,PageLifecycleStatus} from '@/types/page-lifecycle';
import {apiClient,ApiError,demoMode,networkError} from '@/lib/api';
import {refreshServerSite} from '@/lib/server-runtime';
import type {WorkspaceStore} from './store';
import {downloadFile} from './store';
import {localized,wt} from './i18n';
import {Field,Modal} from './ui';
import {pageLifecycleCopy as copy} from './page-lifecycle-copy';

export type PageLifecycleView=PageLifecycleStatus|'checking'|'missing'|'unavailable';
interface Props {store:WorkspaceStore;page:PageDraft;dirty:boolean;onAdopt:(page:PageDraft,status:PageLifecycleStatus)=>void;onStatus:(status:PageLifecycleView)=>void;onSelect?:(page:PageDraft,status:PageLifecycleStatus)=>void}
interface Choice {operation:PageLifecycleAction;page:PageDraft}
export default function PageLifecycle(props:Props){return demoMode?null:<LifecyclePanel key={`${props.store.actorId}:${props.store.role}:${props.page.id}`} {...props}/>;}

function LifecyclePanel(props:Props){
 const {store,page,dirty}=props,c=(key:keyof typeof copy)=>localized(copy[key],store.locale);
 const [item,setItem]=useState<ManagedWorkspacePage|null>(null),[view,setView]=useState<PageLifecycleView>('checking'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[choice,setChoice]=useState<Choice|null>(null),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[directory,setDirectory]=useState(false);
 const latest=useRef(props),alive=useRef(true),reading=useRef<AbortController|null>(null),requestNumber=useRef(0),mutating=useRef(false);latest.current=props;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;reading.current?.abort();};},[]);
 const adoptView=(value:PageLifecycleView)=>{setView(value);latest.current.onStatus(value);};
 async function load(explicit=false){
  reading.current?.abort();const controller=new AbortController();reading.current=controller;const sequence=++requestNumber.current;
  adoptView('checking');setError('');
  try{
   const result=await apiClient.request<{item:ManagedWorkspacePage;version:number}>(`/workspace/pages/${encodeURIComponent(page.id)}`,{signal:controller.signal});
   if(!alive.current||controller.signal.aborted||sequence!==requestNumber.current)return;
   if(result.item.page.id!==page.id)throw new Error('Page identity changed.');
   setItem(result.item);adoptView(result.item.status);
   // A background read only discovers a retained, non-editable source. It
   // must never replace a dirty editor. Explicit reload is a separate action.
   const current=latest.current;
   if(explicit||!current.dirty&&result.item.status!=='active'&&(current.page.updatedAt!==result.item.page.updatedAt||current.page.status!==result.item.page.status))current.onAdopt(result.item.page,result.item.status);
   return result.item;
  }catch(failure){
   if(!alive.current||controller.signal.aborted||sequence!==requestNumber.current)return;
   setItem(null);
   if(failure instanceof ApiError&&failure.status===404){adoptView('missing');return;}
   adoptView('unavailable');setError(networkError(failure,store.locale));
  }
 }
 // A version change can commit during an explicit reload. Its previous effect
 // must not abort the newer read stored in reading.current; load() replaces
 // old reads itself and the identity-keyed unmount effect cancels the last one.
 useEffect(()=>{if(!store.loaded||mutating.current)return;void load();},[store.loaded,store.version,page.id]);
 const savedMatches=!!item&&item.page.updatedAt===page.updatedAt&&item.page.version===page.version;
 const capturedMatches=!!choice&&!!item&&choice.page.updatedAt===item.page.updatedAt&&choice.page.version===item.page.version;
 const blocked=busy||store.pending||dirty||view==='checking';
 const choose=(operation:PageLifecycleAction)=>{if(blocked||!item||!savedMatches||!item.capabilities[operation])return;setChoice({operation,page:structuredClone(item.page)});setReason('');setConfirmed(false);setError('');};
 async function reload(){
  if(mutating.current)return;mutating.current=true;setBusy(true);adoptView('checking');
  try{await store.refresh();if(alive.current){await load(true);if(alive.current){setChoice(null);setConfirmed(false);}}}
  catch(failure){if(alive.current){adoptView('unavailable');setError(networkError(failure,store.locale));}}
  finally{mutating.current=false;if(alive.current)setBusy(false);}
 }
 async function commit(){
  if(!choice||!confirmed||reason.trim().length<8||reason.trim().length>500||blocked||!capturedMatches||!savedMatches||!item?.capabilities[choice.operation]||mutating.current)return;
  const selected=choice;mutating.current=true;setBusy(true);setError('');reading.current?.abort();adoptView('checking');
  try{
   const accepted=await store.command(`/workspace/pages/${encodeURIComponent(page.id)}/lifecycle`,{operation:selected.operation,reason:reason.trim(),expectedPageVersion:selected.page.version,expectedUpdatedAt:selected.page.updatedAt});
   if(!alive.current)return;
   if(!accepted){adoptView('unavailable');setError(c('failed'));return;}
   setChoice(null);setConfirmed(false);await load(true);await refreshServerSite();
  }catch(failure){if(alive.current){adoptView('unavailable');setError(networkError(failure,store.locale));}}
  finally{mutating.current=false;if(alive.current)setBusy(false);}
 }
 return <section className="ws-card ws-no-print" data-page-lifecycle data-page-id={page.id} data-page-state={view} style={{padding:16,marginBlock:16}}>
  <div className="ws-card-head"><h2 className="ws-page-lifecycle-heading"><Archive size={18}/> {c('title')}</h2><bdi>{page.locale.toUpperCase()} · v{page.version}</bdi></div>
  <p role="status">{view==='checking'?wt('loading',store.locale):c(view)}</p><p className="ws-muted">{c('localeHint')}</p>
  {dirty&&<p className="ws-inline-note">{c('dirty')}</p>}{item?.publication.requiresPublisher&&<p>{c('publisher')}</p>}
  {error&&<p role="alert" className="ws-storage-error">{error}</p>}
  {item&&!savedMatches&&!dirty&&view!=='checking'&&<p role="alert">{c('changed')}</p>}
  <div className="ws-row-actions" style={{flexWrap:'wrap'}}>
   {item?.capabilities.archive&&<button type="button" className="btn" disabled={blocked||!savedMatches} onClick={()=>choose('archive')}><Archive size={16}/>{c('archive')}</button>}
   {item?.capabilities.delete&&<button type="button" className="btn" disabled={blocked||!savedMatches} onClick={()=>choose('delete')}><Trash2 size={16}/>{c('delete')}</button>}
   {item?.capabilities.restore&&<button type="button" className="btn btn-primary" disabled={blocked||!savedMatches} onClick={()=>choose('restore')}><ArchiveRestore size={16}/>{c('restore')}</button>}
   {props.onSelect&&<button type="button" className="btn" disabled={busy||store.pending||dirty} onClick={()=>setDirectory(true)}><FolderOpen size={16}/>{c('directory')}</button>}
   <button type="button" className="btn" disabled={busy||store.pending} onClick={()=>void reload()}><RotateCcw size={16}/>{c(dirty?'discard':'reload')}</button>
   {dirty&&<button type="button" className="btn" onClick={()=>downloadFile(JSON.stringify(page,null,2),`idealmakoo-page-draft-${page.id}.json`)}><Download size={16}/>{c('export')}</button>}
  </div>
  {choice&&<Modal title={c(choice.operation)} onClose={()=>{if(!busy)setChoice(null);}}><div className="ws-edit-form"><p>{c((choice.operation+'Hint') as 'archiveHint'|'deleteHint'|'restoreHint')}</p><p><strong>{choice.page.title}</strong> · <bdi>{choice.page.locale.toUpperCase()} · v{choice.page.version}</bdi></p><Field label={c('reason')}><textarea className="input" rows={3} minLength={8} maxLength={500} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></Field><label className="ws-checkbox-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>{c('confirm')}</label>{(!capturedMatches||!savedMatches)&&<p role="alert">{c('changed')}</p>}{error&&<p role="alert">{error}</p>}<button type="button" className="btn btn-primary" disabled={blocked||!confirmed||reason.trim().length<8||!capturedMatches||!savedMatches} onClick={()=>void commit()}>{c(choice.operation)}</button></div></Modal>}
  {directory&&props.onSelect&&<RetainedPages store={store} locale={page.locale} onClose={()=>setDirectory(false)} onSelect={value=>{if(!latest.current.dirty&&!store.pending){props.onSelect?.(value.page,value.status);setDirectory(false);}}}/>}
 </section>;
}
function RetainedPages({store,locale,onClose,onSelect}:{store:WorkspaceStore;locale:PageDraft['locale'];onClose:()=>void;onSelect:(page:ManagedWorkspacePage)=>void}){
 const [status,setStatus]=useState<'archived'|'deleted'>('archived'),[cursor,setCursor]=useState<string|null>(null),[result,setResult]=useState<PageDirectory|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[reload,setReload]=useState(0),c=(key:keyof typeof copy)=>localized(copy[key],store.locale);
 useEffect(()=>{const controller=new AbortController();setBusy(true);setResult(null);setError('');const query=new URLSearchParams({locale,status,limit:'50',...(cursor?{cursor}:{})});void apiClient.request<PageDirectory>(`/workspace/pages?${query}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setResult(value);}).catch(failure=>{if(!controller.signal.aborted)setError(networkError(failure,store.locale));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();},[locale,status,cursor,reload,store.actorId,store.locale]);
 return <Modal title={c('directory')} onClose={onClose} wide><div className="ws-edit-form" data-page-recycle-bin><Field label={wt('status',store.locale)}><select className="input" value={status} onChange={event=>{setStatus(event.target.value as 'archived'|'deleted');setCursor(null);}}><option value="archived">{c('archivedTab')}</option><option value="deleted">{c('deletedTab')}</option></select></Field><p className="ws-muted">{c('localeHint')} <bdi>{locale.toUpperCase()}</bdi></p>{error&&<p role="alert">{error}</p>}{busy?<p role="status">{wt('loading',store.locale)}</p>:result?.items.length?result.items.map(value=><article className="ws-card" style={{padding:14}} key={value.page.id} data-retained-page-id={value.page.id}><strong>{value.page.title}</strong><p><bdi>{value.page.slug} · v{value.page.version}</bdi></p><button type="button" className="btn" onClick={()=>onSelect(value)}>{c('open')}</button></article>):<p>{wt('empty',store.locale)}</p>}<div className="ws-row-actions"><button type="button" className="btn" disabled={busy} onClick={()=>{setCursor(null);setReload(value=>value+1);}}>{c('refresh')}</button>{result?.nextCursor&&<button type="button" className="btn" disabled={busy} onClick={()=>setCursor(result.nextCursor)}>{c('next')}</button>}</div></div></Modal>;
}
