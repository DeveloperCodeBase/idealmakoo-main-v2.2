import type {PoolClient} from 'pg';
import type {Locale} from '../lib/i18n';
import type {NotificationPayload} from './notification-policy';
import {randomUUID} from 'node:crypto';
import {audit,transaction} from './db';
import {assert} from './types';
import {encrypt,hash} from './crypto';
import {resourcePublicationNotice} from './resources';
import {publicationChannelConfiguration} from './notification-publications';
import {enqueueAccountNotification} from './notification-policy';
import {captureBoundEndpoints} from './communication-channels';
import {enqueueBoundNotification} from './binding-notifications';
import {isRecipientCampaignSuppressed} from './crm-audience';

type ResourceEvent={id:string;publication_id:string;locale:Locale;state:'pending'|'completed'|'cancelled';cursor_user_id:string;created_at:Date};
type ResourceNotice=NonNullable<Awaited<ReturnType<typeof resourcePublicationNotice>>>;
const excerpt=(value:string,size:number)=>[...value].length>size?[...value].slice(0,size-1).join('')+'…':value;
function message(notice:ResourceNotice,bound=false){return{title:bound?excerpt(notice.title,100):notice.title.slice(0,200),body:bound?excerpt(notice.summary,300):notice.summary.slice(0,10000),href:notice.href};}

async function currentEvent(client:PoolClient,id:string){
  const event=(await client.query<ResourceEvent>("SELECT * FROM resource_notification_events WHERE id=$1 AND state<>'cancelled'",[id])).rows[0];
  if(!event)return null;
  const notice=await resourcePublicationNotice(client,event.publication_id,event.locale);
  return notice?{event,notice}:null;
}

export async function enqueueResourceNotificationEvent(client:PoolClient,publicationId:string,locale:Locale){
  if(!await resourcePublicationNotice(client,publicationId,locale))return null;
  const id='resource-publication-'+hash(JSON.stringify([publicationId,locale]));
  return(await client.query<{id:string}>(`INSERT INTO resource_notification_events(id,publication_id,locale) VALUES($1,$2,$3)
    ON CONFLICT(publication_id) DO NOTHING RETURNING id`,[id,publicationId,locale])).rows[0]?.id||null;
}

export async function resourceNotificationPermitted(client:PoolClient,payload:NotificationPayload,bound=false){
  if(typeof payload.resourcePublicationEventId!=='string'||payload.publicationEventId!==undefined)return false;
  const current=await currentEvent(client,payload.resourcePublicationEventId);
  if(!current||current.event.locale!==payload.locale)return false;
  const expected=message(current.notice,bound);
  return payload.purpose==='marketing'&&payload.topic==='content'&&payload.title===expected.title&&payload.body===expected.body&&payload.href===expected.href&&payload.imageUrl===undefined;
}

export async function resourceBoundDeliveryPermitted(client:PoolClient,payload:NotificationPayload,channel:string){
  if(!await resourceNotificationPermitted(client,payload,true)||typeof payload.userId!=='string'||typeof payload.recipientId!=='string'||payload.contactId!==undefined)return false;
  const recipient=(await client.query(`SELECT r.id FROM communication_recipients r JOIN users u ON u.id=r.user_id AND u.active
    JOIN resource_notification_events e ON e.id=$3 WHERE r.id=$1 AND r.subject_type='user' AND r.user_id=$2 AND r.active AND u.created_at<=e.created_at`,[payload.recipientId,payload.userId,payload.resourcePublicationEventId])).rows[0];
  return !!recipient&&!await isRecipientCampaignSuppressed(client,'',payload.recipientId,'content',channel);
}

export async function resourceTelegramChannelPermitted(client:PoolClient,payload:NotificationPayload){
  const configured=publicationChannelConfiguration();
  return !!configured&&payload.publicTelegramChannel===true&&payload.to===configured.to&&typeof payload.locale==='string'&&configured.locales.includes(payload.locale)
    &&payload.userId===undefined&&payload.contactId===undefined&&payload.channelBinding===undefined&&await resourceNotificationPermitted(client,payload,true);
}

/** One bounded chunk per worker tick, using the reviewed document version as
 * the idempotency boundary. Only opted-in accounts existing at publication are
 * eligible. Normal channel policy still rechecks consent and quiet hours. */
export async function runResourceNotificationFanout(batchSize=100){
  assert(Number.isInteger(batchSize)&&batchSize>=1&&batchSize<=500,422,'FANOUT_LIMIT','Use a fanout chunk from 1 to 500 accounts.');
  return transaction(async client=>{
    const event=(await client.query<ResourceEvent>("SELECT * FROM resource_notification_events WHERE state='pending' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
    if(!event)return{processed:0,queued:0,completed:false};
    const notice=await resourcePublicationNotice(client,event.publication_id,event.locale);
    if(!notice){await client.query("UPDATE resource_notification_events SET state='cancelled',completed_at=now() WHERE id=$1",[event.id]);return{processed:0,queued:0,completed:true};}
    const users=(await client.query(`SELECT u.id,r.id AS recipient_id,u.email_verified,
      CASE WHEN p.user_id IS NOT NULL THEN coalesce(p.preferences#>>'{topics,content,email,enabled}','false')='true'
        ELSE coalesce(s.portal#>>'{notificationPreferences,email}','false')='true' AND coalesce(s.portal#>>'{notificationPreferences,content}','false')='true' END AS email_enabled,
      CASE WHEN p.user_id IS NOT NULL THEN coalesce(p.preferences#>>'{topics,content,inApp,enabled}','false')='true'
        ELSE coalesce(s.portal#>>'{notificationPreferences,inApp}','false')='true' AND coalesce(s.portal#>>'{notificationPreferences,content}','false')='true' END AS in_app_enabled
      FROM users u JOIN communication_recipients r ON r.user_id=u.id AND r.subject_type='user' AND r.active
      LEFT JOIN user_settings s ON s.user_id=u.id LEFT JOIN notification_preferences p ON p.user_id=u.id
      WHERE u.active AND u.id>$1 AND u.created_at<=$2 AND coalesce(s.preferences->>'language','fa')=$3 ORDER BY u.id LIMIT $4`,[event.cursor_user_id,event.created_at,event.locale,batchSize+1])).rows;
    const chunk=users.slice(0,batchSize);let queued=0;
    for(const user of chunk){
      for(const channel of ['email','in-app'] as const){
        if(channel==='email'?!(user.email_enabled&&user.email_verified):!user.in_app_enabled)continue;
        if(await enqueueAccountNotification(client,{...message(notice),userId:user.id,topic:'content',channel,purpose:'marketing',resourcePublicationEventId:event.id},`${event.id}:${user.id}:${channel}`))queued++;
      }
      for(const reference of await captureBoundEndpoints(client,user.recipient_id,['sms','telegram','push'],'content')){
        if(await enqueueBoundNotification(client,user.recipient_id,reference,{...message(notice,true),topic:'content',purpose:'marketing',resourcePublicationEventId:event.id},`${event.id}:${user.id}:${reference.channel}`))queued++;
      }
    }
    const channel=publicationChannelConfiguration();
    if(channel?.locales.includes(event.locale)){
      const payload={...message(notice,true),to:channel.to,locale:event.locale,purpose:'marketing',topic:'content',resourcePublicationEventId:event.id,publicTelegramChannel:true};
      const result=await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key) VALUES($1,'telegram',$2::jsonb,$3) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id",[randomUUID(),JSON.stringify({encrypted:encrypt(JSON.stringify(payload))}),`${event.id}:official-telegram:${hash(channel.to)}`]);
      if(result.rowCount)queued++;
    }
    const completed=users.length<=batchSize;
    await client.query("UPDATE resource_notification_events SET cursor_user_id=$2,processed_count=processed_count+$3,queued_count=queued_count+$4,state=$5,completed_at=CASE WHEN $5='completed' THEN now() ELSE NULL END WHERE id=$1",[event.id,chunk.at(-1)?.id||event.cursor_user_id,chunk.length,queued,completed?'completed':'pending']);
    if(completed)await audit(null,'notification.resource.expanded','resource',notice.resourceId,{eventId:event.id,locale:event.locale},client);
    return{processed:chunk.length,queued,completed};
  });
}
