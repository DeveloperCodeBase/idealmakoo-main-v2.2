'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Search,RefreshCw} from 'lucide-react';
import {apiClient,networkError} from '@/lib/api';
import type {Locale} from '@/lib/i18n';
import type {TenderBidSummary} from '@/types/tenders';
import {tenderText as tr,tenderTime,type TenderCopyKey} from './copy';
import styles from './tender.module.css';

export default function TenderBidList({endpoint,locale,selectedId,onSelect,refreshKey=0}:{endpoint:string;locale:Locale;selectedId?:string;onSelect:(id:string)=>void;refreshKey?:number}){
 const [search,setSearch]=useState(''),[applied,setApplied]=useState(''),[items,setItems]=useState<TenderBidSummary[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 const epoch=useRef(0);
 const load=useCallback(async(query:string,next:string|null=null)=>{const current=++epoch.current;setBusy(true);setError('');try{const parameters=new URLSearchParams({search:query,limit:'30'});if(next)parameters.set('cursor',next);const result=await apiClient.request<{items:TenderBidSummary[];nextCursor:string|null}>(`${endpoint}?${parameters}`);if(current!==epoch.current)return;setItems(previous=>next?[...previous,...result.items.filter(item=>!previous.some(value=>value.id===item.id))]:result.items);setCursor(result.nextCursor);setApplied(query);setLoaded(true);}catch(cause){if(current===epoch.current){setError(networkError(cause,locale));setLoaded(true);}}finally{if(current===epoch.current)setBusy(false);}},[endpoint,locale]);
 useEffect(()=>{void load('');return()=>{epoch.current++;};},[load,refreshKey]);
 const submit=(event:FormEvent)=>{event.preventDefault();void load(search.trim());};
 return <section className={styles.card}><h3>{tr(locale,'bids')}</h3><form className={styles.row} onSubmit={submit}><label className={styles.field}><span>{tr(locale,'search')}</span><input type="search" maxLength={120} value={search} disabled={busy} onChange={event=>setSearch(event.target.value)}/></label><button type="submit" className="btn" disabled={busy}><Search size={16}/>{tr(locale,'search')}</button><button type="button" className="btn" disabled={busy} onClick={()=>void load(applied)}><RefreshCw size={16}/>{tr(locale,'refresh')}</button></form>{error&&<p role="alert" className={styles.error}>{error}</p>}{!loaded&&<p role="status">{tr(locale,'loading')}</p>}<ul className={styles.list}>{items.map(item=><li key={item.id}><button type="button" className={styles.tab} aria-pressed={selectedId===item.id} onClick={()=>onSelect(item.id)}><strong>{item.title}</strong><span className={styles.badge}>{tr(locale,item.status as TenderCopyKey)}</span><bdi>{item.requestId}</bdi><span>{tr(locale,'revision')} {item.revisionNumber}</span>{item.participant&&<span>{[item.participant.name,item.participant.organization].filter(Boolean).join(' · ')}</span>}<time dateTime={item.submittedAt}>{tenderTime(item.submittedAt,locale,'UTC')} UTC</time></button></li>)}</ul>{loaded&&!items.length&&<p>{tr(locale,'empty')}</p>}{cursor&&<button type="button" className="btn" disabled={busy} onClick={()=>void load(applied,cursor)}>{tr(locale,'next')}</button>}</section>;
}
