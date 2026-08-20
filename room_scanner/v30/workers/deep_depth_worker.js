/*
 * Room Scanner V30.18.3 - Local ONNX Depth Anything worker.
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
  modelUrl: 'models/depth_anything_v2_small_q4f16.onnx',
  ortLocal: '../vendor/onnxruntime-web/ort.all.min.mjs',
  // Keep the project-configured runtime only as a last-resort compatibility fallback.
  ortRemote: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.all.min.mjs',
  ortCurrentWebGpu: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.webgpu.min.mjs',
  ortCurrentAll: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.all.min.mjs',

  // Compatibility ceiling/fallback used by the existing V30 config.
  inputMaxSide: 518,

  // Mobile inference target.  168 is 12 * 14.  A 320x480 frame therefore
  // becomes 168x252 (18 * 14) without changing its 2:3 aspect ratio.
  // Depth is a geometric prior here; Alva + multi-view verification retain
  // metric/structural authority, so this lower raster is a good speed tradeoff.
  preferredShortSide: 168,
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

function inputSpec() {
  if (!session) fail('sessione ONNX non inizializzata');

  const inputNames = Array.from(session.inputNames || []);
  const name = inputNames[0];
  if (!name) {
    fail(`il modello ONNX non espone nomi di input (inputNames=${JSON.stringify(inputNames)})`);
  }

  const meta = metadataEntry(session.inputMetadata, name, 0);

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

function outputDebugSpec() {
  if (!session) return null;
  const outputNames = Array.from(session.outputNames || []);
  const name = outputNames[0] || null;
  const meta = name ? metadataEntry(session.outputMetadata, name, 0) : null;
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

async function fetchModel(source) {
  if (source?.bytes) return source.bytes;
  const url = source?.url || cfg.modelUrl;
  if (!url) fail('nessun modello ONNX selezionato');

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) fail(`modello ONNX non leggibile: HTTP ${response.status}`);
  return response.arrayBuffer();
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
  const providerAttempts = globalThis.navigator?.gpu
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

  const preferred = positiveNumber(cfg.preferredShortSide, 168);
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
function prepareInput(rgba, width, height, spec, plan, forcedType = null) {
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
    tensor: new ort.Tensor(float16Input ? 'float16' : 'float32', values, dims),
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

function readOutput(result, expectedPlan) {
  const outputNames = Array.from(session?.outputNames || []);
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

async function runPrepared(spec, prepared) {
  const runStarted = performance.now();
  const result = await session.run({ [spec.name]: prepared.tensor });
  const runMs = performance.now() - runStarted;

  const outputStarted = performance.now();
  const output = readOutput(result, prepared.plan);
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

async function infer(d, { benchmark = false } = {}) {
  if (!d.rgba?.length || !(d.width > 1 && d.height > 1)) {
    fail('fotogramma RGBA non valido');
  }

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

self.onmessage = async (event) => {
  const d = event.data || {};

  if (d.type === 'init') {
    cfg = { ...cfg, ...(d.config || {}) };
    postMessage({
      type: 'deep-ready',
      provider,
      modelUrl: cfg.modelUrl,
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
    });
    return;
  }

  if (!['load', 'test', 'infer'].includes(d.type)) return;

  if (busy) {
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

    // Backward compatibility: app.js already renders `result.ms`.  From this
    // revision it intentionally means STEADY inference latency rather than cold
    // model/session setup.  `totalMs` preserves the complete wall-clock value.
    postMessage(
      {
        type: d.type === 'test' ? 'deep-test-result' : 'deep-result',
        jobId: d.jobId || null,
        refId: d.refId || null,
        provider,
        runtime: ortSource,
        rawDepth: raw.rawDepth,
        rawWidth: raw.width,
        rawHeight: raw.height,
        inputType: raw.inputType || null,
        inputDims: raw.inputDims || null,
        inputPlan: raw.inputPlan || null,
        outputName: raw.outputName || null,
        outputDims: raw.outputDims || null,
        outputType: raw.outputType || null,
        layoutFix: raw.layoutFix || 'none',
        spatialStats: raw.spatialStats || null,
        rasterContract: 'RGBA-row-major-interleaved -> RGB-NCHW-planar',
        rasterProbe: raw.rasterProbe || null,
        contractFallback: !!raw.contractFallback,
        benchmarkWarm: !!raw.benchmarkWarm,
        preprocessMs: raw.preprocessMs,
        runMs: raw.runMs,
        outputMs: raw.outputMs,
        coldRunMs: raw.coldRunMs,
        coldSteadyMs: raw.coldSteadyMs,
        sessionMs: raw.sessionMs,
        sessionLoadMs: raw.sessionLoadMs,
        ms: raw.steadyMs,
        totalMs: performance.now() - totalStarted,
      },
      [raw.rawDepth.buffer],
    );
  } catch (err) {
    postMessage({
      type: 'deep-error',
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
  }
};
