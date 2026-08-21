import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPhotoRegistrationEdge,solvePhotoOrientations,buildLocalPanoramaWarp,photoPixelToAtlas} from '../js/reconstruction/photo_panorama.js';
import {solvePhotoDepthConsensus,sampleConsensusDepth} from '../js/reconstruction/photo_depth_consensus.js';
import {pixelRay,qRotate,qConj,qNormalize} from '../js/slam/math.js';

const K={fx:220,fy:220,cx:160,cy:120,width:320,height:240};
const qYaw=a=>[0,Math.sin(a/2),0,Math.cos(a/2)];
const qAngle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a.reduce((s,x,i)=>s+x*b[i],0))));
function visualPair(angle=.2){
  const qA=[0,0,0,1],qB=qYaw(angle),A={frameId:'A',width:320,height:240,K,pose:{p:[0,0,0],q:qA},features:[]},B={frameId:'B',width:320,height:240,K,pose:{p:[4,1,-2],q:qYaw(-1.1)},features:[]},matches=[];
  const project=(q,w)=>{const c=qRotate(qConj(q),w);return [K.fx*c[0]/c[2]+K.cx,K.fy*c[1]/c[2]+K.cy]};let i=0;
  for(let y=-.32;y<=.32;y+=.13)for(let x=-.42;x<=.42;x+=.14){const w=qNormalize([x,y,1]),pa=project(qA,w),pb=project(qB,w);if(pb[0]<5||pb[0]>315||pb[1]<5||pb[1]>235)continue;A.features.push({x:pa[0],y:pa[1]});B.features.push({x:pb[0],y:pb[1]});matches.push({i,j:i,probability:.94,photometricProbability:.97,uniquenessProbability:.96});i++;}
  return {A,B,matches,target:qB};
}

test('photo registration recovers panorama rotation even when the Alva pose is intentionally wrong',()=>{
  const {A,B,matches,target}=visualPair(.2),e=buildPhotoRegistrationEdge(A,B,matches,{minMatches:7,reprojectionPx:3,rotationInlierDeg:1});
  assert.ok(e);assert.ok(e.visualInliers>=20,e.visualInliers);assert.ok(qAngle(e.visualRotation,target)<1e-5,{q:e.visualRotation,target});
});

test('photo rotation graph uses visual edges instead of inheriting a bad Alva orientation',()=>{
  const {A,B,matches,target}=visualPair(.24),e=buildPhotoRegistrationEdge(A,B,matches,{minMatches:7,reprojectionPx:3,rotationInlierDeg:1});
  const sol=solvePhotoOrientations([A,B],[{a:0,b:1,...e}],{iterations:4});assert.ok(sol.confidence[1]>.1);assert.ok(qAngle(sol.orientations[1],target)<1e-5);assert.ok(qAngle(sol.orientations[1],B.pose.q)>.5);
});

test('Deep overlap consensus aligns raw monocular maps statistically without changing metric poses',()=>{
  const w=20,h=12,rawB=new Float32Array(w*h),rawA=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=.3+x*.04+y*.015;rawB[y*w+x]=v;rawA[y*w+x]=1.8*v-.27;}
  const mk=(id,raw)=>({frameId:id,width:w,height:h,relativeDepth:raw,relativeDepthWidth:w,relativeDepthHeight:h,relativeConfidence:.9,relativeQuality:{suspicious:false,stripe:{suspicious:false}}});const A=mk('A',rawA),B=mk('B',rawB),matches=[];for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2)matches.push({aU:x,aV:y,bU:x,bV:y,probability:.95});
  const c=solvePhotoDepthConsensus([A,B],[{a:0,b:1,matches,visualConfidence:.95}],{minPairs:6});assert.equal(c.stats.alignedFrames,2);assert.equal(c.stats.pairEdges,1);const za=sampleConsensusDepth(A,c.transforms[0],10,6),zb=sampleConsensusDepth(B,c.transforms[1],10,6);assert.ok(Math.abs(za-zb)<1e-4,{za,zb});
});


test('local photo warp absorbs residual parallax without using Alva translation',()=>{
  const K={fx:100,fy:100,cx:80,cy:60,width:160,height:120},q=[0,0,0,1];
  const frames=[{K,width:160,height:120,pose:{p:[0,0,0],q}},{K,width:160,height:120,pose:{p:[9,4,-3],q:[0,.5,0,.8660254]}}];
  const matches=[];for(let y=28;y<=92;y+=16)for(let x=35;x<=115;x+=20)matches.push({aU:x,aV:y,bU:x+12,bV:y+2,probability:.9,photometricProbability:.95});
  const edges=[{a:0,b:1,visualRotation:q,visualConfidence:.9,matches}],solution={orientations:[q,q],confidence:Float32Array.from([1,.9]),rootIndex:0};
  const warp=buildLocalPanoramaWarp(frames,edges,solution,{width:640,height:320});
  const m=matches[Math.floor(matches.length/2)],a=photoPixelToAtlas(frames[0],q,m.aU,m.aV,640,320,warp,0),before=photoPixelToAtlas(frames[1],q,m.bU,m.bV,640,320,null,1),after=photoPixelToAtlas(frames[1],q,m.bU,m.bV,640,320,warp,1),wd=d=>Math.abs(d)>320?640-Math.abs(d):Math.abs(d),errBefore=Math.hypot(wd(a.x-before.x),a.y-before.y),errAfter=Math.hypot(wd(a.x-after.x),a.y-after.y);
  assert.ok(warp.anchorCount>=matches.length);assert.ok(errAfter<errBefore*.55,`expected local RGB warp to reduce ${errBefore} -> ${errAfter}`);
});
