'use client';
import {useState,type ChangeEvent} from 'react';
import {RefreshCw,Upload} from 'lucide-react';
import {apiClient,networkError} from '@/lib/api';
import type {Locale} from '@/lib/i18n';
import type {TenderPrivateAsset} from '@/types/tenders';
import {tenderText as tr} from './copy';
import styles from './tender.module.css';

const documentTypes=['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
export function cleanTenderAsset(asset:TenderPrivateAsset|undefined){return!!asset&&asset.visibility==='private'&&asset.scanStatus==='clean'&&documentTypes.includes(asset.mimeType);}
export default function TenderDocuments({locale,assets,selected,excluded,disabled,onChange,onRefresh,onUploaded,onBusy}:{locale:Locale;assets:TenderPrivateAsset[];selected:string[];excluded:string[];disabled:boolean;onChange:(ids:string[])=>void;onRefresh:()=>Promise<void>;onUploaded:(asset:TenderPrivateAsset)=>void;onBusy:(busy:boolean)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const upload=async(event:ChangeEvent<HTMLInputElement>)=>{const file=event.target.files?.[0];event.target.value='';if(!file||busy)return;setBusy(true);onBusy(true);setError('');try{const body=new FormData();body.set('file',file);const asset=await apiClient.request<TenderPrivateAsset>('/attachments',{method:'POST',body});onUploaded(asset);if(selected.length<5)onChange([...selected,asset.id]);await onRefresh();}catch(cause){setError(networkError(cause,locale));}finally{setBusy(false);onBusy(false);}};
 const eligible=assets.filter(asset=>asset.visibility==='private'&&documentTypes.includes(asset.mimeType));
 return <div><p className={styles.muted}>{tr(locale,'fileNote')}</p><label className={styles.field}><span>{tr(locale,'upload')}</span><input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={disabled||busy||selected.length>=5} onChange={event=>void upload(event)}/></label><div className={styles.actions}><button type="button" className="btn" disabled={disabled||busy} onClick={()=>void onRefresh().catch(cause=>setError(networkError(cause,locale)))}><RefreshCw size={16}/>{tr(locale,'refresh')}</button>{busy&&<span role="status"><Upload size={16}/> {tr(locale,'loading')}</span>}</div>
 <ul className={styles.list}>{eligible.map(asset=>{const checked=selected.includes(asset.id),clean=cleanTenderAsset(asset);return <li key={asset.id}><label className={styles.check}><input type="checkbox" disabled={disabled||busy||excluded.includes(asset.id)||!checked&&(!clean||selected.length>=5)} checked={checked} onChange={event=>onChange(event.target.checked?[...selected,asset.id]:selected.filter(id=>id!==asset.id))}/><span>{asset.name||asset.filename||asset.id}<small className={styles.muted}> · {(asset.bytes/1024).toFixed(1)} KB · {tr(locale,clean?'clean':asset.scanStatus==='pending'?'pendingScan':'blocked')}</small></span></label></li>;})}{selected.filter(id=>!eligible.some(asset=>asset.id===id)).map(id=><li key={id}><label className={styles.check}><input type="checkbox" checked disabled={disabled||busy} onChange={()=>onChange(selected.filter(value=>value!==id))}/><bdi>{id}</bdi> · {tr(locale,'blocked')}</label></li>)}</ul>{eligible.length===0&&<p>{tr(locale,'empty')}</p>}{error&&<p className={styles.error} role="alert">{error}</p>}</div>;
}
