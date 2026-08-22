import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LivePhotoPuzzleMap,reliablePhotoOverlap} from '../js/reconstruction/live_photo_puzzle.js';
import {ViewSphereCoverage} from '../js/reconstruction/coverage_sphere.js';

const K={fx:120,fy:120,cx:40,cy:30,width:80,height:60};
const pose=x=>({p:[x,0,0],q:[0,0,0,1]});
function frame(id,x,colorMode='gradient'){
  const w=80,h=60,gray=new Uint8Array(w*h),rgba=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let xx=0;xx<w;xx++){
    const i=y*w+xx;let v;
    if(colorMode==='checker')v=((xx>>2)+(y>>2))&1?245:10;
    else if(colorMode==='flat')v=128;
    else v=(xx*3+y*5)%256;
    gray[i]=v;rgba[i*4]=v;rgba[i*4+1]=colorMode==='flat'?128:(255-v);rgba[i*4+2]=colorMode==='flat'?128:((v*3)%256);rgba[i*4+3]=255;
  }
  return {frameId:id,at:Number(id.replace(/\D/g,''))||1,pose:pose(x),poseCov:{translationStd:.002,rotationStdRad:.001},K:{...K},width:w,height:h,gray,rgba,features:[],metricLocked:true};
}
function planeDepth(cameraX,u,z0=2,k=.18){const xn=(u-K.cx)/K.fx;return (z0+k*cameraX)/(1-k*xn);}
function rawMap(cameraX,a=1.7,b=.3){const out=new Float32Array(K.width*K.height);for(let y=0;y<K.height;y++)for(let x=0;x<K.width;x++){const z=planeDepth(cameraX,x+.5);out[y*K.width+x]=(z-b)/a;}return out;}
function commit(map,f,raw=rawMap(0)){const r=map.commitCameraFrameWithRelativeDepth(f,{rawDepth:raw,width:K.width,height:K.height,confidence:.8});assert.equal(r.ok,true,r.reason);return r;}
function matchesForBaseline(xb){const out=[];for(const u of [14,20,26,32,38,44,50,56,62,68])for(const v of [17,28,39]){const z=planeDepth(0,u),X=(u-K.cx)/K.fx*z,Y=(v-K.cy)/K.fy*z,ub=K.fx*(X-xb)/z+K.cx,vb=K.fy*Y/z+K.cy;if(ub>4&&ub<K.width-5)out.push({aU:u,aV:v,bU:ub,bV:vb,probability:.96,epipolarPx:.05,zncc:.98,uniquenessProbability:.95});}return out;}
function wireEdge(map,matches){const e={a:0,b:1,aId:'F0',bId:'F1',matches,rotationBToA:[1,0,0,0,1,0,0,0,1],rotationInliers:matches.length,rotationMedianErrorDeg:.4,rotationP90ErrorDeg:.8,rotationAngleDeg:0,visualConfidence:.92,meanProbability:.96,weight:.92,loop:false,gainAB:1};map.edges=[e];map.adj=new Map([[0,[e]],[1,[e]]]);map.recomputeConnectivity();map.depthScaleDirty=true;map.depthConsensusDirty=true;map.visualDirty=true;map.recomputeVisualSolution();}

test('optional metric Deep scale still uses posed frames after the RGB mosaic is built independently',()=>{
  const map=new LivePhotoPuzzleMap({width:160,height:80,photoMaxSide:80,depthMaxSide:80,depthMinPairs:6,depthRegularizeIterations:3,maxFrames:8});
  commit(map,frame('F0',0),rawMap(0));commit(map,frame('F1',.12),rawMap(.12));wireEdge(map,matchesForBaseline(.12));
  const s=map.stats();
  assert.equal(s.rawDepthFrames,2);assert.equal(s.metricDepthFrames,2);assert.ok(s.depthScalePairs>=12,s.depthScalePairs);assert.ok(s.depthScaleError<.04,s.depthScaleError);
  const z=map.sampleMetricDepth(map.frames[1],40,30),truth=planeDepth(.12,40);assert.ok(Math.abs(z-truth)<.04,{z,truth});
});

test('RGB photos without a valid exact-frame depth map never enter the live mosaic graph',()=>{
  const map=new LivePhotoPuzzleMap({width:160,height:80,photoMaxSide:80,depthMaxSide:80,maxFrames:8}),f=frame('F0',0);
  const bad=map.commitCameraFrameWithRelativeDepth(f,{rawDepth:new Float32Array(80*60).fill(NaN),width:80,height:60});assert.equal(bad.ok,false);assert.equal(bad.reason,'invalid-depth');assert.equal(map.stats().frames,0);assert.equal(map.edges.length,0);
  const staged=map.addCameraFrame(f);assert.equal(staged.frames,1);assert.equal(staged.rawDepthFrames,0);assert.equal(map.edges.length,0);const atlas=map.renderPhotoAtlas();assert.equal(atlas.coverage,0);
});


test('localized feature clusters cannot place a photograph even with a low spherical residual',()=>{
  const a={width:320,height:240},b={width:320,height:240},I=[1,0,0,0,1,0,0,0,1],cluster=[];for(let y=100;y<=120;y+=5)for(let x=140;x<=165;x+=5)cluster.push({aU:x,aV:y,bU:x+4,bV:y+2,probability:.99});
  const reg={matches:cluster,allPhotoMatches:cluster.length,rotationBToA:I,rotationInliers:cluster.length,rotationMedianErrorDeg:.2,rotationP90ErrorDeg:.4,rotationAngleDeg:1,visualConfidence:.95};assert.equal(reliablePhotoOverlap(reg,a,b,{minMatches:6}),false);
  const spread=[];for(const y of [30,80,130,190,220])for(const x of [25,80,145,215,285])spread.push({aU:x,aV:y,bU:x+4,bV:y+2,probability:.99});const good={...reg,matches:spread,allPhotoMatches:spread.length,rotationInliers:spread.length};assert.equal(reliablePhotoOverlap(good,a,b,{minMatches:6}),true);
});

test('metric origin remains separate from the arbitrary 2-D photo mosaic',()=>{
  const map=new LivePhotoPuzzleMap({photoMaxSide:80,maxFrames:8});commit(map,frame('F0',1),rawMap(1));const o=map.origin.slice();commit(map,frame('F1',2),rawMap(2));assert.deepEqual(map.origin,o);assert.deepEqual(o,[1,0,0]);
});

test('sharp photo-first atlas uses best-source compositing instead of blur-producing image averaging',()=>{
  const map=new LivePhotoPuzzleMap({width:200,height:100,photoMaxSide:80,depthMaxSide:80,maxFrames:8,maxPhotoSamples:500000});
  commit(map,frame('F0',0,'checker'),rawMap(0));commit(map,frame('F1',0,'flat'),rawMap(.12));wireEdge(map,matchesForBaseline(.12));
  const z=new Float32Array(80*60);z.fill(2);map.updateDepth('F0',{depth:z,width:80,height:60,confidence:.98});map.updateDepth('F1',{depth:z,width:80,height:60,confidence:.05});
  const a=map.renderPhotoAtlas(),lum=[];for(let i=0;i<a.rgba.length;i+=4)if(a.rgba[i+3]>100)lum.push(a.rgba[i]);
  assert.ok(lum.length>30,lum.length);assert.ok(Math.max(...lum)-Math.min(...lum)>190,{min:Math.min(...lum),max:Math.max(...lum)});
});

test('survey RGB is frozen first and Depth is attached only to the exact archived frame',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  for(const token of ['function captureLiveSurveyFrame(frame,tracking)','function attachLateDepthToPhoto(survey,d','function commitExactRgbDepthPhoto(survey,depthResult','state.deepSync?.validateDeepFrameResult'])assert.ok(app.includes(token),token);
  assert.ok(app.includes('new Uint8ClampedArray(frame.rgba)'),'the Depth job must never read a reused camera buffer');
  assert.ok(app.indexOf('validateDeepFrameResult')<app.indexOf('await applyDeepDepthResult'),'sync validation must precede geometry updates');
  assert.match(app,/CONFIG\.deepPostScanOnly===false/,'live inference must remain explicitly gated while the archive is collected');
});

test('an unposed RGB+Deep photograph is a first-class mosaic node and remains visible',()=>{
  const map=new LivePhotoPuzzleMap({width:180,height:120,photoMaxSide:80,maxFrames:8,maxPhotoSamples:500000}),f=frame('F0',0,'checker');f.pose=null;f.poseCov=null;commit(map,f,rawMap(0));const s=map.stats();assert.equal(s.frames,1);assert.equal(s.rawDepthFrames,1);assert.equal(s.alvaPoseFrames,0);assert.equal(s.visualRegisteredFrames,1);const atlas=map.renderPhotoAtlas();assert.ok(atlas.coverage>.05,atlas.coverage);const saved=map.exportState();assert.equal(saved.frames[0].alvaPose,null);assert.equal(saved.frames[0].hasRawDepth,true);assert.ok(saved.sphericalRotations[0]);assert.equal(saved.projection,'spherical');
});

test('coverage sphere does not double-vote when the same physical frame arrives through survey and dense clocks',()=>{
  const c=new ViewSphereCoverage({cols:12,rows:6,maxFrames:8}),f=frame('F0',0);const a=c.addFrame(f),sum1=[...a.cells].reduce((x,y)=>x+y,0),b=c.addFrame(f),sum2=[...b.cells].reduce((x,y)=>x+y,0);assert.equal(c.frames.length,1);assert.equal(sum2,sum1);
});

test('post-scan Photo Puzzle replaces the legacy averaged atlas with the same photo-first sharp renderer',()=>{
  const worker=fs.readFileSync(new URL('../workers/puzzle_reconstruction_worker.js',import.meta.url),'utf8');
  assert.match(worker,/LivePhotoPuzzleMap/);assert.match(worker,/loadSolvedGraph\(graph,puzzle,depthScale\)/);assert.match(worker,/sharpPoseDepthAtlas:true/);
});

test('live RGB preview is inverse-warped as a continuous photograph, never rendered as point splats',()=>{
  const w=320,h=240,gray=new Uint8Array(w*h),rgba=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,v=(x*5+y*3)&255;gray[i]=v;rgba[i*4]=v;rgba[i*4+1]=255-v;rgba[i*4+2]=(x*7)&255;rgba[i*4+3]=255;}
  const map=new LivePhotoPuzzleMap({width:640,height:320,photoMaxSide:320,maxPhotoSamples:10000,maxFrames:4}),dep=new Float32Array(w*h);dep.fill(1);
  const c=map.commitCameraFrameWithRelativeDepth({frameId:'dense-rgb',at:1,pose:null,K:{fx:300,fy:300,cx:w/2,cy:h/2,width:w,height:h},width:w,height:h,gray,rgba},{rawDepth:dep,width:w,height:h,confidence:.8});assert.equal(c.ok,true);
  const atlas=map.renderPhotoAtlas();let n=0,minX=atlas.width,minY=atlas.height,maxX=-1,maxY=-1;
  for(let y=0;y<atlas.height;y++)for(let x=0;x<atlas.width;x++){if(atlas.rgba[(y*atlas.width+x)*4+3]){n++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}
  const bbox=(maxX-minX+1)*(maxY-minY+1),fill=n/Math.max(1,bbox);assert.ok(fill>.94,{fill,n,bbox});
  const src=fs.readFileSync(new URL('../js/reconstruction/live_photo_puzzle.js',import.meta.url),'utf8');const body=src.slice(src.indexOf('renderPhotoAtlas(){'),src.indexOf('renderDepthAtlas(){'));assert.match(body,/spherical inverse warp/i);assert.match(body,/canvasPointToPhotoPixel/);assert.doesNotMatch(body,/splatPanoramaSharp|homography/);
});

test('dense SLAM keyframes are not injected into the user-visible RGB mosaic',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  assert.ok(!app.includes('state.liveMap.addFrame(graphFrame'), 'metric keyframes must not enter live RGB preview');
  assert.ok(app.includes('commitCameraFrameWithRelativeDepth?.(survey'), 'only Deep-bound survey photographs may enter live RGB preview');
});
