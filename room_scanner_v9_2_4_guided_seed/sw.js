const CACHE='room-acoustic-v951h3';
const SEMANTIC_CACHE='room-acoustic-semantic-v951h3';
const DEPTH_CACHE='room-acoustic-depthai-v951h3';
const CORE=['./room_scanner_v9.html','./depth_ai_worker.js','./README.md','./ARCHITECTURE_V951.md','./MOBILESAM_INTEGRATION_V951.md','./DEPTHAI_INTEGRATION_V951.md'];

self.addEventListener('install',event=>{
  // Neural weights stay lazy: a missing MobileSAM/Depth Anything file must
  // never prevent the scanner shell, WebXR or the acoustic pipeline starting.
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()).catch(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(k=>k.startsWith('room-acoustic-')&&k!==CACHE&&k!==SEMANTIC_CACHE&&k!==DEPTH_CACHE).map(k=>caches.delete(k))
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
      const semanticRuntime=(same&&/\/vendor\/ort(?:-|\.).*/i.test(u.pathname))||
        (u.hostname==='cdn.jsdelivr.net'&&/onnxruntime-web@1\.14\.0/.test(u.pathname));
      const depthModel=(same&&/\/models\/depth_anything_v2_small_q4f16\.onnx$/i.test(u.pathname))||
        (u.hostname==='huggingface.co'&&/depth-anything-v2-small.*model_q4f16\.onnx/i.test(u.pathname));
      const depthRuntime=(same&&/\/vendor\/depthai\//i.test(u.pathname))||
        (u.hostname==='cdn.jsdelivr.net'&&/onnxruntime-web@1\.24\.1/.test(u.pathname));
      const three=(u.hostname==='cdn.jsdelivr.net'&&/\/three@/.test(u.pathname));
      if(semanticModel){const copy=resp.clone();caches.open(SEMANTIC_CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});}
      else if(depthModel||depthRuntime){const copy=resp.clone();caches.open(DEPTH_CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});}
      else if(same||semanticRuntime||three){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});}
    }
    return resp;
  }).catch(()=>hit)));
});
