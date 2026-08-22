import test from 'node:test';
import assert from 'node:assert/strict';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';
import {DeepSequenceModel} from '../js/probabilistic/deep_sequence_model.js';
import {ProbabilisticJointOptimizer} from '../js/probabilistic/joint_optimizer.js';
import {addPoseUncertaintyToPointCovariance} from '../js/probabilistic/pose_uncertainty.js';
import {estimateDenseDepth} from '../js/dense/plane_sweep_core.js';
import {projectPoint} from '../js/slam/math.js';
import {validateTumPublicData} from '../tools/validate_public_data.mjs';

const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240};
const pose=x=>({p:[x,0,0],q:[0,0,0,1]});

test('factor graph merges repeated cross-keyframe evidence instead of double-counting a landmark',()=>{
  const g=new ProbabilisticFactorGraph({maxFrames:20});for(let i=0;i<3;i++)g.addFrame({frameId:`f${i}`,id:`f${i}`,pose:pose(i*.08),poseCov:{diag:[1e-4,1e-4,1e-4,1e-5,1e-5,1e-5]},K,width:320,height:240,gray:new Uint8Array(320*240),features:[]});
  g.addSparseAnchors({frameId:'f0'},[{trackId:'a',p:[0,0,2],depth:2,covariance:[.001,0,0,.001,0,.004],geometryProbability:.8,measurements:[{frameId:'f0',u:160,v:120,probability:.9},{frameId:'f1',u:148,v:120,probability:.8}]}]);
  g.addSparseAnchors({frameId:'f1'},[{trackId:'b',p:[.004,0,2.01],depth:2.01,covariance:[.001,0,0,.001,0,.004],geometryProbability:.85,measurements:[{frameId:'f1',u:148.5,v:120.2,probability:.9},{frameId:'f2',u:136,v:120,probability:.8}]}]);
  assert.equal(g.landmarkFactors.length,1);assert.equal(new Set(g.landmarkFactors[0].measurements.map(x=>x.frameId)).size,3);assert.ok(g.landmarkFactors[0].covariance[5]>.001,'correlated repeats must not collapse covariance to zero');
});

test('pose uncertainty is propagated into point information instead of treating Alva poses as exact',()=>{
  const c=[1e-4,0,0,1e-4,0,4e-4],lo=addPoseUncertaintyToPointCovariance(c,{diag:[1e-6,1e-6,1e-6,1e-7,1e-7,1e-7]},[0,0,3],[0,0,0]),hi=addPoseUncertaintyToPointCovariance(c,{diag:[4e-4,4e-4,4e-4,1e-4,1e-4,1e-4]},[0,0,3],[0,0,0]);assert.ok(hi[0]>lo[0]*5&&hi[3]>lo[3]*5&&hi[5]>lo[5]);
});

test('sequence Deep calibration resists a bad frame and keeps uncertainty explicit',()=>{
  const w=80,h=60,rw=40,rh=30,raw=new Float32Array(rw*rh);for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){const u=x/(rw-1)*(w-1),z=1.4+u/(w-1)+.2*y/(rh-1);raw[y*rw+x]=1/z;}
  const seeds=bad=>{const a=[];for(let y=8;y<h-8;y+=10)for(let x=8;x<w-8;x+=10){const yy=y/(h-1)*(rh-1),z=1.4+x/(w-1)+.2*yy/(rh-1);a.push({u:x,v:y,depth:bad&&a.length%5===0?z*1.4:z,geometryProbability:.92,relativeDepthSigma:.03});}return a;},m=new DeepSequenceModel({minAnchors:5,minCells:3});let good;for(let i=0;i<6;i++)good=m.calibrate({rawDepth:raw,rawWidth:rw,rawHeight:rh,outWidth:w,outHeight:h,sparseSeeds:seeds(i===3),near:.5,far:5});assert.ok(good.ok);assert.ok(good.medianRelativeError<.02);assert.ok(good.sequenceSigma>=.025);assert.ok(good.posteriorConfidence>.8);
});

function texturedPlaneFrame(px,{w=96,h=72,z=2}={}){const k={fx:85,fy:85,cx:w/2,cy:h/2,width:w,height:h},gray=new Uint8Array(w*h),rgba=new Uint8ClampedArray(w*h*4),tex=(x,y)=>Math.max(0,Math.min(255,128+(Math.sin(x*17)+Math.sin(y*23)+Math.sin((x+y)*31)+Math.sin((x*2-y)*11))*25));for(let v=0;v<h;v++)for(let u=0;u<w;u++){const x=px+(u-k.cx)/k.fx*z,y=(v-k.cy)/k.fy*z,val=tex(x,y),i=v*w+u;gray[i]=val;rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=val;rgba[i*4+3]=255;}return {pose:pose(px),K:k,width:w,height:h,gray,rgba};}
test('a wrong Deep prior cannot self-confirm: coarse independent MVS probes escape it',()=>{const ref=texturedPlaneFrame(0),sources=[texturedPlaneFrame(-.12),texturedPlaneFrame(.12),texturedPlaneFrame(.22)],d=new Float32Array(ref.width*ref.height);d.fill(1.2);const r=estimateDenseDepth({ref,sources,K:ref.K,near:1,far:3,depthSteps:48,pixelStep:3,minViews:2,maxCost:.27,minConfidence:.07,depthPrior:{depth:d,width:ref.width,height:ref.height,confidence:.99},priorRelRange:.08,priorDepthSteps:12,priorProbeSteps:8});assert.ok(r.samples.length>250);assert.ok(r.medianDepth>1.75&&r.medianDepth<2.2,`median ${r.medianDepth}`);assert.ok(r.priorEscapeRatio>.5,`escape ${r.priorEscapeRatio}`);});

test('joint factor optimisation reduces reprojection error while keeping Alva as a pose prior',()=>{
  const trueFrames=[0,.08,.16,.24,.32].map((x,i)=>({frameId:`f${i}`,pose:pose(x)})),errs=[[0,0,0],[.012,.004,.002],[-.010,.006,-.002],[.014,-.005,.003],[-.009,-.004,-.002]],frames=trueFrames.map((f,i)=>({frameId:f.frameId,posePrior:{p:f.pose.p.map((v,k)=>v+errs[i][k]),q:[0,0,0,1]},poseEstimate:{p:f.pose.p.map((v,k)=>v+errs[i][k]),q:[0,0,0,1]},poseCov:{diag:[4e-4,4e-4,4e-4,1e-4,1e-4,1e-4]},K,width:320,height:240})),landmarkFactors=[];let id=0;
  for(let y=-.35;y<=.35;y+=.14)for(let x=-.55;x<=.55;x+=.18){const p=[x,y,2.2+.1*Math.sin(x*3)],ms=[];for(const f of trueFrames){const q=projectPoint(f.pose,K,p);if(q&&q.u>10&&q.u<310&&q.v>10&&q.v<230)ms.push({frameId:f.frameId,u:q.u,v:q.v,probability:.98});}if(ms.length>=4)landmarkFactors.push({id:`l${id++}`,point:[p[0]+.008*Math.sin(id),p[1]+.006*Math.cos(id),p[2]+.015*Math.sin(id*.7)],covariance:[4e-4,0,0,4e-4,0,1.6e-3],probability:.9,relativeDepthSigma:.04,measurements:ms});}
  const opt=new ProbabilisticJointOptimizer({format:'ROOMSCAN-PROB-GRAPH-1',frames,landmarkFactors,deepFactors:[],mvsFactors:[]},{posePriorScale:.35}),before=opt.computeStats();opt.step(12);const after=opt.computeStats();assert.ok(after.reprojectionRmse<before.reprojectionRmse*.15,`${before.reprojectionRmse}->${after.reprojectionRmse}`);assert.ok(after.poseShiftMean<.02,'pose corrections must remain small relative to Alva');assert.ok(opt.landmarks.every(l=>l.probability>0&&l.probability<1));
});

test('official TUM freiburg1_xyz public data validates trajectory integrity and real-texture matching',()=>{const r=validateTumPublicData();assert.ok(r.groundTruthSamples>=3000);assert.ok(r.precision>.94&&r.recall>.88);assert.ok(r.pathLengthM>7);assert.ok(r.reprojectionAfterPx<r.reprojectionBeforePx*.12);});

test('R30 v2 preserves typed probabilistic graph buffers for offline reprocessing',async()=>{
  const {encodeR30,decodeR30}=await import('../js/formats.js'),raw=new Float32Array([.1,.2,.3,.4]),blob=encodeR30({factorGraph:{format:'ROOMSCAN-PROB-GRAPH-1',frames:[],landmarkFactors:[],deepFactors:[{frameId:'f',cols:2,rows:2,raw}],mvsFactors:[]}}),decoded=await decodeR30(blob);assert.equal(decoded.format,'ROOMSCAN-R30-JSON-2');assert.ok(decoded.factorGraph.deepFactors[0].raw instanceof Float32Array);assert.deepEqual(Array.from(decoded.factorGraph.deepFactors[0].raw),Array.from(raw));
});
