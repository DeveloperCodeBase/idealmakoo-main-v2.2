import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,statSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTs} from './helpers/load-ts.mjs';

const {referenceDocuments,findReferenceDocument,referenceLinksForProduct,referencePageUrl}=await loadTs('src/data/reference-documents.ts');
const {officialSourcePages}=await loadTs('src/data/official-source-pages.ts');
const {products,articles,companyPages}=await loadTs('src/data/catalog.ts');
const root=fileURLToPath(new URL('../',import.meta.url));
const locales=['fa','en','tr','ar','ru'];
const publicFile=path=>resolve(root,'public',path.slice(1));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('two uploaded references retain 26 poster panels and 14 guide pages with original provenance',()=>{
 assert.equal(referenceDocuments.length,2);
 const poster=findReferenceDocument('ideal-makoo-mould-poster'),guide=findReferenceDocument('ideal-makoo-mould-guide');
 assert.deepEqual([poster.pageCount,poster.sourcePageCount,guide.pageCount,guide.sourcePageCount],[26,1,14,14]);
 assert.deepEqual(poster.pages.map(page=>page.sourcePanel),Array.from({length:26},(_,i)=>i));
 assert.ok(poster.pages.every(page=>page.sourcePage===1));
 assert.deepEqual(guide.pages.map(page=>page.sourcePage),Array.from({length:14},(_,i)=>i+1));
 assert.equal(poster.sourceSha256,'a41652ba6e9b55c0cf135d13b14c3fc5e4d64e98e392f80776453f4edafa895e');
 assert.equal(guide.sourceSha256,'a17af8e145c595ec8760f346210efe0a8d66698b3a0df05bb5cd9afa1cc03f1d');
 for(const document of referenceDocuments){assert.equal(document.sourceType,'user-upload');assert.equal(document.publishedAt,null);assert.notEqual(document.webSha256,document.sourceSha256);}
});

test('every downloadable web PDF is genuine, below 10 MB and matches its recorded byte count and SHA256',()=>{
 for(const document of referenceDocuments){
  assert.match(document.localDownloadUrl,/^\/media\/documents\/[^/]+-web\.pdf$/);
  assert.equal(document.url,document.localDownloadUrl);
  const bytes=readFileSync(publicFile(document.localDownloadUrl));
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal(bytes.length,document.webBytes);assert.equal(document.bytes,document.webBytes);
  assert.ok(bytes.length<10_000_000);assert.equal(digest(bytes),document.webSha256);
  assert.ok(!existsSync(publicFile('/media/documents/'+document.originalFileName)),'Unoptimized upload must not be duplicated in public');
 }
});

test('all 40 page images are real, unique local JPEGs and every section has a valid PDF page anchor',()=>{
 const imagePaths=[];
 for(const document of referenceDocuments){
  assert.equal(document.pages.length,document.pageCount);assert.equal(document.sections.length,document.pageCount);
  assert.equal(new Set(document.sections.map(section=>section.id)).size,document.sections.length);
  assert.deepEqual(document.pages.map(page=>page.page),Array.from({length:document.pageCount},(_,i)=>i+1));
  for(const page of document.pages){
   assert.match(page.image,/^\/media\/documents\/previews\/[^/]+\.jpg$/);imagePaths.push(page.image);
   const bytes=readFileSync(publicFile(page.image));assert.deepEqual([...bytes.subarray(0,3)],[255,216,255]);assert.ok(bytes.length<1_000_000);
   assert.ok(page.width>=1000&&page.height>=1400);
  }
  for(const section of document.sections){
   assert.ok(section.pageStart>=1&&section.pageEnd<=document.pageCount&&section.pageStart<=section.pageEnd);
   assert.equal(section.image,document.pages[section.pageStart-1].image);assert.ok(section.text.length>90);
   assert.equal(referencePageUrl(document,section.pageStart),`${document.url}#page=${section.pageStart}`);
  }
 }
 assert.equal(imagePaths.length,40);assert.equal(new Set(imagePaths).size,40);
});

test('all document, page, section and table-facing labels cover all five interface languages',()=>{
 for(const document of referenceDocuments){
  const values=[document.title,document.summary,document.extractionNote,document.derivativeNote,...document.pages.map(page=>page.title),...document.sections.flatMap(section=>[section.title,section.summary,...(section.tables??[]).flatMap(table=>[table.title,table.note,...table.columns.map(column=>column.label)])])];
  for(const value of values)for(const locale of locales)assert.ok(value[locale]?.trim(),`${document.id}: missing ${locale}`);
 }
});

test('poster profiles link only documented existing products and Nano Glass is not invented as an 18th live product',()=>{
 assert.equal(products.length,17);
 const allLinks=referenceDocuments.flatMap(document=>document.sections.flatMap(section=>section.productIds??[]));
 assert.equal(allLinks.length,11);assert.ok(allLinks.every(id=>products.some(product=>product.id===id)));
 assert.equal(referenceLinksForProduct('president')[0].section.pageStart,15);
 assert.equal(referenceLinksForProduct('newclar')[0].section.pageStart,26);
 assert.deepEqual(referenceLinksForProduct('made-up-product'),[]);
 assert.deepEqual(referenceLinksForProduct('bstar-nano-glass-archive'),[]);
 assert.ok(findReferenceDocument('ideal-makoo-mould-poster').sections.some(section=>section.id==='bstar-nano-glass-archive'));
});

test('recovered filename does not override visible Ideal branding and blank matrices remain explicitly blank',()=>{
 const guide=findReferenceDocument('ideal-makoo-mould-guide');
 assert.match(guide.originalFileName,/enigmalife/i);assert.equal(guide.sourceBrand,'Ideal Makoo');assert.equal(guide.relationship,'company');
 assert.match(guide.extractionNote.en,/filename.*Enigmalife/);assert.match(guide.extractionNote.en,/Ideal Makoo branding/);
 for(const document of referenceDocuments)for(const id of ['matching-square','matching-triangular','matching-oval']){
  const section=document.sections.find(item=>item.id===id);assert.equal(section.tables,undefined);assert.match(section.summary.en,/empty|no usable|no matching/);
 }
 const table=guide.sections.find(section=>section.id==='posterior-dimensions').tables[0];
 assert.deepEqual(table.rows.map(row=>row.code),['T4','N3','N4','N5','N6']);assert.match(table.note.en,/Units are not stated/);assert.match(table.note.en,/N4 photograph is missing/);
});

test('page-link construction clamps malformed and out-of-range numbers without inventing a PDF page',()=>{
 const document=referenceDocuments[0];
 for(const value of [0,-1,27,1.5,NaN,Infinity,undefined,'2'])assert.equal(referencePageUrl(document,value),`${document.url}#page=1`);
 assert.equal(referencePageUrl(document,26),`${document.url}#page=26`);
 assert.equal(findReferenceDocument('not-a-document'),undefined);
});

test('the 43 full official texts cover every canonical product, article and company source exactly once',()=>{
 assert.equal(officialSourcePages.length,43);assert.equal(new Set(officialSourcePages.map(page=>page.id)).size,43);assert.equal(new Set(officialSourcePages.map(page=>page.url)).size,43);
 for(const [collection,kind,key]of [[products,'product','productId'],[articles,'research','articleId'],[companyPages,'company','companyPageId']]){
  const sourcePages=officialSourcePages.filter(page=>page.kind===kind);assert.equal(sourcePages.length,collection.length);
  for(const entity of collection){const page=sourcePages.find(item=>item[key]===entity.id);assert.ok(page);assert.equal(page.url,entity.sourceUrl);assert.ok(page.contentText.length>10);assert.ok(page.text.includes(page.contentText));}
 }
 assert.equal(officialSourcePages.filter(page=>page.kind==='index').length,3);
 assert.ok(officialSourcePages.reduce((count,page)=>count+page.text.length,0)>70_000);
 for(const page of officialSourcePages){assert.equal(new URL(page.url).hostname,'idealmakoo.com');assert.equal(page.language,'fa');assert.equal(page.retrievedAt,'2026-10-17');assert.match(page.id,/^official-page-(\d+|home)$/);}
});


test('the recovered guide exposes 37 diagram rows while unreadable anterior codes and values stay empty',()=>{
 const guide=findReferenceDocument('ideal-makoo-mould-guide');const small=guide.sections.find(section=>section.id==='small-medium-anterior').tables[0];const large=guide.sections.find(section=>section.id==='large-lower-anterior').tables[0];
 assert.equal(small.rows.length,16);assert.equal(large.rows.length,16);assert.equal(guide.sections.flatMap(section=>section.tables??[]).reduce((sum,table)=>sum+table.rows.length,0),37);
 assert.equal(small.rows.find(row=>row.group==='SMALL'&&row.style==='SOFT'&&row.row==='3').code,'');
 const ambiguous=large.rows.find(row=>row.group==='LARGE'&&row.style==='SOFT'&&row.row==='2');assert.equal(ambiguous.width,'');assert.equal(ambiguous.span,'49.6');
 for(const table of [small,large]){assert.match(table.note.en,/hidden PDF text was not used/);assert.match(table.note.en,/not product variants/);assert.ok(table.rows.every(row=>table.columns.every(column=>typeof row[column.key]==='string')));}
});
