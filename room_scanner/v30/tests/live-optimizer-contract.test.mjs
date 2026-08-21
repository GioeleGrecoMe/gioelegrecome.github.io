import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DiagnosticsLog} from '../js/logger.js';
import {CONFIG} from '../js/config.js';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('live optimisation uses a dedicated worker, accepted/working split and visible HUD',()=>{
  const app=read('js/app.js'),worker=read('workers/live_probabilistic_worker.js'),html=read('room_scanner_v30.html');
  assert.equal(CONFIG.liveProbabilisticOptimization,true);assert.match(app,/liveOptAccepted/);assert.match(app,/live-opt-candidate-rejected/);assert.match(app,/previewMap:\!\!slow/);assert.match(worker,/evaluateLiveCandidate/);assert.match(worker,/acceptedSnapshot/);assert.match(worker,/previewGaussians/);assert.match(html,/id="liveOptimizerHud"/);
});

test('structured diagnostics preserve checkpoints, monotonic sequence and runtime context',()=>{
  const log=new DiagnosticsLog({maxEntries:8,maxCheckpoints:4,build:{version:'test'}});log.setContextProvider(()=>({optimizer:{accepted:2,rejected:1}}));log.info('live-opt-dispatch',{generation:1});log.decision('live-opt-candidate-accepted',{generation:1,score:.2});log.checkpoint('accepted',{generation:1,accepted:true});const s=log.snapshot();
  assert.equal(s.format,'ROOMSCAN-V30-DIAGNOSTICS-2');assert.equal(s.entries.length,3);assert.ok(s.entries[1].seq>s.entries[0].seq);assert.equal(s.runtime.optimizer.accepted,2);assert.equal(s.checkpoints[0].name,'accepted');assert.equal(s.summary.eventCount,3);assert.ok(s.summary.byScope.optimizer>=2);assert.match(log.ndjson(),/live-opt-candidate-accepted/);
});
