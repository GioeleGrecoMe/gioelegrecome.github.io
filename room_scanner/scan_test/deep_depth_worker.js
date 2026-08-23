/*
 * Room Scanner V30.27.0 EXP-2 - exact-frame synchronized WebGPU/WASM Depth Anything worker.
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
 * 4) The pre-scan test makes one additional horizontal-flip inference. Its
 *    restored result must correlate with the original depth: finite/smooth
 *    output alone does not prove that the camera raster was not shuffled.
 *    This spatial proof is also required once before the first scan inference.
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
  // This experimental page is self-contained: a locally vendored ORT build,
  // when supplied, lives beside this worker under scan_test/vendor.
  ortLocal: 'vendor/onnxruntime-web/ort.all.min.mjs',
  // Keep the project-configured runtime only as a last-resort compatibility fallback.
  ortRemote: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.all.min.mjs',
  ortCurrentWebGpu: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.webgpu.min.mjs',
  ortCurrentAll: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.all.min.mjs',

  // Compatibility ceiling/fallback used by the existing V30 config.
  inputMaxSide: 518,

  // Live-safe mobile target: 16 ViT patches on the short side. The 12-patch
  // 168px profile was fast on the phone but produced global vertical bands.
  preferredShortSide: 518,
  compatibilityShortSide: 518,
  // Resolution quality ladder. 280 is the normal rescue; 336 is used only if
  // the global banding detector still sees a collapsed map.
  qualityRescueShortSide: 518,
  qualityMaxRescueShortSide: 518,
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
// The ONNX file, not a heuristic from the camera raster, owns this contract.
// It is inspected once before the browser runtime creates a session.  This is
// essential because some ORT Web versions expose inputNames but omit metadata.
let bundledModelContract = null;
let spatialContract = { verified:false, suspicious:false, reason:'not-run' };
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

const ONNX_DATA_TYPES = Object.freeze({
  1:'float32', 2:'uint8', 3:'int8', 4:'uint16', 5:'int16', 6:'int32', 7:'int64',
  9:'bool', 10:'float16', 11:'float64', 12:'uint32', 13:'uint64', 16:'bfloat16',
});

function protoVarint(bytes, start) {
  let value = 0n, shift = 0n, at = start;
  while (at < bytes.length && shift <= 63n) {
    const byte = BigInt(bytes[at++]);
    value |= (byte & 0x7fn) << shift;
    if (!(byte & 0x80n)) return { value, at };
    shift += 7n;
  }
  fail(`ONNX protobuf non valido all'offset ${start}`);
}

function protoFields(bytes) {
  const out = [];
  let at = 0;
  while (at < bytes.length) {
    const key = protoVarint(bytes, at); at = key.at;
    const field = Number(key.value >> 3n), wire = Number(key.value & 7n);
    if (!field) fail('ONNX protobuf con field zero');
    if (wire === 0) {
      const value = protoVarint(bytes, at); at = value.at;
      out.push({ field, wire, value:value.value });
    } else if (wire === 1) {
      if (at + 8 > bytes.length) fail('ONNX protobuf fixed64 troncato');
      out.push({ field, wire, value:bytes.subarray(at, at + 8) }); at += 8;
    } else if (wire === 2) {
      const length = protoVarint(bytes, at); at = length.at;
      const end = at + Number(length.value);
      if (end > bytes.length) fail('ONNX protobuf length-delimited troncato');
      out.push({ field, wire, value:bytes.subarray(at, end) }); at = end;
    } else if (wire === 5) {
      if (at + 4 > bytes.length) fail('ONNX protobuf fixed32 troncato');
      out.push({ field, wire, value:bytes.subarray(at, at + 4) }); at += 4;
    } else {
      fail(`ONNX protobuf wire type non supportato: ${wire}`);
    }
  }
  return out;
}

function protoFirst(entries, field) { return entries.find((entry) => entry.field === field) || null; }
function protoAll(entries, field) { return entries.filter((entry) => entry.field === field); }
function protoText(bytes) { return new TextDecoder().decode(bytes); }

function onnxDimension(bytes) {
  const entries = protoFields(bytes);
  const numeric = protoFirst(entries, 1);
  if (numeric?.wire === 0) return Number(numeric.value);
  const symbolic = protoFirst(entries, 2);
  return symbolic?.wire === 2 ? protoText(symbolic.value) : null;
}

function onnxTensorInfo(bytes) {
  const entries = protoFields(bytes);
  const element = protoFirst(entries, 1);
  const shape = protoFirst(entries, 2);
  const dimensions = shape?.wire === 2
    ? protoAll(protoFields(shape.value), 1).filter((entry) => entry.wire === 2).map((entry) => onnxDimension(entry.value))
    : null;
  return { type:ONNX_DATA_TYPES[Number(element?.value)] || `onnx-${element?.value ?? '?'}`, shape:dimensions };
}

function onnxValueInfo(bytes) {
  const entries = protoFields(bytes);
  const name = protoFirst(entries, 1);
  const type = protoFirst(entries, 2);
  const tensor = type?.wire === 2 ? protoFirst(protoFields(type.value), 1) : null;
  return {
    name:name?.wire === 2 ? protoText(name.value) : null,
    ...(tensor?.wire === 2 ? onnxTensorInfo(tensor.value) : { type:null, shape:null }),
  };
}

function inspectDepthModelContract(modelBytes) {
  const model = protoFields(new Uint8Array(modelBytes));
  const graph = protoFirst(model, 7);
  if (graph?.wire !== 2) fail('GraphProto ONNX assente');
  const graphFields = protoFields(graph.value);
  const inputs = protoAll(graphFields, 11).filter((entry) => entry.wire === 2).map((entry) => onnxValueInfo(entry.value));
  const outputs = protoAll(graphFields, 12).filter((entry) => entry.wire === 2).map((entry) => onnxValueInfo(entry.value));
  const input = inputs.find((entry) => entry.name === 'pixel_values');
  const output = outputs.find((entry) => entry.name === 'predicted_depth');
  const validInput = input?.type === 'float32' && input.shape?.length === 4 && input.shape[1] === 3;
  const validOutput = output?.type === 'float32' && output.shape?.length === 3;
  if (!validInput || !validOutput) {
    fail(`modello ONNX incompatibile: richiesti pixel_values float32 [B,3,H,W] e predicted_depth float32 [B,H,W]; trovati input=${JSON.stringify(inputs)} output=${JSON.stringify(outputs)}`);
  }
  return { input, output, inputs, outputs, verified:true };
}

function runtimeMetadataAgrees(meta, contract, role) {
  if (!meta || !contract) return true;
  const type = String(meta.type || '').toLowerCase();
  if (type && type !== contract.type) fail(`${role} runtime ONNX type=${type}, ma modello=${contract.type}`);
  const shape = Array.from(meta.shape || meta.dimensions || []);
  if (shape.length && shape.length !== contract.shape.length) {
    fail(`${role} runtime ONNX rank=${shape.length}, ma modello=${contract.shape.length}`);
  }
  if (shape.length && role === 'input' && isPositiveDimension(shape[1]) && Number(shape[1]) !== 3) {
    fail(`input runtime ONNX non RGB/NCHW: ${JSON.stringify(shape)}`);
  }
  return true;
}

function assessFlipComparison(comparison) {
  if (!comparison?.comparable) {
    return { verified:false, suspicious:true, reason:comparison?.error || comparison?.reason || 'flip-not-comparable', comparison:comparison || null };
  }
  const correlation = Number(comparison.correlation);
  const verified = Number.isFinite(correlation) && correlation >= .78;
  return {
    verified,
    suspicious:!verified,
    reason:verified ? 'flip-equivariant' : 'flip-correlation-below-0.78',
    correlation,
    nrmse:Number(comparison.nrmse),
    samples:Number(comparison.samples) || 0,
  };
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
  if (!bundledModelContract?.verified) fail('contratto ONNX non verificato prima della sessione');

  const inputNames = Array.from(activeSession.inputNames || []);
  const name = inputNames[0];
  if (!name) {
    fail(`il modello ONNX non espone nomi di input (inputNames=${JSON.stringify(inputNames)})`);
  }

  if (name !== bundledModelContract.input.name) {
    fail(`input runtime ONNX inatteso: ${name}; modello verificato=${bundledModelContract.input.name}`);
  }
  const meta = metadataEntry(activeSession.inputMetadata, name, 0);
  runtimeMetadataAgrees(meta, bundledModelContract.input, 'input');
  const rawShape = bundledModelContract.input.shape;
  const batch = rawShape[0];
  if (isPositiveDimension(batch) && Number(batch) !== 1) {
    fail(`batch input ONNX non supportato: ${JSON.stringify(rawShape)}`);
  }
  const spatialFixed = isPositiveDimension(rawShape[2]) && isPositiveDimension(rawShape[3]);
  const height = spatialFixed ? Number(rawShape[2]) : positiveNumber(cfg.inputMaxSide, 518);
  const width = spatialFixed ? Number(rawShape[3]) : positiveNumber(cfg.inputMaxSide, 518);

  // Some ONNX Runtime Web builds expose inputNames but omit inputMetadata. The
  // model binary above remains authoritative even in that API-limited case.
  if (!meta) {
    return {
      name,
      type: bundledModelContract.input.type,
      dims: [1, 3, height, width],
      width,
      height,
      rawShape,
      metadataAvailable: false,
      contractFallback: false,
      spatialFixed,
      contractSource:'onnx-binary',
    };
  }

  return {
    name,
    type: bundledModelContract.input.type,
    dims: [1, 3, height, width],
    width,
    height,
    rawShape,
    metadataAvailable: true,
    contractFallback: false,
    spatialFixed,
    contractSource:'onnx-binary+runtime-metadata',
  };
}

function outputDebugSpec(activeSession = session) {
  if (!activeSession) return null;
  const outputNames = Array.from(activeSession.outputNames || []);
  const name = outputNames[0] || null;
  if (name && bundledModelContract?.output?.name && name !== bundledModelContract.output.name) {
    fail(`output runtime ONNX inatteso: ${name}; modello verificato=${bundledModelContract.output.name}`);
  }
  const meta = name ? metadataEntry(activeSession.outputMetadata, name, 0) : null;
  runtimeMetadataAgrees(meta, bundledModelContract?.output, 'output');
  const rawShape = bundledModelContract?.output?.shape || meta?.shape || meta?.dimensions || null;
  return {
    name,
    type: bundledModelContract?.output?.type || meta?.type || null,
    shape: rawShape ? Array.from(rawShape) : null,
    contractSource:bundledModelContract?.verified ? 'onnx-binary' : 'runtime-metadata',
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

  // A scan-test result must be reproducible before it is fast.  In particular,
  // some Android WebGPU implementations have returned finite-but-random Q4
  // output, so a requested WASM run must not accidentally import the WebGPU
  // only build as its primary runtime.  Keep WebGPU available only in the
  // explicit performance path.
  const sources = Array.from(new Set((forceWasm
    ? [cfg.ortLocal, cfg.ortCurrentAll, cfg.ortRemote]
    : [cfg.ortLocal, cfg.ortCurrentWebGpu, cfg.ortCurrentAll, cfg.ortRemote]
  ).filter(Boolean)));
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
  // Provider is part of the session contract.  Otherwise changing from a
  // suspicious WebGPU result to WASM could silently reuse the old session.
  const sourceKey = `${modelSourceKey(source)}|provider:${forceWasm ? 'wasm' : 'auto'}`;
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
  spatialContract = { verified:false, suspicious:false, reason:'new-model-or-session' };
  const bytes = await fetchModel(source);
  // Verify the model's declared interface before passing opaque bytes to ORT.
  // This makes a wrong uploaded ONNX fail explicitly instead of being rendered
  // as a plausible-looking but spatially scrambled depth raster.
  bundledModelContract = inspectDepthModelContract(bytes);
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
        // Depth is consumed immediately on the CPU. Requesting CPU output
        // explicitly avoids driver-dependent GPU-buffer readback paths.
        preferredOutputLocation: 'cpu',
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
        modelContract:bundledModelContract,
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
 * meaning of 336 -> 392 -> 518 deterministic on portrait and landscape frames.
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

  const preferred = positiveNumber(targetSide, positiveNumber(cfg.preferredShortSide, 518));
  const plans = [
    adaptiveInputGeometry(sourceWidth, sourceHeight, preferred),
    // The official Depth Anything V2 target is 518 px on the short side.
    // Keep this compatibility slot only so a custom model can override it.
    adaptiveInputGeometry(sourceWidth, sourceHeight, positiveNumber(cfg.compatibilityShortSide, 518)),
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

/** Cubic kernel used by OpenCV INTER_CUBIC (A=-0.75). */
function cubicWeight(x) {
  const a = -0.75, t = Math.abs(x);
  if (t <= 1) return (a + 2) * t * t * t - (a + 3) * t * t + 1;
  if (t < 2) return a * t * t * t - 5 * a * t * t + 8 * a * t - 4 * a;
  return 0;
}

function cubicAxis(sourceSize, targetSize) {
  const index = new Int32Array(targetSize * 4), weight = new Float32Array(targetSize * 4);
  const scale = sourceSize / targetSize;
  for (let d = 0; d < targetSize; d++) {
    const source = (d + 0.5) * scale - 0.5, base = Math.floor(source);
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const raw = base + k - 1, w = cubicWeight(source - raw), j = d * 4 + k;
      index[j] = Math.max(0, Math.min(sourceSize - 1, raw));
      weight[j] = w; sum += w;
    }
    if (Math.abs(sum) > 1e-12) for (let k = 0; k < 4; k++) weight[d * 4 + k] /= sum;
  }
  return { index, weight };
}

/**
 * Explicit RGBA row-major -> RGB NCHW conversion using the bicubic family used
 * by the upstream Depth Anything V2 DPT resize.
 *
 * Source byte index: ((y * sourceWidth + x) * 4 + channel)
 * Tensor index:      channel * (targetWidth*targetHeight) + y*targetWidth + x
 */
async function prepareInput(rgba, width, height, spec, plan, forcedType = null, runtime = ort, captureDiagnostic = false) {
  const started = performance.now(), srcWidth = width | 0, srcHeight = height | 0;
  if (!(srcWidth > 1 && srcHeight > 1)) fail('dimensioni fotogramma RGBA non valide');
  const src = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  const required = srcWidth * srcHeight * 4;
  if (src.length !== required) fail(`buffer RGBA con shape errata: ${src.length} byte, attesi esattamente ${required} per ${srcWidth}x${srcHeight}x4`);

  const targetWidth = plan.width | 0, targetHeight = plan.height | 0;
  if (!(targetWidth > 1 && targetHeight > 1)) fail('shape input ONNX non valida');
  const patch = Math.max(1, cfg.patchSize | 0 || 14);
  if (targetWidth % patch || targetHeight % patch) fail(`raster input non allineato ai patch ViT/${patch}: ${targetWidth}x${targetHeight}`);
  const tensorType = String(forcedType || spec.type || 'float32').toLowerCase();
  if (tensorType !== 'float32' && !tensorType.includes('float')) fail(`pixel_values dtype non supportato: ${tensorType}`);

  const n = targetWidth * targetHeight, values = new Float32Array(n * 3);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const xa = cubicAxis(srcWidth, targetWidth), ya = cubicAxis(srcHeight, targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const dstRow = y * targetWidth, yo = y * 4;
    for (let x = 0; x < targetWidth; x++) {
      const xo = x * 4; let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < 4; ky++) {
        const sy = ya.index[yo + ky], wy = ya.weight[yo + ky], srcRow = sy * srcWidth;
        for (let kx = 0; kx < 4; kx++) {
          const sx = xa.index[xo + kx], w = wy * xa.weight[xo + kx], si = (srcRow + sx) * 4;
          r += src[si] * w; g += src[si + 1] * w; b += src[si + 2] * w;
        }
      }
      const i = dstRow + x;
      values[i] = (Math.max(0, Math.min(255, r)) / 255 - mean[0]) / std[0];
      values[n + i] = (Math.max(0, Math.min(255, g)) / 255 - mean[1]) / std[1];
      values[2 * n + i] = (Math.max(0, Math.min(255, b)) / 255 - mean[2]) / std[2];
    }
  }
  const dims = [1, 3, targetHeight, targetWidth], tensor = new runtime.Tensor('float32', values, dims);
  return {
    tensor, dims, type:'float32', preprocessMs:performance.now()-started,
    preprocessBackend:'manual-rgba-nchw-opencv-bicubic', plan,
    rasterProbe:sourceRgbProbe(src, srcWidth, srcHeight),
    inputRasterDiagnostic:captureDiagnostic?{
      sourcePreview:src.slice(0,required),sourceWidth:srcWidth,sourceHeight:srcHeight,
      tensorNchwPreview:tensorRgbPreview(values,targetWidth,targetHeight,'nchw'),tensorNhwcPreview:null,
      tensorWidth:targetWidth,tensorHeight:targetHeight,
    }:null,
  };
}

function scalarFromCpuBuffer(src, tensorType, index) {
  const isF16 = String(tensorType || '').toLowerCase().includes('float16');
  if (isF16 && src instanceof Uint16Array) return fromFloat16(src[index]);
  return Number(src[index]);
}

async function tensorCpuData(tensor) {
  if (!tensor) fail('tensore output ONNX mancante');
  const location = String(tensor.location || '').toLowerCase();
  // With preferredOutputLocation=cpu, the direct typed array is authoritative.
  // Avoid forcing a device readback path for an already CPU-resident tensor.
  if (!location || location === 'cpu' || location === 'cpu-pinned') {
    try {
      const data = tensor.data;
      if (data?.length) return { data, readback:'cpu-data', location:location || 'cpu' };
    } catch {}
  }
  if (typeof tensor.getData === 'function') {
    const data = await tensor.getData(false);
    if (data?.length) return { data, readback:'getData', location:tensor.location || 'unknown' };
  }
  const data = tensor.data;
  if (!data?.length) fail('output ONNX senza buffer CPU leggibile');
  return { data, readback:'data-fallback', location:tensor.location || 'cpu' };
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
  if (!bundledModelContract?.verified) fail('contratto output ONNX non verificato');
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
  if (name !== bundledModelContract.output.name) {
    fail(`output ONNX errato: ${name}; atteso ${bundledModelContract.output.name}`);
  }
  const tensorType = String(tensor.type || '').toLowerCase();
  if (tensorType && tensorType !== bundledModelContract.output.type) {
    fail(`dtype output ONNX errato: ${tensorType}; atteso ${bundledModelContract.output.type}`);
  }

  // Official Depth Anything contract: predicted_depth = [batch, height, width].
  // Do not infer/transpose dimensions from the camera raster. The ONNX tensor
  // shape is authoritative and data are standard row-major within each plane.
  const dims = Array.from(tensor.dims || []).map(Number);
  if (dims.length !== 3 || dims[0] !== 1) {
    fail(`predicted_depth deve essere [1,H,W], ricevuto ${JSON.stringify(dims)}`);
  }
  const logicalHeight = Number(dims[1]);
  const logicalWidth = Number(dims[2]);
  if (!(logicalWidth > 1 && logicalHeight > 1)) {
    fail(`predicted_depth H/W non valide: ${JSON.stringify(dims)}`);
  }

  const cpu = await tensorCpuData(tensor);
  const planeLength = logicalWidth * logicalHeight;
  if (cpu.data.length !== planeLength) {
    fail(`predicted_depth con buffer incoerente: data=${cpu.data.length}, shape=[1,${logicalHeight},${logicalWidth}]`);
  }

  // Batch 0 starts at element 0. The previous generic reader used the *last*
  // plane in the buffer, which is unnecessary for this single-output model and
  // can be wrong if a runtime attaches additional storage/alignment.
  const out = new Float32Array(planeLength);
  for (let i = 0; i < planeLength; i++) {
    out[i] = scalarFromCpuBuffer(cpu.data, tensorType, i);
  }

  const expectedWidth = Number(expectedPlan?.width);
  const expectedHeight = Number(expectedPlan?.height);
  const shapeMatchesInput = logicalWidth === expectedWidth && logicalHeight === expectedHeight;
  if (!shapeMatchesInput) {
    fail(`predicted_depth HxW ${logicalHeight}x${logicalWidth} non coincide con input patch-allineato ${expectedHeight}x${expectedWidth}`);
  }

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
    layoutFix: 'official-HW-row-major',
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
    wasmSession = await runtime.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      preferredOutputLocation: 'cpu',
    });
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

async function providerABDiagnostic(d, primaryResult, { flipCheck = false } = {}) {
  const primaryQuality = depthQualityDiagnosis(primaryResult.spatialStats);
  let flipComparison = null;
  if (flipCheck) {
    try { flipComparison = await runFlipDiagnostic(d, primaryResult); }
    catch (err) { flipComparison = { comparable:false, error:err?.message || String(err) }; }
    spatialContract = assessFlipComparison(flipComparison);
  }
  const currentSpatialContract = spatialContract;
  const flipSuspicious = currentSpatialContract.suspicious === true;

  // WASM is the selected provider in Scan Test.  It needs exactly the same
  // spatial proof as WebGPU: a flipped camera frame must produce a flipped
  // depth frame after restoration.  Previously this early return skipped the
  // only test capable of detecting a coherent-looking but shuffled raster.
  if (provider !== 'webgpu') {
    providerValidated = true;
    sessionModelBytes = null;
    return {
      attempted:false,
      reason:`primary-provider-${provider}`,
      flipComparison,
      spatialContract:currentSpatialContract,
      rasterDiagnosis:{
        verdict:flipSuspicious ? 'spatial-contract-failed' : 'wasm-structured',
        primaryStripe:primaryQuality.stripe,
        primaryCoherence:primaryQuality.coherenceRatio,
      },
      primary:{ ms:primaryResult.steadyMs, stripe:primaryQuality.stripe, coherenceRatio:primaryQuality.coherenceRatio },
    };
  }
  const primarySuspicious = primaryQuality.suspicious || flipSuspicious;

  // Healthy maps stay on WebGPU without creating a second runtime/session.
  if (!primarySuspicious) {
    providerValidated = true;
    sessionModelBytes = null;
    return {
      attempted:false,
      reason:'webgpu-quality-ok',
      rasterDiagnosis:{ verdict:'webgpu-structured', primaryStripe:primaryQuality.stripe, primaryCoherence:primaryQuality.coherenceRatio },
      flipComparison,
      spatialContract:currentSpatialContract,
      webgpu:{ ms:primaryResult.steadyMs, stripe:primaryQuality.stripe, coherenceRatio:primaryQuality.coherenceRatio },
    };
  }
  try {
    const wasm = await runWasmDiagnostic(d, primaryResult);
    const comparison = compareDepthMaps(primaryResult.rawDepth, wasm.rawDepth);
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
        verdict:flipSuspicious ? 'spatial-contract-failed' : webgpuLikelyCorrupt?'webgpu-corrupt-use-wasm':'provider-difference-not-conclusive',
        primaryStripe:primaryQuality.stripe,
        primaryCoherence:primaryQuality.coherenceRatio,
        referenceStripe:wasmQuality.stripe,
        referenceCoherence:wasmQuality.coherenceRatio,
      },
      flipComparison,
      spatialContract:currentSpatialContract,
      webgpu: { ms: primaryResult.steadyMs, summary: finiteSummary(primaryResult.rawDepth), stripe:primaryQuality.stripe, coherenceRatio:primaryQuality.coherenceRatio },
      wasm: { ms: wasm.steadyMs, loadMs: wasm.loadMs, summary: wasm.summary, stripe: wasmQuality.stripe, coherenceRatio:wasmQuality.coherenceRatio, spatialStats:wasm.spatialStats, depthSignature: sampledFloatSignature(wasm.rawDepth, wasm.width, wasm.height) },
      comparison,
      wasmPreviewDepth: wasm.rawDepth,
      wasmPreviewWidth: wasm.width,
      wasmPreviewHeight: wasm.height,
    };
  } catch (err) {
    sessionModelBytes = null;
    return { attempted: true, failed: true, message: err?.message || String(err), flipComparison, spatialContract:currentSpatialContract };
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
  const firstRescue = positiveNumber(cfg.qualityRescueShortSide, 518);
  const maxRescue = positiveNumber(cfg.qualityMaxRescueShortSide, 518);
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
      // First structurally healthy raster wins. Avoid paying 518px after a good
      // 392px map, keeping the steady-state mobile profile as light as possible.
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

        // The normal pass is deliberately single-shot.  The caller adds one
        // flip-equivalence pass only for the explicit preflight or a fresh
        // session whose spatial raster contract has not yet been proven.
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


function correlationFields(d){
  return {
    frameId:d?.frameId==null?null:String(d.frameId),
    frameAt:Number.isFinite(Number(d?.frameAt))?Number(d.frameAt):null,
    refId:d?.refId==null?null:String(d.refId),
    sourceWidth:Number(d?.width)||null,
    sourceHeight:Number(d?.height)||null,
  };
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
    // This test page deliberately defaults to the deterministic provider.
    // The flag is explicit so a diagnostic export tells us whether a result
    // came from WASM rather than merely assuming it from browser capabilities.
    forceWasm = d.config?.forceWasm === true;
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
        postMessage({ type:'deep-preview-queued', jobId:d.jobId || null, ...correlationFields(d) });
      } else if (!queuedPriorityInfer) {
        queuedPriorityInfer = d;
        postMessage({ type:'deep-queued', jobId:d.jobId || null, ...correlationFields(d) });
      }
      return;
    }
    postMessage({
      type: 'deep-error',
      jobId: d.jobId || null,
      ...correlationFields(d),
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
    // same provider therefore climbs 336 -> 392 -> 518 only while the structural
    // quality gate remains suspicious, before paying for a second WASM runtime.
    const resolutionRescue = await maybeResolutionRescue(d, firstRaw);
    const raw = resolutionRescue.result;
    // Shape and local smoothness cannot prove that raster coordinates survived
    // the camera -> NCHW -> ONNX -> HxW path.  Test that once per session (and
    // always on the explicit preflight): flip the source, infer it, restore the
    // output and require the same depth field.  This applies to WASM too.
    const needSpatialContract = d.type === 'test' || !spatialContract.verified;
    const diagnostic = needSpatialContract
      ? await providerABDiagnostic(d, raw, { flipCheck:true })
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
    const depthQuality = depthQualityDiagnosis(finalSpatialStats || {});
    const finalSpatialContract = diagnostic?.spatialContract || spatialContract;
    const finalQuality = {
      ...depthQuality,
      spatialContract:finalSpatialContract,
      suspicious:depthQuality.suspicious || finalSpatialContract?.suspicious === true,
    };
    const qualityVerdict = finalSpatialContract?.suspicious
      ? 'spatial-contract-failed'
      : finalQuality.suspicious
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
      ...correlationFields(d),
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
      modelContract:bundledModelContract,
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
      ...correlationFields(d),
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
