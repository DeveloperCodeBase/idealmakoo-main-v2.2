'use client';
import Link from 'next/link';
import PublicImage from '@/components/ui/PublicImage';
import {demoMode} from '@/lib/api';
import {useEffect, useState, type ReactNode} from 'react';
import {ArrowUpRight, ArrowLeft, ExternalLink, BookOpen, Search, FileImage, X} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import type {Localized} from '@/data/catalog';
import './content.css';

export const L = (fa:string,en:string,tr:string,ar:string,ru:string):Localized => ({fa,en,tr,ar,ru});
export function useContentText(){const {locale}=useApp();return (value:Localized)=>value[locale];}
export function ContentIntro({eyebrow,title,description,children}:{eyebrow:string;title:string;description:string;children?:ReactNode}){return <header className="page-intro content-intro"><span className="eyebrow"><span className="content-signal"/>{eyebrow}</span><h1>{title}</h1><p>{description}</p>{children}</header>;}
export function SourceLink({url,children}:{url:string;children?:ReactNode}){const {t}=useApp();return <a className="content-source" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>{children||t('source')}<span dir="ltr">idealmakoo.com</span></a>;}
export function BackLink({path,label}:{path:string;label?:string}){const {href,t}=useApp();return <Link href={href(path)} className="content-back"><ArrowLeft size={16} className="content-back-arrow"/>{label||t('back')}</Link>;}
export function ContentEmpty({title,body,path,label,icon}:{title:string;body:string;path?:string;label?:string;icon?:ReactNode}){const {href}=useApp();return <div className="glass content-empty"><div className="content-empty-orbit"><div className="content-empty-icon">{icon||<BookOpen size={30}/>}</div></div><h2>{title}</h2><p>{body}</p>{path&&<Link className="btn btn-primary" href={href(path)}>{label}<ArrowUpRight size={17}/></Link>}</div>;}
export function ContentSearch({value,onChange,placeholder}:{value:string;onChange:(value:string)=>void;placeholder:string}){const {t}=useApp();return <div className="content-search"><Search size={19}/><input type="search" className="input" aria-label={placeholder} placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)}/>{value&&<button type="button" onClick={()=>onChange('')} aria-label={t('reset')}><X size={16}/></button>}</div>;}
export function ImageFallback({src,alt,className='',loading='lazy',fetchPriority}:{src?:string;alt:string;className?:string;loading?:'lazy'|'eager';fetchPriority?:'high'|'low'|'auto'}){const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);return src&&!failed?<PublicImage src={src} alt={alt} className={className} loading={loading} fetchPriority={fetchPriority} onError={()=>setFailed(true)}/>:<div className={`content-image-fallback ${className}`} role="img" aria-label={alt}><FileImage size={34}/></div>;}
export async function copyText(value:string):Promise<boolean>{try{if(navigator.clipboard){await navigator.clipboard.writeText(value);return true;}const field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.select();const ok=document.execCommand('copy');field.remove();return ok;}catch{return false;}}
export function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const topicLabels:Record<string,Localized>={all:L('همه پژوهش‌ها','All research','Tüm araştırmalar','كل البحوث','Все исследования'),wear:L('سایش و دوام','Wear & durability','Aşınma ve dayanıklılık','التآكل والمتانة','Износ и долговечность'),bond:L('اتصال و استحکام','Bonding & strength','Bağlantı ve dayanım','الارتباط والمتانة','Соединение и прочность'),materials:L('مواد دندانی','Dental materials','Dental malzemeler','المواد السنية','Стоматологические материалы')};
export const contentLabels={
 read:L('مطالعه مطلب','Read article','Makaleyi oku','اقرأ المقال','Читать материал'),
 noResults:L('نتیجه‌ای پیدا نشد','No results found','Sonuç bulunamadı','لم يتم العثور على نتائج','Ничего не найдено'),
 adjustSearch:L('عبارت جستجو یا فیلترها را تغییر دهید.','Try changing your search or filters.','Aramanızı veya filtreleri değiştirin.','جرّب تغيير البحث أو المرشحات.','Измените запрос или фильтры.'),
 researchIntro:L('پژوهش‌هایی درباره مواد، اتصال و ماندگاری؛ از آرشیو علمی وب‌سایت رسمی کارخانه.','Studies on materials, bonding and durability, from the official factory research archive.','Resmî fabrika araştırma arşivinden malzemeler, bağlantı ve dayanıklılık üzerine çalışmalar.','دراسات حول المواد والارتباط والمتانة من الأرشيف العلمي الرسمي للمصنع.','Исследования материалов, соединения и долговечности из официального научного архива фабрики.'),
 copied:L('پیوند کپی شد','Link copied','Bağlantı kopyalandı','تم نسخ الرابط','Ссылка скопирована'),
 copyFailed:L('کپی انجام نشد؛ می‌توانید پیوند را از نوار آدرس بردارید.','Copy failed; use the link in your address bar.','Kopyalanamadı; adres çubuğundaki bağlantıyı kullanın.','تعذر النسخ؛ استخدم الرابط في شريط العنوان.','Не удалось скопировать; используйте ссылку из адресной строки.'),
 downloadFail:L('دانلود انجام نشد. دوباره تلاش کنید.','Download failed. Please try again.','İndirme başarısız. Tekrar deneyin.','تعذر التنزيل. حاول مرة أخرى.','Не удалось скачать. Повторите попытку.'),
 localPreview:!demoMode?L('محتوای منتشرشده','Published content','Yayınlanmış içerik','محتوى منشور','Опубликованный материал'):L('انتشار محلی این نسخه','Published in this local preview','Bu yerel önizlemede yayınlandı','منشور في هذه المعاينة المحلية','Опубликовано в локальной версии'),
 archive:L('آرشیو رسمی کارخانه','Official factory archive','Resmî fabrika arşivi','أرشيف المصنع الرسمي','Официальный архив фабрики'),
 resultCount:L('مورد','items','öğe','عنصر','материалов'),
 original:L('مشاهده نسخه اصلی','View original source','Orijinal kaynağı görüntüle','عرض المصدر الأصلي','Открыть оригинальный источник'),
 summary:L('خلاصه پژوهش','Research summary','Araştırma özeti','ملخص البحث','Краткое содержание исследования'),
};

export {usePublications} from '@/lib/publications';
export type {PublishedContent as LocalPublication} from '@/lib/publications';
export function safeLink(value?:string):string|undefined{if(!value)return;return /^(https?:\/\/|\/(?!\/))/.test(value)?value:undefined;}
export function safeMedia(value?:string):string|undefined {if(!value)return;return /^(https?:\/\/|\/(?!\/)|blob:|data:image\/(png|jpeg|webp|gif);base64,)/.test(value)?value:undefined;}
