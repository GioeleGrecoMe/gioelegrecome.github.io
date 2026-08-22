import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {filterSurfaceSplatsForDisplay,filterSurfaceSplatsForMeshing} from '../js/reconstruction/surface_display_policy.js';
import {evaluateFinalGeometryPolicy} from '../js/probabilistic/geometry_commit_policy.js';

const frames=[{poseEstimate:{p:[0,0,0]}},{poseEstimate:{p:[8,0,0]}}];

test('low-confidence Gaussian clutter is hidden from display, not mutated',()=>{
  const rows=[
    {id:'low',confidence:.10,support:2,evidenceClass:'weak'},
    {id:'mid',confidence:.31,support:2,evidenceClass:'confirmed',finalPoseValidated:true},
    {id:'strong',confidence:.25,support:5,independentSupport:3,evidenceClass:'strong',finalPoseValidated:true},
    {id:'hi',confidence:.82,support:2,evidenceClass:'confirmed'}
  ];
  const out=filterSurfaceSplatsForDisplay(rows,{mode:'candidate'});
  assert.deepEqual(out.splats.map(x=>x.id).sort(),['hi']);
  assert.equal(out.stats.hiddenLowConfidence,3);
  assert.equal(rows.length,4); // evidence array is not pruned
});

test('TSDF input is stricter than diagnostic storage',()=>{
  const rows=[
    {id:'low',confidence:.12,support:4,finalPoseValidated:true,evidenceClass:'confirmed'},
    {id:'unverified',confidence:.75,support:1,evidenceClass:'confirmed'},
    {id:'good',confidence:.42,support:3,finalPoseValidated:true,evidenceClass:'confirmed'}
  ];
  const out=filterSurfaceSplatsForMeshing(rows,{minConfidence:.24});
  assert.deepEqual(out.splats.map(x=>x.id),['good']);
  assert.equal(out.stats.hiddenLowConfidence,1);
  assert.equal(out.stats.hiddenUnverified,1);
});

test('legacy-only MVS can never authorize committed geometry',()=>{
  const p=evaluateFinalGeometryPolicy({
    meshQuality:{componentCount:4,largestComponentFraction:.72,fragmentationScore:.28,faceCount:5000,bbox:{diagonal:10},status:'coherent'},
    gaussianCount:1200,frames,sparseDepthEnvelope:{q90:8},
    mvsValidation:{poseBoundFactors:118,legacyPoseBoundFactors:118,committed:8000},
    depthGeometryPolicy:{commitAllowed:false}
  });
  assert.equal(p.commitReady,false);
  assert.equal(p.reason,'legacy-mvs-not-authoritative');
  assert.equal(p.authoritativeMvsFactors,0);
});

test('the uploaded 181-component topology is rejected even with pose-bound evidence',()=>{
  const p=evaluateFinalGeometryPolicy({
    meshQuality:{componentCount:181,largestComponentFraction:.3730746619635509,fragmentationScore:.6269253380364491,faceCount:27096,bbox:{diagonal:26.1559},status:'partial'},
    gaussianCount:1207,frames,sparseDepthEnvelope:{q90:21.23},
    mvsValidation:{poseBoundFactors:80,legacyPoseBoundFactors:0,committed:8498},
    depthGeometryPolicy:{commitAllowed:false}
  });
  assert.equal(p.commitReady,false);
  assert.equal(p.catastrophicFragmentation,true);
  assert.equal(p.reason,'mesh-catastrophically-fragmented');
});

test('coherent new pose-bound MVS may still commit',()=>{
  const p=evaluateFinalGeometryPolicy({
    meshQuality:{componentCount:7,largestComponentFraction:.68,fragmentationScore:.32,faceCount:12000,bbox:{diagonal:11},status:'coherent'},
    gaussianCount:1800,frames,sparseDepthEnvelope:{q90:10},
    mvsValidation:{poseBoundFactors:40,legacyPoseBoundFactors:0,committed:9000},
    depthGeometryPolicy:{commitAllowed:false}
  });
  assert.equal(p.commitReady,true);
  assert.equal(p.reason,'ok');
});

test('REVIEW filters splats and suppresses incoherent candidate mesh rendering',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  const submap=fs.readFileSync(new URL('../js/reconstruction/submap_fusion.js',import.meta.url),'utf8');
  assert.match(app,/surfaceGaussiansForDisplay/);
  assert.match(app,/surface-display-filter/);
  assert.match(app,/candidateMeshVisible=.*topologyCoherent/);
  assert.match(app,/setMesh\(candidateMeshVisible\?diagnosticMesh:null\)/);
  assert.match(submap,/filterSurfaceSplatsForMeshing/);
  assert.match(submap,/meshingEvidence/);
});
