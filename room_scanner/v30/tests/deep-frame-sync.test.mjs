import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDeepFrameBinding,sampledFrameSignature,sameCameraFrame,validateDeepFrameResult} from '../js/dense/deep_frame_sync.js';
import {DenseKeyframeManager} from '../js/dense/keyframe_manager.js';

function raster(w=8,h=6,seed=3){const a=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){a[i*4]=(i*17+seed)&255;a[i*4+1]=(i*31+seed*3)&255;a[i*4+2]=(i*47+seed*5)&255;a[i*4+3]=255;}return a;}

test('Deep binding accepts only the exact captured raster and frame identity',()=>{
  const rgba=raster(),binding=createDeepFrameBinding({jobId:'deep-1',frameId:'cam-a-42',frameAt:1234.5,refId:'kf-42',rgba,width:8,height:6});
  const result={jobId:'deep-1',frameId:'cam-a-42',frameAt:1234.5,refId:'kf-42',sourceWidth:8,sourceHeight:6,frameSignature:sampledFrameSignature(rgba,8,6)};
  assert.deepEqual(validateDeepFrameResult(result,binding).ok,true);
  assert.equal(validateDeepFrameResult({...result,frameId:'cam-a-43'},binding).reason,'frame-id-mismatch');
  assert.equal(validateDeepFrameResult({...result,frameAt:1234.7},binding).reason,'frame-time-mismatch');
  assert.equal(validateDeepFrameResult({...result,refId:'kf-43'},binding).reason,'ref-id-mismatch');
  assert.equal(validateDeepFrameResult({...result,frameSignature:'deadbeef'},binding).reason,'raster-signature-mismatch');
});

test('Alva keyframe and camera raster must carry the same source frameId',()=>{
  const frame={frameId:'cam-a-7',at:700,width:8,height:6,gray:new Uint8Array(48),rgba:raster()};
  const good={id:'kf-7',frameId:'cam-a-7',at:700,pose:{p:[0,0,0],q:[0,0,0,1]},features:[]};
  const bad={...good,frameId:'cam-a-8'};
  assert.equal(sameCameraFrame(frame,good).ok,true);
  assert.equal(sameCameraFrame(frame,bad).reason,'frame-id-mismatch');
  const manager=new DenseKeyframeManager({width:4,height:3,deepWidth:4,deepHeight:3,minIntervalMs:0});
  const K={fx:8,fy:8,cx:4,cy:3,width:8,height:6};
  const item=manager.add(good,frame,K);assert.equal(item.frameId,'cam-a-7');assert.equal(item.captureAt,700);
  assert.throws(()=>manager.add(bad,frame,K),/Dense frame sync mismatch/);
});

test('Deep worker echoes correlation metadata and app rejects late mismatched results before fusion',()=>{
  const root=new URL('../',import.meta.url),worker=fs.readFileSync(new URL('workers/deep_depth_worker.js',root),'utf8'),app=fs.readFileSync(new URL('js/app.js',root),'utf8');
  assert.match(worker,/function correlationFields\(d\)/);assert.match(worker,/\.\.\.correlationFields\(d\)/);assert.match(worker,/frameSignature: raw\.frameSignature/);
  assert.match(app,/validateDeepFrameResult/);assert.match(app,/deep-frame-sync-rejected/);assert.match(app,/deep-frame-sync-defense/);
  const validationAt=app.indexOf('validateDeepFrameResult'),applyAt=app.indexOf('await applyDeepDepthResult');assert.ok(validationAt>=0&&applyAt>validationAt,'sync validation must happen before Deep can update geometry');
});
