import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';

const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const runId=randomUUID(),password='Dialog-focus-'+randomUUID()+'-A9';
const actor={id:randomUUID(),email:`e2e-dialog-admin-${runId}@example.test`};
const customer={id:randomUUID(),email:`e2e-dialog-customer-${runId}@example.test`,name:'Dialog focus customer'};
let pool:pg.Pool;

async function mutate(api:APIRequestContext,path:string,data:unknown){
 const session=await api.get('/api/v1/auth/session');expect(session.status()).toBe(200);const {csrfToken}=await session.json();
 return api.post('/api/v1'+path,{data,headers:{Origin:baseURL,'X-CSRF-Token':csrfToken,'Idempotency-Key':randomUUID()}});
}
test.beforeAll(async()=>{
 const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;if(!database)throw new Error('Dialog focus acceptance requires a migrated disposable database.');
 pool=new pg.Pool({connectionString:database,max:2});const hashed=await passwordHash(password);
 await pool.query(`INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales,crm_scope,crm_permissions)
  VALUES ($1,$2,'Dialog focus administrator',$3,'admin',true,$4::jsonb,'all',$5::jsonb),($6,$7,$8,$3,'customer',true,$4::jsonb,'assigned',$5::jsonb)`,
 [actor.id,actor.email,hashed,JSON.stringify(['fa','en','tr','ar','ru']),JSON.stringify({contact:true,financial:true,baseCost:true,assign:true,intake:true}),customer.id,customer.email,customer.name]);
 await pool.query('INSERT INTO user_settings(user_id) SELECT unnest($1::text[])',[[actor.id,customer.id]]);
});
test.afterAll(async()=>{if(pool){try{await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[[actor.id,customer.id]]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[[actor.id,customer.id]]);}finally{await pool.end();}}});

test('delayed dialog initialization preserves deliberate field focus and normal keyboard dismissal',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 expect((await mutate(context.request,'/auth/login',{email:actor.email,password})).status()).toBe(200);
 const enrolled=await mutate(context.request,'/auth/mfa/enroll',{password});expect(enrolled.status()).toBe(200);const {secret}=await enrolled.json();
 expect((await mutate(context.request,'/auth/mfa/confirm',{code:totp(secret,Math.floor(Date.now()/30000))})).status()).toBe(200);
 await page.goto('/en/admin/staff/');const directory=page.locator('[data-user-directory]');await expect(directory.locator('table.ws-table')).toBeVisible();
 await directory.getByRole('searchbox').fill(customer.email);const row=directory.locator(`[data-user-id="${customer.id}"]`);await expect(row).toBeVisible();
 const opener=row.getByRole('button',{name:'Edit',exact:true}),dialog=page.getByRole('dialog'),name=dialog.getByRole('textbox',{name:'Name',exact:true}),edited=customer.name+' unsaved';
 // Hold the browser's animation callbacks while the real native dialog opens.
 // This lets a normal field interaction precede its deferred initial-focus callback.
 await page.clock.install({time:new Date()});await page.clock.pauseAt(new Date());
 try{
  await opener.click();await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeFocused();
  await name.click();await name.fill(edited);await expect(name).toHaveValue(edited);await expect(name).toBeFocused();
  await page.clock.runFor(32);
  await expect(name).toBeFocused();await expect(name).toHaveValue(edited);
  await page.keyboard.press('Tab');await expect(dialog.getByRole('textbox',{name:'Email',exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(name).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
 }finally{await page.clock.resume();if(await dialog.count())await page.keyboard.press('Escape');}
 await opener.click();await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeFocused();await expect(name).toHaveValue(customer.name);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
 expect(errors).toEqual([]);
});
