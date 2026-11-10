import test from 'node:test';
import assert from 'node:assert/strict';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,languages} from './helpers/crm-recovery-environment.mjs';
import {query} from '../src/server/db.ts';
import {getWorkspace,getPublicSite,saveWorkspace,installSourceGlossaryDrafts,installSourcePageDrafts,reviewWorkspaceContent,publishWorkspace} from '../src/server/workspace.ts';
import {editablePublicTargets} from '../src/lib/site-content.ts';
import {createContentPreview,acquireContentLease} from '../src/server/content-collaboration.ts';
import {randomUUID} from 'node:crypto';

const owner=fixtureActor('source-page-owner','superAdmin');
const translatedEdit={fa:'ویرایش کنترل‌شده محتوای صفحه.',en:'Reviewed editing fixture for this page.',tr:'Bu sayfa için kontrollü düzenleme örneği.',ar:'نموذج تحرير مضبوط لهذه الصفحة.',ru:'Контролируемое редактирование этой страницы.'};

test('Fresh source pages contain full local content, support every editable route and survive repeated seeding',{timeout:180000},async t=>withCrmRecoveryDatabase('source_pages',async()=>{
 await insertActor(owner);
 const initial=await getWorkspace(owner),expectedCount=editablePublicTargets.length*languages.length;
 await t.test('Every source route has five populated independent language drafts and no fabricated business records',async()=>{
  assert.equal(editablePublicTargets.length,24);assert.equal(initial.state.pages.length,120);assert.equal(initial.state.pages.length,expectedCount);
  for(const target of editablePublicTargets){
   const versions=initial.state.pages.filter(page=>page.slug===target.slug);assert.equal(versions.length,5,target.slug);
   for(const locale of languages){
    const page=versions.find(page=>page.locale===locale);assert.ok(page,`${target.slug}/${locale}`);
    assert.ok(page.title.trim(),`${target.slug}/${locale} title`);assert.ok(page.summary.trim(),`${target.slug}/${locale} summary`);
    assert.ok(page.blocks.some(block=>typeof block.body==='string'&&block.body.trim()),`${target.slug}/${locale} body`);
    assert.equal(page.authorId,'system-source-import');assert.equal(page.status,'draft');
    if(['en','tr','ru'].includes(locale))assert.doesNotMatch(page.summary,/[\u0600-\u06ff]/,`${target.slug}/${locale} summary is not a Persian fallback`);
   }
   assert.notEqual(versions.find(page=>page.locale==='en').summary,versions.find(page=>page.locale==='fa').summary,target.slug);
  }
  assert.equal(initial.state.records.filter(record=>record.collection==='products').length,17);
  assert.equal(initial.state.records.filter(record=>record.demo).length,0);
  const privateCollections=['leads','contacts','accounts','opportunities','quotes','orders','tasks','staff','complaints'];
  assert.equal(initial.state.records.filter(record=>privateCollections.includes(record.collection)).length,0);
  assert.equal((await query('SELECT count(*)::integer AS n FROM product_registry')).rows[0].n,0);
  assert.equal((await query("SELECT count(*)::integer AS n FROM content_approvals")).rows[0].n,0,'Import never fabricates independent review evidence');
 });
 await t.test('All 120 retained page designs can be edited through the actual transactional planner with distinct locale values',async()=>{
  for(const locale of languages){
   const current=await getWorkspace(owner);
   const next={...current.state,pages:current.state.pages.map(page=>page.locale===locale?{...page,summary:translatedEdit[locale]+' '+page.summary}:page)};
   const saved=await saveWorkspace(owner,{state:next,locale,expectedVersion:current.version});
   const changed=saved.state.pages.filter(page=>page.locale===locale);
   assert.equal(changed.length,24);
   for(const page of changed){
    assert.ok(page.summary.startsWith(translatedEdit[locale]),page.id);assert.equal(page.authorId,owner.id);
    const source=initial.state.pages.find(candidate=>candidate.id===page.id);
    assert.deepEqual(page.blocks,source.blocks,'Editing descriptive content preserves the retained visual blocks');
   }
  }
 });
 await t.test('Repeated source initialization preserves every authored draft, its revisions and the workspace version',async()=>{
  const before=await getWorkspace(owner);
  const revisions=(await query('SELECT count(*)::integer AS n FROM content_revisions')).rows[0].n;
  await getPublicSite();
  assert.equal((await installSourceGlossaryDrafts()).inserted,0);
  assert.deepEqual(await installSourcePageDrafts(),{inserted:0,repaired:0});
  await getPublicSite();
  const after=await getWorkspace(owner);
  assert.deepEqual(after.state.pages,before.state.pages);assert.equal(after.version,before.version);
  assert.equal((await query('SELECT count(*)::integer AS n FROM content_revisions')).rows[0].n,revisions);
  assert.equal(after.state.pages.length,expectedCount);
 });
}));

test('Explicit legacy page intake repairs only exact untouched blanks and never overwrites prior operator work',{timeout:180000},async()=>withCrmRecoveryDatabase('source_upgrade',async()=>{
 const reviewer=fixtureActor('source-upgrade-reviewer','admin');await insertActor(owner);await insertActor(reviewer);
 const initial=await getWorkspace(owner);
 const page=(slug,locale='fa')=>initial.state.pages.find(candidate=>candidate.slug===slug&&candidate.locale===locale);
 async function makeOldBlank(slug,locale='fa'){
  const current=page(slug,locale),target=editablePublicTargets.find(item=>item.slug===slug);
  const value={id:current.id,slug,locale,title:target.title[locale],summary:'',status:'draft',version:1,author:'system',authorId:'system-source-import',updatedAt:current.updatedAt,blocks:[{id:`${slug}-hero`,type:'hero',title:target.title[locale],body:''},{id:`${slug}-body`,type:'rich-text',title:'',body:''}]};
  await query("UPDATE workspace_entities SET data=$2::jsonb,created_by='system-source-import',updated_by='system-source-import',revision_number=1,updated_at=created_at WHERE bucket='pages' AND id=$1",[current.id,JSON.stringify(value)]);return value;
 }
 const repair=await makeOldBlank('faq'),customized=await makeOldBlank('glossary'),authored=await makeOldBlank('knowledge'),previewed=await makeOldBlank('for/dentist','en'),leased=await makeOldBlank('for/lab','en');
 await query("UPDATE workspace_entities SET data=jsonb_set(data,'{title}',to_jsonb($2::text)) WHERE bucket='pages' AND id=$1",[customized.id,'عنوان اصلاح‌شده توسط بهره‌بردار']);
 let current=await getWorkspace(owner);
 await saveWorkspace(owner,{state:{...current.state,pages:current.state.pages.map(item=>item.id===authored.id?{...item,summary:'متن اختصاصی بهره‌بردار در نسخه قبلی.'}:item)},locale:'fa',expectedVersion:current.version});
 await createContentPreview(owner,{bucket:'pages',id:previewed.id,locale:'en'});
 await acquireContentLease(owner,{bucket:'pages',id:leased.id,clientId:randomUUID(),expectedUpdatedAt:leased.updatedAt});
 const published=page('terms','en');
 current=await getWorkspace(owner);await saveWorkspace(owner,{state:{...current.state,pages:current.state.pages.map(item=>item.id===published.id?{...item,status:'review'}:item)},locale:'en',expectedVersion:current.version});
 current=await getWorkspace(owner);await reviewWorkspaceContent(reviewer,{bucket:'pages',id:published.id,locale:'en',expectedVersion:current.version});
 current=await getWorkspace(owner);await publishWorkspace(owner,{publication:{id:published.id,locale:'en',kind:'page'},expectedVersion:current.version});
 const deleted=page('faq','en'),archived=page('glossary','tr'),missing=page('for/research','ru'),occupied=page('faq','tr');
 await query("UPDATE workspace_entities SET deleted_at=now() WHERE bucket='pages' AND id=$1",[deleted.id]);
 await query("UPDATE workspace_entities SET status='archived',data=jsonb_set(data,'{status}',to_jsonb('archived'::text)) WHERE bucket='pages' AND id=$1",[archived.id]);
 await query("DELETE FROM workspace_entities WHERE bucket='pages' AND id=ANY($1::text[])",[[missing.id,occupied.id]]);
 const custom={...occupied,id:'operator-faq-tr',title:'Özel soru başlığı',author:owner.role,authorId:owner.id};
 await query("INSERT INTO workspace_entities(bucket,id,collection,locale,status,data,created_by,updated_by) VALUES('pages',$1,'pages','tr','draft',$2::jsonb,$3,$3)",[custom.id,JSON.stringify(custom),owner.id]);
 const retainedIds=[customized.id,authored.id,previewed.id,leased.id,published.id,deleted.id,archived.id,custom.id];
 const preserved=(await query("SELECT id,data,status,deleted_at,revision_number,updated_at FROM workspace_entities WHERE bucket='pages' AND id=ANY($1::text[]) ORDER BY id",[retainedIds])).rows;
 const releases=(await query("SELECT * FROM locale_releases WHERE document_id=$1",[published.id])).rows;
 assert.deepEqual(await installSourcePageDrafts(),{inserted:1,repaired:1});
 const changed=(await getWorkspace(owner)).state.pages.find(item=>item.id===repair.id);assert.ok(changed.summary.trim());assert.ok(changed.blocks.some(block=>block.body?.trim()));assert.equal(changed.version,2);assert.equal(changed.status,'draft');
 assert.deepEqual((await query("SELECT id,data,status,deleted_at,revision_number,updated_at FROM workspace_entities WHERE bucket='pages' AND id=ANY($1::text[]) ORDER BY id",[retainedIds])).rows,preserved);
 assert.deepEqual((await query("SELECT * FROM locale_releases WHERE document_id=$1",[published.id])).rows,releases);
 assert.equal((await query("SELECT 1 FROM workspace_entities WHERE bucket='pages' AND id=$1",[occupied.id])).rowCount,0,'A custom or deleted route identity is never silently replaced');
 assert.equal((await query("SELECT 1 FROM workspace_entities WHERE bucket='pages' AND id=$1",[missing.id])).rowCount,1);
 assert.equal((await query("SELECT 1 FROM audit_events WHERE action='workspace.pages.blank-source-repaired'")).rowCount,1);
 const version=(await getWorkspace(owner)).version;assert.deepEqual(await installSourcePageDrafts(),{inserted:0,repaired:0});assert.equal((await getWorkspace(owner)).version,version);
}));
