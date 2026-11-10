import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadTs} from './helpers/load-ts.mjs';

const {createContentEditorIdentityManager}=await loadTs('src/lib/content-editor-identity.ts');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const storage=initial=>{const values=new Map(initial);return{values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};};
function lockService(){
 const held=new Set(),calls=[];
 return{held,calls,async request(name,options,callback){
  calls.push({name,options});assert.equal(options.ifAvailable,true);assert.equal('signal' in options,false);
  if(held.has(name))return callback(null);
  held.add(name);
  try{return await callback({name,mode:'exclusive'});}finally{held.delete(name);}
 }};
}
const manager=(locks,tabStorage=storage())=>createContentEditorIdentityManager({locks,storage:tabStorage,randomUUID});

test('concurrent editor handles in one document share a refcounted account identity',async()=>{
 const locks=lockService(),tab=manager(locks),[first,second]=await Promise.all([tab.acquire('actor-one'),tab.acquire('actor-one')]);
 assert.equal(first.clientId,second.clientId);assert.equal(first.persistence,'tab');assert.equal(locks.calls.length,1);assert.equal(locks.held.size,1);
 first.release();first.release();await settle();assert.equal(locks.held.size,1,'Releasing one mounted editor must not surrender the other editor’s tab identity.');
 second.release();second.release();await settle();assert.equal(locks.held.size,0);
});

test('a copied sessionStorage tab cannot reuse another live document’s editor identity',async()=>{
 const locks=lockService(),originalStorage=storage(),original=await manager(locks,originalStorage).acquire('actor-one');
 const copiedStorage=storage(originalStorage.values),copy=await manager(locks,copiedStorage).acquire('actor-one');
 assert.notEqual(copy.clientId,original.clientId);assert.equal(copy.persistence,'tab');assert.equal(locks.held.size,2);
 assert.equal(originalStorage.getItem('idealmakoo.content-editor.tab.actor-one'),original.clientId);
 assert.equal(copiedStorage.getItem('idealmakoo.content-editor.tab.actor-one'),copy.clientId);
 original.release();copy.release();await settle();assert.equal(locks.held.size,0);
});

test('the next document in the same tab resumes its identity once the previous document relinquishes its Web Lock',async()=>{
 const locks=lockService(),tabStorage=storage(),before=await manager(locks,tabStorage).acquire('actor-one');
 const previous=before.clientId;before.release();await settle();
 const after=await manager(locks,tabStorage).acquire('actor-one');assert.equal(after.clientId,previous);
 const secondActor=await manager(locks,tabStorage).acquire('actor-two');assert.notEqual(secondActor.clientId,previous);
 assert.equal(tabStorage.values.size,2,'Changing account never reads or replaces the previous account’s scope.');
 after.release();secondActor.release();await settle();
});

test('browsers without Web Locks never trust a potentially copied stored ID',async()=>{
 const copied=randomUUID(),tabStorage=storage([['idealmakoo.content-editor.tab.actor-one',copied]]);
 const one=await manager(undefined,tabStorage).acquire('actor-one'),two=await manager(undefined,storage(tabStorage.values)).acquire('actor-one');
 assert.notEqual(one.clientId,copied);assert.notEqual(two.clientId,copied);assert.notEqual(one.clientId,two.clientId);
 assert.equal(one.persistence,'document');assert.equal(tabStorage.getItem('idealmakoo.content-editor.tab.actor-one'),copied);
 one.release();two.release();
});

test('disabled storage and corrupt stored values keep isolated identities without weakening exclusive claims',async()=>{
 const locks=lockService(),disabled={getItem(){throw new Error('Disabled');},setItem(){throw new Error('Disabled');}};
 const isolated=await manager(locks,disabled).acquire('actor-one');assert.equal(isolated.persistence,'document');assert.equal(locks.held.size,1);isolated.release();await settle();
 const corrupt=storage([['idealmakoo.content-editor.tab.actor-one','a copied credential is not an editor UUID']]),repaired=await manager(locks,corrupt).acquire('actor-one');
 assert.match(repaired.clientId,/^[a-f\d-]{36}$/i);assert.equal(corrupt.getItem('idealmakoo.content-editor.tab.actor-one'),repaired.clientId);repaired.release();await settle();
});

test('a failed claim is evicted so an explicit retry can acquire without a leaked reference',async()=>{
 const service=lockService();let fail=true;
 const locks={request(...args){if(fail)return Promise.reject(new Error('Coordination denied'));return service.request(...args);}};
 const tab=manager(locks);await assert.rejects(tab.acquire('actor-one'),/Coordination denied/);fail=false;
 const recovered=await tab.acquire('actor-one');assert.equal(service.held.size,1);recovered.release();await settle();assert.equal(service.held.size,0);
 await assert.rejects(tab.acquire(''),/account scope/);await assert.rejects(tab.acquire('x'.repeat(161)),/account scope/);
});
