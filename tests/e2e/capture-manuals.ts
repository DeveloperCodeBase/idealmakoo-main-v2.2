/** Capture actual production screens with disposable training accounts.
 * Usage: node --env-file=.env.local --import tsx tests/e2e/capture-manuals.ts
 * Explicit TEST_DATABASE_URL and ALLOW_ROLE_GUIDE_FIXTURES=true are mandatory.
 * No credentials, MFA secrets or provider keys are written to the captures.
 */
import {chromium,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';
import {otpCopy} from '../../src/components/account/otp-copy';
import {observePrivateEditorNetwork,releasePrivateEditor,safeEditorCleanupReceipt} from '../../scripts/lib/private-audit-editor-cleanup.mjs';

async function main(){
const base=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'',database=process.env.TEST_DATABASE_URL||'';
const site=new URL(base),db=new URL(database),loopback=new Set(['127.0.0.1','localhost','[::1]']);
if(process.env.ALLOW_ROLE_GUIDE_FIXTURES!=='true'||!loopback.has(site.hostname)||!loopback.has(db.hostname)||!/^idealmakoo_(?:test|(?:repair_)?acceptance)/.test(db.pathname.slice(1)))throw new Error('Role manual captures require explicit permission and a disposable loopback application/database.');
const roles=[
 ['superAdmin','مالک آموزشی','admin/staff'],['admin','مدیر آموزشی','admin/content'],
 ['contentEditor','ویراستار آموزشی','admin/pages'],['productManager','مدیر محصول آموزشی','admin/products'],
 ['scientificReviewer','بازبین علمی آموزشی','admin/reviews'],['translator','مترجم آموزشی','admin/translations'],
 ['publisher','ناشر آموزشی','admin/publications'],['hr','منابع انسانی آموزشی','admin/hr'],
 ['business','بازرگانی آموزشی','admin/crm/leads'],['analyst','تحلیلگر آموزشی','admin/crm/reports'],
 ['support','پشتیبان آموزشی','admin/crm/cases'],['customer','مشتری آموزشی','account/requests'],
] as const;
const directory=resolve('public/manuals/assets');await mkdir(directory,{recursive:true});
const pool=new pg.Pool({connectionString:database,max:2}),created:string[]=[],password='Manual-only-'+randomUUID()+'-A9';
const receipts:{role:string;overview:string;workspace:string;cleanup:unknown}[]=[],shared:string[]=[];
const browser=await chromium.launch({headless:true,...process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{},args:['--no-sandbox']});
async function mutate(api:APIRequestContext,path:string,body:unknown){const session=await api.get('/api/v1/auth/session');if(!session.ok())throw new Error('Cannot establish training session');const token=(await session.json()).csrfToken;const response=await api.post('/api/v1'+path,{headers:{Origin:site.origin,'X-CSRF-Token':token},data:body});if(!response.ok())throw new Error('Training setup endpoint '+path+' returned '+response.status());return response.json();}
function adapter(page:Page){return{on:page.on.bind(page),off:page.off.bind(page),url:page.url.bind(page),mainFrame:page.mainFrame.bind(page),evaluate:page.evaluate.bind(page),goto:async(url:string,options?:Parameters<Page['goto']>[1])=>{const response=await page.goto(url,options);if(!response)return null;return{status:()=>response.status(),url:()=>response.url(),request:()=>({redirectChain:()=>{const chain=[];for(let request=response.request().redirectedFrom();request;request=request.redirectedFrom())chain.push(request);return chain;}})};}};}
async function settled(page:Page,role:string){
 await page.locator(role==='customer'?'[data-page-shell="account"]':`.ws-root[data-role="${role}"]`).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.ws-page-content > .ws-card[role="status"], [data-account-body-state="loading"]'));
 await page.waitForLoadState('networkidle');await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>window.scrollTo(0,0));
}
try{
 for(const [role,name,path] of roles){
  const context=await browser.newContext({baseURL:site.origin,viewport:{width:1200,height:900},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block',locale:'fa-IR'});
  let observer:ReturnType<typeof observePrivateEditorNetwork>|undefined;
  try{
   const id=randomUUID(),email=`training-${role.toLowerCase()}-${id}@example.test`;created.push(id);
   await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,true,$6,$7::jsonb,$8,$9::jsonb)",[id,email,name,await passwordHash(password),role,['superAdmin','admin','scientificReviewer'].includes(role),JSON.stringify(role==='translator'?['en','tr','ar','ru']:['fa','en','tr','ar','ru']),role==='customer'?'assigned':'all',JSON.stringify(role==='customer'?{}:{contact:true,financial:role!=='support',baseCost:['superAdmin','admin'].includes(role),assign:true,intake:true})]);
   await pool.query("INSERT INTO user_settings(user_id,preferences) VALUES($1,'{\"language\":\"fa\",\"theme\":\"light\"}'::jsonb)",[id]);
   await mutate(context.request,'/auth/login',{email,password});
   if(role!=='customer'){const enrolled=await mutate(context.request,'/auth/mfa/enroll',{password});await mutate(context.request,'/auth/mfa/confirm',{code:totp(enrolled.secret,Math.floor(Date.now()/30000))});}
   const page=await context.newPage(),edge=adapter(page);observer=observePrivateEditorNetwork(edge);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.name));
   const overview=`${role}-overview.png`,workspace=`${role}-workspace.png`;
   const first=await page.goto('/fa/'+(role==='customer'?'account/':'admin/'),{waitUntil:'domcontentloaded'});if(first?.status()!==200)throw new Error('Overview failed for '+role);await settled(page,role);await page.screenshot({path:resolve(directory,overview)});
   if(role==='admin'){const reports=page.locator('[data-operations-insights]');await reports.waitFor();await page.locator('.operations-counters').waitFor();await reports.evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:resolve(directory,'shared-reports.png')});shared.push('shared-reports.png');await page.evaluate(()=>window.scrollTo(0,0));await page.getByRole('button',{name:'کمک اختیاری هوش مصنوعی',exact:true}).click();await page.locator('[data-workspace-assistant]').waitFor();await page.screenshot({path:resolve(directory,'shared-assistant.png')});shared.push('shared-assistant.png');await page.keyboard.press('Escape');}
   if(role==='publisher'){const reports=page.locator('[data-operations-insights]');await reports.getByRole('button',{name:'بررسی دیدگاه‌ها و گزارش‌ها',exact:true}).click();await reports.locator('[data-moderation-state]').waitFor();await page.waitForLoadState('networkidle');await reports.evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:resolve(directory,'publisher-moderation.png')});shared.push('publisher-moderation.png');}
   const second=await page.goto('/fa/'+path+'/',{waitUntil:'domcontentloaded'});if(second?.status()!==200)throw new Error('Workspace failed for '+role);await settled(page,role);if(role==='superAdmin'){const response=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/v1/users'&&url.searchParams.get('q')==='آموزشی'&&response.ok();});await page.locator('[data-user-directory] input[type="search"]').fill('آموزشی');await response;await page.locator('[data-user-directory] tbody').getByText(name,{exact:true}).first().waitFor();}await page.screenshot({path:resolve(directory,workspace)});
   if(errors.length)throw new Error('Browser script error for '+role);
   const cleanup=await releasePrivateEditor({page:edge,network:observer,pool,actorId:id,baseUrl:site.origin,expectedUrl:page.url(),role});
   if(!cleanup.success)throw new Error('Editor cleanup did not settle for '+role);
   receipts.push({role,overview,workspace,cleanup:safeEditorCleanupReceipt(cleanup)});console.log(JSON.stringify({role,captures:2,status:'captured'}));
  }finally{observer?.dispose();await context.close();}
 }
 const guest=await browser.newContext({baseURL:site.origin,viewport:{width:1200,height:900},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block',locale:'fa-IR'});
 try{const page=await guest.newPage();await page.goto('/fa/auth/login/');await page.getByRole('button',{name:otpCopy.sms.fa,exact:true}).click();await page.locator('[data-customer-otp]').waitFor();await page.locator('[data-customer-otp]').getByRole('status').waitFor({state:'hidden'});await page.evaluate(()=>document.fonts.ready);await page.locator('[data-customer-otp] button[type="submit"]').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(directory,'customer-sms.png')});shared.push('customer-sms.png');await page.goto('/fa/products/');await page.keyboard.press('Control+k');const search=page.locator('[data-public-search]');await search.locator('input[type="search"]').fill('اپل');await search.locator('a[href="/fa/products/apple/"]').waitFor();await page.screenshot({path:resolve(directory,'customer-search.png')});shared.push('customer-search.png');}finally{await guest.close();}
 await writeFile(resolve(directory,'capture-manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),environment:'local production runtime with disposable training accounts',viewport:{width:1200,height:900},screenshots:receipts.length*2+shared.length,roles:receipts,shared},null,2)+'\n');
}finally{
 if(created.length){await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[created]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[created]);}
 await browser.close();await pool.end();
}

}
void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
