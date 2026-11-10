import { articles, companyPages, products } from '../data/catalog';
import { publicationPath } from './publication-path';
import type { ContentLocale } from '../data/catalog';
import {isPublicArticleVisible,isPublicPathVisible,type PublicVisibilitySnapshot} from './public-visibility';

export interface LegacyPageRedirect {
  sourceUrl: string;
  legacyId: string;
  legacyTitle: string;
  recordId: string;
  kind: 'product' | 'research' | 'page';
  fallbackPath: string;
}
export interface LegacyPublicSnapshot extends PublicVisibilitySnapshot {
  publications: readonly {id:string;kind:string;slug:string;locale:string;productRelease?:{productId:string}}[];
  hiddenProducts: readonly string[];
  hiddenProductLocales: Record<string,readonly string[]>;
}

/** Old source titles contain a literal percent sign; decode exactly one URL layer. */
function sourceSegment(value:string):string|null {
  try {
    const decoded=decodeURIComponent(value.replace(/%(?![0-9a-f]{2})/gi,'%25')).normalize('NFC');
    return /[\/\\\u0000-\u001f\u007f]/.test(decoded)?null:decoded;
  } catch { return null; }
}
function sourceRow(source:{id:string;sourceUrl:string},kind:LegacyPageRedirect['kind'],fallbackPath:string):LegacyPageRedirect {
  const url=new URL(source.sourceUrl),match=/^\/pages\/([1-9][0-9]{0,8})\/([^/]+)\/?$/.exec(url.pathname);
  const title=match&&sourceSegment(match[2]);
  if(url.origin!=='https://idealmakoo.com'||url.search||url.hash||!match||!title)throw new Error('Invalid official legacy source mapping');
  return {sourceUrl:source.sourceUrl,legacyId:match[1],legacyTitle:title,recordId:source.id,kind,fallbackPath};
}

/** The forty documented source identities, not a user-editable redirect destination. */
export const legacyPageRedirects:readonly LegacyPageRedirect[]=[
  ...products.map(item=>sourceRow(item,'product',`products/${item.slug}`)),
  ...articles.map(item=>sourceRow(item,'research',`research/${item.slug}`)),
  ...companyPages.map(item=>sourceRow(item,'page',item.slug)),
];
const rowsById=new Map(legacyPageRedirects.map(row=>[row.legacyId,row]));
if(rowsById.size!==legacyPageRedirects.length)throw new Error('Duplicate official legacy source identity');

function safePublicPath(path:string):boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]*){0,7}$/.test(path)&&! /^(?:api|admin|account|auth|pages|page|published|_next)(?:\/|$)/i.test(path);
}

/** Historical URLs have no locale. Persian is their explicit, stable destination. */
export function resolveLegacyRedirect(pathname:string,site:LegacyPublicSnapshot,locale:ContentLocale='fa'):string|null {
  if(!['fa','en','tr','ar','ru'].includes(locale))return null;
  const match=/^\/pages\/([1-9][0-9]{0,8})\/([^/]+)\/?$/.exec(pathname);
  if(!match)return null;
  const row=rowsById.get(match[1]);
  if(!row||sourceSegment(match[2])!==row.legacyTitle)return null;
  if(row.kind==='product'&&(site.hiddenProducts.includes(row.recordId)||site.hiddenProductLocales[row.recordId]?.includes(locale)))return null;
  if(row.kind==='research'&&!isPublicArticleVisible(site,locale,row.recordId)||!isPublicPathVisible(site,locale,row.fallbackPath))return null;
  const kinds=row.kind==='product'?['product','products']:row.kind==='research'?['research','article','articles']:['page'];
  const publication=site.publications.find(item=>item.locale===locale&&kinds.includes(item.kind)&&(item.id===row.recordId||row.kind==='product'&&item.productRelease?.productId===row.recordId));
  const target=publication?publicationPath(publication):row.fallbackPath;
  if(!safePublicPath(target)||!isPublicPathVisible(site,locale,target))return null;
  return `/${locale}/${target}/`;
}

/** no-store keeps an archived or withdrawn product from inheriting a cached live redirect. */
export function legacyRedirectResponse(pathname:string,site:LegacyPublicSnapshot):Response {
  const target=resolveLegacyRedirect(pathname,site);
  return target?new Response(null,{status:301,headers:{Location:target,'Cache-Control':'no-store'}}):new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'}});
}
