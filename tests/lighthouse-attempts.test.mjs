import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {reserveAuditAttempt} from '../scripts/lib/lighthouse-attempts.mjs';

const id='0123456789abcdef',other='fedcba9876543210';
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'idealmakoo-attempt-fixture-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;
}
async function snapshot(directory,names){
 return Promise.all(names.map(async name=>{
  const filename=path.join(directory,name),stat=await fs.lstat(filename,{bigint:true});
  return{name,bytes:await fs.readFile(filename),inode:stat.ino,mtime:stat.mtimeNs,mode:stat.mode};
 }));
}

test('resultless input, LHR, log, temporary and unknown artifacts retain exact bytes and identity',async t=>{
 const directory=await fixture(t),names=[];
 for(const[number,suffix]of[[1,'result.json'],[2,'input.json'],[5,'lhr.json'],[7,'runner.log'],[9,'chrome.log'],[11,'input.json.42.tmp'],[13,'result.json.43.tmp'],[15,'reservation.json'],[17,'unrecognized-partial']]){
  const name=`${id}.attempt-${number}.${suffix}`;names.push(name);await fs.writeFile(path.join(directory,name),`synthetic evidence ${number}\n`,{mode:0o600});
 }
 const before=await snapshot(directory,names),reserved=await reserveAuditAttempt(directory,id);
 assert.equal(reserved.attempt,18);assert.deepEqual(await snapshot(directory,names),before);
 assert.equal(await fs.readFile(reserved.reservationFile,'utf8'),JSON.stringify({format:'idealmakoo.lighthouse-attempt-reservation',version:1,id,attempt:18,reservationOnly:true})+'\n');
 assert.equal((await fs.stat(reserved.reservationFile)).mode&0o777,0o600);
 assert.deepEqual((await fs.readdir(directory)).sort(),[...names,`${id}.attempt-18.reservation.json`].sort());
});

test('an empty or truncated prior reservation is never reused or parsed as a result',async t=>{
 const directory=await fixture(t),names=[`${id}.attempt-1.reservation.json`,`${id}.attempt-2.reservation.json`];
 await fs.writeFile(path.join(directory,names[0]),'');await fs.writeFile(path.join(directory,names[1]),'{"reservation');
 const before=await snapshot(directory,names),reserved=await reserveAuditAttempt(directory,id);
 assert.equal(reserved.attempt,3);assert.deepEqual(await snapshot(directory,names),before);
 assert.ok((await fs.readdir(directory)).every(name=>!name.endsWith('.result.json')));
});

test('32 concurrent allocators reserve distinct prefixes beyond an orphan without replacing it',async t=>{
 const directory=await fixture(t),orphan=`${id}.attempt-71.lhr.json`;
 await fs.writeFile(path.join(directory,orphan),'synthetic partial report');const before=await snapshot(directory,[orphan]);
 const claims=await Promise.all(Array.from({length:32},()=>reserveAuditAttempt(directory,id)));
 assert.deepEqual(claims.map(value=>value.attempt).sort((a,b)=>a-b),Array.from({length:32},(_,index)=>index+72));
 assert.equal(new Set(claims.map(value=>value.prefix)).size,32);assert.deepEqual(await snapshot(directory,[orphan]),before);
 for(const claim of claims){const value=JSON.parse(await fs.readFile(claim.reservationFile,'utf8'));assert.equal(value.id,id);assert.equal(value.attempt,claim.attempt);assert.equal(value.reservationOnly,true);}
});

test('an artifact arriving between discovery and claim is preserved and makes allocation advance',async t=>{
 const directory=await fixture(t),originalOpen=fs.open;
 const raced=path.join(directory,`${id}.attempt-1.lhr.json`);let inserted=false;
 t.mock.method(fs,'open',async(filename,...args)=>{
  if(!inserted&&filename===path.join(directory,`${id}.attempt-1.reservation.json`)){
   inserted=true;await fs.writeFile(raced,'synthetic legacy writer evidence',{flag:'wx'});
  }
  return originalOpen(filename,...args);
 });
 const reserved=await reserveAuditAttempt(directory,id);
 assert.equal(reserved.attempt,2);assert.equal(await fs.readFile(raced,'utf8'),'synthetic legacy writer evidence');
 assert.deepEqual((await fs.readdir(directory)).sort(),[`${id}.attempt-1.lhr.json`,`${id}.attempt-1.reservation.json`,`${id}.attempt-2.reservation.json`]);
});

test('claim creation collisions are retried without parsing or rewriting the winning allocation',async t=>{
 const directory=await fixture(t),originalOpen=fs.open;
 const winning=path.join(directory,`${id}.attempt-1.reservation.json`);let inserted=false;
 t.mock.method(fs,'open',async(filename,...args)=>{
  if(!inserted&&filename===winning){inserted=true;await fs.writeFile(winning,'synthetic concurrent reservation',{flag:'wx'});}
  return originalOpen(filename,...args);
 });
 const reserved=await reserveAuditAttempt(directory,id);
 assert.equal(reserved.attempt,2);assert.equal(await fs.readFile(winning,'utf8'),'synthetic concurrent reservation');
});

test('private batch reservations for views never started remain allocations without invented timestamps or outcomes',async t=>{
 const directory=await fixture(t),third='0011223344556677';
 const first=await reserveAuditAttempt(directory,id),unstarted=await reserveAuditAttempt(directory,other),alsoUnstarted=await reserveAuditAttempt(directory,third);
 await fs.writeFile(first.prefix+'.result.json',JSON.stringify({syntheticFixture:true,status:'error'}));
 const names=[path.basename(unstarted.reservationFile),path.basename(alsoUnstarted.reservationFile)],before=await snapshot(directory,names);
 const resumed=await Promise.all([reserveAuditAttempt(directory,other),reserveAuditAttempt(directory,third)]);
 assert.deepEqual(resumed.map(value=>value.attempt),[2,2]);assert.deepEqual(await snapshot(directory,names),before);
 for(const reservation of[unstarted,alsoUnstarted,...resumed]){
  const value=JSON.parse(await fs.readFile(reservation.reservationFile,'utf8'));
  assert.deepEqual(Object.keys(value),['format','version','id','attempt','reservationOnly']);
  await assert.rejects(fs.stat(reservation.prefix+'.result.json'),{code:'ENOENT'});
 }
});

test('attempt-like names for other jobs and unrelated files do not choose the current job number',async t=>{
 const directory=await fixture(t),names=[`${other}.attempt-700.runner.log`,`${id}.attempt-8different.txt`,'manifest.json','summary.json'];
 for(const name of names)await fs.writeFile(path.join(directory,name),'synthetic unrelated artifact');
 const before=await snapshot(directory,names),reserved=await reserveAuditAttempt(directory,id);
 assert.equal(reserved.attempt,1);assert.deepEqual(await snapshot(directory,names),before);
});

test('a numeric prefix with leading zeroes is still occupied and is never reused',async t=>{
 const directory=await fixture(t),name=`${id}.attempt-0007.lhr.json`;
 await fs.writeFile(path.join(directory,name),'synthetic legacy numeric name');const before=await snapshot(directory,[name]);
 assert.equal((await reserveAuditAttempt(directory,id)).attempt,8);assert.deepEqual(await snapshot(directory,[name]),before);
});

test('unsafe job identities and a symlinked output directory fail without altering evidence',async t=>{
 const directory=await fixture(t),name='preserved.txt';await fs.writeFile(path.join(directory,name),'synthetic unchanged');
 const before=await snapshot(directory,[name]);
 for(const invalid of['../0123456789abc','ABCDEF0123456789','0123456789abcdef/next','0123456789abcde.',''])await assert.rejects(reserveAuditAttempt(directory,invalid),{code:'AUDIT_ATTEMPT_ARGUMENTS'});
 const linked=path.join(directory,'linked');await fs.symlink(directory,linked,'dir');
 await assert.rejects(reserveAuditAttempt(linked,id),{code:'AUDIT_ATTEMPT_DIRECTORY'});assert.deepEqual(await snapshot(directory,[name]),before);
 assert.deepEqual((await fs.readdir(directory)).sort(),['linked',name]);
});

test('a symlinked artifact only reserves its number and its target is never opened or replaced',async t=>{
 const directory=await fixture(t),target=path.join(directory,'preserved.txt'),name=`${id}.attempt-7.reservation.json`;
 await fs.writeFile(target,'synthetic target');await fs.symlink(target,path.join(directory,name));
 const before=await snapshot(directory,['preserved.txt']);
 assert.equal((await reserveAuditAttempt(directory,id)).attempt,8);assert.deepEqual(await snapshot(directory,['preserved.txt']),before);
 assert.equal(await fs.readlink(path.join(directory,name)),target);
});

test('an exhausted or unsafe numeric namespace fails closed without writing a result or new reservation',async t=>{
 for(const number of['99999','9007199254740992']){
  const directory=await fixture(t),name=`${id}.attempt-${number}.runner.log`;
  await fs.writeFile(path.join(directory,name),'synthetic boundary');const before=await snapshot(directory,[name]);
  await assert.rejects(reserveAuditAttempt(directory,id),{code:'AUDIT_ATTEMPT_LIMIT'});
  assert.deepEqual(await snapshot(directory,[name]),before);assert.deepEqual(await fs.readdir(directory),[name]);
 }
});
