import {CONFIG,BUILD} from './config.js';
import {WasmVisionFrontend} from './slam/wasm_frontend.js';
import {V30Database} from './storage/db.js';

export async function runSelfTests(log){
  const tests=[];const run=async(name,fn)=>{const t=performance.now();try{const detail=await fn();const r={name,ok:true,ms:performance.now()-t,detail};tests.push(r);log.info('self-test-pass',r);}catch(err){const r={name,ok:false,ms:performance.now()-t,error:err.message};tests.push(r);log.error('self-test-fail',{...r,stack:err.stack});}};
  await run('secure-context',()=>{if(!isSecureContext&&location.hostname!=='localhost')throw new Error('HTTPS required for camera');return location.protocol;});
  await run('required-dom',()=>{for(const id of ['startBtn','cameraHeight','diagDownloadBtn','selfTestBtn','viewer'])if(!document.getElementById(id))throw new Error(`missing #${id}`);return 'ok';});
  await run('wasm-core',async()=>{const f=new WasmVisionFrontend(CONFIG.wasmCore);await f.init();const w=96,h=72,a=new Uint8Array(w*h),b=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){a[y*w+x]=((x*13+y*7)^((x>>3)*37))&255;const xx=Math.max(0,x-2);b[y*w+x]=((xx*13+y*7)^((xx>>3)*37))&255;}const r1=f.process(a,w,h,{maxFeatures:180,threshold:12}),r2=f.process(b,w,h,{maxFeatures:180,threshold:12});if(r1.count<5||r2.matches.count<2)throw new Error(`weak WASM output ${r1.count}/${r2.matches.count}`);return {features:r2.count,matches:r2.matches.count};});
  await run('gaussian-worker',()=>new Promise((resolve,reject)=>{const w=new Worker(CONFIG.gaussianWorker);const timer=setTimeout(()=>{w.terminate();reject(new Error('worker timeout'));},2500);w.onmessage=e=>{if(e.data?.type==='ready'){clearTimeout(timer);w.terminate();resolve(e.data.config);}};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(new Error(e.message));};w.postMessage({type:'init',config:{voxel:.03,maxGaussians:1000,maxSnapshot:100}});}));
  await run('indexeddb',async()=>{const db=await new V30Database().open(),id=`selftest-${crypto.randomUUID()}`;await db.put('events',{id,value:BUILD.id});const got=await db.get('events',id);if(got?.value!==BUILD.id)throw new Error('IndexedDB roundtrip mismatch');return BUILD.dbName;});
  await run('service-worker-file',async()=>{const r=await fetch(CONFIG.serviceWorker,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.status;});
  return {ok:tests.every(t=>t.ok),tests};
}
