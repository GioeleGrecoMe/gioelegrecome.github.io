import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SparseDenseFusion} from '../js/dense/fusion_core.js';
import {GaussianBatchOptimizer} from '../js/gaussian/batch_optimizer.js';
import {rayCovariance} from '../js/dense/deep_ray_samples.js';

function obs(p,origin,id){
  const v=p.map((x,k)=>x-origin[k]),d=Math.hypot(...v),r=v.map(x=>x/d);
  return {p,depth:d,normal:[0,0,-1],normalReliable:true,color:[160,180,200],confidence:.92,radius:.015,covariance:rayCovariance(r,.045,.006),surfaceCovariance:[.00018,0,0,.00018,0,.000008],source:'proxy-verified',independentSupport:1,evidenceFrames:[id],viewSupport:1};
}

test('fusion snapshot persists a bounded view-diverse observation reservoir aligned with Gaussians',()=>{
  const f=new SparseDenseFusion({voxel:.035,hashVoxel:.02,minSupport:2,minConfirmBaseline:.02,observationReservoir:4});
  const origins=[[0,0,0],[.06,0,0],[0,.06,0],[-.06,0,0],[0,-.06,0]];
  origins.forEach((o,i)=>f.integrate([obs([.002*(i%2),0,2+.003*(i-2)],o,`f${i}`)],{origin:o,frameId:`f${i}`,mode:'proxy-depth'}));
  const out=f.exportPersistentState({maxSurfels:10,maxObservationsPerSurfel:4});
  assert.equal(out.format,'ROOMSCAN-GS-OPT-1');assert.equal(out.gaussians.length,1);assert.equal(out.observations.stride,13);
  assert.ok(out.observations.count>=2&&out.observations.count<=4,`reservoir ${out.observations.count}`);assert.equal(out.observations.offsets.length,2);assert.equal(out.observations.offsets[1],out.observations.count);assert.equal(out.observations.data.length,out.observations.count*13);
});

test('batch optimiser reduces multi-view geometric error without tangentially collapsing a plane',()=>{
  const gs=[],offsets=[0],rows=[];let count=0;const noise=[-.07,.05,-.04,.065,-.055,.045,-.035,.06,-.05];
  for(let iy=-1,k=0;iy<=1;iy++)for(let ix=-1;ix<=1;ix++,k++){
    const x=ix*.12,y=iy*.12,z=2+noise[k];gs.push({position:[x,y,z],normal:[0,0,-1],color:[150,180,210],scale:[.045,.045,.006],covariance:[.002025,0,0,.002025,0,.000036],positionCovariance:[.0009,0,0,.0009,0,.0036],opacity:.8,confidence:.8,support:3});
    for(const [oi,o] of [[0,[-.08,0,0]],[1,[.08,.02,0]],[2,[0,-.08,0]]]){const p=[x+(oi-1)*.001,y,2+(oi-1)*.004],v=p.map((q,j)=>q-o[j]),d=Math.hypot(...v),r=v.map(q=>q/d),cov=rayCovariance(r,.035,.005);rows.push(...o,...p,...cov,.92);count++;}offsets.push(count);
  }
  const before=gs.reduce((a,g)=>a+Math.abs(g.position[2]-2),0)/gs.length,spacingBefore=Math.hypot(gs[1].position[0]-gs[0].position[0],gs[1].position[1]-gs[0].position[1]);
  const opt=new GaussianBatchOptimizer(gs,{stride:13,count,offsets:new Uint32Array(offsets),data:new Float32Array(rows)},{planeWeight:.08,damping:.65});opt.step(10);const out=opt.snapshot();
  const after=out.reduce((a,g)=>a+Math.abs(g.position[2]-2),0)/out.length,spacingAfter=Math.hypot(out[1].position[0]-out[0].position[0],out[1].position[1]-out[0].position[1]);
  assert.ok(after<before*.35,`z error ${before} -> ${after}`);assert.ok(Math.abs(spacingAfter-spacingBefore)<.015,`tangential spacing ${spacingBefore} -> ${spacingAfter}`);assert.ok(opt.lastStats.energy>=0);assert.ok(opt.lastStats.observations>0);
});

test('review exposes the same single hierarchical optimiser and reloadable local sessions',()=>{
  const html=fs.readFileSync(new URL('../room_scanner_v30.html',import.meta.url),'utf8'),app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),runtime=fs.readFileSync(new URL('../js/probabilistic/single_optimizer_runtime.js',import.meta.url),'utf8');
  for(const id of ['optIterations','optStartBtn','optStopBtn','optProgress','savedSessions'])assert.match(html,new RegExp(`id="${id}"`));
  for(const token of ['fusion-persist','persistCurrentSession','loadSavedSession','single-opt-review-start','single-opt-review-accepted','single-opt-review-rejected','returnHomeFromReview'])assert.match(app,new RegExp(token));
  assert.match(runtime,/runCycle/);assert.match(runtime,/rebuildAccepted/);assert.match(runtime,/await yieldUi\(\)/);assert.match(runtime,/evaluateLiveCandidate/);
  assert.doesNotMatch(app,/workers\/gaussian_opt_worker|workers\/probabilistic_opt_worker/);
});
