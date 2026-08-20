import test from 'node:test';
import assert from 'node:assert/strict';
import {SparseDenseFusion,extractTsdfMesh} from '../js/dense/fusion_core.js';
import {depthMapToRaySamples} from '../js/dense/deep_ray_samples.js';

function sample({p=[0,0,2],origin=[0,0,0],source='deep-ray',sigmaDepth=.14,sigmaLateral=.018,confidence=.8}={}){
  return {p,normal:[0,0,-1],color:[180,190,200],confidence,radius:.018,depth:Math.hypot(p[0]-origin[0],p[1]-origin[1],p[2]-origin[2]),sigmaDepth,sigmaLateral,source};
}

test('Deep and MVS from one camera cannot self-confirm a surface',()=>{
  const f=new SparseDenseFusion({voxel:.035,minSupport:2,minConfirmBaseline:.03});
  f.integrate([sample()],{origin:[0,0,0],frameId:'kf-a',mode:'deep-ray'});
  f.integrate([sample({p:[.002,0,2.008],source:'mvs-refined',sigmaDepth:.04})],{origin:[0,0,0],frameId:'kf-a',mode:'mvs-refined'});
  assert.equal(f.surfels.size,1);
  assert.equal(f.splats().length,0,'same keyframe must remain provisional');
  const only=[...f.surfels.values()][0];assert.equal(only.support,1);assert.ok(only.observations>=2);
});

test('out-of-order replay of an already seen keyframe cannot inflate view support',()=>{
  const f=new SparseDenseFusion({voxel:.035,minSupport:2,minConfirmBaseline:.03});
  f.integrate([sample()],{origin:[0,0,0],frameId:'kf-a',mode:'deep-ray'});
  f.integrate([sample({p:[.003,0,2.01],origin:[.08,0,0]})],{origin:[.08,0,0],frameId:'kf-b',mode:'deep-ray'});
  // Simulate a delayed MVS result from kf-a arriving after kf-b.
  f.integrate([sample({p:[.001,0,2.004],source:'mvs-refined',sigmaDepth:.04})],{origin:[0,0,0],frameId:'kf-a',mode:'mvs-refined'});
  const only=[...f.surfels.values()][0];
  assert.equal(only.support,2,'distinct-view support must remain {kf-a,kf-b}, not count delayed kf-a twice');
  assert.deepEqual(new Set(only.recentFrames),new Set(['kf-a','kf-b']));
});

test('a second Alva view confirms the elongated ray Gaussian and an axial outlier stays provisional',()=>{
  const f=new SparseDenseFusion({voxel:.035,minSupport:2,minConfirmBaseline:.03});
  f.integrate([sample()],{origin:[0,0,0],frameId:'kf-a',mode:'deep-ray'});
  f.integrate([sample({p:[.004,0,2.015],origin:[.08,0,0],sigmaDepth:.12})],{origin:[.08,0,0],frameId:'kf-b',mode:'deep-ray'});
  const good=f.splats();assert.equal(good.length,1);assert.equal(good[0].support,2);assert.ok(good[0].maxBaseline>=.079);
  const before=good[0].position[2];
  f.integrate([sample({p:[0,0,1.1],origin:[.16,0,0],sigmaDepth:.05})],{origin:[.16,0,0],frameId:'kf-c',mode:'mvs-refined'});
  const after=f.splats();assert.equal(after.length,1,'one contradictory view must not become a confirmed ghost');assert.ok(Math.abs(after[0].position[2]-before)<.04,'far axial outlier dragged the confirmed surface');
});

test('calibrated Deep map becomes compact anisotropic ray observations',()=>{
  const w=80,h=60,K={fx:75,fy:75,cx:w/2,cy:h/2,width:w,height:h},depth=new Float32Array(w*h);depth.fill(2);
  const rgba=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){rgba[i*4]=120;rgba[i*4+1]=160;rgba[i*4+2]=190;rgba[i*4+3]=255;}
  const ref={pose:{p:[0,0,0],q:[0,0,0,1]},K,width:w,height:h,rgba};
  const r=depthMapToRaySamples({depth,width:w,height:h,ref,K,baseConfidence:.8,calibrationRelativeError:.08,pixelStep:5,maxSamples:2000,sparseSeeds:[{u:40,v:30,depth:2,confidence:.9}]});
  assert.ok(r.samples.length>100&&r.samples.length<2000,`samples ${r.samples.length}`);
  assert.ok(r.samples.every(s=>s.sigmaDepth>s.sigmaLateral),'Deep uncertainty must remain elongated along the ray');
  assert.ok(r.samples.some(s=>s.anchorBoost>0),'Alva anchor should tighten nearby ray observations');
});

test('TSDF extraction uses voxel centres and never invents free space at unknown corners',()=>{
  const v=.1,map=new Map(),color=[180,180,180];
  for(const x of [0,1])for(const y of [0,1])for(const z of [19,20]){const centerZ=(z+.5)*v;map.set(`${x},${y},${z}`,{d:(centerZ-2)/v,w:1,color});}
  const mesh=extractTsdfMesh(map,v,100);assert.ok(mesh.faces.length>0,'fully observed sign-changing cube should mesh');
  const zs=[];for(let i=2;i<mesh.vertices.length;i+=3)zs.push(mesh.vertices[i]);const mean=zs.reduce((a,b)=>a+b,0)/zs.length;assert.ok(Math.abs(mean-2)<1e-6,`voxel-centre bias: ${mean}`);
  const incomplete=new Map(map);incomplete.delete('1,1,20');const noPhantom=extractTsdfMesh(incomplete,v,100);assert.equal(noPhantom.faces.length,0,'unknown TSDF corner must not act as +free-space');
});
