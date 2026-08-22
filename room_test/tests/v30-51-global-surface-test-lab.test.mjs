import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildGlobalSurfaceConsensus} from '../js/reconstruction/global_surface_consensus.js?v=30.51.0';
import {filterSurfaceSplatsForDisplay} from '../js/reconstruction/surface_display_policy.js?v=30.51.0';
import {retainMeaningfulMeshComponents,analyzeMeshQuality} from '../js/reconstruction/mesh_quality.js?v=30.51.0';
import {evaluateFinalGeometryPolicy} from '../js/probabilistic/geometry_commit_policy.js?v=30.51.0';
import {buildPipelineTestSnapshot} from '../js/reconstruction/pipeline_diagnostics.js?v=30.51.0';

const splat=(id,p,{c=.72,sub='S0',ind=2,support=3,n=[0,0,1]}={})=>({id,position:p,normal:n,color:[180,190,200],confidence:c,support,independentSupport:ind,anchorSupport:1.5,finalPoseValidated:true,evidenceClass:'strong',submapId:sub,scale:[.02,.02,.008],positionCovariance:[1e-4,0,0,1e-4,0,1e-4]});

test('global consensus merges compatible submap hypotheses and rejects isolated weak clutter',()=>{
  const rows=[
    splat('a',[0,0,1],{sub:'S0'}),splat('b',[.012,.004,1.006],{sub:'S1',n:[0,0,-1]}),
    splat('c',[.08,0,1],{sub:'S0'}),splat('d',[.086,.003,1.004],{sub:'S2'}),
    splat('noise',[3,2,7],{c:.12,sub:'S3',ind:0,support:1})
  ];
  const out=buildGlobalSurfaceConsensus(rows,{voxel:.035,minConfidence:.26});
  assert.ok(out.splats.length>=2&&out.splats.length<=3);
  assert.ok(out.splats.every(x=>x.globalConsensusVerified));
  assert.ok(out.stats.rejectedLowConfidence+out.stats.rejectedConfidence+out.stats.rejectedSupport>=1);
  assert.ok(out.splats.some(x=>x.globalConsensusSubmaps>=2));
});

test('unknown and low probability Gaussians are not rendered',()=>{
  const out=filterSurfaceSplatsForDisplay([{id:'unknown',support:5},{id:'low',confidence:.49,support:5,evidenceClass:'strong'},{id:'ok',confidence:.74,support:3,evidenceClass:'strong'}],{mode:'review'});
  assert.deepEqual(out.splats.map(x=>x.id),['ok']);
  assert.equal(out.stats.hiddenUnknownConfidence,1);
  assert.equal(out.stats.hiddenLowConfidence,1);
});

test('mesh cleanup removes tiny islands but reports how much raw geometry was discarded',()=>{
  const verts=[],faces=[],colors=[];const addTri=(x)=>{const b=verts.length/3;verts.push(x,0,0,x+.02,0,0,x,0,.02);colors.push(180,180,180,180,180,180,180,180,180);faces.push(b,b+1,b+2);};
  // dominant connected strip
  for(let i=0;i<40;i++){const b=verts.length/3;verts.push(i*.02,0,0,i*.02,.02,0,(i+1)*.02,0,0,(i+1)*.02,.02,0);colors.push(...Array(12).fill(180));faces.push(b,b+1,b+2,b+1,b+3,b+2);}
  for(let i=0;i<12;i++)addTri(5+i*.1);
  const raw={vertices:new Float32Array(verts),colors:new Uint8Array(colors),faces:new Uint32Array(faces),inputSurfels:100,sourceSurfels:100,meshedSurfelFraction:1};
  const clean=retainMeaningfulMeshComponents(raw,{minVertices:12,minRelativeToLargest:.05,maxComponents:6});
  assert.ok(clean.mesh.faces.length<raw.faces.length);
  assert.ok(clean.stats.discardedVertices>0);
  assert.ok(analyzeMeshQuality(clean.mesh).largestComponentFraction>.9);
});

test('final policy refuses a mesh whose apparent coherence comes from discarding too much raw topology',()=>{
  const p=evaluateFinalGeometryPolicy({meshQuality:{componentCount:3,largestComponentFraction:.72,fragmentationScore:.28,faceCount:8000,bbox:{diagonal:9},status:'coherent'},rawMeshQuality:{componentCount:90,largestComponentFraction:.31,faceCount:12000,bbox:{diagonal:10}},meshCleanup:{discardedVertexFraction:.42},surfaceConsensus:{authoritative:900,occupiedCells:420,medianConfidence:.61},gaussianCount:900,frames:[{poseEstimate:{p:[0,0,0]}},{poseEstimate:{p:[5,0,0]}}],mvsValidation:{poseBoundFactors:30,legacyPoseBoundFactors:0,committed:5000},depthGeometryPolicy:{commitAllowed:false}});
  assert.equal(p.commitReady,false);assert.equal(p.reason,'mesh-fragmented-before-cleanup');
});

test('pipeline TEST identifies the earliest broken stage rather than only reporting mesh failure',()=>{
  const snap=buildPipelineTestSnapshot({build:{version:'30.51.0'},graph:{frames:80,photoEdges:60,photoEdgeImportFraction:.9},optimizer:{candidateStats:{edgeSwitches:{translationDirectionEdges:1,meanEpipolarPlaneResidualDeg:11,translationDirectionMeanInlierFraction:.2}}},photoArchive:{accepted:300},fastLane:{maxGapMs:300},surface:{committed:false,withheldReason:'mesh-severely-fragmented'}});
  assert.equal(snap.firstFailure.name,'Scaffold RGB');
  assert.equal(snap.firstFailure.status,'fail');
});

test('Processing automatically performs final optimizer/rebuild and REVIEW exposes TEST laboratory',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../room_scanner_v30.html',import.meta.url),'utf8');
  const finish=app.slice(app.indexOf('async function finishScan'),app.indexOf('function effectiveOptimizationIterations'));
  assert.match(finish,/startProbabilisticOptimization\(\{automatic:true/);
  assert.ok(finish.indexOf('drainPostScanMvsBacklog')<finish.indexOf('startProbabilisticOptimization({automatic:true'));
  assert.ok(finish.indexOf('startProbabilisticOptimization({automatic:true')<finish.indexOf('showReview()'));
  for(const id of ['pipelineTestPanel','pipelineTestSummary','pipelineTestStages','pipelineTestExportBtn'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/buildPipelineTestSnapshot/);assert.match(app,/pipeline-test-export/);
});
