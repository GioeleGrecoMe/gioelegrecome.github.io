const CACHE='room-acoustic-v951h2';
const SEMANTIC_CACHE='room-acoustic-semantic-v951h2';
const CORE=['./room_scanner_v9.html','./README.md','./ARCHITECTURE_V951.md','./MOBILESAM_INTEGRATION_V951.md'];

self.addEventListener('install',event=>{
  // Neural weights are deliberately lazy: a missing model must never prevent the
  // scanner shell from installing or the metric/audio pipeline from starting.
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()).catch(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(k=>k.startsWith('room-acoustic-')&&k!==CACHE&&k!==SEMANTIC_CACHE).map(k=>caches.delete(k))
  )).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(resp=>{
    if(resp&&resp.ok){
      const u=new URL(event.request.url),same=u.origin===self.location.origin;
      const semanticModel=(same&&/\/models\/.*mobile[_-]?sam.*\.onnx$/i.test(u.pathname))||
        (u.hostname==='huggingface.co'&&/mobile[_-]?sam.*(?:encoder|decoder).*\.onnx/i.test(u.pathname))||
        (u.hostname==='raw.githubusercontent.com'&&/MobileSAM-in-the-Browser.*decoder.*\.onnx/i.test(u.pathname));
      const runtime=(same&&/\/vendor\/ort(?:-|\.).*/i.test(u.pathname))||
        (u.hostname==='cdn.jsdelivr.net'&&/onnxruntime-web@1\.14\.0/.test(u.pathname));
      const three=(u.hostname==='cdn.jsdelivr.net'&&/\/three@/.test(u.pathname));
      if(semanticModel){const copy=resp.clone();caches.open(SEMANTIC_CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});}
      else if(same||runtime||three){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});}
    }
    return resp;
  }).catch(()=>hit)));
});
