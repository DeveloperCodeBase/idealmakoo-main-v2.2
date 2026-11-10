import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';
import {createCustomProduct} from '../../src/lib/custom-products';
import {createProductDraft,readProductDraft,productEditorLocales} from '../../src/components/workspace/product-editor-data';
import type {WorkspaceRecord,WorkspaceState} from '../../src/data/workspace-seed';
import type {ContentLocale} from '../../src/data/catalog';

// Identity setup is isolated to the disposable acceptance database. Every
// product write and read below goes through the production UI or HTTP API.
const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const runId=randomUUID(),password=`E2e-product-translation-${randomUUID()}-A9`,fixtureIds:string[]=[];
let pool:pg.Pool;
interface WorkspaceResponse {state:WorkspaceState;version:number}
async function mutate(api:APIRequestContext,path:string,data:unknown,method='POST'){
 const session=await api.get('/api/v1/auth/session');expect(session.status()).toBe(200);const {csrfToken}=await session.json();
 return api.fetch('/api/v1'+path,{method,data,headers:{Origin:baseURL,'X-CSRF-Token':csrfToken,'Idempotency-Key':randomUUID()}});
}
async function fixture(role:'productManager'|'translator',locales:ContentLocale[]){
 const id=randomUUID(),email=`e2e-product-translation-${role.toLowerCase()}-${id}@example.test`;
 await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales) VALUES($1,$2,$3,$4,$5,true,$6::jsonb)",[id,email,`E2E product ${role}`,await passwordHash(password),role,JSON.stringify(locales)]);
 await pool.query('INSERT INTO user_settings(user_id) VALUES($1)',[id]);fixtureIds.push(id);return {id,email};
}
async function authenticate(api:APIRequestContext,email:string){
 expect((await mutate(api,'/auth/login',{email,password})).status()).toBe(200);
 const enrollment=await mutate(api,'/auth/mfa/enroll',{password});expect(enrollment.status()).toBe(200);const {secret}=await enrollment.json();
 expect((await mutate(api,'/auth/mfa/confirm',{code:totp(secret,Math.floor(Date.now()/30000))})).status()).toBe(200);
}
async function workspace(api:APIRequestContext):Promise<WorkspaceResponse>{const result=await api.get('/api/v1/workspace');expect(result.status()).toBe(200);return result.json();}
const responseFor=(page:Page,path:string,method:string)=>page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')==='/api/v1'+path&&response.request().method()===method);

test.beforeAll(async()=>{
 const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;if(!database)throw new Error('Product translation acceptance requires a migrated disposable database.');
 pool=new pg.Pool({connectionString:database,max:2});await pool.query('SELECT 1');
});
test.afterAll(async()=>{if(pool){if(fixtureIds.length){await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[fixtureIds]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[fixtureIds]);}await pool.end();}});

test('a scoped translator saves the complete product body and the product editor reloads that exact draft',async({page,context,browser})=>{
 test.setTimeout(120000);
 const manager=await fixture('productManager',[...productEditorLocales]),translator=await fixture('translator',['en']);
 const managerContext=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'});
 try{
  await authenticate(managerContext.request,manager.email);await authenticate(context.request,translator.email);
  const product=createCustomProduct({id:`custom-${runId}`,slug:`e2e-translation-${runId}`,brand:'E2E TRANSLATION FIXTURE',family:'teeth',title:`E2E full-body product ${runId}`,locale:'en'});
  const draft=createProductDraft(product),createdAt=new Date().toISOString();
  for(const locale of productEditorLocales){draft.localized[locale].shortDescription=`Acceptance summary ${locale}`;draft.localized[locale].fullDescription=`Preserved original full description ${locale}`;}
  draft.technical.layerCount='3';
  const record:WorkspaceRecord={id:product.id,product:product.id,collection:'products',title:{...product.name},summary:Object.fromEntries(productEditorLocales.map(locale=>[locale,draft.localized[locale].shortDescription])) as WorkspaceRecord['summary'],status:'draft',owner:'productManager',author:'productManager',authorId:manager.id,createdAt,updatedAt:createdAt,tags:['e2e'],demo:false,history:[],sourceUrl:product.sourceUrl,image:product.image,details:{customProduct:product,productDraft:draft}};
  const before=await workspace(managerContext.request);expect((await mutate(managerContext.request,'/workspace',{state:{...before.state,records:[record,...before.state.records]},expectedVersion:before.version,locale:'en'},'PUT')).status()).toBe(200);

  await page.goto('/en/admin/translations/');const list=page.locator('.ws-translation-list');await expect(list).toBeVisible();
  await list.getByRole('searchbox',{name:'Search workspace…',exact:true}).fill(product.name.en);await list.getByRole('button').filter({hasText:product.name.en}).click();
  const editor=page.locator('.ws-translation-editor');await expect(editor.getByRole('heading',{name:product.name.en,exact:true})).toBeVisible();
  await expect(page.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','held');
  await expect(page.locator('.ws-language-card.is-active')).toContainText('English');const restricted=page.locator('.ws-language-card:not(.is-active)');await expect(restricted).toHaveCount(4);for(const button of await restricted.all())await expect(button).toBeDisabled();
  const body=editor.getByRole('textbox',{name:'Full content',exact:true}),translated=`## Translation persisted ${runId}\n\n**Full description**, distinct from the summary.\n\n- First translated detail\n- Second translated detail`;
  await expect(body).toHaveValue(draft.localized.en.fullDescription);await expect(body).toBeEnabled();await body.fill(translated);
  const saved=responseFor(page,'/workspace','PUT');await editor.getByRole('button',{name:'Save changes',exact:true}).click();expect((await saved).status()).toBe(200);
  await expect(editor.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();await expect(body).toHaveValue(translated);

  const persisted=await workspace(context.request),stored=persisted.state.records.find(row=>row.id===product.id);expect(stored).toBeTruthy();
  const reloaded=readProductDraft(stored!.details?.productDraft,product);expect(reloaded.localized.en.fullDescription).toBe(translated);expect(stored!.status).toBe('draft');expect(stored!.approvedById).toBeUndefined();expect(stored!.details?.productReviewDraft).toBeUndefined();
  expect(reloaded.technical).toEqual(draft.technical);expect(reloaded.variants).toEqual(draft.variants);expect(reloaded.gallery).toEqual(draft.gallery);expect(stored!.title).toEqual(record.title);expect(stored!.summary).toEqual(record.summary);
  for(const locale of productEditorLocales.filter(locale=>locale!=='en'))expect(reloaded.localized[locale]).toEqual(draft.localized[locale]);
  const approval=await mutate(context.request,'/workspace/review',{bucket:'records',id:product.id,locale:'en',expectedVersion:persisted.version});expect(approval.status()).toBe(403);
  const site=await (await context.request.get('/api/v1/site')).json();expect(site.publications.some((publication:{id:string})=>publication.id===product.id)).toBe(false);

  // A separately authenticated product editor must obtain the saved text from
  // its own fresh workspace response, not from the translator's React state.
  const productPage=await managerContext.newPage();await productPage.goto('/en/admin/products/');const productEditor=productPage.getByRole('region',{name:'Product editor',exact:true});await expect(productEditor).toBeVisible();
  await productEditor.getByRole('searchbox',{name:'Search workspace…',exact:true}).fill(product.name.en);await productEditor.locator('.pe-product-list').getByRole('button').filter({hasText:product.name.en}).click();
  await expect(productEditor.getByRole('textbox',{name:'Full description',exact:true})).toHaveValue(translated);await expect(productEditor.getByRole('textbox',{name:'Short description',exact:true})).toHaveValue(draft.localized.en.shortDescription);
 }finally{await managerContext.close();}
});
