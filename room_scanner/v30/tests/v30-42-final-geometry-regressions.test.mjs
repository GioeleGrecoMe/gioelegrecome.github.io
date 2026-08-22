import test from 'node:test';
import assert from 'node:assert/strict';
import {revalidateMvsSample} from '../js/probabilistic/final_mvs_revalidation.js';
import {buildConsensusTsdfMeshFromSplats} from '../js/dense/fusion_core.js';
import {analyzeMeshQuality} from '../js/reconstruction/mesh_quality.js';

const K={fx:100,fy:100,cx:50,cy:50,width:100,height:100};
const pose=x=>({p:[x,0,0],q:[0,0,0,1]});
function texture(x,y){return 128+54*Math.sin(x*.31)+39*Math.cos(y*.27)+24*Math.sin((x+y)*.17);}
function photo(shift=0){const gray=new Uint8Array(100*100);for(let y=0;y<100;y++)for(let x=0;x<100;x++)gray[y*100+x]=Math.max(0,Math.min(255,Math.round(texture(x+shift,y))));return {gray,width:100,height:100,K};}
function frame(id,x,p){return {frameId:id,posePrior:pose(x),poseEstimate:pose(x),K,width:100,height:100,photo:p};}
function splat(x,y,z,n=[0,0,-1]){return {position:[x,y,z],normal:n,normalReliable:true,viewOrigin:[0,0,0],sourceMask:2,color:[180,185,190],scale:[.025,.025,.006],positionCovariance:[1e-5,0,0,1e-5,0,1e-5],positionSigma:.003,confidence:.9,support:3,independentSupport:2,finalPoseValidated:true};}

test('final-pose MVS rescoring corrects stale depth using current camera geometry',()=>{
  const truth=2,baseline=.1,pixelShift=K.fx*baseline/truth,ref=frame('r',0,photo(0)),src=frame('s',baseline,photo(pixelShift)),sample={u:50,v:50,depth:2.4,sigmaDepth:.30,probability:.9};
  const r=revalidateMvsSample(sample,ref,[src],{candidateCount:17,maxCorrectionRel:.45,maxCost:.42,minDistinctiveness:.004});
  assert.equal(r.accepted,true,r);assert.ok(Math.abs(r.depth-truth)<.18,r);assert.deepEqual(r.verifiedSourceIds,['s']);assert.ok(r.correctionRel>.05,r);
});

test('final-pose MVS refuses historical depth when source photographs cannot validate it',()=>{
  const ref=frame('r',0,photo(0)),src={frameId:'s',posePrior:pose(.1),poseEstimate:pose(.1),K,width:100,height:100,photo:null},r=revalidateMvsSample({u:50,v:50,depth:2,sigmaDepth:.1,probability:.9},ref,[src]);
  assert.equal(r.accepted,false);assert.match(r.reason,/source-photos/);
});

test('disconnected pieces of one surface share a global conflict layer and no surfels are dropped',()=>{
  const rows=[];for(const ox of [-1.2,1.2])for(let y=-.18;y<=.18+1e-9;y+=.06)for(let x=-.18;x<=.18+1e-9;x+=.06)rows.push(splat(ox+x,y,2));
  const mesh=buildConsensusTsdfMeshFromSplats(rows,{voxel:.03,maxTriangles:50000});
  assert.equal(mesh.consensusMode,'conflict-colored-multi-layer-tsdf');assert.equal(mesh.surfaceLayers,1,mesh);assert.equal(mesh.sourceSurfels,mesh.inputSurfels,mesh);assert.equal(mesh.droppedSurfels,0,mesh);assert.equal(mesh.meshedSurfelFraction,1,mesh);
});

test('nearby parallel sheets are conflict-colored into separate layers without discarding either sheet',()=>{
  const rows=[];for(const z of [2,2.12])for(let y=-.3;y<=.3+1e-9;y+=.05)for(let x=-.3;x<=.3+1e-9;x+=.05)rows.push(splat(x,y,z));
  const mesh=buildConsensusTsdfMeshFromSplats(rows,{voxel:.03,maxTriangles:80000}),q=analyzeMeshQuality(mesh);
  assert.equal(mesh.surfaceLayers,2,mesh);assert.equal(mesh.sourceSurfels,mesh.inputSurfels,mesh);assert.ok(mesh.vertices.length>0,mesh);assert.equal(q.evidenceStarved,false,q);
});

test('mesh audit calls severe surfel loss fragmented even with fewer than eight components',()=>{
  const vertices=new Float32Array([0,0,0,.02,0,0,0,.02,0, 1,0,0,1.02,0,0,1,.02,0]),faces=new Uint32Array([0,1,2,3,4,5]),mesh={vertices,faces,inputSurfels:100,sourceSurfels:5,meshedSurfelFraction:.05},q=analyzeMeshQuality(mesh);
  assert.equal(q.evidenceStarved,true,q);assert.equal(q.status,'fragmented',q);
});
