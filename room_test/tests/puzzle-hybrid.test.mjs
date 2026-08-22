import test from 'node:test';
import assert from 'node:assert/strict';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';
import {DepthScaleGraph} from '../js/reconstruction/depth_scale_graph.js';
import {HybridSceneSolver,detectPlanes,snapManhattan,buildPlaneMesh,initializeParticles} from '../js/reconstruction/hybrid_scene_solver.js';
import {ViewSphereCoverage} from '../js/reconstruction/coverage_sphere.js';
import {projectPoint} from '../js/slam/math.js';

const K={fx:90,fy:92,cx:50,cy:40,width:100,height:80};
const pose=(p=[0,0,0],q=[0,0,0,1])=>({p:[...p],q:[...q]});
const rng=mulberry32(0x3029);

test('V30.29 factor graph keeps a self-consistent RGB photo/K/feature packet',()=>{
  const g=new ProbabilisticFactorGraph({photoMaxSide:50,grayMaxSide:40});
  const w=100,h=80,gray=new Uint8Array(w*h),rgba=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,v=(x*7+y*11)&255;gray[i]=v;rgba.set([v,255-v,(v*3)&255,255],i*4);}
  const f=g.addFrame({id:'k0',frameId:'f0',at:1,pose:pose(),K,width:w,height:h,gray,rgba,features:[{x:25,y:20,score:10,source:'alva-track'}]});
  assert.ok(f.photo);assert.equal(Math.max(f.photo.width,f.photo.height),50);assert.equal(f.photo.rgb.length,f.photo.width*f.photo.height*3);
  assert.ok(Math.abs(f.photo.K.fx-K.fx*f.photo.width/w)<1e-9);assert.ok(Math.abs(f.photo.features[0].x-25*f.photo.width/w)<1e-9);assert.equal(f.photo.features[0].originalU,25);
});

test('photo puzzle calibrates each Deep frame through pose-aware triangulation, not raw-depth equality',()=>{
  const cols=25,rows=20,w=100,h=80,n=[.30,.10,1],planeD=3.1,abc=[[1.70,.38],[1.43,.20],[1.96,.54]],poses=[pose([0,0,0]),pose([.22,.01,.10]),pose([.41,-.02,.22])];
  const frames=poses.map((p,i)=>({frameId:`f${i}`,K,width:w,height:h,posePrior:p,poseEstimate:p,poseCov:{translationStd:.004}}));
  const deepFactors=frames.map((f,i)=>({frameId:f.frameId,cols,rows,raw:planeRawGrid(poses[i],abc[i][0],abc[i][1]),quality:{suspicious:false,coherenceRatio:4,stripe:{suspicious:false}}}));
  const edges=[];for(let ei=0;ei<2;ei++){const matches=[];for(let gy=2;gy<rows-2;gy+=2)for(let gx=2;gx<cols-2;gx+=2){const u=(gx+.5)/cols*w,v=(gy+.5)/rows*h,z=planeDepth(poses[ei],u,v),p=worldFromOpticalZ(poses[ei],u,v,z),q=projectPoint(poses[ei+1],K,p);if(q&&q.u>2&&q.u<w-2&&q.v>2&&q.v<h-2)matches.push({aU:u,aV:v,bU:q.u,bV:q.v,probability:.96});}edges.push({a:ei,b:ei+1,aId:`f${ei}`,bId:`f${ei+1}`,matches,weight:.96});}
  const graph={format:'ROOMSCAN-PROB-GRAPH-1',frames,deepFactors,landmarkFactors:[]},puzzle={frames:frames.map(x=>({frameId:x.frameId})),edges,components:[[0,1,2]],stats:{connectedFraction:1,largestComponent:3}};
  const d=new DepthScaleGraph(graph,puzzle).build();assert.equal(d.stats.alignedFrames,3);assert.ok(d.metricModel);assert.ok(d.metricModel.error<.035,`metric error ${d.metricModel.error}`);assert.ok(d.stats.triangulatedPairs>30);
  const u=72,v=51,zTrue=planeDepth(poses[2],u,v),raw=sampleAnalyticRaw(poses[2],abc[2],u,v),pred=d.metricDepth('f2',raw);assert.ok(Math.abs(pred-zTrue)/zTrue<.035,`${pred} vs ${zTrue}`);
  function planeDepth(p,u,v){const xn=(u-K.cx)/K.fx,yn=(v-K.cy)/K.fy,num=planeD-(n[0]*p.p[0]+n[1]*p.p[1]+n[2]*p.p[2]),den=n[0]*xn+n[1]*yn+n[2];return num/den;}
  function planeRawGrid(p,a,b){const raw=new Float32Array(cols*rows);for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const u=(x+.5)/cols*w,v=(y+.5)/rows*h,z=planeDepth(p,u,v);raw[y*cols+x]=(z-b)/a;}return raw;}
  function sampleAnalyticRaw(p,ab,u,v){return (planeDepth(p,u,v)-ab[1])/ab[0];}
  function worldFromOpticalZ(p,u,v,z){return [p.p[0]+(u-K.cx)/K.fx*z,p.p[1]+(v-K.cy)/K.fy*z,p.p[2]+z];}
});

test('hybrid ray observations convert camera optical-Z to normalized-ray range without bowing a wall',()=>{
  const w=100,h=80,cols=12,rows=10,raw=new Float32Array(cols*rows);raw.fill(2);const photo={width:w,height:h,K:{...K},gray:new Uint8Array(w*h),rgb:new Uint8Array(w*h*3),features:[]};
  const graph={format:'ROOMSCAN-PROB-GRAPH-1',frames:[{frameId:'f0',K,width:w,height:h,posePrior:pose(),poseEstimate:pose(),photo}],deepFactors:[{frameId:'f0',cols,rows,raw,quality:{suspicious:false,coherenceRatio:4,stripe:{suspicious:false}}}],landmarkFactors:[],mvsFactors:[]};
  const puzzle={frames:[{frameId:'f0'}],components:[[0]],stats:{connectedFraction:1}},depth={transforms:new Map([['f0',{connected:true,confidence:1}]]),metricModel:{mode:'direct',error:.02},stats:{meanEdgeResidual:0},frameConfidence:()=>1,metricDepth:()=>2};
  const solver=new HybridSceneSolver(graph,puzzle,depth,{particleBudget:100,maxObservations:500});const obs=solver.buildObservations();assert.ok(obs.length>20);const zs=obs.map(o=>o.point[2]);assert.ok(Math.max(...zs)-Math.min(...zs)<1e-6,`${Math.min(...zs)}..${Math.max(...zs)}`);assert.ok(Math.abs(zs[0]-2)<1e-6);
});

test('plane-first solver discovers noisy shoebox surfaces without spending particles on them',()=>{
  const obs=shoeboxObservations();const planes=detectPlanes(obs,{maxPlanes:8,minInliers:45,rng:mulberry32(77)});snapManhattan(planes,obs);const mesh=buildPlaneMesh(planes);
  assert.ok(planes.length>=4,`planes ${planes.length}`);assert.ok(mesh.faces.length>=24,`faces ${mesh.faces.length}`);assert.ok(planes.filter(p=>p.area>.5).length>=4);
});

test('deterministic annealing uses fixed validation loss and cannot accept an uphill particle step',()=>{
  const obs=[];for(let i=0;i<900;i++){const a=2*Math.PI*rng(),r=1+.18*Math.sin(3*a),p=[r*Math.cos(a)+noise(.025),.65*Math.sin(a*.5)+noise(.02),2.2+r*.35*Math.sin(a)+noise(.025)],o=[.15*Math.sin(i*.03),0,0],v=sub(p,o),depth=Math.hypot(...v),d=v.map(x=>x/depth);obs.push({o,d,depth,sigmaDepth:.08,sigmaLateral:.035,weight:.7,color:[180,190,210],frameId:`f${i%12}`,source:'synthetic',point:p});}
  const solver=new HybridSceneSolver({frames:[]},{components:[[]],frames:[],stats:{connectedFraction:1}},{metricModel:{mode:'direct'},stats:{meanEdgeResidual:0}},{particleBudget:120});solver.observations=obs;solver.residual=obs.map((_,i)=>i);solver.planes=[];solver.particles=initializeParticles(obs,solver.residual,120);solver.cellSize=.12;const before=solver.validationLoss();for(let i=0;i<12;i++)solver.singleStep();const after=solver.validationLoss();assert.ok(after<=before*(1+3e-4),`${before} -> ${after}`);assert.ok(Number.isFinite(solver.stats.validationLoss));
});

test('scan coverage sphere keeps weak sectors visible and provides revisit guidance',()=>{
  const c=new ViewSphereCoverage({cols:16,rows:8,maxFrames:20});for(let i=0;i<5;i++){const yaw=-.8+i*.4,q=[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],gray=new Uint8Array(80*60);gray.fill(80+i*7);c.addFrame({id:`k${i}`,frameId:`f${i}`,at:i*1000,pose:pose([i*.05,0,0],q),K:{fx:65,fy:65,cx:40,cy:30,width:80,height:60},width:80,height:60,gray,features:Array.from({length:50},(_,k)=>({x:10+(k%10)*6,y:10+Math.floor(k/10)*7,score:10}))});}
  const s=c.status();assert.ok(s.seenCoverage>0&&s.seenCoverage<1);assert.equal(s.cells.length,16*8);assert.ok(typeof s.guidance==='string'&&s.guidance.length>5);assert.equal(s.cols,16);assert.equal(s.rows,8);
});

function shoeboxObservations(){const out=[],dims=[4,3,2.5],faces=[{a:0,v:0},{a:0,v:dims[0]},{a:1,v:0},{a:1,v:dims[1]},{a:2,v:0},{a:2,v:dims[2]}];let k=0;for(const f of faces)for(let i=0;i<180;i++){const p=[rng()*dims[0],rng()*dims[1],rng()*dims[2]];p[f.a]=f.v+noise(.018);const o=[2+.5*Math.sin(i*.1),1.5,.7+1.1*((i%9)/8)],v=sub(p,o),depth=Math.hypot(...v),d=v.map(x=>x/depth);out.push({o,d,depth,sigmaDepth:.035,sigmaLateral:.018,weight:.75+.2*rng(),color:[185,195,205],frameId:`f${k++%12}`,source:'deep',point:p});}return out;}
function noise(s){return (rng()+rng()+rng()+rng()-2)*s;}
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function mulberry32(a){return()=>{let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
