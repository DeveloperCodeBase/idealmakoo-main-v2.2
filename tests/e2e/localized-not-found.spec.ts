import {test,expect,type APIResponse} from '@playwright/test';
import {direction,locales,translate,type Locale} from '../../src/lib/i18n';
import {legacyPageRedirects} from '../../src/lib/legacy-redirects';

// APIRequestContext does not execute JavaScript. In particular, translated text
// inside Next's Flight scripts must not satisfy the initial-document contract.
type RawElement={tag:string;attributes:Record<string,string>;parent:RawElement|null;hidden:boolean;text:string};
const voidElements=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function decode(value:string):string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi,(match,entity:string)=>{
    if(entity[0]!=='#')return entities[entity.toLowerCase()]??match;
    const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
    return code>0&&code<=0x10ffff?String.fromCodePoint(code):match;
  });
}
function attributes(source:string):Record<string,string> {
  const result:Record<string,string>={};
  for(const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))result[match[1].toLowerCase()]=decode(match[2]??match[3]??match[4]??'');
  return result;
}
function rawElements(html:string):RawElement[] {
  // Ignore inert template contents as well as raw-text scripts/styles. This
  // bounded reader is for the application's valid HTML, not a browser emulator.
  const source=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const elements:RawElement[]=[],stack:RawElement[]=[];
  const tokens=source.match(/<![^>]*>|<\/?[a-z][^<>]*(?:>|$)|[^<]+/gi)??[];
  for(const token of tokens){
    if(token.startsWith('<!'))continue;
    const close=token.match(/^<\/([a-z][\w:-]*)\s*>/i);
    if(close){const index=stack.map(node=>node.tag).lastIndexOf(close[1].toLowerCase());if(index>=0)stack.length=index;continue;}
    const open=token.match(/^<([a-z][\w:-]*)\b([\s\S]*?)>$/i);
    if(open){
      const tag=open[1].toLowerCase(),attrs=attributes(open[2]),parent=stack.at(-1)??null;
      const hidden=!!parent?.hidden||Object.hasOwn(attrs,'hidden')||attrs['aria-hidden']==='true'||/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style??'');
      const node:RawElement={tag,attributes:attrs,parent,hidden,text:''};elements.push(node);
      if(!voidElements.has(tag)&&!token.endsWith('/>'))stack.push(node);
    }else if(!token.startsWith('<'))for(const node of stack)node.text+=decode(token);
  }
  return elements;
}
const plain=(value:string)=>value.replace(/\s+/g,' ').trim();
const inside=(node:RawElement,ancestor:RawElement):boolean=>{for(let parent=node.parent;parent;parent=parent.parent)if(parent===ancestor)return true;return false;};

function assert404Headers(response:APIResponse):void {
  const headers=response.headers();
  expect(response.status()).toBe(404);
  expect(headers.location).toBeUndefined();
  expect(headers['content-type']).toMatch(/^text\/html\b/i);
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['referrer-policy']).toBe('no-referrer');
  for(const token of ['noindex','nofollow','noarchive'])expect(headers['x-robots-tag']).toContain(token);
  expect(headers['x-content-type-options']).toBe('nosniff');
}
async function assertRaw404(response:APIResponse,locale:Locale,expectedUrl:string):Promise<string> {
  assert404Headers(response);
  expect(response.url()).toBe(expectedUrl);
  const body=await response.body();expect(body.length).toBeLessThan(2*1024*1024);
  const html=body.toString('utf8'),nodes=rawElements(html);
  const roots=nodes.filter(node=>node.tag==='html'),heads=nodes.filter(node=>node.tag==='head'),bodies=nodes.filter(node=>node.tag==='body');
  expect(roots).toHaveLength(1);expect(heads).toHaveLength(1);expect(bodies).toHaveLength(1);
  expect(roots[0].attributes.lang).toBe(locale);expect(roots[0].attributes.dir).toBe(direction(locale));
  expect(roots[0].attributes.id).not.toBe('__next_error__');
  expect(heads[0].parent===roots[0]&&bodies[0].parent===roots[0]).toBe(true);
  const titles=nodes.filter(node=>node.tag==='title'&&inside(node,heads[0]));
  expect(titles).toHaveLength(1);expect(plain(titles[0].text)).toBe(`${translate(locale,'notFound')} | ${translate(locale,'brand')}`);
  const mains=nodes.filter(node=>node.tag==='main'&&!node.hidden&&inside(node,bodies[0]));
  expect(mains).toHaveLength(1);expect(mains[0].attributes.lang).toBe(locale);expect(mains[0].attributes.dir).toBe(direction(locale));
  const headings=nodes.filter(node=>node.tag==='h1'&&!node.hidden&&inside(node,mains[0]));
  expect(headings).toHaveLength(1);expect(plain(headings[0].text)).toBe(translate(locale,'notFound'));
  const home=nodes.filter(node=>node.tag==='a'&&!node.hidden&&inside(node,mains[0])&&node.attributes.href===`/${locale}/`);
  expect(home).toHaveLength(1);expect(plain(home[0].text)).toBe(translate(locale,'home'));
  const robots=nodes.filter(node=>node.tag==='meta'&&inside(node,heads[0])&&node.attributes.name==='robots');
  expect(robots.length).toBeGreaterThan(0);expect(robots.every(node=>/\bnoindex\b/i.test(node.attributes.content??''))).toBe(true);
  const referrers=nodes.filter(node=>node.tag==='meta'&&inside(node,heads[0])&&node.attributes.name==='referrer');
  expect(referrers).toHaveLength(1);expect(referrers[0].attributes.content).toBe('no-referrer');
  return html;
}

for(const locale of locales)test(`raw no-JavaScript 404 is complete and localized for public, resource and malformed capability paths (${locale})`,async({request,baseURL})=>{
  expect(baseURL).toBeTruthy();
  for(const route of ['__raw_404_regression_missing__','resources/__raw_404_regression_missing__','feedback/not-a-valid-token']){
    const path=`/${locale}/${route}/`,response=await request.get(path,{headers:{Accept:'text/html'},maxRedirects:0});
    try{await assertRaw404(response,locale,new URL(path,baseURL).href);}finally{await response.dispose();}
  }
});

test('forged path, nonce and CSP cannot select the raw 404 locale or script policy',async({request,baseURL})=>{
  expect(baseURL).toBeTruthy();
  const forgedNonce='ClientSuppliedRaw404Nonce',forgedPolicy=`default-src https://attacker.example.invalid; script-src 'nonce-${forgedNonce}'`;
  for(const locale of locales){
    const path=`/${locale}/__raw_404_regression_missing__/`,otherLocale=locale==='ru'?'en':'ru';
    const response=await request.get(path,{maxRedirects:0,headers:{Accept:'text/html','x-idealmakoo-path':`/${otherLocale}/auth/login/`,'x-nonce':forgedNonce,'Content-Security-Policy':forgedPolicy}});
    try{
      const html=await assertRaw404(response,locale,new URL(path,baseURL).href),policy=response.headers()['content-security-policy'];
      expect(policy).toContain("default-src 'self'");expect(policy).not.toContain('attacker.example.invalid');expect(policy).not.toContain(forgedNonce);
      const generatedNonce=policy?.match(/'nonce-([^']+)'/)?.[1];expect(generatedNonce).toBeTruthy();
      const scriptNonces=[...html.matchAll(/<script\b([^>]*)>/gi)].map(match=>attributes(match[1]).nonce).filter((nonce):nonce is string=>typeof nonce==='string');
      expect(scriptNonces.length).toBeGreaterThan(0);expect(scriptNonces.every(nonce=>nonce===generatedNonce)).toBe(true);
    }finally{await response.dispose();}
  }
});

test('localized missing-page HEAD responses retain real 404 and privacy headers without a body',async({request})=>{
  for(const locale of locales){
    const response=await request.head(`/${locale}/__raw_404_regression_missing__/`,{maxRedirects:0});
    try{assert404Headers(response);expect(await response.body()).toHaveLength(0);}finally{await response.dispose();}
  }
});

test('early 404 routing preserves known 200 pages, canonical URLs and recorded legacy redirects',async({request,baseURL})=>{
  expect(baseURL).toBeTruthy();
  for(const locale of locales){
    const path=`/${locale}/products/`,response=await request.get(path,{maxRedirects:0});
    try{
      expect(response.status()).toBe(200);expect(response.headers().location).toBeUndefined();expect(response.url()).toBe(new URL(path,baseURL).href);
      const roots=rawElements(await response.text()).filter(node=>node.tag==='html');expect(roots).toHaveLength(1);
      expect(roots[0].attributes.lang).toBe(locale);expect(roots[0].attributes.id).not.toBe('__next_error__');
    }finally{await response.dispose();}
    const canonical=await request.get(`/${locale}/products?view=list`,{maxRedirects:0});
    try{expect(canonical.status()).toBe(308);expect(new URL(canonical.headers().location,baseURL).href).toBe(new URL(`${path}?view=list`,baseURL).href);}finally{await canonical.dispose();}
  }
  // The existing runtime-contracts suite covers all forty recorded aliases;
  // this representative ensures the new early-404 branch does not intercept it.
  const legacy=legacyPageRedirects[0],path=new URL(legacy.sourceUrl).pathname.replace(/%(?![0-9a-f]{2})/gi,'%25');
  const response=await request.get(path,{maxRedirects:0});
  try{expect(response.status()).toBe(301);expect(new URL(response.headers().location,baseURL).href).toBe(new URL(`/fa/${legacy.fallbackPath}/`,baseURL).href);}finally{await response.dispose();}
});

// Valid-shaped expired/revoked/consumed capability tokens remain owned by their
// ordinary authorization getters. These no-JS cases make no claim about them.
