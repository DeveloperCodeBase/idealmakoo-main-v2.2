'use client';
import {useEffect,useRef,useState} from 'react';
import {Languages,Loader2,Save,X} from 'lucide-react';
import {apiClient,ApiError,demoMode,networkError} from '@/lib/api';
import type {ContentTranslationProposal} from '@/types/content-ai';
import type {WorkspaceStore} from './store';
import {L,localized,workspaceLocales,type WorkspaceLocale} from './i18n';
import {Field} from './ui';

const native={fa:'فارسی',en:'English',tr:'Türkçe',ar:'العربية',ru:'Русский'};
const copy={
 heading:L('ترجمهٔ هوش مصنوعی از نسخهٔ ذخیره‌شده','AI translation of saved content','Kayıtlı içeriğin yapay zekâ çevirisi','ترجمة المحتوى المحفوظ بالذكاء الاصطناعي','Перевод сохранённого материала с ИИ'),
 hint:L('متن همین نسخه برای ترجمه به ارائه‌دهندهٔ تنظیم‌شده ارسال می‌شود. خروجی را ویرایش و بررسی کنید؛ ذخیره فقط پیش‌نویس زبان مقصد را تغییر می‌دهد و انتشار به بازبینی جداگانه نیاز دارد.','The saved text is sent to your configured provider for translation. Edit and review the result; saving changes only the target draft, and publication requires separate review.','Kayıtlı metin çeviri için yapılandırılmış sağlayıcıya gönderilir. Sonucu düzenleyip inceleyin; kaydetmek yalnızca hedef taslağı değiştirir ve yayımlama ayrı inceleme gerektirir.','يُرسل النص المحفوظ إلى المزوّد المحدد للترجمة. حرر النتيجة وراجعها؛ يغيّر الحفظ مسودة اللغة المستهدفة فقط ويتطلب النشر مراجعة منفصلة.','Сохранённый текст отправляется настроенному поставщику для перевода. Отредактируйте и проверьте результат: сохранение меняет только целевой черновик, а публикация требует отдельной проверки.'),
 source:L('زبان مبدأ','Source language','Kaynak dil','لغة المصدر','Исходный язык'),
 generate:L('ساخت پیشنهاد ترجمه','Generate translation proposal','Çeviri önerisi oluştur','إنشاء اقتراح ترجمة','Создать предложение перевода'),
 generating:L('در حال ترجمهٔ متن ذخیره‌شده…','Translating saved content…','Kayıtlı içerik çevriliyor…','جارٍ ترجمة المحتوى المحفوظ…','Перевод сохранённого материала…'),
 save:L('ذخیرهٔ متن بررسی‌شده به‌عنوان پیش‌نویس','Save reviewed text as a draft','İncelenen metni taslak olarak kaydet','حفظ النص المراجع كمسودة','Сохранить проверенный текст как черновик'),
 cancel:L('لغو','Cancel','İptal','إلغاء','Отмена'),
 discard:L('کنار گذاشتن پیشنهاد','Discard proposal','Öneriyi sil','تجاهل الاقتراح','Отменить предложение'),
 dirty:L('ابتدا تغییرات فرم را ذخیره یا کنار بگذارید و نسخهٔ جاری را بارگذاری کنید.','Save or discard form edits and load the current revision first.','Önce form değişikliklerini kaydedin veya silin ve güncel sürümü yükleyin.','احفظ تعديلات النموذج أو تجاهلها وحمّل الإصدار الحالي أولاً.','Сначала сохраните или отмените изменения формы и загрузите актуальную версию.'),
 expiry:L('اعتبار پیشنهاد تا','Proposal valid until','Öneri geçerlilik süresi','الاقتراح صالح حتى','Предложение действительно до'),
 configured:L('مدیر باید کلید سرویس و یک مدل متنی سازگار با خروجی ساختاریافته را در تنظیمات امن سرور قرار دهد.','An administrator must configure the provider key and a text model supporting structured output in the protected server settings.','Yönetici, sağlayıcı anahtarını ve yapılandırılmış çıktıyı destekleyen bir metin modelini güvenli sunucu ayarlarında yapılandırmalıdır.','يجب على المسؤول ضبط مفتاح المزوّد ونموذج نصي يدعم المخرجات المنظمة في إعدادات الخادم المحمية.','Администратор должен задать ключ поставщика и текстовую модель со структурированным выводом в защищённых настройках сервера.'),
 invalid:L('خروجی ترجمه کامل یا معتبر نبود؛ محتوای سایت تغییر نکرد. مدل تنظیم‌شده و متن مبدأ را بررسی کنید.','The translation was incomplete or invalid; site content was not changed. Check the configured model and source text.','Çeviri eksik veya geçersizdi; site içeriği değiştirilmedi. Modeli ve kaynak metni kontrol edin.','كانت الترجمة ناقصة أو غير صالحة؛ لم يتغير محتوى الموقع. تحقق من النموذج المحدد والنص المصدر.','Перевод неполон или некорректен; содержимое сайта не изменено. Проверьте модель и исходный текст.'),
 missing:L('ابتدا یک عنوان و متن معتبر در زبان مبدأ ذخیره کنید. پیش‌نویس نامعتبر محصول باید در ویرایشگر محصول اصلاح شود.','First save a valid title and text in the source language. Repair an invalid product draft in the product editor.','Önce kaynak dilde geçerli bir başlık ve metin kaydedin. Geçersiz ürün taslağını ürün düzenleyicisinde düzeltin.','احفظ أولاً عنواناً ونصاً صالحين بلغة المصدر. أصلح مسودة المنتج غير الصالحة في محرر المنتج.','Сначала сохраните корректный заголовок и текст на исходном языке. Некорректный черновик продукта исправьте в редакторе продукта.'),
 structure:L('چیدمان بلوک‌های ذخیره‌شدهٔ مبدأ و مقصد باید یکسان باشد. بلوک مشترک را در ویرایشگر خودش ترجمه کنید یا ابتدا آن را جدا کنید.','The saved source and target block structures must match. Translate a shared block in its own editor or detach it first.','Kayıtlı kaynak ve hedef blok yapıları eşleşmelidir. Paylaşılan bloğu kendi düzenleyicisinde çevirin veya önce ayırın.','يجب أن تتطابق بنية كتل المصدر والهدف المحفوظة. ترجم الكتلة المشتركة في محررها أو افصلها أولاً.','Структуры блоков сохранённого источника и перевода должны совпадать. Общий блок переведите в его редакторе или сначала отсоедините его.'),
 long:L('متن برای یک درخواست ترجمه طولانی است. بخش‌های کوچک‌تر را در استودیوی محتوا ترجمه و در فیلد مربوط ذخیره کنید.','This text is too long for one translation request. Translate smaller sections in the content studio and save them to their matching fields.','Bu metin tek çeviri isteği için çok uzun. Daha küçük bölümleri içerik stüdyosunda çevirip ilgili alanlara kaydedin.','النص طويل لطلب ترجمة واحد. ترجم أقساماً أصغر في استوديو المحتوى واحفظها في حقولها.','Текст слишком длинный для одного запроса перевода. Переводите небольшие разделы в студии контента и сохраняйте их в соответствующих полях.'),
 expired:L('مهلت پیشنهاد تمام شده است. از نسخهٔ جاری پیشنهاد تازه بسازید.','This proposal expired. Generate a new proposal from the current revision.','Önerinin süresi doldu. Güncel sürümden yeni bir öneri oluşturun.','انتهت صلاحية الاقتراح. أنشئ اقتراحاً جديداً من الإصدار الحالي.','Срок предложения истёк. Создайте новое из актуальной версии.'),
 cancelled:L('درخواست ترجمه لغو شد.','Translation request cancelled.','Çeviri isteği iptal edildi.','أُلغي طلب الترجمة.','Запрос перевода отменён.'),
 title:L('عنوان','Title','Başlık','العنوان','Заголовок'),summary:L('خلاصه','Summary','Özet','الملخص','Краткое описание'),body:L('متن کامل','Full text','Tam metin','النص الكامل','Полный текст'),aliases:L('نام‌های جایگزین، هر مورد در یک خط','Aliases, one per line','Takma adlar, her satırda bir tane','الأسماء البديلة، اسم في كل سطر','Альтернативные названия, по одному в строке'),blockTitle:L('عنوان بلوک','Block title','Blok başlığı','عنوان الكتلة','Заголовок блока'),blockBody:L('متن بلوک','Block text','Blok metni','نص الكتلة','Текст блока'),primaryAction:L('متن دکمهٔ اصلی','Primary button label','Ana düğme etiketi','تسمية الزر الرئيسي','Текст основной кнопки'),secondaryAction:L('متن دکمهٔ دوم','Secondary button label','İkincil düğme etiketi','تسمية الزر الثانوي','Текст дополнительной кнопки'),
};
export interface AiContentTranslationProps {store:WorkspaceStore;bucket:'records'|'pages';id:string;locale:WorkspaceLocale;capturedUpdatedAt:string;dirty:boolean;editable:boolean;sourceLocale?:WorkspaceLocale}

export default function AiContentTranslation({store,bucket,id,locale,capturedUpdatedAt,dirty,editable,sourceLocale}:AiContentTranslationProps){
 const [selected,setSelected]=useState<WorkspaceLocale>(sourceLocale||(locale==='fa'?'en':'fa'));
 const source=sourceLocale||selected;
 const [proposal,setProposal]=useState<ContentTranslationProposal|null>(null),[values,setValues]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const request=useRef<AbortController|null>(null),generation=useRef(0),pending=useRef(false);
 const tr=(key:keyof typeof copy)=>localized(copy[key],store.locale);
 const authorized=store.permit('create','ai',locale)&&store.actor.allowedLocales?.includes(locale);
 const allowed=authorized&&editable&&!dirty&&!demoMode&&source!==locale;
 const identity=[store.actorId,store.role,bucket,id,locale,source,capturedUpdatedAt].join(':');
 const live=useRef({identity,allowed});live.current={identity,allowed};
 useEffect(()=>{generation.current++;request.current?.abort();request.current=null;pending.current=false;setBusy(false);setProposal(null);setValues({});setError('');return()=>{generation.current++;request.current?.abort();};},[identity]);
 useEffect(()=>{if(!authorized){generation.current++;request.current?.abort();pending.current=false;setBusy(false);setProposal(null);setValues({});}},[authorized]);
 const errorText=(value:unknown)=>{
  const code=value instanceof ApiError?value.problem.code:'';
  if(code==='NOT_CONFIGURED')return tr('configured');
  if(['TRANSLATION_PROTECTED','TRANSLATION_OUTPUT','TRANSLATION_LANGUAGE','TRANSLATION_TOKEN'].includes(code))return tr('invalid');
  if(['TRANSLATION_SOURCE','TRANSLATION_PRODUCT'].includes(code))return tr('missing');
  if(['TRANSLATION_STRUCTURE','TRANSLATION_SHARED_BLOCK'].includes(code))return tr('structure');
  if(code==='TRANSLATION_SIZE')return tr('long');
  if(code==='TRANSLATION_EXPIRED')return tr('expired');
  return networkError(value,store.locale);
 };
 const generate=async()=>{
  if(!allowed||pending.current||store.pending)return;
  const stamp=++generation.current,owner=identity,controller=new AbortController();request.current=controller;pending.current=true;setBusy(true);setError('');setProposal(null);setValues({});
  try{
   const result=await apiClient.request<ContentTranslationProposal>('/workspace/translations/propose',{method:'POST',body:JSON.stringify({bucket,id,locale,sourceLocale:source,expectedUpdatedAt:capturedUpdatedAt}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(195000)])});
   if(stamp!==generation.current||live.current.identity!==owner||!live.current.allowed)return;
   if(result.bucket!==bucket||result.documentId!==id||result.locale!==locale||result.sourceLocale!==source||result.status!=='proposed'||typeof result.token!=='string'||!Array.isArray(result.fields)||!result.fields.length||result.fields.some(field=>typeof field.key!=='string'||typeof field.value!=='string'||!Number.isSafeInteger(field.maxLength))||!Number.isFinite(Date.parse(result.expiresAt)))throw new Error('Invalid translation proposal');
   setProposal(result);setValues(Object.fromEntries(result.fields.map(field=>[field.key,field.value])));
  }catch(value){if(stamp===generation.current&&!controller.signal.aborted)setError(errorText(value));}
  finally{if(stamp===generation.current){pending.current=false;setBusy(false);request.current=null;}}
 };
 const save=async()=>{
  if(!proposal||!allowed||pending.current||saving||store.pending)return;
  if(Date.parse(proposal.expiresAt)<=Date.now()){setError(tr('expired'));return;}
  const owner=identity,stamp=generation.current;setSaving(true);pending.current=true;setError('');
  try{const ok=await store.command('/workspace/translations/apply',{token:proposal.token,values});if(ok&&live.current.identity===owner&&stamp===generation.current){setProposal(null);setValues({});}}
  finally{pending.current=false;setSaving(false);}
 };
 if(!authorized||demoMode)return null;
 return <section className="ws-card"><div className="ws-card-head"><h3><Languages size={18} aria-hidden="true"/> {tr('heading')}</h3></div><p className="ws-inline-note">{tr('hint')}</p>{!sourceLocale&&<Field label={tr('source')}><select className="input" value={source} disabled={busy||saving||store.pending} onChange={event=>setSelected(event.target.value as WorkspaceLocale)}>{workspaceLocales.filter(lang=>lang!==locale).map(lang=><option key={lang} value={lang}>{native[lang]}</option>)}</select></Field>}{dirty&&<p role="status">{tr('dirty')}</p>}{error&&<p role="alert">{error}</p>}<div className="ws-toolbar"><button type="button" className="btn" disabled={!allowed||busy||saving||store.pending} onClick={()=>void generate()}>{busy?<Loader2 size={17} className="spin" aria-hidden="true"/>:<Languages size={17} aria-hidden="true"/>}{busy?tr('generating'):tr('generate')}</button>{busy&&<button type="button" className="btn" onClick={()=>{generation.current++;request.current?.abort();request.current=null;pending.current=false;setBusy(false);setError(tr('cancelled'));}}><X size={17} aria-hidden="true"/>{tr('cancel')}</button>}</div>{proposal&&<div><p>{proposal.provider} · {proposal.model} · {tr('expiry')} {new Intl.DateTimeFormat(store.locale,{dateStyle:'short',timeStyle:'short'}).format(new Date(proposal.expiresAt))}</p><div lang={locale} dir={['fa','ar'].includes(locale)?'rtl':'ltr'}>{proposal.fields.map(field=><Field key={field.key} label={`${tr(field.label in copy?field.label as keyof typeof copy:'body')}${field.key.startsWith('blocks.')?' · '+(Number(field.key.split('.')[1])+1):''}`}><textarea className="input" rows={field.label==='body'||field.label==='blockBody'?8:3} maxLength={field.maxLength} disabled={!allowed||saving||store.pending} value={values[field.key]||''} onChange={event=>setValues(current=>({...current,[field.key]:event.target.value}))}/></Field>)}</div><div className="ws-toolbar"><button type="button" className="btn btn-primary" disabled={!allowed||saving||store.pending||!values.title?.trim()} onClick={()=>void save()}>{saving?<Loader2 size={17} className="spin" aria-hidden="true"/>:<Save size={17} aria-hidden="true"/>}{tr('save')}</button><button type="button" className="btn" disabled={saving||store.pending} onClick={()=>{setProposal(null);setValues({});setError('');}}>{tr('discard')}</button></div></div>}</section>;
}
