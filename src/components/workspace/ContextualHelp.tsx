'use client';
import Link from 'next/link';
import {ArrowUpRight} from 'lucide-react';
import {workspaceActions} from '@/lib/auth';
import type {WorkspaceStore} from './store';
import {localized,wt} from './i18n';
import {workspaceGuide,contextualHelpCopy as copy} from './contextual-help';
export default function ContextualHelp({store,section,route,links,onNavigate}:{store:WorkspaceStore;section:string;route:string;links:{key:string;path:string}[];onNavigate:()=>void}){
 const guide=workspaceGuide(section,store.role),actions=workspaceActions.filter(action=>store.permit(action,section)),related=links.filter(link=>link.key!==section&&guide.related.includes(link.key));
 return <div className="ws-help-body" data-contextual-help={section}><h3>{wt(section,store.locale)}</h3><a className="btn operations-manual-link" href={`/manuals/${store.role}.html`} target="_blank" rel="noreferrer">{store.locale==='fa'?'راهنمای تصویری کامل این نقش':store.locale==='ar'?'الدليل المصور لهذا الدور':store.locale==='tr'?'Rolün resimli kılavuzu':store.locale==='ru'?'Иллюстрированное руководство роли':'Illustrated role manual'}<ArrowUpRight size={16}/></a><p><code dir="ltr">/{store.locale}/admin{route?`/${route}`:''}/</code></p><ol>{guide.steps.map((step,index)=><li key={index}><p>{localized(step,store.locale)}</p></li>)}</ol><h4>{localized(copy.permissions,store.locale)}</h4>{actions.length?<p>{actions.map(action=>wt(action,store.locale)).join(' · ')}</p>:<p>{wt('denied',store.locale)}</p>}<p className="ws-muted">{localized(copy.limited,store.locale)}</p><p>{localized(copy.conflict,store.locale)}</p>{related.length>0&&<><h4>{localized(copy.related,store.locale)}</h4><div className="ws-toolbar">{related.map(link=><Link key={link.path} className="btn ws-small-btn" href={`/${store.locale}/admin/${link.path}/`} onClick={onNavigate}>{wt(link.key,store.locale)}<ArrowUpRight size={15}/></Link>)}</div></>}</div>;
}
