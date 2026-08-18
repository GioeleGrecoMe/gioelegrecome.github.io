const CACHE='room-scanner-v20.2.1-shell';
const SHELL=[
  './','./index.html','./room_scanner_v20.html','./room_scanner_v12.html','./processing.html','./manifest.webmanifest','./build_info.json','./assets/icon.svg','./css/app_v20_2_0.css',
  './js/config_v20_2_0.js','./js/math_v20_2_0.js','./js/db_v20_2_0.js','./js/diagnostics_v20_2_0.js','./js/grid_v20_2_0.js','./js/markpoints_v20_2_0.js','./js/audio_v20_2_0.js','./js/xr_capture_v20_2_0.js','./js/raw_export_v20_2_0.js','./js/reconstruction_v20_2_0.js','./js/registration_v20_2_0.js','./js/acoustics_v20_2_0.js','./js/app_v20_2_0.js','./js/processing_ui_v20_2_0.js',
  './workers/audio_worklet_v20_2_0.js','./workers/map_worker_v20_2_0.js','./workers/processing_worker_v20_2_0.js','./workers/depth_ai_worker_v20_2_0.js','./workers/acoustic_worker_v20_2_0.js'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);if(req.method!=='GET'||url.origin!==self.location.origin)return;
  const isExecutable=req.destination==='script'||url.pathname.endsWith('.js')||url.pathname.endsWith('.html')||req.mode==='navigate';
  if(isExecutable){event.respondWith(networkFirstExact(req));return;}event.respondWith(cacheFirst(req));
});
async function networkFirstExact(req){try{const res=await fetch(req,{cache:'no-store'});if(res.ok){const c=await caches.open(CACHE);c.put(req,res.clone());}return res;}catch(error){const hit=await caches.match(req);if(hit)return hit;if(req.mode==='navigate'){const shell=await caches.match('./room_scanner_v12.html');if(shell)return shell;}throw error;}}
async function cacheFirst(req){const hit=await caches.match(req);if(hit)return hit;const res=await fetch(req);if(res.ok)(await caches.open(CACHE)).put(req,res.clone());return res;}
