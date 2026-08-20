/*
 * Room Scanner V30.18.8 service worker.
 *
 * WHY THIS VERSION EXISTS
 * -----------------------
 * V30.18.5 could be published while an already-open Android tab was still
 * executing the cached V30.18.0 document.  The server was fresh, but the old
 * controller kept the old HTML/JS alive until a second manual reload.  That
 * produced the diagnostic split:
 *   published build_info = 30.18.5
 *   runtime BUILD         = 30.18.0
 *
 * V30.18.8 fixes the *handover*, not the reconstruction pipeline:
 *  1. the new worker installs from network with cache:'reload';
 *  2. skipWaiting() promotes it immediately;
 *  3. activate() claims existing tabs;
 *  4. any Room Scanner tab that has not yet crossed this handover is navigated
 *     once to the same URL with v30sw=30.18.8.  This forces the document itself
 *     to come through the new network-first navigation path.
 *
 * The large Depth Anything model cache is intentionally NOT deleted here.
 */
const VERSION='30.18.8';
const CACHE='room-scanner-v30.18.8-shell';
const HANDOVER_PARAM='v30sw';
const HANDOVER_VALUE=VERSION;

const SHELL=[
  './','./index.html','./room_scanner_v30.html','./styles.css','./manifest.webmanifest','./icon.svg','./build_info.json',
  './js/boot.js','./js/app.js','./js/deep_live_controller.js','./js/deep_diagnostic_controller.js','./js/config.js','./js/logger.js','./js/camera.js','./js/formats.js','./js/self_test.js','./js/storage/db.js',
  './js/slam/math.js','./js/slam/alva_runtime_loader.js','./js/slam/wasm_frontend.js','./js/slam/slam_engine.js','./js/slam/alva_metric_bootstrap.js','./js/dense/keyframe_manager.js','./js/dense/deep_keyframe_selector.js','./js/dense/deep_metric.js','./js/dense/sparse_depth_anchors.js','./js/dense/plane_sweep_core.js','./js/dense/fusion_core.js','./js/metric/pnp_pose.js','./js/xr/xr_calibration.js','./js/xr/measurement_guidance.js','./js/xr/metric_bridge.js',
  './js/metric/metric_geometry.js','./js/metric/gaussian_metric_tap.js','./js/metric/metric_mesh_ui.js','./js/gaussian/renderer.js','./js/gaussian/ar_overlay.js',
  './workers/metric_mesh_worker.js','./workers/gaussian_worker.js','./workers/mvs_worker.js','./workers/deep_depth_worker.js','./workers/dense_depth_worker.js','./workers/dense_fusion_worker.js','./wasm/slam_core.wasm'
];

self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  for(const url of SHELL){
    const response=await fetch(new Request(url,{cache:'reload'}));
    if(!response.ok)throw new Error(`V30 shell missing ${url}: HTTP ${response.status}`);
    await cache.put(url,response.clone());
  }
  await self.skipWaiting();
})()));

async function handoverOpenRoomScannerTabs(){
  const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  await Promise.all(list.map(async client=>{
    try{
      const url=new URL(client.url);
      if(url.origin!==self.location.origin)return;
      if(!url.pathname.includes('/room_scanner/v30/'))return;
      if(url.searchParams.get(HANDOVER_PARAM)===HANDOVER_VALUE)return;
      // Keep the user's current path/query/hash, only mark this one-time
      // service-worker handover.  client.navigate() is same-origin and lets the
      // new network-first navigation handler fetch the current HTML.
      url.searchParams.set(HANDOVER_PARAM,HANDOVER_VALUE);
      url.searchParams.set('fresh',`${VERSION}-${Date.now()}`);
      await client.navigate(url.href);
    }catch(err){
      // Activation must never fail merely because a tab closed mid-handover.
      console.warn('[V30 SW] client handover skipped',err);
    }
  }));
}

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Preserve dedicated model caches such as room-scanner-depth-models-v1.
  for(const key of await caches.keys()){
    if(key.startsWith('room-scanner-v30')&&key!==CACHE)await caches.delete(key);
  }
  await self.clients.claim();
  await handoverOpenRoomScannerTabs();
})()));

self.addEventListener('message',event=>{
  if(event.data?.type==='GET_VERSION'){
    event.ports?.[0]?.postMessage({version:VERSION,cache:CACHE});
    return;
  }
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
  if(event.data?.type==='CLEAR_V30_CACHES'){
    event.waitUntil(caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k.startsWith('room-scanner-v30')||k.startsWith('room-scanner-alvaar')).map(k=>caches.delete(k))
    )));
  }
});

async function networkWithTimeout(request,ms=2200){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  try{
    return await fetch(new Request(request,{cache:'no-store',signal:controller.signal}));
  }finally{
    clearTimeout(timer);
  }
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.method!=='GET')return;

  // Cross-origin ONNX/runtime downloads manage their own caching in the Deep
  // worker.  Never proxy them through the application-shell cache.
  if(url.origin!==self.location.origin)return;

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const fresh=await networkWithTimeout(req);
        if(fresh.ok){
          const cache=await caches.open(CACHE);
          // Cache the actual navigation under its canonical shell URL; do not
          // let fresh/v30sw query parameters create permanent duplicate keys.
          const canonical=url.pathname.endsWith('/index.html')||url.pathname.endsWith('/v30/')?'./index.html':'./room_scanner_v30.html';
          await cache.put(canonical,fresh.clone());
        }
        return fresh;
      }catch{
        const preferred=url.pathname.endsWith('/index.html')||url.pathname.endsWith('/v30/')?'./index.html':'./room_scanner_v30.html';
        const cached=await caches.match(preferred);
        if(cached)return cached;
        throw new Error('offline navigation unavailable');
      }
    })());
    return;
  }

  // Versioned static assets are cache-first for offline operation.  ignoreSearch
  // deliberately makes an old ?v=30.18.0 import resolve to the current cached
  // file after a worker upgrade; this prevents mixed-build module graphs.
  event.respondWith((async()=>{
    const cached=await caches.match(req,{ignoreSearch:true});
    if(cached)return cached;
    const fresh=await fetch(new Request(req,{cache:'no-cache'}));
    if(fresh.ok){
      const cache=await caches.open(CACHE);
      await cache.put(req,fresh.clone());
    }
    return fresh;
  })());
});
