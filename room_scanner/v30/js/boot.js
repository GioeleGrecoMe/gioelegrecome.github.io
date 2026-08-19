const pre=window.__ROOMSCAN_PREBOOT||(window.__ROOMSCAN_PREBOOT={at:Date.now(),errors:[],ready:false});
const status=()=>document.getElementById('homeStatus');
const badge=()=>document.getElementById('buildBadge');
function record(type,data){pre.errors.push({time:Date.now(),type,...data});}
function showFatal(title,details=[]){
  document.documentElement.dataset.v30BootFailed='1';
  const s=status();if(s){s.dataset.kind='error';s.innerHTML=`<b>${title}</b><br>${details.map(x=>String(x)).join('<br>')}`;}
  const b=badge();if(b)b.textContent='V30.10.2 · BOOT ERROR';
  const d=document.getElementById('diagPanel');if(d)d.open=true;
  const live=document.getElementById('diagLive');if(live)live.textContent=JSON.stringify({title,details,errors:pre.errors},null,2);
}
async function optionalImport(path){
  try{return await import(path);}catch(err){record('optional-module-error',{path,message:err?.message||String(err),stack:err?.stack||null});console.error('[V30 optional module]',path,err);return null;}
}
function publishAssetDiagnostics(check){
  pre.assetCheck=check;
  if(check.ok){record('asset-preflight-ok',{count:check.results.length});return;}
  record('asset-preflight-warning',{missing:check.missing});
  const banner=document.getElementById('updateBanner'),text=document.getElementById('updateText');
  if(banner)banner.hidden=false;
  if(text)text.textContent=`Asset non raggiungibili: ${check.missing.map(x=>`${x.path} (${x.reason})`).join(', ')}. L'interfaccia resta attiva; usa Diagnostica/Forza aggiornamento.`;
}
function scheduleDiagnostics(){
  const run=()=>import('./boot_preflight.js')
    .then(({checkRuntimeAssets})=>checkRuntimeAssets(undefined,{timeoutMs:2200}))
    .then(publishAssetDiagnostics)
    .catch(err=>record('asset-preflight-error',{message:err?.message||String(err)}));
  if('requestIdleCallback'in window)requestIdleCallback(run,{timeout:1200});else setTimeout(run,80);
}

(async()=>{
  try{
    const s=status();if(s)s.textContent='Avvio interfaccia V30.10.2…';
    // Core first: app.js binds primary controls before DB/SW awaits.
    await import('./app.js');
    pre.coreLoaded=true;
    // Optional extensions cannot take down the core UI.
    await Promise.allSettled([
      optionalImport('./metric/metric_geometry.js'),
      optionalImport('./metric/gaussian_metric_tap.js'),
      optionalImport('./xr/xr_calibration_manual_ui.js'),
      optionalImport('./xr/measurement_guidance.js'),
      optionalImport('./metric/metric_mesh_ui.js')
    ]);
    pre.modulesLoaded=true;
    scheduleDiagnostics();
  }catch(err){
    record('bootstrap-module-error',{name:err?.name||null,message:err?.message||String(err),stack:err?.stack||null});
    showFatal(`Bootstrap core error: ${err?.message||err}`,[err?.stack||'']);
  }
})();
