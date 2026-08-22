#!/usr/bin/env node
/**
 * Room Scanner V30.18.4 app.js patcher.
 *
 * Run from the repository root:
 *   node room_scanner/v30/tools/apply_v30_18_4_patch.mjs
 * or pass an explicit app.js path.
 *
 * The patch is deliberately marker-based rather than line-number based so it
 * remains safe after small formatting changes around the target functions.
 */
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.argv[2] || 'room_scanner/v30/js/app.js');
if (!fs.existsSync(appPath)) throw new Error(`app.js non trovato: ${appPath}`);
let s = fs.readFileSync(appPath, 'utf8');
const original = s;

function replaceBetween(startMarker, endMarker, replacement, label) {
  const a = s.indexOf(startMarker);
  if (a < 0) throw new Error(`marker iniziale non trovato (${label}): ${startMarker}`);
  const b = s.indexOf(endMarker, a + startMarker.length);
  if (b < 0) throw new Error(`marker finale non trovato (${label}): ${endMarker}`);
  s = s.slice(0, a) + replacement.trimEnd() + '\n' + s.slice(b);
}

// Cache-bust the worker independently from BUILD.version so a stale service
// worker cannot keep serving a previous Deep worker while app.js is current.
replaceBetween(
  'function ensureDeepWorker(){',
  'function heatColor',
  `function ensureDeepWorker(){
  if(state.deepDepthWorker)return state.deepDepthWorker;
  const worker=new Worker(\`${'${CONFIG.deepDepthWorker}'}?v=${'${BUILD.version}'}-deep-30.18.4\`,{type:'module'});
  state.deepDepthWorker=worker;state.deepWorkerModelId=null;
  worker.postMessage({type:'init',config:deepWorkerConfig()});
  return worker;
}
`,
  'ensureDeepWorker',
);

// The pre-scan test now shows the WASM shadow result when the A/B diagnostic
// detects a likely WebGPU-Q4F16 corruption. It also reports correlation and
// stripe ratios, so the diagnosis is visible without opening DevTools.
replaceBetween(
  'async function testDeepModel(){',
  'async function chooseDeepModel',
  `async function testDeepModel(){
  const button=$('testDeepBtn');if(button)button.disabled=true;
  updateDeepModelUi('Apro la camera e confronto WebGPU/WASM sullo stesso frame…');
  try{
    const frame=await captureDepthTestFrame(),worker=ensureDeepWorker(),jobId=\`test-${'${Date.now()}'}\`;
    const result=await workerRequest(worker,{type:'test',jobId,model:modelForWorker(),...frame},d=>(d.type==='deep-test-result'||d.type==='deep-error')&&d.jobId===jobId,120000);
    if(!result)throw new Error('timeout inferenza ONNX (120 s)');
    if(result.type==='deep-error')throw new Error(result.message||'inferenza ONNX fallita');
    state.deepWorkerModelId=selectedDeepModel().id;
    const diag=result.providerDiagnostic||null;
    const showWasm=!!(diag?.webgpuLikelyCorrupt&&result.wasmPreviewDepth?.length);
    drawDepth($('deepTestPreview'),showWasm?result.wasmPreviewDepth:result.rawDepth,showWasm?result.wasmPreviewWidth:result.rawWidth,showWasm?result.wasmPreviewHeight:result.rawHeight);
    let suffix='';
    if(diag?.attempted&&!diag.failed){
      const corr=Number(diag.comparison?.correlation);
      const gpuStripe=Number(diag.webgpu?.stripe?.ratio);
      const wasmStripe=Number(diag.wasm?.stripe?.ratio);
      suffix=diag.webgpuLikelyCorrupt
        ? \` · ⚠ WebGPU Q4F16 sospetto · corr ${'${Number.isFinite(corr)?corr.toFixed(2):"—"}'} · stripe GPU/WASM ${'${Number.isFinite(gpuStripe)?gpuStripe.toFixed(1):"—"}'}/${'${Number.isFinite(wasmStripe)?wasmStripe.toFixed(1):"—"}'} · preview=WASM\`
        : \` · A/B ok · corr ${'${Number.isFinite(corr)?corr.toFixed(2):"—"}'} · WASM ${'${Number(diag.wasm?.ms||0).toFixed(0)}'} ms\`;
    }else if(diag?.failed){suffix=\` · A/B WASM non disponibile: ${'${diag.message||"errore"}'}\`;}
    updateDeepModelUi(\`✓ ${'${selectedDeepModel().label}'} verificato · ${'${result.provider}'} · ${'${result.rawWidth}'}×${'${result.rawHeight}'} · ${'${result.ms.toFixed(0)}'} ms${'${suffix}'}\`,diag?.webgpuLikelyCorrupt?'warn':'ok');
    log.info('deep-model-test',{model:selectedDeepModel().label,provider:result.provider,ms:result.ms,output:[result.rawWidth,result.rawHeight],frameSignature:result.frameSignature,depthSignature:result.depthSignature,diagnostic:diag});
  }catch(err){updateDeepModelUi(\`Modello non utilizzabile: ${'${err?.message||err}'}\`,'error');throw err;}
  finally{if(button)button.disabled=false;}
}
`,
  'testDeepModel',
);

// Decouple the live preview request from DenseKeyframeManager availability.
// Normally the request is still attached to a real Alva keyframe (~1 Hz), so
// its result can be reused by dense reconstruction. A watchdog request is used
// only if no keyframe has arrived for >2.2 s while tracking remains valid.
const oldLoop = "if(r.newKeyframe&&r.trackingValid)queueDenseKeyframe(r.newKeyframe,frame,K);";
const newLoop = "if(r.trackingValid&&(r.newKeyframe||performance.now()-state.deepLastRequestAt>2200))requestLiveDepth(r.newKeyframe,frame,r);if(r.newKeyframe&&r.trackingValid)queueDenseKeyframe(r.newKeyframe,frame,K);";
if (!s.includes(oldLoop) && !s.includes(newLoop)) throw new Error('scan loop target non trovato');
s = s.replace(oldLoop, newLoop);

replaceBetween(
  'async function queueDenseKeyframe(kf,frame,K){',
  'async function scheduleDenseWork',
  `async function queueDenseKeyframe(kf,frame,K){
  if(!state.denseManager||!state.denseDepthWorker)return;
  state.denseManager.add(kf,frame,K,{metricLocked:!!state.slam?.metricLocked});
  await scheduleDenseWork();
}
function requestLiveDepth(kf,frame,tracking=null){
  const worker=state.deepDepthWorker,now=performance.now();
  if(state.deepDisabled||!worker||state.deepLivePending||now-state.deepLastRequestAt<(CONFIG.deepInferenceIntervalMs||1000))return;
  const keyframeBound=!!kf?.id;
  const refId=keyframeBound?kf.id:\`preview-${'${tracking?.frame??"x"}'}-${'${Math.round(frame.at||now)}'}\`;
  state.deepLastRequestAt=now;state.deepCalls++;state.deepLivePending={refId,at:now,keyframeBound};
  // Copy before transfer: Alva/dense still own the camera raster.
  const rgba=new Uint8ClampedArray(frame.rgba);
  worker.postMessage({type:'infer',jobId:\`live-${'${refId}'}\`,refId,model:modelForWorker(),rgba,width:frame.width,height:frame.height},[rgba.buffer]);
  if($('mvsState'))$('mvsState').textContent=\`AI locale ${'${state.deepCalls}'} · ${'${keyframeBound?"keyframe":"preview watchdog"}'} · Alva continua\`;
  log.info('deep-live-request',{refId,keyframeBound,calls:state.deepCalls,width:frame.width,height:frame.height});
}
`,
  'live depth scheduling',
);

// Make changing input/output fingerprints visible in the normal scan log/UI.
const statusOld = "if($('mvsState'))$('mvsState').textContent=`AI ${d.provider} · depth ${d.rawWidth}×${d.rawHeight} · ${d.ms.toFixed(0)} ms`;log.info('deep-live-result',{refId:d.refId,provider:d.provider,ms:d.ms,output:[d.rawWidth,d.rawHeight]});";
const statusNew = "if($('mvsState'))$('mvsState').textContent=`AI ${d.provider} · depth ${d.rawWidth}×${d.rawHeight} · ${d.ms.toFixed(0)} ms · src ${d.frameSignature||'—'} → z ${d.depthSignature||'—'}`;log.info('deep-live-result',{refId:d.refId,provider:d.provider,ms:d.ms,output:[d.rawWidth,d.rawHeight],frameSignature:d.frameSignature,depthSignature:d.depthSignature,spatialStats:d.spatialStats,layoutFix:d.layoutFix});";
if (s.includes(statusOld)) s = s.replace(statusOld, statusNew);
else if (!s.includes('frameSignature:d.frameSignature')) console.warn('WARN: status live non patchato; il core scheduler è comunque stato aggiornato.');

if (s === original) throw new Error('nessuna modifica applicata');
const backup = `${appPath}.bak-v30.18.4`;
if (!fs.existsSync(backup)) fs.writeFileSync(backup, original);
fs.writeFileSync(appPath, s);
console.log(`OK: patch applicata a ${appPath}`);
console.log(`Backup: ${backup}`);
console.log('Ora esegui: node --check ' + appPath);
