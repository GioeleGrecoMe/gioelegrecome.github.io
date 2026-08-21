import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DiagnosticsLog} from '../js/logger.js';
import {CONFIG} from '../js/config.js';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('live and review use one in-process ProbabilisticJointOptimizer runtime with accepted/working split',()=>{
  const app=read('js/app.js'),runtime=read('js/probabilistic/single_optimizer_runtime.js'),html=read('room_scanner_v30.html'),config=read('js/config.js');
  assert.equal(CONFIG.singleOptimizerOnly,true);assert.equal(CONFIG.legacyOptimizersEnabled,false);
  assert.match(app,/SingleOptimizerRuntime/);assert.match(app,/single-opt-cycle-dispatch/);assert.match(app,/single-opt-candidate-rejected/);assert.match(app,/startPostOptimization\(\)\{return startProbabilisticOptimization\(\);\}/);
  assert.doesNotMatch(app,/new Worker\([^\n]*live_probabilistic_worker/);assert.doesNotMatch(app,/gaussian_opt_worker/);assert.doesNotMatch(app,/probabilistic_opt_worker/);assert.doesNotMatch(app,/surface_mesh_lab_worker/);assert.doesNotMatch(app,/puzzle_reconstruction_worker/);
  assert.doesNotMatch(app,/stopSurfaceLabWorker|startSurfaceLab|discardSurfaceLab|stopPuzzleWorker|startPuzzleWorker/,'removed legacy optimizer hooks must not remain reachable from app.js');
  assert.match(runtime,/ProbabilisticJointOptimizer/);assert.match(runtime,/acceptedSnapshot/);assert.match(runtime,/workingSnapshot/);assert.match(runtime,/evaluateLiveCandidate/);assert.match(runtime,/single-opt-error/);
  assert.match(html,/id="liveOptimizerHud"/);assert.match(html,/OPT UNICO/);assert.doesNotMatch(html,/surfaceLabStartBtn|puzzleStartBtn|Legacy A\/B/);
  assert.doesNotMatch(config,/liveProbabilisticOptWorker:|probabilisticOptWorker:|postOptimizeWorker:|puzzleWorker:|surfaceLabWorker:/);
});

test('structured diagnostics preserve checkpoints, monotonic sequence and runtime context',()=>{
  const log=new DiagnosticsLog({maxEntries:8,maxCheckpoints:4,build:{version:'test'}});log.setContextProvider(()=>({optimizer:{accepted:2,rejected:1}}));log.info('live-opt-dispatch',{generation:1});log.decision('live-opt-candidate-accepted',{generation:1,score:.2});log.checkpoint('accepted',{generation:1,accepted:true});const s=log.snapshot();
  assert.equal(s.format,'ROOMSCAN-V30-DIAGNOSTICS-2');assert.equal(s.entries.length,3);assert.ok(s.entries[1].seq>s.entries[0].seq);assert.equal(s.runtime.optimizer.accepted,2);assert.equal(s.checkpoints[0].name,'accepted');assert.equal(s.summary.eventCount,3);assert.ok(s.summary.byScope.optimizer>=2);assert.match(log.ndjson(),/live-opt-candidate-accepted/);
});

import {SingleOptimizerRuntime} from '../js/probabilistic/single_optimizer_runtime.js';
import {projectPoint} from '../js/slam/math.js';

test('single optimizer runtime actually executes a synthetic RGB scaffold without a worker',async()=>{
  const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240},pose=x=>({p:[x,0,0],q:[0,0,0,1]});
  const trueFrames=[0,.08,.16,.24].map((x,i)=>({frameId:`s${i}`,pose:pose(x)}));
  const frames=trueFrames.map((f,i)=>({frameId:f.frameId,posePrior:{p:[f.pose.p[0]+(i?(.006*(i%2?1:-1)):0),0,0],q:[0,0,0,1]},poseEstimate:{p:[f.pose.p[0]+(i?(.006*(i%2?1:-1)):0),0,0],q:[0,0,0,1]},poseCov:{diag:[4e-4,4e-4,4e-4,1e-4,1e-4,1e-4]},K,width:320,height:240}));
  const landmarkFactors=[];let n=0;
  for(let y=-.28;y<=.28;y+=.14)for(let x=-.42;x<=.42;x+=.14){const p=[x,y,2.1+.08*Math.sin(x*4)],measurements=[];for(const f of trueFrames){const q=projectPoint(f.pose,K,p);if(q)measurements.push({frameId:f.frameId,u:q.u,v:q.v,probability:.98});}landmarkFactors.push({id:`sl${n++}`,point:[p[0]+.004,p[1],p[2]+.008],covariance:[4e-4,0,0,4e-4,0,1.6e-3],probability:.9,relativeDepthSigma:.04,measurements});}
  const trace=[],runtime=new SingleOptimizerRuntime({onTrace:(e,d)=>trace.push([e,d])});
  const out=await runtime.runCycle({reason:'unit',graph:{format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors:[],alvaFactors:[],landmarkFactors,deepFactors:[],mvsFactors:[],summary:{frames:4,landmarks:landmarkFactors.length,deepFrames:0,photoEdges:0,alvaEdges:0,mvsSamples:0}},budgetMs:200,maxIterations:1});
  assert.notEqual(out.type,'single-opt-error',out.message||out.stack);assert.ok(['single-opt-accepted','single-opt-rejected'].includes(out.type),out.type);assert.ok(trace.some(x=>x[0]==='cycle-start'));assert.ok(trace.some(x=>x[0]==='step'));assert.ok(trace.some(x=>x[0]==='gate'));
});

test('single optimizer can accept a robust RGB bootstrap despite large raw outlier RMSE',async()=>{
  const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240},pose=x=>({p:[x,0,0],q:[0,0,0,1]}),truth=[0,.08,.16,.24].map((x,i)=>({frameId:`o${i}`,pose:pose(x)}));
  const frames=truth.map((f,i)=>({frameId:f.frameId,posePrior:{p:[f.pose.p[0]+(i?(.02*(i%2?1:-1)):0),0,0],q:[0,0,0,1]},poseEstimate:{p:[f.pose.p[0]+(i?(.02*(i%2?1:-1)):0),0,0],q:[0,0,0,1]},poseCov:{diag:[4e-4,4e-4,4e-4,1e-4,1e-4,1e-4]},K,width:320,height:240}));
  const landmarkFactors=[];let n=0;for(let y=-.28;y<=.28;y+=.12)for(let x=-.42;x<=.42;x+=.12){const p=[x,y,2.1+.1*Math.sin(x*4)],measurements=[];for(let fi=0;fi<truth.length;fi++){const q=projectPoint(truth[fi].pose,K,p);if(!q)continue;const bad=(n+fi)%4===0;measurements.push({frameId:truth[fi].frameId,u:q.u+(bad?45:0),v:q.v+(bad?-32:0),probability:bad?.45:.98});}landmarkFactors.push({id:`ol${n++}`,point:[p[0]+.012,p[1]-.008,p[2]+.02],covariance:[4e-4,0,0,4e-4,0,1.6e-3],probability:.9,measurements});}
  const I=[1,0,0,0,1,0,0,0,1],edgeFactors=[0,1,2].map(i=>({aId:`o${i}`,bId:`o${i+1}`,visualConfidence:.82,rotationBToA:I,inliers:30,matches:Array.from({length:30},()=>({probability:.9}))})),trace=[],runtime=new SingleOptimizerRuntime({onTrace:(e,d)=>trace.push([e,d])});
  const out=await runtime.runCycle({reason:'outlier-bootstrap',graph:{format:'ROOMSCAN-PROB-GRAPH-1',frames,edgeFactors,alvaFactors:[],landmarkFactors,deepFactors:[],mvsFactors:[],summary:{frames:4,landmarks:landmarkFactors.length,deepFrames:0,photoEdges:3,alvaEdges:0,mvsSamples:0}},budgetMs:200,maxIterations:1,gateOptions:{maxReprojectionPx:3.2}});
  assert.equal(out.type,'single-opt-accepted',out.gate?.hardReasons?.join(',')||out.type);assert.ok(out.stats.reprojectionRmse>10,out.stats);assert.ok(out.stats.reprojectionRobustRmse<3.2,out.stats);assert.equal(out.stats.feedbackPhase,'rgb-bootstrap');assert.equal(out.stats.edgeSwitches.rejected,0);assert.ok(trace.some(([e,d])=>e==='cycle-start'&&d.bootstrap===true));
});
