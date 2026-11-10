import {test,expect,type APIRequestContext,type BrowserContext,type Page,type Request} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';
import {releasePrivateEditor,observePrivateEditorNetwork} from '../../scripts/lib/private-audit-editor-cleanup.mjs';

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
 const id=randomUUID(),email=`e2e-layout-${id}@example.test`,password='E2e-layout-'+randomUUID()+'-A9';
 await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,'superAdmin',true,true,$5::jsonb,'all',$6::jsonb)",[id,email,'Initial layout acceptance',await passwordHash(password),JSON.stringify(['fa','en','tr','ar','ru']),JSON.stringify({contact:true,financial:true,baseCost:true,assign:true,intake:true})]);
 users.push(id);await pool.query("INSERT INTO user_settings(user_id,preferences) VALUES($1,'{\"language\":\"en\"}'::jsonb)",[id]);
 expect((await mutate(context.request,'/auth/login',{email,password})).ok()).toBeTruthy();
 const enrollment=await mutate(context.request,'/auth/mfa/enroll',{password});expect(enrollment.ok()).toBeTruthy();
 expect((await mutate(context.request,'/auth/mfa/confirm',{code:totp((await enrollment.json()).secret,Math.floor(Date.now()/30000))})).ok()).toBeTruthy();
 return id;
}
async function holdResponse(page:Page,predicate:(url:URL)=>boolean,fail=false){
 const arrived=deferred<number>(),release=deferred(),done=deferred();let started=false;
 await page.route(predicate,async route=>{
  started=true;
  try{const response=await route.fetch();arrived.resolve(response.status());await release.promise;
   if(fail)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'Controlled initial-load failure'}})});
   else await route.fulfill({response});
  }finally{done.resolve();}
 },{times:1});
 return{arrived:arrived.promise,release:()=>release.resolve(),done:done.promise,started:()=>started};
}
type ResponseGate=Awaited<ReturnType<typeof holdResponse>>;
async function releaseGates(gates:ResponseGate[]){for(const gate of gates)gate.release();await Promise.allSettled(gates.filter(gate=>gate.started()).map(gate=>gate.done));}
function captureFailures(page:Page,allowEditorLeases=false){
 const errors:string[]=[],writes:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(url.origin!==new URL(baseURL).origin||!url.pathname.startsWith('/api/v1/')||['GET','HEAD','OPTIONS'].includes(request.method()))return;
  if(allowEditorLeases&&/^\/api\/v1\/content\/leases(?:\/[a-f0-9-]{36})?\/?$/.test(url.pathname)&&['POST','PUT','DELETE'].includes(request.method()))return;
  writes.push(request.method()+' '+url.pathname);
 });
 return{errors,writes};
}
function cleanupAdapter(page:Page){
 // Adapt actual Playwright redirect links to the existing audit helper's
 // navigation interface. Lease release remains owned by the normal UI.
 return{on:page.on.bind(page),off:page.off.bind(page),url:page.url.bind(page),mainFrame:page.mainFrame.bind(page),evaluate:page.evaluate.bind(page),goto:async(url:string,options?:Parameters<Page['goto']>[1])=>{
  const response=await page.goto(url,options);if(!response)return null;
  return{status:()=>response.status(),url:()=>response.url(),request:()=>({redirectChain:()=>{const chain:Request[]=[];for(let request=response.request().redirectedFrom();request;request=request.redirectedFrom())chain.push(request);return chain;}})};
 }};
}
test.beforeAll(async()=>{
 const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;if(!database)throw new Error('A migrated disposable acceptance database is required.');
 pool=new pg.Pool({connectionString:database,max:2});await pool.query('SELECT 1');
});
test.afterAll(async()=>{
 if(pool){if(users.length){await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[users]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[users]);}await pool.end();}
});

test('Products do not expose records below a still-loading editor and retain their filter when the selected product changes',async({browser})=>{
 const context=await browser.newContext({baseURL,viewport:{width:412,height:823},serviceWorkers:'block',reducedMotion:'reduce'}),gates:ResponseGate[]=[];
 let page:Page|undefined,actorId:string|undefined,editorPage:ReturnType<typeof cleanupAdapter>|undefined,editorNetwork:ReturnType<typeof observePrivateEditorNetwork>|undefined;
 try{
  actorId=await operator(context);page=await context.newPage();editorPage=cleanupAdapter(page);editorNetwork=observePrivateEditorNetwork(editorPage);const failures=captureFailures(page,true);
  const manifest=JSON.parse(await readFile('.next/react-loadable-manifest.json','utf8')) as Record<string,{files:string[]}>;
  const entry=manifest['components/workspace/Workspace.tsx -> ./ProductWorkspace']||manifest['components/workspace/Workspace.tsx -> ./ProductEditor'];
  const records=manifest['components/workspace/Workspace.tsx -> ./Records']?.files||[];
  const isolatedChunk=entry?.files.filter(file=>file.endsWith('.js')&&!records.includes(file)).at(-1);
  expect(isolatedChunk).toBeTruthy();
  const initial=await holdResponse(page,url=>url.pathname==='/_next/'+isolatedChunk);gates.push(initial);
  await page.goto('/en/admin/cms/products/',{waitUntil:'domcontentloaded'});expect(await initial.arrived).toBe(200);
  await expect(page.locator('.pe-root')).toHaveCount(0);await expect(page.locator('.ws-records')).toHaveCount(0);
  initial.release();await initial.done;await expect(page.locator('.pe-root')).toBeVisible();await expect(page.locator('.ws-records')).toBeVisible();
  await expect(page.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','held');
  const filter=page.locator('.ws-records input[type="search"]'),marker='Unsaved record filter';await filter.fill(marker);const originalFilter=await filter.elementHandle();
  await page.locator('.pe-product-list > button').nth(1).click();
  await expect(filter).toHaveValue(marker);expect(await filter.evaluate((node,previous)=>node===previous,originalFilter)).toBe(true);
  await expect(page.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','held');
  expect(failures.errors).toEqual([]);expect(failures.writes).toEqual([]);
 }finally{
  await releaseGates(gates);
  try{if(page&&actorId&&editorPage&&editorNetwork){const cleanup=await releasePrivateEditor({page:editorPage,network:editorNetwork,pool,actorId,baseUrl:new URL(baseURL).origin,expectedUrl:page.url(),role:'superAdmin'});expect(cleanup.success).toBe(true);expect(cleanup.remainingCount).toBe(0);expect(cleanup.releasedCount).toBe(cleanup.trackedCount);}}
  finally{editorNetwork?.dispose();await context.close();}
 }
});

const snapshotUrl=(url:URL)=>url.pathname.replace(/\/$/,'')==='/api/v1/monitoring/overview'&&url.searchParams.has('minutes');
const evidence='Missing samples, tests or provider receipts remain unknown. Configuration alone does not prove health or delivery.';
function monitoringControls(page:Page){
 const panel=page.getByRole('region',{name:'Monitoring and operations',exact:true});
 return{panel,navigation:panel.getByRole('navigation',{name:'Monitoring and operations',exact:true}),window:panel.locator(':scope > div > label').getByRole('combobox',{name:'Measurement window',exact:true}),note:panel.getByText(evidence,{exact:true}),header:panel.locator(':scope > header')};
}
test('Monitoring orders its initial snapshot, preserves error recovery, and retains unsaved objectives during refresh and window changes',async({browser})=>{
 const context=await browser.newContext({baseURL,viewport:{width:412,height:823},serviceWorkers:'block',reducedMotion:'reduce'}),gates:ResponseGate[]=[];
 try{
  await operator(context);
  for(const fail of [false,true]){
   const page=await context.newPage(),failures=captureFailures(page),initial=await holdResponse(page,snapshotUrl,fail);gates.push(initial);
   await page.goto('/en/admin/monitoring/',{waitUntil:'domcontentloaded'});expect(await initial.arrived).toBe(200);const ui=monitoringControls(page);
   await expect(ui.panel).toBeVisible();await expect(ui.navigation).toHaveCount(0);await expect(ui.window).toHaveCount(0);await expect(ui.note).toHaveCount(0);
   initial.release();await initial.done;await expect(ui.window).toBeVisible();await expect(ui.note).toBeVisible();
   if(fail){
    await expect(ui.panel.getByRole('alert')).toBeVisible();
    const retry=await holdResponse(page,snapshotUrl);gates.push(retry);await ui.header.getByRole('button',{name:'Refresh status',exact:true}).click();expect(await retry.arrived).toBe(200);retry.release();await retry.done;await expect(ui.panel.getByRole('alert')).toHaveCount(0);
   }
   await expect(ui.navigation).toBeVisible();
   const slo=ui.panel.locator('section').filter({has:page.getByRole('heading',{name:'Service level objectives',exact:true})}).first();
   await slo.getByRole('button',{name:'Create',exact:true}).click();const name=slo.getByRole('textbox',{name:'Objective name',exact:true}),marker='Unsaved monitoring objective';await name.fill(marker);const original=await name.elementHandle();
   for(const action of [()=>ui.header.getByRole('button',{name:'Refresh status',exact:true}).click(),()=>ui.window.selectOption('5')]){
    const pending=await holdResponse(page,snapshotUrl);gates.push(pending);await action();expect(await pending.arrived).toBe(200);await expect(name).toHaveValue(marker);await expect(ui.window).toBeVisible();await expect(ui.note).toBeVisible();
    pending.release();await pending.done;await expect(ui.header.getByRole('button',{name:'Refresh status',exact:true})).toBeEnabled();await expect(name).toHaveValue(marker);expect(await name.evaluate((node,previous)=>node===previous,original)).toBe(true);
   }
   expect(failures.errors).toEqual([]);expect(failures.writes).toEqual([]);await page.close();
  }
 }finally{await releaseGates(gates);await context.close();}
});
