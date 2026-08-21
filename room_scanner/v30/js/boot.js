const pre=window.__ROOMSCAN_PREBOOT||(window.__ROOMSCAN_PREBOOT={at:Date.now(),errors:[],phases:[]});
const status=()=>document.getElementById('homeStatus');
function record(type,data={}){pre.errors.push({time:Date.now(),type,...data});}
(async()=>{
  try{
    const s=status();if(s)s.textContent='Collegamento interfaccia…';
    await import('./app.js?v=30.39.2');
    pre.coreLoaded=true;
    // Diagnostics are useful but not boot-critical. A missing optional module
    // must never turn an already interactive UI into a fake BOOT ERROR.
    try{
      await import('./deep_diagnostic_controller.js?v=30.39.2');
      pre.diagnosticsLoaded=true;
    }catch(err){
      pre.diagnosticsLoaded=false;
      record('optional-diagnostics-module-error',{name:err?.name||null,message:err?.message||String(err),stack:err?.stack||null});
    }
  }catch(err){
    record('bootstrap-module-error',{name:err?.name||null,message:err?.message||String(err),stack:err?.stack||null});
    document.documentElement.dataset.v30BootFailed='1';
    const s=status();if(s){s.dataset.kind='error';s.textContent=`BOOT ERROR: ${err?.message||err}`;}
    const d=document.getElementById('diagPanel');if(d)d.open=true;
    const live=document.getElementById('diagLive');if(live)live.textContent=JSON.stringify(pre,null,2);
    // Let the inline atomic guard recover even when app.js itself cannot load.
    setTimeout(()=>{if(document.documentElement.dataset.v30Interactive!=='1'&&typeof pre.recover==='function')void pre.recover(err?.message||'bootstrap module failure');},1200);
  }
})();
