/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
type GroupKind='teams'|'territories';

import type { PoolClient } from 'pg';
import type { WorkspaceRecord } from '../data/workspace-seed';
import type { CrmAccess, CrmPermissions, CrmScope, CrmGroup, CrmAssignee, CrmScopeDirectory } from '../types/crm';
import type { RoleKey } from '../types/domain';
import type { Actor } from './types';
import { z } from "zod";
import { query, transaction, audit } from "./db";
import { assert, HttpError, actorSession } from "./types";
import { config } from "./config";
import { canWorkspace } from "../lib/auth";
import { recordText } from "../data/workspace-seed";
import { parse } from "./http";
import { randomUUID } from "node:crypto";
const crmCollections = new Set(['leads','accounts','contacts','opportunities','activities','quotes','pricebooks','samples','handoffs','partners','tickets','segments','campaigns','inbox','automations','success']);
const isScopedCrmRecord = (record:Pick<WorkspaceRecord,'collection'>) => crmCollections.has(record.collection);
const noCrmPermissions = ():CrmPermissions => ({contact:false,financial:false,baseCost:false,assign:false,intake:false});
const permissionNames = ['contact','financial','baseCost','assign','intake'] as const;
const crmPermissionSchema = z.object({contact:z.boolean(),financial:z.boolean(),baseCost:z.boolean(),assign:z.boolean(),intake:z.boolean()}).partial().strict();
function effectiveCrmAccess(role:RoleKey,scope:unknown,permissions:unknown,teamIds:string[]=[],territoryIds:string[]=[]):CrmAccess {
  const privileged=role==='superAdmin'||role==='admin';
  const flags=noCrmPermissions(),input=permissions&&typeof permissions==='object'?permissions as Record<string,unknown>:{};
  for(const key of permissionNames)flags[key]=privileged||input[key]===true;
  return {scope:privileged?'all':scope==='all'||scope==='team'?scope:'assigned',permissions:flags,teamIds:[...new Set(teamIds)],territoryIds:[...new Set(territoryIds)]};
}
async function loadCrmAccess(actor:Actor,client?:PoolClient):Promise<Actor> {
  const run=(sql:string,args:unknown[])=>client?client.query(sql,args):query(sql,args);
  const binding=actor[actorSession];
  assert(!binding||binding.userId===actor.id,401,'SESSION_REQUIRED','Please sign in again.');
  // Match credential mutations' user -> session lock order. Holding both rows
  // through a write transaction makes revocation and the accepted write serial:
  // a request cannot commit based only on authority captured before body parsing.
  const locked=!!binding&&!!client;
  const user=(await run('SELECT role,active,name,email,quality_scope,allowed_locales,mfa_enabled,crm_scope,crm_permissions FROM users WHERE id=$1'+(locked?' FOR SHARE':''),[actor.id])).rows[0];
  assert(user?.active,401,'SESSION_REQUIRED','Please sign in again.');
  const session=binding?(await run(`SELECT mfa_verified FROM sessions WHERE id=$1 AND user_id=$2
    AND revoked_at IS NULL AND expires_at>clock_timestamp()
    AND last_seen_at>clock_timestamp()-($3*interval '1 minute')`+(locked?' FOR SHARE':''),[binding.id,actor.id,config().idleMinutes])).rows[0]:undefined;
  assert(!binding||session,401,'SESSION_REQUIRED','Please sign in again.');
  const memberships=(await run(`SELECT 'team' AS kind,m.team_id AS id FROM crm_team_memberships m JOIN crm_teams g ON g.id=m.team_id AND g.active WHERE m.user_id=$1 AND m.active
    UNION ALL SELECT 'territory',m.territory_id FROM crm_territory_memberships m JOIN crm_territories g ON g.id=m.territory_id AND g.active WHERE m.user_id=$1 AND m.active`,[actor.id])).rows;
  return {...actor,name:user.name,email:user.email,role:user.role,qualityScope:user.quality_scope,allowedLocales:user.allowed_locales,mfaVerified:actor.mfaVerified&&user.mfa_enabled&&(!binding||session.mfa_verified),
    crmAccess:effectiveCrmAccess(user.role,user.crm_scope,user.crm_permissions,memberships.filter(row=>row.kind==='team').map(row=>row.id),memberships.filter(row=>row.kind==='territory').map(row=>row.id))};
}
function canAccessCrmRecord(actor:Actor,record:Pick<WorkspaceRecord,'collection'|'ownerId'|'assigneeId'|'teamId'|'territoryId'|'requestId'>):boolean {
  if(!isScopedCrmRecord(record))return true;
  const access=actor.crmAccess;if(!access||actor.role==='customer'||!actor.mfaVerified)return false;
  if(access.scope==='all')return true;
  if(record.teamId&&!access.teamIds.includes(record.teamId))return false;
  if(record.territoryId&&!access.territoryIds.includes(record.territoryId))return false;
  if(record.ownerId===actor.id||record.assigneeId===actor.id)return true;
  if(access.scope==='team'&&!!record.teamId&&access.teamIds.includes(record.teamId))return true;
  return !!record.requestId&&!record.ownerId&&!record.assigneeId&&access.permissions.intake;
}
export interface CrmRequestBoundary {id:string;kind:string;qualityQuarantined?:boolean;assigneeId?:string|null;teamId?:string|null;territoryId?:string|null}
const crmRequestCollection = (kind:string):WorkspaceRecord['collection'] => kind === "quality_complaint" || kind === "support_ticket" ? "tickets" : kind === "job_application" ? "hr" : kind === "sample_request" ? "samples" : /partnership|supplier|outsourcing|investment/.test(kind) ? "partners" : kind === "rfq" ? "leads" : "inbox";
function canAccessCrmRequest(actor: Actor, request: CrmRequestBoundary) {
    if (actor.role === "customer" || !actor.mfaVerified || request.qualityQuarantined && !actor.qualityScope || actor.role === "scientificReviewer" && request.kind !== "quality_complaint")
        return false;
    const collection = crmRequestCollection(request.kind);
    return (canWorkspace)(actor.role, "view", collection) && canAccessCrmRecord(actor, { collection, requestId: request.id, assigneeId: request.assigneeId || void 0, teamId: request.teamId || void 0, territoryId: request.territoryId || void 0 });
}
const contactKeys = new Set(["email", "phone", "mobile", "telephone", "fax", "address", "addresses", "billingaddress", "shippingaddress", "taxid", "registrationid", "registrations", "contactdetails", "endpoints", "affiliations", "organization", "customersnapshot", "givenname", "familyname", "legalname", "crmconversion", "crmmergeoperations", "parentid", "accountid", "contactid", "contactids"]);
const financialKeys=new Set(['amount','currency','commercialdraft','price','pricedecimal','unitprice','unitpricedecimal','discount','discountdecimal','discountpercent','discountpercentdecimal','total','totaldecimal','grandtotal','grandtotaldecimal','subtotal','subtotaldecimal','estimate','quoteResponse'.toLowerCase()]);
const costKeys=new Set(['basecost','basecostdecimal','cost','costprice','costpricedecimal','unitcost','unitcostdecimal','margin','marginpercent','purchaseprice','supplierprice']);
const normalizedKey=(key:string)=>key.replace(/[^a-z0-9]/gi,'').toLowerCase();
function protectedKey(actor:Actor,key:string) {
  const permissions=actor.crmAccess?.permissions||noCrmPermissions(),name=normalizedKey(key);
  return !permissions.contact&&contactKeys.has(name)||!permissions.financial&&financialKeys.has(name)||!permissions.baseCost&&costKeys.has(name);
}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function redactCrmValue(actor:Actor,value:unknown):unknown {
  if(Array.isArray(value))return value.map(item=>redactCrmValue(actor,item));
  if(!plain(value))return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!protectedKey(actor,key)).map(([key,item])=>[key,redactCrmValue(actor,item)]));
}
const hiddenRequestTitle = (actor: Actor, record:Pick<WorkspaceRecord,'collection'|'id'|'requestId'>) => isScopedCrmRecord(record) && actor.crmAccess?.permissions.contact !== true && (record.id === record.requestId || ["accounts", "contacts"].includes(record.collection));
function redactCrmRecord(actor:Actor,record:WorkspaceRecord):WorkspaceRecord {
    if (!isScopedCrmRecord(record))
        return record;
    const redacted = redactCrmValue(actor,record) as WorkspaceRecord;
    return hiddenRequestTitle(actor, record) ? { ...redacted, title: (recordText)((record.id === record.requestId ? "Request" : record.collection === "contacts" ? "Contact" : "Account") + " " + record.id) } : redacted;
}
const comparable = (value:unknown):unknown => Array.isArray(value) ? value.map(comparable) : plain(value) ? Object.fromEntries(Object.keys(value).sort().filter((key:string) => value[key] !== void 0).map((key:string) => [key, comparable(value[key])])) : value;
const same = (a:unknown, b:unknown) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
function containsProtected(actor:Actor,value:unknown):boolean {return Array.isArray(value)?value.some(item=>containsProtected(actor,item)):plain(value)&&Object.entries(value).some(([key,item])=>protectedKey(actor,key)||containsProtected(actor,item));}
function preserveCrmProtectedFields(actor:Actor,original:WorkspaceRecord|undefined,proposed:WorkspaceRecord):WorkspaceRecord {
    if (!isScopedCrmRecord(proposed))
        return proposed;
    if (original && hiddenRequestTitle(actor, original) && actor.role !== "scientificReviewer")
        (assert)(same(proposed.title, redactCrmRecord(actor, original).title), 403, "CRM_FIELD_FORBIDDEN", "The customer identity in this request title is restricted.");
    const merge = (before:unknown, after:unknown, path:string):unknown => {
        if (Array.isArray(before) && containsProtected(actor,before)) {
            if (path === "record.details.commercialDraft.lines" && Array.isArray(after)) {
                const identified = (value:unknown):value is Record<string,unknown>&{id:string} => plain(value) && typeof value.id === "string" && value.id.length > 0;
                (assert)(before.every(identified) && after.every(identified), 403, "CRM_FIELD_FORBIDDEN", "Commercial line identities are required to preserve restricted costs.");
                const oldLines = new Map(before.map(line => [line.id, line])), newIds = new Set(after.map(line => line.id));
                (assert)(oldLines.size === before.length && newIds.size === after.length, 403, "CRM_FIELD_FORBIDDEN", "Commercial line identities must be unique.");
                for (const line of before)
                    if (containsProtected(actor, line))
                        (assert)(newIds.has(line.id), 403, "CRM_FIELD_FORBIDDEN", "A line with restricted costs cannot be deleted by this account.");
                return after.map(line => {
                    const previous = oldLines.get(line.id);
                    if (previous && containsProtected(actor, previous))
                        for (const field of ["productId", "variantId", "sku", "unit", "currency"])
                            (assert)(same(previous[field], line[field]), 403, "CRM_FIELD_FORBIDDEN", "Restricted costs cannot be moved to another product, variant or unit.");
                    return merge(previous, line, `${path}[${line.id}]`);
                });
            }
            assert(same(redactCrmValue(actor,before),after),403,'CRM_FIELD_FORBIDDEN',`Restricted fields in ${path} cannot be changed.`);
            return before;
        }
        if (Array.isArray(after))
            return after.map((item,index)=>merge(undefined,item,`${path}[${index}]`));
        if (!plain(before) && !plain(after))
            return after;
        const a=plain(before)?before:{}, b=plain(after)?after:{};
        const result2:Record<string,unknown> = {};
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (protectedKey(actor,key)) {
                (assert)(!Object.hasOwn(b,key) || b[key] === void 0, 403, "CRM_FIELD_FORBIDDEN", `The ${key} field is restricted for this account.`);
                if (Object.hasOwn(a,key))
                    result2[key] = a[key];
            }
            else if (Object.hasOwn(b,key) || containsProtected(actor,a[key])) {
                const value=merge(a[key],b[key],`${path}.${key}`);
                if (value !== void 0)
                    result2[key] = value;
            }
        }
        return result2;
    };
    const result = merge(original,proposed,'record') as WorkspaceRecord;
    if (original && hiddenRequestTitle(actor, original))
        result.title = original.title;
    return result;
}
function normalizeCrmAssignment(actor:Actor,before:WorkspaceRecord|undefined,after:WorkspaceRecord):WorkspaceRecord {
    if (!isScopedCrmRecord(after))
        return after;
    for (const key of ["ownerId", "assigneeId", "teamId", "territoryId"] as const) {
        if (before)
            assert((after[key]||undefined)===(before[key]||undefined),403,'CRM_ASSIGNMENT_COMMAND','Use the dedicated assignment command.');
        else
            assert(!after[key]||key==='ownerId'&&after.ownerId===actor.id,403,'CRM_ASSIGNMENT_COMMAND','New CRM records start with the authenticated owner.');
    }
    if (before)
        assert(after.owner===before.owner,403,'CRM_ASSIGNMENT_COMMAND','Use the dedicated assignment command to change routing roles.');
    return before ? after : { ...after, owner: actor.role, ownerId: actor.id };
}
const groupConfig={teams:{table:'crm_teams',members:'crm_team_memberships',key:'team_id'},territories:{table:'crm_territories',members:'crm_territory_memberships',key:'territory_id'}} as const;
const groupInput=z.object({name:z.string().trim().min(1).max(160),active:z.boolean()}).partial().strict();
function manager(actor:Actor){assert(actor.mfaVerified&&['superAdmin','admin'].includes(actor.role),403,'FORBIDDEN','CRM group management is restricted to administrators.');}
function expected(value:number,current:number){assert(Number.isSafeInteger(value)&&value===current,409,'CONFLICT','This group changed. Refresh and retry.');}
async function groupRows(kind:GroupKind,client?:PoolClient):Promise<CrmGroup[]> {
  const config=groupConfig[kind],run=(sql:string,args:unknown[]=[])=>client?client.query(sql,args):query(sql,args);
  const groups=(await run(`SELECT id,name,active,version FROM ${config.table} ORDER BY name,id`)).rows;
  const members=(await run(`SELECT m.${config.key} AS group_id,u.id AS user_id,u.name,u.role FROM ${config.members} m JOIN users u ON u.id=m.user_id AND u.active WHERE m.active ORDER BY u.name,u.id`)).rows;
  return groups.map(group=>({...group,members:members.filter(member=>member.group_id===group.id).map(member=>({userId:member.user_id,name:member.name,role:member.role}))})) as CrmGroup[];
}
async function listCrmGroups(actor:Actor,kind:GroupKind){actor=await loadCrmAccess(actor);manager(actor);return{items:await groupRows(kind)};}
async function createCrmGroup(actor:Actor,kind:GroupKind,body:unknown) {
    actor = await loadCrmAccess(actor);
    manager(actor);
    const input=parse(z.object({name:z.string().trim().min(1).max(160)}).strict(),body), id=randomUUID(), config=groupConfig[kind];
    try {
        return await (transaction)(async (client) => { await client.query("SELECT * FROM workspace_meta WHERE singleton=true FOR UPDATE"); actor = await loadCrmAccess(actor, client); manager(actor); await client.query(`INSERT INTO ${config.table}(id,name,created_by) VALUES($1,$2,$3)`,[id,input.name,actor.id]); await audit(actor.id,'crm.group.created',kind,id,{},client); return (await groupRows(kind,client)).find(row=>row.id===id)!; });
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "23505")
            throw new HttpError(409, "GROUP_EXISTS", "An active group already uses that name.");
        throw error;
    }
}
async function updateCrmGroup(actor:Actor,kind:GroupKind,id:string,body:unknown,version:number) {
    actor = await loadCrmAccess(actor);
    manager(actor);
    const input=parse(groupInput,body);
    assert(Object.keys(input).length,422,'EMPTY_PATCH','No changes were supplied.');
    const config=groupConfig[kind];
    try {
        return await (transaction)(async (client) => {
            await client.query('SELECT * FROM workspace_meta WHERE singleton=true FOR UPDATE');
            actor = await loadCrmAccess(actor, client);
            manager(actor);
            const row=(await client.query(`SELECT * FROM ${config.table} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
            assert(row,404,'NOT_FOUND','Group not found.');
            expected(version,row.version);
            if (input.active === false) {
                const usage = await client.query(`SELECT id FROM workspace_entities WHERE ${config.key}=$1 AND deleted_at IS NULL AND status<>'archived' UNION ALL SELECT id FROM requests WHERE ${config.key}=$1 UNION ALL SELECT id FROM crm_routing_rules WHERE ${config.key}=$1 AND active LIMIT 1`, [id]);
                (assert)(!usage.rowCount, 409, "CRM_SCOPE_IN_USE", "Reassign linked records and routing rules before archiving this group.");
            }
            await client.query(`UPDATE ${config.table} SET name=$2,active=$3,version=version+1,updated_at=now() WHERE id=$1`,[id,input.name??row.name,input.active??row.active]);
            await audit(actor.id,'crm.group.updated',kind,id,{fields:Object.keys(input)},client);
            return (await groupRows(kind,client)).find(group=>group.id===id)!;
        });
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "23505")
            throw new HttpError(409, "GROUP_EXISTS", "An active group already uses that name.");
        throw error;
    }
}
async function setCrmGroupMember(actor:Actor,kind:GroupKind,id:string,userId:string,active:boolean,version:number) { actor = await loadCrmAccess(actor); manager(actor); const config=groupConfig[kind]; return (transaction)(async (client) => { await client.query('SELECT * FROM workspace_meta WHERE singleton=true FOR UPDATE'); actor = await loadCrmAccess(actor, client); manager(actor); const group=(await client.query(`SELECT version,active FROM ${config.table} WHERE id=$1 FOR UPDATE`,[id])).rows[0]; assert(group?.active,404,'NOT_FOUND','Active group not found.'); expected(version,group.version); const user=(await client.query("SELECT id FROM users WHERE id=$1 AND active AND role<>'customer'",[userId])).rows[0]; assert(user,422,'CRM_STAFF_REQUIRED','Group membership requires an active staff account.'); await client.query(`INSERT INTO ${config.members}(${config.key},user_id,active,granted_by) VALUES($1,$2,$3,$4) ON CONFLICT(${config.key},user_id) DO UPDATE SET active=excluded.active,granted_by=excluded.granted_by,updated_at=now()`,[id,userId,active,actor.id]); await client.query(`UPDATE ${config.table} SET version=version+1,updated_at=now() WHERE id=$1`,[id]); await audit(actor.id,active?'crm.membership.granted':'crm.membership.revoked',kind,id,{userId},client); return (await groupRows(kind,client)).find(row=>row.id===id)!; }); }
async function getCrmScopeDirectory(actor:Actor):Promise<CrmScopeDirectory> {
  actor=await loadCrmAccess(actor);assert(actor.role!=='customer'&&actor.mfaVerified,403,'FORBIDDEN','Staff access is required.');const access=actor.crmAccess!;
  const teams=(await groupRows('teams')).filter(group=>access.scope==='all'||group.active&&access.teamIds.includes(group.id));
  const territories=(await groupRows('territories')).filter(group=>access.scope==='all'||group.active&&access.territoryIds.includes(group.id));
  const members=new Set([actor.id,...teams.flatMap(group=>group.members.map(member=>member.userId)),...territories.flatMap(group=>group.members.map(member=>member.userId))]);
  const users=(await query<{id:string;name:string;role:RoleKey;quality_scope:boolean}>("SELECT id,name,role,quality_scope FROM users WHERE active AND mfa_enabled AND role<>'customer' ORDER BY name,id")).rows;
  const assignees:CrmAssignee[]=users.filter(user=>access.scope==='all'||members.has(user.id)).map(user=>({id:user.id,name:user.name,role:user.role,qualityScope:user.quality_scope,teamIds:teams.filter(group=>group.active&&group.members.some(member=>member.userId===user.id)).map(group=>group.id),territoryIds:territories.filter(group=>group.active&&group.members.some(member=>member.userId===user.id)).map(group=>group.id)}));
  return {access,teams,territories,assignees};
}
export { canAccessCrmRecord, canAccessCrmRequest, createCrmGroup, crmCollections, crmPermissionSchema, crmRequestCollection, effectiveCrmAccess, getCrmScopeDirectory, isScopedCrmRecord, listCrmGroups, loadCrmAccess, noCrmPermissions, normalizeCrmAssignment, preserveCrmProtectedFields, redactCrmRecord, redactCrmValue, setCrmGroupMember, updateCrmGroup };
