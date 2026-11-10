import pg from 'pg';
import {createRequire} from 'node:module';
import {privateAuditContext,privateFixtureActor,auditHash} from './private-audit-policy.mjs';

const require=createRequire(import.meta.url);
const {passwordHash,passwordMatches,totp,decrypt}=require('../../src/server/crypto.ts');
export {totp,decrypt};

export async function auditDatabase(environment,baseUrl){
 const context=privateAuditContext(environment,baseUrl),pool=new pg.Pool({connectionString:context.databaseUrl,max:2,connectionTimeoutMillis:10000,statement_timeout:20000});
 try{const actual=(await pool.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];if(actual?.database!==context.databaseName||actual?.schema!=='public')throw new Error('Connected database/schema differs from the guarded disposable target.');return{pool,context};}catch(error){await pool.end();throw error;}
}

export async function prepareFixtureActors(pool,runId,roles,key){
 for(const role of roles){
  const actor=privateFixtureActor(runId,role,key),client=await pool.connect();
  try{
   await client.query('BEGIN');let current=(await client.query('SELECT id,email,name,role,password_hash,quality_scope,allowed_locales,crm_scope,crm_permissions FROM users WHERE id=$1 OR email=$2 FOR UPDATE',[actor.id,actor.email])).rows;
   if(current.length){
    const row=current[0];if(current.length!==1||row.id!==actor.id||row.email!==actor.email||row.name!==actor.name||row.role!==role||!await passwordMatches(actor.password,row.password_hash))throw new Error('Owned audit fixture identity changed; use a new disposable audit run.');
    await client.query('UPDATE users SET active=true WHERE id=$1 AND email=$2',[actor.id,actor.email]);
   }else{
    const staff=role!=='customer';await client.query('INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales,quality_scope,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,true,$6::jsonb,$7,$8,$9::jsonb)',[actor.id,actor.email,actor.name,await passwordHash(actor.password),role,JSON.stringify(actor.allowedLocales),staff,staff?'all':'assigned',JSON.stringify(staff?{contact:true,financial:true,baseCost:true,assign:true,intake:true}:{})]);
    await client.query('INSERT INTO user_settings(user_id) VALUES($1)',[actor.id]);
   }
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
}

export async function closeFixtureActors(pool,runId,roles,key){
 for(const role of roles){const actor=privateFixtureActor(runId,role,key);await pool.query('UPDATE users SET active=false WHERE id=$1 AND email=$2 AND role=$3',[actor.id,actor.email,role]);await pool.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1',[actor.id]);}
}

/** Cookie jar remains inside this function; it is never serialized or logged. */
export async function ensureOwnedAuditRequest(pool,run,baseUrl,key){
 const actor=privateFixtureActor(run.runId,'customer',key),message='Disposable Lighthouse owned-request fixture '+run.runId;
 const existing=(await pool.query('SELECT id FROM requests WHERE owner_id=$1 AND data->>\'message\'=$2 ORDER BY created_at,id',[actor.id,message])).rows;
 if(existing.length>1)throw new Error('Owned request fixture is ambiguous.');
 if(existing.length===1)return existing[0].id;
 const cookies=new Map();
 const request=async(endpoint,{method='GET',body,csrfToken}={})=>{
  const headers={'Accept':'application/json',...cookies.size?{Cookie:[...cookies].map(([name,value])=>name+'='+value).join('; ')}:{}};
  if(method!=='GET')Object.assign(headers,{'Content-Type':'application/json',Origin:baseUrl,'X-CSRF-Token':csrfToken,'Idempotency-Key':'lighthouse-owned-request-'+run.runId});
  const response=await fetch(baseUrl+'/api/v1'+endpoint,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';',1)[0],separator=pair.indexOf('='),name=pair.slice(0,separator),value=pair.slice(separator+1);if(['im_session','im_guest_csrf'].includes(name)){if(value)cookies.set(name,value);else cookies.delete(name);}}
  const data=await response.json().catch(()=>null);if(!response.ok){const error=new Error('Private fixture API operation was rejected.');error.code='AUDIT_FIXTURE_HTTP_'+response.status;throw error;}return data;
 };
 const mutate=async(endpoint,body)=>{const session=await request('/auth/session');if(typeof session?.csrfToken!=='string')throw new Error('Missing fixture CSRF token.');return request(endpoint,{method:'POST',body,csrfToken:session.csrfToken});};
 try{
  const login=await mutate('/auth/login',{email:actor.email,password:actor.password});
  if(login?.mfaRequired)throw new Error('The customer audit fixture unexpectedly requires MFA.');
  const session=await request('/auth/session');if(session?.user?.id!==actor.id||session.user.role!=='customer')throw new Error('The live application does not use the guarded disposable database.');
  const result=await mutate('/requests',{kind:'support_ticket',name:actor.name,email:actor.email,message,locale:'fa',productIds:[],consent:{purpose:'request_processing',acceptedAt:run.createdAt}});
  if(typeof result?.id!=='string')throw new Error('The application did not return a real request identity.');
  const row=(await pool.query('SELECT owner_id,data FROM requests WHERE id=$1',[result.id])).rows[0];if(row?.owner_id!==actor.id||row.data?.message!==message)throw new Error('The returned request does not belong to the guarded fixture.');
  return result.id;
 }finally{if(cookies.has('im_session'))await mutate('/auth/logout',{}).catch(()=>{});cookies.clear();}
}

/** Exclude intentionally volatile sessions, telemetry and append-only auth logs. */
export async function privateWorkloadIdentity(pool){
 const tables=[
  ['workspace_entities','SELECT bucket,id,revision_number,data,deleted_at FROM workspace_entities ORDER BY bucket,id'],
  ['workspace_meta','SELECT singleton,version,settings,preferences_draft,preferences_published FROM workspace_meta ORDER BY singleton'],
  ['requests','SELECT id,owner_id,version,data FROM requests ORDER BY id'],
  ['locale_releases','SELECT document_bucket,document_id,locale,release_number,publication,unpublished_at FROM locale_releases ORDER BY document_bucket,document_id,locale'],
 ];
 const identities={};for(const [name,query] of tables)identities[name]=auditHash((await pool.query(query)).rows);return{tables:identities,hash:auditHash(identities)};
}
