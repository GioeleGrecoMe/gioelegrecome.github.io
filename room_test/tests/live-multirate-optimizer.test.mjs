import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLiveCandidate,poseSnapshotDelta} from '../js/probabilistic/live_optimization_gate.js';

const pose=(x=0,a=0)=>({p:[x,0,0],q:[0,Math.sin(a/2),0,Math.cos(a/2)]});
const snap=(xs)=>({frames:xs.map((x,i)=>({frameId:`f${i}`,poseEstimate:pose(x)}))});
const stats=(r=1,d=.1)=>({reprojectionRmse:r,deepRelativeError:d,energy:30,observations:100,landmarks:20,edgeSwitches:{rejected:0},alvaSwitches:{rejected:0}});

test('live gate accepts a small reprojection improvement with small pose correction',()=>{
  const a=snap([0,.1,.2]),b=snap([0,.105,.204]);const g=evaluateLiveCandidate({baselineStats:stats(1.2,.12),candidateStats:{...stats(.8,.10),energy:20},baselineSnapshot:a,candidateSnapshot:b});
  assert.equal(g.accepted,true);assert.ok(g.poseDelta.maxTranslation<.01);assert.ok(g.score>0);
});

test('live gate rejects a visually catastrophic pose jump even if scalar energy falls',()=>{
  const a=snap([0,.1,.2]),b=snap([0,.42,.7]);const g=evaluateLiveCandidate({baselineStats:stats(1.2,.12),candidateStats:{...stats(.5,.08),energy:5},baselineSnapshot:a,candidateSnapshot:b});
  assert.equal(g.accepted,false);assert.ok(g.hardReasons.includes('pose-translation-jump'));
});

test('live gate rejects reprojection regression and keeps previous accepted state',()=>{
  const a=snap([0,.1,.2]),b=snap([0,.102,.203]);const g=evaluateLiveCandidate({baselineStats:stats(.8,.10),candidateStats:{...stats(2.0,.10),energy:40},baselineSnapshot:a,candidateSnapshot:b});
  assert.equal(g.accepted,false);assert.ok(g.hardReasons.includes('reprojection-regression'));
});

test('pose delta is computed only on common frame ids',()=>{
  const a={frames:[{frameId:'a',poseEstimate:pose(0)},{frameId:'b',poseEstimate:pose(.1)}]},b={frames:[{frameId:'b',poseEstimate:pose(.11)},{frameId:'c',poseEstimate:pose(.2)}]};const d=poseSnapshotDelta(a,b);assert.equal(d.commonFrames,1);assert.ok(Math.abs(d.maxTranslation-.01)<1e-9);
});

import {buildLiveGraphWindow} from '../js/probabilistic/live_graph_window.js';
test('live graph window stays bounded but reintroduces a useful old loop endpoint',()=>{
  const frames=Array.from({length:30},(_,i)=>({frameId:`f${i}`,posePrior:pose(i*.03),poseEstimate:pose(i*.03),K:{fx:100,fy:100,cx:50,cy:50,width:100,height:100},photo:{width:10,height:10,gray:new Uint8Array(100),rgb:new Uint8Array(300)}}));
  const edgeFactors=[{aId:'f29',bId:'f3',loop:true,visualConfidence:.9}],landmarkFactors=[{id:'L',point:[0,0,2],measurements:[{frameId:'f3',u:2,v:2},{frameId:'f29',u:3,v:3}]}],g={format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors,alvaFactors:[],landmarkFactors,deepFactors:[],mvsFactors:[],cameraModel:{locked:true}};
  const w=buildLiveGraphWindow(g,{maxFrames:8,maxLoopFrames:2,includePhotoPixels:false});assert.ok(w.frames.length<=14);assert.ok(w.frames.some(f=>f.frameId==='f3'));assert.ok(w.frames.some(f=>f.frameId==='f29'));assert.equal(w.edgeFactors.length,1);assert.equal(w.landmarkFactors.length,1);assert.equal(w.frames.at(-1).photo.rgb.length,0);assert.equal(w.windowDiagnostics.totalFrames,30);assert.ok(w.windowDiagnostics.excludedFrames>0);assert.ok(w.windowDiagnostics.oldLoopFrames.includes('f3'));assert.equal(w.windowDiagnostics.includePhotoPixels,false);
});

test('live gate uses robust reprojection for acceptance while preserving raw outlier diagnostics',()=>{
  const a=snap([0,.1,.2]),b=snap([0,.102,.204]);
  const base={...stats(19.6,.1),reprojectionRobustRmse:2.25,reprojectionMedianPx:1.35,reprojectionP90Px:5.8,edgeSwitches:{edges:6,rejected:0}};
  const cand={...stats(20.1,.1),reprojectionRobustRmse:1.85,reprojectionMedianPx:1.12,reprojectionP90Px:5.2,energy:22,edgeSwitches:{edges:6,rejected:0}};
  const g=evaluateLiveCandidate({baselineStats:base,candidateStats:cand,baselineSnapshot:a,candidateSnapshot:b});
  assert.equal(g.accepted,true,g.hardReasons.join(','));
  assert.ok(!g.hardReasons.includes('robust-reprojection-absolute'));
  assert.ok(g.warnings.includes('raw-reprojection-outliers-high'));
  assert.equal(g.metrics.candidateRawReprojectionPx,20.1);
  assert.equal(g.metrics.candidateReprojectionPx,1.85);
});

test('live gate prevents total RGB edge collapse even when scalar energy improves',()=>{
  const a=snap([0,.1,.2]),b=snap([0,.101,.202]);
  const base={...stats(2,.1),reprojectionRobustRmse:1.8,edgeSwitches:{edges:5,rejected:0,mean:.72},energy:40};
  const cand={...stats(1.7,.09),reprojectionRobustRmse:1.65,edgeSwitches:{edges:5,rejected:5,mean:.02},energy:10};
  const g=evaluateLiveCandidate({baselineStats:base,candidateStats:cand,baselineSnapshot:a,candidateSnapshot:b});
  assert.equal(g.accepted,false);assert.ok(g.hardReasons.includes('rgb-edge-collapse'));
});
