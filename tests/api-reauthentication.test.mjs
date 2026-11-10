import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('HTTP client preserves a valid session after rejected password/MFA proofs but expires missing and unknown sessions',()=>{
 const code=`
  import assert from 'node:assert/strict';
  import {HttpClient,ApiError,setCsrfToken,networkError} from './src/lib/api.ts';
  globalThis.window=new EventTarget();let expired=0;
  window.addEventListener('idealmakoo:session-expired',()=>expired++);
  setCsrfToken('isolated-csrf-fixture');const client=new HttpClient('/api/v1');
  for(const [path,errorCode,status] of [['/auth/mfa/recovery-codes','INVALID_CREDENTIALS',401],['/auth/mfa/verify','MFA_INVALID',401],['/auth/mfa/recovery-codes','MFA_INVALID',422],['/users/isolated-staff/mfa-reset','INVALID_CREDENTIALS',401],['/users/isolated-staff/mfa-reset','MFA_INVALID',422]]){
   globalThis.fetch=async(url,options)=>{assert.equal(options.headers.get('X-CSRF-Token'),'isolated-csrf-fixture');return Response.json({code:errorCode,title:'Rejected proof'},{status});};
   await assert.rejects(client.request(path,{method:'POST',body:'{}'}),error=>{assert.ok(error instanceof ApiError);assert.equal(error.problem.code,errorCode);for(const language of ['fa','en','tr','ar','ru'])assert.notEqual(networkError(error,language),networkError(new ApiError({status:401,title:'Expired',code:'SESSION_REQUIRED'}),language));return true;});
   assert.equal(expired,0);
  }
  for(const errorCode of ['SESSION_REQUIRED','UNKNOWN_AUTH_FAILURE']){
   globalThis.fetch=async()=>Response.json({code:errorCode},{status:401});
   await assert.rejects(client.request('/me/security'),error=>error instanceof ApiError&&error.status===401);
  }
  assert.equal(expired,2);console.log('Re-authentication error handling passed');
 `;
 const output=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:20000});
 assert.match(output,/Re-authentication error handling passed/);
});
