import pg from 'pg';

const loopback=new Set(['127.0.0.1','localhost','[::1]']);
const disposableName=/^(?:idealmakoo_test|idealmakoo_acceptance\d*_\d{13}_[a-f0-9]{8}|idealmakoo_repair_acceptance_\d{13}_[a-f0-9]{6})$/;

/** Deliberately available only in opted-in, named disposable test databases. */
export function disposableAuthBudgetContext(environment:NodeJS.ProcessEnv=process.env){
 if(environment.PLAYWRIGHT_DISPOSABLE_AUTH_BUDGET!=='true')throw new Error('The acceptance auth-budget fixture requires PLAYWRIGHT_DISPOSABLE_AUTH_BUDGET=true.');
 if(!environment.TEST_DATABASE_URL||!environment.DATABASE_URL)throw new Error('Explicit TEST_DATABASE_URL and DATABASE_URL are required for the acceptance auth-budget fixture.');
 let testDatabase:URL,runtimeDatabase:URL,site:URL;
 try{testDatabase=new URL(environment.TEST_DATABASE_URL);runtimeDatabase=new URL(environment.DATABASE_URL);site=new URL(environment.PLAYWRIGHT_BASE_URL||environment.SITE_URL||'');}catch{throw new Error('The acceptance auth-budget fixture requires valid explicit database and site URLs.');}
 for(const database of[testDatabase,runtimeDatabase])if(!['postgres:','postgresql:'].includes(database.protocol)||!loopback.has(database.hostname)||database.search||database.hash)throw new Error('The auth-budget fixture requires a loopback test database without connection-option overrides.');
 const databaseName=decodeURIComponent(testDatabase.pathname.slice(1));
 if(!disposableName.test(databaseName)||testDatabase.hostname!==runtimeDatabase.hostname||(testDatabase.port||'5432')!==(runtimeDatabase.port||'5432')||testDatabase.pathname!==runtimeDatabase.pathname)throw new Error('The test database must equal the runtime target and use the documented disposable acceptance/CI name.');
 if(!['http:','https:'].includes(site.protocol)||!loopback.has(site.hostname)||site.username||site.password||site.pathname!=='/'||site.search||site.hash)throw new Error('The auth-budget fixture requires an explicit loopback application origin.');
 // A trusted proxy's observed source must be unambiguous; local CI uses direct
 // transport and the acceptance Caddy address is explicitly IPv4 loopback.
 if(environment.TRUST_PROXY==='true'&&site.hostname!=='127.0.0.1')throw new Error('Trusted-proxy acceptance requires explicit 127.0.0.1 so only its exact IP buckets can be selected.');
 return{databaseName,testDatabaseUrl:environment.TEST_DATABASE_URL,siteUrl:site.origin};
}

export async function resetDisposableAuthBudget(suppliedPool?:pg.Pool){
 const scope=disposableAuthBudgetContext(),pool=suppliedPool||new pg.Pool({connectionString:scope.testDatabaseUrl,max:1});
 const [{hash},{visitorKey}]=await Promise.all([import('@/server/crypto'),import('@/server/http')]);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const actual=await client.query<{database:string;schema:string}>('SELECT current_database() AS database,current_schema() AS schema');
  if(actual.rows[0]?.database!==scope.databaseName||actual.rows[0]?.schema!=='public')throw new Error('The connected database/schema does not match the explicitly guarded acceptance target.');
  const visitor=visitorKey(new Request(scope.siteUrl+'/api/v1/auth/login',{headers:{'x-forwarded-for':'127.0.0.1'}}));
  const keys=[hash('login:ip:'+visitor),hash('mfa:'+visitor)];
  const removed=await client.query('DELETE FROM rate_limits WHERE key=ANY($1::text[])',[keys]);
  await client.query('COMMIT');
  return{scope:'two-loopback-auth-ip-buckets',removed:removed.rowCount||0};
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();if(!suppliedPool)await pool.end();}
}
