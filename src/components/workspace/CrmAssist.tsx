'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Clipboard,Loader2,Sparkles,X} from 'lucide-react';
import {apiClient,networkError} from '@/lib/api';
import {requestAi,aiErrorMessage,AiRequestError,type AiResult,type AiStatus,type CrmAiTask} from '@/lib/ai-client';
import type {WorkspaceRecord} from '@/data/workspace-seed';
import AiMarkdown,{safeAiLink,sourceTitle} from '@/components/ui/AiMarkdown';
import type {WorkspaceStore} from './store';
import {Field} from './ui';
import {wt} from './i18n';
import {StudioRequestGate} from './studio-ai';
import {aiOperationText as text} from './ai-operations-copy';

const tasks:CrmAiTask[]=['summary','reply','fields','next_steps'];
const collections=['accounts','contacts','leads','opportunities','activities','quotes','pricebooks','samples','handoffs','partners','tickets','segments','campaigns','inbox','automations','success'];
export default function CrmAssist({record,store}:{record:WorkspaceRecord;store:WorkspaceStore}){
 if(!['admin','superAdmin','business','support','scientificReviewer'].includes(store.role)||!collections.includes(record.collection)||!store.actor.allowedLocales?.includes(store.locale))return null;
 return <AssistantBody key={`${store.actorId}:${store.role}:${store.locale}:${record.id}:${record.updatedAt}`} record={record} store={store}/>;
}
function AssistantBody({record,store}:{record:WorkspaceRecord;store:WorkspaceStore}){
 const {locale}=store,tr=(key:Parameters<typeof text>[0])=>text(key,locale);
 const [task,setTask]=useState<CrmAiTask>('summary'),[prompt,setPrompt]=useState(''),[result,setResult]=useState<AiResult|null>(null),[configured,setConfigured]=useState<boolean|null>(null),[provider,setProvider]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const gate=useRef(new StudioRequestGate()),pending=useRef(false),alive=useRef(true),actor=`${store.actorId}:${store.role}:${locale}:${record.id}:${record.updatedAt}`;
 useEffect(()=>{alive.current=true;const controller=new AbortController();void apiClient.request<AiStatus>('/ai/status',{signal:controller.signal}).then(next=>{if(!controller.signal.aborted){setConfigured(next.capabilities.crm);setProvider(next.provider==='google'?'Google AI':'OpenRouter');}}).catch(reason=>{if(!controller.signal.aborted)setError(networkError(reason,locale));});return()=>{alive.current=false;gate.current.cancel();controller.abort();};},[]);
 const cancel=()=>{gate.current.cancel();pending.current=false;setBusy(false);};
 const submit=async(event:FormEvent)=>{event.preventDefault();if(pending.current||!prompt.trim()||configured!==true)return;pending.current=true;const ticket=gate.current.start(actor);setBusy(true);setResult(null);setError('');setNotice('');try{
  const response=await requestAi({mode:'crm_assist',locale,prompt:prompt.trim(),recordIds:[record.id],crmTask:task},ticket.controller.signal);
  if(gate.current.current(ticket,actor,true)&&alive.current)setResult(response);
 }catch(reason){if(gate.current.current(ticket,actor,true)&&alive.current)setError(reason instanceof AiRequestError&&reason.code==='CRM_CONTEXT_CHANGED'?tr('reviewedContext'):aiErrorMessage(reason,locale));}finally{if(gate.current.current(ticket,actor,true)&&alive.current){pending.current=false;setBusy(false);gate.current.finish(ticket);}}};
 const copy=async()=>{if(!result)return;try{await navigator.clipboard.writeText(result.text);if(alive.current)setNotice(wt('copied',locale));}catch{if(alive.current)setError(tr('copyFailed'));}};
 return <details className="ws-card" data-crm-assistant style={{padding:'1rem',marginBlock:'1rem'}}><summary><Sparkles size={17}/> {tr('crmTitle')}</summary><p className="ws-muted">{tr('crmNote')}</p><p>{tr('provider')}: <bdi>{provider||'—'}</bdi></p>{configured===false&&<p role="status">{tr('unavailable')}</p>}
 <form onSubmit={submit}><fieldset disabled={busy}><Field label={tr('task')}><select className="input" value={task} onChange={event=>setTask(event.target.value as CrmAiTask)}>{tasks.map(value=><option key={value} value={value}>{tr(value)}</option>)}</select></Field><Field label={wt('prompt',locale)}><textarea className="input" required maxLength={5000} rows={3} value={prompt} onChange={event=>setPrompt(event.target.value)}/></Field><button className="btn btn-primary" disabled={configured!==true||!prompt.trim()}>{busy?<Loader2 className="ws-spin" size={16}/>:<Sparkles size={16}/>} {wt('generate',locale)}</button></fieldset>{busy&&<button type="button" className="btn" onClick={cancel}><X size={16}/>{wt('cancel',locale)}</button>}</form>
 {error&&<p className="ws-storage-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{result&&<section lang={locale} dir={['fa','ar'].includes(locale)?'rtl':'ltr'}><p className="ws-muted">{tr('reviewed')} · <bdi>{result.provider} / {result.model}</bdi></p><AiMarkdown text={result.text} sources={result.sources} locale={locale}/>{result.sources.length>0&&<ul>{result.sources.map(source=>{const href=safeAiLink(source.url,locale);return href?<li key={source.id}><a href={href}>[{source.number}] {sourceTitle(source,locale)}</a></li>:null;})}</ul>}<button type="button" className="btn ws-small-btn" onClick={()=>void copy()}><Clipboard size={16}/>{wt('copy',locale)}</button></section>}</details>;
}
