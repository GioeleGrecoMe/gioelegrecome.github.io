import test from 'node:test';
import assert from 'node:assert/strict';
import {detectPhotoFeatures,matchPhotoFeatures,buildPhotoRegistrationEdge,solvePhotoMosaic,buildLocalMosaicWarp,photoPixelToMosaic,canvasPointToPhotoPixel,computeMosaicBounds} from '../js/reconstruction/photo_panorama.js';
import {solvePhotoDepthConsensus,sampleConsensusDepth} from '../js/reconstruction/photo_depth_consensus.js';

const DEG=Math.PI/180;
const K={fx:260,fy:260,cx:160,cy:120,width:320,height:240};
const mul=(M,v)=>[M[0]*v[0]+M[1]*v[1]+M[2]*v[2],M[3]*v[0]+M[4]*v[1]+M[5]*v[2],M[6]*v[0]+M[7]*v[1]+M[8]*v[2]];
const tr=M=>[M[0],M[3],M[6],M[1],M[4],M[7],M[2],M[5],M[8]];
const ray=(u,v,k=K)=>{const r=[(u-k.cx)/k.fx,(v-k.cy)/k.fy,1],n=Math.hypot(...r);return r.map(x=>x/n);};
const rotY=a=>{const c=Math.cos(a),s=Math.sin(a);return [c,0,s,0,1,0,-s,0,c];};
const rotZ=a=>{const c=Math.cos(a),s=Math.sin(a);return [c,-s,0,s,c,0,0,0,1];};
const mm=(A,B)=>A.map((x,i)=>x*B[i]).reduce((a,b)=>a+b,0);
function sphericalPair(angleDeg=12,{outliers=0}={}){
  const R=rotY(angleDeg*DEG),Rt=tr(R),A={frameId:'A',width:320,height:240,K:{...K},features:[],pose:{p:[999,0,0],q:[.4,.2,.7,.1]}},B={frameId:'B',width:320,height:240,K:{...K},features:[],pose:null},matches=[];let i=0;
  for(let va=28;va<220;va+=24)for(let ua=28;ua<300;ua+=28){const ra=ray(ua,va),rb=mul(Rt,ra);if(rb[2]<=0)continue;const ub=K.fx*rb[0]/rb[2]+K.cx,vb=K.fy*rb[1]/rb[2]+K.cy;if(ub<8||ub>312||vb<8||vb>232)continue;A.features.push({x:ua,y:va,score:500,source:'photo-fast'});B.features.push({x:ub,y:vb,score:500,source:'photo-fast'});matches.push({i,j:i,probability:.97,photometricProbability:.98,uniquenessProbability:.96});i++;}
  for(let k=0;k<outliers;k++){const ia=A.features.length,ib=B.features.length;A.features.push({x:20+(k*37)%280,y:20+(k*43)%200,score:450,source:'photo-fast'});B.features.push({x:25+(k*83)%270,y:25+(k*71)%190,score:450,source:'photo-fast'});matches.push({i:ia,j:ib,probability:.42,photometricProbability:.4,uniquenessProbability:.35});}
  return {A,B,matches,R};
}

test('spherical registration is determined only by RGB correspondences, not absurd Alva poses',()=>{
  const {A,B,matches,R}=sphericalPair(12,{outliers:14}),e1=buildPhotoRegistrationEdge(A,B,matches,{minMatches:7,angularThresholdDeg:2.6});assert.ok(e1);assert.ok(e1.rotationInliers>35,e1.rotationInliers);assert.ok(e1.rotationMedianErrorDeg<.15,e1.rotationMedianErrorDeg);
  A.pose={p:[-100,30,50],q:[.6,.2,.4,.65]};B.pose={p:[1000,-300,70],q:[.1,.8,.2,.3]};const e2=buildPhotoRegistrationEdge(A,B,matches,{minMatches:7,angularThresholdDeg:2.6});assert.ok(e2);for(let i=0;i<9;i++)assert.ok(Math.abs(e2.rotationBToA[i]-e1.rotationBToA[i])<1e-10);for(let i=0;i<9;i++)assert.ok(Math.abs(e1.rotationBToA[i]-R[i])<2e-3);
});

test('global panorama rotation averaging puts corresponding rays on the same sphere',()=>{
  const {A,B,matches}=sphericalPair(17,{outliers:8});A.pose=null;B.pose=null;const reg=buildPhotoRegistrationEdge(A,B,matches,{minMatches:7,angularThresholdDeg:2.8}),edge={a:0,b:1,...reg},sol=solvePhotoMosaic([A,B],[edge],{iterations:8,rootIndex:0});assert.ok(sol.transforms[0]);assert.ok(sol.transforms[1]);assert.equal(sol.projection,'spherical');assert.ok(sol.medianResidualDeg<.2,sol.medianResidualDeg);
  for(const m of edge.matches.slice(0,20)){const p=photoPixelToMosaic(A,sol.transforms[0],m.aU,m.aV),q=photoPixelToMosaic(B,sol.transforms[1],m.bU,m.bV),dx=Math.atan2(Math.sin(p.x-q.x),Math.cos(p.x-q.x));assert.ok(Math.hypot(dx,p.y-q.y)<.006);}
});

test('spherical warp is rigid and invertible instead of projectively stretching a photo',()=>{
  const {A,B,matches}=sphericalPair(28),reg=buildPhotoRegistrationEdge(A,B,matches,{minMatches:7,angularThresholdDeg:2.8}),sol=solvePhotoMosaic([A,B],[{a:0,b:1,...reg}],{rootIndex:0}),R=sol.transforms[1];
  const c0=[R[0],R[3],R[6]],c1=[R[1],R[4],R[7]],c2=[R[2],R[5],R[8]];assert.ok(Math.abs(mm(c0,c0)-1)<1e-6);assert.ok(Math.abs(mm(c1,c1)-1)<1e-6);assert.ok(Math.abs(mm(c2,c2)-1)<1e-6);assert.ok(Math.abs(mm(c0,c1))<1e-6);
  const bounds=computeMosaicBounds([A,B],sol.transforms),u=170,v=100,p=photoPixelToMosaic(B,R,u,v);const bw=640,bh=320,spanX=bounds.maxX-bounds.minX,spanY=bounds.maxY-bounds.minY,scale=Math.min(bw/spanX,bh/spanY),ux=(p.x<bounds.yawStart?((p.x%(2*Math.PI)+2*Math.PI)%(2*Math.PI))+2*Math.PI:((p.x%(2*Math.PI)+2*Math.PI)%(2*Math.PI))),x=ux*scale+(bw-spanX*scale)/2-bounds.minX*scale,y=p.y*scale+(bh-spanY*scale)/2-bounds.minY*scale,back=canvasPointToPhotoPixel(B,R,x,y,bw,bh,bounds);assert.ok(back);assert.ok(Math.hypot(back.u-u,back.v-v)<.8,{back});
});

test('photo detector extracts its own features from RGB frame data without tracking input',()=>{
  const w=128,h=96,g=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)g[y*w+x]=(((x>>3)+(y>>3))&1)?235:15;const f=detectPhotoFeatures(g,w,h,{maxFeatures:180,threshold:10});assert.ok(f.length>20,f.length);assert.ok(f.every(x=>x.source==='photo-fast'));
});

test('oriented photo descriptors retain enough RGB matches under in-plane camera rotation',()=>{
  const w=200,h=150,g=new Uint8Array(w*h);let seed=1;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};for(let y=0;y<h;y++)for(let x=0;x<w;x++)g[y*w+x]=(rnd()*.35+(((x>>4)*37+(y>>4)*59)%190)*.65)|0;for(let k=0;k<25;k++){const x0=10+(k*31)%170,y0=10+(k*47)%120;for(let y=y0;y<Math.min(h-5,y0+8);y++)for(let x=x0;x<Math.min(w-5,x0+12);x++)g[y*w+x]=(k&1)?235:20;}
  const a=12*DEG,ca=Math.cos(a),sa=Math.sin(a),cx=w/2,cy=h/2,b=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=x-cx,dy=y-cy,sx=ca*dx+sa*dy+cx,sy=-sa*dx+ca*dy+cy,ix=Math.round(sx),iy=Math.round(sy);b[y*w+x]=(ix>=0&&iy>=0&&ix<w&&iy<h)?g[iy*w+ix]:0;}const k={fx:220,fy:220,cx:w/2,cy:h/2,width:w,height:h},A={frameId:'rot-a',width:w,height:h,K:k,gray:g,features:detectPhotoFeatures(g,w,h,{maxFeatures:400})},B={frameId:'rot-b',width:w,height:h,K:k,gray:b,features:detectPhotoFeatures(b,w,h,{maxFeatures:400})},matches=matchPhotoFeatures(A,B,{maxFeatures:350,maxMatches:180,maxHamming:80,minProbability:.02,patchRadius:2});assert.ok(matches.length>55,matches.length);
});

test('local projective mesh warp is disabled because panorama geometry is always spherical',()=>{const w=160,h=120,A={width:w,height:h,K:{fx:140,fy:140,cx:80,cy:60}},B={...A},warp=buildLocalMosaicWarp([A,B],[],{});assert.equal(warp.disabled,true);assert.equal(warp.anchorCount,0);});

test('Deep overlap consensus aligns raw monocular maps into one global colour scale',()=>{
  const w=40,h=24,k={fx:60,fy:60,cx:w/2,cy:h/2,width:w,height:h},raw0=new Float32Array(w*h),raw1=new Float32Array(w*h),raw2=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const z=.3+x*.018+y*.011;raw0[y*w+x]=z;raw1[y*w+x]=(z+.21)/1.7;raw2[y*w+x]=(z-.13)/.72;}
  const mk=(id,raw)=>({frameId:id,width:w,height:h,K:k,gray:new Uint8Array(w*h).fill(120),relativeDepth:raw,relativeDepthWidth:w,relativeDepthHeight:h,relativeConfidence:.9,relativeQuality:{suspicious:false,stripe:{suspicious:false}}}),frames=[mk('0',raw0),mk('1',raw1),mk('2',raw2)],matches=[];for(let y=2;y<h-2;y+=3)for(let x=2;x<w-2;x+=4)matches.push({aU:x,aV:y,bU:x,bV:y,probability:.96,photometricProbability:.98});const I=[1,0,0,0,1,0,0,0,1],edges=[{a:0,b:1,matches,rotationBToA:I,visualConfidence:.95},{a:1,b:2,matches,rotationBToA:I,visualConfidence:.94},{a:0,b:2,matches,rotationBToA:I,visualConfidence:.92}],c=solvePhotoDepthConsensus(frames,edges,{minPairs:6,rootIndex:0});assert.equal(c.stats.alignedFrames,3);assert.ok(c.globalRange?.hi>c.globalRange?.lo);for(const [x,y] of [[7,6],[22,11],[33,18]]){const z0=sampleConsensusDepth(frames[0],c.transforms[0],x,y),z1=sampleConsensusDepth(frames[1],c.transforms[1],x,y),z2=sampleConsensusDepth(frames[2],c.transforms[2],x,y);assert.ok(Math.max(z0,z1,z2)-Math.min(z0,z1,z2)<2e-3,{z0,z1,z2});}
});

test('a requested panorama root never jumps to a larger disconnected photo cluster',()=>{
  const f=i=>({frameId:String(i),width:100,height:80,K:{fx:100,fy:100,cx:50,cy:40},features:[]}),frames=[f(0),f(1),f(2)],I=[1,0,0,0,1,0,0,0,1],edge={a:1,b:2,matches:[],rotationBToA:I,visualConfidence:.95,weight:.95};const anchored=solvePhotoMosaic(frames,[edge],{rootIndex:0,iterations:1});assert.deepEqual(anchored.component,[0]);assert.ok(anchored.transforms[0]);assert.equal(anchored.transforms[1],null);assert.equal(anchored.transforms[2],null);const automatic=solvePhotoMosaic(frames,[edge],{iterations:1});assert.equal(automatic.component.length,2);
});
