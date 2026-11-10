type PreparedRequestCreation=Awaited<ReturnType<typeof prepareRequestCreation>>;
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
export interface RequestRow {id:string;owner_id:string|null;guest_token_hash:string|null;kind:string;locale:string;data:FrontRequest;version:number;quality_quarantined:boolean;created_at:Date;updated_at:Date;sla:Record<string,unknown>;assignee_id:string|null;team_id:string|null;territory_id:string|null}

import type { PoolClient } from 'pg';
import type { FrontRequest, SharedQuote } from '../types/frontend';
import type { CommercialDraft } from '../components/workspace/crm-tools-logic';
import type { Actor } from './types';
import { z } from "zod";
import { cookies, parse, rateLimit, visitorKey } from "./http";
import { verifyGuest, hash } from "./crypto";
import { crmRequestCollection, loadCrmAccess, canAccessCrmRequest, isScopedCrmRecord, redactCrmValue } from "./workspace-scopes";
import { sharedRequestPermission } from "./organizations";
import { query, transaction, audit } from "./db";
import { assert, object, HttpError } from "./types";
import { quoteArtifactProjectionSql, quoteArtifactDto, prepareIssuedQuoteArtifact, persistIssuedQuoteArtifact } from "./quote-artifacts";
import { getRequestBooking, reserveRequestBooking, cancelRequestBooking } from "./events";
import { lockWorkspace, getPublishedWorkspaceForm, upsertRequestInWorkspace, getWorkspaceRecordForActor, assertWorkspaceRecordApproved } from "./workspace";
import { parseEditorialSeo, editorialExpiry } from "../lib/editorial-seo";
import { products } from "../data/catalog";
import { getSourcePublicVisibility } from "./workspace-public-visibility";
import { validateFormValues } from "../lib/form-schema";
import { randomUUID } from "node:crypto";
import { enqueueAccountNotification } from "./notification-policy";
import {enqueueStaffAlerts} from "./staff-alerts";
import {hasVerifiedCustomerPhone} from "./customer-otp";
import { applyCustomerRequestPatch } from "../components/account/portal-data";
import { canWorkspace } from "../lib/auth";
import { resumeRequestBusinessSla } from "./workspace-routing";
import { calculateCommercial } from "../components/workspace/crm-tools-logic";
import { prepareQuoteCommercial, assertCommercialQuoteApproved } from "./workspace-commercial";
const kinds=['rfq','sample_request','distribution_partnership','supplier_registration','outsourcing_bid','investment_interest','research_proposal','job_application','support_ticket','quality_complaint','factory_visit','cms_form','contact','newsletter','event_registration','data_deletion'] as const;
const itemSchema=z.object({productId:z.string().min(1).max(100),quantity:z.number().int().min(1).max(100000),shade:z.string().max(80).optional(),mould:z.string().max(80).optional(),note:z.string().max(1000).optional(),variantId:z.string().max(100).optional(),sku:z.string().max(100).optional(),unit:z.string().max(100).optional()}).strict();
const createSchema = z.object({ kind: z.enum(kinds), name: z.string().trim().min(2).max(160), email: z.union([z.string().trim().email().max(254),z.literal('')]).default(''), organization: z.string().trim().max(200).default(''), message: z.string().trim().min(1).max(20000), productIds: z.array(z.string().min(1).max(100)).max(500).default([]), items: z.array(itemSchema).max(500).optional(), phone: z.string().max(40).optional(), country: z.string().max(100).optional(), locale: z.enum(['fa','en','tr','ar','ru']).default('fa'), batch: z.string().max(100).optional(), status: z.literal('received').optional(), attachmentIds: z.array(z.string().max(100)).max(10).default([]), messages: z.array(z.unknown()).max(0).optional(), idempotencyKey: z.string().min(8).max(128).optional(), eventSessionId: z.string().uuid().optional(), jobRecordId: z.string().min(1).max(100).optional(), seats: z.number().int().min(1).max(20).optional(), formId: z.string().max(100).optional(), formVersion: z.number().int().min(1).optional(), formValues: z.record(z.string().max(100),z.string().max(4000)).optional(), consent: z.object({purpose:z.literal('request_processing'),acceptedAt:z.string().datetime()}).strict() }).strict();
function guestHash(request:Request) {const value=cookies(request).im_guest_csrf;return verifyGuest(value)?hash(value):null;}
const requestCollection = crmRequestCollection;
const requestScopeRecord = (row: RequestRow) => ({ collection: requestCollection(row.kind), requestId: row.id, assigneeId: row.assignee_id || void 0, teamId: row.team_id || void 0, territoryId: row.territory_id || void 0 });
async function staffRequestAccess(actor:Actor|null, row:RequestRow, client?: PoolClient) {
    if (!actor)
        return false;
    actor = await (loadCrmAccess)(actor, client);
    return (canAccessCrmRequest)(actor, { id: row.id, kind: row.kind, qualityQuarantined: row.quality_quarantined, assigneeId: row.assignee_id, teamId: row.team_id, territoryId: row.territory_id });
}
async function canAccessRequest(actor:Actor|null,row:RequestRow,guest:string|null=null,client?:PoolClient) {
    if (actor?.id === row.owner_id)
        return true;
    if (!actor)
        return !!guest && !row.owner_id && row.guest_token_hash === guest;
    return await staffRequestAccess(actor, row, client) || !!await sharedRequestPermission(actor,row.id,client);
}
async function canAccessRequestQuote(actor: Actor | null, row: RequestRow, guest: string | null = null, client?: PoolClient) {
    if (actor) {
        actor = await (loadCrmAccess)(actor, client);
        if (actor.role !== "customer" && !actor.mfaVerified)
            return false;
    }
    if (!await canAccessRequest(actor, row, guest, client))
        return false;
    if (actor?.id === row.owner_id || !actor)
        return true;
    if (await staffRequestAccess(actor, row, client)) {
        const current = await (loadCrmAccess)(actor, client);
        return current.role !== "scientificReviewer" && current.crmAccess?.permissions.financial === true && current.crmAccess.permissions.contact === true;
    }
    return !!await (sharedRequestPermission)(actor, row.id, client);
}
async function getRequestRow(id:string,client?:PoolClient,lock=false):Promise<RequestRow>{
  const sql='SELECT * FROM requests WHERE id=$1'+(lock?' FOR UPDATE':'');const result=client?await client.query<RequestRow>(sql,[id]):await query<RequestRow>(sql,[id]);assert(result.rows[0],404,'NOT_FOUND','Request not found.');return result.rows[0];
}
async function requestDto(row:RequestRow,actor:Actor|null,client?:PoolClient):Promise<FrontRequest>{
    const run=(sql:string,args:unknown[])=>client?client.query(sql,args):query(sql,args);
    if (actor)
        actor = await (loadCrmAccess)(actor, client);
    const includeInternal = actor?.id !== row.owner_id && await staffRequestAccess(actor, row, client);
    const permission=actor&&actor.id!==row.owner_id&&!includeInternal?await sharedRequestPermission(actor,row.id,client):null;
    const messages=(await run(`SELECT m.id,m.body,m.visibility,m.created_at,u.name AS sender FROM request_messages m LEFT JOIN users u ON u.id=m.actor_id WHERE m.request_id=$1 ${includeInternal?'':"AND m.visibility='public'"} ORDER BY m.created_at,m.id`,[row.id])).rows;
    const quotes = (await run("SELECT " + quoteArtifactProjectionSql + " FROM quote_snapshots q LEFT JOIN quote_revision_files f ON f.quote_id=q.id WHERE q.request_id=$1 ORDER BY q.created_at,q.id", [row.id])).rows;
    const envelopes = (await run("SELECT record_id,request_id,current_revision_id,version,updated_at FROM crm_quote_envelopes WHERE request_id=$1 ORDER BY record_id", [row.id])).rows;
    const dto: FrontRequest = { ...row.data, id: row.id, ownerId: row.owner_id || "guest", access: actor?.id === row.owner_id || !actor ? "owner" : includeInternal ? "staff" : permission === "reply" ? "shared_reply" : "shared_view", version: row.version, createdAt: row.created_at.toISOString(), messages: messages.map(m=>({id:m.id,body:m.body,visibility:m.visibility,createdAt:m.created_at.toISOString(),sender:m.sender||row.data.name})), sharedQuotes: quotes.map(q => ({ ...(quoteArtifactDto)(q), status: q.status, ...q.responded_at ? { customerResponse: q.response || "", respondedAt: q.responded_at.toISOString() } : {} })), quoteEnvelopes: envelopes.map(value => ({ recordId: value.record_id, requestId: value.request_id, currentRevisionId: value.current_revision_id, version: value.version, updatedAt: value.updated_at.toISOString() })) };
    const booking=await getRequestBooking(row.id,client);
    if (booking)
        dto.booking = booking;
    if (includeInternal && actor && (actor.role === "scientificReviewer" || (isScopedCrmRecord)(requestScopeRecord(row)) && !actor.crmAccess?.permissions.contact)) {
        dto.name = actor.role === "scientificReviewer" ? "Quality case" : "Request participant";
        dto.email = "";
        dto.phone = "";
        dto.organization = "";
        dto.country = "";
        dto.ownerId = "redacted";
        dto.messages = (dto.messages||[]).map(message=>({...message,sender:'Case participant'}));
        dto.sharedQuotes = (redactCrmValue)(actor, dto.sharedQuotes) as SharedQuote[];
        delete dto.formValues;
        delete dto.idempotencyKey;
        delete dto.consent;
    }
    if (includeInternal && actor && (actor.role === "scientificReviewer" || (isScopedCrmRecord)(requestScopeRecord(row)) && !actor.crmAccess?.permissions.financial)) {
        dto.sharedQuotes = [];
        dto.quoteEnvelopes = [];
        delete dto.formValues;
    }
    return dto;
}
async function listRequests(actor:Actor|null,guest:string|null){
  const rows=actor?(await query<RequestRow>(`SELECT r.* FROM requests r WHERE owner_id=$1 OR EXISTS(SELECT 1 FROM request_shares s JOIN customer_organizations o ON o.id=s.organization_id AND o.archived_at IS NULL JOIN organization_memberships m ON m.organization_id=o.id AND m.user_id=$1 AND m.active WHERE s.request_id=r.id AND s.revoked_at IS NULL) ORDER BY r.created_at DESC LIMIT 500`,[actor.id])).rows:guest?(await query<RequestRow>('SELECT * FROM requests WHERE owner_id IS NULL AND guest_token_hash=$1 ORDER BY created_at DESC LIMIT 100',[guest])).rows:[];
  return Promise.all(rows.map(row=>requestDto(row,actor)));
}
async function getRequest(actor:Actor|null,id:string,guest:string|null){const row=await getRequestRow(id);assert(await canAccessRequest(actor,row,guest),404,'NOT_FOUND','Request not found.');return requestDto(row,actor);}
async function prepareRequestCreation(request: Request, actor: Actor | null, body: unknown, idempotencyKey: string, allowTender = false) {
    const input = (parse)(createSchema, body);
    (assert)(input.email || actor && await hasVerifiedCustomerPhone(actor.id),422,'EMAIL_OR_VERIFIED_PHONE','Provide an email or sign in with a verified mobile number.');
    (assert)(allowTender || input.kind !== "outsourcing_bid", 422, "TENDER_ENVELOPES_REQUIRED", "Use the confidential tender form with separate technical and financial envelopes.");
    (assert)(/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey), 422, "IDEMPOTENCY_KEY", "Send a valid Idempotency-Key header.");
    if (input.idempotencyKey)
        (assert)(input.idempotencyKey === idempotencyKey, 422, "IDEMPOTENCY_KEY", "The idempotency keys do not match.");
    const guest = guestHash(request);
    (assert)(actor || guest, 401, "SESSION_REQUIRED", "Refresh the form before submitting.");
    await (rateLimit)("requests:" + (visitorKey)(request), 30, 3600);
    const productIds = [...new Set([...input.productIds, ...(input.items || []).map(item => item.productId)])];
    if (input.kind === "quality_complaint")
        (assert)(productIds.length > 0 && !!input.batch?.trim(), 422, "QUALITY_DETAILS", "Select the product and provide its batch number.");
    if (input.kind === "sample_request")
        (assert)(productIds.length > 0, 422, "PRODUCT", "Select a product for the sample request.");
    if (input.kind === "cms_form")
        (assert)(input.formId && input.formVersion && input.formValues, 422, "FORM", "A published form and its version are required.");
    if (input.kind === "event_registration")
        (assert)(input.eventSessionId, 422, "EVENT_SESSION", "Select an available event booking session.");
    if (input.eventSessionId)
        (assert)(["event_registration", "factory_visit"].includes(input.kind), 422, "EVENT_KIND", "A booking session can only be used for an event or factory visit.");
    if (input.jobRecordId)
        (assert)(input.kind === "job_application", 422, "JOB_KIND", "A vacancy can only be selected for a job application.");
    const scope = "request:" + (actor?.id || guest);
    const requestHash = (hash)(JSON.stringify(input));
    return { input, actor, guest, scope, requestHash, idempotencyKey, productIds, request };
}
async function createRequest(request:Request,actor:Actor|null,body:unknown,idempotencyKey:string){ const prepared = await prepareRequestCreation(request, actor, body, idempotencyKey); return (transaction)(client => persistRequestCreation(client, prepared)); }
async function createTenderRequestInTransaction(client: PoolClient, request: Request, actor: Actor | null, body: unknown, idempotencyKey: string) { const prepared = await prepareRequestCreation(request, actor, body, idempotencyKey, true); (assert)(prepared.input.kind === "outsourcing_bid", 422, "TENDER_KIND", "A tender command can create only a tender receipt."); return persistRequestCreation(client, prepared); }
async function persistRequestCreation(client: PoolClient, prepared: PreparedRequestCreation) {
    const { input, actor, guest, scope, requestHash, idempotencyKey, productIds, request } = prepared;
    await (lockWorkspace)(client);
    if(actor)await loadCrmAccess(actor,client);
    if(!input.email){
      const phone=actor?(await client.query("SELECT phone_number FROM users WHERE id=$1 AND role='customer' AND active AND phone_verified_at IS NOT NULL FOR SHARE",[actor.id])).rows[0]:null;
      assert(phone?.phone_number,422,'EMAIL_OR_VERIFIED_PHONE','A current verified mobile account is required when email is omitted.');
      input.phone ||= phone.phone_number;
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [scope + ":" + idempotencyKey]);
    const existing = (await client.query("SELECT request_hash,response FROM idempotency_keys WHERE scope=$1 AND key=$2", [scope, idempotencyKey])).rows[0];
    if (existing) {
        (assert)(existing.request_hash === requestHash, 409, "IDEMPOTENCY_CONFLICT", "This key was already used for different form values.");
        return existing.response;
    }
    if (input.jobRecordId) {
        const release = (await client.query(`SELECT r.publication->'seo' AS seo FROM locale_releases r
        JOIN workspace_entities e ON e.bucket=r.document_bucket AND e.id=r.document_id
        WHERE r.document_bucket='records' AND r.document_id=$1 AND r.kind='hr' AND r.locale=$2
        AND r.unpublished_at IS NULL AND e.collection='hr' AND e.deleted_at IS NULL
        AND e.status<>'archived' AND e.data->>'requestId' IS NULL`, [input.jobRecordId, input.locale])).rows[0];
        (assert)(release, 409, "JOB_UNAVAILABLE", "This vacancy is no longer accepting applications in this language.");
        if (release.seo !== null && release.seo !== void 0) {
            const metadata = (parseEditorialSeo)(release.seo);
            (assert)(metadata, 409, "JOB_UNAVAILABLE", "This vacancy is no longer accepting applications in this language.");
            if (metadata.job)
                (assert)(metadata.job.status === "open" && (editorialExpiry)(metadata.job.validThrough) >= Date.now(), 409, "JOB_UNAVAILABLE", "This vacancy is no longer accepting applications in this language.");
        }
    }
    if (productIds.length) {
        const releases = (await client.query("SELECT r.document_id AS id,e.data->>'product' AS product,r.publication->'customProduct'->>'id' AS custom_id,r.locale,r.unpublished_at FROM locale_releases r JOIN workspace_entities e ON e.bucket=r.document_bucket AND e.id=r.document_id WHERE r.document_bucket='records' AND r.kind IN ('product','products')")).rows;
        const valid = new Set(products.map(product => product.id));
        for (const release of releases)
            if (input.kind === "quality_complaint" || release.locale === input.locale && !release.unpublished_at) {
                for (const productId of [release.id, release.product, release.custom_id])
                    if (productId)
                        valid.add(productId);
            }
        if (input.kind !== "quality_complaint") {
            const hidden = (await client.query("SELECT id,data->>'product' AS product,data->'details'->'customProduct'->>'id' AS custom_id FROM workspace_entities WHERE bucket='records' AND collection='products' AND (deleted_at IS NOT NULL OR status='archived')")).rows;
            for (const entry of [...hidden, ...releases.filter(release => release.locale === input.locale && release.unpublished_at)])
                for (const productId of [entry.id, entry.product, entry.custom_id])
                    if (productId)
                        valid.delete(productId);
            const sourceVisibility = await (getSourcePublicVisibility)(client);
            for (const [productId, locales] of Object.entries(sourceVisibility.hiddenProductLocales))
                if (locales.includes(input.locale))
                    valid.delete(productId);
        }
        (assert)(productIds.every(productId => valid.has(productId)), 422, "PRODUCT", "One or more products are unavailable in this language.");
    }
    if (input.kind === "cms_form") {
        const schema = await (getPublishedWorkspaceForm)(input.formId!, input.formVersion, client, input.locale);
        (assert)(schema, 409, "FORM_CHANGED", "This form was updated. Refresh and submit again.");
        const checked = (validateFormValues)(schema, input.formValues!);
        (assert)(!checked.errors.length, 422, "FORM_VALIDATION", "Check the form values.");
        input.formValues = checked.values;
    }
    const id = "IM-REQ-" + (randomUUID)();
    const createdAt = new Date().toISOString();
    const { idempotencyKey: ignored, ...fields } = input;
    void ignored;
    const data: FrontRequest = { ...fields, id, createdAt, status: "received", ownerId: actor?.id || "guest", version: 1, idempotencyKey, productIds, messages: [], sharedQuotes: [], consent: { purpose: "request_processing", acceptedAt: createdAt } };
    const sla = { policy: "business-hours-v1", firstResponseDueAt: addBusinessMinutes(new Date, 8 * 60).toISOString(), resolutionDueAt: addBusinessMinutes(new Date, 48 * 60).toISOString(), pausedAt: null, firstRespondedAt: null };
    await client.query("INSERT INTO requests(id,owner_id,guest_token_hash,kind,locale,data,quality_quarantined,sla,consent_snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb)", [id, actor?.id || null, actor ? null : guest, input.kind, input.locale, JSON.stringify(data), input.kind === "quality_complaint", JSON.stringify(sla), JSON.stringify({ purpose: "request_processing", policyVersion: "2026-10-19", acceptedAt: createdAt })]);
    if (input.eventSessionId) {
        data.booking = await (reserveRequestBooking)(client, actor, data, input.eventSessionId, input.seats || 1);
        await client.query("UPDATE requests SET data=$2::jsonb WHERE id=$1", [id, JSON.stringify(data)]);
    }
    for (const assetId of input.attachmentIds) {
        const result = await client.query(`UPDATE assets SET request_id=$1 WHERE id=$2 AND deleted_at IS NULL AND visibility='private' AND request_id IS NULL AND (owner_id=$3 OR (owner_id IS NULL AND metadata->>'guestHash'=$4)) AND NOT EXISTS(SELECT 1 FROM resource_versions rv WHERE rv.asset_id=assets.id) AND NOT EXISTS(SELECT 1 FROM crm_domain_asset_refs dr WHERE dr.asset_id=assets.id) AND NOT EXISTS(SELECT 1 FROM shared_block_asset_refs br WHERE br.asset_id=assets.id) AND NOT EXISTS(SELECT 1 FROM tender_asset_refs tr WHERE tr.asset_id=assets.id) AND NOT EXISTS(SELECT 1 FROM asset_media_derivatives md WHERE md.asset_id=assets.id OR md.source_asset_id=assets.id) AND NOT EXISTS(SELECT 1 FROM media_processing_jobs mj WHERE mj.source_asset_id=assets.id) AND NOT EXISTS(SELECT 1 FROM asset_image_sources originals WHERE originals.original_asset_id=assets.id) AND NOT EXISTS(SELECT 1 FROM asset_image_derivatives derivatives WHERE derivatives.source_asset_id=assets.id) RETURNING id`, [id, assetId, actor?.id || null, guest]);
        (assert)(result.rowCount, 403, "ATTACHMENT_OWNERSHIP", "An attachment is not available to this form.");
    }
    await client.query("INSERT INTO consent_events(user_id,purpose,accepted,policy_version,ip_hash,request_id) VALUES($1,$2,true,$3,$4,$5)", [actor?.id || null, "request_processing", "2026-10-19", (visitorKey)(request), id]);
    await (upsertRequestInWorkspace)(client, { ...data, qualityQuarantined: input.kind === "quality_complaint" });
    await client.query("INSERT INTO idempotency_keys(scope,key,request_hash,response) VALUES($1,$2,$3,$4::jsonb)", [scope, idempotencyKey, requestHash, JSON.stringify(data)]);
    if (actor)
        await (enqueueAccountNotification)(client, { userId: actor.id, topic: "requests", channel: "in-app", purpose: "transactional", title: "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062B\u0628\u062A \u0634\u062F / Request received", body: id, href: "/" + input.locale + "/account/requests/?id=" + id, requestId: id }, "request-received:" + id);
    await enqueueStaffAlerts(client,id,"received");
    await (audit)(actor?.id || null, "request.created", "request", id, { kind: input.kind }, client);
    return data;
}
function addBusinessMinutes(start:Date,minutes:number):Date {
  // Saturday–Thursday, 08:00–17:00 in Tehran; explicit factory calendar policy v1.
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const date=new Date(start);let remaining=minutes;let safety=0;
  while(remaining>0&&safety++<180000){date.setTime(date.getTime()+60000);const parts=Object.fromEntries(fmt.formatToParts(date).map(p=>[p.type,p.value]));if(parts.weekday!=='Fri'&&Number(parts.hour)>=8&&Number(parts.hour)<17)remaining--;}
  assert(!remaining,422,'SLA_RANGE','The requested deadline is outside the supported calendar range.');return date;
}
async function patchRequest(actor:Actor|null,id:string,guest:string|null,body:unknown,expected:number){
    const patch=object(body);
    return (transaction)(async (client) => {
        await lockWorkspace(client);
        if (actor)
            actor = await (loadCrmAccess)(actor, client);
        const row=await getRequestRow(id,client,true);
        assert(await canAccessRequest(actor,row,guest,client),404,'NOT_FOUND','Request not found.');
        assert(row.version===expected,409,'CONFLICT','This request changed. Refresh and retry.');
        const current=await requestDto(row,actor,client);
        let next:FrontRequest;
        const own=actor?.id===row.owner_id||(!actor&&!!guest&&guest===row.guest_token_hash);
        const staffAccess = !own && await staffRequestAccess(actor, row, client);
        const shared = actor && !own && !staffAccess ? await sharedRequestPermission(actor,id,client) : null;
        if (own || shared) {
            if (shared)
                assert(shared==='reply'&&Array.isArray(patch.messages)&&Object.keys(patch).every(key=>key==='messages'),403,'SHARED_READ_ONLY','This share permits only an explicitly authorized public reply.');
            const proposed=applyCustomerRequestPatch(shared?{...current,ownerId:actor!.id}:current,patch as Partial<FrontRequest>,actor?{...actor,demo:false}:null);
            assert(proposed,422,'REQUEST_ACTION','Only a public reply, withdrawal, or valid quote response is permitted.');
            next = { ...proposed, ownerId: current.ownerId };
        }
        else {
            assert(actor,401,'SESSION_REQUIRED','Sign in to continue.');
            const allowed=['status','messages'];
            assert(Object.keys(patch).every(k=>allowed.includes(k)),403,'REQUEST_ACTION','This request field cannot be edited.');
            assert(canWorkspace(actor.role,'edit',requestCollection(row.kind))||canWorkspace(actor.role,'reply',requestCollection(row.kind)),403,'FORBIDDEN','You cannot update this request.');
            const changes=parse(z.object({status:z.enum(['received','in_review','waiting_customer','responded','resolved','closed']).optional(),messages:z.array(z.object({id:z.string().max(100),body:z.string().trim().min(1).max(4000),visibility:z.enum(['public','internal']),createdAt:z.string(),sender:z.string()}).strict()).max(500).optional()}).strict(),patch);
            if (changes.messages) {
                assert(changes.messages.length===(current.messages||[]).length+1&&(current.messages||[]).every((m,index)=>JSON.stringify(m)===JSON.stringify(changes.messages![index])),422,'MESSAGES_IMMUTABLE','Messages are append-only.');
            }
            next = { ...current, ...changes, version: row.version + 1 };
        }
        if (row.kind === "outsourcing_bid") {
            const { assertTenderRequestStatusChange } = await import("./tenders");
            await assertTenderRequestStatusChange(client, id, next.status, current.status);
        }
        if (next.status === "withdrawn" && current.status !== "withdrawn")
            await cancelRequestBooking(client,id,actor?.id||null);
        const additions=(next.messages||[]).slice((current.messages||[]).length);
        for (const message of additions) {
            message.id = randomUUID();
            message.sender = actor?.name || current.name;
            message.createdAt = new Date().toISOString();
            await client.query('INSERT INTO request_messages(id,request_id,body,visibility,actor_id) VALUES($1,$2,$3,$4,$5)',[message.id,id,message.body,message.visibility,actor?.id||null]);
        }
        for (const quote of next.sharedQuotes || []) {
            const before=current.sharedQuotes?.find(q=>q.id===quote.id);
            if (before && before.status !== quote.status) {
                const result=await client.query("UPDATE quote_snapshots SET status=$3,response=$4,responded_at=now() WHERE id=$1 AND request_id=$2 AND status='issued' RETURNING id",[quote.id,id,quote.status,quote.customerResponse||'']);
                assert(result.rowCount,409,'QUOTE_RESPONSE_CONFLICT','This quotation was already answered.');
            }
        }
        const sla={...row.sla};
        if (next.status === "waiting_customer" && current.status !== "waiting_customer")
            sla.pausedAt = new Date().toISOString();
        if (current.status === "waiting_customer" && next.status !== "waiting_customer" && typeof sla.pausedAt === "string")
            Object.assign(sla, await (resumeRequestBusinessSla)(client, sla));
        if (staffAccess && additions.some(m=>m.visibility==='public') && !sla.firstRespondedAt)
            sla.firstRespondedAt = new Date().toISOString();
        const allMessages = (await client.query("SELECT m.id,m.body,m.visibility,m.created_at,u.name AS sender FROM request_messages m LEFT JOIN users u ON u.id=m.actor_id WHERE m.request_id=$1 ORDER BY m.created_at,m.id", [id])).rows;
        const allQuotes = (await client.query("SELECT snapshot,status,response,responded_at FROM quote_snapshots WHERE request_id=$1 ORDER BY created_at,id", [id])).rows;
        next = { ...row.data, status: next.status, version: row.version + 1, messages: allMessages.map(message => ({ id: message.id, body: message.body, visibility: message.visibility, createdAt: message.created_at.toISOString(), sender: message.sender || row.data.name })), sharedQuotes: allQuotes.map(quote => ({ ...quote.snapshot, status: quote.status, ...quote.responded_at ? { customerResponse: quote.response || "", respondedAt: quote.responded_at.toISOString() } : {} })) };
        await client.query('UPDATE requests SET data=$2::jsonb,version=version+1,updated_at=now(),sla=$3::jsonb WHERE id=$1',[id,JSON.stringify(next),JSON.stringify(sla)]);
        await upsertRequestInWorkspace(client,{...next,qualityQuarantined:row.quality_quarantined});
        if (!own && row.owner_id)
            await enqueueAccountNotification(client,{userId:row.owner_id,topic:'requests',channel:'in-app',purpose:'transactional',title:'به‌روزرسانی درخواست / Request updated',body:id,href:'/'+row.locale+'/account/requests/?id='+id,requestId:id},'request-updated:'+id+':'+next.version);
        if(!staffAccess&&additions.length)await enqueueStaffAlerts(client,id,'updated',next.version);
        await audit(actor?.id||null,'request.updated','request',id,{fields:Object.keys(patch)},client);
        return requestDto({...row,data:next,version:next.version!},actor,client);
    });
}
async function issueQuote(actor:Actor,requestId:string,body:unknown){
    const input=parse(z.object({recordId:z.string().min(1).max(100)}).strict(),body);
    assert(canWorkspace(actor.role,'issue','quotes'),403,'FORBIDDEN','You cannot issue a quotation.');
    await (rateLimit)("quote-issue:" + actor.id, 30, 60);
    return (transaction)(async (client) => {
        await lockWorkspace(client);
        actor = await (loadCrmAccess)(actor, client);
        (assert)(canWorkspace(actor.role,'issue','quotes') && actor.crmAccess?.permissions.financial === true, 403, "CRM_FINANCIAL_REQUIRED", "Issuing a quotation requires current financial permission.");
        const request=await getRequestRow(requestId,client,true);
        (assert)(await staffRequestAccess(actor, request, client), 404, "NOT_FOUND", "Request not found.");
        assert(request.kind==='rfq',409,'REQUEST_KIND','A quotation requires an RFQ.');
        (assert)(actor.crmAccess.permissions.contact === true, 403, "CRM_CONTACT_REQUIRED", "Issuing an immutable quotation requires access to its customer identity.");
        const record=await getWorkspaceRecordForActor(actor,input.recordId,client);
        assert(record.collection==='quotes'&&record.requestId===requestId&&['approved','proposal'].includes(record.status),409,'QUOTE_APPROVAL','An approved quotation linked to this request is required.');
        const draft=record.details?.commercialDraft as CommercialDraft|undefined;
        assert(draft&&draft.kind==='quote'&&draft.schemaVersion===1,422,'QUOTE_LINES','Complete the typed quotation line editor before issuing.');
        if (!draft.pricebookRevisionId) {
            const calculated=calculateCommercial(draft.lines,draft.currency);
            assert(calculated.ok&&calculated.value.complete,422,'QUOTE_VALUES','Every quotation line needs a valid price and matching currency.');
            const locale=request.locale as keyof typeof record.title, validUntil=record.due?new Date(record.due+'T23:59:59Z').toISOString():undefined;
            const legacy = { recordId: record.id, requestId, locale, title: record.title[locale], amount: calculated.value.grandTotalDecimal, currency: draft.currency, terms: record.summary[locale], lines: draft.lines.map(line => ({ id: line.id, productId: line.productId, titleSnapshot: line.titleSnapshot, unit: line.unit, quantityDecimal: line.quantityDecimal, unitPriceDecimal: line.unitPriceDecimal, discountPercentDecimal: line.discountPercentDecimal, currency: line.currency, netDecimal: calculated.value.lines.find(value=>value.lineId===line.id)?.netDecimal })), validUntil };
            const prior = (await client.query("SELECT " + quoteArtifactProjectionSql + " FROM quote_snapshots q LEFT JOIN quote_revision_files f ON f.quote_id=q.id WHERE q.record_id=$1 AND q.request_id=$2 AND q.snapshot_hash=$3", [record.id, requestId, (hash)(JSON.stringify(legacy))])).rows[0];
            if (prior)
                return (quoteArtifactDto)(prior);
            throw new HttpError(422, "PRICEBOOK_REQUIRED", "New quotations require an approved pricebook revision.");
        }
        const prepared = await (prepareQuoteCommercial)(client, actor, record, false), snapshotHash = prepared.hash;
        const existing = (await client.query("SELECT " + quoteArtifactProjectionSql + " FROM quote_snapshots q LEFT JOIN quote_revision_files f ON f.quote_id=q.id WHERE q.record_id=$1 AND q.request_id=$2 AND q.snapshot_hash=$3", [record.id, requestId, snapshotHash])).rows[0];
        if (existing)
            return (quoteArtifactDto)(existing);
        assert(record.status==='approved',409,'QUOTE_APPROVAL','This quotation needs approval before a new version can be issued.');
        assert(!['withdrawn','closed','resolved'].includes(request.data.status),409,'REQUEST_CLOSED','A quotation requires an active RFQ.');
        const revision = await (assertWorkspaceRecordApproved)(client, prepared.record, request.locale);
        await (assertCommercialQuoteApproved)(client, prepared, revision.id);
        const id=randomUUID(), createdAt=new Date().toISOString();
        const artifact = await (prepareIssuedQuoteArtifact)({ ...prepared.commercial, id, number: "IM-Q-" + id.slice(0,8).toUpperCase(), status: "issued", issuedAt: createdAt, snapshotHash });
        const snapshot = artifact.snapshot;
        await client.query("INSERT INTO quote_snapshots(id,request_id,record_id,locale,snapshot,snapshot_hash,issued_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)", [id, requestId, record.id, request.locale, JSON.stringify(snapshot), snapshotHash, actor.id]);
        const envelope = await (persistIssuedQuoteArtifact)(client, snapshot, artifact.bytes);
        const updated = { ...request.data, version: request.version + 1, sharedQuotes: [...request.data.sharedQuotes || [], snapshot], quoteEnvelopes: [...(request.data.quoteEnvelopes || []).filter(value => value.recordId !== record.id), envelope] };
        await client.query('UPDATE requests SET data=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1',[requestId,JSON.stringify(updated)]);
        await upsertRequestInWorkspace(client,{...updated,qualityQuarantined:request.quality_quarantined});
        await (audit)(actor.id, "quote.issued", "quote", id, { snapshotHash, fileSha256: snapshot.fileSha256, fileByteCount: snapshot.fileByteCount, currentRevisionId: envelope.currentRevisionId, requestId }, client);
        return snapshot;
    });
}
export { addBusinessMinutes, canAccessRequest, canAccessRequestQuote, createRequest, createTenderRequestInTransaction, getRequest, getRequestRow, guestHash, issueQuote, listRequests, patchRequest, requestDto, staffRequestAccess };
