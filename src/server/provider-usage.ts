import type {PoolClient} from 'pg';
import {z} from 'zod';
import {assert,type Actor} from './types';
import {query} from './db';
import {parse} from './http';
import {loadCrmAccess} from './workspace-scopes';
import type {NotificationPayload} from './notification-policy';
export type ProviderAcceptance={provider:string;providerId?:string;usage?:{units:number|null;currency:string|null;actualCost:number|null;estimatedCost:number|null}};
export async function recordProviderUsage(client:PoolClient,row:{id:string;kind:string},payload:NotificationPayload,result:ProviderAcceptance){
  if(!['sms','email','telegram','push'].includes(row.kind))return;
  const usage=result.usage||{units:1,currency:null,actualCost:null,estimatedCost:null};
  const owner=typeof payload.senderId==='string'?payload.senderId:null;
  await client.query(`INSERT INTO provider_usage(outbox_id,actor_id,provider,channel,purpose,status,units,currency,actual_cost,estimated_cost)
    VALUES($1,$2,$3,$4,$5,'accepted',$6,$7,$8,$9) ON CONFLICT(outbox_id) DO NOTHING`,[row.id,owner,result.provider,row.kind,String(payload.purpose||'transactional').slice(0,60),usage.units,usage.currency,usage.actualCost,usage.estimatedCost]);
}
export async function getProviderUsage(actor:Actor,body:unknown={}){
  const input=parse(z.object({days:z.coerce.number().int().min(1).max(365).default(30)}).strict(),body);actor=await loadCrmAccess(actor);
  assert(actor.role!=='customer'&&actor.mfaVerified,403,'USAGE_FORBIDDEN','Staff MFA is required to view service usage.');
  const organization=['admin','superAdmin','analyst'].includes(actor.role),owner=organization?null:actor.id;
  const ai=(await query(`SELECT provider,model,mode,state,count(*)::int AS requests,coalesce(sum(tokens),0)::bigint::text AS tokens,
    sum(actual_usd)::text AS "actualUsd",sum(reserved_usd)::text AS "reservedUsd",count(*) FILTER(WHERE state='complete' AND actual_usd IS NULL)::int AS unpriced
    FROM ai_usage WHERE created_at>=now()-($1*interval '1 day') AND ($2::text IS NULL OR actor_id=$2)
    GROUP BY provider,model,mode,state ORDER BY provider,model,mode,state`,[input.days,owner])).rows;
  const channels=(await query(`SELECT provider,channel,purpose,status,currency,count(*)::int AS requests,sum(units)::int AS units,
    sum(actual_cost)::text AS "actualCost",sum(estimated_cost)::text AS "estimatedCost",count(*) FILTER(WHERE actual_cost IS NULL)::int AS unpriced
    FROM provider_usage WHERE created_at>=now()-($1*interval '1 day') AND ($2::text IS NULL OR actor_id=$2)
    GROUP BY provider,channel,purpose,status,currency ORDER BY provider,channel,purpose`,[input.days,owner])).rows;
  // Delivery status includes failed/unknown jobs even when no billable acceptance
  // was returned. It is intentionally not added to confirmed provider spend.
  const deliveries=organization?(await query("SELECT kind AS channel,state,count(*)::int AS requests FROM outbox WHERE kind IN ('email','sms','telegram','push') AND created_at>=now()-($1*interval '1 day') GROUP BY kind,state ORDER BY kind,state",[input.days])).rows:[];
  return {ai,channels,deliveries,days:input.days,scope:organization?'organization':'self',notes:{currency:'IRR and USD are separate; no implicit currency conversion.',cost:'Null is unknown/unpriced. Reserved or estimated costs are not invoices.',status:'Accepted means the provider accepted the request; it does not prove recipient delivery.',channelScope:'Self scope includes messages you manually initiated; automated jobs are in organization scope.'}};
}
