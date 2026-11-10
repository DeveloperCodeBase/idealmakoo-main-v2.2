import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('upload quota and validation failures keep actionable guidance in the selected language without leaking server details',()=>{
 const code=`
  import assert from 'node:assert/strict';
  import {HttpClient,ApiError,setCsrfToken,networkError} from './src/lib/api.ts';
  setCsrfToken('localization-csrf-fixture');const client=new HttpClient('/api/v1');
  const serverDetail='UNLOCALIZED_SERVER_DETAIL with private record information';
  for(const [status,code] of [[400,'MULTIPART_INVALID'],[413,'UPLOAD_SIZE'],[507,'STORAGE_USER_QUOTA'],[507,'STORAGE_QUOTA'],[422,'VALIDATION'],[415,'UPLOAD_TYPE'],[503,'SCANNER_UNAVAILABLE']]){
   globalThis.fetch=async()=>Response.json({title:'Server error',detail:serverDetail,code},{status});
   await assert.rejects(client.request('/media',{method:'POST',body:new FormData()}),error=>{
    assert.ok(error instanceof ApiError);assert.equal(error.problem.detail,serverDetail);
    const messages=['fa','en','tr','ar','ru'].map(locale=>networkError(error,locale));
    assert.equal(new Set(messages).size,5);
    for(const [index,locale] of ['fa','en','tr','ar','ru'].entries()){
     assert.ok(messages[index].length>20);assert.ok(!messages[index].includes(serverDetail));
     assert.notEqual(messages[index],networkError(new TypeError('Network failed'),locale));
    }
    assert.equal(networkError(error,'unsupported-locale'),messages[1]);
    if(code==='STORAGE_USER_QUOTA')assert.match(messages[0],/سهمیه/);
    return true;
   });
  }
  const unknown=new ApiError({status:500,title:'INTERNAL_DATABASE_ERROR',detail:serverDetail,code:'UNREVIEWED_CODE'});
  for(const locale of ['fa','en','tr','ar','ru'])assert.ok(!networkError(unknown,locale).includes(serverDetail));
  console.log('Localized upload and validation guidance passed');
 `;
 const output=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:20000});
 assert.match(output,/Localized upload and validation guidance passed/);
});
