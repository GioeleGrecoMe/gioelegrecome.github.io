import test from 'node:test';
import assert from 'node:assert/strict';
import {XRMetricCalibrator} from '../js/xr/xr_calibration.js';
import {applyMetricSimilarityToPoint,metricizeGaussians,gaussianMetricBounds,gaussianSurfaceSamples} from '../js/metric/metric_geometry.js';

const cfg={xrManualAimStableFrames:3,xrManualAimHitStdM:.02,xrRoiScales:[.05,.1,.2],xrRoiPatchSize:4,xrRoiMaxViewsPerTarget:8,xrRoiMinViewsPerTarget:2,xrRoiMinAzimuthSectors:2,xrRoiAzimuthSectors:8,xrRoiElevationBands:3,xrRoiCaptureStepM:.05,xrRoiCaptureStepAngleRad:.05};

test('manual hit-test preview exposes metric depth and becomes stable',()=>{
 const c=new XRMetricCalibrator({overlayRoot:null,config:cfg,log:null});c.latestPose={p:[0,0,0],q:[0,0,0,1]};c.refSpace={};c.manualAim={uv:[.5,.5],source:{},history:[],valid:false,stable:false,point:null,depthM:null,rmsM:null,lastHitAt:0};
 const hit={getPose:()=>({transform:{position:{x:0.2,y:0.1,z:-2}}})};const frame={getHitTestResults:()=>[hit]};
 for(let i=0;i<3;i++)c._processManualAim(frame);assert.equal(c.manualAim.valid,true);assert.equal(c.manualAim.stable,true);assert.ok(Math.abs(c.manualAim.depthM-Math.hypot(.2,.1,2))<1e-9);assert.deepEqual(c.manualAim.point,[.2,-.1,2]);
});

test('ROI atlas requires camera motion/new viewpoint and stores multiple scales',()=>{
 const c=new XRMetricCalibrator({overlayRoot:null,config:cfg,log:null});c._cameraPatch=(t,uv,K,{fraction})=>({patch:Uint8Array.from([0,30,80,160,20,40,90,180,30,60,120,210,40,90,160,255]),variance:200,detail:20,patchRel:fraction});
 const target={id:'obj1',points:[{p:[0,0,2]}],displayUv:[.5,.5],roiViews:[],roiSectors:[]},K={width:1000,height:1000};
 c._captureRoiView(target,{},K,{p:[0,0,0],q:[0,0,0,1]});assert.equal(target.roiViews.length,1);assert.equal(target.roiViews[0].scales.length,3);
 c._captureRoiView(target,{},K,{p:[0,0,0],q:[0,0,0,1]});assert.equal(target.roiViews.length,1,'same pose must not duplicate ROI');
 c._captureRoiView(target,{},K,{p:[.2,0,0],q:[0,0,0,1]});assert.equal(target.roiViews.length,2);assert.ok(target.roiSectors.length>=1);
});

test('metric GS helpers preserve metres and provide mesh-oriented samples',()=>{
 assert.deepEqual(applyMetricSimilarityToPoint([1,2,3],{scale:2,t:[1,0,-1]}),[3,4,5]);
 const gs=metricizeGaussians([{position:[1,0,0],scale:[.1,.2,.3],opacity:.8,color:[255,0,0]},{position:[0,2,0],radius:.1,opacity:.05}],{scale:2,t:[1,0,0]});
 assert.deepEqual(gs[0].position,[3,0,0]);assert.deepEqual(gs[0].scale,[.2,.4,.6]);assert.equal(gs[1].radius,.2);const b=gaussianMetricBounds(gs);assert.deepEqual(b.size,[2,4,0]);const s=gaussianSurfaceSamples(gs,{opacityMin:.1});assert.equal(s.length,1);assert.deepEqual(s[0].p,[3,0,0]);
});
