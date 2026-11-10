'use client';
import {useEffect,useRef,useState} from 'react';
import {Archive,Check,Eye,FileDown,Plus,Save,Send,Trash2} from 'lucide-react';
import {ApiError,demoMode,networkError} from '@/lib/api';
import {locales,localeNames,type Locale} from '@/lib/i18n';
import {emptyNoticeLocale,parsePublicNoticeDefinition,normalizeNoticePath,type PublicNoticeLocale,type PublicNoticeDefinition} from '@/lib/public-notices';
import {downloadJson} from '@/lib/storage';
import {usePublications} from '@/lib/publications';
import type {WorkspaceRecord} from '@/data/workspace-seed';
import {type WorkspaceStore,now,uid} from './store';
import {L,localized,wt} from './i18n';
import {canRecordAction} from './permissions';
import {publicNoticeCopy} from './public-notice-copy';
import {editorConflictCopy} from './editor-conflict-copy';
import ContentCollaboration,{type LeaseState} from './ContentCollaboration';
import PublicationSchedule from './PublicationSchedule';
import RevisionHistory from './RevisionHistory';
import {Status} from './ui';
import styles from '@/components/controlled/controlled.module.css';

export default function PublicNoticeManager({store}:{store:WorkspaceStore}){
  const [id,setId]=useState('');
  const records=store.state.records.filter(record=>record.collection==='news'&&record.details?.publicNotice!==undefined),c=(key:keyof typeof publicNoticeCopy)=>localized(publicNoticeCopy[key],store.locale);
  const selected=records.find(record=>record.id===id),canCreate=store.permit('create','news')&&(store.actor.allowedLocales||[]).length===5;
  useEffect(()=>setId(''),[store.actorId]);
  return <section className={styles.panel} aria-label={c('title')} data-public-notice-manager>
    <header className={styles.header}><div><h2>{c('title')}</h2><p>{c('intro')}</p></div>{canCreate&&<button type="button" className="btn" disabled={store.pending} onClick={()=>setId('new')}><Plus size={16}/>{c('create')}</button>}</header>
    <label className="field"><span>{c('select')}</span><select className="input" value={selected?.id||''} disabled={store.pending} onChange={event=>setId(event.target.value)}><option value="">{wt('select',store.locale)}</option>{records.map(record=><option key={record.id} value={record.id}>{record.title[store.locale]||record.id} · {wt(record.status,store.locale)}</option>)}</select></label>
    {!records.length&&id!=='new'&&<p>{c('empty')}</p>}
    {(selected||id==='new'&&canCreate)&&<NoticeEditor key={`${store.actorId}:${id}`} store={store} record={selected} onCreated={setId} onDeleted={()=>setId('')}/>}
  </section>;
}
function emptyRecord(store:WorkspaceStore):WorkspaceRecord{return{id:uid('NOTICE'),collection:'news',title:L('','','','',''),summary:L('','','','',''),status:'draft',owner:store.role,createdAt:now(),updatedAt:now(),tags:[],history:[],demo:demoMode,publishedLocales:[],details:{publicNotice:{schemaVersion:1,locales:{[store.locale]:emptyNoticeLocale()}}}};}
function localInput(value:string|null){if(!value)return '';const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);}
function utcInput(value:string){if(!value)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():value;}
function NoticeEditor({store,record,onCreated,onDeleted}:{store:WorkspaceStore;record?:WorkspaceRecord;onCreated:(id:string)=>void;onDeleted:()=>void}){
  const [draft,setDraft]=useState(()=>structuredClone(record||emptyRecord(store))),origin=useRef(record?structuredClone(record):null);
  const [language,setLanguage]=useState<Locale>(store.actor.allowedLocales?.includes(store.locale)?store.locale:(store.actor.allowedLocales?.[0] as Locale)||store.locale),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[lease,setLease]=useState<LeaseState>(record?'loading':'held');
  const mounted=useRef(true),pending=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const c=(key:keyof typeof publicNoticeCopy)=>localized(publicNoticeCopy[key],store.locale),e=(key:keyof typeof editorConflictCopy)=>localized(editorConflictCopy[key],store.locale);
  const definition=parsePublicNoticeDefinition(draft.details?.publicNotice),rawDefinition=draft.details?.publicNotice as PublicNoticeDefinition,fields=rawDefinition?.locales?.[language]||{...emptyNoticeLocale(),enabled:false},languages=locales.filter(locale=>store.actor.allowedLocales?.includes(locale));
  const changed=JSON.stringify(draft)!==JSON.stringify(origin.current||emptyRecordForCompare(draft));
  const stale=!!record&&(!origin.current||record.updatedAt!==origin.current.updatedAt)||conflict;
  const permitted=(store.permit('edit','news',language)||store.permit('translate','news',language))&&record?.status!=='archived';
  const editable=permitted&&!stale&&!busy&&!store.pending&&(demoMode||!record||lease==='held');
  const publications=usePublications(),live=publications.find(item=>item.id===record?.id&&item.locale===language&&item.publicNotice);
  const adopt=()=>{const current=store.getState().records.find(item=>item.id===draft.id);if(current&&mounted.current){origin.current=structuredClone(current);setDraft(structuredClone(current));setConflict(false);setError('');}};
  const patch=(next:Partial<PublicNoticeLocale>)=>{if(!editable)return;setDraft(value=>({...value,details:{...value.details,publicNotice:{schemaVersion:1,locales:{...(value.details?.publicNotice as PublicNoticeDefinition)?.locales,[language]:{...fields,...next}}}}}));};
  const command=async(operation:()=>Promise<boolean>)=>{if(pending.current)return false;pending.current=true;setBusy(true);setError('');try{const accepted=await operation();if(!mounted.current)return false;if(accepted)adopt();else setError(previous=>previous||store.error||c('failure'));return accepted;}catch(reason){if(mounted.current){if(reason instanceof ApiError&&[409,412].includes(reason.status))setConflict(true);setError(networkError(reason,store.locale));}return false;}finally{pending.current=false;if(mounted.current)setBusy(false);}};
  const save=(submit=false)=>void command(async()=>{
    if(!editable||!definition||submit&&(!draft.title[language].trim()||!draft.summary[language].trim()||!definition.locales[language])){setError(c('validation'));return false;}
    if(submit&&!store.permit('submit','news',language))return false;
    const next:WorkspaceRecord={...draft,status:submit?'review':'draft',author:store.role,authorId:store.actorId,approvedBy:undefined,approvedById:undefined,updatedAt:now()};
    if(!record){const accepted=await store.addRecord(next);if(accepted&&mounted.current)onCreated(next.id);return accepted;}
    const expected=origin.current?.updatedAt;
    const accepted=await store.update(state=>{const current=state.records.find(item=>item.id===record.id);if(!current||current.updatedAt!==expected)throw new ApiError({type:'about:blank',title:'Notice revision changed',status:409,code:'revision_conflict',detail:'Reload the current notice before writing this draft.'});return{...state,records:state.records.map(item=>item.id===record.id?{...next,history:item.history}:item)};},wt('saved',store.locale));
    return accepted;
  });
  const currentAction=async(run:()=>Promise<boolean>)=>{if(!record||changed||stale)return false;return run();};
  const publish=()=>void command(()=>currentAction(()=>store.publish({id:record!.id,slug:record!.id.toLowerCase(),kind:'news',locale:language,title:record!.title[language],summary:record!.summary[language],body:record!.summary[language],blocks:[],publishedAt:now(),version:1,publicNotice:{schemaVersion:1,...fields}})));
  const reload=()=>void command(async()=>{await store.refresh();adopt();return true;});
  const archive=()=>void command(()=>currentAction(()=>store.patchRecord(record!.id,{status:record!.status==='archived'?'draft':'archived',archivedFrom:record!.status==='archived'?undefined:record!.status,approvedBy:undefined,approvedById:undefined})));
  const remove=()=>void command(async()=>{if(!record||changed||stale||!window.confirm(c('deleteConfirm')))return false;const accepted=await store.update(state=>{const current=state.records.find(item=>item.id===record.id);if(current?.updatedAt!==origin.current?.updatedAt)throw new ApiError({type:'about:blank',title:'Notice revision changed',status:409,code:'revision_conflict',detail:'Reload before deleting the notice.'});return{...state,records:state.records.filter(item=>item.id!==record.id)};},c('deleted'));if(accepted&&mounted.current)onDeleted();return accepted;});
  return <div className={styles.panel}>
    <div className={styles.row}><Status status={record?.status||'draft'} locale={store.locale}/><label className="field"><span>{wt('language',store.locale)}</span><select className="input" value={language} disabled={busy} onChange={event=>setLanguage(event.target.value as Locale)}>{languages.map(locale=><option key={locale} value={locale}>{localeNames[locale]}</option>)}</select></label></div>
    {record&&record.status!=='archived'&&<ContentCollaboration store={store} bucket="records" id={record.id} sourceUpdatedAt={origin.current?.updatedAt||record.updatedAt} dirty={changed||stale} canEdit={permitted} locale={language} onLeaseState={setLease}/>}
    {error&&<p role="alert" className={styles.error}>{error}</p>}{stale&&<div role="alert" className={styles.notice}><p>{e('changed')}</p><button type="button" className="btn" onClick={()=>downloadJson(draft,'public-notice-draft.json')}><FileDown size={15}/>{e('export')}</button><button type="button" className="btn" disabled={busy} onClick={reload}>{e('reload')}</button></div>}
    <div className={styles.grid}>
      <label className="field"><span>{wt('title',store.locale)} · {language.toUpperCase()}</span><input className="input" dir={language==='fa'||language==='ar'?'rtl':'ltr'} maxLength={160} disabled={!editable} value={draft.title[language]} onChange={event=>setDraft(value=>({...value,title:{...value.title,[language]:event.target.value}}))}/></label>
      <label className="field"><span>{c('message')} · {language.toUpperCase()}</span><textarea className="input" rows={3} dir={language==='fa'||language==='ar'?'rtl':'ltr'} maxLength={600} disabled={!editable} value={draft.summary[language]} onChange={event=>setDraft(value=>({...value,summary:{...value.summary,[language]:event.target.value}}))}/></label>
      <label className="field"><span>{c('starts')}</span><input className="input" type="datetime-local" value={localInput(fields.startsAt)} disabled={!editable} onChange={event=>patch({startsAt:utcInput(event.target.value)})}/></label>
      <label className="field"><span>{c('ends')}</span><input className="input" type="datetime-local" value={localInput(fields.endsAt)} disabled={!editable} onChange={event=>patch({endsAt:utcInput(event.target.value)})}/></label>
      <label className="field"><span>{c('action')}</span><input className="input" dir="ltr" maxLength={240} disabled={!editable} value={fields.actionPath} onChange={event=>patch({actionPath:event.target.value,...(!event.target.value?{actionLabel:''}:{})})} onBlur={()=>{const path=normalizeNoticePath(fields.actionPath);if(path!==null&&path!==fields.actionPath)patch({actionPath:path});}}/></label>
      <label className="field"><span>{c('actionLabel')}</span><input className="input" maxLength={120} disabled={!editable||!fields.actionPath} value={fields.actionLabel} onChange={event=>patch({actionLabel:event.target.value})}/></label>
    </div>
    <label className={styles.row}><input type="checkbox" disabled={!editable} checked={fields.enabled} onChange={event=>patch({enabled:event.target.checked})}/>{c('enabled')}</label><p className={styles.muted}>{c('enabledHelp')}</p><p className={styles.muted}>{c('clock')}</p>
    {!definition&&<p role="alert" className={styles.error}>{c('validation')}</p>}
    <div className={styles.notice} lang={language} dir={language==='fa'||language==='ar'?'rtl':'ltr'}><small>{c('draftPreview')}</small><h3>{draft.title[language]}</h3><p>{draft.summary[language]}</p>{fields.actionPath&&<span>{fields.actionLabel} · <bdi>{fields.actionPath}</bdi></span>}</div>
    <div className={styles.row}><button type="button" className="btn" disabled={!editable} onClick={()=>save(false)}><Save size={16}/>{wt('save',store.locale)}</button><button type="button" className="btn" disabled={!editable||!store.permit('submit','news',language)} onClick={()=>save(true)}><Send size={16}/>{wt('sendReview',store.locale)}</button></div>
    {record&&<><p>{live?<>{c('active')}: <time>{new Date(live.publishedAt).toLocaleString(store.locale)}</time></>:c('unpublished')}</p>{changed&&<p>{c('savedOnly')}</p>}<div className={styles.row}>
      <button type="button" className="btn" disabled={busy||store.pending||changed||stale||!canRecordAction({...store.actor,locale:language},'review',record)||!['review','approved','published'].includes(record.status)} onClick={()=>void command(()=>currentAction(()=>store.review('records',record.id,language)))}><Check size={16}/>{wt('approve',store.locale)}</button>
      <button type="button" className="btn" disabled={busy||store.pending||changed||stale||!store.permit('publish','news',language)||!['approved','published'].includes(record.status)} onClick={publish}><Eye size={16}/>{wt('publish',store.locale)}</button>
      <button type="button" className="btn" disabled={busy||store.pending||changed||stale||!store.permit('publish','news',language)||!record.publishedLocales?.includes(language)} onClick={()=>void command(()=>currentAction(()=>store.unpublish(record.id.toLowerCase(),language,'news')))}>{wt('unpublish',store.locale)}</button>
      <button type="button" className="btn" disabled={busy||store.pending||changed||stale||!store.permit('archive','news',language)||record.status!=='archived'&&!!record.publishedLocales?.length} onClick={archive}><Archive size={16}/>{record.status==='archived'?c('restore'):wt('archive',store.locale)}</button>
      <button type="button" className="btn" disabled={busy||store.pending||changed||stale||!store.permit('archive','news',language)||!!record.publishedLocales?.length} onClick={remove}><Trash2 size={16}/>{c('delete')}</button>
    </div><p className={styles.muted}>{c('unpublishedNote')}</p><PublicationSchedule store={store} bucket="records" id={record.id} locale={language} status={record.status} dirty={changed||stale||busy} onChanged={adopt}/><RevisionHistory store={store} bucket="records" id={record.id} locale={language} canRestore={editable&&!changed&&!stale} onRestored={adopt}/></>}
  </div>;
}
function emptyRecordForCompare(record:WorkspaceRecord){return{...record,title:L('','','','',''),summary:L('','','','',''),details:{publicNotice:{schemaVersion:1,locales:{}}}};}
