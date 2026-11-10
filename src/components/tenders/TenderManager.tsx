'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Plus,RefreshCw} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {apiClient,networkError} from '@/lib/api';
import type {FrontSession} from '@/lib/auth';
import type {ManagedTender,TenderBidView} from '@/types/tenders';
import TenderCallEditor from './TenderCallEditor';
import TenderReviewerPanel from './TenderReviewerPanel';
import TenderBidDetails from './TenderBidDetails';
import TenderBidList from './TenderBidList';
import {tenderText as tr,type TenderCopyKey} from './copy';
import styles from './tender.module.css';

export default function TenderManager({session,onChanged}:{session:FrontSession;onChanged?:()=>void|Promise<void>}){return <TenderManagerBody key={session.id} session={session} onChanged={onChanged}/>;}
function TenderManagerBody({session,onChanged}:{session:FrontSession;onChanged?:()=>void|Promise<void>}){
 const app=useApp(),locale=app.locale,[items,setItems]=useState<ManagedTender[]>([]),[canCreate,setCanCreate]=useState(false),[selected,setSelected]=useState<ManagedTender|null>(null),[creating,setCreating]=useState(false),[dirty,setDirty]=useState(false),[bid,setBid]=useState<TenderBidView|null>(null),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[refreshKey,setRefreshKey]=useState(0),alive=useRef(true),bidEpoch=useRef(0);
 const dirtyChanged=useCallback((value:boolean)=>setDirty(value),[]);
 const load=async()=>{setBusy(true);setError('');try{const result=await apiClient.request<{items:ManagedTender[];canCreate:boolean}>('/crm/tenders');if(alive.current){setItems(result.items);setCanCreate(result.canCreate);setLoaded(true);}}catch(cause){if(alive.current){setError(networkError(cause,locale));setLoaded(true);}}finally{if(alive.current)setBusy(false);}};
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;bidEpoch.current++;};},[session.id,locale]);
 const accept=async(next:ManagedTender)=>{if(!alive.current)return;setSelected(next);setCreating(false);setItems(previous=>[next,...previous.filter(item=>item.id!==next.id)]);await onChanged?.();};
 const select=async(id:string)=>{if(dirty||busy)return;setBid(null);bidEpoch.current++;setBusy(true);setError('');try{const next=await apiClient.request<ManagedTender>(`/crm/tenders/${id}`);if(alive.current){setSelected(next);setCreating(false);}}catch(cause){if(alive.current){setSelected(null);setError(networkError(cause,locale));}}finally{if(alive.current)setBusy(false);}};
 const selectBid=async(id:string)=>{const current=++bidEpoch.current;setBid(null);setBusy(true);setError('');try{const next=await apiClient.request<TenderBidView>(`/tender-bids/${id}`);if(alive.current&&current===bidEpoch.current)setBid(next);}catch(cause){if(alive.current&&current===bidEpoch.current)setError(networkError(cause,locale));}finally{if(alive.current&&current===bidEpoch.current)setBusy(false);}};
 return <section className={styles.root}><div className={styles.row}><h2>{tr(locale,'management')}</h2><button type="button" className="btn" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/>{tr(locale,'refresh')}</button>{canCreate&&<button type="button" className="btn btn-primary" disabled={busy||dirty} onClick={()=>{setSelected(null);setCreating(true);setBid(null);}}><Plus size={16}/>{tr(locale,'create')}</button>}</div><p className={styles.notice}>{tr(locale,'sealing')}</p>{error&&<p className={styles.error} role="alert">{error}</p>}{!loaded&&<p role="status">{tr(locale,'loading')}</p>}<div className={styles.tabs}>{items.map(item=><button type="button" key={item.id} className={styles.tab} disabled={busy||dirty} aria-pressed={selected?.id===item.id} onClick={()=>void select(item.id)}><strong>{item.definition.title[locale]}</strong><span className={styles.badge}>{tr(locale,item.status as TenderCopyKey)}</span></button>)}</div>{loaded&&!items.length&&!creating&&<p>{tr(locale,'empty')}</p>}
 {(selected||creating)&&<TenderCallEditor key={selected?`${selected.id}:${selected.revisionId}`:'create'} value={selected} session={session} locale={locale} canCreate={canCreate} onChanged={accept} onDirty={dirtyChanged} onCancel={()=>{setCreating(false);setSelected(null);setBid(null);setDirty(false);}}/>}
 {selected?.capabilities.manageReviewers&&selected.status!=='cancelled'&&<TenderReviewerPanel key={`${selected.id}:${selected.version}`} callId={selected.id} locale={locale} onChanged={async()=>{const next=await apiClient.request<ManagedTender>(`/crm/tenders/${selected.id}`);await accept(next);}}/>}
 {selected&&<TenderBidList key={selected.id} endpoint={`/crm/tenders/${selected.id}/bids`} locale={locale} selectedId={bid?.id} refreshKey={refreshKey} onSelect={id=>void selectBid(id)}/>}
 {bid&&<TenderBidDetails key={bid.id} value={bid} onChanged={next=>{setBid(next);setRefreshKey(previous=>previous+1);}}/>}
 </section>;
}
