import { lockWorkspace } from "./workspace";
import type {RoleKey} from '../types/domain';
import type {Locale} from '../lib/i18n';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
export type NotificationTopic=typeof notificationTopics[number];

export type NotificationChannel='email'|'in-app';

export type NotificationFrequency='instant'|'daily'|'weekly';

export type NotificationPreferences=z.infer<typeof notificationPreferencesSchema>;

export type ChannelPolicy=z.infer<typeof channelSchema>;

type PreferencesRow={user_id:string;version:number;preferences:NotificationPreferences};

type Recipient={id:string;email:string;email_verified:boolean;active:boolean;portal:Record<string,unknown>|null;settings:Record<string,unknown>|null;name:string;role:RoleKey;mfa_enabled:boolean;quality_scope:boolean;allowed_locales:Locale[]};

export type PolicyOutboxRow={id:string;kind:string;payload:Record<string,unknown>;attempts:number;lock_token:string};

export type AccountNotification={staffAlert?:boolean;staffAlertReference?:string;staffAlertKind?:string;imageUrl?:string;userId:string;topic:NotificationTopic;channel:NotificationChannel;purpose:'transactional'|'marketing';title:string;body:string;href?:string;requestId?:string;campaignDeliveryId?:string;publicationEventId?:string;resourcePublicationEventId?:string;crmRecordId?:string;senderId?:string;activityReminderId?:string;surveyInvitationId?:string;companyCertificateAlertId?:string;crmTaskOccurrenceId?:string};

export type NotificationPayload=Record<string,unknown>;

export type NotificationDecision={action:'send';payload:NotificationPayload;marketing:boolean}|{action:'cancel';code:string}|{action:'defer';until:Date;code:string}|{action:'batch';until:Date;frequency:'daily'|'weekly'};
type Decision=NotificationDecision;

export type PreparedNotification={action:'send';payload:NotificationPayload;marketing:boolean}|{action:'handled'};

import type { PoolClient } from 'pg';
import type { Actor } from './types';
import { z } from "zod";
import { assert, HttpError } from "./types";
import { transaction, audit, query } from "./db";
import { parse } from "./http";
import { decrypt, hash, encrypt } from "./crypto";
import { randomUUID, randomBytes } from "node:crypto";
import { loadCrmAccess } from "./workspace-scopes";
import { readableRecord } from "./workspace-policy";
import { config } from "./config";
import {accountTemplateKey,bindNotificationTemplate,templateDeliveryPayload} from './notification-templates';
const notificationTopics=['requests','products','research','events','content'] as const;
const marketingTopics=['products','research','events','content'] as const;
const clockPattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const channelSchema=z.object({enabled:z.boolean(),frequency:z.enum(['instant','daily','weekly']),quietStart:z.string().regex(clockPattern).nullable(),quietEnd:z.string().regex(clockPattern).nullable()}).strict().refine(value=>(value.quietStart===null&&value.quietEnd===null)||(value.quietStart!==null&&value.quietEnd!==null&&value.quietStart!==value.quietEnd),{message:'Set two different quiet-hour times, or disable both.'});
const topicSchema=z.object({email:channelSchema,inApp:channelSchema}).strict();
const notificationPreferencesSchema=z.object({schemaVersion:z.literal(1),timezone:z.string().min(1).max(80).refine(validTimezone,'Use a valid IANA timezone.'),topics:z.object({requests:topicSchema,products:topicSchema,research:topicSchema,events:topicSchema,content:topicSchema.default({email:{enabled:false,frequency:"instant",quietStart:null,quietEnd:null},inApp:{enabled:false,frequency:"instant",quietStart:null,quietEnd:null}})}).strict()}).strict();
function validTimezone(value:string):boolean{try{if(!/^[A-Za-z0-9_+\-/]+$/.test(value))return false;new Intl.DateTimeFormat('en',{timeZone:value}).format(0);return true;}catch{return false;}}
function emptyChannel(enabled=false):ChannelPolicy{return{enabled,frequency:'instant',quietStart:null,quietEnd:null};}
function defaultNotificationPreferences(timezone='Asia/Tehran'):NotificationPreferences{return{schemaVersion:1,timezone:validTimezone(timezone)?timezone:'Asia/Tehran',topics:{requests:{email:emptyChannel(),inApp:emptyChannel(true)},products:{email:emptyChannel(),inApp:emptyChannel()},research:{email:emptyChannel(),inApp:emptyChannel()},events:{email:emptyChannel(),inApp:emptyChannel()},content:{email:emptyChannel(),inApp:emptyChannel()}}};}
function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function fromLegacy(legacy:Record<string,unknown>,timezone:string):NotificationPreferences{
  const value=defaultNotificationPreferences(timezone);
  const frequency=['instant','daily','weekly'].includes(String(legacy.frequency))?legacy.frequency as NotificationFrequency:'instant';
  const quietStart=typeof legacy.quietStart==='string'&&clockPattern.test(legacy.quietStart)?legacy.quietStart:null;
  const quietEnd=typeof legacy.quietEnd==='string'&&clockPattern.test(legacy.quietEnd)?legacy.quietEnd:null;
  const validQuiet=quietStart!==null&&quietEnd!==null&&quietStart!==quietEnd;
  for(const topic of notificationTopics)for(const channel of ['email','inApp'] as const){
    const explicitlyEnabled=legacy[channel]===true,defaultEnabled=topic==='requests'&&channel==='inApp'&&legacy[channel]!==false;
    value.topics[topic][channel]={enabled:(explicitlyEnabled||defaultEnabled)&&(topic==='content'?legacy.content===true:legacy[topic]!==false),frequency,quietStart:validQuiet?quietStart:null,quietEnd:validQuiet?quietEnd:null};
  }
  return value;
}
async function recipient(client:PoolClient,userId:string):Promise<Recipient|null>{ return (await client.query("SELECT u.id,u.name,u.email,u.email_verified,u.active,u.role,u.mfa_enabled,u.quality_scope,u.allowed_locales,s.portal,s.preferences AS settings FROM users u LEFT JOIN user_settings s ON s.user_id=u.id WHERE u.id=$1", [userId])).rows[0] || null; }
async function ensurePreferences(client:PoolClient,userId:string,lock=false):Promise<PreferencesRow>{
  let row=(await client.query<PreferencesRow>('SELECT user_id,version,preferences FROM notification_preferences WHERE user_id=$1'+(lock?' FOR UPDATE':''),[userId])).rows[0];
  if(!row){const user=await recipient(client,userId);assert(user,404,'NOT_FOUND','Account not found.');const initial=fromLegacy(record(user.portal?.notificationPreferences),String(user.settings?.timezone||'Asia/Tehran'));
    await client.query('INSERT INTO notification_preferences(user_id,preferences) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO NOTHING',[userId,JSON.stringify(initial)]);
    row=(await client.query<PreferencesRow>('SELECT user_id,version,preferences FROM notification_preferences WHERE user_id=$1'+(lock?' FOR UPDATE':''),[userId])).rows[0];
  }
  // Persisted malformed policy must not silently opt a recipient in.
  const parsed=notificationPreferencesSchema.safeParse(row.preferences);assert(parsed.success,503,'NOTIFICATION_POLICY_INVALID','Notification preferences require operator repair.');row.preferences=parsed.data;return row;
}
function dto(row:PreferencesRow,user:Recipient){return{version:row.version,preferences:row.preferences,channels:{email:{configured:process.env.NOTIFICATIONS_MODE==='live'&&!!process.env.SMTP_HOST&&!!process.env.SMTP_FROM,verified:user.email_verified},inApp:{configured:true as const}}};}
async function getNotificationPreferences(actor:Actor){return transaction(async client=>{const user=await recipient(client,actor.id);assert(user?.active,401,'SESSION_REQUIRED','Please sign in again.');return dto(await ensurePreferences(client,actor.id),user);});}
async function savePreferences(client:PoolClient,userId:string,value:NotificationPreferences,source:string,actorId:string|null){
  const before=await ensurePreferences(client,userId,true);
  if(JSON.stringify(before.preferences)===JSON.stringify(value))return before;
  for(const topic of notificationTopics)for(const channel of ['email','inApp'] as const)if(before.preferences.topics[topic][channel].enabled!==value.topics[topic][channel].enabled){
    await client.query('INSERT INTO consent_events(user_id,purpose,accepted,policy_version) VALUES($1,$2,$3,$4)',[userId,`notification:${topic}:${channel}`,value.topics[topic][channel].enabled,'notification-policy-v1']);
  }
  const row=(await client.query<PreferencesRow>('UPDATE notification_preferences SET preferences=$2::jsonb,version=version+1,updated_at=now() WHERE user_id=$1 RETURNING user_id,version,preferences',[userId,JSON.stringify(value)])).rows[0];
  // Re-evaluate buffered items soon when the user changes topic/frequency/timezone.
  await client.query("UPDATE notification_digest_items SET due_at=LEAST(due_at,now()) WHERE user_id=$1 AND state='pending'",[userId]);
  await audit(actorId,'notification.preferences.updated','user',userId,{source,version:row.version},client);return row;
}
async function patchNotificationPreferences(actor:Actor,body:unknown){
  const input=parse(z.object({expectedVersion:z.number().int().min(1),preferences:notificationPreferencesSchema}).strict(),body);
  return transaction(async client=>{const user=await recipient(client,actor.id);assert(user?.active,401,'SESSION_REQUIRED','Please sign in again.');const current=await ensurePreferences(client,actor.id,true);assert(current.version===input.expectedVersion,409,'CONFLICT','Notification preferences changed. Review the current version before saving.');const saved=await savePreferences(client,actor.id,input.preferences,'account-center',actor.id);return dto(saved,user);});
}
async function applyLegacyNotificationPreferences(client:PoolClient,actor:Actor,patch:Record<string,unknown>){
  const user=await recipient(client,actor.id);assert(user?.active,401,'SESSION_REQUIRED','Please sign in again.');const current=await ensurePreferences(client,actor.id,true);
  for(const field of ['quietStart','quietEnd'])if(patch[field]!==undefined)assert(typeof patch[field]==='string'&&clockPattern.test(patch[field] as string),422,'NOTIFICATION_TIME','Use a valid HH:mm time.');
  const merged={...record(user.portal?.notificationPreferences),...patch};
  if(merged.quietStart&&merged.quietEnd)assert(merged.quietStart!==merged.quietEnd,422,'NOTIFICATION_TIME','Quiet-hour start and end must differ.');
  await savePreferences(client,actor.id,fromLegacy(merged,current.preferences.timezone),'legacy-portal',actor.id);
}
const formatters=new Map<string,Intl.DateTimeFormat>();
function localParts(date:Date,timezone:string){let formatter=formatters.get(timezone);if(!formatter){formatter=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formatters.set(timezone,formatter);}const result=Object.fromEntries(formatter.formatToParts(date).map(part=>[part.type,part.value]));return{year:Number(result.year),month:Number(result.month),day:Number(result.day),hour:Number(result.hour),minute:Number(result.minute)};}
const clockMinutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
function isQuietTime(date:Date,policy:ChannelPolicy,timezone:string):boolean{
  if(policy.quietStart===null||policy.quietEnd===null)return false;const local=localParts(date,timezone),at=local.hour*60+local.minute,start=clockMinutes(policy.quietStart),end=clockMinutes(policy.quietEnd);return start<end?at>=start&&at<end:at>=start||at<end;
}
function quietHoursEnd(date:Date,policy:ChannelPolicy,timezone:string):Date{
  if(!isQuietTime(date,policy,timezone))return new Date(date);
  const candidate=new Date(Math.floor(date.getTime()/60000)*60000+60000);
  for(let minute=0;minute<27*60;minute++,candidate.setTime(candidate.getTime()+60000))if(!isQuietTime(candidate,policy,timezone))return candidate;
  throw new HttpError(503,'NOTIFICATION_TIME','No quiet-hour boundary could be resolved.');
}
function nextDigestAt(created:Date,frequency:'daily'|'weekly',timezone:string):Date{
  const local=localParts(created,timezone);let day=new Date(Date.UTC(local.year,local.month-1,local.day+1));
  if(frequency==='weekly')while(day.getUTCDay()!==1)day=new Date(day.getTime()+86400000);
  const target=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),9);
  let estimate=target;
  for(let round=0;round<4;round++){const parts=localParts(new Date(estimate),timezone);const projected=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);estimate+=target-projected;}
  // Validate the target. For rare timezone changes skipping 09:00, use the first
  // valid minute on that local date after 09:00, never an earlier wall-clock hour.
  const expectedDate=[day.getUTCFullYear(),day.getUTCMonth()+1,day.getUTCDate()].join('-');
  for(let offset=-180;offset<=180;offset++){const candidate=new Date(estimate+offset*60000),parts=localParts(candidate,timezone);if([parts.year,parts.month,parts.day].join('-')===expectedDate&&parts.hour*60+parts.minute>=540&&candidate>created)return candidate;}
  throw new HttpError(503,'NOTIFICATION_TIME','The digest time could not be resolved.');
}
function decode(payload:Record<string,unknown>):NotificationPayload{return typeof payload.encrypted==='string'?record(JSON.parse(decrypt(payload.encrypted))):payload;}
function channelKey(channel:NotificationChannel){return channel==='email'?'email':'inApp';}
function topicOf(payload:NotificationPayload):NotificationTopic{return notificationTopics.includes(payload.topic as NotificationTopic)?payload.topic as NotificationTopic:payload.purpose==='marketing'?'products':'requests';}
function policyFor(user:Recipient|null,preferences:NotificationPreferences,channel:NotificationChannel,payload:NotificationPayload,at:Date,created:Date,digest=false):Decision{
  if(!user?.active)return{action:'cancel',code:'CONSENT_REVOKED'};
  const destination=channel==='email'?user.email:user.id;
  if(typeof payload.to==='string'&&(channel==='email'?payload.to.trim().toLowerCase():payload.to)!==destination)return{action:'cancel',code:'RECIPIENT_MISMATCH'};
  if(channel==='email'&&user.email.endsWith('@identity.invalid'))return{action:'cancel',code:'RECIPIENT_UNVERIFIED'};
  if(channel==='email'&&payload.emailHash&&payload.emailHash!==hash(user.email))return{action:'cancel',code:'RECIPIENT_MISMATCH'};
  const marketing=payload.purpose==='marketing',topic=topicOf(payload);
  if(marketing&&topic==='requests')return{action:'cancel',code:'MARKETING_TOPIC'};
  if(marketing&&channel==='email'&&!user.email_verified)return{action:'cancel',code:'RECIPIENT_UNVERIFIED'};
  const policy=preferences.topics[topic][channelKey(channel)];
  if(!policy.enabled)return{action:'cancel',code:'CONSENT_REVOKED'};
  if(policy.frequency!=='instant'){
    const due=quietHoursEnd(nextDigestAt(created,policy.frequency,preferences.timezone),policy,preferences.timezone);
    if(!digest)return{action:'batch',until:due,frequency:policy.frequency};
    if(due>at)return{action:'defer',until:due,code:'DIGEST_SCHEDULE'};
  }
  const end=quietHoursEnd(at,policy,preferences.timezone);if(end>at)return{action:'defer',until:end,code:'QUIET_HOURS'};
  return{action:'send',payload:{...payload,to:destination,topic},marketing};
}
async function resolveNotificationRecipient(channel:string,payload:NotificationPayload,client?:PoolClient){
  const execute=async(connection:PoolClient)=>{
    const marketing=payload.purpose==='marketing';assert(channel==='email'||channel==='in-app',422,marketing?'MARKETING_CHANNEL_UNSUPPORTED':'RECIPIENT_CHANNEL_UNAVAILABLE','This channel has no verified account recipient binding.');
    assert(typeof payload.userId==='string',422,'CONSENT_REQUIRED','Select an account recipient.');const user=await recipient(connection,payload.userId);assert(user?.active,409,'CONSENT_REVOKED','The recipient is unavailable.');
    const endpoint=channel==='email'?user.email:user.id;if(payload.to!==undefined)assert(typeof payload.to==='string'&&(channel==='email'?payload.to.trim().toLowerCase():payload.to)===endpoint,422,'RECIPIENT_MISMATCH','The destination must match the account endpoint.');
    if(marketing&&channel==='email')assert(user.email_verified,409,'RECIPIENT_UNVERIFIED','Verify the account email before marketing.');
    const preferences=(await ensurePreferences(connection,user.id)).preferences,topic=topicOf(payload);assert(!marketing||topic!=='requests',422,'MARKETING_TOPIC','Requests are transactional notifications.');assert(preferences.topics[topic][channelKey(channel)].enabled,409,'CONSENT_REVOKED','The recipient has not enabled this topic and channel.');
    return{to:endpoint,...(channel==='email'?{emailHash:hash(user.email)}:{}),topic};
  };return client?execute(client):transaction(execute);
}
async function enqueueAccountNotification(client:PoolClient,input:AccountNotification,dedupeKey:string){
    assert(input.channel==='email'||input.channel==='in-app',422,'RECIPIENT_CHANNEL_UNAVAILABLE','Unsupported account channel.');
    assert(notificationTopics.includes(input.topic),422,'NOTIFICATION_TOPIC','Unknown notification topic.');
    assert(input.purpose==='marketing'?input.topic!=='requests':input.topic==='requests',422,'NOTIFICATION_TOPIC','Choose a topic matching the notification purpose.');
    (assert)(!input.href || /^\/(?!\/)/.test(input.href) && !/[\\\x00-\x20\x7f]/.test(input.href) && !/%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(input.href), 422, "LINK", "Use a safe local link.");
    assert(input.title.length<=200&&input.body.length>0&&input.body.length<=10000,422,'NOTIFICATION_BODY','Invalid notification content.');
    const user=await recipient(client,input.userId);
    if (!user?.active)
        return null;
    const language = String(user.settings?.language || "fa"), locale = ["fa", "en", "tr", "ar", "ru"].includes(language) ? language : "fa";
    const id=randomUUID(), payload = { ...input, locale, to: input.channel === "email" ? user.email : user.id, subject: input.title, text: input.body, ...input.channel === "email" ? { emailHash: hash(user.email) } : {} };
    const inserted = await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id) VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id", [id, input.channel, JSON.stringify({encrypted:encrypt(JSON.stringify(payload))}), dedupeKey, input.userId]);
    if(inserted.rows[0]?.id&&input.purpose==='transactional')await bindNotificationTemplate(client,id,{key:accountTemplateKey(input,dedupeKey),locale:locale as Locale});
    return inserted.rows[0]?.id || null;
}
async function cancelSource(client:PoolClient,id:string,code:string){
    const changed=await client.query("UPDATE outbox SET state='cancelled',last_error=$2,completed_at=now(),lock_token=NULL WHERE id=$1 AND state='batched' RETURNING id",[id,code]);
    await client.query("UPDATE notification_digest_items SET state='cancelled',completed_at=now() WHERE outbox_id=$1 AND state IN ('pending','batched')",[id]);
    if (changed.rowCount)
        await client.query('INSERT INTO delivery_events(outbox_id,provider,status,detail) VALUES($1,$2,$3,$4)',[id,'policy','suppressed',code]);
    await completeActivityReminderDelivery(client, id, "cancelled");
}
async function handled(client:PoolClient,row:PolicyOutboxRow,decision:Exclude<Decision,{action:'send'}>,payload:NotificationPayload){
    if (decision.action === "cancel") {
        await client.query("UPDATE outbox SET state='cancelled',last_error=$3,completed_at=now(),lock_token=NULL WHERE id=$1 AND lock_token=$2 AND state='running'",[row.id,row.lock_token,decision.code]);
        await client.query('INSERT INTO delivery_events(outbox_id,provider,status,detail) VALUES($1,$2,$3,$4)',[row.id,'policy','suppressed',decision.code]);
        await completeActivityReminderDelivery(client, row.id, "cancelled");
    }
    else if (decision.action === "defer") {
        await client.query("UPDATE outbox SET state='pending',available_at=$3,attempts=GREATEST(attempts-1,0),lock_token=NULL,last_error=$4 WHERE id=$1 AND lock_token=$2 AND state='running'",[row.id,row.lock_token,decision.until,decision.code]);
    }
    else {
        await client.query('INSERT INTO notification_digest_items(outbox_id,user_id,channel,topic,frequency,due_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(outbox_id) DO NOTHING',[row.id,payload.userId,row.kind,topicOf(payload),decision.frequency,decision.until]);
        await client.query("UPDATE outbox SET state='batched',attempts=GREATEST(attempts-1,0),lock_token=NULL,last_error=NULL WHERE id=$1 AND lock_token=$2 AND state='running'",[row.id,row.lock_token]);
        await client.query('INSERT INTO delivery_events(outbox_id,provider,status) VALUES($1,$2,$3)',[row.id,'digest','queued']);
    }
}
const digestCopy={fa:{title:'خلاصهٔ اعلان‌های ایده‌آل ماکو',intro:'اعلان‌های انتخاب‌شده بر اساس ترجیحات شما:',unsubscribe:'لغو ایمیل‌های بازاریابی',more:'مشاهده'},en:{title:'Your Ideal Makoo notification digest',intro:'Updates matching your notification preferences:',unsubscribe:'Unsubscribe from marketing email',more:'View'},tr:{title:'Ideal Makoo bildirim özeti',intro:'Bildirim tercihlerinize uygun güncellemeler:',unsubscribe:'Pazarlama e-postalarından çık',more:'Görüntüle'},ar:{title:'ملخص إشعارات إيدئال ماكو',intro:'تحديثات وفق تفضيلات الإشعارات الخاصة بك:',unsubscribe:'إلغاء رسائل التسويق',more:'عرض'},ru:{title:'Сводка уведомлений Ideal Makoo',intro:'Обновления согласно вашим настройкам уведомлений:',unsubscribe:'Отписаться от рекламных писем',more:'Открыть'}};
function localeOf(user:Recipient){const locale=String(user.settings?.language||'fa');return Object.hasOwn(digestCopy,locale)?locale as keyof typeof digestCopy:'fa';}
async function crmRecipientPermitted(client: PoolClient, user: Recipient, payload: NotificationPayload, outboxId: string, channel: string, manual = false) {
    if(payload.staffAlert && !await (await import('./staff-alerts')).canDeliverStaffAlert(client,payload)) return false;
    if (manual || payload.senderId) {
        const { manualNotificationPermitted } = await import("./crm-audience");
        if (!await manualNotificationPermitted(client, payload, channel))
            return false;
    }
    if (payload.campaignDeliveryId) {
        const { campaignDeliveryPermitted } = await import("./crm-campaigns");
        if (!await campaignDeliveryPermitted(client, outboxId, channel, payload))
            return false;
    }
    if (payload.surveyInvitationId) {
        const { isCrmSurveyDeliveryAuthorized } = await import("./crm-operations");
        if (!await isCrmSurveyDeliveryAuthorized(client, payload))
            return false;
    }
    if (payload.publicationEventId) {
        const { publicationNotificationPermitted } = await import("./notification-publications");
        if (String(user.settings?.language || "fa") !== payload.locale || !await publicationNotificationPermitted(client, payload))
            return false;
    }
    if (payload.resourcePublicationEventId) {
        const {resourceNotificationPermitted}=await import('./notification-resources');
        if(String(user.settings?.language||'fa')!==payload.locale||!await resourceNotificationPermitted(client,payload))return false;
    }
    if (payload.companyCertificateAlertId) {
        const { canDeliverCompanyCertificateAlert } = await import("./company-certificates");
        if (!await canDeliverCompanyCertificateAlert(client, payload))
            return false;
    }
    if (payload.crmTaskOccurrenceId) {
        const { canDeliverCrmTaskReminder } = await import("./crm-operations");
        if (!await canDeliverCrmTaskReminder(client, payload, outboxId))
            return false;
    }
    if (!payload.crmRecordId)
        return true;
    if (typeof payload.crmRecordId !== "string" || !user.active || !user.mfa_enabled || user.role === "customer")
        return false;
    const target = (await client.query("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL", [payload.crmRecordId])).rows[0]?.data;
    if (!target)
        return false;
    const actor = await (loadCrmAccess)({ id: user.id, name: user.name, email: user.email, role: user.role, qualityScope: user.quality_scope, allowedLocales: user.allowed_locales, mfaVerified: user.mfa_enabled }, client);
    if (!(readableRecord)(actor, target))
        return false;
    if (payload.activityReminderId) {
        const reminder = (await client.query("SELECT record_id,due_value,recipient_key FROM crm_activity_reminders WHERE id=$1", [payload.activityReminderId])).rows[0];
        const recipientKey = target.assigneeId || target.ownerId || "role:" + target.owner;
        if (!reminder || reminder.record_id !== target.id || reminder.due_value !== target.due || reminder.recipient_key !== recipientKey || (target.assigneeId || target.ownerId) && recipientKey !== user.id || ["archived", "done", "completed", "closed", "cancelled", "resolved"].includes(target.status))
            return false;
    }
    return true;
}
async function prepareDigest(client:PoolClient,row:PolicyOutboxRow,payload:NotificationPayload,at:Date):Promise<PreparedNotification>{
    const user=await recipient(client,String(payload.userId||''));
    const members = (await client.query("SELECT d.outbox_id,o.payload,o.created_at,o.dedupe_key FROM notification_digest_items d JOIN outbox o ON o.id=d.outbox_id WHERE d.digest_outbox_id=$1 AND d.state='batched' AND o.state='batched' ORDER BY d.created_at,d.outbox_id FOR UPDATE OF d,o", [row.id])).rows;
    if (!user?.active) {
        for (const item of members)
            await cancelSource(client,item.outbox_id,'CONSENT_REVOKED');
        await handled(client,row,{action:'cancel',code:'CONSENT_REVOKED'},payload);
        return { action: "handled" };
    }
    const preferences=(await ensurePreferences(client,user.id)).preferences;
    const ready:NotificationPayload[]=[];
    let marketing=false;
    for (const item of members) {
        const source=decode(item.payload);
        const decision: Decision = await crmRecipientPermitted(client, user, source, item.outbox_id, row.kind, !!item.dedupe_key?.startsWith("manual:")) ? policyFor(user,preferences,row.kind as NotificationChannel,source,at,item.created_at,true) : { action: "cancel", code: "RECIPIENT_SCOPE_REVOKED" };
        if (decision.action === "cancel")
            await cancelSource(client,item.outbox_id,decision.code);
        else if (decision.action === "defer")
            await client.query("UPDATE notification_digest_items SET state='pending',digest_outbox_id=NULL,due_at=$2 WHERE outbox_id=$1",[item.outbox_id,decision.until]);
        else if (decision.action === "send") {
            ready.push(await templateDeliveryPayload(client,decision.payload,item.outbox_id,row.kind));
            marketing = marketing || decision.marketing;
        }
    }
    if (!ready.length) {
        await handled(client,row,{action:'cancel',code:'DIGEST_EMPTY'},payload);
        return { action: "handled" };
    }
    const copy=digestCopy[localeOf(user)], text=copy.intro+'\n\n'+ready.map((entry,index)=>`${index+1}. ${String(entry.subject||entry.title||'Ideal Makoo')}\n${String(entry.text||entry.body||'')}${typeof entry.href==='string'?'\n'+copy.more+': '+config().siteUrl+entry.href:''}`).join('\n\n');
    return { action: "send", marketing, payload: { userId: user.id, to: row.kind === "email" ? user.email : user.id, subject: copy.title, title: copy.title, text, body: text, href: "/" + localeOf(user) + "/account/notifications/", purpose: marketing ? "marketing" : "transactional", digest: true } };
}
async function prepareNotificationDelivery(row:PolicyOutboxRow,at=new Date(),connection?:PoolClient):Promise<PreparedNotification>{
    const prepare=async (client:PoolClient):Promise<PreparedNotification> => {
        await lockWorkspace(client);
        const stored = (await client.query("SELECT created_at,dedupe_key FROM outbox WHERE id=$1 AND lock_token=$2 AND state='running' FOR UPDATE", [row.id, row.lock_token])).rows[0];
        if (!stored)
            return { action: "handled" };
        const payload=decode(row.payload);
        if (payload.customerOtp) {
            const {canDeliverCustomerOtp}=await import('./customer-otp');
            if(!await canDeliverCustomerOtp(client,payload,row.kind)){
                await handled(client,row,{action:'cancel',code:'OTP_EXPIRED'},payload);
                return {action:'handled'};
            }
            return {action:'send',payload,marketing:false};
        }
        if (payload.mfaOtp) {
            const {canDeliverMfaOtp}=await import('./mfa-channel');
            if(!await canDeliverMfaOtp(client,payload,row.kind)){
                await handled(client,row,{action:'cancel',code:'OTP_EXPIRED'},payload);
                return {action:'handled'};
            }
            return {action:'send',payload,marketing:false};
        }
        if (payload.phoneVerification) {
            const {canDeliverPhoneVerification}=await import('./auth');
            if(!await canDeliverPhoneVerification(client,payload,row.kind)){
                await handled(client,row,{action:'cancel',code:'OTP_EXPIRED'},payload);
                return {action:'handled'};
            }
            return {action:'send',payload,marketing:false};
        }
        if (payload.communicationProof || payload.communicationConfirmed) {
            const proof = await import("./communication-channels");
            const allowed = payload.communicationProof ? await proof.canDeliverCommunicationProof(client, payload, row.kind) : await proof.canDeliverCommunicationConfirmation(client, payload, row.kind);
            if (!allowed) {
                await handled(client, row, { action: "cancel", code: "RECIPIENT_UNVERIFIED" }, payload);
                return { action: "handled" };
            }
            return { action: "send", payload, marketing: false };
        }
        if (payload.purpose === "digest" && payload.bindingId) {
            const { prepareBoundDigest } = await import("./binding-notifications");
            return prepareBoundDigest(client, row, payload, at);
        }
        if (payload.channelBinding) {
            const { prepareBoundNotification } = await import("./binding-notifications");
            return prepareBoundNotification(client, row, payload, at, stored.created_at);
        }
        if (payload.publicTelegramChannel) {
            const { publicationTelegramChannelPermitted } = await import("./notification-publications");
            const permitted=payload.resourcePublicationEventId
                ? await (await import('./notification-resources')).resourceTelegramChannelPermitted(client,payload)
                : await publicationTelegramChannelPermitted(client,payload);
            if (row.kind === "telegram" && permitted)
                return { action: "send", payload, marketing: false };
            await handled(client, row, { action: "cancel", code: "PUBLICATION_WITHDRAWN" }, payload);
            return { action: "handled" };
        }
        if (payload.purpose === "digest") {
            if (payload.recipientId && !payload.userId) {
                const { prepareContactDigest } = await import("./contact-notifications");
                return prepareContactDigest(client, row, payload, at);
            }
            return prepareDigest(client,row,payload,at);
        }
        if (payload.contactEndpoint) {
            const { prepareContactNotification } = await import("./contact-notifications");
            return prepareContactNotification(client, row, payload, at, stored.created_at);
        }
        if (payload.contactPreferenceNotice) {
            const { canDeliverContactPreferences } = await import("./contact-notifications");
            if (!await canDeliverContactPreferences(client, payload)) {
                await handled(client, row, { action: "cancel", code: "RECIPIENT_SCOPE_REVOKED" }, payload);
                return { action: "handled" };
            }
        }
        if (stored.dedupe_key?.startsWith("manual:") && (!payload.userId || !payload.senderId)) {
            await handled(client, row, { action: "cancel", code: "RECIPIENT_SCOPE_REVOKED" }, payload);
            return { action: "handled" };
        }
        if (payload.crmEndpointVerification) {
            const { canDeliverCrmEndpointVerification } = await import("./workspace-domain-endpoints");
            if (!await canDeliverCrmEndpointVerification(client, payload)) {
                await handled(client, row, { action: "cancel", code: "RECIPIENT_SCOPE_REVOKED" }, payload);
                return { action: "handled" };
            }
        }
        if (payload.staffInvitationId) {
            const { canDeliverStaffInvitation } = await import("./staff-lifecycle");
            if (!await canDeliverStaffInvitation(client, payload)) {
                await handled(client, row, { action: "cancel", code: "RECIPIENT_SCOPE_REVOKED" }, payload);
                return { action: "handled" };
            }
        }
        if (["sms", "telegram", "push"].includes(row.kind)) {
            await handled(client, row, { action: "cancel", code: "RECIPIENT_UNVERIFIED" }, payload);
            return { action: "handled" };
        }
        if (!payload.userId || !['email','in-app'].includes(row.kind))
            return { action: "send", payload, marketing: false };
        const user=await recipient(client,String(payload.userId));
        if (!user?.active) {
            await handled(client,row,{action:'cancel',code:'CONSENT_REVOKED'},payload);
            return { action: "handled" };
        }
        if (!await crmRecipientPermitted(client, user, payload, row.id, row.kind, !!stored.dedupe_key?.startsWith("manual:"))) {
            await handled(client, row, { action: "cancel", code: "RECIPIENT_SCOPE_REVOKED" }, payload);
            return { action: "handled" };
        }
        const preferences=(await ensurePreferences(client,user.id)).preferences;
        const decision=policyFor(user,preferences,row.kind as NotificationChannel,payload,at,stored.created_at);
        if (decision.action === "send")
            return decision;
        await handled(client,row,decision,payload);
        return { action: "handled" };
    };
    const prepared=async(client:PoolClient):Promise<PreparedNotification>=>{
        try{const result=await prepare(client);if(result.action!=='send')return result;return{...result,payload:await templateDeliveryPayload(client,result.payload,row.id,row.kind)};}
        catch(error){if(error instanceof HttpError&&error.code==='TEMPLATE_INTEGRITY'){await handled(client,row,{action:'cancel',code:'TEMPLATE_INTEGRITY'},{});return{action:'handled'};}throw error;}
    };
    return connection?prepared(connection):transaction(prepared);
}
async function flushNotificationDigests(limit=100){
    assert(Number.isInteger(limit)&&limit>0&&limit<=500,422,'DIGEST_LIMIT','Use a batch size from 1 to 500.');
    return (transaction)(async (client) => {
        // Concurrent SKIP LOCKED scans can otherwise each claim half of one
        // recipient's due items and send two digests. Only bounded assembly is
        // serialized; separate workers still deliver the resulting jobs in parallel.
        const assembly = (await client.query<{acquired:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':notification-digest-assembly',0)) AS acquired")).rows[0];
        if (!assembly.acquired) return { items: 0, batches: 0 };
        const items = (await client.query("SELECT outbox_id,user_id,recipient_id,endpoint_id,endpoint_version,binding_id,channel,frequency FROM notification_digest_items WHERE state='pending' AND due_at<=now() ORDER BY due_at,outbox_id FOR UPDATE SKIP LOCKED LIMIT $1", [limit])).rows;
        const groups=new Map<string,typeof items>();
        for (const item of items) {
            const key = JSON.stringify([item.user_id, item.recipient_id, item.endpoint_id, item.endpoint_version, item.binding_id, item.channel, item.frequency]);
            groups.set(key,[...(groups.get(key)||[]),item]);
        }
        let batches=0;
        for (const group of groups.values()) {
            const chunks = group[0]?.binding_id ? await (await import("./binding-notifications")).partitionBoundDigest(client, group) : Array.from({ length: Math.ceil(group.length / 50) }, (_, index) => group.slice(index * 50, index * 50 + 50));
            for (const chunk of chunks) {
                const id=randomUUID(), first=chunk[0], payload = first.binding_id ? { purpose: "digest", recipientId: first.recipient_id, bindingId: first.binding_id, endpointVersion: first.endpoint_version } : first.user_id ? { purpose: "digest", userId: first.user_id } : { purpose: "digest", recipientId: first.recipient_id, endpointId: first.endpoint_id, endpointVersion: first.endpoint_version };
                const contactId = first.user_id ? null : (await client.query("SELECT contact_id FROM communication_recipients WHERE id=$1", [first.recipient_id])).rows[0]?.contact_id;
                await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id,crm_contact_id) VALUES($1,$2,$3::jsonb,$4,$5,$6)", [id, first.channel, JSON.stringify({encrypted:encrypt(JSON.stringify(payload))}), "digest:" + id, first.user_id, contactId || null]);
                await client.query("UPDATE notification_digest_items SET state='batched',digest_outbox_id=$2 WHERE outbox_id=ANY($1::text[]) AND state='pending'",[chunk.map(item=>item.outbox_id),id]);
                batches++;
            }
        }
        return { items: items.length, batches };
    });
}
async function completeDigestMembers(client:PoolClient,batchId:string,state:'delivered'|'cancelled'|'failed'|'uncertain',provider:string,code?:string){
    const items=(await client.query<{outbox_id:string}>("UPDATE notification_digest_items SET state=$2,completed_at=now() WHERE digest_outbox_id=$1 AND state='batched' RETURNING outbox_id",[batchId,state])).rows;
    for (const item of items) {
        await client.query("UPDATE outbox SET state=$2,last_error=$3,completed_at=now() WHERE id=$1 AND state='batched'",[item.outbox_id,state,code||null]);
        await client.query('INSERT INTO delivery_events(outbox_id,provider,status,detail) VALUES($1,$2,$3,$4)',[item.outbox_id,provider,state==='delivered'?'accepted':state,code||null]);
        await completeActivityReminderDelivery(client, item.outbox_id, state);
    }
}
async function completeActivityReminderDelivery(client: PoolClient, outboxId: string, state: 'delivered'|'cancelled'|'failed'|'uncertain') {
    const { completeCrmTaskReminderDelivery } = await import("./crm-operations");
    await completeCrmTaskReminderDelivery(client, outboxId, state);
    const rows = (await client.query("UPDATE crm_activity_reminder_deliveries SET state=$2,completed_at=now() WHERE outbox_id=$1 AND state='pending' RETURNING reminder_id", [outboxId, state])).rows;
    for (const row of rows)
        await client.query(`UPDATE crm_activity_reminders SET notified_count=s.delivered,
    status=CASE WHEN s.pending>0 THEN 'queued' WHEN s.uncertain>0 THEN 'uncertain' WHEN s.failed>0 THEN 'failed' WHEN s.delivered>0 THEN 'sent' ELSE 'cancelled' END,
    sent_at=CASE WHEN s.pending=0 AND s.uncertain=0 AND s.failed=0 AND s.delivered>0 THEN now() ELSE NULL END
    FROM (SELECT count(*) FILTER(WHERE state='pending')::int AS pending,count(*) FILTER(WHERE state='delivered')::int AS delivered,count(*) FILTER(WHERE state='uncertain')::int AS uncertain,count(*) FILTER(WHERE state='failed')::int AS failed FROM crm_activity_reminder_deliveries WHERE reminder_id=$1) s WHERE id=$1`, [row.reminder_id]);
}
async function marketingUnsubscribe(rowId:string,userId:string,expectedEmail?:string){return transaction(async client=>{
  const user=await recipient(client,userId);assert(user?.active&&user.email_verified,409,'RECIPIENT_UNVERIFIED','Marketing requires a verified account email.');assert(new URL(config().siteUrl).protocol==='https:',503,'UNSUBSCRIBE_HTTPS_REQUIRED','Marketing email requires the HTTPS unsubscribe endpoint.');
  assert(!expectedEmail||expectedEmail===user.email,422,'RECIPIENT_MISMATCH','The account destination changed before sending.');
  const raw=randomBytes(32).toString('base64url');await client.query('INSERT INTO notification_unsubscribe_tokens(token_hash,user_id,email_hash,outbox_id) VALUES($1,$2,$3,$4)',[hash(raw),user.id,hash(user.email),rowId]);
  const url=config().siteUrl+'/api/v1/notifications/unsubscribe/'+raw+'/';return{url,label:digestCopy[localeOf(user)].unsubscribe,headers:{'List-Unsubscribe':`<${url}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}};
});}
function unsubscribePage(done:boolean,valid=true):Response{
  const title=done?'لغو اشتراک انجام شد / Unsubscribed':'لغو ایمیل‌های بازاریابی / Unsubscribe';
  const body=done?'ایمیل‌های بازاریابی این حساب متوقف شدند. تنظیمات درخواست‌های شما و ایمیل‌های امنیتی حفظ می‌شوند. / Marketing email has been disabled. Request and security notifications are unchanged.':valid?'برای توقف ایمیل‌های محصولات، پژوهش و رویدادها دکمه را بزنید. / Confirm to stop product, research and event marketing email.':'این پیوند نامعتبر یا منقضی است. / This link is invalid or expired.';
  const form=!done&&valid?'<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">تأیید لغو / Confirm unsubscribe</button></form>':'';
  return new Response(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body><main><h1>${title}</h1><p>${body}</p>${form}<p lang="tr">Pazarlama e-postalarını iptal et.</p><p lang="ar">إلغاء الاشتراك في رسائل التسويق.</p><p lang="ru">Отписаться от рекламных писем.</p></main></body></html>`,{status:valid?200:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
}
async function unsubscribeResponse(request:Request,raw:string):Promise<Response>{
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw))
        return unsubscribePage(false,false);
    if (request.method === "GET") {
        const row=(await query('SELECT token_hash FROM notification_unsubscribe_tokens WHERE token_hash=$1 AND expires_at>now()',[hash(raw)])).rows[0];
        return unsubscribePage(false,!!row);
    }
    assert(request.method==='POST',405,'METHOD','Use GET or POST.');
    const contentType=request.headers.get('content-type')||'', mediaType = contentType.split(";")[0].trim().toLowerCase();
    (assert)(["application/x-www-form-urlencoded", "multipart/form-data"].includes(mediaType), 415, "CONTENT_TYPE", "Use an encoded unsubscribe form.");
    assert(Number(request.headers.get('content-length')||0)<=8192,413,'BODY_TOO_LARGE','Unsubscribe form is too large.');
    assert(request.body,400,'BODY_REQUIRED','Provide the unsubscribe form.');
    const reader=request.body.getReader(), chunks:Uint8Array[]=[];
    let total=0;
    while (true) {
        const part=await reader.read();
        if (part.done)
            break;
        total += part.value.byteLength;
        if (total > 8192) {
            await reader.cancel();
            throw new HttpError(413, "BODY_TOO_LARGE", "Unsubscribe form is too large.");
        }
        chunks.push(part.value);
    }
    const bytes=Buffer.concat(chunks);
    let pairs:[string,FormDataEntryValue|string][];
    if (mediaType === "multipart/form-data")
        pairs = [...await new Request('http://unsubscribe.local',{method:'POST',headers:{'Content-Type':contentType},body:bytes}).formData()];
    else
        pairs = [...new URLSearchParams(bytes.toString('utf8'))];
    assert(pairs.length===1&&pairs[0][0]==='List-Unsubscribe'&&pairs[0][1]==='One-Click',422,'UNSUBSCRIBE_FORM','Use List-Unsubscribe=One-Click.');
    const changed=await transaction(async client=>{
    const item=(await client.query<{user_id:string;email_hash:string;consumed_at:Date|null}>('SELECT user_id,email_hash,consumed_at FROM notification_unsubscribe_tokens WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',[hash(raw)])).rows[0];if(!item)return false;if(item.consumed_at)return true;
    const user=await recipient(client,item.user_id);await client.query('UPDATE notification_unsubscribe_tokens SET consumed_at=now() WHERE token_hash=$1',[hash(raw)]);
    if(!user||hash(user.email)!==item.email_hash)return true;
    const current=await ensurePreferences(client,item.user_id,true),value=structuredClone(current.preferences);for(const topic of marketingTopics)value.topics[topic].email.enabled=false;
    await savePreferences(client,item.user_id,value,'one-click-unsubscribe',null);await audit(null,'notification.unsubscribed','user',item.user_id,{scope:'marketing-email',source:'rfc8058'},client);return true;
  });
    return unsubscribePage(changed,changed);
}
export { applyLegacyNotificationPreferences, completeActivityReminderDelivery, completeDigestMembers, defaultNotificationPreferences, enqueueAccountNotification, flushNotificationDigests, getNotificationPreferences, isQuietTime, marketingTopics, marketingUnsubscribe, nextDigestAt, notificationPreferencesSchema, notificationTopics, patchNotificationPreferences, prepareNotificationDelivery, quietHoursEnd, resolveNotificationRecipient, unsubscribeResponse, validTimezone };
