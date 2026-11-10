import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createElement,useEffect,useRef,useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url);
const {galleryPhotos}=await loadTs('src/lib/gallery-photos.ts');
const {carouselUrl}=await loadTs('src/lib/carousel.ts');
const catalog=[{id:'unrelated-product',slug:'unrelated-product',image:'/media/unrelated-product.jpg',brand:'Unrelated',name:{fa:'کالا',en:'Product',tr:'Ürün',ar:'منتج',ru:'Продукт'}}];
const base={id:'authored-gallery',type:'gallery',title:'Authored gallery',body:'',mediaUrl:undefined};
const empty=()=>null;

// Follow the repository's source-template render tests: compile the actual
// exported render functions, with their real hooks and the real shared parser.
function actualFunction(file,name,context,variables=[]){
 const source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn,`Render the actual ${file}:${name}`);
 const declarations=source.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>variables.includes(value.name.getText(source))));assert.equal(declarations.length,variables.length);
 const code=declarations.map(node=>node.getText(source)).join('\n')+'\nexport const probe='+fn.getText(source).replace(/^export\s+/,'');
 const exports={};runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require,...context});return exports.probe;
}
function renderBoth(block,locale='en'){
 const GalleryPreview=actualFunction('src/components/workspace/GalleryPreview.tsx','GalleryPreview',{galleryPhotos,useEffect,useState});
 const shared={galleryPhotos,GalleryPreview,carouselUrl,useRef,useState,usePublications:()=>[],ArrowUpRight:empty,Download:empty};
 const Preview=actualFunction('src/components/workspace/CMS.tsx','BlockPreview',{...shared,officialProducts:catalog,localized:(value,language)=>typeof value==='string'?value:value[language],productPath:product=>'products/'+product.slug,localizedPath:(language,path)=>'/'+language+'/'+path,wt:key=>key,safeUrl:value=>Boolean(value&&carouselUrl(value)),ImageIcon:empty});
 const Public=actualFunction('src/components/site/PublicationRenderer.tsx','PublicationBlocks',{...shared,useApp:()=>({locale,t:key=>key,href:path=>'/'+locale+'/'+path}),useCatalogProducts:()=>catalog},['safeLink','safeMedia']);
 return{preview:renderToStaticMarkup(createElement(Preview,{block,locale,catalog})),public:renderToStaticMarkup(createElement(Public,{blocks:[block]}))};
}
function images(html){return [...html.matchAll(/<img\b[^>]*>/g)].map(([tag])=>Object.fromEntries(['src','alt'].map(name=>[name,tag.match(new RegExp('\\b'+name+'="([^"]*)"'))?.[1]||''])));}
function expectPhotos(rendered,photos){
 const expected=photos.map(photo=>({src:photo.url,alt:photo.caption}));
 assert.deepEqual(images(rendered.preview),expected);
 assert.deepEqual(images(rendered.public),expected);
 for(const html of Object.values(rendered)){
  assert.doesNotMatch(html,/unrelated-product/);
  for(const photo of photos)if(photo.caption)assert.ok(html.includes(renderToStaticMarkup(createElement('figcaption',null,photo.caption))));
 }
 assert.match(rendered.preview,/class="ws-preview-gallery"/);
 assert.match(rendered.public,/class="published-gallery"/);
}

test('editor gallery renders authored image order and captions exactly as publication in every locale',()=>{
 for(const locale of ['fa','en','tr','ar','ru']){
  const block={...base,body:'  /media/authored-one.webp | First caption\n\nhttps://images.example.test/two.png | Second | Detail  ',mediaUrl:'/media/unused-fallback.jpg'};
  const rendered=renderBoth(block,locale);
  expectPhotos(rendered,[{url:'/media/authored-one.webp',caption:'First caption'},{url:'https://images.example.test/two.png',caption:'Second  |  Detail'}]);
  for(const html of Object.values(rendered)){assert.doesNotMatch(html,/unused-fallback/);assert.doesNotMatch(html,/<p>\s*\/media\/authored-one/);}
 }
});
test('gallery ignores unsafe authored URLs and uses the valid authored row before the fallback',()=>{
 const rendered=renderBoth({...base,body:'javascript:alert(1) | Unsafe\n//elsewhere.invalid/image.png | Unsafe\ndata:text/html,unsafe | Unsafe\n/media/real.png | Reviewed',mediaUrl:'/media/fallback.png'});
 expectPhotos(rendered,[{url:'/media/real.png',caption:'Reviewed'}]);
 for(const html of Object.values(rendered))assert.doesNotMatch(html,/javascript:|elsewhere\.invalid|data:text\/html|fallback\.png/);
});
test('gallery falls back to the authored single image and title only when no valid rows remain',()=>{
 for(const body of ['', ' \n\t ', 'javascript:alert(1) | Rejected'])expectPhotos(renderBoth({...base,title:'Fallback caption',body,mediaUrl:'/media/fallback.webp'}),[{url:'/media/fallback.webp',caption:'Fallback caption'}]);
});
test('an empty gallery or unsafe fallback never substitutes unrelated catalogue images',()=>{
 for(const mediaUrl of [undefined,'javascript:alert(1)','//elsewhere.invalid/no.png','data:text/html,unsafe'])expectPhotos(renderBoth({...base,body:'javascript:alert(1) | Rejected',mediaUrl}),[]);
});
test('gallery preserves accepted data-image rows and escapes authored caption text',()=>{
 const caption='<script>alert(1)</script> & caption';
 const rendered=renderBoth({...base,body:'data:image/png;base64,AAAA | '+caption});
 for(const html of Object.values(rendered)){
  assert.match(html,/src="data:image\/png;base64,AAAA"/);
  assert.ok(html.includes(renderToStaticMarkup(createElement('figcaption',null,caption))));
  assert.doesNotMatch(html,/<script>|<p>data:image/);
 }
 assert.deepEqual(images(rendered.preview),images(rendered.public));
});
