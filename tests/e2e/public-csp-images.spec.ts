import {test,expect} from '@playwright/test';

test('hydrated public pages and the hero rendering worker run under nonce CSP without eval violations',async({page})=>{
 test.setTimeout(120000);
 const errors:string[]=[],workers:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('worker',worker=>workers.push(worker.url()));
 await page.addInitScript(()=>{
  const browser=window as typeof window&{__cspViolations:{directive:string;blockedURI:string}[]};browser.__cspViolations=[];
  document.addEventListener('securitypolicyviolation',event=>browser.__cspViolations.push({directive:event.effectiveDirective,blockedURI:event.blockedURI}));
 });
 for(const route of ['/fa/','/en/products/','/ar/contact/','/ru/about/','/tr/auth/login/']){
  const response=await page.goto(route);expect(response?.status()).toBe(200);
  const policy=response!.headers()['content-security-policy'],scripts=policy.split(';').find(value=>value.trim().startsWith('script-src '));
  expect(scripts).toMatch(/'nonce-[^']+'/);expect(scripts).not.toContain("'unsafe-inline'");expect(scripts).not.toContain("'unsafe-eval'");
  await expect(page.locator('main h1').first()).toBeVisible();
  const theme=page.locator('.theme-language > button').first();
  if(await theme.count()){
   const before=await page.locator('html').getAttribute('data-theme');await theme.click();await expect(page.locator('html')).not.toHaveAttribute('data-theme',before||'dark');
   await theme.click();await expect(page.locator('html')).toHaveAttribute('data-theme',before||'dark');
  }else if(route.includes('/auth/'))await page.locator('input[name="email"]').fill('browser-validation@example.test');
  if(route==='/fa/'){
   await expect.poll(()=>workers.some(url=>url.includes('idealmakoo-hero')),{timeout:30000}).toBe(true);
   await expect(page.locator('[data-variant="hero"]')).toHaveAttribute('data-scene-state','ready',{timeout:45000});
  }
  expect(await page.evaluate(()=>(window as typeof window&{__cspViolations:unknown[]}).__cspViolations),route).toEqual([]);
 }
 expect(errors).toEqual([]);
});

test('image optimization permits known bundled files and rejects private, encoded and query-bearing paths',async({request})=>{
 const optimize=(url:string)=>'/_next/image?'+new URLSearchParams({url,w:'64',q:'75'});
 const valid=await request.get(optimize('/media/brand/logo-transparent.png'));expect(valid.status()).toBe(200);expect(valid.headers()['content-type']).toMatch(/^image\//);
 for(const url of [
  '/api/v1/media/00000000-0000-4000-8000-000000000000/content',
  '/media/brand/logo-transparent.png?private=true',
  '/media/official/../../api/v1/auth/session',
  '/media/official/%2e%2e/%2e%2e/api/v1/auth/session',
  '/media/official/..%2f..%2fapi%2fv1%2fauth%2fsession',
  '/media/official/%252e%252e%252f%252e%252e%252fapi%252fv1%252fauth%252fsession',
  '/media/brand/%6cogo-transparent.png',
  '/media/official/not-a-manifest-file.png',
  'https://example.invalid/private.png',
 ]){const denied=await request.get(optimize(url));expect(denied.status(),url).toBe(400);expect(denied.headers()['content-type']||'').not.toMatch(/^image\//);}
});

test('the server-rendered public page remains mounted through session and publication hydration',async({page})=>{
 test.setTimeout(60000);
 await page.addInitScript(()=>{
  const browser=window as typeof window&{__publicStartup:{sawHeading:boolean;lostHeading:boolean;sawPageFallback:boolean;serverSiteEvents:number;observations:{heading:boolean;fallback:boolean}[]}};
  const state:typeof browser.__publicStartup=browser.__publicStartup={sawHeading:false,lostHeading:false,sawPageFallback:false,serverSiteEvents:0,observations:[]};
  const sample=()=>{
   const main=document.querySelector('main#main-content');if(!main)return;
   const heading=!!main.querySelector('h1'),fallback=!!main.querySelector('.site-loading');
   if(state.sawHeading&&!heading)state.lostHeading=true;
   state.sawHeading ||= heading;state.sawPageFallback ||= fallback;
   const prior=state.observations.at(-1);if(!prior||prior.heading!==heading||prior.fallback!==fallback)state.observations.push({heading,fallback});
  };
  new MutationObserver(sample).observe(document,{subtree:true,childList:true});
  window.addEventListener('idealmakoo:server-site',()=>{state.serverSiteEvents++;sample();});
 });
 const session=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/auth/session'&&response.status()===200);
 const refreshedSite=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/site'&&response.status()===200);
 const response=await page.goto('/en/contact/');expect(response?.status()).toBe(200);
 await Promise.all([session,refreshedSite]);
 await expect(page.locator('main h1')).toHaveText('Talk to Ideal Makoo');
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{__publicStartup:{serverSiteEvents:number}}).__publicStartup.serverSiteEvents)).toBeGreaterThanOrEqual(2);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const state=await page.evaluate(()=>(window as typeof window&{__publicStartup:{sawHeading:boolean;lostHeading:boolean;sawPageFallback:boolean;serverSiteEvents:number;observations:unknown[]}}).__publicStartup);
 expect(state.sawHeading,state.observations.toString()).toBe(true);
 expect(state.lostHeading,JSON.stringify(state.observations)).toBe(false);
 expect(state.sawPageFallback,JSON.stringify(state.observations)).toBe(false);
 await expect(page.locator('main .site-loading')).toHaveCount(0);
});
