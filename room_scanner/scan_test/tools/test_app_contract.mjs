import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const camera = fs.readFileSync(path.join(root, 'camera.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(cond, message) {
  if (!cond) throw new Error(`FAIL: ${message}`);
}
function between(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  assert(a >= 0, `marker not found: ${startMarker}`);
  const b = text.indexOf(endMarker, a + startMarker.length);
  assert(b > a, `end marker not found after: ${endMarker}`);
  return text.slice(a, b);
}

const startCapture = between(app, 'async function startCaptureSource', '\nasync function openCamera');
const fileBranchPos = startCapture.indexOf("if (source === 'file')");
const recordPos = startCapture.indexOf('startRecording();', fileBranchPos);
const processPos = startCapture.indexOf('processUploadedVideo(capture)', fileBranchPos);
assert(fileBranchPos >= 0 && recordPos > fileBranchPos && processPos > recordPos,
  'uploaded file must enter recording state before processUploadedVideo starts');

const processUploaded = between(app, 'async function processUploadedVideo', '\nfunction startRecording');
assert(processUploaded.includes('capture.consumeDecodedFrames'),
  'uploaded native path must use continuous decoded-frame consumer');
assert(!processUploaded.includes('.nextDecodedFrame('),
  'uploaded native path must not use the old play/pause one-frame stepping loop');
assert(app.includes('const ANALYSIS_LONG_SIDE = 960;'),
  'Alva raster long-side contract must be 960 px');
assert(app.includes("scan-test-v3.4.0-watchdog-live-log"), 'build id must be v3.4.0');
assert(index.includes('v3.4.0') && index.includes('buildSentinel'), 'UI must expose an unmistakable v3.4.0 build sentinel');
assert(processUploaded.includes('FILE_BOOTSTRAP_PLAYBACK_RATE') && app.includes('const FILE_BOOTSTRAP_PLAYBACK_RATE = .0625;'), 'mobile file bootstrap must start at 0.0625x');
assert(app.includes('chooseOfflineTrackerFov') && app.includes('AlvaAR.Initialize(W, H, fov)'), 'offline Alva replay must probe and pass an explicit tracker FOV');

const consume = between(camera, 'async consumeDecodedFrames', '\n  async nextDecodedFrame');
assert(consume.includes('includeInitial'), 'continuous decoder must explicitly support the t=0 frame');
assert(consume.includes('Promise.resolve(video.play())'), 'continuous decoder must start one playback session');
const playCalls = (consume.match(/\.play\(\)/g) || []).length;
assert(playCalls === 1, `continuous decoder should call play() exactly once, found ${playCalls}`);
assert(consume.includes('requestVideoFrameCallback'), 'continuous decoder must use requestVideoFrameCallback');

const runDeep = between(app, 'async function runDeep', '\nfunction depthShade');
const firstAssignment = runDeep.indexOf('f.deep = {');
const gate = runDeep.indexOf('const accepted =');
assert(gate >= 0 && firstAssignment > gate,
  'Deep acceptance gate must run before assigning depth to a frame');
assert(runDeep.includes('for (const x of selected) x.deep = null;'),
  'a rejected Deep frame must clear the entire partial batch');
assert(runDeep.includes("$('depthPreviewBtn').disabled = true"),
  'rejected/current Deep batch must disable depth preview');
assert(runDeep.includes("$('deepBtn').disabled = false"),
  'Deep button must be re-enabled after success/failure');

console.log(JSON.stringify({
  build: 'v3.4.0',
  recordingBeforeDecode: true,
  continuousRvfc: true,
  t0FrameExplicit: true,
  singlePlaySession: true,
  alvaLongSide: 960,
  deepAssignmentAfterGate: true,
  deepPartialBatchClearedOnReject: true,
  deepUiFailClosed: true,
}, null, 2));
