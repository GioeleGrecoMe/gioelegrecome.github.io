import test from 'node:test';
import assert from 'node:assert/strict';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';
import {classifyResidualCauses} from '../js/probabilistic/residual_cause_model.js';
import {SwitchableAlvaEdgeModel} from '../js/probabilistic/alva_switchable_edges.js';
import {DenseDepthConsistencyEvaluator} from '../js/probabilistic/cross_depth_consistency.js';
import {SubmapPoseGraph} from '../js/probabilistic/submap_pose_graph.js';

const K={fx:220,fy:220,cx:80,cy:60,width:160,height:120};
const pose=(x=0,q=[0,0,0,1])=>({p:[x,0,0],q});

test('photo edge indices are resolved to persistent frameId before factor-graph storage',()=>{
  const g=new ProbabilisticFactorGraph(),gray=new Uint8Array(160*120);
  g.addFrame({frameId:'photo-A',pose:pose(0),K,width:160,height:120,gray,features:[]});
  g.addFrame({frameId:'photo-B',pose:pose(.1),K,width:160,height:120,gray,features:[]});
  const n=g.addPhotoEdges([{a:0,b:1,visualConfidence:.9,matches:[]}]);
  assert.equal(n,1);assert.equal(g.edgeFactors[0].aId,'photo-A');assert.equal(g.edgeFactors[0].bId,'photo-B');assert.equal(g.alvaFactors.length,1);
});

test('spatial residual signature separates low-dimensional pose-like error from local Deep failure',()=>{
  const global=[];for(let y=0;y<8;y++)for(let x=0;x<10;x++)global.push({u:x*20,v:y*18,r:.025+.00022*(x*20-90),w:1});
  const local=[];for(let y=0;y<8;y++)for(let x=0;x<10;x++){const hit=x>=3&&x<=5&&y>=2&&y<=4;local.push({u:x*20,v:y*18,r:hit?.18:0,w:1});}
  const a=classifyResidualCauses(global,{width:200,height:150,rgbReprojectionPx:3.2,poseImprovement:.6}),b=classifyResidualCauses(local,{width:200,height:150,rgbReprojectionPx:.5,poseImprovement:0});
  assert.ok(a.poseError>a.depthLocal,{a});assert.ok(b.depthLocal>b.poseError,{b});
});

test('relative Alva translation can switch off when RGB geometry strongly contradicts it',()=>{
  const frames=[{frameId:'a',posePrior:pose(0),poseEstimate:pose(0),poseCov:{diag:[1e-4,1e-4,1e-4,1e-5,1e-5,1e-5]}},{frameId:'b',posePrior:pose(.10),poseEstimate:pose(.42),poseCov:{diag:[1e-4,1e-4,1e-4,1e-5,1e-5,1e-5]}}];
  const m=new SwitchableAlvaEdgeModel(frames);for(let i=0;i<4;i++)m.update(frames,{rgbFrameSupport:new Map([['a',.98],['b',.98]]),poseImprovement:new Map([['a',.7],['b',.8]])});
  assert.ok(m.edges[0].translationSwitch<.2,m.edges[0]);assert.ok(m.frameConfidence('b')<.5);
});

test('dense consistency is leave-one-view-out and reports independent multiview support',()=>{
  const frames=[-0.20,0,.20].map((x,i)=>({frameId:`f${i}`,posePrior:pose(x),poseEstimate:pose(x),poseCov:{diag:[1e-6,1e-6,1e-6,1e-7,1e-7,1e-7]},K,width:160,height:120}));
  const mk=(id,val)=>({frameId:id,cols:16,rows:12,raw:new Float32Array(16*12).fill(val)}),deep=[mk('f0',2),mk('f1',99),mk('f2',2)];
  const cal={domain:{center:0,scale:1},gamma:[0,0],frames:frames.map(f=>({frameId:f.frameId,a:(.5/1.8),b:0,confidence:.9,residualSigma:.005})),frameMap:new Map()};
  // raw=2 -> rho=.5 -> z=2. Source raw is deliberately nonsense: the evaluator
  // receives the source hypothesis z and validates it only against OTHER views.
  const edges=[{aId:'f1',bId:'f0',visualConfidence:.95},{aId:'f1',bId:'f2',visualConfidence:.95}],ev=new DenseDepthConsistencyEvaluator({frames,deepFactors:deep,calibration:cal,photoEdges:edges,maxNeighbors:4});
  const r=ev.evaluate('f1',80,60,2,{sigmaDepth:.01});assert.equal(r.class,'trusted');assert.equal(r.support,2);assert.ok(r.independentSupport>=2,r);assert.deepEqual(new Set(r.supportIds),new Set(['f0','f2']));
});

test('submap loop graph adjusts only rigid submap poses',()=>{
  const a=Math.PI/12,c=Math.cos(a),s=Math.sin(a),R=[c,0,s,0,1,0,-s,0,c],subs=[0,1,2].map(i=>({id:`S${i}`,anchorPose:pose(i),frameIds:[`f${i}`]})),frames=[0,1,2].map(i=>({frameId:`f${i}`,poseEstimate:pose(i),posePrior:pose(i)})),edgeModel={pairWeight:()=>.95};
  const g=new SubmapPoseGraph(subs,frames,{photoEdges:[{aId:'f0',bId:'f2',loop:true,rotationBToA:R}],edgeModel}).optimize(10);const before=[0,0,0,1],after=g.nodes[2].pose.q;assert.equal(g.stats().loops,1);assert.ok(Math.hypot(after[0]-before[0],after[1]-before[1],after[2]-before[2],after[3]-before[3])>1e-4,{after});g.apply();assert.deepEqual(subs[2].anchorPose.q,after);
});

import {ProbabilisticJointOptimizer} from '../js/probabilistic/joint_optimizer.js';

test('committed dense surface accepts only leave-one-out confirmed Deep samples',()=>{
  const frames=[-.20,0,.20].map((x,i)=>({frameId:`c${i}`,posePrior:pose(x),poseEstimate:pose(x),poseCov:{diag:[1e-6,1e-6,1e-6,1e-7,1e-7,1e-7]},K,width:160,height:120,photo:{width:16,height:12,rgb:new Uint8Array(16*12*3).fill(140)}}));
  const deepFactors=frames.map(f=>({frameId:f.frameId,cols:16,rows:12,raw:new Float32Array(16*12).fill(2)})),photoEdges=[];for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)photoEdges.push({aId:`c${i}`,bId:`c${j}`,visualConfidence:.95,rotationBToA:[1,0,0,0,1,0,0,0,1],matches:Array.from({length:20},()=>({probability:.95}))});
  const opt=new ProbabilisticJointOptimizer({format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors:photoEdges,alvaFactors:[],landmarkFactors:[],deepFactors,mvsFactors:[]});opt.depthCalibration={format:'ROOMSCAN-DEPTH-CAL-HIER-1',representation:'inverse-depth',domain:{center:0,scale:1},gamma:[0,0],frames:frames.map(f=>({frameId:f.frameId,a:.5/1.8,b:0,confidence:.95,residualSigma:.004,anchorCount:0})),stats:{frames:3}};
  const out=opt.rebuild({voxel:.05,hashVoxel:.035,maxSurfels:4000,maxTriangles:4000,maxDeepSamples:1000,submapSize:4,submapOverlap:1});assert.equal(out.stats.leaveOneViewOut,true);assert.equal(out.stats.candidateConfirmedSplit,true);assert.ok(out.stats.deepConfirmed>0,out.stats);assert.ok(out.stats.deepCount>0,out.stats);assert.ok(out.stats.submapPoseGraph.nodes>=1,out.stats);
});

test('RGB acquisition quality lowers authority for blank/clipped frames without inventing geometry',async()=>{
  const {assessRgbFrameQuality}=await import('../js/probabilistic/frame_quality.js');
  const w=120,h=80,blank=new Uint8Array(w*h).fill(255),textured=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)textured[y*w+x]=((x>>2)+(y>>2))&1?220:30;
  const a=assessRgbFrameQuality(blank,w,h),b=assessRgbFrameQuality(textured,w,h);assert.equal(a.severe,true);assert.ok(b.score>a.score,{a,b});assert.ok(b.textureCoverage>.5,{a,b});
});

test('switch posteriors survive optimizer snapshot/restore',()=>{
  const frames=[{frameId:'r0',posePrior:pose(0),poseEstimate:pose(0),poseCov:{diag:[1e-4,1e-4,1e-4,1e-5,1e-5,1e-5]},K,width:160,height:120},{frameId:'r1',posePrior:pose(.1),poseEstimate:pose(.1),poseCov:{diag:[1e-4,1e-4,1e-4,1e-5,1e-5,1e-5]},K,width:160,height:120}],edgeFactors=[{aId:'r0',bId:'r1',visualConfidence:.8,rotationBToA:[1,0,0,0,1,0,0,0,1],matches:[]}],graph={format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors,alvaFactors:[],landmarkFactors:[],deepFactors:[],mvsFactors:[]};
  const a=new ProbabilisticJointOptimizer(graph);a.edgeModel.edges[0].switch=.123;a.alvaModel.rebuild(frames);a.alvaModel.edges[0].translationSwitch=.087;a.alvaModel.edges[0].rotationSwitch=.731;a.alvaModel.edges[0].switch=Math.sqrt(.087*.731);const snap=a.snapshot(),b=new ProbabilisticJointOptimizer(graph,{initial:snap});assert.ok(Math.abs(b.edgeModel.edges[0].switch-.123)<1e-9);assert.ok(Math.abs(b.alvaModel.edges[0].translationSwitch-.087)<1e-9);assert.ok(Math.abs(b.alvaModel.edges[0].rotationSwitch-.731)<1e-9);
});

test('post-scan estimator runs RGB pose loop faster than Deep feedback loop after explicit warmup',()=>{
  const frames=[0,.1].map((x,i)=>({frameId:`q${i}`,posePrior:pose(x),poseEstimate:pose(x),poseCov:{diag:[1e-4,1e-4,1e-4,1e-5,1e-5,1e-5]},K,width:160,height:120})),graph={format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors:[],alvaFactors:[],landmarkFactors:[],deepFactors:[],mvsFactors:[]},opt=new ProbabilisticJointOptimizer(graph,{depthFeedbackEvery:2,rgbWarmupIterations:0});opt.step(1);assert.equal(opt.lastStats.feedbackPhase,'depth-feedback');opt.step(1);assert.equal(opt.lastStats.feedbackPhase,'rgb-fast');opt.step(1);assert.equal(opt.lastStats.feedbackPhase,'depth-feedback');
});

test('default estimator bootstraps RGB scaffold before permitting Deep feedback',()=>{
  const frames=[0,.1].map((x,i)=>({frameId:`w${i}`,posePrior:pose(x),poseEstimate:pose(x),poseCov:{diag:[1e-4,1e-4,1e-4,1e-5,1e-5,1e-5]},K,width:160,height:120})),graph={format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors:[],alvaFactors:[],landmarkFactors:[],deepFactors:[],mvsFactors:[]},opt=new ProbabilisticJointOptimizer(graph,{depthFeedbackEvery:2});opt.step(1);assert.equal(opt.lastStats.feedbackPhase,'rgb-bootstrap');assert.equal(opt.depthCalibration,null);opt.step(1);assert.equal(opt.lastStats.feedbackPhase,'rgb-bootstrap');assert.equal(opt.depthCalibration,null);opt.step(1);assert.equal(opt.lastStats.feedbackPhase,'depth-feedback');
});
