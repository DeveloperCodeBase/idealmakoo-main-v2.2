import type {PgRow} from './recovered-db-rows';
import type {FrontRequest} from '../types/frontend';
import type {CalendarDefinition} from './workspace-calendar';
type CalendarRow = PgRow<'crm_work_calendars',{definition:CalendarDefinition}>;
type RuleRow = PgRow<'crm_routing_rules',{definition:z.infer<typeof ruleSchema>}> & {last_assignee_id?:string|null};
type RequestSla = Record<string,unknown> & {pausedAt?:string|null;resolutionDueAt?:string;calendarId?:string;calendarVersion?:number};
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { routableRequestKinds } from "../types/routing";
import { calendarDefinitionSchema, addConfiguredBusinessMinutes, elapsedBusinessMilliseconds, addConfiguredBusinessMilliseconds } from "./workspace-calendar";
import { assert, HttpError } from "./types";
import { transaction, audit } from "./db";
import { loadCrmAccess, canAccessCrmRequest, crmRequestCollection } from "./workspace-scopes";
import { parse } from "./http";
import { checksum } from "./workspace-policy";
import { randomUUID } from "node:crypto";
import { canWorkspace } from "../lib/auth";
const idSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const ruleSchema = z.object({ name: z.string().trim().min(1).max(160), active: z.boolean(), priority: z.number().int().min(0).max(1e4), teamId: idSchema, territoryId: idSchema.nullable(), calendarId: idSchema, kinds: z.array(z.enum(routableRequestKinds)).min(1).max(routableRequestKinds.length).refine(value => new Set(value).size === value.length, "Request kinds must be unique."), locales: z.array(z.enum(["fa", "en", "tr", "ar", "ru"])).min(1).max(5).refine(value => new Set(value).size === value.length, "Languages must be unique."), countries: z.array(z.string().trim().min(1).max(100)).max(250).refine(value => new Set(value.map(country => country.toLocaleLowerCase("en-US"))).size === value.length, "Country names must be unique.") }).strict();
const versionedCalendar = z.object({ expectedVersion: z.number().int().min(1), value: calendarDefinitionSchema }).strict();
const versionedRule = z.object({ expectedVersion: z.number().int().min(1), value: ruleSchema }).strict();
const manager = (actor: Actor) => (assert)(actor.mfaVerified && ["superAdmin", "admin"].includes(actor.role) && actor.crmAccess?.scope === "all" && actor.crmAccess.permissions.assign, 403, "FORBIDDEN", "Current administrator and assignment permissions are required.");
const calendarDto = (row: CalendarRow) => ({ ...row.definition, id: row.id, version: row.version, isDefault: row.is_default, updatedAt: row.updated_at.toISOString() });
const ruleDto = (row: RuleRow) => ({ ...row.definition, id: row.id, version: row.version, configuredById: row.configured_by, updatedAt: row.updated_at.toISOString(), lastAssigneeId: row.last_assignee_id || null });
const conflict = (expected: number, current: number) => (assert)(expected === current, 409, "CONFLICT", "This routing configuration changed. Refresh and retry.");
const ruleSelect = "SELECT r.*,c.last_assignee_id FROM crm_routing_rules r LEFT JOIN crm_routing_cursors c ON c.rule_id=r.id";
function duplicate(error: unknown): never {
    if ((error as NodeJS.ErrnoException).code === "23505")
        throw new HttpError(409, "ROUTING_NAME_EXISTS", "An active configuration already uses this name.");
    throw error;
}
async function getCrmRoutingConfiguration(actor: Actor) { return (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR SHARE"); actor = await (loadCrmAccess)(actor, client); manager(actor); const calendars = (await client.query<CalendarRow>("SELECT * FROM crm_work_calendars ORDER BY is_default DESC,name,id")).rows; const rules = (await client.query<RuleRow>(ruleSelect + " ORDER BY r.priority,r.name,r.id")).rows; return { calendars: calendars.map(calendarDto), rules: rules.map(ruleDto) }; }); }
async function getCrmRequestRouting(actor: Actor, requestId: string) { (parse)(idSchema, requestId); return (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR SHARE"); actor = await (loadCrmAccess)(actor, client); const request = (await client.query<PgRow<'requests',{sla:RequestSla}>>("SELECT kind,quality_quarantined,assignee_id,team_id,territory_id,sla FROM requests WHERE id=$1", [requestId])).rows[0]; (assert)(request && (canAccessCrmRequest)(actor, { id: requestId, kind: request.kind, qualityQuarantined: request.quality_quarantined, assigneeId: request.assignee_id, teamId: request.team_id, territoryId: request.territory_id }), 404, "NOT_FOUND", "Request not found."); const decision = (await client.query("SELECT * FROM crm_routing_decisions WHERE request_id=$1", [requestId])).rows[0]; return { decision: decision ? { id: decision.id, requestId, ruleId: decision.rule_id, ruleVersion: decision.rule_version, assigneeId: decision.assignee_id, teamId: decision.team_id, territoryId: decision.territory_id, calendarId: decision.calendar_id, calendarVersion: decision.calendar_version, status: decision.status, reason: decision.reason, decidedAt: decision.created_at.toISOString() } : null, sla: request.sla }; }); }
async function calendarRevision(client: PoolClient, id: string, version: number, definition: CalendarDefinition, actor: Actor) { await client.query<PgRow<'crm_calendar_revisions',{definition:CalendarDefinition}>>("INSERT INTO crm_calendar_revisions(calendar_id,version,definition,checksum,configured_by) VALUES($1,$2,$3::jsonb,$4,$5)", [id, version, JSON.stringify(definition), (checksum)(definition), actor.id]); }
async function createCrmCalendar(actor: Actor, body: unknown) {
    const input = (parse)(calendarDefinitionSchema, body), id = (randomUUID)();
    try {
        return await (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE"); actor = await (loadCrmAccess)(actor, client); manager(actor); const row = (await client.query<CalendarRow>("INSERT INTO crm_work_calendars(id,name,active,definition,configured_by) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING *", [id, input.name, input.active, JSON.stringify(input), actor.id])).rows[0]; await calendarRevision(client, id, 1, input, actor); await (audit)(actor.id, "crm.calendar.created", "calendar", id, { version: 1 }, client); return calendarDto(row); });
    }
    catch (error) {
        duplicate(error);
    }
}
async function updateCrmCalendar(actor: Actor, id: string, body: unknown) {
    (parse)(idSchema, id);
    const input = (parse)(versionedCalendar, body);
    try {
        return await (transaction)(async (client) => {
            await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE");
            actor = await (loadCrmAccess)(actor, client);
            manager(actor);
            const existing = (await client.query<CalendarRow>("SELECT * FROM crm_work_calendars WHERE id=$1 FOR UPDATE", [id])).rows[0];
            (assert)(existing, 404, "NOT_FOUND", "Calendar not found.");
            conflict(input.expectedVersion, existing.version);
            (assert)(!existing.is_default || input.value.active, 409, "DEFAULT_CALENDAR", "The default intake calendar must remain active.");
            if (!input.value.active)
                (assert)(!(await client.query<RuleRow>("SELECT id FROM crm_routing_rules WHERE calendar_id=$1 AND active LIMIT 1", [id])).rowCount, 409, "CALENDAR_IN_USE", "Move active routing rules before archiving this calendar.");
            const version = existing.version + 1, row = (await client.query<CalendarRow>("UPDATE crm_work_calendars SET name=$2,active=$3,version=$4,definition=$5::jsonb,configured_by=$6,updated_at=now() WHERE id=$1 RETURNING *", [id, input.value.name, input.value.active, version, JSON.stringify(input.value), actor.id])).rows[0];
            await calendarRevision(client, id, version, input.value, actor);
            await (audit)(actor.id, "crm.calendar.updated", "calendar", id, { version, previousVersion: existing.version }, client);
            return calendarDto(row);
        });
    }
    catch (error) {
        duplicate(error);
    }
}
async function validateRuleReferences(client: PoolClient, actor: Actor, input: z.infer<typeof ruleSchema>) {
    (assert)(!input.kinds.includes("quality_complaint") || actor.qualityScope, 403, "QUALITY_SCOPE", "Quality routing requires an explicit quality grant.");
    (assert)(input.locales.every(locale => actor.allowedLocales.includes(locale)), 403, "LOCALE_SCOPE", "A routing language is outside this administrator account scope.");
    (assert)((await client.query("SELECT id FROM crm_teams WHERE id=$1 AND (NOT $2::boolean OR active)", [input.teamId, input.active])).rowCount, 422, "CRM_GROUP_INACTIVE", "Select an active team.");
    if (input.territoryId)
        (assert)((await client.query("SELECT id FROM crm_territories WHERE id=$1 AND (NOT $2::boolean OR active)", [input.territoryId, input.active])).rowCount, 422, "CRM_GROUP_INACTIVE", "Select an active territory.");
    (assert)((await client.query<CalendarRow>("SELECT id FROM crm_work_calendars WHERE id=$1 AND (NOT $2::boolean OR active)", [input.calendarId, input.active])).rowCount, 422, "CALENDAR_INACTIVE", "Select an active work calendar.");
}
async function ruleRevision(client: PoolClient, id: string, version: number, definition: z.infer<typeof ruleSchema>, actor: Actor) { await client.query("INSERT INTO crm_routing_rule_revisions(rule_id,version,definition,checksum,configured_by) VALUES($1,$2,$3::jsonb,$4,$5)", [id, version, JSON.stringify(definition), (checksum)(definition), actor.id]); }
async function createCrmRoutingRule(actor: Actor, body: unknown) {
    const input = (parse)(ruleSchema, body), id = (randomUUID)();
    try {
        return await (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE"); actor = await (loadCrmAccess)(actor, client); manager(actor); await validateRuleReferences(client, actor, input); const row = (await client.query<RuleRow>("INSERT INTO crm_routing_rules(id,name,active,priority,team_id,territory_id,calendar_id,definition,configured_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *", [id, input.name, input.active, input.priority, input.teamId, input.territoryId, input.calendarId, JSON.stringify(input), actor.id])).rows[0]; await ruleRevision(client, id, 1, input, actor); await client.query("INSERT INTO crm_routing_cursors(rule_id) VALUES($1)", [id]); await (audit)(actor.id, "crm.routing_rule.created", "routing_rule", id, { version: 1 }, client); return ruleDto(row); });
    }
    catch (error) {
        duplicate(error);
    }
}
async function updateCrmRoutingRule(actor: Actor, id: string, body: unknown) {
    (parse)(idSchema, id);
    const input = (parse)(versionedRule, body);
    try {
        return await (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE"); actor = await (loadCrmAccess)(actor, client); manager(actor); const existing = (await client.query<RuleRow>("SELECT * FROM crm_routing_rules WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(existing, 404, "NOT_FOUND", "Routing rule not found."); conflict(input.expectedVersion, existing.version); await validateRuleReferences(client, actor, input.value); const value = input.value, version = existing.version + 1; await client.query<RuleRow>("UPDATE crm_routing_rules SET name=$2,active=$3,priority=$4,team_id=$5,territory_id=$6,calendar_id=$7,version=$8,definition=$9::jsonb,configured_by=$10,updated_at=now() WHERE id=$1", [id, value.name, value.active, value.priority, value.teamId, value.territoryId, value.calendarId, version, JSON.stringify(value), actor.id]); await ruleRevision(client, id, version, value, actor); await (audit)(actor.id, "crm.routing_rule.updated", "routing_rule", id, { version, previousVersion: existing.version }, client); return ruleDto((await client.query<RuleRow>(ruleSelect + " WHERE r.id=$1", [id])).rows[0]); });
    }
    catch (error) {
        duplicate(error);
    }
}
async function currentStaff(client: PoolClient, id: string) { const user = (await client.query<PgRow<'users',{allowed_locales:string[]}>>("SELECT id,role,name,email,quality_scope,allowed_locales FROM users WHERE id=$1 AND active AND mfa_enabled AND role<>'customer'", [id])).rows[0]; return user ? (loadCrmAccess)({ id: user.id, role: user.role, name: user.name, email: user.email, qualityScope: user.quality_scope, allowedLocales: user.allowed_locales, mfaVerified: true }, client) : null; }
async function routeNewWorkspaceRequest(client: PoolClient, request: FrontRequest & {qualityQuarantined?:boolean}) {
    await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE");
    if ((await client.query("SELECT id FROM crm_routing_decisions WHERE request_id=$1", [request.id])).rowCount)
        return;
    const stored = (await client.query<PgRow<'requests',{sla:RequestSla}>>("SELECT assignee_id,team_id,territory_id,sla,locale FROM requests WHERE id=$1 FOR UPDATE", [request.id])).rows[0];
    (assert)(stored, 404, "NOT_FOUND", "Request not found.");
    const requestLocale = stored.locale;
    const fallback = (await client.query<CalendarRow>("SELECT * FROM crm_work_calendars WHERE is_default AND active")).rows[0];
    (assert)(fallback, 503, "CALENDAR_MISSING", "An active default calendar is required.");
    let calendar = fallback, rule: RuleRow | undefined, assigneeId = stored.assignee_id, teamId = stored.team_id, territoryId = stored.territory_id, cursorSequence: string | null = null;
    let reason = assigneeId || teamId || territoryId ? "manual_assignment" : (routableRequestKinds as readonly string[]).includes(request.kind) ? "no_rule" : "excluded_kind";
    if (reason !== "manual_assignment" && reason !== "excluded_kind") {
        const country = (request.country || "").trim().toLocaleLowerCase("en-US");
        rule = (await client.query<RuleRow>(ruleSelect + " WHERE r.active ORDER BY r.priority,r.id")).rows.find(row => (row.definition.kinds as readonly string[]).includes(request.kind) && row.definition.locales.includes(requestLocale) && (!row.definition.countries.length || row.definition.countries.some(value => value.toLocaleLowerCase("en-US") === country)));
        if (rule) {
            const creator = await currentStaff(client, rule.configured_by), definition = rule.definition;
            const authorized = creator && creator.crmAccess?.scope === "all" && creator.crmAccess.permissions.assign && ["superAdmin", "admin"].includes(creator.role) && creator.allowedLocales.includes(requestLocale) && (canAccessCrmRequest)(creator, { id: request.id, kind: request.kind, qualityQuarantined: request.qualityQuarantined === true || request.kind === "quality_complaint" });
            if (!authorized)
                reason = "rule_creator_revoked";
            else {
                const activeTeam = (await client.query("SELECT id FROM crm_teams WHERE id=$1 AND active", [definition.teamId])).rowCount, activeTerritory = !definition.territoryId || (await client.query("SELECT id FROM crm_territories WHERE id=$1 AND active", [definition.territoryId])).rowCount;
                const selected = (await client.query<CalendarRow>("SELECT * FROM crm_work_calendars WHERE id=$1 AND active", [definition.calendarId])).rows[0];
                if (!activeTeam || !activeTerritory || !selected)
                    reason = "group_inactive";
                else {
                    calendar = selected;
                    teamId = definition.teamId;
                    territoryId = definition.territoryId;
                    reason = "no_candidate";
                    const members = (await client.query("SELECT m.user_id FROM crm_team_memberships m JOIN users u ON u.id=m.user_id AND u.active AND u.mfa_enabled AND u.role<>'customer' WHERE m.team_id=$1 AND m.active ORDER BY m.user_id", [teamId])).rows;
                    const eligible = [];
                    for (const member of members) {
                        const candidate = await currentStaff(client, member.user_id);
                        if (!candidate || !candidate.allowedLocales.includes(requestLocale) || !candidate.crmAccess?.teamIds.includes(teamId) || territoryId && !candidate.crmAccess?.territoryIds.includes(territoryId))
                            continue;
                        if ((canAccessCrmRequest)(candidate, { id: request.id, kind: request.kind, qualityQuarantined: request.qualityQuarantined === true || request.kind === "quality_complaint", assigneeId: candidate.id, teamId, territoryId }) && (["reply", "note"] as const).some(action => (canWorkspace)(candidate.role, action, (crmRequestCollection)(request.kind))))
                            eligible.push(candidate.id);
                    }
                    if (eligible.length) {
                        const cursor = (await client.query("SELECT last_assignee_id,sequence::text FROM crm_routing_cursors WHERE rule_id=$1 FOR UPDATE", [rule.id])).rows[0];
                        (assert)(cursor, 503, "ROUTING_CURSOR", "The routing cursor is missing.");
                        assigneeId = eligible.find(id2 => !cursor.last_assignee_id || id2 > cursor.last_assignee_id) || eligible[0];
                        reason = "assigned";
                        cursorSequence = (BigInt(cursor.sequence) + 1n).toString();
                        await client.query("UPDATE crm_routing_cursors SET last_assignee_id=$2,sequence=$3::bigint,updated_at=now() WHERE rule_id=$1", [rule.id, assigneeId, cursorSequence]);
                    }
                }
            }
        }
    }
    const started = new Date(request.createdAt), sla = { ...stored.sla, policy: "configured-business-hours-v1", calendarId: calendar.id, calendarVersion: calendar.version, assignmentDueAt: (addConfiguredBusinessMinutes)(calendar.definition, started, calendar.definition.assignmentMinutes).toISOString(), firstResponseDueAt: (addConfiguredBusinessMinutes)(calendar.definition, started, calendar.definition.firstResponseMinutes).toISOString(), resolutionDueAt: (addConfiguredBusinessMinutes)(calendar.definition, started, calendar.definition.resolutionMinutes).toISOString(), assignedAt: assigneeId ? new Date().toISOString() : null };
    await client.query<PgRow<'requests',{sla:RequestSla}>>("UPDATE requests SET assignee_id=$2,team_id=$3,territory_id=$4,sla=$5::jsonb WHERE id=$1", [request.id, assigneeId, teamId, territoryId, JSON.stringify(sla)]);
    const id = (randomUUID)(), status = reason === "manual_assignment" ? "preserved" : assigneeId ? "assigned" : "intake";
    await client.query("INSERT INTO crm_routing_decisions(id,request_id,rule_id,rule_version,assignee_id,team_id,territory_id,calendar_id,calendar_version,status,reason,cursor_sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::bigint)", [id, request.id, rule?.id || null, rule?.version || null, assigneeId, teamId, territoryId, calendar.id, calendar.version, status, reason, cursorSequence]);
    await (audit)(null, "crm.request.routed", "request", request.id, { decisionId: id, ruleId: rule?.id || null, assigneeId, teamId, territoryId, reason, calendarId: calendar.id, calendarVersion: calendar.version }, client);
}
async function resumeRequestBusinessSla(client: PoolClient, sla: RequestSla, resumedAt = new Date) {
    if (typeof sla.pausedAt !== "string")
        return sla;
    const next = { ...sla };
    if (typeof sla.resolutionDueAt === "string") {
        const row = typeof sla.calendarId === "string" && Number.isSafeInteger(sla.calendarVersion) ? (await client.query<PgRow<'crm_calendar_revisions',{definition:CalendarDefinition}>>("SELECT definition FROM crm_calendar_revisions WHERE calendar_id=$1 AND version=$2", [sla.calendarId, sla.calendarVersion])).rows[0] : void 0;
        if (row) {
            const pausedAt = new Date(sla.pausedAt), previousDue = new Date(sla.resolutionDueAt);
            if (previousDue > pausedAt) {
                const remaining = (elapsedBusinessMilliseconds)(row.definition, pausedAt, previousDue);
                next.resolutionDueAt = (addConfiguredBusinessMilliseconds)(row.definition, resumedAt, remaining).toISOString();
            }
        }
        else
            next.resolutionDueAt = new Date(Date.parse(sla.resolutionDueAt) + Math.max(0, resumedAt.getTime() - Date.parse(sla.pausedAt))).toISOString();
    }
    next.pausedAt = null;
    return next;
}
export { createCrmCalendar, createCrmRoutingRule, getCrmRequestRouting, getCrmRoutingConfiguration, resumeRequestBusinessSla, routeNewWorkspaceRequest, updateCrmCalendar, updateCrmRoutingRule };
