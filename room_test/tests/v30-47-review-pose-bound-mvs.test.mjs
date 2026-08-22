import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';
import {filterMvsSourcesByEstimatePose} from '../js/probabilistic/final_mvs_revalidation.js';

const q=[0,0,0,1];
const pose=(x,y=0,z=0)=>({p:[x,y,z],q:[...q]});
const frame=(id,p0,p1=p0)=>({frameId:id,posePrior:p0,poseEstimate:p1});

test('new MVS factor persists explicit reference/source pose binding',()=>{
  const g=new ProbabilisticFactorGraph();
  const K={fx:100,fy:100,cx:50,cy:50,width:100,height:100},gray=new Uint8Array(10000).fill(120);
  g.addFrame({frameId:'a',pose:pose(0),K,width:100,height:100,gray});
  g.addFrame({frameId:'b',pose:pose(1),K,width:100,height:100,gray});
  g.addMvs('a',[{p:[0,0,2],u:50,v:50,depth:2,sigmaDepth:.1}],{sourceFrames:['b'],estimatedPose:pose(.2),sourceEstimatePoses:{b:pose(1.2)},evidenceBuild:'v30.47-test',stage:'postscan-final-pose'});
  const f=g.mvsFactors[0];
  assert.equal(f.poseBound,true);assert.equal(f.estimatedUnder,'explicit-payload-pose');
  assert.deepEqual(f.referencePoseAtEstimate.p,[.2,0,0]);
  assert.deepEqual(f.sourcePosesAtEstimate[0].pose.p,[1.2,0,0]);
  assert.equal(f.stage,'postscan-final-pose');
});

test('pose-bound MVS survives a global gauge shift because relative geometry is unchanged',()=>{
  const factor={referencePoseAtEstimate:pose(0),sourcePosesAtEstimate:[{frameId:'b',pose:pose(1)}],estimatedUnder:'explicit-payload-pose'};
  const ref=frame('a',pose(0),pose(10,3,-2)),src=frame('b',pose(1),pose(11,3,-2));
  const r=filterMvsSourcesByEstimatePose(factor,ref,[src]);
  assert.equal(r.reason,'ok');assert.equal(r.usableSources.length,1);assert.ok(r.drifts[0].translation<1e-9);
});

test('pose-bound MVS rejects a source whose relative camera geometry changed materially',()=>{
  const factor={referencePoseAtEstimate:pose(0),sourcePosesAtEstimate:[{frameId:'b',pose:pose(1)}],estimatedUnder:'explicit-payload-pose'};
  const ref=frame('a',pose(0),pose(0)),src=frame('b',pose(1),pose(2));
  const r=filterMvsSourcesByEstimatePose(factor,ref,[src]);
  assert.equal(r.reason,'mvs-relative-pose-drift-high');assert.equal(r.usableSources.length,0);assert.equal(r.rejectedSources[0],'b');assert.ok(r.drifts[0].translation>.9);
});

test('legacy posePrior MVS is explicitly revalidated instead of silently laundered',()=>{
  const factor={estimatedUnder:'posePrior',sourceFrames:['b']};
  const ref=frame('a',pose(0),pose(0)),src=frame('b',pose(1),pose(1.9));
  const r=filterMvsSourcesByEstimatePose(factor,ref,[src]);
  assert.equal(r.legacy,true);assert.equal(r.bound,true);assert.equal(r.reason,'mvs-relative-pose-drift-high');
});

test('REVIEW uses effective optimizer iterations, preserves provenance and hard-gates exports',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  assert.match(app,/function effectiveOptimizationIterations\(\)/);
  assert.match(app,/Number\(state\.liveOptAccepted\?\.iterations\)/);
  assert.match(app,/evidenceProvenance:provenance/);
  assert.match(app,/pose-bound-dense-revalidation-required/);
  assert.match(app,/ply\.disabled=!committedGeometryAvailable\(\)/);
  assert.match(app,/mesh\.disabled=!committedMeshAvailable\(\)/);
  assert.match(app,/if\(!committedGeometryAvailable\(\)\)throw new Error/);
  assert.match(app,/if\(!state\.geometryCommitted\)throw new Error\('La mesh visibile non è committed/);
});

test('finalizer may ignore only legacy RGB-consensus insufficiency when direct scaffold is observed',()=>{
  const src=fs.readFileSync(new URL('../js/probabilistic/single_optimizer_runtime.js',import.meta.url),'utf8');
  assert.match(src,/blockingHard=hardReasons\.filter\(r=>r!=='rgb-consensus-insufficient-for-commit'\)/);
  assert.match(src,/directScaffoldOverride=!blockingHard\.length&&safeReprojection&&newScaffold\.observed&&newScaffold\.directLineBackbone/);
  assert.doesNotMatch(src,/blockingHard=hardReasons\.filter\(r=>r!=='rgb-consensus-collapsed'/);
});
