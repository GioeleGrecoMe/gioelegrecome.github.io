/* Room Scanner diagnostic-only Service Worker v1.0.
 * Network-only for diagnostic clients, no stale shell/model cache, injects the
 * recorder and an internal module bridge into the CURRENT published HTML.
 */
'use strict';
const DIAG_BUILD='rsdiag-20260815-5';
const SOURCE_CACHE='room-scanner-diag-source-v2';
const SOURCE_KEY=new URL('./__rsdiag_original_source.html',self.location.href).href;
const diagClients=new Set();
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(n=>/room|scanner|acoustic|semantic|depth|951|mobile.?sam|onnx|ort/i.test(n)).map(n=>caches.delete(n)));
  await self.clients.claim();
})()));
function post(clientId,type,payload){if(!clientId)return;self.clients.get(clientId).then(c=>c?.postMessage({__rsdiag:true,type,payload})).catch(()=>{})}
function bridgeCode(){return String.raw`
;(()=>{
  const D=globalThis.RoomScannerDiagnostics;
  const safe=(f,d=null)=>{try{return f()}catch(e){D?.event?.('bridge.read.error',{error:e});return d}};
  const vec=v=>v?{x:v.x,y:v.y,z:v.z}:null;
  const bridge={version:'rsdiag-bridge-20260815-2',snapshot:()=>({
    appBuild:safe(()=>typeof APP_BUILD!=='undefined'?APP_BUILD:null),deployRev:safe(()=>typeof DEPLOY_REV!=='undefined'?DEPLOY_REV:null),
    workflow:{stage:safe(()=>S.workflowStage),flowStep:safe(()=>S.flow?.step),flowHistory:safe(()=>S.flow?.history?.slice(-24),[]),recording:safe(()=>S.recording),session:safe(()=>!!S.session),profile:safe(()=>S.profile),measurementPaused:safe(()=>S.flow?.measurementPaused),xrStartup:safe(()=>({inProgress:S.xrStartupInProgress,error:S.xrStartupError,firstPose:S.xrFirstPoseSeenAt}))},
    calibration:{valid:safe(()=>!!S.calibration?.valid),done:safe(()=>!!S.calibration?.done),audioPrepared:safe(()=>!!S.audioPrepared),band:safe(()=>S.calibration?.band||null)},
    geometry:{surfels:safe(()=>S.surfels?.size,0),free:safe(()=>S.free?.size,0),rawMeshes:safe(()=>S.rawMeshes?.size,0),rawPlanes:safe(()=>S.rawPlanes?.size,0),mapFrames:safe(()=>S.mapFrames?.length,0),mapFrameSeq:safe(()=>S.mapFrameSeq,0),depthFrames:safe(()=>S.depthFrames,0),depthPoints:safe(()=>S.depthPoints,0),pathBest:safe(()=>S.bestPath?.length,0),pathRaw:safe(()=>S.rawPath?.length,0),pathLength:safe(()=>S.pathLength,0),geometryGaussians:safe(()=>S.geometryGaussians?.length,0),splat:safe(()=>({exists:!!S.splat,visible:S.splat?.visible,groupVisible:S.reconGroup?.visible,rawVisible:S.rawGroup?.visible,primaryVisible:S.primarySurfaceGroup?.visible,reconChildren:S.reconGroup?.children?.length,rawChildren:S.rawGroup?.children?.length,primaryChildren:S.primarySurfaceGroup?.children?.length}))},
    camera:{videoMode:safe(()=>S.videoMode),cameraBinding:safe(()=>!!S.cameraBinding),readbackFailed:safe(()=>S.cameraReadbackFailed),latestRGB:safe(()=>S.latestCameraRGB?{width:S.latestCameraRGB.width,height:S.latestCameraRGB.height,t:S.latestCameraRGB.t}:null),latestView:safe(()=>!!S.latestCameraView),videoFrames:safe(()=>S.videoFrames?.length,0)},
    semantic:{mode:safe(()=>S.semantic?.mode),backend:safe(()=>S.semantic?.backend),status:safe(()=>S.semantic?.status),modelSource:safe(()=>S.semantic?.modelSource),runtimeSource:safe(()=>S.semantic?.runtimeSource),provider:safe(()=>S.semantic?.activeProvider),family:safe(()=>S.semantic?.family),modelError:safe(()=>S.semantic?.modelError),preflightError:safe(()=>S.semantic?.preflightError),frames:safe(()=>S.semantic?.frames,0),neuralFrames:safe(()=>S.semantic?.neuralFrames,0),fallbackFrames:safe(()=>S.semantic?.fallbackFrames,0),frameRejected:safe(()=>S.semantic?.frameRejected,0),lastInferenceMs:safe(()=>S.semantic?.lastInferenceMs),encoder:safe(()=>!!S.semantic?.encoder),decoder:safe(()=>!!S.semantic?.decoder),encoderVariant:safe(()=>S.semantic?.encoderVariant),decoderVariant:safe(()=>S.semantic?.decoderVariant),lastSelfTest:safe(()=>S.semantic?.lastSelfTest||null),objects:safe(()=>S.semantic?.objects?.map(o=>({id:o.id,name:o.name,kind:o.kind,confidence:o.confidence,seeded:o.seeded,supportFrames:o.supportFrames,observedSurfels:o.observedSurfels,captureSummary:o.captureSummary})).slice(-20),[])},
    objectSeed:safe(()=>({active:S.objectSeeding?.active,busy:S.objectSeeding?.busy,navBusy:S.objectSeeding?.navBusy,unavailable:S.objectSeeding?.unavailable,snapshotFrameId:S.objectSeeding?.snapshotFrameId,reviewFrameId:S.objectSeeding?.reviewFrameId,freezeActive:S.objectSeeding?.freezeActive,readiness:S.objectSeeding?.readiness,promptUV:S.objectSeeding?.promptUV,roiUV:S.objectSeeding?.roiUV,inferenceProgress:S.objectSeeding?.inferenceProgress,pending:S.objectSeeding?.pending?{frameId:S.objectSeeding.pending.F?.id,backend:S.objectSeeding.pending.backend,candidate:{iou:S.objectSeeding.pending.candidate?.iou,confidence:S.objectSeeding.pending.candidate?.confidence,metricReady:S.objectSeeding.pending.candidate?.metricReady,points:S.objectSeeding.pending.candidate?.pts?.length,directDepthPoints:S.objectSeeding.pending.candidate?.directDepthPoints,projectedSurfelPoints:S.objectSeeding.pending.candidate?.projectedSurfelPoints,depthAnything:S.objectSeeding.pending.candidate?.depthAnything}}:null,currentCapture:S.objectSeeding?.currentCapture?{views:S.objectSeeding.currentCapture.views?.length,name:S.objectSeeding.currentCapture.name}:null})),
    depthAI:safe(()=>({enabled:S.depthAI?.enabled,status:S.depthAI?.status,provider:S.depthAI?.provider,modelSource:S.depthAI?.modelSource,runtimeSource:S.depthAI?.runtimeSource,lastError:S.depthAI?.lastError,lastInferenceMs:S.depthAI?.lastInferenceMs,fusedFrames:S.depthAI?.fusedFrames,fusedPoints:S.depthAI?.fusedPoints,rejectedFrames:S.depthAI?.rejectedFrames,liveRuns:S.depthAI?.liveRuns,keyframes:S.depthAI?.keyframes?.length,reviewSelectedId:S.depthAI?.reviewSelectedId,reviewFrames:S.depthAI?.reviewFrames?.map(r=>({frameId:r.id,manual:r.manual,state:r.state,points:r.points,quality:r.quality,inferenceMs:r.inferenceMs})),alignment:S.depthAI?.alignment?.slice(-8)})),
    preview:safe(()=>typeof computeScanPreview==='function'?computeScanPreview():null),
    renderer:safe(()=>({xrEnabled:S.renderer?.xr?.enabled,pixelRatio:S.renderer?.getPixelRatio?.(),size:S.renderer?.getSize?.(new THREE.Vector2())?.toArray?.(),calls:S.renderer?.info?.render?.calls,triangles:S.renderer?.info?.render?.triangles,points:S.renderer?.info?.render?.points,geometries:S.renderer?.info?.memory?.geometries,textures:S.renderer?.info?.memory?.textures,contextLost:S.renderer?.getContext?.()?.isContextLost?.()})),
    finalViewer:safe(()=>({error:S.finalViewerError,hasModel:!!S.finalModel,geometryGaussians:S.finalModel?.geometryField?.gaussians?.length||0,surfaces:S.finalModel?.surfaces?.length||0,path:Array.isArray(S.finalModel?.path)?S.finalModel.path.length:S.finalModel?.path?.acoustic?.length||0,renderer:!!S.finalRenderer,rendererOwned:S.finalRendererOwned,contextLost:S.finalRenderer?.getContext?.()?.isContextLost?.(),scene:!!S.finalScene,camera:!!S.finalCamera,groupChildren:S.finalGroup?.children?.length||0,orbit:!!S.finalOrbit,renderFallback:S.finalViewerRenderFallback||null})),
    lastMapFrame:safe(()=>{const F=S.mapFrames?.at(-1);return F?{id:F.id,t:F.t,cols:F.cols,rows:F.rows,cam:F.cam,q:F.q,depthCoverage:F.semanticQuality?.depthCoverage,semanticScore:F.semanticQuality?.score,semanticReadable:F.semanticQuality?.readable,semanticBackend:F.semanticBackend,hasBitmap:!!F.semanticBitmap,hasBitmapPromise:!!F.semanticBitmapPromise,depthNonzero:F.depth?Array.from(F.depth).reduce((n,x)=>n+(x>0),0):0}:null}),
    debugTail:safe(()=>S.debug?.slice(-100),[])
  })};
  bridge.selfTest=async function(){
    const result={startedAt:new Date().toISOString(),sessionActive:!!S.session};
    const run=async(name,fn)=>{const t=performance.now();try{D?.event?.('selftest.start',{name});const value=await fn();const row={ok:true,duration_ms:performance.now()-t,value:D?.sanitize?.(value)};D?.event?.('selftest.end',{name,...row});result[name]=row;return row}catch(e){const row={ok:false,duration_ms:performance.now()-t,error:{name:e.name,message:e.message,stack:e.stack}};D?.event?.('selftest.error',{name,...row},'error');result[name]=row;return row}};
    if(!S.session&&typeof openPreview==='function')await run('camera_preview',async()=>{await openPreview();await new Promise(r=>setTimeout(r,650));const v=document.getElementById('preview');return {videoWidth:v?.videoWidth||0,videoHeight:v?.videoHeight||0,readyState:v?.readyState,paused:v?.paused,display:v?getComputedStyle(v).display:null,visibility:v?getComputedStyle(v).visibility:null,opacity:v?getComputedStyle(v).opacity:null,hasStream:!!v?.srcObject,tracks:v?.srcObject?.getTracks?.().map(t=>({kind:t.kind,readyState:t.readyState,muted:t.muted,settings:t.getSettings?.()}))||[]}});else result.camera_preview={ok:false,skipped:'XR session active or openPreview unavailable'};
    if(typeof preflightGuidedObjectSeeding==='function')await run('mobilesam_preflight',()=>preflightGuidedObjectSeeding());
    if(typeof mobileSamSemanticSelfTest==='function')await run('mobilesam_inference',()=>mobileSamSemanticSelfTest());
    if(typeof preflightDepthAI==='function')await run('depth_anything_preflight',()=>preflightDepthAI());
    await run('webgl_health',async()=>{const r=S.renderer,gl=r?.getContext?.();if(!gl)throw new Error('renderer/context WebGL assente');const ext=gl.getExtension?.('WEBGL_debug_renderer_info');return {lost:gl.isContextLost?.(),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),size:r.getSize?.(new THREE.Vector2())?.toArray?.(),pixelRatio:r.getPixelRatio?.()}});
    if(S.finalModel&&typeof openFinalViewer==='function')await run('stage5_existing_model',()=>openFinalViewer());else result.stage5_existing_model={ok:false,skipped:'no finalModel in memory'};
    result.finishedAt=new Date().toISOString();D?.event?.('selftest.complete',result);return result
  };
  globalThis.__RS_DIAG_BRIDGE__=bridge;
  D?.event?.('bridge.ready',{version:bridge.version,snapshot:bridge.snapshot()});
  const wrap=(name,fn)=>function(...args){const id=name+'-'+Math.random().toString(36).slice(2,7),t=performance.now();D?.event?.('app.fn.start',{name,id,args:D?.sanitize?.(args)});try{const r=fn.apply(this,args);if(r&&typeof r.then==='function')return r.then(v=>{D?.event?.('app.fn.end',{name,id,duration_ms:performance.now()-t,result:D?.sanitize?.(v),state:bridge.snapshot()});return v},e=>{D?.event?.('app.fn.error',{name,id,duration_ms:performance.now()-t,error:e,state:bridge.snapshot()},'error');throw e});D?.event?.('app.fn.end',{name,id,duration_ms:performance.now()-t,result:D?.sanitize?.(r),state:bridge.snapshot()});return r}catch(e){D?.event?.('app.fn.error',{name,id,duration_ms:performance.now()-t,error:e,state:bridge.snapshot()},'error');throw e}};
  try{if(typeof openPreview==='function')openPreview=wrap('openPreview',openPreview)}catch{}
  try{if(typeof bestSession==='function'){const base=bestSession;bestSession=wrap('bestSession',async function(...args){const ss=await base.apply(this,args);D?.event?.('xr.session.granted',{visibilityState:ss?.visibilityState,environmentBlendMode:ss?.environmentBlendMode,interactionMode:ss?.interactionMode,enabledFeatures:ss?.enabledFeatures?[...ss.enabledFeatures]:null});for(const n of ['end','visibilitychange','inputsourceschange','select','selectstart','selectend'])ss?.addEventListener?.(n,e=>D?.event?.('xr.session.'+n,{visibilityState:ss.visibilityState,inputSources:ss.inputSources?.length||0,event:e}));return ss})}}catch(e){D?.event?.('xr.bestSession.patch.error',{error:e},'error')}
  try{if(typeof setupCameraRecorder==='function')setupCameraRecorder=wrap('setupCameraRecorder',setupCameraRecorder)}catch{}
  try{if(typeof waitForFirstXrPose==='function')waitForFirstXrPose=wrap('waitForFirstXrPose',waitForFirstXrPose)}catch{}
  try{if(typeof enterMapWarmup==='function')enterMapWarmup=wrap('enterMapWarmup',enterMapWarmup)}catch{}
  try{if(typeof continueFromMap==='function')continueFromMap=wrap('continueFromMap',continueFromMap)}catch{}
  try{if(typeof startMeasurementAfterObjectSeeding==='function')startMeasurementAfterObjectSeeding=wrap('startMeasurementAfterObjectSeeding',startMeasurementAfterObjectSeeding)}catch{}
  try{if(typeof h5w10ShowFrozenFrame==='function')h5w10ShowFrozenFrame=wrap('h5w10ShowFrozenFrame',h5w10ShowFrozenFrame)}catch{}
  try{if(typeof h5w10ReleaseFrozenFrame==='function')h5w10ReleaseFrozenFrame=wrap('h5w10ReleaseFrozenFrame',h5w10ReleaseFrozenFrame)}catch{}
  try{if(typeof h5w10DepthAnythingOnFrozenCandidate==='function')h5w10DepthAnythingOnFrozenCandidate=wrap('h5w10DepthAnythingOnFrozenCandidate',h5w10DepthAnythingOnFrozenCandidate)}catch{}
  try{if(typeof captureRawCamera==='function'){const base=captureRawCamera;let last=0;captureRawCamera=function(t,pose){const r=base.apply(this,arguments);if(performance.now()-last>850){last=performance.now();D?.event?.('camera.xr.sample',{binding:!!S.cameraBinding,readbackFailed:S.cameraReadbackFailed,videoMode:S.videoMode,cameraCanvas:!!S.cameraCanvas,canvasSize:S.cameraCanvas?[S.cameraCanvas.width,S.cameraCanvas.height]:null,latestRGB:!!S.latestCameraRGB,latestView:!!S.latestCameraView,poseViews:pose?.views?.length||0,cameraViews:pose?.views?.filter?.(v=>!!v.camera)?.length||0,viewCameraSizes:pose?.views?.filter?.(v=>v.camera)?.map?.(v=>[v.camera.width,v.camera.height])||[]});}return r}}}catch(e){D?.event?.('camera.xr.patch.error',{error:e},'error')}
  try{if(typeof updateScanPreview==='function')updateScanPreview=wrap('updateScanPreview',updateScanPreview)}catch{}
  try{if(typeof updatePrimarySurfacePreview==='function')updatePrimarySurfacePreview=wrap('updatePrimarySurfacePreview',updatePrimarySurfacePreview)}catch{}
  try{if(typeof updateSplats==='function')updateSplats=wrap('updateSplats',updateSplats)}catch{}
  try{if(typeof objectSeedPointerSelect==='function')objectSeedPointerSelect=wrap('objectSeedPointerSelect',objectSeedPointerSelect)}catch{}
  try{if(typeof h5w13EndROI==='function')h5w13EndROI=wrap('h5w13EndROI',h5w13EndROI)}catch{}
  try{if(typeof updateObjectSeedReadiness==='function')updateObjectSeedReadiness=wrap('updateObjectSeedReadiness',updateObjectSeedReadiness)}catch{}
  try{if(typeof objectSeedGeometryReadiness==='function')objectSeedGeometryReadiness=wrap('objectSeedGeometryReadiness',objectSeedGeometryReadiness)}catch{}
  try{if(typeof h5w7CurrentObjectSnapshotFrame==='function')h5w7CurrentObjectSnapshotFrame=wrap('h5w7CurrentObjectSnapshotFrame',h5w7CurrentObjectSnapshotFrame)}catch{}
  try{if(typeof drawObjectSeedMask==='function')drawObjectSeedMask=wrap('drawObjectSeedMask',drawObjectSeedMask)}catch{}
  try{if(typeof semanticMaskCandidate==='function')semanticMaskCandidate=wrap('semanticMaskCandidate',semanticMaskCandidate)}catch{}
  try{if(typeof mobileSamSessionContract==='function')mobileSamSessionContract=wrap('mobileSamSessionContract',mobileSamSessionContract)}catch{}
  try{if(typeof mobileSamEncoderPlan==='function')mobileSamEncoderPlan=wrap('mobileSamEncoderPlan',mobileSamEncoderPlan)}catch{}
  try{if(typeof pushMapFrame==='function')pushMapFrame=wrap('pushMapFrame',pushMapFrame)}catch{}
  try{if(typeof captureSemanticFrameImage==='function')captureSemanticFrameImage=wrap('captureSemanticFrameImage',captureSemanticFrameImage)}catch{}
  try{if(typeof freezeObjectSeedSnapshot==='function')freezeObjectSeedSnapshot=wrap('freezeObjectSeedSnapshot',freezeObjectSeedSnapshot)}catch{}
  try{if(typeof getSemanticBitmap==='function')getSemanticBitmap=wrap('getSemanticBitmap',getSemanticBitmap)}catch{}
  try{if(typeof preflightGuidedObjectSeeding==='function')preflightGuidedObjectSeeding=wrap('preflightGuidedObjectSeeding',preflightGuidedObjectSeeding)}catch{}
  try{if(typeof ensureSemanticSessions==='function')ensureSemanticSessions=wrap('ensureSemanticSessions',ensureSemanticSessions)}catch{}
  try{if(typeof mobileSamSemanticSelfTest==='function')mobileSamSemanticSelfTest=wrap('mobileSamSemanticSelfTest',mobileSamSemanticSelfTest)}catch{}
  try{if(typeof mobileSamEncodeBitmap==='function')mobileSamEncodeBitmap=wrap('mobileSamEncodeBitmap',mobileSamEncodeBitmap)}catch{}
  try{if(typeof mobileSamDecode==='function')mobileSamDecode=wrap('mobileSamDecode',mobileSamDecode)}catch{}
  try{if(typeof runMobileSamSeedFrame==='function')runMobileSamSeedFrame=wrap('runMobileSamSeedFrame',runMobileSamSeedFrame)}catch{}
  try{if(typeof segmentObjectSeed==='function')segmentObjectSeed=wrap('segmentObjectSeed',segmentObjectSeed)}catch{}
  try{if(typeof showObjectSeedCandidate==='function')showObjectSeedCandidate=wrap('showObjectSeedCandidate',showObjectSeedCandidate)}catch{}
  try{if(typeof confirmObjectSeed==='function')confirmObjectSeed=wrap('confirmObjectSeed',confirmObjectSeed)}catch{}
  try{if(typeof ensureDepthAIWorker==='function')ensureDepthAIWorker=wrap('ensureDepthAIWorker',ensureDepthAIWorker)}catch{}
  try{if(typeof runCooperativeDepthAIFrame==='function')runCooperativeDepthAIFrame=wrap('runCooperativeDepthAIFrame',runCooperativeDepthAIFrame)}catch{}
  try{if(typeof processFinalModel==='function')processFinalModel=wrap('processFinalModel',processFinalModel)}catch{}
  try{if(typeof buildGeometryGaussianField==='function')buildGeometryGaussianField=wrap('buildGeometryGaussianField',buildGeometryGaussianField)}catch{}
  try{if(typeof makeGaussianQuadSplat==='function')makeGaussianQuadSplat=wrap('makeGaussianQuadSplat',makeGaussianQuadSplat)}catch{}
  try{if(typeof enterFinalViewerMode==='function')enterFinalViewerMode=wrap('enterFinalViewerMode',enterFinalViewerMode)}catch{}
  try{if(typeof restorePrimaryRendererHost==='function')restorePrimaryRendererHost=wrap('restorePrimaryRendererHost',restorePrimaryRendererHost)}catch{}
  try{if(typeof ensureFinalViewerGeometry==='function')ensureFinalViewerGeometry=wrap('ensureFinalViewerGeometry',ensureFinalViewerGeometry)}catch{}
  try{if(typeof initFinalRenderer==='function')initFinalRenderer=wrap('initFinalRenderer',initFinalRenderer)}catch{}
  try{if(typeof rebuildFinalScene==='function')rebuildFinalScene=wrap('rebuildFinalScene',rebuildFinalScene)}catch{}
  try{if(typeof renderFinalFrameOnce==='function')renderFinalFrameOnce=wrap('renderFinalFrameOnce',renderFinalFrameOnce)}catch{}
  try{if(typeof openFinalViewer==='function')openFinalViewer=wrap('openFinalViewer',openFinalViewer)}catch{}
  try{if(typeof ended==='function')ended=wrap('ended',ended)}catch{}
})();
`}
function injectIntoCurrentHtml(html){
  const diagTag=`<script src="./room_scanner_diagnostics.js?v=${DIAG_BUILD}"></script>`;
  // The production app is a single classic inline script, while older builds
  // used a module.  Instrument either form; otherwise the diagnostic panel is
  // visible but SELF TEST has no internal bridge.
  const scriptRe=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let chosen=null, match;
  while((match=scriptRe.exec(html))){
    const attrs=match[1]||'', body=match[2]||'';
    if(/\bsrc\s*=/i.test(attrs))continue;
    if(/\btype\s*=\s*["']module["']/i.test(attrs)||/const\s+APP_BUILD|activateBuildCache\(\)/.test(body))chosen={index:match.index,openEnd:match.index+match[0].indexOf('>')+1,close:match.index+match[0].lastIndexOf('</script>')};
  }
  if(!chosen)return {html:html.replace(/<\/head>/i,diagTag+'\n</head>'),bridge:false,reason:'inline application script not found'};
  let out=html.slice(0,chosen.index)+diagTag+'\n'+html.slice(chosen.index);
  const shift=diagTag.length+1, bodyStart=chosen.openEnd+shift, close=chosen.close+shift;
  let body=out.slice(bodyStart,close), bridge=bridgeCode(), injectedAt='script-end';
  const markers=["$('#objectSeedMask').addEventListener",'document.querySelector(\'#objectSeedMask\')'];let pos=-1;for(const k of markers){pos=body.indexOf(k);if(pos>=0){injectedAt=k;break}}
  if(pos<0)pos=body.length;
  body=body.slice(0,pos)+'\n'+bridge+'\n'+body.slice(pos);
  out=out.slice(0,bodyStart)+body+out.slice(close);
  return {html:out,bridge:true,injectedAt};
}
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url), isNav=event.request.mode==='navigate'&&/room_scanner_v9\.html$/i.test(u.pathname), requestedDiag=u.searchParams.has('rsdiag');
  if(u.pathname.endsWith('/__rsdiag_original_source.html')){event.respondWith((async()=>{try{const c=await caches.open(SOURCE_CACHE),r=await c.match(SOURCE_KEY);return r||new Response('source snapshot unavailable',{status:404,headers:{'content-type':'text/plain','cache-control':'no-store'}})}catch(e){return new Response(String(e),{status:500})}})());return}
  if(isNav&&requestedDiag){const cid=event.resultingClientId||event.clientId;if(cid)diagClients.add(cid);event.respondWith((async()=>{const t=Date.now();try{const r=await fetch(event.request,{cache:'no-store'}),txt=await r.text();try{const c=await caches.open(SOURCE_CACHE);await c.put(SOURCE_KEY,new Response(txt,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}}))}catch(_){}const x=injectIntoCurrentHtml(txt),h=new Headers(r.headers);h.set('cache-control','no-store, max-age=0');h.delete('content-length');post(cid,'navigation',{url:u.href,status:r.status,duration_ms:Date.now()-t,bytes:txt.length,bridge:x.bridge,injectedAt:x.injectedAt,reason:x.reason||null});return new Response(x.html,{status:r.status,statusText:r.statusText,headers:h})}catch(e){post(cid,'navigation_error',{url:u.href,error:e.message,duration_ms:Date.now()-t});return new Response(`<h1>Diagnostic navigation failed</h1><pre>${String(e.stack||e)}</pre>`,{status:502,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}})}})());return}
  const cid=event.clientId||event.resultingClientId;if(cid&&diagClients.has(cid)){event.respondWith((async()=>{const t=Date.now();try{const r=await fetch(event.request,{cache:'no-store'});post(cid,'asset',{url:u.href,method:event.request.method,status:r.status,ok:r.ok,type:r.type,duration_ms:Date.now()-t,contentType:r.headers.get('content-type'),contentLength:r.headers.get('content-length'),cacheControl:r.headers.get('cache-control')});return r}catch(e){post(cid,'asset_error',{url:u.href,method:event.request.method,duration_ms:Date.now()-t,error:e.message});throw e}})())}
});
