import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildUnifiedPostScanKeyframePlan} from '../js/reconstruction/postscan_mvs_plan.js';
import {solveGlobalAffineDepthCalibration} from '../js/probabilistic/depth_calibration_hierarchy.js';
import {classifyDenseDepthAuthority,evaluateDepthGeometryPolicy} from '../js/probabilistic/depth_commit_policy.js';
import {evaluateFinalGeometryPolicy} from '../js/probabilistic/geometry_commit_policy.js';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';
import {StablePhotoBank} from '../js/reconstruction/stable_photo_bank.js';

const K={fx:100,fy:100,cx:50,cy:40,width:100,height:80};
const pose=x=>({p:[x,0,0],q:[0,0,0,1]});

function planFrame(i){return {frameId:`f${i}`,id:`f${i}`,at:i*400,pose:pose(i*.03),K:{...K},gray:new Uint8Array(100*80),rgba:new Uint8ClampedArray(100*80*4),features:Array.from({length:40},()=>({})),trackingValid:true,photoQuality:{stableQuality:.8,detail:9}};}

test('camera intrinsics and distortion are frozen from the scan profile',()=>{
  const graph=new ProbabilisticFactorGraph(),raster={width:100,height:80,gray:new Uint8Array(100*80),rgba:new Uint8ClampedArray(100*80*4),features:[]};
  graph.addFrame({...raster,frameId:'k0',pose:pose(0),K:{...K},D:[.01,-.02,0,0]});
  const second=graph.addFrame({...raster,frameId:'k1',pose:pose(.1),K:{...K,fx:180,fy:170},D:[9,9,9,9]});
  assert.equal(graph.cameraModel.locked,true);assert.deepEqual(graph.cameraModel.D,[.01,-.02,0,0]);
  assert.equal(second.K.fx,K.fx);assert.equal(second.K.fy,K.fy);assert.ok(second.intrinsicsDeviation.fxRel>.5);
});

test('one atomic planner binds every MVS reference to an identical Deep frame id',()=>{
  const plan=buildUnifiedPostScanKeyframePlan(Array.from({length:36},(_,i)=>planFrame(i)),{maxJobs:28,minSources:2,maxSources:4,minBaseline:.014,maxBaseline:1.5,maxAngleRad:.38});
  assert.equal(plan.format,'ROOMSCAN-POSTSCAN-KEYFRAME-PLAN-1');
  assert.equal(plan.jobs.length,plan.keyframeIds.length);
  assert.ok(plan.keyframeIds.length>=20&&plan.keyframeIds.length<=28,plan.stats);
  assert.deepEqual(plan.jobs.map(j=>String(j.ref.frameId)),plan.keyframeIds);
  assert.equal(plan.stats.deepRequired,plan.stats.mvsReferences);
});

function affineScene(){
  const frames=Array.from({length:6},(_,i)=>({frameId:`d${i}`,posePrior:pose(0),poseEstimate:pose(0),poseCov:{diag:[1e-6,1e-6,1e-6,1e-7,1e-7,1e-7]},K:{...K},width:100,height:80})),deepFactors=[];
  for(const f of frames){const raw=new Float32Array(10*8);for(let y=0;y<8;y++)for(let x=0;x<10;x++)raw[y*10+x]=.15+.06*x+.015*y;deepFactors.push({frameId:f.frameId,cols:10,rows:8,raw,quality:{suspicious:false}});}
  const landmarks=[];let n=0;
  for(let gy=1;gy<7;gy++)for(let gx=1;gx<9;gx+=2){const u=(gx+.5)*10,v=(gy+.5)*10,raw=.15+.06*gx+.015*gy,rho=.72*raw+.48,z=1/rho,p=[(u-K.cx)/K.fx*z,(v-K.cy)/K.fy*z,z],measurements=frames.map(f=>({frameId:f.frameId,u,v,probability:.98}));landmarks.push({id:`L${n++}`,point:p,covariance:[1e-5,0,0,1e-5,0,2e-5],probability:.98,relativeDepthSigma:.012,posteriorReprojectionPx:.2,leaveOneViewOutReprojectionPx:.25,triangulationAngleRad:.03,measurements});}
  // It is geometrically too weak and must not calibrate Deep.
  landmarks.push({id:'weak-2v',point:[0,0,2],probability:.5,relativeDepthSigma:.3,measurements:[{frameId:'d0',u:50,v:40,probability:.5},{frameId:'d1',u:50,v:40,probability:.5}]});
  return {frames,deepFactors,landmarks};
}

test('production Deep calibration has only one scan-wide affine scale and shift',()=>{
  const model=solveGlobalAffineDepthCalibration({...affineScene(),minGlobalFrames:3,minGlobalAnchors:80,iterations:10});
  assert.equal(model.format,'ROOMSCAN-DEPTH-CAL-GLOBAL-AFFINE-1');
  assert.equal(model.global.dof,2);assert.equal(model.stats.degreesOfFreedom,2);
  assert.equal(model.stats.globalAffineReady,true,model.stats);
  assert.ok(model.stats.medianRelativeResidual<.02,model.stats);
  assert.ok(model.stats.leaveOneFrameOutFrames>=3,model.stats);
  assert.ok(model.stats.leaveOneFrameOutMedianRelativeResidual<.03,model.stats);
  assert.ok(model.stats.ordinalAgreement>.95,model.stats);
  assert.ok(model.frames.every(f=>Math.abs(f.a-model.frames[0].a)<1e-12&&Math.abs(f.b-model.frames[0].b)<1e-12));
  assert.ok(model.stats.anchorSelection.rejectedGeometry+model.stats.anchorSelection.rejectedSupport>=1,model.stats.anchorSelection);
  const policy=evaluateDepthGeometryPolicy(model,{meanDepthConfidence:.8});assert.equal(policy.commitAllowed,true,policy);
});

test('Deep authority follows anchor / two-independent-view / prior hierarchy',()=>{
  assert.equal(classifyDenseDepthAuthority({classification:'trusted',independentSupport:1,hasMetricAnchor:true}).level,'high');
  const cross=classifyDenseDepthAuthority({classification:'trusted',independentSupport:2,hasMetricAnchor:false});assert.equal(cross.level,'medium');assert.equal(cross.committable,true);
  assert.equal(classifyDenseDepthAuthority({classification:'trusted',independentSupport:1,hasMetricAnchor:false}).committable,false);
  assert.equal(classifyDenseDepthAuthority({classification:'conflicting',independentSupport:4,hasMetricAnchor:true}).committable,false);
});

test('dense cloud needs thousands of samples, while mesh failure cannot erase a valid cloud',()=>{
  const base={meshQuality:{componentCount:9,largestComponentFraction:.35,fragmentationScore:.65,faceCount:9000,bbox:{diagonal:8},status:'fragmented'},rawMeshQuality:{componentCount:12,largestComponentFraction:.3,faceCount:10000,bbox:{diagonal:8}},meshCleanup:{discardedVertexFraction:.04},frames:[{poseEstimate:pose(0)},{poseEstimate:pose(2)}],mvsValidation:{poseBoundFactors:20,legacyPoseBoundFactors:0,committed:2000},depthGeometryPolicy:{commitAllowed:true}};
  const sparse=evaluateFinalGeometryPolicy({...base,surfaceConsensus:{authoritative:180,occupiedCells:80,medianConfidence:.6},gaussianCount:180});assert.equal(sparse.splatCommitReady,false);
  const dense=evaluateFinalGeometryPolicy({...base,surfaceConsensus:{authoritative:1800,occupiedCells:120,medianConfidence:.6},gaussianCount:1800});assert.equal(dense.splatCommitReady,true,dense);assert.equal(dense.meshCommitReady,false,dense);
});

test('production closure order freezes RGB poses before MVS and runs Deep on those references',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),finish=app.slice(app.indexOf('async function finishScan'),app.indexOf('async function persistCurrentSession'));
  const rgb=finish.indexOf('reconcilePostScanRgbScaffold'),plan=finish.indexOf('queueArchiveMvsPlan'),mvs=finish.indexOf('drainPostScanMvsBacklog'),deep=finish.indexOf('processDeepBatchPipelined');
  assert.ok(rgb>=0&&rgb<plan&&plan<mvs&&mvs<deep,{rgb,plan,mvs,deep});
  assert.match(finish,/missingDeep/);assert.match(finish,/poseFrozen:true/);
  assert.doesNotMatch(finish,/processArchivedDeepAdaptive/);
});

test('scale-free Alva translation cannot erase the RGB archive',()=>{
  const bank=new StablePhotoBank({minIntervalMs:80,maxSide:100,minDetail:1,maxTranslationSpeedAlva:.01,maxAngularSpeedRad:1});
  const a={...planFrame(0),width:100,height:80},b={...planFrame(1),width:100,height:80};a.at=100;b.at=300;b.pose=pose(50);
  // Add visible detail; the deliberately absurd Alva translation gauge must not
  // be interpreted as metres per second before the metric bridge is locked.
  for(let i=0;i<a.gray.length;i++){a.gray[i]=(i*17)&255;b.gray[i]=(i*19)&255;}
  assert.equal(bank.consider(a,{trackingValid:true,pose:a.pose},a.K,{metricLocked:false}).ok,true);
  assert.equal(bank.consider(b,{trackingValid:true,pose:b.pose},b.K,{metricLocked:false}).ok,true);
});

test('finish cannot launch reconstruction from a one-pose trajectory',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),cfg=fs.readFileSync(new URL('../js/config.js',import.meta.url),'utf8'),finish=app.slice(app.indexOf('async function finishScan'),app.indexOf('async function persistCurrentSession'));
  assert.match(cfg,/finishMinTrackedKeyframes:4/);assert.match(app,/finish-blocked-insufficient-alva-scaffold/);
  assert.ok(finish.indexOf('finish-blocked-insufficient-alva-scaffold')<finish.indexOf('stopCaptureFastLane()'));
});

test('an observed baseline scaffold survives a worse recovery candidate',()=>{
  const runtime=fs.readFileSync(new URL('../js/probabilistic/single_optimizer_runtime.js',import.meta.url),'utf8');
  assert.match(runtime,/baselineAccepted=!!basePolicy\.observed/);assert.match(runtime,/selection=candidateAccepted\?'candidate':baselineAccepted\?'baseline-observed'/);assert.match(runtime,/selectedSnapshot=candidateAccepted\?candidateSnapshot:baseSnapshot/);assert.match(runtime,/candidateAccepted=safeReprojection&&safeMedian/);
});
