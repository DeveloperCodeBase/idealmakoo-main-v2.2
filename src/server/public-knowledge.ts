import type {KnowledgeEntry} from '../../worker/ai-handler';
import type { Locale } from '../lib/i18n';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { getPublicSite } from "./workspace";
import { isPublicPathVisible, isPublicArticleVisible } from "../lib/public-visibility";
import { publicationPath } from "../lib/publication-path";
import { products, articles, companyPages } from "../data/catalog";
import { officialSourcePages } from "../data/official-source-pages";
import { createKnowledge } from "../../worker/knowledge";
const localPath = (url: string) => url.split(/[?#]/, 1)[0].replace(/^\/(?:fa|en|tr|ar|ru)(?:\/|$)/, "").replace(/^\/+|\/+$/g, "");
async function publicKnowledge(locale: Locale, client?: PoolClient) : Promise<KnowledgeEntry[]> {
    const site = await (getPublicSite)(client);
    const hidden = new Set([...site.hiddenProducts, ...Object.entries(site.hiddenProductLocales).filter(([, languages]) => languages.includes(locale)).map(([id]) => id)]);
    const publications = site.publications.filter(publication => publication.locale === locale && (isPublicPathVisible)(site, locale, (publicationPath)(publication)));
    const publishedPaths = new Set(publications.map(publicationPath));
    const replaced = new Set(publications.filter(publication => ["product", "products"].includes(publication.kind)).map(publication => publication.productRelease?.productId || publication.customProduct?.id || publication.id));
    const suppressed = products.filter(product => hidden.has(product.id) || replaced.has(product.id) || !(isPublicPathVisible)(site, locale, "products/" + product.slug));
    const suppressedArticles = articles.filter(article => !(isPublicArticleVisible)(site, locale, article.id) || !(isPublicPathVisible)(site, locale, "research/" + article.slug) || publishedPaths.has("research/" + article.slug) || publications.some(publication => publication.kind === "research" && publication.id === article.id));
    const suppressedPages = companyPages.filter(page => !(isPublicPathVisible)(site, locale, page.slug) || publishedPaths.has(page.slug));
    const sourceUrls = new Set([...suppressed, ...suppressedArticles, ...suppressedPages].map(source => source.sourceUrl));
    const suppressedIds = new Set(["site-navigation", "product-index", ...suppressed.map(product => "product-" + product.id), ...suppressedArticles.map(article => "research-" + article.id), ...suppressedPages.map(page => "company-" + page.id)]);
    for (const source of officialSourcePages) {
        const indexPath = source.id === "official-page-home" ? "" : source.id === "official-page-3" ? "products" : source.id === "official-page-5" ? "research" : null;
        const affectedIndex = source.kind === "index" && (indexPath === null || !(isPublicPathVisible)(site, locale, indexPath) || publishedPaths.has(indexPath) || source.id === "official-page-home" && (suppressed.length > 0 || suppressedArticles.length > 0 || suppressedPages.length > 0) || source.id === "official-page-3" && suppressed.length > 0 || source.id === "official-page-5" && suppressedArticles.length > 0);
        if (sourceUrls.has(source.url) || affectedIndex)
            suppressedIds.add("official-" + source.id);
    }
    if (suppressedPages.some(page => page.slug === "about" || page.slug === "contact"))
        suppressedIds.add("company-overview");
    const entries = (createKnowledge)().filter(entry => !suppressedIds.has(entry.id) && !sourceUrls.has(entry.sourceUrl || "") && (isPublicPathVisible)(site, locale, localPath(entry.url))).map(entry => ({ ...entry, url: entry.url.replace(/^\/(fa|en|tr|ar|ru)\//, "/" + locale + "/") }));
    if ((isPublicPathVisible)(site, locale, "products"))
        entries.push({ id: "product-index", kind: "product-index", title: "Ideal Makoo \u2014 published product catalogue", url: `/${locale}/products/`, text: products.filter(product => !hidden.has(product.id) && !replaced.has(product.id) && (isPublicPathVisible)(site, locale, "products/" + product.slug)).map(product => `${product.name[locale]}: /${locale}/products/${product.slug}/`).concat(publications.filter(publication => ["product", "products"].includes(publication.kind)).map(publication => `${publication.title}: /${locale}/${(publicationPath)(publication)}/`)).join("\n") + "\nPublic prices and live stock are not provided." });
    return [...entries, ...publications.map(publication => ({ id: "published-" + publication.id + "-" + locale, kind: publication.kind, title: publication.title, url: `/${locale}/${(publicationPath)(publication)}/`.replace(/\/+/g, "/"), text: publication.summary + "\n" + publication.body + "\n" + publication.blocks.filter(block => !block.hidden).map(block => block.title + "\n" + block.body).join("\n") }))];
}
export { publicKnowledge };
