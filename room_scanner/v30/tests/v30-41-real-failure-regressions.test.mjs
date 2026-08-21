import test from 'node:test';
import assert from 'node:assert/strict';
import {ProbabilisticFactorGraph} from '../js/probabilistic/factor_graph.js';
import {SwitchableAlvaEdgeModel} from '../js/probabilistic/alva_switchable_edges.js';
import {ProbabilisticJointOptimizer} from '../js/probabilistic/joint_optimizer.js';
import {solveHierarchicalDepthCalibration} from '../js/probabilistic/depth_calibration_hierarchy.js';
import {projectPoint,qRotate,qConj} from '../js/slam/math.js';
import {buildConsensusTsdfMeshFromSplats} from '../js/dense/fusion_core.js';
import {analyzeMeshQuality} from '../js/reconstruction/mesh_quality.js';
import {mergeOptimizerSnapshots} from '../js/probabilistic/single_optimizer_runtime.js';

const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240};
const pose=(x=0,q=[0,0,0,1])=>({p:[x,0,0],q});
const cov={diag:[1e-4,1e-4,1e-4,1e-5,1e-5,1e-5]};
const frame=(id,x=0,extra={})=>({frameId:id,posePrior:pose(x),poseEstimate:pose(x),poseCov:cov,K,width:320,height:240,features:[],...extra});

function makeAlvaFactors(frames){
  const g=new ProbabilisticFactorGraph();
  g.frames=frames;g.frameIndex=new Map(frames.map((f,i)=>[String(f.frameId),i]));
  for(let i=1;i<frames.length;i++)g.addAlvaRelativeFactor(frames[i-1],frames[i]);
  return g.alvaFactors;
}

function makeRichRgbScaffold({count=7,jump=.18}={}){
  const truth=Array.from({length:count},(_,i)=>({frameId:`j${i}`,pose:pose(i*.1)}));
  const frames=truth.map((f,i)=>frame(f.frameId,i*.1+(i>=3?jump:0)));
  const landmarks=[];let n=0;
  for(let y=-.5;y<=.5;y+=.12)for(let x=-.7;x<=.7;x+=.14){
    const p=[x,y,2.2+.35*Math.sin(x*2.1)+.15*Math.cos(y*4)],measurements=[];
    for(const f of truth){const q=projectPoint(f.pose,K,p);if(q&&q.u>=0&&q.u<K.width&&q.v>=0&&q.v<K.height)measurements.push({frameId:f.frameId,u:q.u,v:q.v,probability:.98});}
    if(measurements.length>=3)landmarks.push({id:`jl${n++}`,point:p.slice(),covariance:[1e-4,0,0,1e-4,0,2e-4],probability:.95,relativeDepthSigma:.03,measurements});
  }
  return {truth,frames,landmarks};
}

function planeSplats(z,{step=.04,normal=[0,0,-1],reliable=true,sourceMask=2}={}){
  const out=[];for(let y=-.5;y<=.5+1e-9;y+=step)for(let x=-.5;x<=.5+1e-9;x+=step)out.push({position:[x,y,z],normal:normal.slice(),normalReliable:reliable,viewOrigin:[0,0,0],sourceMask,color:[180,185,190],scale:[.025,.025,.006],positionCovariance:[1e-5,0,0,1e-5,0,1e-5],positionSigma:.003,confidence:.9,support:3});return out;
}

function depthScene(scale=1,count=10){
  const C=20,R=14,frames=[],deepFactors=[],landmarks=[];let lid=0;
  for(let i=0;i<count;i++){
    const id=`d${i}`,p=pose(i*.025*scale);frames.push({frameId:id,posePrior:p,poseEstimate:p,poseCov:cov,K,width:320,height:240});
    const raw=new Float32Array(C*R);for(let y=0;y<R;y++)for(let x=0;x<C;x++)raw[y*C+x]=-.8+1.6*(.68*x/(C-1)+.32*y/(R-1));deepFactors.push({frameId:id,cols:C,rows:R,raw,quality:{suspicious:false}});
  }
  // Use the same physical world landmarks in all views. Their inverse depth is
  // proportional to one common nonlinear response of the local raw value.
  const raw0=deepFactors[0].raw,F=x=>x+.11*.5*(3*x*x-1)-.035*.5*(5*x*x*x-3*x);
  for(let gy=2;gy<R-2;gy+=2)for(let gx=2;gx<C-2;gx+=2){
    const u=(gx+.5)/C*K.width,v=(gy+.5)/R*K.height,rv=raw0[gy*C+gx],rho=(.54*F(rv)+1.05)/scale,z=1/rho,world=[(u-K.cx)/K.fx*z,(v-K.cy)/K.fy*z,z],measurements=[];
    for(const f of frames){const q=projectPoint(f.poseEstimate,K,world);if(q)measurements.push({frameId:f.frameId,u:q.u,v:q.v,probability:.98});}
    landmarks.push({id:`dl${lid++}`,point:world,covariance:[2e-5,0,0,2e-5,0,4e-5],probability:.98,relativeDepthSigma:.012,measurements});
  }
  return {frames,deepFactors,landmarks};
}

test('production Alva factors seed translation/rotation switches from tracker prior and repair legacy unit switches',()=>{
  const frames=[frame('a',0),frame('b',.1,{trackingMode:'alvaar-lost',poseCov:{diag:[.03,.03,.03,.01,.01,.01]}})],g=new ProbabilisticFactorGraph();g.frames=frames;g.frameIndex=new Map(frames.map((f,i)=>[f.frameId,i]));const f=g.addAlvaRelativeFactor(frames[0],frames[1]);
  assert.ok(f.priorConfidence<=.05,f);assert.equal(f.translationSwitch,f.priorConfidence);assert.equal(f.rotationSwitch,f.priorConfidence);assert.equal(f.switchInitializedFromPrior,true);
  const live=new SwitchableAlvaEdgeModel(frames,{factors:[{aId:'a',bId:'b',relativePose:f.relativePose,priorConfidence:.025,translationSwitch:1,rotationSwitch:1}]});assert.ok(live.edges[0].translationSwitch<.05,live.edges[0]);assert.ok(live.edges[0].rotationSwitch<.05,live.edges[0]);
});

test('RGB-only proposal falsifies a local Alva translation jump instead of self-confirming it',()=>{
  const {frames,landmarks}=makeRichRgbScaffold(),alvaFactors=makeAlvaFactors(frames),graph={format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors:[],alvaFactors,landmarkFactors:landmarks,deepFactors:[],mvsFactors:[]},opt=new ProbabilisticJointOptimizer(graph,{rgbWarmupIterations:8,localWindowSize:18});
  const before=opt.computeStats().reprojectionRobustRmse;for(let i=0;i<30;i++)opt.step(1,{bootstrap:true,allowDepth:false});const after=opt.computeStats(),xs=opt.frames.map(f=>f.poseEstimate.p[0]),localJump=xs[3]-xs[2];
  assert.ok(after.reprojectionRobustRmse<before*.25,{before,after:after.reprojectionRobustRmse,xs});assert.ok(localJump<.16,{localJump,xs});assert.ok(after.alvaSwitches.translationMean<after.alvaSwitches.rotationMean-.08,after.alvaSwitches);
});

test('hierarchical Depth error is dimensionless and stable under arbitrary global scene scale',()=>{
  const a=depthScene(1,9),b=depthScene(3.7,9),ma=solveHierarchicalDepthCalibration({...a,iterations:18,minGlobalFrames:5,minGlobalAnchors:35}),mb=solveHierarchicalDepthCalibration({...b,iterations:18,minGlobalFrames:5,minGlobalAnchors:35});
  assert.ok(Number.isFinite(ma.stats.medianRelativeResidual),ma.stats);assert.ok(Number.isFinite(mb.stats.medianRelativeResidual),mb.stats);assert.ok(ma.stats.medianRelativeResidual<.12,ma.stats);assert.ok(mb.stats.medianRelativeResidual<.12,mb.stats);const ratio=ma.stats.medianRelativeResidual/Math.max(1e-9,mb.stats.medianRelativeResidual);assert.ok(ratio>.35&&ratio<2.8,{a:ma.stats.medianRelativeResidual,b:mb.stats.medianRelativeResidual,ratio});
});

test('committed rebuild refreshes Depth calibration on every current graph frame rather than stale local-window state',()=>{
  const full=depthScene(1,10),sub={frames:full.frames.slice(0,4),deepFactors:full.deepFactors.slice(0,4),landmarks:full.landmarks.map(l=>({...l,measurements:l.measurements.filter(m=>Number(m.frameId.slice(1))<4)}))};
  const subGraph={format:'ROOMSCAN-PROB-GRAPH-1',frames:sub.frames,edgeFactors:[],alvaFactors:[],landmarkFactors:sub.landmarks,deepFactors:sub.deepFactors,mvsFactors:[]},seed=new ProbabilisticJointOptimizer(subGraph);seed.refreshDepthCalibration({iterations:12,minGlobalFrames:3,minGlobalAnchors:20});assert.equal(seed.depthCalibration.frames.length,4);
  const graph={format:'ROOMSCAN-PROB-GRAPH-1',frames:full.frames,edgeFactors:[],alvaFactors:[],landmarkFactors:full.landmarks,deepFactors:full.deepFactors,mvsFactors:[]},opt=new ProbabilisticJointOptimizer(graph,{initial:seed.snapshot()}),out=opt.rebuild({maxDeepSamples:0,maxMvsSamples:0,maxSurfels:2000,maxTriangles:2000});
  assert.equal(out.stats.depthCalibration.frames,10,out.stats.depthCalibration);assert.ok(out.stats.depthCalibration.anchors>=full.landmarks.length*8,out.stats.depthCalibration);
});

test('sparse RGB landmarks constrain geometry but never manufacture a committed surface',()=>{
  const {frames,landmarks}=makeRichRgbScaffold({count:4,jump:0}),graph={format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors:[],alvaFactors:[],landmarkFactors:landmarks,deepFactors:[],mvsFactors:[]},opt=new ProbabilisticJointOptimizer(graph),out=opt.rebuild({maxMvsSamples:0,maxDeepSamples:0,maxSurfels:5000,maxTriangles:5000});
  assert.equal(out.stats.sparseLandmarksMeshed,false);assert.equal(out.stats.sparseSurfaceAnchors,landmarks.length);assert.equal(out.mesh.faces.length,0,'track landmarks are anchors, not little TSDF blobs');
});

test('global final dense surface is coherent across submaps instead of concatenating tiny local islands',()=>{
  const frames=[-.15,0,.15].map((x,i)=>frame(`p${i}`,x,{poseCov:{diag:[1e-6,1e-6,1e-6,1e-7,1e-7,1e-7]}})),mvsFactors=frames.map((f,fi)=>{const samples=[];for(let v=40;v<=200;v+=10)for(let u=60;u<=260;u+=10)samples.push({u,v,depth:2,probability:.9,sigmaDepth:.012,normal:[0,0,-1],normalSpace:'camera',color:[150,160,170],sourceFrames:frames.filter((_,j)=>j!==fi).map(x=>x.frameId)});return {frameId:f.frameId,packed:false,samples};}),graph={format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors:[],alvaFactors:[],landmarkFactors:[],deepFactors:[],mvsFactors},out=new ProbabilisticJointOptimizer(graph).rebuild({voxel:.04,hashVoxel:.025,maxSurfels:20000,maxTriangles:30000,maxMvsSamples:100000,submapSize:4,submapOverlap:1}),q=analyzeMeshQuality(out.mesh);
  assert.equal(out.stats.globalFinalTsdf,true);assert.equal(q.status,'coherent',q);assert.equal(q.componentCount,1,q);assert.ok(q.largestComponentFraction>.95,q);
});

test('multi-layer final mesher preserves nearby parallel surfaces without a phantom averaged sheet',()=>{
  const z0=2,z1=2.12,mesh=buildConsensusTsdfMeshFromSplats([...planeSplats(z0),...planeSplats(z1)],{voxel:.03,maxTriangles:50000}),q=analyzeMeshQuality(mesh),zs=[];for(let i=2;i<mesh.vertices.length;i+=3)zs.push(mesh.vertices[i]);const mid=(z0+z1)/2,midCount=zs.filter(z=>Math.abs(z-mid)<.02).length;
  assert.equal(mesh.consensusMode,'multi-layer-tsdf');assert.equal(mesh.surfaceLayers,2,mesh);assert.equal(q.componentCount,2,q);assert.equal(midCount,0,{midCount,min:Math.min(...zs),max:Math.max(...zs)});assert.ok(zs.some(z=>Math.abs(z-z0)<.015)&&zs.some(z=>Math.abs(z-z1)<.015));
});

test('mesh quality detector flags the exact many-island topology seen in the bad exported mesh class',()=>{
  const vertices=[],faces=[];for(let c=0;c<40;c++){const ox=c*.2,b=vertices.length/3;vertices.push(ox,0,0,ox+.02,0,0,ox,.02,0);faces.push(b,b+1,b+2);}const q=analyzeMeshQuality({vertices:new Float32Array(vertices),faces:new Uint32Array(faces)});assert.equal(q.status,'fragmented',q);assert.equal(q.componentCount,40);assert.ok(q.largestComponentFraction<.05,q);
});

test('MVS world normals are persisted camera-local so later pose refinement rotates point and normal together',()=>{
  const a=Math.PI/4,q=[0,Math.sin(a/2),0,Math.cos(a/2)],f=frame('n0',0,{posePrior:pose(0,q),poseEstimate:pose(0,q),gray:new Uint8Array(320*240)}),g=new ProbabilisticFactorGraph();g.addFrame({...f,pose:f.posePrior,gray:f.gray});const world=[1,0,0],expected=qRotate(qConj(q),world);g.addMvs('n0',[{p:[2,0,2],u:160,v:120,depth:2,confidence:.9,normal:world,color:[1,2,3]}]);const m=g.mvsFactors[0],stored=[m.normal[0],m.normal[1],m.normal[2]];assert.equal(m.normalSpace,'camera');for(let k=0;k<3;k++)assert.ok(Math.abs(stored[k]-expected[k])<1e-5,{stored,expected});
});


test('accepted live state is merged by persistent IDs instead of forgetting older local windows',()=>{
  const a={format:'ROOMSCAN-PROB-OPT-2',iterations:5,frames:[{frameId:'f0',poseEstimate:pose(0)},{frameId:'f1',poseEstimate:pose(.1)}],landmarks:[{id:'l0',point:[0,0,2],probability:.9}],edgeSwitches:{format:'ROOMSCAN-SWITCHABLE-RGB-EDGES-1',edges:[{aId:'f0',bId:'f1',switch:.8}]},alvaSwitches:{format:'ROOMSCAN-SWITCHABLE-ALVA-1',edges:[{aId:'f0',bId:'f1',translationSwitch:.7,rotationSwitch:.9}]}};
  const b={format:'ROOMSCAN-PROB-OPT-2',iterations:8,frames:[{frameId:'f1',poseEstimate:pose(.11)},{frameId:'f2',poseEstimate:pose(.2)}],landmarks:[{id:'l1',point:[.1,0,2],probability:.8}],edgeSwitches:{format:'ROOMSCAN-SWITCHABLE-RGB-EDGES-1',edges:[{aId:'f1',bId:'f2',switch:.75}]},alvaSwitches:{format:'ROOMSCAN-SWITCHABLE-ALVA-1',edges:[{aId:'f1',bId:'f2',translationSwitch:.6,rotationSwitch:.95}]}};
  const m=mergeOptimizerSnapshots(a,b);assert.deepEqual(m.frames.map(x=>x.frameId).sort(),['f0','f1','f2']);assert.equal(m.frames.find(x=>x.frameId==='f1').poseEstimate.p[0],.11);assert.deepEqual(m.landmarks.map(x=>x.id).sort(),['l0','l1']);assert.equal(m.edgeSwitches.edges.length,2);assert.equal(m.alvaSwitches.edges.length,2);assert.equal(m.iterations,8);
});

test('commit frame mask excludes raw/unaccepted pose frames from dense final geometry',()=>{
  const frames=[-.15,0,.15].map((x,i)=>frame(`c${i}`,x,{poseCov:{diag:[1e-6,1e-6,1e-6,1e-7,1e-7,1e-7]}})),mvsFactors=frames.map((f,fi)=>{const samples=[];for(let v=50;v<=190;v+=14)for(let u=70;u<=250;u+=14)samples.push({u,v,depth:2+.5*fi,probability:.9,sigmaDepth:.012,normal:[0,0,-1],normalSpace:'camera',color:[150,160,170],sourceFrames:frames.filter((_,j)=>j!==fi).map(x=>x.frameId)});return {frameId:f.frameId,packed:false,samples};}),graph={format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors:[],alvaFactors:[],landmarkFactors:[],deepFactors:[],mvsFactors},out=new ProbabilisticJointOptimizer(graph).rebuild({voxel:.04,hashVoxel:.025,maxSurfels:20000,maxTriangles:30000,maxMvsSamples:100000,submapSize:4,submapOverlap:1,commitFrameIds:new Set(['c0','c1'])});
  assert.equal(out.stats.eligibleCommittedFrames,2);assert.equal(out.stats.excludedUnacceptedFrames,1);assert.ok(out.stats.mvsCount>0);const zs=[];for(let i=2;i<out.mesh.vertices.length;i+=3)zs.push(out.mesh.vertices[i]);assert.ok(!zs.some(z=>z>2.85),{maxZ:zs.length?Math.max(...zs):null});
});

test('local Depth calibration freezes normalization domain while full reinitialization can choose a session-wide domain',()=>{
  const a=depthScene(1,5),m1=solveHierarchicalDepthCalibration({...a,iterations:10,minGlobalFrames:3,minGlobalAnchors:20});
  const b=depthScene(1,5);for(const d of b.deepFactors)for(let i=0;i<d.raw.length;i++)d.raw[i]=d.raw[i]*3+7;
  const frozen=solveHierarchicalDepthCalibration({...b,previous:m1,iterations:6,minGlobalFrames:3,minGlobalAnchors:20}),fresh=solveHierarchicalDepthCalibration({...b,previous:null,iterations:6,minGlobalFrames:3,minGlobalAnchors:20,freezeDomain:false});
  assert.deepEqual(frozen.domain,m1.domain);assert.ok(Math.abs(fresh.domain.center-m1.domain.center)>1,{old:m1.domain,fresh:fresh.domain});
});

test('one physical plane stays one TSDF layer even when input normals have opposite signs',()=>{
  const rows=planeSplats(2);for(let i=0;i<rows.length;i+=2){rows[i].normal=[0,0,1];rows[i].viewOrigin=null;}const mesh=buildConsensusTsdfMeshFromSplats(rows,{voxel:.03,maxTriangles:40000}),q=analyzeMeshQuality(mesh);assert.equal(mesh.surfaceLayers,1,mesh);assert.equal(q.componentCount,1,q);assert.equal(q.degenerateFaces,0,q);assert.ok(q.largestComponentFraction>.95,q);
});

test('perpendicular room surfaces remain distinct TSDF layers but weld into one connected corner',()=>{
  const rows=[...planeSplats(2,{step:.03})];
  for(let z=1.5;z<=2.02+1e-9;z+=.03)for(let x=-.5;x<=.5+1e-9;x+=.03)rows.push({position:[x,.5,z],normal:[0,-1,0],normalReliable:true,viewOrigin:[0,0,0],sourceMask:2,color:[180,185,190],scale:[.025,.025,.006],positionCovariance:[1e-5,0,0,1e-5,0,1e-5],positionSigma:.003,confidence:.9,support:3});
  const mesh=buildConsensusTsdfMeshFromSplats(rows,{voxel:.03,maxTriangles:100000}),q=analyzeMeshQuality(mesh);
  assert.equal(mesh.surfaceLayers,2,mesh);assert.equal(q.componentCount,1,q);assert.equal(q.degenerateFaces,0,q);assert.equal(q.status,'coherent',q);assert.ok(q.largestComponentFraction>.99,q);
});
