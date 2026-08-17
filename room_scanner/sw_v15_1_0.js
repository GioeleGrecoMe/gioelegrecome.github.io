/* Room Scanner V15.1.0 service worker.
 *
 * Executable and build-defining files use network-first delivery so a GitHub
 * Pages update cannot combine fresh HTML with stale scanner logic. The shell
 * remains available offline after one successful online load.
 */
'use strict';

const CACHE_VERSION = 'room-scanner-v15.1.0-wall-targets-recovery-20260817';
const SHELL = [
  './index.html',
  './room_scanner_v12.html',
  './roomscan_core_v15_1_0.js',
  './roomscan_app_v15_1_0.js',
  './depth_ai_worker_v15_1_0.js',
  './roomscan_core.js',
  './roomscan_app.js',
  './depth_ai_worker.js',
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

async function networkFirst(request, fallback = './room_scanner_v12.html') {
  try {
    return await cacheNetworkResponse(request, await fetch(request));
  } catch {
    return await caches.match(request, { ignoreSearch: true })
      || await caches.match(fallback, { ignoreSearch: true });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const local = url.origin === self.location.origin;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (!local) return;

  const critical = /(?:room_scanner_v12\.html|roomscan_(?:app|core)(?:_v15_1_0)?\.js|depth_ai_worker(?:_v15_1_0)?\.js|build_info\.json|sw(?:_v15_1_0)?\.js)$/;
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
