/* Room Scanner V20.0.0 service worker.
 *
 * Build-defining files use network-first delivery so GitHub Pages cannot mix
 * fresh HTML with stale scanner logic. Static shell assets remain available
 * offline after one successful online load. The Deep model/runtime continue to
 * use their own explicit local/remote and IndexedDB fallbacks.
 */
'use strict';

const CACHE_VERSION = 'room-scanner-v20.0.0-rgb-acoustic-safe-handoff-20260818';
const SHELL = [
  './index.html',
  './room_scanner_v12.html',
  './roomscan_core_v20_0_0.js',
  './roomscan_app_v20_0_0.js',
  './depth_ai_worker_v20_0_0.js',
  './sw_v20_0_0.js',
  './roomscan_core.js',
  './roomscan_app.js',
  './depth_ai_worker.js',
  './sw.js',
  './manifest.webmanifest',
  './icon.svg',
  './build_info.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => (key.startsWith('room-scanner-') || key.startsWith('acoustic-')) && key !== CACHE_VERSION)
          .map(key => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function cacheNetworkResponse(request, response) {
  if (response?.ok) {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallback = null) {
  try {
    return await cacheNetworkResponse(request, await fetch(request));
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Only navigation is allowed to fall back to HTML. Returning the app shell
    // for a missing JavaScript request produces an HTML-as-JS syntax error and
    // can look exactly like a crash during the post-XR reload.
    if (fallback) {
      const fallbackResponse = await caches.match(fallback, { ignoreSearch: true });
      if (fallbackResponse) return fallbackResponse;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const local = url.origin === self.location.origin;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './room_scanner_v12.html'));
    return;
  }
  if (!local) return;

  const critical = /(?:room_scanner_v12\.html|roomscan_(?:app|core)(?:_v20_0_0)?\.js|depth_ai_worker(?:_v20_0_0)?\.js|build_info\.json|manifest\.webmanifest|sw(?:_v20_0_0)?\.js)$/;
  if (critical.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => (
      cached || fetch(request).then(response => cacheNetworkResponse(request, response))
    )),
  );
});
