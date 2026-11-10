import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {createGpuFrameGate}=await loadTs('src/components/experience/engines/gpu-frame-gate.ts');

function fixture(){
 const calls=[];let status=3,lost=false,id=0;
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,TIMEOUT_EXPIRED:3,CONDITION_SATISFIED:4,WAIT_FAILED:5,
  isContextLost:()=>lost,
  fenceSync:(condition,flags)=>{calls.push(['fence',condition,flags]);return {id:++id};},
  clientWaitSync:(sync,flags,timeout)=>{calls.push(['wait',sync.id,flags,timeout]);return status;},
  deleteSync:sync=>calls.push(['delete',sync.id]),flush:()=>calls.push(['flush'])};
 const gate=createGpuFrameGate(gl);
 return {gate,gl,calls,set status(value){status=value;},set lost(value){lost=value;}};
}
test('one GPU frame stays outstanding while zero-time polls defer later draws',()=>{
 const f=fixture();assert.equal(f.gate.canDraw(),true);f.gate.didDraw();
 for(let i=0;i<5;i++)assert.equal(f.gate.canDraw(),false);
 assert.equal(f.calls.filter(c=>c[0]==='fence').length,1);
 assert.equal(f.calls.filter(c=>c[0]==='flush').length,1);
 assert.ok(f.calls.filter(c=>c[0]==='wait').every(c=>c[2]===0&&c[3]===0));
 f.gate.dispose();assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete',1]]);
});
test('both successful GPU fence statuses release exactly once before another frame',()=>{
 for(const status of [2,4]){
  const f=fixture();f.gate.didDraw();f.status=status;assert.equal(f.gate.canDraw(),true);assert.equal(f.gate.canDraw(),true);
  assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete',1]]);
  f.gate.didDraw();f.gate.dispose();f.gate.dispose();assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete',1],['delete',2]]);
 }
});
test('a failed GPU wait terminates the gate instead of silently freezing or submitting more frames',()=>{
 const f=fixture();f.gate.didDraw();f.status=f.gl.WAIT_FAILED;
 assert.throws(()=>f.gate.canDraw(),/fence failed/);assert.throws(()=>f.gate.canDraw(),/disposed/);f.gate.dispose();
 assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete',1]]);assert.equal(f.calls.filter(c=>c[0]==='fence').length,1);
});
test('a null fence or failed submission raises the normal renderer failure path',()=>{
 const missing=fixture();missing.gl.fenceSync=()=>null;assert.throws(()=>missing.gate.didDraw(),/submitted/);assert.throws(()=>missing.gate.canDraw(),/disposed/);
 const flush=fixture();flush.gl.flush=()=>{throw Error('driver failure');};assert.throws(()=>flush.gate.didDraw(),/submitted/);
 assert.deepEqual(flush.calls.filter(c=>c[0]==='delete'),[['delete',1]]);flush.gate.dispose();
});
test('context loss releases the owned fence and cannot turn into an endless timeout',()=>{
 const f=fixture();f.gate.didDraw();f.lost=true;
 assert.throws(()=>f.gate.canDraw(),/context was lost/);f.gate.dispose();assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete',1]]);
});
test('poll exceptions clean up the outstanding sync once',()=>{
 const f=fixture();f.gate.didDraw();f.gl.clientWaitSync=()=>{throw Error('driver failure');};
 assert.throws(()=>f.gate.canDraw(),/poll failed/);f.gate.dispose();assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete',1]]);
});
test('a second submission without completion fails closed and deletes its original fence',()=>{
 const f=fixture();f.gate.didDraw();assert.throws(()=>f.gate.didDraw(),/already outstanding/);assert.equal(f.calls.filter(c=>c[0]==='fence').length,1);
 f.gate.dispose();assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete',1]]);
});
