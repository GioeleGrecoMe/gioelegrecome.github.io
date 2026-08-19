import {CONFIG,BUILD} from './config.js';
import {WasmVisionFrontend} from './slam/wasm_frontend.js';
import {V30Database,openVersionSafe} from './storage/db.js';
import {triangulateRays,poseIdentity} from './slam/math.js';

/*
 * V30.11.1 self-tests intentionally include regressions for the two phone failures
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
  await run('camera-only-triangulation',()=>{const K={fx:300,fy:300,cx:160,cy:120,width:320,height:240},a={pose:poseIdentity(),K,u:160,v:120},b={pose:{p:[.20,0,0],q:[0,0,0,1]},K,u:130,v:120},r=triangulateRays(a,b,{minAngleRad:.005,maxGapM:.15});if(!r.ok)throw new Error(r.reason);return {p:r.p,angle:r.angle,gap:r.gap};});
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

  await run('service-worker-file',async()=>{const text=await fetch(`${CONFIG.serviceWorker}?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();});if(!text.includes(`room-scanner-v${BUILD.version}-shell`))throw new Error(`service worker cache is not ${BUILD.version}`);return BUILD.version;});
  await run('build-info-fresh',async()=>{const info=await fetch(`${CONFIG.buildInfo}?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();});if(info.id!==BUILD.id||info.version!==BUILD.version)throw new Error(`published ${info.id||info.version} != runtime ${BUILD.id}`);return info.id;});
  return tests;
}

function nativeOpen(name,version){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,version);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function workerReady(url,config){return new Promise((resolve,reject)=>{const w=new Worker(url),timer=setTimeout(()=>{w.terminate();reject(new Error(`worker timeout: ${url}`));},3000);w.onmessage=e=>{if(e.data?.type==='ready'){clearTimeout(timer);w.terminate();resolve(e.data);}};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(new Error(e.message||`worker error: ${url}`));};w.postMessage({type:'init',config});});}
