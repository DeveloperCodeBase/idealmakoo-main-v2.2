#!/usr/bin/env node
/** Static-export verification. Reads files only; does not start a server or browser. */
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,extname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTs} from '../tests/helpers/load-ts.mjs';
import {pngMatchesDeclaredSize} from './lib/png-dimensions.mjs';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const fileExists=file=>existsSync(file)&&statSync(file).isFile();
const display=file=>relative(projectRoot,file).split(sep).join('/');
const decodeEntities=value=>value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|Tab|NewLine);/gi,(entity,code)=>{
 if(code[0]==='#'){const number=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);return number>0&&number<=0x10ffff?String.fromCodePoint(number):entity;}
 return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',tab:'\t',newline:'\n'})[code.toLowerCase()]??entity;
});
function attributes(text){const result={};const pattern=/(?:^|\s)([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;for(const match of text.matchAll(pattern))result[match[1].toLowerCase()]=decodeEntities(match[2]??match[3]??match[4]??'');return result;}
/** Raw script/style bodies are excluded so strings inside Next's payload cannot become fake HTML links. */
export function parseStartTags(html){const markup=html.replace(/<!--[\s\S]*?-->/g,'').replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi,'$1$2').replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi,'$1$2');return Array.from(markup.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi),match=>({name:match[1].toLowerCase(),attrs:attributes(match[2])}));}
function walk(directory){if(!existsSync(directory))return [];return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(resolve(directory,entry.name)):entry.isFile()?[resolve(directory,entry.name)]:[]);}
function pagePath(file,outDir){const path='/'+relative(outDir,file).split(sep).join('/');return path.endsWith('/index.html')?path.slice(0,-10):path;}
/** Resolve only the requested file or that directory's own index. Never fall back to the site's index or 404. */
export function resolveLocalReference(value,fromPath,outDir,origin){
 const input=decodeEntities(value).trim();
 if(!input||input.startsWith('#')||/^(data|blob|tel|mailto):/i.test(input))return {skip:true};
 if(/^javascript:/i.test(input))return {error:'Executable URL is not an exported resource',path:input};
 let url;try{url=new URL(input,new URL(fromPath,origin));}catch{return {error:'Invalid URL',path:input};}
 if(!['http:','https:'].includes(url.protocol)||url.origin!==new URL(origin).origin)return {skip:true};
 let path;try{path=decodeURIComponent(url.pathname);}catch{return {error:'Invalid URL encoding',path:url.pathname};}
 const candidate=resolve(outDir,'.'+path);const inside=relative(outDir,candidate);
 if(inside==='..'||inside.startsWith('..'+sep)||isAbsolute(inside))return {error:'URL escapes the export directory',path};
 const candidates=[candidate,resolve(candidate,'index.html')];
 // Support an actual flat HTML export too, without treating arbitrary unknown paths as pages.
 if(!extname(candidate))candidates.push(candidate+'.html');
 const file=candidates.find(fileExists);return file?{file,path}:{error:'Missing exported path or asset',path};
}
function noOfferErrors(value,errors=[],trail='schema'){
 if(Array.isArray(value)){value.forEach((item,index)=>noOfferErrors(item,errors,`${trail}[${index}]`));return errors;}
 if(!value||typeof value!=='object')return errors;
 const types=[value['@type']].flat();if(types.some(type=>['Offer','AggregateOffer','PriceSpecification','UnitPriceSpecification'].includes(type)))errors.push(`${trail}: commerce offer type`);
 for(const [key,child]of Object.entries(value)){if(['offers','price','priceCurrency','lowPrice','highPrice','priceSpecification','availability'].includes(key)&&child!=null)errors.push(`${trail}.${key}`);noOfferErrors(child,errors,`${trail}.${key}`);}
 return errors;
}
export async function verifyExport({outDir=resolve(projectRoot,'out'),quiet=false}={}){
 const {sitePaths,adminSections,publicIndexablePaths}=await loadTs('src/lib/routes.ts');
 const {locales,direction,dictionary}=await loadTs('src/lib/i18n.ts');
 const {products,articles,companyPages,resources}=await loadTs('src/data/catalog.ts');
 const {roleNames,blockTypes}=await loadTs('src/components/workspace/i18n.ts');
 const errors=new Map();
 function fail(message,location=''){const entry=errors.get(message)||new Set();if(location)entry.add(location);errors.set(message,entry);}
 const checkFile=(file,label)=>{if(!fileExists(file)){fail(`${label}: ${display(file)}`);return false;}return true;};
 if(!existsSync(outDir))throw new Error(`Static export is missing at ${outDir}. Run npm run build first.`);
 const expectedLocalePaths=new Set(locales.flatMap(locale=>sitePaths.map(path=>`/${locale}/${path}${path?'/':''}`)));
 const expectedAliases=new Set(adminSections.map(path=>`/admin/${path}${path?'/':''}`));
 for(const path of [...expectedLocalePaths,...expectedAliases])checkFile(resolve(outDir,'.'+path,'index.html'),'Missing declared route');
 checkFile(resolve(outDir,'index.html'),'Missing entry page');
 const allFiles=walk(outDir);const htmlFiles=allFiles.filter(file=>file.endsWith('.html'));const cssFiles=allFiles.filter(file=>file.endsWith('.css'));
 let origin=process.env.NEXT_PUBLIC_SITE_URL;
 if(!origin){const first=resolve(outDir,'fa/index.html');if(fileExists(first)){const canonical=parseStartTags(readFileSync(first,'utf8')).find(tag=>tag.name==='link'&&tag.attrs.rel==='canonical');if(canonical?.attrs.href){try{origin=new URL(canonical.attrs.href).origin;}catch{/* Invalid canonical is checked below. */}}}}
 origin=origin||'https://static-export.invalid';
 const publicPaths=new Set(publicIndexablePaths);
 const checkedTargets=new Set();let localReferences=0,skippedReferences=0,localeDocuments=0,publicMetadata=0,schemas=0,productSchemas=0;
 const inspectReference=(value,fromPath,location)=>{const result=resolveLocalReference(value,fromPath,outDir,origin);if(result.skip){skippedReferences++;return;}localReferences++;if(result.error)fail(`${result.error}: ${result.path}`,location);else checkedTargets.add(result.file);};
 for(const locale of locales){
  const manifestPath=`/manifests/${locale}.webmanifest`;
  const file=resolve(outDir,'.'+manifestPath);
  if(checkFile(file,'Missing localized PWA manifest')){
   try{const manifest=JSON.parse(readFileSync(file,'utf8'));if(manifest.lang!==locale||manifest.dir!==direction(locale)||manifest.start_url!==`/${locale}/`||manifest.scope!=='/')fail('Incorrect localized PWA manifest',manifestPath);if(!Array.isArray(manifest.icons)||!manifest.icons.some(icon=>icon.sizes==='192x192')||!manifest.icons.some(icon=>icon.sizes==='512x512'))fail('Missing install icon sizes',manifestPath);for(const icon of manifest.icons||[]){inspectReference(icon.src,manifestPath,manifestPath);if(icon.type==='image/png'){const resolved=resolveLocalReference(icon.src,manifestPath,outDir,origin);if(resolved.file&&!pngMatchesDeclaredSize(readFileSync(resolved.file),icon.sizes))fail('PWA icon PNG dimensions differ from its manifest declaration',manifestPath);}}}catch{fail('Invalid localized PWA manifest',manifestPath);}
  }
 }
 checkFile(resolve(outDir,'service-worker.js'),'Missing public asset Service Worker');
 checkFile(resolve(outDir,'sw-policy.js'),'Missing Service Worker cache policy');
 let sourceArchiveBytes=0;
 const runtimeAssets=['media/brand/logo-transparent.png','media/environment/blue-lagoon-1k.hdr','downloads/idealmakoo-source.zip'];
 for(const asset of runtimeAssets){
  const source=resolve(projectRoot,'public',asset),exported=resolve(outDir,asset);
  if(checkFile(source,'Missing required source runtime asset')&&checkFile(exported,'Missing exported runtime asset')){
   const expected=readFileSync(source),actual=readFileSync(exported);
   const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
   if(hash(expected)!==hash(actual))fail(`Runtime asset export mismatch: ${asset}`);
   if(asset.endsWith('.zip')){sourceArchiveBytes=actual.length;if(actual[0]!==0x50||actual[1]!==0x4b)fail('Source download is not a ZIP archive');}
  }
 }
 for(const file of htmlFiles){
  const html=readFileSync(file,'utf8');const path=pagePath(file,outDir);const tags=parseStartTags(html);const locale=path.split('/')[1];const isLocale=locales.includes(locale);const section=path.split('/').slice(2).join('/').replace(/\/$/,'');
  if(isLocale){localeDocuments++;const roots=tags.filter(tag=>tag.name==='html');if(roots.length!==1||roots[0]?.attrs.lang!==locale||roots[0]?.attrs.dir!==direction(locale))fail(`Incorrect HTML lang/dir: expected ${locale}/${direction(locale)}`,path);}
  if(path.startsWith('/admin/')){const root=tags.find(tag=>tag.name==='html');if(root?.attrs.lang!=='fa'||root?.attrs.dir!=='rtl')fail('Incorrect default admin alias lang/dir: expected fa/rtl',path);}
  for(const tag of tags){
   for(const key of ['href','src','poster','xlink:href'])if(typeof tag.attrs[key]==='string')inspectReference(tag.attrs[key],path,`${path} <${tag.name} ${key}>`);
   for(const key of ['srcset','imagesrcset'])if(tag.attrs[key]&&!tag.attrs[key].trim().startsWith('data:'))for(const candidate of tag.attrs[key].split(',')){const url=candidate.trim().split(/\s+/)[0];if(url)inspectReference(url,path,`${path} <${tag.name} ${key}>`);}
   if(tag.name==='meta'&&['og:image','og:image:url','og:image:secure_url','twitter:image'].includes(tag.attrs.property||tag.attrs.name))inspectReference(tag.attrs.content||'',path,`${path} image metadata`);
   if(tag.name==='meta'&&/(?:product|og):price|product:availability/i.test(tag.attrs.property||tag.attrs.name||''))fail('Public metadata contains an unverified price or availability field',path);
  }
  if(isLocale&&publicPaths.has(section)){
   publicMetadata++;const title=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];const description=tags.find(tag=>tag.name==='meta'&&tag.attrs.name==='description')?.attrs.content;
   if(!title?.trim()||!description?.trim())fail('Missing public title or description metadata',path);
   const canonical=tags.find(tag=>tag.name==='link'&&tag.attrs.rel==='canonical');if(!canonical?.attrs.href)fail('Missing public canonical URL',path);
   const languages=new Set(tags.filter(tag=>tag.name==='link'&&tag.attrs.rel==='alternate').map(tag=>tag.attrs.hreflang));for(const lang of locales)if(!languages.has(lang))fail(`Missing public alternate language: ${lang}`,path);
  }
  for(const match of html.matchAll(/<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi)){
   if(attributes(match[1]).type!=='application/ld+json')continue;schemas++;
   try{const data=JSON.parse(match[2]);for(const problem of noOfferErrors(data))fail(`Unverified commerce metadata: ${problem}`,path);const nodes=Array.isArray(data)?data:[data];if(nodes.some(node=>node?.['@type']==='Product'))productSchemas++;}catch{fail('Malformed JSON-LD metadata',path);}
  }
 }
 // Fonts and images referenced only by exported stylesheets must exist as well.
 for(const file of cssFiles){const path='/'+relative(outDir,file).split(sep).join('/');const css=readFileSync(file,'utf8');for(const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi))inspectReference(match[1]??match[2]??match[3]??'',path,path);}
 const sourceFile=resolve(projectRoot,'docs/SOURCES.json');let sourceInventory={};let sourceAssets=0;
 if(checkFile(sourceFile,'Missing source manifest')){
  try{const source=JSON.parse(readFileSync(sourceFile,'utf8'));sourceInventory=source.inventory||{};
   for(const [key,items,sourceKey,required]of [['products',products,'products',17],['researchArticles',articles,'articles',13],['companyPages',companyPages,'companyPages',10]]){
    if(items.length!==required||sourceInventory[key]!==required)fail(`Incorrect official ${key} count: expected ${required}`);
    const documented=source[sourceKey];if(!Array.isArray(documented)||documented.length!==items.length)fail(`Source manifest count mismatch: ${sourceKey}`);else for(const item of items)if(!documented.some(entry=>entry.id===item.id&&entry.sourceUrl===item.sourceUrl))fail(`Missing matching source: ${item.id}`);
   }
   if(!Array.isArray(source.assets))fail('Source manifest has no asset list');else{sourceAssets=source.assets.length;if(sourceInventory.mediaAssets!==sourceAssets)fail('Source manifest media count mismatch');for(const asset of source.assets){
    if(typeof asset.path!=='string'||!asset.path.startsWith('/media/official/')){fail('Invalid source asset path');continue;}
    const publicFile=resolve(projectRoot,'public','.'+asset.path);const exportedFile=resolve(outDir,'.'+asset.path);
    if(checkFile(publicFile,'Missing original source asset')&&typeof asset.bytes==='number'&&statSync(publicFile).size!==asset.bytes)fail(`Original source asset size mismatch: ${asset.path}`);
    if(checkFile(exportedFile,'Missing exported source asset')&&fileExists(publicFile)&&statSync(exportedFile).size!==statSync(publicFile).size)fail(`Exported source asset size mismatch: ${asset.path}`);
   }}
  }catch(error){fail(`Cannot read source manifest: ${error.message}`);}
 }
 if(resources.length!==30)fail('Incorrect sourced resource count: expected 30');
 for(const resource of resources){const result=resolveLocalReference(resource.url,'/',outDir,origin);if(result.skip||result.error)fail(`Missing local download: ${resource.id}`);if(resource.format==='JPG'&&!/\.jpe?g$/i.test(resource.url))fail(`Download extension does not match actual JPG format: ${resource.id}`);}
 let translations=0;const localizedGroups=[...Object.entries(dictionary),...Object.entries(roleNames),...blockTypes.map(([key,label])=>[`block:${key}`,label]),...products.flatMap(p=>[[`product:${p.id}:name`,p.name],[`product:${p.id}:description`,p.description]]),...articles.map(a=>[`research:${a.id}`,a.title])];
 for(const [key,value]of localizedGroups){translations++;for(const locale of locales)if(typeof value?.[locale]!=='string'||!value[locale].trim())fail(`Missing translation: ${key}/${locale}`);}
 if(productSchemas!==products.length*locales.length)fail(`Product metadata count mismatch: ${productSchemas}, expected ${products.length*locales.length}`);
 const report={declaredLocaleRoutes:expectedLocalePaths.size,adminAliases:expectedAliases.size,htmlFiles:htmlFiles.length,localeDocuments,localReferences,uniqueLocalTargets:checkedTargets.size,skippedExternalOrInlineReferences:skippedReferences,cssFiles:cssFiles.length,publicMetadata,schemas,productSchemas,products:products.length,research:articles.length,companyPages:companyPages.length,sourceAssets,resources:resources.length,runtimeAssets:runtimeAssets.length,sourceArchiveBytes,forbiddenCommerceFields:Array.from(errors.keys()).filter(key=>key.startsWith('Unverified commerce metadata')||key.startsWith('Public metadata contains')).length,localizedLabels:translations,locales:locales.length,failures:errors.size};
 if(!quiet){console.log(`Routes: ${report.declaredLocaleRoutes} in ${report.locales} locales + ${report.adminAliases} admin aliases; ${report.htmlFiles} HTML files.`);console.log(`References: ${report.localReferences} local URLs → ${report.uniqueLocalTargets} existing targets; ${report.cssFiles} stylesheets checked.`);console.log(`Content: ${report.products} products, ${report.research} research entries, ${report.companyPages} company pages, ${report.sourceAssets} original assets, ${report.resources} downloads.`);console.log(`Metadata: ${report.publicMetadata} public pages, ${report.productSchemas} Product schemas, ${report.forbiddenCommerceFields} unverified commerce fields; ${report.localizedLabels} labels × ${report.locales} locales checked.`);
  console.log(`Runtime assets: ${report.runtimeAssets} exact exports; source download ${report.sourceArchiveBytes} bytes.`);
  if(errors.size){console.error(`FAILED: ${errors.size} distinct static-export problems.`);let shown=0;for(const [message,locations]of errors){if(shown++>=60){console.error(`… ${errors.size-60} more problems.`);break;}console.error(`- ${message}${locations.size?' — '+Array.from(locations).slice(0,3).join(', ')+(locations.size>3?` (+${locations.size-3} more)`:''):''}`);}}else console.log('PASS — every declared route, locale document, local reference and source asset is present.');
 }
 return {report,errors};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const index=process.argv.indexOf('--out');const outDir=index>=0?resolve(process.argv[index+1]||'out'):resolve(projectRoot,'out');
 try{const {errors}=await verifyExport({outDir});if(errors.size)process.exitCode=1;}catch(error){console.error(`FAILED: ${error.message}`);process.exitCode=1;}
}
