'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('roomscan_app.js');
const core = read('roomscan_core.js');
const signal = read('roomscan_signal.js');
const geometry = read('roomscan_geometry.js');
const acoustics = read('roomscan_acoustics.js');
const audio = read('roomscan_audio.js');
const worklet = read('roomscan_audio_worklet.js');
const diagnostics = read('roomscan_diagnostics.js');
const worker = read('depth_ai_worker.js');
const html = read('room_scanner_v12.html');
const sw = read('sw.js');

const currentAssets = [
  'index.html', 'room_scanner_v12.html', 'roomscan_core.js', 'roomscan_signal.js',
  'roomscan_geometry.js', 'roomscan_acoustics.js', 'roomscan_audio.js',
  'roomscan_audio_worklet.js', 'roomscan_diagnostics.js', 'roomscan_app.js', 'depth_ai_worker.js', 'sw.js',
  'roomscan_core_v20_1_0.js', 'roomscan_signal_v20_1_0.js',
  'roomscan_geometry_v20_1_0.js', 'roomscan_acoustics_v20_1_0.js',
  'roomscan_audio_v20_1_0.js', 'roomscan_audio_worklet_v20_1_0.js',
  'roomscan_diagnostics_v20_1_0.js', 'roomscan_app_v20_1_0.js', 'depth_ai_worker_v20_1_0.js', 'sw_v20_1_0.js',
  'manifest.webmanifest', 'build_info.json', 'icon.svg',
];
for (const file of currentAssets) assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);

for (const name of ['core', 'signal', 'geometry', 'acoustics', 'audio', 'audio_worklet', 'diagnostics', 'app']) {
  assert.equal(read(`roomscan_${name}.js`), read(`roomscan_${name}_v20_1_0.js`), `${name} alias diverged`);
}
assert.equal(worker, read('depth_ai_worker_v20_1_0.js'));
assert.equal(sw, read('sw_v20_1_0.js'));

const requestedIds = new Set([...app.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map(match => match[1]));
const htmlIds = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const counts = new Map();
for (const id of htmlIds) counts.set(id, (counts.get(id) || 0) + 1);
assert.deepEqual([...counts].filter(([, count]) => count > 1), [], 'duplicate HTML ids');
assert.deepEqual([...requestedIds].filter(id => !counts.has(id)), [], 'DOM ids required by app are missing');

// One metric/camera authority, one continuous session, one camera call site.
assert.equal((app.match(/navigator\.xr\.requestSession\s*\(/g) || []).length, 1);
assert.equal((app.match(/\.getCameraImage\s*\(/g) || []).length, 1);
assert.ok(app.includes("requiredFeatures: ['local-floor', 'dom-overlay', 'camera-access']"));
assert.ok(app.includes("optionalFeatures: ['hit-test', 'anchors', 'plane-detection', 'mesh-detection', 'depth-sensing', 'light-estimation']"));
assert.ok(app.includes("usagePreference: ['cpu-optimized']"));
assert.equal(/getUserMedia|ImageCapture|MediaStreamTrackProcessor/.test(app + core + geometry + worker), false, 'camera stack must remain WebXR-only');
assert.ok(audio.includes('mediaDevices.getUserMedia'), 'microphone capture belongs only to the acoustic module');
assert.ok(audio.includes('echoCancellation: { exact: false }'));
assert.ok(audio.includes('noiseSuppression: { exact: false }'));
assert.ok(audio.includes('autoGainControl: { exact: false }'));

const onFrame = app.slice(app.indexOf('function onXRFrame'), app.indexOf('async function settleCaptureBeforeExit'));
for (const marker of ['recordMetricPose', 'fuseLiveDepthFrame', 'fulfillCaptureRequest', 'autoCaptureTick', 'acousticSweepTick']) {
  assert.ok(onFrame.includes(marker), `XR frame missing ${marker}`);
}
for (const forbidden of ['new Worker', 'kirkeby', 'deconvolve', 'analyzeMeasurements', 'processModel']) {
  assert.equal(onFrame.includes(forbidden), false, `heavy ${forbidden} leaked into XR frame`);
}
assert.ok(worklet.includes('registerProcessor'));
assert.ok(worklet.includes('currentFrame'));
assert.ok(audio.includes('continuous PCM timeline'));
assert.ok(audio.includes('getOutputTimestamp'));
assert.ok(signal.includes('select the earliest local peak'));
assert.ok(signal.includes('expectedDirectIndex'));

// The historical strengths are retained without their failure modes.
assert.ok(app.includes('continuous microphone PCM'));
assert.ok(app.includes('local-floor WebXR coordinates'));
assert.ok(geometry.includes('avoids TSDF, ICP and a global nonlinear solver'));
assert.ok(geometry.includes('maximumAngleDegrees || 4.5'));
assert.ok(geometry.includes('maximumOffset || 0.26'));
assert.ok(geometry.includes('Depth Anything models may expose either affine depth or affine inverse'));
assert.ok(app.includes('numericalCornerEpsilon: 1e-5'));
assert.ok(app.includes('never interprets proximity to the first point as an implicit close'));

// Physical wall guidance and RGB object geometry remain first-class.
for (const marker of ['function createWallPhotoTargets', 'function evaluatePhotoTarget', 'function registerFramePhotoTargets']) {
  assert.ok(core.includes(marker));
}
for (const marker of ['function drawPhotoTargetBox', 'function drawTargetArrow', "status === 'red'", "status === 'yellow'", "status === 'green'"]) {
  assert.ok(app.includes(marker));
}
for (const marker of ['function voxelSurfaceMesh', 'function assignMeshAcousticFaces', "representation: 'colored-voxel-surface'"]) {
  assert.ok(core.includes(marker));
}
assert.ok(app.includes('function drawRgbObjectPoints'));
assert.ok(app.includes('function drawObjectApproximateShape'));

// Post-XR handoff: end first, release XR resources, then audio/checkpoint, no reload.
const criticalStart = app.indexOf('// Critical ordering contract: nothing that clones the scan');
const criticalEnd = app.indexOf('return true;', criticalStart);
const criticalBlock = app.slice(criticalStart, criticalEnd);
assert.ok(criticalBlock.includes('await endingSession.end()'));
assert.equal(/persistCheckpoint|buildRawSnapshot|processModel|renderReview/.test(criticalBlock), false);
const onEnd = app.slice(app.indexOf('function onXREnd()'), app.indexOf('function findCameraView'));
assert.ok(onEnd.indexOf('cleanupXRResources()') < onEnd.indexOf('completePostXRHandoff'));
const handoff = app.slice(app.indexOf('async function completePostXRHandoff'), app.indexOf('function onXREnd'));
assert.ok(handoff.includes('audioController.stop'));
assert.ok(handoff.includes('persistCheckpoint'));
assert.equal(/location\??\.reload|location\.reload/.test(handoff), false);
assert.ok(app.includes('function serializeCornerRecord'));
assert.ok(app.includes('function restoreCornerRecord'));
assert.ok(audio.includes('Never keep the callable helpers returned by fitClockMap'));

// Deep is post-XR and metric-calibrated; RIR inference is probabilistic.
assert.ok(app.includes("new Worker(`./depth_ai_worker_v20_1_0.js?build=${REVISION}`)"));
assert.ok(worker.includes('batch-only Depth Anything V2 worker'));
assert.ok(worker.includes("executionProviders: ['wasm']"));
for (const marker of ['function buildAcousticZones', 'function associateEchoPeak', 'unassignedPosterior', 'function inferZoneAbsorption']) {
  assert.ok(acoustics.includes(marker), `acoustic module missing ${marker}`);
}
assert.ok(acoustics.includes('relative-delay-only'));
assert.ok(acoustics.includes('single-bounce early-reflection model with local Gaussian alternatives'));
assert.ok(app.includes('single WebXR local-floor reference space'));

for (const id of [
  'audioEnabled', 'sourceMode', 'prepareAudio', 'audioStatus', 'audioMeterFill',
  'acousticSurfaceSelect', 'acousticScope', 'acousticMaterial', 'acousticScattering',
  'alpha125', 'alpha250', 'alpha500', 'alpha1000', 'alpha2000', 'alpha4000', 'alpha8000',
  'exportAcousticJson', 'exportAcousticCsv', 'layerGaussians', 'layerAcoustic',
]) assert.ok(html.includes(`id="${id}"`), `HTML missing ${id}`);
assert.ok(html.includes('non forza più un reload'));
assert.ok(html.includes('RIR allineate sul cammino diretto'));

for (const asset of [
  './roomscan_signal_v20_1_0.js', './roomscan_geometry_v20_1_0.js',
  './roomscan_acoustics_v20_1_0.js', './roomscan_audio_v20_1_0.js',
  './roomscan_audio_worklet_v20_1_0.js', './roomscan_diagnostics_v20_1_0.js', './roomscan_app_v20_1_0.js',
]) assert.ok(sw.includes(asset), `service worker missing ${asset}`);
assert.ok(sw.includes('room-scanner-v20.1.0-metric-rir-twin-diag-20260818'));
assert.ok(sw.includes("event.respondWith(networkFirst(request, './room_scanner_v12.html'))"));
assert.ok(sw.includes('Only navigation may fall back to HTML'));
assert.ok(read('index.html').includes('Room Scanner V20.1.0'));
assert.ok(html.includes('<title>Room Scanner V20.1.0'));
assert.ok(app.includes('navigator.serviceWorker.register(`./sw_v20_1_0.js?build=${REVISION}`)'));

// The diagnostic patch must remain observational and export complete recovery data.
assert.ok(html.includes('<script src="./roomscan_diagnostics_v20_1_0.js" defer></script>'));
assert.ok(html.includes('id="exportDiagnostics"'));
assert.ok(html.includes('id="exportDiagnosticsXR"'));
assert.ok(diagnostics.includes('room-scanner-v20-diagnostic-jsonl-v1'));
assert.ok(diagnostics.includes("'room-scanner-v20-1-checkpoints'"));
assert.ok(diagnostics.includes("'room-scanner-v20-acoustic-captures'"));
assert.ok(diagnostics.includes("type: 'indexeddb-acoustic-measurement'"));
assert.ok(diagnostics.includes('CompressionStream'));
assert.ok(diagnostics.includes('pagehide'));
assert.ok(diagnostics.includes('beforeunload'));
assert.ok(diagnostics.includes('maybePrompt'));
assert.ok(app.includes('RoomScanDiagnostics?.recordAppLog'));
assert.ok(app.includes("RoomScanDiagnostics?.captureFault?.(error, 'PROCESS_FAILED'"));
assert.ok(app.includes("RoomScanDiagnostics?.captureFault?.(new Error('WebXR ended unexpectedly')"));
assert.ok(app.includes("RoomScanDiagnostics?.markExpectedClose?.('new-scan-reset')"));

console.log('PASS static_contract');
