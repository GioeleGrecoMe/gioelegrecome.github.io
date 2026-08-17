/* Room Scanner V15 shell service worker.
 *
 * Only the small application shell is pre-cached. The optional neural model is
 * fetched by depth_ai_worker.js after WebXR and stored separately in IndexedDB.
 * This keeps install/update operations fast and avoids downloading ~27 MB for
 * users who only need the metric shell and manual object editor.
 */
'use strict';

const CACHE_VERSION = 'room-scanner-v15-guided-walk-20260817';
const SHELL = [
  './index.html',
  './room_scanner_v12.html',
  './roomscan_core.js',
  './roomscan_app.js',
  './depth_ai_worker.js',
  './manifest.webmanifest',
  './icon.svg',
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
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Navigations prefer a fresh build, with the cached scanner as the offline
  // fallback. This prevents an old HTML entry point from pinning new scripts.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache each navigation under its own URL. In particular, never put
          // the lightweight root redirect into the canonical scanner key.
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (
          await caches.match(request, { ignoreSearch: true })
          || await caches.match('./room_scanner_v12.html')
        )),
    );
    return;
  }

  // Same-origin shell files use stale-while-revalidate. Cross-origin ONNX/CDN
  // requests keep normal browser caching and are not stored as opaque entries.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    // Ignore the build query when offline so the pre-cached worker remains
    // available after XR even before it has been fetched with that query.
    caches.match(request, { ignoreSearch: true }).then(cached => {
      const refresh = fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_VERSION).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || refresh;
    }),
  );
});
