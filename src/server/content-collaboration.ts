import type {PgRow} from './recovered-db-rows';
import type {WorkspaceRecord,WorkspaceForm,PageDraft,PageBlock} from '../data/workspace-seed';
import type {PublishedContent} from '../lib/publications';
import type {Locale} from '../lib/i18n';
import type {WorkspaceChange} from './workspace-policy';
import type { PoolClient } from 'pg';
import type { Actor } from './types';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { loadCrmAccess } from "./workspace-scopes";
import { assert, HttpError } from "./types";
import { isContent, readableRecord } from "./workspace-policy";
import { canWorkspace } from "../lib/auth";
import { parse, rateLimit, visitorKey } from "./http";
import { transaction, audit, query } from "./db";
import { lockWorkspace, publicationForSource, ensureRevision } from "./workspace";
import { randomBytes, randomUUID } from "node:crypto";
import { hash, equal } from "./crypto";
import { config } from "./config";
import { parseRichText } from "../lib/rich-text";
import {canManageSitePage} from '../lib/page-authority';
const targetSchema = z.object({ bucket: z.enum(["records", "pages", "forms"]), id: z.string().min(1).max(160) });
const previewTargetSchema=z.object({bucket:z.enum(["records","pages"]),id:z.string().min(1).max(160)});
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
async function sourceFor(client:PoolClient,actor:Actor,target:z.infer<typeof targetSchema>,lang?:Locale,edit=false){
    actor=await loadCrmAccess(actor,client);assert(actor.mfaVerified,403,"MFA_REQUIRED","Complete MFA before working with content.");
    const row=(await client.query<{data:WorkspaceRecord|PageDraft|WorkspaceForm;updated_at:Date}>("SELECT data,updated_at FROM workspace_entities WHERE bucket=$1 AND id=$2 AND deleted_at IS NULL",[target.bucket,target.id])).rows[0];
    assert(row,404,"NOT_FOUND","Content not found.");
    const source={...row.data,updatedAt:row.data.updatedAt||row.updated_at.toISOString()},record='collection'in source,form=target.bucket==='forms',page=target.bucket==='pages';
    assert(record?isContent(source)&&readableRecord(actor,source):canWorkspace(actor.role,"view",form?'forms':'pages'),404,"NOT_FOUND","Content not found.");
    assert(!record||source.status!=="archived",404,"NOT_FOUND","Content not found.");
    const collection=record?source.collection:form?'forms':'pages';
    const editable=(canWorkspace(actor.role,"edit",collection)||canWorkspace(actor.role,"translate",collection))&&(!(form||page)||source.status!=='archived')&&(!page||canManageSitePage(actor.role,(source as PageDraft).slug));
    if(edit)assert(editable,403,"FORBIDDEN","You cannot edit or share a draft of this content.");
    const requested=lang||(page?(source as PageDraft).locale:undefined);
    if(requested)assert(actor.allowedLocales.includes(requested)&&(!page||(source as PageDraft).locale===requested),403,"LOCALE_SCOPE","This language is outside your content scope.");
    return{actor,source,editable};
}
const leaseDto = (row: PgRow<'content_edit_leases'> & {holder_name?: string}, actor: Actor) => ({ id: row.id, bucket: row.document_bucket, documentId: row.document_id, leaseUntil: row.lease_until.toISOString(), holder: { id: row.user_id, name: row.holder_name || "Content editor" }, owned: row.user_id === actor.id });
const previewDto = (row: PgRow<'content_previews'>, actor: Actor) => ({ id: row.id, bucket: row.document_bucket, documentId: row.document_id, locale: row.locale, revisionId: row.revision_id, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), revokedAt: row.revoked_at?.toISOString() || null, canRevoke: row.created_by === actor.id || ["admin", "superAdmin"].includes(actor.role) });
function contentLeaseTokens(request: Request) { const value = request.headers.get("x-content-leases") || ""; (assert)(value.length <= 1300, 422, "LEASE_TOKEN", "Too many editing lease tokens."); const tokens = value ? value.split(",") : []; (assert)(tokens.length <= 20 && tokens.every(token => /^[a-f0-9]{64}$/.test(token)), 422, "LEASE_TOKEN", "Invalid editing lease token."); return tokens; }
async function getContentLease(actor: Actor, body: unknown) { const target = (parse)(targetSchema.strict(), body); return (transaction)(async (client) => { await (lockWorkspace)(client); const current = await sourceFor(client, actor, target); const row = (await client.query("SELECT l.*,u.name AS holder_name FROM content_edit_leases l JOIN users u ON u.id=l.user_id AND u.active WHERE document_bucket=$1 AND document_id=$2 AND lease_until>now()", [target.bucket, target.id])).rows[0]; return { lease: row ? leaseDto(row, current.actor) : null, canEdit: current.editable, sourceUpdatedAt: current.source.updatedAt }; }); }
async function acquireContentLease(actor: Actor, body: unknown) {
    const input = (parse)(targetSchema.extend({ clientId: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict(), body);
    await (rateLimit)("content-lease:" + actor.id, 90, 60);
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        const current = await sourceFor(client, actor, input, void 0, true);
        const existing = (await client.query("SELECT l.*,u.name AS holder_name FROM content_edit_leases l JOIN users u ON u.id=l.user_id WHERE document_bucket=$1 AND document_id=$2 FOR UPDATE OF l", [input.bucket, input.id])).rows[0];
        if (existing && existing.lease_until.getTime() > Date.now() && (existing.user_id !== actor.id || existing.client_id !== input.clientId))
            throw new HttpError(423, "CONTENT_LOCKED", "Another editor has an active lease. Wait for its expiry or ask that editor to release it.", { lease: leaseDto(existing, current.actor) });
        (assert)(current.source.updatedAt === input.expectedUpdatedAt, 409, "SOURCE_CHANGED", "This saved document changed since your editor loaded it. Reload the document before acquiring a new lease.");
        const token = (randomBytes)(32).toString("hex");
        const row = (await client.query(`INSERT INTO content_edit_leases(id,document_bucket,document_id,user_id,client_id,token_hash,lease_until) VALUES($1,$2,$3,$4,$5,$6,now()+interval '2 minutes') ON CONFLICT(document_bucket,document_id) DO UPDATE SET id=EXCLUDED.id,user_id=EXCLUDED.user_id,client_id=EXCLUDED.client_id,token_hash=EXCLUDED.token_hash,lease_until=EXCLUDED.lease_until,created_at=now(),renewed_at=now() RETURNING *`, [(randomUUID)(), input.bucket, input.id, actor.id, input.clientId, (hash)(token)])).rows[0];
        await (audit)(actor.id, "content.lease.acquired", input.bucket, input.id, { leaseId: row.id }, client);
        return { ...leaseDto({ ...row, holder_name: current.actor.name }, current.actor), token };
    });
}
async function renewContentLease(actor: Actor, id: string, body: unknown, release = false) {
    const input = (parse)(z.object({ token: tokenSchema }).strict(), body);
    (assert)(z.string().uuid().safeParse(id).success, 404, "NOT_FOUND", "Editing lease not found.");
    return (transaction)(async (client) => {
        await (lockWorkspace)(client);
        const row = (await client.query("SELECT * FROM content_edit_leases WHERE id=$1 FOR UPDATE", [id])).rows[0];
        (assert)(row && row.user_id === actor.id && (equal)(row.token_hash, (hash)(input.token)), 404, "NOT_FOUND", "Editing lease not found.");
        const current = await sourceFor(client, actor, { bucket: row.document_bucket, id: row.document_id }, void 0, true);
        if (release) {
            await client.query("DELETE FROM content_edit_leases WHERE id=$1", [id]);
            await (audit)(actor.id, "content.lease.released", row.document_bucket, row.document_id, { leaseId: id }, client);
            return { ok: true };
        }
        (assert)(row.lease_until.getTime() > Date.now(), 409, "LEASE_EXPIRED", "The editing lease expired. Acquire a new lease before saving.");
        const updated = (await client.query("UPDATE content_edit_leases SET lease_until=now()+interval '2 minutes',renewed_at=now() WHERE id=$1 RETURNING *", [id])).rows[0];
        return leaseDto({ ...updated, holder_name: current.actor.name }, current.actor);
    });
}
async function assertContentLeaseWrites(client: PoolClient, actor: Actor, changes: WorkspaceChange[], tokens: string[] = []) {
    for (const change of changes) {
        if (!change.before || !(change.bucket === "forms" || change.bucket === "pages" || change.bucket === "records" && (isContent)(change.before)))
            continue;
        const lease = (await client.query("SELECT l.*,u.name AS holder_name FROM content_edit_leases l JOIN users u ON u.id=l.user_id AND u.active WHERE document_bucket=$1 AND document_id=$2 AND lease_until>now() FOR UPDATE OF l", [change.bucket, change.id])).rows[0];
        if (!lease)
            continue;
        const authorized = lease.user_id === actor.id && tokens.some(token => /^[a-f0-9]{64}$/.test(token) && (equal)((hash)(token), lease.token_hash));
        if (!authorized)
            throw new HttpError(423, "CONTENT_LOCKED", "This content has an active editing lease. Save from the editor holding that lease.", { lease: leaseDto(lease, actor) });
    }
}
async function listContentPreviews(actor: Actor, body: unknown) { const target = (parse)(previewTargetSchema.strict(), body); return (transaction)(async (client) => { await (lockWorkspace)(client); const current = await sourceFor(client, actor, target); const rows = (await client.query("SELECT * FROM content_previews WHERE document_bucket=$1 AND document_id=$2 ORDER BY created_at DESC LIMIT 100", [target.bucket, target.id])).rows; return { items: rows.filter(row => current.actor.allowedLocales.includes(row.locale)).map(row => previewDto(row, current.actor)) }; }); }
async function createContentPreview(actor: Actor, body: unknown) { const input = (parse)(previewTargetSchema.extend({ locale: z.enum(["fa", "en", "tr", "ar", "ru"]), expiresInMinutes: z.number().int().min(5).max(10080).default(60) }).strict(), body); await (rateLimit)("content-preview:" + actor.id, 30, 3600); return (transaction)(async (client) => { await (lockWorkspace)(client); const current = await sourceFor(client, actor, input, input.locale, true); assert(!("fields" in current.source),422,"PREVIEW_KIND","Forms are previewed inside their reviewed page."); const snapshot = (publicationForSource)(current.source, input.locale); const revision = await (ensureRevision)(client, input.bucket, current.source, input.locale); const token = (randomBytes)(32).toString("hex"); const row = (await client.query(`INSERT INTO content_previews(id,token_hash,document_bucket,document_id,locale,revision_id,snapshot,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now()+($9::integer*interval '1 minute')) RETURNING *`, [(randomUUID)(), (hash)(token), input.bucket, input.id, input.locale, revision.id, JSON.stringify(snapshot), actor.id, input.expiresInMinutes])).rows[0]; await (audit)(actor.id, "content.preview.created", input.bucket, input.id, { previewId: row.id, revisionId: revision.id, expiresAt: row.expires_at.toISOString() }, client); return { ...previewDto(row, current.actor), url: (config)().siteUrl + "/api/v1/content-previews/" + token }; }); }
async function revokeContentPreview(actor: Actor, id: string) { (assert)(z.string().uuid().safeParse(id).success, 404, "NOT_FOUND", "Preview not found."); return (transaction)(async (client) => { await (lockWorkspace)(client); const row = (await client.query("SELECT * FROM content_previews WHERE id=$1 FOR UPDATE", [id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Preview not found."); const current = await sourceFor(client, actor, { bucket: row.document_bucket, id: row.document_id }, row.locale); (assert)(row.created_by === actor.id || ["admin", "superAdmin"].includes(current.actor.role), 403, "FORBIDDEN", "Only the creator or an administrator can revoke this preview."); await client.query("UPDATE content_previews SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1", [id]); await (audit)(actor.id, "content.preview.revoked", row.document_bucket, row.document_id, { previewId: id }, client); return { ok: true }; }); }
const escape = (value: string) => value.replace(/[&<>"']/g, (character: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string,string>)[character]);
function rich(text: string) {
    return (parseRichText)(text).map(block => {
        switch (block.type) {
            case "heading": return `<h${Math.min(6, block.level + 1)}>${escape(block.text)}</h${Math.min(6, block.level + 1)}>`;
            case "code": return `<pre><code>${escape(block.text)}</code></pre>`;
            case "rule": return "<hr>";
            case "list": return `<${block.ordered ? "ol" : "ul"}>${block.items.map(item => "<li>" + escape(item) + "</li>").join("")}</${block.ordered ? "ol" : "ul"}>`;
            case "table": return `<div class="table"><table><thead><tr>${block.head.map(cell => "<th>" + escape(cell) + "</th>").join("")}</tr></thead><tbody>${block.rows.map(row => "<tr>" + row.map(cell => "<td>" + escape(cell) + "</td>").join("") + "</tr>").join("")}</tbody></table></div>`;
            case "quote": return "<blockquote>" + escape(block.text) + "</blockquote>";
            default: return "<p>" + escape(block.text) + "</p>";
        }
    }).join("");
}
async function allowedImage(client: PoolClient, path?: string) {
    if (!path || !/^\/(?!\/)/.test(path) || path.includes("..") || /[?#]/.test(path))
        return null;
    if (/^\/media\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(path))
        return path;
    const match = /^\/api\/v1\/media\/([a-f0-9-]{36})\/content$/.exec(path);
    if (!match)
        return null;
    return (await client.query("SELECT 1 FROM assets WHERE id=$1 AND visibility='public' AND scan_status='clean' AND deleted_at IS NULL AND mime_type LIKE 'image/%' AND metadata->>'rights'='true'", [match[1]])).rowCount ? path : null;
}
async function blockHtml(client: PoolClient, block: PageBlock) {
    if (block.hidden)
        return "";
    if (block.type === "divider")
        return "<hr>";
    const photo = await allowedImage(client, block.mediaUrl);
    return `<section>${block.title ? "<h2>" + escape(block.title) + "</h2>" : ""}${photo ? '<img src="' + escape(photo) + '" alt="' + escape(block.title) + '">' : ""}${rich(block.body)}${block.type === "form" ? '<p class="note">Form preview \xB7 submissions are disabled.</p>' : ""}</section>`;
}
async function contentPreviewResponse(request: Request, token: string) {
    (assert)(/^[a-f0-9]{64}$/.test(token), 404, "NOT_FOUND", "Preview not found.");
    await (rateLimit)("content-preview-read:" + (visitorKey)(request), 90, 60);
    const html = await (transaction)(async (client) => {
        await (lockWorkspace)(client);
        const row = (await client.query("SELECT * FROM content_previews WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR SHARE", [(hash)(token)])).rows[0];
        (assert)(row && row.expires_at.getTime() > Date.now(), 404, "NOT_FOUND", "This preview is unavailable or has expired.");
        const creator: Actor = { id: row.created_by, email: "", name: "", role: "customer", qualityScope: false, allowedLocales: [], mfaVerified: true };
        try {
            await sourceFor(client, creator, { bucket: row.document_bucket, id: row.document_id }, row.locale, true);
        }
        catch (error) {
            if (error instanceof HttpError && [401, 403, 404].includes(error.status))
                throw new HttpError(404, "NOT_FOUND", "This preview is unavailable or has expired.");
            throw error;
        }
        const publication = row.snapshot as PublishedContent;
        const content = publication.blocks.length ? (await Promise.all(publication.blocks.map(block => blockHtml(client, block)))).join("") : rich(publication.body);
        const rtl = ["fa", "ar"].includes(row.locale);
        const notice = row.locale === "fa" ? "\u067E\u06CC\u0634\u200C\u0646\u0645\u0627\u06CC\u0634 \u0646\u0633\u062E\u0647\u0654 \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647\u061B \u0627\u06CC\u0646 \u0644\u06CC\u0646\u06A9 \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631 \u0627\u0633\u062A. \u0641\u0631\u0645\u200C\u0647\u0627 \u0648 \u0627\u062C\u0632\u0627\u06CC \u067E\u0648\u06CC\u0627 \u062F\u0631 \u0627\u06CC\u0646 \u0646\u0645\u0627 \u062A\u0639\u0627\u0645\u0644\u06CC \u0646\u06CC\u0633\u062A\u0646\u062F." : "Saved content preview \xB7 this link expires. Forms and dynamic components are not interactive in this view.";
        return `<!doctype html><html lang="${row.locale}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(publication.title)} \xB7 Preview</title><style>body{margin:0;background:#edf6f5;color:#143637;font:18px/1.9 system-ui,sans-serif}.notice{padding:12px 5%;background:#173d3f;color:#fff;font-size:14px}main{max-width:1060px;margin:32px auto;padding:40px 5%;background:#fff;border-radius:24px;box-shadow:0 10px 40px #17484b12}h1{font-size:clamp(28px,5vw,50px);line-height:1.35}h2{font-size:30px;line-height:1.5}section{margin:2.5rem 0}p,li,blockquote{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%;height:auto;border-radius:16px}.note,small{color:#547777}pre{overflow:auto;padding:20px;background:#102f33;color:#e2f7f4;direction:ltr;text-align:left;border-radius:12px}.table{overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cde2df;padding:10px;text-align:start}blockquote{border-inline-start:4px solid #148e89;margin-inline:0;padding-inline:24px}hr{border:0;border-top:1px solid #cde2df}@media(max-width:600px){main{border-radius:0;margin:0;padding:24px 6%}}</style></head><body><aside class="notice">${escape(notice)}</aside><main><small>${escape(row.locale.toUpperCase())} \xB7 ${escape(row.revision_id)}</small><h1>${escape(publication.title)}</h1>${publication.summary ? "<p>" + escape(publication.summary) + "</p>" : ""}${content}</main></body></html>`;
    });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "Expires": "0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox" } });
}
async function cleanupContentCollaboration() { await (query)("DELETE FROM content_edit_leases WHERE lease_until<now()-interval '1 hour'"); await (query)("DELETE FROM content_previews WHERE id IN (SELECT id FROM content_previews WHERE expires_at<now()-interval '30 days' ORDER BY expires_at LIMIT 100)"); }
export { acquireContentLease, assertContentLeaseWrites, cleanupContentCollaboration, contentLeaseTokens, contentPreviewResponse, createContentPreview, getContentLease, listContentPreviews, renewContentLease, revokeContentPreview };
