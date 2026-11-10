import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {prepareMolarMeshes,prepareMolarOnMainThread,yieldSceneTask}=await loadTs('src/components/experience/engines/prepare-molar.ts');
const {buildMolarMeshData,molarTransferables}=await loadTs('src/components/experience/engines/molar-mesh.ts');
class FakeWorker{
 listeners=new Map();terminated=0;sent=[];
 constructor(reply){this.reply=reply;}
 addEventListener(type,listener){this.listeners.set(type,listener);}
 removeEventListener(type){this.listeners.delete(type);}
 terminate(){this.terminated++;}
 postMessage(value){this.sent.push(value);this.reply?.(this,value);}
 emit(data){this.listeners.get('message')?.({data});}
}
test('cooperative geometry preparation yields to timers and retains every authored mesh byte',async()=>{
 let timerRan=false;setTimeout(()=>{timerRan=true;},0);
 const [prepared]=await prepareMolarOnMainThread('standard',['maxillary']);
 const original=buildMolarMeshData('standard','maxillary');assert.equal(timerRan,true);
 for(const field of ['positions','normals','colors','surface','indices'])assert.deepEqual(prepared[field],original[field],field);
 const transferred=molarTransferables([prepared]);assert.equal(transferred.length,5);assert.equal(new Set(transferred).size,5);
 for(const array of [prepared.positions,prepared.normals,prepared.colors,prepared.surface,prepared.indices])assert.ok(transferred.includes(array.buffer));
});
test('worker completion releases its owned worker and event handlers exactly once',async()=>{
 const mesh={quality:'standard',morphology:'maxillary',positions:new Float32Array(9),normals:new Float32Array(9),colors:new Float32Array(9),surface:new Float32Array(3),indices:new Uint16Array([0,1,2]),description:'test'};
 const worker=new FakeWorker(current=>current.emit({meshes:[mesh]}));
 assert.deepEqual(await prepareMolarMeshes('standard',['maxillary'],{workerFactory:()=>worker}),[mesh]);
 assert.equal(worker.terminated,1);assert.equal(worker.listeners.size,0);assert.deepEqual(worker.sent,[{quality:'standard',morphologies:['maxillary']}]);
});
test('cancellation stops a pending worker and never enters a synchronous fallback',async()=>{
 const controller=new AbortController(),worker=new FakeWorker();
 const pending=prepareMolarMeshes('high',['maxillary','mandibular'],{signal:controller.signal,workerFactory:()=>worker});controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(worker.terminated,1);assert.equal(worker.listeners.size,0);
 await assert.rejects(yieldSceneTask(controller.signal),{name:'AbortError'});
});
test('worker failure disposes it and leaves the cooperative fallback cancellable',async()=>{
 const controller=new AbortController(),worker=new FakeWorker(current=>current.emit({error:'Unavailable worker'}));
 const pending=prepareMolarMeshes('high',['maxillary'],{signal:controller.signal,workerFactory:()=>worker});setTimeout(()=>controller.abort(),5);
 await assert.rejects(pending,{name:'AbortError'});assert.equal(worker.terminated,1);assert.equal(worker.listeners.size,0);
});
