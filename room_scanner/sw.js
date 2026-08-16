const CACHE='room-acoustic-v1006m4';
const SEMANTIC_CACHE='room-acoustic-semantic-v1006m4';
const DEPTH_CACHE='room-acoustic-depthai-v1006m4';
const BUILD_REV='1006m4';
const CORE=['./room_scanner_v9.html','./room_scanner_v10.html','./build_info.json','./depth_ai_worker.js','./README.md','./ARCHITECTURE_V951.md','./MOBILESAM_INTEGRATION_V951.md','./DEPTHAI_INTEGRATION_V951.md'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()).catch(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('room-acoustic-')&&! [CACHE,SEMANTIC_CACHE,DEPTH_CACHE].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

function classify(req){
  const u=new URL(req.url),same=u.origin===self.location.origin;
  const model=same&&/\/models\/.*\.onnx$/i.test(u.pathname);
  const ort=same&&/\/vendor\/(?:depthai(?:-\d+)?\/)?ort(?:-|\.).*/i.test(u.pathname);
  const remoteModel=u.hostname==='huggingface.co'&&/\.onnx(?:$|\?)/i.test(u.pathname+u.search);
  const remoteOrt=u.hostname==='cdn.jsdelivr.net'&&/onnxruntime-web@/.test(u.pathname);
  return {u,same,neural:model||ort||remoteModel||remoteOrt,depth:/depth_anything|\/depthai(?:-\d+)?\//i.test(u.pathname)};
}
async function neuralNetworkFirst(req,depth){
  const cache=await caches.open(depth?DEPTH_CACHE:SEMANTIC_CACHE);
  try{
    // Critical for GitHub Pages redeploys: do not let an old ONNX/WASM response
    // shadow a newly uploaded file. Network wins; verified HTTP success is then
    // cached for offline use.
    const r=await fetch(req,{cache:'no-store'});if(r&&r.ok){await cache.put(req,r.clone());return r}
    const old=await cache.match(req);if(old)return old;return r
  }catch(e){const old=await cache.match(req);if(old)return old;throw e}
}
async function documentNetworkFirst(req){
  const cache=await caches.open(CACHE);
  try{
    const fresh=await fetch(req,{cache:'no-store'});
    if(fresh&&fresh.ok)await cache.put(req,fresh.clone());
    return fresh;
  }catch(e){
    const old=await cache.match(req,{ignoreSearch:true});
    if(old)return old;
    throw e;
  }
}
self.addEventListener('message',event=>{if(event.data?.type==='ROOM_SCANNER_BUILD_QUERY')event.source?.postMessage?.({type:'ROOM_SCANNER_BUILD',build:BUILD_REV})});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;const k=classify(event.request);
  const isDocument=event.request.mode==='navigate'||(k.same&&/\/room_scanner_v9\.html$/i.test(k.u.pathname));
  if(isDocument){event.respondWith(documentNetworkFirst(event.request));return}
  if(k.neural){event.respondWith(neuralNetworkFirst(event.request,k.depth));return}
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(resp=>{if(resp&&resp.ok&&k.same){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{})}return resp}).catch(()=>hit)));
});
