import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,languages,fixtureHttpSession} from './helpers/crm-recovery-environment.mjs';
import {query,transaction} from '../src/server/db.ts';
import {decrypt,hash} from '../src/server/crypto.ts';
import {requestCustomerOtp,verifyCustomerOtp,customerOtpStatus,canDeliverCustomerOtp} from '../src/server/customer-otp.ts';
import {getEngagement,recordContentView,createContentComment,setContentLike,createContentReport,listContentModeration,moderateContent,contentAnalytics} from '../src/server/engagement.ts';
import {getWorkspace,saveWorkspace,reviewWorkspaceContent,publishWorkspace,getPublicSite,publicationForSource} from '../src/server/workspace.ts';
import {createRequest} from '../src/server/requests.ts';
import {sessionFor,requestEmailVerification} from '../src/server/auth.ts';
import {deliverOutbox} from '../src/server/notifications.ts';
import {getProviderUsage} from '../src/server/provider-usage.ts';
import {staffAssistanceCapabilities,generateStaffAssistance} from '../src/server/ai-assistance.ts';
import {canDeliverStaffAlert} from '../src/server/staff-alerts.ts';
import {defaultNotificationPreferences,getNotificationPreferences,patchNotificationPreferences} from '../src/server/notification-policy.ts';
import {getSettings,listUsers,getManagedUser} from '../src/server/account.ts';
import {runPublicationNotificationFanout} from '../src/server/notification-publications.ts';
import {recordText} from '../src/data/workspace-seed.ts';
import {checksum,editableSnapshot} from '../src/server/workspace-policy.ts';
import {publicNotificationImage} from '../src/server/notification-format.ts';
import {connectCommunicationChannel,communicationVerificationResponse,getCommunicationChannels,updateCommunicationChannel,bindingContext,bindingPreferenceToken,unsubscribeBinding} from '../src/server/communication-channels.ts';

const problem=code=>error=>error.code===code;
const request=()=>new Request('http://localhost:3000/api/v1/auth/otp/request',{headers:{origin:'http://localhost:3000'}});
const otp=async(phone,name='Phone test customer')=>{
  const challenge=await requestCustomerOtp(request(),{phone,name,locale:'fa',consent:true});
  const row=(await query('SELECT * FROM outbox WHERE dedupe_key=$1',['customer-otp:'+hash(challenge.challengeToken)])).rows[0];
  const payload=JSON.parse(decrypt(row.payload.encrypted));return {challenge,row,payload,code:payload.code};
};
const running=async row=>{const lock=randomUUID();await query("UPDATE outbox SET state='running',attempts=attempts+1,lock_token=$2,locked_at=now() WHERE id=$1",[row.id,lock]);return {...row,lock_token:lock,attempts:1};};

test('2.2 customer OTP, real authorization, moderation and service accounting',{timeout:240000},async t=>withCrmRecoveryDatabase('expansion220',async()=>{
  const saved={...process.env};Object.assign(process.env,{KAVENEGAR_API_KEY:'isolated-local-fixture',KAVENEGAR_OTP_TEMPLATE:'local_otp',KAVENEGAR_SENDER:'1000',CUSTOMER_SMS_OTP_ENABLED:'true'});
  const admin=fixtureActor('exp-admin','admin'),publisher=fixtureActor('exp-publisher','publisher'),customer=fixtureActor('exp-customer','customer'),other=fixtureActor('exp-other','customer'),analyst=fixtureActor('exp-analyst','analyst'),support=fixtureActor('exp-support','support'),business=fixtureActor('exp-business','business');
  for(const actor of [admin,publisher,customer,other,analyst,support,business])await insertActor(actor,{scope:actor===business?'all':'assigned',grants:actor===business?{intake:true,contact:true}: {}});
  await getWorkspace(admin);
  let phoneUser,phoneActor;
  try{
    await t.test('unconfigured SMS never claims a sent code and queue stores no plaintext phone or code',async()=>{
      assert.equal(customerOtpStatus().enabled,false);await assert.rejects(requestCustomerOtp(request(),{phone:'09123456789',locale:'fa',consent:true}),problem('SMS_NOT_CONFIGURED'));
      process.env.NOTIFICATIONS_MODE='live';const value=await otp('09123456789');assert.equal(value.challenge.delivery,'queued');assert.equal('code' in value.challenge,false);assert.ok(!JSON.stringify(value.row.payload).includes(value.code));assert.ok(!JSON.stringify(value.row.payload).includes('09123456789'));
      await assert.rejects(requestCustomerOtp(request(),{phone:'۰۹۱۲۳۴۵۶۷۸۹',locale:'fa',consent:true}),problem('OTP_COOLDOWN'));
      const results=await Promise.allSettled([verifyCustomerOtp(request(),{challengeToken:value.challenge.challengeToken,code:value.code}),verifyCustomerOtp(request(),{challengeToken:value.challenge.challengeToken,code:value.code})]);
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
      const response=results.find(result=>result.status==='fulfilled').value;phoneUser=(await response.json()).user;assert.equal(phoneUser.role,'customer');assert.equal(phoneUser.email,'');assert.equal(phoneUser.phone,'+989123456789');assert.equal(phoneUser.phoneVerified,true);
      const session=await sessionFor(new Request('http://localhost:3000/',{headers:{cookie:response.headers.get('set-cookie').split(';')[0]}}));phoneActor=session.actor;
      assert.equal((await getSettings(phoneActor)).profile.contactEmail,'');assert.equal((await query('SELECT count(*)::int AS count FROM sessions WHERE user_id=$1',[phoneUser.id])).rows[0].count,1);
      await assert.rejects(requestEmailVerification(session,{locale:'fa'}),problem('EMAIL_REQUIRED'));assert.equal((await query("SELECT 1 FROM outbox WHERE account_id=$1 AND kind='email'",[phoneUser.id])).rowCount,0);
      assert.equal(await transaction(client=>canDeliverCustomerOtp(client,value.payload,'sms')),false,'Consumed proofs must not be sent later by a stalled worker.');
    });
    await t.test('authorized account administrators find a phone-only customer without exposing the internal placeholder email',async()=>{
      for(const q of ['+989123456789','989123456789','09123456789','۰۹۱۲۳۴۵۶۷۸۹','٠٩١٢٣٤٥٦٧٨٩','00989123456789']){
        const result=await listUsers(admin,{kind:'customer',q});assert.equal(result.items.length,1);const item=result.items[0];assert.equal(item.id,phoneUser.id);assert.equal(item.email,'');assert.equal(item.phone,'+989123456789');assert.equal(item.phoneVerified,true);assert.ok(!JSON.stringify(item).includes('@identity.invalid'));
      }
      const detail=await getManagedUser(admin,phoneUser.id);assert.equal(detail.email,'');assert.equal(detail.phone,phoneUser.phone);
      assert.ok(!(await listUsers(admin,{kind:'customer',q:'-'})).items.some(item=>item.id===phoneUser.id),'Punctuation-only search must not expand to every phone account.');
      await assert.rejects(listUsers(phoneActor,{kind:'customer',q:phoneUser.phone}),error=>error.status===403);
    });
    await t.test('five wrong codes persist the attempt budget, expiry and replay fail closed',async()=>{
      const value=await otp('09123456780'),bad=value.code==='000000'?'000001':'000000';
      for(let i=0;i<5;i++)await assert.rejects(verifyCustomerOtp(request(),{challengeToken:value.challenge.challengeToken,code:bad}),problem('OTP_INVALID'));
      await assert.rejects(verifyCustomerOtp(request(),{challengeToken:value.challenge.challengeToken,code:value.code}),problem('OTP_INVALID'));
      const expired=await otp('09123456781');await query("UPDATE customer_otp_challenges SET created_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' WHERE token_hash=$1",[hash(expired.challenge.challengeToken)]);
      await assert.rejects(verifyCustomerOtp(request(),{challengeToken:expired.challenge.challengeToken,code:expired.code}),problem('OTP_INVALID'));
      assert.equal(await transaction(client=>canDeliverCustomerOtp(client,expired.payload,'sms')),false);
    });
    await t.test('a staff identity cannot use the public phone login path',async()=>{
      await query("UPDATE users SET phone_number='+989123456782',phone_verified_at=now() WHERE id=$1",[support.id]);
      const value=await requestCustomerOtp(request(),{phone:'09123456782',locale:'fa',consent:true});assert.equal(value.delivery,'queued');assert.equal((await query('SELECT 1 FROM outbox WHERE dedupe_key=$1',['customer-otp:'+hash(value.challengeToken)])).rowCount,0);
    });
    await t.test('phone-only customer submits a real inquiry without email; guests and unverified email accounts cannot omit it',async()=>{
      const body={kind:'contact',name:phoneUser.name,message:'Controlled inquiry, no customer data.',locale:'fa',consent:{purpose:'request_processing',acceptedAt:new Date().toISOString()}};
      const created=await createRequest(request(),phoneActor,body,'otp-request-'+randomUUID());assert.equal(created.email,'');assert.equal(created.phone,phoneUser.phone);
      await assert.rejects(createRequest(request(),customer,body,'invalid-request-'+randomUUID()),problem('EMAIL_OR_VERIFIED_PHONE'));
      const queued=(await query("SELECT * FROM outbox WHERE dedupe_key LIKE $1",['staff-alert:'+created.id+':received:%'])).rows;
      assert.ok(queued.some(row=>row.account_id===admin.id));assert.ok(queued.some(row=>row.account_id===business.id));assert.ok(!queued.some(row=>row.account_id===support.id));
      const alert=queued.find(row=>row.account_id===business.id&&row.kind==='in-app'),payload=JSON.parse(decrypt(alert.payload.encrypted));assert.ok(!payload.body.includes(phoneUser.phone));
      assert.equal(await transaction(client=>canDeliverStaffAlert(client,payload)),true);
      await query("UPDATE users SET crm_scope='assigned',crm_permissions='{}'::jsonb WHERE id=$1",[business.id]);
      await deliverOutbox(await running(alert));assert.equal((await query('SELECT state FROM outbox WHERE id=$1',[alert.id])).rows[0].state,'cancelled');assert.equal((await query('SELECT 1 FROM notifications WHERE dedupe_key=$1',['outbox:'+alert.id])).rowCount,0);
    });
    await t.test('visits deduplicate, a like is idempotent and comments stay invisible until another publisher approves',async()=>{
      const target={path:'',locale:'fa'};
      await recordContentView(request(),target);await recordContentView(request(),target);assert.equal((await getEngagement(customer,target)).views,1);
      await setContentLike(customer,{...target,liked:true});await setContentLike(customer,{...target,liked:true});assert.equal((await getEngagement(customer,target)).likes,1);
      const submission={...target,body:'این یک نظر آزمایشی برای کنترل انتشار است.'};
      const [comment,retry]=await Promise.all([createContentComment(customer,submission),createContentComment(customer,submission)]);assert.equal(retry.id,comment.id);assert.equal(comment.state,'pending');assert.equal((await getEngagement(null,target)).commentCount,0);
      await assert.rejects(moderateContent(customer,'comments',comment.id,{state:'approved',expectedVersion:1}),problem('MODERATION_FORBIDDEN'));
      const pending=await listContentModeration(publisher,{locale:'fa'});assert.ok(pending.comments.some(row=>row.id===comment.id));
      await moderateContent(publisher,'comments',comment.id,{state:'approved',expectedVersion:1});const visible=await getEngagement(null,target);assert.equal(visible.commentCount,1);assert.equal(visible.comments[0].name,customer.name);assert.equal('email' in visible.comments[0],false);
      assert.equal((await createContentComment(customer,submission)).state,'approved','A retried approved submission must not be mislabeled pending.');
      await query('UPDATE users SET active=false WHERE id=$1',[customer.id]);assert.equal((await getEngagement(null,target)).commentCount,0);await query('UPDATE users SET active=true WHERE id=$1',[customer.id]);
      await assert.rejects(moderateContent(publisher,'comments',comment.id,{state:'rejected',expectedVersion:1}),problem('CONFLICT'));
      const reportInput={...target,commentId:comment.id,reason:'Review controlled test comment.'};const [report,reportRetry]=await Promise.all([createContentReport(other,reportInput),createContentReport(other,reportInput)]);assert.equal(report.id,reportRetry.id);assert.equal(report.state,'pending');await moderateContent(publisher,'reports',report.id,{state:'resolved',expectedVersion:1});
      await moderateContent(publisher,'comments',comment.id,{state:'rejected',expectedVersion:2});assert.equal((await getEngagement(null,target)).commentCount,0);
      const own=await createContentComment(publisher,{...target,body:'Publisher cannot approve this own comment.'});await assert.rejects(moderateContent(publisher,'comments',own.id,{state:'approved',expectedVersion:1}),problem('SELF_REVIEW_FORBIDDEN'));
      for(const path of ['admin','account','auth/login','not-a-real-public-route'])await assert.rejects(getEngagement(null,{path,locale:'fa'}),problem('CONTENT_UNAVAILABLE'));
      const analytics=await contentAnalytics(analyst,{days:30,locale:'fa'});assert.equal(analytics.summary.views,1);assert.equal(analytics.summary.likes,1);assert.equal(analytics.summary.pendingComments,1);
      await assert.rejects(contentAnalytics(customer,{days:30}),problem('REPORT_FORBIDDEN'));
    });
    await t.test('analytics totals include every authorized row beyond the display cap and respect module and locale grants',async()=>{
      await query("INSERT INTO content_visits(path,locale,content_kind,window_start,visitor_hash) SELECT 'research/archive-'||n,'fa','research',now(),$1 FROM generate_series(1,1001) n",['a'.repeat(64)]);
      const data=await contentAnalytics(analyst,{days:30});assert.equal(data.summary.views,1002);assert.equal(data.items.length,1000);assert.equal(data.totalItems,1002);assert.equal(data.truncated,true);
      const limited=await contentAnalytics(support,{days:30});assert.ok(limited.items.every(row=>row.kind!=='research'));assert.equal(limited.summary.views,0);
      const english=fixtureActor('analytics-english','translator',{allowedLocales:['en']});await insertActor(english);await assert.rejects(contentAnalytics(english,{days:30,locale:'fa'}),problem('LOCALE_SCOPE'));assert.equal((await contentAnalytics(english,{days:30})).summary.views,0);
      await query("DELETE FROM content_visits WHERE path LIKE 'research/archive-%'");
    });
    await t.test('news broadcasts require publication review and separate consent, carry a photo/link, and freeze reviewed taxonomy',async()=>{
      const editor=fixtureActor('exp-editor','contentEditor');await insertActor(editor);
      const preferences=await getNotificationPreferences(customer);preferences.preferences.topics.content.email.enabled=true;preferences.preferences.topics.content.inApp.enabled=true;await patchNotificationPreferences(customer,{expectedVersion:preferences.version,preferences:preferences.preferences});
      const id='reviewed-news-220',workspace=await getWorkspace(editor),at=new Date().toISOString(),record={id,collection:'news',title:recordText('Reviewed announcement'),summary:recordText('Announcement reviewed before sharing.'),status:'review',owner:editor.role,tags:['reviewed-tag'],demo:false,history:[],createdAt:at,updatedAt:at,details:{category:'Reviewed category',editorialContent:{schemaVersion:1,body:recordText('Reviewed full content.'),mediaUrl:'/media/official/1719663893.jpg',mediaType:'image',mediaTitle:'Reviewed illustration'}}};
      await saveWorkspace(editor,{state:{...workspace.state,records:[...workspace.state.records,record]},expectedVersion:workspace.version});
      let current=await getWorkspace(admin);await assert.rejects(publishWorkspace(admin,{publication:{id,kind:'news',locale:'fa'},expectedVersion:current.version}),error=>error.status===409);
      assert.equal((await query('SELECT 1 FROM notification_publication_events WHERE document_id=$1',[id])).rowCount,0);
      current=await reviewWorkspaceContent(admin,{bucket:'records',id,locale:'fa',expectedVersion:current.version});await publishWorkspace(admin,{publication:{id,kind:'news',locale:'fa'},expectedVersion:current.version});
      const publication=(await getPublicSite()).publications.find(row=>row.id===id&&row.locale==='fa');assert.deepEqual(publication.taxonomy,{category:'Reviewed category',tags:['reviewed-tag']});
      const event=(await query('SELECT * FROM notification_publication_events WHERE document_id=$1',[id])).rows[0];assert.equal(event.topic,'content');await runPublicationNotificationFanout();
      const jobs=(await query('SELECT * FROM outbox WHERE dedupe_key LIKE $1',[event.id+':%'])).rows;assert.equal(jobs.length,2);for(const row of jobs){const payload=JSON.parse(decrypt(row.payload.encrypted));assert.equal(payload.userId,customer.id);assert.equal(payload.imageUrl,'/media/official/1719663893.jpg');assert.equal(payload.href,'/fa/news/'+id+'/');}
      const next=await getWorkspace(editor),updated=next.state.records.find(row=>row.id===id);updated.tags=['private-draft-tag'];updated.details.category='Private draft category';updated.status='draft';delete updated.approvedBy;delete updated.approvedById;await saveWorkspace(editor,{state:next.state,expectedVersion:next.version});assert.deepEqual((await getPublicSite()).publications.find(row=>row.id===id&&row.locale==='fa').taxonomy,{category:'Reviewed category',tags:['reviewed-tag']});
      const page={id:'taxonomy-page',slug:'taxonomy-page',locale:'fa',title:'Page',summary:'Page summary',status:'draft',version:1,author:editor.role,updatedAt:at,blocks:[],taxonomy:{category:'Pages category',tags:['one']}};const release=publicationForSource(page,'fa'),before=checksum(editableSnapshot(page));page.taxonomy.tags.push('later-draft');assert.deepEqual(release.taxonomy.tags,['one']);assert.notEqual(checksum(editableSnapshot(page)),before,'Taxonomy changes invalidate the review checksum.');
    });
    await t.test('provider acceptance records actual IRR once and unknown AI cost remains null',async()=>{
      const value=await otp('09123456783');await deliverOutbox(await running(value.row),{fetch:async()=>Response.json({return:{status:200},entries:[{messageid:105,cost:450,message:'کد تأیید آزمایشی'}]})});
      const usage=await getProviderUsage(admin,{days:30});const sms=usage.channels.find(row=>row.provider==='kavenegar');assert.equal(sms.actualCost,'450.000000');assert.equal(sms.currency,'IRR');assert.equal(sms.requests,1);
      const id=randomUUID();await query("INSERT INTO ai_usage(id,actor_id,mode,provider,model,state,reserved_usd,actual_usd,tokens) VALUES($1,$2,'text','openrouter','isolated','complete',1,NULL,20)",[id,publisher.id]);
      const own=await getProviderUsage(publisher,{days:30});assert.equal(own.scope,'self');assert.equal(own.ai[0].actualUsd,null);assert.equal(own.ai[0].unpriced,1);assert.equal(own.channels.length,0);
      await assert.rejects(getProviderUsage(customer,{days:30}),problem('USAGE_FORBIDDEN'));
    });
    await t.test('photo delivery includes only public, clean images with current distribution rights',async()=>{
      const id=randomUUID(),href='/api/v1/media/'+id+'/content';await query("INSERT INTO assets(id,owner_id,name,storage_key,mime_type,bytes,sha256,visibility,scan_status,metadata) VALUES($1,$2,'photo.jpg',$3,'image/jpeg',10,$4,'public','pending','{\"rights\":false}')",[id,admin.id,'public/'+id+'.jpg','0'.repeat(64)]);
      assert.equal(await publicNotificationImage(href),undefined);await query("UPDATE assets SET scan_status='clean' WHERE id=$1",[id]);assert.equal(await publicNotificationImage(href),undefined);
      await query("UPDATE assets SET metadata='{\"rights\":true}' WHERE id=$1",[id]);assert.equal(await publicNotificationImage(href),'http://localhost:3000'+href);
      await query("INSERT INTO asset_usage_policies(asset_id,rights_confirmed,rights_expires_at,license_note,updated_by) VALUES($1,true,now()-interval '1 minute','Expired fixture',$2)",[id,admin.id]);assert.equal(await publicNotificationImage(href),undefined);
      assert.equal(await publicNotificationImage('https://untrusted.invalid/image.jpg'),undefined);
    });
    await t.test('recipient unsubscribe disables the new content topic while preserving transactional request preferences',async()=>{
      const connection=await connectCommunicationChannel(phoneActor,{channel:'sms'}),id=connection.binding.id,raw=new URL(connection.verificationUrl).pathname.split('/').filter(Boolean).at(-1),url='http://localhost:3000/api/v1/communication-verification/'+raw;
      const jobs=(await query("SELECT payload FROM outbox WHERE kind='sms' ORDER BY created_at DESC LIMIT 20")).rows.map(row=>JSON.parse(decrypt(row.payload.encrypted))),job=jobs.find(payload=>payload.communicationProof?.bindingId===id);assert.ok(job);
      const view=await(await communicationVerificationResponse(new Request(url),raw)).json();await communicationVerificationResponse(new Request(url,{method:'PATCH',headers:{origin:'http://localhost:3000','content-type':'application/json','x-communication-csrf':view.csrfToken},body:JSON.stringify({confirm:true,code:job.code})}),raw);
      const item=(await getCommunicationChannels(phoneActor)).items.find(row=>row.id===id);item.preferences.topics.content.enabled=true;item.preferences.topics.requests.enabled=true;await updateCommunicationChannel(phoneActor,id,{preferences:item.preferences},item.version);
      const token=await transaction(async client=>bindingPreferenceToken(client,await bindingContext(client,id),'unsubscribe'));await unsubscribeBinding(token);await unsubscribeBinding(token);
      const after=(await getCommunicationChannels(phoneActor)).items.find(row=>row.id===id);assert.equal(after.preferences.topics.content.enabled,false);assert.equal(after.preferences.topics.requests.enabled,true);
    });
    await t.test('all eleven staff roles receive bounded optional assistance and revoked sessions cannot use it',async()=>{
      const roles=['superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support'];
      for(const role of roles){const actor=fixtureActor('ai-cap-'+role.toLowerCase(),role);await insertActor(actor);const caps=await staffAssistanceCapabilities(actor);assert.ok(caps.areas.includes('general'),role);assert.ok(caps.areas.includes('analytics'),role);}
      assert.deepEqual((await staffAssistanceCapabilities(customer)).areas,[]);
      const http=await fixtureHttpSession(publisher);await query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[http.id]);const response=await http.request('/ai/assist/capabilities');assert.equal(response.status,401);
      const oldKey=process.env.OPENROUTER_API_KEY,oldModel=process.env.OPENROUTER_TEXT_MODEL;process.env.OPENROUTER_API_KEY='local-fixture';process.env.OPENROUTER_TEXT_MODEL='test/model';process.env.AI_PROVIDER='openrouter';
      try{await assert.rejects(generateStaffAssistance(publisher,'fixture',{locale:'fa',area:'general',prompt:'Summarize the task.'},undefined,async()=>{await query('UPDATE users SET active=false WHERE id=$1',[publisher.id]);return Response.json({id:'test',choices:[{message:{content:'Proposed text.'}}],usage:{total_tokens:10,cost:0.01}});}),error=>['SESSION_REQUIRED','AI_ASSISTANCE_FORBIDDEN'].includes(error.code));}finally{await query('UPDATE users SET active=true WHERE id=$1',[publisher.id]);if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;if(oldModel===undefined)delete process.env.OPENROUTER_TEXT_MODEL;else process.env.OPENROUTER_TEXT_MODEL=oldModel;}
    });
    await t.test('new content subscriptions default off independently of existing research consent',async()=>{
      const prefs=defaultNotificationPreferences();assert.equal(prefs.topics.content.email.enabled,false);assert.equal(prefs.topics.content.inApp.enabled,false);assert.equal(prefs.topics.requests.inApp.enabled,true);
    });
  }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
}));
