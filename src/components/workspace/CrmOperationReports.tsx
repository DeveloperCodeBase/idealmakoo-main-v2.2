'use client';
import {useEffect,useState,type FormEvent} from 'react';
import type {CrmForecast,CrmForecastFilters,CrmReportSnapshot} from '@/types/crm-operations';
import type {PipelineView} from '@/types/pipeline';
import type {WorkspaceStore} from './store';
import {c,contentLocale} from '@/components/controlled/copy';
import {downloadControlledBlob,isoDateInput,useControlledApi} from '@/components/controlled/useControlledApi';
import styles from '@/components/controlled/controlled.module.css';
import {ot} from './crm-operations-copy';

export default function CrmReports({store}:{store:WorkspaceStore}){return <Reports key={JSON.stringify([store.actorId,store.role,store.locale,store.actor])} store={store}/>;}
function Reports({store}:{store:WorkspaceStore}){
 const {locale}=store,api=useControlledApi(locale),[from,setFrom]=useState(''),[until,setUntil]=useState(''),[pipeline,setPipeline]=useState(''),[pipelines,setPipelines]=useState<PipelineView[]>([]),[report,setReport]=useState<CrmForecast|null>(null),[snapshots,setSnapshots]=useState<CrmReportSnapshot[]>([]),[selected,setSelected]=useState<CrmReportSnapshot|null>(null);
 const mayReadPipelines=store.permit('view','opportunities');
 const load=async()=>{const result=await api.request<{items:CrmReportSnapshot[]}>('/crm/reports/snapshots');setSnapshots(result.items);};
 useEffect(()=>{void api.run(load);},[]);
 useEffect(()=>{
  if(!mayReadPipelines){setPipelines([]);setPipeline('');return;}
  const controller=new AbortController();
  void api.request<{items:PipelineView[]}>('/crm/pipelines',{signal:controller.signal}).then(result=>{
   if(!controller.signal.aborted&&store.permit('view','opportunities'))setPipelines(result.items);
  }).catch(reason=>{if(!controller.signal.aborted)api.fail(reason);});
  return()=>controller.abort();
 },[mayReadPipelines,store.permit,api.request,api.fail]);
 const filters=():CrmForecastFilters=>({...from?{createdFrom:isoDateInput(from)}:{},...until?{createdUntil:isoDateInput(until)}:{},...pipeline?{pipelineId:pipeline}:{}});
 const calculate=(event:FormEvent)=>{event.preventDefault();void api.run(async()=>{const result=await api.request<CrmForecast>('/crm/reports/forecast',{method:'POST',body:JSON.stringify(filters())});setReport(result);setSelected(null);});};
 const capture=()=>void api.run(async()=>{const result=await api.request<CrmReportSnapshot>('/crm/reports/snapshots',{method:'POST',body:JSON.stringify(filters())});setSnapshots(current=>[result,...current.filter(item=>item.id!==result.id)]);setSelected(result);setReport(result.report);});
 const select=(item:CrmReportSnapshot)=>void api.run(async()=>{const current=await api.request<CrmReportSnapshot>(`/crm/reports/snapshots/${item.id}`);setSelected(current);setReport(current.report);});
 const download=()=>void api.run(async()=>{if(selected)downloadControlledBlob(await api.blob(`/crm/reports/snapshots/${selected.id}`),`crm-report-${selected.id}.json`);});
 return <section className={styles.panel} data-crm-reports><header className={styles.header}><h2>{ot(locale,'reports')}</h2><button type="button" className="btn" disabled={api.busy} onClick={()=>void api.run(load)}>{c(locale,'refresh')}</button></header><p className={styles.notice}>{ot(locale,'reportPolicy')}</p>{api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  <form className={styles.form} onSubmit={calculate}><div className={styles.grid}><label>{ot(locale,'from')}<input type="datetime-local" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>{ot(locale,'until')}<input type="datetime-local" value={until} onChange={event=>setUntil(event.target.value)}/></label><label>{ot(locale,'pipeline')}<select value={pipeline} onChange={event=>setPipeline(event.target.value)}><option value="">{ot(locale,'all')}</option>{pipelines.map(item=><option key={item.id} value={item.id}>{(item.activeRevision?.definition||item.draft)?.title[contentLocale(locale)]||item.id}</option>)}</select></label></div><div className={styles.row}><button className="btn btn-primary" type="submit" disabled={api.busy}>{ot(locale,'calculate')}</button>{store.permit('export','reports')&&<button type="button" className="btn" disabled={api.busy} onClick={capture}>{ot(locale,'capture')}</button>}</div></form>
  {report&&<section className={styles.card}><header className={styles.header}><h3>{selected?ot(locale,'snapshot'):ot(locale,'calculate')}</h3>{selected&&<button className="btn" type="button" disabled={api.busy} onClick={download}>{c(locale,'download')} · JSON</button>}</header><p>{ot(locale,'captured')}: {new Date(report.capturedAt).toLocaleString(locale)}</p><p>{c(locale,'version')}: {report.workspaceVersion} · {ot(locale,'opportunities')}: {report.opportunityCount}</p>{selected&&<p className={styles.code}>SHA-256 {selected.checksum}</p>}<details><summary>{ot(locale,'from')} / {ot(locale,'until')} / {ot(locale,'pipeline')}</summary><pre className={styles.code}>{JSON.stringify(report.filters,null,2)}</pre><p className={styles.code}>{report.calculationPolicyVersion}</p></details><div className={styles.table}><table><thead><tr><th>{ot(locale,'currency')}</th><th>{ot(locale,'stage')}</th><th>{ot(locale,'count')}</th><th>{ot(locale,'amount')}</th><th>{ot(locale,'weightedKnown')}</th><th>{ot(locale,'weighted')}</th><th>{ot(locale,'unknownAmount')}</th><th>{ot(locale,'unknownProbability')}</th><th>{ot(locale,'toman')}</th></tr></thead><tbody>{report.groups.map((group,index)=><tr key={group.currency+':'+group.pipelineId+':'+group.stageId+':'+index}><td><bdi>{group.currency}</bdi></td><td><bdi>{group.stageId}</bdi><small className={styles.code}>{group.pipelineId}</small></td><td>{group.count}</td><td><bdi>{group.knownAmountDecimal}</bdi></td><td><bdi>{group.knownWeightedAmountDecimal}</bdi></td><td><bdi>{group.weightedAmountDecimal??c(locale,'unknown')}</bdi></td><td>{group.unknownAmountCount}</td><td>{group.unknownProbabilityCount}</td><td><bdi>{group.tomanEquivalentDecimal??'—'}</bdi></td></tr>)}</tbody></table></div>{!report.groups.length&&<p>{c(locale,'empty')}</p>}</section>}
  <section className={styles.list}><h3>{ot(locale,'snapshot')}</h3>{snapshots.length===0&&<p>{c(locale,'empty')}</p>}{snapshots.map(item=><button className={styles.choice} type="button" disabled={api.busy} key={item.id} aria-pressed={selected?.id===item.id} onClick={()=>select(item)}><strong>{new Date(item.createdAt).toLocaleString(locale)}</strong><span>{ot(locale,'opportunities')}: {item.report.opportunityCount}</span><span className={styles.code}>{item.checksum}</span></button>)}</section>
 </section>;
}
