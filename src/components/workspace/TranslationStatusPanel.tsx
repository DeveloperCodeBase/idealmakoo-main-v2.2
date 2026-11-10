'use client';
import {useEffect,useRef,useState} from 'react';
import {Check,GitCompareArrows,Languages} from 'lucide-react';
import {apiClient,demoMode,networkError} from '@/lib/api';
import type {EditorRevisionDetail,TranslationStatus} from '@/types/editor-workflows';
import type {WorkspaceStore} from './store';
import {downloadFile} from './store';
import {localized,workspaceLocales,wt,type WorkspaceLocale} from './i18n';
import {Field,safeDate} from './ui';
import RevisionDiff from './RevisionDiff';
import {editorWorkflowCopy as copy} from './editor-workflow-copy';
interface Props {store:WorkspaceStore;bucket:'records'|'pages';id:string;locale:WorkspaceLocale;capturedUpdatedAt:string;dirty:boolean;editable:boolean;sourceLocale?:WorkspaceLocale;onSourceLocaleChange?:(value:WorkspaceLocale)=>void}
const native={fa:'فارسی',en:'English',tr:'Türkçe',ar:'العربية',ru:'Русский'};
export default function TranslationStatusPanel(props:Props){return demoMode?null:<TranslationStatusEditor key={`${props.store.actorId}:${props.store.role}:${props.bucket}:${props.id}:${props.locale}`} {...props}/>;}
function TranslationStatusEditor({store,bucket,id,locale,capturedUpdatedAt,dirty,editable,sourceLocale,onSourceLocaleChange}:Props){
 const [selected,setSelected]=useState<WorkspaceLocale>(sourceLocale&&sourceLocale!==locale?sourceLocale:locale==='fa'?'en':'fa'),[status,setStatus]=useState<TranslationStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[compare,setCompare]=useState(false),[snapshots,setSnapshots]=useState<[EditorRevisionDetail,EditorRevisionDetail]|null>(null),[loadingDiff,setLoadingDiff]=useState(false);
 const source=sourceLocale&&sourceLocale!==locale?sourceLocale:selected,c=(key:keyof typeof copy)=>localized(copy[key],store.locale),alive=useRef(true),pending=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);setError('');setConfirmed(false);setStatus(null);
  const query=new URLSearchParams({bucket,id,locale,sourceLocale:source});
  void apiClient.request<TranslationStatus>(`/workspace/translations?${query}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setStatus(value);}).catch(reason=>{if(!controller.signal.aborted)setError(networkError(reason,store.locale));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[bucket,id,locale,source,store.version,store.actorId,store.locale]);
 useEffect(()=>{
  setSnapshots(null);if(!compare||!status?.acknowledgement||!status.source||status.acknowledgement.sourceRevisionId===status.source.revisionId){setLoadingDiff(false);return;}
  const controller=new AbortController(),ids=[status.acknowledgement.sourceRevisionId,status.source.revisionId];setLoadingDiff(true);
  void Promise.all(ids.map(revision=>apiClient.request<EditorRevisionDetail>(`/workspace/revisions/${revision}`,{signal:controller.signal}))).then(result=>{if(controller.signal.aborted)return;if(result.some((item,index)=>item.bucket!==bucket||item.revision.document_id!==status.source!.documentId||item.revision.locale!==source||item.revision.id!==ids[index]))throw new Error('Saved source revision identity changed.');setSnapshots([result[0],result[1]]);}).catch(reason=>{if(!controller.signal.aborted)setError(networkError(reason,store.locale));}).finally(()=>{if(!controller.signal.aborted)setLoadingDiff(false);});return()=>controller.abort();
 },[compare,status,bucket,source,store.locale]);
 const acknowledge=async()=>{
  if(pending.current||busy||store.pending||dirty||!editable||!confirmed||!status?.canAcknowledge||!status.source||!status.target||status.target.updatedAt!==capturedUpdatedAt)return false;
  const comparison=status;pending.current=true;setBusy(true);setError('');
  try{const accepted=await store.command('/workspace/translations/acknowledge',{bucket,id,locale,sourceLocale:source,sourceRevisionId:comparison.source!.revisionId,targetRevisionId:comparison.target!.revisionId,expectedUpdatedAt:capturedUpdatedAt});if(alive.current&&accepted)setConfirmed(false);return accepted;}finally{pending.current=false;if(alive.current)setBusy(false);}
 };
 const allowed=!!status?.canAcknowledge&&status.target?.updatedAt===capturedUpdatedAt&&!dirty&&editable;
 return <section className="ws-card ws-no-print" data-translation-status={status?.status||'loading'} style={{padding:16,marginBlock:18}}><h3><Languages size={18}/> {c('translation')}</h3><Field label={c('sourceLocale')}><select className="input" value={source} disabled={busy||pending.current} onChange={event=>{const lang=event.target.value as WorkspaceLocale;setSelected(lang);onSourceLocaleChange?.(lang);setCompare(false);}}>{workspaceLocales.filter(lang=>lang!==locale).map(lang=><option key={lang} value={lang}>{native[lang]}</option>)}</select></Field><p className="ws-muted">{c('acknowledgementHint')}</p>{error&&<p role="alert" className="ws-storage-error">{error}</p>}{busy&&!status?<p role="status">{wt('loading',store.locale)}</p>:status&&<><p role="status"><strong>{c(status.status)}</strong></p><div className="ws-form-grid">{(['source','target'] as const).map(kind=>{const value=status[kind];return <div key={kind}><strong>{wt(kind==='source'?'sourceText':'targetText',store.locale)} · {native[kind==='source'?source:locale]}</strong>{value?<p>{value.title} · {wt('revision',store.locale)} <bdi>{value.revisionNumber}</bdi><br/><time>{safeDate(value.updatedAt,store.locale,{dateStyle:'medium',timeStyle:'short'})}</time></p>:<p>—</p>}</div>;})}</div>{status.acknowledgement&&<p className="ws-muted"><time>{safeDate(status.acknowledgement.acknowledgedAt,store.locale,{dateStyle:'medium',timeStyle:'short'})}</time> · <bdi>{status.acknowledgement.id}</bdi></p>}{status.source&&status.acknowledgement&&status.source.revisionId!==status.acknowledgement.sourceRevisionId&&<button className="btn ws-small-btn" aria-expanded={compare} onClick={()=>setCompare(value=>!value)}><GitCompareArrows size={16}/>{c('sourceChanges')}</button>}{compare&&(loadingDiff?<p role="status">{wt('loading',store.locale)}</p>:snapshots&&<><RevisionDiff before={snapshots[0].snapshot} after={snapshots[1].snapshot} locale={store.locale}/><button className="btn ws-small-btn" onClick={()=>downloadFile(JSON.stringify({before:snapshots[0],after:snapshots[1]},null,2),`idealmakoo-source-revisions-${id}-${source}.json`)}>{wt('exportJson',store.locale)}</button></>)}{dirty&&<p role="status">{wt('saveDraft',store.locale)}</p>}<label className="ws-checkbox-label"><input type="checkbox" checked={confirmed} disabled={!allowed||busy||store.pending} onChange={event=>setConfirmed(event.target.checked)}/>{c('explicitConfirm')}</label><button className="btn" disabled={!allowed||!confirmed||busy||store.pending} onClick={()=>void acknowledge()}><Check size={16}/>{c('acknowledge')}</button></>}</section>;
}
