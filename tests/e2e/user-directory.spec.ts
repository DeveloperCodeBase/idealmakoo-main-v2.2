import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {passwordHash,totp} from '../../src/server/crypto';

const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
const runId=randomUUID(),marker='Directory '+runId,password='Directory-e2e-'+randomUUID()+'-A9';
const actor={id:randomUUID(),email:`e2e-directory-admin-${runId}@example.test`,name:marker+' administrator'};
const olderStaff={id:randomUUID(),email:`e2e-directory-staff-${runId}@example.test`,name:marker+' older staff'};
const olderCustomer={id:randomUUID(),email:`e2e-directory-customer-${runId}@example.test`,name:marker+' older customer'};
const peers=Array.from({length:51},(_,index)=>({id:randomUUID(),email:`e2e-directory-peer-${index}-${runId}@example.test`,name:marker+' administrator '+index}));
const customers=Array.from({length:1005},(_,index)=>({id:randomUUID(),email:`e2e-directory-new-${index}-${runId}@example.test`,name:marker+' customer '+index}));
const fixtureIds=[actor,olderStaff,olderCustomer,...peers,...customers].map(row=>row.id);
let pool:pg.Pool;

async function mutate(api:APIRequestContext,path:string,data:unknown){
 const session=await api.get('/api/v1/auth/session');expect(session.status()).toBe(200);const {csrfToken}=await session.json();
 return api.post('/api/v1'+path,{data,headers:{Origin:baseURL,'X-CSRF-Token':csrfToken,'Idempotency-Key':randomUUID()}});
}
async function login(api:APIRequestContext){
 expect((await mutate(api,'/auth/login',{email:actor.email,password})).status()).toBe(200);
 const enrolled=await mutate(api,'/auth/mfa/enroll',{password});expect(enrolled.status()).toBe(200);const {secret}=await enrolled.json();
 expect((await mutate(api,'/auth/mfa/confirm',{code:totp(secret,Math.floor(Date.now()/30000))})).status()).toBe(200);
}
function directoryResponse(page:Page,kind:'all'|'staff',query:string,options:{cursor?:boolean;role?:string}={}){
 return page.waitForResponse(response=>{
  const url=new URL(response.url());return response.request().method()==='GET'&&url.pathname.replace(/\/$/,'')==='/api/v1/users'&&url.searchParams.get('kind')===kind&&(url.searchParams.get('q')||'')===query&&url.searchParams.has('cursor')===!!options.cursor&&(!options.role||url.searchParams.get('role')===options.role);
 });
}
function commandResponse(page:Page,path:string,method:string){return page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')==='/api/v1'+path&&response.request().method()===method);}

test.beforeAll(async()=>{
 const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;if(!database)throw new Error('User directory acceptance requires a migrated disposable database.');
 pool=new pg.Pool({connectionString:database,max:2});const hashed=await passwordHash(password),now=Date.now();
 // Fixtures establish only identity, chronology and permission boundaries.
 // Searching, editing, pagination, selection and offboarding use the live UI.
 const rows=[
  {...olderStaff,role:'support',created_at:'2000-01-01T00:00:00.000Z'},
  {...olderCustomer,role:'customer',created_at:'2000-01-02T00:00:00.000Z'},
  {...actor,role:'admin',created_at:new Date(now).toISOString()},
  ...peers.map((row,index)=>({...row,role:'admin',created_at:new Date(now+index+1).toISOString()})),
  ...customers.map((row,index)=>({...row,role:'customer',created_at:new Date(now+1000+index).toISOString()}))
 ];
 await pool.query(`INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales,crm_scope,crm_permissions,created_at)
  SELECT fixture.id,fixture.email,fixture.name,$2,fixture.role,true,$3::jsonb,'all',$4::jsonb,fixture.created_at
  FROM jsonb_to_recordset($1::jsonb) AS fixture(id text,email text,name text,role text,created_at timestamptz)`,[JSON.stringify(rows),hashed,JSON.stringify(['fa','en','tr','ar','ru']),JSON.stringify({contact:true,financial:true,baseCost:true,assign:true,intake:true})]);
 await pool.query('INSERT INTO user_settings(user_id) SELECT unnest($1::text[])',[fixtureIds]);
});
test.afterAll(async()=>{if(pool){try{await pool.query('UPDATE users SET active=false WHERE id=ANY($1::text[])',[fixtureIds]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=ANY($1::text[])',[fixtureIds]);}finally{await pool.end();}}});

test('the people panel edits older accounts beyond 1000 customers and retains a paginated handover target across searches',async({page,context})=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await login(context.request);
 await page.goto('/en/admin/staff/');const directory=page.locator('[data-user-directory]'),handover=page.locator('[data-staff-handover]');
 await expect(directory).toBeVisible();await expect(directory.locator('table.ws-table')).toBeVisible();await expect(handover).toBeVisible();

 for(const target of [olderStaff,olderCustomer]){
  const search=directoryResponse(page,'all',target.email);await directory.getByRole('searchbox').fill(target.email);expect((await search).status()).toBe(200);
  const row=directory.locator(`[data-user-id="${target.id}"]`);await expect(row).toBeVisible();await expect(row).toContainText(target.email);await row.getByRole('button',{name:'Edit',exact:true}).click();
  const dialog=page.getByRole('dialog'),updated=target.name+' reviewed',name=dialog.getByRole('textbox',{name:'Name',exact:true});await name.fill(updated);await expect(name).toHaveValue(updated);
  const saved=commandResponse(page,`/users/${target.id}`,'PATCH');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();expect((await saved).status()).toBe(200);await expect(dialog).toHaveCount(0);await expect(row).toContainText(updated);
 }

 const roleChanged=directoryResponse(page,'all',olderCustomer.email,{role:'customer'});await directory.getByRole('combobox',{name:'Role',exact:true}).selectOption('customer');expect((await roleChanged).status()).toBe(200);
 const firstPage=directoryResponse(page,'all',marker,{role:'customer'});await directory.getByRole('searchbox').fill(marker);const first=await firstPage;expect(first.status()).toBe(200);const firstData=await first.json();expect(firstData.items).toHaveLength(50);expect(firstData.items.every((row:{role:string})=>row.role==='customer')).toBe(true);expect(firstData.nextCursor).toBeTruthy();await expect(directory.locator('tbody tr')).toHaveCount(50);
 const more=directoryResponse(page,'all',marker,{role:'customer',cursor:true});await directory.getByRole('button',{name:'Load more users',exact:true}).click();expect((await more).status()).toBe(200);await expect(directory.locator('tbody tr')).toHaveCount(100);
 const ids=await directory.locator('[data-user-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-user-id')));expect(new Set(ids).size).toBe(100);
 const refreshed=directoryResponse(page,'all',marker,{role:'customer'});await directory.getByRole('button',{name:'Refresh status',exact:true}).click();expect((await refreshed).status()).toBe(200);await expect(directory.locator('tbody tr')).toHaveCount(50);

 const staffPage=directoryResponse(page,'staff',marker);await handover.getByRole('searchbox',{name:'Search staff by name or email',exact:true}).fill(marker);const staffResponse=await staffPage;expect(staffResponse.status()).toBe(200);expect(new URL(staffResponse.url()).searchParams.get('active')).toBe('true');const firstStaff=await staffResponse.json();expect(firstStaff.items).toHaveLength(50);expect(firstStaff.items.every((row:{role:string})=>row.role==='admin')).toBe(true);
 const targetSelect=handover.getByRole('combobox',{name:'Name',exact:true});await expect(targetSelect.locator('option:not([value=""])')).toHaveCount(0);await expect(handover.getByRole('button',{name:'Load more staff',exact:true})).toBeEnabled();
 const moreStaff=directoryResponse(page,'staff',marker,{cursor:true});await handover.getByRole('button',{name:'Load more staff',exact:true}).click();expect((await moreStaff).status()).toBe(200);await expect(targetSelect.locator(`option[value="${olderStaff.id}"]`)).toHaveCount(1);await targetSelect.selectOption(olderStaff.id);
 const absentQuery='No matching staff '+runId,absent=directoryResponse(page,'staff',absentQuery);await handover.getByRole('searchbox',{name:'Search staff by name or email',exact:true}).fill(absentQuery);expect((await absent).status()).toBe(200);await expect(targetSelect).toHaveValue(olderStaff.id);await expect(handover.locator(`[data-pinned-staff-id="${olderStaff.id}"]`)).toBeVisible();await expect(handover.locator(`[data-pinned-staff-id="${olderStaff.id}"]`)).toContainText(olderStaff.name+' reviewed');

 const preview=commandResponse(page,`/staff/${olderStaff.id}/handover`,'GET');await handover.getByRole('button',{name:'Review current responsibilities',exact:true}).click();const reviewed=await preview;expect(reviewed.status()).toBe(200);expect((await reviewed.json()).user.id).toBe(olderStaff.id);await expect(handover.getByRole('heading',{name:'Selected plan: '+olderStaff.name+' reviewed',exact:true})).toBeVisible();
 await handover.getByRole('textbox',{name:'Handover and offboarding reason',exact:true}).fill('Verified browser fixture handover of the explicitly selected older staff member.');
 const offboard=commandResponse(page,`/staff/${olderStaff.id}/offboard`,'POST');await handover.getByRole('button',{name:'Transfer responsibilities and deactivate staff',exact:true}).click();expect((await offboard).status()).toBe(200);await expect(targetSelect).toHaveValue('');await expect(handover.locator('[data-pinned-staff-id]')).toHaveCount(0);
 expect((await pool.query('SELECT active FROM users WHERE id=$1',[olderStaff.id])).rows[0].active).toBe(false);expect((await pool.query('SELECT active FROM users WHERE id=$1',[actor.id])).rows[0].active).toBe(true);expect(errors).toEqual([]);
});
