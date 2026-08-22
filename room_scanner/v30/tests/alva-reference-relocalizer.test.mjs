import test from 'node:test';
import assert from 'node:assert/strict';
import {AlvaReferenceRelocalizer,relocalizationPoseCompatible} from '../js/reconstruction/alva_reference_relocalizer.js';
import {projectPoint,qNormalize} from '../js/slam/math.js';

test('visual reference sidecar recovers a posed landmark view without becoming a trajectory source',()=>{
  const K={fx:340,fy:338,cx:160,cy:120,width:320,height:240},truth={p:[.08,-.04,.03],q:qNormalize([.005,-.008,.003,.99995])};
  const world=[[-.55,-.35,2.2],[-.2,.25,2.5],[.38,-.24,2.8],[.58,.30,3.0],[-.48,.42,3.2],[.08,-.08,2.1],[.25,.36,2.65],[-.1,-.42,2.9],[.62,-.02,3.35]];
  const descriptor=i=>Array.from({length:20},(_,j)=>(31*i+17*j*j+11*i*j+23)%251);
  const features=world.map((p,i)=>{const uv=projectPoint(truth,K,p);return {x:uv.u,y:uv.v,referenceDesc:descriptor(i)};});
  const graph={frames:[{frameId:'known',poseEstimate:{p:[.11,-.02,.01],q:[0,0,0,1]}}],landmarkFactors:world.map((point,i)=>({id:`L${i}`,refFrameId:'known',point,descriptor:descriptor(i),probability:.92,measurements:[{},{}]}))};
  const sidecar=new AlvaReferenceRelocalizer({minMatches:8,minInliers:6,maxRmsePx:1,intervalMs:0});const out=sidecar.evaluate({features,K,graph,at:1});
  assert.equal(out.ok,true,out.reason);assert.equal(out.candidateFrameId,'known');assert.ok(out.inliers>=8,out.inliers);assert.ok(out.rmsePx<1,out.rmsePx);assert.equal(relocalizationPoseCompatible(truth,out,{maxTranslation:.2,maxRotationRad:.2}),true);assert.equal(relocalizationPoseCompatible({p:[4,0,0],q:[0,0,0,1]},out,{maxTranslation:.2,maxRotationRad:.2}),false);
});
