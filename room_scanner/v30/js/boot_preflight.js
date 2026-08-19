/* V30.10.2 runtime asset diagnostics.
 *
 * IMPORTANT: this module is diagnostic, not a boot gate. V30.10.1 performed
 * sequential no-store fetches before importing app.js. On mobile a single slow
 * request/service-worker path could therefore render the home screen while no
 * button had an event handler. V30.10.2 imports/binds the app first and runs
 * these bounded probes in the background.
 */
export const REQUIRED_RUNTIME_ASSETS = [
  'styles.css','manifest.webmanifest','build_info.json',
  'js/app.js','js/config.js','js/logger.js','js/camera.js','js/formats.js','js/self_test.js',
  'js/storage/db.js','js/slam/math.js','js/slam/wasm_frontend.js','js/slam/slam_engine.js',
  'js/xr/xr_calibration.js','js/xr/metric_bridge.js','js/gaussian/renderer.js',
  'workers/gaussian_worker.js','workers/mvs_worker.js','wasm/slam_core.wasm'
];

function timeoutController(ms){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1,ms));
  return {signal:controller.signal,cancel:()=>clearTimeout(timer)};
}

async function probe(path,{timeoutMs=2200}={}){
  const timeout=timeoutController(timeoutMs);
  try{
    const r=await fetch(`${path}${path.includes('?')?'&':'?'}bootcheck=${Date.now()}`,{cache:'no-store',signal:timeout.signal});
    if(!r.ok)return {path,ok:false,status:r.status,reason:`HTTP ${r.status}`};
    if(path.endsWith('.wasm')){
      const b=await r.arrayBuffer();
      if(b.byteLength<8)return {path,ok:false,status:r.status,reason:'WASM vuoto/troncato'};
      const u=new Uint8Array(b,0,Math.min(4,b.byteLength));
      if(u.length<4||u[0]!==0x00||u[1]!==0x61||u[2]!==0x73||u[3]!==0x6d)return {path,ok:false,status:r.status,reason:'magic WASM non valida'};
    }else{
      const t=await r.text();
      if(!t.length)return {path,ok:false,status:r.status,reason:'file vuoto'};
    }
    return {path,ok:true,status:r.status};
  }catch(err){
    return {path,ok:false,status:0,reason:timeout.signal.aborted?'timeout':err?.message||String(err)};
  }finally{timeout.cancel();}
}

export async function checkRuntimeAssets(paths=REQUIRED_RUNTIME_ASSETS,options={}){
  // Parallel bounded probes: diagnostics complete quickly and can never serially
  // hold the application UI hostage.
  const results=await Promise.all(paths.map(path=>probe(path,options)));
  return {ok:results.every(x=>x.ok),results,missing:results.filter(x=>!x.ok)};
}
