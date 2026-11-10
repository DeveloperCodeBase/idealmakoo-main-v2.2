import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import pg from 'pg';
import {query,closeDb} from '../../src/server/db.ts';
import {hash} from '../../src/server/crypto.ts';

export const languages=['fa','en','tr','ar','ru'];
export const localized=value=>Object.fromEntries(languages.map(locale=>[locale,value]));
export const permissions={contact:true,financial:true,baseCost:true,assign:true,intake:true};
export function fixtureActor(id,role='business',patch={}){return{id,name:id,email:id+'@example.invalid',role,qualityScope:true,allowedLocales:languages,mfaVerified:role!=='customer',...patch};}
export async function insertActor(actor,{scope='assigned',grants={},verified=true,mfa=actor.role!=='customer'}={},client={query}){await client.query("INSERT INTO users(id,name,email,password_hash,role,active,mfa_enabled,email_verified,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,'non-login isolated lifecycle fixture',$4,true,$5,$6,$7,$8::jsonb,$9,$10::jsonb)",[actor.id,actor.name,actor.email,actor.role,mfa,verified,actor.qualityScope,JSON.stringify(actor.allowedLocales),scope,JSON.stringify(grants)]);}
export async function recordFixture(actor,{id='crm-fixture-'+randomUUID(),collection='leads',status='active',ownerId=actor.id,assigneeId,tags=[],details={},title='Isolated CRM fixture',...extra}={},client={query}){const at=new Date().toISOString(),record={id,collection,status,owner:actor.role,ownerId,...assigneeId?{assigneeId}:{},title:localized(title),summary:localized(''),tags,details,history:[],demo:false,createdAt:at,updatedAt:at,...extra};await client.query("INSERT INTO workspace_entities(bucket,id,collection,status,owner_id,data,created_by,updated_by) VALUES('records',$1,$2,$3,$4,$5::jsonb,$6,$6)",[id,collection,status,actor.role,JSON.stringify(record),actor.id]);return record;}

export async function withCrmRecoveryDatabase(label,run,{beforeMigration}={}){
 const database=process.env.TEST_ADMIN_DATABASE_URL||process.env.MIGRATION_DATABASE_URL||process.env.TEST_DATABASE_URL;
 assert.ok(database,'A real PostgreSQL database is required; skipping is not recovery acceptance.');
 const schema=label+'_'+randomUUID().replaceAll('-',''),control=new pg.Client({connectionString:database});await control.connect();await control.query('CREATE SCHEMA '+schema);
 const scoped=new URL(database);scoped.searchParams.set('options','-c search_path='+schema);
 const storage=await mkdtemp(join(tmpdir(),label+'-'));
 const keys=['DATABASE_URL','STORAGE_DIR','NODE_ENV','DEMO_MODE','PRIVACY_LEDGER_DIR','SESSION_SECRET','MFA_ENCRYPTION_KEY','SITE_URL','NOTIFICATIONS_MODE'],old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{DATABASE_URL:scoped.toString(),STORAGE_DIR:storage,NODE_ENV:'test',SESSION_SECRET:'isolated-crm-recovery-session-secret-32',MFA_ENCRYPTION_KEY:'7'.repeat(64),SITE_URL:'http://localhost:3000',NOTIFICATIONS_MODE:'off'});delete process.env.DEMO_MODE;delete process.env.PRIVACY_LEDGER_DIR;await closeDb();
 try{const migrate=new pg.Client({connectionString:scoped.toString()});await migrate.connect();try{for(const file of(await readdir(new URL('../../db/migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort()){await beforeMigration?.(file,migrate);await migrate.query(await readFile(new URL('../../db/migrations/'+file,import.meta.url),'utf8'));}}finally{await migrate.end();}return await run({control,scoped,storage,schema});}
 finally{await closeDb();for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];await control.query('DROP SCHEMA '+schema+' CASCADE');await control.end();await rm(storage,{recursive:true,force:true});}
}

export async function fixtureHttpSession(actor,{mfa=actor.mfaVerified}={}){
 const raw=randomUUID()+randomUUID(),csrf=randomUUID()+randomUUID(),id=randomUUID();
 await query("INSERT INTO sessions(id,token_hash,user_id,csrf_token,mfa_verified,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[id,hash(raw),actor.id,csrf,mfa]);
 const {handleRequest}=await import('../../src/server/router.ts');
 return{id,async request(path,{method='GET',body,headers={}}={}){const url=new URL('/api/v1'+path,'http://localhost:3000');const request=new Request(url,{method,headers:{cookie:'im_session='+raw,origin:'http://localhost:3000','sec-fetch-site':'same-origin','x-csrf-token':csrf,...body!==undefined?{'content-type':'application/json'}:{},...headers},...body!==undefined?{body:JSON.stringify(body)}:{}});return handleRequest(request,url.pathname.slice('/api/v1/'.length).split('/'));}};
}
