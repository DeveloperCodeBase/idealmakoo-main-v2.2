/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import type { Locale } from './i18n';
import type { OperationalRoute, publicMetricRoutes } from '../types/monitoring';
type PublicMetricRoute = typeof publicMetricRoutes[number];
const locales = new Set<string>(["fa", "en", "tr", "ar", "ru"]);
function segments(input: unknown): string[] | null {
    if (typeof input !== "string" || input.length > 2e3)
        return null;
    try {
        return input.split(/[?#]/, 1)[0].split("/").filter(Boolean).map(value => decodeURIComponent(value).toLowerCase());
    }
    catch {
        return null;
    }
}
function operationalRoute(input: unknown): OperationalRoute | null {
    let parts = segments(input);
    if (!parts)
        return null;
    if (parts.some(value => ["saved-share", "feedback", "unsubscribe", "notification-unsubscribe", "content-previews", "wishlist-shares", "communication-preferences", "communication-unsubscribe", "communication-verification"].includes(value)) || parts.includes("wishlists") && parts.includes("shared"))
        return null;
    if (parts[0] === "api" && parts[1] === "v1")
        parts = parts.slice(2);
    if (locales.has(parts[0]))
        return publicMeasurementRoute(input) ? "site" : null;
    const first = parts[0];
    if (["health", "monitoring", "telemetry"].includes(first))
        return null;
    if (first === "site" || !first)
        return "site";
    if (first === "requests")
        return "requests";
    if (["workspace", "site-preferences", "shared-blocks"].includes(first))
        return "workspace";
    if (["crm", "automations"].includes(first))
        return "crm";
    if (["resources", "data-rooms", "access-grants"].includes(first))
        return "resources";
    if (["media", "uploads"].includes(first))
        return "media";
    if (first === "ai")
        return "ai";
    if (first === "auth")
        return "auth";
    if (first === "me")
        return "account";
    return "other";
}
function publicMeasurementRoute(input: unknown): { route: PublicMetricRoute; locale: Locale } | null {
    const parts = segments(input);
    if (!parts || !locales.has(parts[0]) || parts.some(value => ["auth", "account", "admin", "saved-share", "feedback", "unsubscribe", "shared", "private", "preview", "content-previews", "wishlist-shares", "communication-preferences", "communication-unsubscribe", "communication-verification"].includes(value)))
        return null;
    const locale = parts[0] as Locale, slug = parts[1] || "";
    let route: PublicMetricRoute | null = null;
    if (parts.length === 1)
        route = "home";
    else if (slug === "products" && parts.length <= 3)
        route = parts.length === 3 ? "product" : "products";
    else if (slug === "research" && parts.length <= 3)
        route = parts.length === 3 ? "article" : "research";
    else if (slug === "news" && parts.length <= 3)
        route = "news";
    else if (slug === "events" && parts.length <= 3)
        route = parts.length === 3 ? "event" : "events";
    else if (slug === "resources" && parts.length <= 3)
        route = parts.length === 3 ? "resource" : "resources";
    else if (slug === "contact" && parts.length === 2)
        route = "contact";
    else if (slug === "about" && parts.length === 2)
        route = "about";
    else if (["request", "inquiry", "rfq"].includes(slug) && parts.length === 2)
        route = "request-form";
    return route ? { route, locale } : null;
}
export { operationalRoute, publicMeasurementRoute };
