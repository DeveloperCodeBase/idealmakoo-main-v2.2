'use client';
import Link from 'next/link';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {monitoringViews,incidentServices,incidentStates,operationalRoutes,type MonitoringResponse,type MonitoringMetric,type MonitoringView,type IncidentService,type MonitoringCapabilities} from '@/types/monitoring';
import type {WorkspaceStore} from './store';
import {c} from '@/components/controlled/copy';
import {useControlledApi} from '@/components/controlled/useControlledApi';
import styles from '@/components/controlled/controlled.module.css';
import {mt} from './monitoring-copy';

type Incident=Awaited<ReturnType<typeof import('@/server/operations-incidents').getOperationalIncident>>;
type Slo=Awaited<ReturnType<typeof import('@/server/operations-slo').updateOperationalSlo>>;
type SloValue=Pick<Slo,'name'|'kind'|'route'|'target'|'windowMinutes'|'minimumSamples'|'enabled'>;
function commandKey(ref:{current:{body:string;key:string}|null},value:unknown){const body=JSON.stringify(value);if(!ref.current||ref.current.body!==body)ref.current={body,key:crypto.randomUUID()};return ref.current.key;}
const windows=[5,60,1440,10080] as const;

export default function LiveMonitoring({store,section='overview'}:{store:WorkspaceStore;section?:string}){
 const view=monitoringViews.includes(section as MonitoringView)?section as MonitoringView:'overview';
 return <MonitoringBody key={JSON.stringify([store.actorId,store.role,store.locale,store.actor,view])} store={store} view={view}/>;
}
function MonitoringBody({store,view}:{store:WorkspaceStore;view:MonitoringView}){
 const {locale}=store,api=useControlledApi(locale),[snapshot,setSnapshot]=useState<MonitoringResponse|null>(null),[initialSnapshotSettled,setInitialSnapshotSettled]=useState(false),[minutes,setMinutes]=useState(60),sequence=useRef(0);
 const [linked,setLinked]=useState<{id:string;key:string}|null>(null);
 const refresh=async()=>{const current=++sequence.current;try{const result=await api.request<MonitoringResponse>(`/monitoring/${view}?minutes=${minutes}`);if(current===sequence.current)setSnapshot(result);}finally{if(current===sequence.current)setInitialSnapshotSettled(true);}};
 useEffect(()=>{void api.run(refresh);const timer=setInterval(()=>void api.run(refresh),30000);return()=>{clearInterval(timer);sequence.current++;};},[view,minutes]);
 return <section className={styles.panel} aria-label={mt(locale,'heading')}>
  <header className={styles.header}><div><h2>{mt(locale,'heading')} · {mt(locale,view)}</h2><p>{mt(locale,'introduction')}</p></div><button type="button" className="btn" disabled={api.busy} onClick={()=>void api.run(refresh)}>{c(locale,'refresh')}</button></header>
  {snapshot&&<nav className={styles.row} aria-label={mt(locale,'heading')}>{snapshot.capabilities.allowedViews.map(item=><Link className="btn" aria-current={view===item?'page':undefined} key={item} href={`/${locale}/admin/monitoring${item==='overview'?'':'/'+item}`}>{mt(locale,item)}</Link>)}</nav>}
  {initialSnapshotSettled&&<div className={styles.form}><label>{mt(locale,'window')}<select value={minutes} disabled={api.busy} onChange={event=>setMinutes(Number(event.target.value))}>{windows.map(value=><option value={value} key={value}>{new Intl.NumberFormat(locale).format(value)} {mt(locale,'minutes')}</option>)}</select></label></div>}
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  {!snapshot&&<p role="status">{api.busy?c(locale,'loading'):c(locale,'unknown')}</p>}
  {initialSnapshotSettled&&<p className={styles.notice}>{mt(locale,'evidenceNote')}</p>}
  {snapshot&&<>
   <div className={styles.card}><div className={styles.row}><span>{mt(locale,'sampled')}: <time dateTime={snapshot.sampledAt}>{new Date(snapshot.sampledAt).toLocaleString(locale)}</time></span><span>{mt(locale,'samples')}: {new Intl.NumberFormat(locale).format(snapshot.coverage.samples)}</span></div><p>{new Date(snapshot.window.from).toLocaleString(locale)} — {new Date(snapshot.window.to).toLocaleString(locale)}</p><p>{mt(locale,'source')}: <bdi>{snapshot.coverage.source}</bdi></p>{snapshot.coverage.truncated&&<p className={styles.notice}>{mt(locale,'truncated')}</p>}<details><summary>{mt(locale,'release')}</summary><p className={styles.code}>{snapshot.release.id}</p><p className={styles.code}>{snapshot.release.commitSha||mt(locale,'unknown')}</p></details></div>
   <Metrics items={snapshot.metrics} locale={locale} headingLevel={3}/>
   <div className={styles.grid}>{snapshot.observations.map(item=><section className={styles.card} key={item.id}><header className={styles.header}><h3>{mt(locale,item.key)}</h3><span className={styles.badge}>{mt(locale,item.state)}</span></header><p>{mt(locale,'sampled')}: {item.sampledAt?new Date(item.sampledAt).toLocaleString(locale):mt(locale,'unknown')}</p><Metrics items={item.metrics} locale={locale}/>{item.note&&<details><summary>{mt(locale,'technical')}</summary><code className={styles.code}>{item.note}</code></details>}</section>)}</div>
   {snapshot.capabilities.manageSlos&&<SloCenter locale={locale} onIncident={(id,key)=>setLinked({id,key})}/>}
   {snapshot.capabilities.manageIncidents&&<IncidentCenter locale={locale} linked={linked} clearLinked={()=>setLinked(null)}/>}
  </>}
 </section>;
}
function Metrics({items,locale,headingLevel=4}:{items:MonitoringMetric[];locale:string;headingLevel?:3|4}){
 const Heading=headingLevel===3?'h3':'h4';
 const nf=new Intl.NumberFormat(locale,{maximumFractionDigits:2});
 return <div className={styles.grid}>{items.map(item=><article className={styles.card} key={item.key}><Heading style={headingLevel===3?{fontSize:"1em"}:undefined}>{mt(locale,item.key)}</Heading><p className={styles.metric}>{item.value===null?mt(locale,'unknown'):nf.format(item.value)} {item.value===null?'':item.unit==='percent'?'%':item.unit==='count'?'':item.unit}</p><div className={styles.row}><span className={styles.badge}>{mt(locale,item.state)}</span><span>{mt(locale,'samples')}: {nf.format(item.samples)}</span></div>{item.note&&<details><summary>{mt(locale,'technical')}</summary><code className={styles.code}>{item.note}</code></details>}</article>)}</div>;
}

function IncidentCenter({locale,linked,clearLinked}:{locale:string;linked:{id:string;key:string}|null;clearLinked:()=>void}){
 const api=useControlledApi(locale),[items,setItems]=useState<Incident[]>([]),[cursor,setCursor]=useState<string|null>(null),[filter,setFilter]=useState(''),[selected,setSelected]=useState<Incident|null>(null),[creating,setCreating]=useState(false),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[service,setService]=useState<IncidentService>('app'),[severity,setSeverity]=useState('sev3'),command=useRef<{body:string;key:string}|null>(null);
 const load=async(more=false)=>{const search=new URLSearchParams({limit:'25'});if(filter)search.set('state',filter);if(more&&cursor)search.set('cursor',cursor);const result=await api.request<{items:Incident[];nextCursor:string|null;capabilities:MonitoringCapabilities}>('/monitoring/incidents?'+search);setItems(current=>more?[...current,...result.items.filter(item=>!current.some(old=>old.id===item.id))]:result.items);setCursor(result.nextCursor);};
 useEffect(()=>{void api.run(()=>load());},[filter]);
 useEffect(()=>{if(linked){setCreating(true);setService('app');}},[linked?.id]);
 const changed=(item:Incident)=>{setSelected(item);setItems(current=>[item,...current.filter(entry=>entry.id!==item.id)]);};
 const create=(event:FormEvent)=>{event.preventDefault();void api.run(async()=>{const value={title:title.trim(),description:description.trim(),service,severity,...(linked?{sloObservationId:linked.id}:{})};const result=await api.request<{incident:Incident;duplicate:boolean}>('/monitoring/incidents',{method:'POST',body:JSON.stringify({...value,idempotencyKey:commandKey(command,value)})});changed(result.incident);setCreating(false);setTitle('');setDescription('');command.current=null;clearLinked();});};
 return <section className={styles.card} aria-label={mt(locale,'incidents')}>
  <header className={styles.header}><div><h3>{mt(locale,'incidents')}</h3><p>{mt(locale,'incidentHint')}</p></div><div className={styles.row}><button className="btn" type="button" disabled={api.busy} onClick={()=>void api.run(()=>load())}>{c(locale,'refresh')}</button><button className="btn" type="button" onClick={()=>setCreating(value=>!value)}>{creating?c(locale,'cancel'):c(locale,'create')}</button></div></header>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  {creating&&<form className={styles.form} onSubmit={create}><label>{c(locale,'title')}<input minLength={3} maxLength={160} required value={title} onChange={event=>setTitle(event.target.value)}/></label><label>{mt(locale,'description')}<textarea minLength={8} maxLength={2000} required value={description} onChange={event=>setDescription(event.target.value)}/></label><div className={styles.grid}><label>{mt(locale,'service')}<select value={service} onChange={event=>setService(event.target.value as IncidentService)}>{incidentServices.map(value=><option value={value} key={value}>{mt(locale,value)}</option>)}</select></label><label>{mt(locale,'severity')}<select value={severity} onChange={event=>setSeverity(event.target.value)}>{['sev1','sev2','sev3','sev4'].map(value=><option value={value} key={value}>{value.toUpperCase()}</option>)}</select></label></div>{linked&&<div className={styles.notice}><p>{mt(locale,'linkedObservation')}: {linked.key}</p><code className={styles.code}>{linked.id}</code><button className="btn" type="button" onClick={clearLinked}>{c(locale,'cancel')}</button></div>}<button type="submit" className="btn btn-primary" disabled={api.busy||title.trim().length<3||description.trim().length<8}>{c(locale,'create')}</button></form>}
  <div className={styles.form}><label>{c(locale,'status')}<select value={filter} disabled={api.busy} onChange={event=>setFilter(event.target.value)}><option value="">{mt(locale,'all')}</option>{incidentStates.map(value=><option value={value} key={value}>{mt(locale,value)}</option>)}</select></label></div>
  <div className={styles.split}><div className={styles.list}>{!items.length&&<p>{c(locale,'empty')}</p>}{items.map(item=><button className={styles.choice} type="button" key={item.id} aria-pressed={selected?.id===item.id} onClick={()=>setSelected(item)}><strong>{item.title}</strong><span>{mt(locale,item.state)} · {item.severity.toUpperCase()} · {c(locale,'version')} {item.version}</span><span>{new Date(item.updatedAt).toLocaleString(locale)}</span></button>)}{cursor&&<button className="btn" type="button" disabled={api.busy} onClick={()=>void api.run(()=>load(true))}>{mt(locale,'more')}</button>}</div>{selected&&<IncidentDetail key={selected.id+':'+selected.version} locale={locale} item={selected} onChange={changed}/>}</div>
 </section>;
}
function IncidentDetail({item,locale,onChange}:{item:Incident;locale:string;onChange:(item:Incident)=>void}){
 const api=useControlledApi(locale),[reason,setReason]=useState(''),[fresh,setFresh]=useState<Incident|null>(null),command=useRef<{body:string;key:string}|null>(null);
 const transition=(event:FormEvent)=>{event.preventDefault();if(!item.nextState)return;void api.run(async()=>{const value={state:item.nextState,reason:reason.trim()};const result=await api.request<{incident:Incident;duplicate:boolean}>(`/monitoring/incidents/${item.id}/transitions`,{method:'POST',headers:{'If-Match':String(item.version)},body:JSON.stringify({...value,idempotencyKey:commandKey(command,value)})});onChange(result.incident);});};
 return <section className={styles.card}><header className={styles.header}><h4>{item.title}</h4><span className={styles.badge}>{mt(locale,item.state)}</span></header><p>{item.description}</p><p>{mt(locale,'service')}: {mt(locale,item.service)} · {item.severity.toUpperCase()}</p><p>{c(locale,'version')}: {item.version}</p>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}{api.conflict&&<p className={styles.notice}>{c(locale,'conflict')}</p>}
  <button type="button" className="btn" disabled={api.busy} onClick={()=>void api.run(async()=>setFresh(await api.request<Incident>(`/monitoring/incidents/${item.id}`)))}>{c(locale,'refresh')}</button>
  {fresh&&<div className={styles.notice}><p>{mt(locale,fresh.state)} · {c(locale,'version')} {fresh.version}</p><button type="button" className="btn" onClick={()=>onChange(fresh)}>{mt(locale,'selectFresh')}</button></div>}
  <ol className={styles.list}>{item.transitions.map(value=><li className={styles.card} key={value.id}><strong>{value.from?mt(locale,value.from)+' → ':''}{mt(locale,value.to)}</strong><p>{value.reason}</p><p>{new Date(value.createdAt).toLocaleString(locale)}</p><span className={styles.code}>{value.actorId}</span></li>)}</ol>
  {item.nextState&&<form className={styles.form} onSubmit={transition}><h4>{mt(locale,'next')}: {mt(locale,item.nextState)}</h4><label>{c(locale,'reason')}<textarea minLength={8} maxLength={2000} required value={reason} onChange={event=>setReason(event.target.value)}/></label><button className="btn btn-primary" type="submit" disabled={api.busy||api.conflict||reason.trim().length<8}>{mt(locale,'next')}</button></form>}
 </section>;
}

function SloCenter({locale,onIncident}:{locale:string;onIncident:(id:string,key:string)=>void}){
 const api=useControlledApi(locale),[items,setItems]=useState<Slo[]>([]),[selected,setSelected]=useState<Slo|null>(null),[editing,setEditing]=useState(false);
 const load=async()=>setItems((await api.request<{items:Slo[]}>('/monitoring/slos')).items);
 useEffect(()=>{void api.run(load);},[]);
 const changed=(item:Slo)=>{setItems(current=>[item,...current.filter(entry=>entry.id!==item.id)]);setSelected(item);};
 return <section className={styles.card}><header className={styles.header}><div><h3>{mt(locale,'slos')}</h3><p>{mt(locale,'sloHint')}</p></div><div className={styles.row}><button className="btn" type="button" disabled={api.busy} onClick={()=>void api.run(load)}>{c(locale,'refresh')}</button><button type="button" className="btn" onClick={()=>{setSelected(null);setEditing(true);}}>{c(locale,'create')}</button></div></header>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  <div className={styles.split}><div className={styles.list}>{items.length===0&&<p>{c(locale,'empty')}</p>}{items.map(item=><article key={item.id} className={styles.card}><button className={styles.choice} type="button" onClick={()=>{setSelected(item);setEditing(true);}}><strong>{item.name}</strong><span>{mt(locale,item.kind)}</span><span>{c(locale,'version')} {item.version} · {mt(locale,!item.enabled?'disabled':item.latest?.state||'unknown')}</span></button>{item.latest?<><p>{mt(locale,'sampled')}: {new Date(item.latest.sampledAt).toLocaleString(locale)}</p><p>{mt(locale,'target')}: {item.latest.target} · {mt(locale,'observed')}: {item.latest.observed??mt(locale,'unknown')}</p><p>{mt(locale,'samples')}: {item.latest.sampleCount}</p>{item.latest.reason&&<code className={styles.code}>{item.latest.reason}</code>}<button className="btn" type="button" onClick={()=>onIncident(item.latest!.id,item.name)}>{mt(locale,'linkIncident')}</button></>:<p>{mt(locale,'pendingObservation')}</p>}</article>)}</div>{editing&&<SloEditor key={selected?selected.id+':'+selected.version:'new'} item={selected} locale={locale} onChange={changed}/>}</div>
 </section>;
}
function SloEditor({item,locale,onChange}:{item:Slo|null;locale:string;onChange:(item:Slo)=>void}){
 const api=useControlledApi(locale),[value,setValue]=useState<SloValue>(item?{name:item.name,kind:item.kind,route:item.route,target:item.target,windowMinutes:item.windowMinutes,minimumSamples:item.minimumSamples,enabled:item.enabled}:{name:'',kind:'http_availability',route:'all',target:99.9,windowMinutes:60,minimumSamples:100,enabled:false}),[reason,setReason]=useState(''),command=useRef<{body:string;key:string}|null>(null);
 const set=<K extends keyof SloValue>(key:K,next:SloValue[K])=>setValue(current=>({...current,[key]:next}));
 const save=(event:FormEvent)=>{event.preventDefault();void api.run(async()=>{const body={value,reason:reason.trim()};if(item)onChange(await api.request<Slo>(`/monitoring/slos/${item.id}`,{method:'PATCH',headers:{'If-Match':String(item.version)},body:JSON.stringify(body)}));else onChange((await api.request<{item:Slo;duplicate:boolean}>('/monitoring/slos',{method:'POST',body:JSON.stringify({...body,idempotencyKey:commandKey(command,body)})})).item);});};
 return <form className={styles.form} onSubmit={save}><h4>{item?c(locale,'edit'):c(locale,'create')}</h4>{api.error&&<p className={styles.error} role="alert">{api.error}</p>}{api.conflict&&<p className={styles.notice}>{c(locale,'conflict')}</p>}
  <label>{mt(locale,'name')}<input minLength={3} maxLength={120} required value={value.name} onChange={event=>set('name',event.target.value)}/></label>
  <label>{mt(locale,'kind')}<select value={value.kind} disabled={!!item} onChange={event=>{const kind=event.target.value as SloValue['kind'];setValue(current=>({...current,kind,...(kind==='worker_freshness'?{route:'all',minimumSamples:1,target:60}:kind==='http_availability'?{target:99.9}:{target:1000})}));}}>{['http_availability','http_latency_p95','worker_freshness'].map(kind=><option key={kind} value={kind}>{mt(locale,kind)}</option>)}</select></label>
  <label>{mt(locale,'route')}<select value={value.route} disabled={!!item||value.kind==='worker_freshness'} onChange={event=>set('route',event.target.value as SloValue['route'])}>{['all',...operationalRoutes].map(route=><option key={route} value={route}>{mt(locale,route)}</option>)}</select></label>
  <label>{mt(locale,'target')}<input type="number" required min="0.001" step="any" max={value.kind==='http_availability'?100:value.kind==='worker_freshness'?86400:600000} value={value.target} onChange={event=>set('target',Number(event.target.value))}/></label>
  <label>{mt(locale,'window')}<select value={value.windowMinutes} onChange={event=>set('windowMinutes',Number(event.target.value))}>{windows.map(window=><option key={window} value={window}>{window} {mt(locale,'minutes')}</option>)}</select></label>
  <label>{mt(locale,'minimum')}<input type="number" min={1} max={10000} step={1} required disabled={value.kind==='worker_freshness'} value={value.minimumSamples} onChange={event=>set('minimumSamples',Number(event.target.value))}/></label>
  <label className={styles.check}><input type="checkbox" checked={value.enabled} onChange={event=>set('enabled',event.target.checked)}/>{mt(locale,'enabled')}</label>
  <label>{c(locale,'reason')}<textarea minLength={8} maxLength={500} required value={reason} onChange={event=>setReason(event.target.value)}/></label>
  <button type="submit" className="btn btn-primary" disabled={api.busy||api.conflict||value.name.trim().length<3||reason.trim().length<8}>{c(locale,'save')}</button>
 </form>;
}
