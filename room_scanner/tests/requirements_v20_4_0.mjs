import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),text=p=>readFile(new URL(p,root),'utf8');
const [cfg,capture,map,proc,recon,raw,ui,sw]=await Promise.all([
  text('js/config_v20_2_0.js'),text('js/xr_capture_v20_2_0.js'),text('workers/map_worker_v20_4_0.js'),text('workers/processing_worker_v20_4_0.js'),text('js/reconstruction_v20_4_0.js'),text('js/raw_export_v20_2_0.js'),text('js/processing_ui_v20_2_0.js'),text('sw_v20_2_0.js')
]);
assert.ok(cfg.includes("version: '20.4.0'")&&cfg.includes('depthIntervalMs')&&cfg.includes('mapBudgetCells: 220000'));
assert.ok(capture.includes('sampleCPUDepthRays')&&capture.includes("'depth-rays'")&&capture.includes("rayFormat:'RSRY-1'"));
assert.ok(capture.includes('info.data')&&capture.includes('normDepthBufferFromNormView'));
assert.ok(!capture.includes('sampleCPUDepth(info,view,this.profile.depthStride'));
assert.ok(capture.includes('dense-ray-backpressure')&&capture.includes('denseRgbIntervalMs'));
assert.ok(capture.includes('class GpuDepthReader')&&capture.includes("this.binding?.getDepthInformation?.(view)")&&capture.includes('xr-depth-gpu-dense-enabled'));
assert.ok(capture.includes('normDepthBufferFromNormView.matrix')&&capture.includes('u_rawToMeters')&&capture.includes('sampleGPUReadbackRays'));
assert.ok(!capture.includes('gpu-depth-kept-for-future-gpu-path'));
assert.ok(map.includes("voxel:.020")&&map.includes("kind:'point3d'")&&map.includes('rawRayCount'));
assert.ok(proc.includes('decodeRayBatchToPoints')&&proc.includes("b.kind==='depth-rays'")&&proc.includes('rawRaySamples'));
assert.ok(proc.includes('Math.min(maxSurfels,320000)')&&proc.includes('maxFrames=Math.max(64,Math.min(240'));
assert.ok(recon.includes("important?.018")&&recon.includes("format:'ROOMSCAN-MODEL-20.4'"));
assert.ok(raw.includes("b.kind==='depth-points'||b.kind==='depth-rays'")&&raw.includes('RSRY v1'));
assert.ok(ui.includes('processing_worker_v20_4_0.js'));
assert.ok(sw.includes('room-scanner-v20.4.0-dense-ray-shell')&&sw.includes('map_worker_v20_4_0.js'));
console.log('PASS requirements_v20_4_0');
