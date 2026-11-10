import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const {products}=await loadTs('src/data/catalog.ts');
const {createCustomProduct}=await loadTs('src/lib/custom-products.ts');
const {createProductDraft,readProductDraft}=await loadTs('src/components/workspace/product-editor-data.ts');
const {createProductRelease,parseProductRelease}=await loadTs('src/lib/product-release.ts');
const {ProductTranslationError,productTranslationFields,productTranslationPatch,productTranslationSource}=await loadTs('src/lib/product-translation.ts');
const {applyWorkspaceMutation,projectWorkspaceState,canChangeRecord}=await loadTs('src/components/workspace/permissions.ts');
const {ApiError}=await loadTs('src/lib/api.ts');
const {parseEditorialSeoByLocale}=await loadTs('src/lib/editorial-seo.ts');
const {parseGlossaryDefinition}=await loadTs('src/lib/glossary.ts');
const {glossaryCopy}=await loadTs('src/components/content/glossary-copy.ts');
const locales=['fa','en','tr','ar','ru'];
const L=(...values)=>Object.fromEntries(locales.map((locale,index)=>[locale,values[index]]));
const localized=(value,locale)=>value[locale];
const labels=value=>Object.fromEntries(locales.map(locale=>[locale,value]));
const sourceDate='2026-10-20T08:00:00.000Z',savedDate='2026-10-20T09:00:00.000Z';
const actor={id:'translation-fixture',role:'translator',locale:'en',allowedLocales:['en']};
function variable(file,name,context){
 const text=readFileSync(new URL('../'+file,import.meta.url),'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let value;
 const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name)value=ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(source)==='useCallback'?node.initializer.arguments[0].getText(source):node.initializer.getText(source);ts.forEachChild(node,visit);};visit(source);assert.ok(value,`Execute the actual ${file}:${name}`);
 return runInNewContext(ts.transpileModule(`(${value})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
}
function record(product=products[0],details={}){
 return{id:product.id,product:product.id,collection:'products',title:{...product.name},summary:{...product.description},status:'draft',owner:'productManager',author:'productManager',authorId:'product-author',createdAt:sourceDate,updatedAt:sourceDate,tags:[],demo:false,history:[],details};
}
function editor(row=record()){
 const c={source:structuredClone(row),target:'en',locale:'en',role:actor.role,actorId:actor.id,allowed:true,dirty:true,title:'Translated product title',summary:'Translated short description',body:'## Complete product text\n\n**Translated content** beyond the summary.',aliases:'',seo:undefined,sourceEditorial:row.details?.editorialContent,ProductTranslationError,productTranslationFields,productTranslationPatch,productTranslationSource,parseEditorialSeoByLocale,parseGlossaryDefinition,glossaryCopy,L,localized,structuredClone,ApiError,demoMode:false,wt:key=>key,now:()=>savedDate};
 c.productIssues=variable('src/components/workspace/RecordTranslation.tsx','productIssues',{L});
 c.state={version:1,records:[structuredClone(row)],pages:[],forms:[],media:[],aiJobs:[],audit:[],settings:{name:'Fixture',apiUrl:'',email:'',defaultLocale:'en',compact:false}};c.notices=[];c.writes=[];
 for(const [key,name]of[['source','setSource'],['title','setTitle'],['summary','setSummary'],['body','setBody'],['seo','setSeo'],['aliases','setAliases'],['dirty','setDirty']])c[name]=value=>{c[key]=value;};
 c.log=text=>({id:'event-'+(c.writes.length+1),actor:actor.role,at:savedDate,visibility:'internal',text});
 c.update=async(fn,message)=>{
  try{
   await c.beforeQueue?.();
   const proposed=fn(structuredClone(projectWorkspaceState(c.state,actor.role))),decision=applyWorkspaceMutation(c.state,proposed,actor);
   if(!decision.ok){c.notices.push('denied');return false;}
   c.writes.push(structuredClone(decision.state));if(c.rejectWrite)return false;
   // The acknowledged server DTO is serialized and reloaded, never kept as an in-memory draft alias.
   c.state=JSON.parse(JSON.stringify(decision.state));if(message)c.notices.push(message);return true;
  }catch(error){c.failure=error;c.notices.push(error.message);return false;}
 };
 c.store={role:actor.role,actorId:actor.id,permit:()=>true,notify:message=>c.notices.push(message),getState:()=>c.state,patchRecord:variable('src/components/workspace/store.ts','patchRecord',c)};
 c.reset=variable('src/components/workspace/RecordTranslation.tsx','reset',c);
 c.save=variable('src/components/workspace/RecordTranslation.tsx','save',c);
 return c;
}

test('the real translation save and reset persist product fullDescription through the same product editor model',async()=>{
 const c=editor(),before=structuredClone(c.source),body=c.body;await c.save('draft');
 assert.equal(c.writes.length,1);assert.equal(c.dirty,false);assert.equal(c.body,body,'A successful reset must reload the full product body instead of clearing it');assert.equal(c.source.updatedAt,savedDate);
 const reloaded=JSON.parse(JSON.stringify(c.state.records[0])),draft=readProductDraft(reloaded.details.productDraft,products[0]);
 assert.equal(draft.localized.en.fullDescription,body);assert.equal(draft.localized.en.title,c.title);assert.equal(draft.localized.en.shortDescription,c.summary);assert.equal(reloaded.details.productReviewDraft,undefined,'Saving a draft does not claim independent review');
 for(const locale of locales.filter(value=>value!=='en')){assert.equal(reloaded.title[locale],before.title[locale]);assert.equal(reloaded.summary[locale],before.summary[locale]);assert.deepEqual(draft.localized[locale],productTranslationSource(before).draft.localized[locale]);}
 assert.equal(c.notices.filter(message=>message==='saved').length,1);assert.deepEqual(before.details,{});
});

test('explicit submission of the saved translation creates an exact review snapshot without changing technical or other-language data',async()=>{
 const product=createCustomProduct({id:'custom-translation-fixture',slug:'translation-fixture',brand:'EDITOR FIXTURE',family:'teeth',title:'Authored product',locale:'en'}),draft=createProductDraft(product);
 draft.localized.en.fullDescription='Previously authored complete description';draft.localized.fa.fullDescription='متن فارسیِ حفظ‌شده';draft.technical.layerCount='3';draft.variants=[{id:'variant-a',sku:'FIXTURE-1',shade:'A1',mould:'M1',unit:'set',unitsPerPack:'28',arch:'upper',position:'anterior',sourceUrl:''}];
 const row=record(product,{customProduct:product,productDraft:draft,productReviewDraft:createProductRelease(draft,product)}),c=editor(row),body=c.body;
 await c.save('draft');assert.equal(c.writes.length,1);assert.equal(c.source.details.productReviewDraft,undefined);
 await c.save('review');assert.equal(c.writes.length,2);assert.equal(c.source.status,'review');assert.equal(c.body,body);
 const release=parseProductRelease(c.source.details.productReviewDraft,product);assert.ok(release);assert.equal(release.localized.en.fullDescription,body);assert.equal(release.localized.fa.fullDescription,draft.localized.fa.fullDescription);assert.deepEqual(release.technical,draft.technical);assert.deepEqual(release.variants,draft.variants);assert.equal(c.source.approvedById,undefined);assert.equal(c.source.authorId,actor.id);
 c.reset(JSON.parse(JSON.stringify(c.source)));assert.equal(c.body,body);
});

test('each of the five target languages saves the complete body without modifying another language',()=>{
 const before=record(products[0],{productDraft:createProductDraft(products[0])});
 for(const locale of locales){const patch=productTranslationPatch(before,locale,{title:'Title '+locale,summary:'Summary '+locale,body:'Full body '+locale},'review',actor.role,savedDate),after={...before,...patch,author:actor.role,authorId:actor.id};assert.equal(canChangeRecord(before,after,{...actor,locale,allowedLocales:[locale]}),true);assert.equal(productTranslationFields(JSON.parse(JSON.stringify(after)),locale).body,'Full body '+locale);for(const other of locales.filter(value=>value!==locale))assert.deepEqual(after.details.productDraft.localized[other],before.details.productDraft.localized[other]);}
});

test('a queued translation conflict keeps the typed full body and captured source instead of accepting a refreshed version',async()=>{
 const c=editor(),captured=c.source.updatedAt,body=c.body;c.beforeQueue=async()=>{c.state.records[0]={...c.state.records[0],updatedAt:'2026-10-20T08:30:00.000Z',summary:{...c.state.records[0].summary,en:'Another editor saved first'}};};
 await c.save('draft');assert.equal(c.failure.problem.code,'SOURCE_CHANGED');assert.equal(c.writes.length,0);assert.equal(c.source.updatedAt,captured);assert.equal(c.body,body);assert.equal(c.dirty,true);assert.equal(c.state.records[0].summary.en,'Another editor saved first');assert.equal(c.notices.includes('saved'),false);
});

test('a rejected save or failed product review cannot reset or discard the current translation',async()=>{
 const draft=createProductDraft(products[0]);draft.brand='';const c=editor(record(products[0],{productDraft:draft})),body=c.body;
 await c.save('review');assert.equal(c.writes.length,0);assert.equal(c.body,body);assert.equal(c.dirty,true);assert.match(c.notices[0],/not valid for review/);
 c.rejectWrite=true;await c.save('draft');assert.equal(c.writes.length,1);assert.equal(c.body,body);assert.equal(c.dirty,true);assert.equal(c.source.updatedAt,sourceDate);assert.equal(c.notices.includes('saved'),false);
 c.rejectWrite=false;await c.save('draft');assert.equal(c.body,body);assert.equal(c.dirty,false,'An explicitly saved incomplete draft is adopted only after acknowledgement');
});

test('translator authorization rejects foreign-language edits, structural edits and a substituted review body',()=>{
 const before=record(products[0],{productDraft:createProductDraft(products[0])});const patch=productTranslationPatch(before,'en',{title:'Translated title',summary:'Translated summary',body:'Translated body'},'review',actor.role,savedDate),valid={...before,...patch,author:actor.role,authorId:actor.id};assert.equal(canChangeRecord(before,valid,actor),true);
 const denied=[
  row=>{row.details.productDraft.localized.fa.fullDescription='Unassigned language';},
  row=>{row.details.productDraft.technical.layerCount='99';},
  row=>{row.details.productDraft.localized.en.benefits='Hidden edit outside these translation controls';},
  row=>{row.details.productReviewDraft.localized.en.fullDescription='Substituted reviewed body';},
  row=>{row.details.productDraft.gallery=[];},
  row=>{row.details.productDraft.revision+=10;},
  row=>{row.details.customProduct={id:'forged'};},
  row=>{row.status='approved';row.approvedBy='translator';row.approvedById=actor.id;},
 ];
 for(const forge of denied){const after=structuredClone(valid);forge(after);assert.equal(canChangeRecord(before,after,actor),false,String(forge));}
 assert.equal(canChangeRecord(before,valid,{...actor,allowedLocales:['fa']}),false);
});

test('a malformed existing product draft is never replaced by source defaults during translation',async()=>{
 const draft=createProductDraft(products[0]);delete draft.technical;const row=record(products[0],{productDraft:draft}),c=editor(row),body=c.body;
 assert.equal(productTranslationSource(row),null);await c.save('draft');assert.equal(c.writes.length,0);assert.equal(c.body,body);assert.equal(c.dirty,true);assert.match(c.notices[0],/could not be read safely/);assert.equal(c.source.details.productDraft.technical,undefined);
});

test('overlong product text remains in the editor until corrected instead of being truncated in the public review parser',async()=>{
 const c=editor();c.body='a'.repeat(30001);await c.save('review');assert.equal(c.writes.length,0);assert.equal(c.body.length,30001);assert.equal(c.dirty,true);assert.match(c.notices[0],/30,000/);
});

test('production attachment guidance describes private server submission in all five languages',()=>{
 const file='src/lib/live-copy.ts',exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({demoMode:false})});
 for(const locale of locales){const message=exports.liveText('attachmentHint',locale);assert.ok(message?.trim());assert.doesNotMatch(message,/kept locally|این نسخه فقط محلی|yerel olarak|محليًا فقط|только локально/i);}
 assert.match(exports.liveText('attachmentHint','en'),/stored privately on the server.*checked before use/);
 assert.doesNotMatch(exports.liveText('attachmentHint','en'),/\b\d+\s*(?:MB|MiB)\b/,'The separately rendered live upload policy owns the limit; attachment guidance must not promise a fixed cap.');
});
