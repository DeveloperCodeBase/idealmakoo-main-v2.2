import type {KnowledgeEntry} from '../../worker/ai-handler';
import type {PgRow} from './recovered-db-rows';
type EmbeddingCapability=ReturnType<typeof knowledgeCapability>;
export interface KnowledgeGuard {id:string;hash:string}
interface EmbeddingResponse {model?:unknown;data?:unknown;usage?:Record<string,unknown>;id?:unknown}
import type { Locale } from '../lib/i18n';
import type { PoolClient } from 'pg';
import type { Actor } from './types';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { assert, HttpError } from "./types";
import { hash } from "./crypto";
import { publicKnowledge } from "./public-knowledge";
import { loadCrmAccess } from "./workspace-scopes";
import { canWorkspace } from "../lib/auth";
import { parse, rateLimit } from "./http";
import { transaction, audit, query } from "./db";
import { randomUUID } from "node:crypto";
import { reserveAi } from "./ai-budget";
import { config } from "./config";
import { retrieveKnowledge } from "../../worker/ai-handler";
const SOURCE_LIMIT = 2e3, CHUNK_LIMIT = 12e3, BATCH_SIZE = 12;
const localeSchema = z.enum(["fa", "en", "tr", "ar", "ru"]);
const queueSchema = z.object({ locale: localeSchema, sourceIds: z.array(z.string().min(1).max(240)).min(1).max(100).optional(), retryFailed: z.boolean().default(false), acknowledgeUncertain: z.boolean().default(false) }).strict();
function knowledgeCapability() { const model = process.env.RAG_EMBEDDING_MODEL || "", raw = Number(process.env.RAG_EMBEDDING_DIMENSIONS || 768), valid = [768, 1024, 1536].includes(raw); return { enabled: process.env.RAG_ENABLED === "true", configured: !!process.env.OPENROUTER_API_KEY && /^[a-zA-Z0-9._:/-]{1,200}$/.test(model) && valid, provider: "openrouter", model, dimensions: valid ? raw : 768 }; }
function embeddingConfig() { const value = knowledgeCapability(); (assert)(value.enabled && value.configured, 503, "KNOWLEDGE_NOT_CONFIGURED", "Enable RAG with a compatible embedding model, dimensions and provider credential on the server."); return value; }
const knowledgeSourceHash = (entry: KnowledgeEntry) => (hash)(JSON.stringify([entry.id, entry.title, entry.url, entry.kind, entry.sourceUrl || "", entry.text]));
function chunkKnowledgeText(value: string) {
    const text = value.replace(/\u0000/g, "").normalize("NFC").trim();
    (assert)(text.length > 0 && text.length <= 12e4, 422, "KNOWLEDGE_SOURCE_SIZE", "A public source must contain between 1 and 120,000 characters.");
    const chunks = [];
    let offset = 0;
    while (offset < text.length) {
        let end = Math.min(offset + 1500, text.length);
        if (end < text.length) {
            const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(" ", end));
            if (boundary > offset + 1e3)
                end = boundary;
        }
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]))
            end--;
        const part = text.slice(offset, end).trim();
        if (part)
            chunks.push(part);
        if (end === text.length)
            break;
        offset = Math.max(offset + 1, end - 120);
        if (/[\uDC00-\uDFFF]/.test(text[offset]))
            offset++;
    }
    (assert)(chunks.length <= 120, 422, "KNOWLEDGE_SOURCE_SIZE", "This source exceeds the bounded indexing profile.");
    return chunks;
}
async function sources(locale: Locale, client?: PoolClient) {
    const entries = (await (publicKnowledge)(locale, client)).filter(entry => entry.text.trim());
    (assert)(entries.length <= SOURCE_LIMIT, 422, "KNOWLEDGE_SOURCE_LIMIT", "The public source directory exceeds the reviewed online indexing limit.");
    const seen = new Set;
    for (const entry of entries) {
        (assert)(!seen.has(entry.id) && entry.id.length <= 240 && entry.title.length > 0 && entry.title.length <= 2e3 && entry.kind.length <= 80 && entry.url.startsWith("/" + locale + "/") && entry.url.length <= 1e3, 503, "KNOWLEDGE_SOURCE_INVALID", "A public source needs operator review before indexing.");
        seen.add(entry.id);
    }
    return entries;
}
async function workspaceLock(client: PoolClient) { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE"); }
async function authorize(actor: Actor, locale: Locale, client: PoolClient, write = false) { const current = await (loadCrmAccess)(actor, client); (assert)(current.mfaVerified && (canWorkspace)(current.role, write ? "create" : "view", "ai"), 403, "FORBIDDEN", "Knowledge indexing is restricted to current editorial staff."); (assert)(current.allowedLocales.includes(locale), 403, "LOCALE_SCOPE", "This language is outside your editorial scope."); return current; }
function sourceView(row: PgRow<'knowledge_sources'>, current: Map<string,string>, indexed: number, job?: Pick<PgRow<'knowledge_ingestion_jobs'>,'id'|'state'|'version'|'error_code'>) { const known = current.get(row.source_id); return { id: row.id, sourceId: row.source_id, title: row.title, url: row.url, kind: row.kind, sourceHash: row.source_hash, model: row.model, dimensions: row.dimensions, state: !known ? "withdrawn" : known !== row.source_hash ? "stale" : row.state, version: row.version, chunks: row.chunk_count, indexedChunks: indexed, updatedAt: new Date(row.updated_at).toISOString(), ...job ? { job: { id: job.id, state: job.state, version: job.version, errorCode: job.error_code } } : {} }; }
async function getKnowledgeIndex(actor: Actor, localeInput: unknown) {
    const locale = (parse)(localeSchema, localeInput), capability = knowledgeCapability();
    return (transaction)(async (client) => {
        await workspaceLock(client);
        await authorize(actor, locale, client);
        const available = await sources(locale, client), current = new Map(available.map(entry => [entry.id, knowledgeSourceHash(entry)]));
        const rows = (await client.query(`SELECT s.*,count(c.embedding)::int AS indexed,j.id AS job_id,j.state AS job_state,j.version AS job_version,j.error_code AS job_error
      FROM knowledge_sources s LEFT JOIN knowledge_chunks c ON c.source_id=s.id
      LEFT JOIN LATERAL (SELECT id,state,version,error_code FROM knowledge_ingestion_jobs WHERE source_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1) j ON true
      WHERE s.locale=$1 GROUP BY s.id,j.id,j.state,j.version,j.error_code ORDER BY s.updated_at DESC,s.source_id LIMIT $2`, [locale, SOURCE_LIMIT])).rows;
        const items = rows.map(row => { const item = sourceView(row, current, row.indexed, row.job_id ? { id: row.job_id, state: row.job_state, version: row.job_version, error_code: row.job_error } : void 0); return row.model !== capability.model || row.dimensions !== capability.dimensions ? { ...item, state: "stale" } : item; });
        return { locale, capability, availableSources: available.length, sourceLimit: SOURCE_LIMIT, items, indexedSources: items.filter(row => row.state === "ready").length, pendingSources: items.filter(row => ["pending", "indexing"].includes(row.state)).length, staleSources: items.filter(row => ["stale", "withdrawn"].includes(row.state)).length };
    });
}
async function enqueueKnowledgeIndex(actor: Actor, input: unknown) {
    const body = (parse)(queueSchema, input), capability = embeddingConfig();
    await (rateLimit)("knowledge-index:" + actor.id, 12, 3600);
    return (transaction)(async (client) => {
        await workspaceLock(client);
        actor = await authorize(actor, body.locale, client, true);
        const available = await sources(body.locale, client), all = new Map(available.map(entry => [entry.id, entry]));
        if (body.sourceIds)
            (assert)(body.sourceIds.every(id => all.has(id)), 404, "KNOWLEDGE_SOURCE_NOT_FOUND", "Select only currently published sources in this language.");
        const selected = body.sourceIds ? [...new Set(body.sourceIds)].map(id => all.get(id)!) : available;
        const plans = selected.map(entry => ({ entry, chunks: chunkKnowledgeText(entry.text), sourceHash: knowledgeSourceHash(entry) }));
        (assert)(plans.reduce((sum, plan) => sum + plan.chunks.length, 0) <= CHUNK_LIMIT, 422, "KNOWLEDGE_CHUNK_LIMIT", "The selected source set exceeds the reviewed chunk limit.");
        const previous = (await client.query<PgRow<'knowledge_sources'>>("SELECT * FROM knowledge_sources WHERE locale=$1 AND model=$2 AND dimensions=$3 FOR UPDATE", [body.locale, capability.model, capability.dimensions])).rows;
        const bySource = new Map(previous.map(row => [row.source_id, row]));
        let queued = 0, unchanged = 0, alreadyPending = 0, needsReview = 0;
        for (const old of previous.filter(row => !all.has(row.source_id) && row.state !== "withdrawn")) {
            await client.query("UPDATE knowledge_ingestion_jobs SET state='cancelled',version=version+1,completed_at=now(),updated_at=now(),error_code='SOURCE_WITHDRAWN' WHERE source_id=$1 AND state IN ('pending','running')", [old.id]);
            await client.query("DELETE FROM knowledge_chunks WHERE source_id=$1", [old.id]);
            await client.query("UPDATE knowledge_sources SET state='withdrawn',source_text='[withdrawn]',version=version+1,updated_at=now() WHERE id=$1", [old.id]);
        }
        for (const plan of plans) {
            let row = bySource.get(plan.entry.id);
            const same = row?.source_hash === plan.sourceHash;
            if (same && row?.state === "ready") {
                unchanged++;
                continue;
            }
            if (same && row && ["pending", "indexing"].includes(row.state)) {
                alreadyPending++;
                continue;
            }
            if (same && row && ["failed", "uncertain"].includes(row.state) && !body.retryFailed) {
                needsReview++;
                continue;
            }
            if (same && row?.state === "uncertain")
                (assert)(body.acknowledgeUncertain, 409, "KNOWLEDGE_UNCERTAIN", "Review the retained embedding reservation and explicitly acknowledge the uncertain previous call before retrying.");
            if (row) {
                await client.query("UPDATE knowledge_ingestion_jobs SET state='cancelled',version=version+1,completed_at=now(),updated_at=now(),error_code=COALESCE(error_code,'SOURCE_REINDEXED') WHERE source_id=$1 AND state IN ('pending','running')", [row.id]);
                if (!same)
                    await client.query("DELETE FROM knowledge_chunks WHERE source_id=$1", [row.id]);
                row = (await client.query<PgRow<'knowledge_sources'>>(`UPDATE knowledge_sources SET source_hash=$2,title=$3,url=$4,kind=$5,source_url=$6,source_text=$7,state='pending',chunk_count=$8,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [row.id, plan.sourceHash, plan.entry.title, plan.entry.url, plan.entry.kind, plan.entry.sourceUrl || null, plan.entry.text, plan.chunks.length])).rows[0];
            }
            else {
                row = (await client.query<PgRow<'knowledge_sources'>>(`INSERT INTO knowledge_sources(id,locale,source_id,source_hash,title,url,kind,source_url,source_text,model,dimensions,chunk_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [(randomUUID)(), body.locale, plan.entry.id, plan.sourceHash, plan.entry.title, plan.entry.url, plan.entry.kind, plan.entry.sourceUrl || null, plan.entry.text, capability.model, capability.dimensions, plan.chunks.length])).rows[0];
            }
            const chunks = plan.chunks.map((content, ordinal) => ({ id: (randomUUID)(), ordinal, content, content_hash: (hash)(content) }));
            await client.query(`INSERT INTO knowledge_chunks(id,source_id,ordinal,content,content_hash,dimensions,model) SELECT x.id,$1,x.ordinal,x.content,x.content_hash,$2,$3 FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,ordinal integer,content text,content_hash text) ON CONFLICT(source_id,ordinal) DO NOTHING`, [row.id, capability.dimensions, capability.model, JSON.stringify(chunks)]);
            await client.query("INSERT INTO knowledge_ingestion_jobs(id,source_id,source_version,source_hash,created_by) VALUES($1,$2,$3,$4,$5)", [(randomUUID)(), row.id, row.version, plan.sourceHash, actor.id]);
            queued++;
        }
        const total = Number((await client.query("SELECT count(*)::int AS count FROM knowledge_chunks")).rows[0].count);
        (assert)(total <= CHUNK_LIMIT * 5, 422, "KNOWLEDGE_CHUNK_LIMIT", "The global knowledge index quota is full. Remove obsolete model indexes before adding more.");
        await (audit)(actor.id, "knowledge.index.queued", "knowledge_locale", body.locale, { queued, unchanged, alreadyPending, needsReview, model: capability.model, dimensions: capability.dimensions }, client);
        return { queued, unchanged, alreadyPending, needsReview };
    });
}
async function cancelKnowledgeJob(actor: Actor, id: string, expectedVersion: number) { (assert)(z.string().uuid().safeParse(id).success, 404, "NOT_FOUND", "Indexing job not found."); return (transaction)(async (client) => { await workspaceLock(client); const row = (await client.query("SELECT j.*,s.locale FROM knowledge_ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.id=$1 FOR UPDATE OF s,j", [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Indexing job not found."); actor = await authorize(actor, row.locale, client, true); (assert)(row.version === expectedVersion, 409, "VERSION_CONFLICT", "Reload the indexing job before changing it."); (assert)(row.state === "pending", 409, "KNOWLEDGE_JOB_RUNNING", "Only a pending job can be cancelled; a running or uncertain provider call must be reviewed."); await client.query("UPDATE knowledge_ingestion_jobs SET state='cancelled',version=version+1,completed_at=now(),updated_at=now() WHERE id=$1", [id]); await client.query("UPDATE knowledge_sources SET state='failed',updated_at=now() WHERE id=$1 AND version=$2", [row.source_id, row.source_version]); await (audit)(actor.id, "knowledge.job.cancelled", "knowledge_job", id, {}, client); return { ok: true }; }); }
async function removeKnowledgeSource(actor: Actor, id: string, expectedVersion: number) { (assert)(z.string().uuid().safeParse(id).success, 404, "NOT_FOUND", "Indexed source not found."); return (transaction)(async (client) => { await workspaceLock(client); const row = (await client.query<PgRow<'knowledge_sources'>>("SELECT * FROM knowledge_sources WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Indexed source not found."); actor = await authorize(actor, row.locale, client, true); (assert)(row.version === expectedVersion, 409, "VERSION_CONFLICT", "Reload the indexed source before deleting it."); (assert)(!(await client.query("SELECT id FROM knowledge_ingestion_jobs WHERE source_id=$1 AND state='running'", [id])).rowCount, 409, "KNOWLEDGE_JOB_RUNNING", "Wait for the running provider call before removing this index."); await client.query("DELETE FROM knowledge_sources WHERE id=$1", [id]); await (audit)(actor.id, "knowledge.source.removed", "knowledge_source", id, { sourceId: row.source_id, locale: row.locale }, client); return { ok: true }; }); }
async function responseJson(response: Response) : Promise<EmbeddingResponse> {
    (assert)(response.body && Number(response.headers.get("content-length") || 0) <= 4 * 1024 * 1024, 502, "EMBEDDING_RESPONSE_SIZE", "The embedding response exceeds the supported size.");
    const reader = response.body.getReader(), parts = [];
    let total = 0;
    for (;;) {
        const row = await reader.read();
        if (row.done)
            break;
        total += row.value.length;
        if (total > 4 * 1024 * 1024) {
            await reader.cancel();
            throw new HttpError(502, "EMBEDDING_RESPONSE_SIZE", "The embedding response exceeds the supported size.");
        }
        parts.push(row.value);
    }
    try {
        return JSON.parse(Buffer.concat(parts).toString("utf8"));
    }
    catch {
        throw new HttpError(502, "EMBEDDING_RESPONSE_INVALID", "The embedding provider returned an invalid response.");
    }
}
async function embed(inputs: string[], capability: EmbeddingCapability, actor: Actor | null, visitor: string, mode: 'query'|'document', fetcher: typeof fetch, signal?: AbortSignal, reserved?: (usageId:string)=>Promise<void>) {
    (assert)(inputs.length > 0 && inputs.length <= BATCH_SIZE && inputs.every(value => value.length > 0 && value.length <= (mode === "query" ? 1e4 : 1600)), 422, "EMBEDDING_INPUT_SIZE", "The embedding input exceeds the supported batch size.");
    const usageId = await (reserveAi)(actor, visitor, "embedding-" + mode, capability.model, process.env.RAG_REQUEST_RESERVE_USD || "0.02", "openrouter");
    let sent = false;
    try {
        if (reserved)
            await reserved(usageId);
        signal?.throwIfAborted();
        sent = true;
        const response = await fetcher("https://openrouter.ai/api/v1/embeddings", { method: "POST", redirect: "error", headers: { "content-type": "application/json", "authorization": "Bearer " + process.env.OPENROUTER_API_KEY, "HTTP-Referer": (config)().siteUrl, "X-Title": "Ideal Makoo" }, body: JSON.stringify({ model: capability.model, input: inputs, dimensions: capability.dimensions, encoding_format: "float", input_type: mode === "query" ? "search_query" : "search_document" }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45e3)]) : AbortSignal.timeout(45e3) });
        if (!response.ok) {
            await response.body?.cancel();
            throw new HttpError(response.status === 429 ? 429 : 502, "EMBEDDING_PROVIDER", "The configured embedding provider did not complete this request.");
        }
        const data = await responseJson(response), rows = data.data;
        (assert)(data.model === capability.model && Array.isArray(rows) && rows.length === inputs.length, 502, "EMBEDDING_RESPONSE_INVALID", "The embedding model or result count did not match the request.");
        const values: Array<number[] | undefined> = Array.from({ length: inputs.length });
        for (const row of rows) {
            const item = row as {index:unknown;embedding:unknown};
            (assert)(Number.isInteger(item.index) && Number(item.index) >= 0 && Number(item.index) < inputs.length && !values[Number(item.index)] && Array.isArray(item.embedding) && item.embedding.length === capability.dimensions && item.embedding.every((value: unknown) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e5), 502, "EMBEDDING_RESPONSE_INVALID", "The embedding provider returned an invalid vector.");
            const vector = item.embedding as number[], norm = Math.hypot(...vector);
            (assert)(norm > 1e-12, 502, "EMBEDDING_RESPONSE_INVALID", "A zero embedding cannot be used for semantic retrieval.");
            values[Number(item.index)] = vector.map(value => value / norm);
        }
        (assert)(values.every(value => value), 502, "EMBEDDING_RESPONSE_INVALID", "The embedding response did not contain every requested vector.");
        const usage = data.usage && typeof data.usage === "object" ? data.usage : {};
        const tokens = Number.isSafeInteger(usage.total_tokens) && Number(usage.total_tokens) >= 0 ? Number(usage.total_tokens) : null;
        const cost = typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null;
        await (query)("UPDATE ai_usage SET state='complete',actual_usd=$2,tokens=$3,completed_at=now(),response_id=$4 WHERE id=$1 AND state='reserved'", [usageId, cost, tokens, typeof data.id === "string" ? data.id.slice(0, 200) : ""]);
        return { vectors: values as number[][], usageId };
    }
    catch (error) {
        await (query)("UPDATE ai_usage SET state=$2,completed_at=now() WHERE id=$1 AND state='reserved'", [usageId, sent ? "uncertain" : "failed"]);
        throw error;
    }
}
async function jobActor(id: string, locale: Locale, client: PoolClient) { (assert)(id, 403, "FORBIDDEN", "The indexing job needs its current editorial owner."); return authorize({ id, name: "", email: "", role: "customer", qualityScope: false, allowedLocales: [], mfaVerified: true }, locale, client, true); }
async function runKnowledgeIngestion(fetcher = fetch) {
    const capability = knowledgeCapability();
    if (!capability.enabled || !capability.configured)
        return false;
    await (transaction)(async (client) => {
        await workspaceLock(client);
        const expired = (await client.query("SELECT id,source_id,source_version,last_usage_id FROM knowledge_ingestion_jobs WHERE state='running' AND locked_at<now()-interval '3 minutes' FOR UPDATE")).rows;
        for (const row of expired) {
            await client.query("UPDATE knowledge_ingestion_jobs SET state='uncertain',version=version+1,error_code='WORKER_LEASE_EXPIRED',completed_at=now(),updated_at=now() WHERE id=$1", [row.id]);
            await client.query("UPDATE knowledge_sources SET state='uncertain',updated_at=now() WHERE id=$1 AND version=$2", [row.source_id, row.source_version]);
            if (row.last_usage_id)
                await client.query("UPDATE ai_usage SET state='uncertain',completed_at=now() WHERE id=$1 AND state='reserved'", [row.last_usage_id]);
        }
    });
    const lockToken = (randomUUID)();
    const job = (await (query)(`WITH selected AS (SELECT j.id FROM knowledge_ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.state='pending' AND s.model=$1 AND s.dimensions=$2 ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
    UPDATE knowledge_ingestion_jobs j SET state='running',lock_token=$3,locked_at=now(),version=version+1,updated_at=now() FROM selected WHERE j.id=selected.id RETURNING j.*`, [capability.model, capability.dimensions, lockToken])).rows[0];
    if (!job)
        return false;
    try {
        const prepared = await (transaction)(async (client) => {
            await workspaceLock(client);
            const source = (await client.query<PgRow<'knowledge_sources'>>("SELECT * FROM knowledge_sources WHERE id=$1 FOR UPDATE", [job.source_id])).rows[0];
            (assert)(source && source.version === job.source_version && source.source_hash === job.source_hash, 409, "KNOWLEDGE_SOURCE_CHANGED", "The indexed source changed before processing.");
            const actor = await jobActor(job.created_by, source.locale, client), current = (await sources(source.locale, client)).find(entry => entry.id === source.source_id);
            (assert)(current && knowledgeSourceHash(current) === source.source_hash, 409, "KNOWLEDGE_SOURCE_WITHDRAWN", "The public source has been changed or withdrawn.");
            const chunks = (await client.query("SELECT id,content,content_hash FROM knowledge_chunks WHERE source_id=$1 AND embedding IS NULL ORDER BY ordinal LIMIT $2", [source.id, BATCH_SIZE])).rows;
            for (const chunk of chunks)
                (assert)((hash)(chunk.content) === chunk.content_hash, 503, "KNOWLEDGE_CHUNK_INTEGRITY", "An indexed text chunk failed its checksum.");
            await client.query("UPDATE knowledge_sources SET state='indexing',updated_at=now() WHERE id=$1", [source.id]);
            return { source, actor, chunks };
        });
        const result = prepared.chunks.length ? await embed(prepared.chunks.map(row => row.content), capability, prepared.actor, "", "document", fetcher, void 0, async (usageId) => { const updated = await (query)("UPDATE knowledge_ingestion_jobs SET last_usage_id=$2 WHERE id=$1 AND state='running' AND lock_token=$3", [job.id, usageId, lockToken]); (assert)(updated.rowCount === 1, 409, "KNOWLEDGE_JOB_CHANGED", "The indexing job was changed before provider dispatch."); }) : { vectors: [], usageId: null };
        await (transaction)(async (client) => {
            await workspaceLock(client);
            const source = (await client.query<PgRow<'knowledge_sources'>>("SELECT * FROM knowledge_sources WHERE id=$1 FOR UPDATE", [job.source_id])).rows[0];
            const currentJob = (await client.query<PgRow<'knowledge_ingestion_jobs'>>("SELECT * FROM knowledge_ingestion_jobs WHERE id=$1 FOR UPDATE", [job.id])).rows[0];
            (assert)(source && currentJob?.state === "running" && currentJob.lock_token === lockToken && source.version === job.source_version && source.source_hash === job.source_hash, 409, "KNOWLEDGE_SOURCE_CHANGED", "The source or job changed while the provider was processing.");
            await jobActor(job.created_by, source.locale, client);
            const current = (await sources(source.locale, client)).find(entry => entry.id === source.source_id);
            (assert)(current && knowledgeSourceHash(current) === source.source_hash, 409, "KNOWLEDGE_SOURCE_WITHDRAWN", "The public source has been changed or withdrawn.");
            for (let index = 0; index < prepared.chunks.length; index++)
                await client.query("UPDATE knowledge_chunks SET embedding=$2::public.vector WHERE id=$1 AND source_id=$3 AND content_hash=$4", [prepared.chunks[index].id, JSON.stringify(result.vectors[index]), source.id, prepared.chunks[index].content_hash]);
            const remaining = Number((await client.query("SELECT count(*)::int AS count FROM knowledge_chunks WHERE source_id=$1 AND embedding IS NULL", [source.id])).rows[0].count);
            await client.query("UPDATE knowledge_sources SET state=$2,updated_at=now() WHERE id=$1", [source.id, remaining ? "pending" : "ready"]);
            await client.query("UPDATE knowledge_ingestion_jobs SET state=$2,lock_token=NULL,locked_at=NULL,version=version+1,updated_at=now(),completed_at=CASE WHEN $2='complete' THEN now() ELSE NULL END WHERE id=$1", [job.id, remaining ? "pending" : "complete"]);
            if (!remaining)
                await (audit)(job.created_by, "knowledge.index.complete", "knowledge_source", source.id, { sourceId: source.source_id, locale: source.locale, chunks: source.chunk_count, model: source.model }, client);
        });
    }
    catch (error) {
        const code = error instanceof HttpError ? error.code : "EMBEDDING_PROVIDER";
        await (transaction)(async (client) => {
            await workspaceLock(client);
            const current = (await client.query<PgRow<'knowledge_ingestion_jobs'>>("SELECT * FROM knowledge_ingestion_jobs WHERE id=$1 FOR UPDATE", [job.id])).rows[0];
            if (!current || current.state !== "running" || current.lock_token !== lockToken)
                return;
            const billing = current.last_usage_id ? (await client.query("SELECT state FROM ai_usage WHERE id=$1", [current.last_usage_id])).rows[0]?.state : null;
            const state = billing === "reserved" || billing === "uncertain" ? "uncertain" : "failed";
            await client.query("UPDATE knowledge_ingestion_jobs SET state=$2,error_code=$3,version=version+1,completed_at=now(),updated_at=now() WHERE id=$1", [job.id, state, code]);
            await client.query("UPDATE knowledge_sources SET state=$2,updated_at=now() WHERE id=$1 AND version=$3", [job.source_id, state, job.source_version]);
            await (audit)(job.created_by, "knowledge.index.failed", "knowledge_job", job.id, { code, state }, client);
        });
    }
    return true;
}
async function retrievePublicKnowledge(prompt: string, locale: Locale, actor: Actor | null, visitor: string, signal?: AbortSignal, fetcher = fetch, semantic = true) {
    const capability = knowledgeCapability();
    let available = await sources(locale), indexedSources = 0;
    const finish = (entries: KnowledgeEntry[], mode: 'lexical'|'hybrid', reason: string) => ({ sources: entries, guards: entries.map(entry => ({ id: entry.id, hash: knowledgeSourceHash(available.find(item => item.id === entry.id)!) })), retrieval: { mode, reason, indexedSources } });
    if (!semantic || !capability.enabled)
        return finish((retrieveKnowledge)(prompt, available, 10), "lexical", "disabled");
    if (!capability.configured)
        return finish((retrieveKnowledge)(prompt, available, 10), "lexical", "unconfigured");
    const allowed = () => JSON.stringify(available.map(entry => ({ source_id: entry.id, source_hash: knowledgeSourceHash(entry) })));
    indexedSources = Number((await (query)(`SELECT count(*)::int AS count FROM knowledge_sources s JOIN jsonb_to_recordset($4::jsonb) AS a(source_id text,source_hash text) ON a.source_id=s.source_id AND a.source_hash=s.source_hash WHERE s.locale=$1 AND s.model=$2 AND s.dimensions=$3 AND s.state='ready'`, [locale, capability.model, capability.dimensions, allowed()])).rows[0].count);
    if (!indexedSources)
        return finish((retrieveKnowledge)(prompt, available, 10), "lexical", "index_empty");
    let vectors;
    try {
        vectors = (await embed([prompt], capability, actor, visitor, "query", fetcher, signal)).vectors;
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        available = await sources(locale);
        return finish((retrieveKnowledge)(prompt, available, 10), "lexical", "provider_unavailable");
    }
    const ranked = await (transaction)(async (client) => {
        await workspaceLock(client);
        available = await sources(locale, client);
        return (await client.query(`WITH eligible AS MATERIALIZED (
      SELECT s.source_id,c.content,c.embedding FROM knowledge_chunks c JOIN knowledge_sources s ON s.id=c.source_id
      JOIN jsonb_to_recordset($4::jsonb) AS a(source_id text,source_hash text) ON a.source_id=s.source_id AND a.source_hash=s.source_hash
      WHERE s.locale=$1 AND s.model=$2 AND s.dimensions=$3 AND s.state='ready' AND c.embedding IS NOT NULL)
      SELECT source_id,content,(embedding OPERATOR(public.<=>) $5::public.vector) AS distance FROM eligible ORDER BY distance,source_id,content LIMIT 60`, [locale, capability.model, capability.dimensions, allowed(), JSON.stringify(vectors[0])])).rows;
    });
    const lexical = (retrieveKnowledge)(prompt, available, 30), scores = new Map<string, number>(), chunks = new Map<string, string[]>();
    lexical.forEach((entry, index) => scores.set(entry.id, 1 / (60 + index + 1)));
    for (const [index, row] of ranked.entries())
        if (Number.isFinite(row.distance) && row.distance <= .85) {
            scores.set(row.source_id, (scores.get(row.source_id) || 0) + 1 / (60 + index + 1));
            const parts = chunks.get(row.source_id) || [];
            if (parts.length < 4 && !parts.includes(row.content))
                parts.push(row.content);
            chunks.set(row.source_id, parts);
        }
    const directory = new Map(available.map(entry => [entry.id, entry]));
    const selected = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([id]) => { const entry = directory.get(id)!; return { ...entry, text: chunks.has(id) ? chunks.get(id)!.join("\n\n") : entry.text }; });
    return finish(selected, "hybrid", "current_index");
}
async function assertPublicKnowledgeCurrent(guards: readonly KnowledgeGuard[], locale: Locale) { const current = new Map((await sources(locale)).map(entry => [entry.id, knowledgeSourceHash(entry)])); (assert)(guards.every(guard => current.get(guard.id) === guard.hash), 409, "KNOWLEDGE_CHANGED", "A cited source changed while the answer was being prepared. Retry against the current published revision."); }
export { assertPublicKnowledgeCurrent, cancelKnowledgeJob, chunkKnowledgeText, enqueueKnowledgeIndex, getKnowledgeIndex, knowledgeCapability, knowledgeSourceHash, removeKnowledgeSource, retrievePublicKnowledge, runKnowledgeIngestion };
