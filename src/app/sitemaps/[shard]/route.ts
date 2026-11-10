import {getPublicSitemapData} from '@/server/sitemap-data';
import {splitSitemap,sitemapShardXml} from '@/server/sitemap-xml';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{shard:string}>}){
 const {shard}=await params;
 if(!/^(fa|en|tr|ar|ru)-(products|research|resources|news|events|careers|knowledge|glossary|pages)-[1-9][0-9]{0,7}\.xml$/.test(shard))return new Response('Not found',{status:404});
 const selected=splitSitemap(await getPublicSitemapData()).find(item=>item.name===shard);
 if(!selected)return new Response('Not found',{status:404});
 return new Response(sitemapShardXml(selected.entries),{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff'}});
}
