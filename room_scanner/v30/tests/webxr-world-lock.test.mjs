import test from 'node:test';
import assert from 'node:assert/strict';
import {XRMetricCalibrator,projectSlamPointToUv} from '../js/xr/xr_calibration.js';

const cfg={
  xrCalibrationPatchFraction:.065,xrCalibrationPatchSize:4,xrCalibrationMinPointsPerTarget:1,
  xrCalibrationMaxTemplatesPerPoint:6,xrCalibrationTrackingZncc:.1,xrCalibrationMinViewsPerTarget:1,
  xrCalibrationMaxViewsPerTarget:7,xrCalibrationViewStepM:.05,xrCalibrationViewStepAngleRad:.05,
  xrCalibrationMinTargetBaselineM:0,xrCalibrationMinTargets:3,xrCalibrationMaxTargets:5,
  xrCalibrationMinCommonPoints:3,xrCalibrationMinSpanM:.1,xrCalibrationMinVerticalSpanM:0,
  xrCalibrationMinGlobalPoses:3,xrCalibrationMinPinsPerPose:3,xrCalibrationGlobalPoseStepM:.05,
  xrCalibrationGlobalPoseStepAngleRad:.05,xrRequestPersistentHandles:false
};
const textured=[0,255,0,255,255,0,255,0,0,255,0,255,255,0,255,0];
function makeCal(){
  const c=new XRMetricCalibrator({overlayRoot:null,config:cfg,log:null});
  c.latestK={fx:500,fy:500,cx:500,cy:500,width:1000,height:1000};
  c.latestPose={p:[0,0,0],q:[0,0,0,1]};
  c._cameraPatch=()=>({patch:Uint8Array.from(textured),variance:1000,detail:30,patchRel:.04});
  return c;
}
function makeTarget(){
  const anchor={anchorSpace:{id:'space'}};
  const point={id:'obj1:p0',objectId:'obj1',p:[0,0,2],seedUv:[.5,.5],hitStdM:.001,reference:{uv:[.5,.5],patch:textured,patchSize:4,patchRel:.04,variance:1000,detail:30},observations:[],persistentHandle:null,runtimeAnchor:anchor,tracked:true,realAnchor:true};
  const target={id:'obj1',seedUv:[.5,.5],state:'tracking',points:[point],viewPoses:[],views:0,maxBaselineM:0,maxAngleRad:0,visible:false,visiblePoints:0,lastVisible:[],displayUv:null,ready:false};
  return {anchor,point,target};
}
function frameFor(anchor,tracked=true){return {trackedAnchors:new Set(tracked?[anchor]:[]),getPose:(space)=>space===anchor.anchorSpace?{transform:{position:{x:0,y:0,z:-2}}}:null};}

test('world anchor stays fixed while screen projection changes with camera motion',()=>{
  const c=makeCal(),{anchor,target}=makeTarget(),frame=frameFor(anchor,true);c.targets=[target];
  c._processTrackingTarget(target,frame,{},c.latestK);const u0=target.displayUv[0];
  assert.ok(Math.abs(u0-.5)<1e-9);assert.deepEqual(target.points[0].p,[0,0,2]);
  c.latestPose={p:[.5,0,0],q:[0,0,0,1]};c._processTrackingTarget(target,frame,{},c.latestK);const u1=target.displayUv[0];
  assert.ok(u1<u0,'screen projection must move when camera moves');assert.deepEqual(target.points[0].p,[0,0,2],'room-space point remains fixed');
});

test('lost trackedAnchors hides marker instead of freezing seed UV on screen',()=>{
  const c=makeCal(),{anchor,target}=makeTarget();c.targets=[target];
  c._processTrackingTarget(target,frameFor(anchor,true),{},c.latestK);assert.equal(target.visible,true);
  c._processTrackingTarget(target,frameFor(anchor,false),{},c.latestK);assert.equal(target.visible,false);
  const q=c._quality();assert.deepEqual(q.targets[0].seedUv,[-2,-2]);assert.equal(q.targets[0].trackedPoints,0);
});

test('three distinct poses require at least three visible anchored targets',()=>{
  const c=makeCal();
  c.targets=[0,1,2].map(i=>({id:`obj${i}`,state:'tracking',visible:true,lastVisible:[{point:{id:`p${i}`}}],points:[],ready:true,seedUv:[.2+i*.2,.5],viewPoses:[],views:3,maxBaselineM:.2,visiblePoints:1,displayUv:[.2+i*.2,.5]}));
  for(const x of [0,.12,.24]){c.latestPose={p:[x,0,0],q:[0,0,0,1]};c._captureGlobalPoseIfEligible();}
  assert.equal(c.globalPoses.length,3);assert.equal(c._quality().poseCoverageOk,true);
});

test('two visible pins cannot create a qualifying global pose',()=>{
  const c=makeCal();c.targets=[0,1].map(i=>({id:`obj${i}`,state:'tracking',visible:true,lastVisible:[],points:[],ready:true,seedUv:[.3,.5]}));c._captureGlobalPoseIfEligible();assert.equal(c.globalPoses.length,0);
});

test('projection helper moves opposite camera translation',()=>{
  const K={fx:500,fy:500,cx:500,cy:500,width:1000,height:1000},p=[0,0,2];
  assert.equal(projectSlamPointToUv({p:[0,0,0],q:[0,0,0,1]},p,K).u,.5);
  assert.ok(projectSlamPointToUv({p:[.5,0,0],q:[0,0,0,1]},p,K).u<.5);
});

test('XR scene renderer consumes current anchor pose in raw WebXR coordinates',()=>{
  const c=makeCal(),{anchor,point,target}=makeTarget();c.targets=[target];let drawn=null;
  c.gl={FRAMEBUFFER:1,COLOR_BUFFER_BIT:2,DEPTH_BUFFER_BIT:4,DEPTH_TEST:5,BLEND:6,SRC_ALPHA:7,ONE_MINUS_SRC_ALPHA:8,POINTS:9,bindFramebuffer(){},viewport(){},clearColor(){},clear(){},disable(){},enable(){},blendFunc(){},useProgram(){},uniform3f(_u,x,y,z){drawn=[x,y,z]},uniformMatrix4fv(){},uniform1f(){},uniform4fv(){},drawArrays(){}};
  c.layer={framebuffer:{},getViewport:()=>({x:0,y:0,width:100,height:100})};c._scenePinProgram={};c._scenePinUniforms={point:1,projection:2,view:3,size:4,color:5};
  const frame={trackedAnchors:new Set([anchor]),getPose:()=>({transform:{position:{x:.3,y:.4,z:-2}}})},view={projectionMatrix:new Float32Array(16),transform:{inverse:{matrix:new Float32Array(16)}}};
  c._renderScenePins(frame,view);assert.deepEqual(drawn,[.3,.4,-2]);assert.deepEqual(point.xrP,[.3,.4,-2]);
});
