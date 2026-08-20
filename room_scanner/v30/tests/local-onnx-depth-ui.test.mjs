import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CONFIG} from '../js/config.js';

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
test('bundled local ONNX model and 1 Hz worker path are explicit',()=>{
  assert.equal(CONFIG.analysisFps,8);
  assert.equal(CONFIG.deepInferenceIntervalMs,1000);
  assert.equal(CONFIG.deepModelUrl,'models/depth_anything_v2_small_q4f16.onnx');
  assert.ok(fs.statSync(new URL('../models/depth_anything_v2_small_q4f16.onnx',import.meta.url)).size>10_000_000);
  const worker=read('workers/deep_depth_worker.js');
  assert.match(worker,/InferenceSession\.create/);
  assert.match(worker,/executionProviders/);
  assert.match(worker,/pixel/);
  assert.doesNotMatch(worker,/pipeline\('depth-estimation'/);
});
test('pre-scan test and live depth overlay are wired in both entry pages',()=>{
  for(const page of ['index.html','room_scanner_v30.html']){const html=read(page);for(const id of ['chooseDeepModelBtn','deepModelFile','testDeepBtn','deepModelStatus','deepTestPreview','depthOverlay'])assert.match(html,new RegExp(`id="${id}"`));}
  const app=read('js/app.js');
  assert.match(app,/captureDepthTestFrame/);
  assert.match(app,/requestLiveDepth/);
  assert.match(app,/deepInferenceIntervalMs/);
  assert.match(app,/drawDepth\(\$\('depthOverlay'\)/);
});
