import {CONFIG,BUILD} from './config.js';
import {WasmVisionFrontend} from './slam/wasm_frontend.js';
import {V30Database,openVersionSafe} from './storage/db.js';
import {triangulateRays,poseIdentity} from './slam/math.js';

/*
 * V30.13.0 self-tests intentionally include regressions for the two phone failures
 * reported on V30.8: IndexedDB downgrade and fake/screen-space WebXR pins.
 */
export async function runSelfTests(log){
  const tests=[];
  const run=async(name,fn)=>{const t=performance.now();try{const detail=await fn();const r={name,ok:true,ms:performance.now()-t,detail};tests.push(r);log.info('self-test-pass',r);}catch(err){const r={name,ok:false,ms:performance.now()-t,error:err.message};tests.push(r);log.error('self-test-fail',{...r,stack:err.stack});}};

  await run('secure-context',()=>{if(!isSecureContext&&location.hostname!=='localhost')throw new Error('HTTPS required');return location.protocol;});
  await run('required-dom',()=>{for(const id of ['calibrateBtn','calibOverlay','calibAddPinBtn','calibUndoPinBtn','calibFinishBtn','calibCancelBtn','startBtn','diagDownloadBtn','selfTestBtn','forceUpdateBtn','viewer','bridgeCamera'])if(!document.getElementById(id))throw new Error(`missing #${id}`);return 'ok';});
  await run('runtime-contract',()=>({webXR:!!navigator.xr,webAssembly:typeof WebAssembly==='object',camera:!!navigator.mediaDevices?.getUserMedia,imuRequired:false,deepAI:false,realAnchorsRequired:CONFIG.xrRequireRealAnchors!==false}));

  await run('interactive-boot-order',async()=>{const text=await fetch(`js/app.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();});if(!text.includes("dataset.v30Interactive='1'"))throw new Error('core does not signal interactive UI after bind');if(!text.includes('void initBackground()'))throw new Error('background initialization is still a boot gate');for(const heavy of ["from './camera.js'","from './storage/db.js'","from './xr/xr_calibration.js'"])if(text.includes(heavy))throw new Error(`heavy static import remains: ${heavy}`);return 'UI bound first; heavy runtime lazy-loaded';});

  await run('unhandled-rejections',()=>{const xs=(window.__ROOMSCAN_PREBOOT?.errors||[]).filter(e=>e.type==='rejection');if(xs.length){const e=xs[xs.length-1];throw new Error(`${e.name||'PromiseRejection'}: ${e.message||'reason unavailable'}${e.source?` [${e.source}]`:''}`);}return 'none observed since page bootstrap';});

  await run('wasm-core',async()=>{const f=new WasmVisionFrontend(CONFIG.wasmCore);await f.init();const w=96,h=72,a=new Uint8Array(w*h),b=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){a[y*w+x]=((x*13+y*7)^((x>>3)*37))&255;const xx=Math.max(0,x-2);b[y*w+x]=((xx*13+y*7)^((xx>>3)*37))&255;}const r1=f.process(a,w,h,{maxFeatures:180,threshold:12}),r2=f.process(b,w,h,{maxFeatures:180,threshold:12});if(r1.count<5||r2.matches.count<2)throw new Error(`weak WASM output ${r1.count}/${r2.matches.count}`);return {features:r2.count,matches:r2.matches.count,limits:f.limits};});
  await run('alvaar-source-contract',async()=>{const [front,slam,overlay]=await Promise.all([fetch(`js/slam/wasm_frontend.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),fetch(`js/slam/slam_engine.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),fetch(`js/gaussian/ar_overlay.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text())]);for(const t of ['AlvaAR.Initialize','findCameraPose','alvaar-wasm'])if(!front.includes(t))throw new Error(`AlvaAR frontend token missing: ${t}`);for(const t of ['alvaMatrixToPose','alvaar-metric-scale'])if(!slam.includes(t))throw new Error(`Alva metric alignment token missing: ${t}`);if(!overlay.includes('projectPoint')||!overlay.includes('analysisPixelToSource'))throw new Error('live AR overlay is not registered to the camera geometry');return {local:'vendor/alva_ar.js',remote:CONFIG.alvaRemoteUrl,mode:window.RoomScanV30?.state?.frontend?.mode||'not-started'};});
  await run('camera-crop-contract',async()=>{const text=await fetch(`js/camera.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text());for(const t of ['coverCrop','intrinsicsForCrop','analysisPixelToSource','drawImage(this.video,g.sx,g.sy,g.sw,g.sh'])if(!text.includes(t))throw new Error(`camera crop token missing: ${t}`);return 'analysis frame is cropped, not stretched; K follows the crop';});
  await run('live-ar-reconstruction',async()=>{const html=await fetch(`room_scanner_v30.html?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),app=await fetch(`js/app.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text());if(!html.includes('id="arModeBtn"')||!app.includes("new LiveReconstructionOverlay($('miniMap')"))throw new Error('live GS/mesh AR controls missing');if(!app.includes('state.liveOverlay?.draw({pose:r.pose,K,geometry:frame.geometry'))throw new Error('overlay is not rendered from the live SLAM pose');return 'camera + metric pose + GS/mesh overlay';});

  await run('camera-only-triangulation',()=>{const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240},a={pose:poseIdentity(),K,u:160,v:120},b={pose:{p:[.20,0,0],q:[0,0,0,1]},K,u:130,v:120},r=triangulateRays(a,b,{minAngleRad:.005,maxGapM:.15});if(!r.ok)throw new Error(r.reason);return {p:r.p,angle:r.angle,gap:r.gap};});

  // Runtime regression: V30.11.3 parsed correctly but crashed only when Scan
  // instantiated SlamEngine after metric lock because its derived constructor
  // accessed this before super(). Instantiating and processing a frame here
  // catches that class of failure on the actual browser runtime.
  await run('scan-runtime-constructor',async()=>{
    const {SlamEngine}=await import(`./slam/slam_engine.js?selftest=${Date.now()}`);
    const frontend={process:()=>({count:3,features:[{x:1,y:1}],matches:{count:1,items:[{dx:2,dy:-1}]}})};
    const slam=new SlamEngine({frontend,K:{fx:320,fy:320,cx:160,cy:240,width:320,height:480},keyframeIntervalMs:1});
    slam.setMetricScale(1);
    const r=slam.process({gray:new Uint8Array(640),width:320,height:2,at:1});
    if(!r.metricLocked||r.matches!==1||r.keyframes!==1)throw new Error('SlamEngine first metric frame failed');
    return {metricLocked:r.metricLocked,matches:r.matches,keyframes:r.keyframes};
  });
  await run('live-mvs-gaussian-pipeline',async()=>{
    const app=await fetch(`js/app.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text());
    for(const token of ["queueMvsKeyframe(r.newKeyframe,frame,K)","type:'pair'","state.gaussianWorker?.postMessage({type:'add',points:d.points,sourceId:"])if(!app.includes(token))throw new Error(`missing live MVS wiring: ${token}`);
    const mvsText=await fetch(`${CONFIG.mvsWorker}?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text());for(const token of ['epipolarErrorPx','maxEpipolarPx','maxReprojectionPx'])if(!mvsText.includes(token))throw new Error(`missing pose-guided MVS quality gate: ${token}`);
    const r=await mvsTriangulationProbe(CONFIG.mvsWorker);if(r.count<6)throw new Error(`MVS runtime returned only ${r.count} points`);
    return {points:r.count,baseline:r.baseline,matches:r.matches,source:r.source};
  });
  await run('gaussian-worker',()=>workerReady(CONFIG.gaussianWorker,{voxel:.03,maxGaussians:1000,maxSnapshot:100}));
  await run('mvs-worker',()=>workerReady(CONFIG.mvsWorker,{near:.3,far:5,depthSteps:8,gridStep:8,maxPoints:200}));

  await run('indexeddb',async()=>{
    const db=await new V30Database().open(),id=`selftest-${crypto.randomUUID()}`;
    await db.put('events',{id,value:BUILD.id});const got=await db.get('events',id);if(got?.value!==BUILD.id)throw new Error('IndexedDB roundtrip mismatch');

    // Regression: reproduce the exact phone state "existing v3, requested v2".
    // openVersionSafe must keep v3 and never issue the invalid downgrade open.
    const probeName=`room-scanner-v30-version-probe-${crypto.randomUUID()}`;
    const v3=await nativeOpen(probeName,3);v3.close();
    const safe=await openVersionSafe(probeName,2,()=>{});
    const actual=safe.db.version;safe.db.close();indexedDB.deleteDatabase(probeName);
    if(actual<3)throw new Error(`version-safe open regressed to ${actual}`);
    return {db:BUILD.dbName,targetVersion:BUILD.dbVersion,actualVersion:db.db.version,downgradeProbe:`PASS v3 -> requested v2 kept v${actual}`};
  });

  await run('world-anchor-source',async()=>{
    const text=await fetch(`js/xr/xr_calibration.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();});
    for(const token of ['hit.createAnchor()','tracked.has(ray.anchor)','frame.getPose(ray.anchor.anchorSpace','realAnchor:true'])if(!text.includes(token))throw new Error(`missing real-anchor contract token: ${token}`);
    for(const token of ['_renderScenePins(frame,view)','view.transform.inverse.matrix','gl.drawArrays(gl.POINTS'])if(!text.includes(token))throw new Error(`missing 3D XR render token: ${token}`);
    return 'XRHitTestResult -> XRAnchor -> trackedAnchors -> anchorSpace -> WebGL XR scene marker';
  });


  await run('three-pin-apply-contract',async()=>{
    if(CONFIG.xrCalibrationMinTargets!==3)throw new Error(`min targets is ${CONFIG.xrCalibrationMinTargets}, expected 3`);
    if(CONFIG.xrRoiMinViewsPerTarget>4)throw new Error(`ROI gate too strict: ${CONFIG.xrRoiMinViewsPerTarget}`);
    if(CONFIG.xrCalibrationMinTargetBaselineM>.08)throw new Error(`baseline gate too strict: ${CONFIG.xrCalibrationMinTargetBaselineM}`);
    const text=await fetch(`js/xr/xr_calibration.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();});
    if(!text.includes('poseCoverageRequiredForApply:false'))throw new Error('global pose coverage still gates Apply');
    if(!text.includes('applyTargets=this.targets.filter(t=>t.ready&&t.visible)'))throw new Error('Apply does not select useful visible pins');
    return '3 useful pins + common view => Apply; extra/incomplete pins do not block';
  });

  await run('manual-roi-contract',async()=>{const text=await fetch(`js/xr/xr_calibration.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();});for(const token of ['_ensureCenterAim()','confirmManualPin()','offsets=[[0,0]]','xr-pin-roi-view','roiViews','pin-rejected'])if(!text.includes(token))throw new Error(`missing V30.11 pin/ROI token: ${token}`);const html=await fetch(`room_scanner_v30.html?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text());for(const id of ['calibAddPinBtn','calibUndoPinBtn','calibFinishBtn','calibCancelBtn'])if(!html.includes(`id=\"${id}\"`))throw new Error(`minimal control missing: ${id}`);if(html.includes('calibManualGuide'))throw new Error('old calibration panel still present');return 'center reticle -> add/remove one XRAnchor pin -> background multi-view ROI atlas';});
  await run('measurement-guidance',async()=>{const text=await fetch(`js/xr/measurement_guidance.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();});if(!text.includes('bridgePinGuidance')||!text.includes('RoomScanMetricContext'))throw new Error('measurement pin-area guidance missing');const geom=await fetch(`js/metric/metric_geometry.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text());if(!geom.includes('metricizeGaussians')||!geom.includes('gaussianSurfaceSamples'))throw new Error('metric GS helper missing');return 'saved pin ROIs + metric camera context + GS surface extraction';});
  await run('unhandled-rejection-regression',async()=>{const text=await fetch(`js/xr/xr_calibration.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text());const a=text.indexOf('async pinNearestCandidate(uv){'),b=text.indexOf('async pinCandidate(candidate){',a);const part=a>=0&&b>a?text.slice(a,b):'';if(!part.includes('return false')||!part.includes('pin-rejected'))throw new Error('user tap can still escape as rejected Promise');return 'normal placement rejection is converted to handled UI event';});

  await run('metric-lock-nonblocking',async()=>{
    const [guidance,bridge,app]=await Promise.all([
      fetch(`js/xr/measurement_guidance.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),
      fetch(`js/xr/metric_bridge.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),
      fetch(`js/app.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text())
    ]);
    if(/new\s+MutationObserver\s*\(/.test(guidance))throw new Error('measurement guidance still contains a self-triggering DOM observer');
    if(!guidance.includes('roomscan:metric-bridge-update'))throw new Error('metric guidance is not event-driven');
    if(!bridge.includes('maxComparisons=520')||!bridge.includes('takeStream()'))throw new Error('metric matcher is not bounded/stream-transfer capable');
    if(app.indexOf('await bridge.start()')>app.indexOf("lazy('./xr/measurement_guidance.js')",app.indexOf('async function beginBridge')))throw new Error('guidance loads before camera preview');
    return 'event-driven guidance + bounded matcher + camera stream handoff';
  });

  await run('service-worker-file',async()=>{const text=await fetch(`${CONFIG.serviceWorker}?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();});if(!text.includes(`room-scanner-v${BUILD.version}-shell`))throw new Error(`service worker cache is not ${BUILD.version}`);return BUILD.version;});
  await run('build-info-fresh',async()=>{const info=await fetch(`${CONFIG.buildInfo}?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();});if(info.id!==BUILD.id||info.version!==BUILD.version)throw new Error(`published ${info.id||info.version} != runtime ${BUILD.id}`);return info.id;});
  return tests;
}

function nativeOpen(name,version){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,version);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function workerReady(url,config){return new Promise((resolve,reject)=>{const w=new Worker(url),timer=setTimeout(()=>{w.terminate();reject(new Error(`worker timeout: ${url}`));},3000);w.onmessage=e=>{if(e.data?.type==='ready'){clearTimeout(timer);w.terminate();resolve(e.data);}};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(new Error(e.message||`worker error: ${url}`));};w.postMessage({type:'init',config});});}

function mvsTriangulationProbe(url){return new Promise((resolve,reject)=>{
  const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240},a={pose:{p:[0,0,0],q:[0,0,0,1]},features:[],width:320,height:240},b={pose:{p:[.08,0,0],q:[0,0,0,1]},features:[],width:320,height:240,rgba:new Uint8ClampedArray(320*240*4)},pts=[[-.3,.1,1.5],[0,.15,2],[.25,-.1,2.5],[.1,.25,3],[-.15,-.2,1.8],[.35,.1,2.2],[-.25,.2,2.7],[.05,-.25,1.6]];
  const proj=(pose,p)=>[K.fx*(p[0]-pose.p[0])/(p[2]-pose.p[2])+K.cx,K.cy-K.fy*(p[1]-pose.p[1])/(p[2]-pose.p[2])];
  pts.forEach((p,i)=>{const A=proj(a.pose,p),B=proj(b.pose,p),desc=Array.from({length:8},(_,k)=>(i*23+k*11)%256);a.features.push({x:A[0],y:A[1],score:100-i,desc});b.features.push({x:B[0],y:B[1],score:100-i,desc:[...desc]});});
  const w=new Worker(url),timer=setTimeout(()=>{w.terminate();reject(new Error('MVS pair timeout'));},3500);w.onmessage=e=>{const d=e.data||{};if(d.type==='ready'){w.postMessage({type:'pair',a,b,K});return;}if(d.type==='mvs-result'){clearTimeout(timer);w.terminate();resolve(d);}if(d.type==='mvs-error'){clearTimeout(timer);w.terminate();reject(new Error(d.message||'MVS error'));}};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(new Error(e.message||'MVS worker error'));};w.postMessage({type:'init',config:{near:.3,far:5,minBaselineM:.03,maxBaselineM:1,maxPoints:100}});
});}
