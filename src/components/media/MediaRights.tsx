'use client';
import {useState,type FormEvent} from 'react';
import type {DamAssetDetails,MediaRightsPolicy} from '@/types/dam';
import {c} from '@/components/controlled/copy';
import {isoDateInput,localDateInput,useControlledApi} from '@/components/controlled/useControlledApi';
import styles from '@/components/controlled/controlled.module.css';
import {mt} from './media-copy';

export default function MediaRights({details,locale,permitted,onSaved}:{details:DamAssetDetails;locale:string;permitted:boolean;onSaved:(result:{policy:MediaRightsPolicy;effectiveRights:boolean})=>Promise<void>}){
 const api=useControlledApi(locale),[base,setBase]=useState(details.policy),[rights,setRights]=useState(details.policy.rightsConfirmed),[expires,setExpires]=useState(details.policy.rightsExpiresAt?localDateInput(details.policy.rightsExpiresAt):''),[license,setLicense]=useState(details.policy.licenseNote),[saved,setSaved]=useState(false);
 const selectFresh=()=>{setBase(details.policy);setRights(details.policy.rightsConfirmed);setExpires(details.policy.rightsExpiresAt?localDateInput(details.policy.rightsExpiresAt):'');setLicense(details.policy.licenseNote);setSaved(false);api.reset();};
 const save=(event:FormEvent)=>{event.preventDefault();void api.run(async()=>{const result=await api.request<{policy:MediaRightsPolicy;effectiveRights:boolean}>(`/media/${details.id}/rights`,{method:'PUT',headers:{'If-Match':String(base.version)},body:JSON.stringify({rightsConfirmed:rights,rightsExpiresAt:expires?isoDateInput(expires):null,licenseNote:license})});setBase(result.policy);setSaved(true);await onSaved(result);});};
 return <section className={styles.card}>
  <header className={styles.header}><h3>{mt(locale,'policy')}</h3><span>{c(locale,'version')} {base.version}</span></header><p>{mt(locale,'effective')}: <strong>{c(locale,details.effectiveRights?'yes':'no')}</strong></p><p className={styles.muted}>{mt(locale,'policyHint')}</p>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}{api.conflict&&<p className={styles.notice}>{c(locale,'conflict')}</p>}{saved&&<p role="status">{c(locale,'confirmed')}</p>}
  {base.version!==details.policy.version&&<div className={styles.notice}><p>{c(locale,'version')} {details.policy.version}</p><button className="btn" type="button" disabled={api.busy} onClick={selectFresh}>{mt(locale,'selectFresh')}</button></div>}
  <form className={styles.form} onSubmit={save}><fieldset disabled={!permitted||!details.canManage||api.busy||api.conflict} style={{border:0,padding:0,minWidth:0,display:'grid',gap:'1rem'}}><label className={styles.check}><input type="checkbox" checked={rights} onChange={event=>{setRights(event.target.checked);setSaved(false);}}/>{mt(locale,'rights')}</label><label>{c(locale,'expires')}<input type="datetime-local" value={expires} onChange={event=>{setExpires(event.target.value);setSaved(false);}}/></label><label>{mt(locale,'license')}<textarea maxLength={2000} value={license} onChange={event=>{setLicense(event.target.value);setSaved(false);}}/></label><button type="submit" className="btn btn-primary">{c(locale,'save')}</button></fieldset></form>
  {api.conflict&&base.version===details.policy.version&&<button className="btn" type="button" onClick={selectFresh}>{mt(locale,'selectFresh')}</button>}
 </section>;
}
