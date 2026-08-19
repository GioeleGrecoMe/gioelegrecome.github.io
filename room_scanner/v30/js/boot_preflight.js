/* V30.10.1 bootstrap preflight.
 * The previous single-folder archive accidentally omitted the original V30 core
 * files. This guard prevents a half-installed build from entering an endless
 * BOOT state and reports the exact missing path instead.
 */
export const REQUIRED_RUNTIME_ASSETS = [
  'styles.css','manifest.webmanifest','build_info.json',
  'js/app.js','js/config.js','js/logger.js','js/camera.js','js/formats.js','js/self_test.js',
  'js/storage/db.js','js/slam/math.js','js/slam/wasm_frontend.js','js/slam/slam_engine.js',
  'js/xr/xr_calibration.js','js/xr/metric_bridge.js','js/gaussian/renderer.js',
  'workers/gaussian_worker.js','workers/mvs_worker.js','wasm/slam_core.wasm'
];

async function probe(path){
  try{
    const r=await fetch(`${path}${path.includes('?')?'&':'?'}bootcheck=${Date.now()}`,{cache:'no-store'});
    if(!r.ok) return {path,ok:false,status:r.status,reason:`HTTP ${r.status}`};
    const len=Number(r.headers.get('content-length')||0);
    if(path.endsWith('.wasm')){
      const b=await r.arrayBuffer();
      if(b.byteLength<8) return {path,ok:false,status:r.status,reason:'WASM vuoto/troncato'};
    }else if(len===0){
      const t=await r.text();
      if(!t.length) return {path,ok:false,status:r.status,reason:'file vuoto'};
    }
    return {path,ok:true,status:r.status};
  }catch(err){return {path,ok:false,status:0,reason:err?.message||String(err)};}
}

export async function checkRuntimeAssets(paths=REQUIRED_RUNTIME_ASSETS){
  const results=[];
  // Sequential on purpose: easier diagnostics and less startup pressure on mobile.
  for(const path of paths) results.push(await probe(path));
  return {ok:results.every(x=>x.ok),results,missing:results.filter(x=>!x.ok)};
}
