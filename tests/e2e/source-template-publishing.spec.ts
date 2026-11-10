import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';
import type {PageDraft,WorkspaceState} from '../../src/data/workspace-seed';
import {resetDisposableAuthBudget} from './helpers/auth-budget';

const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const runId=randomUUID(),password='E2e-source-template-'+randomUUID()+'-A9';
const actors=['author','reviewer'].map(kind=>({id:randomUUID(),email:`e2e-template-${kind}-${runId}@example.test`,name:'Source template '+kind}));
let pool:pg.Pool;
async function mutate(api:APIRequestContext,path:string,data:unknown,method='POST',headers:Record<string,string>={}){
 const session=await api.get('/api/v1/auth/session');expect(session.status()).toBe(200);const {csrfToken}=await session.json();
 return api.fetch('/api/v1'+path,{method,data,headers:{Origin:baseURL,'X-CSRF-Token':csrfToken,'Idempotency-Key':randomUUID(),...headers}});
}
async function login(api:APIRequestContext,email:string){
 expect((await mutate(api,'/auth/login',{email,password})).status()).toBe(200);
 const enrollment=await mutate(api,'/auth/mfa/enroll',{password});expect(enrollment.status()).toBe(200);const {secret}=await enrollment.json();
 expect((await mutate(api,'/auth/mfa/confirm',{code:totp(secret,Math.floor(Date.now()/30000))})).status()).toBe(200);
}
async function workspace(api:APIRequestContext):Promise<{state:WorkspaceState;version:number}>{const response=await api.get('/api/v1/workspace');expect(response.status()).toBe(200);return response.json();}
const responseFor=(page:Page,path:string,method:string)=>page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')==='/api/v1'+path&&response.request().method()===method);

test.beforeAll(async()=>{
 const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;if(!database)throw new Error('Source-template browser acceptance requires a migrated disposable database.');
 pool=new pg.Pool({connectionString:database,max:2});await resetDisposableAuthBudget(pool);const hash=await passwordHash(password);
 for(const actor of actors){await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales,quality_scope,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,'admin',true,$5::jsonb,true,'all',$6::jsonb)",[actor.id,actor.email,actor.name,hash,JSON.stringify(['fa','en','tr','ar','ru']),JSON.stringify({contact:true,financial:true,baseCost:true,assign:true,intake:true})]);await pool.query('INSERT INTO user_settings(user_id) VALUES($1)',[actor.id]);}
});
test.afterAll(async()=>{if(pool){await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[actors.map(actor=>actor.id)]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[actors.map(actor=>actor.id)]);await pool.end();}});

test('an existing source page publishes edited copy after independent review and retains its original template',async({page,context,browser},testInfo)=>{
 test.setTimeout(180000);
 const reviewer=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'}),anonymous=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'});
 const reader=await anonymous.newPage(),faReader=await anonymous.newPage(),reviewPage=await reviewer.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));reviewPage.on('pageerror',error=>errors.push(error.message));reader.on('pageerror',error=>errors.push(error.message));faReader.on('pageerror',error=>errors.push(error.message));
 let original:PageDraft|undefined,changed=false,leaseHeaders:Record<string,string>={};
 try{
  await login(context.request,actors[0].email);await login(reviewer.request,actors[1].email);
  const initial=await workspace(context.request);original=structuredClone(initial.state.pages.find(source=>source.slug==='about'&&source.locale==='en'));
  expect(original).toBeTruthy();const source=original!;
  await reader.goto('/en/about/');const template=reader.locator('[data-company-template="about"]');await expect(template).toBeVisible();
  const originalHeading=await template.locator('h1').innerText(),originalLead=await template.locator('.content-company-lead p').allTextContents();
  const counts={stats:await template.locator('.content-stat-row > div').count(),timeline:await template.locator('.content-timeline > article').count(),principles:await template.locator('.content-principles > article').count()};
  expect(counts.stats).toBeGreaterThan(0);expect(counts.timeline).toBeGreaterThan(0);expect(counts.principles).toBeGreaterThan(0);
  const faBefore=await faReader.goto('/fa/about/');expect(faBefore?.status()).toBe(200);const faTemplate=faReader.locator('[data-company-template="about"]');await expect(faTemplate).toBeVisible();
  const metadataSelector='head meta[name="description"],head meta[property="og:title"],head meta[property="og:description"],head meta[name="twitter:title"],head meta[name="twitter:description"]';
  const faOriginal={title:await faReader.title(),main:await faReader.locator('main').innerText(),template:await faTemplate.innerText(),metadata:await faReader.locator(metadataSelector).evaluateAll(nodes=>nodes.map(node=>({key:node.getAttribute('name')||node.getAttribute('property'),content:node.getAttribute('content')})))};
  expect(faOriginal.metadata).toHaveLength(5);expect(faOriginal.template).toMatch(/[\u0600-\u06ff]/);
  const isSourceAcquisition=(response:import('@playwright/test').Response)=>new URL(response.url()).pathname.replace(/\/$/,'')==='/api/v1/content/leases'&&response.request().method()==='POST'&&response.request().postDataJSON()?.bucket==='pages'&&response.request().postDataJSON()?.id===source.id;
  const firstAcquisition=page.waitForResponse(isSourceAcquisition);
  await page.goto('/en/admin/pages/?id='+encodeURIComponent(source.id));const editor=page.locator(`[data-page-editor][data-page-id="${source.id}"]`);
  await expect(editor.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','held');
  const firstLease=await firstAcquisition;expect(firstLease.status()).toBe(201);const tabClient=firstLease.request().postDataJSON().clientId;
  await test.step('the same tab resumes its lease across reload and back navigation, while a copied tab remains excluded',async()=>{
   const reloadedAcquisition=page.waitForResponse(isSourceAcquisition);await page.reload();expect((await reloadedAcquisition).status()).toBe(201);
   await expect(editor.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','held');expect((await reloadedAcquisition).request().postDataJSON().clientId).toBe(tabClient);
   // Lighthouse's real BFCache audit also leaves the page and returns. Private
   // no-store headers remain intact, so test the resulting document reload.
   await page.goto('about:blank');const returnedAcquisition=page.waitForResponse(isSourceAcquisition);await page.goBack();expect((await returnedAcquisition).status()).toBe(201);
   await expect(editor.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','held');expect((await returnedAcquisition).request().postDataJSON().clientId).toBe(tabClient);
   const opened=context.waitForEvent('page'),copiedAcquisition=context.waitForEvent('response',response=>isSourceAcquisition(response)&&response.request().frame().page()!==page);
   // An opener deliberately copies sessionStorage. Its active Web Lock must
   // prevent the new document from presenting the first tab's client identity.
   await page.evaluate(()=>{window.open(window.location.href,'_blank');});const copied=await opened;
   try{const rejected=await copiedAcquisition;expect(rejected.status()).toBe(423);expect(rejected.request().postDataJSON().clientId).not.toBe(tabClient);await expect(copied.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','locked');await expect(editor.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','held');}
   finally{await copied.close();}
  });
  const headings=editor.locator('.ws-block-inspector').getByRole('textbox',{name:'Title',exact:true}),edited='Independently reviewed factory story '+runId.slice(0,8);
  await expect(headings).toHaveCount(2);await headings.first().fill(edited);await headings.nth(1).fill(edited);
  const save=responseFor(page,'/workspace','PUT');await editor.getByRole('button',{name:'Save to factory content',exact:true}).click();const saved=await save;expect(saved.status()).toBe(200);changed=true;
  const token=saved.request().headers()['x-content-leases'];if(token)leaseHeaders={'X-Content-Leases':token};
  await expect(editor).toHaveAttribute('data-page-dirty','false');await reader.reload();await expect(template.locator('h1')).toHaveText(originalHeading);
  const submit=responseFor(page,'/workspace','PUT');await editor.getByRole('button',{name:'Submit for review',exact:true}).click();expect((await submit).status()).toBe(200);
  const current=await workspace(context.request);expect((await mutate(context.request,'/workspace/review',{bucket:'pages',id:source.id,locale:'en',expectedVersion:current.version})).status()).toBe(403);
  await reviewPage.goto('/en/admin/pages/?id='+encodeURIComponent(source.id));const reviewEditor=reviewPage.locator(`[data-page-editor][data-page-id="${source.id}"]`);await expect(reviewEditor).toBeVisible();
  const approval=responseFor(reviewPage,'/workspace/review','POST');await reviewEditor.getByRole('button',{name:'Approve review',exact:true}).click();expect((await approval).status()).toBe(200);
  const release=responseFor(reviewPage,'/workspace/publish','POST');await reviewEditor.locator('.ws-builder-footer').getByRole('button',{name:/^Publish/}).click();expect((await release).status()).toBe(200);
  await reader.reload();await expect(template.locator('h1')).toHaveText(edited);await expect(template.locator('.content-company-lead p')).toHaveText(originalLead);
  await expect(template.locator('.content-stat-row > div')).toHaveCount(counts.stats);await expect(template.locator('.content-timeline > article')).toHaveCount(counts.timeline);await expect(template.locator('.content-principles > article')).toHaveCount(counts.principles);
  await expect(template.locator('.content-company-visual img')).toBeVisible();expect(await template.locator('.content-company-visual img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
  const faAfter=await faReader.reload();expect(faAfter?.status()).toBe(200);
  await expect(faReader.locator('html')).toHaveAttribute('lang','fa');await expect(faReader.locator('html')).toHaveAttribute('dir','rtl');await expect(faReader).toHaveTitle(faOriginal.title);
  await expect(faReader.locator('main')).toHaveText(faOriginal.main,{useInnerText:true});await expect(faTemplate).toHaveText(faOriginal.template,{useInnerText:true});expect(await faReader.locator('body').innerText()).not.toContain(edited);
  expect(await faReader.locator(metadataSelector).evaluateAll(nodes=>nodes.map(node=>({key:node.getAttribute('name')||node.getAttribute('property'),content:node.getAttribute('content')})))).toEqual(faOriginal.metadata);
  // The public hydration snapshot legitimately contains independently published
  // languages. Assert the actual server markup and rendered page, not its inert
  // serialized data; a foreign heading/body/metadata leak must still fail.
  const faServer=await anonymous.request.get('/fa/about/');expect(faServer.status()).toBe(200);const faMarkup=(await faServer.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');expect(faMarkup).not.toContain(edited);
  const stored=await workspace(reviewer.request),released=stored.state.pages.find(item=>item.id===source.id)!;expect(released.authorId).toBe(actors[0].id);expect(released.approvedById).toBe(actors[1].id);expect(released.blocks.map(block=>block.id)).toEqual(source.blocks.map(block=>block.id));
  await testInfo.attach('published-source-template',{body:await reader.screenshot(),contentType:'image/png'});expect(errors).toEqual([]);
 }finally{
  // Restore canonical factory copy through the same independent approval and
  // publication commands; never leave the test headline on a shared audit app.
  if(changed&&original){
   let current=await workspace(context.request);const retained=current.state.pages.find(item=>item.id===original!.id)!;
   const restored={...retained,title:original.title,summary:original.summary,blocks:original.blocks,status:'review' as const,approvedBy:undefined,approvedById:undefined};
   expect((await mutate(context.request,'/workspace',{state:{...current.state,pages:current.state.pages.map(item=>item.id===restored.id?restored:item)},expectedVersion:current.version,locale:'en'},'PUT',leaseHeaders)).status()).toBe(200);
   current=await workspace(reviewer.request);expect((await mutate(reviewer.request,'/workspace/review',{bucket:'pages',id:original.id,locale:'en',expectedVersion:current.version})).status()).toBe(200);
   current=await workspace(reviewer.request);expect((await mutate(reviewer.request,'/workspace/publish',{publication:{id:original.id,kind:'page',locale:'en'},expectedVersion:current.version})).status()).toBe(200);
   await reader.reload();await expect(reader.locator('[data-company-template="about"] h1')).toHaveText(original.blocks.find(block=>block.id==='about-hero')!.title);
  }
  await reviewer.close();await anonymous.close();
 }
});
