import {test,expect} from '@playwright/test';
import {legacyPageRedirects} from '../../src/lib/legacy-redirects';

// The default matches Playwright's automatically started Next server. When
// testing through the production proxy, explicitly declare the Caddy boundary.
const httpEntrypoint=process.env.PLAYWRIGHT_HTTP_ENTRYPOINT||'next';
if(!['caddy','next'].includes(httpEntrypoint))throw new Error('PLAYWRIGHT_HTTP_ENTRYPOINT must be caddy or next');
const sourceRequestPath=(url:string)=>new URL(url).pathname.replace(/%(?![0-9a-f]{2})/gi,'%25');

// These assertions use the built HTTP server, so framework redirects and
// response-header precedence are exercised in addition to handler unit tests.
test('all forty recorded source addresses with valid percent encoding return an initial 301 without a trailing-slash detour',async({request})=>{
  test.setTimeout(120000);expect(legacyPageRedirects).toHaveLength(40);
  for(const source of legacyPageRedirects){
    // RFC 3986 section 2.4: a literal percent in the recorded title is %25
    // on the wire. The immutable original reference remains unchanged.
    const response=await request.get(sourceRequestPath(source.sourceUrl),{maxRedirects:0});
    expect(response.status(),source.sourceUrl).toBe(301);
    expect(response.headers().location).toBe('/fa/'+source.fallbackPath+'/');
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  const source=legacyPageRedirects[0],path=sourceRequestPath(source.sourceUrl);
  const head=await request.head(path,{maxRedirects:0});expect(head.status()).toBe(301);expect(await head.body()).toHaveLength(0);
  const query=await request.get(path+'?next=https%3A%2F%2Foutside.example.invalid%2F',{maxRedirects:0});expect(query.status()).toBe(301);expect(query.headers().location).toBe('/fa/'+source.fallbackPath+'/');
  for(const forged of ['/pages/99999999/not-recorded','/pages/'+source.legacyId+'/not-the-recorded-title'])expect((await request.get(forged,{maxRedirects:0})).status()).toBe(404);
});

test('raw percent, malformed escapes and double encoding obey the declared HTTP entrypoint',async({request},testInfo)=>{
  testInfo.annotations.push({type:'http-entrypoint',description:httpEntrypoint});
  const source=legacyPageRedirects.find(row=>/%(?![0-9a-f]{2})/i.test(new URL(row.sourceUrl).pathname));
  if(!source)throw new Error('The recorded source fixture must include its literal percent title');
  const raw=new URL(source.sourceUrl).pathname;
  const cases=[
    {kind:'raw percent',path:raw,status:httpEntrypoint==='caddy'?400:301},
    {kind:'malformed escape',path:raw.replace(/%(?![0-9a-f]{2})/gi,'%GG'),status:httpEntrypoint==='caddy'?400:404},
    {kind:'double encoding',path:raw.replace(/%(?![0-9a-f]{2})/gi,'%2525'),status:404},
  ];
  for(const scenario of cases){
    const response=await request.get(scenario.path,{maxRedirects:0});
    expect(response.status(),`${httpEntrypoint}: ${scenario.kind}`).toBe(scenario.status);
    expect(response.headers()['set-cookie']).toBeUndefined();
    if(scenario.status===301){
      expect(response.headers().location).toBe('/fa/'+source.fallbackPath+'/');
      expect(response.headers()['cache-control']).toContain('no-store');
    }else{
      expect(response.headers().location).toBeUndefined();
      if(scenario.status===400){
        // Go rejects malformed request-target escapes before Caddy handlers,
        // including the proxy and application response policy, can run.
        expect(response.headers()['content-security-policy']).toBeUndefined();
      }else expect(response.headers()['cache-control']).toContain('no-store');
    }
  }
  const head=await request.head(raw,{maxRedirects:0});
  expect(head.status()).toBe(httpEntrypoint==='caddy'?400:301);expect(await head.body()).toHaveLength(0);
  for(const path of ['/pages','/pages/']){
    const direct=await request.get(path,{headers:{'x-idealmakoo-path':raw},maxRedirects:0});
    expect(direct.status()).toBe(404);expect(direct.headers().location).toBeUndefined();
    expect(direct.headers()['cache-control']).toContain('no-store');
    expect(direct.headers()['set-cookie']).toBeUndefined();
  }
});

test('ordinary page canonicalization keeps API and capability POST requests free of redirects',async({request})=>{
  const page=await request.get('/en/products?view=list',{maxRedirects:0});expect(page.status()).toBe(308);expect(new URL(page.headers().location,page.url()).href).toBe(new URL('/en/products/?view=list',page.url()).href);
  expect((await request.get('/en/products/',{maxRedirects:0})).status()).toBe(200);
  expect((await request.get('/api/v1/health/ready',{maxRedirects:0})).status()).toBe(200);
  // Capability POSTs require their own signed CSRF proof before token lookup.
  // A forged link has no proof, so it must fail closed without a redirect or cookie.
  const token='0'.repeat(64),survey=await request.post('/api/v1/surveys/forms/'+token,{data:{},headers:{Origin:new URL(page.url()).origin},maxRedirects:0});
  expect(survey.status()).toBe(403);expect((await survey.json()).code).toBe('CSRF');expect(survey.headers().location).toBeUndefined();expect(survey.headers()['set-cookie']).toBeUndefined();
  const missing=await request.get('/api/v1/surveys/forms/'+token,{maxRedirects:0});expect(missing.status()).toBe(404);expect(missing.headers().location).toBeUndefined();expect(missing.headers()['set-cookie']).toBeUndefined();
});

test('public capability documents retain privacy headers and ordinary pages keep the base CSP',async({request})=>{
  const normal=await request.get('/en/auth/login/');expect(normal.status()).toBe(200);
  const policy=normal.headers()['content-security-policy'];expect(policy).toContain("default-src 'self'");expect(policy).not.toContain('najva.com');
  for(const path of ['feedback','saved-share','communication-preferences','communication-verification']){
    const response=await request.get('/en/'+path+'/'+'0'.repeat(64)+'/',{maxRedirects:0});
    expect(response.headers()['referrer-policy']).toBe('no-referrer');expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['x-robots-tag']).toContain('noindex');expect(response.headers()['content-security-policy']).not.toContain('najva.com');
  }
});
