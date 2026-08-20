/**
 * Room Scanner V30.14.1 core application.
 *
 * BOOT CONTRACT
 * -------------
 * Only config + logger are static imports. UI handlers are bound immediately.
 * Storage, WebXR, camera, SLAM, diagnostics and metric extensions are imported
 * lazily after the page is already interactive. A failure in an optional module
 * therefore cannot leave the visible page with dead buttons.
 */
import {BUILD,CONFIG} from './config.js?v=30.14.1';
import {DiagnosticsLog} from './logger.js?v=30.14.1';

const $=id=>document.getElementById(id);
const log=new DiagnosticsLog({build:BUILD});
const state={db:null,calibrator:null,bridge:null,bridgeStable:0,bridgeEpoch:0,bridgeTransition:false,alvaBootstrap:null,camera:null,frontend:null,slam:null,gaussianWorker:null,mvsWorker:null,mvsBusy:false,mvsBase:null,mvsInFlight:null,mvsPairs:0,mvsPointsTotal:0,mvsLastResult:null,gaussians:[],renderer:null,currentSession:null,scanStop:null,liveOverlay:null,scanK:null,lastFrameGeometry:null,lastTracking:null};
window.RoomScanV30={BUILD,CONFIG,state,log};
const moduleCache=new Map();
function lazy(path){if(!moduleCache.has(path))moduleCache.set(path,import(`${path}?v=${BUILD.version}`));return moduleCache.get(path);}
function safe(name,fn){return async(...args)=>{try{return await fn(...args)}catch(err){log.error(name,{message:err?.message||String(err),stack:err?.stack||null});showError(err?.message||String(err));return null;}};}
function on(id,type,handler,options){const el=$(id);if(!el){log.warn('ui-missing-control',{id,type});return null;}el.addEventListener(type,handler,options);return el;}
function show(id){for(const el of document.querySelectorAll('.screen'))el.classList.toggle('active',el.id===id);document.body.classList.toggle('immersive-ui',id!=='home'&&id!=='review');}
function showError(message){const s=$('homeStatus');if(s){s.dataset.kind='error';s.textContent=message;}const d=$('diagPanel');if(d)d.open=true;}
function calibration(){try{const x=JSON.parse(localStorage.getItem(CONFIG.calibrationStorageKey)||'null');return x?.calibration||x?.value||x;}catch{return null;}}
function saveCalibration(c){localStorage.setItem(CONFIG.calibrationStorageKey,JSON.stringify({format:'ROOMSCAN-V30-CALIBRATION-PROFILE-1',savedAt:Date.now(),build:BUILD.id,calibration:c}));updateCalibrationUi();}
function metricCalibrationInfo(c=calibration()){const ids=new Set((c?.anchors||[]).filter(a=>a?.realAnchor&&Array.isArray(a?.p)).map(a=>a.objectId));const n=c?.objects?.length||ids.size;return {calibration:c,ids,n,valid:!!c&&ids.size>=3&&n>=3};}
function updateCalibrationUi(){const {calibration:c,ids,n,valid}=metricCalibrationInfo(),summary=$('calibSummary'),start=$('startBtn');if(!c){if(summary)summary.textContent='Nessuna scala metrica: AlvaAR può comunque partire e mantenere il proprio mondo in scala libera.';if(start){start.disabled=false;start.textContent='Avvia AlvaAR';}return;}const p=c.poseCoverage?.length||c.quality?.poseCount||0;if(summary)summary.textContent=valid?`Bootstrap metrico disponibile: ${n} pin 3D · ${p} pose. Dopo l’aggancio AlvaAR prosegue autonomamente.`:`Calibrazione incompleta (${ids.size}/3 pin metrici). AlvaAR può comunque partire in scala libera.`;if(start){start.disabled=false;start.textContent=valid?'Avvia misura metrica':'Avvia AlvaAR';}}
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
  const info=metricCalibrationInfo(),cal=info.valid?info.calibration:null,epoch=++state.bridgeEpoch;
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
  await lazy('./metric/gaussian_metric_tap.js').catch(err=>log.warn('gaussian-metric-tap',{message:err.message}));
  await lazy('./metric/metric_mesh_ui.js').catch(err=>log.warn('metric-mesh-ui',{message:err.message}));
  const [{CameraController,intrinsicsForCrop},{SlamEngine},{LiveReconstructionOverlay}]=await Promise.all([lazy('./camera.js'),lazy('./slam/slam_engine.js'),lazy('./gaussian/ar_overlay.js')]);
  if(epoch!==state.bridgeEpoch)return;

  // If the metric bootstrap was used, transfer its stream. AlvaAR itself is NOT
  // re-created: state.frontend is intentionally the same world tracker.
  const sharedStream=bridge?.takeStream?.()||null;
  state.camera=new CameraController({video:$('camera'),width:CONFIG.analysisWidth,height:CONFIG.analysisHeight,fps:CONFIG.analysisFps,log,stream:sharedStream});
  try{await state.camera.start();}catch(err){if(sharedStream&&bridge){if(state.camera?.video)state.camera.video.srcObject=null;state.camera.stream=null;await bridge.restoreStream?.(sharedStream);}throw err;}
  if(epoch!==state.bridgeEpoch){state.camera.stop();return;}
  show('scan');if($('coach'))$('coach').textContent='AlvaAR inizializza e mantiene il mondo. Muoviti lentamente, con texture e parallasse.';

  const cal=calibration(),geometry=state.camera.geometry;
  const K=metric?.K||intrinsicsForCrop(metric?.intrinsicsNorm||cal?.commonView?.intrinsicsNorm||cal?.intrinsicsNorm,geometry,{fallbackFovDeg:CONFIG.cameraFovDeg});
  state.scanK=K;state.lastFrameGeometry=geometry;
  if(!state.frontend?.alva){state.frontend=await createAlvaFrontend(K);}else{state.frontend.resetLocalFeatures?.();}
  if(epoch!==state.bridgeEpoch){state.camera.stop();return;}
  if($('slamState'))$('slamState').textContent='ALVA TRACKING · INIT';
  log.info('slam-frontend-reused',{mode:state.frontend.mode,fromMetricBootstrap:!!bridge,metricTransform:!!metric?.alvaTransform});

  state.slam=new SlamEngine({frontend:state.frontend,K,log,keyframeIntervalMs:CONFIG.keyframeIntervalMs});
  if(metric?.alvaTransform)state.slam.setWorldTransform(metric.alvaTransform);

  state.liveOverlay=new LiveReconstructionOverlay($('miniMap'),{maxSplats:CONFIG.liveOverlayMaxSplats||3200});state.liveOverlay.setMode('gs');
  window.addEventListener('roomscan:metric-mesh',()=>{state.liveOverlay?.setMesh(window.__ROOMSCAN_METRIC_MESH||null);},{signal:makeScanAbortSignal()});
  state.gaussians=[];state.mvsBusy=false;state.mvsBase=null;state.mvsInFlight=null;state.mvsPairs=0;state.mvsPointsTotal=0;state.mvsLastResult=null;
  state.gaussianWorker=new Worker(`${CONFIG.gaussianWorker}?v=${BUILD.version}`);
  state.gaussianWorker.onmessage=e=>{const d=e.data||{};if(d.type==='snapshot'&&Array.isArray(d.gaussians)){state.gaussians=d.gaussians;state.liveOverlay?.setGaussians(d.gaussians);const el=$('statGs');if(el)el.textContent=String(d.visibleCount??d.gaussians.length);lazy('./metric/metric_mesh_ui.js').then(m=>m.requestLiveMesh?.()).catch(()=>{});}else if(d.type==='error')log.warn('gaussian-worker',{message:d.message,stack:d.stack||null});};
  state.gaussianWorker.postMessage({type:'init',config:{voxel:CONFIG.gaussianVoxelM,maxGaussians:CONFIG.gaussianMaxLive,maxSnapshot:CONFIG.gaussianSnapshot,minSupport:CONFIG.gaussianMinSupport||2}});
  state.mvsWorker=new Worker(`${CONFIG.mvsWorker}?v=${BUILD.version}`);state.mvsWorker.onmessage=e=>handleMvsMessage(e.data||{});state.mvsWorker.postMessage({type:'init',config:{near:CONFIG.mvsNearM,far:CONFIG.mvsFarM,maxPoints:CONFIG.mvsMaxPoints,minBaselineM:CONFIG.mvsMinBaselineM,maxBaselineM:CONFIG.mvsMaxBaselineM,minParallaxPx:CONFIG.mvsMinParallaxPx,maxRayGapM:CONFIG.mvsMaxRayGapM,maxFeatures:CONFIG.mvsMaxFeatures}});
  state.currentSession=await state.db?.createSession({calibrationBuild:cal?.createdAt||null,metricLocked:!!state.slam.metricLocked});
  if($('metricState'))$('metricState').textContent=state.slam.metricLocked?`scala METRIC · Alva×${state.slam.metricScale?.toFixed?.(3)||'?'}`:'ALVA WORLD · scala libera';
  if(!state.slam.metricLocked&&$('mvsState'))$('mvsState').textContent='MVS sospeso · serve una scala metrica';

  // The bridge has no further authority over tracking after this line.
  if(bridge===state.bridge)state.bridge=null;
  state.alvaBootstrap=null;

  state.scanStop=state.camera.loop(frame=>{try{
    state.lastFrameGeometry=frame.geometry;const r=state.slam.process(frame);state.lastTracking=r;
    if($('statFeat'))$('statFeat').textContent=String(r.features);if($('statMatch'))$('statMatch').textContent=String(r.matches);if($('statKf'))$('statKf').textContent=String(r.keyframes);
    const status=r.trackingMode==='alvaar-relocalized'?'ALVA RELOCALIZED':r.trackingValid?'ALVA TRACKING':'ALVA LOST';
    if($('slamState'))$('slamState').textContent=`${status}${state.gaussians.length?' + GS':''}`;
    if($('coach'))$('coach').textContent=r.trackingValid?'AlvaAR stabile · muoviti lentamente e torna anche su zone già viste per favorire la relocalizzazione.':'Tracking Alva perso · fermati o torna verso una zona già osservata; la mappa è congelata.';
    // Metric MVS is downstream of Alva. Lost frames and scale-free frames never
    // create geometry, preventing a secondary tracker from bending the map.
    if(r.newKeyframe&&r.metricLocked&&(r.keyframes%(CONFIG.mvsEveryNthKeyframe||1)===0))queueMvsKeyframe(r.newKeyframe,frame,K);
    state.liveOverlay?.draw({pose:r.pose,K,geometry:frame.geometry,video:state.camera.video});
    if(state.currentSession&&r.newKeyframe&&r.keyframes%5===0)state.db?.updateSession(state.currentSession.id,{status:'scanning',counts:{keyframes:r.keyframes,triangulated:state.mvsPointsTotal,gaussians:state.gaussians.length}}).catch(()=>{});
  }catch(err){log.warn('scan-frame',{message:err.message,stack:err.stack||null});}});
}

let scanAbortController=null;
function makeScanAbortSignal(){scanAbortController?.abort();scanAbortController=new AbortController();return scanAbortController.signal;}

function stripMvsImage(kf){return kf?{id:kf.id,at:kf.at,pose:kf.pose,features:kf.features,width:kf.width,height:kf.height}:null;}
function poseBaseline(a,b){return Math.hypot(a.pose.p[0]-b.pose.p[0],a.pose.p[1]-b.pose.p[1],a.pose.p[2]-b.pose.p[2]);}
function queueMvsKeyframe(kf,frame,K){
  if(!state.mvsWorker||!kf?.features?.length)return;
  const current={id:kf.id,at:kf.at,pose:kf.pose,features:kf.features.slice(0,CONFIG.mvsMaxFeatures||420),width:frame.width,height:frame.height};
  if(!state.mvsBase){state.mvsBase=current;if($('mvsState'))$('mvsState').textContent='MVS: acquisito riferimento · muoviti lateralmente';return;}
  const baseline=poseBaseline(state.mvsBase,current),min=CONFIG.mvsMinBaselineM||.03,max=CONFIG.mvsMaxBaselineM||1.25;
  if(baseline<min){if($('mvsState'))$('mvsState').textContent=`MVS: baseline ${(baseline*100).toFixed(1)} cm / ${(min*100).toFixed(0)} cm`;return;}
  if(baseline>max){state.mvsBase=current;if($('mvsState'))$('mvsState').textContent='MVS: movimento troppo ampio · nuovo riferimento';return;}
  if(state.mvsBusy){if($('mvsState'))$('mvsState').textContent='MVS: elaborazione coppia…';return;}
  const rgba=new Uint8ClampedArray(frame.rgba||[]),b={...current,rgba};
  state.mvsBusy=true;state.mvsInFlight={nextBase:current,baseline};
  state.mvsWorker.postMessage({type:'pair',a:state.mvsBase,b,K,minBaselineM:min,maxBaselineM:max},rgba.buffer?[rgba.buffer]:[]);
  if($('mvsState'))$('mvsState').textContent=`MVS: triangolo baseline ${(baseline*100).toFixed(1)} cm…`;
}
function handleMvsMessage(d){
  if(d.type==='ready'){if($('mvsState'))$('mvsState').textContent='MVS pronto · muoviti lateralmente';return;}
  if(d.type==='mvs-error'){state.mvsBusy=false;log.warn('mvs-worker',{message:d.message,stack:d.stack||null});if($('mvsState'))$('mvsState').textContent='MVS errore · continua lentamente';return;}
  if(d.type!=='mvs-result')return;
  const flight=state.mvsInFlight;state.mvsBusy=false;state.mvsInFlight=null;if(flight?.nextBase)state.mvsBase=flight.nextBase;state.mvsLastResult=d;
  if(d.points?.length){
    state.mvsPairs++;state.mvsPointsTotal+=d.points.length;
    if($('statTri'))$('statTri').textContent=String(state.mvsPointsTotal);
    if($('mvsState'))$('mvsState').textContent=`MVS ${state.mvsPairs} coppie · +${d.points.length} pt · ${(d.baseline*100).toFixed(1)} cm`;
    state.gaussianWorker?.postMessage({type:'add',points:d.points,sourceId:`mvs-${state.mvsPairs}`});
    log.info('mvs-pair',{points:d.points.length,total:state.mvsPointsTotal,baseline:d.baseline,matches:d.matches,triangulated:d.triangulated});
  }else{
    const reason=d.reason||`0/${d.matches||0} triangolati`;
    if($('mvsState'))$('mvsState').textContent=`MVS: ${reason} · spostati lateralmente mantenendo overlap`;
    log.info('mvs-empty',{reason,baseline:d.baseline,matches:d.matches,triangulated:d.triangulated});
  }
}
async function waitForMvsIdle(timeoutMs=1600){const start=performance.now();while(state.mvsBusy&&performance.now()-start<timeoutMs)await new Promise(r=>setTimeout(r,30));}
function stopScan(){scanAbortController?.abort();scanAbortController=null;state.scanStop?.();state.scanStop=null;state.camera?.stop();state.camera=null;state.gaussianWorker?.terminate();state.gaussianWorker=null;state.mvsWorker?.terminate();state.mvsWorker=null;state.mvsBusy=false;state.mvsInFlight=null;state.mvsBase=null;state.liveOverlay=null;}
async function finishScan(){await waitForMvsIdle();if(state.gaussianWorker){const snap=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(state.gaussians),900),handler=e=>{if(e.data?.type==='snapshot'){clearTimeout(timer);state.gaussianWorker.removeEventListener('message',handler);resolve(e.data.gaussians||state.gaussians);}};state.gaussianWorker.addEventListener('message',handler);state.gaussianWorker.postMessage({type:'snapshot',maxSnapshot:CONFIG.gaussianSnapshot});});state.gaussians=snap||state.gaussians;}stopScan();if(state.currentSession)await state.db?.updateSession(state.currentSession.id,{status:'finished',counts:{keyframes:state.slam?.keyframes?.length||0,triangulated:state.mvsPointsTotal,gaussians:state.gaussians.length}});await showReview();}
async function showReview(){show('review');const {GaussianRenderer}=await lazy('./gaussian/renderer.js');if(!state.renderer)state.renderer=new GaussianRenderer($('viewer'));state.renderer.setData(state.gaussians);if($('reviewStats'))$('reviewStats').textContent=`Splat: ${state.gaussians.length} · triangolati ${state.mvsPointsTotal} · scala ${state.slam?.metricLocked?'metrica':'non confermata'} · keyframe ${state.slam?.keyframes?.length||0} · tracking ${state.lastTracking?.trackingMode||'n/d'}`;try{const mesh=await lazy('./metric/metric_mesh_ui.js');mesh.installMetricMeshUi?.();const m=await mesh.prepareReviewMesh?.();if(m)state.renderer.setMesh(m);}catch(err){log.warn('metric-mesh-ui',{message:err.message,stack:err.stack||null});}}
async function renderSessions(){if(!state.db)return;const xs=(await state.db.getAll('sessions')).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,8),el=$('savedSessions');if(!el)return;el.textContent='';if(!xs.length){el.innerHTML='<span class="muted">Nessuna sessione salvata.</span>';return;}for(const s of xs){const d=document.createElement('div');d.className='status';d.style.margin='.35rem 0';d.textContent=`${new Date(s.createdAt).toLocaleString()} · ${s.status||'sessione'} · KF ${s.counts?.keyframes||0} · GS ${s.counts?.gaussians||0}`;el.appendChild(d);}}
async function runTests(){const {runSelfTests}=await lazy('./self_test.js');const out=await runSelfTests(log),ok=out.filter(x=>x.ok).length;if($('selfTestSummary'))$('selfTestSummary').textContent=`Self-test: ${ok}/${out.length} PASS`;if($('diagLive'))$('diagLive').textContent=out.map(x=>`${x.ok?'PASS':'FAIL'} ${x.name}${x.ok?'':`: ${x.error}`}`).join('\n');if($('diagPanel'))$('diagPanel').open=true;}
async function clearCachesAndReload(){try{const regs=await navigator.serviceWorker?.getRegistrations?.()||[];for(const reg of regs){let own=false;try{own=new URL(reg.scope).pathname.includes('/room_scanner/v30/');}catch{}if(!own)continue;try{reg.active?.postMessage({type:'CLEAR_V30_CACHES'});await reg.unregister();}catch{}}if(window.caches)for(const k of await caches.keys())if(k.startsWith('room-scanner-v30')||k.startsWith('room-scanner-alvaar'))await caches.delete(k);try{sessionStorage.removeItem('roomscan-v30-sw-clean-attempt');}catch{}}catch(err){log.warn('force-update-cleanup',{message:err?.message||String(err)});}location.replace(`${location.pathname}?v30reset=${BUILD.version}-${Date.now()}`);}
async function loadPly(file){const {parsePly}=await lazy('./formats.js');state.gaussians=parsePly(await file.text());await showReview();}
async function loadR30(file){const {decodeR30}=await lazy('./formats.js');const x=await decodeR30(file);state.gaussians=x.gaussians||x.snapshot?.gaussians||[];await showReview();}
async function exportPly(){const {gaussiansToPly,downloadBlob}=await lazy('./formats.js');downloadBlob(new Blob([gaussiansToPly(state.gaussians,BUILD.id)],{type:'application/octet-stream'}),`roomscan-${Date.now()}.ply`);}
async function exportR30(){const {encodeR30,downloadBlob}=await lazy('./formats.js');downloadBlob(encodeR30({build:BUILD,calibration:calibration(),gaussians:state.gaussians}),`roomscan-${Date.now()}.r30`);}

function bind(){on('calibrateBtn','click',safe('begin-calibration',beginCalibration));on('clearCalibrationBtn','click',()=>{localStorage.removeItem(CONFIG.calibrationStorageKey);updateCalibrationUi();});on('calibAddPinBtn','click',safe('add-calibration-pin',addCalibrationPin));on('calibUndoPinBtn','click',()=>{state.calibrator?.undoLastTarget();updateProgress(state.calibrator?.quality());});on('calibFinishBtn','click',safe('finish-calibration',finishCalibration));on('calibCancelBtn','click',safe('cancel-calibration',cancelCalibration));on('startBtn','click',safe('begin-bridge',beginBridge));on('bridgeRetryBtn','click',safe('retry-bridge',beginBridge));on('bridgeCancelBtn','click',()=>{state.bridgeEpoch++;state.bridgeTransition=false;state.bridge?.stop();state.bridge=null;show('home');});on('finishBtn','click',safe('finish-scan',finishScan));on('backHomeBtn','click',()=>show('home'));on('resumeBtn','click',safe('resume-scan',beginBridge));on('fitBtn','click',()=>{state.renderer?.fit();state.renderer?.draw();});on('viewTopBtn','click',()=>state.renderer?.setPreset('top'));on('viewFrontBtn','click',()=>state.renderer?.setPreset('front'));on('viewSideBtn','click',()=>state.renderer?.setPreset('side'));on('arModeBtn','click',()=>{const mode=state.liveOverlay?.cycleMode()||'off';const b=$('arModeBtn');if(b)b.textContent=`AR: ${mode==='gs'?'GS':mode==='mesh'?'Mesh':mode==='both'?'GS+Mesh':'Off'}`;});on('splatSize','input',e=>state.renderer?.setSplatSize(e.target.value));on('loadPlyBtn','click',()=>$('filePly')?.click());on('filePly','change',safe('load-ply',async e=>{if(e.target.files?.[0])await loadPly(e.target.files[0]);e.target.value='';}));on('loadR30Btn','click',()=>$('fileR30')?.click());on('fileR30','change',safe('load-r30',async e=>{if(e.target.files?.[0])await loadR30(e.target.files[0]);e.target.value='';}));on('exportPlyBtn','click',safe('export-ply',exportPly));on('exportR30Btn','click',safe('export-r30',exportR30));on('exportDiagBtn','click',()=>log.download());on('diagDownloadBtn','click',()=>log.download());on('diagCopyBtn','click',()=>navigator.clipboard?.writeText(log.text()).catch(()=>{}));on('selfTestBtn','click',safe('self-test',runTests));on('forceUpdateBtn','click',safe('force-update',clearCachesAndReload));on('diagForceUpdateBtn','click',safe('force-update',clearCachesAndReload));on('pinBtn','click',()=>log.info('manual-scan-pin',{pose:state.slam?.pose||null}));log.addEventListener('entry',()=>{const live=$('diagLive');if(live&&$('diagPanel')?.open)live.textContent=log.entries.slice(-80).map(x=>`${new Date(x.at).toLocaleTimeString()} ${x.level.toUpperCase()} ${x.event} ${JSON.stringify(x.data)}`).join('\n');});}

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

async function initBackground(){setTimeout(()=>{void prefetchOfficialAlvaRuntime();},600);const dbJob=(async()=>{try{const {V30Database}=await lazy('./storage/db.js');state.db=await new V30Database().open();await renderSessions();log.info('db-ready',{});}catch(err){log.error('db-open',{message:err?.message||String(err)});const s=$('homeStatus');if(s&&s.dataset.kind!=='error')s.textContent='Interfaccia pronta · storage locale non disponibile.';}})();void dbJob;setTimeout(async()=>{try{if(!('serviceWorker'in navigator))return;await navigator.serviceWorker.register(`${CONFIG.serviceWorker}?v=${BUILD.version}`,{scope:'./'});await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(resolve,3500))]);log.info('service-worker-ready',{version:BUILD.version});}catch(err){log.warn('service-worker-register',{message:err?.message||String(err)});}},CONFIG.serviceWorkerRegisterDelayMs||2500);}

function boot(){bind();document.documentElement.dataset.v30Interactive='1';if(window.__ROOMSCAN_PREBOOT){window.__ROOMSCAN_PREBOOT.interactive=true;window.__ROOMSCAN_PREBOOT.interactiveAt=Date.now();}if($('buildBadge'))$('buildBadge').textContent=`V${BUILD.version}`;if($('buildFoot'))$('buildFoot').textContent=`${BUILD.id} · DB target v${BUILD.dbVersion}`;updateCalibrationUi();if($('homeStatus'))$('homeStatus').textContent='Interfaccia pronta.';log.info('ui-interactive',{build:BUILD.id});void initBackground();document.documentElement.dataset.v30Ready='1';}
boot();
