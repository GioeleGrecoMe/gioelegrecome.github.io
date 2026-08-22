import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildPostScanMvsDepthConsensus,applyPostScanMvsDepthConsensus} from '../js/reconstruction/mvs_depth_scale_consensus.js';
import {evaluateFinalGeometryPolicy} from '../js/probabilistic/geometry_commit_policy.js';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';

const pose=(x=0)=>({p:[x,0,0],q:[0,0,0,1]});
const K={fx:260,fy:260,cx:160,cy:240,width:320,height:480};
const seed=(depth)=>({u:160,v:240,depth,reprojectionPx:.4,angle:.02,relativeDepthSigma:.05,geometryProbability:.8,confidence:.8});
function payload(id,x,depths){return {ref:{id,frameId:id,pose:pose(x),K,width:320,height:480},sources:[],sparseSeeds:depths.map(seed),localSparseRange:{near:Math.min(...depths),median:depths[Math.floor(depths.length/2)],far:Math.max(...depths)}};}

function landmarkSnapshot(){
  const landmarks=[];let id=0;
  for(let z=1.2;z<=6.0;z+=.2)for(const x of [-.7,-.35,0,.35,.7])landmarks.push({id:`L${id++}`,point:[x,0,z],probability:.9});
  return {landmarks};
}

test('post-scan MVS uses optimized RGB landmarks as one shared scale authority',()=>{
  const ps=[payload('a',0,[1.8,2,2.2,2.4]),payload('b',.15,[30,40,50,60]),payload('c',.30,[.08,.10,.12,.14])];
  const c=buildPostScanMvsDepthConsensus(ps,{optimizerSnapshot:landmarkSnapshot(),minReliableSeeds:4,minReliableFrames:2,minLandmarkSeeds:8});
  assert.equal(c.ready,true);assert.equal(c.mode,'shared-landmark-consensus');assert.equal(c.scaleSource,'optimized-rgb-landmarks');
  assert.ok(c.median>1&&c.median<6,c);assert.ok(c.far<20,c);assert.ok(c.near>.05,c);
  for(const p of ps)applyPostScanMvsDepthConsensus(p,c);
  assert.ok(ps.every(p=>p.near===c.near&&p.far===c.far));
  assert.equal(ps[1].depthScaleConsensus.localScaleOutlier,true);
  assert.equal(ps[2].depthScaleConsensus.localScaleOutlier,true);
});

test('weak local triangulation still falls back to a shared view-balanced envelope when landmarks are unavailable',()=>{
  const ps=[payload('a',0,[1,1.2,1.4,1.6,1.8,2]),payload('b',.2,[1.1,1.3,1.5,1.7,1.9,2.1])];
  const c=buildPostScanMvsDepthConsensus(ps,{minReliableSeeds:8,minReliableFrames:2,minLandmarkSeeds:8});
  assert.equal(c.ready,true);assert.equal(c.mode,'shared-sparse-consensus');assert.ok(c.near<c.median&&c.median<c.far);
});

test('MVS radius survives factor-graph packing',()=>{
  const g=new ProbabilisticFactorGraph();
  const frame={id:'f0',frameId:'f0',captureAt:0,pose:pose(0),K,width:320,height:480,gray:new Uint8Array(320*480),features:[]};
  g.addFrame(frame);g.addMvs('f0',[{p:[0,0,2],u:160,v:240,depth:2,confidence:.7,probability:.75,radius:.083,sigmaDepth:.05,color:[10,20,30],normal:[0,0,-1]}],{estimatedPose:pose(0),sourceFrames:['f1'],stage:'test'});
  assert.equal(g.mvsFactors.length,1);assert.ok(Math.abs(g.mvsFactors[0].radius[0]-.083)<1e-5);
  const restored=ProbabilisticFactorGraph.fromState(g.exportState());assert.ok(Math.abs(restored.mvsFactors[0].radius[0]-.083)<1e-5);
});

test('authoritative splats can commit while a fragmented mesh remains withheld',()=>{
  const frames=[{poseEstimate:pose(0)},{poseEstimate:pose(2)}];
  const p=evaluateFinalGeometryPolicy({meshQuality:{componentCount:9,largestComponentFraction:.39,fragmentationScore:.61,faceCount:39000,bbox:{diagonal:12.5},status:'fragmented'},rawMeshQuality:{componentCount:25,largestComponentFraction:.32,faceCount:40000,bbox:{diagonal:12.8}},meshCleanup:{discardedVertexFraction:.02},surfaceConsensus:{authoritative:140,occupiedCells:140,medianConfidence:.44},gaussianCount:140,frames,sparseDepthEnvelope:{q90:9},mvsValidation:{poseBoundFactors:8,legacyPoseBoundFactors:0,committed:140},depthGeometryPolicy:{commitAllowed:false}});
  assert.equal(p.splatCommitReady,true,p);assert.equal(p.meshCommitReady,false,p);assert.equal(p.commitReady,false,p);assert.match(p.reason,/fragmented/);
});

test('V30.54 production path preserves global MVS scale, footprint and splat/mesh authority separation',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),sparse=fs.readFileSync(new URL('../js/dense/sparse_depth_anchors.js',import.meta.url),'utf8'),joint=fs.readFileSync(new URL('../js/probabilistic/joint_optimizer.js',import.meta.url),'utf8'),runtime=fs.readFileSync(new URL('../js/probabilistic/single_optimizer_runtime.js',import.meta.url),'utf8'),fusion=fs.readFileSync(new URL('../js/dense/fusion_core.js',import.meta.url),'utf8');
  assert.match(sparse,/Math\.max\(\.0015,minAngleRad\)/);
  assert.match(app,/optimizerSnapshot:snapshot/);assert.match(app,/mvs-postscan-scale-consensus/);
  assert.match(joint,/storedRadius/);assert.match(joint,/Math\.sqrt\(Math\.max\(\.001,s\.probability/);
  assert.match(fusion,/sourceKind==='verified'&&!hasExplicitProbability\?rawConfidence/);
  assert.match(runtime,/splatCommitReady/);assert.match(runtime,/mesh-commit-withheld/);
  assert.match(app,/SPLAT GLOBALE COMMITTED/);assert.match(app,/state\.mesh=meshReady\?diagnosticMesh:null/);
});
