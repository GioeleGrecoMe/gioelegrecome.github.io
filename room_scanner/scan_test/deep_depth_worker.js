/*
 * Scan Test v3.2.1 - Depth Anything V2 reference path.
 *
 * Deliberately no hand-written ONNX tensor packing, output reshaping or WebGPU.
 * The official Transformers.js depth-estimation pipeline owns the
 * DPTImageProcessor + ONNX Runtime contract. This removes the two places where
 * the previous implementation could turn valid RGB into apparently-random
 * depth while still returning finite numbers.
 */

let config = null;
let api = null;
let pipe = null;
let loadPromise = null;
let spatialValidation = null;
let inferenceCounter = 0;

const PROVIDER = 'transformers.js-wasm-q4';
const MODEL_CONTRACT = Object.freeze({
  model: 'onnx-community/depth-anything-v2-small',
  dtype: 'q4',
  input: { name: 'pixel_values', type: 'float32', layout: 'owned-by-DPTImageProcessor' },
  output: { name: 'predicted_depth', type: 'float32', layout: '[...,H,W]' },
  processor: {
    type: 'DPTImageProcessor', size: [518, 518], keepAspectRatio: true,
    ensureMultipleOf: 14, resample: 'bicubic', rescaleFactor: 1 / 255,
    mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225],
  },
});

function post(type, data = {}, transfer = undefined) {
  const message = { type, ...data };
  if (transfer?.length) self.postMessage(message, transfer); else self.postMessage(message);
}
function diag(event, message, data = null, level = 'info') { post('deep-diag', { event, message, data, level }); }
function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function percentileSorted(sorted, p) {
  if (!sorted.length) return NaN;
  const x = clamp(p, 0, 1) * (sorted.length - 1), a = Math.floor(x), b = Math.ceil(x), t = x - a;
  return sorted[a] * (1 - t) + sorted[b] * t;
}
function finiteStats(data) {
  const finite = [];
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Number(data[i]);
    if (!Number.isFinite(v)) continue;
    finite.push(v); min = Math.min(min, v); max = Math.max(max, v); sum += v;
  }
  finite.sort((a, b) => a - b);
  const p01 = percentileSorted(finite, .01), p50 = percentileSorted(finite, .5), p99 = percentileSorted(finite, .99);
  return { finite: finite.length, finiteRatio: data.length ? finite.length / data.length : 0, min, max, mean: finite.length ? sum / finite.length : NaN, p01, p50, p99, robustRange: p99 - p01 };
}
function spatialStats(data, width, height) {
  const step = Math.max(1, Math.floor(Math.max(width, height) / 160));
  let local = 0, far = 0, nl = 0, nf = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const a = data[y * width + x]; if (!Number.isFinite(a)) continue;
      if (x + step < width) { const b = data[y * width + x + step]; if (Number.isFinite(b)) { local += Math.abs(a - b); nl++; } }
      if (y + step < height) { const b = data[(y + step) * width + x]; if (Number.isFinite(b)) { local += Math.abs(a - b); nl++; } }
      const fx = width - 1 - x, fy = height - 1 - y, b = data[fy * width + fx];
      if (Number.isFinite(b)) { far += Math.abs(a - b); nf++; }
    }
  }
  const meanNeighborDiff = nl ? local / nl : NaN, meanFarDiff = nf ? far / nf : NaN;
  return { meanNeighborDiff, meanFarDiff, coherenceRatio: meanNeighborDiff > 0 ? meanFarDiff / meanNeighborDiff : NaN };
}
function fnvDepth(data) {
  let h = 2166136261 >>> 0;
  const n = Math.min(257, data.length);
  for (let k = 0; k < n; k++) {
    const i = Math.floor(k * Math.max(0, data.length - 1) / Math.max(1, n - 1));
    const v = Math.fround(Number(data[i]) || 0);
    const a = new Uint32Array(new Float32Array([v]).buffer)[0];
    h ^= a; h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
function rgbaSignature(rgba) {
  let h = 2166136261 >>> 0; const pixels = Math.floor(rgba.length / 4), n = Math.min(193, pixels);
  for (let k = 0; k < n; k++) {
    const p = Math.floor(k * Math.max(0, pixels - 1) / Math.max(1, n - 1)) * 4;
    h ^= rgba[p]; h = Math.imul(h, 16777619) >>> 0;
    h ^= rgba[p + 1]; h = Math.imul(h, 16777619) >>> 0;
    h ^= rgba[p + 2]; h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
function flipRgbaHorizontal(rgba, width, height) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (y * width + x) * 4, dst = (y * width + (width - 1 - x)) * 4;
    out[dst] = rgba[src]; out[dst + 1] = rgba[src + 1]; out[dst + 2] = rgba[src + 2]; out[dst + 3] = rgba[src + 3];
  }
  return out;
}
function flipDepthHorizontal(data, width, height) {
  const out = new Float32Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + (width - 1 - x)] = data[y * width + x];
  return out;
}
function pearson(a, b) {
  const n = Math.min(a.length, b.length); if (n < 16) return { correlation: NaN, samples: 0, normalizedMae: NaN };
  const stride = Math.max(1, Math.floor(n / 12000));
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, count = 0;
  const av = [], bv = [];
  for (let i = 0; i < n; i += stride) {
    const x = Number(a[i]), y = Number(b[i]); if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; count++; av.push(x); bv.push(y);
  }
  if (count < 16) return { correlation: NaN, samples: count, normalizedMae: NaN };
  const cov = sxy - sx * sy / count, vx = sxx - sx * sx / count, vy = syy - sy * sy / count;
  const correlation = vx > 1e-12 && vy > 1e-12 ? cov / Math.sqrt(vx * vy) : NaN;
  // Affine-normalized MAE is useful because monocular relative depth may shift/scale.
  const mx = sx / count, my = sy / count, sigx = Math.sqrt(Math.max(vx / count, 1e-12)), sigy = Math.sqrt(Math.max(vy / count, 1e-12));
  let mae = 0; for (let i = 0; i < av.length; i++) mae += Math.abs((av[i] - mx) / sigx - (bv[i] - my) / sigy);
  return { correlation, samples: count, normalizedMae: mae / count };
}
function tensorToDepth(tensor) {
  if (!tensor) throw new Error('La pipeline non ha restituito predicted_depth.');
  const dims = Array.from(tensor.dims || tensor.shape || [], Number);
  const source = tensor.data ?? tensor.cpuData;
  if (!source || !source.length) throw new Error(`predicted_depth non contiene dati CPU leggibili (dims=${JSON.stringify(dims)}).`);
  const data = source instanceof Float32Array ? new Float32Array(source) : Float32Array.from(source, Number);
  let height, width;
  if (dims.length >= 2) { height = dims[dims.length - 2]; width = dims[dims.length - 1]; }
  if (!(width > 1 && height > 1 && width * height <= data.length)) throw new Error(`Shape predicted_depth non interpretabile: ${JSON.stringify(dims)}, ${data.length} valori.`);
  const n = width * height;
  return { data: data.length === n ? data : data.slice(data.length - n), width, height, dims };
}
async function ensurePipeline() {
  if (pipe) return pipe;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!config) throw new Error('Worker Deep non inizializzato.');
    diag('engine-load-start', 'Carico Transformers.js e la pipeline Depth Anything V2 ufficiale.', { transformersUrl: config.transformersUrl, device: config.device, dtype: config.dtype });
    api = await import(config.transformersUrl);
    const { env, pipeline } = api;
    if (!env || !pipeline || !api.RawImage) throw new Error('Modulo Transformers.js incompleto: mancano env/pipeline/RawImage.');
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = config.localModelBase.endsWith('/') ? config.localModelBase : `${config.localModelBase}/`;
    env.useBrowserCache = true;
    if (env.backends?.onnx?.wasm) {
      // One thread avoids SharedArrayBuffer/cross-origin-isolation surprises on Android.
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
    }
    const t0 = now();
    pipe = await pipeline('depth-estimation', config.localModelId, {
      dtype: config.dtype || 'q4', device: config.device || 'wasm', local_files_only: true,
      progress_callback: p => {
        if (!p) return;
        const pct = Number.isFinite(p.progress) ? Math.round(p.progress) : null;
        post('deep-download-progress', { label: p.file ? `Deep: ${p.file}` : 'Deep: caricamento modello', pct, received: p.loaded || 0, total: p.total || 0 });
      },
    });
    diag('engine-load-complete', 'Pipeline depth-estimation pronta.', { ms: Math.round(now() - t0), modelId: config.localModelId });
    post('deep-ready', { engine: 'Transformers.js depth-estimation', modelId: config.localModelId, provider: PROVIDER, modelRaster: 'DPTImageProcessor 518, aspect-preserving' });
    return pipe;
  })();
  try { return await loadPromise; } catch (err) { loadPromise = null; pipe = null; throw err; }
}

async function inferOne(rgba, width, height) {
  const estimator = await ensurePipeline();
  const input = new api.RawImage(new Uint8ClampedArray(rgba), width, height, 4);
  const t0 = now();
  const result = await estimator(input);
  const elapsed = now() - t0;
  const raw = tensorToDepth(result?.predicted_depth);
  return { ...raw, elapsed, processedDepth: result?.depth || null };
}

async function validateSpatial(rgba, width, height, original) {
  const flipped = flipRgbaHorizontal(rgba, width, height);
  const second = await inferOne(flipped, width, height);
  if (second.width !== original.width || second.height !== original.height) {
    return { verified: false, reason: `flip shape diversa ${second.width}×${second.height} vs ${original.width}×${original.height}`, comparison: { correlation: NaN, samples: 0, normalizedMae: NaN } };
  }
  const back = flipDepthHorizontal(second.data, second.width, second.height);
  const comparison = pearson(original.data, back);
  // This is a corruption detector, not an accuracy metric. Use a permissive
  // threshold so ordinary interpolation/border asymmetry does not reject valid depth.
  const verified = Number.isFinite(comparison.correlation) && comparison.correlation >= .65 && comparison.samples >= 100;
  return { verified, reason: verified ? 'flip-equivariance superata' : `flip-equivariance insufficiente (r=${Number(comparison.correlation).toFixed(3)})`, comparison, secondMs: second.elapsed };
}

async function handleInference(message) {
  const { jobId, rgba, width, height, frameId = null, refId = null } = message;
  if (!(width > 1 && height > 1)) throw new Error(`Dimensioni RGB non valide: ${width}×${height}`);
  const pixels = width * height;
  const input = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  if (input.length !== pixels * 4) throw new Error(`RGBA non contiguo: ${input.length} byte per ${width}×${height}, attesi ${pixels * 4}.`);
  const total0 = now();
  const original = await inferOne(input, width, height);
  const stats = finiteStats(original.data), spatial = spatialStats(original.data, original.width, original.height);
  inferenceCounter++;
  // A full mirrored second inference is expensive on a phone, but the gate must
  // never be skipped entirely. Validate every explicit test, the first real
  // inference, and then periodically during a batch so a later runtime/backend
  // corruption cannot silently turn into geometry.
  const validateNow = message.type === 'test' || !spatialValidation || spatialValidation.verified !== true || (inferenceCounter % 4 === 0);
  if (validateNow) spatialValidation = await validateSpatial(input, width, height, original);
  const comparison = spatialValidation?.comparison || null;
  const numericBad = stats.finiteRatio < .999 || !(stats.robustRange > 1e-7);
  const suspicious = numericBad || spatialValidation?.verified !== true;
  const quality = {
    suspicious,
    finiteRatio: stats.finiteRatio,
    robustRange: stats.robustRange,
    coherenceRatio: spatial.coherenceRatio,
    spatialContract: { verified: spatialValidation?.verified === true, reason: spatialValidation?.reason || 'non verificato', comparison, validatedOnThisFrame: validateNow },
    stripe: { orientation: 'not-used', dominantExplained: 0, dominantCycles: 0, ratio: 0 },
  };
  const response = {
    type: message.type === 'test' ? 'deep-test-result' : 'deep-result', jobId, frameId, refId,
    engine: 'Transformers.js depth-estimation', modelId: config.localModelId, provider: PROVIDER, runtime: 'onnxruntime-web via Transformers.js',
    rawDepth: original.data, rawWidth: original.width, rawHeight: original.height,
    outputDims: original.dims, outputReadback: 'predicted_depth.data', outputLocation: 'WASM/CPU',
    preprocessBackend: 'official DPTImageProcessor',
    inputPlan: { mode: 'official DPTImageProcessor: 518 + keep_aspect_ratio + multiple-of-14 + bicubic', sourceWidth: width, sourceHeight: height },
    inputDims: null,
    modelContract: MODEL_CONTRACT,
    layoutFix: 'none: official pipeline owns tensor layout/output interpretation',
    totalMs: now() - total0, ms: original.elapsed,
    quality, spatialStats: spatial, flipComparison: comparison,
    rasterDiagnosis: { verdict: suspicious ? 'REJECTED: official pipeline spatial validation failed' : 'ACCEPTED: official pipeline + flip validation' },
    rasterProbe: { rgbaLength: input.length, expectedRgbaLength: pixels * 4, firstPixel: Array.from(input.slice(0, 4)), centerPixel: Array.from(input.slice((((height >> 1) * width + (width >> 1)) * 4), (((height >> 1) * width + (width >> 1)) * 4) + 4)) },
    frameSignature: rgbaSignature(input), depthSignature: fnvDepth(original.data),
  };
  if (message.type === 'test') {
    // Diagnostic preview only. It is explicitly NOT a reconstruction of the
    // internal NCHW tensor, because v3 intentionally stopped duplicating the processor.
    response.inputRasterDiagnostic = {
      sourcePreview: new Uint8ClampedArray(input), sourceWidth: width, sourceHeight: height,
      tensorNchwPreview: new Uint8ClampedArray(input), tensorWidth: width, tensorHeight: height,
    };
  }
  const transfer = [response.rawDepth.buffer];
  if (response.inputRasterDiagnostic) transfer.push(response.inputRasterDiagnostic.sourcePreview.buffer, response.inputRasterDiagnostic.tensorNchwPreview.buffer);
  post(response.type, response, transfer);
}

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type === 'init') {
    config = {
      transformersUrl: message.config?.transformersUrl || 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0',
      localModelId: message.config?.localModelId || 'depth-anything-v2-small',
      localModelBase: message.config?.localModelBase || new URL('./models/', self.location.href).href,
      dtype: 'q4', device: 'wasm',
    };
    // Start loading immediately but keep the message loop responsive. All
    // inference jobs await the same promise, so there is exactly one session.
    void ensurePipeline().catch(err => diag('engine-load-failed', err?.message || String(err), { stack: err?.stack }, 'warn'));
    return;
  }
  if (message.type !== 'test' && message.type !== 'infer') return;
  try { await handleInference(message); }
  catch (err) {
    post('deep-error', { jobId: message.jobId, frameId: message.frameId || null, refId: message.refId || null, message: err?.message || String(err), stack: err?.stack || null, provider: PROVIDER });
  }
};
