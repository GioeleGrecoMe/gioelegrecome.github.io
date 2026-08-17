'use strict';
const assert=require('assert');
const G=require('../v13_geometry.js');
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} !~= ${b}`);

function rayTo(cam,target){return{o:[...cam],d:G.n3(G.s3(target,cam))}}

// 1) Multi-view vertical corner: BASE/CENTRO/TETTO constrain the same XZ line.
{
  const trueXZ=[2.35,-1.20],H=2.62;
  const obs=[];
  const cams=[[-.2,1.25,-.1],[1.0,1.45,1.8],[4.1,1.55,.7],[-.3,1.35,-2.8]];
  const levels=[['base',0],['mid',1.3],['top',H],['top',H]];
  cams.forEach((c,i)=>{const [level,y]=levels[i],r=rayTo(c,[trueXZ[0],y,trueXZ[1]]);obs.push({...r,level,viewId:`v${i}`,weight:1})});
  const c={prior:[2.0,-.9],observations:obs};
  const solved=G.solveAllCorners([c],2.8,{floorY:0,minH:1.8,maxH:4.5,priorWeight:.2});
  near(solved.corners[0].solution.xz[0],trueXZ[0],.025);
  near(solved.corners[0].solution.xz[1],trueXZ[1],.025);
  near(solved.height,H,.04);
  assert.equal(G.cornerQuality(solved.corners[0]).level,'good');
}

// 2) Outlier view must not drag a good corner.
{
  const xz=[1.8,2.2],H=2.7,obs=[];
  [[0,1.4,0],[3.5,1.4,0],[0,1.5,4]].forEach((c,i)=>{const r=rayTo(c,[xz[0],i===2?H:1.1,xz[1]]);obs.push({...r,level:i===2?'top':'mid',viewId:`g${i}`})});
  obs.push({...rayTo([5,1.2,5],[.2,1.1,.2]),level:'mid',viewId:'bad'});
  const s=G.solveCornerXZ(obs,H,[1.7,2.0],{priorWeight:.25});
  assert.ok(G.len2(G.s2(s.xz,xz))<.08,`corner drifted ${G.len2(G.s2(s.xz,xz))}`);
}

// 3) Closed concave shell by construction.
{
  const p=[[0,0],[4,0],[4,1.2],[2.1,1.2],[2.1,3.2],[0,3.2]],m=G.buildRoomModel(p,2.75,0),mesh=G.shellMesh(m);
  assert.ok(G.meshIsClosed(mesh));
  assert.equal(mesh.vertices.length,p.length*2);
  near(m.area,9.0,1e-6);
}

// 4) Parallel wall refinement cannot rotate wall normals.
{
  const m=G.buildRoomModel([[0,0],[4,0],[4,3],[0,3]],2.7,0),before=m.walls.map(w=>[...w.n]);
  const samples=m.walls.map(()=>[]);
  for(let i=0;i<24;i++)samples[0].push({offset:.08+(i%3-1)*.003,weight:1});
  // Large furniture-like residual must be clipped by the per-wall limit.
  for(let i=0;i<40;i++)samples[1].push({offset:.32,weight:1});
  const r=G.applyParallelWallRefinement(m,samples,[.10,.04,.10,.10]);assert.ok(r.ok);
  near(r.fit.offsets[0],.08,.008);near(r.fit.offsets[1],.04,.001);
  r.model.walls.forEach((w,i)=>{near(w.n[0],before[i][0],1e-9);near(w.n[1],before[i][1],1e-9)});
  assert.ok(G.meshIsClosed(G.shellMesh(r.model)));
}

// 5) Relative Deep fit recovers affine metric relation with outliers.
{
  const samples=[];for(let i=1;i<=80;i++){const r=.2+i*.017,d=1.65*r+.38+(i%7-3)*.002;samples.push({r,d,weight:1})}
  for(let i=0;i<16;i++)samples.push({r:.3+i*.04,d:6+i*.2,weight:.8});
  const f=G.fitRelativeDepth(samples);assert.ok(f);assert.equal(f.mode,'direct');near(f.m,1.65,.035);near(f.b,.38,.035);assert.ok(f.med<.02);
}

// 6) Coverage composes partial views instead of requiring one complete photo.
{
  const g=G.coverageGrid(20,10);
  for(let y=0;y<10;y++)for(let x=0;x<11;x++)G.updateCoverage(g,'photo',(x+.5)/20,(y+.5)/10,1);
  for(let y=0;y<10;y++)for(let x=8;x<20;x++)G.updateCoverage(g,'photo',(x+.5)/20,(y+.5)/10,1);
  assert.ok(G.coverageFraction(g,'photo',.5)>.95);
}

// 7) Objects require persistence across distinct frames/views and yield a real voxel surface.
{
  const map=new Map(),size=.1;
  for(let x=0;x<4;x++)for(let y=0;y<5;y++)for(let z=0;z<3;z++){
    const p=[1+x*size,.1+y*size,1+z*size];
    G.mergeVoxel(map,p,{source:'XR',frameId:'xr-a',color:[100,150,200]},size);
    G.mergeVoxel(map,p,{source:'Deep',frameId:'deep-b',color:[105,152,198]},size);
  }
  // One-view noise is ineligible.
  for(let i=0;i<9;i++)G.mergeVoxel(map,[3+i*.1,.3,.5],{source:'Deep',frameId:'noise'},size);
  const comps=G.connectedVoxelComponents(map,size,8);assert.equal(comps.length,1);
  const obj=G.objectFromCells(comps[0],1,size),mesh=G.voxelSurfaceMesh(comps[0],size);
  assert.ok(obj.obb.extent.every(x=>x>0));assert.ok(mesh.vertices.length>0&&mesh.indices.length>0);
}

console.log('V13 geometry tests: PASS');
