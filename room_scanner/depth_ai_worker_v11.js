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

const V11_WORKER_BUILD = 'room-scanner-v11-depth-worker-diagnostic2-2026-08-16';
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
  webgpuProbe={attempted:true,available:!!(self.navigator&&self.navigator.gpu),secureContext:typeof self.isSecureContext==='boolean'?self.isSecureContext:null};
  if(!webgpuProbe.available){webgpuProbe.result='navigator.gpu-unavailable';webgpuProbe.elapsed_ms=Math.round((performance.now()-t0)*10)/10;bootLog('webgpu-probe-unavailable',webgpuProbe);return webgpuProbe;}
  try{
    bootLog('webgpu-request-adapter-start',{});
    const a0=performance.now(),adapter=await self.navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    webgpuProbe.adapterElapsed_ms=Math.round((performance.now()-a0)*10)/10;
    if(!adapter){webgpuProbe.result='adapter-null';bootLog('webgpu-request-adapter-null',webgpuProbe);return webgpuProbe;}
    let info=null;try{info=adapter.info?JSON.parse(JSON.stringify(adapter.info)):(typeof adapter.requestAdapterInfo==='function'?await adapter.requestAdapterInfo():null)}catch(e){info={error:String(e&&e.stack||e)}}
    let features=[];try{features=Array.from(adapter.features||[]).sort()}catch(_){}
    const limits={},keys=['maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupStorageSize','maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupsPerDimension'];
    try{for(const k of keys)if(adapter.limits&&k in adapter.limits)limits[k]=Number(adapter.limits[k])}catch(_){}
    webgpuProbe.adapter={info,features,limits};webgpuProbe.result='adapter-ok';
    try{const d0=performance.now(),device=await adapter.requestDevice();webgpuProbe.device='ok';webgpuProbe.deviceElapsed_ms=Math.round((performance.now()-d0)*10)/10;try{device.destroy()}catch(_){}}catch(e){webgpuProbe.device='failed';webgpuProbe.deviceError=String(e&&e.stack||e)}
  }catch(e){webgpuProbe.result='probe-exception';webgpuProbe.error=String(e&&e.stack||e)}
  webgpuProbe.elapsed_ms=Math.round((performance.now()-t0)*10)/10;bootLog('webgpu-probe-complete',webgpuProbe);return webgpuProbe;
}

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
    "  ortApi.env.wasm.simd = true;\n  depthDebug('runtime-ready',{runtimeSource,runtimeVersion,remote,wasmPaths:ortApi.env.wasm.wasmPaths,forceWasm:!!forceWasmRuntime});\n",
    'runtime-ready anchor'
  );

  // Model transfer and integrity: observe existing checks without changing them.
  src = replaceOnce(src, 'async function fetchVerifiedModel(url){\n', "async function fetchVerifiedModel(url){\n  depthDebug('model-fetch-start',{url});\n", 'model fetch start');
  src = replaceOnce(
    src,
    "  const r=await fetch(absolute,{cache:local?'no-store':'default',mode:'cors'});if(!r.ok)throw new Error(`DepthAI model HTTP ${r.status}: ${absolute}`);\n",
    "  const r=await fetch(absolute,{cache:local?'no-store':'default',mode:'cors'});depthDebug('model-fetch-response',{url:absolute,status:r.status,ok:r.ok,contentLength:r.headers.get('content-length'),local});if(!r.ok)throw new Error(`DepthAI model HTTP ${r.status}: ${absolute}`);\n",
    'model HTTP response'
  );
  src = replaceOnce(
    src,
    "  const buffer=await r.arrayBuffer();if(buffer.byteLength!==DEPTH_MODEL_PIN.bytes)throw new Error(`DepthAI model size ${buffer.byteLength} != ${DEPTH_MODEL_PIN.bytes}`);\n",
    "  const buffer=await r.arrayBuffer();depthDebug('model-bytes',{bytes:buffer.byteLength,expectedBytes:DEPTH_MODEL_PIN.bytes});if(buffer.byteLength!==DEPTH_MODEL_PIN.bytes)throw new Error(`DepthAI model size ${buffer.byteLength} != ${DEPTH_MODEL_PIN.bytes}`);\n",
    'model byte count'
  );
  src = replaceOnce(
    src,
    "  const hash=await sha256Hex(buffer);if(hash&&hash!==DEPTH_MODEL_PIN.sha256)throw new Error('DepthAI model SHA-256 non corrisponde a Q4F16 ufficiale');\n",
    "  const hash=await sha256Hex(buffer);depthDebug('model-sha256',{sha256:hash||'unavailable',expectedSha256:DEPTH_MODEL_PIN.sha256,match:!hash||hash===DEPTH_MODEL_PIN.sha256});if(hash&&hash!==DEPTH_MODEL_PIN.sha256)throw new Error('DepthAI model SHA-256 non corrisponde a Q4F16 ufficiale');\n",
    'model SHA-256'
  );
  src = replaceOnce(
    src,
    "  modelIntegrity={bytes:buffer.byteLength,sha256:hash||'unavailable',url:absolute};return {buffer,absolute}\n",
    "  modelIntegrity={bytes:buffer.byteLength,sha256:hash||'unavailable',url:absolute};depthDebug('model-verified',{modelIntegrity});return {buffer,absolute}\n",
    'model verified'
  );

  // Session creation: provider list and ORT options remain byte-for-byte the same.
  const sessionOld = `async function createSessionFrom(buffer, providers) {
  const opts = {executionProviders: providers,graphOptimizationLevel:'all',enableCpuMemArena:true,enableMemPattern:true};
  return await ortApi.InferenceSession.create(buffer, opts);
}
`;
  const sessionNew = `async function createSessionFrom(buffer, providers) {
  const opts = {executionProviders: providers,graphOptimizationLevel:'all',enableCpuMemArena:true,enableMemPattern:true};
  depthDebug('session-create-start',{providers,modelBytes:buffer?.byteLength||0});
  try {
    const s=await ortApi.InferenceSession.create(buffer, opts);
    depthDebug('session-create-ok',{providers});
    return s;
  } catch(e) {
    depthDebug('session-create-failed',{providers,error:errText(e),stack:String(e?.stack||'')});
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
    await probeWebGPU();

    const sourceUrl = `${ORIGINAL_WORKER_URL}?v11_source=${encodeURIComponent(V11_WORKER_BUILD)}&t=${Date.now()}`;
    const response = await fetch(sourceUrl, { cache: 'no-store', credentials: 'same-origin' });
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
    // only the code payload; self.location remains depth_ai_worker_v11.js, so same-directory
    // relative asset resolution remains correct.
    const blob = new Blob([patched.src + `\n//# sourceURL=depth_ai_worker_v11_runtime.js\n`], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      importScripts(blobUrl);
      try { if (typeof depthDebugSnapshot === 'function') patchedDepthDebugSnapshot = depthDebugSnapshot; } catch (_) {}
      const normalOnMessage=self.onmessage;
      if(typeof normalOnMessage==='function')self.onmessage=event=>{const msg=event&&event.data||{};if(msg.type==='__v11_diag_ping'){let debug=null;try{debug=patchedDepthDebugSnapshot?patchedDepthDebugSnapshot('diag-ping'):null}catch(_){};self.postMessage({id:msg.id,ok:true,__depthDiagV11:true,debug,bootstrap:bootstrapSnapshot('diag-ping')});return}return normalOnMessage.call(self,event)};
      bootLog('patched-worker-executed', {hasDepthSnapshot:!!patchedDepthDebugSnapshot});
      emitBootstrap('patched-worker-executed');
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
