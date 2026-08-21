import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SurfaceMeshLab,selectSurfaceLabDataset,refineSurfaceNeighborhood} from '../js/experimental/surface_mesh_lab.js';

function makePlane(){
  const gaussians=[],offsets=[0],rows=[];let count=0;
  for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){
    const p=[x*.03,y*.03,2];
    gaussians.push({position:p.slice(),normal:[0,0,-1],color:[180,190,210],scale:[.035,.035,.006],covariance:[.001225,0,0,.001225,0,.000036],positionCovariance:[.0001,0,0,.0001,0,.000225],confidence:.9,support:4,positionSigma:.012});
    for(const o of [[-.08,0,0],[.08,0,0],[0,.08,0]]){rows.push(...o,...p,.00012,0,0,.00012,0,.00036,.92);count++;}
    offsets.push(count);
  }
  return {gaussians,observations:{stride:13,count,offsets:new Uint32Array(offsets),data:new Float32Array(rows)}};
}

test('Surface Mesh Lab is isolated: refinement never mutates the V30.26 input map',()=>{
  const src=makePlane(),before=JSON.stringify(src.gaussians),lab=new SurfaceMeshLab(src.gaussians,src.observations,{voxelM:.03});
  lab.step(3);lab.surfaceSnapshot();
  assert.equal(JSON.stringify(src.gaussians),before);
});

test('surface-aligned Gaussian field produces a stable plane mesh near the true metric surface',()=>{
  const src=makePlane(),lab=new SurfaceMeshLab(src.gaussians,src.observations,{voxelM:.03,maxGaussians:1000,maxVoxels:100000,maxTriangles:50000});
  lab.step(2);const mesh=lab.buildMesh();
  assert.ok(mesh.vertices.length/3>=50,`vertices ${mesh.vertices.length/3}`);assert.ok(mesh.faces.length/3>=80,`faces ${mesh.faces.length/3}`);
  let meanZ=0;for(let i=2;i<mesh.vertices.length;i+=3)meanZ+=mesh.vertices[i];meanZ/=mesh.vertices.length/3;
  assert.ok(Math.abs(meanZ-2)<.025,`mean z=${meanZ}`);assert.ok(mesh.tsdfVoxels>0);assert.ok(mesh.integratedRays>0);
});

test('bounded EXP dataset preserves observation alignment and is a copy',()=>{
  const src=makePlane(),sub=selectSurfaceLabDataset(src.gaussians,src.observations,25);
  assert.equal(sub.gaussians.length,25);assert.equal(sub.observations.offsets.length,26);assert.equal(sub.observations.count,75);
  sub.gaussians[0].position[0]+=99;assert.notEqual(sub.gaussians[0].position[0],src.gaussians[sub.sourceIndices[0]].position[0]);
});

test('review exposes explicit BASE/EXP rollback controls and EXP-only export',()=>{
  const html=fs.readFileSync(new URL('../room_scanner_v30.html',import.meta.url),'utf8'),app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),worker=fs.readFileSync(new URL('../workers/surface_mesh_lab_worker.js',import.meta.url),'utf8');
  for(const id of ['surfaceLabStartBtn','surfaceLabStopBtn','surfaceLabBaseBtn','surfaceLabExpBtn','surfaceLabDiscardBtn','surfaceLabExportBtn','surfaceLabIterations','surfaceLabVoxel'])assert.match(html,new RegExp(`id="${id}"`));
  for(const token of ['state.surfaceLab','renderBaseReview','renderExperimentalReview','discardSurfaceLab','selectSurfaceLabDataset','BASE V30.26 intatta'])assert.match(app,new RegExp(token.replace('.', '\\.')));
  assert.match(worker,/surface-lab-progress/);assert.match(worker,/meshPreviewEvery/);assert.match(worker,/setTimeout\(\(\)=>runChunk\(t\),0\)/);
});


test('EXP-3 local PCA improves a noisy plane without tangential collapse',()=>{
  const gaussians=[];
  for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){
    const z=2+0.012*Math.sin(x*1.7+y*.9),n=[0.15*Math.sin(x),0.12*Math.cos(y),-1],d=Math.hypot(...n);
    gaussians.push({position:[x*.03,y*.03,z],normal:n.map(v=>v/d),color:[180,190,210],scale:[.035,.035,.008],covariance:[.001225,0,0,.001225,0,.000064],positionCovariance:[.0001,0,0,.0001,0,.000225],confidence:.9,support:4,positionSigma:.012});
  }
  const refined=refineSurfaceNeighborhood(gaussians,{voxelM:.03});let beforeZ=0,afterZ=0,beforeN=0,afterN=0;
  for(let i=0;i<gaussians.length;i++){
    beforeZ+=(gaussians[i].position[2]-2)**2;afterZ+=(refined[i].position[2]-2)**2;
    beforeN+=Math.acos(Math.min(1,Math.abs(gaussians[i].normal[2])))**2;afterN+=Math.acos(Math.min(1,Math.abs(refined[i].normal[2])))**2;
    assert.ok(Math.hypot(refined[i].position[0]-gaussians[i].position[0],refined[i].position[1]-gaussians[i].position[1])<.004,'normal-only refinement must not shrink the plane tangentially');
  }
  assert.ok(afterZ<beforeZ*.85,`z variance did not improve enough: ${afterZ}/${beforeZ}`);
  assert.ok(afterN<beforeN*.85,`normal variance did not improve enough: ${afterN}/${beforeN}`);
});

test('EXP-3 neighbourhood gate preserves a 90-degree room corner',()=>{
  const gaussians=[];
  for(let k=-4;k<=4;k++)for(let j=0;j<=5;j++){
    gaussians.push({position:[j*.03,k*.03,2],normal:[0,0,-1],scale:[.032,.032,.006],covariance:[.001024,0,0,.001024,0,.000036],positionCovariance:[.0001,0,0,.0001,0,.0001],confidence:.9,support:4});
    gaussians.push({position:[0,k*.03,2+j*.03],normal:[1,0,0],scale:[.032,.032,.006],covariance:[.000036,0,0,.001024,0,.001024],positionCovariance:[.0001,0,0,.0001,0,.0001],confidence:.9,support:4});
  }
  const refined=refineSurfaceNeighborhood(gaussians,{voxelM:.03});
  for(let i=0;i<refined.length;i+=2){assert.ok(Math.abs(refined[i].normal[2])>.90,`horizontal sheet normal mixed at ${i}`);assert.ok(Math.abs(refined[i+1].normal[0])>.90,`vertical sheet normal mixed at ${i+1}`);}
});

test('EXP-3 signed field is evaluated at voxel centres, preserving an off-grid metric plane',()=>{
  const zTrue=2.017,gaussians=[],offsets=[0],rows=[];let count=0;
  for(let y=-5;y<=5;y++)for(let x=-5;x<=5;x++){
    const p=[x*.03,y*.03,zTrue];gaussians.push({position:p.slice(),normal:[0,0,-1],color:[180,190,210],scale:[.035,.035,.006],covariance:[.001225,0,0,.001225,0,.000036],positionCovariance:[.0001,0,0,.0001,0,.000225],confidence:.9,support:4,positionSigma:.012});
    for(const o of [[-.08,0,0],[.08,0,0],[0,.08,0]]){rows.push(...o,...p,.00012,0,0,.00012,0,.00036,.92);count++;}offsets.push(count);
  }
  const observations={stride:13,count,offsets:new Uint32Array(offsets),data:new Float32Array(rows)},lab=new SurfaceMeshLab(gaussians,observations,{voxelM:.03,maxGaussians:1000,maxVoxels:150000,maxTriangles:60000}),mesh=lab.buildMesh();
  let mean=0;for(let i=2;i<mesh.vertices.length;i+=3)mean+=mesh.vertices[i];mean/=mesh.vertices.length/3;
  assert.ok(mesh.vertices.length/3>100);assert.ok(Math.abs(mean-zTrue)<.003,`off-grid plane bias ${mean-zTrue} m`);assert.ok(mesh.meanPlanarity>.4,`unexpected planarity ${mesh.meanPlanarity}`);
});

test('published EXP-3 patch contract includes both lazy Surface Mesh Lab assets',()=>{
  const sw=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8'),app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  assert.ok(fs.existsSync(new URL('../js/experimental/surface_mesh_lab.js',import.meta.url)));
  assert.ok(fs.existsSync(new URL('../workers/surface_mesh_lab_worker.js',import.meta.url)));
  assert.match(sw,/\.\/js\/experimental\/surface_mesh_lab\.js/);assert.match(sw,/\.\/workers\/surface_mesh_lab_worker\.js/);
  assert.match(app,/surface-lab-asset-missing/);assert.match(app,/loadSurfaceLabAssets/);
});
