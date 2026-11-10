import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {buildDiscoveryIndex,searchDiscoveryIndex,normalizeDiscoveryText}=await loadTs('src/server/discovery-index.ts');
const {products}=await loadTs('src/data/catalog.ts');
const {splitSitemap,sitemapIndexXml,sitemapShardXml,sitemapShardSize}=await loadTs('src/server/sitemap-xml.ts');
const site=patch=>({publications:[],hiddenProducts:[],hiddenProductLocales:{},hiddenArticleLocales:{},hiddenPageLocales:{},...patch});
const publication=patch=>({id:'news-fixture',kind:'news',slug:'approved-news',locale:'fa',title:'گزارش کیفیت ۱۲۳',summary:'متن تأیید شده',body:'توضیحات عمومی',blocks:[],version:1,publishedAt:'2026-10-26T09:00:00.000Z',taxonomy:{category:'آموزش',tags:['کیفیت']},...patch});
const search=(documents,q,extra={})=>searchDiscoveryIndex(documents,{q,limit:20,offset:0,...extra});

test('Persian and Arabic glyphs, numerals, accents and joining controls normalize consistently',()=>{
 assert.equal(normalizeDiscoveryText('كِيفيّت ١٢٣'),normalizeDiscoveryText('کیفیت ۱۲۳'));
 assert.equal(normalizeDiscoveryText('CAFÉ'),normalizeDiscoveryText('cafe'));
 assert.equal(normalizeDiscoveryText('دندان\u200cسازی'),normalizeDiscoveryText('دندان سازی'));
});
test('Unified catalogue searches real products in all five languages and returns localized canonical URLs',()=>{
 for(const locale of ['fa','en','tr','ar','ru']){
  const result=search(buildDiscoveryIndex(site({}),locale),products[0].name[locale]);
  assert.equal(result.items[0].id,products[0].id);assert.equal(result.items[0].href,`/${locale}/products/${products[0].slug}/`);
  assert.equal(result.items.some(row=>/\/(admin|account|auth)\//.test(row.href)),false);
 }
});
test('Withdrawn sources, aliases and hidden locale pages do not leak into search',()=>{
 const item=products[0],renamed=publication({id:item.id,kind:'product',locale:'en',slug:'approved-renamed',title:'Approved product',summary:'Approved summary'});
 const released=buildDiscoveryIndex(site({publications:[renamed]}),'en');
 assert.equal(search(released,'Approved product').items[0].href,'/en/products/approved-renamed/');
 assert.equal(released.some(row=>row.href===`/en/products/${item.slug}/`),false);
 const hidden=buildDiscoveryIndex(site({publications:[renamed],hiddenProductLocales:{[item.id]:['en']}}),'en');
 assert.equal(hidden.some(row=>row.id===item.id),false);
 assert.equal(buildDiscoveryIndex(site({hiddenPageLocales:{about:['fa']}}),'fa').some(row=>row.href==='/fa/about/'),false);
});
test('Search uses reviewed taxonomy, supports filters and excludes hidden block text',()=>{
 const item=publication({blocks:[{id:'hidden',type:'rich-text',hidden:true,title:'HIDDENSECRET',body:'PRIVATEBLOCK'}]});
 const index=buildDiscoveryIndex(site({publications:[item]}),'fa');
 assert.equal(search(index,'كيفيت 123',{kind:'news',category:'آموزش'}).items[0].id,item.id);
 assert.equal(search(index,'HIDDENSECRET').total,0);assert.equal(search(index,'PRIVATEBLOCK').total,0);
 assert.equal(search(index,'کیفیت',{kind:'product'}).items.some(row=>row.id===item.id),false);
 assert.equal(buildDiscoveryIndex(site({publications:[item]}),'en').some(row=>row.id===item.id),false);
});
test('One-character title typos are tolerated while empty and paginated results stay consistent',()=>{
 const docs=buildDiscoveryIndex(site({}),'en');
 assert.ok(search(docs,'dentuer').total>0||search(docs,'denturee').total>0);
 const first=search(docs,'',{limit:5}),second=search(docs,'',{limit:5,offset:5});
 assert.equal(first.items.length,5);assert.equal(first.total,second.total);assert.ok(first.hasMore);
 assert.equal(first.items.some(row=>second.items.some(next=>row.href===next.href)),false);
 assert.equal(search(docs,'definitelyabsentcontenttoken').total,0);
});
test('Managed documents are included only in approved available locales and use safe page links',()=>{
 const managed={id:'managed-test',slug:'approved-resource',title:{fa:'مستند کنترل شده',en:'Controlled document'},summary:{fa:'خلاصه',en:'Summary'},type:'manual',locales:['fa']};
 const fa=buildDiscoveryIndex(site({}),'fa',[managed]),en=buildDiscoveryIndex(site({}),'en',[managed]);
 assert.equal(search(fa,'کنترل').items.find(row=>row.id===managed.id).href,'/fa/resources/approved-resource/');
 assert.equal(en.some(row=>row.id===managed.id),false);
});
test('Sitemap shards are stable, language/type separated and bounded',()=>{
 const items=Array.from({length:sitemapShardSize+1},(_,i)=>({url:`https://factory.example/fa/products/item-${i}/`,lastModified:'2026-10-26',alternates:{languages:{fa:`https://factory.example/fa/products/item-${i}/`}}}));
 const shards=splitSitemap(items);assert.equal(shards.length,2);assert.equal(shards[0].entries.length,sitemapShardSize);assert.equal(shards[1].entries.length,1);
 assert.deepEqual(splitSitemap([...items].reverse()),shards);
 assert.match(sitemapIndexXml('https://factory.example',shards),/<sitemapindex/);
 assert.match(sitemapIndexXml('https://factory.example',shards),/fa-products-2.xml/);
});
test('Sitemap XML escapes URL values and emits only actual lastmod and hreflang',()=>{
 const xml=sitemapShardXml([{url:'https://factory.example/en/a&b/',lastModified:'invalid',alternates:{languages:{en:'https://factory.example/en/a&b/'}}}]);
 assert.match(xml,/a&amp;b/);assert.doesNotMatch(xml,/<lastmod>/);assert.match(xml,/hreflang="en"/);assert.doesNotMatch(xml,/hreflang="fa"/);
 assert.throws(()=>splitSitemap([{url:'https://factory.example/en/page/?token=secret',alternates:{languages:{}}}]),/Invalid/);
});
