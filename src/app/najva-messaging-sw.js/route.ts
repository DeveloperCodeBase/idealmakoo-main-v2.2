import {configuredNajvaWorker} from '@/server/najva-worker';
import {workerContentSecurityPolicy} from '@/lib/security-headers';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(){
  const source=configuredNajvaWorker();
  return new Response(source?"importScripts('/service-worker-classic.js');\n"+source:'Not configured',{status:source?200:404,headers:{
    'Content-Type':source?'application/javascript; charset=utf-8':'text/plain; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Service-Worker-Allowed':'/',
    'Content-Security-Policy':workerContentSecurityPolicy(process.env,true),
  }});
}
