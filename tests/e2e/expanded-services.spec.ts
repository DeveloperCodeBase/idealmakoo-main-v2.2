import {test,expect,type APIRequestContext,type BrowserContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';
import {otpCopy} from '../../src/components/account/otp-copy';

const base=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3300';
const password='Expansion-E2E-'+randomUUID()+'-A9',ids:string[]=[];let pool:pg.Pool;
async function mutate(api:APIRequestContext,path:string,data:unknown,method='POST'){
 const session=await api.get('/api/v1/auth/session');expect(session.ok()).toBeTruthy();
 return api.fetch('/api/v1'+path,{method,headers:{Origin:new URL(base).origin,'X-CSRF-Token':(await session.json()).csrfToken,'Idempotency-Key':randomUUID()},data});
}
async function fixture(context:BrowserContext,role='customer',signIn=true){
 const id=randomUUID(),email=`e2e-expansion-${role.toLowerCase()}-${id}@example.test`;ids.push(id);
 await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,true,$6::jsonb,$7,$8::jsonb)",[id,email,'Expansion acceptance '+role,await passwordHash(password),role,JSON.stringify(role==='translator'?['en','tr','ar','ru']:['fa','en','tr','ar','ru']),role==='customer'?'assigned':'all',JSON.stringify(role==='customer'?{}:{contact:true,financial:true,assign:true,intake:true})]);
 await pool.query('INSERT INTO user_settings(user_id) VALUES($1)',[id]);
 if(!signIn)return{id,email};
 expect((await mutate(context.request,'/auth/login',{email,password})).ok()).toBeTruthy();
 if(role!=='customer'){const start=await mutate(context.request,'/auth/mfa/enroll',{password});expect(start.ok()).toBeTruthy();const secret=(await start.json()).secret;expect((await mutate(context.request,'/auth/mfa/confirm',{code:totp(secret,Math.floor(Date.now()/30000))})).ok()).toBeTruthy();}
 return{id,email};
}
test.beforeAll(async()=>{const database=process.env.TEST_DATABASE_URL;if(!database||!['localhost','127.0.0.1','[::1]'].includes(new URL(database).hostname))throw new Error('Explicit disposable loopback TEST_DATABASE_URL is required.');pool=new pg.Pool({connectionString:database,max:2});});
test.afterAll(async()=>{if(pool){if(ids.length){await pool.query("UPDATE content_comments SET state='rejected' WHERE user_id=ANY($1::text[])",[ids]);await pool.query('DELETE FROM content_likes WHERE user_id=ANY($1::text[])',[ids]);await pool.query("UPDATE content_reports SET state='dismissed' WHERE user_id=ANY($1::text[])",[ids]);await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[ids]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[ids]);}await pool.end();}});

test('SMS customer form is reachable in five languages and reflects actual server readiness without sending messages',async({page,request})=>{
 const status=await(await request.get('/api/v1/auth/otp/status')).json();
 for(const locale of ['fa','en','tr','ar','ru']as const){
  await page.goto(`/${locale}/auth/login/`);await page.getByRole('button',{name:otpCopy.sms[locale],exact:true}).click();
  const form=page.locator('[data-customer-otp]');await expect(form).toBeVisible();await expect(form.locator('input[name="otpPhone"]')).toHaveAttribute('type','tel');
  await expect(form.locator('input[type="email"],input[type="password"]')).toHaveCount(0);await form.locator('input[name="otpPhone"]').fill('۰۹۱۲۱۲۳۴۵۶۷');await form.locator('input[type="checkbox"]').check();
  if(!status.enabled){await expect(form.getByText(otpCopy.disabled[locale])).toBeVisible();await expect(form.getByRole('button',{name:otpCopy.send[locale],exact:true})).toBeDisabled();}
  await page.getByRole('button',{name:otpCopy.email[locale],exact:true}).click();await expect(page.locator('input[name="email"]')).toBeVisible();
 }
});

test('global search serves real published results, filters content and handles a replaced query on a mobile viewport',async({page})=>{
 await page.setViewportSize({width:412,height:900});await page.goto('/fa/products/');await page.locator('.mobile-toggle').click();await page.getByRole('dialog').getByRole('button',{name:'جستجو',exact:true}).click();const panel=page.locator('[data-public-search]');
 await expect(panel).toBeVisible();const query=panel.locator('input[type="search"]');await query.fill('نتیجه ناموجود 927391');await query.fill('اپل');
 await expect(panel.locator('a[href="/fa/products/apple/"]')).toBeVisible();await expect(panel.getByRole('alert')).toHaveCount(0);
 const type=panel.locator('select').nth(0);await type.selectOption('product');await expect(panel.locator('a[href="/fa/products/apple/"]')).toBeVisible();
 await query.fill('nonexistent-query-927391');await expect(panel.locator('.search-result-list a')).toHaveCount(0);await expect(panel.locator('[role="status"]')).toContainText('۰ نتیجه');
 const overflow=await panel.evaluate(node=>node.scrollWidth>node.clientWidth+2);expect(overflow).toBe(false);
});

test('comments stay private until a publisher approves; likes and reports use authenticated real endpoints',async({page,context,browser})=>{
 test.setTimeout(120000);await fixture(context);await page.goto('/en/products/apple/');const panel=page.locator('[data-public-engagement="products/apple"]');await expect(panel).toBeVisible();
 const like=panel.getByRole('button',{name:'Like',exact:true});await expect(like).toBeEnabled();await like.click();await expect(panel.getByRole('button',{name:'Unlike',exact:true})).toHaveAttribute('aria-pressed','true');
 const body='Review acceptance '+randomUUID();await panel.getByRole('textbox',{name:'Your comment',exact:true}).fill(body);await panel.getByRole('button',{name:'Submit for review',exact:true}).click();await expect(panel.getByRole('status')).toContainText('after approval');await expect(panel.locator('.engagement-comments')).not.toContainText(body);
 expect((await context.request.get('/api/v1/engagement/moderation?locale=en')).status()).toBe(403);
 const publisher=await browser.newContext({baseURL:base,serviceWorkers:'block',reducedMotion:'reduce'});
 try{await fixture(publisher,'publisher');const staff=await publisher.newPage();await staff.goto('/en/admin/');const insights=staff.locator('[data-operations-insights]');await expect(insights).toBeVisible();await insights.getByRole('button',{name:'Comments and reports',exact:true}).click();
  const row=insights.locator('[data-moderation-item]').filter({hasText:body});await expect(row).toBeVisible();await row.getByRole('button',{name:'Approve publication',exact:true}).click();await expect(row).toHaveCount(0);
  await page.reload();await expect(page.locator('.engagement-comments')).toContainText(body);
  const published=page.locator('[data-public-engagement]');await published.getByRole('button',{name:'Report content',exact:true}).click();await published.getByRole('textbox',{name:'Reason for reporting',exact:true}).fill('Acceptance report needs a content review');await published.getByRole('button',{name:'Submit report',exact:true}).click();await expect(published.getByRole('status')).toContainText('moderation queue');
  await insights.locator('[data-moderation-state]').selectOption('approved');const approved=insights.locator('[data-moderation-item]').filter({hasText:body});await expect(approved).toBeVisible();await expect(approved.getByRole('button',{name:'Approve publication',exact:true})).toBeDisabled();await approved.getByRole('button',{name:'Reject comment',exact:true}).click();await expect(approved).toHaveCount(0);await page.reload();await expect(page.locator('.engagement-comments')).not.toContainText(body);
 }finally{await publisher.close();}
});

test('staff overview shows scoped API usage and optional AI with server capabilities and an accessible role manual',async({page,context})=>{
 await fixture(context,'analyst');await page.goto('/en/admin/');const insights=page.locator('[data-operations-insights]');await expect(insights).toBeVisible();await insights.getByRole('button',{name:'API usage and cost',exact:true}).click();await expect(insights.getByRole('heading',{name:'Organization usage',exact:true})).toBeVisible();await expect(insights.getByRole('alert')).toHaveCount(0);
 await expect(insights.getByRole('button',{name:'Comments and reports',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Optional AI assistance',exact:true}).click();const ai=page.locator('[data-workspace-assistant]');await expect(ai).toBeVisible();await expect(ai.locator('select').first().locator('option')).toHaveCount(2);await expect(ai.getByRole('button',{name:'Generate proposal',exact:true})).toBeDisabled();
 await page.keyboard.press('Escape');await page.locator('.ws-topbar-actions').getByRole('button',{name:'Page guidance',exact:true}).click();await expect(page.locator('a[href="/manuals/analyst.html"]')).toBeVisible();
});


test('a translator can use reports and optional AI in an authorized target language from the Persian interface',async({page,context})=>{
 await fixture(context,'translator');await page.goto('/fa/admin/');const insights=page.locator('[data-operations-insights]');await expect(insights).toBeVisible();await expect(insights.locator('select').nth(1)).toHaveValue('en');await expect(insights.locator('.operations-counters')).toBeVisible();await expect(insights.getByRole('alert')).toHaveCount(0);
 await page.getByRole('button',{name:'کمک اختیاری هوش مصنوعی',exact:true}).click();const ai=page.locator('[data-workspace-assistant]');await expect(ai.locator('select').nth(1)).toHaveValue('en');await expect(ai.locator('select').nth(1).locator('option[value="fa"]')).toHaveCount(0);
});


test('phone-only customers see their verified identity and can contact the factory without a required email',async({page,context,browser})=>{
 const customer=await fixture(context),phone='+989'+randomUUID().replace(/[^0-9]/g,'').padEnd(9,'7').slice(0,9);
 await pool.query('UPDATE users SET email_placeholder=true,email_verified=false,phone_number=$2,phone_verified_at=now() WHERE id=$1',[customer.id,phone]);
 await page.goto('/en/account/security/');const email=page.locator('[data-security-section="email"]');await expect(email).toContainText('Phone verified');await expect(email).toContainText(phone);await expect(email.getByRole('button',{name:'Send verification link',exact:true})).toHaveCount(0);await expect(page.locator('[data-security-section="mfa"]')).toHaveCount(0);
 const rejected=await mutate(context.request,'/auth/email/request',{locale:'en'});expect(rejected.status()).toBe(409);expect((await rejected.json()).code).toBe('EMAIL_REQUIRED');
 await page.goto('/en/contact/');const form=page.locator('.request-form-shell');await expect(form.locator('input[name="email"]')).not.toHaveAttribute('required','');await expect(form.locator('input[name="phone"]')).toHaveValue(phone);
 const admin=await browser.newContext({baseURL:base,serviceWorkers:'block'});try{await fixture(admin,'admin');const directory=await admin.request.get('/api/v1/users?'+new URLSearchParams({q:phone,kind:'customer'}));expect(directory.ok()).toBeTruthy();const row=(await directory.json()).items.find((item:{id:string})=>item.id===customer.id);expect(row).toMatchObject({id:customer.id,email:'',phone,phoneVerified:true});const staff=await admin.newPage();await staff.goto('/en/admin/staff/');const users=staff.locator('[data-user-directory]');await users.locator('input[type="search"]').fill(phone);await expect(users.locator(`[data-user-id="${customer.id}"]`)).toContainText(phone);await expect(users.locator(`[data-user-id="${customer.id}"]`)).not.toContainText(customer.email);}finally{await admin.close();}
});


test('offline OTP transport exercises normalized inputs, a rejected code and successful customer navigation without sending SMS',async({page,context})=>{
 const customer=await fixture(context,'customer',false);let requests=0,verifications=0;
 await page.route('**/api/v1/auth/otp/status',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:true,configured:true,expiresIn:300,retryAfter:60})}));
 await page.route('**/api/v1/auth/otp/request',async route=>{requests++;const body=route.request().postDataJSON();expect(body).toMatchObject({phone:'09121234567',name:'مشتری آزمون مرورگر',locale:'fa',consent:true});await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({challengeToken:'offline-browser-otp-proof',expiresIn:300,retryAfter:60,delivery:'queued'})});});
 await page.route('**/api/v1/auth/otp/verify',async route=>{verifications++;expect(route.request().postDataJSON()).toMatchObject({challengeToken:'offline-browser-otp-proof',code:'123456'});if(verifications===1){await route.fulfill({status:401,contentType:'application/problem+json',body:JSON.stringify({type:'about:blank',title:'Unauthorized',status:401,code:'INVALID_OTP'})});return;}
  // The OTP transport is deliberately a test double. The browser receives a
  // real disposable customer session so the hand-off and next page are real.
  const login=await mutate(context.request,'/auth/login',{email:customer.email,password});expect(login.ok()).toBeTruthy();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(await login.json())});
 });
 await page.goto('/fa/auth/login/');await page.getByRole('button',{name:otpCopy.sms.fa,exact:true}).click();const form=page.locator('[data-customer-otp]');await form.locator('input[name="otpPhone"]').fill('۰۹۱۲۱۲۳۴۵۶۷');await form.locator('input[name="otpName"]').fill('مشتری آزمون مرورگر');await form.locator('input[type="checkbox"]').check();await form.getByRole('button',{name:otpCopy.send.fa,exact:true}).click();
 await expect(form.locator('input[name="smsCode"]')).toBeVisible();await expect(form.getByRole('button',{name:new RegExp(otpCopy.resend.fa)})).toBeDisabled();expect(requests).toBe(1);
 await form.locator('input[name="smsCode"]').fill('۱۲۳۴۵۶');await expect(form.locator('input[name="smsCode"]')).toHaveValue('123456');await form.getByRole('button',{name:otpCopy.verify.fa,exact:true}).click();await expect(form.getByRole('alert')).toHaveText(otpCopy.wrong.fa);
 await form.getByRole('button',{name:otpCopy.verify.fa,exact:true}).click();await expect(page).toHaveURL(new URL('/fa/account/',base).href);await expect(page.locator('[data-page-shell="account"]')).toBeVisible();expect(verifications).toBe(2);
});
