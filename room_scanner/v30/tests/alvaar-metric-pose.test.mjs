import test from 'node:test';
import assert from 'node:assert/strict';
import {alvaMatrixToPose,SlamEngine} from '../js/slam/slam_engine.js';

test('AlvaAR matrix conversion matches official THREE connector signs',()=>{
  const m=[1,0,0,0, 0,1,0,0, 0,0,1,0, 1,2,3,1];
  const p=alvaMatrixToPose(m);
  assert.deepEqual(p.p,[1,-2,-3]);
  assert.ok(Math.abs(p.q[0])<1e-9&&Math.abs(p.q[1])<1e-9&&Math.abs(p.q[2])<1e-9&&Math.abs(p.q[3]-1)<1e-9);
});

test('SlamEngine uses Alva pose while estimating only the monocular metric scale',()=>{
  let i=0;
  const frontend={processFrame(){const x=.01*i++;return {count:20,features:[{x:10,y:10,desc:[1]}],matches:{count:1,items:[{dx:-1.5,dy:0}]},cameraPose:[1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1],framePoints:[],trackingMode:'alvaar-wasm'};}};
  const slam=new SlamEngine({frontend,K:{fx:300,fy:300,cx:160,cy:120,width:320,height:240},keyframeIntervalMs:1});
  slam.setMetricReference({pose:{p:[2,1,3],q:[0,0,0,1]},points:[[2,1,5],[2.2,1,5], [1.8,1,5]]});
  let r;
  for(let k=0;k<9;k++)r=slam.process({gray:new Uint8Array(320*240),imageData:{data:new Uint8ClampedArray(320*240*4)},width:320,height:240,at:k+1});
  assert.equal(r.trackingMode,'alvaar-wasm');
  assert.ok(r.alvaScale>0,'metric scale should converge from calibrated flow / Alva motion');
  assert.ok(Number.isFinite(r.pose.p[0]));
});
