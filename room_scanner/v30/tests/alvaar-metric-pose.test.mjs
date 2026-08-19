import test from 'node:test';
import assert from 'node:assert/strict';
import {alvaMatrixToPose,SlamEngine} from '../js/slam/slam_engine.js';
import {AlvaMetricBootstrap,applySimilarityPose} from '../js/slam/alva_metric_bootstrap.js';
import {qNormalize} from '../js/slam/math.js';

function alvaMatrixAt(x=0,y=0,z=0){return [1,0,0,0, 0,1,0,0, 0,0,1,0, x,-y,-z,1];}

test('AlvaAR matrix conversion matches Room Scanner signs',()=>{
  const p=alvaMatrixToPose([1,0,0,0, 0,1,0,0, 0,0,1,0, 1,2,3,1]);
  assert.deepEqual(p.p,[1,-2,-3]);
  assert.ok(Math.abs(p.q[0])<1e-9&&Math.abs(p.q[1])<1e-9&&Math.abs(p.q[2])<1e-9&&Math.abs(p.q[3]-1)<1e-9);
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
