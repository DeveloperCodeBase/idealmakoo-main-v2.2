/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { HttpError } from "../src/server/types";
import { query, transaction, closeDb } from "../src/server/db";
import { setCrmGroupMember, createCrmGroup, updateCrmGroup } from "../src/server/workspace-scopes";
import { lockWorkspace, upsertRequestInWorkspace, getWorkspace, assignWorkspaceRecord } from "../src/server/workspace";
import node_test from "node:test";
import strict from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { createCrmCalendar, createCrmRoutingRule, getCrmRequestRouting, updateCrmCalendar, resumeRequestBusinessSla, updateCrmRoutingRule, getCrmRoutingConfiguration } from "../src/server/workspace-routing";
const define_import_meta_default = import.meta;
const database = process.env.TEST_ADMIN_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;
const actor = (role, id, qualityScope = false) => ({ id, role, name: id, email: `${id}@example.invalid`, qualityScope, allowedLocales: ["fa", "en", "tr", "ar", "ru"], mfaVerified: role !== "customer" });
const senior = actor("superAdmin", "routing-senior", true), admin = actor("admin", "routing-admin"), creator = actor("admin", "routing-creator"), first = actor("business", "routing-a"), second = actor("business", "routing-b"), noTerritory = actor("business", "routing-c"), wrongLanguage = actor("business", "routing-d"), noMfa = actor("business", "routing-e"), scientist = actor("scientificReviewer", "routing-quality", true), buyer = actor("customer", "routing-customer");
const expected = (status, code) => error => error instanceof HttpError && error.status === status && (!code || error.code === code);
const definition = { name: "Test export calendar", active: true, timeZone: "UTC", weekdays: [1, 2, 3, 4, 5], intervals: [{ startMinute: 540, endMinute: 1020 }], holidays: ["2026-01-05"], assignmentMinutes: 30, firstResponseMinutes: 60, resolutionMinutes: 120 };
async function membership(kind, id, userId, active = true) { const table = kind === "teams" ? "crm_teams" : "crm_territories"; const version = (await (query)(`SELECT version FROM ${table} WHERE id=$1`, [id])).rows[0].version; return (setCrmGroupMember)(admin, kind, id, userId, active, version); }
async function fixture(id, patch = {}, assignment = {}) { const data = { id, ownerId: buyer.id, kind: "rfq", locale: "en", name: "Private routing customer", email: buyer.email, organization: "Private customer organization", message: "Please route this request.", productIds: [], status: "received", createdAt: "2026-01-02T16:30:00.000Z", version: 1, messages: [], sharedQuotes: [], country: "US", ...patch }; await (transaction)(async (client) => { await (lockWorkspace)(client); await client.query("INSERT INTO requests(id,owner_id,kind,locale,data,quality_quarantined,assignee_id,team_id,territory_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)", [id, buyer.id, data.kind, data.locale, JSON.stringify(data), data.kind === "quality_complaint", assignment.assigneeId || null, assignment.teamId || null, assignment.territoryId || null]); await (upsertRequestInWorkspace)(client, { ...data, qualityQuarantined: data.kind === "quality_complaint" }); }); return data; }
(node_test)("PostgreSQL transactional team round-robin, current scope and versioned working calendars", { timeout: 18e4 }, async (t) => {
    strict.ok(database, "Routing integration requires PostgreSQL; no skipped production authorization gates.");
    const schema = `routing_test_${(randomUUID)().replaceAll("-", "")}`, control = new pg.Client({ connectionString: database });
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
        for (const by of [senior, admin, creator, first, second, noTerritory, wrongLanguage, noMfa, scientist, buyer])
            await (query)("INSERT INTO users(id,email,name,password_hash,role,mfa_enabled,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)", [by.id, by.email, by.name, "non-login routing fixture", by.role, by.id !== noMfa.id && by.mfaVerified, by.qualityScope, JSON.stringify(by.id === wrongLanguage.id ? ["fa"] : by.allowedLocales), "assigned", JSON.stringify({ contact: false, financial: false, baseCost: false, assign: false, intake: true })]);
        await (getWorkspace)(admin);
        const team = await (createCrmGroup)(admin, "teams", { name: "Export service team" }), territory = await (createCrmGroup)(admin, "territories", { name: "US export territory" });
        for (const by of [first, second, noTerritory, wrongLanguage, noMfa, scientist])
            await membership("teams", team.id, by.id);
        for (const by of [first, second, wrongLanguage, noMfa, scientist])
            await membership("territories", territory.id, by.id);
        const calendar = await (createCrmCalendar)(admin, definition);
        const ruleDefinition = { name: "English US RFQ routing", active: true, priority: 10, teamId: team.id, territoryId: territory.id, calendarId: calendar.id, kinds: ["rfq"], locales: ["en"], countries: ["US"] };
        let rule = await (createCrmRoutingRule)(creator, ruleDefinition);
        await t.test("concurrent admissions rotate only eligible current staff and persist one immutable decision per request", async () => { await Promise.all(Array.from({ length: 8 }, (_, index) => fixture(`round-robin-${index}`))); const decisions = (await (query)("SELECT assignee_id,cursor_sequence::text FROM crm_routing_decisions WHERE rule_id=$1 ORDER BY cursor_sequence", [rule.id])).rows; strict.equal(decisions.length, 8); strict.deepEqual(decisions.map(row2 => row2.assignee_id), Array.from({ length: 8 }, (_, index) => index % 2 ? second.id : first.id)); strict.deepEqual(decisions.map(row2 => row2.cursor_sequence), ["1", "2", "3", "4", "5", "6", "7", "8"]); const selected = (await (query)("SELECT id,owner_id,assignee_id FROM requests WHERE id LIKE $1", ["round-robin-%"])).rows; strict.ok(selected.every(row2 => row2.owner_id === buyer.id)); strict.ok(selected.every(row2 => [first.id, second.id].includes(row2.assignee_id))); const row = (await (query)("SELECT data FROM requests WHERE id=$1", [selected[0].id])).rows[0]; await (transaction)(client => (upsertRequestInWorkspace)(client, row.data)); strict.equal((await (query)("SELECT id FROM crm_routing_decisions WHERE rule_id=$1", [rule.id])).rowCount, 8); await strict.rejects((query)("UPDATE crm_routing_decisions SET assignee_id=$1 WHERE request_id=$2", [second.id, selected[0].id]), error => error.code === "23514"); });
        await t.test("the request snapshot keeps real deadline policy and membership revocation removes metadata access immediately", async () => { const row = (await (query)("SELECT id FROM requests WHERE assignee_id=$1 ORDER BY id LIMIT 1", [first.id])).rows[0]; const status = await (getCrmRequestRouting)(first, row.id); strict.equal(status.sla.assignmentDueAt, "2026-01-02T17:00:00.000Z"); strict.equal(status.sla.firstResponseDueAt, "2026-01-06T09:30:00.000Z"); strict.equal(status.sla.resolutionDueAt, "2026-01-06T10:30:00.000Z"); strict.equal(status.sla.calendarVersion, 1); strict.equal(status.decision?.assigneeId, first.id); strict.equal(JSON.stringify(status).includes(buyer.email), false); await membership("territories", territory.id, first.id, false); await strict.rejects((getCrmRequestRouting)(first, row.id), expected(404)); await membership("territories", territory.id, first.id); await strict.rejects((getCrmRequestRouting)(buyer, row.id), expected(404)); });
        await t.test("country and language conditions do not silently route unmatched or excluded HR requests", async () => {
            await fixture("unmatched-country", { country: "CA" });
            await fixture("unmatched-language", { locale: "fa" });
            await fixture("excluded-hr", { kind: "job_application" });
            for (const id of ["unmatched-country", "unmatched-language"]) {
                const status = await (getCrmRequestRouting)(admin, id);
                strict.equal(status.decision?.reason, "no_rule");
                strict.equal(status.decision?.assigneeId, null);
                strict.equal(status.sla.calendarId, "factory-calendar");
            }
            strict.equal((await (getCrmRequestRouting)(admin, "excluded-hr")).decision?.reason, "excluded_kind");
            await fixture("normalized-country", { country: "us" });
            strict.equal((await (getCrmRequestRouting)(admin, "normalized-country")).decision?.ruleId, rule.id);
        });
        await t.test("a missing eligible member leaves a bounded intake case and does not consume a rotation turn", async () => { const cursor = (await (query)("SELECT sequence::text FROM crm_routing_cursors WHERE rule_id=$1", [rule.id])).rows[0].sequence; await membership("territories", territory.id, first.id, false); await membership("territories", territory.id, second.id, false); await fixture("no-candidate"); const status = await (getCrmRequestRouting)(admin, "no-candidate"); strict.equal(status.decision?.reason, "no_candidate"); strict.equal(status.decision?.status, "intake"); strict.equal(status.decision?.teamId, team.id); strict.equal(status.decision?.territoryId, territory.id); strict.equal(status.decision?.assigneeId, null); strict.equal((await (query)("SELECT sequence::text FROM crm_routing_cursors WHERE rule_id=$1", [rule.id])).rows[0].sequence, cursor); await membership("territories", territory.id, first.id); await membership("territories", territory.id, second.id); });
        await t.test("revoking the rule creator prevents future delegation and forged actor roles cannot configure routing", async () => { await (query)("UPDATE users SET active=false WHERE id=$1", [creator.id]); await fixture("creator-revoked"); const status = await (getCrmRequestRouting)(admin, "creator-revoked"); strict.equal(status.decision?.reason, "rule_creator_revoked"); strict.equal(status.decision?.assigneeId, null); strict.equal(status.decision?.teamId, null); await (query)("UPDATE users SET active=true WHERE id=$1", [creator.id]); await strict.rejects((createCrmRoutingRule)({ ...first, role: "superAdmin" }, { ...ruleDefinition, name: "Escalated rule" }), expected(403)); await strict.rejects((createCrmCalendar)(first, { ...definition, name: "Escalated calendar" }), expected(403)); });
        await t.test("quality rules require an explicit administrator grant and assign only an eligible quality specialist", async () => { const quality = { ...ruleDefinition, name: "Quality assignment", priority: 1, kinds: ["quality_complaint"], countries: [] }; await strict.rejects((createCrmRoutingRule)(admin, quality), expected(403, "QUALITY_SCOPE")); const saved = await (createCrmRoutingRule)(senior, quality); await fixture("routed-quality", { kind: "quality_complaint" }); const status = await (getCrmRequestRouting)(senior, "routed-quality"); strict.equal(status.decision?.ruleId, saved.id); strict.equal(status.decision?.assigneeId, scientist.id); strict.equal((await (getCrmRequestRouting)(scientist, "routed-quality")).decision?.assigneeId, scientist.id); await strict.rejects((getCrmRequestRouting)(admin, "routed-quality"), expected(404)); });
        await t.test("explicit manual assignment is preserved and later reassignment leaves customer ownership and initial evidence intact", async () => { await fixture("manual-request", {}, { assigneeId: first.id, teamId: team.id, territoryId: territory.id }); const initial = await (getCrmRequestRouting)(admin, "manual-request"); strict.equal(initial.decision?.reason, "manual_assignment"); strict.equal(initial.decision?.status, "preserved"); await (assignWorkspaceRecord)(admin, { id: "manual-request", assigneeId: second.id, expectedVersion: (await (getWorkspace)(admin)).version }); const row = (await (query)("SELECT owner_id,assignee_id,data FROM requests WHERE id=$1", ["manual-request"])).rows[0]; strict.equal(row.owner_id, buyer.id); strict.equal(row.assignee_id, second.id); await (transaction)(client => (upsertRequestInWorkspace)(client, row.data)); strict.equal((await (getCrmRequestRouting)(admin, "manual-request")).decision?.assigneeId, first.id); strict.ok((await (getCrmRequestRouting)(admin, "manual-request")).sla.lastAssignedAt); await fixture("manual-boundary", {}, { teamId: team.id, territoryId: territory.id }); strict.equal((await (getCrmRequestRouting)(admin, "manual-boundary")).decision?.reason, "manual_assignment"); });
        await t.test("configuration versions are optimistic, archived references are protected and admitted deadlines retain their original calendar", async () => { const updated = await (updateCrmCalendar)(admin, calendar.id, { expectedVersion: calendar.version, value: { ...definition, holidays: [] } }); strict.equal(updated.version, 2); await strict.rejects((updateCrmCalendar)(admin, calendar.id, { expectedVersion: 1, value: definition }), expected(409, "CONFLICT")); await strict.rejects((updateCrmCalendar)(admin, calendar.id, { expectedVersion: 2, value: { ...definition, active: false } }), expected(409, "CALENDAR_IN_USE")); await strict.rejects((updateCrmGroup)(admin, "teams", team.id, { active: false }, (await (query)("SELECT version FROM crm_teams WHERE id=$1", [team.id])).rows[0].version), expected(409)); await fixture("calendar-version-two"); strict.equal((await (getCrmRequestRouting)(admin, "calendar-version-two")).sla.firstResponseDueAt, "2026-01-05T09:30:00.000Z"); strict.equal((await (getCrmRequestRouting)(admin, "round-robin-0")).sla.firstResponseDueAt, "2026-01-06T09:30:00.000Z"); const resumed = await (transaction)(client => (resumeRequestBusinessSla)(client, { calendarId: calendar.id, calendarVersion: 1, pausedAt: "2026-01-02T16:30:00.000Z", resolutionDueAt: "2026-01-06T10:30:00.000Z" }, new Date("2026-01-06T12:00:00.000Z"))); strict.equal(resumed.resolutionDueAt, "2026-01-06T14:00:00.000Z"); strict.equal(resumed.pausedAt, null); await strict.rejects((query)("DELETE FROM crm_calendar_revisions WHERE calendar_id=$1 AND version=1", [calendar.id]), error => error.code === "23514"); rule = await (updateCrmRoutingRule)(creator, rule.id, { expectedVersion: rule.version, value: { ...ruleDefinition, active: false } }); await strict.rejects((updateCrmRoutingRule)(creator, rule.id, { expectedVersion: 1, value: ruleDefinition }), expected(409, "CONFLICT")); await fixture("disabled-rule"); strict.equal((await (getCrmRequestRouting)(admin, "disabled-rule")).decision?.reason, "no_rule"); const current = (await (getCrmRoutingConfiguration)(admin)).calendars.find(row => row.isDefault); const { id: _id, version: _version, isDefault: _default, updatedAt: _updated, ...value } = current; await strict.rejects((updateCrmCalendar)(admin, current.id, { expectedVersion: current.version, value: { ...value, active: false } }), expected(409, "DEFAULT_CALENDAR")); });
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
