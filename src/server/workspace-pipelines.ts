import type {PgRow} from './recovered-db-rows';
import type {WorkspaceRecord} from '../data/workspace-seed';
import type {planWorkspaceMutation} from './workspace-policy';
import type {PipelineDefinition,PipelineStage,PipelineView} from '../types/pipeline';
type PipelineRow = PgRow<'crm_pipelines',{draft:PipelineDefinition|null}>;
type RevisionRow = PgRow<'crm_pipeline_revisions',{definition:PipelineDefinition}>;
type PositionRow = PgRow<'crm_opportunity_positions',{checked_ids:string[]}> & {data:WorkspaceRecord};
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { equal, readableRecord, checksum, serverActivity } from "./workspace-policy";
import { assert } from "./types";
import { loadCrmAccess } from "./workspace-scopes";
import { transaction, audit } from "./db";
import { canWorkspace } from "../lib/auth";
import { parse } from "./http";
import { randomUUID } from "node:crypto";
import { enqueueCrmAutomationEvent } from "./automation";
const locales = ["fa", "en", "tr", "ar", "ru"] as const;
const localized = (max: number) => z.object({ fa: z.string().max(max), en: z.string().max(max), tr: z.string().max(max), ar: z.string().max(max), ru: z.string().max(max) }).strict();
const identity = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const stageIdentity = z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/).refine(value => !["draft", "review", "approved", "published", "scheduled", "archived", "converted", "withdrawn", "constructor", "prototype", "__proto__"].includes(value), "This stage ID is reserved by another workflow.");
const scaled = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0")); };
const percentagePattern = /^\d{1,3}(?:\.\d{1,6})?$/;
const percentage = z.string().regex(percentagePattern).refine(value => percentagePattern.test(value) && scaled(value) <= 100000000n, "Probabilities must be between zero and 100 percent.");
const normalizedPercentage = (value: string) => { const number = scaled(value), fraction = (number % 1000000n).toString().padStart(6, "0").replace(/0+$/, ""); return (number / 1000000n).toString() + (fraction ? "." + fraction : ""); };
const stageSchema = z.object({ id: stageIdentity, title: localized(300), kind: z.enum(["open", "won", "lost"]), probabilityPercentDecimal: percentage, entryChecklist: z.array(z.object({ id: stageIdentity, title: localized(500), required: z.boolean() }).strict()).max(30) }).strict().superRefine((stage, context) => {
    if (!percentagePattern.test(stage.probabilityPercentDecimal))
        return;
    if (stage.kind === "won" && scaled(stage.probabilityPercentDecimal) !== 100000000n || stage.kind === "lost" && scaled(stage.probabilityPercentDecimal) !== 0n)
        context.addIssue({ code: "custom", message: "Won and lost stages require probabilities of 100 and zero respectively." });
    if (new Set(stage.entryChecklist.map(item => item.id)).size !== stage.entryChecklist.length)
        context.addIssue({ code: "custom", message: "Checklist IDs must be unique within a stage." });
});
const pipelineDefinitionSchema = z.object({ schemaVersion: z.literal(1), title: localized(300), active: z.boolean(), stages: z.array(stageSchema).min(1).max(30) }).strict().superRefine((definition, context) => {
    if (definition.stages[0]?.kind !== "open")
        context.addIssue({ code: "custom", message: "The first stage must be open." });
    if (new Set(definition.stages.map(stage => stage.id)).size !== definition.stages.length)
        context.addIssue({ code: "custom", message: "Stage IDs must be unique." });
    const checklistTitles = new Map;
    for (const stage of definition.stages)
        for (const item of stage.entryChecklist) {
            if (checklistTitles.has(item.id) && !(equal)(checklistTitles.get(item.id), item.title))
                context.addIssue({ code: "custom", message: "A reused checklist ID must retain the same meaning in each stage." });
            checklistTitles.set(item.id, item.title);
        }
});
const recordStateSchema = z.object({ schemaVersion: z.literal(1), pipelineId: identity, stageId: stageIdentity, completedChecklistIds: z.array(stageIdentity).max(30).refine(value => new Set(value).size === value.length, "Completed checklist IDs must be unique."), revisionId: z.string().uuid().optional(), probabilityPercentDecimal: percentage.optional() }).strict();
const canManage = (actor: Actor) => actor.mfaVerified && ["superAdmin", "admin"].includes(actor.role) && actor.crmAccess?.scope === "all" && actor.crmAccess.permissions.financial;
function manager(actor: Actor) { (assert)(canManage(actor), 403, "FORBIDDEN", "Pipeline policy management requires a current commercial administrator."); (assert)(locales.every(locale => actor.allowedLocales.includes(locale)), 403, "LOCALE_SCOPE", "The five-language pipeline policy requires an administrator covering all five languages."); }
const normalizeDefinition = (value: PipelineDefinition) => ({ ...value, stages: value.stages.map(stage => ({ ...stage, probabilityPercentDecimal: normalizedPercentage(stage.probabilityPercentDecimal) })) });
const revisionDto = (row: RevisionRow) => ({ id: row.id, pipelineId: row.pipeline_id, revisionNumber: row.revision_number, definition: row.definition, checksum: row.checksum, makerId: row.maker_id, approvedById: row.approved_by, approvedAt: row.approved_at.toISOString(), source: row.source });
async function revision(client: PoolClient, id: string) { return (await client.query<RevisionRow>("SELECT * FROM crm_pipeline_revisions WHERE id=$1", [id])).rows[0]; }
async function currentApprover(client: PoolClient, id: string) { const user = (await client.query<PgRow<'users',{allowed_locales:string[]}>>("SELECT id,name,email,role,quality_scope,allowed_locales FROM users WHERE id=$1 AND active AND mfa_enabled", [id])).rows[0]; return user ? (loadCrmAccess)({ id: user.id, name: user.name, email: user.email, role: user.role, qualityScope: user.quality_scope, allowedLocales: user.allowed_locales, mfaVerified: true }, client) : null; }
async function approvedHead(client: PoolClient, pipeline: PipelineRow) {
    const head = pipeline.active_revision_id ? await revision(client, pipeline.active_revision_id) : void 0;
    if (!head)
        return { head, valid: false };
    if (head.source === "system-default")
        return { head, valid: pipeline.is_default && head.maker_id === null && head.approved_by === null };
    const reviewer = head.approved_by ? await currentApprover(client, head.approved_by) : null;
    return { head, valid: !!reviewer && canManage(reviewer) && locales.every(locale => reviewer.allowedLocales.includes(locale)) && head.maker_id !== head.approved_by };
}
async function unboundOpportunities(client: PoolClient, pipelineId: string) { return (await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("SELECT e.data FROM workspace_entities e WHERE e.bucket='records' AND e.collection='opportunities' AND e.deleted_at IS NULL AND e.status<>'archived' AND NOT EXISTS(SELECT 1 FROM crm_opportunity_positions p WHERE p.opportunity_id=e.id) AND coalesce(e.data#>>'{details,pipeline,pipelineId}',(SELECT id FROM crm_pipelines WHERE is_default))=$1 ORDER BY e.id", [pipelineId])).rows; }
async function view(client: PoolClient, actor: Actor, pipeline: PipelineRow): Promise<PipelineView> {
    const { head, valid } = await approvedHead(client, pipeline), counts: Record<string,number> = {};
    const rows = (await client.query<PositionRow>("SELECT p.stage_id,e.data FROM crm_opportunity_positions p JOIN workspace_entities e ON e.bucket='records' AND e.id=p.opportunity_id WHERE p.pipeline_id=$1 AND p.stage_kind='open' AND e.deleted_at IS NULL AND e.status<>'archived'", [pipeline.id])).rows;
    for (const row of rows)
        if ((readableRecord)(actor, row.data))
            counts[row.stage_id] = (counts[row.stage_id] || 0) + 1;
    const unbound = (await unboundOpportunities(client, pipeline.id)).filter(row => (readableRecord)(actor, row.data));
    const manage = canManage(actor);
    return { id: pipeline.id, version: pipeline.version, isDefault: pipeline.is_default, draft: manage ? pipeline.draft : null, draftMakerId: manage ? pipeline.draft_by : null, activeRevision: head ? revisionDto(head) : null, approvalValid: valid, mayApprove: !!(manage && locales.every(locale => actor.allowedLocales.includes(locale)) && pipeline.draft_by && pipeline.draft_by !== actor.id), openStageCounts: counts, unboundOpportunityCount: unbound.length };
}
async function listCrmPipelines(actor: Actor) {
    return (transaction)(async (client) => {
        await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR SHARE");
        actor = await (loadCrmAccess)(actor, client);
        (assert)(actor.mfaVerified && (canWorkspace)(actor.role, "view", "opportunities"), 403, "FORBIDDEN", "Opportunity access is required.");
        const rows = (await client.query<PipelineRow>("SELECT * FROM crm_pipelines ORDER BY is_default DESC,id")).rows;
        const items = [];
        for (const row of rows)
            if (canManage(actor) || row.active_revision_id)
                items.push(await view(client, actor, row));
        return { items };
    });
}
async function createCrmPipeline(actor: Actor, body: unknown) { const input = (parse)(z.object({ definition: pipelineDefinitionSchema }).strict(), body), definition = normalizeDefinition(input.definition), id = (randomUUID)(); return (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE"); actor = await (loadCrmAccess)(actor, client); manager(actor); const row = (await client.query<PipelineRow>("INSERT INTO crm_pipelines(id,draft,draft_by) VALUES($1,$2::jsonb,$3) RETURNING *", [id, JSON.stringify(definition), actor.id])).rows[0]; await (audit)(actor.id, "crm.pipeline.drafted", "pipeline", id, { version: 1 }, client); return view(client, actor, row); }); }
async function saveCrmPipelineDraft(actor: Actor, id: string, body: unknown) { (parse)(identity, id); const input = (parse)(z.object({ expectedVersion: z.number().int().min(1), definition: pipelineDefinitionSchema }).strict(), body), definition = normalizeDefinition(input.definition); return (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE"); actor = await (loadCrmAccess)(actor, client); manager(actor); const current = (await client.query<PipelineRow>("SELECT * FROM crm_pipelines WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(current, 404, "NOT_FOUND", "Pipeline not found."); (assert)(current.version === input.expectedVersion, 409, "CONFLICT", "This pipeline draft changed. Refresh and retry."); const row = (await client.query<PipelineRow>("UPDATE crm_pipelines SET draft=$2::jsonb,draft_by=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, JSON.stringify(definition), actor.id])).rows[0]; await (audit)(actor.id, "crm.pipeline.drafted", "pipeline", id, { version: row.version }, client); return view(client, actor, row); }); }
function requiredChecklist(stage: PipelineStage, checked: string[], status = 422, code = "PIPELINE_CHECKLIST_REQUIRED") { (assert)(checked.every(id => stage.entryChecklist.some(item => item.id === id)), 422, "PIPELINE_CHECKLIST_ID", "Only checklist items defined by the approved stage may be confirmed."); (assert)(stage.entryChecklist.every(item => !item.required || checked.includes(item.id)), status, code, "Complete every required entry condition for the target stage."); }
async function activePipeline(client: PoolClient, id: string) { const pipeline = (await client.query<PipelineRow>("SELECT * FROM crm_pipelines WHERE id=$1", [id])).rows[0]; (assert)(pipeline, 404, "PIPELINE_NOT_FOUND", "Pipeline not found."); const { head, valid } = await approvedHead(client, pipeline); (assert)(head && valid, 409, "PIPELINE_APPROVAL_REQUIRED", "A current independent pipeline approval is required."); (assert)(head.definition.active, 409, "PIPELINE_INACTIVE", "The pipeline is inactive."); return { pipeline, head }; }
async function normalizeOpportunityChanges(client: PoolClient, actor: Actor, plan: ReturnType<typeof planWorkspaceMutation>) {
    for (const change of plan.changes) {
        if (change.bucket !== "records" || !change.after || change.after.collection !== "opportunities")
            continue;
        const before = change.before, after = change.after;
        const old = before?.details?.pipeline ? (parse)(recordStateSchema, before.details.pipeline) : void 0;
        const supplied = after.details?.pipeline ? (parse)(recordStateSchema, after.details.pipeline) : void 0;
        for (const key of ["revisionId", "probabilityPercentDecimal"] as const)
            if (supplied?.[key] !== void 0)
                (assert)(supplied[key] === old?.[key], 403, "PIPELINE_SERVER_FIELD", "Pipeline approval and probability are server-managed.");
        if (after.status === "archived" && before) {
            (assert)(!supplied || (equal)({ ...supplied, revisionId: void 0, probabilityPercentDecimal: void 0 }, { ...old, revisionId: void 0, probabilityPercentDecimal: void 0 }), 403, "PIPELINE_ARCHIVE_MOVE", "Archive without changing the pipeline position.");
            if (old)
                after.details = { ...after.details, pipeline: old };
            continue;
        }
        const pipelineId = supplied?.pipelineId || old?.pipelineId || (await client.query<PipelineRow>("SELECT id FROM crm_pipelines WHERE is_default")).rows[0]?.id;
        (assert)(pipelineId, 503, "PIPELINE_MISSING", "A default pipeline is required.");
        const changingPipeline = !!before && old?.pipelineId !== void 0 && pipelineId !== old.pipelineId;
        const requestedStage = supplied && supplied.stageId !== old?.stageId ? supplied.stageId : after.status;
        const transition = !before || changingPipeline || requestedStage !== (old?.stageId || before.status);
        let head;
        if (transition || !old?.revisionId)
            head = (await activePipeline(client, pipelineId)).head;
        else {
            const saved = await revision(client, old.revisionId);
            (assert)(saved && saved.pipeline_id === pipelineId, 409, "PIPELINE_POSITION", "The saved pipeline revision is missing.");
            head = saved;
        }
        const targetId = !before && ["new", "draft"].includes(requestedStage) ? head.definition.stages[0].id : requestedStage;
        if (supplied && supplied.stageId !== old?.stageId)
            (assert)(after.status === supplied.stageId || !before && ["new", "draft"].includes(after.status), 422, "PIPELINE_STAGE_MISMATCH", "The record status and selected stage disagree.");
        (assert)(!supplied || supplied.stageId === targetId || supplied.stageId === old?.stageId, 422, "PIPELINE_STAGE_MISMATCH", "The record status and selected stage disagree.");
        const stage = head.definition.stages.find(stage2 => stage2.id === targetId);
        (assert)(stage, 422, "PIPELINE_STAGE", "Select a stage from the approved pipeline.");
        if (!before || changingPipeline)
            (assert)(stage.id === head.definition.stages[0].id, 422, "PIPELINE_INITIAL_STAGE", "New opportunities enter at the first approved stage.");
        if (transition)
            (assert)((canWorkspace)(actor.role, "stage", "opportunities"), 403, "FORBIDDEN", "Changing opportunity stage is not permitted.");
        const checked = [...supplied?.stageId === targetId ? supplied.completedChecklistIds : old?.stageId === targetId ? old.completedChecklistIds : []].sort();
        requiredChecklist(stage, checked);
        const state = { schemaVersion: 1, pipelineId, stageId: stage.id, completedChecklistIds: checked, revisionId: head.id, probabilityPercentDecimal: stage.probabilityPercentDecimal };
        const next = { ...after, status: stage.id, details: { ...after.details, pipeline: state } };
        change.after = next;
        plan.state.records[plan.state.records.findIndex(record => record.id === next.id)] = next;
    }
}
async function persistOpportunityPosition(client: PoolClient, actor: Actor, record: WorkspaceRecord, actionOverride?: PgRow<'crm_pipeline_events'>['action']) {
    if (record.collection !== "opportunities" || !record.details?.pipeline || record.status === "archived")
        return;
    const state = (parse)(recordStateSchema, record.details.pipeline);
    (assert)(state.revisionId && state.probabilityPercentDecimal !== void 0, 500, "PIPELINE_POSITION", "The server pipeline position is incomplete.");
    (assert)(record.status === state.stageId, 409, "PIPELINE_POSITION", "The record and approved stage must agree.");
    const head = await revision(client, state.revisionId), stage = head?.definition.stages.find(stage2 => stage2.id === state.stageId);
    (assert)(head && stage && head.pipeline_id === state.pipelineId, 409, "PIPELINE_POSITION", "The approved stage is missing.");
    const previous = (await client.query<PositionRow>("SELECT *,probability_percent::text FROM crm_opportunity_positions WHERE opportunity_id=$1 FOR UPDATE", [record.id])).rows[0];
    if (previous && previous.revision_id === state.revisionId && previous.stage_id === state.stageId && (equal)(previous.checked_ids, state.completedChecklistIds))
        return;
    const action = actionOverride || (!previous ? "created" : previous.revision_id !== state.revisionId || previous.stage_id !== state.stageId ? "transitioned" : "checklist_updated");
    await client.query<PositionRow>("INSERT INTO crm_opportunity_positions(opportunity_id,pipeline_id,revision_id,stage_id,probability_percent,stage_kind,checked_ids,entered_by) VALUES($1,$2,$3,$4,$5::numeric,$6,$7::jsonb,$8) ON CONFLICT(opportunity_id) DO UPDATE SET pipeline_id=excluded.pipeline_id,revision_id=excluded.revision_id,stage_id=excluded.stage_id,probability_percent=excluded.probability_percent,stage_kind=excluded.stage_kind,checked_ids=excluded.checked_ids,entered_at=CASE WHEN crm_opportunity_positions.stage_id<>excluded.stage_id OR crm_opportunity_positions.pipeline_id<>excluded.pipeline_id THEN now() ELSE crm_opportunity_positions.entered_at END,entered_by=CASE WHEN crm_opportunity_positions.stage_id<>excluded.stage_id OR crm_opportunity_positions.pipeline_id<>excluded.pipeline_id THEN excluded.entered_by ELSE crm_opportunity_positions.entered_by END,updated_at=now()", [record.id, state.pipelineId, state.revisionId, state.stageId, state.probabilityPercentDecimal, stage.kind, JSON.stringify(state.completedChecklistIds), actor.id]);
    await client.query("INSERT INTO crm_pipeline_events(id,opportunity_id,action,from_revision_id,from_stage_id,to_revision_id,to_stage_id,checked_ids,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)", [(randomUUID)(), record.id, action, previous?.revision_id || null, previous?.stage_id || null, state.revisionId, state.stageId, JSON.stringify(state.completedChecklistIds), actor.id]);
}
async function approveCrmPipeline(actor: Actor, id: string, body: unknown) {
    (parse)(identity, id);
    const input = (parse)(z.object({ expectedVersion: z.number().int().min(1), expectedWorkspaceVersion: z.number().int().min(0), stageMapping: z.record(stageIdentity, stageIdentity).refine(value => Object.keys(value).length <= 30) }).strict(), body);
    return (transaction)(async (client) => {
        const meta = (await client.query("SELECT version::text FROM workspace_meta WHERE singleton=true FOR UPDATE")).rows[0];
        actor = await (loadCrmAccess)(actor, client);
        manager(actor);
        (assert)(Number(meta.version) === input.expectedWorkspaceVersion, 409, "CONFLICT", "Opportunities changed. Refresh before approving their migration.");
        const pipeline = (await client.query<PipelineRow>("SELECT * FROM crm_pipelines WHERE id=$1 FOR UPDATE", [id])).rows[0];
        (assert)(pipeline, 404, "NOT_FOUND", "Pipeline not found.");
        (assert)(pipeline.version === input.expectedVersion, 409, "CONFLICT", "The pipeline draft changed.");
        (assert)(pipeline.draft_by && pipeline.draft_by !== actor.id, 403, "PIPELINE_SELF_REVIEW", "A different administrator must approve this saved pipeline draft.");
        const definition = normalizeDefinition((parse)(pipelineDefinitionSchema, pipeline.draft));
        (assert)(locales.every(locale => definition.title[locale].trim()) && definition.stages.every(stage => locales.every(locale => stage.title[locale].trim()) && stage.entryChecklist.every(item => locales.every(locale => item.title[locale].trim()))), 422, "PIPELINE_TRANSLATIONS", "Complete the internal pipeline labels in all five languages.");
        (assert)(!pipeline.is_default || definition.active, 409, "DEFAULT_PIPELINE", "The default pipeline must remain active.");
        (assert)(!(await unboundOpportunities(client, id)).length, 409, "PIPELINE_LEGACY_POSITION", "Save the approved stage of every legacy opportunity before activating a changed pipeline.");
        const positions = (await client.query<PositionRow>("SELECT p.*,p.probability_percent::text,e.data FROM crm_opportunity_positions p JOIN workspace_entities e ON e.bucket='records' AND e.id=p.opportunity_id WHERE p.pipeline_id=$1 AND p.stage_kind='open' AND e.deleted_at IS NULL AND e.status<>'archived' ORDER BY p.opportunity_id FOR UPDATE OF p,e", [id])).rows;
        (assert)(definition.active || !positions.length, 409, "PIPELINE_IN_USE", "Close or move every open opportunity before deactivating its pipeline.");
        const stages = new Map(definition.stages.map(stage => [stage.id, stage]));
        for (const [oldId, targetId] of Object.entries(input.stageMapping)) {
            (assert)(!stages.has(oldId) && positions.some(position => position.stage_id === oldId), 422, "PIPELINE_MAPPING", "Mappings apply to removed occupied stages only.");
            (assert)(stages.get(targetId)?.kind === "open", 422, "PIPELINE_MAPPING_TARGET", "Map open opportunities to an open target stage.");
        }
        const migrations = [];
        for (const position of positions) {
            (assert)((readableRecord)(actor, position.data), 403, "PIPELINE_RECORD_SCOPE", "This activation affects an opportunity outside the reviewer scope.");
            const stage = stages.get(position.stage_id) || stages.get(input.stageMapping[position.stage_id]);
            (assert)(stage, 409, "PIPELINE_MAPPING_REQUIRED", "A removed stage contains open opportunities; supply an explicit destination mapping.");
            (assert)(stage.kind === "open", 409, "PIPELINE_MAPPING_TARGET", "An occupied open stage cannot be converted into a terminal outcome by configuration.");
            const previousRevision = await revision(client, position.revision_id), previousStage = previousRevision?.definition.stages.find(stage2 => stage2.id === position.stage_id);
            const checked = position.checked_ids.filter(id2 => stage.entryChecklist.some(item => item.id === id2 && previousStage?.entryChecklist.some(before => before.id === id2 && (equal)(before.title, item.title))));
            requiredChecklist(stage, checked, 409, "PIPELINE_MAPPING_CHECKLIST");
            migrations.push({ previous: position.data, stage, checked });
        }
        const revisionId = (randomUUID)(), revisionNumber = (await client.query<{next:number}>("SELECT coalesce(max(revision_number),0)+1 AS next FROM crm_pipeline_revisions WHERE pipeline_id=$1", [id])).rows[0].next;
        await client.query<RevisionRow>("INSERT INTO crm_pipeline_revisions(id,pipeline_id,revision_number,definition,checksum,maker_id,approved_by,source) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,'reviewed')", [revisionId, id, revisionNumber, JSON.stringify(definition), (checksum)(definition), pipeline.draft_by, actor.id]);
        for (const [position, stage] of definition.stages.entries())
            await client.query("INSERT INTO crm_pipeline_stages(revision_id,stage_id,position,title,kind,probability_percent,entry_checklist) VALUES($1,$2,$3,$4::jsonb,$5,$6::numeric,$7::jsonb)", [revisionId, stage.id, position, JSON.stringify(stage.title), stage.kind, stage.probabilityPercentDecimal, JSON.stringify(stage.entryChecklist)]);
        for (const migration of migrations) {
            const previous = migration.previous, pipelineState = { schemaVersion: 1, pipelineId: id, stageId: migration.stage.id, completedChecklistIds: migration.checked, revisionId, probabilityPercentDecimal: migration.stage.probabilityPercentDecimal };
            const event = (serverActivity)(actor, "pipeline_reconfigured", previous.id), record = { ...previous, status: migration.stage.id, details: { ...previous.details, pipeline: pipelineState }, history: [...previous.history, event], updatedAt: new Date().toISOString() };
            await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("UPDATE workspace_entities SET data=$2::jsonb,status=$3,revision_number=revision_number+1,updated_by=$4,updated_at=now() WHERE bucket='records' AND id=$1", [record.id, JSON.stringify(record), record.status, actor.id]);
            await persistOpportunityPosition(client, actor, record, "reconfigured");
            await (enqueueCrmAutomationEvent)(client, actor, previous, record);
        }
        const row = (await client.query<PipelineRow>("UPDATE crm_pipelines SET active_revision_id=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, revisionId])).rows[0];
        const workspaceVersion = Number((await client.query("UPDATE workspace_meta SET version=version+1,updated_at=now() WHERE singleton=true RETURNING version::text")).rows[0].version);
        await (audit)(actor.id, "crm.pipeline.approved", "pipeline", id, { revisionId, revisionNumber, migratedOpportunities: migrations.length, stageMapping: input.stageMapping }, client);
        return { pipeline: await view(client, actor, row), workspaceVersion };
    });
}
export { approveCrmPipeline, createCrmPipeline, listCrmPipelines, normalizeOpportunityChanges, persistOpportunityPosition, pipelineDefinitionSchema, saveCrmPipelineDraft };
