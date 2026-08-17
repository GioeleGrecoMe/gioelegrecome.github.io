'use strict';
const assert=require('assert');
const G=require('../v14_cells.js');
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} !~= ${b}`);

// 1) Authoritative local footprint stays simple and metric.
{
  const m=G.buildCellModel([[0,0],[4,0],[4,3],[0,3]],2.65,0);
  near(m.area,12);assert.equal(m.walls.length,4);near(m.walls[0].length,4);near(m.ceilY,2.65);
}
// 2) Panorama is a union of partial photos, not a stitched image requirement.
{
  const c=G.panoramaCoverage(24);
  G.markPanorama(c,'photo',-2.25,1.45,.9);
  G.markPanorama(c,'photo',-1.05,1.45,.9);
  G.markPanorama(c,'photo',.15,1.45,.9);
  G.markPanorama(c,'photo',1.35,1.45,.9);
  G.markPanorama(c,'photo',2.55,1.45,.9);
  assert.ok(G.panoramaFraction(c,'photo',.5)>.75);
  assert.ok(Number.isFinite(G.weakestPanoramaYaw(c,'photo')));
}
// 3) Known wall plane turns a ceiling-edge ray into metric height without pixel depth.
{
  const m=G.buildCellModel([[0,0],[4,0],[4,3],[0,3]],2.7,0),w=m.walls[0];
  // wall 0 is z=0; camera is inside at z=1.5, target top at x=2,z=0,y=2.72
  const o=[2,1.35,1.5],target=[2,2.72,0],d=G.n3(G.s3(target,o));
  const q=G.heightFromWallRay({o,d},w,0,1.8,4.5);assert.ok(q);near(q.height,2.72,.01);
}
// 4) Portal registration: target cell is rigidly aligned to the shared opening wall.
{
  const src={id:'C1',model:G.buildCellModel([[0,0],[4,0],[4,3],[0,3]],2.7,0),transform:{x:0,z:0,yaw:0}};
  const portal=G.createPortal('C1',1,1.0,2.0,2.1,'P1');
  const tgt={id:'C2',model:G.buildCellModel([[0,-.6],[3,-.6],[3,.6],[0,.6]],2.7,0),transform:{x:4.12,z:1.50,yaw:.025}};
  const reg=G.registerCellToPortal(tgt,src,portal,tgt.transform,[5.2,1.5],[2,1.5]);assert.ok(reg.ok,JSON.stringify(reg));
  near(reg.transform.x,4,.10);near(reg.transform.z,1.5,.10);near(reg.transform.yaw,0,.05);assert.equal(reg.wallIndex,3);
  const gw=G.wallGlobal(tgt,reg.wallIndex,reg.transform),ps=G.portalGlobalSegment(src,portal);
  assert.ok(Math.abs(G.d2(gw.n,ps.n)+1)<.02,'target entrance normal must oppose source room normal');
}
// 5) A portal opening creates wall pieces while the target entrance wall can be skipped.
{
  const c={id:'C1',model:G.buildCellModel([[0,0],[4,0],[4,3],[0,3]],2.7,0),transform:{x:0,z:0,yaw:0},entranceWallIndex:null};
  const p=G.createPortal('C1',1,1,2,2.05,'P1');
  const mesh=G.cellShellMesh(c,[p],[]);assert.ok(mesh.vertices.length>0&&mesh.indices.length>0);
  const full=G.cellShellMesh(c,[],[]);assert.ok(mesh.indices.length<full.indices.length+12,'portal wall remains compact');
}
// 6) Relative Deep scale+shift remains robust to outliers.
{
  const samples=[];for(let i=0;i<75;i++){const r=.25+i*.014,d=1.8*r+.31+(i%5-2)*.002;samples.push({r,d,weight:1})}
  for(let i=0;i<14;i++)samples.push({r:.4+i*.03,d:5+i*.2,weight:.8});
  const f=G.fitRelativeDepth(samples);assert.ok(f);near(f.m,1.8,.05);near(f.b,.31,.05);assert.ok(f.med<.03);
}
// 7) Persistent XR+Deep residuals produce an actual object population + OBB.
{
  const map=new Map(),size=.08;for(let x=0;x<4;x++)for(let y=0;y<5;y++)for(let z=0;z<3;z++){const p=[1+x*size,.15+y*size,1+z*size];G.mergeVoxel(map,p,{source:'XR',frameId:'a',cellId:'C1',color:[120,80,60]},size);G.mergeVoxel(map,p,{source:'Deep',frameId:'b',cellId:'C1',color:[122,82,61]},size)}
  const comps=G.connectedVoxelComponents(map,size,8);assert.equal(comps.length,1);const o=G.objectFromCells(comps[0],1,size),mesh=G.voxelSurfaceMesh(comps[0],size);assert.ok(o.obb.extent.every(v=>v>0));assert.ok(mesh.vertices.length&&mesh.indices.length);
}
console.log('V14 geometry tests: PASS');
