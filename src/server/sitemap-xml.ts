export interface SitemapEntry {url:string;lastModified?:string;alternates:{languages:Record<string,string>}}
export interface SitemapShard {name:string;entries:SitemapEntry[];lastModified?:string}
export const sitemapShardSize=1000;
const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const lastmod=(value:string|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():undefined;
/** Stable per-language/type shards keep each document comfortably beneath the
 * protocol's 50,000 URL and 50 MB limits while exposing practical console groups. */
export function splitSitemap(entries:readonly SitemapEntry[]):SitemapShard[]{
 const groups=new Map<string,SitemapEntry[]>();
 for(const item of [...entries].sort((a,b)=>a.url.localeCompare(b.url,'en'))){
  const url=new URL(item.url),parts=url.pathname.split('/').filter(Boolean),locale=parts[0];
  if(!['fa','en','tr','ar','ru'].includes(locale)||!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Invalid public sitemap URL');
  const section=['products','research','resources','news','events','careers','knowledge','glossary'].includes(parts[1])?parts[1]:'pages';
  const key=locale+'-'+section;const group=groups.get(key)||[];group.push(item);groups.set(key,group);
 }
 const shards:SitemapShard[]=[];
 for(const [key,group]of [...groups].sort(([a],[b])=>a.localeCompare(b,'en')))for(let offset=0;offset<group.length;offset+=sitemapShardSize){
  const slice=group.slice(offset,offset+sitemapShardSize),dates=slice.map(item=>lastmod(item.lastModified)).filter((x):x is string=>!!x).sort();
  shards.push({name:key+'-'+(Math.floor(offset/sitemapShardSize)+1)+'.xml',entries:slice,...dates.length?{lastModified:dates.at(-1)}:{}});
 }
 if(shards.length>50000)throw new Error('Sitemap index exceeds protocol limit');
 return shards;
}
export function sitemapIndexXml(origin:string,shards:readonly SitemapShard[]):string{
 return '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+shards.map(shard=>`<sitemap><loc>${escape(origin+'/sitemaps/'+shard.name)}</loc>${shard.lastModified?'<lastmod>'+escape(shard.lastModified)+'</lastmod>':''}</sitemap>`).join('\n')+'\n</sitemapindex>\n';
}
export function sitemapShardXml(entries:readonly SitemapEntry[]):string{
 if(entries.length>sitemapShardSize)throw new Error('Sitemap shard is too large');
 const xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'+entries.map(item=>{
  const date=lastmod(item.lastModified);
  return '<url><loc>'+escape(item.url)+'</loc>'+(date?'<lastmod>'+escape(date)+'</lastmod>':'')+Object.entries(item.alternates.languages).map(([language,href])=>`<xhtml:link rel="alternate" hreflang="${escape(language)}" href="${escape(href)}" />`).join('')+'</url>';
 }).join('\n')+'\n</urlset>\n';
 if(Buffer.byteLength(xml,'utf8')>49*1024*1024)throw new Error('Sitemap exceeds byte limit');
 return xml;
}
