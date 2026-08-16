(() => {
  'use strict';

  const BUILD = 'room-scanner-v11-d11-xrtrace-loader-2026-08-16';
  const V10_URL = './room_scanner_v10.html';
  const WORKER_URL = './depth_ai_worker_v11_d11.js';
  const XRTRACE_URL = './room_scanner_v11_d11_xrtrace.js?v=d11-xrtrace-20260816';
  const DIAG_URL = './room_scanner_v11_d11_diag.js?v=d11-xrtrace-20260816';
  const events = [];

  function safeJson(value) { try { return JSON.stringify(value); } catch (_) { return String(value); } }
  function log(stage, detail = {}) {
    const item = { iso: new Date().toISOString(), t_ms: Math.round(performance.now()), stage, detail };
    events.push(item);
    try { localStorage.setItem('roomScannerV11D11LoaderTrace', JSON.stringify({ build: BUILD, href: location.href, events: events.slice(-100) })); } catch (_) {}
    const live = document.getElementById('v11LoaderLive');
    if (live) live.textContent = 'ROOM SCANNER V11-D11 / LOADER TRACE\n' + events.slice(-30).map(x => `[${x.t_ms}ms] ${x.stage} ${safeJson(x.detail)}`).join('\n');
  }
  function failClosed(error) {
    const message = String(error && error.stack || error);
    log('FAIL-CLOSED', { message });
    const box = document.getElementById('v11LoaderError');
    if (box) { box.style.display = 'block'; box.textContent = 'V11-D11 FERMA IN SICUREZZA\n\n' + message + '\n\n' + JSON.stringify({ build: BUILD, href: location.href, events }, null, 2); }
  }
  function replaceExactlyOnce(text, oldText, newText, label) {
    const first = text.indexOf(oldText), last = text.lastIndexOf(oldText);
    if (first < 0 || first !== last) throw new Error(`${label}: anchor atteso una sola volta; first=${first}, last=${last}`);
    return text.slice(0, first) + newText + text.slice(first + oldText.length);
  }
  async function fetchTextWithTimeout(url, ms) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), ms);
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      return { response, text: response.ok ? await response.text() : '' };
    } finally { clearTimeout(timer); }
  }
  function injectAfterHeadOpen(html, tag) {
    const m = html.match(/<head\b[^>]*>/i);
    if (!m) throw new Error('Tag head iniziale non trovato');
    return html.replace(m[0], m[0] + tag);
  }

  async function boot() {
    try {
      const qp = new URLSearchParams(location.search);
      const depthOff = qp.get('depthoff') === '1';
      log('loader-js-executing', { build: BUILD, depthOff });
      const sourceUrl = `${V10_URL}?v11d11_source=${encodeURIComponent(BUILD)}&ts=${Date.now()}`;
      log('fetch-v10-start', { sourceUrl });
      const { response, text } = await fetchTextWithTimeout(sourceUrl, 15000);
      log('fetch-v10-response', { status: response.status, ok: response.ok, contentType: response.headers.get('content-type'), chars: text.length });
      if (!response.ok) throw new Error(`V10 HTTP ${response.status}`);
      if (text.length < 100000) throw new Error(`V10 troppo piccola (${text.length} caratteri)`);
      let html = text;

      const workerAnchor = "depthAIWorker:'./depth_ai_worker.js'";
      const runtimeAnchor = "depthAIRuntimeVersion:'1.23.2'";
      const workerCreateAnchor = 'new Worker(versionedLocalAsset(CFG.depthAIWorker))';
      if (!html.includes(runtimeAnchor)) throw new Error(`Anchor runtime mancante: ${runtimeAnchor}`);
      if (!html.includes(workerCreateAnchor)) throw new Error(`Anchor creazione worker mancante: ${workerCreateAnchor}`);
      html = replaceExactlyOnce(html, workerAnchor, "depthAIWorker:'./depth_ai_worker_v11_d11.js'", 'Depth worker URL');
      log('depth-worker-rerouted', { from: './depth_ai_worker.js', to: WORKER_URL });

      // CONTROL TEST ONLY. ?depthoff=1 disables the existing V10 Depth-AI feature flag if the reviewed
      // anchor exists. It does not alter WebXR, geometry, audio, camera, or any other feature.
      if (depthOff) {
        const enabledAnchor = 'depthAIEnabled:true';
        const occurrences = html.split(enabledAnchor).length - 1;
        if (occurrences === 1) {
          html = replaceExactlyOnce(html, enabledAnchor, 'depthAIEnabled:false', 'Depth AI enabled flag');
          log('depth-off-control-applied', { anchor: enabledAnchor });
        } else {
          log('depth-off-control-anchor-unavailable', { occurrences });
        }
      }

      const oldVisibleLabel = 'ROOM SCANNER V10.0.8 · DEPTH VERIFIED + RAW';
      if (html.includes(oldVisibleLabel)) html = html.replace(oldVisibleLabel, depthOff ? 'ROOM SCANNER V11-D11 · XR TRACE · DEPTH OFF CONTROL' : 'ROOM SCANNER V11-D11 · XR TRACE + DEPTH');

      const msgOld = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{},p=S.depthAI.pending.get(m.id);';
      const msgNew = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{};if(m.__depthDiagV11){S.depthAI.v11Progress=S.depthAI.v11Progress||[];const q=m.progress||m.debug||m;S.depthAI.v11Progress.push(q);if(S.depthAI.v11Progress.length>360)S.depthAI.v11Progress.splice(0,S.depthAI.v11Progress.length-360);S.depthAI.v11LastProgressAt=performance.now();try{window.__DEPTH_V11_D11_PUSH__&&window.__DEPTH_V11_D11_PUSH__(q.type||q.reason||"worker-diag",q.detail||q)}catch(_){}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;return}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;const p=S.depthAI.pending.get(m.id);';
      if (html.includes(msgOld)) html = replaceExactlyOnce(html, msgOld, msgNew, 'Depth worker diagnostic bridge');
      else if (!html.includes('S.depthAI.v11Progress')) throw new Error('Handler DepthAI V10 non riconosciuto');

      // Critical D11 change: WebXR instrumentation is loaded at the beginning of <head>, before the V10
      // application can call navigator.xr.requestSession(). This is required to capture the true lifecycle.
      const xrTag = `<script src="${XRTRACE_URL}"><` + '/script>';
      html = injectAfterHeadOpen(html, xrTag);
      log('xr-preload-injected', { src: XRTRACE_URL });

      const bodyMatch = html.match(/<body\b[^>]*>/i);
      if (!bodyMatch) throw new Error('Tag body iniziale non trovato');
      const modeLabel = depthOff ? 'DEPTH OFF CONTROL' : 'DEPTH ON';
      const banner = `<div id="v11D11StaticBanner" style="position:fixed;z-index:2147483647;top:0;left:0;right:0;background:#ffcf33;color:#111;padding:8px 10px;font:900 14px/1.2 system-ui,-apple-system,sans-serif;text-align:center;box-shadow:0 2px 8px #0008">ROOM SCANNER V11-D11 • XR TRACE • ${modeLabel} • BUILD 2026-08-16</div>`;
      html = html.replace(bodyMatch[0], bodyMatch[0] + banner);

      const bodyEndIndex = html.toLowerCase().lastIndexOf('</body>');
      if (bodyEndIndex < 0) throw new Error('Tag body finale non trovato');
      const diagTag = `<script src="${DIAG_URL}"><` + '/script>';
      html = html.slice(0, bodyEndIndex) + diagTag + html.slice(bodyEndIndex);
      log('external-diagnostics-script-injected', { src: DIAG_URL });

      if (!html.includes("depthAIWorker:'./depth_ai_worker_v11_d11.js'")) throw new Error('Worker D11 non presente dopo trasformazione');
      if (!html.includes('room_scanner_v11_d11_xrtrace.js')) throw new Error('XR trace D11 non presente dopo trasformazione');
      if (!html.includes('room_scanner_v11_d11_diag.js')) throw new Error('Diagnostica D11 non presente dopo trasformazione');

      log('document-rewrite-start', { outputChars: html.length, depthOff });
      document.open(); document.write(html); document.close();
    } catch (error) { failClosed(error); }
  }

  log('external-loader-file-loaded', { src: document.currentScript && document.currentScript.src });
  boot();
})();
