import type {PgRow} from './recovered-db-rows';
import type {WorkspaceRecord} from '../data/workspace-seed';
import type {Locale} from '../lib/i18n';
type CsvValues = Record<string,string>;
type CsvIssue = {path:string;code:string;message:string};
type JobRow = PgRow<'crm_transfer_jobs'>;
type TransferRow = PgRow<'crm_transfer_rows',{payload:{encrypted:string};issues:CsvIssue[]}>;
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { LOCALES } from "./workspace-validation";
import { z } from "zod";
import { assert, HttpError } from "./types";
import { parse, rateLimit } from "./http";
import { decrypt, encrypt, hash } from "./crypto";
import { loadCrmAccess, redactCrmRecord, crmCollections } from "./workspace-scopes";
import { canWorkspace } from "../lib/auth";
import { readableRecord } from "./workspace-policy";
import { transaction, audit } from "./db";
import { randomUUID } from "node:crypto";
import { lockWorkspace, importCrmWorkspaceRecord } from "./workspace";
const MAX_BYTES = 524288, MAX_ROWS = 2e3, PAGE_ROWS = 50;
const CRM_CSV_COLUMNS = ["external_id", ...LOCALES.map(locale => "title_" + locale), ...LOCALES.map(locale => "summary_" + locale), "email", "phone", "organization", "tags"];
const columns = new Set(CRM_CSV_COLUMNS), requiredColumns = ["external_id", ...LOCALES.map(locale => "title_" + locale)];
const collectionSchema = z.enum(["contacts", "leads"]), uuid = z.string().uuid();
const clean = (min: number, max: number) => z.string().trim().min(min).max(max).regex(/^[^\x00-\x1f\x7f]*$/);
const createImportSchema = z.object({ collection: collectionSchema, name: clean(1, 160), csvText: z.string().min(1) }).strict();
const createExportSchema = z.object({ collection: collectionSchema, name: clean(1, 160), recordIds: z.array(z.string().min(1).max(160)).min(1).max(MAX_ROWS).optional() }).strict();
const commandSchema = z.object({ action: z.enum(["start", "pause", "resume", "cancel"]), reason: clean(8, 500), confirmRows: z.number().int().min(1).max(MAX_ROWS).optional() }).strict();
const valuesSchema = z.record(z.string(), z.string().max(4e3)).refine(value => Object.keys(value).length <= CRM_CSV_COLUMNS.length && Object.keys(value).every(key => columns.has(key)), "Only documented CSV columns may be supplied.");
const storedValuesSchema = z.record(z.string(), z.string().max(1e5)).refine(value => Object.keys(value).length <= CRM_CSV_COLUMNS.length && Object.keys(value).every(key => columns.has(key)), "Only documented CSV columns may be stored.");
const isAdmin = (actor: Actor) => ["superAdmin", "admin"].includes(actor.role);
const requireUuid = (id: string) => (assert)(uuid.safeParse(id).success, 404, "NOT_FOUND", "Transfer job not found.");
const conflict = (expected: number, current: number) => (assert)(Number.isSafeInteger(expected) && expected === current, 409, "CONFLICT", "This transfer changed. Refresh and review the current version.");
const issue = (path: string, code: string, message: string) => ({ path, code, message });
const unpack = (row: Pick<TransferRow,'payload'>) => (parse)(storedValuesSchema, JSON.parse((decrypt)(row.payload.encrypted)).values);
const packed = (values: CsvValues) => JSON.stringify({ encrypted: (encrypt)(JSON.stringify({ values })) });
const keyHash = (value: string) => (hash)(value.normalize("NFC"));
function parseCrmCsv(text: string): CsvValues[] {
    (assert)(typeof text === "string" && Buffer.byteLength(text, "utf8") <= MAX_BYTES, 413, "CSV_SIZE", "CSV input is limited to 512 KiB.");
    (assert)(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text), 422, "CSV_CONTROL", "CSV input contains unsupported control characters.");
    const input = text.replace(/^\ufeff/, ""), rows: string[][] = [];
    let row: string[] = [], cell = "", state = "start", ended = false;
    const field = () => { (assert)(row.length < CRM_CSV_COLUMNS.length, 422, "CSV_COLUMNS", "CSV input contains too many columns."); row.push(cell.replace(/\r\n?/g, "\n")); cell = ""; state = "start"; };
    const line = () => { field(); rows.push(row); row = []; (assert)(rows.length <= MAX_ROWS + 1, 422, "CSV_ROWS", "CSV input is limited to 2000 data rows."); };
    for (let index = 0; index < input.length; index++) {
        const char = input[index];
        ended = false;
        if (state === "quoted") {
            if (char === '"') {
                if (input[index + 1] === '"') {
                    cell += '"';
                    index++;
                }
                else
                    state = "closed";
            }
            else
                cell += char;
        }
        else if (char === ",") {
            field();
        }
        else if (char === "\n" || char === "\r") {
            line();
            if (char === "\r" && input[index + 1] === "\n")
                index++;
            ended = true;
        }
        else if (char === '"') {
            (assert)(state === "start", 422, "CSV_QUOTE", "A quoted cell must start at its opening quote.");
            state = "quoted";
        }
        else {
            (assert)(state !== "closed", 422, "CSV_QUOTE", "Only a delimiter may follow a closing quote.");
            cell += char;
            state = "plain";
        }
        (assert)(cell.length <= 4e3, 422, "CSV_CELL", "A CSV cell may contain at most 4000 characters.");
    }
    (assert)(state !== "quoted", 422, "CSV_QUOTE", "A quoted CSV cell was not closed.");
    if (input.length && !ended)
        line();
    (assert)(rows.length >= 2, 422, "CSV_ROWS", "Provide a header and at least one data row.");
    const header = rows.shift()!.map(name => name.trim());
    (assert)(new Set(header).size === header.length && header.every(name => columns.has(name)) && requiredColumns.every(name => header.includes(name)), 422, "CSV_HEADER", "Use unique documented columns, external_id and all five title columns.");
    return rows.map((cells, index) => { (assert)(cells.length === header.length, 422, "CSV_WIDTH", "CSV row " + (index + 1) + " does not match the header width."); return Object.fromEntries(CRM_CSV_COLUMNS.map(name => [name, header.includes(name) ? cells[header.indexOf(name)].trim() : ""])); });
}
function validateCrmCsvValues(input: CsvValues): CsvIssue[] {
    const parsed = valuesSchema.safeParse(input);
    if (!parsed.success)
        return [issue("values", "CSV_COLUMNS", "Only documented string columns may be supplied.")];
    const errors = [];
    for (const column of CRM_CSV_COLUMNS) {
        const value = input[column] ?? "";
        if (/[\x00-\x08\x0b-\x1f\x7f]/.test(value))
            errors.push(issue(column, "CSV_CONTROL", "Unsupported control character."));
    }
    if (!clean(1, 160).safeParse(input.external_id ?? "").success)
        errors.push(issue("external_id", "EXTERNAL_ID", "Supply a stable external identity between 1 and 160 characters."));
    for (const locale of LOCALES) {
        if (!clean(1, 200).safeParse(input["title_" + locale] ?? "").success)
            errors.push(issue("title_" + locale, "TITLE", "Supply a plain title from 1 to 200 characters in every language."));
        if ((input["summary_" + locale] ?? "").length > 4e3)
            errors.push(issue("summary_" + locale, "SUMMARY", "A summary may contain at most 4000 characters."));
    }
    if (input.email && !z.string().email().max(254).safeParse(input.email).success)
        errors.push(issue("email", "EMAIL", "Supply a valid email address; importing never verifies it."));
    if (input.phone && !/^\+[1-9]\d{7,14}$/.test(input.phone))
        errors.push(issue("phone", "PHONE", "Use E.164 format, including the leading + and country code."));
    if (input.organization && !clean(0, 200).safeParse(input.organization).success)
        errors.push(issue("organization", "ORGANIZATION", "Use a plain organization label of at most 200 characters."));
    const tags = (input.tags || "").split(";").map(tag => tag.trim()).filter(Boolean);
    if (tags.length > 20 || tags.some(tag => !clean(1, 80).safeParse(tag).success))
        errors.push(issue("tags", "TAGS", "Use at most 20 semicolon-separated tags, each at most 80 characters."));
    return errors;
}
function safeCrmCsvCell(value: string) {
    let cell = value;
    if (/^[\s\x00-\x1f\x7f]*[=+@-]/u.test(cell) || /^[\t\r\n]/.test(cell))
        cell = "'" + cell;
    return '"' + cell.replaceAll('"', '""') + '"';
}
function encodeCrmCsv(rows: CsvValues[]) { return "\uFEFF" + [CRM_CSV_COLUMNS.join(","), ...rows.map(row => CRM_CSV_COLUMNS.map(column => safeCrmCsvCell(row[column] || "")).join(","))].join("\r\n") + "\r\n"; }
async function transferActor(actor: Actor, kind: "view"|"import"|"export" = "view", collection?: string, client?: PoolClient) {
    actor = await (loadCrmAccess)(actor, client);
    (assert)(actor.role !== "customer" && actor.mfaVerified && actor.crmAccess?.permissions.contact && (canWorkspace)(actor.role, "view", "data"), 403, "TRANSFER_PERMISSION", "Current data access, contact permission and MFA are required.");
    if (kind !== "view")
        (assert)((canWorkspace)(actor.role, kind, "data") && (!collection || (canWorkspace)(actor.role, kind, collection) && (canWorkspace)(actor.role, kind === "import" ? "create" : "view", collection)), 403, "TRANSFER_PERMISSION", "This collection is unavailable for the requested transfer.");
    return actor;
}
async function creatorActor(client: PoolClient, job: JobRow) { return transferActor({ id: job.created_by, name: "", email: "", role: "customer", mfaVerified: true, qualityScope: false, allowedLocales: [] }, job.kind, job.collection, client); }
async function jobFor(client: PoolClient, actor: Actor, id: string, lock = false) { requireUuid(id); const row = (await client.query<JobRow>("SELECT * FROM crm_transfer_jobs WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [id])).rows[0]; (assert)(row && (row.created_by === actor.id || isAdmin(actor)) && (canWorkspace)(actor.role, "view", row.collection), 404, "NOT_FOUND", "Transfer job not found in your current scope."); return row; }
async function countsFor(client: PoolClient, id: string) {
    const counts: Record<TransferRow['state'],number> = { invalid: 0, ready: 0, applied: 0, failed: 0, exported: 0 };
    for (const row of (await client.query<{state:TransferRow["state"];count:string}>("SELECT state,count(*)::text AS count FROM crm_transfer_rows WHERE job_id=$1 GROUP BY state", [id])).rows)
        counts[row.state] = Number(row.count);
    return counts;
}
async function jobDto(client: PoolClient, actor: Actor, row: JobRow) { const counts = await countsFor(client, row.id), canRun = (canWorkspace)(actor.role, row.kind, "data") && (canWorkspace)(actor.role, row.kind, row.collection), editable = row.kind === "import" && ["preview", "paused"].includes(row.state); return { id: row.id, kind: row.kind, collection: row.collection, name: row.name, state: row.state, version: row.version, rowCount: row.row_count, counts, lastError: row.last_error, createdBy: row.created_by, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), completedAt: row.completed_at?.toISOString() || null, capabilities: { start: canRun && row.state === "preview" && !counts.invalid && !counts.failed && counts.ready > 0, pause: canRun && ["queued", "running"].includes(row.state), resume: canRun && row.state === "paused" && !counts.invalid && !counts.failed && counts.ready > 0, cancel: canRun && ["preview", "queued", "running", "paused"].includes(row.state), download: canRun && row.kind === "export" && row.state === "completed", editRows: canRun && editable } }; }
function capabilities(actor: Actor) { return { collections: ["contacts", "leads"].filter(collection => (canWorkspace)(actor.role, "view", collection)), limits: { csvBytes: MAX_BYTES, rows: MAX_ROWS, pageRows: PAGE_ROWS }, columns: [...CRM_CSV_COLUMNS], mode: "create-only", formulaSafeExports: true }; }
function rowDto(row: TransferRow) { return { number: row.row_number, version: row.version, state: row.state, values: unpack(row), issues: row.issues, recordId: row.source_record_id, processedAt: row.processed_at?.toISOString() || null }; }
async function checkSourceScope(client: PoolClient, actor: Actor, job: JobRow) { const sources = (await client.query<{data:WorkspaceRecord|null;deleted_at:Date|null}>("SELECT w.data,w.deleted_at FROM crm_transfer_rows t LEFT JOIN workspace_entities w ON w.bucket=t.record_bucket AND w.id=t.source_record_id WHERE t.job_id=$1 AND t.source_record_id IS NOT NULL", [job.id])).rows; (assert)(sources.every(row => row.data && !row.deleted_at && row.data.collection === job.collection && (readableRecord)(actor, row.data)), 409, "TRANSFER_SCOPE_CHANGED", "Current access no longer covers every source in this private transfer."); }
async function knownKeys(client: PoolClient, actorId: string, collection: string, values: CsvValues[]): Promise<Set<string>> { const hashes = [...new Set(values.map(value => keyHash(value.external_id || "")))]; return new Set((await client.query("SELECT external_key_hash FROM crm_import_external_keys WHERE created_by=$1 AND collection=$2 AND external_key_hash=ANY($3::text[])", [actorId, collection, hashes])).rows.map(row => row.external_key_hash)); }
function validateRows(values: CsvValues[], known: Set<string>) {
    const frequencies = new Map<string,number>;
    for (const value of values) {
        const key = keyHash(value.external_id || "");
        frequencies.set(key, (frequencies.get(key) || 0) + 1);
    }
    return values.map(value => {
        const errors = validateCrmCsvValues(value), key = keyHash(value.external_id || "");
        if ((frequencies.get(key) || 0) > 1)
            errors.push(issue("external_id", "DUPLICATE_EXTERNAL_ID", "This external identity appears more than once in the file."));
        if (known.has(key))
            errors.push(issue("external_id", "EXTERNAL_ID_EXISTS", "This importer has already used that identity in this collection."));
        return errors;
    });
}
async function listCrmTransfers(actor: Actor) {
    return (transaction)(async (client) => {
        actor = await transferActor(actor, "view", void 0, client);
        const rows = (await client.query<JobRow>("SELECT * FROM crm_transfer_jobs WHERE created_by=$1" + (isAdmin(actor) ? " OR true" : "") + " ORDER BY created_at DESC,id LIMIT 50", [actor.id])).rows.filter(row => (canWorkspace)(actor.role, "view", row.collection));
        const items = [];
        for (const row of rows)
            items.push(await jobDto(client, actor, row));
        return { items, capabilities: capabilities(actor) };
    });
}
async function getCrmTransfer(actor: Actor, id: string) { return (transaction)(async (client) => { actor = await transferActor(actor, "view", void 0, client); return jobDto(client, actor, await jobFor(client, actor, id)); }); }
async function createCrmImport(actor: Actor, body: unknown) {
    const input = (parse)(createImportSchema, body), values = parseCrmCsv(input.csvText);
    await (rateLimit)("crm-import-create:" + actor.id, 20, 3600);
    return (transaction)(async (client) => {
        actor = await transferActor(actor, "import", input.collection, client);
        const digest = (hash)(input.csvText), jobId = (randomUUID)();
        const inserted = await client.query<JobRow>("INSERT INTO crm_transfer_jobs(id,kind,collection,name,source_hash,state,row_count,created_by) VALUES($1,'import',$2,$3,$4,'preview',$5,$6) ON CONFLICT(created_by,collection,source_hash) WHERE kind='import' DO NOTHING RETURNING *", [jobId, input.collection, input.name, digest, values.length, actor.id]);
        if (!inserted.rowCount) {
            const old = (await client.query<JobRow>("SELECT * FROM crm_transfer_jobs WHERE kind='import' AND created_by=$1 AND collection=$2 AND source_hash=$3", [actor.id, input.collection, digest])).rows[0];
            (assert)(old, 409, "TRANSFER_CONFLICT", "The import is changing; retry the same request.");
            return jobDto(client, actor, old);
        }
        const errors = validateRows(values, await knownKeys(client, actor.id, input.collection, values));
        for (let index = 0; index < values.length; index++)
            await client.query<TransferRow>("INSERT INTO crm_transfer_rows(job_id,row_number,state,payload,issues,planned_record_id) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)", [jobId, index + 1, errors[index].length ? "invalid" : "ready", packed(values[index]), JSON.stringify(errors[index]), "import-" + (randomUUID)()]);
        await (audit)(actor.id, "crm.import.previewed", "crm_transfer", jobId, { collection: input.collection, rows: values.length, invalid: errors.filter(value => value.length).length, sourceHash: digest }, client);
        return jobDto(client, actor, inserted.rows[0]);
    });
}
async function allRecords(client: PoolClient, collections: string[]) { const rows = (await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("SELECT data FROM workspace_entities WHERE bucket='records' AND deleted_at IS NULL AND collection=ANY($1::text[]) ORDER BY id LIMIT 20001", [collections])).rows; (assert)(rows.length <= 2e4, 422, "CRM_DIRECTORY_LIMIT", "This bounded operation requires a smaller collection or explicit record selection."); return rows.map(row => row.data); }
async function createCrmExport(actor: Actor, body: unknown) {
    const input = (parse)(createExportSchema, body);
    await (rateLimit)("crm-export-create:" + actor.id, 20, 3600);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await transferActor(actor, "export", input.collection, client);
        let records: WorkspaceRecord[];
        if (input.recordIds) {
            (assert)(new Set(input.recordIds).size === input.recordIds.length, 422, "EXPORT_SELECTION", "Select each record once.");
            records = (await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("SELECT data FROM workspace_entities WHERE bucket='records' AND deleted_at IS NULL AND id=ANY($1::text[]) ORDER BY id", [input.recordIds])).rows.map(row2 => row2.data);
            (assert)(records.length === input.recordIds.length && records.every(record => record.collection === input.collection && (readableRecord)(actor, record)), 404, "EXPORT_SELECTION", "At least one selected record is unavailable in your current scope.");
        }
        else
            records = (await allRecords(client, [input.collection])).filter(record => (readableRecord)(actor, record));
        (assert)(records.length > 0 && records.length <= MAX_ROWS, 422, "EXPORT_ROWS", "Select from 1 to 2000 currently accessible records.");
        const jobId = (randomUUID)(), row = (await client.query<JobRow>("INSERT INTO crm_transfer_jobs(id,kind,collection,name,source_hash,state,row_count,created_by) VALUES($1,'export',$2,$3,$4,'queued',$5,$6) RETURNING *", [jobId, input.collection, input.name, (hash)(JSON.stringify(records.map(record => record.id))), records.length, actor.id])).rows[0];
        for (let index = 0; index < records.length; index++)
            await client.query<TransferRow>("INSERT INTO crm_transfer_rows(job_id,row_number,state,payload,planned_record_id,source_record_id) VALUES($1,$2,'ready',$3::jsonb,$4,$4)", [jobId, index + 1, packed({}), records[index].id]);
        await (audit)(actor.id, "crm.export.queued", "crm_transfer", jobId, { collection: input.collection, rows: records.length }, client);
        return jobDto(client, actor, row);
    });
}
async function listCrmTransferRows(actor: Actor, id: string, options: {after?:number} = {}) {
    const after = options.after ?? 0;
    (assert)(Number.isInteger(after) && after >= 0 && after <= MAX_ROWS, 422, "TRANSFER_CURSOR", "Use a row cursor from 0 to 2000.");
    return (transaction)(async (client) => {
        actor = await transferActor(actor, "view", void 0, client);
        const job = await jobFor(client, actor, id);
        await checkSourceScope(client, actor, job);
        const rows = (await client.query<TransferRow>("SELECT * FROM crm_transfer_rows WHERE job_id=$1 AND row_number>$2 ORDER BY row_number LIMIT 51", [id, after])).rows, items = [];
        let bytes = 0;
        for (const row of rows.slice(0, PAGE_ROWS)) {
            const item = rowDto(row), size = Buffer.byteLength(JSON.stringify(item));
            if (items.length && bytes + size > 2 * 1024 * 1024)
                break;
            items.push(item);
            bytes += size;
        }
        return { job: await jobDto(client, actor, job), items, nextAfter: rows.length > items.length ? items.at(-1)!.number : null };
    });
}
async function updateCrmTransferRow(actor: Actor, id: string, rowNumber: number, body: unknown, version: number) {
    (assert)(Number.isInteger(rowNumber) && rowNumber >= 1 && rowNumber <= MAX_ROWS, 404, "NOT_FOUND", "Transfer row not found.");
    const input = (parse)(z.object({ values: valuesSchema }).strict(), body), values = Object.fromEntries(CRM_CSV_COLUMNS.map(column => [column, (input.values[column] || "").trim()]));
    return (transaction)(async (client) => {
        actor = await transferActor(actor, "view", void 0, client);
        let job = await jobFor(client, actor, id, true);
        actor = await transferActor(actor, "import", job.collection, client);
        (assert)(job.kind === "import" && ["preview", "paused"].includes(job.state), 409, "TRANSFER_EDIT_STATE", "Only a paused or previewed import may be edited.");
        await checkSourceScope(client, actor, job);
        const rows = (await client.query<TransferRow>("SELECT * FROM crm_transfer_rows WHERE job_id=$1 ORDER BY row_number FOR UPDATE", [id])).rows, target = rows.find(row => row.row_number === rowNumber);
        (assert)(target, 404, "NOT_FOUND", "Transfer row not found.");
        conflict(version, target.version);
        (assert)(!["applied", "exported"].includes(target.state), 409, "TRANSFER_ROW_IMMUTABLE", "An applied row is immutable. A correction requires the normal CRM workflow.");
        const all = rows.map(row => row === target ? values : unpack(row)), errors = validateRows(all, await knownKeys(client, job.created_by, job.collection, all));
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            if (["applied", "exported"].includes(row.state) || row.state === "failed" && row !== target)
                continue;
            const nextState = errors[index].length ? "invalid" : "ready";
            if (row !== target && row.state === nextState && JSON.stringify(row.issues) === JSON.stringify(errors[index]))
                continue;
            await client.query<TransferRow>("UPDATE crm_transfer_rows SET payload=$3::jsonb,issues=$4::jsonb,state=$5,version=version+1 WHERE job_id=$1 AND row_number=$2", [id, row.row_number, packed(all[index]), JSON.stringify(errors[index]), nextState]);
        }
        job = (await client.query<JobRow>("UPDATE crm_transfer_jobs SET version=version+1,updated_at=now(),last_error=NULL WHERE id=$1 RETURNING *", [id])).rows[0];
        await (audit)(actor.id, "crm.import.row.edited", "crm_transfer", id, { rowNumber }, client);
        return { job: await jobDto(client, actor, job), row: rowDto((await client.query<TransferRow>("SELECT * FROM crm_transfer_rows WHERE job_id=$1 AND row_number=$2", [id, rowNumber])).rows[0]) };
    });
}
async function commandCrmTransfer(actor: Actor, id: string, body: unknown, version: number) {
    const input = (parse)(commandSchema, body);
    return (transaction)(async (client) => {
        actor = await transferActor(actor, "view", void 0, client);
        const old = await jobFor(client, actor, id, true);
        actor = await transferActor(actor, old.kind, old.collection, client);
        conflict(version, old.version);
        let state;
        if (input.action === "start" || input.action === "resume") {
            (assert)(old.state === (input.action === "start" ? "preview" : "paused"), 409, "TRANSFER_STATE", "The requested transition is unavailable.");
            await creatorActor(client, old);
            await checkSourceScope(client, actor, old);
            const counts = await countsFor(client, id);
            (assert)(counts.invalid === 0 && counts.failed === 0 && counts.ready > 0, 409, "TRANSFER_INVALID_ROWS", "Resolve every invalid or failed row before execution.");
            if (input.action === "start")
                (assert)(input.confirmRows === old.row_count, 422, "TRANSFER_CONFIRM_ROWS", "Confirm the exact reviewed row count before importing.");
            state = "queued";
        }
        else {
            (assert)((input.action === "pause" ? ["queued", "running"] : ["preview", "queued", "running", "paused"]).includes(old.state), 409, "TRANSFER_STATE", "The requested transition is unavailable.");
            state = input.action === "pause" ? "paused" : "cancelled";
        }
        const row = (await client.query<JobRow>("UPDATE crm_transfer_jobs SET state=$2,version=version+1,last_error=NULL,updated_at=now(),completed_at=CASE WHEN $2='cancelled' THEN now() ELSE NULL END WHERE id=$1 RETURNING *", [id, state])).rows[0];
        await (audit)(actor.id, "crm.transfer." + input.action, "crm_transfer", id, { reason: input.reason, appliedRows: (await countsFor(client, id)).applied }, client);
        return jobDto(client, actor, row);
    });
}
function recordFromValues(job: JobRow, row: TransferRow, actor: Actor, values: CsvValues): WorkspaceRecord { return { id: row.planned_record_id, collection: job.collection, title: Object.fromEntries(LOCALES.map(locale => [locale, values["title_" + locale]])) as WorkspaceRecord['title'], summary: Object.fromEntries(LOCALES.map(locale => [locale, values["summary_" + locale] || ""])) as WorkspaceRecord['summary'], status: "new", owner: actor.role, ownerId: actor.id, createdAt: job.created_at.toISOString(), updatedAt: job.created_at.toISOString(), tags: [...new Set((values.tags || "").split(";").map(tag => tag.trim()).filter(Boolean))], demo: false, history: [], ...values.email ? { email: values.email } : {}, ...values.organization ? { organization: values.organization } : {}, details: { ...values.phone ? { phone: values.phone } : {}, import: { jobId: job.id, rowNumber: row.row_number, externalKeyHash: keyHash(values.external_id) } } }; }
async function exportValues(client: PoolClient, actor: Actor, job: JobRow, row: TransferRow) {
    const source = (await client.query<PgRow<'workspace_entities',{data:WorkspaceRecord}>>("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1 AND deleted_at IS NULL", [row.source_record_id])).rows[0]?.data;
    (assert)(source && source.collection === job.collection && (readableRecord)(actor, source), 403, "TRANSFER_SCOPE_CHANGED", "The source is no longer available in the creator\u2019s current scope.");
    const record = (redactCrmRecord)(actor, source), origin = (await client.query<TransferRow>("SELECT t.* FROM crm_transfer_rows t JOIN crm_transfer_jobs j ON j.id=t.job_id WHERE t.source_record_id=$1 AND t.state='applied' AND j.created_by=$2 ORDER BY t.processed_at LIMIT 1", [source.id, actor.id])).rows[0];
    return Object.fromEntries(CRM_CSV_COLUMNS.map(column => {
        let value = "";
        if (column === "external_id")
            value = origin ? unpack(origin).external_id : source.id;
        else if (column.startsWith("title_"))
            value = record.title[column.slice(6) as Locale] || "";
        else if (column.startsWith("summary_"))
            value = record.summary[column.slice(8) as Locale] || "";
        else if (column === "tags")
            value = record.tags.join(";");
        else if (column === "phone")
            value = typeof record.details?.phone === "string" ? record.details.phone : "";
        else
            value = typeof record[column as keyof WorkspaceRecord] === "string" ? String(record[column as keyof WorkspaceRecord]) : "";
        return [column, value];
    }));
}
async function runCrmTransfers(limit = 25) {
    (assert)(Number.isInteger(limit) && limit >= 1 && limit <= 100, 422, "TRANSFER_BATCH", "Choose a worker batch from 1 to 100.");
    let applied = 0, exported = 0, paused = 0;
    for (let index = 0; index < limit; index++) {
        const result = await (transaction)(async (client) => {
            await (lockWorkspace)(client);
            const job = (await client.query<JobRow>("SELECT * FROM crm_transfer_jobs WHERE state IN ('queued','running') ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
            if (!job)
                return null;
            await client.query("SAVEPOINT transfer_row");
            let row: TransferRow | undefined;
            try {
                const actor = await creatorActor(client, job);
                row = (await client.query<TransferRow>("SELECT * FROM crm_transfer_rows WHERE job_id=$1 AND state='ready' ORDER BY row_number FOR UPDATE SKIP LOCKED LIMIT 1", [job.id])).rows[0];
                if (!row) {
                    const counts = await countsFor(client, job.id);
                    const failed = counts.failed + counts.invalid > 0;
                    await client.query<JobRow>("UPDATE crm_transfer_jobs SET state=$2,version=version+1,last_error=$3,updated_at=now(),completed_at=CASE WHEN $2='completed' THEN now() ELSE NULL END WHERE id=$1", [job.id, failed ? "paused" : "completed", failed ? "TRANSFER_INVALID_ROWS" : null]);
                    return failed ? "paused" : "complete";
                }
                if (job.kind === "import") {
                    const values = unpack(row), errors = validateCrmCsvValues(values);
                    if (errors.length)
                        throw new HttpError(422, "TRANSFER_INVALID_ROWS", "The row needs review before import.", errors);
                    (assert)(!(await knownKeys(client, job.created_by, job.collection, [values])).size, 409, "EXTERNAL_ID_EXISTS", "This importer has already used that external identity.");
                    const created = await (importCrmWorkspaceRecord)(client, actor, recordFromValues(job, row, actor, values));
                    await client.query("INSERT INTO crm_import_external_keys(created_by,collection,external_key_hash,record_id,job_id,row_number) VALUES($1,$2,$3,$4,$5,$6)", [job.created_by, job.collection, keyHash(values.external_id), created.id, job.id, row.row_number]);
                    await client.query<TransferRow>("UPDATE crm_transfer_rows SET state='applied',source_record_id=$3,processed_at=now(),version=version+1 WHERE job_id=$1 AND row_number=$2", [job.id, row.row_number, created.id]);
                }
                else {
                    const values = await exportValues(client, actor, job, row), payload = packed(values), stored = Number((await client.query("SELECT coalesce(sum(octet_length(payload::text)),0)::text AS bytes FROM crm_transfer_rows WHERE job_id=$1 AND state='exported'", [job.id])).rows[0].bytes);
                    (assert)(stored + Buffer.byteLength(payload) <= 24 * 1024 * 1024, 413, "EXPORT_SIZE", "The export exceeds its 24 MiB encrypted-row budget. Select fewer records.");
                    await client.query<TransferRow>("UPDATE crm_transfer_rows SET state='exported',payload=$3::jsonb,processed_at=now(),version=version+1 WHERE job_id=$1 AND row_number=$2", [job.id, row.row_number, payload]);
                }
                const pending = (await client.query<TransferRow>("SELECT 1 FROM crm_transfer_rows WHERE job_id=$1 AND state NOT IN ('applied','exported') LIMIT 1", [job.id])).rowCount;
                await client.query<JobRow>("UPDATE crm_transfer_jobs SET state=$2,version=version+1,last_error=NULL,updated_at=now(),completed_at=CASE WHEN $2='completed' THEN now() ELSE NULL END WHERE id=$1", [job.id, pending ? "running" : "completed"]);
                await (audit)(actor.id, "crm.transfer.row." + (job.kind === "import" ? "applied" : "exported"), "crm_transfer", job.id, { rowNumber: row.row_number, recordId: row.planned_record_id }, client);
                return job.kind === "import" ? "applied" : "exported";
            }
            catch (error) {
                await client.query("ROLLBACK TO SAVEPOINT transfer_row");
                if (!(error instanceof HttpError && error.status < 500))
                    throw error;
                if (row)
                    await client.query<TransferRow>("UPDATE crm_transfer_rows SET state='failed',issues=$3::jsonb,version=version+1 WHERE job_id=$1 AND row_number=$2 AND state='ready'", [job.id, row.row_number, JSON.stringify([issue("row", error.code, error.message.slice(0, 500))])]);
                await client.query<JobRow>("UPDATE crm_transfer_jobs SET state='paused',last_error=$2,version=version+1,updated_at=now() WHERE id=$1", [job.id, error.code]);
                await (audit)(null, "crm.transfer.paused", "crm_transfer", job.id, { code: error.code, rowNumber: row?.row_number ?? null }, client);
                return "paused";
            }
        });
        if (result === null)
            break;
        if (result === "applied")
            applied++;
        if (result === "exported")
            exported++;
        if (result === "paused")
            paused++;
    }
    return { applied, exported, paused };
}
async function downloadCrmTransfer(actor: Actor, id: string) { return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await transferActor(actor, "view", void 0, client); const job = await jobFor(client, actor, id); actor = await transferActor(actor, "export", job.collection, client); (assert)(job.kind === "export" && job.state === "completed", 409, "EXPORT_NOT_READY", "The export must complete before downloading."); await checkSourceScope(client, actor, job); const rows = (await client.query<TransferRow>("SELECT * FROM crm_transfer_rows WHERE job_id=$1 ORDER BY row_number", [id])).rows; (assert)(rows.length === job.row_count && rows.every(row => row.state === "exported"), 409, "EXPORT_NOT_READY", "The export is incomplete."); const csv = encodeCrmCsv(rows.map(unpack)); (assert)(Buffer.byteLength(csv, "utf8") <= 32 * 1024 * 1024, 413, "EXPORT_SIZE", "This export exceeds the 32 MiB private download limit."); await (audit)(actor.id, "crm.export.downloaded", "crm_transfer", id, { rows: rows.length }, client); return { filename: "idealmakoo-" + job.collection + "-" + job.id + ".csv", csv }; }); }
async function searchCrmRecords(actor: Actor, options: {q:unknown;collections?:string[]}) { const text = clean(2, 100).safeParse(options.q); (assert)(text.success, 422, "CRM_SEARCH", "Use a search phrase from 2 to 100 characters."); const collections = options.collections ?? ["leads", "contacts", "accounts", "opportunities", "tickets", "samples", "partners"]; (assert)(collections.length >= 1 && collections.length <= 10 && new Set(collections).size === collections.length && collections.every(collection => crmCollections.has(collection)), 422, "CRM_SEARCH_COLLECTIONS", "Choose supported CRM collections."); return (transaction)(async (client) => { actor = await (loadCrmAccess)(actor, client); (assert)(actor.role !== "customer" && actor.mfaVerified && actor.crmAccess?.permissions.contact, 403, "CRM_SEARCH_PERMISSION", "Staff CRM search requires current MFA and contact access."); const allowed = collections.filter(collection => (canWorkspace)(actor.role, "view", collection)); (assert)(allowed.length > 0, 403, "CRM_SEARCH_PERMISSION", "No requested collection is available."); const phrase = text.data.normalize("NFKC").toLocaleLowerCase("en-US"), matched = (await allRecords(client, allowed)).filter(record => (readableRecord)(actor, record)).map(record => (redactCrmRecord)(actor, record)).filter(record => [...Object.values(record.title), ...Object.values(record.summary), record.organization || "", record.email || "", ...record.tags].join(" ").normalize("NFKC").toLocaleLowerCase("en-US").includes(phrase)); return { items: matched.slice(0, 50).map(record => ({ id: record.id, collection: record.collection, title: record.title, summary: record.summary, requestId: record.requestId || null })), matched: matched.length, limit: 50, scope: "current-staff-crm" }; }); }
export { CRM_CSV_COLUMNS, commandCrmTransfer, createCrmExport, createCrmImport, downloadCrmTransfer, encodeCrmCsv, getCrmTransfer, listCrmTransferRows, listCrmTransfers, parseCrmCsv, runCrmTransfers, safeCrmCsvCell, searchCrmRecords, updateCrmTransferRow, validateCrmCsvValues };
