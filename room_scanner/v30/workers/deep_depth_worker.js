/*
 * Room Scanner V30.18.5 - Mobile Q4 auto-download/cache Depth Anything worker.
 *
 * OUTPUT LAYOUT + WEBGPU RUNTIME + SPEED FIX
 * -------------------------
 * 1) The camera RGBA buffer is now converted to the ONNX RGB/NCHW tensor
 *    explicitly in JavaScript.  No OffscreenCanvas, ImageData re-upload or
 *    hidden canvas resampling is involved in the inference path.
 *
 *    Exact memory contract:
 *      source: RGBA RGBA RGBA ... (row-major, interleaved)
 *      tensor: RRR... GGG... BBB... (NCHW, planar)
 *
 * 2) Dynamic Depth Anything inputs preserve camera aspect ratio.  For the
 *    Room Scanner 320x480 analysis frame the first mobile plan is 168x252,
 *    both multiples of the ViT patch size (14).  The old code stretched the
 *    portrait frame to 518x518 before inference and then stretched the depth
 *    back to portrait, which was geometrically inconsistent with Alva pixels.
 *
 * 3) If the ONNX export is fixed-shape, the worker automatically falls back to
 *    the classic 518x518 contract.  A successful plan is cached for all later
 *    frames, so compatibility probing is paid only once.
 *
 * 4) The pre-scan "test" now performs one compatibility/cold run and one warm
 *    run.  `ms` is the steady-state preprocess + session.run + output read time,
 *    NOT model download/session creation/first WebGPU compilation.  Additional
 *    timing fields are returned for diagnostics without changing app.js.
 *
 * Drop-in replacement for:
 *   room_scanner/v30/workers/deep_depth_worker.js
 */

let cfg = {
  modelUrl: 'models/depth_anything_v2_small_q4.onnx',
  modelRemoteUrl: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4.onnx',
  modelCacheName: 'room-scanner-depth-models-v1',
  ortLocal: '../vendor/onnxruntime-web/ort.all.min.mjs',
  // Keep the project-configured runtime only as a last-resort compatibility fallback.
  ortRemote: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.all.min.mjs',
  ortCurrentWebGpu: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.webgpu.min.mjs',
  ortCurrentAll: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.all.min.mjs',

  // Compatibility ceiling/fallback used by the existing V30 config.
  inputMaxSide: 518,

  // Mobile inference target.  168 is 12 * 14.  A 320x480 frame therefore
  // becomes 168x252 (18 * 14) without changing its 2:3 aspect ratio.
  // Depth is a geometric prior here; Alva + multi-view verification retain
  // metric/structural authority, so this lower raster is a good speed tradeoff.
  preferredShortSide: 140,
  patchSize: 14,

  // Used when onnxruntime-web exposes inputNames but not inputMetadata.
  inputType: 'float32',
};

let ort = null;
let ortSource = '';
let session = null;
let sessionKey = '';
let provider = 'unloaded';
let busy = false;

// Cached after the first successful inference.  This prevents trying several
// resolutions/types on every frame and makes the live path deterministic.
let successfulInputPlan = null;
let lastSessionLoadMs = 0;
let diagnosticOrt = null;
let forceWasm = false;
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
  // fallback.  The q4f16 graph uses modern quantized WebGPU kernels and old
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
  // arrayBuffer() avoids retaining a JS array of download chunks, which matters
  // on smartphones because the ONNX session itself already consumes RAM.
  const buffer = await response.arrayBuffer();
  postMessage({ type:'deep-download-progress', label, received:buffer.byteLength, total:total || buffer.byteLength, pct:100 });
  return buffer;
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

  // First try the future local Q4 filename. If it is not present on GitHub yet,
  // fall through to the official Apache-2.0 ONNX Community file and cache it.
  if (requested) {
    try { return await fetchUrlModel(requested, { cacheable:false, label:'modello Q4 locale' }); }
    catch (err) { errors.push(`locale: ${err?.message || err}`); }
  }
  if (remote && remote !== requested) {
    try { return await fetchUrlModel(remote, { cacheable:true, label:'Depth Anything V2 Small Q4 ufficiale' }); }
    catch (err) { errors.push(`remoto: ${err?.message || err}`); }
  }
  fail(`modello Q4 non disponibile. ${errors.join(' | ')}`);
}

async function ensureSession(source) {
  const sourceKey = source?.id || source?.url || cfg.modelUrl;
  if (session && sessionKey === sourceKey) return session;

  const sessionStarted = performance.now();
  const runtime = await importOrt();
  try {
    runtime.env.wasm.numThreads = 1;
    runtime.env.wasm.simd = true;
  } catch {
    // Optional runtime flags.
  }

  if (session) {
    try {
      await session.release?.();
    } catch {
      // Best-effort cleanup when changing model/provider.
    }
    session = null;
    sessionKey = '';
  }

  successfulInputPlan = null;
  const bytes = await fetchModel(source);
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
 * Depth Anything works on ViT patches.  Keep the camera aspect ratio and make
 * both dimensions exact multiples of the patch size.  We target the SHORT side
 * because this is equivalent to the model's aspect-preserving "lower bound"
 * resize semantics, just with a smaller mobile input_size.
 */
function adaptiveInputGeometry(sourceWidth, sourceHeight, shortSide) {
  const sw = Math.max(2, sourceWidth | 0);
  const sh = Math.max(2, sourceHeight | 0);
  const patch = Math.max(1, cfg.patchSize | 0 || 14);
  const targetShort = roundToMultiple(Math.max(patch * 8, Number(shortSide) || 224), patch);
  const scale = targetShort / Math.min(sw, sh);

  let width = roundToMultiple(sw * scale, patch);
  let height = roundToMultiple(sh * scale, patch);

  // Guard pathological aspect ratios.  Normal Room Scanner frames (4:3, 2:3)
  // never hit this branch.
  const maxLong = Math.max(positiveNumber(cfg.inputMaxSide, 518) * 2, targetShort);
  if (Math.max(width, height) > maxLong) {
    const s = maxLong / Math.max(width, height);
    width = roundToMultiple(width * s, patch);
    height = roundToMultiple(height * s, patch);
  }

  return { width, height, mode: `aspect-${targetShort}` };
}

function inputPlans(spec, sourceWidth, sourceHeight) {
  if (successfulInputPlan) return [successfulInputPlan];

  // If metadata states a concrete spatial shape, obey it exactly.
  if (spec.spatialFixed) {
    return [{ width: spec.width, height: spec.height, mode: 'metadata-fixed' }];
  }

  const preferred = positiveNumber(cfg.preferredShortSide, 140);
  const plans = [
    adaptiveInputGeometry(sourceWidth, sourceHeight, preferred),
    // Medium fallback: useful if a custom dynamic export dislikes very small
    // feature maps while still avoiding the full 518 workload.
    adaptiveInputGeometry(sourceWidth, sourceHeight, 322),
    // Official-quality dynamic fallback with aspect preserved.
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

/**
 * Explicit RGBA row-major -> RGB NCHW conversion with bilinear resize.
 *
 * This intentionally does not use OffscreenCanvas.  The source byte index is
 * always ((y * sourceWidth + x) * 4 + channel), while the tensor index is
 * (channel * targetWidth * targetHeight + y * targetWidth + x).
 */
function prepareInput(rgba, width, height, spec, plan, forcedType = null, runtime = ort) {
  const started = performance.now();
  const srcWidth = width | 0;
  const srcHeight = height | 0;
  if (!(srcWidth > 1 && srcHeight > 1)) fail('dimensioni fotogramma RGBA non valide');

  const src = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  const required = srcWidth * srcHeight * 4;
  if (src.length < required) {
    fail(`buffer RGBA incompleto: ${src.length} byte, attesi almeno ${required}`);
  }

  const targetWidth = plan.width | 0;
  const targetHeight = plan.height | 0;
  if (!(targetWidth > 1 && targetHeight > 1)) fail('shape input ONNX non valida');

  const n = targetWidth * targetHeight;
  const tensorType = String(forcedType || spec.type || 'float32').toLowerCase();
  const float16Input = tensorType.includes('float16');
  const values = float16Input ? new Uint16Array(n * 3) : new Float32Array(n * 3);

  // ImageNet normalization used by the official DPT/Depth Anything processor.
  const meanR = 0.485, meanG = 0.456, meanB = 0.406;
  const stdR = 0.229, stdG = 0.224, stdB = 0.225;

  // Precompute horizontal sampling indices/weights once per row.
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
      const wx = tx[x];
      const invWx = 1 - wx;
      const i00 = (row0 + x0[x]) * 4;
      const i01 = (row0 + x1[x]) * 4;
      const i10 = (row1 + x0[x]) * 4;
      const i11 = (row1 + x1[x]) * 4;

      // Bilinear interpolation directly from interleaved camera RGBA.
      const w00 = invWx * invWy;
      const w01 = wx * invWy;
      const w10 = invWx * wy;
      const w11 = wx * wy;

      const r = src[i00] * w00 + src[i01] * w01 + src[i10] * w10 + src[i11] * w11;
      const g = src[i00 + 1] * w00 + src[i01 + 1] * w01 + src[i10 + 1] * w10 + src[i11 + 1] * w11;
      const b = src[i00 + 2] * w00 + src[i01 + 2] * w01 + src[i10 + 2] * w10 + src[i11 + 2] * w11;

      const i = dstRow + x;
      const vr = (r / 255 - meanR) / stdR;
      const vg = (g / 255 - meanG) / stdG;
      const vb = (b / 255 - meanB) / stdB;

      values[i] = float16Input ? toFloat16(vr) : vr;
      values[n + i] = float16Input ? toFloat16(vg) : vg;
      values[2 * n + i] = float16Input ? toFloat16(vb) : vb;
    }
  }

  const dims = [1, 3, targetHeight, targetWidth];
  return {
    tensor: new runtime.Tensor(float16Input ? 'float16' : 'float32', values, dims),
    dims,
    type: float16Input ? 'float16' : 'float32',
    preprocessMs: performance.now() - started,
    plan,
    rasterProbe: sourceRgbProbe(src, srcWidth, srcHeight),
  };
}

function tensorScalar(tensor, index) {
  const src = tensor.data;
  const isF16 = String(tensor.type || '').toLowerCase().includes('float16');
  if (isF16 && src instanceof Uint16Array) return fromFloat16(src[index]);
  return Number(src[index]);
}

function depthSpatialStats(depth, width, height) {
  let dx = 0, dy = 0, nx = 0, ny = 0, finite = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const v = depth[i];
      if (Number.isFinite(v)) finite++;
      if (x + 1 < width && Number.isFinite(v) && Number.isFinite(depth[i + 1])) { dx += Math.abs(v - depth[i + 1]); nx++; }
      if (y + 1 < height && Number.isFinite(v) && Number.isFinite(depth[i + width])) { dy += Math.abs(v - depth[i + width]); ny++; }
    }
  }
  const meanDx = nx ? dx / nx : 0;
  const meanDy = ny ? dy / ny : 0;
  return {
    finiteRatio: depth.length ? finite / depth.length : 0,
    meanDx,
    meanDy,
    directionalRatio: Math.max(meanDx, meanDy) / Math.max(1e-12, Math.min(meanDx, meanDy)),
  };
}

function readOutput(result, expectedPlan, activeSession = session) {
  const outputNames = Array.from(activeSession?.outputNames || []);
  // Depth Anything V2 exports `predicted_depth`.  Prefer it explicitly instead
  // of assuming that the first property returned by the runtime is depth.
  const name = result?.predicted_depth
    ? 'predicted_depth'
    : outputNames.find((n) => /predicted[_-]?depth/i.test(n))
      || outputNames[0]
      || Object.keys(result || {})[0];
  const tensor = result?.[name];

  if (!tensor?.data?.length) {
    fail(`il modello non ha restituito una depth map; outputNames=${JSON.stringify(outputNames)}, resultKeys=${JSON.stringify(Object.keys(result || {}))}`);
  }

  const dims = Array.from(tensor.dims || []);
  const logicalHeight = Number(dims[dims.length - 2]);
  const logicalWidth = Number(dims[dims.length - 1]);
  const expectedWidth = Number(expectedPlan?.width);
  const expectedHeight = Number(expectedPlan?.height);

  if (!(logicalWidth > 1 && logicalHeight > 1 && logicalWidth * logicalHeight <= tensor.data.length)) {
    fail(`output ONNX non supportato: name=${name}, dims=${JSON.stringify(dims)}, type=${tensor.type || typeof tensor.data}`);
  }

  const planeLength = logicalWidth * logicalHeight;
  const offset = tensor.data.length - planeLength;
  let width = logicalWidth;
  let height = logicalHeight;
  let layoutFix = 'none';
  let out;

  if (logicalWidth === expectedWidth && logicalHeight === expectedHeight) {
    out = new Float32Array(planeLength);
    for (let i = 0; i < planeLength; i++) out[i] = tensorScalar(tensor, offset + i);
  } else if (logicalWidth === expectedHeight && logicalHeight === expectedWidth) {
    // Some dynamic WebGPU paths have historically surfaced swapped spatial
    // dimensions.  Respect the tensor's row-major logical layout, then
    // transpose into the SAME HxW raster used by the camera/Alva input.
    width = expectedWidth;
    height = expectedHeight;
    out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIndex = offset + x * logicalWidth + y;
        out[y * width + x] = tensorScalar(tensor, srcIndex);
      }
    }
    layoutFix = 'transpose-swapped-HW';
  } else if (Number.isFinite(expectedWidth) && Number.isFinite(expectedHeight) &&
             expectedWidth * expectedHeight === planeLength) {
    // Metadata may be absent/wrong while the element count is correct.  Since
    // Depth Anything V2 is 1:1 spatially with pixel_values, use the exact input
    // raster as the authoritative shape rather than inventing dimensions.
    width = expectedWidth;
    height = expectedHeight;
    out = new Float32Array(planeLength);
    for (let i = 0; i < planeLength; i++) out[i] = tensorScalar(tensor, offset + i);
    layoutFix = 'reshape-to-input-HW';
  } else {
    out = new Float32Array(planeLength);
    for (let i = 0; i < planeLength; i++) out[i] = tensorScalar(tensor, offset + i);
    layoutFix = 'unexpected-output-HW';
  }

  return {
    rawDepth: out,
    width,
    height,
    outputName: name,
    outputDims: dims,
    outputType: tensor.type || null,
    logicalWidth,
    logicalHeight,
    layoutFix,
    spatialStats: depthSpatialStats(out, width, height),
  };
}

async function runPrepared(spec, prepared, activeSession = session) {
  const runStarted = performance.now();
  const result = await activeSession.run({ [spec.name]: prepared.tensor });
  const runMs = performance.now() - runStarted;

  const outputStarted = performance.now();
  const output = readOutput(result, prepared.plan, activeSession);
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
    steadyMs: prepared.preprocessMs + runMs + outputMs,
  };
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

function stripeDiagnosis(spatialStats) {
  const dx = Number(spatialStats?.meanDx) || 0;
  const dy = Number(spatialStats?.meanDy) || 0;
  const ratio = Math.max(dx, dy) / Math.max(1e-12, Math.min(dx, dy));
  return {
    ratio,
    orientation: dx > dy ? 'vertical-columns' : dy > dx ? 'horizontal-rows' : 'isotropic',
    suspicious: ratio >= 4.0,
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
  try { runtime.env.wasm.numThreads = 1; runtime.env.wasm.simd = true; } catch {}
  const modelBytes = await fetchModel(d.model);
  let wasmSession = null;
  const started = performance.now();
  try {
    wasmSession = await runtime.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const loadMs = performance.now() - started;
    const spec = inputSpec(wasmSession);
    const plan = reference.inputPlan;
    const preparedCold = prepareInput(d.rgba, d.width, d.height, spec, plan, reference.inputType || spec.type, runtime);
    const cold = await runPrepared(spec, preparedCold, wasmSession);
    const preparedWarm = prepareInput(d.rgba, d.width, d.height, spec, plan, cold.inputType, runtime);
    const warm = await runPrepared(spec, preparedWarm, wasmSession);
    return { ...warm, loadMs, coldRunMs: cold.runMs, summary: finiteSummary(warm.rawDepth), stripe: stripeDiagnosis(warm.spatialStats) };
  } finally {
    try { await wasmSession?.release?.(); } catch {}
  }
}

async function providerABDiagnostic(d, webgpuResult) {
  if (provider !== 'webgpu') return { attempted: false, reason: `primary-provider-${provider}` };
  const webgpuStripe = stripeDiagnosis(webgpuResult.spatialStats);
  // Q4 is expected to be stable. A second WASM session is expensive on phones,
  // so run the A/B solver only when the WebGPU map actually shows the column/row
  // pathology we are debugging.
  if (!webgpuStripe.suspicious) return { attempted:false, reason:'webgpu-not-striped', webgpu:{ ms:webgpuResult.steadyMs, stripe:webgpuStripe } };
  try {
    const wasm = await runWasmDiagnostic(d, webgpuResult);
    const wasmStripe = wasm.stripe;
    const comparison = compareDepthMaps(webgpuResult.rawDepth, wasm.rawDepth);
    const gpuMuchMoreStriped = webgpuStripe.suspicious && webgpuStripe.ratio > Math.max(4, wasmStripe.ratio * 1.8);
    const providerMismatch = comparison.comparable && (comparison.correlation < 0.90 || comparison.nrmse > 0.75);
    const webgpuLikelyCorrupt = gpuMuchMoreStriped && providerMismatch && !wasmStripe.suspicious;
    if (webgpuLikelyCorrupt) {
      forceWasm = true;
      try { await session?.release?.(); } catch {}
      session = null; sessionKey = ''; successfulInputPlan = null;
      postMessage({ type:'deep-diag', level:'warn', event:'webgpu-disabled', message:'Q4 WebGPU incoerente rispetto a WASM: uso WASM sicuro nelle inferenze successive.' });
    }
    return {
      attempted: true,
      webgpuLikelyCorrupt,
      recommendation: webgpuLikelyCorrupt ? 'q4-webgpu-or-wasm-q4f16' : 'keep-webgpu-q4f16',
      webgpu: { ms: webgpuResult.steadyMs, summary: finiteSummary(webgpuResult.rawDepth), stripe: webgpuStripe },
      wasm: { ms: wasm.steadyMs, loadMs: wasm.loadMs, summary: wasm.summary, stripe: wasmStripe, depthSignature: sampledFloatSignature(wasm.rawDepth, wasm.width, wasm.height) },
      comparison,
      wasmPreviewDepth: wasm.rawDepth,
      wasmPreviewWidth: wasm.width,
      wasmPreviewHeight: wasm.height,
    };
  } catch (err) {
    return { attempted: true, failed: true, message: err?.message || String(err) };
  }
}

async function infer(d, { benchmark = false } = {}) {
  if (!d.rgba?.length || !(d.width > 1 && d.height > 1)) {
    fail('fotogramma RGBA non valido');
  }

  const frameSignature = sampledByteSignature(d.rgba, d.width, d.height);
  const sessionStarted = performance.now();
  await ensureSession(d.model);
  const sessionMs = performance.now() - sessionStarted;
  const spec = inputSpec();

  const typeCandidates = spec.metadataAvailable
    ? [spec.type]
    : Array.from(new Set([spec.type || 'float32', 'float32', 'float16']));

  const plans = inputPlans(spec, d.width, d.height);
  const errors = [];

  for (const plan of plans) {
    for (const tensorType of typeCandidates) {
      try {
        const firstPrepared = prepareInput(d.rgba, d.width, d.height, spec, plan, tensorType);
        const first = await runPrepared(spec, firstPrepared);

        successfulInputPlan = { ...plan };

        // The explicit pre-scan test is also a warm benchmark.  WebGPU often
        // pays graph/shader compilation on the first session.run().  Repeating
        // the SAME shape/type gives the number that matters during Scan.
        if (benchmark) {
          const warmPrepared = prepareInput(d.rgba, d.width, d.height, spec, successfulInputPlan, first.inputType);
          const warm = await runPrepared(spec, warmPrepared);
          return {
            ...warm,
            sessionMs,
            sessionLoadMs: lastSessionLoadMs,
            coldRunMs: first.runMs,
            coldSteadyMs: first.steadyMs,
            contractFallback: !!spec.contractFallback,
            benchmarkWarm: true,
            frameSignature,
            depthSignature: sampledFloatSignature(warm.rawDepth, warm.width, warm.height),
          };
        }

        return {
          ...first,
          sessionMs,
          sessionLoadMs: lastSessionLoadMs,
          coldRunMs: null,
          coldSteadyMs: null,
          contractFallback: !!spec.contractFallback,
          benchmarkWarm: false,
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
    // app.js V30.18.0 does not yet forward this optional setting; keep the
    // worker's 140-pixel mobile default unless a future caller provides it.
    if (Number(d.config?.preferredShortSide) > 0) cfg.preferredShortSide = Number(d.config.preferredShortSide);
    postMessage({
      type: 'deep-ready',
      provider,
      modelUrl: cfg.modelUrl,
      modelRemoteUrl: cfg.modelRemoteUrl,
      preferredShortSide: cfg.preferredShortSide,
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

    const raw = await infer(d, { benchmark: d.type === 'test' });
    const diagnostic = d.type === 'test' ? await providerABDiagnostic(d, raw) : null;
    const useSafeWasm = !!(diagnostic?.webgpuLikelyCorrupt && diagnostic?.wasmPreviewDepth?.length);
    const finalDepth = useSafeWasm ? diagnostic.wasmPreviewDepth : raw.rawDepth;
    const finalWidth = useSafeWasm ? diagnostic.wasmPreviewWidth : raw.width;
    const finalHeight = useSafeWasm ? diagnostic.wasmPreviewHeight : raw.height;
    const effectiveProvider = useSafeWasm ? 'wasm-safe' : provider;
    const finalDepthSignature = sampledFloatSignature(finalDepth, finalWidth, finalHeight);

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
      layoutFix: raw.layoutFix || 'none',
      spatialStats: useSafeWasm ? diagnostic.wasm?.stripe || raw.spatialStats : raw.spatialStats || null,
      rasterContract: 'RGBA-row-major-interleaved -> RGB-NCHW-planar',
      rasterProbe: raw.rasterProbe || null,
      frameSignature: raw.frameSignature || null,
      depthSignature: finalDepthSignature,
      contractFallback: !!raw.contractFallback,
      benchmarkWarm: !!raw.benchmarkWarm,
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
      automaticSafeFallback: useSafeWasm,
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
