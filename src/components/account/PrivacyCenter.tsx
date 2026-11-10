'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {useApp} from '@/components/providers/AppProvider';
import type {PrivacyHoldDto,PrivacyRequestDto,PrivacyRequestList,PrivacySubjectDto} from '@/types/privacy';
import {c,text} from '@/components/controlled/copy';
import {controlledAccountKey,downloadControlledBlob,isoDateInput,localDateInput,useControlledApi} from '@/components/controlled/useControlledApi';
import styles from '@/components/controlled/controlled.module.css';
import {pt} from './privacy-copy';

const validReason=(value:string)=>value.trim().length>=3&&value.trim().length<=2000&&!/[\u0000-\u001f\u007f]/.test(value);
const emptyList:PrivacyRequestList={items:[],capabilities:{manageHolds:false,selectSubject:false,ledgerConfigured:false}};
export default function PrivacyCenter(){
 const {session,locale}=useApp();
 if(!session)return <section className={styles.panel}><h2>{pt(locale,'heading')}</h2><p>{pt(locale,'signIn')}</p></section>;
 return <PrivacyCenterBody key={controlledAccountKey(session,locale)} locale={locale} userId={session.id} customer={session.role==='customer'}/>;
}

function PrivacyCenterBody({locale,userId,customer}:{locale:string;userId:string;customer:boolean}){
 const api=useControlledApi(locale);
 const [data,setData]=useState(emptyList),[loaded,setLoaded]=useState(false),[selected,setSelected]=useState<PrivacyRequestDto|null>(null),[action,setAction]=useState<'export'|'erase'>('export'),[subjectType,setSubjectType]=useState<PrivacySubjectDto['type']>('user'),[subjectId,setSubjectId]=useState(userId),[reason,setReason]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{const result=await api.request<PrivacyRequestList>('/privacy/requests');setData(result);setLoaded(true);};
 useEffect(()=>{void api.run(load);},[]);
 const changed=(item:PrivacyRequestDto)=>{setSelected(item);setData(current=>({...current,items:[item,...current.items.filter(entry=>entry.id!==item.id)]}));};
 const submit=(event:FormEvent)=>{event.preventDefault();void api.run(async()=>{
  if(!validReason(reason))throw new Error(pt(locale,'invalidReason'));
  const result=await api.request<PrivacyRequestDto>('/privacy/requests',{method:'POST',body:JSON.stringify({action,subject:customer||!data.capabilities.selectSubject?{type:'user',id:userId}:{type:subjectType,id:subjectId.trim()},reason:reason.trim()})});
  changed(result);setReason('');setNotice(c(locale,'confirmed'));
 });};
 return <section className={styles.panel} aria-label={pt(locale,'heading')}>
  <header className={styles.header}><div><h2>{pt(locale,'heading')}</h2><p>{pt(locale,'introduction')}</p></div><button type="button" className="btn" disabled={api.busy} onClick={()=>void api.run(load)}>{c(locale,'refresh')}</button></header>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  {notice&&<p className={styles.notice} role="status">{notice}</p>}
  {!loaded&&<p role="status">{api.busy?c(locale,'loading'):c(locale,'unknown')}</p>}
  {loaded&&<>
   {!data.capabilities.ledgerConfigured&&<p className={styles.notice}>{pt(locale,'ledgerMissing')}</p>}
   <details className={styles.card} open><summary>{pt(locale,'requestNew')}</summary>
    <form className={styles.form} onSubmit={submit}>
     <label>{pt(locale,'subject')}<select value={action} onChange={event=>setAction(event.target.value as 'export'|'erase')}><option value="export">{pt(locale,'export')}</option><option value="erase">{pt(locale,'erase')}</option></select></label>
     {!customer&&data.capabilities.selectSubject?<div className={styles.grid}>
      <label>{pt(locale,'subject')}<select value={subjectType} onChange={event=>{setSubjectType(event.target.value as PrivacySubjectDto['type']);setSubjectId('');}}><option value="user">{pt(locale,'user')}</option><option value="crm-contact">{pt(locale,'contact')}</option></select></label>
      <label>{pt(locale,'subjectId')}<input required autoComplete="off" maxLength={120} value={subjectId} onChange={event=>setSubjectId(event.target.value)}/></label>
     </div>:<p className={styles.muted}>{pt(locale,'ownOnly')}</p>}
     <label>{c(locale,'reason')}<input required minLength={3} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
     <p className={styles.muted}>{pt(locale,'caseHint')}</p>
     {action==='erase'&&<p className={styles.notice}>{pt(locale,'independent')}</p>}
     <button type="submit" className="btn btn-primary" disabled={api.busy||!validReason(reason)||(!customer&&data.capabilities.selectSubject&&!subjectId.trim())}>{pt(locale,'requestNew')}</button>
    </form>
   </details>
   <div className={styles.split}>
    <section className={styles.list} aria-label={pt(locale,'requests')}><h3>{pt(locale,'requests')}</h3><p className={styles.muted}>{pt(locale,'recordLimit')}</p>
     {data.items.length===0&&<p>{c(locale,'empty')}</p>}
     {data.items.map(item=><button type="button" key={item.id} className={styles.choice} aria-pressed={selected?.id===item.id} onClick={()=>setSelected(item)}>
      <strong>{pt(locale,item.action)}</strong><span>{pt(locale,item.status)} · {c(locale,'version')} {item.version}</span><span className={styles.code}>{item.subject.id}</span><span>{new Date(item.createdAt).toLocaleString(locale)}</span>
     </button>)}
    </section>
    {selected?<PrivacyRequestDetail key={selected.id+':'+selected.version} item={selected} locale={locale} onChange={changed}/>:<p className={styles.notice}>{pt(locale,'selectRecord')}</p>}
   </div>
   {data.capabilities.manageHolds&&<PrivacyHolds locale={locale}/>}
  </>}
 </section>;
}

function PrivacyRequestDetail({item,locale,onChange}:{item:PrivacyRequestDto;locale:string;onChange:(item:PrivacyRequestDto)=>void}){
 const api=useControlledApi(locale),[reason,setReason]=useState(''),[subject,setSubject]=useState(''),[confirmed,setConfirmed]=useState(false),[fresh,setFresh]=useState<PrivacyRequestDto|null>(null),[notice,setNotice]=useState('');
 const decide=(decision:'approved'|'rejected')=>void api.run(async()=>{
  if(!validReason(reason))throw new Error(pt(locale,'invalidReason'));
  onChange(await api.request<PrivacyRequestDto>(`/privacy/requests/${item.id}/decision`,{method:'POST',headers:{'If-Match':String(item.version)},body:JSON.stringify({decision,reason:reason.trim()})}));
 });
 const execute=(event:FormEvent)=>{event.preventDefault();if(!confirmed||subject!==item.subject.id)return;void api.run(async()=>{
  onChange(await api.request<PrivacyRequestDto>(`/privacy/requests/${item.id}/execute`,{method:'POST',headers:{'If-Match':String(item.version)},body:JSON.stringify({confirmSubjectId:subject})}));
 });};
 const download=()=>void api.run(async()=>{const blob=await api.blob(`/privacy/requests/${item.id}/export`);downloadControlledBlob(blob,`privacy-export-${item.id}.json`);setNotice(pt(locale,'prepared'));setFresh(await api.request<PrivacyRequestDto>(`/privacy/requests/${item.id}`));});
 return <section className={styles.card}>
  <header className={styles.header}><h3>{pt(locale,item.action)}</h3><span className={styles.badge}>{pt(locale,item.status)}</span></header>
  <p>{pt(locale,item.subject.type==='user'?'user':'contact')}: <span className={styles.code}>{item.subject.id}</span></p><p>{c(locale,'version')}: {item.version}</p><p>{item.reason}</p>
  <p>{pt(locale,'createdAt')}: {new Date(item.createdAt).toLocaleString(locale)}</p>
  {item.approvedBy&&<p>{pt(locale,'approvedBy')}: <span className={styles.code}>{item.approvedBy}</span></p>}
  {item.decisionReason&&<p>{pt(locale,'decision')}: {item.decisionReason}</p>}
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  {notice&&<p className={styles.notice} role="status">{notice}</p>}
  {api.conflict&&<p className={styles.notice}>{c(locale,'conflict')}</p>}
  <button className="btn" type="button" disabled={api.busy} onClick={()=>void api.run(async()=>setFresh(await api.request<PrivacyRequestDto>(`/privacy/requests/${item.id}`)))}>{pt(locale,'latest')}</button>
  {fresh&&<div className={styles.notice}><p>{pt(locale,fresh.status)} · {c(locale,'version')} {fresh.version}</p><button className="btn" type="button" onClick={()=>onChange(fresh)}>{pt(locale,'selectFresh')}</button></div>}
  {item.capabilities.export&&<button type="button" className="btn btn-primary" disabled={api.busy} onClick={download}>{pt(locale,'export')}</button>}
  {item.action==='erase'&&<section className={styles.list}><h4>{pt(locale,'blockers')}</h4><p className={styles.muted}>{pt(locale,'blockedNote')}</p>
   {item.blockers.map(blocker=><div className={styles.notice} key={blocker.code}><strong>{blocker.code} · {blocker.count}</strong><p>{blocker.description}</p></div>)}
   {item.blockers.length===0&&item.status!=='completed'&&<p>{pt(locale,'noAssessment')}</p>}
  </section>}
  {item.result&&<details><summary>{pt(locale,'result')}</summary><p>{pt(locale,'retentionComplete')}</p><pre className={styles.code}>{JSON.stringify(item.result,null,2)}</pre></details>}
  {item.capabilities.approve&&<section className={styles.form}><h4>{pt(locale,'decision')}</h4><p>{pt(locale,'independent')}</p><label>{c(locale,'reason')}<input minLength={3} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><p className={styles.muted}>{pt(locale,'caseHint')}</p><div className={styles.row}><button className="btn btn-primary" type="button" disabled={api.busy||api.conflict||!validReason(reason)} onClick={()=>decide('approved')}>{c(locale,'approve')}</button><button className="btn" type="button" disabled={api.busy||api.conflict||!validReason(reason)} onClick={()=>decide('rejected')}>{c(locale,'reject')}</button></div></section>}
  {item.capabilities.execute&&<form className={styles.form} onSubmit={execute}><h4>{pt(locale,'execute')}</h4><label>{pt(locale,'subjectId')}<input required autoComplete="off" value={subject} maxLength={120} onChange={event=>setSubject(event.target.value)}/></label><label className={styles.check}><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{pt(locale,'confirmation')}</label><button className="btn" type="submit" disabled={api.busy||api.conflict||!confirmed||subject!==item.subject.id}>{pt(locale,'execute')}</button></form>}
 </section>;
}

function PrivacyHolds({locale}:{locale:string}){
 const api=useControlledApi(locale),[items,setItems]=useState<PrivacyHoldDto[]>([]),[selected,setSelected]=useState<PrivacyHoldDto|null>(null),[editing,setEditing]=useState(false);
 const load=async()=>setItems((await api.request<{items:PrivacyHoldDto[]}>('/privacy/holds')).items);
 useEffect(()=>{void api.run(load);},[]);
 const changed=(item:PrivacyHoldDto)=>{setItems(current=>[item,...current.filter(entry=>entry.id!==item.id)]);setSelected(item);setEditing(true);};
 return <section className={styles.card}><header className={styles.header}><div><h3>{pt(locale,'holds')}</h3><p>{pt(locale,'holdHint')}</p></div><div className={styles.row}><button className="btn" type="button" disabled={api.busy} onClick={()=>void api.run(load)}>{c(locale,'refresh')}</button><button className="btn" type="button" onClick={()=>{setSelected(null);setEditing(true);}}>{c(locale,'create')}</button></div></header>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  <div className={styles.split}><div className={styles.list}>{items.length===0&&<p>{c(locale,'empty')}</p>}{items.map(item=><button className={styles.choice} key={item.id} type="button" onClick={()=>{setSelected(item);setEditing(true);}}><span className={styles.code}>{item.subject.id}</span><strong>{pt(locale,item.active?'active':'inactive')}</strong><span>{item.reason}</span><span>{c(locale,'expires')}: {new Date(item.expiresAt).toLocaleString(locale)}</span></button>)}</div>{editing&&<PrivacyHoldEditor key={selected?selected.id+':'+selected.version:'new'} item={selected} locale={locale} onChange={changed}/>}</div>
 </section>;
}

function PrivacyHoldEditor({item,locale,onChange}:{item:PrivacyHoldDto|null;locale:string;onChange:(item:PrivacyHoldDto)=>void}){
 const api=useControlledApi(locale),[type,setType]=useState<PrivacySubjectDto['type']>(item?.subject.type||'user'),[id,setId]=useState(item?.subject.id||''),[reason,setReason]=useState(''),[expires,setExpires]=useState(item?localDateInput(item.expiresAt):'');
 const save=(event:FormEvent)=>{event.preventDefault();void api.run(async()=>{
  if(!validReason(reason))throw new Error(pt(locale,'invalidReason'));
  const value={reason:reason.trim(),expiresAt:isoDateInput(expires)};
  onChange(await api.request<PrivacyHoldDto>(item?`/privacy/holds/${item.id}`:'/privacy/holds',{method:item?'PATCH':'POST',...(item?{headers:{'If-Match':String(item.version)}}:{}),body:JSON.stringify(item?value:{...value,subject:{type,id:id.trim()}})}));
 });};
 const release=()=>void api.run(async()=>{if(!item||!validReason(reason))return;onChange(await api.request<PrivacyHoldDto>(`/privacy/holds/${item.id}`,{method:'DELETE',headers:{'If-Match':String(item.version)},body:JSON.stringify({reason:reason.trim()})}));});
 return <form className={styles.form} onSubmit={save}>
  <h4>{item?c(locale,'edit'):c(locale,'create')}</h4>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}{api.conflict&&<p className={styles.notice}>{c(locale,'conflict')}</p>}
  <label>{pt(locale,'subject')}<select value={type} disabled={!!item} onChange={event=>setType(event.target.value as PrivacySubjectDto['type'])}><option value="user">{pt(locale,'user')}</option><option value="crm-contact">{pt(locale,'contact')}</option></select></label>
  <label>{pt(locale,'subjectId')}<input required readOnly={!!item} autoComplete="off" maxLength={120} value={id} onChange={event=>setId(event.target.value)}/></label>
  {item&&<><p>{item.reason}</p><p>{c(locale,'version')}: {item.version}</p></>}
  <label>{c(locale,'expires')}<input type="datetime-local" required disabled={!!item?.revokedAt} value={expires} onChange={event=>setExpires(event.target.value)}/></label>
  {item?.releaseReason&&<p>{pt(locale,'release')}: {item.releaseReason}</p>}
  {!item?.revokedAt&&<><label>{c(locale,'reason')}<input minLength={3} maxLength={2000} required value={reason} onChange={event=>setReason(event.target.value)}/></label><p className={styles.muted}>{pt(locale,'caseHint')}</p><div className={styles.row}><button type="submit" className="btn btn-primary" disabled={api.busy||api.conflict||!validReason(reason)||!expires||!id.trim()}>{c(locale,'save')}</button>{item&&<button className="btn" type="button" disabled={api.busy||api.conflict||!validReason(reason)} onClick={release}>{pt(locale,'release')}</button>}</div></>}
 </form>;
}
