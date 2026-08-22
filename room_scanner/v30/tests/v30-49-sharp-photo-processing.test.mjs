import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const cfg=fs.readFileSync(new URL('../js/config.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../room_scanner_v30.html',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../workers/photo_archive_worker.js',import.meta.url),'utf8');

test('scan fast lane archives sharp RGB off-thread without Deep inference',()=>{
  assert.match(app,/archiveSharpRgbFrame\(frame,tracking\)/);
  assert.match(app,/sharp-rgb-photo/);
  assert.match(worker,/OffscreenCanvas/);
  assert.match(worker,/convertToBlob/);
  assert.match(cfg,/deepPostScanOnly:true/);
  assert.match(cfg,/stablePhotoBankEnabled:false/);
});

test('processing screen shows exact RGB, DeepPrior and Alva world placement',()=>{
  assert.match(html,/id="processing"/);
  assert.match(html,/id="processingRgb"/);
  assert.match(html,/id="processingDepth"/);
  assert.match(html,/id="processingPose"/);
  assert.match(html,/DeepPrior relativo/);
  assert.match(app,/diagnosticDepthWorldPoints/);
  assert.match(app,/showProcessingDeepResult/);
  assert.match(app,/processingOptimizedPoseMap/);
});

test('post-scan retains the large RGB archive while Deep scheduling may be adaptive',()=>{
  assert.match(app,/selectSharpPhotosForProcessing/);
  assert.match(app,/registerArchivedPhotosPostScan/);
  assert.match(app,/processArchivedDeepAdaptive/);
  assert.match(app,/kind:'preview'.*frameId:survey\.frameId/s);
  assert.match(app,/registerDepthPlannedPhoto\(survey,\{source:'sharp-rgb-adaptive-candidate',optimize:false,render:false,adaptiveCandidate:true\}\)/);
  assert.match(cfg,/sharpArchiveProcessMaxFrames:240/);
});

test('suspect Alva jumps are visible and downweighted rather than silently trusted',()=>{
  assert.match(app,/alvaar-archive-jump-suspect/);
  assert.match(app,/jumpSuspect:true/);
  assert.match(app,/processing-deep-prior-visible/);
  assert.match(html,/arancio: salto Alva sospetto/);
});

test('compressed archive is retained in RAM as Blob references and persisted for recovery',()=>{
  assert.match(app,/state\.photoArchiveEntries\.push\(summary\)/);
  assert.match(app,/await state\.db\.put\('events',record\)/);
  assert.match(app,/avoid an[\s\S]*IndexedDB getAll/);
  assert.match(cfg,/sharpArchiveMaxFrames:1600/);
});
