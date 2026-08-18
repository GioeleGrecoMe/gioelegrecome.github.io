/* Room Scanner V20.1.0 service worker.
 *
 * Build-defining files use network-first delivery so GitHub Pages cannot mix
 * fresh HTML with stale scanner logic. Static shell assets remain available
 * offline after one successful online load. The Deep model/runtime and raw RIR
 * PCM use their own explicit local/remote and IndexedDB storage paths.
 */
'use strict';

const CACHE_VERSION = 'room-scanner-v20.1.0-metric-rir-twin-diag-20260818';
const SHELL = [
  './index.html',
  './room_scanner_v12.html',
  './roomscan_core_v20_1_0.js',
  './roomscan_signal_v20_1_0.js',
  './roomscan_geometry_v20_1_0.js',
  './roomscan_acoustics_v20_1_0.js',
  './roomscan_audio_v20_1_0.js',
  './roomscan_audio_worklet_v20_1_0.js',
  './roomscan_diagnostics_v20_1_0.js',
  './roomscan_app_v20_1_0.js',
  './depth_ai_worker_v20_1_0.js',
  './sw_v20_1_0.js',
  './roomscan_core.js',
  './roomscan_signal.js',
  './roomscan_geometry.js',
  './roomscan_acoustics.js',
  './roomscan_audio.js',
  './roomscan_audio_worklet.js',
  './roomscan_diagnostics.js',
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
    // Only navigation may fall back to HTML. Returning the shell for a missing
    // JS/worklet request creates an HTML-as-JavaScript syntax error.
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

  const critical = /(?:room_scanner_v12\.html|roomscan_(?:app|core|signal|geometry|acoustics|audio|audio_worklet|diagnostics)(?:_v20_1_0)?\.js|depth_ai_worker(?:_v20_1_0)?\.js|build_info\.json|manifest\.webmanifest|sw(?:_v20_1_0)?\.js)$/;
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
