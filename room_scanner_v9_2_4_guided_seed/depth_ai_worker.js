/*
 * Depth Anything V2 Small Q4F16 worker — Stage-5 only.
 *
 * Debugging contract:
 *   - the worker owns its own ONNX Runtime instance/session;
 *   - MobileSAM's global ORT 1.14 runtime is never touched;
 *   - WebGPU is attempted only when WorkerNavigator exposes navigator.gpu;
 *   - WASM is the universal fallback;
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
let inputSize = 518;
let runtimeVersion = '1.24.1';

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function errText(e) {
  return e && (e.stack || e.message) ? String(e.stack || e.message) : String(e);
}

function importRuntime(url) {
  importScripts(url);
  if (!self.ort || !self.ort.InferenceSession) throw new Error(`ORT non esposto da ${url}`);
  ortApi = self.ort;
  runtimeSource = url;
}

async function initRuntime() {
  if (ortApi) return;
  const wantsWebGPU = !!(self.navigator && self.navigator.gpu);
  const candidates = wantsWebGPU
    ? [
        './vendor/depthai/ort.webgpu.min.js',
        `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/ort.webgpu.min.js`,
        './vendor/depthai/ort.min.js',
        `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/ort.min.js`,
      ]
    : [
        './vendor/depthai/ort.min.js',
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
  ortApi.env.wasm.wasmPaths = remote
    ? `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/`
    : './vendor/depthai/';
  ortApi.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (self.navigator && self.navigator.hardwareConcurrency) || 2)) : 1;
  ortApi.env.wasm.simd = true;
}

async function createSessionFrom(url, providers) {
  const opts = {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true,
    enableMemPattern: true,
  };
  const s = await ortApi.InferenceSession.create(url, opts);
  return s;
}

async function initModel(modelLocal, modelRemote) {
  if (session) return;
  await initRuntime();
  const modelCandidates = [modelLocal, modelRemote].filter(Boolean);
  let last = null;
  for (const url of modelCandidates) {
    // WebGPU can make a transformer-class keyframe inference much cheaper on
    // Android/Chromium. Unsupported ops/model/device fall back cleanly to WASM.
    if (self.navigator && self.navigator.gpu && /webgpu/i.test(runtimeSource || '')) {
      try {
        session = await createSessionFrom(url, ['webgpu', 'wasm']);
        modelSource = url;
        activeProvider = 'webgpu';
        return;
      } catch (e) {
        last = e;
      }
    }
    try {
      session = await createSessionFrom(url, ['wasm']);
      modelSource = url;
      activeProvider = 'wasm';
      return;
    } catch (e) {
      last = e;
      session = null;
    }
  }
  throw new Error(`Depth Anything Q4F16 non caricabile: ${errText(last)}`);
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
  const inputName = session.inputNames[0];
  const tensor = new ortApi.Tensor('float32', prep.data, [1, 3, prep.height, prep.width]);
  const out = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames.find(n => /predicted_depth/i.test(n)) || session.outputNames[0];
  const t = out[outputName] || Object.values(out)[0];
  if (!t || !t.data || !t.data.length) throw new Error('Depth Anything: predicted_depth assente');
  const dims = Array.from(t.dims || []);
  const h = Number(dims[dims.length - 2] || inputSize);
  const w = Number(dims[dims.length - 1] || inputSize);
  const depth = t.data instanceof Float32Array ? new Float32Array(t.data) : Float32Array.from(t.data, Number);
  for (const value of Object.values(out)) {
    try { value && value.dispose && value.dispose(); } catch (_) {}
  }
  try { tensor.dispose && tensor.dispose(); } catch (_) {}
  return { depth, outputWidth: w, outputHeight: h, outputName, inputWidth: prep.width, inputHeight: prep.height, inputShapeMode: shapeHint.static ? 'static' : 'aspect-dynamic' };
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const id = msg.id;
  try {
    if (msg.type === 'init') {
      inputSize = Number(msg.inputSize || 518);
      runtimeVersion = String(msg.runtimeVersion || '1.24.1');
      await initModel(msg.modelLocal, msg.modelRemote);
      self.postMessage({
        id, ok: true, provider: activeProvider, modelSource, runtimeSource,
        inputNames: Array.from(session.inputNames || []), outputNames: Array.from(session.outputNames || []),
        inputShape: Array.from((session.inputMetadata && session.inputMetadata[0] && session.inputMetadata[0].shape) || []),
      });
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
