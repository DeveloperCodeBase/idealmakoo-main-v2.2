'use client';
import {useState} from 'react';
import {FileText,Search} from 'lucide-react';
import {direction,localized,translate,type Locale} from '@/lib/i18n';
import {editablePublicCopyKeys,publicSeoPaths,type EditablePublicCopyKey,type PublicRouteSeo} from '@/lib/site-editorial-settings';
import type {SitePreferences} from '@/lib/site-preferences';
import styles from './SiteSettings.module.css';

const copy={
 title:localized('متن‌های عمومی هر زبان','Public text by language','Dile göre genel metinler','النصوص العامة لكل لغة','Публичные тексты по языкам'),
 note:localized('متن انتخاب‌شده فقط در زبان محتوا تغییر می‌کند. خالی کردن مقدار، متن اصلی همان زبان را برمی‌گرداند. بخش‌های صفحه و محتوای اصلی در صفحه‌ساز مدیریت می‌شوند.','Overrides affect only the selected content language. Clear a value to restore the original text in that language. Manage page sections and body content in the page builder.','Değişiklik yalnızca seçili içerik dilini etkiler. Özgün metne dönmek için değeri temizleyin. Sayfa bölümleri ve içerik sayfa oluşturucuda yönetilir.','التعديل يخص لغة المحتوى المحددة فقط. امسح القيمة لاستعادة النص الأصلي لتلك اللغة. تُدار الأقسام والمحتوى في منشئ الصفحات.','Изменение действует только для выбранного языка. Очистите поле, чтобы вернуть исходный текст этого языка. Разделы и содержание редактируются в конструкторе страниц.'),
 field:localized('متن قابل ویرایش','Editable text','Düzenlenebilir metin','النص القابل للتحرير','Редактируемый текст'),
 value:localized('متن جایگزین','Replacement text','Yeni metin','النص البديل','Новый текст'),
 original:localized('متن اولیهٔ این زبان','Original text in this language','Bu dildeki özgün metin','النص الأصلي بهذه اللغة','Исходный текст этого языка'),
 reset:localized('بازگشت به متن اولیه','Restore original text','Özgün metni geri yükle','استعادة النص الأصلي','Вернуть исходный текст'),
 seo:localized('عنوان و توضیح نتایج جستجو','Search titles and descriptions','Arama başlıkları ve açıklamaları','عناوين البحث وأوصافه','Заголовки и описания для поиска'),
 seoNote:localized('عنوان و توضیح برای همین مسیر و همین زبان ذخیره می‌شوند. مقدار خالی از محتوای منتشرشده گرفته می‌شود. پنهان کردن از جستجو، صفحه را خصوصی نمی‌کند. متادیتای مقالات و محصولات در همان محتوای مربوط ویرایش می‌شود.','Titles and descriptions apply to this route and language. Empty fields use the published content. Excluding a page from search does not make it private. Edit article and product metadata within their content records.','Başlık ve açıklama bu yol ve dil için geçerlidir. Boş alanlar yayımlanan içerikten alınır. Aramadan çıkarmak sayfayı özel yapmaz. Makale ve ürün meta verileri kendi kayıtlarında düzenlenir.','تُحفظ العناوين والأوصاف لهذا المسار واللغة. الحقول الفارغة تعتمد المحتوى المنشور. الاستبعاد من البحث لا يجعل الصفحة خاصة. تُحرر بيانات المقالات والمنتجات داخل سجلاتها.','Заголовок и описание относятся к выбранному адресу и языку. Пустые поля берутся из опубликованного содержания. Исключение из поиска не закрывает доступ. Метаданные статей и продуктов редактируются в их записях.'),
 route:localized('مسیر صفحه','Page route','Sayfa yolu','مسار الصفحة','Адрес страницы'),
 seoTitle:localized('عنوان جستجو — اختیاری','Search title — optional','Arama başlığı — isteğe bağlı','عنوان البحث — اختياري','Заголовок для поиска — необязательно'),
 description:localized('توضیح جستجو — اختیاری','Search description — optional','Arama açıklaması — isteğe bağlı','وصف البحث — اختياري','Описание для поиска — необязательно'),
 noindex:localized('درج نشدن این نسخهٔ زبانی در نتایج جستجو','Exclude this language version from search indexing','Bu dil sürümünü arama dizininden çıkar','استبعاد هذا الإصدار اللغوي من فهرسة البحث','Исключить эту языковую версию из поискового индекса'),
 error:localized('متن عمومی باید در زبان معتبر و حداکثر ۲۰۰۰ نویسه باشد؛ عنوان جستجو ۱۶۰ و توضیح ۵۰۰ نویسه.','Public text must use a supported language and at most 2,000 characters; search titles allow 160 and descriptions 500 characters.','Genel metin desteklenen dilde en fazla 2.000 karakter; arama başlığı 160 ve açıklama 500 karakter olabilir.','النص العام بلغة مدعومة وبحد أقصى ٢٠٠٠ حرف؛ العنوان ١٦٠ والوصف ٥٠٠ حرف.','Публичный текст — до 2000 символов на поддерживаемом языке; заголовок — 160, описание — 500.'),
};
export const siteEditorialError=(locale:Locale)=>copy.error[locale];
type Props={draft:SitePreferences;locale:Locale;targetLocale:Locale;allowed:boolean;change:(update:(value:SitePreferences)=>SitePreferences)=>void};
export default function SiteEditorialSettings({draft,locale,targetLocale,allowed,change}:Props){
 const [key,setKey]=useState<EditablePublicCopyKey>('heroTitle'),[path,setPath]=useState('');
 const t=(name:keyof typeof copy)=>copy[name][locale],source=translate(targetLocale,key),override=draft.uiText?.[targetLocale]?.[key]||'';
 const seo=draft.seo?.[path]?.[targetLocale]||{title:'',description:'',noindex:false};
 const replace=(text:string)=>change(value=>{const entries={...value.uiText?.[targetLocale]};if(text.trim())entries[key]=text;else delete entries[key];return {...value,uiText:{...value.uiText,[targetLocale]:entries}};});
 const patchSeo=(patch:Partial<PublicRouteSeo>)=>change(value=>({...value,seo:{...value.seo,[path]:{...value.seo?.[path],[targetLocale]:{...seo,...patch}}}}));
 return <section className={styles.brandGrid}>
  <div className={styles.card}><h3><FileText size={20}/>{t('title')}</h3><p className={styles.hint}>{t('note')}</p><div className={styles.fields}>
   <label className={styles.field}><span>{t('field')}</span><select value={key} onChange={event=>setKey(event.target.value as EditablePublicCopyKey)}>{editablePublicCopyKeys.map(item=><option key={item} value={item}>{translate(targetLocale,item).replaceAll('\n',' ').slice(0,90)}</option>)}</select></label>
   <label className={styles.field}><span>{t('value')} · {targetLocale.toUpperCase()}</span><textarea dir={direction(targetLocale)} rows={4} maxLength={2000} disabled={!allowed} value={override} placeholder={source} onChange={event=>replace(event.target.value)}/></label>
   <p className={styles.hint}>{t('original')}: <bdi lang={targetLocale}>{source}</bdi></p><button type="button" className={styles.secondary} disabled={!allowed||!override} onClick={()=>replace('')}>{t('reset')}</button>
  </div></div>
  <div className={styles.card}><h3><Search size={20}/>{t('seo')}</h3><p className={styles.hint}>{t('seoNote')}</p><div className={styles.fields}>
   <label className={styles.field}><span>{t('route')}</span><select dir="ltr" value={path} onChange={event=>setPath(event.target.value)}>{publicSeoPaths.map(route=><option key={route||'home'} value={route}>/{targetLocale}/{route}{route?'/':''}</option>)}</select></label>
   <label className={styles.field}><span>{t('seoTitle')}</span><input dir={direction(targetLocale)} value={seo.title} maxLength={160} disabled={!allowed} onChange={event=>patchSeo({title:event.target.value})}/></label>
   <label className={styles.field}><span>{t('description')}</span><textarea rows={4} dir={direction(targetLocale)} value={seo.description} maxLength={500} disabled={!allowed} onChange={event=>patchSeo({description:event.target.value})}/></label>
   <label className={styles.field}><span><input type="checkbox" checked={seo.noindex} disabled={!allowed} onChange={event=>patchSeo({noindex:event.target.checked})}/> {t('noindex')}</span></label>
  </div></div>
 </section>;
}
