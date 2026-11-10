import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {rename} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {query} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';
import {lockWorkspace} from '../src/server/workspace.ts';
import {storeAsset} from '../src/server/storage.ts';
import {updateDamPolicy} from '../src/server/dam.ts';
import {createOrganization,deleteOrganization} from '../src/server/organizations.ts';
import {getResource,getResourcePage,createResource,addResourceVersion,reviewResourceVersion,publishResource,updateResource,resourceContent,createAccessGrant,revokeAccessGrant,createDataRoom,updateDataRoom} from '../src/server/resources.ts';
import {fixtureActor,insertActor,languages,localized,permissions,recordFixture,withCrmRecoveryDatabase} from './helpers/crm-recovery-environment.mjs';

const rejects=(status,code)=>error=>error instanceof HttpError&&error.status===status&&(!code||error.code===code);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const words=value=>Object.fromEntries(languages.map(locale=>[locale,`${value} ${locale}`]));
const author=fixtureActor('resource-page-author','admin'),reviewer=fixtureActor('resource-page-reviewer','admin');
const customer=fixtureActor('resource-page-customer','customer'),outsider=fixtureActor('resource-page-outsider','customer');
const unverified=fixtureActor('resource-page-unverified','customer');
const contentRequest=()=>new Request('http://localhost:3000/api/v1/resources/content?action=view');

async function document({visibility='public',approved=true,published=approved,roomId,rightsExpiresAt}={}){
  let resource=await createResource(author,{slug:'resource-page-'+randomUUID(),title:words('Reviewed page title'),summary:words('Reviewed page summary'),type:'other',visibility,...roomId?{roomId}:{}});
  // Controlled scanner-state fixture. These generated, non-personal bytes are
  // stored through the normal storage path; no external scanner is claimed.
  const asset=await storeAsset({ownerId:author.id,name:'controlled-page.pdf',bytes:Buffer.from('%PDF-1.7\nGenerated resource-page fixture.\n%%EOF'),mimeType:'application/pdf',extension:'pdf',visibility:'private',scanStatus:'clean',metadata:{}});
  resource=await addResourceVersion(author,resource.id,{assetId:asset.id,label:'Original Persian document',locale:'fa',rightsConfirmed:true,...rightsExpiresAt?{rightsExpiresAt}:{}},resource.version);
  const version=resource.versions[0];
  if(approved)resource=await reviewResourceVersion(reviewer,resource.id,version.id,{decision:'approved',note:'Independent review of controlled metadata and file.'});
  if(published)resource=await publishResource(author,resource.id,{versionId:version.id},resource.version);
  return{resource,version,asset};
}
async function grant(resourceId,userId=customer.id,extra={}){
  return createAccessGrant(author,{resourceId,userId,canView:true,canDownload:false,expiresAt:new Date(Date.now()+86400000).toISOString(),reason:'Explicit isolated document viewing permission.',...extra});
}
async function auditCount(){return Number((await query('SELECT count(*) AS n FROM audit_events')).rows[0].n);}

test('Strict resource-page resolver uses current publication, independent review, permission and usable-file metadata',{timeout:120000},async t=>{
  await withCrmRecoveryDatabase('resource_pages',async({scoped,storage})=>{
    for(const actor of[author,reviewer,customer,outsider,unverified])await insertActor(actor,{scope:'all',grants:permissions,verified:actor!==unverified});
    await t.test('Public current release exposes exactly translated page metadata, without file-language equality or download audit',async()=>{
      const saved=await document(),before=await auditCount();
      const byId=await getResourcePage(null,saved.resource.id,'en'),bySlug=await getResourcePage(null,saved.resource.slug,'en');
      assert.deepEqual(byId,bySlug);
      assert.deepEqual(byId,{slug:saved.resource.slug,title:'Reviewed page title en',summary:'Reviewed page summary en',visibility:'public',locales:languages});
      assert.deepEqual(Object.keys(byId).sort(),['locales','slug','summary','title','visibility']);
      assert.equal(saved.version.locale,'fa');
      assert.equal((await getResourcePage(null,saved.resource.slug)).title,'Reviewed page title fa');
      assert.equal(await auditCount(),before);
      await assert.rejects(getResourcePage(null,saved.resource.slug,'xx'),rejects(422));
      await assert.rejects(getResourcePage(null,'missing-resource','en'),rejects(404));
      await assert.rejects(getResourcePage(null,'x'.repeat(161),'en'),rejects(404));
    });
    await t.test('Draft and archived documents have no page, even for their administrative owner',async()=>{
      const draft=await document({published:false});
      for(const actor of[null,author])await assert.rejects(getResourcePage(actor,draft.resource.slug,'en'),rejects(404));
      const saved=await document();
      await updateResource(author,saved.resource.id,{status:'archived'},saved.resource.version);
      for(const actor of[null,author])await assert.rejects(getResourcePage(actor,saved.resource.slug,'en'),rejects(404));
    });
    await t.test('Authenticated metadata needs a current active verified account and does not appear to anonymous users',async()=>{
      const saved=await document({visibility:'authenticated'});
      await assert.rejects(getResourcePage(null,saved.resource.slug,'en'),rejects(404));
      await assert.rejects(getResourcePage(unverified,saved.resource.slug,'en'),rejects(404));
      const metadata=await getResourcePage(customer,saved.resource.slug,'en');assert.equal(metadata.visibility,'authenticated');assert.deepEqual(metadata.locales,[],'Private documents have no public alternates.');
      await query('UPDATE users SET email_verified=false WHERE id=$1',[customer.id]);
      await assert.rejects(getResourcePage(customer,saved.resource.slug,'en'),rejects(404));
      await query('UPDATE users SET email_verified=true,active=false WHERE id=$1',[customer.id]);
      await assert.rejects(getResourcePage(customer,saved.resource.slug,'en'),rejects(401,'SESSION_REQUIRED'));
      await query('UPDATE users SET active=true WHERE id=$1',[customer.id]);
    });
    await t.test('A view-only explicit grant admits restricted metadata; management roles do not bypass it and revoke is immediate',async()=>{
      const saved=await document({visibility:'restricted'});
      for(const actor of[null,author,customer,outsider])await assert.rejects(getResourcePage(actor,saved.resource.slug,'en'),rejects(404));
      const permission=await grant(saved.resource.id);
      const metadata=await getResourcePage(customer,saved.resource.slug,'en');assert.equal(metadata.visibility,'restricted');assert.deepEqual(metadata.locales,[],'Restricted documents have no public alternates.');
      await assert.rejects(resourceContent(customer,saved.resource.id,saved.version.id,new Request('http://localhost:3000/api/v1/resources/content?action=download')),rejects(404));
      await revokeAccessGrant(author,permission.id,permission.version);
      await assert.rejects(getResourcePage(customer,saved.resource.slug,'en'),rejects(404));
      await assert.rejects(getResourcePage({...outsider,role:'admin',mfaVerified:true},saved.resource.slug,'en'),rejects(404));
    });
    await t.test('Organization grants use current membership and a current published data room',async()=>{
      const organization=(await createOrganization(customer,{name:'Resource page isolated organization'})).items[0];
      let room=await createDataRoom(author,{slug:'resource-room-'+randomUUID(),title:localized('Isolated room'),status:'published'});
      const saved=await document({visibility:'restricted',roomId:room.id});
      await createAccessGrant(author,{roomId:room.id,organizationId:organization.id,canView:true,canDownload:false,expiresAt:new Date(Date.now()+86400000).toISOString(),reason:'Verified isolated organization viewing grant.'});
      const metadata=await getResourcePage(customer,saved.resource.slug,'en');assert.equal(metadata.visibility,'restricted');assert.deepEqual(metadata.locales,[],'Restricted documents have no public alternates.');
      await assert.rejects(getResourcePage(outsider,saved.resource.slug,'en'),rejects(404));
      room=await updateDataRoom(author,room.id,{status:'draft'},room.version);
      await assert.rejects(getResourcePage(customer,saved.resource.slug,'en'),rejects(404));
      await updateDataRoom(author,room.id,{status:'published'},room.version);
      assert.ok(await getResourcePage(customer,saved.resource.slug,'en'));
      await deleteOrganization(customer,organization.id,organization.version);
      await assert.rejects(getResourcePage(customer,saved.resource.slug,'en'),rejects(404));
    });
    await t.test('An expired explicit grant is rechecked against the wall clock',async()=>{
      const saved=await document({visibility:'restricted'}),expiresAt=new Date(Date.now()+1500).toISOString();
      await grant(saved.resource.id,customer.id,{expiresAt});
      assert.ok(await getResourcePage(customer,saved.resource.slug,'en'));
      await delay(Math.max(0,Date.parse(expiresAt)-Date.now())+30);
      await assert.rejects(getResourcePage(customer,saved.resource.slug,'en'),rejects(404));
    });
    await t.test('Only the current published version and latest independent approval can authorize a page',async()=>{
      const missingPublication=await document({published:false});
      // Deliberately inconsistent isolated database fixtures exercise the page
      // boundary; no business API is weakened to construct these states.
      await query("UPDATE resources SET status='published',current_version_id=$2 WHERE id=$1",[missingPublication.resource.id,missingPublication.version.id]);
      await assert.rejects(getResourcePage(null,missingPublication.resource.slug,'en'),rejects(404));
      const latestRejected=await document();
      await query("INSERT INTO resource_reviews(id,version_id,reviewer_id,decision,note,created_at) VALUES($1,$2,$3,'rejected','Isolated later review fixture',clock_timestamp()+interval '1 second')",[randomUUID(),latestRejected.version.id,reviewer.id]);
      await assert.rejects(getResourcePage(null,latestRejected.resource.slug,'en'),rejects(404));
      const selfReviewed=await document();
      await query("INSERT INTO resource_reviews(id,version_id,reviewer_id,decision,note,created_at) VALUES($1,$2,$3,'approved','Isolated invalid same-author approval',clock_timestamp()+interval '1 second')",[randomUUID(),selfReviewed.version.id,author.id]);
      await assert.rejects(getResourcePage(null,selfReviewed.resource.slug,'en'),rejects(404));
      const normalRejection=await document();
      await reviewResourceVersion(reviewer,normalRejection.resource.id,normalRejection.version.id,{decision:'rejected',note:'Publication approval withdrawn through the normal command.'});
      await assert.rejects(getResourcePage(null,normalRejection.resource.slug,'en'),rejects(404));
    });
    await t.test('Changed unreviewed metadata and altered asset digest or length cannot authorize an otherwise published page',async()=>{
      const saved=await document();
      await query("UPDATE resources SET title=jsonb_set(title,'{en}','\"Unreviewed injected title\"'::jsonb) WHERE id=$1",[saved.resource.id]);
      await assert.rejects(getResourcePage(null,saved.resource.slug,'en'),rejects(404));
      const digestChanged=await document();
      await query('UPDATE assets SET sha256=$2 WHERE id=$1',[digestChanged.asset.id,'0'.repeat(64)]);
      await assert.rejects(getResourcePage(null,digestChanged.resource.slug,'en'),rejects(500,'FILE_INTEGRITY'));
      const lengthChanged=await document();
      await query('UPDATE assets SET bytes=bytes+1 WHERE id=$1',[lengthChanged.asset.id]);
      await assert.rejects(getResourcePage(null,lengthChanged.resource.slug,'en'),rejects(500,'FILE_INTEGRITY'));
    });
    await t.test('Current quarantine and confidential retained evidence stop page resolution without changing generic metadata behavior',async()=>{
      const saved=await document();
      await query("UPDATE assets SET scan_status='pending' WHERE id=$1",[saved.asset.id]);
      await assert.rejects(getResourcePage(null,saved.resource.slug,'en'),rejects(409,'QUARANTINED'));
      assert.equal((await getResource(null,saved.resource.slug,'en')).id,saved.resource.id);
      await query("UPDATE assets SET scan_status='clean' WHERE id=$1",[saved.asset.id]);
      assert.ok(await getResourcePage(null,saved.resource.slug,'en'));
      const record=await recordFixture(author);
      await query("INSERT INTO crm_domain_asset_refs(record_bucket,record_id,asset_id) VALUES('records',$1,$2)",[record.id,saved.asset.id]);
      await assert.rejects(getResourcePage(null,saved.resource.slug,'en'),rejects(409,'ASSET_IN_USE'));
    });
    await t.test('Current DAM rights revocation and expiry remove a page without reusing a prior successful authorization',async()=>{
      const saved=await document();
      let policy=await updateDamPolicy(author,saved.asset.id,{rightsConfirmed:false,rightsExpiresAt:null,licenseNote:'Isolated document rights withdrawn.'},0);
      await assert.rejects(getResourcePage(null,saved.resource.slug,'en'),rejects(410,'RIGHTS_EXPIRED'));
      const expiresAt=new Date(Date.now()+1500).toISOString();
      policy=await updateDamPolicy(author,saved.asset.id,{rightsConfirmed:true,rightsExpiresAt:expiresAt,licenseNote:'Isolated short-lived distribution right.'},policy.policy.version);
      assert.ok(await getResourcePage(null,saved.resource.slug,'en'));
      await delay(Math.max(0,Date.parse(expiresAt)-Date.now())+30);
      await assert.rejects(getResourcePage(null,saved.resource.slug,'en'),rejects(410,'RIGHTS_EXPIRED'));
    });
    await t.test('The immutable version distribution expiry is also enforced',async()=>{
      const rightsExpiresAt=new Date(Date.now()+2000).toISOString(),saved=await document({rightsExpiresAt});
      assert.ok(await getResourcePage(null,saved.resource.slug,'en'));
      await delay(Math.max(0,Date.parse(rightsExpiresAt)-Date.now())+30);
      await assert.rejects(getResourcePage(null,saved.resource.slug,'en'),rejects(410,'RIGHTS_EXPIRED'));
    });
    await t.test('Page metadata never reads the blob or records view/download analytics',async()=>{
      const saved=await document(),path=join(storage,saved.asset.storage_key),away=path+'.fixture-moved',before=await auditCount();
      await rename(path,away);
      try{
        assert.ok(await getResourcePage(null,saved.resource.slug,'en'));
        assert.equal(await auditCount(),before);
        await assert.rejects(resourceContent(null,saved.resource.id,saved.version.id,contentRequest()),rejects(404,'FILE_MISSING'));
      }finally{await rename(away,path);}
      assert.equal(await auditCount(),before);
    });
    await t.test('Authorization waits for the workspace transaction then reloads a revoked account',async()=>{
      const saved=await document({visibility:'authenticated'}),blocker=new pg.Client({connectionString:scoped.toString()});
      await blocker.connect();
      try{
        await blocker.query('BEGIN');await lockWorkspace(blocker);
        let settled=false;
        const pending=getResourcePage(customer,saved.resource.slug,'en').then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
        await delay(60);assert.equal(settled,false);
        await blocker.query('UPDATE users SET active=false WHERE id=$1',[customer.id]);await blocker.query('COMMIT');
        const result=await pending;assert.ok(result.error instanceof HttpError);assert.equal(result.error.code,'SESSION_REQUIRED');
      }finally{await blocker.query('ROLLBACK');await blocker.end();await query('UPDATE users SET active=true WHERE id=$1',[customer.id]);}
    });
  });
});
