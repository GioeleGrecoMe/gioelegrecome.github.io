/*
 * Room Scanner v9 hotfix runtime
 *
 * Goals:
 *  1) Recover the Stage-5 Digital Twin viewer if it remains trapped inside a
 *     hidden XR/UI container after the WebXR session is torn down.
 *  2) Make the uncalibrated-measurement mode explicit and reversible. The
 *     source patcher/loader rewrites calibration gate conditions so this flag
 *     can bypass only those gate blocks while leaving normal calibrated mode
 *     unchanged.
 *  3) Add diagnostics for uncaught errors, rejected promises, WebGL context
 *     loss, and WebXR session end/visibility transitions.
 *
 * This file intentionally avoids depending on private variable names from the
 * original single-file application. It uses stable user-visible labels and DOM
 * structure, which makes it easier to debug across v9.x revisions.
 */
(function roomScannerHotfixBootstrap() {
  'use strict';

  if (window.__RS_HOTFIX_RUNTIME_LOADED__) return;
  window.__RS_HOTFIX_RUNTIME_LOADED__ = true;

  const HOTFIX_VERSION = '2026-08-15.3';
  const STORAGE_KEY = 'roomScanner.hotfix.allowUncalibrated';
  const LOG_LIMIT = 600;
  const logs = [];
  let twinRecoveryActive = false;
  let twinRecoveryHost = null;
  let twinPanel = null;
  let originalTwinParent = null;
  let originalTwinNextSibling = null;
  let lastAutoRecoverAt = 0;
  let mutationTimer = 0;

  function safeString(value) {
    try {
      if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ''}`;
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function log(event, detail) {
    const row = {
      t: new Date().toISOString(),
      event,
      detail: detail === undefined ? '' : safeString(detail)
    };
    logs.push(row);
    if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT);
    try { console.info(`[RS-HOTFIX ${HOTFIX_VERSION}] ${event}`, detail === undefined ? '' : detail); } catch (_) {}
  }

  function readStoredUncalibratedFlag() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
  }

  function writeStoredUncalibratedFlag(enabled) {
    try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function elementsByTagText(tagName, fragment) {
    const needle = normalizeText(fragment);
    return Array.from(document.querySelectorAll(tagName)).filter((el) => normalizeText(el.textContent).includes(needle));
  }

  function firstButton(fragment) {
    return elementsByTagText('button', fragment)[0] || null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function forceInteractive(el) {
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    el.style.removeProperty('display');
    if (getComputedStyle(el).display === 'none') el.style.display = 'block';
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
  }

  function findTwinHeading() {
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const exact = headings.find((el) => normalizeText(el.textContent).includes('5/5 · digital twin acustico'));
    if (exact) return exact;
    const generic = headings.find((el) => normalizeText(el.textContent).includes('digital twin acustico'));
    if (generic) return generic;

    // Fallback only to small/leaf-ish text elements. Broad div roots are
    // deliberately excluded because reparenting an application root can break
    // the whole UI.
    const leaves = Array.from(document.querySelectorAll('span,strong,p,label,div')).filter((el) => el.children.length <= 3);
    return leaves.find((el) => normalizeText(el.textContent).includes('5/5 · digital twin acustico')) ||
      leaves.find((el) => normalizeText(el.textContent).includes('digital twin acustico')) || null;
  }

  function twinControlScore(node) {
    const text = normalizeText(node && node.textContent);
    return [
      'genera rir',
      'salva twin json',
      'riprocessa modello 3d',
      'usa sorgente misurata',
      'ricevitore'
    ].reduce((acc, token) => acc + (text.includes(token) ? 1 : 0), 0);
  }

  function findTwinPanel() {
    const heading = findTwinHeading();
    if (!heading) return null;

    // Prefer semantic/local panel containers. We accept a candidate only if it
    // contains several Stage-5 controls AND is not an enormous app root.
    let node = heading;
    for (let depth = 0; node && node !== document.body && node !== document.documentElement && depth < 9; depth += 1, node = node.parentElement) {
      const score = twinControlScore(node);
      if (score < 3) continue;
      const buttons = node.querySelectorAll ? node.querySelectorAll('button').length : 0;
      const stageHeadings = node.querySelectorAll ? Array.from(node.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter((h) => /[1-5]\s*\/\s*5/.test(normalizeText(h.textContent))).length : 0;
      if (buttons <= 32 && stageHeadings <= 2) return node;
    }

    // Fail safely instead of moving an uncertain parent. The floating button
    // remains available and diagnostics will state that the panel was not found.
    return null;
  }

  function ensureTwinRecoveryHost() {
    if (twinRecoveryHost && twinRecoveryHost.isConnected) return twinRecoveryHost;
    const host = document.createElement('div');
    host.id = 'rs-hotfix-twin-host';
    host.setAttribute('data-room-scanner-hotfix', HOTFIX_VERSION);
    host.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483000',
      'display:none',
      'overflow:auto',
      'background:#05070b',
      'color:inherit',
      'pointer-events:auto',
      'overscroll-behavior:contain'
    ].join(';');
    document.body.appendChild(host);
    twinRecoveryHost = host;
    return host;
  }

  function kickViewerResize(reason) {
    log('viewer-resize-kick', reason);
    const fire = () => {
      try { window.dispatchEvent(new Event('resize')); } catch (_) {}
      try { window.visualViewport && window.visualViewport.dispatchEvent(new Event('resize')); } catch (_) {}
      document.querySelectorAll('canvas').forEach((canvas) => {
        try {
          const rect = canvas.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            canvas.style.minWidth = '1px';
            canvas.style.minHeight = '1px';
          }
        } catch (_) {}
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(fire));
    setTimeout(fire, 120);
    setTimeout(fire, 450);
    setTimeout(fire, 1200);
  }

  function recoverTwin(reason = 'manual') {
    const panel = findTwinPanel();
    if (!panel) {
      log('twin-recovery-failed', 'Stage-5 panel not found');
      showToast('Hotfix: pannello Twin non ancora trovato. Riprova quando il processing è terminato.');
      return false;
    }

    const host = ensureTwinRecoveryHost();
    if (!twinRecoveryActive || twinPanel !== panel) {
      twinPanel = panel;
      originalTwinParent = panel.parentNode;
      originalTwinNextSibling = panel.nextSibling;
      host.appendChild(panel); // Event listeners and WebGL canvases survive DOM reparenting.
      twinRecoveryActive = true;
      log('twin-panel-reparented', { reason, tag: panel.tagName, id: panel.id || '', cls: panel.className || '' });
    }

    host.style.display = 'block';
    forceInteractive(host);
    forceInteractive(panel);
    panel.style.position = 'relative';
    panel.style.zIndex = '1';
    panel.style.minHeight = '100%';

    // A hidden ancestor can no longer suppress the Twin after reparenting.
    // The resize kick addresses the second common failure mode: WebGL canvas
    // initialized while display:none, resulting in a 0x0 viewport.
    kickViewerResize(reason);
    showToast('Twin recuperato. Se il modello è vuoto, premi “Riprocessa modello 3D” una sola volta.');
    return true;
  }

  function restoreTwinToOriginalParent() {
    if (!twinRecoveryActive || !twinPanel || !originalTwinParent) return;
    try {
      if (originalTwinNextSibling && originalTwinNextSibling.parentNode === originalTwinParent) {
        originalTwinParent.insertBefore(twinPanel, originalTwinNextSibling);
      } else {
        originalTwinParent.appendChild(twinPanel);
      }
      if (twinRecoveryHost) twinRecoveryHost.style.display = 'none';
      twinRecoveryActive = false;
      log('twin-panel-restored');
    } catch (error) {
      log('twin-restore-error', error);
    }
  }

  function showToast(message) {
    let toast = document.getElementById('rs-hotfix-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'rs-hotfix-toast';
      toast.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:18px',
        'transform:translateX(-50%)',
        'z-index:2147483647',
        'max-width:min(92vw,760px)',
        'padding:10px 14px',
        'border-radius:12px',
        'background:rgba(15,18,24,.95)',
        'color:#fff',
        'font:600 13px/1.35 system-ui,sans-serif',
        'box-shadow:0 8px 30px rgba(0,0,0,.35)',
        'pointer-events:none',
        'opacity:0',
        'transition:opacity .15s ease'
      ].join(';');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast.__rsTimer);
    toast.__rsTimer = setTimeout(() => { toast.style.opacity = '0'; }, 4200);
  }

  function applyUncalibratedUiState() {
    const enabled = !!window.__RS_ALLOW_UNCALIBRATED__;
    document.documentElement.toggleAttribute('data-rs-uncalibrated', enabled);

    const gateButtons = [
      'avvia automatica',
      'avvia manuale guidata',
      'apri scansione ar',
      'continua · misura',
      'salta oggetti',
      'calibrazione ok · inizia misura'
    ];
    if (enabled) {
      Array.from(document.querySelectorAll('button')).forEach((button) => {
        const text = normalizeText(button.textContent);
        if (gateButtons.some((token) => text.includes(token))) {
          if (button.disabled) button.disabled = false;
          if (button.hasAttribute('disabled')) button.removeAttribute('disabled');
          if (button.hasAttribute('aria-disabled')) button.removeAttribute('aria-disabled');
          if (button.dataset.rsHotfixEnabled !== '1') button.dataset.rsHotfixEnabled = '1';
        }
      });
    }

    updateUncalibratedBanner();
    updateUncalibratedButton();
  }

  function setUncalibratedMode(enabled) {
    window.__RS_ALLOW_UNCALIBRATED__ = !!enabled;
    writeStoredUncalibratedFlag(!!enabled);
    log('uncalibrated-mode', enabled ? 'enabled' : 'disabled');
    applyUncalibratedUiState();
    showToast(enabled
      ? 'Modalità NON calibrata attiva: misura consentita, ma SPL/compensazione assoluta non sono validi.'
      : 'Modalità non calibrata disattivata: torna valido il flusso di calibrazione standard.');
  }

  function updateUncalibratedBanner() {
    const enabled = !!window.__RS_ALLOW_UNCALIBRATED__;
    let banner = document.getElementById('rs-hotfix-uncalibrated-banner');
    if (!enabled) {
      if (banner) banner.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'rs-hotfix-uncalibrated-banner';
      banner.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        'right:0',
        'z-index:2147482500',
        'padding:6px 10px',
        'background:#5b2a00',
        'color:#fff',
        'font:700 12px/1.3 system-ui,sans-serif',
        'text-align:center',
        'pointer-events:none'
      ].join(';');
      document.body.appendChild(banner);
    }
    const warning = 'MISURA NON CALIBRATA — RIR relativa disponibile; SPL assoluto, compensazione sorgente/microfono e coefficienti assoluti vanno trattati come non calibrati.';
    if (banner.textContent !== warning) banner.textContent = warning;
  }

  function ensureUncalibratedButton() {
    if (document.getElementById('rs-hotfix-uncalibrated-toggle')) return;
    const anchor = firstButton('avvia calibrazione acustica') || firstButton('prepara microfono');
    if (!anchor || !anchor.parentElement) return;
    const button = document.createElement('button');
    button.id = 'rs-hotfix-uncalibrated-toggle';
    button.type = 'button';
    button.dataset.roomScannerHotfix = HOTFIX_VERSION;
    button.style.cssText = 'margin-left:8px;outline:2px solid rgba(255,160,80,.65);';
    button.addEventListener('click', () => setUncalibratedMode(!window.__RS_ALLOW_UNCALIBRATED__));
    anchor.insertAdjacentElement('afterend', button);
    updateUncalibratedButton();
  }

  function updateUncalibratedButton() {
    const button = document.getElementById('rs-hotfix-uncalibrated-toggle');
    if (!button) return;
    const label = window.__RS_ALLOW_UNCALIBRATED__
      ? '✓ Misura senza calibrazione: ON'
      : 'Misura senza calibrazione';
    if (button.textContent !== label) button.textContent = label;
    button.title = window.__RS_HOTFIX_SOURCE_PATCHED__
      ? 'Bypass dei gate sorgente attivo; i dati restano marcati visivamente come non calibrati.'
      : 'Solo sblocco UI runtime. Per bypassare i gate interni usa il file patchato/loader incluso nel pacchetto.';
  }

  function ensureFloatingTools() {
    if (document.getElementById('rs-hotfix-tools')) return;
    const wrap = document.createElement('div');
    wrap.id = 'rs-hotfix-tools';
    wrap.style.cssText = [
      'position:fixed',
      'right:10px',
      'bottom:10px',
      'z-index:2147483600',
      'display:flex',
      'gap:6px',
      'font:600 12px system-ui,sans-serif'
    ].join(';');

    const twin = document.createElement('button');
    twin.type = 'button';
    twin.textContent = 'Apri Twin';
    twin.title = 'Recupera il pannello Stage 5 anche se il contenitore XR è stato nascosto.';
    twin.addEventListener('click', () => recoverTwin('floating-button'));

    const diag = document.createElement('button');
    diag.type = 'button';
    diag.textContent = 'Log hotfix';
    diag.title = 'Scarica i log diagnostici del runtime.';
    diag.addEventListener('click', downloadLogs);

    wrap.append(twin, diag);
    document.body.appendChild(wrap);
  }

  function downloadLogs() {
    const payload = {
      hotfixVersion: HOTFIX_VERSION,
      generatedAt: new Date().toISOString(),
      location: location.href,
      sourcePatched: !!window.__RS_HOTFIX_SOURCE_PATCHED__,
      uncalibratedMode: !!window.__RS_ALLOW_UNCALIBRATED__,
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      logs
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `room_scanner_hotfix_log_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function attachCanvasDiagnostics(canvas) {
    if (!canvas || canvas.dataset.rsHotfixDiag === '1') return;
    canvas.dataset.rsHotfixDiag = '1';
    canvas.addEventListener('webglcontextlost', (event) => {
      log('webgl-context-lost', { id: canvas.id || '', width: canvas.width, height: canvas.height });
      showToast('WebGL context perso durante il Twin. Il log hotfix contiene il dettaglio.');
      // Do not preventDefault(): the original application must decide whether it supports restoration.
    });
    canvas.addEventListener('webglcontextrestored', () => {
      log('webgl-context-restored', { id: canvas.id || '' });
      kickViewerResize('webgl-restored');
    });
  }

  function installGlobalDiagnostics() {
    window.addEventListener('error', (event) => {
      log('window-error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error ? safeString(event.error) : ''
      });
    }, true);

    window.addEventListener('unhandledrejection', (event) => {
      log('unhandled-rejection', event.reason);
    });

    document.addEventListener('visibilitychange', () => log('document-visibility', document.visibilityState));
    document.querySelectorAll('canvas').forEach(attachCanvasDiagnostics);

    try {
      if (navigator.xr && typeof navigator.xr.requestSession === 'function' && !navigator.xr.__rsHotfixWrapped) {
        const original = navigator.xr.requestSession.bind(navigator.xr);
        const wrapped = async function requestSessionHotfix(mode, options) {
          log('xr-request-session', { mode, options });
          try {
            const session = await original(mode, options);
            log('xr-session-created', { mode });
            session.addEventListener('end', () => {
              log('xr-session-end');
              // The original bug often appears immediately after XR teardown.
              // Wait briefly so the app can finish its own cleanup, then recover
              // only if Stage 5 is already present/active.
              setTimeout(() => maybeAutoRecoverTwin('xr-session-end'), 450);
            });
            session.addEventListener('visibilitychange', () => log('xr-visibility', session.visibilityState));
            return session;
          } catch (error) {
            log('xr-request-error', error);
            throw error;
          }
        };
        Object.defineProperty(wrapped, 'name', { value: 'requestSession', configurable: true });
        navigator.xr.requestSession = wrapped;
        navigator.xr.__rsHotfixWrapped = true;
      }
    } catch (error) {
      log('xr-wrap-skipped', error);
    }
  }

  function processingLooksComplete() {
    const all = Array.from(document.querySelectorAll('body *'));
    for (const el of all) {
      if (el.children.length > 4) continue; // Avoid expensive checks on broad containers.
      const text = normalizeText(el.textContent);
      if (!text) continue;
      if (!isVisible(el)) continue;
      if ((text.includes('processing') || text.includes('processing misure') || text.includes('digital twin')) &&
          (text.includes('100%') || text.includes('complet') || text.includes('finito') || text.includes('pronto'))) {
        return true;
      }
    }
    return false;
  }

  function maybeAutoRecoverTwin(trigger) {
    const now = Date.now();
    if (now - lastAutoRecoverAt < 2500) return;
    const panel = findTwinPanel();
    if (!panel) return;

    // Auto-recovery is deliberately conservative. A manual “Apri Twin” button
    // is always available if the original app never exposes a clear 100% text.
    if (processingLooksComplete()) {
      lastAutoRecoverAt = now;
      recoverTwin(`auto:${trigger}`);
      return;
    }

  }

  function installMutationObserver() {
    const observer = new MutationObserver((records) => {
      let relevant = false;
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches && node.matches('canvas')) attachCanvasDiagnostics(node);
              node.querySelectorAll && node.querySelectorAll('canvas').forEach(attachCanvasDiagnostics);
            }
          });
          relevant = true;
        } else if (record.type === 'characterData' || record.type === 'attributes') {
          relevant = true;
        }
      }
      if (relevant && !mutationTimer) {
        mutationTimer = setTimeout(() => {
          mutationTimer = 0;
          ensureUncalibratedButton();
          ensureFloatingTools();
          applyUncalibratedUiState();
          maybeAutoRecoverTwin('mutation');
        }, 120);
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class', 'disabled', 'aria-hidden']
    });
    return observer;
  }

  function installClickHooks() {
    document.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('button') : null;
      if (!button) return;
      const text = normalizeText(button.textContent);
      if (text.includes('apri / riprocessa modello 3d')) {
        setTimeout(() => recoverTwin('open-reprocess-button'), 250);
      }
      if (text.includes('termina sessione')) {
        setTimeout(() => maybeAutoRecoverTwin('terminate-session'), 650);
      }
      if (window.__RS_ALLOW_UNCALIBRATED__ && button.dataset.rsHotfixEnabled === '1') {
        log('uncalibrated-gated-button-click', button.textContent.trim());
      }
    }, true);
  }

  function init() {
    // Preserve a flag set by the early boot script inserted by the patcher.
    if (typeof window.__RS_ALLOW_UNCALIBRATED__ !== 'boolean') {
      window.__RS_ALLOW_UNCALIBRATED__ = readStoredUncalibratedFlag();
    }
    log('hotfix-init', {
      version: HOTFIX_VERSION,
      sourcePatched: !!window.__RS_HOTFIX_SOURCE_PATCHED__,
      uncalibrated: !!window.__RS_ALLOW_UNCALIBRATED__
    });
    installGlobalDiagnostics();
    installClickHooks();
    ensureFloatingTools();
    ensureUncalibratedButton();
    applyUncalibratedUiState();
    installMutationObserver();
    setTimeout(() => maybeAutoRecoverTwin('startup'), 600);
  }

  window.RoomScannerHotfix = {
    version: HOTFIX_VERSION,
    logs,
    log,
    recoverTwin,
    restoreTwinToOriginalParent,
    setUncalibratedMode,
    downloadLogs,
    getState: () => ({
      version: HOTFIX_VERSION,
      sourcePatched: !!window.__RS_HOTFIX_SOURCE_PATCHED__,
      uncalibrated: !!window.__RS_ALLOW_UNCALIBRATED__,
      twinRecoveryActive,
      twinPanelFound: !!findTwinPanel()
    })
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
