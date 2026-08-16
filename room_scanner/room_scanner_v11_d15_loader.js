(() => {
  'use strict';

  // V11-D15 SOURCE-PATCH LOADER
  // ---------------------------
  // D12 proved that CFG.depthAIEnabled and v10RenderPhotoReview are lexical bindings
  // inside the V10 application script. An external JS shim cannot reliably modify them.
  // D15 therefore patches the fetched V10 SOURCE TEXT before document.write() executes it.
  // This keeps the deployed V10 file untouched while placing the XR gate in the same
  // lexical scope as CFG and ensureDepthAIWorker.
  const BUILD = 'room-scanner-v11-d15-reviewmodel-loader-2026-08-16';
  const V10_URL = './room_scanner_v10.html';
  const WORKER_URL = './depth_ai_worker_v11_d15.js';
  const XRTRACE_URL = './room_scanner_v11_d15_xrtrace.js?v=d15-reviewmodel-20260816';
  const DIAG_URL = './room_scanner_v11_d15_diag.js?v=d15-reviewmodel-20260816';
  const events = [];

  function safeJson(value) { try { return JSON.stringify(value); } catch (_) { return String(value); } }
  function log(stage, detail = {}) {
    const item = { iso: new Date().toISOString(), t_ms: Math.round(performance.now()), stage, detail };
    events.push(item);
    try { localStorage.setItem('roomScannerV11D15LoaderTrace', JSON.stringify({ build: BUILD, href: location.href, events: events.slice(-180) })); } catch (_) {}
    const live = document.getElementById('v11LoaderLive');
    if (live) live.textContent = 'ROOM SCANNER V11-D15 / LOADER TRACE\n' + events.slice(-42).map(x => `[${x.t_ms}ms] ${x.stage} ${safeJson(x.detail)}`).join('\n');
  }
  function failClosed(error) {
    const message = String(error && error.stack || error);
    log('FAIL-CLOSED', { message });
    const box = document.getElementById('v11LoaderError');
    if (box) {
      box.style.display = 'block';
      box.textContent = 'V11-D15 FERMA IN SICUREZZA\n\n' + message + '\n\n' + JSON.stringify({ build: BUILD, href: location.href, events }, null, 2);
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
  function wrapFunctionBodyWithCatch(html, functionName, prelude, catchCode, label, requireUnique = false) {
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
      const wrapped = `${prelude || ''}try{${body}}catch(__roomScannerD15PhotoErr){${catchCode}}`;
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
      { label: 'reload-versioned', url: `${V10_URL}?v11d15_source=${encodeURIComponent(BUILD)}`, cache: 'reload', timeout: 9000 },
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
      html = replaceExactlyOnce(html, workerAnchor, "depthAIWorker:'./depth_ai_worker_v11_d15.js'", 'Depth worker URL');
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
        // requestSession's D15 tracer calls the restore closure after an XR session is created.
        const xrGatePrologue = `
/* D15_SOURCEPATCH_XR_GATE_DEPTH_ENGINE_AND_PHOTO_PREFLIGHT */
/*
 * D15 runs inside the V10 lexical scope. D12/D13 proved that CFG, S and
 * ensureDepthAIWorker are lexical bindings, not reliable window globals.
 *
 * Important semantic separation:
 * - CFG.depthAIEnabled controls the actual Depth/ORT engine path.
 * - The existing UI button "Punti DepthAI: ON/OFF" is left untouched because
 *   it can represent point integration/visibility rather than worker lifetime.
 *
 * D15 therefore provides a separate engine readiness bridge and a photo gate:
 * a manual photo is allowed through only after ensureDepthAIWorker() resolves.
 */
const __roomScannerD15InstallDepthEngine=()=>{
  if(typeof window.__ROOM_SCANNER_D15_ENSURE_DEPTH_READY__==='function')return;

  window.__ROOM_SCANNER_D15_DEPTH_READY__=false;
  window.__ROOM_SCANNER_D15_DEPTH_INIT_PROMISE__=null;
  window.__ROOM_SCANNER_D15_DEPTH_LAST_ERROR__=null;
  window.__ROOM_SCANNER_D15_DEPTH_ENGINE_GENERATION__=0;
  window.__ROOM_SCANNER_D15_PHOTO_GATE_INFLIGHT__=false;
  window.__ROOM_SCANNER_D15_PHOTO_REPLAY__=false;
  window.__ROOM_SCANNER_D15_MODEL_GATE_INFLIGHT__=false;
  window.__ROOM_SCANNER_D15_MODEL_REPLAY__=false;

  const __d15Push=(type,detail)=>{try{window.__DEPTH_V11_D15_PUSH__&&window.__DEPTH_V11_D15_PUSH__(type,detail||{});}catch(_){}};

  const __d15UpdateEngineBadge=()=>{
    try{
      let el=document.getElementById('v11D15DepthEngine');
      if(!el){
        el=document.createElement('button');
        el.id='v11D15DepthEngine';
        el.type='button';
        el.style.cssText='position:fixed;z-index:2147483646;right:8px;bottom:8px;padding:8px 10px;border:1px solid #777;border-radius:9px;background:#111;color:#fff;font:800 11px/1.2 system-ui;box-shadow:0 2px 8px #0008';
        el.title='Stato reale del motore Depth Anything. Tocca per inizializzare/riavviare.';
        el.addEventListener('click',ev=>{
          try{ev.preventDefault();ev.stopPropagation();}catch(_){}
          Promise.resolve(window.__ROOM_SCANNER_D15_ENSURE_DEPTH_READY__('engine-status-button')).catch(()=>{});
        });
        document.body&&document.body.appendChild(el);
      }
      const ready=!!window.__ROOM_SCANNER_D15_DEPTH_READY__;
      const init=!!window.__ROOM_SCANNER_D15_DEPTH_INIT_PROMISE__;
      const err=window.__ROOM_SCANNER_D15_DEPTH_LAST_ERROR__;
      el.textContent=ready?'Motore Depth: READY':(init?'Motore Depth: INIT…':(err?'Motore Depth: ERRORE · riprova':'Motore Depth: non pronto · avvia'));
    }catch(_){}
  };

  window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__=()=>{
    let worker=false,pending=null;
    try{worker=!!(S&&S.depthAI&&S.depthAI.worker);}catch(_){}
    try{pending=S&&S.depthAI&&S.depthAI.pending&&typeof S.depthAI.pending.size==='number'?S.depthAI.pending.size:null;}catch(_){}
    return {
      enabled:!!CFG.depthAIEnabled,
      ready:!!window.__ROOM_SCANNER_D15_DEPTH_READY__,
      initializing:!!window.__ROOM_SCANNER_D15_DEPTH_INIT_PROMISE__,
      worker,pending,
      lastError:window.__ROOM_SCANNER_D15_DEPTH_LAST_ERROR__||null,
      generation:Number(window.__ROOM_SCANNER_D15_DEPTH_ENGINE_GENERATION__||0),
      at:new Date().toISOString()
    };
  };

  window.__ROOM_SCANNER_D15_ENSURE_DEPTH_READY__=async(reason)=>{
    const why=String(reason||'unspecified');
    CFG.depthAIEnabled=true;

    const current=window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__();
    if(current.ready&&current.worker){
      __d15Push('D15 depth-ready-reuse',{reason:why,status:current});
      __d15UpdateEngineBadge();
      return current;
    }

    const existing=window.__ROOM_SCANNER_D15_DEPTH_INIT_PROMISE__;
    if(existing){
      __d15Push('D15 depth-enable-join',{reason:why,status:current});
      return existing;
    }

    const generation=Number(window.__ROOM_SCANNER_D15_DEPTH_ENGINE_GENERATION__||0)+1;
    window.__ROOM_SCANNER_D15_DEPTH_ENGINE_GENERATION__=generation;
    window.__ROOM_SCANNER_D15_DEPTH_READY__=false;
    window.__ROOM_SCANNER_D15_DEPTH_LAST_ERROR__=null;
    __d15Push('D15 depth-enable-start',{reason:why,generation,status:current});

    let promise;
    promise=(async()=>{
      if(typeof ensureDepthAIWorker!=='function')throw new Error('ensureDepthAIWorker non disponibile nello scope V10');
      const worker=await ensureDepthAIWorker();
      if(generation!==Number(window.__ROOM_SCANNER_D15_DEPTH_ENGINE_GENERATION__||0))throw new Error('inizializzazione Depth superata da una generazione piu recente');
      window.__ROOM_SCANNER_D15_DEPTH_READY__=true;
      window.__ROOM_SCANNER_D15_DEPTH_LAST_ERROR__=null;
      const status=window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__();
      __d15Push('D15 depth-enable-ok',{reason:why,generation,workerReturned:!!worker,status});
      return status;
    })().catch(e=>{
      window.__ROOM_SCANNER_D15_DEPTH_READY__=false;
      window.__ROOM_SCANNER_D15_DEPTH_LAST_ERROR__=String(e&&e.stack||e);
      const status=window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__();
      __d15Push('D15 depth-enable-fail',{reason:why,generation,error:window.__ROOM_SCANNER_D15_DEPTH_LAST_ERROR__,status});
      throw e;
    }).finally(()=>{
      if(window.__ROOM_SCANNER_D15_DEPTH_INIT_PROMISE__===promise)window.__ROOM_SCANNER_D15_DEPTH_INIT_PROMISE__=null;
      __d15UpdateEngineBadge();
    });
    window.__ROOM_SCANNER_D15_DEPTH_INIT_PROMISE__=promise;
    __d15UpdateEngineBadge();
    return promise;
  };

  // Explicit recovery without overloading the existing "Punti DepthAI" control.
  window.__ROOM_SCANNER_D15_RESTART_DEPTH__=async(reason)=>{
    const why=String(reason||'manual-restart');
    window.__ROOM_SCANNER_D15_DEPTH_ENGINE_GENERATION__=Number(window.__ROOM_SCANNER_D15_DEPTH_ENGINE_GENERATION__||0)+1;
    window.__ROOM_SCANNER_D15_DEPTH_READY__=false;
    window.__ROOM_SCANNER_D15_DEPTH_LAST_ERROR__=null;
    window.__ROOM_SCANNER_D15_DEPTH_INIT_PROMISE__=null;
    try{
      if(S&&S.depthAI){
        if(S.depthAI.pending&&typeof S.depthAI.pending.forEach==='function'){
          S.depthAI.pending.forEach((entry)=>{try{entry&&entry.reject&&entry.reject(new Error('DepthAI riavviata da D15'));}catch(_){}});
          try{S.depthAI.pending.clear();}catch(_){}
        }
        if(S.depthAI.worker&&typeof S.depthAI.worker.terminate==='function'){try{S.depthAI.worker.terminate();}catch(_){} }
        S.depthAI.worker=null;
      }
    }catch(e){__d15Push('D15 depth-restart-cleanup-error',{reason:why,error:String(e&&e.stack||e)});}
    __d15Push('D15 depth-restart',{reason:why});
    __d15UpdateEngineBadge();
    return window.__ROOM_SCANNER_D15_ENSURE_DEPTH_READY__(why);
  };

  if(!window.__ROOM_SCANNER_D15_PHOTO_HOOK_INSTALLED__){
    window.__ROOM_SCANNER_D15_PHOTO_HOOK_INSTALLED__=true;
    document.addEventListener('click',ev=>{
      let button=ev&&ev.target;
      try{if(button&&button.closest)button=button.closest('button');}catch(_){}
      if(!button)return;

      const label=String(button.textContent||'').replace(/\\s+/g,' ').trim();
      const isPhoto=(button.id==='v10Save')||/^\\+\\s*Foto\\b/i.test(label);
      const isModelBuild=(button.id==='v10ModelBuild')||/Elabora\\s+e\\s+apri\\s+modello/i.test(label);

      // D15 MODEL GATE: wait for the real Depth engine and its command queue before
      // starting V10 model processing. This prevents the model stage from being entered
      // while a manual-photo inference is still in flight.
      if(isModelBuild){
        if(window.__ROOM_SCANNER_D15_MODEL_REPLAY__){
          window.__ROOM_SCANNER_D15_MODEL_REPLAY__=false;
          __d15Push('D15 model-replay-pass',{label,status:window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__()});
          return;
        }
        try{ev.preventDefault();ev.stopImmediatePropagation();}catch(_){}
        if(window.__ROOM_SCANNER_D15_MODEL_GATE_INFLIGHT__){__d15Push('D15 model-gate-duplicate-blocked',{label});return;}
        window.__ROOM_SCANNER_D15_MODEL_GATE_INFLIGHT__=true;
        const oldText=button.textContent,oldDisabled=!!button.disabled;
        try{button.disabled=true;button.textContent='Preparo modello…';}catch(_){}
        __d15Push('D15 model-gate-start',{label,status:window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__()});
        const waitDrain=async()=>{
          await window.__ROOM_SCANNER_D15_ENSURE_DEPTH_READY__('model-preflight');
          const t0=performance.now(),timeoutMs=45000;
          while(true){
            let pending=0;try{pending=S&&S.depthAI&&S.depthAI.pending&&typeof S.depthAI.pending.size==='number'?S.depthAI.pending.size:0;}catch(_){}
            const photoBusy=!!window.__ROOM_SCANNER_D15_PHOTO_GATE_INFLIGHT__;
            if(!pending&&!photoBusy)return {pending,photoBusy,elapsed_ms:Math.round(performance.now()-t0)};
            if(performance.now()-t0>timeoutMs)throw new Error('Timeout coda Depth prima del modello: pending='+pending+', photoBusy='+photoBusy);
            await new Promise(r=>setTimeout(r,100));
          }
        };
        Promise.resolve(waitDrain()).then(info=>{
          __d15Push('D15 model-gate-ready',{info,status:window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__()});
          window.__ROOM_SCANNER_D15_MODEL_GATE_INFLIGHT__=false;
          try{button.disabled=oldDisabled;button.textContent=oldText;}catch(_){}
          window.__ROOM_SCANNER_D15_MODEL_REPLAY__=true;
          setTimeout(()=>{try{button.click();__d15Push('D15 model-replay-dispatched',{info});}catch(e){window.__ROOM_SCANNER_D15_MODEL_REPLAY__=false;__d15Push('D15 model-replay-failed',{error:String(e&&e.stack||e)});}},0);
        }).catch(e=>{
          window.__ROOM_SCANNER_D15_MODEL_GATE_INFLIGHT__=false;
          try{button.disabled=oldDisabled;button.textContent=oldText;}catch(_){}
          __d15Push('D15 model-gate-fail',{error:String(e&&e.stack||e),status:window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__()});
        });
        return;
      }

      if(!isPhoto){
        // Observe the existing Punti DepthAI control but never change its semantics.
        if(/Punti\\s+DepthAI/i.test(label)){
          __d15Push('D15 points-toggle-observed',{label,engine:window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__()});
          setTimeout(()=>{try{__d15Push('D15 points-toggle-after',{label:String(button.textContent||'').replace(/\\s+/g,' ').trim(),engine:window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__()});}catch(_){}},0);
        }
        return;
      }

      if(window.__ROOM_SCANNER_D15_PHOTO_REPLAY__){
        window.__ROOM_SCANNER_D15_PHOTO_REPLAY__=false;
        __d15Push('D15 photo-replay-pass',{label,status:window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__()});
        return;
      }

      const status=window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__();
      if(status.ready&&status.worker){
        __d15Push('D15 photo-depth-ready-pass',{label,status});
        return;
      }

      // The old V10 click must not create a permanently "calcola la mappa" photo
      // while the model/session is still initializing. Delay the click, not the data.
      try{ev.preventDefault();ev.stopImmediatePropagation();}catch(_){}
      if(window.__ROOM_SCANNER_D15_PHOTO_GATE_INFLIGHT__){
        __d15Push('D15 photo-preflight-duplicate-blocked',{label,status});
        return;
      }
      window.__ROOM_SCANNER_D15_PHOTO_GATE_INFLIGHT__=true;
      const oldText=button.textContent;
      const oldDisabled=!!button.disabled;
      try{button.disabled=true;button.textContent='Depth prepara…';}catch(_){}
      __d15Push('D15 photo-preflight-start',{label,status});

      const timeoutMs=45000;
      let timer=null;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timeout inizializzazione Depth prima della foto ('+timeoutMs+' ms)')),timeoutMs);});
      Promise.race([window.__ROOM_SCANNER_D15_ENSURE_DEPTH_READY__('photo-preflight'),timeout]).then(readyStatus=>{
        if(timer)clearTimeout(timer);
        __d15Push('D15 photo-preflight-ok',{status:readyStatus});
        try{button.disabled=oldDisabled;button.textContent=oldText;}catch(_){}
        window.__ROOM_SCANNER_D15_PHOTO_GATE_INFLIGHT__=false;
        window.__ROOM_SCANNER_D15_PHOTO_REPLAY__=true;
        setTimeout(()=>{
          try{button.click();__d15Push('D15 photo-replay-dispatched',{status:window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__()});}
          catch(e){window.__ROOM_SCANNER_D15_PHOTO_REPLAY__=false;__d15Push('D15 photo-replay-failed',{error:String(e&&e.stack||e)});}
        },0);
      }).catch(e=>{
        if(timer)clearTimeout(timer);
        window.__ROOM_SCANNER_D15_PHOTO_GATE_INFLIGHT__=false;
        try{button.disabled=oldDisabled;button.textContent=oldText;}catch(_){}
        __d15Push('D15 photo-preflight-fail',{error:String(e&&e.stack||e),status:window.__ROOM_SCANNER_D15_GET_DEPTH_STATUS__()});
        // Do not create another misleading "Depth calcola..." photo when the engine
        // is not ready. The user can retry after tapping the separate engine badge.
      });
    },true);
  }
  __d15UpdateEngineBadge();
};
__roomScannerD15InstallDepthEngine();

const __roomScannerD15PrevDepthEnabled=!!CFG.depthAIEnabled;
if(__roomScannerD15PrevDepthEnabled){
  // Same XR-first gate that made D13 stable: no ORT/model wait before requestSession.
  CFG.depthAIEnabled=false;
  window.__ROOM_SCANNER_D15_DEPTH_READY__=false;
  let __roomScannerD15DepthRestored=false;
  const __roomScannerD15RestoreDepth=(reason)=>{
    if(__roomScannerD15DepthRestored)return;
    __roomScannerD15DepthRestored=true;
    CFG.depthAIEnabled=true;
    try{window.__ROOM_SCANNER_D15_DEPTH_GATE_STATE__={active:false,restored:true,reason:String(reason||''),restoredAt:new Date().toISOString()};}catch(_){}
    try{window.__DEPTH_V11_D15_PUSH__&&window.__DEPTH_V11_D15_PUSH__('D15 xr-gate-depth-restore-start',{reason:String(reason||'')});}catch(_){}
    const fn=window.__ROOM_SCANNER_D15_ENSURE_DEPTH_READY__;
    if(typeof fn==='function'){
      Promise.resolve(fn('xr-gate-auto-restore')).then(status=>{
        try{window.__DEPTH_V11_D15_PUSH__&&window.__DEPTH_V11_D15_PUSH__('D15 xr-gate-depth-restored',{reason:String(reason||''),status});}catch(_){}
      }).catch(e=>{try{window.__DEPTH_V11_D15_PUSH__&&window.__DEPTH_V11_D15_PUSH__('D15 post-xr-depth-worker-error',{error:String(e&&e.stack||e)});}catch(_){} });
    }
  };
  try{window.__ROOM_SCANNER_D15_DEPTH_GATE_STATE__={active:true,restored:false,enteredAt:new Date().toISOString(),previousDepthEnabled:true};}catch(_){}
  try{window.__DEPTH_V11_D15_PUSH__&&window.__DEPTH_V11_D15_PUSH__('D15 xr-gate-enter',{activation:navigator.userActivation?{isActive:!!navigator.userActivation.isActive,hasBeenActive:!!navigator.userActivation.hasBeenActive}:null});}catch(_){}
  window.__ROOM_SCANNER_D15_RESTORE_DEPTH__=(reason)=>{
    const delay=Number(window.__ROOM_SCANNER_D15_DEPTH_DELAY_MS__);
    const delayMs=Number.isFinite(delay)?Math.max(0,delay):3000;
    try{window.__DEPTH_V11_D15_PUSH__&&window.__DEPTH_V11_D15_PUSH__('D15 xr-gate-restore-scheduled',{reason:String(reason||''),delayMs});}catch(_){}
    setTimeout(()=>__roomScannerD15RestoreDepth(reason||'xr-session-created'),delayMs);
  };
  const __roomScannerD15Failsafe=Number(window.__ROOM_SCANNER_D15_GATE_FAILSAFE_MS__);
  setTimeout(()=>__roomScannerD15RestoreDepth('failsafe-no-xr-session'),Number.isFinite(__roomScannerD15Failsafe)?Math.max(1000,__roomScannerD15Failsafe):12000);
}
`
        const patchedStart = injectFunctionPrologue(html, 'v10StartScanWithDepthCheck', xrGatePrologue, 'XR-first source patch', true);
        html = patchedStart.html;
        log('sourcepatch-xr-gate-installed', { function: 'v10StartScanWithDepthCheck', count: patchedStart.count });
      }

      const transientDisabledText = 'Depth Anything non pronta: disabled. Avvio comunque WebXR; le foto mostreranno il motivo e potranno essere ricalcolate.';
      if (html.includes(transientDisabledText)) { html = html.split(transientDisabledText).join('Depth temporaneamente sospesa per ingresso WebXR; riattivazione automatica dopo apertura AR.'); log('temporary-depth-disabled-message-rewritten', {}); }

      // D15 fixes the V10 `rgb is not defined` regression instead of merely hiding it.
      // The V10 RAW export proves that manual photos are retained as 4-channel RGBA bytes
      // associated with a keyframe (width/height). At render time we search the live V10 state
      // for the currently visible manual photo, then expose `rgb` in the exact function scope.
      // This preserves the original renderer, its confirmation controls and all downstream logic.
      const photoFnInfo = (() => {
        const re = /(?:async\s+)?function\s+v10RenderPhotoReview\s*\([^)]*\)\s*\{/g;
        const m = re.exec(html);
        if (!m) throw new Error('Photo review D15: funzione v10RenderPhotoReview non trovata');
        const open = m.index + m[0].lastIndexOf('{');
        let depth=1,quote=null,esc=false,line=false,block=false;
        for(let i=open+1;i<html.length;i++){
          const c=html[i],n=html[i+1];
          if(line){if(c==='\n'||c==='\r')line=false;continue;}
          if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
          if(quote){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===quote)quote=null;continue;}
          if(c==='/'&&n==='/'){line=true;i++;continue;}
          if(c==='/'&&n==='*'){block=true;i++;continue;}
          if(c==='\"'||c==="'"||c==='`'){quote=c;continue;}
          if(c==='{')depth++;else if(c==='}'&&--depth===0)return {body:html.slice(open+1,i)};
        }
        throw new Error('Photo review D15: chiusura funzione non trovata');
      })();
      const photoBody = photoFnInfo.body;
      const rgbMode = /putImageData\s*\(\s*rgb\b/.test(photoBody) || /rgb\.(?:data|width|height)\b/.test(photoBody) ? 'imageData' : 'bytes';
      log('photo-review-rgb-mode-detected', { rgbMode, rgbMentions: (photoBody.match(/\brgb\b/g)||[]).length });
      const photoPrelude = `
/* D15_NATIVE_RGB_REPAIR */
const rgb=(()=>{
  const __mode=${JSON.stringify(rgbMode)};
  const __seen=new WeakSet(),__candidates=[];let __nodes=0;
  const __isBytes=v=>!!v&&(v instanceof Uint8Array||v instanceof Uint8ClampedArray||(typeof ArrayBuffer!=='undefined'&&ArrayBuffer.isView&&ArrayBuffer.isView(v)&&v.BYTES_PER_ELEMENT===1));
  const __push=(bytes,owner,path,score)=>{
    try{
      if(!__isBytes(bytes)||bytes.length<4096)return;
      const kf=owner&&owner.kf&&typeof owner.kf==='object'?owner.kf:null;
      let w=Number(owner&&owner.width||kf&&kf.width||0),h=Number(owner&&owner.height||kf&&kf.height||0);
      if(!(w>0&&h>0&&w*h*4<=bytes.length)){
        const px=Math.floor(bytes.length/4);
        const known=[[384,216],[640,360],[320,240],[518,350],[518,392],[256,192],[192,108]];
        const hit=known.find(x=>x[0]*x[1]===px);if(hit){w=hit[0];h=hit[1];}
      }
      const id=String(owner&&owner.id||owner&&owner.photoId||owner&&owner.frameId||'');
      const created=Number(owner&&owner.createdAt||owner&&owner.t||kf&&kf.t||0);
      __candidates.push({bytes,owner,path:String(path||''),score:Number(score||0),id,created,w,h});
    }catch(_){}
  };
  const __walk=(v,path,depth)=>{
    if(!v||depth>5||__nodes++>900)return;
    if(__isBytes(v)){__push(v,null,path,1);return;}
    if(typeof v!=='object')return;
    if(__seen.has(v))return;__seen.add(v);
    const keys=['rgba','rgb','rgbaBytes','rgbBytes','pixels','pixelData','imageData','data'];
    for(const k of keys){try{const x=v[k];if(__isBytes(x))__push(x,v,path+'.'+k,k==='rgba'||k==='rgbaBytes'?60:(k==='rgb'||k==='rgbBytes'?45:20));else if(x&&typeof ImageData!=='undefined'&&x instanceof ImageData)__push(x.data,v,path+'.'+k,55);}catch(_){}}
    if(depth<5){
      let entries=[];try{entries=Array.isArray(v)?v.map((x,i)=>[i,x]):Object.entries(v);}catch(_){}
      for(const [k,x] of entries){if(k==='worker'||k==='pending'||k==='session'||k==='gl'||k==='canvas')continue;__walk(x,path+'.'+String(k),depth+1);}
    }
  };
  try{__walk(S,'S',0);}catch(_){}
  let visibleId='';try{const txt=String(document.body&&document.body.innerText||'');const ids=txt.match(/manual-[A-Za-z0-9_-]+/g);if(ids&&ids.length)visibleId=ids[ids.length-1];}catch(_){}
  for(const c of __candidates){if(visibleId&&c.id===visibleId)c.score+=500;if(c.w>0&&c.h>0&&c.w*c.h*4===c.bytes.length)c.score+=80;if(/photo|manual/i.test(c.path))c.score+=40;c.score+=Math.min(30,Math.max(0,c.created)/1e6);}
  __candidates.sort((a,b)=>b.score-a.score||b.created-a.created||b.bytes.length-a.bytes.length);
  const c=__candidates[0];
  if(!c){try{window.__DEPTH_V11_D15_PUSH__&&window.__DEPTH_V11_D15_PUSH__('D15 photo-rgb-resolve-failed',{visibleId});}catch(_){}return null;}
  const bytes=c.bytes instanceof Uint8ClampedArray?c.bytes:new Uint8ClampedArray(c.bytes.buffer,c.bytes.byteOffset,c.bytes.byteLength);
  try{bytes.data=bytes;bytes.width=c.w||0;bytes.height=c.h||0;}catch(_){}
  let out=bytes;
  if(__mode==='imageData'&&c.w>0&&c.h>0&&typeof ImageData!=='undefined'){try{out=new ImageData(bytes.slice(0,c.w*c.h*4),c.w,c.h);}catch(_){out=bytes;}}
  try{window.__ROOM_SCANNER_D15_RGB_SOURCE__={visibleId,id:c.id,path:c.path,bytes:bytes.length,width:c.w,height:c.h,mode:__mode,at:new Date().toISOString()};window.__DEPTH_V11_D15_PUSH__&&window.__DEPTH_V11_D15_PUSH__('D15 photo-rgb-resolved',window.__ROOM_SCANNER_D15_RGB_SOURCE__);}catch(_){}
  return out;
})();
`;
      const photoCatchCode = `try{window.__ROOM_SCANNER_D15_PHOTO_RENDER_ERROR__=String(__roomScannerD15PhotoErr&&__roomScannerD15PhotoErr.stack||__roomScannerD15PhotoErr);window.__DEPTH_V11_D15_PUSH__&&window.__DEPTH_V11_D15_PUSH__('D15 photo-review-render-error',{error:window.__ROOM_SCANNER_D15_PHOTO_RENDER_ERROR__,rgbSource:window.__ROOM_SCANNER_D15_RGB_SOURCE__||null});}catch(_){}throw __roomScannerD15PhotoErr;`;
      const patchedPhoto = wrapFunctionBodyWithCatch(html, 'v10RenderPhotoReview', photoPrelude, photoCatchCode, 'Photo review native RGB repair', false);
      html = patchedPhoto.html;
      log('sourcepatch-photo-review-native-rgb-installed', { function: 'v10RenderPhotoReview', count: patchedPhoto.count, rgbMode });

      const oldVisibleLabel = 'ROOM SCANNER V10.0.8 · DEPTH VERIFIED + RAW';
      if (html.includes(oldVisibleLabel)) html = html.replace(oldVisibleLabel, permanentDepthOff ? 'ROOM SCANNER V11-D15 · XR TRACE · DEPTH OFF CONTROL' : 'ROOM SCANNER V11-D15 · PHOTO REVIEW + MODEL FLOW');

      const msgOld = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{},p=S.depthAI.pending.get(m.id);';
      const msgNew = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{};if(m.__depthDiagV11){S.depthAI.v11Progress=S.depthAI.v11Progress||[];const q=m.progress||m.debug||m;S.depthAI.v11Progress.push(q);if(S.depthAI.v11Progress.length>360)S.depthAI.v11Progress.splice(0,S.depthAI.v11Progress.length-360);S.depthAI.v11LastProgressAt=performance.now();try{window.__DEPTH_V11_D15_PUSH__&&window.__DEPTH_V11_D15_PUSH__(q.type||q.reason||"worker-diag",q.detail||q)}catch(_){}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;return}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;const p=S.depthAI.pending.get(m.id);';
      if (html.includes(msgOld)) html = replaceExactlyOnce(html, msgOld, msgNew, 'Depth worker diagnostic bridge');
      else if (!html.includes('S.depthAI.v11Progress')) throw new Error('Handler DepthAI V10 non riconosciuto');

      // Preload XR lifecycle tracer before any V10 requestSession call.
      const xrTag = `<script src="${XRTRACE_URL}"><` + '/script>';
      html = injectAfterHeadOpen(html, xrTag);
      log('xr-preload-injected', { src: XRTRACE_URL });

      const bodyMatch = html.match(/<body\b[^>]*>/i);
      if (!bodyMatch) throw new Error('Tag body iniziale non trovato');
      const modeLabel = permanentDepthOff ? 'DEPTH OFF CONTROL' : 'PHOTO REVIEW + MODEL FLOW';
      const banner = `<div id="v11D15StaticBanner" style="position:fixed;z-index:2147483647;top:0;left:0;right:0;background:#ffcf33;color:#111;padding:8px 10px;font:900 14px/1.2 system-ui,-apple-system,sans-serif;text-align:center;box-shadow:0 2px 8px #0008">ROOM SCANNER V11-D15 • ${modeLabel} • PHOTO REVIEW FIX • BUILD 2026-08-16</div>`;
      html = html.replace(bodyMatch[0], bodyMatch[0] + banner);

      const bodyEndIndex = html.toLowerCase().lastIndexOf('</body>');
      if (bodyEndIndex < 0) throw new Error('Tag body finale non trovato');
      const diagTag = `<script src="${DIAG_URL}"><` + '/script>';
      html = html.slice(0, bodyEndIndex) + diagTag + html.slice(bodyEndIndex);
      log('external-diagnostics-script-injected', { src: DIAG_URL });

      if (!html.includes("depthAIWorker:'./depth_ai_worker_v11_d15.js'")) throw new Error('Worker D15 non presente dopo trasformazione');
      if (!permanentDepthOff && !html.includes('D15_SOURCEPATCH_XR_GATE_DEPTH_ENGINE_AND_PHOTO_PREFLIGHT')) throw new Error('Source patch XR gate D15 non presente');
      if (!html.includes('D15_NATIVE_RGB_REPAIR')) throw new Error('Source repair RGB D15 non presente');
      if (!html.includes('room_scanner_v11_d15_xrtrace.js')) throw new Error('XR trace D15 non presente');
      if (!html.includes('room_scanner_v11_d15_diag.js')) throw new Error('Diagnostica D15 non presente');

      log('document-rewrite-start', { outputChars: html.length, permanentDepthOff });
      document.open(); document.write(html); document.close();
    } catch (error) { failClosed(error); }
  }

  log('external-loader-file-loaded', { src: document.currentScript && document.currentScript.src });
  boot();
})();
