import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import pg from 'pg';
import {query,closeDb} from '../src/server/db.ts';
import {listUsers,updateUser,createUser} from '../src/server/account.ts';
import {HttpError} from '../src/server/types.ts';
import {fixtureActor,insertActor,fixtureHttpSession,permissions,languages} from './helpers/crm-recovery-environment.mjs';

const runFile=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const failure=(status,code)=>error=>error instanceof HttpError&&error.status===status&&error.code===code;
const ids=page=>page.items.map(item=>item.id);
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const decode=value=>JSON.parse(Buffer.from(value,'base64url').toString('utf8'));

// Run the shipping migrator, including its ledger and checksum checks. The
// direct-SQL helper used by other fixtures intentionally does not test that CLI.
async function withDirectoryDatabase(run){
  const database=process.env.TEST_ADMIN_DATABASE_URL||process.env.MIGRATION_DATABASE_URL||process.env.TEST_DATABASE_URL;
  assert.ok(database,'A real PostgreSQL database with pgvector is required; this regression must not skip.');
  const schema='user_directory_'+randomUUID().replaceAll('-','');
  const control=new pg.Client({connectionString:database,connectionTimeoutMillis:10000});
  const scoped=new URL(database);scoped.searchParams.set('options','-c search_path='+schema);
  const keys=['DATABASE_URL','MIGRATION_DATABASE_URL','STORAGE_DIR','NODE_ENV','DEMO_MODE','PRIVACY_LEDGER_DIR','SESSION_SECRET','MFA_ENCRYPTION_KEY','SITE_URL','NOTIFICATIONS_MODE','STAFF_PROVISIONING_MODE'];
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  let created=false,storage;
  await control.connect();
  try{
    await control.query('CREATE SCHEMA '+schema);created=true;
    storage=await mkdtemp(join(tmpdir(),'user-directory-'));
    await closeDb();
    Object.assign(process.env,{DATABASE_URL:scoped.toString(),MIGRATION_DATABASE_URL:scoped.toString(),STORAGE_DIR:storage,NODE_ENV:'test',SESSION_SECRET:'isolated-directory-session-secret-32',MFA_ENCRYPTION_KEY:'7'.repeat(64),SITE_URL:'http://localhost:3000',NOTIFICATIONS_MODE:'off',STAFF_PROVISIONING_MODE:'env'});
    delete process.env.DEMO_MODE;delete process.env.PRIVACY_LEDGER_DIR;
    const migrate=async()=>runFile(process.execPath,['--import','tsx','scripts/db-migrate.ts'],{cwd:root,env:{...process.env},timeout:90000,maxBuffer:4*1024*1024});
    const migrationNames=(await readdir(join(root,'db/migrations'))).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
    const expected=await Promise.all(migrationNames.map(async name=>({name,checksum:createHash('sha256').update(await readFile(join(root,'db/migrations',name))).digest('hex')})));
    const first=await migrate();
    return await run({schema,migrate,expected,first});
  }finally{
    await closeDb();
    for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];
    try{if(created)await control.query('DROP SCHEMA '+schema+' CASCADE');}
    finally{await control.end();if(storage)await rm(storage,{recursive:true,force:true});}
  }
}

const owner=fixtureActor('directory-owner','superAdmin');
const admin=fixtureActor('directory-admin','admin');
const olderStaff=fixtureActor('directory-old-editor','contentEditor',{name:'Older Editor'});
const olderCustomer=fixtureActor('directory-old-customer','customer',{name:'Older Customer',qualityScope:false});
const inactiveStaff=fixtureActor('directory-inactive-editor','contentEditor');
const noMfaStaff=fixtureActor('directory-no-mfa','support',{mfaVerified:false});

async function seedDirectory(){
  for(const actor of[owner,admin,olderStaff,olderCustomer,inactiveStaff,noMfaStaff])
    await insertActor(actor,{scope:actor.role==='customer'?'assigned':'all',grants:actor.role==='customer'?{}:permissions,mfa:actor.mfaVerified});
  await query("UPDATE users SET created_at='2019-01-01T00:00:00Z',updated_at='2019-01-01T00:00:00Z'");
  await query('UPDATE users SET active=false WHERE id=$1',[inactiveStaff.id]);
  await query(`INSERT INTO users(id,name,email,password_hash,role,active,email_verified,created_at,updated_at)
    SELECT 'directory-customer-'||lpad(g::text,4,'0'),'New customer '||g,
      'new-customer-'||g||'@example.invalid','isolated non-login directory fixture','customer',g%2=0,true,
      '2024-01-01T00:00:00Z'::timestamptz+g*interval '1 microsecond','2024-01-01T00:00:00Z'::timestamptz
    FROM generate_series(1,1050) g`);
  const precision=[['a','123001'],['b','123999'],['c','123999'],['d','123500'],['e','123000']];
  for(const [suffix,micros]of precision){
    const actor=fixtureActor('directory-precision-'+suffix,'customer',{name:'Microsecond boundary only',qualityScope:false});
    await insertActor(actor,{mfa:false});
    await query('UPDATE users SET created_at=$2::timestamptz WHERE id=$1',[actor.id,'2025-01-01T00:00:00.'+micros+'Z']);
  }
  const literal=[['percent','Literal percent % marker'],['underscore','Literal underscore _ marker'],['backslash','Literal backslash \\ marker'],['quote',"O'Reilly \\%_ marker"],['decoy','Literal decoy marker'],['persian','کاربر نمونه جستجو']];
  for(const [suffix,name]of literal)await insertActor(fixtureActor('directory-literal-'+suffix,'customer',{name,qualityScope:false}),{mfa:false});
  await query("UPDATE users SET created_at='2023-01-01T00:00:00Z' WHERE id LIKE 'directory-literal-%'");
}

async function jsonResponse(http,path,status=200,options){
  const response=await http.request(path,options);
  assert.equal(response.status,status,path);
  assert.match(response.headers.get('cache-control')||'',/no-store/);
  return response.json();
}

test('User directory: real PostgreSQL pagination, current authority, HTTP routing and additive migration',{timeout:180000},async t=>withDirectoryDatabase(async({migrate,expected,first})=>{
  await seedDirectory();
  const http=await fixtureHttpSession(owner);

  await t.test('The real migrator installs the exact source ledger and both ordered indexes; rerun changes nothing',async()=>{
    const ledger=()=>query('SELECT name,checksum,applied_at::text AS applied_at FROM schema_migrations ORDER BY name');
    const before=(await ledger()).rows;
    assert.deepEqual(before.map(({name,checksum})=>({name,checksum})),expected);
    assert.ok(expected.some(item=>item.name==='042_user_directory.sql'));
    assert.deepEqual(first.stdout.trim().split(/\r?\n/),expected.map(item=>'Applied '+item.name));
    const indexes=()=>query(`SELECT c.relname,c.oid::text AS oid,i.indisvalid,i.indisready,pg_get_indexdef(c.oid) AS definition
      FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) ORDER BY c.relname`,[['users_directory_created_idx','users_directory_staff_created_idx']]);
    const originalIndexes=(await indexes()).rows;
    assert.equal(originalIndexes.length,2);
    for(const index of originalIndexes){assert.equal(index.indisvalid,true);assert.equal(index.indisready,true);assert.match(index.definition,/USING btree \(created_at DESC, id DESC\)/);}
    assert.ok(!originalIndexes[0].definition.includes(' WHERE '));
    assert.match(originalIndexes[1].definition,/WHERE \(role <> 'customer'::text\)$/);
    const digest=async()=>(await query("SELECT md5(coalesce(string_agg(to_jsonb(u)::text,E'\\n' ORDER BY id),'')) AS digest FROM users u")).rows[0].digest;
    const beforeUsers=await digest(),second=await migrate();
    assert.equal(second.stdout.trim(),'');
    assert.deepEqual((await ledger()).rows,before);
    assert.deepEqual((await indexes()).rows,originalIndexes);
    assert.equal(await digest(),beforeUsers);
    t.diagnostic('Actual migrator applied '+expected.length+' source migrations, then reran with an unchanged ledger, index OIDs and fixture users.');
  });

  await t.test('Older staff and customers remain searchable and editable behind more than 1000 newer customers',async()=>{
    assert.equal((await query("SELECT count(*)::int AS n FROM users WHERE created_at>'2019-01-01' AND role='customer'")).rows[0].n>1000,true);
    const staff=await listUsers(owner,{kind:'staff',q:olderStaff.email,limit:1});
    assert.deepEqual(ids(staff),[olderStaff.id]);assert.equal(staff.nextCursor,null);
    assert.deepEqual(ids(await listUsers(owner,{kind:'customer',q:olderCustomer.email,limit:1})),[olderCustomer.id]);
    assert.deepEqual(ids(await listUsers(owner,{q:'  OLDER EDITOR  '})),[olderStaff.id]);
    assert.deepEqual(ids(await listUsers(owner,{kind:'customer',q:'نمونه'})),['directory-literal-persian']);
    for(const actor of[olderStaff,olderCustomer]){
      const name=actor.name+' updated';
      const result=await jsonResponse(http,'/users/'+actor.id,200,{method:'PATCH',body:{name}});
      assert.equal(result.name,name);
      assert.equal((await listUsers(owner,{q:actor.email})).items[0].name,name);
    }
    const plan=await jsonResponse(http,'/staff/'+olderStaff.id+'/handover');
    assert.equal(plan.user.id,olderStaff.id);assert.equal(plan.canOffboard,true);
  });

  await t.test('Kind, exact role and status are applied before the page limit and HTTP forwards every query field',async()=>{
    assert.equal((await listUsers(owner)).items.length,50);
    assert.equal((await listUsers(owner,{limit:100})).items.length,100);
    const active=await listUsers(owner,{kind:'staff',role:'contentEditor',active:'true',limit:1});
    assert.deepEqual(ids(active),[olderStaff.id]);assert.equal(active.nextCursor,null);
    assert.deepEqual(ids(await listUsers(owner,{kind:'staff',role:'contentEditor',active:'false',limit:1})),[inactiveStaff.id]);
    assert.deepEqual(new Set(ids(await listUsers(owner,{role:'contentEditor'}))),new Set([olderStaff.id,inactiveStaff.id]));
    const filters={kind:'staff',role:'contentEditor',active:'true',q:olderStaff.email,limit:'1'};
    assert.deepEqual(ids(await jsonResponse(http,'/users?'+new URLSearchParams(filters))),[olderStaff.id]);
    const queryString=new URLSearchParams({kind:'customer',active:'true',q:'New customer',limit:'1'});
    const page1=await jsonResponse(http,'/users?'+queryString);assert.equal(page1.items.length,1);assert.ok(page1.nextCursor);
    queryString.set('cursor',page1.nextCursor);
    const page2=await jsonResponse(http,'/users?'+queryString);assert.equal(page2.items.length,1);assert.notEqual(page1.items[0].id,page2.items[0].id);
    for(const item of[...page1.items,...page2.items]){assert.equal(item.role,'customer');assert.equal(item.active,true);assert.ok(item.name.includes('New customer'));}
  });

  await t.test('Traversal visits every existing account once and a newer insertion appears only after refresh',async()=>{
    const expectedIds=(await query('SELECT id FROM users ORDER BY created_at DESC,id DESC')).rows.map(row=>row.id);
    let page=await listUsers(owner,{limit:53}),seen=ids(page),pages=1;
    const inserted=fixtureActor('directory-midflight-new','customer',{qualityScope:false});await insertActor(inserted,{mfa:false});
    await query("UPDATE users SET created_at='2030-01-01T00:00:00Z' WHERE id=$1",[inserted.id]);
    while(page.nextCursor){
      assert.ok(pages<100,'Cursor traversal must terminate.');
      page=await listUsers(owner,{limit:53,cursor:page.nextCursor});
      assert.ok(page.items.length>0&&page.items.length<=53);seen.push(...ids(page));pages++;
    }
    assert.equal(page.nextCursor,null);assert.equal(new Set(seen).size,seen.length);
    assert.deepEqual(seen,expectedIds);assert.equal(seen.includes(inserted.id),false);
    assert.equal((await listUsers(owner,{limit:1})).items[0].id,inserted.id);
  });

  await t.test('Six-digit timestamp boundaries and equal-time ID ties never skip or duplicate accounts',async()=>{
    let page=await listUsers(owner,{q:'Microsecond boundary only',limit:1}),seen=ids(page),cursors=[];
    while(page.nextCursor){
      cursors.push(decode(page.nextCursor));assert.ok(seen.length<=5);
      page=await listUsers(owner,{q:'Microsecond boundary only',limit:1,cursor:page.nextCursor});seen.push(...ids(page));
    }
    assert.deepEqual(seen,['c','b','d','a','e'].map(suffix=>'directory-precision-'+suffix));
    assert.equal(cursors[0].createdAt,'2025-01-01T00:00:00.123999Z');
    assert.equal(cursors[2].createdAt,'2025-01-01T00:00:00.123500Z');
    assert.ok(cursors.every(cursor=>/\.\d{6}Z$/.test(cursor.createdAt)));
  });

  await t.test('Percent, underscore, backslash and apostrophe search as literal text',async()=>{
    for(const [q,wanted]of [['%',['percent','quote']],['_',['underscore','quote']],['\\',['backslash','quote']],["O'Reilly \\%_",['quote']]]){
      const actual=await listUsers(owner,{kind:'customer',q});
      assert.deepEqual(new Set(ids(actual)),new Set(wanted.map(suffix=>'directory-literal-'+suffix)),q);
    }
  });

  await t.test('Unknown, duplicate, contradictory and unbounded directory queries fail with validation errors',async()=>{
    const bad=[{unknown:'x'},{kind:'employees'},{role:'owner'},{active:'yes'},{active:true},{q:'x'.repeat(101)},{q:'null\0byte'},
      {kind:'staff',role:'customer'},{kind:'customer',role:'admin'},...['0','101','01','1e2','+1','1.1','',0,101,1.1].map(limit=>({limit})),{cursor:''},{cursor:'a'.repeat(2049)}];
    for(const input of bad)await assert.rejects(listUsers(owner,input),failure(422,'VALIDATION'));
    await assert.rejects(listUsers(owner,new URLSearchParams('limit=1&limit=2')),failure(422,'VALIDATION'));
    for(const search of ['limit=1&limit=2','kind=staff&kind=customer','sort=name','limit=1e2','q='+encodeURIComponent('null\0byte')]){
      const body=await jsonResponse(http,'/users?'+search,422);assert.equal(body.error.code,'VALIDATION');
    }
  });

  await t.test('Cursors bind all filters, validate exact instants and reject malformed or noncanonical encodings',async()=>{
    const filters={kind:'customer',role:'customer',active:'true',q:'New customer',limit:1};
    const first=await listUsers(owner,filters);assert.ok(first.nextCursor);
    for(const patch of[{kind:'all'},{role:undefined},{active:'all'},{q:'Different search'}])
      await assert.rejects(listUsers(owner,{...filters,...patch,cursor:first.nextCursor}),failure(422,'USER_DIRECTORY_CURSOR'));
    const next=await listUsers(owner,{...filters,limit:2,cursor:first.nextCursor});
    assert.equal(next.items.length,2);assert.ok(!ids(next).includes(first.items[0].id));
    const payload=decode(first.nextCursor);
    const invalid=['not+base64',first.nextCursor+'=',encode([]),encode({...payload,v:2}),encode({...payload,extra:true}),
      encode({...payload,id:''}),encode({...payload,id:'x'.repeat(101)}),encode({...payload,id:'null\0byte'}),
      encode({...payload,filters:{...payload.filters,extra:true}}),encode({...payload,filters:{...payload.filters,role:'unknown'}}),
      ...['2025-02-29T00:00:00.000000Z','2026-02-30T00:00:00.000000Z','0000-01-01T00:00:00.000000Z','2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000000+00:00'].map(createdAt=>encode({...payload,createdAt}))];
    const invalidUtf8=Buffer.from(JSON.stringify(payload));invalidUtf8[invalidUtf8.indexOf(Buffer.from(payload.id))]=255;invalid.push(invalidUtf8.toString('base64url'));
    let canonical=encode(payload),extended={...payload};
    while(canonical.length%4===0){extended.id+='x';canonical=encode(extended);}
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const noncanonical=canonical.slice(0,-1)+alphabet[alphabet.indexOf(canonical.at(-1))+1];
    assert.equal(Buffer.from(noncanonical,'base64url').toString('base64url'),canonical);
    invalid.push(noncanonical);
    for(const cursor of invalid)await assert.rejects(listUsers(owner,{...filters,cursor}),failure(422,'USER_DIRECTORY_CURSOR'));
    const body=await jsonResponse(http,'/users?'+new URLSearchParams({...filters,limit:'1',cursor:invalid[0]}),422);
    assert.equal(body.error.code,'USER_DIRECTORY_CURSOR');
  });

  await t.test('Directory DTOs exclude stored secrets and retain environment and role policy flags',async()=>{
    const secret='isolated-directory-secret-'+randomUUID();
    await query('UPDATE users SET password_hash=$2,mfa_secret=$2,mfa_pending_secret=$2,recovery_hashes=$3::jsonb WHERE id=$1',[olderStaff.id,secret,JSON.stringify([secret])]);
    const page=await listUsers(owner,{q:olderStaff.email}),item=page.items[0];
    assert.equal(page.provisioningMode,'env');assert.equal(page.canCreate,false);assert.equal(page.canManageGrants,false);
    assert.equal(JSON.stringify(page).includes(secret),false);
    assert.deepEqual(Object.keys(item).sort(),['id','name','email','role','demo','active','mfaEnabled','mfaEnrollmentRequired','emailVerified','qualityScope','allowedLocales','crmAccess','crmScope','crmPermissions','createdAt','updatedAt','capabilities'].sort());
    assert.equal(item.mfaEnabled,true);assert.equal(item.emailVerified,true);assert.deepEqual(item.allowedLocales,languages);
    assert.equal(typeof item.createdAt,'string');assert.equal(typeof item.updatedAt,'string');assert.match(item.createdAt,/Z$/);
    await assert.rejects(updateUser(owner,olderCustomer.id,{role:'admin'}),failure(403,'STAFF_ENV_MANAGED'));
    await assert.rejects(createUser(owner,{name:'Unwanted staff',email:'unwanted@example.invalid',password:'isolated non-login fixture password',role:'support'}),failure(403,'STAFF_ENV_MANAGED'));
    try{
      process.env.STAFF_PROVISIONING_MODE='panel';
      const seniorPage=await listUsers(owner,{limit:1}),adminPage=await listUsers(admin,{limit:1});
      assert.equal(seniorPage.canCreate,true);assert.equal(seniorPage.canManageGrants,true);
      assert.equal(adminPage.canCreate,true);assert.equal(adminPage.canManageGrants,false);
      await assert.rejects(updateUser(admin,owner.id,{name:'Forbidden edit'}),failure(403,'ROLE_ESCALATION'));
    }finally{process.env.STAFF_PROVISIONING_MODE='env';}
  });

  await t.test('Each page checks current account, role, MFA and HTTP session state; an old cursor grants no access',async()=>{
    const cursor=(await listUsers(owner,{limit:1})).nextCursor;assert.ok(cursor);
    for(const actor of[olderCustomer,olderStaff,{...owner,mfaVerified:false}])
      await assert.rejects(listUsers(actor,{cursor}),failure(403,'FORBIDDEN'));
    const customerHttp=await fixtureHttpSession(olderCustomer),staffHttp=await fixtureHttpSession(olderStaff),noMfaHttp=await fixtureHttpSession(owner,{mfa:false});
    assert.equal((await jsonResponse(customerHttp,'/users',403)).error.code,'FORBIDDEN');
    assert.equal((await jsonResponse(staffHttp,'/users',403)).error.code,'FORBIDDEN');
    assert.equal((await jsonResponse(noMfaHttp,'/users',403)).error.code,'MFA_REQUIRED');
    const stale=fixtureActor('directory-stale-admin','superAdmin');await insertActor(stale,{scope:'all',grants:permissions});
    const staleHttp=await fixtureHttpSession(stale),path='/users?'+new URLSearchParams({cursor});
    await query("UPDATE users SET role='support' WHERE id=$1",[stale.id]);
    await assert.rejects(listUsers(stale,{cursor}),failure(403,'FORBIDDEN'));assert.equal((await jsonResponse(staleHttp,path,403)).error.code,'FORBIDDEN');
    await query("UPDATE users SET role='superAdmin',mfa_enabled=false WHERE id=$1",[stale.id]);
    await assert.rejects(listUsers(stale,{cursor}),failure(403,'FORBIDDEN'));assert.equal((await jsonResponse(staleHttp,path,403)).error.code,'MFA_REQUIRED');
    await query('UPDATE users SET mfa_enabled=true,active=false WHERE id=$1',[stale.id]);
    await assert.rejects(listUsers(stale,{cursor}),failure(401,'SESSION_REQUIRED'));assert.equal((await jsonResponse(staleHttp,path,401)).error.code,'SESSION_REQUIRED');
    await query('UPDATE users SET active=true WHERE id=$1',[stale.id]);
    await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[staleHttp.id]);
    assert.equal((await jsonResponse(staleHttp,path,401)).error.code,'SESSION_REQUIRED');
    const unverified=await fixtureHttpSession(stale);await query('UPDATE sessions SET mfa_verified=false WHERE id=$1',[unverified.id]);
    assert.equal((await jsonResponse(unverified,path,403)).error.code,'MFA_REQUIRED');
  });

  await t.test('The independently selected older staff target still completes the existing authoritative offboarding flow',async()=>{
    const target=(await listUsers(owner,{kind:'staff',active:'true',q:olderStaff.email})).items[0];assert.equal(target.id,olderStaff.id);
    const preview=await jsonResponse(http,'/staff/'+target.id+'/handover');assert.equal(preview.canOffboard,true);
    const result=await jsonResponse(http,'/staff/'+target.id+'/offboard',200,{method:'POST',body:{expectedWorkspaceVersion:preview.workspaceVersion,planHash:preview.planHash,reason:'Directory regression confirms this exact older staff target.',assignments:[]}});
    assert.equal(result.userId,target.id);assert.equal(result.active,false);assert.deepEqual(result.transferred,{records:0,requests:0,tasks:0});
    assert.equal((await listUsers(owner,{kind:'staff',active:'true',q:olderStaff.email})).items.length,0);
    assert.deepEqual(ids(await listUsers(owner,{kind:'staff',active:'false',q:olderStaff.email})),[target.id]);
  });
}));
