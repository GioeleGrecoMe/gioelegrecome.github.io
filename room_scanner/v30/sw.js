/* Room Scanner V30.18.5 service worker.
 * Static runtime assets are cache-first once installed. Navigations use a short
 * network-first path. The active worker exposes GET_VERSION so the HTML can
 * remove an actually stale V30 controller before loading application modules.
 */
const VERSION='30.18.5';
const CACHE='room-scanner-v30.18.5-shell';
const SHELL=[
  './','./index.html','./room_scanner_v30.html','./styles.css','./manifest.webmanifest','./icon.svg','./build_info.json',
  './js/boot.js','./js/app.js','./js/deep_live_controller.js','./js/config.js','./js/logger.js','./js/camera.js','./js/formats.js','./js/self_test.js','./js/storage/db.js',
  './js/slam/math.js','./js/slam/alva_runtime_loader.js','./js/slam/wasm_frontend.js','./js/slam/slam_engine.js','./js/slam/alva_metric_bootstrap.js','./js/dense/keyframe_manager.js','./js/dense/deep_keyframe_selector.js','./js/dense/deep_metric.js','./js/dense/sparse_depth_anchors.js','./js/dense/plane_sweep_core.js','./js/dense/fusion_core.js','./js/metric/pnp_pose.js','./js/xr/xr_calibration.js','./js/xr/measurement_guidance.js','./js/xr/metric_bridge.js',
  './js/metric/metric_geometry.js','./js/metric/gaussian_metric_tap.js','./js/metric/metric_mesh_ui.js','./js/gaussian/renderer.js','./js/gaussian/ar_overlay.js',
  './workers/metric_mesh_worker.js','./workers/gaussian_worker.js','./workers/mvs_worker.js','./workers/deep_depth_worker.js','./workers/dense_depth_worker.js','./workers/dense_fusion_worker.js','./wasm/slam_core.wasm'
];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(const url of SHELL){const response=await fetch(new Request(url,{cache:'reload'}));if(!response.ok)throw new Error(`V30 shell missing ${url}: HTTP ${response.status}`);await cache.put(url,response.clone());}await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('room-scanner-v30')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='GET_VERSION'){event.ports?.[0]?.postMessage({version:VERSION,cache:CACHE});return;}if(event.data?.type==='SKIP_WAITING')self.skipWaiting();if(event.data?.type==='CLEAR_V30_CACHES')event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('room-scanner-v30')||k.startsWith('room-scanner-alvaar')).map(k=>caches.delete(k)))));});
async function networkWithTimeout(request,ms=1800){const c=new AbortController(),timer=setTimeout(()=>c.abort(),ms);try{return await fetch(new Request(request,{cache:'no-store',signal:c.signal}));}finally{clearTimeout(timer);}}
self.addEventListener('fetch',event=>{const req=event.request,url=new URL(req.url);if(req.method!=='GET')return;
  // Large AlvaAR and Depth Anything model binaries use dedicated runtime caches.
  // The 27.4 MB Q4 model is intentionally NOT in SHELL, so service-worker
  // installation never downloads it and app-version cache resets preserve it.
  // The large official AlvaAR module is managed by alva_runtime_loader.js in
  // a dedicated CacheStorage bucket. It is intentionally not part of SHELL so
  // service-worker installation never depends on a third-party request.
  if(url.origin!==self.location.origin)return;if(req.mode==='navigate'){event.respondWith((async()=>{try{const fresh=await networkWithTimeout(req);if(fresh.ok){const cache=await caches.open(CACHE);await cache.put('./room_scanner_v30.html',fresh.clone());}return fresh;}catch{const cached=await caches.match('./room_scanner_v30.html');if(cached)return cached;throw new Error('offline navigation unavailable');}})());return;}
  // Cache-first for versioned static assets: no boot-time network timeout.
  event.respondWith((async()=>{const cached=await caches.match(req,{ignoreSearch:true});if(cached)return cached;const fresh=await fetch(req);if(fresh.ok){const cache=await caches.open(CACHE);await cache.put(req,fresh.clone());}return fresh;})());
});
