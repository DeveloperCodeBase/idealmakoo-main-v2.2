import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Execute only the actual runner's bounded abort/result fragments. Never import
// the runner: its top-level application, database and Chrome work must not run.
const source=await fs.readFile(new URL('../scripts/lighthouse-private-child.mjs',import.meta.url),'utf8');
const lines=source.split('\n');
function only(predicate,label){const found=lines.filter(predicate);assert.equal(found.length,1,label);return found[0].trim();}
const declarations=only(line=>line.startsWith('let chrome,browser,page,interrupted=false,current;'),'owned runner declarations');
const errorCode=only(line=>line.startsWith('const errorCode='),'actual error sanitizer');
const abortOutcome=only(line=>line.startsWith('const abortOutcome='),'actual cause classifier');
const stop=only(line=>line.startsWith('const stop='),'actual signal handler');
const deadline=only(line=>line.includes('current=new AbortController();const deadline='),'actual deadline arm');
const catchLine=only(line=>line.trim().startsWith('}catch(error){Object.assign(result,abortOutcome('),'actual result catch');
const catchBody=catchLine.slice('}catch(error){'.length,-1);
const finallyBody=only(line=>line.trim().startsWith("clearTimeout(deadline);if(result.status==='completed')"),'actual post-cleanup pre-persist finalization');
assert(finallyBody.endsWith('current=null;'));
assert.match(source,/process\.once\('SIGTERM',stop\);process\.once\('SIGINT',stop\);/);
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(){
 const timers=[],cleared=[];
 const scope={AbortController,input:{deadlineSeconds:300},setTimeout:(callback,ms)=>{timers.push({callback,ms});return timers.length-1;},clearTimeout:id=>cleared.push(id)};
 const api=vm.runInNewContext(`
 ${declarations}
 let killCalls=0;chrome={kill(){killCalls++;}};
 ${errorCode}
 ${abortOutcome}
 ${stop}
 ({
   arm(){${deadline} return {timer:deadline,controller:current};},
   stop,
   caught(error,result={status:'error'}){${catchBody} return result;},
   finish(result,deadline){${finallyBody} return result;},
   state(){return {interrupted,killCalls,hasCurrent:!!current};}
 })`,scope,{timeout:1000});
 return {api,timers,cleared};
}

test('normal completion and a previously recorded Lighthouse failure keep their actual outcomes',()=>{
 const h=harness(),a=h.api.arm();
 const completed={status:'completed',authVerified:true,scores:{performance:47}};
 const completedExpected=structuredClone(completed);assert.deepEqual(plain(h.api.finish(completed,a.timer)),completedExpected);
 assert.deepEqual(h.cleared,[a.timer]);assert.equal(h.api.state().hasCurrent,false);
 const b=h.api.arm(),failed={status:'error',errorCode:'AUDIT_LIGHTHOUSE_RUNTIME_ERROR',runtimeError:{code:'PROTOCOL_TIMEOUT'}};
 const failedExpected=structuredClone(failed);assert.deepEqual(plain(h.api.finish(failed,b.timer)),failedExpected);
});

test('the actual requested-stop handler yields error/AUDIT_INTERRUPTED rather than timeout',()=>{
 const h=harness(),a=h.api.arm();h.api.stop();
 assert.equal(a.controller.signal.aborted,true);assert.equal(a.controller.signal.reason,'AUDIT_INTERRUPTED');
 assert.deepEqual(plain(h.api.caught(new Error('browser closed'))),{status:'error',errorCode:'AUDIT_INTERRUPTED'});
 assert.equal(h.api.state().interrupted,true);assert.equal(h.api.state().killCalls,1);
});

test('the actual unchanged deadline duration yields timeout/AUDIT_DEADLINE_EXCEEDED',()=>{
 const h=harness(),a=h.api.arm();assert.equal(h.timers[a.timer].ms,298000);h.timers[a.timer].callback();
 assert.equal(a.controller.signal.reason,'AUDIT_DEADLINE_EXCEEDED');
 assert.deepEqual(plain(h.api.caught(new Error('navigation aborted'))),{status:'timeout',errorCode:'AUDIT_DEADLINE_EXCEEDED'});
 assert.equal(h.api.state().interrupted,false);
});

test('a requested stop followed by a deadline retains the first abort cause',()=>{
 const h=harness(),a=h.api.arm();h.api.stop();h.timers[a.timer].callback();
 assert.equal(a.controller.signal.reason,'AUDIT_INTERRUPTED');
 assert.deepEqual(plain(h.api.caught(new Error('closed'))),{status:'error',errorCode:'AUDIT_INTERRUPTED'});
});

test('a deadline followed by a requested stop remains an actual deadline timeout',()=>{
 const h=harness(),a=h.api.arm();h.timers[a.timer].callback();h.api.stop();
 assert.equal(a.controller.signal.reason,'AUDIT_DEADLINE_EXCEEDED');
 assert.deepEqual(plain(h.api.caught(new Error('closed'))),{status:'timeout',errorCode:'AUDIT_DEADLINE_EXCEEDED'});
});

test('non-abort authorization and browser errors preserve their existing error classification',()=>{
 const h=harness();h.api.arm();
 assert.deepEqual(plain(h.api.caught(Object.assign(new Error('not retained'),{code:'AUDIT_PRE_SESSION_ROLE'}))),{status:'error',errorCode:'AUDIT_PRE_SESSION_ROLE'});
 assert.deepEqual(plain(h.api.caught(Object.assign(new Error('not retained'),{name:'TimeoutError'}))),{status:'error',errorCode:'AUDIT_BROWSER_TIMEOUT'});
 assert.deepEqual(plain(h.api.caught(new Error('not retained'))),{status:'error',errorCode:'AUDIT_OPERATION_FAILED'});
});

test('an abort after postchecks cannot persist a completed case, while measurements remain available',()=>{
 for(const cause of ['signal','deadline']){
  const h=harness(),a=h.api.arm(),result={status:'completed',authVerified:true,scores:{performance:51},metrics:{'largest-contentful-paint':6100}};
  if(cause==='signal')h.api.stop();else h.timers[a.timer].callback();
  const actual=plain(h.api.finish(result,a.timer));
  assert.equal(actual.status,cause==='signal'?'error':'timeout');assert.equal(actual.errorCode,cause==='signal'?'AUDIT_INTERRUPTED':'AUDIT_DEADLINE_EXCEEDED');
  assert.deepEqual(actual.scores,{performance:51});assert.deepEqual(actual.metrics,{'largest-contentful-paint':6100});assert.equal(actual.authVerified,true);
 }
});

test('a recorded runtime error is not rewritten by a later stop before persistence',()=>{
 const h=harness(),a=h.api.arm(),result={status:'error',errorCode:'AUDIT_LIGHTHOUSE_RUNTIME_ERROR',runtimeError:{code:'PROTOCOL_TIMEOUT'}};
 const expected=structuredClone(result);h.api.stop();assert.deepEqual(plain(h.api.finish(result,a.timer)),expected);
});

test('an unexpected abort reason fails as an operation error and never invents a deadline',()=>{
 const h=harness(),a=h.api.arm();a.controller.abort('unexpected synthetic reason');
 assert.deepEqual(plain(h.api.caught(new Error('closed'))),{status:'error',errorCode:'AUDIT_OPERATION_FAILED'});
 assert.deepEqual(plain(h.api.finish({status:'completed'},a.timer)),{status:'error',errorCode:'AUDIT_OPERATION_FAILED'});
});

test('a stop between cases marks the run interrupted without allocating a case controller',()=>{
 const h=harness();h.api.stop();assert.equal(h.api.state().interrupted,true);assert.equal(h.api.state().hasCurrent,false);assert.equal(h.api.state().killCalls,1);assert.equal(h.timers.length,0);
});
