'use client';

import Link from 'next/link';
import {useApp} from '@/components/providers/AppProvider';
import {usePublications} from '@/lib/publications';
import {policySourceBlocks} from '@/lib/site-source-drafts';
import {PublicationBlocks} from './PublicationRenderer';

import {carouselUrl} from '@/lib/carousel';
import AiMarkdown from '@/components/ui/AiMarkdown';

export default function ProductionPolicyPage({kind}:{kind:string}){
  const {locale,t,href}=useApp();const privacy=kind==='privacy';
  const slug=privacy?'privacy':'terms',all=usePublications();
  const published=all.find(item=>item.kind==='page'&&item.locale===locale&&item.slug===slug);
  const blocks=published?.blocks||policySourceBlocks(slug,locale);
  const header=blocks.find(block=>block.id===`${slug}-hero`);
  return <div className="container page-content"><div className="page-intro"><span className="eyebrow">IDEAL MAKOO</span>{header?.hidden!==true&&<h1>{published?.title||header?.title||t(slug)}</h1>}</div><article className="glass policy-content">{blocks.filter(block=>!block.hidden&&block.id!==`${slug}-hero`).map(block=>{
    if(block.id===`${slug}-contact`)return <section key={block.id}><h2>{block.title}</h2><p><Link className="text-link" href={href(carouselUrl(block.link)||'contact')}>{block.options?.ctaLabel||t('contact')}</Link> · <Link className="text-link" href={href(carouselUrl(block.options?.secondaryLink)||'account/security')}>{block.options?.secondaryLabel||t('security')}</Link></p></section>;
    if(block.type==='rich-text')return <section key={block.id}>{block.title&&<h2>{block.title}</h2>}{/([*#>]|\[[^\]]+\]\()/.test(block.body)?<AiMarkdown text={block.body} locale={locale} content/>:block.body.split(/\n\n+/).filter(Boolean).map((body,index)=><p key={index}>{body}</p>)}</section>;
    return <PublicationBlocks key={block.id} blocks={[block]}/>;
  })}</article></div>;
}
