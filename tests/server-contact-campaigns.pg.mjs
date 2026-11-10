/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { HttpError } from "../src/server/types";
import node_test from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { closeDb, query, transaction } from "../src/server/db";
import { createCrmSegment, createCrmCampaign, scheduleCrmCampaign, runCrmCampaigns, cancelCrmCampaign, previewCrmSegment, searchCrmCampaignRecipients, snapshotCrmSegment, getCrmCampaign, createCrmSuppression, revokeCrmSuppression } from "../src/server/crm-campaigns";
import strict from "node:assert/strict";
import { deliverOutbox } from "../src/server/notifications";
import { requestContactPreferences, captureContactEndpoints, getContactPreferenceView, patchContactPreferenceView, contactPreferencesResponse, contactUnsubscribeResponse } from "../src/server/contact-notifications";
import { decrypt, hash } from "../src/server/crypto";
import { readdir, readFile } from "node:fs/promises";
import { requestCrmEndpointVerification, confirmCrmContactEndpoint } from "../src/server/workspace-domain-endpoints";
import { flushNotificationDigests } from "../src/server/notification-policy";
const define_import_meta_default = import.meta;
const langs = ["fa", "en", "tr", "ar", "ru"];
const mkActor = (id, role) => ({ id, role, name: id, email: id + "@example.invalid", qualityScope: false, allowedLocales: [...langs], mfaVerified: true });
const admin = mkActor("contact-campaign-admin", "admin"), seller = mkActor("contact-campaign-seller", "business"), other = mkActor("contact-campaign-other", "business");
const status = n => error => error instanceof HttpError && error.status === n;
const text = label => Object.fromEntries(langs.map(locale => [locale, { title: label + " " + locale, body: "Verified independent recipient " + label + " " + locale, href: "/" + locale + "/products/" }]));
const database = process.env.TEST_ADMIN_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;
(node_test)("typed contact campaign upgrade, endpoint consent and independent capability dispatch", { skip: !database, timeout: 24e4 }, async (t) => {
    const schema = "contact_campaign_" + (randomUUID)().replaceAll("-", ""), control = new pg.Client({ connectionString: database });
    await control.connect();
    await control.query("CREATE SCHEMA " + schema);
    const keys = ["DATABASE_URL", "SITE_URL", "SESSION_SECRET", "MFA_ENCRYPTION_KEY", "NOTIFICATIONS_MODE", "SMTP_HOST", "SMTP_FROM", "SMTP_DKIM_MODE", "CRM_CAMPAIGNS_ENABLED", "PRIVACY_LEDGER_DIR", "DEMO_MODE"], old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const scoped = new URL(database);
    scoped.searchParams.set("options", "-c search_path=" + schema);
    process.env.DATABASE_URL = scoped.toString();
    process.env.SITE_URL = "https://example.invalid";
    process.env.SESSION_SECRET ||= (randomBytes)(32).toString("hex");
    process.env.MFA_ENCRYPTION_KEY ||= (randomBytes)(32).toString("hex");
    process.env.NOTIFICATIONS_MODE = "live";
    process.env.SMTP_HOST = "smtp.example.invalid";
    process.env.SMTP_FROM = "sender@example.invalid";
    process.env.SMTP_DKIM_MODE = "gateway";
    process.env.CRM_CAMPAIGNS_ENABLED = "true";
    delete process.env.PRIVACY_LEDGER_DIR;
    delete process.env.DEMO_MODE;
    await (closeDb)();
    const messages = [], fakeMail = async (message) => { messages.push(message); return { accepted: [message.to], messageId: String(message.messageId) }; };
    const legacy = { user: "legacy-" + (randomUUID)(), segment: (randomUUID)(), snapshot: (randomUUID)(), campaign: (randomUUID)(), revision: (randomUUID)(), enrollment: (randomUUID)(), suppression: (randomUUID)(), hash: "a".repeat(64) };
    async function staff() {
        for (const actor of [admin, seller, other])
            await (query)("INSERT INTO users(id,email,name,password_hash,role,mfa_enabled,crm_permissions) VALUES($1,$2,$3,$4,$5,true,$6::jsonb)", [actor.id, actor.email, actor.name, "isolated test fixture, not a credential", actor.role, JSON.stringify({ contact: true })]);
    }
    async function contact(tag, opts = {}) {
        const id = "contact-" + (randomUUID)(), recipientId = (randomUUID)(), endpointId = (randomUUID)(), assigned = opts.assigned || seller, locale = opts.locale || "fa", email = opts.email || id + "@example.invalid";
        const record = { id, collection: "contacts", title: Object.fromEntries(langs.map(lang => [lang, "Person " + tag])), summary: Object.fromEntries(langs.map(lang => [lang, ""])), status: "active", owner: assigned.role, ownerId: assigned.id, tags: [tag, ...opts.quality ? ["quality"] : []], history: [], details: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), demo: false };
        await (query)("INSERT INTO workspace_entities(bucket,id,collection,status,data,created_by,updated_by) VALUES('records',$1,'contacts','active',$2::jsonb,$3,$3)", [id, JSON.stringify(record), assigned.id]);
        await (query)("INSERT INTO crm_contact_profiles(record_id,given_name,family_name,display_name,locale) VALUES($1,$2,$3,$4,$5)", [id, "Person", tag, "Person " + tag, locale]);
        await (query)("INSERT INTO communication_recipients(id,subject_type,subject_id,contact_id) VALUES($1,'crm-contact',$2,$2)", [recipientId, id]);
        await (query)("INSERT INTO crm_contact_endpoints(id,contact_id,recipient_id,channel,value,normalized_value,label,active,verified_at) VALUES($1,$2,$3,'email',$4,$4,'Work',true,$5)", [endpointId, id, recipientId, email, opts.verified === false ? null : new Date]);
        if (opts.consent !== false && opts.verified !== false)
            for (const topic of ["products", "research", "events"])
                await (query)("INSERT INTO crm_endpoint_consent_events(endpoint_id,endpoint_version,topic,accepted,source,policy_version) VALUES($1,1,$2,true,'verified-recipient','isolated-real-policy-fixture')", [endpointId, topic]);
        return { id, recipientId, endpointId, email, locale, record };
    }
    async function segment(tag, audience = "contacts") { return (createCrmSegment)(seller, { name: "Audience " + tag, audience, active: true, filter: { field: "tag", op: "in", values: [tag] } }); }
    async function campaign(segmentId, steps = 1, channels = ["email"], snapshotId = null) { const draft = await (createCrmCampaign)(seller, { name: "Contact journey " + (randomUUID)(), segmentId, snapshotId, topic: "products", channels, steps: Array.from({ length: steps }, (_, i) => ({ delayMinutes: i ? 1 : 0, content: text("Step " + i) })) }); return (scheduleCrmCampaign)(seller, draft.id, { startAt: new Date().toISOString() }, draft.version); }
    async function jobs(campaignId) { return (await (query)(`SELECT o.id,o.state,o.last_error,e.recipient_id,e.user_id,e.endpoint_refs,d.step_index,e.id AS enrollment_id FROM crm_campaigns c JOIN crm_campaign_deliveries d ON d.revision_id=c.current_revision_id JOIN crm_campaign_enrollments e ON e.id=d.enrollment_id JOIN outbox o ON o.id=d.outbox_id WHERE c.id=$1 ORDER BY d.step_index,o.id`, [campaignId])).rows; }
    async function claim(id) { const row = (await (query)("UPDATE outbox SET state='running',lock_token=$2,locked_at=now(),attempts=attempts+1 WHERE id=$1 AND state='pending' RETURNING id,kind,payload,attempts,lock_token", [id, (randomUUID)()])).rows[0]; strict.ok(row, "An isolated pending outbox row exists"); return row; }
    async function deliver(id, mailer = fakeMail) { await (deliverOutbox)(await claim(id), { sendMail: mailer }); }
    async function outbox(id) { return (await (query)("SELECT state,last_error,payload,completed_at FROM outbox WHERE id=$1", [id])).rows[0]; }
    async function preferenceToken(person) { await (requestContactPreferences)(seller, person.id, person.endpointId); const row = (await (query)("SELECT payload FROM outbox WHERE crm_contact_id=$1 AND dedupe_key LIKE 'contact-preference:%' ORDER BY created_at DESC LIMIT 1", [person.id])).rows[0], payload = JSON.parse((decrypt)(row.payload.encrypted)); const raw = String(payload.text).match(/communication-preferences\/([a-f0-9]{64})/)?.[1]; strict.ok(raw); return raw; }
    async function prepared(steps = 1) { const tag = (randomUUID)(), person = await contact(tag), audience = await segment(tag), run = await campaign(audience.id, steps); await (runCrmCampaigns)(); return { ...person, run }; }
    try {
        const migrations = (await (readdir)(new URL("../db/migrations/", define_import_meta_default.url))).filter(file => file.endsWith(".sql")).sort();
        const migrate = new pg.Client({ connectionString: scoped.toString() });
        await migrate.connect();
        try {
            for (const file of migrations.filter(file2 => file2 < "034_"))
                await migrate.query(await (readFile)(new URL("../db/migrations/" + file, define_import_meta_default.url), "utf8"));
        }
        finally {
            await migrate.end();
        }
        await staff();
        await (query)("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,'Legacy recipient','fixture','customer')", [legacy.user, legacy.user + "@example.invalid"]);
        const oldDefinition = { name: "Legacy segment", active: true, filter: { field: "locale", op: "in", values: ["fa"] } }, oldDraft = { name: "Legacy campaign", segmentId: legacy.segment, snapshotId: legacy.snapshot, topic: "products", channels: ["email"], steps: [{ delayMinutes: 0, content: text("Legacy") }] };
        await (query)("INSERT INTO crm_segments(id,name,filter,created_by) VALUES($1,$2,$3::jsonb,$4)", [legacy.segment, oldDefinition.name, JSON.stringify(oldDefinition.filter), seller.id]);
        await (query)("INSERT INTO crm_segment_revisions(segment_id,version,definition,definition_hash,created_by) VALUES($1,1,$2::jsonb,$3,$4)", [legacy.segment, JSON.stringify(oldDefinition), legacy.hash, seller.id]);
        await (query)("INSERT INTO crm_segment_snapshots(id,segment_id,segment_version,definition_hash,membership_hash,created_by) VALUES($1,$2,1,$3,$3,$4)", [legacy.snapshot, legacy.segment, legacy.hash, seller.id]);
        await (query)("INSERT INTO crm_segment_snapshot_members(snapshot_id,user_id) VALUES($1,$2)", [legacy.snapshot, legacy.user]);
        await (query)("INSERT INTO crm_campaigns(id,name,draft,status,created_by,enrollment_cursor,enrollment_scanned) VALUES($1,'Legacy campaign',$2::jsonb,'running',$3,$4,1)", [legacy.campaign, JSON.stringify(oldDraft), seller.id, legacy.user]);
        await (query)("INSERT INTO crm_campaign_revisions(id,campaign_id,version,draft,segment_id,segment_version,filter,snapshot_id,sender_id,sender_scope,start_at,revision_hash) VALUES($1,$2,1,$3::jsonb,$4,1,$5::jsonb,$6,$7,'{}',now(),$8)", [legacy.revision, legacy.campaign, JSON.stringify(oldDraft), legacy.segment, JSON.stringify(oldDefinition.filter), legacy.snapshot, seller.id, legacy.hash]);
        await (query)("UPDATE crm_campaigns SET current_revision_id=$2,start_at=now() WHERE id=$1", [legacy.campaign, legacy.revision]);
        await (query)("INSERT INTO crm_campaign_enrollments(id,revision_id,user_id,locale,state) VALUES($1,$2,$3,'fa','completed')", [legacy.enrollment, legacy.revision, legacy.user]);
        await (query)("INSERT INTO crm_campaign_suppressions(id,user_id,sender_id,topic,channel,reason,created_by) VALUES($1,$2,$3,'products','email','Legacy explicit suppression',$3)", [legacy.suppression, legacy.user, seller.id]);
        for (const file of migrations.filter(file2 => file2 >= "034_")) {
            try {
                await (query)(await (readFile)(new URL("../db/migrations/" + file, define_import_meta_default.url), "utf8"));
            }
            catch (error) {
                throw new Error("Migration " + file + " failed", { cause: error });
            }
        }
        t.beforeEach(async () => { await (query)("UPDATE users SET active=true,mfa_enabled=true,allowed_locales=$2::jsonb,crm_permissions=$3::jsonb,crm_scope='assigned' WHERE id=$1", [seller.id, JSON.stringify(langs), JSON.stringify({ contact: true })]); process.env.CRM_CAMPAIGNS_ENABLED = "true"; });
        t.afterEach(async () => {
            for (const row of (await (query)("SELECT id,version FROM crm_campaigns WHERE status IN ('draft','scheduled','running')")).rows)
                await (cancelCrmCampaign)(admin, row.id, { reason: "Isolated test cleanup of pending campaign" }, row.version);
            await (query)("UPDATE outbox SET state='cancelled',lock_token=NULL WHERE state IN ('pending','running','batched')");
        });
        await t.test("populated pre-034 snapshots, enrollments and suppressions keep immutable history and typed IDs", async () => { const row = (await (query)("SELECT recipient_id,user_id,endpoint_refs FROM crm_campaign_enrollments WHERE id=$1", [legacy.enrollment])).rows[0]; strict.equal(row.user_id, legacy.user); strict.match(row.recipient_id, /^[a-f0-9-]{36}$/); strict.deepEqual(row.endpoint_refs, []); strict.equal((await (query)("SELECT recipient_id FROM crm_segment_snapshot_members WHERE snapshot_id=$1", [legacy.snapshot])).rows[0].recipient_id, row.recipient_id); strict.equal((await (query)("SELECT revision_hash,draft FROM crm_campaign_revisions WHERE id=$1", [legacy.revision])).rows[0].revision_hash, legacy.hash); strict.deepEqual((await (query)("SELECT definition FROM crm_segment_revisions WHERE segment_id=$1", [legacy.segment])).rows[0].definition, oldDefinition); strict.equal((await (query)("SELECT enrollment_cursor,enrollment_scanned FROM crm_campaigns WHERE id=$1", [legacy.campaign])).rows[0].enrollment_cursor, ""); await (query)("UPDATE crm_campaign_suppressions SET revoked_at=now(),revoked_by=$2,release_reason=$3,version=version+1 WHERE id=$1", [legacy.suppression, seller.id, "Release after populated migration check"]); await strict.rejects((query)("UPDATE crm_campaign_enrollments SET locale='en' WHERE id=$1", [legacy.enrollment]), /immutable/i); await strict.rejects((query)("DELETE FROM crm_segment_snapshot_members WHERE snapshot_id=$1", [legacy.snapshot]), /immutable/i); });
        await t.test("shared emails keep independent identities and current scope precedes counts", async () => {
            const tag = (randomUUID)(), same = "shared-" + tag + "@example.invalid", a = await contact(tag, { email: same }), b = await contact(tag, { email: same }), hidden = await contact(tag, { assigned: other, email: same }), quality = await contact(tag, { quality: true }), foreign = await contact(tag, { locale: "en" });
            await (query)("UPDATE users SET allowed_locales=$2::jsonb WHERE id=$1", [seller.id, JSON.stringify(["fa"])]);
            const group = await segment(tag), preview = await (previewCrmSegment)(seller, group.id, group.version);
            strict.equal(preview.matched, 2);
            strict.deepEqual(new Set(preview.sample.map(item => item.recipientId)), new Set([a.recipientId, b.recipientId]));
            strict.ok(preview.sample.every(item => item.subjectType === "crm-contact" && item.userId === void 0));
            const serialized = JSON.stringify(preview);
            for (const value of [hidden.id, quality.id, foreign.id, same])
                strict.equal(serialized.includes(value), false);
            const found = await (searchCrmCampaignRecipients)(seller, { search: tag, audience: "contacts" });
            strict.equal(found.items.length, 2);
            await (query)("UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1", [seller.id, "{}"]);
            await strict.rejects((previewCrmSegment)(seller, group.id, group.version), status(403));
        });
        await t.test("snapshot freezes typed membership but endpoint, consent and permissions remain current", async () => { const tag = (randomUUID)(), person = await contact(tag), group = await segment(tag), snapshot = await (snapshotCrmSegment)(seller, group.id, 1); await contact(tag); const run = await campaign(group.id, 1, ["email"], snapshot.id); await (runCrmCampaigns)(); const queued = await jobs(run.id); strict.equal(queued.length, 1); strict.equal(queued[0].recipient_id, person.recipientId); strict.equal(queued[0].user_id, null); strict.deepEqual(queued[0].endpoint_refs, [{ channel: "email", endpointId: person.endpointId, endpointVersion: 1, valueHash: (hash)(person.email) }]); await (query)("UPDATE workspace_entities SET data=jsonb_set(data,'{ownerId}',to_jsonb($2::text)) WHERE bucket='records' AND id=$1", [person.id, other.id]); const before = messages.length; await deliver(queued[0].id); strict.equal(messages.length, before); strict.equal((await outbox(queued[0].id)).state, "cancelled"); });
        await t.test("real endpoint confirmation separates verification from unchecked marketing consent", async () => { const tag = (randomUUID)(), person = await contact(tag, { verified: false, consent: false }); await (requestCrmEndpointVerification)(seller, person.id, person.endpointId, { locale: "fa" }); const row = (await (query)("SELECT payload FROM outbox WHERE crm_contact_id=$1 ORDER BY created_at DESC LIMIT 1", [person.id])).rows[0], payload = JSON.parse((decrypt)(row.payload.encrypted)), token = new URL(String(payload.text).split(" ").at(-1)).searchParams.get("contactVerification"); strict.ok(token); await (confirmCrmContactEndpoint)(new Request("https://example.invalid/api/v1/crm/contact-endpoints/confirm", { headers: { "x-forwarded-for": "198.51.100.43" } }), { token }); strict.ok((await (query)("SELECT verified_at FROM crm_contact_endpoints WHERE id=$1", [person.endpointId])).rows[0].verified_at); const refs = await (transaction)(client => (captureContactEndpoints)(client, person.recipientId, ["email"], "products")); strict.deepEqual(refs, []); const raw = await preferenceToken(person), view = await (getContactPreferenceView)(raw); strict.equal(view.preferences.topics.products.enabled, false); const prefs = structuredClone(view.preferences); prefs.topics.products.enabled = true; await (patchContactPreferenceView)(raw, { expectedVersion: view.version, preferences: prefs }); strict.equal((await (transaction)(client => (captureContactEndpoints)(client, person.recipientId, ["email"], "products"))).length, 1); });
        await t.test("preference capability has no account identity, requires its own CSRF and rejects stale writes", async () => {
            const person = await contact((randomUUID)()), raw = await preferenceToken(person), url = "https://example.invalid/api/v1/communication-preferences/" + raw;
            const response = await (contactPreferencesResponse)(new Request(url), raw), view = await response.json();
            strict.match(response.headers.get("cache-control") || "", /no-store/);
            strict.match(response.headers.get("x-robots-tag") || "", /noindex/);
            for (const value of [person.id, person.recipientId, person.endpointId, person.email])
                strict.equal(JSON.stringify(view).includes(value), false);
            strict.equal((await (query)("SELECT token_hash FROM communication_preference_tokens WHERE endpoint_id=$1", [person.endpointId])).rows.some(row => row.token_hash === (hash)(raw)), true);
            const prefs = structuredClone(view.preferences);
            prefs.topics.research.enabled = false;
            const body = JSON.stringify({ expectedVersion: view.version, preferences: prefs });
            await strict.rejects((contactPreferencesResponse)(new Request(url, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://example.invalid" }, body }), raw), status(403));
            await strict.rejects((contactPreferencesResponse)(new Request(url, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://evil.invalid", "X-Communication-CSRF": view.csrfToken }, body }), raw), status(403));
            const changed = await (contactPreferencesResponse)(new Request(url, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://example.invalid", "X-Communication-CSRF": view.csrfToken }, body }), raw);
            strict.equal((await changed.json()).version, view.version + 1);
            await strict.rejects((patchContactPreferenceView)(raw, JSON.parse(body)), status(409));
        });
        await t.test("a changed endpoint invalidates saved links and frozen enrollment without switching to another address", async () => { const person = await prepared(), raw = await preferenceToken(person), queued = (await jobs(person.run.id))[0], before = messages.length; await (query)("UPDATE crm_contact_endpoints SET normalized_value=$2,value=$2,version=version+1,verified_at=NULL WHERE id=$1", [person.endpointId, "changed-" + (randomUUID)() + "@example.invalid"]); await strict.rejects((getContactPreferenceView)(raw), status(404)); await deliver(queued.id); strict.equal(messages.length, before); strict.equal((await outbox(queued.id)).state, "cancelled"); });
        await t.test("shared endpoint, locale and campaign revision dedupe does not combine contact identities", async () => { const tag = (randomUUID)(), shared = tag + "@example.invalid", a = await contact(tag, { email: shared }), b = await contact(tag, { email: shared }), group = await segment(tag), run = await campaign(group.id); await Promise.all([(runCrmCampaigns)(), (runCrmCampaigns)()]); const rows = await jobs(run.id); strict.equal(rows.length, 1); strict.ok([a.recipientId, b.recipientId].includes(rows[0].recipient_id)); strict.equal((await (query)("SELECT id FROM crm_campaign_enrollments WHERE revision_id=$1", [run.revisionId])).rowCount, 2); await deliver(rows[0].id); strict.equal(String(messages.at(-1).to), shared); const detail = await (getCrmCampaign)(seller, run.id); strict.equal(detail.recent.length, 2); strict.equal(detail.deliveries[0].subjectType, "crm-contact"); });
        await t.test("typed suppression and later revocation do not restore withdrawn endpoint consent", async () => { const person = await prepared(), job = (await jobs(person.run.id))[0], suppression = await (createCrmSuppression)(seller, { recipientId: person.recipientId, scope: "sender", topic: "products", channel: "email", reason: "Recipient explicitly paused this sender" }); await deliver(job.id); strict.equal((await outbox(job.id)).state, "cancelled"); await (revokeCrmSuppression)(seller, suppression.id, { reason: "Explicitly removed sender suppression" }, suppression.version); strict.equal((await outbox(job.id)).state, "cancelled"); await strict.rejects((createCrmSuppression)(other, { recipientId: person.recipientId, scope: "sender", topic: "products", channel: "email", reason: "Outside assigned recipient scope" }), status(404)); });
        await t.test("daily contact digests preserve actual step acceptance and current proof", async () => { const person = await prepared(2), raw = await preferenceToken(person), view = await (getContactPreferenceView)(raw), prefs = structuredClone(view.preferences); prefs.timezone = "UTC"; prefs.topics.products.frequency = "daily"; await (patchContactPreferenceView)(raw, { expectedVersion: view.version, preferences: prefs }); const first = (await jobs(person.run.id))[0]; await (query)("UPDATE outbox SET created_at=now()-interval '2 days' WHERE id=$1", [first.id]); await deliver(first.id); strict.equal((await outbox(first.id)).state, "batched"); await (flushNotificationDigests)(); const digest = (await (query)("SELECT digest_outbox_id FROM notification_digest_items WHERE outbox_id=$1", [first.id])).rows[0].digest_outbox_id; const before = messages.length; await deliver(digest); strict.equal(messages.length, before + 1); strict.equal((await outbox(first.id)).state, "delivered"); strict.match(String(messages.at(-1).text), /Step 0 fa/); strict.match(String(messages.at(-1).headers["List-Unsubscribe"]), /communication-unsubscribe/); await (runCrmCampaigns)(100, new Date(Date.now() + 7e4)); strict.equal((await (getCrmCampaign)(seller, person.run.id)).recent[0].stepIndex, 1); });
        await t.test("GET unsubscribe does not mutate; explicit one-click POST disables only this verified destination", async () => { const person = await prepared(), first = (await jobs(person.run.id))[0]; await deliver(first.id); const message = messages.at(-1), header = String(message.headers["List-Unsubscribe"]), url = header.slice(1, -1), raw = url.split("/").at(-1); const view = await (getContactPreferenceView)(raw), confirmation = await (contactUnsubscribeResponse)(new Request(url), raw); strict.match(await confirmation.text(), /lang="fa" dir="rtl"/); strict.equal(confirmation.headers.get("set-cookie"), null); await strict.rejects((contactUnsubscribeResponse)(new Request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "0" }, body: "List-Unsubscribe=One-Click&padding=" + "x".repeat(1100) }), raw), status(413)); strict.equal((await (getContactPreferenceView)(raw)).preferences.topics.products.enabled, true); const request = () => new Request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }); await (contactUnsubscribeResponse)(request(), raw); await (contactUnsubscribeResponse)(request(), raw); strict.ok(Object.values((await (getContactPreferenceView)(raw)).preferences.topics).every(value => !value.enabled)); await strict.rejects((patchContactPreferenceView)(raw, { expectedVersion: view.version, preferences: view.preferences }), status(404)); const endpoint = (await (query)("SELECT verified_at FROM crm_contact_endpoints WHERE id=$1", [person.endpointId])).rows[0]; strict.ok(endpoint.verified_at); });
        await t.test("consent revoked inside a digest suppresses it before the mock SMTP call", async () => { const person = await prepared(), raw = await preferenceToken(person), view = await (getContactPreferenceView)(raw), prefs = structuredClone(view.preferences); prefs.topics.products.frequency = "daily"; await (patchContactPreferenceView)(raw, { expectedVersion: view.version, preferences: prefs }); const first = (await jobs(person.run.id))[0]; await (query)("UPDATE outbox SET created_at=now()-interval '2 days' WHERE id=$1", [first.id]); await deliver(first.id); await (flushNotificationDigests)(); const digest = (await (query)("SELECT digest_outbox_id FROM notification_digest_items WHERE outbox_id=$1", [first.id])).rows[0].digest_outbox_id; const latest = await (getContactPreferenceView)(raw); latest.preferences.topics.products.enabled = false; await (patchContactPreferenceView)(raw, { expectedVersion: latest.version, preferences: latest.preferences }); const before = messages.length; await deliver(digest); strict.equal(messages.length, before); strict.equal((await outbox(first.id)).state, "cancelled"); strict.equal((await outbox(digest)).last_error, "DIGEST_EMPTY"); });
        await t.test("ambiguous contact delivery is retained and never retried by the next journey step", async () => { const person = await prepared(2), first = (await jobs(person.run.id))[0]; let calls = 0; await deliver(first.id, async () => { calls++; throw new Error("Mock acknowledgement was lost after potential acceptance"); }); strict.equal((await outbox(first.id)).state, "uncertain"); await (runCrmCampaigns)(100, new Date(Date.now() + 7e4)); await (runCrmCampaigns)(100, new Date(Date.now() + 864e5)); strict.equal(calls, 1); strict.equal((await jobs(person.run.id)).length, 1); strict.equal((await (getCrmCampaign)(seller, person.run.id)).counts.uncertain, 1); });
    }
    finally {
        await (closeDb)();
        for (const key of keys) {
            if (old[key] === void 0)
                delete process.env[key];
            else
                process.env[key] = old[key];
        }
        await control.query("DROP SCHEMA " + schema + " CASCADE");
        await control.end();
    }
});
