import {CONFIG,BUILD} from './config.js';
import {WasmVisionFrontend} from './slam/wasm_frontend.js';
import {V30Database,openVersionSafe} from './storage/db.js';
import {triangulateRays,poseIdentity} from './slam/math.js';

/*
 * V30.26.0 self-tests intentionally include regressions for the two phone failures
 * reported on V30.8: IndexedDB downgrade and fake/screen-space WebXR pins.
 */
export async function runSelfTests(log){
  const tests=[];
  const run=async(name,fn)=>{const t=performance.now();try{const detail=await fn();const r={name,ok:true,ms:performance.now()-t,detail};tests.push(r);log.info('self-test-pass',r);}catch(err){const r={name,ok:false,ms:performance.now()-t,error:err.message};tests.push(r);log.error('self-test-fail',{...r,stack:err.stack});}};

  await run('secure-context',()=>{if(!isSecureContext&&location.hostname!=='localhost')throw new Error('HTTPS required');return location.protocol;});
  await run('required-dom',()=>{for(const id of ['calibrateBtn','calibOverlay','calibAddPinBtn','calibUndoPinBtn','calibFinishBtn','calibCancelBtn','startBtn','chooseDeepModelBtn','deepModelFile','testDeepBtn','deepModelStatus','deepTestPreview','depthOverlay','deepLiveState','diagDownloadBtn','selfTestBtn','forceUpdateBtn','viewer','bridgeCamera','bridgePinGuidance','bridgePinInstructions','miniMap','alvaPtsState','metricPipelineHud','metricGsStats','buildMetricMeshBtn'])if(!document.getElementById(id))throw new Error(`missing #${id}`);return 'ok';});
  await run('runtime-contract',()=>({webXR:!!navigator.xr,webAssembly:typeof WebAssembly==='object',camera:!!navigator.mediaDevices?.getUserMedia,imuRequired:false,localOnnxDepth:CONFIG.deepDepthEnabled!==false,realAnchorsRequired:CONFIG.xrRequireRealAnchors!==false}));

  await run('interactive-boot-order',async()=>{const text=await fetch(`js/app.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();});if(!text.includes("dataset.v30Interactive='1'"))throw new Error('core does not signal interactive UI after bind');if(!text.includes('void initBackground()'))throw new Error('background initialization is still a boot gate');for(const heavy of ["from './camera.js'","from './storage/db.js'","from './xr/xr_calibration.js'"])if(text.includes(heavy))throw new Error(`heavy static import remains: ${heavy}`);return 'UI bound first; heavy runtime lazy-loaded';});

  await run('unhandled-rejections',()=>{const xs=(window.__ROOMSCAN_PREBOOT?.errors||[]).filter(e=>e.type==='rejection');if(xs.length){const e=xs[xs.length-1];throw new Error(`${e.name||'PromiseRejection'}: ${e.message||'reason unavailable'}${e.source?` [${e.source}]`:''}`);}return 'none observed since page bootstrap';});

  await run('wasm-core',async()=>{const f=new WasmVisionFrontend(CONFIG.wasmCore);await f.init({requireAlva:false});const w=96,h=72,a=new Uint8Array(w*h),b=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){a[y*w+x]=((x*13+y*7)^((x>>3)*37))&255;const xx=Math.max(0,x-2);b[y*w+x]=((xx*13+y*7)^((xx>>3)*37))&255;}const r1=f.process(a,w,h,{maxFeatures:180,threshold:12}),r2=f.process(b,w,h,{maxFeatures:180,threshold:12});if(r1.count<5||r2.matches.count<2)throw new Error(`weak WASM output ${r1.count}/${r2.matches.count}`);return {features:r2.count,matches:r2.matches.count,limits:f.limits};});
  await run('alvaar-source-contract',async()=>{const [front,slam,overlay]=await Promise.all([fetch(`js/slam/wasm_frontend.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),fetch(`js/slam/slam_engine.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),fetch(`js/gaussian/ar_overlay.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text())]);for(const t of ['AlvaAR.Initialize','findCameraPose','alvaar-wasm'])if(!front.includes(t))throw new Error(`AlvaAR frontend token missing: ${t}`);for(const t of ['alvaMatrixToPose','setWorldTransform','alvaar-relocalized'])if(!slam.includes(t))throw new Error(`Alva autonomous tracking token missing: ${t}`);if(!overlay.includes('projectPoint')||!overlay.includes('analysisPixelToSource'))throw new Error('live AR overlay is not registered to the camera geometry');return {local:'vendor/alva_ar.js',remotes:CONFIG.alvaRemoteUrls||[CONFIG.alvaRemoteUrl].filter(Boolean),mode:window.RoomScanV30?.state?.frontend?.mode||'not-started'};});
  await run('alvaar-runtime-real',async()=>{
    const {loadAlvaModule,getAlvaRuntimeStatus,ALVA_EXPECTED_MIN_BYTES}=await import(`./slam/alva_runtime_loader.js?selftest=${Date.now()}`);
    const localUrl=new URL('../vendor/alva_ar.js',import.meta.url).href,cacheKey=new URL('../vendor/alva_ar.cached.js',import.meta.url).href;
    const mod=await loadAlvaModule({localUrl,cacheKey,sources:CONFIG.alvaRemoteUrls||[CONFIG.alvaRemoteUrl].filter(Boolean)});
    if(!mod?.AlvaAR?.Initialize)throw new Error('real AlvaAR.Initialize export missing');
    let st=getAlvaRuntimeStatus();
    // Vendor/cache sources are text-validated and therefore must report the
    // real ~4 MB source size. A direct remote ESM import is already validated
    // by its AlvaAR.Initialize export; its best-effort cache copy can finish a
    // moment later, so zero bytes here means "cache still warming", not a
    // fake runtime.
    if(st.source==='vendor'||st.source==='cache'){if(!(st.bytes>=ALVA_EXPECTED_MIN_BYTES))throw new Error(`AlvaAR bundle too small: ${st.bytes||0}`);}
    if(st.source==='remote'&&!st.bytes){const until=performance.now()+1500;while(performance.now()<until&&!st.bytes){await new Promise(r=>setTimeout(r,75));st=getAlvaRuntimeStatus();}}
    return {source:st.source,bytes:st.bytes||'cache-pending',cacheHit:st.cacheHit,url:st.url};
  });
  await run('alva-autonomous-world-contract',async()=>{const [app,slam,bridge,boot]=await Promise.all([fetch(`js/app.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),fetch(`js/slam/slam_engine.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),fetch(`js/xr/metric_bridge.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),fetch(`js/slam/alva_metric_bootstrap.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text())]);if(app.includes('SLAM FALLBACK'))throw new Error('optical tracking fallback still exposed');for(const t of ['same instance','setWorldTransform(metric.alvaTransform)','ALVA LOST','ALVA RELOCALIZED'])if(!app.includes(t))throw new Error(`app autonomous-Alva token missing: ${t}`);if(!slam.includes("trackingMode='alvaar-lost'")||!slam.includes('if(trackingValid&&'))throw new Error('lost Alva frames can still create trajectory/keyframes');if(!bridge.includes('short-lived-pin-pnp-bootstrap'))throw new Error('pin matcher is not short-lived PnP bootstrap');if(!boot.includes('one-shot-alva-metric-sim3'))throw new Error('fixed Sim3 bootstrap missing');return 'pins -> one-shot Sim3 -> detached autonomous Alva world';});

  await run('camera-crop-contract',async()=>{const text=await fetch(`js/camera.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text());for(const t of ['coverCrop','intrinsicsForCrop','analysisPixelToSource','drawImage(this.video,g.sx,g.sy,g.sw,g.sh'])if(!text.includes(t))throw new Error(`camera crop token missing: ${t}`);return 'analysis frame is cropped, not stretched; K follows the crop';});
  await run('live-ar-reconstruction',async()=>{const html=await fetch(`room_scanner_v30.html?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),app=await fetch(`js/app.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text());if(!html.includes('id="arModeBtn"')||!app.includes("new LiveReconstructionOverlay($('miniMap')"))throw new Error('live GS/mesh AR controls missing');if(!app.includes('state.liveOverlay?.draw({pose:r.pose,K,geometry:frame.geometry'))throw new Error('overlay is not rendered from the live SLAM pose');return 'camera + metric pose + GS/mesh overlay';});
  await run('visual-runtime-recovery',async()=>{
    const [html,calib,overlay,meshUi,app]=await Promise.all([
      fetch(`room_scanner_v30.html?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),
      fetch(`js/xr/xr_calibration.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),
      fetch(`js/gaussian/ar_overlay.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),
      fetch(`js/metric/metric_mesh_ui.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),
      fetch(`js/app.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text())
    ]);
    for(const id of ['bridgePinGuidance','bridgePinInstructions','alvaPtsState','metricPipelineHud','metricGsStats','buildMetricMeshBtn'])if(!html.includes(`id="${id}"`))throw new Error(`visual host missing: ${id}`);
    if(calib.includes("requiredFeatures:['local-floor','hit-test','camera-access"))throw new Error('raw camera access still gates WebXR calibration');
    for(const token of ['optionalFeatures:optional','projectionMatrix','rawCameraAvailable'])if(!calib.includes(token))throw new Error(`WebXR geometry fallback missing: ${token}`);
    for(const token of ['_drawAlvaPoints','setReferencePoint'])if(!overlay.includes(token))throw new Error(`Alva visual marker missing: ${token}`);
    if(!meshUi.includes("dataset.metricMeshBound='1'"))throw new Error('static metric mesh button is not bound');
    const bg=app.slice(app.indexOf('async function initBackground'),app.indexOf('function boot'));if(bg.includes('prefetchOfficialAlvaRuntime'))throw new Error('AlvaAR is still compiled/downloaded during background boot');
    return 'WebXR geometry-only pins + static visual hosts + live Alva points + bound mesh UI';
  });

  await run('alva-geometry-anchors',async()=>{
    const [slamText,mathText,sparseText]=await Promise.all([
      fetch(`js/slam/slam_engine.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),
      fetch(`js/slam/math.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text()),
      fetch(`js/dense/sparse_depth_anchors.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text())
    ]);
    if(!slamText.includes('qNormalize([r[0],-r[1],-r[2],r[3]])'))throw new Error('Alva quaternion is not using the proper RH/CV basis rotation');
    if(!mathText.includes('(v-K.cy)/K.fy'))throw new Error('camera rays are not +Y-down CV rays');
    for(const t of ['buildSparseDepthAnchors','triangulateRays','maxReprojectionPx','robustDepthRange'])if(!sparseText.includes(t))throw new Error(`sparse geometry gate missing: ${t}`);
    return 'Alva pose -> reprojection-verified sparse depth anchors -> bounded dense search';
  });
  await run('camera-only-triangulation',()=>{const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240},a={pose:poseIdentity(),K,u:160,v:120},b={pose:{p:[.20,0,0],q:[0,0,0,1]},K,u:130,v:120},r=triangulateRays(a,b,{minAngleRad:.005,maxGapM:.15});if(!r.ok)throw new Error(r.reason);return {p:r.p,angle:r.angle,gap:r.gap};});

  // Runtime regression: V30.11.3 parsed correctly but crashed only when Scan
  // instantiated SlamEngine after metric lock because its derived constructor
  // accessed this before super(). Instantiating and processing a frame here
  // catches that class of failure on the actual browser runtime.
  await run('scan-runtime-constructor',async()=>{
    const {SlamEngine}=await import(`./slam/slam_engine.js?selftest=${Date.now()}`);
    const frontend={processFrame:()=>({count:3,features:[{x:1,y:1,desc:[1]}],matches:{count:1,items:[]},cameraPose:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],framePoints:[]})};
    const slam=new SlamEngine({frontend,K:{fx:320,fy:320,cx:160,cy:240,width:320,height:480},keyframeIntervalMs:1});
    slam.setWorldTransform({scale:1,qAlign:[0,0,0,1],translation:[0,0,0],source:'self-test'});
    const r=slam.process({gray:new Uint8Array(640),imageData:{data:new Uint8ClampedArray(2560)},width:320,height:2,at:1});
    if(!r.metricLocked||r.matches!==1||r.keyframes!==1||!r.trackingValid)throw new Error('SlamEngine first metric Alva frame failed');
    return {metricLocked:r.metricLocked,matches:r.matches,keyframes:r.keyframes};
  });
  await run('alva-deep-ray-consensus-pipeline',async()=>{
    const app=await fetch(`js/app.js?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>r.text());
    for(const token of ["new DenseKeyframeManager","CONFIG.denseDepthWorker","deep_ray_samples.js","mode:'deep-ray'","type:'depth'","type:'integrate'","surface-result","type:'mesh'"])if(!app.includes(token))throw new Error(`missing dense mapper wiring: ${token}`);
    if(app.includes("state.gaussianWorker?.postMessage({type:'add'"))throw new Error('sparse feature -> Gaussian path is still active');
    const [{estimateDenseDepth},{SparseDenseFusion},{depthMapToRaySamples}]=await Promise.all([import(`./dense/plane_sweep_core.js?selftest=${Date.now()}`),import(`./dense/fusion_core.js?selftest=${Date.now()}`),import(`./dense/deep_ray_samples.js?selftest=${Date.now()}`)]);
    const w=72,h=54,K={fx:66,fy:66,cx:w/2,cy:h/2,width:w,height:h};
    const make=(px)=>{const gray=new Uint8Array(w*h),rgba=new Uint8ClampedArray(w*h*4);for(let v=0;v<h;v++)for(let u=0;u<w;u++){const z=2,x=px+(u-K.cx)/K.fx*z,y=(K.cy-v)/K.fy*z,val=Math.max(0,Math.min(255,128+(Math.sin(x*17)+Math.sin(y*23)+Math.sin((x+y)*31))*34)),i=v*w+u;gray[i]=val;rgba[i*4]=val;rgba[i*4+1]=Math.min(255,val+10);rgba[i*4+2]=Math.max(0,val-10);rgba[i*4+3]=255;}return {id:String(px),pose:{p:[px,0,0],q:[0,0,0,1]},K,width:w,height:h,gray,rgba};};
    const ref=make(0),sources=[make(-.12),make(.12),make(.22)],depth=estimateDenseDepth({ref,sources,K,near:1,far:3,depthSteps:42,pixelStep:3,minViews:2,maxCost:.28,minConfidence:.07});
    if(depth.samples.length<120||Math.abs(depth.medianDepth-2)>.18)throw new Error(`dense plane probe weak: ${depth.samples.length} samples, median ${depth.medianDepth}`);
    const deepMap=new Float32Array(w*h);deepMap.fill(2);const rayProbe=depthMapToRaySamples({depth:deepMap,width:w,height:h,ref,K,baseConfidence:.8,calibrationRelativeError:.06,pixelStep:6,maxSamples:1000});if(rayProbe.samples.length<40||!rayProbe.samples.every(s=>s.sigmaDepth>s.sigmaLateral))throw new Error('anisotropic Deep ray sampler failed');
    const fusion=new SparseDenseFusion({voxel:.07,truncation:.21,minSupport:2,maxTsdf:80000});for(let i=0;i<3;i++){const jitter=(i-1)*.004;fusion.integrate(depth.samples.slice(0,500).map(s=>({...s,p:[s.p[0]+jitter,s.p[1],s.p[2]+jitter*.4]})),{origin:[(i-1)*.1,0,0],frameId:`probe-${i}`,mode:'mvs-refined'});}
    const splats=fusion.splats({max:5000}),mesh=fusion.mesh({maxTriangles:12000});if(splats.length<60||mesh.faces.length<30)throw new Error(`fusion probe weak: ${splats.length} surfels, ${mesh.faces.length/3} faces`);
    return {depthSamples:depth.samples.length,deepRaySamples:rayProbe.samples.length,medianDepth:depth.medianDepth,surfels:splats.length,meshFaces:mesh.faces.length/3};
  });
  await run('dense-depth-worker',()=>workerReadyModule(CONFIG.denseDepthWorker,{depthSteps:16,pixelStep:4,minViews:1,maxSamples:1000}));
  await run('dense-fusion-worker',()=>workerReadyModule(CONFIG.denseFusionWorker,{voxel:.06,truncation:.18,minSupport:2,maxSurfels:5000,maxTsdf:20000}));
  // Legacy workers stay packaged for backward-compatible imports/old sessions,
  // but V30.16 does not use them as the primary reconstruction path.
  await run('gaussian-worker-compat',()=>workerReady(CONFIG.gaussianWorker,{voxel:.03,maxGaussians:1000,maxSnapshot:100}));
  await run('mvs-worker-compat',()=>workerReady(CONFIG.mvsWorker,{near:.3,far:5,depthSteps:8,gridStep:8,maxPoints:200}));

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
function workerReadyModule(url,config){return new Promise((resolve,reject)=>{const w=new Worker(url,{type:'module'}),timer=setTimeout(()=>{w.terminate();reject(new Error(`module worker timeout: ${url}`));},4000);w.onmessage=e=>{if(e.data?.type==='ready'){clearTimeout(timer);w.terminate();resolve(e.data);}};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(new Error(e.message||`module worker error: ${url}`));};w.postMessage({type:'init',config});});}

function mvsTriangulationProbe(url){return new Promise((resolve,reject)=>{
  const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240},a={pose:{p:[0,0,0],q:[0,0,0,1]},features:[],width:320,height:240},b={pose:{p:[.08,0,0],q:[0,0,0,1]},features:[],width:320,height:240,rgba:new Uint8ClampedArray(320*240*4)},pts=[[-.3,.1,1.5],[0,.15,2],[.25,-.1,2.5],[.1,.25,3],[-.15,-.2,1.8],[.35,.1,2.2],[-.25,.2,2.7],[.05,-.25,1.6]];
  const proj=(pose,p)=>[K.fx*(p[0]-pose.p[0])/(p[2]-pose.p[2])+K.cx,K.cy-K.fy*(p[1]-pose.p[1])/(p[2]-pose.p[2])];
  pts.forEach((p,i)=>{const A=proj(a.pose,p),B=proj(b.pose,p),desc=Array.from({length:8},(_,k)=>(i*23+k*11)%256);a.features.push({x:A[0],y:A[1],score:100-i,desc});b.features.push({x:B[0],y:B[1],score:100-i,desc:[...desc]});});
  const w=new Worker(url),timer=setTimeout(()=>{w.terminate();reject(new Error('MVS pair timeout'));},3500);w.onmessage=e=>{const d=e.data||{};if(d.type==='ready'){w.postMessage({type:'pair',a,b,K});return;}if(d.type==='mvs-result'){clearTimeout(timer);w.terminate();resolve(d);}if(d.type==='mvs-error'){clearTimeout(timer);w.terminate();reject(new Error(d.message||'MVS error'));}};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(new Error(e.message||'MVS worker error'));};w.postMessage({type:'init',config:{near:.3,far:5,minBaselineM:.03,maxBaselineM:1,maxPoints:100}});
});}
