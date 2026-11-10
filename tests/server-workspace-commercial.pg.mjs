/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { HttpError } from "../src/server/types";
import { products } from "../src/data/catalog";
import { calculateCommercial } from "../src/components/workspace/crm-tools-logic";
import strict from "node:assert/strict";
import { recordText } from "../src/data/workspace-seed";
import { getWorkspace, saveWorkspace, reviewWorkspaceContent, lockWorkspace, upsertRequestInWorkspace, getWorkspaceRecordForActor } from "../src/server/workspace";
import { listPricebookVersions, getCommercialPolicy, saveCommercialPolicy } from "../src/server/workspace-commercial";
import node_test from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { closeDb, query, transaction } from "../src/server/db";
import { readdir, readFile } from "node:fs/promises";
import { issueQuote } from "../src/server/requests";
const define_import_meta_default = import.meta;
const database = process.env.TEST_ADMIN_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;
const actor = (role, id) => ({ id, role, name: id, email: `${id}@example.invalid`, qualityScope: false, allowedLocales: ["fa", "en", "tr", "ar", "ru"], mfaVerified: role !== "customer" });
const maker = actor("business", "commercial-maker"), limited = actor("business", "commercial-no-cost"), admin = actor("admin", "commercial-admin"), secondAdmin = actor("admin", "commercial-second-admin"), senior = actor("superAdmin", "commercial-senior"), buyer = actor("customer", "commercial-customer");
const expected = (status, code) => error => error instanceof HttpError && error.status === status && (!code || error.code === code);
const line = (patch = {}) => ({ id: "line-one", productId: products[0].id, titleSnapshot: products[0].name.en, unit: "set", quantityDecimal: "1", unitPriceDecimal: "100", discountPercentDecimal: "0", currency: "USD", ...patch });
const stamp = () => new Date().toISOString(), due = () => new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
function commercial(id, kind, lines, patch = {}, pricebookRevisionId) { const estimate = (calculateCommercial)(lines, "USD"); strict.ok(estimate.ok); const draft = { schemaVersion: 1, kind, locale: "en", currency: "USD", lines, estimate: estimate.value, calculationPolicyVersion: "local-line-half-up-v1", serverRecalculationRequired: true, updatedAt: stamp(), ...pricebookRevisionId ? { pricebookRevisionId } : {} }; return { id, collection: kind === "quote" ? "quotes" : "pricebooks", title: (recordText)(id), summary: (recordText)("Approved payment and delivery terms."), status: "review", owner: "business", createdAt: stamp(), updatedAt: stamp(), history: [], tags: [], demo: false, currency: "USD", amount: estimate.value.grandTotalDecimal, ...kind === "quote" ? { requestId: "commercial-rfq", due: due() } : {}, ...patch, details: { ...kind === "pricebook" ? { pricebookPolicy: { schemaVersion: 1, market: "global" } } : { billingAddress: "Approved billing address" }, ...patch.details, commercialDraft: draft } }; }
async function create(by, row) { const w = await (getWorkspace)(by); return (saveWorkspace)(by, { state: { ...w.state, records: [...w.state.records, row] }, expectedVersion: w.version, locale: "en" }); }
async function review(by, id) { return (reviewWorkspaceContent)(by, { bucket: "records", id, locale: "en", expectedVersion: (await (getWorkspace)(by)).version }); }
async function edit(by, id, patch) { const w = await (getWorkspace)(by); return (saveWorkspace)(by, { state: { ...w.state, records: w.state.records.map(row => row.id === id ? { ...row, ...patch, approvedBy: void 0, approvedById: void 0 } : row) }, expectedVersion: w.version, locale: "en" }); }
async function pricebook(id, lines = [line()], patch = {}, reviewer = admin) { await create(maker, commercial(id, "pricebook", lines, patch)); await review(reviewer, id); return (await (listPricebookVersions)(maker)).items.find(row => row.pricebookId === id); }
async function approvedQuote(id, revisionId, lines = [line()], reviewer = admin) { await create(maker, commercial(id, "quote", lines, {}, revisionId)); await review(reviewer, id); }
(node_test)("PostgreSQL approved commercial pricebooks, exact quotation approvals and immutable issuance", { timeout: 24e4 }, async (t) => {
    strict.ok(database, "Commercial integration requires a PostgreSQL schema owner; a missing database is a failing verification gate.");
    const schema = `commercial_test_${(randomUUID)().replaceAll("-", "")}`, control = new pg.Client({ connectionString: database });
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
        for (const by of [maker, limited, admin, secondAdmin, senior, buyer])
            await (query)("INSERT INTO users(id,email,name,password_hash,role,mfa_enabled,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [by.id, by.email, by.name, "non-login commercial fixture", by.role, by.mfaVerified, by.role === "customer" ? "assigned" : "all", JSON.stringify({ contact: by.role !== "customer", financial: by.role !== "customer", baseCost: by.id !== limited.id && by.role !== "customer", assign: by.role !== "customer", intake: by.role !== "customer" })]);
        const request = { id: "commercial-rfq", ownerId: buyer.id, kind: "rfq", locale: "en", name: "Approved customer name", organization: "Approved customer company", email: buyer.email, phone: "+10000000000", country: "Test market", message: "Please prepare an official quote.", productIds: [products[0].id], status: "received", createdAt: stamp(), version: 1, messages: [], sharedQuotes: [] };
        await (transaction)(async (client) => { await (lockWorkspace)(client); await client.query("INSERT INTO requests(id,owner_id,kind,locale,data) VALUES($1,$2,$3,$4,$5::jsonb)", [request.id, buyer.id, request.kind, request.locale, JSON.stringify(request)]); await (upsertRequestInWorkspace)(client, request); });
        let mainRevision = "", issued;
        await t.test("progressive drafts are allowed while unknown prices, duplicate units and self review cannot create an approved pricebook", async () => { await create(maker, commercial("unknown-pricebook", "pricebook", [line({ unitPriceDecimal: null })], { status: "draft" })); await edit(maker, "unknown-pricebook", { status: "review" }); await strict.rejects(review(admin, "unknown-pricebook"), expected(422, "PRICEBOOK_LINES")); await create(maker, commercial("duplicate-pricebook", "pricebook", [line(), line({ id: "duplicate-sku" })])); await strict.rejects(review(admin, "duplicate-pricebook"), expected(422, "PRICEBOOK_DUPLICATE")); await create(maker, commercial("quantity-pricebook", "pricebook", [line({ quantityDecimal: "2" })])); await strict.rejects(review(admin, "quantity-pricebook"), expected(422, "PRICEBOOK_UNIT_PRICE")); await create(admin, commercial("self-pricebook", "pricebook", [line()])); await strict.rejects(review(admin, "self-pricebook"), expected(403)); strict.equal((await (query)("SELECT id FROM crm_pricebook_revisions")).rowCount, 0); });
        await t.test("pricebooks persist exact versioned entries and cannot rewrite their approval evidence", async () => { const approved = await pricebook("main-pricebook"); mainRevision = approved.id; strict.equal(approved.entries[0].unitPriceDecimal, "100"); strict.equal(approved.market, "global"); strict.equal(approved.version, 1); strict.equal(approved.approvedById, admin.id); strict.equal(approved.checksum.length, 64); await strict.rejects((query)("UPDATE crm_price_entries SET unit_price=1 WHERE revision_id=$1", [mainRevision]), error => error.code === "23514"); await strict.rejects((query)("DELETE FROM crm_pricebook_revisions WHERE id=$1", [mainRevision]), error => error.code === "23514"); await review(admin, "main-pricebook"); strict.equal((await (listPricebookVersions)(maker)).items.find(row => row.pricebookId === "main-pricebook")?.id, mainRevision); strict.equal((await (query)("SELECT id FROM crm_pricebook_revisions WHERE pricebook_id=$1", ["main-pricebook"])).rowCount, 1); });
        await t.test("new quotes require a pricebook and explicit price changes cannot bypass the discount ceiling", async () => { await create(maker, commercial("unbound-quote", "quote", [line()])); await strict.rejects(review(admin, "unbound-quote"), expected(422, "PRICEBOOK_REQUIRED")); await create(maker, commercial("underpriced-quote", "quote", [line({ unitPriceDecimal: "80" })], {}, mainRevision)); await strict.rejects(review(admin, "underpriced-quote"), expected(422, "PRICEBOOK_PRICE_MISMATCH")); await create(maker, commercial("wrong-unit-quote", "quote", [line({ unit: "carton" })], {}, mainRevision)); await strict.rejects(review(admin, "wrong-unit-quote"), expected(422, "PRICEBOOK_PRICE_MISMATCH")); const mixed = commercial("mixed-quote", "quote", [line()], {}, mainRevision); mixed.details.commercialDraft.lines[0].currency = "EUR"; await strict.rejects(create(maker, mixed), expected(422)); strict.equal((await (query)("SELECT id FROM crm_quote_approvals")).rowCount, 0); });
        await t.test("role ceilings route larger discounts to an independent senior reviewer", async () => { await create(maker, commercial("large-discount-quote", "quote", [line({ discountPercentDecimal: "12.5" })], {}, mainRevision)); await strict.rejects(review(admin, "large-discount-quote"), expected(403, "DISCOUNT_APPROVAL_REQUIRED")); await review(senior, "large-discount-quote"); const result = await (issueQuote)(maker, request.id, { recordId: "large-discount-quote" }); strict.equal(result.amount, "87.50"); await create(admin, commercial("self-quote", "quote", [line()], {}, mainRevision)); await strict.rejects(review(admin, "self-quote"), expected(403)); await review(secondAdmin, "self-quote"); const row = (await (query)("SELECT maker_id,approved_by,max_discount_percent::text FROM crm_quote_approvals WHERE quote_id=$1", ["large-discount-quote"])).rows[0]; strict.equal(row.maker_id, maker.id); strict.equal(row.approved_by, senior.id); strict.equal(row.max_discount_percent, "12.500000"); });
        await t.test("issuance uses the raw approved revision, preserves party snapshots and excludes hidden base costs", async () => { const cents = await pricebook("decimal-pricebook", [line({ unitPriceDecimal: "0.10" })]); await approvedQuote("decimal-quote", cents.id, [line({ unitPriceDecimal: "0.10", quantityDecimal: "3", baseCost: "0.02" })]); strict.equal(JSON.stringify(await (getWorkspaceRecordForActor)(limited, "decimal-quote")).includes("baseCost"), false); issued = await (issueQuote)(limited, request.id, { recordId: "decimal-quote" }); strict.equal(issued.amount, "0.30"); strict.equal(issued.customerSnapshot?.name, request.name); strict.equal(issued.customerSnapshot?.email, buyer.email); strict.equal(issued.customerSnapshot?.address, "Approved billing address"); strict.equal(issued.pricebookSnapshot?.id, cents.id); strict.ok(issued.sellerSnapshot?.name); strict.equal(issued.calculationPolicyVersion, "local-line-half-up-v1"); strict.equal(JSON.stringify(issued).includes("baseCost"), false); const retries = await Promise.all([(issueQuote)(limited, request.id, { recordId: "decimal-quote" }), (issueQuote)(limited, request.id, { recordId: "decimal-quote" })]); strict.ok(retries.every(row => row.id === issued.id)); strict.equal((await (query)("SELECT id FROM quote_snapshots WHERE record_id=$1", ["decimal-quote"])).rowCount, 1); await strict.rejects((query)("UPDATE crm_quote_approvals SET commercial_hash=$1 WHERE quote_id=$2", ["a".repeat(64), "decimal-quote"]), error => error.code === "23514"); });
        await t.test("discount policy is senior-only, versioned and checked again before a fresh issue without breaking issued retries", async () => { await approvedQuote("discount-issued", mainRevision, [line({ discountPercentDecimal: "5" })]); const issuedBefore = await (issueQuote)(maker, request.id, { recordId: "discount-issued" }); await approvedQuote("discount-pending", mainRevision, [line({ discountPercentDecimal: "5" })]); const original = await (getCommercialPolicy)(senior); strict.equal(original.discountCeilings.admin, "10"); await strict.rejects((saveCommercialPolicy)(admin, { expectedVersion: original.version, discountCeilings: { admin: "100" } }), expected(403)); await strict.rejects((saveCommercialPolicy)(senior, { expectedVersion: original.version, discountCeilings: { inventedRole: "10" } }), expected(422)); await strict.rejects((saveCommercialPolicy)(senior, { expectedVersion: original.version, discountCeilings: { admin: "100.000001" } }), expected(422)); const reduced = await (saveCommercialPolicy)(senior, { expectedVersion: original.version, discountCeilings: { admin: "2" } }); strict.equal(reduced.discountCeilings.superAdmin, "100"); strict.equal(reduced.discountCeilings.admin, "2"); await strict.rejects((saveCommercialPolicy)(senior, { expectedVersion: original.version, discountCeilings: { admin: "3" } }), expected(409, "CONFLICT")); await strict.rejects((issueQuote)(maker, request.id, { recordId: "discount-pending" }), expected(409, "DISCOUNT_POLICY_CHANGED")); strict.equal((await (issueQuote)(maker, request.id, { recordId: "discount-issued" })).id, issuedBefore.id); await strict.rejects((query)("UPDATE crm_commercial_policies SET discount_ceilings=discount_ceilings WHERE version=$1", [reduced.version]), error => error.code === "23514"); await (saveCommercialPolicy)(senior, { expectedVersion: reduced.version, discountCeilings: { admin: "10" } }); strict.equal((await (issueQuote)(maker, request.id, { recordId: "discount-pending" })).amount, "95.00"); });
        await t.test("customer and seller changes require fresh exact commercial approval while previously issued snapshots stay unchanged", async () => { await approvedQuote("party-quote", mainRevision); await (query)("UPDATE requests SET data=jsonb_set(data,'{name}',to_jsonb($2::text)) WHERE id=$1", [request.id, "Changed after review"]); await strict.rejects((issueQuote)(maker, request.id, { recordId: "party-quote" }), expected(409, "QUOTE_COMMERCIAL_APPROVAL")); await review(admin, "party-quote"); const revised = await (issueQuote)(maker, request.id, { recordId: "party-quote" }); strict.equal(revised.customerSnapshot?.name, "Changed after review"); strict.equal((await (query)("SELECT snapshot FROM quote_snapshots WHERE id=$1", [issued.id])).rows[0].snapshot.customerSnapshot?.name, request.name); await (query)("UPDATE requests SET data=jsonb_set(data,'{name}',to_jsonb($2::text)) WHERE id=$1", [request.id, request.name]); await approvedQuote("seller-quote", mainRevision); const original = (await (query)("SELECT preferences_published FROM workspace_meta WHERE singleton=true")).rows[0].preferences_published; await (query)("UPDATE workspace_meta SET preferences_published=jsonb_set(preferences_published,'{brand,name,en}',to_jsonb('Updated legal seller'::text)) WHERE singleton=true"); await strict.rejects((issueQuote)(maker, request.id, { recordId: "seller-quote" }), expected(409, "QUOTE_COMMERCIAL_APPROVAL")); await (query)("UPDATE workspace_meta SET preferences_published=$1::jsonb WHERE singleton=true", [JSON.stringify(original)]); });
        await t.test("superseded or expired pricebooks block new issuance and retained issued revisions remain retrievable", async () => {
            const original = await pricebook("changing-pricebook");
            await approvedQuote("pricebook-issued", original.id);
            const result = await (issueQuote)(maker, request.id, { recordId: "pricebook-issued" });
            await approvedQuote("pricebook-pending", original.id);
            const newSource = commercial("changing-pricebook", "pricebook", [line({ unitPriceDecimal: "110" })], { status: "review" });
            await edit(maker, "changing-pricebook", { status: "review", amount: newSource.amount, details: newSource.details });
            await review(admin, "changing-pricebook");
            const revised = (await (listPricebookVersions)(maker)).items.find(row => row.pricebookId === "changing-pricebook");
            strict.equal(revised.version, 2);
            strict.notEqual(revised.id, original.id);
            await strict.rejects((issueQuote)(maker, request.id, { recordId: "pricebook-pending" }), expected(409, "PRICEBOOK_SUPERSEDED"));
            strict.equal((await (issueQuote)(maker, request.id, { recordId: "pricebook-issued" })).id, result.id);
            const expiring = await pricebook("expiring-pricebook", [line()], { details: { pricebookPolicy: { schemaVersion: 1, market: "global", validFrom: new Date(Date.now() - 864e5).toISOString(), validUntil: new Date(Date.now() + 6e5).toISOString() } } });
            await approvedQuote("expiry-issued", expiring.id);
            const prior = await (issueQuote)(maker, request.id, { recordId: "expiry-issued" });
            await approvedQuote("expiry-pending", expiring.id);
            const realNow = Date.now;
            try {
                const future = realNow() + 36e5;
                Date.now = () => future;
                await strict.rejects((issueQuote)(maker, request.id, { recordId: "expiry-pending" }), expected(409, "PRICEBOOK_EXPIRED"));
                strict.equal((await (issueQuote)(maker, request.id, { recordId: "expiry-issued" })).id, prior.id);
            }
            finally {
                Date.now = realNow;
            }
        });
        await t.test("revoked reviewers cannot authorize fresh issuance and a new independent reviewer can reapprove the same source", async () => { const version = await pricebook("revocable-pricebook", [line()], {}, secondAdmin); await approvedQuote("revocable-quote", version.id, [line()], secondAdmin); await (query)("UPDATE users SET active=false WHERE id=$1", [secondAdmin.id]); strict.equal((await (listPricebookVersions)(maker)).items.some(row => row.pricebookId === "revocable-pricebook"), false); await strict.rejects((issueQuote)(maker, request.id, { recordId: "revocable-quote" }), expected(409, "QUOTE_APPROVER_REVOKED")); await review(admin, "revocable-pricebook"); const replacement = (await (listPricebookVersions)(maker)).items.find(row => row.pricebookId === "revocable-pricebook"); strict.notEqual(replacement.id, version.id); strict.equal(replacement.version, 2); const current = await (getWorkspaceRecordForActor)(maker, "revocable-quote"); await edit(maker, current.id, { status: "review", details: { ...current.details, commercialDraft: { ...current.details.commercialDraft, pricebookRevisionId: replacement.id } } }); await review(admin, current.id); strict.equal((await (issueQuote)(maker, request.id, { recordId: current.id })).pricebookSnapshot?.id, replacement.id); await (query)("UPDATE users SET active=true WHERE id=$1", [secondAdmin.id]); });
        await t.test("forged actor grants, inaccessible pricebooks and missing customer grants fail closed at issuance", async () => { await (query)("UPDATE users SET crm_scope='assigned' WHERE id=$1", [limited.id]); strict.equal((await (listPricebookVersions)(limited)).items.length, 0); await strict.rejects((issueQuote)({ ...limited, crmAccess: { scope: "all", permissions: { contact: true, financial: true, baseCost: true, assign: true, intake: true }, teamIds: [], territoryIds: [] } }, request.id, { recordId: "decimal-quote" }), expected(404)); await (query)("UPDATE users SET crm_scope='all',crm_permissions=jsonb_set(crm_permissions,'{contact}','false') WHERE id=$1", [limited.id]); await strict.rejects((issueQuote)(limited, request.id, { recordId: "decimal-quote" }), expected(403, "CRM_CONTACT_REQUIRED")); await (query)("UPDATE users SET crm_permissions=jsonb_set(crm_permissions,'{contact}','true') WHERE id=$1", [limited.id]); await strict.rejects((query)("INSERT INTO crm_commercial_policies(discount_ceilings) VALUES($1::jsonb)", [JSON.stringify({ admin: "101" })]), error => error.code === "23514"); });
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
