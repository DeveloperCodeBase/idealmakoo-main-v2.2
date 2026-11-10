import {products,articles,companyPages} from '../data/catalog';
import {isLocale,type Locale} from './i18n';
import {localizedPath,localeFromPath} from './locale-routing';
import {publicationPath} from './publication-path';
import {isPublicPathVisible,type PublicVisibilitySnapshot} from './public-visibility';
import {publicIndexablePaths} from './routes';

export interface LocalePublication {id:string;kind:string;slug:string;locale:string;productRelease?:{productId:string}}
type Snapshot=PublicVisibilitySnapshot&{publications:readonly LocalePublication[]};
const kind=(value:string)=>({products:'product',articles:'research',article:'research',event:'events',resource:'resources'} as Record<string,string>)[value]||value;

/** Page translations have independent document IDs and share their stable
 * authored slug. Record translations retain their record ID. Neither path
 * substitutes source-language prose for a missing reviewed release. */
export function publicationLocaleSibling(publications:readonly LocalePublication[],source:LocalePublication,locale:Locale):LocalePublication|undefined {
  return publications.find(candidate=>candidate.locale===locale&&kind(candidate.kind)===kind(source.kind)&&(
    candidate.id===source.id||kind(source.kind)==='page'&&publicationPath(candidate)===publicationPath(source)
  ));
}

function sourcePath(publication:LocalePublication):string|undefined {
  if(kind(publication.kind)==='product'){
    const product=products.find(item=>item.id===publication.id||item.id===publication.productRelease?.productId);
    if(product)return 'products/'+product.slug;
  }
  if(kind(publication.kind)==='research'){
    const article=articles.find(item=>item.id===publication.id);if(article)return 'research/'+article.slug;
  }
  if(kind(publication.kind)==='page')return companyPages.find(item=>item.id===publication.id)?.slug;
  return undefined;
}

/** Resolve a language selection using reviewed public identities. Private
 * routes retain the existing URL formatter. null means this version has not
 * been released or has been withdrawn; callers keep the current page visible. */
export function publicLocaleDestination(site:Snapshot|undefined,locale:Locale,current:string):string|null {
  const sourceLocale=localeFromPath(current);
  if(!sourceLocale||!site)return localizedPath(locale,current);
  const boundary=current.search(/[?#]/),pathname=boundary<0?current:current.slice(0,boundary),suffix=boundary<0?'':current.slice(boundary);
  let path=pathname.replace(/^\/(?:fa|en|tr|ar|ru)(?:\/|$)/,'').replace(/\/+$/,'');
  try{path=decodeURIComponent(path);}catch{return null;}
  if(/^(?:admin|account|auth|page|published|feedback|saved-share|communication-preferences|communication-verification|communication-unsubscribe)(?:\/|$)/.test(path))return localizedPath(locale,current);
  const source=site.publications.find(item=>item.locale===sourceLocale&&publicationPath(item)===path);
  let translated:string|undefined;
  if(source){
    const sibling=publicationLocaleSibling(site.publications,source,locale);
    translated=sibling?publicationPath(sibling):sourcePath(source);
    if(translated===undefined&&publicIndexablePaths.includes(path))translated=path;
  }else translated=path;
  if(translated===undefined||!isPublicPathVisible(site,locale,translated))return null;
  // The untouched original product/article URL may itself have a reviewed
  // canonical rename in the target language.
  const product=products.find(item=>'products/'+item.slug===translated);
  const article=articles.find(item=>'research/'+item.slug===translated);
  const companyPage=companyPages.find(item=>item.slug===translated);
  const target=site.publications.find(item=>item.locale===locale&&(
    product&&kind(item.kind)==='product'&&(item.id===product.id||item.productRelease?.productId===product.id)||
    article&&kind(item.kind)==='research'&&item.id===article.id||
    companyPage&&kind(item.kind)==='page'&&item.id===companyPage.id
  ));
  if(target)translated=publicationPath(target);
  if(!isPublicPathVisible(site,locale,translated))return null;
  const original=target?sourcePath(target):source?sourcePath(source):undefined;
  if(original!==undefined&&!isPublicPathVisible(site,locale,original))return null;
  return `/${locale}/${translated}${translated?'/':''}${suffix}`;
}

/** Validate only the fields needed by URL navigation. Public snapshot parsing
 * remains authoritative for page content; malformed metadata cannot redirect. */
export function localePublications(value:unknown):LocalePublication[]{
  if(!Array.isArray(value))return [];
  return value.filter((item):item is LocalePublication=>!!item&&typeof item==='object'&&typeof item.id==='string'&&typeof item.kind==='string'&&typeof item.slug==='string'&&isLocale(item.locale)&&!/[?#\\\u0000-\u0020\u007f]/.test(item.slug)&&!/(?:^|\/)\.{1,2}(?:\/|$)|%(?:2e|2f|5c|00)/i.test(item.slug));
}
