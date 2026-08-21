/**
 * Room Scanner V30.38.0 continuous RGB+Depth mosaic application.
 *
 * BOOT CONTRACT
 * -------------
 * Only config + logger are static imports. UI handlers are bound immediately.
 * Storage, WebXR, camera, SLAM, diagnostics and metric extensions are imported
 * lazily after the page is already interactive. A failure in an optional module
 * therefore cannot leave the visible page with dead buttons.
 */
import {BUILD,CONFIG} from './config.js?v=30.38.0';
import {DiagnosticsLog} from './logger.js?v=30.38.0';

const $=id=>document.getElementById(id);
const log=new DiagnosticsLog({build:BUILD});
const state={db:null,calibrator:null,bridge:null,bridgeStable:0,bridgeEpoch:0,bridgeTransition:false,alvaBootstrap:null,camera:null,frontend:null,slam:null,denseManager:null,denseDepthWorker:null,denseFusionWorker:null,deepDepthWorker:null,deepWorkerModelId:null,deepSelector:null,deepPending:null,deepModel:null,deepDisabled:false,deepCalls:0,deepAccepted:0,deepPreviewLastAt:0,photoSurveyLastAt:0,deepPreviewInFlight:null,deepPreviewSeq:0,deepPreviewFrames:0,deepPreviewLastQuality:null,deepSync:null,deepJobs:new Map(),deepSyncRejected:0,denseBusy:false,denseActivePayload:null,denseJobs:0,denseDepthSamples:0,denseDepthHint:null,densePixelStep:null,denseSourceLimit:null,surfaceStats:null,mesh:null,meshStale:false,geometryCommitted:false,gaussians:[],optimizerObservations:null,probGraph:null,deepSequence:null,probOptimization:null,probOptimized:null,optimization:{iterations:0,lastEnergy:null},postOptWorker:null,postOptBusy:false,postOptRunBase:0,reviewMetricLocked:null,reviewKeyframes:0,renderer:null,currentSession:null,scanStop:null,liveOverlay:null,scanK:null,lastFrameGeometry:null,lastTracking:null,geometryAnchors:[],alvaHeartbeatFrames:[],alvaHeartbeatCount:0,surfaceLab:{worker:null,busy:false,active:false,iterations:0,previewGaussians:null,mesh:null,lastStats:null,baseSignature:null,target:0,voxelM:null},coverageSphere:null,coverageApi:null,coverageStatus:null,puzzleWorker:null,puzzleBusy:false,puzzleRunBase:0,puzzleReconstruction:null,puzzlePreview:null,puzzleActive:false,puzzleAtlas:null,puzzleStats:null,liveMap:null,liveMapApi:null,liveMapMode:'photo',liveMapStats:null,liveMapRenderPending:false,photoPanoramaState:null,frameQualityApi:null,liveOptWorker:null,liveOptReady:false,liveOptInFlight:false,liveOptDirty:false,liveOptPendingSlow:false,liveOptTimer:null,liveOptGeneration:0,liveOptAccepted:null,liveOptStats:null,liveOptGate:null,liveOptLastAt:0,liveOptLastReason:null,liveOptAcceptedAnchors:[],liveOptPreviewGaussians:[],liveOptPreviewStats:null,liveOptRejected:0,liveOptAcceptedCount:0,liveOptBackoff:1,liveOptLastElapsedMs:0};
window.RoomScanV30={BUILD,CONFIG,state,log};
log.setContextProvider(()=>({screen:document.querySelector('.screen.active')?.id||null,tracking:{mode:state.lastTracking?.trackingMode||null,valid:!!state.lastTracking?.trackingValid,frameId:state.lastTracking?.frameId||null},graph:state.probGraph?.summary?.()||null,liveMap:state.liveMap?.stats?.()||state.liveMapStats||null,liveOptimizer:{ready:state.liveOptReady,inFlight:state.liveOptInFlight,generation:state.liveOptGeneration,accepted:state.liveOptAcceptedCount,rejected:state.liveOptRejected,lastReason:state.liveOptLastReason,stats:state.liveOptStats,gate:state.liveOptGate},deep:{calls:state.deepCalls,accepted:state.deepAccepted,syncRejected:state.deepSyncRejected,pending:state.deepJobs?.size||0},dense:{busy:state.denseBusy,jobs:state.denseJobs,samples:state.denseDepthSamples},surface:state.surfaceStats||null}));
globalThis.addEventListener?.('error',e=>{log.error('runtime-window-error',{message:e?.message||String(e?.error||'window error'),filename:e?.filename||null,line:e?.lineno||null,column:e?.colno||null,stack:e?.error?.stack||null});log.checkpoint('window-error',{message:e?.message||null,graph:state.probGraph?.summary?.()||null,liveOptimizer:state.liveOptStats||null});persistEmergencyDiagnostics('window-error');});
globalThis.addEventListener?.('unhandledrejection',e=>{const r=e?.reason;log.error('runtime-unhandled-rejection',{message:r?.message||String(r),stack:r?.stack||null});log.checkpoint('unhandled-rejection',{message:r?.message||String(r),graph:state.probGraph?.summary?.()||null,liveOptimizer:state.liveOptStats||null});persistEmergencyDiagnostics('unhandled-rejection');});
globalThis.addEventListener?.('pagehide',()=>persistEmergencyDiagnostics('pagehide'));
document.addEventListener?.('visibilitychange',()=>{log.debug('runtime-visibility',{state:document.visibilityState});if(document.visibilityState==='hidden')persistEmergencyDiagnostics('hidden');});
const EMERGENCY_DIAG_KEY='roomscan-v30-emergency-diagnostics-2';
function persistEmergencyDiagnostics(reason){try{const snapshot=log.snapshot({emergency:true,reason,entries:log.entries.slice(-1200),checkpoints:log.checkpoints.slice(-80)});localStorage.setItem(EMERGENCY_DIAG_KEY,JSON.stringify(snapshot));}catch{}}
function restoreEmergencyDiagnostics(){try{const raw=localStorage.getItem(EMERGENCY_DIAG_KEY);if(!raw)return;const previous=JSON.parse(raw);log.attachPrevious(previous);log.warn('previous-emergency-diagnostics',{reason:previous?.reason||null,createdAt:previous?.createdAt||null,entries:previous?.entries?.length||0,checkpoints:previous?.checkpoints?.length||0,build:previous?.build?.id||previous?.build||null});localStorage.removeItem(EMERGENCY_DIAG_KEY);}catch{}}
restoreEmergencyDiagnostics();
const moduleCache=new Map();
function lazy(path){if(!moduleCache.has(path))moduleCache.set(path,import(`${path}?v=${BUILD.version}`));return moduleCache.get(path);}
function safe(name,fn){return async(...args)=>{try{return await fn(...args)}catch(err){log.error(name,{message:err?.message||String(err),stack:err?.stack||null});log.checkpoint('handled-operation-error',{reason:name,message:err?.message||String(err),graph:state.probGraph?.summary?.()||null,liveOptimizer:state.liveOptStats||null});persistEmergencyDiagnostics(`handled:${name}`);showError(err?.message||String(err));return null;}};}
function on(id,type,handler,options){const el=$(id);if(!el){log.warn('ui-missing-control',{id,type});return null;}el.addEventListener(type,handler,options);return el;}
function show(id){for(const el of document.querySelectorAll('.screen'))el.classList.toggle('active',el.id===id);document.body.classList.toggle('immersive-ui',id!=='home'&&id!=='review');}
function showError(message){const s=$('homeStatus');if(s){s.dataset.kind='error';s.textContent=message;}const d=$('diagPanel');if(d)d.open=true;}
function migrateLegacyCalibration(c){
  if(!c||c.coordinateConvention!==' +X right +Y up +Z forward'.trim())return c;
  const flipP=a=>Array.isArray(a)&&a.length>=3?[+a[0],-a[1],+a[2]]:a;
  const flipQ=q=>Array.isArray(q)&&q.length>=4?[-q[0],q[1],-q[2],q[3]]:q;
  const pose=o=>{if(o?.p)o.p=flipP(o.p);if(o?.q)o.q=flipQ(o.q);return o;};
  for(const a of c.anchors||[]){a.p=flipP(a.p);for(const o of a.observations||[])pose(o.pose);}
  for(const o of c.objects||[])for(const v of o.roiViews||[]){v.worldCenter=flipP(v.worldCenter);pose(v.pose);}
  pose(c.pose);pose(c.commonView?.pose);for(const x of c.poseCoverage||[])pose(x.pose);
  c.coordinateConvention='+X right +Y down +Z forward (RH/CV)';c.migratedFrom='+X right +Y up +Z forward';return c;
}
function calibration(){try{const x=JSON.parse(localStorage.getItem(CONFIG.calibrationStorageKey)||'null'),c=x?.calibration||x?.value||x;return migrateLegacyCalibration(c);}catch{return null;}}
function saveCalibration(c){localStorage.setItem(CONFIG.calibrationStorageKey,JSON.stringify({format:'ROOMSCAN-V30-CALIBRATION-PROFILE-1',savedAt:Date.now(),build:BUILD.id,calibration:c}));updateCalibrationUi();}
function defaultDeepModel(){return {id:'bundled-depth-anything-v2-small-q4',label:CONFIG.deepModelLabel||'Depth Anything V2 Small Q4 locale',url:new URL(`../${CONFIG.deepModelUrl}`,import.meta.url).href};}
function selectedDeepModel(){return state.deepModel||defaultDeepModel();}
function deepWorkerConfig(){return {modelUrl:selectedDeepModel().url||CONFIG.deepModelUrl,modelRemoteUrl:CONFIG.deepModelRemoteUrl||null,ortLocal:CONFIG.deepOrtLocal,ortRemote:CONFIG.deepOrtRemote,inputMaxSide:CONFIG.deepInputMaxSide||518,preferredShortSide:CONFIG.deepPreferredShortSide||224,compatibilityShortSide:CONFIG.deepCompatibilityShortSide||280,qualityRescueShortSide:CONFIG.deepQualityRescueShortSide||280,qualityMaxRescueShortSide:CONFIG.deepQualityMaxRescueShortSide||336,wasmNumThreads:Number.isFinite(CONFIG.deepWasmThreads)?CONFIG.deepWasmThreads:0,testFlipCheck:CONFIG.deepTestFlipCheck===true};}
function updateDeepModelUi(message=null,kind=''){const el=$('deepModelStatus');if(!el)return;el.dataset.kind=kind;el.textContent=message||`Modello: ${selectedDeepModel().label}.`;}
function modelForWorker(){const m=selectedDeepModel();return m.bytes?(state.deepWorkerModelId===m.id?{id:m.id,label:m.label}:{id:m.id,label:m.label,bytes:m.bytes.slice(0)}):{id:m.id,label:m.label,url:m.url};}
function ensureDeepWorker(){if(state.deepDepthWorker)return state.deepDepthWorker;const worker=new Worker(`${CONFIG.deepDepthWorker}?v=${BUILD.version}`,{type:'module'});state.deepDepthWorker=worker;state.deepWorkerModelId=null;worker.postMessage({type:'init',config:deepWorkerConfig()});return worker;}
function heatColor(t){const x=Math.max(0,Math.min(1,t)),r=Math.round(255*Math.max(0,Math.min(1,1.8-Math.abs(4*x-3)))),g=Math.round(255*Math.max(0,Math.min(1,1.8-Math.abs(4*x-2)))),b=Math.round(255*Math.max(0,Math.min(1,1.8-Math.abs(4*x-1))));return [r,g,b];}
function drawDepth(canvas,raw,width,height){if(!canvas||!raw?.length||!(width>1&&height>1))return;const values=[];for(const v of raw)if(Number.isFinite(v))values.push(v);if(values.length<8)return;values.sort((a,b)=>a-b);const lo=values[Math.floor(values.length*.03)],hi=values[Math.floor(values.length*.97)];if(!(hi>lo))return;const rect=canvas.getBoundingClientRect(),dpr=Math.min(2,globalThis.devicePixelRatio||1),cw=Math.max(1,Math.round(rect.width*dpr)||width),ch=Math.max(1,Math.round(rect.height*dpr)||height);if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}const tiny=document.createElement('canvas');tiny.width=width;tiny.height=height;const tg=tiny.getContext('2d'),image=tg.createImageData(width,height);for(let i=0;i<raw.length&&i<width*height;i++){const c=heatColor((raw[i]-lo)/(hi-lo)),j=i*4;image.data[j]=c[0];image.data[j+1]=c[1];image.data[j+2]=c[2];image.data[j+3]=Number.isFinite(raw[i])?220:0;}tg.putImageData(image,0,0);const g=canvas.getContext('2d');g.clearRect(0,0,cw,ch);g.imageSmoothingEnabled=true;g.drawImage(tiny,0,0,cw,ch);}
async function captureDepthTestFrame(){
  const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480},frameRate:{ideal:12,max:15}}}),video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
  try{
    await video.play();const until=performance.now()+2200;while(!(video.videoWidth>1&&video.videoHeight>1)&&performance.now()<until)await new Promise(resolve=>setTimeout(resolve,40));if(!(video.videoWidth>1&&video.videoHeight>1))throw new Error('la camera non ha fornito un fotogramma per il test');
    // The diagnostic does not need the native sensor raster. Downsample before
    // getImageData so a 1080p/4K camera cannot spend memory/time copying pixels
    // that the 224/280-px neural profiles would immediately discard anyway.
    const vw=video.videoWidth,vh=video.videoHeight,maxSide=Math.max(224,CONFIG.deepTestCaptureMaxSide||480),scale=Math.min(1,maxSide/Math.max(vw,vh)),w=Math.max(2,Math.round(vw*scale)),h=Math.max(2,Math.round(vh*scale)),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const g=canvas.getContext('2d',{willReadFrequently:true});g.drawImage(video,0,0,w,h);const image=g.getImageData(0,0,w,h);return {rgba:image.data,width:w,height:h};
  }finally{video.pause();video.srcObject=null;for(const t of stream.getTracks())try{t.stop()}catch{}}
}
async function testDeepModel(){const button=$('testDeepBtn');if(button)button.disabled=true;updateDeepModelUi('Apro la camera e carico il modello ONNX…');try{const frame=await captureDepthTestFrame(),worker=ensureDeepWorker(),jobId=`test-${Date.now()}`,result=await workerRequest(worker,{type:'test',jobId,model:modelForWorker(),...frame},d=>(d.type==='deep-test-result'||d.type==='deep-error')&&d.jobId===jobId,90000);if(!result)throw new Error('timeout inferenza ONNX (90 s)');if(result.type==='deep-error')throw new Error(result.message||'inferenza ONNX fallita');state.deepWorkerModelId=(result.automaticSafeFallback&&selectedDeepModel().bytes)?null:selectedDeepModel().id;drawDepth($('deepTestPreview'),result.rawDepth,result.rawWidth,result.rawHeight);const total=Number(result.totalMs||result.ms||0),steady=Number(result.ms||0),q=result.quality||{},stripe=q.stripe||{},healthy=!q.suspicious,rescued=!!result.resolutionRescue?.accepted;const qualityText=healthy?'struttura OK':stripe.suspicious?`ATTENZIONE banding ${(100*(stripe.dominantExplained||0)).toFixed(0)}% · cicli ${Number(stripe.dominantCycles||0).toFixed(1)}`:`ATTENZIONE incoerente · c=${Number(q.coherenceRatio||0).toFixed(2)}`;updateDeepModelUi(`${healthy?'✓':'⚠'} ${selectedDeepModel().label} · ${result.provider} · ${result.rawWidth}×${result.rawHeight} · ${steady.toFixed(0)} ms · ${qualityText}${rescued?' · rescue risoluzione':''} · totale ${total.toFixed(0)} ms`,healthy?'ok':'warn');log.info('deep-model-test',{model:selectedDeepModel().label,provider:result.provider,ms:result.ms,totalMs:result.totalMs,automaticSafeFallback:!!result.automaticSafeFallback,quality:q,resolutionRescue:result.resolutionRescue||null,output:[result.rawWidth,result.rawHeight]});}catch(err){updateDeepModelUi(`Modello non utilizzabile: ${err?.message||err}`,'error');throw err;}finally{if(button)button.disabled=false;}}
async function chooseDeepModel(file){if(!file)return;const bytes=await file.arrayBuffer();if(bytes.byteLength<1024)throw new Error('file ONNX troppo piccolo');state.deepModel={id:`upload-${file.name}-${file.size}-${file.lastModified}`,label:file.name,bytes};state.deepDepthWorker?.terminate();state.deepDepthWorker=null;updateDeepModelUi(`Modello selezionato: ${file.name} (${(file.size/1048576).toFixed(1)} MB). Premi “Prova inferenza”.`);log.info('deep-model-selected',{name:file.name,bytes:file.size});}
function metricCalibrationInfo(c=calibration()){const ids=new Set((c?.anchors||[]).filter(a=>a?.realAnchor&&Array.isArray(a?.p)).map(a=>a.objectId));const n=c?.objects?.length||ids.size,geometryValid=!!c&&ids.size>=3&&n>=3,bridgeReady=geometryValid&&c?.visualBridgeReady!==false;return {calibration:c,ids,n,geometryValid,bridgeReady,valid:bridgeReady};}
function updateCalibrationUi(){const {calibration:c,ids,n,geometryValid,bridgeReady,valid}=metricCalibrationInfo(),summary=$('calibSummary'),start=$('startBtn');if(!c){if(summary)summary.textContent='Nessuna scala metrica: AlvaAR può comunque partire e mantenere il proprio mondo in scala libera.';if(start){start.disabled=false;start.textContent='Avvia AlvaAR';}return;}const p=c.poseCoverage?.length||c.quality?.poseCount||0;if(summary)summary.textContent=bridgeReady?`Bootstrap metrico disponibile: ${n} pin 3D · ${p} pose. Dopo l’aggancio AlvaAR prosegue autonomamente.`:geometryValid?`3D WebXR valido (${n} pin), ma il browser non ha fornito texture raw per il matcher: AlvaAR partirà in scala libera.`:`Calibrazione incompleta (${ids.size}/3 pin metrici). AlvaAR può comunque partire in scala libera.`;if(start){start.disabled=false;start.textContent=bridgeReady?'Avvia misura metrica':'Avvia AlvaAR';}}
function updateProgress(q){if(!q)return;const aim=q.manualAim||{},status=$('calibStatus'),depth=$('calibDepth'),add=$('calibAddPinBtn'),undo=$('calibUndoPinBtn'),finish=$('calibFinishBtn');if(status){const views=(q.targets||[]).slice(0,5).map((t,i)=>`P${i+1}:${t.roiViews||0}v`).join(' · ');status.textContent=q.ready?`✓ PRONTO · ${q.commonVisibleReadyTargets||0} pin utili visibili · Applica`:`${q.selected||0} pin · utili ${q.readyTargets||0}/${q.target||3}${views?` · ${views}`:''}`;}if(depth){if(q.ready)depth.textContent='Calibrazione sufficiente: premi Applica. Puoi continuare a muoverti solo se vuoi più viste.';else if(q.blocker)depth.textContent=q.blocker;else if(aim.valid)depth.textContent=`${Number(aim.depthM||0).toFixed(2)} m · ${aim.stable?'reticolo stabile':'tieni fermo il reticolo'}`;else depth.textContent='Inquadra una superficie con il reticolo.';}if(add)add.disabled=!aim.valid||!aim.stable||q.selected>=q.maxTargets;if(undo)undo.disabled=q.selected<1;if(finish){finish.disabled=!q.ready;finish.textContent=q.ready?'✓ Applica':'✓ Applica';}drawCalibrationOverlay(q);}
function drawCalibrationOverlay(q){const c=$('calibOverlay');if(!c)return;const r=c.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(c.width!==w||c.height!==h){c.width=w;c.height=h;}const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,r.width,r.height);const cx=r.width/2,cy=r.height/2,ok=!!q?.manualAim?.stable;g.strokeStyle=ok?'#5cff8d':'#ffffff';g.lineWidth=2;g.beginPath();g.arc(cx,cy,15,0,Math.PI*2);g.moveTo(cx-24,cy);g.lineTo(cx-8,cy);g.moveTo(cx+8,cy);g.lineTo(cx+24,cy);g.moveTo(cx,cy-24);g.lineTo(cx,cy-8);g.moveTo(cx,cy+8);g.lineTo(cx,cy+24);g.stroke();for(let i=0;i<(q?.targets||[]).length;i++){const t=q.targets[i];if(t.state!=='tracking'||!t.visible||!Array.isArray(t.seedUv))continue;const x=t.seedUv[0]*r.width,y=t.seedUv[1]*r.height;g.fillStyle='#61d6ff';g.strokeStyle='#00131c';g.lineWidth=3;g.beginPath();g.arc(x,y,10,0,Math.PI*2);g.fill();g.stroke();g.fillStyle='#fff';g.font='700 13px system-ui';g.fillText(`P${i+1}`,x+14,y+4);}}

async function beginCalibration(){if(state.camera)stopScan();show('calibration');try{const {XRMetricCalibrator}=await lazy('./xr/xr_calibration.js');const c=new XRMetricCalibrator({overlayRoot:$('calibration'),config:CONFIG,log});state.calibrator=c;window.__ROOMSCAN_ACTIVE_CALIBRATOR=c;c.addEventListener('progress',e=>updateProgress(e.detail));c.addEventListener('pin-rejected',e=>{const d=$('calibDepth');if(d)d.textContent=e.detail?.message||'Pin non valido';});await c.start();updateProgress(c.quality());}catch(err){state.calibrator?.stop?.().catch(()=>{});state.calibrator=null;window.__ROOMSCAN_ACTIVE_CALIBRATOR=null;show('home');throw err;}}
async function addCalibrationPin(){const c=state.calibrator;if(!c)return;const ok=await c.confirmManualPin();if(!ok)return;updateProgress(c.quality());}
async function finishCalibration(){const c=state.calibrator;if(!c)return;const result=await c.finish();saveCalibration(result);state.calibrator=null;window.__ROOMSCAN_ACTIVE_CALIBRATOR=null;show('home');const s=$('homeStatus');if(s)s.textContent='Calibrazione WebXR salvata. Ora puoi avviare la misura.';}
async function cancelCalibration(){if(state.calibrator)await state.calibrator.stop().catch(()=>{});state.calibrator=null;window.__ROOMSCAN_ACTIVE_CALIBRATOR=null;show('home');}

async function createAlvaFrontend(K){
  const {WasmVisionFrontend}=await lazy('./slam/wasm_frontend.js');
  const fovDeg=2*Math.atan((K?.width||CONFIG.analysisWidth)/(2*Math.max(1,K?.fx||CONFIG.analysisWidth)))*180/Math.PI;
  const frontend=new WasmVisionFrontend({sentinelUrl:`${CONFIG.wasmCore}?v=${BUILD.version}`});
  await frontend.init({width:CONFIG.analysisWidth,height:CONFIG.analysisHeight,fovDeg,alvaLocalUrl:new URL('../vendor/alva_ar.js',import.meta.url).href,alvaRemoteUrls:CONFIG.alvaRemoteUrls||[CONFIG.alvaRemoteUrl].filter(Boolean),requireAlva:true});
  log.info('alva-runtime-ready',{mode:frontend.mode,fovDeg,K,source:frontend.alvaRuntimeStatus?.source||'injected',runtime:frontend.alvaRuntimeStatus||null});
  return frontend;
}

/**
 * Bootstrap path only. WebXR/pin calibration is consumed here to estimate one
 * fixed Alva-world -> metric-world Sim(3). After Scan starts, the bridge is
 * discarded and it never corrects/steers AlvaAR again.
 */
async function beginBridge(){
  stopSurfaceLabWorker({discard:true});
  const info=metricCalibrationInfo(),cal=info.bridgeReady?info.calibration:null,epoch=++state.bridgeEpoch;
  state.bridgeTransition=false;state.bridgeStable=0;state.alvaBootstrap=null;
  state.bridge?.stop();state.bridge=null;

  // AlvaAR is useful even without a metric bootstrap. In this mode the world
  // remains persistent but its scale is explicitly labelled as free/non-metric.
  if(!cal){
    await startScan({locked:false,alvaTransform:null,scaleFree:true,method:'alvaar-scale-free'},epoch,null);
    return;
  }

  show('bridge');const coach=$('bridgeCoach');if(coach)coach.textContent='Avvio camera e AlvaAR…';
  try{
    const [{MetricBridge},{AlvaMetricBootstrap},{alvaMatrixToPose}]=await Promise.all([lazy('./xr/metric_bridge.js'),lazy('./slam/alva_metric_bootstrap.js'),lazy('./slam/slam_engine.js')]);
    if(epoch!==state.bridgeEpoch)return;
    const bridge=new MetricBridge({video:$('bridgeCamera'),calibration:cal,log,analysisWidth:CONFIG.analysisWidth,analysisHeight:CONFIG.analysisHeight});
    state.bridge=bridge;state.alvaBootstrap=new AlvaMetricBootstrap({minSamples:CONFIG.alvaBootstrapMinSamples||5,minMetricBaselineM:CONFIG.alvaBootstrapMinBaselineM||.07,maxPositionRmseM:CONFIG.alvaBootstrapMaxPositionRmseM||.045,maxOrientationRmseRad:CONFIG.alvaBootstrapMaxOrientationRmseRad||.20});

    bridge.addEventListener('update',safe('metric-bridge-update',async e=>{
      if(epoch!==state.bridgeEpoch||state.bridge!==bridge)return;
      const r=e.detail,found=$('bridgeFound'),inliers=$('bridgeInliers'),rmse=$('bridgeRmse');
      if(found)found.textContent=String(r.found||0);if(inliers)inliers.textContent=String(r.inliers||0);if(rmse)rmse.textContent=r.rmse==null?'—':r.rmse.toFixed(4);
      window.dispatchEvent(new CustomEvent('roomscan:metric-bridge-update',{detail:r}));

      let bs=state.alvaBootstrap.status();
      const tr=bridge.latestAlva,dt=Math.abs((tr?.at||0)-(r?.at||0));
      if(r.locked&&r.pose&&tr?.cameraPose&&dt<=Math.max(140,1000/(bridge.trackingFps||12)*2)){
        try{bs=state.alvaBootstrap.add(alvaMatrixToPose(tr.cameraPose),r.pose,r.at||performance.now());}
        catch(err){log.warn('alva-metric-bootstrap-sample',{message:err.message});}
      }
      if(coach){const base=`Alva ${bs.samples}/${state.alvaBootstrap.minSamples} · baseline ${(bs.metricBaselineM*100).toFixed(1)}/${(state.alvaBootstrap.minMetricBaselineM*100).toFixed(0)} cm`;coach.textContent=bs.ready?'✓ Riferimento metrico fissato · AlvaAR continuerà autonomamente.':r.locked?`${base} · muovi lentamente il telefono di lato mantenendo 3 pin visibili.`:'Allinea almeno 3 pin. Servono solo per fissare una volta scala e riferimento di AlvaAR.';}

      if(r.locked&&bs.ready&&!state.bridgeTransition){
        state.bridgeTransition=true;
        try{
          const metric={...r,locked:true,alvaTransform:bs.result,method:'one-shot-pins-to-alva-sim3'};
          await startScan(metric,epoch,bridge);
        }catch(err){
          if(epoch===state.bridgeEpoch&&state.bridge===bridge){bridge.resume?.();if(coach)coach.textContent=`Bootstrap metrico valido ma avvio scansione fallito: ${err?.message||err}. Puoi riprovare o uscire.`;}
          throw err;
        }finally{if(epoch===state.bridgeEpoch)state.bridgeTransition=false;}
      }
    }));

    // Start the camera first so K is known, then initialize exactly ONE AlvaAR
    // instance and hand that same instance from bridge to Scan without reset.
    await bridge.start();if(epoch!==state.bridgeEpoch){bridge.stop();return;}
    // Preserve an existing Alva world across Review -> Resume or a later
    // measurement in the same page. Recreate the tracker only if none exists.
    if(!state.frontend?.alva)state.frontend=await createAlvaFrontend(bridge.K);else state.frontend.resetLocalFeatures?.();
    if(epoch!==state.bridgeEpoch){bridge.stop();return;}
    bridge.setFrontend(state.frontend);
    if(coach)coach.textContent='AlvaAR attivo. Allinea 3 pin e fai una breve traslazione laterale: la calibrazione verrà poi sganciata.';
    lazy('./xr/measurement_guidance.js').then(m=>m.installMeasurementGuidance?.()).catch(err=>log.warn('measurement-guidance',{message:err.message}));
  }catch(err){if(epoch===state.bridgeEpoch){state.bridge?.stop();state.bridge=null;state.frontend=null;show('home');}throw err;}
}

async function startScan(metric={},epoch=state.bridgeEpoch,bridge=null){
  if(epoch!==state.bridgeEpoch)return;
  bridge?.pause?.();
  const [{CameraController,intrinsicsForCrop},{SlamEngine},{LiveReconstructionOverlay},{DenseKeyframeManager},{DeepKeyframeSelector},deepSync,coverageApi,liveMapApi]=await Promise.all([
    lazy('./camera.js'),lazy('./slam/slam_engine.js'),lazy('./gaussian/ar_overlay.js'),lazy('./dense/keyframe_manager.js'),lazy('./dense/deep_keyframe_selector.js'),lazy('./dense/deep_frame_sync.js'),lazy('./reconstruction/coverage_sphere.js'),lazy('./reconstruction/live_photo_puzzle.js')
  ]);
  state.deepSync=deepSync;state.coverageApi=coverageApi;state.liveMapApi=liveMapApi;
  if(epoch!==state.bridgeEpoch)return;

  // Transfer the already-open camera from the metric bridge when possible. The
  // Alva instance remains the same; dense mapping is a downstream consumer and
  // never feeds pose corrections back into SLAM.
  const sharedStream=bridge?.takeStream?.()||null;
  state.camera=new CameraController({video:$('camera'),width:CONFIG.analysisWidth,height:CONFIG.analysisHeight,fps:CONFIG.analysisFps,log,stream:sharedStream});
  try{await state.camera.start();}catch(err){if(sharedStream&&bridge){if(state.camera?.video)state.camera.video.srcObject=null;state.camera.stream=null;await bridge.restoreStream?.(sharedStream);}throw err;}
  if(epoch!==state.bridgeEpoch){state.camera.stop();return;}
  show('scan');setScanDiagnosticsOpen(!!globalThis.matchMedia?.('(min-width:900px) and (orientation:landscape)')?.matches);if($('coach'))$('coach').textContent='AlvaAR traccia il mondo. Muoviti lentamente di lato: la superficie densa viene ricostruita in background.';

  const cal=calibration(),geometry=state.camera.geometry;
  const K=metric?.K||intrinsicsForCrop(metric?.intrinsicsNorm||cal?.commonView?.intrinsicsNorm||cal?.intrinsicsNorm,geometry,{fallbackFovDeg:CONFIG.cameraFovDeg});
  state.scanK=K;state.lastFrameGeometry=geometry;
  if(!state.frontend?.alva){state.frontend=await createAlvaFrontend(K);}else{state.frontend.resetLocalFeatures?.();}
  if(epoch!==state.bridgeEpoch){state.camera.stop();return;}
  if($('slamState'))$('slamState').textContent='ALVA TRACKING · INIT';
  log.info('slam-frontend-reused',{mode:state.frontend.mode,fromMetricBootstrap:!!bridge,metricTransform:!!metric?.alvaTransform});

  state.slam=new SlamEngine({frontend:state.frontend,K,log,keyframeIntervalMs:CONFIG.keyframeIntervalMs,observationIntervalMs:CONFIG.alvaObservationIntervalMs||900,maxObservations:CONFIG.alvaHeartbeatBufferFrames||8});
  if(metric?.alvaTransform)state.slam.setWorldTransform(metric.alvaTransform);

  state.liveOverlay=new LiveReconstructionOverlay($('miniMap'),{maxSplats:CONFIG.liveOverlayMaxSplats||4200});state.liveOverlay.setMode('both');
  stopPostOptimizer();state.gaussians=[];state.mesh=null;state.meshStale=false;state.geometryCommitted=false;state.optimizerObservations=null;state.probOptimization=null;state.probOptimized=null;state.optimization={iterations:0,lastEnergy:null};state.reviewMetricLocked=null;state.reviewKeyframes=0;window.__ROOMSCAN_METRIC_MESH=null;state.alvaHeartbeatFrames=[];state.alvaHeartbeatCount=0;state.denseBusy=false;state.denseActivePayload=null;state.denseJobs=0;state.denseDepthSamples=0;state.denseDepthHint=null;state.densePixelStep=CONFIG.densePixelStep||4;state.denseSourceLimit=Math.min(CONFIG.denseInitialSourceLimit||2,CONFIG.denseMaxSourceViews||4);state.surfaceStats=null;state.geometryAnchors=[];state.deepPending=null;state.deepDisabled=false;state.deepCalls=0;state.deepAccepted=0;state.deepRaySamples=0;state.deepPreviewLastAt=0;state.photoSurveyLastAt=0;state.deepPreviewInFlight=null;state.deepPreviewSeq=0;state.deepPreviewFrames=0;state.deepPreviewLastQuality=null;state.deepJobs.clear();state.deepSyncRejected=0;state.coverageSphere=new coverageApi.ViewSphereCoverage({cols:CONFIG.coverageSphereCols||24,rows:CONFIG.coverageSphereRows||12,maxFrames:CONFIG.coverageSphereMaxFrames||72});state.coverageStatus=state.coverageSphere.status();coverageApi.drawCoverageSphere($('coverageSphere'),state.coverageStatus);if($('coverageState'))$('coverageState').textContent='SFERA 0% · nessuna chiusura';state.liveMap=new liveMapApi.LivePhotoPuzzleMap({width:CONFIG.livePuzzleAtlasWidth||640,height:CONFIG.livePuzzleAtlasHeight||320,maxFrames:CONFIG.livePuzzleMaxFrames||90,maxRenderFrames:CONFIG.livePuzzleRenderFrames||64,temporalRadius:CONFIG.livePuzzleTemporalRadius||4,maxLoopCandidates:CONFIG.livePuzzleLoopCandidates||2,minEdgeMatches:CONFIG.livePuzzleMinEdgeMatches||6,minEdgeProbability:CONFIG.livePuzzleMinEdgeProbability||.10,maxWorldSamples:CONFIG.livePuzzleWorldSamples||12000,photoMaxSide:CONFIG.livePuzzlePhotoMaxSide||256,depthMaxSide:CONFIG.livePuzzleDepthMaxSide||168,depthMinPairs:CONFIG.livePuzzleDepthMinPairs||6,depthRegularizeIterations:CONFIG.livePuzzleDepthRegularizeIterations||8,maxPhotoSamples:CONFIG.livePuzzleMaxPhotoSamples||260000,maxDepthSamples:CONFIG.livePuzzleMaxDepthSamples||190000});state.liveMapMode='photo';state.photoPanoramaState=null;state.liveMapStats=state.liveMap.stats();state.liveMapRenderPending=false;updateLiveMapUi();scheduleLiveMapRender();stopPuzzleWorker();state.puzzleReconstruction=null;state.puzzlePreview=null;state.puzzleActive=false;state.puzzleAtlas=null;state.puzzleStats=null;stopLiveOptimizer();state.liveOptAccepted=null;state.liveOptStats=null;state.liveOptGate=null;state.liveOptPendingSlow=false;state.liveOptGeneration=0;state.liveOptRejected=0;state.liveOptAcceptedCount=0;state.liveOptBackoff=1;state.liveOptLastElapsedMs=0;state.liveOptAcceptedAnchors=[];state.liveOptPreviewGaussians=[];state.liveOptPreviewStats=null;state.liveOptLastAt=0;state.liveOptLastReason=null;
  state.frameQualityApi=await lazy('./probabilistic/frame_quality.js');
  if(CONFIG.probabilisticGraphEnabled!==false){
    const [{ProbabilisticFactorGraph},{DeepSequenceModel}]=await Promise.all([lazy('./probabilistic/factor_graph.js'),lazy('./probabilistic/deep_sequence_model.js')]);
    state.probGraph=new ProbabilisticFactorGraph({maxFrames:CONFIG.probabilisticMaxFrames||360,maxFeaturesPerFrame:CONFIG.probabilisticMaxFeaturesPerFrame||360,grayMaxSide:CONFIG.probabilisticGrayMaxSide||120,photoMaxSide:CONFIG.probabilisticPhotoMaxSide||128,deepGridCols:CONFIG.probabilisticDeepGridCols||32,deepGridRows:CONFIG.probabilisticDeepGridRows||48,mvsPerFrame:CONFIG.probabilisticMvsPerFrame||420,maxLandmarks:CONFIG.probabilisticMaxGraphLandmarks||18000});
    state.deepSequence=new DeepSequenceModel({minAnchors:CONFIG.deepMinAnchors||5,minCells:CONFIG.deepMinAnchorCells||3});
  }else{state.probGraph=null;state.deepSequence=null;}
  if(state.probGraph)ensureLiveOptimizerWorker();
  log.checkpoint('measurement-start',{frames:state.probGraph?.frames?.length||0,landmarks:state.probGraph?.landmarkFactors?.length||0,deepFrames:state.probGraph?.deepFactors?.length||0,metricLocked:!!state.slam.metricLocked,K:state.scanK});
  const metricWorld=!!state.slam.metricLocked;
  state.denseManager=new DenseKeyframeManager({
    width:CONFIG.denseWidth||160,height:CONFIG.denseHeight||240,
    deepWidth:CONFIG.deepKeyframeWidth||224,deepHeight:CONFIG.deepKeyframeHeight||336,
    maxFrames:CONFIG.denseMaxKeyframes||8,
    minSources:CONFIG.denseMinSourceViews||2,maxSources:CONFIG.denseMaxSourceViews||4,
    minBaseline:metricWorld?(CONFIG.denseMinBaselineM||.045):(CONFIG.denseMinBaselineAlva||.02),
    maxBaseline:metricWorld?(CONFIG.denseMaxBaselineM||.75):(CONFIG.denseMaxBaselineAlva||1.5),
    maxAngleRad:CONFIG.denseMaxViewAngleRad||.38,minIntervalMs:CONFIG.denseMinKeyframeIntervalMs||650
  });

  state.denseDepthWorker=new Worker(`${CONFIG.denseDepthWorker}?v=${BUILD.version}`,{type:'module'});
  state.denseDepthWorker.onmessage=e=>handleDenseDepthMessage(e.data||{});
  state.denseDepthWorker.onerror=e=>{state.denseBusy=false;state.denseActivePayload=null;log.warn('dense-depth-worker',{message:e.message||'worker error'});if($('mvsState'))$('mvsState').textContent='DENSE errore · tracking Alva continua';};
  state.denseDepthWorker.postMessage({type:'init',config:{depthSteps:CONFIG.denseDepthSteps||40,pixelStep:CONFIG.densePixelStep||3,maxCost:CONFIG.denseMaxPhotoCost||.22,minConfidence:CONFIG.denseMinConfidence||.11,minTexture:CONFIG.denseMinTexture||.018,minDistinctiveness:CONFIG.denseMinDistinctiveness||.025,minViews:CONFIG.denseMinSourceViews||2,maxSamples:CONFIG.denseMaxSamplesPerDepth||14000}});

  // The ONNX worker may already be warm from the explicit pre-scan test.
  // V30.25 has TWO consumers with different authority:
  // 1) a ~1 Hz live preview independent from Alva, used only for visual diagnosis;
  // 2) selected Alva keyframes, whose depth may be calibrated/fused into 3D.
  // The live preview never creates pose, scale or geometry by itself.
  state.deepSelector=new DeepKeyframeSelector({minIntervalMs:CONFIG.deepMinIntervalMs||2600,maxIntervalMs:CONFIG.deepMaxIntervalMs||8000,minTranslationM:CONFIG.deepMinTranslationM||.20,minTranslationAlva:CONFIG.deepMinTranslationAlva||.10,minRotationRad:CONFIG.deepMinRotationRad||.16,minAnchors:CONFIG.deepMinAnchors||7,minAnchorCells:CONFIG.deepMinAnchorCells||3,depthNovelty:CONFIG.deepDepthNovelty||.22});
  if(CONFIG.deepDepthEnabled!==false){
    state.deepDepthWorker=ensureDeepWorker();
    state.deepDepthWorker.onmessage=e=>void handleDeepDepthMessage(e.data||{});
    state.deepDepthWorker.onerror=e=>{const pending=state.deepPending;state.deepDisabled=true;state.deepPending=null;state.deepJobs.clear();state.deepPreviewInFlight=null;state.deepSelector?.fail?.();log.warn('deep-depth-worker',{message:e.message||'worker error'});if($('mvsState'))$('mvsState').textContent='AI depth non disponibile · feature track + multi-view continuano';if($('deepLiveState'))$('deepLiveState').textContent='DEEP LIVE · worker non disponibile';if(pending&&state.denseDepthWorker){stripDeepRaster(pending);state.denseActivePayload=pending;state.denseBusy=true;state.denseDepthWorker.postMessage(pending);}else{state.denseActivePayload=null;state.denseBusy=false;void scheduleDenseWork();}};
    state.deepDepthWorker.postMessage({type:'init',config:deepWorkerConfig()});
  }

  const voxel=metricWorld?(CONFIG.denseTsdfVoxelM||.035):(CONFIG.denseTsdfVoxelAlva||.03);
  state.denseFusionWorker=new Worker(`${CONFIG.denseFusionWorker}?v=${BUILD.version}`,{type:'module'});
  state.denseFusionWorker.onmessage=e=>handleDenseFusionMessage(e.data||{});
  state.denseFusionWorker.onerror=e=>log.warn('dense-fusion-worker',{message:e.message||'worker error'});
  state.denseFusionWorker.postMessage({type:'init',config:{
    voxel,hashVoxel:metricWorld?(CONFIG.denseGaussianHashVoxelM||.022):(CONFIG.denseGaussianHashVoxelAlva||.020),truncation:voxel*(CONFIG.denseTsdfTruncVoxels||3),minSupport:CONFIG.denseMinSurfaceSupport||2,
    minConfirmBaseline:metricWorld?(CONFIG.denseRayConfirmBaselineM||.035):(CONFIG.denseRayConfirmBaselineAlva||.018),
    maxRaySigma:CONFIG.denseRayMaxSigma||3,maxMahalanobis2:CONFIG.denseGaussianMahalanobis2||11.34,provisionalMaxAge:CONFIG.denseProvisionalMaxAge||18,tsdfMinSupport:CONFIG.denseTsdfMinSupport||3,tsdfMaxSurfels:CONFIG.denseTsdfMaxSurfels||60000,liveTsdfMaxSurfels:CONFIG.denseLiveTsdfMaxSurfels||18000,
    maxSurfels:CONFIG.denseMaxSurfels||180000,maxTsdf:CONFIG.denseMaxTsdfVoxels||450000,snapshotEvery:CONFIG.denseSurfaceSnapshotEvery||2,
    meshEvery:CONFIG.denseMeshEvery||5,maxSplats:CONFIG.gaussianSnapshot||50000,maxTriangles:CONFIG.denseMaxMeshTriangles||90000,observationReservoir:CONFIG.postOptimizeObservationReservoir||4
  }});

  state.currentSession=await state.db?.createSession({calibrationBuild:cal?.createdAt||null,metricLocked:metricWorld,reconstruction:'alva+photo-puzzle+global-depth-scale+hybrid-planes-particles'});
  if($('metricState'))$('metricState').textContent=metricWorld?`scala METRIC · Alva×${state.slam.metricScale?.toFixed?.(3)||'?'}`:'ALVA WORLD · scala libera';
  if($('mvsState'))$('mvsState').textContent='DENSE: Deep live ~1 Hz · fusione solo su keyframe Alva validi';
  if($('deepLiveState'))$('deepLiveState').textContent='DEEP LIVE · attendo primo frame…';
  if($('metricPipelineHud'))$('metricPipelineHud').textContent='Surface mapper: attendo 3 viste con parallasse.';

  // The calibration bridge has no authority after the one-shot similarity is
  // locked. This is deliberately the last bridge-related line in Scan.
  if(bridge===state.bridge)state.bridge=null;state.alvaBootstrap=null;

  state.scanStop=state.camera.loop(frame=>{try{
    state.lastFrameGeometry=frame.geometry;const r=state.slam.process(frame);state.lastTracking=r;
    if($('statFeat'))$('statFeat').textContent=String(r.features);if($('statMatch'))$('statMatch').textContent=String(r.matches);if($('statKf'))$('statKf').textContent=String(r.keyframes);if($('alvaPtsState'))$('alvaPtsState').textContent=`ALVA pts ${r.alvaPoints||0}`;
    const status=r.trackingMode==='alvaar-relocalized'?'ALVA RELOCALIZED':r.trackingValid?'ALVA TRACKING':r.trackingMode==='alvaar-initializing'?'ALVA INIT':'ALVA LOST';
    if($('slamState'))$('slamState').textContent=`${status}${state.gaussians.length?' + SURFACE':''}`;
    if($('coach'))$('coach').textContent=r.trackingValid?'AlvaAR stabile · trasla lentamente, mantieni overlap e torna sulle zone già viste.':r.trackingMode==='alvaar-initializing'?'AlvaAR INIT · muovi lentamente il telefono di lato mantenendo texture e luce stabili; salvo 1 frame/s anche prima del primo pose.':'Tracking Alva perso · continuo a salvare 1 frame/s per diagnosi/recovery; torna verso una zona già osservata.';
    // Deep live is intentionally independent from tracking validity. This gives
    // an immediate on-screen truth check even while Alva is still INIT.
    requestLiveDeepPreview(frame,r);
    if(r.newObservation)recordAlvaHeartbeat(r.newObservation,frame,K);
    if(r.newKeyframe&&r.trackingValid)void queueDenseKeyframe(r.newKeyframe,frame,K).catch(err=>log.warn('dense-keyframe-sync',{frameId:frame.frameId||null,keyframeFrameId:r.newKeyframe?.frameId||null,message:err?.message||String(err)}));
    state.liveOverlay?.draw({pose:r.pose,K,geometry:frame.geometry,video:state.camera.video,framePoints:r.framePoints||[]});
    if(state.currentSession&&r.newKeyframe&&r.keyframes%5===0)state.db?.updateSession(state.currentSession.id,{status:'scanning',counts:{keyframes:r.keyframes,denseSamples:state.denseDepthSamples,surfels:state.surfaceStats?.confirmed||0,gaussians:state.gaussians.length,meshFaces:state.mesh?.faces?.length?state.mesh.faces.length/3:0}}).catch(()=>{});
  }catch(err){log.warn('scan-frame',{message:err.message,stack:err.stack||null});}});
}

function captureLiveSurveyFrame(frame,tracking){
  // Freeze the exact RGB frame that WILL be sent to Deep. It is only a pending
  // candidate here: no photo graph, no live mosaic and no coverage vote exist
  // until a valid depth result returns for this same immutable frame.
  if(!state.scanK||!frame?.gray?.length||!frame?.rgba?.length||!frame?.frameId)return null;
  const photoQuality=state.frameQualityApi?.assessRgbFrameQuality?.(frame.gray,frame.width,frame.height)||null;
  const hasAlva=!!(tracking?.trackingValid&&tracking?.pose?.p&&tracking?.pose?.q),survey={
    id:`photo-${frame.captureSeq||tracking?.frame||tracking?.frameId||frame.frameId}`,
    frameId:String(frame.frameId),captureAt:Number(frame.at),at:Number(frame.at),
    pose:hasAlva?{p:[...tracking.pose.p],q:[...tracking.pose.q]}:null,poseCov:hasAlva?(tracking.poseCov||null):null,
    K:{...state.scanK},width:frame.width,height:frame.height,
    // Own immutable copy: the camera analysis buffers may be reused while the
    // asynchronous Deep worker is still processing this frame.
    gray:new Uint8Array(frame.gray),rgba:new Uint8ClampedArray(frame.rgba),
    // SLAM observations are metadata for the metric graph only. The RGB mosaic
    // always detects and matches its own features on the frozen photograph.
    features:hasAlva?(tracking.featureObservations||tracking.newKeyframe?.features||[]):[],
    metricLocked:hasAlva&&!!state.slam?.metricLocked,trackingMode:tracking?.trackingMode||'alva-unavailable',trackingValid:hasAlva,depthPlanned:true,photoQuality
  };
  return {survey,alvaPose:hasAlva};
}

function requestLiveDeepPreview(frame,tracking){
  if(!frame?.rgba?.length||!frame?.gray?.length||!state.scanK)return;
  const now=Number(frame.at)||performance.now(),interval=Math.max(500,Number(CONFIG.deepInferenceIntervalMs)||1000);
  // Consistency invariant: there is no photo-only clock anymore. If Deep cannot
  // accept this exact frame, the frame is not registered and cannot appear in
  // the mosaic. Dense/SLAM geometry continues separately.
  if(CONFIG.deepLiveDuringScan===false||!state.deepDepthWorker||state.deepDisabled||!state.deepSync){if($('deepLiveState'))$('deepLiveState').textContent='MOSAICO RGB+DEEP · fermo (Depth non attiva)';return;}
  if(state.deepPreviewInFlight||now-state.deepPreviewLastAt<interval)return;
  const capture=captureLiveSurveyFrame(frame,tracking);if(!capture?.survey)return;
  state.photoSurveyLastAt=now;state.deepPreviewLastAt=now;const jobId=`preview-ticker-${++state.deepPreviewSeq}-${Math.round(now)}`;state.deepPreviewInFlight=jobId;
  const rgba=new Uint8ClampedArray(capture.survey.rgba),binding=state.deepSync.createDeepFrameBinding({jobId,kind:'preview',frameId:capture.survey.frameId,frameAt:capture.survey.at,rgba,width:capture.survey.width,height:capture.survey.height,survey:capture.survey,tracking:{frameId:tracking?.frameId||null,trackingValid:!!tracking?.trackingValid,trackingMode:tracking?.trackingMode||null,pose:tracking?.pose?{p:[...tracking.pose.p],q:[...tracking.pose.q]}:null,poseCov:tracking?.poseCov||null,alvaPoints:tracking?.alvaPoints||0,keyframeId:tracking?.newKeyframe?.id||null}});
  state.deepJobs.set(jobId,binding);state.deepDepthWorker.postMessage({type:'infer',jobId,frameId:binding.frameId,frameAt:binding.frameAt,model:modelForWorker(),rgba,width:capture.survey.width,height:capture.survey.height},[rgba.buffer]);if($('deepLiveState'))$('deepLiveState').textContent=`RGB+DEEP F${frame.captureSeq||'?'} · frame congelato · inferenza ${state.deepPreviewSeq}…`;
}

function compactGrayHeartbeat(gray,width,height,maxSide=160){
  const scale=Math.min(1,Math.max(32,Number(maxSide)||160)/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale)),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){const sy=Math.min(height-1,Math.floor((y+.5)*height/h));for(let x=0;x<w;x++){const sx=Math.min(width-1,Math.floor((x+.5)*width/w));out[y*w+x]=gray[sy*width+sx];}}
  return {gray:out,width:w,height:h};
}
function recordAlvaHeartbeat(observation,frame,K){
  // Alva is already fed every analysis frame (~8 Hz). This independent 1 Hz
  // heartbeat does NOT throttle or duplicate SLAM calls; it preserves a bounded
  // visual history even while the monocular initializer has no pose yet.
  const thumb=compactGrayHeartbeat(frame.gray,frame.width,frame.height,CONFIG.alvaHeartbeatPersistMaxSide||160),entry={...observation,K:{...K},thumbWidth:thumb.width,thumbHeight:thumb.height,gray:thumb.gray};
  state.alvaHeartbeatFrames.push(entry);while(state.alvaHeartbeatFrames.length>(CONFIG.alvaHeartbeatBufferFrames||8))state.alvaHeartbeatFrames.shift();state.alvaHeartbeatCount++;
  if(state.currentSession&&state.db)state.db.put('events',{id:`${state.currentSession.id}-${observation.id}`,sessionId:state.currentSession.id,seq:state.alvaHeartbeatCount,kind:'alva-heartbeat',frameId:observation.frameId||frame.frameId||null,at:observation.at,trackingValid:observation.trackingValid,trackingMode:observation.trackingMode,width:thumb.width,height:thumb.height,gray:thumb.gray,features:observation.features,matches:observation.matches,alvaPoints:observation.alvaPoints}).catch(err=>log.warn('alva-heartbeat-store',{message:err?.message||String(err)}));
}

let scanAbortController=null;
function makeScanAbortSignal(){scanAbortController?.abort();scanAbortController=new AbortController();return scanAbortController.signal;}

async function queueDenseKeyframe(kf,frame,K){
  if(!state.denseManager||!state.denseDepthWorker)return;
  const sync=state.deepSync?.sameCameraFrame?.(frame,kf)||{ok:true};
  if(!sync.ok){state.deepSyncRejected++;log.error('alva-camera-frame-sync-rejected',{...sync,kfId:kf?.id||null});return;}
  const added=state.denseManager.add(kf,frame,K,{metricLocked:!!state.slam?.metricLocked});
  if(added&&!added.photoQuality)added.photoQuality=state.frameQualityApi?.assessRgbFrameQuality?.(frame.gray,frame.width,frame.height)||null;
  const graphFrame=added?state.probGraph?.addFrame(added):null;
  // Dense/SLAM keyframes belong to the metric reconstruction only.  Feeding
  // them into the live PHOTO panel created a second capture stream and made the
  // user-visible mosaic impossible to audit.  The live map accepts ONLY the
  // regular frozen RGB survey photographs captured by captureLiveSurveyFrame().
  if(added&&state.coverageSphere){state.coverageStatus=state.coverageSphere.addFrame(added);state.coverageApi?.drawCoverageSphere?.($('coverageSphere'),state.coverageStatus);updateCoverageUi();}
  if(added)log.debug('alva-camera-frame-sync-ok',{frameId:added.frameId,kfId:added.id,at:added.at});
  if(graphFrame)scheduleLiveOptimization('rgb-keyframe',{slow:false});
  await scheduleDenseWork();
}
async function scheduleDenseWork(){
  if(!state.denseManager||!state.denseDepthWorker||state.denseBusy)return;
  const job=state.denseManager.nextJob();if(!job)return;state.denseBusy=true;
  const payload=await makeDensePayload(job);
  if(!payload){state.denseBusy=false;state.denseManager.release?.(job.ref.id);if($('mvsState'))$('mvsState').textContent='GEOM: attendo più feature Alva/parallasse';return;}
  state.denseJobs++;payload.jobId=`dense-${state.denseJobs}`;await dispatchDensePayload(payload);
}
async function makeDensePayload(job){
  const {buildSparseDepthAnchors}=await lazy('./dense/sparse_depth_anchors.js');
  const selectedSources=job.sources.slice(0,state.denseSourceLimit||3),metric=!!state.slam?.metricLocked;
  const sparse=buildSparseDepthAnchors(job.ref,selectedSources,{maxReprojectionPx:CONFIG.denseSeedMaxReprojectionPx||2.8,minAngleRad:CONFIG.denseSeedMinAngleRad||.001,maxGapBaselineRatio:CONFIG.denseSeedMaxGapBaselineRatio||.14});
  state.probGraph?.addSparseAnchors(job.ref,sparse.seeds);if(sparse.seeds?.length)scheduleLiveOptimization('sparse-anchors',{slow:false});
  if(sparse.seeds?.length&&state.liveMap){state.liveMap.addWorldSamples(sparse.seeds,{maxAdd:CONFIG.livePuzzleSparseAdd||320,source:'triangulated-track'});scheduleLiveMapRender();}
  if(state.coverageSphere){const meanProbability=sparse.seeds.length?sparse.seeds.reduce((a,x)=>a+(x.geometryProbability??x.confidence??0),0)/sparse.seeds.length:0;state.coverageStatus=state.coverageSphere.noteGeometry(job.ref.frameId||job.ref.id,{seedCount:sparse.seeds.length,meanProbability,sourceFrames:selectedSources.map(x=>x.frameId||x.id)});state.coverageApi?.drawCoverageSphere?.($('coverageSphere'),state.coverageStatus);updateCoverageUi();}
  // V30.29 keeps weak evidence probabilistic rather than turning it into a binary rejection. into a binary rejection.
  // A broad, uncertain MVS job is still useful and remains revisitable in the
  // factor graph; sparse geometry merely contracts the proposal interval.
  let near,far,median=null;
  if(sparse.range){near=sparse.range.near;far=sparse.range.far;median=sparse.range.median;}
  else if(Number.isFinite(state.denseDepthHint)&&state.denseDepthHint>0){median=state.denseDepthHint;near=median*.46;far=median*2.15;}
  else{near=metric?(CONFIG.denseNearM||.28):.18;far=metric?Math.min(5.5,CONFIG.denseFarM||8.5):5.0;}
  if(metric){near=Math.max(CONFIG.denseNearM||.20,near);far=Math.min(CONFIG.denseFarM||10,far);}if(!(far>near*1.25)){far=near*2.2;}
  if(median)state.denseDepthHint=median;
  if(!state.liveOptAcceptedAnchors?.length){state.geometryAnchors=sparse.seeds.slice(0,120).map(x=>({p:x.p,confidence:x.geometryProbability??x.confidence,reprojectionPx:x.reprojectionPx}));state.liveOverlay?.setGeometryAnchors(state.geometryAnchors);}
  const sparseSeeds=sparse.seeds.map(x=>({u:x.u,v:x.v,depth:x.depth,p:x.p,confidence:x.confidence,geometryProbability:x.geometryProbability??x.confidence,matchProbability:x.matchProbability??null,relativeDepthSigma:x.relativeDepthSigma??null,calibrationWeight:x.calibrationWeight??null,reprojectionPx:x.reprojectionPx,angle:x.angle??null,viewSupport:x.viewSupport||1,sourceIds:x.sourceIds||[],trackId:x.trackId||null,sigmaDepth:x.sigmaDepth||null,worldSigma:x.worldSigma||null,covariance:x.covariance||null,descriptor:x.descriptor||null,measurements:x.measurements||[],evidenceFrames:x.evidenceFrames||[]}));
  log.info('probabilistic-sparse-evidence',{ref:job.ref.id,seeds:sparseSeeds.length,range:!!sparse.range,matched:sparse.stats?.matched||0,triangulated:sparse.stats?.triangulated||0,meanProbability:sparseSeeds.length?sparseSeeds.reduce((a,x)=>a+(x.geometryProbability||0),0)/sparseSeeds.length:0});
  return {type:'depth',ref:cloneDenseFrame(job.ref,true),sources:selectedSources.map(x=>cloneDenseFrame(x,false)),K:job.ref.K,near,far,sparseSeeds,probabilistic:true,config:{depthSteps:CONFIG.denseDepthSteps||64,pixelStep:state.densePixelStep||CONFIG.densePixelStep||3,minTexture:CONFIG.denseMinTexture||.018,minDistinctiveness:CONFIG.denseMinDistinctiveness||.025,minViews:Math.min(CONFIG.denseMinSourceViews||2,selectedSources.length),seedRadiusPx:CONFIG.denseSeedRadiusPx||22,seedMaxRelativeError:CONFIG.denseSeedMaxRelativeError||.48,patchRadius:2}};
}
function cloneDenseFrame(f,includeDeep=false){const out={id:f.id,frameId:f.frameId||f.id,captureAt:f.captureAt??f.at,at:f.at,pose:f.pose,poseCov:f.poseCov||null,K:f.K,width:f.width,height:f.height,gray:f.gray,rgba:f.rgba,features:f.features||[]};if(includeDeep&&f.deepRgba?.length){out.deepWidth=f.deepWidth;out.deepHeight=f.deepHeight;out.deepRgba=f.deepRgba;}return out;}
async function dispatchDensePayload(payload){
  const baseDecision=state.deepSelector?.evaluate({ref:payload.ref,sparseSeeds:payload.sparseSeeds,metricLocked:!!state.slam?.metricLocked})||{infer:false,reason:'selector-unavailable'};
  // V30.25 wants one statistically useful proxy depth per accepted dense
  // keyframe. Near-duplicate *video* frames are still rejected by the keyframe
  // manager, but a keyframe that already passed Alva/parallax/anchor gating is
  // worth a Deep observation even when the selector calls its motion small.
  const forceEvery=CONFIG.deepInferEveryDenseKeyframe===true;
  const decision=forceEvery&&!baseDecision.infer?{...baseDecision,infer:true,reason:'accepted-dense-keyframe'}:baseDecision;
  if(!state.deepDisabled&&state.deepDepthWorker&&decision.infer){
    state.deepSelector.noteAttempt(payload.ref,payload.sparseSeeds);state.deepPending=payload;state.deepCalls++;
    const useDeepRaster=payload.ref.deepRgba?.length>0,source=useDeepRaster?payload.ref.deepRgba:payload.ref.rgba,sourceWidth=useDeepRaster?payload.ref.deepWidth:payload.ref.width,sourceHeight=useDeepRaster?payload.ref.deepHeight:payload.ref.height;
    const rgba=new Uint8ClampedArray(source),binding=state.deepSync.createDeepFrameBinding({jobId:payload.jobId,kind:'keyframe',frameId:payload.ref.frameId,frameAt:payload.ref.at,refId:payload.ref.id,rgba,width:sourceWidth,height:sourceHeight,payload,tracking:{pose:payload.ref.pose,featureCount:payload.ref.features?.length||0,anchorCount:payload.sparseSeeds.length}});state.deepJobs.set(payload.jobId,binding);
    state.deepDepthWorker.postMessage({type:'infer',jobId:payload.jobId,refId:payload.ref.id,frameId:binding.frameId,frameAt:binding.frameAt,model:modelForWorker(),rgba,width:sourceWidth,height:sourceHeight},[rgba.buffer]);
    if($('mvsState'))$('mvsState').textContent=`PROXY ${state.deepCalls}: SYNC ${binding.frameId} · Deep + ${payload.sparseSeeds.length} track anchor`;
    log.info('deep-depth-request',{jobId:payload.jobId,refId:payload.ref.id,frameId:binding.frameId,frameAt:binding.frameAt,frameSignature:binding.frameSignature,calls:state.deepCalls,reason:decision.reason,anchors:payload.sparseSeeds.length,cells:decision.cells});return;
  }
  // Deep is optional. If unavailable, keep the geometrically verified MVS path
  // rather than dropping a useful Alva keyframe.
  stripDeepRaster(payload);state.denseActivePayload=payload;state.denseDepthWorker.postMessage(payload);
  log.info('proxy-depth-mvs-only',{jobId:payload.jobId,refId:payload.ref.id,reason:state.deepDisabled?'ai-disabled':decision.reason});
}
function stripDeepRaster(payload){if(!payload?.ref)return;delete payload.ref.deepRgba;delete payload.ref.deepWidth;delete payload.ref.deepHeight;}
async function handleDeepDepthMessage(d){
  if(d.type==='deep-ready'){log.info('deep-depth-ready',{modelUrl:d.modelUrl,preferredShortSide:d.preferredShortSide,qualityRescueShortSide:d.qualityRescueShortSide});return;}
  if(d.type==='deep-loaded'){log.info('deep-depth-loaded',{model:d.model,provider:d.provider,input:d.input});return;}
  if(d.type==='deep-preview-queued'){if(d.jobId===state.deepPreviewInFlight&&$('deepLiveState'))$('deepLiveState').textContent=`DEEP LIVE · ${d.frameId||'frame'} in coda dietro keyframe…`;return;}
  if(d.type==='deep-preview-error'){
    state.deepJobs.delete(String(d.jobId||''));if(d.jobId===state.deepPreviewInFlight)state.deepPreviewInFlight=null;
    log.warn('deep-live-preview-error',{jobId:d.jobId,frameId:d.frameId||null,message:d.message,provider:d.provider,ms:d.ms});
    if($('deepLiveState'))$('deepLiveState').textContent=`DEEP LIVE · errore ${d.message||'inferenza'}`;return;
  }
  if(d.type==='deep-error'){
    const binding=state.deepJobs.get(String(d.jobId||''));state.deepJobs.delete(String(d.jobId||''));const pending=binding?.payload||state.deepPending;state.deepPending=null;state.deepDisabled=true;state.deepPreviewInFlight=null;state.deepSelector?.fail?.();
    log.warn('deep-depth-error',{jobId:d.jobId,frameId:d.frameId||binding?.frameId||null,message:d.message,provider:d.provider,ms:d.ms});if($('mvsState'))$('mvsState').textContent='Depth Anything non disponibile · continuo con feature track + multi-view';if($('deepLiveState'))$('deepLiveState').textContent='DEEP LIVE · non disponibile';
    // Deep is a completion prior, not a prerequisite. A keyframe that already
    // has Alva poses and triangulated feature tracks remains geometrically useful.
    if(pending&&state.denseDepthWorker){stripDeepRaster(pending);state.denseActivePayload=pending;state.denseBusy=true;state.denseDepthWorker.postMessage(pending);log.info('deep-depth-mvs-fallback',{refId:pending.ref.id,frameId:pending.ref.frameId||null});return;}
    state.denseBusy=false;void scheduleDenseWork();return;
  }
  if(d.type!=='deep-result')return;

  // CRITICAL: completion time has zero authority. The result may return hundreds
  // of milliseconds later, after Alva has processed several newer frames. Only
  // the immutable job binding created from the exact source raster may accept it.
  const binding=state.deepJobs.get(String(d.jobId||'')),sync=state.deepSync?.validateDeepFrameResult?.(d,binding)||{ok:false,reason:'sync-module-missing'};
  if(!sync.ok){
    state.deepJobs.delete(String(d.jobId||''));state.deepSyncRejected++;
    log.error('deep-frame-sync-rejected',{jobId:d.jobId,resultFrameId:d.frameId||null,boundFrameId:binding?.frameId||null,refId:d.refId||null,boundRefId:binding?.refId||null,reason:sync.reason,deltaMs:sync.deltaMs??null,resultSignature:d.frameSignature||null,boundSignature:binding?.frameSignature||null});
    if(binding?.kind==='preview'||String(d.jobId||'').startsWith('preview-ticker-')){if(d.jobId===state.deepPreviewInFlight)state.deepPreviewInFlight=null;if($('deepLiveState'))$('deepLiveState').textContent=`DEEP LIVE ⚠ frame non sincronizzato (${sync.reason})`;return;}
    const payload=binding?.payload;if(state.deepPending?.jobId===d.jobId)state.deepPending=null;state.deepSelector?.fail?.();
    if(payload&&state.denseDepthWorker){stripDeepRaster(payload);state.denseActivePayload=payload;state.denseBusy=true;state.denseDepthWorker.postMessage(payload);if($('mvsState'))$('mvsState').textContent='Deep scartata: frame/Alva non identici · uso solo multi-view';return;}
    state.denseBusy=false;void scheduleDenseWork();return;
  }
  state.deepJobs.delete(String(d.jobId||''));

  if(binding.kind==='preview'){
    if(d.jobId===state.deepPreviewInFlight)state.deepPreviewInFlight=null;
    state.deepPreviewFrames++;state.deepPreviewLastQuality=d.quality||null;drawDepth($('depthOverlay'),d.rawDepth,d.rawWidth,d.rawHeight);
    const survey=binding.survey,q=d.quality||{},confidence=q.suspicious?.025:.18;
    // ATOMIC RGB+DEPTH COMMIT. A survey photograph becomes a mosaic node only
    // after the exact-frame Deep raster has passed the sync contract and the
    // depth map itself contains enough valid samples.
    const committed=survey&&state.liveMap?.commitCameraFrameWithRelativeDepth?.(survey,{rawDepth:d.rawDepth,width:d.rawWidth,height:d.rawHeight,quality:q,confidence},{fallbackDepth:state.denseDepthHint||CONFIG.livePuzzleFallbackDepth||2.2,source:'deep-survey'});
    if(!committed?.ok){
      log.warn('deep-survey-not-committed',{jobId:d.jobId,frameId:binding.frameId,reason:committed?.reason||'missing-survey',validRatio:committed?.validRatio??null});
      if($('deepLiveState'))$('deepLiveState').textContent=`RGB+DEEP · frame scartato (${committed?.reason||'depth non valida'})`;return;
    }
    state.liveMapStats=committed.stats;scheduleLiveMapRender(true);
    // The optional metric/factor graph receives the same survey node only now,
    // after depth exists. Unposed photos remain valid RGB+Deep mosaic nodes and
    // may acquire a pose later without affecting their 2-D placement.
    const graphFrame=survey.pose?(state.probGraph?.addFrame(survey)||null):null;if(graphFrame){state.probGraph.addDeepRaw(binding.frameId,{rawDepth:d.rawDepth,rawWidth:d.rawWidth,rawHeight:d.rawHeight,calibration:null,quality:q});scheduleLiveOptimization('survey-depth',{slow:true});}
    if(survey.pose&&state.coverageSphere){state.coverageStatus=state.coverageSphere.addFrame(survey);state.coverageApi?.drawCoverageSphere?.($('coverageSphere'),state.coverageStatus);updateCoverageUi();}
    const stripe=q.stripe||{},band=Math.round(100*Number(stripe.dominantExplained||0)),cycles=Number(stripe.dominantCycles||0).toFixed(1),rescue=d.resolutionRescue?.accepted?' · rescue':'',lag=Math.max(0,performance.now()-binding.frameAt),warning=stripe.suspicious?`banding ${band}%/${cycles}c`:`coerenza ${Number(q.coherenceRatio||0).toFixed(2)}`;
    if($('deepLiveState'))$('deepLiveState').textContent=q.suspicious?`RGB+DEEP ✓ · depth debole (${warning}) · foto ammessa a bassa confidenza · lag ${lag.toFixed(0)} ms${rescue}`:`RGB+DEEP ✓ · foto+depth ${d.rawWidth}×${d.rawHeight} · lag ${lag.toFixed(0)} ms${rescue}`;
    if(state.deepPreviewFrames<=3||q.suspicious)log.info('deep-live-preview',{frame:state.deepPreviewFrames,frameId:binding.frameId,alvaFrameId:binding.tracking?.frameId||null,sync:sync.reason,lagMs:lag,provider:d.provider,ms:d.ms,totalMs:d.totalMs,quality:q,resolutionRescue:d.resolutionRescue||null,output:[d.rawWidth,d.rawHeight],metricGraphNode:!!graphFrame,mosaicCommitted:true});
    return;
  }
  const payload=binding.payload;if(!payload||payload.jobId!==d.jobId){state.deepSyncRejected++;log.error('deep-frame-payload-missing',{jobId:d.jobId,frameId:binding.frameId});state.denseBusy=false;void scheduleDenseWork();return;}
  if(state.deepPending?.jobId===d.jobId)state.deepPending=null;
  log.info('deep-frame-sync-ok',{jobId:d.jobId,frameId:binding.frameId,refId:binding.refId,frameSignature:binding.frameSignature,featureCount:binding.tracking?.featureCount||0,anchors:binding.tracking?.anchorCount||0,completionLagMs:Math.max(0,performance.now()-binding.frameAt)});
  await applyDeepDepthResult(d,payload);
}
async function applyDeepDepthResult(d,payload){
  if(String(d?.frameId||'')!==String(payload?.ref?.frameId||'')){state.deepSyncRejected++;log.error('deep-frame-sync-defense',{jobId:d?.jobId||null,resultFrameId:d?.frameId||null,payloadFrameId:payload?.ref?.frameId||null});stripDeepRaster(payload);state.denseActivePayload=payload;state.denseDepthWorker?.postMessage(payload);return;}
  drawDepth($('depthOverlay'),d.rawDepth,d.rawWidth,d.rawHeight);
  // Raw relative depth is evidence even when its current metric calibration is
  // weak. Persist it BEFORE any online quality/calibration decision so post-scan
  // optimisation can re-estimate scale after poses/landmarks improve. The live
  // photo puzzle receives the same exact frame-bound raw map and may calibrate it
  // from neighbouring RGB correspondences even before the dense keyframe has
  // enough sparse anchors for the traditional online Deep calibration.
  state.liveMap?.updateRelativeDepth?.(payload.ref.frameId,{rawDepth:d.rawDepth,width:d.rawWidth,height:d.rawHeight,quality:d.quality,confidence:d.quality?.suspicious?.025:.24});scheduleLiveMapRender();
  if(d.quality?.suspicious){
    state.probGraph?.addDeepRaw(payload.ref.frameId,{rawDepth:d.rawDepth,rawWidth:d.rawWidth,rawHeight:d.rawHeight,calibration:null,quality:d.quality});scheduleLiveOptimization('deep-suspicious',{slow:true});
    state.deepSelector?.fail?.();const band=Math.round(100*Number(d.quality?.stripe?.dominantExplained||0));log.warn('deep-depth-quality-rejected',{jobId:d.jobId,quality:d.quality,resolutionRescue:d.resolutionRescue||null});if($('mvsState'))$('mvsState').textContent=`Deep anomala (${band}% banding) · salvata come evidenza a bassa autorità`;stripDeepRaster(payload);state.denseActivePayload=payload;state.denseDepthWorker.postMessage(payload);return;
  }
  let cal;
  if(state.deepSequence)cal=state.deepSequence.calibrate({frameId:payload.ref.frameId,at:payload.ref.at,rawDepth:d.rawDepth,rawWidth:d.rawWidth,rawHeight:d.rawHeight,outWidth:payload.ref.width,outHeight:payload.ref.height,sparseSeeds:payload.sparseSeeds,near:payload.near,far:payload.far});
  else{const {calibrateRelativeDepth}=await lazy('./dense/deep_metric.js');cal=calibrateRelativeDepth({rawDepth:d.rawDepth,rawWidth:d.rawWidth,rawHeight:d.rawHeight,outWidth:payload.ref.width,outHeight:payload.ref.height,sparseSeeds:payload.sparseSeeds,near:payload.near,far:payload.far,minAnchors:CONFIG.deepMinAnchors||5,minCells:CONFIG.deepMinAnchorCells||3,maxMedianRelativeError:CONFIG.deepCalibrationMaxMedianRelativeError||.35});}
  state.probGraph?.addDeepRaw(payload.ref.frameId,{rawDepth:d.rawDepth,rawWidth:d.rawWidth,rawHeight:d.rawHeight,calibration:cal?.ok?cal:null,quality:d.quality});scheduleLiveOptimization(cal?.ok?'deep-calibrated':'deep-raw',{slow:true});
  if(cal?.ok&&state.liveMap){state.liveMapStats=state.liveMap.updateDepth(payload.ref.frameId,{depth:cal.depth,width:cal.width,height:cal.height,confidence:cal.posteriorConfidence??cal.confidence,mode:cal.sequenceMode||cal.mode,calibration:{ok:true,mode:cal.sequenceMode||cal.mode,a:cal.a,b:cal.b,confidence:cal.posteriorConfidence??cal.confidence,posteriorConfidence:cal.posteriorConfidence??cal.confidence}})?state.liveMap.stats():state.liveMapStats;scheduleLiveMapRender(true);}
  if(!cal?.ok){
    state.deepSelector?.fail?.();log.info('deep-depth-calibration-uncertain',{jobId:d.jobId,reason:cal?.reason||'unknown',anchors:cal?.anchorCount||payload.sparseSeeds.length});if($('mvsState'))$('mvsState').textContent=`Deep relativa salvata · scala non ancora osservabile (${cal?.reason||'pochi anchor'})`;stripDeepRaster(payload);state.denseActivePayload=payload;state.denseDepthWorker.postMessage(payload);return;
  }
  state.deepSelector?.commit?.(payload.ref,payload.sparseSeeds);state.deepAccepted++;
  payload.depthPrior={depth:cal.depth,relativeSigma:cal.relativeSigma,width:cal.width,height:cal.height,confidence:cal.posteriorConfidence??cal.confidence,mode:cal.sequenceMode||cal.mode};
  payload.deepCalibration={confidence:cal.posteriorConfidence??cal.confidence,medianRelativeError:cal.medianRelativeError,heldOutRelativeError:cal.heldOutRelativeError??null,sequenceSigma:cal.sequenceSigma??null,mode:cal.sequenceMode||cal.mode,a:cal.a,b:cal.b};
  const uncertainty=Math.max(.06,Number(cal.sequenceSigma??cal.medianRelativeError??.18));Object.assign(payload.config,{priorRelRange:clampNumber(Math.max(CONFIG.deepPriorRelRange||.26,uncertainty*2.2),.18,.55),priorDepthSteps:CONFIG.deepPriorDepthSteps||10,priorWeight:0,priorMinConfidence:CONFIG.deepPriorMinConfidence||.08,priorMinTexture:CONFIG.deepPriorMinTexture||.006});
  log.info('deep-sequence-calibrated',{jobId:d.jobId,provider:d.provider,aiMs:d.ms,frameMode:cal.frameMode||cal.mode,sequenceMode:cal.sequenceMode||cal.mode,confidence:cal.posteriorConfidence??cal.confidence,anchors:cal.anchorCount,medianRelativeError:cal.medianRelativeError,heldOutRelativeError:cal.heldOutRelativeError??null,sequenceSigma:cal.sequenceSigma??null,parameterDrift:cal.parameterDrift??null});
  if($('mvsState'))$('mvsState').textContent=`Deep seq ${cal.sequenceMode||cal.mode} · σ ${(100*uncertainty).toFixed(1)}% · MVS indipendente`;
  stripDeepRaster(payload);state.denseActivePayload=payload;state.denseDepthWorker.postMessage(payload);
}
function clampNumber(v,a,b){return Math.max(a,Math.min(b,v));}
async function handleDenseDepthMessage(d){
  if(d.type==='ready'){if($('mvsState'))$('mvsState').textContent='PROXY mapper pronto · Deep+track+multi-view';return;}
  if(d.type==='depth-error'){
    state.denseBusy=false;state.denseActivePayload=null;log.warn('dense-depth',{jobId:d.jobId,message:d.message,stack:d.stack||null});if($('mvsState'))$('mvsState').textContent='Refinement multi-view fallito · continuo con Alva';void scheduleDenseWork();return;
  }
  if(d.type!=='depth-result')return;
  const payload=state.denseActivePayload&&state.denseActivePayload.jobId===d.jobId?state.denseActivePayload:null;state.denseActivePayload=null;state.denseBusy=false;
  if(d.medianDepth){state.denseDepthHint=state.denseDepthHint?state.denseDepthHint*.7+d.medianDepth*.3:d.medianDepth;state.liveMap?.setFallbackDepth(state.denseDepthHint);}
  state.denseDepthSamples+=d.samples?.length||0;if(d.samples?.length&&state.liveMap){state.liveMap.addWorldSamples(d.samples,{maxAdd:CONFIG.livePuzzleMvsAdd||700,source:'mvs'});scheduleLiveMapRender();}if(payload?.ref){state.probGraph?.addMvs(payload.ref.frameId,d.samples||[],{sourceFrames:(payload.sources||[]).map(x=>x.frameId||x.id)});if(d.samples?.length)scheduleLiveOptimization('mvs-evidence',{slow:false});}if(d.ms>1800){state.densePixelStep=Math.min(5,(state.densePixelStep||3)+1);state.denseSourceLimit=2;}else if(d.ms<650){state.densePixelStep=Math.max(3,(state.densePixelStep||3)-1);state.denseSourceLimit=Math.min(3,CONFIG.denseMaxSourceViews||4);}if($('statTri'))$('statTri').textContent=String(state.denseDepthSamples);

  if(payload?.depthPrior?.depth?.length){
    try{
      const {depthMapToRaySamples}=await awaitImportProxySampler();
      const batch=depthMapToRaySamples({
        depth:payload.depthPrior.depth,relativeSigma:payload.depthPrior.relativeSigma,width:payload.depthPrior.width,height:payload.depthPrior.height,
        ref:payload.ref,K:payload.ref.K,baseConfidence:payload.depthPrior.confidence,
        calibrationRelativeError:payload.deepCalibration?.medianRelativeError??.12,sparseSeeds:payload.sparseSeeds,refinedSamples:d.samples||[],sourceFrames:(payload.sources||[]).map(x=>x.frameId||x.id),
        pixelStep:CONFIG.deepRayPixelStep||4,maxSamples:CONFIG.deepRayMaxSamples||6500,source:'deep-proxy'
      });
      if(batch.samples.length){
        for(const s of batch.samples){s.poseCov=payload.ref.poseCov||null;s.probability=clampNumber((Number(s.confidence)||.1)*(payload.depthPrior.confidence||.1),.005,.995);}
        state.deepRaySamples+=batch.samples.length;if(state.liveMap){state.liveMap.addWorldSamples(batch.samples,{maxAdd:CONFIG.livePuzzleDeepAdd||850,source:'deep-proxy'});scheduleLiveMapRender();}state.denseFusionWorker?.postMessage({type:'integrate',mode:'proxy-depth',samples:batch.samples,origin:payload.ref.pose.p,frameId:payload.ref.frameId||payload.ref.id});
        log.info('proxy-depth-observations',{jobId:d.jobId,refId:payload.ref.id,samples:batch.samples.length,total:state.deepRaySamples,stats:batch.stats,mvsSamples:d.samples?.length||0});
        if($('mvsState'))$('mvsState').textContent=`PROXY ${batch.stats.verified||0} verificati + ${batch.stats.deepOnly||0} Deep · ${d.ms.toFixed(0)} ms`;
      }
    }catch(err){log.warn('proxy-depth-sampler',{jobId:d.jobId,message:err?.message||String(err)});}
  }else if(d.samples?.length){
    for(const s of d.samples){s.poseCov=payload?.ref?.poseCov||null;s.probability=clampNumber(Number(s.probability??s.confidence??.1),.005,.995);}
    state.denseFusionWorker?.postMessage({type:'integrate',mode:'mvs-refined',samples:d.samples,origin:d.origin||payload?.ref?.pose?.p||[0,0,0],frameId:payload?.ref?.frameId||d.refId});
    if($('mvsState'))$('mvsState').textContent=`MVS-only ${d.validCount||d.samples.length} px · ${(d.coverage*100).toFixed(0)}% · ${d.ms.toFixed(0)} ms`;
  }else if($('mvsState'))$('mvsState').textContent='PROXY rifiutata · serve più overlap/parallasse';
  void scheduleDenseWork();
}
let proxySamplerPromise=null;
function awaitImportProxySampler(){return proxySamplerPromise||(proxySamplerPromise=lazy('./dense/deep_ray_samples.js'));}
function handleDenseFusionMessage(d){
  if(d.type==='ready'){if($('metricPipelineHud'))$('metricPipelineHud').textContent='Surface mapper pronto · attendo depth map.';return;}
  if(d.type==='fusion-error'){log.warn('dense-fusion',{message:d.message,stack:d.stack||null});return;}
  if(d.type!=='surface-result'&&d.type!=='surface-snapshot'&&d.type!=='mesh-result')return;
  if(d.splats?.length){state.gaussians=d.splats;if(state.liveOptPreviewGaussians?.length)state.liveOverlay?.setGaussians(state.liveOptPreviewGaussians);else state.liveOverlay?.setGaussians(d.splats);if($('statGs'))$('statGs').textContent=String(d.splats.length);}
  if(d.mesh?.vertices?.length){state.mesh=d.mesh;window.__ROOMSCAN_METRIC_MESH=d.mesh;if(!state.liveOptPreviewGaussians?.length)state.liveOverlay?.setMesh(d.mesh);window.dispatchEvent(new CustomEvent('roomscan:metric-mesh',{detail:{live:true,vertices:d.mesh.vertices.length/3,faces:d.mesh.faces.length/3}}));}
  if(d.type==='mesh-result'&&d.vertices?.length){state.mesh=d;window.__ROOMSCAN_METRIC_MESH=d;if(!state.liveOptPreviewGaussians?.length)state.liveOverlay?.setMesh(d);}
  state.surfaceStats={frames:d.frames??state.surfaceStats?.frames??0,surfels:d.surfels??state.surfaceStats?.surfels??0,tsdfVoxels:d.tsdfVoxels??state.surfaceStats?.tsdfVoxels??0,confirmed:d.confirmed??d.splats?.length??state.surfaceStats?.confirmed??0};
  const faces=state.mesh?.faces?.length?state.mesh.faces.length/3:0,unit=state.slam?.metricLocked?'m':'u.Alva';
  if($('metricPipelineHud'))$('metricPipelineHud').textContent=`RAY CONSENSUS ${state.denseJobs} viste · surface ${state.surfaceStats.confirmed||0}/${state.surfaceStats.surfels||0} · TSDF ${state.surfaceStats.tsdfVoxels||0} · mesh ${faces} facce · ${unit}`;
}
async function waitForDenseIdle(timeoutMs=4500){const start=performance.now();while(state.denseBusy&&performance.now()-start<timeoutMs)await new Promise(r=>setTimeout(r,35));}
function workerRequest(worker,message,accept,timeoutMs=3500){return new Promise(resolve=>{if(!worker)return resolve(null);const timer=setTimeout(()=>{worker.removeEventListener('message',handler);resolve(null);},timeoutMs),handler=e=>{if(!accept(e.data||{}))return;clearTimeout(timer);worker.removeEventListener('message',handler);resolve(e.data||null);};worker.addEventListener('message',handler);worker.postMessage(message);});}
function updateLiveOptimizerHud(extra=null){
  const el=$('liveOptimizerHud');if(!el)return;if(extra){el.textContent=extra;return;}const st=state.liveOptStats,g=state.liveOptGate;if(!state.liveOptReady){el.textContent='OPT LIVE · inizializzazione…';return;}if(state.liveOptInFlight){el.textContent=`OPT LIVE · ${state.liveOptLastReason||'aggiornamento'} · working…`;return;}if(!st){el.textContent='OPT LIVE · attendo scaffold RGB triangolabile';return;}const phase=st.feedbackPhase==='depth-feedback'?'Deep/confidenza':'RGB/pose',rmse=Number.isFinite(st.reprojectionRmse)?`${st.reprojectionRmse.toFixed(2)} px`:'—',score=Number.isFinite(g?.score)?` · gate ${g.score>=0?'+':''}${g.score.toFixed(2)}`:'';el.textContent=`OPT LIVE ✓ · ${phase} · reproj ${rmse}${score} · acc ${state.liveOptAcceptedCount}/rej ${state.liveOptRejected}`;
}
function stopLiveOptimizer(){if(state.liveOptTimer){clearTimeout(state.liveOptTimer);state.liveOptTimer=null;}try{state.liveOptWorker?.postMessage({type:'stop'});}catch{}try{state.liveOptWorker?.terminate();}catch{}state.liveOptWorker=null;state.liveOptReady=false;state.liveOptInFlight=false;state.liveOptDirty=false;state.liveOptPendingSlow=false;updateLiveOptimizerHud('OPT LIVE · fermo');}
function ensureLiveOptimizerWorker(){
  if(state.liveOptWorker||!state.probGraph)return state.liveOptWorker;const worker=new Worker(`${CONFIG.liveProbabilisticOptWorker||'workers/live_probabilistic_worker.js'}?v=${BUILD.version}`,{type:'module'});state.liveOptWorker=worker;state.liveOptReady=false;
  worker.onerror=e=>{log.error('live-opt-worker-error',{message:e.message||'worker error',filename:e.filename||null,line:e.lineno||null});log.checkpoint('live-opt-worker-error',{message:e.message||null,graph:state.probGraph?.summary?.()||null});persistEmergencyDiagnostics('live-opt-worker-error');stopLiveOptimizer();};
  worker.onmessage=e=>handleLiveOptimizerMessage(e.data||{});worker.postMessage({type:'init',initial:state.liveOptAccepted||null});log.info('live-opt-worker-created',{worker:CONFIG.liveProbabilisticOptWorker||'workers/live_probabilistic_worker.js'});updateLiveOptimizerHud();return worker;
}
function scheduleLiveOptimization(reason,{slow=false,force=false}={}){
  if(!state.probGraph||CONFIG.liveProbabilisticOptimization===false)return;const g=state.probGraph.summary?.()||{};state.liveOptLastReason=reason;state.liveOptDirty=true;state.liveOptPendingSlow=state.liveOptPendingSlow||!!slow;if(state.liveOptInFlight){log.debug('live-opt-coalesced',{reason,slow,graph:g});return;}const minFrames=CONFIG.liveOptMinFrames||2,minLandmarks=CONFIG.liveOptMinLandmarks||6;if((g.frames||0)<minFrames||(g.landmarks||0)<minLandmarks){log.debug('live-opt-deferred-main',{reason,cause:'insufficient-scaffold',graph:g});updateLiveOptimizerHud('OPT LIVE · attendo più triangolazione RGB');return;}
  ensureLiveOptimizerWorker();const now=performance.now(),baseGap=slow?(CONFIG.liveOptSlowMinIntervalMs||850):(CONFIG.liveOptFastMinIntervalMs||420),minGap=baseGap*Math.max(1,state.liveOptBackoff||1),wait=force?0:Math.max(0,minGap-(now-state.liveOptLastAt));if(state.liveOptTimer){clearTimeout(state.liveOptTimer);state.liveOptTimer=null;}state.liveOptTimer=setTimeout(()=>flushLiveOptimization(reason,{slow:state.liveOptPendingSlow||slow}),wait);log.debug('live-opt-scheduled',{reason,slow,waitMs:wait,backoff:state.liveOptBackoff,graph:g,inFlight:state.liveOptInFlight});
}
function flushLiveOptimization(reason,{slow=false}={}){void flushLiveOptimizationAsync(reason,{slow});}
async function flushLiveOptimizationAsync(reason,{slow=false}={}){
  state.liveOptTimer=null;slow=!!(slow||state.liveOptPendingSlow);state.liveOptPendingSlow=false;if(!state.liveOptWorker||!state.probGraph)return;const fullSummary=state.probGraph.summary?.()||{};if((fullSummary.frames||0)<(CONFIG.liveOptMinFrames||2)||(fullSummary.landmarks||0)<(CONFIG.liveOptMinLandmarks||6))return;state.liveOptInFlight=true;state.liveOptDirty=false;updateLiveOptimizerHud();
  // Feed the worker the current photographic edges before taking the immutable
  // graph snapshot. They are switchable evidence, never hard pose truth.
  const panorama=state.liveMap?.exportState?.()||null;if(panorama?.edges?.length)state.probGraph.addPhotoEdges?.(panorama.edges);
  const rawGraph=state.probGraph.exportState(),{buildLiveGraphWindow}=await lazy('./probabilistic/live_graph_window.js');if(!state.liveOptWorker){state.liveOptInFlight=false;return;}const graph=buildLiveGraphWindow(rawGraph,{maxFrames:slow?(CONFIG.liveOptSlowGraphFrames||26):(CONFIG.liveOptFastGraphFrames||16),maxLoopFrames:CONFIG.liveOptGraphLoopFrames||6,recentLoopSeeds:6,includePhotoPixels:!!slow}),summary=graph.summary||{},generation=++state.liveOptGeneration,budgetMs=slow?(CONFIG.liveOptSlowBudgetMs||95):(CONFIG.liveOptFastBudgetMs||38),maxIterations=slow?(CONFIG.liveOptSlowIterations||2):(CONFIG.liveOptFastIterations||1);state.liveOptLastAt=performance.now();
  log.info('live-opt-dispatch',{generation,reason,slow,budgetMs,maxIterations,graph:summary,fullGraph:fullSummary,window:graph.windowDiagnostics||null,acceptedSeed:!!state.liveOptAccepted,backoff:state.liveOptBackoff,device:{visibility:document.visibilityState}});log.checkpoint('live-opt-dispatch',{generation,reason,frames:summary.frames,landmarks:summary.landmarks,deepFrames:summary.deepFrames,photoEdges:summary.photoEdges,windowFrames:graph.windowDiagnostics?.selectedFrames,excludedFrames:graph.windowDiagnostics?.excludedFrames});
  state.liveOptWorker.postMessage({type:'sync',generation,reason,graph,budgetMs,maxIterations,maxPreviewLandmarks:CONFIG.liveOptPreviewLandmarks||320,maxPreviewAnchors:CONFIG.liveOptPreviewAnchors||90,previewMap:!!slow,previewVoxel:state.slam?.metricLocked?(CONFIG.liveOptPreviewVoxelM||.055):(CONFIG.liveOptPreviewVoxelAlva||.05),previewMaxSurfels:CONFIG.liveOptPreviewSurfels||2200,previewMaxTriangles:CONFIG.liveOptPreviewTriangles||900,previewMaxDeepSamples:CONFIG.liveOptPreviewDeepSamples||3200,previewMaxMvsSamples:CONFIG.liveOptPreviewMvsSamples||3800,options:{maxLandmarks:Math.min(CONFIG.liveOptMaxLandmarks||4500,CONFIG.probabilisticMaxLandmarks||12000),maxObsPerFrame:Math.min(CONFIG.liveOptMaxObsPerFrame||150,CONFIG.probabilisticMaxObsPerFrame||280),posePriorScale:CONFIG.probabilisticPosePriorScale||1,absoluteAlvaScale:CONFIG.probabilisticAbsoluteAlvaScale||.04,depthFeedbackEvery:slow?1:(CONFIG.liveOptDepthFeedbackEvery||3),localWindowSize:CONFIG.liveOptLocalWindowSize||10,localWindowOverlap:CONFIG.liveOptLocalWindowOverlap||3},gateOptions:{maxReprojectionPx:CONFIG.liveOptGateMaxReprojectionPx||3.2,maxCommonTranslationJump:state.slam?.metricLocked?(CONFIG.liveOptGateMaxTranslationM||.11):(CONFIG.liveOptGateMaxTranslationAlva||.14),maxCommonRotationJumpRad:CONFIG.liveOptGateMaxRotationRad||.07,maxMeanTranslationJump:state.slam?.metricLocked?(CONFIG.liveOptGateMeanTranslationM||.045):(CONFIG.liveOptGateMeanTranslationAlva||.06)}});
}
function handleLiveOptimizerMessage(d){
  if(d.type==='live-opt-ready'){state.liveOptReady=true;updateLiveOptimizerHud();log.info('live-opt-ready',{seeded:!!d.accepted});return;}
  if(d.type==='live-opt-error'){state.liveOptInFlight=false;log.error('live-opt-worker',{message:d.message,stack:d.stack||null});log.checkpoint('live-opt-error',{message:d.message,graph:state.probGraph?.summary?.()||null});persistEmergencyDiagnostics('live-opt-error');updateLiveOptimizerHud('OPT LIVE · errore, misura continua');return;}
  if(d.type==='live-opt-trace'){log.debug(`live-opt-${d.event||'trace'}`,{generation:d.generation,...(d.data||{})},{traceId:`liveopt-${d.generation}`});return;}
  if(d.type==='live-opt-deferred'){state.liveOptInFlight=false;log.debug('live-opt-deferred-worker',d);updateLiveOptimizerHud('OPT LIVE · scaffold ancora debole');return;}
  if(d.type==='live-opt-rejected'){
    state.liveOptInFlight=false;state.liveOptRejected++;state.liveOptLastElapsedMs=Number(d.elapsedMs)||0;state.liveOptBackoff=adaptLiveOptBackoff(state.liveOptBackoff,d.solveMs??d.elapsedMs,d.mapMs||0);state.liveOptGate=d.gate||null;state.liveOptLastReason=d.trigger||state.liveOptLastReason;log.warn('live-opt-candidate-rejected',{generation:d.generation,trigger:d.trigger,elapsedMs:d.elapsedMs,iterations:d.iterations,gate:d.gate,workingGate:d.workingGate||null,workingRetained:!!d.workingRetained,baseline:d.baselineStats,candidate:d.stats,steps:d.steps,graph:d.summary});log.checkpoint('live-opt-rejected',{generation:d.generation,reason:d.trigger,accepted:false,reprojectionRmse:d.stats?.reprojectionRmse,deepRelativeError:d.stats?.deepRelativeError,hardReasons:d.gate?.hardReasons||[]});updateLiveOptimizerHud(`OPT LIVE · candidato rifiutato (${(d.gate?.hardReasons||[]).join(', ')||'gate conservativo'}) · preview invariata${d.workingRetained?' · working continua':''}`);if(state.liveOptDirty)scheduleLiveOptimization(state.liveOptLastReason||'pending',{slow:state.liveOptPendingSlow});return;
  }
  if(d.type==='live-opt-accepted'){
    state.liveOptInFlight=false;state.liveOptLastElapsedMs=Number(d.elapsedMs)||0;state.liveOptBackoff=adaptLiveOptBackoff(state.liveOptBackoff,d.solveMs??d.elapsedMs,d.mapMs||0);state.liveOptAccepted=d.snapshot||state.liveOptAccepted;state.liveOptStats=d.stats||state.liveOptStats;state.liveOptGate=d.gate||null;state.liveOptAcceptedCount++;state.liveOptLastReason=d.trigger||state.liveOptLastReason;const smoothed=smoothAcceptedAnchors(d.anchors||[]);state.liveOptAcceptedAnchors=smoothed;state.geometryAnchors=smoothed;state.liveOverlay?.setGeometryAnchors(smoothed);if(d.previewGaussians?.length){state.liveOptPreviewGaussians=mergeStablePreviewGaussians(state.liveOptPreviewGaussians,d.previewGaussians,{voxel:state.slam?.metricLocked?(CONFIG.liveOptPreviewMergeVoxelM||.045):(CONFIG.liveOptPreviewMergeVoxelAlva||.04),max:CONFIG.liveOptPreviewMaxAccumulatedSurfels||6500});state.liveOptPreviewStats=d.previewStats||null;state.liveOverlay?.setGaussians(state.liveOptPreviewGaussians);state.liveOverlay?.setMesh(null);}log.decision('live-opt-candidate-accepted',{generation:d.generation,trigger:d.trigger,elapsedMs:d.elapsedMs,iterations:d.iterations,gate:d.gate,stats:d.stats,steps:d.steps,graph:d.summary,anchors:smoothed.length,previewMap:{gaussians:d.previewGaussians?.length||0,mapMs:d.mapMs||0,stats:d.previewStats||null}});log.checkpoint('live-opt-accepted',{generation:d.generation,reason:d.trigger,accepted:true,reprojectionRmse:d.stats?.reprojectionRmse,deepRelativeError:d.stats?.deepRelativeError,frames:d.summary?.frames,landmarks:d.summary?.landmarks});updateLiveOptimizerHud();if(state.liveOptDirty)scheduleLiveOptimization(state.liveOptLastReason||'pending',{slow:state.liveOptPendingSlow});return;
  }
}
function smoothAcceptedAnchors(next){const old=new Map((state.liveOptAcceptedAnchors||[]).map(x=>[String(x.id),x])),a=clampNumber(CONFIG.liveOptPreviewSmoothing??.34,.05,.8),out=[];for(const x of next||[]){if(!Array.isArray(x?.p)||x.p.length<3)continue;const o=old.get(String(x.id)),p=o?.p?[o.p[0]*(1-a)+x.p[0]*a,o.p[1]*(1-a)+x.p[1]*a,o.p[2]*(1-a)+x.p[2]*a]:x.p.slice(0,3);out.push({...x,p,confidence:clampNumber(x.confidence??.5,.01,1)});}return out.slice(0,CONFIG.liveOptPreviewAnchors||90);}
function adaptLiveOptBackoff(current,solveMs,mapMs){let b=Math.max(1,Number(current)||1),cost=Math.max(0,Number(solveMs)||0)+.35*Math.max(0,Number(mapMs)||0);if(cost>180)b=Math.min(3,b*1.28);else if(cost>110)b=Math.min(3,b*1.12);else if(cost<65)b=Math.max(1,b*.92);return b;}
function mergeStablePreviewGaussians(previous,next,{voxel=.045,max=6500}={}){const cell=Math.max(.008,Number(voxel)||.045),map=new Map(),rank=x=>(Number(x?.confidence)||.1)+.08*(Number(x?.support)||0)+(x?.evidenceClass==='strong'?.35:x?.evidenceClass==='confirmed'?.18:0),key=p=>`${Math.round(p[0]/cell)},${Math.round(p[1]/cell)},${Math.round(p[2]/cell)}`;for(const g of previous||[]){const p=g?.position||g?.p;if(!Array.isArray(p)||p.length<3)continue;map.set(key(p),g);}for(const g of next||[]){const p=g?.position||g?.p;if(!Array.isArray(p)||p.length<3)continue;const k=key(p),old=map.get(k);if(!old){map.set(k,g);continue;}const op=old.position||old.p,a=clampNumber(.28+.35*Math.max(Number(g.confidence)||0,Number(old.confidence)||0),.22,.58),position=[op[0]*(1-a)+p[0]*a,op[1]*(1-a)+p[1]*a,op[2]*(1-a)+p[2]*a];map.set(k,rank(g)>=rank(old)?{...g,position}:{...old,position,confidence:Math.max(Number(old.confidence)||0,Number(g.confidence)||0)});}const out=[...map.values()];if(out.length<=max)return out;out.sort((a,b)=>rank(b)-rank(a));return out.slice(0,max);}
function stopScan(){stopLiveOptimizer();scanAbortController?.abort();scanAbortController=null;state.scanStop?.();state.scanStop=null;state.camera?.stop();state.camera=null;state.deepDepthWorker?.terminate();state.deepDepthWorker=null;state.deepWorkerModelId=null;state.deepSelector?.reset?.();state.deepSelector=null;state.deepPending=null;state.deepJobs.clear();state.deepPreviewInFlight=null;state.deepPreviewLastAt=0;state.photoSurveyLastAt=0;state.denseDepthWorker?.terminate();state.denseDepthWorker=null;state.denseFusionWorker?.terminate();state.denseFusionWorker=null;state.denseManager?.reset?.();state.denseManager=null;state.denseBusy=false;state.liveOverlay=null;const depth=$('depthOverlay');if(depth)depth.getContext('2d')?.clearRect(0,0,depth.width,depth.height);if($('deepLiveState'))$('deepLiveState').textContent='DEEP LIVE —';state.liveMapRenderPending=false;}
async function finishScan(){
  // Closing quality is judged first from the photo-only graph. Alva coverage is
  // secondary geometric guidance and must never define photographic closure.
  const photo=state.liveMap?.stats?.()||null,cov=state.coverageStatus;
  if(photo&&photo.frames>=5&&(photo.connectedFraction<.80||photo.loops<1)){
    const conn=Math.round(100*(photo.connectedFraction||0)),msg=`Il mosaico fotografico non risulta ancora ben chiuso (${conn}% foto nella componente principale, ${photo.edges||0} collegamenti, ${photo.loops||0} loop).\n\nRipassa visivamente le zone gia viste finche le fotografie si ricollegano; la posa Alva non viene usata per decidere questo allineamento.\n\nTerminare comunque?`;
    if(!window.confirm(msg)){if($('coach'))$('coach').textContent='Ripassa una zona gia fotografata: serve una chiusura RGB del mosaico.';return;}
  }else if(!photo&&cov&&!cov.readyToClose&&state.slam?.keyframes?.length>=5){
    const pct=Math.round(100*(cov.strongCoverage||0)),conn=Math.round(100*(cov.connectedFraction||0)),msg=`La copertura geometrica e ancora incompleta (${pct}% copertura forte, ${conn}% viste connesse).\n\n${cov.guidance||'Ripassa le zone deboli.'}\n\nTerminare comunque?`;
    if(!window.confirm(msg)){if($('coach'))$('coach').textContent=cov.guidance||'Ripassa la zona meno coperta prima di terminare.';return;}
  }
  await waitForDenseIdle();
  // Persist the compact multi-view ray reservoir BEFORE terminating the fusion
  // worker. This makes later iterative optimisation a real geometric refinement
  // rather than a smoothing pass over an already flattened PLY.
  const persisted=await workerRequest(state.denseFusionWorker,{type:'persist',maxSurfels:CONFIG.postOptimizeMaxGaussians||70000,maxObservationsPerSurfel:CONFIG.postOptimizeObservationReservoir||4},d=>d.type==='fusion-persist',6000);
  if(persisted?.state?.gaussians?.length){state.gaussians=persisted.state.gaussians;state.optimizerObservations=persisted.state.observations||null;}
  else{const snap=await workerRequest(state.denseFusionWorker,{type:'snapshot',maxSplats:CONFIG.gaussianSnapshot},d=>d.type==='surface-snapshot',2500);if(snap?.splats?.length)state.gaussians=snap.splats;}
  const mesh=await workerRequest(state.denseFusionWorker,{type:'mesh',maxTriangles:CONFIG.denseMaxMeshTriangles||90000,maxSurfels:CONFIG.denseFinalTsdfMaxSurfels||60000},d=>d.type==='mesh-result',10000);if(mesh?.vertices?.length){state.mesh=mesh;state.meshStale=false;state.geometryCommitted=false;window.__ROOMSCAN_METRIC_MESH=mesh;}
  const kfCount=state.slam?.keyframes?.length||0;state.reviewKeyframes=kfCount;state.reviewMetricLocked=!!state.slam?.metricLocked;stopScan();
  await persistCurrentSession({status:'finished',keyframes:kfCount});
  await renderSessions();await showReview();
  // The live TSDF is only a preview. Final/committed geometry is rebuilt from
  // the hierarchical factor graph into local submaps after the sparse scaffold
  // and depth calibration have stabilised.
  if(state.probGraph?.landmarkFactors?.length>=4&&state.probGraph?.deepFactors?.length){updateOptimizerUi('Preview salvata · avvio scaffold → calibrazione Deep → submap…');void startProbabilisticOptimization().catch(err=>{log.warn('auto-hierarchical-opt',{message:err?.message||String(err)});updateOptimizerUi('Preview disponibile · ottimizzazione gerarchica avviabile manualmente.');});}
}

async function persistCurrentSession({status='finished',keyframes=state.reviewKeyframes||0}={}){
  if(!state.currentSession||!state.db)return null;const id=state.currentSession.id,faces=state.mesh?.faces?.length?state.mesh.faces.length/3:0;
  const photoPanorama=state.liveMap?.exportState?.()||state.photoPanoramaState||null;state.photoPanoramaState=photoPanorama;
  // RGB overlap edges are persisted as switchable geometric evidence. They are
  // never pose truth: the hierarchical optimizer may weaken an entire edge.
  if(photoPanorama?.edges?.length)state.probGraph?.addPhotoEdges?.(photoPanorama.edges);
  const graphState=state.probGraph?.exportState?.()||state.probGraph||null,deepSequence=state.deepSequence?.exportState?.()||null;
  const snapshot={id,sessionId:id,format:'ROOMSCAN-PUZZLE-SESSION-5',savedAt:Date.now(),build:BUILD.id,gaussians:state.gaussians,optimizerObservations:state.optimizerObservations||null,factorGraph:graphState,deepSequence,photoPanorama,probOptimization:state.probOptimization||null,liveOptimization:state.liveOptAccepted?{snapshot:state.liveOptAccepted,stats:state.liveOptStats,gate:state.liveOptGate,accepted:state.liveOptAcceptedCount,rejected:state.liveOptRejected}:null,puzzleReconstruction:state.puzzleReconstruction||null,coverageSummary:coverageSnapshot(),optimization:{...(state.optimization||{iterations:0})},denseSamples:state.denseDepthSamples||0,deepRaySamples:state.deepRaySamples||0,metricLocked:state.reviewMetricLocked??!!state.slam?.metricLocked,geometryCommitted:!!state.geometryCommitted,keyframes};
  await state.db.put('snapshots',snapshot);
  if(state.mesh?.vertices?.length)await state.db.put('meshes',{id,sessionId:id,format:'ROOMSCAN-MESH-1',savedAt:Date.now(),stale:!!state.meshStale,voxelM:state.mesh.voxelM||null,occupiedVoxels:state.mesh.occupiedVoxels||0,vertices:state.mesh.vertices,colors:state.mesh.colors,faces:state.mesh.faces});
  state.currentSession=await state.db.updateSession(id,{status,hasSnapshot:true,optimizationIterations:state.optimization?.iterations||0,counts:{keyframes,denseSamples:state.denseDepthSamples||0,surfels:state.gaussians.length,gaussians:state.gaussians.length,meshFaces:state.meshStale?0:faces}});
  log.info('session-persisted',{id,gaussians:state.gaussians.length,optimizerObservations:state.optimizerObservations?.count||0,factorGraph:graphState?.summary||state.probGraph?.summary?.()||null,iterations:state.optimization?.iterations||0,photoPanorama:photoPanorama?.stats||null,meshFaces:state.meshStale?0:faces});return state.currentSession;
}

async function showReview(){
  show('review');const {GaussianRenderer}=await lazy('./gaussian/renderer.js');if(!state.renderer)state.renderer=new GaussianRenderer($('viewer'));const lab=state.surfaceLab||{},usePuzzle=!!(state.puzzleActive&&state.puzzlePreview),useExp=!usePuzzle&&!!(lab.active&&lab.previewGaussians?.length);state.renderer.setData(usePuzzle?(state.puzzlePreview.gaussians||[]):useExp?lab.previewGaussians:state.gaussians,{fit:true});state.renderer.setMesh(usePuzzle?(state.puzzlePreview.mesh||null):useExp?(lab.mesh||null):(state.mesh&&!state.meshStale?state.mesh:null));state.renderer.draw();updateReviewUi();updateSurfaceLabUi();updatePuzzleUi();if(state.puzzleAtlas)drawPuzzleAtlas(state.puzzleAtlas);
}
function updateReviewUi(){
  const faces=!state.meshStale&&state.mesh?.faces?.length?state.mesh.faces.length/3:0,metric=state.reviewMetricLocked??!!state.slam?.metricLocked,kf=state.reviewKeyframes||state.slam?.keyframes?.length||0,iterations=state.optimization?.iterations||0;
  if($('reviewStats'))$('reviewStats').textContent=`Surface splat: ${state.gaussians.length} · depth sample ${state.denseDepthSamples||0} · scala ${metric?'metrica':'Alva libera'} · keyframe ${kf} · ottimizzazione ${iterations} iterazioni`;
  if($('metricGsStats'))$('metricGsStats').textContent=state.meshStale?'Mesh precedente non mostrata: le Gaussiane sono cambiate dopo l’ottimizzazione. La mesh per superfici verrà rigenerata in un passaggio dedicato.':state.mesh?`${state.geometryCommitted?'GEOMETRIA COMMITTED':'PREVIEW PROVVISORIA'}: ${state.mesh.vertices.length/3} vertici / ${faces} facce · ${state.geometryCommitted?'submap fuse dopo scaffold e calibrazione Deep':'fusione live non irreversibile: la finale verrà ricostruita dalle evidenze'}.`:'TSDF mesh non disponibile: la mappa Gaussian resta comunque ricaricabile e ottimizzabile.';
  const input=$('optIterations');if(input&&document.activeElement!==input)input.value=String(Math.max(Number(input.value)||0,iterations||CONFIG.postOptimizeDefaultIterations||30));updateOptimizerUi();
}


function setScanDiagnosticsOpen(open){const dock=$('scanDiagnostics'),toggle=$('scanDiagnosticsToggle');if(dock)dock.classList.toggle('open',!!open);if(toggle){toggle.setAttribute('aria-expanded',open?'true':'false');toggle.textContent=open?'Chiudi mappa':'Mappa';}}
function toggleScanDiagnostics(){setScanDiagnosticsOpen(!$('scanDiagnostics')?.classList.contains('open'));}
function setLiveMapMode(mode){state.liveMapMode=mode==='depth'?'depth':'photo';updateLiveMapUi();scheduleLiveMapRender(true);}
function updateLiveMapUi(extra=null){
  const photo=$('liveMapPhotoBtn'),depth=$('liveMapDepthBtn'),status=$('liveMapState'),s=state.liveMap?.stats?.()||state.liveMapStats||{};
  if(photo)photo.classList.toggle('active',state.liveMapMode==='photo');if(depth)depth.classList.toggle('active',state.liveMapMode==='depth');if(!status)return;if(extra){status.textContent=extra;return;}if(!s.frames){status.textContent=`${state.liveMapMode==='depth'?'DEPTH CONSENSUS':'MOSAICO RGB+DEPTH'} · attendo primo frame con Depth valida…`;return;}
  const placed=s.visualRegisteredFrames||0,pending=Math.max(0,(s.frames||0)-placed),visual=`${placed} foto unite${pending?` · ${pending} in attesa overlap`:''}`;
  if(state.liveMapMode==='photo')status.textContent=`MOSAICO RGB+DEPTH · ${visual} · ${s.rawDepthFrames||0} depth associate · nessun punto/posa · ${(100*(s.coverage||0)).toFixed(0)}% canvas`;
  else{const metric=s.metricDepthFrames||0,cons=s.depthConsensusAlignedFrames||0,derr=Number.isFinite(s.depthConsensusError)&&s.depthConsensusError<9?` · err overlap ${(100*s.depthConsensusError).toFixed(1)}%`:'',amb=s.depthAmbiguousFraction>0?` · amb ${(100*s.depthAmbiguousFraction).toFixed(0)}%`:'';status.textContent=`DEPTH PREVIEW · Deep ${s.rawDepthFrames||0}F · overlap ${cons}F · scala affine provvisoria · metriche ${metric}F${derr}${amb} · ${(100*(s.coverage||0)).toFixed(0)}% canvas`;}
}

function scheduleLiveMapRender(force=false){
  if(!state.liveMap||!$('liveMapCanvas'))return;if(state.liveMapRenderPending&&!force)return;state.liveMapRenderPending=true;const run=()=>{state.liveMapRenderPending=false;try{state.liveMapStats=state.liveMap.render($('liveMapCanvas'),state.liveMapMode);updateLiveMapUi();}catch(err){log.warn('live-photo-puzzle-render',{message:err?.message||String(err)});updateLiveMapUi('LIVE MAP · errore render, ricostruzione continua');}};if(typeof requestAnimationFrame==='function')requestAnimationFrame(run);else setTimeout(run,0);
}

function coverageSnapshot(){
  const s=state.coverageStatus;if(!s)return null;return {cols:s.cols||CONFIG.coverageSphereCols||24,rows:s.rows||CONFIG.coverageSphereRows||12,coverage:s.coverage||0,strongCoverage:s.strongCoverage||0,seenCoverage:s.seenCoverage||0,connectedFraction:s.connectedFraction||0,closureConfidence:s.closureConfidence||0,readyToClose:!!s.readyToClose,loopClosures:s.loopClosures||0,lastLoop:s.lastLoop||null,guidance:s.guidance||null,cells:Array.from(s.cells||[])};
}
function updateCoverageUi(){
  const s=state.coverageStatus,el=$('coverageState');if(!s||!el)return;const pct=Math.round(100*(s.strongCoverage||0)),seen=Math.round(100*(s.seenCoverage||0)),conn=Math.round(100*(s.connectedFraction||0)),close=Math.round(100*(s.closureConfidence||0));el.textContent=`SFERA ${pct}% forte / ${seen}% vista · conn ${conn}% · loop ${s.loopClosures||0} · chiusura ${close}%${s.readyToClose?' ✓':''} · ${s.guidance||''}`;if($('coach')&&s.guidance&&((s.currentQuality||0)<.45||!s.currentConnected||s.readyToClose))$('coach').textContent=s.guidance;
}
function stopPuzzleWorker(){try{state.puzzleWorker?.terminate();}catch{}state.puzzleWorker=null;state.puzzleBusy=false;updatePuzzleUi();}
function requestStopPuzzle(){if(state.puzzleWorker&&state.puzzleBusy){state.puzzleWorker.postMessage({type:'stop'});updatePuzzleUi('Arresto al termine del passo corrente…');}}
function puzzleParticleBudget(){return Math.max(CONFIG.puzzleMinParticles||1000,Math.min(CONFIG.puzzleMaxParticles||10000,Math.round(Number($('puzzleParticles')?.value)||CONFIG.puzzleDefaultParticles||3000)));}
function puzzleIterationTarget(){return Math.max(0,Math.min(CONFIG.puzzleMaxIterations||240,Math.round(Number($('puzzleIterations')?.value)||CONFIG.puzzleDefaultIterations||35)));}
function updatePuzzleUi(extra=null){
  const start=$('puzzleStartBtn'),stop=$('puzzleStopBtn'),base=$('puzzleBaseBtn'),view=$('puzzleViewBtn'),download=$('puzzleExportBtn'),progress=$('puzzleProgress'),status=$('puzzleStatus'),target=puzzleIterationTarget(),cur=state.puzzleReconstruction?.iteration||0,stats=state.puzzleReconstruction?.stats||state.puzzleStats||{};
  if(start)start.disabled=state.puzzleBusy||state.postOptBusy||!!state.surfaceLab?.busy||!state.probGraph?.frames?.length;if(stop)stop.disabled=!state.puzzleBusy;if(base)base.disabled=!state.puzzleActive;if(view)view.disabled=state.puzzleActive||!state.puzzlePreview;if(download)download.disabled=!state.puzzlePreview?.mesh?.vertices?.length;
  if(progress){progress.max=Math.max(1,target);progress.value=Math.min(progress.max,cur);}
  if(status)status.textContent=extra||`${state.puzzleActive?'PUZZLE':'BASE'} · ${cur}/${target} iter · particelle ${state.puzzleReconstruction?.particleBudget||puzzleParticleBudget()} · piani ${stats.planes??0} · foto connesse ${Math.round(100*(stats.connectedFraction||0))}%${Number.isFinite(stats.validationLoss)?` · validation ${stats.validationLoss.toFixed(4)}`:''}${Number.isFinite(stats.depthAlignmentError)?` · depth graph ${stats.depthAlignmentError.toFixed(3)}`:''}${stats.shoeboxConfidence?` · shoebox ${(100*stats.shoeboxConfidence).toFixed(0)}%`:''}`;
}
function drawPuzzleAtlas(atlas){
  const canvas=$('photoSpherePreview');if(!canvas||!atlas?.rgba?.length)return;canvas.width=atlas.width;canvas.height=atlas.height;const g=canvas.getContext('2d'),img=new ImageData(atlas.rgba instanceof Uint8ClampedArray?atlas.rgba:new Uint8ClampedArray(atlas.rgba),atlas.width,atlas.height);g.putImageData(img,0,0);
}
function renderPuzzleBase(){state.puzzleActive=false;if(state.surfaceLab)state.surfaceLab.active=false;if(state.renderer){state.renderer.setData(state.gaussians,{fit:false});state.renderer.setMesh(state.mesh&&!state.meshStale?state.mesh:null);state.renderer.draw();}updatePuzzleUi('BASE attiva · il risultato Photo Puzzle resta separato e può essere riaperto.');}
function renderPuzzleResult(){if(!state.puzzlePreview){updatePuzzleUi('Nessun risultato Photo Puzzle: avvia prima la ricostruzione.');return;}state.puzzleActive=true;if(state.surfaceLab)state.surfaceLab.active=false;if(state.renderer){state.renderer.setData(state.puzzlePreview.gaussians||[],{fit:false});state.renderer.setMesh(state.puzzlePreview.mesh||null);state.renderer.draw();}updatePuzzleUi();}
async function startPuzzleReconstruction(){
  if(!state.probGraph?.frames?.length)throw new Error('il Photo Puzzle richiede una sessione V30.28+ con factor graph e fotografie compatte');if(state.postOptBusy)throw new Error('ferma prima l’ottimizzazione batch legacy');if(state.surfaceLab?.busy)throw new Error('ferma prima Surface Mesh Lab');
  const particleBudget=puzzleParticleBudget(),target=puzzleIterationTarget(),old=state.puzzleReconstruction,compatible=old?.format==='ROOMSCAN-PUZZLE-HYBRID-1'&&Number(old.particleBudget)===particleBudget,base=compatible?(old.iteration||0):0,remaining=Math.max(0,target-base);stopPuzzleWorker();state.puzzleBusy=true;state.puzzleRunBase=base;state.puzzleActive=true;state.puzzleAtlas=null;
  const worker=new Worker(`${CONFIG.puzzleWorker}?v=${BUILD.version}`,{type:'module'});state.puzzleWorker=worker;worker.onerror=e=>{log.error('puzzle-worker',{message:e.message||'worker error'});stopPuzzleWorker();updatePuzzleUi('Photo Puzzle fallito: vedi Debug.');};worker.onmessage=e=>void handlePuzzleMessage(e.data||{});
  worker.__run={remaining,target,previewEvery:Math.max(1,Math.ceil(Math.max(1,remaining)/Math.max(1,CONFIG.puzzlePreviewUpdates||14)))};
  worker.postMessage({type:'init',graph:state.probGraph.exportState(),particleBudget,maxObservations:CONFIG.puzzleMaxObservations||65000,maxPlanes:CONFIG.puzzleMaxPlanes||8,initial:compatible?old:null,puzzleOptions:{atlasWidth:CONFIG.puzzleAtlasWidth||480,atlasHeight:CONFIG.puzzleAtlasHeight||240},atlasOptions:{width:CONFIG.puzzleAtlasWidth||480,height:CONFIG.puzzleAtlasHeight||240}});updatePuzzleUi(`Costruisco il grafo fotografico · ${particleBudget} particelle max · target ${target}…`);
}
async function handlePuzzleMessage(d){
  if(d.type==='puzzle-stage'){updatePuzzleUi(d.message||d.stage);return;}if(d.type==='puzzle-atlas'){state.puzzleAtlas={...d.atlas,rgba:d.atlas?.rgba instanceof Uint8ClampedArray?d.atlas.rgba:new Uint8ClampedArray(d.atlas?.rgba||[])};state.puzzleStats=d.stats||state.puzzleStats;drawPuzzleAtlas(state.puzzleAtlas);log.info('photo-puzzle-atlas',{...d.stats,coverage:d.atlas?.coverage});return;}if(d.type==='puzzle-error'){log.error('puzzle-reconstruction',{message:d.message,stack:d.stack||null});stopPuzzleWorker();updatePuzzleUi(`Errore Photo Puzzle: ${d.message}`);return;}
  if(d.type==='puzzle-ready'){state.puzzleReconstruction=d.state||state.puzzleReconstruction;state.puzzleStats=d.stats||state.puzzleStats;state.puzzlePreview=decodePuzzlePreview(d.preview);renderPuzzleResult();const run=state.puzzleWorker?.__run;if(!run)return;if(run.remaining>0){state.puzzleWorker.postMessage({type:'run',iterations:run.remaining,previewEvery:run.previewEvery});updatePuzzleUi(`Puzzle chiuso: ${Math.round(100*(d.puzzleStats?.connectedFraction||0))}% foto connesse · depth allineata ${d.depthStats?.alignedFrames||0}/${d.depthStats?.framesWithDeep||0} · ottimizzo…`);}else{state.puzzleBusy=false;stopPuzzleWorker();updatePuzzleUi('Target già raggiunto · risultato ricostruito dalla sessione salvata.');}return;}
  if(!['puzzle-progress','puzzle-done','puzzle-stopped','puzzle-preview'].includes(d.type))return;if(d.state)state.puzzleReconstruction=d.state;if(d.stats)state.puzzleStats=d.stats;if(d.preview)state.puzzlePreview=decodePuzzlePreview(d.preview);if(state.puzzleActive&&state.puzzlePreview)renderPuzzleResult();const st=d.stats||{},cur=state.puzzleReconstruction?.iteration||0;updatePuzzleUi(`${d.type==='puzzle-stopped'?'Fermato':d.type==='puzzle-done'?'Completato':'Ottimizzo'} · ${cur} iter · validation ${Number(st.validationLoss||0).toFixed(4)} · piani ${st.planes||0} · ${(100*(st.planeExplainedFraction||0)).toFixed(0)}% spiegato da piani · ${st.particles||0} particelle`);if(d.type==='puzzle-done'||d.type==='puzzle-stopped'){state.puzzleBusy=false;stopPuzzleWorker();if(state.currentSession&&state.db)persistCurrentSession({status:'puzzle-optimized',keyframes:state.reviewKeyframes||0}).then(()=>renderSessions()).catch(err=>log.warn('puzzle-persist',{message:err?.message||String(err)}));}
}
function decodePuzzlePreview(p){if(!p)return null;return {gaussians:p.gaussians||[],mesh:decodeStoredMesh(p.mesh)};}
async function exportPuzzleMesh(){if(!state.puzzlePreview?.mesh?.vertices?.length)throw new Error('mesh ibrida Photo Puzzle non disponibile');await downloadMeshPly(state.puzzlePreview.mesh,'puzzle-hybrid');}

function updateOptimizerUi(extra=null){
  const current=state.optimization?.iterations||0,status=$('optStatus'),progress=$('optProgress'),start=$('optStartBtn'),stop=$('optStopBtn'),hasRays=!!state.optimizerObservations?.count,graph=state.probGraph?.summary?.()||null;
  if(progress){progress.max=Math.max(1,Number($('optIterations')?.value)||CONFIG.postOptimizeDefaultIterations||30);progress.value=Math.min(progress.max,current);}
  if(start)start.disabled=state.postOptBusy||!!state.surfaceLab?.busy||!state.gaussians.length;if(stop)stop.disabled=!state.postOptBusy;
  if(status)status.textContent=extra||`${current} iterazioni completate · ${graph?`factor graph ${graph.frames}F/${graph.landmarks}L/${graph.mvsSamples} MVS`:hasRays?`${state.optimizerObservations.count} vincoli multi-view salvati`:'nessun reservoir di raggi: disponibile solo regolarizzazione geometrica'}${state.optimization?.lastEnergy!=null?` · loss ${Number(state.optimization.lastEnergy).toFixed(4)}`:''}`;
}

function stopPostOptimizer(){state.postOptWorker?.terminate();state.postOptWorker=null;state.postOptBusy=false;updateOptimizerUi();}
// Leaving review must never silently discard the last visible optimisation
// state. We persist the most recent preview before going back home; an
// in-flight worker iteration that has not emitted a preview is intentionally
// discarded because it has never become part of the user-visible state.
async function returnHomeFromReview(){
  const hadOptimizer=state.postOptBusy;stopPostOptimizer();stopSurfaceLabWorker({discard:true});stopPuzzleWorker();
  if(state.currentSession&&state.db&&state.gaussians.length){
    await persistCurrentSession({status:hadOptimizer?'optimized':'finished',keyframes:state.reviewKeyframes||0});
    await renderSessions();
  }
  show('home');
}
function requestStopPostOptimization(){if(state.postOptWorker&&state.postOptBusy){state.postOptWorker.postMessage({type:'stop'});updateOptimizerUi('Arresto al termine dell’iterazione corrente…');}}
async function startPostOptimization(){
  if(state.probGraph?.landmarkFactors?.length>=4)return startProbabilisticOptimization();
  if(!state.gaussians.length)throw new Error('nessuna Gaussiana da ottimizzare');if(state.postOptBusy)return;if(state.surfaceLab?.busy)throw new Error('ferma prima Surface Mesh Lab');if(state.surfaceLab?.previewGaussians?.length)discardSurfaceLab();
  const target=Math.max(1,Math.min(CONFIG.postOptimizeMaxIterations||300,Math.round(Number($('optIterations')?.value)||CONFIG.postOptimizeDefaultIterations||30))),base=state.optimization?.iterations||0,remaining=target-base;if(remaining<=0){updateOptimizerUi(`Target ${target} già raggiunto. Aumenta il numero di iterazioni per continuare.`);return;}
  stopPostOptimizer();state.postOptBusy=true;state.postOptRunBase=base;const worker=new Worker(`${CONFIG.postOptimizeWorker}?v=${BUILD.version}`,{type:'module'});state.postOptWorker=worker;const previewEvery=Math.max(1,Math.ceil(remaining/Math.max(1,CONFIG.postOptimizePreviewUpdates||16)));
  worker.onerror=e=>{log.warn('post-opt-worker',{message:e.message||'worker error'});stopPostOptimizer();updateOptimizerUi('Ottimizzazione fallita: vedi Debug.');};
  worker.onmessage=e=>void handlePostOptimizationMessage(e.data||{},target);
  worker.postMessage({type:'init',gaussians:state.gaussians,observations:state.optimizerObservations||null,previewMax:CONFIG.postOptimizeMaxGaussians||70000,options:{priorWeight:CONFIG.postOptimizePriorWeight||.18,planeWeight:CONFIG.postOptimizePlaneWeight||.10,damping:CONFIG.postOptimizeDamping||.68}});
  worker.__run={remaining,previewEvery,target};updateOptimizerUi(`Preparo ${remaining} iterazioni in worker · preview ogni ${previewEvery}…`);
}
async function startProbabilisticOptimization(){
  if(state.postOptBusy)return;if(state.surfaceLab?.busy)throw new Error('ferma prima Surface Mesh Lab');if(state.surfaceLab?.previewGaussians?.length)discardSurfaceLab();
  const current=Number(state.probOptimization?.iterations||0),target=Math.max(1,Math.min(CONFIG.probabilisticMaxIterations||120,Math.round(Number($('optIterations')?.value)||CONFIG.probabilisticDefaultIterations||12))),remaining=target-current;if(remaining<=0){updateOptimizerUi(`Target probabilistico ${target} già raggiunto.`);return;}
  stopPostOptimizer();state.postOptBusy=true;state.postOptRunBase=current;const worker=new Worker(`${CONFIG.probabilisticOptWorker}?v=${BUILD.version}`,{type:'module'});state.postOptWorker=worker;const previewEvery=Math.max(1,Math.ceil(remaining/Math.max(1,CONFIG.probabilisticPreviewUpdates||12))),voxel=state.reviewMetricLocked?(CONFIG.denseTsdfVoxelM||.035):(CONFIG.denseTsdfVoxelAlva||.03);
  worker.onerror=e=>{log.warn('prob-opt-worker',{message:e.message||'worker error'});stopPostOptimizer();updateOptimizerUi('Ottimizzazione probabilistica fallita: vedi Debug.');};
  worker.onmessage=e=>void handleProbabilisticOptimizationMessage(e.data||{},target);
  worker.__run={remaining,previewEvery,target,rebuildOptions:{voxel,hashVoxel:state.reviewMetricLocked?(CONFIG.denseGaussianHashVoxelM||.02):(CONFIG.denseGaussianHashVoxelAlva||.018),maxSurfels:CONFIG.postOptimizeMaxGaussians||70000,maxTriangles:CONFIG.denseMaxMeshTriangles||90000}};
  const panorama=state.liveMap?.exportState?.()||state.photoPanoramaState||null;if(panorama?.edges?.length)state.probGraph?.addPhotoEdges?.(panorama.edges);
  worker.postMessage({type:'init',graph:state.probGraph.exportState(),options:{maxLandmarks:CONFIG.probabilisticMaxLandmarks||12000,maxObsPerFrame:CONFIG.probabilisticMaxObsPerFrame||280,posePriorScale:CONFIG.probabilisticPosePriorScale||1,absoluteAlvaScale:CONFIG.probabilisticAbsoluteAlvaScale||.04,depthFeedbackEvery:CONFIG.probabilisticDepthFeedbackEvery||2,initial:state.probOptimization||state.liveOptAccepted||null}});
  updateOptimizerUi(`Gerarchico: ${remaining} iterazioni · scaffold RGB → calibrazione Deep → submap · preview ogni ${previewEvery}`);
}
async function handleProbabilisticOptimizationMessage(d,target){
  if(d.type==='prob-opt-ready'){const run=state.postOptWorker?.__run;if(!run)return;state.postOptWorker.postMessage({type:'run',iterations:run.remaining,previewEvery:run.previewEvery,rebuildOptions:run.rebuildOptions});return;}
  if(d.type==='prob-opt-error'){log.warn('prob-opt-error',{message:d.message,stack:d.stack||null});stopPostOptimizer();updateOptimizerUi(`Errore factor graph: ${d.message}`);return;}
  if(d.type==='prob-opt-progress'){
    const absolute=state.postOptRunBase+(d.done||0);state.probOptimization={...(d.snapshot||{}),iterations:absolute,stats:d.stats,updatedAt:Date.now()};state.optimization={...(state.optimization||{}),iterations:absolute,lastEnergy:d.stats?.energy??state.optimization?.lastEnergy,updatedAt:Date.now()};
    if(d.previewGaussians?.length){state.probOptimized={previewGaussians:d.previewGaussians};state.renderer?.setData(d.previewGaussians,{fit:false});state.renderer?.setMesh(null);state.renderer?.draw();}
    const graph=state.probGraph?.summary?.(),alva=d.stats?.alvaSwitches||{},rel=d.stats?.reliability||{},msg=`Factor graph ${absolute}/${target} · ${d.stats?.feedbackPhase==='rgb-fast'?'RGB fast':'Depth feedback'} · reproj ${Number(d.stats?.reprojectionRmse||0).toFixed(2)} px · Δpose ${formatDistance(d.stats?.poseShiftMean,state.reviewMetricLocked)} · Deep ${Number.isFinite(d.stats?.deepRelativeError)?(100*d.stats.deepRelativeError).toFixed(1)+'%':'—'} · Alva off ${alva.rejected||0} · pose/depth suspect ${rel.poseSuspect||0}/${rel.localDepthSuspect||0} · ${graph?.landmarks||0} landmark`;updateReviewUi();updateOptimizerUi(msg);return;
  }
  if(d.type==='prob-opt-complete'){
    const absolute=state.postOptRunBase+(d.done||0);state.probOptimization={...(d.snapshot||{}),iterations:absolute,stats:d.stats,updatedAt:Date.now()};state.optimization={...(state.optimization||{}),iterations:absolute,lastEnergy:d.stats?.energy??null,updatedAt:Date.now()};
    if(d.map?.gaussians?.length){state.gaussians=d.map.gaussians;state.mesh=d.map.mesh?.vertices?.length?d.map.mesh:null;state.meshStale=!state.mesh;state.geometryCommitted=true;state.probOptimized={previewGaussians:state.gaussians,candidateGaussians:d.map.candidateGaussians||[],mapStats:d.map.stats};state.renderer?.setData(state.gaussians,{fit:false});state.renderer?.setMesh(state.mesh);state.renderer?.draw();}
    log.info('probabilistic-optimization-complete',{stats:d.stats,map:d.map?.stats||null,graph:state.probGraph?.summary?.()||null});stopPostOptimizer();await persistCurrentSession({status:'optimized',keyframes:state.reviewKeyframes||0}).catch(err=>log.warn('prob-opt-persist',{message:err?.message||String(err)}));await renderSessions().catch(()=>{});updateReviewUi();const ms=d.map?.stats||{},ev=ms.evidence||{};updateOptimizerUi(`Factor graph completato: ${absolute} iterazioni · reproj ${Number(d.stats?.reprojectionRmse||0).toFixed(2)} px · committed ${state.gaussians.length} (strong ${ev.strong||0}, confirmed ${ev.confirmed||0}) · candidate Deep ${ms.deepCandidate||0} · submap ${ms.submaps||0}${state.mesh?` · ${state.mesh.faces.length/3} facce`:''}.`);return;
  }
  if(d.type==='prob-opt-stopped'){stopPostOptimizer();updateOptimizerUi('Factor graph fermato · ultimo preview conservato, mappa BASE non sovrascritta.');}
}

async function handlePostOptimizationMessage(d,target){
  if(d.type==='optimizer-ready'){const run=state.postOptWorker?.__run;if(!run)return;log.info('post-opt-ready',{gaussians:d.count,observations:d.observations,cellSize:d.cellSize,target:run.target});state.postOptWorker.postMessage({type:'run',iterations:run.remaining,previewEvery:run.previewEvery});return;}
  if(d.type==='optimizer-error'){log.warn('post-opt-error',{message:d.message,stack:d.stack||null});stopPostOptimizer();updateOptimizerUi(`Errore ottimizzazione: ${d.message}`);return;}
  if(!['optimizer-progress','optimizer-done','optimizer-stopped'].includes(d.type))return;
  const absolute=state.postOptRunBase+(Number(d.iteration)||0);if(d.gaussians?.length){state.gaussians=d.gaussians;state.meshStale=absolute>state.postOptRunBase||state.meshStale;if(state.meshStale)state.renderer?.setMesh(null);state.renderer?.setData(state.gaussians,{fit:false});state.renderer?.draw();}
  state.optimization={...(state.optimization||{}),iterations:absolute,lastEnergy:Number.isFinite(d.stats?.energy)?d.stats.energy:state.optimization?.lastEnergy,lastMeanStep:d.stats?.meanStep??null,lastMaxStep:d.stats?.maxStep??null,updatedAt:Date.now()};
  const pct=Math.min(100,Math.round(100*absolute/Math.max(1,target))),msg=`Iterazione ${absolute}/${target} (${pct}%) · loss ${Number(d.stats?.energy||0).toFixed(4)} · spostamento medio ${formatDistance(d.stats?.meanStep,state.reviewMetricLocked)} · preview aggiornata`;
  updateReviewUi();updateOptimizerUi(msg);
  if(d.type==='optimizer-done'||d.type==='optimizer-stopped'){
    const stopped=d.type==='optimizer-stopped';stopPostOptimizer();await persistCurrentSession({status:'optimized',keyframes:state.reviewKeyframes||0}).catch(err=>log.warn('post-opt-persist',{message:err?.message||String(err)}));await renderSessions().catch(()=>{});updateReviewUi();updateOptimizerUi(`${stopped?'Fermata':'Completata'} a ${absolute} iterazioni · stato salvato localmente${state.meshStale?' · mesh marcata da rigenerare':''}.`);
  }
}
function formatDistance(v,metric){if(!Number.isFinite(v))return '—';return metric?`${(v*1000).toFixed(2)} mm`:`${v.toExponential(2)} u.Alva`;}

/* -------------------------------------------------------------------------
 * EXPERIMENTAL SURFACE MESH LAB
 * -------------------------------------------------------------------------
 * Rollback guarantee: these helpers never assign to state.gaussians/state.mesh.
 * The V30.26 map remains the authoritative base.  Experimental worker output is
 * stored only under state.surfaceLab and can be hidden/discarded instantly.
 */
function surfaceLabSignature(){return `${state.gaussians.length}:${state.optimization?.iterations||0}:${state.optimization?.updatedAt||0}`;}
async function loadSurfaceLabAssets(){
  // EXP-2 diagnostics exposed an important deployment failure mode: because the
  // lab is lazy, a site can boot correctly even when a newly added experimental
  // directory was not uploaded. Probe both assets before allocating/copying tens
  // of thousands of Gaussians, and produce a specific diagnostic instead of the
  // browser's opaque "Failed to fetch dynamically imported module" message.
  const modulePath='./experimental/surface_mesh_lab.js';let api;
  try{api=await lazy(modulePath);}catch(err){moduleCache.delete(modulePath);const url=new URL('./experimental/surface_mesh_lab.js',import.meta.url).href;log.error('surface-lab-asset-missing',{asset:'module',url,message:err?.message||String(err)});throw new Error(`Surface Mesh Lab non pubblicato: manca js/experimental/surface_mesh_lab.js (${BUILD.version}). Applica la patch EXP completa e ricarica.`);}
  const workerUrl=new URL(CONFIG.surfaceLabWorker,document.baseURI);workerUrl.searchParams.set('v',BUILD.version);
  try{const r=await fetch(workerUrl,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);}catch(err){log.error('surface-lab-asset-missing',{asset:'worker',url:workerUrl.href,message:err?.message||String(err)});throw new Error(`Surface Mesh Lab non pubblicato: manca ${CONFIG.surfaceLabWorker}. Applica la patch EXP completa e ricarica.`);}
  log.info('surface-lab-assets-ready',{module:new URL('./experimental/surface_mesh_lab.js',import.meta.url).href,worker:workerUrl.href,version:BUILD.version});
  return {api,workerUrl:workerUrl.href};
}
function resetSurfaceLabState({keepWorker=false}={}){
  const lab=state.surfaceLab||{};if(!keepWorker)try{lab.worker?.terminate();}catch{}
  state.surfaceLab={worker:keepWorker?lab.worker:null,busy:false,active:false,iterations:0,previewGaussians:null,mesh:null,lastStats:null,baseSignature:null,target:0,voxelM:null};
}
function stopSurfaceLabWorker({discard=false}={}){
  const lab=state.surfaceLab;if(!lab)return;try{lab.worker?.terminate();}catch{}lab.worker=null;lab.busy=false;if(discard)resetSurfaceLabState();updateSurfaceLabUi();
}
function requestStopSurfaceLab(){const lab=state.surfaceLab;if(lab?.worker&&lab.busy){lab.worker.postMessage({type:'stop'});updateSurfaceLabUi('Arresto EXP al termine dell’iterazione corrente…');}}
function renderBaseReview(){const lab=state.surfaceLab;if(lab)lab.active=false;if(state.renderer){state.renderer.setData(state.gaussians,{fit:false});state.renderer.setMesh(state.mesh&&!state.meshStale?state.mesh:null);state.renderer.draw();}updateSurfaceLabUi('Anteprima BASE V30.26 attiva · i dati sperimentali restano separati.');}
function renderExperimentalReview(){const lab=state.surfaceLab;if(!lab?.previewGaussians?.length){updateSurfaceLabUi('Nessun risultato EXP disponibile: avvia prima Surface Mesh Lab.');return;}lab.active=true;if(state.renderer){state.renderer.setData(lab.previewGaussians,{fit:false});state.renderer.setMesh(lab.mesh||null);state.renderer.draw();}updateSurfaceLabUi();}
function discardSurfaceLab(){resetSurfaceLabState();renderBaseReview();updateSurfaceLabUi('Esperimento eliminato dalla RAM. La V30.26 non è stata modificata.');}
function updateSurfaceLabUi(extra=null){
  const lab=state.surfaceLab||{},start=$('surfaceLabStartBtn'),stop=$('surfaceLabStopBtn'),base=$('surfaceLabBaseBtn'),exp=$('surfaceLabExpBtn'),discard=$('surfaceLabDiscardBtn'),download=$('surfaceLabExportBtn'),progress=$('surfaceLabProgress'),status=$('surfaceLabStatus'),target=Math.max(1,Number($('surfaceLabIterations')?.value)||CONFIG.surfaceLabDefaultIterations||20);
  if(start)start.disabled=!!lab.busy||!!state.postOptBusy||!state.gaussians.length;if(stop)stop.disabled=!lab.busy;if(base)base.disabled=!lab.active;if(exp)exp.disabled=lab.active||!lab.previewGaussians?.length;if(discard)discard.disabled=!lab.previewGaussians?.length&&!lab.worker;if(download)download.disabled=!lab.mesh?.vertices?.length;
  if(progress){progress.max=target;progress.value=Math.min(target,lab.iterations||0);}
  if(status){const meshFaces=lab.mesh?.faces?.length?lab.mesh.faces.length/3:0,planarity=Number(lab.mesh?.meanPlanarity),meshMs=Number(lab.mesh?.buildMs),statusText=extra||`${lab.active?'EXP':'BASE'} · EXP ${lab.iterations||0}/${target} iterazioni${lab.previewGaussians?.length?` · ${lab.previewGaussians.length} surfel`:''}${meshFaces?` · mesh ${meshFaces} facce`:''}${Number.isFinite(planarity)?` · planarità ${planarity.toFixed(2)}`:''}${Number.isFinite(meshMs)?` · mesh ${meshMs.toFixed(0)} ms`:''}${lab.lastStats?.energy!=null?` · loss ${Number(lab.lastStats.energy).toFixed(4)}`:''}`;status.textContent=statusText;}
}
async function startSurfaceMeshLab(){
  if(state.postOptBusy)throw new Error('ferma prima l’ottimizzazione V30.26');if(!state.gaussians.length)throw new Error('nessuna Gaussiana disponibile per il laboratorio');
  const lab=state.surfaceLab||(state.surfaceLab={}),signature=surfaceLabSignature(),target=Math.max(1,Math.min(CONFIG.surfaceLabMaxIterations||160,Math.round(Number($('surfaceLabIterations')?.value)||CONFIG.surfaceLabDefaultIterations||20))),voxel=Math.max(.012,Math.min(.08,Number($('surfaceLabVoxel')?.value)||CONFIG.surfaceLabVoxelM||.03));
  // If the production Gaussian map changed, an old EXP result is geometrically
  // stale. Discard only the experiment; the production state is never touched.
  if(lab.baseSignature&&(lab.baseSignature!==signature||Math.abs((lab.voxelM||voxel)-voxel)>1e-9))resetSurfaceLabState();
  const current=state.surfaceLab.iterations||0,remaining=target-current;if(remaining<=0){renderExperimentalReview();updateSurfaceLabUi(`Target EXP ${target} già raggiunto. Aumenta le iterazioni per continuare.`);return;}
  if(!state.surfaceLab.worker){
    const {api,workerUrl}=await loadSurfaceLabAssets(),dataset=api.selectSurfaceLabDataset(state.gaussians,state.optimizerObservations,CONFIG.surfaceLabMaxGaussians||30000),worker=new Worker(workerUrl,{type:'module'});state.surfaceLab.worker=worker;state.surfaceLab.baseSignature=signature;state.surfaceLab.voxelM=voxel;state.surfaceLab.iterations=0;state.surfaceLab.busy=true;state.surfaceLab.active=true;state.surfaceLab.target=target;
    worker.onerror=e=>{log.warn('surface-lab-worker',{message:e.message||'worker error'});stopSurfaceLabWorker();updateSurfaceLabUi('Surface Mesh Lab fallito: vedi Debug.');};
    worker.onmessage=e=>void handleSurfaceLabMessage(e.data||{});
    const meshOptions={voxelM:voxel,maxGaussians:CONFIG.surfaceLabMaxGaussians||30000,maxVoxels:CONFIG.surfaceLabMaxVoxels||320000,maxTriangles:CONFIG.surfaceLabMaxTriangles||120000,previewVoxelM:Math.max(voxel,CONFIG.surfaceLabPreviewVoxelM||.045),previewMaxGaussians:Math.min(CONFIG.surfaceLabMaxGaussians||30000,CONFIG.surfaceLabPreviewMaxGaussians||24000),previewMaxVoxels:CONFIG.surfaceLabPreviewMaxVoxels||150000,previewMaxTriangles:CONFIG.surfaceLabPreviewMaxTriangles||45000};
    worker.__run={remaining,target,previewEvery:Math.max(1,Math.ceil(remaining/Math.max(1,CONFIG.surfaceLabPreviewUpdates||12))),meshPreviewEvery:CONFIG.surfaceLabMeshPreviewEvery||3,meshOptions};
    const initMessage={type:'init',gaussians:dataset.gaussians,observations:dataset.observations,previewMax:CONFIG.surfaceLabPreviewMaxGaussians||24000,options:{voxelM:voxel,maxGaussians:CONFIG.surfaceLabMaxGaussians||30000,maxVoxels:CONFIG.surfaceLabMaxVoxels||320000,maxTriangles:CONFIG.surfaceLabMaxTriangles||120000,priorWeight:CONFIG.postOptimizePriorWeight||.18,planeWeight:Math.max(CONFIG.postOptimizePlaneWeight||.10,.12),damping:Math.min(CONFIG.postOptimizeDamping||.68,.66)},meshOptions};const transfers=dataset.observations?[dataset.observations.offsets.buffer,dataset.observations.data.buffer]:[];worker.postMessage(initMessage,transfers);
    updateSurfaceLabUi(`Creo copia EXP isolata · ${dataset.gaussians.length} Gaussiane · target ${target}…`);return;
  }
  state.surfaceLab.busy=true;state.surfaceLab.target=target;const previewEvery=Math.max(1,Math.ceil(remaining/Math.max(1,CONFIG.surfaceLabPreviewUpdates||12)));state.surfaceLab.worker.postMessage({type:'run',iterations:remaining,previewEvery,meshPreviewEvery:CONFIG.surfaceLabMeshPreviewEvery||3});updateSurfaceLabUi(`Continuo EXP per ${remaining} iterazioni · preview ogni ${previewEvery}…`);
}
async function handleSurfaceLabMessage(d){
  const lab=state.surfaceLab;if(!lab)return;
  if(d.type==='surface-lab-ready'){const run=lab.worker?.__run;if(!run)return;log.info('surface-lab-ready',{gaussians:d.gaussians,observations:d.observations,target:run.target});lab.worker.postMessage({type:'run',iterations:run.remaining,previewEvery:run.previewEvery,meshPreviewEvery:run.meshPreviewEvery});return;}
  if(d.type==='surface-lab-error'){log.warn('surface-lab-error',{message:d.message,stack:d.stack||null});lab.busy=false;updateSurfaceLabUi(`Errore EXP: ${d.message}`);return;}
  if(!['surface-lab-progress','surface-lab-done','surface-lab-stopped','surface-lab-mesh','surface-lab-snapshot'].includes(d.type))return;
  if(Number.isFinite(d.iteration))lab.iterations=Number(d.iteration);if(d.stats)lab.lastStats=d.stats;if(d.gaussians?.length)lab.previewGaussians=d.gaussians;if(d.mesh?.vertices?.length)lab.mesh=decodeStoredMesh(d.mesh);
  // EXP becomes visible automatically once the first useful preview exists, but
  // toggling back to BASE is always a one-click, zero-recompute operation.
  if(lab.previewGaussians?.length&&lab.active&&state.renderer){state.renderer.setData(lab.previewGaussians,{fit:false});state.renderer.setMesh(lab.mesh||null);state.renderer.draw();}
  const pct=Math.min(100,Math.round(100*(lab.iterations||0)/Math.max(1,lab.target||1))),faces=lab.mesh?.faces?.length?lab.mesh.faces.length/3:0,planarity=Number(lab.mesh?.meanPlanarity),meshMs=Number(lab.mesh?.buildMs);updateSurfaceLabUi(`EXP ${lab.iterations||0}/${lab.target||0} (${pct}%) · loss ${Number(lab.lastStats?.energy||0).toFixed(4)}${faces?` · mesh ${faces} facce`:''}${Number.isFinite(planarity)?` · planarità ${planarity.toFixed(2)}`:''}${Number.isFinite(meshMs)?` · mesh ${meshMs.toFixed(0)} ms`:''} · BASE intatta`);
  if(d.type==='surface-lab-done'||d.type==='surface-lab-stopped'){lab.busy=false;updateSurfaceLabUi(`${d.type==='surface-lab-stopped'?'EXP fermato':'EXP completato'} a ${lab.iterations} iterazioni · risultato solo in RAM · BASE V30.26 intatta.`);}
}
async function exportSurfaceLabMesh(){if(!state.surfaceLab?.mesh?.vertices?.length)throw new Error('mesh sperimentale non disponibile');await downloadMeshPly(state.surfaceLab.mesh,'surface-lab-exp');}

async function loadSavedSession(id){
  if(!state.db)throw new Error('storage locale non disponibile');stopPostOptimizer();stopSurfaceLabWorker({discard:true});const bundle=await state.db.loadSessionBundle(id);if(!bundle?.session)throw new Error('sessione non trovata');if(!bundle.snapshot?.gaussians?.length&&!bundle.snapshot?.factorGraph?.frames?.length)throw new Error('questa sessione precedente non contiene né mappa 3D né factor graph fotografico ricaricabile');
  state.currentSession=bundle.session;state.gaussians=bundle.snapshot.gaussians||[];state.optimizerObservations=bundle.snapshot.optimizerObservations||null;state.optimization={iterations:0,lastEnergy:null,...(bundle.snapshot.optimization||{})};state.probOptimization=bundle.snapshot.probOptimization||null;state.probOptimized=null;state.puzzleReconstruction=bundle.snapshot.puzzleReconstruction||null;state.puzzlePreview=null;state.puzzleActive=false;state.puzzleAtlas=null;state.puzzleStats=state.puzzleReconstruction?.stats||null;state.photoPanoramaState=bundle.snapshot.photoPanorama||null;
  if(bundle.snapshot.factorGraph){const {ProbabilisticFactorGraph}=await lazy('./probabilistic/factor_graph.js');state.probGraph=ProbabilisticFactorGraph.fromState(bundle.snapshot.factorGraph);}else state.probGraph=null;
  if(bundle.snapshot.deepSequence){const {DeepSequenceModel}=await lazy('./probabilistic/deep_sequence_model.js');state.deepSequence=new DeepSequenceModel().importState(bundle.snapshot.deepSequence);}else state.deepSequence=null;
  state.denseDepthSamples=bundle.snapshot.denseSamples||bundle.session.counts?.denseSamples||0;state.deepRaySamples=bundle.snapshot.deepRaySamples||0;state.reviewMetricLocked=bundle.snapshot.metricLocked??bundle.session.metricLocked??null;state.reviewKeyframes=bundle.snapshot.keyframes||bundle.session.counts?.keyframes||0;state.lastTracking=null;state.mesh=decodeStoredMesh(bundle.mesh);state.meshStale=!!bundle.mesh?.stale;window.__ROOMSCAN_METRIC_MESH=!state.meshStale?state.mesh:null;
  log.info('session-loaded',{id,gaussians:state.gaussians.length,optimizerObservations:state.optimizerObservations?.count||0,factorGraph:state.probGraph?.summary?.()||null,iterations:state.optimization.iterations,puzzleIterations:state.puzzleReconstruction?.iteration||0,meshStale:state.meshStale});await showReview();
}
function decodeStoredMesh(m){if(!m?.vertices?.length)return null;return {...m,vertices:m.vertices instanceof Float32Array?m.vertices:new Float32Array(m.vertices||[]),colors:m.colors instanceof Uint8Array?m.colors:new Uint8Array(m.colors||[]),faces:m.faces instanceof Uint32Array?m.faces:new Uint32Array(m.faces||[])};}
async function renderSessions(){
  if(!state.db)return;const [sessions,snapshots]=await Promise.all([state.db.getAll('sessions'),state.db.getAll('snapshots')]),saved=new Set(snapshots.filter(x=>x?.gaussians?.length||x?.factorGraph?.frames?.length).map(x=>x.id)),xs=sessions.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,8),el=$('savedSessions');if(!el)return;el.textContent='';if(!xs.length){el.innerHTML='<span class="muted">Nessuna sessione salvata.</span>';return;}
  for(const s of xs){const row=document.createElement('div');row.className='savedSessionRow status';const info=document.createElement('span');info.textContent=`${new Date(s.createdAt).toLocaleString()} · ${s.status||'sessione'} · KF ${s.counts?.keyframes||0} · GS ${s.counts?.gaussians||0}${s.optimizationIterations?` · opt ${s.optimizationIterations}`:''}`;const b=document.createElement('button');b.textContent=saved.has(s.id)?'Apri 3D':'Dati 3D non salvati';b.disabled=!saved.has(s.id);if(!b.disabled)b.addEventListener('click',safe('load-saved-session',()=>loadSavedSession(s.id)));row.append(info,b);el.appendChild(row);}
}
async function runTests(){const {runSelfTests}=await lazy('./self_test.js');const out=await runSelfTests(log),ok=out.filter(x=>x.ok).length;if($('selfTestSummary'))$('selfTestSummary').textContent=`Self-test: ${ok}/${out.length} PASS`;if($('diagLive'))$('diagLive').textContent=out.map(x=>`${x.ok?'PASS':'FAIL'} ${x.name}${x.ok?'':`: ${x.error}`}`).join('\n');if($('diagPanel'))$('diagPanel').open=true;}
async function clearCachesAndReload(){try{const regs=await navigator.serviceWorker?.getRegistrations?.()||[];for(const reg of regs){let own=false;try{own=new URL(reg.scope).pathname.includes('/room_scanner/v30/');}catch{}if(!own)continue;try{reg.active?.postMessage({type:'CLEAR_V30_SHELL'});await reg.unregister();}catch{}}if(window.caches)for(const k of await caches.keys())if(/^room-scanner-v.*-shell$/.test(k))await caches.delete(k);try{for(const k of Object.keys(sessionStorage))if(k.startsWith('roomscan-v30-atomic-recovery-'))sessionStorage.removeItem(k);}catch{}}catch(err){log.warn('force-update-cleanup',{message:err?.message||String(err)});}location.replace(`${location.pathname}?v30reset=${BUILD.version}-${Date.now()}`);}
async function loadPly(file){const {parsePly}=await lazy('./formats.js');stopPostOptimizer();stopSurfaceLabWorker({discard:true});stopPuzzleWorker();state.puzzleReconstruction=null;state.puzzlePreview=null;state.puzzleActive=false;state.currentSession=null;state.gaussians=parsePly(await file.text());state.optimizerObservations=null;state.optimization={iterations:0,lastEnergy:null};state.mesh=null;state.meshStale=false;state.geometryCommitted=false;state.reviewMetricLocked=null;state.reviewKeyframes=0;await showReview();}
async function loadR30(file){const {decodeR30}=await lazy('./formats.js');stopPostOptimizer();stopSurfaceLabWorker({discard:true});stopPuzzleWorker();state.puzzleReconstruction=null;state.puzzlePreview=null;state.puzzleActive=false;const x=await decodeR30(file);state.currentSession=null;state.gaussians=x.gaussians||x.snapshot?.gaussians||[];state.optimizerObservations=null;state.optimization={iterations:Number(x.optimization?.iterations)||0,lastEnergy:x.optimization?.lastEnergy??null};state.mesh=x.mesh?{...x.mesh,vertices:new Float32Array(x.mesh.vertices||[]),colors:new Uint8Array(x.mesh.colors||[]),faces:new Uint32Array(x.mesh.faces||[])}:null;state.meshStale=false;state.geometryCommitted=!!(x.geometryCommitted??x.snapshot?.geometryCommitted);state.reviewMetricLocked=x.metricLocked??null;state.reviewKeyframes=x.reconstruction?.keyframes||0;state.photoPanoramaState=x.evidence?.photoPanorama||x.photoPanorama||null;if(x.evidence?.factorGraph){const {ProbabilisticFactorGraph}=await lazy('./probabilistic/factor_graph.js');state.probGraph=ProbabilisticFactorGraph.fromState(x.evidence.factorGraph);}else state.probGraph=null;if(x.evidence?.deepSequence){const {DeepSequenceModel}=await lazy('./probabilistic/deep_sequence_model.js');state.deepSequence=new DeepSequenceModel().importState(x.evidence.deepSequence);}else state.deepSequence=null;await showReview();}
async function exportPly(){const {gaussiansToPly,downloadBlob}=await lazy('./formats.js');downloadBlob(new Blob([gaussiansToPly(state.gaussians,BUILD.id)],{type:'application/octet-stream'}),`roomscan-${Date.now()}.ply`);}
async function exportR30(){const {encodeR30,downloadBlob}=await lazy('./formats.js'),factorGraph=state.probGraph?.exportState?.()||state.probGraph||null,deepSequence=state.deepSequence?.exportState?.()||null,photoPanorama=state.liveMap?.exportState?.()||state.photoPanoramaState||null;downloadBlob(encodeR30({build:BUILD,calibration:calibration(),gaussians:state.gaussians,mesh:state.mesh&&!state.meshStale?{vertices:Array.from(state.mesh.vertices||[]),colors:Array.from(state.mesh.colors||[]),faces:Array.from(state.mesh.faces||[]),voxelM:state.mesh.voxelM}:null,optimization:state.optimization,metricLocked:state.reviewMetricLocked??!!state.slam?.metricLocked,evidence:{factorGraph,deepSequence,photoPanorama},reconstruction:{type:'alva-deep-multiview-gaussian-batch-opt',denseSamples:state.denseDepthSamples,deepRaySamples:state.deepRaySamples||0,keyframes:state.reviewKeyframes||state.slam?.keyframes?.length||0}}),`roomscan-${Date.now()}.r30`);}
async function downloadMeshPly(m,label='mesh'){const {downloadBlob}=await lazy('./formats.js'),V=m.vertices,C=m.colors||[],F=m.faces||[],nv=V.length/3,nf=F.length/3,lines=['ply','format ascii 1.0',`comment Room Scanner ${BUILD.version} ${label}`,`element vertex ${nv}`,'property float x','property float y','property float z','property uchar red','property uchar green','property uchar blue',`element face ${nf}`,'property list uchar int vertex_indices','end_header'];for(let i=0;i<nv;i++)lines.push(`${V[i*3]} ${V[i*3+1]} ${V[i*3+2]} ${C[i*3]??180} ${C[i*3+1]??180} ${C[i*3+2]??180}`);for(let i=0;i<nf;i++)lines.push(`3 ${F[i*3]} ${F[i*3+1]} ${F[i*3+2]}`);downloadBlob(new Blob([lines.join('\n')+'\n'],{type:'application/octet-stream'}),`roomscan-${label}-${Date.now()}.ply`);}
async function exportMeshPly(){if(state.meshStale)throw new Error('La mesh precedente non è coerente con le Gaussiane ottimizzate: va rigenerata.');if(!state.mesh?.vertices?.length)throw new Error('Mesh TSDF non ancora disponibile');await downloadMeshPly(state.mesh,'mesh-base');}

function bind(){on('calibrateBtn','click',safe('begin-calibration',beginCalibration));on('clearCalibrationBtn','click',()=>{localStorage.removeItem(CONFIG.calibrationStorageKey);updateCalibrationUi();});on('calibAddPinBtn','click',safe('add-calibration-pin',addCalibrationPin));on('calibUndoPinBtn','click',()=>{state.calibrator?.undoLastTarget();updateProgress(state.calibrator?.quality());});on('calibFinishBtn','click',safe('finish-calibration',finishCalibration));on('calibCancelBtn','click',safe('cancel-calibration',cancelCalibration));on('startBtn','click',safe('begin-bridge',beginBridge));on('bridgeRetryBtn','click',safe('retry-bridge',beginBridge));on('bridgeCancelBtn','click',()=>{state.bridgeEpoch++;state.bridgeTransition=false;state.bridge?.stop();state.bridge=null;show('home');});on('finishBtn','click',safe('finish-scan',finishScan));on('backHomeBtn','click',safe('review-home',returnHomeFromReview));on('resumeBtn','click',safe('resume-scan',beginBridge));on('liveMapPhotoBtn','click',()=>setLiveMapMode('photo'));on('liveMapDepthBtn','click',()=>setLiveMapMode('depth'));on('scanDiagnosticsToggle','click',toggleScanDiagnostics);on('scanDiagnosticsClose','click',()=>setScanDiagnosticsOpen(false));on('scanExportDiagBtn','click',()=>{log.checkpoint('manual-live-diagnostics-export',{graph:state.probGraph?.summary?.()||null,liveOptimizer:state.liveOptStats||null,liveGate:state.liveOptGate||null,liveMap:state.liveMap?.stats?.()||null,preview:{anchors:state.liveOptAcceptedAnchors?.length||0,surfels:state.liveOptPreviewGaussians?.length||0},scheduler:{backoff:state.liveOptBackoff,inFlight:state.liveOptInFlight,lastElapsedMs:state.liveOptLastElapsedMs,lastReason:state.liveOptLastReason}});log.download(`roomscan-live-${Date.now()}.json`,{exportReason:'manual-live'});});on('fitBtn','click',()=>{state.renderer?.fit();state.renderer?.draw();});on('viewTopBtn','click',()=>state.renderer?.setPreset('top'));on('viewFrontBtn','click',()=>state.renderer?.setPreset('front'));on('viewSideBtn','click',()=>state.renderer?.setPreset('side'));on('arModeBtn','click',()=>{const mode=state.liveOverlay?.cycleMode()||'off';const b=$('arModeBtn');if(b)b.textContent=`AR: ${mode==='gs'?'Surface':mode==='mesh'?'Mesh':mode==='both'?'Surface+Mesh':'Off'}`;});on('splatSize','input',e=>state.renderer?.setSplatSize(e.target.value));on('optIterations','input',()=>updateOptimizerUi());on('optStartBtn','click',safe('post-optimize',startPostOptimization));on('optStopBtn','click',requestStopPostOptimization);on('surfaceLabIterations','input',()=>updateSurfaceLabUi());on('surfaceLabVoxel','input',()=>updateSurfaceLabUi());on('surfaceLabStartBtn','click',safe('surface-mesh-lab',startSurfaceMeshLab));on('surfaceLabStopBtn','click',requestStopSurfaceLab);on('surfaceLabBaseBtn','click',renderBaseReview);on('surfaceLabExpBtn','click',renderExperimentalReview);on('surfaceLabDiscardBtn','click',discardSurfaceLab);on('surfaceLabExportBtn','click',safe('surface-lab-export',exportSurfaceLabMesh));on('puzzleParticles','input',()=>updatePuzzleUi());on('puzzleIterations','input',()=>updatePuzzleUi());on('puzzleStartBtn','click',safe('puzzle-reconstruct',startPuzzleReconstruction));on('puzzleStopBtn','click',requestStopPuzzle);on('puzzleBaseBtn','click',renderPuzzleBase);on('puzzleViewBtn','click',renderPuzzleResult);on('puzzleExportBtn','click',safe('puzzle-export',exportPuzzleMesh));on('loadPlyBtn','click',()=>$('filePly')?.click());on('filePly','change',safe('load-ply',async e=>{if(e.target.files?.[0])await loadPly(e.target.files[0]);e.target.value='';}));on('loadR30Btn','click',()=>$('fileR30')?.click());on('fileR30','change',safe('load-r30',async e=>{if(e.target.files?.[0])await loadR30(e.target.files[0]);e.target.value='';}));on('exportPlyBtn','click',safe('export-ply',exportPly));on('exportR30Btn','click',safe('export-r30',exportR30));on('buildMetricMeshBtn','click',safe('export-mesh',exportMeshPly));on('exportDiagBtn','click',()=>log.download());on('diagDownloadBtn','click',()=>log.download());on('diagCopyBtn','click',()=>navigator.clipboard?.writeText(log.text()).catch(()=>{}));on('selfTestBtn','click',safe('self-test',runTests));on('forceUpdateBtn','click',safe('force-update',clearCachesAndReload));on('diagForceUpdateBtn','click',safe('force-update',clearCachesAndReload));on('pinBtn','click',safe('manual-scan-pin',async()=>{const pose=state.slam?.pose;if(!pose||!state.liveOverlay)throw new Error('AlvaAR non ha ancora una posa valida');const {qRotate}=await lazy('./slam/math.js');const d=qRotate(pose.q,[0,0,1]),distance=state.slam.metricLocked?1.25:1;const p=[pose.p[0]+d[0]*distance,pose.p[1]+d[1]*distance,pose.p[2]+d[2]*distance];state.liveOverlay.setReferencePoint(p);const b=$('pinBtn');if(b)b.textContent='◎ Repere ✓';log.info('manual-scan-pin',{pose,point:p,metricLocked:state.slam.metricLocked});}));log.addEventListener('entry',()=>{const live=$('diagLive');if(live&&$('diagPanel')?.open)live.textContent=log.entries.slice(-80).map(x=>`${new Date(x.at).toLocaleTimeString()} ${x.level.toUpperCase()} ${x.event} ${JSON.stringify(x.data)}`).join('\n');});}

async function prefetchOfficialAlvaRuntime(){
  try{
    const {prefetchAlvaModule,getAlvaRuntimeStatus}=await lazy('./slam/alva_runtime_loader.js');
    const localUrl=new URL('../vendor/alva_ar.js',import.meta.url).href;
    const cacheKey=new URL('../vendor/alva_ar.cached.js',import.meta.url).href;
    const mod=await prefetchAlvaModule({localUrl,cacheKey,sources:CONFIG.alvaRemoteUrls||[CONFIG.alvaRemoteUrl].filter(Boolean)});
    if(!mod?.AlvaAR?.Initialize)throw new Error('AlvaAR.Initialize mancante dopo preload');
    const st=getAlvaRuntimeStatus();log.info('alva-runtime-prefetched',st);
    const el=$('homeStatus');if(el&&el.dataset.kind!=='error'&&/Interfaccia pronta|AlvaAR|pronta/i.test(el.textContent||''))el.textContent=`Interfaccia pronta · AlvaAR ${st.source==='vendor'?'locale':st.source==='cache'?'in cache':'scaricato e memorizzato'}.`;
    return st;
  }catch(err){
    log.warn('alva-runtime-prefetch',{message:err?.message||String(err)});
    const el=$('homeStatus');if(el&&el.dataset.kind!=='error')el.textContent='Interfaccia pronta · AlvaAR verrà scaricato quando avvii la misura.';
    return null;
  }
}

function queryServiceWorkerVersion(worker=navigator.serviceWorker?.controller,timeoutMs=900){return new Promise(resolve=>{if(!worker){resolve(null);return;}const ch=new MessageChannel();let done=false;const finish=x=>{if(done)return;done=true;clearTimeout(timer);resolve(x||null);},timer=setTimeout(()=>finish(null),timeoutMs);ch.port1.onmessage=e=>finish(e.data||null);try{worker.postMessage({type:'GET_VERSION'},[ch.port2]);}catch{finish(null);}});}
async function initBackground(){const dbJob=(async()=>{try{const {V30Database}=await lazy('./storage/db.js');state.db=await new V30Database().open();await renderSessions();log.info('db-ready',{});}catch(err){log.error('db-open',{message:err?.message||String(err)});const s=$('homeStatus');if(s&&s.dataset.kind!=='error')s.textContent='Interfaccia pronta · storage locale non disponibile.';}})();void dbJob;setTimeout(async()=>{try{if(!('serviceWorker'in navigator))return;const info=await queryServiceWorkerVersion();const coherent=info?.version===BUILD.version;log[coherent?'info':'error']('service-worker-controller',{expected:BUILD.version,actual:info?.version||null,cache:info?.cache||null,coherent});if(!coherent){const banner=$('updateBanner'),text=$('updateText');if(banner)banner.hidden=false;if(text)text.textContent=`Shell non coerente: pagina ${BUILD.version}, controller ${info?.version||'assente'}. Usa Pulisci cache e ricarica.`;}}catch(err){log.warn('service-worker-controller',{message:err?.message||String(err)});}},350);}

function boot(){bind();document.documentElement.dataset.v30Interactive='1';if(window.__ROOMSCAN_PREBOOT){window.__ROOMSCAN_PREBOOT.interactive=true;window.__ROOMSCAN_PREBOOT.interactiveAt=Date.now();window.__ROOMSCAN_PREBOOT.markInteractive?.();}if($('buildBadge'))$('buildBadge').textContent=`V${BUILD.version}`;if($('buildFoot'))$('buildFoot').textContent=`${BUILD.id} · DB target v${BUILD.dbVersion}`;updateCalibrationUi();if($('homeStatus'))$('homeStatus').textContent='Interfaccia pronta.';log.info('ui-interactive',{build:BUILD.id,shell:window.__ROOMSCAN_PREBOOT?.shell||null});try{const previous=sessionStorage.getItem('roomscan-v30-last-boot-failure');if(previous){log.warn('previous-boot-recovery',JSON.parse(previous));sessionStorage.removeItem('roomscan-v30-last-boot-failure');}}catch{}void initBackground();document.documentElement.dataset.v30Ready='1';}
function bindDeepModelControls(){on('chooseDeepModelBtn','click',()=>$('deepModelFile')?.click());on('deepModelFile','change',safe('select-deep-model',async e=>{await chooseDeepModel(e.target.files?.[0]);e.target.value='';}));on('testDeepBtn','click',safe('test-deep-model',testDeepModel));}
bindDeepModelControls();
boot();
