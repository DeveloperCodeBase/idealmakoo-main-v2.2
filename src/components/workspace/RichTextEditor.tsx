'use client';
import {useId,useRef,useState,type KeyboardEvent} from 'react';
import {Bold,Code,Eye,Heading2,Heading3,Italic,Link2,List,ListOrdered,Quote,Table2} from 'lucide-react';
import AiMarkdown,{safeAiLink} from '@/components/ui/AiMarkdown';
import {L,localized} from './i18n';

const words={
 format:L('قالب‌بندی متن','Text formatting','Metin biçimlendirme','تنسيق النص','Форматирование текста'),
 edit:L('ویرایش','Write','Yaz','تحرير','Редактор'),preview:L('پیش‌نمایش','Preview','Önizleme','معاينة','Предпросмотр'),
 bold:L('پررنگ','Bold','Kalın','عريض','Жирный'),italic:L('مورب','Italic','İtalik','مائل','Курсив'),
 heading:L('تیتر','Heading','Başlık','عنوان','Заголовок'),list:L('فهرست','Bullet list','Madde listesi','قائمة نقطية','Маркированный список'),
 numbered:L('فهرست شماره‌دار','Numbered list','Numaralı liste','قائمة مرقمة','Нумерованный список'),
 link:L('پیوند','Link','Bağlantı','رابط','Ссылка'),quote:L('نقل‌قول','Quote','Alıntı','اقتباس','Цитата'),
 code:L('کد','Code','Kod','شفرة','Код'),table:L('جدول','Table','Tablo','جدول','Таблица'),
 insert:L('افزودن پیوند','Insert link','Bağlantı ekle','إدراج رابط','Вставить ссылку'),
 cancel:L('انصراف','Cancel','İptal','إلغاء','Отмена'),
 help:L('متن را انتخاب کنید و قالب بدهید. قالب Markdown همراه نسخه محتوا ذخیره می‌شود؛ پیش‌نمایش، ظاهر انتشار را نشان می‌دهد.','Select text to format it. Markdown is saved with the content revision; preview shows its published appearance.','Biçimlendirmek için metni seçin. Markdown içerik sürümüyle kaydedilir; önizleme yayın görünümünü gösterir.','حدد النص لتنسيقه. يُحفظ Markdown مع إصدار المحتوى وتُظهر المعاينة شكله المنشور.','Выделите текст для форматирования. Markdown сохраняется в версии; предпросмотр показывает опубликованный вид.'),
};
export default function RichTextEditor({value,onChange,label,locale,uiLocale=locale,disabled=false,rows=12,maxLength=80000}:{value:string;onChange:(value:string)=>void;label:string;locale:string;uiLocale?:string;disabled?:boolean;rows?:number;maxLength?:number}){
 const id=useId(),input=useRef<HTMLTextAreaElement>(null),selection=useRef({start:0,end:0});
 const [preview,setPreview]=useState(false),[linkOpen,setLinkOpen]=useState(false),[url,setUrl]=useState('https://');
 const tr=(key:keyof typeof words)=>localized(words[key],uiLocale);
 const mark=()=>{if(input.current)selection.current={start:input.current.selectionStart,end:input.current.selectionEnd};};
 const replace=(before:string,after='',lines=false)=>{
  if(disabled)return;const {start,end}=selection.current;const selected=value.slice(start,end);const body=lines?selected.split('\n').map((line,index)=>before==='1. '?`${index+1}. ${line}`:before+line).join('\n'):before+selected+after;
  const next=value.slice(0,start)+body+value.slice(end);if(next.length>maxLength)return;onChange(next);
  requestAnimationFrame(()=>{input.current?.focus();const nextStart=lines?start:start+before.length;const nextEnd=lines?start+body.length:nextStart+selected.length;input.current?.setSelectionRange(nextStart,nextEnd);selection.current={start:nextStart,end:nextEnd};});
 };
 const block=(prefix:string)=>{const area=input.current;if(area){const start=value.lastIndexOf('\n',Math.max(0,area.selectionStart-1))+1;const newline=value.indexOf('\n',area.selectionEnd);selection.current={start,end:newline<0?value.length:newline};}replace(prefix,'',true);};
 const shortcut=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(!(event.ctrlKey||event.metaKey))return;const key=event.key.toLowerCase();if(!['b','i','k'].includes(key))return;event.preventDefault();mark();if(key==='k'){setLinkOpen(true);return;}replace(key==='b'?'**':'*',key==='b'?'**':'*');};
 const actions=[{key:'bold',Icon:Bold,run:()=>replace('**','**')},{key:'italic',Icon:Italic,run:()=>replace('*','*')},{key:'heading',Icon:Heading2,run:()=>block('## ')},{key:'heading',Icon:Heading3,run:()=>block('### ')},{key:'list',Icon:List,run:()=>block('- ')},{key:'numbered',Icon:ListOrdered,run:()=>block('1. ')},{key:'quote',Icon:Quote,run:()=>block('> ')},{key:'code',Icon:Code,run:()=>replace('\n```\n','\n```\n')},{key:'table',Icon:Table2,run:()=>replace('\n| '+tr('heading')+' | '+tr('heading')+' |\n| --- | --- |\n| ', ' |  |\n')},{key:'link',Icon:Link2,run:()=>setLinkOpen(true)}] as const;
 return <div className="ws-rich-editor ws-field" data-rich-editor="true"><div className="ws-rich-title"><label htmlFor={id}>{label}</label><div className="ws-rich-tabs"><button type="button" aria-pressed={!preview} onClick={()=>setPreview(false)}>{tr('edit')}</button><button type="button" aria-pressed={preview} onClick={()=>setPreview(true)}><Eye size={14}/>{tr('preview')}</button></div></div>
 {!preview&&<div className="ws-rich-toolbar" role="group" aria-label={tr('format')}>{actions.map(({key,Icon,run},index)=><button key={index} type="button" title={tr(key)} aria-label={tr(key)+(key==='heading'?` ${index===2?2:3}`:'')} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={run}><Icon size={17}/></button>)}</div>}
 {linkOpen&&!preview&&<div className="ws-rich-link"><label htmlFor={`${id}-link`}>{tr('link')}</label><input id={`${id}-link`} className="input" dir="ltr" value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://…" maxLength={2000}/><button type="button" disabled={disabled||!safeAiLink(url,locale)} onClick={()=>{replace('[',`](${url.trim()})`);setLinkOpen(false);setUrl('https://');}}>{tr('insert')}</button><button type="button" onClick={()=>setLinkOpen(false)}>{tr('cancel')}</button></div>}
 {preview?<div className="ws-rich-preview" aria-label={tr('preview')}><AiMarkdown text={value} locale={locale} content/></div>:<textarea ref={input} id={id} className="input" value={value} onChange={event=>{onChange(event.target.value);mark();}} onSelect={mark} onKeyDown={shortcut} disabled={disabled} rows={rows} maxLength={maxLength} lang={locale} dir={['fa','ar'].includes(locale)?'rtl':'ltr'} aria-describedby={`${id}-help`}/>}
 <small id={`${id}-help`}>{tr('help')} <bdi>{value.length.toLocaleString(uiLocale)} / {maxLength.toLocaleString(uiLocale)}</bdi></small></div>;
}
