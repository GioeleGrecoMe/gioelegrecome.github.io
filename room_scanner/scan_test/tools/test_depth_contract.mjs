#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const model = new URL('../models/depth-anything-v2-small/onnx/model_q4.onnx', import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL('../models/depth-anything-v2-small/config.json', import.meta.url), 'utf8'));
const processor = JSON.parse(fs.readFileSync(new URL('../models/depth-anything-v2-small/preprocessor_config.json', import.meta.url), 'utf8'));
const workerPath = new URL('../deep_depth_worker.js', import.meta.url);
const appPath = new URL('../app.js', import.meta.url);

const bytes = fs.readFileSync(model);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256, '5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8');
assert.equal(config.model_type, 'depth_anything');
assert.equal(processor.image_processor_type, 'DPTImageProcessor');
assert.equal(processor.do_resize, true);
assert.equal(processor.keep_aspect_ratio, true);
assert.equal(processor.ensure_multiple_of, 14);
assert.equal(processor.resample, 3);
assert.deepEqual(processor.size, { height: 518, width: 518 });
assert.deepEqual(processor.image_mean, [0.485, 0.456, 0.406]);
assert.deepEqual(processor.image_std, [0.229, 0.224, 0.225]);

const inspect = spawnSync(process.execPath, [new URL('./inspect_onnx_contract.mjs', import.meta.url).pathname, model.pathname], { encoding: 'utf8' });
assert.equal(inspect.status, 0, inspect.stderr);
const onnx = JSON.parse(inspect.stdout);
assert.equal(onnx.depthAnythingV2Contract, true);
assert.equal(onnx.inputs[0].name, 'pixel_values');
assert.equal(onnx.inputs[0].dataType, 'float32');
assert.equal(onnx.inputs[0].shape[1], 3);
assert.equal(onnx.outputs[0].name, 'predicted_depth');
assert.equal(onnx.outputs[0].dataType, 'float32');

let workerSource = fs.readFileSync(workerPath, 'utf8');
workerSource += '\n;globalThis.__depthTest={finiteStats,pearson,flipRgbaHorizontal,flipDepthHorizontal};';
const context = {
  console,
  performance: { now: () => 0 },
  self: { postMessage(){}, location: { href: 'https://example.invalid/scan_test/deep_depth_worker.js' } },
  Uint8Array, Uint8ClampedArray, Uint32Array, Float32Array, Float64Array,
  ArrayBuffer, Math, Number, Array, Object, String, Set, Map, Error, TypeError, Infinity, NaN,
};
vm.createContext(context);
vm.runInContext(workerSource, context, { filename: 'deep_depth_worker.js' });
const d = context.__depthTest;
const depth = Float32Array.from({length: 20}, (_, i) => i * 0.25 + (i % 4));
const flipped = d.flipDepthHorizontal(depth, 5, 4);
const restored = d.flipDepthHorizontal(flipped, 5, 4);
assert.deepEqual(Array.from(restored), Array.from(depth));
const corr = d.pearson(depth, restored);
assert.ok(corr.correlation > 0.999999);
const stats = d.finiteStats(depth);
assert.equal(stats.finiteRatio, 1);
assert.ok(stats.robustRange > 0);

const workerText = fs.readFileSync(workerPath, 'utf8');
const appText = fs.readFileSync(appPath, 'utf8');
assert.match(workerText, /pipeline\('depth-estimation'/);
assert.match(workerText, /device:\s*'wasm'/);
assert.match(workerText, /dtype:\s*'q4'/);
assert.match(workerText, /new api\.RawImage/);
assert.doesNotMatch(workerText, /InferenceSession\.create|new\s+ort\.Tensor/);
assert.match(workerText, /predicted_depth/);
assert.match(workerText, /validateSpatial/);
assert.match(appText, /includes\('wasm'\)/);
assert.match(appText, /spatialContract\?\.verified === true/);
assert.match(appText, /!d\.quality\?\.suspicious/);
assert.match(appText, /FAIL-CLOSED/);
assert.match(appText, /f\.deep = null/);
assert.match(appText, /renderDeepDiagnostic\(d, \{ showDepth: !bad \}\)/);
const gatePos = appText.indexOf("const deepSafe = String(d.provider || '').includes('wasm')");
const assignPos = appText.indexOf('f.deep = { rawDepth: d.rawDepth', gatePos);
assert.ok(gatePos >= 0 && assignPos > gatePos, 'depth must be gated before frame assignment');
assert.match(workerText, /spatialValidation\.verified !== true/);

console.log(JSON.stringify({
  modelSha256: sha256,
  onnxInput: onnx.inputs[0],
  onnxOutput: onnx.outputs[0],
  processor,
  officialPipelineOwnedPreprocessing: true,
  wasmQ4Only: true,
  flipGateHelpers: true,
  appFailClosedGate: true,
  numericRuntimeExecuted: false,
  numericRuntimeReason: 'Transformers.js/onnxruntime-web CDN is unreachable from this sandbox; browser runtime remains gated and cannot accept a map unless the mirrored inference check passes.'
}, null, 2));
