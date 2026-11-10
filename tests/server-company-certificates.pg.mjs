import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import pg from 'pg';
import {query,transaction,closeDb} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';
import {storeAsset} from '../src/server/storage.ts';
import {createResource,addResourceVersion,reviewResourceVersion,publishResource,updateResource} from '../src/server/resources.ts';
import {createCompanyCertificate,updateCompanyCertificate,reviewCompanyCertificate,publishCompanyCertificate,withdrawCompanyCertificate,revokeCompanyCertificate,setCompanyCertificateState,listPublicCompanyCertificates,listManagedCompanyCertificates,listCompanyCertificateSources,companyCertificateStatus,runCompanyCertificateAlerts,canDeliverCompanyCertificateAlert} from '../src/server/company-certificates.ts';
import {getNotificationPreferences,patchNotificationPreferences} from '../src/server/notification-policy.ts';
import {deliverOutbox} from '../src/server/notifications.ts';
import {decrypt} from '../src/server/crypto.ts';

const database=process.env.TEST_ADMIN_DATABASE_URL||process.env.MIGRATION_DATABASE_URL||process.env.TEST_DATABASE_URL;
const languages=['fa','en','tr','ar','ru'];
const localized=text=>Object.fromEntries(languages.map(locale=>[locale,text]));
const actor=id=>({id,name:id,email:id+'@example.invalid',role:'admin',qualityScope:true,allowedLocales:languages,mfaVerified:true});
const author=actor('certificate-author'),reviewer=actor('certificate-reviewer'),limited=actor('certificate-limited');
const error=(status,code)=>value=>value instanceof HttpError&&value.status===status&&(!code||value.code===code);
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
const blank={title:'',summary:'',issuer:'',certificateNumber:'',standard:'',validFrom:'',validUntil:'',issuerUrl:'',resourceId:null,resourceVersionId:null};
let source;
const facts=patch=>({title:'Isolated test certificate',summary:'Supplied test fixture facts; not a real company credential.',issuer:'Test-only issuer',certificateNumber:'FIXTURE-001',standard:'Fixture standard',validFrom:day(-30),validUntil:day(90),issuerUrl:'https://example.invalid/certificates',resourceId:source.resourceId,resourceVersionId:source.versionId,...patch});
const make=(slug,definition=facts(),locale='en')=>createCompanyCertificate(author,{slug,locale,definition});
const approve=row=>reviewCompanyCertificate(reviewer,row.id,{locale:row.locale,expectedVersion:row.version,decision:'approved'});
const publish=row=>publishCompanyCertificate(author,row.id,{locale:row.locale,expectedVersion:row.version});
const current=(id,locale='en',by=author)=>listManagedCompanyCertificates(by,locale).then(result=>result.items.find(row=>row.id===id));
const publicRow=(id,locale='en')=>listPublicCompanyCertificates(locale).then(result=>result.items.find(row=>row.id===id));
async function document(visibility='public',publishNow=true){
  let row=await createResource(author,{slug:'cert-evidence-'+randomUUID(),title:localized('Isolated certificate evidence'),summary:localized('Controlled test document'),type:'other',visibility});
  const asset=await storeAsset({ownerId:author.id,name:'certificate-fixture.pdf',bytes:Buffer.from('%PDF-1.7\nIsolated certificate test fixture\n%%EOF'),mimeType:'application/pdf',extension:'pdf',visibility:'private',scanStatus:'clean',metadata:{}});
  row=await addResourceVersion(author,row.id,{assetId:asset.id,label:'Fixture revision 1',locale:'fa',rightsConfirmed:true},row.version);
  const version=row.versions[0];
  if(publishNow){row=await reviewResourceVersion(reviewer,row.id,version.id,{decision:'approved',note:'Independent controlled test evidence review.'});row=await publishResource(author,row.id,{versionId:version.id},row.version);}
  return{resourceId:row.id,versionId:version.id,assetId:asset.id,resource:row};
}
async function claim(id){return(await query("UPDATE outbox SET state='running',attempts=attempts+1,locked_at=now(),lock_token=$2 WHERE id=$1 RETURNING id,kind,payload,attempts,lock_token",[id,randomUUID()])).rows[0];}

test('Certificate validity uses inclusive UTC days and never calls an expired, future, revoked or missing-source certificate current',()=>{
  const value={validFrom:'2026-01-01',validUntil:'2026-10-19'};
  assert.equal(companyCertificateStatus(value,false,true,new Date('2026-10-19T23:59:59.999Z')),'expiring');
  assert.equal(companyCertificateStatus(value,false,true,new Date('2026-10-20T00:00:00Z')),'expired');
  assert.equal(companyCertificateStatus(value,true,true,new Date('2026-10-01T00:00:00Z')),'revoked');
  assert.equal(companyCertificateStatus(value,false,false,new Date('2026-10-01T00:00:00Z')),'source-unavailable');
  assert.equal(companyCertificateStatus(value,false,true,new Date('2025-12-31T23:59:59Z')),'not-yet-valid');
  assert.equal(companyCertificateStatus(value,false,true,new Date('2026-01-02T00:00:00Z')),'current');
});

test('PostgreSQL certificate registry, exact source review, locale/version controls and current internal alert policy',{timeout:360000},async t=>{
  assert.ok(database,'Company certificate integration requires a real PostgreSQL database.');
  const schema='certificates_'+randomUUID().replaceAll('-',''),control=new pg.Client({connectionString:database});await control.connect();await control.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database);scoped.searchParams.set('options','-c search_path='+schema);
  const names=['DATABASE_URL','STORAGE_DIR','NODE_ENV','DEMO_MODE','PRIVACY_LEDGER_DIR','SESSION_SECRET','MFA_ENCRYPTION_KEY','SITE_URL','NOTIFICATIONS_MODE'],old=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const storage=await mkdtemp(join(tmpdir(),'certificate-test-'));
  Object.assign(process.env,{DATABASE_URL:scoped.toString(),STORAGE_DIR:storage,NODE_ENV:'test',SESSION_SECRET:'certificate-integration-session-secret',MFA_ENCRYPTION_KEY:'e'.repeat(64),SITE_URL:'http://localhost:3000',NOTIFICATIONS_MODE:'off'});delete process.env.DEMO_MODE;delete process.env.PRIVACY_LEDGER_DIR;await closeDb();
  try{
    const migration=new pg.Client({connectionString:scoped.toString()});await migration.connect();
    try{for(const name of(await readdir(new URL('../db/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort())await migration.query(await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8'));}finally{await migration.end();}
    for(const by of[author,reviewer,limited])await query('INSERT INTO users(id,name,email,password_hash,role,active,mfa_enabled,quality_scope,allowed_locales) VALUES($1,$2,$3,$4,$5,true,true,true,$6::jsonb)',[by.id,by.name,by.email,'non-login certificate fixture',by.role,JSON.stringify(by.allowedLocales)]);
    await t.test('An empty registry invents no certificate and incomplete drafts cannot obtain approval or public validity',async()=>{
      assert.deepEqual(await listPublicCompanyCertificates('en'),{items:[]});
      const row=await make('incomplete-fixture',blank);
      assert.equal(row.draftRevisionId!==null,true);assert.equal(row.published,null);
      await assert.rejects(approve(row),error(422,'CERTIFICATE_INCOMPLETE'));
      await assert.rejects(publish(row),error(422,'CERTIFICATE_INCOMPLETE'));
      await assert.rejects(reviewCompanyCertificate(author,row.id,{locale:'en',expectedVersion:row.version,decision:'approved'}),error(403,'SELF_REVIEW'));
    });
    source=await document();
    await t.test('Only current public reviewed resources enter the selector or a new evidence reference',async()=>{
      const privateSource=await document('authenticated'),unreviewed=await document('public',false);
      const rows=(await listCompanyCertificateSources(author,'en')).items;
      assert.equal(rows.some(row=>row.resourceId===source.resourceId),true);
      for(const unavailable of[privateSource,unreviewed]){
        assert.equal(rows.some(row=>row.resourceId===unavailable.resourceId),false);
        await assert.rejects(make('rejected-source-'+randomUUID(),facts({resourceId:unavailable.resourceId,resourceVersionId:unavailable.versionId})),error(409,'CERTIFICATE_SOURCE'));
      }
      assert.equal(rows[0].locale,'fa');assert.match(rows[0].href,/^\/api\/v1\/resources\/[^/]+\/versions\/[^/]+\/content\?action=view$/);assert.equal('assetId'in rows[0],false);
    });
    await t.test('Independent reviewed locale release keeps actual document language and preserves its immutable facts during a new draft',async()=>{
      let row=await publish(await approve(await make('localized-fixture')));assert.equal(row.published.locale,'en');assert.equal(row.published.source.locale,'fa');assert.equal(await publicRow(row.id,'fa'),undefined);
      const first=row.published;
      row=await updateCompanyCertificate(author,row.id,{locale:'en',expectedVersion:row.version,definition:facts({title:'A new draft description'})});
      assert.equal((await publicRow(row.id)).title,first.title);assert.equal((await publicRow(row.id)).revisionId,first.revisionId);
      await assert.rejects(publish(row),error(409,'CERTIFICATE_REVIEW_REQUIRED'));
      row=await publish(await approve(row));assert.equal((await publicRow(row.id)).title,'A new draft description');
      assert.notEqual(row.published.revisionId,first.revisionId);
      row=await updateCompanyCertificate(author,row.id,{locale:'fa',expectedVersion:row.version,definition:facts({title:'گواهیِ صرفاً آزمایشی'})});row=await publish(await approve(row));
      assert.equal((await publicRow(row.id,'en')).title,'A new draft description');assert.equal((await publicRow(row.id,'fa')).title,'گواهیِ صرفاً آزمایشی');
      row=await withdrawCompanyCertificate(author,row.id,{locale:'fa',expectedVersion:row.version,reason:'Withdrawing only the isolated Persian fixture.'});assert.equal(await publicRow(row.id,'fa'),undefined);assert.ok(await publicRow(row.id,'en'));
    });
    await t.test('Review, edit and global state reload current role, quality, MFA and locale grants',async()=>{
      let row=await approve(await make('revoked-grants-fixture'));
      await query("UPDATE users SET quality_scope=false WHERE id=$1",[reviewer.id]);
      await assert.rejects(publish(row),error(409,'CERTIFICATE_REVIEW_REQUIRED'));
      await assert.rejects(reviewCompanyCertificate(reviewer,row.id,{locale:'en',expectedVersion:row.version,decision:'approved'}),error(403,'QUALITY_SCOPE'));
      await query("UPDATE users SET quality_scope=true,allowed_locales='[\"fa\"]'::jsonb WHERE id=$1",[reviewer.id]);await assert.rejects(publish(row),error(409,'CERTIFICATE_REVIEW_REQUIRED'));
      await query('UPDATE users SET allowed_locales=$2::jsonb WHERE id=$1',[reviewer.id,JSON.stringify(languages)]);
      row=await publish(row);
      await query('UPDATE users SET mfa_enabled=false WHERE id=$1',[limited.id]);await assert.rejects(listManagedCompanyCertificates(limited,'en'),error(403));
      await query("UPDATE users SET mfa_enabled=true,allowed_locales='[\"fa\"]'::jsonb WHERE id=$1",[limited.id]);
      await assert.rejects(updateCompanyCertificate(limited,row.id,{locale:'en',expectedVersion:row.version,definition:facts()}),error(403));
      await assert.rejects(setCompanyCertificateState(limited,row.id,{locale:'fa',expectedVersion:row.version,archived:true,reason:'Unauthorized global language state mutation.'}),error(403,'CONTENT_LOCALE'));
      await query("UPDATE users SET role='customer' WHERE id=$1",[limited.id]);await assert.rejects(listManagedCompanyCertificates(limited,'fa'),error(403));
    });
    await t.test('Same-version concurrent edits commit exactly one revision and immutable review/history reject direct rewrites',async()=>{
      const row=await make('concurrent-fixture'),results=await Promise.allSettled(['One','Two'].map(title=>updateCompanyCertificate(author,row.id,{locale:'en',expectedVersion:row.version,definition:facts({title})})));
      assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.equal(results.filter(value=>value.status==='rejected'&&error(409,'CONFLICT')(value.reason)).length,1);
      const latest=await current(row.id);assert.equal(latest.revisions.length,2);
      await assert.rejects(query('UPDATE company_certificate_revisions SET definition=$2::jsonb WHERE id=$1',[latest.draftRevisionId,JSON.stringify(facts({title:'Rewritten history'}))]));
      await assert.rejects(query("INSERT INTO company_certificate_reviews(revision_id,decision,reviewer_id,reviewer_role,reason) VALUES($1,'approved',$2,'admin','self-approved')",[latest.draftRevisionId,author.id]),value=>value.code==='23514');
      await assert.rejects(query('DELETE FROM company_certificate_revisions WHERE id=$1',[latest.draftRevisionId]));
    });
    await t.test('Current source withdrawal and quarantine remove usable evidence without rewriting released certificate facts',async()=>{
      const local=await document();let row=await publish(await approve(await make('source-withdrawal-fixture',facts({resourceId:local.resourceId,resourceVersionId:local.versionId}))));
      const frozen=row.published.revisionId;
      await query("UPDATE assets SET scan_status='blocked' WHERE id=$1",[local.assetId]);let published=await publicRow(row.id);assert.equal(published.status,'source-unavailable');assert.equal(published.source,null);assert.equal(published.revisionId,frozen);
      await query("UPDATE assets SET scan_status='clean' WHERE id=$1",[local.assetId]);await updateResource(author,local.resourceId,{status:'draft'},local.resource.version);
      published=await publicRow(row.id);assert.equal(published.status,'source-unavailable');assert.equal(published.source,null);
    });
    await t.test('Revocation is permanent while global archive and per-language withdrawal have separate visible effects',async()=>{
      let row=await publish(await approve(await make('revoke-fixture')));row=await revokeCompanyCertificate(author,row.id,{locale:'en',expectedVersion:row.version,reason:'Fixture-only issuer revocation recorded with evidence.'});
      assert.equal((await publicRow(row.id)).status,'revoked');
      await assert.rejects(updateCompanyCertificate(author,row.id,{locale:'en',expectedVersion:row.version,definition:facts()}),error(409,'CERTIFICATE_CLOSED'));
      await assert.rejects(query('UPDATE company_certificates SET revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL WHERE id=$1',[row.id]),value=>value.code==='23514');
      row=await setCompanyCertificateState(author,row.id,{locale:'en',expectedVersion:row.version,archived:true,reason:'Hide the historical isolated certificate.'});assert.equal(await publicRow(row.id),undefined);
      row=await setCompanyCertificateState(author,row.id,{locale:'en',expectedVersion:row.version,archived:false,reason:'Restore the historical isolated certificate.'});assert.equal((await publicRow(row.id)).status,'revoked');
    });
    await t.test('An audit failure rolls back the draft, revision and certificate version atomically',async()=>{
      const row=await make('audit-fixture');await query("CREATE FUNCTION certificate_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='certificate.revised' THEN RAISE EXCEPTION 'Controlled audit failure'; END IF; RETURN NEW; END $$");await query('CREATE TRIGGER certificate_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION certificate_audit_fail()');
      try{await assert.rejects(updateCompanyCertificate(author,row.id,{locale:'en',expectedVersion:row.version,definition:facts({title:'Never committed'})}));}finally{await query('DROP TRIGGER certificate_audit_fail ON audit_events');}
      const after=await current(row.id);assert.equal(after.version,row.version);assert.equal(after.draftRevisionId,row.draftRevisionId);assert.equal(after.revisions.length,1);
    });
    await t.test('Expiry reminders are deduplicated queued in-app events, obey opt-out and cancel after current source or recipient revocation',async()=>{
      const row=await publish(await approve(await make('expiring-fixture',facts({validUntil:day(5)}))));
      const counts=await Promise.all([runCompanyCertificateAlerts(),runCompanyCertificateAlerts()]);assert.ok(counts[0].queued+counts[1].queued>=2);
      const entries=(await query('SELECT * FROM company_certificate_alerts WHERE revision_id=$1',[row.published.revisionId])).rows;assert.equal(new Set(entries.map(value=>value.user_id+':'+value.state)).size,entries.length);assert.ok(entries.every(value=>value.result==='queued'));
      assert.equal((await query("SELECT 1 FROM notifications WHERE href LIKE $1",['%certificate='+row.id])).rowCount,0);
      const first=entries.find(value=>value.user_id===author.id),second=entries.find(value=>value.user_id===reviewer.id);
      let preferences=await getNotificationPreferences(author);preferences.preferences.topics.requests.inApp.enabled=false;await patchNotificationPreferences(author,{expectedVersion:preferences.version,preferences:preferences.preferences});
      let providerCalls=0;await deliverOutbox(await claim(first.outbox_id),{sendMail:async()=>{providerCalls++;throw new Error('Never invoke external mail for an internal certificate alert.');}});
      assert.equal((await query('SELECT state FROM outbox WHERE id=$1',[first.outbox_id])).rows[0].state,'cancelled');assert.equal(providerCalls,0);
      const pending=(await query('SELECT payload FROM outbox WHERE id=$1',[second.outbox_id])).rows[0];const payload=JSON.parse(decrypt(pending.payload.encrypted));assert.equal(await transaction(client=>canDeliverCompanyCertificateAlert(client,payload)),true);
      await query('UPDATE users SET quality_scope=false WHERE id=$1',[reviewer.id]);await deliverOutbox(await claim(second.outbox_id));assert.equal((await query('SELECT state FROM outbox WHERE id=$1',[second.outbox_id])).rows[0].state,'cancelled');await query('UPDATE users SET quality_scope=true WHERE id=$1',[reviewer.id]);
      const again=await runCompanyCertificateAlerts();assert.equal(again.queued,0);
    });
  }finally{await closeDb();for(const name of names)if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];await control.query('DROP SCHEMA '+schema+' CASCADE');await control.end();await rm(storage,{recursive:true,force:true});}
});
