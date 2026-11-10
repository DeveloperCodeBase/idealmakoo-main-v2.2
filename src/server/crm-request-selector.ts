import type {PgRow} from './recovered-db-rows';
import type {FrontRequest,SharedQuote} from '../types/frontend';
type RequestRow = PgRow<'requests',{data:Pick<FrontRequest,'name'|'email'|'organization'|'message'|'status'|'productIds'>}> & {cursor_created_at:string};
type QuoteSummaryRow = Pick<PgRow<'quote_snapshots',{locale:SharedQuote['locale'];snapshot:Pick<SharedQuote,'number'|'title'|'amount'|'currency'|'validUntil'>}>, 'id'|'record_id'|'locale'|'snapshot'|'status'|'snapshot_hash'|'created_at'>;
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { decrypt, hash, encrypt } from "./crypto";
import { assert, HttpError } from "./types";
import { isScopedCrmRecord, crmRequestCollection, loadCrmAccess, canAccessCrmRequest } from "./workspace-scopes";
import { parse, rateLimit } from "./http";
import { transaction } from "./db";
import { lockWorkspace } from "./workspace";
import { canWorkspace } from "../lib/auth";
const kinds = ["rfq", "sample_request", "distribution_partnership", "supplier_registration", "outsourcing_bid", "investment_interest", "research_proposal", "job_application", "support_ticket", "quality_complaint", "factory_visit", "cms_form", "contact", "newsletter", "event_registration", "data_deletion"] as const;
const inputSchema = z.object({ search: z.string().trim().max(120).default(""), kind: z.enum(kinds).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).max(2048).optional() }).strict();
const cursorSchema = z.object({ purpose: z.literal("crm-request-selector-v1"), actorId: z.string().min(1).max(160), filterHash: z.string().regex(/^[a-f0-9]{64}$/), at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/), id: z.string().min(1).max(160), expiresAt: z.number().int().positive() }).strict();
const scanLimit = 500;
const quoteLimit = 20;
const bounded = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
function readCursor(value: string | undefined, actor: Actor, filterHash: string) {
    if (!value)
        return null;
    try {
        const cursor = cursorSchema.parse(JSON.parse((decrypt)(value)));
        (assert)(cursor.actorId === actor.id && cursor.filterHash === filterHash && cursor.expiresAt > Date.now(), 422, "INVALID_CURSOR", "This request cursor is expired or belongs to a different search.");
        return cursor;
    }
    catch {
        throw new HttpError(422, "INVALID_CURSOR", "Use the next cursor from this account and the same request search.");
    }
}
function maskedRequest(actor: Actor, row: RequestRow) {
    const scoped = (isScopedCrmRecord)({ collection: (crmRequestCollection)(row.kind) });
    const scientific = actor.role === "scientificReviewer";
    const contact = !scientific && (!scoped || actor.crmAccess?.permissions.contact === true);
    const financial = !scientific && (!scoped || actor.crmAccess?.permissions.financial === true);
    const sourceMessage = contact && financial ? bounded(row.data.message, 2e4) : "";
    const item: FrontRequest = { id: row.id, kind: row.kind, name: contact ? bounded(row.data.name, 160) : scientific ? "Quality case" : "Request participant", email: contact ? bounded(row.data.email, 254) : "", organization: contact ? bounded(row.data.organization, 200) : "", message: sourceMessage.slice(0, 2e3), productIds: Array.isArray(row.data.productIds) ? row.data.productIds.filter(id => typeof id === "string" && id.length <= 100).slice(0, 500) : [], status: bounded(row.data.status, 80), createdAt: row.created_at.toISOString(), ownerId: contact ? row.owner_id || "guest" : "redacted", version: row.version, access: "staff", sharedQuotes: [] };
    if (["fa", "en", "tr", "ar", "ru"].includes(row.locale))
        item.locale = row.locale;
    return { item, searchText: [item.id, item.kind, item.status, item.name, item.email, item.organization, sourceMessage, ...item.productIds].join("\n").toLowerCase(), quotesVisible: !scientific && actor.crmAccess?.permissions.financial === true && actor.crmAccess.permissions.contact === true };
}
async function quoteSummaries(client: PoolClient, requestId: string) { const rows = (await client.query<QuoteSummaryRow>(`SELECT id,record_id,locale,jsonb_build_object('number',snapshot->>'number','title',snapshot->>'title','amount',snapshot->>'amount','currency',snapshot->>'currency','validUntil',snapshot->>'validUntil') AS snapshot,status,snapshot_hash,created_at FROM quote_snapshots WHERE request_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`, [requestId, quoteLimit])).rows; return rows.map(row => ({ id: row.id, recordId: row.record_id, requestId, locale: row.locale, number: bounded(row.snapshot.number, 160), title: bounded(row.snapshot.title, 500), amount: bounded(row.snapshot.amount, 100), currency: bounded(row.snapshot.currency, 16), status: row.status, issuedAt: row.created_at.toISOString(), snapshotHash: row.snapshot_hash, ...row.snapshot.validUntil ? { validUntil: bounded(row.snapshot.validUntil, 40) } : {} })); }
async function listCrmRequests(actor: Actor, queryInput = {}) {
    const input = (parse)(inputSchema, queryInput);
    await (rateLimit)("crm-request-selector:" + actor.id, 120, 60);
    const search = input.search.toLowerCase(), filterHash = (hash)(JSON.stringify({ search, kind: input.kind || null }));
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        actor = await (loadCrmAccess)(actor, client);
        (assert)(actor.role !== "customer" && actor.mfaVerified && (canWorkspace)(actor.role, "view", "overview"), 403, "FORBIDDEN", "Current staff permission and MFA are required to select CRM requests.");
        const cursor = readCursor(input.cursor, actor, filterHash);
        const rows = (await client.query<RequestRow>(`SELECT r.id,r.owner_id,r.kind,r.locale,r.version,r.quality_quarantined,r.assignee_id,r.team_id,r.territory_id,r.created_at,
      jsonb_build_object('name',left(r.data->>'name',160),'email',left(r.data->>'email',254),'organization',left(r.data->>'organization',200),'message',left(r.data->>'message',20000),'status',left(r.data->>'status',80),'productIds',r.data->'productIds') AS data,
      to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
      FROM requests r WHERE ($1::text IS NULL OR r.kind=$1) AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2::timestamptz,$3::text)) ORDER BY r.created_at DESC,r.id DESC LIMIT $4`, [input.kind || null, cursor?.at || null, cursor?.id || null, scanLimit])).rows;
        const items: FrontRequest[] = [];
        let last: RequestRow | undefined, processed = 0;
        for (const row of rows) {
            last = row;
            processed++;
            if (!(canAccessCrmRequest)(actor, { id: row.id, kind: row.kind, qualityQuarantined: row.quality_quarantined, assigneeId: row.assignee_id, teamId: row.team_id, territoryId: row.territory_id }))
                continue;
            const masked = maskedRequest(actor, row);
            if (search && !masked.searchText.includes(search))
                continue;
            if (masked.quotesVisible)
                masked.item.sharedQuotes = await quoteSummaries(client, row.id);
            items.push(masked.item);
            if (items.length === input.limit)
                break;
        }
        const nextCursor = last && (processed < rows.length || rows.length === scanLimit) ? (encrypt)(JSON.stringify({ purpose: "crm-request-selector-v1", actorId: actor.id, filterHash, at: last.cursor_created_at, id: last.id, expiresAt: Date.now() + 36e5 })) : null;
        return { items, nextCursor };
    });
}
export { listCrmRequests };
