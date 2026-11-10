import type { Actor } from './types';
import type { PgRow } from './recovered-db-rows';
import type { WorkspaceRecord } from '../data/workspace-seed';
import type { WorkspaceAction } from '../lib/auth';
import type { Locale } from '../lib/i18n';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { validTimezone, enqueueAccountNotification } from "./notification-policy";
import { assert, HttpError } from "./types";
import { loadCrmAccess, crmCollections, canAccessCrmRecord } from "./workspace-scopes";
import { parse, rateLimit, visitorKey, json, readJson } from "./http";
import { readableRecord, checksum } from "./workspace-policy";
import { canWorkspace } from "../lib/auth";
import { transaction, audit } from "./db";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { hash, equal } from "./crypto";
import { getRequestRow, staffRequestAccess } from "./requests";
import { config } from "./config";
const identity = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true }).refine(value => Date.parse(value) >= Date.UTC(2e3, 0, 1) && Date.parse(value) < Date.UTC(2101, 0, 1), "Use a timestamp between 2000 and 2100.");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const time = Date.parse(value + "T00:00:00Z"); return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value && value >= "2000-01-01" && value <= "2100-12-31"; }, "Use a real calendar date between 2000 and 2100.");
const timelineCreate = z.object({ recordId: identity, kind: z.enum(["call", "meeting", "note"]), body: z.string().trim().min(1).max(1e4), occurredAt: iso }).strict();
const taskDefinition = z.object({ recordId: identity, assigneeUserId: identity, title: z.string().trim().min(1).max(200), body: z.string().trim().max(5e3), due: z.discriminatedUnion("kind", [z.object({ kind: z.literal("instant"), at: iso }).strict(), z.object({ kind: z.literal("date"), date: dateOnly, timezone: z.string().max(80).refine(validTimezone) }).strict()]), recurrence: z.object({ frequency: z.enum(["daily", "weekly", "monthly"]), interval: z.number().int().min(1).max(30), count: z.number().int().min(1).max(52) }).strict().nullable(), reminderMinutes: z.number().int().min(0).max(10080) }).strict();
const reportFilters = z.object({ createdFrom: iso.optional(), createdUntil: iso.optional(), pipelineId: identity.optional() }).strict().refine(value => !value.createdFrom || !value.createdUntil || Date.parse(value.createdFrom) < Date.parse(value.createdUntil), "The report date range is empty.");
const successDefinition = z.object({ recordId: identity, title: z.string().trim().min(1).max(200), notes: z.string().trim().max(1e4), nextContactOn: dateOnly.nullable(), factors: z.array(z.object({ id: identity, title: z.string().trim().min(1).max(160), weight: z.number().int().min(1).max(100), score: z.number().int().min(0).max(100).nullable(), evidence: z.string().trim().max(2e3) }).strict().refine(value => value.score === null || value.evidence.length > 0, "A scored factor requires evidence.")).min(1).max(10) }).strict().refine(value => new Set(value.factors.map(factor => factor.id)).size === value.factors.length, "Factor identifiers must be unique.");
type TaskDefinition = z.infer<typeof taskDefinition>;
type SuccessDefinition = z.infer<typeof successDefinition>;
type TimelineRow = PgRow<'crm_timeline_entries'>;
type TaskRow = PgRow<'crm_task_series', {definition:TaskDefinition}>;
type ReminderState='pending'|'queued'|'delivered'|'cancelled'|'failed'|'uncertain';
type OccurrenceRow = PgRow<'crm_task_occurrences', {due_date:string|null;reminder_state:ReminderState}> & {reminder_outbox_id:string|null};
type ReminderRow = OccurrenceRow & Pick<TaskRow,'record_id'|'definition'|'assignee_user_id'|'active'>;
type UserRow = PgRow<'users', {allowed_locales:string[]}>;
type SourceRow = {id:string;data:WorkspaceRecord};
type ForecastSource = SourceRow & {pipeline_id:string|null;revision_id:string|null;stage_id:string|null;stage_kind:string|null;probability_percent:string|null};
interface ForecastGroup {currency:string;stageId:string;pipelineId:string|null;stageKind:string;count:number;knownAmountDecimal:string;knownWeightedAmountDecimal:string;weightedAmountDecimal:string|null;unknownAmountCount:number;unknownProbabilityCount:number;tomanEquivalentDecimal:string|null}
type ReportRow = PgRow<'crm_report_snapshots', {source_ids:string[];report:Awaited<ReturnType<typeof captureReport>>['report']}>;
type SuccessRow = PgRow<'crm_success_plans', {definition:SuccessDefinition}>;
type SurveyRow = PgRow<'crm_survey_invitations'> & {submitted_at:Date|null;score:number|null;comment:string|null};
const admin = (actor: Actor) => actor.role === "admin" || actor.role === "superAdmin";
const conflict = (expected: number, actual: number) => (assert)(Number.isSafeInteger(expected) && expected === actual, 409, "CONFLICT", "The item changed; reload it before editing.");
const milliseconds = (value: Date|string|number) => new Date(value).toISOString();
async function lockWorkspace(client: PoolClient) { return (await client.query("SELECT version FROM workspace_meta WHERE singleton=true FOR UPDATE")).rows[0]; }
async function currentActor(actor: Actor, client: PoolClient) { actor = await (loadCrmAccess)(actor, client); (assert)(actor.mfaVerified && actor.role !== "customer", 403, "MFA_REQUIRED", "Current staff access with MFA is required."); return actor; }
async function recordFor(client: PoolClient, actor: Actor, id: string, action: WorkspaceAction = "view") { (parse)(identity, id); const record = (await client.query<SourceRow>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL", [id])).rows[0]?.data; (assert)(record && crmCollections.has(record.collection) && (readableRecord)(actor, record), 404, "NOT_FOUND", "CRM record not found."); (assert)((canWorkspace)(actor.role, action, record.collection), 403, "FORBIDDEN", "This CRM operation is not permitted."); return record; }
const timelineDto = (row: TimelineRow) => ({ id: row.id, recordId: row.record_id, version: row.version, kind: row.kind, body: row.body, occurredAt: milliseconds(row.occurred_at), recordedAt: milliseconds(row.recorded_at), authorId: row.author_id, updatedAt: milliseconds(row.updated_at), archived: !!row.archived_at });
async function listCrmTimeline(actor: Actor, recordId: string, options: {limit?:number;cursor?:string} = {}) {
    const limit = Math.max(1, Math.min(100, Number.isInteger(options.limit) ? options.limit! : 30));
    let cursor: {at:string;id:string}|null = null;
    if (options.cursor) {
        (assert)(options.cursor.length <= 400, 422, "CURSOR", "Invalid timeline cursor.");
        try {
            cursor = (parse)(z.object({ at: iso, id: uuid }).strict(), JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")));
        }
        catch {
            throw new HttpError(422, "CURSOR", "Invalid timeline cursor.");
        }
    }
    return (transaction)(async (client) => { actor = await currentActor(actor, client); await recordFor(client, actor, recordId); const rows = (await client.query<TimelineRow>("SELECT * FROM crm_timeline_entries WHERE record_id=$1 AND archived_at IS NULL" + (cursor ? " AND (occurred_at,id)<($2::timestamptz,$3::uuid)" : "") + ` ORDER BY occurred_at DESC,id DESC LIMIT $${cursor ? 4 : 2}`, cursor ? [recordId, cursor.at, cursor.id, limit + 1] : [recordId, limit + 1])).rows; const more = rows.length > limit; const items = rows.slice(0, limit).map(timelineDto); const last = items.at(-1); return { items, nextCursor: more && last ? Buffer.from(JSON.stringify({ at: last.occurredAt, id: last.id })).toString("base64url") : null }; });
}
async function createCrmTimelineEntry(actor: Actor, body: unknown) { const input = (parse)(timelineCreate, body); return (transaction)(async (client) => { await lockWorkspace(client); actor = await currentActor(actor, client); await recordFor(client, actor, input.recordId, "note"); (assert)(Date.parse(input.occurredAt) <= Date.now() + 864e5, 422, "OCCURRED_AT", "The occurrence time cannot be more than one day in the future."); const row = (await client.query<TimelineRow>("INSERT INTO crm_timeline_entries(id,record_id,kind,body,occurred_at,author_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [(randomUUID)(), input.recordId, input.kind, input.body, new Date(input.occurredAt), actor.id])).rows[0]; await (audit)(actor.id, "crm.timeline.created", "crm_timeline", row.id, { recordId: input.recordId, kind: input.kind, bodyHash: (hash)(input.body) }, client); return timelineDto(row); }); }
async function updateCrmTimelineEntry(actor: Actor, id: string, body: unknown, expected: number, archive = false) { (parse)(uuid, id); const input = (parse)(z.object({ kind: z.enum(["call", "meeting", "note"]).optional(), body: z.string().trim().min(1).max(1e4).optional() }).strict(), body); (assert)(archive || Object.keys(input).length, 422, "EMPTY_PATCH", "No change was supplied."); return (transaction)(async (client) => { await lockWorkspace(client); actor = await currentActor(actor, client); const row = (await client.query<TimelineRow>("SELECT * FROM crm_timeline_entries WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(row && !row.archived_at, 404, "NOT_FOUND", "Timeline entry not found."); await recordFor(client, actor, row.record_id, "note"); (assert)(row.author_id === actor.id || admin(actor), 403, "FORBIDDEN", "Only the author or an administrator can amend an internal note."); conflict(expected, row.version); const updated = (await client.query<TimelineRow>("UPDATE crm_timeline_entries SET kind=$2,body=$3,archived_at=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, input.kind || row.kind, input.body || row.body, archive ? new Date : null])).rows[0]; await (audit)(actor.id, archive ? "crm.timeline.archived" : "crm.timeline.updated", "crm_timeline", id, { recordId: row.record_id, bodyHash: (hash)(updated.body) }, client); return timelineDto(updated); }); }
function calendarAdd(base: Date, frequency: NonNullable<TaskDefinition["recurrence"]>["frequency"], amount: number) {
    if (frequency !== "monthly")
        return new Date(base.getTime() + amount * (frequency === "weekly" ? 7 : 1) * 864e5);
    const day = base.getUTCDate(), target = new Date(base);
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + amount);
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, last));
    return target;
}
function dateReminder(date: string, timezone: string) {
    const target = Date.parse(date + "T09:00:00Z");
    const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const parts = (time: number) => Object.fromEntries(formatter.formatToParts(time).map(item => [item.type, item.value]));
    let estimate = target;
    for (let i = 0; i < 4; i++) {
        const p = parts(estimate);
        estimate += target - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    }
    for (let offset = -180; offset <= 180; offset++) {
        const value = estimate + offset * 6e4, p = parts(value);
        if (`${p.year}-${p.month}-${p.day}` === date && Number(p.hour) * 60 + Number(p.minute) >= 540)
            return new Date(value);
    }
    throw new HttpError(422, "TASK_DATE", "This local date has no valid reminder time in the selected timezone.");
}
function expandCrmTaskSchedule(definition: TaskDefinition) {
    const count = definition.recurrence?.count || 1;
    const base = new Date(definition.due.kind === "instant" ? definition.due.at : definition.due.date + "T00:00:00Z");
    const result = [];
    for (let ordinal = 0; ordinal < count; ordinal++) {
        const date = ordinal ? calendarAdd(base, definition.recurrence!.frequency, definition.recurrence!.interval * ordinal) : base;
        (assert)(date.getUTCFullYear() <= 2100, 422, "TASK_HORIZON", "Task recurrence exceeds the supported calendar horizon.");
        const dueDate = definition.due.kind === "date" ? date.toISOString().slice(0, 10) : null;
        const dueAt = dueDate && definition.due.kind === "date" ? dateReminder(dueDate, definition.due.timezone) : date;
        result.push({ ordinal, dueAt, dueDate, reminderAt: new Date(dueAt.getTime() - definition.reminderMinutes * 6e4) });
    }
    return result;
}
const occurrenceDto = (row: OccurrenceRow) => ({ id: row.id, generation: row.generation, ordinal: row.ordinal, version: row.version, dueAt: milliseconds(row.due_at), dueDate: row.due_date, reminderAt: milliseconds(row.reminder_at), status: row.status, completedAt: row.completed_at ? milliseconds(row.completed_at) : null, remindedAt: row.reminded_at ? milliseconds(row.reminded_at) : null, reminderStatus: row.reminder_state, reminderError: row.reminder_error });
async function taskDto(client: PoolClient, row: TaskRow, history = false) { const values = (await client.query<OccurrenceRow>("SELECT *,due_date::text FROM crm_task_occurrences WHERE series_id=$1" + (history ? "" : " AND generation=$2") + " ORDER BY generation DESC,ordinal", history ? [row.id] : [row.id, row.generation])).rows; return { id: row.id, version: row.version, generation: row.generation, active: row.active, definition: row.definition, createdBy: row.created_by, createdAt: milliseconds(row.created_at), updatedAt: milliseconds(row.updated_at), occurrences: values.map(occurrenceDto) }; }
async function taskAssignee(client: PoolClient, actor: Actor, record: WorkspaceRecord, assigneeId: string) { (assert)(actor.id === assigneeId || actor.crmAccess?.permissions.assign, 403, "ASSIGNMENT_PERMISSION", "Assigning another staff member requires assignment permission."); const user = (await client.query<UserRow>("SELECT * FROM users WHERE id=$1 AND active AND mfa_enabled", [assigneeId])).rows[0]; (assert)(user, 422, "TASK_ASSIGNEE", "Choose an active staff member with MFA."); const assignee = await (loadCrmAccess)({ id: user.id, name: user.name, email: user.email, role: user.role, qualityScope: user.quality_scope, allowedLocales: user.allowed_locales, mfaVerified: user.mfa_enabled }, client); (assert)((canWorkspace)(assignee.role, "view", "activities") && (readableRecord)(assignee, record), 422, "TASK_ASSIGNEE_SCOPE", "The assignee cannot access the target CRM record."); }
async function insertOccurrences(client: PoolClient, id: string, generation: number, definition: TaskDefinition) {
    for (const item of expandCrmTaskSchedule(definition))
        await client.query<OccurrenceRow>("INSERT INTO crm_task_occurrences(id,series_id,generation,ordinal,due_at,due_date,reminder_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [(randomUUID)(), id, generation, item.ordinal, item.dueAt, item.dueDate, item.reminderAt]);
}
async function listCrmTasks(actor: Actor, recordId?: string) {
    return (transaction)(async (client) => {
        actor = await currentActor(actor, client);
        (assert)((canWorkspace)(actor.role, "view", "activities"), 403, "FORBIDDEN", "Activity access is required.");
        if (recordId)
            await recordFor(client, actor, recordId);
        const rows = (await client.query<TaskRow>("SELECT * FROM crm_task_series WHERE " + (recordId ? "record_id=$1" : "assignee_user_id=$1") + " ORDER BY active DESC,created_at DESC,id LIMIT 101", [recordId || actor.id])).rows;
        (assert)(rows.length <= 100, 413, "TASK_RESULT_LIMIT", "Select a narrower CRM record to list task history.");
        const items = [];
        for (const row of rows) {
            try {
                await recordFor(client, actor, row.record_id);
                items.push(await taskDto(client, row));
            }
            catch (error) {
                if (!(error instanceof HttpError && error.status === 404))
                    throw error;
            }
        }
        return { items };
    });
}
async function getCrmTask(actor: Actor, id: string) { (parse)(uuid, id); return (transaction)(async (client) => { actor = await currentActor(actor, client); (assert)((canWorkspace)(actor.role, "view", "activities"), 403, "FORBIDDEN", "Activity access is required."); const row = (await client.query<TaskRow>("SELECT * FROM crm_task_series WHERE id=$1", [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Task not found."); await recordFor(client, actor, row.record_id); return taskDto(client, row, true); }); }
async function createCrmTask(actor: Actor, body: unknown) { const input = (parse)(taskDefinition, body); return (transaction)(async (client) => { await lockWorkspace(client); actor = await currentActor(actor, client); (assert)((canWorkspace)(actor.role, "create", "activities"), 403, "FORBIDDEN", "Task creation is not permitted."); const record = await recordFor(client, actor, input.recordId); (assert)(!["archived", "withdrawn"].includes(record.status), 409, "RECORD_ARCHIVED", "An archived record cannot receive new tasks."); await taskAssignee(client, actor, record, input.assigneeUserId); const row = (await client.query<TaskRow>("INSERT INTO crm_task_series(id,record_id,definition,assignee_user_id,created_by) VALUES($1,$2,$3::jsonb,$4,$5) RETURNING *", [(randomUUID)(), input.recordId, JSON.stringify(input), input.assigneeUserId, actor.id])).rows[0]; await insertOccurrences(client, row.id, 1, input); await (audit)(actor.id, "crm.task.created", "crm_task", row.id, { recordId: input.recordId, occurrences: input.recurrence?.count || 1 }, client); return taskDto(client, row); }); }
async function updateCrmTask(actor: Actor, id: string, body: unknown, expected: number, cancel = false) {
    (parse)(uuid, id);
    const input = cancel ? null : (parse)(taskDefinition, body);
    return (transaction)(async (client) => {
        await lockWorkspace(client);
        actor = await currentActor(actor, client);
        (assert)((canWorkspace)(actor.role, cancel ? "archive" : "edit", "activities"), 403, "FORBIDDEN", "Task modification is not permitted.");
        let row = (await client.query<TaskRow>("SELECT * FROM crm_task_series WHERE id=$1 FOR UPDATE", [id])).rows[0];
        (assert)(row, 404, "NOT_FOUND", "Task not found.");
        const record = await recordFor(client, actor, row.record_id);
        (assert)(row.created_by === actor.id || row.assignee_user_id === actor.id || actor.crmAccess?.permissions.assign, 403, "FORBIDDEN", "Task modification requires the author, assignee or assignment permission.");
        conflict(expected, row.version);
        (assert)(row.active, 409, "TASK_CANCELLED", "A cancelled task series retains history and cannot be reopened.");
        if (input) {
            (assert)(input.recordId === row.record_id, 422, "TASK_TARGET", "Create a separate task for a different CRM record.");
            await taskAssignee(client, actor, record, input.assigneeUserId);
        }
        const replanned = !!input && (checksum)({ due: input.due, recurrence: input.recurrence, reminderMinutes: input.reminderMinutes }) !== (checksum)({ due: row.definition.due, recurrence: row.definition.recurrence, reminderMinutes: row.definition.reminderMinutes });
        (assert)(!replanned || row.generation < 20, 409, "TASK_HISTORY_LIMIT", "This series reached its rescheduling limit; preserve it and create a following series.");
        if (cancel || replanned)
            await client.query<OccurrenceRow>("UPDATE crm_task_occurrences SET status='cancelled',reminder_state=CASE WHEN reminder_state IN ('pending','queued') THEN 'cancelled' ELSE reminder_state END,reminder_error=CASE WHEN reminder_state IN ('pending','queued') THEN 'TASK_CLOSED' ELSE reminder_error END,version=version+1 WHERE series_id=$1 AND status='open'", [id]);
        else if(input && checksum(input)!==checksum(row.definition))
            // A queued copy must never follow a reassignment or retain edited
            // task text. Its old outbox reference becomes stale; dispatch checks
            // that exact reference before showing it to the former recipient.
            await client.query<OccurrenceRow>("UPDATE crm_task_occurrences SET reminder_state='pending',reminder_outbox_id=NULL,reminder_error=NULL,version=version+1 WHERE series_id=$1 AND status='open' AND reminder_state='queued'",[id]);
        row = (await client.query<TaskRow>("UPDATE crm_task_series SET active=$2,definition=$3::jsonb,assignee_user_id=$4,generation=generation+$5,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, !cancel, JSON.stringify(input || row.definition), input?.assigneeUserId || row.assignee_user_id, replanned ? 1 : 0])).rows[0];
        if (replanned)
            await insertOccurrences(client, id, row.generation, row.definition);
        await (audit)(actor.id, cancel ? "crm.task.cancelled" : "crm.task.updated", "crm_task", id, { recordId: row.record_id, replanned }, client);
        return taskDto(client, row);
    });
}
async function setCrmTaskOccurrence(actor: Actor, id: string, body: unknown, expected: number) { (parse)(uuid, id); const input = (parse)(z.object({ status: z.enum(["completed", "cancelled"]) }).strict(), body); return (transaction)(async (client) => { await lockWorkspace(client); actor = await currentActor(actor, client); (assert)((canWorkspace)(actor.role, "edit", "activities"), 403, "FORBIDDEN", "Task editing is not permitted."); const occurrence = (await client.query<OccurrenceRow>("SELECT *,due_date::text FROM crm_task_occurrences WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(occurrence, 404, "NOT_FOUND", "Task occurrence not found."); const series = (await client.query<TaskRow>("SELECT * FROM crm_task_series WHERE id=$1 FOR UPDATE", [occurrence.series_id])).rows[0]; await recordFor(client, actor, series.record_id); (assert)(series.assignee_user_id === actor.id || series.created_by === actor.id || actor.crmAccess?.permissions.assign, 403, "FORBIDDEN", "Only the assigned team may close this task."); conflict(expected, occurrence.version); (assert)(occurrence.status === "open", 409, "TASK_CLOSED", "This occurrence has already been closed."); const updated = (await client.query<OccurrenceRow>("UPDATE crm_task_occurrences SET status=$2,completed_at=$3,completed_by=$4,reminder_state=CASE WHEN reminder_state IN ('pending','queued') THEN 'cancelled' ELSE reminder_state END,reminder_error=CASE WHEN reminder_state IN ('pending','queued') THEN 'TASK_CLOSED' ELSE reminder_error END,version=version+1 WHERE id=$1 RETURNING *,due_date::text", [id, input.status, input.status === "completed" ? new Date : null, input.status === "completed" ? actor.id : null])).rows[0]; await (audit)(actor.id, "crm.task.occurrence." + input.status, "crm_task", series.id, { occurrenceId: id }, client); return occurrenceDto(updated); }); }
async function runCrmTaskReminders(limit = 100, at = new Date) {
    return (transaction)(async (client) => {
        await lockWorkspace(client);
        const rows = (await client.query<ReminderRow>("SELECT o.*,o.due_date::text,s.record_id,s.definition,s.assignee_user_id,s.active FROM crm_task_occurrences o JOIN crm_task_series s ON s.id=o.series_id WHERE o.status='open' AND o.reminder_state='pending' AND o.reminder_at<=$1 AND s.active ORDER BY o.reminder_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT $2", [at, Math.max(1, Math.min(100, limit))])).rows;
        let queued = 0, cancelled = 0;
        for (const row of rows) {
            const suppress = async (code: string) => { await client.query<OccurrenceRow>("UPDATE crm_task_occurrences SET reminder_state='cancelled',reminder_error=$2 WHERE id=$1", [row.id, code]); cancelled++; };
            const user = (await client.query<UserRow>("SELECT * FROM users WHERE id=$1 AND active AND mfa_enabled", [row.assignee_user_id])).rows[0];
            if (!user) {
                await suppress("ASSIGNEE_UNAVAILABLE");
                continue;
            }
            const actor = await (loadCrmAccess)({ id: user.id, name: user.name, email: user.email, role: user.role, qualityScope: user.quality_scope, allowedLocales: user.allowed_locales, mfaVerified: user.mfa_enabled }, client);
            if (!(canWorkspace)(actor.role, "view", "activities")) {
                await suppress("ASSIGNEE_SCOPE_REVOKED");
                continue;
            }
            let target;
            try {
                target = await recordFor(client, actor, row.record_id);
            }
            catch (error) {
                if (error instanceof HttpError && error.status === 404) {
                    await suppress("ASSIGNEE_SCOPE_REVOKED");
                    continue;
                }
                throw error;
            }
            if (["archived", "withdrawn"].includes(target.status)) {
                await suppress("RECORD_ARCHIVED");
                continue;
            }
            const preferences = (await client.query<{language:string|null}>("SELECT preferences->>'language' AS language FROM user_settings WHERE user_id=$1", [user.id])).rows[0];
            const language = preferences?.language;
            const locale = language && ["fa", "en", "tr", "ar", "ru"].includes(language) ? language as Locale : "fa";
            const href = "/" + locale + "/admin/crm/activities/?record=" + encodeURIComponent(row.record_id);
            const dueLabel = { fa: "\u0645\u0648\u0639\u062F \u0648\u0638\u06CC\u0641\u0647", en: "Task due", tr: "G\xF6rev zaman\u0131", ar: "\u0645\u0648\u0639\u062F \u0627\u0644\u0645\u0647\u0645\u0629", ru: "\u0421\u0440\u043E\u043A \u0437\u0430\u0434\u0430\u0447\u0438" }[locale];
            const outboxId=await enqueueAccountNotification(client,{userId:user.id,channel:'in-app',topic:'requests',purpose:'transactional',title:row.definition.title,body:dueLabel+': '+(row.due_date||milliseconds(row.due_at)),href,crmRecordId:row.record_id,crmTaskOccurrenceId:row.id},'crm-task:'+row.id+':'+row.version);
            if(!outboxId){await suppress('REMINDER_NOT_QUEUED');continue;}
            await client.query<OccurrenceRow>("UPDATE crm_task_occurrences SET reminder_state='queued',reminder_error=NULL,reminder_outbox_id=$2 WHERE id=$1",[row.id,outboxId]);
            await audit(null,'crm.task.reminder.queued','crm_task',row.series_id,{occurrenceId:row.id,outboxId},client);
            queued++;
        }
        return { examined: rows.length, queued, cancelled };
    });
}

async function canDeliverCrmTaskReminder(client:PoolClient,payload:Record<string,unknown>,outboxId:string):Promise<boolean>{
    if(typeof payload.crmTaskOccurrenceId!=='string'||!uuid.safeParse(payload.crmTaskOccurrenceId).success||typeof payload.userId!=='string'||typeof payload.crmRecordId!=='string'||payload.channel!=='in-app'||payload.topic!=='requests'||payload.purpose!=='transactional')return false;
    const row=(await client.query<ReminderRow & {series_generation:number}>("SELECT o.*,o.due_date::text,s.record_id,s.definition,s.assignee_user_id,s.active,s.generation AS series_generation FROM crm_task_occurrences o JOIN crm_task_series s ON s.id=o.series_id WHERE o.id=$1",[payload.crmTaskOccurrenceId])).rows[0];
    if(!row||!row.active||row.status!=='open'||row.reminder_state!=='queued'||row.reminder_outbox_id!==outboxId||row.generation!==row.series_generation||row.assignee_user_id!==payload.userId||row.record_id!==payload.crmRecordId||row.reminder_at.getTime()>Date.now())return false;
    const user=(await client.query<UserRow>('SELECT * FROM users WHERE id=$1 AND active AND mfa_enabled',[row.assignee_user_id])).rows[0];
    if(!user||user.role==='customer')return false;
    try{
        const actor=await loadCrmAccess({id:user.id,name:user.name,email:user.email,role:user.role,qualityScope:user.quality_scope,allowedLocales:user.allowed_locales,mfaVerified:user.mfa_enabled},client);
        if(!canWorkspace(actor.role,'view','activities'))return false;
        const record=await recordFor(client,actor,row.record_id);
        return !['archived','withdrawn'].includes(record.status);
    }catch(error){if(error instanceof HttpError&&[403,404].includes(error.status))return false;throw error;}
}

async function completeCrmTaskReminderDelivery(client:PoolClient,outboxId:string,state:'delivered'|'cancelled'|'failed'|'uncertain'){
    const rows=(await client.query<{id:string;series_id:string}>("UPDATE crm_task_occurrences SET reminder_state=$2,reminded_at=CASE WHEN $2='delivered' THEN now() ELSE NULL END,reminder_error=CASE WHEN $2='delivered' THEN NULL ELSE COALESCE((SELECT last_error FROM outbox WHERE id=$1),$2) END WHERE reminder_outbox_id=$1 AND reminder_state='queued' RETURNING id,series_id",[outboxId,state])).rows;
    for(const row of rows)await audit(null,'crm.task.reminder.'+state,'crm_task',row.series_id,{occurrenceId:row.id,outboxId},client);
}
const scales: Record<string,number> = { IRR: 0, USD: 2, EUR: 2, TRY: 2, RUB: 2 };
const round = (numerator: bigint, denominator: bigint) => (2n * numerator + denominator) / (2n * denominator);
const fixed = (minor: bigint, scale: number) => { const text = minor.toString().padStart(scale + 1, "0"); return scale ? text.slice(0, -scale) + "." + text.slice(-scale) : text; };
const million = 1000000n;
function decimalSix(value: unknown) {
    if (typeof value !== "string" || value.length > 32 || !/^\d+(?:\.\d{1,6})?$/.test(value))
        return null;
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * million + BigInt(fraction.padEnd(6, "0"));
}
async function reportActor(client: PoolClient, actor: Actor) { actor = await currentActor(actor, client); (assert)((canWorkspace)(actor.role, "view", "reports") && actor.crmAccess?.permissions.financial, 403, "REPORT_PERMISSION", "Reports require current reporting and financial access."); return actor; }
function reportRecordAllowed(actor: Actor, record: WorkspaceRecord) { return record.collection === "opportunities" && (canAccessCrmRecord)(actor, record) && (!(record.tags || []).includes("quality") && !record.details?.qualityQuarantined || actor.qualityScope); }
async function captureReport(client: PoolClient, actor: Actor, filters: z.infer<typeof reportFilters>) {
    const meta = (await client.query("SELECT version FROM workspace_meta WHERE singleton=true FOR SHARE")).rows[0];
    actor = await reportActor(client, actor);
    const conditions = ["e.bucket='records'", "e.collection='opportunities'", "e.deleted_at IS NULL", "e.status NOT IN ('archived','withdrawn')"], params = [];
    if (filters.createdFrom) {
        params.push(filters.createdFrom);
        conditions.push(`e.created_at>=$${params.length}::timestamptz`);
    }
    if (filters.createdUntil) {
        params.push(filters.createdUntil);
        conditions.push(`e.created_at<$${params.length}::timestamptz`);
    }
    if (filters.pipelineId) {
        params.push(filters.pipelineId);
        conditions.push(`p.pipeline_id=$${params.length}`);
    }
    const candidates = (await client.query<ForecastSource>("SELECT e.id,e.data,p.pipeline_id,p.revision_id,p.stage_id,p.stage_kind,p.probability_percent::text FROM workspace_entities e LEFT JOIN crm_opportunity_positions p ON p.opportunity_id=e.id WHERE " + conditions.join(" AND ") + " ORDER BY e.id LIMIT 20001", params)).rows;
    (assert)(candidates.length <= 2e4, 413, "REPORT_SCAN_LIMIT", "Narrow the report date range before calculating this report.");
    const rows = candidates.filter(row => reportRecordAllowed(actor, row.data));
    (assert)(rows.length <= 5e3, 413, "REPORT_RESULT_LIMIT", "Narrow the report to at most 5000 authorized opportunities.");
    const groups = new Map<string,{value:ForecastGroup;amount:bigint;weighted:bigint}>;
    for (const row of rows) {
        const currency = Object.hasOwn(scales, String(row.data.currency)) ? String(row.data.currency) : "UNSPECIFIED", scale = scales[currency] ?? 2, key = [currency, row.pipeline_id || "", row.stage_id || "unconfigured"].join(":");
        let group = groups.get(key);
        if (!group) {
            group = { value: { currency, stageId: row.stage_id || "unconfigured", pipelineId: row.pipeline_id, stageKind: row.stage_kind || "unconfigured", count: 0, knownAmountDecimal: fixed(0n, scale), knownWeightedAmountDecimal: fixed(0n, scale), weightedAmountDecimal: null, unknownAmountCount: 0, unknownProbabilityCount: 0, tomanEquivalentDecimal: null }, amount: 0n, weighted: 0n };
            groups.set(key, group);
        }
        group.value.count++;
        const amount = currency === "UNSPECIFIED" ? null : decimalSix(row.data.amount), probability = decimalSix(row.probability_percent);
        if (amount === null)
            group.value.unknownAmountCount++;
        else
            group.amount += round(amount, 10n ** BigInt(6 - scale));
        if (probability === null)
            group.value.unknownProbabilityCount++;
        else if (amount !== null)
            group.weighted += round(amount * probability, 10n ** BigInt(14 - scale));
    }
    const values = [...groups.values()].map(group => {
        const scale = scales[group.value.currency] ?? 2;
        group.value.knownAmountDecimal = fixed(group.amount, scale);
        group.value.knownWeightedAmountDecimal = fixed(group.weighted, scale);
        group.value.weightedAmountDecimal = group.value.unknownAmountCount || group.value.unknownProbabilityCount ? null : group.value.knownWeightedAmountDecimal;
        if (group.value.currency === "IRR")
            group.value.tomanEquivalentDecimal = fixed(group.amount, 1);
        return group.value;
    }).sort((a, b) => a.currency.localeCompare(b.currency) || String(a.pipelineId).localeCompare(String(b.pipelineId)) || a.stageId.localeCompare(b.stageId));
    const report = { schemaVersion: 1, calculationPolicyVersion: "crm-forecast-half-up-v1", capturedAt: new Date().toISOString(), workspaceVersion: Number(meta.version), filters, opportunityCount: rows.length, groups: values };
    return { report, sourceIds: rows.map(row => row.id), actor };
}
async function getCrmForecast(actor: Actor, body: unknown = {}) { const filters = (parse)(reportFilters, body); return (transaction)(async (client) => (await captureReport(client, actor, filters)).report); }
async function createCrmReportSnapshot(actor: Actor, body: unknown) { const filters = (parse)(reportFilters, body); return (transaction)(async (client) => { const captured = await captureReport(client, actor, filters); (assert)((canWorkspace)(captured.actor.role, "export", "reports"), 403, "FORBIDDEN", "Report export permission is required."); const id = (randomUUID)(), digest = (checksum)(captured.report); await client.query<ReportRow>("INSERT INTO crm_report_snapshots(id,created_by,source_ids,report,checksum) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)", [id, actor.id, JSON.stringify(captured.sourceIds), JSON.stringify(captured.report), digest]); await (audit)(actor.id, "crm.report.captured", "crm_report", id, { opportunityCount: captured.sourceIds.length, checksum: digest }, client); return { id, createdAt: captured.report.capturedAt, createdBy: actor.id, checksum: digest, report: captured.report }; }); }
async function visibleReport(client: PoolClient, actor: Actor, row: ReportRow) { const rows = (await client.query<SourceRow>("SELECT id,data FROM workspace_entities WHERE bucket='records' AND id=ANY($1::text[]) AND deleted_at IS NULL", [row.source_ids])).rows; return rows.length === row.source_ids.length && rows.every(source => reportRecordAllowed(actor, source.data)); }
const reportDto = (row: ReportRow) => ({ id: row.id, createdAt: milliseconds(row.created_at), createdBy: row.created_by, checksum: row.checksum, report: row.report });
async function listCrmReportSnapshots(actor: Actor) {
    return (transaction)(async (client) => {
        actor = await reportActor(client, actor);
        const rows = (await client.query<ReportRow>("SELECT * FROM crm_report_snapshots WHERE created_by=$1" + (admin(actor) ? " OR true" : "") + " ORDER BY created_at DESC,id LIMIT 50", [actor.id])).rows;
        const items = [];
        for (const row of rows)
            if (await visibleReport(client, actor, row))
                items.push(reportDto(row));
        return { items };
    });
}
async function getCrmReportSnapshot(actor: Actor, id: string) { (parse)(uuid, id); return (transaction)(async (client) => { actor = await reportActor(client, actor); const row = (await client.query<ReportRow>("SELECT * FROM crm_report_snapshots WHERE id=$1", [id])).rows[0]; (assert)(row && (row.created_by === actor.id || admin(actor)), 404, "NOT_FOUND", "Report snapshot not found."); (assert)(await visibleReport(client, actor, row), 409, "REPORT_SCOPE_CHANGED", "Current access no longer covers every source in this immutable historical report."); return reportDto(row); }); }
function calculateCrmSuccessHealth(definition: SuccessDefinition) {
    let all = 0n, known = 0n, total = 0n, count = 0;
    for (const factor of definition.factors) {
        const weight = BigInt(factor.weight);
        all += weight;
        if (factor.score !== null) {
            known += weight;
            total += BigInt(factor.score) * weight;
            count++;
        }
    }
    return { scoreDecimal: known ? fixed(round(total * 100n, known), 2) : null, coveragePercentDecimal: all ? fixed(round(known * 10000n, all), 2) : "0.00", knownFactors: count, unknownFactors: definition.factors.length - count };
}
const successDto = (row: SuccessRow) => ({ id: row.id, version: row.version, state: row.state, definition: row.definition, health: calculateCrmSuccessHealth(row.definition), createdAt: milliseconds(row.created_at), updatedAt: milliseconds(row.updated_at) });
async function successRecord(client: PoolClient, actor: Actor, recordId: string, edit = false) { (assert)((canWorkspace)(actor.role, edit ? "edit" : "view", "success") && actor.crmAccess?.permissions.contact, 403, "SUCCESS_PERMISSION", "Customer success requires current contact and success-plan permissions."); const record = await recordFor(client, actor, recordId); (assert)(["accounts", "contacts", "leads", "opportunities", "tickets", "success"].includes(record.collection), 422, "SUCCESS_TARGET", "Choose a customer relationship or service record."); return record; }
async function listCrmSuccessPlans(actor: Actor, recordId: string) { return (transaction)(async (client) => { actor = await currentActor(actor, client); await successRecord(client, actor, recordId); const rows = (await client.query<SuccessRow>("SELECT * FROM crm_success_plans WHERE record_id=$1 ORDER BY updated_at DESC,id LIMIT 100", [recordId])).rows; return { items: rows.map(successDto) }; }); }
async function createCrmSuccessPlan(actor: Actor, body: unknown) { const input = (parse)(successDefinition, body); return (transaction)(async (client) => { await lockWorkspace(client); actor = await currentActor(actor, client); await successRecord(client, actor, input.recordId, true); (assert)((canWorkspace)(actor.role, "create", "success"), 403, "FORBIDDEN", "Success-plan creation is not permitted."); const row = (await client.query<SuccessRow>("INSERT INTO crm_success_plans(id,record_id,definition,created_by) VALUES($1,$2,$3::jsonb,$4) RETURNING *", [(randomUUID)(), input.recordId, JSON.stringify(input), actor.id])).rows[0]; await (audit)(actor.id, "crm.success.created", "crm_success", row.id, { recordId: input.recordId, factorCount: input.factors.length }, client); return successDto(row); }); }
async function updateCrmSuccessPlan(actor: Actor, id: string, body: unknown, expected: number) {
    (parse)(uuid, id);
    const input = (parse)(z.object({ definition: successDefinition, state: z.enum(["active", "closed", "archived"]) }).strict(), body);
    return (transaction)(async (client) => {
        await lockWorkspace(client);
        actor = await currentActor(actor, client);
        const row = (await client.query<SuccessRow>("SELECT * FROM crm_success_plans WHERE id=$1 FOR UPDATE", [id])).rows[0];
        (assert)(row, 404, "NOT_FOUND", "Success plan not found.");
        await successRecord(client, actor, row.record_id, true);
        conflict(expected, row.version);
        (assert)(input.definition.recordId === row.record_id, 422, "SUCCESS_TARGET", "Create a separate plan for a different relationship.");
        if (input.state === "archived")
            (assert)((canWorkspace)(actor.role, "archive", "success"), 403, "FORBIDDEN", "Archiving is not permitted.");
        const updated = (await client.query<SuccessRow>("UPDATE crm_success_plans SET definition=$2::jsonb,state=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, JSON.stringify(input.definition), input.state])).rows[0];
        await (audit)(actor.id, "crm.success.updated", "crm_success", id, { state: input.state, definitionHash: (checksum)(input.definition) }, client);
        return successDto(updated);
    });
}
const surveySelect = "SELECT i.*,r.submitted_at,r.score,r.comment FROM crm_survey_invitations i LEFT JOIN crm_survey_responses r ON r.invitation_id=i.id";
const surveyDto = (row: SurveyRow) => ({ id: row.id, requestId: row.request_id, kind: row.kind, locale: row.locale, question: row.question, expiresAt: milliseconds(row.expires_at), createdAt: milliseconds(row.created_at), revokedAt: row.revoked_at ? milliseconds(row.revoked_at) : null, respondedAt: row.submitted_at ? milliseconds(row.submitted_at) : null, score: row.score, comment: row.comment });
async function surveyRequest(client: PoolClient, actor: Actor, requestId: string, edit = false) { (assert)((canWorkspace)(actor.role, edit ? "create" : "view", "success") && actor.crmAccess?.permissions.contact, 403, "SURVEY_PERMISSION", "Surveys require current customer-success and contact permissions."); const request = await (getRequestRow)(requestId, client); (assert)(await (staffRequestAccess)(actor, request, client), 404, "NOT_FOUND", "Request not found."); (assert)(!request.quality_quarantined || actor.qualityScope, 404, "NOT_FOUND", "Request not found."); return request; }
async function listCrmSurveys(actor: Actor, requestId: string) { return (transaction)(async (client) => { actor = await currentActor(actor, client); await surveyRequest(client, actor, requestId); return { items: (await client.query<SurveyRow>(surveySelect + " WHERE i.request_id=$1 ORDER BY i.created_at DESC,i.id LIMIT 100", [requestId])).rows.map(surveyDto) }; }); }
async function createCrmSurvey(actor: Actor, body: unknown) { const input = (parse)(z.object({ requestId: identity, kind: z.enum(["csat", "nps"]), locale: z.enum(["fa", "en", "tr", "ar", "ru"]), question: z.string().trim().min(1).max(1e3), expiresInDays: z.number().int().min(1).max(30).default(7), channel: z.enum(["in-app", "email"]).default("in-app") }).strict(), body); await (rateLimit)("crm-survey:" + actor.id, 30, 3600); return (transaction)(async (client) => { await lockWorkspace(client); actor = await currentActor(actor, client); const request = await surveyRequest(client, actor, input.requestId, true); (assert)(request.owner_id, 422, "SURVEY_ACCOUNT", "A survey requires a registered request owner."); const user = (await client.query<UserRow>("SELECT id,email,email_verified,active,role FROM users WHERE id=$1 FOR KEY SHARE", [request.owner_id])).rows[0]; (assert)(user?.active && user.email_verified && user.role === "customer", 422, "SURVEY_RECIPIENT", "A survey requires the request owner\u2019s active verified customer account."); const id = (randomUUID)(), token = (randomBytes)(32).toString("hex"), expires = new Date(Date.now() + input.expiresInDays * 864e5); const row = (await client.query("INSERT INTO crm_survey_invitations(id,request_id,user_id,email_hash,kind,locale,question,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *", [id, input.requestId, user.id, (hash)(user.email), input.kind, input.locale, input.question, (hash)(token), actor.id, expires])).rows[0]; const href = `/${input.locale}/feedback/${token}/`; const title = input.kind === "csat" ? "Ideal Makoo \xB7 CSAT" : "Ideal Makoo \xB7 NPS"; const deliveryId = await (enqueueAccountNotification)(client, { userId: user.id, channel: input.channel, topic: "requests", purpose: "transactional", title, body: input.question, href, requestId: request.id, surveyInvitationId: id }, "crm-survey:" + id); await (audit)(actor.id, "crm.survey.created", "crm_survey", id, { requestId: request.id, kind: input.kind, channel: input.channel }, client); return { ...surveyDto({ ...row, submitted_at: null, score: null, comment: null }), url: (config)().siteUrl + href, deliveryId }; }); }
async function revokeCrmSurvey(actor: Actor, id: string) {
    (parse)(uuid, id);
    return (transaction)(async (client) => {
        await lockWorkspace(client);
        actor = await currentActor(actor, client);
        const row = (await client.query<SurveyRow>(surveySelect + " WHERE i.id=$1 FOR UPDATE OF i", [id])).rows[0];
        (assert)(row, 404, "NOT_FOUND", "Survey not found.");
        await surveyRequest(client, actor, row.request_id, true);
        (assert)(row.created_by === actor.id || admin(actor), 403, "FORBIDDEN", "Only the inviter or an administrator may revoke a survey.");
        if (!row.revoked_at) {
            await client.query("UPDATE crm_survey_invitations SET revoked_at=now() WHERE id=$1", [id]);
            await (audit)(actor.id, "crm.survey.revoked", "crm_survey", id, {}, client);
        }
        return { revoked: true };
    });
}
async function authorizeSurveyRow(client: PoolClient, row: SurveyRow|undefined) {
    (assert)(row && !row.revoked_at && row.expires_at.getTime() > Date.now(), 404, "NOT_FOUND", "Survey not found.");
    const owner = (await client.query<UserRow>("SELECT email,active,email_verified,role FROM users WHERE id=$1", [row.user_id])).rows[0];
    (assert)(owner?.active && owner.email_verified && owner.role === "customer" && (hash)(owner.email) === row.email_hash, 404, "NOT_FOUND", "Survey not found.");
    const creator = (await client.query<UserRow>("SELECT * FROM users WHERE id=$1 AND active AND mfa_enabled", [row.created_by])).rows[0];
    (assert)(creator, 404, "NOT_FOUND", "Survey not found.");
    try {
        const actor = await currentActor({ id: creator.id, name: creator.name, email: creator.email, role: creator.role, qualityScope: creator.quality_scope, allowedLocales: creator.allowed_locales, mfaVerified: creator.mfa_enabled }, client);
        const request = await surveyRequest(client, actor, row.request_id, true);
        (assert)(request.owner_id === row.user_id, 404, "NOT_FOUND", "Survey not found.");
    }
    catch (error) {
        if (error instanceof HttpError && error.status < 500)
            throw new HttpError(404, "NOT_FOUND", "Survey not found.");
        throw error;
    }
    return row;
}
async function tokenSurvey(client: PoolClient, token: string, lock = false) { (assert)(/^[a-f0-9]{64}$/.test(token), 404, "NOT_FOUND", "Survey not found."); return authorizeSurveyRow(client, (await client.query<SurveyRow>(surveySelect + " WHERE i.token_hash=$1" + (lock ? " FOR UPDATE OF i" : ""), [(hash)(token)])).rows[0]); }
async function isCrmSurveyDeliveryAuthorized(client: PoolClient, payload: Record<string,unknown>) {
    if (!payload.surveyInvitationId)
        return true;
    if (!uuid.safeParse(payload.surveyInvitationId).success)
        return false;
    try {
        const row = await authorizeSurveyRow(client, (await client.query<SurveyRow>(surveySelect + " WHERE i.id=$1", [payload.surveyInvitationId])).rows[0]);
        return !row.submitted_at && row.user_id === payload.userId && row.request_id === payload.requestId;
    }
    catch (error) {
        if (error instanceof HttpError && error.status < 500)
            return false;
        throw error;
    }
}
const surveyCsrf = (token: string) => (createHmac)("sha256", (config)().sessionSecret).update("crm-survey-csrf-v1:" + token).digest("hex");
async function getCrmSurveyForm(token: string) { return (transaction)(async (client) => { const row = await tokenSurvey(client, token); return { kind: row.kind, locale: row.locale, question: row.question, minimum: row.kind === "csat" ? 1 : 0, maximum: row.kind === "csat" ? 5 : 10, expiresAt: milliseconds(row.expires_at), submitted: !!row.submitted_at, csrfToken: surveyCsrf(token) }; }); }
async function crmSurveyResponse(request: Request, token: string) {
    (assert)(/^[a-f0-9]{64}$/.test(token), 404, "NOT_FOUND", "Survey not found.");
    await (rateLimit)("crm-survey-capability:" + (visitorKey)(request), 120, 900);
    const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };
    if (request.method === "GET")
        return (json)(await getCrmSurveyForm(token), 200, headers);
    (assert)(request.method === "POST", 405, "METHOD", "Use GET or POST.");
    (assert)(request.headers.get("origin") === (config)().siteUrl && request.headers.get("sec-fetch-site") !== "cross-site" && (equal)(request.headers.get("x-survey-csrf") || "", surveyCsrf(token)), 403, "CSRF", "Reload this feedback link before submitting.");
    return (json)(await submitCrmSurvey(token, await (readJson)(request, 32768)), 200, headers);
}
async function submitCrmSurvey(token: string, body: unknown) { const input = (parse)(z.object({ score: z.number().int().min(0).max(10), comment: z.string().trim().max(5e3).default("") }).strict(), body); await (rateLimit)("crm-survey-response:" + (hash)(token), 10, 3600); return (transaction)(async (client) => { await lockWorkspace(client); const row = await tokenSurvey(client, token, true); (assert)(!row.submitted_at, 409, "SURVEY_ALREADY_SUBMITTED", "This survey response has already been recorded."); (assert)(row.kind === "nps" || input.score >= 1 && input.score <= 5, 422, "SURVEY_SCORE", "CSAT accepts scores from 1 to 5."); await client.query("INSERT INTO crm_survey_responses(invitation_id,score,comment) VALUES($1,$2,$3)", [row.id, input.score, input.comment]); await (audit)(null, "crm.survey.responded", "crm_survey", row.id, { kind: row.kind }, client); return { submitted: true }; }); }
export { canDeliverCrmTaskReminder, completeCrmTaskReminderDelivery, calculateCrmSuccessHealth, createCrmReportSnapshot, createCrmSuccessPlan, createCrmSurvey, createCrmTask, createCrmTimelineEntry, crmSurveyResponse, expandCrmTaskSchedule, getCrmForecast, getCrmReportSnapshot, getCrmSurveyForm, getCrmTask, isCrmSurveyDeliveryAuthorized, listCrmReportSnapshots, listCrmSuccessPlans, listCrmSurveys, listCrmTasks, listCrmTimeline, revokeCrmSurvey, runCrmTaskReminders, setCrmTaskOccurrence, submitCrmSurvey, updateCrmSuccessPlan, updateCrmTask, updateCrmTimelineEntry };
