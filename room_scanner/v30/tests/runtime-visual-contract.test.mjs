import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');

test('all visual runtime hosts are present in the published HTML',()=>{
  const html=read('../room_scanner_v30.html');
  for(const id of ['calibOverlay','calibAddPinBtn','calibUndoPinBtn','calibFinishBtn','bridgePinGuidance','bridgePinInstructions','miniMap','metricPipelineHud','metricGsStats','buildMetricMeshBtn','alvaPtsState'])
    assert.match(html,new RegExp(`id=["']${id}["']`),`missing ${id}`);
});

test('WebXR anchor placement does not require raw camera access',()=>{
  const xr=read('../js/xr/xr_calibration.js');
  assert.doesNotMatch(xr,/const required=\[[^\]]*camera-access/);
  assert.match(xr,/optionalFeatures:optional/);
  assert.match(xr,/camera\?\.width\|\|vp\?\.width/);
  assert.match(xr,/patch=patch\|\|\{patch:new Uint8Array\(0\)/);
  assert.match(xr,/if\(!texture\)return \{id:point\.id,uv:/);
});

test('Alva is not compiled in background during home or WebXR calibration',()=>{
  const app=read('../js/app.js');
  const init=app.match(/async function initBackground\(\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.doesNotMatch(init,/prefetchOfficialAlvaRuntime/);
  assert.match(app,/createAlvaFrontend/);
});

test('live AR overlay always exposes Alva tracking points and a persistent repere',()=>{
  const overlay=read('../js/gaussian/ar_overlay.js'),app=read('../js/app.js'),slam=read('../js/slam/slam_engine.js');
  assert.match(overlay,/_drawAlvaPoints/);
  assert.match(overlay,/_drawReference/);
  assert.match(overlay,/setReferencePoint/);
  assert.match(app,/framePoints:r\.framePoints\|\|\[\]/);
  assert.match(slam,/framePoints:Array\.from\(r\.framePoints\|\|\[\]\)/);
});


test('scale-free Alva world still feeds dense depth, surface fusion and live mesh',()=>{
  const app=read('../js/app.js');
  assert.doesNotMatch(app,/r\.newKeyframe&&r\.metricLocked/);
  assert.match(app,/denseMinBaselineAlva/);
  assert.match(app,/queueDenseKeyframe/);
  assert.match(app,/denseFusionWorker/);
  assert.match(app,/surface-result/);
});
