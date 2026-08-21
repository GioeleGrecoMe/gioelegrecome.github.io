import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const live=fs.readFileSync(new URL('../js/reconstruction/live_photo_puzzle.js',import.meta.url),'utf8'),view=fs.readFileSync(new URL('../js/reconstruction/view_puzzle.js',import.meta.url),'utf8'),photo=fs.readFileSync(new URL('../js/reconstruction/photo_panorama.js',import.meta.url),'utf8'),app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../room_scanner_v30.html',import.meta.url),'utf8'),index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');

test('live and post-scan mosaics are image-only: no Alva/epipolar authority',()=>{
  for(const s of [live,view]){assert.match(s,/matchPhotoFeatures/);assert.match(s,/buildPhotoRegistrationEdge/);assert.doesNotMatch(s,/matchProbabilisticFeatures/);}assert.match(photo,/No pose, no epipolar gate, no Alva feature authority/);assert.doesNotMatch(photo,/slam\/math|feature_tracker/);assert.match(photo,/solvePhotoMosaic/);assert.match(photo,/buildLocalMosaicWarp/);assert.match(live,/photoOnlyMosaic:true/);
});

test('photo acquisition survives missing Alva tracking and detects features on the frozen photo',()=>{
  assert.match(app,/state\.liveMap\.addCameraFrame\(survey/);assert.match(app,/const hasAlva=!!\(tracking\?\.trackingValid/);assert.doesNotMatch(app,/if\(!state\.liveMap\|\|!state\.scanK\|\|!tracking\?\.trackingValid/);assert.match(live,/detectPhotoFeatures\(gray,w,h/);assert.match(live,/pose:clonePoseNullable/);
});

test('measurement GUI keeps diagnostics in one collapsible dock over a full-screen camera',()=>{for(const id of ['scanDiagnosticsToggle','scanDiagnostics','scanDiagnosticsClose','liveMapCanvas','depthOverlay','coverageSphere']){assert.match(html,new RegExp(`id="${id}"`));assert.match(index,new RegExp(`id="${id}"`));}assert.match(css,/#scan \.scanDiagnostics\.open/);assert.match(css,/transform:translateX/);assert.match(app,/setScanDiagnosticsOpen/);});

test('.r30 stores the pure photo mosaic plus optional Alva metadata for later geometry',()=>{assert.match(app,/photoPanorama/);assert.match(app,/evidence:\{factorGraph,deepSequence,photoPanorama\}/);assert.match(live,/alvaPose:clonePoseNullable\(f\.pose\)/);assert.match(live,/mosaicTransforms:/);assert.doesNotMatch(live,/visualQ:Array\.from/);});
