import {CONFIG,BUILD} from './config.js';
import {WasmVisionFrontend} from './slam/wasm_frontend.js';
import {V30Database,openVersionSafe} from './storage/db.js';
import {triangulateRays,poseIdentity} from './slam/math.js';

/*
 * V30.9 self-tests intentionally include regressions for the two phone failures
 * reported on V30.8: IndexedDB downgrade and fake/screen-space WebXR pins.
 */
export async function runSelfTests(log){
  const tests=[];
  const run=async(name,fn)=>{const t=performance.now();try{const detail=await fn();const r={name,ok:true,ms:performance.now()-t,detail};tests.push(r);log.info('self-test-pass',r);}catch(err){const r={name,ok:false,ms:performance.now()-t,error:err.message};tests.push(r);log.error('self-test-fail',{...r,stack:err.stack});}};

  await run('secure-context',()=>{if(!isSecureContext&&location.hostname!=='localhost')throw new Error('HTTPS required');return location.protocol;});
  await run('required-dom',()=>{for(const id of ['calibrateBtn','calibOverlay','calibUndoPinBtn','startBtn','diagDownloadBtn','selfTestBtn','forceUpdateBtn','viewer','bridgeCamera'])if(!document.getElementById(id))throw new Error(`missing #${id}`);return 'ok';});
  await run('runtime-contract',()=>({webXR:!!navigator.xr,webAssembly:typeof WebAssembly==='object',camera:!!navigator.mediaDevices?.getUserMedia,imuRequired:false,deepAI:false,realAnchorsRequired:CONFIG.xrRequireRealAnchors!==false}));

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
    if(!text.includes("seedUv:t.state==='tracking'"))throw new Error('live overlay projection contract missing');
    return 'XRHitTestResult -> XRAnchor -> trackedAnchors -> anchorSpace -> live projection';
  });

  await run('service-worker-file',async()=>{const text=await fetch(`${CONFIG.serviceWorker}?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();});if(!text.includes(`room-scanner-v${BUILD.version}-shell`))throw new Error(`service worker cache is not ${BUILD.version}`);return BUILD.version;});
  await run('build-info-fresh',async()=>{const info=await fetch(`${CONFIG.buildInfo}?selftest=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();});if(info.id!==BUILD.id||info.version!==BUILD.version)throw new Error(`published ${info.id||info.version} != runtime ${BUILD.id}`);return info.id;});
  return tests;
}

function nativeOpen(name,version){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,version);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function workerReady(url,config){return new Promise((resolve,reject)=>{const w=new Worker(url),timer=setTimeout(()=>{w.terminate();reject(new Error(`worker timeout: ${url}`));},3000);w.onmessage=e=>{if(e.data?.type==='ready'){clearTimeout(timer);w.terminate();resolve(e.data);}};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(new Error(e.message||`worker error: ${url}`));};w.postMessage({type:'init',config});});}
