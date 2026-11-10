import {test,expect,type APIRequestContext,type Page,type Locator} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,realpath} from 'node:fs/promises';
import {isAbsolute,sep} from 'node:path';
import pg from 'pg';
import {totp} from '../../src/server/crypto';
import {resetDisposableAuthBudget} from './helpers/auth-budget';

const execute=promisify(execFile),baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const identity=randomUUID().replaceAll('-','').slice(0,18);
const initialPassword='PanelMFAInitial-'+identity+'-A9',replacement='PanelMFARecovered-'+identity+'-Z8',wrongPassword='PanelMFAWrong-'+identity+'-Q7';
const owner={key:'e2e-mfa-owner-'+identity,id:'',name:'Panel MFA owner '+identity,email:`panel-mfa-owner-${identity}@example.test`};
const staff={id:'',name:'Panel MFA staff '+identity,email:`panel-mfa-staff-${identity}@example.test`};

// Recovery secrets never enter automatic Playwright attachments. Explicit
// private capture below is opt-in and goes only to the bound external root.
test.use({trace:'off',screenshot:'off',video:'off'});
async function fillCredential(locator:Locator,value:string){
 try{await locator.fill(value);}catch{throw new Error('The owned MFA credential field could not be filled.');}
}
async function mutate(api:APIRequestContext,path:string,data:unknown,known:Set<string>){
 try{
 const session=await api.get('/api/v1/auth/session');expect(session.status()).toBe(200);const {csrfToken}=await session.json();
 if(typeof csrfToken==='string')known.add(csrfToken);
 const response=await api.post('/api/v1'+path,{data,headers:{Origin:baseURL,'X-CSRF-Token':csrfToken}});
 for(const cookie of (await api.storageState()).cookies)known.add(cookie.value);
 const payload=await response.json();if(typeof payload.csrfToken==='string')known.add(payload.csrfToken);
 return response;
 }catch{throw new Error('The owned MFA API mutation did not produce a checked response.');}
}
async function enroll(api:APIRequestContext,password:string,known:Set<string>){
 const started=await mutate(api,'/auth/mfa/enroll',{password},known);expect(started.status()).toBe(200);const {secret}=await started.json();expect(typeof secret==='string'&&secret.length>=8).toBe(true);known.add(secret);
 const counter=Math.floor(Date.now()/30000),code=totp(secret,counter);
 const confirmed=await mutate(api,'/auth/mfa/confirm',{code},known);expect(confirmed.status()).toBe(200);
 const {recoveryCodes}=await confirmed.json();expect(Array.isArray(recoveryCodes)&&recoveryCodes.length===10&&recoveryCodes.every((value:unknown)=>typeof value==='string'&&value.length>=8)).toBe(true);for(const value of recoveryCodes)known.add(value);
 return{secret,counter};
}
function responseFor(page:Page,path:string,method:string){return page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')==='/api/v1'+path&&response.request().method()===method);}
async function browserLogin(page:Page,email:string,password:string,known:Set<string>){
 await page.goto('/en/auth/login/');await fillCredential(page.locator('input[name="email"]'),email);await fillCredential(page.locator('input[name="password"]'),password);
 const pending=responseFor(page,'/auth/login','POST');await page.locator('form button[type="submit"]').click();const response=await pending;
 for(const cookie of await page.context().cookies())known.add(cookie.value);
 const payload=await response.json();if(typeof payload.csrfToken==='string')known.add(payload.csrfToken);
 return response;
}

test('senior panel recovery requires fresh proof, clears old staff access and forces real MFA enrollment',async({page,context,browser},testInfo)=>{
 test.setTimeout(240000);
 const database=process.env.TEST_ADMIN_DATABASE_URL||process.env.MIGRATION_DATABASE_URL||process.env.TEST_DATABASE_URL||process.env.DATABASE_URL||'';
 if(!database)throw new Error('Panel MFA acceptance requires a migrated, named disposable database.');
 if(process.env.NOTIFICATIONS_MODE!=='disabled')throw new Error('Panel MFA acceptance requires externally disabled notification delivery.');
 const capture=process.env.PLAYWRIGHT_CAPTURE_PRIVATE_KNOWN_VALUES==='true';
 if(capture){
  const requested=process.env.PLAYWRIGHT_PRIVATE_KNOWN_VALUES_ROOT;
  if(!requested||!isAbsolute(requested))throw new Error('Private MFA marker capture requires an explicit absolute private output root.');
  const [actual,required,product]=await Promise.all([realpath(testInfo.project.outputDir),realpath(requested),realpath(process.cwd())]);
  if(actual!==required||actual===product||actual.startsWith(product+sep))throw new Error('Private MFA marker capture must use the exact root-specified Playwright output directory outside the product.');
 }
 const pool=new pg.Pool({connectionString:database,max:2}),known=new Set([identity,initialPassword,replacement,wrongPassword,owner.email,staff.email,owner.name,staff.name,owner.key]);
 const ownedIds:string[]=[],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 let creationWindowOpened=false;
 let visitor:Awaited<ReturnType<typeof browser.newContext>>|undefined;
 try{
  // The existing guard proves exact loopback runtime/test database identity.
  await resetDisposableAuthBudget(pool);
  expect((await pool.query('SELECT 1 FROM users WHERE email=ANY($1::text[])',[[owner.email,staff.email]])).rowCount).toBe(0);
  expect((await pool.query('SELECT 1 FROM staff_provisioned_accounts WHERE provision_key=$1',[owner.key])).rowCount).toBe(0);
  creationWindowOpened=true;
  const roster=[{key:owner.key,email:owner.email,name:owner.name,role:'superAdmin',password:initialPassword,allowedLocales:['fa','en','tr','ar','ru'],crmScope:'all',crmPermissions:{contact:true,financial:true,baseCost:true,assign:true,intake:true}}];
  const script="import {provisionStaffAccounts} from './src/server/staff-provisioning.ts'; import {closeDb} from './src/server/db.ts'; provisionStaffAccounts({env:{STAFF_ACCOUNTS_JSON:process.env.STAFF_ACCOUNTS_JSON}}).then(result=>process.stdout.write(JSON.stringify(result))).catch(()=>{process.stderr.write('Owned MFA fixture provisioning failed');process.exitCode=1;}).finally(closeDb);";
  const bootstrap=await execute(process.execPath,['--import','tsx','-e',script],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:database,STAFF_PROVISIONING_MODE:'hybrid',STAFF_ACCOUNTS_JSON:JSON.stringify(roster)},timeout:60000,maxBuffer:1024*1024});
  expect(JSON.parse(bootstrap.stdout).created).toBe(1);
  const bound=(await pool.query('SELECT p.user_id FROM staff_provisioned_accounts p JOIN users u ON u.id=p.user_id WHERE p.provision_key=$1 AND u.email=$2',[owner.key,owner.email])).rows;
  expect(bound).toHaveLength(1);owner.id=bound[0].user_id;ownedIds.push(owner.id);known.add(owner.id);
  expect((await mutate(context.request,'/auth/login',{email:owner.email,password:initialPassword},known)).status()).toBe(200);
  const ownerFactor=await enroll(context.request,initialPassword,known);
  const created=await mutate(context.request,'/users',{name:staff.name,email:staff.email,password:initialPassword,role:'support',allowedLocales:['en'],active:true,qualityScope:false,crmScope:'assigned',crmPermissions:{}},known);
  expect(created.status()).toBe(201);const createdBody=await created.json();staff.id=createdBody.id;ownedIds.push(staff.id);known.add(staff.id);
  expect(createdBody.role).toBe('support');expect((await pool.query('SELECT 1 FROM staff_provisioned_accounts WHERE user_id=$1',[staff.id])).rowCount).toBe(0);
  visitor=await browser.newContext({baseURL,serviceWorkers:'block'});const visitorPage=await visitor.newPage();visitorPage.on('pageerror',error=>errors.push(error.message));
  expect((await mutate(visitor.request,'/auth/login',{email:staff.email,password:initialPassword},known)).status()).toBe(200);
  const oldFactor=await enroll(visitor.request,initialPassword,known);
  expect((await visitor.request.get('/api/v1/workspace')).status()).toBe(200);

  await page.goto('/en/admin/users/');const directory=page.locator('[data-user-directory]');await expect(directory).toBeVisible();
  await directory.getByRole('searchbox').fill(staff.email);const entry=directory.locator(`[data-user-id="${staff.id}"]`);await expect(entry).toBeVisible();
  const loading=responseFor(page,'/users/'+staff.id,'GET');await entry.getByRole('button',{name:'Edit',exact:true}).click();expect((await loading).status()).toBe(200);
  const dialog=page.getByRole('dialog'),trigger=dialog.getByRole('button',{name:'Recover lost two-factor access',exact:true});await expect(trigger).toBeVisible();await trigger.click();
  const form=dialog.locator('[data-user-mfa-recovery-form]');await expect(form).toBeVisible();
  await expect(form.locator('[name="actorPassword"]')).toHaveAttribute('autocomplete','current-password');
  await expect(form.locator('[name="actorCode"]')).toHaveAttribute('autocomplete','one-time-code');
  await expect(form.locator('[name="password"]')).toHaveAttribute('minlength','12');
  await fillCredential(form.locator('[name="actorPassword"]'),wrongPassword);await fillCredential(form.locator('[name="password"]'),replacement);await fillCredential(form.locator('[name="confirmPassword"]'),replacement);
  await form.getByRole('checkbox').check();
  // Observe a new real counter; never alter the clock or reset replay state.
  await expect.poll(()=>Math.floor(Date.now()/30000),{timeout:35000,intervals:[100]}).toBeGreaterThan(ownerFactor.counter);
  let actorCode=totp(ownerFactor.secret,Math.floor(Date.now()/30000));await fillCredential(form.locator('[name="actorCode"]'),actorCode);
  let submitted=responseFor(page,'/users/'+staff.id+'/mfa-reset','POST');await form.getByRole('button',{name:'Recover MFA and set new password',exact:true}).click();
  const rejected=await submitted;expect(rejected.status()).toBe(401);expect((await rejected.json()).code).toBe('INVALID_CREDENTIALS');
  await expect.poll(async()=>(await form.locator('[name="actorCode"]').inputValue()).length===0).toBe(true);await expect(dialog.getByRole('alert')).toBeVisible();
  expect((await(await context.request.get('/api/v1/auth/session')).json()).user.id).toBe(owner.id);
  expect((await visitor.request.get('/api/v1/workspace')).status()).toBe(200);
  await fillCredential(form.locator('[name="actorPassword"]'),initialPassword);actorCode=totp(ownerFactor.secret,Math.floor(Date.now()/30000));await fillCredential(form.locator('[name="actorCode"]'),actorCode);
  submitted=responseFor(page,'/users/'+staff.id+'/mfa-reset','POST');await form.getByRole('button',{name:'Recover MFA and set new password',exact:true}).click();
  const recovered=await submitted;expect(recovered.status()).toBe(200);const recovery=await recovered.json();expect(recovery.mfaEnrollmentRequired).toBe(true);expect(recovery.sessionsRevoked).toBe(true);
  await expect(form).toHaveCount(0);await expect(trigger).toHaveCount(0);
  await expect.poll(async()=>(await dialog.locator('[data-user-password-form] input[type="password"]').first().inputValue()).length===0).toBe(true);
  const profile=dialog.locator('[data-user-profile-form]');await expect(profile.getByRole('textbox',{name:'Name',exact:true})).toBeFocused();
  // A profile save in the same open dialog proves both optimistic versions
  // advance with reset, rather than overwriting a stale profile snapshot.
  await profile.getByRole('textbox',{name:'City',exact:true}).fill('Maku');
  const saved=responseFor(page,'/users/'+staff.id,'PATCH');await profile.getByRole('button',{name:'Save changes',exact:true}).click();expect((await saved).status()).toBe(200);await expect(dialog).toHaveCount(0);
  expect((await visitor.request.get('/api/v1/workspace')).status()).toBe(401);
  expect((await browserLogin(visitorPage,staff.email,initialPassword,known)).status()).toBe(401);
  const signed=await browserLogin(visitorPage,staff.email,replacement,known);expect(signed.status()).toBe(200);expect((await signed.json()).mfaEnrollmentRequired).toBe(true);
  await expect(visitorPage).toHaveURL(/\/en\/account\/security\/?$/);expect((await visitor.request.get('/api/v1/workspace')).status()).toBe(403);
  const freshFactor=await enroll(visitor.request,replacement,known);expect(freshFactor.secret!==oldFactor.secret).toBe(true);expect((await visitor.request.get('/api/v1/workspace')).status()).toBe(200);
  const final=await context.request.get('/api/v1/users/'+staff.id);expect(final.status()).toBe(200);const actual=await final.json();
  expect(actual.role).toBe('support');expect(actual.email).toBe(staff.email);expect(actual.allowedLocales).toEqual(['en']);expect(actual.profile.city).toBe('Maku');expect(actual.mfaEnabled).toBe(true);
  expect((await pool.query('SELECT 1 FROM staff_provisioned_accounts WHERE user_id=$1',[staff.id])).rowCount).toBe(0);expect(errors).toEqual([]);
 }finally{
  try{
   await visitor?.close();
  }finally{
   try{
    if(creationWindowOpened){
     // Exact pre-absent random identity pairs also recover a committed create
     // whose HTTP/child response was interrupted before its ID was recorded.
     const owned=(await pool.query('SELECT id FROM users WHERE (email=$1 AND name=$2) OR (email=$3 AND name=$4)',[owner.email,owner.name,staff.email,staff.name])).rows.map(row=>String(row.id));
     expect(owned.length).toBeLessThanOrEqual(2);for(const id of ownedIds)expect(owned).toContain(id);
     for(const id of owned)known.add(id);
     await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[owned]);
     await pool.query('UPDATE auth_challenges SET consumed_at=now() WHERE user_id=ANY($1::text[])',[owned]);
     await pool.query("UPDATE users SET active=false,mfa_enabled=false,mfa_secret=NULL,mfa_pending_secret=NULL,mfa_pending_expires_at=NULL,mfa_last_counter=-1,recovery_hashes='[]'::jsonb WHERE id=ANY($1::text[])",[owned]);
     expect((await pool.query('SELECT 1 FROM users WHERE id=ANY($1::text[]) AND (active OR mfa_enabled OR mfa_secret IS NOT NULL OR mfa_pending_secret IS NOT NULL OR jsonb_array_length(recovery_hashes)>0)',[owned])).rowCount).toBe(0);
     expect((await pool.query('SELECT 1 FROM sessions WHERE user_id=ANY($1::text[]) AND revoked_at IS NULL',[owned])).rowCount).toBe(0);
     expect((await pool.query('SELECT 1 FROM auth_challenges WHERE user_id=ANY($1::text[]) AND consumed_at IS NULL',[owned])).rowCount).toBe(0);
    }
   }finally{
    try{
     // Private evidence for later exact-value scanning, never a public report
     // attachment. Old target factors no longer exist in the database.
     if(capture){
      const values=[...known].filter(value=>value.length>=8),bytes=JSON.stringify(values)+'\n';
      const lengths:Record<string,number>={};for(const value of values)lengths[value.length]=(lengths[value.length]||0)+1;
      await writeFile(testInfo.outputPath('panel-mfa-known-values.private.json'),bytes,{flag:'wx',mode:0o600});
      await writeFile(testInfo.outputPath('panel-mfa-known-values-receipt.private.json'),JSON.stringify({schemaVersion:1,scope:'owned-panel-staff-mfa-browser-fixtures',arrayFile:'panel-mfa-known-values.private.json',sha256:createHash('sha256').update(bytes).digest('hex'),count:values.length,lengthCounts:lengths,transientTotpExcluded:true,publicAttachment:false,actualValuesOnly:true})+'\n',{flag:'wx',mode:0o600});
     }
    }finally{await pool.end();}
   }
  }
 }
});
