import type {Locale} from '../lib/i18n';
import {locales} from '../lib/i18n';
import type {LocalPublication} from '../data/workspace-seed';
import {products,articles,companyPages} from '../data/catalog';
import {publicIndexablePaths,sitePaths} from '../lib/routes';
import {publicationPath} from '../lib/publication-path';
import {publicationLocaleSibling} from '../lib/publication-locales';
import {isPublicPathVisible,type PublicVisibilitySnapshot} from '../lib/public-visibility';
import type {getPublicSite} from './workspace';
import type {PublicSeoSettings,PublicRouteSeo} from '../lib/site-editorial-settings';

export type PublicSite=Awaited<ReturnType<typeof getPublicSite>>;
type RoutingSnapshot=PublicVisibilitySnapshot&{publications:readonly LocalPublication[];preferences?:{seo?:PublicSeoSettings}};
const privatePath=/^(?:api|admin|account|auth|page|published|feedback|saved-share|communication-preferences|communication-verification|communication-unsubscribe)(?:\/|$)/;
export const indexablePath=(path:string)=>!privatePath.test(path)&&!path.endsWith('/detail')&&!/[?#\\\u0000-\u0020\u007f]/.test(path);

function sourceIdentity(path:string):{id:string;kinds:readonly string[]}|null{
  const product=products.find(row=>'products/'+row.slug===path);if(product)return{id:product.id,kinds:['product','products']};
  const article=articles.find(row=>'research/'+row.slug===path);if(article)return{id:article.id,kinds:['research','article','articles']};
  const page=companyPages.find(row=>row.slug===path);return page?{id:page.id,kinds:['page']}:null;
}
export function canonicalPublicPath(site:RoutingSnapshot,locale:Locale,path:string):string{
  const source=sourceIdentity(path);if(!source)return path;
  const current=site.publications.find(row=>row.locale===locale&&source.kinds.includes(row.kind)&&(row.id===source.id||source.kinds.includes('product')&&row.productRelease?.productId===source.id));
  return current?publicationPath(current):path;
}
function originalSourcePath(publication:LocalPublication|undefined):string|undefined{
  if(!publication)return undefined;
  if(['product','products'].includes(publication.kind)){
    const product=products.find(row=>row.id===publication.id||row.id===publication.productRelease?.productId);
    if(product)return 'products/'+product.slug;
  }
  if(['research','article','articles'].includes(publication.kind)){
    const article=articles.find(row=>row.id===publication.id);if(article)return 'research/'+article.slug;
  }
  if(publication.kind==='page')return companyPages.find(row=>row.id===publication.id)?.slug;
  return undefined;
}
export function publicPathAvailable(site:RoutingSnapshot,locale:Locale,path:string):boolean{
  const canonical=canonicalPublicPath(site,locale,path);
  const original=originalSourcePath(publicationAt(site,locale,canonical));
  return isPublicPathVisible(site,locale,path)&&isPublicPathVisible(site,locale,canonical)&&(original===undefined||isPublicPathVisible(site,locale,original));
}
export function publicationAt(site:RoutingSnapshot,locale:Locale,path:string){
  return site.publications.find(row=>row.locale===locale&&publicationPath(row)===path);
}
/** Keep early HTTP routing and the renderer on the same publication policy.
 * Managed documents need their own current authorization and review checks. */
export function publicRouteKind(site:RoutingSnapshot,locale:Locale,segments:readonly string[]):'page'|'managed-resource'|'missing'{
  const path=segments.join('/');
  if(!publicPathAvailable(site,locale,path))return 'missing';
  if(sitePaths.includes(path)||publicationAt(site,locale,path))return 'page';
  return segments.length===2&&segments[0]==='resources'?'managed-resource':'missing';
}
export function publicRouteSeo(site:RoutingSnapshot,locale:Locale,path:string):PublicRouteSeo|undefined{
 const canonical=canonicalPublicPath(site,locale,path),original=originalSourcePath(publicationAt(site,locale,canonical));
 return site.preferences?.seo?.[canonical]?.[locale]||site.preferences?.seo?.[path]?.[locale]||(original?site.preferences?.seo?.[original]?.[locale]:undefined);
}
export function publicPathIndexable(site:RoutingSnapshot,locale:Locale,path:string):boolean{
 const canonical=canonicalPublicPath(site,locale,path),original=originalSourcePath(publicationAt(site,locale,canonical));
 const excluded=[path,canonical,...original?[original]:[]].some(route=>site.preferences?.seo?.[route]?.[locale]?.noindex===true);
 return indexablePath(canonical)&&publicPathAvailable(site,locale,path)&&!excluded;
}
export function publicAlternates(site:RoutingSnapshot,locale:Locale,path:string):Record<string,string>{
  const publication=publicationAt(site,locale,path),source=sourceIdentity(path);
  const fallback=originalSourcePath(publication);
  const output:Record<string,string>={};
  for(const language of locales){
    const sibling=publication&&publicationLocaleSibling(site.publications,publication,language);
    let translated:string|undefined=sibling?publicationPath(sibling):undefined;
    if(translated===undefined){
      const staticPath=fallback??(source?path:publicIndexablePaths.includes(path)?path:undefined);
      if(staticPath!==undefined)translated=canonicalPublicPath(site,language,staticPath);
    }
    if(translated===undefined||!publicPathIndexable(site,language,translated))continue;
    output[language]=`/${language}/${translated}${translated?'/':''}`;
  }
  if(output.fa)output['x-default']=output.fa;
  return output;
}
export function publicSitemapEntries(site:RoutingSnapshot,origin:string){
  const entries=new Map<string,{url:string;lastModified?:string;alternates:{languages:Record<string,string>}}>();
  const add=(locale:Locale,path:string,publication?:LocalPublication)=>{
    if(!publicPathIndexable(site,locale,path))return;
    path=canonicalPublicPath(site,locale,path);
    const url=`${origin}/${locale}/${path}${path?'/':''}`;
    const languages=Object.fromEntries(Object.entries(publicAlternates(site,locale,path)).map(([lang,value])=>[lang,origin+value]));
    entries.set(url,{url,...publication?{lastModified:publication.publishedAt}:{},alternates:{languages}});
  };
  for(const locale of locales)for(const path of publicIndexablePaths)add(locale,path);
  for(const publication of site.publications)add(publication.locale,publicationPath(publication),publication);
  return [...entries.values()];
}
