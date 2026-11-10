import {isLocale} from '../lib/i18n';
import {isPublicCapabilityPath} from '../lib/private-capabilities';
import {getServerPublicSite} from './public-site';
import {publicRouteKind} from './public-routing';
import {sessionFor} from './auth';
import {getResourcePage} from './resources';
import {HttpError} from './types';

/** Decide before entering a matched App Router page, whose asynchronous
 * notFound() otherwise emits an empty initial error shell in Next16.4.2.
 * This is an early error response, never an authorization grant: page and API
 * handlers still check their current state independently. No token-bearing
 * capability getter runs here, so a single-use proof is never consumed twice. */
export async function publicNotFoundPreflight(request:Request,decodedPath:string):Promise<boolean>{
  if(decodedPath==='/'||/^\/admin(?:\/|$)/.test(decodedPath))return false;
  const [locale,...segments]=decodedPath.split('/').filter(Boolean);
  if(!isLocale(locale))return true;
  if(isPublicCapabilityPath(decodedPath)){
    if(segments.join('/')==='communication-verification/device')return false;
    return segments.length!==2||!/^[a-f0-9]{64}$/.test(segments[1]);
  }
  const site=await getServerPublicSite();
  const kind=publicRouteKind(site,locale,segments);
  if(kind!=='managed-resource')return kind==='missing';
  // Apply the existing document access policy: an unauthorized private document
  // and an absent document must look alike. Session lookup can renew its heartbeat.
  try{
    const session=await sessionFor(request);
    const resource=await getResourcePage(session?.actor??null,segments[1],locale);
    return resource.visibility==='public'&&!resource.locales.includes(locale);
  }catch(error){
    if(error instanceof HttpError&&[400,401,403,404,409,410,422].includes(error.status))return true;
    throw error;
  }
}
