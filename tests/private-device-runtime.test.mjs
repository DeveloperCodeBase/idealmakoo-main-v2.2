import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const {pickNajvaDevice}=await loadTs('src/lib/communication-device.ts');
const {isPublicCapabilityPath}=await loadTs('src/lib/private-capabilities.ts');
const {bindPwaInstallation,syncPwaInstallLocale}=await loadTs('src/lib/pwa-install.ts');

test('device handoff requires the exact popup, origin and per-attempt nonce and retains no token listener',async()=>{
  const prior=globalThis.window,listeners=new Set(),popup={closed:false,close(){this.closed=true;}};let opened='';
  globalThis.window={location:{origin:'https://factory.example'},open(url){opened=url;return popup;},addEventListener(type,handler){assert.equal(type,'message');listeners.add(handler);},removeEventListener(type,handler){listeners.delete(handler);}};
  const controller=new AbortController();
  try{
    let accepted=false;const pending=pickNajvaDevice('fa',controller.signal).then(value=>{accepted=true;return value;});
    assert.equal(new URL(opened,'https://factory.example').pathname,'/fa/communication-verification/device/');
    assert.equal(new URL(opened,'https://factory.example').search,'');
    const nonce=new URLSearchParams(new URL(opened,'https://factory.example').hash.slice(1)).get('nonce');
    const token='AB123456-AB12-CD34-EF56-ABCDEF123456';
    const valid={origin:'https://factory.example',source:popup,data:{type:'idealmakoo:push-device',nonce,token}};
    const emit=event=>{for(const handler of [...listeners])handler(event);};
    for(const event of [{...valid,origin:'https://other.example'},{...valid,source:{}},{...valid,data:{...valid.data,nonce:'wrong'}},{...valid,data:{...valid.data,token:'not-a-device'}}])emit(event);
    await Promise.resolve();assert.equal(accepted,false);assert.equal(popup.closed,false);
    emit(valid);assert.equal(await pending,token.toLowerCase());assert.equal(listeners.size,0);assert.equal(popup.closed,true);
  }finally{controller.abort();if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});

test('cancelled and blocked device selection fails explicitly and cleans up its pending popup',async()=>{
  const prior=globalThis.window,listeners=new Set(),popup={closed:false,close(){this.closed=true;}};let opens=0;
  globalThis.window={location:{origin:'https://factory.example'},open(){opens++;return null;},addEventListener(type,handler){listeners.add(handler);},removeEventListener(type,handler){listeners.delete(handler);}};
  try{
    const already=new AbortController();already.abort();await assert.rejects(pickNajvaDevice('en',already.signal),/DEVICE_CANCELLED/);assert.equal(opens,0);
    await assert.rejects(pickNajvaDevice('en'),/POPUP_BLOCKED/);assert.equal(listeners.size,0);
    globalThis.window.open=()=>popup;
    const signal=new AbortController(),pending=pickNajvaDevice('en',signal.signal);signal.abort();await assert.rejects(pending,/DEVICE_CANCELLED/);
    assert.equal(popup.closed,true);assert.equal(listeners.size,0);
  }finally{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});

const runtimeSource=ts.transpileModule(readFileSync(new URL('../src/components/providers/PwaRuntime.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function pwaRuntime(pathname,{registration,secure=true,lookup}={}){
  const exports={},registrations=[],cleanups=[];let timer,lookups=0;
  const navigator={serviceWorker:{async getRegistration(scope){assert.equal(scope,'/');lookups++;return lookup?lookup():registration;},async register(url,options){registrations.push({url,...options});}}};
  const media=Object.assign(new EventTarget(),{matches:false});
  const window=Object.assign(new EventTarget(),{isSecureContext:secure,navigator,matchMedia:()=>media,location:{origin:'https://factory.example',pathname},setTimeout(callback){timer=callback;return 1;},clearTimeout(){timer=undefined;}});
  const require=name=>name==='react'?{useEffect:callback=>{cleanups.push(callback());}}:name==='next/navigation'?{usePathname:()=>pathname}:name==='@/lib/private-capabilities'?{isPublicCapabilityPath}:name==='@/lib/pwa-install'?{bindPwaInstallation,syncPwaInstallLocale}:assert.fail('Unexpected dependency '+name);
  runInNewContext(runtimeSource,{exports,require,navigator,window,URL});exports.default();
  return{registrations,get lookups(){return lookups;},fire(){timer?.();},cleanup(){cleanups.reverse().forEach(cleanup=>cleanup?.());}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('PWA runtime performs no registration lookup on account, admin, auth or token-bearing capability pages',async()=>{
  for(const path of ['/en/account/','/fa/admin/crm/','/ar/auth/login/','/ru/saved-share/token/','/tr/feedback/token/','/fa/communication-preferences/token/','/en/communication-verification/device/','/en/communication-unsubscribe/token/']){
    const runtime=pwaRuntime(path);runtime.fire();await settle();assert.equal(runtime.lookups,0,path);assert.equal(runtime.registrations.length,0,path);
  }
});

test('PWA runtime preserves an existing Najva root worker including activation and installation transitions',async()=>{
  for(const state of ['active','waiting','installing']){
    const runtime=pwaRuntime('/en/products/',{registration:{[state]:{scriptURL:'https://factory.example/najva-messaging-sw.js'}}});
    runtime.fire();await settle();assert.equal(runtime.lookups,1);assert.equal(runtime.registrations.length,0,state);
  }
  const runtime=pwaRuntime('/en/products/');runtime.fire();await settle();
  assert.deepEqual(runtime.registrations,[{url:'/service-worker.js',type:'module',scope:'/'}]);
});

test('navigating away while the existing-worker lookup is pending cannot register a stale default worker',async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const runtime=pwaRuntime('/en/products/',{lookup:()=>waiting});runtime.fire();assert.equal(runtime.lookups,1);runtime.cleanup();release(undefined);await settle();
  assert.equal(runtime.registrations.length,0);
});
