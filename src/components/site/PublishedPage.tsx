'use client';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {FileText,ArrowUpRight} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {usePublications} from '@/lib/publications';
import {EmptyState} from '@/components/ui/Primitives';
import {PublicationContent} from './PublicationRenderer';
export default function PublishedPage(){
 const {locale,t,href,pathname}=useApp();
 const params=useSearchParams();
 const path=pathname.replace(/^\/(?:fa|en|tr|ar|ru)\/?/,'').replace(/\/$/,'');const id=params.get('id')||params.get('slug')||(!['page','published'].includes(path)?path:'');
 const items=usePublications().filter(item=>item.locale===locale);
 const item=items.find(item=>item.id===id||item.slug.replace(/^\/+|\/+$/g,'')===id);
 return <div className="container page-content">{item?<PublicationContent item={item}/>:<><div className="page-intro"><span className="eyebrow">{t('published')}</span><h1>{t('published')}</h1></div>{items.length?<div className="cooperation-grid">{items.map(item=><Link href={href('page')+'?id='+encodeURIComponent(item.id)} className="glass cooperation-card" key={item.id}><FileText size={30}/><h2>{item.title}</h2><p>{item.summary}</p><span className="text-link">{t('preview')}<ArrowUpRight size={16}/></span></Link>)}</div>:<EmptyState title={t('contentNotPublished')} action={t('workspace')} href={href('admin/pages')}/>}</>}</div>;
}
