/**
 * Room Scanner V30.17.0 sparse-AI Alva mapping application.
 *
 * BOOT CONTRACT
 * -------------
 * Only config + logger are static imports. UI handlers are bound immediately.
 * Storage, WebXR, camera, SLAM, diagnostics and metric extensions are imported
 * lazily after the page is already interactive. A failure in an optional module
 * therefore cannot leave the visible page with dead buttons.
 */
import {BUILD,CONFIG} from './config.js?v=30.17.0';
import {DiagnosticsLog} from './logger.js?v=30.17.0';

const $=id=>document.getElementById(id);
const log=new DiagnosticsLog({build:BUILD});
const state={db:null,calibrator:null,bridge:null,bridgeStable:0,bridgeEpoch:0,bridgeTransition:false,alvaBootstrap:null,camera:null,frontend:null,slam:null,denseManager:null,denseDepthWorker:null,denseFusionWorker:null,deepDepthWorker:null,deepSelector:null,deepPending:null,deepDisabled:false,deepCalls:0,deepAccepted:0,denseBusy:false,denseJobs:0,denseDepthSamples:0,denseDepthHint:null,densePixelStep:null,denseSourceLimit:null,surfaceStats:null,mesh:null,gaussians:[],renderer:null,currentSession:null,scanStop:null,liveOverlay:null,scanK:null,lastFrameGeometry:null,lastTracking:null,geometryAnchors:[]};
window.RoomScanV30={BUILD,CONFIG,state,log};
const moduleCache=new Map();
function lazy(path){if(!moduleCache.has(path))moduleCache.set(path,import(`${path}?v=${BUILD.version}`));return moduleCache.get(path);}
function safe(name,fn){return async(...args)=>{try{return await fn(...args)}catch(err){log.error(name,{message:err?.message||String(err),stack:err?.stack||null});showError(err?.message||String(err));return null;}};}
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
  const [{CameraController,intrinsicsForCrop},{SlamEngine},{LiveReconstructionOverlay},{DenseKeyframeManager},{DeepKeyframeSelector}]=await Promise.all([
    lazy('./camera.js'),lazy('./slam/slam_engine.js'),lazy('./gaussian/ar_overlay.js'),lazy('./dense/keyframe_manager.js'),lazy('./dense/deep_keyframe_selector.js')
  ]);
  if(epoch!==state.bridgeEpoch)return;

  // Transfer the already-open camera from the metric bridge when possible. The
  // Alva instance remains the same; dense mapping is a downstream consumer and
  // never feeds pose corrections back into SLAM.
  const sharedStream=bridge?.takeStream?.()||null;
  state.camera=new CameraController({video:$('camera'),width:CONFIG.analysisWidth,height:CONFIG.analysisHeight,fps:CONFIG.analysisFps,log,stream:sharedStream});
  try{await state.camera.start();}catch(err){if(sharedStream&&bridge){if(state.camera?.video)state.camera.video.srcObject=null;state.camera.stream=null;await bridge.restoreStream?.(sharedStream);}throw err;}
  if(epoch!==state.bridgeEpoch){state.camera.stop();return;}
  show('scan');if($('coach'))$('coach').textContent='AlvaAR traccia il mondo. Muoviti lentamente di lato: la superficie densa viene ricostruita in background.';

  const cal=calibration(),geometry=state.camera.geometry;
  const K=metric?.K||intrinsicsForCrop(metric?.intrinsicsNorm||cal?.commonView?.intrinsicsNorm||cal?.intrinsicsNorm,geometry,{fallbackFovDeg:CONFIG.cameraFovDeg});
  state.scanK=K;state.lastFrameGeometry=geometry;
  if(!state.frontend?.alva){state.frontend=await createAlvaFrontend(K);}else{state.frontend.resetLocalFeatures?.();}
  if(epoch!==state.bridgeEpoch){state.camera.stop();return;}
  if($('slamState'))$('slamState').textContent='ALVA TRACKING · INIT';
  log.info('slam-frontend-reused',{mode:state.frontend.mode,fromMetricBootstrap:!!bridge,metricTransform:!!metric?.alvaTransform});

  state.slam=new SlamEngine({frontend:state.frontend,K,log,keyframeIntervalMs:CONFIG.keyframeIntervalMs});
  if(metric?.alvaTransform)state.slam.setWorldTransform(metric.alvaTransform);

  state.liveOverlay=new LiveReconstructionOverlay($('miniMap'),{maxSplats:CONFIG.liveOverlayMaxSplats||4200});state.liveOverlay.setMode('both');
  state.gaussians=[];state.mesh=null;window.__ROOMSCAN_METRIC_MESH=null;state.denseBusy=false;state.denseJobs=0;state.denseDepthSamples=0;state.denseDepthHint=null;state.densePixelStep=CONFIG.densePixelStep||3;state.denseSourceLimit=Math.min(3,CONFIG.denseMaxSourceViews||4);state.surfaceStats=null;state.geometryAnchors=[];state.deepPending=null;state.deepDisabled=false;state.deepCalls=0;state.deepAccepted=0;
  const metricWorld=!!state.slam.metricLocked;
  state.denseManager=new DenseKeyframeManager({
    width:CONFIG.denseWidth||160,height:CONFIG.denseHeight||240,maxFrames:CONFIG.denseMaxKeyframes||8,
    minSources:CONFIG.denseMinSourceViews||2,maxSources:CONFIG.denseMaxSourceViews||4,
    minBaseline:metricWorld?(CONFIG.denseMinBaselineM||.045):(CONFIG.denseMinBaselineAlva||.02),
    maxBaseline:metricWorld?(CONFIG.denseMaxBaselineM||.75):(CONFIG.denseMaxBaselineAlva||1.5),
    maxAngleRad:CONFIG.denseMaxViewAngleRad||.38,minIntervalMs:CONFIG.denseMinKeyframeIntervalMs||650
  });

  state.denseDepthWorker=new Worker(`${CONFIG.denseDepthWorker}?v=${BUILD.version}`,{type:'module'});
  state.denseDepthWorker.onmessage=e=>handleDenseDepthMessage(e.data||{});
  state.denseDepthWorker.onerror=e=>{state.denseBusy=false;log.warn('dense-depth-worker',{message:e.message||'worker error'});if($('mvsState'))$('mvsState').textContent='DENSE errore · tracking Alva continua';};
  state.denseDepthWorker.postMessage({type:'init',config:{depthSteps:CONFIG.denseDepthSteps||40,pixelStep:CONFIG.densePixelStep||3,maxCost:CONFIG.denseMaxPhotoCost||.22,minConfidence:CONFIG.denseMinConfidence||.11,minTexture:CONFIG.denseMinTexture||.018,minDistinctiveness:CONFIG.denseMinDistinctiveness||.025,minViews:CONFIG.denseMinSourceViews||2,maxSamples:CONFIG.denseMaxSamplesPerDepth||14000}});

  // Depth Anything is lazy: creating this worker does not load the neural model.
  // Inference starts only when the selector sees a spatially novel Alva keyframe
  // with enough triangulated anchors to calibrate relative depth safely.
  state.deepSelector=new DeepKeyframeSelector({minIntervalMs:CONFIG.deepMinIntervalMs||2600,maxIntervalMs:CONFIG.deepMaxIntervalMs||8000,minTranslationM:CONFIG.deepMinTranslationM||.20,minTranslationAlva:CONFIG.deepMinTranslationAlva||.10,minRotationRad:CONFIG.deepMinRotationRad||.16,minAnchors:CONFIG.deepMinAnchors||7,minAnchorCells:CONFIG.deepMinAnchorCells||3,depthNovelty:CONFIG.deepDepthNovelty||.22});
  if(CONFIG.deepDepthEnabled!==false){
    state.deepDepthWorker=new Worker(`${CONFIG.deepDepthWorker}?v=${BUILD.version}`,{type:'module'});
    state.deepDepthWorker.onmessage=e=>void handleDeepDepthMessage(e.data||{});
    state.deepDepthWorker.onerror=e=>{state.deepDisabled=true;state.deepPending=null;state.deepSelector?.fail?.();state.denseBusy=false;log.warn('deep-depth-worker',{message:e.message||'worker error'});if($('mvsState'))$('mvsState').textContent='AI depth non disponibile · Alva continua';void scheduleDenseWork();};
    state.deepDepthWorker.postMessage({type:'init',config:{modelId:CONFIG.deepModelId,dtype:CONFIG.deepDtype||'q4',transformersLocal:CONFIG.deepTransformersLocal,transformersRemote:CONFIG.deepTransformersRemote}});
  }

  const voxel=metricWorld?(CONFIG.denseTsdfVoxelM||.035):(CONFIG.denseTsdfVoxelAlva||.03);
  state.denseFusionWorker=new Worker(`${CONFIG.denseFusionWorker}?v=${BUILD.version}`,{type:'module'});
  state.denseFusionWorker.onmessage=e=>handleDenseFusionMessage(e.data||{});
  state.denseFusionWorker.onerror=e=>log.warn('dense-fusion-worker',{message:e.message||'worker error'});
  state.denseFusionWorker.postMessage({type:'init',config:{voxel,truncation:voxel*(CONFIG.denseTsdfTruncVoxels||3),minSupport:CONFIG.denseMinSurfaceSupport||2,maxSurfels:CONFIG.denseMaxSurfels||180000,maxTsdf:CONFIG.denseMaxTsdfVoxels||450000,snapshotEvery:CONFIG.denseSurfaceSnapshotEvery||2,meshEvery:CONFIG.denseMeshEvery||5,maxSplats:CONFIG.gaussianSnapshot||50000,maxTriangles:CONFIG.denseMaxMeshTriangles||90000}});

  state.currentSession=await state.db?.createSession({calibrationBuild:cal?.createdAt||null,metricLocked:metricWorld,reconstruction:'alva+depth-anything-prior+multiview+tsdf'});
  if($('metricState'))$('metricState').textContent=metricWorld?`scala METRIC · Alva×${state.slam.metricScale?.toFixed?.(3)||'?'}`:'ALVA WORLD · scala libera';
  if($('mvsState'))$('mvsState').textContent='DENSE: raccolgo viste Alva per keyframe AI selettivi…';
  if($('metricPipelineHud'))$('metricPipelineHud').textContent='Surface mapper: attendo 3 viste con parallasse.';

  // The calibration bridge has no authority after the one-shot similarity is
  // locked. This is deliberately the last bridge-related line in Scan.
  if(bridge===state.bridge)state.bridge=null;state.alvaBootstrap=null;

  state.scanStop=state.camera.loop(frame=>{try{
    state.lastFrameGeometry=frame.geometry;const r=state.slam.process(frame);state.lastTracking=r;
    if($('statFeat'))$('statFeat').textContent=String(r.features);if($('statMatch'))$('statMatch').textContent=String(r.matches);if($('statKf'))$('statKf').textContent=String(r.keyframes);if($('alvaPtsState'))$('alvaPtsState').textContent=`ALVA pts ${r.alvaPoints||0}`;
    const status=r.trackingMode==='alvaar-relocalized'?'ALVA RELOCALIZED':r.trackingValid?'ALVA TRACKING':'ALVA LOST';
    if($('slamState'))$('slamState').textContent=`${status}${state.gaussians.length?' + SURFACE':''}`;
    if($('coach'))$('coach').textContent=r.trackingValid?'AlvaAR stabile · trasla lentamente, mantieni overlap e torna sulle zone già viste.':'Tracking Alva perso · fermati o torna verso una zona già osservata; dense mapping sospeso.';
    if(r.newKeyframe&&r.trackingValid)queueDenseKeyframe(r.newKeyframe,frame,K);
    state.liveOverlay?.draw({pose:r.pose,K,geometry:frame.geometry,video:state.camera.video,framePoints:r.framePoints||[]});
    if(state.currentSession&&r.newKeyframe&&r.keyframes%5===0)state.db?.updateSession(state.currentSession.id,{status:'scanning',counts:{keyframes:r.keyframes,denseSamples:state.denseDepthSamples,surfels:state.surfaceStats?.confirmed||0,gaussians:state.gaussians.length,meshFaces:state.mesh?.faces?.length?state.mesh.faces.length/3:0}}).catch(()=>{});
  }catch(err){log.warn('scan-frame',{message:err.message,stack:err.stack||null});}});
}

let scanAbortController=null;
function makeScanAbortSignal(){scanAbortController?.abort();scanAbortController=new AbortController();return scanAbortController.signal;}

async function queueDenseKeyframe(kf,frame,K){
  if(!state.denseManager||!state.denseDepthWorker)return;
  state.denseManager.add(kf,frame,K,{metricLocked:!!state.slam?.metricLocked});
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
  const sparse=buildSparseDepthAnchors(job.ref,selectedSources,{maxReprojectionPx:CONFIG.denseSeedMaxReprojectionPx||2.8,minAngleRad:CONFIG.denseSeedMinAngleRad||.010,maxGapBaselineRatio:CONFIG.denseSeedMaxGapBaselineRatio||.14});
  // Both AI calibration and multi-view refinement are permitted only after Alva
  // geometry proves the local depth range. A hole is preferable to a fake sheet.
  if(!sparse.range||sparse.seeds.length<(CONFIG.denseMinSparseSeeds||5)){log.info('dense-waiting-sparse-geometry',{ref:job.ref.id,...sparse.stats});return null;}
  let near=sparse.range.near,far=sparse.range.far;if(metric){near=Math.max(CONFIG.denseNearM||.20,near);far=Math.min(CONFIG.denseFarM||10,far);}if(!(far>near*1.35))return null;
  state.denseDepthHint=sparse.range.median;state.geometryAnchors=sparse.seeds.slice(0,120).map(x=>({p:x.p,confidence:x.confidence,reprojectionPx:x.reprojectionPx}));state.liveOverlay?.setGeometryAnchors(state.geometryAnchors);
  return {type:'depth',ref:cloneDenseFrame(job.ref),sources:selectedSources.map(cloneDenseFrame),K:job.ref.K,near,far,sparseSeeds:sparse.seeds.map(x=>({u:x.u,v:x.v,depth:x.depth,confidence:x.confidence})),config:{depthSteps:CONFIG.denseDepthSteps||64,pixelStep:state.densePixelStep||CONFIG.densePixelStep||3,minTexture:CONFIG.denseMinTexture||.018,minDistinctiveness:CONFIG.denseMinDistinctiveness||.025,minViews:Math.min(CONFIG.denseMinSourceViews||2,selectedSources.length),seedRadiusPx:CONFIG.denseSeedRadiusPx||22,seedMaxRelativeError:CONFIG.denseSeedMaxRelativeError||.48}};
}
function cloneDenseFrame(f){return {id:f.id,at:f.at,pose:f.pose,K:f.K,width:f.width,height:f.height,gray:f.gray,rgba:f.rgba,features:f.features||[]};}
async function dispatchDensePayload(payload){
  const decision=state.deepSelector?.evaluate({ref:payload.ref,sparseSeeds:payload.sparseSeeds,metricLocked:!!state.slam?.metricLocked})||{infer:false,reason:'selector-unavailable'};
  if(!state.deepDisabled&&state.deepDepthWorker&&decision.infer){
    state.deepSelector.noteAttempt(payload.ref,payload.sparseSeeds);state.deepPending=payload;state.deepCalls++;
    state.deepDepthWorker.postMessage({type:'infer',jobId:payload.jobId,refId:payload.ref.id,rgba:payload.ref.rgba,width:payload.ref.width,height:payload.ref.height});
    if($('mvsState'))$('mvsState').textContent=`AI ${state.deepCalls}: keyframe utile · ${payload.sparseSeeds.length} anchor · ${decision.reason}`;
    log.info('deep-depth-request',{jobId:payload.jobId,refId:payload.ref.id,calls:state.deepCalls,reason:decision.reason,anchors:payload.sparseSeeds.length,cells:decision.cells});return;
  }
  if(CONFIG.deepSkipUnprioritized!==false){
    // Near-duplicate views add little 3D context. Skipping them saves inference
    // and, crucially, avoids falling back to unconstrained depth sheets.
    state.denseBusy=false;log.info('deep-depth-skip',{jobId:payload.jobId,refId:payload.ref.id,reason:state.deepDisabled?'ai-disabled':decision.reason});
    if($('mvsState'))$('mvsState').textContent=`AI selettiva · salto vista ${decision.reason||'ridondante'} · calls ${state.deepCalls}`;
    queueMicrotask(()=>void scheduleDenseWork());return;
  }
  state.denseDepthWorker.postMessage(payload);
}
async function handleDeepDepthMessage(d){
  if(d.type==='deep-ready'){log.info('deep-depth-lazy-ready',{modelId:d.modelId});return;}
  if(d.type==='deep-diag'){log[d.level==='warn'?'warn':'info']?.(`deep-${d.event||'diag'}`,{message:d.message});return;}
  if(d.type==='deep-error'){
    const pending=state.deepPending;state.deepPending=null;state.deepDisabled=true;state.deepSelector?.fail?.();state.denseBusy=false;
    log.warn('deep-depth-error',{jobId:d.jobId,message:d.message,provider:d.provider,ms:d.ms});if($('mvsState'))$('mvsState').textContent='Depth Anything non disponibile in questa scansione · tracking Alva attivo';
    // Do not feed the failed frame to unconstrained plane sweep: correctness is
    // more important than filling geometry with a camera-facing sheet.
    if(pending)log.info('deep-depth-frame-dropped',{refId:pending.ref.id});void scheduleDenseWork();return;
  }
  if(d.type!=='deep-result')return;const payload=state.deepPending;if(!payload||payload.jobId!==d.jobId)return;state.deepPending=null;
  const {calibrateRelativeDepth}=await lazy('./dense/deep_metric.js');
  const cal=calibrateRelativeDepth({rawDepth:d.rawDepth,rawWidth:d.rawWidth,rawHeight:d.rawHeight,outWidth:payload.ref.width,outHeight:payload.ref.height,sparseSeeds:payload.sparseSeeds,near:payload.near,far:payload.far,minAnchors:CONFIG.deepMinAnchors||7,minCells:CONFIG.deepMinAnchorCells||3,maxMedianRelativeError:CONFIG.deepCalibrationMaxMedianRelativeError||.18});
  if(!cal.ok){state.denseBusy=false;log.warn('deep-depth-calibration-rejected',{jobId:d.jobId,reason:cal.reason,anchors:cal.anchorCount,cells:cal.cells,medianRelativeError:cal.medianRelativeError});if($('mvsState'))$('mvsState').textContent=`AI depth rifiutata (${cal.reason}) · cerco una vista migliore`;void scheduleDenseWork();return;}
  state.deepSelector?.commit?.(payload.ref,payload.sparseSeeds);state.deepAccepted++;
  payload.depthPrior={depth:cal.depth,width:cal.width,height:cal.height,confidence:cal.confidence,mode:cal.mode};Object.assign(payload.config,{priorRelRange:CONFIG.deepPriorRelRange||.18,priorDepthSteps:CONFIG.deepPriorDepthSteps||18,priorWeight:CONFIG.deepPriorWeight||.10,priorMinConfidence:CONFIG.deepPriorMinConfidence||.28,priorMinTexture:CONFIG.deepPriorMinTexture||.006});
  log.info('deep-depth-calibrated',{jobId:d.jobId,provider:d.provider,aiMs:d.ms,mode:cal.mode,confidence:cal.confidence,inliers:cal.inliers,anchors:cal.anchorCount,cells:cal.cells,medianRelativeError:cal.medianRelativeError,validRatio:cal.validRatio});
  if($('mvsState'))$('mvsState').textContent=`AI→ALVA ${cal.inliers}/${cal.anchorCount} anchor · errore ${(cal.medianRelativeError*100).toFixed(1)}% · verifico multi-view`;
  state.denseDepthWorker.postMessage(payload);
}
function handleDenseDepthMessage(d){
  if(d.type==='ready'){if($('mvsState'))$('mvsState').textContent='DENSE pronto · AI verrà usata solo su viste utili';return;}
  if(d.type==='depth-error'){state.denseBusy=false;log.warn('dense-depth',{jobId:d.jobId,message:d.message,stack:d.stack||null});if($('mvsState'))$('mvsState').textContent='Refinement multi-view fallito · continuo con Alva';void scheduleDenseWork();return;}
  if(d.type!=='depth-result')return;state.denseBusy=false;
  if(d.medianDepth)state.denseDepthHint=state.denseDepthHint?state.denseDepthHint*.7+d.medianDepth*.3:d.medianDepth;
  state.denseDepthSamples+=d.samples?.length||0;if(d.ms>1800){state.densePixelStep=Math.min(5,(state.densePixelStep||3)+1);state.denseSourceLimit=2;}else if(d.ms<650){state.densePixelStep=Math.max(3,(state.densePixelStep||3)-1);state.denseSourceLimit=Math.min(3,CONFIG.denseMaxSourceViews||4);}if($('statTri'))$('statTri').textContent=String(state.denseDepthSamples);
  if($('mvsState'))$('mvsState').textContent=d.validCount?`DEPTH AI+ALVA ${d.validCount} px · ${(d.coverage*100).toFixed(0)}% · ${d.ms.toFixed(0)} ms`:'DEPTH rifiutata · serve più overlap/parallasse';
  if(d.samples?.length){state.denseFusionWorker?.postMessage({type:'integrate',samples:d.samples,origin:d.origin||[0,0,0],frameId:d.refId});log.info('dense-depth-result',{jobId:d.jobId,samples:d.samples.length,coverage:d.coverage,medianDepth:d.medianDepth,ms:d.ms,deepAccepted:state.deepAccepted,deepCalls:state.deepCalls});}
  void scheduleDenseWork();
}
function handleDenseFusionMessage(d){
  if(d.type==='ready'){if($('metricPipelineHud'))$('metricPipelineHud').textContent='Surface mapper pronto · attendo depth map.';return;}
  if(d.type==='fusion-error'){log.warn('dense-fusion',{message:d.message,stack:d.stack||null});return;}
  if(d.type!=='surface-result'&&d.type!=='surface-snapshot'&&d.type!=='mesh-result')return;
  if(d.splats?.length){state.gaussians=d.splats;state.liveOverlay?.setGaussians(d.splats);if($('statGs'))$('statGs').textContent=String(d.splats.length);}
  if(d.mesh?.vertices?.length){state.mesh=d.mesh;window.__ROOMSCAN_METRIC_MESH=d.mesh;state.liveOverlay?.setMesh(d.mesh);window.dispatchEvent(new CustomEvent('roomscan:metric-mesh',{detail:{live:true,vertices:d.mesh.vertices.length/3,faces:d.mesh.faces.length/3}}));}
  if(d.type==='mesh-result'&&d.vertices?.length){state.mesh=d;window.__ROOMSCAN_METRIC_MESH=d;state.liveOverlay?.setMesh(d);}
  state.surfaceStats={frames:d.frames??state.surfaceStats?.frames??0,surfels:d.surfels??state.surfaceStats?.surfels??0,tsdfVoxels:d.tsdfVoxels??state.surfaceStats?.tsdfVoxels??0,confirmed:d.confirmed??d.splats?.length??state.surfaceStats?.confirmed??0};
  const faces=state.mesh?.faces?.length?state.mesh.faces.length/3:0,unit=state.slam?.metricLocked?'m':'u.Alva';
  if($('metricPipelineHud'))$('metricPipelineHud').textContent=`DENSE ${state.denseJobs} mappe · surface ${state.surfaceStats.confirmed||0} · TSDF ${state.surfaceStats.tsdfVoxels||0} · mesh ${faces} facce · ${unit}`;
}
async function waitForDenseIdle(timeoutMs=4500){const start=performance.now();while(state.denseBusy&&performance.now()-start<timeoutMs)await new Promise(r=>setTimeout(r,35));}
function workerRequest(worker,message,accept,timeoutMs=3500){return new Promise(resolve=>{if(!worker)return resolve(null);const timer=setTimeout(()=>{worker.removeEventListener('message',handler);resolve(null);},timeoutMs),handler=e=>{if(!accept(e.data||{}))return;clearTimeout(timer);worker.removeEventListener('message',handler);resolve(e.data||null);};worker.addEventListener('message',handler);worker.postMessage(message);});}
function stopScan(){scanAbortController?.abort();scanAbortController=null;state.scanStop?.();state.scanStop=null;state.camera?.stop();state.camera=null;state.deepDepthWorker?.terminate();state.deepDepthWorker=null;state.deepSelector?.reset?.();state.deepSelector=null;state.deepPending=null;state.denseDepthWorker?.terminate();state.denseDepthWorker=null;state.denseFusionWorker?.terminate();state.denseFusionWorker=null;state.denseManager?.reset?.();state.denseManager=null;state.denseBusy=false;state.liveOverlay=null;}
async function finishScan(){
  await waitForDenseIdle();
  const snap=await workerRequest(state.denseFusionWorker,{type:'snapshot',maxSplats:CONFIG.gaussianSnapshot},d=>d.type==='surface-snapshot',2500);if(snap?.splats?.length)state.gaussians=snap.splats;
  const mesh=await workerRequest(state.denseFusionWorker,{type:'mesh',maxTriangles:CONFIG.denseMaxMeshTriangles||90000},d=>d.type==='mesh-result',6500);if(mesh?.vertices?.length){state.mesh=mesh;window.__ROOMSCAN_METRIC_MESH=mesh;}
  const kfCount=state.slam?.keyframes?.length||0;stopScan();
  if(state.currentSession)await state.db?.updateSession(state.currentSession.id,{status:'finished',counts:{keyframes:kfCount,denseSamples:state.denseDepthSamples,surfels:state.gaussians.length,meshFaces:state.mesh?.faces?.length?state.mesh.faces.length/3:0}});
  await showReview();
}
async function showReview(){
  show('review');const {GaussianRenderer}=await lazy('./gaussian/renderer.js');if(!state.renderer)state.renderer=new GaussianRenderer($('viewer'));state.renderer.setData(state.gaussians);if(state.mesh)state.renderer.setMesh(state.mesh);state.renderer.fit();state.renderer.draw();
  const faces=state.mesh?.faces?.length?state.mesh.faces.length/3:0;if($('reviewStats'))$('reviewStats').textContent=`Surface splat: ${state.gaussians.length} · depth sample ${state.denseDepthSamples} · mesh ${faces} facce · scala ${state.slam?.metricLocked?'metrica':'Alva libera'} · keyframe ${state.slam?.keyframes?.length||0} · tracking ${state.lastTracking?.trackingMode||'n/d'}`;
  if($('metricGsStats'))$('metricGsStats').textContent=state.mesh?`TSDF mesh: ${state.mesh.vertices.length/3} vertici / ${faces} facce · superficie derivata da depth multi-view.`:'TSDF mesh non disponibile: acquisisci più viste laterali con texture.';
}
async function renderSessions(){if(!state.db)return;const xs=(await state.db.getAll('sessions')).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,8),el=$('savedSessions');if(!el)return;el.textContent='';if(!xs.length){el.innerHTML='<span class="muted">Nessuna sessione salvata.</span>';return;}for(const s of xs){const d=document.createElement('div');d.className='status';d.style.margin='.35rem 0';d.textContent=`${new Date(s.createdAt).toLocaleString()} · ${s.status||'sessione'} · KF ${s.counts?.keyframes||0} · GS ${s.counts?.gaussians||0}`;el.appendChild(d);}}
async function runTests(){const {runSelfTests}=await lazy('./self_test.js');const out=await runSelfTests(log),ok=out.filter(x=>x.ok).length;if($('selfTestSummary'))$('selfTestSummary').textContent=`Self-test: ${ok}/${out.length} PASS`;if($('diagLive'))$('diagLive').textContent=out.map(x=>`${x.ok?'PASS':'FAIL'} ${x.name}${x.ok?'':`: ${x.error}`}`).join('\n');if($('diagPanel'))$('diagPanel').open=true;}
async function clearCachesAndReload(){try{const regs=await navigator.serviceWorker?.getRegistrations?.()||[];for(const reg of regs){let own=false;try{own=new URL(reg.scope).pathname.includes('/room_scanner/v30/');}catch{}if(!own)continue;try{reg.active?.postMessage({type:'CLEAR_V30_CACHES'});await reg.unregister();}catch{}}if(window.caches)for(const k of await caches.keys())if(k.startsWith('room-scanner-v30')||k.startsWith('room-scanner-alvaar'))await caches.delete(k);try{sessionStorage.removeItem('roomscan-v30-sw-clean-attempt');}catch{}}catch(err){log.warn('force-update-cleanup',{message:err?.message||String(err)});}location.replace(`${location.pathname}?v30reset=${BUILD.version}-${Date.now()}`);}
async function loadPly(file){const {parsePly}=await lazy('./formats.js');state.gaussians=parsePly(await file.text());state.mesh=null;await showReview();}
async function loadR30(file){const {decodeR30}=await lazy('./formats.js');const x=await decodeR30(file);state.gaussians=x.gaussians||x.snapshot?.gaussians||[];state.mesh=x.mesh?{...x.mesh,vertices:new Float32Array(x.mesh.vertices||[]),colors:new Uint8Array(x.mesh.colors||[]),faces:new Uint32Array(x.mesh.faces||[])}:null;await showReview();}
async function exportPly(){const {gaussiansToPly,downloadBlob}=await lazy('./formats.js');downloadBlob(new Blob([gaussiansToPly(state.gaussians,BUILD.id)],{type:'application/octet-stream'}),`roomscan-${Date.now()}.ply`);}
async function exportR30(){const {encodeR30,downloadBlob}=await lazy('./formats.js');downloadBlob(encodeR30({build:BUILD,calibration:calibration(),gaussians:state.gaussians,mesh:state.mesh?{vertices:Array.from(state.mesh.vertices||[]),colors:Array.from(state.mesh.colors||[]),faces:Array.from(state.mesh.faces||[]),voxelM:state.mesh.voxelM}:null,reconstruction:{type:'alva-dense-plane-sweep-tsdf',denseSamples:state.denseDepthSamples}}),`roomscan-${Date.now()}.r30`);}
async function exportMeshPly(){if(!state.mesh?.vertices?.length)throw new Error('Mesh TSDF non ancora disponibile');const {downloadBlob}=await lazy('./formats.js'),m=state.mesh,V=m.vertices,C=m.colors||[],F=m.faces||[],nv=V.length/3,nf=F.length/3,lines=['ply','format ascii 1.0',`comment Room Scanner ${BUILD.version} TSDF mesh`,`element vertex ${nv}`,'property float x','property float y','property float z','property uchar red','property uchar green','property uchar blue',`element face ${nf}`,'property list uchar int vertex_indices','end_header'];for(let i=0;i<nv;i++)lines.push(`${V[i*3]} ${V[i*3+1]} ${V[i*3+2]} ${C[i*3]??180} ${C[i*3+1]??180} ${C[i*3+2]??180}`);for(let i=0;i<nf;i++)lines.push(`3 ${F[i*3]} ${F[i*3+1]} ${F[i*3+2]}`);downloadBlob(new Blob([lines.join('\n')+'\n'],{type:'application/octet-stream'}),`roomscan-mesh-${Date.now()}.ply`);}

function bind(){on('calibrateBtn','click',safe('begin-calibration',beginCalibration));on('clearCalibrationBtn','click',()=>{localStorage.removeItem(CONFIG.calibrationStorageKey);updateCalibrationUi();});on('calibAddPinBtn','click',safe('add-calibration-pin',addCalibrationPin));on('calibUndoPinBtn','click',()=>{state.calibrator?.undoLastTarget();updateProgress(state.calibrator?.quality());});on('calibFinishBtn','click',safe('finish-calibration',finishCalibration));on('calibCancelBtn','click',safe('cancel-calibration',cancelCalibration));on('startBtn','click',safe('begin-bridge',beginBridge));on('bridgeRetryBtn','click',safe('retry-bridge',beginBridge));on('bridgeCancelBtn','click',()=>{state.bridgeEpoch++;state.bridgeTransition=false;state.bridge?.stop();state.bridge=null;show('home');});on('finishBtn','click',safe('finish-scan',finishScan));on('backHomeBtn','click',()=>show('home'));on('resumeBtn','click',safe('resume-scan',beginBridge));on('fitBtn','click',()=>{state.renderer?.fit();state.renderer?.draw();});on('viewTopBtn','click',()=>state.renderer?.setPreset('top'));on('viewFrontBtn','click',()=>state.renderer?.setPreset('front'));on('viewSideBtn','click',()=>state.renderer?.setPreset('side'));on('arModeBtn','click',()=>{const mode=state.liveOverlay?.cycleMode()||'off';const b=$('arModeBtn');if(b)b.textContent=`AR: ${mode==='gs'?'Surface':mode==='mesh'?'Mesh':mode==='both'?'Surface+Mesh':'Off'}`;});on('splatSize','input',e=>state.renderer?.setSplatSize(e.target.value));on('loadPlyBtn','click',()=>$('filePly')?.click());on('filePly','change',safe('load-ply',async e=>{if(e.target.files?.[0])await loadPly(e.target.files[0]);e.target.value='';}));on('loadR30Btn','click',()=>$('fileR30')?.click());on('fileR30','change',safe('load-r30',async e=>{if(e.target.files?.[0])await loadR30(e.target.files[0]);e.target.value='';}));on('exportPlyBtn','click',safe('export-ply',exportPly));on('exportR30Btn','click',safe('export-r30',exportR30));on('buildMetricMeshBtn','click',safe('export-mesh',exportMeshPly));on('exportDiagBtn','click',()=>log.download());on('diagDownloadBtn','click',()=>log.download());on('diagCopyBtn','click',()=>navigator.clipboard?.writeText(log.text()).catch(()=>{}));on('selfTestBtn','click',safe('self-test',runTests));on('forceUpdateBtn','click',safe('force-update',clearCachesAndReload));on('diagForceUpdateBtn','click',safe('force-update',clearCachesAndReload));on('pinBtn','click',safe('manual-scan-pin',async()=>{const pose=state.slam?.pose;if(!pose||!state.liveOverlay)throw new Error('AlvaAR non ha ancora una posa valida');const {qRotate}=await lazy('./slam/math.js');const d=qRotate(pose.q,[0,0,1]),distance=state.slam.metricLocked?1.25:1;const p=[pose.p[0]+d[0]*distance,pose.p[1]+d[1]*distance,pose.p[2]+d[2]*distance];state.liveOverlay.setReferencePoint(p);const b=$('pinBtn');if(b)b.textContent='◎ Repere ✓';log.info('manual-scan-pin',{pose,point:p,metricLocked:state.slam.metricLocked});}));log.addEventListener('entry',()=>{const live=$('diagLive');if(live&&$('diagPanel')?.open)live.textContent=log.entries.slice(-80).map(x=>`${new Date(x.at).toLocaleTimeString()} ${x.level.toUpperCase()} ${x.event} ${JSON.stringify(x.data)}`).join('\n');});}

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

async function initBackground(){const dbJob=(async()=>{try{const {V30Database}=await lazy('./storage/db.js');state.db=await new V30Database().open();await renderSessions();log.info('db-ready',{});}catch(err){log.error('db-open',{message:err?.message||String(err)});const s=$('homeStatus');if(s&&s.dataset.kind!=='error')s.textContent='Interfaccia pronta · storage locale non disponibile.';}})();void dbJob;setTimeout(async()=>{try{if(!('serviceWorker'in navigator))return;await navigator.serviceWorker.register(`${CONFIG.serviceWorker}?v=${BUILD.version}`,{scope:'./'});await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(resolve,3500))]);log.info('service-worker-ready',{version:BUILD.version});}catch(err){log.warn('service-worker-register',{message:err?.message||String(err)});}},CONFIG.serviceWorkerRegisterDelayMs||2500);}

function boot(){bind();document.documentElement.dataset.v30Interactive='1';if(window.__ROOMSCAN_PREBOOT){window.__ROOMSCAN_PREBOOT.interactive=true;window.__ROOMSCAN_PREBOOT.interactiveAt=Date.now();}if($('buildBadge'))$('buildBadge').textContent=`V${BUILD.version}`;if($('buildFoot'))$('buildFoot').textContent=`${BUILD.id} · DB target v${BUILD.dbVersion}`;updateCalibrationUi();if($('homeStatus'))$('homeStatus').textContent='Interfaccia pronta.';log.info('ui-interactive',{build:BUILD.id});void initBackground();document.documentElement.dataset.v30Ready='1';}
boot();
