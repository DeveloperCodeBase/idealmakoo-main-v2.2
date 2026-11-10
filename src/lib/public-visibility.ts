import {articles,products,type ContentLocale} from '../data/catalog';

/** Public-only source identities. An absent map preserves untouched official sources. */
export interface PublicVisibilitySnapshot {
  hiddenProducts?:readonly string[];
  hiddenProductLocales?:Record<string,readonly string[]>;
  hiddenArticleLocales?:Record<string,readonly string[]>;
  hiddenPageLocales?:Record<string,readonly string[]>;
}
const blocked=(map:Record<string,readonly string[]>|undefined,key:string,locale:ContentLocale)=>Array.isArray(map?.[key])&&map[key].includes(locale);
export function isPublicArticleVisible(site:PublicVisibilitySnapshot|null|undefined,locale:ContentLocale,id:string):boolean {
  return !blocked(site?.hiddenArticleLocales,id,locale);
}
/** Paths are exact and unlocalized; withdrawing a landing page does not withdraw its children. */
export function isPublicPathVisible(site:PublicVisibilitySnapshot|null|undefined,locale:ContentLocale,path:string):boolean {
  const normalized=path==='home'?'':path.replace(/^\/+|\/+$/g,'');
  if(blocked(site?.hiddenPageLocales,normalized,locale))return false;
  const product=products.find(item=>`products/${item.slug}`===normalized);
  if(product&&(site?.hiddenProducts?.includes(product.id)||blocked(site?.hiddenProductLocales,product.id,locale)))return false;
  const article=articles.find(item=>`research/${item.slug}`===normalized);
  return !article||isPublicArticleVisible(site,locale,article.id);
}
