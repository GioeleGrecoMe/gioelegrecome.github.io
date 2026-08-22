/*
 * Room Scanner V30.47.0 atomic shell service worker.
 *
 * The worker is a build-coherence guard, not a blocking precache installer.
 * It activates immediately, claims the current page and always asks the
 * network for application assets with cache:no-store. Only responses from
 * THIS build cache can be used as an offline fallback. This prevents an old
 * controller from combining HTML/CSS/JS from different V30 revisions.
 */
const VERSION = '30.47.0';
const CACHE = `room-scanner-v${VERSION}-shell`;
const CACHE_PREFIX = 'room-scanner-v';
const ENTRY = './room_scanner_v30.html';

self.addEventListener('install', event => {
  // Never make activation depend on every optional/experimental asset being
  // already published. A missing lazy module must not brick the whole UI.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith(CACHE_PREFIX) && key.endsWith('-shell') && key !== CACHE) {
      await caches.delete(key);
    }
  }
  await self.clients.claim();
})()));

self.addEventListener('message', event => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({ version: VERSION, cache: CACHE });
    return;
  }
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type === 'CLEAR_V30_SHELL') {
    event.waitUntil(caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith(CACHE_PREFIX) && key.endsWith('-shell')).map(key => caches.delete(key))
    )));
  }
});

async function networkFirst(request, fallback = null) {
  try {
    const fresh = await fetch(new Request(request, { cache: 'no-store' }));
    if (!fresh.ok) return fresh;
    const cache = await caches.open(CACHE);
    await cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    const cache = await caches.open(CACHE);
    const exact = await cache.match(request);
    if (exact) return exact;
    if (fallback) {
      const backup = await cache.match(fallback, { ignoreSearch: true });
      if (backup) return backup;
    }
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('.onnx')) {
    // The depth worker owns the large-model cache. Do not duplicate 20-30 MB
    // responses in the shell cache or delay streaming on low-budget phones.
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    const fallback = url.pathname.endsWith('/index.html') || url.pathname.endsWith('/v30/') ? './index.html' : ENTRY;
    event.respondWith(networkFirst(request, fallback));
    return;
  }

  event.respondWith(networkFirst(request));
});
