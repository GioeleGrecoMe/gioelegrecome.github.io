/**
 * Room Scanner V30.10.2 core application bootstrap.
 *
 * This file intentionally owns only orchestration. WebXR world anchors live in
 * xr_calibration.js; camera capture, SLAM, metric bridge, workers and rendering
 * stay in their dedicated modules so a failure can be diagnosed independently.
 */
import {BUILD,CONFIG} from './config.js';
import {DiagnosticsLog} from './logger.js';
import {CameraController} from './camera.js';
import {V30Database} from './storage/db.js';
import {runSelfTests} from './self_test.js';
import {XRMetricCalibrator} from './xr/xr_calibration.js';
import {MetricBridge} from './xr/metric_bridge.js';
import {WasmVisionFrontend} from './slam/wasm_frontend.js';
import {SlamEngine} from './slam/slam_engine.js';
import {GaussianRenderer} from './gaussian/renderer.js';
import {gaussiansToPly,parsePly,encodeR30,decodeR30,downloadBlob} from './formats.js';

const $=id=>document.getElementById(id);
const log=new DiagnosticsLog({build:BUILD});
const state={db:null,calibrator:null,bridge:null,bridgeStable:0,camera:null,frontend:null,slam:null,gaussianWorker:null,mvsWorker:null,gaussians:[],renderer:null,currentSession:null,scanStop:null};
window.RoomScanV30={BUILD,CONFIG,state,log};

function safe(name,fn){return async(...args)=>{try{return await fn(...args)}catch(err){log.error(name,{message:err?.message||String(err),stack:err?.stack||null});showError(err?.message||String(err));}}}
function show(id){for(const el of document.querySelectorAll('.screen'))el.classList.toggle('active',el.id===id);}
function showError(message){const s=$('homeStatus');if(s){s.dataset.kind='error';s.textContent=message;}const d=$('diagPanel');if(d)d.open=true;}
function calibration(){try{const x=JSON.parse(localStorage.getItem(CONFIG.calibrationStorageKey)||'null');return x?.calibration||x?.value||x;}catch{return null}}
function saveCalibration(c){localStorage.setItem(CONFIG.calibrationStorageKey,JSON.stringify({format:'ROOMSCAN-V30-CALIBRATION-PROFILE-1',savedAt:Date.now(),build:BUILD.id,calibration:c}));updateCalibrationUi();}
function updateCalibrationUi(){const c=calibration(),summary=$('calibSummary'),start=$('startBtn');if(!c){if(summary)summary.textContent='Calibrazione non presente.';if(start)start.disabled=true;return;}const n=c.objects?.length||new Set((c.anchors||[]).map(a=>a.objectId)).size,p=c.poseCoverage?.length||c.quality?.poseCount||0,real=(c.anchors||[]).filter(a=>a.realAnchor).length;if(summary)summary.textContent=`Calibrazione salvata: ${n} pin · ${real} anchor 3D · ${p} pose · ${c.cameraSize?.join('×')||'camera n/d'}.`;if(start)start.disabled=n<3||real<3;}
function updateProgress(q){if(!q)return;$('calibTargets').textContent=`${q.selected}/${q.target}`;$('calibReady').textContent=`${q.readyTargets}/${q.selected}`;$('calibCommon').textContent=q.commonView?'SI':'NO';$('calibPoints').textContent=String(q.totalPoints);$('calibSpan').textContent=`${q.span.toFixed(2)} m`;const denom=Math.max(1,q.target),progress=Math.min(1,(q.readyTargets/denom)*.55+(Math.min(q.poseCount,q.requiredPoseCount)/q.requiredPoseCount)*.25+(q.commonView?.2:0));$('calibBar').style.width=`${Math.round(progress*100)}%`;$('calibFinishBtn').disabled=!q.ready;}

async function beginCalibration(){if(state.camera)stopScan();show('calibration');const c=new XRMetricCalibrator({overlayRoot:$('calibration'),config:CONFIG,log});state.calibrator=c;window.__ROOMSCAN_ACTIVE_CALIBRATOR=c;c.addEventListener('progress',e=>updateProgress(e.detail));window.dispatchEvent(new CustomEvent('roomscan:xr-calibrator-ready',{detail:{calibrator:c}}));await c.start();updateProgress(c.quality());}
async function finishCalibration(){const c=state.calibrator;if(!c)return;const result=await c.finish();saveCalibration(result);state.calibrator=null;window.__ROOMSCAN_ACTIVE_CALIBRATOR=null;show('home');$('homeStatus').textContent='Calibrazione WebXR salvata. Ora puoi avviare la misura.';}
async function cancelCalibration(){if(state.calibrator)await state.calibrator.stop().catch(()=>{});state.calibrator=null;window.__ROOMSCAN_ACTIVE_CALIBRATOR=null;show('home');}

async function beginBridge(){const cal=calibration();if(!cal)throw new Error('Calibrazione assente');show('bridge');state.bridgeStable=0;state.bridge?.stop();state.bridge=new MetricBridge({video:$('bridgeCamera'),calibration:cal,log,analysisWidth:CONFIG.analysisWidth,analysisHeight:CONFIG.analysisHeight});state.bridge.addEventListener('update',safe('metric-bridge-update',async e=>{const r=e.detail;$('bridgeFound').textContent=String(r.found||0);$('bridgeInliers').textContent=String(r.inliers||0);$('bridgeRmse').textContent=r.rmse==null?'—':r.rmse.toFixed(4);if(r.locked)state.bridgeStable++;else state.bridgeStable=0;if(state.bridgeStable>=3)await startScan(r);}));await state.bridge.start();}
async function startScan(metric){state.bridge?.stop();state.bridge=null;show('scan');const cal=calibration(),K=metric?.intrinsicsNorm&&metric?.cameraSize?{fx:metric.intrinsicsNorm.fxN*CONFIG.analysisWidth,fy:metric.intrinsicsNorm.fyN*CONFIG.analysisHeight,cx:metric.intrinsicsNorm.cxN*CONFIG.analysisWidth,cy:metric.intrinsicsNorm.cyN*CONFIG.analysisHeight,width:CONFIG.analysisWidth,height:CONFIG.analysisHeight}:{fx:CONFIG.analysisWidth*.9,fy:CONFIG.analysisWidth*.9,cx:CONFIG.analysisWidth/2,cy:CONFIG.analysisHeight/2,width:CONFIG.analysisWidth,height:CONFIG.analysisHeight};
  state.frontend=new WasmVisionFrontend(CONFIG.wasmCore);await state.frontend.init();state.slam=new SlamEngine({frontend:state.frontend,K,log,keyframeIntervalMs:CONFIG.keyframeIntervalMs});if(metric?.locked)state.slam.setMetricScale(1);state.gaussianWorker=new Worker(CONFIG.gaussianWorker);state.gaussianWorker.onmessage=e=>{const d=e.data||{};if(d.type==='snapshot'&&Array.isArray(d.gaussians)){state.gaussians=d.gaussians;$('statGs').textContent=String(d.count??d.gaussians.length);}};state.gaussianWorker.postMessage({type:'init',config:{voxel:CONFIG.gaussianVoxelM,maxGaussians:CONFIG.gaussianMaxLive,maxSnapshot:CONFIG.gaussianSnapshot}});state.mvsWorker=new Worker(CONFIG.mvsWorker);state.mvsWorker.onmessage=e=>{if(e.data?.type==='ready')$('mvsState').textContent='MVS geometrico pronto';if(e.data?.type==='mvs-result'){$('statTri').textContent=String(e.data.count||0);if(e.data.points?.length)state.gaussianWorker?.postMessage({type:'add',points:e.data.points});}};state.mvsWorker.postMessage({type:'init',config:{near:CONFIG.mvsNearM,far:CONFIG.mvsFarM,depthSteps:CONFIG.mvsDepthSteps,gridStep:CONFIG.mvsGridStep,maxPoints:CONFIG.mvsMaxPoints}});
  state.camera=new CameraController({video:$('camera'),width:CONFIG.analysisWidth,height:CONFIG.analysisHeight,fps:CONFIG.analysisFps,log});await state.camera.start();state.currentSession=await state.db?.createSession({calibrationBuild:cal?.createdAt||null,metricLocked:!!metric?.locked});$('metricState').textContent=metric?.locked?'scala METRIC · common-view lock':'scala — NON AGGANCIATA';$('slamState').textContent='TRACKING';state.scanStop=state.camera.loop(frame=>{try{const r=state.slam.process(frame);$('statFeat').textContent=String(r.features);$('statMatch').textContent=String(r.matches);$('statKf').textContent=String(r.keyframes);$('statLandmarks').textContent=String(0);if(state.currentSession&&r.keyframes%5===0)state.db?.updateSession(state.currentSession.id,{status:'scanning',counts:{keyframes:r.keyframes,gaussians:state.gaussians.length}}).catch(()=>{});}catch(err){log.warn('scan-frame',{message:err.message});}});}
function stopScan(){state.scanStop?.();state.scanStop=null;state.camera?.stop();state.camera=null;state.gaussianWorker?.terminate();state.gaussianWorker=null;state.mvsWorker?.terminate();state.mvsWorker=null;}
async function finishScan(){if(state.gaussianWorker){const snap=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(state.gaussians),600),handler=e=>{if(e.data?.type==='snapshot'){clearTimeout(timer);state.gaussianWorker.removeEventListener('message',handler);resolve(e.data.gaussians||state.gaussians);}};state.gaussianWorker.addEventListener('message',handler);state.gaussianWorker.postMessage({type:'snapshot',maxSnapshot:CONFIG.gaussianSnapshot});});state.gaussians=snap||state.gaussians;}stopScan();if(state.currentSession)await state.db?.updateSession(state.currentSession.id,{status:'finished',counts:{keyframes:state.slam?.keyframes?.length||0,gaussians:state.gaussians.length}});showReview();}
function showReview(){show('review');if(!state.renderer)state.renderer=new GaussianRenderer($('viewer'));state.renderer.setData(state.gaussians);$('reviewStats').textContent=`Gaussian: ${state.gaussians.length} · scala ${state.slam?.metricLocked?'metrica':'non confermata'} · keyframe ${state.slam?.keyframes?.length||0}`;}

async function renderSessions(){if(!state.db)return;const xs=(await state.db.getAll('sessions')).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,8),el=$('savedSessions');if(!el)return;el.textContent='';if(!xs.length){el.innerHTML='<span class="muted">Nessuna sessione salvata.</span>';return;}for(const s of xs){const d=document.createElement('div');d.className='status';d.style.margin='.35rem 0';d.textContent=`${new Date(s.createdAt).toLocaleString()} · ${s.status||'sessione'} · KF ${s.counts?.keyframes||0} · GS ${s.counts?.gaussians||0}`;el.appendChild(d);}}
async function runTests(){const out=await runSelfTests(log),ok=out.filter(x=>x.ok).length;$('selfTestSummary').textContent=`Self-test: ${ok}/${out.length} PASS`;$('diagLive').textContent=out.map(x=>`${x.ok?'PASS':'FAIL'} ${x.name}${x.ok?'':`: ${x.error}`}`).join('\n');$('diagPanel').open=true;}
async function clearCachesAndReload(){
  try{
    const regs=await navigator.serviceWorker?.getRegistrations?.()||[];
    for(const reg of regs){try{reg.active?.postMessage({type:'CLEAR_V30_CACHES'});await reg.unregister();}catch{}}
    for(const k of await caches.keys())if(k.startsWith('room-scanner-v30'))await caches.delete(k);
  }catch(err){log.warn('force-update-cleanup',{message:err?.message||String(err)});}
  location.replace(`${location.pathname}?v30reset=${Date.now()}`);
}
async function loadPly(file){const text=await file.text();state.gaussians=parsePly(text);showReview();}
async function loadR30(file){const x=await decodeR30(file);state.gaussians=x.gaussians||x.snapshot?.gaussians||[];showReview();}

function bind(){
  const on=(id,type,handler,options)=>{
    const el=$(id);
    if(!el){log.warn('ui-missing-control',{id,type});return null;}
    el.addEventListener(type,handler,options);return el;
  };
  on('calibrateBtn','click',safe('begin-calibration',beginCalibration));
  on('clearCalibrationBtn','click',()=>{localStorage.removeItem(CONFIG.calibrationStorageKey);updateCalibrationUi();});
  on('calibUndoPinBtn','click',()=>state.calibrator?.undoLastTarget());
  on('calibFinishBtn','click',safe('finish-calibration',finishCalibration));
  on('calibCancelBtn','click',safe('cancel-calibration',cancelCalibration));
  on('startBtn','click',safe('begin-bridge',beginBridge));
  on('bridgeRetryBtn','click',safe('retry-bridge',beginBridge));
  on('bridgeCancelBtn','click',()=>{state.bridge?.stop();state.bridge=null;show('home')});
  on('finishBtn','click',safe('finish-scan',finishScan));
  on('backHomeBtn','click',()=>show('home'));
  on('resumeBtn','click',safe('resume-scan',beginBridge));
  on('fitBtn','click',()=>{state.renderer?.fit();state.renderer?.draw()});
  on('splatSize','input',e=>state.renderer?.setSplatSize(e.target.value));
  on('loadPlyBtn','click',()=>$('filePly')?.click());
  on('filePly','change',safe('load-ply',async e=>{if(e.target.files?.[0])await loadPly(e.target.files[0]);e.target.value=''}));
  on('loadR30Btn','click',()=>$('fileR30')?.click());
  on('fileR30','change',safe('load-r30',async e=>{if(e.target.files?.[0])await loadR30(e.target.files[0]);e.target.value=''}));
  on('exportPlyBtn','click',()=>downloadBlob(new Blob([gaussiansToPly(state.gaussians,BUILD.id)],{type:'application/octet-stream'}),`roomscan-${Date.now()}.ply`));
  on('exportR30Btn','click',()=>downloadBlob(encodeR30({build:BUILD,calibration:calibration(),gaussians:state.gaussians}),`roomscan-${Date.now()}.r30`));
  on('exportDiagBtn','click',()=>log.download());
  on('diagDownloadBtn','click',()=>log.download());
  on('diagCopyBtn','click',()=>navigator.clipboard?.writeText(log.text()).catch(()=>{}));
  on('selfTestBtn','click',safe('self-test',runTests));
  on('forceUpdateBtn','click',safe('force-update',clearCachesAndReload));
  on('diagForceUpdateBtn','click',safe('force-update',clearCachesAndReload));
  on('pinBtn','click',()=>log.info('manual-scan-pin',{pose:state.slam?.pose||null,note:'diagnostic scan repere only; calibration pins remain XRAnchor-backed'}));
  log.addEventListener('entry',()=>{const live=$('diagLive');if(live&&$('diagPanel')?.open)live.textContent=log.entries.slice(-80).map(x=>`${new Date(x.at).toLocaleTimeString()} ${x.level.toUpperCase()} ${x.event} ${JSON.stringify(x.data)}`).join('\n');});
}

async function boot(){
  // UI FIRST: no storage/service-worker/network await is allowed before this.
  bind();
  document.documentElement.dataset.v30Interactive='1';
  if(window.__ROOMSCAN_PREBOOT){window.__ROOMSCAN_PREBOOT.interactive=true;window.__ROOMSCAN_PREBOOT.interactiveAt=Date.now();}
  $('buildBadge').textContent=`V${BUILD.version}`;
  $('buildFoot').textContent=`${BUILD.id} · DB target v${BUILD.dbVersion}`;
  updateCalibrationUi();
  $('homeStatus').textContent='Interfaccia pronta · inizializzazione storage…';
  log.info('ui-interactive',{build:BUILD.id});
  try{state.db=await new V30Database().open();await renderSessions();}
  catch(err){log.error('db-open',{message:err.message});showError(`Database: ${err.message}`);}
  try{if('serviceWorker'in navigator)await Promise.race([
    navigator.serviceWorker.register(CONFIG.serviceWorker,{scope:'./'}),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('service-worker registration timeout')),3500))
  ]);}catch(err){log.warn('service-worker-register',{message:err.message});}
  $('homeStatus').textContent='Runtime pronto.';
  document.documentElement.dataset.v30Ready='1';
  if(window.__ROOMSCAN_PREBOOT){window.__ROOMSCAN_PREBOOT.ready=true;window.__ROOMSCAN_PREBOOT.readyAt=Date.now();}
  log.info('runtime-ready',{build:BUILD.id});
}

await boot();
