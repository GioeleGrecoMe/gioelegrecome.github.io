/**
 * Room Scanner V30.19.0 live Depth Anything preview controller.
 *
 * This module intentionally does NOT modify AlvaAR, keyframe selection or the
 * dense mapper. It only gives the neural preview its own ~1 Hz clock using the
 * latest CameraController frame. Dense/keyframe inference keeps priority in the
 * worker, so a preview can never disable or block geometry reconstruction.
 */
const TICK_MS = 1000;
const WATCHDOG_MS = 12000;

let attachedWorker = null;
let inFlightJob = null;
let inFlightAt = 0;
let lastSentAt = 0;
let sequence = 0;

const $ = id => document.getElementById(id);

function room() {
  return globalThis.RoomScanV30 || null;
}

function isScanVisible() {
  return $('scan')?.classList?.contains('active') === true;
}

function heatColor(t) {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * Math.max(0, Math.min(1, 1.8 - Math.abs(4 * x - 3))));
  const g = Math.round(255 * Math.max(0, Math.min(1, 1.8 - Math.abs(4 * x - 2))));
  const b = Math.round(255 * Math.max(0, Math.min(1, 1.8 - Math.abs(4 * x - 1))));
  return [r, g, b];
}

function drawDepth(canvas, raw, width, height) {
  if (!canvas || !raw?.length || !(width > 1 && height > 1)) return;
  const finite = [];
  for (const v of raw) if (Number.isFinite(v)) finite.push(v);
  if (finite.length < 8) return;
  finite.sort((a, b) => a - b);
  const lo = finite[Math.floor(finite.length * 0.03)];
  const hi = finite[Math.floor(finite.length * 0.97)];
  if (!(hi > lo)) return;

  const tiny = document.createElement('canvas');
  tiny.width = width;
  tiny.height = height;
  const tg = tiny.getContext('2d');
  const image = tg.createImageData(width, height);
  const count = Math.min(raw.length, width * height);
  for (let i = 0; i < count; i++) {
    const j = i * 4;
    if (!Number.isFinite(raw[i])) {
      image.data[j + 3] = 0;
      continue;
    }
    const c = heatColor((raw[i] - lo) / (hi - lo));
    image.data[j] = c[0];
    image.data[j + 1] = c[1];
    image.data[j + 2] = c[2];
    image.data[j + 3] = 205;
  }
  tg.putImageData(image, 0, 0);

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const cw = Math.max(1, Math.round(rect.width * dpr) || width);
  const ch = Math.max(1, Math.round(rect.height * dpr) || height);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, cw, ch);
  g.imageSmoothingEnabled = true;
  g.drawImage(tiny, 0, 0, cw, ch);
}

function modelForPreview(state, config) {
  const selected = state.deepModel;
  if (selected?.bytes) {
    return state.deepWorkerModelId === selected.id
      ? { id: selected.id, label: selected.label }
      : { id: selected.id, label: selected.label, bytes: selected.bytes.slice(0) };
  }
  if (selected?.url) return { id: selected.id, label: selected.label, url: selected.url };

  // Keep the same default ID used by app.js so a model warmed by the pre-scan
  // test is reused instead of creating a second ONNX session.
  return {
    id: 'bundled-depth-anything-v2-small-q4',
    label: config.deepModelLabel || 'Depth Anything V2 Small Q4 locale',
    url: new URL(`../${config.deepModelUrl}`, import.meta.url).href,
  };
}

function setModelStatus(text, kind = '') {
  const el = $('deepModelStatus');
  if (!el) return;
  if (kind) el.dataset.kind = kind;
  el.textContent = text;
}

function attachWorker(worker) {
  if (!worker || worker === attachedWorker) return;
  attachedWorker = worker;
  worker.addEventListener('message', event => {
    const d = event.data || {};

    if (d.type === 'deep-download-progress') {
      const mb = (Number(d.received || 0) / 1048576).toFixed(1);
      const total = d.total ? ` / ${(d.total / 1048576).toFixed(1)} MB` : '';
      const pct = Number.isFinite(d.pct) ? ` · ${d.pct}%` : '';
      setModelStatus(`${d.label || 'Carico modello locale'}: ${mb}${total}${pct}…`);
      return;
    }
    if (d.type === 'deep-model-cache-hit') {
      setModelStatus('Modello ONNX trovato nella cache locale del browser. Avvio inferenza…');
      return;
    }
    if (d.type === 'deep-diag' && d.event === 'webgpu-disabled') {
      setModelStatus(`WebGPU non coerente: ${d.message}`, 'ok');
      return;
    }

    const own = String(d.jobId || '').startsWith('preview-ticker-');
    if (!own) return;

    if (d.type === 'deep-result') {
      inFlightJob = null;
      inFlightAt = 0;
      drawDepth($('depthOverlay'), d.rawDepth, d.rawWidth, d.rawHeight);
      const hud = $('mvsState');
      if (hud) {
        const src = d.frameSignature || '--------';
        const z = d.depthSignature || '--------';
        const io = `${d.preprocessBackend?.includes('fromImage') ? 'ORT-img' : 'manual-img'}/${d.outputReadback || 'read'}`;
        hud.textContent = `AI LIVE ${d.provider} · ${d.rawWidth}x${d.rawHeight} · ${Number(d.ms || 0).toFixed(0)} ms · ${io} · src ${src} -> z ${z}`;
      }
      return;
    }

    if (d.type === 'deep-preview-error') {
      inFlightJob = null;
      inFlightAt = 0;
      const hud = $('mvsState');
      if (hud) hud.textContent = `AI preview: ${d.message || 'errore temporaneo'} · Alva continua`;
      return;
    }
  });
}

function maybeSendPreview(now) {
  const ctx = room();
  if (!ctx) return;
  const { state, CONFIG } = ctx;
  const worker = state.deepDepthWorker;
  attachWorker(worker);

  if (!isScanVisible() || !state.camera || !worker || state.deepDisabled) return;

  if (inFlightJob && now - inFlightAt > WATCHDOG_MS) {
    inFlightJob = null;
    inFlightAt = 0;
  }
  if (inFlightJob) return;

  // Geometry/keyframe inference always wins. The preview waits for the neural
  // worker to be free but is independent from whether Alva created a keyframe.
  if (state.deepPending || state.deepLivePending) return;
  if (now - lastSentAt < (CONFIG.deepInferenceIntervalMs || TICK_MS)) return;

  const frame = state.camera.capture?.();
  if (!frame?.rgba?.length) return;

  lastSentAt = now;
  // Suppress app.js's redundant keyframe-only preview request for the same 1 s
  // window. This does not suppress the selected AI inference used by 3D fusion.
  state.deepLastRequestAt = now;

  const jobId = `preview-ticker-${++sequence}`;
  inFlightJob = jobId;
  inFlightAt = now;
  const rgba = new Uint8ClampedArray(frame.rgba);
  worker.postMessage({
    type: 'infer',
    jobId,
    refId: jobId,
    model: modelForPreview(state, CONFIG),
    rgba,
    width: frame.width,
    height: frame.height,
  }, [rgba.buffer]);
}

const timer = setInterval(() => maybeSendPreview(performance.now()), 125);
addEventListener('pagehide', () => clearInterval(timer), { once: true });

// Useful from the phone debug console/log export without exposing mutable model data.
globalThis.RoomScanDepthLive = {
  get status() {
    return { attached: !!attachedWorker, inFlightJob, lastSentAt, sequence };
  },
};
