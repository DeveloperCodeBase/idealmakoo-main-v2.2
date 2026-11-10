import {test,expect,type APIRequestContext,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';

// Real authorized UI; only directory responses are held or failed. These tests
// never save a suppression/template or send a message to an external provider.
const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
let pool:pg.Pool;
const users:string[]=[];
function deferred<T=void>(){
 let resolve!:(value:T|PromiseLike<T>)=>void;
 const promise=new Promise<T>(yes=>{resolve=yes;});
 return{promise,resolve};
}
async function mutate(api:APIRequestContext,path:string,body:unknown){
 const session=await(await api.get('/api/v1/auth/session')).json();
 return api.post('/api/v1'+path,{data:body,headers:{Origin:baseURL,'X-CSRF-Token':session.csrfToken,'Idempotency-Key':randomUUID()}});
}
async function operator(context:BrowserContext){
 const id=randomUUID(),email=`e2e-communications-load-${id}@example.test`,password='E2e-communications-'+randomUUID()+'-A9';
 await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,'admin',true,false,$5::jsonb,'all',$6::jsonb)",[id,email,'Communications loading acceptance',await passwordHash(password),JSON.stringify(['fa','en','tr','ar','ru']),JSON.stringify({contact:true,financial:true,assign:true,intake:true})]);
 users.push(id);
 await pool.query("INSERT INTO user_settings(user_id,preferences) VALUES($1,'{\"language\":\"en\"}'::jsonb)",[id]);
 expect((await mutate(context.request,'/auth/login',{email,password})).ok()).toBeTruthy();
 const enrollment=await mutate(context.request,'/auth/mfa/enroll',{password});expect(enrollment.ok()).toBeTruthy();
 const secret=(await enrollment.json()).secret;
 expect((await mutate(context.request,'/auth/mfa/confirm',{code:totp(secret,Math.floor(Date.now()/30000))})).ok()).toBeTruthy();
}
async function holdDirectory(page:Page,fail=false){
 const arrived=deferred<number>(),release=deferred(),done=deferred();
 let started=false;
 await page.route(url=>url.pathname.replace(/\/$/,'')==='/api/v1/communications/templates'&&url.searchParams.has('locale'),async route=>{
  started=true;
  try{
   const response=await route.fetch();arrived.resolve(response.status());await release.promise;
   if(fail)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'Controlled directory failure'}})});
   else await route.fulfill({response});
  }finally{done.resolve();}
 },{times:1});
 return{arrived:arrived.promise,release:()=>release.resolve(),done:done.promise,started:()=>started};
}
type DirectoryGate=Awaited<ReturnType<typeof holdDirectory>>;
function controls(page:Page){
 const center=page.locator('.notification-template-center');
 const heading=page.getByRole('heading',{name:'Marketing suppressions',exact:true});
 const campaign=center.locator(':scope > section').filter({has:heading});
 return{center,heading,campaign,header:center.locator(':scope > section').first()};
}
async function retainDraftWhileDirectoryLoads(page:Page,gate:DirectoryGate,marker:string){
 expect(await gate.arrived).toBe(200);
 const {heading,campaign,header}=controls(page);await expect(heading).toBeVisible();
 await campaign.getByRole('button',{name:'Create new',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Marketing suppressions',exact:true});
 const reason=dialog.getByRole('textbox',{name:'Reason for this operation',exact:true});
 await reason.fill(marker);const originalInput=await reason.elementHandle();
 gate.release();await gate.done;
 await expect(header.getByRole('button',{name:'Load current version',exact:true})).toBeEnabled();
 await expect(dialog).toBeVisible();await expect(reason).toHaveValue(marker);
 expect(await reason.evaluate((node,previous)=>node===previous,originalInput)).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
}
function capturePageFailures(page:Page){
 const errors:string[]=[],writes:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(url.origin===new URL(baseURL).origin&&url.pathname.startsWith('/api/v1/')&&!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(request.method()+' '+url.pathname);});
 return{errors,writes};
}
async function close(context:BrowserContext,gates:DirectoryGate[]){
 for(const gate of gates)gate.release();
 await Promise.allSettled(gates.filter(gate=>gate.started()).map(gate=>gate.done));
 await context.close();
}
test.beforeAll(async()=>{
 const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
 if(!database)throw new Error('A migrated disposable acceptance database is required.');
 pool=new pg.Pool({connectionString:database,max:2});await pool.query('SELECT 1');
});
test.afterAll(async()=>{
 if(pool){
  if(users.length){await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[users]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[users]);}
  await pool.end();
 }
});

test('Communications waits for the first directory response and retains campaign drafts during later reloads and language changes',async({browser})=>{
 const context=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'}),gates:DirectoryGate[]=[];
 try{
  await operator(context);const page=await context.newPage(),failures=capturePageFailures(page);
  const initial=await holdDirectory(page);gates.push(initial);await page.goto('/en/admin/communications/');
  expect(await initial.arrived).toBe(200);const {center,heading,header}=controls(page);
  await expect(center.getByRole('heading',{name:'Message templates and delivery',exact:true})).toBeVisible();
  await expect(heading).toHaveCount(0);
  initial.release();await initial.done;await expect(heading).toBeVisible();const originalHeading=await heading.elementHandle();
  const reload=await holdDirectory(page);gates.push(reload);await header.getByRole('button',{name:'Load current version',exact:true}).click();
  await retainDraftWhileDirectoryLoads(page,reload,'Unsaved campaign reason during directory reload');
  expect(await heading.evaluate((node,previous)=>node===previous,originalHeading)).toBe(true);
  const language=await holdDirectory(page);gates.push(language);await header.getByRole('combobox',{name:'Message language',exact:true}).selectOption('ru');
  await retainDraftWhileDirectoryLoads(page,language,'Unsaved campaign reason during message-language change');
  expect(await heading.evaluate((node,previous)=>node===previous,originalHeading)).toBe(true);
  expect(failures.errors).toEqual([]);expect(failures.writes).toEqual([]);
 }finally{await close(context,gates);}
});

test('A first directory error still exposes permitted campaigns and a successful retry preserves their local draft',async({browser})=>{
 const context=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'}),gates:DirectoryGate[]=[];
 try{
  await operator(context);const page=await context.newPage(),failures=capturePageFailures(page);
  const initial=await holdDirectory(page,true);gates.push(initial);await page.goto('/en/admin/communications/');
  expect(await initial.arrived).toBe(200);const {center,heading,header}=controls(page);
  await expect(center.getByRole('heading',{name:'Message templates and delivery',exact:true})).toBeVisible();
  await expect(heading).toHaveCount(0);
  initial.release();await initial.done;await expect(center.getByRole('alert')).toBeVisible();await expect(heading).toBeVisible();
  const retry=await holdDirectory(page);gates.push(retry);await header.getByRole('button',{name:'Load current version',exact:true}).click();
  await retainDraftWhileDirectoryLoads(page,retry,'Unsaved campaign reason while template loading recovers');
  await expect(center.getByRole('alert')).toHaveCount(0);
  expect(failures.errors).toEqual([]);expect(failures.writes).toEqual([]);
 }finally{await close(context,gates);}
});
