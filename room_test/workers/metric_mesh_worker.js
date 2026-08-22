/* Lightweight metric occupancy mesher for Gaussian surface samples.
 * This intentionally produces a conservative diagnostic mesh, not a
 * photorealistic final mesh. Units are metres.
 */
self.onmessage=e=>{const m=e.data||{};if(m.type!=='mesh')return;try{const r=mesh(m.samples||[],m.voxelM||.04,m.maxVoxels||220000);self.postMessage({type:'mesh-result',...r});}catch(err){self.postMessage({type:'mesh-error',message:err.message,stack:err.stack});}};
function mesh(samples,voxel,maxVoxels){
 const cells=new Map(),key=(x,y,z)=>`${x},${y},${z}`;for(const s of samples){const p=s.p;if(!p||p.length<3)continue;const x=Math.floor(p[0]/voxel),y=Math.floor(p[1]/voxel),z=Math.floor(p[2]/voxel),k=key(x,y,z),a=cells.get(k)||{x,y,z,n:0,r:0,g:0,b:0};a.n++;const c=s.color||[180,180,180];a.r+=Number(c[0]??180);a.g+=Number(c[1]??180);a.b+=Number(c[2]??180);cells.set(k,a);if(cells.size>maxVoxels)throw new Error(`mesh voxel cap exceeded (${maxVoxels}); increase voxel size`);}
 const vertices=[],colors=[],faces=[],dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],corners=[[[1,0,0],[1,1,0],[1,1,1],[1,0,1]],[[0,0,1],[0,1,1],[0,1,0],[0,0,0]],[[0,1,1],[1,1,1],[1,1,0],[0,1,0]],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],[[1,0,1],[1,1,1],[0,1,1],[0,0,1]],[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]];
 for(const a of cells.values())for(let d=0;d<6;d++){const v=dirs[d];if(cells.has(key(a.x+v[0],a.y+v[1],a.z+v[2])))continue;const base=vertices.length/3,c=[Math.round(a.r/a.n),Math.round(a.g/a.n),Math.round(a.b/a.n)];for(const o of corners[d]){vertices.push((a.x+o[0])*voxel,(a.y+o[1])*voxel,(a.z+o[2])*voxel);colors.push(...c);}faces.push(base,base+1,base+2,base,base+2,base+3);}
 return {voxelM:voxel,occupiedVoxels:cells.size,vertices:new Float32Array(vertices),colors:new Uint8Array(colors),faces:new Uint32Array(faces)};
}
