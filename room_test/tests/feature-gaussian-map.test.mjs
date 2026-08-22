import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSparseDepthAnchors} from '../js/dense/sparse_depth_anchors.js';
import {projectPoint} from '../js/slam/math.js';
import {depthMapToRaySamples,rayCovariance} from '../js/dense/deep_ray_samples.js';
import {SparseDenseFusion} from '../js/dense/fusion_core.js';

const K={fx:220,fy:220,cx:80,cy:60,width:160,height:120};
const pose=x=>({p:[x,0,0],q:[0,0,0,1]});
function descriptor(i){return Array.from({length:20},(_,k)=>(i*37+k*19+(k*i)%17)%256);}
function frame(id,x,points){const p=pose(x);return {id,pose:p,K,width:160,height:120,features:points.map((P,i)=>{const q=projectPoint(p,K,P);return {x:q.u,y:q.v,score:200-i,source:'alva-track',desc:descriptor(i)};})};}

test('multi-view Alva feature tracks become metric Gaussian landmarks with covariance',()=>{
  const points=[[-.30,-.18,1.8],[-.12,.16,2.0],[.05,-.14,2.2],[.22,.10,2.4],[-.25,.22,2.6],[.28,-.20,2.8],[.02,.24,2.15],[.31,.19,2.5]];
  const ref=frame('kf-a',0,points),sources=[frame('kf-b',.055,points),frame('kf-c',.105,points),frame('kf-d',.155,points)];
  const r=buildSparseDepthAnchors(ref,sources,{minAngleRad:.004,maxReprojectionPx:1.2,maxGapBaselineRatio:.08});
  assert.ok(r.seeds.length>=6,`seeds ${r.seeds.length}`);assert.ok(r.stats.multiViewTracks>=5,JSON.stringify(r.stats));
  const s=r.seeds.find(x=>x.viewSupport>=3);assert.ok(s,'expected a 3-source feature track');assert.equal(s.covariance.length,6);assert.ok(s.covariance.every(Number.isFinite));
  assert.ok(s.sigmaDepth>0&&s.worldSigma>0);assert.ok(s.evidenceFrames.includes('kf-a')&&s.evidenceFrames.length>=4);assert.ok(s.descriptor?.length===20);
  const nearest=points.reduce((best,P)=>Math.hypot(P[0]-s.p[0],P[1]-s.p[1],P[2]-s.p[2])<Math.hypot(...best.map((x,k)=>x-s.p[k]))?P:best,points[0]);
  assert.ok(Math.hypot(nearest[0]-s.p[0],nearest[1]-s.p[1],nearest[2]-s.p[2])<.015,`track point ${s.p}`);
});

test('one proxy keyframe collapses track + MVS + Deep into non-duplicated Gaussian observations',()=>{
  const w=80,h=60,K2={fx:75,fy:75,cx:40,cy:30,width:w,height:h},depth=new Float32Array(w*h);depth.fill(2.15);const rgba=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){rgba[i*4]=110;rgba[i*4+1]=150;rgba[i*4+2]=190;rgba[i*4+3]=255;}
  const ref={id:'kf-a',pose:pose(0),K:K2,width:w,height:h,rgba},trackCov=rayCovariance([0,0,1],.025,.006),seed={u:40,v:30,depth:2,p:[0,0,2],confidence:.95,viewSupport:2,sourceIds:['kf-b','kf-c'],evidenceFrames:['kf-a','kf-b','kf-c'],trackId:'t0',sigmaDepth:.025,worldSigma:.008,covariance:trackCov,descriptor:descriptor(2)};
  const refined=[{u:40,v:30,depth:2.01,p:[.002,0,2.01],normal:[0,0,-1],color:[115,150,190],confidence:.9,cost:.02,viewMask:3,viewSupport:3}];
  const r=depthMapToRaySamples({depth,width:w,height:h,ref,K:K2,baseConfidence:.8,relativeSigma:new Float32Array(w*h).fill(.08),sparseSeeds:[seed],refinedSamples:refined,sourceFrames:['kf-b','kf-c'],pixelStep:4,maxSamples:1000});
  assert.equal(r.stats.trackEnhanced,1);const fused=r.samples.find(s=>s.trackId==='t0');assert.ok(fused);assert.equal(fused.source,'proxy-track-mvs');assert.ok(fused.normalReliable);assert.ok(fused.evidenceFrames.length>=3);assert.ok(Math.hypot(...fused.p.map((x,i)=>x-seed.p[i]))<1e-8);
  assert.ok(!r.samples.some(s=>s.source==='deep-proxy'&&Math.hypot(s.u-40,s.v-30)<5),'Deep must not duplicate a feature/MVS landmark from the same keyframe');
});

test('continuous information Gaussian map is not quantised to one hypothesis per hash voxel',()=>{
  const f=new SparseDenseFusion({voxel:.035,hashVoxel:.02,minSupport:2,minConfirmBaseline:.02});
  const base={normal:[0,0,-1],normalReliable:true,color:[180,180,180],confidence:.85,radius:.008,sigmaDepth:.025,sigmaLateral:.004,source:'proxy-track',viewSupport:2,evidenceFrames:['a','b']};
  f.integrate([{...base,p:[.001,.001,2],depth:2},{...base,p:[.013,.001,2],depth:2,normal:[1,0,0],normalReliable:true,evidenceFrames:['a','b']}],{origin:[0,0,0],frameId:'a',mode:'proxy-depth'});
  assert.equal(f.surfels.size,2,'two incompatible continuous hypotheses in one hash cell must survive');assert.ok(f.spatial.size<=2);
});

test('information fusion converges the centre and shrinks uncertainty only with new camera evidence',()=>{
  const f=new SparseDenseFusion({voxel:.035,hashVoxel:.02,minSupport:2,minConfirmBaseline:.02});
  // Each ray is already independently checked by another view.  Raw monocular
  // Deep evidence without this provenance is intentionally withheld.
  const obs=(p,origin,id)=>{const ray=[p[0]-origin[0],p[1]-origin[1],p[2]-origin[2]],n=Math.hypot(...ray),r=ray.map(x=>x/n);return {p,normal:[0,0,-1],normalReliable:true,color:[140,170,200],confidence:.9,radius:.012,depth:n,sigmaDepth:.07,sigmaLateral:.007,covariance:rayCovariance(r,.07,.007),source:'proxy-verified',independentSupport:1,evidenceFrames:[id]};};
  f.integrate([obs([.006,0,2.025],[0,0,0],'a')],{origin:[0,0,0],frameId:'a'});f.integrate([obs([-.004,0,1.985],[.08,0,0],'b')],{origin:[.08,0,0],frameId:'b'});let a=[...f.surfels.values()][0],t2=a.positionCov[0]+a.positionCov[3]+a.positionCov[5];assert.equal(a.support,2);assert.equal(f.splats().length,1);
  f.integrate([obs([[.002][0],.002,2.005],[0,.08,0],'c')],{origin:[0,.08,0],frameId:'c'});a=[...f.surfels.values()].sort((x,y)=>y.support-x.support)[0];const t3=a.positionCov[0]+a.positionCov[3]+a.positionCov[5];assert.ok(t3<t2,`${t3} !< ${t2}`);assert.ok(Math.hypot(a.p[0],a.p[1],a.p[2]-2)<.035,`mean ${a.p}`);
  const support=a.support,observations=a.observations;f.integrate([obs([.001,0,2.01],[0,.08,0],'c')],{origin:[0,.08,0],frameId:'c'});a=[...f.surfels.values()].sort((x,y)=>y.support-x.support)[0];assert.equal(a.support,support);assert.equal(a.observations,observations,'replaying the same view must not manufacture precision');
});

test('Gaussian PLY roundtrip preserves anisotropic 3D covariance and support',async()=>{
  const {gaussiansToPly,parsePly}=await import('../js/formats.js');
  const src={position:[.12,-.03,2.4],color:[121,144,188],opacity:.77,scale:[.018,.031,.004],covariance:[.000324,.00004,0,.000961,.00001,.000016],confidence:.91,support:5};
  const out=parsePly(gaussiansToPly([src],'V30.25 covariance contract'))[0];
  assert.deepEqual(out.position,src.position);assert.deepEqual(out.scale,src.scale);assert.deepEqual(out.covariance,src.covariance);assert.equal(out.support,5);assert.equal(out.confidence,.91);
});

test('joint reprojection refinement keeps a noisy multi-view feature track close to its true 3D point',()=>{
  const P=[.14,-.07,2.25],ref=frame('n-a',0,[P]),offsets=[[.35,-.25],[-.28,.18],[.22,.31],[-.31,-.16]],xs=[.045,.09,.135,.18];
  const sources=xs.map((x,i)=>{const f=frame(`n-${i+1}`,x,[P]);f.features[0].x+=offsets[i][0];f.features[0].y+=offsets[i][1];return f;});
  const r=buildSparseDepthAnchors(ref,sources,{minAngleRad:.0035,maxReprojectionPx:1.8,maxGapBaselineRatio:.12});assert.equal(r.seeds.length,1,JSON.stringify(r.stats));const s=r.seeds[0];
  assert.ok(s.viewSupport>=3);assert.ok(s.reprojectionPx<.8,`reprojection ${s.reprojectionPx}`);assert.ok(Math.hypot(s.p[0]-P[0],s.p[1]-P[1],s.p[2]-P[2])<.035,`refined point ${s.p}`);assert.ok(s.covariance[0]>0&&s.covariance[3]>0&&s.covariance[5]>0);
});
