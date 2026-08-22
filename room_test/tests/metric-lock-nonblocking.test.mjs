import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('metric guidance cannot self-trigger a MutationObserver loop',()=>{
  const guidance=read('js/xr/measurement_guidance.js');
  assert.doesNotMatch(guidance,/new\s+MutationObserver\s*\(/);
  assert.match(guidance,/roomscan:metric-bridge-update/);
  assert.match(guidance,/text===lastInstruction/);
});

test('camera preview starts before optional measurement guidance',()=>{
  const app=read('js/app.js');
  const start=app.indexOf('await bridge.start()');
  const guide=app.indexOf("lazy('./xr/measurement_guidance.js')",start);
  assert.ok(start>=0,'bridge.start missing');
  assert.ok(guide>start,'measurement guidance still loads before camera start');
});

test('metric matcher has an explicit bounded work budget',()=>{
  const bridge=read('js/xr/metric_bridge.js');
  assert.match(bridge,/maxComparisons=520/);
  assert.match(bridge,/templates=\[\.\.\.common\.slice\(-2\),\.\.\.observed\.slice\(-2\),\.\.\.roi\.slice\(-4\)\]/);
  assert.match(bridge,/setTimeout\(\(\)=>this\._loop\(\),2[0-9]{2}\)/);
});

test('metric lock hands the existing camera stream to scan',()=>{
  const app=read('js/app.js'),bridge=read('js/xr/metric_bridge.js'),camera=read('js/camera.js');
  assert.match(bridge,/takeStream\(\)/);
  assert.match(app,/const sharedStream=bridge\?\.takeStream\?\.\(\)\|\|null/);
  assert.match(app,/new CameraController\([^;]*stream:sharedStream/);
  assert.match(camera,/adoptStream\(stream\)/);
});
