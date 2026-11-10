import type { PoolClient } from 'pg';
import type {SupportedLocale as Locale} from '../types/domain';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { articles, products } from "../data/catalog";
import { editablePublicTargets } from "../lib/site-content";
import { publicationPath } from "../lib/publication-path";
const locales = ["fa", "en", "tr", "ar", "ru"] as const;
const articleIds = articles.map(item => item.id);
const productIds = products.map(item => item.id);
const pageSources = new Map<string,{locale:Locale;path:string}>(editablePublicTargets.flatMap(target => locales.map(locale => [`site-${target.slug.replaceAll("/", "-")}-${locale}`, { locale, path: target.slug === "home" ? "" : target.slug }])));
const pageSlugs = editablePublicTargets.map(target => target.slug);
const sourceVisibilityAction = "source_visibility_withdrawn";
interface SourceRow {bucket:'records'|'pages';id:string;collection:string|null;product:string|null;locale:Locale|null;slug:string|null;status:string;deleted_at:Date|null;withdrawal:string}
interface ReleaseRow {document_bucket:'records'|'pages';document_id:string;locale:Locale;kind:string;slug:string;unpublished_at:Date|null;published_audit:string;source_available:boolean}
type HiddenLocales=Record<string,Locale[]>;
function isOfficialSource(bucket: string, source: unknown) {
    if (!source || typeof source !== "object")
        return false;
    if (bucket === "records") {
        const value = source as {collection?:string;id:string;product?:string};
        return value.collection === "research" && articleIds.includes(value.id) || value.collection === "products" && (productIds.includes(value.id) || !!value.product && productIds.includes(value.product));
    }
    if (bucket === "pages") {
        const value = source as {id:string;slug:string};
        return pageSources.has(value.id) || pageSlugs.includes(value.slug);
    }
    return false;
}
async function getSourcePublicVisibility(client: PoolClient) {
    const sources = await client.query<SourceRow>(`SELECT e.bucket,e.id,e.collection,e.data->>'product' AS product,e.locale,e.data->>'slug' AS slug,e.status,e.deleted_at,
    COALESCE((SELECT max(a.id) FROM workspace_audit a WHERE a.bucket=e.bucket AND a.entity_id=e.id AND a.action=$5),0)::text AS withdrawal
    FROM workspace_entities e WHERE (e.bucket='records' AND e.collection='research' AND e.id=ANY($1::text[]))
    OR (e.bucket='records' AND e.collection='products' AND (e.id=ANY($2::text[]) OR e.data->>'product'=ANY($2::text[])))
    OR (e.bucket='pages' AND (e.id=ANY($3::text[]) OR e.data->>'slug'=ANY($4::text[])))`, [articleIds, productIds, [...pageSources.keys()], pageSlugs, sourceVisibilityAction]);
    const releases = await client.query<ReleaseRow>(`SELECT r.document_bucket,r.document_id,r.locale,r.kind,r.slug,r.unpublished_at,
    COALESCE((SELECT max(a.id) FROM workspace_audit a WHERE a.bucket=r.document_bucket AND a.entity_id=r.document_id AND a.action='published' AND a.details->>'locale'=r.locale),0)::text AS published_audit,
    (e.id IS NOT NULL AND e.deleted_at IS NULL AND e.status<>'archived') AS source_available
    FROM locale_releases r LEFT JOIN workspace_entities e ON e.bucket=r.document_bucket AND e.id=r.document_id
    WHERE r.kind IN ('page','product','products') OR (r.kind IN ('research','article','articles') AND r.document_id=ANY($1::text[]))`, [articleIds]);
    const hiddenArticleLocales:HiddenLocales = Object.create(null), hiddenPageLocales:HiddenLocales = Object.create(null), hiddenProductLocales:HiddenLocales = Object.create(null);
    const deny = (map:HiddenLocales, key:string, locale:Locale) => {
        if (!(map[key] ??= []).includes(locale))
            map[key].push(locale);
    };
    for (const source of sources.rows) {
        const sourceLocales = source.bucket === "records" ? locales : source.locale ? [source.locale] : [];
        for (const locale of sourceLocales) {
            const release = releases.rows.find(item => item.document_bucket === source.bucket && item.document_id === source.id && item.locale === locale);
            const withdrawn = !!source.deleted_at || source.status === "archived" || BigInt(source.withdrawal) > 0n && (!release || !!release.unpublished_at || BigInt(release.published_audit) <= BigInt(source.withdrawal));
            if (!withdrawn)
                continue;
            if (source.collection === "products")
                for (const id of new Set([source.id, ...source.product ? [source.product] : []]))
                    deny(hiddenProductLocales, id, locale);
            else if (source.bucket === "records")
                deny(hiddenArticleLocales, source.id, locale);
            else {
                const path = pageSources.get(source.id)?.path ?? (source.slug === "home" ? "" : source.slug);
                if (path !== null && path !== void 0)
                    deny(hiddenPageLocales, path, locale);
            }
        }
    }
    for (const release of releases.rows) {
        if (!release.unpublished_at)
            continue;
        if (release.kind === "page")
            deny(hiddenPageLocales, (publicationPath)(release), release.locale);
        else if (["research", "article", "articles"].includes(release.kind))
            deny(hiddenArticleLocales, release.document_id, release.locale);
    }
    for (const release of releases.rows) {
        if (release.kind !== "page" || release.unpublished_at || !release.source_available)
            continue;
        const source = sources.rows.find(item => item.bucket === release.document_bucket && item.id === release.document_id);
        if (source && BigInt(source.withdrawal) >= BigInt(release.published_audit) && BigInt(source.withdrawal) > 0n)
            continue;
        const path = (publicationPath)(release);
        if (hiddenPageLocales[path]) {
            hiddenPageLocales[path] = hiddenPageLocales[path].filter(locale => locale !== release.locale);
            if (!hiddenPageLocales[path].length)
                delete hiddenPageLocales[path];
        }
    }
    return { hiddenArticleLocales: { ...hiddenArticleLocales }, hiddenPageLocales: { ...hiddenPageLocales }, hiddenProductLocales: { ...hiddenProductLocales } };
}
export { getSourcePublicVisibility, isOfficialSource, sourceVisibilityAction };
