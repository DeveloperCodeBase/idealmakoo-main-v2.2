import {articles,company,companyPages,products} from '@/data/catalog';
import {companyPageCopy as copy} from '@/data/company-page-copy';
import {localized,translate,type Locale} from './i18n';
import type {PageBlock} from '@/data/workspace-seed';

const qualitySourceTitle=localized('مشخصات با منبع','Sourced specifications','Kaynaklı özellikler','مواصفات بمصدر','Характеристики с источником');
const qualityResearchBody=localized('مطالعات آرشیوی درباره سایش و اتصال؛ همراه با پیوند و تصویر مرجع.','Archive studies on wear and bonding, with source links and images.','Kaynak bağlantıları ve görsellerle aşınma ve bağlantı arşiv çalışmaları.','دراسات أرشيفية عن التآكل والارتباط مع روابط وصور المصدر.','Архивные исследования износа и соединения со ссылками и изображениями источников.');
const qualityResourceBody=localized('تصاویر اصلی معرفی محصول و اسناد پژوهش در یک مرکز دانلود.','Original product images and research documents in one download centre.','Ürün görselleri ve araştırma belgeleri tek indirme merkezinde.','صور المنتجات الأصلية ووثائق البحوث في مركز تنزيل واحد.','Оригинальные изображения продуктов и научные документы в одном центре загрузок.');

/** Stable section identities keep the authored source layout when a draft is
 * published. Every text value is taken from its own authored language. */
export function companySourceDraft(slug:string,locale:Locale):{title:string;summary:string;blocks:PageBlock[]}|null{
 const direct=companyPages.find(page=>page.slug===slug),c=(key:keyof typeof copy)=>copy[key][locale],t=(key:string)=>translate(locale,key),href=(path:string)=>`/${locale}/${path}/`;
 if(!direct&&!['manufacturing','quality','global','sustainability'].includes(slug))return null;
 const intros:Record<string,[string,string]>={about:[c('aboutTitle'),company.about[locale]],manufacturing:[c('manufacturingTitle'),c('manufacturingIntro')],quality:[c('qualityTitle'),c('qualityIntro')],global:[c('globalTitle'),c('globalIntro')],sustainability:[c('sustainabilityTitle'),c('sustainabilityBody')]};
 if(slug==='contact')return{title:t('contactUs'),summary:t('ctaText'),blocks:[{id:'contact-hero',type:'hero',title:t('contactUs'),body:t('ctaText'),hidden:false}]};
 const main=intros[slug];
 const [title,summary]=main||[direct!.title[locale],direct!.excerpt[locale]];
 const b=(name:string,type:string,title:string,body='',extra:Partial<PageBlock>={}):PageBlock=>({id:`${slug}-${name}`,type,title,body,hidden:false,...extra});
 const card=(page:typeof companyPages[number])=>[page.title[locale],page.excerpt[locale],href(page.slug),page.sourceUrl].join('|');
 const blocks=[b('hero','hero',title,summary),b('navigation','features',t('company'),['about','manufacturing','quality','global','sustainability'].map(path=>`${t(path)}|${href(path)}`).join('\n'))];
 if(slug==='about')blocks.push(
  b('lead','split',c('craft'),direct!.body.map(paragraph=>paragraph[locale]).join('\n\n'),{mediaUrl:'/media/official/1686482269.jpg',link:company.sourceUrl}),
  b('statistics','statistics','',[[company.foundedYear.toLocaleString(locale,{useGrouping:false}),c('founded')],[products.length.toLocaleString(locale),c('productCount')],[articles.length.toLocaleString(locale),c('researchCount')]].map(row=>row.join('|')).join('\n')),
  b('timeline','timeline',c('companyDocs'),[[Number(1360).toLocaleString(locale,{useGrouping:false}),c('beginnings'),c('beginningsBody')],[Number(1387).toLocaleString(locale,{useGrouping:false}),c('composite'),c('compositeBody')],[c('currentArchive'),c('portfolio'),c('portfolioBody')]].map(row=>row.join('|')).join('\n'),{link:company.sourceUrl}),
  b('principles','features',c('principles'),companyPages.filter(page=>['mission','development','segmentation'].includes(page.slug)).map(card).join('\n')),
 );
 else if(slug==='manufacturing')blocks.push(
  b('experience','split',c('experienceTitle'),c('experienceBody'),{link:href('products'),options:{visual:'scene',ctaLabel:t('browseProducts')}}),
  b('principles','features','',(['layer','mould','material'] as const).map(name=>`${c(`${name}Title`)}|${c(`${name}Body`)}`).join('\n'),{link:'https://idealmakoo.com/pages/3/products'}),
  b('visit','cta',c('visitTitle'),c('visitBody'),{link:href('cooperation'),options:{ctaLabel:t('cooperation'),secondaryLabel:t('resources'),secondaryLink:href('resources')}}),
 );
 else if(slug==='quality')blocks.push(
  b('principles','features','',[[qualitySourceTitle[locale],c('layerBody'),href('products'),t('products')],[t('research'),qualityResearchBody[locale],href('research'),t('research')],[t('resources'),qualityResourceBody[locale],href('resources'),t('resources')]].map(row=>row.join('|')).join('\n')),
  // Evidence and validity remain connected to the protected certificate
  // registry. Text in this block does not fabricate a certificate or status.
  b('certificates','certificates',t('quality')),
  b('feedback','cta',c('qualityFeedback'),c('qualityFeedbackBody'),{link:href('support'),options:{ctaLabel:t('support')}}),
 );
 else if(slug==='global')blocks.push(
  b('lead','split',c('craft'),c('globalNote'),{mediaUrl:company.heroImage,link:company.sourceUrl}),
  b('regions','features','',(['neighbours','europe','america'] as const).map(name=>`${c(name)}|${c(`${name}Body`)}`).join('\n'),{link:company.sourceUrl}),
  b('contact','cta','', '',{link:href('cooperation'),options:{ctaLabel:t('cooperation'),secondaryLabel:t('contact'),secondaryLink:href('contact')}}),
 );
 else if(slug==='sustainability')blocks.push(b('body','rich-text',c('sustainabilityTitle'),c('sustainabilityBody'),{link:href('contact'),options:{ctaLabel:t('contact')}}));
 else if(direct)blocks.push(b('body','rich-text',direct.title[locale],direct.body.map(paragraph=>paragraph[locale]).join('\n\n'),{link:direct.sourceUrl}),b('related','features',c('companyDocs'),companyPages.filter(page=>page.id!==direct.id&&page.slug!=='contact').slice(0,3).map(card).join('\n')));
 return{title,summary,blocks};
}

/** A line is an editable row. Pipes separate plain text cells; URLs are
 * validated again by the public renderer before they can become links. */
export function sourceBlockRows(body:string):string[][]{return body.split(/\r?\n/).filter(line=>line.trim()).map(line=>line.split('|').map(value=>value.trim()));}
