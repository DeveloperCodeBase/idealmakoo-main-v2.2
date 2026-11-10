import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';
import {resetDisposableAuthBudget} from './helpers/auth-budget';

const execute=promisify(execFile),baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const identity=randomUUID().replaceAll('-','').slice(0,18),initialPassword='Managed-ui-initial-'+randomUUID()+'-A9';
const owner={key:'e2e-owner-'+identity,id:'',name:'Managed UI owner',email:`managed-owner-${identity}@example.test`,role:'superAdmin'};
const staff={key:'e2e-staff-'+identity,id:'',name:'Managed UI environment staff',email:`managed-staff-${identity}@example.test`,role:'support'};
const customer={id:randomUUID(),name:'Managed UI customer',email:`managed-customer-${identity}@example.test`,role:'customer'};
const fixtureIds:string[]=[];
let pool:pg.Pool,controlDatabase:string;

async function mutate(api:APIRequestContext,path:string,data:unknown,method='POST'){
 const session=await api.get('/api/v1/auth/session');expect(session.status()).toBe(200);const {csrfToken}=await session.json();
 return api.fetch('/api/v1'+path,{method,data,headers:{Origin:baseURL,'X-CSRF-Token':csrfToken}});
}
async function enroll(api:APIRequestContext,password=initialPassword){
 const started=await mutate(api,'/auth/mfa/enroll',{password});expect(started.status()).toBe(200);const {secret}=await started.json();
 const confirmed=await mutate(api,'/auth/mfa/confirm',{code:totp(secret,Math.floor(Date.now()/30000))});expect(confirmed.status()).toBe(200);
}
async function ordinaryBootstrap(){
 const roster=[owner,staff].map(({key,email,name,role})=>({key,email,name,role,password:initialPassword,allowedLocales:['fa','en','tr','ar','ru'],crmScope:role==='superAdmin'?'all':'assigned',crmPermissions:role==='superAdmin'?{contact:true,financial:true,baseCost:true,assign:true,intake:true}:{}}));
 const code="import {provisionStaffAccounts} from './src/server/staff-provisioning.ts'; import {closeDb} from './src/server/db.ts'; provisionStaffAccounts({env:{STAFF_ACCOUNTS_JSON:process.env.STAFF_ACCOUNTS_JSON}}).then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{process.stderr.write(error.message);process.exitCode=1;}).finally(closeDb);";
 const result=await execute(process.execPath,['--import','tsx','-e',code],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:controlDatabase,STAFF_PROVISIONING_MODE:'hybrid',STAFF_ACCOUNTS_JSON:JSON.stringify(roster)},timeout:60000,maxBuffer:1024*1024});
 return JSON.parse(result.stdout) as {created:number;unchanged:number;grantsPending:number};
}
function responseFor(page:Page,path:string,method:string){return page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')==='/api/v1'+path&&response.request().method()===method);}
async function openEditor(page:Page,user:{id:string;email:string}){
 const directory=page.locator('[data-user-directory]');await directory.getByRole('searchbox').fill(user.email);
 const row=directory.locator(`[data-user-id="${user.id}"]`);await expect(row).toBeVisible();
 const loaded=responseFor(page,'/users/'+user.id,'GET');await row.getByRole('button',{name:'Edit',exact:true}).click();expect((await loaded).status()).toBe(200);
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();return dialog;
}
async function browserLogin(page:Page,email:string,password:string){
 await page.goto('/en/auth/login/');await page.locator('input[name="email"]').fill(email);await page.locator('input[name="password"]').fill(password);
 const response=responseFor(page,'/auth/login','POST');await page.locator('form button[type="submit"]').click();return response;
}

test.beforeAll(async()=>{
 controlDatabase=process.env.TEST_ADMIN_DATABASE_URL||process.env.MIGRATION_DATABASE_URL||process.env.TEST_DATABASE_URL||process.env.DATABASE_URL||'';
 if(!controlDatabase)throw new Error('User management acceptance requires a migrated disposable owner database.');
 pool=new pg.Pool({connectionString:controlDatabase,max:2});await resetDisposableAuthBudget(pool);
 expect((await ordinaryBootstrap()).created).toBe(2);
 for(const item of [owner,staff]){item.id=(await pool.query('SELECT user_id FROM staff_provisioned_accounts WHERE provision_key=$1',[item.key])).rows[0].user_id;fixtureIds.push(item.id);}
 await pool.query('INSERT INTO users(id,email,name,password_hash,role,email_verified) VALUES($1,$2,$3,$4,$5,true)',[customer.id,customer.email,customer.name,await passwordHash(initialPassword),customer.role]);
 await pool.query('INSERT INTO user_settings(user_id) VALUES($1)',[customer.id]);fixtureIds.push(customer.id);
});
test.afterAll(async()=>{if(pool){try{if(fixtureIds.length){await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[fixtureIds]);await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[fixtureIds]);}}finally{await pool.end();}}});

test('hybrid panel creates roles and edits customer and environment staff profiles, grants and credentials; ordinary bootstrap preserves the edits',async({page,context,browser})=>{
 test.setTimeout(360000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 expect((await mutate(context.request,'/auth/login',{email:owner.email,password:initialPassword})).status()).toBe(200);await enroll(context.request);
 await page.goto('/en/admin/users/');const directory=page.locator('[data-user-directory]');await expect(directory).toBeVisible();
 const initial=await context.request.get('/api/v1/users?limit=1');expect(initial.status()).toBe(200);const policy=await initial.json();expect(['hybrid','panel']).toContain(policy.provisioningMode);expect(policy.canManageGrants).toBe(true);
 const changed:{id:string;email:string;name:string;role:string;password:string;phone:string}[]=[];

 for(const target of [staff,customer]){
  const visitor=await browser.newContext({baseURL,serviceWorkers:'block'}),visitorPage=await visitor.newPage();
  try{
   expect((await mutate(visitor.request,'/auth/login',{email:target.email,password:initialPassword})).status()).toBe(200);if(target.role!=='customer')await enroll(visitor.request);
   const next={id:target.id,email:`edited-${target.role}-${identity}@example.test`,name:target.name+' revised',role:target.role==='customer'?'customer':'contentEditor',password:'Managed-ui-new-'+randomUUID()+'-Z9',phone:'+982100000123'};
   let dialog=await openEditor(page,target),profile=dialog.locator('[data-user-profile-form]');
   await profile.getByRole('textbox',{name:'Name',exact:true}).fill(next.name);await profile.getByRole('textbox',{name:'Email',exact:true}).fill(next.email);await profile.getByRole('textbox',{name:'Phone number',exact:true}).fill(next.phone);await profile.getByRole('textbox',{name:'City',exact:true}).fill('Maku');
   if(target.role!=='customer'){
    await profile.getByRole('combobox',{name:'Role',exact:true}).selectOption('contentEditor');await profile.getByRole('combobox',{name:'CRM access scope',exact:true}).selectOption('team');await profile.getByRole('checkbox',{name:'Contact information',exact:true}).check();
   }
   const saved=responseFor(page,'/users/'+target.id,'PATCH');await profile.getByRole('button',{name:'Save changes',exact:true}).click();expect((await saved).status()).toBe(200);await expect(dialog).toHaveCount(0);
   expect((await(await visitor.request.get('/api/v1/auth/session')).json()).user).toBeNull();
   dialog=await openEditor(page,next);profile=dialog.locator('[data-user-profile-form]');await expect(profile.getByRole('textbox',{name:'Phone number',exact:true})).toHaveValue(next.phone);await expect(profile.getByRole('textbox',{name:'City',exact:true})).toHaveValue('Maku');
   const credentials=dialog.locator('[data-user-password-form]');await expect(credentials).toBeVisible();await credentials.getByLabel('New password',{exact:true}).fill(next.password);await credentials.getByLabel('Confirm new password',{exact:true}).fill(next.password);
   const reset=responseFor(page,'/users/'+target.id+'/password','POST');await credentials.getByRole('button',{name:'Set new password',exact:true}).click();expect((await reset).status()).toBe(200);await expect(credentials.getByLabel('New password',{exact:true})).toHaveValue('');await expect(credentials.getByLabel('Confirm new password',{exact:true})).toHaveValue('');
   // Saving another field in the same dialog verifies the password mutation
   // advanced the optimistic user timestamp without losing profile edits.
   await profile.getByRole('textbox',{name:'Country',exact:true}).fill('Iran');const afterReset=responseFor(page,'/users/'+target.id,'PATCH');await profile.getByRole('button',{name:'Save changes',exact:true}).click();expect((await afterReset).status()).toBe(200);await expect(dialog).toHaveCount(0);
   expect((await browserLogin(visitorPage,next.email,initialPassword)).status()).toBe(401);
   const accepted=await browserLogin(visitorPage,next.email,next.password);expect(accepted.status()).toBe(200);const acceptedBody=await accepted.json();
   if(target.role==='customer'){await expect(visitorPage).toHaveURL(/\/en\/account\/?$/);expect(acceptedBody.user.id).toBe(target.id);}else{expect(acceptedBody.mfaRequired).toBe(true);await expect(visitorPage).toHaveURL(/\/en\/auth\/mfa\/?$/);}
   expect((await mutate(visitor.request,'/auth/login',{email:target.email,password:next.password})).status()).toBe(401);
   const stored=(await pool.query('SELECT email,name,role,email_verified,mfa_enabled FROM users WHERE id=$1',[target.id])).rows[0];expect(stored.email).toBe(next.email);expect(stored.name).toBe(next.name);expect(stored.role).toBe(next.role);expect(stored.email_verified).toBe(false);expect(stored.mfa_enabled).toBe(target.role!=='customer');changed.push(next);
  }finally{await visitor.close();}
 }

 const reapplied=await ordinaryBootstrap();expect(reapplied.created).toBe(0);expect(reapplied.grantsPending).toBeGreaterThan(0);
 for(const target of changed){
  const row=(await pool.query('SELECT email,name,role,active FROM users WHERE id=$1',[target.id])).rows[0];expect(row).toMatchObject({email:target.email,name:target.name,role:target.role,active:true});
  let dialog=await openEditor(page,target);await expect(dialog.getByRole('textbox',{name:'Country',exact:true})).toHaveValue('Iran');await dialog.getByRole('checkbox',{name:'Active',exact:true}).uncheck();let saved=responseFor(page,'/users/'+target.id,'PATCH');await dialog.locator('[data-user-profile-form]').getByRole('button',{name:'Save changes',exact:true}).click();expect((await saved).status()).toBe(200);await expect(dialog).toHaveCount(0);
  const probe=await browser.newContext({baseURL});try{expect((await mutate(probe.request,'/auth/login',{email:target.email,password:target.password})).status()).toBe(401);}finally{await probe.close();}
  dialog=await openEditor(page,target);await dialog.getByRole('checkbox',{name:'Active',exact:true}).check();saved=responseFor(page,'/users/'+target.id,'PATCH');await dialog.locator('[data-user-profile-form]').getByRole('button',{name:'Save changes',exact:true}).click();expect((await saved).status()).toBe(200);await expect(dialog).toHaveCount(0);
  const finalLogin=await browser.newContext({baseURL});try{expect((await mutate(finalLogin.request,'/auth/login',{email:target.email,password:target.password})).status()).toBe(200);}finally{await finalLogin.close();}
 }

 // The environment is only the initial owner fixture. These accounts are
 // created through the real panel, including its chosen role and grants.
 for(const role of ['contentEditor','customer']){
  const created={name:'Created in panel '+role,email:`panel-created-${role.toLowerCase()}-${identity}@example.test`,password:'Panel-created-'+randomUUID()+'-Z8'};
  await directory.getByRole('button',{name:'Create new',exact:true}).click();const dialog=page.getByRole('dialog'),form=dialog.locator('[data-user-profile-form]');
  await form.getByRole('textbox',{name:'Name',exact:true}).fill(created.name);await form.getByRole('textbox',{name:'Email',exact:true}).fill(created.email);await form.getByLabel('Password',{exact:true}).fill(created.password);await form.getByLabel('Confirm new password',{exact:true}).fill(created.password);await form.getByRole('textbox',{name:'Phone number',exact:true}).fill('+982100009876');await form.getByRole('combobox',{name:'Role',exact:true}).selectOption(role);
  if(role!=='customer'){await form.getByRole('checkbox',{name:'Русский',exact:true}).uncheck();await form.getByRole('checkbox',{name:'Contact information',exact:true}).check();}
  const submitted=responseFor(page,'/users','POST');await form.getByRole('button',{name:'Save changes',exact:true}).click();const result=await submitted;expect(result.status()).toBe(201);const entry=await result.json();expect(entry.role).toBe(role);expect(entry.email).toBe(created.email);fixtureIds.push(entry.id);await expect(dialog).toHaveCount(0);
  const detail=await context.request.get('/api/v1/users/'+entry.id);expect(detail.status()).toBe(200);const actual=await detail.json();expect(actual.profile.phone).toBe('+982100009876');if(role!=='customer'){expect(actual.allowedLocales).not.toContain('ru');expect(actual.crmPermissions.contact).toBe(true);}else expect(Object.values(actual.crmPermissions).some(Boolean)).toBe(false);
  const visitor=await browser.newContext({baseURL,serviceWorkers:'block'});try{
   const visitorPage=await visitor.newPage(),signedIn=await browserLogin(visitorPage,created.email,created.password);expect(signedIn.status()).toBe(200);const login=await signedIn.json();expect(login.user.id).toBe(entry.id);expect(login.user.role).toBe(role);
   if(role==='customer')await expect(visitorPage).toHaveURL(/\/en\/account\/?$/);else{await expect(visitorPage).toHaveURL(/\/en\/account\/security\/?$/);await enroll(visitor.request,created.password);}
   expect((await visitor.request.get('/api/v1/users')).status()).toBe(403);
  }finally{await visitor.close();}
 }
 expect(errors).toEqual([]);
});
