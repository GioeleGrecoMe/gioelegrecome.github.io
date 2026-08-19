import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {SlamEngine} from '../js/slam/slam_engine.js';

function runWorker(file){
  const code=fs.readFileSync(new URL(file,import.meta.url),'utf8');
  const messages=[];
  const postMessage=m=>messages.push(m);
  const self={postMessage};
  vm.runInNewContext(code,{self,postMessage,Map,Math,Number,Array,ArrayBuffer,Uint8Array,Uint8ClampedArray,Float32Array,Uint32Array,Error,console});
  return {self,messages};
}

function project(pose,K,p){const x=p[0]-pose.p[0],y=p[1]-pose.p[1],z=p[2]-pose.p[2];return [K.fx*x/z+K.cx,K.cy-K.fy*y/z];}

function syntheticPair(){
  const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240};
  const a={pose:{p:[0,0,0],q:[0,0,0,1]},features:[],width:320,height:240};
  const b={pose:{p:[.08,0,0],q:[0,0,0,1]},features:[],width:320,height:240,rgba:new Uint8ClampedArray(320*240*4)};
  const pts=[[-.30,.10,1.5],[0,.15,2],[.25,-.1,2.5],[.1,.25,3],[-.15,-.2,1.8],[.35,.1,2.2],[-.25,.2,2.7],[.05,-.25,1.6],[.2,.05,1.2],[-.4,-.1,3.2]];
  pts.forEach((p,i)=>{const [ua,va]=project(a.pose,K,p),[ub,vb]=project(b.pose,K,p),desc=Array.from({length:8},(_,k)=>(i*23+k*11)%256);a.features.push({x:ua,y:va,desc,score:100-i});b.features.push({x:ub,y:vb,desc:[...desc],score:100-i});const x=Math.max(0,Math.min(319,Math.round(ub))),y=Math.max(0,Math.min(239,Math.round(vb))),j=(y*320+x)*4;b.rgba[j]=60+i*10;b.rgba[j+1]=120;b.rgba[j+2]=200;b.rgba[j+3]=255;});
  return {K,a,b,pts};
}

test('metric SLAM reference depth comes from calibrated WebXR pins',()=>{
  const frontend={process:()=>({count:2,features:[{x:160,y:120,score:10,desc:[1,2]},{x:150,y:120,score:9,desc:[3,4]}],matches:{count:1,items:[{dx:-3,dy:0}]}})};
  const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240};
  const slam=new SlamEngine({frontend,K,keyframeIntervalMs:1});
  const ref=slam.setMetricReference({pose:{p:[0,0,0],q:[0,0,0,1]},points:[[0,0,2],[-.2,.1,2.2],[.2,-.1,1.8]]});
  assert.ok(Math.abs(ref.referenceDepthM-2)<1e-9);
  const r=slam.process({gray:new Uint8Array(320*240),width:320,height:240,at:1});
  assert.ok(r.pose.p[0]>0.015&&r.pose.p[0]<0.025,'3 px flow at ~2m should become centimetric metric motion');
  assert.ok(r.newKeyframe?.features?.length===2);
});

test('two-view MVS triangulates metric points and feeds Gaussian accumulator',()=>{
  const {K,a,b,pts}=syntheticPair();
  const mvs=runWorker('../workers/mvs_worker.js');
  mvs.self.onmessage({data:{type:'init',config:{near:.3,far:5,minBaselineM:.03,maxBaselineM:1,maxPoints:100}}});
  mvs.self.onmessage({data:{type:'pair',a,b,K}});
  const result=mvs.messages.at(-1);
  assert.equal(result.type,'mvs-result');
  assert.ok(result.count>=8,`expected triangulated points, got ${result.count}`);
  const err=Math.hypot(result.points[0].position[0]-pts[0][0],result.points[0].position[1]-pts[0][1],result.points[0].position[2]-pts[0][2]);
  assert.ok(err<1e-6,`triangulation error ${err}`);

  const gs=runWorker('../workers/gaussian_worker.js');
  gs.self.onmessage({data:{type:'init',config:{voxel:.02,maxGaussians:1000,maxSnapshot:1000}}});
  gs.self.onmessage({data:{type:'add',points:result.points}});
  const snap=gs.messages.at(-1);
  assert.equal(snap.type,'snapshot');
  assert.ok(snap.count>=8,`expected Gaussian accumulation, got ${snap.count}`);
});

test('triangulated Gaussians produce a non-empty metric mesh',()=>{
  const {K,a,b}=syntheticPair();
  const mvs=runWorker('../workers/mvs_worker.js');mvs.self.onmessage({data:{type:'init',config:{near:.3,far:5,minBaselineM:.03,maxBaselineM:1,maxPoints:100}}});mvs.self.onmessage({data:{type:'pair',a,b,K}});const pts=mvs.messages.at(-1).points;
  const mesh=runWorker('../workers/metric_mesh_worker.js');mesh.self.onmessage({data:{type:'mesh',samples:pts.map(x=>({p:x.position,color:x.color,opacity:1})),voxelM:.05,maxVoxels:1000}});const out=mesh.messages.at(-1);
  assert.equal(out.type,'mesh-result');assert.ok(out.vertices.length>0);assert.ok(out.faces.length>0);
});

test('MVS rejects repeated-texture descriptor lookalikes away from the epipolar line',()=>{
  const {K,a,b}=syntheticPair();
  // Insert a descriptor-identical distractor for every true feature, but move
  // it vertically by 24 px. With a horizontal camera baseline the true
  // epipolar lines are horizontal, so pose-guided matching must reject these
  // repeated-texture lookalikes before triangulation.
  const distractors=b.features.map(f=>({x:f.x,y:f.y+24,desc:[...f.desc],score:f.score+1}));
  b.features=[...distractors,...b.features];
  const mvs=runWorker('../workers/mvs_worker.js');
  mvs.self.onmessage({data:{type:'init',config:{near:.3,far:5,minBaselineM:.03,maxBaselineM:1,maxPoints:100,maxEpipolarPx:2.2}}});
  mvs.self.onmessage({data:{type:'pair',a,b,K}});
  const result=mvs.messages.at(-1);
  assert.equal(result.type,'mvs-result');
  assert.ok(result.count>=7,`epipolar guided matcher lost too many true correspondences: ${result.count}`);
  assert.ok(result.points.every(p=>Number.isFinite(p.epipolarPx)&&p.epipolarPx<.05),'accepted points should lie on the calibrated epipolar line');
});
