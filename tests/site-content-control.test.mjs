import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const {createHomeBlocks,upgradeHomeBlocks,homeSectionIds,editablePublicTargets,createSiteDraft}=await loadTs('src/lib/site-content.ts');
const {parsePublications,parseBlockOptions}=await loadTs('src/lib/publications.ts');
const {products,companyPages}=await loadTs('src/data/catalog.ts');
const locales=['fa','en','tr','ar','ru'];
const publication=(blocks,locale='fa')=>({id:'site-home-'+locale,slug:'home',kind:'page',locale,title:'Home',summary:'',body:'',blocks,publishedAt:'2026-10-17T12:00:00Z',version:2});

test('all five home compositions contain eleven unique stable sections and both original scene defaults',()=>{
 assert.equal(homeSectionIds.length,11);assert.equal(new Set(homeSectionIds).size,11);
 for(const locale of locales){const blocks=createHomeBlocks(locale);assert.deepEqual(blocks.map(block=>block.id),[...homeSectionIds]);assert.ok(blocks.every(block=>block.hidden===false&&typeof block.title==='string'&&typeof block.body==='string'));
  for(const id of ['home-hero','home-innovation']){const block=blocks.find(item=>item.id===id);assert.equal(block.options.visual,'scene');assert.ok(block.title.trim()&&block.body.trim());}
  assert.equal(blocks.find(block=>block.id==='home-innovation').link,`/${locale}/manufacturing/`);
  assert.ok(blocks.find(block=>block.id==='home-products').options.productIds.every(id=>products.some(product=>product.id===id)));
  for(const block of blocks)for(const link of [block.link,block.options?.secondaryLink].filter(Boolean))assert.match(link,new RegExp(`^/${locale}/`));
 }
});

test('home drafts are independent editable copies and cannot mutate future defaults',()=>{
 const first=createHomeBlocks('fa'),second=createHomeBlocks('fa');first[0].title='Edited';first.find(block=>block.id==='home-products').options.productIds.length=0;
 assert.notEqual(second[0].title,'Edited');assert.ok(second.find(block=>block.id==='home-products').options.productIds.length>0);
 for(const locale of locales){const draft=createSiteDraft('home',locale,'Editor','editor-1');assert.equal(draft.status,'draft');assert.equal(draft.locale,locale);assert.equal(draft.authorId,'editor-1');assert.deepEqual(draft.blocks.map(block=>block.id),[...homeSectionIds]);}
});

test('every source page has populated independent drafts in all five authored languages',()=>{
 const ids=new Set();
 for(const target of editablePublicTargets){
  const sourceFa=createSiteDraft(target.slug,'fa','source');
  for(const locale of locales){const draft=createSiteDraft(target.slug,locale,'source');assert.ok(draft.title.trim(),`${target.slug}:${locale} title`);assert.ok(draft.summary.trim(),`${target.slug}:${locale} summary`);assert.ok(draft.blocks.some(block=>block.body.trim()),`${target.slug}:${locale} body`);assert.equal(draft.status,'draft');assert.equal(draft.locale,locale);assert.equal(ids.has(draft.id),false);ids.add(draft.id);assert.equal(new Set(draft.blocks.map(block=>block.id)).size,draft.blocks.length);
   if(locale!=='fa')assert.notEqual(draft.summary,sourceFa.summary,`${target.slug}:${locale} cannot be a copied Persian body`);
   const before=JSON.stringify(createSiteDraft(target.slug,locale,'source').blocks);draft.blocks[0].title='A private unsaved change';assert.equal(JSON.stringify(createSiteDraft(target.slug,locale,'source').blocks),before);
  }
 }
 assert.equal(ids.size,editablePublicTargets.length*5);
});
test('factory templates preserve source paragraphs, functional contact forms and live glossary/feed section identities',()=>{
 const about=companyPages.find(page=>page.slug==='about');
 for(const locale of locales){const draft=createSiteDraft('about',locale,'source');const lead=draft.blocks.find(block=>block.id==='about-lead');for(const paragraph of about.body)assert.ok(lead.body.includes(paragraph[locale]));assert.ok(draft.blocks.some(block=>block.id==='about-timeline'));assert.ok(draft.blocks.some(block=>block.id==='about-statistics'));
  const manufacturing=createSiteDraft('manufacturing',locale,'source');assert.equal(manufacturing.blocks.find(block=>block.id==='manufacturing-experience').options.visual,'scene');
  assert.deepEqual(createSiteDraft('contact',locale,'source').blocks.map(block=>block.id),['contact-hero']);
  assert.ok(createSiteDraft('glossary',locale,'source').blocks.some(block=>block.id==='glossary-published-terms'));
  assert.ok(createSiteDraft('knowledge',locale,'source').blocks.some(block=>block.id==='knowledge-feed'));
  assert.ok(createSiteDraft('quality',locale,'source').blocks.some(block=>block.id==='quality-certificates'));
 }
});

test('legacy home migration preserves authored content, empty curated selection, hidden flags and unmatched extras',()=>{
 const legacy=[{id:'old-hero',type:'hero',title:'Authored hero',body:'',mediaUrl:'/media/official/president.jpg',hidden:true},{id:'old-products',type:'product-grid',title:'Curated',body:'Selected by editor',options:{productIds:[],tone:'violet'}},{id:'old-catalogs',type:'catalog-carousel',title:'Files',body:'Original files'},{id:'old-news',type:'news-carousel',title:'Updates',body:'Published locally'},{id:'extra-copy',type:'rich-text',title:'Extra',body:'Keep this paragraph'},{id:'second-hero',type:'hero',title:'Extra heading',body:'Keep this too'}];
 const before=structuredClone(legacy);const {blocks,upgraded}=upgradeHomeBlocks(legacy,'en');assert.equal(upgraded,true);assert.deepEqual(legacy,before);
 const hero=blocks.find(block=>block.id==='home-hero');assert.equal(hero.title,'Authored hero');assert.equal(hero.body,'');assert.equal(hero.hidden,true);assert.equal(hero.mediaUrl,legacy[0].mediaUrl);assert.equal(hero.options.visual,'scene');
 const curated=blocks.find(block=>block.id==='home-products');assert.equal(curated.type,'product-carousel');assert.deepEqual(curated.options.productIds,[]);assert.equal(curated.options.tone,'violet');
 assert.equal(blocks.find(block=>block.id==='home-catalogs').title,'Files');assert.equal(blocks.find(block=>block.id==='home-news').title,'Updates');assert.equal(blocks.find(block=>block.id==='home-innovation').options.visual,'scene');
 assert.deepEqual(blocks.slice(-3).map(block=>block.id),['extra-copy','second-hero','home-cta']);assert.equal(new Set(blocks.map(block=>block.id)).size,blocks.length);
});

test('a specialized composition is an exact no-op including intentional omission, empty text and empty product selection',()=>{
 const blocks=[{id:'home-products',type:'product-carousel',title:'',body:'',hidden:true,options:{productIds:[]}},{id:'home-hero',type:'hero',title:'',body:'',hidden:false,options:{visual:'scene'}}];
 const result=upgradeHomeBlocks(blocks,'fa');assert.equal(result.upgraded,false);assert.equal(result.blocks,blocks);assert.deepEqual(result.blocks,blocks);assert.equal(result.blocks.length,2);
});

test('editorial target allowlist covers factory pages while excluding account, transaction, tool and catalog detail routes',()=>{
 const slugs=editablePublicTargets.map(target=>target.slug);assert.equal(new Set(slugs).size,slugs.length);assert.equal(editablePublicTargets.find(target=>target.slug==='home').mode,'home');
 for(const page of companyPages)assert.ok(slugs.includes(page.slug));
 for(const slug of ['about','manufacturing','quality','sustainability','global','for/dentist','for/lab'])assert.ok(slugs.includes(slug));
 for(const slug of ['login','signup','auth/login','admin','dashboard','products','products/detail',`products/${products[0].slug}`,'resources/detail','inquiry-list','sample-request','cooperation','tools/shade-mould-matcher']){assert.ok(!slugs.includes(slug),slug);assert.throws(()=>createSiteDraft(slug,'en','Editor'),/Unsupported editorial target/);}
 for(const target of editablePublicTargets)for(const locale of locales)assert.ok(target.title[locale]?.trim(),`${target.slug}.${locale}`);
});

test('published section options whitelist fields, known product IDs and strict string enums without discarding explicit emptiness',()=>{
 const id=products[0].id;const input={productIds:[id,id,'not-a-factory-product',4,null],ctaLabel:'',secondaryLabel:'s'.repeat(200),secondaryLink:'/fa/resources/',visual:'image',tone:'cyan',style:{background:'red'},onClick:'alert(1)',hidden:'true'};
 const parsed=parseBlockOptions(input);assert.deepEqual(parsed.productIds,[id]);assert.equal(parsed.ctaLabel,'');assert.equal(parsed.secondaryLabel.length,180);assert.equal(parsed.visual,'image');assert.equal(parsed.tone,'cyan');assert.equal(parsed.secondaryLink,'/fa/resources/');assert.equal('style' in parsed,false);assert.equal('onClick' in parsed,false);assert.equal('hidden' in parsed,false);
 assert.deepEqual(parseBlockOptions({productIds:[]}),{productIds:[]});assert.deepEqual(parseBlockOptions({productIds:['unknown']}),{productIds:[]});
 for(const value of [null,[],42,'text',{}, {tone:['cyan']},{tone:{toString:'cyan'}},{visual:['scene']},{visual:'script'}, {ctaLabel:12}])assert.equal(parseBlockOptions(value),undefined);
});

test('published secondary links reject executable, ambiguous, malformed and credential-bearing URLs',()=>{
 for(const link of ['javascript:alert(1)','data:text/html,hello','//example.com/','/\\example.com/','https://','https://user:secret@example.com/','/en/\nproducts/'])assert.equal(parseBlockOptions({secondaryLink:link}),undefined,JSON.stringify(link));
 for(const link of ['/en/resources/','https://idealmakoo.com/pages/3/products','https://example.com/catalog.pdf?lang=en#page=2'])assert.equal(parseBlockOptions({secondaryLink:link}).secondaryLink,link);
});

test('publication parsing preserves ordered boolean visibility and safe options while rejecting coercion and unknown presentation fields',()=>{
 const blocks=[{id:'home-hero',type:'hero',title:'',body:'',hidden:false,options:{visual:'scene',tone:'violet'}},{id:'home-products',type:'product-carousel',title:'',body:'',hidden:true,options:{productIds:[]}},{id:'extra',type:'rich-text',title:'Text',body:'Body',hidden:'true',options:{visual:'script',style:'display:none'},style:{display:'none'},script:'alert(1)'}];
 for(const locale of locales){const result=parsePublications([publication(blocks,locale)]);assert.equal(result.length,1);assert.equal(result[0].locale,locale);assert.deepEqual(result[0].blocks.map(block=>block.id),blocks.map(block=>block.id));assert.equal(result[0].blocks[0].body,'');assert.equal(result[0].blocks[0].hidden,false);assert.equal(result[0].blocks[1].hidden,true);assert.deepEqual(result[0].blocks[1].options.productIds,[]);assert.equal(result[0].blocks[2].hidden,undefined);assert.equal(result[0].blocks[2].options,undefined);assert.equal('script' in result[0].blocks[2],false);assert.equal('style' in result[0].blocks[2],false);}
});
