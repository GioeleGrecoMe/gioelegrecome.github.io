import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SlamEngine} from '../js/slam/slam_engine.js';
import {DenseKeyframeManager} from '../js/dense/keyframe_manager.js';
import {estimateDenseDepth} from '../js/dense/plane_sweep_core.js';
import {SparseDenseFusion} from '../js/dense/fusion_core.js';

function texturedPlaneFrame(px,{w=96,h=72,z=2}={}){
  const K={fx:85,fy:85,cx:w/2,cy:h/2,width:w,height:h},gray=new Uint8Array(w*h),rgba=new Uint8ClampedArray(w*h*4);
  const tex=(x,y)=>Math.max(0,Math.min(255,128+(Math.sin(x*17)+Math.sin(y*23)+Math.sin((x+y)*31)+Math.sin((x*2-y)*11))*25));
  for(let v=0;v<h;v++)for(let u=0;u<w;u++){const x=px+(u-K.cx)/K.fx*z,y=(v-K.cy)/K.fy*z,val=tex(x,y),i=v*w+u;gray[i]=val;rgba[i*4]=val;rgba[i*4+1]=Math.min(255,val+12);rgba[i*4+2]=Math.max(0,val-12);rgba[i*4+3]=255;}
  return {id:`f-${px}`,at:1000+px*1000,pose:{p:[px,0,0],q:[0,0,0,1]},rawPose:{p:[px,0,0],q:[0,0,0,1]},K,width:w,height:h,gray,rgba};
}

test('Alva remains the only trajectory source before dense mapping',()=>{
  let i=0;const frontend={processFrame(){const x=.04*i++;return {count:2,features:[],matches:{count:0,items:[]},cameraPose:[1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1],framePoints:[]};}};
  const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240},slam=new SlamEngine({frontend,K,keyframeIntervalMs:1});slam.setWorldTransform({scale:2,qAlign:[0,0,0,1],translation:[1,0,0],source:'test'});const r=slam.process({gray:new Uint8Array(320*240),rgba:new Uint8ClampedArray(320*240*4),width:320,height:240,at:1});assert.equal(r.trackingMode,'alvaar-wasm');assert.ok(Math.abs(r.pose.p[0]-1)<1e-9);
});

test('dense keyframe manager builds a small multi-view graph instead of every video frame',()=>{
  const m=new DenseKeyframeManager({width:48,height:36,deepWidth:64,deepHeight:48,maxFrames:6,minSources:2,maxSources:3,minBaseline:.05,maxBaseline:.5,maxAngleRad:.3,minIntervalMs:1}),K={fx:85,fy:85,cx:48,cy:36,width:96,height:72};
  for(const x of [0,.03,.09,.16,.24]){const f=texturedPlaneFrame(x),kf={id:f.id,at:f.at,pose:f.pose,rawPose:f.rawPose};m.add(kf,{...f,geometry:{}},K,{metricLocked:true});}
  const job=m.nextJob();assert.ok(job);assert.ok(job.sources.length>=2&&job.sources.length<=3);assert.ok(m.frames.length<=6);assert.equal(job.ref.deepRgba.length,64*48*4,'pose-associated Deep raster must be stored separately from the cheaper MVS raster');
});

test('multi-view plane sweep recovers a dense 2 m plane from known Alva poses',()=>{
  const ref=texturedPlaneFrame(0),sources=[texturedPlaneFrame(-.12),texturedPlaneFrame(.12),texturedPlaneFrame(.22)],r=estimateDenseDepth({ref,sources,K:ref.K,near:1,far:3,depthSteps:48,pixelStep:3,minViews:2,maxCost:.27,minConfidence:.07});
  assert.ok(r.samples.length>300,`only ${r.samples.length} dense samples`);assert.ok(Math.abs(r.medianDepth-2)<.12,`median depth ${r.medianDepth}`);assert.ok(r.coverage>.35,`coverage ${r.coverage}`);
});

test('multi-view depth fuses into confirmed surfels and a TSDF mesh',()=>{
  const ref=texturedPlaneFrame(0),sources=[texturedPlaneFrame(-.12),texturedPlaneFrame(.12),texturedPlaneFrame(.22)],r=estimateDenseDepth({ref,sources,K:ref.K,near:1,far:3,depthSteps:48,pixelStep:3,minViews:2,maxCost:.27,minConfidence:.07}),fusion=new SparseDenseFusion({voxel:.06,truncation:.18,minSupport:2,maxTsdf:120000});
  for(let k=0;k<3;k++){const j=(k-1)*.003,samples=r.samples.slice(0,900).map(s=>({...s,p:[s.p[0]+j,s.p[1],s.p[2]+j*.25]}));fusion.integrate(samples,{origin:[(k-1)*.1,0,0],frameId:`d-${k}`});}
  const splats=fusion.splats({max:10000}),mesh=fusion.mesh({maxTriangles:30000});assert.ok(splats.length>150,`confirmed surface ${splats.length}`);assert.ok(mesh.vertices.length>0&&mesh.faces.length>90,`mesh faces ${mesh.faces.length/3}`);assert.ok(splats.every(s=>s.support>=2),'one-view floaters must not become live splats');
});

test('app no longer feeds sparse MVS points directly into Gaussian accumulation',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');for(const t of ['DenseKeyframeManager','denseDepthWorker','denseFusionWorker',"type:'depth'","type:'integrate'",'surface-result'])assert.match(app,new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.doesNotMatch(app,/state\.gaussianWorker\?\.postMessage\(\{type:'add'/);
});

test('dense mapper refuses textureless walls instead of hallucinating arbitrary depth',()=>{
  const w=72,h=54,K={fx:66,fy:66,cx:w/2,cy:h/2,width:w,height:h};
  const flat=px=>{const gray=new Uint8Array(w*h);gray.fill(128);const rgba=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=128;rgba[i*4+3]=255;}return {pose:{p:[px,0,0],q:[0,0,0,1]},K,width:w,height:h,gray,rgba};};
  const r=estimateDenseDepth({ref:flat(0),sources:[flat(-.1),flat(.1)],K,near:.5,far:4,depthSteps:32,pixelStep:3,minViews:2});
  assert.equal(r.samples.length,0);
});
