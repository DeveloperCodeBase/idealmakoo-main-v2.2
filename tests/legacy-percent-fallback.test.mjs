import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const legacy=await loadTs('src/lib/legacy-redirects.ts');
const source=legacy.legacyPageRedirects.find(row=>/%(?![0-9a-f]{2})/i.test(new URL(row.sourceUrl).pathname));
assert.ok(source,'The recorded source includes a literal percent title');
const raw=new URL(source.sourceUrl).pathname;
let reads=0,site;
const reset=()=>{reads=0;site={publications:[],hiddenProducts:[],hiddenProductLocales:{}};};
const output=ts.transpileModule(readFileSync(new URL('../src/app/pages/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const route={};
runInNewContext(output,{exports:route,URL,Response,require:name=>name==='@/lib/legacy-redirects'?legacy:name==='@/server/public-site'?{getServerPublicSite:async()=>{reads++;return site;}}:assert.fail('Unexpected fallback dependency '+name)});
const request=(path=raw,{method='GET',header=path,query=''}={})=>new Request('https://factory.example'+path+query,{method,headers:header===null?{}:{'x-idealmakoo-path':header}});

test('known raw-percent source returns the current initial 301 for GET and HEAD without a query-controlled destination',async()=>{
  reset();
  const response=await route.GET(request(raw,{query:'?next=https%3A%2F%2Foutside.example.invalid'}));
  assert.equal(response.status,301);assert.equal(response.headers.get('Location'),'/fa/'+source.fallbackPath+'/');
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Set-Cookie'),null);
  const head=await route.HEAD(request(raw,{method:'HEAD'}));
  assert.equal(head.status,301);assert.equal(await head.text(),'');assert.equal(head.headers.get('Location'),response.headers.get('Location'));
  assert.equal(reads,2,'Each request obtains current public visibility');
});

test('direct fallback requests and forged original-path headers cannot select a historical identity',async()=>{
  reset();
  for(const input of [request('/pages',{header:raw}),request('/pages/',{header:raw}),request(raw,{header:null}),request(raw,{header:'/pages/99999999/forged%'})]){
    const response=await route.GET(input);
    assert.equal(response.status,404);assert.equal(response.headers.get('Location'),null);
    assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Set-Cookie'),null);
  }
  assert.equal(reads,0,'Invalid fallback identities do not read public state');
});

test('unknown and malformed-percent historical titles remain non-cacheable 404 responses',async()=>{
  reset();
  for(const path of [raw.replace('/'+source.legacyId+'/','/99999999/'),raw.replace(/%(?![0-9a-f]{2})/gi,'%GG')]){
    const response=await route.GET(request(path));
    assert.equal(response.status,404);assert.equal(response.headers.get('Location'),null);assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
});

test('the static fallback obeys current withdrawal and reviewed publication targets',async()=>{
  reset();
  site.hiddenProductLocales[source.recordId]=['fa'];
  assert.equal((await route.GET(request())).status,404);
  site.hiddenProductLocales={};
  site.publications=[{id:source.recordId,kind:'product',slug:'reviewed-current-title',locale:'fa'}];
  const response=await route.GET(request());
  assert.equal(response.status,301);assert.equal(response.headers.get('Location'),'/fa/products/reviewed-current-title/');
});
