'use strict';
function classify(runtimeSource, workerHref, runtimeVersion='1.23.2') {
  const runtimeURL = new URL(runtimeSource, workerHref);
  const workerURL = new URL(workerHref);
  const remote = runtimeURL.origin !== workerURL.origin;
  const localRuntimeDir = './vendor/depthai-123/';
  const wasmPaths = remote
    ? `https://cdn.jsdelivr.net/npm/onnxruntime-web@${runtimeVersion}/dist/`
    : new URL(localRuntimeDir, workerHref).href;
  return {remote,wasmPaths};
}
const worker='https://gioelegrecome.github.io/room_scanner/depth_ai_worker.js?rsbuild=1008m1';
const local='https://gioelegrecome.github.io/room_scanner/vendor/depthai-123/ort.webgpu.min.js?rsbuild=1008m1';
const cdn='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.webgpu.min.js';
const a=classify(local,worker), b=classify(cdn,worker);
if(a.remote!==false) throw new Error('same-origin runtime incorrectly classified remote');
if(a.wasmPaths!=='https://gioelegrecome.github.io/room_scanner/vendor/depthai-123/') throw new Error('same-origin wasmPaths incorrect: '+a.wasmPaths);
if(b.remote!==true) throw new Error('CDN runtime incorrectly classified local');
if(b.wasmPaths!=='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/') throw new Error('CDN wasmPaths incorrect: '+b.wasmPaths);
console.log(JSON.stringify({ok:true,sameOrigin:a,cdn:b},null,2));
