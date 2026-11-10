'use client';

import {apiClient,demoMode,networkError} from '@/lib/api';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, AudioLines, CheckCircle2, Clipboard, Download, FileText, Image as ImageIcon, Languages, Loader2, Plus, Save, Sparkles, UploadCloud, Video, WandSparkles, X, Link2, ShieldCheck, Trash2, Eye } from 'lucide-react';
import { WorkspaceMedia, recordText } from '@/data/workspace-seed';
import { WorkspaceStore, canEdit, downloadFile, now, uid } from './store';
import { L, WorkspaceLocale, localized, workspaceLocales, wt } from './i18n';
import { Empty, Field, Modal, SearchInput, Status, safeDate } from './ui';
import ProductionMediaLibrary from '@/components/media/ProductionMediaLibrary';

export { ContentStudio } from './AiStudio';

export function MediaLibrary({ store }: { store: WorkspaceStore }) {
  return demoMode ? <DemoMediaLibrary store={store}/> : <ProductionMediaLibrary store={store}/>;
}

function DemoMediaLibrary({ store }: { store: WorkspaceStore }) {
  const { state, locale } = store;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading,setUploading]=useState(false);const [uploadRights,setUploadRights]=useState(false);const [drafts,setDrafts]=useState<Record<string,WorkspaceMedia>>({});const [scans,setScans]=useState<Record<string,string>>({});
  const allowed = !uploading&&canEdit(store.role, 'media');
  const baseAsset=state.media.find(media=>media.id===selected);const asset=baseAsset?(drafts[baseAsset.id]||baseAsset):undefined;
  useEffect(()=>{if(demoMode)return;const pending=Object.values(scans).some(status=>status==='pending');const refresh=()=>apiClient.request<{items:{id:string;scanStatus:string}[]}|{id:string;scanStatus:string}[]>('/media').then(result=>setScans(Object.fromEntries((Array.isArray(result)?result:result.items||[]).map(item=>[item.id,item.scanStatus])))).catch(()=>{});void refresh();if(!pending)return;const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[Object.values(scans).filter(status=>status==='pending').length]);
  const visible = state.media.filter(media => (filter === 'all' || media.type === filter) && `${media.title} ${media.filename}`.toLowerCase().includes(query.toLowerCase()));
  const upload=async(file:File)=>{
    if(!store.permit('create','media')||uploading)return;
    if(!demoMode&&!uploadRights){store.notify(wt('rights',locale));return;}
    if(file.size>(demoMode?2:20)*1024*1024||!/^(image\/(png|jpeg|webp|avif)|video\/(mp4|webm)|audio\/(mpeg|wav|mp4|ogg)|application\/pdf)$/.test(file.type)){store.notify(wt('uploadError',locale));return;}
    setUploading(true);
    try{
      let id=uid('MEDIA'),url='',scanStatus='clean';
      if(demoMode)url=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});
      else{const body=new FormData();body.set('file',file);body.set('rights','true');body.set('visibility','public');const response=await apiClient.request<{id:string;url:string;scanStatus:string}>('/media',{method:'POST',body});id=response.id;url=response.url;scanStatus=response.scanStatus;setScans(previous=>({...previous,[id]:scanStatus}));}
      const type=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'document';
      const media:WorkspaceMedia={id,title:file.name,filename:file.name,type,url,size:file.size,usage:[],rights:!demoMode&&uploadRights,focalX:50,focalY:50};
      if(await store.update(previous=>({...previous,media:[media,...previous.media]}),wt('saved',locale)))setSelected(media.id);
    }catch(error){store.notify(networkError(error,locale));}finally{setUploading(false);}
  };
  const patch=(data:Partial<WorkspaceMedia>)=>{if(asset&&allowed)setDrafts(previous=>({...previous,[asset.id]:{...asset,...data}}));};
  const save=async()=>{if(!asset||!allowed)return;if(await store.update(previous=>({...previous,media:previous.media.map(media=>media.id===asset.id?asset:media)}),wt('saved',locale)))setDrafts(previous=>{if(previous[asset.id]!==asset)return previous;const next={...previous};delete next[asset.id];return next;});};
  const remove=async(media:WorkspaceMedia)=>{
    if(media.usage.length||state.pages.some(page=>page.blocks.some(block=>block.mediaUrl===media.url))){store.notify(wt('usedAsset',locale));return;}
    try{if(!demoMode){await apiClient.request(`/media/${encodeURIComponent(media.id)}`,{method:'DELETE'});await store.refresh();if(store.getState().media.some(item=>item.id===media.id)&&!await store.update(previous=>({...previous,media:previous.media.filter(item=>item.id!==media.id)})))return;}else if(!await store.update(previous=>({...previous,media:previous.media.filter(item=>item.id!==media.id)}),wt('saved',locale)))return;setSelected(null);store.notify(wt('saved',locale));}catch(error){store.notify(networkError(error,locale));}
  };
  return <div><div className="ws-toolbar"><SearchInput value={query} onChange={setQuery} locale={locale}/><div className="ws-toolbar-end"><span className="ws-muted"><bdi>{visible.length}</bdi> {wt('records', locale)}</span>{allowed && <button className="btn btn-primary ws-small-btn" onClick={() => fileRef.current?.click()}><UploadCloud size={17}/>{wt('upload', locale)}</button>}<input ref={fileRef} hidden type="file" accept="image/*,video/*,audio/*,application/pdf" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ''; }}/></div></div>{!demoMode&&<label className="ws-checkbox-label"><input type="checkbox" checked={uploadRights} onChange={event=>setUploadRights(event.target.checked)}/>{wt('rights',locale)}</label>}{uploading&&<p role="status"><Loader2 size={18}/>{wt('upload',locale)}…</p>}<div className="ws-filter-row">{['all', 'image', 'video', 'audio', 'document'].map(type => <button key={type} className={filter === type ? 'active' : ''} onClick={() => setFilter(type)}>{wt(type, locale)}</button>)}</div>
    <div className="ws-upload-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file && allowed) void upload(file); }}><UploadCloud size={22}/><div><strong>{wt('upload', locale)}</strong><p>{demoMode?wt('uploadHint',locale):'PNG · JPEG · WebP · AVIF · PDF · MP4 · WebM · MP3 · WAV — 20 MB'}</p></div><button className="btn ws-small-btn" disabled={!allowed} onClick={() => fileRef.current?.click()}><Plus size={17}/>{wt('create', locale)}</button></div>
    <div className="ws-media-grid">{visible.map(media => <article key={media.id} className="ws-card ws-media-card"><button className="ws-media-thumb" onClick={() => setSelected(media.id)} aria-label={media.title}>{scans[media.id]==='pending'?<Loader2 size={32}/>:media.type === 'image' ? <img src={media.url} alt={media.title} style={{ objectPosition: `${media.focalX}% ${media.focalY}%` }}/> : media.type === 'video' ? <Video size={40}/> : media.type === 'audio' ? <AudioLines size={40}/> : <FileText size={40}/>}<span>{wt(media.type, locale)}</span></button><div className="ws-media-info"><strong>{media.title}</strong><p><bdi>{media.size ? (media.size / 1024).toFixed(0) + ' KB' : media.filename}</bdi></p><div className="ws-flex-between"><span><Link2 size={12}/>{media.usage.length} {wt('usage', locale)}</span><button className="ws-icon-button" aria-label={wt('edit', locale)} onClick={() => setSelected(media.id)}><ArrowUpRight size={16}/></button></div></div></article>)}</div>{!visible.length && <Empty locale={locale}/>}
    {asset && <Modal title={wt('media', locale)} onClose={() => setSelected(null)} wide><div className="ws-asset-editor"><div className="ws-asset-preview">{scans[asset.id]==='pending'?<p role="status">{localized(L('در حال بررسی امنیت فایل…','Checking file security…','Dosya güvenliği kontrol ediliyor…','جارٍ فحص أمان الملف…','Проверка безопасности файла…'),locale)}</p>:asset.type === 'image' ? <img src={asset.url} alt={asset.title} style={{ objectPosition: `${asset.focalX}% ${asset.focalY}%` }}/> : asset.type === 'video' ? <video src={asset.url} controls/> : asset.type === 'audio' ? <audio src={asset.url} controls/> : <FileText size={70}/>}</div><div className="ws-asset-fields"><Field label={wt('title', locale)}><input className="input" value={asset.title} disabled={!allowed} onChange={e => patch({ title: e.target.value })}/></Field><Field label={wt('type', locale)}><span>{wt(asset.type, locale)}</span></Field>{asset.type === 'image' && <><Field label={localized(L('نقطه تمرکز افقی','Horizontal focal point','Yatay odak noktası','نقطة التركيز الأفقية','Горизонтальная фокусная точка'), locale)}><input type="range" disabled={!allowed} min="0" max="100" value={asset.focalX} onChange={e => patch({ focalX: Number(e.target.value) })}/></Field><Field label={localized(L('نقطه تمرکز عمودی','Vertical focal point','Dikey odak noktası','نقطة التركيز الرأسية','Вертикальная фокусная точка'), locale)}><input type="range" disabled={!allowed} min="0" max="100" value={asset.focalY} onChange={e => patch({ focalY: Number(e.target.value) })}/></Field></>}<label className="ws-checkbox-label"><input type="checkbox" disabled={!allowed} checked={asset.rights} onChange={e => patch({ rights: e.target.checked })}/>{wt('rights', locale)}</label><h4>{wt('usage', locale)}</h4><div className="ws-asset-usage">{asset.usage.length ? asset.usage.map(id => <span key={id}><Link2 size={13}/><bdi>{id}</bdi></span>) : <span>—</span>}</div><div className="ws-detail-actions"><button className="btn btn-primary ws-small-btn" disabled={!allowed||!drafts[asset.id]||store.pending} onClick={save}><Save size={16}/>{wt('save',locale)}</button><a className="btn ws-small-btn" href={asset.url} download={asset.filename} target="_blank" rel="noreferrer"><Download size={15}/>{wt('exportJson', locale)}</a>{allowed && <button className="btn ws-small-btn" onClick={() => remove(asset)}><Trash2 size={15}/>{wt('delete', locale)}</button>}</div>{asset.sourceUrl && <a className="ws-source-link" href={asset.sourceUrl} target="_blank" rel="noreferrer"><ShieldCheck size={15}/>{wt('source', locale)}</a>}</div></div></Modal>}
  </div>;
}
