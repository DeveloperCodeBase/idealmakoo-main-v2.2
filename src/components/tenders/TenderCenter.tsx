'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {LockKeyhole,RefreshCw} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {apiClient,networkError} from '@/lib/api';
import type {PublicTender,TenderBidView} from '@/types/tenders';
import TenderComposer from './TenderComposer';
import TenderBidDetails from './TenderBidDetails';
import TenderBidList from './TenderBidList';
import {tenderText as tr,tenderTime,type TenderCopyKey} from './copy';
import styles from './tender.module.css';

export default function TenderCenter({mode='public'}:{mode?:'public'|'own'}){const app=useApp();if(!app.sessionReady)return <p role="status">{tr(app.locale,'loading')}</p>;return <TenderCenterBody key={`${mode}:${app.locale}:${app.session?.id||'guest'}:${app.session?.role||'guest'}`} mode={mode}/>;}
function TenderCenterBody({mode}:{mode:'public'|'own'}){
 const app=useApp(),locale=app.locale,[calls,setCalls]=useState<PublicTender[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[compose,setCompose]=useState<PublicTender|null>(null),[selected,setSelected]=useState<TenderBidView|null>(null),[refreshKey,setRefreshKey]=useState(0);
 const alive=useRef(true),detailEpoch=useRef(0),customer=app.session?.role==='customer';
 const loadCalls=async()=>{setBusy(true);setError('');try{const result=await apiClient.request<{items:PublicTender[]}>(`/tenders?locale=${locale}`);if(alive.current){setCalls(result.items);setLoaded(true);}}catch(cause){if(alive.current){setError(networkError(cause,locale));setLoaded(true);}}finally{if(alive.current)setBusy(false);}};
 useEffect(()=>{alive.current=true;if(mode==='public')void loadCalls();return()=>{alive.current=false;detailEpoch.current++;};},[locale,mode]);
 const select=async(id:string)=>{const current=++detailEpoch.current;setSelected(null);setCompose(null);setBusy(true);setError('');try{const result=await apiClient.request<TenderBidView>(`/tender-bids/${id}`);if(alive.current&&current===detailEpoch.current)setSelected(result);}catch(cause){if(alive.current&&current===detailEpoch.current)setError(networkError(cause,locale));}finally{if(alive.current&&current===detailEpoch.current)setBusy(false);}};
 const accept=(value:TenderBidView)=>{if(!alive.current)return;setCompose(null);setSelected(value);setRefreshKey(previous=>previous+1);};
 return <section className={styles.root}><div className={styles.row}><h2><LockKeyhole size={24}/> {tr(locale,mode==='own'?'myBids':'title')}</h2>{mode==='public'&&<button type="button" className="btn" disabled={busy} onClick={()=>void loadCalls()}><RefreshCw size={16}/>{tr(locale,'refresh')}</button>}</div><p className={styles.notice}>{tr(locale,'sealing')}</p>{error&&<p className={styles.error} role="alert">{error}</p>}
 {mode==='public'&&<><h3>{tr(locale,'openCalls')}</h3>{!loaded&&<p role="status">{tr(locale,'loading')}</p>}<div className={styles.grid}>{calls.map(call=><article key={call.id} className={styles.card}><h3>{call.title}</h3><span className={styles.badge}>{tr(locale,call.status as TenderCopyKey)}</span><p className={styles.text}>{call.summary}</p><dl className={styles.details}><dt>{tr(locale,'opens')}</dt><dd>{tenderTime(call.opensAt,locale,call.timezone)}</dd><dt>{tr(locale,'deadline')}</dt><dd>{tenderTime(call.deadlineAt,locale,call.timezone)}</dd><dt>{tr(locale,'timezone')}</dt><dd><bdi>{call.timezone}</bdi></dd></dl>{call.canSubmit&&app.sessionReady&&(customer?(app.session?.emailVerified?<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>{setSelected(null);setCompose(call);}}>{tr(locale,'apply')}</button>:<Link className="btn" href={app.href('account/security')}>{tr(locale,'verify')}</Link>):<Link className="btn" href={app.href('auth/login')}>{tr(locale,'signIn')}</Link>)}</article>)}</div>{loaded&&!calls.length&&<p>{tr(locale,'empty')}</p>}</>}
 {!app.sessionReady&&mode==='own'&&<p role="status">{tr(locale,'loading')}</p>}{app.sessionReady&&mode==='own'&&!customer&&<Link className="btn" href={app.href('auth/login')}>{tr(locale,'signIn')}</Link>}
 {compose&&customer&&<TenderComposer key={`${compose.id}:${app.session?.id}`} call={compose} onCancel={()=>setCompose(null)} onSaved={accept}/>}
 {customer&&app.sessionReady&&<TenderBidList key={app.session!.id} endpoint="/me/tender-bids" locale={locale} selectedId={selected?.id} onSelect={id=>void select(id)} refreshKey={refreshKey}/>}
 {selected&&customer&&<TenderBidDetails key={selected.id} value={selected} onChanged={accept}/>}
 </section>;
}
