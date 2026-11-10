import type { Locale } from './i18n';
export type EditorialSeo = z.infer<typeof seoSchema>;
export type EditorialSeoByLocale = Partial<Record<Locale, EditorialSeo>>;
export interface EditorialSeoContext { collection: string; mediaType?: string; mediaUrl?: string; location?: string; eventStart?: string; eventEnd?: string }
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";

// Browser validation uses Zod's interpreter. Its optional JIT feature probe
// calls Function(''), which a strict CSP correctly blocks even when caught.
// Configure this before creating schemas so no eval probe is attempted.
if (typeof window !== "undefined") z.config({jitless: true});
function editorialIsoDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d))?$/.test(value))
        return false;
    const day = value.slice(0, 10), stamp = Date.parse(day);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value));
}
function editorialExpiry(value: string) { return Date.parse(value) + (value.length === 10 ? 864e5 - 1 : 0); }
function safeEditorialUrl(value: string, media = false) {
    if (!value || value.length > 2e3 || /[\s\\\u0000-\u001f\u007f]/.test(value) || /%(?:2e|2f|5c|00)/i.test(value))
        return false;
    let url;
    try {
        url = new URL(value, "https://editorial.invalid");
    }
    catch {
        return false;
    }
    if (url.username || url.password || !["https:"].includes(url.protocol))
        return false;
    if (!value.startsWith("/") && !/^https:\/\//.test(value) || value.startsWith("//"))
        return false;
    if (/(?:^|\/)\.\.(?:\/|$)/.test(value) || /^\/(?:[^/]+\/)?(?:admin|account|auth|feedback|saved-share|communication-preferences|communication-unsubscribe|communication-verification)(?:\/|$)/i.test(url.pathname))
        return false;
    if (url.pathname.startsWith("/api/") && !/^\/api\/v1\/media\/[a-zA-Z0-9_-]+\/content\/?$/.test(url.pathname))
        return false;
    if (media && value.startsWith("/") && !/^\/(?:media\/|api\/v1\/media\/[a-zA-Z0-9_-]+\/content\/?$)/.test(url.pathname))
        return false;
    return true;
}
const text = (max: number) => z.string().max(max).regex(/^[^<>\u0000-\u001f\u007f]*$/);
const draftDate = z.string().max(40).refine(value => !value || editorialIsoDate(value), "Enter an ISO calendar date or an offset-bearing timestamp.");
const optionalUrl = z.string().max(2e3).refine(value => !value || safeEditorialUrl(value), "Enter a public HTTPS URL.").optional();
const addressSchema = z.object({ streetAddress: text(400), addressLocality: text(160), addressRegion: text(160).optional(), postalCode: text(40).optional(), addressCountry: text(120) }).strict();
const seoSchema = z.object({ article: z.object({ authors: z.array(z.object({ name: text(200), url: optionalUrl, type: z.enum(["Person", "Organization"]) }).strict()).max(10).optional(), datePublished: draftDate.optional(), dateModified: draftDate.optional() }).strict().optional(), video: z.object({ thumbnailUrl: z.string().max(2e3).refine(value => !value || safeEditorialUrl(value, true)), uploadDate: draftDate, durationSeconds: z.number().finite().positive().max(86400).optional() }).strict().optional(), event: z.object({ address: addressSchema, status: z.enum(["scheduled", "cancelled", "postponed"]) }).strict().optional(), job: z.object({ datePosted: draftDate, validThrough: draftDate, status: z.enum(["open", "closed"]), hiringOrganization: z.object({ name: text(200), url: optionalUrl }).strict(), location: addressSchema, employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACTOR", "TEMPORARY", "INTERN", "VOLUNTEER", "PER_DIEM", "OTHER"]).optional() }).strict().optional() }).strict();
const locales = ["fa", "en", "tr", "ar", "ru"];
function parseEditorialSeo(value: unknown) { const result = seoSchema.safeParse(value); return result.success ? result.data : null; }
function parseEditorialSeoByLocale(value: unknown) : EditorialSeoByLocale | null {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !locales.includes(key)))
        return null;
    const result: EditorialSeoByLocale = {};
    for (const [locale, entry] of Object.entries(value)) {
        const parsed = parseEditorialSeo(entry);
        if (!parsed)
            return null;
        result[locale as Locale] = parsed;
    }
    return result;
}
function editorialSeoKinds(collection: string) {
    const result = new Set(["video"]);
    if (["research", "news", "knowledge"].includes(collection))
        result.add("article");
    if (collection === "events")
        result.add("event");
    if (collection === "hr")
        result.add("job");
    return result;
}
function editorialSeoIssues(value: EditorialSeo, context: EditorialSeoContext, now = Date.now()) : string[] {
    const issues: string[] = [];
    for (const key of Object.keys(value))
        if (!editorialSeoKinds(context.collection).has(key))
            issues.push(`${key}: unsupported content type`);
    const address = (value2: z.infer<typeof addressSchema>, prefix: string) => {
        for (const key of ["streetAddress", "addressLocality", "addressCountry"] as const)
            if (!value2[key].trim())
                issues.push(`${prefix}.${key}: required`);
    };
    const past = (value2: string | undefined, prefix: string, required = false) => {
        if (!value2) {
            if (required)
                issues.push(`${prefix}: required`);
        }
        else if (!editorialIsoDate(value2) || Date.parse(value2) > now)
            issues.push(`${prefix}: must be a real date no later than now`);
    };
    if (value.article) {
        for (const author of value.article.authors || [])
            if (!author.name.trim())
                issues.push("article.author.name: required");
        past(value.article.datePublished, "article.datePublished");
        past(value.article.dateModified, "article.dateModified");
        if (value.article.datePublished && value.article.dateModified && Date.parse(value.article.dateModified) < Date.parse(value.article.datePublished))
            issues.push("article.dateModified: precedes original publication");
    }
    if (value.video) {
        if (!safeEditorialUrl(value.video.thumbnailUrl, true))
            issues.push("video.thumbnailUrl: a public thumbnail is required");
        past(value.video.uploadDate, "video.uploadDate", true);
        if (context.mediaType !== "video" || !context.mediaUrl || !safeEditorialUrl(context.mediaUrl, true))
            issues.push("video.contentUrl: select the actual visible public video");
    }
    if (value.event) {
        address(value.event.address, "event.address");
        if (!context.location?.trim())
            issues.push("event.location: a venue name is required");
        if (!context.eventStart || !editorialIsoDate(context.eventStart))
            issues.push("event.startDate: an actual date is required");
        if (context.eventEnd && (!editorialIsoDate(context.eventEnd) || Date.parse(context.eventEnd) <= Date.parse(context.eventStart || "")))
            issues.push("event.endDate: must follow the start");
    }
    if (value.job) {
        past(value.job.datePosted, "job.datePosted", true);
        if (!value.job.validThrough || !editorialIsoDate(value.job.validThrough))
            issues.push("job.validThrough: required");
        else if (editorialExpiry(value.job.validThrough) < Date.parse(value.job.datePosted))
            issues.push("job.validThrough: precedes original posting");
        if (!value.job.hiringOrganization.name.trim())
            issues.push("job.hiringOrganization.name: required");
        address(value.job.location, "job.location");
    }
    return issues;
}
export { editorialExpiry, editorialIsoDate, editorialSeoIssues, editorialSeoKinds, parseEditorialSeo, parseEditorialSeoByLocale, safeEditorialUrl };
