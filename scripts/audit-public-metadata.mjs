import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolveStreamedMain} from './lib/audit-streamed-html.mjs';
import {normalizeCanonicalOrigin,metadataIdentityErrors} from './lib/public-audit-identity.mjs';
import {metadataEditorialReview} from './lib/metadata-editorial-review.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const options={};
for(let index=2;index<process.argv.length;index+=2){const key=process.argv[index],value=process.argv[index+1];if(!['--run','--output','--concurrency','--canonical-origin'].includes(key)||!value)throw new Error('Usage: node scripts/audit-public-metadata.mjs --run LIGHTHOUSE_DIRECTORY --output REPORT_DIRECTORY [--concurrency 4] [--canonical-origin https://PUBLIC-DOMAIN]');options[key.slice(2)]=value;}
if(!options.run||!options.output)throw new Error('--run and --output are required. First create the Lighthouse inventory with --inventory-only.');
const directory=path.resolve(options.run),output=path.resolve(options.output),concurrency=Number(options.concurrency||4);
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('Concurrency must be from 1 to 8; never run during a performance measurement.');
const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
const expectedCanonicalOrigin=normalizeCanonicalOrigin(options['canonical-origin']??manifest.config.baseUrl);
const inventory=JSON.parse(await fs.readFile(path.join(directory,'inventory.json'),'utf8'));
const jobs=[...new Map([...(inventory.redirects||[]),...inventory.jobs].map(job=>[job.url,job])).values()];
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const decode=value=>value.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,decimal)=>String.fromCodePoint(Number.parseInt(hex||decimal,hex?16:10))).replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&apos;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
function attributes(tag){return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)].map(match=>[match[1].toLowerCase(),decode(match[2]??match[3]??match[4])]));}
const text=value=>decode(value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
const privatePath=/^\/(?:fa|en|tr|ar|ru)\/(?:api|admin|account|auth|page|published|feedback|saved-share|communication-preferences|communication-verification|communication-unsubscribe)(?:\/|$)/;
async function identity(){
 const buildId=(await fs.readFile(path.join(root,'.next/BUILD_ID'),'utf8').catch(()=>process.env.AUDIT_BUILD_ID||'')).trim();
 const response=await fetch(manifest.config.baseUrl+'/api/v1/site',{signal:AbortSignal.timeout(30000),redirect:'error'});
 if(response.status!==200)throw new Error('Public content identity unavailable.');
 const {version,observedAt,...publicContent}=await response.json();
 if(buildId!==manifest.config.buildId||sha(publicContent)!==manifest.config.publicContentHash)throw new Error('Build or published content no longer matches the audit inventory. Create a new inventory/output after content changes.');
}
await identity();await fs.mkdir(output,{recursive:true});
let cursor=0;const records=[];
async function inspect(job){
 const started=Date.now(),errors=[],warnings=[];const record={url:job.url,kind:job.kind,indexed:job.indexed,expectedStatus:job.expectedStatus,errors,warnings};
 try{
  const response=await fetch(job.url,{redirect:'manual',signal:AbortSignal.timeout(30000)});
  const html=await response.text();Object.assign(record,{httpStatus:response.status,location:response.headers.get('location'),contentType:response.headers.get('content-type'),htmlHash:sha(html)});
  if(response.status!==job.expectedStatus)errors.push(`HTTP ${response.status}; expected ${job.expectedStatus}.`);
  if(job.kind==='public-redirect'){
   record.expectedLocation=job.expectedLocation;
   try{if(new URL(record.location||'',job.url).href!==job.expectedLocation)errors.push('Canonical redirect does not match its released destination.');}catch{errors.push('Canonical redirect location is invalid.');}
   record.durationMs=Date.now()-started;records.push(record);
   await fs.writeFile(path.join(output,sha(job.url).slice(0,16)+'.json'),JSON.stringify(record,null,2));
   if(errors.length)console.log(JSON.stringify({event:'redirect',url:job.url,errors}));
   return;
  }
  const htmlAttributes=attributes(html.match(/<html\b[^>]*>/i)?.[0]||'');
  const meta=[...html.matchAll(/<meta\b[^>]*>/gi)].map(match=>attributes(match[0]));
  const links=[...html.matchAll(/<link\b[^>]*>/gi)].map(match=>attributes(match[0]));
  const titles=[...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map(match=>text(match[1]));
  const descriptions=meta.filter(row=>row.name==='description').map(row=>row.content||'');
  const canonicals=links.filter(row=>row.rel==='canonical').map(row=>row.href);
  const alternates=Object.fromEntries(links.filter(row=>row.rel==='alternate'&&row.hreflang).map(row=>[row.hreflang,row.href]));
  const robots=[...meta.filter(row=>['robots','googlebot'].includes(row.name)).map(row=>row.content),response.headers.get('x-robots-tag')||''].filter(Boolean);
  const locale=new URL(job.url).pathname.split('/')[1],noindex=robots.some(value=>/\bnoindex\b/i.test(value));
  Object.assign(record,{locale,lang:htmlAttributes.lang,dir:htmlAttributes.dir,titles,descriptions,canonicals,alternates,robots,noindex});
  if(response.status===200){
   if(htmlAttributes.lang!==locale)errors.push('Document language does not match its URL.');
   if(htmlAttributes.dir!==(['fa','ar'].includes(locale)?'rtl':'ltr'))errors.push('Document writing direction does not match its language.');
   if(titles.length!==1||!titles[0])errors.push('Expected one nonempty document title.');
   if(job.indexed){
    if(noindex)errors.push('Sitemap page is noindex.');
    if(descriptions.length!==1||!descriptions[0])errors.push('Indexed page must have one nonempty description.');
    if(canonicals.length!==1)errors.push('Indexed page must have one canonical.');
    if(!alternates[locale])errors.push('Indexed page is missing its self hreflang.');
   }
   if(job.kind==='public-auth'&&!noindex)errors.push('Authentication document must be noindex.');
   if(job.expectedNoindex&&!noindex)errors.push('The released route SEO settings require noindex.');
  }
  if(job.kind==='expected-404'&&!noindex)errors.push('The missing-page response must be noindex.');
  for(const [kind,href]of [...canonicals.map(href=>['canonical',href]),...Object.entries(alternates)]){
   try{const url=new URL(href);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)errors.push(`Unsafe ${kind} URL.`);if(job.indexed&&privatePath.test(url.pathname))errors.push(`Private route exposed through ${kind}.`);}catch{errors.push(`Invalid absolute ${kind} URL.`);}
  }
  const structured=[],schemaTypes=[],scriptPolicy=(response.headers.get('content-security-policy')||'').split(';').find(value=>value.trim().startsWith('script-src '))||'';
  const responseNonces=[...scriptPolicy.matchAll(/'nonce-([^']+)'/g)].map(match=>match[1]);
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   const attrs=attributes(match[1]);if(attrs.type!=='application/ld+json')continue;
   try{const value=JSON.parse(match[2]);structured.push(value);if(!attrs.nonce)errors.push('JSON-LD script is missing its CSP nonce.');else if(!responseNonces.includes(attrs.nonce))errors.push('JSON-LD nonce does not match this response CSP.');}catch{errors.push('Malformed JSON-LD.');}
  }
  function visit(value){
   if(Array.isArray(value)){value.forEach(visit);return;}if(!value||typeof value!=='object')return;
   const types=Array.isArray(value['@type'])?value['@type']:[value['@type']];for(const type of types)if(type)schemaTypes.push(type);
   if(types.includes('Product')){if(!value.name)errors.push('Product schema has no name.');if(value.offers||value.aggregateRating)errors.push('B2B source product schema must not invent offers or ratings.');}
   if(value.inLanguage&&typeof value.inLanguage==='string'&&!value.inLanguage.toLowerCase().startsWith(locale))warnings.push(`Structured data language differs: ${value.inLanguage}.`);
   Object.values(value).forEach(visit);
  }
  structured.forEach(visit);record.schemaTypes=[...new Set(schemaTypes)];record.structuredData=structured;
  const resolvedMain=resolveStreamedMain(html),main=resolvedMain.mainHtml;
  record.streaming=resolvedMain.streaming;record.mainCount=resolvedMain.mainCount;
  errors.push(...resolvedMain.errors);warnings.push(...resolvedMain.warnings);
  const visible=text(main.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''));
  record.h1Count=resolvedMain.h1Count;
  if(response.status===200&&record.mainCount!==1)warnings.push(`Main landmark count is ${record.mainCount}.`);
  if(response.status===200&&record.h1Count!==1)warnings.push(`Main heading count is ${record.h1Count}.`);
  if(['en','tr','ru'].includes(locale)){
   const matches=[...visible.matchAll(/[\u0600-\u06ff]+/g)];record.arabicScriptCharacters=matches.reduce((sum,match)=>sum+match[0].length,0);
   if(matches.length){record.scriptReviewSamples=matches.slice(0,8).map(match=>visible.slice(Math.max(0,match.index-35),match.index+match[0].length+35));warnings.push('Arabic-script text in a non-Arabic-script locale needs a human review for quoted names or untranslated body.');}
  }
 }catch(error){errors.push(String(error.message||error));}
 record.durationMs=Date.now()-started;records.push(record);
 // Retain inspected evidence if the crawl or final build/content check fails.
 await fs.writeFile(path.join(output,sha(job.url).slice(0,16)+'.json'),JSON.stringify(record,null,2));
 if(records.length%50===0||errors.length)console.log(JSON.stringify({event:'metadata',checked:records.length,expected:jobs.length,url:job.url,errors,warnings}));
}
await Promise.all(Array.from({length:concurrency},async()=>{for(;;){const index=cursor++;if(index>=jobs.length)return;await inspect(jobs[index]);}}));
await identity();
metadataIdentityErrors(records,expectedCanonicalOrigin).forEach((errors,index)=>records[index].errors.push(...errors));
const editorialReview=metadataEditorialReview(records);
for(const [field,groups]of [['title',editorialReview.titles],['description',editorialReview.descriptions]])for(const group of groups){
 const urls=new Set(group.urls);for(const record of records)if(urls.has(record.url))record.warnings.push(`Duplicate ${field} on ${group.urls.length} indexable destinations in ${group.locale}; review page-specific editorial metadata.`);
}
records.sort((a,b)=>a.url.localeCompare(b.url,'en'));
// Per-page evidence must include the same final reciprocity errors as summary.
for(const record of records)await fs.writeFile(path.join(output,sha(record.url).slice(0,16)+'.json'),JSON.stringify(record,null,2));
const summary={createdAt:new Date().toISOString(),buildId:manifest.config.buildId,publicContentHash:manifest.config.publicContentHash,inventoryHash:manifest.config.inventoryHash,expectedCanonicalOrigin,expected:jobs.length,checked:records.length,coverageComplete:records.length===jobs.length,passed:records.filter(record=>!record.errors.length).length,errors:records.filter(record=>record.errors.length).length,warnings:records.filter(record=>record.warnings.length).length,editorialReview,note:'HTTP/HTML/JSON-LD/reciprocity validation and duplicate-metadata review. This is not a Lighthouse score, full editorial review or Google Rich Results test.',records};
await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({event:'summary',output,expected:summary.expected,checked:summary.checked,passed:summary.passed,errors:summary.errors,warnings:summary.warnings,buildId:summary.buildId}));
if(summary.errors)process.exitCode=2;
