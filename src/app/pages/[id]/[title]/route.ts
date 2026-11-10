import {getServerPublicSite} from '@/server/public-site';
import {legacyRedirectResponse} from '@/lib/legacy-redirects';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  return legacyRedirectResponse(new URL(request.url).pathname,await getServerPublicSite());
}
export async function HEAD(request:Request){
  const response=await GET(request);
  return new Response(null,{status:response.status,headers:response.headers});
}
