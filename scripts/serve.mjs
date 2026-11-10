import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat,readFile,writeFile,mkdir } from 'node:fs/promises';
import {Readable} from 'node:stream';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Next.js export plus the same server-only AI gateway used by the hosted Worker.
const root = fileURLToPath(new URL('../out/', import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const workerPath=fileURLToPath(new URL('../dist/server/index.js',import.meta.url));
const worker=existsSync(workerPath)?(await import('data:text/javascript;base64,'+(await readFile(workerPath)).toString('base64'))).default:null;
const generatedRoot=fileURLToPath(new URL('../.sites-runtime/generated/',import.meta.url));
const bucket={
 async put(key,bytes,options){if(!/^generated\/[a-f0-9-]+\.(png|jpg|webp)$/.test(key))throw new Error('Invalid file key');await mkdir(generatedRoot,{recursive:true});const file=resolve(generatedRoot,key.slice(10));await writeFile(file,bytes);await writeFile(file+'.json',JSON.stringify(options));},
 async get(key){if(!/^generated\/[a-f0-9-]+\.(png|jpg|webp)$/.test(key))return null;const file=resolve(generatedRoot,key.slice(10));try{const metadata=JSON.parse(await readFile(file+'.json','utf8'));return {body:Readable.toWeb(createReadStream(file)),...metadata};}catch{return null;}}
};
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.gif': 'image/gif', '.avif': 'image/avif', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.zip': 'application/zip', '.hdr': 'application/octet-stream', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.wasm': 'application/wasm',
};

if (!existsSync(resolve(root, 'index.html'))) {
  console.error('No static export found. Run npm run build first.');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if((request.url||'').startsWith('/api/ai/')){
    if(!worker){response.writeHead(503,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{code:'NOT_CONFIGURED'}}));return;}
    const controller=new AbortController();request.on('aborted',()=>controller.abort());response.on('close',()=>{if(!response.writableEnded)controller.abort();});
    try{
      const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>6200000){response.writeHead(413);response.end('Request too large');return;}chunks.push(chunk);}
      const origin=`http://${request.headers.host||`${host}:${port}`}`;const headers=new Headers();for(const [key,value]of Object.entries(request.headers))if(value&&!key.startsWith('oai-authenticated-user-'))headers.set(key,Array.isArray(value)?value.join(','):value);
      headers.set('oai-authenticated-user-id','local-owner');
      const input=new Request(new URL(request.url,origin),{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:Buffer.concat(chunks),signal:controller.signal});
      const result=await worker.fetch(input,{GOOGLE_AI_API_KEY:process.env.GOOGLE_AI_API_KEY,GOOGLE_AI_TEXT_MODEL:process.env.GOOGLE_AI_TEXT_MODEL,GOOGLE_AI_IMAGE_MODEL:process.env.GOOGLE_AI_IMAGE_MODEL,BUCKET:bucket,ASSETS:{fetch:async req=>{
        const path=decodeURIComponent(new URL(req.url).pathname);const target=resolve(root,'.'+path);if(!target.startsWith(resolve(root)+sep)||!path.startsWith('/media/'))return new Response(null,{status:404});
        try{return new Response(await readFile(target),{headers:{'Content-Type':mime[extname(target)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
      }}});
      response.writeHead(result.status,Object.fromEntries(result.headers));if(!result.body||request.method==='HEAD')response.end();else Readable.fromWeb(result.body).on('error',()=>response.destroy()).pipe(response);
    }catch{if(!response.headersSent)response.writeHead(502,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{code:'PROVIDER_UNAVAILABLE'}}));}
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
    response.end('Method not allowed');
    return;
  }
  try {
    const path = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    if (path.includes('\0')) throw new Error('Invalid path');
    let target = resolve(root, '.' + path);
    if (target !== resolve(root) && !target.startsWith(resolve(root) + sep)) {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    let info = await stat(target).catch(() => null);
    if (info?.isDirectory()) { target = resolve(target, 'index.html'); info = await stat(target).catch(() => null); }
    if (!info?.isFile()) {
      response.writeHead(404, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(resolve(root, '404.html')).on('error', () => response.end('Not found')).pipe(response);
      return;
    }
    const privateRoute = /^\/(?:admin(?:\/|$)|api(?:\/|$)|(?:fa|en|tr|ar|ru)\/(?:admin|account|auth)(?:\/|$))/.test(path);
    const immutable = path.startsWith('/_next/static/');
    response.writeHead(200, {
      'Content-Type': mime[extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      ...(path === '/downloads/idealmakoo-source.zip' ? { 'Content-Disposition': 'attachment; filename="idealmakoo-source.zip"' } : {}),
      'Cache-Control': privateRoute ? 'no-store' : immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(path.startsWith('/media/official/') || path.startsWith('/fonts/') ? { 'X-Public-Cache': '1' } : {}),
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(target).on('error', () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(400, { 'Cache-Control': 'no-store' });
    response.end('Bad request');
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Ideal Makoo frontend: http://${host}:${port}/fa/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
