/*
 * Room Scanner V11 - Depth Anything worker shim
 * ==============================================
 * This file changes ONLY the dedicated Depth Anything worker at runtime.
 * It does NOT touch room_scanner_v10.html on disk, Service Worker, WebXR,
 * camera/audio acquisition, geometry, SAM/MobileSAM, splatting, preprocessing
 * math, metric fitting, fusion gates, or thresholds.
 *
 * Why a shim instead of replacing the whole worker?
 * - It reuses the exact depth_ai_worker.js already deployed with V10.
 * - It performs two reviewed functional fixes only:
 *   1) Same-origin absolute ORT URLs must keep same-origin wasmPaths.
 *   2) The worker-local fallback runtime is 1.23.2, not stale 1.24.1.
 * - It injects bounded, read-only tracing around runtime/model/session/inference.
 * - It validates exact source anchors and fails closed if the V10 worker changes.
 *
 * No new folders are required. This file lives next to room_scanner_v11.html.
 */
'use strict';

const V11_WORKER_BUILD = 'room-scanner-v11-d10-depth-worker-boottrace-2026-08-16';
const ORIGINAL_WORKER_URL = './depth_ai_worker.js';
const bootstrapEvents = [];
const BOOT_MAX = 180;
let webgpuProbe = {attempted:false,available:!!(self.navigator&&self.navigator.gpu)};
let patchedDepthDebugSnapshot = null;

function bootLog(type, detail = {}) {
  let clean = detail;
  try { clean = JSON.parse(JSON.stringify(detail)); }
  catch (_) { clean = { text: String(detail) }; }
  const item={iso:new Date().toISOString(),t_ms:Math.round(performance.now()),type,detail:clean};
  bootstrapEvents.push(item);
  if (bootstrapEvents.length > BOOT_MAX) bootstrapEvents.splice(0, bootstrapEvents.length - BOOT_MAX);
  // Send progress immediately. This makes a hung InferenceSession.create() diagnosable.
  try { self.postMessage({__depthDiagV11:true,progress:{scope:'bootstrap',...item}}); } catch (_) {}
}

async function probeWebGPU() {
  const t0=performance.now();
  const timeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timeout '+ms+'ms')),ms))]);
  webgpuProbe={attempted:true,available:!!(self.navigator&&self.navigator.gpu),secureContext:typeof self.isSecureContext==='boolean'?self.isSecureContext:null};
  if(!webgpuProbe.available){webgpuProbe.result='navigator.gpu-unavailable';webgpuProbe.elapsed_ms=Math.round((performance.now()-t0)*10)/10;bootLog('webgpu-probe-unavailable',webgpuProbe);return webgpuProbe;}
  try{
    bootLog('webgpu-request-adapter-start',{timeoutMs:2500});
    const a0=performance.now(),adapter=await timeout(self.navigator.gpu.requestAdapter({powerPreference:'high-performance'}),2500,'requestAdapter');
    webgpuProbe.adapterElapsed_ms=Math.round((performance.now()-a0)*10)/10;
    if(!adapter){webgpuProbe.result='adapter-null';bootLog('webgpu-request-adapter-null',webgpuProbe);return webgpuProbe;}
    let info=null;try{info=adapter.info?JSON.parse(JSON.stringify(adapter.info)):(typeof adapter.requestAdapterInfo==='function'?await timeout(adapter.requestAdapterInfo(),1200,'requestAdapterInfo'):null)}catch(e){info={error:String(e&&e.stack||e)}}
    let features=[];try{features=Array.from(adapter.features||[]).sort()}catch(_){}
    const limits={},keys=['maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupStorageSize','maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupsPerDimension'];
    try{for(const k of keys)if(adapter.limits&&k in adapter.limits)limits[k]=Number(adapter.limits[k])}catch(_){}
    webgpuProbe.adapter={info,features,limits};webgpuProbe.result='adapter-ok';
    try{bootLog('webgpu-request-device-start',{timeoutMs:2200});const d0=performance.now(),device=await timeout(adapter.requestDevice(),2200,'requestDevice');webgpuProbe.device='ok';webgpuProbe.deviceElapsed_ms=Math.round((performance.now()-d0)*10)/10;try{device.destroy()}catch(_){}}catch(e){webgpuProbe.device='failed';webgpuProbe.deviceError=String(e&&e.stack||e);bootLog('webgpu-request-device-failed',{error:webgpuProbe.deviceError})}
  }catch(e){webgpuProbe.result=/timeout/i.test(String(e&&e.message||e))?'probe-timeout':'probe-exception';webgpuProbe.error=String(e&&e.stack||e)}
  webgpuProbe.elapsed_ms=Math.round((performance.now()-t0)*10)/10;bootLog('webgpu-probe-complete',webgpuProbe);return webgpuProbe;
}

// D10 critical fix: capture messages that arrive while this shim is still fetching and
// patching the original worker. In the previous build, the parent could post `init` immediately after
// new Worker(), while the shim was awaiting fetch(); because self.onmessage had not yet
// been installed, that message could be dispatched and lost. The queue below is installed
// synchronously before the first async yield and is removed only after the real handler exists.
const earlyMessageQueue = [];
let runtimeHandlerReady = false;
const EARLY_MESSAGE_MAX = 16;
function captureEarlyMessage(event) {
  if (runtimeHandlerReady) return;
  const data = event && event.data;
  if (earlyMessageQueue.length >= EARLY_MESSAGE_MAX) {
    bootLog('early-message-overflow', {max: EARLY_MESSAGE_MAX, type: data && data.type || '', id: data && data.id || null});
    return;
  }
  earlyMessageQueue.push(data);
  bootLog('early-message-queued', {
    type: data && data.type || '',
    id: data && data.id || null,
    queueLength: earlyMessageQueue.length
  });
}
self.addEventListener('message', captureEarlyMessage);

function bootstrapSnapshot(reason, error = null) {
  return {
    schema: 'room-scanner-depthai-debug-v11-bootstrap',
    build: V11_WORKER_BUILD,
    reason,
    error: error ? String(error && error.stack || error) : null,
    environment: {
      href: self.location && self.location.href || '',
      origin: self.location && self.location.origin || '',
      userAgent: self.navigator && self.navigator.userAgent || '',
      hardwareConcurrency: self.navigator && self.navigator.hardwareConcurrency || null,
      webgpu: !!(self.navigator && self.navigator.gpu),
      crossOriginIsolated: !!self.crossOriginIsolated,
      webgpuProbe
    },
    patchedWorker:(()=>{try{return patchedDepthDebugSnapshot?patchedDepthDebugSnapshot('bootstrap-snapshot'):null}catch(_){return null}})(),
    events: bootstrapEvents.slice()
  };
}

function emitBootstrap(reason, error = null) {
  try { self.postMessage({ __depthDiagV11: true, debug: bootstrapSnapshot(reason, error) }); }
  catch (_) {}
}

function failWorker(error) {
  bootLog('bootstrap-failed', { error: String(error && error.stack || error) });
  emitBootstrap('bootstrap-failed', error);
  // Preserve the app request/reply contract so the V10 UI gets a useful failure instead of hanging.
  self.onmessage = event => {
    const msg = event && event.data || {};
    self.postMessage({
      id: msg.id,
      ok: false,
      error: `DepthAI V11 bootstrap failed: ${String(error && error.message || error)}`,
      debug: bootstrapSnapshot('bootstrap-failed-command', error)
    });
  };
  // D10: even bootstrap failures must answer requests that arrived before the handler existed.
  runtimeHandlerReady = true;
  try { self.removeEventListener('message', captureEarlyMessage); } catch (_) {}
  if (earlyMessageQueue.length) {
    const replay = earlyMessageQueue.splice(0, earlyMessageQueue.length);
    bootLog('early-message-replay-on-failure', {count: replay.length});
    for (const data of replay) {
      try { self.onmessage({data}); } catch (_) {}
    }
  }
}

function countOf(text, needle) {
  if (!needle) return 0;
  let count = 0, pos = 0;
  while ((pos = text.indexOf(needle, pos)) >= 0) { count++; pos += needle.length; }
  return count;
}

function replaceOnce(text, oldText, newText, label) {
  const n = countOf(text, oldText);
  if (n !== 1) throw new Error(`${label}: expected exactly one source anchor, found ${n}`);
  return text.replace(oldText, newText);
}

function augmentDepthDiagnostics(src, changes) {
  if (!src.includes('function depthDebug(')) return src;
  // Stream existing worker diagnostics to the page in real time instead of only on final reply.
  if (!src.includes('DEPTHAI_LIVE_PROGRESS_V11')) {
    const a1="  depthDebugEvents.push({t_ms:Math.round(performance.now()), iso:new Date().toISOString(), type, detail:clean});";
    const a2="  depthDebugEvents.push({t_ms:Math.round(performance.now()),iso:new Date().toISOString(),type,detail:clean});";
    const add="\n  // DEPTHAI_LIVE_PROGRESS_V11\n  try { self.postMessage({__depthDiagV11:true,progress:{scope:'worker',iso:new Date().toISOString(),t_ms:Math.round(performance.now()),type,detail:clean}}); } catch (_) {}";
    if(src.includes(a1))src=src.replace(a1,a1+add,1);else if(src.includes(a2))src=src.replace(a2,a2+add,1);else throw new Error('depthDebug push anchor not found');
    if(src.includes('const DEPTH_DEBUG_MAX = 120;'))src=src.replace('const DEPTH_DEBUG_MAX = 120;','const DEPTH_DEBUG_MAX = 360;',1);
    else if(src.includes('const DEPTH_DEBUG_MAX = 140;'))src=src.replace('const DEPTH_DEBUG_MAX = 140;','const DEPTH_DEBUG_MAX = 360;',1);
    changes.push('real-time worker progress stream');
  }
  // D10 ORT ASSET FIX for an already-instrumented public worker.
  if (!src.includes('DEPTHAI_D10_ORT_ASSET_FIX') && !src.includes('const d10OrtDist =')) {
    const a="  ortApi.env.wasm.simd = true;\n";
    const b="  ortApi.env.wasm.simd = true; // DEPTHAI_D10_ORT_ASSET_FIX\n  const d10OrtDist = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/`;\n  const d10WasmStem = wantsWebGPU ? 'ort-wasm-simd-threaded.asyncify' : 'ort-wasm-simd-threaded';\n  ortApi.env.wasm.wasmPaths = {mjs:`${d10OrtDist}${d10WasmStem}.mjs`,wasm:`${d10OrtDist}${d10WasmStem}.wasm`};\n  depthDebug('runtime-assets-pinned',{runtimeSource,runtimeVersion,wantsWebGPU,mjs:ortApi.env.wasm.wasmPaths.mjs,wasm:ortApi.env.wasm.wasmPaths.wasm});\n";
    if(src.includes(a))src=src.replace(a,b,1);else throw new Error('D10 ORT asset fix: wasm.simd anchor not found');
    changes.push('explicit ORT 1.23.2 mjs/wasm asset pin');
  }
  // Log runtime selection before any import/session work.
  if (!src.includes("depthDebug('runtime-plan'")) {
    const a="  const candidates = wantsWebGPU ? [versionedWorkerAsset(`${localRuntimeDir}ort.webgpu.min.js`)] : [versionedWorkerAsset(`${localRuntimeDir}ort.min.js`)];\n";
    if(src.includes(a))src=src.replace(a,a+"  depthDebug('runtime-plan',{forceWasm:!!forceWasmRuntime,navigatorGpu:!!self.navigator?.gpu,wantsWebGPU,candidates});\n",1);
  }
  if (!src.includes("depthDebug('init-config'")) {
    const a="      forceWasmRuntime = !!msg.forceWasm;\n";
    if(src.includes(a))src=src.replace(a,a+"      depthDebug('init-config',{inputSize,runtimeVersion,deployRev,forceWasm:!!forceWasmRuntime,modelLocal:msg.modelLocal||null,modelRemote:msg.modelRemote||null,navigatorGpu:!!self.navigator?.gpu});\n",1);
  }
  // Separate preprocessing from actual ORT session.run().
  if (!src.includes("depthDebug('preprocess-start'")) {
    const a="  const prep = preprocessRGBA(msg.rgba, Number(msg.width), Number(msg.height), shapeHint);\n";
    if(src.includes(a))src=src.replace(a,"  const prepT0=performance.now();depthDebug('preprocess-start',{source:[Number(msg.width),Number(msg.height)],rgbaBytes:msg.rgba?.byteLength||0,shapeHint});\n"+a+"  depthDebug('preprocess-ok',{input:[prep.width,prep.height],tensorLength:prep.data?.length||0,elapsed_ms:Math.round((performance.now()-prepT0)*10)/10});\n",1);
  }
  if (!src.includes("depthDebug('session-run-start'")) {
    const a="  const out = await runDepthSession(prep);\n";
    if(src.includes(a))src=src.replace(a,"  const runT0=performance.now();depthDebug('session-run-start',{provider:activeProvider,input:[prep.width,prep.height]});\n"+a+"  depthDebug('session-run-ok',{provider:activeProvider,elapsed_ms:Math.round((performance.now()-runT0)*10)/10,outputs:Object.keys(out||{})});\n",1);
  }
  if (!src.includes("depthDebug('output-stats'")) {
    const a="  if(depth.length!==w*h)throw new Error(`Depth Anything: output size ${depth.length} != ${w}x${h}`);\n";
    if(src.includes(a))src=src.replace(a,a+"  let dMin=Infinity,dMax=-Infinity,dSum=0,dCount=0;for(let i=0;i<depth.length;i++){const v=depth[i];if(Number.isFinite(v)){if(v<dMin)dMin=v;if(v>dMax)dMax=v;dSum+=v;dCount++}}depthDebug('output-stats',{width:w,height:h,count:depth.length,finite:dCount,min:dCount?dMin:null,max:dCount?dMax:null,mean:dCount?dSum/dCount:null});\n",1);
  }
  if (!src.includes("depthDebug('smoke-start'")) {
    const a="    if (msg.type === 'smoke') {\n";if(src.includes(a))src=src.replace(a,a+"      depthDebug('smoke-start',{provider:activeProvider});\n",1);
  }
  changes.push('phase timing: runtime/preprocess/session.run/output');
  return src;
}

function patchDepthWorkerSource(source) {
  let src = source;
  const changes = [];

  // Functional fix #1: absolute HTTPS does NOT imply remote; compare origins instead.
  if (!src.includes('DEPTHAI_RUNTIME_ORIGIN_FIX')) {
    src = replaceOnce(
      src,
      "  const remote = /^https?:/i.test(runtimeSource);\n",
      "  // DEPTHAI_RUNTIME_ORIGIN_FIX: absolute same-origin ORT URLs keep local WASM/JSEP assets.\n" +
      "  const runtimeURL = new URL(runtimeSource, self.location.href);\n" +
      "  const remote = runtimeURL.origin !== self.location.origin;\n",
      'same-origin runtime classification'
    );
    changes.push('same-origin wasmPaths routing');
    changes.push('D10 explicit ORT mjs/wasm asset pin');
  }

  // Functional fix #2: keep the worker fallback on the reviewed/tested ORT Web 1.23.2.
  if (!src.includes('DEPTHAI_RUNTIME_DEFAULT_FIX')) {
    src = replaceOnce(
      src,
      "      runtimeVersion = String(msg.runtimeVersion || '1.24.1');\n",
      "      runtimeVersion = String(msg.runtimeVersion || '1.23.2'); // DEPTHAI_RUNTIME_DEFAULT_FIX\n",
      'worker runtime fallback'
    );
    changes.push('worker fallback ORT 1.23.2');
  }

  // If V10 already contains the V3 trace, retain it but upgrade it to live V11 diagnostics.
  if (src.includes('DEPTHAI_DIAG_V3') || src.includes('DEPTHAI_DIAG_V11')) {
    changes.push('existing worker diagnostics retained');
    src = augmentDepthDiagnostics(src, changes);
    return { src, changes };
  }

  // Everything below this point is diagnostics only; no inference math or provider order changes.
  const helperAnchor = 'const STD = [0.229, 0.224, 0.225];\n';
  const helper = String.raw`

// DEPTHAI_DIAG_V11: bounded worker-local trace; no global Worker/fetch/console monkey-patching.
const DEPTHAI_DIAG_V11 = true;
const DEPTH_DEBUG_MAX = 140;
const depthDebugEvents = [];
let depthDebugStage = 'worker-boot';
function depthDebug(type, detail = {}) {
  depthDebugStage = type;
  let clean = detail;
  try { clean = JSON.parse(JSON.stringify(detail)); } catch (_) { clean = {text:String(detail)}; }
  depthDebugEvents.push({t_ms:Math.round(performance.now()),iso:new Date().toISOString(),type,detail:clean});
  if (depthDebugEvents.length > DEPTH_DEBUG_MAX) depthDebugEvents.splice(0, depthDebugEvents.length - DEPTH_DEBUG_MAX);
}
function depthDebugSnapshot(reason = '') {
  let wasmPaths = null;
  try { wasmPaths = ortApi?.env?.wasm?.wasmPaths ?? null; } catch (_) {}
  return {
    schema:'room-scanner-depthai-debug-v11', reason, stage:depthDebugStage,
    runtimeVersion, runtimeSource, modelSource, activeProvider,
    forceWasm:!!forceWasmRuntime, wasmPaths, modelIntegrity,
    environment:{
      href:self.location?.href||'', origin:self.location?.origin||'',
      userAgent:self.navigator?.userAgent||'', hardwareConcurrency:self.navigator?.hardwareConcurrency||null,
      webgpu:!!self.navigator?.gpu, crossOriginIsolated:!!self.crossOriginIsolated,
    },
    events:depthDebugEvents.slice(),
  };
}
depthDebug('worker-boot',{href:self.location?.href||'',webgpu:!!self.navigator?.gpu,crossOriginIsolated:!!self.crossOriginIsolated});
`;
  src = replaceOnce(src, helperAnchor, helperAnchor + helper, 'debug helper anchor');
  changes.push('bounded DepthAI trace');

  // Log every ORT runtime import candidate and its exact error/stack.
  const importOld = `function importRuntime(url) {
  importScripts(url);
  if (!self.ort || !self.ort.InferenceSession) throw new Error(\`ORT non esposto da \${url}\`);
  ortApi = self.ort;
  runtimeSource = url;
}
`;
  const importNew = `function importRuntime(url) {
  depthDebug('runtime-import-start',{url});
  try {
    importScripts(url);
    if (!self.ort || !self.ort.InferenceSession) throw new Error(\`ORT non esposto da \${url}\`);
    ortApi = self.ort;
    runtimeSource = url;
    depthDebug('runtime-import-ok',{url});
  } catch (e) {
    depthDebug('runtime-import-failed',{url,error:errText(e),stack:String(e?.stack||'')});
    throw e;
  }
}
`;
  src = replaceOnce(src, importOld, importNew, 'importRuntime body');

  // Record the exact wasmPaths/provider context selected after ORT setup.
  src = replaceOnce(
    src,
    "  ortApi.env.wasm.simd = true;\n",
    "  ortApi.env.wasm.simd = true;\n" +
    "  // DEPTHAI_D10_ORT_ASSET_FIX: single-injection marker; the D8 trace proved the local vendor directory is missing the Emscripten .mjs artifact.\n" +
    "  // Pin BOTH module and wasm binaries to the same official ORT Web version used by this Depth worker.\n" +
    "  const d10OrtDist = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/`;\n" +
    "  const d10WasmStem = wantsWebGPU ? 'ort-wasm-simd-threaded.asyncify' : 'ort-wasm-simd-threaded';\n" +
    "  ortApi.env.wasm.wasmPaths = {mjs:`${d10OrtDist}${d10WasmStem}.mjs`,wasm:`${d10OrtDist}${d10WasmStem}.wasm`};\n" +
    "  depthDebug('runtime-assets-pinned',{runtimeSource,runtimeVersion,wantsWebGPU,mjs:ortApi.env.wasm.wasmPaths.mjs,wasm:ortApi.env.wasm.wasmPaths.wasm});\n" +
    "  depthDebug('runtime-ready',{runtimeSource,runtimeVersion,remote,wasmPaths:ortApi.env.wasm.wasmPaths,forceWasm:!!forceWasmRuntime});\n",
    'runtime-ready anchor'
  );

  // DEPTHAI_MODEL_LOADER_V11_DIAG3
  // Replace ONLY fetchVerifiedModel(). The rest of Depth Anything model/session logic remains untouched.
  // Why: the previous implementation used response.arrayBuffer() and exposed no progress while the
  // complete 19.1 MB model was downloading. It also could not distinguish a real ONNX file from a
  // Git-LFS pointer or an HTML/404 response returned by a static host/service worker.
  {
    const modelFnStart = src.indexOf('async function fetchVerifiedModel(url){');
    const modelFnEnd = src.indexOf('async function createSessionFrom', modelFnStart);
    if (modelFnStart < 0 || modelFnEnd < 0 || modelFnEnd <= modelFnStart) {
      throw new Error('fetchVerifiedModel(): source anchors not found');
    }
    const robustModelLoader = String.raw`async function fetchVerifiedModel(url){
  const expectedBytes=Number(DEPTH_MODEL_PIN.bytes);
  const expectedSha=String(DEPTH_MODEL_PIN.sha256||'').toLowerCase();
  const officialRemote='https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4f16.onnx';
  const flatLocal=new URL('./depth_anything_v2_small_q4f16.onnx',self.location.href).href;
  const requested=new URL(url||flatLocal,self.location.href).href;
  const oldFolderLocal=new URL('./models/depth_anything_v2_small_q4f16.onnx',self.location.href).href;

  // D10 LOCAL-FIRST: prefer the flat same-origin model uploaded next to this worker/page.
  // This avoids Hugging Face/Xet redirects and any stale /models/ deployment before we know
  // the local file is absent. The legacy/requested/remote candidates remain only as fallbacks.
  const rawCandidates=[flatLocal,requested,oldFolderLocal,officialRemote];
  const candidates=[];
  for(const c of rawCandidates){if(c&&!candidates.includes(c))candidates.push(c)}
  depthDebug('model-candidates',{requested,candidates,expectedBytes,expectedSha});

  const errors=[];
  for(let ci=0;ci<candidates.length;ci++){
    const original=candidates[ci];
    const u=new URL(original,self.location.href);
    const local=u.origin===self.location.origin;
    if(local)u.searchParams.set('rsbuild',deployRev);
    const absolute=u.href;
    const ac=new AbortController();
    let hardTimer=null,noProgressTimer=null,modelHeartbeat=null,phase='candidate-start';
    const hardTimeoutMs=180000;
    const noProgressTimeoutMs=25000;
    let received=0,lastProgressAt=performance.now();
    const resetNoProgress=()=>{clearTimeout(noProgressTimer);noProgressTimer=setTimeout(()=>ac.abort('model-no-progress-timeout'),noProgressTimeoutMs)};
    try{
      depthDebug('model-candidate-start',{index:ci+1,total:candidates.length,url:absolute,local,hardTimeoutMs,noProgressTimeoutMs});
      hardTimer=setTimeout(()=>ac.abort('model-hard-timeout'),hardTimeoutMs);
      resetNoProgress();
      const t0=performance.now();phase='fetch-headers';
      modelHeartbeat=setInterval(()=>depthDebug('model-heartbeat',{index:ci+1,total:candidates.length,url:absolute,phase,receivedBytes:received,expectedBytes,wait_ms:Math.round(performance.now()-t0)}),1000);
      const r=await fetch(absolute,{cache:local?'no-store':'default',mode:'cors',credentials:local?'same-origin':'omit',redirect:'follow',signal:ac.signal});
      phase='download-body';
      const contentType=String(r.headers.get('content-type')||'').toLowerCase();
      const contentLengthRaw=r.headers.get('content-length');
      const contentLength=contentLengthRaw?Number(contentLengthRaw):null;
      depthDebug('model-fetch-response',{index:ci+1,url:absolute,finalUrl:r.url||absolute,redirected:!!r.redirected,status:r.status,ok:r.ok,contentType,contentLength,local,elapsed_ms:Math.round((performance.now()-t0)*10)/10});
      if(!r.ok)throw new Error('HTTP '+r.status);
      if(contentType.includes('text/html'))throw new Error('risposta HTML al posto del modello ONNX');
      if(Number.isFinite(contentLength)&&contentLength>0&&contentLength<1024)depthDebug('model-suspicious-small-response',{contentLength,contentType,url:absolute});

      let buffer;
      if(r.body&&typeof r.body.getReader==='function'){
        // Preallocate exactly the pinned model size: this avoids retaining both an array of chunks
        // and a second merged 19.1 MB copy on memory-constrained phones.
        const reader=r.body.getReader(),merged=new Uint8Array(expectedBytes);
        while(true){
          const q=await reader.read();
          if(q.done)break;
          if(q.value&&q.value.byteLength){
            if(received+q.value.byteLength>expectedBytes)throw new Error('download modello supera la dimensione attesa');
            merged.set(q.value,received);received+=q.value.byteLength;lastProgressAt=performance.now();resetNoProgress();
            const pct=Number.isFinite(contentLength)&&contentLength>0?Math.min(100,received*100/contentLength):Math.min(100,received*100/expectedBytes);
            depthDebug('model-download-progress',{index:ci+1,receivedBytes:received,expectedBytes,contentLength,percent:Math.round(pct*10)/10,elapsed_ms:Math.round((performance.now()-t0)*10)/10});
          }
        }
        buffer=received===expectedBytes?merged.buffer:merged.slice(0,received).buffer;
      }else{
        depthDebug('model-stream-unavailable',{index:ci+1,url:absolute});
        buffer=await r.arrayBuffer();received=buffer.byteLength;
      }
      clearTimeout(noProgressTimer);
      depthDebug('model-bytes',{index:ci+1,bytes:buffer.byteLength,expectedBytes,url:absolute,totalElapsed_ms:Math.round((performance.now()-t0)*10)/10});

      // Give a precise explanation for the most common GitHub Pages failure instead of a generic size mismatch.
      if(buffer.byteLength<2048){
        let head='';try{head=new TextDecoder().decode(new Uint8Array(buffer,0,Math.min(buffer.byteLength,512)))}catch(_){}
        if(/git-lfs\.github\.com\/spec\/v1/i.test(head))throw new Error('Git-LFS pointer rilevato: Git LFS non viene servito da GitHub Pages');
        if(/<!doctype html|<html[\s>]/i.test(head))throw new Error('documento HTML rilevato al posto del modello ONNX');
      }
      if(buffer.byteLength!==expectedBytes)throw new Error('dimensione modello '+buffer.byteLength+' != '+expectedBytes);
      phase='sha256';depthDebug('model-hash-start',{bytes:buffer.byteLength});
      const hash=await sha256Hex(buffer);
      depthDebug('model-sha256',{index:ci+1,sha256:hash||'unavailable',expectedSha256:expectedSha,match:!hash||String(hash).toLowerCase()===expectedSha});
      if(hash&&String(hash).toLowerCase()!==expectedSha)throw new Error('SHA-256 del modello non corrisponde al Q4F16 ufficiale');
      modelIntegrity={bytes:buffer.byteLength,sha256:hash||'unavailable',url:absolute,requestedUrl:requested,candidateIndex:ci+1};
      depthDebug('model-verified',{modelIntegrity});
      return {buffer,absolute};
    }catch(e){
      const reason=(e&&e.name==='AbortError')?('timeout/abort: '+String(ac.signal&&ac.signal.reason||e.message||e)):errText(e);
      errors.push({url:absolute,local,error:reason,receivedBytes:received});
      depthDebug('model-candidate-failed',{index:ci+1,total:candidates.length,url:absolute,local,error:reason,receivedBytes:received,sinceLastProgress_ms:Math.round((performance.now()-lastProgressAt)*10)/10});
    }finally{
      clearTimeout(hardTimer);clearTimeout(noProgressTimer);clearInterval(modelHeartbeat);
    }
  }
  const summary=errors.map((x,i)=>(i+1)+') '+x.url+' :: '+x.error+' ['+x.receivedBytes+' bytes]').join(' | ');
  throw new Error('DepthAI: nessun modello Q4F16 caricabile. '+summary);
}
`;
    src = src.slice(0, modelFnStart) + robustModelLoader + src.slice(modelFnEnd);
    changes.push('robust streamed model loader with flat/local/remote fallback');
  }

  // Session creation: provider list and ORT options remain byte-for-byte the same.
  const sessionOld = `async function createSessionFrom(buffer, providers) {
  const opts = {executionProviders: providers,graphOptimizationLevel:'all',enableCpuMemArena:true,enableMemPattern:true};
  return await ortApi.InferenceSession.create(buffer, opts);
}
`;
  const sessionNew = `async function createSessionFrom(buffer, providers) {
  const opts = {executionProviders: providers,graphOptimizationLevel:'all',enableCpuMemArena:true,enableMemPattern:true};
  depthDebug('session-create-start',{providers,modelBytes:buffer?.byteLength||0});
  const t0=performance.now();const hb=setInterval(()=>depthDebug('session-create-heartbeat',{providers,wait_ms:Math.round(performance.now()-t0)}),1500);
  try {
    const s=await ortApi.InferenceSession.create(buffer, opts);
    clearInterval(hb);depthDebug('session-create-ok',{providers,elapsed_ms:Math.round(performance.now()-t0)});
    return s;
  } catch(e) {
    clearInterval(hb);depthDebug('session-create-failed',{providers,elapsed_ms:Math.round(performance.now()-t0),error:errText(e),stack:String(e?.stack||'')});
    throw e;
  }
}
`;
  src = replaceOnce(src, sessionOld, sessionNew, 'session creation body');

  // Inference trace: dimensions/timing only; preprocessing and output checks are untouched.
  src = replaceOnce(
    src,
    "async function infer(msg) {\n  if (!session) throw new Error('DepthAI sessione non inizializzata');\n",
    "async function infer(msg) {\n  const inferT0=performance.now();\n  depthDebug('infer-start',{width:Number(msg.width),height:Number(msg.height),provider:activeProvider});\n  if (!session) throw new Error('DepthAI sessione non inizializzata');\n",
    'inference start'
  );
  const finiteLine = "  let finite=0;for(let i=0;i<depth.length;i++)if(Number.isFinite(depth[i]))finite++;if(finite<depth.length*.98)throw new Error(`Depth Anything: output non finito (${finite}/${depth.length})`);\n";
  src = replaceOnce(
    src,
    finiteLine,
    finiteLine + "  depthDebug('infer-ok',{provider:activeProvider,input:[prep.width,prep.height],output:[w,h],outputName,finite,total:depth.length,inferenceMs:Math.round((performance.now()-inferT0)*10)/10});\n",
    'inference output validation'
  );

  // Attach snapshots to init/smoke/failure responses so the V11 page can display/copy them.
  src = replaceOnce(
    src,
    "self.onmessage = async (event) => {\n  const msg = event.data || {};\n  const id = msg.id;\n",
    "self.onmessage = async (event) => {\n  const msg = event.data || {};\n  const id = msg.id;\n  depthDebug('message',{type:msg.type||'',id:id??null});\n",
    'worker message entry'
  );
  src = replaceOnce(
    src,
    '        contract: validateDepthContract(session), modelIntegrity, wasmPaths: ortApi.env.wasm.wasmPaths,\n',
    "        contract: validateDepthContract(session), modelIntegrity, wasmPaths: ortApi.env.wasm.wasmPaths,\n        debug: depthDebugSnapshot('init-ok'),\n",
    'init response snapshot'
  );
  src = replaceOnce(
    src,
    'modelIntegrity,wasmPaths:ortApi.env.wasm.wasmPaths});\n',
    "modelIntegrity,wasmPaths:ortApi.env.wasm.wasmPaths,debug:depthDebugSnapshot('smoke-ok')});\n",
    'smoke response snapshot'
  );
  src = replaceOnce(
    src,
    "    self.postMessage({ id, ok: false, error: errText(e), provider: activeProvider, modelSource, runtimeSource });\n",
    "    depthDebug('command-failed',{type:msg.type||'',error:errText(e),stack:String(e?.stack||'')});\n    self.postMessage({ id, ok: false, error: errText(e), provider: activeProvider, modelSource, runtimeSource, debug:depthDebugSnapshot('command-failed') });\n",
    'worker error response'
  );

  changes.push('runtime/model/session/inference diagnostic events');
  src = augmentDepthDiagnostics(src, changes);
  return { src, changes };
}

async function boot() {
  try {
    bootLog('bootstrap-start', { build: V11_WORKER_BUILD, originalWorker: ORIGINAL_WORKER_URL });
    emitBootstrap('bootstrap-start');
    // D10: WebGPU diagnostics must never block loading the Depth worker/model.
    const gpuProbePromise=probeWebGPU().catch(e=>{bootLog('webgpu-probe-background-error',{error:String(e&&e.stack||e)});return null});

    const sourceUrl = `${ORIGINAL_WORKER_URL}?v11_source=${encodeURIComponent(V11_WORKER_BUILD)}&t=${Date.now()}`;
    const sourceAc=new AbortController();let sourceWaitMs=0;
    const sourceHeartbeat=setInterval(()=>{sourceWaitMs+=1000;bootLog('source-fetch-heartbeat',{url:sourceUrl,wait_ms:sourceWaitMs})},1000);
    const sourceTimer=setTimeout(()=>sourceAc.abort('original-worker-fetch-timeout'),15000);
    let response;
    try{response = await fetch(sourceUrl, { cache: 'no-store', credentials: 'same-origin', signal:sourceAc.signal });}
    finally{clearInterval(sourceHeartbeat);clearTimeout(sourceTimer)}
    bootLog('source-response', { status: response.status, ok: response.ok, contentType: response.headers.get('content-type') });
    if (!response.ok) throw new Error(`depth_ai_worker.js HTTP ${response.status}`);
    const source = await response.text();
    bootLog('source-loaded', { chars: source.length });
    if (source.length < 3000) throw new Error(`depth_ai_worker.js troppo piccolo (${source.length} caratteri)`);

    // Require the isolated local ORT directory and official model pin before any execution.
    if (!source.includes("const localRuntimeDir = './vendor/depthai-123/';")) throw new Error('Anchor localRuntimeDir depthai-123 mancante');
    if (!source.includes('DEPTH_MODEL_PIN')) throw new Error('DEPTH_MODEL_PIN mancante');

    const patched = patchDepthWorkerSource(source);
    bootLog('source-patched', { changes: patched.changes, chars: patched.src.length });
    emitBootstrap('source-patched');

    // Execute the reviewed worker source in this dedicated worker global. Blob import changes
    // only the code payload; self.location remains depth_ai_worker_v11_d10.js, so same-directory
    // relative asset resolution remains correct.
    const blob = new Blob([patched.src + `\n//# sourceURL=depth_ai_worker_v11_d10_runtime.js\n`], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      importScripts(blobUrl);
      try { if (typeof depthDebugSnapshot === 'function') patchedDepthDebugSnapshot = depthDebugSnapshot; } catch (_) {}
      const normalOnMessage=self.onmessage;
      if(typeof normalOnMessage!=='function')throw new Error('DepthAI patched worker did not install self.onmessage');
      self.onmessage=event=>{const msg=event&&event.data||{};if(msg.type==='__v11_diag_ping'){let debug=null;try{debug=patchedDepthDebugSnapshot?patchedDepthDebugSnapshot('diag-ping'):null}catch(_){};self.postMessage({id:msg.id,ok:true,__depthDiagV11:true,debug,bootstrap:bootstrapSnapshot('diag-ping')});return}return normalOnMessage.call(self,event)};
      runtimeHandlerReady=true;
      try{self.removeEventListener('message',captureEarlyMessage)}catch(_){}
      bootLog('handler-ready',{queued:earlyMessageQueue.length,hasDepthSnapshot:!!patchedDepthDebugSnapshot});
      bootLog('patched-worker-executed', {hasDepthSnapshot:!!patchedDepthDebugSnapshot});
      emitBootstrap('patched-worker-executed');
      if(earlyMessageQueue.length){
        const replay=earlyMessageQueue.splice(0,earlyMessageQueue.length);
        bootLog('early-message-replay-start',{count:replay.length});
        for(let i=0;i<replay.length;i++){
          const data=replay[i];
          bootLog('early-message-replayed',{index:i+1,total:replay.length,type:data&&data.type||'',id:data&&data.id||null});
          await Promise.resolve(self.onmessage({data}));
        }
        bootLog('early-message-replay-finished',{count:replay.length});
      }
      gpuProbePromise.then(()=>emitBootstrap('webgpu-probe-background-complete')).catch(()=>{});
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch (error) {
    failWorker(error);
  }
}

self.addEventListener('error', event => {
  bootLog('worker-global-error', { message: event.message || '', filename: event.filename || '', lineno: event.lineno || 0, colno: event.colno || 0 });
  emitBootstrap('worker-global-error', event.error || event.message);
});
self.addEventListener('unhandledrejection', event => {
  bootLog('worker-unhandledrejection', { reason: String(event.reason && event.reason.stack || event.reason || '') });
  emitBootstrap('worker-unhandledrejection', event.reason);
});

boot();
