import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,fixtureHttpSession,recordFixture} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';
import {handleRequest} from '../src/server/router.ts';
import {getWorkspace} from '../src/server/workspace.ts';
import {listProductRegistry,createProductRegistry,updateProductRegistry,changeProductRegistryState,lookupProductRegistry} from '../src/server/product-registry.ts';
import {normalizeRegistryCode} from '../src/lib/product-registry.ts';
import {products} from '../src/data/catalog.ts';
import {createCustomProduct} from '../src/lib/custom-products.ts';

const failure=(status,code)=>error=>error instanceof HttpError&&error.status===status&&(!code||error.code===code);
const admin=fixtureActor('registry-administrator','superAdmin'),editor=fixtureActor('registry-editor','contentEditor'),customer=fixtureActor('registry-customer','customer');
const value=(code='TEST-SERIAL-0001')=>({code,kind:'serial',productId:products[0].id,batchCode:'TEST-BATCH-0001',status:'registered',internalNote:'Private isolated provenance note, never public.'});
const lookup=(code,locale='fa')=>lookupProductRegistry(new Request('http://localhost:3000/api/v1/public/product-registry'),{code,locale});
async function publicHttp(code,locale='fa'){const url=new URL('http://localhost:3000/api/v1/public/product-registry');url.searchParams.set('code',code);url.searchParams.set('locale',locale);return handleRequest(new Request(url),['public','product-registry']);}

test('Product code registry: no invented seed records, current admin CRUD, exact public lookup and retained archive',{timeout:180000},async t=>withCrmRecoveryDatabase('product_registry',async()=>{
 for(const actor of[admin,editor,customer])await insertActor(actor);await getWorkspace(admin);const http=await fixtureHttpSession(admin);let entry;
 await t.test('Installation leaves the registry empty and public misses disclose no fabricated match',async()=>{
  assert.equal((await query('SELECT count(*)::int AS n FROM product_registry')).rows[0].n,0);assert.deepEqual(await lookup('unregistered-0001'),{matched:false,code:'UNREGISTERED-0001',locale:'fa',state:'not_registered'});
  const list=await listProductRegistry(admin);assert.equal(list.items.length,0);assert.ok(list.products.length>=17);assert.ok(list.products.every(product=>typeof product.names.fa==='string'));
 });
 await t.test('Every management path requires current active administrative role and MFA',async()=>{
  for(const actor of[editor,customer,{...admin,mfaVerified:false}]){await assert.rejects(listProductRegistry(actor),failure(403));await assert.rejects(createProductRegistry(actor,value()),failure(403));}
  const anonymous=await handleRequest(new Request('http://localhost:3000/api/v1/admin/product-registry'),['admin','product-registry']);assert.equal(anonymous.status,401);
  await query("UPDATE users SET role='contentEditor' WHERE id=$1",[admin.id]);try{await assert.rejects(createProductRegistry(admin,value()),failure(403));}finally{await query("UPDATE users SET role='superAdmin' WHERE id=$1",[admin.id]);}
  const noCsrf=await http.request('/admin/product-registry',{method:'POST',body:value(),headers:{'x-csrf-token':'invalid'}});assert.equal(noCsrf.status,403);
 });
 await t.test('Creation, pagination and concurrent duplicate detection use one retained exact identity',async()=>{
  const response=await http.request('/admin/product-registry',{method:'POST',body:value('  test-serial-0001  ')});assert.equal(response.status,201);entry=await response.json();assert.equal(entry.code,'TEST-SERIAL-0001');assert.equal(entry.version,1);
  const results=await Promise.allSettled([createProductRegistry(admin,value('TEST-DUPLICATE-0001')),createProductRegistry(admin,value('test-duplicate-0001'))]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected'&&failure(409,'REGISTRY_CODE_EXISTS')(result.reason)).length,1);
  const first=await listProductRegistry(admin,{limit:1});assert.equal(first.items.length,1);assert.ok(first.nextCursor);const next=await listProductRegistry(admin,{limit:1,cursor:first.nextCursor});assert.equal(next.items.length,1);assert.notEqual(first.items[0].id,next.items[0].id);
  await assert.rejects(listProductRegistry(admin,{limit:101}),failure(422));
 });
 await t.test('Public lookup returns only a safe exact match, assigned locale label and explicit registry status',async()=>{
  for(const locale of['fa','en','tr','ar','ru']){const result=await lookup('test-serial-0001',locale);assert.equal(result.matched,true);assert.equal(result.product.name,products[0].name[locale]);assert.equal(result.status,'registered');assert.deepEqual(Object.keys(result).sort(),['matched','code','locale','state','kind','status','product','batchCode'].sort());assert.equal(JSON.stringify(result).includes(entry.internalNote),false);assert.equal(JSON.stringify(result).includes(admin.id),false);}
  assert.equal((await lookup('TEST-SERIAL-000')).matched,false);assert.equal((await lookup('TEST-SERIAL-0001-EXTRA')).matched,false);
  const response=await publicHttp('TEST-SERIAL-0001');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('x-robots-tag'),/noindex/);
 });
 await t.test('CAS edits immediately expose recall or withdrawal, never accept a code identity replacement',async()=>{
  const revised={...value(),status:'recalled',internalNote:'Private recall review only'};entry=await updateProductRegistry(admin,entry.id,{expectedVersion:entry.version,value:revised});assert.equal(entry.version,2);assert.equal((await lookup(entry.code)).status,'recalled');
  await assert.rejects(updateProductRegistry(admin,entry.id,{expectedVersion:1,value:revised}),failure(409,'REGISTRY_CONFLICT'));
  await assert.rejects(updateProductRegistry(admin,entry.id,{expectedVersion:entry.version,value:{...revised,code:'OTHER-CODE'}}),failure(422,'REGISTRY_IDENTITY'));
  await assert.rejects(updateProductRegistry(editor,entry.id,{expectedVersion:entry.version,value:revised}),failure(403));
  const response=await http.request('/admin/product-registry/'+entry.id,{method:'PATCH',body:{expectedVersion:entry.version,value:{...revised,status:'withdrawn'}}});assert.equal(response.status,200);entry=await response.json();assert.equal((await lookup(entry.code)).status,'withdrawn');
 });
 await t.test('Archive hides verification but retains identity, audit and explicit restoration',async()=>{
  await assert.rejects(changeProductRegistryState(editor,entry.id,{expectedVersion:entry.version,operation:'archive'}),failure(403));
  const response=await http.request('/admin/product-registry/'+entry.id+'/lifecycle',{method:'POST',body:{expectedVersion:entry.version,operation:'archive'}});assert.equal(response.status,200);entry=await response.json();assert.ok(entry.archivedAt);assert.equal((await lookup(entry.code)).matched,false);
  assert.equal((await listProductRegistry(admin)).items.some(row=>row.id===entry.id),false);assert.equal((await listProductRegistry(admin,{includeArchived:'true'})).items.some(row=>row.id===entry.id),true);
  await assert.rejects(createProductRegistry(admin,value(entry.code)),failure(409,'REGISTRY_CODE_EXISTS'));await assert.rejects(updateProductRegistry(admin,entry.id,{expectedVersion:entry.version,value:value(entry.code)}),failure(409,'REGISTRY_ARCHIVED'));
  entry=await changeProductRegistryState(admin,entry.id,{expectedVersion:entry.version,operation:'restore'});assert.equal(entry.archivedAt,null);assert.equal((await lookup(entry.code)).status,'withdrawn');
  assert.equal((await query('SELECT 1 FROM product_registry WHERE id=$1',[entry.id])).rowCount,1);const audit=(await query("SELECT action,details FROM audit_events WHERE entity_type='product_registry' AND entity_id=$1",[entry.id])).rows;assert.ok(audit.some(row=>row.action==='product_registry.archive'));assert.ok(audit.some(row=>row.action==='product_registry.restore'));assert.equal(JSON.stringify(audit).includes('Private recall review only'),false);
 });
 await t.test('Malformed codes, wildcard probes, hidden product drafts and overposted fields are rejected',async()=>{
  for(const code of['ABC','A'.repeat(81),'TEST%','TEST*','TEST\u200b-001','<script>','تست-۱۲۳۴']){assert.equal(normalizeRegistryCode(code),null);await assert.rejects(lookup(code),failure(422));}
  for(const invalid of [{...value('BAD-0001'),productId:'unknown-product'},{...value('BAD-0002'),kind:'batch'},{...value('BAD-0003'),ownerId:customer.id},{...value('BAD-0004'),internalNote:'x'.repeat(2001)}])await assert.rejects(createProductRegistry(admin,invalid),failure(422));
  const custom=createCustomProduct({id:'custom-hidden-'+randomUUID(),slug:'hidden-registry-test',brand:'Isolated fixture',family:'teeth',title:'Unpublished private product',locale:'fa'});await recordFixture(admin,{id:custom.id,collection:'products',product:custom.id,status:'draft',details:{customProduct:custom}});
  await assert.rejects(createProductRegistry(admin,{...value('HIDDEN-0001'),productId:custom.id}),failure(422,'REGISTRY_PRODUCT'));
  await assert.rejects(lookup(entry.code,'de'),failure(422));
 });
 await t.test('Public lookup rate limit bounds enumeration and never disables admin record access',async()=>{
  let rateLimited=false;for(let i=0;i<31;i++){try{await lookup('RATE-LIMIT-0001');}catch(error){assert.ok(failure(429,'RATE_LIMITED')(error));rateLimited=true;break;}}assert.equal(rateLimited,true);assert.ok((await listProductRegistry(admin)).items.length>0);
 });
}));
