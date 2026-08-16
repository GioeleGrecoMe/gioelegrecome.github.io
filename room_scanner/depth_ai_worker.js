/*
 * Depth Anything V2 Small worker — cooperative keyframe refinement.
 *
 * Debugging contract:
 *   - the worker owns its own ONNX Runtime instance/session;
 *   - MobileSAM's global ORT 1.14 runtime is never touched;
 *   - WebGPU is attempted only when WorkerNavigator exposes navigator.gpu;
 *   - Q4F16 is used on WebGPU, while Q4 is the verified universal WASM fallback;
 *   - model/runtime source and provider are returned to the main thread so a
 *     phone diagnostic export can explain exactly what path was used.
 *
 * Model preprocessing follows onnx-community/depth-anything-v2-small:
 *   RGB -> [0,1] -> ImageNet mean/std, CHW float32. The ONNX input shape is
 *   inspected at runtime: static exports receive their exact HxW; dynamic
 *   exports keep aspect ratio and constrain both axes to a multiple of 14.
 * Metric scale is deliberately NOT handled here; the
 * main thread aligns relative output to synchronized WebXR depth anchors.
 */
'use strict';

let ortApi = null;
let session = null;
let modelSource = null;
let runtimeSource = null;
let activeProvider = null;
let modelVariant = null;
let forceWasmRuntime = false;
let inputSize = 518;
let runtimeVersion = '1.23.2';
let deployRev = 'dev';

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function errText(e) {
  return e && (e.stack || e.message) ? String(e.stack || e.message) : String(e);
}

function versionedWorkerAsset(url){const u=new URL(url,self.location.href);if(u.origin===self.location.origin)u.searchParams.set('rsbuild',deployRev);return u.href}

function importRuntime(url) {
  importScripts(url);
  if (!self.ort || !self.ort.InferenceSession) throw new Error(`ORT non esposto da ${url}`);
  ortApi = self.ort;
  runtimeSource = url;
}

async function initRuntime() {
  if (ortApi) return;
  const localRuntimeDir = './vendor/depthai-123/';
  const wantsWebGPU = !forceWasmRuntime && !!(self.navigator && self.navigator.gpu);
  const candidates = wantsWebGPU
    ? [
        versionedWorkerAsset(`${localRuntimeDir}ort.webgpu.min.js`),
        `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/ort.webgpu.min.js`,
        versionedWorkerAsset(`${localRuntimeDir}ort.min.js`),
        `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/ort.min.js`,
      ]
    : [
        versionedWorkerAsset(`${localRuntimeDir}ort.min.js`),
        `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/ort.min.js`,
      ];
  let last = null;
  for (const url of candidates) {
    try {
      importRuntime(url);
      break;
    } catch (e) {
      last = e;
      ortApi = null;
    }
  }
  if (!ortApi) throw new Error(`ONNX Runtime DepthAI non disponibile: ${errText(last)}`);

  // Same-origin vendor assets are preferred. If the runtime came from jsDelivr,
  // use the matching CDN dist directory so WASM/JSEP binaries match the JS API.
  const remote = /^https?:/i.test(runtimeSource);
  // wasmPaths is an override consumed inside ORT/WASM. Keep it absolute even
  // inside this worker so URL resolution cannot depend on the worker bootstrap
  // location or on service-worker rewriting.
  ortApi.env.wasm.wasmPaths = remote
    ? `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/`
    : new URL(localRuntimeDir, self.location.href).href;
  ortApi.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (self.navigator && self.navigator.hardwareConcurrency) || 2)) : 1;
  ortApi.env.wasm.simd = true;
}

const DEPTH_MODEL_PINS={
  q4f16:{bytes:19126267,sha256:'eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e'},
  q4:{bytes:27404416,sha256:'5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8'},
};
let modelIntegrity=null;

async function sha256Hex(buffer){
  if(!self.crypto?.subtle)return null;const d=await self.crypto.subtle.digest('SHA-256',buffer);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')
}
function modelPinFor(url){return /(?:^|[_/])q4f16(?:[._/]|$)/i.test(url)?DEPTH_MODEL_PINS.q4f16:DEPTH_MODEL_PINS.q4}
async function fetchVerifiedModel(url){
  const pin=modelPinFor(url);
  const u=new URL(url,self.location.href),local=u.origin===self.location.origin;if(local)u.searchParams.set('rsbuild',deployRev);const absolute=u.href;
  const r=await fetch(absolute,{cache:local?'no-store':'default',mode:'cors'});if(!r.ok)throw new Error(`DepthAI model HTTP ${r.status}: ${absolute}`);
  const buffer=await r.arrayBuffer();if(buffer.byteLength!==pin.bytes)throw new Error(`DepthAI model size ${buffer.byteLength} != ${pin.bytes}`);
  const hash=await sha256Hex(buffer);if(hash&&hash!==pin.sha256)throw new Error('DepthAI model SHA-256 non corrisponde alla variante ufficiale selezionata');
  modelIntegrity={bytes:buffer.byteLength,sha256:hash||'unavailable',url:absolute};return {buffer,absolute}
}
async function createSessionFrom(buffer, providers) {
  const opts = {executionProviders: providers,graphOptimizationLevel:'all',enableCpuMemArena:true,enableMemPattern:true};
  return await ortApi.InferenceSession.create(buffer, opts);
}
function metaArray(session,kind){const names=kind==='output'?(session.outputNames||[]):(session.inputNames||[]),raw=kind==='output'?session.outputMetadata:session.inputMetadata;if(Array.isArray(raw))return names.map((n,i)=>{const m=raw.find(x=>x?.name===n)||raw[i]||{};return {name:n,type:m.type||m.dataType||null,shape:Array.from(m.shape||m.dimensions||m.dims||[])}});return names.map(n=>{const m=raw?.[n]||{};return {name:n,type:m.type||m.dataType||null,shape:Array.from(m.shape||m.dimensions||m.dims||[])}})}
function validateDepthContract(s){const inputs=metaArray(s,'input'),outputs=metaArray(s,'output');if(inputs.length!==1)throw new Error(`DepthAI: atteso 1 input, trovati ${inputs.length}`);const sh=inputs[0].shape;if(sh.length&&sh.length!==4)throw new Error(`DepthAI: input rank atteso 4 NCHW, trovato ${JSON.stringify(sh)}`);if(sh.length&&Number.isFinite(Number(sh[1]))&&Number(sh[1])>0&&Number(sh[1])!==3)throw new Error(`DepthAI: canali input attesi 3, trovati ${sh[1]}`);if(!outputs.length)throw new Error('DepthAI: nessun output ONNX');return {inputs,outputs}}

async function initModel(modelLocal, modelRemote, modelWasmLocal, modelWasmRemote) {
  if (session) return;
  await initRuntime();
  const gpuCandidates = [modelLocal, modelRemote].filter(Boolean);
  const wasmCandidates = [modelWasmLocal, modelWasmRemote].filter(Boolean);
  let last = null;
  // Q4F16 is compact and correct for WebGPU. ORT/WASM does not reliably
  // implement its fp16-weight operators, so the universal path is Q4 instead.
  if (!forceWasmRuntime && self.navigator && self.navigator.gpu && /webgpu/i.test(runtimeSource || '')) for (const url of gpuCandidates) {
    let loaded=null;try{loaded=await fetchVerifiedModel(url)}catch(e){last=e;continue}
    try {session=await createSessionFrom(loaded.buffer.slice(0), ['webgpu', 'wasm']);modelSource=loaded.absolute;activeProvider='webgpu';modelVariant='q4f16';validateDepthContract(session);return} catch(e){last=e;session=null}
  }
  for (const url of wasmCandidates) {
    let loaded=null;try{loaded=await fetchVerifiedModel(url)}catch(e){last=e;continue}
    try {session=await createSessionFrom(loaded.buffer, ['wasm']);modelSource=loaded.absolute;activeProvider='wasm';modelVariant='q4';validateDepthContract(session);return} catch(e){last=e;session=null}
  }
  throw new Error(`Depth Anything non caricabile (Q4F16 WebGPU e Q4 WASM): ${errText(last)}`);
}

async function runDepthSession(prep) {
  const inputName = session.inputNames[0];
  const tensor = new ortApi.Tensor('float32', prep.data, [1, 3, prep.height, prep.width]);
  try {
    return await session.run({ [inputName]: tensor });
  } finally {
    try { tensor.dispose && tensor.dispose(); } catch (_) {}
  }
}

function constrainMultiple(value, multiple=14) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function inputShapeForSource(srcW, srcH) {
  // Match DPTImageProcessor's keep_aspect_ratio=true policy: use the scale
  // closest to 1 for both axes, then constrain each result to a multiple of 14.
  // For our 384x216 landscape keyframe this becomes about 518x294 rather than
  // a distorted 518x518 square: fewer tokens/conv pixels and better geometry.
  const sh = inputSize / srcH, sw = inputSize / srcW;
  const scale = Math.abs(1 - sw) < Math.abs(1 - sh) ? sw : sh;
  return { width: constrainMultiple(srcW * scale), height: constrainMultiple(srcH * scale) };
}

function modelInputShapeHint() {
  const meta = session && session.inputMetadata && session.inputMetadata[0];
  const raw = meta && Array.isArray(meta.shape) ? meta.shape : [];
  const h = Number(raw.length >= 2 ? raw[raw.length - 2] : NaN);
  const w = Number(raw.length >= 1 ? raw[raw.length - 1] : NaN);
  if (Number.isFinite(h) && h > 0 && Number.isFinite(w) && w > 0) {
    return { static: true, height: Math.round(h), width: Math.round(w), raw: Array.from(raw) };
  }
  return { static: false, raw: Array.from(raw) };
}

function preprocessRGBA(buffer, srcW, srcH, shapeHint=null) {
  const rgba = new Uint8ClampedArray(buffer);
  if (rgba.length !== srcW * srcH * 4) throw new Error(`RGBA size errata: ${rgba.length} != ${srcW * srcH * 4}`);
  const shape = shapeHint && shapeHint.static
    ? { width: shapeHint.width, height: shapeHint.height }
    : inputShapeForSource(srcW, srcH);
  const dstW = shape.width, dstH = shape.height;
  const N = dstW * dstH;
  const out = new Float32Array(3 * N);

  // Bilinear resize is still tiny compared with transformer inference and is
  // materially closer to the official bicubic DPT preprocessing than nearest
  // sampling. No letterbox/padding is introduced, so normalized output UV stays
  // aligned to the captured camera frame.
  for (let y = 0; y < dstH; y++) {
    const fy = Math.max(0, Math.min(srcH - 1, (y + 0.5) / dstH * srcH - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(srcH - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dstW; x++) {
      const fx = Math.max(0, Math.min(srcW - 1, (x + 0.5) / dstW * srcW - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(srcW - 1, x0 + 1), tx = fx - x0;
      const i00 = 4 * (y0 * srcW + x0), i10 = 4 * (y0 * srcW + x1);
      const i01 = 4 * (y1 * srcW + x0), i11 = 4 * (y1 * srcW + x1);
      const di = y * dstW + x;
      for (let c = 0; c < 3; c++) {
        const a = rgba[i00 + c] * (1 - tx) + rgba[i10 + c] * tx;
        const b = rgba[i01 + c] * (1 - tx) + rgba[i11 + c] * tx;
        const v = (a * (1 - ty) + b * ty) / 255;
        out[c * N + di] = (v - MEAN[c]) / STD[c];
      }
    }
  }
  return { data: out, width: dstW, height: dstH };
}
async function infer(msg) {
  if (!session) throw new Error('DepthAI sessione non inizializzata');
  const shapeHint = modelInputShapeHint();
  const prep = preprocessRGBA(msg.rgba, Number(msg.width), Number(msg.height), shapeHint);
  const out = await runDepthSession(prep);
  const outputName = session.outputNames.find(n => /predicted_depth/i.test(n)) || session.outputNames[0];
  const t = out[outputName] || Object.values(out)[0];
  if (!t || !t.data || !t.data.length) throw new Error('Depth Anything: predicted_depth assente');
  const dims = Array.from(t.dims || []);
  const h = Number(dims[dims.length - 2] || inputSize);
  const w = Number(dims[dims.length - 1] || inputSize);
  const depth = t.data instanceof Float32Array ? new Float32Array(t.data) : Float32Array.from(t.data, Number);
  if(depth.length!==w*h)throw new Error(`Depth Anything: output size ${depth.length} != ${w}x${h}`);
  let finite=0;for(let i=0;i<depth.length;i++)if(Number.isFinite(depth[i]))finite++;if(finite<depth.length*.98)throw new Error(`Depth Anything: output non finito (${finite}/${depth.length})`);
  for (const value of Object.values(out)) {
    try { value && value.dispose && value.dispose(); } catch (_) {}
  }
  return { depth, outputWidth: w, outputHeight: h, outputName, inputWidth: prep.width, inputHeight: prep.height, inputShapeMode: shapeHint.static ? 'static' : 'aspect-dynamic' };
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const id = msg.id;
  try {
    if (msg.type === 'init') {
      inputSize = Number(msg.inputSize || 518);
      runtimeVersion = String(msg.runtimeVersion || '1.23.2');
      deployRev = String(msg.deployRev || 'dev');
      forceWasmRuntime = !!msg.forceWasm;
      await initModel(msg.modelLocal, msg.modelRemote, msg.modelWasmLocal, msg.modelWasmRemote);
      self.postMessage({
        id, ok: true, provider: activeProvider, modelVariant, modelSource, runtimeSource,
        inputNames: Array.from(session.inputNames || []), outputNames: Array.from(session.outputNames || []),
        inputShape: Array.from((session.inputMetadata && session.inputMetadata[0] && session.inputMetadata[0].shape) || []),
        contract: validateDepthContract(session), modelIntegrity, wasmPaths: ortApi.env.wasm.wasmPaths,
      });
      return;
    }
    if (msg.type === 'smoke') {
      const sw=96,sh=64,rgba=new Uint8ClampedArray(sw*sh*4);for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const i=4*(y*sw+x);rgba[i]=Math.round(255*x/(sw-1));rgba[i+1]=Math.round(255*y/(sh-1));rgba[i+2]=128;rgba[i+3]=255}
      const t0=performance.now(),r=await infer({width:sw,height:sh,rgba:rgba.buffer});
      self.postMessage({id,ok:true,smoke:true,provider:activeProvider,modelVariant,inputWidth:r.inputWidth,inputHeight:r.inputHeight,inputShapeMode:r.inputShapeMode,outputWidth:r.outputWidth,outputHeight:r.outputHeight,outputName:r.outputName,inferenceMs:performance.now()-t0,contract:validateDepthContract(session),modelIntegrity,wasmPaths:ortApi.env.wasm.wasmPaths});
      return;
    }
    if (msg.type === 'infer') {
      const t0 = performance.now();
      const r = await infer(msg);
      self.postMessage({ id, ok: true, depth: r.depth.buffer, outputWidth: r.outputWidth, outputHeight: r.outputHeight, outputName: r.outputName, inputWidth: r.inputWidth, inputHeight: r.inputHeight, inputShapeMode: r.inputShapeMode, inferenceMs: performance.now() - t0 }, [r.depth.buffer]);
      return;
    }
    if (msg.type === 'dispose') {
      try { session && session.release && session.release(); } catch (_) {}
      session = null;
      self.postMessage({ id, ok: true });
      return;
    }
    throw new Error(`Messaggio worker sconosciuto: ${msg.type}`);
  } catch (e) {
    self.postMessage({ id, ok: false, error: errText(e), provider: activeProvider, modelSource, runtimeSource });
  }
};
