(() => {
  'use strict';

  // V11-D13 SOURCE-PATCH LOADER
  // ---------------------------
  // D12 proved that CFG.depthAIEnabled and v10RenderPhotoReview are lexical bindings
  // inside the V10 application script. An external JS shim cannot reliably modify them.
  // D13 therefore patches the fetched V10 SOURCE TEXT before document.write() executes it.
  // This keeps the deployed V10 file untouched while placing the XR gate in the same
  // lexical scope as CFG and ensureDepthAIWorker.
  const BUILD = 'room-scanner-v11-d13-sourcepatch-loader-2026-08-16';
  const V10_URL = './room_scanner_v10.html';
  const WORKER_URL = './depth_ai_worker_v11_d13.js';
  const XRTRACE_URL = './room_scanner_v11_d13_xrtrace.js?v=d13-20260816';
  const DIAG_URL = './room_scanner_v11_d13_diag.js?v=d13-20260816';
  const events = [];

  function safeJson(value) { try { return JSON.stringify(value); } catch (_) { return String(value); } }
  function log(stage, detail = {}) {
    const item = { iso: new Date().toISOString(), t_ms: Math.round(performance.now()), stage, detail };
    events.push(item);
    try { localStorage.setItem('roomScannerV11D13LoaderTrace', JSON.stringify({ build: BUILD, href: location.href, events: events.slice(-180) })); } catch (_) {}
    const live = document.getElementById('v11LoaderLive');
    if (live) live.textContent = 'ROOM SCANNER V11-D13 / LOADER TRACE\n' + events.slice(-42).map(x => `[${x.t_ms}ms] ${x.stage} ${safeJson(x.detail)}`).join('\n');
  }
  function failClosed(error) {
    const message = String(error && error.stack || error);
    log('FAIL-CLOSED', { message });
    const box = document.getElementById('v11LoaderError');
    if (box) {
      box.style.display = 'block';
      box.textContent = 'V11-D13 FERMA IN SICUREZZA\n\n' + message + '\n\n' + JSON.stringify({ build: BUILD, href: location.href, events }, null, 2);
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
      { label: 'reload-versioned', url: `${V10_URL}?v11d13_source=${encodeURIComponent(BUILD)}`, cache: 'reload', timeout: 9000 },
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
      html = replaceExactlyOnce(html, workerAnchor, "depthAIWorker:'./depth_ai_worker_v11_d13.js'", 'Depth worker URL');
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
        // requestSession's D13 tracer calls the restore closure after an XR session is created.
        const xrGatePrologue = `\n/* D13_SOURCEPATCH_XR_GATE */\nconst __roomScannerD13PrevDepthEnabled=!!CFG.depthAIEnabled;\nif(__roomScannerD13PrevDepthEnabled){\n  CFG.depthAIEnabled=false;\n  let __roomScannerD13DepthRestored=false;\n  const __roomScannerD13RestoreDepth=(reason)=>{\n    if(__roomScannerD13DepthRestored)return;\n    __roomScannerD13DepthRestored=true;\n    CFG.depthAIEnabled=__roomScannerD13PrevDepthEnabled;\n    try{window.__ROOM_SCANNER_D13_DEPTH_GATE_STATE__={active:false,restored:true,reason:String(reason||''),restoredAt:new Date().toISOString()};}catch(_){}\n    try{window.__DEPTH_V11_D13_PUSH__&&window.__DEPTH_V11_D13_PUSH__('D13 xr-gate-depth-restored',{reason:String(reason||'')});}catch(_){}\n    if(__roomScannerD13PrevDepthEnabled&&typeof ensureDepthAIWorker==='function'){\n      setTimeout(()=>{\n        try{\n          const p=ensureDepthAIWorker();\n          if(p&&typeof p.catch==='function')p.catch(e=>{try{window.__DEPTH_V11_D13_PUSH__&&window.__DEPTH_V11_D13_PUSH__('D13 post-xr-depth-worker-error',{error:String(e&&e.stack||e)});}catch(_){}});\n          try{window.__DEPTH_V11_D13_PUSH__&&window.__DEPTH_V11_D13_PUSH__('D13 post-xr-depth-worker-ensure',{});}catch(_){}\n        }catch(e){try{window.__DEPTH_V11_D13_PUSH__&&window.__DEPTH_V11_D13_PUSH__('D13 post-xr-depth-worker-error',{error:String(e&&e.stack||e)});}catch(_){}}\n      },0);\n    }\n  };\n  try{window.__ROOM_SCANNER_D13_DEPTH_GATE_STATE__={active:true,restored:false,enteredAt:new Date().toISOString(),previousDepthEnabled:true};}catch(_){}\n  try{window.__DEPTH_V11_D13_PUSH__&&window.__DEPTH_V11_D13_PUSH__('D13 xr-gate-enter',{activation:navigator.userActivation?{isActive:!!navigator.userActivation.isActive,hasBeenActive:!!navigator.userActivation.hasBeenActive}:null});}catch(_){}\n  window.__ROOM_SCANNER_D13_RESTORE_DEPTH__=(reason)=>{\n    const delay=Number(window.__ROOM_SCANNER_D13_DEPTH_DELAY_MS__);\n    const delayMs=Number.isFinite(delay)?Math.max(0,delay):3000;\n    try{window.__DEPTH_V11_D13_PUSH__&&window.__DEPTH_V11_D13_PUSH__('D13 xr-gate-restore-scheduled',{reason:String(reason||''),delayMs});}catch(_){}\n    setTimeout(()=>__roomScannerD13RestoreDepth(reason||'xr-session-created'),delayMs);\n  };\n  const __roomScannerD13Failsafe=Number(window.__ROOM_SCANNER_D13_GATE_FAILSAFE_MS__);\n  setTimeout(()=>__roomScannerD13RestoreDepth('failsafe-no-xr-session'),Number.isFinite(__roomScannerD13Failsafe)?Math.max(1000,__roomScannerD13Failsafe):12000);\n}\n`;
        const patchedStart = injectFunctionPrologue(html, 'v10StartScanWithDepthCheck', xrGatePrologue, 'XR-first source patch', true);
        html = patchedStart.html;
        log('sourcepatch-xr-gate-installed', { function: 'v10StartScanWithDepthCheck', count: patchedStart.count });
      }

      // V10 currently throws `ReferenceError: rgb is not defined` from v10RenderPhotoReview.
      // Until the exact intended RGB preview variable is repaired in the base V10, D13 disables
      // only this review renderer. Raw photo capture and room scanning data remain untouched.
      const photoGuardPrologue = `\n/* D13_SOURCEPATCH_PHOTO_REVIEW_GUARD */\ntry{window.__ROOM_SCANNER_D13_PHOTO_GUARD_COUNT__=(window.__ROOM_SCANNER_D13_PHOTO_GUARD_COUNT__||0)+1;window.__DEPTH_V11_D13_PUSH__&&window.__DEPTH_V11_D13_PUSH__('D13 photo-review-bypassed',{count:window.__ROOM_SCANNER_D13_PHOTO_GUARD_COUNT__});}catch(_){}\nreturn;\n`;
      const patchedPhoto = injectFunctionPrologue(html, 'v10RenderPhotoReview', photoGuardPrologue, 'Photo review source guard', false);
      html = patchedPhoto.html;
      log('sourcepatch-photo-review-guard-installed', { function: 'v10RenderPhotoReview', count: patchedPhoto.count });

      const oldVisibleLabel = 'ROOM SCANNER V10.0.8 · DEPTH VERIFIED + RAW';
      if (html.includes(oldVisibleLabel)) html = html.replace(oldVisibleLabel, permanentDepthOff ? 'ROOM SCANNER V11-D13 · XR TRACE · DEPTH OFF CONTROL' : 'ROOM SCANNER V11-D13 · SOURCE-PATCH XR GATE + DEPTH');

      const msgOld = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{},p=S.depthAI.pending.get(m.id);';
      const msgNew = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{};if(m.__depthDiagV11){S.depthAI.v11Progress=S.depthAI.v11Progress||[];const q=m.progress||m.debug||m;S.depthAI.v11Progress.push(q);if(S.depthAI.v11Progress.length>360)S.depthAI.v11Progress.splice(0,S.depthAI.v11Progress.length-360);S.depthAI.v11LastProgressAt=performance.now();try{window.__DEPTH_V11_D13_PUSH__&&window.__DEPTH_V11_D13_PUSH__(q.type||q.reason||"worker-diag",q.detail||q)}catch(_){}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;return}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;const p=S.depthAI.pending.get(m.id);';
      if (html.includes(msgOld)) html = replaceExactlyOnce(html, msgOld, msgNew, 'Depth worker diagnostic bridge');
      else if (!html.includes('S.depthAI.v11Progress')) throw new Error('Handler DepthAI V10 non riconosciuto');

      // Preload XR lifecycle tracer before any V10 requestSession call.
      const xrTag = `<script src="${XRTRACE_URL}"><` + '/script>';
      html = injectAfterHeadOpen(html, xrTag);
      log('xr-preload-injected', { src: XRTRACE_URL });

      const bodyMatch = html.match(/<body\b[^>]*>/i);
      if (!bodyMatch) throw new Error('Tag body iniziale non trovato');
      const modeLabel = permanentDepthOff ? 'DEPTH OFF CONTROL' : 'SOURCE-PATCH XR GATE + DEPTH';
      const banner = `<div id="v11D13StaticBanner" style="position:fixed;z-index:2147483647;top:0;left:0;right:0;background:#ffcf33;color:#111;padding:8px 10px;font:900 14px/1.2 system-ui,-apple-system,sans-serif;text-align:center;box-shadow:0 2px 8px #0008">ROOM SCANNER V11-D13 • ${modeLabel} • PHOTO REVIEW BYPASS • BUILD 2026-08-16</div>`;
      html = html.replace(bodyMatch[0], bodyMatch[0] + banner);

      const bodyEndIndex = html.toLowerCase().lastIndexOf('</body>');
      if (bodyEndIndex < 0) throw new Error('Tag body finale non trovato');
      const diagTag = `<script src="${DIAG_URL}"><` + '/script>';
      html = html.slice(0, bodyEndIndex) + diagTag + html.slice(bodyEndIndex);
      log('external-diagnostics-script-injected', { src: DIAG_URL });

      if (!html.includes("depthAIWorker:'./depth_ai_worker_v11_d13.js'")) throw new Error('Worker D13 non presente dopo trasformazione');
      if (!permanentDepthOff && !html.includes('D13_SOURCEPATCH_XR_GATE')) throw new Error('Source patch XR gate D13 non presente');
      if (!html.includes('D13_SOURCEPATCH_PHOTO_REVIEW_GUARD')) throw new Error('Source guard photo D13 non presente');
      if (!html.includes('room_scanner_v11_d13_xrtrace.js')) throw new Error('XR trace D13 non presente');
      if (!html.includes('room_scanner_v11_d13_diag.js')) throw new Error('Diagnostica D13 non presente');

      log('document-rewrite-start', { outputChars: html.length, permanentDepthOff });
      document.open(); document.write(html); document.close();
    } catch (error) { failClosed(error); }
  }

  log('external-loader-file-loaded', { src: document.currentScript && document.currentScript.src });
  boot();
})();
