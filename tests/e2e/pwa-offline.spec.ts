import {test,expect} from '@playwright/test';

test.use({serviceWorkers:'allow'});

test('an installation offer survives navigation to the guide and is used only by its button',async({page})=>{
  const session=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/auth/session');
  await page.goto('/en/contact/');await session;
  await expect(page.locator('main h1')).toBeVisible();
  const prevented=await page.evaluate(()=>{
    const browser=window as typeof window&{__installCalls:number};browser.__installCalls=0;
    const offer=new Event('beforeinstallprompt',{cancelable:true});
    Object.assign(offer,{prompt:async()=>{browser.__installCalls++;},userChoice:Promise.resolve({outcome:'dismissed'})});
    window.dispatchEvent(offer);return offer.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await page.getByRole('contentinfo').getByRole('link',{name:'Install app',exact:true}).click();
  const install=page.getByRole('button',{name:'Install Ideal Makoo',exact:true});
  await expect(install).toBeVisible();await install.click();
  await expect(install).toHaveCount(0);
  expect(await page.evaluate(()=>(window as typeof window&{__installCalls:number}).__installCalls)).toBe(1);
});

test('production public assets cache and five localized offline pages work without caching account data',async({page,context,request})=>{
  test.setTimeout(90000);
  for(const asset of ['/fonts/EstedadVariable.woff2','/media/official/1686482269.jpg','/media/official/idealmakoo-favicon-48.png']){
    const response=await request.get(asset);expect(response.status(),asset).toBe(200);
    expect(response.headers()['x-public-cache'],asset).toBe('1');
  }
  const session=await request.get('/api/v1/auth/session');expect(session.headers()['x-public-cache']).toBeUndefined();
  // Seed an old cache in a fresh, script-free context; this is not an old-worker update test.
  await page.goto('/offline/en.html');
  await expect(page.locator('script')).toHaveCount(0);
  expect(await page.evaluate(async()=>!!await navigator.serviceWorker.getRegistration('/'))).toBe(false);
  await page.evaluate(async()=>{
    await(await caches.open('idealmakoo-offline-pages-v1')).put('/offline/en.html',new Response('stale offline fixture',{headers:{'Content-Type':'text/html'}}));
    await caches.open('pwa-test-unrelated');
    await(await caches.open('idealmakoo-public-assets-v1')).put('/fonts/pwa-test-retention.woff2',new Response('public cache retention fixture'));
  });
  expect(await page.evaluate(()=>caches.keys())).toEqual(expect.arrayContaining(['idealmakoo-offline-pages-v1','idealmakoo-public-assets-v1','pwa-test-unrelated']));
  await page.goto('/en/install/');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(()=>page.evaluate(async()=>(await caches.keys()).includes('idealmakoo-offline-pages-v1'))).toBe(false);
  expect(await page.evaluate(()=>caches.keys())).toEqual(expect.arrayContaining(['idealmakoo-offline-pages-v2','idealmakoo-public-assets-v1','pwa-test-unrelated']));
  expect(await page.evaluate(async()=>(await(await caches.open('idealmakoo-public-assets-v1')).match('/fonts/pwa-test-retention.woff2'))?.text())).toBe('public cache retention fixture');
  await page.evaluate(async()=>{
    await(await caches.open('idealmakoo-public-assets-v1')).delete('/fonts/pwa-test-retention.woff2');
    await caches.delete('pwa-test-unrelated');
  });
  await expect.poll(()=>page.evaluate(async()=>{
    const cache=await caches.open('idealmakoo-offline-pages-v2');return(await cache.keys()).length;
  })).toBe(5);
  await page.evaluate(async()=>{const response=await fetch('/fonts/EstedadVariable.woff2');await response.arrayBuffer();});
  await expect.poll(()=>page.evaluate(async()=>!!await caches.match('/fonts/EstedadVariable.woff2',{cacheName:'idealmakoo-public-assets-v1'}))).toBe(true);
  await expect.poll(()=>page.evaluate(async()=>!!await caches.match('/media/official/idealmakoo-favicon-48.png',{cacheName:'idealmakoo-public-assets-v1'}))).toBe(true);
  await context.setOffline(true);
  for(const locale of ['fa','en','tr','ar','ru']){
    const response=await page.goto(`/${locale}/about/`);
    expect(response?.fromServiceWorker(),locale).toBe(true);expect(response?.status(),locale).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang',locale);
    await expect(page.locator('html')).toHaveAttribute('dir',['fa','ar'].includes(locale)?'rtl':'ltr');
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('script')).toHaveCount(0);
  }
  expect(await page.evaluate(async()=>{const response=await fetch('/fonts/EstedadVariable.woff2');return response.ok;})).toBe(true);
  const offlineIcon=await page.evaluate(async()=>{
    const response=await fetch('/media/official/idealmakoo-favicon-48.png');
    return{status:response.status,type:response.headers.get('Content-Type')?.split(';')[0],signature:Array.from(new Uint8Array(await response.arrayBuffer()).slice(0,8))};
  });
  expect(offlineIcon).toEqual({status:200,type:'image/png',signature:[137,80,78,71,13,10,26,10]});
  const cached=await page.evaluate(async()=>{
    const paths:string[]=[];for(const key of await caches.keys())for(const request of await(await caches.open(key)).keys())paths.push(new URL(request.url).pathname);return paths;
  });
  expect(cached.length).toBeGreaterThanOrEqual(7);
  expect(cached.every(path=>/^\/(?:offline|fonts|media\/official)\//.test(path)),cached.join('\n')).toBe(true);
  await expect(page.goto('/en/account/')).rejects.toThrow();
  await context.setOffline(false);
});
