import test from 'node:test';
import assert from 'node:assert/strict';
import {XRMetricCalibrator} from '../js/xr/xr_calibration.js';

const cfg={
  xrCalibrationMinTargets:3,xrCalibrationMaxTargets:7,xrCalibrationMinCommonPoints:3,
  xrCalibrationMinSpanM:.20,xrCalibrationMinTriangleAreaM2:.0025,xrCalibrationMinScreenTriangleArea:.0015,
  xrCalibrationMinGlobalPoses:3,xrCalibrationMinPointsPerTarget:1
};
function pin(id,p,uv,{ready=true,visible=true,roiViews=4}={}){
  const point={id:`${id}:p0`,objectId:id,p:[...p],seedUv:[...uv],realAnchor:true,tracked:visible,observations:[]};
  return {id,seedUv:[...uv],state:'tracking',points:[point],viewPoses:[{p:[0,0,0],q:[0,0,0,1]},{p:[.1,0,0],q:[0,0,0,1]},{p:[.2,0,0],q:[0,0,0,1]}],views:3,maxBaselineM:.2,maxAngleRad:0,
    visible,visiblePoints:visible?1:0,lastVisible:visible?[{point,uv:[...uv],patch:[1,2,3,4],patchSize:2,patchRel:.05,variance:100,detail:20}]:[],displayUv:visible?[...uv]:null,ready,
    roiViews:Array.from({length:roiViews},(_,i)=>({pose:{p:[i*.06,0,0],q:[0,0,0,1]}})),roiSectors:['0:1','1:1']};
}
function cal(targets){const c=new XRMetricCalibrator({overlayRoot:null,config:cfg,log:null});c.targets=targets;c.cameraSize=[1000,1000];c.latestPose={p:[0,0,0],q:[0,0,0,1]};c.latestIntrinsics={fxN:1,fyN:1,cxN:.5,cyN:.5};return c;}

test('Apply is ready after exactly three useful visible pins without global pose gate',()=>{
  const c=cal([pin('p1',[-.3,0,2],[.25,.35]),pin('p2',[.3,0,2],[.75,.35]),pin('p3',[0,.3,2],[.50,.70])]);
  const q=c.quality();
  assert.equal(q.readyTargets,3);assert.equal(q.commonVisibleReadyTargets,3);assert.equal(q.poseCount,0);assert.equal(q.poseCoverageOk,false);
  assert.equal(q.poseCoverageRequiredForApply,false);assert.equal(q.ready,true);assert.equal(q.blocker,null);
});

test('an extra incomplete fourth pin does not disable Apply',()=>{
  const c=cal([pin('p1',[-.3,0,2],[.25,.35]),pin('p2',[.3,0,2],[.75,.35]),pin('p3',[0,.3,2],[.50,.70]),pin('p4',[.8,.2,2],[.85,.7],{ready:false,visible:false,roiViews:0})]);
  const q=c.quality();assert.equal(q.selected,4);assert.equal(q.readyTargets,3);assert.equal(q.ready,true);assert.deepEqual(q.applyTargetIds,['p1','p2','p3']);
});

test('three useful pins still require a coherent common view',()=>{
  const c=cal([pin('p1',[-.3,0,2],[.25,.35]),pin('p2',[.3,0,2],[.75,.35]),pin('p3',[0,.3,2],[.50,.70],{visible:false})]);
  const q=c.quality();assert.equal(q.readyTargets,3);assert.equal(q.commonVisibleReadyTargets,2);assert.equal(q.ready,false);assert.match(q.blocker,/stessa inquadratura/);
});

test('degenerate collinear pins do not enable Apply',()=>{
  const c=cal([pin('p1',[-.3,0,2],[.25,.50]),pin('p2',[0,0,2],[.50,.50]),pin('p3',[.3,0,2],[.75,.50])]);
  const q=c.quality();assert.equal(q.commonView,true);assert.equal(q.geometryOk,false);assert.equal(q.ready,false);assert.match(q.blocker,/triangolo/);
});

import {CONFIG} from '../js/config.js';

test('runtime thresholds make one pin useful after four separated ROI views and 8 cm baseline',()=>{
  assert.equal(CONFIG.xrRoiMinViewsPerTarget,4);
  assert.equal(CONFIG.xrCalibrationMinViewsPerTarget,3);
  assert.equal(CONFIG.xrCalibrationMinTargetBaselineM,.08);
  assert.equal(CONFIG.xrCalibrationMinTargets,3);
});
