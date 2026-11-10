import {test,expect,type APIRequestContext,type Page,type Response as PageResponse} from '@playwright/test';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {encrypt,hash,passwordHash,totp} from '../../src/server/crypto';
import type {RecipientPreferenceView,VerificationView} from '../../src/types/communication-capabilities';

// These fixtures belong only to the disposable acceptance database. No SMS,
// email or push provider is contacted, and no provider delivery is simulated.
const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const runId=randomUUID(),password='Acceptance-only-'+randomUUID()+'-A9';
const users:string[]=[];
let pool:pg.Pool;

test.beforeAll(async()=>{
  const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
  if(!database)throw new Error('Capability acceptance requires a migrated disposable database.');
  pool=new pg.Pool({connectionString:database,max:2});
  await pool.query('SELECT 1');
});
test.afterAll(async()=>{
  if(!pool)return;
  if(users.length){
    await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[users]);
    await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[users]);
  }
  await pool.end();
});
async function fixture(role:'admin'|'customer'){
  const id=randomUUID(),email='capability-'+id+'@example.test';
  await pool.query('INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,true,$6::jsonb,$7,$8::jsonb)',[id,email,'Capability acceptance '+role,await passwordHash(password),role,JSON.stringify(['fa','en','tr','ar','ru']),role==='admin'?'all':'assigned',JSON.stringify(role==='admin'?{contact:true,financial:true,assign:true,intake:true}:{})]);
  await pool.query("INSERT INTO user_settings(user_id,preferences,profile) VALUES($1,'{\"language\":\"en\"}'::jsonb,'{\"phone\":\"+982188889999\"}'::jsonb)",[id]);
  users.push(id);return{id,email};
}
async function mutation(api:APIRequestContext,path:string,body:unknown){
  const state=await (await api.get('/api/v1/auth/session')).json();
  return api.post('/api/v1'+path,{data:body,headers:{Origin:baseURL,'X-CSRF-Token':state.csrfToken,...path==='/requests'?{'Idempotency-Key':randomUUID()}:{}}});
}
async function signIn(api:APIRequestContext,user:{email:string},staff=false){
  expect((await mutation(api,'/auth/login',{email:user.email,password})).ok()).toBeTruthy();
  if(staff){
    const response=await mutation(api,'/auth/mfa/enroll',{password});expect(response.status()).toBe(200);
    const enrollment=await response.json();
    expect((await mutation(api,'/auth/mfa/confirm',{code:totp(enrollment.secret,Math.floor(Date.now()/30000))})).ok()).toBeTruthy();
  }
}
function privateRequests(page:Page){
  const requests:string[]=[];
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(/^\/api\/v1\/(?:auth|me|workspace)(?:\/|$)/.test(path))requests.push(path);});
  return requests;
}
async function privacy(page:Page,response:PageResponse|null,requests:string[],sensitive:string[]){
  expect(response?.status()).toBe(200);
  expect(response?.headers()['cache-control']).toContain('no-store');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  expect(response?.headers()['set-cookie']).toBeUndefined();
  await expect(page.locator('[data-capability-page]')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',/noindex/);
  expect(requests).toEqual([]);
  expect(await page.context().cookies()).toEqual([]);
  const retained=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
  for(const value of sensitive)expect(retained).not.toContain(value);
}

test('a valid private survey submits once without account bootstrap and reflects later revocation',async({page,context,browser})=>{
  const admin=await fixture('admin'),customer=await fixture('customer');
  const staff=await browser.newContext({baseURL,serviceWorkers:'block'}),account=await browser.newContext({baseURL,serviceWorkers:'block'});
  try{
    await signIn(staff.request,admin,true);await signIn(account.request,customer);
    const created=await mutation(account.request,'/requests',{kind:'contact',locale:'en',name:'Private feedback fixture',email:customer.email,message:'An explicitly scoped acceptance request.',productIds:[],consent:{purpose:'request_processing',acceptedAt:new Date().toISOString()}});
    expect(created.status()).toBe(201);const request=await created.json();
    const invitation=await mutation(staff.request,'/crm/surveys',{requestId:request.id,kind:'csat',locale:'en',question:'How was your acceptance visit?',channel:'in-app'});
    expect(invitation.status()).toBe(201);const survey=await invitation.json(),token=new URL(survey.url).pathname.split('/').filter(Boolean).at(-1)!;
    const requests=privateRequests(page),response=await page.goto(new URL(survey.url).pathname);
    await privacy(page,response,requests,[token,customer.email]);
    await expect(page.getByRole('heading',{name:'How was your acceptance visit?',exact:true})).toBeVisible();
    await page.getByRole('radio',{name:'4',exact:true}).check();
    await page.getByRole('textbox',{name:'Optional comment',exact:true}).fill('Private, durable feedback '+runId);
    const submitted=page.waitForResponse(value=>new URL(value.url()).pathname==='/api/v1/surveys/forms/'+token&&value.request().method()==='POST');
    await page.getByRole('button',{name:'Submit feedback',exact:true}).click();expect((await submitted).status()).toBe(200);
    await expect(page.getByRole('status')).toHaveText('Your feedback has been recorded.');
    expect((await pool.query('SELECT score,comment FROM crm_survey_responses WHERE invitation_id=$1',[survey.id])).rows).toEqual([{score:4,comment:'Private, durable feedback '+runId}]);
    const current=await (await context.request.get('/api/v1/surveys/forms/'+token)).json();
    expect((await context.request.post('/api/v1/surveys/forms/'+token,{headers:{Origin:baseURL,'X-Survey-CSRF':current.csrfToken},data:{score:1,comment:'Duplicate must not replace evidence'}})).status()).toBe(409);
    await page.reload();await expect(page.getByRole('status')).toHaveText('Your feedback has been recorded.');
    await pool.query('UPDATE users SET active=false WHERE id=$1',[customer.id]);
    expect((await page.reload())?.status()).toBe(404);expect(requests).toEqual([]);
  }finally{await staff.close();await account.close();}
});

test('recipient preferences retain a conflicted draft, save actual consent and revoke when the endpoint changes',async({page,context})=>{
  const actor=await fixture('admin'),id='capability-contact-'+randomUUID(),recipient=randomUUID(),endpoint=randomUUID(),token=randomBytes(32).toString('hex'),email='independent-'+randomUUID()+'@example.test';
  const title=Object.fromEntries(['fa','en','tr','ar','ru'].map(locale=>[locale,'Private contact fixture']));
  await pool.query("INSERT INTO workspace_entities(bucket,id,collection,status,data,created_by,updated_by) VALUES('records',$1,'contacts','active',$2::jsonb,$3,$3)",[id,JSON.stringify({id,collection:'contacts',title,summary:title,status:'active',owner:'admin',ownerId:actor.id,tags:[],details:{},history:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),demo:false}),actor.id]);
  await pool.query("INSERT INTO crm_contact_profiles(record_id,given_name,family_name,display_name,locale) VALUES($1,'Private','Fixture','Private Fixture','en')",[id]);
  await pool.query("INSERT INTO communication_recipients(id,subject_type,subject_id,contact_id) VALUES($1,'crm-contact',$2,$2)",[recipient,id]);
  await pool.query("INSERT INTO crm_contact_endpoints(id,contact_id,recipient_id,channel,value,normalized_value,label,active,verified_at) VALUES($1,$2,$3,'email',$4,$4,'Acceptance fixture',true,now())",[endpoint,id,recipient,email]);
  await pool.query("INSERT INTO communication_preference_tokens(token_hash,recipient_id,endpoint_id,endpoint_version,value_hash,scope,locale,expires_at) VALUES($1,$2,$3,1,$4,'preferences','en',now()+interval '1 day')",[hash(token),recipient,endpoint,hash(email)]);
  const requests=privateRequests(page),url='/api/v1/communication-preferences/'+token;
  const response=await page.goto('/en/communication-preferences/'+token+'/');await privacy(page,response,requests,[token,email,id,recipient]);
  const editor=page.locator('form').first(),zone=editor.getByLabel('Time zone',{exact:true});
  await expect(zone).toHaveValue('Asia/Tehran');await zone.fill('UTC');
  const products=editor.locator('.capability-topic').filter({has:page.getByRole('heading',{name:'Products',exact:true})});
  await products.getByRole('checkbox',{name:'Receive this topic',exact:true}).check();
  await products.getByRole('combobox',{name:'Delivery frequency',exact:true}).selectOption('daily');
  const before=await (await context.request.get(url)).json() as RecipientPreferenceView;
  const remote=structuredClone(before.preferences);remote.timezone='Europe/Istanbul';
  expect((await context.request.patch(url,{headers:{Origin:baseURL,'X-Communication-CSRF':before.csrfToken},data:{expectedVersion:before.version,preferences:remote}})).status()).toBe(200);
  await editor.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('your draft is preserved');await expect(zone).toHaveValue('UTC');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Load current version',exact:true}).first().click();
  await expect(zone).toHaveValue('Europe/Istanbul');await zone.fill('UTC');
  await products.getByRole('checkbox',{name:'Receive this topic',exact:true}).check();
  await products.getByRole('combobox',{name:'Delivery frequency',exact:true}).selectOption('daily');
  const saved=page.waitForResponse(value=>new URL(value.url()).pathname===url&&value.request().method()==='PATCH');
  await editor.getByRole('button',{name:'Save preferences',exact:true}).click();expect((await saved).status()).toBe(200);
  const stored=await (await context.request.get(url)).json() as RecipientPreferenceView;
  expect(stored.preferences.timezone).toBe('UTC');expect(stored.preferences.topics.products).toEqual({enabled:true,frequency:'daily',quietStart:null,quietEnd:null});
  expect(stored.preferences.topics.research?.enabled).toBe(false);
  await page.reload();await expect(zone).toHaveValue('UTC');await expect(products.getByRole('checkbox')).toBeChecked();
  await privacy(page,response,requests,[token,email,id,recipient]);
  await pool.query('UPDATE crm_contact_endpoints SET normalized_value=$2,value=$2,version=version+1,verified_at=NULL WHERE id=$1',[endpoint,'changed-'+randomUUID()+'@example.test']);
  expect((await page.reload())?.status()).toBe(404);expect((await context.request.get(url)).status()).toBe(404);
});

test('a controlled SMS proof fixture verifies in the standalone page without granting marketing consent',async({page,context})=>{
  const customer=await fixture('customer'),binding=randomUUID(),token=randomBytes(32).toString('hex'),code='631294',phone='+982188889999';
  const recipient=(await pool.query("SELECT id FROM communication_recipients WHERE subject_type='user' AND user_id=$1",[customer.id])).rows[0].id;
  const preferences={schemaVersion:1,timezone:'UTC',topics:Object.fromEntries(['requests','products','research','events'].map(topic=>[topic,{enabled:false,frequency:'instant',quietStart:null,quietEnd:null}]))};
  await pool.query("INSERT INTO communication_bindings(id,recipient_id,channel,provider,endpoint_encrypted,endpoint_hash,preferences) VALUES($1,$2,'sms','kavenegar',$3,$4,$5::jsonb)",[binding,recipient,encrypt(phone),hash(phone),JSON.stringify(preferences)]);
  const secret=process.env.SESSION_SECRET;if(!secret)throw new Error('Acceptance SESSION_SECRET must match the running server.');
  const codeHash=createHmac('sha256',secret).update('communication-otp-v1:'+hash(token)+':'+code).digest('hex');
  await pool.query("INSERT INTO communication_binding_challenges(token_hash,binding_id,endpoint_version,channel,code_hash,locale,expires_at) VALUES($1,$2,1,'sms',$3,'en',now()+interval '10 minutes')",[hash(token),binding,codeHash]);
  const requests=privateRequests(page),url='/api/v1/communication-verification/'+token;
  const response=await page.goto('/en/communication-verification/'+token+'/');await privacy(page,response,requests,[token,code,phone,customer.email]);
  const view=await (await context.request.get(url)).json() as VerificationView;
  expect((await context.request.patch(url,{data:{confirm:true,code},headers:{Origin:baseURL}})).status()).toBe(403);
  await page.getByRole('textbox',{name:'Six-digit SMS code',exact:true}).fill('۶۳۱۲۹۴');
  await expect(page.getByRole('textbox',{name:'Six-digit SMS code',exact:true})).toHaveValue(code);
  const verified=page.waitForResponse(value=>new URL(value.url()).pathname===url&&value.request().method()==='PATCH');
  await page.getByRole('button',{name:'Confirm',exact:true}).click();expect((await verified).status()).toBe(200);
  await expect(page.getByRole('status')).toHaveText('Verified');
  const link=page.getByRole('link',{name:'Communication preferences',exact:true});await expect(link).toHaveAttribute('href',/^\/en\/communication-preferences\/[a-f0-9]{64}\/$/);
  const current=(await pool.query('SELECT verified_at,preferences FROM communication_bindings WHERE id=$1',[binding])).rows[0];expect(current.verified_at).toBeTruthy();
  expect(Object.values(current.preferences.topics).every(value=>typeof value==='object'&&value!==null&&'enabled'in value&&value.enabled===false)).toBe(true);
  expect((await context.request.patch(url,{data:{confirm:true,code},headers:{Origin:baseURL,'X-Communication-CSRF':view.csrfToken}})).status()).toBe(409);
  await privacy(page,response,requests,[token,code,phone,customer.email]);
  await link.click();await expect(page.getByRole('heading',{level:1,name:'Communication preferences',exact:true})).toBeVisible();
  expect(requests).toEqual([]);
  const choices=page.locator('form').first().getByRole('checkbox');await expect(choices).toHaveCount(4);
  for(const choice of await choices.all())await expect(choice).not.toBeChecked();
});
