'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {CertificateDefinition,CertificateSourceCandidate,ManagedCompanyCertificate} from '@/types/company-certificates';
import type {WorkspaceStore} from '@/components/workspace/store';
import {c,contentLocale,uiLocales} from '@/components/controlled/copy';
import {downloadControlledBlob,useControlledApi} from '@/components/controlled/useControlledApi';
import styles from '@/components/controlled/controlled.module.css';
import {ct} from './certificate-copy';
import {certificateDate,certificateFilename,completeCertificate,emptyCertificate} from './certificate-ui';

type ManagementList={items:ManagedCompanyCertificate[];canCreate:boolean};
export default function CompanyCertificatePanel({store}:{store:WorkspaceStore}){return <Registry key={JSON.stringify([store.actorId,store.role,store.locale,store.actor])} store={store}/>;}
function Registry({store}:{store:WorkspaceStore}){
 const {locale}=store,languages=uiLocales.filter(value=>store.actor.allowedLocales?.includes(value));
 const [language,setLanguage]=useState(languages.includes(contentLocale(locale))?contentLocale(locale):languages[0]||contentLocale(locale));
 return <section className={styles.panel} id="company-certificate-registry" data-certificate-management><h2>{ct(locale,'registry')}</h2><p>{ct(locale,'draftHint')}</p><div className={styles.form}><label>{c(locale,'locale')}<select value={language} onChange={event=>setLanguage(contentLocale(event.target.value))}>{languages.map(value=><option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label></div>{languages.length>0&&<RegistryLanguage key={language} store={store} language={language}/>}</section>;
}
function RegistryLanguage({store,language}:{store:WorkspaceStore;language:ReturnType<typeof contentLocale>}){
 const {locale}=store,api=useControlledApi(locale),[data,setData]=useState<ManagementList|null>(null),[sources,setSources]=useState<CertificateSourceCandidate[]>([]),[selected,setSelected]=useState<ManagedCompanyCertificate|null>(null),[creating,setCreating]=useState(false),linked=useRef(false);
 const load=async()=>{const result=await api.request<ManagementList>(`/company-certificates?locale=${language}&manage=true`);setData(result);if(!linked.current){linked.current=true;const id=new URLSearchParams(window.location.search).get('certificate');const item=result.items.find(value=>value.id===id);if(item)setSelected(item);}setSources((await api.request<{items:CertificateSourceCandidate[]}>(`/company-certificates/sources?locale=${language}`)).items);};
 useEffect(()=>{void api.run(load);},[]);
 const saved=(item:ManagedCompanyCertificate)=>{setSelected(item);setCreating(false);setData(current=>current?{...current,items:[item,...current.items.filter(value=>value.id!==item.id)]}:null);};
 return <div className={styles.list}><header className={styles.header}><p>{ct(locale,'sourceHelp')}</p><button className="btn" type="button" disabled={api.busy} onClick={()=>void api.run(load)}>{c(locale,'refresh')}</button></header>{api.error&&<p className={styles.error} role="alert">{api.error}</p>}{!data&&!api.error&&<p role="status">{c(locale,'loading')}</p>}
  {data&&<div className={styles.split}><div className={styles.list}>{data.canCreate&&<button className="btn btn-primary" type="button" onClick={()=>{setSelected(null);setCreating(true);}}>{c(locale,'create')}</button>}{!data.items.length&&<p>{c(locale,'empty')}</p>}{data.items.map(item=><button className={styles.choice} key={item.id} type="button" aria-pressed={selected?.id===item.id} onClick={()=>{setSelected(item);setCreating(false);}}><strong>{item.draft?.title||item.published?.title||item.slug}</strong><span>{c(locale,'version')}: {item.version} · {language.toUpperCase()}</span><span>{item.archived?ct(locale,'archived'):item.revokedAt?ct(locale,'revoked'):item.published?ct(locale,item.published.status):ct(locale,'draft')}</span></button>)}</div>{(selected||creating)&&<CertificateEditor key={selected?selected.id+':'+selected.version:'new'} initial={selected} sources={sources} locale={locale} language={language} saved={saved} refresh={load}/>}</div>}
 </div>;
}
function CertificateEditor({initial,sources,locale,language,saved,refresh}:{initial:ManagedCompanyCertificate|null;sources:CertificateSourceCandidate[];locale:string;language:ReturnType<typeof contentLocale>;saved:(item:ManagedCompanyCertificate)=>void;refresh:()=>Promise<void>}){
 const api=useControlledApi(locale),[definition,setDefinition]=useState<CertificateDefinition>(initial?.draft||emptyCertificate()),[slug,setSlug]=useState(initial?.slug||''),[reason,setReason]=useState(''),[globalConfirmed,setGlobalConfirmed]=useState(false),[notice,setNotice]=useState('');
 const set=<K extends keyof CertificateDefinition>(key:K,value:CertificateDefinition[K])=>setDefinition(current=>({...current,[key]:value}));
 const selectedSource=definition.resourceId&&definition.resourceVersionId?definition.resourceId+':'+definition.resourceVersionId:'';
 const source=sources.find(value=>value.resourceId===definition.resourceId&&value.versionId===definition.resourceVersionId);
 const dirty=JSON.stringify(definition)!==JSON.stringify(initial?.draft||emptyCertificate());
 const revision=initial?.revisions.find(value=>value.id===initial.draftRevisionId);
 const canEdit=!initial||initial.capabilities.edit;
 const complete=completeCertificate(definition)&&!!source;
 const submit=(event:FormEvent)=>{event.preventDefault();void api.run(async()=>{const result=await api.request<ManagedCompanyCertificate>(initial?`/company-certificates/${initial.id}`:'/company-certificates',{method:initial?'PUT':'POST',body:JSON.stringify(initial?{locale:language,expectedVersion:initial.version,definition}:{slug,locale:language,definition})});setNotice(ct(locale,'saved'));saved(result);});};
 const command=(action:'review'|'publish'|'withdraw'|'revoke'|'state',extra:Record<string,unknown>={})=>void api.run(async()=>{if(!initial)return;const result=await api.request<ManagedCompanyCertificate>(`/company-certificates/${initial.id}/${action}`,{method:'POST',body:JSON.stringify({locale:language,expectedVersion:initial.version,...extra})});saved(result);});
 const downloadSource=()=>void api.run(async()=>{if(!source)return;const blob=await api.blob(`/resources/${source.resourceId}/versions/${source.versionId}/content?action=download`);downloadControlledBlob(blob,certificateFilename(slug||'certificate',source.locale,blob.type));});
 return <section className={styles.card}>
  <header className={styles.header}><h3>{ct(locale,'draft')} · {language.toUpperCase()}</h3>{initial&&<span className={styles.badge}>{c(locale,'version')} {initial.version}</span>}</header>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}{notice&&<p className={styles.notice} role="status">{notice}</p>}{api.conflict&&<div className={styles.notice}><p>{c(locale,'conflict')}</p><button className="btn" type="button" disabled={api.busy} onClick={()=>void api.run(refresh)}>{c(locale,'refresh')}</button></div>}
  <p className={styles.muted}>{ct(locale,'incomplete')}</p>
  <form className={styles.form} onSubmit={submit}><fieldset disabled={!canEdit||api.busy||api.conflict} style={{border:0,padding:0,display:'grid',gap:'1rem',minWidth:0}}>
   {!initial&&<label>{c(locale,'slug')}<input required dir="ltr" minLength={2} maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={event=>setSlug(event.target.value)}/></label>}
   <label>{c(locale,'title')}<input lang={language} dir={language==='fa'||language==='ar'?'rtl':'ltr'} maxLength={240} value={definition.title} onChange={event=>set('title',event.target.value)}/></label>
   <label>{c(locale,'summary')}<textarea lang={language} dir={language==='fa'||language==='ar'?'rtl':'ltr'} maxLength={5000} value={definition.summary} onChange={event=>set('summary',event.target.value)}/></label>
   <div className={styles.grid}><label>{ct(locale,'issuer')}<input maxLength={240} value={definition.issuer} onChange={event=>set('issuer',event.target.value)}/></label><label>{ct(locale,'number')}<input maxLength={200} value={definition.certificateNumber} onChange={event=>set('certificateNumber',event.target.value)}/></label><label>{ct(locale,'standard')}<input maxLength={240} value={definition.standard} onChange={event=>set('standard',event.target.value)}/></label></div>
   <div className={styles.grid}><label>{ct(locale,'validFrom')}<input type="date" value={definition.validFrom} onChange={event=>set('validFrom',event.target.value)}/></label><label>{ct(locale,'validUntil')}<input type="date" value={definition.validUntil} onChange={event=>set('validUntil',event.target.value)}/></label></div>
   <label>{ct(locale,'issuerUrl')}<input type="url" dir="ltr" maxLength={2000} value={definition.issuerUrl} onChange={event=>set('issuerUrl',event.target.value)}/></label>
   <label>{ct(locale,'source')}<select value={selectedSource} onChange={event=>{const candidate=sources.find(value=>value.resourceId+':'+value.versionId===event.target.value);setDefinition(current=>({...current,resourceId:candidate?.resourceId||null,resourceVersionId:candidate?.versionId||null}));}}><option value="">{ct(locale,'noSource')}</option>{selectedSource&&!source&&<option value={selectedSource}>{ct(locale,'staleSource')}</option>}{sources.map(value=><option key={value.resourceId+':'+value.versionId} value={value.resourceId+':'+value.versionId}>{value.title} · {value.label} · {value.locale.toUpperCase()}</option>)}</select></label>
   <p className={styles.muted}>{ct(locale,'sourceLanguageHelp')}</p>
   <button className="btn btn-primary" type="submit">{c(locale,'save')}</button>
  </fieldset></form>
  {source&&<div className={styles.list}><p>{ct(locale,'sourceLocale')}: {source.locale.toUpperCase()}</p><p className={styles.code}>SHA-256 {source.sha256}</p><button className="btn" type="button" disabled={api.busy} onClick={downloadSource}>{c(locale,'download')}</button></div>}
  {initial&&<>
   {dirty&&<p className={styles.notice}>{ct(locale,'unsaved')}</p>}
   <section className={styles.form}><h4>{ct(locale,'review')}</h4><label>{c(locale,'reason')}<textarea minLength={10} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
    <div className={styles.row}>
     {initial.capabilities.review&&initial.draftRevisionId&&<><button className="btn" type="button" disabled={api.busy||api.conflict||dirty||!complete} onClick={()=>command('review',{decision:'approved',...(reason.trim()?{reason:reason.trim()}:{})})}>{c(locale,'approve')}</button><button className="btn" type="button" disabled={api.busy||api.conflict||dirty||reason.trim().length<10} onClick={()=>command('review',{decision:'rejected',reason:reason.trim()})}>{c(locale,'reject')}</button></>}
     {initial.capabilities.publish&&<button className="btn btn-primary" type="button" disabled={api.busy||api.conflict||dirty||!complete||revision?.review?.decision!=='approved'} onClick={()=>command('publish')}>{c(locale,'publish')}</button>}
     {initial.capabilities.publish&&initial.published&&<button className="btn" type="button" disabled={api.busy||api.conflict||dirty||reason.trim().length<10} onClick={()=>command('withdraw',{reason:reason.trim()})}>{ct(locale,'withdraw')}</button>}
    </div>
    {(initial.capabilities.revoke||initial.capabilities.archive)&&<div className={styles.card}><p>{ct(locale,'global')}</p><label className={styles.check}><input type="checkbox" checked={globalConfirmed} onChange={event=>setGlobalConfirmed(event.target.checked)}/>{ct(locale,'confirmGlobal')}</label><div className={styles.row}>{initial.capabilities.revoke&&!initial.revokedAt&&<button className="btn" type="button" disabled={api.busy||api.conflict||dirty||!globalConfirmed||reason.trim().length<10} onClick={()=>command('revoke',{reason:reason.trim()})}>{ct(locale,'revoke')}</button>}{initial.capabilities.archive&&<button className="btn" type="button" disabled={api.busy||api.conflict||dirty||!globalConfirmed||reason.trim().length<10} onClick={()=>command('state',{archived:!initial.archived,reason:reason.trim()})}>{c(locale,initial.archived?'restore':'archive')}</button>}</div></div>}
   </section>
   {initial.published&&<section className={styles.card}><h4>{ct(locale,'published')}</h4><strong>{initial.published.title}</strong><span className={styles.badge}>{ct(locale,initial.published.status)}</span><p>{ct(locale,'validUntil')}: {certificateDate(initial.published.validUntil,locale)}</p><p className={styles.code}>{initial.published.revisionId}</p></section>}
   <details><summary>{c(locale,'history')}</summary><div className={styles.list}>{initial.revisions.map(value=><section className={styles.card} key={value.id}><h4>{value.number} · {value.definition.title}</h4><p>{new Date(value.createdAt).toLocaleString(locale)}</p>{value.review?<><span className={styles.badge}>{ct(locale,value.review.decision)}</span><p>{ct(locale,'reviewer')}: {value.review.reviewerName} · {new Date(value.review.reviewedAt).toLocaleString(locale)}</p></>:<span className={styles.badge}>{ct(locale,'draft')}</span>}<details><summary>{ct(locale,'source')} / {ct(locale,'standard')}</summary><dl><dt>{ct(locale,'issuer')}</dt><dd>{value.definition.issuer}</dd><dt>{ct(locale,'number')}</dt><dd>{value.definition.certificateNumber}</dd><dt>{ct(locale,'standard')}</dt><dd>{value.definition.standard}</dd><dt>{ct(locale,'validFrom')}</dt><dd>{value.definition.validFrom}</dd><dt>{ct(locale,'validUntil')}</dt><dd>{value.definition.validUntil}</dd><dt>{ct(locale,'source')}</dt><dd className={styles.code}>{value.definition.resourceId} / {value.definition.resourceVersionId}</dd></dl></details></section>)}</div></details>
  </>}
 </section>;
}
