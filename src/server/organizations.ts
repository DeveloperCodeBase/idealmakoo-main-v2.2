import {bindNotificationTemplate} from './notification-templates';
import type {PgRow} from './recovered-db-rows';
import type {WorkspaceRecord} from '../data/workspace-seed';
type ManagedOrganizationRow=Pick<PgRow<'customer_organizations'>,'id'|'name'|'city'|'country'|'version'|'crm_account_id'|'crm_link_state'|'crm_linked_at'> & {account_name:string;account_version:number;record_version:string;record:WorkspaceRecord;member_count:number;share_count:number};
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */


import type { PoolClient } from 'pg';
import type { Actor } from './types';
import { z } from "zod";
import { assert, HttpError } from "./types";
import { query, transaction, audit } from "./db";
import { loadCrmAccess } from "./workspace-scopes";
import { lockWorkspace } from "./workspace";
import { recordText } from "../data/workspace-seed";
import { parse, rateLimit } from "./http";
import { randomUUID } from "node:crypto";
import { token, hash, encrypt, decrypt } from "./crypto";
import { config } from "./config";
import { canWorkspace } from "../lib/auth";
import { readableRecord, checksum } from "./workspace-policy";
const fields={name:z.string().trim().min(1).max(200),city:z.string().trim().max(100).default(''),country:z.string().trim().max(100).default('')};
const uuid=(value:string)=>assert(z.string().uuid().safeParse(value).success,404,'NOT_FOUND','Organization not found.');
async function membership(actor:Actor,id:string,client?:PoolClient,lock=false){
  uuid(id);const sql=`SELECT o.*,m.role AS member_role FROM customer_organizations o JOIN organization_memberships m ON m.organization_id=o.id AND m.user_id=$2 AND m.active WHERE o.id=$1 AND o.archived_at IS NULL${lock?' FOR UPDATE OF o':''}`;
  const row=(await (client?client.query(sql,[id,actor.id]):query(sql,[id,actor.id]))).rows[0];assert(row,404,'NOT_FOUND','Organization not found.');return row;
}
function manage(row:{member_role:string}){assert(['owner','admin'].includes(row.member_role),403,'ORGANIZATION_ROLE','Only the organization owner or administrator may manage this action.');}
async function organizationActor(client: PoolClient, actor: Actor) { actor = await (loadCrmAccess)(actor, client); (assert)(actor.role === "customer" || actor.mfaVerified, 403, "MFA_REQUIRED", "Complete staff MFA before managing an organization."); return actor; }
async function getOrganizations(actor:Actor){
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await organizationActor(client, actor);
        const rows = (await client.query(`SELECT o.id,o.name,o.city,o.country,o.version,o.crm_link_state,m.role AS "myRole" FROM customer_organizations o JOIN organization_memberships m ON m.organization_id=o.id AND m.user_id=$1 AND m.active WHERE o.archived_at IS NULL ORDER BY o.created_at`, [actor.id])).rows;
        const organizationIds = rows.map(row => row.id), managedIds = rows.filter(row => ['owner','admin'].includes(row.myRole)).map(row => row.id);
        const members = (await client.query<{organization_id:string;id:string;name:string;email:string;role:"owner"|"admin"|"member"|"viewer";status:"active"}>(`SELECT m.organization_id,u.id,u.name,u.email,m.role,'active' AS status FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=ANY($1::uuid[]) AND m.active ORDER BY m.joined_at`, [organizationIds])).rows;
        const shares = (await client.query<{organization_id:string;request_id:string;permission:"view"|"reply"}>("SELECT organization_id,request_id,permission FROM request_shares WHERE organization_id=ANY($1::uuid[]) AND revoked_at IS NULL", [organizationIds])).rows;
        const invitations = (await client.query<{organization_id:string;id:string;email:string;role:'admin'|'member'|'viewer';expiresAt:Date}>('SELECT organization_id,id,email,role,expires_at AS "expiresAt" FROM organization_invitations WHERE organization_id=ANY($1::uuid[]) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()', [managedIds])).rows;
        const group = <T extends {organization_id:string}>(values:readonly T[]) => {
            const result = new Map<string,Array<Omit<T,'organization_id'>>>();
            for (const { organization_id, ...value } of values) {
                const key = String(organization_id);
                const bucket = result.get(key) || [];
                bucket.push(value);
                result.set(key, bucket);
            }
            return result;
        };
        const memberGroups = group(members), shareGroups = group(shares), invitationGroups = group(invitations);
        return { items: rows.map(row => { const { crm_link_state, ...publicFields } = row, visibleShares = shareGroups.get(row.id) || []; return { ...publicFields, crmLink: { reference: row.id, state: crm_link_state }, members: memberGroups.get(row.id) || [], sharedRequestIds: visibleShares.map(share=>share.request_id), sharePermissions: Object.fromEntries(visibleShares.map(share => [String(share.request_id), share.permission])), invitations: invitationGroups.get(row.id) || [] }; }) };
    });
}
async function provisionPortalAccount(client: PoolClient, actor: Actor, organizationId: string, name: string) { const id = "portal-account-" + organizationId, at = new Date().toISOString(); const record = { id, collection: "accounts", title: (recordText)(name), summary: (recordText)(""), status: "new", owner: "business", tags: ["portal-organization", "unverified"], history: [], demo: false, createdAt: at, updatedAt: at, details: { crmDomain: { schemaVersion: 1, kind: "account", revision: 1 } } }; await client.query("INSERT INTO workspace_entities(bucket,id,collection,status,owner_id,data,created_by,updated_by) VALUES('records',$1,'accounts','new','business',$2::jsonb,$3,$3)", [id, JSON.stringify(record), actor.id]); await client.query("INSERT INTO crm_account_profiles(record_id,display_name,legal_name,activity,lifecycle,registrations,addresses) VALUES($1,$2,$2,'other','prospect','[]'::jsonb,'[]'::jsonb)", [id, name]); return id; }
async function createOrganization(actor:Actor,body:unknown){ const input=parse(z.object(fields).strict(),body); await rateLimit('organization-create:'+actor.id,20,86400); await (transaction)(async (client) => { await (lockWorkspace)(client); actor = await organizationActor(client, actor); const id=randomUUID(), accountId = await provisionPortalAccount(client, actor, id, input.name); await client.query("INSERT INTO customer_organizations(id,name,city,country,owner_id,crm_account_id) VALUES($1,$2,$3,$4,$5,$6)", [id, input.name, input.city, input.country, actor.id, accountId]); await client.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[id,actor.id]); await client.query("INSERT INTO organization_crm_link_events(id,organization_id,account_id,link_state,actor_id,organization_version,account_version,reason) VALUES($1,$2,$3,'pending',$4,1,1,'Customer created a separate, unverified portal CRM prospect.')", [randomUUID(), id, accountId, actor.id]); await client.query("UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton=true"); await (audit)(actor.id, "organization.created", "organization", id, { provisionedAccountId: accountId }, client); }); return getOrganizations(actor); }
async function updateOrganization(actor:Actor,id:string,body:unknown,expected:number){ const input=parse(z.object(fields).partial().strict(),body); await (transaction)(async (client) => { await (lockWorkspace)(client); actor = await organizationActor(client, actor); const row=await membership(actor,id,client,true); manage(row); assert(row.version===expected,409,'CONFLICT','The organization changed. Refresh and retry.'); await client.query('UPDATE customer_organizations SET name=$2,city=$3,country=$4,version=version+1,updated_at=now() WHERE id=$1',[id,input.name??row.name,input.city??row.city,input.country??row.country]); await audit(actor.id,'organization.updated','organization',id,{fields:Object.keys(input)},client); }); return getOrganizations(actor); }
async function deleteOrganization(actor:Actor,id:string,expected:number){ await (transaction)(async (client) => { await (lockWorkspace)(client); actor = await organizationActor(client, actor); const row=await membership(actor,id,client,true); assert(row.owner_id===actor.id,403,'ORGANIZATION_OWNER','Only the owner may archive this organization.'); assert(row.version===expected,409,'CONFLICT','The organization changed.'); await client.query('UPDATE customer_organizations SET archived_at=now(),version=version+1 WHERE id=$1',[id]); await client.query('UPDATE organization_memberships SET active=false,revoked_at=now() WHERE organization_id=$1',[id]); await client.query('UPDATE request_shares SET revoked_at=now() WHERE organization_id=$1',[id]); await client.query('UPDATE organization_invitations SET revoked_at=now() WHERE organization_id=$1 AND accepted_at IS NULL',[id]); await audit(actor.id,'organization.archived','organization',id,{},client); }); return { ok: true }; }
async function inviteOrganizationMember(actor:Actor,id:string,body:unknown){
    const input=parse(z.object({email:z.string().trim().toLowerCase().email().max(254),role:z.enum(['admin','member','viewer']).default('member'),locale:z.enum(['fa','en','tr','ar','ru']).default('fa')}).strict(),body);
    await rateLimit('organization-invite:'+actor.id,30,3600);
    const raw=token();
    await (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await organizationActor(client, actor);
        const row=await membership(actor,id,client,true);
        manage(row);
        assert(input.email!==actor.email.toLowerCase(),422,'ALREADY_MEMBER','You are already a member.');
        assert(row.member_role==='owner'||input.role!=='admin',403,'ORGANIZATION_ROLE','Only the owner may invite an administrator.');
        const member=await client.query('SELECT 1 FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND lower(u.email)=$2 AND m.active',[id,input.email]);
        assert(!member.rowCount,409,'ALREADY_MEMBER','This person is already a member.');
        await client.query('UPDATE organization_invitations SET revoked_at=now() WHERE organization_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL',[id,input.email]);
        const invitationId=randomUUID();
        await client.query("INSERT INTO organization_invitations(id,organization_id,email,role,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '72 hours')",[invitationId,id,input.email,input.role,hash(raw),actor.id]);
        const url=config().siteUrl+'/'+input.locale+'/account/organizations/?invite='+encodeURIComponent(raw);
        const payload={to:input.email,subject:'Ideal Makoo organization invitation',body:`${actor.name} invited you to ${row.name}. Sign in using ${input.email}, then open this link within 72 hours:\n${url}`,purpose:'transactional'};
        const outboxId=randomUUID();
        await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key) VALUES($1,'email',$2::jsonb,$3)",[outboxId,JSON.stringify({encrypted:encrypt(JSON.stringify(payload))}),'organization-invitation:'+invitationId]);
        await bindNotificationTemplate(client,outboxId,{key:'organization_invitation',locale:input.locale,values:{actionUrl:url,organization:row.name,inviter:actor.name}});
        await audit(actor.id,'organization.invited','organization',id,{invitationId,recipientHash:hash(input.email),role:input.role},client);
    });
    return { ok: true, delivery: "queued" };
}
async function acceptOrganizationInvitation(actor:Actor,body:unknown){ const input=parse(z.object({token:z.string().min(32).max(200)}).strict(),body); await rateLimit('organization-accept:'+actor.id,30,3600); await (transaction)(async (client) => { await (lockWorkspace)(client); actor = await organizationActor(client, actor); const lookup=(await client.query('SELECT organization_id FROM organization_invitations WHERE token_hash=$1',[hash(input.token)])).rows[0]; assert(lookup,404,'INVITATION','This invitation is not valid.'); const organization=(await client.query('SELECT * FROM customer_organizations WHERE id=$1 FOR UPDATE',[lookup.organization_id])).rows[0]; assert(organization&&!organization.archived_at,404,'INVITATION','This invitation is not valid.'); const invitation=(await client.query('SELECT * FROM organization_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[hash(input.token)])).rows[0]; assert(invitation&&invitation.email===actor.email.toLowerCase(),404,'INVITATION','This invitation is expired or belongs to another account.'); const inviter = (await client.query("SELECT m.role FROM organization_memberships m JOIN users u ON u.id=m.user_id AND u.active WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active", [organization.id, invitation.invited_by])).rows[0]; (assert)(inviter && ["owner", "admin"].includes(inviter.role) && (invitation.role !== "admin" || inviter.role === "owner"), 404, "INVITATION", "The invitation\u2019s original membership authority is no longer active."); assert(invitation.invited_by!==actor.id,403,'INVITATION','You cannot accept your own invitation.'); await client.query('INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET active=true,role=excluded.role,joined_at=now(),revoked_at=NULL',[invitation.organization_id,actor.id,invitation.role]); await client.query('UPDATE organization_invitations SET accepted_at=now(),accepted_by=$2 WHERE id=$1',[invitation.id,actor.id]); await client.query('UPDATE customer_organizations SET version=version+1 WHERE id=$1',[invitation.organization_id]); await audit(actor.id,'organization.invitation.accepted','organization',invitation.organization_id,{invitationId:invitation.id},client); }); return getOrganizations(actor); }
async function revokeOrganizationMember(actor:Actor,id:string,userId:string){
    await (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await organizationActor(client, actor);
        const row=await membership(actor,id,client,true);
        if (actor.id !== userId)
            manage(row);
        assert(row.owner_id!==userId,409,'ORGANIZATION_OWNER','The owner cannot be removed. Archive the organization instead.');
        const target=(await client.query('SELECT role FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND active',[id,userId])).rows[0];
        assert(target,404,'NOT_FOUND','Member not found.');
        assert(actor.id===userId||row.member_role==='owner'||target.role!=='admin',403,'ORGANIZATION_ROLE','Only the owner may remove an administrator.');
        await client.query('UPDATE organization_memberships SET active=false,revoked_at=now() WHERE organization_id=$1 AND user_id=$2',[id,userId]);
        await client.query('UPDATE customer_organizations SET version=version+1 WHERE id=$1',[id]);
        await audit(actor.id,'organization.member.revoked','organization',id,{userId},client);
    });
    return { ok: true };
}
async function shareOrganizationRequest(actor:Actor,id:string,requestId:string,body:unknown,remove=false){
    const input=remove?{permission:'view'}:parse(z.object({permission:z.enum(['view','reply'])}).strict(),body);
    await (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await organizationActor(client, actor);
        const row=await membership(actor,id,client,true);
        manage(row);
        const request=(await client.query('SELECT owner_id FROM requests WHERE id=$1',[requestId])).rows[0];
        assert(request?.owner_id===actor.id,403,'REQUEST_OWNER','Only the request owner may grant or revoke its sharing.');
        if (remove)
            await client.query('UPDATE request_shares SET revoked_at=now() WHERE organization_id=$1 AND request_id=$2',[id,requestId]);
        else
            await client.query('INSERT INTO request_shares(organization_id,request_id,permission,shared_by) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,request_id) DO UPDATE SET permission=excluded.permission,shared_by=excluded.shared_by,shared_at=now(),revoked_at=NULL',[id,requestId,input.permission,actor.id]);
        await audit(actor.id,remove?'request.sharing.revoked':'request.shared','request',requestId,{organizationId:id,permission:input.permission},client);
    });
    return { ok: true };
}
async function sharedRequestPermission(actor:Actor,requestId:string,client?:PoolClient):Promise<'view'|'reply'|null>{
  const sql=`SELECT s.permission,m.role FROM request_shares s JOIN customer_organizations o ON o.id=s.organization_id AND o.archived_at IS NULL JOIN organization_memberships m ON m.organization_id=o.id AND m.user_id=$2 AND m.active WHERE s.request_id=$1 AND s.revoked_at IS NULL ORDER BY CASE WHEN s.permission='reply' AND m.role<>'viewer' THEN 0 ELSE 1 END LIMIT 1${client?' FOR SHARE OF s,o,m':''}`;
  const result=await (client?client.query(sql,[requestId,actor.id]):query(sql,[requestId,actor.id]));const row=result.rows[0];return row?(row.permission==='reply'&&row.role!=='viewer'?'reply':'view'):null;
}
const selectorSchema = z.object({ search: z.string().trim().max(120).default(""), limit: z.coerce.number().int().min(1).max(50).default(30), cursor: z.string().max(2048).optional() }).strict();
const linkSchema = z.object({ accountId: z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/), expectedOrganizationVersion: z.number().int().positive(), expectedAccountVersion: z.number().int().positive(), expectedAccountRecordVersion: z.number().int().positive(), reason: z.string().trim().min(10).max(2e3) }).strict();
const managedSelect = `SELECT o.id,o.name,o.city,o.country,o.version,o.crm_account_id,o.crm_link_state,o.crm_linked_at,p.display_name AS account_name,p.version AS account_version,e.revision_number AS record_version,e.data AS record,
  (SELECT count(*)::int FROM organization_memberships m WHERE m.organization_id=o.id AND m.active) AS member_count,
  (SELECT count(*)::int FROM request_shares s WHERE s.organization_id=o.id AND s.revoked_at IS NULL) AS share_count
  FROM customer_organizations o JOIN crm_account_profiles p ON p.record_id=o.crm_account_id JOIN workspace_entities e ON e.bucket='records' AND e.id=p.record_id AND e.deleted_at IS NULL`;
const managedDto = (row: ManagedOrganizationRow) => ({ id: row.id, name: row.name, city: row.city, country: row.country, version: row.version, account: { id: row.crm_account_id, displayName: row.account_name, version: row.account_version, recordVersion: Number(row.record_version) }, linkState: row.crm_link_state, linkedAt: row.crm_linked_at?.toISOString() || null, memberCount: row.member_count, sharedRequestCount: row.share_count });
async function mappingActor(client: PoolClient, actor: Actor) { actor = await organizationActor(client, actor); (assert)(actor.role !== "customer" && (canWorkspace)(actor.role, "edit", "accounts") && actor.crmAccess?.permissions.contact, 403, "CRM_ACCOUNT_MAPPING", "Mapping portal organizations requires current account editing and contact-field access."); return actor; }
async function managedOrganization(client: PoolClient, actor: Actor, id: string) { uuid(id); const row = (await client.query(managedSelect + " WHERE o.id=$1 AND o.archived_at IS NULL FOR UPDATE OF o", [id])).rows[0]; (assert)(row && (readableRecord)(actor, row.record), 404, "NOT_FOUND", "Organization not found in your current CRM scope."); return row; }
function readMappingCursor(value: string | undefined, actor: Actor, purpose: string, filterHash: string) {
    if (!value)
        return null;
    try {
        const result = JSON.parse((decrypt)(value));
        (assert)(result && typeof result === "object" && result.purpose === purpose && result.actorId === actor.id && result.filterHash === filterHash && Number.isFinite(result.expiresAt) && result.expiresAt > Date.now() && typeof result.id === "string" && result.id.length <= 160, 422, "INVALID_CURSOR", "This cursor is no longer valid for the selected search.");
        return result.id;
    }
    catch {
        throw new HttpError(422, "INVALID_CURSOR", "This cursor is invalid or expired.");
    }
}
const mappingCursor = (actor: Actor, purpose: string, filterHash: string, id: string) => (encrypt)(JSON.stringify({ actorId: actor.id, purpose, filterHash, id, expiresAt: Date.now() + 36e5 }));
async function listManagedPortalOrganizations(actor: Actor, body = {}) {
    const input = (parse)(selectorSchema, body);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await mappingActor(client, actor);
        const filterHash = (checksum)({ search: input.search, limit: input.limit }), after = readMappingCursor(input.cursor, actor, "portal-organizations", filterHash);
        if (after)
            (assert)(z.string().uuid().safeParse(after).success, 422, "INVALID_CURSOR", "Invalid organization cursor.");
        const rows = (await client.query(managedSelect + " WHERE o.archived_at IS NULL" + (after ? " AND o.id>$1::uuid" : "") + " ORDER BY o.id LIMIT 501", after ? [after] : [])).rows;
        const items = [];
        let last = null, visited = 0;
        const needle = input.search.toLocaleLowerCase();
        for (const row of rows.slice(0, 500)) {
            last = row.id;
            visited++;
            if (!(readableRecord)(actor, row.record))
                continue;
            if (needle && ![row.id, row.name, row.city, row.country, row.crm_account_id, row.account_name].some(value => value.toLocaleLowerCase().includes(needle)))
                continue;
            items.push(managedDto(row));
            if (items.length === input.limit)
                break;
        }
        return { items, nextCursor: last && visited < rows.length ? mappingCursor(actor, "portal-organizations", filterHash, last) : null };
    });
}
async function getManagedPortalOrganization(actor: Actor, organizationId: string) { return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await mappingActor(client, actor); return managedDto(await managedOrganization(client, actor, organizationId)); }); }
async function listPortalCrmAccountCandidates(actor: Actor, organizationId: string, body = {}) {
    const input = (parse)(selectorSchema, body);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await mappingActor(client, actor);
        await managedOrganization(client, actor, organizationId);
        const purpose = "portal-account-candidates:" + organizationId, filterHash = (checksum)({ search: input.search, limit: input.limit }), after = readMappingCursor(input.cursor, actor, purpose, filterHash);
        const rows = (await client.query(`SELECT p.record_id AS id,p.display_name,p.version,p.lifecycle,e.revision_number AS record_version,e.data AS record FROM crm_account_profiles p JOIN workspace_entities e ON e.bucket='records' AND e.id=p.record_id AND e.deleted_at IS NULL
      WHERE e.status NOT IN ('archived','withdrawn') AND p.lifecycle<>'inactive' AND NOT EXISTS(SELECT 1 FROM customer_organizations o WHERE o.crm_account_id=p.record_id AND o.archived_at IS NULL AND o.id<>$1::uuid)` + (after ? " AND p.record_id>$2" : "") + " ORDER BY p.record_id LIMIT 501", after ? [organizationId, after] : [organizationId])).rows;
        const items = [];
        let last = null, visited = 0;
        const needle = input.search.toLocaleLowerCase();
        for (const row of rows.slice(0, 500)) {
            last = row.id;
            visited++;
            if (!(readableRecord)(actor, row.record))
                continue;
            if (needle && ![row.id, row.display_name].some(value => value.toLocaleLowerCase().includes(needle)))
                continue;
            items.push({ id: row.id, displayName: row.display_name, version: row.version, recordVersion: Number(row.record_version), lifecycle: row.lifecycle });
            if (items.length === input.limit)
                break;
        }
        return { items, nextCursor: last && visited < rows.length ? mappingCursor(actor, purpose, filterHash, last) : null };
    });
}
async function linkPortalOrganizationAccount(actor: Actor, organizationId: string, body: unknown) { const input = (parse)(linkSchema, body); return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await mappingActor(client, actor); const current = await managedOrganization(client, actor, organizationId); (assert)(current.version === input.expectedOrganizationVersion, 409, "CONFLICT", "The portal organization changed; review its current version."); const target = (await client.query("SELECT p.record_id AS id,p.display_name,p.version,p.lifecycle,e.revision_number AS record_version,e.data AS record FROM crm_account_profiles p JOIN workspace_entities e ON e.bucket='records' AND e.id=p.record_id AND e.deleted_at IS NULL WHERE p.record_id=$1 FOR UPDATE OF p,e", [input.accountId])).rows[0]; (assert)(target && (readableRecord)(actor, target.record), 404, "NOT_FOUND", "The destination account is outside your current scope."); (assert)(target.lifecycle !== "inactive" && !["archived", "withdrawn"].includes(target.record.status), 409, "CRM_ACCOUNT_INACTIVE", "Choose an active CRM account."); (assert)(target.version === input.expectedAccountVersion && Number(target.record_version) === input.expectedAccountRecordVersion, 409, "CONFLICT", "The destination account or its assignment changed; review the current version."); (assert)(!(await client.query("SELECT id FROM customer_organizations WHERE crm_account_id=$1 AND id<>$2::uuid AND archived_at IS NULL", [input.accountId, organizationId])).rowCount, 409, "CRM_ACCOUNT_LINKED", "This CRM account already has an active portal organization."); await client.query("UPDATE customer_organizations SET crm_account_id=$2,crm_link_state='linked',crm_linked_by=$3,crm_linked_at=now(),version=version+1,updated_at=now() WHERE id=$1", [organizationId, target.id, actor.id]); const eventId = (randomUUID)(); await client.query("INSERT INTO organization_crm_link_events(id,organization_id,previous_account_id,account_id,link_state,actor_id,organization_version,account_version,reason) VALUES($1,$2,$3,$4,'linked',$5,$6,$7,$8)", [eventId, organizationId, current.crm_account_id, target.id, actor.id, current.version + 1, target.version, input.reason]); await client.query("UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton=true"); await (audit)(actor.id, "organization.crm.linked", "organization", organizationId, { eventId, previousAccountId: current.crm_account_id, accountId: target.id, reasonHash: (hash)(input.reason) }, client); return managedDto(await managedOrganization(client, actor, organizationId)); }); }
async function getPortalOrganizationLinkHistory(actor: Actor, organizationId: string) { return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await mappingActor(client, actor); await managedOrganization(client, actor, organizationId); const rows = (await client.query("SELECT * FROM organization_crm_link_events WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100", [organizationId])).rows; const ids = [...new Set(rows.flatMap(row => [row.account_id, ...row.previous_account_id ? [row.previous_account_id] : []]))], records = (await client.query("SELECT id,data FROM workspace_entities WHERE bucket='records' AND id=ANY($1::text[]) AND deleted_at IS NULL", [ids])).rows; const visible = new Set(records.filter(row => (readableRecord)(actor, row.data)).map(row => row.id)); const items = rows.filter(row => visible.has(row.account_id) && (!row.previous_account_id || visible.has(row.previous_account_id))).map(row => ({ id: row.id, previousAccountId: row.previous_account_id, accountId: row.account_id, state: row.link_state, actorId: row.actor_id, organizationVersion: row.organization_version, accountVersion: row.account_version, reason: actor.crmAccess?.permissions.financial || row.actor_id === actor.id ? row.reason : "", createdAt: row.created_at.toISOString() })); return { items }; }); }
export { acceptOrganizationInvitation, createOrganization, deleteOrganization, getManagedPortalOrganization, getOrganizations, getPortalOrganizationLinkHistory, inviteOrganizationMember, linkPortalOrganizationAccount, listManagedPortalOrganizations, listPortalCrmAccountCandidates, revokeOrganizationMember, shareOrganizationRequest, sharedRequestPermission, updateOrganization };
