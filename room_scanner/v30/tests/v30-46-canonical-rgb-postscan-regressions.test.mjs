import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalizePhotoEdgeMatches,estimatePhotoTranslationDirection,translationLineAngle} from '../js/probabilistic/rgb_translation_direction.js?v=30.47.0';
import {evaluatePoseScaffoldPolicy} from '../js/probabilistic/pose_scaffold_policy.js?v=30.47.0';

const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const runtime=fs.readFileSync(new URL('../js/probabilistic/single_optimizer_runtime.js',import.meta.url),'utf8');
const config=fs.readFileSync(new URL('../js/config.js',import.meta.url),'utf8');
const yaw=12*Math.PI/180,c=Math.cos(yaw),ss=Math.sin(yaw);
// Camera-to-world rotation of B. Since A is identity, this is also B->A ray rotation.
const R=[c,0,ss,0,1,0,-ss,0,c];
const RT=[c,0,-ss,0,1,0,ss,0,c];
const K={fx:260,fy:260,cx:160,cy:240,width:320,height:480};
const A={K,posePrior:{p:[0,0,0],q:[0,0,0,1]},poseEstimate:{p:[0,0,0],q:[0,0,0,1]}};
const B={K,posePrior:{p:[.25,0,0],q:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)]},poseEstimate:{p:[.25,0,0],q:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)]}};
function mul(M,v){return [M[0]*v[0]+M[1]*v[1]+M[2]*v[2],M[3]*v[0]+M[4]*v[1]+M[5]*v[2],M[6]*v[0]+M[7]*v[1]+M[8]*v[2]];}
function projectA(P){return {u:K.fx*P[0]/P[2]+K.cx,v:K.fy*P[1]/P[2]+K.cy};}
function projectB(P){const d=[P[0]-.25,P[1],P[2]],x=mul(RT,d);return {u:K.fx*x[0]/x[2]+K.cx,v:K.fy*x[1]/x[2]+K.cy};}
function matches(swapped=false){const out=[];for(let i=0;i<40;i++){const P=[-.9+(i%8)*.25,-.5+Math.floor(i/8)*.23,2.5+(i%5)*.34],a=projectA(P),b=projectB(P),m={aU:a.u,aV:a.v,bU:b.u,bV:b.v,probability:.95,photometricProbability:.95};out.push(swapped?{...m,aU:m.bU,aV:m.bV,bU:m.aU,bV:m.aV}:m);}return out;}
test('V30.46 repairs reversed A/B match labels without transposing rotation',()=>{
  const edge={aId:'a',bId:'b',rotationBToA:R,matches:matches(true),visualConfidence:.5};
  const c=canonicalizePhotoEdgeMatches(edge,A,B);assert.equal(c.convention,'swapped-input');assert.deepEqual(c.edge.rotationBToA,R);
  const d=estimatePhotoTranslationDirection(c.edge,A,B);assert.ok(d);assert.ok(translationLineAngle(d.direction,[1,0,0])<3*Math.PI/180);
});

test('already canonical A/B matches remain canonical',()=>{
  const edge={aId:'a',bId:'b',rotationBToA:R,matches:matches(false),visualConfidence:.5};const c=canonicalizePhotoEdgeMatches(edge,A,B);assert.equal(c.convention,'as-stored');assert.equal(c.changed,false);
});

test('high-quality direct RGB line backbone can authorize pose scaffold even with weak whole-edge switches',()=>{
  const good=evaluatePoseScaffoldPolicy({frameCount:121,photoAudit:{inputEdges:139,importFraction:112/139,unresolvedEdges:27},edgeStats:{edges:112,active:0,weak:106,rejected:6,translationDirectionEdges:72,meanTranslationDirectionResidualDeg:22,translationDirectionMeanInlierFraction:.884,meanEpipolarPlaneResidualDeg:2.09}});assert.equal(good.observed,true);assert.equal(good.directLineBackbone,true);
  const bad=evaluatePoseScaffoldPolicy({frameCount:121,photoAudit:{inputEdges:139,importFraction:112/139,unresolvedEdges:27},edgeStats:{edges:112,active:0,weak:106,rejected:6,translationDirectionEdges:72,meanTranslationDirectionResidualDeg:55,translationDirectionMeanInlierFraction:.884,meanEpipolarPlaneResidualDeg:2.09}});assert.equal(bad.observed,false);
});

test('post-scan recovery uses global line relaxation inside the single optimizer',()=>{
  assert.match(runtime,/recoverRgbScaffold/);assert.match(runtime,/rgbScaffoldRecovery/);assert.match(runtime,/preCommitScaffold\.observed/);assert.doesNotMatch(runtime,/new\s+(?!ProbabilisticJointOptimizer)\w*Optimizer/);
});

test('scan path never dispatches plane-sweep MVS',()=>{
  const fn=app.slice(app.indexOf('async function scheduleSparseGeometryWork'),app.indexOf('async function makeDensePayload'));assert.match(fn,/retainPostScanMvsPayload/);assert.doesNotMatch(fn,/postMessage\(payload\)/);assert.match(config,/mvsPostScanOnly:true/);assert.match(config,/sparseFastLaneMinIntervalMs:6500/);
});

test('late Deep planning is distributed by queue occupancy backpressure',()=>{
  assert.match(app,/function lateDeepPlanGate/);assert.match(app,/deepPlanBackpressureGain/);assert.match(config,/deepSurveyQueueBudget:2/);assert.match(config,/deepPlanBackpressureGain:2\.5/);
});

test('post-scan MVS re-triangulates sparse seeds after final pose rebound',()=>{
  assert.match(app,/async function refreshPostScanMvsGeometry/);
  assert.match(app,/mvs-postscan-sparse-refreshed/);
  assert.match(app,/await refreshPostScanMvsGeometry\(payload\)/);
  assert.match(config,/postScanMvsSourcePool:4/);
});

test('capture-time sparse MVS range is not blindly reused after global RGB recovery',()=>{
  const fn=app.slice(app.indexOf('async function refreshPostScanMvsGeometry'),app.indexOf('async function dispatchDensePayload'));
  assert.match(fn,/buildSparseDepthAnchors\(payload\.ref,sources/);
  assert.match(fn,/payload\.near=sparse\.range\.near/);
  assert.match(fn,/else\{payload\.near=CONFIG\.denseNearM/);
});

test('final commit can preserve an observed direct RGB scaffold despite legacy switch weakness',()=>{
  assert.match(runtime,/directScaffoldOverride/);
  assert.match(runtime,/direct-rgb-scaffold-override/);
  assert.match(runtime,/newScaffold\.observed&&newScaffold\.directLineBackbone/);
});

test('withheld geometry remains visible as diagnostic candidate but non-exportable',()=>{
  assert.match(app,/diagnostic-candidate-surface-visible/);
  assert.match(app,/CANDIDATO NON COMMITTED/);
  assert.match(app,/state\.denseCandidateGaussians=diagnosticCandidate/);
  assert.match(app,/state\.gaussians=\[\];state\.mesh=null/);
  assert.match(app,/export disabilitato/);
});
