import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const {HttpClient,setCsrfToken,clearCsrfToken}=await loadTs('src/lib/api.ts');
const file='src/components/events/EventSlotPicker.tsx';
const source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const effects=[];
const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect')effects.push(node);ts.forEachChild(node,visit);};visit(source);
assert.equal(effects.length,1,'Run the actual session-list effect and its React dependency values');
const compiled=ts.transpileModule(`({effect:${effects[0].arguments[0].getText(source)},dependencies:${effects[0].arguments[1].getText(source)}})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function picker(){
 const requests=[],listeners=new Map(),state={items:[],ready:false,error:''};let previous=[],cleanup;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=(url,options)=>new Promise(resolve=>{requests.push({url,signal:options.signal,resolve:items=>resolve(Response.json({items}))});});
 const context={kind:'factory_visit',recordId:undefined,locale:'en',session:null,sessionReady:false,AbortController,URLSearchParams,apiClient:new HttpClient('/api/v1'),networkError:error=>error.message,setItems:value=>{state.items=value;},setReady:value=>{state.ready=value;},setError:value=>{state.error=value;},window:{addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:(type,listener)=>{if(listeners.get(type)===listener)listeners.delete(type);}}};
 return{state,requests,
  render(patch){Object.assign(context,patch);const {effect,dependencies}=runInNewContext(compiled,{...context});if(previous.length!==dependencies.length||dependencies.some((value,index)=>!Object.is(value,previous[index]))){cleanup?.();previous=dependencies;cleanup=effect();}},
  unmount(){cleanup?.();cleanup=undefined;},
  close(){cleanup?.();globalThis.fetch=originalFetch;clearCsrfToken();},
 };
}

test('a cold booking page retains the public session list after authentication bootstrap rotates its token',async()=>{
 const host=picker();clearCsrfToken();
 try{
  host.render({sessionReady:false,session:null});
  // This is the same order as the recorded browser failure: the provider
  // accepts /auth/session before a simultaneous event-list response arrives.
  setCsrfToken('event-picker-fixture-account-a');
  host.render({sessionReady:true,session:{id:'account-a'}});
  for(const read of host.requests)read.resolve([{id:'reserved-slot',remaining:2,waitlistEnabled:true}]);
  await settle();await settle();
  assert.equal(host.state.items[0]?.id,'reserved-slot','The created booking option remains available after session bootstrap');
  assert.equal(host.state.error,'');assert.equal(host.state.ready,true);
  assert.equal(host.requests.length,1,'Only the read made under the established session is needed');
  assert.equal(host.requests[0].signal.aborted,false);
 }finally{host.close();}
});

test('booking reads are fenced across account, locale and unmount changes even if transport ignores abort',async()=>{
 const host=picker();setCsrfToken('event-picker-fixture-account-a');
 try{
  host.render({sessionReady:true,session:{id:'account-a'}});const stale=host.requests[0];
  setCsrfToken('event-picker-fixture-account-b');host.render({session:{id:'account-b'}});
  assert.equal(host.requests.length,2,'Changing the current account establishes a new read');assert.equal(stale.signal.aborted,true);
  host.requests[1].resolve([{id:'current-slot'}]);await settle();await settle();
  stale.resolve([{id:'old-account-slot'}]);await settle();await settle();
  assert.equal(host.state.items[0]?.id,'current-slot');assert.equal(host.state.error,'');
  host.render({locale:'fa'});const localized=host.requests[2];assert.equal(host.state.ready,false);assert.equal(host.state.items.length,0);
  assert.equal(new URL(localized.url,'https://test.invalid').searchParams.get('locale'),'fa');
  host.unmount();localized.resolve([{id:'late-after-unmount'}]);await settle();await settle();
  assert.equal(localized.signal.aborted,true);assert.equal(host.state.items.length,0);assert.equal(host.state.ready,false);assert.equal(host.state.error,'');
 }finally{host.close();}
});
