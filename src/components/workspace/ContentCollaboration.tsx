'use client';
import {useEffect,useRef,useState} from 'react';
import {Copy,Link2,LockKeyhole,RefreshCw,UnlockKeyhole} from 'lucide-react';
import {apiClient,networkError,demoMode} from '@/lib/api';
import {dropContentLease,holdContentLease} from '@/lib/content-lease-client';
import {acquireContentEditorIdentity,type ContentEditorIdentity} from '@/lib/content-editor-identity';
import type {ContentLease,ContentLeaseStatus,ContentPreview,ContentBucket} from '@/types/content-collaboration';
import type {WorkspaceStore} from './store';
import {L,localized,wt,type WorkspaceLocale} from './i18n';
export type LeaseState='loading'|'held'|'locked'|'expired'|'unavailable'|'readonly';
interface Props {store:WorkspaceStore;bucket:ContentBucket;id:string;sourceUpdatedAt:string;dirty:boolean;canEdit:boolean;locale?:WorkspaceLocale;onLeaseState?:(state:LeaseState)=>void}
const copy={
 collaboration:L('همکاری در ویرایش','Editing collaboration','Düzenleme iş birliği','التعاون في التحرير','Совместное редактирование'),
 held:L('این ویرایشگر قفل فعال دارد.','This editor holds the editing lease.','Düzenleme kilidi bu editördedir.','يمتلك هذا المحرر قفل التحرير.','Этот редактор удерживает блокировку.'),
 locked:L('صفحه در ویرایشگر دیگری قفل شده است.','Another editor holds the editing lease.','Başka bir editör düzenleme kilidini tutuyor.','يمتلك محرر آخر قفل التحرير.','Блокировку удерживает другой редактор.'),
 expires:L('زمان پایان قفل','Lease expires','Kilit süresi sonu','انتهاء القفل','Блокировка до'),
 acquire:L('تلاش برای گرفتن قفل','Try to acquire lease','Kilidi almayı dene','محاولة الحصول على القفل','Попробовать получить блокировку'),
 previews:L('پیش‌نمایش‌های ذخیره‌شده','Saved content previews','Kayıtlı içerik önizlemeleri','معاينات المحتوى المحفوظ','Предпросмотры сохранённого содержания'),
 savedOnly:L('پیش‌نمایش فقط نسخه ذخیره‌شده را نشان می‌دهد؛ تغییرات خود را ابتدا ذخیره کنید.','A preview shows saved content. Save your edits before creating a link.','Önizleme kayıtlı içeriği gösterir. Bağlantı oluşturmadan önce kaydedin.','تعرض المعاينة المحتوى المحفوظ؛ احفظ تعديلاتك قبل إنشاء رابط.','Предпросмотр показывает сохранённый текст. Сначала сохраните изменения.'),
 privacy:L('هر دارندهٔ این لینک تا زمان انقضا می‌تواند پیش‌نمایش را بخواند. فرم‌ها و عملیات در آن غیرفعال هستند.','Anyone with this link can read the preview until it expires. Forms and actions are read-only.','Bağlantıya sahip herkes süre dolana kadar önizlemeyi okuyabilir. Formlar ve eylemler salt okunurdur.','يمكن لأي حامل للرابط قراءة المعاينة حتى انتهائه. النماذج والإجراءات للقراءة فقط.','Любой обладатель ссылки может читать предпросмотр до истечения срока. Формы и действия отключены.'),
 minutes:L('اعتبار لینک به دقیقه','Link validity in minutes','Bağlantı süresi, dakika','صلاحية الرابط بالدقائق','Срок ссылки в минутах'),
 create:L('ساخت لینک پیش‌نمایش','Create preview link','Önizleme bağlantısı oluştur','إنشاء رابط معاينة','Создать ссылку предпросмотра'),
 revoke:L('لغو لینک','Revoke link','Bağlantıyı iptal et','إلغاء الرابط','Отозвать ссылку'),
 revoked:L('لغوشده','Revoked','İptal edildi','ملغى','Отозвана'),
 loading:L('در حال بررسی اجازهٔ ویرایش…','Checking editing permission…','Düzenleme izni kontrol ediliyor…','جارٍ التحقق من إذن التحرير…','Проверка разрешения на редактирование…'),
};
export default function ContentCollaboration(props:Props){
 // A preview link and its pending callbacks belong to exactly one account,
 // document and locale. Never show retained state under a new editor context.
 return <CollaborationPanel key={JSON.stringify([props.store.actorId,props.store.role,props.bucket,props.id,props.store.locale,props.locale||props.store.locale])} {...props}/>;
}
function CollaborationPanel({store,bucket,id,sourceUpdatedAt,dirty,canEdit,locale=store.locale,onLeaseState}:Props){
 const [state,setState]=useState<LeaseState>(canEdit?'loading':'readonly'),[lease,setLease]=useState<ContentLease|null>(null),[previews,setPreviews]=useState<ContentPreview[]>([]),[error,setError]=useState(''),[minutes,setMinutes]=useState(60),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
 const mounted=useRef(true),pending=useRef(false),held=useRef<(ContentLease&{token:string})|null>(null),capture=useRef(sourceUpdatedAt),callback=useRef(onLeaseState);callback.current=onLeaseState;
 const key=`${store.actorId}:${bucket}:${id}`;
 const c=(name:keyof typeof copy)=>localized(copy[name],store.locale);
 useEffect(()=>{if(!dirty)capture.current=sourceUpdatedAt;},[sourceUpdatedAt,dirty]);
 useEffect(()=>{callback.current?.(state);},[state]);
 useEffect(()=>{
  mounted.current=true;let active=true;held.current=null;dropContentLease(key);setUrl('');setError('');
  const source=sourceUpdatedAt;capture.current=source;
  if(demoMode||!canEdit){setState('readonly');return()=>{active=false;mounted.current=false;};}
  let identity:ContentEditorIdentity|undefined,acquiring=true;
  const reading=new AbortController();
  const releaseIdentity=()=>{identity?.release();identity=undefined;};
  const releaseLease=async(current:ContentLease&{token:string})=>{
   // Only this exact lease ID/token is released. A late cleanup cannot delete
   // a newer token issued after same-tab navigation or explicit reacquisition.
   await apiClient.request(`/content/leases/${current.id}`,{method:'DELETE',body:JSON.stringify({token:current.token}),keepalive:true}).catch(()=>{});
  };
  const acquire=async()=>{
   setState('loading');
   try{
    identity=await acquireContentEditorIdentity(store.actorId);
    if(!active)return;
    const current=await apiClient.request<ContentLeaseStatus>(`/content/leases?bucket=${bucket}&id=${encodeURIComponent(id)}`,{signal:reading.signal});
    if(!active)return;setLease(current.lease);
    if(!current.canEdit){setState('readonly');return;}
    // Do not abort an in-flight mutation: if it commits after unmount, retain
    // the returned token long enough to release that exact acquisition.
    const acquired=await apiClient.request<ContentLease>('/content/leases',{method:'POST',body:JSON.stringify({bucket,id,clientId:identity.clientId,expectedUpdatedAt:capture.current})});
    if(!acquired.token)throw new Error('Missing editing lease token');
    if(!active){await releaseLease({...acquired,token:acquired.token});return;}
    held.current={...acquired,token:acquired.token};holdContentLease(key,acquired.token,acquired.leaseUntil);setLease(acquired);setState('held');
   }catch(reason){if(active){dropContentLease(key);setState('locked');setError(networkError(reason,store.locale));}}
   finally{acquiring=false;if(!active||!held.current)releaseIdentity();}
  };
  void acquire();
  const interval=window.setInterval(async()=>{const current=held.current;if(!active||!current||pending.current)return;pending.current=true;try{const updated=await apiClient.request<ContentLease>(`/content/leases/${current.id}`,{method:'PUT',body:JSON.stringify({token:current.token})});if(active&&held.current===current){held.current={...updated,token:current.token};holdContentLease(key,current.token,updated.leaseUntil);setLease(updated);setState('held');}}catch(reason){if(active&&held.current===current){held.current=null;dropContentLease(key);setState('expired');setError(networkError(reason,store.locale));releaseIdentity();}}finally{pending.current=false;}},40_000);
  const stop=()=>{
   if(!active)return;active=false;reading.abort();clearInterval(interval);dropContentLease(key);
   const current=held.current;held.current=null;
   if(current)void releaseLease(current).finally(releaseIdentity);
   else if(!acquiring)releaseIdentity();
  };
  const restore=(event:PageTransitionEvent)=>{if(event.persisted&&mounted.current)setRetry(value=>value+1);};
  window.addEventListener('pagehide',stop);window.addEventListener('pageshow',restore);
  return()=>{mounted.current=false;stop();window.removeEventListener('pagehide',stop);window.removeEventListener('pageshow',restore);};
 },[key,retry,canEdit]);
 useEffect(()=>{let active=true;if(demoMode||bucket==='forms')return;void apiClient.request<{items:ContentPreview[]}>(`/content/previews?bucket=${bucket}&id=${encodeURIComponent(id)}`).then(value=>{if(active)setPreviews(value.items);}).catch(()=>{});return()=>{active=false;};},[key]);
 const command=async(run:()=>Promise<void>)=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await run();}catch(reason){if(mounted.current)setError(networkError(reason,store.locale));}finally{pending.current=false;if(mounted.current)setBusy(false);}};
 const create=()=>command(async()=>{const result=await apiClient.request<ContentPreview>('/content/previews',{method:'POST',body:JSON.stringify({bucket,id,locale,expiresInMinutes:minutes})});if(mounted.current){setPreviews(previous=>[result,...previous]);setUrl(result.url||'');}});
 const revoke=(preview:ContentPreview)=>command(async()=>{await apiClient.request(`/content/previews/${preview.id}`,{method:'DELETE'});if(mounted.current){setPreviews(previous=>previous.map(item=>item.id===preview.id?{...item,revokedAt:new Date().toISOString()}:item));if(preview.url===url)setUrl('');}});
 if(demoMode)return null;
 return <section className="ws-card" data-editor-collaboration data-lease-state={state} style={{padding:'1rem',marginBlock:'1rem'}}><div className="ws-flex-between"><strong>{state==='held'?<UnlockKeyhole size={17}/>:<LockKeyhole size={17}/>} {c('collaboration')}</strong><span role="status">{state==='held'?c('held'):state==='loading'?c('loading'):state==='readonly'?wt('view',store.locale):c('locked')}</span></div>{lease&&<p className="ws-muted">{lease.holder.name} · {c('expires')}: <time>{new Date(lease.leaseUntil).toLocaleTimeString(store.locale)}</time></p>}{error&&<p role="alert" className="ws-storage-error">{error}</p>}{canEdit&&['expired','locked','unavailable'].includes(state)&&<button className="btn ws-small-btn" disabled={busy} onClick={()=>setRetry(value=>value+1)}><RefreshCw size={15}/>{c('acquire')}</button>}
 {bucket!=='forms'&&<details><summary>{c('previews')}</summary><p>{c('privacy')}</p>{dirty&&<p role="status">{c('savedOnly')}</p>}<label className="field"><span>{c('minutes')}</span><input className="input" type="number" min={5} max={10080} value={minutes} onChange={event=>setMinutes(Number(event.target.value))}/></label><button type="button" className="btn ws-small-btn" disabled={busy||dirty||!canEdit||minutes<5||minutes>10080} onClick={()=>void create()}><Link2 size={15}/>{c('create')}</button>{url&&<div className="field"><input className="input" readOnly value={url} aria-label={c('create')}/><button className="btn ws-small-btn" onClick={()=>void navigator.clipboard.writeText(url).catch(()=>setError(wt('denied',store.locale)))}><Copy size={15}/>{wt('copy',store.locale)}</button></div>}<ul>{previews.map(preview=><li key={preview.id}>{preview.locale.toUpperCase()} · <time>{new Date(preview.expiresAt).toLocaleString(store.locale)}</time> {preview.revokedAt?c('revoked'):preview.canRevoke&&<button className="btn ws-small-btn" disabled={busy} onClick={()=>void revoke(preview)}>{c('revoke')}</button>}</li>)}</ul></details>}</section>;
}
