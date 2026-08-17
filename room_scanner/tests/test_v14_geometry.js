const assert=require('assert'),G=require('../v14_cells.js');
const m=G.buildCellModel([[0,0],[4,0],[4,3],[0,3]],0,2.7); assert(Math.abs(m.area-12)<1e-6); assert(m.walls.length===4);
const pan=G.panoramaCoverage(24); G.markPanorama(pan,'photo',0,Math.PI/2,1); G.markPanorama(pan,'photo',Math.PI,Math.PI/2,1); assert(G.panoramaFraction(pan,'photo')>.3);
const cell={id:'C1',model:m,transform:{x:0,z:0,yaw:0}}; const portal=G.createPortal('C1',1,.8,1.8,2.0, 'P1'); const mesh=G.cellShellMesh(cell,[portal],[]); assert(mesh.vertices.length&&mesh.indices.length%3===0);
const samples=[]; for(let i=0;i<30;i++){const r=.3+i*.025; samples.push({r,d:1.7*r+.42+(i%7===0?.06:0),weight:1});} const fit=G.fitRelativeDepth(samples); assert(fit&&fit.n>15); assert(Math.abs(G.metricDepth(fit,.8)-(1.7*.8+.42))<.12);
const vox=new Map(); for(let x=0;x<4;x++)for(let y=0;y<3;y++)for(let z=0;z<3;z++){const p=[1+x*.055,.2+y*.055,1+z*.055]; G.mergeVoxel(vox,p,{source:'XR',frameId:'a',cellId:'C1',color:[100,120,140]},.055);G.mergeVoxel(vox,p,{source:'Deep',frameId:'b',cellId:'C1',color:[110,125,145]},.055)} const comps=G.connectedVoxelComponents(vox,.055,6); assert(comps.length===1); const o=G.objectFromCells(comps[0],1,.055); assert(o.obb.extent.every(v=>v>0)); assert(G.voxelSurfaceMesh(comps[0],.055).indices.length>0);
console.log('geometry ok');
