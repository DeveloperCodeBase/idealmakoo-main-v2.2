'use client';
import {apiClient,demoMode,networkError} from '@/lib/api';
import RenderedMediaJobs from './RenderedMediaJobs';
import KnowledgeIndex from './KnowledgeIndex';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, AudioLines, Clipboard, Download, FileText, Image as ImageIcon, Languages, Loader2, Plus, Save, Sparkles, UploadCloud, Video, WandSparkles, X } from 'lucide-react';
import { products as canonicalProducts, type Product } from '@/data/catalog';
import type { AIJob, PageDraft, WorkspaceMedia } from '@/data/workspace-seed';
import { workspaceProducts } from '@/lib/custom-products';
import { catalogFromPublications, getPublishedProductInventory, usePublications } from '@/lib/publications';
import { canWorkspace } from '@/lib/auth';
import {productTranslationFields,productTranslationPatch} from '@/lib/product-translation';
import { aiCopy, aiErrorMessage, AiRequestError, requestAi, type AiStatus } from '@/lib/ai-client';
import AiMarkdown, { sourceTitle } from '@/components/ui/AiMarkdown';
import { type WorkspaceStore, downloadFile, now, uid } from './store';
import { L, type WorkspaceLocale, localized, workspaceLocales, wt } from './i18n';
import { Empty, Field, safeDate } from './ui';
import { buildStudioRequest, normalizeStudioJob, productReferenceImage, resultStudioJob, StudioRequestGate, studioImageData, studioLink, validStudioReference, type StudioMode } from './studio-ai';
import './studio-ai.css';

const nativeNames = { fa: 'فارسی', en: 'English', tr: 'Türkçe', ar: 'العربية', ru: 'Русский' };
const modes = [{ id: 'text', icon: FileText }, { id: 'image', icon: ImageIcon }, { id: 'video', icon: Video }, { id: 'audio', icon: AudioLines }, { id: 'translation', icon: Languages }, { id: 'rewrite', icon: WandSparkles }, { id: 'document', icon: FileText }] as const;
const copy = {
  // Keep the introductory line stable while provider capabilities load. The
  // selected provider remains visible on the action and data-transfer notice.
  intro: L('از ایده تا محتوای آمادهٔ بازبینی، با منابع ایده‌آل ماکو.', 'From an idea to content ready for review, using Ideal Makoo sources.', 'Ideal Makoo kaynaklarıyla fikirden incelemeye hazır içeriğe.', 'من الفكرة إلى محتوى جاهز للمراجعة، بالاعتماد على مصادر إيديال ماكو.', 'От идеи до материала для проверки с использованием источников Ideal Makoo.'),
  lab: L('کارگاه محتوا', 'CONTENT LAB', 'İÇERİK ATÖLYESİ', 'مختبر المحتوى', 'СТУДИЯ КОНТЕНТА'),
  checking: L('بررسی اتصال…', 'Checking connection…', 'Bağlantı kontrol ediliyor…', 'جارٍ فحص الاتصال…', 'Проверка подключения…'),
  generate: L('تولید با Google AI', 'Generate with Google AI', 'Google AI ile oluştur', 'إنشاء باستخدام Google AI', 'Создать с Google AI'),
  company: L('شرکت، کارخانه و محتوای عمومی', 'Company, factory and general content', 'Şirket, fabrika ve genel içerik', 'الشركة والمصنع والمحتوى العام', 'Компания, фабрика и общие материалы'),
  video: L('سناریوی ویدیو', 'Video script', 'Video senaryosu', 'سيناريو فيديو', 'Сценарий видео'),
  audio: L('متن نریشن', 'Narration script', 'Anlatım metni', 'نص التعليق الصوتي', 'Текст озвучки'),
  scripts: L('در این بخش، سناریو و متن نریشن تولید می‌شود؛ خروجی یک فایل صوتی یا ویدیویی نیست.', 'This mode creates a script, not a rendered audio or video file.', 'Bu mod ses veya video dosyası değil, senaryo üretir.', 'يُنشئ هذا الوضع نصاً، وليس ملف صوت أو فيديو.', 'Этот режим создаёт сценарий, а не аудио- или видеофайл.'),
  reference: L('تصویر مرجع برای ساخت یا ویرایش', 'Reference image for generation or editing', 'Üretim veya düzenleme için referans görsel', 'صورة مرجعية للإنشاء أو التحرير', 'Изображение для создания или редактирования'),
  productReference: L('از تصویر رسمی محصول به‌عنوان مرجع استفاده شود', 'Use the official product image as a reference', 'Resmî ürün görselini referans olarak kullan', 'استخدام صورة المنتج الرسمية كمرجع', 'Использовать официальное изображение продукта'),
  upload: L('انتخاب یا رهاکردن تصویر', 'Choose or drop an image', 'Görsel seçin veya bırakın', 'اختر صورة أو أسقطها', 'Выберите или перетащите изображение'),
  referenceHint: L('PNG، JPEG یا WebP، حداکثر ۴ مگابایت', 'PNG, JPEG or WebP, up to 4 MB', 'PNG, JPEG veya WebP, en fazla 4 MB', 'PNG أو JPEG أو WebP، حتى ٤ ميغابايت', 'PNG, JPEG или WebP, до 4 МБ'),
  referenceError: L('تصویر معتبر PNG، JPEG یا WebP تا ۴ مگابایت انتخاب کنید.', 'Choose a valid PNG, JPEG or WebP image up to 4 MB.', 'En fazla 4 MB geçerli PNG, JPEG veya WebP seçin.', 'اختر صورة PNG أو JPEG أو WebP صالحة حتى ٤ ميغابايت.', 'Выберите корректный PNG, JPEG или WebP до 4 МБ.'),
  dataNote: L('متن درخواست و مرجع انتخاب‌شده برای این تولید به Google ارسال می‌شود. پیش‌نویس‌ها پیش از انتشار قابل ویرایش و بازبینی‌اند.', 'Your prompt and selected reference are sent to Google for this generation. Drafts can be edited and reviewed before publication.', 'İstek ve seçilen referans bu üretim için Google’a gönderilir. Taslaklar yayımlanmadan önce düzenlenebilir ve incelenebilir.', 'يُرسل طلبك والمرجع المختار إلى Google لهذا الإنشاء. يمكن تحرير المسودات ومراجعتها قبل النشر.', 'Запрос и выбранный материал отправляются в Google для генерации. Черновик можно отредактировать и проверить перед публикацией.'),
  destination: L('مقصد پیش‌نویس', 'Draft destination', 'Taslak hedefi', 'وجهة المسودة', 'Раздел для черновика'),
  edit: L('ویرایش متن', 'Edit text', 'Metni düzenle', 'تحرير النص', 'Редактировать текст'),
  preview: L('پیش‌نمایش', 'Preview', 'Önizleme', 'معاينة', 'Предпросмотр'),
  download: L('دانلود متن', 'Download text', 'Metni indir', 'تنزيل النص', 'Скачать текст'),
  downloadImage: L('دانلود تصویر', 'Download image', 'Görseli indir', 'تنزيل الصورة', 'Скачать изображение'),
  legacy: L('پیش‌نویس محلی قدیمی', 'Earlier local draft', 'Önceki yerel taslak', 'مسودة محلية سابقة', 'Ранее созданный локальный черновик'),
  completed: L('خروجی Google AI در استودیو آماده شد.', 'Google AI output is ready in the studio.', 'Google AI çıktısı stüdyoda hazır.', 'مخرج Google AI جاهز في الاستوديو.', 'Результат Google AI готов в студии.'),
  reviewing: L('خروجی را بازبینی کنید و سپس در بخش موردنظر ذخیره کنید.', 'Review the output, then save it to the appropriate section.', 'Çıktıyı inceleyip uygun bölüme kaydedin.', 'راجع المخرج ثم احفظه في القسم المناسب.', 'Проверьте результат и сохраните в нужный раздел.'),
  historyFailure: L('خروجی ساخته شد، اما ذخیرهٔ تاریخچه در سرور تأیید نشد. خروجی این صفحه را نگه دارید یا به‌عنوان پیش‌نویس ذخیره کنید.','Generation completed, but history persistence was not confirmed. Keep this output or save it as a draft.','Üretim tamamlandı ancak geçmişin kaydı doğrulanmadı. Çıktıyı saklayın veya taslak olarak kaydedin.','اكتمل الإنشاء لكن حفظ السجل غير مؤكد. احتفظ بالمخرج أو احفظه كمسودة.','Генерация завершена, но сохранение истории не подтверждено. Сохраните результат или создайте черновик.'),
  privateImage: L('تصویر فعلاً خصوصی است. برای درج در محتوا ابتدا حقوق استفاده را تأیید و تصویر را به رسانه‌ها اضافه کنید.','This image is private. Confirm usage rights and add it to media before including it in content.','Bu görsel özeldir. İçeriğe eklemeden önce kullanım haklarını onaylayıp medyaya ekleyin.','الصورة خاصة حاليًا. أكد حقوق الاستخدام وأضفها للوسائط قبل إدراجها في المحتوى.','Изображение пока частное. Подтвердите права и добавьте его в медиатеку перед включением в материал.'),
  translationRevision:L('ذخیرهٔ ترجمه به نسخهٔ محصول در زمان تولید متصل است. برای خروجی قدیمی یا محصول تغییرکرده، متن را در بخش ترجمه‌ها با نسخهٔ جاری مقایسه کنید.','Saving a translation is tied to the product revision captured when generation began. For older output or a changed product, compare the text with the current revision in Translations.','Çeviriyi kaydetmek, üretim başladığında alınan ürün sürümüne bağlıdır. Eski çıktı veya değişen ürün için metni Çeviriler bölümünde güncel sürümle karşılaştırın.','يرتبط حفظ الترجمة بإصدار المنتج عند بدء الإنشاء. للمخرجات القديمة أو المنتج المتغير، قارن النص بالإصدار الحالي في قسم الترجمات.','Сохранение перевода связано с версией продукта на момент начала генерации. Старый результат или изменившийся продукт сравните с актуальной версией в разделе переводов.'),
};
const productLabel = (product: Product, locale: WorkspaceLocale) => product.name[locale]?.trim() || workspaceLocales.map(language => product.name[language]?.trim()).find(Boolean) || product.brand || product.id;

export function ContentStudio({store}:{store:WorkspaceStore}){return <StudioBody key={`${store.actorId}:${store.role}:${store.locale}`} store={store}/>;}
function StudioBody({ store }: { store: WorkspaceStore }) {
  const { state, locale, role } = store;
  const c = aiCopy[locale];
  const tr = (key: keyof typeof copy) => localized(copy[key], locale).replaceAll('Google AI', providerName).replaceAll('Google', providerName);
  const publications = usePublications();
  const products = useMemo(() => [...new Map([
    ...canonicalProducts,
    ...workspaceProducts(state.records),
    ...getPublishedProductInventory(),
    ...catalogFromPublications(publications, locale).filter(product => product.localPublication),
  ].map(product => [product.id, product])).values()], [state.records, publications, locale]);
  const availableLocales=workspaceLocales.filter(language=>demoMode||store.actor.allowedLocales?.includes(language));
  const [mode, setMode] = useState<StudioMode>('text');
  const [productId, setProductId] = useState('');
  const [targetLocale, setTargetLocale] = useState<WorkspaceLocale>(availableLocales.includes(locale)?locale:availableLocales[0]||locale);
  const [audience, setAudience] = useState('laboratory');
  const [tone, setTone] = useState('professional');
  const [brief, setBrief] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [reference, setReference] = useState<{ dataUrl: string; name: string } | null>(null);
  const [useProductImage, setUseProductImage] = useState(true);
  const [result, setResult] = useState<AIJob | null>(null);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState('');
  const [providerName,setProviderName]=useState('AI');
  const [publicationRights,setPublicationRights]=useState(false);
  const [imageSaving,setImageSaving]=useState(false);
  const [draftSaving,setDraftSaving]=useState(false);
  const [savedDraft,setSavedDraft]=useState<{id:string;section:string}|null>(null);
  const [promotedImage,setPromotedImage]=useState<{jobId:string;id:string;url:string}|null>(null);
  const [capabilities,setCapabilities]=useState<AiStatus['capabilities']|null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'output' | 'history'>('output');
  const [editing, setEditing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const gate = useRef(new StudioRequestGate());
  const productCaptures=useRef(new Map<string,{id:string;updatedAt:string}>());
  const uploadRevision = useRef(0);
  const alive=useRef(true),generationPending=useRef(false),draftPending=useRef(false),imagePending=useRef(false);
  const actorKey = `${store.actorId}:${role}`;
  const live = useRef({ store, actorKey });
  live.current = { store, actorKey };
  const allowed = store.permit('create','ai',targetLocale)&&availableLocales.includes(targetLocale);
  const destinations = ['news', 'research', 'knowledge', 'pages'].filter(section => store.permit('create',section,targetLocale));
  const [destination, setDestination] = useState(destinations[0] || '');
  const activeDestination = destinations.includes(destination) ? destination : destinations[0];
  const canSave = !!result && !!output.trim() && output.length<=(role==='translator'?30000:100000) && !store.pending && !draftSaving && !savedDraft && (role === 'translator' ? productCaptures.current.has(result.id) : !!activeDestination);
  const product = products.find(item => item.id === productId);
  const referenceUrl = productReferenceImage(product?.image);
  const history = state.aiJobs.map(normalizeStudioJob).filter((job): job is AIJob => !!job);
  const modeLabel = (value: string) => value === 'video' ? tr('video') : value === 'audio' ? tr('audio') : wt(value, locale);

  useEffect(() => {
    const controller = new AbortController();
    apiClient.request<AiStatus>('/ai/status',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setConfigured(value.configured);setCapabilities(value.capabilities);setProviderName(value.provider==='google'?'Google AI':'OpenRouter');}}).catch(() => { if (!controller.signal.aborted) setConfigured(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    alive.current=true;gate.current.cancel();generationPending.current=false; uploadRevision.current += 1; setBusy(false); setUploadBusy(false);
    setResult(null); setOutput(''); setReference(null); setError('');setPublicationRights(false);setPromotedImage(null);setSavedDraft(null);
    return () => { alive.current=false;gate.current.cancel(); uploadRevision.current += 1; };
  }, [actorKey, allowed]);

  const cancel = () => { gate.current.cancel();generationPending.current=false; setBusy(false); setError(c.cancelled); };
  const upload = async (file: File) => {
    if (busy || !store.permit('create', 'ai')) return;
    const revision = ++uploadRevision.current;
    const actor = actorKey;
    setUploadBusy(true); setError('');
    try {
      const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      if (!validStudioReference(file.type, file.size, head)) throw new Error('reference');
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
      });
      if (!studioImageData(dataUrl)) throw new Error('reference');
      if (revision === uploadRevision.current && live.current.actorKey === actor && live.current.store.permit('create', 'ai')) setReference({ dataUrl, name: file.name });
    } catch {
      if (revision === uploadRevision.current && live.current.actorKey === actor) setError(tr('referenceError'));
    } finally { if (revision === uploadRevision.current) setUploadBusy(false); }
  };
  const prepare = async (event: FormEvent) => {
    event.preventDefault();
    if (generationPending.current || uploadBusy || !brief.trim() || !allowed || !(mode==='image'?capabilities?.image:capabilities?.text)) return;
    if (['rewrite', 'translation'].includes(mode) && !sourceText.trim()) return;
    const ticket = gate.current.start(actorKey);
    generationPending.current=true;
    const base = { id: uid('AI'), mode, locale: targetLocale, productId: product?.id || 'company', prompt: brief.trim(), sourceText, createdAt: now(), authorId: store.actorId, ...(mode === 'image' ? { referenceLabel: reference?.name || (useProductImage && product ? productLabel(product, targetLocale) : '') } : {}) };
    if(role==='translator'&&product){const current=store.getState().records.find(record=>record.collection==='products'&&(record.product===product.id||record.id===product.id));if(current)productCaptures.current.set(base.id,{id:current.id,updatedAt:current.updatedAt});}
    const request = product ? buildStudioRequest({ mode, locale: targetLocale, brief, product, audience: wt(audience, targetLocale), tone: wt(tone, targetLocale), sourceText, referenceImage: useProductImage ? referenceUrl : undefined, imageData: reference ? studioImageData(reference.dataUrl) : undefined }) : {
      mode, locale: targetLocale, prompt: `${brief.trim()}\nAudience: ${wt(audience, targetLocale)}\nTone: ${wt(tone, targetLocale)}`,
      context: sourceText ? `Source text for this editorial task:\n${sourceText}` : '',
      ...(mode === 'image' && reference ? { imageData: studioImageData(reference.dataUrl) } : {}),
    };
    setBusy(true); setError(''); setResult(null); setOutput(''); setTab('output'); setEditing(false);setSavedDraft(null);setPromotedImage(null);setPublicationRights(false);
    try {
      const response = await requestAi(request, ticket.controller.signal);
      if (!gate.current.current(ticket, live.current.actorKey, live.current.store.permit('create', 'ai'))) return;
      const job = resultStudioJob(response, base);
      if (!job) throw new AiRequestError('EMPTY_RESPONSE');
      setResult(job);setOutput(job.output);setConfigured(true);
      const current = live.current.store;
      const saved = await current.update(previous => ({ ...previous, aiJobs: [job, ...previous.aiJobs] }));
      if (!saved&&gate.current.current(ticket,live.current.actorKey,true))setError(tr('historyFailure'));
    } catch (failure) {
      if (gate.current.current(ticket, live.current.actorKey, live.current.store.permit('create', 'ai'))) setError(aiErrorMessage(failure, locale));
    } finally {
      if (gate.current.current(ticket, live.current.actorKey, true)) { generationPending.current=false;setBusy(false); gate.current.finish(ticket); }
    }
  };
  const selectJob = (job: AIJob) => {
    gate.current.cancel();generationPending.current=false; uploadRevision.current += 1; setUploadBusy(false); setBusy(false); setError(''); setResult(job); setOutput(job.output); setEditing(false); setTab('output');setSavedDraft(null);setPromotedImage(null);setPublicationRights(false);
    setMode(job.mode as StudioMode); setProductId(job.productId === 'company' ? '' : job.productId); setTargetLocale(job.locale); setBrief(job.prompt); setSourceText(job.sourceText || ''); setReference(null);
  };
  const saveDraft = async () => {
    if (!result || !output.trim() || output.length>100000 || draftPending.current || savedDraft || !store.actor.allowedLocales?.includes(result.locale)&&!demoMode) return;
    draftPending.current=true;setDraftSaving(true);setError('');
    const job=result,content=output,section=activeDestination;
    const resultProduct=products.find(item=>item.id===job.productId);
    const title=resultProduct?`${productLabel(resultProduct,job.locale)} · ${job.prompt.slice(0,90)}`:job.prompt.slice(0,140);
    const image=promotedImage?.jobId===job.id?promotedImage:undefined;
    try {
      let saved=false,id='';
      if(role==='translator'){
        const captured=productCaptures.current.get(job.id),record=store.getState().records.find(item=>item.id===captured?.id&&item.collection==='products'&&(item.product===job.productId||item.id===job.productId));
        if(!record||!store.permit('translate','products',job.locale)){store.notify(wt('denied',locale));return;}
        if(!captured||record.updatedAt!==captured.updatedAt){setError(tr('translationRevision'));return;}
        const current=productTranslationFields(record,job.locale);if(!current){setError(tr('translationRevision'));return;}
        id=record.id;
        saved=await store.patchRecord(record.id,{...productTranslationPatch(record,job.locale,{...current,body:content},'draft',role),author:role,authorId:store.actorId,approvedBy:undefined,approvedById:undefined},wt('saved',locale),captured.updatedAt);
      }else if(section&&store.permit('create',section,job.locale)){
        id=uid(section==='pages'?'PAGE':'CONTENT');
        if(section==='pages'){
          const page:PageDraft={id,slug:`studio-${id.toLowerCase()}`,locale:job.locale,title,summary:content.slice(0,300),status:'draft',version:1,author:role,authorId:store.actorId,updatedAt:now(),blocks:[...(image?[{id:uid('BLOCK'),type:'image',title,body:'',mediaUrl:image.url}]:[]),{id:uid('BLOCK'),type:'rich-text',title,body:content}]};
          saved=await store.update(previous=>({...previous,pages:[page,...previous.pages]}),wt('saved',locale));
        }else{
          saved=await store.addRecord({id,collection:section,title:{...L('','','','',''),[job.locale]:title},summary:{...L('','','','',''),[job.locale]:content.slice(0,600)},status:'draft',owner:role,author:role,authorId:store.actorId,createdAt:now(),updatedAt:now(),tags:['studio',job.mode],demo:false,...(image?{image:image.url}:{}),...(resultProduct?{product:resultProduct.id,sourceUrl:resultProduct.sourceUrl}:{}),details:{editorialContent:{schemaVersion:1,body:{...L('','','','',''),[job.locale]:content},...(image?{mediaId:image.id,mediaUrl:image.url,mediaType:'image',mediaTitle:title}:{})}},history:[]});
        }
      }
      if(alive.current){if(saved){setSavedDraft({id,section:role==='translator'?'products':section});setResult({...job,output:content,status:'draft'});}else setError(networkError(new Error('Draft was not saved'),locale));}
    }catch(reason){if(alive.current)setError(networkError(reason,locale));}finally{if(alive.current){draftPending.current=false;setDraftSaving(false);}}
  };
  const saveImage=async()=>{
    if(!result?.image||imagePending.current||!store.permit('create','media')||promotedImage?.jobId===result.id)return;
    if(!demoMode&&!publicationRights){store.notify(wt('rights',locale));return;}
    const job=result,image=job.image!;imagePending.current=true;setImageSaving(true);setError('');
    try{
      const suffix=image.mimeType==='image/jpeg'?'jpg':image.mimeType.split('/')[1];
      let url=image.url,id=uid('MEDIA'),size=image.bytes;
      if(!demoMode){
        const match=/^\/api\/v1(\/(?:attachments\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/content))\/?$/.exec(url);
        if(!match)throw new Error('Generated image is unavailable');
        const blob=await apiClient.blob(match[1]);if(!alive.current)return;
        const body=new FormData();body.set('file',new File([blob],`idealmakoo-${job.id}.${suffix}`,{type:image.mimeType}));body.set('rights','true');body.set('visibility','public');
        const uploaded=await apiClient.request<{id:string;url:string;bytes:number;scanStatus:string}>('/media',{method:'POST',body});if(!alive.current)return;
        if(uploaded.scanStatus!=='clean')throw new Error('The uploaded image is not cleared for publication');
        id=uploaded.id;url=uploaded.url;size=uploaded.bytes;
      }
      const media:WorkspaceMedia={id,title:job.prompt.slice(0,140),filename:`idealmakoo-${job.id}.${suffix}`,type:'image',url,size,usage:[],rights:publicationRights||demoMode,focalX:50,focalY:50};
      const saved=await store.update(previous=>({...previous,media:[media,...previous.media]}),wt('saved',locale));
      if(alive.current&&saved){setPromotedImage({jobId:job.id,id,url});setPublicationRights(false);}
    }catch(reason){if(alive.current)setError(networkError(reason,locale));}finally{if(alive.current){imagePending.current=false;setImageSaving(false);}}
  };

  return <div className="ws-studio ws-ai-studio">
    <section className="ws-studio-banner"><div className="ws-studio-orb"><Sparkles size={30}/></div><div><span className="ws-eyebrow"><bdi dir="ltr">IDEAL MAKOO</bdi>{' · '}{tr('lab')}</span><h2>{wt('contentIntro', locale)}</h2><p>{tr('intro')}</p></div><span className="ws-studio-mode" data-connected={configured === true}><i/>{configured === null ? tr('checking') : configured ? (c.ready.replace('Google AI',providerName)) : c.unconfigured}</span></section>
    <div className="ws-studio-modes" role="group" aria-label={wt('contentIntro', locale)}>{modes.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} disabled={busy} onClick={() => { setMode(item.id); setError(''); }}><item.icon size={22}/><span>{modeLabel(item.id)}</span></button>)}</div>
    <div className="ws-studio-grid">
      <form className="ws-card ws-studio-form" onSubmit={prepare}>
        <div className="ws-card-head"><h3>{wt('prompt', locale)}</h3><Sparkles size={19}/></div>
        <fieldset disabled={busy || draftSaving || imageSaving || !allowed} className="ws-ai-fields">
          <Field label={wt('product', locale)}><select className="input" value={productId} onChange={event => setProductId(event.target.value)}><option value="">{tr('company')}</option>{products.map(item => <option key={item.id} value={item.id}>{productLabel(item, locale)}</option>)}</select></Field>
          <div className="ws-form-grid"><Field label={wt('language', locale)}><select className="input" value={targetLocale} onChange={event => setTargetLocale(event.target.value as WorkspaceLocale)}>{availableLocales.map(language => <option key={language} value={language}>{nativeNames[language]}</option>)}</select></Field><Field label={wt('audience', locale)}><select className="input" value={audience} onChange={event => setAudience(event.target.value)}>{['laboratory', 'clinic', 'distributor', 'researchAudience'].map(value => <option key={value} value={value}>{wt(value, locale)}</option>)}</select></Field></div>
          <Field label={wt('tone', locale)}><select className="input" value={tone} onChange={event => setTone(event.target.value)}>{['professional', 'educational'].map(value => <option key={value} value={value}>{wt(value, locale)}</option>)}</select></Field>
          <Field label={wt('description', locale)}><textarea className="input" required rows={5} maxLength={8000} value={brief} onChange={event => setBrief(event.target.value)} placeholder={wt('promptHint', locale)}/></Field>
          {['translation', 'rewrite', 'document'].includes(mode) && <Field label={wt('sourceText', locale)}><textarea className="input" dir="auto" required={mode !== 'document'} rows={7} maxLength={8000} value={sourceText} onChange={event => setSourceText(event.target.value)}/></Field>}
          {['video', 'audio'].includes(mode) && <p className="ws-ai-notice">{tr('scripts')}</p>}
          {mode === 'image' && <section className="ws-ai-reference"><h4>{tr('reference')}</h4>{referenceUrl && !reference && <label className="ws-checkbox-label"><input type="checkbox" checked={useProductImage} onChange={event => setUseProductImage(event.target.checked)}/>{tr('productReference')}</label>}<div className="ws-ai-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void upload(file); }}><button className="btn ws-small-btn" type="button" disabled={uploadBusy} onClick={() => fileRef.current?.click()}>{uploadBusy ? <Loader2 className="ws-spin" size={18}/> : <UploadCloud size={18}/>} {tr('upload')}</button><small>{tr('referenceHint')}</small><input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }}/></div>{(reference || useProductImage && referenceUrl) && <figure><img src={reference?.dataUrl || referenceUrl} alt={reference?.name || (product ? productLabel(product, locale) : '')}/><figcaption>{reference?.name || wt('source', locale)}{reference && <button className="ws-icon-button" type="button" aria-label={wt('remove', locale)} onClick={() => { uploadRevision.current += 1; setUploadBusy(false); setReference(null); }}><X size={17}/></button>}</figcaption></figure>}</section>}
          <div className="ws-prompt-chips">{[L('معرفی تخصصی محصول', 'Product introduction', 'Ürün tanıtımı', 'التعريف بالمنتج', 'Презентация продукта'), L('پست آموزشی', 'Educational post', 'Eğitici gönderi', 'منشور تعليمي', 'Образовательная публикация'), L('معرفی کارخانه', 'Factory introduction', 'Fabrika tanıtımı', 'التعريف بالمصنع', 'Презентация фабрики')].map((label, index) => <button key={index} type="button" onClick={() => setBrief(`${localized(label, locale)}${product ? ': ' + productLabel(product, locale) : ''}`)}><Plus size={12}/>{localized(label, locale)}</button>)}</div>
        </fieldset>
        {error && <div className="ws-ai-error" role="alert">{error}</div>}
        <div className="ws-ai-generate-row"><button className="btn btn-primary ws-studio-generate" disabled={busy || uploadBusy || draftSaving || imageSaving || !allowed || !brief.trim() || !(mode==='image'?capabilities?.image:capabilities?.text)} type="submit">{busy ? <Loader2 className="ws-spin" size={18}/> : <WandSparkles size={18}/>} {busy ? c.thinking : tr('generate')}</button>{busy && <button type="button" className="btn ws-small-btn" onClick={cancel}><X size={17}/>{c.stop}</button>}</div>
        <p className="ws-inline-note">{tr('dataNote')}</p>
      </form>
      <section className="ws-card ws-studio-output" aria-busy={busy}>
        <div className="ws-card-head"><div className="ws-locale-tabs"><button type="button" aria-pressed={tab === 'output'} onClick={() => setTab('output')}>{wt('output', locale)}</button><button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>{wt('history', locale)} <span>{history.length}</span></button></div><span className="ws-micro">{providerName}</span></div>
        {tab === 'history' ? <div className="ws-draft-history">{history.length ? history.map(job => <button type="button" key={job.id} disabled={busy||draftSaving||imageSaving} onClick={() => selectJob(job)}><span className="ws-history-icon">{job.image ? <ImageIcon size={20}/> : <FileText size={20}/>}</span><div><strong>{job.prompt}</strong><small>{modeLabel(job.mode)} · <bdi>{job.locale.toUpperCase()}</bdi> · {safeDate(job.createdAt, locale)}</small><small>{job.provider ? `${job.provider} · ${job.model}` : tr('legacy')}</small></div><ArrowUpRight size={17}/></button>) : <Empty locale={locale}/>}</div> : busy ? <div className="ws-output-empty" role="status"><div className="ws-output-symbol"><Loader2 className="ws-spin" size={40}/></div><h3>{c.thinking}</h3><p>{modeLabel(mode)} · {nativeNames[targetLocale]}</p></div> : result ? <>
          <div className="ws-ai-result-meta"><span>{result.provider ? c.generated : tr('legacy')}</span><bdi>{result.model || ''}</bdi><span>{modeLabel(result.mode)} · {nativeNames[result.locale]}</span></div>
          <div className="ws-output-material" lang={result.locale} dir={['fa', 'ar'].includes(result.locale) ? 'rtl' : 'ltr'}>
            {result.image && <figure className="ws-ai-generated-image"><img src={result.image.url} alt={result.prompt}/><figcaption>{c.generated} · {result.model}</figcaption></figure>}
            {(!!output || editing) && <><div className="ws-ai-preview-tabs"><button type="button" aria-pressed={!editing} onClick={() => setEditing(false)}>{tr('preview')}</button><button type="button" aria-pressed={editing} onClick={() => setEditing(true)}>{tr('edit')}</button></div>{editing ? <textarea aria-label={wt('output', locale)} className="ws-generated-text" value={output} disabled={draftSaving||imageSaving} onChange={event => {setOutput(event.target.value);setSavedDraft(null);}} maxLength={100000}/> : <div className="ws-ai-markdown"><AiMarkdown text={output} sources={result.sources || []} locale={result.locale}/></div>}</>}
            {result.image&&promotedImage?.jobId!==result.id&&<p className="ws-ai-notice">{tr('privateImage')}</p>}{!!result.sources?.length && <details className="ws-ai-sources"><summary>{c.sources} ({result.sources.length})</summary><ol>{result.sources.map(source => <li key={source.id}><a href={studioLink(source.url)} target="_blank" rel="noopener noreferrer">[{source.number}] {sourceTitle(source, result.locale)}</a></li>)}</ol></details>}
          </div>
          <div className="ws-studio-output-actions">{!!output && <><button type="button" className="btn ws-small-btn" onClick={async () => { try { await navigator.clipboard.writeText(output); store.notify(wt('copied', locale)); } catch { downloadFile(output, `idealmakoo-${result.id}.md`, 'text/markdown;charset=utf-8'); } }}><Clipboard size={15}/>{wt('copy', locale)}</button><button type="button" className="btn ws-small-btn" onClick={() => downloadFile(output, `idealmakoo-${result.mode}-${result.locale}.md`, 'text/markdown;charset=utf-8')}><Download size={15}/>{tr('download')}</button></>}{result.image && <>{!demoMode&&<label className="ws-checkbox-label"><input type="checkbox" checked={publicationRights} onChange={event=>setPublicationRights(event.target.checked)}/>{wt('rights',locale)}</label>}<a className="btn ws-small-btn" href={result.image.url} download={`idealmakoo-${result.id}.${result.image.mimeType === 'image/jpeg' ? 'jpg' : result.image.mimeType.split('/')[1]}`}><Download size={15}/>{tr('downloadImage')}</a>{canWorkspace(role, 'create', 'media') && <button className="btn ws-small-btn" type="button" disabled={imageSaving||draftSaving||promotedImage?.jobId===result.id||(!demoMode&&!publicationRights)} onClick={saveImage}><ImageIcon size={15}/>{c.saveImage}</button>}</>}</div>
          {!!output && <div className="ws-ai-draft-row">{destinations.length > 0 && <Field label={tr('destination')}><select className="input" value={activeDestination} onChange={event => setDestination(event.target.value)}>{destinations.map(section => <option key={section} value={section}>{wt(section, locale)}</option>)}</select></Field>}<button className="btn btn-primary ws-small-btn" type="button" disabled={!canSave || !allowed} onClick={saveDraft}><Save size={16}/>{wt('saveDraft', locale)}</button><p>{role==='translator'?tr('translationRevision'):tr('reviewing')}</p>{savedDraft&&<a className="btn ws-small-btn" href={`/${result.locale}/admin/${savedDraft.section}/?record=${encodeURIComponent(savedDraft.id)}`}>{wt('open',locale)}<ArrowUpRight size={15}/></a>}</div>}
        </> : <div className="ws-output-empty"><div className="ws-output-symbol"><Sparkles size={44}/></div><h3>{wt('output', locale)}</h3><p>{tr('intro')}</p>{product && <div className="ws-output-reference"><img src={product.image} alt={productLabel(product, locale)}/><div><strong>{productLabel(product, locale)}</strong><span>{wt('source', locale)}</span></div></div>}</div>}
      </section>
    </div>
    {!demoMode&&<><RenderedMediaJobs store={store}/><KnowledgeIndex store={store}/></>}
  </div>;
}
