import {getServerPublicSite} from '@/server/public-site';
import {legacyRedirectResponse} from '@/lib/legacy-redirects';

export const runtime='nodejs';
export const dynamic='force-dynamic';

/** Static destination for historical URLs whose original title contains a
 * literal percent. Next prepares dynamic parameters from the original URL
 * even after an internal encoding rewrite, before its route handler runs. */
export async function GET(request:Request){
  const path=new URL(request.url).pathname;
  // Proxy replaces this header on every request. Requiring the original URL
  // as well keeps a direct /pages request from supplying a redirect identity.
  if(request.headers.get('x-idealmakoo-path')!==path||!path.startsWith('/pages/')||!/%(?![0-9a-f]{2})/i.test(path))
    return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'}});
  return legacyRedirectResponse(path,await getServerPublicSite());
}

export async function HEAD(request:Request){
  const response=await GET(request);
  return new Response(null,{status:response.status,headers:response.headers});
}
