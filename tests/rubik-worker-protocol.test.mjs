import assert from 'node:assert/strict';
import test from 'node:test';
import {loadTs} from './helpers/load-ts.mjs';

const {createRubikInputMailbox,validRubikInput,validRubikRectangle,validRubikSettings,rubikInputKeys}=await loadTs('src/components/experience/engines/rubik-worker-protocol.ts');
const rectangle={left:20,top:40,width:400,height:300};
const settings={rectangle,pixelRatio:2,finish:'Glass',reducedMotion:false,visible:true};
const pointer=(type,x=0,y=0,extra={})=>({type,timeStamp:10,pointerId:7,pointerType:'mouse',button:0,isPrimary:true,clientX:x,clientY:y,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,rectangle:{...rectangle},...extra});
const key=(value='R',extra={})=>({type:'keydown',timeStamp:20,key:value,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,...extra});
function harness(limit=64){
  const sent=[];
  const mailbox=createRubikInputMailbox((sequence,events,cancel)=>sent.push({sequence,events:structuredClone(events),cancel}),limit);
  return {sent,mailbox};
}

test('rubik protocol accepts only the intentional pointer, keyboard and rendering state domains',()=>{
  assert.equal(validRubikRectangle(rectangle),true);
  assert.equal(validRubikSettings(settings),true);
  for(const finish of ['Glass','Neon'])assert.equal(validRubikSettings({...settings,finish}),true);
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','pointerenter','pointerleave'])
    for(const pointerType of ['mouse','pen','touch'])assert.equal(validRubikInput(pointer(type,15,-20,{pointerType})),true);
  for(const value of rubikInputKeys)assert.equal(validRubikInput(key(value)),true);
  assert.equal(validRubikInput(key('R',{altKey:false})),true);
});

test('rubik protocol rejects unknown top-level and nested fields rather than forwarding form data',()=>{
  for(const extra of [{value:'private form text'},{target:{value:'text'}},{data:'text'},{password:'text'}]){
    assert.equal(validRubikInput({...pointer('pointermove'),...extra}),false);
    assert.equal(validRubikInput({...key(),...extra}),false);
    assert.equal(validRubikSettings({...settings,...extra}),false);
    assert.equal(validRubikRectangle({...rectangle,...extra}),false);
  }
});

test('rubik subtype allowlists reject unchecked keyboard fields on pointers and pointer fields on keys',()=>{
  assert.equal(validRubikInput({...pointer('pointerup'),key:'private form text'}),false);
  for(const extra of [{rectangle:{...rectangle,value:'text'}},{pointerType:'private text'},{clientX:'text'},{pointerId:7},{button:0}])assert.equal(validRubikInput({...key(),...extra}),false);
  assert.equal(validRubikInput(key('R',{altKey:'text'})),false);
  assert.equal(validRubikInput(key('not-a-control-key')),false);
  for(const modifier of ['shiftKey','altKey','ctrlKey','metaKey'])assert.equal(validRubikInput(key('R',{[modifier]:true})),true);
});

test('rubik numeric validation rejects nonfinite, oversized and type-confused input',()=>{
  for(const value of [NaN,Infinity,-Infinity,'4',null]){
    assert.equal(validRubikInput(pointer('pointermove',value,0)),false);
    assert.equal(validRubikInput({...pointer('pointermove'),timeStamp:value}),false);
    assert.equal(validRubikRectangle({...rectangle,width:value}),false);
    assert.equal(validRubikSettings({...settings,pixelRatio:value}),false);
  }
  for(const extra of [{timeStamp:-1},{timeStamp:1e15+1},{pointerId:1.25},{pointerId:Number.MAX_SAFE_INTEGER+1},{button:.5},{clientY:1e7+1},{isPrimary:1},{shiftKey:1},{altKey:1},{ctrlKey:1},{metaKey:1},{pointerType:'keyboard'}])assert.equal(validRubikInput({...pointer('pointerdown'),...extra}),false);
  assert.equal(validRubikRectangle({...rectangle,height:-1}),false);
  for(const extra of [{pixelRatio:0},{pixelRatio:65},{finish:'Other'},{visible:1},{reducedMotion:1}])assert.equal(validRubikSettings({...settings,...extra}),false);
});

test('rubik input mailbox keeps only one batch in flight until its exact ACK',()=>{
  const {sent,mailbox}=harness();
  mailbox.enqueue(pointer('pointerdown'));
  mailbox.enqueue(pointer('pointermove',3,0));
  mailbox.enqueue(pointer('pointerup',3,0));
  assert.equal(sent.length,1);
  assert.equal(mailbox.getState().pending,2);
  assert.deepEqual(sent[0].events.map(e=>e.type),['pointerdown']);
  mailbox.acknowledge(sent[0].sequence);
  assert.equal(sent.length,2);
  assert.deepEqual(sent[1].events.map(e=>e.type),['pointermove','pointerup']);
  assert.ok(sent[1].sequence>sent[0].sequence);
});

test('rubik stale, duplicate and future ACKs cannot release an unrelated batch',()=>{
  const {sent,mailbox}=harness();
  mailbox.enqueue(key('R'));mailbox.enqueue(key('U'));
  for(const ack of [0,-1,2,NaN,Infinity])mailbox.acknowledge(ack);
  assert.equal(sent.length,1);
  mailbox.acknowledge(1);assert.equal(sent.length,2);
  mailbox.enqueue(key('L'));mailbox.acknowledge(1);assert.equal(sent.length,2);
  mailbox.acknowledge(2);assert.equal(sent.length,3);
  assert.deepEqual(sent.map(row=>row.events[0].key),['R','U','L']);
});

test('rubik preserves every active drag sample and the first six-pixel decision in order',()=>{
  const {sent,mailbox}=harness();
  mailbox.enqueue(pointer('pointerdown'));
  mailbox.enqueue(pointer('pointermove',2,2));
  mailbox.enqueue(pointer('pointermove',4,4));
  mailbox.enqueue(pointer('pointermove',6,0));
  mailbox.enqueue(pointer('pointermove',8,1));
  mailbox.enqueue(pointer('pointermove',9,2));
  mailbox.enqueue(pointer('pointerup',9,2,{shiftKey:true}));
  mailbox.acknowledge(1);
  assert.deepEqual(sent[1].events.map(e=>[e.type,e.clientX,e.clientY]),[
    ['pointermove',2,2],['pointermove',4,4],['pointermove',6,0],['pointermove',8,1],['pointermove',9,2],['pointerup',9,2],
  ]);
  assert.equal(sent[1].events.at(-1).shiftKey,true);
});

test('rubik preserves diagonal active samples without replacing the engine direction decision',()=>{
  const {sent,mailbox}=harness();mailbox.pause();
  mailbox.enqueue(pointer('pointerdown',10,20));
  mailbox.enqueue(pointer('pointermove',13,23));
  mailbox.enqueue(pointer('pointermove',15,24));
  mailbox.enqueue(pointer('pointermove',17,25));
  mailbox.enqueue(pointer('pointermove',19,26));
  mailbox.resume();
  assert.deepEqual(sent[0].events.map(e=>[e.type,e.clientX,e.clientY]),[
    ['pointerdown',10,20],['pointermove',13,23],['pointermove',15,24],['pointermove',17,25],['pointermove',19,26],
  ]);
});

test('rubik does not coalesce moves across keyboard, release or another pointer boundaries',()=>{
  const {sent,mailbox}=harness();mailbox.pause();
  const events=[pointer('pointermove',1),key('R'),pointer('pointermove',2),pointer('pointermove',3,0,{pointerId:8}),pointer('pointerup',3,0,{pointerId:8}),pointer('pointermove',4)];
  events.forEach(e=>mailbox.enqueue(e));mailbox.resume();
  assert.deepEqual(sent[0].events,events);
});

test('rubik pointer cancellation and lost capture retain their release payload',()=>{
  for(const ending of ['pointercancel','lostpointercapture']){
    const {sent,mailbox}=harness();mailbox.pause();
    mailbox.enqueue(pointer('pointerdown',20,30));
    mailbox.enqueue(pointer('pointermove',26,30));
    const release=pointer(ending,44,55,{shiftKey:true,button:-1,isPrimary:false});
    mailbox.enqueue(release);mailbox.resume();
    assert.deepEqual(sent[0].events.at(-1),release);
    mailbox.acknowledge(1);mailbox.pause();
    mailbox.enqueue(pointer('pointerdown',100,100));mailbox.enqueue(pointer('pointermove',106,100));mailbox.enqueue(pointer('pointermove',107,100));mailbox.enqueue(pointer('pointermove',108,100));mailbox.resume();
    assert.deepEqual(sent[1].events.map(e=>e.clientX),[100,106,107,108]);
  }
});

test('rubik finite overflow cancels the old queued gesture and retains the incoming release',()=>{
  const {sent,mailbox}=harness(3);mailbox.pause();
  mailbox.enqueue(pointer('pointerdown'));mailbox.enqueue(key('R'));mailbox.enqueue(key('U'));
  const up=pointer('pointerup',120,140,{shiftKey:true,rectangle:{left:80,top:100,width:300,height:240}});
  mailbox.enqueue(up);
  assert.equal(mailbox.getState().pending,1);mailbox.resume();
  assert.equal(sent[0].cancel,true);assert.deepEqual(sent[0].events,[up]);
});

test('rubik overflow registers a retained new down after resetting the old pointer',()=>{
  const {sent,mailbox}=harness(3);mailbox.pause();
  mailbox.enqueue(pointer('pointerdown',0,0,{pointerId:1}));mailbox.enqueue(key('R'));mailbox.enqueue(key('U'));
  mailbox.enqueue(pointer('pointerdown',100,100,{pointerId:2}));
  mailbox.enqueue(pointer('pointermove',106,100,{pointerId:2}));
  mailbox.enqueue(pointer('pointermove',108,100,{pointerId:2}));
  mailbox.resume();
  assert.equal(sent[0].cancel,true);
  assert.deepEqual(sent[0].events.map(e=>[e.type,e.pointerId,e.clientX]),[
    ['pointerdown',2,100],['pointermove',2,106],['pointermove',2,108],
  ]);
});

test('rubik sustained overload stays bounded and reports the discarded sequence through explicit cancel',()=>{
  const {sent,mailbox}=harness();mailbox.enqueue(key('R'));
  for(let i=0;i<1000;i++){
    mailbox.enqueue(key(i%2?'U':'L',{timeStamp:i}));
    assert.ok(mailbox.getState().pending<=64);
  }
  assert.equal(sent.length,1);mailbox.acknowledge(1);
  assert.ok(sent[1].events.length<=64);assert.equal(sent[1].cancel,true);
});

test('rubik pause retains a complete short click until visibility settings are acknowledged',()=>{
  const {sent,mailbox}=harness();mailbox.pause();
  const down=pointer('pointerdown',20,30),up=pointer('pointerup',20,30,{shiftKey:true});
  mailbox.enqueue(down);mailbox.enqueue(up);mailbox.acknowledge(1);
  assert.equal(sent.length,0);assert.equal(mailbox.getState().pending,2);
  mailbox.resume();assert.deepEqual(sent[0].events,[down,up]);
  mailbox.resume();assert.equal(sent.length,1);
});

test('rubik pause during flight does not let the old ACK bypass the settings barrier',()=>{
  const {sent,mailbox}=harness();mailbox.enqueue(key('R'));mailbox.pause();mailbox.enqueue(key('U'));
  mailbox.acknowledge(1);assert.equal(sent.length,1);
  assert.equal(mailbox.getState().inFlight,0);assert.equal(mailbox.getState().pending,1);
  mailbox.resume();assert.equal(sent.length,2);assert.equal(sent[1].events[0].key,'U');
});

test('rubik explicit cancellation discards pending moves but is itself delivered after an in-flight ACK',()=>{
  const {sent,mailbox}=harness();mailbox.enqueue(pointer('pointerdown'));mailbox.enqueue(pointer('pointermove',9,0));mailbox.cancel();
  assert.equal(sent.length,1);assert.equal(mailbox.getState().pending,0);
  mailbox.acknowledge(1);assert.equal(sent.length,2);assert.equal(sent[1].cancel,true);assert.deepEqual(sent[1].events,[]);
});

test('rubik cancel while paused is retained until resume without leaking prior controls',()=>{
  const {sent,mailbox}=harness();mailbox.pause();mailbox.enqueue(pointer('pointerdown'));mailbox.enqueue(key('R'));mailbox.cancel();
  assert.equal(sent.length,0);mailbox.resume();assert.deepEqual(sent[0].events,[]);assert.equal(sent[0].cancel,true);
});

test('rubik Escape resets threshold tracking before a later grab',()=>{
  const {sent,mailbox}=harness();mailbox.pause();
  mailbox.enqueue(pointer('pointerdown',0,0));mailbox.enqueue(pointer('pointermove',7,0));mailbox.enqueue(key('Escape'));
  mailbox.enqueue(pointer('pointerdown',100,0));mailbox.enqueue(pointer('pointermove',106,0));mailbox.enqueue(pointer('pointermove',108,0));mailbox.enqueue(pointer('pointermove',110,0));mailbox.resume();
  assert.deepEqual(sent[0].events.map(e=>e.type==='keydown'?e.key:e.clientX),[0,7,'Escape',100,106,108,110]);
});

test('rubik invalid events never enter the queue or consume a sequence',()=>{
  const {sent,mailbox}=harness();
  for(const value of [null,{},key('user text'),pointer('pointermove',NaN),{...pointer('pointerup'),password:'text'}])mailbox.enqueue(value);
  assert.equal(sent.length,0);assert.equal(mailbox.getState().sequence,0);assert.equal(mailbox.getState().pending,0);
});

test('rubik disposal prevents queued, resumed, cancelled or late-ACK input from being sent',()=>{
  const {sent,mailbox}=harness();mailbox.enqueue(key('R'));mailbox.enqueue(key('U'));mailbox.dispose();mailbox.dispose();
  mailbox.acknowledge(1);mailbox.resume();mailbox.cancel();mailbox.enqueue(pointer('pointerup'));
  assert.equal(sent.length,1);assert.equal(mailbox.getState().stopped,true);assert.equal(mailbox.getState().pending,0);assert.equal(mailbox.getState().inFlight,0);
});

test('rubik queue configuration refuses unbounded or invalid capacities',()=>{
  for(const limit of [0,1,65,257,Infinity,NaN,2.5,'64'])assert.throws(()=>createRubikInputMailbox(()=>{},limit),RangeError);
});

test('rubik coalesces only consecutive hover samples while retaining boundaries',()=>{
 const {sent,mailbox}=harness();mailbox.pause();
 mailbox.enqueue(pointer('pointermove',1));mailbox.enqueue(pointer('pointermove',2));mailbox.enqueue(pointer('pointerenter',3));
 mailbox.enqueue(pointer('pointermove',4));mailbox.enqueue(pointer('pointermove',5));mailbox.resume();
 assert.deepEqual(sent[0].events.map(e=>[e.type,e.clientX]),[['pointermove',2],['pointerenter',3],['pointermove',5]]);
});
