import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,recordFixture,permissions} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {getWorkspace} from '../src/server/workspace.ts';
import {searchPublicContent} from '../src/server/public-discovery.ts';
import {publicResourceDiscovery} from '../src/server/resources.ts';

test('Unified discovery reads only current released content from real PostgreSQL',{timeout:120000},async t=>withCrmRecoveryDatabase('unified_discovery',async()=>{
 const admin=fixtureActor('discovery-admin','superAdmin');await insertActor(admin,{scope:'all',grants:permissions});await getWorkspace(admin);
 async function release({id='search-'+randomUUID(),locale='fa',title='کیفیت محصول ۱۲۳',category='آموزش',state='published'}={}){
  const source=await recordFixture(admin,{id,collection:'news',status:state,title:'DRAFT_ONLY_METADATA_TOKEN'}),revision=randomUUID(),slug=id;
  const publication={id,kind:'news',slug,locale,title,summary:'متن عمومی بازبینی‌شده',body:'PUBLIC_SEARCH_BODY_TOKEN',blocks:[],version:1,publishedAt:new Date().toISOString(),taxonomy:{category,tags:['کیفیت']}};
  await query("INSERT INTO content_revisions(id,document_bucket,document_id,locale,revision_number,snapshot,checksum,created_by) VALUES($1,'records',$2,$3,1,$4::jsonb,$5,$6)",[revision,id,locale,JSON.stringify(source),createHash('sha256').update(JSON.stringify(source)).digest('hex'),admin.id]);
  await query("INSERT INTO locale_releases(document_bucket,document_id,locale,kind,slug,active_revision_id,publication,published_by) VALUES('records',$1,$2,'news',$3,$4,$5::jsonb,$6)",[id,locale,slug,revision,JSON.stringify(publication),admin.id]);
  return{id,slug,locale};
 }
 const published=await release();
 await t.test('Arabic character and numeral input matches reviewed Persian title and taxonomy',async()=>{
  const found=await searchPublicContent({locale:'fa',q:'كيفيت 123',kind:'news',category:'آموزش'});
  assert.equal(found.total,1);assert.equal(found.items[0].id,published.id);assert.equal(found.items[0].href,`/fa/news/${published.slug}/`);
 });
 await t.test('Private CRM and unpublished draft fields do not participate in match, facets or snippets',async()=>{
  await recordFixture(admin,{id:'private-record',collection:'leads',title:'PRIVATE_CUSTOMER_TOKEN'});
  await recordFixture(admin,{id:'draft-news',collection:'news',status:'draft',title:'UNRELEASED_NEWS_TOKEN'});
  for(const q of ['PRIVATE_CUSTOMER_TOKEN','UNRELEASED_NEWS_TOKEN','DRAFT_ONLY_METADATA_TOKEN'])assert.equal((await searchPublicContent({locale:'fa',q})).total,0);
 });
 await t.test('An unpublished translation never receives a synthesized locale result',async()=>{
  const found=await searchPublicContent({locale:'en',q:'PUBLIC_SEARCH_BODY_TOKEN'});assert.equal(found.total,0);
 });
 await t.test('Withdrawal is immediately reflected without stale search cache',async()=>{
  await query("UPDATE locale_releases SET unpublished_at=now() WHERE document_id=$1",[published.id]);
  assert.equal((await searchPublicContent({locale:'fa',q:'PUBLIC_SEARCH_BODY_TOKEN'})).total,0);
 });
 await t.test('Archived or soft-deleted source rows cannot expose a retained release',async()=>{
  const archived=await release({state:'archived',title:'ARCHIVED_RELEASE_TOKEN'}),deleted=await release({title:'DELETED_RELEASE_TOKEN'});
  await query("UPDATE workspace_entities SET deleted_at=now() WHERE bucket='records' AND id=$1",[deleted.id]);
  for(const q of ['ARCHIVED_RELEASE_TOKEN','DELETED_RELEASE_TOKEN'])assert.equal((await searchPublicContent({locale:'fa',q})).total,0);
  assert.ok(archived.id);
 });
 await t.test('Validation bounds expensive queries and unknown private kind selectors',async()=>{
  for(const input of [{locale:'unknown'},{q:'x'.repeat(161)},{kind:'leads'},{limit:1000},{offset:-1},{rawSql:'select * from users'}])await assert.rejects(searchPublicContent(input),error=>error.status===422);
 });
 await t.test('Pagination count and category facets agree without duplicate links',async()=>{
  const first=await searchPublicContent({locale:'fa',q:'',limit:5}),second=await searchPublicContent({locale:'fa',q:'',limit:5,offset:5});
  assert.equal(first.total,second.total);assert.equal(first.items.length,5);assert.ok(first.hasMore);assert.equal(first.items.some(a=>second.items.some(b=>a.href===b.href)),false);
  assert.equal(JSON.stringify(first).includes(admin.email),false);
 });
 await t.test('A clean managed resource catalogue contains no unpublished documents',async()=>{
  assert.deepEqual(await publicResourceDiscovery(),[]);
 });
}));
