'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {FileCheck2,ShieldCheck} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import type {PublicCompanyCertificate} from '@/types/company-certificates';
import {c} from '@/components/controlled/copy';
import {controlledAccountKey,downloadControlledBlob,useControlledApi} from '@/components/controlled/useControlledApi';
import styles from '@/components/controlled/controlled.module.css';
import {ct} from './certificate-copy';
import {certificateDate,certificateFilename,certificateIssuerUrl} from './certificate-ui';

export default function CompanyCertificates(){const{locale,session,sessionReady}=useApp();if(!sessionReady)return <p role="status">{c(locale,'loading')}</p>;return <PublishedCertificates key={controlledAccountKey(session,locale)}/>;}
function PublishedCertificates(){
 const {locale,href}=useApp(),api=useControlledApi(locale),[items,setItems]=useState<PublicCompanyCertificate[]|null>(null),sequence=useRef(0);
 const load=async()=>{const current=++sequence.current,result=await api.request<{items:PublicCompanyCertificate[]}>(`/company-certificates?locale=${locale}`);if(current===sequence.current)setItems(result.items);};
 useEffect(()=>{void api.run(load);const refresh=()=>{if(document.visibilityState==='visible')void api.run(load);};const timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);return()=>{sequence.current++;clearInterval(timer);window.removeEventListener('focus',refresh);};},[]);
 const download=(item:PublicCompanyCertificate)=>void api.run(async()=>{const source=item.source;if(!source)return;const blob=await api.blob(`/resources/${encodeURIComponent(source.resourceId)}/versions/${encodeURIComponent(source.versionId)}/content?action=download`);downloadControlledBlob(blob,certificateFilename(item.slug,source.locale,blob.type));});
 return <section className={`${styles.panel} glass content-company-document`} aria-label={ct(locale,'heading')} data-company-certificates>
  <header className={styles.header}><div><ShieldCheck size={28}/><h2>{ct(locale,'heading')}</h2><p>{ct(locale,'publicIntro')}</p></div><button className="btn" type="button" disabled={api.busy} onClick={()=>void api.run(load)}>{c(locale,'refresh')}</button></header>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  {items===null&&!api.error&&<p role="status">{c(locale,'loading')}</p>}
  {items?.length===0&&<div className={styles.list}><p>{ct(locale,'empty')}</p><Link className="btn" href={href('contact')}>{ct(locale,'contact')}</Link></div>}
  <div className={styles.grid}>{items?.map(item=>{const issuerUrl=certificateIssuerUrl(item.issuerUrl);return <article key={item.id} className={styles.card} data-certificate-status={item.status}>
   <header className={styles.header}><FileCheck2 size={22}/><span className={styles.badge}>{ct(locale,item.status)}</span></header><h3 lang={item.locale}>{item.title}</h3><p>{item.summary}</p>
   <dl><dt>{ct(locale,'issuer')}</dt><dd>{item.issuer}</dd><dt>{ct(locale,'number')}</dt><dd><bdi>{item.certificateNumber}</bdi></dd><dt>{ct(locale,'standard')}</dt><dd>{item.standard}</dd><dt>{ct(locale,'validFrom')}</dt><dd><time dateTime={item.validFrom}>{certificateDate(item.validFrom,locale)}</time></dd><dt>{ct(locale,'validUntil')}</dt><dd><time dateTime={item.validUntil}>{certificateDate(item.validUntil,locale)}</time></dd></dl>
   {issuerUrl&&<a className="btn" href={issuerUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{ct(locale,'issuerLink')}</a>}
   {item.source?<div className={styles.list}><p>{ct(locale,'source')}: {item.source.label}</p><p>{ct(locale,'sourceLocale')}: <bdi>{item.source.locale.toUpperCase()}</bdi></p><details><summary>SHA-256</summary><code className={styles.code}>{item.source.sha256}</code></details><button className="btn" type="button" disabled={api.busy} onClick={()=>download(item)}>{ct(locale,'documentDownload')}</button></div>:<p className={styles.notice}>{ct(locale,'source-unavailable')}</p>}
  </article>;})}</div>
 </section>;
}
