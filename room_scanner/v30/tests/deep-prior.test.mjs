import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrateRelativeDepth} from '../js/dense/deep_metric.js';
import {DeepKeyframeSelector} from '../js/dense/deep_keyframe_selector.js';
import {estimateDenseDepth} from '../js/dense/plane_sweep_core.js';

test('Depth Anything relative output is robustly calibrated to Alva world depth',()=>{
  const w=80,h=60,raw=new Float32Array(w*h),truth=new Float32Array(w*h);
  // Synthetic model convention: z = 1.15 + 2.4/raw. This deliberately forces
  // the calibrator to choose inverse-raw instead of assuming model metric units.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const z=1.7+.006*x+.003*y,i=y*w+x;truth[i]=z;raw[i]=2.4/(z-1.15);}
  const seeds=[];for(let y=7;y<h-6;y+=9)for(let x=8;x<w-7;x+=11){const i=y*w+x;seeds.push({u:x,v:y,depth:truth[i],confidence:.9});}
  // Remaining Alva descriptor mismatches must not move the scale.
  seeds[2]={...seeds[2],depth:4.8};seeds[9]={...seeds[9],depth:.65};
  const c=calibrateRelativeDepth({rawDepth:raw,rawWidth:w,rawHeight:h,outWidth:w,outHeight:h,sparseSeeds:seeds,near:.5,far:6,minAnchors:7,minCells:3,maxMedianRelativeError:.18});
  assert.equal(c.ok,true,c.reason);assert.equal(c.mode,'inverse-raw');assert.ok(c.inlierRatio>.8,`inliers ${c.inlierRatio}`);assert.ok(c.medianRelativeError<.025,`rel error ${c.medianRelativeError}`);
  const probes=[[20,15],[50,31],[68,46]];for(const [x,y] of probes){const i=y*w+x;assert.ok(Math.abs(c.depth[i]-truth[i])<.06,`${x},${y}: ${c.depth[i]} vs ${truth[i]}`);}
});

test('Depth Anything disparity-like output is mapped into the Alva common scale',()=>{
  const w=84,h=56,raw=new Float32Array(w*h),truth=new Float32Array(w*h);
  // Synthetic disparity convention: 1/z = a*raw + b. This is the projective
  // relation that the previous direct/inverse-raw-only fit could not represent
  // exactly over a wide room-depth interval.
  const a=.42,b=.075;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const z=1.1+.023*x+.010*y,i=y*w+x;truth[i]=z;raw[i]=(1/z-b)/a;}
  const seeds=[];for(let y=5;y<h-4;y+=8)for(let x=6;x<w-5;x+=10){const i=y*w+x;seeds.push({u:x,v:y,depth:truth[i],confidence:.95});}
  seeds[3]={...seeds[3],depth:4.7};
  const c=calibrateRelativeDepth({rawDepth:raw,rawWidth:w,rawHeight:h,outWidth:w,outHeight:h,sparseSeeds:seeds,near:.5,far:6,minAnchors:7,minCells:3,maxMedianRelativeError:.18});
  assert.equal(c.ok,true,c.reason);assert.equal(c.mode,'inverse-depth');assert.ok(c.medianRelativeError<.012,`rel error ${c.medianRelativeError}`);
  for(const [x,y] of [[12,10],[43,28],[75,48]]){const i=y*w+x;assert.ok(Math.abs(c.depth[i]-truth[i])<.035,`${x},${y}: ${c.depth[i]} vs ${truth[i]}`);}
});

test('sparse AI selector skips duplicate photos and requests a new spatial context',()=>{
  const s=new DeepKeyframeSelector({minIntervalMs:2500,maxIntervalMs:8000,minTranslationM:.20,minTranslationAlva:.10,minRotationRad:.16,minAnchors:7,minAnchorCells:3});
  const seeds=[];for(const [u,v] of [[10,10],[45,12],[75,15],[15,35],[50,40],[78,45],[25,58],[65,58]])seeds.push({u,v,depth:2});
  const ref=(at,x,q=[0,0,0,1])=>({at,width:90,height:70,pose:{p:[x,0,0],q}});
  let d=s.evaluate({ref:ref(1000,0),sparseSeeds:seeds,metricLocked:true});assert.equal(d.infer,true);s.noteAttempt(ref(1000,0),seeds);s.commit(ref(1000,0),seeds);
  d=s.evaluate({ref:ref(2100,.05),sparseSeeds:seeds,metricLocked:true});assert.equal(d.infer,false);assert.equal(d.reason,'cooldown');
  d=s.evaluate({ref:ref(4200,.08),sparseSeeds:seeds,metricLocked:true});assert.equal(d.infer,false);assert.equal(d.reason,'near-duplicate');
  d=s.evaluate({ref:ref(4700,.25),sparseSeeds:seeds,metricLocked:true});assert.equal(d.infer,true);assert.equal(d.reason,'new-position');
});

function periodicPlaneFrame(px,{w=96,h=72,z=2.3}={}){
  const K={fx:86,fy:86,cx:w/2,cy:h/2,width:w,height:h},gray=new Uint8Array(w*h),rgba=new Uint8ClampedArray(w*h*4);
  // Repetitive indoor-like texture creates several plausible photometric minima.
  const tex=(x,y)=>Math.max(0,Math.min(255,128+42*Math.sin(x*36)+20*Math.cos(y*24)));
  for(let v=0;v<h;v++)for(let u=0;u<w;u++){const X=px+(u-K.cx)/K.fx*z,Y=(v-K.cy)/K.fy*z,val=tex(X,Y)|0,i=v*w+u;gray[i]=val;rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=val;rgba[i*4+3]=255;}
  return {id:`p${px}`,pose:{p:[px,0,0],q:[0,0,0,1]},K,width:w,height:h,gray,rgba};
}

test('calibrated AI prior narrows multi-view search around the physical surface',()=>{
  const ref=periodicPlaneFrame(0),sources=[periodicPlaneFrame(-.11),periodicPlaneFrame(.12),periodicPlaneFrame(.22)],priorDepth=new Float32Array(ref.width*ref.height);priorDepth.fill(2.3);
  const r=estimateDenseDepth({ref,sources,K:ref.K,near:.7,far:4.5,depthSteps:60,pixelStep:3,minViews:2,maxCost:.34,minConfidence:.04,minDistinctiveness:.008,depthPrior:{depth:priorDepth,confidence:.9},priorRelRange:.12,priorDepthSteps:16,priorWeight:.12,priorMinTexture:.004});
  assert.ok(r.samples.length>180,`samples ${r.samples.length}`);assert.ok(Math.abs(r.medianDepth-2.3)<.16,`median ${r.medianDepth}`);assert.ok(r.samples.every(s=>s.depth>2.0&&s.depth<2.62),'prior-refined samples escaped the calibrated local band');
});
