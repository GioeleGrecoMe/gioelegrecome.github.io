import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatePhotoTranslationDirection,translationLineAngle,alignTranslationLine} from '../js/probabilistic/rgb_translation_direction.js';
import {evaluatePoseScaffoldPolicy} from '../js/probabilistic/pose_scaffold_policy.js';
import fs from 'node:fs';

const K={fx:240,fy:240,cx:160,cy:120,width:320,height:240};
const pose=x=>({p:[x,0,0],q:[0,0,0,1]});
function goodMatches(n=40,baseline=.22){const out=[];for(let i=0;i<n;i++){const X=-.8+(i%10)*.17,Y=-.48+Math.floor(i/10)*.27,Z=1.6+(i%9)*.21;out.push({aU:K.fx*X/Z+K.cx,aV:K.fy*Y/Z+K.cy,bU:K.fx*(X-baseline)/Z+K.cx,bV:K.fy*Y/Z+K.cy,probability:.96,photometricProbability:.96});}return out;}

test('monocular translation is an unoriented line: t and -t have zero residual',()=>{
  assert.ok(translationLineAngle([1,0,0],[-1,0,0])<1e-12);
  const a=alignTranslationLine([1,0,0],[-2,0,0]);assert.ok(Math.abs(a[0]+1)<1e-12&&Math.abs(a[1])<1e-12&&Math.abs(a[2])<1e-12,a);
});

test('RGB translation estimator does not choose sign from Alva/current pose',()=>{
  const edge={rotationBToA:[1,0,0,0,1,0,0,0,1],matches:goodMatches()};
  const A={frameId:'a',poseEstimate:pose(0),K},Bwrong={frameId:'b',poseEstimate:pose(-5),K},Bright={frameId:'b',poseEstimate:pose(.22),K};
  const x=estimatePhotoTranslationDirection(edge,A,Bwrong,{minConfidence:.02}),y=estimatePhotoTranslationDirection(edge,A,Bright,{minConfidence:.02});
  assert.ok(x&&y,{x,y});assert.ok(translationLineAngle(x.direction,y.direction)<1e-9,{x,y});assert.ok(translationLineAngle(x.direction,[1,0,0])<.04,x);assert.equal(x.unoriented,true);
});

test('IRLS translation-line estimator survives a minority of gross direct-match outliers',()=>{
  const matches=goodMatches(42);for(let i=0;i<12;i++)matches.push({aU:20+i*17,aV:25+(i%5)*31,bU:285-(i*19)%260,bV:210-(i%6)*27,probability:.95,photometricProbability:.95});
  const r=estimatePhotoTranslationDirection({rotationBToA:[1,0,0,0,1,0,0,0,1],matches},{frameId:'a',poseEstimate:pose(0),K},{frameId:'b',poseEstimate:pose(.22),K},{minConfidence:.015});
  assert.ok(r,r);assert.ok(translationLineAngle(r.direction,[1,0,0])<.08,r);assert.ok(r.inlierFraction>.55,r);assert.ok(r.medianEpipolarResidualRad<2*Math.PI/180,r);
});

test('real V30.43 40-frame pose scaffold cannot authorize dense surface',()=>{
  const p=evaluatePoseScaffoldPolicy({frameCount:40,edgeStats:{edges:8,active:0,weak:2,rejected:6,mean:.1300054,translationDirectionEdges:8,meanTranslationDirectionResidualDeg:63.0964},photoAudit:{inputEdges:15,unresolvedEdges:7,importFraction:.5333333}});
  assert.equal(p.observed,false,p);assert.equal(p.mvsSurfaceAllowed,false,p);assert.ok(p.reasons.includes('rgb-edge-import-low'),p);assert.ok(p.reasons.includes('rgb-translation-line-residual-high'),p);
});

test('well connected low-residual RGB scaffold can authorize dense surface',()=>{
  const p=evaluatePoseScaffoldPolicy({frameCount:40,edgeStats:{edges:12,active:6,weak:5,rejected:1,mean:.66,translationDirectionEdges:10,meanTranslationDirectionResidualDeg:7.5},photoAudit:{inputEdges:13,unresolvedEdges:1,importFraction:12/13}});
  assert.equal(p.observed,true,p);assert.equal(p.mvsSurfaceAllowed,true,p);assert.equal(p.reason,'ok');
});

test('production source contains no Alva sign-orientation of RGB translation line',()=>{
  const src=fs.readFileSync(new URL('../js/probabilistic/rgb_translation_direction.js',import.meta.url),'utf8');
  assert.doesNotMatch(src,/dot\(dir\s*,\s*prior\)/);assert.doesNotMatch(src,/relativeTranslation\(frameA/);
});

test('exact Deep dense keyframes are eligible for the same RGB+Depth photo stream',()=>{
  const src=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  assert.match(src,/deep-keyframe-photo-late-bound/);assert.match(src,/attachLateDepthToPhoto\(denseSurvey,d/);
});


test('dense integration is gated by the global RGB pose scaffold, not local MVS alone',()=>{
  const src=fs.readFileSync(new URL('../js/probabilistic/joint_optimizer.js',import.meta.url),'utf8');
  assert.match(src,/localCommit&&poseScaffoldPolicy\.mvsSurfaceAllowed/);
  assert.match(src,/depthGeometryPolicy\.commitAllowed&&poseScaffoldPolicy\.deepSurfaceAllowed/);
  assert.match(src,/pose-scaffold-not-rgb-observed/);
});
