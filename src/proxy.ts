import {NextRequest,NextResponse} from 'next/server';
import {randomBytes} from 'node:crypto';
import {contentSecurityPolicy,workerContentSecurityPolicy} from './lib/security-headers';
import {isPublicCapabilityPath} from './lib/private-capabilities';
import {isLocale} from './lib/i18n';
import {publicNotFoundPreflight} from './server/public-not-found-preflight';

/** Apply canonical URLs before rendering, preserving API and capability mutations. */
export async function proxy(request:NextRequest) {
  const path=request.nextUrl.pathname;
  let policyPath=path;
  try{policyPath=decodeURIComponent(path);}catch{/* The validation below rejects malformed encoding. */}
  const privatePage=isPublicCapabilityPath(path)||/^\/api\/v1\/(?:content-previews|wishlist-shares|communication-preferences|communication-unsubscribe|communication-verification|surveys\/forms|wishlists\/shared)(?:\/|$)/.test(path);
  const controlledDocumentPage=/^\/(?:fa|en|tr|ar|ru)\/resources\/[^/]+\/?$/.test(policyPath);
  const apiPath=/^\/api(?:\/|$)/.test(path);
  const najvaWorker=path==='/najva-messaging-sw.js';
  const staticWorker=['/service-worker.js','/service-worker-classic.js','/sw-policy.js'].includes(path);
  const documentPolicy=!apiPath&&!najvaWorker&&!staticWorker;
  // The public Najva bootstrap is present on regular documents.  Its network
  // access therefore needs the same allow-listed CSP origins as the device
  // enrolment page; `contentSecurityPolicy` validates those origins first.
  const pushDocument=documentPolicy;
  const nonce=documentPolicy?randomBytes(24).toString('base64'):undefined;
  const policy=documentPolicy?contentSecurityPolicy(process.env,pushDocument,nonce):staticWorker?workerContentSecurityPolicy():undefined;
  const security=(response:NextResponse)=>{
    // API handlers own their response policy: previews and private files require
    // a sandbox that a middleware response header must never replace.
    // The Najva worker handler supplies its own explicit importScripts policy.
    if(policy)response.headers.set('Content-Security-Policy',policy);
    response.headers.set('X-Content-Type-Options','nosniff');
    if(privatePage||controlledDocumentPage){
      response.headers.set('Cache-Control','private, no-store, max-age=0');
      response.headers.set('Referrer-Policy','no-referrer');
    }
    if(privatePage){
      response.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
    }
    return response;
  };
  if(path.startsWith('//')||/[\\\u0000-\u001f\u007f]/.test(path)||/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(path))
    return security(new NextResponse('Not found',{status:404}));
  // Recorded historical titles can contain a literal percent sign. Validate
  // that URL layer here; the static fallback below avoids Next's dynamic-route
  // preparation, which still attempts to decode the original request URL.
  const routedPath=path.startsWith('/pages/')?path.replace(/%(?![0-9a-f]{2})/gi,'%25'):path;
  let decodedPath:string;
  try{decodedPath=decodeURIComponent(routedPath);}catch{return security(new NextResponse('Not found',{status:404}));}
  const ordinaryPage=!/^\/(?:api|_next|pages)(?:\/|$)/.test(path)&&!/(?:^|\/)[^/]+\.[^/]+\/?$/.test(path);
  if(['GET','HEAD'].includes(request.method)&&ordinaryPage&&path!=='/'&&!path.endsWith('/')){
    const canonical=new URL(request.url);canonical.pathname=path+'/';
    return security(NextResponse.redirect(canonical,308));
  }
  const headers=new Headers(request.headers);
  // Always replace this header; client input cannot select a different layout.
  headers.set('x-idealmakoo-path',path);
  headers.delete('x-nonce');
  headers.delete('Content-Security-Policy');
  if(documentPolicy){
    // Next reads the request CSP to nonce its framework and hydration scripts.
    // The identical response CSP authorizes only this request's generated value.
    headers.set('x-nonce',nonce!);
    headers.set('Content-Security-Policy',policy!);
  }
  const localizedPage=isLocale(decodedPath.split('/')[1]);
  if(['GET','HEAD'].includes(request.method)&&(ordinaryPage||localizedPage)&&await publicNotFoundPreflight(request,decodedPath)){
    // Standard URL preserves the original authority with skipProxyUrlNormalize;
    // cloning NextURL can normalize loopback hosts and re-enter Proxy instead.
    const response=NextResponse.rewrite(new URL('/_not-found',request.url),{request:{headers}});
    response.headers.set('Cache-Control','private, no-store, max-age=0');
    response.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
    response.headers.set('Referrer-Policy','no-referrer');
    return security(response);
  }
  let response:NextResponse;
  if(routedPath!==path){const route=new URL(request.url);route.pathname='/pages';response=NextResponse.rewrite(route,{request:{headers}});}
  else response=NextResponse.next({request:{headers}});
  return security(response);
}

export const config={matcher:['/((?!_next/static|_next/image).*)']};
