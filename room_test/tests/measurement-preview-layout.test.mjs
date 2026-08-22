import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('metric preview has no unused full-screen bridge canvas',()=>{
  const html=read('room_scanner_v30.html'),app=read('js/app.js');
  assert.doesNotMatch(html,/id=["']bridgeMap["']/);
  assert.doesNotMatch(app,/bridgeMap/);
});

test('pin guidance uses DOM rings, not a full-screen canvas',()=>{
  const g=read('js/xr/measurement_guidance.js');
  assert.match(g,/document\.createElement\('div'\)/);
  assert.match(g,/bridgePinRing/);
  assert.doesNotMatch(g,/createElement\('canvas'\)/);
  assert.doesNotMatch(g,/getContext\('2d'/);
});

test('bridge camera is forced to a real viewport-sized rectangle',()=>{
  const css=read('styles.css'),bridge=read('js/xr/metric_bridge.js');
  assert.match(css,/#bridge,#scan\{[\s\S]*height:100dvh!important/);
  assert.match(css,/#bridgeCamera,#camera\{[\s\S]*object-fit:cover!important/);
  assert.match(bridge,/function fitPreviewViewport\(video\)/);
  assert.match(bridge,/visualViewport/);
  assert.match(bridge,/height:height\+'px'/);assert.match(bridge,/video\.style\.setProperty\(k,v,'important'\)/);
  assert.match(bridge,/videoIntrinsic/);
  assert.match(bridge,/videoRect/);
});
