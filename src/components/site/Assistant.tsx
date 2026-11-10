'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,BookOpen,Check,Copy,Factory,MessageCircle,Plus,RotateCcw,Send,Sparkles,Square} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {Modal} from '@/components/ui/Primitives';
import AiMarkdown,{safeAiLink,sourceTitle} from '@/components/ui/AiMarkdown';
import {aiCopy,aiErrorMessage,requestAi,type AiSource,type AiStatus,type AiRetrieval} from '@/lib/ai-client';
import {apiClient} from '@/lib/api';
import type {Localized} from '@/data/catalog';
import './assistant.css';
const L=(fa:string,en:string,tr:string,ar:string,ru:string):Localized=>({fa,en,tr,ar,ru});
const prompts=[
 {icon:Factory,text:L('ایده‌آل ماکو را معرفی کن؛ چه محصولاتی تولید می‌کند؟','Introduce Ideal Makoo and its product families.','Ideal Makoo ve ürün ailelerini tanıtır mısın?','عرّفني بإيديال ماكو ومجموعات منتجاتها.','Расскажите об Ideal Makoo и её продукции.')},
 {icon:BookOpen,text:L('کاتالوگ‌ها و جدول قالب‌ها را چطور پیدا کنم؟','Where can I find the catalogues and mould charts?','Katalogları ve kalıp tablolarını nerede bulabilirim?','أين أجد الكتالوجات وجداول القوالب؟','Где найти каталоги и таблицы форм?')},
 {icon:MessageCircle,text:L('برای همکاری و ارتباط با کارخانه راهنمایی‌ام کن.','Help me contact the factory about a partnership.','Fabrika ile iş birliği için nasıl iletişime geçebilirim?','ساعدني في التواصل مع المصنع للتعاون.','Как связаться с фабрикой по поводу сотрудничества?')},
];
const labels={copy:L('کپی پاسخ','Copy answer','Yanıtı kopyala','نسخ الرد','Копировать ответ'),retry:L('تلاش دوباره','Try again','Tekrar dene','حاول مجدداً','Повторить'),connected:L('پاسخ با منابع کارخانه و Google AI','Factory sources · Google AI','Fabrika kaynakları · Google AI','مصادر المصنع · Google AI','Источники фабрики · Google AI'),hint:L('Enter برای ارسال · Shift + Enter برای خط جدید','Enter to send · Shift + Enter for a new line','Enter: gönder · Shift + Enter: yeni satır','Enter للإرسال · Shift + Enter لسطر جديد','Enter — отправить · Shift + Enter — новая строка'),you:L('شما','You','Siz','أنت','Вы'),assistant:L('همراه ایده‌آل','Ideal assistant','Ideal asistan','مساعد إيديال','Помощник Ideal')};
interface Message{id:string;role:'user'|'model';text:string;sources?:AiSource[];model?:string;retrieval?:AiRetrieval;}
export default function Assistant(){const app=useApp();return <AssistantBody key={`${app.locale}:${app.session?.id||'guest'}:${app.role}`}/>;}
function AssistantBody(){
 const {locale,session,sessionReady,href}=useApp();const c=aiCopy[locale];const[open,setOpen]=useState(false),[query,setQuery]=useState(''),[messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[configured,setConfigured]=useState<boolean|null>(null),[capability,setCapability]=useState<AiStatus|null>(null),[copied,setCopied]=useState('');
 const controller=useRef<AbortController|null>(null),serial=useRef(0),bottom=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null);
 const providerName=capability?.provider==='google'?'Google AI':capability?.provider==='openrouter'?'OpenRouter':'AI';const word=(k:keyof typeof labels)=>labels[k][locale].replaceAll('Google AI',providerName);const canAsk=configured===true&&(!!session||capability?.publicChat===true);const signIn=L('برای گفتگو وارد حساب شوید.','Sign in to use the assistant.','Asistanı kullanmak için giriş yapın.','سجّل الدخول لاستخدام المساعد.','Войдите, чтобы использовать помощника.')[locale];const retrievalLabel=(mode:AiRetrieval['mode'])=>(mode==='hybrid'?L('منابع: جست‌وجوی معنایی و متنی','Sources: semantic and text search','Kaynaklar: anlamsal ve metin araması','المصادر: بحث دلالي ونصي','Источники: семантический и текстовый поиск'):L('منابع: جست‌وجوی متنی','Sources: text search','Kaynaklar: metin araması','المصادر: بحث نصي','Источники: текстовый поиск'))[locale];
 useEffect(()=>()=>{serial.current++;controller.current?.abort();},[]);
 useEffect(()=>{serial.current++;controller.current?.abort();setBusy(false);setError('');},[locale]);
 useEffect(()=>{setConfigured(null);setCapability(null);if(!open||!sessionReady)return;const signal=new AbortController();apiClient.request<AiStatus>('/ai/status',{signal:signal.signal}).then(r=>{if(!signal.signal.aborted){setConfigured(r.configured===true);setCapability(r);}}).catch(()=>{if(!signal.signal.aborted)setConfigured(false);});return()=>signal.abort();},[open,sessionReady,session?.id,locale]);
 useEffect(()=>{const scroll=bottom.current?.parentElement;if(open&&scroll)scroll.scrollTo({top:scroll.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[messages,busy,error,open]);
 const stop=()=>{serial.current++;controller.current?.abort();setBusy(false);};const close=()=>{stop();setOpen(false);};
 function historyFor(retry:boolean){const prior=retry&&messages.at(-1)?.role==='user'?messages.slice(0,-1):messages;let length=0;return prior.slice(-14).reverse().map(m=>({role:m.role,text:m.text.slice(0,7500)})).filter(m=>{length+=m.text.length;return length<27000;}).reverse();}
 async function ask(value:string,retry=false){
  const prompt=value.trim();if(!prompt||busy||!canAsk||controller.current&&!controller.current.signal.aborted&&busy)return;const run=++serial.current;controller.current?.abort();controller.current=new AbortController();
  const history=historyFor(retry);if(!retry)setMessages(previous=>[...previous,{id:crypto.randomUUID(),role:'user',text:prompt}]);setQuery('');setError('');setBusy(true);
  try{const result=await requestAi({mode:'chat',locale,prompt,history},controller.current.signal);if(serial.current!==run)return;setConfigured(true);setMessages(previous=>[...previous,{id:result.id,role:'model',text:result.text,sources:result.sources,model:result.model,retrieval:result.retrieval}]);}
  catch(err){if(serial.current===run)setError(aiErrorMessage(err,locale));}
  finally{if(serial.current===run){setBusy(false);input.current?.focus({preventScroll:true});}}
 }
 async function copy(message:Message){try{await navigator.clipboard.writeText(message.text);setCopied(message.id);setTimeout(()=>setCopied(''),1800);}catch{input.current?.focus({preventScroll:true});}}
 return <><button className="assistant-fab" onClick={()=>setOpen(true)} aria-label={c.title}><Sparkles size={22}/><span>{c.title}</span><i/></button>
  {open&&<Modal title={c.title} onClose={close} className="assistant-dialog ai-assistant-dialog">
   <div className="ai-chat-toolbar"><span><i data-connected={canAsk}/>{configured===false?c.unconfigured:word('connected')}</span><button className="icon-btn" title={c.clear} aria-label={c.clear} onClick={()=>{stop();setMessages([]);setError('');setQuery('');input.current?.focus({preventScroll:true});}}><Plus size={20}/></button></div>
   <div className="ai-chat-scroll" role="log" aria-live="polite" aria-relevant="additions text">
    {!messages.length&&<div className="ai-chat-welcome"><span className="ai-chat-emblem"><Sparkles size={35}/></span><h3>{c.title}</h3><p>{c.intro}</p><small>{c.general}</small>{configured===true&&!canAsk&&<a className="btn" href={href('auth/login')}>{signIn}</a>}<div className="ai-chat-prompts">{prompts.map((p,i)=><button type="button" key={i} disabled={!canAsk||busy} onClick={()=>ask(p.text[locale])}><p.icon size={19}/><span>{p.text[locale]}</span><ArrowUpRight size={16}/></button>)}</div></div>}
    {messages.map(message=>{const used=(message.sources||[]).filter(s=>message.text.includes(`[${s.number}]`));return <article key={message.id} className={`ai-message ai-message-${message.role}`}><div className="ai-message-label">{message.role==='model'?<Sparkles size={15}/>:<span className="ai-you-dot"/>}<span>{message.role==='user'?word('you'):word('assistant')}</span></div>{message.role==='user'?<p className="ai-user-text" dir="auto">{message.text}</p>:<><AiMarkdown text={message.text} sources={message.sources} locale={locale}/>{used.length>0&&<details className="ai-source-details"><summary>{c.sources}<span>{used.length}</span></summary><div>{used.map(s=>{const href=safeAiLink(s.url,locale);return href?<a key={s.id} href={href} onClick={close}><span>[{s.number}]</span>{sourceTitle(s,locale)}<ArrowUpRight size={13}/></a>:null;})}</div></details>}<div className="ai-message-actions"><button className="icon-btn" title={word('copy')} aria-label={word('copy')} onClick={()=>copy(message)}>{copied===message.id?<Check size={15}/>:<Copy size={15}/>}</button><small dir="ltr">{message.model}</small>{message.retrieval&&<small>{retrievalLabel(message.retrieval.mode)}</small>}</div></>}</article>;})}
    {busy&&<div className="ai-thinking" role="status"><span><i/><i/><i/></span><p>{c.thinking}</p></div>}
    {error&&<div className="ai-chat-error" role="alert"><p>{error}</p><button className="text-link" onClick={()=>{const last=messages.findLast(m=>m.role==='user');if(last)ask(last.text,true);}}><RotateCcw size={14}/>{word('retry')}</button></div>}<div ref={bottom}/>
   </div>
   <form className="ai-chat-composer" onSubmit={event=>{event.preventDefault();ask(query);}}><div><textarea ref={input} value={query} rows={2} maxLength={10000} dir="auto" placeholder={c.placeholder} aria-label={c.placeholder} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!busy)ask(query);}}}/>{busy?<button type="button" className="icon-btn ai-send" onClick={stop} aria-label={c.stop}><Square size={18}/></button>:<button type="submit" className="icon-btn ai-send" disabled={!query.trim()||!canAsk} aria-label={c.send}><Send size={19}/></button>}</div><small>{word('hint')}</small></form>
  </Modal>}</>;
}
