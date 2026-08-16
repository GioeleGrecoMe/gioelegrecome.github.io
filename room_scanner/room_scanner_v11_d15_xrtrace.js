(() => {
  'use strict';

  // D15_XR_TRACE: loaded before the V10 application scripts. This file is diagnostics-only:
  // it records WebXR lifecycle and user-activation state without changing XR options or rendering.
  const BUILD = 'room-scanner-v11-d15-xrtrace-2026-08-16';
  const STORE = 'roomScannerV11D15XRTrace';
  const events = [];
  const MAX_EVENTS = 180;
  let lastGesture = null;
  let activeSession = null;

  function safeClone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return { text: String(value) }; }
  }

  function activationSnapshot() {
    const ua = navigator.userActivation;
    return ua ? { isActive: !!ua.isActive, hasBeenActive: !!ua.hasBeenActive } : null;
  }

  function stackText() {
    try { return String(new Error('D15 XR call stack').stack || '').split('\n').slice(1, 8).join('\n'); }
    catch (_) { return ''; }
  }

  function push(type, detail = {}) {
    const item = {
      iso: new Date().toISOString(),
      t_ms: Math.round(performance.now()),
      type,
      detail: safeClone(detail)
    };
    events.push(item);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    try {
      localStorage.setItem(STORE, JSON.stringify({ build: BUILD, href: location.href, updatedAt: item.iso, events }));
    } catch (_) {}
    try {
      window.__DEPTH_V11_D15_PUSH__ && window.__DEPTH_V11_D15_PUSH__('XR ' + type, item.detail);
    } catch (_) {}
  }

  function targetInfo(target) {
    try {
      return {
        tag: String(target && target.tagName || ''),
        id: String(target && target.id || ''),
        className: String(target && target.className || '').slice(0, 160),
        text: String(target && target.innerText || target && target.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160)
      };
    } catch (_) { return {}; }
  }

  function onGesture(event) {
    lastGesture = {
      iso: new Date().toISOString(),
      t_ms: performance.now(),
      event: event.type,
      target: targetInfo(event.target),
      activation: activationSnapshot()
    };
    push('user-gesture', lastGesture);
  }

  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('click', onGesture, true);
  document.addEventListener('touchend', onGesture, true);

  window.addEventListener('error', event => {
    push('window-error', {
      message: event.message || '', filename: event.filename || '', lineno: event.lineno || 0,
      colno: event.colno || 0, stack: String(event.error && event.error.stack || '')
    });
  });
  window.addEventListener('unhandledrejection', event => {
    push('window-unhandledrejection', { reason: String(event.reason && event.reason.stack || event.reason || '') });
  });
  window.addEventListener('pagehide', event => push('pagehide', { persisted: !!event.persisted, visibility: document.visibilityState }));
  document.addEventListener('visibilitychange', () => push('document-visibilitychange', { visibility: document.visibilityState }));
  document.addEventListener('webglcontextlost', event => push('webgl-context-lost', { target: targetInfo(event.target) }), true);
  document.addEventListener('webglcontextrestored', event => push('webgl-context-restored', { target: targetInfo(event.target) }), true);

  function sessionSnapshot(session) {
    if (!session) return null;
    let enabledFeatures = null;
    try { enabledFeatures = session.enabledFeatures ? Array.from(session.enabledFeatures) : null; } catch (_) {}
    return {
      visibilityState: session.visibilityState || null,
      environmentBlendMode: session.environmentBlendMode || null,
      interactionMode: session.interactionMode || null,
      depthUsage: session.depthUsage || null,
      depthDataFormat: session.depthDataFormat || null,
      depthType: session.depthType || null,
      depthActive: session.depthActive == null ? null : !!session.depthActive,
      enabledFeatures
    };
  }

  function instrumentSession(session, requestMeta) {
    activeSession = session;
    push('xr-session-instrumented', { requestMeta, session: sessionSnapshot(session) });

    session.addEventListener('visibilitychange', () => {
      push('xr-session-visibilitychange', { session: sessionSnapshot(session) });
    });
    session.addEventListener('inputsourceschange', event => {
      push('xr-inputsourceschange', {
        added: event.added ? event.added.length : null,
        removed: event.removed ? event.removed.length : null,
        session: sessionSnapshot(session)
      });
    });
    session.addEventListener('end', () => {
      push('xr-session-end-event', {
        elapsedSinceRequest_ms: requestMeta ? Math.round(performance.now() - requestMeta.t0) : null,
        session: sessionSnapshot(session),
        activation: activationSnapshot()
      });
      if (activeSession === session) activeSession = null;
    }, { once: true });

    // Log explicit application calls to session.end(). If the XR runtime ends the session itself,
    // xr-session-end-event appears without this event, which is diagnostically useful.
    try {
      const originalEnd = session.end.bind(session);
      const wrappedEnd = function() {
        push('xr-session-end-called-by-page', { stack: stackText(), session: sessionSnapshot(session) });
        return originalEnd();
      };
      session.end = wrappedEnd;
      if (session.end === wrappedEnd) push('xr-session-end-wrapper-installed', {});
      else push('xr-session-end-wrapper-not-installed', {});
    } catch (error) {
      push('xr-session-end-wrapper-failed', { error: String(error && error.stack || error) });
    }
  }

  function installXRHook() {
    if (!navigator.xr || typeof navigator.xr.requestSession !== 'function') {
      push('xr-hook-unavailable', { navigatorXR: !!navigator.xr });
      return;
    }
    const xr = navigator.xr;
    const original = xr.requestSession.bind(xr);
    if (xr.requestSession && xr.requestSession.__roomScannerD15Wrapped) {
      push('xr-hook-already-installed', {});
      return;
    }

    const wrapped = async function(mode, options) {
      const t0 = performance.now();
      const sinceGesture = lastGesture ? Math.round(t0 - lastGesture.t_ms) : null;
      const meta = {
        t0,
        mode: String(mode),
        options: safeClone(options || {}),
        activation: activationSnapshot(),
        msSinceLastGesture: sinceGesture,
        lastGesture,
        stack: stackText()
      };
      push('xr-requestSession-call', meta);
      try {
        const session = await original(mode, options);
        push('xr-requestSession-ok', {
          mode: String(mode), elapsed_ms: Math.round(performance.now() - t0),
          activation: activationSnapshot(), session: sessionSnapshot(session)
        });
        instrumentSession(session, meta);
        // D15 source patch keeps CFG.depthAIEnabled=false while the V10 startup path
        // reaches requestSession. Restore Depth only AFTER immersive-ar was actually
        // created, then wait a short grace period before ORT/Depth starts.
        try {
          if (typeof window.__ROOM_SCANNER_D15_RESTORE_DEPTH__ === 'function') {
            push('xr-depth-restore-requested', { reason: 'xr-session-created' });
            window.__ROOM_SCANNER_D15_RESTORE_DEPTH__('xr-session-created');
          }
        } catch (restoreError) {
          push('xr-depth-restore-request-failed', { error: String(restoreError && restoreError.stack || restoreError) });
        }
        return session;
      } catch (error) {
        push('xr-requestSession-failed', {
          mode: String(mode), elapsed_ms: Math.round(performance.now() - t0),
          activation: activationSnapshot(), name: error && error.name || '',
          message: error && error.message || String(error), stack: String(error && error.stack || '')
        });
        throw error;
      }
    };
    try { Object.defineProperty(wrapped, '__roomScannerD15Wrapped', { value: true }); } catch (_) {}

    let installed = false;
    try {
      xr.requestSession = wrapped;
      installed = xr.requestSession === wrapped;
    } catch (_) {}
    if (!installed) {
      try {
        const proto = Object.getPrototypeOf(xr);
        if (proto) {
          proto.requestSession = wrapped;
          installed = xr.requestSession === wrapped;
        }
      } catch (error) {
        push('xr-hook-prototype-failed', { error: String(error && error.stack || error) });
      }
    }
    push(installed ? 'xr-hook-installed' : 'xr-hook-install-failed', {
      activation: activationSnapshot(), hasXR: !!navigator.xr
    });
  }

  window.__ROOM_SCANNER_D15_XR_REPORT__ = () => ({
    schema: 'room-scanner-v11-d15-xrtrace',
    build: BUILD,
    generatedAt: new Date().toISOString(),
    href: location.href,
    activation: activationSnapshot(),
    lastGesture: safeClone(lastGesture),
    activeSession: sessionSnapshot(activeSession),
    events: events.slice()
  });

  push('xrtrace-script-start', { activation: activationSnapshot() });
  installXRHook();
})();
