import test from 'node:test';
import assert from 'node:assert/strict';
import {alvaMatrixToPose,SlamEngine} from '../js/slam/slam_engine.js';
import {AlvaMetricBootstrap,applySimilarityPose} from '../js/slam/alva_metric_bootstrap.js';
import {qNormalize,qRotate} from '../js/slam/math.js';

function alvaMatrixAt(x=0,y=0,z=0){return [1,0,0,0, 0,1,0,0, 0,0,1,0, x,-y,-z,1];}

test('AlvaAR matrix conversion matches Room Scanner signs',()=>{
  const p=alvaMatrixToPose([1,0,0,0, 0,1,0,0, 0,0,1,0, 1,2,3,1]);
  assert.deepEqual(p.p,[1,-2,-3]);
  assert.ok(Math.abs(p.q[0])<1e-9&&Math.abs(p.q[1])<1e-9&&Math.abs(p.q[2])<1e-9&&Math.abs(p.q[3]-1)<1e-9);
});


test('Alva pose uses one proper 180deg-X basis rotation for position AND orientation',()=>{
  // Native OpenGL/Three camera rotated +90deg about Y. Column-major c2w.
  const a=[0,0,-1,0, 0,1,0,0, 1,0,0,0, 1,2,3,1];
  const p=alvaMatrixToPose(a);
  assert.deepEqual(p.p,[1,-2,-3]);
  // In CV basis the local +Z forward direction must rotate coherently with the
  // converted quaternion, never as the old mirrored orientation.
  const f=qRotate(p.q,[0,0,1]);
  assert.ok(f[0]<-.999&&Math.abs(f[1])<1e-8&&Math.abs(f[2])<1e-8,`forward ${f}`);
});

test('one-shot bootstrap recovers a fixed Alva->metric Sim3',()=>{
  const truth={scale:2.5,qAlign:qNormalize([0,.1,0,.995]),translation:[1,-.2,3]};
  const b=new AlvaMetricBootstrap({minSamples:5,minMetricBaselineM:.05,maxPositionRmseM:.01,maxOrientationRmseRad:.01});
  let st;
  for(let i=0;i<7;i++){
    const raw={p:[i*.03,(i%2)*.02,.01*i],q:qNormalize([0,.02*i,0,1])};
    st=b.add(raw,applySimilarityPose(truth,raw),i);
  }
  assert.equal(st.ready,true);assert.ok(Math.abs(st.result.scale-truth.scale)<1e-8);assert.ok(st.result.positionRmseM<1e-8);
});

test('SlamEngine never synthesizes motion when Alva loses tracking and resumes on relocalization',()=>{
  let i=0;
  const seq=[alvaMatrixAt(0),alvaMatrixAt(.02),null,null,alvaMatrixAt(.021),alvaMatrixAt(.04)];
  const frontend={processFrame(){const cameraPose=seq[i++]??null;return {count:20,features:[{x:10,y:10,desc:[1]}],matches:{count:8,items:[]},cameraPose,framePoints:[]};}};
  const slam=new SlamEngine({frontend,K:{fx:300,fy:300,cx:160,cy:120,width:320,height:240},keyframeIntervalMs:1});
  slam.setWorldTransform({scale:2,qAlign:[0,0,0,1],translation:[1,0,0],source:'test'});
  const frames=seq.map((_,k)=>slam.process({gray:new Uint8Array(1),imageData:{data:new Uint8ClampedArray(4)},width:1,height:1,at:k+1}));
  assert.equal(frames[2].trackingMode,'alvaar-lost');assert.equal(frames[3].trackingMode,'alvaar-lost');
  assert.deepEqual(frames[2].pose,frames[1].pose,'lost pose must freeze');assert.equal(frames[2].newKeyframe,null);assert.equal(frames[3].newKeyframe,null);
  assert.equal(frames[4].trackingMode,'alvaar-relocalized');assert.ok(frames[4].newKeyframe,'relocalized Alva pose may resume keyframes');
  assert.equal(frames[5].trackingMode,'alvaar-wasm');
});

test('SlamEngine emits ~1 Hz observations even before Alva has an initial pose',()=>{
  const frontend={processFrame(){return {count:120,features:[],matches:{count:40,items:[]},cameraPose:null,framePoints:[],trackingMode:'alvaar-initializing'};}};
  const slam=new SlamEngine({frontend,K:{fx:300,fy:300,cx:160,cy:120,width:320,height:240},keyframeIntervalMs:950,observationIntervalMs:900,maxObservations:4});
  const a=slam.process({gray:new Uint8Array(1),imageData:{data:new Uint8ClampedArray(4)},width:1,height:1,at:1000});
  const b=slam.process({gray:new Uint8Array(1),imageData:{data:new Uint8ClampedArray(4)},width:1,height:1,at:1500});
  const c=slam.process({gray:new Uint8Array(1),imageData:{data:new Uint8ClampedArray(4)},width:1,height:1,at:1950});
  assert.ok(a.newObservation);assert.equal(b.newObservation,null);assert.ok(c.newObservation);
  assert.equal(c.trackingMode,'alvaar-initializing');assert.equal(c.newKeyframe,null);assert.equal(c.observations,2);
});
