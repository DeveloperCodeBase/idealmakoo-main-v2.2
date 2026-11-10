'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Sparkles,Square} from 'lucide-react';
import {apiClient,networkError} from '@/lib/api';
import type {AiResult} from '@/lib/ai-client';
import AiMarkdown from '@/components/ui/AiMarkdown';
import type {WorkspaceStore} from './store';
import {L,localized,wt} from './i18n';
import {Modal} from './ui';
import './operations-insights.css';

const copy={
 title:L('کمک اختیاری هوش مصنوعی','Optional AI assistance','İsteğe bağlı AI desteği','مساعدة اختيارية بالذكاء الاصطناعي','Помощь ИИ по запросу'),
 content:L('محتوا و ویرایش','Content and editing','İçerik ve düzenleme','المحتوى والتحرير','Материалы и редактура'),
 seo:L('سئو و نمایه‌سازی','SEO and indexing','SEO ve dizine ekleme','SEO والفهرسة','SEO и индексация'),
 analytics:L('تحلیل گزارش‌ها','Report analysis','Rapor analizi','تحليل التقارير','Анализ отчётов'),
 product:L('محصول','Product','Ürün','المنتج','Продукт'),
 customer:L('مشتری و پرونده','Customer and record','Müşteri ve kayıt','العميل والسجل','Клиент и дело'),
 general:L('راهنمای کار','Workflow guidance','İş akışı rehberi','إرشادات العمل','Рабочие рекомендации'),
 area:L('موضوع کمک','Assistance area','Destek alanı','مجال المساعدة','Область помощи'),
 prompt:L('درخواست شما','Your request','İsteğiniz','طلبك','Ваш запрос'),
 selected:L('پرونده‌های مجاز (حداکثر ۵ مورد)','Authorized records (up to 5)','Yetkili kayıtlar (en fazla 5)','السجلات المسموحة (حتى ٥)','Доступные дела (до 5)'),
 transfer:L('با ارسال متن درخواست و پرونده‌های انتخاب‌شده به ارائه‌دهندهٔ AI موافقم.','I agree to send this prompt and selected records to the AI provider.','Bu isteğin ve seçilen kayıtların AI sağlayıcısına gönderilmesini kabul ediyorum.','أوافق على إرسال الطلب والسجلات المختارة إلى مزوّد الذكاء الاصطناعي.','Согласен отправить этот запрос и выбранные дела провайдеру ИИ.'),
 review:L('خروجی یک پیشنهاد است. صحت اطلاعات، اعداد، ادعاهای فنی و متن نهایی را بررسی کنید و سپس خودتان تصمیم بگیرید.','The output is a proposal. Check facts, numbers, technical claims and final wording before deciding what to use.','Çıktı bir öneridir. Kullanmadan önce bilgileri, sayıları, teknik iddiaları ve son metni inceleyin.','المخرج اقتراح. راجع الحقائق والأرقام والادعاءات الفنية والصياغة قبل الاستخدام.','Результат является предложением. Проверьте факты, числа, технические утверждения и формулировки.'),
 configured:L('سرویس AI هنوز تنظیم نشده است. مدیر باید کلید، مدل و بودجه را فعال کند.','AI is not configured yet. An administrator must configure the key, model and budget.','AI henüz yapılandırılmadı. Yönetici anahtarı, modeli ve bütçeyi ayarlamalıdır.','الذكاء الاصطناعي غير مهيأ. على المسؤول ضبط المفتاح والنموذج والميزانية.','ИИ пока не настроен. Администратор должен указать ключ, модель и бюджет.'),
 generate:L('دریافت پیشنهاد','Generate proposal','Öneri oluştur','إنشاء اقتراح','Получить предложение'),
 stop:L('توقف درخواست','Stop request','İsteği durdur','إيقاف الطلب','Остановить запрос'),
 cancelled:L('درخواست از این صفحه متوقف شد. مصرف انجام‌شدهٔ ارائه‌دهنده ممکن است ثبت شود.','The request was stopped on this page. Provider usage already incurred may still be recorded.','İstek bu sayfada durduruldu. Sağlayıcıda gerçekleşen kullanım yine de kaydedilebilir.','أُوقف الطلب في هذه الصفحة. قد يُسجّل استهلاك المزوّد الذي حدث بالفعل.','Запрос остановлен на этой странице. Уже понесённый расход провайдера может быть учтён.'),
};
type Area='content'|'seo'|'analytics'|'product'|'customer'|'general';
interface Capabilities {areas:Area[];configured:boolean}
const areaFor=(section:string):Area=>['products','resources'].includes(section)?'product':['reports','monitoring'].includes(section)?'analytics':['leads','contacts','accounts','opportunities','tickets','crm','inbox'].includes(section)?'customer':['pages','site-control','news','research','translations'].includes(section)?'content':'general';

export default function WorkspaceAssistant({store,section}:{store:WorkspaceStore;section:string}){
 const c=(key:keyof typeof copy)=>localized(copy[key],store.locale),[capabilities,setCapabilities]=useState<Capabilities|null>(null),[open,setOpen]=useState(false);
 const allowedLocales=['fa','en','tr','ar','ru'].filter(value=>!store.actor.allowedLocales||store.actor.allowedLocales.includes(value));
 const [selectedLocale,setSelectedLocale]=useState<string|null>(null);
 const targetLocale=selectedLocale&&allowedLocales.includes(selectedLocale)?selectedLocale:allowedLocales.includes(store.locale)?store.locale:allowedLocales[0]||store.locale;
 const [area,setArea]=useState<Area>(areaFor(section)),[prompt,setPrompt]=useState(''),[selected,setSelected]=useState<string[]>([]),[consent,setConsent]=useState(false),[result,setResult]=useState<AiResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const key=JSON.stringify([store.actorId,store.locale,section,allowedLocales.join(',')]),latest=useRef(key);latest.current=key;const pending=useRef<AbortController|null>(null),active=useRef(true);
 useEffect(()=>{active.current=true;const controller=new AbortController();setCapabilities(null);setSelectedLocale(null);setOpen(false);setPrompt('');setSelected([]);setResult(null);setConsent(false);setBusy(false);
  void apiClient.request<Capabilities>('/ai/assist/capabilities',{signal:controller.signal}).then(value=>{if(active.current&&latest.current===key){setCapabilities(value);setArea(value.areas.includes(areaFor(section))?areaFor(section):value.areas[0]||'general');}}).catch(()=>{/* The optional action stays unavailable when authority cannot be checked. */});
  return()=>{active.current=false;controller.abort();pending.current?.abort();pending.current=null;};
 },[key,section]);
 async function submit(event:FormEvent){event.preventDefault();if(pending.current||!consent||!capabilities?.configured)return;
  const controller=new AbortController();pending.current=controller;setBusy(true);setError('');setResult(null);
  try{const response=await apiClient.request<AiResult>('/ai/assist',{method:'POST',signal:controller.signal,body:JSON.stringify({locale:targetLocale,area,prompt:prompt.trim(),...(area==='customer'?{recordIds:selected}:{})})});if(active.current&&latest.current===key&&!controller.signal.aborted)setResult(response);}
  catch(reason){if(active.current&&latest.current===key)setError(controller.signal.aborted?c('cancelled'):networkError(reason,store.locale));}
  finally{if(pending.current===controller){pending.current=null;if(active.current&&latest.current===key)setBusy(false);}}
 }
 if(!capabilities?.areas.length)return null;
 return <><button type="button" className="ws-icon-button" aria-label={c('title')} title={c('title')} onClick={()=>setOpen(true)}><Sparkles size={18}/></button>{open&&<Modal title={c('title')} wide onClose={()=>{pending.current?.abort();setOpen(false);}}><form className="operations-ai-form" data-workspace-assistant="true" onSubmit={submit}><label className="field"><span>{c('area')}</span><select className="input" value={area} disabled={busy} onChange={event=>{setArea(event.target.value as Area);setSelected([]);setResult(null);setConsent(false);}}>{capabilities.areas.map(value=><option value={value} key={value}>{c(value)}</option>)}</select></label>
  <label className="field"><span>{wt('language',store.locale)}</span><select className="input" value={targetLocale} disabled={busy} onChange={event=>{setSelectedLocale(event.target.value);setResult(null);setConsent(false);}}>{allowedLocales.map(value=><option value={value} key={value}>{({fa:'فارسی',en:'English',tr:'Türkçe',ar:'العربية',ru:'Русский'}as Record<string,string>)[value]}</option>)}</select></label>
  {area==='customer'&&<fieldset disabled={busy}><legend>{c('selected')}</legend>{store.state.records.filter(record=>['leads','accounts','contacts','opportunities','tickets'].includes(record.collection)).slice(0,100).map(record=><label className="consent-row" key={record.id}><input type="checkbox" checked={selected.includes(record.id)} disabled={selected.length>=5&&!selected.includes(record.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,record.id]:current.filter(id=>id!==record.id))}/>{localized(record.title,store.locale)}</label>)}</fieldset>}
  <label className="field"><span>{c('prompt')}</span><textarea className="input" rows={6} minLength={3} maxLength={8000} required value={prompt} disabled={busy} onChange={event=>setPrompt(event.target.value)}/></label>
  <label className="consent-row"><input type="checkbox" required checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>{c('transfer')}</label><p>{c('review')}</p>{!capabilities.configured&&<p role="status">{c('configured')}</p>}{error&&<p role="alert">{error}</p>}
  <div className="operations-tabs"><button type="submit" className="btn btn-primary" disabled={busy||!consent||!capabilities.configured||prompt.trim().length<3||area==='customer'&&!selected.length}>{busy?wt('loading',store.locale):c('generate')}<Sparkles size={16}/></button>{busy&&<button className="btn" type="button" onClick={()=>pending.current?.abort()}><Square size={16}/>{c('stop')}</button>}</div>
  {result&&<section className="operations-ai-result"><small><bdi>{result.provider} · {result.model}</bdi>{result.tokens!==null&&` · ${result.tokens.toLocaleString(store.locale)}`}</small><AiMarkdown text={result.text} locale={store.locale}/></section>}
 </form></Modal>}</>;
}
