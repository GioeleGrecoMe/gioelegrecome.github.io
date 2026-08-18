import assert from 'node:assert/strict';
import {sampleCPUDepthRays,sampleGPUReadbackRays,encodeRayBatch,decodeRayBatchToPoints} from '../js/xr_capture_v20_2_0.js';

function perspective(fovy=Math.PI/2,aspect=1,near=.1,far=20){
  const f=1/Math.tan(fovy/2),nf=1/(near-far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}
const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const w=64,h=48,raw=new Float32Array(w*h);raw.fill(2.0);
let fallbackCalls=0;
const info={width:w,height:h,data:raw.buffer,rawValueToMeters:1,normDepthBufferFromNormView:{matrix:I},getDepthInMeters:(u,v)=>{fallbackCalls++;assert.ok(u>=0&&u<=1&&v>=0&&v<=1);return 2;}};
const view={projectionMatrix:perspective(),transform:{matrix:I}};
const sampled=sampleCPUDepthRays(info,view,{stride:4,maxPoints:500,cameraPosition:[0,0,0],dataFormat:'float32'});
assert.ok(sampled.samples.length>100,`too few dense rays: ${sampled.samples.length}`);
assert.equal(fallbackCalls,0,'direct CPU depth buffer should be used when available');
for(const s of sampled.samples.slice(0,20)){assert.ok(s.u>=0&&s.u<=1&&s.v>=0&&s.v<=1);assert.ok(Math.abs(s.depthM-2)<1e-6);}
const center=sampled.points.slice(0,3);assert.ok(Number.isFinite(center[2])&&center[2]<0,'point must project in front of WebXR camera');
// Inject RGB into a few records and ensure the raw-ray codec is metric and future-processable.
for(let i=0;i<Math.min(10,sampled.samples.length);i++){sampled.samples[i].rgb=[20+i,80,160];sampled.samples[i].hasRgb=true;const p=i*10;sampled.points[p+6]=20+i;sampled.points[p+7]=80;sampled.points[p+8]=160;}
const buf=encodeRayBatch(sampled.samples,{depthWidth:w,depthHeight:h});
const decoded=decodeRayBatchToPoints(buf,{cameraMatrix:I,projectionMatrix:view.projectionMatrix});
assert.equal(decoded.length,sampled.points.length);
let maxErr=0;for(let i=0;i<decoded.length;i+=10){const dx=decoded[i]-sampled.points[i],dy=decoded[i+1]-sampled.points[i+1],dz=decoded[i+2]-sampled.points[i+2];maxErr=Math.max(maxErr,Math.hypot(dx,dy,dz));}
assert.ok(maxErr<.004,`RSRY roundtrip metric error ${maxErr}`);
assert.equal(decoded[6],20);assert.equal(decoded[7],80);assert.equal(decoded[8],160);

// Synthetic GPU readback is bottom-up, because WebGL readPixels starts at the
// lower-left. sampleGPUReadbackRays must recover top-left normalized WebXR UVs.
const gw=40,gh=30,gdepth=new Float32Array(gw*gh);gdepth.fill(2.4);
const gs=sampleGPUReadbackRays({width:gw,height:gh,depthMeters:gdepth},{projectionMatrix:perspective(),transform:{matrix:I}},{maxPoints:700,cameraPosition:[0,0,0]});
assert.ok(gs.samples.length>=300,`too few GPU-depth rays: ${gs.samples.length}`);
assert.ok(gs.samples[0].u>0&&gs.samples[0].u<1&&gs.samples[0].v>0&&gs.samples[0].v<1);
assert.ok(gs.samples[0].depthM>2.39&&gs.samples[0].depthM<2.41);
console.log('PASS dense_ray_v20_4_0');
