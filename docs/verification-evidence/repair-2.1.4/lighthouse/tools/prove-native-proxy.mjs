#!/usr/bin/env node
/** Bounded scratch-only proof; run only inside the sealed topology supervisor.
 * Cookies, credentials, MFA seeds, private bodies and bucket keys stay in memory.
 * No browser, provider send, extra business record or rate-limit reset.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {ProofError,proofCancellation,boundedHttpRequest} from './proxy-proof-lifecycle.mjs';
import {comparePublicSiteContent} from './proxy-proof-content.mjs';

const options={};
for(let i=2;i<process.argv.length;i++){
 const key=process.argv[i],value=process.argv[++i];
 if(!/^--[a-z-]+$/.test(key)||!value||value.startsWith('--'))throw new Error('Explicit proof options are required.');
 options[key.slice(2)]=value;
}
const expectedKeys=new Set(['project','base-url','upstream-url','build-id','mode','private-run','output']);
if(Object.keys(options).some(key=>!expectedKeys.has(key))||!options.project||!options['base-url']||!options['upstream-url']||!options['build-id']||!options.output||!['public','authenticated'].includes(options.mode))throw new Error('Invalid explicit proof options.');
const project=path.resolve(options.project),output=path.resolve(options.output);
const fixedOrigin=value=>{const u=new URL(value);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||Number(u.port)<=1024||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Explicit loopback HTTP origin required.');return u.origin;};
const base=fixedOrigin(options['base-url']),upstream=fixedOrigin(options['upstream-url']);
if(base===upstream)throw new Error('Distinct public and upstream origins required.');
await fs.mkdir(path.dirname(output),{recursive:true,mode:0o700});
const out=await fs.open(output,'wx',0o600);
const report={format:'native-proxy-bounded-proof-safe-v1',mode:options.mode,startedAt:new Date().toISOString(),buildId:options['build-id'],publicOrigin:base,upstreamOrigin:upstream,status:'incomplete',requestCount:0,checks:[],browserStarted:false,rateLimitsReset:false,additionalBusinessRecordsCreated:false,secretValuesOrHashesExported:false,privateBodiesCookiesMfaSeedsExported:false};
let pool,run,actor,fixtureActivationAttempted=false,runtime,policy,workloadBefore;
const cookies=new Map();
const cancellation=proofCancellation(report);
const check=(condition,code,values={})=>{cancellation.check();report.checks.push({code,passed:condition===true,...values});if(condition!==true)throw new ProofError(code);};
const header=(response,name)=>String(response.headers[name.toLowerCase()]||'');
const sha=value=>createHash('sha256').update(value).digest('hex');
async function request(route,{origin=base,method='GET',body,headers={},jar=false}={}){
 cancellation.check();
 if(!route.startsWith('/')||route.startsWith('//')||!new Set([base,upstream]).has(origin))throw new ProofError('PROOF_REQUEST_SCOPE_INVALID');
 if(++report.requestCount>64)throw new ProofError('PROOF_FINITE_REQUEST_BUDGET_EXCEEDED');
 const payload=body===undefined?undefined:Buffer.from(JSON.stringify(body));
 const sent={Accept:'application/json','Accept-Encoding':'identity',...headers};
 if(jar&&cookies.size)sent.Cookie=[...cookies].map(([key,value])=>key+'='+value).join('; ');
 if(payload){sent['Content-Type']='application/json';sent['Content-Length']=String(payload.length);}
 const response=await boundedHttpRequest(new URL(route,origin),{method,headers:sent},payload,{signal:cancellation.signal});
 if(jar)for(const raw of response.headers['set-cookie']||[]){const pair=raw.split(';',1)[0],index=pair.indexOf('='),key=pair.slice(0,index),value=pair.slice(index+1);if(['im_session','im_guest_csrf'].includes(key)){if(value)cookies.set(key,value);else cookies.delete(key);}}
 const encoding=header(response,'content-encoding');
 if(encoding&&encoding!=='gzip')throw new ProofError('PROOF_UNEXPECTED_CONTENT_ENCODING');
 try{response.decoded=encoding==='gzip'?gunzipSync(response.raw,{maxOutputLength:8*1024*1024}):response.raw;}catch{throw new ProofError('PROOF_GZIP_DECODE_FAILED');}
 return response;
}
const data=response=>{try{return JSON.parse(response.decoded.toString('utf8'));}catch{throw new ProofError('PROOF_JSON_INVALID');}};
async function api(endpoint,body,{headers={},allowStatus=200}={}){
 let csrfToken;
 if(body!==undefined){const session=await request('/api/v1/auth/session',{jar:true});check(session.status===200,'PROOF_CSRF_SESSION_HTTP');csrfToken=data(session).csrfToken;check(typeof csrfToken==='string'&&csrfToken.length>20,'PROOF_CSRF_TOKEN_PRESENT');}
 const response=await request('/api/v1'+endpoint,{jar:true,method:body===undefined?'GET':'POST',body,headers:body===undefined?headers:{Origin:base,'X-CSRF-Token':csrfToken,...headers}});
 check(response.status===allowStatus,'PROOF_API_HTTP',{httpStatus:response.status,expectedStatus:allowStatus});
 return {response,value:data(response)};
}
async function compression(route,{jar=false,privateResponse=false}={}){
 const identity=await request(route,{jar}),gzip=await request(route,{jar,headers:{'Accept-Encoding':'gzip'}});
 check(identity.status===200&&gzip.status===200,'PROOF_COMPRESSION_HTTP_200');
 check(header(identity,'content-encoding')===''&&header(gzip,'content-encoding')==='gzip','PROOF_NEGOTIATED_GZIP');
 check(/\baccept-encoding\b/i.test(header(gzip,'vary')),'PROOF_COMPRESSION_VARY');
 check(/^application\/json\b/i.test(header(gzip,'content-type')),'PROOF_JSON_MIME');
 if(route==='/api/v1/site'&&!privateResponse){
  const comparison=comparePublicSiteContent(identity.decoded,gzip.decoded);
  check(comparison.bothObservedAtValuesValid,'PROOF_PUBLIC_SITE_CANONICAL_OBSERVED_AT');
  check(comparison.structuralContentEqualExcludingTopLevelObservedAt,'PROOF_PUBLIC_SITE_STRUCTURAL_CONTENT_EQUAL_EXCEPT_OBSERVED_AT',{
   rawDecodedBytesEqual:comparison.rawDecodedBytesEqual,comparisonScope:'Structural content equality excluding only validated top-level observedAt'
  });
 }else check(identity.decoded.equals(gzip.decoded),'PROOF_DECODED_RESPONSES_EQUAL');
 check(gzip.raw.length<identity.raw.length,'PROOF_JSON_TRANSFER_SMALLER',{identityBytes:identity.raw.length,gzipBytes:gzip.raw.length,decodedBytes:gzip.decoded.length,httpVersion:gzip.httpVersion});
 if(privateResponse)check(/\bprivate\b/i.test(header(gzip,'cache-control'))&&/\bno-store\b/i.test(header(gzip,'cache-control')),'PROOF_PRIVATE_COMPRESSION_REMAINS_NO_STORE');
 return gzip;
}
try{
 check((await fs.readFile(path.join(project,'.next/BUILD_ID'),'utf8')).trim()===report.buildId,'PROOF_BUILD_ID_MATCH');
 check(process.env.NODE_ENV==='production'&&process.env.TRUST_PROXY==='true'&&process.env.SITE_URL===base,'PROOF_RUNTIME_ENV_SCOPE');
 if(options.mode==='public'){
  const ready=await request('/api/v1/health/ready'),readyBody=data(ready);
  check(ready.status===200&&readyBody.status==='ok'&&readyBody.privacy==='ready','PROOF_READINESS');
  await compression('/api/v1/site');
  const redirect=await request('/en/contact');
  check(redirect.status===308&&new URL(header(redirect,'location'),base).href===base+'/en/contact/','PROOF_CANONICAL_REDIRECT_ORIGIN');
  const document=await request('/en/contact/'),html=document.decoded.toString('utf8'),csp=header(document,'content-security-policy'),nonce=/\bnonce-([^']+)'/.exec(csp)?.[1];
  check(document.status===200&&/<html\b[^>]*\blang="en"/i.test(html),'PROOF_PUBLIC_DOCUMENT_LANGUAGE');
  check(html.includes('href="'+base+'/en/contact/"')&&!html.includes('href="'+upstream),'PROOF_PUBLIC_DOCUMENT_ORIGIN');
  check(typeof nonce==='string'&&html.includes('nonce="'+nonce+'"'),'PROOF_CSP_NONCE_PRESERVED');
  check(header(document,'x-content-type-options')==='nosniff'&&header(document,'permissions-policy').includes('camera=()')&&header(document,'server')==='','PROOF_PROXY_SECURITY_HEADERS');
  const privateDocument=await request('/en/admin/'),privateHtml=privateDocument.decoded.toString('utf8');
  check(privateDocument.status===200&&(/noindex/i.test(header(privateDocument,'x-robots-tag'))||/<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(privateHtml)),'PROOF_PRIVATE_DOCUMENT_NOINDEX');
  const anonymous=await request('/api/v1/workspace');
  check(anonymous.status===401&&/\bno-store\b/.test(header(anonymous,'cache-control')),'PROOF_ANONYMOUS_WORKSPACE_DENIED');
  const icon=await request('/icons/idealmakoo-192.png'),source=await fs.readFile(path.join(project,'public/icons/idealmakoo-192.png'));
  check(icon.status===200&&icon.decoded.equals(source),'PROOF_PUBLIC_ICON_BYTE_IDENTITY');
  const imageRoute='/_next/image?url=%2Fmedia%2Fofficial%2F1689235166.jpg&w=480&q=75';
  const proxied=await request(imageRoute,{headers:{Accept:'image/webp'}}),direct=await request(imageRoute,{origin:upstream,headers:{Accept:'image/webp'}});
  const require=createRequire(path.join(project,'package.json'));const metadata=await require('sharp')(proxied.decoded).metadata();
  check(proxied.status===200&&direct.status===200&&header(proxied,'content-type')==='image/webp'&&proxied.decoded.equals(direct.decoded)&&metadata.width===480,'PROOF_OPTIMIZER_BYTE_AND_WIDTH_IDENTITY',{decodedWidth:metadata.width,bytes:proxied.decoded.length});
 }else{
  check(typeof options['private-run']==='string','PROOF_OWNED_RUN_REQUIRED');
  const runRoot=path.resolve(options['private-run']);
  const manifestExists=await fs.access(path.join(runRoot,'manifest.json')).then(()=>true).catch(()=>false);
  check(!manifestExists,'PROOF_MUST_PRECEDE_INVENTORY_FREEZE');
  run=JSON.parse(await fs.readFile(path.join(runRoot,'run-context.json'),'utf8'));
  runtime=await import(pathToFileURL(path.join(project,'scripts/lib/private-audit-runtime.mjs')));
  policy=await import(pathToFileURL(path.join(project,'scripts/lib/private-audit-policy.mjs')));
  const connection=await runtime.auditDatabase(process.env,base);pool=connection.pool;
  check(run.databaseIdentity===connection.context.databaseIdentity&&run.baseUrl===base,'PROOF_GUARDED_RUN_DATABASE_MATCH');
  const actors=policy.auditRoles.map(role=>policy.privateFixtureActor(run.runId,role,process.env.MFA_ENCRYPTION_KEY));
  const ids=actors.map(item=>item.id),existing=(await pool.query('SELECT id,email,role,active FROM users WHERE id=ANY($1::text[])',[ids])).rows;
  check(existing.length===12&&actors.every(item=>existing.some(row=>row.id===item.id&&row.email===item.email&&row.role===item.role&&!row.active)),'PROOF_ALL_TWELVE_PREPARED_ACTORS_DISABLED');
  actor=actors.find(item=>item.role==='superAdmin');
  const fresh=(await pool.query('SELECT mfa_enabled FROM users WHERE id=$1',[actor.id])).rows[0];
  check(fresh?.mfa_enabled===false,'PROOF_FRESH_OWNED_MFA_ACTOR_REQUIRED');
  workloadBefore=await runtime.privateWorkloadIdentity(pool);
  fixtureActivationAttempted=true;
  await runtime.prepareFixtureActors(pool,run.runId,['superAdmin'],process.env.MFA_ENCRYPTION_KEY);
  const expectedIp=sha(process.env.SESSION_SECRET+':ip:127.0.0.1'),spoofIps=['198.51.100.21','203.0.113.22'];
  const visitorKeys=[expectedIp,...spoofIps.map(ip=>sha(process.env.SESSION_SECRET+':ip:'+ip)),sha(process.env.SESSION_SECRET+':ip:direct')];
  const bucketKeys=visitorKeys.map(value=>sha('login:ip:'+value));
  const buckets=async()=>{const rows=(await pool.query('SELECT key,count,reset_at,clock_timestamp() AS observed_at FROM rate_limits WHERE key=ANY($1::text[])',[bucketKeys])).rows;return bucketKeys.map(key=>rows.find(row=>row.key===key)||null);};
  const before=await buckets();
  check(before.every(row=>!row||Number(row.count)<25&&new Date(row.reset_at).getTime()>new Date(row.observed_at).getTime()+60000),'PROOF_EXISTING_LOGIN_BUDGET_SUFFICIENT');
  const deniedCsrf=await request('/api/v1/auth/login',{method:'POST',body:{email:actor.email,password:actor.password},headers:{Origin:base}});
  check(deniedCsrf.status===403&&data(deniedCsrf).code==='CSRF','PROOF_MISSING_CSRF_DENIED');
  const deniedOrigin=await api('/auth/login',{email:actor.email,password:actor.password},{allowStatus:403,headers:{Origin:'http://example.invalid'}});
  check(deniedOrigin.value.code==='ORIGIN','PROOF_FOREIGN_ORIGIN_DENIED');
  const forwarded=ip=>({'X-Forwarded-For':ip,'X-Real-IP':ip,'X-Forwarded-Proto':'https'});
  const first=await api('/auth/login',{email:actor.email,password:actor.password},{headers:forwarded(spoofIps[0])});
  check(first.value.user?.id===actor.id&&first.value.user?.role==='superAdmin'&&first.value.mfaEnrollmentRequired===true,'PROOF_REAL_INITIAL_LOGIN');
  const preMfa=await api('/workspace',undefined,{allowStatus:403});check(preMfa.value.code==='MFA_REQUIRED','PROOF_STAFF_MFA_ENFORCED');
  const enrollment=await api('/auth/mfa/enroll',{password:actor.password});
  check(typeof enrollment.value.secret==='string','PROOF_REAL_MFA_ENROLLMENT');
  await api('/auth/mfa/confirm',{code:runtime.totp(enrollment.value.secret,Math.floor(Date.now()/30000))});
  enrollment.value=null;
  const session=await api('/auth/session');check(session.value.user?.id===actor.id&&session.value.user?.mfaEnabled===true,'PROOF_MFA_SESSION_IDENTITY');
  await compression('/api/v1/workspace',{jar:true,privateResponse:true});
  await api('/auth/logout',{});
  const second=await api('/auth/login',{email:actor.email,password:actor.password},{headers:forwarded(spoofIps[1])});
  check(second.value.mfaRequired===true&&typeof second.value.challengeToken==='string','PROOF_REAL_SECOND_LOGIN_CHALLENGE');
  const mfa=(await pool.query('SELECT email,role,mfa_enabled,mfa_secret,mfa_last_counter FROM users WHERE id=$1',[actor.id])).rows[0];
  check(mfa?.email===actor.email&&mfa.role==='superAdmin'&&mfa.mfa_enabled&&typeof mfa.mfa_secret==='string','PROOF_OWNED_MFA_PROOF_SOURCE');
  const nextAllowed=(Number(mfa.mfa_last_counter)+1)*30000+150,wait=Math.max(0,nextAllowed-Date.now());
  check(wait<=31000,'PROOF_REAL_MFA_COUNTER_WAIT_BOUNDED');if(wait>0)await delay(wait,undefined,{signal:cancellation.signal});
  await api('/auth/mfa/verify',{challengeToken:second.value.challengeToken,code:runtime.totp(runtime.decrypt(mfa.mfa_secret),Math.floor(Date.now()/30000))});
  const accepted=await api('/workspace');check(accepted.response.status===200,'PROOF_REAL_MFA_WORKSPACE_ACCESS');
  const current=(await pool.query('SELECT ip_hash,mfa_verified FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[actor.id])).rows;
  check(current.length===1&&current[0].ip_hash===expectedIp&&current[0].mfa_verified===true,'PROOF_SESSION_USES_REAL_PROXY_CLIENT_IP');
  const after=await buckets();
  check(after[0]?.count===Number(before[0]?.count||0)+2&&after.slice(1).every((row,index)=>Number(row?.count||0)===Number(before[index+1]?.count||0)),'PROOF_FORGED_FORWARDING_HEADERS_CANNOT_SELECT_BUCKET',{expectedBucketIncrement:2,forgedOrDirectBucketsUnchanged:true});
  await api('/auth/logout',{});
  check((await runtime.privateWorkloadIdentity(pool)).hash===workloadBefore.hash,'PROOF_BUSINESS_WORKLOAD_UNCHANGED');
 }
 report.status='passed';
}catch(error){report.status='failed';report.errorCode=cancellation.signal.aborted?'PROOF_INTERRUPTED':error instanceof ProofError?error.code:'PROOF_OPERATION_FAILED';}
finally{
 if(fixtureActivationAttempted&&pool&&run&&actor){
  let client;
  try{
   client=await pool.connect();
   // This setting belongs only to the short-lived proof connection. It cannot
   // change the application's sessions, limits or database role policy.
   await client.query("SET statement_timeout='5s'");
   await runtime.closeFixtureActors(client,run.runId,['superAdmin'],process.env.MFA_ENCRYPTION_KEY);
   const state=(await client.query('SELECT (SELECT count(*)::int FROM users WHERE id=$1 AND active) AS active,(SELECT count(*)::int FROM sessions WHERE user_id=$1 AND revoked_at IS NULL) AS live',[actor.id])).rows[0];
   report.cleanup={attempted:true,ownedActorDisabled:state.active===0,ownedSessionsRevoked:state.live===0,proofConnectionStatementDeadlineMs:5000};
   if(state.active!==0||state.live!==0){report.status='failed';report.cleanup.errorCode='PROOF_OWNED_ACTOR_CLEANUP_INCOMPLETE';}
  }catch{report.cleanup={attempted:true,passed:false,errorCode:'PROOF_OWNED_ACTOR_CLEANUP_FAILED'};report.status='failed';}
  finally{client?.release(true);}
 }
 cookies.clear();if(pool)try{await pool.end();}catch{report.status='failed';report.poolCloseErrorCode='PROOF_DATABASE_POOL_CLOSE_FAILED';}
 if(cancellation.signal.aborted){report.status='failed';report.errorCode||='PROOF_INTERRUPTED';}
 report.finishedAt=new Date().toISOString();
 await out.writeFile(JSON.stringify(report,null,2)+'\n');await out.close();
 cancellation.close();
 console.log(JSON.stringify({event:'bounded-proxy-proof',mode:report.mode,status:report.status,requests:report.requestCount,checks:report.checks.length,errorCode:report.errorCode||null}));
 if(report.status!=='passed')process.exitCode=2;
}
