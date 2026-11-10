import {getServerPublicSite,publicOrigin} from './public-site';
import {publicSitemapEntries,publicPathIndexable} from './public-routing';
import {publicResourceRoutes} from './resources';
import type {SitemapEntry} from './sitemap-xml';

export async function getPublicSitemapData():Promise<SitemapEntry[]>{
 const [site,resources]=await Promise.all([getServerPublicSite(),publicResourceRoutes()]),origin=publicOrigin();
 const entries=new Map<string,SitemapEntry>(publicSitemapEntries(site,origin).map(entry=>[entry.url,entry]));
 for(const resource of resources){
  const path='resources/'+resource.slug,languages=Object.fromEntries(resource.locales.filter(locale=>publicPathIndexable(site,locale,path)).map(locale=>[locale,`${origin}/${locale}/${path}/`]));
  if(languages.fa)languages['x-default']=languages.fa;
  for(const locale of resource.locales){const url=languages[locale];if(url&&!entries.has(url))entries.set(url,{url,lastModified:resource.updatedAt,alternates:{languages}});}
 }
 return [...entries.values()];
}
