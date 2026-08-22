import test from 'node:test';
import assert from 'node:assert/strict';
import {SlamEngine} from '../js/slam/slam_engine.js';

test('SlamEngine derived constructor is runtime-safe with fixed metric transform',()=>{
  const frontend={processFrame(){return {count:3,features:[{x:1,y:1,desc:[1]}],matches:{count:1,items:[]},cameraPose:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],framePoints:[]};}};
  const slam=new SlamEngine({frontend,K:{fx:320,fy:320,cx:160,cy:240,width:320,height:480},keyframeIntervalMs:1});
  let metricEvent=false;slam.addEventListener('metric',()=>{metricEvent=true;});
  slam.setWorldTransform({scale:1,qAlign:[0,0,0,1],translation:[0,0,0],source:'runtime-test'});
  const result=slam.process({gray:new Uint8Array(320*2),imageData:{data:new Uint8ClampedArray(320*2*4)},width:320,height:2,at:1});
  assert.equal(metricEvent,true);assert.equal(result.metricLocked,true);assert.equal(result.trackingValid,true);assert.equal(result.matches,1);assert.equal(result.keyframes,1);assert.equal(slam.metricScale,1);
});
