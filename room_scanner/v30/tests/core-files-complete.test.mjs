import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const required=['styles.css','manifest.webmanifest','icon.svg','js/app.js','js/logger.js','js/camera.js','js/formats.js','js/slam/math.js','js/slam/wasm_frontend.js','js/slam/slam_engine.js','js/dense/keyframe_manager.js','js/dense/deep_keyframe_selector.js','js/dense/deep_metric.js','js/dense/plane_sweep_core.js','js/dense/fusion_core.js','js/xr/metric_bridge.js','js/gaussian/renderer.js','workers/gaussian_worker.js','workers/mvs_worker.js','workers/deep_depth_worker.js','workers/dense_depth_worker.js','workers/dense_fusion_worker.js','wasm/slam_core.wasm'];
test('all recovered core runtime files are present and non-empty',()=>{for(const p of required){const u=new URL(p,root);assert.equal(fs.existsSync(u),true,`missing ${p}`);assert.ok(fs.statSync(u).size>0,`empty ${p}`);}});
test('slam_core.wasm is a real WebAssembly binary',()=>{const b=fs.readFileSync(new URL('wasm/slam_core.wasm',root));assert.deepEqual([...b.subarray(0,4)],[0,0x61,0x73,0x6d]);});
