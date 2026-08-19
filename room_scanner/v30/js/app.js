import {BUILD,CONFIG} from './config.js';
import {DiagnosticLog,downloadBlob,installGlobalDiagnostics} from './logger.js';
import {V30Database} from './storage/db.js';
import {CameraSource} from './camera.js';
import {ImuTracker} from './imu.js';
import {WasmVisionFrontend} from './slam/wasm_frontend.js';
import {SlamEngine} from './slam/slam_engine.js';
import {GaussianRenderer} from './gaussian/renderer.js';
import {downloadPly,makeR30,parsePly,parseR30} from './formats.js';
import {runSelfTests} from './self_test.js';

const $=id=>document.getElementById(id);
const log=new DiagnosticLog();installGlobalDiagnostics(log);window.__roomscanV30Log=log;
let db=null,session=null,camera=null,imu=null,frontend=null,slam=null,gWorker=null,dWorker=null,renderer=null,currentSnapshot=null,scanRaf=0,lastAnalysisAt=0,scanning=false,deepEnabled=true,deepBusy=false,deepQueue=[],pendingDepth=new Map(),lastKeyframe=null,lastWorkerStats={count:0,totalObs:0},imuArchive=[];

function setStatus(text,kind=''){const el=$('homeStatus');el.textContent=text;el.dataset.kind=kind;}
function showScreen(id){for(const s of document.querySelectorAll('.screen'))s.classList.toggle('active',s.id===id);log.info('screen',{id});}
function updateDiagPanel(){const out=$('diagLive');if(!out)return;const recent=log.events.slice(-8);out.textContent=recent.map(e=>`${new Date(e.time).toLocaleTimeString()} ${e.level.toUpperCase()} ${e.type}${e.data?.message?`: ${e.data.message}`:''}`).join('\n')||'Nessun evento.';}
log.subscribe(updateDiagPanel);
log.subscribe(ev=>{if(db&&session){db.put('events',{id:`${session.id}:${String(ev.seq).padStart(8,'0')}`,sessionId:session.id,...ev}).catch(()=>{});}});

function diagnosticsExtra(){return {build:BUILD,session,scan:{scanning,deepEnabled,deepBusy,deepQueue:deepQueue.length,gaussians:lastWorkerStats,slam:slam?.diagnostics?.()||null},capabilities:{mediaDevices:!!navigator.mediaDevices?.getUserMedia,indexedDB:!!indexedDB,webAssembly:typeof WebAssembly==='object',webGL2:!!document.createElement('canvas').getContext('webgl2'),webGPU:'gpu' in navigator,serviceWorker:'serviceWorker' in navigator}};}

async function bootstrap(){
  log.info('bootstrap-start',{build:BUILD.id});$('buildBadge').textContent=`V${BUILD.version} · STANDALONE WASM SLAM + GAUSSIANS`;$('buildFoot').textContent=BUILD.id;
  $('cameraHeight').addEventListener('input',e=>{$('heightLabel').textContent=`${Number(e.target.value).toFixed(2)} m`;});
  $('startBtn').addEventListener('click',startScan);$('finishBtn').addEventListener('click',finishScan);$('pinBtn').addEventListener('click',pinMarkpoint);$('pauseDeepBtn').addEventListener('click',toggleDeep);
  $('backHomeBtn').addEventListener('click',()=>showScreen('home'));$('orbitBtn').addEventListener('click',()=>renderer?.setMode('orbit'));$('panBtn').addEventListener('click',()=>renderer?.setMode('pan'));$('fitBtn').addEventListener('click',()=>renderer?.fit());$('splatSize').addEventListener('input',e=>{if(renderer){renderer.pointScale=Number(e.target.value);renderer.requestRender();}});
  $('loadPlyBtn').addEventListener('click',()=>$('filePly').click());$('filePly').addEventListener('change',loadPly);$('loadR30Btn').addEventListener('click',()=>$('fileR30').click());$('fileR30').addEventListener('change',loadR30);
  $('exportPlyBtn').addEventListener('click',()=>{if(currentSnapshot)downloadPly(currentSnapshot,`roomscan-${session?.id||'loaded'}-gaussians.ply`);});$('exportDiagBtn').addEventListener('click',()=>log.download(diagnosticsExtra()));$('diagDownloadBtn').addEventListener('click',()=>log.download(diagnosticsExtra()));$('diagCopyBtn').addEventListener('click',copyDiagnostics);$('selfTestBtn').addEventListener('click',runUiSelfTest);$('exportR30Btn').addEventListener('click',exportR30);$('resumeBtn').addEventListener('click',startScan);
  // Viewer initialization is lazy: a WebGL driver problem must never disable
  // the home UI, camera-height slider, diagnostics or scan button.
  try{db=await new V30Database().open();log.info('indexeddb-ready');await refreshSavedSessions();}catch(err){log.error('indexeddb-open-failed',{message:err.message,stack:err.stack});setStatus(`IndexedDB non disponibile: ${err.message}`,'warn');}
  if('serviceWorker' in navigator){navigator.serviceWorker.register(CONFIG.serviceWorker).then(r=>log.info('service-worker-ready',{scope:r.scope})).catch(e=>log.warn('service-worker-failed',{message:e.message}));}
  // Lightweight dependency check: it never disables the UI.
  const missing=[];for(const path of ['js/app.js','js/slam/math.js',CONFIG.wasmCore,CONFIG.gaussianWorker,CONFIG.depthWorker]){try{const r=await fetch(path,{cache:'no-store'});if(!r.ok)missing.push(`${path} (${r.status})`);}catch(e){missing.push(`${path} (${e.message})`);}}
  if(missing.length){log.error('preflight-assets-missing',{missing});setStatus(`Installazione incompleta: ${missing.join(', ')}`,'error');}else setStatus('Pronto. Premi “Avvia scansione”.','ok');
  document.documentElement.dataset.v30Ready='1';if(window.__ROOMSCAN_PREBOOT)window.__ROOMSCAN_PREBOOT.ready=true;
  log.info('bootstrap-complete',{missing});updateDiagPanel();
}

async function startScan(){
  if(scanning)return;const btn=$('startBtn');btn.disabled=true;setStatus('Inizializzazione camera e SLAM…');
  try{
    frontend=new WasmVisionFrontend(CONFIG.wasmCore);await frontend.init();slam=new SlamEngine(frontend,{cameraHeightM:Number($('cameraHeight').value),fovDeg:CONFIG.cameraFovDeg,keyframeIntervalMs:CONFIG.keyframeIntervalMs});imu=new ImuTracker();
    if(!session||session.status==='completed'||session.status==='loaded')session=db?await db.createSession({cameraHeightM:Number($('cameraHeight').value),status:'starting'}):{id:`volatile-${crypto.randomUUID()}`,createdAt:Date.now(),status:'starting',counts:{}};log.setSession(session.id);
    setupWorkers();camera=new CameraSource($('camera'),{analysisWidth:CONFIG.analysisWidth});const camInfo=await camera.start();log.info('camera-started',camInfo);imu.start().then(ok=>log.info('imu-start',{ok,permission:imu.permission}));
    scanning=true;lastAnalysisAt=0;showScreen('scan');$('slamState').textContent='TRACK';$('deepState').textContent='Deep avvio…';session=await persistSession({status:'capturing',camera:camInfo});scanRaf=requestAnimationFrame(scanLoop);
  }catch(err){log.error('scan-start-failed',{message:err.message,stack:err.stack});setStatus(`Avvio fallito: ${err.message}`,'error');cleanupCapture();showScreen('home');}
  finally{btn.disabled=false;}
}

function setupWorkers(){
  gWorker?.terminate();dWorker?.terminate();
  gWorker=new Worker(CONFIG.gaussianWorker);gWorker.onmessage=onGaussianMessage;gWorker.onerror=e=>log.error('gaussian-worker-error',{message:e.message,filename:e.filename,line:e.lineno});gWorker.postMessage({type:'init',config:{voxel:CONFIG.gaussianVoxelM,maxGaussians:CONFIG.gaussianMaxLive,maxSnapshot:CONFIG.gaussianSnapshot}});
  dWorker=new Worker(CONFIG.depthWorker,{type:'module'});dWorker.onmessage=onDepthMessage;dWorker.onerror=e=>{deepBusy=false;log.error('depth-worker-runtime-error',{message:e.message,filename:e.filename,line:e.lineno});$('deepState').textContent='Deep errore';};dWorker.postMessage({type:'init',config:{transformersRemote:CONFIG.transformersRemote,modelId:CONFIG.depthModelId}});
}

function scanLoop(now){
  if(!scanning)return;if(now-lastAnalysisAt>=1000/CONFIG.analysisFps){lastAnalysisAt=now;try{const frame=camera.analysisFrame(now);if(frame){const analysis=slam.processAnalysis(frame,{motionScore:imu?.motionScore?.()||0});updateTrackingHud(analysis);drawMiniMap(analysis);if(analysis.keyframeDue)void captureKeyframe(analysis);}}catch(err){log.error('analysis-frame-failed',{message:err.message,stack:err.stack});$('slamState').textContent='TRACK ERR';}}
  if(imu?.samples?.length>=180)flushImu();scanRaf=requestAnimationFrame(scanLoop);
}
function updateTrackingHud(a){$('statFeat').textContent=a.quality.features;$('statMatch').textContent=a.quality.matches;$('statLandmarks').textContent=slam.landmarks.size;$('statKf').textContent=slam.keyframes.length;$('metricState').textContent=slam.metricCalibration?`scala ${Math.round((slam.metricCalibration.confidence||0)*100)}%`:'scala attesa';const good=a.quality.matches>20;$('slamState').textContent=good?'TRACK':'CERCA';$('coach').textContent=good?'Cammina lentamente. Copri pavimento, pareti, soffitto e oggetti da più angoli.':'Punta verso zone con texture/contrasto e muovi lentamente il telefono.';}
function drawMiniMap(a){const c=$('miniMap'),dpr=Math.min(2,devicePixelRatio||1),w=c.clientWidth||innerWidth,h=c.clientHeight||innerHeight;if(c.width!==w*dpr||c.height!==h*dpr){c.width=w*dpr;c.height=h*dpr;}const x=c.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);x.fillStyle='rgba(30,255,180,.75)';const sx=w/a.K.width,sy=h/a.K.height;for(let i=0;i<a.features.count;i+=Math.max(1,Math.floor(a.features.count/220))){x.beginPath();x.arc(a.features.xs[i]*sx,a.features.ys[i]*sy,1.6,0,Math.PI*2);x.fill();}x.strokeStyle='rgba(255,255,255,.65)';x.beginPath();x.moveTo(w/2-8,h/2);x.lineTo(w/2+8,h/2);x.moveTo(w/2,h/2-8);x.lineTo(w/2,h/2+8);x.stroke();}

async function captureKeyframe(analysis){
  if(!scanning||slam.keyframes.length>=CONFIG.maxKeyframes)return;if(lastKeyframe&&performance.now()-lastKeyframe<CONFIG.keyframeIntervalMs*.75)return;lastKeyframe=performance.now();
  try{const f=await camera.keyframe();const kf=slam.createKeyframeSnapshot(analysis,f);log.info('keyframe-captured',{id:kf.id,seq:kf.seq,size:f.blob.size});await persistKeyframe(kf);$('statKf').textContent=slam.keyframes.length;if(deepEnabled&&kf.seq%CONFIG.deepEveryNthKeyframe===0)queueDepth(kf);}
  catch(err){log.warn('keyframe-failed',{message:err.message,stack:err.stack});}
}
async function persistKeyframe(kf){if(!db||!session)return;try{await db.put('keyframes',{id:`${session.id}:${kf.id}`,sessionId:session.id,kfId:kf.id,seq:kf.seq,t:kf.t,pose:kf.pose,K:kf.K,analysisWidth:kf.analysisWidth,analysisHeight:kf.analysisHeight,imageWidth:kf.imageWidth,imageHeight:kf.imageHeight,trackIds:kf.trackIds,featureX:kf.featureX,featureY:kf.featureY,featureScore:kf.featureScore,descriptorBytes:kf.descriptorBytes,blob:kf.blob});session=await persistSession({counts:{...(session.counts||{}),keyframes:slam.keyframes.length,gaussians:lastWorkerStats.count||0}});}catch(err){log.error('keyframe-persist-failed',{message:err.message,stack:err.stack});}}
function queueDepth(kf){if(deepQueue.length>=CONFIG.deepQueueMax){log.warn('deep-queue-drop',{kf:kf.id,queued:deepQueue.length});return;}deepQueue.push(kf);pumpDepth();}
async function pumpDepth(){if(deepBusy||!deepEnabled||!deepQueue.length||!dWorker)return;deepBusy=true;const kf=deepQueue.shift(),requestId=crypto.randomUUID();pendingDepth.set(requestId,kf);$('deepState').textContent=`Deep ${deepQueue.length+1}`;try{const jpeg=await kf.blob.arrayBuffer();dWorker.postMessage({type:'infer',requestId,frameId:kf.id,jpeg},[jpeg]);}catch(err){deepBusy=false;pendingDepth.delete(requestId);log.error('deep-submit-failed',{message:err.message});pumpDepth();}}
function onDepthMessage(e){const m=e.data||{};if(m.type==='ready'){log.info('depth-worker-ready');$('deepState').textContent='Deep pronto';return;}if(m.type==='diag'){log.push(m.level||'info',m.event||'depth-diag',{message:m.message});return;}if(m.type==='error'){deepBusy=false;const kf=pendingDepth.get(m.requestId);pendingDepth.delete(m.requestId);log.error('depth-inference-failed',{kf:kf?.id,provider:m.provider,message:m.message,stack:m.stack});$('deepState').textContent='Deep fallback/off';pumpDepth();return;}if(m.type==='depth'){deepBusy=false;const kf=pendingDepth.get(m.requestId);pendingDepth.delete(m.requestId);if(!kf){pumpDepth();return;}try{const depth=new Float32Array(m.depth),rgb=new Uint8Array(m.rgb),integrated=slam.integrateDepth(kf,{depth,width:m.width,height:m.height});const cal=integrated.calibration,K={fx:kf.K.fx*m.width/kf.analysisWidth,fy:kf.K.fy*m.height/kf.analysisHeight,cx:m.width*.5,cy:m.height*.5,width:m.width,height:m.height};gWorker.postMessage({type:'integrate',frameId:kf.id,width:m.width,height:m.height,depth:depth.buffer,rgb:rgb.buffer,K,pose:kf.pose,calibration:cal,targetPoints:6500},[depth.buffer,rgb.buffer]);$('deepState').textContent=`Deep ${m.provider}`;log.info('depth-integrated',{kf:kf.id,provider:m.provider,calibration:cal,landmarksAdded:integrated.landmarksAdded});}catch(err){log.error('depth-integration-failed',{message:err.message,stack:err.stack});}pumpDepth();}}
function onGaussianMessage(e){const m=e.data||{};if(m.type==='ready'){log.info('gaussian-worker-ready',m.config);return;}if(m.type==='error'){log.error('gaussian-worker-message-error',{message:m.message,stack:m.stack});return;}if(m.type==='snapshot'||m.type==='export'){currentSnapshot={data:new Float32Array(m.data),stride:m.stride||16,count:m.count||0};lastWorkerStats={count:m.count||0,totalObs:m.totalObs||0};$('statGs').textContent=lastWorkerStats.count;if(document.getElementById('review').classList.contains('active'))renderer.setData(currentSnapshot);}}

function pinMarkpoint(){const r=slam?.pinCenter?.()||{ok:false,reason:'slam-not-ready'};if(r.ok){log.info('markpoint-created',r.mark);$('coach').textContent=`Repere salvato (${r.mark.views} viste).`;}else{log.warn('markpoint-rejected',r);$('coach').textContent=`Repere non valido: ${r.reason}. Inquadra un dettaglio già dotato di profondità.`;}}
function toggleDeep(){deepEnabled=!deepEnabled;$('pauseDeepBtn').textContent=deepEnabled?'Deep ON':'Deep OFF';$('deepState').textContent=deepEnabled?'Deep attivo':'Deep pausa';log.info('deep-toggle',{enabled:deepEnabled});if(deepEnabled)pumpDepth();}
async function flushImu(){const samples=imu?.drain?.()||[];if(!samples.length)return;imuArchive.push(...samples);if(imuArchive.length>30000)imuArchive.splice(0,5000);if(db&&session)try{await db.put('imu',{id:`${session.id}:${Date.now()}:${crypto.randomUUID()}`,sessionId:session.id,samples});}catch(e){log.warn('imu-persist-failed',{message:e.message});}}

async function finishScan(){if(!scanning)return;$('finishBtn').disabled=true;log.info('finish-requested');try{scanning=false;cancelAnimationFrame(scanRaf);await flushImu();camera?.stop();imu?.stop();await requestGaussianExport();session=await persistSession({status:'completed',counts:{...(session.counts||{}),keyframes:slam?.keyframes.length||0,gaussians:currentSnapshot?.count||0,imu:imuArchive.length},slam:slam?.diagnostics?.()||null});showReview();}catch(err){log.error('finish-failed',{message:err.message,stack:err.stack});showReview();}finally{$('finishBtn').disabled=false;}}
function requestGaussianExport(){return new Promise(resolve=>{if(!gWorker)return resolve();const timer=setTimeout(resolve,1500),handler=e=>{if(e.data?.type==='export'){clearTimeout(timer);gWorker.removeEventListener('message',handler);resolve();}};gWorker.addEventListener('message',handler);gWorker.postMessage({type:'export'});});}
function cleanupCapture(){scanning=false;cancelAnimationFrame(scanRaf);camera?.stop();imu?.stop();gWorker?.terminate();dWorker?.terminate();}
function showReview(){showScreen('review');if(!renderer)renderer=new GaussianRenderer($('viewer'));if(currentSnapshot)renderer.setData(currentSnapshot);$('reviewStats').innerHTML=`<b>${currentSnapshot?.count||0}</b> Gaussian · <b>${slam?.keyframes.length||0}</b> keyframe · <b>${slam?.landmarks.size||0}</b> landmark · <b>${slam?.markpoints.length||0}</b> repere`;renderer.requestRender();}

async function persistSession(patch){if(!session)return null;Object.assign(session,patch,{updatedAt:Date.now()});if(db)try{session=await db.updateSession(session.id,patch);}catch(e){log.warn('session-persist-failed',{message:e.message});}return session;}
async function refreshSavedSessions(){const sessions=(await db.getAll('sessions')).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,8),el=$('savedSessions');if(!sessions.length){el.innerHTML='<span class="muted">Nessuna sessione V30 salvata.</span>';return;}el.innerHTML=sessions.map(s=>`<div class="savedRow"><span><b>${s.id.slice(0,12)}</b><small>${new Date(s.updatedAt).toLocaleString()} · ${s.status||'?'}</small></span><span>${s.counts?.keyframes||0} KF · ${s.counts?.gaussians||0} GS</span></div>`).join('');}

async function loadPly(e){const file=e.target.files?.[0];if(!file)return;try{const snap=await parsePly(file);session={id:`ply-${file.name}`,status:'loaded',counts:{gaussians:snap.count}};currentSnapshot=snap;log.setSession(session.id);log.info('ply-loaded',{name:file.name,count:snap.count,size:file.size});showReview();}catch(err){log.error('ply-load-failed',{message:err.message});setStatus(`PLY non valido: ${err.message}`,'error');}finally{e.target.value='';}}
async function loadR30(e){const file=e.target.files?.[0];if(!file)return;try{const r=await parseR30(file);session={id:r.meta.id||`r30-${file.name}`,status:'loaded',...r.meta};currentSnapshot=r.gaussians;log.setSession(session.id);log.info('r30-loaded',{name:file.name,entries:Object.keys(r.entries).length,gaussians:r.gaussians?.count||0});showReview();}catch(err){log.error('r30-load-failed',{message:err.message});setStatus(`R30 non valido: ${err.message}`,'error');}finally{e.target.value='';}}
async function exportR30(){if(!session)return;const blob=makeR30({manifest:{id:session.id,build:BUILD,session,slam:slam?.diagnostics?.()||null},keyframes:slam?.keyframes||[],gaussians:currentSnapshot,imu:imuArchive});downloadBlob(blob,`roomscan-${session.id}.r30`);log.info('r30-exported',{bytes:blob.size});}
async function copyDiagnostics(){try{await navigator.clipboard.writeText(JSON.stringify(log.snapshot(diagnosticsExtra()),null,2));log.info('diagnostics-copied');}catch(e){log.warn('diagnostics-copy-failed',{message:e.message});}}
async function runUiSelfTest(){const b=$('selfTestBtn');b.disabled=true;b.textContent='Test…';$('selfTestSummary').textContent='Self-test in corso…';const r=await runSelfTests(log);$('selfTestSummary').textContent=r.tests.map(t=>`${t.ok?'PASS':'FAIL'} ${t.name}${t.ok?'':`: ${t.error}`}`).join(' · ');b.textContent='Esegui self-test';b.disabled=false;}

bootstrap().catch(err=>{log.error('bootstrap-fatal',{message:err.message,stack:err.stack});setStatus(`BOOTSTRAP FATAL: ${err.message}`,'error');document.documentElement.dataset.bootstrap='failed';});
