import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const live=fs.readFileSync(new URL('../js/reconstruction/live_photo_puzzle.js',import.meta.url),'utf8');
const view=fs.readFileSync(new URL('../js/reconstruction/view_puzzle.js',import.meta.url),'utf8');
const photo=fs.readFileSync(new URL('../js/reconstruction/photo_panorama.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../room_scanner_v30.html',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');

test('live and post-scan panorama registration are photo-first rather than Alva-epipolar-gated',()=>{
  assert.match(live,/matchPhotoFeatures/);assert.match(live,/buildPhotoRegistrationEdge/);assert.doesNotMatch(live,/matchProbabilisticFeatures/);
  assert.match(view,/matchPhotoFeatures/);assert.doesNotMatch(view,/matchProbabilisticFeatures/);assert.match(photo,/Deliberately does NOT use the Alva pose as an epipolar gate/);assert.match(photo,/buildLocalPanoramaWarp/);assert.match(live,/localWarp/);
});

test('measurement GUI keeps diagnostics in one collapsible dock over a full-screen camera',()=>{
  for(const id of ['scanDiagnosticsToggle','scanDiagnostics','scanDiagnosticsClose','liveMapCanvas','depthOverlay','coverageSphere']){assert.match(html,new RegExp(`id="${id}"`));assert.match(index,new RegExp(`id="${id}"`));}
  assert.match(css,/#scan \.scanDiagnostics\.open/);assert.match(css,/transform:translateX/);assert.match(app,/setScanDiagnosticsOpen/);
});

test('.r30 and local snapshots retain photo/pose/depth evidence for later pose correction',()=>{
  assert.match(app,/photoPanorama/);assert.match(app,/evidence:\{factorGraph,deepSequence,photoPanorama\}/);assert.match(app,/ROOMSCAN-PUZZLE-SESSION-5/);assert.match(live,/alvaPose:clonePose\(f\.pose\)/);assert.match(live,/visualQ:Array\.from/);
});
