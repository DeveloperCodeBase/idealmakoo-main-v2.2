import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTs} from './helpers/load-ts.mjs';
const {diffRevisions,compareRevisionText}=await loadTs('src/lib/revision-diff.ts');
const {captureEditorSource,assertEditorSource}=await loadTs('src/lib/editor-source.ts');
const {parseFormSchema}=await loadTs('src/lib/form-schema.ts');
const {workspaceGuide}=await loadTs('src/components/workspace/contextual-help.ts');
const {workspaceModules}=await loadTs('src/lib/auth.ts');
const {editorWorkflowCopy}=await loadTs('src/components/workspace/editor-workflow-copy.ts');

function action(file,name,context){
 const source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
 const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name)found=node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(source)==='useCallback'?node.initializer.arguments[0].getText(source):node.initializer?.getText(source);ts.forEachChild(node,visit);};visit(source);assert.ok(found,`Missing actual ${file}:${name}`);
 return runInNewContext(ts.transpileModule(`(${found})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
}
function workspaceRefreshEffect(file,context){
 const source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const matches=[];
 const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&node.arguments[1]&&ts.isArrayLiteralExpression(node.arguments[1])&&node.arguments[1].elements.map(item=>item.getText(source)).join(',')==='store.version,id')matches.push(node.arguments[0].getText(source));ts.forEachChild(node,visit);};visit(source);assert.equal(matches.length,1,'Execute the actual workspace refresh effect');
 return runInNewContext(ts.transpileModule(`(${matches[0]})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
}
const formFile='src/components/workspace/ProductionFormBuilder.tsx';
const labels=text=>({fa:text,en:text,tr:text,ar:text,ru:text});
const original=()=>({id:'FORM-EDITOR-TEST',title:labels('Original'),fields:[{id:'name',label:labels('Name'),type:'text',required:true}],version:3,status:'active',updatedAt:'2026-10-19T10:00:00.000Z',responses:[]});
function editor(){
 const form=original(),c={id:form.id,locale:'en',draft:{...structuredClone(form),title:labels('My preserved edit')},captured:{current:captureEditorSource(form)},editable:true,dirty:true,pending:{current:false},epoch:{current:1},alive:{current:true},assertEditorSource,stamp:value=>value?captureEditorSource(value):null,parseFormSchema,wt:key=>key,networkError:error=>error.message,setBusy:()=>{},setError:error=>{c.error=error;},setManaged:()=>{},load:async()=>{},onChanged:()=>{},adopt:value=>{c.adopted=structuredClone(value);c.captured.current=captureEditorSource(value);}};
 c.state={forms:[structuredClone(form)]};c.writes=[];
 c.store={pending:false,getState:()=>c.state,command:async(path,input,method)=>{c.writes.push({path,input:structuredClone(input),method});await c.beforeCommand?.();const current=c.state.forms[0];if(input.expectedFormVersion!==current.version)return false;c.state.forms=[{...current,...structuredClone(input.value),version:current.version+1,updatedAt:'2026-10-19T11:00:00.000Z'}];return true;}};
 return c;
}
test('the real form save preserves edits after a source conflict and never rebases on a refreshed workspace',async()=>{
 const c=editor(),preserved=structuredClone(c.draft);c.beforeCommand=async()=>{c.state.forms=[{...original(),title:labels('Other editor'),version:4,updatedAt:'2026-10-19T10:15:00.000Z'}];};const save=action(formFile,'save',c);
 assert.equal(await save(),false);assert.equal(c.writes.length,1);assert.equal(c.writes[0].input.expectedFormVersion,3);assert.deepEqual(c.draft,preserved);assert.equal(c.adopted,undefined);
 assert.equal(await save(),false);assert.equal(c.writes.length,1);assert.equal(c.state.forms[0].title.en,'Other editor');assert.deepEqual(c.draft,preserved);
});
test('the real form save excludes answers, keeps the captured form version across queue delay and adopts only an acknowledged result',async()=>{
 const c=editor();c.draft.responses=[{id:'private',values:{email:'private@example.test'}}];const save=action(formFile,'save',c);
 assert.equal(await save(),true);assert.equal(c.writes[0].path,'/workspace/forms/FORM-EDITOR-TEST');assert.equal(c.writes[0].method,'PUT');assert.deepEqual(Object.keys(c.writes[0].input.value).sort(),['fields','title']);assert.equal(c.writes[0].input.expectedFormVersion,3);assert.equal(c.adopted.version,4);assert.equal(c.adopted.title.en,'My preserved edit');assert.equal(JSON.stringify(c.writes).includes('private@example.test'),false);
});
test('a lost response or a late response cannot clear a dirty form or write into the next actor editor',async()=>{
 const c=editor(),preserved=structuredClone(c.draft);let resolve;c.store.command=()=>new Promise(done=>{resolve=done;});const save=action(formFile,'save',c),first=save();assert.equal(c.pending.current,true);assert.equal(await save(),false,'A rapid second press does not queue another mutation');c.epoch.current++;c.alive.current=false;resolve(true);assert.equal(await first,false);assert.equal(c.adopted,undefined);assert.deepEqual(c.draft,preserved);
});
test('a deleted form cannot be recreated by saving an old open editor',async()=>{const c=editor();c.state.forms=[];assert.equal(await action(formFile,'save',c)(),false);assert.equal(c.writes.length,0);assert.equal(c.draft.title.en,'My preserved edit');});
test('lifecycle confirmation remains tied to the exact form version selected by the user',async()=>{
 let writes=0;const c={lifecycle:{operation:'archive',version:3},managed:{form:{version:4},capabilities:{archive:true}},confirmed:true,reason:'Explicit reviewed reason',dirty:false,pending:{current:false},busy:false,epoch:{current:1},store:{pending:false,command:async()=>{writes++;return true;}},c:key=>key,setError:value=>{c.error=value;}};
 await action(formFile,'applyLifecycle',c)();assert.equal(writes,0);assert.equal(c.error,'conflict');assert.equal(c.lifecycle.version,3);
});
test('a committed form lifecycle adopts its result despite the overlapping workspace refresh and retains later dirty edits',async()=>{
 const reads=[],form=original(),item=value=>({form:structuredClone(value),status:value.status,capabilities:{edit:value.status==='active',archive:value.status==='active',delete:value.status==='archived',restore:value.status!=='active',history:true},usage:{drafts:[],published:[],scheduled:[],blocked:false}});
 let saved=structuredClone(form);
 const c={id:form.id,locale:'en',managed:item(form),draft:structuredClone(form),captured:{current:captureEditorSource(form)},dirty:false,confirmed:true,reason:'Explicit reviewed lifecycle action',lifecycle:null,pending:{current:false},epoch:{current:1},alive:{current:true},requestNumber:{current:0},read:{current:null},loaded:{current:true},AbortController,structuredClone,stamp:value=>captureEditorSource(value),networkError:error=>error.message,c:key=>key,setError:value=>{c.error=value;},setBusy:value=>{c.busy=value;},setManaged:value=>{c.managed=typeof value==='function'?value(c.managed):value;},setDraft:value=>{c.draft=typeof value==='function'?value(c.draft):value;},setDirty:value=>{c.dirty=value;},onDirty:value=>{c.directoryDirty=value;},setLifecycle:value=>{c.lifecycle=value;},setLease:value=>{c.lease=value;},setLeaseGeneration:update=>{c.leaseGeneration=update(c.leaseGeneration||0);},onChanged:()=>{c.refreshes=(c.refreshes||0)+1;}};
 c.apiClient={request:(path,{signal})=>new Promise((resolve,reject)=>{assert.equal(path,`/workspace/forms/${form.id}`);reads.push({resolve,signal});signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});})};
 c.store={pending:false,version:31,command:async(path,input)=>{assert.equal(path,`/workspace/forms/${form.id}/lifecycle`);assert.equal(input.expectedFormVersion,saved.version,'The mutation keeps its captured form version');saved={...saved,status:input.operation==='archive'?'archived':input.operation==='delete'?'deleted':'active',version:saved.version+1,updatedAt:`2026-10-19T11:00:0${saved.version+1}.000Z`};c.store.version++;return true;}};
 c.adopt=action(formFile,'adopt',c);c.load=action(formFile,'load',c);const apply=action(formFile,'applyLifecycle',c),refresh=workspaceRefreshEffect(formFile,c),settle=()=>new Promise(resolve=>setImmediate(resolve));
 for(const operation of ['archive','delete','restore']){
  c.lifecycle={operation,version:c.managed.form.version};const start=reads.length,mutation=apply();await settle();assert.equal(c.pending.current,true);assert.equal(reads.length,start+1,'The acknowledged mutation begins its explicit adopting read');
  // React can run the global version effect after the command has committed
  // but before its explicit load(true) response arrives. Resolve every read so
  // the old implementation fails on the lost captured version, not a timeout.
  refresh();await settle();for(const response of reads.slice(start))response.resolve({item:item(saved),version:c.store.version});await mutation;await settle();
  assert.equal(c.captured.current.version,saved.version,`${operation} must leave the editor on the acknowledged form version`);assert.equal(c.captured.current.updatedAt,saved.updatedAt);assert.equal(c.draft.version,saved.version);assert.equal(c.managed.status,saved.status);assert.equal(reads[start].signal.aborted,false,'Background refresh must not cancel mutation acknowledgement');assert.equal(c.lifecycle,null);assert.equal(c.pending.current,false);assert.equal(c.error,'');
 }
 const captured=structuredClone(c.captured.current);c.draft={...c.draft,title:labels('My next unsaved edit')};c.dirty=true;c.directoryDirty=true;
 saved={...saved,title:labels('Other editor after lifecycle'),version:saved.version+1,updatedAt:'2026-10-19T12:00:00.000Z'};c.store.version++;const start=reads.length;refresh();await settle();assert.equal(reads.length,start+1,'Normal background refresh still runs after the mutation settles');reads[start].resolve({item:item(saved),version:c.store.version});await settle();
 assert.equal(c.managed.form.version,saved.version);assert.deepEqual(c.captured.current,captured,'A later metadata read cannot rebase a captured draft');assert.equal(c.draft.title.en,'My next unsaved edit');assert.equal(c.dirty,true);assert.equal(c.directoryDirty,true);assert.equal(c.refreshes,3);
});
test('restore confirmation cannot overwrite a source changed while the dialog was open',async()=>{
 let calls=0;const c={restoreChoice:{revision:{id:'revision-old'},updatedAt:'2026-10-19T10:00:00.000Z'},confirmed:true,canRestore:true,pending:{current:false},bucket:'pages',id:'page-a',store:{pending:false,getState:()=>({pages:[{id:'page-a',updatedAt:'2026-10-19T10:01:00.000Z'}]}),restoreRevision:async()=>{calls++;return true;}},c:key=>key,setError:value=>{c.error=value;}};
 await action('src/components/workspace/RevisionHistory.tsx','restore',c)();assert.equal(calls,0);assert.equal(c.error,'conflict');assert.equal(c.restoreChoice.updatedAt,'2026-10-19T10:00:00.000Z');
});
test('translation acknowledgement carries the source and target revisions actually compared, never a guessed updated source',async()=>{
 const c={pending:{current:false},busy:false,dirty:false,editable:true,confirmed:true,status:{canAcknowledge:true,source:{revisionId:'saved-fa'},target:{revisionId:'saved-en',updatedAt:'2026-10-19T10:00:00.000Z'}},capturedUpdatedAt:'2026-10-19T10:00:00.000Z',bucket:'records',id:'record-a',locale:'en',source:'fa',alive:{current:true},setBusy:()=>{},setError:()=>{},setConfirmed:value=>{c.confirmed=value;}};
 c.store={pending:false,command:async(path,input)=>{c.sent={path,input};return false;}};
 assert.equal(await action('src/components/workspace/TranslationStatusPanel.tsx','acknowledge',c)(),false);assert.equal(c.sent.input.sourceRevisionId,'saved-fa');assert.equal(c.sent.input.targetRevisionId,'saved-en');assert.equal(c.sent.input.expectedUpdatedAt,c.capturedUpdatedAt);assert.equal(c.confirmed,true,'An unacknowledged response does not claim the comparison was recorded');
 c.capturedUpdatedAt='2026-10-19T09:00:00.000Z';delete c.sent;assert.equal(await action('src/components/workspace/TranslationStatusPanel.tsx','acknowledge',c)(),false);assert.equal(c.sent,undefined);
});
test('queued record translation saves cannot overwrite a source updated ahead of their queue turn',async()=>{
 const record={id:'record-a',updatedAt:'2026-10-19T10:00:00.000Z',title:labels('Old'),history:[]},c={wt:key=>key,locale:'en',role:'translator',actorId:'translator-a',demoMode:false,L:(...values)=>values,now:()=>new Date().toISOString(),log:()=>({id:'activity-a'}),ApiError:(await loadTs('src/lib/api.ts')).ApiError};let writes=0;
 c.update=async(fn)=>{try{fn({records:[{...record,updatedAt:'2026-10-19T10:01:00.000Z',title:labels('Other writer')}],audit:[]});writes++;return true;}catch(error){assert.equal(error.problem.code,'SOURCE_CHANGED');return false;}};
 assert.equal(await action('src/components/workspace/store.ts','patchRecord',c)(record.id,{title:labels('Old translation edited')},'saved',record.updatedAt),false);assert.equal(writes,0);
});
test('revision comparison separates stable-ID reordering, nested translations and exact commercial decimals',()=>{
 const before={title:{en:'Original',fa:'عنوان'},blocks:[{id:'a',body:'First'},{id:'b',body:'Second'}],commercial:{unitPriceDecimal:'9007199254740993.01'}},after={title:{en:'Edited',fa:'عنوان'},blocks:[{id:'b',body:'Second revised'},{id:'a',body:'First'}],commercial:{unitPriceDecimal:'9007199254740993.02'}};
 const diff=diffRevisions(before,after);assert.equal(diff.truncated,false);assert.equal(diff.changes.filter(item=>item.kind==='reordered').length,1);assert.deepEqual(diff.changes.find(item=>item.path.at(-1)==='body').path,['blocks','[b]','body']);assert.equal(diff.changes.filter(item=>item.path.join('.')==='title.fa').length,0);const number=diff.changes.find(item=>item.numeric);assert.equal(number.before,'9007199254740993.01');assert.equal(number.after,'9007199254740993.02');
});
test('text highlighting is lossless in RTL, whitespace, markup and bounded large text',()=>{
 for(const [before,after]of[['این متن قدیمی است.','این متن تازه است.'],['line one\n\nA **bold** claim','line one\n\nA *changed* claim'],['<script>bad()</script>','<script>changed()</script>'],['A '.repeat(20000)+'before','A '.repeat(20000)+'after']]){const result=compareRevisionText(before,after);assert.equal(result.before.map(part=>part.value).join(''),before);assert.equal(result.after.map(part=>part.value).join(''),after);assert.ok(result.before.some(part=>part.changed));assert.ok(result.after.some(part=>part.changed));}
 const many=diffRevisions({values:Array.from({length:1000},(_,i)=>i)},{values:Array.from({length:1000},(_,i)=>i+1)},{maxChanges:3});assert.equal(many.changes.length,3);assert.equal(many.truncated,true);
});
test('the actual diff renderer escapes executable markup and preserves precise numeric text',()=>{
 const file='src/components/workspace/RevisionDiff.tsx',compiled=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const require=createRequire(import.meta.url),exports={},dependencies={'@/lib/revision-diff':{compareRevisionText,diffRevisions},'./editor-workflow-copy':{editorWorkflowCopy},'./i18n':{localized:(value,locale)=>value[locale]}};
 runInNewContext(compiled,{exports,require:specifier=>dependencies[specifier]||require(specifier)});
 const html=renderToStaticMarkup(React.createElement(exports.default,{before:{body:'old',amount:'9007199254740993.01'},after:{body:'<script>alert(1)</script>',amount:'9007199254740993.02'},locale:'en'}));
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('9007199254740993.02'));assert.ok(html.includes('scope="col"'));assert.ok(html.includes('<del>'));assert.ok(html.includes('<ins>'));
});
test('all mounted workspace sections have five-language operational help and forms/translation describe their actual workflows',()=>{
 for(const module of workspaceModules){const guide=workspaceGuide(module);assert.ok(guide.steps.length);for(const step of guide.steps)for(const locale of['fa','en','tr','ar','ru'])assert.ok(step[locale]?.trim(),`${module}:${locale}`);assert.equal(/prototype|will be connected|local prototype/i.test(JSON.stringify(guide.steps)),false);}
 assert.match(workspaceGuide('forms').steps.map(item=>item.en).join(' '),/reversible/);assert.match(workspaceGuide('translations').steps.map(item=>item.en).join(' '),/Unknown means no revision binding/);assert.match(workspaceGuide('communications').steps[0].en,/does not send/);
});
