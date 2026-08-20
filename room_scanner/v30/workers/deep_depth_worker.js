/*
 * Room Scanner V30.26.0 - ultra-low-budget WebGPU/WASM Depth Anything worker.
 *
 * GPU READBACK + AUTHORITATIVE DEPTH LAYOUT + Q4 DEFAULT
 * -------------------------
 * 1) The camera RGBA buffer is converted to the ONNX RGB/NCHW tensor
 *    explicitly in JavaScript.  This is deliberately not Tensor.fromImage():
 *    its ImageData implementation accepts resize dimensions without resizing
 *    the source buffer, which corrupts non-native camera frames.
 *
 *    Exact memory contract:
 *      source: RGBA RGBA RGBA ... (row-major, interleaved)
 *      tensor: RRR... GGG... BBB... (NCHW, planar)
 *
 * 2) Dynamic Depth Anything inputs use the DPT processor contract: ImageNet
 *    RGB normalization, aspect-preserving resize and dimensions rounded to ViT
 *    patches (14). Upstream defaults to 518 px; the app may request a smaller
 *    low-budget target (224 px in V30.25) because Alva supplies metric anchors and
 *    multi-view verification. The input is never stretched to a square.
 *
 * 3) If the ONNX export is fixed-shape, the worker automatically falls back to
 *    the classic 518x518 contract.  A successful plan is cached for all later
 *    frames, so compatibility probing is paid only once.
 *
 * 4) The pre-scan "test" is single-pass on a healthy provider. The old warm
 *    duplicate and unconditional horizontal-flip inference are removed. A second
 *    WASM inference is paid only if the first WebGPU depth fails the spatial
 *    coherence gate. This makes test time representative of actual scan latency.
 *
 * Drop-in replacement for:
 *   room_scanner/v30/workers/deep_depth_worker.js
 */

let cfg = {
  modelUrl: 'models/model_q4.onnx',
  // A remote model may be explicitly configured by a deployment, but the
  // shipped app never switches to one invisibly after a local 404.
  modelRemoteUrl: null,
  modelCacheName: 'room-scanner-depth-models-v1',
  ortLocal: '../vendor/onnxruntime-web/ort.all.min.mjs',
  // Keep the project-configured runtime only as a last-resort compatibility fallback.
  ortRemote: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.all.min.mjs',
  ortCurrentWebGpu: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.webgpu.min.mjs',
  ortCurrentAll: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.all.min.mjs',

  // Compatibility ceiling/fallback used by the existing V30 config.
  inputMaxSide: 518,

  // Live-safe mobile target: 16 ViT patches on the short side. The 12-patch
  // 168px profile was fast on the phone but produced global vertical bands.
  preferredShortSide: 224,
  compatibilityShortSide: 280,
  // Resolution quality ladder. 280 is the normal rescue; 336 is used only if
  // the global banding detector still sees a collapsed map.
  qualityRescueShortSide: 280,
  qualityMaxRescueShortSide: 336,
  patchSize: 14,
  // 0 = let ORT Web choose its thread count. V30.20 forced one WASM thread.
  wasmNumThreads: 0,
  testFlipCheck: false,

  // Used when onnxruntime-web exposes inputNames but not inputMetadata.
  inputType: 'float32',
};

let ort = null;
let ortSource = '';
let session = null;
let sessionKey = '';
let sessionModelBytes = null;
let provider = 'unloaded';
let busy = false;

// Cached after the first successful inference.  This prevents trying several
// resolutions/types on every frame and makes the live path deterministic.
let successfulInputPlan = null;
let lastSessionLoadMs = 0;
let diagnosticOrt = null;
let forceWasm = false;
// A WebGPU session is treated as untrusted until either the explicit test or
// the first geometry inference produces a spatially coherent depth map. This
// matters because a corrupted Q4 shader can return finite, isotropic "snow"
// that passes simple NaN/shape/stripe checks.
let providerValidated = false;
let queuedPriorityInfer = null;
let queuedPreviewInfer = null;

function fail(message) {
  throw new Error(message);
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isPositiveDimension(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function metadataEntry(metadata, name, index = 0) {
  if (!metadata) return null;

  if (Array.isArray(metadata)) {
    return metadata.find((entry) => entry?.name === name) || metadata[index] || null;
  }

  if (typeof metadata === 'object') {
    return metadata[name] || Object.values(metadata)[index] || null;
  }

  return null;
}

function inputSpec(activeSession = session) {
  if (!activeSession) fail('sessione ONNX non inizializzata');

  const inputNames = Array.from(activeSession.inputNames || []);
  const name = inputNames[0];
  if (!name) {
    fail(`il modello ONNX non espone nomi di input (inputNames=${JSON.stringify(inputNames)})`);
  }

  const meta = metadataEntry(activeSession.inputMetadata, name, 0);

  // Several onnxruntime-web builds expose inputNames but no metadata.  That is
  // a runtime API limitation, not evidence that the model has no input.
  if (!meta) {
    const side = positiveNumber(cfg.inputMaxSide, 518);
    return {
      name,
      type: String(cfg.inputType || 'float32').toLowerCase(),
      dims: [1, 3, side, side],
      width: side,
      height: side,
      rawShape: null,
      metadataAvailable: false,
      contractFallback: true,
      spatialFixed: false,
    };
  }

  const rawShape = Array.from(meta.shape || meta.dimensions || [1, 3, 'height', 'width']);
  if (rawShape.length !== 4) {
    fail(`input ONNX non supportato: name=${name}, shape=${JSON.stringify(rawShape)}`);
  }

  const channels = isPositiveDimension(rawShape[1]) ? Number(rawShape[1]) : 3;
  if (channels !== 3) {
    fail(`input ONNX non RGB/NCHW: name=${name}, shape=${JSON.stringify(rawShape)}`);
  }

  const spatialFixed = isPositiveDimension(rawShape[2]) && isPositiveDimension(rawShape[3]);
  const height = spatialFixed ? Number(rawShape[2]) : positiveNumber(cfg.inputMaxSide, 518);
  const width = spatialFixed ? Number(rawShape[3]) : positiveNumber(cfg.inputMaxSide, 518);

  return {
    name,
    type: String(meta.type || cfg.inputType || 'float32').toLowerCase(),
    dims: [1, 3, height, width],
    width,
    height,
    rawShape,
    metadataAvailable: true,
    contractFallback: false,
    spatialFixed,
  };
}

function outputDebugSpec(activeSession = session) {
  if (!activeSession) return null;
  const outputNames = Array.from(activeSession.outputNames || []);
  const name = outputNames[0] || null;
  const meta = name ? metadataEntry(activeSession.outputMetadata, name, 0) : null;
  const rawShape = meta?.shape || meta?.dimensions || null;
  return {
    name,
    type: meta?.type || null,
    shape: rawShape ? Array.from(rawShape) : null,
  };
}

function toFloat16(value) {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? 0x8000 : 0;
  const x = Math.abs(value);
  if (x === 0) return sign;
  if (x >= 65504) return sign | 0x7bff;
  if (x < 6.103515625e-5) return sign | Math.round(x / 5.960464477539063e-8);
  const exp = Math.floor(Math.log2(x));
  const mant = Math.round((x / Math.pow(2, exp) - 1) * 1024);
  return sign | ((exp + 15) << 10) | (mant & 1023);
}

function fromFloat16(value) {
  const sign = value & 0x8000 ? -1 : 1;
  const exp = (value >> 10) & 31;
  const mant = value & 1023;
  if (exp === 0) return sign * mant * 5.960464477539063e-8;
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * Math.pow(2, exp - 15);
}

async function importOrt() {
  if (ort) return ort;

  // Prefer a current WebGPU runtime before the project's historical 1.20.1
  // fallback. The Q4 graph uses modern quantized WebGPU kernels and old
  // builds have had dynamic-shape/correctness issues.
  const sources = Array.from(new Set([
    cfg.ortLocal,
    cfg.ortCurrentWebGpu,
    cfg.ortCurrentAll,
    cfg.ortRemote,
  ].filter(Boolean)));
  const errors = [];

  for (const source of sources) {
    try {
      const mod = await import(source);
      const candidate = mod.default || mod;
      if (candidate?.InferenceSession) {
        ort = candidate;
        ortSource = source;
        return ort;
      }
      errors.push(`${source}: InferenceSession mancante`);
    } catch (err) {
      errors.push(`${source}: ${err?.message || err}`);
    }
  }

  fail(`ONNX Runtime Web non disponibile. ${errors.join(' | ')}`);
}

async function responseToArrayBufferWithProgress(response, label) {
  const total = Number(response.headers.get('content-length')) || 0;
  postMessage({ type:'deep-download-progress', label, received:0, total, pct:0 });
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    postMessage({ type:'deep-download-progress', label, received:buffer.byteLength, total:total || buffer.byteLength, pct:100 });
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let lastReported = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    chunks.push(value);
    received += value.byteLength;
    // Updating about four times per MiB remains visible without flooding the UI.
    if (received - lastReported >= 262144) {
      lastReported = received;
      postMessage({ type:'deep-download-progress', label, received, total, pct:total ? Math.floor(received / total * 100) : null });
    }
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  postMessage({ type:'deep-download-progress', label, received, total:total || received, pct:100 });
  return joined.buffer;
}

async function fetchUrlModel(url, { cacheable = false, label = 'modello' } = {}) {
  const cacheName = cfg.modelCacheName || 'room-scanner-depth-models-v1';
  if (cacheable && globalThis.caches) {
    try {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(url);
      if (cached?.ok) {
        postMessage({ type:'deep-model-cache-hit', url, cache:cacheName });
        return cached.arrayBuffer();
      }
    } catch {}
  }

  const response = await fetch(url, { mode:'cors', cache:'no-store', redirect:'follow' });
  if (!response.ok) fail(`${label} non leggibile: HTTP ${response.status}`);

  // Clone before consuming the body so the official Q4 model survives page
  // reloads without ever being committed to GitHub. This cache is deliberately
  // separate from the versioned shell cache and is not deleted on app updates.
  if (cacheable && globalThis.caches) {
    try {
      const cache = await caches.open(cacheName);
      await cache.put(url, response.clone());
    } catch (err) {
      postMessage({ type:'deep-diag', level:'warn', event:'model-cache-store', message:err?.message || String(err) });
    }
  }
  return responseToArrayBufferWithProgress(response, label);
}

async function fetchModel(source) {
  if (source?.bytes) return source.bytes;
  const requested = source?.url || cfg.modelUrl;
  const remote = cfg.modelRemoteUrl;
  const errors = [];

  if (requested) {
    try { return await fetchUrlModel(requested, { cacheable:true, label:'modello Q4 locale' }); }
    catch (err) { errors.push(`locale: ${err?.message || err}`); }
  }
  if (remote && remote !== requested) {
    try { return await fetchUrlModel(remote, { cacheable:true, label:'Depth Anything V2 Small Q4 ufficiale' }); }
    catch (err) { errors.push(`remoto: ${err?.message || err}`); }
  }
  fail(`modello Q4 non disponibile. ${errors.join(' | ')}. Verifica che ${cfg.modelUrl} sia pubblicato insieme al sito.`);
}

function modelBytesSignature(bytes) {
  const values = new Uint8Array(bytes);
  let h = 2166136261 >>> 0;
  const step = Math.max(1, Math.floor(values.length / 256));
  for (let i = 0; i < values.length; i += step) { h ^= values[i]; h = Math.imul(h, 16777619) >>> 0; }
  h ^= values.length; h = Math.imul(h, 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function modelSourceKey(source) {
  const id = String(source?.id || 'default');
  if (source?.bytes) return `bytes:${id}:${source.bytes.byteLength}:${modelBytesSignature(source.bytes)}`;
  return `url:${id}:${String(source?.url || cfg.modelUrl)}`;
}

function configureWasmRuntime(runtime) {
  // ONNX Runtime Web uses 0 as the automatic thread policy. In a normal page it
  // safely remains single-threaded when WASM threads/cross-origin isolation are
  // unavailable; on correctly isolated deployments it can use multiple cores.
  // Keeping this decision inside the worker also avoids blocking the UI thread.
  try {
    runtime.env.wasm.numThreads = Number.isFinite(Number(cfg.wasmNumThreads)) ? Number(cfg.wasmNumThreads) : 0;
    runtime.env.wasm.simd = true;
  } catch {
    // Older runtime builds may expose read-only/partial env flags.
  }
}

async function ensureSession(source) {
  const sourceKey = modelSourceKey(source);
  if (session && sessionKey === sourceKey) return session;

  const sessionStarted = performance.now();
  const runtime = await importOrt();
  configureWasmRuntime(runtime);

  if (session) {
    try {
      await session.release?.();
    } catch {
      // Best-effort cleanup when changing model/provider.
    }
    session = null;
    sessionKey = '';
    sessionModelBytes = null;
  }

  successfulInputPlan = null;
  const bytes = await fetchModel(source);
  // Keep the already-fetched bytes only while the provider is being validated.
  // If WebGPU looks suspicious, the one-shot WASM reference can reuse these
  // bytes instead of downloading/reading the 27 MB model a second time.
  sessionModelBytes = bytes;
  const providerAttempts = forceWasm
    ? [['wasm']]
    : globalThis.navigator?.gpu
      ? [['webgpu', 'wasm'], ['wasm']]
      : [['wasm']];

  const errors = [];

  for (const executionProviders of providerAttempts) {
    try {
      session = await runtime.InferenceSession.create(bytes, {
        executionProviders,
        graphOptimizationLevel: 'all',
      });

      sessionKey = sourceKey;
      provider = executionProviders[0];
      providerValidated = provider !== 'webgpu';
      lastSessionLoadMs = performance.now() - sessionStarted;

      const spec = inputSpec();
      const output = outputDebugSpec();

      postMessage({
        type: 'deep-loaded',
        provider,
        runtime: ortSource,
        input: {
          name: spec.name,
          type: spec.type,
          dims: spec.dims,
          rawShape: spec.rawShape,
          metadataAvailable: spec.metadataAvailable,
          contractFallback: spec.contractFallback,
          spatialFixed: spec.spatialFixed,
        },
        output,
        model: source?.label || sourceKey,
        sessionLoadMs: lastSessionLoadMs,
      });

      return session;
    } catch (err) {
      errors.push(`${executionProviders.join('+')}: ${err?.message || err}`);
      try {
        await session?.release?.();
      } catch {
        // Ignore cleanup errors while trying the next provider.
      }
      session = null;
      sessionKey = '';
      sessionModelBytes = null;
      successfulInputPlan = null;
    }
  }

  fail(`creazione/sessione ONNX fallita. ${errors.join(' | ')}`);
}

function roundToMultiple(value, multiple) {
  const m = Math.max(1, multiple | 0);
  return Math.max(m, Math.round(value / m) * m);
}

/**
 * Match the lower-bound DPT resize used for dynamic Depth Anything inputs:
 * preserve the camera aspect ratio, make the SHORT side reach the requested
 * ViT/14 patch budget, then round both axes to a patch multiple. This makes the
 * meaning of 224 -> 280 -> 336 deterministic on portrait and landscape frames.
 */
function adaptiveInputGeometry(sourceWidth, sourceHeight, shortSide) {
  const sw = Math.max(2, sourceWidth | 0);
  const sh = Math.max(2, sourceHeight | 0);
  const patch = Math.max(1, cfg.patchSize | 0 || 14);
  const target = roundToMultiple(Math.max(patch * 8, Number(shortSide) || 518), patch);
  // Depth Anything's DPT resize uses a lower-bound target: preserve aspect ratio
  // and make the SHORT side reach the requested patch count. The previous
  // 'closest scale to 1' rule changed semantics depending on camera aspect and
  // could silently turn a requested rescue into a smaller raster.
  const scale = target / Math.min(sw, sh);
  const width = roundToMultiple(sw * scale, patch);
  const height = roundToMultiple(sh * scale, patch);
  return { width, height, mode: `dpt-aspect-${target}` };
}

function inputPlans(spec, sourceWidth, sourceHeight, targetSide = null, { ignoreCached = false } = {}) {
  if (successfulInputPlan && !ignoreCached) return [successfulInputPlan];

  // If metadata states a concrete spatial shape, obey it exactly.
  if (spec.spatialFixed) {
    return [{ width: spec.width, height: spec.height, mode: 'metadata-fixed' }];
  }

  const preferred = positiveNumber(targetSide, positiveNumber(cfg.preferredShortSide, 224));
  const plans = [
    adaptiveInputGeometry(sourceWidth, sourceHeight, preferred),
    // Do not jump directly from the 224-px fast path to 518 if an unusual export
    // has a minimum dynamic shape. 280 px is still much cheaper and is tried only
    // after the fast plan actually fails at the ONNX contract level.
    adaptiveInputGeometry(sourceWidth, sourceHeight, positiveNumber(cfg.compatibilityShortSide, 280)),
    // Final dynamic compatibility target for historical/custom exports.
    adaptiveInputGeometry(sourceWidth, sourceHeight, positiveNumber(cfg.inputMaxSide, 518)),
    // Last compatibility fallback for old/static exports whose metadata is not
    // visible in onnxruntime-web.
    {
      width: positiveNumber(cfg.inputMaxSide, 518),
      height: positiveNumber(cfg.inputMaxSide, 518),
      mode: 'compat-square',
    },
  ];

  const seen = new Set();
  return plans.filter((p) => {
    const key = `${p.width}x${p.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function sampledByteSignature(rgba, width, height) {
  const src = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  let h = 2166136261 >>> 0;
  const pixels = Math.max(1, (width | 0) * (height | 0));
  const samples = Math.min(257, pixels);
  for (let k = 0; k < samples; k++) {
    const p = Math.min(pixels - 1, Math.floor(k * (pixels - 1) / Math.max(1, samples - 1)));
    const i = p * 4;
    for (let c = 0; c < 3; c++) { h ^= src[i + c] || 0; h = Math.imul(h, 16777619) >>> 0; }
  }
  h ^= width | 0; h = Math.imul(h, 16777619) >>> 0; h ^= height | 0; h = Math.imul(h, 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function sampledFloatSignature(values, width, height) {
  let h = 2166136261 >>> 0;
  const n = values?.length || 0;
  if (!n) return '00000000';
  const samples = Math.min(257, n);
  const tmp = new Array(samples);
  for (let k = 0; k < samples; k++) {
    const i = Math.min(n - 1, Math.floor(k * (n - 1) / Math.max(1, samples - 1)));
    tmp[k] = Number(values[i]);
  }
  const finite = tmp.filter(Number.isFinite).sort((a,b)=>a-b);
  const lo = finite.length ? finite[Math.floor(finite.length * .03)] : 0;
  const hi = finite.length ? finite[Math.floor(finite.length * .97)] : 1;
  const range = hi > lo ? hi - lo : 1;
  for (const v0 of tmp) {
    const v = Number.isFinite(v0) ? Math.max(0, Math.min(65535, Math.round((v0 - lo) / range * 65535))) : 65535;
    h ^= v & 255; h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 8) & 255; h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= width | 0; h = Math.imul(h, 16777619) >>> 0; h ^= height | 0; h = Math.imul(h, 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function sourceRgbProbe(rgba, width, height) {
  const src = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  const at = (x, y) => {
    const xx = Math.max(0, Math.min(width - 1, Math.round(x)));
    const yy = Math.max(0, Math.min(height - 1, Math.round(y)));
    const i = (yy * width + xx) * 4;
    return [src[i] || 0, src[i + 1] || 0, src[i + 2] || 0];
  };
  return {
    tl: at(0, 0),
    tr: at(width - 1, 0),
    c: at((width - 1) / 2, (height - 1) / 2),
    bl: at(0, height - 1),
    br: at(width - 1, height - 1),
  };
}

function tensorRgbPreview(values, width, height, layout = 'nchw') {
  const n = width * height;
  if (!values?.length || values.length < n * 3) return null;
  const out = new Uint8ClampedArray(n * 4);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const index = layout === 'nchw' ? c * n + i : i * 3 + c;
      const rgb = (Number(values[index]) * std[c] + mean[c]) * 255;
      out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(rgb)));
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Explicit RGBA row-major -> RGB NCHW conversion with bilinear resize.
 *
 * This intentionally does not use OffscreenCanvas.  The source byte index is
 * always ((y * sourceWidth + x) * 4 + channel), while the tensor index is
 * (channel * targetWidth * targetHeight + y * targetWidth + x).
 */
async function prepareInput(rgba, width, height, spec, plan, forcedType = null, runtime = ort, captureDiagnostic = false) {
  const started = performance.now();
  const srcWidth = width | 0;
  const srcHeight = height | 0;
  if (!(srcWidth > 1 && srcHeight > 1)) fail('dimensioni fotogramma RGBA non valide');

  const src = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  const required = srcWidth * srcHeight * 4;
  if (src.length < required) fail(`buffer RGBA incompleto: ${src.length} byte, attesi almeno ${required}`);

  const targetWidth = plan.width | 0;
  const targetHeight = plan.height | 0;
  if (!(targetWidth > 1 && targetHeight > 1)) fail('shape input ONNX non valida');

  // Q4/Q4F16 quantize model weights, not the camera contract. Depth Anything
  // ONNX consumes pixel_values as float32 NCHW. Keeping this fixed removes one
  // more dtype-dependent branch from the mobile camera path.
  const tensorType = String(forcedType || spec.type || 'float32').toLowerCase();
  if (tensorType !== 'float32' && !tensorType.includes('float')) {
    fail(`pixel_values dtype non supportato: ${tensorType}`);
  }

  // Authoritative row-major RGBA -> planar NCHW conversion. Do not replace this
  // with Tensor.fromImage(ImageData): in ONNX Runtime Web it changes the output
  // tensor metadata for resized ImageData but does not resample the input bytes.
  // With a camera 320x480 -> model 350x518 this makes the model read a corrupt
  // top-left slice as if it were a complete image, producing the observed bands.
  const n = targetWidth * targetHeight;
  const values = new Float32Array(n * 3);
  const meanR = 0.485, meanG = 0.456, meanB = 0.406;
  const stdR = 0.229, stdG = 0.224, stdB = 0.225;

  const x0 = new Int32Array(targetWidth);
  const x1 = new Int32Array(targetWidth);
  const tx = new Float32Array(targetWidth);
  const sxScale = srcWidth / targetWidth;
  for (let x = 0; x < targetWidth; x++) {
    const sx = Math.max(0, Math.min(srcWidth - 1, (x + 0.5) * sxScale - 0.5));
    const a = Math.floor(sx);
    x0[x] = a;
    x1[x] = Math.min(srcWidth - 1, a + 1);
    tx[x] = sx - a;
  }

  const syScale = srcHeight / targetHeight;
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.max(0, Math.min(srcHeight - 1, (y + 0.5) * syScale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcHeight - 1, y0 + 1);
    const wy = sy - y0;
    const invWy = 1 - wy;
    const row0 = y0 * srcWidth;
    const row1 = y1 * srcWidth;
    const dstRow = y * targetWidth;
    for (let x = 0; x < targetWidth; x++) {
      const wx = tx[x], invWx = 1 - wx;
      const i00 = (row0 + x0[x]) * 4, i01 = (row0 + x1[x]) * 4;
      const i10 = (row1 + x0[x]) * 4, i11 = (row1 + x1[x]) * 4;
      const w00 = invWx * invWy, w01 = wx * invWy, w10 = invWx * wy, w11 = wx * wy;
      const r = src[i00] * w00 + src[i01] * w01 + src[i10] * w10 + src[i11] * w11;
      const g = src[i00 + 1] * w00 + src[i01 + 1] * w01 + src[i10 + 1] * w10 + src[i11 + 1] * w11;
      const b = src[i00 + 2] * w00 + src[i01 + 2] * w01 + src[i10 + 2] * w10 + src[i11 + 2] * w11;
      const i = dstRow + x;
      values[i] = (r / 255 - meanR) / stdR;
      values[n + i] = (g / 255 - meanG) / stdG;
      values[2 * n + i] = (b / 255 - meanB) / stdB;
    }
  }
  const dims = [1, 3, targetHeight, targetWidth];
  const tensor = new runtime.Tensor('float32', values, dims);
  return {
    tensor,
    dims,
    type: 'float32',
    preprocessMs: performance.now() - started,
    preprocessBackend: 'manual-rgba-nchw-bilinear',
    plan,
    rasterProbe: sourceRgbProbe(src, srcWidth, srcHeight),
    inputRasterDiagnostic: captureDiagnostic ? {
      sourcePreview: src.slice(0, required),
      sourceWidth: srcWidth,
      sourceHeight: srcHeight,
      tensorNchwPreview: tensorRgbPreview(values, targetWidth, targetHeight, 'nchw'),
      // V30.21 no longer spends another full raster pass constructing the hidden
      // intentionally-wrong NHWC forensic image during the timing test.
      tensorNhwcPreview: null,
      tensorWidth: targetWidth,
      tensorHeight: targetHeight,
    } : null,
  };
}

function scalarFromCpuBuffer(src, tensorType, index) {
  const isF16 = String(tensorType || '').toLowerCase().includes('float16');
  if (isF16 && src instanceof Uint16Array) return fromFloat16(src[index]);
  return Number(src[index]);
}

async function tensorCpuData(tensor) {
  if (!tensor) fail('tensore output ONNX mancante');

  // IMPORTANT FOR WEBGPU:
  // `tensor.data` is only guaranteed when the tensor is already CPU-resident.
  // ONNX Runtime exposes getData() specifically to download gpu-buffer/texture
  // outputs. Reading `.data` directly was the remaining path capable of
  // producing a stable striped preview even while inference itself succeeded.
  if (typeof tensor.getData === 'function') {
    try {
      const data = await tensor.getData(false);
      if (data?.length) return { data, readback: 'getData', location: tensor.location || 'unknown' };
    } catch (err) {
      // Fall through only for runtimes that expose getData() but cannot use it
      // for ordinary CPU outputs. The direct data accessor remains valid there.
      try {
        const data = tensor.data;
        if (data?.length) return { data, readback: 'data-after-getData-error', location: tensor.location || 'cpu', getDataError: err?.message || String(err) };
      } catch {}
      throw err;
    }
  }

  const data = tensor.data;
  if (!data?.length) fail('output ONNX senza buffer CPU leggibile');
  return { data, readback: 'data', location: tensor.location || 'cpu' };
}

function depthSpatialStats(depth, width, height) {
  let dx = 0, dy = 0, nx = 0, ny = 0, finite = 0, sum = 0, sum2 = 0;
  const colSum = new Float64Array(width), colN = new Uint32Array(width);
  const rowSum = new Float64Array(height), rowN = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const v = depth[i];
      if (Number.isFinite(v)) {
        finite++; sum += v; sum2 += v * v;
        colSum[x] += v; colN[x]++;
        rowSum[y] += v; rowN[y]++;
      }
      if (x + 1 < width && Number.isFinite(v) && Number.isFinite(depth[i + 1])) { dx += Math.abs(v - depth[i + 1]); nx++; }
      if (y + 1 < height && Number.isFinite(v) && Number.isFinite(depth[i + width])) { dy += Math.abs(v - depth[i + width]); ny++; }
    }
  }
  const meanDx = nx ? dx / nx : 0;
  const meanDy = ny ? dy / ny : 0;
  const mean = finite ? sum / finite : 0;
  const totalVariance = finite ? Math.max(0, sum2 / finite - mean * mean) : 0;

  // Global banding detector. The phone failures are not just high local x/y
  // gradients: entire columns share nearly the same depth, creating broad
  // repeated vertical bars. Measure how much of the map variance can be
  // explained only by the column index (or row index). Real room depth can
  // contain strong planes/gradients, but a decoder collapse typically makes one
  // axis explain most of the complete image variance.
  let colBetween = 0, rowBetween = 0;
  for (let x = 0; x < width; x++) if (colN[x]) { const d = colSum[x] / colN[x] - mean; colBetween += colN[x] * d * d; }
  for (let y = 0; y < height; y++) if (rowN[y]) { const d = rowSum[y] / rowN[y] - mean; rowBetween += rowN[y] * d * d; }
  const columnExplained = totalVariance > 1e-20 && finite ? (colBetween / finite) / totalVariance : 0;
  const rowExplained = totalVariance > 1e-20 && finite ? (rowBetween / finite) / totalVariance : 0;

  // Axis-only variance alone would incorrectly reject a legitimate slanted wall:
  // its depth can depend almost entirely on x but changes monotonically. Decoder
  // collapse instead repeats broad high/low bands. Total variation divided by
  // the axis range is ~1 for a monotonic ramp and grows with repeated cycles.
  const axisCycles = (sumArray, countArray, length) => {
    const means = new Float64Array(length); let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < length; i++) {
      means[i] = countArray[i] ? sumArray[i] / countArray[i] : NaN;
      if (Number.isFinite(means[i])) { lo = Math.min(lo, means[i]); hi = Math.max(hi, means[i]); }
    }
    const range = hi - lo; if (!(range > 1e-12)) return 0;
    let tv = 0, prev = NaN;
    for (const v of means) { if (!Number.isFinite(v)) continue; if (Number.isFinite(prev)) tv += Math.abs(v - prev); prev = v; }
    return tv / range;
  };
  const columnAxisCycles = axisCycles(colSum, colN, width);
  const rowAxisCycles = axisCycles(rowSum, rowN, height);

  // Compare local variation with deterministic long-range variation. A real
  // monocular depth map is piecewise smooth: nearby pixels normally differ
  // much less than pixels sampled far apart in the image. White/noisy output
  // has almost the same difference at both distances, so this ratio tends to 1.
  let farDiff = 0, farPairs = 0;
  const sampleCount = Math.min(1024, Math.max(1, width * height));
  for (let k = 0; k < sampleCount; k++) {
    const i = Math.min(width * height - 1, Math.floor(k * (width * height - 1) / Math.max(1, sampleCount - 1)));
    const x = i % width, y = Math.floor(i / width);
    const x2 = (x + Math.max(1, Math.floor(width * 0.37))) % width;
    const y2 = (y + Math.max(1, Math.floor(height * 0.41))) % height;
    const a = depth[i], b = depth[y2 * width + x2];
    if (Number.isFinite(a) && Number.isFinite(b)) { farDiff += Math.abs(a - b); farPairs++; }
  }
  const meanNeighborDiff = (nx + ny) ? (dx + dy) / (nx + ny) : 0;
  const meanFarDiff = farPairs ? farDiff / farPairs : 0;
  const coherenceRatio = meanFarDiff / Math.max(1e-12, meanNeighborDiff);
  return {
    finiteRatio: depth.length ? finite / depth.length : 0,
    meanDx,
    meanDy,
    directionalRatio: Math.max(meanDx, meanDy) / Math.max(1e-12, Math.min(meanDx, meanDy)),
    meanNeighborDiff,
    meanFarDiff,
    coherenceRatio,
    totalVariance,
    columnExplained,
    rowExplained,
    columnAxisCycles,
    rowAxisCycles,
    dominantAxisExplained: Math.max(columnExplained, rowExplained),
  };
}

function depthQualityDiagnosis(spatialStats) {
  const stripe = stripeDiagnosis(spatialStats);
  const coherenceRatio = Number(spatialStats?.coherenceRatio);
  const finiteRatio = Number(spatialStats?.finiteRatio);
  // Values near one mean "adjacent pixels are as unrelated as distant pixels".
  const incoherent = !Number.isFinite(coherenceRatio) || coherenceRatio < 1.28;
  const invalid = !Number.isFinite(finiteRatio) || finiteRatio < .985;
  return {
    stripe,
    coherenceRatio,
    finiteRatio,
    incoherent,
    invalid,
    suspicious: stripe.suspicious || incoherent || invalid,
  };
}

async function readOutput(result, expectedPlan, activeSession = session) {
  const outputNames = Array.from(activeSession?.outputNames || []);
  const name = result?.predicted_depth
    ? 'predicted_depth'
    : outputNames.find((n) => /predicted[_-]?depth/i.test(n))
      || outputNames[0]
      || Object.keys(result || {})[0];
  const tensor = result?.[name];
  if (!tensor) {
    fail(`il modello non ha restituito predicted_depth; outputNames=${JSON.stringify(outputNames)}, resultKeys=${JSON.stringify(Object.keys(result || {}))}`);
  }

  // Official Depth Anything contract: predicted_depth = [batch, height, width].
  // Do not infer/transpose dimensions from the camera raster. The ONNX tensor
  // shape is authoritative and data are standard row-major within each plane.
  const dims = Array.from(tensor.dims || []).map(Number);
  if (dims.length < 2) {
    fail(`predicted_depth shape non valida: ${JSON.stringify(dims)}`);
  }
  const logicalHeight = Number(dims[dims.length - 2]);
  const logicalWidth = Number(dims[dims.length - 1]);
  if (!(logicalWidth > 1 && logicalHeight > 1)) {
    fail(`predicted_depth H/W non valide: ${JSON.stringify(dims)}`);
  }

  const cpu = await tensorCpuData(tensor);
  const planeLength = logicalWidth * logicalHeight;
  if (cpu.data.length < planeLength) {
    fail(`predicted_depth incompleta: data=${cpu.data.length}, HxW=${logicalHeight}x${logicalWidth}`);
  }

  // Batch 0 starts at element 0. The previous generic reader used the *last*
  // plane in the buffer, which is unnecessary for this single-output model and
  // can be wrong if a runtime attaches additional storage/alignment.
  const out = new Float32Array(planeLength);
  for (let i = 0; i < planeLength; i++) {
    out[i] = scalarFromCpuBuffer(cpu.data, tensor.type, i);
  }

  const expectedWidth = Number(expectedPlan?.width);
  const expectedHeight = Number(expectedPlan?.height);
  const shapeMatchesInput = logicalWidth === expectedWidth && logicalHeight === expectedHeight;

  return {
    rawDepth: out,
    width: logicalWidth,
    height: logicalHeight,
    outputName: name,
    outputDims: dims,
    outputType: tensor.type || null,
    outputLocation: cpu.location,
    outputReadback: cpu.readback,
    outputGetDataError: cpu.getDataError || null,
    logicalWidth,
    logicalHeight,
    layoutFix: shapeMatchesInput ? 'official-HW' : 'official-HW-different-from-input',
    shapeMatchesInput,
    spatialStats: depthSpatialStats(out, logicalWidth, logicalHeight),
  };
}

async function runPrepared(spec, prepared, activeSession = session) {
  let result = null;
  try {
    const runStarted = performance.now();
    result = await activeSession.run({ [spec.name]: prepared.tensor });
    const runMs = performance.now() - runStarted;

    const outputStarted = performance.now();
    const output = await readOutput(result, prepared.plan, activeSession);
    const outputMs = performance.now() - outputStarted;

    return {
      ...output,
      runMs,
      outputMs,
      preprocessMs: prepared.preprocessMs,
      inputType: prepared.type,
      inputDims: prepared.dims,
      inputPlan: prepared.plan,
      rasterProbe: prepared.rasterProbe,
      inputRasterDiagnostic: prepared.inputRasterDiagnostic || null,
      preprocessBackend: prepared.preprocessBackend || 'unknown',
      steadyMs: prepared.preprocessMs + runMs + outputMs,
    };
  } finally {
    // WebGPU tensors otherwise accumulate across repeated selected-keyframe runs.
    try { prepared.tensor?.dispose?.(); } catch {}
    for (const tensor of Object.values(result || {})) {
      try { tensor?.dispose?.(); } catch {}
    }
  }
}



function finiteSummary(depth) {
  let n = 0, sum = 0, sum2 = 0, min = Infinity, max = -Infinity;
  for (const value of depth || []) {
    const v = Number(value);
    if (!Number.isFinite(v)) continue;
    n++; sum += v; sum2 += v * v; min = Math.min(min, v); max = Math.max(max, v);
  }
  const mean = n ? sum / n : NaN;
  const variance = n ? Math.max(0, sum2 / n - mean * mean) : NaN;
  return { count: n, finiteRatio: depth?.length ? n / depth.length : 0, min: n ? min : NaN, max: n ? max : NaN, mean, std: n ? Math.sqrt(variance) : NaN };
}

function compareDepthMaps(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return { comparable: false, correlation: null, nrmse: null };
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, se = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]), y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; const e = x - y; se += e * e;
  }
  if (n < 16) return { comparable: false, correlation: null, nrmse: null, samples: n };
  const va = Math.max(0, saa - sa * sa / n), vb = Math.max(0, sbb - sb * sb / n);
  const correlation = va > 0 && vb > 0 ? (sab - sa * sb / n) / Math.sqrt(va * vb) : 0;
  const scale = Math.sqrt(Math.max(1e-20, vb / n));
  return { comparable: true, correlation, nrmse: Math.sqrt(se / n) / scale, samples: n };
}

function flipRgbaHorizontal(rgba, width, height) {
  const src = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = (y * width + (width - 1 - x)) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
  }
  return out;
}

function flipDepthHorizontal(depth, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) out[row + (width - 1 - x)] = Number(depth[row + x]);
  }
  return out;
}

async function runFlipDiagnostic(d, reference) {
  const spec = inputSpec();
  const rgba = flipRgbaHorizontal(d.rgba, d.width, d.height);
  const prepared = await prepareInput(rgba, d.width, d.height, spec, reference.inputPlan, reference.inputType || spec.type, ort, false);
  const flipped = await runPrepared(spec, prepared);
  if (flipped.width !== reference.width || flipped.height !== reference.height) {
    return { comparable:false, reason:'shape-mismatch', reference:[reference.width,reference.height], flipped:[flipped.width,flipped.height] };
  }
  const restored = flipDepthHorizontal(flipped.rawDepth, flipped.width, flipped.height);
  return {
    ...compareDepthMaps(reference.rawDepth, restored),
    ms: flipped.steadyMs,
    depthSignature: sampledFloatSignature(restored, flipped.width, flipped.height),
  };
}

function stripeDiagnosis(spatialStats) {
  const dx = Number(spatialStats?.meanDx) || 0;
  const dy = Number(spatialStats?.meanDy) || 0;
  const ratio = Math.max(dx, dy) / Math.max(1e-12, Math.min(dx, dy));
  const columnExplained = Math.max(0, Math.min(1, Number(spatialStats?.columnExplained) || 0));
  const rowExplained = Math.max(0, Math.min(1, Number(spatialStats?.rowExplained) || 0));
  const dominantExplained = Math.max(columnExplained, rowExplained);
  const secondaryExplained = Math.min(columnExplained, rowExplained);
  const orientation = columnExplained > rowExplained
    ? 'vertical-columns'
    : rowExplained > columnExplained
      ? 'horizontal-rows'
      : dx > dy ? 'vertical-columns' : dy > dx ? 'horizontal-rows' : 'isotropic';
  const columnCycles = Math.max(0, Number(spatialStats?.columnAxisCycles) || 0);
  const rowCycles = Math.max(0, Number(spatialStats?.rowAxisCycles) || 0);
  const dominantCycles = orientation === 'vertical-columns' ? columnCycles : orientation === 'horizontal-rows' ? rowCycles : Math.max(columnCycles,rowCycles);
  // Axis-explained variance identifies the phone screenshots, while the cycle
  // term prevents a real monotonic slanted plane from being mislabeled as a
  // stripe field. Repeated 14-patch bars have many axis traversals; a wall ramp
  // is close to one traversal even when x explains nearly 100% of its variance.
  const globalBanding = (dominantExplained >= .58 && dominantCycles >= 2.8)
    || (dominantExplained >= .46 && secondaryExplained <= .22 && dominantCycles >= 3.5);
  const directionalBanding = ratio >= 4.0 && dominantCycles >= 2.4;
  return {
    ratio,
    orientation,
    columnExplained,
    rowExplained,
    columnCycles,
    rowCycles,
    dominantCycles,
    dominantExplained,
    globalBanding,
    suspicious: directionalBanding || globalBanding,
  };
}

async function importDiagnosticOrt() {
  if (diagnosticOrt) return diagnosticOrt;
  const sources = Array.from(new Set([cfg.ortCurrentAll, cfg.ortRemote].filter(Boolean)));
  const errors = [];
  for (const source of sources) {
    try {
      const mod = await import(source);
      const candidate = mod.default || mod;
      if (candidate?.InferenceSession) { diagnosticOrt = candidate; return diagnosticOrt; }
      errors.push(`${source}: InferenceSession mancante`);
    } catch (err) { errors.push(`${source}: ${err?.message || err}`); }
  }
  fail(`runtime WASM diagnostico non disponibile. ${errors.join(' | ')}`);
}

async function runWasmDiagnostic(d, reference) {
  const runtime = await importDiagnosticOrt();
  configureWasmRuntime(runtime);
  const modelBytes = sessionModelBytes || await fetchModel(d.model);
  let wasmSession = null;
  const started = performance.now();
  try {
    wasmSession = await runtime.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const loadMs = performance.now() - started;
    const spec = inputSpec(wasmSession);
    const plan = reference.inputPlan;
    // One run is enough for a correctness reference. V30.19 performed two WASM
    // passes even though this branch exists only to decide whether WebGPU is
    // trustworthy, doubling the worst-case phone diagnostic time.
    const prepared = await prepareInput(d.rgba, d.width, d.height, spec, plan, reference.inputType || spec.type, runtime);
    const one = await runPrepared(spec, prepared, wasmSession);
    return { ...one, loadMs, summary: finiteSummary(one.rawDepth), quality: depthQualityDiagnosis(one.spatialStats) };
  } finally {
    try { await wasmSession?.release?.(); } catch {}
  }
}

async function providerABDiagnostic(d, webgpuResult, { flipCheck = false } = {}) {
  if (provider !== 'webgpu') {
    providerValidated = true;
    sessionModelBytes = null;
    return { attempted: false, reason: `primary-provider-${provider}` };
  }
  const webgpuQuality = depthQualityDiagnosis(webgpuResult.spatialStats);
  let flipComparison = null;
  if (flipCheck) {
    try { flipComparison = await runFlipDiagnostic(d, webgpuResult); }
    catch (err) { flipComparison = { comparable:false, error:err?.message || String(err) }; }
  }
  const flipSuspicious = !!(flipComparison?.comparable && Number(flipComparison.correlation) < 0.78);
  const primarySuspicious = webgpuQuality.suspicious || flipSuspicious;

  // Healthy maps stay on WebGPU without creating a second runtime/session.
  if (!primarySuspicious) {
    providerValidated = true;
    sessionModelBytes = null;
    return {
      attempted:false,
      reason:'webgpu-quality-ok',
      rasterDiagnosis:{ verdict:'webgpu-structured', primaryStripe:webgpuQuality.stripe, primaryCoherence:webgpuQuality.coherenceRatio },
      flipComparison,
      webgpu:{ ms:webgpuResult.steadyMs, stripe:webgpuQuality.stripe, coherenceRatio:webgpuQuality.coherenceRatio },
    };
  }
  try {
    const wasm = await runWasmDiagnostic(d, webgpuResult);
    const comparison = compareDepthMaps(webgpuResult.rawDepth, wasm.rawDepth);
    const wasmQuality = wasm.quality || depthQualityDiagnosis(wasm.spatialStats);
    const providerMismatch = comparison.comparable && (comparison.correlation < 0.90 || comparison.nrmse > 0.75);
    const webgpuLikelyCorrupt = primarySuspicious && providerMismatch && !wasmQuality.suspicious;
    if (webgpuLikelyCorrupt) {
      forceWasm = true;
      providerValidated = true;
      try { await session?.release?.(); } catch {}
      session = null; sessionKey = ''; successfulInputPlan = null;
      postMessage({ type:'deep-diag', level:'warn', event:'webgpu-disabled', message:'Q4 WebGPU incoerente/rumoroso rispetto a WASM: uso WASM sicuro nelle inferenze successive.' });
    } else {
      providerValidated = true;
    }
    sessionModelBytes = null;
    return {
      attempted: true,
      webgpuLikelyCorrupt,
      recommendation: webgpuLikelyCorrupt ? 'use-wasm-safe-fallback' : 'keep-current-provider',
      rasterDiagnosis:{
        verdict:webgpuLikelyCorrupt?'webgpu-corrupt-use-wasm':'provider-difference-not-conclusive',
        primaryStripe:webgpuQuality.stripe,
        primaryCoherence:webgpuQuality.coherenceRatio,
        referenceStripe:wasmQuality.stripe,
        referenceCoherence:wasmQuality.coherenceRatio,
      },
      flipComparison,
      webgpu: { ms: webgpuResult.steadyMs, summary: finiteSummary(webgpuResult.rawDepth), stripe: webgpuQuality.stripe, coherenceRatio:webgpuQuality.coherenceRatio },
      wasm: { ms: wasm.steadyMs, loadMs: wasm.loadMs, summary: wasm.summary, stripe: wasmQuality.stripe, coherenceRatio:wasmQuality.coherenceRatio, spatialStats:wasm.spatialStats, depthSignature: sampledFloatSignature(wasm.rawDepth, wasm.width, wasm.height) },
      comparison,
      wasmPreviewDepth: wasm.rawDepth,
      wasmPreviewWidth: wasm.width,
      wasmPreviewHeight: wasm.height,
    };
  } catch (err) {
    sessionModelBytes = null;
    return { attempted: true, failed: true, message: err?.message || String(err) };
  }
}

function qualityScore(q) {
  const stripePenalty = Math.max(0, Number(q?.stripe?.dominantExplained || 0) - .18) * 8
    + Math.max(0, Number(q?.stripe?.ratio || 1) - 1) * .12;
  const coherence = Math.min(6, Math.max(0, Number(q?.coherenceRatio) || 0));
  return (q?.suspicious ? 0 : 12) + coherence - stripePenalty;
}

async function maybeResolutionRescue(d, primary) {
  const primaryQuality = depthQualityDiagnosis(primary.spatialStats);
  const shortSide = Math.min(Number(primary.inputPlan?.width)||Infinity, Number(primary.inputPlan?.height)||Infinity);
  const firstRescue = positiveNumber(cfg.qualityRescueShortSide, 280);
  const maxRescue = positiveNumber(cfg.qualityMaxRescueShortSide, 336);
  if (!primaryQuality.suspicious || !Number.isFinite(shortSide) || primary.inputPlan?.mode === 'metadata-fixed') {
    return { result: primary, attempted:false, accepted:false, primaryQuality, finalQuality:primaryQuality, attempts:[] };
  }

  const candidates = Array.from(new Set([firstRescue, maxRescue]))
    .filter(side => Number.isFinite(side) && side > shortSide)
    .sort((a,b)=>a-b);
  if (!candidates.length) return { result: primary, attempted:false, accepted:false, primaryQuality, finalQuality:primaryQuality, attempts:[] };

  let best = primary, bestQuality = primaryQuality, bestScore = qualityScore(primaryQuality);
  const attempts = [];
  for (const side of candidates) {
    try {
      const rescued = await infer({ ...d, targetSide: side }, { benchmark:false, ignoreCachedPlan:true });
      const rescuedQuality = depthQualityDiagnosis(rescued.spatialStats);
      const score = qualityScore(rescuedQuality);
      attempts.push({side,plan:rescued.inputPlan,ms:rescued.steadyMs,quality:rescuedQuality,score});
      if (score > bestScore + .15 || (!rescuedQuality.suspicious && bestQuality.suspicious)) {
        best = rescued; bestQuality = rescuedQuality; bestScore = score;
      }
      // First structurally healthy raster wins. Avoid paying 336px after a good
      // 280px map, keeping the steady-state mobile profile as light as possible.
      if (!rescuedQuality.suspicious) break;
    } catch (err) {
      attempts.push({side,failed:true,message:err?.message||String(err)});
    }
  }

  successfulInputPlan = { ...best.inputPlan };
  return {
    result: best,
    attempted: attempts.length > 0,
    accepted: best !== primary,
    primaryQuality,
    finalQuality:bestQuality,
    primaryPlan:primary.inputPlan,
    rescuedPlan:best !== primary ? best.inputPlan : null,
    attempts,
  };
}

async function infer(d, { benchmark = false, ignoreCachedPlan = false } = {}) {
  if (!d.rgba?.length || !(d.width > 1 && d.height > 1)) {
    fail('fotogramma RGBA non valido');
  }

  const frameSignature = sampledByteSignature(d.rgba, d.width, d.height);
  const sessionStarted = performance.now();
  await ensureSession(d.model);
  const sessionMs = performance.now() - sessionStarted;
  const spec = inputSpec();

  const typeCandidates = ['float32'];

  const plans = inputPlans(spec, d.width, d.height, d.targetSide || null, { ignoreCached: ignoreCachedPlan });
  const errors = [];

  for (const plan of plans) {
    for (const tensorType of typeCandidates) {
      try {
        const firstPrepared = await prepareInput(d.rgba, d.width, d.height, spec, plan, tensorType, ort, benchmark);
        const first = await runPrepared(spec, firstPrepared);

        successfulInputPlan = { ...plan };

        // The V30.20 test executed the model twice here (cold + warm), then a
        // third time for flip-equivariance. On a 10 s phone this alone explained
        // the >30 s diagnostic. V30.21 keeps the first successful inference and
        // reports it directly; the same warm session is then reused by Scan.
        return {
          ...first,
          sessionMs,
          sessionLoadMs: lastSessionLoadMs,
          coldRunMs: benchmark ? first.runMs : null,
          coldSteadyMs: benchmark ? first.steadyMs : null,
          contractFallback: !!spec.contractFallback,
          benchmarkWarm: false,
          testSinglePass: !!benchmark,
          frameSignature,
          depthSignature: sampledFloatSignature(first.rawDepth, first.width, first.height),
        };
      } catch (err) {
        errors.push(`${plan.width}x${plan.height}/${tensorType}: ${err?.message || err}`);

        // If a previously cached plan somehow stopped working (e.g. model was
        // changed without recreating the page), clear it so future calls can
        // perform compatibility probing again.
        if (successfulInputPlan && plan.width === successfulInputPlan.width && plan.height === successfulInputPlan.height) {
          successfulInputPlan = null;
        }
      }
    }
  }

  fail(
    `inferenza ONNX fallita per ${spec.name}. ` +
    `Tentativi raster/tipo: ${errors.join(' | ')}`,
  );
}

function isPreviewJob(d) {
  return d?.type === 'infer' && String(d?.jobId || '').startsWith('preview-ticker-');
}

function scheduleQueuedInference() {
  if (busy) return;
  const next = queuedPriorityInfer || queuedPreviewInfer;
  if (!next) return;
  if (queuedPriorityInfer) queuedPriorityInfer = null;
  else queuedPreviewInfer = null;
  queueMicrotask(() => void handleWorkerMessage(next));
}

async function handleWorkerMessage(d) {
  d = d || {};

  if (d.type === 'init') {
    cfg = { ...cfg, ...(d.config || {}) };
    // The page forwards this setting; preserve a safe value for external calls.
    if (Number(d.config?.preferredShortSide) > 0) cfg.preferredShortSide = Number(d.config.preferredShortSide);
    if (Number(d.config?.compatibilityShortSide) > 0) cfg.compatibilityShortSide = Number(d.config.compatibilityShortSide);
    if (Number(d.config?.qualityRescueShortSide) > 0) cfg.qualityRescueShortSide = Number(d.config.qualityRescueShortSide);
    if (Number(d.config?.qualityMaxRescueShortSide) > 0) cfg.qualityMaxRescueShortSide = Number(d.config.qualityMaxRescueShortSide);
    postMessage({
      type: 'deep-ready',
      provider,
      modelUrl: cfg.modelUrl,
      modelRemoteUrl: cfg.modelRemoteUrl,
      preferredShortSide: cfg.preferredShortSide,
      qualityRescueShortSide: cfg.qualityRescueShortSide,
      qualityMaxRescueShortSide: cfg.qualityMaxRescueShortSide,
      rasterContract: 'RGBA-row-major -> RGB-NCHW-planar',
    });
    return;
  }

  if (d.type === 'status') {
    postMessage({
      type: 'deep-status',
      provider,
      runtime: ortSource,
      busy,
      loaded: !!session,
      model: sessionKey || cfg.modelUrl,
      inputNames: Array.from(session?.inputNames || []),
      outputNames: Array.from(session?.outputNames || []),
      successfulInputPlan,
      sessionLoadMs: lastSessionLoadMs,
      forceWasm,
      providerValidated,
      queuedPriority: !!queuedPriorityInfer,
      queuedPreview: !!queuedPreviewInfer,
    });
    return;
  }

  if (!['load', 'test', 'infer'].includes(d.type)) return;

  if (busy) {
    if (d.type === 'infer') {
      // Never report a benign scheduling collision as deep-error: app.js treats
      // any deep-error as a reason to disable AI for the whole scan. Keyframe
      // depth gets priority; live preview keeps only one pending frame.
      if (isPreviewJob(d)) {
        if (!queuedPreviewInfer) queuedPreviewInfer = d;
        postMessage({ type:'deep-preview-queued', jobId:d.jobId || null });
      } else if (!queuedPriorityInfer) {
        queuedPriorityInfer = d;
        postMessage({ type:'deep-queued', jobId:d.jobId || null });
      }
      return;
    }
    postMessage({
      type: 'deep-error',
      jobId: d.jobId || null,
      stage: d.type,
      message: 'inferenza precedente ancora in corso',
      provider,
    });
    return;
  }

  busy = true;
  const totalStarted = performance.now();
  const previewJob = isPreviewJob(d);

  try {
    if (d.type === 'load') {
      await ensureSession(d.model);
      postMessage({
        type: 'deep-load-result',
        ok: true,
        provider,
        runtime: ortSource,
        model: d.model?.label || d.model?.url || cfg.modelUrl,
        ms: performance.now() - totalStarted,
        sessionLoadMs: lastSessionLoadMs,
      });
      return;
    }

    const firstRaw = await infer(d, { benchmark: d.type === 'test' });
    // V30.25: first distinguish a resolution-dependent DPT collapse from a genuine
    // WebGPU/Q4 problem. Phone screenshots at 112/168 px showed global bands; the
    // same provider therefore climbs 224 -> 280 -> 336 only while the structural
    // quality gate remains suspicious, before paying for a second WASM runtime.
    const resolutionRescue = await maybeResolutionRescue(d, firstRaw);
    const raw = resolutionRescue.result;
    // Fast test: one inference is enough when the map is healthy. WASM is created
    // only after the chosen resolution is still spatially suspicious.
    const diagnostic = d.type === 'test'
      ? await providerABDiagnostic(d, raw, { flipCheck:cfg.testFlipCheck === true })
      : (provider === 'webgpu' && !providerValidated
        ? await providerABDiagnostic(d, raw, { flipCheck:false })
        : null);
    const useSafeWasm = !!(diagnostic?.webgpuLikelyCorrupt && diagnostic?.wasmPreviewDepth?.length);
    const finalDepth = useSafeWasm ? diagnostic.wasmPreviewDepth : raw.rawDepth;
    const finalWidth = useSafeWasm ? diagnostic.wasmPreviewWidth : raw.width;
    const finalHeight = useSafeWasm ? diagnostic.wasmPreviewHeight : raw.height;
    const effectiveProvider = useSafeWasm ? 'wasm-safe' : provider;
    const finalDepthSignature = sampledFloatSignature(finalDepth, finalWidth, finalHeight);
    const finalSpatialStats = useSafeWasm ? (diagnostic.wasm?.spatialStats || raw.spatialStats) : raw.spatialStats;
    const finalQuality = depthQualityDiagnosis(finalSpatialStats || {});
    const qualityVerdict = finalQuality.suspicious
      ? 'depth-quality-warning'
      : resolutionRescue?.accepted ? 'resolution-rescue-ok' : 'depth-structured';
    const rasterDiagnosis = diagnostic?.rasterDiagnosis || {
      verdict: qualityVerdict,
      primaryStripe: finalQuality.stripe,
      primaryCoherence: finalQuality.coherenceRatio,
    };

    const message = {
      type: d.type === 'test' ? 'deep-test-result' : 'deep-result',
      jobId: d.jobId || null,
      refId: d.refId || null,
      provider: effectiveProvider,
      runtime: ortSource,
      rawDepth: finalDepth,
      rawWidth: finalWidth,
      rawHeight: finalHeight,
      inputType: raw.inputType || null,
      inputDims: raw.inputDims || null,
      inputPlan: raw.inputPlan || null,
      outputName: raw.outputName || null,
      outputDims: raw.outputDims || null,
      outputType: raw.outputType || null,
      outputLocation: raw.outputLocation || null,
      outputReadback: raw.outputReadback || null,
      shapeMatchesInput: raw.shapeMatchesInput !== false,
      layoutFix: raw.layoutFix || 'none',
      spatialStats: finalSpatialStats || null,
      quality: finalQuality,
      rasterContract: raw.preprocessBackend || 'RGBA -> RGB/NCHW',
      preprocessBackend: raw.preprocessBackend || null,
      rasterProbe: raw.rasterProbe || null,
      inputRasterDiagnostic: d.type === 'test' ? raw.inputRasterDiagnostic || null : null,
      frameSignature: raw.frameSignature || null,
      depthSignature: finalDepthSignature,
      contractFallback: !!raw.contractFallback,
      benchmarkWarm: !!raw.benchmarkWarm,
      testSinglePass: !!raw.testSinglePass,
      preprocessMs: raw.preprocessMs,
      runMs: useSafeWasm ? diagnostic.wasm?.ms : raw.runMs,
      outputMs: raw.outputMs,
      coldRunMs: raw.coldRunMs,
      coldSteadyMs: raw.coldSteadyMs,
      sessionMs: raw.sessionMs,
      sessionLoadMs: raw.sessionLoadMs,
      ms: useSafeWasm ? diagnostic.wasm?.ms : raw.steadyMs,
      totalMs: performance.now() - totalStarted,
      providerDiagnostic: diagnostic ? { ...diagnostic, wasmPreviewDepth: undefined } : null,
      rasterDiagnosis,
      flipComparison: diagnostic?.flipComparison || null,
      automaticSafeFallback: useSafeWasm,
      resolutionRescue: resolutionRescue ? { ...resolutionRescue, result:undefined } : null,
    };

    const transfer = finalDepth?.buffer ? [finalDepth.buffer] : [];
    postMessage(message, transfer);
  } catch (err) {
    // Preview errors must not disable the reconstruction pipeline. The dedicated
    // controller displays them and simply tries a later frame.
    postMessage({
      type: previewJob ? 'deep-preview-error' : 'deep-error',
      jobId: d.jobId || null,
      stage: d.type,
      message: err?.message || String(err),
      stack: err?.stack || null,
      provider,
      runtime: ortSource,
      ms: performance.now() - totalStarted,
    });
  } finally {
    busy = false;
    scheduleQueuedInference();
  }
}

self.onmessage = event => void handleWorkerMessage(event.data || {});
