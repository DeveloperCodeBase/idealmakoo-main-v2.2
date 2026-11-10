'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {Database,RefreshCw,Save} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {controlledAccountKey,useControlledApi} from '@/components/controlled/useControlledApi';
import {ApiError,demoMode} from '@/lib/api';
import {localized} from '@/lib/i18n';
import {storagePolicyFields,storagePolicyForm,parseStoragePolicyForm,type StoragePolicyForm} from '@/lib/storage-policy-form';
import {UPLOAD_POLICY_EVENT} from '@/lib/use-upload-policy';
import type {ManagedStoragePolicy} from '@/lib/upload-policy';
import type {WorkspaceStore} from './store';
import styles from '@/components/controlled/controlled.module.css';

const copy={
 title:localized('فضای فایل‌ها و محدودیت بارگذاری','File storage and upload limits','Dosya alanı ve yükleme sınırları','مساحة الملفات وحدود الرفع','Хранилище и ограничения загрузки'),
 note:localized('حدود برای تمام بارگذاری‌های بعدی اعمال می‌شوند. فایل‌های موجود با کاهش سقف حذف نمی‌شوند؛ بارگذاری تازه تا آزاد شدن فضا متوقف می‌شود.','Limits apply to subsequent uploads. Lowering a quota retains existing files and blocks new uploads until space is available.','Sınırlar sonraki yüklemelerde uygulanır. Kota azaltılınca mevcut dosyalar korunur; yer açılana kadar yeni yüklemeler engellenir.','تسري الحدود على عمليات الرفع التالية. خفض الحصة يحفظ الملفات الحالية ويوقف الرفع الجديد حتى تتوفر مساحة.','Ограничения действуют для следующих загрузок. При уменьшении квоты существующие файлы сохраняются, новые загрузки ждут освобождения места.'),
 units:localized('همهٔ مقدارها بر حسب MiB هستند؛ هر MiB برابر ۱٬۰۴۸٬۵۷۶ بایت است.','All values use MiB; one MiB is 1,048,576 bytes.','Tüm değerler MiB cinsindedir; bir MiB 1.048.576 bayttır.','القيم بوحدة MiB؛ كل MiB يساوي ١٬٠٤٨٬٥٧٦ بايت.','Все значения в MiB; один MiB равен 1 048 576 байтам.'),
 maxFileBytes:localized('سقف عمومی هر فایل','Overall limit per file','Dosya başına genel sınır','الحد العام لكل ملف','Общий предел на файл'),
 image:localized('هر تصویر','Each image','Her görsel','كل صورة','Изображение'),document:localized('هر سند','Each document','Her belge','كل مستند','Документ'),video:localized('هر ویدیو','Each video','Her video','كل فيديو','Видео'),audio:localized('هر فایل صوتی','Each audio file','Her ses dosyası','كل ملف صوتي','Аудиофайл'),
 totalBytes:localized('سهم کل فضای وب‌سایت','Total website quota','Toplam site kotası','الحصة الكلية للموقع','Общая квота сайта'),
 userBytes:localized('سهم هر حساب','Quota per account','Hesap başına kota','حصة كل حساب','Квота на аккаунт'),
 guestBytes:localized('سهم هر بازدیدکننده','Quota per guest','Misafir başına kota','حصة كل زائر','Квота на гостя'),
 stored:localized('فایل‌های ذخیره‌شده','Stored files','Kaydedilen dosyalar','الملفات المخزنة','Сохранённые файлы'),reserved:localized('فضای رزروشده برای پردازش','Reserved processing space','İşleme için ayrılan alan','المساحة المحجوزة للمعالجة','Место, зарезервированное для обработки'),
 version:localized('نسخهٔ سیاست','Policy version','Politika sürümü','إصدار السياسة','Версия политики'),
 save:localized('ذخیره و اعمال محدودیت‌ها','Save and apply limits','Sınırları kaydet ve uygula','حفظ الحدود وتطبيقها','Сохранить и применить'),refresh:localized('خواندن نسخهٔ فعلی سرور','Load current server version','Güncel sunucu sürümünü yükle','تحميل إصدار الخادم الحالي','Загрузить текущую версию сервера'),
 invalid:localized('مقادیر باید مثبت و معادل تعداد صحیح بایت باشند. سقف هر نوع نباید از سقف فایل بیشتر شود و سهم حساب و مهمان باید در سهم سایت جا بگیرد.','Values must be positive and represent whole bytes. Type limits must fit the file limit; account and guest quotas must fit the site quota.','Değerler pozitif ve tam bayt olmalıdır. Tür sınırları dosya sınırını; hesap ve misafir kotaları site kotasını aşamaz.','يجب أن تكون القيم موجبة وتمثل بايتات صحيحة. حدود الأنواع لا تتجاوز حد الملف، وحصص الحساب والزائر لا تتجاوز حصة الموقع.','Значения должны быть положительными и соответствовать целым байтам. Пределы типов не выше предела файла; квоты аккаунта и гостя не выше квоты сайта.'),
 conflict:localized('سیاست در نشست دیگری تغییر کرده است. پیش‌نویس شما حفظ شد؛ نسخهٔ فعلی سرور را بخوانید و دوباره بررسی کنید.','Another session changed the policy. Your draft is retained; load and review the current server version before retrying.','Başka oturum politikayı değiştirdi. Taslak korundu; yeniden denemeden önce güncel sürümü yükleyip inceleyin.','غيّرت جلسة أخرى السياسة. حُفظت مسودتك؛ حمّل الإصدار الحالي وراجعه قبل إعادة المحاولة.','Политика изменилась в другом сеансе. Черновик сохранён; перед повтором загрузите и проверьте текущую версию.'),
 saved:localized('محدودیت‌ها در سرور ذخیره و اعمال شدند.','The server saved and applied the limits.','Sunucu sınırları kaydedip uyguladı.','حفظ الخادم الحدود وطبّقها.','Сервер сохранил и применил ограничения.'),
 loading:localized('دریافت وضعیت فضای فایل…','Loading storage status…','Depolama durumu yükleniyor…','جارٍ تحميل حالة التخزين…','Загрузка состояния хранилища…'),
 ceiling:localized('سقف ایمنی هر فایل','Per-file safety ceiling','Dosya başına güvenlik tavanı','سقف الأمان لكل ملف','Защитный предел на файл'),
};
export default function StoragePolicySettings({store}:{store:WorkspaceStore}){
 const {session}=useApp();if(demoMode||!['admin','superAdmin'].includes(store.role))return null;
 return <Settings key={controlledAccountKey(session,store.locale)} store={store}/>;
}
function Settings({store}:{store:WorkspaceStore}){
 const locale=store.locale,api=useControlledApi(locale),t=(key:keyof typeof copy)=>copy[key][locale];
 const [base,setBase]=useState<ManagedStoragePolicy|null>(null),[draft,setDraft]=useState<StoragePolicyForm|null>(null),[stale,setStale]=useState(false),[notice,setNotice]=useState(''),[validation,setValidation]=useState('');
 const load=async()=>{const value=await api.request<ManagedStoragePolicy>('/admin/storage-policy');if(!api.alive())return;setBase(value);setDraft(storagePolicyForm(value.limits));setStale(false);setNotice('');setValidation('');};
 useEffect(()=>{void load().catch(api.fail);},[]);
 const save=(event:FormEvent)=>{event.preventDefault();if(!base||!draft||stale)return;const limits=parseStoragePolicyForm(draft,base.hardMaxFileBytes);if(!limits){setValidation(t('invalid'));return;}setValidation('');void api.run(async()=>{
  try{const value=await api.request<ManagedStoragePolicy>('/admin/storage-policy',{method:'PUT',body:JSON.stringify({expectedVersion:base.version,limits})});if(!api.alive())return;setBase(value);setDraft(storagePolicyForm(value.limits));setNotice(t('saved'));window.dispatchEvent(new Event(UPLOAD_POLICY_EVENT));}
  catch(cause){if(cause instanceof ApiError&&cause.status===409){setStale(true);setValidation(t('conflict'));throw cause;}throw cause;}
 });};
 const amount=(bytes:string|number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(Number(bytes)/1024**2)+' MiB';
 return <section className={styles.card} aria-label={t('title')}><header className={styles.header}><h2><Database size={20}/> {t('title')}</h2><button className="btn" type="button" disabled={api.busy} onClick={()=>void api.run(load)}><RefreshCw size={16}/>{t('refresh')}</button></header><p>{t('note')}</p><p className={styles.muted}>{t('units')}</p>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}{validation&&<p className={styles.error} role="alert">{validation}</p>}{notice&&<p role="status">{notice}</p>}{!base&&!api.error&&<p role="status">{t('loading')}</p>}
  {base&&draft&&<><dl className={styles.grid}><div><dt>{t('stored')}</dt><dd><bdi>{amount(base.usage.storedBytes)}</bdi></dd></div><div><dt>{t('reserved')}</dt><dd><bdi>{amount(base.usage.reservedBytes)}</bdi></dd></div><div><dt>{t('version')}</dt><dd>{base.version}</dd></div><div><dt>{t('ceiling')}</dt><dd><bdi>{amount(base.hardMaxFileBytes)}</bdi></dd></div></dl><form className={styles.form} onSubmit={save}><fieldset disabled={api.busy||!base.canEdit||stale} style={{border:0,padding:0}}><div className={styles.grid}>{storagePolicyFields.map(field=><label key={field}>{t(field)} · MiB<input type="number" min={1/1024**2} step="any" required value={draft[field]} dir="ltr" onChange={event=>{setDraft({...draft,[field]:event.target.value});setNotice('');}}/></label>)}</div><button className="btn btn-primary" type="submit"><Save size={16}/>{t('save')}</button></fieldset></form></>}
 </section>;
}
