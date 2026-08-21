import test from 'node:test';
import assert from 'node:assert/strict';
import {detectPhotoFeatures,matchPhotoFeatures,buildPhotoRegistrationEdge,solvePhotoMosaic,buildLocalMosaicWarp,photoPixelToMosaic} from '../js/reconstruction/photo_panorama.js';
import {solvePhotoDepthConsensus,sampleConsensusDepth} from '../js/reconstruction/photo_depth_consensus.js';

const apply=(H,x,y)=>{const z=H[6]*x+H[7]*y+H[8];return [(H[0]*x+H[1]*y+H[2])/z,(H[3]*x+H[4]*y+H[5])/z];};
function photographicPair(){
  const w=320,h=240,H=[1.015,.018,.115,-.012,1.008,.035,.008,-.004,1],A={frameId:'A',width:w,height:h,features:[],pose:{p:[0,0,0],q:[0,0,0,1]}},B={frameId:'B',width:w,height:h,features:[],pose:{p:[25,-11,7],q:[0,.707,0,.707]}},matches=[];
  let i=0;for(let yy=.16;yy<=.82;yy+=.11)for(let xx=.12;xx<=.73;xx+=.105){const [u,v]=apply(H,xx,yy);if(u<.03||u>.97||v<.03||v>.97)continue;A.features.push({x:xx*w,y:yy*h,score:500,source:'photo-fast'});B.features.push({x:u*w,y:v*h,score:500,source:'photo-fast'});matches.push({i,j:i,probability:.97,photometricProbability:.98,uniquenessProbability:.96});i++;}
  return {A,B,matches,H};
}

test('photo registration is determined only by image correspondences, even with absurd Alva poses',()=>{
  const {A,B,matches}=photographicPair(),e1=buildPhotoRegistrationEdge(A,B,matches,{minMatches:7,reprojectionPx:2});assert.ok(e1);assert.ok(e1.homographyInliers>20,e1.homographyInliers);
  A.pose={p:[-100,30,50],q:[.6,.2,.4,.65]};B.pose=null;
  const e2=buildPhotoRegistrationEdge(A,B,matches,{minMatches:7,reprojectionPx:2});assert.deepEqual(e2.homography.map(x=>+x.toFixed(8)),e1.homography.map(x=>+x.toFixed(8)));assert.equal(e2.homographyInliers,e1.homographyInliers);
});

test('global mosaic puts corresponding photo pixels at the same 2-D coordinate without camera poses',()=>{
  const {A,B,matches}=photographicPair();A.pose=null;B.pose=null;const edge={a:0,b:1,...buildPhotoRegistrationEdge(A,B,matches,{minMatches:7,reprojectionPx:2})};const sol=solvePhotoMosaic([A,B],[edge],{iterations:4});
  assert.deepEqual(sol.transforms[0],[1,0,0,0,1,0,0,0,1]);assert.ok(sol.transforms[1]);assert.ok(sol.medianResidual<1e-4,sol.medianResidual);
  for(const m of edge.matches.slice(0,8)){const pa=photoPixelToMosaic(A,sol.transforms[0],m.aU,m.aV),pb=photoPixelToMosaic(B,sol.transforms[1],m.bU,m.bV);assert.ok(Math.hypot(pa.x-pb.x,pa.y-pb.y)<3e-4);}
});

test('photo detector extracts its own features from RGB frame data without tracking input',()=>{
  const w=128,h=96,g=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)g[y*w+x]=(((x>>3)+(y>>3))&1)?235:15;const f=detectPhotoFeatures(g,w,h,{maxFeatures:180,threshold:10});assert.ok(f.length>20,f.length);assert.ok(f.every(x=>x.source==='photo-fast'));
});

test('oriented photo descriptors keep registration stable under in-plane camera rotation',()=>{
  const w=200,h=150,g=new Uint8Array(w*h);let seed=1;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};for(let y=0;y<h;y++)for(let x=0;x<w;x++)g[y*w+x]=(rnd()*.35+(((x>>4)*37+(y>>4)*59)%190)*.65)|0;for(let k=0;k<25;k++){const x0=10+(k*31)%170,y0=10+(k*47)%120;for(let y=y0;y<Math.min(h-5,y0+8);y++)for(let x=x0;x<Math.min(w-5,x0+12);x++)g[y*w+x]=(k&1)?235:20;}
  const a=12*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a),cx=w/2,cy=h/2,b=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=x-cx,dy=y-cy,sx=ca*dx+sa*dy+cx,sy=-sa*dx+ca*dy+cy,ix=Math.round(sx),iy=Math.round(sy);b[y*w+x]=(ix>=0&&iy>=0&&ix<w&&iy<h)?g[iy*w+ix]:0;}
  const A={frameId:'rot-a',width:w,height:h,gray:g,features:detectPhotoFeatures(g,w,h,{maxFeatures:400})},B={frameId:'rot-b',width:w,height:h,gray:b,features:detectPhotoFeatures(b,w,h,{maxFeatures:400})},matches=matchPhotoFeatures(A,B,{maxFeatures:350,maxMatches:180,maxHamming:80,minProbability:.02,patchRadius:2}),edge=buildPhotoRegistrationEdge(A,B,matches,{minMatches:7,reprojectionPx:5});assert.ok(matches.length>60,matches.length);assert.ok(edge?.homographyInliers>25,edge?.homographyInliers);assert.ok(edge.homographyMedianErrorPx<1,edge.homographyMedianErrorPx);
});

test('local photo warp reduces residual parallax using image matches only',()=>{
  const w=160,h=120,A={width:w,height:h,pose:{p:[0,0,0],q:[0,0,0,1]}},B={width:w,height:h,pose:{p:[999,999,999],q:[.3,.4,.2,.8]}},matches=[];for(let y=24;y<=96;y+=18)for(let x=28;x<=126;x+=18)matches.push({aU:x,aV:y,bU:x+10+(y-60)*.025,bV:y+3+(x-80)*.012,probability:.95,photometricProbability:.98});
  const solution={transforms:[[1,0,0,0,1,0,0,0,1],[1,0,0,0,1,0,0,0,1]],confidence:Float32Array.from([1,.9]),rootIndex:0};const edges=[{a:0,b:1,matches,visualConfidence:.95}],warp=buildLocalMosaicWarp([A,B],edges,solution,{cols:9,rows:7});const m=matches[Math.floor(matches.length/2)],pa=photoPixelToMosaic(A,solution.transforms[0],m.aU,m.aV),before=photoPixelToMosaic(B,solution.transforms[1],m.bU,m.bV),after=photoPixelToMosaic(B,solution.transforms[1],m.bU,m.bV,warp,1),e0=Math.hypot(pa.x-before.x,pa.y-before.y),e1=Math.hypot(pa.x-after.x,pa.y-after.y);assert.ok(warp.anchorCount>=matches.length);assert.ok(e1<e0*.65,`${e0} -> ${e1}`);
});

test('Deep overlap consensus aligns raw monocular maps statistically after the RGB mosaic',()=>{
  const w=20,h=12,rawB=new Float32Array(w*h),rawA=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=.3+x*.04+y*.015;rawB[y*w+x]=v;rawA[y*w+x]=1.8*v-.27;}
  const mk=(id,raw)=>({frameId:id,width:w,height:h,relativeDepth:raw,relativeDepthWidth:w,relativeDepthHeight:h,relativeConfidence:.9,relativeQuality:{suspicious:false,stripe:{suspicious:false}}}),A=mk('A',rawA),B=mk('B',rawB),matches=[];for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2)matches.push({aU:x,aV:y,bU:x,bV:y,probability:.95});const c=solvePhotoDepthConsensus([A,B],[{a:0,b:1,matches,visualConfidence:.95}],{minPairs:6});assert.equal(c.stats.alignedFrames,2);const za=sampleConsensusDepth(A,c.transforms[0],10,6),zb=sampleConsensusDepth(B,c.transforms[1],10,6);assert.ok(Math.abs(za-zb)<1e-4,{za,zb});
});

test('a requested mosaic root never jumps to a larger disconnected photo cluster',()=>{
  const f=i=>({frameId:String(i),width:100,height:80,features:[]}),frames=[f(0),f(1),f(2)],matches=[];
  for(let y=10;y<=70;y+=15)for(let x=10;x<=90;x+=16)matches.push({aU:x,aV:y,bU:x+3,bV:y,probability:.98,photometricProbability:.98,uniquenessProbability:.98});
  const edge={a:1,b:2,matches,homography:[1,0,-.03,0,1,0,0,0,1],visualConfidence:.95,weight:.95};
  const anchored=solvePhotoMosaic(frames,[edge],{rootIndex:0,iterations:1});assert.deepEqual(anchored.component,[0]);assert.ok(anchored.transforms[0]);assert.equal(anchored.transforms[1],null);assert.equal(anchored.transforms[2],null);
  const automatic=solvePhotoMosaic(frames,[edge],{iterations:1});assert.equal(automatic.component.length,2);
});
