import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const {bindPwaInstallation,readPwaInstallState,subscribePwaInstall,requestPwaInstallation,initialPwaInstallState,syncPwaInstallLocale}=await loadTs('src/lib/pwa-install.ts');

test('a prompt offered before opening the guide is retained, consumed only once, and cleared after installation',async()=>{
 const media=Object.assign(new EventTarget(),{matches:false}),browser=Object.assign(new EventTarget(),{matchMedia:()=>media,navigator:{},location:{pathname:'/en/products/'}});
 const unbind=bindPwaInstallation(browser);let calls=0;
 const event=new Event('beforeinstallprompt',{cancelable:true});
 Object.assign(event,{prompt:async()=>{calls++;},userChoice:Promise.resolve({outcome:'dismissed'})});
 browser.dispatchEvent(event);
 assert.equal(event.defaultPrevented,true);assert.equal(readPwaInstallState().canInstall,true);
 syncPwaInstallLocale('en');assert.equal(readPwaInstallState().canInstall,true);
 // The guide subscribes after the offer occurred, as it does after navigation.
 let changes=0;const unsubscribe=subscribePwaInstall(()=>changes++);
 assert.equal(readPwaInstallState().canInstall,true);assert.equal(initialPwaInstallState().canInstall,false);
 assert.deepEqual(await requestPwaInstallation(),{outcome:'dismissed'});
 assert.equal(calls,1);assert.equal(await requestPwaInstallation(),null);assert.equal(readPwaInstallState().canInstall,false);
 const stale=new Event('beforeinstallprompt',{cancelable:true});Object.assign(stale,{prompt:async()=>{calls++;},userChoice:Promise.resolve({outcome:'accepted'})});browser.dispatchEvent(stale);
 syncPwaInstallLocale('fa');assert.equal(readPwaInstallState().canInstall,false);assert.equal(await requestPwaInstallation('fa'),null);assert.equal(calls,1);
 browser.location.pathname='/fa/install/';
 const next=new Event('beforeinstallprompt',{cancelable:true});Object.assign(next,{prompt:async()=>{calls++;},userChoice:Promise.resolve({outcome:'accepted'})});browser.dispatchEvent(next);
 assert.equal(readPwaInstallState().canInstall,true);browser.dispatchEvent(new Event('appinstalled'));
 assert.deepEqual(readPwaInstallState(),{canInstall:false,installed:true});assert.equal(await requestPwaInstallation(),null);assert.equal(calls,1);assert.ok(changes>=3);
 unsubscribe();unbind();
});
