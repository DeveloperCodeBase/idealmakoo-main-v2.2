'use client';
import {parsePublishedPublicNotice,type PublishedPublicNotice} from '@/lib/public-notices';
import {parseEditorialSeo,type EditorialSeo} from '@/lib/editorial-seo';
import {useMemo,useSyncExternalStore} from 'react';
import {demoMode} from '@/lib/api';
import {parsePublishedGlossary,type PublishedGlossary} from '@/lib/glossary';
import {isPublicArticleVisible,isPublicPathVisible} from '@/lib/public-visibility';
import {useInitialServerSite} from '@/lib/public-site-context';
import {readServerSite,PUBLIC_SITE_EVENT,type PublicSiteSnapshot} from '@/lib/server-runtime';
import {articles,products,type Article,type ContentLocale,type Localized,type Product} from '@/data/catalog';
import {parseFormSchema,type PublicFormSchema} from '@/lib/form-schema';
import {parseProductRelease,type ProductRelease} from '@/lib/product-release';
import {productFromRelease} from '@/lib/product-release-catalog';
import {parseCustomProduct,type CustomProduct} from '@/lib/custom-products';
import type {PageBlockOptions} from '@/data/workspace-seed';
import { isCustomProductId } from '@/lib/custom-products';

export interface PublishedBlock {id:string;type:string;title:string;body:string;mediaUrl?:string;link?:string;formId?:string;formSchema?:PublicFormSchema;hidden?:boolean;options?:PageBlockOptions;}
export interface PublishedContent {taxonomy?:{category:string;tags:string[]};publicNotice?:PublishedPublicNotice;seo?:EditorialSeo;glossary?:PublishedGlossary;id:string;slug:string;kind:string;locale:ContentLocale;title:string;summary:string;body:string;blocks:PublishedBlock[];publishedAt:string;version:number;eventStart?:string;eventEnd?:string;location?:string;productRelease?:ProductRelease;customProduct?:CustomProduct;}
export type PublishedProduct=Product&{origin?:'editor';localPublication?:PublishedContent;sourceProduct?:Product;sourceName?:Localized;sourceDescription?:Localized};
export type PublishedArticle=Article&{localPublication?:PublishedContent;sourceTitle?:Localized;sourceExcerpt?:Localized};
const key='idealmakoo.publications.v1';
const empty:PublishedContent[]=[];
const validLocales:ContentLocale[]=['fa','en','tr','ar','ru'];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const string=(v:unknown,fallback='')=>typeof v==='string'?v:fallback;
const productKinds=['product','products'];
function productMatchesPublication(product:Product,publication:{id:string;slug:string;productRelease?:unknown}){const slug=publication.slug.replace(/^\/+|\/+$/g,'');const release=parseProductRelease(publication.productRelease,product);return publication.id===product.id||slug===product.slug||productKinds.some(kind=>slug===`${kind}/${product.slug}`)||!!release&&(slug===release.slug||productKinds.some(kind=>slug===`${kind}/${release.slug}`));}
/** Whitelist editable presentation fields; unknown products, arbitrary styles and scripts are omitted. */
export function parseBlockOptions(value:unknown):PageBlockOptions|undefined {
 if(!object(value))return undefined;
 const result:PageBlockOptions={};
 for(const key of ['ctaLabel','secondaryLabel'] as const)if(typeof value[key]==='string')result[key]=value[key].slice(0,180);
 if(typeof value.secondaryLink==='string'&&value.secondaryLink.length<=2000&&!/[\\\s\u0000-\u001f\u007f]/.test(value.secondaryLink)){
  if(/^\/(?!\/)/.test(value.secondaryLink))result.secondaryLink=value.secondaryLink;
  else if(/^https?:\/\//.test(value.secondaryLink)){try{const url=new URL(value.secondaryLink);if(url.hostname&&!url.username&&!url.password)result.secondaryLink=value.secondaryLink;}catch{/* Invalid URL stays absent. */}}
 }
 if(value.visual==='scene'||value.visual==='image')result.visual=value.visual;
 if(typeof value.tone==='string'&&['cyan','violet','neutral'].includes(value.tone))result.tone=value.tone as PageBlockOptions['tone'];
 if(Array.isArray(value.productIds))result.productIds=[...new Set(value.productIds.filter((id):id is string=>typeof id==='string'&&(products.some(product=>product.id===id)||isCustomProductId(id))))].slice(0,40);
 return Object.keys(result).length?result:undefined;
}
/** Parse only known publication fields. Corrupt local JSON cannot masquerade as product specifications. */
export function parsePublications(value:unknown):PublishedContent[]{
 if(!Array.isArray(value))return [];
 return value.filter(object).flatMap(p=>{
  if(typeof p.id!=='string'||typeof p.slug!=='string'||typeof p.kind!=='string'||!validLocales.includes(p.locale as ContentLocale)||typeof p.title!=='string')return [];
  const taxonomy=object(p.taxonomy)&&typeof p.taxonomy.category==='string'&&p.taxonomy.category.length<=120&&Array.isArray(p.taxonomy.tags)&&p.taxonomy.tags.length<=20&&p.taxonomy.tags.every(tag=>typeof tag==='string'&&tag.length<=80)?{category:p.taxonomy.category,tags:p.taxonomy.tags as string[]}:undefined;
  const publicNotice=p.publicNotice===undefined?undefined:parsePublishedPublicNotice(p.publicNotice);
  if(p.publicNotice!==undefined&&(!publicNotice||p.kind!=='news'))return [];
  const productKind=productKinds.includes(p.kind);
  const customCandidate=productKind?parseCustomProduct(p.customProduct):null;
  const releasedId=object(p.productRelease)&&typeof p.productRelease.productId==='string'?p.productRelease.productId:undefined;
  const original=productKind?(products.find(product=>product.id===releasedId)||customCandidate||products.find(product=>product.id===p.id)):undefined;
  const checkedRelease=original?parseProductRelease(p.productRelease,original)||undefined:undefined;
  const identity={id:p.id,slug:p.slug,productRelease:checkedRelease};
  const customProduct=customCandidate&&productMatchesPublication(customCandidate,identity)?customCandidate:undefined;
  const productRelease=original&&productMatchesPublication(original,identity)?checkedRelease:undefined;
  const blocks:PublishedBlock[]=Array.isArray(p.blocks)?p.blocks.filter(object).filter(b=>typeof b.type==='string').slice(0,250).map((b,index)=>({id:string(b.id,`block-${index}`),type:string(b.type),title:string(b.title),body:string(b.body),mediaUrl:typeof b.mediaUrl==='string'?b.mediaUrl:undefined,link:typeof b.link==='string'?b.link:undefined,formId:typeof b.formId==='string'?b.formId:undefined,formSchema:parseFormSchema(b.formSchema)||undefined,hidden:typeof b.hidden==='boolean'?b.hidden:undefined,options:parseBlockOptions(b.options)})):[];
  return [{taxonomy,publicNotice:publicNotice||undefined,id:p.id,slug:p.slug,kind:p.kind,locale:p.locale as ContentLocale,title:p.title,summary:string(p.summary),body:string(p.body),blocks,publishedAt:string(p.publishedAt),version:typeof p.version==='number'&&Number.isFinite(p.version)?Math.max(1,Math.floor(p.version)):1,eventStart:typeof p.eventStart==='string'?p.eventStart:undefined,eventEnd:typeof p.eventEnd==='string'?p.eventEnd:undefined,location:typeof p.location==='string'?p.location:undefined,productRelease,customProduct,glossary:parsePublishedGlossary(p.glossary,p.locale as ContentLocale)||undefined,seo:parseEditorialSeo(p.seo)||undefined}];
 });
}
let cachedServer:unknown;
let cachedText:string|null|undefined;
let cached:PublishedContent[]=empty;
function snapshot():PublishedContent[]{
 if(typeof window==='undefined')return empty;
 if(!demoMode){const server=readServerSite();if(server===cachedServer)return cached;cachedServer=server;cached=initialPublications(server);return cached;}
 try{const text=localStorage.getItem(key);if(text===cachedText)return cached;cachedText=text;cached=text?parsePublications(JSON.parse(text)):empty;return cached;}catch{cachedText=undefined;cached=empty;return empty;}
}
function subscribe(listener:()=>void){
 const changed=()=>listener();
 const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null)changed();};
 const store=(event:Event)=>{if((event as CustomEvent).detail?.key===key)changed();};
 window.addEventListener(PUBLIC_SITE_EVENT,changed);window.addEventListener('idealmakoo:publications',changed);window.addEventListener('storage',storage);window.addEventListener('idealmakoo:store',store);
 return()=>{window.removeEventListener(PUBLIC_SITE_EVENT,changed);window.removeEventListener('idealmakoo:publications',changed);window.removeEventListener('storage',storage);window.removeEventListener('idealmakoo:store',store);};
}
export function usePublicSiteSnapshot():PublicSiteSnapshot|null{const initial=useInitialServerSite();return useSyncExternalStore(subscribe,()=>readServerSite()||initial,()=>initial);}
// The SSR seed and the browser store must share the same parsed array for the
// same immutable snapshot. Reparsing during provider mount creates a synchronous
// external-store update before child hydration finishes. Fresh snapshots still
// parse independently even when the workspace version is unchanged (for example,
// when a public notice expires). The WeakMap does not retain old sites.
const initialPublicationCache = new WeakMap<PublicSiteSnapshot, PublishedContent[]>();
function initialPublications(initial: PublicSiteSnapshot | null): PublishedContent[] {
 if (!initial) return empty;
 const known = initialPublicationCache.get(initial); if (known) return known;
 const parsed = parsePublications(initial.publications); initialPublicationCache.set(initial, parsed); return parsed;
}
export function usePublications(){const initial=useInitialServerSite();const seeded=useMemo(()=>initialPublications(initial),[initial]);return useSyncExternalStore(subscribe,()=>!demoMode&&!readServerSite()?seeded:snapshot(),()=>seeded);}
function latestPublication(item:{id:string;slug:string},all:PublishedContent[],locale:ContentLocale,kinds:string[]){
 return all.filter(p=>p.locale===locale&&kinds.includes(p.kind)&&(p.id===item.id||p.slug.replace(/^\/+|\/+$/g,'')===item.slug||kinds.some(kind=>p.slug.replace(/^\/+|\/+$/g,'')===`${kind}/${item.slug}`)||(productKinds.includes(p.kind)&&p.productRelease?.productId===item.id))).sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)||b.version-a.version)[0];
}
/** Reviewed fields drive the visible product; its immutable original stays available as sourceProduct. */
export function applyPublishedProduct(product:Product,all:PublishedContent[],locale:ContentLocale):PublishedProduct{
 const prior=product as PublishedProduct;
 const base=products.find(p=>p.id===product.id)||parseCustomProduct(prior.sourceProduct)||parseCustomProduct(product)||product;
 const candidates=parseCustomProduct(base)?all.filter(item=>parseProductRelease(item.productRelease,base)):all;
 const publication=latestPublication(base,candidates,locale,['products','product']);
 if(!publication)return base;
 const visible=productFromRelease(base,publication.productRelease,locale);
 return {...visible,name:{...visible.name,[locale]:publication.title.trim()||visible.name[locale]},description:{...visible.description,[locale]:visible!==base?publication.summary:publication.summary.trim()||base.description[locale]},sourceProduct:base,sourceName:base.name,sourceDescription:base.description,localPublication:publication};
}
export function applyPublishedArticle(article:Article,all:PublishedContent[],locale:ContentLocale):PublishedArticle{
 const base=articles.find(a=>a.id===article.id)||article;
 const publication=latestPublication(base,all,locale,['research','article','articles']);
 return publication?{...base,title:{...base.title,[locale]:publication.title.trim()||base.title[locale]},excerpt:{...base.excerpt,[locale]:publication.summary.trim()||base.excerpt[locale]},sourceTitle:base.title,sourceExcerpt:base.excerpt,localPublication:publication}:base;
}
/** A new manual definition appears only with a valid reviewed release in the requested locale. */
export function hiddenProductsForLocale(site:PublicSiteSnapshot|null|undefined,locale:ContentLocale):string[]{
 const hidden=Array.isArray(site?.hiddenProducts)?site.hiddenProducts.filter(id=>typeof id==='string'):[];
 const localized=site?.hiddenProductLocales&&typeof site.hiddenProductLocales==='object'?Object.entries(site.hiddenProductLocales).filter(([,locales])=>Array.isArray(locales)&&locales.includes(locale)).map(([id])=>id):[];
 return [...new Set([...hidden,...localized])];
}
export function catalogFromPublications(all:PublishedContent[],locale:ContentLocale,hidden:readonly string[]=[]):PublishedProduct[]{
 const originals:Product[]=[...products];const added=new Map<string,CustomProduct>();
 for(const publication of all.filter(item=>item.locale===locale&&productKinds.includes(item.kind)).sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)||b.version-a.version)){
  const custom=parseCustomProduct(publication.customProduct);
  if(custom&&!added.has(custom.id)&&productMatchesPublication(custom,publication)&&parseProductRelease(publication.productRelease,custom))added.set(custom.id,custom);
 }
 originals.push(...added.values());return originals.filter(product=>!hidden.includes(product.id)).map(product=>applyPublishedProduct(product,all,locale));
}
export function getPublishedCatalog(locale:ContentLocale):PublishedProduct[]{return catalogFromPublications(snapshot(),locale,hiddenProductsForLocale(readServerSite(),locale));}
/** A missing translation offers an explicit language choice without changing
 * the current UI or admitting an unreviewed product to its catalogue. */
export function publishedProductLanguages(id:string,all:PublishedContent[],site:PublicSiteSnapshot|null=readServerSite()):{locale:ContentLocale;product:PublishedProduct}[]{
 return validLocales.flatMap(locale=>{const product=catalogFromPublications(all,locale,hiddenProductsForLocale(site,locale)).find(item=>item.id===id);return product?[{locale,product}]:[];});
}
/** Cross-locale validation keeps saved inquiries intact when the interface language changes. */
export function getPublishedProductInventory():PublishedProduct[]{
 const all=snapshot(),inventory=new Map<string,PublishedProduct>();
 for(const locale of validLocales)for(const product of catalogFromPublications(all,locale,hiddenProductsForLocale(readServerSite(),locale))){
  const previous=inventory.get(product.id),publication=product.localPublication,prior=previous?.localPublication;
  if(!previous||publication&&(!prior||(Date.parse(publication.publishedAt)||0)>(Date.parse(prior.publishedAt)||0)||publication.publishedAt===prior.publishedAt&&publication.version>prior.version))inventory.set(product.id,product);
 }
 return [...inventory.values()];
}
const catalogHookCache = new WeakMap<PublishedContent[], Map<string, PublishedProduct[]>>();
function sharedCatalog(all: PublishedContent[], locale: ContentLocale, site: PublicSiteSnapshot | null): PublishedProduct[] {
 const hidden = hiddenProductsForLocale(site, locale);
 const key = JSON.stringify([locale, [...hidden].sort()]);
 let cache = catalogHookCache.get(all); if (!cache) { cache = new Map(); catalogHookCache.set(all, cache); }
 const known = cache.get(key); if (known) return known;
 const catalog = catalogFromPublications(all, locale, hidden);
 // Bound variants within a long-lived publication snapshot when visibility changes.
 if (cache.size >= 20) cache.delete(cache.keys().next().value!);
 cache.set(key, catalog); return catalog;
}
export function useCatalogProducts(locale:ContentLocale):PublishedProduct[]{const all=usePublications();const initial=useInitialServerSite();const site=readServerSite()||initial;return useMemo(()=>sharedCatalog(all,locale,site),[all,locale,site]);}
export function usePublishedProduct(product:Product,locale:ContentLocale):PublishedProduct{const all=usePublications();return useMemo(()=>applyPublishedProduct(product,all,locale),[all,locale,product]);}
export function useCatalogArticles(locale:ContentLocale):PublishedArticle[]{const all=usePublications(),site=usePublicSiteSnapshot();return useMemo(()=>articles.filter(article=>isPublicArticleVisible(site,locale,article.id)&&isPublicPathVisible(site,locale,`research/${article.slug}`)).map(article=>applyPublishedArticle(article,all,locale)),[all,locale,site]);}
