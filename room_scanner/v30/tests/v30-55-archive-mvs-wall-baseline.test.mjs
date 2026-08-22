import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPostScanArchiveMvsPlan} from '../js/reconstruction/postscan_mvs_plan.js';
import {buildPipelineTestSnapshot} from '../js/reconstruction/pipeline_diagnostics.js';

const K={fx:120,fy:120,cx:80,cy:120,width:160,height:240};
function frame(i){return {id:`f-${i}`,frameId:`f-${i}`,at:i*500,pose:{p:[i*.025,0,0],q:[0,0,0,1]},K,gray:new Uint8Array(160*240),rgba:new Uint8ClampedArray(160*240*4),features:[{x:80,y:120,desc:[1,2,3]}],trackingValid:true,photoQuality:{stableQuality:.8,detail:12}};}

test('archive MVS planner uses the full photo archive rather than sparse acquisition jobs',()=>{
  const plan=buildPostScanArchiveMvsPlan(Array.from({length:28},(_,i)=>frame(i)),{maxJobs:24,minSources:2,maxSources:4,minBaseline:.014,maxBaseline:1.5,maxAngleRad:.38});
  assert.equal(plan.stats.eligible,28);
  assert.ok(plan.stats.planned>=20,`expected broad archive coverage, got ${plan.stats.planned}`);
  assert.ok(plan.jobs.every(j=>j.sources.length>=2));
  assert.ok(plan.jobs.every(j=>j.ref.K.width===160&&j.ref.K.height===240));
});

test('wall baseline is the first actionable diagnostic when archive MVS coverage is insufficient',()=>{
  const out=buildPipelineTestSnapshot({photoArchive:{accepted:52},dense:{archivePlan:{eligible:52,planned:5,queued:5,meanSources:3,minSources:2}},surface:{mvsValidation:{input:682,committed:146}}});
  const wall=out.stages.find(x=>x.name==='Parete con oggetti · baseline');
  assert.equal(wall.status,'fail');
  assert.match(wall.reasons.join(' '),/Solo 5 viste MVS/);
  assert.equal(out.firstFailure.name,'Parete con oggetti · baseline');
});
