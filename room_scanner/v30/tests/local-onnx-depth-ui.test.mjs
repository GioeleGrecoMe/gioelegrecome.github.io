import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CONFIG} from '../js/config.js';

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
test('bundled local ONNX model and mobile worker path are explicit',()=>{
  assert.equal(CONFIG.analysisFps,8);
  assert.equal(CONFIG.deepInferenceIntervalMs,1000);
  assert.equal(CONFIG.deepModelUrl,'models/model_q4.onnx');
  assert.equal(CONFIG.deepModelRemoteUrl,null);
  assert.equal(CONFIG.deepOrtLocal,null);
  assert.equal(CONFIG.deepPreferredShortSide,168);
  assert.equal(CONFIG.deepQualityRescueShortSide,196);
  assert.equal(CONFIG.deepCompatibilityShortSide,196);
  assert.equal(CONFIG.deepWasmThreads,0);
  assert.equal(CONFIG.deepPriorDepthSteps,10);
  assert.ok(fs.statSync(new URL('../models/model_q4.onnx',import.meta.url)).size>10_000_000);
  const worker=read('workers/deep_depth_worker.js');
  assert.match(worker,/InferenceSession\.create/);
  assert.match(worker,/executionProviders/);
  assert.match(worker,/pixel/);
  assert.match(worker,/RGBA row-major/);
  assert.match(worker,/getData\(false\)/);
  assert.match(worker,/manual-rgba-nchw-bilinear/);
  assert.doesNotMatch(worker,/Tensor\.fromImage\(image/);
  assert.doesNotMatch(worker,/pipeline\('depth-estimation'/);
  assert.match(worker,/testSinglePass/);
  assert.match(worker,/maybeResolutionRescue/);
  assert.match(worker,/wasm\.numThreads = Number/);
});
test('pre-scan test and selected-keyframe depth overlay are wired in both entry pages',()=>{
  for(const page of ['index.html','room_scanner_v30.html']){const html=read(page);for(const id of ['chooseDeepModelBtn','deepModelFile','testDeepBtn','deepModelStatus','deepTestPreview','depthOverlay'])assert.match(html,new RegExp(`id="${id}"`));}
  const app=read('js/app.js');
  assert.match(app,/captureDepthTestFrame/);
  assert.match(app,/drawDepth\(\$\('depthOverlay'\)/);
  assert.doesNotMatch(app,/requestLiveDepth/);
  const boot=read('js/boot.js');
  assert.doesNotMatch(boot,/deep_live_controller/);
});
