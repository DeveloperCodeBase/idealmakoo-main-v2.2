import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const {buildPublicAuditInventory,publicAuditUrl}=await loadTs('scripts/lib/public-audit-inventory.mjs');
const {products,articles}=await loadTs('src/data/catalog.ts');
const {publicSitemapEntries}=await loadTs('src/server/public-routing.ts');
const baseUrl='https://audit.example';
const release=overrides=>({id:'audit-reviewed-page',kind:'page',locale:'en',slug:'reviewed-custom-page',title:'Reviewed page',summary:'Reviewed summary',body:'Reviewed body',blocks:[],publishedAt:'2026-10-20T12:00:00Z',version:1,...overrides});
function inventory(overrides={},extra={}){
 const site={publications:[],forms:[],...overrides};
 return buildPublicAuditInventory({baseUrl,site,sitemapUrls:publicSitemapEntries(site,baseUrl).map(row=>row.url),...extra});
}
const find=(list,path,device='mobile')=>list.jobs.find(job=>job.url===baseUrl+path&&job.device===device);

test('public inventory measures each canonical source once and keeps every language/auth/missing-page expectation',()=>{
 const list=inventory({}, {devices:['mobile','desktop']});
 assert.equal(list.jobs.length,list.sourceUrls*2);
 assert.equal(new Set(list.jobs.map(job=>job.url+'|'+job.device)).size,list.jobs.length);
 assert.deepEqual(list.redirects,[]);
 for(const locale of ['fa','en','ar','tr','ru']){
  assert.equal(find(list,`/${locale}/`).indexed,true);
  assert.equal(find(list,`/${locale}/auth/register/`).kind,'public-auth');
  assert.equal(find(list,`/${locale}/__lighthouse_missing_page__/`).expectedStatus,404);
  assert.ok(find(list,`/${locale}/products/`,'desktop'));
 }
 assert.equal(list.jobs.some(job=>/\/(?:admin|account|api)\//.test(job.url)),false);
 assert.ok(list.excluded.some(entry=>entry.route==='admin/users'));
 assert.ok(list.excluded.some(entry=>entry.route==='news/detail'));
});

test('a reviewed source rename measures its released destination and separately verifies its permanent redirect',()=>{
 const original='products/'+products[0].slug;
 const list=inventory({publications:[release({id:products[0].id,kind:'product',slug:'reviewed-product-name'})]});
 assert.equal(find(list,'/en/'+original+'/'),undefined);
 assert.equal(find(list,'/en/products/reviewed-product-name/').indexed,true);
 assert.equal(find(list,'/fa/'+original+'/').expectedStatus,200);
 assert.deepEqual(list.redirects,[{url:baseUrl+'/en/'+original+'/',kind:'public-redirect',indexed:false,expectedStatus:308,expectedLocation:baseUrl+'/en/products/reviewed-product-name/'}]);
 assert.equal(list.sourceUrls,inventory().sourceUrls);
});

test('withdrawn renamed sources are expected 404 in only their withdrawn language, without a redirect expectation',()=>{
 const original='research/'+articles[0].slug;
 const list=inventory({publications:[release({id:articles[0].id,kind:'research',slug:'withdrawn-article'})],hiddenArticleLocales:{[articles[0].id]:['en']}});
 for(const route of [original,'research/withdrawn-article']){
  assert.equal(find(list,'/en/'+route+'/').expectedStatus,404);
  assert.equal(find(list,'/en/'+route+'/').kind,'expected-404');
  assert.equal(find(list,'/en/'+route+'/').indexed,false);
 }
 assert.equal(find(list,'/fa/'+original+'/').expectedStatus,200);
 assert.deepEqual(list.redirects,[]);
});

test('noindex custom releases and static source pages remain audited independently of the sitemap',()=>{
 const row=release(),list=inventory({publications:[row],preferences:{seo:{[row.slug]:{en:{noindex:true}},contact:{tr:{noindex:true}}}}});
 for(const path of ['/en/reviewed-custom-page/','/tr/contact/']){
  const job=find(list,path);assert.ok(job,path);assert.equal(job.expectedStatus,200);assert.equal(job.expectedNoindex,true);assert.equal(job.indexed,false);
 }
 assert.equal(find(list,'/fa/contact/').indexed,true);
 assert.equal(find(list,'/fa/reviewed-custom-page/'),undefined,'An unpublished translation is not invented.');
});

test('an erroneous sitemap retains its indexable-200 expectation instead of hiding its stale alias or withdrawal',()=>{
 const original='products/'+products[0].slug;
 const renamed=inventory({publications:[release({id:products[0].id,kind:'product',slug:'renamed-product'})]},{sitemapUrls:[baseUrl+'/en/'+original+'/']});
 assert.equal(find(renamed,'/en/'+original+'/').expectedStatus,200);
 assert.equal(find(renamed,'/en/'+original+'/').indexed,true);
 assert.equal(renamed.redirects.some(entry=>entry.url===baseUrl+'/en/'+original+'/'),false);
 const withdrawn=inventory({hiddenPageLocales:{contact:['en']}},{sitemapUrls:[baseUrl+'/en/contact/']});
 assert.equal(find(withdrawn,'/en/contact/').expectedStatus,200);assert.equal(find(withdrawn,'/en/contact/').kind,'public');assert.equal(find(withdrawn,'/en/contact/').indexed,true);
});

test('shareable inventory rejects private capabilities and unsafe URL identities, including encoded private segments',()=>{
 for(const path of ['/en/admin/users/','/fa/account/','/en/%61dmin/users/','/en/feedback/secret/','/en/saved-share/secret/','/en/communication-preferences/secret/','/en/communication-verification/device/','/en/communication-unsubscribe/secret/','/api/v1/users','https://other.example/en/','/en/?token=secret','/en/#secret'])assert.throws(()=>publicAuditUrl(path,baseUrl),undefined,path);
 assert.equal(publicAuditUrl('/en/auth/login/',baseUrl),baseUrl+'/en/auth/login/');
 assert.throws(()=>buildPublicAuditInventory({baseUrl,site:{publications:[]},sitemapUrls:[]}),/Invalid public site snapshot/);
 assert.throws(()=>inventory({publications:[release({locale:'unknown'})]}),/Invalid publication locale/);
});
