'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Bell,RefreshCw} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {apiClient,networkError} from '@/lib/api';
import {formatDate} from '@/lib/i18n';
import {accountText} from './account-copy';
import styles from './account.module.css';

interface Notification {id:string;title:string;body:string;href:string;readAt:string|null;createdAt:string}
export default function ProductionNotifications(){
 const app=useApp(),router=useRouter(),text=(key:string)=>accountText(app.locale,key,app.t);const [items,setItems]=useState<Notification[]>([]),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const reload=async()=>{const result=await apiClient.request<{items:Notification[]}>('/me/notifications');setItems(result.items);setReady(true);};
 useEffect(()=>{let active=true;const load=()=>void apiClient.request<{items:Notification[]}>('/me/notifications').then(result=>{if(active){setItems(result.items);setReady(true);setError('');}}).catch(reason=>{if(active){setError(networkError(reason,app.locale));setReady(true);}});load();window.addEventListener('focus',load);window.addEventListener('idealmakoo:requests',load);const timer=setInterval(load,60000);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load);window.removeEventListener('idealmakoo:requests',load);};},[app.session?.id]);
 const mark=async(ids:string[])=>{if(busy)return;setBusy(true);setError('');try{await Promise.all(ids.map(id=>apiClient.request(`/me/notifications/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({read:true})})));await reload();}catch(reason){setError(networkError(reason,app.locale));}finally{setBusy(false);}};
 const path=(raw:string)=>/^\/(?!\/)/.test(raw)&&!/[\\\u0000-\u001f]/.test(raw)?app.href(raw):app.href('account/notifications');
 return <section className={styles.panel} data-liquid-surface=""><div className={styles.panelTitle}><h2>{text('notifications')}</h2><div><button className={styles.textLink} disabled={busy} onClick={()=>void mark(items.filter(item=>!item.readAt).map(item=>item.id))}>{text('markAllRead')}</button><button className={styles.iconButton} aria-label={text('refresh')} onClick={()=>void reload().catch(reason=>setError(networkError(reason,app.locale)))}><RefreshCw size={17}/></button></div></div>{error&&<p className={styles.inlineError} role="alert">{error}</p>}{!ready?<p role="status">{text('loading')}</p>:items.length?<div className={styles.notificationList}>{items.map(item=><Link key={item.id} href={path(item.href)} data-unread={!item.readAt} onClick={event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();void (item.readAt?Promise.resolve():mark([item.id])).then(()=>router.push(path(item.href)));}}><span className={styles.notificationIcon}><Bell size={19}/></span><span><strong>{item.title}</strong><p>{item.body}</p><small>{formatDate(item.createdAt,app.locale)}</small></span><i>{text(item.readAt?'read':'unread')}</i></Link>)}</div>:<p>{text('noNotifications')}</p>}</section>;
}
