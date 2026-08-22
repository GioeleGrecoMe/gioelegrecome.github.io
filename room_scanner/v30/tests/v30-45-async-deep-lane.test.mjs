import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DeepLateBindingQueue} from '../js/dense/deep_late_binding_queue.js?v=30.45.0';

const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const config=fs.readFileSync(new URL('../js/config.js',import.meta.url),'utf8');

test('late-binding queue deduplicates exact frame and upgrades survey to keyframe',()=>{
  const q=new DeepLateBindingQueue({maxItems:4});
  assert.equal(q.enqueue({jobId:'s1',kind:'preview',frameId:'f1',rgba:new Uint8Array([1])}).ok,true);
  const r=q.enqueue({jobId:'k1',kind:'keyframe',frameId:'f1',rgba:new Uint8Array([2])});
  assert.equal(r.replaced,true);assert.equal(q.stats().queued,1);assert.equal(q.stats().keyframes,1);
  const x=q.next();assert.equal(x.jobId,'k1');assert.equal(q.stats().inFlight,1);assert.equal(q.complete('k1'),true);assert.equal(q.stats().completed,1);
});

test('queue never evicts an already depth-planned frame when full',()=>{
  const q=new DeepLateBindingQueue({maxItems:2});q.enqueue({jobId:'a',kind:'preview',frameId:'a',rgba:new Uint8Array([1])});q.enqueue({jobId:'b',kind:'preview',frameId:'b',rgba:new Uint8Array([1])});
  const r=q.enqueue({jobId:'c',kind:'keyframe',frameId:'c',rgba:new Uint8Array([1])});
  assert.equal(r.ok,false);assert.equal(r.reason,'queue-full');assert.equal(q.stats().queued,2);
});


test('post-scan drain prioritizes geometry-bearing keyframes over survey-only frames',()=>{
  const q=new DeepLateBindingQueue({maxItems:4});
  q.enqueue({jobId:'s1',kind:'preview',frameId:'s1',rgba:new Uint8Array([1])});
  q.enqueue({jobId:'k1',kind:'keyframe',frameId:'k1',rgba:new Uint8Array([1])});
  q.enqueue({jobId:'s2',kind:'preview',frameId:'s2',rgba:new Uint8Array([1])});
  assert.equal(q.next().jobId,'k1');
});

test('MVS dispatch is not conditional on Deep result',()=>{
  const fn=app.slice(app.indexOf('async function dispatchDensePayload'),app.indexOf('function stripDeepRaster'));
  assert.match(fn,/mvs-fastlane-dispatch/);assert.match(fn,/state\.denseDepthWorker\.postMessage\(payload\)/);
  assert.doesNotMatch(fn,/await applyDeepDepthResult/);assert.doesNotMatch(fn,/return;\s*}\s*\/\/ Deep is optional/);
});

test('default scan mode defers neural inference until post-scan',()=>{
  assert.match(config,/deepPostScanOnly:true/);assert.match(config,/deepInferEveryDenseKeyframe:false/);assert.match(app,/await drainDeepBacklog\(\)/);assert.match(app,/stopCaptureFastLane\(\);stopLiveOptimizer\(\)/);
});

test('planned exact RGB is registered before late Deep attachment',()=>{
  const preview=app.slice(app.indexOf('function requestLiveDeepPreview'),app.indexOf('function compactGrayHeartbeat'));
  assert.match(preview,/enqueueLateDeepJob/);assert.match(preview,/registerDepthPlannedPhoto/);assert.doesNotMatch(preview,/deepDepthWorker\.postMessage/);
  assert.match(app,/attachLateDepthToPhoto/);assert.match(app,/deep-keyframe-photo-late-bound/);
});


test('late Deep never metric-calibrates against capture-time sparse seeds',()=>{
  const a=app.indexOf('async function applyDeepDepthResult'),b=app.indexOf('function clampNumber',a),fn=app.slice(a,b);
  assert.match(fn,/metricCalibrationDeferred:true/);assert.match(fn,/addDeepRaw/);assert.doesNotMatch(fn,/deepSequence\.calibrate/);assert.doesNotMatch(fn,/calibrateRelativeDepth/);
});

test('diagnostics expose fast-lane stalls and whether Deep was active',()=>{
  assert.match(app,/fast-lane-frame-gap/);assert.match(app,/deepInferenceDuringScan/);assert.match(app,/deep-postscan-drain-complete/);
});

test('post-scan policy releases the ONNX worker during acquisition and recreates it only for drain',()=>{
  assert.match(app,/deep-worker-deferred/);
  assert.match(app,/state\.deepDepthWorker\?\.terminate\?\.\(\);state\.deepDepthWorker=null/);
  const drain=app.slice(app.indexOf('async function drainDeepBacklog'),app.indexOf('function noteFastLaneFrame'));
  assert.match(drain,/ensureDeepRuntimeWorker\(\)/);
  const preview=app.slice(app.indexOf('function requestLiveDeepPreview'),app.indexOf('function compactGrayHeartbeat'));
  assert.doesNotMatch(preview,/!state\.deepDepthWorker/);
});
