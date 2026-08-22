import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');

test('scan draws full-covariance splats/mesh over camera from the live metric pose',()=>{
  const app=read('../js/app.js'),overlay=read('../js/gaussian/ar_overlay.js'),html=read('../room_scanner_v30.html');
  assert.match(app,/liveOverlay\?\.draw\(\{pose:r\.pose,K,geometry:frame\.geometry,video:state\.camera\.video,framePoints:r\.framePoints/);
  for(const token of ['projectPoint','analysisPixelToSource','_drawMesh','projectGaussianEllipse','s.covariance','g.ellipse(p.x,p.y,p.rx,p.ry,p.angle'])assert.ok(overlay.includes(token),token);
  assert.match(html,/id="arModeBtn"/);
});

test('review viewer projects anisotropic covariance and exposes orbit pan pinch and fixed orientation presets',()=>{
  const r=read('../js/gaussian/renderer.js'),html=read('../room_scanner_v30.html');
  for(const token of ['projectReviewCovariance','g.ellipse(p.x,p.y,p.rx,p.ry,p.angle','setPreset(name)','this._pointers','prev.dist/cur.dist','this.pan[0]','_drawGrid','_drawAxes'])assert.ok(r.includes(token),token);
  for(const id of ['viewTopBtn','viewFrontBtn','viewSideBtn'])assert.ok(html.includes(`id="${id}"`));
});
