'use client';

import Link from 'next/link';
import AiMarkdown from '@/components/ui/AiMarkdown';
import EditorialSeoFacts from '@/components/content/EditorialSeoFacts';
import { useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, Download } from 'lucide-react';
import {productPath} from '@/lib/custom-products';
import { useApp } from '@/components/providers/AppProvider';
import { EmptyState } from '@/components/ui/Primitives';
import { resources } from '@/data/catalog';
import {carouselUrl} from '@/lib/carousel';
import {galleryPhotos} from '@/lib/gallery-photos';
import { useCatalogProducts, usePublications, type PublishedBlock, type PublishedContent } from '@/lib/publications';
import { ProductCard } from './ProductCard';
import { RequestForm } from './RequestForm';
import Carousel from './Carousel';
import CustomForm from './CustomForm';

const safeLink = (value?: string) => Boolean(value && carouselUrl(value));
const safeMedia = (value?: string) => safeLink(value) || Boolean(value && /^data:(image|video|audio)\//i.test(value));

function ContentTabs({ block }: { block: PublishedBlock }) {
  const { dir } = useApp();
  const rows = block.body.split('\n').filter(Boolean).map(row => row.split('|'));
  const [active, setActive] = useState(0);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'ArrowRight') next = (index + (dir === 'rtl' ? -1 : 1) + rows.length) % rows.length;
    else if (event.key === 'ArrowLeft') next = (index + (dir === 'rtl' ? 1 : -1) + rows.length) % rows.length;
    else return;
    event.preventDefault();
    setActive(next);
    document.getElementById(`${block.id}-tab-${next}`)?.focus();
  }
  return <section className="published-block">
    {block.title && <h2>{block.title}</h2>}
    <div className="product-tabs" role="tablist" aria-label={block.title}>
      {rows.map(([label], index) => <button key={index} type="button" id={`${block.id}-tab-${index}`} role="tab" aria-selected={active === index} aria-controls={`${block.id}-panel-${index}`} tabIndex={active === index ? 0 : -1} className={active === index ? 'active' : ''} onClick={() => setActive(index)} onKeyDown={event => navigate(event, index)}>{label}</button>)}
    </div>
    {rows.map(([, ...body], index) => <div key={index} id={`${block.id}-panel-${index}`} role="tabpanel" aria-labelledby={`${block.id}-tab-${index}`} hidden={active !== index} tabIndex={0}><p>{body.join(' | ')}</p></div>)}
  </section>;
}

/** Builder blocks use the same public controls as the original landing page. */
export function PublicationBlocks({ blocks }: { blocks: PublishedBlock[] }) {
  const { locale, t, href } = useApp();
  const products = useCatalogProducts(locale);
  const publications = usePublications();
  const news = publications.filter(item => item.kind === 'news' && item.locale === locale);
  return <div className="publication-blocks">{blocks.filter(block => !block.hidden).map(block => {
    const title = block.title ? <h2>{block.title}</h2> : null;
    const body = block.body ? ['rich-text','text'].includes(block.type)?<AiMarkdown text={block.body} locale={locale} content/>:<p className="published-prose">{block.body}</p> : null;
    const image = safeMedia(block.mediaUrl) ? <img src={block.mediaUrl} alt={block.title} loading="lazy"/> : null;
    const primary = safeLink(block.link) ? <a className="btn btn-primary" href={href(block.link)}>{block.options?.ctaLabel??t('learnMore')}<ArrowUpRight size={17}/></a> : null;
    const secondary = safeLink(block.options?.secondaryLink) ? <a className="btn" href={href(block.options!.secondaryLink)}>{block.options?.secondaryLabel??t('learnMore')}<ArrowUpRight size={17}/></a> : null;
    const link = <>{primary}{secondary}</>;
    const rows = block.body.split('\n').map(row => row.trim()).filter(Boolean);
    if (block.type === 'divider') return <hr className="published-divider" key={block.id}/>;
    if (block.type === 'tabs') return <ContentTabs key={block.id} block={block}/>;
    if (block.type === 'hero' || block.type === 'split') return <section key={block.id} className={`published-block published-split ${block.type === 'hero' ? 'published-hero glass' : ''}`}><div>{title}{body}{link}</div>{image}</section>;
    if (block.type === 'product-carousel' || block.type === 'product-grid') { const entries=block.options?.productIds!==undefined?block.options.productIds.flatMap(id=>{const product=products.find(p=>p.id===id);return product?[product]:[];}):products.slice(0,8); return <section className="published-block" key={block.id}>{title}{body}{!entries.length?<EmptyState title={t('noResults')}/>:block.type === 'product-carousel' ? <Carousel label={block.title || t('products')} items={entries.map(p=>({id:p.id,title:p.name[locale],subtitle:p.brand,image:p.image,description:p.description[locale],href:href(productPath(p)),sourceUrl:p.sourceUrl,actionLabel:t('details')}))}>{entries.map(product => <ProductCard key={product.id} product={product}/>)}</Carousel> : <div className="product-grid">{entries.map(product => <ProductCard key={product.id} product={product}/>)}</div>}</section>; }
    if (block.type === 'catalog-carousel') { const entries=resources.filter(resource => resource.type !== 'research'&&(block.options?.productIds===undefined||block.options.productIds.includes(resource.productId||''))).slice(0,8);return <section className="published-block" key={block.id}>{title}{body}{entries.length?<Carousel label={block.title || t('resources')} items={entries.map(r=>({id:r.id,title:r.title[locale],subtitle:r.format,image:r.url,href:href('resources/'+r.slug),sourceUrl:r.sourceUrl,actionLabel:t('preview')}))}>{entries.map(resource => <a className="glass published-resource" key={resource.id} href={resource.url} target="_blank" rel="noreferrer"><img src={resource.url} alt={resource.title[locale]} loading="lazy"/><div><span className="badge">{resource.format}</span><h3>{resource.title[locale]}</h3><span className="text-link">{t('download')}<Download size={16}/></span></div></a>)}</Carousel>:<EmptyState title={t('noResults')}/>}</section>; }
    if (block.type === 'news-carousel') return <section className="published-block" key={block.id}>{title}{body}{news.length ? <Carousel label={block.title || t('news')} items={news.map(item=>({id:item.id,title:item.title,subtitle:t('news'),description:item.summary,image:item.blocks.find(b=>!b.hidden&&b.type==='image'&&safeMedia(b.mediaUrl))?.mediaUrl,href:href('news/detail')+'?id='+encodeURIComponent(item.id),actionLabel:t('learnMore')}))}>{news.map(item => <Link key={item.id} className="glass published-news" href={href('news/detail') + '?id=' + encodeURIComponent(item.id)}><span className="badge">{t('news')}</span><h3>{item.title}</h3><p>{item.summary}</p><span className="text-link">{t('learnMore')}<ArrowUpRight size={16}/></span></Link>)}</Carousel> : <EmptyState title={t('contentNotPublished')}/>}</section>;
    if (block.type === 'image') return <figure className="published-block published-figure" key={block.id}>{image}{block.title && <figcaption>{block.title}</figcaption>}{body}</figure>;
    if (block.type === 'gallery') {
      const photos = galleryPhotos(block);
      return <section className="published-block" key={block.id}>{title}<div className="published-gallery">{photos.map((photo, index) => <figure key={index}><a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.caption} loading="lazy"/></a>{photo.caption && <figcaption>{photo.caption}</figcaption>}</figure>)}</div></section>;
    }
    if (block.type === 'video' || block.type === 'audio') return <section className="published-block" key={block.id}>{title}{safeMedia(block.mediaUrl) && (block.type === 'video' ? <video className="published-video" controls preload="metadata" src={block.mediaUrl}/> : <audio className="published-audio" controls preload="metadata" src={block.mediaUrl}/>)}{body}</section>;
    if (block.type === 'faq') return <section className="published-block faq-list" key={block.id}>{title}{rows.map((row, index) => {const [question, ...answer] = row.split('|');return <details key={index}><summary>{question}</summary><p>{answer.join(' | ')}</p></details>;})}</section>;
    if (block.type === 'specifications') return <section className="published-block" key={block.id}>{title}<div className="comparison-scroll"><table className="data-table"><tbody>{rows.map((row, index) => {const [label, ...value] = row.split('|');return <tr key={index}><th scope="row">{label}</th><td>{value.join(' | ') || '—'}</td></tr>;})}</tbody></table></div></section>;
    if (block.type === 'downloads') return <section className="published-block glass published-callout" key={block.id}>{title}{body}{safeLink(block.link || block.mediaUrl) && <a href={href(block.link || block.mediaUrl)} className="btn" target="_blank" rel="noreferrer"><Download size={17}/>{block.options?.ctaLabel??t('download')}</a>}{secondary}</section>;
    if (block.type === 'form') return <section className="published-block" key={block.id}>{title}{body}{block.formSchema ? <CustomForm key={`${block.formSchema.id}-${block.formSchema.version}`} schema={block.formSchema}/> : <RequestForm kind="contact" embedded/>}</section>;
    if (['features', 'statistics', 'certificates', 'team', 'testimonials', 'partners', 'timeline'].includes(block.type)) return <section className="published-block" key={block.id}>{title}<div className={`published-items ${block.type === 'timeline' ? 'published-timeline' : ''}`}>{rows.map((row, index) => {const [heading, ...description] = row.split('|');return <article className="glass" key={index}>{block.type === 'timeline' && <span className="eyebrow">{String(index + 1).padStart(2, '0')}</span>}<h3>{heading}</h3><p>{description.join(' | ')}</p></article>;})}</div>{link}</section>;
    return <section className={`published-block ${['cta', 'notice', 'contact', 'map'].includes(block.type) ? 'glass published-callout' : ''}`} key={block.id}>{title}{body}{link}</section>;
  })}</div>;
}

export function PublicationContent({ item }: { item: PublishedContent }) {
  const { locale, t } = useApp();
  return <article className="publication-preview glass"><header><span className="badge">{t('published')} · {locale.toUpperCase()}</span><h1>{item.title}</h1>{item.summary && <p>{item.summary}</p>}</header><EditorialSeoFacts seo={item.seo} locale={item.locale}/>{item.blocks.length ? <PublicationBlocks blocks={item.blocks}/> : <AiMarkdown text={item.body} locale={locale} content/>}</article>;
}
