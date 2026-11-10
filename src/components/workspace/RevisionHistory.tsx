'use client';
import {useEffect,useRef,useState} from 'react';
import {Download,History,RotateCcw,ShieldCheck} from 'lucide-react';
import {apiClient,demoMode,networkError} from '@/lib/api';
import type {EditorRevision,EditorRevisionBucket,EditorRevisionDetail} from '@/types/editor-workflows';
import type {WorkspaceStore} from './store';
import {downloadFile} from './store';
import {localized,wt} from './i18n';
import {Field,Modal,safeDate} from './ui';
import RevisionDiff from './RevisionDiff';
import {editorWorkflowCopy as copy} from './editor-workflow-copy';

interface Props {store:WorkspaceStore;bucket:EditorRevisionBucket;id:string;locale:string;canRestore:boolean;expectedFormVersion?:number;onRestored?:()=>void;expanded?:boolean}
interface RestoreChoice {revision:EditorRevision;updatedAt:string;formVersion?:number}
export default function RevisionHistory(props:Props){return demoMode?null:<HistoryPanel key={`${props.store.actorId}:${props.store.role}:${props.bucket}:${props.id}:${props.locale}`} {...props}/>;}
function HistoryPanel({store,bucket,id,locale,canRestore,expectedFormVersion,onRestored,expanded=false}:Props){
 const [open,setOpen]=useState(expanded),[rows,setRows]=useState<EditorRevision[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[beforeId,setBeforeId]=useState(''),[afterId,setAfterId]=useState(''),[snapshots,setSnapshots]=useState<[EditorRevisionDetail,EditorRevisionDetail]|null>(null),[comparing,setComparing]=useState(false),[restoreChoice,setRestoreChoice]=useState<RestoreChoice|null>(null),[confirmed,setConfirmed]=useState(false),[restoring,setRestoring]=useState(false);
 const alive=useRef(true),pending=useRef(false),c=(key:keyof typeof copy)=>localized(copy[key],store.locale);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(expanded)setOpen(true);},[expanded]);
 useEffect(()=>{
  if(!open)return;const controller=new AbortController();setBusy(true);setError('');
  const path=bucket==='forms'?`/workspace/forms/${encodeURIComponent(id)}/revisions?locale=${locale}`:`/workspace/revisions?bucket=${bucket}&id=${encodeURIComponent(id)}&locale=${locale}`;
  void apiClient.request<{revisions:EditorRevision[]}>(path,{signal:controller.signal}).then(result=>{if(controller.signal.aborted)return;setRows(result.revisions);setBeforeId(previous=>previous||result.revisions[1]?.id||'');setAfterId(previous=>previous||result.revisions[0]?.id||'');}).catch(reason=>{if(!controller.signal.aborted)setError(networkError(reason,store.locale));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[open,bucket,id,locale,store.version,store.actorId,store.locale]);
 useEffect(()=>{
  setSnapshots(null);if(!open||!beforeId||!afterId||beforeId===afterId){setComparing(false);return;}
  const controller=new AbortController();setComparing(true);setError('');
  void Promise.all([beforeId,afterId].map(revisionId=>apiClient.request<EditorRevisionDetail>(`/workspace/revisions/${revisionId}`,{signal:controller.signal}))).then(result=>{
   if(controller.signal.aborted)return;
   if(result.some((item,index)=>item.bucket!==bucket||item.revision.document_id!==id||item.revision.locale!==locale||item.revision.id!==[beforeId,afterId][index]))throw new Error('Saved revision identity changed.');
   setSnapshots([result[0],result[1]]);
  }).catch(reason=>{if(!controller.signal.aborted)setError(networkError(reason,store.locale));}).finally(()=>{if(!controller.signal.aborted)setComparing(false);});
  return()=>controller.abort();
 },[open,beforeId,afterId,bucket,id,locale,store.actorId,store.locale]);
 const selectRestore=(revision:EditorRevision)=>{
  if(!canRestore||store.pending)return;const source=store.getState()[bucket].find(row=>row.id===id);
  if(!source?.updatedAt||bucket==='forms'&&expectedFormVersion===undefined){setError(c('conflict'));return;}
  setRestoreChoice({revision,updatedAt:source.updatedAt,...(bucket==='forms'?{formVersion:expectedFormVersion}:{})});setConfirmed(false);
 };
 const restore=async()=>{
  if(!restoreChoice||!confirmed||!canRestore||store.pending||pending.current)return;
  const captured=restoreChoice,current=store.getState()[bucket].find(row=>row.id===id);
  if(!current||current.updatedAt!==captured.updatedAt||bucket==='forms'&&('version'in current?current.version:undefined)!==captured.formVersion){setError(c('conflict'));return;}
  pending.current=true;setRestoring(true);setError('');
  try{
   const accepted=bucket==='forms'?await store.command(`/workspace/forms/${encodeURIComponent(id)}/restore`,{revisionId:captured.revision.id,expectedFormVersion:captured.formVersion}):await store.restoreRevision(captured.revision.id,captured.updatedAt);
   if(accepted&&alive.current){setRestoreChoice(null);setConfirmed(false);onRestored?.();}
  }finally{pending.current=false;if(alive.current)setRestoring(false);}
 };
 const exportComparison=()=>{if(snapshots)downloadFile(JSON.stringify({before:snapshots[0],after:snapshots[1]},null,2),`idealmakoo-revisions-${id}-${locale}.json`);};
 return <details className="ws-card ws-no-print" data-revision-history style={{padding:16,marginBlock:18}} open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary style={{cursor:'pointer',display:'flex',gap:8,alignItems:'center'}}><History size={18}/>{wt('history',store.locale)} · <bdi>{locale.toUpperCase()}</bdi></summary>{open&&<div><p className="ws-muted">{c(bucket==='forms'?'restoreSchema':'restoreDraft')}</p>{error&&<p role="alert" className="ws-storage-error">{error}</p>}{busy&&<p role="status">{wt('loading',store.locale)}</p>}<h4>{c('compare')}</h4><div className="ws-form-grid">{([['before',beforeId,setBeforeId],['after',afterId,setAfterId]] as const).map(([side,value,setValue])=><Field key={side} label={c(side==='before'?'earlier':'later')}><select className="input" value={value} onChange={event=>setValue(event.target.value)}><option value="">—</option>{value&&!rows.some(row=>row.id===value)&&<option value={value}>{value}</option>}{rows.map(row=><option key={row.id} value={row.id}>{wt('revision',store.locale)} {row.revision_number} · {safeDate(row.created_at,store.locale,{dateStyle:'short',timeStyle:'short'})}</option>)}</select></Field>)}</div>{!beforeId||!afterId||beforeId===afterId?<p>{c('selectTwo')}</p>:comparing?<p role="status">{wt('loading',store.locale)}</p>:snapshots&&<><RevisionDiff before={snapshots[0].snapshot} after={snapshots[1].snapshot} locale={store.locale}/><button className="btn ws-small-btn" onClick={exportComparison}><Download size={15}/>{wt('exportJson',store.locale)}</button></>}
 {rows.map(row=><div key={row.id} data-revision-id={row.id} className="ws-flex-between" style={{gap:12,paddingBlock:10,borderBottom:'1px solid var(--border)'}}><div><strong>{wt('revision',store.locale)} <bdi>{row.revision_number}</bdi></strong><small style={{display:'block'}}>{safeDate(row.created_at,store.locale,{dateStyle:'medium',timeStyle:'short'})}{row.approved_by&&<> · <ShieldCheck size={12}/>{wt('approved',store.locale)}</>}</small><code title={row.checksum} style={{fontSize:10}}>{row.checksum.slice(0,20)}…</code></div>{canRestore&&<button className="btn ws-small-btn" disabled={busy||store.pending||restoring} onClick={()=>selectRestore(row)}><RotateCcw size={14}/>{wt('restore',store.locale)}</button>}</div>)}{!busy&&!rows.length&&<p>{wt('empty',store.locale)}</p>}</div>}
 {restoreChoice&&<Modal title={wt('restore',store.locale)} onClose={()=>{if(!restoring)setRestoreChoice(null);}}><div className="ws-edit-form"><p>{c(bucket==='forms'?'restoreSchema':'restoreDraft')}</p><p>{wt('revision',store.locale)} <bdi>{restoreChoice.revision.revision_number}</bdi> · {safeDate(restoreChoice.revision.created_at,store.locale,{dateStyle:'medium',timeStyle:'short'})}</p><label className="ws-checkbox-label"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={restoring}/>{c('explicitConfirm')}</label>{error&&<p role="alert">{error}</p>}<button className="btn btn-primary" disabled={!confirmed||!canRestore||restoring||store.pending} onClick={()=>void restore()}><RotateCcw size={16}/>{wt('restore',store.locale)}</button></div></Modal>}
 </details>;
}
