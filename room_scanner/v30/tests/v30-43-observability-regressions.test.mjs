import test from 'node:test';
import assert from 'node:assert/strict';
import {revalidateMvsSample} from '../js/probabilistic/final_mvs_revalidation.js';
import {evaluateDepthGeometryPolicy} from '../js/probabilistic/depth_commit_policy.js';
import {evaluateRgbConsensusPolicy} from '../js/probabilistic/rgb_consensus_policy.js';
import {evaluateFinalGeometryPolicy} from '../js/probabilistic/geometry_commit_policy.js';
import {estimatePhotoTranslationDirection} from '../js/probabilistic/rgb_translation_direction.js';

const K={fx:180,fy:180,cx:80,cy:60,width:160,height:120};
const pose=(x=0,y=0,z=0)=>({p:[x,y,z],q:[0,0,0,1]});
function texture(x,y){return 125+52*Math.sin(x*.23)+36*Math.cos(y*.31)+27*Math.sin((x+y)*.13)+17*Math.cos((2*x-y)*.11);}
function photo(shift=0){const gray=new Uint8Array(K.width*K.height);for(let y=0;y<K.height;y++)for(let x=0;x<K.width;x++)gray[y*K.width+x]=Math.max(0,Math.min(255,Math.round(texture(x+shift,y))));return {gray,width:K.width,height:K.height};}
function frame(id,x,p){return {frameId:id,posePrior:pose(x),poseEstimate:pose(x),K,width:K.width,height:K.height,photo:p};}

test('tiny-baseline photometric agreement cannot authorize metric MVS depth',()=>{
  const z=2,baseline=.002,shift=K.fx*baseline/z,ref=frame('r',0,photo(0)),src=frame('s',baseline,photo(shift));
  const r=revalidateMvsSample({u:80,v:60,depth:z,sigmaDepth:.2,probability:.95},ref,[src],{candidateCount:13,minSources:1,maxCost:.45,minDistinctiveness:.002});
  assert.equal(r.accepted,false,r);assert.match(r.reason,/observability|ambiguous/,r.reason);assert.ok((r.maxParallaxRad||0)<Math.PI/180,r);
});

test('baseline ranking does not let several near-duplicate frames hide observable sources',()=>{
  const z=2,ref=frame('r',0,photo(0)),near=[.001,.002,.003,.004].map((b,i)=>frame('n'+i,b,photo(K.fx*b/z))),b1=.18,b2=.24,s1=frame('far1',b1,photo(K.fx*b1/z)),s2=frame('far2',b2,photo(K.fx*b2/z));
  const r=revalidateMvsSample({u:80,v:60,depth:2.01,sigmaDepth:.12,probability:.95},ref,[...near,s1,s2],{maxSources:2,minSources:1,candidateCount:17,maxCost:.45,minDistinctiveness:.002,maxCorrectionRel:.25});
  assert.equal(r.accepted,true,r);assert.ok(r.verifiedSourceIds.includes('far1')&&r.verifiedSourceIds.includes('far2'),r);assert.ok(r.maxParallaxRad>3*Math.PI/180,r);
});

test('real V30.42 Deep calibration is rejected globally',()=>{
  const calibration={stats:{medianRelativeResidual:.5534849275352811,p90RelativeResidual:3.6824428925047785,informativeFrames:42,informativeAnchors:2288,globalNonlinearityReady:true},frames:Array.from({length:52},(_,i)=>({frameId:String(i),confidence:.045}))};
  const p=evaluateDepthGeometryPolicy(calibration,{meanDepthConfidence:.0446251006571388});assert.equal(p.commitAllowed,false,p);assert.equal(p.reason,'depth-calibration-residual-high');
});

test('well observed Deep calibration remains eligible',()=>{
  const calibration={stats:{medianRelativeResidual:.14,p90RelativeResidual:.55,informativeFrames:12,informativeAnchors:540,globalNonlinearityReady:true},frames:Array.from({length:12},(_,i)=>({frameId:String(i),confidence:.34}))};
  const p=evaluateDepthGeometryPolicy(calibration,{meanDepthConfidence:.31});assert.equal(p.commitAllowed,true,p);
});

test('real V30.42 4/42 RGB backbone is insufficient for dense commit',()=>{
  const p=evaluateRgbConsensusPolicy({edges:42,active:4,weak:31,rejected:7,mean:.30444310540540026});assert.equal(p.collapsed,false,p);assert.equal(p.commitReady,false,p);assert.ok(p.requiredActive>=8,p);
});

test('real V30.42 scattered 44-island geometry is withheld',()=>{
  const meshQuality={faceCount:4045,componentCount:44,largestComponentFraction:.03261267863686332,fragmentationScore:.9673873213631367,bbox:{diagonal:31.506630889975142}};
  const frames=Array.from({length:20},(_,i)=>({poseEstimate:pose(i*.05)}));
  const p=evaluateFinalGeometryPolicy({meshQuality,gaussianCount:1211,frames,sparseDepthEnvelope:{q90:3.2}});assert.equal(p.commitReady,false,p);assert.match(p.reason,/fragmented|scale/,p.reason);
});

test('RGB epipolar matches recover translation direction but not magnitude',()=>{
  const A={frameId:'a',poseEstimate:pose(0),K},B={frameId:'b',poseEstimate:pose(.22),K},matches=[];
  for(let i=0;i<30;i++){const x=-.7+(i%10)*.15,y=-.35+Math.floor(i/10)*.32,z=1.6+(i%7)*.23;matches.push({aU:K.fx*x/z+K.cx,aV:K.fy*y/z+K.cy,bU:K.fx*(x-.22)/z+K.cx,bV:K.fy*y/z+K.cy,probability:.95});}
  const e={rotationBToA:[1,0,0,0,1,0,0,0,1],matches},r=estimatePhotoTranslationDirection(e,A,B,{minConfidence:.02});assert.ok(r,r);assert.ok(r.direction[0]>.95,r);assert.ok(Math.abs(r.direction[1])<.15&&Math.abs(r.direction[2])<.15,r);assert.equal('magnitude' in r,false,r);
});
