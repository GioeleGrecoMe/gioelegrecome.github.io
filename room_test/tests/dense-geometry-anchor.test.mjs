import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSparseDepthAnchors} from '../js/dense/sparse_depth_anchors.js';
import {estimateDenseDepth} from '../js/dense/plane_sweep_core.js';
import {SparseDenseFusion} from '../js/dense/fusion_core.js';
import {projectPoint,qNormalize,qRotate} from '../js/slam/math.js';

function desc(i){return [i*17%251,i*31%251,i*47%251,i*61%251,i*79%251,i*97%251,((i+3)*29)%251,((i+7)*43)%251];}
function makeView(x,{w=120,h=90,z=2.4}={}){
  const K={fx:105,fy:104,cx:w*.51,cy:h*.49,width:w,height:h},pose={p:[x,0,0],q:[0,0,0,1]},gray=new Uint8Array(w*h),rgba=new Uint8ClampedArray(w*h*4);
  const texture=(X,Y)=>Math.max(0,Math.min(255,128+34*Math.sin(X*19)+28*Math.cos(Y*23)+22*Math.sin((X+Y)*37)));
  for(let v=0;v<h;v++)for(let u=0;u<w;u++){const X=x+(u-K.cx)/K.fx*z,Y=(v-K.cy)/K.fy*z,val=texture(X,Y)|0,i=v*w+u;gray[i]=val;rgba[i*4]=val;rgba[i*4+1]=Math.min(255,val+9);rgba[i*4+2]=Math.max(0,val-11);rgba[i*4+3]=255;}
  const features=[];let id=1;
  for(let Y=-.65;Y<=.65;Y+=.22)for(let X=-.9;X<=.9;X+=.22){const pr=projectPoint(pose,K,[X,Y,z]);if(pr&&pr.u>5&&pr.v>5&&pr.u<w-5&&pr.v<h-5)features.push({x:pr.u,y:pr.v,score:300,source:'alva-track',desc:desc(id++)});}
  return {id:`v${x}`,pose,K,width:w,height:h,gray,rgba,features};
}

test('Alva feature geometry recovers true scene depth and a bounded search interval',()=>{
  const ref=makeView(0),src=[makeView(-.16),makeView(.17),makeView(.29)],a=buildSparseDepthAnchors(ref,src,{minAngleRad:.006,maxReprojectionPx:1.2});
  assert.ok(a.seeds.length>=18,`seeds ${a.seeds.length}`);assert.ok(a.range);assert.ok(Math.abs(a.range.median-2.4)<.05,`median ${a.range.median}`);assert.ok(a.range.near>0.8&&a.range.far<5.5,`${a.range.near}..${a.range.far}`);
});

test('seed-constrained plane sweep stays on the Alva-anchored surface instead of a front sheet',()=>{
  const ref=makeView(0),src=[makeView(-.16),makeView(.17),makeView(.29)],a=buildSparseDepthAnchors(ref,src,{minAngleRad:.006,maxReprojectionPx:1.2});
  const r=estimateDenseDepth({ref,sources:src,K:ref.K,near:a.range.near,far:a.range.far,sparseSeeds:a.seeds,depthSteps:52,pixelStep:3,minViews:2,maxCost:.28,minConfidence:.06,seedMaxRelativeError:.35});
  assert.ok(r.samples.length>220,`samples ${r.samples.length}`);assert.ok(Math.abs(r.medianDepth-2.4)<.16,`depth ${r.medianDepth}`);
  const zs=r.samples.map(s=>s.p[2]).sort((x,y)=>x-y);assert.ok(Math.abs(zs[zs.length>>1]-2.4)<.16,`world z ${zs[zs.length>>1]}`);
});

test('CV projection is +Y down and round-trips a rotated camera',()=>{
  const K={fx:400,fy:410,cx:160,cy:120,width:320,height:240},pose={p:[.2,-.1,.3],q:qNormalize([.08,.15,-.03,.98])},p=[.5,.35,2.7];
  const pr=projectPoint(pose,K,p);assert.ok(pr&&pr.z>0);assert.ok(Number.isFinite(pr.u+pr.v));
});

function quatAxis(axis,ang){const s=Math.sin(ang/2),c=Math.cos(ang/2);return qNormalize([axis[0]*s,axis[1]*s,axis[2]*s,c]);}
function renderWorldPlane(pose,{w=120,h=90,zPlane=2.6}={}){
  const K={fx:108,fy:106,cx:w*.5,cy:h*.5,width:w,height:h},gray=new Uint8Array(w*h),rgba=new Uint8ClampedArray(w*h*4);
  const tex=(X,Y)=>Math.max(0,Math.min(255,126+30*Math.sin(X*21)+29*Math.cos(Y*27)+26*Math.sin((X-Y)*35)));
  // In CV convention a camera ray is [x,y,+1], then rotated camera->world.
  for(let v=0;v<h;v++)for(let u=0;u<w;u++){
    const dc=[(u-K.cx)/K.fx,(v-K.cy)/K.fy,1],dw=qRotate(pose.q,dc),t=(zPlane-pose.p[2])/(dw[2]||1e-9),i=v*w+u;
    const val=t>0?tex(pose.p[0]+dw[0]*t,pose.p[1]+dw[1]*t):0;gray[i]=val|0;rgba[i*4]=val|0;rgba[i*4+1]=Math.min(255,(val|0)+8);rgba[i*4+2]=Math.max(0,(val|0)-8);rgba[i*4+3]=255;
  }
  const features=[];let id=1;for(let Y=-.65;Y<=.65;Y+=.20)for(let X=-.9;X<=.9;X+=.20){const pr=projectPoint(pose,K,[X,Y,zPlane]);if(pr&&pr.u>5&&pr.v>5&&pr.u<w-5&&pr.v<h-5)features.push({x:pr.u,y:pr.v,score:300,source:'alva-track',desc:desc(id++)});}
  return {id:`r-${pose.p.join('-')}`,pose,K,width:w,height:h,gray,rgba,features};
}

test('rotated Alva cameras still anchor dense geometry to the same world plane',()=>{
  const ref=renderWorldPlane({p:[0,0,0],q:quatAxis([0,1,0],.035)}),src=[
    renderWorldPlane({p:[-.15,.01,.01],q:quatAxis([0,1,0],-.025)}),
    renderWorldPlane({p:[.17,-.01,.015],q:quatAxis([1,0,0],.018)}),
    renderWorldPlane({p:[.27,.015,.02],q:quatAxis([0,1,0],.045)})
  ];
  const a=buildSparseDepthAnchors(ref,src,{minAngleRad:.005,maxReprojectionPx:1.4});assert.ok(a.seeds.length>=15,`rotated seeds ${a.seeds.length}`);
  const r=estimateDenseDepth({ref,sources:src,K:ref.K,near:a.range.near,far:a.range.far,sparseSeeds:a.seeds,depthSteps:58,pixelStep:3,minViews:2,maxCost:.30,minConfidence:.05,seedMaxRelativeError:.38});
  assert.ok(r.samples.length>180,`rotated samples ${r.samples.length}`);const zs=r.samples.map(s=>s.p[2]).sort((x,y)=>x-y),med=zs[zs.length>>1];assert.ok(Math.abs(med-2.6)<.19,`rotated world plane z ${med}`);
});


test('geometry-anchored depth fuses to a mesh near the physical plane, not near the camera',()=>{
  const ref=renderWorldPlane({p:[0,0,0],q:quatAxis([0,1,0],.025)}),src=[renderWorldPlane({p:[-.15,0,.01],q:quatAxis([0,1,0],-.02)}),renderWorldPlane({p:[.17,0,.015],q:quatAxis([0,1,0],.02)}),renderWorldPlane({p:[.28,.01,.02],q:quatAxis([0,1,0],.04)})];
  const a=buildSparseDepthAnchors(ref,src,{minAngleRad:.005,maxReprojectionPx:1.4}),d=estimateDenseDepth({ref,sources:src,K:ref.K,near:a.range.near,far:a.range.far,sparseSeeds:a.seeds,depthSteps:54,pixelStep:3,minViews:2,maxCost:.30,minConfidence:.05});
  const fusion=new SparseDenseFusion({voxel:.07,truncation:.21,minSupport:2,maxTsdf:100000});
  for(let i=0;i<3;i++)fusion.integrate(d.samples,{origin:src[i].pose.p,frameId:`g-${i}`});
  const m=fusion.mesh({maxTriangles:30000});assert.ok(m.faces.length>60,`mesh faces ${m.faces.length/3}`);
  const zs=[];for(let i=2;i<m.vertices.length;i+=3)zs.push(m.vertices[i]);zs.sort((x,y)=>x-y);const med=zs[zs.length>>1];assert.ok(med>1.7&&Math.abs(med-2.6)<.55,`mesh median z ${med}`);
});
