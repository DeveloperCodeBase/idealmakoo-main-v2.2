/* Generated from sw-policy.js and service-worker.js. Do not edit. */
(()=>{
'use strict';
/** Shared by the module Service Worker and its Node regression tests. */
const PUBLIC_CACHE = 'idealmakoo-public-assets-v1';
const OFFLINE_CACHE = 'idealmakoo-offline-pages-v2';
const OFFLINE_LOCALES = ['fa', 'en', 'tr', 'ar', 'ru'];

/** Return a bundled message, never an archived live document. Private routes,
 * capability URLs and query-bearing navigations stay entirely on the network. */
function offlinePage(input, origin, method = 'GET') {
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
function allowedAsset(input, origin, method = 'GET') {
  if (method !== 'GET') return false;
  let url;
  try { url = new URL(input, origin); } catch { return false; }
  if (url.origin !== origin || url.search || url.username || url.password) return false;
  const path = url.pathname;
  if (/%2f|%5c|%2e/i.test(path)) return false;
  return /^\/media\/official\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp|avif)$/i.test(path) || /^\/fonts\/[a-zA-Z0-9_./-]+\.(woff2?|ttf|otf)$/i.test(path);
}
function cacheableResponse(response) {
  return response.ok && response.type !== 'opaque' && !response.redirected && response.headers.get('X-Public-Cache') === '1' && !/no-store|private/i.test(response.headers.get('Cache-Control') || '');
}


self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // These five script-free documents contain no account, CMS or request data.
    // If optional storage is unavailable, the online application still works.
    try {
      const cache = await caches.open(OFFLINE_CACHE);
      await Promise.allSettled(OFFLINE_LOCALES.map(async locale => {
        const url = new URL(`/offline/${locale}.html`, self.location.origin).href;
        const response = await fetch(new Request(url, {cache: 'reload', credentials: 'omit'}));
        if (cacheableResponse(response) && /text\/html/i.test(response.headers.get('Content-Type') || '')) await cache.put(url, response);
      }));
      // This exact bundled copy uses the existing public media cache policy.
      const iconUrl = new URL('/media/official/idealmakoo-favicon-48.png', self.location.origin).href;
      const icon = await fetch(new Request(iconUrl, {cache: 'reload', credentials: 'omit'}));
      if (cacheableResponse(icon) && /image\/png/i.test(icon.headers.get('Content-Type') || '')) {
        const assets = await caches.open(PUBLIC_CACHE);
        await assets.put(iconUrl, icon);
      }
    } catch { /* Offline fallback is optional, never an installation gate. */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('idealmakoo-public-assets-') && key !== PUBLIC_CACHE || key.startsWith('idealmakoo-offline-pages-') && key !== OFFLINE_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.headers.has('Authorization') || event.request.headers.has('Range')) return;
  const fallback = event.request.mode === 'navigate' && offlinePage(event.request.url, self.location.origin, event.request.method);
  if (fallback) {
    event.respondWith((async () => {
      try { return await fetch(event.request); }
      catch (error) {
        let cached;
        try { cached = await caches.match(new URL(fallback, self.location.origin).href, {cacheName: OFFLINE_CACHE}); } catch { /* Optional cache may be unavailable. */ }
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }
  if (!allowedAsset(event.request.url, self.location.origin, event.request.method)) return;
  event.respondWith((async () => {
    let response;
    try {
      response = await fetch(event.request);
    } catch (error) {
      let cached;
      try { cached = await caches.match(event.request, {cacheName:PUBLIC_CACHE}); } catch { /* Optional cache may be unavailable. */ }
      if (cached) return cached;
      throw error;
    }
    try {
      const cache = await caches.open(PUBLIC_CACHE);
      if (cacheableResponse(response)) await cache.put(event.request, response.clone());
      else await cache.delete(event.request);
    } catch { /* Storage errors must never block an online image or font. */ }
    return response;
  })());
});

})();
