import { PUBLIC_CACHE, OFFLINE_CACHE, OFFLINE_LOCALES, allowedAsset, cacheableResponse, offlinePage } from './sw-policy.js';

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
