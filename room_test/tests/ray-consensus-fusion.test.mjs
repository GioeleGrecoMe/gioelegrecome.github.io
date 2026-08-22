import test from 'node:test';
import assert from 'node:assert/strict';
import {SparseDenseFusion,extractTsdfMesh} from '../js/dense/fusion_core.js';
import {depthMapToRaySamples,rayCovariance} from '../js/dense/deep_ray_samples.js';

function sample({p=[0,0,2],origin=[0,0,0],source='deep-proxy',sigmaDepth=.14,sigmaLateral=.018,confidence=.8,evidenceFrames=null,independentSupport=0,viewSupport=1}={}){const ray=[p[0]-origin[0],p[1]-origin[1],p[2]-origin[2]],n=Math.hypot(...ray)||1,r=ray.map(x=>x/n);return {p,normal:[0,0,-1],normalReliable:true,color:[180,190,200],confidence,radius:.018,depth:n,sigmaDepth,sigmaLateral,covariance:rayCovariance(r,sigmaDepth,sigmaLateral),source,evidenceFrames,independentSupport,viewSupport};}

test('replaying correlated evidence from one camera cannot self-confirm or shrink a surface',()=>{
  const f=new SparseDenseFusion({voxel:.035,minSupport:2,minConfirmBaseline:.03});
  f.integrate([sample({evidenceFrames:['kf-a']})],{origin:[0,0,0],frameId:'kf-a',mode:'deep-proxy'});const before=[...f.surfels.values()][0].positionCov.slice();
  f.integrate([sample({p:[.002,0,2.008],source:'proxy-verified',sigmaDepth:.04,evidenceFrames:['kf-a']})],{origin:[0,0,0],frameId:'kf-a',mode:'proxy-depth'});
  assert.equal(f.surfels.size,1);assert.equal(f.splats().length,0);const only=[...f.surfels.values()][0];assert.equal(only.support,1);assert.deepEqual(only.positionCov,before);assert.equal(only.observations,1);
});

test('out-of-order replay of an already seen keyframe cannot inflate view support',()=>{
  const f=new SparseDenseFusion({voxel:.035,minSupport:2,minConfirmBaseline:.03});
  f.integrate([sample({evidenceFrames:['kf-a']})],{origin:[0,0,0],frameId:'kf-a'});f.integrate([sample({p:[.003,0,2.01],origin:[.08,0,0],evidenceFrames:['kf-b']})],{origin:[.08,0,0],frameId:'kf-b'});const only=[...f.surfels.values()][0],support=only.support,obs=only.observations;
  f.integrate([sample({p:[.001,0,2.004],source:'proxy-verified',sigmaDepth:.04,evidenceFrames:['kf-a']})],{origin:[0,0,0],frameId:'kf-a'});assert.equal(only.support,support);assert.equal(only.observations,obs);
});

test('a second Alva view confirms an elongated ray Gaussian and an axial outlier stays separate',()=>{
  const f=new SparseDenseFusion({voxel:.035,minSupport:2,minConfirmBaseline:.03});
  f.integrate([sample({source:'proxy-verified',independentSupport:1,evidenceFrames:['a']})],{origin:[0,0,0],frameId:'a'});f.integrate([sample({p:[.004,0,2.015],origin:[.08,0,0],sigmaDepth:.12,source:'proxy-verified',independentSupport:1,evidenceFrames:['b']})],{origin:[.08,0,0],frameId:'b'});const good=f.splats();assert.equal(good.length,1);assert.equal(good[0].support,2);const before=good[0].position[2];
  f.integrate([sample({p:[0,0,1.1],origin:[.16,0,0],sigmaDepth:.05,source:'proxy-verified',evidenceFrames:['c']})],{origin:[.16,0,0],frameId:'c'});const after=f.splats();assert.equal(after.length,1);assert.ok(Math.abs(after[0].position[2]-before)<.04);
});

test('calibrated Deep map becomes compact full-covariance observations',()=>{
  const w=80,h=60,K={fx:75,fy:75,cx:w/2,cy:h/2,width:w,height:h},depth=new Float32Array(w*h);depth.fill(2);const rgba=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){rgba[i*4]=120;rgba[i*4+1]=160;rgba[i*4+2]=190;rgba[i*4+3]=255;}const ref={id:'a',pose:{p:[0,0,0],q:[0,0,0,1]},K,width:w,height:h,rgba};
  const r=depthMapToRaySamples({depth,width:w,height:h,ref,K,baseConfidence:.8,calibrationRelativeError:.08,pixelStep:5,maxSamples:2000,sparseSeeds:[{u:40,v:30,depth:2,confidence:.9}]});assert.ok(r.samples.length>100&&r.samples.length<2000);assert.ok(r.samples.every(s=>s.covariance?.length===6&&s.surfaceCovariance?.length===6));assert.ok(r.samples.filter(s=>s.source==='deep-proxy').every(s=>s.sigmaDepth>s.sigmaLateral));
});

test('TSDF extraction uses voxel centres and never invents free space at unknown corners',()=>{
  const v=.1,map=new Map(),color=[180,180,180];for(const x of [0,1])for(const y of [0,1])for(const z of [19,20]){const centerZ=(z+.5)*v;map.set(`${x},${y},${z}`,{d:(centerZ-2)/v,w:1,color});}const mesh=extractTsdfMesh(map,v,100);assert.ok(mesh.faces.length>0);const zs=[];for(let i=2;i<mesh.vertices.length;i+=3)zs.push(mesh.vertices[i]);const mean=zs.reduce((a,b)=>a+b,0)/zs.length;assert.ok(Math.abs(mean-2)<1e-6);const incomplete=new Map(map);incomplete.delete('1,1,20');assert.equal(extractTsdfMesh(incomplete,v,100).faces.length,0);
});
