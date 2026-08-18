/*
 * Room Scanner V20.1.0 - batch-only Depth Anything V2 worker
 * ------------------------------------------------------
 * The worker is intentionally created only after WebXR has ended and after
 * the V20.1 same-document post-XR handoff. This prevents ARCore, Raw Camera buffers and the XR WebGL context from
 * overlapping the ONNX batch, without forcing a fragile mobile page reload.
 *
 * The application shell is tiny. On the first Deep run this worker downloads
 * ONNX Runtime Web plus the Apache-2.0 Depth Anything V2 Small quantized model.
 * The model bytes are cached in IndexedDB, so subsequent runs can reuse them.
 * A deployment can be fully offline by placing the same files under vendor/
 * and models/; the local URLs are always attempted before the remote URLs.
 */
'use strict';

let ortRuntime = null;
let session = null;
let inputName = null;
let outputName = null;
let inputWidth = 336;
let inputHeight = 336;
let requestedInputSize = 336;
let dynamicSpatialInput = false;
let activeModelKey = null;

// Keep the established cache name so users upgrading from V15 do not need to
// download the same model again. The database stores only model bytes, not a
// scanner-state schema, therefore it is safe to share across releases.
const DB_NAME = 'room-scanner-v15-ai';
const DB_VERSION = 1;
const STORE_NAME = 'models';

function postProgress(detail, stage = 'loading') {
  self.postMessage({ type: 'progress', stage, detail });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!self.indexedDB) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB non disponibile'));
  });
}

async function cacheGet(key) {
  try {
    const database = await openDatabase();
    if (!database) return null;
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  } catch {
    return null;
  }
}

async function cachePut(key, buffer) {
  try {
    const database = await openDatabase();
    if (!database) return;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(buffer, key);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // Cache failures are non-fatal. The browser HTTP cache may still help.
  }
}

async function fetchArrayBuffer(url, label) {
  postProgress(`${label}: download`, 'download');
  const response = await fetch(url, { cache: 'force-cache', mode: 'cors' });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !length) return response.arrayBuffer();

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    postProgress(`${label}: ${Math.round(received / length * 100)}%`, 'download');
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

async function loadRuntime(runtimeVersion, runtimeLocal, runtimeRemote) {
  if (ortRuntime) return ortRuntime;
  const candidates = [
    runtimeLocal || './vendor/onnxruntime-web/ort.min.js',
    runtimeRemote || `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/ort.min.js`,
  ];
  let lastError = null;
  for (const url of candidates) {
    try {
      postProgress(`Runtime ONNX: ${url.startsWith('.') ? 'locale' : 'CDN'}`, 'runtime');
      importScripts(url);
      if (!self.ort) throw new Error('La libreria ONNX non ha esposto ort');
      ortRuntime = self.ort;
      const base = url.slice(0, url.lastIndexOf('/') + 1);
      ortRuntime.env.wasm.wasmPaths = base;
      ortRuntime.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.max(1, Math.min(2, self.navigator?.hardwareConcurrency || 2))
        : 1;
      ortRuntime.env.wasm.simd = true;
      return ortRuntime;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`ONNX Runtime non caricabile: ${lastError?.message || lastError}`);
}

async function loadModelBuffer(localUrl, remoteUrls) {
  const candidates = [localUrl, ...(remoteUrls || [])].filter(Boolean);
  let lastError = null;
  for (const url of candidates) {
    const key = `depth-anything-v2-small:${url}`;
    const cached = await cacheGet(key);
    if (cached instanceof ArrayBuffer && cached.byteLength > 1_000_000) {
      postProgress('Modello Deep recuperato dalla cache locale', 'cache');
      activeModelKey = key;
      return cached;
    }
    try {
      const buffer = await fetchArrayBuffer(url, 'Depth Anything V2 Small');
      if (buffer.byteLength < 1_000_000) throw new Error('file modello troppo piccolo');
      activeModelKey = key;
      postProgress('Salvataggio modello nella cache locale', 'cache');
      await cachePut(key, buffer.slice(0));
      return buffer;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Modello Deep non disponibile: ${lastError?.message || lastError}`);
}

function numericDimension(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function initialize(payload) {
  if (session) {
    return {
      inputName,
      outputName,
      inputWidth,
      inputHeight,
      dynamicSpatialInput,
      modelKey: activeModelKey,
      reused: true,
    };
  }
  const runtimeVersion = payload.runtimeVersion || '1.23.2';
  await loadRuntime(runtimeVersion, payload.runtimeLocal, payload.runtimeRemote);
  requestedInputSize = Math.max(140, Math.round((payload.inputSize || 336) / 14) * 14);
  inputWidth = requestedInputSize;
  inputHeight = requestedInputSize;
  const modelBuffer = await loadModelBuffer(payload.modelLocal, payload.modelRemoteUrls);
  postProgress('Creazione sessione ONNX WASM', 'session');
  session = await ortRuntime.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    executionMode: 'sequential',
    enableCpuMemArena: true,
    enableMemPattern: true,
  });
  inputName = session.inputNames[0];
  outputName = session.outputNames[0];
  // ONNX Runtime Web exposes inputMetadata as an array aligned with
  // inputNames. Some older builds also exposed a name-keyed object, so support
  // both shapes. Reading it only by inputName silently returned undefined on
  // current ORT and caused static 518 x 518 models to receive the wrong tensor.
  const metadataCollection = session.inputMetadata;
  const metadata = Array.isArray(metadataCollection)
    ? metadataCollection[0]
    : metadataCollection?.[inputName] || metadataCollection?.[0];
  const dimensions = metadata?.shape || metadata?.dimensions || metadata?.dims || [];
  if (dimensions.length >= 4) {
    const declaredHeight = dimensions[dimensions.length - 2];
    const declaredWidth = dimensions[dimensions.length - 1];
    const fixedHeight = numericDimension(declaredHeight, NaN);
    const fixedWidth = numericDimension(declaredWidth, NaN);
    dynamicSpatialInput = !(Number.isFinite(fixedHeight) && Number.isFinite(fixedWidth));
    if (!dynamicSpatialInput) {
      inputHeight = fixedHeight;
      inputWidth = fixedWidth;
    }
  }
  const shapeLabel = dynamicSpatialInput
    ? `dinamico, lato lungo ${requestedInputSize}`
    : `${inputWidth} x ${inputHeight}`;
  postProgress(`Deep pronto: ${shapeLabel}`, 'ready');
  return {
    inputName,
    outputName,
    inputWidth,
    inputHeight,
    dynamicSpatialInput,
    modelKey: activeModelKey,
    reused: false,
  };
}

function bilinearChannel(rgba, sourceWidth, sourceHeight, sourceX, sourceY, channel) {
  const x0 = Math.max(0, Math.min(sourceWidth - 1, Math.floor(sourceX)));
  const y0 = Math.max(0, Math.min(sourceHeight - 1, Math.floor(sourceY)));
  const x1 = Math.min(sourceWidth - 1, x0 + 1);
  const y1 = Math.min(sourceHeight - 1, y0 + 1);
  const fx = sourceX - x0;
  const fy = sourceY - y0;
  const a = rgba[4 * (y0 * sourceWidth + x0) + channel];
  const b = rgba[4 * (y0 * sourceWidth + x1) + channel];
  const c = rgba[4 * (y1 * sourceWidth + x0) + channel];
  const d = rgba[4 * (y1 * sourceWidth + x1) + channel];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function inferenceShape(sourceWidth, sourceHeight) {
  if (!dynamicSpatialInput) return { width: inputWidth, height: inputHeight };
  const scale = requestedInputSize / Math.max(sourceWidth, sourceHeight);
  const width = Math.max(14, Math.round(sourceWidth * scale / 14) * 14);
  const height = Math.max(14, Math.round(sourceHeight * scale / 14) * 14);
  return { width, height };
}

function preprocessRGBA(rgba, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const plane = targetWidth * targetHeight;
  const tensorData = new Float32Array(3 * plane);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * sourceHeight / targetHeight - 0.5;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * sourceWidth / targetWidth - 0.5;
      const index = y * targetWidth + x;
      for (let channel = 0; channel < 3; channel += 1) {
        const normalized = bilinearChannel(rgba, sourceWidth, sourceHeight, sourceX, sourceY, channel) / 255;
        tensorData[channel * plane + index] = (normalized - mean[channel]) / std[channel];
      }
    }
  }
  return tensorData;
}

async function infer(payload) {
  if (!session) throw new Error('Deep non inizializzato');
  const rgba = new Uint8ClampedArray(payload.rgba);
  if (rgba.byteLength !== payload.width * payload.height * 4) throw new Error('Buffer RGBA non coerente');
  const shape = inferenceShape(payload.width, payload.height);
  const inputData = preprocessRGBA(rgba, payload.width, payload.height, shape.width, shape.height);
  const tensor = new ortRuntime.Tensor('float32', inputData, [1, 3, shape.height, shape.width]);
  const started = performance.now();
  const results = await session.run({ [inputName]: tensor });
  const output = results[outputName] || results[session.outputNames[0]];
  if (!output?.data) throw new Error('Output Deep assente');
  const dimensions = output.dims || [];
  const outputHeight = dimensions.length >= 2 ? dimensions[dimensions.length - 2] : shape.height;
  const outputWidth = dimensions.length >= 1 ? dimensions[dimensions.length - 1] : shape.width;
  const depth = output.data instanceof Float32Array
    ? new Float32Array(output.data)
    : Float32Array.from(output.data);
  return {
    depth: depth.buffer,
    outputWidth,
    outputHeight,
    inferenceMs: performance.now() - started,
  };
}

self.onmessage = async event => {
  const message = event.data || {};
  const id = message.id;
  try {
    if (message.type === 'init') {
      const result = await initialize(message);
      self.postMessage({ id, ok: true, ...result });
      return;
    }
    if (message.type === 'smoke') {
      self.postMessage({
        id,
        ok: true,
        outputWidth: inputWidth,
        outputHeight: inputHeight,
        inputName,
        outputName,
      });
      return;
    }
    if (message.type === 'infer') {
      const result = await infer(message);
      self.postMessage({ id, ok: true, ...result }, [result.depth]);
      return;
    }
    throw new Error(`Messaggio worker sconosciuto: ${message.type}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
