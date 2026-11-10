import type {InquiryLine} from '../types/frontend';
import type {ProductRelease} from '../lib/product-release';
type InquiryIssue={index:number;code:'product_unavailable'|'variant_unavailable'|'variant_changed'|'quantity_limit'|'line_limit'};

import type { PoolClient } from 'pg';
import type { Actor } from './types';
import type { Locale } from '../lib/i18n';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { readWishlistCollection } from "./wishlists";
import { getPublicSite } from "./workspace";
import { products } from "../data/catalog";
import { parse, rateLimit } from "./http";
import { hash } from "./crypto";
import { transaction, audit } from "./db";
import { assert, HttpError } from "./types";
import { inquiryIdentity } from "../lib/frontend-state";
const field = (max: number) => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Control characters are forbidden.");
const inquiryLineSchema = z.object({ productId: field(100).min(1), quantity: z.number().int().min(1).max(1e5), shade: field(240).optional(), mould: field(240).optional(), note: field(1e3).optional(), variantId: field(240).optional(), sku: field(240).optional(), unit: field(240).optional() }).strict();
const mergeSchema = z.object({ id: z.string().uuid(), locale: z.enum(["fa", "en", "tr", "ar", "ru"]), items: z.array(inquiryLineSchema).min(1).max(500) }).strict();
async function readInquiryCollection(client: PoolClient, actor: Actor) { const value = await (readWishlistCollection)(client, actor), row = (await client.query("SELECT collection_version FROM user_settings WHERE user_id=$1", [actor.id])).rows[0]; return { ...value, collectionVersion: row.collection_version }; }
async function validateGuestLines(client: PoolClient, items: InquiryLine[], locale: Locale) : Promise<InquiryIssue[]> {
    const site = await (getPublicSite)(client), hidden = new Set([...site.hiddenProducts, ...Object.entries(site.hiddenProductLocales).filter(([, languages]) => languages.includes(locale)).map(([id]) => id)]);
    const available = new Map<string,{family:"teeth"|"materials";variants:ProductRelease["variants"]}>(products.filter(product => !hidden.has(product.id)).map(product => [product.id, { family: product.family, variants: [] }]));
    for (const publication of site.publications.filter(row => row.locale === locale && ["product", "products"].includes(row.kind)).sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.version - b.version)) {
        const id = publication.productRelease?.productId || publication.customProduct?.id || publication.id;
        if (hidden.has(id))
            continue;
        const current = available.get(id), custom = publication.customProduct;
        if (current || custom)
            available.set(id, { family: publication.productRelease?.family || custom?.family || current!.family, variants: publication.productRelease?.variants || [] });
    }
    const issues: InquiryIssue[] = [];
    items.forEach((line, index) => {
        const product = available.get(line.productId);
        if (!product) {
            issues.push({ index, code: "product_unavailable" });
            return;
        }
        if (line.variantId) {
            const variant = product.variants.find(row => row.id === line.variantId);
            if (!variant) {
                issues.push({ index, code: "variant_unavailable" });
                return;
            }
            if ((["sku", "unit", "shade", "mould"] as const).some(key => (line[key] || "") !== (variant[key] || "")))
                issues.push({ index, code: "variant_changed" });
        }
        else if (line.sku || line.unit)
            issues.push({ index, code: "variant_unavailable" });
        if (product.family !== "teeth" && (line.shade || line.mould))
            issues.push({ index, code: "variant_changed" });
    });
    return issues;
}
async function mergeGuestInquiries(actor: Actor, body: unknown) {
    const input = (parse)(mergeSchema, body), requestHash = (hash)(JSON.stringify(input));
    await (rateLimit)("inquiry-merge:" + actor.id, 30, 3600);
    return (transaction)(async (client) => {
        const current = await readInquiryCollection(client, actor);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["inquiry-merge:" + input.id]);
        const existing = (await client.query("SELECT user_id,request_hash,summary FROM inquiry_merge_receipts WHERE id=$1", [input.id])).rows[0];
        if (existing) {
            (assert)(existing.user_id === actor.id && existing.request_hash === requestHash, 409, "IDEMPOTENCY_CONFLICT", "This inquiry merge identifier is already bound to another intent.");
            return { collection: current, summary: existing.summary, duplicate: true };
        }
        (assert)(Number((await client.query("SELECT count(*) AS count FROM inquiry_merge_receipts WHERE user_id=$1", [actor.id])).rows[0].count) < 5e3, 409, "INQUIRY_MERGE_LIMIT", "This account reached its retained inquiry merge limit. Contact support.");
        const issues = await validateGuestLines(client, input.items, input.locale), next = current.inquiries.map(line => ({ ...line }));
        let addedLines = 0, combinedLines = 0;
        input.items.forEach((line, index) => {
            const key = (inquiryIdentity)(line), match = next.find(item => (inquiryIdentity)(item) === key && (item.note || "") === (line.note || ""));
            if (match) {
                if (match.quantity + line.quantity > 1e5)
                    issues.push({ index, code: "quantity_limit" });
                else {
                    match.quantity += line.quantity;
                    combinedLines++;
                }
            }
            else {
                next.push({ ...line });
                addedLines++;
                if (next.length > 500)
                    issues.push({ index, code: "line_limit" });
            }
        });
        if (issues.length)
            throw new HttpError(422, "INQUIRY_MERGE_REVIEW", "Review the identified guest lines before merging. No inquiry line was changed.", { issues });
        const summary = { sourceLines: input.items.length, addedLines, combinedLines, totalLines: next.length };
        await client.query("UPDATE user_settings SET collection=jsonb_set(collection,'{inquiries}',$2::jsonb),collection_version=collection_version+1 WHERE user_id=$1", [actor.id, JSON.stringify(next)]);
        await client.query("INSERT INTO inquiry_merge_receipts(id,user_id,request_hash,summary) VALUES($1,$2,$3,$4::jsonb)", [input.id, actor.id, requestHash, JSON.stringify(summary)]);
        await (audit)(actor.id, "account.inquiries.merged", "inquiry_merge", input.id, summary, client);
        return { collection: await readInquiryCollection(client, actor), summary, duplicate: false };
    });
}
export { inquiryLineSchema, mergeGuestInquiries, readInquiryCollection };
