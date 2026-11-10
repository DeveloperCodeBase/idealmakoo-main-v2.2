'use client';
import type {Locale} from '@/lib/i18n';
import {localized} from '@/lib/i18n';
import type {PublicUploadPolicy} from '@/lib/upload-policy';

export const uploadPolicyCopy={
 loading:localized('دریافت محدودیت مجاز فایل…','Loading current file limits…','Güncel dosya sınırları yükleniyor…','جارٍ تحميل حدود الملفات الحالية…','Загрузка действующих ограничений…'),
 limit:localized('حداکثر هر فایل','Maximum per file','Dosya başına en fazla','الحد الأقصى للملف','Максимум на файл'),
 image:localized('تصویر','Image','Görsel','صورة','Изображение'),
 document:localized('سند','Document','Belge','مستند','Документ'),
 video:localized('ویدیو','Video','Video','فيديو','Видео'),
 audio:localized('صوت','Audio','Ses','صوت','Аудио'),
 invalid:localized('نوع یا حجم فایل با محدودیت فعلی مدیر سازگار نیست.','The file type or size does not meet the current administrator limits.','Dosyanın türü veya boyutu güncel yönetici sınırlarına uymuyor.','نوع الملف أو حجمه لا يطابق حدود المسؤول الحالية.','Тип или размер файла не соответствует действующим ограничениям администратора.'),
 unavailable:localized('بارگذاری فایل در این نشست مجاز نیست.','Uploads are unavailable for this session.','Bu oturumda dosya yüklenemiyor.','رفع الملفات غير متاح لهذه الجلسة.','Загрузка файлов недоступна в этом сеансе.'),
 refresh:localized('دریافت دوبارهٔ محدودیت‌ها','Refresh file limits','Dosya sınırlarını yenile','تحديث حدود الملفات','Обновить ограничения'),
};
const fileLimitFormatters=new Map<Locale,Intl.NumberFormat>();
export function fileLimitText(bytes:number,locale:Locale){
 let formatter=fileLimitFormatters.get(locale);
 if(!formatter){
  formatter=new Intl.NumberFormat(locale,{maximumFractionDigits:2});
  // Keep the formatter reusable across the five labels and later policy
  // refreshes. Numeric limits remain live values supplied by the server.
  if(fileLimitFormatters.size<5)fileLimitFormatters.set(locale,formatter);
 }
 return `${formatter.format(bytes/1024/1024)} MiB`;
}
export default function UploadPolicyHint({policy,locale}:{policy:PublicUploadPolicy|null;locale:Locale}) {
 if(!policy)return <span role="status">{uploadPolicyCopy.loading[locale]}</span>;
 return <span>{uploadPolicyCopy.limit[locale]}: <bdi>{fileLimitText(policy.maxFileBytes,locale)}</bdi> · {(['image','document','video','audio'] as const).map((kind,index)=><span key={kind}>{index>0?' · ':''}{uploadPolicyCopy[kind][locale]}: <bdi>{fileLimitText(policy.byType[kind],locale)}</bdi></span>)}</span>;
}
