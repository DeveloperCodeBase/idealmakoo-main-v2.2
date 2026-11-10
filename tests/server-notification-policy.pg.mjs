/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { HttpError } from "../src/server/types";
import node_test from "node:test";
import strict from "node:assert/strict";
import { isQuietTime, quietHoursEnd, nextDigestAt, defaultNotificationPreferences, notificationPreferencesSchema, getNotificationPreferences, patchNotificationPreferences, applyLegacyNotificationPreferences, enqueueAccountNotification, prepareNotificationDelivery, flushNotificationDigests, unsubscribeResponse, marketingUnsubscribe } from "../src/server/notification-policy";
import { generateKeyPairSync, randomUUID, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { notificationDkim } from "../src/server/notification-email";
import pg from "pg";
import { closeDb, query, transaction } from "../src/server/db";
import { enqueueNotification, deliverOutbox, recoverStaleOutbox, claimOutbox } from "../src/server/notifications";
import { getWorkspace, saveWorkspace, publishWorkspace, reviewWorkspaceContent, getPublicSite, unpublishWorkspace } from "../src/server/workspace";
import { recordText } from "../src/data/workspace-seed";
import { readdir, readFile } from "node:fs/promises";
import { decrypt, hash } from "../src/server/crypto";
import { enqueuePublicationNotificationEvent, runPublicationNotificationFanout } from "../src/server/notification-publications";
const define_import_meta_default = import.meta;
const actor = (id, role = "customer") => ({ id, role, name: id, email: id + "@example.invalid", qualityScope: false, allowedLocales: ["fa", "en", "tr", "ar", "ru"], mfaVerified: true });
const admin = actor("notification-admin", "admin"), alice = actor("notification-alice"), bob = actor("notification-bob"), editor = actor("notification-editor", "contentEditor"), english = actor("notification-english");
const isStatus = status => error => error instanceof HttpError && error.status === status;
(node_test)("notification calendars enforce cross-midnight quiet hours and real DST boundaries", () => { const policy = { enabled: true, frequency: "instant", quietStart: "22:00", quietEnd: "08:00" }; strict.equal((isQuietTime)(new Date("2026-01-01T18:29:00Z"), policy, "Asia/Tehran"), false); strict.equal((isQuietTime)(new Date("2026-01-01T18:30:00Z"), policy, "Asia/Tehran"), true); strict.equal((quietHoursEnd)(new Date("2026-01-01T22:00:00Z"), policy, "Asia/Tehran").toISOString(), "2026-01-02T04:30:00.000Z"); const spring = { ...policy, quietStart: "01:00", quietEnd: "03:00" }; strict.equal((quietHoursEnd)(new Date("2026-03-08T06:30:00Z"), spring, "America/New_York").toISOString(), "2026-03-08T07:00:00.000Z"); const autumn = { ...policy, quietStart: "00:00", quietEnd: "02:00" }; strict.equal((quietHoursEnd)(new Date("2026-11-01T04:30:00Z"), autumn, "America/New_York").toISOString(), "2026-11-01T07:00:00.000Z"); strict.equal((nextDigestAt)(new Date("2026-03-07T15:00:00Z"), "daily", "America/New_York").toISOString(), "2026-03-08T13:00:00.000Z"); strict.equal((nextDigestAt)(new Date("2026-10-19T04:00:00Z"), "weekly", "Asia/Tehran").toISOString(), "2026-10-26T05:30:00.000Z"); const invalid = (defaultNotificationPreferences)(); invalid.topics.products.email.quietStart = "25:30"; strict.equal(notificationPreferencesSchema.safeParse(invalid).success, false); invalid.topics.products.email.quietStart = "08:00"; invalid.topics.products.email.quietEnd = "08:00"; strict.equal(notificationPreferencesSchema.safeParse(invalid).success, false); });
(node_test)("DKIM signs both RFC 8058 headers in a real in-memory MIME message", async () => {
    const fields = ["SMTP_DKIM_MODE", "SMTP_DKIM_DOMAIN", "SMTP_DKIM_SELECTOR", "SMTP_DKIM_PRIVATE_KEY_B64", "SMTP_FROM"];
    const previous = Object.fromEntries(fields.map(name => [name, process.env[name]]));
    const keys = (generateKeyPairSync)("rsa", { modulusLength: 2048 });
    try {
        process.env.SMTP_DKIM_MODE = "application";
        process.env.SMTP_DKIM_DOMAIN = "example.invalid";
        process.env.SMTP_DKIM_SELECTOR = "notifications";
        process.env.SMTP_DKIM_PRIVATE_KEY_B64 = Buffer.from(keys.privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64");
        process.env.SMTP_FROM = "Ideal Makoo <sender@example.invalid>";
        const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
        const result = await transporter.sendMail({ from: process.env.SMTP_FROM, to: "recipient@example.invalid", subject: "Local DKIM verification", text: "No network delivery occurs in this test.", headers: { "List-Unsubscribe": "<https://example.invalid/api/v1/notifications/unsubscribe/test/>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, dkim: (notificationDkim)() });
        strict.ok(Buffer.isBuffer(result.message));
        const message = result.message.toString(), headers = message.split("\r\n\r\n")[0].replace(/\r\n[\t ]+/g, " "), signature = headers.split("\r\n").find(line => line.startsWith("DKIM-Signature:"));
        strict.ok(signature);
        strict.match(signature, /\bd=example\.invalid;/);
        strict.match(signature, /\bs=notifications;/);
        strict.match(signature, /\ba=rsa-sha256;/);
        strict.match(signature, /\bh=[^;]*list-unsubscribe-post/);
        strict.match(signature, /\bh=[^;]*list-unsubscribe(?:[:;])/);
        strict.match(signature, /\bb=[A-Za-z0-9+/= ]+/);
    }
    finally {
        for (const name of fields) {
            if (previous[name] === void 0)
                delete process.env[name];
            else
                process.env[name] = previous[name];
        }
    }
});
const database = process.env.TEST_ADMIN_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;
(node_test)("PostgreSQL notification consent, queued digests, unsubscribe and uncertain delivery", { skip: !database, timeout: 12e4 }, async (t) => {
    const schema = "notification_test_" + (randomUUID)().replaceAll("-", ""), control = new pg.Client({ connectionString: database });
    await control.connect();
    await control.query("CREATE SCHEMA " + schema);
    const keys = ["DATABASE_URL", "SITE_URL", "SESSION_SECRET", "MFA_ENCRYPTION_KEY", "NOTIFICATIONS_MODE", "SMTP_HOST", "SMTP_FROM", "SMTP_DKIM_MODE", "DEMO_MODE"], old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
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
    delete process.env.DEMO_MODE;
    await (closeDb)();
    const messages = [];
    const fakeMail = async (message) => { messages.push(message); return { accepted: [message.to], messageId: String(message.messageId) }; };
    async function claim(id) { const token = (randomUUID)(); const row = (await (query)("UPDATE outbox SET state='running',lock_token=$2,locked_at=now(),attempts=attempts+1 WHERE id=$1 AND state='pending' RETURNING id,kind,payload,attempts,lock_token", [id, token])).rows[0]; strict.ok(row, "Expected a pending isolated test job"); return row; }
    async function state(id) { return (await (query)("SELECT state,last_error,attempts,available_at FROM outbox WHERE id=$1", [id])).rows[0]; }
    async function settings(change, as = alice) { const current = await (getNotificationPreferences)(as), value = structuredClone(current.preferences); change(value); return (patchNotificationPreferences)(as, { expectedVersion: current.version, preferences: value }); }
    async function enqueue(title, topic = "products", channel = "email", as = alice) { return (enqueueNotification)(admin, { userId: as.id, channel, topic, purpose: topic === "requests" ? "transactional" : "marketing", title, body: "Body for " + title, href: "/fa/account/notifications/" }); }
    async function past(id) { await (query)("UPDATE outbox SET created_at=now()-interval '8 days' WHERE id=$1", [id]); }
    async function publishEvent(id) { const workspace = await (getWorkspace)(editor), record = { id, collection: "events", title: (recordText)("Reviewed event " + id), summary: (recordText)("This event announcement has passed an independent review."), status: "review", owner: editor.role, tags: [], demo: false, history: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), eventStart: "2027-01-02T09:00:00.000Z", eventEnd: "2027-01-02T10:00:00.000Z", location: "Online" }; await (saveWorkspace)(editor, { state: { ...workspace.state, records: [...workspace.state.records, record] }, expectedVersion: workspace.version }); let current = await (getWorkspace)(admin); await strict.rejects((publishWorkspace)(admin, { publication: { id, kind: "events", locale: "fa" }, expectedVersion: current.version }), isStatus(409)); strict.equal((await (query)("SELECT id FROM notification_publication_events WHERE document_id=$1", [id])).rowCount, 0); current = await (reviewWorkspaceContent)(admin, { bucket: "records", id, locale: "fa", expectedVersion: current.version }); await (publishWorkspace)(admin, { publication: { id, kind: "events", locale: "fa" }, expectedVersion: current.version }); const publication = (await (getPublicSite)()).publications.find(item => item.id === id && item.locale === "fa"); strict.ok(publication); const event = (await (query)("SELECT id,revision_id,state,queued_count FROM notification_publication_events WHERE document_id=$1", [id])).rows[0]; strict.ok(event); return { publication, event }; }
    try {
        const client = new pg.Client({ connectionString: scoped.toString() });
        await client.connect();
        for (const file of (await (readdir)(new URL("../db/migrations/", define_import_meta_default.url))).filter(name => name.endsWith(".sql")).sort())
            await client.query(await (readFile)(new URL("../db/migrations/" + file, define_import_meta_default.url), "utf8"));
        await client.end();
        for (const user of [admin, alice, bob, editor, english]) {
            await (query)("INSERT INTO users(id,email,name,password_hash,role,mfa_enabled,email_verified) VALUES($1,$2,$3,$4,$5,true,$6)", [user.id, user.email, user.name, "not a login credential", user.role, user.id !== bob.id]);
            await (query)("INSERT INTO user_settings(user_id) VALUES($1)", [user.id]);
        }
        await (query)("UPDATE user_settings SET preferences=$2::jsonb WHERE user_id=$1", [english.id, JSON.stringify({ language: "en" })]);
        await t.test("strict per-account preferences persist and concurrent versions do not overwrite", async () => { const first = await (getNotificationPreferences)(alice); strict.equal(first.preferences.topics.requests.inApp.enabled, true); strict.equal(first.preferences.topics.products.email.enabled, false); strict.equal(first.channels.email.verified, true); strict.equal((await (getNotificationPreferences)(bob)).channels.email.verified, false); const one = structuredClone(first.preferences), two = structuredClone(first.preferences); one.topics.products.email.enabled = true; two.topics.events.inApp.enabled = true; const attempts = await Promise.allSettled([(patchNotificationPreferences)(alice, { expectedVersion: first.version, preferences: one }), (patchNotificationPreferences)(alice, { expectedVersion: first.version, preferences: two })]); strict.equal(attempts.filter(item => item.status === "fulfilled").length, 1); strict.equal(attempts.filter(item => item.status === "rejected" && isStatus(409)(item.reason)).length, 1); await strict.rejects((patchNotificationPreferences)(alice, { expectedVersion: 1, preferences: first.preferences, userId: bob.id }), isStatus(422)); const invalid = structuredClone(first.preferences); invalid.timezone = "Not/A-Timezone"; await strict.rejects((patchNotificationPreferences)(alice, { expectedVersion: 2, preferences: invalid }), isStatus(422)); strict.equal((await (getNotificationPreferences)(bob)).preferences.topics.products.email.enabled, false); });
        await t.test("legacy consent writes update the same authoritative policy atomically", async () => { await (transaction)(async (client2) => { const legacy = { email: true, inApp: true, research: false }; await (applyLegacyNotificationPreferences)(client2, alice, legacy); await client2.query("UPDATE user_settings SET portal=jsonb_set(portal,$2,$3::jsonb) WHERE user_id=$1", [alice.id, ["notificationPreferences"], JSON.stringify(legacy)]); }); const current = await (getNotificationPreferences)(alice); strict.equal(current.preferences.topics.products.email.enabled, true); strict.equal(current.preferences.topics.products.inApp.enabled, true); strict.equal(current.preferences.topics.research.email.enabled, false); await strict.rejects((transaction)(async (client2) => { await (applyLegacyNotificationPreferences)(client2, alice, { quietStart: "22:99", quietEnd: "08:00" }); }), isStatus(422)); strict.equal((await (getNotificationPreferences)(alice)).version, current.version); strict.ok(Number((await (query)("SELECT count(*) FROM consent_events WHERE user_id=$1", [alice.id])).rows[0].count) > 0); });
        await t.test("destinations derive from a verified account and transactional enqueue rolls back with its caller", async () => { await strict.rejects((enqueueNotification)(alice, { userId: alice.id, channel: "email", purpose: "marketing", body: "Denied" }), isStatus(403)); await strict.rejects((enqueueNotification)(admin, { userId: alice.id, channel: "email", purpose: "marketing", to: bob.email, body: "Denied" }), isStatus(422)); await strict.rejects((enqueueNotification)(admin, { userId: bob.id, channel: "email", purpose: "marketing", body: "Denied" }), isStatus(409)); await strict.rejects((enqueueNotification)(admin, { userId: alice.id, channel: "sms", purpose: "marketing", body: "Denied" }), isStatus(409)); await strict.rejects((enqueueNotification)(admin, { userId: alice.id, channel: "email", purpose: "transactional", topic: "products", body: "Bypass attempt" }), isStatus(422)); const notice = await enqueue("Bound endpoint"); const encrypted = (await (query)("SELECT payload FROM outbox WHERE id=$1", [notice.id])).rows[0].payload; strict.equal(JSON.parse((decrypt)(encrypted.encrypted)).to, alice.email); strict.equal(JSON.stringify(encrypted).includes(alice.email), false); const before = Number((await (query)("SELECT count(*) FROM outbox")).rows[0].count); await strict.rejects((transaction)(async (client2) => { await (enqueueAccountNotification)(client2, { userId: alice.id, topic: "requests", channel: "in-app", purpose: "transactional", title: "Transactional", body: "Must roll back" }, "atomic-receipt"); throw new Error("rollback requested by test"); })); strict.equal(Number((await (query)("SELECT count(*) FROM outbox")).rows[0].count), before); const sent = await claim(notice.id); await (deliverOutbox)(sent, { sendMail: fakeMail }); strict.equal((await state(notice.id)).state, "delivered"); });
        await t.test("instant inbox delivery, consent revocation and stale lease tokens are enforced at dispatch", async () => { const notice = await enqueue("Internal notice", "products", "in-app"), job = await claim(notice.id); await (deliverOutbox)(job, { sendMail: fakeMail }); await (deliverOutbox)(job, { sendMail: fakeMail }); strict.equal((await (query)("SELECT id FROM notifications WHERE dedupe_key=$1", ["outbox:" + notice.id])).rowCount, 1); const revoked = await enqueue("Revoke before send", "products", "in-app"); await settings(value => { value.topics.products.inApp.enabled = false; }); await (deliverOutbox)(await claim(revoked.id), { sendMail: fakeMail }); strict.equal((await state(revoked.id)).state, "cancelled"); strict.equal((await state(revoked.id)).last_error, "CONSENT_REVOKED"); strict.equal((await (query)("SELECT id FROM notifications WHERE dedupe_key=$1", ["outbox:" + revoked.id])).rowCount, 0); await settings(value => { value.topics.products.inApp.enabled = true; }); const stale = await enqueue("Wrong lease", "products", "in-app"), wrong = await claim(stale.id); await (query)("UPDATE outbox SET lock_token=$2 WHERE id=$1", [stale.id, (randomUUID)()]); await (deliverOutbox)(wrong, { sendMail: fakeMail }); strict.equal((await state(stale.id)).state, "running"); strict.equal((await (query)("SELECT id FROM notifications WHERE dedupe_key=$1", ["outbox:" + stale.id])).rowCount, 0); await (query)("UPDATE outbox SET state='cancelled' WHERE id=$1", [stale.id]); });
        await t.test("quiet hours defer a real queued receipt without consuming delivery attempts", async () => { await settings(value => { value.timezone = "UTC"; value.topics.requests.inApp = { enabled: true, frequency: "instant", quietStart: "22:00", quietEnd: "08:00" }; }); const id = await (transaction)(client2 => (enqueueAccountNotification)(client2, { userId: alice.id, topic: "requests", purpose: "transactional", channel: "in-app", title: "Receipt during quiet hours", body: "Delayed receipt" }, "quiet-receipt")); strict.ok(id); const decision = await (prepareNotificationDelivery)(await claim(id), new Date("2026-01-01T23:30:00Z")); strict.equal(decision.action, "handled"); const stored = await state(id); strict.equal(stored.state, "pending"); strict.equal(stored.attempts, 0); strict.equal(stored.available_at.toISOString(), "2026-01-02T08:00:00.000Z"); strict.equal((await (query)("SELECT id FROM notifications WHERE dedupe_key=$1", ["outbox:" + id])).rowCount, 0); await settings(value => { value.topics.requests.inApp.quietStart = null; value.topics.requests.inApp.quietEnd = null; }); await (deliverOutbox)(await claim(id), { sendMail: fakeMail }); strict.equal((await state(id)).state, "delivered"); });
        await t.test("durable daily digests aggregate once, recheck topics, and propagate accepted results", async () => {
            await settings(value => {
                for (const topic of ["products", "research"])
                    value.topics[topic].email = { enabled: true, frequency: "daily", quietStart: null, quietEnd: null };
            });
            const product = await enqueue("Product digest item"), research = await enqueue("Research item revoked", "research");
            for (const notice of [product, research]) {
                await past(notice.id);
                await (deliverOutbox)(await claim(notice.id), { sendMail: fakeMail });
                strict.equal((await state(notice.id)).state, "batched");
            }
            const before = messages.length;
            const assembler = new pg.Client({connectionString:scoped.toString()});
            await assembler.connect();
            try {
                await assembler.query('BEGIN');
                await assembler.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':notification-digest-assembly',0))");
                strict.deepEqual(await flushNotificationDigests(),{items:0,batches:0},'A competing assembler yields without splitting an existing recipient group');
                strict.equal((await query("SELECT count(*)::integer AS n FROM notification_digest_items WHERE outbox_id=ANY($1::text[]) AND state='pending'",[[product.id,research.id]])).rows[0].n,2);
            } finally {
                await assembler.query('ROLLBACK');
                await assembler.end();
            }
            await (closeDb)();
            const grouped = await Promise.all(Array.from({length:12},()=>flushNotificationDigests()));
            strict.equal(grouped.reduce((sum, result) => sum + result.items, 0), 2);
            strict.equal(grouped.reduce((sum, result) => sum + result.batches, 0), 1);
            const digest = (await (query)("SELECT digest_outbox_id FROM notification_digest_items WHERE outbox_id=$1", [product.id])).rows[0].digest_outbox_id;
            strict.ok(digest);
            await settings(value => { value.topics.research.email.enabled = false; });
            const job = await claim(digest);
            await (deliverOutbox)(job, { sendMail: fakeMail });
            await (deliverOutbox)(job, { sendMail: fakeMail });
            strict.equal(messages.length, before + 1);
            strict.match(String(messages.at(-1).text), /Product digest item/);
            strict.doesNotMatch(String(messages.at(-1).text), /Research item revoked/);
            strict.equal((await state(product.id)).state, "delivered");
            strict.equal((await state(research.id)).state, "cancelled");
            strict.equal((await state(digest)).state, "delivered");
            strict.equal((await (query)("SELECT id FROM delivery_events WHERE outbox_id=$1 AND status=$2", [product.id, "accepted"])).rowCount, 1);
        });
        await t.test("a changed digest schedule moves unsent members back to the durable buffer", async () => { const source = await enqueue("Weekly reschedule"); await (deliverOutbox)(await claim(source.id), { sendMail: fakeMail }); strict.equal((await state(source.id)).state, "batched"); await (query)("UPDATE notification_digest_items SET due_at=now()-interval '1 second' WHERE outbox_id=$1", [source.id]); await (flushNotificationDigests)(); const batch = (await (query)("SELECT digest_outbox_id FROM notification_digest_items WHERE outbox_id=$1", [source.id])).rows[0].digest_outbox_id; await settings(value => { value.topics.products.email.frequency = "weekly"; }); const before = messages.length; await (deliverOutbox)(await claim(batch), { sendMail: fakeMail }); strict.equal(messages.length, before); const member = (await (query)("SELECT state,due_at,digest_outbox_id FROM notification_digest_items WHERE outbox_id=$1", [source.id])).rows[0]; strict.equal(member.state, "pending"); strict.equal(member.digest_outbox_id, null); strict.ok(member.due_at > new Date); strict.equal((await state(source.id)).state, "batched"); await (query)("UPDATE notification_digest_items SET state='cancelled' WHERE outbox_id=$1", [source.id]); await (query)("UPDATE outbox SET state='cancelled' WHERE id=$1", [source.id]); });
        await t.test("RFC 8058 uses an opaque HTTPS endpoint and safe GET then token-only POST", async () => {
            await settings(value => {
                for (const topic of ["products", "research", "events"])
                    value.topics[topic].email = { enabled: true, frequency: "instant", quietStart: null, quietEnd: null };
                value.topics.requests.email.enabled = true;
            });
            const notice = await enqueue("One-click email");
            await (deliverOutbox)(await claim(notice.id), { sendMail: fakeMail });
            const mail = messages.at(-1), headers = mail.headers;
            strict.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
            const url = headers["List-Unsubscribe"].slice(1, -1);
            strict.match(url, /^https:\/\/example\.invalid\/api\/v1\/notifications\/unsubscribe\/[A-Za-z0-9_-]{43}\/$/);
            const raw = url.split("/").at(-2);
            const token = (await (query)("SELECT token_hash,consumed_at FROM notification_unsubscribe_tokens WHERE outbox_id=$1", [notice.id])).rows[0];
            strict.equal(token.token_hash, (hash)(raw));
            strict.equal(token.consumed_at, null);
            strict.equal((await (unsubscribeResponse)(new Request(url), raw)).status, 200);
            strict.equal((await (getNotificationPreferences)(alice)).preferences.topics.products.email.enabled, true);
            strict.equal((await (query)("SELECT consumed_at FROM notification_unsubscribe_tokens WHERE token_hash=$1", [(hash)(raw)])).rows[0].consumed_at, null);
            const post = () => new Request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
            strict.equal((await (unsubscribeResponse)(post(), raw)).status, 200);
            const after = await (getNotificationPreferences)(alice);
            for (const topic of ["products", "research", "events"])
                strict.equal(after.preferences.topics[topic].email.enabled, false);
            strict.equal(after.preferences.topics.requests.email.enabled, true);
            strict.equal(after.preferences.topics.products.inApp.enabled, true);
            await settings(value => { value.topics.products.email.enabled = true; });
            strict.equal((await (unsubscribeResponse)(post(), raw)).status, 200);
            strict.equal((await (getNotificationPreferences)(alice)).preferences.topics.products.email.enabled, true, "Replaying an already consumed old token must not undo a later explicit resubscription");
            strict.equal((await (unsubscribeResponse)(new Request(url), raw.slice(0, -1) + "!")).status, 404);
        });
        await t.test("unsubscribe validates multipart, does not follow account-email changes, and never requires a cookie", async () => { const notice = await enqueue("Multipart unsubscribe"); const link = await (marketingUnsubscribe)(notice.id, alice.id), raw = link.url.split("/").at(-2); const invalid = new FormData; invalid.set("List-Unsubscribe", "One-Click"); invalid.set("userId", bob.id); await strict.rejects((unsubscribeResponse)(new Request(link.url, { method: "POST", body: invalid }), raw), isStatus(422)); await (query)("UPDATE users SET email=$2 WHERE id=$1", [alice.id, "new-address@example.invalid"]); const valid = new FormData; valid.set("List-Unsubscribe", "One-Click"); strict.equal((await (unsubscribeResponse)(new Request(link.url, { method: "POST", body: valid }), raw)).status, 200); strict.equal((await (getNotificationPreferences)(alice)).preferences.topics.products.email.enabled, true); await (query)("UPDATE users SET email=$2 WHERE id=$1", [alice.id, alice.email]); await (query)("UPDATE outbox SET state='cancelled' WHERE id=$1", [notice.id]); const expired = await (marketingUnsubscribe)(notice.id, alice.id), token = expired.url.split("/").at(-2); await (query)("UPDATE notification_unsubscribe_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [(hash)(token)]); strict.equal((await (unsubscribeResponse)(new Request(expired.url), token)).status, 404); });
        await t.test("marketing cannot leave SMTP without DKIM configuration and changed endpoints suppress delivery", async () => { const notice = await enqueue("Missing DKIM"), before = messages.length; process.env.SMTP_DKIM_MODE = "off"; await (deliverOutbox)(await claim(notice.id), { sendMail: fakeMail }); strict.equal((await state(notice.id)).state, "pending"); strict.equal((await state(notice.id)).last_error, "DKIM_NOT_CONFIGURED"); strict.equal(messages.length, before); process.env.SMTP_DKIM_MODE = "gateway"; await (query)("UPDATE users SET email=$2 WHERE id=$1", [alice.id, "changed@example.invalid"]); await (deliverOutbox)(await claim(notice.id), { sendMail: fakeMail }); strict.equal((await state(notice.id)).state, "cancelled"); strict.equal((await state(notice.id)).last_error, "RECIPIENT_MISMATCH"); await (query)("UPDATE users SET email=$2 WHERE id=$1", [alice.id, alice.email]); });
        await t.test("ambiguous SMTP results and stale digest leases remain uncertain and are not resent", async () => { const notice = await enqueue("Uncertain SMTP"); let calls = 0; const job = await claim(notice.id); const fail = async () => { calls++; throw new Error("Network acknowledgement lost after possible acceptance"); }; await (deliverOutbox)(job, { sendMail: fail }); await (deliverOutbox)(job, { sendMail: fail }); strict.equal(calls, 1); strict.equal((await state(notice.id)).state, "uncertain"); await settings(value => { value.topics.products.email.frequency = "daily"; }); const source = await enqueue("Stale digest"); await past(source.id); await (deliverOutbox)(await claim(source.id), { sendMail: fakeMail }); await (flushNotificationDigests)(); const batch = (await (query)("SELECT digest_outbox_id FROM notification_digest_items WHERE outbox_id=$1", [source.id])).rows[0].digest_outbox_id; await claim(batch); await (query)("UPDATE outbox SET locked_at=now()-interval '11 minutes' WHERE id=$1", [batch]); await (recoverStaleOutbox)(); strict.equal((await state(batch)).state, "uncertain"); strict.equal((await state(source.id)).state, "uncertain"); strict.equal((await (query)("SELECT state FROM notification_digest_items WHERE outbox_id=$1", [source.id])).rows[0].state, "uncertain"); });
        await t.test("only an actual reviewed release fans out to opted-in matching locales with verified email", async () => {
            for (const user of [alice, bob, english])
                await settings(value => { value.topics.events.email = { enabled: true, frequency: "instant", quietStart: null, quietEnd: null }; value.topics.events.inApp = { enabled: true, frequency: "instant", quietStart: null, quietEnd: null }; }, user);
            const { event, publication } = await publishEvent("notification-reviewed-event");
            strict.equal(event.state, "pending");
            strict.equal(event.queued_count, 0);
            strict.equal(await (transaction)(client2 => (enqueuePublicationNotificationEvent)(client2, publication, event.revision_id)), null, "Replaying an identical published revision must not create another fanout");
            for (let iteration = 0; iteration < 5; iteration++)
                await Promise.all([(runPublicationNotificationFanout)(1), (runPublicationNotificationFanout)(1)]);
            const stored = (await (query)("SELECT state,queued_count FROM notification_publication_events WHERE id=$1", [event.id])).rows[0];
            strict.equal(stored.state, "completed");
            strict.equal(stored.queued_count, 3);
            const jobs = (await (query)("SELECT id,kind,payload FROM outbox WHERE dedupe_key LIKE $1 ORDER BY dedupe_key", [event.id + ":%"])).rows;
            strict.equal(jobs.length, 3);
            const decoded = jobs.map(job => ({ id: job.id, channel: job.kind, ...JSON.parse((decrypt)(job.payload.encrypted)) }));
            strict.deepEqual(decoded.map(item => item.userId + ":" + item.channel).sort(), [alice.id + ":email", alice.id + ":in-app", bob.id + ":in-app"]);
            for (const payload of decoded) {
                strict.equal(payload.title, publication.title);
                strict.equal(payload.body, publication.summary);
                strict.equal(payload.href, "/fa/events/notification-reviewed-event/");
                strict.equal(payload.to, payload.channel === "email" ? alice.email : payload.userId);
            }
            const before = messages.length;
            for (const job of jobs)
                await (deliverOutbox)(await claim(job.id), { sendMail: fakeMail });
            strict.equal(messages.length, before + 1);
            strict.equal((await (query)("SELECT id FROM notifications WHERE dedupe_key=ANY($1::text[])", [jobs.map(job => "outbox:" + job.id)])).rowCount, 2);
        });
        await t.test("withdrawn public releases suppress queued announcements and cancel unexpanded events", async () => {
            const queued = await publishEvent("notification-withdrawn-queued");
            await (runPublicationNotificationFanout)();
            const jobs = (await (query)("SELECT id FROM outbox WHERE dedupe_key LIKE $1", [queued.event.id + ":%"])).rows;
            strict.equal(jobs.length, 3);
            const workspace = await (getWorkspace)(admin);
            await (unpublishWorkspace)(admin, { slug: queued.publication.slug, kind: "events", locale: "fa", expectedVersion: workspace.version });
            const before = messages.length;
            for (const job of jobs) {
                await (deliverOutbox)(await claim(job.id), { sendMail: fakeMail });
                strict.equal((await state(job.id)).state, "cancelled");
                strict.equal((await state(job.id)).last_error, "RECIPIENT_SCOPE_REVOKED");
            }
            strict.equal(messages.length, before);
            strict.equal((await (query)("SELECT id FROM notifications WHERE dedupe_key=ANY($1::text[])", [jobs.map(job => "outbox:" + job.id)])).rowCount, 0);
            const pending = await publishEvent("notification-withdrawn-pending"), current = await (getWorkspace)(admin);
            await (unpublishWorkspace)(admin, { slug: pending.publication.slug, kind: "events", locale: "fa", expectedVersion: current.version });
            const result = await (runPublicationNotificationFanout)();
            strict.equal(result.queued, 0);
            strict.equal((await (query)("SELECT state FROM notification_publication_events WHERE id=$1", [pending.event.id])).rows[0].state, "cancelled");
            strict.equal((await (query)("SELECT id FROM outbox WHERE dedupe_key LIKE $1", [pending.event.id + ":%"])).rowCount, 0);
        });
        await t.test("independent claimers lease each pending job at most once", async () => {
            await (query)("UPDATE outbox SET available_at=now()+interval '1 year' WHERE state='pending'");
            await settings(value => { value.topics.products.inApp = { enabled: true, frequency: "instant", quietStart: null, quietEnd: null }; });
            const one = await enqueue("Concurrent one", "products", "in-app"), two = await enqueue("Concurrent two", "products", "in-app");
            const claimed = await Promise.all([(claimOutbox)(), (claimOutbox)(), (claimOutbox)()]);
            strict.deepEqual(claimed.filter(Boolean).map(job => job.id).sort(), [one.id, two.id].sort());
            for (const job of claimed)
                if (job)
                    await (deliverOutbox)(job, { sendMail: fakeMail });
            strict.equal((await state(one.id)).state, "delivered");
            strict.equal((await state(two.id)).state, "delivered");
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
        await control.query("DROP SCHEMA " + schema + " CASCADE");
        await control.end();
    }
});
