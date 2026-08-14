const CACHE='room-acoustic-v925';
const SEMANTIC_CACHE='room-acoustic-semantic-v925';
const CORE=['./room_scanner_v9.html','./README.md','./ARCHITECTURE_V9.md'];
self.addEventListener('install',event=>{
  // Deliberately do NOT pre-cache the ~41 MB EfficientSAM weights. They ship with
  // the site and are cached lazily only if semantic inference is actually used.
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()).catch(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('room-acoustic-')&&k!==CACHE&&k!==SEMANTIC_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(resp=>{
    if(resp&&resp.ok){
      const u=new URL(event.request.url),same=u.origin===self.location.origin,
        semanticModel=same&&/\/models\/efficient_sam_vitt_(encoder|decoder)\.onnx$/i.test(u.pathname),
        runtime=(u.hostname==='cdn.jsdelivr.net'&&(/onnxruntime-web|three/.test(u.pathname)));
      if(semanticModel){const copy=resp.clone();caches.open(SEMANTIC_CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});}
      else if(same||runtime){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});}
    }
    return resp;
  }).catch(()=>hit)));
});
