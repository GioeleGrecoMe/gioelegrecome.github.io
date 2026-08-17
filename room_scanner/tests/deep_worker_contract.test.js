'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const workerSource = fs.readFileSync(path.join(__dirname, '..', 'depth_ai_worker.js'), 'utf8');

async function runWorkerCase(shape, requestedInputSize, imageWidth, imageHeight) {
  const messages = [];
  let tensorDims = null;

  class FakeTensor {
    constructor(type, data, dims) {
      this.type = type;
      this.data = data;
      this.dims = dims;
      tensorDims = dims;
    }
  }

  const fakeSession = {
    inputNames: ['pixel_values'],
    outputNames: ['predicted_depth'],
    // This intentionally matches current ONNX Runtime Web: metadata is an
    // array aligned with inputNames, not an object keyed by the input name.
    inputMetadata: [{ isTensor: true, type: 'float32', shape }],
    async run(feeds) {
      const tensor = feeds.pixel_values;
      const height = tensor.dims[2];
      const width = tensor.dims[3];
      return {
        predicted_depth: {
          dims: [1, height, width],
          data: new Float32Array(width * height).fill(1),
        },
      };
    },
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    ArrayBuffer,
    Float32Array,
    Uint8Array,
    Uint8ClampedArray,
    Math,
    Number,
    Promise,
    performance: { now: () => 10 },
    fetch: async () => ({
      ok: true,
      status: 200,
      body: null,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(2_000_000),
    }),
    self: {
      indexedDB: null,
      crossOriginIsolated: false,
      navigator: { hardwareConcurrency: 4 },
      postMessage(message) { messages.push(message); },
    },
  };
  context.importScripts = () => {
    context.self.ort = {
      env: { wasm: {} },
      Tensor: FakeTensor,
      InferenceSession: { create: async () => fakeSession },
    };
  };
  vm.createContext(context);
  vm.runInContext(workerSource, context, { filename: 'depth_ai_worker.js' });

  await context.self.onmessage({
    data: {
      id: 'init',
      type: 'init',
      inputSize: requestedInputSize,
      runtimeLocal: './fake-runtime.js',
      modelLocal: './fake-model.onnx',
      modelRemoteUrls: [],
    },
  });
  const init = messages.find(message => message.id === 'init');
  assert(init?.ok, init?.error || 'worker init failed');

  const rgba = new Uint8ClampedArray(imageWidth * imageHeight * 4).fill(128);
  await context.self.onmessage({
    data: {
      id: 'infer',
      type: 'infer',
      width: imageWidth,
      height: imageHeight,
      rgba: rgba.buffer,
    },
  });
  const inference = messages.find(message => message.id === 'infer');
  assert(inference?.ok, inference?.error || 'worker inference failed');
  return { init, inference, tensorDims };
}

(async () => {
  const fixed = await runWorkerCase([1, 3, 518, 518], 336, 64, 36);
  assert.deepStrictEqual(Array.from(fixed.tensorDims), [1, 3, 518, 518]);
  assert.strictEqual(fixed.init.dynamicSpatialInput, false);
  assert.strictEqual(fixed.inference.outputWidth, 518);
  assert.strictEqual(fixed.inference.outputHeight, 518);

  const dynamic = await runWorkerCase([1, 3, 'height', 'width'], 336, 640, 360);
  assert.strictEqual(dynamic.init.dynamicSpatialInput, true);
  assert.deepStrictEqual(Array.from(dynamic.tensorDims), [1, 3, 196, 336]);
  assert.strictEqual(dynamic.inference.outputWidth, 336);
  assert.strictEqual(dynamic.inference.outputHeight, 196);

  console.log('PASS deep_worker_contract');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
