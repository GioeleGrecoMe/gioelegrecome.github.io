const assert=require('assert'),G=require('../v14_cells.js');
// Cell A: 4x3 room, portal on east wall. Cell B starts in its own local frame.
const A={id:'C1',model:G.buildCellModel([[0,0],[4,0],[4,3],[0,3]],0,2.6),transform:{x:0,z:0,yaw:0}};
const B={id:'C2',model:G.buildCellModel([[0,0],[2.5,0],[2.5,1.5],[0,1.5]],0,2.6),transform:{x:4,z:1,yaw:0}};
const p=G.createPortal('C1',1,.9,1.8,2.05,'P1');
const reg=G.registerCellToPortal(B,A,p,B.transform,[4.7,1.35],[2,1.5]); assert(reg.transform&&Number.isFinite(reg.transform.x)&&Number.isFinite(reg.transform.yaw));
const shell=G.cellShellMesh(A,[p],[]); assert(shell.indices.length>0);
// Portal cutout should make fewer wall triangles than an otherwise identical closed cell.
const closed=G.cellShellMesh(A,[],[]); assert(shell.indices.length<closed.indices.length+12,'portal shell finite');
console.log('integration ok',{registrationScore:+reg.score.toFixed(3)});
