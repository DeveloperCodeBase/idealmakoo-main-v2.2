/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
export type CrmAutomationRule = z.infer<typeof ruleSchema>;

export type CrmAutomationAction = CrmAutomationRule['actions'][number];

type EventType = CrmAutomationRule['event'];

interface RuleRow { id:string; data:WorkspaceRecord; created_by:string }

interface UserRow {id:string;name:string;email:string;role:RoleKey;active:boolean;quality_scope:boolean;allowed_locales:string[];mfa_enabled:boolean}

interface EventFacts {id:string;collection:string;status:string;owner:string;tags:string[];kind?:string;due?:string;qualityQuarantined:boolean}

interface EventRow {id:string;event_type:EventType;source:'mutation'|'manual'|'reminder';record_id:string;collection:string;actor_id:string|null;depth:number;parent_event_id:string|null;facts:EventFacts}

interface RunRow {id:string;rule_id:string;event_id:string;creator_id:string;rule_checksum:string;status:'pending'|'succeeded'|'skipped'|'failed';attempts:number;result:ActionResult[];error_code:string|null;created_at:Date;finished_at:Date|null}

interface ActionResult {type:CrmAutomationAction['type'];recordId:string;changed:boolean}

import type { PoolClient } from 'pg';
import type { WorkspaceRecord, WorkspaceActivity } from '../data/workspace-seed';
import type { RoleKey } from '../types/domain';
import type { Actor } from './types';
import { z } from "zod";
import { canWorkspace } from "../lib/auth";
import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "./types";
import { assertWorkspaceActor, hasWorkspacePermission, qualityRecord, checksum, readableRecord } from "./workspace-policy";
import { loadCrmAccess } from "./workspace-scopes";
import { transaction, audit, query } from "./db";
import { validateRecord } from "./workspace-validation";
import { canChangeRecord } from "../components/workspace/permissions";
import { enqueueAccountNotification } from "./notification-policy";
const CRM_AUTOMATION_COLLECTIONS = ['accounts','contacts','leads','opportunities','tickets','samples','handoffs','partners','activities'] as const;
const staffRoles = ['superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support'] as const;
const requestKinds = ['rfq','sample_request','distribution_partnership','supplier_registration','outsourcing_bid','investment_interest','research_proposal','job_application','support_ticket','quality_complaint','factory_visit'] as const;
const events = ['record.created','record.updated','activity.due'] as const;
const MAX_DEPTH = 3;
const completedActivities = ['archived','done','completed','closed','cancelled','resolved'];
const text = (max:number) => z.string().trim().min(1).max(max).refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'Control characters are forbidden');
const actionSchema = z.discriminatedUnion('type',[
  z.object({type:z.literal('create_activity'),title:text(300),owner:z.enum(staffRoles),dueMinutes:z.number().int().min(0).max(525600).optional()}).strict(),
  z.object({type:z.literal('assign_owner'),owner:z.enum(staffRoles)}).strict(),
  z.object({type:z.literal('add_tag'),tag:text(160).refine(tag=>tag!=='quality','Quality quarantine requires its dedicated command')}).strict(),
]);
const ruleSchema = z.object({
  schemaVersion:z.literal(1), enabled:z.boolean(), event:z.enum(events), collection:z.enum(CRM_AUTOMATION_COLLECTIONS),
  conditions:z.object({status:text(64).optional(),owner:z.enum(staffRoles).optional(),tag:text(160).optional(),kind:z.enum(requestKinds).optional()}).strict().default({}),
  actions:z.array(actionSchema).min(1).max(10), maxDepth:z.number().int().min(1).max(MAX_DEPTH).default(1),
}).strict().superRefine((rule,ctx)=>{
  if(rule.event==='activity.due'&&rule.collection!=='activities')ctx.addIssue({code:'custom',path:['collection'],message:'activity.due requires the activities collection'});
  if(rule.conditions.kind&&rule.collection==='activities')ctx.addIssue({code:'custom',path:['conditions','kind'],message:'Activities do not have a public request kind'});
  for(const [index,action] of rule.actions.entries())if('owner' in action&&!canWorkspace(action.owner,'view',action.type==='create_activity'?'activities':rule.collection))ctx.addIssue({code:'custom',path:['actions',index,'owner'],message:'The assigned role cannot access the destination collection'});
});
const localText = (value:string) => ({fa:value,en:value,tr:value,ar:value,ru:value});
const fingerprint = (value:string) => createHash('sha256').update(value).digest('hex');
const bounded = (value:number,maximum:number) => Number.isSafeInteger(value)?Math.max(1,Math.min(maximum,value)):maximum;
const actorFrom = (user:UserRow):Actor => ({id:user.id,name:user.name,email:user.email,role:user.role,qualityScope:user.quality_scope,allowedLocales:user.allowed_locales,mfaVerified:user.mfa_enabled});
function parseCrmAutomationRule(value:unknown):CrmAutomationRule {
  const result=ruleSchema.safeParse(value);
  if(!result.success)throw new HttpError(422,'automation_rule','The automation rule is invalid',result.error.issues.map(issue=>({path:issue.path.join('.'),message:issue.message})));
  return result.data;
}
function authorizeRule(actor:Actor,rule:CrmAutomationRule) {
    assertWorkspaceActor(actor);
    if (!hasWorkspacePermission(actor,'edit','automations') || !hasWorkspacePermission(actor,'view',rule.collection))
        throw new HttpError(403, "automation_scope", "This account cannot configure the selected automation collection");
    for (const action of rule.actions) {
        const permission=action.type==='create_activity'?'create':action.type==='assign_owner'?'assign':'edit';
        if (!hasWorkspacePermission(actor,permission,action.type==='create_activity'?'activities':rule.collection))
            throw new HttpError(403, "automation_scope", "An action exceeds this account\u2019s current permissions");
        if (action.type === "assign_owner" && !actor.crmAccess?.permissions.assign)
            throw new HttpError(403, "automation_scope", "An assignment rule requires current CRM assignment permission");
    }
}
function validateCrmAutomationRecord(record:WorkspaceRecord,actor:Actor) {
  if(record.collection!=='automations')return;
  if(record.details?.automationRule===undefined) {
    if(record.status==='active')throw new HttpError(422,'automation_rule','An active automation must have an explicit supported rule');
    return;
  }
  const rule=parseCrmAutomationRule(record.details.automationRule);
  authorizeRule(actor,rule);
  return rule;
}
async function lockClock(client:PoolClient) {
  const clock=await client.query('SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE');
  if(!clock.rowCount)throw new Error('Workspace migration is missing');
}
async function currentActor(client:PoolClient,id:string):Promise<Actor|null> { const result=await client.query<UserRow>('SELECT id,name,email,role,active,quality_scope,allowed_locales,mfa_enabled FROM users WHERE id=$1 FOR SHARE',[id]); const user=result.rows[0]; return user?.active && user.mfa_enabled ? (loadCrmAccess)(actorFrom(user), client) : null; }
async function factsFor(client:PoolClient,record:WorkspaceRecord,knownKind?:string|null):Promise<EventFacts> {
  let kind:string|undefined=knownKind??undefined;
  if(record.requestId&&knownKind===undefined)kind=(await client.query<{kind:string}>('SELECT kind FROM requests WHERE id=$1',[record.requestId])).rows[0]?.kind;
  return {id:record.id,collection:record.collection,status:record.status,owner:record.owner,tags:record.tags,...(kind?{kind}:{}),...(record.due?{due:record.due}:{}),qualityQuarantined:qualityRecord(record)};
}
function automationConditionsMatch(rule:CrmAutomationRule,facts:EventFacts,at=Date.now()) {
  if(facts.collection!==rule.collection||facts.status==='archived')return false;
  for(const key of ['status','owner','kind'] as const)if(rule.conditions[key]&&rule.conditions[key]!==facts[key])return false;
  if(rule.conditions.tag&&!facts.tags.includes(rule.conditions.tag))return false;
  if(rule.event==='activity.due'&&(!facts.due||!Number.isFinite(Date.parse(facts.due))||Date.parse(facts.due)>at||completedActivities.includes(facts.status)))return false;
  return true;
}
async function activeRules(client:PoolClient,type:EventType,collection:string):Promise<RuleRow[]> {
  return (await client.query<RuleRow>(`SELECT id,data,created_by FROM workspace_entities WHERE bucket='records' AND collection='automations' AND deleted_at IS NULL AND status='active'
    AND data#>>'{details,automationRule,enabled}'='true' AND data#>>'{details,automationRule,event}'=$1 AND data#>>'{details,automationRule,collection}'=$2 ORDER BY id`,[type,collection])).rows;
}
async function queueEvent(client:PoolClient,event:EventRow,selectedRules?:RuleRow[]) {
  const digest=checksum(event);
  const inserted=await client.query('INSERT INTO crm_automation_events(id,event_type,source,record_id,collection,actor_id,depth,parent_event_id,facts,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) ON CONFLICT(id) DO NOTHING RETURNING id',
    [event.id,event.event_type,event.source,event.record_id,event.collection,event.actor_id,event.depth,event.parent_event_id,JSON.stringify(event.facts),digest]);
  if(!inserted.rowCount) {
    const original=await client.query<{payload_hash:string}>('SELECT payload_hash FROM crm_automation_events WHERE id=$1',[event.id]);
    if(original.rows[0]?.payload_hash!==digest)throw new HttpError(409,'automation_event_conflict','The same event identity cannot contain different facts');
    return {id:event.id,queued:0,duplicate:true};
  }
  let queued=0;
  for(const row of selectedRules??await activeRules(client,event.event_type,event.collection)) {
    let rule:CrmAutomationRule;
    try {rule=parseCrmAutomationRule(row.data.details?.automationRule);}catch{continue;}
    if(!rule.enabled||event.depth>=rule.maxDepth||event.depth>=MAX_DEPTH||rule.event!==event.event_type||!automationConditionsMatch(rule,event.facts))continue;
    const result=await client.query('INSERT INTO crm_automation_runs(id,rule_id,event_id,creator_id,rule_checksum) VALUES($1,$2,$3,$4,$5) ON CONFLICT(rule_id,event_id) DO NOTHING RETURNING id',
      [`ar-${fingerprint(`${row.id}:${event.id}`)}`,row.id,event.id,row.created_by,checksum(rule)]);
    queued+=result.rowCount||0;
  }
  return {id:event.id,queued,duplicate:false};
}
async function enqueueCrmAutomationEvent(client:PoolClient,actor:Actor,before?:WorkspaceRecord,after?:WorkspaceRecord,options:{depth?:number;parentEventId?:string;eventId?:string}={}) {
  if(!after||!(CRM_AUTOMATION_COLLECTIONS as readonly string[]).includes(after.collection)||after.status==='archived')return [] as string[];
  const depth=options.depth??0;
  if(!Number.isSafeInteger(depth)||depth<0||depth>MAX_DEPTH)throw new HttpError(422,'automation_depth','Invalid automation event depth');
  const meaningful=(record:WorkspaceRecord)=>({...record,history:undefined,updatedAt:undefined});
  if(before&&checksum(meaningful(before))===checksum(meaningful(after)))return [] as string[];
  const type=before?'record.updated':'record.created';
  const revision=(await client.query<{revision_number:string}>("SELECT revision_number FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL",[after.id])).rows[0]?.revision_number;
  if(!revision)throw new Error('An automation event requires its committed workspace row in the same transaction');
  const id=options.eventId||`ce-${fingerprint(`${after.id}:${revision}:${type}`)}`;
  if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw new HttpError(422,'automation_event','Invalid automation event identifier');
  const result=await queueEvent(client,{id,event_type:type,source:'mutation',record_id:after.id,collection:after.collection,actor_id:actor.id,depth,parent_event_id:options.parentEventId??null,facts:await factsFor(client,after)});
  return [result.id];
}
function readAccess(actor:Actor) {
  assertWorkspaceActor(actor);
  if(!hasWorkspacePermission(actor,'view','automations'))throw new HttpError(403,'forbidden','Automation access is not allowed');
}
async function loadRule(client:PoolClient,actor:Actor,id:string) {
  readAccess(actor);
  const result=await client.query<RuleRow>("SELECT id,data,created_by FROM workspace_entities WHERE bucket='records' AND collection='automations' AND id=$1 AND deleted_at IS NULL",[id]);
  const row=result.rows[0];
  if(!row||!readableRecord(actor,row.data))throw new HttpError(404,'not_found','Automation rule not found');
  return {row,rule:parseCrmAutomationRule(row.data.details?.automationRule)};
}
const dryRunInput=z.object({ruleId:text(160),limit:z.number().int().min(1).max(200).default(100)}).strict();
async function dryRunCrmAutomation(actor:Actor,input:unknown) {
    const parsed=dryRunInput.safeParse(input);
    if (!parsed.success)
        throw new HttpError(422, "validation", "Provide ruleId and an optional limit from 1 to 200");
    return (transaction)(async (client) => {
        actor = await (loadCrmAccess)(actor, client);
        const {row,rule}=await loadRule(client,actor,parsed.data.ruleId);
        authorizeRule(actor,rule);
        const source=await client.query<{data:WorkspaceRecord;kind:string|null}>("SELECT e.data,r.kind FROM workspace_entities e LEFT JOIN requests r ON r.id=e.data->>'requestId' WHERE e.bucket='records' AND e.collection=$1 AND e.deleted_at IS NULL AND e.status<>'archived' ORDER BY e.created_at,e.id LIMIT 5001",[rule.collection]);
        const matches:{id:string;collection:string;title:WorkspaceRecord['title'];status:string;owner:string;actions:CrmAutomationAction[]}[]=[];
        let matchedCount=0;
        for (const item of source.rows.slice(0,5000))
            if (readableRecord(actor,item.data) && automationConditionsMatch(rule,await factsFor(client,item.data,item.kind))) {
                matchedCount++;
                if (matches.length < parsed.data.limit)
                    matches.push({id:item.data.id,collection:item.data.collection,title:item.data.title,status:item.data.status,owner:item.data.owner,actions:rule.actions});
            }
        return { ruleId: row.id, enabled: row.data.status === "active" && rule.enabled, event: rule.event, matchedCount, truncated: source.rows.length > 5e3 || matchedCount > matches.length, matches, note: "Predicate preview of current authorized records. No event is executed and no historical trigger is implied." };
    });
}
const manualInput=z.object({ruleId:text(160),recordIds:z.array(text(160)).min(1).max(100),idempotencyKey:z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/)}).strict();
async function enqueueCrmAutomationRun(actor:Actor,input:unknown) {
    const parsed=manualInput.safeParse(input);
    if (!parsed.success)
        throw new HttpError(422, "validation", "Provide a rule, 1\u2013100 record IDs and a 16\u2013128 character idempotency key");
    const body=parsed.data, recordIds=[...new Set(body.recordIds)].sort(), requestHash=checksum({ruleId:body.ruleId,recordIds});
    return (transaction)(async (client) => {
        await lockClock(client);
        actor = await (loadCrmAccess)(actor, client);
        const {row,rule}=await loadRule(client,actor,body.ruleId);
        authorizeRule(actor,rule);
        const previous=await client.query<{request_hash:string;event_ids:string[]}>('SELECT request_hash,event_ids FROM crm_automation_batches WHERE actor_id=$1 AND idempotency_key=$2',[actor.id,body.idempotencyKey]);
        if (previous.rows[0]) {
            if (previous.rows[0].request_hash !== requestHash)
                throw new HttpError(409, "idempotency_conflict", "The idempotency key was already used with different records or a different rule");
            return { queued: previous.rows[0].event_ids.length, eventIds: previous.rows[0].event_ids, duplicate: true };
        }
        if (row.data.status !== "active" || !rule.enabled)
            throw new HttpError(409, "automation_disabled", "Enable and activate the rule before executing it");
        const creator=await currentActor(client,row.created_by);
        if (!creator)
            throw new HttpError(409, "automation_creator_inactive", "The rule creator is inactive or has no active MFA");
        authorizeRule(creator,rule);
        const eventIds:string[]=[];
        for (const recordId of recordIds) {
            const record=(await client.query<{data:WorkspaceRecord}>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL",[recordId])).rows[0]?.data;
            if (!record || !readableRecord(actor,record) || !readableRecord(creator,record))
                throw new HttpError(404, "not_found", "An automation target is unavailable within the authorized scope");
            const facts=await factsFor(client,record);
            if (!automationConditionsMatch(rule,facts))
                throw new HttpError(409, "automation_no_match", "A selected record no longer matches the rule; refresh the preview");
            const eventId=`ce-${fingerprint(`${actor.id}:${body.idempotencyKey}:${record.id}`)}`;
            await queueEvent(client,{id:eventId,event_type:rule.event,source:'manual',record_id:record.id,collection:record.collection,actor_id:actor.id,depth:0,parent_event_id:null,facts},[row]);
            eventIds.push(eventId);
        }
        await client.query('INSERT INTO crm_automation_batches(actor_id,idempotency_key,request_hash,event_ids) VALUES($1,$2,$3,$4::jsonb)',[actor.id,body.idempotencyKey,requestHash,JSON.stringify(eventIds)]);
        await audit(actor.id,'crm.automation.manual_queued','automation',row.id,{eventIds,recordCount:recordIds.length},client);
        return { queued: eventIds.length, eventIds, duplicate: false };
    });
}
async function appendEvidence(client:PoolClient,actor:Actor,record:WorkspaceRecord,action:string,details:Record<string,unknown>,activity?:WorkspaceActivity) {
  const entry=activity??{id:`event-${randomUUID()}`,text:localText(`${action}: ${record.id}`),actor:actor.role,at:new Date().toISOString(),visibility:'internal' as const};
  await client.query('INSERT INTO workspace_audit(activity_id,actor_id,actor_role,action,bucket,entity_id,activity,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)',[entry.id,actor.id,actor.role,action,'records',record.id,JSON.stringify(entry),JSON.stringify(details)]);
  await audit(actor.id,`crm.${action}`,'records',record.id,details,client);
}
async function writeActionRecord(client:PoolClient,actor:Actor,before:WorkspaceRecord|undefined,record:WorkspaceRecord,event:EventRow,ruleId:string) {
  validateRecord(record);
  if(!readableRecord(actor,record)||before&&!readableRecord(actor,before)||!canChangeRecord(before,record,{role:actor.role,id:actor.id,locale:actor.allowedLocales[0]||'fa',allowedLocales:actor.allowedLocales,qualityScope:actor.qualityScope}))throw new HttpError(403,'automation_scope','The action is outside the creator’s current record scope');
  const evidence:WorkspaceActivity={id:`event-${randomUUID()}`,text:localText(`Automation ${ruleId}: ${before?'updated':'created'} ${record.id}`),actor:actor.role,at:new Date().toISOString(),visibility:'internal'};
  record.history=[...(record.history||[]),evidence];record.updatedAt=evidence.at;
  validateRecord(record);
  if(before) {
    const result=await client.query("UPDATE workspace_entities SET data=$2::jsonb,owner_id=$3,status=$4,revision_number=revision_number+1,updated_by=$5,updated_at=now() WHERE bucket='records' AND id=$1 AND deleted_at IS NULL RETURNING id",[record.id,JSON.stringify(record),record.owner,record.status,actor.id]);
    if(!result.rowCount)throw new HttpError(409,'automation_target_changed','The automation target was deleted');
  } else {
    await client.query("INSERT INTO workspace_entities(bucket,id,collection,status,owner_id,data,created_by,updated_by) VALUES('records',$1,$2,$3,$4,$5::jsonb,$6,$6)",[record.id,record.collection,record.status,record.owner,JSON.stringify(record),actor.id]);
    await client.query('INSERT INTO crm_automation_origins(record_id,rule_id,event_id,depth) VALUES($1,$2,$3,$4)',[record.id,ruleId,event.id,event.depth+1]);
  }
  await appendEvidence(client,actor,record,'automation.action',{ruleId,eventId:event.id,depth:event.depth,change:before?'updated':'created'},evidence);
  await enqueueCrmAutomationEvent(client,actor,before,record,{depth:event.depth+1,parentEventId:event.id});
}
async function executeActions(client:PoolClient,actor:Actor,rule:CrmAutomationRule,ruleId:string,event:EventRow,source:WorkspaceRecord) {
    const results:ActionResult[]=[], next=structuredClone(source);
    for (const [index,action] of rule.actions.entries()) {
        if (action.type === "create_activity") {
            const at=new Date().toISOString(), id=`auto-${fingerprint(`${ruleId}:${event.id}:${index}`).slice(0,48)}`;
            const record = { id, collection: "activities", title: localText(action.title), summary: localText(''), status: "new", owner: action.owner, ownerId: actor.id, ...source.teamId ? { teamId: source.teamId } : {}, ...source.territoryId ? { territoryId: source.territoryId } : {}, tags: qualityRecord(source) ? ["quality"] : [], history: [], demo: false, createdAt: at, updatedAt: at, author: actor.role, authorId: actor.id, linkedId: source.id, priority: source.priority || "normal", details: { automation: { ruleId, eventId: event.id }, ...qualityRecord(source) ? { qualityQuarantined: true } : {} }, ...action.dueMinutes !== void 0 ? { due: new Date(Date.now()+action.dueMinutes*60000).toISOString() } : {} };
            await writeActionRecord(client,actor,undefined,record,event,ruleId);
            results.push({type:action.type,recordId:record.id,changed:true});
        }
        else if (action.type === "assign_owner") {
            const changed=next.owner!==action.owner;
            next.owner = action.owner;
            results.push({type:action.type,recordId:source.id,changed});
        }
        else {
            const changed=!next.tags.includes(action.tag);
            if (changed)
                next.tags.push(action.tag);
            results.push({type:action.type,recordId:source.id,changed});
        }
    }
    if (checksum(source) !== checksum(next))
        await writeActionRecord(client,actor,source,next,event,ruleId);
    if (results.some(result=>result.changed))
        await client.query('UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton=true');
    return results;
}
class SkipRun extends Error {constructor(readonly code:string){super(code);}}
async function runCrmAutomations(limit=20) {
    const totals={processed:0,succeeded:0,skipped:0,failed:0};
    for (let i=0; i < bounded(limit,100); i++) {
        const outcome = await (transaction)(async (client) => {
            await lockClock(client);
            const run=(await client.query<RunRow>("SELECT * FROM crm_automation_runs WHERE status='pending' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
            if (!run)
                return null;
            await client.query('UPDATE crm_automation_runs SET attempts=attempts+1 WHERE id=$1',[run.id]);
            await client.query('SAVEPOINT automation_action');
            let status:'succeeded'|'skipped'|'failed'='succeeded', errorCode:string|null=null, result:ActionResult[]=[];
            try {
                const row=(await client.query<RuleRow>("SELECT id,data,created_by FROM workspace_entities WHERE bucket='records' AND collection='automations' AND id=$1 AND deleted_at IS NULL",[run.rule_id])).rows[0];
                if (!row || row.data.status !== "active")
                    throw new SkipRun("rule_disabled");
                const rule=parseCrmAutomationRule(row.data.details?.automationRule);
                if (!rule.enabled)
                    throw new SkipRun("rule_disabled");
                if (checksum(rule) !== run.rule_checksum || row.created_by !== run.creator_id)
                    throw new SkipRun("rule_changed");
                const actor=await currentActor(client,run.creator_id);
                if (!actor)
                    throw new SkipRun("creator_inactive");
                authorizeRule(actor,rule);
                if (!(readableRecord)(actor, row.data))
                    throw new SkipRun("rule_unavailable");
                const event=(await client.query<EventRow>('SELECT * FROM crm_automation_events WHERE id=$1',[run.event_id])).rows[0];
                if (!event || event.event_type !== rule.event)
                    throw new SkipRun("event_unavailable");
                if (event.depth >= MAX_DEPTH || event.depth >= rule.maxDepth)
                    throw new SkipRun("depth_limit");
                const source=(await client.query<{data:WorkspaceRecord}>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL",[event.record_id])).rows[0]?.data;
                if (!source || !readableRecord(actor,source))
                    throw new SkipRun("target_unavailable");
                if (!automationConditionsMatch(rule,event.facts) || !automationConditionsMatch(rule,await factsFor(client,source)))
                    throw new SkipRun("conditions_changed");
                result = await executeActions(client,actor,rule,row.id,event,source);
                await client.query('RELEASE SAVEPOINT automation_action');
            }
            catch (error) {
                await client.query('ROLLBACK TO SAVEPOINT automation_action');
                await client.query('RELEASE SAVEPOINT automation_action');
                status = error instanceof SkipRun || error instanceof HttpError && error.status === 403 ? "skipped" : "failed";
                errorCode = error instanceof SkipRun ? error.code : error instanceof HttpError ? error.code : "action_failed";
            }
            await client.query('UPDATE crm_automation_runs SET status=$2,result=$3::jsonb,error_code=$4,finished_at=now() WHERE id=$1',[run.id,status,JSON.stringify(result),errorCode]);
            await audit(run.creator_id,`crm.automation.${status}`,'automation',run.rule_id,{runId:run.id,eventId:run.event_id,errorCode,result},client);
            return status;
        });
        if (!outcome)
            break;
        totals.processed++;
        totals[outcome]++;
    }
    return totals;
}
async function enqueueDueActivityReminders(limit=50) {
    return (transaction)(async (client) => {
        await lockClock(client);
        const candidates = await client.query(`SELECT e.data,o.depth AS origin_depth,o.event_id AS origin_event FROM workspace_entities e
      LEFT JOIN crm_automation_origins o ON o.record_id=e.id
      LEFT JOIN crm_activity_reminders r ON r.record_id=e.id AND r.due_value=e.data->>'due' AND r.recipient_key=COALESCE(NULLIF(e.data->>'assigneeId',''),NULLIF(e.data->>'ownerId',''),'role:'||e.owner_id)
      WHERE e.bucket='records' AND e.collection='activities' AND e.deleted_at IS NULL AND e.status<>ALL($1::text[]) AND coalesce(e.data->>'due','')<>''
      AND (r.id IS NULL OR r.status='pending' AND r.next_attempt_at<=now()) ORDER BY e.data->>'due',e.id LIMIT $2`, [completedActivities, bounded(limit,100) * 5]);
        let processed=0, queued = 0, awaitingRecipient=0;
        for (const candidate of candidates.rows) {
            if (processed >= bounded(limit,100))
                break;
            const record=candidate.data, due=Date.parse(record.due||'');
            if (!Number.isFinite(due) || due > Date.now())
                continue;
            const recipientKey = record.assigneeId || record.ownerId || "role:" + record.owner, reminderId = `rem-${fingerprint(`${record.id}:${record.due}:${recipientKey}`)}`, eventId=`ce-${fingerprint(reminderId)}`;
            await client.query("INSERT INTO crm_activity_reminders(id,record_id,due_value,owner_role,scheduled_for,recipient_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(record_id,due_value,recipient_key) DO NOTHING", [reminderId, record.id, record.due, record.owner, new Date(due).toISOString(), recipientKey]);
            const existing=(await client.query<{event_id:string|null}>('SELECT event_id FROM crm_activity_reminders WHERE id=$1',[reminderId])).rows[0];
            if (!existing.event_id) {
                await queueEvent(client,{id:eventId,event_type:'activity.due',source:'reminder',record_id:record.id,collection:'activities',actor_id:null,depth:candidate.origin_depth??0,parent_event_id:candidate.origin_event??null,facts:await factsFor(client,record)});
                await client.query('UPDATE crm_activity_reminders SET event_id=$2 WHERE id=$1',[reminderId,eventId]);
            }
            const candidates2 = (await client.query("SELECT id,name,email,role,active,quality_scope,allowed_locales,mfa_enabled FROM users WHERE active=true AND mfa_enabled=true AND (id=$1 OR ($1::text IS NULL AND role=$2))", [record.assigneeId || record.ownerId || null, record.owner])).rows;
            const recipients = [];
            for (const user of candidates2)
                if ((readableRecord)(await (loadCrmAccess)(actorFrom(user), client), record))
                    recipients.push(user);
            let inserted = 0;
            for (const user of recipients) {
                const outboxId = await (enqueueAccountNotification)(client, { userId: user.id, topic: "requests", channel: "in-app", purpose: "transactional", title: "\u06CC\u0627\u062F\u0622\u0648\u0631\u06CC \u0641\u0639\u0627\u0644\u06CC\u062A / Activity due", body: record.title.fa || record.title.en || record.id, href: `/fa/admin/crm/activities/?id=${encodeURIComponent(record.id)}`, crmRecordId: record.id, activityReminderId: reminderId }, `${reminderId}:${user.id}`);
                if (outboxId) {
                    await client.query("INSERT INTO crm_activity_reminder_deliveries(reminder_id,user_id,outbox_id) VALUES($1,$2,$3) ON CONFLICT(reminder_id,user_id) DO NOTHING", [reminderId, user.id, outboxId]);
                    inserted++;
                }
            }
            await client.query("UPDATE crm_activity_reminders SET status=$2,queued_count=queued_count+$3,last_attempt_at=now(),next_attempt_at=now()+interval '5 minutes' WHERE id=$1", [reminderId, recipients.length ? "queued" : "pending", inserted]);
            if (inserted)
                await (audit)(null, "crm.activity.reminder.queued", "records", record.id, { reminderId, eventId, queued: inserted }, client);
            processed++;
            queued += inserted;
            if (!recipients.length)
                awaitingRecipient++;
        }
        return { processed, queued, awaitingRecipient };
    });
}
const historyInput=z.object({ruleId:text(160).optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
async function listCrmAutomationRuns(actor:Actor,input:unknown={}) {
    actor = await (loadCrmAccess)(actor);
    readAccess(actor);
    const parsed=historyInput.safeParse(input);
    if (!parsed.success)
        throw new HttpError(422, "validation", "Invalid automation history filter");
    const rows=await query<RunRow&{source:EventRow['source'];record_id:string;record:WorkspaceRecord|null;rule:WorkspaceRecord|null}>(`SELECT r.*,e.source,e.record_id,t.data AS record,a.data AS rule FROM crm_automation_runs r JOIN crm_automation_events e ON e.id=r.event_id
    LEFT JOIN workspace_entities t ON t.bucket='records' AND t.id=e.record_id AND t.deleted_at IS NULL
    LEFT JOIN workspace_entities a ON a.bucket='records' AND a.id=r.rule_id AND a.deleted_at IS NULL
    WHERE ($1::text IS NULL OR r.rule_id=$1) ORDER BY r.created_at DESC,r.id DESC LIMIT 1000`,[parsed.data.ruleId??null]);
    const runs=rows.rows.filter(row=>row.rule&&readableRecord(actor,row.rule)&&row.record&&readableRecord(actor,row.record)).slice(0,parsed.data.limit).map(row=>({id:row.id,ruleId:row.rule_id,eventId:row.event_id,recordId:row.record_id,source:row.source,status:row.status,attempts:row.attempts,result:row.result,errorCode:row.error_code,createdAt:row.created_at.toISOString(),finishedAt:row.finished_at?.toISOString()??null}));
    return { runs };
}
export { CRM_AUTOMATION_COLLECTIONS, automationConditionsMatch, dryRunCrmAutomation, enqueueCrmAutomationEvent, enqueueCrmAutomationRun, enqueueDueActivityReminders, listCrmAutomationRuns, parseCrmAutomationRule, runCrmAutomations, validateCrmAutomationRecord };
