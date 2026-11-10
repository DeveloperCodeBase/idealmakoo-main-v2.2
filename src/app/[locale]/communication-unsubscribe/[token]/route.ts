import {contactUnsubscribeResponse} from '@/server/contact-notifications';
import {assertPrivacyReady} from '@/server/privacy';
import {failure} from '@/server/http';
import {HttpError} from '@/server/types';
import {isLocale} from '@/lib/i18n';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{locale:string;token:string}>};
async function route(request:Request,{params}:Context){
  try{const{locale,token}=await params;if(!isLocale(locale))throw new HttpError(404,'NOT_FOUND','Not found.');await assertPrivacyReady();return await contactUnsubscribeResponse(request,token);}
  catch(error){const response=failure(error);response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');return response;}
}
export {route as GET,route as POST};
