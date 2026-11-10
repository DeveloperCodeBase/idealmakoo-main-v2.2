'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canWorkspace, type WorkspaceAction } from '@/lib/auth';
import { apiClient, demoMode, ApiError, networkError } from '@/lib/api';
import { refreshServerSite } from '@/lib/server-runtime';
import { applyWorkspaceMutation, canPublishWorkspaceSnapshot, canRestoreWorkspaceSnapshot, validWorkspaceSnapshot, matchesWorkspaceSession, projectWorkspaceState, workspaceInsights, canRecordAction, type WorkspaceActor } from './permissions';
import { createWorkspaceSeed, recordText } from '@/data/workspace-seed';
import { createEmptyWorkspaceState } from '@/data/workspace-defaults';
import type { WorkspaceState, WorkspaceRecord, WorkspaceActivity, LocalPublication } from '@/data/workspace-seed';
import { L, localized, wLocale, wt } from './i18n';
import type { WorkspaceText } from './i18n';

export const WORKSPACE_KEY = 'idealmakoo.workspace.v1';
export const PUBLICATION_KEY = 'idealmakoo.publications.v1';
export const REQUEST_KEY = 'idealmakoo.requests.v1';
export const uid = (prefix = 'IM') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export const now = () => new Date().toISOString();
export const fullText = (value: string, locale: string, previous?: WorkspaceText): WorkspaceText => ({ ...(previous || L('', '', '', '', '')), [wLocale(locale)]: value });
export const safeUrl = (value?: string) => !!value && (/^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value) || /^data:(image|video|audio)\//.test(value));

export type PublicRequest = { id: string; kind: string; name: string; email?: string; organization?: string; message?: string; productIds?: string[]; status?: string; createdAt: string; formId?: string; formVersion?: number; formValues?: Record<string,string>; messages?: { id: string; body: string; visibility: 'public' | 'internal'; createdAt: string; sender: string }[]; sharedQuotes?: { id: string; status: string; customerResponse?: string; respondedAt?: string }[] };
function getRequests(): PublicRequest[] {
  try { const value = JSON.parse(localStorage.getItem(REQUEST_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}
export function mergeWorkspaceRequests(state: WorkspaceState, requests: PublicRequest[]): WorkspaceState {
  const fresh = requests.filter(request => request.id && !state.records.some(record => record.requestId === request.id));
  let changed = fresh.length > 0;
  const forms = state.forms.map(form => {
    const incoming = requests.filter(request => request.formId === form.id && request.formValues && !form.responses.some(response => response.id === request.id));
    if (!incoming.length) return form;
    changed = true;
    return {...form, responses: [...form.responses, ...incoming.map(request => ({id:request.id,at:request.createdAt,values:Object.fromEntries(Object.entries(request.formValues || {}).filter(([key,value]) => !['__proto__','prototype','constructor'].includes(key) && typeof value === 'string'))}))]};
  });
  const synchronized = state.records.map(record => {
    const request = requests.find(item => item.id === record.requestId);
    if (!request) return record;
    const messages = (request.messages || []).filter(message => message.visibility === 'public' && !record.history.some(event => event.id === message.id));
    const quote = record.collection === 'quotes' ? request.sharedQuotes?.find(item => item.id === record.id && item.respondedAt && item.respondedAt !== record.quoteResponse?.at) : undefined;
    const withdrawn = request.status === 'withdrawn' && record.status !== 'withdrawn' && record.collection !== 'quotes';
    if (!messages.length && !quote && !withdrawn) return record;
    changed = true;
    const history: WorkspaceActivity[] = [...record.history, ...messages.map(message => ({ id: message.id, text: recordText(message.body), actor: message.sender, visibility: 'public' as const, at: message.createdAt }))];
    if(withdrawn)history.push({id:'withdrawn-'+request.id,text:L('مشتری درخواست را پس گرفت.','The customer withdrew the request.','Müşteri talebi geri çekti.','سحب العميل الطلب.','Клиент отозвал запрос.'),actor:'customer',visibility:'public',at:now()});
    if (quote?.respondedAt) history.push({ id: uid('response'), text: L(`پاسخ مشتری به پیشنهاد: ${quote.status === 'accepted_interest' ? 'اعلام تمایل به همکاری' : quote.status === 'revision_requested' ? 'درخواست اصلاح' : 'عدم پذیرش'} — ${quote.customerResponse || ''}`,`Customer proposal response: ${quote.status === 'accepted_interest' ? 'interest in cooperation' : quote.status === 'revision_requested' ? 'revision requested' : 'declined'} — ${quote.customerResponse || ''}`,`Müşteri teklif yanıtı: ${quote.status === 'accepted_interest' ? 'iş birliğine ilgi' : quote.status === 'revision_requested' ? 'revizyon istendi' : 'reddedildi'} — ${quote.customerResponse || ''}`,`رد العميل على العرض: ${quote.status === 'accepted_interest' ? 'إبداء الرغبة في التعاون' : quote.status === 'revision_requested' ? 'طلب تعديل' : 'عدم القبول'} — ${quote.customerResponse || ''}`,`Ответ клиента: ${quote.status === 'accepted_interest' ? 'интерес к сотрудничеству' : quote.status === 'revision_requested' ? 'запрошены изменения' : 'отказ'} — ${quote.customerResponse || ''}`), actor: 'customer', visibility: 'public', at: quote.respondedAt });
    return { ...record, history, updatedAt: now(), ...(withdrawn?{status:'withdrawn'}:{}), ...(quote?.respondedAt ? { quoteResponse: { status: quote.status, response: quote.customerResponse || '', at: quote.respondedAt } } : {}) };
  });
  if (!changed) return state;
  return { ...state, forms, records: [...fresh.map(request => {
    const kind = request.kind || '';
    const collection = /sample/i.test(kind) ? 'samples' : /support|ticket|quality|complaint/i.test(kind) ? 'tickets' : /career|job|talent|^hr$/i.test(kind) ? 'hr' : /partner|cooperat|distribut|invest|outsourc|suppl/i.test(kind) ? 'partners' : /rfq|inquiry/i.test(kind) ? 'leads' : 'inbox';
    const messages: WorkspaceActivity[] = (request.messages || []).filter(message => message.visibility === 'public').map(message => ({ id: message.id, text: recordText(message.body), at: message.createdAt, actor: message.sender, visibility: 'public' }));
    return { id: request.id, requestId: request.id, collection, title: recordText(request.name || request.organization || request.id), summary: recordText(request.message || ''), organization: request.organization, email: request.email, product: request.productIds?.[0], status: !request.status || request.status === 'received' ? 'new' : request.status, owner: collection === 'tickets' ? 'support' : collection === 'hr' ? 'hr' : 'business', createdAt: request.createdAt, updatedAt: request.createdAt, tags: ['website', kind, ...(/quality/i.test(kind) ? ['quality'] : [])], demo: false, priority: /quality/.test(kind) ? 'high' as const : 'normal' as const, history: [{ id: uid('event'), at: request.createdAt, actor: 'customer', visibility: 'public' as const, text: recordText(request.message || '') }, ...messages] };
  }), ...synchronized] };
}

export function useWorkspaceStore(locale: string, role: string, notify: (message: string) => void, actorId = role, scopes:Pick<WorkspaceActor,'allowedLocales'|'qualityScope'|'crmAccess'> = {}) {
  const emptyState=()=>demoMode?createWorkspaceSeed():createEmptyWorkspaceState();
  const [rawState,setRawState]=useState<WorkspaceState>(emptyState);
  const live=useRef(rawState);
  const version=useRef(0);
  const queue=useRef<Promise<unknown>>(Promise.resolve());
  const generation=useRef(0);
  const mounted=useRef(true);
  const [loaded,setLoaded]=useState(false);
  const ready=useRef(false);
  const [storageError,setStorageError]=useState(false);
  const [error,setError]=useState('');
  const [pending,setPending]=useState(0);
  const pendingRef=useRef(0);
  const actor=useMemo<WorkspaceActor>(()=>({role,id:actorId,locale,allowedLocales:scopes.allowedLocales,qualityScope:scopes.qualityScope,crmAccess:scopes.crmAccess}),[role,actorId,locale,scopes.allowedLocales,scopes.qualityScope,scopes.crmAccess]);
  const commit=useCallback((next:WorkspaceState,nextVersion?:number)=>{live.current=next;if(nextVersion!==undefined)version.current=nextVersion;if(mounted.current)setRawState(next);},[]);
  const refresh=useCallback(async()=>{
    if(demoMode)return;
    const result=await apiClient.request<{state:WorkspaceState;version:number}>('/workspace');
    if(!validWorkspaceSnapshot(result.state)||!Number.isSafeInteger(result.version))throw new Error('Invalid workspace response');
    if(!mounted.current)return;
    commit(result.state,result.version);ready.current=true;setLoaded(true);setStorageError(false);setError('');
  },[commit]);
  useEffect(()=>{
    mounted.current=true;let active=true;
    if(!demoMode){
      void refresh().catch(reason=>{if(active){setStorageError(true);setError(networkError(reason,locale));}});
      const synchronize=()=>{if(pendingRef.current===0)void refresh().catch(()=>{});};
      window.addEventListener('idealmakoo:requests',synchronize);
      return()=>{active=false;mounted.current=false;generation.current++;window.removeEventListener('idealmakoo:requests',synchronize);};
    }
    let base=createWorkspaceSeed();
    try{const value=JSON.parse(localStorage.getItem(WORKSPACE_KEY)||'null');if(validWorkspaceSnapshot(value))base={...base,...value};}catch{/* Corrupt demo storage is ignored. */}
    commit(mergeWorkspaceRequests(base,getRequests()));ready.current=true;setLoaded(true);
    const sync=()=>commit(mergeWorkspaceRequests(live.current,getRequests()));
    window.addEventListener('idealmakoo:requests',sync);
    const storage=(event:StorageEvent)=>{if(event.key===REQUEST_KEY)sync();};window.addEventListener('storage',storage);
    return()=>{mounted.current=false;window.removeEventListener('idealmakoo:requests',sync);window.removeEventListener('storage',storage);};
  },[commit,refresh]);
  const state=useMemo(()=>projectWorkspaceState(rawState,role),[rawState,role]);
  const insights=useMemo(()=>workspaceInsights(rawState,role),[rawState,role]);
  const activeActor=useCallback(()=>{
    if(!demoMode)return ready.current&&role!=='customer'&&!!actorId;
    try{return matchesWorkspaceSession(JSON.parse(localStorage.getItem('idealmakoo.session.v1')||'null'),actor);}catch{return false;}
  },[actor,role,actorId]);
  const permit=useCallback((action:WorkspaceAction,section:string,targetLocale=locale)=>activeActor()&&canWorkspace(role,action,section,{...actor,locale:targetLocale}),[activeActor,role,locale,actor]);
  const run=useCallback((operation:()=>Promise<boolean>):Promise<boolean>=>{
    const stamp=generation.current;
    pendingRef.current++;setPending(pendingRef.current);
    const task=queue.current.then(async()=>{
      if(stamp!==generation.current||!mounted.current)return false;
      try{return await operation();}
      catch(reason){
        const message=networkError(reason,locale);if(mounted.current){setStorageError(true);setError(message);notify(message);}
        if(reason instanceof ApiError&&(reason.status===409||reason.status===412)){generation.current++;await refresh().catch(()=>{});}
        return false;
      }
    }).finally(()=>{pendingRef.current=Math.max(0,pendingRef.current-1);if(mounted.current)setPending(pendingRef.current);});queue.current=task;return task;
  },[locale,notify,refresh]);
  const update=useCallback((fn:(previous:WorkspaceState)=>WorkspaceState,message?:string):Promise<boolean>=>run(async()=>{
    if(!activeActor()){notify(wt('denied',locale));return false;}
    const proposed=fn(projectWorkspaceState(live.current,role));const candidate=demoMode?proposed:{...proposed,records:proposed.records.map(record=>({...record,demo:false}))};
    const decision=applyWorkspaceMutation(live.current,candidate,actor);
    if(!decision.ok){notify(wt('denied',locale));return false;}
    if(demoMode){localStorage.setItem(WORKSPACE_KEY,JSON.stringify(decision.state));commit(decision.state);}
    else{const result=await apiClient.request<{state:WorkspaceState;version:number}>('/workspace',{method:'PUT',body:JSON.stringify({state:decision.state,expectedVersion:version.current,locale})});commit(result.state,result.version);}
    setStorageError(false);setError('');if(message)notify(message);return true;
  }),[run,activeActor,locale,role,actor,notify,commit]);
  const log=useCallback((text:WorkspaceText):WorkspaceActivity=>({id:uid('event'),text,at:now(),actor:role,visibility:'internal'}),[role]);
  const restoreSnapshot=useCallback((snapshot:unknown):Promise<boolean>=>run(async()=>{
    if(!activeActor()||!canRestoreWorkspaceSnapshot(actor,snapshot)){notify(wt('invalidImport',locale));return false;}
    if(demoMode){localStorage.setItem(WORKSPACE_KEY,JSON.stringify(snapshot));commit(snapshot);}
    else{const result=await apiClient.request<{state:WorkspaceState;version:number}>('/workspace',{method:'PUT',body:JSON.stringify({state:snapshot,expectedVersion:version.current,locale})});commit(result.state,result.version);}
    notify(wt('saved',locale));return true;
  }),[run,activeActor,actor,notify,locale,commit]);
  const patchRecord=useCallback(async(id:string,patch:Partial<WorkspaceRecord>,message=wt('saved',locale),expectedUpdatedAt?:string)=>{
    const activity=log(L('پرونده به‌روزرسانی شد.','Record updated.','Kayıt güncellendi.','تم تحديث السجل.','Запись обновлена.'));
    const tagged={...patch,...(patch.author===role?{authorId:actorId}:{}),...(patch.approvedBy===role?{approvedById:actorId}:{}),...(patch.approvedBy===undefined&&'approvedBy' in patch?{approvedById:undefined}:{})};
    const accepted=await update(previous=>{if(expectedUpdatedAt!==undefined&&previous.records.find(record=>record.id===id)?.updatedAt!==expectedUpdatedAt)throw new ApiError({type:'about:blank',title:'Saved source changed',status:409,code:'SOURCE_CHANGED',detail:'The saved source changed after this editor loaded it. Preserve your draft and reload the source before saving.'});return {...previous,records:previous.records.map(record=>record.id===id?{...record,...tagged,updatedAt:now(),history:[...record.history,activity]}:record),audit:[activity,...previous.audit].slice(0,300)};},message);
    if(accepted&&demoMode&&patch.status&&permit('stage',live.current.records.find(record=>record.id===id)?.collection||'')){
      const requests=getRequests();if(requests.some(request=>request.id===id)){localStorage.setItem(REQUEST_KEY,JSON.stringify(requests.map(request=>request.id===id?{...request,status:patch.status}:request)));window.dispatchEvent(new Event('idealmakoo:requests'));}
    }
    return accepted;
  },[locale,log,update,permit,role,actorId]);
  const addRecord=useCallback((record:WorkspaceRecord)=>{
    const activity=log(L('محتوا یا پرونده جدید ثبت شد.','New content or record created.','Yeni içerik veya kayıt oluşturuldu.','تم إنشاء محتوى أو سجل جديد.','Создан новый контент или запись.'));
    return update(previous=>({...previous,records:[{...record,author:role,authorId:actorId,demo:demoMode&&record.demo},...previous.records],audit:[activity,...previous.audit].slice(0,300)}),wt('saved',locale));
  },[locale,log,update,role,actorId]);
  const addNote=useCallback(async(id:string,text:string,visibility:'public'|'internal')=>{
    const record=live.current.records.find(item=>item.id===id);if(!record||!activeActor()||!canRecordAction(actor,visibility==='public'?'reply':'note',record)){notify(wt('denied',locale));return false;}
    const activity={...log(recordText(text)),visibility};
    const accepted=await update(previous=>({...previous,records:previous.records.map(record=>record.id===id?{...record,updatedAt:now(),history:[...record.history,activity]}:record),audit:[activity,...previous.audit].slice(0,300)}),wt('saved',locale));
    if(accepted&&demoMode&&visibility==='public'){
      const requests=getRequests();if(requests.some(request=>request.id===id)){localStorage.setItem(REQUEST_KEY,JSON.stringify(requests.map(request=>request.id===id?{...request,messages:[...(request.messages||[]),{id:activity.id,body:text,visibility:'public',createdAt:activity.at,sender:role}]}:request)));window.dispatchEvent(new Event('idealmakoo:requests'));}
    }
    return accepted;
  },[activeActor,actor,locale,log,notify,role,update]);
  const review=useCallback((bucket:'records'|'pages',id:string,reviewLocale=locale):Promise<boolean>=>{
    if(demoMode)return update(previous=>({...previous,[bucket]:previous[bucket].map(item=>item.id===id?{...item,status:'approved',approvedBy:role,approvedById:actorId}:item)}),wt('saved',locale));
    return run(async()=>{
      const source=bucket==='pages'?live.current.pages.find(item=>item.id===id):live.current.records.find(item=>item.id===id);
      if(!source||!activeActor()||!canWorkspace(role,'review','collection'in source?source.collection:'pages',{...actor,locale:reviewLocale,authorId:source.authorId,authorRole:source.author,actorId})){notify(wt('noSelfReview',locale));return false;}
      const result=await apiClient.request<{state:WorkspaceState;version:number}>('/workspace/review',{method:'POST',body:JSON.stringify({bucket,id,locale:reviewLocale,expectedVersion:version.current})});commit(result.state,result.version);notify(wt('saved',locale));return true;
    });
  },[run,update,activeActor,role,actor,actorId,locale,commit,notify]);
  const schedule=useCallback((bucket:'records'|'pages',id:string,scheduledLocale:string,scheduledAt:string):Promise<boolean>=>{
    if(demoMode)return update(previous=>({...previous,[bucket]:previous[bucket].map(item=>item.id===id?{...item,status:'scheduled',scheduledAt}:item)}),wt('saved',locale));
    return run(async()=>{
      const source=bucket==='pages'?live.current.pages.find(item=>item.id===id):live.current.records.find(item=>item.id===id);
      if(!source||!permit('publish','collection'in source?source.collection:'pages',scheduledLocale))return false;
      const result=await apiClient.request<{state:WorkspaceState;version:number}>('/workspace/schedule',{method:'POST',body:JSON.stringify({bucket,id,locale:scheduledLocale,scheduledAt,expectedVersion:version.current})});commit(result.state,result.version);notify(wt('saved',locale));return true;
    });
  },[run,update,permit,commit,notify,locale]);
  const cancelSchedule=useCallback((bucket:'records'|'pages',id:string,scheduledLocale:string):Promise<boolean>=>{
    if(demoMode)return update(previous=>({...previous,[bucket]:previous[bucket].map(item=>item.id===id?{...item,status:'approved',scheduledAt:undefined}:item)}),wt('saved',locale));
    return run(async()=>{
      const source=bucket==='pages'?live.current.pages.find(item=>item.id===id):live.current.records.find(item=>item.id===id);
      if(!source||!permit('publish','collection'in source?source.collection:'pages',scheduledLocale))return false;
      const result=await apiClient.request<{state:WorkspaceState;version:number}>('/workspace/schedule/cancel',{method:'POST',body:JSON.stringify({bucket,id,locale:scheduledLocale,expectedVersion:version.current})});commit(result.state,result.version);notify(wt('saved',locale));return true;
    });
  },[run,update,permit,commit,notify,locale]);
  const restoreRevision=useCallback((revisionId:string,expectedUpdatedAt:string):Promise<boolean>=>run(async()=>{
    if(demoMode||!activeActor())return false;
    const result=await apiClient.request<{state:WorkspaceState;version:number}>('/workspace/restore',{method:'POST',body:JSON.stringify({revisionId,expectedUpdatedAt,expectedVersion:version.current})});commit(result.state,result.version);notify(wt('saved',locale));return true;
  }),[run,activeActor,commit,notify,locale]);
  const publish=useCallback((publication:LocalPublication):Promise<boolean>=>run(async()=>{
    const section=publication.kind==='page'?'pages':publication.kind==='product'?'products':publication.kind==='article'?'research':publication.kind;
    const page=live.current.pages.find(item=>item.id===publication.id&&item.locale===publication.locale);
    const source=page||live.current.records.find(item=>item.id===publication.id);
    if(!permit('publish',section,publication.locale)||!canPublishWorkspaceSnapshot(actor,publication,source)){notify(wt('reviewRequired',locale));return false;}
    if(demoMode){let previous:LocalPublication[]=[];try{const parsed=JSON.parse(localStorage.getItem(PUBLICATION_KEY)||'[]');if(Array.isArray(parsed))previous=parsed;}catch{/* Demo data only. */}localStorage.setItem(PUBLICATION_KEY,JSON.stringify([...previous.filter(item=>!(item.slug===publication.slug&&item.locale===publication.locale&&item.kind===publication.kind)),publication]));window.dispatchEvent(new Event('idealmakoo:publications'));}
    else{const result=await apiClient.request<{state:WorkspaceState;version:number}>('/workspace/publish',{method:'POST',body:JSON.stringify({publication:{id:publication.id,kind:publication.kind,locale:publication.locale},expectedVersion:version.current})});commit(result.state,result.version);await refreshServerSite();}
    notify(wt('publishedNotice',locale));return true;
  }),[run,permit,actor,notify,locale,commit]);
  const unpublish=useCallback((slug:string,publicationLocale:string,kind='page'):Promise<boolean>=>run(async()=>{
    const module=kind==='page'?'pages':kind==='product'?'products':kind;
    if(!permit('publish',module,publicationLocale)){notify(wt('denied',locale));return false;}
    if(demoMode){const previous=JSON.parse(localStorage.getItem(PUBLICATION_KEY)||'[]') as LocalPublication[];localStorage.setItem(PUBLICATION_KEY,JSON.stringify(previous.filter(item=>!(item.slug===slug&&item.locale===publicationLocale&&item.kind===kind))));window.dispatchEvent(new Event('idealmakoo:publications'));}
    else{const result=await apiClient.request<{state:WorkspaceState;version:number}>('/workspace/unpublish',{method:'POST',body:JSON.stringify({slug,locale:publicationLocale,kind,expectedVersion:version.current})});commit(result.state,result.version);await refreshServerSite();}
    notify(wt('saved',locale));return true;
  }),[run,permit,locale,notify,commit]);
  const command=useCallback((path:string,input:Record<string,unknown>,method:'POST'|'PUT'='POST'):Promise<boolean>=>run(async()=>{
    if(demoMode||!activeActor())return false;
    const stamp=generation.current;
    const result=await apiClient.request<{state:WorkspaceState;version:number}>(path,{method,body:JSON.stringify({...input,expectedVersion:version.current})});
    if(stamp!==generation.current||!mounted.current)return false;
    if(!validWorkspaceSnapshot(result.state)||!Number.isSafeInteger(result.version))throw new Error('Invalid workspace command response');
    commit(result.state,result.version);setError('');setStorageError(false);notify(wt('saved',locale));return true;
  }),[run,activeActor,commit,notify,locale]);
  const assign=useCallback((id:string,patch:Partial<Record<'ownerId'|'assigneeId'|'teamId'|'territoryId',string|null>>)=>command('/workspace/assign',{id,...patch}),[command]);
  const getState=useCallback(()=>projectWorkspaceState(live.current,role),[role]);
  return {state,version:version.current,insights,actor,actorId,loaded,storageError,error,pending:pending>0,locale:wLocale(locale),role,notify,permit,command,assign,update,restoreSnapshot,restoreRevision,review,schedule,cancelSchedule,patchRecord,addRecord,addNote,log,publish,unpublish,refresh,getState};
}
export type WorkspaceStore = ReturnType<typeof useWorkspaceStore>;

export function downloadFile(content: string, filename: string, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportRecords(records: WorkspaceRecord[], locale: string, filename: string) {
  const escaped = (value: unknown) => { let str = String(value ?? ''); if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`; return `"${str.replaceAll('"', '""')}"`; };
  const rows = [[wt('title', locale), 'ID', wt('status', locale), wt('organization', locale), wt('email', locale), wt('updated', locale)], ...records.map(record => [localized(record.title, locale), record.id, wt(record.status, locale), record.organization || '', record.email || '', record.updatedAt])];
  downloadFile('\ufeff' + rows.map(row => row.map(escaped).join(',')).join('\r\n'), `${filename}.csv`, 'text/csv;charset=utf-8');
}
export function canEdit(role: string, section: string) { return canWorkspace(role,'edit',section); }
