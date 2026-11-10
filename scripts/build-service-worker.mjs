import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import {randomUUID} from 'node:crypto';

/** Reconstructed build adapter. Both worker formats use the retained policy verbatim. */
export function classicServiceWorkerSource(policy,worker){
  const dependency=/^import \{ PUBLIC_CACHE, OFFLINE_CACHE, OFFLINE_LOCALES, allowedAsset, cacheableResponse, offlinePage \} from '\.\/sw-policy\.js';\r?\n/;
  if(!dependency.test(worker))throw new Error('The service worker dependency changed; review the classic adapter.');
  const declarations=['export const PUBLIC_CACHE =','export const OFFLINE_CACHE =','export const OFFLINE_LOCALES =','export function offlinePage(','export function allowedAsset(','export function cacheableResponse('];
  for(const declaration of declarations)if(policy.split(declaration).length!==2)throw new Error('The cache policy exports changed; review the classic adapter.');
  const plainPolicy=policy.replace(/^export (?=const (?:PUBLIC_CACHE|OFFLINE_CACHE|OFFLINE_LOCALES) =|function (?:allowedAsset|cacheableResponse|offlinePage)\()/gm,'');
  const source='/* Generated from sw-policy.js and service-worker.js. Do not edit. */\n(()=>{\n\'use strict\';\n'+plainPolicy+'\n'+worker.replace(dependency,'')+'\n})();\n';
  new Script(source,{filename:'service-worker-classic.js'});
  return source;
}

export async function buildServiceWorker(root,{check=false}={}){
  const [policy,worker]=await Promise.all([readFile(resolve(root,'public/sw-policy.js'),'utf8'),readFile(resolve(root,'public/service-worker.js'),'utf8')]);
  const source=classicServiceWorkerSource(policy,worker),destination=resolve(root,'public/service-worker-classic.js');
  if(check){
    if(await readFile(destination,'utf8')!==source)throw new Error('The classic service worker is missing or stale. Run the prebuild script.');
    return {path:'public/service-worker-classic.js',bytes:Buffer.byteLength(source),checked:true};
  }
  const temporary=destination+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,source,{encoding:'utf8',mode:0o644,flag:'wx'});await rename(temporary,destination);}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {path:'public/service-worker-classic.js',bytes:Buffer.byteLength(source),checked:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).some(value=>value!=='--check'))throw new Error('Usage: node scripts/build-service-worker.mjs [--check]');
  const result=await buildServiceWorker(fileURLToPath(new URL('../',import.meta.url)),{check:process.argv.includes('--check')});
  process.stdout.write(JSON.stringify(result)+'\n');
}
