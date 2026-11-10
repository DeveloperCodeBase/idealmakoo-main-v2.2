'use client';
import {useEffect,useMemo,useState} from 'react';
import {Globe2,Save,Send,ShieldCheck} from 'lucide-react';
import {canWorkspace} from '@/lib/auth';
import {demoMode} from '@/lib/api';
import {ProductTranslationError,productTranslationFields,productTranslationPatch,productTranslationSource} from '@/lib/product-translation';
import {glossaryLocales,parseGlossaryDefinition} from '@/lib/glossary';
import type {WorkspaceRecord} from '@/data/workspace-seed';
import {glossaryCopy} from '@/components/content/glossary-copy';
import AiMarkdown from '@/components/ui/AiMarkdown';
import ContentCollaboration,{type LeaseState} from './ContentCollaboration';
import TranslationStatusPanel from './TranslationStatusPanel';
import AiContentTranslation from './AiContentTranslation';
import RevisionHistory from './RevisionHistory';
import RichTextEditor from './RichTextEditor';
import EditorialSeoFields from './EditorialSeoFields';
import {parseEditorialSeoByLocale,type EditorialSeo} from '@/lib/editorial-seo';
import {PageBuilder} from './CMS';
import {contentCollections} from './Records';
import type {WorkspaceStore} from './store';
import {L,localized,workspaceLocales,wt,type WorkspaceLocale} from './i18n';
import {Empty,Field,SearchInput,Status} from './ui';
const native={fa:'فارسی',en:'English',tr:'Türkçe',ar:'العربية',ru:'Русский'};
const productIssues={
 source:L('پیش‌نویس ذخیره‌شدهٔ محصول معتبر نیست. ابتدا آن را در ویرایشگر محصول بررسی کنید؛ متن واردشده در این فرم حفظ می‌شود.','The saved product draft could not be read safely. Review it in the product editor first; your text stays in this form.','Kayıtlı ürün taslağı güvenle okunamadı. Önce ürün düzenleyicisinde inceleyin; metniniz bu formda korunur.','تعذر قراءة مسودة المنتج المحفوظة بأمان. راجعها أولاً في محرر المنتج؛ يبقى النص في هذا النموذج.','Сохранённый черновик продукта нельзя безопасно прочитать. Сначала проверьте его в редакторе продукта; введённый текст остаётся в форме.'),
 length:L('هر فیلد ترجمهٔ محصول حداکثر ۳۰٬۰۰۰ نویسه می‌پذیرد. متن شما حفظ شده است.','Each product translation field accepts up to 30,000 characters. Your text is preserved.','Her ürün çeviri alanı en fazla 30.000 karakter kabul eder. Metniniz korunur.','يقبل كل حقل لترجمة المنتج حتى ٣٠٬٠٠٠ حرف. تم الاحتفاظ بالنص.','Каждое поле перевода продукта допускает до 30 000 символов. Ваш текст сохранён в форме.'),
 review:L('نسخهٔ محصول برای بازبینی معتبر نیست. پیش‌نویس ترجمه را ذخیره و خطاهای محصول را در ویرایشگر اصلی بررسی کنید؛ متن این فرم حفظ شده است.','The product is not valid for review. Save the translation draft and check the product editor for validation issues; your text stays in this form.','Ürün inceleme için geçerli değil. Çeviri taslağını kaydedin ve ürün düzenleyicisindeki hataları kontrol edin; metniniz bu formda korunur.','المنتج غير صالح للمراجعة. احفظ مسودة الترجمة وتحقق من أخطاء محرر المنتج؛ يبقى النص في هذا النموذج.','Продукт не прошёл проверку для рецензирования. Сохраните черновик перевода и проверьте ошибки в редакторе продукта; текст остаётся в форме.'),
};
type Editorial={schemaVersion:1;body?:Partial<Record<WorkspaceLocale,string>>;[key:string]:unknown};
export default function RecordTranslation({store}:{store:WorkspaceStore}){
 const{locale}=store,records=useMemo(()=>store.state.records.filter(record=>contentCollections.includes(record.collection)&&record.status!=='archived'),[store.state.records]);
 const[sourceLanguage,setSourceLanguage]=useState<WorkspaceLocale>('fa');
 const[target,setTarget]=useState<WorkspaceLocale>((store.actor.allowedLocales?.find(lang=>lang!== 'fa') as WorkspaceLocale)|| (locale==='fa'?'en':locale));const[source,setSource]=useState<WorkspaceRecord|null>(records[0]?structuredClone(records[0]):null),[query,setQuery]=useState(''),[view,setView]=useState<'records'|'pages'>('records'),[title,setTitle]=useState(''),[summary,setSummary]=useState(''),[body,setBody]=useState(''),[aliases,setAliases]=useState(''),[seo,setSeo]=useState<EditorialSeo|undefined>(),[dirty,setDirty]=useState(false),[lease,setLease]=useState<LeaseState>('loading');
 const reset=(record:WorkspaceRecord,lang=target)=>{const editorial=record.details?.editorialContent as Editorial|undefined,product=productTranslationFields(record,lang);setSource(structuredClone(record));setTitle(product?.title??record.title[lang]??'');setSummary(product?.summary??record.summary[lang]??'');setBody(product?.body??editorial?.body?.[lang]??'');setSeo(parseEditorialSeoByLocale(editorial?.seo||{})?.[lang]);setAliases(parseGlossaryDefinition(record.details?.glossary)?.aliases[lang]?.join('\n')||'');setDirty(false);};
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get('record');const initial=records.find(record=>record.id===id)||records[0];if(initial&&!source)reset(initial);},[records,source]);
 useEffect(()=>{if(source&&!dirty){const sourceLocale=sourceLanguage===target?(target==='fa'?'en':'fa'):sourceLanguage;
 const latest=records.find(record=>record.id===source.id);if(latest&&latest.updatedAt!==source.updatedAt)reset(latest);}},[records,source,dirty]);
 useEffect(()=>{if(source)reset(source,target);},[target]);
 const sourceLocale=sourceLanguage===target?(target==='fa'?'en':'fa'):sourceLanguage;
 const latest=records.find(record=>record.id===source?.id),stale=!!source&&latest?.updatedAt!==source.updatedAt;
 const invalidProduct=!!source&&source.collection==='products'&&!productTranslationSource(source);
 const roleAllowed=!!source&&canWorkspace(store.role,'translate',source.collection,{...store.actor,locale:target});const allowed=roleAllowed&&!stale&&!invalidProduct&&(demoMode||lease==='held');const sourceEditorial=source?.details?.editorialContent as Editorial|undefined;
 const sourceProduct=source?productTranslationFields(source,sourceLocale):null;
 const sourceBody=sourceProduct?.body??sourceEditorial?.body?.[sourceLocale];
 const save=async(status:'draft'|'review')=>{
  if(!source||!allowed||!store.permit('translate',source.collection,target))return;
  let patch:Partial<WorkspaceRecord>;
  if(source.collection==='products'){
   try{patch=productTranslationPatch(source,target,{title,summary,body},status,store.role);}
   catch(error){store.notify(error instanceof ProductTranslationError?localized(productIssues[error.problem],locale):wt('required',locale));return;}
  }else{
   const originalGlossary=parseGlossaryDefinition(source.details?.glossary);
   const glossary=source.collection==='glossary'?parseGlossaryDefinition({schemaVersion:1,aliases:{...originalGlossary?.aliases,[target]:aliases.split('\n').map(value=>value.trim()).filter(Boolean)}}):undefined;
   if(source.collection==='glossary'&&!glossary)return store.notify(localized(glossaryCopy.invalid,locale));
   const seoMap={...(parseEditorialSeoByLocale(sourceEditorial?.seo||{})||{})};if(seo)seoMap[target]=seo;else delete seoMap[target];
   if(!parseEditorialSeoByLocale(seoMap))return store.notify(wt('required',locale));
   patch={title:{...source.title,[target]:title},summary:{...source.summary,[target]:summary},status,details:{...source.details,...(glossary?{glossary}:{}),editorialContent:{...(sourceEditorial||{schemaVersion:1}),body:{...sourceEditorial?.body,[target]:body},seo:Object.keys(seoMap).length?seoMap:undefined}}};
  }
  const ok=await store.patchRecord(source.id,{...patch,author:store.role,authorId:store.actorId,approvedBy:undefined,approvedById:undefined},wt('saved',locale),source.updatedAt);
  if(ok){const current=store.getState().records.find(record=>record.id===source.id);if(current)reset(current);}
 };
 const tabs=<div className="ws-locale-tabs"><button disabled={dirty} aria-pressed={view==='records'} onClick={()=>setView('records')}>{wt('records',locale)}</button><button disabled={dirty} aria-pressed={view==='pages'} onClick={()=>setView('pages')}>{wt('pages',locale)}</button></div>;
 if(view==='pages')return <div>{tabs}<PageBuilder store={store} translationOnly/></div>;
 if(!source)return <div>{tabs}<Empty locale={locale}/></div>;
 return <div>{tabs}<div className="ws-language-overview">{workspaceLocales.map(lang=><button key={lang} disabled={dirty||!!store.actor.allowedLocales&&!store.actor.allowedLocales.includes(lang)} className={`ws-card ws-language-card ${lang===target?'is-active':''}`} onClick={()=>setTarget(lang)}><Globe2 size={20}/><strong>{native[lang]}</strong><span>{records.filter(record=>record.title[lang]&&record.summary[lang]).length} / {records.length}</span></button>)}</div><p className="ws-inline-note"><ShieldCheck size={17}/>{wt('translationHint',locale)}</p><ContentCollaboration key={`${source.id}:${store.actorId}`} store={store} bucket="records" id={source.id} sourceUpdatedAt={source.updatedAt} dirty={dirty} canEdit={roleAllowed} locale={target} onLeaseState={setLease}/>{stale&&<p role="alert">{wt('revisionConflict',locale)}</p>}{invalidProduct&&<p role="alert">{localized(productIssues.source,locale)}</p>}<div className="ws-translation-layout"><aside className="ws-card ws-translation-list"><SearchInput value={query} onChange={setQuery} locale={locale}/>{records.filter(record=>`${localized(record.title,locale)} ${record.id}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale))).map(record=><button key={record.id} disabled={dirty} className={source.id===record.id?'active':''} onClick={()=>reset(record)}>{localized(record.title,locale)}<small>{wt(record.collection,locale)}</small></button>)}</aside><section className="ws-card ws-translation-editor"><div className="ws-card-head"><h2 className="ws-heading-as-h3">{localized(source.title,locale)}</h2><Status status={source.status} locale={locale}/></div><div className="ws-translation-panes"><article lang={sourceLocale} dir={['fa','ar'].includes(sourceLocale)?'rtl':'ltr'}><h3 className="ws-heading-as-h4">{sourceLocale.toUpperCase()} · {wt('sourceText',locale)}</h3><h4 className="ws-heading-as-h5">{sourceProduct?.title??source.title[sourceLocale]}</h4><p>{sourceProduct?.summary??source.summary[sourceLocale]}</p>{sourceBody&&<AiMarkdown text={sourceBody} locale={sourceLocale} content/>}{source.collection==='glossary'&&<p>{parseGlossaryDefinition(source.details?.glossary)?.aliases[sourceLocale]?.join(' · ')}</p>}</article><div dir={['fa','ar'].includes(target)?'rtl':'ltr'}><h3 className="ws-heading-as-h4">{target.toUpperCase()} · {wt('targetText',locale)}</h3><Field label={wt('title',locale)}><input className="input" disabled={!allowed||store.pending} value={title} onChange={event=>{setTitle(event.target.value);setDirty(true);}}/></Field><Field label={wt('description',locale)}><textarea className="input" rows={6} disabled={!allowed||store.pending} value={summary} onChange={event=>{setSummary(event.target.value);setDirty(true);}}/></Field><RichTextEditor label={localized(L('متن کامل','Full content','Tam içerik','المحتوى الكامل','Полный текст'),locale)} value={body} locale={target} uiLocale={locale} disabled={!allowed||store.pending} onChange={value=>{setBody(value);setDirty(true);}}/>{source.collection!=='products'&&<EditorialSeoFields value={seo} onChange={value=>{setSeo(value);setDirty(true);}} collection={source.collection} locale={target} media={store.state.media} disabled={!allowed||store.pending}/>} {source.collection==='glossary'&&<Field label={localized(glossaryCopy.aliases,locale)}><textarea className="input" rows={5} value={aliases} disabled={!allowed||store.pending} onChange={event=>{setAliases(event.target.value);setDirty(true);}}/><small>{localized(glossaryCopy.aliasesHint,locale)}</small></Field>}</div></div><div className="ws-translation-footer">{(dirty||stale)&&<button className="btn" onClick={()=>latest&&reset(latest)}>{localized(L('کنار گذاشتن تغییرات و بارگذاری نسخه سرور','Discard edits and reload server version','Değişiklikleri bırak ve sunucu sürümünü yükle','تجاهل التعديلات وتحميل إصدار الخادم','Отменить изменения и загрузить версию сервера'),locale)}</button>}<button className="btn btn-primary" disabled={!allowed||store.pending} onClick={()=>void save('draft')}><Save size={17}/>{wt('save',locale)}</button><button className="btn" disabled={!allowed||store.pending} onClick={()=>void save('review')}><Send size={17}/>{wt('sendReview',locale)}</button></div></section></div><TranslationStatusPanel store={store} bucket="records" id={source.id} locale={target} capturedUpdatedAt={source.updatedAt} dirty={dirty||stale} editable={allowed} sourceLocale={sourceLocale} onSourceLocaleChange={setSourceLanguage}/><AiContentTranslation store={store} bucket="records" id={source.id} locale={target} capturedUpdatedAt={source.updatedAt} dirty={dirty||stale} editable={allowed} sourceLocale={sourceLocale}/><RevisionHistory store={store} bucket="records" id={source.id} locale={target} canRestore={false}/></div>;
}
