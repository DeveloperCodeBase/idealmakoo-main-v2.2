import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';
import type {EditorRevision} from '../../src/types/editor-workflows';
import type {WorkspaceState} from '../../src/data/workspace-seed';

// Only a disposable, migrated acceptance database is permitted. This fixture
// creates a unique staff identity; it never sends invitations or provider calls.
const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const staffId=randomUUID(),password=`E2e-form-only-${randomUUID()}-A9`,email=`e2e-form-${staffId}@example.test`;
let pool:pg.Pool;
async function mutate(api:APIRequestContext,path:string,data:unknown,method='POST'){
 const session=await api.get('/api/v1/auth/session');expect(session.status()).toBe(200);const {csrfToken}=await session.json();
 return api.fetch('/api/v1'+path,{method,data,headers:{Origin:baseURL,'X-CSRF-Token':csrfToken,'Idempotency-Key':randomUUID()}});
}
const responseFor=(page:Page,path:string,method:string)=>page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')===`/api/v1${path}`&&response.request().method()===method);

test.beforeAll(async()=>{
 const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;if(!database)throw new Error('Editor browser acceptance needs a migrated disposable database.');
 pool=new pg.Pool({connectionString:database,max:2});
 await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,'admin',true,$5::jsonb,'all',$6::jsonb)",[staffId,email,'E2E form editor',await passwordHash(password),JSON.stringify(['fa','en','tr','ar','ru']),JSON.stringify({contact:true,financial:true,baseCost:true,assign:true,intake:true})]);
 await pool.query('INSERT INTO user_settings(user_id) VALUES($1)',[staffId]);
});
test.afterAll(async()=>{if(pool){await pool.query('UPDATE users SET active=false WHERE id=$1',[staffId]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[staffId]);await pool.end();}});

test('form editing uses an actual lease, selected revision comparison and reversible lifecycle',async({page,context,browser})=>{
 test.setTimeout(180000);
 expect((await mutate(context.request,'/auth/login',{email,password})).status()).toBe(200);
 const enrollment=await mutate(context.request,'/auth/mfa/enroll',{password});expect(enrollment.status()).toBe(200);const {secret}=await enrollment.json();
 expect((await mutate(context.request,'/auth/mfa/confirm',{code:totp(secret,Math.floor(Date.now()/30000))})).status()).toBe(200);
 await page.goto('/en/admin/forms/');const directory=page.locator('[data-production-form-builder]');await expect(directory).toBeVisible();await expect(directory.getByRole('button',{name:'Create new',exact:true})).toBeEnabled();
 const creation=responseFor(page,'/workspace/forms','POST');await directory.getByRole('button',{name:'Create new',exact:true}).click();const created=await creation;expect(created.status()).toBe(201);const id=created.request().postDataJSON().id as string;
 const editor=page.locator(`[data-form-editor][data-form-id="${id}"]`),lease=editor.locator('[data-editor-collaboration]');await expect(editor).toBeVisible();await expect(lease).toHaveAttribute('data-lease-state','held');
 const name=`Browser form ${staffId.slice(0,8)}`;await editor.getByRole('textbox',{name:'Title',exact:true}).fill(name);
 let saved=responseFor(page,`/workspace/forms/${id}`,'PUT');await editor.getByRole('button',{name:'Save changes',exact:true}).click();expect((await saved).status()).toBe(200);await expect(editor).toHaveAttribute('data-form-dirty','false');await expect(editor).toHaveAttribute('data-source-version','2');
 const peer=await browser.newContext({baseURL,storageState:await context.storageState(),serviceWorkers:'block',reducedMotion:'reduce'});
 try{
  const peerPage=await peer.newPage();await peerPage.goto('/en/admin/forms/');await peerPage.getByRole('combobox',{name:'Form builder',exact:true}).selectOption(id);const peerEditor=peerPage.locator(`[data-form-editor][data-form-id="${id}"]`);await expect(peerEditor.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','locked');await expect(peerEditor.getByRole('textbox',{name:'Title',exact:true})).toBeDisabled();
  const workspace=await (await peer.request.get('/api/v1/workspace')).json() as {state:WorkspaceState;version:number};const form=workspace.state.forms.find(item=>item.id===id)!;
  const denied=await mutate(peer.request,`/workspace/forms/${id}`,{value:{title:{...form.title,en:'A forbidden parallel edit'},fields:form.fields},expectedFormVersion:form.version,expectedVersion:workspace.version},'PUT');expect(denied.status()).toBe(423);expect((await denied.json()).code).toBe('CONTENT_LOCKED');
 }finally{await peer.close();}
 await editor.getByRole('textbox',{name:'Form field name',exact:true}).fill('Participant name');saved=responseFor(page,`/workspace/forms/${id}`,'PUT');await editor.getByRole('button',{name:'Save changes',exact:true}).click();expect((await saved).status()).toBe(200);await expect(editor).toHaveAttribute('data-source-version','3');
 const history=editor.locator('[data-revision-history]');await history.locator('summary').click();const result=await (await context.request.get(`/api/v1/workspace/forms/${id}/revisions?locale=en`)).json() as {revisions:EditorRevision[]};const oldest=result.revisions.at(-1)!,latest=result.revisions[0];expect(result.revisions).toHaveLength(3);
 await history.getByRole('combobox',{name:'Before revision',exact:true}).selectOption(oldest.id);await history.getByRole('combobox',{name:'After revision',exact:true}).selectOption(latest.id);const diff=history.locator('[data-revision-diff]');await expect(diff).toContainText('Participant name');await expect(diff).toContainText(name);await expect(diff.locator('del').first()).toBeVisible();await expect(diff.locator('ins').first()).toBeVisible();
 await history.locator(`[data-revision-id="${oldest.id}"]`).getByRole('button',{name:'Restore',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByRole('checkbox',{name:'I have reviewed the selected action and version.',exact:true}).check();let restored=responseFor(page,`/workspace/forms/${id}/restore`,'POST');await dialog.getByRole('button',{name:'Restore',exact:true}).click();expect((await restored).status()).toBe(200);await expect(dialog).toHaveCount(0);await expect(editor.getByRole('textbox',{name:'Form field name',exact:true})).toHaveValue('Name');await expect(editor).toHaveAttribute('data-source-version','4');
 async function lifecycle(action:'Archive form'|'Move to recycle bin'|'Restore form'){
  await expect(editor.getByRole('button',{name:action,exact:true})).toBeEnabled();await editor.getByRole('button',{name:action,exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Reason (at least 8 characters)',exact:true}).fill('Reviewed reversible browser acceptance action');await dialog.getByRole('checkbox',{name:'I have reviewed the selected action and version.',exact:true}).check();const response=responseFor(page,`/workspace/forms/${id}/lifecycle`,'POST');await dialog.getByRole('button',{name:action,exact:true}).click();expect((await response).status()).toBe(200);await expect(dialog).toHaveCount(0);
 }
 await lifecycle('Archive form');await expect(editor.getByRole('textbox',{name:'Title',exact:true})).toBeDisabled();await lifecycle('Move to recycle bin');let current=await (await context.request.get('/api/v1/workspace')).json() as {state:WorkspaceState};expect(current.state.forms.some(form=>form.id===id)).toBe(false);
 await lifecycle('Restore form');await expect(editor.locator('[data-editor-collaboration]')).toHaveAttribute('data-lease-state','held');await expect(editor.getByRole('textbox',{name:'Title',exact:true})).toBeEnabled();current=await (await context.request.get('/api/v1/workspace')).json();expect(current.state.forms.find(form=>form.id===id)?.status).toBe('active');
 const site=await(await context.request.get('/api/v1/site')).json();expect(site.forms.some((form:{id:string})=>form.id===id),'Restoring an authoring form does not publish it').toBe(false);
 await page.getByRole('button',{name:'Page guidance',exact:true}).click();await expect(page.locator('[data-contextual-help="forms"]')).toContainText('reversible');await expect(page.getByRole('dialog')).not.toContainText('prototype');
});
