import {products,articles,companyPages,resources} from '../data/catalog';
import {referenceDocuments} from '../data/reference-documents';
import type {Locale} from '../lib/i18n';
import type {LocalPublication} from '../data/workspace-seed';
import {publicIndexablePaths} from '../lib/routes';
import {publicationPath} from '../lib/publication-path';
import {sourceRouteMetadata} from '../lib/source-route-metadata';
import {canonicalPublicPath,publicPathAvailable,publicPathIndexable,type PublicSite} from './public-routing';

export interface DiscoveryItem {id:string;title:string;summary:string;href:string;kind:string;category:string;tags:string[];locale:Locale;image?:string}
export interface DiscoveryDocument extends DiscoveryItem {searchTitle:string;searchText:string;searchTags:string;words:string[]}
export type DiscoverySnapshot=Pick<PublicSite,'publications'|'hiddenProducts'|'hiddenProductLocales'|'hiddenArticleLocales'|'hiddenPageLocales'|'preferences'>;
export interface ManagedDiscoveryDocument {id:string;slug:string;title:Record<Locale,string>;summary:Record<Locale,string>;type:string;locales:Locale[]}
export const discoveryKinds=['product','research','news','event','career','resource','knowledge','page'] as const;

/** Persian/Arabic glyphs, diacritics, numeral sets and joining controls normalize
 * identically for query and document. The original visible text stays intact. */
export function normalizeDiscoveryText(value:string):string {
 return value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en')
  .replace(/[يى]/g,'ی').replace(/ك/g,'ک')
  .replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632))
  .replace(/[\u200c\u200d\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,' ')
  .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
const visibleText=(text:string)=>text.replace(/<[^>]*>/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[`*_#>]+/g,' ').replace(/\s+/g,' ').trim();
const kindOf=(kind:string)=>({products:'product',article:'research',articles:'research',events:'event',hr:'career',careers:'career',resources:'resource',glossary:'knowledge'} as Record<string,string>)[kind]||((discoveryKinds as readonly string[]).includes(kind)?kind:'page');
const href=(locale:Locale,path:string)=>`/${locale}/${path}${path?'/':''}`;
function document(item:DiscoveryItem,body=''):DiscoveryDocument {
 const searchTitle=normalizeDiscoveryText(item.title),searchTags=normalizeDiscoveryText([item.category,...item.tags].join(' '));
 const searchText=normalizeDiscoveryText([item.title,item.summary,body.slice(0,100000),searchTags].join(' '));
 return{...item,summary:visibleText(item.summary).slice(0,500),searchTitle,searchTags,searchText,words:[...new Set(searchTitle.split(' ').filter(word=>word.length>=3))].slice(0,80)};
}

/** Build only from the current public projection. Draft workspace rows and
 * actor-specific resources are deliberately not accepted by this function. */
export function buildDiscoveryIndex(site:DiscoverySnapshot,locale:Locale,managed:readonly ManagedDiscoveryDocument[]=[]):DiscoveryDocument[] {
 const rows=new Map<string,DiscoveryDocument>();
 const add=(path:string,item:Omit<DiscoveryItem,'href'|'locale'>,body='')=>{
  if(!publicPathAvailable(site,locale,path)||!publicPathIndexable(site,locale,path))return;
  const canonical=canonicalPublicPath(site,locale,path);
  // A replaced source contributes no obsolete title, body, category or tags.
  if(canonical!==path)return;
  rows.set(path,document({...item,href:href(locale,path),locale},body));
 };
 for(const path of publicIndexablePaths){
  const copy=sourceRouteMetadata(path,locale);
  add(path,{id:'route:'+path,title:copy.title,summary:copy.description,kind:'page',category:path.split('/')[0]||'company',tags:[]});
 }
 for(const item of companyPages)add(item.slug,{id:item.id,title:item.title[locale],summary:item.excerpt[locale],kind:'page',category:'company',tags:[]},item.body.map(p=>p[locale]).join(' '));
 for(const item of products)add('products/'+item.slug,{id:item.id,title:item.name[locale],summary:item.description[locale],kind:'product',category:item.family,tags:[item.brand,item.material[locale]],image:item.image},[...item.features.map(p=>p[locale]),...item.specs.map(p=>p.label[locale]+' '+p.value[locale])].join(' '));
 for(const item of articles)add('research/'+item.slug,{id:item.id,title:item.title[locale],summary:item.excerpt[locale],kind:'research',category:item.topic,tags:[],image:item.image},locale==='fa'?item.body.join(' '):'');
 for(const item of resources)add('resources/'+item.slug,{id:item.id,title:item.title[locale],summary:item.format,kind:'resource',category:item.type,tags:[item.format]});
 for(const item of referenceDocuments){
  const path='resources/'+item.slug;
  // Reference documents are individually rendered by an existing catalogue route.
  if(!publicIndexablePaths.includes(path))continue;
  add(path,{id:item.id,title:item.title[locale],summary:item.summary[locale],kind:'resource',category:'reference',tags:[]});
 }
 for(const item of managed){if(item.locales.includes(locale))add('resources/'+item.slug,{id:item.id,title:item.title[locale],summary:item.summary[locale],kind:'resource',category:item.type,tags:[]});}
 for(const item of site.publications){
  if(item.locale!==locale)continue;
  const path=publicationPath(item),source=products.find(p=>p.id===(item.productRelease?.productId||item.id));
  const category=item.taxonomy?.category||item.customProduct?.family||source?.family||kindOf(item.kind);
  const tags=Array.isArray(item.taxonomy?.tags)?item.taxonomy.tags.filter(x=>typeof x==='string').slice(0,20):[];
  add(path,{id:item.id,title:item.title,summary:item.summary,kind:kindOf(item.kind),category,tags,image:item.customProduct?.image||source?.image},publicationSearchBody(item));
 }
 return [...rows.values()];
}
function publicationSearchBody(item:LocalPublication){
 return [item.body,...item.blocks.filter(block=>!block.hidden).flatMap(block=>[block.title,block.body])].join(' ');
}

function oneEditAway(a:string,b:string):boolean {
 if(Math.abs(a.length-b.length)>1)return false;
 let i=0,j=0,edits=0;
 while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}
 return edits+(i<a.length||j<b.length?1:0)<=1;
}
export function rankDiscoveryDocuments(documents:readonly DiscoveryDocument[],query:string):{item:DiscoveryDocument;score:number}[]{
 const phrase=normalizeDiscoveryText(query),terms=phrase.split(' ').filter(Boolean).slice(0,12),compact=phrase.replaceAll(' ','');
 return documents.flatMap(item=>{
  if(!terms.length)return[{item,score:item.kind==='page'?0:10}];
  let score=item.searchTitle===phrase?1000:item.searchTitle.startsWith(phrase)?450:item.searchTitle.includes(phrase)?300:0;
  if(!score&&compact&&item.searchTitle.replaceAll(' ','').includes(compact))score=200;
  for(const term of terms){
   if(item.searchTitle.includes(term)){score+=60;continue;}
   if(item.searchTags.includes(term)){score+=35;continue;}
   if(item.searchText.includes(term)){score+=8;continue;}
   if(term.length>=5&&item.words.some(word=>oneEditAway(term,word))){score+=2;continue;}
   if(compact&&item.searchText.replaceAll(' ','').includes(compact)){score+=4;continue;}
   return[];
  }
  return[{item,score}];
 }).sort((a,b)=>b.score-a.score||a.item.title.localeCompare(b.item.title)||a.item.href.localeCompare(b.item.href));
}
export function searchDiscoveryIndex(documents:readonly DiscoveryDocument[],options:{q:string;kind?:string;category?:string;limit:number;offset:number}){
 const matched=rankDiscoveryDocuments(documents,options.q),kinds=[...new Set(matched.map(row=>row.item.kind))].sort();
 const byKind=matched.filter(row=>!options.kind||row.item.kind===options.kind),categories=[...new Set(byKind.map(row=>row.item.category))].sort();
 const filtered=byKind.filter(row=>!options.category||normalizeDiscoveryText(row.item.category)===normalizeDiscoveryText(options.category));
 const items=filtered.slice(options.offset,options.offset+options.limit).map(({item:{searchText,searchTitle,searchTags,words,...item}})=>item);
 return{items,total:filtered.length,offset:options.offset,limit:options.limit,hasMore:options.offset+options.limit<filtered.length,kinds,categories};
}
