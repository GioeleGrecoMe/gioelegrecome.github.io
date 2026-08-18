import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildRgbPointCloudPly,loadRgbPointCloud} from '../js/model_preview_v20_4_2.js';
import {scoreObservationCell} from '../js/grid_v20_2_0.js';

const weak=scoreObservationCell({count:1,normalSum:[0,1,0],viewCount:1,positionStdM:.2,xrDepthCount:1,frameRefs:[],lastSeen:Date.now(),surfaceType:'wall'});
assert.equal(weak.needDeep,false,'single predicted/weak observation must not consume Deep budget');
const observed=scoreObservationCell({count:5,normalSum:[0,4.7,0],viewCount:2,maxBaselineM:.22,maxParallaxDeg:4,positionStdM:.05,xrDepthCount:4,frameRefs:[],lastSeen:Date.now(),surfaceType:'wall'});
assert.equal(observed.needDeep,true,'observed ambiguous cell should request Deep');
const green=scoreObservationCell({count:24,normalSum:[0,23.5,0],viewCount:3,maxBaselineM:.48,maxParallaxDeg:13,positionStdM:.01,xrDepthCount:20,frameRefs:[{id:1},{id:2}],photoViewCount:2,meanSharpness:.8,meanExposureScore:.8,lastSeen:Date.now(),surfaceType:'wall'});
assert.equal(green.status,'green');

const model={geometry:{surfels:[
  {position:[0,0,0],rgb:[255,0,0],quality:1},
  {position:[1,2,3],rgb:[0,255,16],quality:.8},
  {position:[-1,.5,2],rgb:[12,34,250],quality:.6}
]}};
const ply=buildRgbPointCloudPly(model);Object.defineProperty(ply,'name',{value:'roundtrip.ply'});
const cloud=await loadRgbPointCloud(ply);assert.equal(cloud.positions.length,9);assert.equal(cloud.colors.length,12);assert.ok(Math.abs(cloud.positions[3]-1)<1e-6);assert.ok(cloud.colors[5]>.99);

const xr=fs.readFileSync(new URL('../js/xr_capture_v20_2_0.js',import.meta.url),'utf8');
assert.match(xr,/maxRetainedPhotos/);assert.match(xr,/_prunePhotoStore/);assert.match(xr,/lastHitCandidate/);assert.match(xr,/_mergeGridTiles/);
const map=fs.readFileSync(new URL('../workers/map_worker_v20_4_0.js',import.meta.url),'utf8');
assert.match(map,/grow vertically/);assert.match(map,/needDeep:false/);assert.match(map,/Reserve room for already-confirmed geometry/);
const proc=fs.readFileSync(new URL('../workers/processing_worker_v20_4_0.js',import.meta.url),'utf8');
assert.match(proc,/pruneGrossOutliers/);assert.match(proc,/RAW invariati/);
const preview=fs.readFileSync(new URL('../js/model_preview_v20_4_2.js',import.meta.url),'utf8');
assert.match(preview,/setInteractionMode/);assert.match(preview,/panTarget/);assert.match(preview,/buildRgbPointCloudPly/);assert.match(preview,/loadRgbPointCloud/);
console.log('PASS v20_4_3_features');
