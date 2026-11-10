'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ArrowUpRight,X} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {usePublications,usePublicSiteSnapshot} from '@/lib/publications';
import {demoMode} from '@/lib/api';
import {refreshServerSite} from '@/lib/server-runtime';
import {isPublicNoticeActive,publicNoticeRevisionKey} from '@/lib/public-notices';
import {isPublicPathVisible} from '@/lib/public-visibility';
import {siteMenuHref} from '@/lib/site-preferences';

export default function PublicNoticeBanner(){
  const {locale,t}=useApp(),site=usePublicSiteSnapshot(),publications=usePublications();
  const [elapsed,setElapsed]=useState(0),[available,setAvailable]=useState(true),[dismissed,setDismissed]=useState<ReadonlySet<string>>(new Set());
  const observed=site?.observedAt?Date.parse(site.observedAt):null;
  useEffect(()=>{const start=Date.now();setElapsed(0);const timer=window.setInterval(()=>setElapsed(Date.now()-start),1000);return()=>clearInterval(timer);},[site?.observedAt]);
  useEffect(()=>{
    if(demoMode)return;
    let active=true;
    const refresh=async()=>{if(document.visibilityState==='hidden')return;try{await refreshServerSite();if(active)setAvailable(true);}catch{if(active)setAvailable(false);}};
    const timer=window.setInterval(()=>void refresh(),30_000);
    const focus=()=>void refresh();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[locale]);
  const notice=available?publications.filter(item=>item.locale===locale&&item.kind==='news'&&item.publicNotice&&isPublicNoticeActive(item.publicNotice,observed!==null&&Number.isFinite(observed)?observed+elapsed:Date.now())&&!dismissed.has(publicNoticeRevisionKey(item))).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||b.version-a.version||a.id.localeCompare(b.id))[0]:undefined;
  if(!notice?.publicNotice)return null;
  const action=notice.publicNotice,showAction=!!action.actionPath&&isPublicPathVisible(site,locale,action.actionPath);
  return <section className="announcement" aria-label={notice.title} lang={locale} dir={locale==='fa'||locale==='ar'?'rtl':'ltr'} data-public-notice={notice.id}>
    <span className="status-dot" aria-hidden="true"/><span><strong>{notice.title}</strong>{notice.summary&&<> — {notice.summary}</>}</span>
    {showAction&&<Link href={siteMenuHref(action.actionPath,locale)}>{action.actionLabel}<ArrowUpRight size={12} aria-hidden="true"/></Link>}
    <button type="button" aria-label={`${t('noticeDismiss')}: ${notice.title}`} onClick={()=>setDismissed(previous=>new Set([...previous,publicNoticeRevisionKey(notice)]))}><X size={13} aria-hidden="true"/></button>
  </section>;
}
