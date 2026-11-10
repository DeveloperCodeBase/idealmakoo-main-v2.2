'use client';
import {demoMode} from '@/lib/api';
import ProductionPipeline from './ProductionPipeline';

import { useState } from 'react';
import {canWorkspace} from '@/lib/auth';
import { Download, GripVertical, KanbanSquare, List, Plus, ArrowUpRight, CircleDot } from 'lucide-react';
import { WorkspaceRecord } from '@/data/workspace-seed';
import { WorkspaceStore, canEdit, exportRecords } from './store';
import { localized, wt } from './i18n';
import { RecordDetail, RecordEditor, RecordsDesk } from './Records';
import { SearchInput, Status } from './ui';

export function Pipeline({store,collection='opportunities'}:{store:WorkspaceStore;collection?:string}){return !demoMode&&collection==='opportunities'?<ProductionPipeline store={store}/>:<LegacyPipeline store={store} collection={collection}/>;}
function LegacyPipeline({ store, collection = 'opportunities' }: { store: WorkspaceStore; collection?: string }) {
  const { state, locale, role } = store;
  const [query, setQuery] = useState('');
  const [view, setView] = useState('board');
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkspaceRecord | 'new' | null>(null);
  const stages = collection === 'samples' ? ['requested', 'working', 'shipped', 'delivered', 'evaluated'] : ['new', 'working', 'qualified', 'proposal', 'won'];
  const editable = canWorkspace(role,'stage',collection);
  const rows = state.records.filter(record => record.collection === collection && record.status !== 'archived' && `${localized(record.title, locale)} ${record.organization || ''}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
  const selected = state.records.find(record => record.id === detail);
  const move = async (id: string, status: string) => { if (editable) await store.patchRecord(id, { status }); setDrag(null); setOver(null); };
  return <div><div className="ws-toolbar"><SearchInput value={query} onChange={setQuery} locale={locale}/><div className="ws-toolbar-end"><div className="ws-segmented"><button aria-label={wt('board', locale)} aria-pressed={view === 'board'} onClick={() => setView('board')}><KanbanSquare size={18}/></button><button aria-label={wt('list', locale)} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={18}/></button></div><button className="btn ws-small-btn" disabled={!canWorkspace(role,'export',collection)} onClick={() => {if(store.permit('export',collection))exportRecords(rows, locale, `idealmakoo-${collection}`);}}><Download size={15}/>{wt('export', locale)}</button>{editable && <button className="btn btn-primary ws-small-btn" onClick={() => setEditing('new')}><Plus size={17}/>{wt('create', locale)}</button>}</div></div>
    {view === 'list' ? <RecordsDesk collection={collection} store={store} initialQuery={query}/> : <div className="ws-kanban" aria-label={wt('board', locale)}>{stages.map((stage, index) => <section className={`ws-kanban-column ${over === stage ? 'ws-drag-over' : ''}`} key={stage} onDragOver={event => { if (editable) { event.preventDefault(); setOver(stage); } }} onDragLeave={() => setOver(null)} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain') || drag; if (id && rows.some(r => r.id === id)) move(id, stage); }}><div className="ws-kanban-head"><span><i style={{ background: ['#58f3ff', '#8a7dff', '#f0c576', '#db92f3', '#5ad6aa'][index] }}/>{wt(stage, locale)}</span><b>{rows.filter(record => record.status === stage).length}</b></div><div className="ws-kanban-cards">{rows.filter(record => record.status === stage).map(record => <article key={record.id} className={`ws-card ws-kanban-card ${drag === record.id ? 'ws-dragging' : ''}`} draggable={editable} onDragStart={event => { setDrag(record.id); event.dataTransfer.setData('text/plain', record.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDrag(null); setOver(null); }}><div className="ws-flex-between"><small className="ws-kanban-id"><bdi>{record.id.slice(-14)}</bdi></small><GripVertical size={15}/></div><button className="ws-row-title" onClick={() => setDetail(record.id)}>{localized(record.title, locale)}</button><p><bdi>{record.organization || '—'}</bdi></p><div className="ws-kanban-value"><CircleDot size={14}/>{record.amount ? <bdi>{record.amount} {record.currency}</bdi> : wt('unknown', locale)}</div><div className="ws-kanban-foot"><span className="ws-kanban-avatar">IM</span><span>{wt(record.demo ? 'sample' : 'new', locale)}</span><button className="ws-icon-button" onClick={() => setDetail(record.id)} aria-label={wt('details', locale)}><ArrowUpRight size={16}/></button></div><label className="ws-stage-control"><span>{wt('moveStage', locale)}</span><select disabled={!editable} value={record.status} onChange={e => move(record.id, e.target.value)} aria-label={`${wt('moveStage', locale)} ${localized(record.title, locale)}`}>{stages.map(s => <option key={s} value={s}>{wt(s, locale)}</option>)}</select></label></article>)}<button disabled={!editable} className="ws-kanban-add" onClick={() => setEditing('new')}><Plus size={16}/>{wt('create', locale)}</button></div></section>)}</div>}
    {selected && <RecordDetail record={selected} store={store} onClose={() => setDetail(null)} onEdit={() => { setDetail(null); setEditing(selected); }}/>}{editing && <RecordEditor record={editing === 'new' ? undefined : editing} collection={collection} store={store} onClose={() => setEditing(null)}/>}
  </div>;
}
