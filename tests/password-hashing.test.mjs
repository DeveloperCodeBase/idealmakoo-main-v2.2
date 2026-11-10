import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {promisify} from 'node:util';
import ts from 'typescript';

const compile=file=>ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const source=compile('src/server/crypto.ts'),typeSource=compile('src/server/types.ts');
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
function implementation({derive=crypto.scrypt,virtualTimers=false}={}){
 const types={};runInNewContext(typeSource,{exports:types});
 const exports={},timers=new Map();let timerId=0;
 const schedule=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};
 runInNewContext(source,{exports,Buffer,setTimeout:virtualTimers?schedule:setTimeout,clearTimeout:virtualTimers?id=>timers.delete(id):clearTimeout,
  require:name=>{if(name==='node:crypto')return{...crypto,scrypt:derive};if(name==='./types')return types;if(name==='./config')return{config(){throw new Error('Password hashing must not require environment secrets.');}};throw new Error('Unexpected password module dependency: '+name);}});
 return{...exports,HttpError:types.HttpError,timers,expire(){const pending=[...timers.values()];timers.clear();for(const entry of pending)entry.callback();}};
}
function controlled({manual=true,synchronousError=false}={}){
 const calls=[];
 const key=(password,salt,p)=>crypto.createHash('sha512').update(password).update(salt).update(String(p)).digest();
 const api=implementation({virtualTimers:true,derive(password,salt,length,options,callback){
  const call={password,salt:Buffer.from(salt),length,options:{...options},callback,released:false};calls.push(call);
  if(synchronousError&&calls.length===1)throw new Error('synchronous crypto fixture failure');
  if(!manual)queueMicrotask(()=>callback(null,key(password,salt,options.p)));
 }});
 return{...api,calls,key,release(index,error=null){const call=calls[index];assert.ok(call,'A real scheduled derivation must exist.');assert.equal(call.released,false);call.released=true;call.callback(error,error?undefined:key(call.password,call.salt,call.options.p));}};
}
const busy=error=>error?.status===503&&error?.code==='AUTH_BUSY';
const password='Password-verifier-fixture-é-2026';

test('The actual password module writes unique canonical p3 hashes and still verifies canonical legacy p1 hashes',{timeout:20000},async()=>{
 const api=implementation(),salt=Buffer.alloc(16,7);
 const legacyKey=await promisify(crypto.scrypt)(password,salt,64,{N:32768,r:8,p:1,maxmem:128*1024*1024});
 const legacy=`scrypt$32768$8$1$${salt.toString('hex')}$${legacyKey.toString('hex')}`;
 const current=await api.passwordHash(password),second=await api.passwordHash(password);
 assert.match(current,/^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);assert.notEqual(second,current);
 assert.equal(await api.passwordMatches(password,current),true);assert.equal(await api.passwordMatches(password,legacy),true);
 assert.equal(await api.passwordMatches('wrong-'+password,current),false);assert.equal(await api.passwordMatches('wrong-'+password,legacy),false);assert.equal(await api.passwordMatches(password.replace('é','e\u0301'),current),false,'Passwords are not silently Unicode-normalized.');
 assert.equal(api.passwordNeedsUpgrade(legacy),true);assert.equal(api.passwordNeedsUpgrade(current),false);
});

test('Malformed algorithm, fields, numbers and noncanonical hex never select stored cost parameters',async()=>{
 const api=controlled({manual:false}),valid='scrypt$32768$8$1$'+'ab'.repeat(16)+'$'+'cd'.repeat(64);
 const invalid=[valid.replace('scrypt','other!'),valid+'$extra',valid+'\n',valid.replace('$32768$','$032768$'),valid.replace('$32768$','$65536$'),valid.replace('$8$','$08$'),valid.replace('$1$','$2$'),valid.replace('$1$','$01$'),valid.replace('ab'.repeat(16),'AB'.repeat(16)),valid.replace('ab'.repeat(16),'ab'.repeat(15)+'a'),valid.replace('ab'.repeat(16),'ab'.repeat(15)+'xz'),valid.replace('cd'.repeat(64),'CD'.repeat(64)),valid.replace('cd'.repeat(64),'cd'.repeat(63)+'c'),'',null,undefined];
 for(const encoded of invalid){const start=api.calls.length;assert.equal(api.passwordNeedsUpgrade(encoded),false);assert.equal(await api.passwordMatches(password,encoded),false);assert.equal(api.calls.length,start+1);assert.equal(api.calls[start].options.p,3);assert.deepEqual(api.calls[start].options,{N:32768,r:8,p:3,maxmem:128*1024*1024});}
});

test('Legacy success and failure both perform p1 plus internal p2 padding; current and missing verifiers perform p3',async()=>{
 const api=controlled({manual:false}),salt=Buffer.alloc(16,4),legacy=`scrypt$32768$8$1$${salt.toString('hex')}$${api.key(password,salt,1).toString('hex')}`;
 assert.equal(await api.passwordMatches(password,legacy),true);assert.deepEqual(api.calls.map(call=>call.options.p),[1,2]);
 api.calls.length=0;assert.equal(await api.passwordMatches('incorrect',legacy),false);assert.deepEqual(api.calls.map(call=>call.options.p),[1,2]);
 api.calls.length=0;const current=await api.passwordHash(password);assert.equal(await api.passwordMatches(password,current),true);assert.equal(await api.passwordMatches(password,''),false);assert.deepEqual(api.calls.map(call=>call.options.p),[3,3,3]);
});

test('Public password bounds are enforced before KDF admission without silently truncating input',async()=>{
 const api=controlled({manual:false});await assert.rejects(api.passwordHash('short'),error=>error.code==='PASSWORD_POLICY');await assert.rejects(api.passwordHash('x'.repeat(129)),error=>error.code==='PASSWORD_POLICY');
 assert.equal(await api.passwordMatches('x'.repeat(129),''),false);assert.equal(await api.passwordMatches(null,''),false);assert.equal(api.calls.length,0);
});

test('At most two jobs run and sixteen wait; overflow and expired waiters never execute',async()=>{
 const api=controlled(),jobs=Array.from({length:18},()=>api.passwordMatches(password,'').then(value=>({value}),error=>({error})));
 await nextTurn();assert.equal(api.calls.length,2);assert.equal(api.timers.size,16);for(const timer of api.timers.values())assert.equal(timer.delay,2000);
 await assert.rejects(api.passwordMatches(password,''),busy);assert.equal(api.calls.length,2);
 api.expire();await nextTurn();assert.equal(api.timers.size,0);api.release(0);api.release(1);
 const results=await Promise.all(jobs);assert.equal(results.filter(result=>result.value===false).length,2);assert.equal(results.filter(result=>busy(result.error)).length,16);assert.equal(api.calls.length,2,'Timed-out passwords cannot start after capacity is released.');
 const next=api.passwordMatches(password,'');await nextTurn();assert.equal(api.calls.length,3);api.release(2);assert.equal(await next,false);
});

test('FIFO admission grants one next job per completion and removes its admission timeout',async()=>{
 const api=controlled(),jobs=['one','two','three','four'].map(value=>api.passwordMatches(value,''));await nextTurn();assert.deepEqual(api.calls.map(call=>call.password),['one','two']);
 api.release(1);await nextTurn();assert.deepEqual(api.calls.map(call=>call.password),['one','two','three']);assert.equal(api.timers.size,1);
 api.release(0);await nextTurn();assert.deepEqual(api.calls.map(call=>call.password),['one','two','three','four']);assert.equal(api.timers.size,0);
 api.release(2);api.release(3);assert.deepEqual(await Promise.all(jobs),[false,false,false,false]);
});

test('Callback failure and synchronous crypto failure both free their permit without accepting a password',async()=>{
 for(const synchronousError of[false,true]){
  const api=controlled({synchronousError}),jobs=Array.from({length:3},()=>api.passwordMatches(password,'').then(value=>({value}),error=>({error})));
  await nextTurn();if(!synchronousError){assert.equal(api.calls.length,2);api.release(0,new Error('callback crypto fixture failure'));await nextTurn();}
  assert.equal(api.calls.length,3);assert.equal(api.timers.size,0);api.release(1);api.release(2);
  const results=await Promise.all(jobs);assert.match(results[0].error.message,/crypto fixture failure/);assert.equal(results[1].value,false);assert.equal(results[2].value,false);
  const next=api.passwordHash(password);await nextTurn();api.release(3);assert.match(await next,/^scrypt\$32768\$8\$3\$/);
 }
});

test('Legacy padding stays inside its original permit and new hashes share the same capacity',async()=>{
 const api=controlled(),salt=Buffer.alloc(16,9),legacy=`scrypt$32768$8$1$${salt.toString('hex')}$${api.key(password,salt,1).toString('hex')}`;
 const first=api.passwordMatches(password,legacy),second=api.passwordMatches(password,''),queuedHash=api.passwordHash(password);
 await nextTurn();assert.deepEqual(api.calls.map(call=>call.options.p),[1,3]);assert.equal(api.timers.size,1);
 api.release(0);await nextTurn();assert.deepEqual(api.calls.map(call=>call.options.p),[1,3,2]);assert.equal(api.timers.size,1,'Padding must not release a permit early.');
 api.release(2);await nextTurn();assert.deepEqual(api.calls.map(call=>call.options.p),[1,3,2,3]);assert.equal(api.timers.size,0);
 api.release(1);api.release(3);assert.equal(await first,true);assert.equal(await second,false);assert.match(await queuedHash,/^scrypt\$32768\$8\$3\$/);
});
