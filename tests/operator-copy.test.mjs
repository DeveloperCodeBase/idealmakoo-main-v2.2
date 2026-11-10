import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadTs} from './helpers/load-ts.mjs';

const {wt,workspaceLocales}=await loadTs('src/components/workspace/i18n.ts');
const {accountText}=await loadTs('src/components/account/account-copy.ts');
const root=fileURLToPath(new URL('../',import.meta.url));

test('operator controls resolve every statically selected shared label in all five languages',()=>{
  const used=new Map();
  function visit(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())visit(path);
    else if(/\.tsx?$/.test(path))for(const match of readFileSync(path,'utf8').matchAll(/\bwt\(\s*['"]([^'"]+)['"]/g))used.set(match[1],path);
  }}
  visit(join(root,'src/components'));
  for(const key of ['email','sms','telegram','push','other','team','territory','active','inactive','pending','running','queued','failed','cancelled','completed','rejected','submitted','inReview','accepted'])used.set(key,'Typed operator control options');
  assert.ok(used.size>90,'The check must cover actual component calls.');
  for(const [key,path] of used)for(const locale of workspaceLocales){
    assert.ok(wt(key,locale).trim(),`${locale}:${key} in ${path}`);
    if(locale==='fa')assert.notEqual(wt(key,locale),key,`Untranslated operator key ${key} in ${path}`);
  }
  for(const key of ['bookings','dataRooms','refresh'])for(const locale of workspaceLocales)assert.notEqual(accountText(locale,key,value=>value),key,`${locale}:${key}`);
});

test('production operator and recovery wording cannot retain the demo claims even with a demo flag',()=>{
  const directory=mkdtempSync(join(tmpdir(),'idealmakoo-operator-copy-')),resultPath=join(directory,'result.json');
  try{
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import{writeFileSync}from'node:fs';
    import{loadTs}from'./tests/helpers/load-ts.mjs';
    const{wt}=await loadTs('src/components/workspace/i18n.ts');
    const{accountText}=await loadTs('src/components/account/account-copy.ts');
    writeFileSync(process.env.IDEALMAKOO_COPY_RESULT,JSON.stringify({publish:wt('publish','en'),published:wt('publishedNotice','en'),schedule:wt('scheduledHint','en'),recovery:accountText('en','recoveryCodes',key=>key),upload:wt('uploadError','en')}),{mode:0o600});
  `],{cwd:root,env:{...process.env,NODE_ENV:'production',NEXT_PUBLIC_DEMO_MODE:'true',NODE_NO_WARNINGS:'1',IDEALMAKOO_COPY_RESULT:resultPath},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const values=JSON.parse(readFileSync(resultPath,'utf8'));
  assert.equal(values.publish,'Publish this language');assert.equal(values.published,'This language revision was published.');
  assert.match(values.schedule,/stored on the server/);assert.equal(values.recovery,'Recovery codes');
  assert.match(values.upload,/administrator limit/);
  assert.doesNotMatch(values.upload,/\b\d+\s*(?:MB|MiB)\b/,'Production upload errors must refer to the current policy instead of a stale fixed quota.');
  for(const value of Object.values(values))assert.doesNotMatch(value,/\bdemo\b|locally|future backend|saved in this browser/i);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
