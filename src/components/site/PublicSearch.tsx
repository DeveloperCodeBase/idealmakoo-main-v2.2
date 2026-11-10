'use client';

import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,FileSearch,Search} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {apiClient,networkError} from '@/lib/api';
import {Modal} from '@/components/ui/Primitives';
import './engagement.css';

const l=(fa:string,en:string,tr:string,ar:string,ru:string)=>({fa,en,tr,ar,ru});
const copy={
 title:l('جست‌وجوی جامع سایت','Search the whole site','Sitenin tamamında ara','البحث في الموقع كله','Поиск по всему сайту'),
 type:l('نوع محتوا','Content type','İçerik türü','نوع المحتوى','Тип материала'),
 category:l('دسته‌بندی','Category','Kategori','الفئة','Категория'),
 all:l('همه','All','Tümü','الكل','Все'),
 results:l('نتیجه','results','sonuç','نتيجة','результатов'),
 next:l('نتایج بعدی','Next results','Sonraki sonuçlar','النتائج التالية','Следующие результаты'),
 previous:l('نتایج قبلی','Previous results','Önceki sonuçlar','النتائج السابقة','Предыдущие результаты'),
 retry:l('تلاش دوباره','Try again','Tekrar dene','إعادة المحاولة','Повторить'),
 hint:l('نام، عبارت، کد محصول یا موضوع را وارد کنید.','Search a name, phrase, product code or topic.','Ad, ifade, ürün kodu veya konu arayın.','ابحث بالاسم أو العبارة أو رمز المنتج أو الموضوع.','Введите название, фразу, код товара или тему.'),
};
const kindLabels:Record<string,ReturnType<typeof l>>={product:l('محصول','Product','Ürün','منتج','Продукт'),research:l('پژوهش','Research','Araştırma','بحث','Исследование'),news:l('خبر','News','Haber','خبر','Новость'),event:l('رویداد','Event','Etkinlik','فعالية','Событие'),page:l('صفحه','Page','Sayfa','صفحة','Страница'),resource:l('منبع و دانلود','Resource','Kaynak','مورد','Ресурс'),knowledge:l('دانشنامه','Knowledge','Bilgi','المعرفة','Знания'),career:l('فرصت شغلی','Career','Kariyer','وظيفة','Вакансия')};

const categoryLabels:Record<string,ReturnType<typeof l>>={teeth:l('دندان مصنوعی','Denture teeth','Protez dişler','الأسنان الصناعية','Искусственные зубы'),materials:l('مواد دندانپزشکی','Dental materials','Diş malzemeleri','مواد طب الأسنان','Стоматологические материалы'),company:l('شرکت و کارخانه','Company and factory','Şirket ve fabrika','الشركة والمصنع','Компания и фабрика'),wear:l('سایش','Wear','Aşınma','التآكل','Износ'),bond:l('اتصال و چسبندگی','Bonding','Bağlanma','الالتصاق','Адгезия'),catalog:l('کاتالوگ','Catalogue','Katalog','كتالوج','Каталог'),brochure:l('بروشور','Brochure','Broşür','كتيب','Брошюра'),reference:l('اسناد مرجع','Reference documents','Referans belgeler','وثائق مرجعية','Справочные документы')};
interface SearchResult{id:string;title:string;summary:string;href:string;kind:string;category?:string}
interface SearchResponse{items:SearchResult[];total:number;categories?:string[];kinds?:string[];hasMore?:boolean}
const safeHref=(value:string,locale:string)=>value.startsWith('/'+locale+'/')&&!/[\\\u0000-\u001f]/.test(value);

export default function PublicSearch({query,setQuery,onClose}:{query:string;setQuery:(value:string)=>void;onClose:()=>void}){
 const {locale,t,session,sessionReady}=useApp(),c=(key:keyof typeof copy)=>copy[key][locale];
 const [kind,setKind]=useState(''),[category,setCategory]=useState(''),[page,setPage]=useState(0),[retry,setRetry]=useState(0);
 const key=JSON.stringify([locale,session?.id||null,query,kind,category,page,retry,sessionReady]);
 const latest=useRef(key);latest.current=key;
 const [state,setState]=useState<SearchResponse&{key:string;loading:boolean;error:string}>({key:'',items:[],total:0,loading:true,error:''});
 const data=state.key===key?state:{items:[],total:0,categories:state.categories,kinds:state.kinds,loading:true,error:''};
 useEffect(()=>{
  if(!sessionReady)return;let active=true;const controller=new AbortController();
  const timer=setTimeout(()=>{setState(previous=>({...previous,key,items:[],loading:true,error:''}));
   const params=new URLSearchParams({locale,q:query.trim(),limit:'20',offset:String(page*20),...(kind?{kind}:{}),...(category?{category}:{})});
   void apiClient.request<SearchResponse>('/public/search?'+params,{signal:controller.signal}).then(result=>{if(active&&latest.current===key)setState({...result,key,loading:false,error:''});}).catch(reason=>{if(active&&latest.current===key&&!controller.signal.aborted)setState({key,items:[],total:0,loading:false,error:networkError(reason,locale)});});
  },180);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[key,locale,query,kind,category,page,sessionReady]);
 const typeName=(value:string)=>kindLabels[value]?.[locale]||value;
 const categoryName=(value:string)=>categoryLabels[value]?.[locale]||kindLabels[value]?.[locale]||value;
 return <Modal title={c('title')} onClose={onClose} className="search-dialog"><section data-public-search="true" className="public-search-panel">
  <label className="search-field"><Search size={22}/><input autoFocus type="search" aria-label={t('search')} placeholder={c('hint')} maxLength={120} value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/><kbd>⌘ K</kbd></label>
  <div className="public-search-filters"><label className="field"><span>{c('type')}</span><select className="input" value={kind} onChange={event=>{setKind(event.target.value);setCategory('');setPage(0);}}><option value="">{c('all')}</option>{[...new Set([...(data.kinds||Object.keys(kindLabels)),...(kind?[kind]:[])])].map(value=><option key={value} value={value}>{typeName(value)}</option>)}</select></label><label className="field"><span>{c('category')}</span><select className="input" value={category} onChange={event=>{setCategory(event.target.value);setPage(0);}}><option value="">{c('all')}</option>{[...new Set([...(data.categories||[]),...(category?[category]:[])])].map(value=><option key={value} value={value}>{categoryName(value)}</option>)}</select></label></div>
  <p role="status" aria-live="polite">{data.loading?t('loading'):`${data.total.toLocaleString(locale)} ${c('results')}`}</p>
  {data.error&&<p role="alert">{data.error} <button type="button" className="btn" onClick={()=>setRetry(value=>value+1)}>{c('retry')}</button></p>}
  <div className="search-result-list" aria-busy={data.loading}>{data.items.filter(item=>safeHref(item.href,locale)).map(item=><Link href={item.href} key={item.id+item.href} onClick={onClose}><FileSearch size={18}/><span><strong>{item.title}</strong><small>{typeName(item.kind)}{item.category&&` · ${categoryName(item.category)}`}</small><p>{item.summary}</p></span><ArrowUpRight size={16}/></Link>)}{!data.loading&&!data.error&&!data.items.length&&<p>{t('noResults')}</p>}</div>
  {(page>0||data.total>(page+1)*20||('hasMore'in data&&data.hasMore))&&<div className="public-search-paging"><button className="btn" type="button" disabled={data.loading||page===0} onClick={()=>setPage(value=>value-1)}>{c('previous')}</button><span>{(page+1).toLocaleString(locale)}</span><button className="btn" type="button" disabled={data.loading||data.total<=(page+1)*20&&!('hasMore'in data&&data.hasMore)} onClick={()=>setPage(value=>value+1)}>{c('next')}</button></div>}
 </section></Modal>;
}
