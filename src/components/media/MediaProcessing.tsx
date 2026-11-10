'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {RefreshCw} from 'lucide-react';
import type {ContentLocale} from '@/data/catalog';
import type {WorkspaceStore} from '@/components/workspace/store';
import type {MediaProcessingJob,MediaProcessingList} from '@/types/dam';
import type {VideoProfile} from '@/types/media-processing';
import {readyMediaOutput} from '@/lib/dam-client';
import {c,contentLocale,uiLocales} from '@/components/controlled/copy';
import {useControlledApi} from '@/components/controlled/useControlledApi';
import styles from '@/components/controlled/controlled.module.css';
import AuthorizedMediaPreview from './MediaTransport';
import {mt} from './media-copy';

export default function MediaProcessing({store,sourceAssetId,onSelectSource,onRegister}:{store:WorkspaceStore;sourceAssetId?:string;onSelectSource?:(id:string)=>void;onRegister?:(id:string)=>Promise<void>}){
 return <Processing key={`${store.actorId}:${store.role}:${store.locale}:${JSON.stringify(store.actor)}:${sourceAssetId||'all'}`} store={store} sourceAssetId={sourceAssetId} onSelectSource={onSelectSource} onRegister={onRegister}/>;
}
function Processing({store,sourceAssetId,onSelectSource,onRegister}:{store:WorkspaceStore;sourceAssetId?:string;onSelectSource?:(id:string)=>void;onRegister?:(id:string)=>Promise<void>}){
 const {locale}=store,api=useControlledApi(locale),[data,setData]=useState<MediaProcessingList|null>(null),[selected,setSelected]=useState<MediaProcessingJob|null>(null),[notice,setNotice]=useState(''),readSequence=useRef(0);
 const load=useCallback(async()=>{const sequence=++readSequence.current;const value=await api.request<MediaProcessingList>('/media/processing?limit=100'+(sourceAssetId?'&sourceAssetId='+encodeURIComponent(sourceAssetId):''));if(sequence===readSequence.current)setData(value);},[api.request,sourceAssetId]);
 const active=data?.items.some(item=>['pending','running','scanning'].includes(item.state))??false;
 useEffect(()=>{void load().catch(api.fail);const timer=setInterval(()=>{if(document.visibilityState==='visible')void load().catch(api.fail);},active?5000:30000);const focus=()=>void load().catch(api.fail);window.addEventListener('focus',focus);return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};},[load,active,api.fail]);
 const created=async(value:{job:MediaProcessingJob;duplicate:boolean})=>{setSelected(value.job);setNotice(mt(locale,value.duplicate?'duplicate':'queued'));await load();};
 const changed=async(job:MediaProcessingJob)=>{setSelected(job);await load();};
 const fresh=selected&&data?.items.find(item=>item.id===selected.id);
 return <section className={styles.card} data-media-processing>
  <header className={styles.header}><h3>{mt(locale,'processing')}</h3><button type="button" className="btn" disabled={api.busy} onClick={()=>void api.run(load)}><RefreshCw size={16}/>{c(locale,'refresh')}</button></header><p className={styles.muted}>{mt(locale,'processingHint')}</p>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}{notice&&<p className={styles.notice} role="status">{notice}</p>}{!data&&!api.error&&<p role="status">{c(locale,'loading')}</p>}
  {data&&<>
   {!data.capabilities.enabled&&<p className={styles.notice}>{mt(locale,'disabled')}</p>}{!data.capabilities.engineAvailable&&<p className={styles.notice}>{mt(locale,'engineMissing')}</p>}
   {data.source&&!data.source.eligible&&<p className={styles.notice}>{mt(locale,'sourceBlocked')} <code>{data.source.reason}</code> · {mt(locale,data.source.scanStatus)}</p>}
   <details><summary>{mt(locale,'limits')}</summary><div className={styles.grid}><p>{mt(locale,'input')}: {data.capabilities.limits.inputBytes/1048576} MiB · {mt(locale,'output')}: {data.capabilities.limits.outputBytes/1048576} MiB</p><p>{mt(locale,'duration')}: {data.capabilities.limits.durationSeconds} · {mt(locale,'fps')}: {data.capabilities.limits.framesPerSecond}</p><p dir="ltr">{data.capabilities.limits.maximumWidth} × {data.capabilities.limits.maximumHeight} px</p><p>{mt(locale,'timeout')}: {data.capabilities.limits.timeoutSeconds}</p><p>VTT: {data.capabilities.limits.subtitleBytes/1024} KiB · {data.capabilities.limits.subtitleCues}</p></div></details>
   {sourceAssetId&&data.source?<ProcessingForm key={sourceAssetId} sourceAssetId={sourceAssetId} locale={locale} data={data} onCreated={created}/>:<p className={styles.muted}>{mt(locale,'selectVideo')}</p>}
   <div className={styles.grid}>{data.items.map(job=><button type="button" key={job.id} className={styles.choice} aria-pressed={selected?.id===job.id} onClick={()=>setSelected(job)}><strong className={styles.break}>{job.name}</strong><span>{mt(locale,job.kind)} · {job.profile?mt(locale,job.profile):job.locale?.toUpperCase()} · {mt(locale,job.state)}</span><span>{new Date(job.updatedAt).toLocaleString(locale)} · {c(locale,'version')} {job.version}</span></button>)}</div>{!data.items.length&&<p>{c(locale,'empty')}</p>}{data.truncated&&<p className={styles.notice}>{mt(locale,'truncated')}</p>}
   {selected&&<>{fresh&&fresh.version!==selected.version&&<div className={styles.notice}><p>{c(locale,'version')} {fresh.version} · {mt(locale,fresh.state)}</p><button type="button" className="btn" onClick={()=>setSelected(fresh)}>{mt(locale,'selectFresh')}</button></div>}<ProcessingJob key={`${selected.id}:${selected.version}`} job={selected} current={fresh||null} locale={locale} onChanged={changed} onSelectSource={onSelectSource} onRegister={onRegister}/></>}
  </>}
 </section>;
}
function ProcessingForm({sourceAssetId,locale,data,onCreated}:{sourceAssetId:string;locale:string;data:MediaProcessingList;onCreated:(value:{job:MediaProcessingJob;duplicate:boolean})=>Promise<void>}){
 const api=useControlledApi(locale),[name,setName]=useState(''),[kind,setKind]=useState<'video'|'subtitle'>('video'),[profile,setProfile]=useState<VideoProfile>(data.capabilities.profiles[0]||'web_480p'),[language,setLanguage]=useState<ContentLocale>(contentLocale(locale)),[vtt,setVtt]=useState(''),[rights,setRights]=useState(false),idempotency=useRef<{body:string;key:string}|null>(null),fileGeneration=useRef(0);
 const permitted=data.capabilities.enabled&&data.capabilities.engineAvailable&&data.capabilities.canCreate&&data.source?.eligible;
 const submit=(event:FormEvent)=>{event.preventDefault();void api.run(async()=>{
  if(kind==='subtitle'&&new TextEncoder().encode(vtt).length>data.capabilities.limits.subtitleBytes)throw new Error(mt(locale,'vttLimit'));
  const payload={name:name.trim(),rightsConfirmed:true,...(kind==='video'?{kind,profile}:{kind,locale:language,vtt})},body=JSON.stringify({sourceAssetId,payload});
  if(idempotency.current?.body!==body)idempotency.current={body,key:crypto.randomUUID()};
  const result=await api.request<{job:MediaProcessingJob;duplicate:boolean}>(`/media/${sourceAssetId}/processing`,{method:'POST',body:JSON.stringify({...payload,idempotencyKey:idempotency.current.key})});
  await onCreated(result);
 });};
 const readVtt=(file:File)=>{const generation=++fileGeneration.current;void api.run(async()=>{if(file.size===0||file.size>data.capabilities.limits.subtitleBytes)throw new Error(mt(locale,'vttLimit'));let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{throw new Error(mt(locale,'vttLimit'));}if(!api.alive()||generation!==fileGeneration.current)return;setVtt(text);});};
 return <form className={styles.form} onSubmit={submit}>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  <fieldset disabled={!permitted||api.busy} style={{border:0,padding:0,minWidth:0,display:'grid',gap:'1rem'}}>
   <label>{c(locale,'title')}<input required maxLength={170} value={name} onChange={event=>setName(event.target.value)}/></label><label>{mt(locale,'output')}<select value={kind} onChange={event=>{fileGeneration.current++;setKind(event.target.value as typeof kind);}}><option value="video">{mt(locale,'video')}</option><option value="subtitle">{mt(locale,'subtitle')}</option></select></label>
   {kind==='video'?<label>{mt(locale,'profile')}<select value={profile} onChange={event=>setProfile(event.target.value as VideoProfile)}>{data.capabilities.profiles.map(value=><option key={value} value={value}>{mt(locale,value)}</option>)}</select></label>:<><label>{c(locale,'locale')}<select value={language} onChange={event=>setLanguage(contentLocale(event.target.value))}>{uiLocales.map(value=><option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label><label>{mt(locale,'loadVtt')}<input type="file" accept=".vtt,text/vtt" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)readVtt(file);}}/></label><label>{mt(locale,'vtt')}<textarea required spellCheck={false} lang={language} dir="ltr" maxLength={data.capabilities.limits.subtitleBytes} value={vtt} onChange={event=>{fileGeneration.current++;setVtt(event.target.value);}}/></label><p className={styles.muted}>{mt(locale,'vttLimit')}</p></>}
   <label className={styles.check}><input type="checkbox" required checked={rights} onChange={event=>setRights(event.target.checked)}/>{mt(locale,'rights')}</label><button type="submit" className="btn btn-primary" disabled={!name.trim()||!rights||kind==='subtitle'&&!vtt.trim()}>{mt(locale,'queue')}</button>
  </fieldset>
 </form>;
}
function ProcessingJob({job,current,locale,onChanged,onSelectSource,onRegister}:{job:MediaProcessingJob;current:MediaProcessingJob|null;locale:string;onChanged:(value:MediaProcessingJob)=>Promise<void>;onSelectSource?:((id:string)=>void);onRegister?:((id:string)=>Promise<void>)}){
 const api=useControlledApi(locale),[reason,setReason]=useState(''),output=current&&readyMediaOutput(current)?.assetId===job.output?.assetId?readyMediaOutput(current):null;
 const command=(action:'cancel'|'retry')=>void api.run(async()=>{await onChanged(await api.request<MediaProcessingJob>(`/media/processing/${job.id}/commands`,{method:'POST',headers:{'If-Match':String(job.version)},body:JSON.stringify({action,reason:reason.trim()})}));});
 return <article className={styles.card}>
  <header className={styles.header}><h4 className={styles.break}>{job.name}</h4><span className={styles.badge}>{mt(locale,job.state)} · {c(locale,'version')} {job.version}</span></header><p>{mt(locale,'attempts')}: {job.attempts} · {new Date(job.updatedAt).toLocaleString(locale)}</p><div className={styles.row}><span>{mt(locale,'source')}</span><code className={styles.code}>{job.sourceAssetId}</code>{onSelectSource&&<button type="button" className="btn" onClick={()=>onSelectSource(job.sourceAssetId)}>{c(locale,'select')}</button>}</div><p className={styles.code}>SHA-256: {job.sourceSha256}</p>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}{api.conflict&&<p className={styles.notice}>{c(locale,'conflict')}</p>}{job.lastError&&<p className={styles.notice}><code>{job.lastError}</code></p>}
  {job.probe&&<p dir="ltr">{job.probe.width} × {job.probe.height} px · {job.probe.durationSeconds.toFixed(2)} s · {job.probe.framesPerSecond.toFixed(2)} fps · {job.probe.videoCodec}{job.probe.audioCodec?' / '+job.probe.audioCodec:''}</p>}
  {job.output&&<section className={styles.list}><h4>{mt(locale,'output')}</h4><p className={styles.break}>{job.output.filename} · {(job.output.bytes/1024).toFixed(1)} KiB · {mt(locale,job.output.visibility)} · {mt(locale,job.output.scanStatus)}</p><p className={styles.code}>SHA-256: {job.output.sha256}</p><AuthorizedMediaPreview asset={{...job.output,id:job.output.assetId}} enabled={!!output} locale={locale}/>{output&&onRegister&&<button type="button" className="btn" disabled={api.busy} onClick={()=>void api.run(async()=>onRegister(output.assetId))}>{mt(locale,'register')}</button>}</section>}
  {(job.canCancel||job.canRetry)&&<div className={styles.form}><label>{c(locale,'reason')}<textarea minLength={8} maxLength={500} required value={reason} onChange={event=>setReason(event.target.value)}/></label><div className={styles.row}>{job.canCancel&&<button type="button" className="btn" disabled={api.busy||api.conflict||reason.trim().length<8} onClick={()=>command('cancel')}>{mt(locale,'cancelJob')}</button>}{job.canRetry&&<button type="button" className="btn" disabled={api.busy||api.conflict||reason.trim().length<8} onClick={()=>command('retry')}>{mt(locale,'retry')}</button>}</div></div>}
  <details><summary>{mt(locale,'history')}</summary><ol>{job.history.map(item=><li key={item.version}>{c(locale,'version')} {item.version} · {mt(locale,item.state)} · {new Date(item.at).toLocaleString(locale)} {item.code&&<code>{item.code}</code>}</li>)}</ol></details>
 </article>;
}
