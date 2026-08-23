#!/usr/bin/env node
// Regression tests for the exact camera/ONNX raster contract used by Scan Test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const workerPath = new URL('../deep_depth_worker.js', import.meta.url);
let source = fs.readFileSync(workerPath, 'utf8');
source += '\n;globalThis.__depthTest={inspectDepthModelContract,inputSpec,readOutput,prepareInput,assessFlipComparison,setContract:(v)=>{bundledModelContract=v;}};';

const context = {
  console,
  performance:{ now:() => 0 },
  navigator:{},
  postMessage(){},
  self:{},
  TextDecoder,
  Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
  Float32Array, Float64Array, Int32Array,
  ArrayBuffer, BigInt, Math, Number, Array, Object, String, Set, Map,
  Error, TypeError, Infinity, NaN,
};
vm.createContext(context);
vm.runInContext(source, context, { filename:'scan_test/deep_depth_worker.js' });
const d = context.__depthTest;

const bytes = fs.readFileSync(new URL('../models/model_q4.onnx', import.meta.url));
const contract = d.inspectDepthModelContract(bytes);
assert.equal(contract.input.name, 'pixel_values');
assert.equal(contract.input.type, 'float32');
assert.deepEqual(Array.from(contract.input.shape), ['batch_size', 3, 'height', 'width']);
assert.equal(contract.output.name, 'predicted_depth');
assert.equal(contract.output.type, 'float32');
assert.equal(contract.output.shape.length, 3);
d.setContract(contract);

const fakeSession = {
  inputNames:['pixel_values'], outputNames:['predicted_depth'],
  inputMetadata:{ pixel_values:{ type:'float32', shape:['batch_size', 3, 'height', 'width'] } },
  outputMetadata:{ predicted_depth:{ type:'float32', shape:['batch_size', 'height', 'width'] } },
};
const spec = d.inputSpec(fakeSession);
assert.deepEqual(Array.from(spec.dims), [1, 3, 518, 518]);

const rowMajor = await d.readOutput({ predicted_depth:{ dims:[1, 2, 3], type:'float32', data:new Float32Array([1,2,3,4,5,6]) } }, { width:3, height:2 }, fakeSession);
assert.deepEqual(Array.from(rowMajor.rawDepth), [1,2,3,4,5,6]);
await assert.rejects(
  d.readOutput({ predicted_depth:{ dims:[1, 1, 2, 3], type:'float32', data:new Float32Array(6) } }, { width:3, height:2 }, fakeSession),
  /deve essere \[1,H,W\]/,
);
await assert.rejects(
  d.readOutput({ predicted_depth:{ dims:[1, 2, 3], type:'float32', data:new Float32Array(7) } }, { width:3, height:2 }, fakeSession),
  /buffer incoerente/,
);

class FakeTensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
const pixels = new Uint8ClampedArray([
  255,0,0,255, 0,255,0,255,
  0,0,255,255, 255,255,255,255,
]);
const prepared = await d.prepareInput(pixels, 2, 2, { type:'float32' }, { width:14, height:14 }, null, { Tensor:FakeTensor }, true);
assert.equal(prepared.tensor.dims.join(','), '1,3,14,14');
assert.equal(prepared.inputRasterDiagnostic.tensorNchwPreview[0], 255);
assert.equal(prepared.inputRasterDiagnostic.tensorNchwPreview[1], 0);

// Identity-size preprocessing must preserve the complete raster after
// normalize -> diagnostic de-normalize. This catches RGB/BGR, NCHW/NHWC and
// row/column-major regressions rather than checking only two pixels.
const identityPixels = new Uint8ClampedArray(14 * 14 * 4);
for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
  const i = (y * 14 + x) * 4;
  identityPixels[i] = (17 * x + 3 * y) & 255;
  identityPixels[i + 1] = (5 * x + 19 * y + 31) & 255;
  identityPixels[i + 2] = (11 * x + 7 * y + 73) & 255;
  identityPixels[i + 3] = 255;
}
const identity = await d.prepareInput(identityPixels, 14, 14, { type:'float32' }, { width:14, height:14 }, null, { Tensor:FakeTensor }, true);
const preview = identity.inputRasterDiagnostic.tensorNchwPreview;
for (let i = 0; i < 14 * 14; i++) {
  assert.ok(Math.abs(preview[i * 4] - identityPixels[i * 4]) <= 1);
  assert.ok(Math.abs(preview[i * 4 + 1] - identityPixels[i * 4 + 1]) <= 1);
  assert.ok(Math.abs(preview[i * 4 + 2] - identityPixels[i * 4 + 2]) <= 1);
  assert.equal(preview[i * 4 + 3], 255);
}
await assert.rejects(
  d.prepareInput(new Uint8ClampedArray(17), 2, 2, { type:'float32' }, { width:14, height:14 }, null, { Tensor:FakeTensor }),
  /shape errata/,
);
assert.equal(d.assessFlipComparison({ comparable:true, correlation:.97, nrmse:.1, samples:100 }).verified, true);
assert.equal(d.assessFlipComparison({ comparable:true, correlation:.2, nrmse:1, samples:100 }).suspicious, true);

console.log(JSON.stringify({
  model:{ input:contract.input, output:contract.output },
  inputTensor:spec.dims,
  rowMajor:Array.from(rowMajor.rawDepth),
  strictOutputShape:true,
  strictRgbaShape:true,
  fullRasterNchwRoundTrip:true,
  flipGate:true,
}, null, 2));
