'use client';
import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {Save,ShieldCheck,UserRound} from 'lucide-react';
import {apiClient,networkError} from '@/lib/api';
import {canWorkspace} from '@/lib/auth';
import type {WorkspaceRecord} from '@/data/workspace-seed';
import type {CrmScopeDirectory} from '@/types/crm';
import type {WorkspaceStore} from './store';
import {localized,roleNames,wt} from './i18n';
import {Field} from './ui';
import {crmAccessText as text} from './crm-access-copy';

const keys=['ownerId','assigneeId','teamId','territoryId'] as const;
type Assignment=Record<typeof keys[number],string>;
const fromRecord=(record:WorkspaceRecord):Assignment=>({ownerId:record.ownerId||'',assigneeId:record.assigneeId||'',teamId:record.teamId||'',territoryId:record.territoryId||''});

export default function RecordAssignment({record,store}:{record:WorkspaceRecord;store:WorkspaceStore}){
 const {locale}=store;
 const [directory,setDirectory]=useState<CrmScopeDirectory|null>(null),[draft,setDraft]=useState<Assignment>(()=>fromRecord(record));
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>setDraft(fromRecord(record)),[record.id,record.ownerId,record.assigneeId,record.teamId,record.territoryId]);
 useEffect(()=>{let active=true;void apiClient.request<CrmScopeDirectory>('/crm/scopes').then(value=>{if(active){setDirectory(value);setError('');}}).catch(reason=>{if(active)setError(networkError(reason,locale));});return()=>{active=false;};},[store.actorId,store.version]);
 const candidates=useMemo(()=>directory?.assignees.filter(user=>canWorkspace(user.role,'view',record.collection,{qualityScope:user.qualityScope})&&(!record.tags.includes('quality')||user.qualityScope))||[],[directory,record.collection,record.tags]);
 const editable=directory?.access.permissions.assign===true&&canWorkspace(store.role,'assign',record.collection);
 const changed=keys.some(key=>draft[key]!==fromRecord(record)[key]);
 const entries=(key:typeof keys[number])=>key==='teamId'?(directory?.teams||[]).filter(item=>item.active):key==='territoryId'?(directory?.territories||[]).filter(item=>item.active):candidates;
 const label=(key:typeof keys[number],id:string)=>{
  if(!id)return text('unassigned',locale);
  const item=entries(key).find(item=>item.id===id);
  return item?item.name:`${id} · ${text('unavailable',locale)}`;
 };
 const save=async(event:FormEvent)=>{event.preventDefault();if(!editable||busy||!changed)return;setBusy(true);setError('');try{
  const patch=Object.fromEntries(keys.filter(key=>draft[key]!==fromRecord(record)[key]).map(key=>[key,draft[key]||null]));
  await store.assign(record.id,patch);
 }catch(reason){setError(networkError(reason,locale));}finally{setBusy(false);}};
 return <section className="ws-card" style={{padding:'1.1rem',marginBlock:'1rem'}} data-record-assignment=""><h3><UserRound size={18}/>{text('assignments',locale)}</h3><p className="ws-muted">{text('independent',locale)}</p>{error&&<p className="ws-storage-error" role="alert">{error}</p>}
 {editable?<form onSubmit={save}><div className="ws-form-grid">{keys.map(key=><Field key={key} label={text(key,locale)}><select className="input" value={draft[key]} disabled={busy||store.pending} onChange={event=>setDraft(previous=>({...previous,[key]:event.target.value}))}><option value="">{text('unassigned',locale)}</option>{draft[key]&&!entries(key).some(item=>item.id===draft[key])&&<option value={draft[key]}>{label(key,draft[key])}</option>}{entries(key).map(item=><option key={item.id} value={item.id}>{item.name}{'role' in item?` · ${localized(roleNames[item.role]||item.role,locale)}`:''}</option>)}</select></Field>)}</div><button className="btn btn-primary ws-small-btn" disabled={!changed||busy||store.pending}><Save size={16}/>{wt('save',locale)}</button></form>:<><dl className="ws-form-grid">{keys.map(key=><div key={key}><dt className="ws-muted">{text(key,locale)}</dt><dd dir="auto" style={{margin:0}}>{label(key,record[key]||'')}</dd></div>)}</dl>{directory&&<p className="ws-muted"><ShieldCheck size={16}/>{text('restricted',locale)}</p>}</>}
 </section>;
}
