import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {encrypt,hash,newTotpSecret,passwordHash,totp} from '../../src/server/crypto';
import {resetDisposableAuthBudget} from './helpers/auth-budget';

// These deliberately marked identities belong only to the deployment's
// disposable acceptance database. Production staff provisioning uses env.
const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const id=randomUUID(),email=`e2e-recovery-${id}@example.test`,password=`Recovery-e2e-${randomUUID()}-A9`;
const secret=newTotpSecret(),oldUnused=randomBytes(12).toString('hex'),oldSecond=randomBytes(12).toString('hex');
let pool:pg.Pool;

async function mutate(api:APIRequestContext,path:string,data:unknown){
  const session=await (await api.get('/api/v1/auth/session')).json();
  return api.post('/api/v1'+path,{data,headers:{Origin:baseURL,'X-CSRF-Token':session.csrfToken}});
}
test.beforeAll(async()=>{
  const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
  if(!database)throw new Error('A migrated disposable acceptance database is required.');
  pool=new pg.Pool({connectionString:database,max:2});
  await resetDisposableAuthBudget(pool);
  await pool.query(`INSERT INTO users(id,email,name,password_hash,role,email_verified,mfa_enabled,mfa_secret,mfa_last_counter,recovery_hashes,allowed_locales,crm_scope,crm_permissions)
    VALUES($1,$2,'Recovery acceptance staff',$3,'admin',true,true,$4,-1,$5::jsonb,$6::jsonb,'all',$7::jsonb)`,
    [id,email,await passwordHash(password),encrypt(secret),JSON.stringify([hash(oldUnused),hash(oldSecond)]),JSON.stringify(['fa','en','tr','ar','ru']),JSON.stringify({contact:true,financial:true,assign:true,intake:true})]);
  await pool.query('INSERT INTO user_settings(user_id) VALUES($1)',[id]);
});
test.afterAll(async()=>{if(pool){await pool.query('UPDATE users SET active=false WHERE id=$1',[id]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[id]);await pool.end();}});

test('a staff member regenerates recovery codes in the real panel; old proofs and other sessions stop working',async({page,context,browser})=>{
  test.setTimeout(120000);
  await page.goto('/en/auth/login');await page.locator('input[name="email"]').fill(email);await page.locator('input[name="password"]').fill(password);await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/en\/auth\/mfa\/?$/);
  const loginCounter=Math.floor(Date.now()/30000);
  await page.locator('input[autocomplete="one-time-code"]').fill(totp(secret,loginCounter));await page.locator('form button[type="submit"]').click();await expect(page).toHaveURL(/\/en\/admin\/?$/);
  const second=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'});
  try{
    const challenge=await (await mutate(second.request,'/auth/login',{email,password})).json();expect(challenge.mfaRequired).toBe(true);
    expect((await mutate(second.request,'/auth/mfa/verify',{challengeToken:challenge.challengeToken,code:oldSecond})).status()).toBe(200);
    expect((await second.request.get('/api/v1/workspace')).status()).toBe(200);
    await page.goto('/en/account/security');const form=page.locator('[data-mfa-recovery-regenerate]');await expect(form).toBeVisible();
    // A genuinely new time step is required after sign-in. Do not weaken the
    // replay counter or substitute a recovery code for the authenticator proof.
    await expect.poll(()=>Math.floor(Date.now()/30000),{timeout:35000,intervals:[500]}).toBeGreaterThan(loginCounter);
    await form.getByLabel('Current password',{exact:true}).fill('Wrong-current-password-A9');await form.getByLabel('Fresh authenticator code',{exact:true}).fill(totp(secret,Math.floor(Date.now()/30000)));
    const wrong=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/v1/auth/mfa/recovery-codes');await form.getByRole('button',{name:'Generate new codes',exact:true}).click();expect((await wrong).status()).toBe(401);
    await expect(page.locator('[data-recovery-codes] code')).toHaveCount(0);expect((await second.request.get('/api/v1/workspace')).status()).toBe(200);
    await form.getByLabel('Current password',{exact:true}).fill(password);await form.getByLabel('Fresh authenticator code',{exact:true}).fill(totp(secret,Math.floor(Date.now()/30000)));
    const replaced=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/v1/auth/mfa/recovery-codes');await form.getByRole('button',{name:'Generate new codes',exact:true}).click();const response=await replaced;expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('no-store');
    await expect(page.locator('[data-recovery-codes] code')).toHaveCount(10);const codes=await page.locator('[data-recovery-codes] code').allInnerTexts();expect(new Set(codes).size).toBe(10);expect(codes).not.toContain(oldUnused);
    await expect(form.getByLabel('Current password',{exact:true})).toHaveValue('');await expect(form.getByLabel('Fresh authenticator code',{exact:true})).toHaveValue('');
    const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));for(const code of codes)expect(stored).not.toContain(code);expect(stored).not.toContain(password);
    const saved=(await pool.query('SELECT recovery_hashes FROM users WHERE id=$1',[id])).rows[0].recovery_hashes;expect(saved.sort()).toEqual(codes.map(hash).sort());
    const audit=JSON.stringify((await pool.query("SELECT details FROM audit_events WHERE actor_id=$1 AND action='auth.mfa.recovery_codes.regenerated'",[id])).rows);for(const code of codes)expect(audit).not.toContain(code);
    expect((await context.request.get('/api/v1/workspace')).status()).toBe(200);expect((await (await second.request.get('/api/v1/auth/session')).json()).user).toBeNull();
    await page.reload();await expect(page.locator('[data-mfa-recovery-regenerate]')).toBeVisible();await expect(page.locator('[data-recovery-codes] code')).toHaveCount(0);
    const newChallenge=await (await mutate(second.request,'/auth/login',{email,password})).json();
    expect((await mutate(second.request,'/auth/mfa/verify',{challengeToken:newChallenge.challengeToken,code:oldUnused})).status()).toBe(401);
    expect((await mutate(second.request,'/auth/mfa/verify',{challengeToken:newChallenge.challengeToken,code:codes[0]})).status()).toBe(200);
    const finalChallenge=await (await mutate(second.request,'/auth/login',{email,password})).json();expect((await mutate(second.request,'/auth/mfa/verify',{challengeToken:finalChallenge.challengeToken,code:codes[0]})).status()).toBe(401);
  }finally{await second.close();}
});
