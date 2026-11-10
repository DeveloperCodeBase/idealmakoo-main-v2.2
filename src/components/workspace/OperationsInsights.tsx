'use client';

import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {BarChart3,Coins,RefreshCw,ShieldCheck} from 'lucide-react';
import {apiClient,networkError} from '@/lib/api';
import type {WorkspaceStore} from './store';
import {L,localized,wt} from './i18n';
import './operations-insights.css';

const copy={
 title:L('گزارش سایت و مصرف سرویس‌ها','Website and service reports','Site ve hizmet raporları','تقارير الموقع والخدمات','Отчёты сайта и сервисов'),
 analytics:L('بازدید و تعامل','Visits and engagement','Ziyaret ve etkileşim','الزيارات والتفاعل','Посещения и активность'),
 moderation:L('بررسی دیدگاه‌ها و گزارش‌ها','Comments and reports','Yorumlar ve bildirimler','التعليقات والبلاغات','Комментарии и жалобы'),
 usage:L('مصرف API و هزینه','API usage and cost','API kullanımı ve maliyet','استهلاك API والتكلفة','Расход API и стоимость'),
 days:L('بازهٔ گزارش (روز)','Reporting period (days)','Rapor aralığı (gün)','فترة التقرير (أيام)','Период отчёта (дней)'),
 views:L('بازدید','Views','Görüntülenme','المشاهدات','Просмотры'),
 likes:L('پسند','Likes','Beğeni','الإعجابات','Отметки'),
 comments:L('دیدگاه‌ها','Comments','Yorumlar','التعليقات','Комментарии'),
 pendingComments:L('در انتظار بررسی','Awaiting review','İnceleme bekliyor','بانتظار المراجعة','Ожидают проверки'),
 reports:L('گزارش‌ها','Reports','Bildirimler','البلاغات','Жалобы'),
 scope:L('فقط داده‌های مجاز نقش و زبان شما نمایش داده می‌شود. بازدید، تخمین بازدید انسانی است و آمار فروش نیست.','Only data permitted by your role and language scope is shown. Views are an estimate of visits, not sales.','Yalnız rol ve dil kapsamınıza izin verilen veriler görünür. Görüntülenme ziyaret tahminidir, satış değildir.','تظهر البيانات المسموحة لدورك ولغتك فقط. المشاهدات تقدير للزيارات وليست مبيعات.','Показаны данные в пределах роли и языков. Просмотры оценивают посещения, а не продажи.'),
 daily:L('بازدید روزانه','Daily views','Günlük görüntülenme','المشاهدات اليومية','Просмотры по дням'),
 path:L('محتوا / نشانی','Content / path','İçerik / yol','المحتوى / المسار','Материал / путь'),
 approve:L('تأیید انتشار','Approve publication','Yayını onayla','الموافقة على النشر','Одобрить публикацию'),
 reject:L('رد دیدگاه','Reject comment','Yorumu reddet','رفض التعليق','Отклонить комментарий'),
 resolve:L('رسیدگی شد','Resolve','Çözüldü','تمت المعالجة','Решено'),
 dismiss:L('رد گزارش','Dismiss report','Bildirimi reddet','رفض البلاغ','Отклонить жалобу'),
 noPending:L('در این وضعیت موردی وجود ندارد.','There are no items in this status.','Bu durumda öğe yok.','لا توجد عناصر بهذه الحالة.','Нет записей с этим статусом.'),
 statePending:L('در انتظار بررسی','Awaiting review','İnceleme bekliyor','بانتظار المراجعة','Ожидают проверки'),
 stateApproved:L('دیدگاه‌های منتشرشده','Published comments','Yayınlanan yorumlar','التعليقات المنشورة','Опубликованные комментарии'),
 stateRejected:L('دیدگاه‌های ردشده','Rejected comments','Reddedilen yorumlar','التعليقات المرفوضة','Отклонённые комментарии'),
 stateResolved:L('گزارش‌های رسیدگی‌شده','Resolved reports','Çözülen bildirimler','البلاغات المعالجة','Рассмотренные жалобы'),
 stateDismissed:L('گزارش‌های ردشده','Dismissed reports','Reddedilen bildirimler','البلاغات المرفوضة','Отклонённые жалобы'),
 org:L('مصرف تجمیعی سازمان','Organization usage','Kuruluş kullanımı','استهلاك المؤسسة','Расход организации'),
 self:L('مصرف حساب شما','Your account usage','Hesabınızın kullanımı','استهلاك حسابك','Расход вашего аккаунта'),
 provider:L('سرویس / مدل','Provider / model','Sağlayıcı / model','المزوّد / النموذج','Сервис / модель'),
 purpose:L('نوع عملیات','Operation','İşlem','العملية','Операция'),
 requests:L('درخواست‌ها','Requests','İstekler','الطلبات','Запросы'),
 units:L('واحد / توکن','Units / tokens','Birim / jeton','الوحدات / الرموز','Единицы / токены'),
 actual:L('هزینهٔ گزارش‌شده','Reported cost','Bildirilen maliyet','التكلفة المبلّغة','Сообщённая стоимость'),
 estimate:L('برآورد / رزرو','Estimated / reserved','Tahmin / rezerv','التقدير / الحجز','Оценка / резерв'),
 unpriced:L('بدون قیمت قطعی','Not priced','Fiyatlandırılmamış','دون سعر مؤكد','Без подтверждённой цены'),
 costNote:L('مبلغ تخمینی و رزرو با هزینهٔ قطعی متفاوت است. موارد فاقد قیمت، رایگان محسوب نمی‌شوند. پاسخ provider نیز اثبات خوانده‌شدن پیام نیست.','Estimates and reservations differ from confirmed cost. Unpriced records are not free. A provider response does not prove that a message was read.','Tahmin ve rezervler kesin maliyetten farklıdır. Fiyatsız kayıt ücretsiz değildir. Sağlayıcı yanıtı mesajın okunduğunu kanıtlamaz.','يختلف التقدير والحجز عن التكلفة المؤكدة. السجل دون سعر ليس مجانيًا. رد المزوّد لا يثبت قراءة الرسالة.','Оценки и резервы отличаются от подтверждённой стоимости. Отсутствие цены не означает бесплатность. Ответ сервиса не доказывает прочтение.'),
 state:L('وضعیت','Status','Durum','الحالة','Статус'),
 empty:L('در این بازه داده‌ای ثبت نشده است.','No data has been recorded in this period.','Bu aralıkta veri kaydedilmedi.','لم تُسجّل بيانات في هذه الفترة.','За этот период данных нет.'),
 deliveries:L('وضعیت صف ارسال پیام','Message delivery queue','Mesaj gönderim kuyruğu','حالة طابور الإرسال','Очередь отправки сообщений'),
 channel:L('کانال','Channel','Kanal','القناة','Канал'),
 allLanguages:L('همهٔ زبان‌های مجاز','All permitted languages','İzin verilen tüm diller','كل اللغات المسموحة','Все доступные языки'),
};
const reviewStates={pending:'statePending',approved:'stateApproved',rejected:'stateRejected',resolved:'stateResolved',dismissed:'stateDismissed'}as const;
type Counter='views'|'likes'|'comments'|'pendingComments'|'reports';
interface Analytics {summary:Record<Counter,number>;items:({path:string;locale:string}&Record<Counter,number>)[];daily:{day:string;views:number}[]}
interface ReviewItem {id:string;path:string;locale:string;body?:string;name?:string;reason?:string;createdAt:string;version:number;state:string}
interface Moderation {comments:ReviewItem[];reports:ReviewItem[]}
interface AiUsage {provider:string;model:string;mode:string;state:string;requests:number;tokens:number;actualUsd:number|null;reservedUsd:number|null;unpriced:number}
interface ChannelUsage {provider:string;channel:string;purpose:string;status:string;requests:number;units:number|null;currency:string;actualCost:number|null;estimatedCost:number|null;unpriced:number}
interface Usage {ai:AiUsage[];channels:ChannelUsage[];scope:'organization'|'self';deliveries?:{channel:string;state:string;requests:number}[]}

export default function OperationsInsights({store}:{store:WorkspaceStore}){
 const {locale,role}=store,c=(key:keyof typeof copy)=>localized(copy[key],locale),moderates=['superAdmin','admin','publisher'].includes(role);
 const [tab,setTab]=useState<'analytics'|'moderation'|'usage'>('analytics'),[days,setDays]=useState('30'),[selectedLocale,setSelectedLocale]=useState<string|null>(null),[refresh,setRefresh]=useState(0),[reviewState,setReviewState]=useState<keyof typeof reviewStates>('pending');
 const [data,setData]=useState<Analytics|Moderation|Usage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const permittedLocales=['fa','en','tr','ar','ru'].filter(value=>!store.actor.allowedLocales||store.actor.allowedLocales.includes(value));
 const reportLocale=selectedLocale&&permittedLocales.includes(selectedLocale)?selectedLocale:permittedLocales.includes(locale)?locale:permittedLocales[0]||locale;
 const key=JSON.stringify([store.actorId,locale,tab,days,reportLocale,refresh,reviewState]),latest=useRef(key);latest.current=key;const request=useRef<AbortController|null>(null);
 useEffect(()=>{const controller=new AbortController();let active=true;setData(null);setError('');setLoading(true);setBusy(false);
  const path=tab==='analytics'?'/analytics/content?'+new URLSearchParams({days,locale:reportLocale}):tab==='moderation'?'/engagement/moderation?'+new URLSearchParams({state:reviewState,locale:reportLocale}):'/usage?'+new URLSearchParams({days});
  void apiClient.request<Analytics|Moderation|Usage>(path,{signal:controller.signal}).then(value=>{if(active&&latest.current===key)setData(value);}).catch(reason=>{if(active&&latest.current===key&&!controller.signal.aborted)setError(networkError(reason,locale));}).finally(()=>{if(active&&latest.current===key)setLoading(false);});
  return()=>{active=false;controller.abort();request.current?.abort();request.current=null;};
 },[key,tab,days,reportLocale,locale,reviewState]);
 const number=(value:unknown)=>Number(value||0).toLocaleString(locale),cost=(value:unknown)=>value===null||value===undefined?'—':Number(value).toLocaleString(locale,{maximumFractionDigits:6});
 async function decide(kind:'comments'|'reports',item:ReviewItem,state:string){if(request.current)return;const controller=new AbortController();request.current=controller;setBusy(true);setError('');
  try{await apiClient.request(`/engagement/${kind}/${encodeURIComponent(item.id)}`,{method:'PATCH',signal:controller.signal,body:JSON.stringify({state,expectedVersion:item.version})});if(latest.current===key&&!controller.signal.aborted)setRefresh(value=>value+1);}
  catch(reason){if(latest.current===key&&!controller.signal.aborted)setError(networkError(reason,locale));}
  finally{if(request.current===controller){request.current=null;if(latest.current===key)setBusy(false);}}
 }
 const counters:Counter[]=['views','likes','comments','pendingComments','reports'];
 return <section className="ws-card operations-insights" data-operations-insights={tab}><header><h2>{c('title')}</h2><button type="button" className="btn" disabled={loading||busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={16}/>{wt('refresh',locale)}</button></header>
  <div className="operations-tabs" role="group" aria-label={c('title')}>{(['analytics','usage',...(moderates?['moderation']:[])]as ('analytics'|'moderation'|'usage')[]).map(value=><button type="button" key={value} className="btn" aria-pressed={tab===value} disabled={busy} onClick={()=>setTab(value)}>{value==='analytics'?<BarChart3 size={17}/>:value==='usage'?<Coins size={17}/>:<ShieldCheck size={17}/>} {c(value)}</button>)}</div>
  <div className="operations-filters">{tab!=='moderation'&&<label className="field"><span>{c('days')}</span><select className="input" value={days} disabled={busy} onChange={event=>setDays(event.target.value)}>{[7,30,90].map(value=><option value={value} key={value}>{value.toLocaleString(locale)}</option>)}</select></label>}{tab!=='usage'&&<label className="field"><span>{wt('language',locale)}</span><select className="input" value={reportLocale} disabled={busy} onChange={event=>setSelectedLocale(event.target.value)}>{permittedLocales.map(value=><option key={value}>{value}</option>)}</select></label>}{tab==='moderation'&&<label className="field"><span>{c('state')}</span><select className="input" data-moderation-state value={reviewState} disabled={busy} onChange={event=>setReviewState(event.target.value as keyof typeof reviewStates)}>{(Object.keys(reviewStates)as (keyof typeof reviewStates)[]).map(value=><option value={value} key={value}>{c(reviewStates[value])}</option>)}</select></label>}</div>
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">{wt('loading',locale)}</p>}
  {tab==='analytics'&&data&&'summary'in data&&<><p className="ws-muted">{c('scope')}</p><div className="operations-counters">{counters.map(name=><div key={name}><span>{c(name)}</span><strong>{number(data.summary[name])}</strong></div>)}</div><div className="operations-table" role="region" tabIndex={0} aria-label={c('analytics')}><table><thead><tr><th>{c('path')}</th>{counters.map(name=><th key={name}>{c(name)}</th>)}</tr></thead><tbody>{data.items.map(row=><tr key={row.path+row.locale}><td><Link href={`/${row.locale}/${row.path}`} target="_blank" rel="noreferrer"><bdi>{row.path||'/'}</bdi></Link><small>{row.locale}</small></td>{counters.map(name=><td key={name}>{number(row[name])}</td>)}</tr>)}</tbody></table></div>{!data.items.length&&<p>{c('empty')}</p>}{data.daily.length>0&&<details><summary>{c('daily')}</summary><div className="operations-table"><table><tbody>{data.daily.map(row=><tr key={row.day}><th scope="row">{new Date(row.day).toLocaleDateString(locale,{timeZone:'UTC'})}</th><td>{number(row.views)}</td></tr>)}</tbody></table></div></details>}</>}
  {tab==='moderation'&&data&&'reports'in data&&Array.isArray(data.reports)&&<div className="operations-reviews">{(['comments','reports']as const).map(kind=><section key={kind}><h3>{c(kind)}</h3>{!(data as Moderation)[kind].length&&<p>{c('noPending')}</p>}{(data as Moderation)[kind].map(item=><article className="ws-card" key={item.id} data-moderation-item={item.id}><header><strong>{item.name||c(kind)}</strong><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale)}</time></header><Link href={`/${item.locale}/${item.path}`} target="_blank" rel="noreferrer"><bdi>{item.path}</bdi></Link><p>{item.body||item.reason}</p><div className="operations-tabs"><button type="button" className="btn btn-primary" disabled={busy||item.state===(kind==='comments'?'approved':'resolved')} onClick={()=>void decide(kind,item,kind==='comments'?'approved':'resolved')}>{c(kind==='comments'?'approve':'resolve')}</button><button type="button" className="btn" disabled={busy||item.state===(kind==='comments'?'rejected':'dismissed')} onClick={()=>void decide(kind,item,kind==='comments'?'rejected':'dismissed')}>{c(kind==='comments'?'reject':'dismiss')}</button></div></article>)}</section>)}</div>}
  {tab==='usage'&&data&&'ai'in data&&<><h3>{c(data.scope==='organization'?'org':'self')}</h3><p className="ws-muted">{c('costNote')}</p><h4>AI</h4><div className="operations-table" role="region" aria-label="AI" tabIndex={0}><table><thead><tr>{(['provider','purpose','state','requests','units','actual','estimate','unpriced']as const).map(key=><th key={key}>{c(key)}</th>)}</tr></thead><tbody>{data.ai.map((row,index)=><tr key={index}><td>{row.provider}<small><bdi>{row.model}</bdi></small></td><td>{row.mode}</td><td>{row.state}</td><td>{number(row.requests)}</td><td>{number(row.tokens)}</td><td>{cost(row.actualUsd)} USD</td><td>{cost(row.reservedUsd)} USD</td><td>{number(row.unpriced)}</td></tr>)}</tbody></table></div><h4>{wt('communications',locale)}</h4><div className="operations-table" role="region" aria-label={wt('communications',locale)} tabIndex={0}><table><thead><tr>{(['provider','purpose','state','requests','units','actual','estimate','unpriced']as const).map(key=><th key={key}>{c(key)}</th>)}</tr></thead><tbody>{data.channels.map((row,index)=><tr key={index}><td>{row.provider}<small>{row.channel}</small></td><td>{row.purpose}</td><td>{row.status}</td><td>{number(row.requests)}</td><td>{row.units===null||row.units===undefined?'—':number(row.units)}</td><td>{cost(row.actualCost)} <bdi>{row.currency}</bdi></td><td>{cost(row.estimatedCost)} <bdi>{row.currency}</bdi></td><td>{number(row.unpriced)}</td></tr>)}</tbody></table></div>{!data.ai.length&&!data.channels.length&&<p>{c('empty')}</p>}{!!data.deliveries?.length&&<><h4>{c('deliveries')}</h4><div className="operations-table"><table><thead><tr><th>{c('channel')}</th><th>{c('state')}</th><th>{c('requests')}</th></tr></thead><tbody>{data.deliveries.map((row,index)=><tr key={index}><td>{row.channel}</td><td>{row.state}</td><td>{number(row.requests)}</td></tr>)}</tbody></table></div></>}</>}
 </section>;
}
