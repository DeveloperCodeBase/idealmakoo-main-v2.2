import { direction, isLocale, type Locale } from '@/lib/i18n';

export const LOCALE_STORAGE_KEY = 'idealmakoo.locale';
const localePrefix = /^(?:fa|en|tr|ar|ru)(?:\/|$)/;
const nonPageRoot = /^(?:api|_next|media|downloads|manifests|fonts|images|icons|\.well-known)(?:\/|$)/i;

/** An explicit URL always wins over saved account or browser preferences. */
export function localeFromPath(path: string): Locale | null {
  const match = path.match(/^\/(fa|en|tr|ar|ru)(?=\/|[?#]|$)/);
  return match ? match[1] as Locale : null;
}

/** Page links belong to the active interface. Existing locale prefixes may come
 * from translated CMS blocks; replace them instead of nesting or preserving them.
 * This is a path formatter, not a URL validator: callers still validate authored
 * links. External URLs, files, endpoints and same-page references stay untouched. */
export function localizedPath(locale: Locale, path = ''): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|[?#])/i.test(path)) return path;
  const boundary = path.search(/[?#]/);
  const originalPath = boundary < 0 ? path : path.slice(0, boundary);
  let pathname = originalPath.replace(/^\/+|\/+$/g, '');
  if (nonPageRoot.test(pathname) || /\.[a-z\d]{1,12}$/i.test(pathname)) return path;
  while (localePrefix.test(pathname)) pathname = pathname.replace(localePrefix, '');
  const suffix = boundary < 0 ? '' : path.slice(boundary);
  return `/${locale}/${pathname}${pathname ? '/' : ''}${suffix}`;
}

/** Keep root/admin aliases stable within this tab, even when another tab changes
 * the shared preference. Storage is only a fallback for an unprefixed entry URL. */
export function rememberedLocale(view: Pick<Window, 'localStorage' | 'sessionStorage'>): Locale {
  for (const kind of ['sessionStorage', 'localStorage'] as const) {
    try {
      const value = view[kind].getItem(LOCALE_STORAGE_KEY);
      if (value && isLocale(value)) return value;
    } catch { /* Restricted storage must not prevent navigation. */ }
  }
  return 'fa';
}

export function entryLocalePath(path: string, location: Pick<Location, 'pathname' | 'search' | 'hash'>, saved: Locale): string {
  const locale = localeFromPath(location.pathname) || localeFromPath(`/${path.replace(/^\/+/, '')}`) || saved;
  return localizedPath(locale, path) + location.search + location.hash;
}

/** Called only after a route commits; hydration and account storage events must
 * never redirect to the account's preferred language. */
export function applyRouteLocale(doc: Document, locale: Locale): void {
  doc.documentElement.lang = locale;
  doc.documentElement.dir = direction(locale);
  const view = doc.defaultView;
  if (!view) return;
  for (const kind of ['sessionStorage', 'localStorage'] as const) {
    try { view[kind].setItem(LOCALE_STORAGE_KEY, locale); } catch { /* The URL remains authoritative. */ }
  }
}

/** Saving theme, density, profile or timezone is not a language selection. */
export function changedPreferredLocale(active: Locale, previous: Locale, next: Locale): Locale | null {
  return previous !== next && next !== active ? next : null;
}
