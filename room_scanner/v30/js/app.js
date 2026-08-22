/**
 * Room Scanner V30.52.0 adaptive Deep + Alva continuity processing.
 *
 * BOOT CONTRACT
 * -------------
 * Only config + logger are static imports. UI handlers are bound immediately.
 * Storage, WebXR, camera, SLAM, diagnostics and metric extensions are imported
 * lazily after the page is already interactive. A failure in an optional module
 * therefore cannot leave the visible page with dead buttons.
 */
import {BUILD,CONFIG} from './config.js?v=30.52.0';
import {DeepLateBindingQueue} from './dense/deep_late_binding_queue.js?v=30.52.0';
import {DiagnosticsLog} from './logger.js?v=30.52.0';
import {filterSurfaceSplatsForDisplay} from './reconstruction/surface_display_policy.js?v=30.52.0';
import {StablePhotoBank,quatAngle,gradientDetail} from './reconstruction/stable_photo_bank.js?v=30.52.0';
import {AdaptiveDeepScheduler,selectGeometricPhotoSubset} from './reconstruction/adaptive_deep_scheduler.js?v=30.52.0';
import {buildPipelineTestSnapshot} from './reconstruction/pipeline_diagnostics.js?v=30.52.0';

const $=id=>document.getElementById(id);
const log=new DiagnosticsLog({build:BUILD});
const state={db:null,calibrator:null,bridge:null,bridgeStable:0,bridgeEpoch:0,bridgeTransition:false,alvaBootstrap:null,camera:null,frontend:null,slam:null,denseManager:null,denseDepthWorker:null,denseFusionWorker:null,deepDepthWorker:null,deepWorkerModelId:null,deepSelector:null,deepPending:null,deepModel:null,deepDisabled:false,deepCalls:0,deepAccepted:0,deepPreviewLastAt:0,deepPlanLastAt:0,photoSurveyLastAt:0,photoDepthCommittedFrameIds:new Set(),deepPreviewInFlight:null,deepPreviewSeq:0,deepPreviewFrames:0,deepPreviewLastQuality:null,deepSync:null,deepJobs:new Map(),deepSyncRejected:0,deepLateQueue:new DeepLateBindingQueue({maxItems:CONFIG.deepLateQueueMaxItems||20}),deepDrainActive:false,deepLaneInFlight:null,deepLaneQueuedFrames:new Set(),photoPlannedFrameIds:new Set(),photoArchiveWorker:null,photoArchivePending:0,photoArchivePendingMeta:new Map(),photoArchiveSeq:0,photoArchiveAccepted:0,photoArchiveRejected:0,photoArchiveBytes:0,photoArchiveEntries:[],photoArchiveMemoryFallback:[],photoArchiveLastAt:0,photoArchivePrevPose:null,photoArchiveStorageError:false,photoPreprocessWorker:null,photoPreprocessPending:new Map(),photoPreprocessSeq:0,photoResizeCacheHits:0,photoResizeCacheMisses:0,processingPhotos:[],processingPoseList:[],processingOptimizedPoseMap:new Map(),processingPreview:{deep:null,photo:null,index:0,total:0,phase:null},processingActive:false,processingAbort:false,processingPoseJumps:0,processingDeepAccepted:0,processingRgbImported:0,processingDeepRounds:0,processingDeepProcessedIds:new Set(),processingUncertainty:null,processingUncertaintyHistory:[],pipelineTestSnapshot:null,pipelineTestUpdatedAt:0,deepBatchProtocol:null,alvaFeatureTracks:[],alvaFeatureTrackSeq:0,alvaPersistentFeatures:0,alvaNewFeatures:0,alvaRecoveryRequired:false,alvaRecoveryReason:null,alvaRecoveryStableFrames:0,alvaLastTrustedPose:null,alvaLastTrustedAt:0,alvaQuarantinedFrameIds:new Set(),alvaRelocalizer:null,alvaRelocalizerApi:null,alvaRelocalization:null,stablePhotoBank:new StablePhotoBank({maxFrames:CONFIG.stablePhotoMaxFrames||240,maxBytes:CONFIG.stablePhotoMaxBytes||100663296,minIntervalMs:CONFIG.stablePhotoMinIntervalMs||420,maxSide:CONFIG.stablePhotoMaxSide||336,maxTranslationSpeedMetric:CONFIG.stablePhotoMaxTranslationSpeedMetric||.28,maxTranslationSpeedAlva:CONFIG.stablePhotoMaxTranslationSpeedAlva||.42,maxAngularSpeedRad:CONFIG.stablePhotoMaxAngularSpeedRad||.55,minDetail:CONFIG.stablePhotoMinDetail||4,jumpTranslation:CONFIG.stablePhotoJumpTranslation||.65,jumpRotationRad:CONFIG.stablePhotoJumpRotationRad||.70,jumpWindowMs:CONFIG.stablePhotoJumpWindowMs||2200}),stablePhotoProcessingIndex:0,stablePhotoProcessingPhase:null,stablePhotoProcessingDeepDone:0,stablePhotoProcessingMvsDone:0,stablePhotoProcessingStartedAt:0,fastLaneFrames:0,fastLaneLastAt:0,fastLaneLastGapMs:0,fastLaneMaxGapMs:0,sparseBusy:false,sparseJobs:0,sparseLastAt:0,postScanMvsPayloads:[],postScanMvsReplaced:0,postScanMvsDropped:0,postScanMvsRefreshed:0,postScanMvsRefreshFailed:0,postScanMvsDrainActive:false,postScanRgbScaffold:null,evidenceSourceBuild:null,denseEvidenceStatus:null,denseBusy:false,denseActivePayload:null,denseJobs:0,denseDepthSamples:0,denseDepthHint:null,densePixelStep:null,denseSourceLimit:null,surfaceStats:null,surfaceDisplayStats:null,mesh:null,meshStale:false,geometryCommitted:false,gaussians:[],denseCandidateGaussians:[],denseCandidateMesh:null,optimizerObservations:null,probGraph:null,deepSequence:null,probOptimization:null,probOptimized:null,optimization:{iterations:0,lastEnergy:null},postOptBusy:false,postOptRunBase:0,reviewMetricLocked:null,reviewKeyframes:0,renderer:null,currentSession:null,scanStop:null,liveOverlay:null,scanK:null,lastFrameGeometry:null,lastTracking:null,geometryAnchors:[],alvaHeartbeatFrames:[],alvaHeartbeatCount:0,coverageSphere:null,coverageApi:null,coverageStatus:null,liveMap:null,liveMapApi:null,liveMapMode:'photo',liveMapStats:null,liveMapRenderPending:false,photoPanoramaState:null,frameQualityApi:null,singleOptRuntime:null,singleOptModule:null,liveOptReady:false,liveOptInFlight:false,liveOptDirty:false,liveOptPendingSlow:false,liveOptTimer:null,liveOptGeneration:0,liveOptAccepted:null,liveOptStats:null,liveOptCandidateStats:null,liveOptWorkingSnapshot:null,liveOptWorkingRetained:false,liveOptStalled:false,liveOptGate:null,liveOptLastAt:0,liveOptLastReason:null,liveOptAcceptedAnchors:[],liveOptPreviewGaussians:[],liveOptPreviewStats:null,liveOptRejected:0,liveOptAcceptedCount:0,liveOptBackoff:1,liveOptLastElapsedMs:0,postOptRejectedRun:0};
// Keep this explicit for sessions created before the archive backpressure
// counter existed in the state literal.
state.photoArchiveBackpressureDropped??=0;
window.RoomScanV30={BUILD,CONFIG,state,log};
log.setContextProvider(()=>({screen:document.querySelector('.screen.active')?.id||null,tracking:{mode:state.lastTracking?.trackingMode||null,valid:!!state.lastTracking?.trackingValid,frameId:state.lastTracking?.frameId||null,recoveryRequired:state.alvaRecoveryRequired,recoveryReason:state.alvaRecoveryReason,persistentFeatures:state.alvaPersistentFeatures,newFeatures:state.alvaNewFeatures,quarantinedFrames:state.alvaQuarantinedFrameIds?.size||0},graph:state.probGraph?.summary?.()||null,liveMap:state.liveMap?.stats?.()||state.liveMapStats||null,liveOptimizer:{mode:'single-hierarchical-probabilistic-joint',implementation:'ProbabilisticJointOptimizer',execution:'main-thread-timesliced',legacyFallback:false,ready:state.liveOptReady,inFlight:state.liveOptInFlight,generation:state.liveOptGeneration,accepted:state.liveOptAcceptedCount,rejected:state.liveOptRejected,lastReason:state.liveOptLastReason,stats:state.liveOptStats,candidateStats:state.liveOptCandidateStats,workingRetained:state.liveOptWorkingRetained,stalled:state.liveOptStalled,gate:state.liveOptGate},deep:{calls:state.deepCalls,accepted:state.deepAccepted,syncRejected:state.deepSyncRejected,pending:state.deepJobs?.size||0,lateQueue:state.deepLateQueue?.stats?.()||null,drainActive:state.deepDrainActive,plannedPhotos:state.photoPlannedFrameIds?.size||0,depthBoundPhotos:state.photoDepthCommittedFrameIds?.size||0},photoArchive:{accepted:state.photoArchiveAccepted,rejected:state.photoArchiveRejected,backpressureDropped:state.photoArchiveBackpressureDropped,pending:state.photoArchivePending,bytes:state.photoArchiveBytes,entries:state.photoArchiveEntries?.length||0,storageError:state.photoArchiveStorageError},processing:{active:state.processingActive,photos:state.processingPhotos?.length||0,rgbImported:state.processingRgbImported,deepAccepted:state.processingDeepAccepted,deepRounds:state.processingDeepRounds,poseJumps:state.processingPoseJumps,uncertainty:state.processingUncertainty?.globalUncertainty??null,resizeCacheHits:state.photoResizeCacheHits,resizeCacheMisses:state.photoResizeCacheMisses},stablePhotos:{...(state.stablePhotoBank?.stats?.()||{}),processingPhase:state.stablePhotoProcessingPhase,processingIndex:state.stablePhotoProcessingIndex,deepDone:state.stablePhotoProcessingDeepDone,mvsDone:state.stablePhotoProcessingMvsDone},fastLane:{frames:state.fastLaneFrames,lastGapMs:state.fastLaneLastGapMs,maxGapMs:state.fastLaneMaxGapMs,deepInferenceDuringScan:!!state.deepLaneInFlight},dense:{busy:state.denseBusy,jobs:state.denseJobs,samples:state.denseDepthSamples,sparseBusy:state.sparseBusy,sparseJobs:state.sparseJobs,postScanQueued:state.postScanMvsPayloads?.length||0,postScanReplaced:state.postScanMvsReplaced,postScanDropped:state.postScanMvsDropped,postScanRefreshed:state.postScanMvsRefreshed,postScanRefreshFailed:state.postScanMvsRefreshFailed,postScanDrainActive:state.postScanMvsDrainActive,rgbScaffold:state.postScanRgbScaffold,evidenceSourceBuild:state.evidenceSourceBuild||null,evidenceStatus:state.denseEvidenceStatus||null},surface:(state.surfaceStats||state.surfaceDisplayStats)?{...(state.surfaceStats||{}),display:state.surfaceDisplayStats||null}:null}));
globalThis.addEventListener?.('error',e=>{log.error('runtime-window-error',{message:e?.message||String(e?.error||'window error'),filename:e?.filename||null,line:e?.lineno||null,column:e?.colno||null,stack:e?.error?.stack||null});log.checkpoint('window-error',{message:e?.message||null,graph:state.probGraph?.summary?.()||null,liveOptimizer:state.liveOptStats||null});persistEmergencyDiagnostics('window-error');});
globalThis.addEventListener?.('unhandledrejection',e=>{const r=e?.reason;log.error('runtime-unhandled-rejection',{message:r?.message||String(r),stack:r?.stack||null});log.checkpoint('unhandled-rejection',{message:r?.message||String(r),graph:state.probGraph?.summary?.()||null,liveOptimizer:state.liveOptStats||null});persistEmergencyDiagnostics('unhandled-rejection');});
globalThis.addEventListener?.('pagehide',()=>persistEmergencyDiagnostics('pagehide'));
document.addEventListener?.('visibilitychange',()=>{log.debug('runtime-visibility',{state:document.visibilityState});if(document.visibilityState==='hidden')persistEmergencyDiagnostics('hidden');});
const EMERGENCY_DIAG_KEY='roomscan-v30-emergency-diagnostics-2';
function persistEmergencyDiagnostics(reason){try{const snapshot=log.snapshot({emergency:true,reason,entries:log.entries.slice(-1200),checkpoints:log.checkpoints.slice(-80)});localStorage.setItem(EMERGENCY_DIAG_KEY,JSON.stringify(snapshot));}catch{}}
function restoreEmergencyDiagnostics(){try{const raw=localStorage.getItem(EMERGENCY_DIAG_KEY);if(!raw)return;const previous=JSON.parse(raw);log.attachPrevious(previous);log.warn('previous-emergency-diagnostics',{reason:previous?.reason||null,createdAt:previous?.createdAt||null,entries:previous?.entries?.length||0,checkpoints:previous?.checkpoints?.length||0,build:previous?.build?.id||previous?.build||null});localStorage.removeItem(EMERGENCY_DIAG_KEY);}catch{}}
restoreEmergencyDiagnostics();
const moduleCache=new Map();
const CRITICAL_MODULE_CLOSURES={
  './probabilistic/single_optimizer_runtime.js':[
    './probabilistic/single_optimizer_runtime.js',
    './probabilistic/joint_optimizer.js',
    './probabilistic/live_optimization_gate.js',
    './probabilistic/pose_uncertainty.js',
    './probabilistic/switchable_edges.js',
    './probabilistic/depth_calibration_hierarchy.js',
    './probabilistic/depth_observability.js',
    './probabilistic/cross_depth_consistency.js',
    './probabilistic/alva_switchable_edges.js',
    './probabilistic/reliability_feedback.js',
    './probabilistic/residual_cause_model.js',
    './probabilistic/submap_pose_graph.js',
    './reconstruction/submap_fusion.js',
    './dense/fusion_core.js',
    './slam/math.js'
  ]
};
async function probeCriticalModuleClosure(path){
  const paths=CRITICAL_MODULE_CLOSURES[path];if(!paths)return null;
  const rows=[];
  for(const p of paths){
    try{
      const u=new URL(`${p}?v=${BUILD.version}&closureProbe=${Date.now()}`,import.meta.url);
      const r=await fetch(u,{cache:'no-store',credentials:'same-origin'});
      const text=r.ok?await r.clone().text():'';
      rows.push({path:p,status:r.status,ok:r.ok,contentType:r.headers.get('content-type')||'',bytes:text.length,tagged:p.endsWith('single_optimizer_runtime.js')?text.includes(`v=${BUILD.version}`):null});
    }catch(err){rows.push({path:p,status:null,ok:false,message:err?.message||String(err)});}
  }
  log.error('critical-module-closure-probe',{root:path,build:BUILD.version,assets:rows,failed:rows.filter(x=>!x.ok).map(x=>x.path)});
  return rows;
}
async function importWithDiagnostics(path){
  const spec=`${path}?v=${BUILD.version}`;
  try{return await import(spec);}catch(firstError){
    let probe=null;
    try{
      const url=new URL(`${path}?v=${BUILD.version}&probe=${Date.now()}`,import.meta.url);
      const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
      probe={url:url.href,status:response.status,ok:response.ok,contentType:response.headers.get('content-type')||'',serviceWorker:!!navigator.serviceWorker?.controller,online:navigator.onLine};
      log.error('dynamic-module-import-failed',{path,spec,message:firstError?.message||String(firstError),name:firstError?.name||null,probe});
      await probeCriticalModuleClosure(path);
      // A successfully published JavaScript module may still fail because an old
      // service worker/module-map entry supplied a stale transitive dependency.
      // Retry once with a unique top-level URL; build-tagged static dependencies
      // on critical modules keep the transitive closure coherent as well.
      if(response.ok&&/javascript|ecmascript|module/i.test(probe.contentType)){
        const retry=`${path}?v=${BUILD.version}&retry=${Date.now()}`;
        try{return await import(retry);}catch(retryError){
          log.error('dynamic-module-import-retry-failed',{path,retry,message:retryError?.message||String(retryError),name:retryError?.name||null,probe});
          throw retryError;
        }
      }
    }catch(probeError){
      log.error('dynamic-module-probe-failed',{path,spec,message:firstError?.message||String(firstError),probeMessage:probeError?.message||String(probeError),online:navigator.onLine,serviceWorker:!!navigator.serviceWorker?.controller});
    }
    throw firstError;
  }
}
function lazy(path){
  if(!moduleCache.has(path)){
    const pending=importWithDiagnostics(path).catch(err=>{moduleCache.delete(path);throw err;});
    moduleCache.set(path,pending);
  }
  return moduleCache.get(path);
}
function safe(name,fn){return async(...args)=>{try{return await fn(...args)}catch(err){log.error(name,{message:err?.message||String(err),stack:err?.stack||null});log.checkpoint('handled-operation-error',{reason:name,message:err?.message||String(err),graph:state.probGraph?.summary?.()||null,liveOptimizer:state.liveOptStats||null});persistEmergencyDiagnostics(`handled:${name}`);showError(err?.message||String(err));return null;}};}
function on(id,type,handler,options){const el=$(id);if(!el){log.warn('ui-missing-control',{id,type});return null;}el.addEventListener(type,handler,options);return el;}
function show(id){for(const el of document.querySelectorAll('.screen'))el.classList.toggle('active',el.id===id);document.body.classList.toggle('immersive-ui',id!=='home'&&id!=='review'&&id!=='processing');}
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
function bindDeepRuntimeWorker(worker){
  if(!worker)return null;
  worker.onmessage=e=>void handleDeepDepthMessage(e.data||{});
  worker.onerror=e=>{state.deepDisabled=true;state.deepSelector?.fail?.();const inFlight=state.deepLaneInFlight;if(inFlight)finishDeepLaneJob(inFlight,{failed:true});state.deepJobs.clear();state.deepLaneInFlight=null;log.warn('deep-depth-worker',{message:e.message||'worker error',fastLaneUnaffected:true,queue:state.deepLateQueue?.stats?.()||null});if($('mvsState'))$('mvsState').textContent='AI depth non disponibile · Alva/RGB/MVS continuano';if($('deepLiveState'))$('deepLiveState').textContent='DEEP POST · worker non disponibile';};
  return worker;
}
function ensureDeepRuntimeWorker(){return bindDeepRuntimeWorker(ensureDeepWorker());}
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
  // V30.48.0: only ProbabilisticJointOptimizer is operational; RGB/Alva own the scan clock and dense work is post-scan.
  // Only the single ProbabilisticJointOptimizer may own optimisation state.
  // Stop an already-running instance before starting/resuming acquisition.
  if(state.postOptBusy||state.liveOptInFlight)stopPostOptimizer();
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
  const [{CameraController,intrinsicsForCrop},{SlamEngine},{LiveReconstructionOverlay},{DenseKeyframeManager},{DeepKeyframeSelector},deepSync,coverageApi,liveMapApi,relocalizerApi]=await Promise.all([
    lazy('./camera.js'),lazy('./slam/slam_engine.js'),lazy('./gaussian/ar_overlay.js'),lazy('./dense/keyframe_manager.js'),lazy('./dense/deep_keyframe_selector.js'),lazy('./dense/deep_frame_sync.js'),lazy('./reconstruction/coverage_sphere.js'),lazy('./reconstruction/live_photo_puzzle.js'),lazy('./reconstruction/alva_reference_relocalizer.js')
  ]);
  state.deepSync=deepSync;state.coverageApi=coverageApi;state.liveMapApi=liveMapApi;state.alvaRelocalizerApi=relocalizerApi;
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
  stopPostOptimizer();state.gaussians=[];state.denseCandidateGaussians=[];state.denseCandidateMesh=null;state.mesh=null;state.meshStale=false;state.geometryCommitted=false;state.optimizerObservations=null;state.probOptimization=null;state.probOptimized=null;state.optimization={iterations:0,lastEnergy:null};state.reviewMetricLocked=null;state.reviewKeyframes=0;window.__ROOMSCAN_METRIC_MESH=null;state.alvaHeartbeatFrames=[];state.alvaHeartbeatCount=0;state.denseBusy=false;state.denseActivePayload=null;state.denseJobs=0;state.denseDepthSamples=0;state.denseDepthHint=null;state.densePixelStep=CONFIG.densePixelStep||4;state.denseSourceLimit=Math.min(CONFIG.denseInitialSourceLimit||2,CONFIG.denseMaxSourceViews||4);state.surfaceStats=null;state.surfaceDisplayStats=null;state.geometryAnchors=[];state.deepPending=null;state.deepDisabled=false;state.deepCalls=0;state.deepAccepted=0;state.deepRaySamples=0;state.deepPreviewLastAt=0;state.deepPlanLastAt=0;state.photoSurveyLastAt=0;state.photoDepthCommittedFrameIds?.clear?.();state.deepPreviewInFlight=null;state.deepPreviewSeq=0;state.deepPreviewFrames=0;state.deepPreviewLastQuality=null;state.deepJobs.clear();state.deepSyncRejected=0;state.deepLateQueue?.reset?.();state.deepDrainActive=false;state.deepLaneInFlight=null;state.deepLaneQueuedFrames?.clear?.();state.photoPlannedFrameIds?.clear?.();state.photoArchiveWorker?.terminate?.();state.photoArchiveWorker=null;state.photoArchivePending=0;state.photoArchivePendingMeta?.clear?.();state.photoArchiveSeq=0;state.photoArchiveAccepted=0;state.photoArchiveRejected=0;state.photoArchiveBackpressureDropped=0;state.photoArchiveBytes=0;state.photoArchiveEntries=[];state.photoArchiveMemoryFallback=[];state.photoArchiveLastAt=0;state.photoArchivePrevPose=null;state.photoArchiveStorageError=false;state.processingPhotos=[];state.processingPoseList=[];state.processingOptimizedPoseMap?.clear?.();state.processingActive=false;state.processingAbort=false;state.processingPoseJumps=0;state.processingDeepAccepted=0;state.processingRgbImported=0;state.processingDeepRounds=0;state.processingDeepProcessedIds?.clear?.();state.processingUncertainty=null;state.processingUncertaintyHistory=[];state.photoResizeCacheHits=0;state.photoResizeCacheMisses=0;state.alvaFeatureTracks=[];state.alvaFeatureTrackSeq=0;state.alvaPersistentFeatures=0;state.alvaNewFeatures=0;state.alvaRecoveryRequired=false;state.alvaRecoveryReason=null;state.alvaRecoveryStableFrames=0;state.alvaLastTrustedPose=null;state.alvaLastTrustedAt=0;state.alvaQuarantinedFrameIds?.clear?.();state.stablePhotoBank?.reset?.();state.stablePhotoProcessingIndex=0;state.stablePhotoProcessingPhase=null;state.stablePhotoProcessingDeepDone=0;state.stablePhotoProcessingMvsDone=0;state.stablePhotoProcessingStartedAt=0;state.fastLaneFrames=0;state.fastLaneLastAt=0;state.fastLaneLastGapMs=0;state.fastLaneMaxGapMs=0;state.sparseBusy=false;state.sparseJobs=0;state.sparseLastAt=0;state.postScanMvsPayloads=[];state.postScanMvsReplaced=0;state.postScanMvsDropped=0;state.postScanMvsRefreshed=0;state.postScanMvsRefreshFailed=0;state.postScanMvsDrainActive=false;state.postScanRgbScaffold=null;state.evidenceSourceBuild=BUILD.id;state.denseEvidenceStatus=null;state.coverageSphere=new coverageApi.ViewSphereCoverage({cols:CONFIG.coverageSphereCols||24,rows:CONFIG.coverageSphereRows||12,maxFrames:CONFIG.coverageSphereMaxFrames||72});state.coverageStatus=state.coverageSphere.status();coverageApi.drawCoverageSphere($('coverageSphere'),state.coverageStatus);if($('coverageState'))$('coverageState').textContent='SFERA 0% · nessuna chiusura';state.liveMap=new liveMapApi.LivePhotoPuzzleMap({width:CONFIG.livePuzzleAtlasWidth||640,height:CONFIG.livePuzzleAtlasHeight||320,maxFrames:CONFIG.livePuzzleMaxFrames||90,maxRenderFrames:CONFIG.livePuzzleRenderFrames||64,temporalRadius:CONFIG.livePuzzleTemporalRadius||4,maxLoopCandidates:CONFIG.livePuzzleLoopCandidates||2,minEdgeMatches:CONFIG.livePuzzleMinEdgeMatches||6,minEdgeProbability:CONFIG.livePuzzleMinEdgeProbability||.10,maxWorldSamples:CONFIG.livePuzzleWorldSamples||12000,photoMaxSide:CONFIG.livePuzzlePhotoMaxSide||256,depthMaxSide:CONFIG.livePuzzleDepthMaxSide||168,depthMinPairs:CONFIG.livePuzzleDepthMinPairs||6,depthRegularizeIterations:CONFIG.livePuzzleDepthRegularizeIterations||8,maxPhotoSamples:CONFIG.livePuzzleMaxPhotoSamples||260000,maxDepthSamples:CONFIG.livePuzzleMaxDepthSamples||190000});log.info('live-map-depth-planned-api',{addDepthPlannedFrame:typeof state.liveMap?.addDepthPlannedFrame==='function',addCameraFrame:typeof state.liveMap?.addCameraFrame==='function',addFrame:typeof state.liveMap?.addFrame==='function',updateRelativeDepth:typeof state.liveMap?.updateRelativeDepth==='function',commitExact:typeof state.liveMap?.commitCameraFrameWithRelativeDepth==='function'});state.liveMapMode='photo';state.photoPanoramaState=null;state.liveMapStats=state.liveMap.stats();state.liveMapRenderPending=false;updateLiveMapUi();scheduleLiveMapRender();stopLiveOptimizer();state.liveOptAccepted=null;state.liveOptStats=null;state.liveOptCandidateStats=null;state.liveOptWorkingSnapshot=null;state.liveOptWorkingRetained=false;state.liveOptStalled=false;state.liveOptGate=null;state.liveOptPendingSlow=false;state.liveOptGeneration=0;state.liveOptRejected=0;state.liveOptAcceptedCount=0;state.liveOptBackoff=1;state.liveOptLastElapsedMs=0;state.postOptRejectedRun=0;state.liveOptAcceptedAnchors=[];state.liveOptPreviewGaussians=[];state.liveOptPreviewStats=null;state.liveOptLastAt=0;state.liveOptLastReason=null;
  state.frameQualityApi=await lazy('./probabilistic/frame_quality.js');
  if(CONFIG.probabilisticGraphEnabled!==false){
    const [{ProbabilisticFactorGraph},{DeepSequenceModel}]=await Promise.all([lazy('./probabilistic/factor_graph.js'),lazy('./probabilistic/deep_sequence_model.js')]);
    state.probGraph=new ProbabilisticFactorGraph({maxFrames:CONFIG.probabilisticMaxFrames||360,maxFeaturesPerFrame:CONFIG.probabilisticMaxFeaturesPerFrame||360,grayMaxSide:CONFIG.probabilisticGrayMaxSide||120,photoMaxSide:CONFIG.probabilisticPhotoMaxSide||128,deepGridCols:CONFIG.probabilisticDeepGridCols||32,deepGridRows:CONFIG.probabilisticDeepGridRows||48,mvsPerFrame:CONFIG.probabilisticMvsPerFrame||420,maxLandmarks:CONFIG.probabilisticMaxGraphLandmarks||18000});
    state.deepSequence=new DeepSequenceModel({minAnchors:CONFIG.deepMinAnchors||5,minCells:CONFIG.deepMinAnchorCells||3});
  }else{state.probGraph=null;state.deepSequence=null;}
  state.alvaRelocalization=null;state.alvaRelocalizer=CONFIG.alvaRelocalizationEnabled===false?null:new relocalizerApi.AlvaReferenceRelocalizer({maxLandmarks:CONFIG.alvaRelocalizationMaxLandmarks||900,minMatches:CONFIG.alvaRelocalizationMinMatches||8,minInliers:CONFIG.alvaRelocalizationMinInliers||6,maxRmsePx:CONFIG.alvaRelocalizationMaxRmsePx||5.5,intervalMs:CONFIG.alvaRelocalizationIntervalMs||520});
  if(state.probGraph){state.singleOptRuntime?.reset?.(null);void ensureSingleOptimizerRuntime().catch(err=>{log.error('single-opt-runtime-init',{message:err?.message||String(err),stack:err?.stack||null});updateLiveOptimizerHud('OPT UNICO · errore init · vedi Log');});}
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

  // Deep owns no acquisition resources in the default post-scan policy. If the
  // explicit model test left a warm ONNX worker alive, terminate it here so its
  // WASM heap/threads cannot compete with camera + Alva + RGB. Exact RGB frames
  // are queued without a Deep worker and the worker is recreated only after the
  // fast lane has been frozen by finishScan().
  state.deepSelector=new DeepKeyframeSelector({minIntervalMs:CONFIG.deepMinIntervalMs||2600,maxIntervalMs:CONFIG.deepMaxIntervalMs||8000,minTranslationM:CONFIG.deepMinTranslationM||.20,minTranslationAlva:CONFIG.deepMinTranslationAlva||.10,minRotationRad:CONFIG.deepMinRotationRad||.16,minAnchors:CONFIG.deepMinAnchors||7,minAnchorCells:CONFIG.deepMinAnchorCells||3,depthNovelty:CONFIG.deepDepthNovelty||.22});
  if(CONFIG.deepDepthEnabled!==false){
    if(CONFIG.deepPostScanOnly!==false){
      state.deepDepthWorker?.terminate?.();state.deepDepthWorker=null;state.deepWorkerModelId=null;
      log.info('deep-worker-deferred',{postScanOnly:true,fastLaneOwnsAcquisition:true});
    }else ensureDeepRuntimeWorker();
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
  if($('mvsState'))$('mvsState').textContent='FAST: Alva+RGB · foto stabili salvate · MVS/Deep post-scan';
  if($('deepLiveState'))$('deepLiveState').textContent='FOTO STABILI 0 · Deep solo dopo Fine';
  if($('metricPipelineHud'))$('metricPipelineHud').textContent='Surface mapper: attendo 3 viste con parallasse.';

  // The calibration bridge has no authority after the one-shot similarity is
  // locked. This is deliberately the last bridge-related line in Scan.
  if(bridge===state.bridge)state.bridge=null;state.alvaBootstrap=null;

  state.scanStop=state.camera.loop(frame=>{try{
    state.lastFrameGeometry=frame.geometry;noteFastLaneFrame(frame);const r=state.slam.process(frame),featureState=classifyAlvaFramePoints(r.framePoints||[],Number(frame.at)||performance.now(),r.pose),reference=maybeRelocalizeAlva(r,frame),integrity=updateAlvaTrackingIntegrity(r,frame,featureState);r._integrityAccepted=!!integrity.accept;r.referenceRelocalization=reference||null;state.lastTracking=r;drawAlvaFeatureOverlay(featureState,frame.width,frame.height);updateAlvaRecoveryUi(integrity,featureState);
    if($('statFeat'))$('statFeat').textContent=String(r.features);if($('statMatch'))$('statMatch').textContent=String(r.matches);if($('statKf'))$('statKf').textContent=String(r.keyframes);if($('alvaPtsState'))$('alvaPtsState').textContent=`ALVA pts ${r.alvaPoints||0} · persistenti ${featureState.persistent.length}`;
    const status=integrity.recovery?'ALVA RECOVERY':r.trackingMode==='alvaar-relocalized'?'ALVA RELOCALIZED':r.trackingValid?'ALVA TRACKING':r.trackingMode==='alvaar-initializing'?'ALVA INIT':'ALVA LOST';
    if($('slamState'))$('slamState').textContent=`${status}${state.gaussians.length?' + SURFACE':''}`;
    if(!integrity.recovery&&$('coach'))$('coach').textContent=r.trackingValid?'AlvaAR stabile · azzurro = feature persistenti, ambra = nuove. Trasla lentamente e mantieni overlap.':r.trackingMode==='alvaar-initializing'?'AlvaAR INIT · muovi lentamente il telefono di lato mantenendo texture e luce stabili.':'Tracking Alva perso · torna verso una zona già osservata.';
    // FAST LANE: archive only frames whose Alva reference passed the integrity
    // guard. A lost/jumped tail is quarantined and never reaches RGB/Deep/MVS.
    requestLiveDeepPreview(frame,r);
    if(r.newObservation&&integrity.accept)recordAlvaHeartbeat(r.newObservation,frame,K);
    if(r.newKeyframe&&r.trackingValid&&integrity.accept)void queueDenseKeyframe(r.newKeyframe,frame,K).catch(err=>log.warn('dense-keyframe-sync',{frameId:frame.frameId||null,keyframeFrameId:r.newKeyframe?.frameId||null,message:err?.message||String(err)}));
    // Keep the AR overlay and the tracking diagnostics on the same exact Alva
    // observations.  Passing an empty array here hid the valid tracking points
    // from the live view even though they were available to the mapper.
    state.liveOverlay?.draw({pose:r.pose,K,geometry:frame.geometry,video:state.camera.video,framePoints:r.framePoints||[]});
    if(state.currentSession&&r.newKeyframe&&r.keyframes%5===0)state.db?.updateSession(state.currentSession.id,{status:'scanning',counts:{keyframes:r.keyframes,denseSamples:state.denseDepthSamples,surfels:state.surfaceStats?.confirmed||0,gaussians:state.gaussians.length,meshFaces:state.mesh?.faces?.length?state.mesh.faces.length/3:0}}).catch(()=>{});
  }catch(err){log.warn('scan-frame',{message:err.message,stack:err.stack||null});}});
}

function captureLiveSurveyFrame(frame,tracking){
  // Freeze the exact RGB frame that is explicitly depth-planned. V30.45 may
  // register it in the RGB graph immediately; Depth is late-bound later to this
  // immutable frameId and never controls the tracking/photo clock.
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

function commitExactRgbDepthPhoto(survey,depthResult,{source='deep-exact-frame'}={}){
  if(!survey?.frameId||!state.liveMap||!depthResult?.rawDepth?.length)return {ok:false,reason:'missing-exact-rgb-depth'};
  const id=String(survey.frameId);if(state.photoDepthCommittedFrameIds?.has?.(id))return {ok:true,deduplicated:true,stats:state.liveMap.stats?.()||state.liveMapStats};
  const q=depthResult.quality||{},confidence=q.suspicious?.025:.18,committed=state.liveMap.commitCameraFrameWithRelativeDepth?.(survey,{rawDepth:depthResult.rawDepth,width:depthResult.rawWidth,height:depthResult.rawHeight,quality:q,confidence},{fallbackDepth:state.denseDepthHint||CONFIG.livePuzzleFallbackDepth||2.2,source});
  if(committed?.ok)state.photoDepthCommittedFrameIds?.add?.(id);return committed||{ok:false,reason:'live-map-commit-unavailable'};
}
function denseKeyframeSurvey(ref){
  if(!ref?.frameId||!ref?.gray?.length||!ref?.rgba?.length||!ref?.K)return null;const pose=ref.pose?.p&&ref.pose?.q?{p:[...ref.pose.p],q:[...ref.pose.q]}:null;return {id:`photo-depth-${ref.frameId}`,frameId:String(ref.frameId),captureAt:Number(ref.captureAt??ref.at),at:Number(ref.at??ref.captureAt),pose,poseCov:ref.poseCov||null,K:{...ref.K},width:ref.width,height:ref.height,gray:new Uint8Array(ref.gray),rgba:new Uint8ClampedArray(ref.rgba),features:ref.features||[],metricLocked:!!state.slam?.metricLocked,trackingMode:pose?'alva-keyframe':'alva-unavailable',trackingValid:!!pose,depthPlanned:true,photoQuality:state.frameQualityApi?.assessRgbFrameQuality?.(ref.gray,ref.width,ref.height)||null};
}


function registerDepthPlannedPhoto(survey,{source='depth-planned',optimize=true,render=true,adaptiveCandidate=false}={}){
  if(!survey?.frameId)return {ok:false,reason:'missing-frame'};
  const id=String(survey.frameId);if(!adaptiveCandidate&&state.photoPlannedFrameIds?.has?.(id))return {ok:true,deduplicated:true,method:'already-planned'};
  let mapOk=false,method='none',error=null;
  if(state.liveMap){
    const candidates=['addDepthPlannedFrame','addCameraFrame','addFrame'];
    for(const name of candidates){
      const fn=state.liveMap?.[name];if(typeof fn!=='function')continue;
      try{
        const before=state.liveMap?.stats?.()?.frames||0,r=fn.call(state.liveMap,survey,{depthPlanned:!adaptiveCandidate,adaptiveDepthCandidate:!!adaptiveCandidate,source,fallbackDepth:state.denseDepthHint||CONFIG.livePuzzleFallbackDepth||2.2}),after=state.liveMap?.stats?.()?.frames||0,exported=state.liveMap?.exportState?.(),present=!!exported?.frames?.some?.(f=>String(f?.frameId||'')===id);
        if(r?.ok===true||present||after>before){mapOk=true;method=name;break;}
        error=`${name}-did-not-register-frame`;
      }catch(err){error=err?.message||String(err);}
    }
  }
  // The metric graph can ingest the pose-bearing exact frame immediately. The
  // photo-map placement remains RGB-only; Alva is only an initial metric node.
  const graphFrame=survey.pose?(state.probGraph?.addFrame(survey)||null):null;
  if(!adaptiveCandidate)state.photoPlannedFrameIds?.add?.(id);
  if(mapOk){state.liveMapStats=state.liveMap?.stats?.()||state.liveMapStats;if(render)scheduleLiveMapRender(true);}
  log.info(adaptiveCandidate?'rgb-adaptive-depth-candidate':'rgb-depth-planned-photo',{frameId:id,source,adaptiveCandidate,mapRegistered:mapOk,mapMethod:method,metricGraphNode:!!graphFrame,error,queue:state.deepLateQueue?.stats?.()||null});
  if(graphFrame&&optimize)scheduleLiveOptimization(adaptiveCandidate?'rgb-adaptive-candidate':'rgb-depth-planned',{slow:false});
  return {ok:true,mapRegistered:mapOk,method,metricGraphNode:!!graphFrame};
}
function attachLateDepthToPhoto(survey,d,{source='deep-late'}={}){
  if(!survey?.frameId||!d?.rawDepth?.length)return {ok:false,reason:'missing-exact-rgb-depth'};
  const id=String(survey.frameId),q=d.quality||{},confidence=q.suspicious?.025:.18;
  let updated=false;
  try{updated=!!state.liveMap?.updateRelativeDepth?.(id,{rawDepth:d.rawDepth,width:d.rawWidth,height:d.rawHeight,quality:q,confidence,source});}catch(err){log.warn('deep-late-depth-attach',{frameId:id,source,message:err?.message||String(err)});}
  if(updated){state.photoDepthCommittedFrameIds?.add?.(id);state.liveMapStats=state.liveMap?.stats?.()||state.liveMapStats;scheduleLiveMapRender(true);return {ok:true,lateBound:true,stats:state.liveMapStats};}
  const committed=commitExactRgbDepthPhoto(survey,d,{source});
  if(committed?.ok){state.liveMapStats=committed.stats||state.liveMap?.stats?.()||state.liveMapStats;scheduleLiveMapRender(true);}
  return committed;
}
function enqueueLateDeepJob(job){
  if(!job?.frameId||!job?.rgba?.length)return {ok:false,reason:'missing-raster'};
  const result=state.deepLateQueue?.enqueue?.({...job,queuedAt:performance.now()})||{ok:false,reason:'queue-unavailable'};
  if(!result.ok){log.warn('deep-late-queue-rejected',{frameId:job.frameId,kind:job.kind,reason:result.reason,queue:state.deepLateQueue?.stats?.()||null});return result;}
  state.deepLaneQueuedFrames?.add?.(String(job.frameId));state.deepPlanLastAt=performance.now();
  log.debug('deep-late-queued',{jobId:job.jobId,frameId:job.frameId,kind:job.kind,replaced:!!result.replaced,deduplicated:!!result.deduplicated,queue:state.deepLateQueue?.stats?.()||null});
  if(CONFIG.deepPostScanOnly===false)void pumpDeepLateLane();
  return result;
}
async function pumpDeepLateLane(){
  if(!state.deepDepthWorker||state.deepDisabled||state.deepLaneInFlight)return false;
  if(CONFIG.deepPostScanOnly!==false&&!state.deepDrainActive)return false;
  const job=state.deepLateQueue?.next?.();if(!job)return false;
  const rgba=new Uint8ClampedArray(job.rgba),binding=state.deepSync.createDeepFrameBinding({jobId:job.jobId,kind:job.kind,frameId:job.frameId,frameAt:job.frameAt,refId:job.refId||null,rgba,width:job.width,height:job.height,survey:job.survey||null,payload:job.payload||null,tracking:job.tracking||null});
  state.deepJobs.set(job.jobId,binding);state.deepLaneInFlight=job.jobId;state.deepCalls++;
  state.deepDepthWorker.postMessage({type:'infer',jobId:job.jobId,refId:job.refId||null,frameId:binding.frameId,frameAt:binding.frameAt,model:modelForWorker(),rgba,width:job.width,height:job.height},[rgba.buffer]);
  const wait=Math.max(0,performance.now()-(job.queuedAt||performance.now()));
  log.info('deep-late-dispatch',{jobId:job.jobId,frameId:job.frameId,kind:job.kind,calls:state.deepCalls,queueWaitMs:wait,fastLaneActive:!!state.scanStop,fastLaneAgeMs:state.fastLaneLastAt?Math.max(0,performance.now()-state.fastLaneLastAt):null,queue:state.deepLateQueue?.stats?.()||null});
  if($('deepLiveState'))$('deepLiveState').textContent=`DEEP POST · ${state.deepCalls} · coda ${state.deepLateQueue?.stats?.().queued||0}`;
  return true;
}
function finishDeepLaneJob(jobId,{failed=false}={}){
  if(failed)state.deepLateQueue?.fail?.(jobId);else state.deepLateQueue?.complete?.(jobId);
  if(String(state.deepLaneInFlight||'')===String(jobId||''))state.deepLaneInFlight=null;
  state.deepLaneQueuedFrames?.delete?.(String(state.deepJobs.get(String(jobId||''))?.frameId||''));
  if(state.deepDrainActive||CONFIG.deepPostScanOnly===false)queueMicrotask(()=>void pumpDeepLateLane());
}
async function drainDeepBacklog(){
  if(CONFIG.deepDepthEnabled===false||state.deepDisabled)return {ok:false,reason:'deep-unavailable'};
  try{ensureDeepRuntimeWorker();}catch(err){state.deepDisabled=true;log.warn('deep-postscan-worker-init',{message:err?.message||String(err)});return {ok:false,reason:'deep-worker-init-failed'};}
  state.deepDrainActive=true;const started=performance.now(),timeout=Math.max(10000,Number(CONFIG.deepPostScanMaxDrainMs)||180000);
  log.info('deep-postscan-drain-start',{queue:state.deepLateQueue?.stats?.()||null,fastLaneFrames:state.fastLaneFrames,maxFastLaneGapMs:state.fastLaneMaxGapMs});
  await pumpDeepLateLane();
  while((state.deepLaneInFlight||(state.deepLateQueue?.stats?.().queued||0)>0)&&performance.now()-started<timeout){await new Promise(r=>setTimeout(r,40));}
  const timedOut=!!(state.deepLaneInFlight||(state.deepLateQueue?.stats?.().queued||0)>0),stats=state.deepLateQueue?.stats?.()||null;state.deepDrainActive=false;
  log.info('deep-postscan-drain-complete',{elapsedMs:performance.now()-started,timedOut,queue:stats,calls:state.deepCalls,accepted:state.deepAccepted});
  if($('deepLiveState'))$('deepLiveState').textContent=timedOut?`DEEP POST ⚠ coda residua ${stats?.queued||0}`:`DEEP POST ✓ ${stats?.completed||0} frame`;
  return {ok:!timedOut,timedOut,stats};
}
function noteFastLaneFrame(frame){
  const now=Number(frame?.at)||performance.now();if(state.fastLaneLastAt){const gap=Math.max(0,now-state.fastLaneLastAt);state.fastLaneLastGapMs=gap;state.fastLaneMaxGapMs=Math.max(state.fastLaneMaxGapMs||0,gap);if(gap>(CONFIG.fastLaneGapWarnMs||650))log.warn('fast-lane-frame-gap',{gapMs:gap,deepInFlight:state.deepLaneInFlight||null,deepDrainActive:state.deepDrainActive,denseBusy:state.denseBusy,sparseBusy:state.sparseBusy,postScanMvsQueued:state.postScanMvsPayloads?.length||0,queue:state.deepLateQueue?.stats?.()||null});}state.fastLaneLastAt=now;state.fastLaneFrames++;
}
function stopCaptureFastLane(){state.scanStop?.();state.scanStop=null;state.camera?.stop();state.camera=null;}

function lateDeepPlanGate(now=performance.now()){
  const q=state.deepLateQueue?.stats?.()||{},max=Math.max(1,Number(q.maxItems||CONFIG.deepLateQueueMaxItems)||32),occupied=Math.max(0,Number(q.queued||0)+Number(q.inFlight||0)),fraction=Math.min(1,occupied/max),base=Math.max(3000,Number(CONFIG.deepPlanIntervalMs)||6500),interval=base*(1+(Number(CONFIG.deepPlanBackpressureGain)||2.5)*fraction*fraction),elapsed=now-(state.deepPlanLastAt||0);
  return {ok:elapsed>=interval,interval,elapsed,fraction,occupied,max};
}

function ensurePhotoArchiveWorker(){
  if(state.photoArchiveWorker)return state.photoArchiveWorker;
  try{
    const worker=new Worker(`workers/photo_archive_worker.js?v=${BUILD.version}`,{type:'module'});state.photoArchiveWorker=worker;
    worker.onmessage=e=>void handlePhotoArchiveWorkerMessage(e.data||{});
    worker.onerror=e=>{state.photoArchiveStorageError=true;log.warn('sharp-photo-archive-worker',{message:e?.message||'worker error'});};
    return worker;
  }catch(err){state.photoArchiveStorageError=true;log.warn('sharp-photo-archive-worker-init',{message:err?.message||String(err)});return null;}
}
function archiveMotionState(pose,at,metricLocked){
  const prev=state.photoArchivePrevPose,limit=metricLocked?(CONFIG.sharpArchiveMaxTranslationSpeedMetric||.34):(CONFIG.sharpArchiveMaxTranslationSpeedAlva||.52);let out={valid:false,dtMs:0,translation:0,rotationRad:0,translationSpeed:0,angularSpeed:0,translationLimit:limit};
  if(prev?.pose?.p&&prev?.pose?.q){const dt=Math.max(1,at-prev.at),tr=Math.hypot(pose.p[0]-prev.pose.p[0],pose.p[1]-prev.pose.p[1],pose.p[2]-prev.pose.p[2]),rot=quatAngle(prev.pose.q,pose.q);out={valid:dt<1200,dtMs:dt,translation:tr,rotationRad:rot,translationSpeed:tr/(dt/1000),angularSpeed:rot/(dt/1000),translationLimit:limit};}
  state.photoArchivePrevPose={pose:{p:[...pose.p],q:[...pose.q]},at};return out;
}
function compactArchiveFeatures(xs,max=180){return (xs||[]).slice(0,max).map(f=>({x:+f.x||0,y:+f.y||0,score:+f.score||0,source:f.source||'rgb',desc:Array.isArray(f.desc)?f.desc.slice(0,24).map(Number):[],referenceDesc:Array.isArray(f.referenceDesc)?f.referenceDesc.slice(0,24).map(Number):(Array.isArray(f.desc)?f.desc.slice(0,24).map(Number):[])}));}
function pointTrackId(p){const id=p?.trackId??p?.landmarkId??p?.id;return id==null?null:String(id);}
function classifyAlvaFramePoints(points,at=performance.now(),pose=null){
  const raw=(points||[]).filter(p=>Number.isFinite(+p?.x)&&Number.isFinite(+p?.y)),maxMiss=Math.max(1,Number(CONFIG.alvaPersistentFeatureMaxMisses)||2),threshold=Math.max(4,Number(CONFIG.alvaPersistentFeatureMatchPx)||14),minHits=Math.max(2,Number(CONFIG.alvaPersistentFeatureMinHits)||4),minViewTranslation=Math.max(0,Number(CONFIG.alvaPersistentFeatureMinViewTranslation)||.015),minViewRotation=Math.max(0,Number(CONFIG.alvaPersistentFeatureMinViewRotationRad)||.025),old=state.alvaFeatureTracks||[],used=new Set(),next=[],poseOk=!!(pose?.p?.length>=3&&pose?.q?.length>=4);
  const byId=new Map(old.filter(t=>t.externalId!=null).map((t,i)=>[t.externalId,{t,i}]));
  const spatialUpdate=t=>{if(!poseOk)return t;const first=t.firstPose?.p&&t.firstPose?.q?t.firstPose:{p:[...pose.p],q:[...pose.q]},viewTranslation=Math.hypot(pose.p[0]-first.p[0],pose.p[1]-first.p[1],pose.p[2]-first.p[2]),viewRotation=quatAngle(pose.q,first.q);return {...t,firstPose:first,maxViewTranslation:Math.max(Number(t.maxViewTranslation)||0,viewTranslation),maxViewRotation:Math.max(Number(t.maxViewRotation)||0,viewRotation)};};
  for(const p of raw){const externalId=pointTrackId(p);let match=null,mi=-1;if(externalId!=null&&byId.has(externalId)){const z=byId.get(externalId);match=z.t;mi=z.i;}else{let best=threshold*threshold;for(let i=0;i<old.length;i++){if(used.has(i)||old[i].externalId!=null)continue;const t=old[i],dt=Math.max(1,at-(t.at||at)),px=t.x+(t.vx||0)*dt/1000,py=t.y+(t.vy||0)*dt/1000,d2=(+p.x-px)**2+(+p.y-py)**2;if(d2<best){best=d2;match=t;mi=i;}}}
    if(match){used.add(mi);const dt=Math.max(1,at-(match.at||at)),vx=(+p.x-match.x)/(dt/1000),vy=(+p.y-match.y)/(dt/1000);next.push(spatialUpdate({...match,x:+p.x,y:+p.y,vx:.65*(match.vx||0)+.35*vx,vy:.65*(match.vy||0)+.35*vy,hits:(match.hits||1)+1,misses:0,age:(match.age||1)+1,at,externalId:externalId??match.externalId??null}));}
    else next.push(spatialUpdate({id:++state.alvaFeatureTrackSeq,externalId,x:+p.x,y:+p.y,vx:0,vy:0,hits:1,misses:0,age:1,at,firstPose:poseOk?{p:[...pose.p],q:[...pose.q]}:null,maxViewTranslation:0,maxViewRotation:0}));
  }
  for(let i=0;i<old.length;i++)if(!used.has(i)){const t=old[i],misses=(t.misses||0)+1;if(misses<=maxMiss)next.push({...t,misses});}
  state.alvaFeatureTracks=next.slice(-900);const visible=next.filter(t=>(t.misses||0)===0),isPersistent=t=>{const temporal=(t.hits||0)>=minHits&&(t.age||0)>=minHits;if(!temporal)return false;if(t.externalId!=null)return true;return (Number(t.maxViewTranslation)||0)>=minViewTranslation||(Number(t.maxViewRotation)||0)>=minViewRotation;},persistent=visible.filter(isPersistent),fresh=visible.filter(t=>!isPersistent(t));state.alvaPersistentFeatures=persistent.length;state.alvaNewFeatures=fresh.length;return {persistent,fresh,total:visible.length,persistentFraction:visible.length?persistent.length/visible.length:0,minViewTranslation,minViewRotation};
}
function drawAlvaFeatureOverlay(featureState,srcWidth=CONFIG.analysisWidth,srcHeight=CONFIG.analysisHeight){
  const canvas=$('alvaFeatureOverlay');if(!canvas)return;const rect=canvas.getBoundingClientRect(),w=Math.max(1,Math.round(rect.width||innerWidth)),h=Math.max(1,Math.round(rect.height||innerHeight));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);const scale=Math.max(w/Math.max(1,srcWidth),h/Math.max(1,srcHeight)),ox=(w-srcWidth*scale)/2,oy=(h-srcHeight*scale)/2,draw=(xs,fill,r)=>{ctx.fillStyle=fill;for(const p of xs||[]){ctx.beginPath();ctx.arc(ox+p.x*scale,oy+p.y*scale,r,0,Math.PI*2);ctx.fill();}};draw(featureState?.fresh,'rgba(255,196,82,.82)',1.7);draw(featureState?.persistent,'rgba(85,220,255,.96)',2.4);const label=$('alvaFeatureState');if(label)label.textContent=`feature persistenti ${featureState?.persistent?.length||0} · nuove ${featureState?.fresh?.length||0}`;
}
function quarantineRecentArchive(at,reason){const win=Math.max(250,Number(CONFIG.alvaQuarantineTailMs)||900);let n=0;for(const r of state.photoArchiveEntries||[]){if(Math.abs((Number(r.at)||0)-at)<=win&&!r.trackingRejected){r.trackingRejected=true;r.trackingRejectReason=reason;state.alvaQuarantinedFrameIds.add(String(r.frameId));n++;try{state.db?.put?.('events',r)?.catch?.(()=>{});}catch{}}}if(n)log.warn('alva-photo-tail-quarantined',{reason,count:n,windowMs:win,at});return n;}
function maybeRelocalizeAlva(r,frame){
  if(CONFIG.alvaRelocalizationEnabled===false||!state.alvaRelocalizer||!state.probGraph||(!state.alvaRecoveryRequired&&r?.trackingValid))return state.alvaRelocalization;
  const previous=state.alvaRelocalization,result=state.alvaRelocalizer.evaluate({features:r?.featureObservations||[],K:state.scanK,graph:state.probGraph,at:Number(frame?.at)||performance.now()});state.alvaRelocalization=result;
  if(result?.ok&&(!previous?.ok||previous.candidateFrameId!==result.candidateFrameId)){log.info('alva-reference-memory-match',{frameId:frame?.frameId||null,candidateFrameId:result.candidateFrameId,matches:result.matches,inliers:result.inliers,rmsePx:result.rmsePx,available:result.available});}
  return result;
}
function updateAlvaTrackingIntegrity(r,frame,featureState){
  const at=Number(frame?.at)||performance.now(),valid=!!(r?.trackingValid&&r?.pose?.p&&r?.pose?.q),persistent=featureState?.persistent?.length||0,fraction=featureState?.persistentFraction||0,minPersistent=Math.max(4,Number(CONFIG.alvaRecoveryMinPersistent)||18),minFraction=Math.max(.05,Number(CONFIG.alvaRecoveryMinPersistentFraction)||.28),trusted=state.alvaLastTrustedPose,sidecar=state.alvaRelocalization;let jump=false,tr=0,rot=0,dt=0;
  if(valid&&trusted?.p&&trusted?.q&&state.alvaLastTrustedAt){dt=Math.max(1,at-state.alvaLastTrustedAt);tr=Math.hypot(r.pose.p[0]-trusted.p[0],r.pose.p[1]-trusted.p[1],r.pose.p[2]-trusted.p[2]);rot=quatAngle(r.pose.q,trusted.q);jump=dt<=(Number(CONFIG.alvaIntegrityJumpWindowMs)||1400)&&(tr>(Number(CONFIG.alvaIntegrityJumpTranslation)||.55)||rot>(Number(CONFIG.alvaIntegrityJumpRotationRad)||.62));}
  if(!valid){if(!state.alvaRecoveryRequired){state.alvaRecoveryRequired=true;state.alvaRecoveryReason='tracking-lost';state.alvaRecoveryStableFrames=0;quarantineRecentArchive(at,'tracking-lost-tail');log.warn('alva-reference-lost',{frameId:frame?.frameId||null,persistentFeatures:persistent,persistentFraction:fraction});}return {accept:false,recovery:true,reason:state.alvaRecoveryReason,jump:false,translation:tr,rotationRad:rot};}
  if(jump){state.alvaRecoveryRequired=true;state.alvaRecoveryReason='pose-jump';state.alvaRecoveryStableFrames=0;quarantineRecentArchive(at,'pose-jump-tail');state.alvaQuarantinedFrameIds.add(String(frame?.frameId||''));log.warn('alva-pose-jump',{frameId:frame?.frameId||null,translation:tr,rotationRad:rot,dtMs:dt,persistentFeatures:persistent,persistentFraction:fraction});}
  if(state.alvaRecoveryRequired){const returnPoseOk=!trusted||(Math.hypot(r.pose.p[0]-trusted.p[0],r.pose.p[1]-trusted.p[1],r.pose.p[2]-trusted.p[2])<=(Number(CONFIG.alvaRecoveryReturnTranslation)||.9)&&quatAngle(r.pose.q,trusted.q)<=(Number(CONFIG.alvaRecoveryReturnRotationRad)||.9)),featureOk=persistent>=minPersistent&&fraction>=minFraction,explicitReloc=String(r.trackingMode||'').includes('relocalized'),sidecarPoseOk=!!(sidecar?.ok&&state.alvaRelocalizerApi?.relocalizationPoseCompatible?.(r.pose,sidecar,{maxTranslation:CONFIG.alvaRelocalizationMaxTranslation||1.15,maxRotationRad:CONFIG.alvaRelocalizationMaxRotationRad||.95})),recoveryEvidenceOk=sidecarPoseOk||(featureOk&&(returnPoseOk||explicitReloc));if(!jump&&recoveryEvidenceOk)state.alvaRecoveryStableFrames++;else state.alvaRecoveryStableFrames=0;if(state.alvaRecoveryStableFrames>=(Number(CONFIG.alvaRecoveryStableFrames)||4)){const previous=state.alvaRecoveryReason;state.alvaRecoveryRequired=false;state.alvaRecoveryReason=null;state.alvaRecoveryStableFrames=0;state.alvaLastTrustedPose={p:[...r.pose.p],q:[...r.pose.q]};state.alvaLastTrustedAt=at;log.info('alva-reference-recovered',{frameId:frame?.frameId||null,previousReason:previous,persistentFeatures:persistent,persistentFraction:fraction,trackingMode:r.trackingMode,sidecarPoseOk,sidecarMatches:sidecar?.matches||0,sidecarInliers:sidecar?.inliers||0});return {accept:true,recovery:false,recovered:true,sidecarPoseOk};}return {accept:false,recovery:true,reason:state.alvaRecoveryReason,jump,translation:tr,rotationRad:rot,returnPoseOk,featureOk,sidecarPoseOk,sidecar};}
  state.alvaLastTrustedPose={p:[...r.pose.p],q:[...r.pose.q]};state.alvaLastTrustedAt=at;return {accept:true,recovery:false,jump:false,translation:tr,rotationRad:rot};
}
function updateAlvaRecoveryUi(integrity,featureState){const banner=$('alvaRecoveryBanner'),memory=state.alvaRelocalization;if(banner){banner.hidden=!integrity?.recovery;if(integrity?.recovery){if(memory?.ok)banner.textContent=`✓ MEMORIA VISIVA: zona già osservata riconosciuta (${memory.inliers}/${memory.matches} inlier · ${Number(memory.rmsePx).toFixed(1)} px). Mantieni questa inquadratura: verifico il ritorno ufficiale di AlvaAR.`;else banner.textContent=integrity.reason==='pose-jump'?'⚠ ALVA HA FATTO UN SALTO · torna lentamente verso l’ultima zona riconosciuta; i frame fuori riferimento vengono esclusi.':'⚠ ALVA HA PERSO IL RIFERIMENTO · torna indietro verso una zona già vista finché i punti azzurri persistenti ricompaiono.';}}if(integrity?.recovery&&$('coach'))$('coach').textContent=banner?.textContent||'Tracking Alva da recuperare.';const label=$('alvaFeatureState');if(label){label.dataset.recovery=integrity?.recovery?'1':'0';if(memory?.ok)label.textContent=`feature persistenti ${featureState?.persistent?.length||0} · memoria ${memory.inliers}/${memory.matches}`;}}
function archiveSharpRgbFrame(frame,tracking){
  if(CONFIG.sharpPhotoArchiveEnabled===false||!state.currentSession||!frame?.rgba?.length||!frame?.gray?.length||!tracking?.trackingValid||!tracking?.pose?.p||!tracking?.pose?.q||tracking?._integrityAccepted===false||state.alvaRecoveryRequired)return false;
  const at=Number(frame.at)||performance.now(),metricLocked=!!state.slam?.metricLocked,motion=archiveMotionState(tracking.pose,at,metricLocked),detail=gradientDetail(frame.gray,frame.width,frame.height),minDetail=Number(CONFIG.sharpArchiveMinDetail)||4.2,minInterval=Math.max(0,Number(CONFIG.sharpArchiveMinIntervalMs)||110);
  if(at-(state.photoArchiveLastAt||0)<minInterval)return false;
  if(detail<minDetail||(motion.valid&&(motion.translationSpeed>(motion.translationLimit||.4)||motion.angularSpeed>(CONFIG.sharpArchiveMaxAngularSpeedRad||.72)))){state.photoArchiveRejected++;return false;}
  if(state.photoArchivePending>=(CONFIG.sharpArchiveMaxPending||2)){state.photoArchiveBackpressureDropped++;return false;}
  if(state.photoArchiveAccepted>=(CONFIG.sharpArchiveMaxFrames||1600)||state.photoArchiveBytes>=(CONFIG.sharpArchiveMaxBytes||367001600)){state.photoArchiveRejected++;return false;}
  const worker=ensurePhotoArchiveWorker();if(!worker)return false;
  const seq=++state.photoArchiveSeq,id=`sharp-rgb-${state.currentSession.id}-${seq}`,previous=state.photoArchiveEntries[state.photoArchiveEntries.length-1]||null,jump=previous?.pose?{translation:Math.hypot(tracking.pose.p[0]-previous.pose.p[0],tracking.pose.p[1]-previous.pose.p[1],tracking.pose.p[2]-previous.pose.p[2]),rotationRad:quatAngle(tracking.pose.q,previous.pose.q),dtMs:Math.max(0,at-(previous.at||at))}:{translation:0,rotationRad:0,dtMs:0};jump.suspect=jump.dtMs<=(CONFIG.sharpArchiveJumpWindowMs||2200)&&(jump.translation>(CONFIG.sharpArchiveJumpTranslation||.8)||jump.rotationRad>(CONFIG.sharpArchiveJumpRotationRad||.78));
  const stableQuality=Math.max(0,Math.min(1,.58*Math.min(1,Math.max(0,(detail-2)/12))+.24*(motion.valid?Math.max(0,1-motion.translationSpeed/Math.max(.001,motion.translationLimit)):.7)+.18*(motion.valid?Math.max(0,1-motion.angularSpeed/.9):.7))),meta={id,sessionId:state.currentSession.id,seq,kind:'sharp-rgb-photo',frameId:String(frame.frameId),captureAt:at,at,width:frame.width,height:frame.height,K:{...state.scanK},pose:{p:[...tracking.pose.p],q:[...tracking.pose.q]},poseCov:tracking.poseCov||null,trackingMode:tracking.trackingMode||'alvaar',trackingValid:true,metricLocked,features:compactArchiveFeatures(tracking.featureObservations||tracking.newKeyframe?.features||[]),photoQuality:{detail,stableQuality},stability:{detail,translationSpeed:motion.translationSpeed,angularSpeed:motion.angularSpeed,dtMs:motion.dtMs,jumpSuspect:jump.suspect,jumpTranslation:jump.translation,jumpRotationRad:jump.rotationRad,jumpDtMs:jump.dtMs},depthCandidate:true,depthPlanned:false};
  const rgba=new Uint8ClampedArray(frame.rgba);state.photoArchivePendingMeta.set(id,meta);state.photoArchivePending++;state.photoArchiveLastAt=at;worker.postMessage({type:'archive-rgb',id,width:frame.width,height:frame.height,rgba:rgba.buffer,mime:CONFIG.sharpArchiveMime||'image/jpeg',quality:CONFIG.sharpArchiveJpegQuality||.86},[rgba.buffer]);return true;
}
async function handlePhotoArchiveWorkerMessage(d){
  if(d.type!=='archive-rgb-result'&&d.type!=='archive-rgb-error')return;const id=String(d.id||''),meta=state.photoArchivePendingMeta.get(id);state.photoArchivePendingMeta.delete(id);state.photoArchivePending=Math.max(0,state.photoArchivePending-1);if(!meta)return;
  if(d.type==='archive-rgb-error'){state.photoArchiveRejected++;log.warn('sharp-photo-archive-compress',{frameId:meta.frameId,message:d.message||'compression failed'});return;}
  const record={...meta,mime:d.mime||'image/jpeg',bytes:Number(d.bytes)||d.blob?.size||0,blob:d.blob};let stored=false;
  try{if(state.db){await state.db.put('events',record);stored=true;}}catch(err){state.photoArchiveStorageError=true;log.warn('sharp-photo-archive-store',{frameId:meta.frameId,message:err?.message||String(err)});}
  if(!stored){const max=Math.max(8,Number(CONFIG.sharpArchiveMemoryFallbackFrames)||24);state.photoArchiveMemoryFallback.push(record);if(state.photoArchiveMemoryFallback.length>max)state.photoArchiveMemoryFallback.shift();}
  state.photoArchiveAccepted++;state.photoArchiveBytes+=record.bytes||0;const summary={...record,stored};state.photoArchiveEntries.push(summary);
  if(state.photoArchiveEntries.length>(CONFIG.sharpArchiveMaxFrames||1600))state.photoArchiveEntries.shift();
  if(state.photoArchiveAccepted%16===0||record.stability?.jumpSuspect)log[record.stability?.jumpSuspect?'warn':'debug']('sharp-photo-archived',{frameId:record.frameId,stored,accepted:state.photoArchiveAccepted,pending:state.photoArchivePending,bytes:state.photoArchiveBytes,detail:record.photoQuality?.detail,jump:record.stability});
  if($('deepLiveState'))$('deepLiveState').textContent=`FOTO NITIDE ${state.photoArchiveAccepted} · ${(state.photoArchiveBytes/1048576).toFixed(0)} MB compressi · Deep dopo Fine`;
}
async function waitForPhotoArchiveIdle(timeoutMs=12000){const t=performance.now();while(state.photoArchivePending>0&&performance.now()-t<timeoutMs)await new Promise(r=>setTimeout(r,25));return {pending:state.photoArchivePending,accepted:state.photoArchiveAccepted,bytes:state.photoArchiveBytes,timedOut:state.photoArchivePending>0};}
async function loadSharpPhotoArchive(){
  const sessionId=state.currentSession?.id;if(!sessionId)return [];
  // Normal end-of-scan path: the Blob objects returned by the compression
  // worker are already retained as compressed references in RAM, so avoid an
  // IndexedDB getAll() that could materialize hundreds of MB at once. DB is a
  // recovery fallback for a resumed/reloaded processing session.
  let rows=(state.photoArchiveEntries||[]).filter(x=>x?.blob&&x?.kind==='sharp-rgb-photo'&&String(x.sessionId)===String(sessionId));
  if(!rows.length)try{if(state.db)rows=(await state.db.getAll('events')).filter(x=>x?.kind==='sharp-rgb-photo'&&String(x.sessionId)===String(sessionId));}catch(err){log.warn('sharp-photo-archive-load',{message:err?.message||String(err)});}
  const byId=new Map(rows.map(x=>[String(x.id),x]));for(const x of state.photoArchiveMemoryFallback||[])if(String(x.sessionId)===String(sessionId)&&!byId.has(String(x.id)))byId.set(String(x.id),x);
  rows=[...byId.values()].filter(x=>x?.blob&&x?.pose?.p&&x?.pose?.q).sort((a,b)=>(Number(a.at)||0)-(Number(b.at)||0));return rows;
}
function selectSharpPhotosForProcessing(rows,maxFrames=300){
  const valid=(rows||[]).filter(r=>!r?.trackingRejected&&!state.alvaQuarantinedFrameIds?.has?.(String(r?.frameId||''))&&!r?.stability?.jumpSuspect);
  return selectGeometricPhotoSubset(valid,maxFrames);
}
function ensurePhotoPreprocessWorker(){
  if(state.photoPreprocessWorker)return state.photoPreprocessWorker;try{const worker=new Worker(`${CONFIG.photoPreprocessWorker||'workers/photo_preprocess_worker.js'}?v=${BUILD.version}`,{type:'module'});state.photoPreprocessWorker=worker;worker.onmessage=e=>{const d=e.data||{},slot=state.photoPreprocessPending.get(String(d.id||''));if(!slot)return;state.photoPreprocessPending.delete(String(d.id));if(d.type==='decode-photo-error')slot.reject(new Error(d.message||'photo preprocess failed'));else{if(d.resizeCacheHit===true)state.photoResizeCacheHits++;else if(d.resizeCacheHit===false)state.photoResizeCacheMisses++;slot.resolve(d);}};worker.onerror=e=>{log.warn('photo-preprocess-worker',{message:e?.message||'worker error'});};return worker;}catch(err){log.warn('photo-preprocess-worker-init',{message:err?.message||String(err)});return null;}
}
function decodeSharpPhotoInWorker(record,{deepShortSide=0}={}){
  const worker=ensurePhotoPreprocessWorker();if(!worker||!record?.blob)return null;const id=`prep-${++state.photoPreprocessSeq}-${record.id||record.frameId}`;return new Promise((resolve,reject)=>{state.photoPreprocessPending.set(id,{resolve,reject});worker.postMessage({type:'decode-photo',id,blob:record.blob,deepShortSide});});
}
async function decodeSharpPhotoRecord(record,{deepShortSide=0}={}){
  if(record?.rgba?.length&&record?.gray?.length){const out={...record,rgba:new Uint8ClampedArray(record.rgba),gray:new Uint8Array(record.gray)};if(deepShortSide>0){const workerOut=record?.blob?await decodeSharpPhotoInWorker(record,{deepShortSide}).catch(()=>null):null;if(workerOut?.deepRgba)return {...out,deepRgba:new Uint8ClampedArray(workerOut.deepRgba),deepWidth:workerOut.deepWidth,deepHeight:workerOut.deepHeight,resizeCacheHit:workerOut.resizeCacheHit};}return out;}
  if(!record?.blob)throw new Error('archived photo has no raster');const workerOut=await decodeSharpPhotoInWorker(record,{deepShortSide}).catch(err=>{log.warn('photo-preprocess-worker-fallback',{frameId:record.frameId,message:err?.message||String(err)});return null;});if(workerOut?.rgba){return {...record,width:workerOut.width,height:workerOut.height,rgba:new Uint8ClampedArray(workerOut.rgba),gray:new Uint8Array(workerOut.gray),deepRgba:workerOut.deepRgba?new Uint8ClampedArray(workerOut.deepRgba):null,deepWidth:workerOut.deepWidth||0,deepHeight:workerOut.deepHeight||0,resizeCacheHit:workerOut.resizeCacheHit,K:{...(record.K||state.scanK)}};}
  const bitmap=await createImageBitmap(record.blob),w=bitmap.width|0,h=bitmap.height|0,canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(w,h):document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close?.();const image=ctx.getImageData(0,0,w,h),rgba=new Uint8ClampedArray(image.data),gray=new Uint8Array(w*h);for(let i=0;i<gray.length;i++)gray[i]=Math.max(0,Math.min(255,Math.round(.299*rgba[4*i]+.587*rgba[4*i+1]+.114*rgba[4*i+2])));return {...record,width:w,height:h,rgba,gray,K:{...(record.K||state.scanK)}};
}
function archiveRecordToSurvey(record){
  let poseCov=record.poseCov||null;const jump=!!record.stability?.jumpSuspect;
  if(jump){const d=Array.isArray(poseCov?.diag)?poseCov.diag.slice(0,6):[];while(d.length<6)d.push(0);for(let i=0;i<3;i++)d[i]=Math.max(Number(d[i])||0,.02);for(let i=3;i<6;i++)d[i]=Math.max(Number(d[i])||0,.006);poseCov={...(poseCov||{}),diag:d,jumpSuspect:true};}
  return {id:`photo-archive-${record.frameId}`,frameId:String(record.frameId),captureAt:Number(record.captureAt??record.at),at:Number(record.at??record.captureAt),pose:record.pose?{p:[...record.pose.p],q:[...record.pose.q]}:null,poseCov,K:{...(record.K||state.scanK)},width:record.width,height:record.height,gray:record.gray,rgba:record.rgba,features:record.features||[],metricLocked:!!record.metricLocked,trackingMode:jump?'alvaar-archive-jump-suspect':(record.trackingMode||'alvaar-archive'),trackingValid:true,depthCandidate:true,depthPlanned:false,photoQuality:record.photoQuality||null,stability:record.stability||null};
}
function requestLiveDeepPreview(frame,tracking){
  // V30.49: first archive every camera-still Alva-valid frame to compressed
  // IndexedDB. The bounded in-memory bank below remains only a fast fallback /
  // diagnostic reservoir; it is no longer the acquisition limit.
  archiveSharpRgbFrame(frame,tracking);
  // V30.48: the Scan lane no longer decides which frames deserve Deep. It
  // simply saves every sufficiently still, Alva-valid camera frame into a
  // bounded photo bank. Matching + Deep happen only after stopCaptureFastLane().
  if(CONFIG.stablePhotoBankEnabled===false||!state.stablePhotoBank||!state.scanK)return;
  const result=state.stablePhotoBank.consider(frame,tracking,state.scanK,{metricLocked:!!state.slam?.metricLocked});
  if(!result.ok){
    if(result.reason==='camera-moving'&&state.fastLaneFrames%32===0)log.debug('stable-photo-rejected-motion',{frameId:frame?.frameId||null,motion:result.motion||null,bank:state.stablePhotoBank.stats()});
    return;
  }
  const photo=result.entry;state.photoSurveyLastAt=photo.at;
  const stats=result.stats||state.stablePhotoBank.stats();
  if($('deepLiveState'))$('deepLiveState').textContent=`FOTO STABILI ${stats.frames}/${stats.maxFrames} · ${(stats.bytes/1048576).toFixed(0)} MB · Deep dopo Fine`;
  log.debug('stable-photo-captured',{frameId:photo.frameId,at:photo.at,size:[photo.width,photo.height],detail:result.detail,stableQuality:photo.photoQuality?.stableQuality,motion:result.motion,jump:result.jump,replaced:result.replaced||null,bank:stats});
  if(result.jump?.suspect)log.warn('stable-photo-alva-jump-suspect',{frameId:photo.frameId,translation:result.jump.translation,rotationRad:result.jump.rotationRad,dtMs:result.jump.dtMs,pose:photo.pose});
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
  // V30.46: no plane sweep during acquisition. Only a throttled sparse
  // triangulation pass runs on the main graph; MVS payloads are retained for
  // post-scan execution after the RGB pose scaffold has been reconciled.
  void scheduleSparseGeometryWork();
}
async function scheduleDenseWork(){return state.scanStop?scheduleSparseGeometryWork():false;}
async function scheduleSparseGeometryWork(){
  if(!state.denseManager||state.sparseBusy||!state.scanStop)return false;const now=performance.now(),minGap=Math.max(900,Number(CONFIG.sparseFastLaneMinIntervalMs)||2600);if(now-(state.sparseLastAt||0)<minGap)return false;
  const job=state.denseManager.nextJob();if(!job)return false;state.sparseBusy=true;state.sparseLastAt=now;
  try{
    const payload=await makeDensePayload(job);if(!payload)return false;
    payload.jobId=`sparse-${++state.sparseJobs}`;stripDeepRaster(payload);const retained=retainPostScanMvsPayload(payload);
    log.info('mvs-postscan-planned',{jobId:payload.jobId,frameId:payload.ref?.frameId||null,sparseSeeds:payload.sparseSeeds?.length||0,retained:retained.ok,replaced:retained.replaced||null,queue:state.postScanMvsPayloads.length,fastLaneAgeMs:state.fastLaneLastAt?Math.max(0,performance.now()-state.fastLaneLastAt):null});
    if($('mvsState'))$('mvsState').textContent=`RGB sparse ${state.sparseJobs} · MVS post-scan ${state.postScanMvsPayloads.length}`;return true;
  }catch(err){log.warn('sparse-fastlane-work',{message:err?.message||String(err),stack:err?.stack||null});return false;}finally{state.denseManager?.release?.(job.ref.id);state.sparseBusy=false;}
}
async function makeDensePayload(job){
  const {buildSparseDepthAnchors}=await lazy('./dense/sparse_depth_anchors.js');
  // Keep a wider source pool for the post-scan plane sweep.  Sparse anchor
  // extraction during acquisition remains cheap: it only uses the small live
  // source subset.  After the global RGB solve we can re-triangulate and use
  // all retained views without stealing camera/Alva time.
  const sourcePoolLimit=Math.max(state.denseSourceLimit||2,Number(CONFIG.postScanMvsSourcePool)||4),selectedSources=job.sources.slice(0,sourcePoolLimit),sparseSources=selectedSources.slice(0,Math.max(2,Math.min(selectedSources.length,state.denseSourceLimit||2))),metric=!!state.slam?.metricLocked;
  const sparse=buildSparseDepthAnchors(job.ref,sparseSources,{maxReprojectionPx:CONFIG.denseSeedMaxReprojectionPx||2.8,minAngleRad:CONFIG.denseSeedMinAngleRad||.001,maxGapBaselineRatio:CONFIG.denseSeedMaxGapBaselineRatio||.14});
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
  const sparseSeeds=serializeSparseSeeds(sparse.seeds);
  log.info('probabilistic-sparse-evidence',{ref:job.ref.id,seeds:sparseSeeds.length,range:!!sparse.range,matched:sparse.stats?.matched||0,triangulated:sparse.stats?.triangulated||0,meanProbability:sparseSeeds.length?sparseSeeds.reduce((a,x)=>a+(x.geometryProbability||0),0)/sparseSeeds.length:0});
  return {type:'depth',ref:cloneDenseFrame(job.ref,true),sources:selectedSources.map(x=>cloneDenseFrame(x,false)),K:job.ref.K,near,far,sparseSeeds,probabilistic:true,config:{depthSteps:CONFIG.denseDepthSteps||64,pixelStep:state.densePixelStep||CONFIG.densePixelStep||3,minTexture:CONFIG.denseMinTexture||.018,minDistinctiveness:CONFIG.denseMinDistinctiveness||.025,minViews:Math.min(CONFIG.denseMinSourceViews||2,selectedSources.length),seedRadiusPx:CONFIG.denseSeedRadiusPx||22,seedMaxRelativeError:CONFIG.denseSeedMaxRelativeError||.48,patchRadius:2}};
}
function cloneDenseFrame(f,includeDeep=false){const out={id:f.id,frameId:f.frameId||f.id,captureAt:f.captureAt??f.at,at:f.at,pose:f.pose,poseCov:f.poseCov||null,K:f.K,width:f.width,height:f.height,gray:f.gray,rgba:f.rgba,features:f.features||[]};if(includeDeep&&f.deepRgba?.length){out.deepWidth=f.deepWidth;out.deepHeight=f.deepHeight;out.deepRgba=f.deepRgba;}return out;}
function planLateDeepFromPayload(payload){
  const baseDecision=state.deepSelector?.evaluate({ref:payload.ref,sparseSeeds:payload.sparseSeeds,metricLocked:!!state.slam?.metricLocked})||{infer:false,reason:'selector-unavailable'},forceEvery=CONFIG.deepInferEveryDenseKeyframe===true,decision=forceEvery&&!baseDecision.infer?{...baseDecision,infer:true,reason:'accepted-dense-keyframe'}:baseDecision;
  if(state.deepDisabled||!decision.infer)return {ok:false,reason:decision.reason||'selector-rejected'};
  const planGate=lateDeepPlanGate(Number(payload.ref?.at)||performance.now());if(!planGate.ok){log.debug('deep-plan-backpressure',{frameId:payload.ref?.frameId||null,reason:decision.reason,queueFraction:planGate.fraction,waitRemainingMs:Math.max(0,planGate.interval-planGate.elapsed)});return {ok:false,reason:'deep-plan-backpressure'};}
  const useDeepRaster=payload.ref.deepRgba?.length>0,source=useDeepRaster?payload.ref.deepRgba:payload.ref.rgba,sourceWidth=useDeepRaster?payload.ref.deepWidth:payload.ref.width,sourceHeight=useDeepRaster?payload.ref.deepHeight:payload.ref.height;
  const queued=enqueueLateDeepJob({jobId:`deep-${payload.ref.frameId}`,kind:'keyframe',frameId:payload.ref.frameId,frameAt:payload.ref.at,refId:payload.ref.id,rgba:new Uint8ClampedArray(source),width:sourceWidth,height:sourceHeight,payload,tracking:{pose:payload.ref.pose,featureCount:payload.ref.features?.length||0,anchorCount:payload.sparseSeeds.length}});
  if(queued.ok){state.deepSelector?.noteAttempt?.(payload.ref,payload.sparseSeeds);const survey=denseKeyframeSurvey(payload.ref);if(survey)registerDepthPlannedPhoto(survey,{source:'dense-keyframe-depth-planned'});log.info('deep-depth-planned',{jobId:`deep-${payload.ref.frameId}`,refId:payload.ref.id,frameId:payload.ref.frameId,reason:decision.reason,anchors:payload.sparseSeeds.length,cells:decision.cells,queue:state.deepLateQueue?.stats?.()||null});}
  return queued;
}
function serializeSparseSeeds(seeds){return (seeds||[]).map(x=>({u:x.u,v:x.v,depth:x.depth,p:x.p,confidence:x.confidence,geometryProbability:x.geometryProbability??x.confidence,matchProbability:x.matchProbability??null,relativeDepthSigma:x.relativeDepthSigma??null,calibrationWeight:x.calibrationWeight??null,reprojectionPx:x.reprojectionPx,angle:x.angle??null,viewSupport:x.viewSupport||1,sourceIds:x.sourceIds||[],trackId:x.trackId||null,sigmaDepth:x.sigmaDepth||null,worldSigma:x.worldSigma||null,covariance:x.covariance||null,descriptor:x.descriptor||null,measurements:x.measurements||[],evidenceFrames:x.evidenceFrames||[]}));}
async function refreshPostScanMvsGeometry(payload){
  if(!payload?.ref?.pose||!(payload.sources?.length))return {ok:false,reason:'missing-final-pose-sources'};
  try{
    const {buildSparseDepthAnchors}=await lazy('./dense/sparse_depth_anchors.js'),sources=payload.sources.slice(0,Math.max(2,Number(CONFIG.postScanMvsSourcePool)||4)),sparse=buildSparseDepthAnchors(payload.ref,sources,{maxReprojectionPx:CONFIG.denseSeedMaxReprojectionPx||2.8,minAngleRad:CONFIG.denseSeedMinAngleRad||.001,maxGapBaselineRatio:CONFIG.denseSeedMaxGapBaselineRatio||.14});
    payload.sources=sources;payload.sparseSeeds=serializeSparseSeeds(sparse.seeds);
    // Capture-time sparse ranges are invalid after the global pose scaffold has
    // moved.  Recompute them from the rebound poses; if no trustworthy sparse
    // range survives, deliberately return to a broad metric search interval.
    if(sparse.range){payload.near=sparse.range.near;payload.far=sparse.range.far;}
    else{payload.near=CONFIG.denseNearM||.28;payload.far=Math.min(CONFIG.denseFarM||8.5,8.5);}
    if(!(payload.far>payload.near*1.25))payload.far=Math.min(10,payload.near*2.2);
    state.postScanMvsRefreshed++;const out={ok:true,seeds:payload.sparseSeeds.length,matched:sparse.stats?.matched||0,triangulated:sparse.stats?.triangulated||0,near:payload.near,far:payload.far,sources:sources.length};log.debug('mvs-postscan-sparse-refreshed',{frameId:payload.ref.frameId,...out});return out;
  }catch(err){state.postScanMvsRefreshFailed++;const out={ok:false,reason:err?.message||String(err)};log.warn('mvs-postscan-sparse-refresh-failed',{frameId:payload?.ref?.frameId||null,...out});return out;}
}
async function dispatchDensePayload(payload){
  stripDeepRaster(payload);state.denseActivePayload=payload;state.denseBusy=true;state.denseDepthWorker.postMessage(payload);
  log.info('mvs-postscan-dispatch',{jobId:payload.jobId,refId:payload.ref.id,frameId:payload.ref.frameId,queueRemaining:state.postScanMvsPayloads.length,deepQueue:state.deepLateQueue?.stats?.()||null});
  if($('mvsState'))$('mvsState').textContent=`MVS post-scan ${state.denseJobs} · Deep coda ${state.deepLateQueue?.stats?.().queued||0}`;
}
function stripDeepRaster(payload){if(!payload?.ref)return;delete payload.ref.deepRgba;delete payload.ref.deepWidth;delete payload.ref.deepHeight;}
function retainPostScanMvsPayload(payload){
  const max=Math.max(8,Number(CONFIG.postScanMvsMaxJobs)||48),id=String(payload?.ref?.frameId||'');if(!id)return {ok:false,reason:'missing-frame-id'};const old=state.postScanMvsPayloads.findIndex(x=>String(x?.ref?.frameId||'')===id);if(old>=0){state.postScanMvsPayloads[old]=payload;return {ok:true,deduplicated:true};}
  if(state.postScanMvsPayloads.length<max){state.postScanMvsPayloads.push(payload);return {ok:true};}
  const all=[...state.postScanMvsPayloads,payload],scores=all.map((x,i)=>postScanMvsNovelty(x,all,i)),candidateIndex=all.length-1;let remove=1,best=Infinity;for(let i=1;i<all.length-1;i++)if(scores[i]<best){best=scores[i];remove=i;}const candidateScore=scores[candidateIndex];
  if(candidateScore<=best){state.postScanMvsDropped++;return {ok:false,reason:'reservoir-redundant',candidateScore,best};}
  const removed=state.postScanMvsPayloads[remove];state.postScanMvsPayloads[remove]=payload;state.postScanMvsReplaced++;return {ok:true,replaced:removed?.ref?.frameId||null,candidateScore,best};
}
function postScanMvsNovelty(payload,all,index){const p=payload?.ref?.pose,t=Number(payload?.ref?.at)||0;if(!p?.p||!p?.q)return 0;let best=Infinity;for(let j=0;j<all.length;j++){if(j===index)continue;const q=all[j]?.ref?.pose;if(!q?.p||!q?.q)continue;const tr=Math.hypot(p.p[0]-q.p[0],p.p[1]-q.p[1],p.p[2]-q.p[2]),dot=Math.abs(p.q[0]*q.q[0]+p.q[1]*q.q[1]+p.q[2]*q.q[2]+p.q[3]*q.q[3]),rot=2*Math.acos(Math.max(-1,Math.min(1,dot))),dt=Math.abs(t-(Number(all[j]?.ref?.at)||0));best=Math.min(best,tr/.10+rot/.10+Math.min(1,dt/12000)*.18);}return Number.isFinite(best)?best:1e6;}
function applySnapshotToPostScanMvs(snapshot){const pm=new Map((snapshot?.frames||[]).map(f=>[String(f.frameId),f.poseEstimate]));let updated=0;for(const payload of state.postScanMvsPayloads||[]){for(const f of [payload.ref,...(payload.sources||[])]){const pose=pm.get(String(f?.frameId||''));if(pose){f.pose={p:pose.p.slice(),q:pose.q.slice()};updated++;}}}log.info('mvs-postscan-pose-rebound',{payloads:state.postScanMvsPayloads.length,updatedPoses:updated,snapshotFrames:pm.size});}
async function drainPostScanMvsBacklog(snapshot=null){
  if(!state.denseDepthWorker||!state.postScanMvsPayloads.length)return {processed:0,queued:state.postScanMvsPayloads.length};applySnapshotToPostScanMvs(snapshot);state.postScanMvsDrainActive=true;const queue=state.postScanMvsPayloads.slice().sort((a,b)=>(Number(a.ref?.at)||0)-(Number(b.ref?.at)||0)),started=performance.now();let processed=0,timeouts=0;log.info('mvs-postscan-drain-start',{queued:queue.length,sparseJobs:state.sparseJobs,poseRebound:!!snapshot});
  for(let qi=0;qi<queue.length;qi++){const payload=queue[qi];if(!payload?.ref)continue;if(state.processingActive){const survey=denseKeyframeSurvey(payload.ref);if(survey)showProcessingFrame(survey,qi,queue.length,{phase:'mvs',message:`MVS ${qi+1}/${queue.length} · ${payload.ref.frameId}`});else processingSetPhase('mvs',{index:qi+1,total:queue.length,message:`MVS ${qi+1}/${queue.length}`});}await waitForDenseIdle(20000);const refreshed=await refreshPostScanMvsGeometry(payload);payload.jobId=`mvs-post-${++state.denseJobs}`;await dispatchDensePayload(payload);const deadline=performance.now()+Math.max(3000,Number(CONFIG.postScanMvsJobTimeoutMs)||18000);while(state.denseBusy&&performance.now()<deadline)await new Promise(r=>setTimeout(r,30));if(state.denseBusy){timeouts++;state.denseBusy=false;state.denseActivePayload=null;log.warn('mvs-postscan-timeout',{jobId:payload.jobId,frameId:payload.ref.frameId,refreshed});}else processed++;state.stablePhotoProcessingMvsDone=processed;await new Promise(r=>setTimeout(r,0));}
  state.postScanMvsDrainActive=false;state.postScanMvsPayloads=[];const out={processed,timeouts,refreshed:state.postScanMvsRefreshed,refreshFailed:state.postScanMvsRefreshFailed,elapsedMs:performance.now()-started,mvsSamples:state.denseDepthSamples};log.info('mvs-postscan-drain-complete',out);return out;
}
async function reconcilePostScanRgbScaffold(){
  if(!state.probGraph)return null;const panorama=state.liveMap?.exportState?.()||null;if(panorama?.edges?.length)state.probGraph.addPhotoEdges?.(panorama.edges);const runtime=await ensureSingleOptimizerRuntime(),graph=state.probGraph.exportState(),result=await runtime.reconcileRgbScaffold?.(graph,{passes:CONFIG.postScanRgbScaffoldPasses||18,globalLinePasses:CONFIG.postScanRgbGlobalLinePasses||36,optimizer:{localWindowSize:CONFIG.postOptimizeLocalWindowFrames||20,localWindowOverlap:CONFIG.postOptimizeLocalWindowOverlap||6}});state.postScanRgbScaffold=result?{accepted:!!result.accepted,policy:result.candidatePolicy||result.baselinePolicy||null,stats:result.stats||null}:null;log.checkpoint('postscan-rgb-scaffold',{accepted:!!result?.accepted,policy:result?.candidatePolicy||result?.baselinePolicy||null,stats:result?.stats||null,photoAudit:state.probGraph.photoEdgeAudit||null});return result;
}

async function handleDeepDepthMessage(d){
  if(d.type==='deep-ready'){state.deepBatchProtocol=d.batchProtocol||null;log.info('deep-depth-ready',{modelUrl:d.modelUrl,preferredShortSide:d.preferredShortSide,qualityRescueShortSide:d.qualityRescueShortSide,batchProtocol:state.deepBatchProtocol||null,microbatchCapable:state.deepBatchProtocol===CONFIG.adaptiveDeepMicrobatchRequiresProtocol,microbatchActive:false,microbatchReason:state.deepBatchProtocol===CONFIG.adaptiveDeepMicrobatchRequiresProtocol?'throughput-not-benchmarked':'worker-protocol-unsupported'});return;}
  if(d.type==='deep-loaded'){log.info('deep-depth-loaded',{model:d.model,provider:d.provider,input:d.input});return;}
  if(d.type==='deep-preview-queued')return;
  if(d.type==='deep-preview-error'||d.type==='deep-error'){
    const binding=state.deepJobs.get(String(d.jobId||''));
    log.warn('deep-late-error',{jobId:d.jobId,frameId:d.frameId||binding?.frameId||null,kind:binding?.kind||null,message:d.message,provider:d.provider,ms:d.ms,fastLaneActive:!!state.scanStop});
    state.deepSelector?.fail?.();finishDeepLaneJob(d.jobId,{failed:true});state.deepJobs.delete(String(d.jobId||''));
    if($('deepLiveState'))$('deepLiveState').textContent=`DEEP POST · errore ${d.message||'inferenza'} · continuo RGB/MVS`;
    return;
  }
  if(d.type!=='deep-result')return;
  const binding=state.deepJobs.get(String(d.jobId||'')),sync=state.deepSync?.validateDeepFrameResult?.(d,binding)||{ok:false,reason:'sync-module-missing'};
  if(!sync.ok){
    state.deepSyncRejected++;log.error('deep-frame-sync-rejected',{jobId:d.jobId,resultFrameId:d.frameId||null,boundFrameId:binding?.frameId||null,refId:d.refId||null,boundRefId:binding?.refId||null,reason:sync.reason,deltaMs:sync.deltaMs??null,resultSignature:d.frameSignature||null,boundSignature:binding?.frameSignature||null});
    finishDeepLaneJob(d.jobId,{failed:true});state.deepJobs.delete(String(d.jobId||''));return;
  }
  try{
    const lag=Math.max(0,performance.now()-binding.frameAt);log.info('deep-frame-sync-ok',{jobId:d.jobId,frameId:binding.frameId,refId:binding.refId||null,kind:binding.kind,frameSignature:binding.frameSignature,featureCount:binding.tracking?.featureCount||0,anchors:binding.tracking?.anchorCount||0,completionLagMs:lag,postScan:!state.scanStop});
    if(binding.kind==='preview'){
      state.deepPreviewFrames++;state.deepPreviewLastQuality=d.quality||null;drawDepth($('depthOverlay'),d.rawDepth,d.rawWidth,d.rawHeight);
      const survey=binding.survey,q=d.quality||{};if(survey&&state.processingActive)showProcessingDeepResult(survey,d);const attached=survey?attachLateDepthToPhoto(survey,d,{source:'deep-postscan-survey'}):null;
      state.probGraph?.addDeepRaw?.(binding.frameId,{rawDepth:d.rawDepth,rawWidth:d.rawWidth,rawHeight:d.rawHeight,calibration:null,quality:q});
      state.liveOptDirty=true;state.liveOptPendingSlow=true;state.liveOptLastReason='survey-depth-late';
      const stripe=q.stripe||{},band=Math.round(100*Number(stripe.dominantExplained||0)),warning=stripe.suspicious?`banding ${band}%`:`coerenza ${Number(q.coherenceRatio||0).toFixed(2)}`;
      if($('deepLiveState'))$('deepLiveState').textContent=`DEEP POST ${attached?.ok?'✓':'⚠'} · ${warning} · lag ${(lag/1000).toFixed(1)} s`;
      log.info('deep-late-photo-bound',{jobId:d.jobId,frameId:binding.frameId,kind:'survey',attached:!!attached?.ok,lateBound:!!attached?.lateBound,lagMs:lag,provider:d.provider,aiMs:d.ms,quality:q});
    }else{
      const payload=binding.payload;if(!payload){state.deepSyncRejected++;log.error('deep-frame-payload-missing',{jobId:d.jobId,frameId:binding.frameId});return;}
      await applyDeepDepthResult(d,payload,{lateBound:true});
    }
  }finally{
    finishDeepLaneJob(d.jobId);state.deepJobs.delete(String(d.jobId||''));
  }
}
async function applyDeepDepthResult(d,payload,{lateBound=true}={}){
  if(String(d?.frameId||'')!==String(payload?.ref?.frameId||'')){state.deepSyncRejected++;log.error('deep-frame-sync-defense',{jobId:d?.jobId||null,resultFrameId:d?.frameId||null,payloadFrameId:payload?.ref?.frameId||null});return;}
  drawDepth($('depthOverlay'),d.rawDepth,d.rawWidth,d.rawHeight);
  const denseSurvey=denseKeyframeSurvey(payload.ref);if(denseSurvey&&state.processingActive)showProcessingDeepResult(denseSurvey,d);const depthAttach=denseSurvey?attachLateDepthToPhoto(denseSurvey,d,{source:'deep-postscan-keyframe'}):null;
  if(depthAttach?.ok)log.info('deep-keyframe-photo-late-bound',{jobId:d.jobId,frameId:payload.ref.frameId,rawDepth:[d.rawWidth,d.rawHeight],lateBound:!!depthAttach.lateBound,mosaicFrames:state.liveMap?.stats?.()?.frames||null,mosaicEdges:state.liveMap?.stats?.()?.edges||null});
  // V30.45 deliberately stores RAW relative depth only. Any metric mapping made
  // here from payload.sparseSeeds would use capture-time geometry and could be
  // stale after RGB pose optimisation. Hierarchical calibration is recomputed
  // later by ProbabilisticJointOptimizer from the current/final pose scaffold.
  state.probGraph?.addDeepRaw(payload.ref.frameId,{rawDepth:d.rawDepth,rawWidth:d.rawWidth,rawHeight:d.rawHeight,calibration:null,quality:d.quality,lateBound:true});
  state.liveOptDirty=true;state.liveOptPendingSlow=true;state.liveOptLastReason=d.quality?.suspicious?'deep-suspicious-late':'deep-raw-late';
  if(d.quality?.suspicious){state.deepSelector?.fail?.();const band=Math.round(100*Number(d.quality?.stripe?.dominantExplained||0));log.warn('deep-depth-quality-rejected',{jobId:d.jobId,quality:d.quality,resolutionRescue:d.resolutionRescue||null,lateBound,metricCalibrationDeferred:true});if($('mvsState'))$('mvsState').textContent=`Deep post-scan anomala (${band}% banding) · raw salvata a bassa autorità`;return;}
  state.deepSelector?.commit?.(payload.ref,payload.sparseSeeds);state.deepAccepted++;
  log.info('deep-late-raw-bound',{jobId:d.jobId,provider:d.provider,aiMs:d.ms,frameId:payload.ref.frameId,anchorsAtCapture:payload.sparseSeeds?.length||0,metricCalibrationDeferred:true,lateBound:true});
  if($('mvsState'))$('mvsState').textContent='Deep post-scan ✓ · raw associata al frame · calibrazione su pose finali';
}
function clampNumber(v,a,b){return Math.max(a,Math.min(b,v));}
async function handleDenseDepthMessage(d){
  if(d.type==='ready'){if($('mvsState'))$('mvsState').textContent='PROXY mapper pronto · Deep+track+multi-view';return;}
  if(d.type==='depth-error'){
    state.denseBusy=false;state.denseActivePayload=null;log.warn('dense-depth',{jobId:d.jobId,message:d.message,stack:d.stack||null});if($('mvsState'))$('mvsState').textContent='Refinement multi-view fallito · continuo';if(!state.postScanMvsDrainActive)void scheduleDenseWork();return;
  }
  if(d.type!=='depth-result')return;
  const payload=state.denseActivePayload&&state.denseActivePayload.jobId===d.jobId?state.denseActivePayload:null;state.denseActivePayload=null;state.denseBusy=false;
  if(d.medianDepth){state.denseDepthHint=state.denseDepthHint?state.denseDepthHint*.7+d.medianDepth*.3:d.medianDepth;state.liveMap?.setFallbackDepth(state.denseDepthHint);}
  state.denseDepthSamples+=d.samples?.length||0;if(d.samples?.length&&state.liveMap){state.liveMap.addWorldSamples(d.samples,{maxAdd:CONFIG.livePuzzleMvsAdd||700,source:'mvs'});scheduleLiveMapRender();}if(payload?.ref){state.probGraph?.addMvs(payload.ref.frameId,d.samples||[],{sourceFrames:(payload.sources||[]).map(x=>x.frameId||x.id),estimatedPose:payload.ref.pose||null,sourceEstimatePoses:Object.fromEntries((payload.sources||[]).map(x=>[String(x.frameId||x.id),x.pose||null]).filter(([,pose])=>pose)),evidenceBuild:BUILD.id,stage:state.postScanMvsDrainActive?'postscan-final-pose':'live-sparse',scaffoldId:state.postScanRgbScaffold?.stats?.scaffoldId||null});if(d.samples?.length&&!state.postScanMvsDrainActive)scheduleLiveOptimization('mvs-evidence',{slow:false});}if(d.ms>1800){state.densePixelStep=Math.min(5,(state.densePixelStep||3)+1);state.denseSourceLimit=2;}else if(d.ms<650){state.densePixelStep=Math.max(3,(state.densePixelStep||3)-1);state.denseSourceLimit=Math.min(3,CONFIG.denseMaxSourceViews||4);}if($('statTri'))$('statTri').textContent=String(state.denseDepthSamples);

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
  if(!state.postScanMvsDrainActive)void scheduleDenseWork();
}
let proxySamplerPromise=null;
function awaitImportProxySampler(){return proxySamplerPromise||(proxySamplerPromise=lazy('./dense/deep_ray_samples.js'));}
function handleDenseFusionMessage(d){
  if(d.type==='ready'){if($('metricPipelineHud'))$('metricPipelineHud').textContent='Surface mapper pronto · attendo depth map.';return;}
  if(d.type==='fusion-error'){log.warn('dense-fusion',{message:d.message,stack:d.stack||null});return;}
  if(d.type!=='surface-result'&&d.type!=='surface-snapshot'&&d.type!=='mesh-result')return;
  if(d.splats?.length){state.denseCandidateGaussians=d.splats;const validated=state.liveOptPreviewGaussians||[];state.liveOverlay?.setGaussians(validated);if($('statGs'))$('statGs').textContent=validated.length?`${validated.length} validati`:`0 validati (${d.splats.length} candidati)`;}
  // The dense worker runs on acquisition-time poses. Its mesh is useful as a
  // diagnostic candidate, but it must never become authoritative geometry or
  // remain in AR after the joint optimizer moves the cameras.
  if(d.mesh?.vertices?.length)state.denseCandidateMesh=d.mesh;
  if(d.type==='mesh-result'&&d.vertices?.length)state.denseCandidateMesh=d;
  state.surfaceStats={frames:d.frames??state.surfaceStats?.frames??0,surfels:d.surfels??state.surfaceStats?.surfels??0,tsdfVoxels:d.tsdfVoxels??state.surfaceStats?.tsdfVoxels??0,confirmed:d.confirmed??d.splats?.length??state.surfaceStats?.confirmed??0};
  const candidateFaces=state.denseCandidateMesh?.faces?.length?state.denseCandidateMesh.faces.length/3:0,unit=state.slam?.metricLocked?'m':'u.Alva';
  if($('metricPipelineHud'))$('metricPipelineHud').textContent=`RAY CONSENSUS ${state.denseJobs} viste · candidati ${state.surfaceStats.confirmed||0}/${state.surfaceStats.surfels||0} · TSDF raw ${state.surfaceStats.tsdfVoxels||0} · mesh candidata ${candidateFaces} facce · ${unit}`;
}
async function waitForDenseIdle(timeoutMs=4500){const start=performance.now();while(state.denseBusy&&performance.now()-start<timeoutMs)await new Promise(r=>setTimeout(r,35));}
function workerRequest(worker,message,accept,timeoutMs=3500){return new Promise(resolve=>{if(!worker)return resolve(null);const timer=setTimeout(()=>{worker.removeEventListener('message',handler);resolve(null);},timeoutMs),handler=e=>{if(!accept(e.data||{}))return;clearTimeout(timer);worker.removeEventListener('message',handler);resolve(e.data||null);};worker.addEventListener('message',handler);worker.postMessage(message);});}
function optimizerReprojectionStats(st){
  const robust=Number(st?.reprojectionRobustRmse),raw=Number(st?.reprojectionRmse),median=Number(st?.reprojectionMedianPx),p90=Number(st?.reprojectionP90Px);
  return {robust:Number.isFinite(robust)?robust:null,raw:Number.isFinite(raw)?raw:null,median:Number.isFinite(median)?median:null,p90:Number.isFinite(p90)?p90:null};
}
function optimizerPhaseLabel(st){return st?.feedbackPhase==='depth-feedback'?'Deep/confidenza':st?.feedbackPhase==='rgb-bootstrap'?'bootstrap RGB':'RGB/pose';}
function optimizerReprojectionLabel(st){const r=optimizerReprojectionStats(st);if(r.robust!=null)return `${r.robust.toFixed(2)} px robust${r.raw!=null?` · raw ${r.raw.toFixed(1)}`:''}`;if(r.raw!=null)return `${r.raw.toFixed(2)} px raw`;return '—';}
function updateLiveOptimizerHud(extra=null){
  const el=$('liveOptimizerHud');if(!el)return;if(extra){el.textContent=extra;return;}const st=state.liveOptStats||state.liveOptCandidateStats,g=state.liveOptGate;if(!state.liveOptReady){el.textContent='OPT UNICO · inizializzazione…';return;}if(state.liveOptInFlight){el.textContent=`OPT UNICO · ${state.liveOptLastReason||'aggiornamento'} · working…`;return;}if(!st){el.textContent='OPT UNICO · attendo scaffold RGB triangolabile';return;}const phase=optimizerPhaseLabel(st),rmse=optimizerReprojectionLabel(st),score=Number.isFinite(g?.score)?` · gate ${g.score>=0?'+':''}${g.score.toFixed(2)}`:'';
  if(state.liveOptStalled){el.textContent=`OPT UNICO ⚠ · bootstrap fermo · ${rmse} · nuova evidenza richiesta`;return;}
  if(!state.liveOptStats&&state.liveOptWorkingRetained){el.textContent=`OPT UNICO · ${phase} interno · ${rmse} · preview invariata`;return;}
  el.textContent=`OPT UNICO ✓ · ${phase} · reproj ${rmse}${score} · acc ${state.liveOptAcceptedCount}/rej ${state.liveOptRejected}`;
}
function stopLiveOptimizer(){
  if(state.liveOptTimer){clearTimeout(state.liveOptTimer);state.liveOptTimer=null;}
  state.singleOptRuntime?.stop?.();state.liveOptInFlight=false;state.liveOptDirty=false;state.liveOptPendingSlow=false;
  updateLiveOptimizerHud('OPT UNICO · fermo');
}
async function ensureSingleOptimizerRuntime(){
  if(state.singleOptRuntime){state.singleOptRuntime.resume?.();state.liveOptReady=true;return state.singleOptRuntime;}
  const mod=await lazy('./probabilistic/single_optimizer_runtime.js');state.singleOptModule=mod;
  state.singleOptRuntime=new mod.SingleOptimizerRuntime({initial:state.liveOptAccepted||state.probOptimization||null,onTrace:(event,data)=>{
    const generation=data?.generation??state.liveOptGeneration,traceId=`singleopt-${generation}`;
    if(event==='exception'||event==='rebuild-error'||event==='preview-map-error')log.error(`single-opt-${event}`,data,{traceId});
    else if(event==='mesh-quality'&&data?.status==='fragmented')log.warn('single-opt-mesh-quality',data,{traceId});
    else log.debug(`single-opt-${event}`,data,{traceId});
  }});
  state.liveOptReady=true;
  log.info('single-opt-runtime-ready',{optimizer:'ProbabilisticJointOptimizer',execution:'main-thread-timesliced',worker:false,legacyFallback:false,seeded:!!(state.liveOptAccepted||state.probOptimization)});
  updateLiveOptimizerHud();return state.singleOptRuntime;
}
function scheduleLiveOptimization(reason,{slow=false,force=false}={}){
  if(!state.probGraph||CONFIG.liveProbabilisticOptimization===false)return;const g=state.probGraph.summary?.()||{};state.liveOptLastReason=reason;state.liveOptDirty=true;state.liveOptPendingSlow=state.liveOptPendingSlow||!!slow;
  if(state.liveOptInFlight){log.debug('single-opt-coalesced',{reason,slow,graph:g});return;}
  const minFrames=CONFIG.liveOptMinFrames||2,minLandmarks=CONFIG.liveOptMinLandmarks||6;if((g.frames||0)<minFrames||(g.landmarks||0)<minLandmarks){log.debug('single-opt-deferred',{reason,cause:'insufficient-scaffold',graph:g});updateLiveOptimizerHud('OPT UNICO · attendo triangolazione RGB');return;}
  const now=performance.now(),baseGap=slow?(CONFIG.liveOptSlowMinIntervalMs||850):(CONFIG.liveOptFastMinIntervalMs||420),minGap=baseGap*Math.max(1,state.liveOptBackoff||1),wait=force?0:Math.max(0,minGap-(now-state.liveOptLastAt));if(state.liveOptTimer){clearTimeout(state.liveOptTimer);state.liveOptTimer=null;}state.liveOptTimer=setTimeout(()=>flushLiveOptimization(reason,{slow:state.liveOptPendingSlow||slow}),wait);log.debug('single-opt-scheduled',{reason,slow,waitMs:wait,backoff:state.liveOptBackoff,graph:g});
}
function flushLiveOptimization(reason,{slow=false}={}){void flushLiveOptimizationAsync(reason,{slow});}
async function flushLiveOptimizationAsync(reason,{slow=false}={}){
  state.liveOptTimer=null;slow=!!(slow||state.liveOptPendingSlow);state.liveOptPendingSlow=false;if(!state.probGraph)return;
  const fullSummaryBefore=state.probGraph.summary?.()||{};if((fullSummaryBefore.frames||0)<(CONFIG.liveOptMinFrames||2)||(fullSummaryBefore.landmarks||0)<(CONFIG.liveOptMinLandmarks||6))return;
  const runtime=await ensureSingleOptimizerRuntime();if(!runtime)return;
  state.liveOptInFlight=true;state.liveOptDirty=false;updateLiveOptimizerHud();
  // RGB mosaic edges are optional whole-edge evidence. Unposed RGB+Depth frames
  // stay outside the metric graph rather than receiving an invented 3-D pose.
  const panorama=state.liveMap?.exportState?.()||null,panoramaFrames=panorama?.frames||[],panoramaEdges=panorama?.edges||[],importedPhotoEdges=panoramaEdges.length?state.probGraph.addPhotoEdges?.(panoramaEdges)||0:0;
  const graphIds=new Set((state.probGraph.frames||[]).map(f=>String(f.frameId))),posedPhotoFrames=panoramaFrames.filter(f=>graphIds.has(String(f.frameId))).length,unposedPhotoFrames=Math.max(0,panoramaFrames.length-posedPhotoFrames);
  const fullSummary=state.probGraph.summary?.()||{},rawGraph=state.probGraph.exportState(),{buildLiveGraphWindow}=await lazy('./probabilistic/live_graph_window.js'),graph=buildLiveGraphWindow(rawGraph,{maxFrames:slow?(CONFIG.liveOptSlowGraphFrames||26):(CONFIG.liveOptFastGraphFrames||16),maxLoopFrames:CONFIG.liveOptGraphLoopFrames||6,recentLoopSeeds:6,includePhotoPixels:!!slow}),summary=graph.summary||{},generation=++state.liveOptGeneration,budgetMs=slow?(CONFIG.liveOptSlowBudgetMs||70):(CONFIG.liveOptFastBudgetMs||24),maxIterations=1;state.liveOptLastAt=performance.now();
  const audit={panoramaFrames:panoramaFrames.length,panoramaEdges:panoramaEdges.length,posedPhotoFrames,unposedPhotoFrames,importedPhotoEdges,factorFrames:fullSummary.frames,factorPhotoEdges:fullSummary.photoEdges,landmarks:fullSummary.landmarks,deepFrames:fullSummary.deepFrames,alvaEdges:fullSummary.alvaEdges};
  const rgbEdgeImportFraction=panoramaEdges.length?importedPhotoEdges/panoramaEdges.length:1;audit.rgbEdgeImportFraction=rgbEdgeImportFraction;if(panoramaEdges.length>=3&&rgbEdgeImportFraction<.35)log.warn('single-opt-rgb-edge-coverage-low',{panoramaFrames:panoramaFrames.length,panoramaEdges:panoramaEdges.length,importedPhotoEdges,posedPhotoFrames,unposedPhotoFrames,factorFrames:fullSummary.frames,landmarks:fullSummary.landmarks,explanation:'whole-photo RGB edges require both endpoints to have a metric pose node; sparse RGB landmark tracks remain active independently'});
  log.info('single-opt-cycle-dispatch',{generation,reason,slow,budgetMs,maxIterations,graph:summary,fullGraph:fullSummary,window:graph.windowDiagnostics||null,audit,acceptedSeed:!!state.liveOptAccepted,backoff:state.liveOptBackoff});
  log.checkpoint('single-opt-cycle-dispatch',{generation,reason,slow,frames:summary.frames,landmarks:summary.landmarks,deepFrames:summary.deepFrames,photoEdges:summary.photoEdges,alvaEdges:summary.alvaEdges,unposedPhotoFrames,windowFrames:graph.windowDiagnostics?.selectedFrames});
  const result=await runtime.runCycle({mode:slow?'live-slow':'live-fast',generation,reason,graph,budgetMs,maxIterations,maxPreviewLandmarks:CONFIG.liveOptPreviewLandmarks||320,maxPreviewAnchors:CONFIG.liveOptPreviewAnchors||90,previewMap:!!slow,previewVoxel:state.slam?.metricLocked?(CONFIG.liveOptPreviewVoxelM||.055):(CONFIG.liveOptPreviewVoxelAlva||.05),previewMaxSurfels:CONFIG.liveOptPreviewSurfels||2200,previewMaxTriangles:CONFIG.liveOptPreviewTriangles||900,previewMaxDeepSamples:CONFIG.liveOptPreviewDeepSamples||3200,previewMaxMvsSamples:CONFIG.liveOptPreviewMvsSamples||3800,options:{maxLandmarks:Math.min(CONFIG.liveOptMaxLandmarks||4500,CONFIG.probabilisticMaxLandmarks||12000),maxObsPerFrame:Math.min(CONFIG.liveOptMaxObsPerFrame||150,CONFIG.probabilisticMaxObsPerFrame||280),posePriorScale:CONFIG.probabilisticPosePriorScale||1,absoluteAlvaScale:CONFIG.probabilisticAbsoluteAlvaScale||.04,depthFeedbackEvery:slow?1:(CONFIG.liveOptDepthFeedbackEvery||3),rgbWarmupIterations:CONFIG.probabilisticRgbWarmupIterations||2,localWindowSize:CONFIG.liveOptLocalWindowSize||10,localWindowOverlap:CONFIG.liveOptLocalWindowOverlap||3},gateOptions:{maxReprojectionPx:CONFIG.liveOptGateMaxReprojectionPx||3.2,maxCommonTranslationJump:state.slam?.metricLocked?(CONFIG.liveOptGateMaxTranslationM||.11):(CONFIG.liveOptGateMaxTranslationAlva||.14),maxCommonRotationJumpRad:CONFIG.liveOptGateMaxRotationRad||.07,maxMeanTranslationJump:state.slam?.metricLocked?(CONFIG.liveOptGateMeanTranslationM||.045):(CONFIG.liveOptGateMeanTranslationAlva||.06)}});
  handleSingleOptimizerResult(result,audit);
}
function handleSingleOptimizerResult(d,audit=null){
  if(!d)return;
  if(d.type==='single-opt-error'){
    state.liveOptInFlight=false;state.liveOptStalled=false;log.error('single-opt-error',{generation:d.generation,trigger:d.trigger,message:d.message,stack:d.stack||null,elapsedMs:d.elapsedMs,graph:d.summary,audit});log.checkpoint('single-opt-error',{generation:d.generation,message:d.message,stack:d.stack||null,graph:d.summary,audit});persistEmergencyDiagnostics('single-opt-error');updateLiveOptimizerHud('OPT UNICO · ERRORE · vedi Log');return;
  }
  if(d.type==='single-opt-deferred'||d.type==='single-opt-stopped'){state.liveOptInFlight=false;log.debug(d.type,d);updateLiveOptimizerHud(d.type==='single-opt-deferred'?'OPT UNICO · scaffold insufficiente':'OPT UNICO · fermo');return;}
  if(d.type==='single-opt-stalled'){
    state.liveOptInFlight=false;state.liveOptRejected++;state.liveOptStalled=true;state.liveOptWorkingRetained=false;state.liveOptWorkingSnapshot=null;state.liveOptCandidateStats=d.stats||null;state.liveOptGate=d.gate||null;state.liveOptLastElapsedMs=Number(d.elapsedMs)||0;state.liveOptLastReason=d.trigger||state.liveOptLastReason;
    log.warn('single-opt-stalled',{generation:d.generation,trigger:d.trigger,stallCount:d.stallCount,bootstrap:!!d.bootstrap,gate:d.gate,workingGate:d.workingGate,progress:d.progress,baseline:d.baselineStats,candidate:d.stats,graph:d.summary,audit});log.checkpoint('single-opt-stalled',{generation:d.generation,reason:d.trigger,stallCount:d.stallCount,robustReprojectionPx:d.stats?.reprojectionRobustRmse,rawReprojectionPx:d.stats?.reprojectionRmse,medianPx:d.stats?.reprojectionMedianPx,p90Px:d.stats?.reprojectionP90Px,rgbEdges:d.stats?.edgeSwitches,hardReasons:d.gate?.hardReasons||[],audit});
    updateLiveOptimizerHud();return;
  }
  if(d.type==='single-opt-rejected'){
    state.liveOptInFlight=false;state.liveOptRejected++;state.liveOptStalled=false;state.liveOptLastElapsedMs=Number(d.elapsedMs)||0;state.liveOptBackoff=adaptLiveOptBackoff(state.liveOptBackoff,d.solveMs??d.elapsedMs,d.mapMs||0);state.liveOptGate=d.gate||null;state.liveOptCandidateStats=d.stats||null;state.liveOptWorkingRetained=!!d.workingRetained;state.liveOptWorkingSnapshot=d.workingSnapshot||null;state.liveOptLastReason=d.trigger||state.liveOptLastReason;
    log.warn('single-opt-candidate-rejected',{generation:d.generation,trigger:d.trigger,elapsedMs:d.elapsedMs,iterations:d.iterations,bootstrap:!!d.bootstrap,stallCount:d.stallCount,progress:d.progress||null,gate:d.gate,workingGate:d.workingGate||null,workingRetained:!!d.workingRetained,baseline:d.baselineStats,candidate:d.stats,steps:d.steps,graph:d.summary,audit});log.checkpoint('single-opt-rejected',{generation:d.generation,reason:d.trigger,accepted:false,workingRetained:!!d.workingRetained,bootstrap:!!d.bootstrap,robustReprojectionPx:d.stats?.reprojectionRobustRmse,rawReprojectionPx:d.stats?.reprojectionRmse,medianPx:d.stats?.reprojectionMedianPx,p90Px:d.stats?.reprojectionP90Px,deepRelativeError:d.stats?.deepRelativeError,hardReasons:d.gate?.hardReasons||[],audit});
    if(d.workingRetained)updateLiveOptimizerHud(`OPT UNICO · bootstrap RGB interno · ${optimizerReprojectionLabel(d.stats)} · preview invariata`);else updateLiveOptimizerHud(`OPT UNICO · rifiutato: ${(d.gate?.hardReasons||[]).join(', ')||'gate conservativo'} · preview invariata`);if(state.liveOptDirty)scheduleLiveOptimization(state.liveOptLastReason||'pending',{slow:state.liveOptPendingSlow});return;
  }
  if(d.type==='single-opt-accepted'){
    state.liveOptInFlight=false;state.liveOptStalled=false;state.liveOptWorkingRetained=false;state.liveOptWorkingSnapshot=d.snapshot||null;state.liveOptCandidateStats=null;state.liveOptLastElapsedMs=Number(d.elapsedMs)||0;state.liveOptBackoff=adaptLiveOptBackoff(state.liveOptBackoff,d.solveMs??d.elapsedMs,d.mapMs||0);state.liveOptAccepted=d.snapshot||state.liveOptAccepted;state.liveOptStats=d.stats||state.liveOptStats;state.liveOptGate=d.gate||null;state.liveOptAcceptedCount++;state.liveOptLastReason=d.trigger||state.liveOptLastReason;const smoothed=smoothAcceptedAnchors(d.anchors||[]);state.liveOptAcceptedAnchors=smoothed;state.geometryAnchors=smoothed;state.liveOverlay?.setGeometryAnchors(smoothed);if(d.previewGaussians?.length){const visible=surfaceGaussiansForDisplay(d.previewGaussians,{mode:'live',source:'live-opt-preview'});state.liveOptPreviewGaussians=replaceValidatedPreviewGaussians(visible,{max:CONFIG.liveOptPreviewMaxAccumulatedSurfels||6500});state.liveOptPreviewStats=d.previewStats||null;state.liveOverlay?.setGaussians(state.liveOptPreviewGaussians);state.liveOverlay?.setMesh(null);}log.decision('single-opt-candidate-accepted',{generation:d.generation,trigger:d.trigger,elapsedMs:d.elapsedMs,iterations:d.iterations,gate:d.gate,stats:d.stats,steps:d.steps,graph:d.summary,audit,anchors:smoothed.length,previewMap:{gaussians:d.previewGaussians?.length||0,mapMs:d.mapMs||0,stats:d.previewStats||null}});log.checkpoint('single-opt-accepted',{generation:d.generation,reason:d.trigger,accepted:true,robustReprojectionPx:d.stats?.reprojectionRobustRmse,rawReprojectionPx:d.stats?.reprojectionRmse,medianPx:d.stats?.reprojectionMedianPx,p90Px:d.stats?.reprojectionP90Px,deepRelativeError:d.stats?.deepRelativeError,frames:d.summary?.frames,landmarks:d.summary?.landmarks,audit});updateLiveOptimizerHud();if(state.liveOptDirty)scheduleLiveOptimization(state.liveOptLastReason||'pending',{slow:state.liveOptPendingSlow});return;
  }
}
function smoothAcceptedAnchors(next){const old=new Map((state.liveOptAcceptedAnchors||[]).map(x=>[String(x.id),x])),a=clampNumber(CONFIG.liveOptPreviewSmoothing??.34,.05,.8),out=[];for(const x of next||[]){if(!Array.isArray(x?.p)||x.p.length<3)continue;const o=old.get(String(x.id)),p=o?.p?[o.p[0]*(1-a)+x.p[0]*a,o.p[1]*(1-a)+x.p[1]*a,o.p[2]*(1-a)+x.p[2]*a]:x.p.slice(0,3);out.push({...x,p,confidence:clampNumber(x.confidence??.5,.01,1)});}return out.slice(0,CONFIG.liveOptPreviewAnchors||90);}
function adaptLiveOptBackoff(current,solveMs,mapMs){let b=Math.max(1,Number(current)||1),cost=Math.max(0,Number(solveMs)||0)+.35*Math.max(0,Number(mapMs)||0);if(cost>180)b=Math.min(3,b*1.28);else if(cost>110)b=Math.min(3,b*1.12);else if(cost<65)b=Math.max(1,b*.92);return b;}
function replaceValidatedPreviewGaussians(next,{max=6500}={}){const rank=x=>(Number(x?.confidence)||.1)+.10*(Number(x?.independentSupport)||0)+.08*(Number(x?.support)||0)+(x?.evidenceClass==='strong'?.35:x?.evidenceClass==='confirmed'?.18:0),out=(next||[]).filter(g=>Array.isArray(g?.position||g?.p)&&((g.position||g.p).length>=3));out.sort((a,b)=>rank(b)-rank(a));return out.slice(0,max);}

function stopScan(){state.photoArchiveWorker?.terminate?.();state.photoArchiveWorker=null;state.photoPreprocessWorker?.terminate?.();state.photoPreprocessWorker=null;for(const slot of state.photoPreprocessPending?.values?.()||[])try{slot.reject?.(new Error('scan stopped'));}catch{}state.photoPreprocessPending?.clear?.();stopLiveOptimizer();scanAbortController?.abort();scanAbortController=null;state.scanStop?.();state.scanStop=null;state.camera?.stop();state.camera=null;state.deepDepthWorker?.terminate();state.deepDepthWorker=null;state.deepWorkerModelId=null;state.deepSelector?.reset?.();state.deepSelector=null;state.deepPending=null;state.deepJobs.clear();state.deepPreviewInFlight=null;state.deepPreviewLastAt=0;state.deepPlanLastAt=0;state.photoSurveyLastAt=0;state.denseDepthWorker?.terminate();state.denseDepthWorker=null;state.denseFusionWorker?.terminate();state.denseFusionWorker=null;state.denseManager?.reset?.();state.denseManager=null;state.denseBusy=false;state.sparseBusy=false;state.postScanMvsDrainActive=false;state.liveOverlay=null;const depth=$('depthOverlay');if(depth)depth.getContext('2d')?.clearRect(0,0,depth.width,depth.height);if($('deepLiveState'))$('deepLiveState').textContent='DEEP POST —';state.liveMapRenderPending=false;const features=$('alvaFeatureOverlay');if(features)features.getContext('2d')?.clearRect(0,0,features.width,features.height);const banner=$('alvaRecoveryBanner');if(banner)banner.hidden=true;}

function processingSetPhase(phase,{index=0,total=state.processingPhotos?.length||0,message='',detail=''}={}){
  state.processingActive=true;state.stablePhotoProcessingPhase=phase;state.stablePhotoProcessingIndex=index;
  const label=phase==='rgb'?'REGISTRAZIONE RGB':phase==='scaffold'?'SCAFFOLD RGB + ALVA':phase==='deep'?'DEEP PRIOR':phase==='mvs'?'MVS POST-SCAN':phase==='final-opt'?'OTTIMIZZAZIONE + CONSENSO GLOBALE':phase==='final'?'FUSIONE FINALE':String(phase||'PROCESSING').toUpperCase();
  const status=$('processingStatus'),progress=$('processingProgress'),counter=$('processingCounter'),sub=$('processingDetail');
  if(status)status.textContent=message||label;if(counter)counter.textContent=total?`${Math.min(index,total)}/${total}`:'—';
  if(progress){progress.max=Math.max(1,total||1);progress.value=Math.min(total||1,Math.max(0,index||0));}
  if(sub)sub.textContent=detail||`Archivio ${state.photoArchiveAccepted} foto nitide · RGB importate ${state.processingRgbImported} · Deep ${state.processingDeepAccepted} · salti Alva segnalati ${state.processingPoseJumps}`;
}
function drawRasterToCanvas(canvas,rgba,width,height){
  if(!canvas||!rgba?.length||!width||!height)return;const maxW=640,scale=Math.min(1,maxW/width),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');if(!ctx)return;
  const src=document.createElement('canvas');src.width=width;src.height=height;const sx=src.getContext('2d');sx.putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);ctx.clearRect(0,0,w,h);ctx.drawImage(src,0,0,w,h);
}
function drawProcessingDepth(d){
  const canvas=$('processingDepth');if(!canvas)return;if(!d?.rawDepth?.length){const c=canvas.getContext('2d');canvas.width=320;canvas.height=220;c?.clearRect(0,0,canvas.width,canvas.height);return;}drawDepth(canvas,d.rawDepth,d.rawWidth,d.rawHeight);
}
function qRotateProcessing(q,v){const x=q?.[0]||0,y=q?.[1]||0,z=q?.[2]||0,w=Number.isFinite(q?.[3])?q[3]:1,vx=v[0],vy=v[1],vz=v[2],tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];}
function diagnosticDepthWorldPoints(photo,d,maxPoints=900){
  if(!photo?.pose?.p||!photo?.pose?.q||!photo?.K||!d?.rawDepth?.length)return [];const W=d.rawWidth|0,H=d.rawHeight|0;if(W<2||H<2)return [];
  const raw=d.rawDepth,probe=[],stride=Math.max(1,Math.floor(raw.length/2500));for(let i=0;i<raw.length;i+=stride){const v=Number(raw[i]);if(Number.isFinite(v))probe.push(v);}if(probe.length<8)return [];probe.sort((a,b)=>a-b);const q=(t)=>probe[Math.min(probe.length-1,Math.max(0,Math.floor(t*(probe.length-1))))],lo=q(.08),hi=q(.92),span=Math.max(1e-9,hi-lo),step=Math.max(1,Math.ceil(Math.sqrt((W*H)/Math.max(1,maxPoints)))),sx=photo.width/W,sy=photo.height/H,K=photo.K,p=photo.pose.p,qq=photo.pose.q,out=[];
  for(let y=Math.floor(step/2);y<H;y+=step)for(let x=Math.floor(step/2);x<W;x+=step){const rv=Number(raw[y*W+x]);if(!Number.isFinite(rv))continue;const n=Math.max(0,Math.min(1,(rv-lo)/span));const depth=.55+(1-n)*3.7,u=(x+.5)*sx,v=(y+.5)*sy,ray=[(u-K.cx)/Math.max(1e-6,K.fx),(v-K.cy)/Math.max(1e-6,K.fy),1],norm=Math.hypot(...ray)||1,local=ray.map(a=>a/norm*depth),world=qRotateProcessing(qq,local);out.push([p[0]+world[0],p[1]+world[1],p[2]+world[2]]);}
  return out;
}
function processingOptimizedPose(frameId){return state.processingOptimizedPoseMap?.get?.(String(frameId||''))||null;}
function drawProcessingPose(photo,index,total,deep=null){
  const canvas=$('processingPose');if(!canvas)return;const ctx=canvas.getContext('2d');canvas.width=Math.max(520,canvas.clientWidth||520);canvas.height=340;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#05070a';ctx.fillRect(0,0,canvas.width,canvas.height);
  const poses=(state.processingPoseList||[]).filter(x=>x?.pose?.p),deepPts=diagnosticDepthWorldPoints(photo,deep,950),opt=processingOptimizedPose(photo?.frameId),all=[];for(const x of poses)all.push([x.pose.p[0],x.pose.p[2]]);for(const p of deepPts)all.push([p[0],p[2]]);if(opt?.p)all.push([opt.p[0],opt.p[2]]);if(!all.length)return;
  let minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0])),minZ=Math.min(...all.map(p=>p[1])),maxZ=Math.max(...all.map(p=>p[1]));const pad=Math.max(.25,.08*Math.max(maxX-minX,maxZ-minZ,1));minX-=pad;maxX+=pad;minZ-=pad;maxZ+=pad;const sx=(canvas.width-44)/Math.max(.1,maxX-minX),sz=(canvas.height-54)/Math.max(.1,maxZ-minZ),sc=Math.min(sx,sz),tx=x=>22+(x-minX)*sc,tz=z=>canvas.height-28-(z-minZ)*sc;
  ctx.lineWidth=1.5;ctx.strokeStyle='rgba(130,210,255,.42)';ctx.beginPath();poses.forEach((x,i)=>{const a=tx(x.pose.p[0]),b=tz(x.pose.p[2]);if(i)ctx.lineTo(a,b);else ctx.moveTo(a,b);});ctx.stroke();
  if(deepPts.length){ctx.fillStyle='rgba(94,222,255,.55)';for(const p of deepPts){ctx.fillRect(tx(p[0]),tz(p[2]),1.6,1.6);}}
  if(photo?.pose?.p){const jump=!!photo?.stability?.jumpSuspect;ctx.fillStyle=jump?'#ff9a52':'#8de6ff';ctx.beginPath();ctx.arc(tx(photo.pose.p[0]),tz(photo.pose.p[2]),6,0,Math.PI*2);ctx.fill();const f=qRotateProcessing(photo.pose.q,[0,0,1]);ctx.strokeStyle=jump?'#ff9a52':'#8de6ff';ctx.beginPath();ctx.moveTo(tx(photo.pose.p[0]),tz(photo.pose.p[2]));ctx.lineTo(tx(photo.pose.p[0]+f[0]*.45),tz(photo.pose.p[2]+f[2]*.45));ctx.stroke();}
  if(opt?.p){ctx.fillStyle='#ef8cff';ctx.beginPath();ctx.arc(tx(opt.p[0]),tz(opt.p[2]),5,0,Math.PI*2);ctx.fill();if(photo?.pose?.p){ctx.strokeStyle='rgba(239,140,255,.65)';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(tx(photo.pose.p[0]),tz(photo.pose.p[2]));ctx.lineTo(tx(opt.p[0]),tz(opt.p[2]));ctx.stroke();ctx.setLineDash([]);}}
  ctx.fillStyle='rgba(255,255,255,.78)';ctx.font='12px system-ui';ctx.fillText(`frame ${Math.min(index+1,total)}/${total} · vista X-Z`,14,18);ctx.fillStyle='#8de6ff';ctx.fillText('Alva + DeepPrior relativo',14,canvas.height-9);ctx.fillStyle='#ef8cff';ctx.fillText('posa RGB ottimizzata',180,canvas.height-9);
}
function showProcessingFrame(photo,index,total,{phase='rgb',deep=null,message=''}={}){
  if(!photo)return;const preview=state.processingPreview||(state.processingPreview={deep:null,photo:null,index:0,total:0,phase:null});drawRasterToCanvas($('processingRgb'),photo.rgba,photo.width,photo.height);
  // RGB/scaffold/MVS progress must not erase the last successful neural map.
  // The Depth result is a completed measurement, not a transient spinner.
  if(deep?.rawDepth?.length){preview.deep=deep;preview.photo=photo;preview.index=index;preview.total=total;preview.phase=phase;}
  if(preview.deep?.rawDepth?.length)drawProcessingDepth(preview.deep);else drawProcessingDepth(null);
  const posePhoto=preview.deep?.rawDepth?.length&&preview.photo?preview.photo:photo,poseIndex=preview.deep?.rawDepth?.length?preview.index:index,poseTotal=preview.deep?.rawDepth?.length?preview.total:total;drawProcessingPose(posePhoto,poseIndex,poseTotal,preview.deep);
  const jump=photo.stability?.jumpSuspect,pose=photo.pose?.p||[],detail=Number(photo.photoQuality?.detail||0),quality=Number(photo.photoQuality?.stableQuality||0);processingSetPhase(phase,{index:index+1,total,message:message||`${phase==='deep'?'DeepPrior':'RGB'} · ${photo.frameId}`,detail:`nitidezza ${detail.toFixed(1)} · stabilità ${(100*quality).toFixed(0)}% · Alva [${pose.map(x=>Number(x).toFixed(2)).join(', ')}]${jump?' · ⚠ salto Alva candidato':''} · RGB ${state.processingRgbImported} · Deep ${state.processingDeepAccepted}`});
}
function showProcessingDeepResult(photo,d){if(!state.processingActive||!photo)return;state.processingDeepAccepted++;state.stablePhotoProcessingDeepDone=state.processingDeepAccepted;const i=Math.max(0,(state.processingPhotos||[]).findIndex(x=>String(x.frameId)===String(photo.frameId)));showProcessingFrame(photo,i,state.processingPhotos.length,{phase:'deep',deep:d,message:`DeepPrior ${state.processingDeepAccepted}/${state.processingPhotos.length} · ${photo.frameId}`});log.info('processing-deep-prior-visible',{frameId:photo.frameId,index:i,rawDepth:[d?.rawWidth||0,d?.rawHeight||0],alvaPose:photo.pose||null,optimizedPose:processingOptimizedPose(photo.frameId)||null,jumpSuspect:!!photo.stability?.jumpSuspect});}
function updateProcessingOptimizedPoses(snapshot){state.processingOptimizedPoseMap?.clear?.();for(const f of snapshot?.frames||[]){const pose=f?.poseEstimate||f?.pose;if(pose?.p&&pose?.q)state.processingOptimizedPoseMap.set(String(f.frameId||f.id||''),pose);}log.info('processing-rgb-pose-map',{frames:state.processingOptimizedPoseMap.size});}
async function registerArchivedPhotosPostScan(records){
  state.processingRgbImported=0;state.processingPoseJumps=0;state.processingPreview={deep:null,photo:null,index:0,total:0,phase:null};state.processingPoseList=records.map(r=>({frameId:r.frameId,at:r.at,pose:r.pose,stability:r.stability,photoQuality:r.photoQuality}));processingSetPhase('rgb',{index:0,total:records.length,message:`Registro ${records.length} fotografie nitide nel grafo RGB`});
  const yieldEvery=Math.max(1,Number(CONFIG.sharpArchiveProcessingYieldEvery)||3);for(let i=0;i<records.length;i++){const decoded=await decodeSharpPhotoRecord(records[i]),survey=archiveRecordToSurvey(decoded);if(survey.stability?.jumpSuspect)state.processingPoseJumps++;showProcessingFrame(survey,i,records.length,{phase:'rgb'});const reg=registerDepthPlannedPhoto(survey,{source:'sharp-rgb-adaptive-candidate',optimize:false,render:false,adaptiveCandidate:true});if(reg?.ok)state.processingRgbImported++;if((i+1)%yieldEvery===0)await new Promise(r=>setTimeout(r,0));}
  state.liveMapStats=state.liveMap?.stats?.()||state.liveMapStats;scheduleLiveMapRender(true);log.info('processing-rgb-import-complete',{selected:records.length,imported:state.processingRgbImported,jumpSuspects:state.processingPoseJumps,graph:state.probGraph?.summary?.()||null,liveMap:state.liveMapStats});return {selected:records.length,imported:state.processingRgbImported,jumps:state.processingPoseJumps};
}
async function waitForDeepJobCompletion(jobId,timeoutMs){const started=performance.now();while((state.deepJobs.has(String(jobId))||String(state.deepLaneInFlight||'')===String(jobId))&&performance.now()-started<timeoutMs)await new Promise(r=>setTimeout(r,35));return !state.deepJobs.has(String(jobId))&&String(state.deepLaneInFlight||'')!==String(jobId);}
function drawProcessingUncertainty(map,batchRecords=[]){
  const canvas=$('processingUncertainty');if(!canvas||!map)return;const ctx=canvas.getContext('2d'),W=Math.max(520,canvas.clientWidth||520),H=300;canvas.width=W;canvas.height=H;ctx.clearRect(0,0,W,H);ctx.fillStyle='#05070a';ctx.fillRect(0,0,W,H);
  const b=map.cells?.bounds||{},gx=Math.max(1,Number(b.gridBins)||10),minX=Number(b.minX)||0,maxX=Number(b.maxX)||1,minZ=Number(b.minZ)||0,maxZ=Number(b.maxZ)||1,pad=24,cellW=(W-2*pad)/gx,cellH=(H-2*pad)/gx,covered=new Map((map.cells?.cells||[]).map(c=>[`${c.x}|${c.z}`,c])),candidateCell=new Map();
  for(const row of map.scores||[]){const [x,z]=String(row.cell||'0|0|0').split('|').map(Number),k=`${x}|${z}`,v=candidateCell.get(k)||{score:0,n:0};v.score+=Number(row.score)||0;v.n++;candidateCell.set(k,v);}
  for(let z=0;z<gx;z++)for(let x=0;x<gx;x++){const k=`${x}|${z}`,c=covered.get(k),u=candidateCell.get(k),unc=u?Math.min(1,u.score/Math.max(1,u.n)):0,conf=c?Math.min(1,Number(c.confidence)||0):0;ctx.fillStyle=c?`rgba(94,222,255,${.12+.50*conf})`:u?`rgba(255,196,82,${.08+.52*unc})`:'rgba(255,255,255,.025)';ctx.fillRect(pad+x*cellW,pad+(gx-1-z)*cellH,Math.max(1,cellW-1),Math.max(1,cellH-1));}
  const px=x=>pad+(x-minX)/Math.max(1e-6,maxX-minX)*(W-2*pad),pz=z=>H-pad-(z-minZ)/Math.max(1e-6,maxZ-minZ)*(H-2*pad);ctx.fillStyle='#ef8cff';for(const r of batchRecords||[]){const p=r.optimizedPose?.p||r.pose?.p;if(!p)continue;ctx.beginPath();ctx.arc(px(p[0]),pz(p[2]),4.5,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='rgba(255,255,255,.84)';ctx.font='12px system-ui';ctx.fillText(`uncertainty globale ${Number(map.globalUncertainty||0).toFixed(3)} · Deep ${state.processingDeepProcessedIds?.size||0}/${state.processingPhotos?.length||0} · round ${state.processingDeepRounds}`,14,17);ctx.fillStyle='#5edeff';ctx.fillText('coperto/affidabile',14,H-7);ctx.fillStyle='#ffc452';ctx.fillText('incerto',130,H-7);ctx.fillStyle='#ef8cff';ctx.fillText('prossima tranche',190,H-7);
}
function markAdaptivePhotoDepthPlanned(survey,round){if(!survey?.frameId)return;const id=String(survey.frameId);if(state.photoPlannedFrameIds?.has?.(id))return;state.photoPlannedFrameIds.add(id);survey.depthPlanned=true;survey.depthCandidate=true;log.info('adaptive-deep-frame-planned',{frameId:id,round,at:survey.at,quality:survey.photoQuality||null,features:survey.features?.length||0});}
async function runAdaptiveDepthFeedback(round){
  if(!state.probGraph)return null;const runtime=await ensureSingleOptimizerRuntime(),graph=state.probGraph.exportState(),result=await runtime.refineDepthFeedback?.(graph,{passes:CONFIG.adaptiveDeepFeedbackPasses||4,optimizer:{localWindowSize:CONFIG.postOptimizeLocalWindowFrames||20,localWindowOverlap:CONFIG.postOptimizeLocalWindowOverlap||6}});if(!result)return null;
  if(result.accepted){state.liveOptAccepted=result.snapshot||state.liveOptAccepted;state.liveOptStats=result.stats||state.liveOptStats;state.liveOptGate=result.gate||state.liveOptGate;state.liveOptAcceptedCount++;updateProcessingOptimizedPoses(result.snapshot);}
  const analysis=result.analysisSnapshot||result.snapshot||state.liveOptAccepted;log.info('adaptive-deep-feedback',{round,accepted:!!result.accepted,elapsedMs:result.elapsedMs,deepFrames:graph.deepFactors?.length||0,stats:result.analysisStats||result.stats||null,gate:result.gate||null});return {...result,analysisSnapshot:analysis};
}
function deepFactorExists(frameId){const id=String(frameId||'');return !!state.probGraph?.deepFactors?.some?.(d=>String(d?.frameId||'')===id);}
async function processDeepBatchPipelined(records,{round=0}={}){
  if(CONFIG.deepDepthEnabled===false||state.deepDisabled||!records.length)return {processed:0,failed:0,accepted:0};try{ensureDeepRuntimeWorker();}catch(err){state.deepDisabled=true;log.warn('processing-deep-init',{message:err?.message||String(err)});return {processed:0,failed:records.length,accepted:0};}
  state.deepDrainActive=true;const timeout=Math.max(15000,Number(CONFIG.sharpArchiveDeepFrameTimeoutMs)||120000),shortSide=Math.max(0,Number(CONFIG.adaptiveDeepPreprocessShortSide)||280);let processed=0,failed=0,prep=decodeSharpPhotoRecord(records[0],{deepShortSide:shortSide});
  log.info('adaptive-deep-batch-start',{round,frames:records.map(r=>r.frameId),count:records.length,timeoutPerFrameMs:timeout,preprocessShortSide:shortSide,microbatchProtocol:state.deepBatchProtocol||null,microbatchCapable:state.deepBatchProtocol===CONFIG.adaptiveDeepMicrobatchRequiresProtocol,microbatchActive:false,microbatchReason:state.deepBatchProtocol===CONFIG.adaptiveDeepMicrobatchRequiresProtocol?'throughput-not-benchmarked':'worker-protocol-unsupported'});
  for(let i=0;i<records.length;i++){if(state.processingAbort)break;let decoded=null,survey=null;try{
      decoded=await prep;prep=(i+1<records.length)?decodeSharpPhotoRecord(records[i+1],{deepShortSide:shortSide}):null;survey=archiveRecordToSurvey(decoded);markAdaptivePhotoDepthPlanned(survey,round);showProcessingFrame(survey,Math.max(0,state.processingPhotos.findIndex(x=>String(x.frameId)===String(survey.frameId))),state.processingPhotos.length,{phase:'deep',message:`Round ${round+1} · DeepPrior ${i+1}/${records.length} · ${survey.frameId}`});
      const input=decoded.deepRgba?.length?decoded.deepRgba:survey.rgba,inputW=decoded.deepRgba?.length?decoded.deepWidth:survey.width,inputH=decoded.deepRgba?.length?decoded.deepHeight:survey.height,jobId=`deep-adaptive-r${round}-${survey.frameId}`,queued=enqueueLateDeepJob({jobId,kind:'preview',frameId:survey.frameId,frameAt:survey.at,refId:survey.id,rgba:new Uint8ClampedArray(input),width:inputW,height:inputH,survey,tracking:{pose:survey.pose,featureCount:survey.features?.length||0,anchorCount:0}});if(!queued.ok){failed++;continue;}
      await pumpDeepLateLane();const ok=await waitForDeepJobCompletion(jobId,timeout),accepted=ok&&deepFactorExists(survey.frameId);if(!ok){failed++;log.warn('processing-deep-timeout',{jobId,frameId:survey.frameId,timeoutMs:timeout,round});if(String(state.deepLaneInFlight||'')===jobId)state.deepLaneInFlight=null;state.deepJobs.delete(jobId);state.deepLateQueue?.fail?.(jobId);}else{processed++;state.processingDeepProcessedIds.add(String(survey.frameId));if(!accepted)log.warn('adaptive-deep-result-not-in-graph',{jobId,frameId:survey.frameId,round});}
    }catch(err){failed++;log.warn('processing-deep-frame',{round,index:i,frameId:records[i]?.frameId||null,message:err?.message||String(err)});}await new Promise(r=>setTimeout(r,0));}
  state.deepDrainActive=false;return {processed,failed,accepted:state.processingDeepAccepted};
}
async function processArchivedDeepAdaptive(records,rgbScaffold=null){
  if(!records.length)return {processed:0,failed:0,rounds:0,stopReason:'no-records'};state.deepLateQueue?.reset?.();state.deepLaneQueuedFrames?.clear?.();state.deepJobs.clear();state.deepLaneInFlight=null;state.processingDeepRounds=0;state.processingDeepProcessedIds.clear();state.processingUncertaintyHistory=[];
  const scheduler=new AdaptiveDeepScheduler(records,{initialBatch:CONFIG.adaptiveDeepInitialBatch||16,nextBatch:CONFIG.adaptiveDeepNextBatch||8,maxDepthFrames:CONFIG.adaptiveDeepMaxFrames||56,minMarginalScore:CONFIG.adaptiveDeepMinMarginalScore??.34});scheduler.attachOptimizedPoses(state.processingOptimizedPoseMap);let analysisSnapshot=rgbScaffold?.snapshot||state.liveOptAccepted||null,lastUncertainty=null,totalProcessed=0,totalFailed=0,stopReason='max-rounds';
  log.info('adaptive-deep-start',{rgbCandidates:records.length,initialBatch:scheduler.initialBatch,nextBatch:scheduler.nextBatch,maxDepthFrames:scheduler.maxDepthFrames,maxRounds:CONFIG.adaptiveDeepMaxRounds||7,minMarginalScore:scheduler.minMarginalScore,microbatchCapability:state.deepBatchProtocol||null});
  for(let round=0;round<Math.max(1,Number(CONFIG.adaptiveDeepMaxRounds)||7);round++){
    scheduler.attachOptimizedPoses(state.processingOptimizedPoseMap);const plan=scheduler.next(state.processingDeepProcessedIds,analysisSnapshot);state.processingDeepRounds=round+1;state.processingUncertainty=plan.map;drawProcessingUncertainty(plan.map,plan.records);processingSetPhase('deep',{index:state.processingDeepProcessedIds.size,total:Math.min(records.length,scheduler.maxDepthFrames),message:`Deep adattivo · round ${round+1} · ${plan.records.length} viste ad alta informazione`,detail:`uncertainty ${Number(plan.map?.globalUncertainty||0).toFixed(3)} · marginale ${Number(plan.marginalScore||0).toFixed(3)} · Deep usate ${state.processingDeepProcessedIds.size}/${records.length}`});
    log.info('adaptive-deep-selection',{round,globalUncertainty:plan.map?.globalUncertainty,marginalScore:plan.marginalScore,stopReason:plan.stopReason||null,selected:plan.map?.scores?.filter(x=>plan.records.some(r=>String(r.frameId)===String(x.frameId))).map(x=>({frameId:x.frameId,score:x.score,adjustedScore:x.adjustedScore??x.score,novelty:x.novelty,batchNovelty:x.batchNovelty??null,batchSeparation:x.batchSeparation??null,batchCellReuse:x.batchCellReuse??0,localUncertainty:x.localUncertainty,quality:x.quality,featureSupport:x.featureSupport,cell:x.cell}))||[]});
    if(!plan.records.length){stopReason=plan.stopReason||'no-useful-candidates';break;}
    const before=Number(plan.map?.globalUncertainty)||0,batch=await processDeepBatchPipelined(plan.records,{round});totalProcessed+=batch.processed;totalFailed+=batch.failed;const feedback=await runAdaptiveDepthFeedback(round);analysisSnapshot=feedback?.analysisSnapshot||analysisSnapshot;scheduler.attachOptimizedPoses(state.processingOptimizedPoseMap);const afterMap=scheduler.buildUncertainty(state.processingDeepProcessedIds,analysisSnapshot),after=Number(afterMap.globalUncertainty)||0,drop=Math.max(0,before-after);state.processingUncertainty=afterMap;state.processingUncertaintyHistory.push({round,before,after,drop,processed:state.processingDeepProcessedIds.size,marginalScore:plan.marginalScore});drawProcessingUncertainty(afterMap,[]);log.info('adaptive-deep-round-complete',{round,beforeUncertainty:before,afterUncertainty:after,uncertaintyDrop:drop,processed:batch.processed,failed:batch.failed,totalDepth:state.processingDeepProcessedIds.size,feedbackAccepted:!!feedback?.accepted});
    if(state.processingDeepProcessedIds.size>=scheduler.maxDepthFrames){stopReason='max-depth-frames';break;}if(round>0&&drop<(Number(CONFIG.adaptiveDeepMinUncertaintyDrop)||.025)&&Number(plan.marginalScore||0)<Math.max(scheduler.minMarginalScore+.08,.42)){stopReason='marginal-uncertainty-gain-small';break;}lastUncertainty=after;
  }
  log.info('adaptive-deep-complete',{rgbCandidates:records.length,processed:totalProcessed,failed:totalFailed,uniqueDepth:state.processingDeepProcessedIds.size,rounds:state.processingDeepRounds,stopReason,uncertainty:state.processingUncertainty?.globalUncertainty??lastUncertainty,history:state.processingUncertaintyHistory,resizeCacheHits:state.photoResizeCacheHits,resizeCacheMisses:state.photoResizeCacheMisses});return {processed:totalProcessed,failed:totalFailed,accepted:state.processingDeepAccepted,uniqueDepth:state.processingDeepProcessedIds.size,rounds:state.processingDeepRounds,stopReason,uncertainty:state.processingUncertainty?.globalUncertainty??null};
}

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
  // Freeze the fast lane first. From this point no camera/Alva/RGB frame can
  // be delayed by neural work because acquisition is already complete.
  stopCaptureFastLane();stopLiveOptimizer();
  while(state.sparseBusy)await new Promise(r=>setTimeout(r,20));
  state.processingActive=true;state.processingAbort=false;show('processing');processingSetPhase('rgb',{message:'Chiudo archivio foto nitide…'});
  const archiveIdle=await waitForPhotoArchiveIdle(Math.max(12000,Number(CONFIG.sharpArchiveFlushTimeoutMs)||20000)),archived=await loadSharpPhotoArchive(),selected=selectSharpPhotosForProcessing(archived,Math.max(16,Number(CONFIG.sharpArchiveProcessMaxFrames)||240));state.processingPhotos=selected;
  log.checkpoint('processing-photo-dataset',{archiveIdle,archived:archived.length,selected:selected.length,archiveBytes:state.photoArchiveBytes,backpressureDropped:state.photoArchiveBackpressureDropped});
  if(selected.length)await registerArchivedPhotosPostScan(selected);else log.warn('processing-photo-dataset-empty',{stableFallback:state.stablePhotoBank?.stats?.()||null});
  processingSetPhase('scaffold',{index:0,total:1,message:'Risolvo scaffold RGB + prior Alva…'});
  const rgbScaffold=await reconcilePostScanRgbScaffold();updateProcessingOptimizedPoses(rgbScaffold?.snapshot||null);processingSetPhase('scaffold',{index:1,total:1,message:rgbScaffold?.accepted?'Scaffold RGB consolidato':'Scaffold RGB conservativo · continuo con diagnostica'});
  // V30.52: the large RGB archive builds the scaffold first. Deep is then
  // requested adaptively (16, then 8...) only where geometric/reliability
  // uncertainty remains high. No Deep job is preplanned during acquisition.
  state.deepLateQueue?.reset?.();state.deepLaneQueuedFrames?.clear?.();
  const archivedDeepDrain=selected.length?await processArchivedDeepAdaptive(selected,rgbScaffold):{processed:0,failed:0,accepted:0,rounds:0,stopReason:'no-rgb-candidates'};
  const deepDrain={adaptive:archivedDeepDrain};
  processingSetPhase('mvs',{index:0,total:Math.max(1,state.postScanMvsPayloads?.length||0),message:'MVS sulle pose finali…'});
  const mvsSnapshot=state.liveOptAccepted||rgbScaffold?.snapshot||null;const mvsDrain=await drainPostScanMvsBacklog(mvsSnapshot);processingSetPhase('final',{index:1,total:1,message:'Fusione e salvataggio finale…'});
  const latePanorama=state.liveMap?.exportState?.()||null;if(latePanorama?.edges?.length)state.probGraph?.addPhotoEdges?.(latePanorama.edges);
  log.checkpoint('fast-lane-frozen-dense-late-bound',{fastLaneFrames:state.fastLaneFrames,maxFastLaneGapMs:state.fastLaneMaxGapMs,photoPanorama:latePanorama?.stats||state.liveMap?.stats?.()||null,rgbScaffold:state.postScanRgbScaffold,mvsDrain,deepDrain,deepQueue:state.deepLateQueue?.stats?.()||null,graph:state.probGraph?.summary?.()||null});
  // Persist the compact multi-view ray reservoir BEFORE terminating the fusion
  // worker. This makes later iterative optimisation a real geometric refinement
  // rather than a smoothing pass over an already flattened PLY.
  const persisted=await workerRequest(state.denseFusionWorker,{type:'persist',maxSurfels:CONFIG.postOptimizeMaxGaussians||70000,maxObservationsPerSurfel:CONFIG.postOptimizeObservationReservoir||4},d=>d.type==='fusion-persist',6000);
  if(persisted?.state?.gaussians?.length){state.denseCandidateGaussians=persisted.state.gaussians;state.optimizerObservations=persisted.state.observations||null;}
  else{const snap=await workerRequest(state.denseFusionWorker,{type:'snapshot',maxSplats:CONFIG.gaussianSnapshot},d=>d.type==='surface-snapshot',2500);if(snap?.splats?.length)state.denseCandidateGaussians=snap.splats;}
  // The worker TSDF is intentionally not promoted to review geometry. It was
  // built before final pose/depth consensus and is only a live candidate.
  state.gaussians=[];state.mesh=null;state.meshStale=true;state.geometryCommitted=false;window.__ROOMSCAN_METRIC_MESH=null;
  const kfCount=state.slam?.keyframes?.length||0;state.reviewKeyframes=kfCount;state.reviewMetricLocked=!!state.slam?.metricLocked;stopScan();
  // V30.52: Processing is responsible for producing the final authoritative
  // reconstruction. REVIEW is no longer an intermediate state that requires a
  // manual click before the first global rebuild.
  let automaticFinal=null;
  if(CONFIG.postScanFinalAutoRebuild!==false&&state.probGraph?.landmarkFactors?.length>=4){
    processingSetPhase('final-opt',{index:0,total:Math.max(1,Number(CONFIG.postScanFinalOptimizationPasses)||10),message:'Ottimizzazione globale + consenso superficie…',detail:'RGB/Alva + Deep adattivo + MVS vengono ora riconciliati prima del TSDF.'});
    try{automaticFinal=await startProbabilisticOptimization({automatic:true,additionalPasses:CONFIG.postScanFinalOptimizationPasses||10});}
    catch(err){state.postOptBusy=false;log.error('processing-final-reconstruction',{message:err?.message||String(err),stack:err?.stack||null});processingSetPhase('final-opt',{index:0,total:1,message:'Ricostruzione finale non convergente',detail:`${err?.message||err} · apri TEST in REVIEW per isolare lo stadio.`});}
  }else log.warn('processing-final-reconstruction-skipped',{landmarks:state.probGraph?.landmarkFactors?.length||0,auto:CONFIG.postScanFinalAutoRebuild!==false});
  await persistCurrentSession({status:state.geometryCommitted?'optimized':'finished',keyframes:kfCount});
  collectPipelineTestSnapshot();state.processingActive=false;processingSetPhase('final',{index:1,total:1,message:state.geometryCommitted?'Processing completato · geometria committed':'Processing completato · geometria non committed, apri TEST'});state.processingActive=false;
  log.checkpoint('processing-final-result',{automaticFinal:{accepted:automaticFinal?.accepted||0,attempts:automaticFinal?.attempts||0,stalled:!!automaticFinal?.stalled},geometryCommitted:!!state.geometryCommitted,gaussians:state.gaussians.length,faces:state.mesh?.faces?.length?state.mesh.faces.length/3:0,surface:state.surfaceStats||null,pipelineTest:state.pipelineTestSnapshot?.firstFailure||null});
  await renderSessions();await showReview();
  if(state.probGraph?.landmarkFactors?.length>=4)updateOptimizerUi(state.geometryCommitted?'OPT UNICO · ricostruzione automatica completata. “Continua” esegue soltanto raffinamenti aggiuntivi.':'OPT UNICO · ricostruzione automatica conservativa: apri TEST per vedere il primo blocker; “Continua” prova ulteriori cicli senza abbassare i gate.');
}

function effectiveOptimizationIterations(){
  return Math.max(0,Number(state.optimization?.iterations)||0,Number(state.probOptimization?.iterations)||0,Number(state.liveOptAccepted?.iterations)||0,Number(state.liveOptStats?.iterations)||0);
}
function currentEvidenceProvenance(){
  const graph=state.probGraph?.summary?.()||null;
  return {sourceBuild:state.evidenceSourceBuild||BUILD.id,lastProcessedBuild:BUILD.id,savedAt:Date.now(),mvsPoseBoundFactors:graph?.mvsPoseBoundFactors??null,mvsPoseUnboundFactors:graph?.mvsPoseUnboundFactors??null};
}
function committedGeometryAvailable(){return !!state.geometryCommitted&&!!state.gaussians?.length;}
function committedMeshAvailable(){return !!state.geometryCommitted&&!state.meshStale&&!!state.mesh?.vertices?.length&&!!state.mesh?.faces?.length;}

async function persistCurrentSession({status='finished',keyframes=state.reviewKeyframes||0}={}){
  if(!state.currentSession||!state.db)return null;
  const id=state.currentSession.id,effectiveIterations=effectiveOptimizationIterations(),faces=committedMeshAvailable()?state.mesh.faces.length/3:0;
  const photoPanorama=state.liveMap?.exportState?.()||state.photoPanoramaState||null;state.photoPanoramaState=photoPanorama;
  if(photoPanorama?.edges?.length)state.probGraph?.addPhotoEdges?.(photoPanorama.edges);
  const graphState=state.probGraph?.exportState?.()||state.probGraph||null,deepSequence=state.deepSequence?.exportState?.()||null,provenance=currentEvidenceProvenance(),bestProb=state.probOptimization||state.liveOptAccepted||null;
  const snapshot={id,sessionId:id,format:'ROOMSCAN-PUZZLE-SESSION-6',savedAt:Date.now(),build:BUILD.id,evidenceProvenance:provenance,gaussians:committedGeometryAvailable()?state.gaussians:[],optimizerObservations:state.optimizerObservations||null,factorGraph:graphState,deepSequence,photoPanorama,probOptimization:bestProb,liveOptimization:state.liveOptAccepted?{snapshot:state.liveOptAccepted,stats:state.liveOptStats,gate:state.liveOptGate,accepted:state.liveOptAcceptedCount,rejected:state.liveOptRejected}:null,coverageSummary:coverageSnapshot(),optimization:{...(state.optimization||{}),iterations:effectiveIterations},denseSamples:state.denseDepthSamples||0,deepRaySamples:state.deepRaySamples||0,metricLocked:state.reviewMetricLocked??!!state.slam?.metricLocked,geometryCommitted:!!state.geometryCommitted,keyframes};
  await state.db.put('snapshots',snapshot);
  if(committedMeshAvailable())await state.db.put('meshes',{id,sessionId:id,format:'ROOMSCAN-MESH-2',savedAt:Date.now(),stale:false,geometryCommitted:true,voxelM:state.mesh.voxelM||null,occupiedVoxels:state.mesh.occupiedVoxels||0,vertices:state.mesh.vertices,colors:state.mesh.colors,faces:state.mesh.faces});
  else if(state.db.delete)try{await state.db.delete('meshes',id);}catch{}
  state.currentSession=await state.db.updateSession(id,{status,hasSnapshot:true,optimizationIterations:effectiveIterations,counts:{keyframes,denseSamples:state.denseDepthSamples||0,surfels:committedGeometryAvailable()?state.gaussians.length:0,gaussians:committedGeometryAvailable()?state.gaussians.length:0,meshFaces:faces}});
  log.info('session-persisted',{id,geometryCommitted:!!state.geometryCommitted,gaussians:committedGeometryAvailable()?state.gaussians.length:0,optimizerObservations:state.optimizerObservations?.count||0,factorGraph:graphState?.summary||state.probGraph?.summary?.()||null,iterations:effectiveIterations,evidenceProvenance:provenance,photoPanorama:photoPanorama?.stats||null,meshFaces:faces});return state.currentSession;
}

function surfaceGaussiansForDisplay(rows,{mode='review',source='surface'}={}){
  const minConfidence=mode==='candidate'?CONFIG.surfaceCandidateDisplayMinConfidence:mode==='live'?CONFIG.surfaceLiveDisplayMinConfidence:CONFIG.surfaceDisplayMinConfidence,result=filterSurfaceSplatsForDisplay(rows||[],{mode,minConfidence,max:mode==='live'?(CONFIG.liveOptPreviewMaxAccumulatedSurfels||6500):Infinity});
  state.surfaceDisplayStats={...result.stats,source};
  if(result.stats.hidden>0)log.debug('surface-display-filter',{source,...result.stats});
  return result.splats;
}


function collectPipelineTestSnapshot(){
  const snap=buildPipelineTestSnapshot({build:BUILD,graph:state.probGraph?.summary?.()||{},optimizer:{stats:state.liveOptStats,candidateStats:state.liveOptCandidateStats,gate:state.liveOptGate,accepted:state.liveOptAcceptedCount,rejected:state.liveOptRejected,stalled:state.liveOptStalled},processing:{active:state.processingActive,photos:state.processingPhotos?.length||0,rgbImported:state.processingRgbImported,deepAccepted:state.processingDeepAccepted,deepRounds:state.processingDeepRounds,poseJumps:state.processingPoseJumps,uncertainty:state.processingUncertainty?.globalUncertainty??null,resizeCacheHits:state.photoResizeCacheHits,resizeCacheMisses:state.photoResizeCacheMisses},tracking:{mode:state.lastTracking?.trackingMode||null,valid:!!state.lastTracking?.trackingValid,recoveryRequired:state.alvaRecoveryRequired,recoveryReason:state.alvaRecoveryReason,persistentFeatures:state.alvaPersistentFeatures,newFeatures:state.alvaNewFeatures,quarantinedFrames:state.alvaQuarantinedFrameIds?.size||0},photoArchive:{accepted:state.photoArchiveAccepted,rejected:state.photoArchiveRejected,backpressureDropped:state.photoArchiveBackpressureDropped,pending:state.photoArchivePending,bytes:state.photoArchiveBytes,entries:state.photoArchiveEntries?.length||0},fastLane:{frames:state.fastLaneFrames,lastGapMs:state.fastLaneLastGapMs,maxGapMs:state.fastLaneMaxGapMs},dense:{jobs:state.denseJobs,samples:state.denseDepthSamples,postScanQueued:state.postScanMvsPayloads?.length||0,postScanRefreshed:state.postScanMvsRefreshed,postScanRefreshFailed:state.postScanMvsRefreshFailed,evidenceStatus:state.denseEvidenceStatus||null},surface:{...(state.surfaceStats||{}),display:state.surfaceDisplayStats||null},events:log.entries||[]});state.pipelineTestSnapshot=snap;state.pipelineTestUpdatedAt=Date.now();return snap;
}
function updatePipelineTestUi(force=false){
  const summary=$('pipelineTestSummary'),list=$('pipelineTestStages'),raw=$('pipelineTestJson'),panel=$('pipelineTestPanel');if(!summary||!list)return null;if(!force&&panel&&!panel.open&&state.pipelineTestSnapshot)return state.pipelineTestSnapshot;const snap=collectPipelineTestSnapshot(),first=snap.firstFailure;summary.textContent=first?`Primo punto debole: ${first.name} · ${first.status.toUpperCase()} · ${first.reasons?.[0]||'vedi metriche'}`:'Pipeline: nessun blocker evidente nei dati disponibili.';summary.dataset.status=first?.status||'ok';list.textContent='';
  for(const st of snap.stages||[]){const row=document.createElement('div');row.className=`pipelineTestStage ${st.status}`;const h=document.createElement('div');h.className='pipelineTestStageHead';const name=document.createElement('b');name.textContent=st.name;const badge=document.createElement('span');badge.className='pipelineTestBadge';badge.textContent=st.status.toUpperCase();h.append(name,badge);const why=document.createElement('div');why.className='pipelineTestWhy';why.textContent=(st.reasons?.length?st.reasons.join(' '):'Nessuna anomalia strutturale rilevata in questo stadio.');const met=document.createElement('pre');met.className='pipelineTestMetrics';met.textContent=JSON.stringify(st.metrics||{},null,2);row.append(h,why,met);if(st.actions?.length){const act=document.createElement('div');act.className='pipelineTestAction';act.textContent=`Intervento: ${st.actions.join(' ')}`;row.append(act);}list.appendChild(row);}if(raw)raw.textContent=JSON.stringify(snap,null,2);return snap;
}
async function exportPipelineTestSnapshot(){const snap=updatePipelineTestUi(true)||collectPipelineTestSnapshot(),{downloadBlob}=await lazy('./formats.js');log.checkpoint('pipeline-test-export',{firstFailure:snap.firstFailure,stages:snap.stages?.map(x=>({name:x.name,status:x.status,metrics:x.metrics}))});downloadBlob(new Blob([JSON.stringify(snap,null,2)],{type:'application/json'}),`roomscan-pipeline-test-${Date.now()}.json`);}

async function showReview(){
  show('review');const {GaussianRenderer}=await lazy('./gaussian/renderer.js');if(!state.renderer)state.renderer=new GaussianRenderer($('viewer'));const committed=committedGeometryAvailable(),raw=committed?state.gaussians:(state.denseCandidateGaussians||[]),mode=committed?'review':'candidate',visible=surfaceGaussiansForDisplay(raw,{mode,source:committed?'review-committed':'review-candidate-loaded'}),candidatePolicy=state.surfaceStats?.geometryPolicy||null,candidateMeshVisible=!committed&&state.denseCandidateMesh&&candidatePolicy?.topologyCoherent&&candidatePolicy?.denseAuthorityReady!==false;state.renderer.setData(visible,{fit:true});state.renderer.setMesh(committedMeshAvailable()?state.mesh:(candidateMeshVisible?state.denseCandidateMesh:null));state.renderer.draw();updateReviewUi();updateOptimizerUi();updatePipelineTestUi(true);
}
function updateReviewUi(){
  const committedMesh=committedMeshAvailable()?state.mesh:null,faces=committedMesh?.faces?.length?committedMesh.faces.length/3:0,metric=state.reviewMetricLocked??!!state.slam?.metricLocked,kf=state.reviewKeyframes||state.slam?.keyframes?.length||0,iterations=effectiveOptimizationIterations(),candidateGaussians=state.denseCandidateGaussians?.length||state.surfaceStats?.candidateGaussians||0,candidateMesh=state.denseCandidateMesh||(!state.geometryCommitted?state.mesh:null),candidateFaces=candidateMesh?.faces?.length?candidateMesh.faces.length/3:Number(state.surfaceStats?.candidateFaces)||0,candidateVertices=candidateMesh?.vertices?.length?candidateMesh.vertices.length/3:Number(state.surfaceStats?.meshQuality?.vertexCount)||0;
  if($('reviewStats')){const ds=state.surfaceDisplayStats,displayInfo=ds&&ds.input?` · ${ds.visible}/${ds.input} GS visibili${ds.hidden?` · ${ds.hidden} bassa conf. nascoste`:''}`:'';$('reviewStats').textContent=`Surface splat: ${committedGeometryAvailable()?state.gaussians.length:0}${candidateGaussians?` · ${candidateGaussians} candidati non committed`:''}${displayInfo} · depth sample ${state.denseDepthSamples||0} · scala ${metric?'metrica':'Alva libera'} · keyframe ${kf} · ottimizzazione ${iterations} iterazioni`; }
  if($('metricGsStats')){const suppressed=!!state.surfaceStats?.candidateMeshDisplaySuppressed;$('metricGsStats').textContent=state.geometryCommitted&&committedMesh?`GEOMETRIA COMMITTED: ${committedMesh.vertices.length/3} vertici / ${faces} facce · submap fuse dopo scaffold e calibrazione Deep.`:candidateFaces?`CANDIDATO NON COMMITTED: ${candidateVertices} vertici / ${candidateFaces} facce · ${suppressed?'mesh nascosta perché topologicamente/non-autoritativamente incoerente':'visualizzazione diagnostica soltanto'} · export disabilitato · motivo: ${state.surfaceStats?.withheldReason||state.surfaceStats?.geometryPolicy?.reason||'gate geometrico non superato'}.`:'Nessuna geometria committed. Le evidenze restano salvate e rielaborabili; export 3D disabilitato finché i gate geometrici non sono superati.';}
  const ply=$('exportPlyBtn'),mesh=$('buildMetricMeshBtn');if(ply){ply.disabled=!committedGeometryAvailable();ply.title=ply.disabled?'Export disponibile solo per superficie 3D committed.':'';}if(mesh){mesh.disabled=!committedMeshAvailable();mesh.title=mesh.disabled?'Export mesh disponibile solo per TSDF committed.':'';}
  const input=$('optIterations');if(input&&document.activeElement!==input)input.value=String(Math.max(Number(input.value)||0,iterations||CONFIG.postOptimizeDefaultIterations||30));updateOptimizerUi();if($('pipelineTestPanel')?.open)updatePipelineTestUi(true);
}


function setScanDiagnosticsOpen(open){const dock=$('scanDiagnostics'),toggle=$('scanDiagnosticsToggle');if(dock)dock.classList.toggle('open',!!open);if(toggle){toggle.setAttribute('aria-expanded',open?'true':'false');toggle.textContent=open?'Chiudi mappa':'Mappa';}}
function toggleScanDiagnostics(){setScanDiagnosticsOpen(!$('scanDiagnostics')?.classList.contains('open'));}
function setLiveMapMode(mode){state.liveMapMode=mode==='depth'?'depth':'photo';updateLiveMapUi();scheduleLiveMapRender(true);}
function updateLiveMapUi(extra=null){
  const photo=$('liveMapPhotoBtn'),depth=$('liveMapDepthBtn'),status=$('liveMapState'),s=state.liveMap?.stats?.()||state.liveMapStats||{};
  if(photo)photo.classList.toggle('active',state.liveMapMode==='photo');if(depth)depth.classList.toggle('active',state.liveMapMode==='depth');if(!status)return;if(extra){status.textContent=extra;return;}if(!s.frames){status.textContent=`${state.liveMapMode==='depth'?'DEPTH CONSENSUS':'MOSAICO RGB FAST'} · attendo primo frame depth-planned…`;return;}
  const placed=s.visualRegisteredFrames||0,pending=Math.max(0,(s.frames||0)-placed),visual=`${placed} foto unite${pending?` · ${pending} in attesa overlap`:''}`;
  if(state.liveMapMode==='photo')status.textContent=`MOSAICO RGB FAST · ${visual} · ${s.rawDepthFrames||0} depth late-bound · nessun punto/posa · coda Deep ${state.deepLateQueue?.stats?.().queued||0} · ${(100*(s.coverage||0)).toFixed(0)}% canvas`;
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
function updateOptimizerUi(extra=null){
  const current=Math.max(Number(state.probOptimization?.iterations||0),Number(state.liveOptAccepted?.iterations||0),Number(state.optimization?.iterations||0)),status=$('optStatus'),progress=$('optProgress'),start=$('optStartBtn'),stop=$('optStopBtn'),graph=state.probGraph?.summary?.()||null,target=Math.max(current+1,Number($('optIterations')?.value)||CONFIG.probabilisticDefaultIterations||12),st=state.liveOptStats||state.liveOptCandidateStats;
  if(progress){progress.max=Math.max(1,target);progress.value=Math.min(progress.max,current);}
  if(start)start.disabled=state.postOptBusy||!graph||graph.frames<2||graph.landmarks<4;if(stop)stop.disabled=!state.postOptBusy;
  const optState=state.liveOptStalled?' · bootstrap fermo':(!state.liveOptStats&&state.liveOptWorkingRetained?' · bootstrap RGB interno':'');
  if(status)status.textContent=extra||`OPT UNICO · acc ${current} · factor graph ${graph?`${graph.frames}F / ${graph.landmarks}L / ${graph.photoEdges} RGB edge / ${graph.alvaEdges} Alva / ${graph.deepFrames} Deep`:'non disponibile'}${st?` · reproj ${optimizerReprojectionLabel(st)} · ${optimizerPhaseLabel(st)}`:''}${state.liveOptGate?.hardReasons?.length?` · ultimo gate: ${state.liveOptGate.hardReasons.join(', ')}`:''}${optState}`;
}

function stopPostOptimizer(){state.postOptBusy=false;state.singleOptRuntime?.stop?.();updateOptimizerUi();}
// Leaving review must never silently discard the last visible optimisation
// state. We persist the most recent preview before going back home; an
// in-flight worker iteration that has not emitted a preview is intentionally
// discarded because it has never become part of the user-visible state.
async function returnHomeFromReview(){
  const hadOptimizer=state.postOptBusy;stopPostOptimizer();
  if(state.currentSession&&state.db&&(state.gaussians.length||state.probGraph?.frames?.length)){
    await persistCurrentSession({status:hadOptimizer?'optimized':'finished',keyframes:state.reviewKeyframes||0});
    await renderSessions();
  }
  show('home');
}
function requestStopPostOptimization(){if(!state.postOptBusy)return;state.postOptBusy=false;state.singleOptRuntime?.stop?.();log.info('single-opt-review-stop-requested',{accepted:state.probOptimization?.iterations||state.liveOptAccepted?.iterations||0});updateOptimizerUi('OPT UNICO · arresto richiesto; conservo solo l’ultimo stato accettato.');}
async function startPostOptimization(){return startProbabilisticOptimization({automatic:false});}
async function startProbabilisticOptimization({automatic=false,additionalPasses=null}={}){
  if(state.postOptBusy)return;if(!state.probGraph||state.probGraph.landmarkFactors?.length<4)throw new Error('scaffold RGB insufficiente per l’ottimizzatore gerarchico');
  const runtime=await ensureSingleOptimizerRuntime();runtime.reset(state.probOptimization||state.liveOptAccepted||null);runtime.resume();state.liveOptStalled=false;state.liveOptWorkingRetained=false;state.liveOptWorkingSnapshot=null;state.liveOptCandidateStats=null;state.postOptRejectedRun=0;
  const current=Math.max(Number(state.probOptimization?.iterations||0),Number(state.liveOptAccepted?.iterations||0)),autoPasses=Math.max(2,Number(additionalPasses)||Number(CONFIG.postScanFinalOptimizationPasses)||10),target=automatic?Math.max(current+1,Math.min(CONFIG.probabilisticMaxIterations||160,current+autoPasses)):Math.max(current+1,Math.min(CONFIG.probabilisticMaxIterations||160,Math.round(Number($('optIterations')?.value)||Math.max(current+6,CONFIG.probabilisticDefaultIterations||12))));
  state.postOptBusy=true;state.postOptRunBase=current;const panorama=state.photoPanoramaState||state.liveMap?.exportState?.()||null;if(panorama?.edges?.length)state.probGraph.addPhotoEdges?.(panorama.edges);const graph=state.probGraph.exportState(),rebuildOptions={voxel:state.reviewMetricLocked?(CONFIG.denseTsdfVoxelM||.035):(CONFIG.denseTsdfVoxelAlva||.03),hashVoxel:state.reviewMetricLocked?(CONFIG.denseGaussianHashVoxelM||.02):(CONFIG.denseGaussianHashVoxelAlva||.018),maxSurfels:CONFIG.postOptimizeMaxGaussians||70000,maxTriangles:CONFIG.denseMaxMeshTriangles||90000,meshMinConfidence:CONFIG.surfaceMeshMinConfidence||.24};
  log.info(automatic?'single-opt-processing-start':'single-opt-review-start',{current,target,automatic,graph:state.probGraph.summary?.()||null,seededFrom:state.probOptimization?'review':state.liveOptAccepted?'live':'raw-scaffold',bootstrapPolicy:'RGB-only until robust reprojection is observable/stable'});if(automatic)processingSetPhase('final-opt',{index:0,total:Math.max(1,target-current),message:'Ottimizzazione globale + consenso superficie…',detail:`Scaffold + Deep + MVS pronti · target ${target-current} passaggi accettati`});else updateOptimizerUi(`OPT UNICO · ${current}/${target} · bootstrap RGB robusto prima di Deep`);
  let attempts=0,accepted=current,last=null,stalled=false,consecutiveNoWorkingProgress=0;const maxAttempts=automatic?Math.max(8,Number(CONFIG.postScanFinalOptimizationMaxAttempts)||30):Math.max(8,(target-current)*3);
  try{
    while(state.postOptBusy&&accepted<target&&attempts<maxAttempts){
      attempts++;const result=await runtime.runCycle({mode:'review',reason:automatic?'processing-final':'review-manual',graph,budgetMs:250,maxIterations:1,previewMap:false,options:{maxLandmarks:CONFIG.probabilisticMaxLandmarks||12000,maxObsPerFrame:CONFIG.probabilisticMaxObsPerFrame||280,posePriorScale:CONFIG.probabilisticPosePriorScale||1,absoluteAlvaScale:CONFIG.probabilisticAbsoluteAlvaScale||.04,depthFeedbackEvery:CONFIG.probabilisticDepthFeedbackEvery||2,rgbWarmupIterations:CONFIG.probabilisticRgbWarmupIterations||2,localWindowSize:CONFIG.liveOptSlowGraphFrames||26,localWindowOverlap:CONFIG.liveOptGraphLoopFrames||6},gateOptions:{maxReprojectionPx:CONFIG.liveOptGateMaxReprojectionPx||3.2,maxCommonTranslationJump:state.reviewMetricLocked?(CONFIG.liveOptGateMaxTranslationM||.11):(CONFIG.liveOptGateMaxTranslationAlva||.14),maxCommonRotationJumpRad:CONFIG.liveOptGateMaxRotationRad||.07,maxMeanTranslationJump:state.reviewMetricLocked?(CONFIG.liveOptGateMeanTranslationM||.045):(CONFIG.liveOptGateMeanTranslationAlva||.06)}});last=result;
      if(result.type==='single-opt-error')throw Object.assign(new Error(result.message||'single optimizer error'),{stack:result.stack||undefined});
      if(result.type==='single-opt-stalled'){
        stalled=true;state.liveOptStalled=true;state.liveOptCandidateStats=result.stats||null;state.liveOptGate=result.gate||null;state.postOptRejectedRun++;state.liveOptRejected++;log.warn('single-opt-review-stalled',{attempt:attempts,accepted,target,stallCount:result.stallCount,progress:result.progress,gate:result.gate,stats:result.stats});log.checkpoint('single-opt-review-stalled',{attempt:attempts,accepted,stallCount:result.stallCount,robustReprojectionPx:result.stats?.reprojectionRobustRmse,rawReprojectionPx:result.stats?.reprojectionRmse,medianPx:result.stats?.reprojectionMedianPx,p90Px:result.stats?.reprojectionP90Px,rgbEdges:result.stats?.edgeSwitches});break;
      }
      if(result.type==='single-opt-accepted'){
        state.liveOptAccepted=result.snapshot;state.liveOptStats=result.stats;state.liveOptCandidateStats=null;state.liveOptWorkingRetained=false;state.liveOptWorkingSnapshot=result.snapshot||null;state.liveOptStalled=false;state.liveOptGate=result.gate;state.liveOptAcceptedCount++;consecutiveNoWorkingProgress=0;accepted=Number(result.snapshot?.iterations||result.stats?.iterations||accepted+1);state.probOptimization={...(result.snapshot||{}),iterations:accepted,stats:result.stats,updatedAt:Date.now()};state.optimization={...(state.optimization||{}),iterations:accepted,lastEnergy:result.stats?.energy??state.optimization?.lastEnergy,updatedAt:Date.now()};log.decision('single-opt-review-accepted',{attempt:attempts,accepted,target,gate:result.gate,stats:result.stats});
      }else if(result.type==='single-opt-rejected'){
        state.liveOptRejected++;state.postOptRejectedRun++;state.liveOptCandidateStats=result.stats||null;state.liveOptWorkingRetained=!!result.workingRetained;state.liveOptWorkingSnapshot=result.workingSnapshot||null;state.liveOptGate=result.gate||null;if(result.workingRetained)consecutiveNoWorkingProgress=0;else consecutiveNoWorkingProgress++;log.warn('single-opt-review-rejected',{attempt:attempts,accepted,target,bootstrap:!!result.bootstrap,workingRetained:!!result.workingRetained,stallCount:result.stallCount,progress:result.progress,gate:result.gate,workingGate:result.workingGate,stats:result.stats});
        if(consecutiveNoWorkingProgress>=4){stalled=true;state.liveOptStalled=true;log.warn('single-opt-review-repeat-stop',{attempt:attempts,accepted,reason:'four cycles without accepted or retained working progress',stats:result.stats,gate:result.gate});break;}
      }else if(result.type==='single-opt-stopped'){break;}
      const shown=state.liveOptStats||state.liveOptCandidateStats,working=state.liveOptWorkingRetained?' · bootstrap interno':'';if(automatic)processingSetPhase('final-opt',{index:Math.max(0,accepted-current),total:Math.max(1,target-current),message:`Ottimizzazione globale ${Math.max(0,accepted-current)}/${Math.max(1,target-current)}`,detail:`reproj ${optimizerReprojectionLabel(shown)} · fase ${optimizerPhaseLabel(shown)}${working} · tentativi ${attempts}`});else{updateReviewUi();updateOptimizerUi(`OPT UNICO · acc ${accepted}/${target} · tentativi ${attempts} · reproj ${optimizerReprojectionLabel(shown)} · fase ${optimizerPhaseLabel(shown)}${working} · rifiutati run ${state.postOptRejectedRun}`);}await new Promise(r=>setTimeout(r,0));
    }
    if(!state.postOptBusy){if(!automatic)updateOptimizerUi('OPT UNICO fermato · stato accettato conservato.');return {stopped:true,accepted,attempts,target};}
    if(stalled&&!runtime.snapshot()?.snapshot){state.postOptBusy=false;if(!automatic){updateReviewUi();updateOptimizerUi(`OPT UNICO FERMO · bootstrap RGB non converge: ${optimizerReprojectionLabel(state.liveOptCandidateStats)} · nessuna geometria accettata modificata. Acquisire nuovi overlap/parallasse o esportare la diagnostica.`);}else processingSetPhase('final-opt',{index:0,total:1,message:'Scaffold RGB non converge · superficie non autorizzata',detail:'Il TEST indicherà il primo vincolo insufficiente.'});return {stalled:true,accepted,attempts,target,rebuilt:null};}
    const rebuilt=await runtime.rebuildAccepted(graph,{optimizer:{maxLandmarks:CONFIG.probabilisticMaxLandmarks||12000,maxObsPerFrame:CONFIG.probabilisticMaxObsPerFrame||280,posePriorScale:CONFIG.probabilisticPosePriorScale||1,absoluteAlvaScale:CONFIG.probabilisticAbsoluteAlvaScale||.04,depthFeedbackEvery:CONFIG.probabilisticDepthFeedbackEvery||2,rgbWarmupIterations:CONFIG.probabilisticRgbWarmupIterations||2,globalLinePasses:CONFIG.postScanRgbGlobalLinePasses||36},rebuild:rebuildOptions});
    const rebuiltPolicy=rebuilt?.map?.stats?.geometryPolicy||null,rebuiltDepthPolicy=rebuilt?.map?.stats?.depthGeometryPolicy||null,rebuiltMvs=rebuilt?.map?.stats?.mvsValidation||null,geometryReady=rebuiltPolicy?.commitReady!==false&&!rebuilt?.withheldReason;
    if(rebuilt?.withheldReason){const diagnosticCandidate=rebuilt?.map?.gaussians||[],diagnosticMesh=rebuilt?.map?.mesh?.vertices?.length?rebuilt.map.mesh:null;state.denseCandidateGaussians=diagnosticCandidate;state.denseCandidateMesh=diagnosticMesh;state.gaussians=[];state.mesh=null;state.meshStale=true;state.geometryCommitted=false;window.__ROOMSCAN_METRIC_MESH=null;const candidateMeshVisible=!!(diagnosticMesh&&rebuiltPolicy?.topologyCoherent&&rebuiltPolicy?.denseAuthorityReady!==false),visibleCandidate=surfaceGaussiansForDisplay(diagnosticCandidate,{mode:'candidate',source:'review-candidate'});state.surfaceStats={...(state.surfaceStats||{}),committed:false,committedGaussians:0,committedFaces:0,candidateGaussians:diagnosticCandidate.length,candidateFaces:diagnosticMesh?.faces?.length?diagnosticMesh.faces.length/3:0,candidateMeshDisplaySuppressed:!!diagnosticMesh&&!candidateMeshVisible,withheldReason:rebuilt.withheldReason,geometryPolicy:rebuiltPolicy,depthGeometryPolicy:rebuiltDepthPolicy,mvsValidation:rebuiltMvs,globalSurfaceConsensus:rebuilt.map?.stats?.globalSurfaceConsensus||null,rawMeshQuality:rebuilt.map?.stats?.rawMeshQuality||null,meshCleanup:rebuilt.map?.stats?.meshCleanup||null,meshQuality:rebuilt.map?.stats?.meshQuality||null};state.renderer?.setData(visibleCandidate,{fit:false});state.renderer?.setMesh(candidateMeshVisible?diagnosticMesh:null);state.renderer?.draw();if(diagnosticCandidate.length||diagnosticMesh)updateOptimizerUi(`CANDIDATO NON COMMITTED · ${diagnosticCandidate.length} GS${diagnosticMesh?.faces?.length?` · ${diagnosticMesh.faces.length/3} facce`:''} · export disabilitato · ${rebuilt.withheldReason}`);log.warn('diagnostic-candidate-surface-visible',{reason:rebuilt.withheldReason,candidateGaussians:diagnosticCandidate.length,visibleGaussians:visibleCandidate.length,candidateFaces:diagnosticMesh?.faces?.length?diagnosticMesh.faces.length/3:0,candidateMeshDisplaySuppressed:!!diagnosticMesh&&!candidateMeshVisible,exportDisabled:true,geometryPolicy:rebuiltPolicy,depthGeometryPolicy:rebuiltDepthPolicy,mvsValidation:rebuiltMvs});log.warn('committed-surface-withheld',{reason:rebuilt.withheldReason,geometryPolicy:rebuiltPolicy,depthGeometryPolicy:rebuiltDepthPolicy,mvsValidation:rebuiltMvs,rgbEdges:rebuilt.stats?.edgeSwitches||rebuilt.map?.stats?.edgeSwitches||null,alvaEdges:rebuilt.stats?.alvaSwitches||rebuilt.map?.stats?.alvaSwitches||null,reprojectionRobustRmse:rebuilt.stats?.reprojectionRobustRmse??null,advice:'geometry remains diagnostic/candidate-only until global RGB, depth observability and topology checks agree'});}
    if(rebuilt?.map){const committed=rebuilt.map.gaussians||[],mq=rebuilt.map.stats?.meshQuality||null,mvsV=rebuiltMvs;state.probOptimized={previewGaussians:geometryReady?committed:[],candidateGaussians:[...(rebuilt.map.candidateGaussians||[]),...(!geometryReady?committed:[])],mapStats:rebuilt.map.stats};if(committed.length&&geometryReady){state.gaussians=committed;state.mesh=rebuilt.map.mesh?.vertices?.length?rebuilt.map.mesh:null;window.__ROOMSCAN_METRIC_MESH=state.mesh;state.meshStale=!state.mesh;state.geometryCommitted=true;state.surfaceStats={...(state.surfaceStats||{}),committed:true,committedGaussians:state.gaussians.length,committedFaces:state.mesh?.faces?.length?state.mesh.faces.length/3:0,meshQuality:mq,rawMeshQuality:rebuilt.map.stats?.rawMeshQuality||null,meshCleanup:rebuilt.map.stats?.meshCleanup||null,globalSurfaceConsensus:rebuilt.map.stats?.globalSurfaceConsensus||null,geometryPolicy:rebuiltPolicy,depthGeometryPolicy:rebuiltDepthPolicy,surfaceLayers:rebuilt.map.mesh?.surfaceLayers??null,meshedSurfelFraction:rebuilt.map.mesh?.meshedSurfelFraction??null,eligibleCommittedFrames:rebuilt.map.stats?.eligibleCommittedFrames??null,excludedUnacceptedFrames:rebuilt.map.stats?.excludedUnacceptedFrames??null,mvsValidation:mvsV};const visibleCommitted=surfaceGaussiansForDisplay(state.gaussians,{mode:'review',source:'review-committed-rebuild'});state.renderer?.setData(visibleCommitted,{fit:false});state.renderer?.setMesh(state.mesh);state.renderer?.draw();if(mvsV&&mvsV.commitFraction<.25)log.warn('committed-mvs-support-low',{mvsValidation:mvsV,advice:'most MVS proposals lack final-pose depth observability; surface is intentionally sparse rather than fabricated'});}else if(!rebuilt?.withheldReason){state.gaussians=[];state.mesh=null;state.meshStale=true;state.geometryCommitted=false;window.__ROOMSCAN_METRIC_MESH=null;const reason=rebuiltPolicy?.reason||(committed.length?'final-geometry-policy-rejected':'no-dense-evidence-survived-final-pose-validation');state.surfaceStats={...(state.surfaceStats||{}),committed:false,committedGaussians:0,committedFaces:0,withheldReason:reason,meshQuality:mq,rawMeshQuality:rebuilt.map.stats?.rawMeshQuality||null,meshCleanup:rebuilt.map.stats?.meshCleanup||null,globalSurfaceConsensus:rebuilt.map.stats?.globalSurfaceConsensus||null,geometryPolicy:rebuiltPolicy,depthGeometryPolicy:rebuiltDepthPolicy,mvsValidation:mvsV};state.renderer?.setData([],{fit:false});state.renderer?.setMesh(null);state.renderer?.draw();log.warn('committed-surface-withheld',{reason,geometryPolicy:rebuiltPolicy,depthGeometryPolicy:rebuiltDepthPolicy,mvsValidation:mvsV,depthCalibration:rebuilt.map.stats?.depthCalibration||null,rgbEdges:rebuilt.map.stats?.edgeSwitches||null});}}
    log.info(automatic?'single-opt-processing-complete':'single-opt-review-complete',{accepted,attempts,target,stalled,automatic,stats:state.liveOptStats,map:rebuilt?.map?.stats||null,graph:state.probGraph.summary?.()||null});state.postOptBusy=false;await persistCurrentSession({status:'optimized',keyframes:state.reviewKeyframes||0}).catch(err=>log.warn('single-opt-persist',{message:err?.message||String(err)}));await renderSessions().catch(()=>{});if(automatic){collectPipelineTestSnapshot();processingSetPhase('final-opt',{index:Math.max(1,target-current),total:Math.max(1,target-current),message:state.geometryCommitted?'Geometria globale committed':'Geometria non committed · TEST identifica il blocker',detail:`GS ${state.gaussians.length} · facce ${state.mesh?.faces?.length?state.mesh.faces.length/3:0} · ${state.surfaceStats?.geometryPolicy?.reason||state.surfaceStats?.withheldReason||'ok'}`});}else{updateReviewUi();updateOptimizerUi(stalled?`OPT UNICO fermato in modo conservativo · ${accepted} iterazioni accettate / ${attempts} tentativi · ultimo stato accettato preservato.`:`OPT UNICO completato · ${accepted} iterazioni accettate / ${attempts} tentativi · committed ${state.gaussians.length}${state.mesh?` · ${state.mesh.faces.length/3} facce`:''}.`);}return {rebuilt,accepted,attempts,target,stalled,geometryCommitted:state.geometryCommitted};
  }catch(err){state.postOptBusy=false;log.error('single-opt-review-error',{message:err?.message||String(err),stack:err?.stack||null,last});log.checkpoint('single-opt-review-error',{message:err?.message||String(err),graph:state.probGraph.summary?.()||null});persistEmergencyDiagnostics('single-opt-review-error');updateOptimizerUi(`OPT UNICO ERRORE · ${err?.message||err}`);throw err;}
}

function formatDistance(v,metric){if(!Number.isFinite(v))return '—';return metric?`${(v*1000).toFixed(2)} mm`:`${v.toExponential(2)} u.Alva`;}

async function loadSavedSession(id){
  if(!state.db)throw new Error('storage locale non disponibile');stopPostOptimizer();const bundle=await state.db.loadSessionBundle(id);if(!bundle?.session)throw new Error('sessione non trovata');if(!bundle.snapshot?.gaussians?.length&&!bundle.snapshot?.factorGraph?.frames?.length)throw new Error('questa sessione precedente non contiene né mappa 3D né factor graph fotografico ricaricabile');
  state.surfaceStats=null;state.currentSession=bundle.session;state.gaussians=bundle.snapshot.gaussians||[];state.denseCandidateGaussians=[];state.denseCandidateMesh=null;state.geometryCommitted=!!bundle.snapshot.geometryCommitted;state.optimizerObservations=bundle.snapshot.optimizerObservations||null;state.optimization={iterations:0,lastEnergy:null,...(bundle.snapshot.optimization||{})};state.probOptimization=bundle.snapshot.probOptimization||bundle.snapshot.liveOptimization?.snapshot||null;state.probOptimized=null;state.photoPanoramaState=bundle.snapshot.photoPanorama||null;const savedLive=bundle.snapshot.liveOptimization||null;state.liveOptAccepted=savedLive?.snapshot||state.probOptimization||null;state.liveOptStats=savedLive?.stats||state.probOptimization?.stats||null;state.liveOptCandidateStats=null;state.liveOptWorkingSnapshot=state.liveOptAccepted;state.liveOptWorkingRetained=false;state.liveOptStalled=false;state.liveOptGate=savedLive?.gate||null;state.liveOptAcceptedCount=Math.max(Number(savedLive?.accepted)||0,Number(state.liveOptAccepted?.iterations)||0);state.liveOptRejected=Number(savedLive?.rejected)||0;
  if(bundle.snapshot.factorGraph){const {ProbabilisticFactorGraph}=await lazy('./probabilistic/factor_graph.js');state.probGraph=ProbabilisticFactorGraph.fromState(bundle.snapshot.factorGraph);}else state.probGraph=null;
  if(bundle.snapshot.deepSequence){const {DeepSequenceModel}=await lazy('./probabilistic/deep_sequence_model.js');state.deepSequence=new DeepSequenceModel().importState(bundle.snapshot.deepSequence);}else state.deepSequence=null;
  state.denseDepthSamples=bundle.snapshot.denseSamples||bundle.session.counts?.denseSamples||0;state.deepRaySamples=bundle.snapshot.deepRaySamples||0;state.reviewMetricLocked=bundle.snapshot.metricLocked??bundle.session.metricLocked??null;state.reviewKeyframes=bundle.snapshot.keyframes||bundle.session.counts?.keyframes||0;state.lastTracking=null;state.mesh=state.geometryCommitted?decodeStoredMesh(bundle.mesh):null;state.meshStale=!state.geometryCommitted||!!bundle.mesh?.stale;const savedBuild=buildIdOf(bundle.snapshot.build||bundle.session.build),provenance=bundle.snapshot.evidenceProvenance||null;state.evidenceSourceBuild=provenance?.sourceBuild||savedBuild||BUILD.id;const graphSummary=state.probGraph?.summary?.()||null;state.denseEvidenceStatus={sourceBuild:state.evidenceSourceBuild,poseBound:graphSummary?.mvsPoseBoundFactors||0,poseUnbound:graphSummary?.mvsPoseUnboundFactors||0,loaded:true};
  const legacyRevalidatable=!!(state.probGraph?.frames?.length&&((savedBuild&&savedBuild!==BUILD.id)||(graphSummary?.mvsPoseUnboundFactors||0)>0));
  if(legacyRevalidatable){state.denseCandidateGaussians=state.gaussians||[];state.denseCandidateMesh=state.mesh;state.gaussians=[];state.mesh=null;state.meshStale=true;state.geometryCommitted=false;window.__ROOMSCAN_METRIC_MESH=null;log.warn('legacy-geometry-withheld',{savedBuild,currentBuild:BUILD.id,evidenceSourceBuild:state.evidenceSourceBuild,mvsPoseUnboundFactors:graphSummary?.mvsPoseUnboundFactors||0,candidateGaussians:state.denseCandidateGaussians.length,candidateMeshFaces:state.denseCandidateMesh?.faces?.length?state.denseCandidateMesh.faces.length/3:0,reason:'pose-bound-dense-revalidation-required'});}else window.__ROOMSCAN_METRIC_MESH=committedMeshAvailable()?state.mesh:null;
  state.optimization={...state.optimization,iterations:effectiveOptimizationIterations()};log.info('session-loaded',{id,geometryCommitted:!!state.geometryCommitted,gaussians:state.gaussians.length,candidateGaussians:state.denseCandidateGaussians?.length||0,optimizerObservations:state.optimizerObservations?.count||0,factorGraph:graphSummary,iterations:effectiveOptimizationIterations(),meshStale:state.meshStale,savedBuild:savedBuild||null,evidenceProvenance:provenance||null,denseEvidenceStatus:state.denseEvidenceStatus});await showReview();
}

function decodeStoredMesh(m){if(!m?.vertices?.length)return null;return {...m,vertices:m.vertices instanceof Float32Array?m.vertices:new Float32Array(m.vertices||[]),colors:m.colors instanceof Uint8Array?m.colors:new Uint8Array(m.colors||[]),faces:m.faces instanceof Uint32Array?m.faces:new Uint32Array(m.faces||[])};}
function buildIdOf(x){if(!x)return '';if(typeof x==='string')return x;return String(x.id||x.version||'');}
async function renderSessions(){
  if(!state.db)return;const [sessions,snapshots]=await Promise.all([state.db.getAll('sessions'),state.db.getAll('snapshots')]),saved=new Set(snapshots.filter(x=>x?.gaussians?.length||x?.factorGraph?.frames?.length).map(x=>x.id)),xs=sessions.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,8),el=$('savedSessions');if(!el)return;el.textContent='';if(!xs.length){el.innerHTML='<span class="muted">Nessuna sessione salvata.</span>';return;}
  for(const s of xs){const row=document.createElement('div');row.className='savedSessionRow status';const info=document.createElement('span');info.textContent=`${new Date(s.createdAt).toLocaleString()} · ${s.status||'sessione'} · KF ${s.counts?.keyframes||0} · GS ${s.counts?.gaussians||0}${s.optimizationIterations?` · opt ${s.optimizationIterations}`:''}`;const b=document.createElement('button');b.textContent=saved.has(s.id)?'Apri 3D':'Dati 3D non salvati';b.disabled=!saved.has(s.id);if(!b.disabled)b.addEventListener('click',safe('load-saved-session',()=>loadSavedSession(s.id)));row.append(info,b);el.appendChild(row);}
}
async function runTests(){const {runSelfTests}=await lazy('./self_test.js');const out=await runSelfTests(log),ok=out.filter(x=>x.ok).length;if($('selfTestSummary'))$('selfTestSummary').textContent=`Self-test: ${ok}/${out.length} PASS`;if($('diagLive'))$('diagLive').textContent=out.map(x=>`${x.ok?'PASS':'FAIL'} ${x.name}${x.ok?'':`: ${x.error}`}`).join('\n');if($('diagPanel'))$('diagPanel').open=true;}
async function clearCachesAndReload(){try{const regs=await navigator.serviceWorker?.getRegistrations?.()||[];for(const reg of regs){let own=false;try{own=new URL(reg.scope).pathname.includes('/room_scanner/v30/');}catch{}if(!own)continue;try{reg.active?.postMessage({type:'CLEAR_V30_SHELL'});await reg.unregister();}catch{}}if(window.caches)for(const k of await caches.keys())if(/^room-scanner-v.*-shell$/.test(k))await caches.delete(k);try{for(const k of Object.keys(sessionStorage))if(k.startsWith('roomscan-v30-atomic-recovery-'))sessionStorage.removeItem(k);}catch{}}catch(err){log.warn('force-update-cleanup',{message:err?.message||String(err)});}location.replace(`${location.pathname}?v30reset=${BUILD.version}-${Date.now()}`);}
async function loadPly(file){const {parsePly}=await lazy('./formats.js');stopPostOptimizer();state.currentSession=null;state.surfaceStats=null;state.gaussians=parsePly(await file.text());state.denseCandidateGaussians=[];state.denseCandidateMesh=null;state.optimizerObservations=null;state.probGraph=null;state.probOptimization=null;state.liveOptAccepted=null;state.optimization={iterations:0,lastEnergy:null};state.mesh=null;state.meshStale=false;state.geometryCommitted=!!state.gaussians.length;state.evidenceSourceBuild='external-ply';state.reviewMetricLocked=null;state.reviewKeyframes=0;await showReview();}
async function loadR30(file){const {decodeR30}=await lazy('./formats.js');stopPostOptimizer();const x=await decodeR30(file);state.surfaceStats=null;state.currentSession=null;state.gaussians=x.gaussians||x.snapshot?.gaussians||[];state.denseCandidateGaussians=[];state.denseCandidateMesh=null;state.optimizerObservations=null;const savedLive=x.evidence?.liveOptimization||x.liveOptimization||null;state.probOptimization=x.evidence?.probOptimization||x.probOptimization||savedLive?.snapshot||null;state.liveOptAccepted=savedLive?.snapshot||state.probOptimization||null;state.liveOptStats=savedLive?.stats||state.probOptimization?.stats||null;state.liveOptGate=savedLive?.gate||null;state.liveOptAcceptedCount=Math.max(Number(savedLive?.accepted)||0,Number(state.liveOptAccepted?.iterations)||0);state.liveOptRejected=Number(savedLive?.rejected)||0;state.optimization={iterations:Number(x.optimization?.iterations)||0,lastEnergy:x.optimization?.lastEnergy??null};state.geometryCommitted=!!(x.geometryCommitted??x.snapshot?.geometryCommitted);state.mesh=state.geometryCommitted&&x.mesh?{...x.mesh,vertices:new Float32Array(x.mesh.vertices||[]),colors:new Uint8Array(x.mesh.colors||[]),faces:new Uint32Array(x.mesh.faces||[])}:null;state.meshStale=!state.geometryCommitted;state.reviewMetricLocked=x.metricLocked??null;state.reviewKeyframes=x.reconstruction?.keyframes||0;state.denseDepthSamples=Number(x.reconstruction?.denseSamples)||0;state.photoPanoramaState=x.evidence?.photoPanorama||x.photoPanorama||null;if(x.evidence?.factorGraph){const {ProbabilisticFactorGraph}=await lazy('./probabilistic/factor_graph.js');state.probGraph=ProbabilisticFactorGraph.fromState(x.evidence.factorGraph);}else state.probGraph=null;if(x.evidence?.deepSequence){const {DeepSequenceModel}=await lazy('./probabilistic/deep_sequence_model.js');state.deepSequence=new DeepSequenceModel().importState(x.evidence.deepSequence);}else state.deepSequence=null;const savedBuild=buildIdOf(x.build||x.snapshot?.build),provenance=x.evidence?.provenance||x.evidenceProvenance||null;state.evidenceSourceBuild=provenance?.sourceBuild||savedBuild||BUILD.id;const graphSummary=state.probGraph?.summary?.()||null;state.denseEvidenceStatus={sourceBuild:state.evidenceSourceBuild,poseBound:graphSummary?.mvsPoseBoundFactors||0,poseUnbound:graphSummary?.mvsPoseUnboundFactors||0,loadedR30:true};const legacyRevalidatable=!!(state.probGraph?.frames?.length&&((savedBuild&&savedBuild!==BUILD.id)||(graphSummary?.mvsPoseUnboundFactors||0)>0));if(legacyRevalidatable){state.denseCandidateGaussians=state.gaussians;state.denseCandidateMesh=state.mesh;state.gaussians=[];state.mesh=null;state.meshStale=true;state.geometryCommitted=false;window.__ROOMSCAN_METRIC_MESH=null;log.warn('legacy-r30-geometry-withheld',{savedBuild,currentBuild:BUILD.id,evidenceSourceBuild:state.evidenceSourceBuild,mvsPoseUnboundFactors:graphSummary?.mvsPoseUnboundFactors||0,reason:'pose-bound-dense-revalidation-required'});}state.optimization={...state.optimization,iterations:effectiveOptimizationIterations()};await showReview();}
async function exportPly(){if(!committedGeometryAvailable())throw new Error('La superficie visibile non è committed: export PLY disabilitato.');const {gaussiansToPly,downloadBlob}=await lazy('./formats.js');downloadBlob(new Blob([gaussiansToPly(state.gaussians,BUILD.id)],{type:'application/octet-stream'}),`roomscan-${Date.now()}.ply`);}
async function exportR30(){const {encodeR30,downloadBlob}=await lazy('./formats.js'),factorGraph=state.probGraph?.exportState?.()||state.probGraph||null,deepSequence=state.deepSequence?.exportState?.()||null,photoPanorama=state.liveMap?.exportState?.()||state.photoPanoramaState||null,effectiveIterations=effectiveOptimizationIterations(),provenance=currentEvidenceProvenance();downloadBlob(encodeR30({build:BUILD,calibration:calibration(),gaussians:committedGeometryAvailable()?state.gaussians:[],mesh:committedMeshAvailable()?{vertices:Array.from(state.mesh.vertices||[]),colors:Array.from(state.mesh.colors||[]),faces:Array.from(state.mesh.faces||[]),voxelM:state.mesh.voxelM}:null,geometryCommitted:!!state.geometryCommitted,optimization:{...(state.optimization||{}),iterations:effectiveIterations},metricLocked:state.reviewMetricLocked??!!state.slam?.metricLocked,evidence:{factorGraph,deepSequence,photoPanorama,probOptimization:state.probOptimization||state.liveOptAccepted||null,liveOptimization:state.liveOptAccepted?{snapshot:state.liveOptAccepted,stats:state.liveOptStats,gate:state.liveOptGate,accepted:state.liveOptAcceptedCount,rejected:state.liveOptRejected}:null,provenance},reconstruction:{type:'single-hierarchical-probabilistic-joint-optimizer',denseSamples:state.denseDepthSamples,deepRaySamples:state.deepRaySamples||0,keyframes:state.reviewKeyframes||state.slam?.keyframes?.length||0}}),`roomscan-${Date.now()}.r30`);}

async function downloadMeshPly(m,label='mesh'){const {downloadBlob}=await lazy('./formats.js'),V=m.vertices,C=m.colors||[],F=m.faces||[],nv=V.length/3,nf=F.length/3,lines=['ply','format ascii 1.0',`comment Room Scanner ${BUILD.version} ${label}`,`element vertex ${nv}`,'property float x','property float y','property float z','property uchar red','property uchar green','property uchar blue',`element face ${nf}`,'property list uchar int vertex_indices','end_header'];for(let i=0;i<nv;i++)lines.push(`${V[i*3]} ${V[i*3+1]} ${V[i*3+2]} ${C[i*3]??180} ${C[i*3+1]??180} ${C[i*3+2]??180}`);for(let i=0;i<nf;i++)lines.push(`3 ${F[i*3]} ${F[i*3+1]} ${F[i*3+2]}`);downloadBlob(new Blob([lines.join('\n')+'\n'],{type:'application/octet-stream'}),`roomscan-${label}-${Date.now()}.ply`);}
async function exportMeshPly(){if(!state.geometryCommitted)throw new Error('La mesh visibile non è committed: export TSDF disabilitato.');if(state.meshStale)throw new Error('La mesh precedente non è coerente con le Gaussiane ottimizzate: va rigenerata.');if(!state.mesh?.vertices?.length)throw new Error('Mesh TSDF non ancora disponibile');await downloadMeshPly(state.mesh,'mesh-base');}

function bind(){on('calibrateBtn','click',safe('begin-calibration',beginCalibration));on('clearCalibrationBtn','click',()=>{localStorage.removeItem(CONFIG.calibrationStorageKey);updateCalibrationUi();});on('calibAddPinBtn','click',safe('add-calibration-pin',addCalibrationPin));on('calibUndoPinBtn','click',()=>{state.calibrator?.undoLastTarget();updateProgress(state.calibrator?.quality());});on('calibFinishBtn','click',safe('finish-calibration',finishCalibration));on('calibCancelBtn','click',safe('cancel-calibration',cancelCalibration));on('startBtn','click',safe('begin-bridge',beginBridge));on('bridgeRetryBtn','click',safe('retry-bridge',beginBridge));on('bridgeCancelBtn','click',()=>{state.bridgeEpoch++;state.bridgeTransition=false;state.bridge?.stop();state.bridge=null;show('home');});on('finishBtn','click',safe('finish-scan',finishScan));on('backHomeBtn','click',safe('review-home',returnHomeFromReview));on('resumeBtn','click',safe('resume-scan',beginBridge));on('liveMapPhotoBtn','click',()=>setLiveMapMode('photo'));on('liveMapDepthBtn','click',()=>setLiveMapMode('depth'));on('scanDiagnosticsToggle','click',toggleScanDiagnostics);on('scanDiagnosticsClose','click',()=>setScanDiagnosticsOpen(false));on('scanExportDiagBtn','click',()=>{log.checkpoint('manual-single-optimizer-export',{graph:state.probGraph?.summary?.()||null,optimizer:'ProbabilisticJointOptimizer',execution:'main-thread-timesliced',liveOptimizer:state.liveOptStats||null,liveCandidate:state.liveOptCandidateStats||null,workingRetained:state.liveOptWorkingRetained,stalled:state.liveOptStalled,liveGate:state.liveOptGate||null,liveMap:state.liveMap?.stats?.()||null,preview:{anchors:state.liveOptAcceptedAnchors?.length||0,surfels:state.liveOptPreviewGaussians?.length||0},scheduler:{backoff:state.liveOptBackoff,inFlight:state.liveOptInFlight,lastElapsedMs:state.liveOptLastElapsedMs,lastReason:state.liveOptLastReason,reviewRejectedRun:state.postOptRejectedRun}});log.download(`roomscan-live-${Date.now()}.json`,{exportReason:'manual-live'});});on('fitBtn','click',()=>{state.renderer?.fit();state.renderer?.draw();});on('viewTopBtn','click',()=>state.renderer?.setPreset('top'));on('viewFrontBtn','click',()=>state.renderer?.setPreset('front'));on('viewSideBtn','click',()=>state.renderer?.setPreset('side'));on('arModeBtn','click',()=>{const mode=state.liveOverlay?.cycleMode()||'off';const b=$('arModeBtn');if(b)b.textContent=`AR: ${mode==='gs'?'Surface':mode==='mesh'?'Mesh':mode==='both'?'Surface+Mesh':'Off'}`;});on('splatSize','input',e=>state.renderer?.setSplatSize(e.target.value));on('optIterations','input',()=>updateOptimizerUi());on('optStartBtn','click',safe('post-optimize',startPostOptimization));on('optStopBtn','click',requestStopPostOptimization);on('loadPlyBtn','click',()=>$('filePly')?.click());on('filePly','change',safe('load-ply',async e=>{if(e.target.files?.[0])await loadPly(e.target.files[0]);e.target.value='';}));on('loadR30Btn','click',()=>$('fileR30')?.click());on('fileR30','change',safe('load-r30',async e=>{if(e.target.files?.[0])await loadR30(e.target.files[0]);e.target.value='';}));on('exportPlyBtn','click',safe('export-ply',exportPly));on('exportR30Btn','click',safe('export-r30',exportR30));on('buildMetricMeshBtn','click',safe('export-mesh',exportMeshPly));on('exportDiagBtn','click',()=>log.download());on('pipelineTestRefreshBtn','click',()=>updatePipelineTestUi(true));on('pipelineTestExportBtn','click',safe('pipeline-test-export',exportPipelineTestSnapshot));on('pipelineTestPanel','toggle',()=>{if($('pipelineTestPanel')?.open)updatePipelineTestUi(true);});on('diagDownloadBtn','click',()=>log.download());on('diagCopyBtn','click',()=>navigator.clipboard?.writeText(log.text()).catch(()=>{}));on('selfTestBtn','click',safe('self-test',runTests));on('forceUpdateBtn','click',safe('force-update',clearCachesAndReload));on('diagForceUpdateBtn','click',safe('force-update',clearCachesAndReload));on('pinBtn','click',safe('manual-scan-pin',async()=>{const pose=state.slam?.pose;if(!pose||!state.liveOverlay)throw new Error('AlvaAR non ha ancora una posa valida');const {qRotate}=await lazy('./slam/math.js');const d=qRotate(pose.q,[0,0,1]),distance=state.slam.metricLocked?1.25:1;const p=[pose.p[0]+d[0]*distance,pose.p[1]+d[1]*distance,pose.p[2]+d[2]*distance];state.liveOverlay.setReferencePoint(p);const b=$('pinBtn');if(b)b.textContent='◎ Repere ✓';log.info('manual-scan-pin',{pose,point:p,metricLocked:state.slam.metricLocked});}));log.addEventListener('entry',()=>{const live=$('diagLive');if(live&&$('diagPanel')?.open)live.textContent=log.entries.slice(-80).map(x=>`${new Date(x.at).toLocaleTimeString()} ${x.level.toUpperCase()} ${x.event} ${JSON.stringify(x.data)}`).join('\n');});}

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
