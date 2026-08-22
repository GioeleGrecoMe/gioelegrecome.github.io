import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalizePhotoEdgeMatches,estimatePhotoTranslationDirection,translationLineAngle} from '../js/probabilistic/rgb_translation_direction.js';
import {evaluatePoseScaffoldPolicy} from '../js/probabilistic/pose_scaffold_policy.js';

const K={fx:240,fy:240,cx:160,cy:120,width:320,height:240};
const DEG=Math.PI/180;
const th=12*DEG,c=Math.cos(th),s=Math.sin(th);
const R=[c,0,s,0,1,0,-s,0,c];
const Rt=[c,0,-s,0,1,0,s,0,c];
const mv=(M,v)=>[M[0]*v[0]+M[1]*v[1]+M[2]*v[2],M[3]*v[0]+M[4]*v[1]+M[5]*v[2],M[6]*v[0]+M[7]*v[1]+M[8]*v[2]];
function matches(){const out=[];for(let i=0;i<50;i++){const P=[-.8+(i%10)*.17,-.48+Math.floor(i/10)*.22,1.8+(i%9)*.18],B=mv(Rt,[P[0]-.22,P[1],P[2]]);out.push({aU:K.fx*P[0]/P[2]+K.cx,aV:K.fy*P[1]/P[2]+K.cy,bU:K.fx*B[0]/B[2]+K.cx,bV:K.fy*B[1]/B[2]+K.cy,probability:.96,photometricProbability:.96});}return out;}
const swap=m=>({...m,aU:m.bU,aV:m.bV,bU:m.aU,bV:m.aV});

test('legacy photo edge repairs match A/B without transposing rotationBToA',()=>{
  const raw={aId:'a',bId:'b',rotationBToA:R.slice(),matches:matches().map(swap)};
  const fixed=canonicalizePhotoEdgeMatches(raw,{K},{K});
  assert.equal(fixed.changed,true,fixed);
  assert.equal(fixed.convention,'swapped-input');
  assert.deepEqual(fixed.edge.rotationBToA,R);
  assert.equal(fixed.edge.matchConvention,'canonical-a-b');
  const d=estimatePhotoTranslationDirection(fixed.edge,{K},{K},{minConfidence:.01});
  assert.ok(d,d);assert.ok(d.inlierFraction>.9,d);assert.ok(d.medianEpipolarResidualRad<.15*DEG,d);assert.ok(translationLineAngle(d.direction,[1,0,0])<.04,d);
});

test('strong direct epipolar backbone can authorize the pose scaffold despite weak legacy whole-edge switches',()=>{
  const p=evaluatePoseScaffoldPolicy({frameCount:121,edgeStats:{edges:112,active:1,weak:105,rejected:6,translationDirectionEdges:72,meanTranslationDirectionResidualDeg:20.06,translationDirectionMeanInlierFraction:.884,meanEpipolarPlaneResidualDeg:2.09},photoAudit:{inputEdges:139,unresolvedEdges:27,importFraction:112/139}});
  assert.equal(p.directLineBackbone,true,p);assert.equal(p.observed,true,p);assert.equal(p.mvsSurfaceAllowed,true,p);
});

test('final reconcile can preserve an observed direct RGB scaffold instead of reverting to weak baseline',()=>{
  const src=fs.readFileSync(new URL('../js/probabilistic/single_optimizer_runtime.js',import.meta.url),'utf8');
  assert.match(src,/directScaffoldOverride/);assert.match(src,/direct-rgb-scaffold-override/);assert.match(src,/newScaffold\.observed&&newScaffold\.directLineBackbone/);
});

test('rejected dense geometry is visible diagnostically but remains non-exportable',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  assert.match(app,/diagnostic-candidate-surface-visible/);assert.match(app,/CANDIDATO NON COMMITTED/);assert.match(app,/state\.denseCandidateGaussians=diagnosticCandidate/);assert.match(app,/state\.gaussians=\[\];state\.mesh=null/);assert.match(app,/export disabilitato/);
});
