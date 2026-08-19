import {checkRuntimeAssets} from './boot_preflight.js';

const pre=window.__ROOMSCAN_PREBOOT||(window.__ROOMSCAN_PREBOOT={at:Date.now(),errors:[],ready:false});
const status=()=>document.getElementById('homeStatus');
const badge=()=>document.getElementById('buildBadge');
function record(type,data){pre.errors.push({time:Date.now(),type,...data});}
function showFatal(title,details=[]){
  document.documentElement.dataset.v30BootFailed='1';
  const s=status(); if(s){s.dataset.kind='error';s.innerHTML=`<b>${title}</b><br>${details.map(x=>String(x)).join('<br>')}`;}
  const b=badge(); if(b)b.textContent='V30.10.1 · BOOT ERROR';
  const d=document.getElementById('diagPanel'); if(d)d.open=true;
  const live=document.getElementById('diagLive'); if(live)live.textContent=JSON.stringify({title,details,errors:pre.errors},null,2);
}

async function optionalImport(path){
  try{return await import(path);}catch(err){record('optional-module-error',{path,message:err?.message||String(err),stack:err?.stack||null});console.error('[V30 optional module]',path,err);return null;}
}

(async()=>{
  try{
    const s=status(); if(s)s.textContent='Verifica integrità runtime V30.10.1…';
    const check=await checkRuntimeAssets();
    pre.assetCheck=check;
    if(!check.ok){
      const lines=check.missing.map(x=>`${x.path}: ${x.reason}`);
      record('asset-preflight-failed',{missing:check.missing});
      showFatal('Installazione V30 incompleta: mancano file runtime.',lines);
      return;
    }

    // Must run before app.js so Gaussian workers created by the core app are observed.
    await import('./metric/metric_geometry.js');
    await import('./metric/gaussian_metric_tap.js');

    // Core app is mandatory. Any exception here is a real bootstrap failure.
    await import('./app.js');

    // UI/diagnostic extensions must never take down the core scanner.
    await optionalImport('./xr/xr_calibration_manual_ui.js');
    await optionalImport('./xr/measurement_guidance.js');
    await optionalImport('./metric/metric_mesh_ui.js');

    pre.modulesLoaded=true;
  }catch(err){
    record('bootstrap-module-error',{name:err?.name||null,message:err?.message||String(err),stack:err?.stack||null});
    showFatal(`Bootstrap module error: ${err?.message||err}`,[err?.stack||'']);
  }
})();
