import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {passwordHash,totp} from '../../src/server/crypto';
import type {Wishlist} from '../../src/types/wishlists';
import {accountText} from '../../src/components/account/account-copy';
import {translate} from '../../src/lib/i18n';

// Run only against the deployment's disposable acceptance database. All fixtures
// carry a unique e2e identity; API requests use the same cookies as the browser.
const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const runId=randomUUID().replaceAll('-','').slice(0,16);
const password=`E2e-only-${randomUUID()}-A9`;
const fixtureIds:string[]=[];
let pool:pg.Pool;

async function session(api:APIRequestContext){const response=await api.get('/api/v1/auth/session');expect(response.ok()).toBeTruthy();return response.json();}
async function mutate(api:APIRequestContext,path:string,data:unknown,method='POST',headers:Record<string,string>={}){
  const current=await session(api);
  return api.fetch(`/api/v1${path}`,{method,data,headers:{Origin:process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000','X-CSRF-Token':current.csrfToken,...(path==='/requests'&&method==='POST'?{'Idempotency-Key':randomUUID()}:{}),...headers}});
}
async function login(page:Page,email:string){
  await page.goto('/en/auth/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
}
async function fixture(role:string){
  const id=randomUUID(),email=`e2e-${role.toLowerCase()}-${runId}-${id.slice(0,6)}@example.test`;
  await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,true,false,$6,$7,$8::jsonb)",[id,email,`E2E ${role}`,await passwordHash(password),role,JSON.stringify(['fa','en','tr','ar','ru']),role==='customer'?'assigned':'all',JSON.stringify(role==='customer'?{}:{contact:true,financial:true,assign:true,intake:true})]);
  await pool.query('INSERT INTO user_settings(user_id) VALUES($1)',[id]);fixtureIds.push(id);return{id,email,role};
}
async function enrollViaApi(api:APIRequestContext){
  const start=await mutate(api,'/auth/mfa/enroll',{password});expect(start.ok()).toBeTruthy();const enrollment=await start.json();
  const confirm=await mutate(api,'/auth/mfa/confirm',{code:totp(enrollment.secret,Math.floor(Date.now()/30000))});expect(confirm.ok()).toBeTruthy();return confirm.json();
}
test.beforeAll(async()=>{
  const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
  if(!database)throw new Error('Production acceptance tests require a migrated, disposable DATABASE_URL.');
  pool=new pg.Pool({connectionString:database,max:2});await pool.query('SELECT 1');
});
test.afterAll(async()=>{if(pool){if(fixtureIds.length){await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[fixtureIds]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[fixtureIds]);}await pool.end();}});

test('named project lists preserve old bookmarks, resolve conflicts explicitly and share a revocable public selection',async({page,context,browser},testInfo)=>{
  test.setTimeout(120000);const owner=await fixture('customer'),privateNote='Private wishlist note '+runId,projectName='Project '+runId;
  const inquiry=[{productId:'apple',quantity:2,note:'Preserve inquiry '+runId}];await pool.query('UPDATE user_settings SET collection=$2::jsonb WHERE user_id=$1',[owner.id,JSON.stringify({inquiries:inquiry,compare:['apple'],saved:['apple']})]);
  await login(page,owner.email);await expect(page).toHaveURL(/\/en\/account\/?$/);await page.goto('/en/account/saved');const center=page.locator('[data-wishlist-center]');await expect(center).toBeVisible();await expect(page.locator('[data-wishlist-editor]')).toBeVisible();
  await center.getByRole('button',{name:'New list',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'List name',exact:true}).fill(projectName);await dialog.getByRole('textbox',{name:'Private project or list description'}).fill('Private project description '+runId);await dialog.getByRole('button',{name:'New list',exact:true}).click();await expect(dialog).toHaveCount(0);
  const editor=page.locator('[data-wishlist-editor]');await expect(editor.locator('[data-wishlist-name]')).toHaveValue(projectName);const id=await editor.getAttribute('data-wishlist-editor');expect(id).toBeTruthy();
  const card=page.locator('[data-wishlist-catalog] [data-wishlist-content="product:apple"]');await page.getByRole('textbox',{name:'Search name or code'}).fill('Apple');await expect(card).toBeVisible();await card.getByRole('button',{name:'Add to list',exact:true}).click();await editor.getByRole('textbox',{name:'Private note',exact:true}).fill(privateNote);
  const savedResponse=page.waitForResponse(response=>response.request().method()==='PUT'&&new URL(response.url()).pathname.replace(/\/$/,'')===`/api/v1/me/wishlists/${id}`&&response.status()===200);await editor.getByRole('button',{name:'Save list',exact:true}).click();let saved=await (await savedResponse).json() as Wishlist;
  let collection=await (await context.request.get('/api/v1/me/collection')).json();expect(collection.saved).toEqual(['apple']);expect(collection.inquiries).toEqual(inquiry);expect(collection.compare).toEqual(['apple']);
  await editor.locator('[data-wishlist-name]').fill('Unsaved local project');const remote=await mutate(context.request,`/me/wishlists/${id}?locale=en`,{name:'Other session project '+runId,description:saved.description,purpose:saved.purpose,items:saved.items.map(item=>({id:item.id,reference:item.reference,note:item.note}))},'PUT',{'If-Match':String(saved.version)});expect(remote.status()).toBe(200);saved=await remote.json();
  await editor.getByRole('button',{name:'Save list',exact:true}).click();await expect(editor.getByRole('alert')).toContainText('Your draft is preserved');await expect(editor.locator('[data-wishlist-name]')).toHaveValue('Unsaved local project');page.once('dialog',dialog=>dialog.accept());await editor.getByRole('button',{name:'Load saved version',exact:true}).click();await expect(editor.locator('[data-wishlist-name]')).toHaveValue(saved.name);
  const sharing=page.locator('[data-wishlist-sharing]');await sharing.getByRole('textbox',{name:'Title visible to visitors'}).fill('Public project '+runId);await sharing.getByRole('checkbox',{name:'I reviewed the public title and selected items for sharing.'}).check();const shareResponse=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.replace(/\/$/,'')===`/api/v1/me/wishlists/${id}/shares`&&response.status()===201);await sharing.getByRole('button',{name:'Create share link',exact:true}).click();const shared=await (await shareResponse).json();await expect(sharing.locator('[data-wishlist-share-url]')).toHaveValue(shared.url);
  const rawToken=new URL(shared.url).pathname.split('/').filter(Boolean).at(-1);expect(rawToken).toMatch(/^[a-f0-9]{64}$/);const browserStorage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));expect(browserStorage).not.toContain(rawToken!);expect(browserStorage).not.toContain(privateNote);
  const anonymous=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'});const viewer=await anonymous.newPage(),privateRequests:string[]=[];viewer.on('request',request=>{const path=new URL(request.url()).pathname;if(/\/api\/v1\/(?:auth|me)(?:\/|$)/.test(path))privateRequests.push(path);});const shown=await viewer.goto(new URL(shared.url).pathname);expect(shown?.status()).toBe(200);expect(shown?.headers()['cache-control']).toContain('no-store');expect(shown?.headers()['referrer-policy']).toBe('no-referrer');await expect(viewer.locator('meta[name="robots"]')).toHaveAttribute('content',/noindex/);await expect(viewer.getByRole('heading',{level:1})).toHaveText('Public project '+runId);await expect(viewer.locator('[data-public-wishlist] [data-wishlist-content="product:apple"]')).toBeVisible();const sharedText=await viewer.locator('body').innerText();expect(sharedText).not.toContain(owner.email);expect(sharedText).not.toContain(privateNote);expect(sharedText).not.toContain('Private project description');expect(privateRequests).toEqual([]);await testInfo.attach('named-wishlist-share.png',{body:await viewer.screenshot({fullPage:true}),contentType:'image/png'});
  await center.getByRole('button',{name:'New list',exact:true}).click();dialog=page.getByRole('dialog');const destinationName='Destination '+runId;await dialog.getByRole('textbox',{name:'List name',exact:true}).fill(destinationName);await dialog.getByRole('button',{name:'New list',exact:true}).click();await expect(dialog).toHaveCount(0);const destinationId=await page.locator('[data-wishlist-editor]').getAttribute('data-wishlist-editor');await center.locator(`[data-wishlist-list="${id}"]`).click();await expect(page.locator('[data-wishlist-editor]')).toHaveAttribute('data-wishlist-editor',id!);await page.locator('[data-wishlist-editor]').getByRole('checkbox',{name:/Select item Apple/}).check();await center.getByRole('combobox',{name:'Destination list',exact:true}).selectOption(destinationId!);const transferred=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.replace(/\/$/,'')===`/api/v1/me/wishlists/${id}/transfer`&&response.status()===200);await center.getByRole('button',{name:'Copy selected items',exact:true}).click();await transferred;const copied=await (await context.request.get(`/api/v1/me/wishlists/${destinationId}?locale=en`)).json();expect(copied.items[0].note).toBe(privateNote);
  await page.locator(`[data-wishlist-share="${shared.share.id}"]`).getByRole('button',{name:'Revoke link',exact:true}).click();await expect(page.locator(`[data-wishlist-share="${shared.share.id}"]`)).toContainText('Revoked');expect((await anonymous.request.get(`/api/v1/wishlist-shares/${rawToken}?locale=en`)).status()).toBe(404);expect((await viewer.reload())?.status()).toBe(404);
  await editor.getByRole('button',{name:'Delete list',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete list',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await context.request.get(`/api/v1/me/wishlists/${id}?locale=en`)).status()).toBe(404);collection=await (await context.request.get('/api/v1/me/collection')).json();expect(collection.inquiries).toEqual(inquiry);expect(collection.compare).toEqual(['apple']);await anonymous.close();
});

test('all five public catalogues render with correct language and no demo authentication',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  for(const locale of ['fa','en','tr','ar','ru']){
    const response=await page.goto(`/${locale}/products`);expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang',locale);
    await expect(page.locator('html')).toHaveAttribute('dir',['fa','ar'].includes(locale)?'rtl':'ltr');
    await expect(page.locator('main h1')).toBeVisible();
    expect((await page.locator('body').innerText()).toLowerCase()).not.toContain('demo@');
  }
  expect(errors).toEqual([]);
});

test('anonymous inquiry survives login and a lost merge response can be retried without adding quantities twice',async({page,context})=>{
  test.setTimeout(120000);const owner=await fixture('customer'),privateNote='Private account line '+runId;
  await pool.query('UPDATE user_settings SET collection=$2::jsonb WHERE user_id=$1',[owner.id,JSON.stringify({inquiries:[{productId:'apple',quantity:2},{productId:'president',quantity:1,note:privateNote}],compare:['apple'],saved:['president']})]);
  await page.goto('/en/products/apple');await expect(page.locator('.product-detail-copy h1')).toBeVisible();await page.getByRole('spinbutton',{name:'Required quantity',exact:true}).fill('3');await page.locator('.product-primary-actions').getByRole('button',{name:'Add to inquiry',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('idealmakoo.guest-inquiry.v1')||'null')?.items?.[0]?.quantity)).toBe(3);
  const intents:string[]=[],duplicates:boolean[]=[];
  await page.route('**/api/v1/me/collection/merge',async route=>{
    if(route.request().method()!=='POST')return route.continue();intents.push(route.request().postDataJSON().id);const response=await route.fetch(),result=await response.json();expect(response.status()).toBe(200);duplicates.push(result.duplicate);
    if(intents.length===1)return route.fulfill({status:503,contentType:'application/problem+json',body:JSON.stringify({status:503,title:'The committed response was lost in this acceptance fixture.'})});
    return route.fulfill({response});
  });
  await login(page,owner.email);await expect(page).toHaveURL(/\/en\/account\/?$/);const notice=page.locator('[data-guest-inquiry-merge]');await expect(notice).toBeVisible();await expect(notice.getByRole('button',{name:'Check and retry',exact:true})).toBeEnabled();
  let collection=await(await context.request.get('/api/v1/me/collection')).json();expect(collection.inquiries.find((line:{productId:string})=>line.productId==='apple').quantity).toBe(5);expect(collection.inquiries.find((line:{productId:string})=>line.productId==='president').note).toBe(privateNote);
  const retained=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));expect(retained).not.toContain(privateNote);
  await notice.getByRole('button',{name:'Check and retry',exact:true}).click();await expect(notice).toHaveCount(0);expect(intents).toHaveLength(2);expect(intents[0]).toBe(intents[1]);expect(duplicates).toEqual([false,true]);
  collection=await(await context.request.get('/api/v1/me/collection')).json();expect(collection.inquiries.find((line:{productId:string})=>line.productId==='apple').quantity).toBe(5);expect(collection.compare).toEqual(['apple']);expect(collection.saved).toEqual(['president']);
  expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('idealmakoo.guest-inquiry.v1')))).toEqual([]);await page.unroute('**/api/v1/me/collection/merge');
});

test('registration, persistent profile, visible failed-save state and private request ownership',async({page,context,browser})=>{
  const email=`e2e-customer-${runId}@example.test`;
  await page.goto('/en/auth/register');
  await page.locator('input[name="name"]').fill('E2E Customer');await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);await page.locator('input[name="confirmPassword"]').fill(password);
  await page.locator('form input[type="checkbox"]').check();await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/en\/account\/?$/);
  const user=(await session(context.request)).user;expect(user.role).toBe('customer');fixtureIds.push(user.id);
  expect((await context.cookies()).find(cookie=>cookie.name==='im_session')?.httpOnly).toBe(true);
  const localSecrets=await page.evaluate(()=>Object.keys(localStorage).filter(key=>/session|workspace|local-accounts|password/.test(key)));
  expect(localSecrets).toEqual([]);

  await page.goto('/en/account/profile');const name=page.getByRole('textbox',{name:'Full name',exact:true});await expect(name).toBeVisible();
  await name.fill('E2E Durable Profile');
  await page.route('**/api/v1/me/profile',route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/problem+json',body:JSON.stringify({title:'Temporarily unavailable',status:503})}):route.continue());
  await page.locator('form button[type="submit"]').click();await expect(page.locator('main').getByRole('alert')).toContainText('server could not save');
  await expect(name).toHaveValue('E2E Durable Profile');expect((await (await context.request.get('/api/v1/me/settings')).json()).profile.name).toBe('E2E Customer');
  await page.unroute('**/api/v1/me/profile');await page.locator('form button[type="submit"]').click();
  await expect(page.locator('form button[type="submit"]')).toBeDisabled();await page.reload();await expect(name).toHaveValue('E2E Durable Profile');

  await page.goto('/en/contact');const form=page.locator('.request-form-shell form');
  await form.locator('input[name="name"]').fill('E2E Durable Profile');await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="phone"]').fill('+982188889999');await form.locator('input[name="organization"]').fill('E2E Laboratory');await form.locator('input[name="country"]').fill('Iran');
  await form.locator('textarea').fill('Please review this acceptance-test contact request.');await form.locator('input[type="checkbox"]').check();
  await form.locator('button[type="submit"]').click();const created=page.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/requests')&&response.request().method()==='POST'&&(response.status()<300||response.status()>=400));
  await form.locator('button[type="submit"]').click();const response=await created;expect(response.status()).toBe(201);const request=await response.json();
  await expect(page.locator('.tracking-code')).toContainText(request.id);expect(request.locale).toBe('en');
  // Keep the real owned request unresolved through hydration. A loading list
  // must not claim that this known request does not exist or remove its frame.
  await page.addInitScript(()=>{
    const browser=window as typeof window&{__accountStartup:{sawFrame:boolean;lostFrame:boolean}};
    const state:{sawFrame:boolean;lostFrame:boolean}=browser.__accountStartup={sawFrame:false,lostFrame:false};
    new MutationObserver(()=>{
      const frame=!!document.querySelector('main [data-page-shell="account"] h1');
      if(state.sawFrame&&!frame)state.lostFrame=true;state.sawFrame ||= frame;
    }).observe(document,{subtree:true,childList:true});
  });
  let releaseRequest!:()=>void,markRequestSeen!:()=>void,firstRequest=true;
  const heldRequest=new Promise<void>(resolve=>{releaseRequest=resolve;});
  const requestSeen=new Promise<void>(resolve=>{markRequestSeen=resolve;});
  await page.route('**/api/v1/requests',async route=>{
    if(route.request().method()!=='GET'||!firstRequest)return route.continue();
    firstRequest=false;markRequestSeen();await heldRequest;
    await route.fulfill({status:503,contentType:'application/problem+json',body:JSON.stringify({title:'Controlled unavailable list',status:503})});
  });
  try{
    await page.goto(`/en/account/requests?id=${encodeURIComponent(request.id)}`,{waitUntil:'domcontentloaded'});
    await requestSeen;
    await expect(page.locator('main [data-page-shell="account"] h1')).toBeVisible();
    await expect(page.locator('[data-account-body-state="loading"]')).toBeVisible();
    await expect(page.getByText(accountText('en','noTracking',key=>translate('en',key)),{exact:true})).toHaveCount(0);
    await expect(page.getByText(accountText('en','noRequests',key=>translate('en',key)),{exact:true})).toHaveCount(0);
    releaseRequest();
    const error=page.locator('[data-account-body-state="error"]');await expect(error.getByRole('alert')).toBeVisible();
    await error.getByRole('button',{name:'Try again',exact:true}).click();
    await expect(page.locator('main')).toContainText(request.id);
    await expect(page.locator('main')).toContainText('Please review this acceptance-test contact request.');
    await expect(page.locator('[data-account-body-state]')).toHaveCount(0);
    expect(await page.evaluate(()=>(window as typeof window&{__accountStartup:{sawFrame:boolean;lostFrame:boolean}}).__accountStartup)).toEqual({sawFrame:true,lostFrame:false});
  }finally{releaseRequest();await page.unroute('**/api/v1/requests');}

  const outsider=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'});const different=await mutate(outsider.request,'/auth/register',{name:'E2E Other',email:`e2e-other-${runId}@example.test`,password});expect(different.status()).toBe(201);fixtureIds.push((await different.json()).user.id);
  expect((await outsider.request.get(`/api/v1/requests/${request.id}`)).status()).toBe(404);
  expect((await mutate(outsider.request,`/requests/${request.id}`,{status:'withdrawn'},'PATCH',{'If-Match':'1'})).status()).toBe(404);
  await outsider.close();

  await mutate(context.request,'/auth/logout',{});await page.goto('/en/admin');await expect(page.getByRole('link',{name:'Sign in',exact:true})).toBeVisible();
  await page.evaluate(()=>localStorage.setItem('idealmakoo.session.v1',JSON.stringify({id:'forged',name:'Injected',email:'forged@example.test',role:'superAdmin',demo:true})));
  await page.reload();expect((await session(context.request)).user).toBe(null);expect((await context.request.get('/api/v1/workspace')).status()).toBe(401);
  await expect(page.locator('.ws-role-selector')).toHaveCount(0);
});

test('staff enrollment, genuine TOTP and recovery challenge gate the workspace',async({page,context})=>{
  const staff=await fixture('contentEditor');await login(page,staff.email);await expect(page).toHaveURL(/\/en\/account\/security\/?$/);
  const denied=await context.request.get('/api/v1/workspace');expect(denied.status()).toBe(403);expect((await denied.json()).code).toBe('MFA_REQUIRED');
  const mfa=page.locator('[data-security-section="mfa"]');await mfa.locator('input[type="password"]').fill(password);await mfa.locator('form button').click();
  const secret=(await mfa.locator('[data-enrollment-secret]').innerText()).trim();expect(secret).toMatch(/^[A-Z2-7]+$/);
  await mfa.locator('input[autocomplete="one-time-code"]').fill(totp(secret,Math.floor(Date.now()/30000)));await mfa.locator('form button').click();
  await expect(mfa.locator('[data-recovery-codes] code')).toHaveCount(10);const recovery=await mfa.locator('[data-recovery-codes] code').first().innerText();
  expect((await context.request.get('/api/v1/workspace')).status()).toBe(200);await page.goto('/en/admin');await expect(page.locator('#workspace-content')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify(localStorage).includes('mfa_secret'))).toBe(false);
  await mutate(context.request,'/auth/logout',{});await login(page,staff.email);await expect(page).toHaveURL(/\/en\/auth\/mfa\/?$/);
  await page.locator('input[autocomplete="one-time-code"]').fill(recovery);await page.locator('form button[type="submit"]').click();await expect(page).toHaveURL(/\/en\/admin\/?$/);
  expect((await context.request.get('/api/v1/workspace')).status()).toBe(200);
});

test('independent review publishes a durable page visible in a fresh browser and withdrawal removes it',async({browser})=>{
  test.setTimeout(180000);
  const roles=['contentEditor','scientificReviewer','publisher'];const contexts=[];const users=[];
  for(const role of roles){const user=await fixture(role),ctx=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'});users.push(user);contexts.push(ctx);expect((await mutate(ctx.request,'/auth/login',{email:user.email,password})).ok()).toBeTruthy();await enrollViaApi(ctx.request);}
  const [editor,reviewer,publisher]=contexts;const id=`e2e-page-${runId}`,title=`Published acceptance page ${runId}`;
  let workspace=await (await editor.request.get('/api/v1/workspace')).json();
  const page={id,slug:id,locale:'en',title,summary:'Independently reviewed durable content.',blocks:[{id:`${id}-body`,type:'rich-text',title:'Production content',body:'Draft content awaiting the author.'}],status:'draft',version:1,author:users[0].role,authorId:users[0].id,updatedAt:new Date().toISOString()};
  expect((await mutate(editor.request,'/workspace',{state:{...workspace.state,pages:[...workspace.state.pages,page]},expectedVersion:workspace.version,locale:'en'},'PUT')).ok()).toBeTruthy();
  const before=await (await editor.request.get('/api/v1/site')).json();expect(before.publications.some((entry:{id:string})=>entry.id===id)).toBe(false);
  const author=await editor.newPage();await author.goto(`/en/admin/pages?id=${encodeURIComponent(id)}`);
  await expect(author.locator('.ws-builder-selector select')).toHaveValue(id);
  const collaboration=author.locator('[data-editor-collaboration]');await expect(collaboration).toHaveAttribute('data-lease-state','held');
  const markdown='## Reviewed heading\n\nThis **reviewed text** and *emphasis* must survive a fresh anonymous browser context.\n\n- First specification\n- Second specification\n\n| Property | Value |\n| --- | --- |\n| Material | PMMA |\n\n<script>window.__unsafeEditorial=true</script>\n\n[unsafe link](javascript:alert(1))';
  const editorField=author.locator('[data-rich-editor]');await editorField.locator('textarea').fill(markdown);
  await editorField.getByRole('button',{name:'Preview',exact:true}).click();await expect(editorField.locator('strong')).toHaveText('reviewed text');await editorField.getByRole('button',{name:'Write',exact:true}).click();
  const saved=author.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/workspace')&&response.request().method()==='PUT'&&response.status()<300);
  await author.locator('.ws-builder-actions .btn-primary').click();expect((await saved).ok()).toBeTruthy();
  await expect(collaboration).toHaveAttribute('data-lease-state','held');
  const peer=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce',storageState:await editor.storageState()}),peerPage=await peer.newPage();
  await peerPage.goto('/en/admin/pages?id='+encodeURIComponent(id));await expect(peerPage.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','locked');await expect(peerPage.locator('[data-rich-editor] textarea')).toBeDisabled();
  const pinned=await (await peer.request.get('/api/v1/workspace')).json(),forged=structuredClone(pinned.state);forged.pages.find((entry:{id:string})=>entry.id===id).title='Blocked parallel overwrite';
  const blocked=await mutate(peer.request,'/workspace',{state:forged,expectedVersion:pinned.version,locale:'en'},'PUT');expect(blocked.status()).toBe(423);await peer.close();
  await collaboration.locator('summary').click();const previewCreated=author.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/content/previews')&&response.request().method()==='POST');
  await collaboration.getByRole('button',{name:'Create preview link',exact:true}).click();const previewResult=await previewCreated;expect(previewResult.status()).toBe(201);const preview=await previewResult.json();
  const previewGuest=await browser.newContext({baseURL,serviceWorkers:'block'});const previewResponse=await previewGuest.request.get(preview.url);expect(previewResponse.status()).toBe(200);expect(previewResponse.headers()['cache-control']).toContain('no-store');expect(await previewResponse.text()).toContain('survive a fresh anonymous browser');
  expect(previewResponse.headers()['content-security-policy']).toContain("default-src 'none'");expect(previewResponse.headers()['content-security-policy']).toContain('sandbox');expect(previewResponse.headers()['referrer-policy']).toBe('no-referrer');expect(previewResponse.headers()['set-cookie']).toBeUndefined();
  expect(await author.evaluate(token=>JSON.stringify(localStorage).includes(token)||JSON.stringify(sessionStorage).includes(token),preview.url.split('/').at(-1))).toBe(false);
  const previewRevoked=author.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/content/previews/'+preview.id)&&response.request().method()==='DELETE');await collaboration.getByRole('button',{name:'Revoke link',exact:true}).click();expect((await previewRevoked).ok()).toBeTruthy();expect((await previewGuest.request.get(preview.url)).status()).toBe(404);await previewGuest.close();
  await author.locator('[data-shared-block-toolbar]').getByRole('button',{name:'Shared block library',exact:true}).click();
  const sharedDialog=author.getByRole('dialog'),library=sharedDialog.locator('[data-shared-block-library]'),createShared=library.locator('aside form');
  await createShared.getByRole('textbox',{name:'Name',exact:true}).fill('E2E reusable block '+runId);
  const libraryCreated=author.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/content/blocks')&&response.request().method()==='POST');
  await createShared.getByRole('button',{name:'Create from saved page block',exact:true}).click();const sharedResponse=await libraryCreated;expect(sharedResponse.status()).toBe(201);const shared=await sharedResponse.json();expect(shared.revision.payload.body).toBe(markdown);
  const replace=library.getByRole('button',{name:'Replace selected block with this revision',exact:true});await expect(replace).toBeEnabled();const attached=author.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/content/blocks/'+shared.block.id+'/attach')&&response.request().method()==='POST');await replace.click();expect((await attached).status()).toBe(200);await expect(replace).toBeEnabled();
  await sharedDialog.getByRole('button',{name:'Close',exact:true}).click();await expect(author.locator('[data-rich-editor] textarea')).toBeDisabled();
  const authoritative=await (await editor.request.get('/api/v1/workspace')).json();expect(authoritative.state.pages.find((entry:{id:string})=>entry.id===id).blocks[0].shared.revisionId).toBe(shared.revision.id);
  const cmsScreenshot=test.info().outputPath('cms-shared-block-editor.png');await author.screenshot({path:cmsScreenshot,fullPage:true});await test.info().attach('CMS saved shared block editor',{path:cmsScreenshot,contentType:'image/png'});
  const submitted=author.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/workspace')&&response.request().method()==='PUT'&&response.status()<300);
  await author.getByRole('button',{name:'Submit for review',exact:true}).click();expect((await submitted).ok()).toBeTruthy();

  workspace=await (await reviewer.request.get('/api/v1/workspace')).json();
  const approved=await mutate(reviewer.request,'/workspace/review',{bucket:'pages',id,locale:'en',expectedVersion:workspace.version});expect(approved.ok()).toBeTruthy();
  workspace=await (await publisher.request.get('/api/v1/workspace')).json();const published=await mutate(publisher.request,'/workspace/publish',{publication:{id,kind:'page',locale:'en'},expectedVersion:workspace.version});expect(published.ok()).toBeTruthy();
  const anonymous=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'});const visitor=await anonymous.newPage();const response=await visitor.goto(`/en/${id}`);expect(response?.status()).toBe(200);await expect(visitor.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(visitor.locator('main')).toContainText('survive a fresh anonymous browser');
  await expect(visitor).toHaveTitle(new RegExp(title));expect((await visitor.content()).includes(users[0].email)).toBe(false);
  await expect(visitor.locator('main strong')).toContainText('reviewed text');await expect(visitor.locator('main em')).toContainText('emphasis');
  await expect(visitor.getByRole('heading',{name:'Reviewed heading',exact:true})).toBeVisible();await expect(visitor.getByRole('cell',{name:'PMMA',exact:true})).toBeVisible();
  expect(await visitor.evaluate(()=>Object.hasOwn(window,'__unsafeEditorial'))).toBe(false);await expect(visitor.locator('main a[href^="javascript:"]')).toHaveCount(0);
  const publicScreenshot=test.info().outputPath('published-reviewed-page.png');await visitor.screenshot({path:publicScreenshot,fullPage:true});await test.info().attach('Public independently reviewed content',{path:publicScreenshot,contentType:'image/png'});

  workspace=await (await publisher.request.get('/api/v1/workspace')).json();expect((await mutate(publisher.request,'/workspace/unpublish',{slug:id,kind:'page',locale:'en',expectedVersion:workspace.version})).ok()).toBeTruthy();
  const withdrawn=await visitor.reload();expect(withdrawn?.status()).toBe(404);
  await anonymous.close();for(const ctx of contexts)await ctx.close();
});

test('verified customer reserves a real factory session and withdrawal releases the seats',async({page,context,browser})=>{
 test.setTimeout(150000);const manager=await fixture('admin'),customer=await fixture('customer'),staff=await browser.newContext({baseURL,serviceWorkers:'block'});
 expect((await mutate(staff.request,'/auth/login',{email:manager.email,password})).ok()).toBeTruthy();await enrollViaApi(staff.request);
 const starts=new Date(Date.now()+86400000*14),ends=new Date(starts.getTime()+3600000),title='E2E factory session '+runId;
 const createdSession=await mutate(staff.request,'/event-sessions',{kind:'factory_visit',title:Object.fromEntries(['fa','en','tr','ar','ru'].map(locale=>[locale,title])),startsAt:starts.toISOString(),endsAt:ends.toISOString(),timezone:'UTC',location:'Acceptance factory room',capacity:2,waitlistEnabled:true,state:'open'});expect(createdSession.status()).toBe(201);const slot=await createdSession.json();
 await login(page,customer.email);await expect(page).toHaveURL(/\/en\/account\/?$/);await page.goto('/en/factory-visit');
 const form=page.locator('.request-form-shell form');await form.getByRole('combobox',{name:'Scheduled session',exact:true}).selectOption(slot.id);await form.getByRole('spinbutton',{name:'Number of participants',exact:true}).fill('2');
 await form.locator('input[name="phone"]').fill('+982188889999');await form.locator('input[name="organization"]').fill('E2E Factory Visitors');await form.locator('input[name="country"]').fill('Iran');await form.locator('textarea').fill('Please reserve this controlled factory acceptance visit.');await form.locator('input[type="checkbox"]').check();
 await form.locator('button[type="submit"]').click();const created=page.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/requests')&&response.request().method()==='POST');await form.locator('button[type="submit"]').click();const response=await created;expect(response.status()).toBe(201);const request=await response.json();expect(request.booking.status).toBe('confirmed');expect(request.booking.seats).toBe(2);
 await expect(page.locator('[data-booking-status="confirmed"]')).toContainText(title);await page.goto('/en/account/bookings');await expect(page.locator('[data-booking-status="confirmed"]')).toContainText(title);
 await page.goto('/en/account/requests?id='+encodeURIComponent(request.id));await page.getByRole('button',{name:'Withdraw request',exact:true}).click();const withdrawn=page.waitForResponse(result=>result.url().replace(/\/$/,'').endsWith('/api/v1/requests/'+request.id)&&result.request().method()==='PATCH');await page.getByRole('dialog').getByRole('button',{name:'Withdraw request',exact:true}).click();expect((await withdrawn).ok()).toBeTruthy();await expect(page.locator('[data-booking-status="cancelled"]')).toBeVisible();
 const sessions=await (await context.request.get('/api/v1/event-sessions?kind=factory_visit&locale=en')).json();expect(sessions.items.find((item:{id:string})=>item.id===slot.id).remaining).toBe(2);
 const managed=await (await staff.request.get('/api/v1/event-sessions/manage')).json(),fresh=managed.items.find((item:{id:string})=>item.id===slot.id);expect((await mutate(staff.request,'/event-sessions/'+slot.id,undefined,'DELETE',{'If-Match':String(fresh.version)})).ok()).toBeTruthy();await staff.close();
});

test('notification matrix persists each channel and resolves a genuine concurrent-version conflict explicitly',async({page,context})=>{
 const customer=await fixture('customer');await login(page,customer.email);await expect(page).toHaveURL(/\/en\/account\/?$/);await page.goto('/en/account/notifications');
 const panel=page.locator('[data-notification-preferences]'),timezone=panel.getByRole('combobox',{name:'Notification time zone',exact:true});await expect(timezone).toBeVisible();const initial=await (await context.request.get('/api/v1/me/notification-preferences')).json();
 await timezone.fill('UTC');await panel.locator('details').filter({has:page.locator('summary', {hasText:'Products'})}).locator('summary').click();
 await panel.getByRole('checkbox',{name:'Products · Email',exact:true}).check();await panel.getByRole('combobox',{name:/Products · Email ·/}).selectOption('daily');await panel.getByRole('checkbox',{name:'Products · Email · Enable quiet hours',exact:true}).check();
 await panel.getByLabel('Products · Email · Quiet hours start',{exact:true}).fill('21:30');await panel.getByLabel('Products · Email · Quiet hours end',{exact:true}).fill('08:30');
 expect((await mutate(context.request,'/me/notification-preferences',{expectedVersion:initial.version,preferences:{...initial.preferences,timezone:'Europe/Istanbul'}},'PATCH')).ok()).toBeTruthy();
 await panel.locator('form button').click();await expect(panel.getByRole('button',{name:'Keep my edits for review',exact:true})).toBeVisible();await expect(timezone).toHaveValue('UTC');
 await panel.getByRole('button',{name:'Keep my edits for review',exact:true}).click();const persisted=page.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/me/notification-preferences')&&response.request().method()==='PATCH'&&response.ok());await panel.locator('form button').click();await persisted;await page.reload();await expect(timezone).toHaveValue('UTC');
 const saved=await (await context.request.get('/api/v1/me/notification-preferences')).json();expect(saved.preferences.topics.products.email).toEqual({enabled:true,frequency:'daily',quietStart:'21:30',quietEnd:'08:30'});expect(saved.preferences.topics.events.email.enabled).toBe(false);
});

test('private file becomes an independently reviewed version and a real public document download',async({page,context,browser})=>{
  test.setTimeout(180000);
  const manager=await fixture('admin'),reviewer=await fixture('scientificReviewer');
  expect((await mutate(context.request,'/auth/login',{email:manager.email,password})).ok()).toBeTruthy();await enrollViaApi(context.request);
  const reviewContext=await browser.newContext({baseURL,serviceWorkers:'block'});
  expect((await mutate(reviewContext.request,'/auth/login',{email:reviewer.email,password})).ok()).toBeTruthy();await enrollViaApi(reviewContext.request);
  await page.goto('/en/admin/resources');const panel=page.locator('[data-resource-management]');
  await panel.getByRole('button',{name:'Create',exact:true}).click();
  const form=panel.locator('form').first(),slug='e2e-controlled-'+runId,title='E2E reviewed document '+runId;
  await form.locator('input[pattern="[a-z0-9]+(-[a-z0-9]+)*"]').fill(slug);
  for(const language of ['fa','en','tr','ar','ru']){
    await form.locator('input[lang="'+language+'"]').fill(title+' '+language);
    await form.locator('textarea[lang="'+language+'"]').fill('Immutable document acceptance version.');
  }
  const added=page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')==='/api/v1/resources'&&response.request().method()==='POST');
  await form.getByRole('button',{name:'Create',exact:true}).click();const created=await added;expect(created.status()).toBe(201);const resource=await created.json();
  await expect(panel.getByRole('heading',{level:3,name:title+' en',exact:true})).toBeVisible();
  await panel.getByRole('textbox',{name:'File version label',exact:true}).fill('Verified image v1');
  await panel.getByRole('checkbox',{name:'I confirm the right to use and distribute this file.',exact:true}).check();
  const png=await sharp({create:{width:64,height:64,channels:3,background:{r:22,g:132,b:155}}}).png().toBuffer();
  await panel.locator('input[type="file"]').setInputFiles({name:'acceptance-document.png',mimeType:'image/png',buffer:png});
  const uploaded=page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')==='/api/v1/attachments'&&response.request().method()==='POST');
  await panel.locator('button').filter({hasText:/^Private upload for review$/}).click();const uploadedResponse=await uploaded;expect(uploadedResponse.status()).toBe(201);const asset=await uploadedResponse.json();expect(asset.scanStatus).toBe('clean');expect(asset.visibility).toBe('private');
  const versionAdded=page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')===`/api/v1/resources/${resource.id}/versions`&&response.request().method()==='POST');
  await panel.getByRole('button',{name:'Add file version',exact:true}).click();const versionResponse=await versionAdded;expect(versionResponse.ok()).toBeTruthy();const changed=await versionResponse.json(),version=changed.versions[0];
  expect((await mutate(reviewContext.request,`/resources/${resource.id}/versions/${version.id}/review`,{decision:'approved',note:'Independent acceptance review of the actual clean file.'})).ok()).toBeTruthy();
  await page.reload();await panel.getByRole('button',{name:new RegExp('^'+title+' en')}).click();
  const published=page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')===`/api/v1/resources/${resource.id}/publish`&&response.request().method()==='POST');
  await panel.getByRole('button',{name:'Publish reviewed version',exact:true}).click();expect((await published).ok()).toBeTruthy();
  const anonymous=await browser.newContext({baseURL,serviceWorkers:'block'}),visitor=await anonymous.newPage();
  const response=await visitor.goto('/en/resources/'+slug);expect(response?.status()).toBe(200);await expect(visitor.locator('main')).toContainText(title+' en');
  expect(response?.headers()['cache-control']).toContain('no-store');expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(visitor).toHaveTitle(new RegExp('^'+title+' en'));await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute('href',new URL('/en/resources/'+slug+'/',baseURL).href);
  const downloaded=await anonymous.request.get(`/api/v1/resources/${resource.id}/versions/${version.id}/content?action=download`);
  expect(downloaded.status()).toBe(200);expect(downloaded.headers()['content-type']).toContain('image/webp');expect(downloaded.headers()['content-security-policy']).toContain("default-src 'none'");expect(downloaded.headers()['content-security-policy']).toContain('sandbox');expect((await downloaded.body()).length).toBeGreaterThan(50);
  expect((await anonymous.request.get('/api/v1/attachments/'+asset.id)).status()).toBe(404);
  const archived=page.waitForResponse(result=>new URL(result.url()).pathname.replace(/\/$/,'')===`/api/v1/resources/${resource.id}`&&result.request().method()==='DELETE');
  await panel.getByRole('button',{name:'Archive',exact:true}).click();expect((await archived).ok()).toBeTruthy();
  expect((await anonymous.request.get(`/api/v1/resources/${resource.id}/versions/${version.id}/content?action=download`)).status()).toBe(404);
  expect((await visitor.reload())?.status()).toBe(404);
  await anonymous.close();await reviewContext.close();
});

test('organization shares separate view, reply and ownership in the customer portal',async({page,context,browser})=>{
  test.setTimeout(150000);
  const owner=await fixture('customer'),member=await fixture('customer');await login(page,owner.email);await expect(page).toHaveURL(/\/en\/account\/?$/);
  await page.goto('/en/account/organizations');await page.getByRole('button',{name:'Add organization',exact:true}).click();
  const dialog=page.getByRole('dialog'),organizationName=`E2E organization ${runId}`;
  await dialog.getByRole('textbox',{name:'Organization name',exact:true}).fill(organizationName);
  await dialog.getByRole('textbox',{name:'City',exact:true}).fill('Tehran');await dialog.getByRole('textbox',{name:'Country',exact:true}).fill('Iran');
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);
  const organizations=await (await context.request.get('/api/v1/me/organizations')).json();const organization=organizations.items.find((item:{name:string})=>item.name===organizationName);expect(organization.myRole).toBe('owner');
  await pool.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'member')",[organization.id,member.id]);
  const created=await mutate(context.request,'/requests',{kind:'contact',locale:'en',name:owner.email,email:owner.email,organization:organizationName,message:'Shared organization request.',productIds:[],consent:{purpose:'request_processing',acceptedAt:new Date().toISOString()}});expect(created.status()).toBe(201);const request=await created.json();
  await page.reload();const permission=page.getByRole('combobox',{name:`Access level ${request.id}`,exact:true});await expect(permission).toBeVisible();
  const share=async(value:'view'|'reply'|'none')=>{const response=page.waitForResponse(result=>result.url().replace(/\/$/,'').endsWith(`/requests/${request.id}`)&&['PUT','DELETE'].includes(result.request().method())&&result.status()<300);await permission.selectOption(value);expect((await response).ok()).toBeTruthy();};
  await share('view');
  const colleague=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'});expect((await mutate(colleague.request,'/auth/login',{email:member.email,password})).ok()).toBeTruthy();
  const visitor=await colleague.newPage();await visitor.goto(`/en/account/requests?id=${encodeURIComponent(request.id)}`);await expect(visitor.locator('main')).toContainText(request.id);
  await expect(visitor.locator('main form textarea')).toHaveCount(0);await expect(visitor.getByRole('button',{name:'Withdraw request',exact:true})).toHaveCount(0);
  const shared=(await (await colleague.request.get(`/api/v1/requests/${request.id}`)).json());expect(shared.access).toBe('shared_view');
  expect((await mutate(colleague.request,`/requests/${request.id}`,{status:'withdrawn'},'PATCH',{'If-Match':String(shared.version)})).status()).toBe(403);
  await share('reply');await visitor.reload();const reply=visitor.locator('main form textarea');await expect(reply).toBeVisible();await reply.fill('Reply by an explicitly authorized organization member.');
  const sent=visitor.waitForResponse(result=>result.url().replace(/\/$/,'').endsWith(`/requests/${request.id}`)&&result.request().method()==='PATCH'&&result.status()<300);await visitor.locator('main form button[type="submit"]').click();expect((await sent).ok()).toBeTruthy();await expect(reply).toHaveValue('');
  await expect(visitor.getByRole('button',{name:'Withdraw request',exact:true})).toHaveCount(0);await share('none');await visitor.reload();expect((await colleague.request.get(`/api/v1/requests/${request.id}`)).status()).toBe(404);
  const current=(await (await context.request.get('/api/v1/me/organizations')).json()).items.find((item:{id:string})=>item.id===organization.id);
  expect((await mutate(context.request,`/me/organizations/${organization.id}`,undefined,'DELETE',{'If-Match':String(current.version)})).ok()).toBeTruthy();await colleague.close();
});


test('a signed incoming fixture is explicitly associated as an internal note and connector keys stay out of browser storage',async({page,context,browser})=>{
 test.setTimeout(180000);const administrator=await fixture('admin'),customer=await fixture('customer');expect((await mutate(context.request,'/auth/login',{email:administrator.email,password})).ok()).toBeTruthy();await enrollViaApi(context.request);
 const customerContext=await browser.newContext({baseURL,serviceWorkers:'block'});expect((await mutate(customerContext.request,'/auth/login',{email:customer.email,password})).ok()).toBeTruthy();const createdRequest=await mutate(customerContext.request,'/requests',{kind:'contact',locale:'en',name:'Inbox acceptance customer',email:customer.email,message:'A genuine scoped request for the inbox association acceptance.',productIds:[],consent:{purpose:'request_processing',acceptedAt:new Date().toISOString()}});expect(createdRequest.status()).toBe(201);const request=await createdRequest.json();
 await page.goto('/en/admin/crm/inbox');const inbox=page.locator('[data-crm-inbox]');await inbox.getByRole('button',{name:'Show connector settings',exact:true}).click();const connectors=page.locator('[data-crm-connectors]');await connectors.getByRole('button',{name:'Create inbound connector',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Name',exact:true}).fill('E2E inbound '+runId);await dialog.getByRole('textbox',{name:'Provider / adapter',exact:true}).fill('Local acceptance adapter');const active=dialog.getByRole('checkbox',{name:'Active',exact:true});await expect(active).not.toBeChecked();await active.check();
 const createdConnector=page.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/crm/connectors')&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();const creation=await createdConnector;expect(creation.status()).toBe(201);const {connector,signingSecret}=await creation.json();const keyPanel=page.locator('[data-connector-secret]');await expect(keyPanel.locator('textarea')).toHaveValue(signingSecret);expect(await page.evaluate(secret=>JSON.stringify(localStorage).includes(secret)||JSON.stringify(sessionStorage).includes(secret),signingSecret)).toBe(false);await keyPanel.getByRole('button',{name:'Hide and clear this key from the view',exact:true}).click();await expect(keyPanel).toHaveCount(0);
 const subject='Signed incoming fixture '+runId,body='External sender is unverified; <img src=x onerror=alert(1)> is plain message text.',payload=JSON.stringify({providerEventId:'e2e-event-'+runId,occurredAt:new Date().toISOString(),sender:{name:'Unverified external sender',address:'unverified-sender@example.test'},subject,body}),timestamp=String(Math.floor(Date.now()/1000)),signature='v1='+createHmac('sha256',Buffer.from(signingSecret,'base64url')).update(timestamp+'.').update(payload).digest('hex');
 const incoming=await context.request.post('/api/v1/connectors/'+connector.id+'/events',{data:payload,headers:{'Content-Type':'application/json','X-Idealmakoo-Timestamp':timestamp,'X-Idealmakoo-Signature':signature}});expect(incoming.status()).toBe(200);const listing=await (await context.request.get('/api/v1/crm/inbox-items?state=pending')).json(),item=listing.items.find((value:{subject:string})=>value.subject===subject);expect(item.senderVerified).toBe(false);
 await inbox.locator(':scope > section').first().getByRole('button',{name:'Refresh status',exact:true}).click();const row=page.locator('[data-inbox-item="'+item.id+'"]');await expect(row).toContainText(subject);await row.getByRole('button',{name:'Record details',exact:true}).click();dialog=page.getByRole('dialog');await expect(dialog).toContainText('The external sender’s identity is unverified.');await expect(dialog.locator('img')).toHaveCount(0);const target=dialog.getByRole('combobox',{name:'Target request',exact:true});await expect(target).toBeEnabled();await target.selectOption(request.id);await dialog.getByRole('textbox',{name:'Reason for this operation',exact:true}).fill('Reviewed this request and retained the unverified source provenance.');await dialog.getByRole('checkbox').check();const associated=page.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/crm/inbox-items/'+item.id+'/associate')&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Save association and internal note',exact:true}).click();expect((await associated).status()).toBe(200);await expect(dialog).toContainText('Associated with a request');
 const staffView=await (await context.request.get('/api/v1/requests/'+request.id)).json(),customerView=await (await customerContext.request.get('/api/v1/requests/'+request.id)).json();expect(staffView.messages.some((message:{body:string;visibility:string})=>message.visibility==='internal'&&message.body.includes('External sender is unverified'))).toBe(true);expect(customerView.messages.some((message:{body:string})=>message.body.includes('External sender is unverified'))).toBe(false);
 const operationalState=await (await context.request.get('/api/v1/workspace')).json(),record=operationalState.state.records.find((value:{requestId?:string})=>value.requestId===request.id);expect(record).toBeTruthy();
 await page.goto('/en/admin/crm/activities');await page.getByRole('combobox',{name:'Related record',exact:true}).selectOption(record.id);const timeline=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Internal timeline$/})});await expect(timeline).toHaveCount(1);const internalNote='Recorded operational follow-up '+runId;await timeline.getByRole('textbox',{name:'Description',exact:true}).fill(internalNote);const noteSaved=page.waitForResponse(response=>response.url().replace(/\/$/,'').endsWith('/api/v1/crm/timeline')&&response.request().method()==='POST');await timeline.getByRole('button',{name:'Save',exact:true}).click();expect((await noteSaved).status()).toBe(201);await expect(timeline.getByText(internalNote,{exact:true})).toBeVisible();
 const persistedTimeline=await (await context.request.get('/api/v1/crm/records/'+record.id+'/timeline')).json();expect(persistedTimeline.items.some((value:{body:string})=>value.body===internalNote)).toBe(true);expect((await customerContext.request.get('/api/v1/crm/records/'+record.id+'/timeline')).status()).toBe(403);
 const current=(await (await context.request.get('/api/v1/crm/connectors')).json()).items.find((value:{id:string})=>value.id===connector.id);const {name,providerLabel,channel,teamId,territoryId,qualityQuarantined}=current;expect((await mutate(context.request,'/crm/connectors/'+connector.id,{name,providerLabel,channel,teamId,territoryId,qualityQuarantined,active:false},'PUT',{'If-Match':String(current.version)})).ok()).toBeTruthy();await customerContext.close();
});
