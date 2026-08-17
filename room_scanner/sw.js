/* Room Scanner V14.1.0 service worker.
 * Keep install lightweight: app shell only. Heavy ONNX/model/WASM assets are
 * intentionally fetched on demand so an update does not duplicate hundreds
 * of MB in browser storage or block installation on phones.
 */
const CACHE='room-scanner-v14.1.0-room-cells-autosurvey';
const SHELL=['./room_scanner_v12.html','./v14_cells.js','./build_info.json'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('room-scanner-')||k.startsWith('acoustic-'))&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
function networkFirst(request){return fetch(request).then(response=>{if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(request,copy)).catch(()=>{});}return response;}).catch(()=>caches.match(request));}
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const u=new URL(event.request.url);
  const local=u.origin===self.location.origin;
  const critical=/room_scanner_v12\.html$|v14_cells\.js$|depth_ai_worker\.js$|build_info\.json$/.test(u.pathname);
  if(local&&critical){event.respondWith(networkFirst(event.request));return;}
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
    // Runtime-cache lightweight same-origin assets, but avoid automatic model/WASM
    // precaching. Browser/network caches can still serve heavy inference assets.
    if(local&&response.ok&&!/\.onnx$|\.wasm$/.test(u.pathname)){const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});}return response;
  })));
});
