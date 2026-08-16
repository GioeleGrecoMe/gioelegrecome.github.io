(() => {
  'use strict';

  const BUILD = 'room-scanner-v11-d12-resilient-loader-2026-08-16';
  const V10_URL = './room_scanner_v10.html';
  const WORKER_URL = './depth_ai_worker_v11_d12.js';
  const XRTRACE_URL = './room_scanner_v11_d12_xrtrace.js?v=d12-20260816';
  const FIXES_URL = './room_scanner_v11_d12_fixes.js?v=d12-20260816';
  const DIAG_URL = './room_scanner_v11_d12_diag.js?v=d12-20260816';
  const events = [];

  function safeJson(value) { try { return JSON.stringify(value); } catch (_) { return String(value); } }
  function log(stage, detail = {}) {
    const item = { iso: new Date().toISOString(), t_ms: Math.round(performance.now()), stage, detail };
    events.push(item);
    try { localStorage.setItem('roomScannerV11D12LoaderTrace', JSON.stringify({ build: BUILD, href: location.href, events: events.slice(-140) })); } catch (_) {}
    const live = document.getElementById('v11LoaderLive');
    if (live) live.textContent = 'ROOM SCANNER V11-D12 / LOADER TRACE\n' + events.slice(-36).map(x => `[${x.t_ms}ms] ${x.stage} ${safeJson(x.detail)}`).join('\n');
  }
  function failClosed(error) {
    const message = String(error && error.stack || error);
    log('FAIL-CLOSED', { message });
    const box = document.getElementById('v11LoaderError');
    if (box) { box.style.display = 'block'; box.textContent = 'V11-D12 FERMA IN SICUREZZA\n\n' + message + '\n\n' + JSON.stringify({ build: BUILD, href: location.href, events }, null, 2); }
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
    // D11 used a unique timestamp + no-store on the only request. On mobile that can
    // bypass an already-valid browser cache and leave the loader waiting on the network.
    // D12 first accepts the deployed/cached same-origin V10, then retries with reload and
    // finally no-store. The content is still anchor-validated before execution.
    const attempts = [
      { label: 'cached-default', url: V10_URL, cache: 'default', timeout: 6500 },
      { label: 'reload-versioned', url: `${V10_URL}?v11d12_source=${encodeURIComponent(BUILD)}`, cache: 'reload', timeout: 9000 },
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
      const depthOff = qp.get('depthoff') === '1';
      log('loader-js-executing', { build: BUILD, depthOff });
      const text = await fetchV10Resilient();
      log('fetch-v10-accepted', { chars: text.length });
      let html = text;

      const workerAnchor = "depthAIWorker:'./depth_ai_worker.js'";
      const runtimeAnchor = "depthAIRuntimeVersion:'1.23.2'";
      const workerCreateAnchor = 'new Worker(versionedLocalAsset(CFG.depthAIWorker))';
      if (!html.includes(runtimeAnchor)) throw new Error(`Anchor runtime mancante: ${runtimeAnchor}`);
      if (!html.includes(workerCreateAnchor)) throw new Error(`Anchor creazione worker mancante: ${workerCreateAnchor}`);
      html = replaceExactlyOnce(html, workerAnchor, "depthAIWorker:'./depth_ai_worker_v11_d12.js'", 'Depth worker URL');
      log('depth-worker-rerouted', { from: './depth_ai_worker.js', to: WORKER_URL });

      // Permanent control mode retained from D11. In normal D12 this anchor remains true;
      // the post-load XR-first shim only suspends it during the start-click handler.
      if (depthOff) {
        const enabledAnchor = 'depthAIEnabled:true';
        const occurrences = html.split(enabledAnchor).length - 1;
        if (occurrences === 1) {
          html = replaceExactlyOnce(html, enabledAnchor, 'depthAIEnabled:false', 'Depth AI enabled flag');
          log('depth-off-control-applied', { anchor: enabledAnchor });
        } else log('depth-off-control-anchor-unavailable', { occurrences });
      }

      const oldVisibleLabel = 'ROOM SCANNER V10.0.8 · DEPTH VERIFIED + RAW';
      if (html.includes(oldVisibleLabel)) html = html.replace(oldVisibleLabel, depthOff ? 'ROOM SCANNER V11-D12 · XR TRACE · DEPTH OFF CONTROL' : 'ROOM SCANNER V11-D12 · XR-FIRST + DEPTH');

      const msgOld = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{},p=S.depthAI.pending.get(m.id);';
      const msgNew = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{};if(m.__depthDiagV11){S.depthAI.v11Progress=S.depthAI.v11Progress||[];const q=m.progress||m.debug||m;S.depthAI.v11Progress.push(q);if(S.depthAI.v11Progress.length>360)S.depthAI.v11Progress.splice(0,S.depthAI.v11Progress.length-360);S.depthAI.v11LastProgressAt=performance.now();try{window.__DEPTH_V11_D12_PUSH__&&window.__DEPTH_V11_D12_PUSH__(q.type||q.reason||"worker-diag",q.detail||q)}catch(_){}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;return}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;const p=S.depthAI.pending.get(m.id);';
      if (html.includes(msgOld)) html = replaceExactlyOnce(html, msgOld, msgNew, 'Depth worker diagnostic bridge');
      else if (!html.includes('S.depthAI.v11Progress')) throw new Error('Handler DepthAI V10 non riconosciuto');

      // XR tracer must run before V10 can call requestSession.
      const xrTag = `<script src="${XRTRACE_URL}"><` + '/script>';
      html = injectAfterHeadOpen(html, xrTag);
      log('xr-preload-injected', { src: XRTRACE_URL });

      const bodyMatch = html.match(/<body\b[^>]*>/i);
      if (!bodyMatch) throw new Error('Tag body iniziale non trovato');
      const modeLabel = depthOff ? 'DEPTH OFF CONTROL' : 'XR-FIRST + DEPTH';
      const banner = `<div id="v11D12StaticBanner" style="position:fixed;z-index:2147483647;top:0;left:0;right:0;background:#ffcf33;color:#111;padding:8px 10px;font:900 14px/1.2 system-ui,-apple-system,sans-serif;text-align:center;box-shadow:0 2px 8px #0008">ROOM SCANNER V11-D12 • ${modeLabel} • RGB GUARD • BUILD 2026-08-16</div>`;
      html = html.replace(bodyMatch[0], bodyMatch[0] + banner);

      const bodyEndIndex = html.toLowerCase().lastIndexOf('</body>');
      if (bodyEndIndex < 0) throw new Error('Tag body finale non trovato');
      const fixesTag = `<script src="${FIXES_URL}"><` + '/script>';
      const diagTag = `<script src="${DIAG_URL}"><` + '/script>';
      html = html.slice(0, bodyEndIndex) + fixesTag + diagTag + html.slice(bodyEndIndex);
      log('postload-fixes-injected', { src: FIXES_URL });
      log('external-diagnostics-script-injected', { src: DIAG_URL });

      if (!html.includes("depthAIWorker:'./depth_ai_worker_v11_d12.js'")) throw new Error('Worker D12 non presente dopo trasformazione');
      if (!html.includes('room_scanner_v11_d12_xrtrace.js')) throw new Error('XR trace D12 non presente dopo trasformazione');
      if (!html.includes('room_scanner_v11_d12_fixes.js')) throw new Error('Fix runtime D12 non presente dopo trasformazione');
      if (!html.includes('room_scanner_v11_d12_diag.js')) throw new Error('Diagnostica D12 non presente dopo trasformazione');

      log('document-rewrite-start', { outputChars: html.length, depthOff });
      document.open(); document.write(html); document.close();
    } catch (error) { failClosed(error); }
  }

  log('external-loader-file-loaded', { src: document.currentScript && document.currentScript.src });
  boot();
})();
