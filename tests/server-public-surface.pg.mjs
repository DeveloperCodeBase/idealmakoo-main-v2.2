import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {query,closeDb,transaction} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';
import {getWorkspace,saveWorkspace,getSitePreferences,saveSitePreferences,getPublicSite,reviewWorkspaceContent,publishWorkspace,unpublishWorkspace,scheduleWorkspaceContent,runScheduledWorkspacePublications,getWorkspaceRevisions} from '../src/server/workspace.ts';
import {defaultSitePreferences} from '../src/server/workspace-preferences.ts';
import {createResource,addResourceVersion,reviewResourceVersion,publishResource,updateResource,searchPublicResources} from '../src/server/resources.ts';
import {storeAsset} from '../src/server/storage.ts';
import {updateDamPolicy} from '../src/server/dam.ts';
import {handleRequest} from '../src/server/router.ts';
import {publicKnowledge} from '../src/server/public-knowledge.ts';
import {getSettings,patchSettings} from '../src/server/account.ts';
import {getCommunicationChannels} from '../src/server/communication-channels.ts';
import {getNotificationPreferences,patchNotificationPreferences} from '../src/server/notification-policy.ts';
import {runPublicationNotificationFanout,publicationNotificationPermitted} from '../src/server/notification-publications.ts';
import {deliverOutbox} from '../src/server/notifications.ts';
import {decrypt} from '../src/server/crypto.ts';

const database=process.env.TEST_ADMIN_DATABASE_URL||process.env.MIGRATION_DATABASE_URL||process.env.TEST_DATABASE_URL;
const languages=['fa','en','tr','ar','ru'],words=text=>Object.fromEntries(languages.map(locale=>[locale,text]));
const actor=(id,role='admin',allowedLocales=languages)=>({id,name:id,email:id+'@example.invalid',role,mfaVerified:true,qualityScope:true,allowedLocales});
const author=actor('surface-author'),reviewer=actor('surface-reviewer'),translator=actor('surface-translator','translator',['en']),limited=actor('surface-limited','admin',['en']);
const error=(status,code)=>value=>value instanceof HttpError&&value.status===status&&(!code||value.code===code);
const windowDefinition=extra=>({enabled:true,startsAt:null,endsAt:null,actionPath:'contact',actionLabel:'Contact',...extra});
async function createNotice(id,overrides={}){
  const stamp=new Date().toISOString(),record={id,collection:'news',title:words('Isolated notice '+id),summary:words('A controlled public-surface test message.'),status:'draft',owner:'admin',tags:[],history:[],demo:false,createdAt:stamp,updatedAt:stamp,publishedLocales:[],details:{publicNotice:{schemaVersion:1,locales:{en:windowDefinition(),fa:windowDefinition({actionLabel:'تماس'})}}},...overrides};
  const current=await getWorkspace(author);await saveWorkspace(author,{state:{...current.state,records:[...current.state.records,record]},locale:'en',expectedVersion:current.version});return record;
}
async function mutate(id,change,by=author,locale='en'){
  const current=await getWorkspace(by),record=current.state.records.find(item=>item.id===id);assert.ok(record);
  return saveWorkspace(by,{state:{...current.state,records:current.state.records.map(item=>item.id===id?change(structuredClone(item)):item)},locale,expectedVersion:current.version});
}
async function review(id,locale='en',by=reviewer){const current=await getWorkspace(by);return reviewWorkspaceContent(by,{bucket:'records',id,locale,expectedVersion:current.version});}
async function publish(id,locale='en',extra={}){const current=await getWorkspace(author);return publishWorkspace(author,{publication:{id,kind:'news',locale,...extra},expectedVersion:current.version});}
async function prepare(id,locale='en'){await mutate(id,row=>({...row,status:'review',approvedBy:undefined,approvedById:undefined}));await review(id,locale);}
async function live(id,locale='en'){return(await getPublicSite()).publications.find(row=>row.id===id&&row.locale===locale);}
async function drainFanout(){for(let n=0;n<30;n++){const result=await runPublicationNotificationFanout(500);if(!result.completed)return;}assert.fail('Fanout did not finish its bounded fixture backlog.');}
async function noticeEvents(id){return(await query('SELECT * FROM notification_publication_events WHERE document_id=$1 ORDER BY created_at,id',[id])).rows;}
async function eventJobs(event){return(await query('SELECT * FROM outbox WHERE dedupe_key LIKE $1',[event.id+':%'])).rows;}
async function contentConsent(enabled){const current=await getNotificationPreferences(author);current.preferences.topics.content.inApp.enabled=enabled;await patchNotificationPreferences(author,{expectedVersion:current.version,preferences:current.preferences});}
async function document(visibility='public',approved=true){
  let resource=await createResource(author,{slug:'search-document-'+randomUUID(),title:words('Controlled search fixture '+visibility),summary:words('Distinctive summary phrase plasmamarker.'),type:'catalog',visibility});
  const asset=await storeAsset({ownerId:author.id,name:'public-search-fixture.pdf',bytes:Buffer.from('%PDF-1.7\nIsolated search fixture, no real certificate.\n%%EOF'),mimeType:'application/pdf',extension:'pdf',visibility:'private',scanStatus:'clean',metadata:{}});
  resource=await addResourceVersion(author,resource.id,{assetId:asset.id,label:'Reviewed test revision',locale:'fa',rightsConfirmed:true},resource.version);const version=resource.versions[0];
  if(approved){resource=await reviewResourceVersion(reviewer,resource.id,version.id,{decision:'approved',note:'Independent review of controlled fixture.'});resource=await publishResource(author,resource.id,{versionId:version.id},resource.version);}
  return{resource,version,asset};
}

test('PostgreSQL public surface: versioned preferences, reviewed timed notices and current public document search',{timeout:360000},async t=>{
  assert.ok(database,'This integration gate requires real PostgreSQL.');
  const schema='public_surface_'+randomUUID().replaceAll('-',''),control=new pg.Client({connectionString:database});await control.connect();await control.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database);scoped.searchParams.set('options','-c search_path='+schema);
  const names=['DATABASE_URL','NODE_ENV','NEXT_PUBLIC_DEMO_MODE','DEMO_MODE','PRIVACY_LEDGER_DIR','STORAGE_DIR','SESSION_SECRET','MFA_ENCRYPTION_KEY','SITE_URL','NOTIFICATIONS_MODE'],old=Object.fromEntries(names.map(name=>[name,process.env[name]])),storage=await mkdtemp(join(tmpdir(),'public-surface-test-'));
  Object.assign(process.env,{DATABASE_URL:scoped.toString(),NODE_ENV:'test',NEXT_PUBLIC_DEMO_MODE:'false',STORAGE_DIR:storage,SESSION_SECRET:randomBytes(32).toString('hex'),MFA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),SITE_URL:'http://localhost:3000',NOTIFICATIONS_MODE:'disabled'});delete process.env.DEMO_MODE;delete process.env.PRIVACY_LEDGER_DIR;await closeDb();
  try{
    const migration=new pg.Client({connectionString:scoped.toString()});await migration.connect();try{for(const file of(await readdir(new URL('../db/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()){try{await migration.query(await readFile(new URL('../db/migrations/'+file,import.meta.url),'utf8'));}catch(error){error.message=`${file}: ${error.message}`;throw error;}}}finally{await migration.end();}
    for(const by of[author,reviewer,translator,limited])await query("INSERT INTO users(id,name,email,password_hash,role,active,mfa_enabled,quality_scope,allowed_locales) VALUES($1,$2,$3,'non-login isolated test fixture',$4,true,true,true,$5::jsonb)",[by.id,by.name,by.email,by.role,JSON.stringify(by.allowedLocales)]);
    await getWorkspace(author);
    const settings=await getSettings(author);await patchSettings(author,'preferences',{language:'en'},settings.revision);await getCommunicationChannels(author);assert.equal((await getNotificationPreferences(author)).preferences.topics.content.inApp.enabled,false);
    await t.test('Independent office/factory and attribution fields commit with exact version while unpublished edits stay private',async()=>{
      const before=await getSitePreferences(author),value=defaultSitePreferences();value.contact.address=words('Configured office');value.contact.officeAddress=words('Configured office');value.contact.factoryAddress=words('Separate configured factory');value.footerDetails.developerName=words('Configured attribution');value.footerDetails.sourceUrl='';
      const draft=await saveSitePreferences(author,{value,mode:'settings',publish:false,expectedVersion:before.version});assert.notEqual((await getPublicSite()).preferences.contact.factoryAddress.en,'Separate configured factory');
      const published=await saveSitePreferences(author,{value,mode:'settings',publish:true,expectedVersion:draft.version});assert.equal((await getPublicSite()).preferences.contact.factoryAddress.en,'Separate configured factory');assert.equal((await getPublicSite()).preferences.contact.address.en,'Configured office');assert.equal((await getPublicSite()).preferences.footerDetails.sourceUrl,'');
      await assert.rejects(saveSitePreferences(author,{value,mode:'settings',publish:true,expectedVersion:before.version}),error(409));assert.equal((await getSitePreferences(author)).version,published.version);
    });
    await t.test('Legacy address-only clients preserve the saved factory and footer, and current limited-language grants cannot edit global identity',async()=>{
      const current=await getSitePreferences(author),value=structuredClone(current.published);delete value.contact.officeAddress;delete value.contact.factoryAddress;delete value.footerDetails;value.contact.address=words('Legacy office edit');
      const saved=await saveSitePreferences(author,{value,mode:'settings',publish:true,expectedVersion:current.version});assert.equal(saved.published.contact.officeAddress.en,'Legacy office edit');assert.equal(saved.published.contact.factoryAddress.en,'Separate configured factory');assert.equal(saved.published.footerDetails.developerName.en,'Configured attribution');
      await assert.rejects(saveSitePreferences(limited,{value:saved.published,mode:'settings',publish:true,expectedVersion:saved.version}),error(403));
      const invalid=structuredClone(saved.published);invalid.contact.factoryAddress.xx='Foreign key';await assert.rejects(saveSitePreferences(author,{value:invalid,mode:'settings',publish:false,expectedVersion:saved.version}),error(422));assert.equal((await getSitePreferences(author)).version,saved.version);
    });
    await t.test('Malformed notice windows and wrong record collections reject the whole workspace write',async()=>{
      const before=await getWorkspace(author);
      await assert.rejects(createNotice('NOTICE-INVALID',{details:{publicNotice:{schemaVersion:1,locales:{en:windowDefinition({startsAt:'2026-02-30T00:00:00Z'})}}}}),error(422,'PUBLIC_NOTICE_SCHEMA'));
      await assert.rejects(createNotice('NOTICE-WRONG',{collection:'research'}),error(422,'PUBLIC_NOTICE_SCHEMA'));
      assert.equal((await getWorkspace(author)).version,before.version);assert.equal((await getPublicSite()).publications.some(row=>row.publicNotice),false);
    });
    await createNotice('NOTICE-LIVE');
    await t.test('Review requires an independent current account and the selected language definition; publication rejects forged banner metadata',async()=>{
      const submitted=await mutate('NOTICE-LIVE',row=>({...row,status:'review'}));await assert.rejects(reviewWorkspaceContent(author,{bucket:'records',id:'NOTICE-LIVE',locale:'en',expectedVersion:submitted.version}),error(403));await assert.rejects(review('NOTICE-LIVE','tr'),error(422,'PUBLIC_NOTICE_CONTENT'));
      await review('NOTICE-LIVE');await assert.rejects(publish('NOTICE-LIVE','en',{publicNotice:{schemaVersion:1,...windowDefinition({actionLabel:'Forged'})}}),error(409,'revision_conflict'));await publish('NOTICE-LIVE');
      const released=await live('NOTICE-LIVE');assert.equal(released.publicNotice.actionLabel,'Contact');assert.equal('details'in released,false);assert.equal(JSON.stringify(released).includes('تماس'),false);assert.equal(await live('NOTICE-LIVE','fa'),undefined);
      const events=await noticeEvents('NOTICE-LIVE');assert.equal(events.length,1);assert.equal(events[0].topic,'content');assert.equal(events[0].locale,'en');assert.equal(events[0].state,'pending');assert.equal((await eventJobs(events[0])).length,0);
      const expanded=await runPublicationNotificationFanout(500);assert.equal(expanded.queued,0);assert.equal((await eventJobs(events[0])).length,0,'A matching-language account without explicit content consent receives no unsolicited delivery.');assert.equal((await noticeEvents('NOTICE-LIVE'))[0].state,'completed');
      const history=await getWorkspaceRevisions(author,{bucket:'records',id:'NOTICE-LIVE',locale:'en'});await assert.rejects(query('UPDATE content_revisions SET checksum=$2 WHERE id=$1',[history.revisions[0].id,'0'.repeat(64)]));
    });
    await t.test('Draft edits keep both live languages and a translator cannot change another language schedule or current revoked grants',async()=>{
      await review('NOTICE-LIVE','fa');await publish('NOTICE-LIVE','fa');const original=await live('NOTICE-LIVE');
      await mutate('NOTICE-LIVE',row=>({...row,status:'draft',approvedBy:undefined,approvedById:undefined,summary:{...row.summary,en:'New English draft'},details:{...row.details,publicNotice:{schemaVersion:1,locales:{...row.details.publicNotice.locales,en:windowDefinition({actionLabel:'Revised contact'})}}}}),translator);
      assert.equal((await live('NOTICE-LIVE')).summary,original.summary);assert.ok(await live('NOTICE-LIVE','fa'));await assert.rejects(publish('NOTICE-LIVE'),error(409));
      await assert.rejects(mutate('NOTICE-LIVE',row=>({...row,details:{...row.details,publicNotice:{schemaVersion:1,locales:{...row.details.publicNotice.locales,fa:windowDefinition({enabled:false})}}}}),translator),error(403));
      await query("UPDATE users SET allowed_locales='[\"fa\"]'::jsonb WHERE id=$1",[translator.id]);await assert.rejects(mutate('NOTICE-LIVE',row=>({...row,summary:{...row.summary,en:'Stale grant'}}),translator),error(403));await query("UPDATE users SET allowed_locales='[\"en\"]'::jsonb WHERE id=$1",[translator.id]);
      await prepare('NOTICE-LIVE');await publish('NOTICE-LIVE');assert.equal((await live('NOTICE-LIVE')).summary,'New English draft');assert.equal((await live('NOTICE-LIVE','fa')).summary,original.summary);
    });
    await t.test('Server projection and public RAG omit future, expired and disabled published notices',async()=>{
      for(const [id,extra]of[['NOTICE-FUTURE',{startsAt:new Date(Date.now()+86400000).toISOString()}],['NOTICE-EXPIRED',{endsAt:new Date(Date.now()-86400000).toISOString()}],['NOTICE-DISABLED',{enabled:false}]]){await createNotice(id,{details:{publicNotice:{schemaVersion:1,locales:{en:windowDefinition(extra)}}}});await prepare(id);await publish(id);assert.equal(await live(id),undefined);assert.equal((await publicKnowledge('en')).some(entry=>entry.id==='published-'+id+'-en'),false);}
      const response=await handleRequest(new Request('http://localhost:3000/api/v1/site'),['site']);assert.equal(response.status,200);const site=await response.json();assert.ok(Number.isFinite(Date.parse(site.observedAt)));assert.equal(site.publications.some(row=>['NOTICE-FUTURE','NOTICE-EXPIRED','NOTICE-DISABLED'].includes(row.id)),false);
    });
    await t.test('Notice fanout waits for its public window without blocking active content and rechecks expiry at actual delivery',async()=>{
      await contentConsent(true);
      try{
        await createNotice('NOTICE-ACTIVE-ANNOUNCEMENT');await prepare('NOTICE-ACTIVE-ANNOUNCEMENT');await publish('NOTICE-ACTIVE-ANNOUNCEMENT');await drainFanout();
        const future=(await noticeEvents('NOTICE-FUTURE'))[0];assert.ok(future);assert.equal(future.state,'pending');assert.equal((await eventJobs(future)).length,0);
        for(const id of ['NOTICE-EXPIRED','NOTICE-DISABLED'])assert.equal((await noticeEvents(id)).length,0,'Inactive published notices must not become broadcast events.');
        const active=(await noticeEvents('NOTICE-ACTIVE-ANNOUNCEMENT'))[0],activeJobs=await eventJobs(active);assert.equal(activeJobs.length,1);assert.equal(activeJobs[0].kind,'in-app');assert.equal(activeJobs[0].account_id,author.id);
        const startsAt=new Date(Date.now()+1500).toISOString(),endsAt=new Date(Date.parse(startsAt)+2000).toISOString();
        await createNotice('NOTICE-BOUNDED-ANNOUNCEMENT',{details:{publicNotice:{schemaVersion:1,locales:{en:windowDefinition({startsAt,endsAt})}}}});await prepare('NOTICE-BOUNDED-ANNOUNCEMENT');await publish('NOTICE-BOUNDED-ANNOUNCEMENT');
        const bounded=(await noticeEvents('NOTICE-BOUNDED-ANNOUNCEMENT'))[0];assert.ok(bounded);await drainFanout();assert.equal((await eventJobs(bounded)).length,0);assert.equal(await live('NOTICE-BOUNDED-ANNOUNCEMENT'),undefined);
        await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(startsAt)-Date.now())+30));await drainFanout();const jobs=await eventJobs(bounded);assert.equal(jobs.length,1);const payload=JSON.parse(decrypt(jobs[0].payload.encrypted));assert.equal(payload.locale,'en');assert.equal(payload.topic,'content');assert.equal(payload.userId,author.id);assert.equal(await transaction(client=>publicationNotificationPermitted(client,payload)),true);assert.equal(await transaction(client=>publicationNotificationPermitted(client,{...payload,locale:'fa'})),false);
        await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(endsAt)-Date.now())+30));assert.equal(await live('NOTICE-BOUNDED-ANNOUNCEMENT'),undefined);
        const lock=randomUUID();await query("UPDATE outbox SET state='running',lock_token=$2,locked_at=now(),attempts=attempts+1 WHERE id=$1",[jobs[0].id,lock]);await deliverOutbox({...jobs[0],lock_token:lock,attempts:1});assert.equal((await query('SELECT state FROM outbox WHERE id=$1',[jobs[0].id])).rows[0].state,'cancelled');assert.equal((await query('SELECT id FROM notifications WHERE dedupe_key=$1',['outbox:'+jobs[0].id])).rowCount,0);
      }finally{await contentConsent(false);}
    });
    await t.test('The real scheduled publication worker publishes only the approved notice revision after its due time',async()=>{
      const id='NOTICE-SCHEDULED';await createNotice(id,{details:{publicNotice:{schemaVersion:1,locales:{en:windowDefinition()}}}});await prepare(id);
      const current=await getWorkspace(author),due=new Date(Date.now()+1000).toISOString();await scheduleWorkspaceContent(author,{bucket:'records',id,locale:'en',scheduledAt:due,expectedVersion:current.version});assert.equal(await live(id),undefined);assert.equal((await runScheduledWorkspacePublications()).published,0);
      await new Promise(resolve=>setTimeout(resolve,1150));assert.equal((await runScheduledWorkspacePublications()).published,1);assert.ok(await live(id));
    });
    await t.test('Locale withdrawal stays local, archiving requires every release withdrawn and restoring an archive never revives it',async()=>{
      const current=await getWorkspace(author),released=await live('NOTICE-LIVE');await unpublishWorkspace(author,{slug:released.slug,locale:'en',kind:'news',expectedVersion:current.version});assert.equal(await live('NOTICE-LIVE'),undefined);assert.ok(await live('NOTICE-LIVE','fa'));
      await assert.rejects(mutate('NOTICE-LIVE',row=>({...row,status:'archived'}),limited),error(403));await assert.rejects(mutate('NOTICE-LIVE',row=>({...row,status:'archived'})),error(409,'published_content'));const stillLive=await getWorkspace(author),faRelease=await live('NOTICE-LIVE','fa');await unpublishWorkspace(author,{slug:faRelease.slug,locale:'fa',kind:'news',expectedVersion:stillLive.version});await mutate('NOTICE-LIVE',row=>({...row,status:'archived',archivedFrom:row.status}));assert.equal(await live('NOTICE-LIVE','fa'),undefined);
      await mutate('NOTICE-LIVE',row=>({...row,status:'draft',archivedFrom:undefined,approvedBy:undefined,approvedById:undefined}));assert.equal(await live('NOTICE-LIVE','fa'),undefined);assert.deepEqual((await getWorkspace(author)).state.records.find(row=>row.id==='NOTICE-LIVE').publishedLocales,[]);
    });
    const published=await document(),privateDocument=await document('authenticated'),restricted=await document('restricted'),unreviewed=await document('public',false);
    await t.test('Actual public search returns only current reviewed documents, with translated metadata and the real file language',async()=>{
      const result=await searchPublicResources({locale:'en',q:'plasmamarker'});assert.equal(result.items.some(row=>row.id===published.resource.id),true);
      for(const hidden of[privateDocument,restricted,unreviewed])assert.equal(result.items.some(row=>row.id===hidden.resource.id),false);
      const item=result.items.find(row=>row.id===published.resource.id);assert.equal(item.documentLocale,'fa');assert.equal(item.versionId,published.version.id);for(const field of['assetId','storageKey','filename','href','createdBy','ownerId'])assert.equal(field in item,false);
      assert.equal((await searchPublicResources({locale:'en',q:published.resource.slug})).items[0].id,published.resource.id);assert.deepEqual((await searchPublicResources({locale:'en',q:'%'})).items,[]);
      await assert.rejects(searchPublicResources({locale:'en',q:'x'.repeat(121)}),error(422));await assert.rejects(searchPublicResources({locale:'en',limit:31}),error(422));
      const response=await handleRequest(new Request('http://localhost:3000/api/v1/public/resource-search?locale=en&q=plasmamarker',{headers:{cookie:'irrelevant_session=isolated-fixture'}}),['public','resource-search']);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.json();assert.equal(body.items.length,1);assert.equal(body.items[0].id,published.resource.id);
    });
    await t.test('Quarantine, actual rights revocation and wall-clock expiry remove a previously found file immediately',async()=>{
      const matches=async()=>!!(await searchPublicResources({locale:'en',q:published.resource.slug})).items.length;
      await query("UPDATE assets SET scan_status='pending' WHERE id=$1",[published.asset.id]);assert.equal(await matches(),false);await query("UPDATE assets SET scan_status='clean' WHERE id=$1",[published.asset.id]);assert.equal(await matches(),true);
      let policy=await updateDamPolicy(author,published.asset.id,{rightsConfirmed:false,rightsExpiresAt:null,licenseNote:'Controlled isolated revocation fixture'},0);assert.equal(await matches(),false);
      policy=await updateDamPolicy(author,published.asset.id,{rightsConfirmed:true,rightsExpiresAt:new Date(Date.now()+500).toISOString(),licenseNote:'Controlled isolated expiring fixture'},policy.policy.version);await new Promise(resolve=>setTimeout(resolve,650));assert.equal(await matches(),false);
      await updateDamPolicy(author,published.asset.id,{rightsConfirmed:true,rightsExpiresAt:null,licenseNote:'Controlled fixture renewal'},policy.policy.version);assert.equal(await matches(),true);
    });
    await t.test('Withdrawal removes actual public search hits and direct anonymous metadata together',async()=>{
      await updateResource(author,published.resource.id,{status:'draft'},published.resource.version);assert.deepEqual((await searchPublicResources({locale:'en',q:published.resource.slug})).items,[]);
      const response=await handleRequest(new Request(`http://localhost:3000/api/v1/resources/${published.resource.slug}?locale=en`),['resources',published.resource.slug]);assert.equal(response.status,404);
    });
  }finally{await closeDb();for(const name of names)if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];await control.query('DROP SCHEMA '+schema+' CASCADE');await control.end();await rm(storage,{recursive:true,force:true});}
});
