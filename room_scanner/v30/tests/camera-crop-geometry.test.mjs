import test from 'node:test';
import assert from 'node:assert/strict';
import {coverCrop,intrinsicsForCrop,analysisPixelToSource,sourcePixelToViewport} from '../js/camera.js';

test('camera analysis uses a central cover crop instead of stretching 16:9 into portrait',()=>{
  const g=coverCrop(1920,1080,320,480);
  assert.ok(Math.abs(g.sw-720)<1e-9);assert.ok(Math.abs(g.sx-600)<1e-9);assert.equal(g.sh,1080);
  const c=analysisPixelToSource(g,160,240);assert.ok(Math.abs(c.x-960)<1e-9&&Math.abs(c.y-540)<1e-9);
});

test('intrinsics and AR viewport mapping follow the same crop geometry',()=>{
  const g=coverCrop(1920,1080,320,480),K=intrinsicsForCrop({fxN:.5,fyN:.89,cxN:.5,cyN:.5},g);
  assert.ok(K.fx>400&&K.fx<440);assert.equal(K.cx,160);assert.equal(K.cy,240);
  const v=sourcePixelToViewport(g,960,540,390,844);assert.ok(Math.abs(v.x-195)<1e-6&&Math.abs(v.y-422)<1e-6);
});
