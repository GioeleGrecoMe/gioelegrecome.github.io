(() => {
  'use strict';

  // V11-D14 SOURCE-PATCH LOADER
  // ---------------------------
  // D12 proved that CFG.depthAIEnabled and v10RenderPhotoReview are lexical bindings
  // inside the V10 application script. An external JS shim cannot reliably modify them.
  // D14 therefore patches the fetched V10 SOURCE TEXT before document.write() executes it.
  // This keeps the deployed V10 file untouched while placing the XR gate in the same
  // lexical scope as CFG and ensureDepthAIWorker.
  const BUILD = 'room-scanner-v11-d14-photoready-loader-2026-08-16';
  const V10_URL = './room_scanner_v10.html';
  const WORKER_URL = './depth_ai_worker_v11_d14.js';
  const XRTRACE_URL = './room_scanner_v11_d14_xrtrace.js?v=d14-photoready-20260816';
  const DIAG_URL = './room_scanner_v11_d14_diag.js?v=d14-photoready-20260816';
  const events = [];

  function safeJson(value) { try { return JSON.stringify(value); } catch (_) { return String(value); } }
  function log(stage, detail = {}) {
    const item = { iso: new Date().toISOString(), t_ms: Math.round(performance.now()), stage, detail };
    events.push(item);
    try { localStorage.setItem('roomScannerV11D14LoaderTrace', JSON.stringify({ build: BUILD, href: location.href, events: events.slice(-180) })); } catch (_) {}
    const live = document.getElementById('v11LoaderLive');
    if (live) live.textContent = 'ROOM SCANNER V11-D14 / LOADER TRACE\n' + events.slice(-42).map(x => `[${x.t_ms}ms] ${x.stage} ${safeJson(x.detail)}`).join('\n');
  }
  function failClosed(error) {
    const message = String(error && error.stack || error);
    log('FAIL-CLOSED', { message });
    const box = document.getElementById('v11LoaderError');
    if (box) {
      box.style.display = 'block';
      box.textContent = 'V11-D14 FERMA IN SICUREZZA\n\n' + message + '\n\n' + JSON.stringify({ build: BUILD, href: location.href, events }, null, 2);
    }
  }
  function replaceExactlyOnce(text, oldText, newText, label) {
    const first = text.indexOf(oldText), last = text.lastIndexOf(oldText);
    if (first < 0 || first !== last) throw new Error(`${label}: anchor atteso una sola volta; first=${first}, last=${last}`);
    return text.slice(0, first) + newText + text.slice(first + oldText.length);
  }
  function injectAfterHeadOpen(html, tag) {
    const m = html.match(/<head\b[^>]*>/i);
    if (!m) throw new Error('Tag head iniziale non trovato');
    return html.replace(m[0], m[0] + tag);
  }

  // Inject code immediately after a named function's opening brace. We intentionally do
  // not parse or rewrite the rest of the function body: the original returns/awaits/errors
  // remain byte-for-byte untouched. This is much less fragile than replacing whole functions.
  function injectFunctionPrologue(html, functionName, prologue, label, requireUnique = true) {
    const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:async\\s+)?function\\s+' + escaped + '\\s*\\([^)]*\\)\\s*\\{', 'g');
    const matches = Array.from(html.matchAll(re));
    if (!matches.length) throw new Error(`${label}: funzione ${functionName} non trovata`);
    if (requireUnique && matches.length !== 1) throw new Error(`${label}: attesa una funzione ${functionName}, trovate ${matches.length}`);

    // Apply from right to left so earlier indexes remain valid if multiple declarations exist.
    let out = html;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const openBrace = m.index + m[0].lastIndexOf('{');
      out = out.slice(0, openBrace + 1) + prologue + out.slice(openBrace + 1);
    }
    return { html: out, count: matches.length };
  }

  // Wrap a named function body while preserving the original body byte-for-byte inside try{}.
  // This is used for the V10 rgb regression: unlike D13's early return, it allows the
  // original photo-review logic to execute and suppresses only the proven ReferenceError.
  function wrapFunctionBodyWithCatch(html, functionName, catchCode, label, requireUnique = false) {
    const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:async\\s+)?function\\s+' + escaped + '\\s*\\([^)]*\\)\\s*\\{', 'g');
    const matches = Array.from(html.matchAll(re));
    if (!matches.length) throw new Error(`${label}: funzione ${functionName} non trovata`);
    if (requireUnique && matches.length !== 1) throw new Error(`${label}: attesa una funzione ${functionName}, trovate ${matches.length}`);

    function findClose(text, open) {
      let depth = 1, quote = null, esc = false, lineComment = false, blockComment = false, regex = false, regexClass = false;
      let prevSig = '{';
      for (let i = open + 1; i < text.length; i++) {
        const c = text[i], n = text[i + 1];
        if (lineComment) { if (c === '\n' || c === '\r') lineComment = false; continue; }
        if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
        if (quote) {
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === quote) quote = null;
          continue;
        }
        if (regex) {
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (regexClass) { if (c === ']') regexClass = false; continue; }
          if (c === '[') { regexClass = true; continue; }
          if (c === '/') { regex = false; while (/[a-z]/i.test(text[i + 1] || '')) i++; }
          continue;
        }
        if (c === '/' && n === '/') { lineComment = true; i++; continue; }
        if (c === '/' && n === '*') { blockComment = true; i++; continue; }
        if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
        if (c === '/') {
          // Conservative regex-literal heuristic. Good enough for the compact V10 functions
          // and prevents quantifier braces such as /x{2}/ from corrupting block matching.
          if (!prevSig || /[=(:,!&|?{};\[\]+*%<>~-]/.test(prevSig)) { regex = true; regexClass = false; continue; }
        }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return i; }
        if (!/\s/.test(c)) prevSig = c;
      }
      return -1;
    }

    const ranges = matches.map(m => {
      const open = m.index + m[0].lastIndexOf('{');
      const close = findClose(html, open);
      if (close < 0) throw new Error(`${label}: chiusura funzione ${functionName} non trovata`);
      return { open, close };
    });
    let out = html;
    for (let i = ranges.length - 1; i >= 0; i--) {
      const { open, close } = ranges[i];
      const body = out.slice(open + 1, close);
      const wrapped = `try{${body}}catch(__roomScannerD14PhotoErr){${catchCode}}`;
      out = out.slice(0, open + 1) + wrapped + out.slice(close);
    }
    return { html: out, count: ranges.length };
  }

  async function attemptFetch(label, url, cache, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(label + ' timeout')), timeoutMs);
    const t0 = performance.now();
    try {
      log('fetch-v10-attempt-start', { label, url, cache, timeoutMs });
      const response = await fetch(url, { cache, credentials: 'same-origin', signal: controller.signal });
      const text = response.ok ? await response.text() : '';
      log('fetch-v10-attempt-result', { label, status: response.status, ok: response.ok, contentType: response.headers.get('content-type'), chars: text.length, elapsed_ms: Math.round(performance.now() - t0) });
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
      if (text.length < 100000) throw new Error(`${label}: V10 troppo piccola (${text.length} caratteri)`);
      return text;
    } finally { clearTimeout(timer); }
  }
  async function fetchV10Resilient() {
    const attempts = [
      { label: 'cached-default', url: V10_URL, cache: 'default', timeout: 6500 },
      { label: 'reload-versioned', url: `${V10_URL}?v11d14_source=${encodeURIComponent(BUILD)}`, cache: 'reload', timeout: 9000 },
      { label: 'network-no-store', url: V10_URL, cache: 'no-store', timeout: 12000 }
    ];
    const errors = [];
    for (const a of attempts) {
      try { return await attemptFetch(a.label, a.url, a.cache, a.timeout); }
      catch (error) {
        const message = String(error && (error.stack || error.message) || error);
        errors.push({ label: a.label, message });
        log('fetch-v10-attempt-failed', { label: a.label, message });
      }
    }
    throw new Error('Tutti i tentativi di caricamento V10 sono falliti: ' + safeJson(errors));
  }

  async function boot() {
    try {
      const qp = new URLSearchParams(location.search);
      const permanentDepthOff = qp.get('depthoff') === '1';
      log('loader-js-executing', { build: BUILD, permanentDepthOff });
      const text = await fetchV10Resilient();
      log('fetch-v10-accepted', { chars: text.length });
      let html = text;

      const workerAnchor = "depthAIWorker:'./depth_ai_worker.js'";
      const runtimeAnchor = "depthAIRuntimeVersion:'1.23.2'";
      const workerCreateAnchor = 'new Worker(versionedLocalAsset(CFG.depthAIWorker))';
      if (!html.includes(runtimeAnchor)) throw new Error(`Anchor runtime mancante: ${runtimeAnchor}`);
      if (!html.includes(workerCreateAnchor)) throw new Error(`Anchor creazione worker mancante: ${workerCreateAnchor}`);
      html = replaceExactlyOnce(html, workerAnchor, "depthAIWorker:'./depth_ai_worker_v11_d14.js'", 'Depth worker URL');
      log('depth-worker-rerouted', { from: './depth_ai_worker.js', to: WORKER_URL });

      if (permanentDepthOff) {
        const enabledAnchor = 'depthAIEnabled:true';
        const occurrences = html.split(enabledAnchor).length - 1;
        if (occurrences === 1) {
          html = replaceExactlyOnce(html, enabledAnchor, 'depthAIEnabled:false', 'Depth AI enabled flag');
          log('depth-off-control-applied', { anchor: enabledAnchor });
        } else throw new Error(`depthoff=1: anchor depthAIEnabled:true non unico (${occurrences})`);
      } else {
        // The code below runs INSIDE v10StartScanWithDepthCheck's lexical scope.
        // It reproduces the successful D11 depthoff=1 startup only for the brief XR-entry phase.
        // requestSession's D14 tracer calls the restore closure after an XR session is created.
        const xrGatePrologue = `
/* D14_SOURCEPATCH_XR_GATE_DEPTH_ENGINE_AND_PHOTO_PREFLIGHT */
/*
 * D14 runs inside the V10 lexical scope. D12/D13 proved that CFG, S and
 * ensureDepthAIWorker are lexical bindings, not reliable window globals.
 *
 * Important semantic separation:
 * - CFG.depthAIEnabled controls the actual Depth/ORT engine path.
 * - The existing UI button "Punti DepthAI: ON/OFF" is left untouched because
 *   it can represent point integration/visibility rather than worker lifetime.
 *
 * D14 therefore provides a separate engine readiness bridge and a photo gate:
 * a manual photo is allowed through only after ensureDepthAIWorker() resolves.
 */
const __roomScannerD14InstallDepthEngine=()=>{
  if(typeof window.__ROOM_SCANNER_D14_ENSURE_DEPTH_READY__==='function')return;

  window.__ROOM_SCANNER_D14_DEPTH_READY__=false;
  window.__ROOM_SCANNER_D14_DEPTH_INIT_PROMISE__=null;
  window.__ROOM_SCANNER_D14_DEPTH_LAST_ERROR__=null;
  window.__ROOM_SCANNER_D14_DEPTH_ENGINE_GENERATION__=0;
  window.__ROOM_SCANNER_D14_PHOTO_GATE_INFLIGHT__=false;
  window.__ROOM_SCANNER_D14_PHOTO_REPLAY__=false;

  const __d14Push=(type,detail)=>{try{window.__DEPTH_V11_D14_PUSH__&&window.__DEPTH_V11_D14_PUSH__(type,detail||{});}catch(_){}};

  const __d14UpdateEngineBadge=()=>{
    try{
      let el=document.getElementById('v11D14DepthEngine');
      if(!el){
        el=document.createElement('button');
        el.id='v11D14DepthEngine';
        el.type='button';
        el.style.cssText='position:fixed;z-index:2147483646;right:8px;bottom:8px;padding:8px 10px;border:1px solid #777;border-radius:9px;background:#111;color:#fff;font:800 11px/1.2 system-ui;box-shadow:0 2px 8px #0008';
        el.title='Stato reale del motore Depth Anything. Tocca per inizializzare/riavviare.';
        el.addEventListener('click',ev=>{
          try{ev.preventDefault();ev.stopPropagation();}catch(_){}
          Promise.resolve(window.__ROOM_SCANNER_D14_ENSURE_DEPTH_READY__('engine-status-button')).catch(()=>{});
        });
        document.body&&document.body.appendChild(el);
      }
      const ready=!!window.__ROOM_SCANNER_D14_DEPTH_READY__;
      const init=!!window.__ROOM_SCANNER_D14_DEPTH_INIT_PROMISE__;
      const err=window.__ROOM_SCANNER_D14_DEPTH_LAST_ERROR__;
      el.textContent=ready?'Motore Depth: READY':(init?'Motore Depth: INIT…':(err?'Motore Depth: ERRORE · riprova':'Motore Depth: non pronto · avvia'));
    }catch(_){}
  };

  window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__=()=>{
    let worker=false,pending=null;
    try{worker=!!(S&&S.depthAI&&S.depthAI.worker);}catch(_){}
    try{pending=S&&S.depthAI&&S.depthAI.pending&&typeof S.depthAI.pending.size==='number'?S.depthAI.pending.size:null;}catch(_){}
    return {
      enabled:!!CFG.depthAIEnabled,
      ready:!!window.__ROOM_SCANNER_D14_DEPTH_READY__,
      initializing:!!window.__ROOM_SCANNER_D14_DEPTH_INIT_PROMISE__,
      worker,pending,
      lastError:window.__ROOM_SCANNER_D14_DEPTH_LAST_ERROR__||null,
      generation:Number(window.__ROOM_SCANNER_D14_DEPTH_ENGINE_GENERATION__||0),
      at:new Date().toISOString()
    };
  };

  window.__ROOM_SCANNER_D14_ENSURE_DEPTH_READY__=async(reason)=>{
    const why=String(reason||'unspecified');
    CFG.depthAIEnabled=true;

    const current=window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__();
    if(current.ready&&current.worker){
      __d14Push('D14 depth-ready-reuse',{reason:why,status:current});
      __d14UpdateEngineBadge();
      return current;
    }

    const existing=window.__ROOM_SCANNER_D14_DEPTH_INIT_PROMISE__;
    if(existing){
      __d14Push('D14 depth-enable-join',{reason:why,status:current});
      return existing;
    }

    const generation=Number(window.__ROOM_SCANNER_D14_DEPTH_ENGINE_GENERATION__||0)+1;
    window.__ROOM_SCANNER_D14_DEPTH_ENGINE_GENERATION__=generation;
    window.__ROOM_SCANNER_D14_DEPTH_READY__=false;
    window.__ROOM_SCANNER_D14_DEPTH_LAST_ERROR__=null;
    __d14Push('D14 depth-enable-start',{reason:why,generation,status:current});

    let promise;
    promise=(async()=>{
      if(typeof ensureDepthAIWorker!=='function')throw new Error('ensureDepthAIWorker non disponibile nello scope V10');
      const worker=await ensureDepthAIWorker();
      if(generation!==Number(window.__ROOM_SCANNER_D14_DEPTH_ENGINE_GENERATION__||0))throw new Error('inizializzazione Depth superata da una generazione piu recente');
      window.__ROOM_SCANNER_D14_DEPTH_READY__=true;
      window.__ROOM_SCANNER_D14_DEPTH_LAST_ERROR__=null;
      const status=window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__();
      __d14Push('D14 depth-enable-ok',{reason:why,generation,workerReturned:!!worker,status});
      return status;
    })().catch(e=>{
      window.__ROOM_SCANNER_D14_DEPTH_READY__=false;
      window.__ROOM_SCANNER_D14_DEPTH_LAST_ERROR__=String(e&&e.stack||e);
      const status=window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__();
      __d14Push('D14 depth-enable-fail',{reason:why,generation,error:window.__ROOM_SCANNER_D14_DEPTH_LAST_ERROR__,status});
      throw e;
    }).finally(()=>{
      if(window.__ROOM_SCANNER_D14_DEPTH_INIT_PROMISE__===promise)window.__ROOM_SCANNER_D14_DEPTH_INIT_PROMISE__=null;
      __d14UpdateEngineBadge();
    });
    window.__ROOM_SCANNER_D14_DEPTH_INIT_PROMISE__=promise;
    __d14UpdateEngineBadge();
    return promise;
  };

  // Explicit recovery without overloading the existing "Punti DepthAI" control.
  window.__ROOM_SCANNER_D14_RESTART_DEPTH__=async(reason)=>{
    const why=String(reason||'manual-restart');
    window.__ROOM_SCANNER_D14_DEPTH_ENGINE_GENERATION__=Number(window.__ROOM_SCANNER_D14_DEPTH_ENGINE_GENERATION__||0)+1;
    window.__ROOM_SCANNER_D14_DEPTH_READY__=false;
    window.__ROOM_SCANNER_D14_DEPTH_LAST_ERROR__=null;
    window.__ROOM_SCANNER_D14_DEPTH_INIT_PROMISE__=null;
    try{
      if(S&&S.depthAI){
        if(S.depthAI.pending&&typeof S.depthAI.pending.forEach==='function'){
          S.depthAI.pending.forEach((entry)=>{try{entry&&entry.reject&&entry.reject(new Error('DepthAI riavviata da D14'));}catch(_){}});
          try{S.depthAI.pending.clear();}catch(_){}
        }
        if(S.depthAI.worker&&typeof S.depthAI.worker.terminate==='function'){try{S.depthAI.worker.terminate();}catch(_){} }
        S.depthAI.worker=null;
      }
    }catch(e){__d14Push('D14 depth-restart-cleanup-error',{reason:why,error:String(e&&e.stack||e)});}
    __d14Push('D14 depth-restart',{reason:why});
    __d14UpdateEngineBadge();
    return window.__ROOM_SCANNER_D14_ENSURE_DEPTH_READY__(why);
  };

  if(!window.__ROOM_SCANNER_D14_PHOTO_HOOK_INSTALLED__){
    window.__ROOM_SCANNER_D14_PHOTO_HOOK_INSTALLED__=true;
    document.addEventListener('click',ev=>{
      let button=ev&&ev.target;
      try{if(button&&button.closest)button=button.closest('button');}catch(_){}
      if(!button)return;

      const label=String(button.textContent||'').replace(/\\s+/g,' ').trim();
      const isPhoto=(button.id==='v10Save')||/^\\+\\s*Foto\\b/i.test(label);
      if(!isPhoto){
        // Observe the existing Punti DepthAI control but never change its semantics.
        if(/Punti\\s+DepthAI/i.test(label)){
          __d14Push('D14 points-toggle-observed',{label,engine:window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__()});
          setTimeout(()=>{try{__d14Push('D14 points-toggle-after',{label:String(button.textContent||'').replace(/\\s+/g,' ').trim(),engine:window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__()});}catch(_){}},0);
        }
        return;
      }

      if(window.__ROOM_SCANNER_D14_PHOTO_REPLAY__){
        window.__ROOM_SCANNER_D14_PHOTO_REPLAY__=false;
        __d14Push('D14 photo-replay-pass',{label,status:window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__()});
        return;
      }

      const status=window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__();
      if(status.ready&&status.worker){
        __d14Push('D14 photo-depth-ready-pass',{label,status});
        return;
      }

      // The old V10 click must not create a permanently "calcola la mappa" photo
      // while the model/session is still initializing. Delay the click, not the data.
      try{ev.preventDefault();ev.stopImmediatePropagation();}catch(_){}
      if(window.__ROOM_SCANNER_D14_PHOTO_GATE_INFLIGHT__){
        __d14Push('D14 photo-preflight-duplicate-blocked',{label,status});
        return;
      }
      window.__ROOM_SCANNER_D14_PHOTO_GATE_INFLIGHT__=true;
      const oldText=button.textContent;
      const oldDisabled=!!button.disabled;
      try{button.disabled=true;button.textContent='Depth prepara…';}catch(_){}
      __d14Push('D14 photo-preflight-start',{label,status});

      const timeoutMs=45000;
      let timer=null;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timeout inizializzazione Depth prima della foto ('+timeoutMs+' ms)')),timeoutMs);});
      Promise.race([window.__ROOM_SCANNER_D14_ENSURE_DEPTH_READY__('photo-preflight'),timeout]).then(readyStatus=>{
        if(timer)clearTimeout(timer);
        __d14Push('D14 photo-preflight-ok',{status:readyStatus});
        try{button.disabled=oldDisabled;button.textContent=oldText;}catch(_){}
        window.__ROOM_SCANNER_D14_PHOTO_GATE_INFLIGHT__=false;
        window.__ROOM_SCANNER_D14_PHOTO_REPLAY__=true;
        setTimeout(()=>{
          try{button.click();__d14Push('D14 photo-replay-dispatched',{status:window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__()});}
          catch(e){window.__ROOM_SCANNER_D14_PHOTO_REPLAY__=false;__d14Push('D14 photo-replay-failed',{error:String(e&&e.stack||e)});}
        },0);
      }).catch(e=>{
        if(timer)clearTimeout(timer);
        window.__ROOM_SCANNER_D14_PHOTO_GATE_INFLIGHT__=false;
        try{button.disabled=oldDisabled;button.textContent=oldText;}catch(_){}
        __d14Push('D14 photo-preflight-fail',{error:String(e&&e.stack||e),status:window.__ROOM_SCANNER_D14_GET_DEPTH_STATUS__()});
        // Do not create another misleading "Depth calcola..." photo when the engine
        // is not ready. The user can retry after tapping the separate engine badge.
      });
    },true);
  }
  __d14UpdateEngineBadge();
};
__roomScannerD14InstallDepthEngine();

const __roomScannerD14PrevDepthEnabled=!!CFG.depthAIEnabled;
if(__roomScannerD14PrevDepthEnabled){
  // Same XR-first gate that made D13 stable: no ORT/model wait before requestSession.
  CFG.depthAIEnabled=false;
  window.__ROOM_SCANNER_D14_DEPTH_READY__=false;
  let __roomScannerD14DepthRestored=false;
  const __roomScannerD14RestoreDepth=(reason)=>{
    if(__roomScannerD14DepthRestored)return;
    __roomScannerD14DepthRestored=true;
    CFG.depthAIEnabled=true;
    try{window.__ROOM_SCANNER_D14_DEPTH_GATE_STATE__={active:false,restored:true,reason:String(reason||''),restoredAt:new Date().toISOString()};}catch(_){}
    try{window.__DEPTH_V11_D14_PUSH__&&window.__DEPTH_V11_D14_PUSH__('D14 xr-gate-depth-restore-start',{reason:String(reason||'')});}catch(_){}
    const fn=window.__ROOM_SCANNER_D14_ENSURE_DEPTH_READY__;
    if(typeof fn==='function'){
      Promise.resolve(fn('xr-gate-auto-restore')).then(status=>{
        try{window.__DEPTH_V11_D14_PUSH__&&window.__DEPTH_V11_D14_PUSH__('D14 xr-gate-depth-restored',{reason:String(reason||''),status});}catch(_){}
      }).catch(e=>{try{window.__DEPTH_V11_D14_PUSH__&&window.__DEPTH_V11_D14_PUSH__('D14 post-xr-depth-worker-error',{error:String(e&&e.stack||e)});}catch(_){} });
    }
  };
  try{window.__ROOM_SCANNER_D14_DEPTH_GATE_STATE__={active:true,restored:false,enteredAt:new Date().toISOString(),previousDepthEnabled:true};}catch(_){}
  try{window.__DEPTH_V11_D14_PUSH__&&window.__DEPTH_V11_D14_PUSH__('D14 xr-gate-enter',{activation:navigator.userActivation?{isActive:!!navigator.userActivation.isActive,hasBeenActive:!!navigator.userActivation.hasBeenActive}:null});}catch(_){}
  window.__ROOM_SCANNER_D14_RESTORE_DEPTH__=(reason)=>{
    const delay=Number(window.__ROOM_SCANNER_D14_DEPTH_DELAY_MS__);
    const delayMs=Number.isFinite(delay)?Math.max(0,delay):3000;
    try{window.__DEPTH_V11_D14_PUSH__&&window.__DEPTH_V11_D14_PUSH__('D14 xr-gate-restore-scheduled',{reason:String(reason||''),delayMs});}catch(_){}
    setTimeout(()=>__roomScannerD14RestoreDepth(reason||'xr-session-created'),delayMs);
  };
  const __roomScannerD14Failsafe=Number(window.__ROOM_SCANNER_D14_GATE_FAILSAFE_MS__);
  setTimeout(()=>__roomScannerD14RestoreDepth('failsafe-no-xr-session'),Number.isFinite(__roomScannerD14Failsafe)?Math.max(1000,__roomScannerD14Failsafe):12000);
}
`
        const patchedStart = injectFunctionPrologue(html, 'v10StartScanWithDepthCheck', xrGatePrologue, 'XR-first source patch', true);
        html = patchedStart.html;
        log('sourcepatch-xr-gate-installed', { function: 'v10StartScanWithDepthCheck', count: patchedStart.count });
      }

      const transientDisabledText = 'Depth Anything non pronta: disabled. Avvio comunque WebXR; le foto mostreranno il motivo e potranno essere ricalcolate.';
      if (html.includes(transientDisabledText)) { html = html.split(transientDisabledText).join('Depth temporaneamente sospesa per ingresso WebXR; riattivazione automatica dopo apertura AR.'); log('temporary-depth-disabled-message-rewritten', {}); }

      // V10 currently throws `ReferenceError: rgb is not defined` from v10RenderPhotoReview.
      // D13 returned at function entry, which avoided the crash but could skip useful photo/Depth
      // work. D14 preserves the entire original body and suppresses ONLY this proven regression.
      const photoCatchCode = `if(__roomScannerD14PhotoErr&&__roomScannerD14PhotoErr.name==='ReferenceError'&&/rgb is not defined/i.test(String(__roomScannerD14PhotoErr.message||__roomScannerD14PhotoErr))){try{window.__ROOM_SCANNER_D14_PHOTO_GUARD_COUNT__=(window.__ROOM_SCANNER_D14_PHOTO_GUARD_COUNT__||0)+1;window.__DEPTH_V11_D14_PUSH__&&window.__DEPTH_V11_D14_PUSH__('D14 photo-review-rgb-error-suppressed',{count:window.__ROOM_SCANNER_D14_PHOTO_GUARD_COUNT__,error:String(__roomScannerD14PhotoErr&&__roomScannerD14PhotoErr.stack||__roomScannerD14PhotoErr)});}catch(_){}return;}throw __roomScannerD14PhotoErr;`;
      const patchedPhoto = wrapFunctionBodyWithCatch(html, 'v10RenderPhotoReview', photoCatchCode, 'Photo review rgb-only guard', false);
      html = patchedPhoto.html;
      log('sourcepatch-photo-review-rgb-catch-installed', { function: 'v10RenderPhotoReview', count: patchedPhoto.count });

      const oldVisibleLabel = 'ROOM SCANNER V10.0.8 · DEPTH VERIFIED + RAW';
      if (html.includes(oldVisibleLabel)) html = html.replace(oldVisibleLabel, permanentDepthOff ? 'ROOM SCANNER V11-D14 · XR TRACE · DEPTH OFF CONTROL' : 'ROOM SCANNER V11-D14 · XR + DEPTH READY + PHOTO GATE');

      const msgOld = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{},p=S.depthAI.pending.get(m.id);';
      const msgNew = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{};if(m.__depthDiagV11){S.depthAI.v11Progress=S.depthAI.v11Progress||[];const q=m.progress||m.debug||m;S.depthAI.v11Progress.push(q);if(S.depthAI.v11Progress.length>360)S.depthAI.v11Progress.splice(0,S.depthAI.v11Progress.length-360);S.depthAI.v11LastProgressAt=performance.now();try{window.__DEPTH_V11_D14_PUSH__&&window.__DEPTH_V11_D14_PUSH__(q.type||q.reason||"worker-diag",q.detail||q)}catch(_){}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;return}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;const p=S.depthAI.pending.get(m.id);';
      if (html.includes(msgOld)) html = replaceExactlyOnce(html, msgOld, msgNew, 'Depth worker diagnostic bridge');
      else if (!html.includes('S.depthAI.v11Progress')) throw new Error('Handler DepthAI V10 non riconosciuto');

      // Preload XR lifecycle tracer before any V10 requestSession call.
      const xrTag = `<script src="${XRTRACE_URL}"><` + '/script>';
      html = injectAfterHeadOpen(html, xrTag);
      log('xr-preload-injected', { src: XRTRACE_URL });

      const bodyMatch = html.match(/<body\b[^>]*>/i);
      if (!bodyMatch) throw new Error('Tag body iniziale non trovato');
      const modeLabel = permanentDepthOff ? 'DEPTH OFF CONTROL' : 'XR + DEPTH READY + PHOTO GATE';
      const banner = `<div id="v11D14StaticBanner" style="position:fixed;z-index:2147483647;top:0;left:0;right:0;background:#ffcf33;color:#111;padding:8px 10px;font:900 14px/1.2 system-ui,-apple-system,sans-serif;text-align:center;box-shadow:0 2px 8px #0008">ROOM SCANNER V11-D14 • ${modeLabel} • PHOTO READY GATE • BUILD 2026-08-16</div>`;
      html = html.replace(bodyMatch[0], bodyMatch[0] + banner);

      const bodyEndIndex = html.toLowerCase().lastIndexOf('</body>');
      if (bodyEndIndex < 0) throw new Error('Tag body finale non trovato');
      const diagTag = `<script src="${DIAG_URL}"><` + '/script>';
      html = html.slice(0, bodyEndIndex) + diagTag + html.slice(bodyEndIndex);
      log('external-diagnostics-script-injected', { src: DIAG_URL });

      if (!html.includes("depthAIWorker:'./depth_ai_worker_v11_d14.js'")) throw new Error('Worker D14 non presente dopo trasformazione');
      if (!permanentDepthOff && !html.includes('D14_SOURCEPATCH_XR_GATE_DEPTH_ENGINE_AND_PHOTO_PREFLIGHT')) throw new Error('Source patch XR gate D14 non presente');
      if (!html.includes('D14 photo-review-rgb-error-suppressed')) throw new Error('Source catch photo D14 non presente');
      if (!html.includes('room_scanner_v11_d14_xrtrace.js')) throw new Error('XR trace D14 non presente');
      if (!html.includes('room_scanner_v11_d14_diag.js')) throw new Error('Diagnostica D14 non presente');

      log('document-rewrite-start', { outputChars: html.length, permanentDepthOff });
      document.open(); document.write(html); document.close();
    } catch (error) { failClosed(error); }
  }

  log('external-loader-file-loaded', { src: document.currentScript && document.currentScript.src });
  boot();
})();
