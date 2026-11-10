import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixtureActor,insertActor,languages,localized,permissions,withCrmRecoveryDatabase} from './helpers/crm-recovery-environment.mjs';
import {query,transaction} from '../src/server/db.ts';
import {decrypt} from '../src/server/crypto.ts';
import {getWorkspace} from '../src/server/workspace.ts';
import {getSettings,patchSettings} from '../src/server/account.ts';
import {storeAsset} from '../src/server/storage.ts';
import {updateDamPolicy} from '../src/server/dam.ts';
import {createResource,addResourceVersion,reviewResourceVersion,publishResource,updateResource} from '../src/server/resources.ts';
import {runResourceNotificationFanout,resourceNotificationPermitted,resourceBoundDeliveryPermitted,resourceTelegramChannelPermitted} from '../src/server/notification-resources.ts';
import {getNotificationPreferences,patchNotificationPreferences} from '../src/server/notification-policy.ts';
import {getCommunicationChannels,connectCommunicationChannel,communicationVerificationResponse,updateCommunicationChannel,revokeCommunicationChannel} from '../src/server/communication-channels.ts';
import {deliverOutbox} from '../src/server/notifications.ts';
import {privacyDependencyBlockers,privacyCopiedTextBlockers} from '../src/server/privacy-dependencies.ts';
import {createContentComment,getEngagement,moderateContent} from '../src/server/engagement.ts';

const author=fixtureActor('resource-notice-author','admin'),reviewer=fixtureActor('resource-notice-reviewer','admin');
const reader=fixtureActor('resource-notice-reader','customer'),defaultReader=fixtureActor('resource-notice-default','customer'),englishReader=fixtureActor('resource-notice-english','customer');
const decode=row=>JSON.parse(decrypt(row.payload.encrypted));
const running=async row=>{const lock=randomUUID();await query("UPDATE outbox SET state='running',attempts=attempts+1,lock_token=$2,locked_at=now() WHERE id=$1",[row.id,lock]);return{...row,lock_token:lock,attempts:1};};
async function optedIn(actor){const saved=await getNotificationPreferences(actor);saved.preferences.topics.content.email.enabled=true;saved.preferences.topics.content.inApp.enabled=true;await patchNotificationPreferences(actor,{expectedVersion:saved.version,preferences:saved.preferences});}
async function document({visibility='public',approved=true,published=approved,scanStatus='clean'}={}){
  let resource=await createResource(author,{slug:'resource-notice-'+randomUUID(),title:localized('Reviewed resource & safe title'),summary:localized('Reviewed public document summary.'),type:'other',visibility});
  const asset=await storeAsset({ownerId:author.id,name:'resource-notice.pdf',bytes:Buffer.from('%PDF-1.7\nControlled resource notification fixture\n%%EOF'),mimeType:'application/pdf',extension:'pdf',visibility:'private',scanStatus,metadata:{}});
  resource=await addResourceVersion(author,resource.id,{assetId:asset.id,label:'Reviewed Persian document',locale:'fa',rightsConfirmed:true},resource.version);
  const version=resource.versions[0];
  if(approved)resource=await reviewResourceVersion(reviewer,resource.id,version.id,{decision:'approved',note:'Independent controlled document review.'});
  if(published)resource=await publishResource(author,resource.id,{versionId:version.id},resource.version);
  return{resource,version,asset};
}
async function eventFor(saved){return(await query('SELECT e.* FROM resource_notification_events e JOIN resource_publications p ON p.id=e.publication_id WHERE p.resource_id=$1 AND p.version_id=$2',[saved.resource.id,saved.version.id])).rows[0];}
async function outboxFor(event){return(await query('SELECT * FROM outbox WHERE dedupe_key LIKE $1 ORDER BY kind,id',[event.id+':%'])).rows;}

test('Managed resource publication announcements use independent approval, public availability and current delivery permission',{timeout:180000},async t=>withCrmRecoveryDatabase('resource_notices',async({control,schema})=>{
  const keys=['NOTIFICATIONS_MODE','KAVENEGAR_API_KEY','KAVENEGAR_OTP_TEMPLATE','TELEGRAM_BOT_TOKEN','TELEGRAM_CHANNEL_ID','TELEGRAM_CHANNEL_LOCALES'],old=Object.fromEntries(keys.map(key=>[key,process.env[key]])),originalFetch=globalThis.fetch;
  let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw new Error('External transport is prohibited in isolated resource notification tests.');};
  Object.assign(process.env,{NOTIFICATIONS_MODE:'live',KAVENEGAR_API_KEY:'isolated-resource-test',KAVENEGAR_OTP_TEMPLATE:'isolated_resource_otp',TELEGRAM_BOT_TOKEN:'isolated-resource-bot',TELEGRAM_CHANNEL_ID:'-1000000001',TELEGRAM_CHANNEL_LOCALES:'fa'});
  try{
    for(const actor of[author,reviewer,reader,defaultReader,englishReader]){await insertActor(actor,{scope:'all',grants:permissions});await getSettings(actor);await getCommunicationChannels(actor);}
    await getWorkspace(author);await optedIn(reader);await optedIn(englishReader);
    let english=await getSettings(englishReader);await patchSettings(englishReader,'preferences',{language:'en'},english.revision);
    let settings=await getSettings(reader);await patchSettings(reader,'profile',{phone:'+989123456789'},settings.revision);
    const connection=await connectCommunicationChannel(reader,{channel:'sms'}),bindingId=connection.binding.id,raw=new URL(connection.verificationUrl).pathname.split('/').filter(Boolean).at(-1),url='http://localhost:3000/api/v1/communication-verification/'+raw;
    const proof=(await query("SELECT * FROM outbox WHERE kind='sms' ORDER BY created_at DESC")).rows.map(decode).find(value=>value.communicationProof?.bindingId===bindingId);assert.ok(proof);
    const view=await(await communicationVerificationResponse(new Request(url),raw)).json();await communicationVerificationResponse(new Request(url,{method:'PATCH',headers:{origin:'http://localhost:3000','content-type':'application/json','x-communication-csrf':view.csrfToken},body:JSON.stringify({confirm:true,code:proof.code})}),raw);
    let binding=(await getCommunicationChannels(reader)).items.find(row=>row.id===bindingId);binding.preferences.topics.content.enabled=true;binding=await updateCommunicationChannel(reader,bindingId,{preferences:binding.preferences},binding.version);
    let first;
    await t.test('real publishResource creates one event; bounded fanout respects consent, locale, verified SMS and the official channel',async()=>{
      first=await document();const event=await eventFor(first);assert.equal(event.locale,'fa');assert.equal(event.state,'pending');assert.equal((await outboxFor(event)).length,0);
      while((await query("SELECT 1 FROM resource_notification_events WHERE id=$1 AND state='pending'",[event.id])).rowCount)await runResourceNotificationFanout(1);
      const rows=await outboxFor(event);assert.equal(rows.length,4);assert.deepEqual(rows.map(row=>row.kind).sort(),['email','in-app','sms','telegram']);
      for(const row of rows){const payload=decode(row);assert.equal(payload.topic,'content');assert.equal(payload.purpose,'marketing');assert.equal(payload.href,`/fa/resources/${first.resource.slug}/`);assert.equal(payload.resourcePublicationEventId,event.id);assert.equal(payload.imageUrl,undefined);assert.ok(!JSON.stringify(payload).includes(first.asset.id),'A private asset URL or identifier must not enter the public announcement.');if(row.kind!=='telegram')assert.equal(payload.userId,reader.id);}
      const sms=decode(rows.find(row=>row.kind==='sms')),official=decode(rows.find(row=>row.kind==='telegram'));assert.equal(await transaction(client=>resourceBoundDeliveryPermitted(client,sms,'sms')),true);assert.equal(await transaction(client=>resourceTelegramChannelPermitted(client,official)),true);
      const inApp=rows.find(row=>row.kind==='in-app');await deliverOutbox(await running(inApp));assert.equal((await query('SELECT state FROM outbox WHERE id=$1',[inApp.id])).rows[0].state,'delivered');assert.equal((await query('SELECT count(*)::int AS n FROM notifications WHERE dedupe_key=$1',['outbox:'+inApp.id])).rows[0].n,1);
      first.resource=await publishResource(author,first.resource.id,{versionId:first.version.id},first.resource.version);assert.equal((await query('SELECT count(*)::int AS n FROM resource_notification_events WHERE publication_id=$1',[event.publication_id])).rows[0].n,1);assert.deepEqual(await runResourceNotificationFanout(),{processed:0,queued:0,completed:false});assert.equal((await outboxFor(event)).length,4);
      assert.equal(await transaction(client=>resourceNotificationPermitted(client,{...decode(rows.find(row=>row.kind==='email')),body:'Injected unreviewed copy'})),false);
    });
    await t.test('authenticated, restricted, draft and pending-review resources never become broadcast events',async()=>{
      for(const visibility of ['authenticated','restricted'])assert.equal(await eventFor(await document({visibility})),undefined);
      const draft=await document({published:false});assert.equal(await eventFor(draft),undefined);
      const pending=await document({approved:false,published:false});await assert.rejects(publishResource(author,pending.resource.id,{versionId:pending.version.id},pending.resource.version),error=>error.code==='REVIEW_REQUIRED');assert.equal(await eventFor(pending),undefined);
    });
    await t.test('a queued publication is cancelled before fanout when its scan approval is withdrawn',async()=>{
      const saved=await document(),event=await eventFor(saved);await query("UPDATE assets SET scan_status='pending' WHERE id=$1",[saved.asset.id]);assert.deepEqual(await runResourceNotificationFanout(),{processed:0,queued:0,completed:true});assert.equal((await query('SELECT state FROM resource_notification_events WHERE id=$1',[event.id])).rows[0].state,'cancelled');assert.equal((await outboxFor(event)).length,0);
    });
    const withdrawals=[
      ['publisher deactivation',async()=>query('UPDATE users SET active=false WHERE id=$1',[author.id]),async()=>query('UPDATE users SET active=true WHERE id=$1',[author.id])],
      ['reviewer role revocation',async()=>query("UPDATE users SET role='customer' WHERE id=$1",[reviewer.id]),async()=>query("UPDATE users SET role='admin' WHERE id=$1",[reviewer.id])],
      ['reviewer locale revocation',async()=>query("UPDATE users SET allowed_locales='[\"en\"]'::jsonb WHERE id=$1",[reviewer.id]),async()=>query('UPDATE users SET allowed_locales=$2::jsonb WHERE id=$1',[reviewer.id,JSON.stringify(languages)])],
      ['withdrawn publication',async saved=>updateResource(author,saved.resource.id,{status:'draft'},saved.resource.version)],
      ['later independent rejection',async saved=>reviewResourceVersion(reviewer,saved.resource.id,saved.version.id,{decision:'rejected',note:'Controlled later rejection.'})],
      ['changed metadata',async saved=>query("UPDATE resources SET summary=jsonb_set(summary,'{fa}','\"Unreviewed copy\"'::jsonb) WHERE id=$1",[saved.resource.id])],
      ['quarantined asset',async saved=>query("UPDATE assets SET scan_status='pending' WHERE id=$1",[saved.asset.id])],
      ['withdrawn asset rights',async saved=>updateDamPolicy(author,saved.asset.id,{rightsConfirmed:false,rightsExpiresAt:null,licenseNote:'Controlled distribution withdrawal.'},0)]
    ];
    for(const [label,withdraw,restore]of withdrawals)await t.test('dispatch rechecks '+label+' and suppresses every channel without sending',async()=>{
      const saved=await document(),event=await eventFor(saved);await runResourceNotificationFanout(500);const rows=await outboxFor(event);assert.equal(rows.length,4);
      try{await withdraw(saved);for(const row of rows){await deliverOutbox(await running(row));assert.equal((await query('SELECT state FROM outbox WHERE id=$1',[row.id])).rows[0].state,'cancelled',row.kind+' must cancel');}assert.equal(networkCalls,0);}finally{await restore?.();}
    });
    await t.test('revoked recipient consent and changed official channel are checked again at actual dispatch',async()=>{
      const saved=await document(),event=await eventFor(saved);await runResourceNotificationFanout(500);const rows=await outboxFor(event);assert.equal(rows.length,4);
      const prefs=await getNotificationPreferences(reader);prefs.preferences.topics.content.email.enabled=false;prefs.preferences.topics.content.inApp.enabled=false;await patchNotificationPreferences(reader,{expectedVersion:prefs.version,preferences:prefs.preferences});
      await revokeCommunicationChannel(reader,bindingId,binding.version);process.env.TELEGRAM_CHANNEL_ID='-1000000002';
      for(const row of rows){await deliverOutbox(await running(row));assert.equal((await query('SELECT state FROM outbox WHERE id=$1',[row.id])).rows[0].state,'cancelled');}assert.equal(networkCalls,0);
    });
    await t.test('approved document comments disappear from the public API as soon as scan approval or distribution rights are withdrawn',async()=>{
      const saved=await document(),target={path:'resources/'+saved.resource.slug,locale:'fa'},comment=await createContentComment(reader,{...target,body:'Controlled public resource comment.'});
      await moderateContent(author,'comments',comment.id,{state:'approved',expectedVersion:1});assert.equal((await getEngagement(null,target)).commentCount,1);
      await query("UPDATE assets SET scan_status='pending' WHERE id=$1",[saved.asset.id]);await assert.rejects(getEngagement(null,target),error=>error.status===404&&error.code==='CONTENT_UNAVAILABLE');await assert.rejects(createContentComment(reader,{...target,body:'Blocked on an unavailable document.'}),error=>error.code==='CONTENT_UNAVAILABLE');
      await query("UPDATE assets SET scan_status='clean' WHERE id=$1",[saved.asset.id]);assert.equal((await getEngagement(null,target)).commentCount,1);
      await updateDamPolicy(author,saved.asset.id,{rightsConfirmed:false,rightsExpiresAt:null,licenseNote:'Controlled resource rights withdrawal.'},0);await assert.rejects(getEngagement(null,target),error=>error.code==='CONTENT_UNAVAILABLE');
    });
    await t.test('new event relation preserves least-privilege grant/revoke and existing publication-retention inventory',async()=>{
      const role='resource_test_'+randomUUID().replaceAll('-',''),quoted='"'+role+'"';await control.query('CREATE ROLE '+quoted+' NOLOGIN');
      try{await control.query(`GRANT USAGE ON SCHEMA ${schema} TO ${quoted}`);await control.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${quoted}`);
        const before=(await control.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS runtime,has_table_privilege($1,$2,'TRUNCATE') AS truncate,has_schema_privilege($1,$3,'CREATE') AS create_schema",[role,schema+'.resource_notification_events',schema])).rows[0];assert.deepEqual(before,{runtime:true,truncate:false,create_schema:false});
        await control.query(`REVOKE ALL ON ${schema}.resource_notification_events FROM ${quoted}`);assert.equal((await control.query("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[role,schema+'.resource_notification_events'])).rows[0].allowed,false);
      }finally{await control.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${quoted}`);await control.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${schema} FROM ${quoted}`);await control.query('DROP ROLE '+quoted);}
      const inventory=(await query("SELECT relname FROM pg_class WHERE relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema()) AND relkind='r' AND relname='resource_notification_events'")).rows;assert.equal(inventory.length,1);
      const blockers=await transaction(client=>privacyDependencyBlockers(client,{type:'user',id:author.id}));assert.ok(blockers.some(row=>row.code==='DEPENDENCY_RESOURCE_PUBLICATIONS'),'Publication retention must not disappear during account erasure review.');
      const copied=await transaction(client=>privacyCopiedTextBlockers(client,{type:'user',id:reader.id},[reader.email]));assert.ok(!copied.some(row=>row.code.includes('RESOURCE_NOTIFICATION_EVENTS')),'Fanout receipts must not copy customer contact details.');
    });
    assert.equal(networkCalls,0);
  }finally{globalThis.fetch=originalFetch;for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
}));
