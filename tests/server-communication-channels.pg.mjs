/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { HttpError } from "../src/server/types";
import { decrypt, hash, encrypt } from "../src/server/crypto";
import node_test from "node:test";
import strict from "node:assert/strict";
import { normalizeCommunicationPhone, communicationVerificationResponse, connectCommunicationChannel, getCommunicationChannels, updateCommunicationChannel, telegramVerificationWebhook, communicationCapabilities, captureBoundEndpoints, revokeCommunicationChannel, requestContactChannel, getContactChannels, communicationPreferenceChannelsResponse } from "../src/server/communication-channels";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { mkdtemp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb, query, transaction } from "../src/server/db";
import { deliverOutbox, enqueueNotification } from "../src/server/notifications";
import { getContactPreferenceView, patchContactPreferenceView, requestContactPreferences } from "../src/server/contact-notifications";
import { createCrmSegment, createCrmCampaign, scheduleCrmCampaign, runCrmCampaigns, cancelCrmCampaign, createCrmSuppression, getCrmCampaign } from "../src/server/crm-campaigns";
import { getWorkspace, saveWorkspace, reviewWorkspaceContent, publishWorkspace, unpublishWorkspace } from "../src/server/workspace";
import { flushNotificationDigests } from "../src/server/notification-policy";
import { runPublicationNotificationFanout } from "../src/server/notification-publications";
import { privacyDependencyBlockers } from "../src/server/privacy-dependencies";
import { createPrivacyRequest, exportPrivacyRequest } from "../src/server/privacy";
const define_import_meta_default = import.meta;
const langs = ["fa", "en", "tr", "ar", "ru"];
const actor = (id, role) => ({ id, name: id, email: id + "@example.invalid", role, allowedLocales: [...langs], qualityScope: false, mfaVerified: true });
const admin = actor("channels-admin", "admin"), seller = actor("channels-seller", "business"), other = actor("channels-other", "business"), editor = actor("channels-editor", "contentEditor");
const status = code => error => error instanceof HttpError && error.status === code;
const database = process.env.TEST_ADMIN_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;
const urlToken = url => new URL(url).pathname.split("/").filter(Boolean).at(-1);
const payloadOf = value => JSON.parse((decrypt)(value.encrypted));
(node_test)("phone normalization accepts international Persian digits and rejects ambiguous local destinations", () => {
    strict.equal((normalizeCommunicationPhone)("\u06F0\u06F0\u06F9\u06F8 \u06F9\u06F1\u06F2 \u06F1\u06F2\u06F3 \u06F4\u06F5\u06F6\u06F7"), "+989121234567");
    strict.equal((normalizeCommunicationPhone)("+90 (555) 123-4567"), "+905551234567");
    for (const value of ["09121234567", "+12", "javascript:123", "+00000000000"])
        strict.equal((normalizeCommunicationPhone)(value), null);
});
(node_test)("verified SMS, Telegram and browser channels retain proof, consent, scope and provider acceptance", { skip: !database, timeout: 3e5 }, async (t) => {
    const schema = "channel_test_" + (randomUUID)().replaceAll("-", ""), control = new pg.Client({ connectionString: database });
    await control.connect();
    await control.query("CREATE SCHEMA " + schema);
    const directory = await (mkdtemp)((join)((tmpdir)(), "idealmakoo-channel-fixture-")), workerFile = (join)(directory, "najva-messaging-sw.js");
    await (writeFile)(workerFile, "// Isolated provider fixture, never registered or fetched.\nimportScripts('https://cdn.najva.com/fixture-worker.js');\n");
    const keys = ["NODE_ENV", "DATABASE_URL", "SITE_URL", "SESSION_SECRET", "MFA_ENCRYPTION_KEY", "NOTIFICATIONS_MODE", "SMTP_HOST", "SMTP_FROM", "SMTP_DKIM_MODE", "CRM_CAMPAIGNS_ENABLED", "PRIVACY_LEDGER_DIR", "DEMO_MODE", "KAVENEGAR_API_KEY", "KAVENEGAR_SENDER", "KAVENEGAR_OTP_TEMPLATE", "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_CHANNEL_ID", "TELEGRAM_CHANNEL_LOCALES", "NAJVA_WEBSITE_ID", "NAJVA_API_KEY", "NAJVA_API_URL", "NAJVA_SDK_URL", "NAJVA_WORKER_FILE", "NAJVA_SCRIPT_ORIGINS", "NAJVA_CONNECT_ORIGINS"], old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const scoped = new URL(database);
    scoped.searchParams.set("options", "-c search_path=" + schema);
    const configured = { NODE_ENV: "test", NOTIFICATIONS_MODE: "live", CRM_CAMPAIGNS_ENABLED: "true", KAVENEGAR_API_KEY: "isolated-mocked-api-key", KAVENEGAR_SENDER: "10004300", KAVENEGAR_OTP_TEMPLATE: "verified-phone", TELEGRAM_BOT_TOKEN: "1234:isolated-mocked-token", TELEGRAM_BOT_USERNAME: "IdealMakooFixtureBot", TELEGRAM_WEBHOOK_SECRET: "isolated_webhook_secret_0123456789", TELEGRAM_CHANNEL_ID: "", TELEGRAM_CHANNEL_LOCALES: "fa", NAJVA_WEBSITE_ID: "123456", NAJVA_API_KEY: "isolated-mocked-najva-api-key", NAJVA_API_URL: "https://push.najva.com/v1/send/token/", NAJVA_SDK_URL: "https://cdn.najva.com/fixture.js", NAJVA_WORKER_FILE: workerFile, NAJVA_SCRIPT_ORIGINS: "https://cdn.najva.com", NAJVA_CONNECT_ORIGINS: "https://push.najva.com" };
    Object.assign(process.env, configured, { DATABASE_URL: scoped.toString(), SITE_URL: "https://example.invalid", SMTP_HOST: "smtp.example.invalid", SMTP_FROM: "sender@example.invalid", SMTP_DKIM_MODE: "gateway" });
    process.env.SESSION_SECRET ||= (randomBytes)(32).toString("hex");
    process.env.MFA_ENCRYPTION_KEY ||= (randomBytes)(32).toString("hex");
    delete process.env.PRIVACY_LEDGER_DIR;
    delete process.env.DEMO_MODE;
    await (closeDb)();
    const calls = [];
    const network = async (input, init) => {
        const url = String(input);
        calls.push({ url, body: init?.body });
        strict.equal(init?.redirect, "error");
        if (url.startsWith("https://api.kavenegar.com/")) {
            const form2 = init?.body;
            strict.match(form2.get("receptor") || "", /^00[1-9]\d{9,14}$/);
            if (url.includes("/verify/lookup.json")) {
                strict.equal(form2.get("template"), "verified-phone");
                strict.match(form2.get("token") || "", /^\d{6}$/);
            }
            return Response.json({ return: { status: 200 }, entries: [{ messageid: 123456, receptor: form2.get("receptor") }] });
        }
        if (url.startsWith("https://api.telegram.org/")) {
            const parsed = new URL(url);
            if (parsed.pathname.endsWith("/getChat"))
                return Response.json({ ok: true, result: { id: Number(parsed.searchParams.get("chat_id")), type: "channel" } });
            if (parsed.pathname.endsWith("/getChatMember"))
                return Response.json({ ok: true, result: { status: "administrator", can_post_messages: true, user: { id: 1234, is_bot: true } } });
            const body = JSON.parse(String(init?.body));
            strict.equal(body.link_preview_options.is_disabled, true);
            return Response.json({ ok: true, result: { message_id: 123, chat: { id: Number(body.chat_id) } } });
        }
        strict.equal(url, "https://push.najva.com/v1/send/token/");
        strict.equal(new Headers(init?.headers).get("apiKey"), "isolated-mocked-najva-api-key");
        strict.equal(init?.redirect, "error");
        const form = init?.body;
        strict.equal(form.get("website_id"), "123456");
        strict.ok(form.get("message.notification_click.click_url"));
        return Response.json({ Entries: { request_id: (randomUUID)(), tokens: [{ token: form.get("tokens[]"), status: "Scheduled" }] } });
    };
    const request = (path, method = "GET", body, csrf, origin = "https://example.invalid") => new Request("https://example.invalid/api/v1/" + path, { method, headers: { "Content-Type": "application/json", Origin: origin, ...csrf ? { "X-Communication-CSRF": csrf } : {} }, ...body === void 0 ? {} : { body: JSON.stringify(body) } });
    const outbox = async (id) => (await (query)("SELECT id,state,last_error,payload FROM outbox WHERE id=$1", [id])).rows[0];
    async function bindingJob(id, field = "communicationProof") { const rows = (await (query)("SELECT id,payload FROM outbox WHERE kind IN ('sms','telegram','push') ORDER BY created_at DESC LIMIT 300")).rows; const found = rows.map(row => ({ ...row, value: payloadOf(row.payload) })).find(row => row.value[field]?.bindingId === id); strict.ok(found, "Expected the server-created channel outbox item."); return found; }
    async function claim(id) { const row = (await (query)("UPDATE outbox SET state='running',lock_token=$2,locked_at=now(),attempts=attempts+1 WHERE id=$1 AND state='pending' RETURNING id,kind,payload,attempts,lock_token", [id, (randomUUID)()])).rows[0]; strict.ok(row, "Expected a pending isolated job"); return row; }
    const deliver = async (id, fetcher = network) => (deliverOutbox)(await claim(id), { fetch: fetcher });
    let phoneCounter = 1e6;
    async function customer(tag = (randomUUID)(), assigned = seller) { const user = actor("channel-user-" + (randomUUID)(), "customer"), phone = "+98912" + phoneCounter++, requestId = (randomUUID)(); await (query)("INSERT INTO users(id,email,name,password_hash,role,email_verified) VALUES($1,$2,$3,$4,$5,true)", [user.id, user.email, user.name, "isolated fixture, not a login credential", "customer"]); await (query)("INSERT INTO user_settings(user_id,profile,preferences) VALUES($1,$2::jsonb,$3::jsonb)", [user.id, JSON.stringify({ phone }), JSON.stringify({ language: "fa" })]); await (query)("INSERT INTO requests(id,owner_id,kind,locale,data,assignee_id) VALUES($1,$2,'rfq','fa',$3::jsonb,$4)", [requestId, user.id, JSON.stringify({ status: "new" }), assigned.id]); await (query)("INSERT INTO workspace_entities(bucket,id,collection,data,created_by,updated_by) VALUES('records',$1,'leads',$2::jsonb,$3,$3)", [requestId, JSON.stringify({ id: requestId, collection: "leads", title: Object.fromEntries(langs.map(locale => [locale, "Scoped inquiry " + tag])), summary: Object.fromEntries(langs.map(locale => [locale, "A customer inquiry in the acceptance fixture."])), status: "new", requestId, tags: [tag], owner: assigned.role, assigneeId: assigned.id, history: [], details: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), demo: false }), assigned.id]); const recipientId = (await (query)("SELECT id FROM communication_recipients WHERE user_id=$1", [user.id])).rows[0].id; return { user, phone, requestId, recipientId, tag }; }
    async function contact(tag = (randomUUID)(), assigned = seller) { const id = "channel-contact-" + (randomUUID)(), recipientId = (randomUUID)(), phoneId = (randomUUID)(), emailId = (randomUUID)(), phone = "+98912" + phoneCounter++, email = id + "@example.invalid", record = { id, collection: "contacts", title: Object.fromEntries(langs.map(lang => [lang, "Contact " + tag])), summary: Object.fromEntries(langs.map(lang => [lang, ""])), status: "active", owner: assigned.role, ownerId: assigned.id, tags: [tag], history: [], details: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), demo: false }; await (query)("INSERT INTO workspace_entities(bucket,id,collection,status,data,created_by,updated_by) VALUES('records',$1,'contacts','active',$2::jsonb,$3,$3)", [id, JSON.stringify(record), assigned.id]); await (query)("INSERT INTO crm_contact_profiles(record_id,given_name,family_name,display_name,locale) VALUES($1,'Person',$2,$3,'fa')", [id, tag, "Contact " + tag]); await (query)("INSERT INTO communication_recipients(id,subject_type,subject_id,contact_id) VALUES($1,'crm-contact',$2,$2)", [recipientId, id]); await (query)("INSERT INTO crm_contact_endpoints(id,contact_id,recipient_id,channel,value,normalized_value,label,active) VALUES($1,$2,$3,'phone',$4,$4,'Work',true)", [phoneId, id, recipientId, phone]); await (query)("INSERT INTO crm_contact_endpoints(id,contact_id,recipient_id,channel,value,normalized_value,label,active,verified_at) VALUES($1,$2,$3,'email',$4,$4,'Email',true,now())", [emailId, id, recipientId, email]); return { id, recipientId, phoneId, emailId, phone, email, tag }; }
    async function confirm(connection, code) { const raw = urlToken(connection.verificationUrl), view = await (await (communicationVerificationResponse)(request("communication-verification/" + raw), raw)).json(); const result = await (communicationVerificationResponse)(request("communication-verification/" + raw, "PATCH", { confirm: true, ...code ? { code } : {} }, view.csrfToken), raw); return await result.json(); }
    async function sms(user) { const connection = await (connectCommunicationChannel)(user, { channel: "sms" }), job = await bindingJob(connection.binding.id), proof = await confirm(connection, String(job.value.code)); return { connection, job, token: urlToken(proof.preferenceUrl) }; }
    async function optIn(user, id, frequency = "instant", topic = "products") { const current = (await (getCommunicationChannels)(user)).items.find(item => item.id === id); const preferences = structuredClone(current.preferences); preferences.timezone = "UTC"; preferences.topics[topic] = { enabled: true, frequency, quietStart: null, quietEnd: null }; return (updateCommunicationChannel)(user, id, { preferences }, current.version); }
    async function publicOptIn(token, frequency = "instant") { const view = await (getContactPreferenceView)(token), preferences = structuredClone(view.preferences); preferences.timezone = "UTC"; preferences.topics.products = { enabled: true, frequency, quietStart: null, quietEnd: null }; await (patchContactPreferenceView)(token, { expectedVersion: view.version, preferences }); return (getContactPreferenceView)(token); }
    async function telegram(user, chatId = 9e5 + phoneCounter++) { const connection = await (connectCommunicationChannel)(user, { channel: "telegram" }), raw = new URL(connection.telegramUrl).searchParams.get("start"); const webhook = (body, secret = process.env.TELEGRAM_WEBHOOK_SECRET) => new Request("https://example.invalid/api/v1/communication-channels/telegram-webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(body) }); const update = { update_id: phoneCounter, message: { message_id: 1, text: "/start " + raw, chat: { id: chatId, type: "private" }, from: { id: chatId, is_bot: false } } }; await (telegramVerificationWebhook)(webhook(update)); return { connection, raw, chatId, update, webhook, job: await bindingJob(connection.binding.id, "communicationConfirmed") }; }
    async function push(user, deviceToken = (randomUUID)()) { const connection = await (connectCommunicationChannel)(user, { channel: "push", pushToken: deviceToken }), job = await bindingJob(connection.binding.id); return { connection, job, deviceToken }; }
    async function campaign(tag, channel, audience = "users", steps = 1) { const segment = await (createCrmSegment)(seller, { name: "Selected " + tag, active: true, audience, filter: { field: "tag", op: "in", values: [tag] } }); const draft = { name: "Verified channel journey", segmentId: segment.id, snapshotId: null, topic: "products", channels: [channel], steps: Array.from({ length: steps }, (_, index) => ({ delayMinutes: index ? 1 : 0, content: Object.fromEntries(langs.map(locale => [locale, { title: "Step " + index + " " + locale, body: "Reviewed recipient message " + locale, href: "/" + locale + "/products/" }])) })) }; const saved = await (createCrmCampaign)(seller, draft); const result = await (scheduleCrmCampaign)(seller, saved.id, { startAt: new Date().toISOString() }, saved.version); await (runCrmCampaigns)(); return result; }
    async function jobs(id) { return (await (query)(`SELECT o.id,o.state,e.endpoint_refs,e.recipient_id FROM crm_campaigns c JOIN crm_campaign_deliveries d ON d.revision_id=c.current_revision_id JOIN crm_campaign_enrollments e ON e.id=d.enrollment_id JOIN outbox o ON o.id=d.outbox_id WHERE c.id=$1 ORDER BY d.step_index,o.id`, [id])).rows; }
    async function publication() { const id = "verified-event-" + (randomUUID)(), stamp = new Date().toISOString(), text = value => Object.fromEntries(langs.map(locale => [locale, value])); const record = { id, collection: "events", title: text("Reviewed public event " + id), summary: text("A reviewed public event with a confirmed schedule."), status: "review", owner: editor.role, tags: [], demo: false, history: [], createdAt: stamp, updatedAt: stamp, eventStart: "2027-01-02T09:00:00.000Z", eventEnd: "2027-01-02T10:00:00.000Z", location: "Online" }; const source = await (getWorkspace)(editor); await (saveWorkspace)(editor, { state: { ...source.state, records: [...source.state.records, record] }, expectedVersion: source.version }); let current = await (getWorkspace)(admin); current = await (reviewWorkspaceContent)(admin, { bucket: "records", id, locale: "fa", expectedVersion: current.version }); await (publishWorkspace)(admin, { publication: { id, kind: "events", locale: "fa" }, expectedVersion: current.version }); const event = (await (query)("SELECT e.id,r.slug FROM notification_publication_events e JOIN locale_releases r ON r.active_revision_id=e.revision_id WHERE e.document_id=$1", [id])).rows[0]; strict.ok(event); return { id, eventId: event.id, slug: event.slug }; }
    async function publicationJobs(eventId) { return (await (query)("SELECT id,kind,payload FROM outbox WHERE dedupe_key LIKE $1", [eventId + ":%"])).rows.map(row => ({ ...row, value: payloadOf(row.payload) })); }
    try {
        const migration = new pg.Client({ connectionString: scoped.toString() });
        await migration.connect();
        try {
            for (const file of (await (readdir)(new URL("../db/migrations/", define_import_meta_default.url))).filter(file2 => file2.endsWith(".sql")).sort())
                await migration.query(await (readFile)(new URL("../db/migrations/" + file, define_import_meta_default.url), "utf8"));
        }
        finally {
            await migration.end();
        }
        for (const user of [admin, seller, other, editor])
            await (query)("INSERT INTO users(id,email,name,password_hash,role,mfa_enabled,crm_permissions) VALUES($1,$2,$3,$4,$5,true,$6::jsonb)", [user.id, user.email, user.name, "isolated fixture, not a credential", user.role, JSON.stringify({ contact: true })]);
        t.beforeEach(async () => { Object.assign(process.env, configured); await (query)("UPDATE users SET active=true,mfa_enabled=true WHERE id=$1", [admin.id]); await (query)("UPDATE users SET active=true,mfa_enabled=true,crm_permissions=$2::jsonb,allowed_locales=$3::jsonb WHERE id=$1", [seller.id, JSON.stringify({ contact: true }), JSON.stringify(langs)]); });
        t.afterEach(async () => {
            await (query)("UPDATE users SET active=true,mfa_enabled=true WHERE id=$1", [admin.id]);
            await (query)("UPDATE notification_publication_events SET state='cancelled',completed_at=now() WHERE state='pending'");
            for (const item of (await (query)("SELECT id,version FROM crm_campaigns WHERE status IN ('draft','scheduled','running')")).rows)
                await (cancelCrmCampaign)(admin, item.id, { reason: "Isolated fixture cleanup" }, item.version);
            await (query)("UPDATE outbox SET state='cancelled',lock_token=NULL WHERE state IN ('pending','running','batched')");
        });
        await t.test("capability requires actual provider config, a valid worker and exact SDK CSP origins", async () => { strict.equal((communicationCapabilities)().push.verification, true); process.env.NAJVA_SCRIPT_ORIGINS = "https://*.najva.com"; strict.equal((communicationCapabilities)().push.verification, false); process.env.NAJVA_SCRIPT_ORIGINS = configured.NAJVA_SCRIPT_ORIGINS; process.env.NAJVA_WORKER_FILE = "/tmp/missing-najva-messaging-sw.js"; strict.equal((communicationCapabilities)().push.verification, false); process.env.NOTIFICATIONS_MODE = "disabled"; const person = await customer(), before = calls.length; await strict.rejects((connectCommunicationChannel)(person.user, { channel: "sms" }), status(503)); strict.equal((await (getCommunicationChannels)(person.user)).items.length, 0); strict.equal(calls.length, before); });
        await t.test("SMS dispatch uses the saved international phone and official OTP form, without exposing the code", async () => { const person = await customer(); await strict.rejects((connectCommunicationChannel)(person.user, { channel: "sms", to: "+989999999999" }), status(422)); const connection = await (connectCommunicationChannel)(person.user, { channel: "sms" }), job = await bindingJob(connection.binding.id); strict.equal(JSON.stringify(connection).includes(String(job.value.code)), false); strict.equal(JSON.stringify(connection).includes(person.phone), false); strict.equal(job.value.to, person.phone); const stored = (await (query)("SELECT code_hash FROM communication_binding_challenges WHERE binding_id=$1", [connection.binding.id])).rows[0]; strict.notEqual(stored.code_hash, job.value.code); await deliver(job.id); strict.equal((await outbox(job.id)).state, "delivered"); strict.match(calls.at(-1).url, /verify\/lookup\.json$/); });
        await t.test("wrong OTP attempts are committed and a fifth failure cannot be bypassed with the right code", async () => {
            const person = await customer(), connection = await (connectCommunicationChannel)(person.user, { channel: "sms" }), job = await bindingJob(connection.binding.id);
            for (let index = 0; index < 5; index++)
                await strict.rejects(confirm(connection, job.value.code === "000000" ? "111111" : "000000"), status(422));
            strict.equal((await (query)("SELECT attempts FROM communication_binding_challenges WHERE binding_id=$1", [connection.binding.id])).rows[0].attempts, 5);
            await strict.rejects(confirm(connection, String(job.value.code)), status(409));
            strict.equal((await (getCommunicationChannels)(person.user)).items[0].verified, false);
        });
        await t.test("SMS proof requires token-bound CSRF, is one-use and leaves every topic off", async () => {
            const person = await customer(), connection = await (connectCommunicationChannel)(person.user, { channel: "sms" }), job = await bindingJob(connection.binding.id), raw = urlToken(connection.verificationUrl), view = await (await (communicationVerificationResponse)(request("communication-verification/" + raw), raw)).json();
            for (const [csrf, origin] of [[void 0, "https://example.invalid"], [view.csrfToken, "https://evil.invalid"]])
                await strict.rejects((communicationVerificationResponse)(request("communication-verification/" + raw, "PATCH", { confirm: true, code: job.value.code }, csrf, origin), raw), status(403));
            const proof = await confirm(connection, String(job.value.code));
            await strict.rejects(confirm(connection, String(job.value.code)), status(409));
            const preferences = await (getContactPreferenceView)(urlToken(proof.preferenceUrl));
            strict.ok(Object.values(preferences.preferences.topics).every(value => !value?.enabled));
            strict.equal((await (getCommunicationChannels)(person.user)).items[0].verified, true);
            strict.deepEqual(await (transaction)(client => (captureBoundEndpoints)(client, person.recipientId, ["sms"], "products")), []);
        });
        await t.test("slow proof requests redact bearer tokens and never create account cookies", async () => {
            const person = await customer(), connection = await (connectCommunicationChannel)(person.user, { channel: "sms" }), raw = urlToken(connection.verificationUrl), { handleRequest } = await import("../src/server/router");
            const info = console.info, clock = Date.now, messages = [];
            let now = clock();
            let response;
            try {
                console.info = (...args) => { messages.push(args); };
                Date.now = () => now += 2e3;
                response = await handleRequest(request("communication-verification/" + raw), ["communication-verification", raw]);
            }
            finally {
                console.info = info;
                Date.now = clock;
            }
            strict.equal(response.status, 200, await response.text());
            strict.equal(response.headers.get("set-cookie"), null);
            strict.match(JSON.stringify(messages), /communication-verification\/\[redacted\]/);
            strict.equal(JSON.stringify(messages).includes(raw), false);
        });
        await t.test("own channel updates are versioned and other accounts cannot read or mutate the binding", async () => { const person = await customer(), outsider = await customer(), proof = await sms(person.user), saved = await optIn(person.user, proof.connection.binding.id); strict.equal((await (getCommunicationChannels)(outsider.user)).items.length, 0); await strict.rejects((updateCommunicationChannel)(outsider.user, saved.id, { preferences: saved.preferences }, saved.version), status(404)); await strict.rejects((updateCommunicationChannel)(person.user, saved.id, { preferences: saved.preferences }, saved.version - 1), status(409)); const revoked = await (revokeCommunicationChannel)(person.user, saved.id, saved.version); strict.equal(revoked.active, false); await strict.rejects((getContactPreferenceView)(proof.token), status(404)); });
        await t.test("a changed saved phone invalidates old proof and queued destinations immediately", async () => { const person = await customer(), connection = await (connectCommunicationChannel)(person.user, { channel: "sms" }), job = await bindingJob(connection.binding.id); await (query)("UPDATE user_settings SET profile=$2::jsonb WHERE user_id=$1", [person.user.id, JSON.stringify({ phone: "+989999999999" })]); await strict.rejects(confirm(connection, String(job.value.code)), status(404)); const before = calls.length; await deliver(job.id); strict.equal(calls.length, before); strict.equal((await outbox(job.id)).state, "cancelled"); });
        await t.test("Telegram webhook proof rejects forged auth, groups and a different sender, and replay is harmless", async () => { const person = await customer(), connection = await (connectCommunicationChannel)(person.user, { channel: "telegram" }), raw = new URL(connection.telegramUrl).searchParams.get("start"), body = { update_id: 5, message: { message_id: 1, text: "/start " + raw, chat: { id: 192837, type: "private" }, from: { id: 192837, is_bot: false } } }, webhook = (value, secret = process.env.TELEGRAM_WEBHOOK_SECRET) => new Request("https://example.invalid/api/v1/communication-channels/telegram-webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret || "" }, body: JSON.stringify(value) }); await strict.rejects((telegramVerificationWebhook)(webhook(body, "forged")), status(403)); await (telegramVerificationWebhook)(webhook({ ...body, message: { ...body.message, chat: { id: -192837, type: "group" } } })); await (telegramVerificationWebhook)(webhook({ ...body, message: { ...body.message, from: { id: 5, is_bot: false } } })); strict.equal((await (getCommunicationChannels)(person.user)).items[0].verified, false); await (telegramVerificationWebhook)(webhook(body)); const first = await bindingJob(connection.binding.id, "communicationConfirmed"); await (telegramVerificationWebhook)(webhook(body)); strict.equal((await bindingJob(connection.binding.id, "communicationConfirmed")).id, first.id); await deliver(first.id); strict.equal((await outbox(first.id)).state, "delivered"); strict.equal((await (getCommunicationChannels)(person.user)).items[0].preferences.topics.products.enabled, false); });
        await t.test("a Telegram response for a different chat is uncertain, not recipient acceptance", async () => { const person = await customer(), bound = await telegram(person.user); await deliver(bound.job.id, async () => Response.json({ ok: true, result: { message_id: 22, chat: { id: bound.chatId + 1 } } })); strict.equal((await outbox(bound.job.id)).state, "uncertain"); });
        await t.test("push proof link is sent only to the actual device and HTTP 200 alone is insufficient", async () => { const person = await customer(), bound = await push(person.user); strict.equal(bound.connection.verificationUrl, void 0); strict.equal(JSON.stringify(bound.connection).includes(bound.deviceToken), false); const raw = urlToken(bound.job.value.href); strict.equal(JSON.stringify(bound.connection).includes(raw), false); await deliver(bound.job.id); strict.equal((await outbox(bound.job.id)).state, "delivered"); const view = await (await (communicationVerificationResponse)(request("communication-verification/" + raw), raw)).json(); const result = await (communicationVerificationResponse)(request("communication-verification/" + raw, "PATCH", { confirm: true }, view.csrfToken), raw); strict.equal((await result.json()).status, "verified"); strict.ok((await (getCommunicationChannels)(person.user)).items[0].verified); strict.equal((await (getCommunicationChannels)(person.user)).items[0].preferences.topics.products.enabled, false); const another = await push(person.user); await deliver(another.job.id, async () => Response.json({ Entries: { request_id: "unproven", tokens: [] } })); strict.equal((await outbox(another.job.id)).state, "uncertain"); });
        await t.test("explicit Najva InvalidToken is a definitive failure with no provider retry", async () => { const person = await customer(), bound = await push(person.user); await deliver(bound.job.id, async () => Response.json({ Entries: { request_id: "rejected", tokens: [{ token: bound.deviceToken, status: "InvalidToken" }] } })); strict.equal((await outbox(bound.job.id)).state, "failed"); strict.equal((await outbox(bound.job.id)).last_error, "PUSH_REJECTED"); });
        await t.test("contact SMS uses an authorized saved phone; staff cannot set recipient consent", async () => { const person = await contact(), hidden = await contact((randomUUID)(), other); await strict.rejects((requestContactChannel)(seller, hidden.id, { channel: "sms", endpointId: hidden.phoneId }), status(404)); await strict.rejects((requestContactChannel)(seller, person.id, { channel: "sms", endpointId: hidden.phoneId }), status(422)); const connection = await (requestContactChannel)(seller, person.id, { channel: "sms", endpointId: person.phoneId }), job = await bindingJob(connection.binding.id), proof = await confirm(connection, String(job.value.code)); strict.ok((await (query)("SELECT verified_at FROM crm_contact_endpoints WHERE id=$1", [person.phoneId])).rows[0].verified_at); strict.equal((await (getContactChannels)(seller, person.id)).items[0].preferences.topics.products.enabled, false); const raw = urlToken(proof.preferenceUrl); await publicOptIn(raw); strict.equal((await (transaction)(client => (captureBoundEndpoints)(client, person.recipientId, ["sms"], "products"))).length, 1); await (query)("UPDATE crm_contact_endpoints SET value=$2,normalized_value=$2,version=version+1,verified_at=NULL WHERE id=$1", [person.phoneId, "+989999999999"]); await strict.rejects((getContactPreferenceView)(raw), status(404)); });
        await t.test("verified contact capability can connect Telegram without creating or discovering an account", async () => {
            const person = await contact();
            await (requestContactPreferences)(seller, person.id, person.emailId);
            const email = (await (query)("SELECT payload FROM outbox WHERE crm_contact_id=$1 AND kind='email' ORDER BY created_at DESC LIMIT 1", [person.id])).rows[0], emailPayload = payloadOf(email.payload), link = String(emailPayload.text).match(/https:\/\/[^\s]+\/communication-preferences\/([a-f0-9]{64})\//);
            strict.ok(link);
            const raw = link[1], view = await (getContactPreferenceView)(raw), path = "communication-preferences/" + raw + "/channels";
            await strict.rejects((communicationPreferenceChannelsResponse)(request(path, "POST", { channel: "telegram" }), raw), status(403));
            const response = await (communicationPreferenceChannelsResponse)(request(path, "POST", { channel: "telegram" }, view.csrfToken), raw), connection = await response.json();
            strict.ok(connection.telegramUrl);
            const directory2 = await (await (communicationPreferenceChannelsResponse)(request(path), raw)).json();
            strict.equal(directory2.items[0].id, connection.binding.id);
            for (const hidden of [person.id, person.recipientId, person.email])
                strict.equal(JSON.stringify(directory2).includes(hidden), false);
        });
        await t.test("campaign captures immutable verified SMS identity and sender scope is rechecked before dispatch", async () => { const person = await customer(), proof = await sms(person.user); await optIn(person.user, proof.connection.binding.id); const run = await campaign(person.tag, "sms"), queued = (await jobs(run.id))[0]; strict.ok(queued); strict.deepEqual(queued.endpoint_refs, [{ channel: "sms", bindingId: proof.connection.binding.id, endpointVersion: 1, valueHash: (hash)(person.phone) }]); await (query)("UPDATE requests SET assignee_id=$2 WHERE id=$1", [person.requestId, other.id]); const before = calls.length; await deliver(queued.id); strict.equal(calls.length, before); strict.equal((await outbox(queued.id)).state, "cancelled"); });
        await t.test("contact campaign shared phone dedupe preserves separate recipient enrollment identities", async () => {
            const tag = (randomUUID)(), a = await contact(tag), b = await contact(tag);
            await (query)("UPDATE crm_contact_endpoints SET value=$2,normalized_value=$2 WHERE id=$1", [b.phoneId, a.phone]);
            for (const person of [a, b]) {
                const connection = await (requestContactChannel)(seller, person.id, { channel: "sms", endpointId: person.phoneId }), job2 = await bindingJob(connection.binding.id), proof = await confirm(connection, String(job2.value.code));
                await publicOptIn(urlToken(proof.preferenceUrl));
            }
            const run = await campaign(tag, "sms", "contacts");
            strict.equal((await jobs(run.id)).length, 1);
            strict.equal((await (query)("SELECT id FROM crm_campaign_enrollments WHERE revision_id=$1", [run.revisionId])).rowCount, 2);
            const job = (await jobs(run.id))[0];
            await deliver(job.id);
            strict.equal((await outbox(job.id)).state, "delivered");
        });
        await t.test("revocation and channel-specific suppression cancel frozen jobs without substituting another binding", async () => { const person = await customer(), proof = await sms(person.user), saved = await optIn(person.user, proof.connection.binding.id), run = await campaign(person.tag, "sms"), job = (await jobs(run.id))[0]; await (revokeCommunicationChannel)(person.user, saved.id, saved.version); const replacement = await sms(person.user); await optIn(person.user, replacement.connection.binding.id); const before = calls.length; await deliver(job.id); strict.equal(calls.length, before); strict.equal((await outbox(job.id)).state, "cancelled"); const otherPerson = await customer(), otherProof = await sms(otherPerson.user); await optIn(otherPerson.user, otherProof.connection.binding.id); const otherRun = await campaign(otherPerson.tag, "sms"), otherJob = (await jobs(otherRun.id))[0]; await (createCrmSuppression)(seller, { recipientId: otherPerson.recipientId, scope: "sender", topic: "products", channel: "sms", reason: "Recipient explicitly paused SMS" }); await deliver(otherJob.id); strict.equal((await outbox(otherJob.id)).state, "cancelled"); });
        await t.test("daily SMS digest retains full messages and advances only after actual acceptance", async () => { const person = await customer(), proof = await sms(person.user); await optIn(person.user, proof.connection.binding.id, "daily"); const run = await campaign(person.tag, "sms", "users", 2), job = (await jobs(run.id))[0]; await (query)("UPDATE outbox SET created_at=now()-interval '2 days' WHERE id=$1", [job.id]); await deliver(job.id); strict.equal((await outbox(job.id)).state, "batched"); await (flushNotificationDigests)(); const digest = (await (query)("SELECT digest_outbox_id FROM notification_digest_items WHERE outbox_id=$1", [job.id])).rows[0].digest_outbox_id; strict.ok(digest); await deliver(digest); strict.equal((await outbox(job.id)).state, "delivered"); strict.match(String(calls.at(-1).body.get("message")), /Reviewed recipient message fa/); await (runCrmCampaigns)(100, new Date(Date.now() + 7e4)); strict.equal((await (getCrmCampaign)(seller, run.id)).recent[0].stepIndex, 1); });
        await t.test("ambiguous channel provider acknowledgement never dispatches another campaign step", async () => { const person = await customer(), proof = await sms(person.user); await optIn(person.user, proof.connection.binding.id); const run = await campaign(person.tag, "sms", "users", 2), job = (await jobs(run.id))[0]; let count = 0; await deliver(job.id, async () => { count++; throw new Error("Mock acknowledgement lost after possible acceptance"); }); await (runCrmCampaigns)(100, new Date(Date.now() + 864e5)); strict.equal((await (getCrmCampaign)(seller, run.id)).counts.uncertain, 1); strict.equal((await jobs(run.id)).length, 1); strict.equal(count, 1); });
        await t.test("manual channel messages use saved typed identity and recheck current sender grants", async () => { const person = await customer(), proof = await sms(person.user); await optIn(person.user, proof.connection.binding.id); await strict.rejects((enqueueNotification)(seller, { channel: "sms", to: person.phone, recipientId: person.recipientId, title: "Review", body: "Reviewed message", purpose: "marketing", topic: "products" }), status(422)); const job = await (enqueueNotification)(seller, { channel: "sms", recipientId: person.recipientId, title: "Review", body: "Reviewed message", purpose: "marketing", topic: "products", href: "/fa/products/" }); await (query)("UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1", [seller.id, "{}"]); const before = calls.length; await deliver(job.id); strict.equal(calls.length, before); strict.equal((await outbox(job.id)).state, "cancelled"); });
        await t.test("reviewed publication fans out once to proven consented channels and the configured official channel", async () => {
            const person = await customer(), proof = await sms(person.user);
            await optIn(person.user, proof.connection.binding.id, "instant", "events");
            const silent = await customer();
            await sms(silent.user);
            process.env.TELEGRAM_CHANNEL_ID = "-100123456789";
            const released = await publication();
            const expanded = await (runPublicationNotificationFanout)(500);
            strict.equal(expanded.completed, true);
            const first = await publicationJobs(released.eventId);
            const direct = first.filter(row => row.value.userId === person.user.id), official = first.filter(row => row.value.publicTelegramChannel);
            strict.equal(direct.length, 1);
            strict.equal(direct[0].kind, "sms");
            strict.equal(first.some(row => row.value.userId === silent.user.id), false);
            strict.equal(official.length, 1);
            await (runPublicationNotificationFanout)(500);
            strict.equal((await publicationJobs(released.eventId)).length, first.length);
            await deliver(direct[0].id);
            await deliver(official[0].id);
            strict.equal((await outbox(direct[0].id)).state, "delivered");
            strict.equal((await outbox(official[0].id)).state, "delivered");
            const recent = calls.slice(-3).map(call => call.url);
            strict.ok(recent[0].includes("/getChat?"));
            strict.ok(recent[1].includes("/getChatMember?"));
            strict.ok(recent[2].endsWith("/sendMessage"));
            const sent = JSON.parse(String(calls.at(-1).body));
            strict.match(sent.text, /Reviewed public event/);
            strict.equal(sent.chat_id, "-100123456789");
            for (const privateValue of [person.phone, person.user.email, person.requestId])
                strict.equal(sent.text.includes(privateValue), false);
        });
        await t.test("withdrawal and publisher MFA revocation suppress queued public notifications before provider calls", async () => {
            const person = await customer(), proof = await sms(person.user);
            await optIn(person.user, proof.connection.binding.id, "instant", "events");
            process.env.TELEGRAM_CHANNEL_ID = "-100123456789";
            const released = await publication();
            await (runPublicationNotificationFanout)(500);
            const queued = await publicationJobs(released.eventId), source = await (getWorkspace)(admin);
            await (unpublishWorkspace)(admin, { slug: released.slug, locale: "fa", kind: "events", expectedVersion: source.version });
            const before = calls.length;
            for (const job of queued)
                await deliver(job.id);
            strict.equal(calls.length, before);
            strict.ok((await Promise.all(queued.map(job => outbox(job.id)))).every(row => row.state === "cancelled"));
            const another = await publication();
            await (runPublicationNotificationFanout)(500);
            const next = await publicationJobs(another.eventId);
            await (query)("UPDATE users SET mfa_enabled=false WHERE id=$1", [admin.id]);
            for (const job of next)
                await deliver(job.id);
            strict.equal(calls.length, before);
            strict.ok((await Promise.all(next.map(job => outbox(job.id)))).every(row => row.state === "cancelled"));
        });
        await t.test("official channel rights are checked and forged public text never reaches the provider", async () => {
            process.env.TELEGRAM_CHANNEL_ID = "-100123456789";
            const released = await publication();
            await (runPublicationNotificationFanout)(500);
            const job = (await publicationJobs(released.eventId)).find(row => row.value.publicTelegramChannel);
            strict.ok(job);
            let sent = 0;
            await deliver(job.id, async (input, init) => {
                const url = String(input);
                if (url.includes("/getChatMember?"))
                    return Response.json({ ok: true, result: { status: "administrator", can_post_messages: false, user: { id: 1234, is_bot: true } } });
                if (url.endsWith("/sendMessage"))
                    sent++;
                return network(input, init);
            });
            strict.equal(sent, 0);
            strict.equal((await outbox(job.id)).state, "failed");
            strict.equal((await outbox(job.id)).last_error, "TELEGRAM_CHANNEL_PERMISSION");
            const forged = (randomUUID)(), altered = { ...job.value, body: "An unauthorized private claim" };
            await (query)("INSERT INTO outbox(id,kind,payload,dedupe_key) VALUES($1,'telegram',$2::jsonb,$3)", [forged, JSON.stringify({ encrypted: (encrypt)(JSON.stringify(altered)) }), "forged-public-" + forged]);
            const before = calls.length;
            await deliver(forged);
            strict.equal(calls.length, before);
            strict.equal((await outbox(forged)).state, "cancelled");
        });
        await t.test("privacy closure permits ephemeral proof children but retains immutable consent and exports no token material", async () => {
            const person = await customer(), connection = await (connectCommunicationChannel)(person.user, { channel: "telegram" });
            const early = await (transaction)(client => (privacyDependencyBlockers)(client, { type: "user", id: person.user.id }));
            strict.equal(early.some(item => /COMMUNICATION_(BINDINGS|BINDING_CHALLENGES)/.test(item.code)), false);
            const verified = await telegram(person.user), saved = await optIn(person.user, verified.connection.binding.id), blocked = await (transaction)(client => (privacyDependencyBlockers)(client, { type: "user", id: person.user.id }));
            strict.ok(blocked.some(item => item.code === "DEPENDENCY_COMMUNICATION_BINDING_CONSENTS"));
            const request2 = await (createPrivacyRequest)(person.user, { subject: { type: "user", id: person.user.id }, action: "export", reason: "Export my saved communication preferences" }), response = await (exportPrivacyRequest)(person.user, request2.id), text = await response.text(), exported = JSON.parse(text);
            strict.ok(exported.communication.channels.some(item => item.id === saved.id));
            strict.ok(exported.communication.channelConsents.some(item => item.bindingId === saved.id));
            for (const hidden of [verified.raw, process.env.TELEGRAM_BOT_TOKEN, connection.telegramUrl])
                strict.equal(text.includes(hidden), false);
            strict.equal(text.includes("endpoint_encrypted"), false);
        });
    }
    finally {
        await (closeDb)();
        for (const key of keys) {
            if (old[key] === void 0)
                delete process.env[key];
            else
                Object.assign(process.env, { [key]: old[key] });
        }
        await control.query("DROP SCHEMA " + schema + " CASCADE");
        await control.end();
        await (rm)(directory, { recursive: true, force: true });
    }
});
