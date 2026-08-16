(() => {
  'use strict';
  const BUILD='room-scanner-v11-d14-depth-boottrace-2026-08-16';
  const pageEvents=[];
  const MAX_EVENTS=80;
  const RX=/depth|onnx|ort\.|wasm|webgpu|inference|session/i;
  let previousTrace=null;try{const raw=localStorage.getItem('roomScannerV11D14LastTrace');if(raw)previousTrace=JSON.parse(raw)}catch(_){}
  function push(type,detail){
    let clean=detail;
    try{clean=JSON.parse(JSON.stringify(detail));}catch(_){clean={text:String(detail)}}
    pageEvents.push({iso:new Date().toISOString(),t_ms:Math.round(performance.now()),type,detail:clean});
    if(pageEvents.length>MAX_EVENTS)pageEvents.splice(0,pageEvents.length-MAX_EVENTS);
    try{localStorage.setItem('roomScannerV11D14LastTrace',JSON.stringify({build:BUILD,updatedAt:new Date().toISOString(),href:location.href,pageEvents:pageEvents.slice(-80)}))}catch(_){}
    updateCompactStatus();
    updateLiveTrace();
  }
  window.__DEPTH_V11_D14_PUSH__=(type,detail)=>push(type,detail);
  window.addEventListener('error',e=>{
    const text=[e.message,e.filename,e.error&&e.error.stack].filter(Boolean).join(' ');
    push('page-error',{message:e.message||'',filename:e.filename||'',lineno:e.lineno||0,colno:e.colno||0,stack:String(e.error&&e.error.stack||'')});
  });
  window.addEventListener('unhandledrejection',e=>{
    const reason=e.reason;
    const text=String(reason&&reason.stack||reason||'');
    push('page-unhandledrejection',{reason:text});
  });
  window.addEventListener('pagehide',e=>push('pagehide',{persisted:!!e.persisted,visibility:document.visibilityState}));
  document.addEventListener('visibilitychange',()=>push('visibilitychange',{visibility:document.visibilityState}));
  function depthState(){
    try{
      if(typeof S==='undefined'||!S||!S.depthAI)return null;
      const d=S.depthAI;
      return {
        lastError:d.lastError||null,
        lastSmoke:d.lastSmoke||null,
        wasmPaths:d.wasmPaths||null,
        modelIntegrity:d.modelIntegrity||null,
        lastWorkerDebug:d.lastWorkerDebug||null,
        v11Progress:Array.isArray(d.v11Progress)?d.v11Progress.slice(-220):[],
        v11LastProgressAt:Number.isFinite(d.v11LastProgressAt)?d.v11LastProgressAt:null,
        forceWasm:!!d.forceWasm,
        alignment:Array.isArray(d.alignment)?d.alignment.slice(-8):null,
        pendingCount:d.pending&&typeof d.pending.size==='number'?d.pending.size:null
      };
    }catch(e){return {snapshotError:String(e&&e.stack||e)}}
  }
  function resources(){
    try{return performance.getEntriesByType('resource').filter(r=>RX.test(r.name)).slice(-80).map(r=>({name:r.name,initiatorType:r.initiatorType,duration_ms:Math.round(r.duration*10)/10,transferSize:r.transferSize||0,encodedBodySize:r.encodedBodySize||0,decodedBodySize:r.decodedBodySize||0}))}catch(_){return []}
  }
  let pageGpuProbe=null,selfTestResult=null,selfTestRunning=false;
  function safeObj(x){try{return JSON.parse(JSON.stringify(x))}catch(_){return {text:String(x)}}}
  async function probePageWebGPU(){
    const t0=performance.now(),r={available:!!navigator.gpu,secureContext:!!window.isSecureContext};
    const timeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timeout '+ms+'ms')),ms))]);
    if(!navigator.gpu){r.result='navigator.gpu-unavailable';r.elapsed_ms=Math.round((performance.now()-t0)*10)/10;return r}
    try{const a0=performance.now(),a=await timeout(navigator.gpu.requestAdapter({powerPreference:'high-performance'}),2500,'page.requestAdapter');r.adapterElapsed_ms=Math.round((performance.now()-a0)*10)/10;if(!a){r.result='adapter-null';return r}let info=null;try{info=a.info?safeObj(a.info):(typeof a.requestAdapterInfo==='function'?safeObj(await timeout(a.requestAdapterInfo(),1200,'page.requestAdapterInfo')):null)}catch(e){info={error:String(e&&e.stack||e)}}let features=[];try{features=Array.from(a.features||[]).sort()}catch(_){}const limits={},keys=['maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupStorageSize','maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupsPerDimension'];try{for(const k of keys)if(a.limits&&k in a.limits)limits[k]=Number(a.limits[k])}catch(_){}r.adapter={info,features,limits};r.result='adapter-ok';try{const d0=performance.now(),d=await timeout(a.requestDevice(),2200,'page.requestDevice');r.device='ok';r.deviceElapsed_ms=Math.round((performance.now()-d0)*10)/10;try{d.destroy()}catch(_){}}catch(e){r.device='failed';r.deviceError=String(e&&e.stack||e)}}catch(e){r.result=/timeout/i.test(String(e&&e.message||e))?'probe-timeout':'probe-exception';r.error=String(e&&e.stack||e)}r.elapsed_ms=Math.round((performance.now()-t0)*10)/10;return r;
  }

  function makeSample(name,w=160,h=120){const a=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;let r=0,g=0,b=0;if(name==='gradient'){r=Math.round(255*x/(w-1));g=Math.round(255*y/(h-1));b=Math.round(255*(1-x/(w-1)))}else if(name==='checker'){const q=((x>>4)+(y>>4))&1;r=g=b=q?225:35}else{const horizon=Math.floor(h*.46),floor=y>=horizon,side=Math.min(x,w-1-x)/(w*.5);if(floor){const v=Math.max(0,Math.min(255,55+150*(y-horizon)/(h-horizon)));r=v;g=Math.round(v*.92);b=Math.round(v*.78)}else{const v=Math.round(85+100*side);r=Math.round(v*.92);g=v;b=Math.min(255,v+15)}if(x>w*.34&&x<w*.66&&y>h*.43&&y<h*.78){r=65;g=82;b=104}}a[i]=r;a[i+1]=g;a[i+2]=b;a[i+3]=255}return {name,width:w,height:h,rgba:a.buffer}}
  function depthStats(buf){const a=new Float32Array(buf);let n=0,min=Infinity,max=-Infinity,sum=0;for(const v of a)if(Number.isFinite(v)){n++;if(v<min)min=v;if(v>max)max=v;sum+=v}return {count:a.length,finite:n,finiteRatio:a.length?n/a.length:0,min:n?min:null,max:n?max:null,mean:n?sum/n:null,nonConstant:n?max-min>1e-7:false}}
  async function testProvider(forceWasm,label){const events=[],pending=new Map();let seq=0;const W=new Worker('./depth_ai_worker_v11_d14.js?v11d14q='+Date.now());W.addEventListener('message',e=>{const m=e.data||{};if(m.__depthDiagV11){events.push({at:new Date().toISOString(),diag:m.progress||m.debug||m});if(events.length>280)events.shift();return}const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.ok?p.resolve(m):p.reject(Object.assign(new Error(m.error||'worker error'),{reply:m}))}});const call=(msg,timeoutMs)=>new Promise((resolve,reject)=>{const id='v11self-'+label+'-'+(++seq),timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(new Error('TIMEOUT '+msg.type+' dopo '+timeoutMs+' ms'),{events:events.slice()}))},timeoutMs);pending.set(id,{resolve,reject,timer});W.postMessage({...msg,id},msg.rgba?[msg.rgba]:[])});const result={label,forceWasm,events,startedAt:new Date().toISOString()};try{const t0=performance.now();result.init=await call({type:'init',inputSize:518,runtimeVersion:'1.23.2',deployRev:'v11-d14',forceWasm,modelLocal:'./depth_anything_v2_small_q4f16.onnx',modelRemote:'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4f16.onnx'},120000);result.initElapsed_ms=Math.round((performance.now()-t0)*10)/10;const s0=performance.now();result.smoke=await call({type:'smoke'},90000);result.smokeElapsed_ms=Math.round((performance.now()-s0)*10)/10;result.images=[];for(const name of ['room','gradient','checker']){const sample=makeSample(name),i0=performance.now(),reply=await call({type:'infer',width:sample.width,height:sample.height,rgba:sample.rgba},90000);result.images.push({name,elapsed_ms:Math.round((performance.now()-i0)*10)/10,depth:depthStats(reply.depth)})}result.ok=true}catch(e){result.ok=false;result.error=String(e&&e.stack||e);if(e&&e.reply)result.reply=e.reply;if(e&&e.events)result.events=e.events}finally{try{W.terminate()}catch(_){}result.finishedAt=new Date().toISOString()}return result}
  async function runSelfTest(){if(selfTestRunning)return;selfTestRunning=true;push('selftest-start',{});updateCompactStatus();const result={schema:'room-scanner-v11-provider-selftest-d14',startedAt:new Date().toISOString()};try{pageGpuProbe=await probePageWebGPU();result.webgpuProbe=pageGpuProbe;push('page-webgpu-probe',pageGpuProbe);if(navigator.gpu){result.webgpu=await testProvider(false,'webgpu-auto');push('selftest-webgpu-finished',{ok:result.webgpu.ok,error:result.webgpu.error||null})}else result.webgpu={ok:false,skipped:true,error:'navigator.gpu non disponibile'};if(!result.webgpu.ok){result.wasm=await testProvider(true,'wasm-forced');push('selftest-wasm-finished',{ok:result.wasm.ok,error:result.wasm.error||null});if(result.wasm.ok&&typeof S!=='undefined'&&S&&S.depthAI){S.depthAI.forceWasm=true;try{sessionStorage.setItem('roomScannerV11D14ForceWasm','1')}catch(_){}result.fallbackApplied=true;push('wasm-fallback-applied',{reason:'WebGPU test failed; WASM test passed'})}}result.ok=!!((result.webgpu&&result.webgpu.ok)||(result.wasm&&result.wasm.ok))}catch(e){result.ok=false;result.error=String(e&&e.stack||e)}result.finishedAt=new Date().toISOString();selfTestResult=result;selfTestRunning=false;push('selftest-finished',{ok:result.ok,fallbackApplied:!!result.fallbackApplied});if(ta){ta.value=text();ta.style.display='block'}updateCompactStatus()}
  function report(){
    return {
      schema:'room-scanner-depthai-debug-v11',
      build:BUILD,
      generatedAt:new Date().toISOString(),
      page:{href:location.href,origin:location.origin,secureContext:!!window.isSecureContext,visibility:document.visibilityState},
      environment:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency||null,deviceMemory:navigator.deviceMemory||null,webgpu:!!navigator.gpu,crossOriginIsolated:!!window.crossOriginIsolated},
      pageWebGPUProbe:pageGpuProbe,
      xrTrace:(()=>{try{return window.__ROOM_SCANNER_D14_XR_REPORT__?window.__ROOM_SCANNER_D14_XR_REPORT__():null}catch(e){return {error:String(e&&e.stack||e)}}})(),
      d14SourcePatch:{depthGate:window.__ROOM_SCANNER_D14_DEPTH_GATE_STATE__||null,depthControl:(()=>{try{return window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__?window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__():null}catch(e){return {error:String(e&&e.stack||e)}}})(),photoGuardCount:window.__ROOM_SCANNER_D14_PHOTO_GUARD_COUNT__||0},
      previousTrace,
      selfTest:selfTestResult,
      depthAI:depthState(),
      pageEvents:pageEvents.slice(),
      resources:resources()
    };
  }
  function text(){return JSON.stringify(report(),null,2)}
  let panel,ta,status,liveTrace,badge;
  function compactEventLine(x){
    const d=x&&x.detail||{};
    let extra='';
    if(d.percent!=null)extra+=' '+Number(d.percent).toFixed(1)+'%';
    if(d.receivedBytes!=null)extra+=' '+(Number(d.receivedBytes)/1048576).toFixed(2)+'MiB';
    if(d.phase)extra+=' phase='+d.phase;
    if(d.error)extra+=' ERR='+String(d.error).slice(0,140);
    return '['+(x.t_ms??'?')+'ms] '+(x.type||x.stage||'?')+extra;
  }
  function updateLiveTrace(){
    if(!liveTrace)return;
    const d=depthState();
    const wp=(d&&Array.isArray(d.v11Progress)?d.v11Progress:[]).slice(-14);
    const pp=pageEvents.slice(-8);
    const lines=['ROOM SCANNER V11-D14  |  '+BUILD];
    try{const xr=window.__ROOM_SCANNER_D14_XR_REPORT__&&window.__ROOM_SCANNER_D14_XR_REPORT__();for(const x of (xr&&xr.events||[]).slice(-8))lines.push('XR '+compactEventLine(x))}catch(_){}
    for(const x of wp)lines.push(compactEventLine(x));
    for(const x of pp)lines.push('PAGE '+compactEventLine(x));
    if(lines.length===1)lines.push('[attesa] nessun evento worker ancora ricevuto');
    liveTrace.textContent=lines.join('\n');
    liveTrace.scrollTop=liveTrace.scrollHeight;
  }
  function updateCompactStatus(){
    if(!status)return;
    const d=depthState();
    const dbg=d&&d.lastWorkerDebug,progress=d&&d.v11Progress||[],last=progress.length?progress[progress.length-1]:null;
    const stage=last&&(last.type||last.reason)||dbg&&dbg.stage||dbg&&dbg.reason||'in attesa';
    const provider=dbg&&dbg.activeProvider||d&&d.lastSmoke&&d.lastSmoke.provider||'?';
    const detail=last&&last.detail||{};
    const modelProgress=stage==='model-download-progress'?(' | modello '+(Number(detail.percent)||0).toFixed(1)+'% · '+((Number(detail.receivedBytes)||0)/1048576).toFixed(1)+' MiB'):'';
    const err=d&&d.lastError,age=d&&Number.isFinite(d.v11LastProgressAt)?Math.max(0,(performance.now()-d.v11LastProgressAt)/1000):null,stall=age!==null&&age>12?(' | STALLO '+age.toFixed(1)+'s'):'';
    status.textContent=selfTestRunning?'SELF-TEST modello + WebGPU→WASM in corso...':err?('ERRORE: '+err+' | '+stage+modelProgress+stall):('stage: '+stage+modelProgress+' | provider: '+provider+stall);
  }
  function ensurePanel(){
    if(panel)return;
    panel=document.createElement('div');
    panel.id='depthV11D14Diag';
    badge=document.getElementById('v11D14StaticBanner');
    panel.style.cssText='position:fixed;z-index:2147483647;left:6px;right:6px;top:38px;max-height:42vh;overflow:auto;background:rgba(7,10,14,.97);color:#eef4fa;border:2px solid #ffcf33;border-radius:8px;padding:7px;font:11px/1.28 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 4px 18px #000b';
    panel.innerHTML='<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap"><b>V11-D14 · LIVE DEPTH TRACE</b><span id="depthV11Status" style="flex:1">bootstrap...</span><span style="opacity:.8">self-test solo con ?depthtest=1</span><button id="depthV11Restart" type="button">RIAVVIA DEPTH</button><button id="depthV11Wasm" type="button">Forza WASM</button><button id="depthV11Copy" type="button">COPIA LOG</button><button id="depthV11Prev" type="button">LOG PRECEDENTE</button><button id="depthV11Toggle" type="button">riduci</button></div><pre id="depthV11Live" style="white-space:pre-wrap;word-break:break-word;background:#020304;color:#d9f2ff;border:1px solid #45515d;border-radius:5px;padding:6px;margin:6px 0 0;min-height:108px;max-height:24vh;overflow:auto">[bootstrap] attendo worker...</pre><textarea id="depthV11Text" spellcheck="false" style="display:none;width:100%;height:30vh;box-sizing:border-box;margin-top:7px;background:#05070a;color:#dbe8f4;border:1px solid #45515d;border-radius:6px;padding:7px"></textarea>';
    document.body.appendChild(panel);
    ta=panel.querySelector('#depthV11Text');
    liveTrace=panel.querySelector('#depthV11Live');
    status=panel.querySelector('#depthV11Status');
    panel.querySelector('#depthV11Restart').onclick=()=>{const fn=window.__ROOM_SCANNER_D14_RESTART_DEPTH__;if(typeof fn!=='function'){push('manual-depth-restart-unavailable',{});status.textContent='Avvia prima la scansione XR, poi RIAVVIA DEPTH';return}status.textContent='Riavvio reale del motore Depth...';Promise.resolve(fn('diagnostic-button')).then(s=>{push('manual-depth-restart-ok',{status:s});status.textContent='Motore Depth READY'}).catch(e=>{push('manual-depth-restart-fail',{error:String(e&&e.stack||e)});status.textContent='Riavvio Depth fallito: '+String(e&&e.message||e)});};
    panel.querySelector('#depthV11Wasm').onclick=()=>{try{sessionStorage.setItem('roomScannerV11D14ForceWasm','1')}catch(_){};try{if(typeof S!=='undefined'&&S&&S.depthAI)S.depthAI.forceWasm=true}catch(_){};push('manual-force-wasm',{applied:true});status.textContent='WASM forzato per la prossima inizializzazione Depth';};
    panel.querySelector('#depthV11Toggle').onclick=()=>{const hidden=liveTrace.style.display!=='none';liveTrace.style.display=hidden?'none':'block';panel.querySelector('#depthV11Toggle').textContent=hidden?'espandi':'riduci'};
    panel.querySelector('#depthV11Prev').onclick=()=>{ta.value=previousTrace?JSON.stringify(previousTrace,null,2):'Nessun log D14 precedente salvato';ta.style.display='block'};
    panel.querySelector('#depthV11Copy').onclick=async()=>{
      const s=text();ta.value=s;ta.style.display='block';push('copy-log',{chars:s.length});
      try{await navigator.clipboard.writeText(s);status.textContent='LOG COPIATO - incollalo nella chat';}
      catch(_){ta.focus();ta.select();try{document.execCommand('copy');status.textContent='LOG COPIATO - incollalo nella chat';}catch(e){status.textContent='Copia automatica fallita: seleziona il testo';}}
    };
    updateCompactStatus();
  }
  function boot(){document.title='Room Scanner V11-D14 · XR + DEPTH READY PHOTO GATE';ensurePanel();push('v11-diagnostics-ready',{build:BUILD,href:location.href});setInterval(()=>{const d=depthState();const age=d&&Number.isFinite(d.v11LastProgressAt)?Math.round(performance.now()-d.v11LastProgressAt):null;push('ui-heartbeat',{visibility:document.visibilityState,lastWorkerAge_ms:age})},3000);const qp=new URLSearchParams(location.search);let force=qp.get('wasm')==='1';try{force=force||sessionStorage.getItem('roomScannerV11D14ForceWasm')==='1'}catch(_){};if(force){try{if(typeof S!=='undefined'&&S&&S.depthAI)S.depthAI.forceWasm=true}catch(_){};push('startup-force-wasm',{query:qp.get('wasm')==='1'})}setInterval(updateCompactStatus,750);if(qp.get('depthtest')==='1')setTimeout(()=>runSelfTest(),700)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();