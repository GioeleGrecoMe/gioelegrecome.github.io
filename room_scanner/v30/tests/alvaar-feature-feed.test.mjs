import test from 'node:test';
import assert from 'node:assert/strict';
import {WasmVisionFrontend} from '../js/slam/wasm_frontend.js';

test('MVS descriptors are extracted preferentially at Alva-tracked frame points',async()=>{
  const w=64,h=48,gray=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)gray[y*w+x]=(x*7+y*11)&255;
  const alva={findCameraPose(){return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];},getFramePoints(){return [{x:16,y:16},{x:30,y:20},{x:45,y:30}];}};
  const f=new WasmVisionFrontend({alva});await f.init({width:w,height:h});
  const r=f.processFrame({gray,width:w,height:h,imageData:{data:new Uint8ClampedArray(w*h*4)},at:1},{maxFeatures:40,threshold:10});
  assert.equal(r.alvaFeatureCount,3);assert.ok(r.features.filter(x=>x.source==='alva-track').length===3);assert.equal(r.trackingMode,'alvaar-wasm');
});

test('Alva frontend preserves the calibrated FOV used by the tracker',async()=>{
  const w=64,h=48,alva={findCameraPose(){return null;},getFramePoints(){return [];}};
  const f=new WasmVisionFrontend({alva});await f.init({width:w,height:h,fovDeg:62});
  assert.equal(f.fovDeg,62);
  const r=f.trackPose({imageData:{data:new Uint8ClampedArray(w*h*4)},at:1});
  assert.equal(r.trackingMode,'alvaar-initializing');
});
