import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';
import type {PageDraft,WorkspaceState} from '../../src/data/workspace-seed';
import {resetDisposableAuthBudget} from './helpers/auth-budget';
import {accountGuide} from '../../src/components/account/account-help';

const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const id=randomUUID(),staffId=randomUUID(),email=`e2e-authoring-${id}@example.test`,password=`E2e-authoring-${randomUUID()}-A9`;
const slug=`authoring-${id.slice(0,12)}`,pageId=`E2E-AUTHORING-${id}`;
let pool:pg.Pool;
async function mutate(api:APIRequestContext,path:string,data:unknown,method='POST'){
 const session=await api.get('/api/v1/auth/session');expect(session.status()).toBe(200);const {csrfToken}=await session.json();
 return api.fetch('/api/v1'+path,{method,data,headers:{Origin:baseURL,'X-CSRF-Token':csrfToken,'Idempotency-Key':randomUUID()}});
}
async function workspace(api:APIRequestContext):Promise<{state:WorkspaceState;version:number}>{const response=await api.get('/api/v1/workspace');expect(response.status()).toBe(200);return response.json();}
const savedResponse=(page:Page)=>page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')==='/api/v1/workspace'&&response.request().method()==='PUT');

test.beforeAll(async()=>{
 const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;if(!database)throw new Error('Page authoring acceptance requires a migrated disposable database.');
 pool=new pg.Pool({connectionString:database,max:2});await resetDisposableAuthBudget(pool);
 await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales,quality_scope,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,'admin',true,$5::jsonb,true,'all',$6::jsonb)",[staffId,email,'Isolated page authoring fixture',await passwordHash(password),JSON.stringify(['fa','en','tr','ar','ru']),JSON.stringify({contact:true,financial:true,baseCost:true,assign:true,intake:true})]);
 await pool.query('INSERT INTO user_settings(user_id) VALUES($1)',[staffId]);
});
test.afterAll(async()=>{if(pool){await pool.query('UPDATE users SET active=false WHERE id=$1',[staffId]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[staffId]);await pool.end();}});

test('page authoring keeps unsaved navigation, save boundaries, CTA previews and edited-language direction correct',async({page,context})=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 expect((await mutate(context.request,'/auth/login',{email,password})).status()).toBe(200);
 const enrollment=await mutate(context.request,'/auth/mfa/enroll',{password});expect(enrollment.status()).toBe(200);const {secret}=await enrollment.json();
 expect((await mutate(context.request,'/auth/mfa/confirm',{code:totp(secret,Math.floor(Date.now()/30000))})).status()).toBe(200);
 let current=await workspace(context.request);const at=new Date().toISOString();
 const sources:PageDraft[]=(['en','fa'] as const).map(locale=>({id:pageId+'-'+locale,slug,locale,title:locale==='en'?'English authoring source':'منبع مستقل فارسی',summary:locale==='en'?'An English content draft.':'پیش‌نویس مستقل محتوای فارسی.',status:'draft',version:1,author:'admin',authorId:staffId,updatedAt:at,blocks:[{id:'hero',type:'hero',title:locale==='en'?'English hero':'هیروی فارسی',body:locale==='en'?'A draft with editable action labels.':'پیش‌نویس با عنوان دکمه‌های قابل ویرایش.',link:'/fa/contact/'}]}));
 expect((await mutate(context.request,'/workspace',{state:{...current.state,pages:[...current.state.pages,...sources]},expectedVersion:current.version,locale:'en'},'PUT')).status()).toBe(200);
 await page.goto(`/en/admin/pages/?id=${encodeURIComponent(pageId+'-en')}`);
 const editor=page.locator('[data-page-editor]'),inspector=editor.locator('.ws-block-inspector'),title=inspector.getByRole('textbox',{name:'Title',exact:true}).first();
 await expect(editor).toHaveAttribute('data-page-id',pageId+'-en');await expect(editor.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','held');await expect(title).toBeEnabled();
 await title.fill('The acknowledged English page');
 await inspector.getByRole('textbox',{name:'Primary button label',exact:true}).fill('Ask the factory');
 await inspector.getByRole('textbox',{name:'Secondary button label',exact:true}).fill('Read documents');
 await inspector.getByRole('textbox',{name:'Secondary button link',exact:true}).fill('/fa/resources/');
 await expect(editor.locator('.ws-page-canvas').getByRole('link',{name:'Ask the factory',exact:true})).toHaveAttribute('href','/en/contact/');
 await expect(editor.locator('.ws-page-canvas').getByRole('link',{name:'Read documents',exact:true})).toHaveAttribute('href','/en/resources/');
 await expect(editor.locator('.ws-builder-selector button')).toBeDisabled();
 expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);

 const productsLink=page.locator('a.ws-nav-item[href="/en/admin/products"]'),navigation=page.locator('[data-page-navigation-guard]'),editorUrl=page.url();
 await productsLink.click();await expect(navigation).toBeVisible();await expect(page).toHaveURL(editorUrl);await expect(title).toHaveValue('The acknowledged English page');
 await navigation.getByRole('button',{name:'Stay on page',exact:true}).click();await expect(navigation).toHaveCount(0);await expect(title).toHaveValue('The acknowledged English page');await expect(editor).toHaveAttribute('data-page-dirty','true');

 let release!:()=>void,started!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;}),intercepted=new Promise<void>(resolve=>{started=resolve;});let held=false;
 const matcher=/\/api\/v1\/workspace\/?(?:\?.*)?$/;
 await page.route(matcher,async route=>{if(route.request().method()==='PUT'&&!held){held=true;started();await hold;}await route.continue();});
 try{
  const saved=savedResponse(page);await editor.getByRole('button',{name:'Save to factory content',exact:true}).click();await intercepted;
  await expect(editor).toHaveAttribute('data-page-busy','true');await expect(title).toBeDisabled();await expect(inspector.getByRole('textbox',{name:'Primary button label',exact:true})).toBeDisabled();await expect(editor.getByRole('combobox',{name:'Content language',exact:true})).toBeDisabled();
  await productsLink.click();await expect(navigation).toBeVisible();await expect(navigation.getByRole('button',{name:'Discard changes and leave',exact:true})).toBeDisabled();await expect(page).toHaveURL(editorUrl);
  await navigation.getByRole('button',{name:'Stay on page',exact:true}).click();await expect(navigation).toHaveCount(0);
  release();expect((await saved).status()).toBe(200);await expect(editor).toHaveAttribute('data-page-busy','false');await expect(editor).toHaveAttribute('data-page-dirty','false');await expect(title).toBeEnabled();await expect(title).toHaveValue('The acknowledged English page');
 }finally{release();await page.unrouteAll({behavior:'wait'});}
 current=await workspace(context.request);const english=current.state.pages.find(item=>item.id===pageId+'-en')!;expect(english.title).toBe('The acknowledged English page');expect(english.blocks[0].options).toEqual({ctaLabel:'Ask the factory',secondaryLabel:'Read documents',secondaryLink:'/fa/resources/'});
 expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(false);

 await editor.getByRole('combobox',{name:'Content language',exact:true}).selectOption('fa');await expect(editor).toHaveAttribute('data-page-id',pageId+'-fa');await expect(editor.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','held');
 await expect(title).toHaveValue('منبع مستقل فارسی');await expect(title).toHaveAttribute('dir','rtl');await expect(title).toHaveAttribute('lang','fa');await expect(inspector.getByRole('textbox',{name:'Primary button label',exact:true})).toHaveValue('');
 await title.fill('عنوان تازهٔ فارسی');await inspector.getByRole('textbox',{name:'Primary button label',exact:true}).fill('تماس با کارخانه');await expect(editor.locator('.ws-page-canvas').getByRole('link',{name:'تماس با کارخانه',exact:true})).toHaveAttribute('href','/fa/contact/');
 const saved=savedResponse(page);await editor.getByRole('button',{name:'Save to factory content',exact:true}).click();expect((await saved).status()).toBe(200);await expect(editor).toHaveAttribute('data-page-dirty','false');await expect(title).toBeEnabled();
 current=await workspace(context.request);expect(current.state.pages.find(item=>item.id===pageId+'-en')).toEqual(english);expect(current.state.pages.find(item=>item.id===pageId+'-fa')?.title).toBe('عنوان تازهٔ فارسی');expect(errors).toEqual([]);
 await productsLink.click();await expect(page).toHaveURL(/\/en\/admin\/products\/?$/);await expect(navigation).toHaveCount(0);expect(errors).toEqual([]);
});

test('the customer and visitor guide opens in every interface language without changing account navigation',async({page})=>{
 const labels={fa:'راهنمای این بخش',en:'Page guidance',tr:'Sayfa rehberi',ar:'دليل هذه الصفحة',ru:'Руководство по разделу'};
 for(const locale of ['fa','en','tr','ar','ru'] as const){
  await page.goto(`/${locale}/account/`);
  await page.getByRole('button',{name:labels[locale],exact:true}).click();
  const dialog=page.getByRole('dialog'),guide=dialog.locator('[data-account-help="overview"]');
  await expect(guide).toBeVisible();await expect(guide).toContainText(accountGuide('overview').steps[0][locale]);
  await expect(guide.locator(`a[href="/${locale}/products/"]`)).toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 }
});
