/** Shared by the module Service Worker and its Node regression tests. */
export const PUBLIC_CACHE = 'idealmakoo-public-assets-v1';
export const OFFLINE_CACHE = 'idealmakoo-offline-pages-v2';
export const OFFLINE_LOCALES = ['fa', 'en', 'tr', 'ar', 'ru'];

/** Return a bundled message, never an archived live document. Private routes,
 * capability URLs and query-bearing navigations stay entirely on the network. */
export function offlinePage(input, origin, method = 'GET') {
  if (method !== 'GET' || typeof input !== 'string' || /[%\\\\]/.test(input)) return null;
  let url;
  try { url = new URL(input, origin); } catch { return null; }
  if (url.origin !== origin || url.search || url.username || url.password || /[%\\\\]/.test(url.pathname)) return null;
  if (url.pathname === '/') return '/offline/fa.html';
  const match = /^\/(fa|en|tr|ar|ru)(?:\/|$)/.exec(url.pathname);
  if (!match) return null;
  const path = url.pathname.slice(match[0].length);
  if (/^(?:admin|account|auth|api|page|published|feedback|saved-share|communication-preferences|communication-verification|communication-unsubscribe)(?:\/|$)/.test(path)) return null;
  // Individual resources can require a signed-in grant even at a public URL.
  if (/^resources\/[^/]/.test(path)) return null;
  return `/offline/${match[1]}.html`;
}
export function allowedAsset(input, origin, method = 'GET') {
  if (method !== 'GET') return false;
  let url;
  try { url = new URL(input, origin); } catch { return false; }
  if (url.origin !== origin || url.search || url.username || url.password) return false;
  const path = url.pathname;
  if (/%2f|%5c|%2e/i.test(path)) return false;
  return /^\/media\/official\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp|avif)$/i.test(path) || /^\/fonts\/[a-zA-Z0-9_./-]+\.(woff2?|ttf|otf)$/i.test(path);
}
export function cacheableResponse(response) {
  return response.ok && response.type !== 'opaque' && !response.redirected && response.headers.get('X-Public-Cache') === '1' && !/no-store|private/i.test(response.headers.get('Cache-Control') || '');
}
