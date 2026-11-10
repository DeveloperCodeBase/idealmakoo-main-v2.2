'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import Link from 'next/link';
import {Download,FileText,RefreshCw,X} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import type {ResourceDto,ResourceVersion} from '@/types/resources';
import {c,text} from '@/components/controlled/copy';
import {controlledAccountKey,downloadControlledBlob,useControlledApi} from '@/components/controlled/useControlledApi';
import {resourceText as rt} from './resource-copy';
import styles from '@/components/controlled/controlled.module.css';

export default function ControlledResources({slug,roomId}:{slug?:string;roomId?:string}){
 const {locale,session,sessionReady}=useApp();
 if(!sessionReady)return <DirectoryShell locale={locale} busy loading><DirectoryLoadingState locale={locale}/><div className={styles.grid}/></DirectoryShell>;
 return <Directory key={controlledAccountKey(session,locale)+':'+slug+':'+roomId} slug={slug} roomId={roomId}/>;
}
function DirectoryShell({locale,busy,loading=false,onRefresh,children}:{locale:string;busy:boolean;loading?:boolean;onRefresh?:()=>void;children:ReactNode}){
 const title=text(locale,['اسناد منتشرشده و کنترل‌شده','Published controlled documents','Yayımlanmış kontrollü belgeler','الوثائق المنشورة المعتمدة','Опубликованные управляемые документы']);
 return <section className={styles.panel} aria-label={title} aria-busy={loading||undefined} data-controlled-resources>
  <header className={styles.header}><div><h2>{title}</h2><p className={styles.muted}>{text(locale,['فقط نسخه‌هایی که هم‌اکنون مجوز مشاهده دارند نمایش داده می‌شوند. زبان واقعی فایل، نسخه و checksum کنار آن آمده است.','Only versions currently authorized for viewing are listed. Each file shows its actual language, version and checksum.','Yalnızca şu anda görüntüleme yetkisi bulunan sürümler listelenir; gerçek dosya dili, sürüm ve sağlama toplamı gösterilir.','تُعرض فقط النسخ المصرح بعرضها حاليًا، مع لغة الملف الفعلية وإصداره وبصمته.','Показаны только версии с текущим правом просмотра, их настоящий язык, версия и контрольная сумма.'])}</p></div><button type="button" className="btn" disabled={busy} onClick={onRefresh}><RefreshCw size={16}/>{c(locale,'refresh')}</button></header>
  {children}
 </section>;
}
function DirectoryLoadingState({locale}:{locale:string}){
 return <><label className={styles.form}>{c(locale,'search')}<input type="search" value="" maxLength={120} disabled readOnly/></label><div className={styles.resourceLoadingNotice}><p className={`${styles.notice} ${styles.resourceLoadingReserve}`} aria-hidden="true">{c(locale,'empty')}</p><p className={`${styles.notice} ${styles.resourceLoadingMessage}`} role="status">{c(locale,'loading')}</p></div></>;
}
function Directory({slug,roomId}:{slug?:string;roomId?:string}){
 const {locale,href}=useApp(),api=useControlledApi(locale),sequence=useRef(0);
 const [items,setItems]=useState<ResourceDto[]>([]),[ready,setReady]=useState(false),[query,setQuery]=useState(''),[selected,setSelected]=useState<string[]>([]);
 const [preview,setPreview]=useState<{url:string;title:string}|null>(null);
 const load=useCallback(async()=>{const current=++sequence.current;const result=slug?[await api.request<ResourceDto>(`/resources/${encodeURIComponent(slug)}?locale=${locale}`)]:(await api.request<{items:ResourceDto[]}>(`/resources?locale=${locale}${roomId?'&roomId='+encodeURIComponent(roomId):''}`)).items;if(api.alive()&&current===sequence.current){setItems(result);setSelected(old=>old.filter(id=>result.some(item=>item.id===id&&item.permissions.download&&item.currentVersion)));setReady(true);}},[slug,roomId,locale,api.request,api.alive]);
 useEffect(()=>{void api.run(load);const refresh=()=>void load().catch(api.fail);const timer=setInterval(refresh,60_000);window.addEventListener('focus',refresh);return()=>{sequence.current++;clearInterval(timer);window.removeEventListener('focus',refresh);};},[load,api.run,api.fail]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
 const open=(resource:ResourceDto,version:ResourceVersion,action:'view'|'download')=>void api.run(async()=>{const blob=await api.blob(`/resources/${encodeURIComponent(resource.id)}/versions/${encodeURIComponent(version.id)}/content?action=${action}`);if(action==='download')downloadControlledBlob(blob,version.filename);else setPreview({url:URL.createObjectURL(blob),title:resource.title+' — '+version.label});});
 const bundle=()=>void api.run(async()=>{const references=items.filter(item=>selected.includes(item.id)&&item.permissions.download&&item.currentVersion).map(item=>({resourceId:item.id,versionId:item.currentVersion!.id}));if(!references.length)return;const blob=await api.blob('/resources/bundle',{method:'POST',body:JSON.stringify({items:references,locale})});downloadControlledBlob(blob,'idealmakoo-documents.zip');setSelected([]);});
 const filtered=items.filter(item=>(item.title+' '+item.summary).toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
 return <DirectoryShell locale={locale} busy={api.busy} loading={!ready&&!api.error} onRefresh={()=>void api.run(load)}>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  {!ready&&!api.error&&<DirectoryLoadingState locale={locale}/>}
  {ready&&<label className={styles.form}>{c(locale,'search')}<input type="search" value={query} maxLength={120} onChange={event=>setQuery(event.target.value)}/></label>}
  {ready&&!filtered.length&&<p className={styles.notice}>{c(locale,'empty')}</p>}
  <div className={styles.grid}>{filtered.map(resource=>{const version=resource.currentVersion;return <article className={styles.card} key={resource.id}><div className={styles.row}><FileText size={20}/><span className={styles.badge}>{rt(locale,resource.type)}</span><span className={styles.badge}>{rt(locale,resource.visibility)}</span></div><h3>{slug||roomId?resource.title:<Link href={href('resources/'+resource.slug)}>{resource.title}</Link>}</h3><p>{resource.summary}</p>{version&&<><div className={styles.row}><span>{c(locale,'version')} {version.number}: {version.label}</span><span lang={version.locale}>{version.locale.toUpperCase()}</span><span>{new Intl.NumberFormat(locale).format(version.bytes)} B</span></div><p className={styles.code} dir="ltr">SHA-256 {version.sha256}</p>{version.rightsExpiresAt&&<p className={styles.muted}>{c(locale,'expires')}: {new Date(version.rightsExpiresAt).toLocaleString(locale)}</p>}<div className={styles.row}><button className="btn" type="button" disabled={api.busy||!resource.permissions.view} onClick={()=>open(resource,version,'view')}>{c(locale,'view')}</button><button className="btn" type="button" disabled={api.busy||!resource.permissions.download} onClick={()=>open(resource,version,'download')}><Download size={16}/>{c(locale,'download')}</button></div>{resource.permissions.download&&<label className={styles.row}><input type="checkbox" checked={selected.includes(resource.id)} disabled={api.busy||!selected.includes(resource.id)&&selected.length>=20} onChange={event=>setSelected(old=>event.target.checked?[...old,resource.id]:old.filter(id=>id!==resource.id))}/>{text(locale,['انتخاب برای ZIP؛ حداکثر ۲۰ فایل','Select for ZIP; at most 20 files','ZIP için seç; en çok 20 dosya','اختيار لحزمة ZIP؛ ٢٠ ملفًا كحد أقصى','Выбрать для ZIP; не более 20 файлов'])}</label>}</>}{slug&&resource.versions&&resource.versions.length>1&&<details><summary>{c(locale,'history')}</summary><div className={styles.list}>{resource.versions.map(previous=><div className={styles.row} key={previous.id}><span>{previous.label} · {previous.locale.toUpperCase()} · {previous.number}</span><button className="btn" type="button" disabled={api.busy||!resource.permissions.view} onClick={()=>open(resource,previous,'view')}>{c(locale,'view')}</button>{resource.permissions.download&&<button className="btn" disabled={api.busy} type="button" onClick={()=>open(resource,previous,'download')}>{c(locale,'download')}</button>}</div>)}</div></details>}</article>;})}</div>
  {selected.length>0&&<div className={styles.row}><button type="button" className="btn btn-primary" disabled={api.busy} onClick={bundle}><Download size={16}/>ZIP · {selected.length}</button><button className="btn" type="button" onClick={()=>setSelected([])}>{c(locale,'cancel')}</button></div>}
  {preview&&<section className={styles.card} aria-label={preview.title}><div className={styles.header}><h3>{preview.title}</h3><button className="btn" type="button" onClick={()=>setPreview(null)}><X size={16}/>{c(locale,'cancel')}</button></div><iframe className={styles.preview} src={preview.url} title={preview.title} sandbox="" referrerPolicy="no-referrer"/></section>}
 </DirectoryShell>;
}
