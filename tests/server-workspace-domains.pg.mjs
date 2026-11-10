/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { HttpError } from "../src/server/types";
import { recordText } from "../src/data/workspace-seed";
import { getWorkspace, saveWorkspace, importCrmWorkspaceRecord } from "../src/server/workspace";
import { saveCrmDomain, getCrmDomain, domainEvidence } from "../src/server/workspace-domain-core";
import { query, closeDb, transaction } from "../src/server/db";
import { createRequest, getRequest, patchRequest } from "../src/server/requests";
import { products } from "../src/data/catalog";
import { randomUUID } from "node:crypto";
import { storeAsset } from "../src/server/storage";
import { requestCrmEndpointVerification, canDeliverCrmEndpointVerification, confirmCrmContactEndpoint, resolveCrmContactRecipient } from "../src/server/workspace-domain-endpoints";
import { decrypt } from "../src/server/crypto";
import strict from "node:assert/strict";
import node_test from "node:test";
import { domainDefinitionSchema } from "../src/server/workspace-domain-schema";
import pg from "pg";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deliverOutbox } from "../src/server/notifications";
import { mergeCrmRecords, unmergeCrmRecords } from "../src/components/workspace/crm-tools-logic";
import { convertCrmLead, transitionCrmSample, transitionCrmHandoff } from "../src/server/workspace-domain-operations";
import { deleteMedia, assetResponse, crmEvidenceResponse } from "../src/server/media";
const define_import_meta_default = import.meta;
const database = process.env.TEST_ADMIN_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;
const makeActor = (role, id, qualityScope = false) => ({ role, id, name: id, email: id + "@example.invalid", qualityScope, allowedLocales: ["fa", "en", "tr", "ar", "ru"], mfaVerified: role !== "customer" });
const seller = makeActor("business", "domain-seller"), reader = makeActor("business", "domain-reader"), outsider = makeActor("business", "domain-outsider"), admin = makeActor("admin", "domain-admin", true), customer = makeActor("customer", "domain-customer");
const grants = { contact: true, financial: true, baseCost: false, assign: true, intake: true };
const expected = (status, code) => error => error instanceof HttpError && error.status === status && (!code || error.code === code);
const record = (id, collection, extra = {}) => ({ id, collection, title: (recordText)(id), summary: (recordText)("Domain integration fixture"), status: "new", owner: "business", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [], tags: [], demo: false, ...extra });
const account = (name = "Independent Laboratory") => ({ schemaVersion: 1, kind: "account", displayName: name, legalName: name + " Ltd", activity: "laboratory", lifecycle: "prospect", parentAccountId: null, registrations: [{ scheme: "company", value: name, countryCode: "TR" }], addresses: [], branches: [] });
const contact = (name = "Contact Person", email = "buying@example.invalid") => ({ schemaVersion: 1, kind: "contact", givenName: "Contact", familyName: "Person", displayName: name, locale: "en", affiliations: [], endpoints: [{ channel: "email", value: email, label: "Purchasing office", active: true }] });
const qualification = { schemaVersion: 1, kind: "lead", needConfirmed: true, contactConfirmed: true, authorityConfirmed: true, timeframeConfirmed: true, notes: "Confirmed real product need and authorized contact." };
const opportunity = (accountId, contactIds = []) => ({ schemaVersion: 1, kind: "opportunity", locale: "en", accountId: accountId || null, contactIds, requestIds: [], items: [] });
const req = () => new Request("http://localhost:3000/api/v1/test", { headers: { "x-forwarded-for": "203.0.113.84" } });
const version = async (by = seller) => (await (getWorkspace)(by)).version;
async function create(by, id, collection, extra = {}) { const view = await (getWorkspace)(by); return (saveWorkspace)(by, { expectedVersion: view.version, state: { ...view.state, records: [...view.state.records, record(id, collection, extra)] } }); }
async function edit(by, id, patch) { const view = await (getWorkspace)(by); return (saveWorkspace)(by, { expectedVersion: view.version, state: { ...view.state, records: view.state.records.map(row => row.id === id ? { ...row, ...patch } : row) } }); }
async function define(by, id, value) { return (saveCrmDomain)(by, id, { expectedVersion: await version(by), value }); }
async function raw(id) { return (await (query)("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1", [id])).rows[0]?.data; }
async function request(kind = "sample_request", actor = customer, extra = {}) { return (createRequest)(req(), actor, { kind, name: "Actual sample customer", email: actor.email, organization: "Customer laboratory", message: "Specific customer request", productIds: [products[0].id], locale: "en", consent: { purpose: "request_processing", acceptedAt: new Date().toISOString() }, ...extra }, (randomUUID)()); }
async function asset(by = admin, scanStatus = "clean") { return (storeAsset)({ ownerId: by.id, name: "retained-evidence.pdf", bytes: Buffer.from("%PDF-1.7\nPrivate retained fixture\n%%EOF"), mimeType: "application/pdf", extension: "pdf", visibility: "private", scanStatus, metadata: {} }); }
async function verifyToken(contactId, endpointId) { await (requestCrmEndpointVerification)(seller, contactId, endpointId, { locale: "en" }); const row = (await (query)("SELECT payload FROM outbox WHERE crm_contact_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [contactId])).rows[0]; const payload = JSON.parse((decrypt)(row.payload.encrypted)); const url = new URL(String(payload.text).match(/https?:\/\/\S+/)[0]); strict.equal(url.pathname, "/en/auth/login/"); return { token: url.searchParams.get("contactVerification"), payload }; }
(node_test)("CRM domain schemas reject impossible dates, forged verification and approximate or malformed quantities", () => {
    strict.equal(domainDefinitionSchema.safeParse({ ...contact(), endpoints: [{ ...contact().endpoints[0], verifiedAt: new Date().toISOString() }] }).success, false);
    strict.equal(domainDefinitionSchema.safeParse({ ...contact(), affiliations: [{ accountId: "account", branchId: null, role: "Buyer", validFrom: "2026-02-30", validTo: null }] }).success, false);
    for (const quantityDecimal of ["1e9", "NaN", "-1", "0", "1.0000001"])
        strict.equal(domainDefinitionSchema.safeParse({ ...opportunity(), items: [{ productId: products[0].id, variantId: null, unit: "box", quantityDecimal, note: "" }] }).success, false);
});
(node_test)("PostgreSQL typed CRM profiles, conversions, evidence, endpoint consent and lifecycle invariants", { timeout: 36e4 }, async (t) => {
    strict.ok(database, "CRM domain integration requires a real PostgreSQL database.");
    const schema = "crm_domain_" + (randomUUID)().replaceAll("-", ""), control = new pg.Client({ connectionString: database });
    await control.connect();
    await control.query(`CREATE SCHEMA ${schema}`);
    const names = ["DATABASE_URL", "DEMO_MODE", "STORAGE_DIR", "NODE_ENV", "PRIVACY_LEDGER_DIR", "SESSION_SECRET", "MFA_ENCRYPTION_KEY", "SITE_URL"], previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const scoped = new URL(database);
    scoped.searchParams.set("options", "-c search_path=" + schema);
    const storage = await (mkdtemp)((join)((tmpdir)(), "ideal-crm-domain-"));
    Object.assign(process.env, { DATABASE_URL: scoped.toString(), STORAGE_DIR: storage, NODE_ENV: "test", SESSION_SECRET: "crm-domain-integration-session-secret", MFA_ENCRYPTION_KEY: "b".repeat(64), SITE_URL: "http://localhost:3000" });
    delete process.env.DEMO_MODE;
    delete process.env.PRIVACY_LEDGER_DIR;
    await (closeDb)();
    try {
        const migration = new pg.Client({ connectionString: scoped.toString() });
        await migration.connect();
        try {
            for (const name of (await (readdir)(new URL("../db/migrations/", define_import_meta_default.url))).filter(name2 => name2.endsWith(".sql")).sort())
                await migration.query(await (readFile)(new URL("../db/migrations/" + name, define_import_meta_default.url), "utf8"));
        }
        finally {
            await migration.end();
        }
        for (const by of [seller, reader, outsider, admin, customer])
            await (query)("INSERT INTO users(id,email,name,password_hash,role,mfa_enabled,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)", [by.id, by.email, by.name, "non-login domain fixture", by.role, by.mfaVerified, by.qualityScope, JSON.stringify(by.allowedLocales), by === reader ? "all" : "assigned", JSON.stringify({ ...grants, intake: by !== outsider })]);
        await (getWorkspace)(admin);
        await t.test("structured account hierarchy, branches and dated affiliation history are constrained in API and database", async () => { await create(seller, "account-a", "accounts"); await define(seller, "account-a", account()); await create(seller, "account-b", "accounts"); await define(seller, "account-b", { ...account("Branch Group"), parentAccountId: "account-a" }); await strict.rejects(define(seller, "account-a", { ...account(), parentAccountId: "account-b" }), expected(422, "CRM_ACCOUNT_CYCLE")); const branch = { name: "Ankara", address: { line1: "Industrial route", line2: "", city: "Ankara", region: "", postalCode: "06000", countryCode: "TR" }, registrations: [], active: true }; await define(seller, "account-a", { ...account(), branches: [branch] }); const a = (await (getCrmDomain)(seller, "account-a")).definition, branchId = a.branches[0].id; await create(seller, "contact-a", "contacts"); await define(seller, "contact-a", { ...contact(), affiliations: [{ accountId: "account-a", branchId, role: "Buyer", validFrom: "2026-01-01", validTo: null }] }); let c = (await (getCrmDomain)(seller, "contact-a")).definition; await strict.rejects(define(seller, "contact-a", { ...c, affiliations: [...c.affiliations, { accountId: "account-a", branchId, role: "Another role", validFrom: "2026-02-01", validTo: null }] }), expected(409, "CRM_INTERVAL_OVERLAP")); await strict.rejects(define(seller, "account-a", { ...a, branches: [] }), expected(409, "CRM_BRANCH_IN_USE")); await define(seller, "contact-a", { ...c, affiliations: c.affiliations.map(item => ({ ...item, validTo: "2026-01-31" })) }); c = (await (getCrmDomain)(seller, "contact-a")).definition; await strict.rejects(define(seller, "contact-a", { ...c, affiliations: [] }), expected(409, "CRM_AFFILIATION_HISTORY")); await strict.rejects((query)("UPDATE crm_contact_affiliations SET role=$2 WHERE id=$1", [c.affiliations[0].id, "Rewrite history"]), error => error.code === "23514"); await define(seller, "contact-a", { ...c, affiliations: [...c.affiliations, { accountId: "account-a", branchId, role: "Purchasing lead", validFrom: "2026-02-01", validTo: null }] }); const current = await raw("contact-a"); await strict.rejects(edit(seller, current.id, { email: "forged@example.invalid" }), expected(403, "CRM_PROFILE_COMMAND")); });
        await t.test("shared email does not merge persons or collide with a user recipient namespace", async () => { await create(seller, "contact-b", "contacts"); await define(seller, "contact-b", contact("Different person")); const a = (await (getCrmDomain)(seller, "contact-a")).endpoints[0], b = (await (getCrmDomain)(seller, "contact-b")).endpoints[0]; strict.equal(a.value, b.value); strict.notEqual(a.recipientId, b.recipientId); await (query)("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)", ["contact-a", "another-login@example.invalid", "Distinct login", "fixture"]); const user = (await (query)("SELECT id FROM communication_recipients WHERE subject_type='user' AND subject_id='contact-a'")).rows[0]; strict.notEqual(user.id, a.recipientId); await strict.rejects((query)("UPDATE crm_contact_endpoints SET recipient_id=$2 WHERE id=$1", [a.id, b.recipientId]), error => error.code === "23503"); });
        await t.test("verification is endpoint-bound, single-use and separate from explicit marketing topic consent", async () => { const endpoint = (await (getCrmDomain)(seller, "contact-b")).endpoints[0]; strict.equal(endpoint.verifiedAt, null); await strict.rejects((requestCrmEndpointVerification)(outsider, "contact-b", endpoint.id, { locale: "en" }), expected(404)); const first = await verifyToken("contact-b", endpoint.id); strict.equal(await (transaction)(client => (canDeliverCrmEndpointVerification)(client, first.payload)), true); await (confirmCrmContactEndpoint)(req(), { token: first.token }); await strict.rejects((confirmCrmContactEndpoint)(req(), { token: first.token, topics: ["products"] }), expected(422, "CRM_VERIFY_EXPIRED")); strict.equal(await (transaction)(client => (canDeliverCrmEndpointVerification)(client, first.payload)), false); strict.equal((await (transaction)(client => (resolveCrmContactRecipient)(client, seller, endpoint.recipientId, endpoint.id, "products"))).topicConsented, false); const second = await verifyToken("contact-b", endpoint.id); await (confirmCrmContactEndpoint)(req(), { token: second.token, topics: ["products"] }); strict.equal((await (transaction)(client => (resolveCrmContactRecipient)(client, seller, endpoint.recipientId, endpoint.id, "products"))).topicConsented, true); strict.equal((await (transaction)(client => (resolveCrmContactRecipient)(client, seller, endpoint.recipientId, endpoint.id, "research"))).topicConsented, false); const third = await verifyToken("contact-b", endpoint.id), definition = (await (getCrmDomain)(seller, "contact-b")).definition; await define(seller, "contact-b", { ...definition, endpoints: definition.endpoints.map(item => ({ ...item, value: "changed@example.invalid" })) }); await strict.rejects((confirmCrmContactEndpoint)(req(), { token: third.token, topics: ["products"] }), expected(422, "CRM_VERIFY_EXPIRED")); const changed = (await (getCrmDomain)(seller, "contact-b")).endpoints[0]; strict.equal(changed.verifiedAt, null); strict.equal(changed.version, 2); strict.equal(await (transaction)(client => (canDeliverCrmEndpointVerification)(client, third.payload)), false); const stale = (await (query)("UPDATE outbox SET state='running',attempts=1,lock_token=$2,locked_at=now() WHERE dedupe_key=$1 RETURNING id,kind,payload,attempts,lock_token", ["crm-endpoint-verify:" + third.payload.crmEndpointVerification.challengeHash, (randomUUID)()])).rows[0]; let sent = 0; await (deliverOutbox)(stale, { sendMail: async () => { sent++; return { messageId: "should-not-send" }; } }); strict.equal(sent, 0); strict.equal((await (query)("SELECT state FROM outbox WHERE id=$1", [stale.id])).rows[0].state, "cancelled"); await strict.rejects((query)("UPDATE crm_endpoint_consent_events SET accepted=true WHERE endpoint_id=$1", [endpoint.id]), error => error.code === "23514"); });
        await t.test("typed contact merge and unmerge synchronize selected identity fields without merging verification, consent or login users", async () => {
            for (const [id, email] of [["merge-typed-target", "target-person@example.invalid"], ["merge-typed-source", "source-person@example.invalid"]]) {
                await create(seller, id, "contacts");
                await define(seller, id, contact(id, email));
            }
            const sourceEndpoint = (await (getCrmDomain)(seller, "merge-typed-source")).endpoints[0], proof = await verifyToken("merge-typed-source", sourceEndpoint.id);
            await (confirmCrmContactEndpoint)(req(), { token: proof.token, topics: ["products"] });
            const usersBefore = (await (query)("SELECT id FROM users")).rowCount, consentBefore = (await (query)("SELECT id FROM crm_endpoint_consent_events WHERE endpoint_id=$1", [sourceEndpoint.id])).rowCount;
            let workspace = await (getWorkspace)(seller);
            const merged = (mergeCrmRecords)(workspace.state.records, { targetId: "merge-typed-target", sourceId: "merge-typed-source", choices: { email: "source", title: "source" }, id: "typed-merge", at: new Date().toISOString(), actor: seller.role, message: (recordText)("Explicit comparison and merge") });
            strict.equal(merged.ok, true);
            if (!merged.ok)
                return;
            workspace = await (saveWorkspace)(seller, { expectedVersion: workspace.version, state: { ...workspace.state, records: merged.value.records } });
            const target = await (getCrmDomain)(seller, "merge-typed-target"), selected = target.endpoints.find(endpoint => endpoint.value === sourceEndpoint.value);
            strict.ok(selected);
            strict.equal(selected.verifiedAt, null);
            strict.notEqual(selected.recipientId, sourceEndpoint.recipientId);
            strict.equal(target.definition.displayName, "merge-typed-source");
            strict.equal(target.endpoints[0].value, sourceEndpoint.value);
            strict.equal((await (query)("SELECT id FROM users")).rowCount, usersBefore);
            strict.equal((await (query)("SELECT id FROM crm_endpoint_consent_events WHERE endpoint_id=$1", [sourceEndpoint.id])).rowCount, consentBefore);
            strict.equal((await (query)("SELECT id FROM crm_endpoint_consent_events WHERE endpoint_id=$1", [selected.id])).rowCount, 0);
            const undone = (unmergeCrmRecords)(workspace.state.records, "merge-typed-target", "typed-merge", { at: new Date().toISOString(), actor: seller.role, message: (recordText)("Restore separate persons") });
            strict.equal(undone.ok, true);
            if (!undone.ok)
                return;
            await (saveWorkspace)(seller, { expectedVersion: workspace.version, state: { ...workspace.state, records: undone.value.records } });
            const restored = await (getCrmDomain)(seller, "merge-typed-target");
            strict.equal(restored.endpoints[0].value, "target-person@example.invalid");
            strict.equal(restored.definition.displayName, "merge-typed-target");
            strict.equal((await (getCrmDomain)(seller, "merge-typed-source")).endpoints[0].verifiedAt !== null, true);
        });
        await t.test("raw generic conversion and forged profile markers fail before any partial write", async () => { await create(seller, "qualified-lead", "leads"); const before = await version(); await strict.rejects(edit(seller, "qualified-lead", { status: "converted" }), expected(403, "CRM_CONVERSION_COMMAND")); strict.equal(await version(), before); await strict.rejects(edit(seller, "qualified-lead", { details: { crmConversion: { schemaVersion: 1, accountId: "account-a", contactId: "contact-a", opportunityId: null, reason: "Caller-asserted conversion" } } }), expected(403, "CRM_DOMAIN_COMMAND")); await strict.rejects((convertCrmLead)(seller, "qualified-lead", { expectedVersion: await version(), account: { id: "account-a" }, contact: { id: "contact-a" }, opportunity: { mode: "create", title: "Commercial need", needKey: "need-main" } }), expected(422, "CRM_QUALIFICATION_REQUIRED")); });
        let convertedOpportunity = "";
        await t.test("qualified conversion creates account/contact/first approved pipeline position atomically and concurrent retry creates nothing", async () => { await define(seller, "qualified-lead", qualification); const input = { expectedVersion: await version(), account: { create: account("Converted Account") }, contact: { create: contact("Converted Contact", "conversion@example.invalid") }, opportunity: { mode: "create", title: "Distinct reviewed requirement", needKey: "need-main" } }; const beforeCount = (await (query)("SELECT record_id FROM crm_account_profiles")).rowCount; const results = await Promise.allSettled([(convertCrmLead)(seller, "qualified-lead", input), (convertCrmLead)(seller, "qualified-lead", input)]); strict.equal(results.filter(result => result.status === "fulfilled").length, 1); strict.equal(results.find(result => result.status === "rejected").reason.status, 409); const view = await (getCrmDomain)(seller, "qualified-lead"); strict.ok(view.conversion); convertedOpportunity = view.conversion.opportunityId; strict.equal((await (query)("SELECT record_id FROM crm_account_profiles")).rowCount, beforeCount + 1); strict.equal((await (query)("SELECT lead_id FROM crm_lead_conversions WHERE lead_id=$1", ["qualified-lead"])).rowCount, 1); strict.equal((await raw(convertedOpportunity)).ownerId, seller.id); strict.equal((await raw(convertedOpportunity)).status, "new"); strict.equal((await (query)("SELECT id FROM crm_contact_affiliations WHERE contact_id=$1 AND account_id=$2", [view.conversion.contactId, view.conversion.accountId])).rowCount, 1); await strict.rejects((convertCrmLead)(seller, "qualified-lead", { ...input, expectedVersion: await version() }), expected(409, "CRM_ALREADY_CONVERTED")); await strict.rejects(edit(seller, "qualified-lead", { status: "new" }), expected(409)); });
        await t.test("another lead may explicitly link one distinct need; no-opportunity outcome and rollback are durable", async () => {
            const conversion = (await (getCrmDomain)(seller, "qualified-lead")).conversion;
            for (const id of ["second-lead", "no-need-lead", "failed-conversion"]) {
                await create(seller, id, "leads");
                await define(seller, id, qualification);
            }
            await (convertCrmLead)(seller, "second-lead", { expectedVersion: await version(), account: { id: conversion.accountId }, contact: { id: conversion.contactId }, opportunity: { mode: "link", id: convertedOpportunity } });
            strict.equal((await (query)("SELECT lead_id FROM crm_lead_conversions WHERE opportunity_id=$1", [convertedOpportunity])).rowCount, 2);
            await (convertCrmLead)(seller, "no-need-lead", { expectedVersion: await version(), account: { id: conversion.accountId }, contact: { id: conversion.contactId }, opportunity: { mode: "none", reason: "No distinct need beyond the existing service request." } });
            strict.equal((await (getCrmDomain)(seller, "no-need-lead")).conversion?.opportunityId, null);
            const before = await version(), count = (await (query)("SELECT record_id FROM crm_account_profiles")).rowCount;
            await strict.rejects((convertCrmLead)(seller, "failed-conversion", { expectedVersion: before, account: { create: account("Rolled back account") }, contact: { create: contact() }, opportunity: { mode: "create", title: "Invalid pipeline", needKey: "new-need", pipelineId: "missing-pipeline" } }), expected(404));
            strict.equal(await version(), before);
            strict.equal((await (query)("SELECT record_id FROM crm_account_profiles")).rowCount, count);
            strict.equal((await raw("failed-conversion")).status, "new");
        });
        let sampleRequestId = "";
        await t.test("opportunity/request M:N links do not grant access and item identity keeps an immutable product/variant/unit snapshot", async () => { const sample = await request(); sampleRequestId = sample.id; const current = (await (getCrmDomain)(seller, convertedOpportunity)).definition; await define(seller, convertedOpportunity, { ...current, requestIds: [sample.id], items: [{ productId: products[0].id, variantId: null, unit: "requested box", quantityDecimal: "2.500000", note: "Actual requested quantity" }] }); let view = await (getCrmDomain)(seller, convertedOpportunity); const item = view.items[0]; strict.equal(item.productSnapshot.source, "factory-source"); strict.equal(item.productSnapshot.unitSource, "requested"); strict.equal(item.productSnapshot.variant, null); const savedHash = item.productSnapshot.sourceHash; await strict.rejects(define(seller, convertedOpportunity, { ...view.definition, items: [{ ...item, unit: "retargeted unit" }].map(({ productSnapshot: _snapshot, ...row }) => row) }), expected(409, "CRM_ITEM_SNAPSHOT")); await define(seller, convertedOpportunity, { ...view.definition, items: [{ id: item.id, productId: item.productId, variantId: item.variantId, unit: item.unit, quantityDecimal: "3", note: "Quantity amended" }] }); view = await (getCrmDomain)(seller, convertedOpportunity); strict.equal(view.items[0].productSnapshot.sourceHash, savedHash); await strict.rejects((query)("UPDATE crm_opportunity_items SET snapshot='{}'::jsonb WHERE id=$1", [item.id]), error => error.code === "23514"); await (query)("UPDATE requests SET assignee_id=$2 WHERE id=$1", [sample.id, outsider.id]); await strict.rejects((getRequest)(seller, sample.id, null), expected(404)); strict.equal((await (getCrmDomain)(seller, convertedOpportunity)).definition?.kind, "opportunity"); strict.deepEqual((await (getCrmDomain)(seller, convertedOpportunity)).definition.requestIds, []); await (query)("UPDATE requests SET assignee_id=NULL WHERE id=$1", [sample.id]); });
        await t.test("field masking preserves hidden relationships and customer identities through unrelated permitted edits", async () => {
            const current = (await (getCrmDomain)(seller, convertedOpportunity)).definition, accountId = current.accountId;
            await (query)("UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1", [seller.id, JSON.stringify({ ...grants, contact: false })]);
            try {
                const view = await (getCrmDomain)(seller, convertedOpportunity);
                strict.equal(Object.hasOwn(view.definition, "accountId"), false);
                strict.equal(Object.hasOwn(view.definition, "contactIds"), false);
                strict.equal((await (getCrmDomain)(seller, "contact-a")).definition, null);
                strict.equal((await (getCrmDomain)(seller, "contact-a")).capabilities.canEdit, false);
                const visible = (await (getWorkspace)(seller)).state.records.find(row => row.id === "contact-a");
                strict.equal(visible.title.en, "Contact contact-a");
                strict.equal(visible.email, void 0);
                strict.equal((await (getWorkspace)(seller)).state.records.find(row => row.id === "qualified-lead")?.details?.crmConversion, void 0);
                await define(seller, convertedOpportunity, view.definition);
                strict.equal((await (query)("SELECT account_id FROM crm_opportunity_details WHERE opportunity_id=$1", [convertedOpportunity])).rows[0].account_id, accountId);
                await strict.rejects(define(seller, convertedOpportunity, { ...view.definition, accountId: null }), expected(403, "CRM_CONTACT_REQUIRED"));
            }
            finally {
                await (query)("UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1", [seller.id, JSON.stringify(grants)]);
            }
        });
        await t.test("sample transitions require actual carrier/receipt/evaluation evidence and create exactly one quarantined quality case", async () => { await define(seller, sampleRequestId, { schemaVersion: 1, kind: "sample", opportunityId: convertedOpportunity, requestId: sampleRequestId }); await strict.rejects((transitionCrmSample)(seller, sampleRequestId, { expectedVersion: await version(), to: "shipped" }), expected(409, "CRM_SAMPLE_TRANSITION")); await (transitionCrmSample)(seller, sampleRequestId, { expectedVersion: await version(), to: "reviewed" }); await strict.rejects((transitionCrmSample)(seller, sampleRequestId, { expectedVersion: await version(), to: "shipped" }), expected(422, "CRM_CARRIER_REQUIRED")); const pending = await asset(seller, "pending"), clean = await asset(seller); const shippedAt = new Date(Date.now() - 6e4).toISOString(); await strict.rejects((transitionCrmSample)(seller, sampleRequestId, { expectedVersion: await version(), to: "shipped", carrierEvidence: { carrier: "Manual carrier", trackingReference: "TRACK-1", shippedAt, evidenceAssetId: pending.id } }), expected(422, "CRM_EVIDENCE")); await (transitionCrmSample)(seller, sampleRequestId, { expectedVersion: await version(), to: "shipped", carrierEvidence: { carrier: "Manual carrier", trackingReference: "TRACK-1", shippedAt, evidenceAssetId: clean.id } }); const customerView = await (getRequest)(customer, sampleRequestId, null); await (patchRequest)(customer, sampleRequestId, null, { messages: [...customerView.messages || [], { id: (randomUUID)(), body: "Package received; evaluation follows.", visibility: "public", createdAt: new Date().toISOString(), sender: customer.name }] }, customerView.version); strict.equal((await raw(sampleRequestId)).status, "shipped"); const receivedAt = new Date(Date.now() - 3e4).toISOString(); await (transitionCrmSample)(seller, sampleRequestId, { expectedVersion: await version(), to: "received", receivedAt }); await strict.rejects((transitionCrmSample)(seller, sampleRequestId, { expectedVersion: await version(), to: "evaluated", evaluation: { outcome: "quality_concern", feedback: "Suspected material problem", evaluatedAt: new Date().toISOString() } }), expected(422, "CRM_QUALITY_DETAILS")); await (transitionCrmSample)(seller, sampleRequestId, { expectedVersion: await version(), to: "evaluated", evaluation: { outcome: "quality_concern", feedback: "Suspected material problem", evaluatedAt: new Date().toISOString(), batch: "BATCH-42" } }); const quality = (await (query)("SELECT quality_request_id FROM crm_sample_cases WHERE sample_id=$1", [sampleRequestId])).rows[0].quality_request_id; const row = (await (query)("SELECT * FROM requests WHERE id=$1", [quality])).rows[0]; strict.equal(row.owner_id, customer.id); strict.equal(row.quality_quarantined, true); strict.equal(row.data.batch, "BATCH-42"); strict.equal((await (getCrmDomain)(seller, sampleRequestId)).sample?.qualityRequestId, null); await strict.rejects((getRequest)(seller, quality, null), expected(404)); strict.equal((await (getRequest)(customer, quality, null)).kind, "quality_complaint"); await strict.rejects((transitionCrmSample)(seller, sampleRequestId, { expectedVersion: await version(), to: "evaluated", evaluation: { outcome: "quality_concern", feedback: "Retry", evaluatedAt: new Date().toISOString(), batch: "BATCH-42" } }), expected(409)); strict.equal((await (query)("SELECT id FROM requests WHERE kind='quality_complaint'")).rowCount, 1); });
        let firstEvidence = "", lastEvidence = "";
        await t.test("manual handoff keeps internal/external states separate and blocks blind retries after uncertainty", async () => { await create(admin, "handoff-one", "handoffs"); await define(admin, "handoff-one", { schemaVersion: 1, kind: "handoff", opportunityId: convertedOpportunity, quoteId: null, mode: "manual" }); await (transitionCrmHandoff)(admin, "handoff-one", { expectedVersion: await version(admin), to: "ready", note: "Ready for documented handoff" }); await strict.rejects((transitionCrmHandoff)(admin, "handoff-one", { expectedVersion: await version(admin), to: "submitted", note: "No evidence" }), expected(422, "CRM_HANDOFF_EVIDENCE")); firstEvidence = (await asset(admin)).id; lastEvidence = (await asset(admin)).id; await (transitionCrmHandoff)(admin, "handoff-one", { expectedVersion: await version(admin), to: "submitted", note: "Manual entry recorded", externalReference: "EXT-7", externalStatus: "awaiting_receipt", evidenceAssetId: firstEvidence }); await (transitionCrmHandoff)(admin, "handoff-one", { expectedVersion: await version(admin), to: "uncertain", note: "External acknowledgement was lost" }); await strict.rejects((transitionCrmHandoff)(admin, "handoff-one", { expectedVersion: await version(admin), to: "ready", note: "Blind retry" }), expected(422, "CRM_RECONCILIATION_REQUIRED")); await (transitionCrmHandoff)(admin, "handoff-one", { expectedVersion: await version(admin), to: "acknowledged", note: "Recipient confirmed receipt by phone and signed evidence", externalReference: "EXT-7", externalStatus: "warehouse_pending", evidenceAssetId: lastEvidence, reconciliation: { outcome: "confirmed_received", reason: "External recipient verified the existing entry and reference." } }); const view = await (getCrmDomain)(admin, "handoff-one"); strict.equal(view.handoff?.status, "acknowledged"); strict.equal(view.handoff?.externalStatus, "warehouse_pending"); strict.equal(view.handoff?.attempt, 1); strict.equal((await raw(convertedOpportunity)).status, "new"); strict.equal((await (query)("SELECT asset_id FROM crm_domain_asset_refs WHERE record_id=$1", ["handoff-one"])).rowCount, 2); await strict.rejects(edit(admin, "handoff-one", { status: "ready" }), expected(403, "CRM_TRANSITION_COMMAND")); });
        await t.test("superseded evidence remains undeletable and cannot be rebound; current scoped download never broadens ordinary media rights", async () => {
            await strict.rejects((deleteMedia)(admin, firstEvidence), expected(409, "ASSET_IN_USE"));
            await strict.rejects(request("rfq", admin, { attachmentIds: [firstEvidence] }), expected(403, "ATTACHMENT_OWNERSHIP"));
            strict.equal((await (query)("SELECT request_id FROM assets WHERE id=$1", [firstEvidence])).rows[0].request_id, null);
            await strict.rejects((transaction)(client => (domainEvidence)(client, admin, firstEvidence, void 0, "other-record")), expected(422, "CRM_EVIDENCE_RETAINED"));
            await strict.rejects((assetResponse)(firstEvidence, reader, null, req(), true), expected(404));
            const response = await (crmEvidenceResponse)(reader, "handoff-one", firstEvidence, req());
            strict.equal(response.status, 200);
            strict.equal(response.headers.get("Cache-Control"), "private, no-store");
            strict.ok((await response.text()).includes("Private retained fixture"));
            await strict.rejects((crmEvidenceResponse)(outsider, "handoff-one", firstEvidence, req()), expected(404));
            await strict.rejects((crmEvidenceResponse)(reader, "handoff-one", (await asset(admin)).id, req()), expected(404));
            await (query)("UPDATE users SET crm_scope='assigned' WHERE id=$1", [reader.id]);
            try {
                await strict.rejects((crmEvidenceResponse)(reader, "handoff-one", lastEvidence, req()), expected(404));
            }
            finally {
                await (query)("UPDATE users SET crm_scope='all' WHERE id=$1", [reader.id]);
            }
            await strict.rejects((query)("DELETE FROM crm_domain_asset_refs WHERE record_id=$1", ["handoff-one"]), error => error.code === "23514");
        });
        await t.test("active exclusive partner date/product overlap is rejected transactionally with explicit wildcard coverage", async () => {
            await (query)("INSERT INTO crm_territories(id,name,created_by) VALUES('domain-territory','Bounded test territory',$1)", [admin.id]);
            for (const id of ["partner-one", "partner-two"])
                await create(admin, id, "partners");
            const definition = { schemaVersion: 1, kind: "partner", accountId: "account-a", territoryId: "domain-territory", productIds: [], validFrom: "2026-01-01", validTo: "2026-12-31", exclusive: true, active: true, reference: "Agreement-1", documentAssetId: null };
            await define(admin, "partner-one", definition);
            const before = await version(admin);
            await strict.rejects(define(admin, "partner-two", { ...definition, productIds: [products[0].id], exclusive: false, reference: "Conflicting agreement" }), expected(409, "CRM_INTERVAL_OVERLAP"));
            strict.equal(await version(admin), before);
            strict.equal((await (getCrmDomain)(admin, "partner-two")).definition, null);
            await define(admin, "partner-two", { ...definition, validFrom: "2027-01-01", validTo: null, reference: "Following interval" });
            strict.equal((await (query)("SELECT partner_id FROM crm_partner_agreements")).rowCount, 2);
        });
        await t.test("atomic transfer helper creates typed unverified contacts, cannot escalate fields or revive identities, and rolls back with its caller", async () => {
            const created = await (transaction)(client => (importCrmWorkspaceRecord)(client, seller, record("import-contact", "contacts", { email: "imported@example.invalid" })));
            strict.equal(created.ownerId, seller.id);
            const domain = await (getCrmDomain)(seller, created.id);
            strict.equal(domain.endpoints[0].verifiedAt, null);
            strict.deepEqual(domain.definition.affiliations, []);
            await strict.rejects((transaction)(client => (importCrmWorkspaceRecord)(client, seller, record(created.id, "contacts"))), expected(409, "CRM_IMPORT_EXISTS"));
            await strict.rejects((transaction)(client => (importCrmWorkspaceRecord)(client, seller, record("forged-import", "contacts", { ownerId: outsider.id }))), expected(403));
            const before = await version();
            await strict.rejects((transaction)(async (client) => { await (importCrmWorkspaceRecord)(client, seller, record("rolled-back-contact", "contacts", { email: "rollback@example.invalid" })); throw new Error("transfer row failed"); }), /transfer row failed/);
            strict.equal(await raw("rolled-back-contact"), void 0);
            strict.equal(await version(), before);
            await (query)("UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1", [seller.id, JSON.stringify({ ...grants, contact: false })]);
            try {
                await strict.rejects((transaction)(client => (importCrmWorkspaceRecord)(client, seller, record("restricted-import", "contacts", { email: "restricted@example.invalid" }))), expected(403));
            }
            finally {
                await (query)("UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1", [seller.id, JSON.stringify(grants)]);
            }
        });
        await t.test("request origins are unique and noncommercial requests do not manufacture sales leads", async () => {
            const rfq = await request("rfq");
            strict.equal((await (query)("SELECT lead_id FROM crm_lead_origins WHERE origin_type='request' AND origin_id=$1", [rfq.id])).rowCount, 1);
            for (const kind of ["newsletter", "job_application", "contact"]) {
                const submitted = await request(kind);
                strict.notEqual((await raw(submitted.id)).collection, "leads");
                strict.equal((await (query)("SELECT lead_id FROM crm_lead_origins WHERE origin_type='request' AND origin_id=$1", [submitted.id])).rowCount, 0);
            }
            await strict.rejects((query)("INSERT INTO crm_lead_origins(origin_type,origin_id,lead_id) VALUES('request',$1,$2)", [rfq.id, "qualified-lead"]), error => error.code === "23505");
        });
    }
    finally {
        await (closeDb)();
        for (const name of names)
            if (previous[name] === void 0)
                delete process.env[name];
            else
                Object.assign(process.env, { [name]: previous[name] });
        await (rm)(storage, { recursive: true, force: true });
        try {
            await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        }
        finally {
            await control.end();
        }
    }
});
