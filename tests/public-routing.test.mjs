import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const {products,articles}=await loadTs('src/data/catalog.ts');
const {canonicalPublicPath,publicPathAvailable,publicAlternates,publicSitemapEntries,indexablePath,publicRouteKind}=await loadTs('src/server/public-routing.ts');
const {editorialStructuredData,publicationSocialImage}=await loadTs('src/server/public-structured-data.ts');
const origin='https://factory.example';
const at=Date.parse('2026-10-19T12:00:00Z');
const publication=overrides=>({id:'reviewed-news',slug:'reviewed-news',kind:'news',locale:'en',title:'Reviewed title',summary:'Reviewed summary',body:'Reviewed body',blocks:[],publishedAt:'2026-10-18T09:00:00Z',version:2,...overrides});

test('HTTP preflight separates real pages, managed documents and absent paths using the rendering publication policy',()=>{
 const site={publications:[publication({kind:'page',slug:'custom-reviewed-page'})]};
 assert.equal(publicRouteKind(site,'en',[]),'page');
 assert.equal(publicRouteKind(site,'en',['custom-reviewed-page']),'page');
 assert.equal(publicRouteKind(site,'fa',['custom-reviewed-page']),'missing');
 assert.equal(publicRouteKind(site,'en',['absent-page']),'missing');
 assert.equal(publicRouteKind(site,'en',['resources','new-managed-document']),'managed-resource');
 assert.equal(publicRouteKind(site,'en',['resources','new-managed-document','extra']),'missing');
 const hidden={...site,hiddenPageLocales:{'custom-reviewed-page':['en']}};
 assert.equal(publicRouteKind(hidden,'en',['custom-reviewed-page']),'missing');
 const productHidden={...site,hiddenProductLocales:{[products[0].id]:['en']}};
 assert.equal(publicRouteKind(productHidden,'en',['products',products[0].slug]),'missing');
 assert.equal(publicRouteKind(productHidden,'fa',['products',products[0].slug]),'page');
});

test('a renamed official product preserves canonical identity and withdrawal across both URLs and hreflang',()=>{
  const original='products/'+products[0].slug;
  const reviewed=publication({id:products[0].id,kind:'product',slug:'reviewed-product'});
  const site={publications:[reviewed]};
  assert.equal(canonicalPublicPath(site,'en',original),'products/reviewed-product');
  assert.equal(publicAlternates(site,'en','products/reviewed-product').fa,'/fa/'+original+'/');
  const hidden={...site,hiddenProductLocales:{[products[0].id]:['en']}};
  for(const path of [original,'products/reviewed-product'])assert.equal(publicPathAvailable(hidden,'en',path),false,path);
  assert.equal(publicAlternates(hidden,'fa',original).en,undefined);
  assert.equal(publicSitemapEntries(hidden,origin).some(row=>row.url===origin+'/en/products/reviewed-product/'),false);
  assert.equal(publicSitemapEntries(hidden,origin).some(row=>row.url===origin+'/en/'+original+'/'),false);
});

test('article withdrawal follows its source identity even after a reviewed slug change',()=>{
  const original='research/'+articles[0].slug;
  const site={publications:[publication({id:articles[0].id,kind:'research',slug:'corrected-article'})],hiddenArticleLocales:{[articles[0].id]:['en']}};
  assert.equal(canonicalPublicPath(site,'en',original),'research/corrected-article');
  assert.equal(publicPathAvailable(site,'en','research/corrected-article'),false);
  assert.equal(publicPathAvailable(site,'fa',original),true);
});

test('new editorial content advertises only actual released locales and the sitemap excludes all capability and account paths',()=>{
  const row=publication({slug:'factory-announcement'}),site={publications:[row]};
  assert.deepEqual(publicAlternates(site,'en','news/factory-announcement'),{en:'/en/news/factory-announcement/'});
  const entries=publicSitemapEntries(site,origin);
  assert.equal(new Set(entries.map(row=>row.url)).size,entries.length);
  assert.deepEqual(entries.find(entry=>entry.url===origin+'/en/news/factory-announcement/'),{
    url:origin+'/en/news/factory-announcement/',lastModified:row.publishedAt,alternates:{languages:{en:origin+'/en/news/factory-announcement/'}}
  });
  for(const path of ['feedback/secret','saved-share/secret','communication-preferences/secret','communication-verification/device','communication-unsubscribe/secret','admin/crm','account/organizations','auth/login','news/detail'])assert.equal(indexablePath(path),false,path);
  assert.equal(entries.some(row=>/\/(?:admin|account|auth|feedback|saved-share|communication-(?:preferences|verification|unsubscribe))\//.test(row.url)),false);
});

test('independently reviewed page translations form reciprocal hreflang without advertising an unreviewed language',()=>{
  const fa=publication({id:'page-fa',kind:'page',locale:'fa',slug:'reviewed-process'}),en=publication({id:'page-en',kind:'page',locale:'en',slug:fa.slug});
  const site={publications:[fa,en]},expected={fa:'/fa/reviewed-process/',en:'/en/reviewed-process/','x-default':'/fa/reviewed-process/'};
  assert.deepEqual(publicAlternates(site,'fa',fa.slug),expected);
  assert.deepEqual(publicAlternates(site,'en',en.slug),expected);
  for(const locale of ['fa','en'])assert.deepEqual(publicSitemapEntries(site,origin).find(entry=>entry.url===`${origin}/${locale}/${fa.slug}/`).alternates.languages,Object.fromEntries(Object.entries(expected).map(([key,path])=>[key,origin+path])));
  assert.deepEqual(publicAlternates({...site,hiddenPageLocales:{[fa.slug]:['en']}},'fa',fa.slug),{fa:'/fa/reviewed-process/','x-default':'/fa/reviewed-process/'});
});

test('social and structured images ignore hidden blocks, downloads, videos and audio',()=>{
  const block=(type,mediaUrl,extra={})=>({id:type,type,title:'Reviewed media',body:'',mediaUrl,...extra});
  const row=publication({blocks:[block('downloads','/media/guide.pdf'),block('video','/media/clip.mp4'),block('audio','/media/clip.mp3'),block('image','/media/hidden.jpg',{hidden:true}),block('split','/media/cover.webp')],seo:{article:{authors:[{type:'Person',name:'Reviewer'}]}}});
  assert.equal(publicationSocialImage(row),'/media/cover.webp');
  assert.equal(editorialStructuredData(row,origin,'news/reviewed-news',at).image,origin+'/media/cover.webp');
  assert.equal(publicationSocialImage({...row,blocks:row.blocks.slice(0,4)}),undefined);
  assert.equal(publicationSocialImage({...row,blocks:[block('image','/api/v1/media/reviewed-image/content')]}),'/api/v1/media/reviewed-image/content');
  assert.equal(publicationSocialImage({...row,blocks:[block('image','/media/clip.mp4')]}),undefined);
  assert.equal(publicationSocialImage({...row,blocks:[block('gallery','/media/fallback.jpg',{body:'/media/first.jpg | Caption\n/media/second.jpg | Second'})]}),'/media/first.jpg');
});

test('a video thumbnail becomes a social image only for a visible public video',()=>{
  const row=publication({blocks:[{id:'clip',type:'video',body:'',title:'Reviewed video',mediaUrl:'/media/clip.mp4'}],seo:{video:{thumbnailUrl:'/media/thumbnail.jpg',uploadDate:'2026-10-18'}}});
  assert.equal(publicationSocialImage(row),'/media/thumbnail.jpg');
  assert.equal(publicationSocialImage({...row,blocks:row.blocks.map(block=>({...block,hidden:true}))}),undefined);
  assert.equal(publicationSocialImage({...row,seo:{video:{thumbnailUrl:'javascript:alert(1)',uploadDate:'2026-10-18'}}}),undefined);
});

test('structured article data contains only supplied reviewed dates and authors',()=>{
  const row=publication({seo:{article:{authors:[{type:'Person',name:'Named reviewer'}],datePublished:'2026-10-10',dateModified:'2026-10-18'}}});
  const schema=editorialStructuredData(row,origin,'news/reviewed-news',at);
  assert.equal(schema['@type'],'Article');assert.equal(schema.datePublished,'2026-10-10');
  assert.deepEqual(schema.author,[{'@type':'Person',name:'Named reviewer'}]);
  assert.equal(schema.offers,undefined);assert.equal(schema.aggregateRating,undefined);
  assert.equal(editorialStructuredData({...row,seo:{article:{datePublished:'2026-02-30'}}},origin,'news/reviewed-news',at),null);
  assert.equal(editorialStructuredData({...row,seo:{article:{datePublished:'2027-01-01'}}},origin,'news/reviewed-news',at),null);
});

test('video schema requires the actual visible video and reviewed public thumbnail',()=>{
  const row=publication({blocks:[{id:'video',type:'video',title:'Actual clip',body:'',mediaUrl:'/media/official/clip.mp4'}],seo:{video:{thumbnailUrl:'/media/official/thumb.jpg',uploadDate:'2026-10-18',durationSeconds:90}}});
  const schema=editorialStructuredData(row,origin,'news/reviewed-news',at);
  assert.equal(schema['@type'],'VideoObject');assert.equal(schema.contentUrl,origin+'/media/official/clip.mp4');assert.equal(schema.duration,'PT90S');
  assert.equal(editorialStructuredData({...row,blocks:[]},origin,'news/reviewed-news',at),null);
  assert.equal(editorialStructuredData({...row,blocks:row.blocks.map(block=>({...block,hidden:true}))},origin,'news/reviewed-news',at),null);
});

test('event schema uses authored venue and schedule and omits nonexistent offers',()=>{
  const address={streetAddress:'1 Factory Road',addressLocality:'Maku',addressCountry:'IR'};
  const row=publication({kind:'events',location:'Factory auditorium',eventStart:'2026-11-01T09:00:00+03:30',eventEnd:'2026-11-01T12:00:00+03:30',seo:{event:{address,status:'scheduled'}}});
  const schema=editorialStructuredData(row,origin,'events/reviewed-event',at);
  assert.equal(schema['@type'],'Event');assert.equal(schema.location.name,row.location);assert.equal(schema.startDate,row.eventStart);assert.equal(schema.offers,undefined);
  assert.equal(editorialStructuredData({...row,location:''},origin,'events/reviewed-event',at),null);
});

test('closed or expired jobs cannot emit JobPosting schema and a valid current job uses reviewed employer facts',()=>{
  const job={datePosted:'2026-10-01',validThrough:'2026-10-20',status:'open',hiringOrganization:{name:'Reviewed factory'},location:{streetAddress:'1 Factory Road',addressLocality:'Maku',addressCountry:'IR'}};
  const row=publication({kind:'hr',seo:{job}});
  assert.equal(editorialStructuredData(row,origin,'careers/reviewed-job',at)['@type'],'JobPosting');
  assert.equal(editorialStructuredData({...row,seo:{job:{...job,status:'closed'}}},origin,'careers/reviewed-job',at),null);
  assert.equal(editorialStructuredData({...row,seo:{job:{...job,validThrough:'2026-10-18'}}},origin,'careers/reviewed-job',at),null);
});
