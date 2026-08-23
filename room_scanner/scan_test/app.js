// This identifier is deliberately present in the UI, diagnostic export and URLs.
// It makes a stale GitHub Pages/service-worker cache immediately recognizable.
const BUILD_ID = 'scan-test-v3.4.1-deep-processor-compat';

import { AlvaAR } from './vendor/alva_ar.js?v=scan-test-v3.4.1';
import { CameraController, intrinsicsForCrop } from './camera.js?v=scan-test-v3.4.1';
import { detectScanFeatures, matchArchivedFrames } from './feature_matching.js?v=scan-test-v3.4.1';

/*
 * Scan Test is deliberately separate from V30.  Its contract is intentionally
 * narrow: archive complete RGB frames + Alva poses, replay them, align only
 * relative depths, then display the raw regularly-decimated image pixels.
 * There is no surfel fusion, TSDF, mesh extraction, semantic selection or
 * confidence-driven culling in this experiment.
 */

// Alva receives the complete source frame with its native orientation/aspect
// ratio. Alva is much more stable when feature cells are not starved, so the
// analysis raster uses a 960 px long side (upscaling low-resolution videos as
// needed). Deep remains independent and performs a 336-px browser diagnostic profile
// through DPTImageProcessor; this reduces mobile WASM work without touching Alva.
let W = 0;
let H = 0;
const ANALYSIS_LONG_SIDE = 960;
const DEFAULT_ALVA_HZ = 12;
// AlvaAR must receive the camera cadence, not the archive cadence. The camera
// constraint is capped at 30 fps; using 60 here simply removes the controller's
// software throttle so requestVideoFrameCallback can deliver every presented frame.
const LIVE_TRACKER_HZ = 60;
const LIVE_BOOTSTRAP_ARCHIVE_MAX_FRAMES = 24;
// Uploaded videos are consumed by their actual decoded frame cadence when the
// browser exposes requestVideoFrameCallback. This rate is only a compatibility
// fallback for older browsers that can advance a file only through time seeks.
const FILE_FALLBACK_FPS = 30;
const FILE_BOOTSTRAP_PLAYBACK_RATE = .0625;
const FILE_STEADY_PLAYBACK_RATE = .25;
const FILE_BOOTSTRAP_MEDIA_SECONDS = 2.0;
const PRE_ROLL_MAX_FRAMES = 12;
const FILE_INIT_ARCHIVE_MAX_FRAMES = 90;
const MAX_FRAME_MEMORY = 260 * 1024 * 1024;
const $ = id => document.getElementById(id);
const dom = Object.freeze({
  camera: $('camera'), overlay: $('cameraOverlay'), log: $('log'), globalState: $('globalState'),
  runtimeStatus: $('runtimeStatus'), trackingBadge: $('trackingBadge'), captureCoach: $('captureCoach'),
  frameStrip: $('frameStrip'), frameTemplate: $('frameTemplate'), archiveState: $('archiveState'),
  poseCount: $('poseCount'), frameCount: $('frameCount'), liveFeatures: $('liveFeatures'), memoryCount: $('memoryCount'),
  offlineBadge: $('offlineBadge'), offlineMetrics: $('offlineMetrics'), trajectoryCanvas: $('trajectoryCanvas'),
  planeBadge: $('planeBadge'), planeMetrics: $('planeMetrics'), planeCanvas: $('planeCanvas'),
  deepBadge: $('deepBadge'), deepMetrics: $('deepMetrics'), depthCanvas: $('depthCanvas'),
  deepDiagnostic: $('deepDiagnostic'), deepSourceCanvas: $('deepSourceCanvas'), deepTensorCanvas: $('deepTensorCanvas'), deepOutputCanvas: $('deepOutputCanvas'), deepReport: $('deepReport'),
  viewerBadge: $('viewerBadge'), viewerMetrics: $('viewerMetrics'), splatCanvas: $('splatCanvas'),
  gridStepOut: $('gridStepOut'), confidenceOut: $('confidenceOut'),
  liveLogDock: $('liveLogDock'), livePhase: $('livePhase'), liveElapsed: $('liveElapsed'), liveActivity: $('liveActivity'), liveLogTail: $('liveLogTail'), liveLogToggle: $('liveLogToggle'),
});

const S = {
  capture: null, source: null, sourceObjectUrl: null,
  alva: null, K: null, current: null, livePose: null, liveMatrix: null, livePoints: [],
  trackingStarted: false, trackingSamples: 0, trackingPoses: 0,
  recording: false, frames: [], preRoll: [], frameBytes: 0, edges: [], depthEdges: [], offlineTrackerPoints: [],
  selectedFrame: null, offlineDone: false, deepDone: false, finalDone: false,
  deepWorker: null, deepWaiters: new Map(), deepContract: null, splats: null, planeSplats: null,
  lastDepthFrame: null, viewToken: 0, lastResult: null, fileDecodeStats: null,
  lastLiveArchiveAt: -Infinity, liveArchiveSamplesSinceRecord: 0, offlineFovDeg: null, trackerFovDeg: 45, trackerFovSweep: null,
};

function nowText() { return new Date().toLocaleTimeString('it-IT', { hour12: false }); }
const LIVE_LOG_ROWS = [];
const ACTIVITY = { phase: 'AVVIO', detail: 'Inizializzazione applicazione...', state: 'busy', since: performance.now(), deepHeartbeatAt: 0 };
function renderActivityClock() {
  if (!dom.liveElapsed) return;
  const elapsed = Math.max(0, performance.now() - ACTIVITY.since) / 1000;
  dom.liveElapsed.textContent = `${elapsed.toFixed(elapsed < 10 ? 1 : 0)} s`;
}
function setActivity(phase, detail = '', state = 'busy') {
  ACTIVITY.phase = String(phase || 'ATTIVITA');
  ACTIVITY.detail = String(detail || '');
  ACTIVITY.state = state || 'busy';
  ACTIVITY.since = performance.now();
  if (dom.livePhase) dom.livePhase.textContent = ACTIVITY.phase;
  if (dom.liveActivity) dom.liveActivity.textContent = ACTIVITY.detail;
  if (dom.liveLogDock) dom.liveLogDock.dataset.state = ACTIVITY.state;
  renderActivityClock();
}
function log(event, data = null, level = 'INFO') {
  let serialized = '';
  try { serialized = data == null ? '' : ` ${JSON.stringify(data)}`; } catch { serialized = ' [dati non serializzabili]'; }
  const row = `${nowText()} ${level.padEnd(5)} ${event}${serialized}`;
  dom.log.textContent = `${row}\n${dom.log.textContent}`.slice(0, 55000);
  LIVE_LOG_ROWS.unshift(row); if (LIVE_LOG_ROWS.length > 8) LIVE_LOG_ROWS.length = 8;
  if (dom.liveLogTail) dom.liveLogTail.textContent = LIVE_LOG_ROWS.join('\n');
  if (level === 'ERROR' && ACTIVITY.state !== 'error') setActivity('ERRORE', `${event}${data?.message ? `: ${data.message}` : ''}`, 'error');
  console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'info'](`[scan_test] ${event}`, data || '');
}
setInterval(renderActivityClock, 500);
function errorText(err) { return err?.message || String(err); }
function setGlobal(text, kind = '') { dom.globalState.textContent = text; dom.globalState.className = `state-pill ${kind}`; }
function setBadge(el, text, kind = '') { el.textContent = text; el.className = `tag ${kind}`; }
function setStep(n) {
  for (const el of document.querySelectorAll('#stepList li')) {
    const step = Number(el.dataset.step);
    el.classList.toggle('done', step < n);
    el.classList.toggle('current', step === n);
  }
}
function numberValue(id, fallback) { const v = Number($(id).value); return Number.isFinite(v) ? v : fallback; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function median(values) {
  const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length & 1 ? a[m] : (a[m - 1] + a[m]) * .5;
}
function percentile(values, p) {
  const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
  return a.length ? a[Math.round(clamp(p, 0, 1) * (a.length - 1))] : NaN;
}
function fmt(v, digits = 2) { return Number.isFinite(v) ? Number(v).toFixed(digits) : '—'; }
function nextPaint() { return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))); }
function intrinsics(geometry) { const fovDeg = clamp(numberValue('fovInput', 60), 35, 110); return { ...intrinsicsForCrop(null, geometry, { fallbackFovDeg: fovDeg }), fovDeg }; }
function clonePose(p) { return p ? { p: p.p.slice(), q: p.q.slice() } : null; }
function qNormalize(q) { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map(v => v / n); }
function qConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
function qMul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; }
function qRotate(q, v) { const r = qMul(qMul(q, [v[0], v[1], v[2], 0]), qConj(q)); return [r[0], r[1], r[2]]; }
function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map(x => -x) : b; d = Math.abs(d);
  if (d > .9995) return qNormalize(a.map((x, i) => x + t * (bb[i] - x)));
  const th = Math.acos(clamp(d, -1, 1)), s = Math.sin(th);
  return qNormalize(a.map((x, i) => (Math.sin((1 - t) * th) * x + Math.sin(t * th) * bb[i]) / s));
}
function alvaMatrixToPose(a) {
  if (!a || a.length < 16) return null;
  const m11 = +a[0], m12 = +a[4], m13 = +a[8], m21 = +a[1], m22 = +a[5], m23 = +a[9], m31 = +a[2], m32 = +a[6], m33 = +a[10];
  const tr = m11 + m22 + m33; let x, y, z, w, s;
  if (tr > 0) { s = .5 / Math.sqrt(tr + 1); w = .25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s; }
  else if (m11 > m22 && m11 > m33) { s = 2 * Math.sqrt(1 + m11 - m22 - m33); w = (m32 - m23) / s; x = .25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s; }
  else if (m22 > m33) { s = 2 * Math.sqrt(1 + m22 - m11 - m33); w = (m13 - m31) / s; x = (m12 + m21) / s; y = .25 * s; z = (m23 + m32) / s; }
  else { s = 2 * Math.sqrt(1 + m33 - m11 - m22); w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = .25 * s; }
  // Same-camera convention as V30: +X right, +Y down, +Z forward.
  return { p: [+a[12], -a[13], -a[14]], q: qNormalize([x, -y, -z, w]) };
}
function poseDistance(a, b) { return a && b ? Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]) : NaN; }
function poseAngle(a, b) { if (!a || !b) return NaN; const d = Math.abs(a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3]); return 2 * Math.acos(clamp(d, -1, 1)); }

function liveArchiveDue(raster) {
  const archiveHz = clamp(numberValue('archiveFps', DEFAULT_ALVA_HZ), 3, 15);
  const denseBootstrap = S.trackingPoses === 0 && S.liveArchiveSamplesSinceRecord < LIVE_BOOTSTRAP_ARCHIVE_MAX_FRAMES;
  const dueByTime = !Number.isFinite(S.lastLiveArchiveAt) || raster.at - S.lastLiveArchiveAt >= (1000 / archiveHz) * .92;
  if (!(denseBootstrap || dueByTime)) return false;
  S.lastLiveArchiveAt = raster.at;
  S.liveArchiveSamplesSinceRecord++;
  return true;
}
function sampleLiveTracker(raster, { archive = true } = {}) {
  let matrix = null, points = [];
  try { const raw = S.alva?.findCameraPose(raster.imageData); if (raw?.length >= 16) matrix = Array.from(raw, Number).slice(0, 16); points = compactAlvaPoints(S.alva?.getFramePoints?.()); }
  catch (err) { log('alvaar-live-call', { message: errorText(err) }, 'WARN'); }
  S.trackingSamples++;
  S.liveMatrix = matrix;
  S.livePose = alvaMatrixToPose(matrix);
  S.livePoints = points;
  if (S.livePose) S.trackingPoses++;
  drawLiveOverlay(points, S.livePose);
  const init = !S.livePose && S.trackingPoses === 0;
  setBadge(dom.trackingBadge, S.livePose ? `AlvaAR · ${points.length} punti` : init ? `AlvaAR inizializza · ${points.length} punti` : 'AlvaAR senza posa', S.livePose ? 'ok' : 'warn');
  dom.liveFeatures.textContent = String(points.length);
  // Tracking cadence and storage cadence are deliberately decoupled. Alva sees
  // every presented camera frame; only the immutable archive is throttled.
  // Before the first pose we keep a short dense bootstrap so an offline tracker
  // can reproduce initialization instead of receiving an 8–12 fps sequence.
  if (S.recording) { if (archive && liveArchiveDue(raster)) archiveFrame(raster, { phase: S.trackingPoses ? 'scan' : 'alva-warmup' }); }
  else rememberPreRoll(raster);
}
function drawLiveOverlay(points, pose) {
  const c = dom.overlay; if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d'); g.clearRect(0, 0, W, H);
  g.fillStyle = pose ? '#67f4b0' : '#ffd36e';
  for (const p of points.slice(0, 260)) { const x = Number(p?.x), y = Number(p?.y); if (!Number.isFinite(x + y)) continue; g.fillRect(x - 1, y - 1, 3, 3); }
  g.fillStyle = '#e8f4ff'; g.font = '10px ui-monospace,monospace'; g.fillText(pose ? `P ${pose.p.map(v => v.toFixed(2)).join(', ')}` : 'ALVA: attendo prima posa', 7, 14);
}
function handleCaptureFrame(frame, options = undefined) { S.current = frame; sampleLiveTracker(frame, options); }
function compactAlvaPoints(points) {
  const out = [], seen = new Set();
  for (const point of Array.from(points || [])) {
    const x = Number(point?.x), y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 7 || y < 7 || x >= W - 7 || y >= H - 7) continue;
    const key = `${Math.round(x / 3)}:${Math.round(y / 3)}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ x, y, score: Number(point?.score) || 0 });
    if (out.length >= 720) break;
  }
  return out;
}
function trackingSnapshot() { return { liveMatrix: S.liveMatrix?.slice() || null, livePose: clonePose(S.livePose), alvaPoints: S.livePoints.map(p => ({ ...p })) }; }
function rememberPreRoll(raster) {
  const snapshot = trackingSnapshot();
  S.preRoll.push({ ...raster, rgba: new Uint8ClampedArray(raster.rgba), gray: new Uint8Array(raster.gray), geometry: { ...raster.geometry }, ...snapshot });
  if (S.preRoll.length > PRE_ROLL_MAX_FRAMES) S.preRoll.shift();
}
function archiveFrame(raster, { phase = 'scan' } = {}) {
  if (S.frameBytes + raster.rgba.byteLength + raster.gray.byteLength > MAX_FRAME_MEMORY) {
    S.recording = false; $('stopBtn').disabled = true; $('recordBtn').disabled = true;
    dom.captureCoach.textContent = 'Limite di memoria raggiunto: immagini già archiviate e conservate. Procedi con la rielaborazione.';
    log('archive-memory-limit', { bytes: S.frameBytes, max: MAX_FRAME_MEMORY }, 'WARN'); return;
  }
  const alvaPoints = raster.alvaPoints?.map(p => ({ ...p })) || S.livePoints.map(p => ({ ...p }));
  const features = detectScanFeatures(raster.gray, W, H, alvaPoints);
  const index = S.frames.length;
  const frame = { id: `frame-${String(index).padStart(4, '0')}`, sourceFrameId: raster.frameId, index, at: raster.at, mediaTime: raster.mediaTime, width: W, height: H, source: raster.source || S.source,
    rgba: new Uint8ClampedArray(raster.rgba), gray: new Uint8Array(raster.gray), K: { ...S.K }, geometry: { ...raster.geometry },
    phase, liveMatrix: raster.liveMatrix?.slice() || S.liveMatrix?.slice() || null, livePose: clonePose(raster.livePose || S.livePose), livePoints: alvaPoints.length, liveAlvaPoints: alvaPoints, features,
    offlineMatrix: null, offlinePose: null, offlinePoints: [], pose: null, poseSource: 'unresolved', poseConfidence: 0, deep: null };
  S.frames.push(frame); S.frameBytes += frame.rgba.byteLength + frame.gray.byteLength + features.length * 48;
  appendThumb(frame); updateArchiveUi();
  if (index % 8 === 0) log('frame-archived', { id: frame.id, phase, livePose: !!frame.livePose, alvaPoints: alvaPoints.length, features: features.length, total: S.frames.length });
}
function appendThumb(frame) {
  const node = dom.frameTemplate.content.firstElementChild.cloneNode(true), c = node.querySelector('canvas'), g = c.getContext('2d');
  const tmp = document.createElement('canvas'); tmp.width = frame.width; tmp.height = frame.height;
  tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
  g.fillStyle = '#050c15'; g.fillRect(0, 0, c.width, c.height);
  const scale = Math.min(c.width / frame.width, c.height / frame.height), dw = frame.width * scale, dh = frame.height * scale;
  g.drawImage(tmp, (c.width - dw) * .5, (c.height - dh) * .5, dw, dh);
  node.querySelector('span').textContent = `${frame.index + 1} · ${frame.livePose ? 'P' : '—'} · ${frame.features.length}k`;
  node.addEventListener('click', () => { S.selectedFrame = frame.index; for (const x of dom.frameStrip.querySelectorAll('.selected')) x.classList.remove('selected'); node.classList.add('selected'); if (frame.deep) { S.lastDepthFrame = frame; drawDepth(frame.deep); } });
  dom.frameStrip.querySelector('.empty')?.remove(); dom.frameStrip.append(node);
}
function updateArchiveUi() {
  const poses = S.frames.filter(f => f.livePose).length;
  dom.poseCount.textContent = String(S.trackingPoses); dom.frameCount.textContent = String(S.frames.length); dom.memoryCount.textContent = `${(S.frameBytes / 1048576).toFixed(1)} MB`;
  dom.archiveState.textContent = `${S.frames.length} / ${poses} pose`;
}

async function startCaptureSource({ source, label, url = null, autoRecord = false, cameraAuthorized = false } = {}) {
  if (S.trackingStarted) throw new Error('Una sorgente è già attiva. Azzera la sessione prima di cambiarla.');
  if (source === 'camera' && !navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia non è disponibile: apri questa pagina da HTTPS o localhost.');
  setGlobal(`Apro ${label}…`);
  setActivity('SORGENTE · APERTURA', `Apro ${label} e leggo le dimensioni native...`, 'busy');
  dom.runtimeStatus.textContent = `Preparo ${label}: prima leggo le dimensioni reali del video, poi inizializzo Alva sullo stesso aspect ratio.`;
  if (url) { dom.camera.srcObject = null; dom.camera.src = url; dom.camera.loop = false; dom.camera.muted = true; dom.camera.playsInline = true; }
  const archiveHz = clamp(numberValue('archiveFps', DEFAULT_ALVA_HZ), 3, 15);
  const capture = new CameraController({ video: dom.camera, longSide: ANALYSIS_LONG_SIDE, fps: source === 'camera' ? LIVE_TRACKER_HZ : archiveHz, source, cameraAuthorized: source !== 'camera' || cameraAuthorized === true, log: { info: (event, data) => log(event, data), warn: (event, data) => log(event, data, 'WARN') } });
  await capture.start({ autoplay: source !== 'file' });
  W = capture.width; H = capture.height;
  if (!(W >= 2 && H >= 2)) { capture.stop(); throw new Error(`Raster Alva non valido: ${W}×${H}`); }
  S.capture = capture; S.source = source; S.K = intrinsics(capture.geometry);
  // Official AlvaAR usage: initialize on the exact raster that will be passed to
  // findCameraPose(). Do not force portrait sources into a landscape 4:3 crop.
  S.trackerFovDeg = 45;
  setActivity('ALVA · INIT', `Inizializzo AlvaAR su raster ${W}×${H} · fovA ${S.trackerFovDeg}°...`, 'busy');
  S.alva = await AlvaAR.Initialize(W, H, S.trackerFovDeg);
  if (!S.alva?.findCameraPose) { capture.stop(); S.capture = null; throw new Error('AlvaAR.Initialize non ha restituito un tracker valido.'); }
  S.trackingStarted = true;
  capture.addEventListener('ended', () => {
    if (S.recording) stopRecording({ reason: 'video-ended' });
    $('recordBtn').disabled = true;
    dom.captureCoach.textContent = `Il video è terminato: ${S.frames.length} frame sono disponibili per la riesecuzione offline.`;
    setGlobal('Video terminato · archivio pronto'); log('capture-source-ended', { source, frames: S.frames.length });
  });
  if (source === 'file') {
    startRecording();
    void processUploadedVideo(capture).catch(err => {
      log('uploaded-video-processing-failed', { message:errorText(err) }, 'ERROR');
      dom.runtimeStatus.textContent = `Lettura video fallita: ${errorText(err)}`;
      setGlobal('Errore lettura video', 'fail');
      if (S.recording) stopRecording({ reason:'file-processing-error' });
    });
  } else capture.loop(handleCaptureFrame);
  $('openCameraBtn').disabled = true; $('fixtureBtn').disabled = true; $('videoFile').disabled = true; $('recordBtn').disabled = source === 'file' || S.recording; $('testDeepBtn').disabled = false; $('fovInput').disabled = true; $('archiveFps').disabled = true;
  const exactAspect = Math.abs((capture.geometry.sourceWidth / capture.geometry.sourceHeight) - (W / H)) < 1e-3;
  dom.runtimeStatus.textContent = `${label} pronto · sorgente ${dom.camera.videoWidth}×${dom.camera.videoHeight} → Alva ${W}×${H} · frame completo, crop 0% · Deep su richiesta.`;
  dom.captureCoach.textContent = source === 'file' ? 'Video caricato: ogni frame decodificato viene passato ad Alva nello stesso orientamento/aspect ratio del file. Deep non parte automaticamente: prima puoi verificare separatamente le pose.' : 'Muovi lentamente la camera con parallasse. Il raster Alva conserva orientamento e intero campo visivo della camera.';
  setGlobal(`${label} + AlvaAR pronti`, 'ok'); setStep(2);
  setActivity('ALVA · PRONTO', `${label} · raster ${W}×${H} · in attesa/acquisizione`, 'ok');
  log('capture-source-ready', { source, K: S.K, trackerInit:'AlvaAR.Initialize(width,height,trackerFovDeg)', trackerFovDeg:S.trackerFovDeg, trackerRaster:[W,H], trackerTargetHz: source === 'camera' ? LIVE_TRACKER_HZ : 'continuous-native-decoder', archiveHz, geometry: capture.geometry, sourceVideo: { width: dom.camera.videoWidth, height: dom.camera.videoHeight }, exactAspectPreserved:exactAspect, autoRecord });
  if (autoRecord && !S.recording) startRecording();
}
async function openCamera() {
  const approved = window.confirm('Vuoi autorizzare l’uso della camera posteriore per questa sessione? Verrà chiesto anche il permesso dal browser. Il video non viene caricato automaticamente: resta nella memoria della sessione finché non scarichi una diagnostica.');
  if (!approved) { setGlobal('Camera non autorizzata'); log('camera-consent-declined'); return; }
  await startCaptureSource({ source: 'camera', label: 'camera posteriore', cameraAuthorized: true });
}
async function startFixture() { await startCaptureSource({ source: 'file', label: 'fixture dinamico AlvaAR', url: new URL('./fixtures/alva_dynamic_regression.mp4', location.href).href, autoRecord: true }); }
async function chooseVideo(file) {
  if (!file) return;
  const url = URL.createObjectURL(file); S.sourceObjectUrl = url;
  try { await startCaptureSource({ source: 'file', label: `video ${file.name}`, url, autoRecord: true }); }
  catch (err) { URL.revokeObjectURL(url); S.sourceObjectUrl = null; throw err; }
}
async function processUploadedVideo(capture) {
  const video = dom.camera, duration = Number(video.duration);
  if (!(duration > 0 && Number.isFinite(duration))) throw new Error('Il file video non espone una durata valida.');
  video.pause();
  try { video.currentTime = 0; } catch {}
  const nativeFrames = typeof video.requestVideoFrameCallback === 'function';
  const requestedArchiveFps = clamp(numberValue('archiveFps', DEFAULT_ALVA_HZ), 3, 15);
  // Tracking and storage must not share the same cadence. A full analysis frame costs
  // ~1.5 MB as RGBA+gray, so archiving every 30-fps decoded frame exhausts the
  // 260 MB budget in only a few seconds. Alva still sees every unique decoded
  // frame; we retain a dense bootstrap until its first pose and then adapt the
  // archive cadence to the remaining memory and video duration.
  const estimatedFrameBytes = W * H * 5 + 720 * 48;
  const maxArchiveFrames = Math.max(12, Math.floor(MAX_FRAME_MEMORY * .90 / estimatedFrameBytes));
  const bootstrapCap = Math.max(8, Math.min(FILE_INIT_ARCHIVE_MAX_FRAMES, maxArchiveFrames - 8));

  setGlobal('Video: decodifica sequenziale AlvaAR…', '');
  setActivity('VIDEO · DECODIFICA', `Avvio decoder continuo · durata ${duration.toFixed(2)} s · Alva ${W}×${H}`, 'busy');
  dom.runtimeStatus.textContent = nativeFrames
    ? 'Leggo i frame realmente presentati dal decoder. AlvaAR vede ogni frame unico; l’archivio viene diradato solo dopo il bootstrap.'
    : `requestVideoFrameCallback non disponibile: fallback seek a ${FILE_FALLBACK_FPS} fps con controllo firma frame.`;
  log('uploaded-video-native-decode-start', { duration, mode:nativeFrames?'continuous-requestVideoFrameCallback':'seek-fallback', fallbackFps:FILE_FALLBACK_FPS, requestedArchiveFps, maxArchiveFrames, bootstrapCap, alvaRaster:[W,H], source:S.source });

  let decodedCallbacks = 0, uniqueFrames = 0, lastMediaTime = -Infinity, lastSignature = null, repeatedContent = 0;
  let lastArchiveMediaTime = -Infinity, firstPoseDecodedFrame = null, firstPoseMediaTime = null;

  const consumeFrame = (frame) => {
    decodedCallbacks++;
    if (frame.frameSignature === lastSignature) {
      repeatedContent++;
      lastMediaTime = Math.max(lastMediaTime, Number(frame.mediaTime) || lastMediaTime);
      return false;
    }
    lastSignature = frame.frameSignature;
    lastMediaTime = frame.mediaTime;
    uniqueFrames++;

    // Run Alva on every unique decoded frame, but defer the storage decision
    // until after this call so the first valid pose is guaranteed to be saved.
    handleCaptureFrame(frame, { archive:false });
    const firstPoseNow = !!S.livePose && firstPoseDecodedFrame == null;
    if (firstPoseNow) { firstPoseDecodedFrame = uniqueFrames; firstPoseMediaTime = frame.mediaTime; }

    const bootstrap = firstPoseDecodedFrame == null && S.frames.length < bootstrapCap;
    const remainingSlots = Math.max(0, maxArchiveFrames - S.frames.length);
    const remainingSeconds = Math.max(.05, duration - frame.mediaTime);
    const adaptiveFps = Math.max(.05, Math.min(requestedArchiveFps, remainingSlots / remainingSeconds));
    const archivePeriod = 1 / adaptiveFps;
    const due = firstPoseNow || bootstrap || !S.frames.length || frame.mediaTime - lastArchiveMediaTime >= archivePeriod * .92 || frame.mediaTime >= duration - .04;
    if (S.recording && remainingSlots > 0 && due) {
      archiveFrame(frame, { phase:firstPoseDecodedFrame == null ? 'alva-warmup' : 'scan' });
      lastArchiveMediaTime = frame.mediaTime;
    }
    return true;
  };

  if (nativeFrames) {
    // IMPORTANT: keep one playback session alive for the entire file. The old
    // play()/pause() per-frame stepping can skip Alva's initialization frames.
    // consumeDecodedFrames() also captures the already-decoded t=0 frame before
    // calling play() and slows media time so synchronous Alva work can keep up.
    // Mobile-safe bootstrap: requestVideoFrameCallback is a presentation callback,
    // not a decoder queue. If synchronous Alva work blocks the main thread, frames
    // can be skipped. Start extremely slowly for the first ~2 s of media (or until
    // Alva has locked), then accelerate. This preserves the bootstrap sequence on
    // Android without making the whole video 16x slower.
    const bootstrapMedia = Math.min(FILE_BOOTSTRAP_MEDIA_SECONDS, duration);
    const timeoutMs = Math.max(45000, Math.ceil((bootstrapMedia / FILE_BOOTSTRAP_PLAYBACK_RATE + Math.max(0, duration - bootstrapMedia) / FILE_STEADY_PLAYBACK_RATE) * 1500 + 20000));
    let playbackStage = 'bootstrap';
    const decode = await capture.consumeDecodedFrames((frame) => {
      if (!S.recording) return;
      const consumed = consumeFrame(frame);
      const bootstrapDone = S.trackingPoses >= 2 || frame.mediaTime >= bootstrapMedia;
      if (bootstrapDone && playbackStage === 'bootstrap') {
        playbackStage = 'steady';
        try { video.playbackRate = FILE_STEADY_PLAYBACK_RATE; } catch {}
        log('uploaded-video-playback-stage', { stage:'steady', mediaTime:frame.mediaTime, trackingPoses:S.trackingPoses, playbackRate:FILE_STEADY_PLAYBACK_RATE });
      }
      if (consumed && (uniqueFrames % 6 === 0 || frame.mediaTime >= duration - .05)) {
        const pct = Math.min(100, 100 * frame.mediaTime / duration);
        const status = `AlvaAR ${playbackStage} ${uniqueFrames} · t=${frame.mediaTime.toFixed(2)}/${duration.toFixed(2)} s (${pct.toFixed(0)}%) · pose ${S.trackingPoses} · archivio ${S.frames.length}`;
        dom.runtimeStatus.textContent = status;
        if (dom.liveActivity) dom.liveActivity.textContent = status;
      }
    }, { timeout:timeoutMs, playbackRate:FILE_BOOTSTRAP_PLAYBACK_RATE, includeInitial:true });
    repeatedContent += Number(decode?.duplicates) || 0;
    if (Number.isFinite(decode?.lastMediaTime)) lastMediaTime = Math.max(lastMediaTime, decode.lastMediaTime);
    log('uploaded-video-continuous-decode', { ...decode, timeoutMs, callbacksAccepted:uniqueFrames, initialPlaybackRate:FILE_BOOTSTRAP_PLAYBACK_RATE, steadyPlaybackRate:FILE_STEADY_PLAYBACK_RATE, playbackStage });
  } else {
    const step = 1 / FILE_FALLBACK_FPS, total = Math.max(1, Math.ceil(duration * FILE_FALLBACK_FPS));
    for (let index = 0; index < total && S.recording; index++) {
      const requested = Math.min(duration - 1e-5, index * step);
      const meta = await capture.seekDecodedFrame(requested, { timeout:5000 });
      const frame = capture.capture({ mediaTime:meta?.mediaTime ?? video.currentTime });
      if (!frame) throw new Error(`frame video non decodificabile al tempo ${requested.toFixed(3)} s`);
      if (frame.mediaTime <= lastMediaTime + 1e-6 && uniqueFrames) continue;
      const consumed = consumeFrame(frame);
      if (consumed && (uniqueFrames % 6 === 0 || index + 1 === total)) {
        dom.runtimeStatus.textContent = `Fallback video ${uniqueFrames} frame unici · t=${frame.mediaTime.toFixed(2)} s · pose ${S.trackingPoses} · archivio ${S.frames.length}`;
        await nextPaint();
      }
    }
  }

  if (!uniqueFrames) throw new Error('Il decoder non ha consegnato alcun frame univoco al canvas/AlvaAR.');
  S.fileDecodeStats = {
    duration, mode:nativeFrames?'continuous-requestVideoFrameCallback':'seek-fallback', decodedCallbacks, uniqueFrames, repeatedContent,
    firstPoseDecodedFrame, firstPoseMediaTime, trackingPoses:S.trackingPoses, archivedFrames:S.frames.length,
    maxArchiveFrames, bootstrapCap, requestedArchiveFps, lastMediaTime,
  };
  if (S.recording) stopRecording({ reason:'file-native-decode-complete' });
  capture.stop({ clearVideo:false });
  setGlobal('Video: replay AlvaAR offline…', '');
  dom.runtimeStatus.textContent = `Sequenza letta: ${uniqueFrames} frame unici realmente passati ad AlvaAR (${repeatedContent} duplicati esatti ignorati), ${S.frames.length} conservati. Replay offline in corso.`;
  setActivity('VIDEO · REPLAY OFFLINE', `${uniqueFrames} frame unici letti; avvio replay Alva sull'archivio ${S.frames.length}.`, 'busy');
  log('uploaded-video-native-decode-complete', S.fileDecodeStats);
  try {
    await rerunOffline();
    const posed = S.frames.filter(f => f.pose).length;
    if (posed < 2) {
      const message = `AlvaAR non ha prodotto pose sufficienti (${posed}/${S.frames.length}). Il decoder ha comunque consegnato ${uniqueFrames} frame unici: il problema è nel tracking/contenuto, non nell'ingresso video.`;
      dom.runtimeStatus.textContent = message;
      log('uploaded-video-autoprocess-no-pose', { posed, frames:S.frames.length, uniqueFrames, repeatedContent, trackerRaster:[W,H], sourceVideo:[video.videoWidth,video.videoHeight] }, 'WARN');
      return;
    }
    dom.runtimeStatus.textContent = `Video letto e Alva verificato: ${posed}/${S.frames.length} frame archiviati hanno una posa utilizzabile. Deep resta separato: usa “Prova Deep” o il passo 5.`;
    setActivity('VIDEO · ALVA OK', `${posed}/${S.frames.length} frame archiviati con posa utilizzabile.`, 'ok');
    log('uploaded-video-alva-complete', { posed, uniqueFrames, archivedFrames:S.frames.length, trackerRaster:[W,H] });
  } catch (err) {
    dom.runtimeStatus.textContent = `Elaborazione automatica del video interrotta: ${errorText(err)}`;
    log('uploaded-video-autoprocess-failed', { message:errorText(err), uniqueFrames }, 'ERROR');
  }
}
function startRecording() {
  if (!S.trackingStarted) return; if (S.frames.length) { throw new Error('Questa sessione contiene già immagini. Usa “Azzera sessione” per ricominciare senza perdere accidentalmente l’archivio.'); }
  const warmup = S.preRoll.splice(0);
  for (const raster of warmup) archiveFrame(raster, { phase: 'alva-warmup' });
  S.lastLiveArchiveAt = warmup.length ? Number(warmup[warmup.length - 1].at) : -Infinity;
  S.liveArchiveSamplesSinceRecord = 0;
  S.recording = true; $('recordBtn').disabled = true; $('stopBtn').disabled = false; dom.captureCoach.textContent = S.source === 'file' ? `Replay attivo: Alva riceve ogni frame video unico; il bootstrap viene salvato fitto e l’archivio successivo è adattivo al budget di memoria.` : `Registrazione attiva: Alva continua a ricevere tutti i frame camera; l’archivio conserva ${warmup.length} frame di pre-roll e poi ${numberValue('archiveFps', DEFAULT_ALVA_HZ)} fps, salvo bootstrap fitto finché manca la prima posa.`;
  setGlobal('Registro immagini + pose', 'ok'); setActivity('ACQUISIZIONE', `Registrazione attiva · sorgente ${S.source || '?'} · archivio ${numberValue('archiveFps', DEFAULT_ALVA_HZ)} Hz`, 'busy'); log('recording-start', { samplingHz: numberValue('archiveFps', DEFAULT_ALVA_HZ), warmupFrames: warmup.length, contract: 'same exact RGB raster for Alva live, replay offline and correspondence' });
}
function stopRecording({ reason = 'manual' } = {}) {
  S.recording = false; $('stopBtn').disabled = true; $('offlineBtn').disabled = S.frames.length < 2; $('downloadBtn').disabled = S.frames.length < 1;
  dom.captureCoach.textContent = `${S.frames.length} immagini conservate. Il replay offline usa l’archivio; per i video caricati le pose live native restano anche disponibili come misura Alva esplicita quando il replay diradato non riesce a reinizializzare.`;
  setGlobal('Acquisizione completata'); setStep(3); setActivity('ACQUISIZIONE · FINE', `${S.frames.length} immagini archiviate · ${S.frames.filter(f=>f.livePose).length} con posa live`, 'ok'); log('recording-stop', { reason, source: S.source, frames: S.frames.length, livePoseFrames: S.frames.filter(f => f.livePose).length, imageBytes: S.frameBytes });
}
function disposeCaptureSource() {
  S.capture?.stop?.(); S.capture = null; S.alva = null; S.K = null; W = 0; H = 0; S.current = null; S.livePose = null; S.liveMatrix = null; S.livePoints = []; S.trackingStarted = false; S.source = null; S.lastLiveArchiveAt = -Infinity; S.liveArchiveSamplesSinceRecord = 0; S.offlineFovDeg = null; S.trackerFovDeg = 45; S.trackerFovSweep = null;
  if (S.sourceObjectUrl) { URL.revokeObjectURL(S.sourceObjectUrl); S.sourceObjectUrl = null; }
  $('openCameraBtn').disabled = false; $('fixtureBtn').disabled = false; $('videoFile').disabled = false; $('fovInput').disabled = false; $('archiveFps').disabled = false; $('testDeepBtn').disabled = true;
}
function clearSession() {
  if (S.recording) throw new Error('Ferma prima la registrazione.');
  disposeCaptureSource(); S.frames.length = 0; S.preRoll.length = 0; S.edges.length = 0; S.depthEdges.length = 0; S.offlineTrackerPoints.length = 0; S.frameBytes = 0; S.offlineDone = S.deepDone = S.finalDone = false; S.splats = S.planeSplats = null; S.lastDepthFrame = null; S.deepContract = null; S.fileDecodeStats = null;
  dom.frameStrip.innerHTML = '<p class="empty">L\'archivio comparirà qui. I fotogrammi sono mantenuti in memoria per la riesecuzione offline e Deep.</p>';
  updateArchiveUi(); setBadge(dom.offlineBadge, 'non avviata'); setBadge(dom.planeBadge, 'in attesa'); setBadge(dom.deepBadge, 'non avviata'); setBadge(dom.viewerBadge, 'nessuna particella');
  dom.deepDiagnostic.hidden = true; dom.deepReport.textContent = 'Esegui “Prova Deep sul frame corrente” per verificare il percorso completo.';
  dom.offlineMetrics.innerHTML = '<p class="empty">Qui compariranno copertura AlvaAR, corrispondenze, overlap e tratti interpolati.</p>'; dom.planeMetrics.innerHTML = '<p class="empty">La vista ortografica mostrerà le particelle RGB prodotte dai piani.</p>'; dom.deepMetrics.innerHTML = '<p class="empty">Il log mostrerà le dimensioni native Deep, la conversione coordinate, il verso profondità scelto e il residuo prima/dopo.</p>'; dom.viewerMetrics.innerHTML = '<p class="empty">Dopo Deep, qui troverai il conteggio pixel, piani di fallback, range di profondità, residuo dei punti comuni e test di riproiezione.</p>';
  $('recordBtn').disabled = true; $('stopBtn').disabled = true; $('offlineBtn').disabled = true; $('planeBtn').disabled = true; $('deepBtn').disabled = true; $('finalBtn').disabled = true; $('verifyBtn').disabled = true; $('downloadBtn').disabled = true; $('depthPreviewBtn').disabled = true;
  dom.runtimeStatus.textContent = 'AlvaAR non inizializzato · Deep non caricato. Il fixture dinamico incluso è una regressione con parallasse e deve produrre pose valide.';
  setStep(1); setGlobal('Pronto'); setActivity('PRONTO', 'Sessione azzerata. Scegli camera, fixture o video.', 'ok'); log('session-cleared');
}

function combinedPose(frame) { return frame.offlinePose || frame.livePose || null; }
function interpolatePose(a, b, t) { return { p: a.p.map((v, i) => v + (b.p[i] - v) * t), q: qSlerp(a.q, b.q, t) }; }
function makeContinuousPoses() {
  const measured = S.frames.map(combinedPose);
  for (let i = 0; i < S.frames.length; i++) {
    const f = S.frames[i], p = measured[i];
    if (p) { f.pose = clonePose(p); f.poseSource = f.offlinePose ? 'alvaar-offline' : 'alvaar-live-rescue'; f.poseConfidence = f.offlinePose ? .92 : .58; continue; }
    let left = i - 1, right = i + 1; while (left >= 0 && !measured[left]) left--; while (right < measured.length && !measured[right]) right++;
    if (left >= 0 && right < measured.length && right - left <= 14) { const t = (i - left) / (right - left); f.pose = interpolatePose(measured[left], measured[right], t); f.poseSource = 'interpolated-gap'; f.poseConfidence = .13; }
    else { f.pose = null; f.poseSource = 'no-pose'; f.poseConfidence = 0; }
  }
}
function frameMatches(a, b) { return matchArchivedFrames(a, b, { maxFeatures: 280, maxMatches: 180, maxHamming: 74, minZncc: -.30 }); }
function edgeFor(a, b, association, kind = 'temporal', appearance = null) {
  const matches = association.matches || [];
  return {
    a, b, kind, appearance, matches,
    rawMatches: association.mutualMatches || 0,
    consensusMatches: association.consensusMatches || 0,
    overlap: matches.length / Math.max(1, Math.min(a.features.length, b.features.length)),
    medianDistance: median(matches.map(m => m.distance)),
    poseBaseline: poseDistance(a.pose, b.pose), poseAngle: poseAngle(a.pose, b.pose),
  };
}
function coarseAppearance(a, b) {
  const samples = 108; let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let k = 0; k < samples; k++) {
    const x = Math.round(8 + (W - 17) * ((k * 37) % samples) / (samples - 1));
    const y = Math.round(8 + (H - 17) * ((k * 61) % samples) / (samples - 1));
    const va = a.gray[y * W + x], vb = b.gray[y * W + x]; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
  }
  const na = saa - sa * sa / samples, nb = sbb - sb * sb / samples;
  return na > 1 && nb > 1 ? (sab - sa * sb / samples) / Math.sqrt(na * nb) : -1;
}
function buildOfflineEdges() {
  const edges = [], seen = new Set(), add = (a, b, kind, appearance = null) => {
    if (!a || !b || a === b) return;
    const key = a.index < b.index ? `${a.index}:${b.index}` : `${b.index}:${a.index}`;
    if (seen.has(key)) return;
    seen.add(key); edges.push(edgeFor(a, b, frameMatches(a, b), kind, appearance));
  };
  for (let i = 1; i < S.frames.length; i++) {
    add(S.frames[i - 1], S.frames[i], 'temporal');
    if (i > 2) add(S.frames[i - 2], S.frames[i], 'temporal-skip');
    // Returning to a wall/object must be observable without requiring Alva to
    // have already returned a pose. Search a sparse historical set first, then
    // run the expensive descriptor match only for its strongest image candidate.
    if (i >= 9) {
      let best = null;
      for (let j = 0; j <= i - 7; j += 3) {
        const score = coarseAppearance(S.frames[j], S.frames[i]);
        if (!best || score > best.score) best = { j, score };
      }
      if (best && best.score >= .45) add(S.frames[best.j], S.frames[i], 'loop-appearance', best.score);
    }
  }
  return edges;
}
async function replayAlvaSequence(trackerFovDeg, { assign = true, limit = S.frames.length, label = 'AlvaAR offline' } = {}) {
  const fov = clamp(Number(trackerFovDeg) || 45, 28, 75);
  const tracker = await AlvaAR.Initialize(W, H, fov);
  const pointCounts = [];
  let poses = 0, firstPose = -1;
  if (assign) S.offlineTrackerPoints.length = 0;
  const count = Math.min(S.frames.length, Math.max(1, limit | 0));
  for (let i = 0; i < count; i++) {
    const f = S.frames[i]; let raw = null, points = [];
    try {
      const output = tracker.findCameraPose(new ImageData(new Uint8ClampedArray(f.rgba), W, H));
      if (output?.length >= 16) raw = Array.from(output, Number).slice(0, 16);
      points = compactAlvaPoints(tracker.getFramePoints?.());
    } catch (err) {
      if (assign) log('alvaar-offline-call', { frame: f.id, trackerRaster:[W,H], trackerFovDeg:fov, message: errorText(err) }, 'WARN');
    }
    pointCounts.push(points.length);
    if (raw) { poses++; if (firstPose < 0) firstPose = i; }
    if (assign) {
      f.offlineMatrix = raw; f.offlinePose = alvaMatrixToPose(raw); f.offlinePoints = points;
      f.features = detectScanFeatures(f.gray, W, H, points);
      S.offlineTrackerPoints.push(points.length);
      if (i % 4 === 0 || i === count - 1) { dom.offlineBadge.textContent = `${label} ${i + 1}/${count} · ${W}×${H} · fovA ${fov.toFixed(0)}°`; await nextPaint(); }
    } else if (i % 12 === 0) await nextPaint();
  }
  return { trackerFovDeg:fov, poses, firstPose, medianPoints: median(pointCounts), frames: count };
}
function applyChosenHorizontalFov(horizontalFovDeg) {
  const deg = clamp(Number(horizontalFovDeg) || numberValue('fovInput', 60), 35, 110);
  const focal = .5 * W / Math.tan(deg * Math.PI / 360);
  S.K = { ...(S.K || {}), width:W, height:H, fx:focal, fy:focal, cx:W/2, cy:H/2, fovDeg:deg };
  for (const f of S.frames) f.K = { ...S.K };
  S.offlineFovDeg = deg;
}
async function chooseOfflineTrackerFov() {
  // The third argument of the bundled AlvaAR.Initialize is an internal FOV
  // parameter with its own landscape/portrait convention. It is NOT the same
  // quantity as the horizontal reconstruction FOV exposed by the UI. Probe a
  // small, bounded set only when the documented 45° default fails to bootstrap.
  const candidates = [45, 38, 52, 60, 32, 68];
  const probeLimit = Math.min(S.frames.length, 72);
  const probes = [];
  for (const fov of candidates) {
    setBadge(dom.offlineBadge, `Sonda Alva fovA ${fov}°…`, 'warn');
    const r = await replayAlvaSequence(fov, { assign:false, limit:probeLimit, label:`sonda ${fov}` });
    probes.push(r);
    log('alvaar-fov-probe', r, r.poses ? 'INFO' : 'WARN');
    // A strong early lock is enough; do not waste phone time sweeping the rest.
    if (r.poses >= Math.max(8, Math.floor(probeLimit * .20))) break;
  }
  probes.sort((a,b) => (b.poses-a.poses) || ((a.firstPose<0?1e9:a.firstPose)-(b.firstPose<0?1e9:b.firstPose)) || (b.medianPoints-a.medianPoints));
  S.trackerFovSweep = probes.map(x => ({...x}));
  return probes[0] || { trackerFovDeg:45, poses:0, firstPose:-1, medianPoints:0, frames:probeLimit };
}
async function rerunOffline() {
  if (S.frames.length < 2) throw new Error('Servono almeno due immagini archiviate.');
  $('offlineBtn').disabled = true; setBadge(dom.offlineBadge, 'AlvaAR offline…', 'warn'); setGlobal('Rieseguo AlvaAR offline…');
  setActivity('ALVA · REPLAY', `Sondo il bootstrap su ${S.frames.length} frame archiviati...`, 'busy');
  S.edges.length = 0;
  const projectionFov = clamp(Number(S.K?.fovDeg) || numberValue('fovInput', 60), 35, 110);
  // First probe the tracker calibration. This is deliberately separate from the
  // reconstruction FOV: previous builds displayed a horizontal FOV control but
  // silently initialized Alva with its hard-coded default.
  const bestProbe = await chooseOfflineTrackerFov();
  S.trackerFovDeg = bestProbe.trackerFovDeg;
  const replay = await replayAlvaSequence(S.trackerFovDeg, { assign:true, label:`AlvaAR offline fovA ${S.trackerFovDeg.toFixed(0)}°` });
  S.offlineFovDeg = projectionFov;
  S.edges = buildOfflineEdges();
  makeContinuousPoses(); S.offlineDone = true;
  for (const edge of S.edges) { edge.poseBaseline = poseDistance(edge.a.pose, edge.b.pose); edge.poseAngle = poseAngle(edge.a.pose, edge.b.pose); }
  drawTrajectory(); updateOfflineMetrics(); $('planeBtn').disabled = !S.frames.some(f => f.pose); $('deepBtn').disabled = !S.frames.some(f => f.pose); $('downloadBtn').disabled = false;
  const rawPoses = S.frames.filter(f => f.offlinePose).length, interp = S.frames.filter(f => f.poseSource === 'interpolated-gap').length, overlap10 = S.edges.filter(e => e.overlap >= .10).length, matched = S.edges.filter(e => e.matches.length).length;
  const liveRescue = S.frames.filter(f => f.poseSource === 'alvaar-live-rescue').length;
  const measuredPoses = rawPoses + liveRescue;
  const offlineOk = measuredPoses > 0 && matched > 0;
  setBadge(dom.offlineBadge, `pose misurate ${measuredPoses}/${S.frames.length} · offline ${rawPoses} · fovA ${S.trackerFovDeg.toFixed(0)}° · match ${matched}/${S.edges.length}`, offlineOk ? 'ok' : 'fail');
  setGlobal(offlineOk ? 'Replay Alva e corrispondenze pronti' : 'Replay Alva senza evidenza sufficiente', offlineOk ? 'ok' : 'fail'); setStep(4);
  setActivity(offlineOk ? 'ALVA · REPLAY OK' : 'ALVA · REPLAY DEBOLE', `${measuredPoses}/${S.frames.length} pose misurate · ${matched}/${S.edges.length} coppie con match`, offlineOk ? 'ok' : 'warn');
  log('offline-complete', { frames:S.frames.length, trackerInit:'AlvaAR.Initialize(width,height,trackerFovDeg)', trackerRaster:[W,H], trackerFovDeg:S.trackerFovDeg, trackerFovSweep:S.trackerFovSweep, projectionHorizontalFovDeg:projectionFov, offlinePoses:rawPoses, firstOfflinePose:replay.firstPose, offlineAlvaPointsMedian:median(S.offlineTrackerPoints), liveRescue, interpolated:interp, edges:S.edges.length, matchedEdges:matched, overlapAtLeast10Pct:overlap10 }, offlineOk ? 'INFO' : 'WARN');
  if (!matched) log('offline-correspondence-zero', { reason:'nessuna associazione BRIEF+ZNCC dopo replay con preroll', featuresMedian:median(S.frames.map(f => f.features.length)), offlineAlvaPointsMedian:median(S.offlineTrackerPoints) }, 'WARN');
}
function setupCanvas(canvas) { const r = canvas.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1), w = Math.max(2, Math.round(r.width * d)), h = Math.max(2, Math.round(r.height * d)); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } const g = canvas.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return { g, w: r.width, h: r.height }; }
function drawTrajectory() {
  const { g, w, h } = setupCanvas(dom.trajectoryCanvas); g.fillStyle = '#050c15'; g.fillRect(0, 0, w, h);
  const valid = S.frames.filter(f => f.pose); if (!valid.length) return;
  const xs = valid.map(f => f.pose.p[0]), zs = valid.map(f => f.pose.p[2]), minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs), range = Math.max(.001, maxX - minX, maxZ - minZ), scale = .78 * Math.min(w, h) / range;
  const xy = f => [w * .5 + (f.pose.p[0] - (minX + maxX) * .5) * scale, h * .5 + (f.pose.p[2] - (minZ + maxZ) * .5) * scale];
  g.strokeStyle = '#6aaad8'; g.lineWidth = 1.5; g.beginPath(); let began = false; for (const f of S.frames) { if (!f.pose) { began = false; continue; } const [x, y] = xy(f); if (!began) { g.moveTo(x, y); began = true; } else g.lineTo(x, y); } g.stroke();
  for (const f of S.frames) if (f.pose) { const [x, y] = xy(f); g.fillStyle = f.poseSource === 'alvaar-offline' ? '#63e8a7' : f.poseSource === 'interpolated-gap' ? '#ffc95e' : '#72bfff'; g.beginPath(); g.arc(x, y, f.poseSource === 'interpolated-gap' ? 2.5 : 3.5, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#a9bfd4'; g.font = '12px system-ui'; g.fillText('vista dall’alto · X/Z Alva · verde=offline · blu=live rescue · giallo=interpolata', 10, 18);
}
function metricsHtml(rows) { return `<dl>${rows.map(([k, v, c = '']) => `<dt>${k}</dt><dd class="${c}">${v}</dd>`).join('')}</dl>`; }
function updateOfflineMetrics() {
  const offline = S.frames.filter(f => f.offlinePose).length, live = S.frames.filter(f => f.poseSource === 'alvaar-live-rescue').length, interp = S.frames.filter(f => f.poseSource === 'interpolated-gap').length, noPose = S.frames.filter(f => !f.pose).length;
  const overlaps = S.edges.map(e => e.overlap), baseline = S.edges.map(e => e.poseBaseline).filter(Number.isFinite), matches = S.edges.map(e => e.matches.length), consensus = S.edges.map(e => e.consensusMatches || 0), loopEdges = S.edges.filter(e => e.kind === 'loop-appearance');
  dom.offlineMetrics.innerHTML = metricsHtml([
    ['Frame replay (warm-up + scan)', S.frames.length], ['Warm-up Alva conservato', S.frames.filter(f => f.phase === 'alva-warmup').length, 'good'], ['Pose AlvaAR offline', `${offline} (${fmt(100 * offline / S.frames.length, 0)}%)`, offline ? 'good' : 'bad'], ['Punti Alva offline / frame', fmt(median(S.offlineTrackerPoints), 0), median(S.offlineTrackerPoints) >= 12 ? 'good' : 'warn'], ['Corrispondenze fotografiche / coppia', fmt(median(matches), 0), median(matches) >= 6 ? 'good' : 'bad'], ['Supporto geometrico / coppia', fmt(median(consensus), 0), median(consensus) >= 4 ? 'good' : 'warn'], ['Loop di ritorno valutati', `${loopEdges.filter(e => e.matches.length > 0).length}/${loopEdges.length}`, loopEdges.some(e => e.matches.length > 0) ? 'good' : 'warn'], ['Recovery da posa live', live, live ? 'warn' : ''], ['Gap interpolati (espliciti)', interp, interp ? 'warn' : 'good'], ['Frame senza posa', noPose, noPose ? 'bad' : 'good'], ['Coppie con overlap ≥ 10%', `${S.edges.filter(e => e.overlap >= .10).length}/${S.edges.length}`, S.edges.some(e => e.overlap >= .10) ? 'good' : 'bad'], ['Overlap keypoint mediano', `${fmt(100 * median(overlaps), 1)}%`, median(overlaps) >= .10 ? 'good' : 'warn'], ['Baseline posa mediana', fmt(median(baseline), 4), median(baseline) > .01 ? 'good' : 'warn'], ['Keypoint RGB/Alva mediana', fmt(median(S.frames.map(f => f.features.length)), 0)]
  ]);
}

function posePoint(frame, u, v, z) { const K = frame.K, vx = (u - K.cx) / K.fx * z, vy = (v - K.cy) / K.fy * z, ray = qRotate(frame.pose.q, [vx, vy, z]); return [frame.pose.p[0] + ray[0], frame.pose.p[1] + ray[1], frame.pose.p[2] + ray[2]]; }
function poseRay(frame, u, v, relative = 1) { const K = frame.K; return qRotate(frame.pose.q, [((u - K.cx) / K.fx) * relative, ((v - K.cy) / K.fy) * relative, relative]); }
function regularCount(step, f) { return Math.ceil(f.width / step) * Math.ceil(f.height / step); }
function buildSplats({ useDeep = false } = {}) {
  const step = Math.round(numberValue('gridStep', 6)); const frames = S.frames.filter(f => f.pose); const total = frames.reduce((n, f) => n + regularCount(step, f), 0);
  if (!total) throw new Error('Non esiste alcuna posa utilizzabile per lo splat.');
  const positions = new Float32Array(total * 3), colors = new Uint8Array(total * 3), confidence = new Float32Array(total), source = new Uint16Array(total), depth = new Float32Array(total);
  const metric = Math.max(.000001, numberValue('metricScale', 1)), plane = Math.max(.001, numberValue('planeDistance', 2)); let n = 0, minDepth = Infinity, maxDepth = -Infinity, deepPixels = 0, planePixels = 0;
  for (const f of frames) for (let y = 0; y < f.height; y += step) for (let x = 0; x < f.width; x += step) {
    const z = useDeep && f.deep ? depthAt(f, x, y) : plane;
    const isDeep = useDeep && !!f.deep && Number.isFinite(z) && z > 0, zz = isDeep ? z : plane, p = posePoint(f, x, y, zz), j = y * f.width + x, k = n * 3;
    positions[k] = p[0] * metric; positions[k + 1] = p[1] * metric; positions[k + 2] = p[2] * metric; colors[k] = f.rgba[j * 4]; colors[k + 1] = f.rgba[j * 4 + 1]; colors[k + 2] = f.rgba[j * 4 + 2];
    confidence[n] = clamp(f.poseConfidence * (isDeep ? (f.deep.quality?.suspicious ? .42 : .9) : .35), 0, 1); source[n] = f.index; depth[n] = zz * metric; n++; minDepth = Math.min(minDepth, zz * metric); maxDepth = Math.max(maxDepth, zz * metric); if (isDeep) deepPixels++; else planePixels++;
  }
  return { positions, colors, confidence, source, depth, count: n, gridStep: step, frames: frames.length, deepPixels, planePixels, minDepth, maxDepth, mode: useDeep ? 'deep+plane-fallback' : 'plane' };
}
function isoCoordinates(x, y, z) { return [.70710678 * (x - z), .40824829 * (x + z) + .81649658 * y, .57735027 * (x - y + z)]; }
function renderIso(canvas, splats, minConfidence = 0) {
  const { g, w, h } = setupCanvas(canvas); g.fillStyle = '#050c15'; g.fillRect(0, 0, w, h); if (!splats?.count) return { shown: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < splats.count; i++) { const k = i * 3, [x, y] = isoCoordinates(splats.positions[k], splats.positions[k + 1], splats.positions[k + 2]); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const scale = .91 * Math.min(w / Math.max(.0001, maxX - minX), h / Math.max(.0001, maxY - minY)), cx = w * .5 - (minX + maxX) * .5 * scale, cy = h * .5 - (minY + maxY) * .5 * scale;
  const d = Math.min(2, devicePixelRatio || 1), pw = canvas.width, ph = canvas.height, img = g.createImageData(pw, ph), pix = img.data; let shown = 0;
  for (let i = 0; i < splats.count; i++) { if (splats.confidence[i] < minConfidence) continue; const k = i * 3, [ix, iy] = isoCoordinates(splats.positions[k], splats.positions[k + 1], splats.positions[k + 2]), x = Math.round((cx + ix * scale) * d), y = Math.round((cy + iy * scale) * d); if (x < 1 || y < 1 || x >= pw - 1 || y >= ph - 1) continue; const r = splats.colors[k], gg = splats.colors[k + 1], b = splats.colors[k + 2], alpha = Math.round(100 + splats.confidence[i] * 110); for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const q = ((y + oy) * pw + x + ox) * 4, a = alpha / 255; pix[q] = pix[q] * (1 - a) + r * a; pix[q + 1] = pix[q + 1] * (1 - a) + gg * a; pix[q + 2] = pix[q + 2] * (1 - a) + b * a; pix[q + 3] = Math.min(255, pix[q + 3] + alpha); } shown++; }
  g.putImageData(img, 0, 0); g.fillStyle = '#d3e6f8'; g.font = '12px system-ui'; g.fillText(`ortografica/isometrica · ${shown.toLocaleString('it-IT')} particelle visibili · disco identico 3×3 px`, 9, 18); return { shown, scale };
}
function buildPlane() {
  S.planeSplats = buildSplats({ useDeep: false }); renderIso(dom.planeCanvas, S.planeSplats, 0); S.finalDone = false; $('finalBtn').disabled = !S.deepDone;
  setBadge(dom.planeBadge, `${S.planeSplats.count.toLocaleString('it-IT')} pixel`, 'ok'); dom.planeMetrics.innerHTML = metricsHtml([
    ['Modalità', 'un piano per ogni foto'], ['Foto con posa', S.planeSplats.frames], ['Pixel/particelle', S.planeSplats.count.toLocaleString('it-IT')], ['Decimazione regolare', `1 ogni ${S.planeSplats.gridStep}×${S.planeSplats.gridStep} px`], ['Profondità del piano', `${fmt(numberValue('planeDistance', 2), 3)} unità Alva`], ['Punti comuni conservati', S.edges.reduce((n, e) => n + e.matches.length, 0).toLocaleString('it-IT')], ['Coppie con overlap ≥ 10%', `${S.edges.filter(e => e.overlap >= .10).length}/${S.edges.length}`, S.edges.some(e => e.overlap >= .10) ? 'good' : 'warn'], ['Camera trasferita', 'p + R·[(u−cx)/fx·z, (v−cy)/fy·z, z]', 'good'], ['Proiezione', 'isometrica ortografica', 'good']
  ]); setGlobal('Baseline piana visibile', 'ok'); setStep(5); setActivity('PASSO 5 · PRONTO', 'Baseline piana costruita. Deep non è ancora partito: premi Prova Deep o Esegui Deep.', 'ok'); log('plane-splats-built', { particles: S.planeSplats.count, gridStep: S.planeSplats.gridStep, frames: S.planeSplats.frames });
}

function resetDeepWorker(reason = 'reset') {
  const worker = S.deepWorker;
  S.deepWorker = null;
  if (worker) { try { worker.terminate(); } catch { /* already dead */ } }
  const err = new Error(`Worker Deep reinizializzato: ${reason}`);
  for (const p of S.deepWaiters.values()) { clearTimeout(p.timer); p.reject(err); }
  S.deepWaiters.clear();
  log('deep-worker-reset', { reason }, 'WARN');
}
async function ensureDeepWorker() {
  if (S.deepWorker) return S.deepWorker;
  setActivity('DEEP · WORKER', 'Creo il worker e preparo il runtime WASM...', 'busy');
  log('deep-worker-create', { build: BUILD_ID });
  const worker = new Worker(`./deep_depth_worker.js?v=${encodeURIComponent(BUILD_ID)}`, { type: 'module' }); S.deepWorker = worker;
  worker.onmessage = e => {
    const d = e.data || {};
    if (d.type === 'deep-stage') {
      ACTIVITY.deepHeartbeatAt = performance.now();
      setActivity(`DEEP · ${d.stage || 'WORKER'}`, d.detail || 'operazione in corso...', d.state === 'error' ? 'error' : d.state === 'ok' ? 'ok' : 'busy');
      dom.runtimeStatus.textContent = `Deep: ${d.stage || 'worker'} · ${d.detail || 'in corso'}`;
      log('deep-stage', { stage:d.stage, detail:d.detail, elapsedMs:d.elapsedMs, data:d.data || null }, d.state === 'error' ? 'ERROR' : 'INFO');
      return;
    }
    if (d.type === 'deep-heartbeat') {
      ACTIVITY.deepHeartbeatAt = performance.now();
      const sec = Number.isFinite(d.elapsedMs) ? Math.round(d.elapsedMs / 1000) : null;
      if (dom.liveActivity) dom.liveActivity.textContent = `${d.detail || d.stage || 'Deep in corso'}${sec == null ? '' : ` · ${sec} s in questa fase`}`;
      return;
    }
    if (d.type === 'deep-download-progress') {
      ACTIVITY.deepHeartbeatAt = performance.now();
      const amount = d.pct == null ? `${Math.round((d.received || 0) / 1048576)} MB` : `${d.pct}%`;
      const text = `${d.label}: ${amount}`;
      dom.runtimeStatus.textContent = text;
      if (dom.liveActivity) dom.liveActivity.textContent = text;
      return;
    }
    if (d.type === 'deep-ready') { setActivity('DEEP · PRONTO', `${d.engine} · ${d.provider} · processor ${d.processorCtor || d.processorType || '?'}`, 'ok'); log('deep-worker-ready', { engine:d.engine, model:d.modelId, provider:d.provider, modelRaster:d.modelRaster, processorType:d.processorType, processorCtor:d.processorCtor }); return; }
    if (d.type === 'deep-diag') { log(`deep-${d.event || 'diag'}`, { message: d.message, data:d.data }, d.level === 'warn' ? 'WARN' : 'INFO'); return; }
    const pending = S.deepWaiters.get(String(d.jobId || ''));
    if (pending) { S.deepWaiters.delete(String(d.jobId)); clearTimeout(pending.timer); pending.resolve(d); }
  };
  worker.onerror = e => {
    const err = new Error(e.message || 'errore worker Deep');
    for (const p of S.deepWaiters.values()) { clearTimeout(p.timer); p.reject(err); }
    S.deepWaiters.clear(); S.deepWorker = null;
    setActivity('DEEP · ERRORE WORKER', err.message, 'error');
    log('deep-worker-error', { message: err.message, filename:e.filename || null, lineno:e.lineno || null }, 'ERROR');
    try { worker.terminate(); } catch { /* ignored */ }
  };
  worker.postMessage({ type: 'init', config: {
    transformersUrl: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',
    localModelId: 'depth-anything-v2-small',
    localModelBase: new URL('./models/', location.href).href,
    dtype: 'q4', device: null
  } });
  return worker;
}
function deepRequest(message, timeout = 180000) {
  return new Promise(async (resolve, reject) => {
    try {
      const worker = await ensureDeepWorker(), jobId = String(message.jobId);
      const timer = setTimeout(() => {
        S.deepWaiters.delete(jobId);
        const err = new Error(`timeout Deep (${Math.round(timeout / 1000)} s) durante ${ACTIVITY.phase}`);
        setActivity('DEEP · TIMEOUT', err.message, 'error');
        log('deep-request-timeout', { jobId, timeout, phase:ACTIVITY.phase, activity:ACTIVITY.detail }, 'ERROR');
        resetDeepWorker('timeout richiesta Deep');
        reject(err);
      }, timeout);
      S.deepWaiters.set(jobId, { resolve, reject, timer });
      const transfer = [];
      if (message.rgba?.buffer instanceof ArrayBuffer) transfer.push(message.rgba.buffer);
      worker.postMessage(message, transfer);
    } catch (err) { reject(err); }
  });
}
async function testDeep() {
  const frame = S.current; if (!frame) throw new Error('Nessun fotogramma acquisito disponibile per il test Deep.');
  $('testDeepBtn').disabled = true; setGlobal('Test Deep…'); setActivity('DEEP · TEST', `Frame ${frame.id || 'corrente'} · preparo RGB ${frame.width}×${frame.height}`, 'busy'); const jobId = `test-${Date.now()}`;
  try {
    const d = await deepRequest({ type: 'test', jobId, rgba: new Uint8ClampedArray(frame.rgba), width: frame.width, height: frame.height, frameId: jobId, frameAt: frame.at, refId: 'preflight' });
    if (d.type === 'deep-error') throw new Error(d.message || 'inferenza Deep fallita');
    S.deepContract = d.modelContract || S.deepContract;
    const safeProvider = String(d.provider || '').includes('wasm');
    const spatialVerified = d.quality?.spatialContract?.verified === true;
    const bad = !!d.quality?.suspicious || !safeProvider || !spatialVerified;
    renderDeepDiagnostic(d, { showDepth: !bad });
    if (!bad) drawDepth({ rawDepth: d.rawDepth, rawWidth: d.rawWidth, rawHeight: d.rawHeight });
    dom.runtimeStatus.textContent = `Deep ${bad ? 'NON superato' : 'OK'} · ${d.provider} · ${d.rawWidth}×${d.rawHeight} · ${fmt(d.totalMs || d.ms, 0)} ms · ${bad ? 'mappa incoerente: non verrà usata' : 'struttura coerente'}`;
    setGlobal(bad ? 'Test Deep non superato' : 'Test Deep completato', bad ? 'fail' : 'ok');
    setActivity(bad ? 'DEEP · RIFIUTATO' : 'DEEP · TEST OK', bad ? 'La depth non ha superato i controlli: non verrà usata.' : `Depth ${d.rawWidth}×${d.rawHeight} validata in ${fmt(d.totalMs || d.ms,0)} ms`, bad ? 'error' : 'ok');
    log('deep-test', { provider:d.provider, safeProvider, spatialVerified, output:[d.rawWidth,d.rawHeight], ms:d.totalMs || d.ms, quality:d.quality, layout:d.layoutFix, input:d.inputPlan, modelContract:d.modelContract, flip:d.flipComparison, rasterProbe:d.rasterProbe, depthSignature:d.depthSignature }, bad ? 'WARN' : 'INFO');
    if (bad) throw new Error(`La mappa Deep è stata rifiutata: provider=${d.provider || '?'}; flip=${spatialVerified ? 'ok' : 'non verificato'}; qualità=${d.quality?.suspicious ? 'sospetta' : 'strutturata'}. La ricostruzione non userà profondità casuali.`);
  }
  catch (err) { setActivity('DEEP · TEST FALLITO', errorText(err), 'error'); throw err; }
  finally { $('testDeepBtn').disabled = false; }
}
function selectDeepFrames() {
  const limit = Math.round(clamp(numberValue('deepLimit', 18), 2, 48)), selected = []; let last = null;
  for (const f of S.frames) {
    if (!f.pose) continue;
    if (!last) { selected.push(f); last = f; continue; }
    const association = frameMatches(last, f), matches = association.matches, overlap = matches.length / Math.max(1, Math.min(last.features.length, f.features.length)), baseline = poseDistance(last.pose, f.pose), angle = poseAngle(last.pose, f.pose), age = f.at - last.at;
    if (overlap >= .10 && (baseline >= .018 || angle >= .025 || age >= 1600)) { selected.push(f); last = f; if (selected.length >= limit) break; }
  }
  return selected;
}
function scalarDepth(frame, u, v, convention) {
  const d = frame.deep; if (!d?.rawDepth?.length) return NaN; const x = clamp((u + .5) * d.rawWidth / frame.width - .5, 0, d.rawWidth - 1), y = clamp((v + .5) * d.rawHeight / frame.height - .5, 0, d.rawHeight - 1), x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(d.rawWidth - 1, x0 + 1), y1 = Math.min(d.rawHeight - 1, y0 + 1), tx = x - x0, ty = y - y0;
  const raw = (d.rawDepth[y0 * d.rawWidth + x0] * (1 - tx) + d.rawDepth[y0 * d.rawWidth + x1] * tx) * (1 - ty) + (d.rawDepth[y1 * d.rawWidth + x0] * (1 - tx) + d.rawDepth[y1 * d.rawWidth + x1] * tx) * ty;
  // Monocular depth is relative: its affine offset/sign is not a physical
  // depth. Use its magnitude only after the map passes the spatial test;
  // rejecting negative values here used to turn valid pixels into a plane.
  const magnitude = Math.abs(raw);
  if (!(Number.isFinite(magnitude) && magnitude > 1e-8 && d.median > 1e-8)) return NaN;
  return convention === 'inverse' ? d.median / magnitude : magnitude / d.median;
}
function depthAt(frame, u, v) { return scalarDepth(frame, u, v, frame.deep.convention) * frame.deep.depthScale; }
function buildDepthEdges(selected) {
  const edges = [];
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length && j <= i + 4; j++) {
    const a = selected[i], b = selected[j], association = frameMatches(a, b), matches = association.matches, overlap = matches.length / Math.max(1, Math.min(a.features.length, b.features.length));
    if (overlap >= .10) edges.push({ a, b, matches, overlap });
  }
  return edges;
}
function depthLoss(edges, scales, index, convention) {
  const residuals = [];
  for (const e of edges) for (const m of e.matches) {
    const ra = scalarDepth(e.a, m.ax, m.ay, convention), rb = scalarDepth(e.b, m.bx, m.by, convention); if (!(ra > 0 && rb > 0)) continue;
    const pa = posePoint(e.a, m.ax, m.ay, ra * scales[index.get(e.a)]), pb = posePoint(e.b, m.bx, m.by, rb * scales[index.get(e.b)]); residuals.push(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]));
  }
  return { median: median(residuals), mean: residuals.length ? residuals.reduce((a, b) => a + b, 0) / residuals.length : Infinity, count: residuals.length };
}
function solveDepthScales(selected, edges, convention) {
  const index = new Map(selected.map((f, i) => [f, i])), anchor = Math.max(.001, numberValue('planeDistance', 2)), scales = new Float64Array(selected.length); scales.fill(anchor); const before = depthLoss(edges, scales, index, convention);
  for (let pass = 0; pass < 10; pass++) for (let i = 1; i < selected.length; i++) {
    const f = selected[i], candidates = [];
    for (const e of edges) {
      const other = e.a === f ? e.b : e.b === f ? e.a : null; if (!other) continue;
      const forward = e.a === f;
      for (const m of e.matches) {
        const u = forward ? m.ax : m.bx, v = forward ? m.ay : m.by, ou = forward ? m.bx : m.ax, ov = forward ? m.by : m.ay;
        const r = scalarDepth(f, u, v, convention), ro = scalarDepth(other, ou, ov, convention); if (!(r > 0 && ro > 0)) continue;
        const ray = poseRay(f, u, v, r), po = posePoint(other, ou, ov, ro * scales[index.get(other)]), target = [po[0] - f.pose.p[0], po[1] - f.pose.p[1], po[2] - f.pose.p[2]], denom = ray[0] ** 2 + ray[1] ** 2 + ray[2] ** 2; const candidate = (ray[0] * target[0] + ray[1] * target[1] + ray[2] * target[2]) / Math.max(1e-12, denom); if (candidate > .005 && candidate < 100) candidates.push(candidate);
      }
    }
    if (candidates.length >= 4) scales[i] = .45 * scales[i] + .55 * median(candidates);
  }
  const after = depthLoss(edges, scales, index, convention); return { convention, scales, index, before, after };
}
async function runDeep() {
  if (!S.offlineDone) throw new Error('Prima rielabora le pose offline.');
  const selected = selectDeepFrames();
  if (selected.length < 2) throw new Error('Non sono state trovate due viste con posa e movimento utile. Ripeti la parete con una traslazione laterale più lenta.');

  // Start every batch from a clean state. A rejected map must never leave an
  // old/partially accepted depth visible or available to the final geometry.
  S.deepDone = false;
  S.finalDone = false;
  S.depthEdges.length = 0;
  S.lastDepthFrame = null;
  for (const f of selected) f.deep = null;
  $('finalBtn').disabled = true;
  $('depthPreviewBtn').disabled = true;
  $('deepBtn').disabled = true;
  {
    const { g, w, h } = setupCanvas(dom.depthCanvas);
    g.fillStyle = '#050c15'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d3e6f8'; g.font = '13px system-ui';
    g.fillText('Depth non ancora validata', 12, 26);
  }

  setBadge(dom.deepBadge, `Deep 0/${selected.length}`, 'warn');
  setGlobal('Inferenza Deep post-scan…');
  setActivity('DEEP · BATCH', `Selezionate ${selected.length} viste; inizializzo il runtime...`, 'busy');
  log('deep-selection', { selected: selected.map(f => f.id), count: selected.length, rule: 'overlap keypoint >=10% + posa nuova' });

  try {
    for (let i = 0; i < selected.length; i++) {
      const f = selected[i], jobId = `deep-${f.id}-${Date.now()}`;
      dom.deepBadge.textContent = `Deep ${i + 1}/${selected.length}`;
      setActivity('DEEP · INFERENZA', `Vista ${i + 1}/${selected.length} · ${f.id} · RGB ${f.width}×${f.height}`, 'busy');
      const d = await deepRequest({ type: 'infer', jobId, rgba: new Uint8ClampedArray(f.rgba), width: f.width, height: f.height, frameId: f.id, frameAt: f.at, refId: f.id });
      if (d.type === 'deep-error') throw new Error(`${f.id}: ${d.message || 'errore Deep'}`);
      S.deepContract = d.modelContract || S.deepContract;

      // FAIL-CLOSED: validate provider, numerical output and the independent
      // flip-equivariance check BEFORE mutating frame state or preview.
      const deepSafe = String(d.provider || '').includes('wasm') && d.quality?.spatialContract?.verified === true && !d.quality?.suspicious;
      const valid = Array.from(d.rawDepth || [], v => Math.abs(v)).filter(v => Number.isFinite(v) && v > 1e-8);
      const depthMedian = median(valid);
      const accepted = deepSafe && Number.isFinite(depthMedian) && depthMedian > 1e-8;
      log('deep-frame-result', { frame: f.id, accepted, output: [d.rawWidth, d.rawHeight], inputPlan: d.inputPlan, provider: d.provider, ms: d.totalMs || d.ms, quality: d.quality, layout: d.layoutFix });
      if (!accepted) {
        // Clear the whole current batch, including maps accepted before the
        // failing frame. Partial batches are not a valid global reconstruction.
        for (const x of selected) x.deep = null;
        S.lastDepthFrame = null;
        S.depthEdges.length = 0;
        const { g, w, h } = setupCanvas(dom.depthCanvas);
        g.fillStyle = '#050c15'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#ffb4bd'; g.font = '13px system-ui';
        g.fillText('DEPTH RIFIUTATA - nessuna mappa conservata', 12, 26);
        throw new Error(`${f.id}: Deep non ha superato il gate WASM + flip-equivariance oppure non ha profondità relativa valida; l'intero batch è stato eliminato.`);
      }

      f.deep = { rawDepth: d.rawDepth, rawWidth: d.rawWidth, rawHeight: d.rawHeight, median: depthMedian, quality: d.quality || {}, provider: d.provider, inputPlan: d.inputPlan, ms: d.totalMs || d.ms, convention: 'direct', depthScale: Math.max(.001, numberValue('planeDistance', 2)) };
      S.lastDepthFrame = f;
      drawDepth(f.deep);
      await nextPaint();
    }

    S.depthEdges = buildDepthEdges(selected);
    if (!S.depthEdges.length) log('depth-global-weak-graph', { reason: 'nessuna coppia Deep ha superato overlap 10%' }, 'WARN');
    const direct = solveDepthScales(selected, S.depthEdges, 'direct');
    const inverse = solveDepthScales(selected, S.depthEdges, 'inverse');
    const best = direct.after.median <= inverse.after.median ? direct : inverse;
    for (const f of selected) { f.deep.convention = best.convention; f.deep.depthScale = best.scales[best.index.get(f)]; }

    S.deepDone = true;
    $('finalBtn').disabled = false;
    $('depthPreviewBtn').disabled = false;
    drawDepth(S.lastDepthFrame.deep);
    updateDeepMetrics(selected, best, direct, inverse);
    setBadge(dom.deepBadge, `${selected.length} viste · ${best.convention}`, best.after.count ? 'ok' : 'warn');
    setGlobal('Profondità globali allineate', best.after.count ? 'ok' : '');
    setStep(6);
    setActivity('DEEP · COMPLETATO', `${selected.length} viste allineate · convenzione ${best.convention}`, 'ok');
    log('depth-global-solve', { selected: selected.length, graphEdges: S.depthEdges.length, convention: best.convention, scales: Array.from(best.scales).map(v => +v.toFixed(4)), beforeMedian: best.before.median, afterMedian: best.after.median, residualCount: best.after.count });
  } catch (err) {
    S.deepDone = false;
    S.finalDone = false;
    $('finalBtn').disabled = true;
    $('depthPreviewBtn').disabled = true;
    setBadge(dom.deepBadge, 'Deep rifiutata', 'fail');
    setGlobal('Inferenza Deep rifiutata', 'fail');
    setActivity('DEEP · BATCH FALLITO', errorText(err), 'error');
    log('depth-batch-rejected', { message: errorText(err), selected: selected.map(f => f.id) }, 'ERROR');
    throw err;
  } finally {
    $('deepBtn').disabled = false;
  }
}

function depthShade(t) { const x = clamp(t, 0, 1), v = Math.round(18 + 237 * x); return [Math.round(v * .80), Math.round(v * .93), v]; }
function drawCanvasImage(canvas, source, sourceWidth, sourceHeight, label = '') {
  if (!canvas || !source || !(sourceWidth > 1 && sourceHeight > 1)) return;
  const { g, w, h } = setupCanvas(canvas), scale = Math.min(w / sourceWidth, h / sourceHeight), dw = sourceWidth * scale, dh = sourceHeight * scale;
  g.fillStyle = '#050c15'; g.fillRect(0, 0, w, h); g.imageSmoothingEnabled = true; g.drawImage(source, (w - dw) * .5, (h - dh) * .5, dw, dh);
  if (label) { g.fillStyle = '#edf6ff'; g.font = '12px system-ui'; g.fillText(label, 9, 18); }
}
function depthImage(rawDepth, rawWidth, rawHeight) {
  if (!rawDepth?.length || !(rawWidth > 1 && rawHeight > 1)) return null;
  const lo = percentile(Array.from(rawDepth), .03), hi = percentile(Array.from(rawDepth), .97);
  if (!(hi > lo)) return null;
  const small = document.createElement('canvas'); small.width = rawWidth; small.height = rawHeight;
  const sg = small.getContext('2d'), image = sg.createImageData(rawWidth, rawHeight), n = Math.min(rawDepth.length, rawWidth * rawHeight);
  for (let i = 0; i < n; i++) {
    const value = Number(rawDepth[i]), k = i * 4;
    if (!Number.isFinite(value)) { image.data[k + 3] = 0; continue; }
    const [r, gg, b] = depthShade((value - lo) / (hi - lo)); image.data[k] = r; image.data[k + 1] = gg; image.data[k + 2] = b; image.data[k + 3] = 255;
  }
  sg.putImageData(image, 0, 0); return small;
}
function drawDepth(deep) {
  if (!deep?.rawDepth?.length) return;
  const image = depthImage(deep.rawDepth, deep.rawWidth, deep.rawHeight);
  if (image) drawCanvasImage(dom.depthCanvas, image, deep.rawWidth, deep.rawHeight, `Depth nativa ${deep.rawWidth}×${deep.rawHeight} · H×W row-major · scala 3–97%`);
}
function drawRgbaDiagnostic(canvas, rgba, width, height) {
  if (!canvas || !rgba?.length || !(width > 1 && height > 1)) return;
  const small = document.createElement('canvas'); small.width = width; small.height = height;
  const g = small.getContext('2d'), image = g.createImageData(width, height);
  image.data.set(new Uint8ClampedArray(rgba).subarray(0, image.data.length)); g.putImageData(image, 0, 0);
  drawCanvasImage(canvas, small, width, height);
}
function drawGrayDiagnostic(canvas, data, width, height, channels = 1) {
  if (!canvas || !data?.length || !(width > 1 && height > 1)) return;
  const rgba = new Uint8ClampedArray(width * height * 4), ch = Math.max(1, Number(channels) || 1);
  for (let i = 0; i < width * height; i++) {
    const j = i * ch; let v = Number(data[j]) || 0;
    if (ch >= 3) v = .299 * (Number(data[j]) || 0) + .587 * (Number(data[j + 1]) || 0) + .114 * (Number(data[j + 2]) || 0);
    const q = i * 4, u = clamp(Math.round(v), 0, 255); rgba[q] = rgba[q + 1] = rgba[q + 2] = u; rgba[q + 3] = 255;
  }
  drawRgbaDiagnostic(canvas, rgba, width, height);
}
function renderDeepDiagnostic(d, { showDepth = true } = {}) {
  dom.deepDiagnostic.hidden = false;
  const input = d.inputRasterDiagnostic;
  if (input) {
    drawRgbaDiagnostic(dom.deepSourceCanvas, input.sourcePreview, input.sourceWidth, input.sourceHeight);
    if (input.officialDepthPreview?.length) drawGrayDiagnostic(dom.deepTensorCanvas, input.officialDepthPreview, input.officialDepthWidth, input.officialDepthHeight, input.officialDepthChannels);
    else drawRgbaDiagnostic(dom.deepTensorCanvas, input.tensorNchwPreview, input.tensorWidth, input.tensorHeight);
  }
  const output = showDepth ? depthImage(d.rawDepth, d.rawWidth, d.rawHeight) : null;
  if (output) drawCanvasImage(dom.deepOutputCanvas, output, d.rawWidth, d.rawHeight);
  else {
    const { g, w, h } = setupCanvas(dom.deepOutputCanvas);
    g.fillStyle = '#050c15'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffb4bd'; g.font = '14px system-ui';
    g.fillText('DEPTH RIFIUTATA - preview non mostrata', 12, 28);
  }
  const q = d.quality || {}, stripe = q.stripe || {}, rd = d.rasterDiagnosis || {}, stats = d.spatialStats || {};
  const flip = d.flipComparison || q.spatialContract?.comparison || null;
  const spatial = q.spatialContract || {};
  const model = d.modelContract || {};
  dom.deepReport.textContent = [
    `VERDETTO: ${rd.verdict || (q.suspicious ? 'depth-quality-warning' : 'depth-structured')}`,
    `provider: ${d.provider || '?'} · runtime: ${d.runtime || '?'} · output ${d.rawWidth || '?'}×${d.rawHeight || '?'} · ${fmt(d.totalMs || d.ms, 0)} ms`,
    `input: ${d.preprocessBackend || '?'} · processor ${d.inputPlan?.mode || '?'} · tensor ${d.inputDims?.join('×') || 'gestito internamente'}`,
    `output: ${d.outputDims?.join('×') || '?'} · ${d.outputReadback || '?'} @ ${d.outputLocation || '?'}`,
    `pipeline: ${d.engine || 'Transformers.js depth-estimation'} · modello ${d.modelId || 'depth-anything-v2-small'} · output predicted_depth`,
    `flip spaziale: ${spatial.verified ? 'SUPERATO' : 'NON SUPERATO'} · correlazione ${fmt(flip?.correlation, 3)} · campioni ${flip?.samples || 0} · ${spatial.reason || 'non eseguito'}`,
    `cross-check pipeline: ${q.officialDepthAgreement?.verified ? 'SUPERATO' : 'NON SUPERATO'} · |r|=${fmt(q.officialDepthAgreement?.absCorrelation, 3)} · ${q.officialDepthAgreement?.reason || 'non disponibile'}`,
    `rumore HF: ${q.noiseLike ? 'RILEVATO' : 'non rilevato'} · diff locale/range=${fmt(q.normalizedNeighborDiff, 3)} · coerenza=${fmt(q.coherenceRatio, 2)}`,
    `banding: ${stripe.orientation || '?'} · asse dominante ${fmt(100 * (stripe.dominantExplained || 0), 0)}% · cicli ${fmt(stripe.dominantCycles, 1)} · ratio ${fmt(stripe.ratio, 2)}`,
    `pixel RGB sonda: ${JSON.stringify(d.rasterProbe || {})}`,
    `firma frame: ${d.frameSignature || '—'} → firma depth: ${d.depthSignature || '—'}`,
    '',
    'COME LEGGERLO:',
    '1. CAMERA è il frame RGBA passato direttamente a RawImage; preprocessing e layout sono delegati al DPTImageProcessor ufficiale.',
    '2. PIPELINE DEPTH è la RawImage post-processata internamente da Transformers.js; serve come riferimento indipendente del readback.',
    '3. PREDICTED_DEPTH è il tensore grezzo usato dalla geometria solo se concorda con la RawImage ufficiale e non mostra rumore HF.',
    `4. Il test usa WASM/Q4, cross-check pipeline e frame specchiato; stato complessivo: ${q.suspicious ? 'NON SUPERATO' : 'SUPERATO'}.`,
    `5. Statistica grezza: finite ${fmt(100 * (stats.finiteRatio || 0), 1)}% · locale ${fmt(stats.meanNeighborDiff, 5)} · lontana ${fmt(stats.meanFarDiff, 5)}.`,
  ].join('\n');
}
function updateDeepMetrics(selected, best, direct, inverse) {
  const p = selected[0]?.deep, weak = best.after.count < 8;
  dom.deepMetrics.innerHTML = metricsHtml([
    ['Viste Deep salienti', selected.length], ['Provider verificato', p?.provider || '—', p?.provider?.includes('wasm') ? 'good' : 'warn'], ['Coppie con overlap ≥ 10%', `${S.depthEdges.length}`, S.depthEdges.length ? 'good' : 'bad'], ['Output nativo Deep', p ? `${p.rawWidth}×${p.rawHeight} row-major` : '—', 'good'], ['Coordinate Deep → RGB', 'uD=(uRGB+.5)·WD/WRGB−.5', 'good'], ['Normalizzazione relativa', 'abs(raw) / mediana(abs(raw))', 'good'], ['Verso relativo scelto', best.convention === 'direct' ? 'raw / mediana' : 'mediana / raw', 'good'], ['Residuo mediano prima', fmt(best.before.median, 4)], ['Residuo mediano dopo', fmt(best.after.median, 4), best.after.median < best.before.median ? 'good' : 'warn'], ['Campioni di vincolo', best.after.count, weak ? 'warn' : 'good'], ['Ipotesi direct / inverse', `${fmt(direct.after.median, 4)} / ${fmt(inverse.after.median, 4)}`], ['Fattore metrico finale', `Alva × ${fmt(numberValue('metricScale', 1), 4)}`]
  ]);
}
function buildFinal() {
  if (!S.deepDone) throw new Error('Prima esegui Deep e l’allineamento globale.'); S.splats = buildSplats({ useDeep: true }); S.finalDone = true; $('verifyBtn').disabled = false; renderFinal();
  setBadge(dom.viewerBadge, `${S.splats.count.toLocaleString('it-IT')} pixel`, 'ok'); updateViewerMetrics(); setGlobal('Splat 3D RGB visibile', 'ok'); log('final-splats-built', { particles: S.splats.count, deepPixels: S.splats.deepPixels, planeFallbackPixels: S.splats.planePixels, gridStep: S.splats.gridStep, depthRange: [S.splats.minDepth, S.splats.maxDepth] });
}
function renderFinal() { if (!S.splats) return; const min = Number($('confidenceSlider').value) / 100, r = renderIso(dom.splatCanvas, S.splats, min); dom.confidenceOut.textContent = `${Math.round(min * 100)}% · ${r.shown.toLocaleString('it-IT')}`; }
function updateViewerMetrics(extra = []) {
  if (!S.splats) return; dom.viewerMetrics.innerHTML = metricsHtml([
    ['Particelle conservate', S.splats.count.toLocaleString('it-IT'), 'good'], ['Da pixel con Deep', S.splats.deepPixels.toLocaleString('it-IT'), 'good'], ['Fallback piano (foto non Deep)', S.splats.planePixels.toLocaleString('it-IT'), 'warn'], ['Decimazione ammessa', `griglia fissa ${S.splats.gridStep}×${S.splats.gridStep}`], ['Filtri geometrici/semantici', 'nessuno', 'good'], ['Dimensione di ogni splat', '3×3 px uniforme nella vista'], ['Range profondità globale', `${fmt(S.splats.minDepth, 3)} – ${fmt(S.splats.maxDepth, 3)}`], ['Camera', `K ${fmt(S.K.fx, 1)}, ${fmt(S.K.fy, 1)} · FOV ${fmt(S.K.fovDeg, 1)}°`], ...extra
  ]);
}
function project(frame, p) { const d = [p[0] - frame.pose.p[0], p[1] - frame.pose.p[1], p[2] - frame.pose.p[2]], c = qRotate(qConj(frame.pose.q), d); if (!(c[2] > .00001)) return null; return { u: frame.K.fx * c[0] / c[2] + frame.K.cx, v: frame.K.fy * c[1] / c[2] + frame.K.cy, z: c[2] }; }
function verifyGeometry() {
  if (!S.deepDone) throw new Error('Esegui prima Deep.'); const errors = [];
  for (const e of S.depthEdges) for (const m of e.matches) { const za = depthAt(e.a, m.ax, m.ay); if (!(za > 0)) continue; const p = posePoint(e.a, m.ax, m.ay, za), q = project(e.b, p); if (q && q.u >= 0 && q.u < W && q.v >= 0 && q.v < H) errors.push(Math.hypot(q.u - m.bx, q.v - m.by)); }
  const med = median(errors), p90 = percentile(errors, .9), poseSources = S.frames.reduce((out, f) => (out[f.poseSource] = (out[f.poseSource] || 0) + 1, out), {});
  updateViewerMetrics([['Riproiezioni valide', errors.length, errors.length ? 'good' : 'bad'], ['Errore riproiezione mediano', `${fmt(med, 2)} px`, med < 8 ? 'good' : 'warn'], ['Errore riproiezione p90', `${fmt(p90, 2)} px`, p90 < 20 ? 'good' : 'warn'], ['Pose modificate in verifica', 'no: pose AlvaAR congelate', 'good'], ['Sorgenti posa', Object.entries(poseSources).map(([k, v]) => `${k}:${v}`).join(' · ')] ]);
  log('geometry-verification', { reprojections: errors.length, medianPx: med, p90Px: p90, poseSources, note: 'verifica sola: nessuna posa e nessun pixel è stato scartato o riscritto' }); setGlobal(errors.length ? 'Verifica completata' : 'Verifica con pochi vincoli', errors.length ? 'ok' : '');
}
function downloadDiagnostics() {
  const report = { format: 'SCAN-TEST-DIAGNOSTICS-3.3', build: BUILD_ID, createdAt: new Date().toISOString(), contract: { archivedImagesInMemory: true, allDecodedVideoFramesFedToAlva: true, alvaWarmupReplayed: true, alvaFileReplay: `continuous native decoded frames from t=0; ${FILE_FALLBACK_FPS} fps unique-frame seek fallback`, alvaRaster: [W, H], alvaRasterPolicy:'full-frame aspect-preserving; long side 960', trackerInit:'AlvaAR.Initialize(width,height,trackerFovDeg)', trackerFovDeg:S.trackerFovDeg, poseAuthority: 'AlvaAR only', correspondenceAuthority: 'archived RGB BRIEF+ZNCC, no synthetic pose', noSemanticFilters: true, onlyOptimizedQuantity: 'one relative-depth scale per Deep view', projection: 'orthographic-isometric', deepOnnx: S.deepContract }, intrinsics: S.K, archive: { trackerSamples: S.trackingSamples, trackerPoses: S.trackingPoses, trackerVsArchiveDecoupled: true, chosenOfflineFovDeg: S.offlineFovDeg, trackerFovDeg:S.trackerFovDeg, trackerFovSweep:S.trackerFovSweep, frames: S.frames.length, warmupFrames: S.frames.filter(f => f.phase === 'alva-warmup').length, bytes: S.frameBytes, analysisRaster: 'dynamic full-frame, long side 960', fileDecode: S.fileDecodeStats }, frames: S.frames.map(f => ({ id: f.id, phase: f.phase, at: f.at, livePose: f.livePose, offlinePose: f.offlinePose, chosenPose: f.pose, poseSource: f.poseSource, poseConfidence: f.poseConfidence, liveAlvaPoints: f.livePoints, offlineAlvaPoints: f.offlinePoints?.length || 0, features: f.features.length, deep: f.deep ? { rawSize: [f.deep.rawWidth, f.deep.rawHeight], provider: f.deep.provider, convention: f.deep.convention, depthScale: f.deep.depthScale, quality: f.deep.quality } : null })), edges: S.edges.map(e => ({ a: e.a.id, b: e.b.id, kind: e.kind, appearance: e.appearance, matches: e.matches.length, rawMatches: e.rawMatches, consensusMatches: e.consensusMatches, overlap: e.overlap, poseBaseline: e.poseBaseline, poseAngle: e.poseAngle })), depthEdges: S.depthEdges.map(e => ({ a: e.a.id, b: e.b.id, matches: e.matches.length, overlap: e.overlap })), splat: S.splats ? { count: S.splats.count, gridStep: S.splats.gridStep, deepPixels: S.splats.deepPixels, planePixels: S.splats.planePixels, depthRange: [S.splats.minDepth, S.splats.maxDepth] } : null };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = `scan-test-${Date.now()}-diagnostics.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); log('diagnostics-downloaded', { frames: S.frames.length });
}
function bind(id, fn) { $(id).addEventListener('click', () => Promise.resolve().then(fn).catch(err => { if (['offlineBtn', 'deepBtn'].includes(id)) $(id).disabled = false; setGlobal('Errore', 'fail'); log('ui-operation-failed', { operation: id, message: errorText(err) }, 'ERROR'); alert(errorText(err)); })); }
async function fetchWithTimeout(url, { method = 'GET', timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`timeout ${timeoutMs} ms`), timeoutMs);
  try {
    const r = await fetch(url, { method, cache:'no-store', signal:controller.signal });
    if (method === 'GET' && r.ok) await r.arrayBuffer();
    return { ok:r.ok, status:r.status, bytes:Number(r.headers.get('content-length')) || null };
  } finally { clearTimeout(timer); }
}
async function verifyDeployedBuild() {
  const sentinel = $('buildSentinel');
  const checks = [
    ['worker', new URL(`./deep_depth_worker.js?v=${encodeURIComponent(BUILD_ID)}`, location.href).href],
    ['model-config', new URL('./models/depth-anything-v2-small/config.json', location.href).href],
    ['processor-config', new URL('./models/depth-anything-v2-small/preprocessor_config.json', location.href).href],
  ];
  setActivity('ASSET · SELF-CHECK', 'Verifico in parallelo solo i 3 asset piccoli (timeout 5 s). Il modello Q4 viene verificato al passo Deep.', 'busy');
  const started = performance.now();
  const results = await Promise.all(checks.map(async ([name,url]) => {
    try { return { name, ...(await fetchWithTimeout(url, { timeoutMs:5000 })), url }; }
    catch (err) { return { name, ok:false, status:0, timeout:err?.name === 'AbortError', error:errorText(err), url }; }
  }));
  const okCount = results.filter(x => x.ok).length, ok = okCount === results.length;
  if (sentinel) {
    sentinel.textContent = `${BUILD_ID} · asset piccoli ${okCount}/${results.length}${ok ? ' OK' : ' · controllo terminato con warning'} · Q4 al passo 5`;
    sentinel.dataset.state = ok ? 'ok' : 'warn';
    sentinel.style.borderColor = ok ? '#4be3a1' : '#ffc95e';
    sentinel.style.color = ok ? '#b9ffdf' : '#ffe6a8';
  }
  setActivity(ok ? 'ASSET · OK' : 'ASSET · WARNING', ok ? `Self-check completato in ${Math.round(performance.now()-started)} ms. Pronto.` : 'Self-check terminato: almeno un asset piccolo non ha risposto entro 5 s. L’interfaccia resta utilizzabile; guarda il log.', ok ? 'ok' : 'warn');
  log('deployed-build-selfcheck', { build:BUILD_ID, bounded:true, elapsedMs:Math.round(performance.now()-started), results }, ok ? 'INFO' : 'WARN');
  if (!ok) dom.runtimeStatus.textContent = `Build ${BUILD_ID}: self-check terminato con warning; nessuna richiesta iniziale può restare appesa. Il modello Q4 sarà verificato solo quando avvii Deep.`;
  return { ok, results };
}

bind('openCameraBtn', openCamera); bind('fixtureBtn', startFixture); bind('recordBtn', startRecording); bind('stopBtn', stopRecording); bind('clearBtn', clearSession); bind('offlineBtn', rerunOffline); bind('planeBtn', buildPlane); bind('testDeepBtn', testDeep); bind('deepBtn', runDeep); bind('depthPreviewBtn', () => { if (S.lastDepthFrame?.deep) drawDepth(S.lastDepthFrame.deep); }); bind('finalBtn', buildFinal); bind('verifyBtn', verifyGeometry); bind('downloadBtn', downloadDiagnostics); bind('fitBtn', renderFinal);
$('gridStep').addEventListener('input', () => { dom.gridStepOut.textContent = `${$('gridStep').value} px`; });
$('confidenceSlider').addEventListener('input', () => { if (S.viewToken) cancelAnimationFrame(S.viewToken); S.viewToken = requestAnimationFrame(() => { S.viewToken = 0; renderFinal(); }); });
$('videoFile').addEventListener('change', e => chooseVideo(e.target.files?.[0]).catch(err => alert(errorText(err))));
$('copyLogBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(dom.log.textContent); } catch { /* Clipboard may be blocked on non-secure origins. */ } });
if (dom.liveLogToggle) dom.liveLogToggle.addEventListener('click', () => { const compact = dom.liveLogDock.classList.toggle('compact'); dom.liveLogToggle.textContent = compact ? 'Espandi' : 'Riduci'; dom.liveLogToggle.setAttribute('aria-expanded', String(!compact)); });
window.addEventListener('error', e => { log('window-error', { message:e.message || 'errore JS', filename:e.filename || null, lineno:e.lineno || null, colno:e.colno || null }, 'ERROR'); });
window.addEventListener('unhandledrejection', e => { log('unhandled-rejection', { message:errorText(e.reason) }, 'ERROR'); });
window.addEventListener('resize', () => { if (S.offlineDone) drawTrajectory(); if (S.planeSplats) renderIso(dom.planeCanvas, S.planeSplats); if (S.splats) renderFinal(); });
window.addEventListener('beforeunload', () => { S.capture?.stop?.(); S.deepWorker?.terminate(); });

setStep(1); setActivity('AVVIO', `Build ${BUILD_ID} caricata; avvio self-check con watchdog.`, 'busy'); dom.gridStepOut.textContent = `${$('gridStep').value} px`; dom.confidenceOut.textContent = '0%'; log('scan-test-ready', { build: BUILD_ID, analysisRaster: 'dynamic full-frame, long side 960', defaultSamplingHz: DEFAULT_ALVA_HZ, archiveDefaultHz: numberValue('archiveFps', DEFAULT_ALVA_HZ), deepModel: 'Depth Anything V2 Small Q4 via official Transformers.js depth-estimation pipeline + official RawImage cross-check' });
void verifyDeployedBuild();
