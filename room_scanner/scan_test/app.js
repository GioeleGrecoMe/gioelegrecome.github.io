import { AlvaAR } from './vendor/alva_ar.js';
import { CameraController, intrinsicsForCrop } from './camera.js';

/*
 * Scan Test is deliberately separate from V30.  Its contract is intentionally
 * narrow: archive complete RGB frames + Alva poses, replay them, align only
 * relative depths, then display the raw regularly-decimated image pixels.
 * There is no surfel fusion, TSDF, mesh extraction, semantic selection or
 * confidence-driven culling in this experiment.
 */

const W = 320;
const H = 240;
const DEFAULT_ALVA_HZ = 8;
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
  viewerBadge: $('viewerBadge'), viewerMetrics: $('viewerMetrics'), splatCanvas: $('splatCanvas'),
  gridStepOut: $('gridStepOut'), confidenceOut: $('confidenceOut'),
});

const S = {
  capture: null, source: null, sourceObjectUrl: null,
  alva: null, K: null, current: null, livePose: null, liveMatrix: null, livePoints: [],
  trackingStarted: false, trackingSamples: 0, trackingPoses: 0,
  recording: false, frames: [], frameBytes: 0, edges: [], depthEdges: [],
  selectedFrame: null, offlineDone: false, deepDone: false, finalDone: false,
  deepWorker: null, deepWaiters: new Map(), deepModel: null, splats: null, planeSplats: null,
  lastDepthFrame: null, viewToken: 0, lastResult: null,
};

function nowText() { return new Date().toLocaleTimeString('it-IT', { hour12: false }); }
function log(event, data = null, level = 'INFO') {
  const row = `${nowText()} ${level.padEnd(5)} ${event}${data ? ` ${JSON.stringify(data)}` : ''}`;
  dom.log.textContent = `${row}\n${dom.log.textContent}`.slice(0, 55000);
  console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'info'](`[scan_test] ${event}`, data || '');
}
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
function modelForWorker() {
  if (S.deepModel?.bytes) return { id: S.deepModel.id, label: S.deepModel.label, bytes: S.deepModel.bytes.slice(0) };
  return { id: 'bundled-model-q4', label: 'model_q4.onnx locale', url: new URL('./models/model_q4.onnx', location.href).href };
}

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

function sampleLiveTracker(raster) {
  let matrix = null, points = [];
  try { const raw = S.alva?.findCameraPose(raster.imageData); if (raw?.length >= 16) matrix = Array.from(raw, Number).slice(0, 16); points = Array.from(S.alva?.getFramePoints?.() || []); }
  catch (err) { log('alvaar-live-call', { message: errorText(err) }, 'WARN'); }
  S.trackingSamples++;
  S.liveMatrix = matrix;
  S.livePose = alvaMatrixToPose(matrix);
  S.livePoints = points;
  if (S.livePose) S.trackingPoses++;
  drawLiveOverlay(points, S.livePose);
  const init = !S.livePose && S.trackingPoses === 0;
  setBadge(dom.trackingBadge, S.livePose ? `AlvaAR · ${points.length} punti` : init ? 'AlvaAR inizializza' : 'AlvaAR senza posa', S.livePose ? 'ok' : 'warn');
  dom.liveFeatures.textContent = String(points.length);
  if (S.recording) archiveFrame(raster); // Exact same raster consumed by AlvaAR.
}
function drawLiveOverlay(points, pose) {
  const c = dom.overlay; if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d'); g.clearRect(0, 0, W, H);
  g.fillStyle = pose ? '#67f4b0' : '#ffd36e';
  for (const p of points.slice(0, 260)) { const x = Number(p?.x), y = Number(p?.y); if (!Number.isFinite(x + y)) continue; g.fillRect(x - 1, y - 1, 3, 3); }
  g.fillStyle = '#e8f4ff'; g.font = '10px ui-monospace,monospace'; g.fillText(pose ? `P ${pose.p.map(v => v.toFixed(2)).join(', ')}` : 'ALVA: attendo prima posa', 7, 14);
}
function handleCaptureFrame(frame) { S.current = frame; sampleLiveTracker(frame); }

const DESC_OFFSETS = [[-4,-2],[-2,-4],[0,-4],[2,-4],[4,-2],[-4,0],[-2,-2],[0,-2],[2,-2],[4,0],[-4,2],[-2,2],[0,2],[2,2],[4,2],[-2,4],[0,4],[2,4],[0,0],[3,3]];
function descriptor(gray, x, y) { const d = new Uint8Array(DESC_OFFSETS.length); for (let i = 0; i < DESC_OFFSETS.length; i++) { const [dx, dy] = DESC_OFFSETS[i]; d[i] = gray[(y + dy) * W + x + dx]; } return d; }
function detectFeatures(gray) {
  const features = []; const cell = 16;
  for (let cy = 5; cy < H - 5; cy += cell) for (let cx = 5; cx < W - 5; cx += cell) {
    let best = null;
    for (let y = cy; y < Math.min(H - 5, cy + cell); y += 2) for (let x = cx; x < Math.min(W - 5, cx + cell); x += 2) {
      const i = y * W + x, gx = (gray[i + 1] - gray[i - 1]) + (gray[i + W + 1] - gray[i + W - 1]), gy = (gray[i + W] - gray[i - W]) + (gray[i + W + 1] - gray[i - W - 1]);
      const score = Math.abs(gx) + Math.abs(gy); if (!best || score > best.score) best = { x, y, score };
    }
    if (best && best.score >= 65) features.push({ ...best, desc: descriptor(gray, best.x, best.y) });
  }
  return features;
}
function descDistance(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s; }
function matchFeatures(a, b) {
  if (!a?.length || !b?.length) return [];
  const forward = new Map();
  for (let ia = 0; ia < a.length; ia++) {
    let best = -1, d0 = Infinity, d1 = Infinity;
    for (let ib = 0; ib < b.length; ib++) { const d = descDistance(a[ia].desc, b[ib].desc); if (d < d0) { d1 = d0; d0 = d; best = ib; } else if (d < d1) d1 = d; }
    if (best >= 0 && d0 < 690 && d0 < d1 * .88) forward.set(ia, { ia, ib: best, distance: d0 });
  }
  const backward = new Map();
  for (let ib = 0; ib < b.length; ib++) { let best = -1, d0 = Infinity; for (let ia = 0; ia < a.length; ia++) { const d = descDistance(b[ib].desc, a[ia].desc); if (d < d0) { d0 = d; best = ia; } } backward.set(ib, best); }
  return [...forward.values()].filter(m => backward.get(m.ib) === m.ia).map(m => ({ ...m, ax: a[m.ia].x, ay: a[m.ia].y, bx: b[m.ib].x, by: b[m.ib].y }));
}
function archiveFrame(raster) {
  if (S.frameBytes + raster.rgba.byteLength + raster.gray.byteLength > MAX_FRAME_MEMORY) {
    S.recording = false; $('stopBtn').disabled = true; $('recordBtn').disabled = true;
    dom.captureCoach.textContent = 'Limite di memoria raggiunto: immagini già archiviate e conservate. Procedi con la rielaborazione.';
    log('archive-memory-limit', { bytes: S.frameBytes, max: MAX_FRAME_MEMORY }, 'WARN'); return;
  }
  const features = detectFeatures(raster.gray);
  const index = S.frames.length;
  const frame = { id: `frame-${String(index).padStart(4, '0')}`, sourceFrameId: raster.frameId, index, at: raster.at, mediaTime: raster.mediaTime, width: W, height: H, source: raster.source || S.source,
    rgba: new Uint8ClampedArray(raster.rgba), gray: new Uint8Array(raster.gray), K: { ...S.K }, geometry: { ...raster.geometry },
    liveMatrix: S.liveMatrix?.slice() || null, livePose: clonePose(S.livePose), livePoints: S.livePoints.length, features,
    offlineMatrix: null, offlinePose: null, pose: null, poseSource: 'unresolved', poseConfidence: 0, deep: null };
  S.frames.push(frame); S.frameBytes += frame.rgba.byteLength + frame.gray.byteLength + features.length * 56;
  appendThumb(frame); updateArchiveUi();
  if (index % 8 === 0) log('frame-archived', { id: frame.id, livePose: !!frame.livePose, features: features.length, total: S.frames.length });
}
function appendThumb(frame) {
  const node = dom.frameTemplate.content.firstElementChild.cloneNode(true), c = node.querySelector('canvas'), g = c.getContext('2d');
  g.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), W, H), 0, 0); node.querySelector('span').textContent = `${frame.index + 1} · ${frame.livePose ? 'P' : '—'} · ${frame.features.length}k`;
  node.addEventListener('click', () => { S.selectedFrame = frame.index; for (const x of dom.frameStrip.querySelectorAll('.selected')) x.classList.remove('selected'); node.classList.add('selected'); if (frame.deep) { S.lastDepthFrame = frame; drawDepth(frame.deep); } });
  dom.frameStrip.querySelector('.empty')?.remove(); dom.frameStrip.append(node);
}
function updateArchiveUi() {
  const poses = S.frames.filter(f => f.livePose).length;
  dom.poseCount.textContent = String(poses); dom.frameCount.textContent = String(S.frames.length); dom.memoryCount.textContent = `${(S.frameBytes / 1048576).toFixed(1)} MB`;
  dom.archiveState.textContent = `${S.frames.length} / ${poses} pose`;
}

async function startCaptureSource({ source, label, url = null, autoRecord = false } = {}) {
  if (S.trackingStarted) throw new Error('Una sorgente è già attiva. Azzera la sessione prima di cambiarla.');
  if (source === 'camera' && !navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia non è disponibile: apri questa pagina da HTTPS o localhost.');
  setGlobal(`Apro ${label}…`); dom.runtimeStatus.textContent = `Preparo ${label} usando il controller di acquisizione V30 (crop coerente + frame ID).`;
  if (url) { dom.camera.srcObject = null; dom.camera.src = url; dom.camera.loop = false; dom.camera.muted = true; dom.camera.playsInline = true; }
  const capture = new CameraController({ video: dom.camera, width: W, height: H, fps: clamp(numberValue('archiveFps', DEFAULT_ALVA_HZ), 4, 10), source, log: { info: (event, data) => log(event, data), warn: (event, data) => log(event, data, 'WARN') } });
  await capture.start();
  S.capture = capture; S.source = source; S.K = intrinsics(capture.geometry); S.alva = await AlvaAR.Initialize(W, H, S.K.fovDeg);
  if (!S.alva?.findCameraPose) { capture.stop(); S.capture = null; throw new Error('AlvaAR.Initialize non ha restituito un tracker valido.'); }
  S.trackingStarted = true;
  capture.addEventListener('ended', () => {
    if (S.recording) stopRecording({ reason: 'video-ended' });
    $('recordBtn').disabled = true;
    dom.captureCoach.textContent = `Il video è terminato: ${S.frames.length} frame esatti sono disponibili per la riesecuzione offline.`;
    setGlobal('Video terminato · archivio pronto'); log('capture-source-ended', { source, frames: S.frames.length });
  });
  capture.loop(handleCaptureFrame);
  $('openCameraBtn').disabled = true; $('fixtureBtn').disabled = true; $('videoFile').disabled = true; $('recordBtn').disabled = false; $('testDeepBtn').disabled = false; $('fovInput').disabled = true; $('archiveFps').disabled = true;
  dom.runtimeStatus.textContent = `${label} pronto · ${W}×${H} · FOV ${S.K.fovDeg.toFixed(1)}° · crop ${fmt(capture.geometry.sw, 0)}×${fmt(capture.geometry.sh, 0)} · Deep su richiesta.`;
  dom.captureCoach.textContent = source === 'fixture' ? 'Fixture decoder attiva. È un'immagine statica animata: verifica archivio/crop/stop senza aspettarti una posa AlvaAR.' : source === 'file' ? 'Video caricato: premi “Inizia registrazione”, quindi attendi la fine o fermalo manualmente.' : 'Muovi lentamente la camera con parallasse. “Inizializza” prima della prima posa non equivale a traccia persa.';
  setGlobal(`${label} + AlvaAR pronti`, 'ok'); setStep(2); log('capture-source-ready', { source, K: S.K, geometry: capture.geometry, video: { width: dom.camera.videoWidth, height: dom.camera.videoHeight }, autoRecord });
  if (autoRecord) startRecording();
}
async function openCamera() { await startCaptureSource({ source: 'camera', label: 'camera posteriore' }); }
async function startFixture() { await startCaptureSource({ source: 'fixture', label: 'video fixture V30', url: new URL('./fixtures/tum_freiburg1_xyz_debug_replay.mp4', location.href).href, autoRecord: true }); }
async function chooseVideo(file) {
  if (!file) return;
  const url = URL.createObjectURL(file); S.sourceObjectUrl = url;
  try { await startCaptureSource({ source: 'file', label: `video ${file.name}`, url }); }
  catch (err) { URL.revokeObjectURL(url); S.sourceObjectUrl = null; throw err; }
}
function startRecording() {
  if (!S.trackingStarted) return; if (S.frames.length) { throw new Error('Questa sessione contiene già immagini. Usa “Azzera sessione” per ricominciare senza perdere accidentalmente l’archivio.'); }
  S.recording = true; $('recordBtn').disabled = true; $('stopBtn').disabled = false; dom.captureCoach.textContent = 'Registrazione attiva: ogni fotogramma campionato, posa AlvaAR e keypoint locale vengono archiviati. Evita rotazioni pure; trasla lentamente di lato.';
  setGlobal('Registro immagini + pose', 'ok'); log('recording-start', { samplingHz: numberValue('archiveFps', DEFAULT_ALVA_HZ), contract: 'one RGB raster for every AlvaAR sample' });
}
function stopRecording({ reason = 'manual' } = {}) {
  S.recording = false; $('stopBtn').disabled = true; $('offlineBtn').disabled = S.frames.length < 2; $('downloadBtn').disabled = S.frames.length < 1;
  dom.captureCoach.textContent = `${S.frames.length} immagini conservate. Ora rielabora AlvaAR dall'archivio completo: non userà lo stato live.`;
  setGlobal('Acquisizione completata'); setStep(3); log('recording-stop', { reason, source: S.source, frames: S.frames.length, livePoseFrames: S.frames.filter(f => f.livePose).length, imageBytes: S.frameBytes });
}
function disposeCaptureSource() {
  S.capture?.stop?.(); S.capture = null; S.alva = null; S.K = null; S.current = null; S.livePose = null; S.liveMatrix = null; S.livePoints = []; S.trackingStarted = false; S.source = null;
  if (S.sourceObjectUrl) { URL.revokeObjectURL(S.sourceObjectUrl); S.sourceObjectUrl = null; }
  $('openCameraBtn').disabled = false; $('fixtureBtn').disabled = false; $('videoFile').disabled = false; $('fovInput').disabled = false; $('archiveFps').disabled = false; $('testDeepBtn').disabled = true;
}
function clearSession() {
  if (S.recording) throw new Error('Ferma prima la registrazione.');
  disposeCaptureSource(); S.frames.length = 0; S.edges.length = 0; S.depthEdges.length = 0; S.frameBytes = 0; S.offlineDone = S.deepDone = S.finalDone = false; S.splats = S.planeSplats = null; S.lastDepthFrame = null;
  dom.frameStrip.innerHTML = '<p class="empty">L\'archivio comparirà qui. I fotogrammi sono mantenuti in memoria per la riesecuzione offline e Deep.</p>';
  updateArchiveUi(); setBadge(dom.offlineBadge, 'non avviata'); setBadge(dom.planeBadge, 'in attesa'); setBadge(dom.deepBadge, 'non avviata'); setBadge(dom.viewerBadge, 'nessuna particella');
  dom.offlineMetrics.innerHTML = '<p class="empty">Qui compariranno copertura AlvaAR, corrispondenze, overlap e tratti interpolati.</p>'; dom.planeMetrics.innerHTML = '<p class="empty">La vista ortografica mostrerà le particelle RGB prodotte dai piani.</p>'; dom.deepMetrics.innerHTML = '<p class="empty">Il log mostrerà le dimensioni native Deep, la conversione coordinate, il verso profondità scelto e il residuo prima/dopo.</p>'; dom.viewerMetrics.innerHTML = '<p class="empty">Dopo Deep, qui troverai il conteggio pixel, piani di fallback, range di profondità, residuo dei punti comuni e test di riproiezione.</p>';
  $('recordBtn').disabled = true; $('stopBtn').disabled = true; $('offlineBtn').disabled = true; $('planeBtn').disabled = true; $('deepBtn').disabled = true; $('finalBtn').disabled = true; $('verifyBtn').disabled = true; $('downloadBtn').disabled = true; $('depthPreviewBtn').disabled = true;
  dom.runtimeStatus.textContent = 'AlvaAR non inizializzato · Deep non caricato. Il video di test esercita l’acquisizione, ma è statico e non deve produrre una posa 3D.';
  setStep(1); setGlobal('Pronto'); log('session-cleared');
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
function edgeFor(a, b, matches) { return { a, b, matches, overlap: matches.length / Math.max(1, Math.min(a.features.length, b.features.length)), medianDistance: median(matches.map(m => m.distance)), poseBaseline: poseDistance(a.pose, b.pose), poseAngle: poseAngle(a.pose, b.pose) }; }
async function rerunOffline() {
  if (S.frames.length < 2) throw new Error('Servono almeno due immagini archiviate.');
  $('offlineBtn').disabled = true; setBadge(dom.offlineBadge, 'AlvaAR offline…', 'warn'); setGlobal('Rieseguo AlvaAR offline…');
  const tracker = await AlvaAR.Initialize(W, H, S.K.fovDeg); S.edges.length = 0;
  for (let i = 0; i < S.frames.length; i++) {
    const f = S.frames[i]; let raw = null;
    try { const output = tracker.findCameraPose(new ImageData(new Uint8ClampedArray(f.rgba), W, H)); if (output?.length >= 16) raw = Array.from(output, Number).slice(0, 16); }
    catch (err) { log('alvaar-offline-call', { frame: f.id, message: errorText(err) }, 'WARN'); }
    f.offlineMatrix = raw; f.offlinePose = alvaMatrixToPose(raw);
    if (i > 0) S.edges.push(edgeFor(S.frames[i - 1], f, matchFeatures(S.frames[i - 1].features, f.features)));
    if (i % 4 === 0 || i === S.frames.length - 1) { dom.offlineBadge.textContent = `AlvaAR offline ${i + 1}/${S.frames.length}`; await nextPaint(); }
  }
  makeContinuousPoses(); S.offlineDone = true;
  // Edges were matched before the continuous pose pass.  Refresh only the
  // diagnostic pose fields now; no match or pose is discarded/altered.
  for (const edge of S.edges) { edge.poseBaseline = poseDistance(edge.a.pose, edge.b.pose); edge.poseAngle = poseAngle(edge.a.pose, edge.b.pose); }
  drawTrajectory(); updateOfflineMetrics(); $('planeBtn').disabled = !S.frames.some(f => f.pose); $('deepBtn').disabled = !S.frames.some(f => f.pose); $('downloadBtn').disabled = false;
  const rawPoses = S.frames.filter(f => f.offlinePose).length, interp = S.frames.filter(f => f.poseSource === 'interpolated-gap').length, overlap10 = S.edges.filter(e => e.overlap >= .10).length;
  setBadge(dom.offlineBadge, `completa · ${rawPoses}/${S.frames.length} pose`, rawPoses ? 'ok' : 'fail'); setGlobal('Pose offline pronte', rawPoses ? 'ok' : ''); setStep(4);
  log('offline-complete', { frames: S.frames.length, offlinePoses: rawPoses, liveRescue: S.frames.filter(f => f.poseSource === 'alvaar-live-rescue').length, interpolated: interp, edges: S.edges.length, overlapAtLeast10Pct: overlap10 });
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
  const overlaps = S.edges.map(e => e.overlap), baseline = S.edges.map(e => e.poseBaseline).filter(Number.isFinite);
  dom.offlineMetrics.innerHTML = metricsHtml([
    ['Frame archiviati', S.frames.length], ['Pose AlvaAR offline', `${offline} (${fmt(100 * offline / S.frames.length, 0)}%)`, offline ? 'good' : 'bad'], ['Recovery da posa live', live, live ? 'warn' : ''], ['Gap interpolati (espliciti)', interp, interp ? 'warn' : 'good'], ['Frame senza posa', noPose, noPose ? 'bad' : 'good'], ['Coppie con overlap ≥ 10%', `${S.edges.filter(e => e.overlap >= .10).length}/${S.edges.length}`, S.edges.some(e => e.overlap >= .10) ? 'good' : 'bad'], ['Overlap keypoint mediano', `${fmt(100 * median(overlaps), 1)}%`, median(overlaps) >= .10 ? 'good' : 'warn'], ['Baseline posa mediana', fmt(median(baseline), 4), median(baseline) > .01 ? 'good' : 'warn'], ['Keypoint/foto mediana', fmt(median(S.frames.map(f => f.features.length)), 0)]
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
  ]); setGlobal('Baseline piana visibile', 'ok'); setStep(5); log('plane-splats-built', { particles: S.planeSplats.count, gridStep: S.planeSplats.gridStep, frames: S.planeSplats.frames });
}

async function ensureDeepWorker() {
  if (S.deepWorker) return S.deepWorker;
  const worker = new Worker('./deep_depth_worker.js', { type: 'module' }); S.deepWorker = worker;
  worker.onmessage = e => {
    const d = e.data || {};
    if (d.type === 'deep-download-progress') { dom.runtimeStatus.textContent = `${d.label}: ${d.pct == null ? `${Math.round((d.received || 0) / 1048576)} MB` : `${d.pct}%`}`; return; }
    if (d.type === 'deep-ready') { log('deep-worker-ready', { model: d.modelUrl, rasterContract: d.rasterContract }); return; }
    if (d.type === 'deep-diag') { log(`deep-${d.event || 'diag'}`, { message: d.message }, d.level === 'warn' ? 'WARN' : 'INFO'); return; }
    const pending = S.deepWaiters.get(String(d.jobId || '')); if (pending) { S.deepWaiters.delete(String(d.jobId)); clearTimeout(pending.timer); pending.resolve(d); }
  };
  worker.onerror = e => { const err = new Error(e.message || 'errore worker Deep'); for (const p of S.deepWaiters.values()) { clearTimeout(p.timer); p.reject(err); } S.deepWaiters.clear(); log('deep-worker-error', { message: err.message }, 'ERROR'); };
  worker.postMessage({ type: 'init', config: { modelUrl: new URL('./models/model_q4.onnx', location.href).href, ortLocal: new URL('./vendor/onnxruntime-web/ort.all.min.mjs', location.href).href, inputMaxSide: 518, preferredShortSide: 224, compatibilityShortSide: 280, qualityRescueShortSide: 280, qualityMaxRescueShortSide: 336, testFlipCheck: false } });
  return worker;
}
function deepRequest(message, timeout = 120000) {
  return new Promise(async (resolve, reject) => {
    try { const worker = await ensureDeepWorker(), jobId = String(message.jobId); const timer = setTimeout(() => { S.deepWaiters.delete(jobId); reject(new Error(`timeout Deep (${Math.round(timeout / 1000)} s)`)); }, timeout); S.deepWaiters.set(jobId, { resolve, reject, timer }); worker.postMessage(message); }
    catch (err) { reject(err); }
  });
}
async function testDeep() {
  const frame = S.current; if (!frame) throw new Error('Nessun fotogramma acquisito disponibile per il test Deep.');
  $('testDeepBtn').disabled = true; setGlobal('Test Deep…'); const jobId = `test-${Date.now()}`;
  try { const d = await deepRequest({ type: 'test', jobId, model: modelForWorker(), rgba: new Uint8ClampedArray(frame.rgba), width: W, height: H, frameId: jobId, frameAt: frame.at, refId: 'preflight' }); if (d.type === 'deep-error') throw new Error(d.message || 'inferenza Deep fallita'); drawDepth({ rawDepth: d.rawDepth, rawWidth: d.rawWidth, rawHeight: d.rawHeight }); dom.runtimeStatus.textContent = `Deep OK · ${d.provider} · ${d.rawWidth}×${d.rawHeight} · ${fmt(d.totalMs || d.ms, 0)} ms · ${d.quality?.suspicious ? 'qualità da controllare' : 'struttura coerente'}`; setGlobal('Test Deep completato', d.quality?.suspicious ? '' : 'ok'); log('deep-test', { provider: d.provider, output: [d.rawWidth, d.rawHeight], ms: d.totalMs || d.ms, quality: d.quality, layout: d.layoutFix, input: d.inputPlan }); }
  finally { $('testDeepBtn').disabled = false; }
}
function selectDeepFrames() {
  const limit = Math.round(clamp(numberValue('deepLimit', 18), 2, 48)), selected = []; let last = null;
  for (const f of S.frames) {
    if (!f.pose) continue;
    if (!last) { selected.push(f); last = f; continue; }
    const matches = matchFeatures(last.features, f.features), overlap = matches.length / Math.max(1, Math.min(last.features.length, f.features)), baseline = poseDistance(last.pose, f.pose), angle = poseAngle(last.pose, f.pose), age = f.at - last.at;
    if (overlap >= .10 && (baseline >= .018 || angle >= .025 || age >= 1600)) { selected.push(f); last = f; if (selected.length >= limit) break; }
  }
  return selected;
}
function scalarDepth(frame, u, v, convention) {
  const d = frame.deep; if (!d?.rawDepth?.length) return NaN; const x = clamp((u + .5) * d.rawWidth / frame.width - .5, 0, d.rawWidth - 1), y = clamp((v + .5) * d.rawHeight / frame.height - .5, 0, d.rawHeight - 1), x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(d.rawWidth - 1, x0 + 1), y1 = Math.min(d.rawHeight - 1, y0 + 1), tx = x - x0, ty = y - y0;
  const raw = (d.rawDepth[y0 * d.rawWidth + x0] * (1 - tx) + d.rawDepth[y0 * d.rawWidth + x1] * tx) * (1 - ty) + (d.rawDepth[y1 * d.rawWidth + x0] * (1 - tx) + d.rawDepth[y1 * d.rawWidth + x1] * tx) * ty;
  if (!(Number.isFinite(raw) && raw > 0 && d.median > 0)) return NaN;
  return convention === 'inverse' ? d.median / raw : raw / d.median;
}
function depthAt(frame, u, v) { return scalarDepth(frame, u, v, frame.deep.convention) * frame.deep.depthScale; }
function buildDepthEdges(selected) {
  const edges = [];
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length && j <= i + 4; j++) {
    const a = selected[i], b = selected[j], matches = matchFeatures(a.features, b.features), overlap = matches.length / Math.max(1, Math.min(a.features.length, b.features.length));
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
  const selected = selectDeepFrames(); if (selected.length < 2) throw new Error('Non sono state trovate due viste con posa e movimento utile. Ripeti la parete con una traslazione laterale più lenta.');
  $('deepBtn').disabled = true; setBadge(dom.deepBadge, `Deep 0/${selected.length}`, 'warn'); setGlobal('Inferenza Deep post-scan…'); log('deep-selection', { selected: selected.map(f => f.id), count: selected.length, rule: 'overlap keypoint >=10% + posa nuova' });
  for (let i = 0; i < selected.length; i++) {
    const f = selected[i], jobId = `deep-${f.id}-${Date.now()}`; dom.deepBadge.textContent = `Deep ${i + 1}/${selected.length}`;
    const d = await deepRequest({ type: 'infer', jobId, model: modelForWorker(), rgba: new Uint8ClampedArray(f.rgba), width: f.width, height: f.height, frameId: f.id, frameAt: f.at, refId: f.id, targetSide: 224 });
    if (d.type === 'deep-error') throw new Error(`${f.id}: ${d.message || 'errore Deep'}`);
    const valid = Array.from(d.rawDepth).filter(v => Number.isFinite(v) && v > 0); f.deep = { rawDepth: d.rawDepth, rawWidth: d.rawWidth, rawHeight: d.rawHeight, median: median(valid), quality: d.quality || {}, provider: d.provider, inputPlan: d.inputPlan, ms: d.totalMs || d.ms, convention: 'direct', depthScale: Math.max(.001, numberValue('planeDistance', 2)) }; S.lastDepthFrame = f;
    drawDepth(f.deep); log('deep-frame-result', { frame: f.id, output: [d.rawWidth, d.rawHeight], inputPlan: d.inputPlan, provider: d.provider, ms: d.totalMs || d.ms, quality: d.quality, layout: d.layoutFix }); await nextPaint();
  }
  S.depthEdges = buildDepthEdges(selected); if (!S.depthEdges.length) log('depth-global-weak-graph', { reason: 'nessuna coppia Deep ha superato overlap 10%' }, 'WARN');
  const direct = solveDepthScales(selected, S.depthEdges, 'direct'), inverse = solveDepthScales(selected, S.depthEdges, 'inverse'); const best = direct.after.median <= inverse.after.median ? direct : inverse;
  for (const f of selected) { f.deep.convention = best.convention; f.deep.depthScale = best.scales[best.index.get(f)]; }
  S.deepDone = true; $('finalBtn').disabled = false; $('depthPreviewBtn').disabled = false; $('deepBtn').disabled = false;
  drawDepth(S.lastDepthFrame.deep); updateDeepMetrics(selected, best, direct, inverse); setBadge(dom.deepBadge, `${selected.length} viste · ${best.convention}`, best.after.count ? 'ok' : 'warn'); setGlobal('Profondità globali allineate', best.after.count ? 'ok' : ''); setStep(6);
  log('depth-global-solve', { selected: selected.length, graphEdges: S.depthEdges.length, convention: best.convention, scales: Array.from(best.scales).map(v => +v.toFixed(4)), beforeMedian: best.before.median, afterMedian: best.after.median, residualCount: best.after.count });
}
function heat(t) { const x = clamp(t, 0, 1), r = Math.round(255 * clamp(1.8 - Math.abs(4 * x - 3), 0, 1)), g = Math.round(255 * clamp(1.8 - Math.abs(4 * x - 2), 0, 1)), b = Math.round(255 * clamp(1.8 - Math.abs(4 * x - 1), 0, 1)); return [r, g, b]; }
function drawDepth(deep) {
  if (!deep?.rawDepth?.length) return; const { g, w, h } = setupCanvas(dom.depthCanvas), lo = percentile(Array.from(deep.rawDepth), .03), hi = percentile(Array.from(deep.rawDepth), .97); if (!(hi > lo)) return;
  const small = document.createElement('canvas'); small.width = deep.rawWidth; small.height = deep.rawHeight; const sg = small.getContext('2d'), image = sg.createImageData(deep.rawWidth, deep.rawHeight);
  for (let i = 0; i < deep.rawDepth.length; i++) { const [r, gg, b] = heat((deep.rawDepth[i] - lo) / (hi - lo)), k = i * 4; image.data[k] = r; image.data[k + 1] = gg; image.data[k + 2] = b; image.data[k + 3] = 255; } sg.putImageData(image, 0, 0);
  g.fillStyle = '#050c15'; g.fillRect(0, 0, w, h); g.imageSmoothingEnabled = true; g.drawImage(small, 0, 0, w, h); g.fillStyle = '#fff'; g.font = '12px system-ui'; g.fillText(`Depth nativa ${deep.rawWidth}×${deep.rawHeight} · row-major H×W · percentile 3–97`, 9, 18);
}
function updateDeepMetrics(selected, best, direct, inverse) {
  const p = selected[0]?.deep, weak = best.after.count < 8;
  dom.deepMetrics.innerHTML = metricsHtml([
    ['Viste Deep salienti', selected.length], ['Coppie con overlap ≥ 10%', `${S.depthEdges.length}`, S.depthEdges.length ? 'good' : 'bad'], ['Output nativo Deep', p ? `${p.rawWidth}×${p.rawHeight} row-major` : '—', 'good'], ['Coordinate Deep → RGB', 'uD=(uRGB+.5)·WD/WRGB−.5', 'good'], ['Verso relativo scelto', best.convention === 'direct' ? 'raw / mediana' : 'mediana / raw', 'good'], ['Residuo mediano prima', fmt(best.before.median, 4)], ['Residuo mediano dopo', fmt(best.after.median, 4), best.after.median < best.before.median ? 'good' : 'warn'], ['Campioni di vincolo', best.after.count, weak ? 'warn' : 'good'], ['Ipotesi direct / inverse', `${fmt(direct.after.median, 4)} / ${fmt(inverse.after.median, 4)}`], ['Fattore metrico finale', `Alva × ${fmt(numberValue('metricScale', 1), 4)}`]
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
  const report = { format: 'SCAN-TEST-DIAGNOSTICS-1', createdAt: new Date().toISOString(), contract: { allImagesInMemory: true, noSemanticFilters: true, onlyOptimizedQuantity: 'one relative-depth scale per Deep view', projection: 'orthographic-isometric' }, intrinsics: S.K, archive: { frames: S.frames.length, bytes: S.frameBytes, imageSize: [W, H] }, frames: S.frames.map(f => ({ id: f.id, at: f.at, livePose: f.livePose, offlinePose: f.offlinePose, chosenPose: f.pose, poseSource: f.poseSource, poseConfidence: f.poseConfidence, features: f.features.length, deep: f.deep ? { rawSize: [f.deep.rawWidth, f.deep.rawHeight], provider: f.deep.provider, convention: f.deep.convention, depthScale: f.deep.depthScale, quality: f.deep.quality } : null })), edges: S.edges.map(e => ({ a: e.a.id, b: e.b.id, matches: e.matches.length, overlap: e.overlap, poseBaseline: e.poseBaseline, poseAngle: e.poseAngle })), depthEdges: S.depthEdges.map(e => ({ a: e.a.id, b: e.b.id, matches: e.matches.length, overlap: e.overlap })), splat: S.splats ? { count: S.splats.count, gridStep: S.splats.gridStep, deepPixels: S.splats.deepPixels, planePixels: S.splats.planePixels, depthRange: [S.splats.minDepth, S.splats.maxDepth] } : null };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = `scan-test-${Date.now()}-diagnostics.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); log('diagnostics-downloaded', { frames: S.frames.length });
}
async function chooseModel(file) { if (!file) return; const bytes = await file.arrayBuffer(); if (bytes.byteLength < 1024) throw new Error('Il file ONNX selezionato è troppo piccolo.'); S.deepModel = { id: `upload-${file.name}-${file.size}-${file.lastModified}`, label: file.name, bytes }; if (S.deepWorker) { S.deepWorker.terminate(); S.deepWorker = null; } dom.runtimeStatus.textContent = `Modello selezionato: ${file.name} (${(file.size / 1048576).toFixed(1)} MB). Il prossimo test/inferenza userà questo file.`; log('deep-model-selected', { name: file.name, bytes: file.size }); }

function bind(id, fn) { $(id).addEventListener('click', () => Promise.resolve().then(fn).catch(err => { if (['offlineBtn', 'deepBtn'].includes(id)) $(id).disabled = false; setGlobal('Errore', 'fail'); log('ui-operation-failed', { operation: id, message: errorText(err) }, 'ERROR'); alert(errorText(err)); })); }
bind('openCameraBtn', openCamera); bind('fixtureBtn', startFixture); bind('recordBtn', startRecording); bind('stopBtn', stopRecording); bind('clearBtn', clearSession); bind('offlineBtn', rerunOffline); bind('planeBtn', buildPlane); bind('testDeepBtn', testDeep); bind('deepBtn', runDeep); bind('depthPreviewBtn', () => { if (S.lastDepthFrame?.deep) drawDepth(S.lastDepthFrame.deep); }); bind('finalBtn', buildFinal); bind('verifyBtn', verifyGeometry); bind('downloadBtn', downloadDiagnostics); bind('fitBtn', renderFinal);
$('gridStep').addEventListener('input', () => { dom.gridStepOut.textContent = `${$('gridStep').value} px`; });
$('confidenceSlider').addEventListener('input', () => { if (S.viewToken) cancelAnimationFrame(S.viewToken); S.viewToken = requestAnimationFrame(() => { S.viewToken = 0; renderFinal(); }); });
$('modelFile').addEventListener('change', e => chooseModel(e.target.files?.[0]).catch(err => alert(errorText(err))));
$('videoFile').addEventListener('change', e => chooseVideo(e.target.files?.[0]).catch(err => alert(errorText(err))));
$('copyLogBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(dom.log.textContent); } catch { /* Clipboard may be blocked on non-secure origins. */ } });
window.addEventListener('resize', () => { if (S.offlineDone) drawTrajectory(); if (S.planeSplats) renderIso(dom.planeCanvas, S.planeSplats); if (S.splats) renderFinal(); });
window.addEventListener('beforeunload', () => { S.capture?.stop?.(); S.deepWorker?.terminate(); });

setStep(1); dom.gridStepOut.textContent = `${$('gridStep').value} px`; dom.confidenceOut.textContent = '0%'; log('scan-test-ready', { imageSize: [W, H], defaultSamplingHz: DEFAULT_ALVA_HZ, archiveDefaultHz: numberValue('archiveFps', DEFAULT_ALVA_HZ), deepModel: 'models/model_q4.onnx' });
