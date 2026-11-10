import type {PgRow} from './recovered-db-rows';
import type {WishlistReference,WishlistDraftItem} from '../lib/wishlist-references';
import type {WishlistCandidate} from '../lib/wishlist-catalog';
import type {InquiryLine} from '../types/frontend';
type WishlistRow=PgRow<'wishlists'>;
type WishlistItemRow=PgRow<'wishlist_items',{reference:WishlistReference}>;
type WishlistShareRow=PgRow<'wishlist_shares',{item_references:WishlistReference[]}>;
type SavedCollection={inquiries:InquiryLine[];compare:string[];saved?:string[]};
import type { PoolClient } from 'pg';
import type { Actor } from './types';
import type { Locale } from '../lib/i18n';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { wishlistPublicationKinds, wishlistLimits, wishlistKey, resolveSavedReference, wishlistSavedId } from "../lib/wishlist-references";
import { assert } from "./types";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { getPublicSite } from "./workspace";
import { publicWishlistCandidates, wishlistPageHref } from "../lib/wishlist-catalog";
import { wishlistResourceCandidates } from "./resources";
import { isPublicArticleVisible, isPublicPathVisible } from "../lib/public-visibility";
import { parse, rateLimit, visitorKey, json } from "./http";
import { audit, transaction } from "./db";
import { config } from "./config";
import { loadCrmAccess } from "./workspace-scopes";
const localeSchema = z.enum(["fa", "en", "tr", "ar", "ru"]);
const idSchema = z.string().min(1).max(160).refine(value => !/[:\s\u0000-\u001f\u007f/\\?#]/.test(value), "Use a content identifier, not a URL.");
const referenceSchema = z.union([z.object({ kind: z.enum(["product", "article", "resource", "reference", "document"]), id: idSchema }).strict(), z.object({ kind: z.literal("publication"), id: idSchema, publicationKind: z.enum(wishlistPublicationKinds) }).strict(), z.object({ kind: z.literal("legacy"), id: z.string().min(1).max(240) }).strict()]);
const privateText = (max: number) => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Control characters are forbidden.");
const nameSchema = z.string().trim().min(1).max(120).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Use a single-line name.");
const metadataSchema = z.object({ name: nameSchema, description: privateText(2e3).default(""), purpose: z.enum(["general", "project"]).default("general") }).strict();
const inputSchema = metadataSchema.extend({ items: z.array(z.object({ id: z.string().uuid().optional(), reference: referenceSchema, note: privateText(2e3).default("") }).strict()).max(wishlistLimits.itemsPerList) }).strict();
const uuid = (value: string) => (assert)(z.string().uuid().safeParse(value).success, 404, "NOT_FOUND", "Saved list not found.");
const version = (expected: number, actual: number) => (assert)(Number.isSafeInteger(expected) && expected === actual, 409, "WISHLIST_CONFLICT", "This list changed in another session. Load the current version and review your changes.");
const tokenHash = (value: string) => (createHash)("sha256").update(value).digest("hex");
async function ownerLock(client: PoolClient, actor: Actor) { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR SHARE"); (assert)((await client.query("SELECT 1 FROM users WHERE id=$1 AND active FOR SHARE", [actor.id])).rowCount, 401, "UNAUTHORIZED", "Your account is unavailable."); await loadCrmAccess(actor,client); await client.query("INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING", [actor.id]); return (await client.query<{collection:SavedCollection;wishlists_migrated_at:Date|null}>("SELECT collection,wishlists_migrated_at FROM user_settings WHERE user_id=$1 FOR UPDATE", [actor.id])).rows[0]; }
async function candidates(client: PoolClient, actor: Actor | null, locale: Locale) : Promise<WishlistCandidate[]> {
    const site = await (getPublicSite)(client);
    const hidden = [...site.hiddenProducts, ...Object.entries(site.hiddenProductLocales).filter(([, languages]) => languages.includes(locale)).map(([id]) => id)];
    const publicItems = (publicWishlistCandidates)(site.publications, hidden, locale, site);
    for (const document of await (wishlistResourceCandidates)(client, actor, locale)) {
        const href = (wishlistPageHref)(locale, "resources/" + document.slug);
        if (!href)
            continue;
        publicItems.push({ reference: { kind: "document", id: document.id }, title: document.title, summary: document.summary, href, category: "document", public: document.public });
    }
    return publicItems.filter(item => (item.reference.kind !== "article" || (isPublicArticleVisible)(site, locale, item.reference.id)) && (isPublicPathVisible)(site, locale, item.href.slice(("/" + locale + "/").length).replace(/\/+$/, "")));
}
const itemRows = async (client: PoolClient, listId: string) : Promise<WishlistItemRow[]> => (await client.query<WishlistItemRow>("SELECT * FROM wishlist_items WHERE wishlist_id=$1 ORDER BY position,id", [listId])).rows;
function summary(row: WishlistRow, itemCount: number) { return { id: row.id, name: row.name, description: row.description, purpose: row.purpose, isDefault: row.is_default, version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), itemCount }; }
async function listDto(client: PoolClient, actor: Actor, row: WishlistRow, locale: Locale) { const available = new Map((await candidates(client, actor, locale)).map(item => [(wishlistKey)(item.reference), item])); const items = (await itemRows(client, row.id)).map(item => ({ id: item.id, reference: item.reference, note: item.note, position: item.position, createdAt: item.created_at.toISOString(), available: available.has(item.reference_key), content: available.get(item.reference_key) || null })); const { itemCount, ...metadata } = summary(row, items.length); void itemCount; return { ...metadata, items }; }
async function ensureDefault(client: PoolClient, actor: Actor) {
    const settings = await ownerLock(client, actor);
    let row = (await client.query<WishlistRow>("SELECT * FROM wishlists WHERE user_id=$1 AND is_default FOR UPDATE", [actor.id])).rows[0];
    if (row)
        return row;
    (assert)(!settings.wishlists_migrated_at, 409, "WISHLIST_MIGRATION", "The default list needs operator recovery. Existing saved data was not overwritten.");
    row = (await client.query<WishlistRow>("INSERT INTO wishlists(id,user_id,name,is_default) VALUES($1,$2,'Saved items',true) RETURNING *", [(randomUUID)(), actor.id])).rows[0];
    const values = Array.isArray(settings.collection.saved) ? settings.collection.saved.filter(value => typeof value === "string" && value.length > 0 && value.length <= 240).slice(0, wishlistLimits.itemsPerList) : [];
    const refs: WishlistReference[] = [];
    if (values.length) {
        for (const locale of ["fa", "en", "tr", "ar", "ru"] as const)
            for (const item of await candidates(client, actor, locale))
                if (!refs.some(ref => (wishlistKey)(ref) === (wishlistKey)(item.reference)))
                    refs.push(item.reference);
    }
    const seen = new Set;
    let position = 0;
    for (const value of values) {
        const reference: WishlistReference = (resolveSavedReference)(value, refs) || { kind: "legacy", id: value }, key = (wishlistKey)(reference);
        if (seen.has(key))
            continue;
        seen.add(key);
        await client.query("INSERT INTO wishlist_items(id,wishlist_id,reference_key,reference,position) VALUES($1,$2,$3,$4::jsonb,$5)", [(randomUUID)(), row.id, key, JSON.stringify(reference), position++]);
    }
    await client.query("UPDATE user_settings SET collection=collection-'saved',wishlists_migrated_at=now() WHERE user_id=$1", [actor.id]);
    return row;
}
async function ownList(client: PoolClient, actor: Actor, id: string) { uuid(id); const row = (await client.query<WishlistRow>("SELECT * FROM wishlists WHERE id=$1 AND user_id=$2 FOR UPDATE", [id, actor.id])).rows[0]; (assert)(row, 404, "NOT_FOUND", "Saved list not found."); return row; }
async function uniqueName(client: PoolClient, actor: Actor, name: string, id?: string) { (assert)(!(await client.query("SELECT 1 FROM wishlists WHERE user_id=$1 AND lower(name)=lower($2) AND ($3::uuid IS NULL OR id<>$3)", [actor.id, name, id || null])).rowCount, 409, "WISHLIST_NAME", "You already have a list with this name."); }
async function totalLimit(client: PoolClient, actor: Actor, removed: number, added: number) { const total = Number((await client.query("SELECT count(*) AS total FROM wishlist_items i JOIN wishlists w ON w.id=i.wishlist_id WHERE w.user_id=$1", [actor.id])).rows[0].total); (assert)(total - removed + added <= wishlistLimits.totalItems, 409, "WISHLIST_LIMIT", "Your saved lists reached the total item limit."); }
async function readWishlistCollection(client: PoolClient, actor: Actor) { const row = await ensureDefault(client, actor), settings = (await client.query<{collection:SavedCollection;wishlists_migrated_at:Date|null}>("SELECT collection,wishlists_migrated_at FROM user_settings WHERE user_id=$1", [actor.id])).rows[0]; return { ...settings.collection, inquiries: settings.collection.inquiries || [], compare: settings.collection.compare || [], saved: (await itemRows(client, row.id)).map(item => (wishlistSavedId)(item.reference)), savedVersion: row.version, defaultWishlistId: row.id }; }
async function replaceWishlistSaved(client: PoolClient, actor: Actor, values: readonly string[], expected: number | undefined, localeInput: unknown) {
    const locale = (parse)(localeSchema, localeInput), row = await ensureDefault(client, actor);
    version(expected!, row.version);
    const old = await itemRows(client, row.id), available = await candidates(client, actor, locale), next = [];
    for (const value of values) {
        const reference = (resolveSavedReference)(value, available.map(item => item.reference), old.map(item => item.reference));
        (assert)(reference, 422, "WISHLIST_ITEM_UNAVAILABLE", "Select an available published item.");
        const previous = old.find(item => item.reference_key === (wishlistKey)(reference));
        next.push({ ...previous ? { id: previous.id } : {}, reference, note: previous?.note || "" });
    }
    await persistItems(client, actor, row, old, next, available);
    await client.query("UPDATE wishlists SET version=version+1,updated_at=now() WHERE id=$1", [row.id]);
    await (audit)(actor.id, "wishlist.default.updated", "wishlist", row.id, { itemCount: next.length }, client);
}
async function persistItems(client: PoolClient, actor: Actor, row: WishlistRow, old: WishlistItemRow[], next: WishlistDraftItem[], available: WishlistCandidate[]) {
    (assert)(next.length <= wishlistLimits.itemsPerList, 422, "WISHLIST_LIMIT", "This list reached the item limit.");
    const current = new Map(old.map(item => [item.id, item])), publicKeys = new Set(available.map(item => (wishlistKey)(item.reference))), keys = new Set, ids = new Set;
    for (const item of next) {
        const key = (wishlistKey)(item.reference);
        (assert)(!keys.has(key), 422, "WISHLIST_DUPLICATE", "A list can contain each item once.");
        keys.add(key);
        if (item.id) {
            const original = current.get(item.id);
            (assert)(original && original.reference_key === key && !ids.has(item.id), 422, "WISHLIST_ITEM", "An item identity cannot be replaced.");
            ids.add(item.id);
        }
        else
            (assert)(item.reference.kind !== "legacy" && publicKeys.has(key), 422, "WISHLIST_ITEM_UNAVAILABLE", "Select an available published item.");
    }
    await totalLimit(client, actor, old.length, next.length);
    await client.query("DELETE FROM wishlist_items WHERE wishlist_id=$1 AND NOT(id=ANY($2::uuid[]))", [row.id, [...ids]]);
    for (const [position, item] of next.entries()) {
        if (item.id)
            await client.query("UPDATE wishlist_items SET note=$2,position=$3 WHERE id=$1 AND wishlist_id=$4", [item.id, item.note, position, row.id]);
        else
            await client.query("INSERT INTO wishlist_items(id,wishlist_id,reference_key,reference,note,position) VALUES($1,$2,$3,$4::jsonb,$5,$6)", [(randomUUID)(), row.id, (wishlistKey)(item.reference), JSON.stringify(item.reference), item.note, position]);
    }
}
async function listWishlists(actor: Actor) { return (transaction)(async (client) => { const root = await ensureDefault(client, actor); const rows = (await client.query("SELECT w.*,count(i.id)::text AS item_count FROM wishlists w LEFT JOIN wishlist_items i ON i.wishlist_id=w.id WHERE w.user_id=$1 GROUP BY w.id ORDER BY w.is_default DESC,w.created_at,w.id", [actor.id])).rows; return { items: rows.map(row => summary(row, Number(row.item_count))), defaultId: root.id, limits: { ...wishlistLimits } }; }); }
async function getWishlist(actor: Actor, id: string, localeInput = "fa") { const locale = (parse)(localeSchema, localeInput); return (transaction)(async (client) => { await ensureDefault(client, actor); return listDto(client, actor, await ownList(client, actor, id), locale); }); }
async function createWishlist(actor: Actor, body: unknown, localeInput = "fa") { const input = (parse)(metadataSchema, body), locale = (parse)(localeSchema, localeInput); return (transaction)(async (client) => { await ensureDefault(client, actor); (assert)(Number((await client.query("SELECT count(*) AS n FROM wishlists WHERE user_id=$1", [actor.id])).rows[0].n) < wishlistLimits.lists, 409, "WISHLIST_LIMIT", "You reached the saved list limit."); await uniqueName(client, actor, input.name); const row = (await client.query<WishlistRow>("INSERT INTO wishlists(id,user_id,name,description,purpose) VALUES($1,$2,$3,$4,$5) RETURNING *", [(randomUUID)(), actor.id, input.name, input.description, input.purpose])).rows[0]; await (audit)(actor.id, "wishlist.created", "wishlist", row.id, { purpose: input.purpose }, client); return listDto(client, actor, row, locale); }); }
async function updateWishlist(actor: Actor, id: string, body: unknown, expected: number, localeInput = "fa") { const input = (parse)(inputSchema, body), locale = (parse)(localeSchema, localeInput); return (transaction)(async (client) => { await ensureDefault(client, actor); const row = await ownList(client, actor, id); version(expected!, row.version); await uniqueName(client, actor, input.name, id); const available = await candidates(client, actor, locale); await persistItems(client, actor, row, await itemRows(client, id), input.items, available); const next = (await client.query<WishlistRow>("UPDATE wishlists SET name=$2,description=$3,purpose=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id, input.name, input.description, input.purpose])).rows[0]; await (audit)(actor.id, "wishlist.updated", "wishlist", id, { version: next.version, itemCount: input.items.length }, client); return listDto(client, actor, next, locale); }); }
async function deleteWishlist(actor: Actor, id: string, expected: number) { return (transaction)(async (client) => { await ensureDefault(client, actor); const row = await ownList(client, actor, id); version(expected!, row.version); (assert)(!row.is_default, 409, "DEFAULT_WISHLIST", "Clear the default list instead of deleting it. Other named lists can be deleted."); await client.query("DELETE FROM wishlists WHERE id=$1", [id]); await (audit)(actor.id, "wishlist.deleted", "wishlist", id, {}, client); return { ok: true }; }); }
async function transferWishlistItems(actor: Actor, id: string, body: unknown, expected: number, localeInput = "fa") {
    const input = (parse)(z.object({ targetId: z.string().uuid(), targetVersion: z.number().int().positive(), itemIds: z.array(z.string().uuid()).min(1).max(wishlistLimits.itemsPerList), mode: z.enum(["move", "copy"]) }).strict(), body), locale = (parse)(localeSchema, localeInput);
    (assert)(id !== input.targetId, 422, "WISHLIST_TARGET", "Choose a different destination list.");
    return (transaction)(async (client) => {
        await ensureDefault(client, actor);
        const source = await ownList(client, actor, id), target = await ownList(client, actor, input.targetId);
        version(expected, source.version);
        version(input.targetVersion, target.version);
        const sourceItems = await itemRows(client, id), targetItems = await itemRows(client, target.id), selected = sourceItems.filter(item => input.itemIds.includes(item.id));
        (assert)(selected.length === input.itemIds.length && new Set(input.itemIds).size === input.itemIds.length, 422, "WISHLIST_ITEM", "Select existing items once.");
        (assert)(targetItems.length + selected.length <= wishlistLimits.itemsPerList, 409, "WISHLIST_LIMIT", "The destination list reached the item limit.");
        (assert)(selected.every(item => !targetItems.some(targetItem => targetItem.reference_key === item.reference_key)), 409, "WISHLIST_DUPLICATE", "The destination already contains a selected item. Its notes were not overwritten.");
        await totalLimit(client, actor, input.mode === "move" ? selected.length : 0, selected.length);
        for (const [offset, item] of selected.entries())
            await client.query("INSERT INTO wishlist_items(id,wishlist_id,reference_key,reference,note,position) VALUES($1,$2,$3,$4::jsonb,$5,$6)", [(randomUUID)(), target.id, item.reference_key, JSON.stringify(item.reference), item.note, targetItems.length + offset]);
        if (input.mode === "move") {
            await client.query("DELETE FROM wishlist_items WHERE wishlist_id=$1 AND id=ANY($2::uuid[])", [id, input.itemIds]);
            for (const [position, item] of sourceItems.filter(item2 => !input.itemIds.includes(item2.id)).entries())
                await client.query("UPDATE wishlist_items SET position=$2 WHERE id=$1", [item.id, position]);
        }
        const targetRow = (await client.query<WishlistRow>("UPDATE wishlists SET version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [target.id])).rows[0];
        const sourceRow = input.mode === "move" ? (await client.query<WishlistRow>("UPDATE wishlists SET version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id])).rows[0] : source;
        await (audit)(actor.id, "wishlist.items." + input.mode, "wishlist", id, { targetId: target.id, itemCount: selected.length }, client);
        return { source: await listDto(client, actor, sourceRow, locale), target: await listDto(client, actor, targetRow, locale) };
    });
}
async function wishlistCatalog(actor: Actor, options = {}) {
    const input = (parse)(z.object({ locale: localeSchema.default("fa"), search: z.string().trim().max(120).default(""), category: z.enum(["all", "product", "article", "document", "page"]).default("all"), cursor: z.string().max(700).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict(), options);
    let after = "";
    if (input.cursor) {
        try {
            after = Buffer.from(input.cursor, "base64url").toString("utf8");
        }
        catch {
            (assert)(false, 422, "CURSOR", "The catalog cursor is invalid.");
        }
        (assert)(after.length <= 260 && Buffer.from(after).toString("base64url") === input.cursor, 422, "CURSOR", "The catalog cursor is invalid.");
    }
    return (transaction)(async (client) => { await ownerLock(client, actor); const needle = input.search.toLocaleLowerCase(input.locale); const available = (await candidates(client, actor, input.locale)).filter(item => (input.category === "all" || item.category === input.category) && (!needle || `${item.title} ${item.summary} ${item.reference.id}`.toLocaleLowerCase(input.locale).includes(needle))).sort((a, b) => (wishlistKey)(a.reference).localeCompare((wishlistKey)(b.reference), "en")); const result = available.filter(item => !after || (wishlistKey)(item.reference).localeCompare(after, "en") > 0).slice(0, input.limit + 1); const hasMore = result.length > input.limit, items = result.slice(0, input.limit); return { items, nextCursor: hasMore ? Buffer.from((wishlistKey)(items.at(-1)!.reference)).toString("base64url") : null }; });
}
const shareDto = (row: WishlistShareRow) => ({ id: row.id, title: row.title, locale: row.locale, sourceVersion: row.source_version, itemCount: row.item_references.length, expiresAt: row.expires_at.toISOString(), createdAt: row.created_at.toISOString(), revokedAt: row.revoked_at?.toISOString() || null, version: row.version });
async function sharePreview(client: PoolClient, actor: Actor, row: WishlistRow, locale: Locale) { const available = new Map((await candidates(client, null, locale)).filter(item => item.public).map(item => [(wishlistKey)(item.reference), item])); const stored = await itemRows(client, row.id), items = stored.flatMap(item => { const content = available.get(item.reference_key); return content ? [{ itemId: item.id, content }] : []; }); return { listId: row.id, version: row.version, locale, excludedCount: stored.length - items.length, items }; }
async function previewWishlistShare(actor: Actor, id: string, localeInput = "fa") { const locale = (parse)(localeSchema, localeInput); return (transaction)(async (client) => { await ensureDefault(client, actor); return sharePreview(client, actor, await ownList(client, actor, id), locale); }); }
async function listWishlistShares(actor: Actor, id: string) { return (transaction)(async (client) => { await ensureDefault(client, actor); await ownList(client, actor, id); const rows = (await client.query<WishlistShareRow>("SELECT * FROM wishlist_shares WHERE wishlist_id=$1 AND (revoked_at IS NULL AND expires_at>now() OR id IN (SELECT id FROM wishlist_shares WHERE wishlist_id=$1 ORDER BY created_at DESC,id LIMIT 100)) ORDER BY created_at DESC,id", [id])).rows; return { items: rows.map(shareDto) }; }); }
async function createWishlistShare(actor: Actor, id: string, body: unknown, expected: number) { const input = (parse)(z.object({ title: nameSchema, locale: localeSchema, expiresInMinutes: z.number().int().min(5).max(wishlistLimits.maxShareMinutes), itemIds: z.array(z.string().uuid()).min(1).max(wishlistLimits.itemsPerList) }).strict(), body); await (rateLimit)("wishlist-share:" + actor.id, 30, 3600); return (transaction)(async (client) => { await ensureDefault(client, actor); const row = await ownList(client, actor, id); version(expected!, row.version); const preview = await sharePreview(client, actor, row, input.locale), selected = preview.items.filter(item => input.itemIds.includes(item.itemId)); (assert)(new Set(input.itemIds).size === input.itemIds.length && selected.length === input.itemIds.length, 409, "WISHLIST_SHARE_CHANGED", "Selected items are no longer publicly available in this language. Review the preview again."); (assert)(Number((await client.query("SELECT count(*) AS n FROM wishlist_shares WHERE wishlist_id=$1 AND revoked_at IS NULL AND expires_at>now()", [id])).rows[0].n) < wishlistLimits.activeShares, 409, "WISHLIST_SHARE_LIMIT", "Revoke an active link before creating another."); const token = (randomBytes)(32).toString("hex"); const saved = (await client.query<WishlistShareRow>("INSERT INTO wishlist_shares(id,wishlist_id,token_hash,title,locale,source_version,item_references,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,now()+($8*interval '1 minute')) RETURNING *", [(randomUUID)(), id, tokenHash(token), input.title, input.locale, row.version, JSON.stringify(selected.map(item => item.content.reference)), input.expiresInMinutes])).rows[0]; await (audit)(actor.id, "wishlist.share.created", "wishlist_share", saved.id, { listId: id, sourceVersion: row.version, itemCount: selected.length, locale: input.locale, expiresAt: saved.expires_at.toISOString() }, client); return { share: shareDto(saved), url: (config)().siteUrl + `/${input.locale}/saved-share/${token}/` }; }); }
async function revokeWishlistShare(actor: Actor, id: string, shareId: string, expected: number) {
    uuid(shareId);
    return (transaction)(async (client) => {
        await ensureDefault(client, actor);
        await ownList(client, actor, id);
        const row = (await client.query<WishlistShareRow>("SELECT * FROM wishlist_shares WHERE id=$1 AND wishlist_id=$2 FOR UPDATE", [shareId, id])).rows[0];
        (assert)(row, 404, "NOT_FOUND", "Share link not found.");
        version(expected!, row.version);
        if (row.revoked_at)
            return shareDto(row);
        const updated = (await client.query<WishlistShareRow>("UPDATE wishlist_shares SET revoked_at=now(),version=version+1 WHERE id=$1 RETURNING *", [shareId])).rows[0];
        await (audit)(actor.id, "wishlist.share.revoked", "wishlist_share", shareId, { listId: id }, client);
        return shareDto(updated);
    });
}
async function getPublicWishlist(token: string, localeInput: unknown) { const locale = (parse)(localeSchema, localeInput); (assert)(/^[a-f0-9]{64}$/.test(token), 404, "NOT_FOUND", "This share link is unavailable."); return (transaction)(async (client) => { await client.query("SELECT singleton FROM workspace_meta WHERE singleton=true FOR SHARE"); const identity = (await client.query("SELECT s.id,s.wishlist_id,w.user_id FROM wishlist_shares s JOIN wishlists w ON w.id=s.wishlist_id WHERE s.token_hash=$1 AND s.locale=$2", [tokenHash(token), locale])).rows[0]; (assert)(identity, 404, "NOT_FOUND", "This share link is unavailable."); (assert)((await client.query("SELECT 1 FROM users WHERE id=$1 AND active FOR SHARE", [identity.user_id])).rowCount, 404, "NOT_FOUND", "This share link is unavailable."); (assert)((await client.query("SELECT 1 FROM wishlists WHERE id=$1 AND user_id=$2 FOR SHARE", [identity.wishlist_id, identity.user_id])).rowCount, 404, "NOT_FOUND", "This share link is unavailable."); const share = (await client.query<WishlistShareRow>("SELECT * FROM wishlist_shares WHERE id=$1 AND token_hash=$2 AND locale=$3 AND revoked_at IS NULL AND expires_at>now() FOR SHARE", [identity.id, tokenHash(token), locale])).rows[0]; (assert)(share, 404, "NOT_FOUND", "This share link is unavailable."); const current = new Map((await candidates(client, null, locale)).filter(item => item.public).map(item => [(wishlistKey)(item.reference), item])); const items = share.item_references.flatMap(reference => { const item = current.get((wishlistKey)(reference)); return item ? [item] : []; }); return { schemaVersion: 1 as const, title: share.title, locale, expiresAt: share.expires_at.toISOString(), items }; }); }
async function wishlistShareResponse(request: Request, token: string) { await (rateLimit)("wishlist-public:" + (visitorKey)(request), 120, 60); return (json)(await getPublicWishlist(token, new URL(request.url).searchParams.get("locale") || "fa"), 200, { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" }); }
export { createWishlist, createWishlistShare, deleteWishlist, getPublicWishlist, getWishlist, listWishlistShares, listWishlists, previewWishlistShare, readWishlistCollection, replaceWishlistSaved, revokeWishlistShare, transferWishlistItems, updateWishlist, wishlistCatalog, wishlistShareResponse };
