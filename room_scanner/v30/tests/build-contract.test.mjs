import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BUILD,CONFIG} from '../js/config.js';

const root=new URL('../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('all published identities are V30.10.2',()=>{
  const info=JSON.parse(read('build_info.json')),html=read('room_scanner_v30.html'),sw=read('sw.js');
  assert.equal(BUILD.version,'30.10.2');assert.equal(info.version,BUILD.version);assert.equal(info.id,BUILD.id);
  assert.match(html,/V30\.10\.2/);assert.match(sw,/room-scanner-v30\.10\.2-shell/);
});

test('real anchors are mandatory and self-test detects stale source',()=>{
  const xr=read('js/xr/xr_calibration.js'),self=read('js/self_test.js');
  assert.equal(CONFIG.xrRequireRealAnchors,true);assert.match(xr,/required\.push\('anchors'\)/);assert.match(xr,/createAnchor\(\)/);assert.match(xr,/frame\.trackedAnchors/);assert.match(xr,/anchor\.anchorSpace/);assert.match(self,/world-anchor-source/);
});

test('V30.8 static overlay bug is explicitly replaced by live progress UV',()=>{
  const xr=read('js/xr/xr_calibration.js');assert.match(xr,/seedUv:t\.state==='tracking'/);assert.match(xr,/\[-2,-2\]/);
});

test('manual placement, ROI atlas and measurement guidance are shipped',()=>{const xr=read('js/xr/xr_calibration.js'),ui=read('js/xr/xr_calibration_manual_ui.js'),measure=read('js/xr/measurement_guidance.js'),geom=read('js/metric/metric_geometry.js');assert.match(xr,/confirmManualPin/);assert.match(xr,/xr-pin-roi-view/);assert.match(ui,/Conferma pin/);assert.match(measure,/bridgePinGuidance/);assert.match(geom,/gaussianSurfaceSamples/);const boot=read('js/boot.js'),sw=read('sw.js');assert.match(boot,/gaussian_metric_tap\.js/);assert.match(boot,/metric_mesh_ui\.js/);assert.match(sw,/metric_mesh_worker\.js/);});
