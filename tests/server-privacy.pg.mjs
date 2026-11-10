/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { HttpError } from "../src/server/types";
import { join } from "node:path";
import { spawn } from "node:child_process";
import node_test from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import pg from "pg";
import { closeDb, query, transaction } from "../src/server/db";
import { register } from "../src/server/auth";
import strict from "node:assert/strict";
import { createPrivacyRequest, decidePrivacyRequest, initializePrivacyLedger, privacyLedgerStatus, getPrivacyRequest, exportPrivacyRequest, listPrivacyRequests, createPrivacyHold, updatePrivacyHold, executePrivacyErasure, assertPrivacyReady, reconcilePrivacyLedger } from "../src/server/privacy";
import { getWorkspace, saveWorkspace } from "../src/server/workspace";
import { recordText } from "../src/data/workspace-seed";
import { readPrivacyLedger } from "../src/server/privacy-ledger";
import { createRequest } from "../src/server/requests";
import { products } from "../src/data/catalog";
import { prepareIssuedQuoteArtifact, persistIssuedQuoteArtifact } from "../src/server/quote-artifacts";
import { hash, encrypt } from "../src/server/crypto";
import { saveCrmDomain } from "../src/server/workspace-domain-core";
const define_import_meta_default = import.meta;
const database = process.env.TEST_ADMIN_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;
const actor = (id, role = "customer") => ({ id, role, name: "Operator " + id, email: id + "@example.invalid", qualityScope: false, allowedLocales: ["fa", "en", "tr", "ar", "ru"], mfaVerified: true });
const admin = actor("privacy-admin", "superAdmin"), reviewer = actor("privacy-reviewer", "admin"), business = actor("privacy-business", "business"), outsider = actor("privacy-outsider", "business"), bob = actor("privacy-bob"), other = actor("privacy-other");
const status = value => error => error instanceof HttpError && error.status === value;
const subjects = new Map;
function nativePg(binary, args, connection) { return new Promise((resolve, reject) => { const file = process.env.TEST_POSTGRES_BIN ? (join)(process.env.TEST_POSTGRES_BIN, binary) : binary, url = new URL(connection); const child = (spawn)(file, binary === "pg_restore" ? ["--dbname=" + decodeURIComponent(url.pathname.slice(1)), ...args] : args, { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGOPTIONS: url.searchParams.get("options") || "", ...process.env.TEST_POSTGRES_LIBRARY ? { LD_LIBRARY_PATH: process.env.TEST_POSTGRES_LIBRARY } : {} } }); let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk.toString(); }); child.on("error", error => reject(error)); child.on("close", code => code === 0 ? resolve() : reject(new Error(binary + " failed with " + code + ": " + stderr.replaceAll(connection, "[database]")))); }); }
(node_test)("PostgreSQL privacy holds, scoped export, physical erasure and anti-resurrection recovery", { skip: !database, timeout: 18e4 }, async (t) => {
    const schema = "privacy_test_" + (randomUUID)().replaceAll("-", ""), directory = await (mkdtemp)((join)((tmpdir)(), "idealmakoo-privacy-test-")), control = new pg.Client({ connectionString: database });
    await control.connect();
    await control.query("CREATE SCHEMA " + schema);
    const keys = ["DATABASE_URL", "SESSION_SECRET", "MFA_ENCRYPTION_KEY", "SITE_URL", "DEMO_MODE", "PRIVACY_LEDGER_DIR"], old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const scoped = new URL(database);
    scoped.searchParams.set("options", "-c search_path=" + schema);
    process.env.DATABASE_URL = scoped.toString();
    process.env.SITE_URL = "https://example.invalid";
    process.env.SESSION_SECRET ||= (randomBytes)(32).toString("hex");
    process.env.MFA_ENCRYPTION_KEY ||= (randomBytes)(32).toString("hex");
    process.env.PRIVACY_LEDGER_DIR = (join)(directory, "external-ledger");
    delete process.env.DEMO_MODE;
    await (closeDb)();
    async function signup(label) { const response = await (register)(new Request("https://example.invalid/api/v1/auth/register/", { headers: { "User-Agent": "local privacy integration" } }), { name: label, email: label.toLowerCase() + "@example.invalid", password: "Isolated-privacy-pass-2026!" }); strict.equal(response.status, 201); const data = await response.json(); const user = { ...actor(data.user.id), name: data.user.name, email: data.user.email }; subjects.set(label, user); return user; }
    async function requestErase(subject, requestedBy = admin) { return (createPrivacyRequest)(requestedBy, { subject, action: "erase", reason: "Remove the structured identity after the retention review." }); }
    async function approve(request, by = reviewer) { return (decidePrivacyRequest)(by, request.id, { decision: "approved", reason: "Independent review of the declared scope completed." }, request.version); }
    async function contact(id) { const workspace = await (getWorkspace)(business), row = { id, collection: "contacts", title: (recordText)("Unique Person " + (randomUUID)()), summary: (recordText)("Private contact notes " + (randomUUID)()), status: "new", owner: "business", email: id + "@example.invalid", tags: [], demo: false, history: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; await (saveWorkspace)(business, { state: { ...workspace.state, records: [...workspace.state.records, row] }, expectedVersion: workspace.version }); return row; }
    try {
        const client = new pg.Client({ connectionString: scoped.toString() });
        await client.connect();
        for (const file of (await (readdir)(new URL("../db/migrations/", define_import_meta_default.url))).filter(value => value.endsWith(".sql")).sort())
            await client.query(await (readFile)(new URL("../db/migrations/" + file, define_import_meta_default.url), "utf8"));
        await client.end();
        const initial = await (initializePrivacyLedger)();
        strict.equal(initial.sequence, 0);
        strict.equal((await (privacyLedgerStatus)()).ready, true);
        for (const user of [admin, reviewer, business, outsider, bob, other]) {
            await (query)("INSERT INTO users(id,email,name,password_hash,role,mfa_enabled,crm_scope,crm_permissions) VALUES($1,$2,$3,$4,$5,true,$6,$7::jsonb)", [user.id, user.email, user.name, "No login credential", user.role, "assigned", JSON.stringify({ contact: true, financial: false, baseCost: false, assign: false, intake: false })]);
            await (query)("INSERT INTO user_settings(user_id) VALUES($1)", [user.id]);
        }
        let heldUser, completedId = "";
        await t.test("customers cannot create, read or export another subject and reasons avoid copied personal data", async () => { heldUser = await signup("PrivacyFreshIdentity"); const request = await (createPrivacyRequest)(bob, { subject: { type: "user", id: bob.id }, action: "export", reason: "Download my structured account information." }); await strict.rejects((createPrivacyRequest)(other, { subject: { type: "user", id: bob.id }, action: "erase", reason: "Unauthorized cross-account action." }), status(404)); await strict.rejects((getPrivacyRequest)(other, request.id), status(404)); await strict.rejects((exportPrivacyRequest)(other, request.id), status(404)); await strict.rejects((createPrivacyRequest)(bob, { subject: { type: "user", id: bob.id }, action: "erase", reason: "Delete " + bob.email }), status(422)); strict.equal((await (listPrivacyRequests)(other)).items.length, 0); });
        await t.test("an active hold blocks independently approved erasure without appending a tombstone", async () => { const subject = { type: "user", id: heldUser.id }; let request = await requestErase(subject, heldUser); const hold = await (createPrivacyHold)(admin, { subject, reason: "Retention case reference CASE-2026-001.", expiresAt: new Date(Date.now() + 864e5).toISOString() }); await strict.rejects((updatePrivacyHold)(other, hold.id, { reason: "Unauthorized release." }, hold.version, true), status(403)); await strict.rejects((updatePrivacyHold)(admin, hold.id, { reason: "Case closed." }, hold.version + 1, true), status(409)); request = await approve(request); strict.equal(request.status, "blocked"); strict.ok(request.blockers.some(item => item.code === "LEGAL_HOLD")); request = await (executePrivacyErasure)(admin, request.id, { confirmSubjectId: subject.id }, request.version); strict.equal(request.status, "blocked"); strict.equal((await (readPrivacyLedger)()).head.sequence, 0); strict.equal((await (query)("SELECT id FROM users WHERE id=$1", [subject.id])).rowCount, 1); await (updatePrivacyHold)(admin, hold.id, { reason: "The case is closed; retention no longer applies." }, hold.version, true); completedId = request.id; });
        await t.test("physical account erasure is idempotent and a real older pg_dump cannot revive it after recovery", async () => { const anchor = (await (readPrivacyLedger)()).head, backup = (join)(directory, "before-erasure.dump"); await nativePg("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--schema=" + schema, "--file=" + backup], scoped.toString()); let request = await (getPrivacyRequest)(admin, completedId); const previousVersion = request.version; request = await (executePrivacyErasure)(admin, request.id, { confirmSubjectId: heldUser.id }, request.version); strict.equal(request.status, "completed"); strict.equal(request.result?.method, "physical-structured-subject-deletion"); strict.equal((await (query)("SELECT id FROM users WHERE id=$1", [heldUser.id])).rowCount, 0); strict.equal((await (query)("SELECT user_id FROM user_settings WHERE user_id=$1", [heldUser.id])).rowCount, 0); strict.equal((await (query)("SELECT id FROM sessions WHERE user_id=$1", [heldUser.id])).rowCount, 0); const repeated = await (executePrivacyErasure)(admin, request.id, { confirmSubjectId: heldUser.id }, previousVersion); strict.equal(repeated.status, "completed"); strict.equal((await (readPrivacyLedger)()).head.sequence, 1); await (closeDb)(); await control.query("DROP SCHEMA " + schema + " CASCADE"); await nativePg("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", backup], scoped.toString()); strict.equal((await (query)("SELECT id FROM users WHERE id=$1", [heldUser.id])).rowCount, 1, "The isolated restored backup really predates erasure"); strict.equal((await (privacyLedgerStatus)()).ready, false); await strict.rejects((assertPrivacyReady)(), status(503)); const restored = await (reconcilePrivacyLedger)(anchor); strict.equal(restored.sequence, 1); strict.equal((await (query)("SELECT id FROM users WHERE id=$1", [heldUser.id])).rowCount, 0); strict.equal((await (privacyLedgerStatus)()).ready, true); await (reconcilePrivacyLedger)(anchor); strict.equal((await (readPrivacyLedger)()).head.sequence, 1); await strict.rejects((query)("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)", [heldUser.id, heldUser.email, heldUser.name, "Revival attempt"]), error => error.code === "23514"); const fresh = await signup("PrivacyFreshIdentity"); strict.notEqual(fresh.id, heldUser.id, "A new explicit signup is a new identity with none of the erased account settings"); });
        await t.test("current CRM field and owner scopes protect requests and a second administrator must approve", async () => { const record = await contact("privacy-owned-contact"); const request = await requestErase({ type: "crm-contact", id: record.id }, business); await strict.rejects((getPrivacyRequest)(outsider, request.id), status(404)); await (query)("UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1", [business.id, JSON.stringify({ contact: false })]); await strict.rejects((getPrivacyRequest)(business, request.id), status(404)); await (query)("UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1", [business.id, JSON.stringify({ contact: true })]); const approved = await approve(request); const result = await (executePrivacyErasure)(admin, request.id, { confirmSubjectId: record.id }, approved.version); strict.equal(result.status, "completed"); strict.equal((await (query)("SELECT id FROM workspace_entities WHERE bucket='records' AND id=$1", [record.id])).rowCount, 0); strict.ok((await (query)("SELECT id FROM workspace_audit WHERE entity_id=$1", [record.id])).rowCount, "Pseudonymous immutable audit evidence is explicitly retained"); const otherRecord = await contact("privacy-maker-check"), maker = await requestErase({ type: "crm-contact", id: otherRecord.id }, admin); await strict.rejects(approve(maker, admin), status(409)); });
        await t.test("issued snapshots, customer cases and unknown foreign keys block deletion with exact reasons", async () => { const record = await contact("privacy-financial-contact"); const request = await (createRequest)(new Request("https://example.invalid/api/v1/requests/"), bob, { kind: "rfq", productIds: [products[0].id], name: "Stored request participant", email: bob.email, message: "An actual retained customer inquiry.", consent: { purpose: "request_processing", acceptedAt: new Date().toISOString() } }, "privacy-real-request-001"); const quoteId = (randomUUID)(), artifact = await (prepareIssuedQuoteArtifact)({ id: quoteId, recordId: "privacy-retained-quote-" + (randomUUID)(), requestId: request.id, locale: "fa", number: "PRIVACY-RETAINED-QUOTE", title: "Retained approved business offer", amount: "12000.00", currency: "USD", status: "issued", issuedAt: new Date().toISOString(), snapshotHash: (hash)(JSON.stringify({ subject: record.id, email: record.email, total: 12e3 })), customerSnapshot: { name: record.title.fa, organization: "", email: record.email || "", phone: "", country: "", address: "" }, sellerSnapshot: { name: "Retained issuer", address: "Issuer business address", email: "issuer@example.invalid", phone: "" } }), snapshot = artifact.snapshot; await (transaction)(async (client2) => { await client2.query("INSERT INTO quote_snapshots(id,request_id,record_id,locale,snapshot,snapshot_hash,issued_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)", [quoteId, request.id, snapshot.recordId, "fa", JSON.stringify(snapshot), snapshot.snapshotHash, admin.id]); await (persistIssuedQuoteArtifact)(client2, snapshot, artifact.bytes); }); const pending = await requestErase({ type: "crm-contact", id: record.id }, business), approved = await approve(pending), before = (await (readPrivacyLedger)()).head.sequence; const blocked = await (executePrivacyErasure)(admin, approved.id, { confirmSubjectId: record.id }, approved.version); strict.equal(blocked.status, "blocked"); strict.ok(blocked.blockers.some(item => item.code === "IMMUTABLE_QUOTES")); strict.deepEqual((await (query)("SELECT snapshot FROM quote_snapshots WHERE id=$1", [quoteId])).rows[0].snapshot, snapshot); strict.equal((await (readPrivacyLedger)()).head.sequence, before); const customerRequest = await approve(await requestErase({ type: "user", id: bob.id }, bob)); strict.ok(customerRequest.blockers.some(item => item.code === "RELATED_REQUESTS" || item.code === "DEPENDENCY_REQUESTS")); const custom = await signup("PrivacyDependentIdentity"); await (query)("CREATE TABLE future_retained_dependency(id integer PRIMARY KEY,user_id text NOT NULL REFERENCES users(id))"); await (query)("INSERT INTO future_retained_dependency(id,user_id) VALUES(1,$1)", [custom.id]); const dependency = await approve(await requestErase({ type: "user", id: custom.id }, custom)); strict.ok(dependency.blockers.some(item => item.code === "DEPENDENCY_FUTURE_RETAINED_DEPENDENCY")); });
        await t.test("scoped JSON export omits credentials and internal request messages", async () => { const requestId = (await (query)("SELECT id FROM requests WHERE owner_id=$1", [bob.id])).rows[0].id; await (query)("INSERT INTO request_messages(id,request_id,body,visibility,actor_id) VALUES($1,$2,$3,$4,$5)", [(randomUUID)(), requestId, "PRIVATE STAFF DISCUSSION NEVER EXPORT", "internal", admin.id]); const request = await (createPrivacyRequest)(bob, { subject: { type: "user", id: bob.id }, action: "export", reason: "Download my structured account information." }), response = await (exportPrivacyRequest)(bob, request.id); strict.equal(response.status, 200); strict.match(response.headers.get("Content-Disposition") || "", /^attachment;/); const body = await response.text(); strict.ok(body.includes(bob.email)); strict.equal(body.includes("PRIVATE STAFF DISCUSSION NEVER EXPORT"), false); strict.equal(body.includes("password_hash"), false); strict.equal(body.includes("token_hash"), false); strict.equal(body.includes("csrf_token"), false); strict.equal((await (getPrivacyRequest)(bob, request.id)).status, "completed"); });
        await t.test("isolated normalized contacts export typed identity and cascade endpoints, recipient and challenges safely", async () => {
            const record = await contact("privacy-normalized-contact");
            const workspace = await (getWorkspace)(business);
            await (saveCrmDomain)(business, record.id, { expectedVersion: workspace.version, value: { schemaVersion: 1, kind: "contact", givenName: "Distinct " + (randomUUID)(), familyName: "Identity " + (randomUUID)(), displayName: record.title.fa, locale: "fa", affiliations: [], endpoints: [{ channel: "email", value: record.email, label: "Private endpoint", active: true }, { channel: "phone", value: "+989121236789", label: "Private phone", active: true }] } });
            const endpoints = (await (query)("SELECT id,version,normalized_value FROM crm_contact_endpoints WHERE contact_id=$1", [record.id])).rows;
            strict.equal(endpoints.length, 2);
            await (query)("INSERT INTO crm_endpoint_challenges(token_hash,endpoint_id,endpoint_version,value_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [(hash)("isolated endpoint challenge"), endpoints[0].id, endpoints[0].version, (hash)(endpoints[0].normalized_value)]);
            const exported = await (createPrivacyRequest)(business, { subject: { type: "crm-contact", id: record.id }, action: "export", reason: "Review the normalized structured contact information." }), response = await (exportPrivacyRequest)(business, exported.id), output = await response.json();
            strict.equal(output.endpoints.length, 2);
            strict.equal(output.profile.locale, "fa");
            strict.equal(JSON.stringify(output).includes("token_hash"), false);
            strict.equal(JSON.stringify(output).includes((hash)("isolated endpoint challenge")), false);
            const approved = await approve(await requestErase({ type: "crm-contact", id: record.id }, business));
            strict.equal(approved.status, "approved", JSON.stringify(approved.blockers));
            const erased = await (executePrivacyErasure)(admin, approved.id, { confirmSubjectId: record.id }, approved.version);
            strict.equal(erased.status, "completed");
            for (const table of ["crm_contact_profiles", "communication_recipients", "crm_contact_endpoints"])
                strict.equal((await (query)("SELECT 1 FROM " + table + " WHERE " + (table === "crm_contact_profiles" ? "record_id" : "contact_id") + "=$1", [record.id])).rowCount, 0);
            strict.equal((await (query)("SELECT 1 FROM crm_endpoint_challenges WHERE endpoint_id=ANY($1::uuid[])", [endpoints.map(endpoint => endpoint.id)])).rowCount, 0);
        });
        await t.test("retained children and unknown incoming foreign keys block a profile cascade before external intent", async () => {
            const record = await contact("privacy-normalized-retained"), workspace = await (getWorkspace)(business);
            await (saveCrmDomain)(business, record.id, { expectedVersion: workspace.version, value: { schemaVersion: 1, kind: "contact", givenName: "", familyName: "", displayName: record.title.fa, locale: "fa", affiliations: [], endpoints: [{ channel: "email", value: record.email, label: "Retained endpoint", active: true }] } });
            const endpoint = (await (query)("SELECT id,version FROM crm_contact_endpoints WHERE contact_id=$1", [record.id])).rows[0];
            await (query)("INSERT INTO crm_endpoint_consent_events(endpoint_id,endpoint_version,topic,accepted,source,policy_version) VALUES($1,$2,'products',true,'verified-recipient','test-v1')", [endpoint.id, endpoint.version]);
            await (query)("CREATE TABLE future_contact_evidence(id integer PRIMARY KEY,recipient_id uuid REFERENCES communication_recipients(id),note text)");
            await (query)("INSERT INTO future_contact_evidence(id,recipient_id,note) SELECT 1,id,$2 FROM communication_recipients WHERE contact_id=$1", [record.id, "Retained business evidence without copied personal text"]);
            await (query)("INSERT INTO outbox(id,kind,payload,dedupe_key,crm_contact_id) VALUES($1,'notification.email',$2::jsonb,$3,$4)", [(randomUUID)(), JSON.stringify({ encrypted: (encrypt)(JSON.stringify({ to: record.email, title: "Verification", body: "Private endpoint challenge" })) }), "privacy-retained-endpoint-mail", record.id]);
            const before = (await (readPrivacyLedger)()).head.sequence, approved = await approve(await requestErase({ type: "crm-contact", id: record.id }, business));
            strict.equal(approved.status, "blocked");
            for (const name of ["DEPENDENCY_CRM_ENDPOINT_CONSENT_EVENTS", "DEPENDENCY_FUTURE_CONTACT_EVIDENCE", "DEPENDENCY_OUTBOX"])
                strict.ok(approved.blockers.some(blocker => blocker.code === name), name);
            const result = await (executePrivacyErasure)(admin, approved.id, { confirmSubjectId: record.id }, approved.version);
            strict.equal(result.status, "blocked");
            strict.equal((await (readPrivacyLedger)()).head.sequence, before);
            strict.equal((await (query)("SELECT 1 FROM crm_contact_endpoints WHERE id=$1", [endpoint.id])).rowCount, 1);
        });
        await t.test("copied encrypted CSV evidence and future report text are retained blockers without a subject foreign key", async () => { const user = await signup("PrivacyCopiedIdentity"), jobId = (randomUUID)(); await (query)("INSERT INTO crm_transfer_jobs(id,kind,collection,name,source_hash,state,row_count,created_by) VALUES($1,'import','contacts','Private retained preview',$2,'preview',1,$3)", [jobId, (hash)("private preview source"), admin.id]); await (query)("INSERT INTO crm_transfer_rows(job_id,row_number,state,payload,planned_record_id) VALUES($1,1,'ready',$2::jsonb,$3)", [jobId, JSON.stringify({ encrypted: (encrypt)(JSON.stringify({ values: { external_id: "retained-copy", email: user.email, title_fa: user.name } })) }), "planned-retained-copy"]); await (query)("CREATE TABLE future_private_reports(id integer PRIMARY KEY,report jsonb NOT NULL)"); await (query)("INSERT INTO future_private_reports(id,report) VALUES(1,$1::jsonb)", [JSON.stringify({ participant: user.name, email: user.email })]); const before = (await (readPrivacyLedger)()).head.sequence, approved = await approve(await requestErase({ type: "user", id: user.id }, user)); strict.equal(approved.status, "blocked"); strict.ok(approved.blockers.some(blocker => blocker.code === "RETAINED_CRM_TRANSFER_ROWS")); strict.ok(approved.blockers.some(blocker => blocker.code === "RETAINED_TEXT_FUTURE_PRIVATE_REPORTS")); strict.equal((await (readPrivacyLedger)()).head.sequence, before); });
        await t.test("a failure after durable intent is fail-closed and replay completes the approved operation", async () => { const user = await signup("PrivacyInterruptedIdentity"), request = await approve(await requestErase({ type: "user", id: user.id }, user)); await (query)("CREATE FUNCTION test_interrupt_erasure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected test interruption'; END $$"); await (query)(`CREATE TRIGGER test_interrupt_erasure BEFORE DELETE ON users FOR EACH ROW WHEN (OLD.id='${user.id}') EXECUTE FUNCTION test_interrupt_erasure()`); const before = (await (readPrivacyLedger)()).head.sequence; await strict.rejects((executePrivacyErasure)(admin, request.id, { confirmSubjectId: user.id }, request.version)); strict.equal((await (readPrivacyLedger)()).head.sequence, before + 1); strict.equal((await (query)("SELECT id FROM users WHERE id=$1", [user.id])).rowCount, 1); await strict.rejects((assertPrivacyReady)(), status(503)); await (query)("DROP TRIGGER test_interrupt_erasure ON users"); await (query)("DROP FUNCTION test_interrupt_erasure()"); await (reconcilePrivacyLedger)(); strict.equal((await (query)("SELECT id FROM users WHERE id=$1", [user.id])).rowCount, 0); strict.equal((await (getPrivacyRequest)(admin, request.id)).status, "completed"); strict.equal((await (privacyLedgerStatus)()).ready, true); });
        await t.test("missing, modified, partial and rolled-back external ledgers never pass readiness", async () => {
            const path = (join)(process.env.PRIVACY_LEDGER_DIR, "erasures.jsonl"), original = await (readFile)(path, "utf8");
            try {
                const lines = original.trimEnd().split("\n"), entry = JSON.parse(lines[0]);
                entry.subject.id = "altered-identity";
                lines[0] = JSON.stringify(entry);
                await (writeFile)(path, lines.join("\n") + "\n", { mode: 384 });
                await strict.rejects((assertPrivacyReady)(), status(503));
                await (writeFile)(path, original.slice(0, -1), { mode: 384 });
                await strict.rejects((assertPrivacyReady)(), status(503));
                await (writeFile)(path, "", { mode: 384 });
                await strict.rejects((assertPrivacyReady)(), status(503));
                await (rename)(path, path + ".offline");
                await strict.rejects((assertPrivacyReady)(), status(503));
                await (rename)(path + ".offline", path);
            }
            finally {
                await (writeFile)(path, original, { mode: 384 });
            }
            strict.equal((await (privacyLedgerStatus)()).ready, true);
            await strict.rejects((transaction)(client2 => client2.query("DELETE FROM privacy_tombstones")), error => error.code === "23514");
        });
    }
    finally {
        await (closeDb)();
        for (const key of keys) {
            if (old[key] === void 0)
                delete process.env[key];
            else
                process.env[key] = old[key];
        }
        await control.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        await control.end();
        await (rm)(directory, { recursive: true, force: true });
    }
});
