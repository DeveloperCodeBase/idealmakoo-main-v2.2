'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {CalendarDays,RefreshCw,X} from 'lucide-react';
import {apiClient,demoMode,networkError} from '@/lib/api';
import {type WorkspaceStore} from './store';
import {L,localized,wt} from './i18n';
import {safeDate} from './ui';

interface Schedule {id:string;bucket:'records'|'pages';documentId:string;locale:string;scheduledAt:string;status:'pending'|'published'|'cancelled'|'failed';error:string|null;finishedAt:string|null}
const words={
 title:L('انتشار زمان‌بندی‌شده','Scheduled publication','Zamanlanmış yayın','النشر المجدول','Запланированная публикация'),
 note:L('فقط نسخه تأییدشده همین زبان در زمان انتخابی منتشر می‌شود. زمان بر اساس منطقه زمانی دستگاه شما است.','Only the approved version of this language will publish at the selected time. Time uses your device timezone.','Yalnızca bu dilin onaylı sürümü seçilen zamanda yayınlanır. Cihazınızın saat dilimi kullanılır.','يُنشر الإصدار المعتمد لهذه اللغة فقط في الوقت المحدد، وفق المنطقة الزمنية لجهازك.','В выбранное время публикуется утверждённая версия этого языка. Используется часовой пояс устройства.'),
 dirty:L('ابتدا تغییرات را ذخیره و برای بازبینی ارسال کنید.','Save changes and submit them for review first.','Önce değişiklikleri kaydedip incelemeye gönderin.','احفظ التغييرات وأرسلها للمراجعة أولاً.','Сначала сохраните изменения и отправьте на проверку.'),
 empty:L('انتشار زمان‌بندی‌شده‌ای ثبت نشده است.','No scheduled publications.','Zamanlanmış yayın yok.','لا توجد منشورات مجدولة.','Запланированных публикаций нет.'),
 pending:L('در انتظار زمان انتشار','Awaiting publication time','Yayın zamanı bekleniyor','بانتظار وقت النشر','Ожидает времени публикации'),
 cancelled:L('لغو شده','Cancelled','İptal edildi','ملغى','Отменено'),
 failed:L('نیازمند بررسی','Needs attention','İnceleme gerekiyor','يحتاج إلى مراجعة','Требует проверки'),
 published:L('منتشر شد','Published','Yayınlandı','نُشر','Опубликовано'),
};
export default function PublicationSchedule({store,bucket,id,locale,status,dirty=false,onChanged}:{store:WorkspaceStore;bucket:'records'|'pages';id:string;locale:string;status:string;dirty?:boolean;onChanged?:()=>void}){
 const [date,setDate]=useState(''),[jobs,setJobs]=useState<Schedule[]>([]),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[zone,setZone]=useState('');
 const tr=(key:keyof typeof words)=>localized(words[key],store.locale);
 const source=bucket==='pages'?store.state.pages.find(item=>item.id===id):store.state.records.find(item=>item.id===id);
 const publishable=!!source&&store.permit('publish','collection'in source?source.collection:'pages',locale);
 const refresh=async()=>{if(demoMode)return;const result=await apiClient.request<{items:Schedule[]}>('/workspace/schedules');setJobs(result.items.filter(item=>item.bucket===bucket&&item.documentId===id));setLoaded(true);setError('');};
 useEffect(()=>{setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);let active=true;if(!demoMode&&source)void apiClient.request<{items:Schedule[]}>('/workspace/schedules').then(result=>{if(active){setJobs(result.items.filter(item=>item.bucket===bucket&&item.documentId===id));setLoaded(true);setError('');}}).catch(reason=>{if(active)setError(networkError(reason,store.locale));});return()=>{active=false;};},[id,bucket,store.version,!!source]);
 if(!source||demoMode)return null;
 const submit=async(event:FormEvent)=>{event.preventDefault();const at=new Date(date);if(!date||!Number.isFinite(at.getTime())||at.getTime()<=Date.now())return;if(await store.schedule(bucket,id,locale,at.toISOString())){setDate('');onChanged?.();await refresh().catch(reason=>setError(networkError(reason,store.locale)));}};
 return <details className="ws-card ws-no-print" style={{padding:16,marginBlock:16}}><summary style={{cursor:'pointer',display:'flex',alignItems:'center',gap:8}}><CalendarDays size={18}/><strong>{tr('title')}</strong><span className="ws-count">{jobs.filter(job=>job.status==='pending').length}</span></summary><p className="ws-muted">{tr('note')} <bdi>{zone}</bdi></p>{error&&<p role="alert" className="ws-storage-error">{error}</p>}
 {publishable&&(dirty?<p className="ws-inline-note">{tr('dirty')}</p>:['approved','published','scheduled'].includes(status)&&<form className="ws-schedule-row" onSubmit={submit}><label className="ws-field"><span>{wt('date',store.locale)} · <bdi>{locale.toUpperCase()}</bdi></span><input className="input" type="datetime-local" value={date} onChange={event=>setDate(event.target.value)} required/></label><button className="btn" disabled={store.pending||!date}><CalendarDays size={16}/>{wt('schedule',store.locale)}</button></form>)}
 {loaded&&!jobs.length&&<p className="ws-muted">{tr('empty')}</p>}{jobs.slice(0,20).map(job=><div key={job.id} className="ws-flex-between" style={{paddingBlock:9,borderBottom:'1px solid var(--line)',gap:10,flexWrap:'wrap'}}><span><bdi>{job.locale.toUpperCase()}</bdi> · {safeDate(job.scheduledAt,store.locale,{dateStyle:'medium',timeStyle:'short'})}</span><span>{tr(job.status)}{job.error&&<small style={{display:'block'}}>{job.error}</small>}</span>{job.status==='pending'&&publishable&&<button type="button" className="btn" disabled={store.pending} onClick={async()=>{if(await store.cancelSchedule(bucket,id,job.locale)){onChanged?.();await refresh().catch(reason=>setError(networkError(reason,store.locale)));}}}><X size={15}/>{wt('cancel',store.locale)}</button>}</div>)}<button type="button" className="ws-text-link" disabled={store.pending} style={{marginTop:12}} onClick={()=>void refresh().catch(reason=>setError(networkError(reason,store.locale)))}><RefreshCw size={14}/>{wt('refresh',store.locale)}</button></details>;
}
