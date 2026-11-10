import type {PoolClient} from 'pg';
import type {Actor} from './types';
import type {NotificationPayload} from './notification-policy';
import {enqueueAccountNotification} from './notification-policy';
import {captureBoundEndpoints} from './communication-channels';
import {enqueueBoundNotification} from './binding-notifications';
import {loadCrmAccess,canAccessCrmRequest,canAccessCrmRecord,crmRequestCollection} from './workspace-scopes';
import {canWorkspace} from '../lib/auth';
import type {RoleKey} from '../types/domain';

const labels={fa:{received:'درخواست جدید مشتری',updated:'پیام تازه مشتری',inbox:'ارتباط تازه در صندوق ورودی'},en:{received:'New customer request',updated:'New customer message',inbox:'New inbox communication'},tr:{received:'Yeni müşteri talebi',updated:'Yeni müşteri mesajı',inbox:'Yeni gelen ileti'},ar:{received:'طلب عميل جديد',updated:'رسالة عميل جديدة',inbox:'تواصل جديد في الوارد'},ru:{received:'Новый запрос клиента',updated:'Новое сообщение клиента',inbox:'Новое входящее обращение'}};
type StaffRow={id:string;name:string;email:string;role:RoleKey;quality_scope:boolean;allowed_locales:string[];mfa_enabled:boolean;email_verified:boolean;recipient_id:string|null;language:string};
async function currentStaff(client:PoolClient,user:StaffRow):Promise<Actor>{return loadCrmAccess({id:user.id,name:user.name,email:user.email,role:user.role,qualityScope:user.quality_scope,allowedLocales:user.allowed_locales,mfaVerified:user.mfa_enabled},client);}
async function permitted(client:PoolClient,actor:Actor,reference:string,inbox=false){
  if(!actor.mfaVerified||actor.role==='customer')return false;
  if(inbox){
    const row=(await client.query('SELECT * FROM crm_inbox_items WHERE id=$1',[reference])).rows[0];
    if(!row||row.state==='archived'||row.quality_quarantined&&!actor.qualityScope||!canWorkspace(actor.role,'view','inbox')||!actor.crmAccess?.permissions.contact)return false;
    if(row.request_id){const request=(await client.query('SELECT * FROM requests WHERE id=$1',[row.request_id])).rows[0];return !!request&&actor.allowedLocales.includes(request.locale)&&canAccessCrmRequest(actor,{id:request.id,kind:request.kind,qualityQuarantined:request.quality_quarantined,assigneeId:request.assignee_id,teamId:request.team_id,territoryId:request.territory_id});}
    return canAccessCrmRecord(actor,{collection:'inbox',requestId:row.id,teamId:row.team_id||undefined,territoryId:row.territory_id||undefined});
  }
  const row=(await client.query('SELECT * FROM requests WHERE id=$1',[reference])).rows[0];
  return !!row&&actor.allowedLocales.includes(row.locale)&&canAccessCrmRequest(actor,{id:row.id,kind:row.kind,qualityQuarantined:row.quality_quarantined,assigneeId:row.assignee_id,teamId:row.team_id,territoryId:row.territory_id});
}
export async function canDeliverStaffAlert(client:PoolClient,payload:NotificationPayload){
  if(payload.staffAlert!==true||typeof payload.userId!=='string'||typeof payload.staffAlertReference!=='string')return false;
  const user=(await client.query<StaffRow>("SELECT id,name,email,role,quality_scope,allowed_locales,mfa_enabled,email_verified FROM users WHERE id=$1 AND active AND role<>'customer'",[payload.userId])).rows[0];
  return !!user&&await permitted(client,await currentStaff(client,user),payload.staffAlertReference,payload.staffAlertKind==='inbox');
}
/** Only reference IDs leave the site. Current record authorization is checked
 * when queuing and again at provider dispatch, including delayed/digest jobs. */
export async function enqueueStaffAlerts(client:PoolClient,reference:string,event:'received'|'updated'|'inbox',version=1){
  const users=(await client.query<StaffRow>(`SELECT u.id,u.name,u.email,u.role,u.quality_scope,u.allowed_locales,u.mfa_enabled,u.email_verified,r.id AS recipient_id,coalesce(s.preferences->>'language','fa') AS language
    FROM users u LEFT JOIN user_settings s ON s.user_id=u.id LEFT JOIN communication_recipients r ON r.user_id=u.id AND r.subject_type='user' AND r.active
    WHERE u.active AND u.mfa_enabled AND u.role<>'customer' ORDER BY u.id`)).rows;
  const requestKind=event==='inbox'?null:(await client.query('SELECT kind FROM requests WHERE id=$1',[reference])).rows[0]?.kind;
  const collection=requestKind?crmRequestCollection(requestKind):'inbox';
  const section=collection==='hr'?'hr':'crm/'+(collection==='tickets'?'cases':collection);
  let queued=0;
  for(const user of users){
    if(!await permitted(client,await currentStaff(client,user),reference,event==='inbox'))continue;
    const locale=Object.hasOwn(labels,user.language)?user.language as keyof typeof labels:'fa';
    const title=labels[locale][event],href=`/${locale}/admin/${event==='inbox'?'crm/inbox':section}/?${event==='inbox'?'item':'record'}=${encodeURIComponent(reference)}`;
    const input={topic:'requests' as const,purpose:'transactional' as const,title,body:reference,href,staffAlert:true,staffAlertReference:reference,staffAlertKind:event==='inbox'?'inbox':'request'};
    for(const channel of ['in-app','email'] as const){
      if(channel==='email'&&!user.email_verified)continue;
      if(await enqueueAccountNotification(client,{...input,userId:user.id,channel},`staff-alert:${reference}:${event}:${version}:${user.id}:${channel}`))queued++;
    }
    if(user.recipient_id)for(const endpoint of await captureBoundEndpoints(client,user.recipient_id,['sms','telegram'],'requests')){
      if(await enqueueBoundNotification(client,user.recipient_id,endpoint,input,`staff-alert:${reference}:${event}:${version}:${user.id}:${endpoint.bindingId}`))queued++;
    }
  }
  return queued;
}
