(() => {
  'use strict';

  // V11-D12 targeted runtime fixes.
  // 1) Keep the XR request inside the user's activation window by bypassing only the
  //    Depth pre-check while the original V10 start handler is entering immersive AR.
  // 2) Guard the V10 photo-review renderer against the verified `rgb is not defined`
  //    regression. Capture/export data is not modified; only the crashing review UI is
  //    prevented from aborting every subsequent V10 refresh.

  const BUILD = 'room-scanner-v11-d12-xrfirst-rgbguard-2026-08-16';
  const events = [];
  const qp = new URLSearchParams(location.search);
  const permanentDepthOff = qp.get('depthoff') === '1';

  function clean(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return { text: String(value) }; }
  }

  function push(type, detail = {}) {
    const item = { iso: new Date().toISOString(), t_ms: Math.round(performance.now()), type, detail: clean(detail) };
    events.push(item);
    if (events.length > 160) events.splice(0, events.length - 160);
    try {
      localStorage.setItem('roomScannerV11D12FixTrace', JSON.stringify({ build: BUILD, href: location.href, events: events.slice(-160) }));
    } catch (_) {}
    try { window.__DEPTH_V11_D12_PUSH__ && window.__DEPTH_V11_D12_PUSH__('D12 ' + type, item.detail); } catch (_) {}
  }

  function showNotice(text) {
    let el = document.getElementById('v11D12FixNotice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'v11D12FixNotice';
      el.style.cssText = 'position:fixed;z-index:2147483646;left:8px;bottom:8px;max-width:min(92vw,720px);background:#3a2100;color:#fff1c2;border:1px solid #f0a020;border-radius:7px;padding:7px 9px;font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 3px 12px #0008';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  function isRgbRegression(error) {
    const text = String(error && (error.stack || error.message) || error || '');
    return /ReferenceError:\s*rgb is not defined|rgb is not defined/i.test(text);
  }

  function installPhotoReviewGuard() {
    try {
      if (typeof v10RenderPhotoReview !== 'function') {
        push('photo-guard-unavailable', { type: typeof v10RenderPhotoReview });
        return false;
      }
      const original = v10RenderPhotoReview;
      if (original && original.__v11d12RgbGuard) return true;

      function swallowRgb(error, phase) {
        if (!isRgbRegression(error)) throw error;
        push('photo-review-rgb-error-suppressed', { phase, error: String(error && (error.stack || error.message) || error) });
        showNotice('V11-D12: corretta la regressione UI foto (rgb non definito). I dati RAW restano attivi; anteprima problematica saltata.');
        return null;
      }

      const wrapped = function(...args) {
        try {
          const out = original.apply(this, args);
          if (out && typeof out.then === 'function') return out.catch(error => swallowRgb(error, 'async'));
          return out;
        } catch (error) {
          return swallowRgb(error, 'sync');
        }
      };
      Object.defineProperty(wrapped, '__v11d12RgbGuard', { value: true });
      v10RenderPhotoReview = wrapped;
      push('photo-guard-installed', {});
      return true;
    } catch (error) {
      push('photo-guard-install-failed', { error: String(error && (error.stack || error.message) || error) });
      return false;
    }
  }

  function installXrFirstStart() {
    try {
      const button = document.getElementById('v10Start');
      if (!button || typeof button.onclick !== 'function') {
        push('xr-first-start-unavailable', { hasButton: !!button, onclickType: button && typeof button.onclick });
        return false;
      }
      const original = button.onclick;
      if (original && original.__v11d12XrFirst) return true;

      const wrapped = async function(event) {
        let canToggle = false;
        let previousDepthEnabled = null;
        try {
          // CFG is a global lexical binding in the existing classic V10 script. A later
          // classic script can read/mutate its object properties even though CFG itself
          // is declared with `const`.
          canToggle = typeof CFG !== 'undefined' && CFG && Object.prototype.hasOwnProperty.call(CFG, 'depthAIEnabled');
          if (canToggle) {
            previousDepthEnabled = !!CFG.depthAIEnabled;
            if (!permanentDepthOff) CFG.depthAIEnabled = false;
          }
          push('xr-first-start-enter', {
            permanentDepthOff,
            canToggle,
            previousDepthEnabled,
            activation: navigator.userActivation ? { isActive: !!navigator.userActivation.isActive, hasBeenActive: !!navigator.userActivation.hasBeenActive } : null
          });

          // Call the untouched V10 handler. With the pre-check temporarily disabled it
          // reaches requestSession immediately, as verified by the D11 Depth-OFF trace.
          return await original.call(this, event);
        } catch (error) {
          push('xr-first-original-handler-failed', { error: String(error && (error.stack || error.message) || error) });
          throw error;
        } finally {
          if (canToggle && !permanentDepthOff) {
            CFG.depthAIEnabled = previousDepthEnabled;
            push('xr-first-depth-restored', { depthAIEnabled: !!CFG.depthAIEnabled });

            // Create only the V10 Depth worker after XR entry. This is intentionally
            // lightweight: no forced smoke inference is launched here. Existing V10
            // lazy processing remains responsible for model initialization/inference.
            setTimeout(() => {
              try {
                if (typeof ensureDepthAIWorker === 'function') {
                  const hadWorker = typeof S !== 'undefined' && S && S.depthAI && !!S.depthAI.worker;
                  if (!hadWorker) ensureDepthAIWorker();
                  const hasWorker = typeof S !== 'undefined' && S && S.depthAI && !!S.depthAI.worker;
                  push('post-xr-depth-worker-ensure', { hadWorker, hasWorker });
                } else {
                  push('post-xr-depth-worker-ensure-unavailable', { type: typeof ensureDepthAIWorker });
                }
              } catch (error) {
                push('post-xr-depth-worker-ensure-failed', { error: String(error && (error.stack || error.message) || error) });
              }
            }, 1500);
          }
        }
      };
      Object.defineProperty(wrapped, '__v11d12XrFirst', { value: true });
      button.onclick = wrapped;
      push('xr-first-start-installed', { permanentDepthOff });
      return true;
    } catch (error) {
      push('xr-first-start-install-failed', { error: String(error && (error.stack || error.message) || error) });
      return false;
    }
  }

  function install() {
    push('fix-script-start', { build: BUILD, permanentDepthOff });
    const photo = installPhotoReviewGuard();
    const xrFirst = installXrFirstStart();
    push('fix-script-ready', { photoGuard: photo, xrFirst });
  }

  window.__ROOM_SCANNER_D12_FIX_REPORT__ = () => ({
    schema: 'room-scanner-v11-d12-fixtrace',
    build: BUILD,
    href: location.href,
    permanentDepthOff,
    events: events.slice()
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
