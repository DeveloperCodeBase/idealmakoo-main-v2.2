import {getPublicSitemapData} from '@/server/sitemap-data';
import {splitSitemap,sitemapIndexXml} from '@/server/sitemap-xml';
import {publicOrigin} from '@/server/public-site';
export const dynamic='force-dynamic';
export async function GET(){
 return new Response(sitemapIndexXml(publicOrigin(),splitSitemap(await getPublicSitemapData())),{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff'}});
}
