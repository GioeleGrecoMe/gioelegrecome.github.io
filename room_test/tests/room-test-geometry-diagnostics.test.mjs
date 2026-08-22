import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeometryDiagnostics} from '../js/test/diagnostic_runner.js';
import {projectPoint,pixelRay,qRotate} from '../js/test/diagnostic_math.js';

const K={fx:300,fy:302,cx:160,cy:120,width:320,height:240};
const qYaw=a=>[0,Math.sin(a/2),0,Math.cos(a/2)];
const poses=[{p:[0,0,0],q:qYaw(0)},{p:[.24,.01,.015],q:qYaw(.055)},{p:[.47,-.01,.055],q:qYaw(.105)},{p:[.67,.02,.10],q:qYaw(.15)}];
const plane={c:2.6,a:.18,b:.08};
const zPlane=(x,y)=>plane.c+plane.a*x+plane.b*y;
const landmarks=[];
for(let yi=-3;yi<=3;yi++)for(let xi=-5;xi<=5;xi++){const x=xi*.13,y=yi*.12,z=zPlane(x,y),point=[x,y,z],measurements=[];for(let i=0;i<poses.length;i++){const p=projectPoint(poses[i],K,point);if(p&&p.u>8&&p.u<K.width-8&&p.v>8&&p.v<K.height-8)measurements.push({frameId:`f${i}`,u:p.u,v:p.v,probability:.98});}if(measurements.length>=2)landmarks.push({id:`L${landmarks.length}`,point,covariance:[1e-4,0,0,1e-4,0,1e-4],probability:.98,measurements});}
const frames=poses.map((pose,i)=>({frameId:`f${i}`,id:`kf${i}`,at:i*500,posePrior:pose,poseEstimate:pose,K:{...K},KObserved:{...K},intrinsicsDeviation:{fxRel:0,fyRel:0,cxPx:0,cyPx:0},width:K.width,height:K.height,photo:fakePhoto(i),features:[]}));
const edges=[];for(let i=0;i<poses.length-1;i++){const matches=[];for(const l of landmarks){const a=l.measurements.find(m=>m.frameId===`f${i}`),b=l.measurements.find(m=>m.frameId===`f${i+1}`);if(a&&b)matches.push({aU:a.u,aV:a.v,bU:b.u,bV:b.v,probability:.98,photometricProbability:.98});}edges.push({aId:`f${i}`,bId:`f${i+1}`,matches,visualConfidence:.98});}
const deepFactors=frames.map(f=>makeDeep(f));
const graph={format:'ROOMSCAN-PROB-GRAPH-1',version:8,cameraModel:{fxNorm:K.fx/K.width,fyNorm:K.fy/K.height,cxNorm:.5,cyNorm:.5,referenceWidth:K.width,referenceHeight:K.height,locked:true},photoEdgeAudit:{inputEdges:edges.length,importedEdges:edges.length,unresolvedEdges:0,importFraction:1},frames,edgeFactors:edges,alvaFactors:[],landmarkFactors:landmarks,deepFactors,mvsFactors:[]};

function fakePhoto(seed){const width=128,height=96,gray=new Uint8Array(width*height),rgb=new Uint8Array(width*height*3);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=(x*3+y*5+seed*17)%255,i=y*width+x;gray[i]=v;rgb[i*3]=v;rgb[i*3+1]=(v+35)%255;rgb[i*3+2]=(v+70)%255;}return {width,height,K:{fx:K.fx*width/K.width,fy:K.fy*height/K.height,cx:K.cx*width/K.width,cy:K.cy*height/K.height},gray,rgb,features:[]};}
function makeDeep(frame){const cols=32,rows=24,raw=new Float32Array(cols*rows);for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const u=x/(cols-1)*(K.width-1),v=y/(rows-1)*(K.height-1),dc=pixelRay(K,u,v),dw=qRotate(frame.posePrior.q,dc),C=frame.posePrior.p,den=dw[2]-plane.a*dw[0]-plane.b*dw[1],num=plane.c+plane.a*C[0]+plane.b*C[1]-C[2],range=num/den,z=range*dc[2];raw[y*cols+x]=1/z;}return {frameId:frame.frameId,cols,rows,raw,rawWidth:K.width,rawHeight:K.height,quality:{suspicious:false}};}

test('room_test quick diagnostics accepts coherent synthetic geometry',async()=>{const r=await runGeometryDiagnostics({kind:'synthetic',name:'coherent',graph},{full:false});assert.equal(r.format,'ROOMSCAN-GEOMETRY-DIAGNOSTICS-1');assert.ok(r.stages.length>=11);const hard=r.stages.filter(s=>s.status==='fail');assert.deepEqual(hard.map(s=>[s.index,s.name,s.metrics]),[]);assert.ok(r.stages.find(s=>s.index===4).metrics.medianPx<.2);assert.ok(r.stages.find(s=>s.index===8).metrics.bestFit.medianRelative<.08);assert.ok(r.visuals.deepPoints.length>0);});

test('room_test localizes a corrupted camera model before dense stages',async()=>{const bad=structuredClone(graph);bad.frames[2].K.fx*=.55;bad.frames[2].KObserved.fx=bad.frames[2].K.fx;bad.frames[2].intrinsicsDeviation.fxRel=.45;const r=await runGeometryDiagnostics({kind:'synthetic',name:'bad-K',graph:bad},{full:false});const cam=r.stages.find(s=>s.index===1),epi=r.stages.find(s=>s.index===4);assert.ok(['warn','fail'].includes(cam.status));assert.ok(epi.metrics.medianPx>.05);assert.equal(r.summary.firstFailure.index,1);});

test('room_test full ablation is non destructive',async()=>{const before=JSON.stringify(graph.frames.map(f=>f.poseEstimate));const r=await runGeometryDiagnostics({kind:'synthetic',name:'full',graph},{full:true});assert.ok(r.stages.some(s=>s.index===11));assert.equal(JSON.stringify(graph.frames.map(f=>f.poseEstimate)),before);});
