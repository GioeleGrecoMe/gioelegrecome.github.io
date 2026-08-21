import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LivePhotoPuzzleMap} from '../js/reconstruction/live_photo_puzzle.js';
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
function matchesForBaseline(xb){const out=[];for(const u of [14,20,26,32,38,44,50,56,62,68])for(const v of [17,28,39]){const z=planeDepth(0,u),X=(u-K.cx)/K.fx*z,Y=(v-K.cy)/K.fy*z,ub=K.fx*(X-xb)/z+K.cx,vb=K.fy*Y/z+K.cy;if(ub>4&&ub<K.width-5)out.push({aU:u,aV:v,bU:ub,bV:vb,probability:.96,epipolarPx:.05,zncc:.98,uniquenessProbability:.95});}return out;}
function wireEdge(map,matches){const e={a:0,b:1,aId:'F0',bId:'F1',matches,meanProbability:.96,weight:.92,loop:false,gainAB:1};map.edges=[e];map.adj=new Map([[0,[e]],[1,[e]]]);map.recomputeConnectivity();map.depthScaleDirty=true;}

test('live Deep scale graph aligns exact survey photos through RGB+Alva triangulation',()=>{
  const map=new LivePhotoPuzzleMap({width:160,height:80,photoMaxSide:80,depthMaxSide:80,depthMinPairs:6,depthRegularizeIterations:3,maxFrames:8});
  map.addCameraFrame(frame('F0',0));map.addCameraFrame(frame('F1',.12));wireEdge(map,matchesForBaseline(.12));
  assert.equal(map.updateRelativeDepth('F0',{rawDepth:rawMap(0),width:80,height:60,confidence:.8}),true);
  assert.equal(map.updateRelativeDepth('F1',{rawDepth:rawMap(.12),width:80,height:60,confidence:.8}),true);
  const s=map.stats();
  assert.equal(s.rawDepthFrames,2);assert.equal(s.metricDepthFrames,2);assert.ok(s.depthScalePairs>=12,s.depthScalePairs);assert.ok(s.depthScaleError<.04,s.depthScaleError);
  const z=map.sampleMetricDepth(map.frames[1],40,30),truth=planeDepth(.12,40);assert.ok(Math.abs(z-truth)<.04,{z,truth});
});

test('one Deep frame can be metrically aligned from an RGB-connected neighbour without Deep',()=>{
  const map=new LivePhotoPuzzleMap({width:160,height:80,photoMaxSide:80,depthMaxSide:80,depthMinPairs:6,depthRegularizeIterations:2,maxFrames:8});
  map.addCameraFrame(frame('F0',0));map.addCameraFrame(frame('F1',.12));wireEdge(map,matchesForBaseline(.12));
  map.updateRelativeDepth('F1',{rawDepth:rawMap(.12),width:80,height:60,confidence:.8});
  const s=map.stats();assert.equal(s.rawDepthFrames,1);assert.equal(s.metricDepthFrames,1);assert.ok(s.depthScalePairs>=6,s.depthScalePairs);
});

test('photo atlas keeps a fixed world origin while translated cameras are reprojected in 3-D',()=>{
  const map=new LivePhotoPuzzleMap({photoMaxSide:80,maxFrames:8});map.addCameraFrame(frame('F0',1));const o=map.origin.slice();map.addCameraFrame(frame('F1',2));assert.deepEqual(map.origin,o);assert.deepEqual(o,[1,0,0]);
});

test('sharp atlas uses best-view/z-buffer compositing instead of blur-producing image averaging',()=>{
  const map=new LivePhotoPuzzleMap({width:200,height:100,photoMaxSide:80,depthMaxSide:80,maxFrames:8,maxPhotoSamples:500000});
  map.addCameraFrame(frame('F0',0,'checker'));map.addCameraFrame(frame('F1',0,'flat'));wireEdge(map,matchesForBaseline(.12));
  const z=new Float32Array(80*60);z.fill(2);map.updateDepth('F0',{depth:z,width:80,height:60,confidence:.98});map.updateDepth('F1',{depth:z,width:80,height:60,confidence:.05});
  const a=map.renderPhotoAtlas(),lum=[];for(let i=0;i<a.rgba.length;i+=4)if(a.rgba[i+3]>100)lum.push(a.rgba[i]);
  assert.ok(lum.length>30,lum.length);assert.ok(Math.max(...lum)-Math.min(...lum)>190,{min:Math.min(...lum),max:Math.max(...lum)});
});

test('the Deep clock captures exact RGB+Alva evidence before inference and returns raw depth to that frame only',()=>{
  const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  for(const token of ['function captureLiveSurveyFrame(frame,tracking)','state.probGraph?.addFrame(survey)','state.liveMap.addCameraFrame(survey','state.probGraph.addDeepRaw(binding.frameId','updateRelativeDepth?.(binding.frameId'])assert.ok(app.includes(token),token);
  assert.ok(app.indexOf('captureLiveSurveyFrame(frame,tracking)')<app.indexOf("postMessage({type:'infer'"),'survey packet must be frozen before Deep worker launch');
});

test('coverage sphere does not double-vote when the same physical frame arrives through survey and dense clocks',()=>{
  const c=new ViewSphereCoverage({cols:12,rows:6,maxFrames:8}),f=frame('F0',0);const a=c.addFrame(f),sum1=[...a.cells].reduce((x,y)=>x+y,0),b=c.addFrame(f),sum2=[...b.cells].reduce((x,y)=>x+y,0);assert.equal(c.frames.length,1);assert.equal(sum2,sum1);
});

test('post-scan Photo Puzzle replaces the legacy averaged atlas with the same pose/depth-aware sharp renderer',()=>{
  const worker=fs.readFileSync(new URL('../workers/puzzle_reconstruction_worker.js',import.meta.url),'utf8');
  assert.match(worker,/LivePhotoPuzzleMap/);assert.match(worker,/loadSolvedGraph\(graph,puzzle,depthScale\)/);assert.match(worker,/sharpPoseDepthAtlas:true/);
});
