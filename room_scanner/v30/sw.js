/*
 * Room Scanner V30.9 service worker.
 * Network-first code policy + a NEW cache namespace ensures V30.8 JS cannot be
 * silently reused after the deployment. Old room-scanner-v30* caches are deleted
 * on activation. The application remains fully offline-capable after one load.
 */
const CACHE='room-scanner-v30.9.0-shell';
const SHELL=['./','./index.html','./room_scanner_v30.html','./styles.css','./manifest.webmanifest','./icon.svg','./build_info.json','./js/app.js','./js/config.js','./js/logger.js','./js/camera.js','./js/formats.js','./js/self_test.js','./js/storage/db.js','./js/slam/math.js','./js/slam/wasm_frontend.js','./js/slam/slam_engine.js','./js/xr/xr_calibration.js','./js/xr/metric_bridge.js','./js/gaussian/renderer.js','./workers/gaussian_worker.js','./workers/mvs_worker.js','./wasm/slam_core.wasm'];
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);for(const url of SHELL){try{const r=await fetch(new Request(url,{cache:'reload'}));if(r.ok)await c.put(url,r.clone());}catch{}}await self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('room-scanner-v30')&&k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})()));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();if(e.data?.type==='CLEAR_V30_CACHES')e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('room-scanner-v30')).map(k=>caches.delete(k)))));});
self.addEventListener('fetch',e=>{const req=e.request,u=new URL(req.url);if(u.origin!==self.location.origin||req.method!=='GET')return;const path=u.pathname,codeLike=req.mode==='navigate'||/\.(?:html|js|css|json|wasm|webmanifest)$/.test(path)||path.endsWith('/v30/');e.respondWith((async()=>{if(codeLike){try{const fresh=await fetch(new Request(req,{cache:'no-store'}));if(fresh.ok){const c=await caches.open(CACHE);await c.put(req,fresh.clone());}return fresh;}catch(err){const cached=await caches.match(req,{ignoreSearch:true});if(cached)return cached;if(req.mode==='navigate'){const fallback=await caches.match('./room_scanner_v30.html');if(fallback)return fallback;}throw err;}}try{return await fetch(req);}catch(err){const cached=await caches.match(req,{ignoreSearch:true});if(cached)return cached;throw err;}})());});
