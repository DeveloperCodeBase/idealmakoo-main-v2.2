"use client";
import {Fragment} from 'react';
import Link from 'next/link';
import {useSitePreferences} from '@/lib/site-preferences';
import CompanyCertificates from '@/components/company/CompanyCertificates';
import {ArrowUpRight,BookOpen,Building2,CheckCircle2,FileCheck2,FlaskConical,Globe2,Layers3,Leaf,MapPin,MessageSquare,Microscope,Move3D} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {company,companyPages,products} from '@/data/catalog';
import {usePublications,type PublishedBlock} from '@/lib/publications';
import {companySourceDraft,sourceBlockRows} from '@/lib/company-source-drafts';
import {carouselUrl} from '@/lib/carousel';
import RubikExperience from '@/components/experience/RubikExperience';
import AiMarkdown from '@/components/ui/AiMarkdown';
import {PublicationBlocks} from '@/components/site/PublicationRenderer';
import {OfficialSourceDisclosure,OfficialSourceArchiveLink} from './OfficialSourceArchive';
import {ReferenceDocumentCards} from './ReferenceDocuments';
import {ContentEmpty,ContentIntro,ImageFallback,SourceLink} from './shared';
import {companyPageCopy as labels} from '@/data/company-page-copy';

function Paragraphs({body,locale}:{body:string;locale:string}){
 // Unchanged source paragraphs keep their original DOM and spacing. Authored
 // rich text receives the existing sanitized, locale-aware renderer.
 if(/(^|\n)(?:#{1,6} |[-*] |\d+\. |> |```)|\*\*|\[[^\]]+\]\(/.test(body))return <AiMarkdown text={body} locale={locale} content/>;
 return <>{body.split(/\n\s*\n/).filter(Boolean).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</>;
}
export function CompanyContent({section}:{section:string}){
 const {locale,t,href,theme}=useApp(),preferences=useSitePreferences(),publications=usePublications();
 const key=section==='vision'?'goals':section==='history'?'about':section,direct=companyPages.find(page=>page.slug===key),isAbout=key==='about',c=(name:keyof typeof labels)=>labels[name][locale];
 const source=companySourceDraft(key,locale),published=publications.find(item=>item.kind==='page'&&item.locale===locale&&item.slug===key);
 if(!source)return <section className="container content-root"><ContentEmpty title={t('company')} body={company.about[locale]} path="about" label={t('about')} icon={<Building2 size={30}/>}/></section>;
 const blocks=(published?.blocks||source.blocks).filter(block=>!block.hidden);
 const render=(block:PublishedBlock)=>{
  const name=block.id.startsWith(key+'-')?block.id.slice(key.length+1):'',rawUrl=carouselUrl(block.link),rawSecondary=carouselUrl(block.options?.secondaryLink),url=rawUrl?href(rawUrl):undefined,secondary=rawSecondary?href(rawSecondary):undefined,image=carouselUrl(block.mediaUrl,true),rows=sourceBlockRows(block.body);
  const body=<Paragraphs body={block.body} locale={locale}/>;
  if(name==='hero')return <ContentIntro eyebrow={isAbout?c('craft'):t('company')} title={block.title} description={block.body}/>;
  if(name==='navigation')return <nav className="content-company-nav" aria-label={block.title||t('company')}>{rows.map(([title,path],index)=>{const target=carouselUrl(path);return target?<Link key={index} href={href(target)} aria-current={target===href(key)?'page':undefined}>{title}</Link>:null;})}</nav>;
  if(name==='lead')return <div className="content-company-lead"><div><span className="eyebrow">{isAbout?`IDEAL MAKOO · ${Number(1360).toLocaleString(locale,{useGrouping:false})}`:'MAKU FREE ZONE'}</span><h2>{block.title}</h2>{!isAbout&&<p>{preferences.contact.factoryAddress[locale]}</p>}{body}{url&&<SourceLink url={url}/>}</div><div className="glass content-company-visual"><ImageFallback src={image} loading={isAbout?"eager":"lazy"} fetchPriority={isAbout?"high":undefined} alt={isAbout?products.find(product=>product.id==='president')!.name[locale]:company.name[locale]}/><div className="content-visual-tag">{isAbout?<><span><MapPin size={14}/> {preferences.contact.factoryAddress[locale]}</span><span dir="ltr">PRESIDENT</span></>:<><span>{c('sourceBased')}</span><Globe2 size={19}/></>}</div></div></div>;
  if(name==='statistics')return <>{block.title&&<h2>{block.title}</h2>}<div className="content-stat-row">{rows.map(([value,label],index)=><div key={index}><strong>{value}</strong><span>{label}</span></div>)}</div></>;
  if(name==='timeline')return <><h2>{block.title}</h2><div className="content-timeline">{rows.map(([time,title,description],index)=><article key={index}><time>{time}</time><h3>{title}</h3><Paragraphs body={description||''} locale={locale}/></article>)}</div>{url&&<SourceLink url={url}/>}</>;
  if(name==='experience')return <div className="content-company-lead"><div><span className="eyebrow">{c('illustration')}</span><h2>{block.title}</h2>{body}{url&&<Link className="btn btn-primary" href={url}>{block.options?.ctaLabel||t('browseProducts')}<ArrowUpRight size={17}/></Link>}</div><div className="glass content-rubik">{block.options?.visual==='image'&&image?<ImageFallback src={image} alt={block.title}/>:<RubikExperience theme={theme} locale={locale}/>}</div></div>;
  if(name==='regions')return <>{block.title&&<h2>{block.title}</h2>}<div className="content-region-grid">{rows.map(([title,description],index)=><article key={index} className="glass content-region"><Globe2 size={31}/><h2>{title}</h2><Paragraphs body={description||''} locale={locale}/></article>)}</div>{url&&<SourceLink url={url}/>}</>;
  if(name==='principles'||name==='related'){
   const Heading=isAbout||name==='related'||Boolean(block.title)?'h3':'h2';
   const grid=<div className="content-principles">{rows.map(([title,description,path,reference],index)=>{const Icon=(key==='manufacturing'?[Layers3,Move3D,FlaskConical]:key==='quality'?[FileCheck2,Microscope,FileCheck2]:isAbout?[CheckCircle2,Microscope,Globe2]:[Building2])[index%3]||Building2,target=carouselUrl(path),sourceUrl=key==='quality'?undefined:carouselUrl(reference);return <article key={index} className="glass content-principle"><Icon size={key==='manufacturing'||key==='quality'?28:isAbout?27:24}/><Heading>{isAbout&&target?<Link href={href(target)}>{title}</Link>:title}</Heading><Paragraphs body={description||''} locale={locale}/>{target&&<div className="content-action-row">{isAbout?sourceUrl&&<SourceLink url={sourceUrl}/>:<Link className="content-read" href={href(target)}>{key==='quality'?reference||title:t('discover')}{key!=='quality'&&<span className="sr-only">: {title}</span>}<ArrowUpRight size={key==='quality'?16:15}/></Link>}</div>}</article>;})}</div>;
   return isAbout||name==='related'?<section className="content-related">{isAbout&&<span className="eyebrow">{c('sourceBased')}</span>}<h2>{block.title}</h2>{grid}</section>:<>{block.title&&<h2>{block.title}</h2>}{grid}{url&&<SourceLink url={url}/>}</>;
  }
  if(name==='certificates'&&key==='quality')return <CompanyCertificates/>;
  if(name==='contact'&&key==='global')return <>{block.title&&<h2>{block.title}</h2>}{body}<div className="content-action-row">{url&&<Link className="btn btn-primary" href={url}>{block.options?.ctaLabel||t('cooperation')}<ArrowUpRight size={17}/></Link>}{secondary&&<Link className="btn" href={secondary}>{block.options?.secondaryLabel||t('contact')}</Link>}</div></>;
  if(name==='visit'||name==='feedback')return <div className={name==='visit'?'content-company-document glass':'glass content-company-document'}>{name==='feedback'&&<MessageSquare size={27}/>}<h2>{block.title}</h2>{body}{name==='visit'?<div className="content-action-row">{url&&<Link className="btn btn-primary" href={url}>{block.options?.ctaLabel||t('cooperation')}<ArrowUpRight size={17}/></Link>}{secondary&&<Link className="btn" href={secondary}>{block.options?.secondaryLabel||t('resources')}<BookOpen size={17}/></Link>}</div>:url&&<Link className="btn" href={url}>{block.options?.ctaLabel||t('support')}<ArrowUpRight size={17}/></Link>}</div>;
  if(name==='body'&&key==='sustainability')return <ContentEmpty title={block.title} body={block.body} path={url} label={block.options?.ctaLabel||t('contact')} icon={<Leaf size={30}/>}/>;
  if(name==='body'&&direct)return <article className="glass content-article"><span className="eyebrow">{c('sourceBased')}</span><h2>{block.title}</h2>{body}{url&&<SourceLink url={url}/>}</article>;
  return <PublicationBlocks blocks={[block]}/>;
 };
 return <section className="container content-root" data-company-template={key}>{blocks.map(block=><Fragment key={block.id}>{render(block)}</Fragment>)}{direct&&<OfficialSourceDisclosure url={direct.sourceUrl}/>} {(isAbout||key==='manufacturing')&&<ReferenceDocumentCards compact/>}{isAbout&&<OfficialSourceArchiveLink/>}</section>;
}
export default CompanyContent;
