import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AdaptiveDeepScheduler,selectGeometricPhotoSubset} from '../js/reconstruction/adaptive_deep_scheduler.js?v=30.51.0';

const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const cfg=fs.readFileSync(new URL('../js/config.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../room_scanner_v30.html',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../workers/photo_preprocess_worker.js',import.meta.url),'utf8');
const runtime=fs.readFileSync(new URL('../js/probabilistic/single_optimizer_runtime.js',import.meta.url),'utf8');
const mk=(i,{bad=false}={})=>({frameId:`f${i}`,at:i*1000,pose:{p:[i*.12,0,(i%5)*.18],q:[0,Math.sin(i*.035),0,Math.cos(i*.035)]},photoQuality:{stableQuality:.75,detail:8},features:Array.from({length:70+(i%30)},()=>({})),trackingRejected:bad});

test('geometric pool excludes quarantined frames and spreads views',()=>{
  const rows=Array.from({length:80},(_,i)=>mk(i,{bad:i===17})),out=selectGeometricPhotoSubset(rows,24);
  assert.equal(out.length,24);assert.ok(!out.some(x=>x.frameId==='f17'));
  assert.ok(new Set(out.map(x=>Math.floor(x.pose.p[0]))).size>=5);
});

test('adaptive scheduler uses 16 then <=8 and never reselects processed frames',()=>{
  const rows=Array.from({length:100},(_,i)=>mk(i)),s=new AdaptiveDeepScheduler(rows,{initialBatch:16,nextBatch:8,maxDepthFrames:36,minMarginalScore:.05}),done=new Set();
  const a=s.next(done,null);assert.equal(a.records.length,16);for(const r of a.records)done.add(r.frameId);
  const b=s.next(done,null);assert.ok(b.records.length<=8);assert.ok(b.records.every(r=>!a.records.some(x=>x.frameId===r.frameId)));
});

test('processed reliable coverage lowers uncertainty and low marginal score can stop',()=>{
  const rows=Array.from({length:50},(_,i)=>mk(i)),s=new AdaptiveDeepScheduler(rows,{initialBatch:8,nextBatch:4,maxDepthFrames:20,minMarginalScore:.99}),before=s.buildUncertainty(new Set(),null),first=s.next(new Set(),null),done=new Set(first.records.map(x=>x.frameId)),reliability={frames:first.records.map(x=>({frameId:x.frameId,confidence:.95}))},after=s.buildUncertainty(done,{reliability});
  assert.ok(after.globalUncertainty<before.globalUncertainty);const plan=s.next(done,{reliability});assert.equal(plan.records.length,0);assert.equal(plan.stopReason,'marginal-gain-low');
});

test('scan never plans Deep and post-scan order is RGB scaffold -> adaptive Deep -> MVS',()=>{
  const sparse=app.slice(app.indexOf('async function scheduleSparseGeometryWork'),app.indexOf('async function makeDensePayload'));
  assert.doesNotMatch(sparse,/planLateDeepFromPayload\(payload\)/);
  const finish=app.slice(app.indexOf('async function finishScan'),app.indexOf('async function persistCurrentSession'));
  assert.ok(finish.indexOf('reconcilePostScanRgbScaffold')<finish.indexOf('processArchivedDeepAdaptive'));
  assert.ok(finish.indexOf('processArchivedDeepAdaptive')<finish.indexOf('drainPostScanMvsBacklog'));
  assert.doesNotMatch(finish,/processArchivedDeepSequential/);
});

test('next JPEG decode/preprocess starts before current Deep wait and resize maps are cached',()=>{
  const fn=app.slice(app.indexOf('async function processDeepBatchPipelined'),app.indexOf('async function processArchivedDeepAdaptive'));
  assert.match(fn,/prep=\(i\+1<records\.length\)\?decodeSharpPhotoRecord/);
  assert.ok(fn.indexOf('prep=(i+1<records.length)')<fn.indexOf('waitForDeepJobCompletion'));
  for(const key of ['resizeCache','x0','x1','tx','y0','y1','ty'])assert.match(worker,new RegExp(key));
});

test('microbatch is capability-gated and never invented for legacy Deep worker',()=>{
  assert.match(cfg,/adaptiveDeepMicrobatchRequiresProtocol:'infer-batch-v1'/);
  assert.match(app,/state\.deepBatchProtocol===CONFIG\.adaptiveDeepMicrobatchRequiresProtocol/);
  assert.match(app,/microbatchActive:false/);
  assert.match(app,/throughput-not-benchmarked/);
  assert.doesNotMatch(app,/type:'infer-batch'/);
});

test('single optimizer provides adaptive depth feedback without a second estimator',()=>{
  assert.match(runtime,/async refineDepthFeedback/);assert.match(runtime,/new ProbabilisticJointOptimizer/);assert.match(runtime,/adaptive-depth-feedback-complete/);
  assert.doesNotMatch(runtime,/GaussianOptimizer|PuzzleOptimizer|SurfaceLabOptimizer/);
});

test('Alva persistent/new feature semantics and recovery gate are wired into scan',()=>{
  for(const id of ['alvaFeatureOverlay','alvaFeatureState','alvaRecoveryBanner','processingUncertainty'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/classifyAlvaFramePoints/);assert.match(app,/drawAlvaFeatureOverlay/);assert.match(app,/updateAlvaTrackingIntegrity/);assert.match(app,/r\._integrityAccepted=!!integrity\.accept/);
  assert.match(app,/r\.newKeyframe&&r\.trackingValid&&integrity\.accept/);assert.match(app,/ALVA HA PERSO IL RIFERIMENTO/);assert.match(app,/ALVA HA FATTO UN SALTO/);
  assert.match(cfg,/alvaPersistentFeatureMinViewTranslation/);assert.match(cfg,/alvaPersistentFeatureMinViewRotationRad/);
  assert.match(app,/maxViewTranslation/);assert.match(app,/maxViewRotation/);assert.match(app,/firstPose/);
});

test('MVS consumes the latest accepted pose snapshot after adaptive Deep feedback',()=>{
  const finish=app.slice(app.indexOf('async function finishScan'),app.indexOf('async function persistCurrentSession'));
  assert.match(finish,/const mvsSnapshot=state\.liveOptAccepted\|\|rgbScaffold\?\.snapshot\|\|null/);
  assert.match(finish,/drainPostScanMvsBacklog\(mvsSnapshot\)/);
});

test('RGB candidates are distinct from actual adaptive depth-planned frames',()=>{
  assert.match(app,/adaptiveCandidate:true/);assert.match(app,/rgb-adaptive-depth-candidate/);assert.match(app,/adaptive-deep-frame-planned/);
  assert.match(app,/if\(!adaptiveCandidate\)state\.photoPlannedFrameIds/);
});
