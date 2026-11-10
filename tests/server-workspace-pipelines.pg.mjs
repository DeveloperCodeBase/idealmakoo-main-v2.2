/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { HttpError } from "../src/server/types";
import { recordText } from "../src/data/workspace-seed";
import { getWorkspace, saveWorkspace } from "../src/server/workspace";
import strict from "node:assert/strict";
import { query, closeDb } from "../src/server/db";
import { listCrmPipelines, approveCrmPipeline, createCrmPipeline, saveCrmPipelineDraft, pipelineDefinitionSchema } from "../src/server/workspace-pipelines";
import node_test from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
const define_import_meta_default = import.meta;
const database = process.env.TEST_ADMIN_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;
const actor = (role, id, qualityScope = false) => ({ id, role, name: id, email: `${id}@example.invalid`, qualityScope, allowedLocales: ["fa", "en", "tr", "ar", "ru"], mfaVerified: role !== "customer" });
const maker = actor("admin", "pipeline-maker", true), reviewer = actor("admin", "pipeline-reviewer", true), alternate = actor("admin", "pipeline-alternate", true), withoutQuality = actor("admin", "pipeline-unscoped"), seller = actor("business", "pipeline-seller"), outsider = actor("business", "pipeline-outsider"), customer = actor("customer", "pipeline-customer");
const expected = (status, code) => error => error instanceof HttpError && error.status === status && (!code || error.code === code);
const definition = (name = "Test pipeline") => ({ schemaVersion: 1, title: (recordText)(name), active: true, stages: [{ id: "new", title: (recordText)("New"), kind: "open", probabilityPercentDecimal: "0", entryChecklist: [] }, { id: "qualified", title: (recordText)("Qualified"), kind: "open", probabilityPercentDecimal: "33.333333", entryChecklist: [{ id: "need_confirmed", title: (recordText)("Confirm the customer need"), required: true }] }, { id: "proposal", title: (recordText)("Proposal"), kind: "open", probabilityPercentDecimal: "60", entryChecklist: [{ id: "need_confirmed", title: (recordText)("Confirm the customer need"), required: true }] }, { id: "won", title: (recordText)("Won"), kind: "won", probabilityPercentDecimal: "100", entryChecklist: [] }, { id: "lost", title: (recordText)("Lost"), kind: "lost", probabilityPercentDecimal: "0", entryChecklist: [] }] });
const record = (id, patch = {}) => ({ id, collection: "opportunities", title: (recordText)(id), summary: (recordText)("Customer need under assessment"), status: "new", owner: "business", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [], tags: [], demo: false, ...patch });
const pipelineState = (pipelineId, stageId = "new", completedChecklistIds = []) => ({ schemaVersion: 1, pipelineId, stageId, completedChecklistIds });
async function create(by, row) { const workspace = await (getWorkspace)(by); return (saveWorkspace)(by, { state: { ...workspace.state, records: [...workspace.state.records, row] }, expectedVersion: workspace.version }); }
async function edit(by, id, patch) { const workspace = await (getWorkspace)(by), current2 = workspace.state.records.find(row => row.id === id); strict.ok(current2, `Fixture ${id} must be visible to ${by.id}`); return (saveWorkspace)(by, { state: { ...workspace.state, records: workspace.state.records.map(row => row.id === id ? { ...row, ...typeof patch === "function" ? patch(row) : patch } : row) }, expectedVersion: workspace.version }); }
async function move(by, id, stageId, completedChecklistIds = []) { return edit(by, id, row => ({ status: stageId, details: { ...row.details, pipeline: { ...row.details?.pipeline, stageId, completedChecklistIds } } })); }
async function raw(id) { return (await (query)("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1", [id])).rows[0].data; }
async function current(id, by = maker) { return (await (listCrmPipelines)(by)).items.find(row => row.id === id); }
async function approve(id, by = reviewer, mapping = {}) { const saved = await current(id, by); return (approveCrmPipeline)(by, id, { expectedVersion: saved.version, expectedWorkspaceVersion: (await (getWorkspace)(by)).version, stageMapping: mapping }); }
async function approved(value = definition()) { const draft2 = await (createCrmPipeline)(maker, { definition: value }); return (await approve(draft2.id)).pipeline; }
async function draft(id, value) { const saved = await current(id); return (saveCrmPipelineDraft)(maker, id, { expectedVersion: saved.version, definition: value }); }
(node_test)("Pipeline schema rejects malformed probabilities and ambiguous stage/checklist identities without throwing native errors", () => {
    for (const value of ["NaN", "1e2", "-1", "101", "100.000001", "1.1234567"])
        strict.equal(pipelineDefinitionSchema.safeParse({ ...definition(), stages: [{ ...definition().stages[0], probabilityPercentDecimal: value }] }).success, false);
    strict.equal(pipelineDefinitionSchema.safeParse({ ...definition(), stages: [] }).success, false);
    strict.equal(pipelineDefinitionSchema.safeParse({ ...definition(), stages: [{ ...definition().stages[0], id: "approved" }] }).success, false);
    const duplicate = definition();
    duplicate.stages[2].entryChecklist[0].title = (recordText)("A different meaning");
    strict.equal(pipelineDefinitionSchema.safeParse(duplicate).success, false);
    const wrongOutcome = definition();
    wrongOutcome.stages[3].probabilityPercentDecimal = "90";
    strict.equal(pipelineDefinitionSchema.safeParse(wrongOutcome).success, false);
});
(node_test)("PostgreSQL approved pipeline revisions, scoped opportunities and transactional stage migration", { timeout: 24e4 }, async (t) => {
    strict.ok(database, "Pipeline integration requires PostgreSQL. Missing database must fail the production workflow gate.");
    const schema = `pipeline_test_${(randomUUID)().replaceAll("-", "")}`, control = new pg.Client({ connectionString: database });
    await control.connect();
    await control.query(`CREATE SCHEMA ${schema}`);
    const previous = process.env.DATABASE_URL, previousDemo = process.env.DEMO_MODE, scoped = new URL(database);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = scoped.toString();
    delete process.env.DEMO_MODE;
    await (closeDb)();
    try {
        const migration = new pg.Client({ connectionString: scoped.toString() });
        await migration.connect();
        try {
            for (const filename of (await (readdir)(new URL("../db/migrations/", define_import_meta_default.url))).filter(name => name.endsWith(".sql")).sort())
                await migration.query(await (readFile)(new URL(`../db/migrations/${filename}`, define_import_meta_default.url), "utf8"));
        }
        finally {
            await migration.end();
        }
        for (const by of [maker, reviewer, alternate, withoutQuality, seller, outsider, customer])
            await (query)("INSERT INTO users(id,email,name,password_hash,role,mfa_enabled,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)", [by.id, by.email, by.name, "non-login pipeline fixture", by.role, by.mfaVerified, by.qualityScope, JSON.stringify(by.allowedLocales), "assigned", JSON.stringify({ contact: false, financial: by.id === seller.id, baseCost: false, assign: false, intake: false })]);
        await (getWorkspace)(maker);
        await t.test("the default is an explicit system policy, unpublished drafts stay private and approval requires another current administrator", async () => { const initial = await (listCrmPipelines)(seller); strict.equal(initial.items.length, 1); strict.equal(initial.items[0].activeRevision?.source, "system-default"); strict.equal(initial.items[0].activeRevision?.approvedById, null); strict.equal(initial.items[0].draft, null); strict.equal(initial.items[0].approvalValid, true); const saved = await (createCrmPipeline)(maker, { definition: definition("Private policy draft") }); strict.equal(saved.activeRevision, null); strict.equal((await (listCrmPipelines)(seller)).items.some(row => row.id === saved.id), false); await strict.rejects(approve(saved.id, maker), expected(403, "PIPELINE_SELF_REVIEW")); await strict.rejects((createCrmPipeline)({ ...seller, role: "admin" }, { definition: definition() }), expected(403)); await strict.rejects((listCrmPipelines)(customer), expected(403)); const active = await approve(saved.id); strict.equal(active.pipeline.activeRevision?.makerId, maker.id); strict.equal(active.pipeline.activeRevision?.approvedById, reviewer.id); strict.equal(active.pipeline.activeRevision?.source, "reviewed"); strict.equal((await current(saved.id, seller)).draft, null); });
        await t.test("new opportunities receive a server position; arbitrary stages, initial terminal outcomes and claimed probabilities are rejected", async () => {
            await create(seller, record("default-opportunity"));
            const saved = await raw("default-opportunity"), state = saved.details?.pipeline;
            strict.equal(saved.ownerId, seller.id);
            strict.equal(state.pipelineId, "default-sales");
            strict.equal(state.probabilityPercentDecimal, "0");
            strict.ok(state.revisionId);
            for (const status of ["unexpected", "won"])
                await strict.rejects(create(seller, record(`forged-${status}`, { status })), expected(422));
            await strict.rejects(create(seller, record("forged-initial-probability", { details: { pipeline: { ...pipelineState("default-sales"), probabilityPercentDecimal: "100" } } })), expected(403, "PIPELINE_SERVER_FIELD"));
            await strict.rejects(edit(seller, saved.id, row => ({ details: { ...row.details, pipeline: { ...state, probabilityPercentDecimal: "99" } } })), expected(403, "PIPELINE_SERVER_FIELD"));
            await strict.rejects(edit(seller, saved.id, row => ({ details: { ...row.details, pipeline: { ...state, revisionId: (randomUUID)() } } })), expected(403, "PIPELINE_SERVER_FIELD"));
            await edit(seller, saved.id, { status: "proposal" });
            strict.equal((await raw(saved.id)).status, "proposal");
            strict.equal(((await raw(saved.id)).details?.pipeline).probabilityPercentDecimal, "60");
            strict.equal((await (query)("SELECT * FROM crm_pipeline_events WHERE opportunity_id=$1", [saved.id])).rowCount, 2);
        });
        await t.test("required entry conditions and exact approved decimal probability survive every workspace update path", async () => { const policy = await approved(); await create(seller, record("checklisted", { details: { pipeline: pipelineState(policy.id) } })); await strict.rejects(move(seller, "checklisted", "qualified"), expected(422, "PIPELINE_CHECKLIST_REQUIRED")); await strict.rejects(move(seller, "checklisted", "qualified", ["invented"]), expected(422, "PIPELINE_CHECKLIST_ID")); await move(seller, "checklisted", "qualified", ["need_confirmed"]); const saved = await raw("checklisted"); strict.equal((saved.details?.pipeline).probabilityPercentDecimal, "33.333333"); await strict.rejects(move(seller, "checklisted", "qualified", []), expected(422, "PIPELINE_CHECKLIST_REQUIRED")); await strict.rejects(edit(seller, "checklisted", row => ({ status: "proposal", details: { ...row.details, pipeline: { ...row.details?.pipeline, stageId: "won" } } })), expected(422, "PIPELINE_STAGE_MISMATCH")); await edit(seller, "checklisted", { details: { pipeline: { schemaVersion: 1, pipelineId: policy.id, stageId: "qualified", completedChecklistIds: ["need_confirmed"] } } }); strict.ok(((await raw("checklisted")).details?.pipeline).revisionId); strict.equal((await (query)("SELECT probability_percent::text AS probability FROM crm_opportunity_positions WHERE opportunity_id=$1", ["checklisted"])).rows[0].probability, "33.333333"); await strict.rejects((query)("UPDATE crm_opportunity_positions SET probability_percent=99 WHERE opportunity_id=$1", ["checklisted"]), error => error.code === "23503"); });
        await t.test("stage removal cannot implicitly move or close occupied opportunities; explicit valid mapping is atomic and auditable", async () => { const policy = await approved(definition("Migration policy")); await create(seller, record("migrating-open", { details: { pipeline: pipelineState(policy.id) } })); await create(seller, record("historic-won", { details: { pipeline: pipelineState(policy.id) } })); await move(seller, "migrating-open", "qualified", ["need_confirmed"]); await move(seller, "historic-won", "won"); const oldClosed = (await raw("historic-won")).details?.pipeline; const changed = definition("Migration policy v2"); changed.stages = changed.stages.filter(stage => stage.id !== "qualified"); changed.stages.find(stage => stage.id === "proposal").probabilityPercentDecimal = "72.125"; await draft(policy.id, changed); const beforeVersion = (await (getWorkspace)(maker)).version, beforeRevisions = (await (query)("SELECT id FROM crm_pipeline_revisions WHERE pipeline_id=$1", [policy.id])).rowCount; await strict.rejects(approve(policy.id), expected(409, "PIPELINE_MAPPING_REQUIRED")); await strict.rejects(approve(policy.id, reviewer, { qualified: "won" }), expected(422, "PIPELINE_MAPPING_TARGET")); strict.equal((await (getWorkspace)(maker)).version, beforeVersion); strict.equal((await (query)("SELECT id FROM crm_pipeline_revisions WHERE pipeline_id=$1", [policy.id])).rowCount, beforeRevisions); strict.equal((await raw("migrating-open")).status, "qualified"); const result = await approve(policy.id, reviewer, { qualified: "proposal" }); const opened = await raw("migrating-open"), state = opened.details?.pipeline; strict.equal(state.stageId, "proposal"); strict.equal(state.probabilityPercentDecimal, "72.125"); strict.equal(state.revisionId, result.pipeline.activeRevision?.id); strict.equal(result.workspaceVersion, beforeVersion + 1); strict.equal(opened.ownerId, seller.id); strict.deepEqual((await raw("historic-won")).details?.pipeline, oldClosed); strict.equal((await (query)("SELECT action FROM crm_pipeline_events WHERE opportunity_id=$1 ORDER BY created_at DESC LIMIT 1", ["migrating-open"])).rows[0].action, "reconfigured"); await strict.rejects((query)("UPDATE crm_pipeline_revisions SET definition='{}'::jsonb WHERE id=$1", [state.revisionId]), error => error.code === "23514"); await strict.rejects((query)("DELETE FROM crm_pipeline_events WHERE opportunity_id=$1", ["migrating-open"]), error => error.code === "23514"); });
        await t.test("a configuration cannot silently assert newly required conditions or reinterpret an existing open stage as won", async () => { const policy = await approved(definition("Conditions policy")); await create(seller, record("new-conditions", { details: { pipeline: pipelineState(policy.id) } })); await move(seller, "new-conditions", "qualified", ["need_confirmed"]); const changed = definition("New conditions"); changed.stages[1].entryChecklist.push({ id: "budget_confirmed", title: (recordText)("Confirm budget"), required: true }); await draft(policy.id, changed); await strict.rejects(approve(policy.id), expected(409, "PIPELINE_MAPPING_CHECKLIST")); const terminal = definition("Terminal reinterpretation"); terminal.stages[1] = { ...terminal.stages[1], kind: "won", probabilityPercentDecimal: "100" }; await draft(policy.id, terminal); await strict.rejects(approve(policy.id), expected(409, "PIPELINE_MAPPING_TARGET")); strict.equal((await raw("new-conditions")).status, "qualified"); const titleChanged = definition(); titleChanged.stages[1].entryChecklist[0].title = (recordText)("Another confirmation"); titleChanged.stages[2].entryChecklist[0].title = (recordText)("Another confirmation"); await draft(policy.id, titleChanged); await strict.rejects(approve(policy.id), expected(409, "PIPELINE_MAPPING_CHECKLIST")); });
        await t.test("draft versions and workspace versions resolve competing activation and record changes without lost edits", async () => { const policy = await approved(definition("Concurrent policy")); await create(seller, record("concurrent-opportunity", { details: { pipeline: pipelineState(policy.id) } })); const saved = await draft(policy.id, definition("Concurrent policy revised")); await strict.rejects((saveCrmPipelineDraft)(maker, policy.id, { expectedVersion: saved.version - 1, definition: definition() }), expected(409, "CONFLICT")); const workspace = await (getWorkspace)(seller), competing = { state: { ...workspace.state, records: workspace.state.records.map(row => row.id === "concurrent-opportunity" ? { ...row, priority: "high" } : row) }, expectedVersion: workspace.version }; const results = await Promise.allSettled([(approveCrmPipeline)(reviewer, policy.id, { expectedVersion: saved.version, expectedWorkspaceVersion: workspace.version, stageMapping: {} }), (saveWorkspace)(seller, competing)]); strict.equal(results.filter(result => result.status === "fulfilled").length, 1); const failure = results.find(result => result.status === "rejected"); strict.ok(expected(409)(failure.reason)); const currentVersion = (await (getWorkspace)(seller)).version; strict.equal(currentVersion, workspace.version + 1); });
        await t.test("reviewer revocation prevents new positions while historical positions remain readable and unrelated notes remain editable", async () => {
            const policy = await approved(definition("Revocation policy"));
            await create(seller, record("reviewer-revoked-opportunity", { details: { pipeline: pipelineState(policy.id) } }));
            await (query)("UPDATE users SET active=false WHERE id=$1", [reviewer.id]);
            try {
                strict.equal((await current(policy.id, seller)).approvalValid, false);
                await strict.rejects(move(seller, "reviewer-revoked-opportunity", "qualified", ["need_confirmed"]), expected(409, "PIPELINE_APPROVAL_REQUIRED"));
                await strict.rejects(create(seller, record("revoked-new", { details: { pipeline: pipelineState(policy.id) } })), expected(409, "PIPELINE_APPROVAL_REQUIRED"));
                await edit(seller, "reviewer-revoked-opportunity", { summary: (recordText)("An unrelated operational note") });
                const reapproved = await approve(policy.id, alternate);
                strict.equal(reapproved.pipeline.activeRevision?.approvedById, alternate.id);
                await move(seller, "reviewer-revoked-opportunity", "qualified", ["need_confirmed"]);
            }
            finally {
                await (query)("UPDATE users SET active=true WHERE id=$1", [reviewer.id]);
            }
        });
        await t.test("pipeline configuration never grants access to hidden opportunities or bypasses explicit quality and financial field scopes", async () => {
            const policy = await approved(definition("Scope policy"));
            await create(seller, record("private-opportunity", { amount: "1500", currency: "USD", details: { pipeline: pipelineState(policy.id) } }));
            strict.equal((await current(policy.id, outsider)).openStageCounts.new, void 0);
            const workspace = await (getWorkspace)(outsider);
            const hidden = await raw("private-opportunity");
            await strict.rejects((saveWorkspace)(outsider, { state: { ...workspace.state, records: [...workspace.state.records, { ...hidden, status: "qualified" }] }, expectedVersion: workspace.version }), expected(403));
            await (query)("UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1", [seller.id, JSON.stringify({ contact: false, financial: false, baseCost: false, assign: false, intake: false })]);
            try {
                strict.equal((await (getWorkspace)(seller)).state.records.find(row => row.id === hidden.id)?.amount, void 0);
                await move(seller, hidden.id, "qualified", ["need_confirmed"]);
                strict.equal((await raw(hidden.id)).amount, "1500");
            }
            finally {
                await (query)("UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1", [seller.id, JSON.stringify({ contact: false, financial: true, baseCost: false, assign: false, intake: false })]);
            }
            await create(maker, record("quality-opportunity", { tags: ["quality"], details: { pipeline: pipelineState(policy.id) } }));
            await draft(policy.id, definition("Scope revision"));
            await strict.rejects(approve(policy.id, withoutQuality), expected(403, "PIPELINE_RECORD_SCOPE"));
            await approve(policy.id, reviewer);
        });
        await t.test("deactivation, translations and switching pipeline preserve explicit entry and terminal history semantics", async () => {
            const policy = await approved(definition("Deactivate policy"));
            await create(seller, record("deactivate-open", { details: { pipeline: pipelineState(policy.id) } }));
            await draft(policy.id, { ...definition(), active: false });
            await strict.rejects(approve(policy.id), expected(409, "PIPELINE_IN_USE"));
            await move(seller, "deactivate-open", "lost");
            await approve(policy.id);
            await strict.rejects(create(seller, record("inactive-new", { details: { pipeline: pipelineState(policy.id) } })), expected(409, "PIPELINE_INACTIVE"));
            const target = await approved(definition("Switch destination"));
            await strict.rejects(edit(seller, "deactivate-open", { status: "qualified", details: { pipeline: pipelineState(target.id, "qualified", ["need_confirmed"]) } }), expected(422, "PIPELINE_INITIAL_STAGE"));
            await edit(seller, "deactivate-open", { status: "new", details: { pipeline: pipelineState(target.id) } });
            strict.equal(((await raw("deactivate-open")).details?.pipeline).pipelineId, target.id);
            const incomplete = definition("Incomplete translations");
            incomplete.stages[0].title.ru = "";
            const pending = await (createCrmPipeline)(maker, { definition: incomplete });
            await strict.rejects(approve(pending.id), expected(422, "PIPELINE_TRANSLATIONS"));
            await (query)("UPDATE users SET allowed_locales=$2::jsonb WHERE id=$1", [alternate.id, JSON.stringify(["en"])]);
            try {
                await strict.rejects((createCrmPipeline)(alternate, { definition: definition() }), expected(403, "LOCALE_SCOPE"));
            }
            finally {
                await (query)("UPDATE users SET allowed_locales=$2::jsonb WHERE id=$1", [alternate.id, JSON.stringify(alternate.allowedLocales)]);
            }
        });
        await t.test("legacy opportunities cannot disappear from stage-removal analysis and must bind to an approved position before activation", async () => { const legacy = record("legacy-opportunity", { status: "working", ownerId: seller.id }); await (query)("INSERT INTO workspace_entities(bucket,id,collection,status,owner_id,data,created_by,updated_by) VALUES('records',$1,'opportunities',$2,'business',$3::jsonb,$4,$4)", [legacy.id, legacy.status, JSON.stringify(legacy), seller.id]); const previous2 = (await current("default-sales")).activeRevision.definition; await draft("default-sales", previous2); strict.equal((await current("default-sales", seller)).unboundOpportunityCount, 1); await strict.rejects(approve("default-sales"), expected(409, "PIPELINE_LEGACY_POSITION")); await edit(seller, legacy.id, { details: { pipeline: pipelineState("default-sales", "working") } }); strict.equal((await current("default-sales")).unboundOpportunityCount, 0); const changed = { ...previous2, stages: previous2.stages.filter(stage => stage.id !== "working") }; await draft("default-sales", changed); await strict.rejects(approve("default-sales"), expected(409, "PIPELINE_MAPPING_REQUIRED")); await approve("default-sales", reviewer, { working: "new" }); strict.equal((await raw(legacy.id)).status, "new"); strict.equal((await (query)("SELECT opportunity_id FROM crm_opportunity_positions WHERE opportunity_id=$1", [legacy.id])).rowCount, 1); });
    }
    finally {
        await (closeDb)();
        if (previous === void 0)
            delete process.env.DATABASE_URL;
        else
            process.env.DATABASE_URL = previous;
        if (previousDemo === void 0)
            delete process.env.DEMO_MODE;
        else
            process.env.DEMO_MODE = previousDemo;
        try {
            await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        }
        finally {
            await control.end();
        }
    }
});
