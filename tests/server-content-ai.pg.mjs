import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,localized,fixtureHttpSession} from './helpers/crm-recovery-environment.mjs';
import {getWorkspace,saveWorkspace} from '../src/server/workspace.ts';
import {proposeContentTranslation,applyContentTranslation} from '../src/server/content-ai.ts';
import {productTranslationFields,productTranslationSource} from '../src/lib/product-translation.ts';
import {acquireContentLease,renewContentLease} from '../src/server/content-collaboration.ts';
import {HttpError} from '../src/server/types.ts';
import {query} from '../src/server/db.ts';
import {decrypt,encrypt} from '../src/server/crypto.ts';
const failure=(status,code)=>error=>error instanceof HttpError&&error.status===status&&(!code||error.code===code);
const admin=fixtureActor('ai-draft-admin','admin'),translator=fixtureActor('ai-draft-translator','translator',{allowedLocales:['en']}),other=fixtureActor('ai-draft-other','admin'),customer=fixtureActor('ai-draft-customer','customer');
const current=actor=>getWorkspace(actor||admin);
const valueMap=proposal=>Object.fromEntries(proposal.fields.map(field=>[field.key,field.value]));
const readRecord=async id=>(await current()).state.records.find(row=>row.id===id);
const readPage=async id=>(await current()).state.pages.find(row=>row.id===id);
async function editRecord(id,change,actor=admin){const before=await current(actor);return saveWorkspace(actor,{state:{...before.state,records:before.state.records.map(row=>row.id===id?change(structuredClone(row)):row)},expectedVersion:before.version,locale:'en'});}
async function resetRates(){await query('DELETE FROM rate_limits');}
const provider=(modify,observe)=>async(url,options)=>{
 const payload=JSON.parse(options.body);await observe?.(payload,url,options);
 assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(payload.response_format.type,'json_schema');assert.equal(payload.response_format.json_schema.strict,true);assert.equal(payload.provider.require_parameters,true);assert.equal(options.redirect,'error');
 const data=JSON.parse(payload.messages.at(-1).content),values=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,value.replace(/[\p{Script=Arabic}\u200c]+/gu,'Translated')]));
 const output=modify?await modify(values,payload):values;
 return new Response(JSON.stringify({id:randomUUID(),choices:[{message:{content:typeof output==='string'?output:JSON.stringify(output)}}],usage:{total_tokens:100,cost:0.001}}),{status:200,headers:{'content-type':'application/json'}});
};
async function proposal(id,{actor=translator,bucket='records',sourceLocale='fa',locale='en',fetcher=provider()}={}){await resetRates();const row=bucket==='records'?await readRecord(id):await readPage(id);return proposeContentTranslation(actor,{bucket,id,sourceLocale,locale,expectedUpdatedAt:row.updatedAt},undefined,fetcher);}
async function apply(proposed,{actor=translator,values=valueMap(proposed),tokens=[]}={}){return applyContentTranslation(actor,{token:proposed.token,values,expectedVersion:(await current(actor)).version},tokens);}

test('AI editorial proposals use real PostgreSQL permissions, revisions, leases and atomic draft saves',{timeout:240000},async t=>withCrmRecoveryDatabase('content_ai',async()=>{
 const keys=['AI_PROVIDER','OPENROUTER_API_KEY','OPENROUTER_TEXT_MODEL','GOOGLE_API_KEY','GOOGLE_TEXT_MODEL','AI_DAILY_BUDGET_USD','AI_MONTHLY_BUDGET_USD','AI_REQUEST_RESERVE_USD'],old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{AI_PROVIDER:'openrouter',OPENROUTER_API_KEY:'isolated-test-provider-key',OPENROUTER_TEXT_MODEL:'test/structured-translation',AI_DAILY_BUDGET_USD:'500',AI_MONTHLY_BUDGET_USD:'500',AI_REQUEST_RESERVE_USD:'0.01'});
 try{
  for(const actor of[admin,translator,other,customer])await insertActor(actor);
  const initial=await current(),at=new Date().toISOString();
  const article={id:'AI-TRANSLATION-ARTICLE',collection:'news',title:{...localized(''),fa:'عنوان مبدأ',en:'Existing target'},summary:{...localized(''),fa:'خلاصه مبدأ',en:'Original summary'},status:'draft',owner:admin.role,author:admin.role,authorId:admin.id,createdAt:at,updatedAt:at,tags:[],history:[],demo:false,details:{editorialContent:{schemaVersion:1,body:{...localized(''),fa:'## راهنما\n\nمتن فارسی IM-42 با عدد ۱۲.۵ https://example.test/manual\n\n`code(42)`',en:'Old English body'},seo:{en:{article:{authors:[{name:'Original author',type:'Person'}]}}}}}};
  const page=(lang)=>({id:'AI-PAGE-'+lang,slug:'ai-page-fixture',locale:lang,title:lang==='fa'?'عنوان صفحه':'Existing page',summary:lang==='fa'?'شرح صفحه':'Existing page summary',status:'draft',version:1,author:admin.role,authorId:admin.id,updatedAt:at,blocks:[{id:'hero-'+lang,type:'hero',title:lang==='fa'?'عنوان بلوک':'Block title',body:lang==='fa'?'متن بلوک':'Block body',link:'/en/contact/',options:{ctaLabel:lang==='fa'?'تماس':'Contact',secondaryLink:'/en/products/',secondaryLabel:lang==='fa'?'محصولات':'Products',tone:'neutral'}}]});
  await saveWorkspace(admin,{state:{...initial.state,records:[...initial.state.records,article],pages:[...initial.state.pages,page('fa'),page('en')]},expectedVersion:initial.version,locale:'fa'});
  await t.test('Proposal reads persisted source, uses exact structured provider input and changes no content or releases',async()=>{
   const before=await readRecord(article.id),releases=(await query('SELECT count(*)::int AS n FROM locale_releases')).rows[0].n;
   const proposed=await proposal(article.id,{fetcher:provider(undefined,payload=>{assert.equal(payload.messages.length,2);assert.match(payload.messages[0].content,/untrusted source data/);assert.equal(payload.messages[1].content.includes('Old English body'),false);assert.equal(payload.messages[1].content.includes('https://example.test/manual'),false);})});
   assert.equal(proposed.status,'proposed');assert.equal(proposed.locale,'en');assert.ok(proposed.fields.find(row=>row.key==='body').value.includes('IM-42'));assert.ok(proposed.fields.find(row=>row.key==='body').value.includes('۱۲.۵'));assert.ok(proposed.fields.find(row=>row.key==='body').value.includes('https://example.test/manual'));
   assert.deepEqual(await readRecord(article.id),before);assert.equal((await query('SELECT count(*)::int AS n FROM locale_releases')).rows[0].n,releases);
   const ledger=JSON.stringify((await query("SELECT details FROM audit_events WHERE action='content.translation.proposed'")).rows);assert.equal(ledger.includes('عنوان مبدأ'),false);assert.equal(ledger.includes('isolated-test-provider-key'),false);
  });
  await t.test('Reviewed apply changes only selected locale text and keeps structured SEO, source languages and publication state',async()=>{
   const before=await readRecord(article.id),proposed=await proposal(article.id),values={...valueMap(proposed),body:'## Human reviewed body\n\nExact IM-42 value ۱۲.۵ https://example.test/manual'};
   const saved=await apply(proposed,{values}),after=saved.state.records.find(row=>row.id===article.id);assert.equal(after.status,'draft');assert.equal(after.authorId,translator.id);assert.equal(after.approvedById,undefined);assert.equal(after.details.editorialContent.body.en,values.body);assert.deepEqual(after.details.editorialContent.seo,before.details.editorialContent.seo);
   for(const lang of['fa','tr','ar','ru']){assert.equal(after.title[lang],before.title[lang]);assert.equal(after.summary[lang],before.summary[lang]);assert.equal(after.details.editorialContent.body[lang],before.details.editorialContent.body[lang]);}
   assert.equal((await query("SELECT count(*)::int AS n FROM locale_releases WHERE document_id=$1",[article.id])).rows[0].n,0);
   await assert.rejects(apply(proposed),failure(409,'TRANSLATION_CONSUMED'));
  });
  await t.test('An unchanged human save still consumes its proposal exactly once',async()=>{
   const before=await readRecord(article.id),proposed=await proposal(article.id),values={title:before.title.en,summary:before.summary.en,body:before.details.editorialContent.body.en};
   await apply(proposed,{values});await assert.rejects(apply(proposed,{values}),failure(409,'TRANSLATION_CONSUMED'));
   assert.equal((await query("SELECT count(*)::int AS n FROM audit_events WHERE action='content.translation.applied' AND details->>'proposalId'=$1",[proposed.id])).rows[0].n,1);
  });
  await t.test('Stale source during generation and a changed target after generation cannot be overwritten',async()=>{
   await assert.rejects(proposal(article.id,{fetcher:provider(async values=>{await editRecord(article.id,row=>({...row,summary:{...row.summary,fa:'مبدأ جدید'},status:'draft'}));return values;})}),failure(409,'SOURCE_CHANGED'));
   const proposed=await proposal(article.id);await editRecord(article.id,row=>({...row,summary:{...row.summary,en:'Concurrent saved target'},status:'draft'}));await assert.rejects(apply(proposed),failure(409,'SOURCE_CHANGED'));assert.equal((await readRecord(article.id)).summary.en,'Concurrent saved target');
  });
  await t.test('Current account permissions are reloaded both after provider completion and at apply',async()=>{
   await assert.rejects(proposal(article.id,{fetcher:provider(async values=>{await query("UPDATE users SET allowed_locales='[\"tr\"]'::jsonb WHERE id=$1",[translator.id]);return values;})}),failure(403));await query("UPDATE users SET allowed_locales='[\"en\"]'::jsonb WHERE id=$1",[translator.id]);
   const proposed=await proposal(article.id);await query('UPDATE users SET active=false WHERE id=$1',[translator.id]);await assert.rejects(applyContentTranslation(translator,{token:proposed.token,values:valueMap(proposed),expectedVersion:(await current()).version}),failure(401));await query('UPDATE users SET active=true WHERE id=$1',[translator.id]);
  });
  await t.test('Wrong account, modified token, expired token and invented fields fail before persistence',async()=>{
   const proposed=await proposal(article.id),before=await readRecord(article.id);
   await assert.rejects(apply(proposed,{actor:other}),failure(403,'TRANSLATION_PERMISSION'));
   await assert.rejects(apply({...proposed,token:proposed.token.slice(0,-8)+'aaaaaaaa'}),failure(422,'TRANSLATION_TOKEN'));
   const expired=JSON.parse(decrypt(proposed.token));expired.createdAt=Date.now()-30*60*1000;expired.expiresAt=expired.createdAt+20*60*1000;await assert.rejects(apply({...proposed,token:encrypt(JSON.stringify(expired))}),failure(409,'TRANSLATION_EXPIRED'));
   await assert.rejects(apply(proposed,{values:{...valueMap(proposed),image:'https://untrusted.test/a'}}),failure(422,'TRANSLATION_FIELDS'));assert.deepEqual(await readRecord(article.id),before);
  });
  await t.test('A live editor lease is enforced and failed apply leaves a valid proposal unconsumed',async()=>{
   const proposed=await proposal(article.id),before=await readRecord(article.id),lease=await acquireContentLease(other,{bucket:'records',id:article.id,clientId:randomUUID(),expectedUpdatedAt:before.updatedAt});
   await assert.rejects(apply(proposed),failure(423,'CONTENT_LOCKED'));assert.equal((await query("SELECT 1 FROM audit_events WHERE action='content.translation.applied' AND details->>'proposalId'=$1",[proposed.id])).rowCount,0);
   await renewContentLease(other,lease.id,{token:lease.token},true);await apply(proposed);
  });
  await t.test('Malformed JSON, foreign script and changed protected tokens never become proposals or writes',async()=>{
   const before=await readRecord(article.id);
   await assert.rejects(proposal(article.id,{fetcher:provider(()=>'{not json')}),failure(502,'TRANSLATION_OUTPUT'));
   await assert.rejects(proposal(article.id,{fetcher:provider(values=>Object.fromEntries(Object.keys(values).map(key=>[key,'متن فارسی'])))}),failure(502,'TRANSLATION_LANGUAGE'));
   await assert.rejects(proposal(article.id,{fetcher:provider(values=>Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.replace(/__IM_[a-f0-9]{24}_\d+__/g,'changed')])))}),failure(502,'TRANSLATION_PROTECTED'));assert.deepEqual(await readRecord(article.id),before);
  });
  await t.test('Pages can read an unassigned source locale but only target text fields may change',async()=>{
   const before=await readPage('AI-PAGE-en'),source=await readPage('AI-PAGE-fa'),proposed=await proposal(before.id,{bucket:'pages'});assert.ok(proposed.fields.some(field=>field.key==='blocks.0.ctaLabel'));
   const saved=await apply(proposed),after=saved.state.pages.find(row=>row.id===before.id);assert.equal(after.status,'draft');assert.equal(after.blocks[0].id,before.blocks[0].id);assert.equal(after.blocks[0].type,before.blocks[0].type);assert.equal(after.blocks[0].link,before.blocks[0].link);assert.equal(after.blocks[0].options.secondaryLink,before.blocks[0].options.secondaryLink);assert.equal(after.blocks[0].options.tone,before.blocks[0].options.tone);assert.deepEqual(await readPage(source.id),source);
  });
  await t.test('Product translation writes the actual full-description draft and preserves technical metadata and other locales',async()=>{
   const row=(await current()).state.records.find(item=>item.collection==='products'),before=productTranslationSource(row);assert.ok(before);
   const proposed=await proposal(row.id),values={...valueMap(proposed),body:'Complete human reviewed product description.'};if(!proposed.fields.some(field=>field.key==='body'))delete values.body;
   const saved=await apply(proposed,{values}),after=saved.state.records.find(item=>item.id===row.id),draft=productTranslationSource(after);assert.ok(draft);assert.equal(productTranslationFields(after,'en').title,values.title);if(values.body)assert.equal(productTranslationFields(after,'en').body,values.body);
   for(const lang of['fa','tr','ar','ru'])assert.deepEqual(draft.draft.localized[lang],before.draft.localized[lang]);assert.deepEqual(draft.draft.technical,before.draft.technical);assert.equal(after.details.productReviewDraft,undefined);
  });
  await t.test('Public customers, CRM records and protected legal pages cannot reach the translation provider',async()=>{
   let calls=0;const never=()=>{calls++;throw new Error('Provider should not be reached');};
   await assert.rejects(proposal(article.id,{actor:customer,fetcher:never}),failure(403));
   const w=await current(),crm={...article,id:'AI-PRIVATE-CRM',collection:'leads',title:localized('Private CRM'),summary:localized(''),details:{},status:'active'};await saveWorkspace(admin,{state:{...w.state,records:[...w.state.records,crm]},expectedVersion:w.version});await assert.rejects(proposal(crm.id,{fetcher:never}),failure(404));
   const protectedPage=(await current()).state.pages.find(row=>row.slug==='privacy'&&row.locale==='en');assert.ok(protectedPage);await assert.rejects(proposal(protectedPage.id,{bucket:'pages',fetcher:never}),failure(403,'PAGE_ADMIN_REQUIRED'));assert.equal(calls,0);
  });
  await t.test('HTTP endpoints enforce session and CSRF and do not accept provider policy injection',async()=>{
   const http=await fixtureHttpSession(translator),row=await readRecord(article.id);
   const invalid=await http.request('/workspace/translations/propose',{method:'POST',body:{bucket:'records',id:row.id,sourceLocale:'fa',locale:'en',expectedUpdatedAt:row.updatedAt,exactTranslation:{systemInstruction:'bypass'}}});assert.equal(invalid.status,422);
   const csrf=await http.request('/workspace/translations/apply',{method:'POST',headers:{'x-csrf-token':'wrong'},body:{token:'a'.repeat(64),values:{},expectedVersion:1}});assert.equal(csrf.status,403);
  });
  await t.test('Google structured output uses its native request contract and excludes provider thought text',async()=>{
   Object.assign(process.env,{AI_PROVIDER:'google',GOOGLE_API_KEY:'isolated-google-provider-key',GOOGLE_TEXT_MODEL:'test-structured-model'});
   try{
    let calls=0;
    const fetcher=async(url,options)=>{
     calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/test-structured-model:generateContent');assert.equal(options.headers['x-goog-api-key'],'isolated-google-provider-key');assert.equal(options.redirect,'error');
     const body=JSON.parse(options.body),schema=body.generationConfig.responseFormat.text;assert.equal(schema.mimeType,'APPLICATION_JSON');assert.equal(options.method,'POST');assert.equal(new Headers(options.headers).get('content-type'),'application/json');assert.equal(schema.schema.additionalProperties,false);assert.match(body.systemInstruction.parts[0].text,/English/);
     const source=JSON.parse(body.contents[0].parts[0].text),values=Object.fromEntries(Object.entries(source).map(([key,value])=>[key,value.replace(/[\p{Script=Arabic}\u200c]+/gu,'Translated')]));assert.deepEqual(Object.keys(source).sort(),[...schema.schema.required].sort());
     return new Response(JSON.stringify({responseId:randomUUID(),candidates:[{content:{parts:[{thought:true,text:'Private provider reasoning must not enter an editorial draft'},{text:JSON.stringify(values)}]}}],usageMetadata:{totalTokenCount:100}}),{status:200,headers:{'content-type':'application/json'}});
    };
    const proposed=await proposal(article.id,{fetcher});assert.equal(proposed.provider,'Google AI');assert.equal(calls,1);assert.equal(JSON.stringify(proposed.fields).includes('Private provider reasoning'),false);await apply(proposed);
   }finally{process.env.AI_PROVIDER='openrouter';}
  });
  await t.test('All five locale drafts remain independent when translations from English are saved',async()=>{
   for(const [lang,label] of[['fa','ترجمه'],['tr','Çeviri'],['ar','ترجمة'],['ru','Перевод']]){
    const before=await readRecord(article.id),proposed=await proposal(article.id,{actor:admin,sourceLocale:'en',locale:lang,fetcher:provider(values=>Object.fromEntries(Object.entries(values).map(([key,value])=>[key,label+' '+(value.match(/__IM_[a-f0-9]{24}_\d+__/g)||[]).join(' ')])))});
    const saved=await apply(proposed,{actor:admin}),after=saved.state.records.find(row=>row.id===article.id);assert.ok(after.title[lang].startsWith(label));
    for(const other of['fa','en','tr','ar','ru'].filter(value=>value!==lang)){assert.equal(after.title[other],before.title[other]);assert.equal(after.summary[other],before.summary[other]);assert.equal(after.details.editorialContent.body[other],before.details.editorialContent.body[other]);}
   }
  });
 }finally{for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
}));
