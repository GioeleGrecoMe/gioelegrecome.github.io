'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'roomscan_app.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'roomscan_core.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'depth_ai_worker.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'room_scanner_v12.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

for (const file of ['index.html', 'room_scanner_v12.html', 'roomscan_core.js', 'roomscan_app.js', 'depth_ai_worker.js', 'sw.js', 'manifest.webmanifest', 'icon.svg']) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

const requestedIds = new Set([...app.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map(match => match[1]));
const htmlIds = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const counts = new Map();
for (const id of htmlIds) counts.set(id, (counts.get(id) || 0) + 1);
assert.deepEqual([...counts].filter(([, count]) => count > 1), [], 'duplicate HTML ids');
assert.deepEqual([...requestedIds].filter(id => !counts.has(id)), [], 'DOM ids required by app are missing');

assert.equal((app.match(/navigator\.xr\.requestSession\s*\(/g) || []).length, 1, 'exactly one WebXR request call');
assert.equal((app.match(/\.getCameraImage\s*\(/g) || []).length, 1, 'exactly one raw camera call site');
assert.ok(app.includes("requiredFeatures: ['local-floor', 'dom-overlay', 'camera-access']"));
assert.ok(app.includes("optionalFeatures: ['hit-test', 'anchors', 'plane-detection', 'depth-sensing', 'light-estimation']"));
assert.ok(app.includes("depthSensing:"));
assert.ok(app.includes("usagePreference: ['cpu-optimized']"));

const forbidden = /getUserMedia|mediaDevices|ImageCapture|MediaStreamTrackProcessor|enumerateDevices/;
assert.equal(forbidden.test(app + core + html + worker), false, 'a second camera stack is forbidden');

const onFrame = app.slice(app.indexOf('function onXRFrame'), app.indexOf('async function interruptXR'));
assert.ok(onFrame.includes('fulfillCaptureRequest(frame, view, time)'));
assert.equal(onFrame.includes('new Worker'), false);
assert.equal(onFrame.includes('ensureDepthWorker'), false);
assert.equal(onFrame.includes('inferDepth'), false);
assert.ok(app.indexOf('function fulfillCaptureRequest') < app.indexOf('function captureKeyframe'));
assert.ok(app.includes("new Worker(`./depth_ai_worker.js?build=${REVISION}`)"));

assert.ok(worker.includes("'./models/depth_anything_v2_small_q4.onnx'" ) === false, 'model URL belongs in app configuration');
assert.ok(app.includes('./models/depth_anything_v2_small_q4.onnx'));
assert.ok(app.includes('onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4.onnx'));
assert.ok(worker.includes('IndexedDB') || worker.includes('indexedDB'));
assert.ok(worker.includes("executionProviders: ['wasm']"));

for (const option of ['quick', 'balanced', 'accurate']) assert.ok(html.includes(`value="${option}"`));
assert.ok(app.includes("requested === 'quick'"));
assert.ok(app.includes("requested === 'accurate'"));
assert.ok(app.includes("state.phase !== 'room-ready'"));
assert.ok(app.includes('captureTimeoutMs: 5000'));
assert.ok(app.includes('clearTimeout(request.timeoutId)'));
assert.ok(app.includes("session.removeEventListener('end', onXREnd)"));
assert.ok(app.includes("object.mesh = C.boxMesh(object.obb.center, extent, yaw)"));
assert.ok(app.includes("['finished', 'processed'].includes(state.phase)"));

for (const asset of ['./index.html', './room_scanner_v12.html', './roomscan_core.js', './roomscan_app.js', './depth_ai_worker.js']) {
  assert.ok(sw.includes(asset), `service worker does not cache ${asset}`);
}

// The deployed filename intentionally remains unchanged for the existing URL.
assert.ok(fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('./room_scanner_v12.html'));
assert.ok(html.includes('<title>Room Scanner V15'));
assert.ok(html.includes('<script src="./roomscan_core.js" defer></script>'));
assert.ok(html.includes('<script src="./roomscan_app.js" defer></script>'));
assert.equal(sw.includes("cache.put('./room_scanner_v12.html', copy)"), false, 'root navigation must not overwrite the canonical cache entry');
assert.ok(sw.includes("caches.match(request, { ignoreSearch: true })"), 'offline worker requests must tolerate build query strings');

console.log('PASS static_contract');
