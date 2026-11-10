import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';
import type {PageDraft,WorkspaceState} from '../../src/data/workspace-seed';
import type {ManagedWorkspacePage} from '../../src/types/page-lifecycle';
import type {EditorRevision} from '../../src/types/editor-workflows';

const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const runId=randomUUID(),slug='lifecycle-'+runId.slice(0,12),pageId='E2E-LIFECYCLE-'+runId,faId=pageId+'-FA';
const password='E2e-page-lifecycle-'+randomUUID()+'-A9';
const authors=[{id:randomUUID(),email:`e2e-page-author-${runId}@example.test`,name:'Isolated page lifecycle author'},{id:randomUUID(),email:`e2e-page-reviewer-${runId}@example.test`,name:'Independent page lifecycle reviewer'}];
let pool:pg.Pool;
async function mutate(api:APIRequestContext,path:string,data:unknown,method='POST'){
 const session=await api.get('/api/v1/auth/session');expect(session.status()).toBe(200);const {csrfToken}=await session.json();
 return api.fetch('/api/v1'+path,{method,data,headers:{Origin:baseURL,'X-CSRF-Token':csrfToken,'Idempotency-Key':randomUUID()}});
}
async function login(api:APIRequestContext,email:string){
 expect((await mutate(api,'/auth/login',{email,password})).status()).toBe(200);
 const enrolled=await mutate(api,'/auth/mfa/enroll',{password});expect(enrolled.status()).toBe(200);const {secret}=await enrolled.json();
 expect((await mutate(api,'/auth/mfa/confirm',{code:totp(secret,Math.floor(Date.now()/30000))})).status()).toBe(200);
}
async function workspace(api:APIRequestContext):Promise<{state:WorkspaceState;version:number}>{const result=await api.get('/api/v1/workspace');expect(result.status()).toBe(200);return result.json();}
const responseFor=(page:Page,path:string,method:string)=>page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')===`/api/v1${path}`&&response.request().method()===method);

test.beforeAll(async()=>{
 const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;if(!database)throw new Error('Page lifecycle acceptance requires a migrated disposable database.');
 pool=new pg.Pool({connectionString:database,max:2});const hash=await passwordHash(password);
 // Identity and MFA eligibility are fixture setup. Every content state below
 // is created through the same live HTTP commands used by the application.
 for(const author of authors){await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales,quality_scope,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,'admin',true,$5::jsonb,true,'all',$6::jsonb)",[author.id,author.email,author.name,hash,JSON.stringify(['fa','en','tr','ar','ru']),JSON.stringify({contact:true,financial:true,baseCost:true,assign:true,intake:true})]);await pool.query('INSERT INTO user_settings(user_id) VALUES($1)',[author.id]);}
});
test.afterAll(async()=>{if(pool){await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[authors.map(row=>row.id)]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[authors.map(row=>row.id)]);await pool.end();}});

test('page panel archives and recycles a live scheduled page, then restores only a draft with retained history',async({page,context,browser})=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const reviewer=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'}),anonymous=await browser.newContext({baseURL,serviceWorkers:'block',reducedMotion:'reduce'});
 try{
  await login(context.request,authors[0].email);await login(reviewer.request,authors[1].email);
  let w=await workspace(context.request);const at=new Date().toISOString();
  const sources:PageDraft[]=(['en','fa'] as const).map(locale=>({id:locale==='en'?pageId:faId,slug,locale,title:locale==='en'?'Reviewed page lifecycle '+runId.slice(0,8):'صفحهٔ مستقل آزمون چرخه',summary:'A genuine, independently reviewed lifecycle fixture.',status:'review',version:1,author:'admin',authorId:authors[0].id,updatedAt:at,blocks:[{id:'body',type:'rich-text',title:'Preserved content',body:'This saved content and its immutable revision must survive archive and recycle.'}]}));
  expect((await mutate(context.request,'/workspace',{state:{...w.state,pages:[...w.state.pages,...sources]},expectedVersion:w.version,locale:'en'},'PUT')).status()).toBe(200);
  for(const source of sources){w=await workspace(reviewer.request);expect((await mutate(reviewer.request,'/workspace/review',{bucket:'pages',id:source.id,locale:source.locale,expectedVersion:w.version})).status()).toBe(200);w=await workspace(context.request);expect((await mutate(context.request,'/workspace/publish',{publication:{id:source.id,kind:'page',locale:source.locale},expectedVersion:w.version})).status()).toBe(200);}
  w=await workspace(context.request);expect((await mutate(context.request,'/workspace/schedule',{bucket:'pages',id:pageId,locale:'en',scheduledAt:new Date(Date.now()+20*60_000).toISOString(),expectedVersion:w.version})).status()).toBe(200);
  const savedTitle=sources[0].title;expect((await anonymous.request.get(`/en/${slug}/`)).status()).toBe(200);
  await page.goto(`/en/admin/pages/?id=${encodeURIComponent(pageId)}`);
  const editor=page.locator(`[data-page-editor][data-page-id="${pageId}"]`),lifecycle=editor.locator('[data-page-lifecycle]'),collaboration=editor.locator('[data-editor-collaboration]');
  await expect(editor).toBeVisible();await expect(lifecycle).toHaveAttribute('data-page-state','active');await expect(collaboration).toHaveAttribute('data-lease-state','held');
  const title=editor.locator('.ws-block-inspector').getByRole('textbox',{name:'Title',exact:true}).first();await expect(title).toHaveValue(savedTitle);await expect(title).toBeEnabled();
  await title.fill('Local unsaved wording must not leak into publication');await expect(editor).toHaveAttribute('data-page-dirty','true');await expect(lifecycle.getByRole('button',{name:'Archive page',exact:true})).toBeDisabled();await expect(lifecycle.getByRole('button',{name:'Move page to recycle bin',exact:true})).toBeDisabled();
  const unchanged=await anonymous.request.get(`/en/${slug}/`);expect(unchanged.status()).toBe(200);const liveHtml=await unchanged.text();expect(liveHtml).toContain(savedTitle);expect(liveHtml).not.toContain('Local unsaved wording must not leak');
  await lifecycle.getByRole('button',{name:'Discard local edits and load current page',exact:true}).click();await expect(title).toHaveValue(savedTitle);await expect(editor).toHaveAttribute('data-page-dirty','false');await expect(lifecycle).toHaveAttribute('data-page-state','active');

  await collaboration.locator('summary').filter({hasText:'Saved content previews'}).click();const previewResponse=responseFor(page,'/content/previews','POST');await collaboration.getByRole('button',{name:'Create preview link',exact:true}).click();const preview=await previewResponse;expect(preview.status()).toBe(201);const capability=await preview.json() as {url:string};expect((await anonymous.request.get(capability.url)).status()).toBe(200);
  const historyBefore=await context.request.get(`/api/v1/workspace/pages/${pageId}/revisions?locale=en`);expect(historyBefore.status()).toBe(200);const original=(await historyBefore.json() as {revisions:EditorRevision[]}).revisions[0];expect(original.approved_by).toBe(authors[1].id);

  async function action(label:'Archive page'|'Move page to recycle bin'|'Restore page as draft',operation:'archive'|'delete'|'restore'){
   await expect(lifecycle.getByRole('button',{name:label,exact:true})).toBeEnabled();await lifecycle.getByRole('button',{name:label,exact:true}).click();const dialog=page.getByRole('dialog');
   await dialog.getByRole('textbox',{name:'Reason (at least 8 characters)',exact:true}).fill('Reviewed explicit browser page lifecycle action');await dialog.getByRole('checkbox',{name:'I have reviewed the selected action and version.',exact:true}).check();
   const resultPromise=responseFor(page,`/workspace/pages/${pageId}/lifecycle`,'POST');await dialog.getByRole('button',{name:label,exact:true}).click();const result=await resultPromise;expect(result.status()).toBe(200);expect(result.request().postDataJSON().operation).toBe(operation);expect(result.request().postDataJSON().expectedUpdatedAt).toBeTruthy();await expect(dialog).toHaveCount(0);
  }
  await action('Archive page','archive');await expect(lifecycle).toHaveAttribute('data-page-state','archived');await expect(title).toBeDisabled();expect((await anonymous.request.get(`/en/${slug}/`)).status()).toBe(404);expect((await anonymous.request.get(`/fa/${slug}/`)).status()).toBe(200);expect((await anonymous.request.get(capability.url)).status()).toBe(404);
  const schedules=await context.request.get('/api/v1/workspace/schedules');expect(schedules.status()).toBe(200);const retainedSchedules=(await schedules.json() as {items:{documentId:string;status:string;finishedAt:string|null}[]}).items.filter(row=>row.documentId===pageId);expect(retainedSchedules.length).toBeGreaterThan(0);expect(retainedSchedules.every(row=>row.status==='cancelled'&&row.finishedAt)).toBe(true);
  await action('Move page to recycle bin','delete');await expect(lifecycle).toHaveAttribute('data-page-state','deleted');w=await workspace(context.request);expect(w.state.pages.some(row=>row.id===pageId)).toBe(false);
  // A fresh page load must locate the retained identity instead of inventing
  // a blank source or selecting the first unrelated page from the workspace.
  await page.reload();await expect(lifecycle).toHaveAttribute('data-page-state','deleted');await expect(title).toHaveValue(savedTitle);await expect(title).toBeDisabled();
  await lifecycle.getByRole('button',{name:'Page archive and recycle bin',exact:true}).click();let dialog=page.getByRole('dialog');const bin=dialog.locator('[data-page-recycle-bin]');await bin.getByRole('combobox',{name:'Status',exact:true}).selectOption('deleted');const retained=bin.locator(`[data-retained-page-id="${pageId}"]`);await expect(retained).toContainText(savedTitle);await retained.getByRole('button',{name:'Open retained page',exact:true}).click();await expect(dialog).toHaveCount(0);
  const history=editor.locator('[data-revision-history]');await history.locator('summary').click();await expect(history.locator(`[data-revision-id="${original.id}"]`)).toBeVisible();await expect(history.getByRole('button',{name:'Restore',exact:true})).toHaveCount(0);
  await action('Restore page as draft','restore');await expect(lifecycle).toHaveAttribute('data-page-state','active');await expect(collaboration).toHaveAttribute('data-lease-state','held');await expect(title).toBeEnabled();await expect(title).toHaveValue(savedTitle);
  w=await workspace(context.request);const restored=w.state.pages.find(row=>row.id===pageId)!;expect(restored.status).toBe('draft');expect(restored.approvedById).toBeUndefined();expect(restored.approvedBy).toBeUndefined();expect(restored.scheduledAt).toBeUndefined();expect(restored.blocks).toEqual(sources[0].blocks);
  const detail=await context.request.get(`/api/v1/workspace/pages/${pageId}`);expect(detail.status()).toBe(200);const managed=(await detail.json() as {item:ManagedWorkspacePage}).item;expect(managed.publication.liveLocales).toEqual([]);expect(managed.publication.scheduledLocales).toEqual([]);
  const revisions=(await(await context.request.get(`/api/v1/workspace/pages/${pageId}/revisions?locale=en`)).json() as {revisions:EditorRevision[]}).revisions;expect(revisions[0].id).not.toBe(original.id);expect(revisions[0].checksum).toBe(original.checksum);expect(revisions[0].approved_by).toBeNull();expect(revisions.some(row=>row.id===original.id&&row.approved_by===authors[1].id)).toBe(true);
  expect((await anonymous.request.get(`/en/${slug}/`)).status()).toBe(404);expect((await anonymous.request.get(`/fa/${slug}/`)).status()).toBe(200);expect((await anonymous.request.get(capability.url)).status()).toBe(404);
  expect((await mutate(context.request,'/workspace/publish',{publication:{id:pageId,kind:'page',locale:'en'},expectedVersion:w.version})).status()).toBe(409);
  await expect(editor.locator('.ws-builder-footer').getByRole('button',{name:/^Publish/})).toHaveCount(0);await expect(editor.getByRole('button',{name:'Submit for review',exact:true})).toBeEnabled();expect(errors).toEqual([]);
 }finally{await reviewer.close();await anonymous.close();}
});
