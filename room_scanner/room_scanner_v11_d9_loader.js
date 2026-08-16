(() => {
  'use strict';

  const BUILD = 'room-scanner-v11-d9-safe-external-loader-2026-08-16-queuefix';
  const V10_URL = './room_scanner_v10.html';
  const WORKER_URL = './depth_ai_worker_v11_d9.js';
  const DIAG_URL = './room_scanner_v11_d9_diag.js?v=d9-queuefix-20260816';
  const events = [];

  function safeJson(value) {
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  function log(stage, detail = {}) {
    const item = { iso: new Date().toISOString(), t_ms: Math.round(performance.now()), stage, detail };
    events.push(item);
    try {
      localStorage.setItem('roomScannerV11D9LoaderTrace', JSON.stringify({ build: BUILD, href: location.href, events: events.slice(-80) }));
    } catch (_) {}
    const live = document.getElementById('v11LoaderLive');
    if (live) {
      live.textContent = 'ROOM SCANNER V11-D9 / LOADER TRACE\n' + events.slice(-24).map(x => `[${x.t_ms}ms] ${x.stage} ${safeJson(x.detail)}`).join('\n');
    }
  }

  function failClosed(error) {
    const message = String(error && error.stack || error);
    log('FAIL-CLOSED', { message });
    const box = document.getElementById('v11LoaderError');
    if (box) {
      box.style.display = 'block';
      box.textContent = 'V11-D9 FERMA IN SICUREZZA\n\n' + message + '\n\n' + JSON.stringify({ build: BUILD, href: location.href, events }, null, 2);
    }
  }

  function replaceExactlyOnce(text, oldText, newText, label) {
    const first = text.indexOf(oldText);
    const last = text.lastIndexOf(oldText);
    if (first < 0 || first !== last) {
      throw new Error(`${label}: anchor atteso una sola volta; first=${first}, last=${last}`);
    }
    return text.slice(0, first) + newText + text.slice(first + oldText.length);
  }

  async function fetchTextWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      return { response, text: response.ok ? await response.text() : '' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function boot() {
    try {
      log('loader-js-executing', { build: BUILD });
      const sourceUrl = `${V10_URL}?v11d9_source=${encodeURIComponent(BUILD)}&ts=${Date.now()}`;
      log('fetch-v10-start', { sourceUrl });
      const { response, text } = await fetchTextWithTimeout(sourceUrl, 15000);
      log('fetch-v10-response', {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
        chars: text.length
      });
      if (!response.ok) throw new Error(`V10 HTTP ${response.status}`);
      if (text.length < 100000) throw new Error(`V10 troppo piccola (${text.length} caratteri)`);
      let html = text;

      const workerAnchor = "depthAIWorker:'./depth_ai_worker.js'";
      const runtimeAnchor = "depthAIRuntimeVersion:'1.23.2'";
      const workerCreateAnchor = 'new Worker(versionedLocalAsset(CFG.depthAIWorker))';
      if (!html.includes(runtimeAnchor)) throw new Error(`Anchor runtime mancante: ${runtimeAnchor}`);
      if (!html.includes(workerCreateAnchor)) throw new Error(`Anchor creazione worker mancante: ${workerCreateAnchor}`);

      html = replaceExactlyOnce(html, workerAnchor, "depthAIWorker:'./depth_ai_worker_v11_d9.js'", 'Depth worker URL');
      log('depth-worker-rerouted', { from: './depth_ai_worker.js', to: WORKER_URL });

      const oldVisibleLabel = 'ROOM SCANNER V10.0.8 · DEPTH VERIFIED + RAW';
      if (html.includes(oldVisibleLabel)) {
        html = html.replace(oldVisibleLabel, 'ROOM SCANNER V11-D9 · DEPTH TRACE + RAW');
        log('visible-version-label-rewritten', { from: oldVisibleLabel, to: 'ROOM SCANNER V11-D9 · DEPTH TRACE + RAW' });
      } else {
        log('visible-version-label-not-found', { expected: oldVisibleLabel });
      }

      const msgOld = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{},p=S.depthAI.pending.get(m.id);';
      const msgNew = 'S.depthAI.worker=W;W.onmessage=e=>{const m=e.data||{};if(m.__depthDiagV11){S.depthAI.v11Progress=S.depthAI.v11Progress||[];const q=m.progress||m.debug||m;S.depthAI.v11Progress.push(q);if(S.depthAI.v11Progress.length>360)S.depthAI.v11Progress.splice(0,S.depthAI.v11Progress.length-360);S.depthAI.v11LastProgressAt=performance.now();try{window.__DEPTH_V11_D9_PUSH__&&window.__DEPTH_V11_D9_PUSH__(q.type||q.reason||"worker-diag",q.detail||q)}catch(_){}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;return}if(m.debug)S.depthAI.lastWorkerDebug=m.debug;const p=S.depthAI.pending.get(m.id);';
      if (html.includes(msgOld)) {
        html = replaceExactlyOnce(html, msgOld, msgNew, 'Depth worker diagnostic bridge');
        log('depth-diagnostic-bridge-injected');
      } else if (!html.includes('S.depthAI.v11Progress')) {
        throw new Error('Handler DepthAI V10 non riconosciuto');
      }

      const bodyMatch = html.match(/<body\b[^>]*>/i);
      if (!bodyMatch) throw new Error('Tag body iniziale non trovato');
      const banner = '<div id="v11D9StaticBanner" style="position:fixed;z-index:2147483647;top:0;left:0;right:0;background:#ffcf33;color:#111;padding:8px 10px;font:900 14px/1.2 system-ui,-apple-system,sans-serif;text-align:center;box-shadow:0 2px 8px #0008">ROOM SCANNER V11-D9 • DEPTH TRACE ACTIVE • BUILD 2026-08-16-QUEUEFIX</div>';
      html = html.replace(bodyMatch[0], bodyMatch[0] + banner);
      log('static-d9-banner-injected');

      const bodyEndIndex = html.toLowerCase().lastIndexOf('</body>');
      if (bodyEndIndex < 0) throw new Error('Tag body finale non trovato');
      const diagTag = `<script src="${DIAG_URL}"><` + '/script>';
      html = html.slice(0, bodyEndIndex) + diagTag + html.slice(bodyEndIndex);
      log('external-diagnostics-script-injected', { src: DIAG_URL });

      // Safety: only the two reviewed source-level application anchors plus presentation/diagnostic additions are changed.
      if (!html.includes("depthAIWorker:'./depth_ai_worker_v11_d9.js'")) throw new Error('Worker D9 non presente dopo trasformazione');
      if (!html.includes('ROOM SCANNER V11-D9')) throw new Error('Marker V11-D9 non presente dopo trasformazione');
      if (!html.includes('room_scanner_v11_d9_diag.js')) throw new Error('Diagnostica D9 non presente dopo trasformazione');

      log('document-rewrite-start', { outputChars: html.length });
      document.open();
      document.write(html);
      document.close();
    } catch (error) {
      failClosed(error);
    }
  }

  log('external-loader-file-loaded', { src: document.currentScript && document.currentScript.src });
  boot();
})();
