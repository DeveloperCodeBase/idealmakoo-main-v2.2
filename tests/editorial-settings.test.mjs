import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {validPublicCopyOverrides,parsePublicCopyOverrides,publicCopyOverride,validPublicSeoSettings,parsePublicSeoSettings}=await loadTs('src/lib/site-editorial-settings.ts');
const {publicRouteSeo,publicPathIndexable,publicAlternates,publicSitemapEntries}=await loadTs('src/server/public-routing.ts');
const {products}=await loadTs('src/data/catalog.ts');

test('descriptive UI copy is scoped to its exact locale and cannot change security or transaction labels',()=>{
 const value={fa:{heroTitle:'  عنوان فارسی  '}};
 assert.equal(validPublicCopyOverrides(value),true);assert.equal(parsePublicCopyOverrides(value).fa.heroTitle,'عنوان فارسی');
 assert.equal(publicCopyOverride(value,'en','heroTitle'),undefined);
 for(const key of ['signIn','acceptPrivacy','consent','security','publish','delete','password'])assert.equal(validPublicCopyOverrides({fa:{[key]:'Changed'}}),false,key);
 for(const value of [{en:{heroTitle:''}},{xx:{heroTitle:'Text'}},{en:{heroTitle:'x'.repeat(2001)}},{en:{heroTitle:'Text\u0000'}},[]])assert.equal(validPublicCopyOverrides(value),false);
});
test('route metadata validation rejects private paths, executable fields and unknown languages',()=>{
 const seo={contact:{en:{title:' Contact ',description:' Description ',noindex:true}}};
 assert.equal(validPublicSeoSettings(seo),true);assert.equal(parsePublicSeoSettings(seo).contact.en.title,'Contact');
 for(const path of ['admin/settings','auth/login','account/security','new-unpublished-page'])assert.equal(validPublicSeoSettings({[path]:seo.contact}),false,path);
 for(const patch of [{canonical:'https://attacker.example'},{script:'alert(1)'},{noindex:'false'},{title:'x'.repeat(161)},{description:'x'.repeat(501)}])assert.equal(validPublicSeoSettings({contact:{en:{...seo.contact.en,...patch}}}),false);
 assert.equal(validPublicSeoSettings({contact:{xx:seo.contact.en}}),false);
});
test('noindex removes only the chosen locale from sitemap and all sibling hreflang sets',()=>{
 const site={publications:[],preferences:{seo:{about:{en:{title:'About',description:'Authored copy',noindex:true}}}}};
 assert.equal(publicPathIndexable(site,'en','about'),false);assert.equal(publicPathIndexable(site,'fa','about'),true);
 assert.equal(publicAlternates(site,'fa','about').en,undefined);
 const urls=publicSitemapEntries(site,'https://factory.example').map(entry=>entry.url);
 assert.equal(urls.includes('https://factory.example/en/about/'),false);assert.equal(urls.includes('https://factory.example/fa/about/'),true);
 assert.equal(publicRouteSeo(site,'fa','about'),undefined);
});
test('a source route exclusion survives canonical product renaming and never hides the original foreign locale',()=>{
 const original='products/'+products[0].slug;
 const publication={id:products[0].id,kind:'product',locale:'en',slug:'renamed-product',title:'Reviewed product',summary:'Description',body:'Description',blocks:[],version:1,publishedAt:'2026-10-20T00:00:00Z'};
 const site={publications:[publication],preferences:{seo:{[original]:{en:{title:'Custom SEO',description:'Reviewed description',noindex:true}}}}};
 assert.equal(publicPathIndexable(site,'en',original),false);assert.equal(publicPathIndexable(site,'en','products/renamed-product'),false);
 assert.equal(publicRouteSeo(site,'en','products/renamed-product').title,'Custom SEO');assert.equal(publicPathIndexable(site,'fa',original),true);
});
