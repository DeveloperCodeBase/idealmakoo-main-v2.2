import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url);
const {getImgProps}=require('next/dist/shared/lib/get-img-props.js');
const {imageConfigDefault}=require('next/dist/shared/lib/image-config.js');
const defaultLoader=require('next/dist/shared/lib/image-loader.js').default;
const {hasLocalMatch}=require('next/dist/shared/lib/match-local-pattern.js');
const configUrl=new URL('../next.config.ts',import.meta.url),exports={};
const uploadPolicy=await loadTs('src/lib/upload-policy.ts'),configRequire=createRequire(configUrl);
runInNewContext(ts.transpileModule(readFileSync(configUrl,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:name=>name==='./src/lib/upload-policy'?uploadPolicy:configRequire(name)});
const configured=JSON.parse(JSON.stringify(exports.default.images));
const dimensions=JSON.parse(readFileSync(new URL('../src/data/public-image-dimensions.json',import.meta.url),'utf8'));
const source=ts.createSourceFile('Carousel.tsx',readFileSync(new URL('../src/components/site/Carousel.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const poster=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Poster');
let posterSizes;
function visit(node){if(ts.isJsxAttribute(node)&&node.name.text==='sizes'&&node.initializer&&ts.isStringLiteral(node.initializer))posterSizes=node.initializer.text;ts.forEachChild(node,visit);}
visit(poster);
function generated(images){
 const config={...imageConfigDefault,...images};
 config.allSizes=[...config.deviceSizes,...config.imageSizes].sort((a,b)=>a-b);
 return getImgProps({src:'/media/official/1689235260.jpg',alt:'',width:1000,height:1547,sizes:posterSizes,loading:'eager',fetchPriority:'high'},{imgConf:config,defaultLoader}).props;
}
const candidates=props=>props.srcSet.split(', ').map(value=>{const [url,descriptor]=value.split(' ');return {url:new URL(url,'https://example.test'),width:Number(descriptor.slice(0,-1))};});

test('real Next image props offer a fitting 480px candidate for the existing mobile carousel slot',()=>{
 assert.ok(posterSizes,'Read the actual Poster sizes hint, not a fixture copy.');
 const original=generated({}),updated=generated(configured),before=candidates(original),after=candidates(updated);
 const mobileVw=Number(posterSizes.match(/^\(max-width:\s*700px\)\s*(\d+)vw/)?.[1]);
 assert.ok(Number.isFinite(mobileVw));
 const requiredWidth=412*mobileVw/100*1.75;
 assert.ok(requiredWidth>384&&requiredWidth<=480,'The observed mobile slot needs more than 384 source pixels and is fully covered by 480.');
 assert.equal(before.find(candidate=>candidate.width>=requiredWidth)?.width,640);
 assert.equal(after.find(candidate=>candidate.width>=requiredWidth)?.width,480);
 assert.deepEqual(after.filter(candidate=>candidate.width!==480).map(candidate=>candidate.width),before.map(candidate=>candidate.width),'All existing higher-density/fullscreen candidates remain available.');
 assert.equal(updated.sizes,original.sizes);assert.equal(updated.width,original.width);assert.equal(updated.height,original.height);
 assert.equal(updated.loading,'eager');assert.equal(updated.fetchPriority,'high');
 for(const candidate of after){assert.equal(candidate.url.searchParams.get('q'),'75');assert.equal(candidate.url.searchParams.get('url'),'/media/official/1689235260.jpg');assert.equal(Number(candidate.url.searchParams.get('w')),candidate.width);}
});

test('the additional public image width preserves the exact bundled-path, format and quality restrictions',()=>{
 assert.deepEqual(configured.imageSizes,[...imageConfigDefault.imageSizes,480]);
 assert.equal(configured.deviceSizes,undefined,'Default larger device widths stay unchanged.');
 assert.deepEqual(configured.formats,['image/webp']);assert.deepEqual(configured.qualities,[75]);assert.deepEqual(configured.remotePatterns,[]);
 for(const src of Object.keys(dimensions))assert.equal(hasLocalMatch(configured.localPatterns,src),true,src);
 for(const src of ['/api/v1/media/private/content','/media/official/not-a-manifest-file.png','/media/brand/logo-transparent.png?private=true','/media/official/../../api/v1/auth/session','/media/official/%2e%2e/%2e%2e/api/v1/auth/session','/media/brand/%6cogo-transparent.png'])assert.equal(hasLocalMatch(configured.localPatterns,src),false,src);
});
