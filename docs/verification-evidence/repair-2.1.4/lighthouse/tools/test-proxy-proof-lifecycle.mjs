import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {boundedHttpRequest} from './proxy-proof-lifecycle.mjs';

async function syntheticServer(handler,run){
 const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
 try{return await run(new URL('http://127.0.0.1:'+server.address().port+'/synthetic'));}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('completed synthetic response clears its absolute deadline',async()=>{
 await syntheticServer((_req,res)=>res.end('synthetic-success'),async url=>{
  const response=await boundedHttpRequest(url,{method:'GET'},undefined,{timeoutMs:100});
  assert.equal(response.status,200);assert.equal(response.raw.toString(),'synthetic-success');
  await delay(120);assert.equal(response.raw.toString(),'synthetic-success');
 });
});

test('continuous response activity cannot extend the absolute request deadline',async()=>{
 let chunks=0,requests=0;
 await syntheticServer((_req,res)=>{
  requests++;res.writeHead(200,{'Content-Type':'text/plain'});res.write('x');chunks++;
  const timer=setInterval(()=>{res.write('x');chunks++;},5);res.on('close',()=>clearInterval(timer));
 },async url=>{
  const started=Date.now();
  await assert.rejects(boundedHttpRequest(url,{method:'GET'},undefined,{timeoutMs:80}),error=>error.code==='PROOF_REQUEST_DEADLINE_EXCEEDED');
  assert.ok(Date.now()-started<1000);assert.ok(chunks>=2);assert.equal(requests,1);
 });
});

for(const signal of ['SIGTERM','SIGINT'])test('actual owned '+signal+' records interruption and reaches asynchronous finally',async()=>{
 const moduleUrl=new URL('./proxy-proof-lifecycle.mjs',import.meta.url).href;
 const program=`import {proofCancellation} from ${JSON.stringify(moduleUrl)};
import {setTimeout as delay} from 'node:timers/promises';
const record={syntheticOnly:true};const cancellation=proofCancellation(record);let activationAttempted=false;
try {activationAttempted=true;process.stdout.write('ready\\n');await delay(60000,undefined,{signal:cancellation.signal});record.status='unexpected-success';}
catch {record.status='failed';record.errorCode='PROOF_INTERRUPTED';}
finally {if(activationAttempted){await delay(5);record.syntheticCleanupReached=true;}cancellation.close();process.stdout.write(JSON.stringify(record)+'\\n');process.exitCode=2;}`;
 const child=spawn(process.execPath,['--input-type=module','--eval',program],{stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const completion=once(child,'exit');
 const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);
 try{
  const started=Date.now();while(!stdout.includes('ready\n')&&child.exitCode===null&&Date.now()-started<4000)await delay(5);
  assert.ok(stdout.startsWith('ready\n'));child.kill(signal);
  const [exitCode,exitSignal]=await completion;
  assert.equal(exitCode,2);assert.equal(exitSignal,null);assert.equal(stderr,'');
  const record=JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(record.status,'failed');assert.equal(record.interrupted,true);assert.deepEqual(record.receivedSignals,[signal]);
  assert.equal(record.errorCode,'PROOF_INTERRUPTED');assert.equal(record.syntheticCleanupReached,true);
 }finally{clearTimeout(timeout);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});
