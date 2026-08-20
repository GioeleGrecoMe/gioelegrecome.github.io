/*
 * Room Scanner V30.18.1 - Local ONNX Depth Anything worker.
 *
 * Fix in this revision:
 * ONNX Runtime Web exposes `inputMetadata` / `outputMetadata` as arrays of
 * ValueMetadata entries. The previous V30.18 worker indexed inputMetadata by
 * input name (session.inputMetadata[name]) and therefore reported
 * "il modello ONNX non espone un input" even after a valid session had been
 * created. This worker accepts both the current array API and older/object-like
 * layouts, and reads tensor dimensions from `shape` (with `dimensions` kept as
 * a compatibility fallback).
 *
 * The model is still selected before Scan and loaded once here. Inference stays
 * off the UI/Alva thread. The public message protocol is unchanged, so this file
 * is a drop-in replacement for workers/deep_depth_worker.js at commit 85e22d1.
 */

let cfg = {
  modelUrl: 'models/depth_anything_v2_small_q4f16.onnx',
  ortLocal: '../vendor/onnxruntime-web/ort.all.min.mjs',
  // Keep the runtime version unchanged in this minimal fix so model/runtime
  // compatibility can be diagnosed separately from the metadata bug.
  ortRemote: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.all.min.mjs',
  inputMaxSide: 518,
  // Used only when the runtime does not expose input metadata. The q4f16
  // Depth Anything V2 browser export normally accepts float32 pixel_values.
  // Inference also probes float16 automatically if float32 is rejected.
  inputType: 'float32',
};

let ort = null;
let ortSource = '';
let session = null;
let sessionKey = '';
let provider = 'unloaded';
let busy = false;

function fail(message) {
  throw new Error(message);
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeNchwShape(shape) {
  if (!Array.isArray(shape) || shape.length !== 4) {
    return null;
  }

  // Dynamic ONNX dimensions can be strings such as "height" / "width".
  // For the standard Depth Anything V2 Small processor, 518 is a safe default
  // and is divisible by the ViT patch size (14).
  return [
    positiveNumber(shape[0], 1),
    positiveNumber(shape[1], 3),
    positiveNumber(shape[2], cfg.inputMaxSide),
    positiveNumber(shape[3], cfg.inputMaxSide),
  ];
}

function metadataEntry(metadata, name, index = 0) {
  if (!metadata) return null;

  // Current ONNX Runtime Web API: readonly ValueMetadata[].
  if (Array.isArray(metadata)) {
    return metadata.find((entry) => entry?.name === name) || metadata[index] || null;
  }

  // Defensive compatibility with older/custom wrappers that exposed an object.
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

  // IMPORTANT: some onnxruntime-web builds expose inputNames/outputNames but do
  // not expose inputMetadata at runtime. That does NOT mean that the ONNX model
  // has no input. Depth Anything V2 has a documented contract:
  //   pixel_values: float tensor, NCHW [batch, 3, height, width]
  // The official processor uses 518x518. If metadata is unavailable we use that
  // contract instead of rejecting an otherwise valid session.
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
    };
  }

  // ONNX Runtime Web ValueMetadata uses `shape`. `dimensions` is retained only
  // as a compatibility fallback for older/custom runtimes.
  const rawShape = meta.shape || meta.dimensions || [1, 3, cfg.inputMaxSide, cfg.inputMaxSide];
  const dims = normalizeNchwShape(Array.from(rawShape));

  if (!dims || dims.length !== 4 || dims[1] !== 3) {
    fail(
      `input ONNX non supportato: name=${name}, type=${meta.type || 'unknown'}, ` +
      `shape=${JSON.stringify(rawShape)}`,
    );
  }

  return {
    name,
    type: String(meta.type || cfg.inputType || 'float32').toLowerCase(),
    dims,
    width: dims[3],
    height: dims[2],
    rawShape: Array.from(rawShape),
    metadataAvailable: true,
    contractFallback: false,
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
  if (x < 6.103515625e-5) {
    return sign | Math.round(x / 5.960464477539063e-8);
  }
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

  const sources = [cfg.ortLocal, cfg.ortRemote].filter(Boolean);
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

  const runtime = await importOrt();
  try {
    runtime.env.wasm.numThreads = 1;
    runtime.env.wasm.simd = true;
  } catch {
    // Some builds do not expose all WASM env flags. Inference can still work.
  }

  if (session) {
    try {
      await session.release?.();
    } catch {
      // Release is best-effort when changing model/provider.
    }
    session = null;
    sessionKey = '';
  }

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

      // This is the point where the old worker failed even for a valid model.
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
        },
        output,
        model: source?.label || sourceKey,
      });

      return session;
    } catch (err) {
      errors.push(`${executionProviders.join('+')}: ${err?.message || err}`);
      try {
        await session?.release?.();
      } catch {
        // Ignore cleanup errors while trying the next execution provider.
      }
      session = null;
      sessionKey = '';
    }
  }

  fail(`creazione/sessione ONNX fallita. ${errors.join(' | ')}`);
}

function prepareInput(rgba, width, height, spec, forcedType = null) {
  if (typeof OffscreenCanvas === 'undefined') {
    fail('OffscreenCanvas non disponibile');
  }

  const source = new OffscreenCanvas(width, height);
  const sctx = source.getContext('2d', { alpha: false });
  const target = new OffscreenCanvas(spec.width, spec.height);
  const tctx = target.getContext('2d', { alpha: false });
  if (!sctx || !tctx) fail('canvas 2D non disponibile nel worker');

  const image = sctx.createImageData(width, height);
  image.data.set(rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba));
  sctx.putImageData(image, 0, 0);
  tctx.drawImage(source, 0, 0, spec.width, spec.height);

  const pixels = tctx.getImageData(0, 0, spec.width, spec.height).data;
  const n = spec.width * spec.height;
  const tensorType = String(forcedType || spec.type || 'float32').toLowerCase();
  const float16Input = tensorType.includes('float16');
  const values = float16Input ? new Uint16Array(n * 3) : new Float32Array(n * 3);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = (pixels[i * 4 + c] / 255 - mean[c]) / std[c];
      const j = c * n + i;
      values[j] = float16Input ? toFloat16(v) : v;
    }
  }

  return new ort.Tensor(float16Input ? 'float16' : 'float32', values, spec.dims);
}

function readOutput(result) {
  const outputNames = Array.from(session?.outputNames || []);
  const name = outputNames[0];
  const tensor = result?.[name] || result?.[Object.keys(result || {})[0]];

  if (!tensor?.data?.length) {
    fail(`il modello non ha restituito una depth map; outputNames=${JSON.stringify(outputNames)}`);
  }

  const dims = tensor.dims || [];
  const height = Number(dims[dims.length - 2]);
  const width = Number(dims[dims.length - 1]);

  if (!(width > 1 && height > 1 && width * height <= tensor.data.length)) {
    fail(`output ONNX non supportato: ${JSON.stringify(dims)}`);
  }

  const src = tensor.data;
  const offset = src.length - width * height;
  const out = new Float32Array(width * height);

  for (let i = 0; i < out.length; i++) {
    out[i] = src instanceof Uint16Array ? fromFloat16(src[offset + i]) : Number(src[offset + i]);
  }

  return { rawDepth: out, width, height };
}

async function infer(d) {
  if (!d.rgba?.length || !(d.width > 1 && d.height > 1)) {
    fail('fotogramma RGBA non valido');
  }

  await ensureSession(d.model);
  const spec = inputSpec();

  // If metadata exists, trust the declared tensor type. If metadata is absent,
  // probe float32 first (the standard Depth Anything V2 JS preprocessing path)
  // and then float16. This converts a runtime API limitation into a one-time
  // compatibility probe instead of a false "model has no input" failure.
  const typeCandidates = spec.metadataAvailable
    ? [spec.type]
    : Array.from(new Set([spec.type || 'float32', 'float32', 'float16']));
  const errors = [];

  for (const tensorType of typeCandidates) {
    try {
      const feeds = {
        [spec.name]: prepareInput(d.rgba, d.width, d.height, spec, tensorType),
      };
      const result = await session.run(feeds);
      const output = readOutput(result);
      output.inputType = tensorType;
      output.inputDims = spec.dims;
      output.contractFallback = !!spec.contractFallback;
      return output;
    } catch (err) {
      errors.push(`${tensorType}: ${err?.message || err}`);
    }
  }

  fail(
    `inferenza ONNX fallita per ${spec.name} ${JSON.stringify(spec.dims)}. ` +
    `Tentativi tipo input: ${errors.join(' | ')}`,
  );
}

self.onmessage = async (event) => {
  const d = event.data || {};

  if (d.type === 'init') {
    cfg = { ...cfg, ...(d.config || {}) };
    postMessage({ type: 'deep-ready', provider, modelUrl: cfg.modelUrl });
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
  const started = performance.now();

  try {
    if (d.type === 'load') {
      await ensureSession(d.model);
      postMessage({
        type: 'deep-load-result',
        ok: true,
        provider,
        runtime: ortSource,
        model: d.model?.label || d.model?.url || cfg.modelUrl,
        ms: performance.now() - started,
      });
      return;
    }

    const raw = await infer(d);
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
        contractFallback: !!raw.contractFallback,
        ms: performance.now() - started,
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
      ms: performance.now() - started,
    });
  } finally {
    busy = false;
  }
};
