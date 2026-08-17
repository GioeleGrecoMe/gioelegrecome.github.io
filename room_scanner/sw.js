/* Room Scanner V12.2.0 service worker.
 *
 * Audit fix: the repository previously kept a stale legacy cache/build identity while
 * serving V12.1.x.  This worker deliberately keeps the install cache tiny and
 * treats HTML, worker JS and build metadata as network-first so a deploy cannot
 * be hidden behind an old scanner shell. Large ONNX/WASM assets are cached only
 * after they are actually requested.
 */
'use strict';
const BUILD_REV='1220-guided-floor-shell-deep-20260817';
const CORE_CACHE='room-scanner-v1220-core';
const ASSET_CACHE='room-scanner-v1220-assets';
const CORE=['./room_scanner_v12.html','./build_info.json','./depth_ai_worker.js'];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CORE_CACHE);
    await Promise.all(CORE.map(async url=>{try{const r=await fetch(new Request(url,{cache:'reload'}));if(r.ok)await cache.put(url,r.clone())}catch(_){}}));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keep=new Set([CORE_CACHE,ASSET_CACHE]);
    for(const key of await caches.keys())if((key.startsWith('room-acoustic-')||key.startsWith('room-scanner-'))&&!keep.has(key))await caches.delete(key);
    await self.clients.claim();
  })());
});
function isDocument(req,url){return req.mode==='navigate'||/\/room_scanner_v\d+(?:_\d+)?\.html$/i.test(url.pathname)}
function isCriticalCode(url){return /\/(?:depth_ai_worker\.js|build_info\.json)$/i.test(url.pathname)}
function isHeavyAsset(url){return /\.(?:onnx|wasm)$/i.test(url.pathname)||/\/vendor\/depthai-/i.test(url.pathname)}
async function networkFirst(req,cacheName){const cache=await caches.open(cacheName);try{const r=await fetch(req);if(r&&r.ok)await cache.put(req,r.clone());return r}catch(e){const hit=await cache.match(req,{ignoreSearch:false})||await cache.match(new URL(req.url).pathname.split('/').pop());if(hit)return hit;throw e}}
async function cacheFirst(req){const cache=await caches.open(ASSET_CACHE),hit=await cache.match(req);if(hit)return hit;const r=await fetch(req);if(r&&r.ok)await cache.put(req,r.clone());return r}
self.addEventListener('fetch',event=>{const req=event.request,url=new URL(req.url);if(req.method!=='GET'||url.origin!==self.location.origin)return;if(isDocument(req,url)||isCriticalCode(url)){event.respondWith(networkFirst(req,CORE_CACHE));return}if(isHeavyAsset(url)){event.respondWith(cacheFirst(req));return}event.respondWith((async()=>{try{return await fetch(req)}catch(e){return await caches.match(req)||Promise.reject(e)}})())});
self.addEventListener('message',event=>{if(event.data?.type==='GET_BUILD')event.source?.postMessage?.({type:'ROOM_SCANNER_BUILD',version:'V12.2.0',revision:BUILD_REV,coreCache:CORE_CACHE,assetCache:ASSET_CACHE})});
