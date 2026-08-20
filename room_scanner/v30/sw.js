/*
 * Room Scanner V30.25.0 service worker.
 *
 * The shell is deliberately network-first. An earlier cache-first strategy
 * ignored query strings, so app.js?v=old could be served together with
 * config.js?v=new: the visible badge, worker and runtime then belonged to
 * different builds. Offline fallback remains available, but it is never used
 * while the network responds.
 */
const VERSION = '30.25.0';
const CACHE = `room-scanner-v30.${VERSION}-shell`;
const ENTRY = './room_scanner_v30.html';

const SHELL = [
  './', './index.html', ENTRY, './styles.css', './manifest.webmanifest', './icon.svg', './build_info.json',
  './js/boot.js', './js/app.js', './js/deep_diagnostic_controller.js', './js/config.js', './js/logger.js', './js/camera.js', './js/formats.js', './js/self_test.js', './js/storage/db.js',
  './js/slam/math.js', './js/slam/alva_runtime_loader.js', './js/slam/wasm_frontend.js', './js/slam/slam_engine.js', './js/slam/alva_metric_bootstrap.js', './js/dense/keyframe_manager.js', './js/dense/deep_keyframe_selector.js', './js/dense/deep_metric.js', './js/dense/deep_ray_samples.js', './js/dense/sparse_depth_anchors.js', './js/dense/plane_sweep_core.js', './js/dense/fusion_core.js', './js/metric/pnp_pose.js', './js/xr/xr_calibration.js', './js/xr/measurement_guidance.js', './js/xr/metric_bridge.js',
  './js/metric/metric_geometry.js', './js/metric/gaussian_metric_tap.js', './js/metric/metric_mesh_ui.js', './js/gaussian/renderer.js', './js/gaussian/ar_overlay.js',
  './workers/metric_mesh_worker.js', './workers/gaussian_worker.js', './workers/mvs_worker.js', './workers/deep_depth_worker.js', './workers/dense_depth_worker.js', './workers/dense_fusion_worker.js', './wasm/slam_core.wasm'
];

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  for (const url of SHELL) {
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (!response.ok) throw new Error(`V30 shell missing ${url}: HTTP ${response.status}`);
    await cache.put(url, response);
  }
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  // Preserve model/runtime caches managed by their dedicated workers.
  for (const key of await caches.keys()) {
    if (key.startsWith('room-scanner-v30') && key !== CACHE) await caches.delete(key);
  }
  await self.clients.claim();
})()));

self.addEventListener('message', event => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({ version: VERSION, cache: CACHE });
    return;
  }
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_V30_CACHES') {
    event.waitUntil(caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('room-scanner-v30') || key.startsWith('room-scanner-alvaar')).map(key => caches.delete(key))
    )));
  }
});

async function networkFirst(request, fallback) {
  try {
    const fresh = await fetch(new Request(request, { cache: 'no-store' }));
    if (fresh.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (error) {
    const cache = await caches.open(CACHE);
    const exact = await cache.match(request);
    if (exact) return exact;
    const backup = await cache.match(fallback || request, { ignoreSearch: true });
    if (backup) return backup;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const fallback = url.pathname.endsWith('/index.html') || url.pathname.endsWith('/v30/') ? './index.html' : ENTRY;
    event.respondWith(networkFirst(request, fallback));
    return;
  }

  // Let the depth worker receive the ONNX response body immediately. Caching a
  // 26 MB model before returning its clone delays all progress events and looks
  // exactly like a frozen download on a phone.
  if (url.pathname.endsWith('.onnx')) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
