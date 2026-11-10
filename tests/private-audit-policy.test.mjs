import test from 'node:test';
import assert from 'node:assert/strict';
import {privateAuditContext,privateFixtureActor,privateAuditJobs,privateAuditTargetPath,auditRoles} from '../scripts/lib/private-audit-policy.mjs';
import {loadTs} from './helpers/load-ts.mjs';

const {sitePaths}=await loadTs('src/lib/routes.ts');
const {authorize}=await loadTs('src/lib/auth.ts');
const base='http://127.0.0.1:3080';
const key='ab'.repeat(32),runId='02c5776d-01fb-4c88-803a-11ed5ec2e2fb';
const requestId='IM-REQ-e32a66fd-1381-4cdb-966b-07edc4c067ce';
const database='postgresql://test_user:test_private_audit_fixture@127.0.0.1:54329/idealmakoo_test';
const environment={LIGHTHOUSE_DISPOSABLE_AUTH_AUDIT:'true',NODE_ENV:'production',TEST_DATABASE_URL:database,DATABASE_URL:database,SITE_URL:base,TRUST_PROXY:'true',MFA_ENCRYPTION_KEY:key,SESSION_SECRET:'test_private_audit_session_fixture_123456789',NOTIFICATIONS_MODE:'off'};

test('authenticated Lighthouse fixture refuses delivery/operational databases, remote or mismatched URLs, options, live providers and demo adapters',()=>{
 assert.equal(privateAuditContext(environment,base).databaseName,'idealmakoo_test');
 const acceptance='idealmakoo_repair_acceptance_1792495773181_babbde';assert.equal(privateAuditContext({...environment,DATABASE_URL:database.replace('idealmakoo_test',acceptance),TEST_DATABASE_URL:database.replace('idealmakoo_test',acceptance)},base).databaseName,acceptance);
 for(const name of['idealmakoo','production','idealmakoo_delivery','idealmakoo_repair_delivery_1792495773181_babbde','idealmakoo_repair_acceptance_1792495773181_babbde_extra','idealmakoo_repair_acceptance_123_babbde'])assert.throws(()=>privateAuditContext({...environment,DATABASE_URL:database.replace('idealmakoo_test',name),TEST_DATABASE_URL:database.replace('idealmakoo_test',name)},base),undefined,name);
 for(const overrides of[{LIGHTHOUSE_DISPOSABLE_AUTH_AUDIT:undefined},{TEST_DATABASE_URL:undefined},{DATABASE_URL:database.replace('54329','54330')},{TEST_DATABASE_URL:database+'?options=-csearch_path=public'},{TEST_DATABASE_URL:database.replace('127.0.0.1','db.example.test')},{SITE_URL:'http://localhost:3080'},{NODE_ENV:'development'},{DEMO_MODE:'true'},{NEXT_PUBLIC_DATA_MODE:'local'},{NOTIFICATIONS_MODE:'live'},{SMTP_HOST:'smtp.example.test'},{KAVENEGAR_API_KEY:'test_only_provider'},{TELEGRAM_BOT_TOKEN:'test_only_provider'},{MFA_ENCRYPTION_KEY:'invalid'}])assert.throws(()=>privateAuditContext({...environment,...overrides},base),undefined,JSON.stringify(Object.keys(overrides)));
 for(const url of['https://example.test','http://127.0.0.1:3080/admin','http://test_user:test_only_password@127.0.0.1:3080','http://127.0.0.1:3080/?x=1'])assert.throws(()=>privateAuditContext(environment,url));
});

test('owned audit identities are deterministic for safe resume, isolated by role/run and never embedded in the target jobs',()=>{
 const original=privateFixtureActor(runId,'admin',key);assert.deepEqual(privateFixtureActor(runId,'admin',key),original);assert.match(original.email,/@example\.test$/);assert.ok(original.password.length>=40);
 assert.deepEqual(original.allowedLocales,['fa','en','tr','ar','ru']);
 assert.deepEqual(privateFixtureActor(runId,'translator',key).allowedLocales,['en','tr','ar','ru']);
 assert.notEqual(privateFixtureActor(runId,'customer',key).id,original.id);assert.notEqual(privateFixtureActor('03c5776d-01fb-4c88-803a-11ed5ec2e2fb','admin',key).password,original.password);
 for(const role of['root','owner','ADMIN'])assert.throws(()=>privateFixtureActor(runId,role,key));
 assert.throws(()=>privateFixtureActor('not-a-run-id','admin',key));
 const jobs=privateAuditJobs(sitePaths,base,requestId,{authorize});assert.ok(!JSON.stringify(jobs).includes(original.password));for(const forbidden of['password','csrfToken','Cookie','Authorization','sessionId'])assert.ok(!JSON.stringify(jobs).includes('"'+forbidden+'"'));
});

test('private inventory covers every 505 registered language URL, five genuine owned details, and twenty explicit other-role representatives',()=>{
 const jobs=privateAuditJobs(sitePaths,base,requestId,{authorize});assert.equal(jobs.length,530);assert.equal(new Set(jobs.map(job=>job.id)).size,530);
 assert.equal(jobs.filter(job=>job.kind==='workspace').length,430);assert.equal(jobs.filter(job=>job.kind==='account').length,75);assert.equal(jobs.filter(job=>job.kind==='owned-request-detail').length,5);assert.equal(jobs.filter(job=>job.kind==='representative-role').length,20);
 assert.deepEqual([...new Set(jobs.map(job=>job.role))].sort(),auditRoles.slice().sort());
 for(const job of jobs){assert.equal(job.indexed,false);assert.equal(job.expectedStatus,200);assert.equal(new URL(job.url).origin,base);assert.ok(sitePaths.includes(job.route));if(job.kind==='owned-request-detail')assert.equal(new URL(job.url).searchParams.get('id'),requestId);else assert.equal(new URL(job.url).search,'');}
 const pilot=privateAuditJobs(sitePaths,base,requestId,{pilot:true,authorize});assert.equal(pilot.length,3);assert.equal(pilot.filter(job=>job.role==='customer').length,1);assert.equal(pilot.filter(job=>job.kind==='owned-request-detail').length,1);
 assert.throws(()=>privateAuditJobs(sitePaths,base,'IM-REQ-'+requestId,{authorize}));assert.throws(()=>privateAuditJobs(sitePaths,base,requestId,{authorize:()=>false}));
});

test('target selection returns the identical existing principal-role job on either device and leaves the full inventory intact',()=>{
 for(const device of ['mobile','desktop']){
  const complete=privateAuditJobs(sitePaths,base,requestId,{authorize,device});assert.equal(complete.length,530);
  for(const targetPath of ['/ar/admin/users/','/en/admin/settings/','/fa/account/requests/']){
   const expected=complete.filter(job=>new URL(job.url).pathname===targetPath&&!new URL(job.url).search&&['workspace','account'].includes(job.kind));
   const selected=privateAuditJobs(sitePaths,base,requestId,{authorize,device,targetPath});
   assert.equal(selected.length,1);assert.deepEqual(selected,expected);assert.notEqual(selected[0].kind,'representative-role');assert.notEqual(selected[0].kind,'owned-request-detail');
  }
  assert.deepEqual(privateAuditJobs(sitePaths,base,requestId,{authorize,device}),complete);
 }
});

test('explicit representative scope preserves real jobs and covers two authorized pages per role with one owned detail',()=>{
 for(const device of ['mobile','desktop']){
  const complete=privateAuditJobs(sitePaths,base,requestId,{authorize,device});
  const selected=privateAuditJobs(sitePaths,base,requestId,{authorize,device,representative:true});
  assert.equal(selected.length,24);assert.equal(new Set(selected.map(job=>job.id)).size,24);
  for(const role of auditRoles){
   const jobs=selected.filter(job=>job.role===role);
   assert.equal(jobs.length,2,role);assert.deepEqual(jobs.map(job=>job.locale).sort(),['en','fa']);
  }
  assert.equal(selected.filter(job=>job.kind==='owned-request-detail').length,1);
  for(const job of selected)assert.deepEqual(job,complete.find(item=>item.id===job.id));
  assert.equal(privateAuditJobs(sitePaths,base,requestId,{authorize,device}).length,530);
 }
 assert.throws(()=>privateAuditJobs(sitePaths,base,requestId,{authorize,pilot:true,representative:true}));
 assert.throws(()=>privateAuditJobs(sitePaths,base,requestId,{authorize,representative:true,targetPath:'/ar/admin/users/'}));
 assert.throws(()=>privateAuditJobs(sitePaths,base,requestId,{authorize:()=>false,representative:true}));
});

test('target selectors reject arbitrary, noncanonical, query-bearing and conflicting inputs instead of broadening inventory',()=>{
 assert.equal(privateAuditTargetPath(sitePaths,undefined),undefined);
 for(const targetPath of [null,'','/ar/admin/does-not-exist/','/ar/products/','/AR/admin/users/','/ar/admin/users','/ar//admin/users/','/ar/admin/users/?id=private','/ar/admin/users/#private','//127.0.0.1/ar/admin/users/',base+'/ar/admin/users/','/ar/admin/%75sers/','/ar/admin/../users/']){
  assert.throws(()=>privateAuditTargetPath(sitePaths,targetPath));assert.throws(()=>privateAuditJobs(sitePaths,base,requestId,{authorize,targetPath}));
 }
 assert.throws(()=>privateAuditJobs(sitePaths,base,requestId,{authorize,pilot:true,targetPath:'/ar/admin/users/'}));
 assert.throws(()=>privateAuditJobs([...sitePaths,'admin/users'],base,requestId,{authorize,targetPath:'/ar/admin/users/'}),'An ambiguous registered inventory cannot yield two selected jobs.');
 assert.throws(()=>privateAuditJobs(sitePaths,base,requestId,{authorize:()=>false,targetPath:'/ar/admin/users/'}),'Selection does not bypass role authorization.');
});
