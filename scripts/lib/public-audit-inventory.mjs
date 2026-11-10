import {sitePaths} from '../../src/lib/routes.ts';
import {locales} from '../../src/lib/i18n.ts';
import {publicationPath} from '../../src/lib/publication-path.ts';
import {canonicalPublicPath,publicPathAvailable,publicPathIndexable} from '../../src/server/public-routing.ts';

const protectedPath=/^\/(?:fa|en|ar|tr|ru)\/(?:admin|account|api|feedback|saved-share|communication-preferences|communication-verification|communication-unsubscribe)(?:\/|$)|^\/api(?:\/|$)/;

/** Reject private and token-bearing paths before they enter shareable reports. */
export function publicAuditUrl(value,baseUrl){
 const parsed=new URL(value,baseUrl);
 if(parsed.origin!==baseUrl||parsed.username||parsed.password||parsed.hash||parsed.search)throw new Error('Audit URLs must be same-origin page URLs without tokens, queries, credentials or fragments.');
 if(protectedPath.test(decodeURIComponent(parsed.pathname)))throw new Error('Private dashboards, capability links and API routes require a separate authenticated verification workflow.');
 return parsed.href;
}

/** Build expectations from the same released snapshot as public routing.
 * Canonical destinations receive browser measurements once. Original aliases
 * receive independent HTTP redirect checks in the metadata audit instead of
 * being mistaken for duplicate page measurements. */
export function buildPublicAuditInventory({baseUrl,site,sitemapUrls,devices=['mobile']}){
 if(!site||!Array.isArray(site.publications)||!Array.isArray(site.forms))throw new Error('Invalid public site snapshot.');
 const entries=new Map(),redirects=new Map(),excluded=[];
 const urlFor=(locale,route)=>publicAuditUrl(`/${locale}/${route}${route?'/':''}`,baseUrl);
 const add=(url,kind,indexed=false,expectedStatus=200,extra={})=>{
  url=publicAuditUrl(url,baseUrl);
  const current=entries.get(url);
  entries.set(url,{url,kind:current?.kind||kind,indexed:current?.indexed||indexed,expectedStatus,...extra});
 };
 const addPublic=(locale,route)=>{
  const canonical=canonicalPublicPath(site,locale,route),url=urlFor(locale,route),destination=urlFor(locale,canonical);
  if(!publicPathAvailable(site,locale,route)){
   add(url,'expected-404',false,404);
   if(destination!==url)add(destination,'expected-404',false,404);
   return;
  }
  if(destination!==url){
   redirects.set(url,{url,kind:'public-redirect',indexed:false,expectedStatus:308,expectedLocation:destination});
   excluded.push({route,locale,url,canonical:destination,reason:'A released canonical alias is verified as an HTTP redirect; its destination is measured once.'});
  }
  add(destination,'public',false,200,{expectedNoindex:!publicPathIndexable(site,locale,canonical)});
 };
 for(const route of sitePaths){
  if(/^(?:api|admin|account)(?:\/|$)/.test(route)){excluded.push({route,reason:'Authenticated/permission-scoped surfaces require separate signed-in verification.'});continue;}
  if(/^(?:page|published)(?:\/|$)/.test(route)||route.endsWith('/detail')){excluded.push({route,reason:'Identifier or query-dependent placeholder; concrete released URLs are inventoried separately.'});continue;}
  for(const locale of locales){
   if(route.startsWith('auth/'))add(urlFor(locale,route),'public-auth',false);
   else addPublic(locale,route);
  }
 }
 // A released page intentionally marked noindex is absent from the sitemap,
 // but is still a real public document that must be audited.
 for(const publication of site.publications){
  if(!locales.includes(publication.locale))throw new Error('Invalid publication locale in public snapshot.');
  addPublic(publication.locale,publicationPath(publication));
 }
 // Do not sanitize an erroneous sitemap: a hidden URL or stale redirect listed
 // there must still fail its advertised indexable-200 expectation.
 for(const value of sitemapUrls){
  const url=publicAuditUrl(value,baseUrl),current=entries.get(url);
  entries.set(url,{...current,url,kind:'public',indexed:true,expectedStatus:200});
 }
 for(const locale of locales)add(urlFor(locale,'__lighthouse_missing_page__'),'expected-404',false,404);
 const jobs=[...entries.values()].sort((a,b)=>a.url.localeCompare(b.url,'en')).flatMap(entry=>devices.map(device=>({...entry,device})));
 return{jobs,excluded,redirects:[...redirects.values()].filter(entry=>!entries.has(entry.url)).sort((a,b)=>a.url.localeCompare(b.url,'en')),sourceUrls:entries.size};
}
