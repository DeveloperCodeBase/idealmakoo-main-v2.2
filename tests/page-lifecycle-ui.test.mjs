import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const {ApiError}=await loadTs('src/lib/api.ts');
const source=ts.createSourceFile('PageLifecycle.tsx',readFileSync(new URL('../src/components/workspace/PageLifecycle.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function implementation(kind,context){let text;function visit(node){if(kind==='load'&&ts.isFunctionDeclaration(node)&&node.name?.text==='load')text=node.getText(source);if(kind==='effect'&&ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&node.arguments[1]?.getText(source).includes('store.version'))text=node.arguments[0].getText(source);ts.forEachChild(node,visit);}visit(source);assert.ok(text);return runInNewContext(ts.transpileModule(`(${text})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);}
const saved={id:'page-fixture',locale:'en',version:2,updatedAt:'2026-10-20T10:00:00.000Z',status:'draft',title:'Saved content'};
const result=(page,status='active')=>({item:{page,status,capabilities:{edit:status==='active',archive:status==='active',delete:status!=='deleted',restore:status!=='active',history:true},publication:{liveLocales:[],scheduledLocales:[],requiresPublisher:false}},version:7});
function context(){
 const requests=[],adopted=[],states=[],items=[],errors=[];
 const c={page:structuredClone(saved),store:{locale:'en',loaded:true,version:7},alive:{current:true},reading:{current:null},requestNumber:{current:0},mutating:{current:false},AbortController,ApiError,Error,encodeURIComponent,networkError:error=>error.message,adoptView:value=>states.push(value),setError:value=>errors.push(value),setItem:value=>items.push(value),latest:{current:{page:structuredClone(saved),dirty:false,onAdopt:(page,status)=>adopted.push({page,status})}}};
 c.apiClient={request:(path,{signal})=>new Promise((resolve,reject)=>requests.push({path,signal,resolve,reject}))};return{c,requests,adopted,states,items,errors};
}

test('a late lifecycle read cannot replace local content typed while the read was pending',async()=>{
 const x=context(),load=implementation('load',x.c),pending=load();x.c.latest.current.dirty=true;x.c.latest.current.page.title='New local wording';x.requests[0].resolve(result({...saved,status:'archived',version:3,updatedAt:'2026-10-20T10:01:00.000Z'},'archived'));await pending;
 assert.equal(x.adopted.length,0);assert.equal(x.c.latest.current.page.title,'New local wording');assert.equal(x.states.at(-1),'archived');
});
test('only an explicit lifecycle reload may adopt over a dirty local draft',async()=>{
 const x=context();x.c.latest.current.dirty=true;x.c.latest.current.page.title='Local wording selected for explicit discard';const pending=implementation('load',x.c)(true),fresh={...saved,version:3,title:'Reviewed current server wording',updatedAt:'2026-10-20T10:01:00.000Z'};x.requests[0].resolve(result(fresh));await pending;
 assert.equal(x.adopted.length,1);assert.deepEqual(x.adopted[0],{page:fresh,status:'active'});
});
test('an older or unmounted lifecycle request cannot overwrite a newer retained identity view',async()=>{
 const x=context(),load=implementation('load',x.c),old=load(),fresh=load();assert.equal(x.requests[0].signal.aborted,true);x.requests[1].resolve(result({...saved,status:'archived'},'deleted'));await fresh;x.requests[0].resolve(result(saved));await old;assert.equal(x.states.at(-1),'deleted');assert.equal(x.items.length,1);
 const pending=load();x.c.alive.current=false;x.requests[2].resolve(result(saved));await pending;assert.equal(x.items.length,1);
});
test('a workspace-clock effect cannot cancel the explicit reload started by its own committed lifecycle command',()=>{
 let automaticReads=0;const x=context();x.c.load=()=>{automaticReads++;};const effect=implementation('effect',x.c),oldCleanup=effect();assert.equal(automaticReads,1);
 // The command refreshes the workspace clock, starts a new source GET, then
 // React disposes the prior version effect. Its cleanup must not abort the
 // mutable reference now occupied by that newer read.
 const newer=new AbortController();x.c.reading.current=newer;x.c.mutating.current=true;if(typeof oldCleanup==='function')oldCleanup();effect();assert.equal(newer.signal.aborted,false);assert.equal(automaticReads,1);
});
