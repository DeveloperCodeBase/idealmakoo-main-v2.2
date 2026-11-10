import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const execute=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
// Execute the real CLI decision path. Only its database and TS route imports
// are replaced in a child process; no server, actual DB or Chrome can be reached.
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'private-lh-fixture-phase-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const ledger=path.join(directory,'ledger.json'),loader=path.join(directory,'loader.mjs');
 await fs.writeFile(ledger,JSON.stringify({calls:[],requests:[]}));
 const runtime=`import fs from 'node:fs/promises';
 const file=process.env.FIXTURE_LEDGER;
 async function record(name,runId){const state=JSON.parse(await fs.readFile(file,'utf8'));state.calls.push({name,runId});if(name==='request'&&!state.requests.includes(runId))state.requests.push(runId);await fs.writeFile(file,JSON.stringify(state));}
 export async function auditDatabase(){await record('connect');return{pool:{end:()=>record('end')},context:{baseUrl:'http://127.0.0.1:3094',databaseIdentity:'a'.repeat(64)}};}
 export async function prepareFixtureActors(pool,runId,roles){if(roles.length!==12)throw new Error('Expected complete role set');await record('actors',runId);}
 export async function ensureOwnedAuditRequest(pool,run){await record('request',run.runId);return 'IM-REQ-'+run.runId;}
 export async function closeFixtureActors(pool,runId){await record('close',runId);}
 export async function privateWorkloadIdentity(){throw new Error('WORKLOAD_MUST_NOT_FREEZE_DURING_PREPARATION');}`;
 const hooks=`import {registerHooks} from 'node:module';
 const sources=${JSON.stringify({'/lib/private-audit-runtime.mjs':runtime,'/src/lib/routes.ts':"export const sitePaths=['admin/users','admin/settings'];",'/src/lib/auth.ts':'export const authorize=()=>true;'})};
 registerHooks({resolve(specifier,context,next){for(const [ending,source]of Object.entries(sources))if(specifier.endsWith(ending))return{url:'data:text/javascript;base64,'+Buffer.from(source).toString('base64'),shortCircuit:true};return next(specifier,context);}});`;
 await fs.writeFile(loader,hooks);
 const run=(output,device,extra=[])=>execute(process.execPath,['--import',loader,'scripts/audit-private-lighthouse.mjs','--base-url','http://127.0.0.1:3094','--output',output,'--device',device,'--chrome','/NO_CHROME_PERMITTED_IN_THIS_UNIT_TEST','--deadline-seconds','300','--prepare-fixtures-only',...extra],{cwd:root,env:{PATH:process.env.PATH,FIXTURE_LEDGER:ledger,MFA_ENCRYPTION_KEY:'ab'.repeat(32)},timeout:10000,maxBuffer:16384});
 return{directory,ledger,run,read:async()=>JSON.parse(await fs.readFile(ledger,'utf8'))};
}
test('both device fixtures are created before any manifest, normal cleanup runs, and revalidation creates no additional owned request',async t=>{
 const h=await fixture(t),mobile=path.join(h.directory,'mobile'),desktop=path.join(h.directory,'desktop');
 await h.run(mobile,'mobile');await h.run(desktop,'desktop');await h.run(mobile,'mobile');
 const state=await h.read();assert.equal(state.requests.length,2);
 assert.deepEqual(state.calls.map(row=>row.name),Array(3).fill(['connect','actors','request','close','end']).flat());
 for(const output of [mobile,desktop]){
  const files=await fs.readdir(output);assert(files.includes('run-context.json'));assert(!files.some(name=>['manifest.json','inventory.json','summary.json','audit.lock'].includes(name)));
  for(const name of files.filter(name=>name.startsWith('fixture-preparation.'))){const receipt=JSON.parse(await fs.readFile(path.join(output,name),'utf8'));assert.equal(receipt.manifestFrozen,false);assert.equal(receipt.roleCount,12);assert.equal(receipt.ownedRequestPrepared,true);}
 }
 assert.equal((await fs.readdir(mobile)).filter(name=>name.startsWith('fixture-preparation.')).length,2,'Prior preparation receipts remain present.');
});
test('late preparation on a frozen run is rejected before fixture changes; contradictory modes are rejected before DB setup',async t=>{
 const h=await fixture(t),output=path.join(h.directory,'mobile');await h.run(output,'mobile');
 const context=await fs.readFile(path.join(output,'run-context.json')),prior=await h.read();await fs.writeFile(path.join(output,'manifest.json'),'{}');
 await assert.rejects(h.run(output,'mobile'),error=>error.code===2);
 const after=await h.read();assert.deepEqual(after.requests,prior.requests);assert.deepEqual(after.calls.slice(prior.calls.length).map(row=>row.name),['connect','end']);assert.deepEqual(await fs.readFile(path.join(output,'run-context.json')),context);
 const beforeMode=await h.read();await assert.rejects(h.run(path.join(h.directory,'bad-mode'),'desktop',['--inventory-only']));assert.deepEqual(await h.read(),beforeMode);
});

test('a selected preparation pins its scope and rejects a changed target before fixture activation',async t=>{
 const h=await fixture(t),output=path.join(h.directory,'selected');
 await h.run(output,'mobile',['--target-path','/ar/admin/users/']);
 const context=JSON.parse(await fs.readFile(path.join(output,'run-context.json'),'utf8'));assert.equal(context.targetPath,'/ar/admin/users/');
 const before=await h.read();await assert.rejects(h.run(output,'mobile',['--target-path','/en/admin/settings/']),error=>error.code===2);
 const after=await h.read();assert.deepEqual(after.requests,before.requests);assert(!after.calls.slice(before.calls.length).some(row=>['actors','request'].includes(row.name)));
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(output,'run-context.json'),'utf8')),context);
 for(const extra of [['--target-path','/ar/admin/users/?id=private'],['--target-path','/ar/admin/users/','--pilot'],['--target-path','/ar/admin/users/','--limit','1']]){
  const previous=await h.read();await assert.rejects(h.run(path.join(h.directory,'rejected'),'mobile',extra));assert.deepEqual(await h.read(),previous);
 }
});
