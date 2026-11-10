import { isLocale } from '@/lib/i18n';
import { localizedPath } from '@/lib/locale-routing';

/** Model links use the active UI locale; source files and external HTTPS URLs
 * remain unchanged. Validate before passing a URL to the shared path formatter. */
export function safeAiLink(raw: string, locale: string): string {
  if (raw.startsWith('/') && !raw.startsWith('//') && !/[\\\u0000-\u0020]/.test(raw)) {
    const path = raw.split(/[?#]/)[0];
    if (path.split('/').some(part => part === '.' || part === '..')) return '';
    return localizedPath(isLocale(locale) ? locale : 'fa', raw);
  }
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Non-URLs render as plain text. */ }
  return '';
}
