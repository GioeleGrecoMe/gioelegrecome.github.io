/**
 * Official AlvaAR runtime loader for Room Scanner V30.16.0+.
 *
 * Why this exists:
 * - AlvaAR's official dist/alva_ar.js is a ~4.13 MB single-file ES module.
 * - The app must never silently fall back to the tiny local wasm sentinel.
 * - A physical v30/vendor/alva_ar.js is preferred when present.
 * - Otherwise the official bundle is fetched once, validated, cached in
 *   CacheStorage, and imported from a Blob URL. Subsequent sessions work from
 *   the cache even when the network is unavailable.
 *
 * Upstream: https://github.com/alanross/AlvaAR
 * License: GPL-3.0 (see v30/vendor/ALVAAR_GPL-3.0.txt)
 */

export const ALVA_RUNTIME_CACHE='room-scanner-alvaar-official-v1';
export const ALVA_EXPECTED_MIN_BYTES=3_500_000;
export const ALVA_EXPECTED_MAX_BYTES=6_500_000;
export const ALVA_REQUIRED_MARKERS=['AlvaAR','Initialize','findCameraPose','getFramePoints'];

let modulePromise=null;
let lastStatus={state:'idle',source:null,bytes:0,cacheHit:false,error:null};

export function getAlvaRuntimeStatus(){return {...lastStatus};}

export function inspectAlvaSource(text,{minBytes=ALVA_EXPECTED_MIN_BYTES,maxBytes=ALVA_EXPECTED_MAX_BYTES}={}){
  if(typeof text!=='string')return {ok:false,reason:'not-text',bytes:0,markers:[]};
  const bytes=new TextEncoder().encode(text).byteLength;
  const markers=ALVA_REQUIRED_MARKERS.filter(m=>text.includes(m));
  if(bytes<minBytes)return {ok:false,reason:`too-small:${bytes}`,bytes,markers};
  if(bytes>maxBytes)return {ok:false,reason:`too-large:${bytes}`,bytes,markers};
  if(markers.length!==ALVA_REQUIRED_MARKERS.length)return {ok:false,reason:`api-markers:${markers.join(',')}`,bytes,markers};
  return {ok:true,reason:'ok',bytes,markers};
}

async function fetchText(url,{fetchImpl=globalThis.fetch,timeoutMs=20000}={}){
  if(typeof fetchImpl!=='function')throw new Error('fetch non disponibile');
  const controller=typeof AbortController!=='undefined'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  try{
    const response=await fetchImpl(url,{mode:'cors',cache:'no-store',credentials:'omit',signal:controller?.signal});
    if(!response?.ok)throw new Error(`HTTP ${response?.status||'?'}`);
    return await response.text();
  }finally{if(timer)clearTimeout(timer);}
}

async function readCache(cacheKey,{cachesImpl=globalThis.caches}={}){
  if(!cachesImpl?.open)return null;
  try{
    const cache=await cachesImpl.open(ALVA_RUNTIME_CACHE),response=await cache.match(cacheKey);
    if(!response)return null;
    const text=await response.text(),check=inspectAlvaSource(text);
    if(!check.ok){await cache.delete(cacheKey).catch(()=>{});return null;}
    return {text,check};
  }catch{return null;}
}

async function writeCache(cacheKey,text,source,{cachesImpl=globalThis.caches}={}){
  if(!cachesImpl?.open||typeof Response==='undefined')return false;
  try{
    const cache=await cachesImpl.open(ALVA_RUNTIME_CACHE);
    await cache.put(cacheKey,new Response(text,{status:200,headers:{'Content-Type':'text/javascript; charset=utf-8','X-RoomScan-Alva-Upstream':source||'unknown'}}));
    return true;
  }catch{return false;}
}

async function defaultImportSource(text){
  const blob=new Blob([text],{type:'text/javascript'}),url=URL.createObjectURL(blob);
  try{return await import(/* webpackIgnore: true */ url);}finally{URL.revokeObjectURL(url);}
}
async function defaultImportUrl(url){return import(/* webpackIgnore: true */ url);}

function validateModule(mod){
  if(!mod?.AlvaAR||typeof mod.AlvaAR.Initialize!=='function')throw new Error('bundle caricato ma export AlvaAR.Initialize mancante');
  return mod;
}

/**
 * Load the real official AlvaAR distribution.
 * `localUrl` is a physical vendored copy when available.
 * `cacheKey` is same-origin and is used only as the CacheStorage key.
 */
export async function loadAlvaModule({localUrl=null,cacheKey=null,sources=[],fetchImpl=globalThis.fetch,cachesImpl=globalThis.caches,importSource=defaultImportSource,importUrl=defaultImportUrl,timeoutMs=20000,force=false}={}){
  if(modulePromise&&!force)return modulePromise;
  modulePromise=(async()=>{
    lastStatus={state:'loading',source:null,bytes:0,cacheHit:false,error:null};
    const effectiveCacheKey=cacheKey||localUrl||new URL('../../vendor/alva_ar.cached.js',import.meta.url).href;
    const failures=[];

    // 1) Physical vendored copy: this is the fully offline path.
    if(localUrl){
      try{
        const text=await fetchText(localUrl,{fetchImpl,timeoutMs:5000}),check=inspectAlvaSource(text);
        if(!check.ok)throw new Error(`copia vendor non valida (${check.reason})`);
        const mod=validateModule(await importUrl(localUrl));
        await writeCache(effectiveCacheKey,text,localUrl,{cachesImpl});
        lastStatus={state:'ready',source:'vendor',url:localUrl,bytes:check.bytes,cacheHit:false,error:null};
        return mod;
      }catch(err){failures.push(`vendor: ${err?.message||err}`);}
    }

    // 2) Browser cache: lets the app keep working offline after one successful load.
    const cached=await readCache(effectiveCacheKey,{cachesImpl});
    if(cached){
      try{
        const mod=validateModule(await importSource(cached.text));
        lastStatus={state:'ready',source:'cache',url:effectiveCacheKey,bytes:cached.check.bytes,cacheHit:true,error:null};
        return mod;
      }catch(err){failures.push(`cache: ${err?.message||err}`);}
    }

    // 3) Official upstream/mirrors. Import the ES module directly. This avoids
    // decoding + duplicating the 4 MB Emscripten bundle as a giant JS string and
    // Blob before the browser can compile it, which caused memory/paint stalls
    // on mobile. The API itself is the authoritative runtime validation.
    for(const source of sources.filter(Boolean)){
      try{
        const mod=validateModule(await importUrl(source));
        lastStatus={state:'ready',source:'remote',url:source,bytes:0,cacheHit:false,error:null};
        // Best-effort offline copy after successful import. Never block AlvaAR
        // startup on this second fetch/cache operation.
        Promise.resolve().then(async()=>{try{const text=await fetchText(source,{fetchImpl,timeoutMs}),check=inspectAlvaSource(text);if(check.ok){await writeCache(effectiveCacheKey,text,source,{cachesImpl});lastStatus.bytes=check.bytes;}}catch{}});
        return mod;
      }catch(err){failures.push(`${source}: ${err?.message||err}`);}
    }

    const error=new Error(`AlvaAR ufficiale non disponibile. ${failures.join(' | ')||'nessuna sorgente configurata'}`);
    lastStatus={state:'error',source:null,bytes:0,cacheHit:false,error:error.message};
    throw error;
  })();
  try{return await modulePromise;}catch(err){modulePromise=null;throw err;}
}

/** Start the 4.13 MB download/cache in background without constructing SLAM. */
export async function prefetchAlvaModule(options={}){return loadAlvaModule(options);}
